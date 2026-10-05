import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgent, definePackage, type ModelProvider, PackageLoadError, providerDone, providerError, providerTextDelta } from "../index.js";
import { providerPackage } from "../provider-kit/index.js";

function named(id: string, seen: string[]): ModelProvider {
  return {
    id,
    async *generate(request) {
      seen.push(`${id}:${request.model.model}`);
      yield providerTextDelta(id);
      yield providerDone();
    },
  };
}

const provide = (name: string, ...providers: ModelProvider[]) =>
  definePackage<any>({ name, version: "1.0.0", setup: ({ providers: api }: any) => providers.forEach((p) => api.register(p)) });

describe("per-agent provider cache", () => {
  it("run_model_switch_uses_the_runs_provider_not_a_fixed_one", async () => {
    const seen: string[] = [];
    const agent = await createAgent({
      model: "alpha/one",
      packages: [provide("@acme/beta", named("beta", seen)), provide("@acme/gamma", named("gamma", seen)), providerPackage("test-provider", [named("alpha", seen)])],
    });
    const session = await agent.session();
    await session.run("a");
    await session.run("b", { model: "beta/two" });
    await session.run("c", { model: "gamma/three" });
    await session.run("d");
    assert.deepEqual(seen, ["alpha:one", "beta:two", "gamma:three", "alpha:one"]);
  });

  it("package_registering_openai_compatible_fails_closed", async () => {
    const taken = provide("@acme/squatter", { id: "openai-compatible", async *generate() { yield providerDone(); } });
    await assert.rejects(createAgent({ model: "x/y", packages: [taken, providerPackage("test-provider", [named("x", [])])] }), (error) => {
      assert.ok(error instanceof PackageLoadError);
      assert.equal(error.code, "provider_conflict");
      return true;
    });
  });

  it("models_client_retries_with_agent_retry_policy", async () => {
    let calls = 0;
    const flaky: ModelProvider = {
      id: "flaky",
      async *generate() {
        calls += 1;
        if (calls < 3) {
          yield providerError(Object.assign(new Error("rate limited"), { code: "rate_limit" }));
          return;
        }
        yield providerTextDelta("ok");
        yield { type: "done", stopReason: "stop" as never };
      },
    };
    let types: string[] = [];
    let stop: unknown;
    let finished: Promise<void> = Promise.resolve();
    const user = definePackage<any>({
      name: "@acme/client",
      version: "1.0.0",
      capabilities: ["models"],
      setup: ({ models, hooks }: any) => {
        const client = models.client();
        hooks.on("session.opened", () => {
          finished = (async () => {
            for await (const event of client.generate({ messages: [] })) {
              types.push(event.type);
              if (event.type === "done") stop = event.stopReason;
            }
          })();
        });
      },
    });
    const agent = await createAgent({
      model: "flaky/m",
      retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, jitter: 0 } as never,
      packages: [user, providerPackage("test-provider", [flaky])],
    });
    await agent.session();
    await finished;
    assert.equal(calls, 3);
    assert.deepEqual(types, ["content_delta", "done"]);
    assert.equal(stop, "end_turn");
  });
});
