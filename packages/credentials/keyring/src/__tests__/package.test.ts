import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "bun:test";
import {
  type AuthContext,
  createAgent,
  definePackage,
  type PackageInput,
  type Secret,
} from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";
import { hyper } from "@arnilo/prism-provider-hyper";
import keyringDefinition, {
  createKeyringCredentialResolver,
  KEYRING_DEFAULT_SERVICE,
  KEYRING_REF_PREFIX,
  keyring,
  openEncryptedCredentialStore,
} from "../index.js";

const MODEL = { provider: "mock", model: "demo" } as const;
const PASSPHRASE_ENV = "PRISM_TEST_KEYRING_PASSPHRASE";
const PASSPHRASE_REF = `env:${PASSPHRASE_ENV}`;

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  delete process.env[PASSPHRASE_ENV];
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "prism-keyring-"));
  tempDirs.push(dir);
  return dir;
}

/** A file backend config over a fresh temp vault; the passphrase comes from {@link PASSPHRASE_REF}. */
function fileBackend(dir = tempDir()): { backend: "file"; file: { path: string; keyRef: string } } {
  process.env[PASSPHRASE_ENV] = "test-passphrase";
  return { backend: "file", file: { path: join(dir, "vault.enc"), keyRef: PASSPHRASE_REF } };
}

/** Records what the credentials slot answers for each ref (and any rejection). */
function credentialProbe(refs: readonly string[], out: Record<string, Secret | undefined>, failures: Record<string, unknown> = {}) {
  return definePackage({
    name: "@test/credential-probe",
    version: "1.0.0",
    requires: { api: 1 },
    capabilities: ["credentials"],
    setup: async (prism) => {
      for (const ref of refs) {
        try {
          out[ref] = await prism.credentials.resolve(ref);
        } catch (error) {
          failures[ref] = error;
        }
      }
    },
  }) as PackageInput;
}

/** Asks the host for a secret at `ref`; the kernel stores it through the credentials slot. */
function secretAsker(ref: string, outcome: { answer?: unknown; error?: unknown }) {
  return definePackage({
    name: "@test/secret-asker",
    version: "1.0.0",
    requires: { api: 1 },
    capabilities: ["host-ui"],
    setup: async (prism) => {
      try {
        outcome.answer = await prism.host.ui?.request({ kind: "secret", title: "API key", ref });
      } catch (error) {
        outcome.error = error;
      }
    },
  }) as PackageInput;
}

/** A second credentials-slot claimant, so two providers force a host assignment. */
const secondClaimant = definePackage({
  name: "@test/credentials-fixture",
  version: "1.0.0",
  requires: { api: 1 },
  capabilities: ["slot:credentials"],
  setup: (prism) => {
    prism.slots.credentials.provide({ resolve: () => ({ type: "api_key", value: "fixture" }) });
  },
}) as PackageInput;

/** The `AuthContext.credentials` handle over a credentials resolver (both members are required there). */
function authCredentials(resolver: ReturnType<typeof createKeyringCredentialResolver>): AuthContext["credentials"] {
  return {
    async store(ref, secret) {
      await resolver.store?.(ref, secret, {});
    },
    async delete(ref) {
      await resolver.delete?.(ref, {});
    },
  };
}


