import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgentWith } from "../agent-session/create-agent.js";
import { createHookBus } from "../hooks/index.js";
import {
  type AgentConfig,
  type AgentEvent,
  type CredentialResolver,
  createEnvRefCredentialResolver,
  createSlotDefaults,
  createSlotRegistry,
  definePackage,
  type PackageInput,
  type Secret,
} from "../index.js";
import { loadPackages } from "../packages/loader.js";
import { createScriptedHostUi } from "../testing/host-ui.js";

const CANARY = "sk-live-canary-credentials-slot";

const pkg = (name: string, setup: (api: any) => void, extra: Record<string, unknown> = {}): PackageInput =>
  definePackage<any>({ name, version: "1.0.0", requires: { api: 1 }, setup, ...extra }) as PackageInput;

describe("credentials slot", () => {
  it("env_default_resolves_env_refs_only", async () => {
    const resolver = createEnvRefCredentialResolver({ PRISM_TEST_KEY: "s3cret" });
    assert.deepEqual(await resolver.resolve("env:PRISM_TEST_KEY", {}), {
      type: "api_key",
      value: "s3cret",
      metadata: { source: "env", envName: "PRISM_TEST_KEY" },
    });
    assert.equal(await resolver.resolve("keyring:anything", {}), undefined);
    assert.equal(await resolver.resolve("PRISM_TEST_KEY", {}), undefined);
    assert.equal(resolver.store, undefined);
    assert.equal(resolver.delete, undefined);
  });

  it("keyring_ref_under_default_resolves_undefined_and_package_fails_closed", async () => {
    const bus = createHookBus({});
    const slots = createSlotRegistry(createSlotDefaults());
    let seen: Secret | undefined | "unset" = "unset";
    const user = pkg(
      "@acme/keyring-user",
      async ({ credentials }: any) => {
        seen = await credentials.resolve("keyring:acme");
      },
      { capabilities: ["credentials"] },
    );
    await loadPackages({ inputs: [user], bus, slots, kernelVersion: "0.12.1" } as never);
    assert.equal(seen, undefined);
  });

  it("secret_request_without_store_answers_unavailable", async () => {
    const bus = createHookBus({});
    const slots = createSlotRegistry(createSlotDefaults());
    const scripted = createScriptedHostUi({ secret: CANARY });
    let answer: unknown;
    const user = pkg(
      "@acme/asks",
      async ({ host }: any) => {
        answer = await host.ui.request({ kind: "secret", title: "key", ref: "keyring:acme" });
      },
      { capabilities: ["host-ui"] },
    );
    await loadPackages({ inputs: [user], bus, slots, kernelVersion: "0.12.1", host: scripted } as never);
    // The default resolver has no `store`, so the kernel answers `unavailable` and never asks the host.
    assert.deepEqual(answer, { status: "unavailable" });
  });

  it("slot_store_persists_secret", async () => {
    const stored: Array<[string, Secret]> = [];
    const sink: CredentialResolver = {
      resolve: () => undefined,
      store: (ref, secret) => void stored.push([ref, secret]),
    };
    await sink.store?.("keyring:mock-oauth", {
      type: "bearer",
      value: "new-access",
      metadata: { refresh: "refresh-token" },
    }, {});
    assert.equal(stored.length, 1);
    assert.equal(stored[0][0], "keyring:mock-oauth");
    assert.equal(stored[0][1].value, "new-access");
    assert.equal(stored[0][1].metadata?.refresh, "refresh-token");
  });

  it("secret_canary_never_in_events_inspect_entries_or_errors", async () => {
    const events: AgentEvent[] = [];
    const stub = (async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      return new Response(`upstream rejected ${headers.authorization}`, { status: 400 });
    }) as unknown as typeof fetch;
    const createAgent = (config: AgentConfig) => createAgentWith(config, { fetch: stub });
    const agent = await createAgent({
      model: { provider: "openai-compatible", model: "m", baseUrl: "http://one.test/v1", credential: "env:KEY" },
      slots: { credentials: createEnvRefCredentialResolver({ KEY: CANARY }) },
    });
    const session = await agent.session();
    const draining = (async () => {
      for await (const event of session.subscribe()) events.push(event);
    })();
    const result = await session.run("hi");
    await draining;
    assert.equal(result.status, "failed");
    const surfaces = JSON.stringify([result, events, agent.inspect?.() ?? null]);
    assert.equal(surfaces.includes(CANARY), false, "the canary never reaches a surface");
    assert.ok(surfaces.includes("[REDACTED]"), "the echoed header is redacted, not dropped silently");
  });

  it("models_client_canary_never_leaks", async () => {
    const seen: unknown[] = [];
    const stub = (async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      return new Response(`upstream rejected ${headers.authorization}`, { status: 400 });
    }) as unknown as typeof fetch;
    let finished: Promise<void> = Promise.resolve();
    const user = pkg(
      "@acme/side-call",
      ({ models, hooks }: any) => {
        const client = models.client({ provider: "openai-compatible", model: "m", baseUrl: "http://one.test/v1", credential: "env:KEY" });
        hooks.on("session.opened", () => {
          finished = (async () => {
            try {
              for await (const event of client.generate({ messages: [] })) seen.push(event);
            } catch (error) {
              seen.push({ type: "error", error: { message: error instanceof Error ? error.message : String(error) } });
            }
          })();
        });
      },
      { capabilities: ["models"] },
    );
    const agent = await createAgentWith(
      {
        model: { provider: "openai-compatible", model: "m", baseUrl: "http://one.test/v1", credential: "env:KEY" },
        packages: [user],
        slots: { credentials: createEnvRefCredentialResolver({ KEY: CANARY }) },
      },
      { fetch: stub },
    );
    const session = await agent.session();
    await session.run("hi");
    await finished;
    assert.equal(JSON.stringify(seen).includes(CANARY), false);
    assert.ok(JSON.stringify(seen).includes("[REDACTED]"));
  });

  it("credentials_resolve_returns_secret_type", async () => {
    const resolver: CredentialResolver = {
      resolve: (ref) => (ref === "env:X" ? { type: "api_key", value: "v" } : undefined),
    };
    const secret: Secret | undefined = await resolver.resolve("env:X", {});
    assert.equal(secret?.type, "api_key");
    assert.equal(secret?.value, "v");
  });
});
