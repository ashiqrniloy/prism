import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  type CredentialResolver,
  CredentialRefNotWritableError,
  CredentialStoreUnavailableError,
  createEnvRefCredentialResolver,
  createSlotDefaults,
  createSlotRegistry,
  definePackage,
  type PackageAPI,
  type PackageInput,
  type Secret,
} from "../index.js";
import { createHookBus } from "../hooks/index.js";
import { loadPackages } from "../packages/loader.js";

const CANARY = "sk-live-canary-credentials-write";

const pkg = (name: string, setup: (api: any) => void, extra: Record<string, unknown> = {}): PackageInput =>
  definePackage<any>({ name, version: "1.0.0", requires: { api: 1 }, setup, ...extra }) as PackageInput;

/** A credentials slot that records writes; `store`/`delete` are omitted when asked. */
const recordingSlot = (
  options: { store?: boolean; delete?: boolean } = {},
): { resolver: CredentialResolver; writes: Array<[string, unknown]> } => {
  const writes: Array<[string, unknown]> = [];
  const resolver: CredentialResolver = {
    resolve: () => undefined,
    ...(options.store === false
      ? {}
      : {
          store: (ref: string, secret: Secret) => void writes.push(["store", { ref, secret }]),
        }),
    ...(options.delete === false
      ? {}
      : {
          delete: (ref: string) => void writes.push(["delete", { ref }]),
        }),
  };
  return { resolver, writes };
};

const load = async (user: PackageInput, options: { slot?: CredentialResolver; secrets?: string[] } = {}): Promise<void> => {
  const slots = createSlotRegistry({ ...createSlotDefaults(), ...(options.slot ? { credentials: options.slot } : {}) });
  await loadPackages({
    inputs: [user],
    bus: createHookBus({}),
    slots,
    kernelVersion: "0.12.1",
    ...(options.secrets ? { secrets: options.secrets } : {}),
  } as never);
};

describe("package credential writes", () => {
  it("credentials_store_requires_capability", async () => {
    const { resolver, writes } = recordingSlot();
    let without: PackageAPI["credentials"] | undefined;
    await load(
      pkg("@acme/read-only", ({ credentials }: PackageAPI) => void (without = credentials), {
        capabilities: ["credentials"],
      }),
      { slot: resolver },
    );
    assert.equal(without?.store, undefined);
    assert.equal(without?.delete, undefined);
    assert.deepEqual(writes, []);

    let withWrite: PackageAPI["credentials"] | undefined;
    await load(
      pkg(
        "@acme/writer",
        async ({ credentials }: PackageAPI) => {
          withWrite = credentials;
          await credentials.store?.("keyring:acme", { type: "bearer", value: "access" });
        },
        { capabilities: ["credentials", "credentials:write"] },
      ),
      { slot: resolver },
    );
    assert.equal(typeof withWrite?.store, "function");
    assert.equal(typeof withWrite?.delete, "function");
    assert.deepEqual(writes, [["store", { ref: "keyring:acme", secret: { type: "bearer", value: "access" } }]]);
  });

  it("credentials_store_rejects_env_ref", async () => {
    const { resolver, writes } = recordingSlot();
    let caught: unknown;
    await load(
      pkg(
        "@acme/env-writer",
        async ({ credentials }: PackageAPI) => {
          try {
            await credentials.store?.("env:OPENAI_API_KEY", { type: "api_key", value: "literal" });
          } catch (error) {
            caught = error;
          }
        },
        { capabilities: ["credentials", "credentials:write"] },
      ),
      { slot: resolver },
    );
    assert.ok(caught instanceof CredentialRefNotWritableError);
    assert.equal((caught as CredentialRefNotWritableError).code, "credential_ref_unsupported");
    // The slot is never asked, so a policy violation cannot be half-applied.
    assert.deepEqual(writes, []);
    // The message names the ref, never the value.
    assert.equal((caught as Error).message.includes("literal"), false);
  });

  it("credentials_store_fails_closed_without_slot_store", async () => {
    // The default resolver reads `env:` only: it declares no `store` and no `delete`.
    const defaults = createEnvRefCredentialResolver({});
    assert.equal(defaults.store, undefined);
    const errors: unknown[] = [];
    await load(
      pkg(
        "@acme/no-store",
        async ({ credentials }: PackageAPI) => {
          for (const ref of ["keyring:acme"]) {
            try {
              await credentials.store?.(ref, { type: "api_key", value: "x" });
            } catch (error) {
              errors.push(error);
            }
            try {
              await credentials.delete?.(ref);
            } catch (error) {
              errors.push(error);
            }
          }
        },
        { capabilities: ["credentials", "credentials:write"] },
      ),
    );
    assert.equal(errors.length, 2);
    for (const error of errors) {
      assert.ok(error instanceof CredentialStoreUnavailableError);
      assert.equal((error as CredentialStoreUnavailableError).code, "credential_store_unavailable");
    }
  });

  it("credentials_store_value_is_redacted", async () => {
    const secrets: string[] = [];
    const { resolver } = recordingSlot();
    await load(
      pkg(
        "@acme/stores",
        async ({ credentials }: PackageAPI) => {
          await credentials.store?.("keyring:acme", { type: "bearer", value: CANARY });
          // A later read of the same ref is redacted by the same set.
          await credentials.resolve("keyring:acme");
        },
        { capabilities: ["credentials", "credentials:write"] },
      ),
      { slot: resolver, secrets },
    );
    // The written value joins the agent's secret set immediately, so every consumer (bus events,
    // notes, errors, inspect()) masks it from then on.
    assert.deepEqual(secrets, [CANARY]);
  });

  it("credentials_delete_passthrough", async () => {
    const { resolver, writes } = recordingSlot({ store: false });
    await load(
      pkg(
        "@acme/deletes",
        async ({ credentials }: PackageAPI) => {
          await credentials.delete?.("keyring:acme");
        },
        { capabilities: ["credentials", "credentials:write"] },
      ),
      { slot: resolver },
    );
    assert.deepEqual(writes, [["delete", { ref: "keyring:acme" }]]);
  });
});