function hyperChatSse(): ReadableStream<Uint8Array> {
  const events = [
    { choices: [{ delta: { content: "hello" } }] },
    { choices: [{ delta: {}, finish_reason: "stop" }] },
  ];
  const text = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe("@arnilo/prism-credentials-keyring package", () => {
  it("keyring_package_passes_package_conformance", async () => {
    const result = await packageConformance(keyringDefinition, { config: fileBackend() });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
      JSON.stringify(result.checks),
    );
    assert.equal(result.ok, true);
  });

  it("keyring_resolves_keyring_refs_and_delegates_env_to_default", async () => {
    assert.equal(KEYRING_REF_PREFIX, "keyring:");
    assert.equal(KEYRING_DEFAULT_SERVICE, "prism");
    const config = fileBackend();
    process.env.PRISM_TEST_KEYRING_ENV = "env-value";
    try {
      const store = await openEncryptedCredentialStore({ path: config.file.path, getPassphrase: () => "test-passphrase" });
      await store.set({ name: "demo", credential: { type: "api_key", value: "stored-value" } });

      const resolved: Record<string, Secret | undefined> = {};
      const agent = await createAgent({
        model: MODEL,
        packages: [keyring(config), credentialProbe(["keyring:demo", "keyring:missing", "env:PRISM_TEST_KEYRING_ENV"], resolved)],
      });
      try {
        assert.equal(resolved["keyring:demo"]?.value, "stored-value", "a keyring: ref reads the backend");
        assert.equal(resolved["keyring:missing"], undefined, "an absent entry is undefined, not an error");
        assert.equal(resolved["env:PRISM_TEST_KEYRING_ENV"]?.value, "env-value", "env: refs delegate to the kernel default");
      } finally {
        await agent.dispose();
      }
    } finally {
      delete process.env.PRISM_TEST_KEYRING_ENV;
    }
  });

  it("secret_host_request_stores_through_keyring", async () => {
    const config = fileBackend();
    const outcome: { answer?: unknown; error?: unknown } = {};
    const canary = "host-captured-canary-0123456789";
    const agent = await createAgent({
      model: MODEL,
      packages: [keyring(config), secretAsker("keyring:acme", outcome)],
      host: {
        ui: {
          async request() {
            return { status: "answered", value: canary } as never;
          },
        },
      },
    });
    try {
      assert.deepEqual(outcome.error, undefined, String(outcome.error));
      assert.deepEqual(outcome.answer, { status: "answered", value: undefined }, "the package never sees the value");
      const store = await openEncryptedCredentialStore({ path: config.file.path, getPassphrase: () => "test-passphrase" });
      assert.equal((await store.get({ name: "acme" }))?.value, canary, "the kernel stored the value at the request's ref");
      assert.equal(JSON.stringify(agent.inspect()).includes(canary), false, "the stored value never appears in inspect()");
    } finally {
      await agent.dispose();
    }
  });

  it("persisted_credentials_resolve_through_hyper_provider", async () => {
    const config = fileBackend();
    // 1. The store holds a persisted credential.
    const store = await openEncryptedCredentialStore({ path: config.file.path, getPassphrase: () => "test-passphrase" });
    await store.set({ name: "hyper", credential: { type: "api_key", value: "hyper-persisted-token" } });

    // 2. An agent that lists the keyring package and hyper provider resolves the persisted token through the slot.
    let captured: Headers | undefined;
    const agent = await createAgent({
      model: { provider: "hyper", model: "hyper/hyper" },
      packages: [
        keyring(config),
        hyper({
          apiKey: "keyring:hyper",
          fetch: (async (_url: unknown, init: RequestInit) => {
            captured = new Headers(init.headers);
            return new Response(hyperChatSse(), { status: 200 });
          }) as typeof fetch,
        }),
      ],
    });
    try {
      const session = await agent.session({ id: "hyper", create: true });
      const result = await session.run("hello");
      assert.equal(result.status, "completed", JSON.stringify(result));
      assert.equal(captured?.get("authorization"), "Bearer hyper-persisted-token", "the provider resolved the persisted token");
    } finally {
      await agent.dispose();
    }
  });

  it("unavailable_os_keyring_notes_status_and_fails_closed_without_plaintext_fallback", async () => {
    const dir = tempDir();
    const resolved: Record<string, Secret | undefined> = {};
    const outcome: { answer?: unknown; error?: unknown } = {};
    const agent = await createAgent({
      model: MODEL,
      packages: [
        keyring({
          backend: "os",
          service: "prism-test-unavailable",
          probe: async () => ({ status: "unavailable", message: "no Secret Service" }),
        }),
        credentialProbe(["keyring:demo"], resolved),
        secretAsker("keyring:acme", outcome),
      ],
      host: {
        ui: {
          async request() {
            return { status: "answered", value: "never-stored" } as never;
          },
        },
      },
    });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.message.includes("prism-test-unavailable"));
      assert.equal(notes.length, 1, "an unavailable OS keyring is a status note, not a failed load");
      assert.equal(notes[0]?.level, "warn");
      assert.equal(resolved["keyring:demo"], undefined, "keyring: refs answer undefined");
      assert.equal((outcome.error as { code?: string } | undefined)?.code, "keyring_unavailable", "store fails closed");
      assert.deepEqual(readdirSync(dir), [], "never a silent plaintext fallback");
    } finally {
      await agent.dispose();
    }
  });

  it("two_credentials_slot_claims_fail_closed_until_assigned", async () => {
    const config = fileBackend();
    // The loader resolves slot ownership at load, so the conflict fails the load, not the first run.
    await assert.rejects(
      createAgent({ model: MODEL, packages: [keyring(config), secondClaimant] }),
      (error: { code?: string; owners?: readonly string[] }) =>
        error.code === "ERR_PRISM_SLOT_CONFLICT" && (error.owners ?? []).length === 2,
    );

    const assigned: Record<string, Secret | undefined> = {};
    const agent = await createAgent({
      model: MODEL,
      packages: [keyring(config), secondClaimant, credentialProbe(["keyring:demo"], assigned)],
      slots: { credentials: "@arnilo/prism-credentials-keyring" },
    });
    try {
      assert.deepEqual(Object.keys(assigned), ["keyring:demo"], "an assignment resolves the conflict");
      assert.equal(assigned["keyring:demo"], undefined, "the assigned keyring resolver answers (empty vault)");
    } finally {
      await agent.dispose();
    }
  });

  it("keyring_refuses_a_literal_key_ref", async () => {
    await assert.rejects(
      createAgent({
        model: MODEL,
        packages: [keyring({ backend: "file", file: { path: join(tempDir(), "vault.enc"), keyRef: "literal-passphrase" } })],
      }),
      (error: { code?: string }) => error.code === "secret_literal",
    );
  });

  it("stored_secret_canary_never_leaks", async () => {
    const config = fileBackend();
    const canary = "stored-canary-0123456789abcdef";
    const store = await openEncryptedCredentialStore({ path: config.file.path, getPassphrase: () => "test-passphrase" });
    const resolver = createKeyringCredentialResolver({ store });
    const credentials = authCredentials(resolver);
    await credentials.store("keyring:canary", { type: "api_key", value: canary });
    assert.equal((await resolver.resolve("keyring:canary", {}))?.value, canary);

    const agent = await createAgent({ model: MODEL, packages: [keyring(config)] });
    try {
      const snapshot = JSON.stringify(agent.inspect());
      assert.equal(snapshot.includes(canary), false, "a stored value never appears in inspect()");
      assert.equal(snapshot.includes("keyring:canary"), false, "the package does not enumerate stored entries");
      const notes = agent.inspect().statusNotes.map((note) => note.message).join("\n");
      assert.equal(notes.includes(canary), false, "a stored value never appears in a status note");
      await assert.rejects(
        credentials.store("env:NOT_KEYRING", { type: "api_key", value: canary }),
        (error: { message?: string }) => (error.message ?? "").includes(canary) === false,
      );
    } finally {
      await agent.dispose();
    }
  });

  it("napi_keyring_not_loaded_unless_listed", async () => {
    // Static-import scan: only a dynamic import inside the OS backend may name the native addon.
    const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
    const groupDirs = (group: string): string[] =>
      readdirSync(join(repoRoot, "packages", group), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(repoRoot, "packages", group, entry.name, "src", "index.ts")))
        .map((entry) => join(repoRoot, "packages", group, entry.name, "src"));
    const packageDirs = [...groupDirs("providers"), ...groupDirs("credentials")];
    const offenders: string[] = [];
    for (const dir of packageDirs) {
      for (const file of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
        if (!file.endsWith(".ts")) continue;
        const text = readFileSync(join(dir, file), "utf8");
        if (/import\s+[^;]*from\s*"@napi-rs\/keyring"/.test(text)) offenders.push(`${dir}/${file}`);
      }
    }
    assert.deepEqual(offenders, [], "the native addon must be a dynamic import inside the OS backend");

    // Runtime: an agent that lists the keyring package with the file backend never loads the addon.
    const script = [
      'const { createAgent } = await import("@arnilo/prism");',
      'const keyring = (await import("@arnilo/prism-credentials-keyring")).default;',
      `const agent = await createAgent({ model: { provider: "mock", model: "demo" }, packages: [keyring({ backend: "file", file: { path: ${JSON.stringify(join(tempDir(), "vault.enc"))}, keyRef: "env:${PASSPHRASE_ENV}" } })] });`,
      "await agent.dispose();",
      'const loaded = Object.keys(require.cache ?? {}).some((key) => key.includes("@napi-rs/keyring"));',
      'console.log(loaded ? "loaded" : "clean");',
    ].join("\n");
    const result = spawnSync("bun", ["-e", script], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "clean", "the addon is absent from the module graph of an agent without the OS backend");
  });
});
