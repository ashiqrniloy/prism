import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  createAgent,
  type ModelProvider,
  ModelRefError,
  parseModelRef,
  providerDone,
  providerTextDelta,
  type ProviderRequest,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";

const LITERAL = "sk-live-0123456789abcdef";

function recorder(id: string, seen: ProviderRequest[] = []): ModelProvider & { seen: ProviderRequest[] } {
  return {
    id,
    seen,
    async *generate(request) {
      seen.push(request);
      yield providerTextDelta("ok");
      yield providerDone();
    },
  };
}

describe("ModelRef", () => {
  it("model_ref_string_splits_on_first_slash", () => {
    assert.deepEqual(parseModelRef("openrouter/anthropic/claude-sonnet-4-5"), {
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4-5",
    });
  });

  it("model_ref_object_keeps_limits_and_capabilities", () => {
    const spec = {
      provider: "openai-compatible",
      model: "llama",
      baseUrl: "http://localhost:8080/v1",
      credential: "env:LOCAL_KEY",
      limits: { contextWindow: 8192 },
      capabilities: { tools: true },
      options: { seed: 1 },
    } as const;
    assert.deepEqual(parseModelRef(spec), spec);
  });

  it("model_ref_rejects_empty_parts_and_literal_credential", () => {
    for (const bad of [
      "",
      "mock",
      "/m",
      "p/",
      " /m",
      { provider: "", model: "m" },
      { provider: 1, model: "m" },
      { provider: "p", model: "" },
      null,
      3,
    ]) {
      assert.throws(
        () => parseModelRef(bad as never),
        (e) => e instanceof ModelRefError && e.code === "model_ref_invalid",
        String(JSON.stringify(bad)),
      );
    }
    assert.throws(() => parseModelRef({ provider: "p", model: "m", credential: LITERAL }), ModelRefError);
    assert.throws(() => parseModelRef({ provider: "p", model: "m", baseUrl: "" }), ModelRefError);
  });

  it("literal_credential_never_appears_in_error", async () => {
    let message = "";
    try {
      parseModelRef({ provider: "p", model: "m", credential: LITERAL });
    } catch (error) {
      message = String(error instanceof Error ? error.message : error);
    }
    assert.ok(message.length > 0);
    assert.equal(message.includes(LITERAL), false);
    await assert.rejects(
      createAgent({ model: { provider: "p", model: "m", credential: LITERAL } }),
      (e: Error) => e instanceof ModelRefError && !e.message.includes(LITERAL),
    );
  });

  it("run_options_model_accepts_string_ref", async () => {
    const mock = recorder("mock");
    const other = recorder("other");
    const agent = await createAgent({
      model: "mock/demo",
      packages: [providerPackage("test-provider", [{ id: "mock", generate: (r) => mock.generate(r) }])],
    });
    assert.equal(agent.config.model?.provider, "mock");
    const session = await agent.session();
    // Fixed provider still wins until Task 5 retires it; the parsed model reaches the request either way.
    await session.run("hi", { model: "mock/other-model" });
    assert.equal(mock.seen[0]?.model.model, "other-model");
    assert.equal(other.seen.length, 0);
    await assert.rejects(session.run("hi", { model: "no-slash" }), ModelRefError);
  });

  it("model_provider_type_has_exactly_the_documented_members", () => {
    const provider: ModelProvider = {
      id: "p",
      auth: [
        { kind: "api-key", ref: "env:K" },
        { kind: "oauth", id: "o", login: async () => {} },
      ],
      async *generate() {},
      async models() {
        return [];
      },
    };
    const members: Record<keyof ModelProvider, true> = {
      id: true,
      auth: true,
      generate: true,
      models: true,
      embeddings: true,
      decisions: true,
    };
    assert.deepEqual(Object.keys(members).sort(), ["auth", "decisions", "embeddings", "generate", "id", "models"]);
    assert.equal(provider.auth?.length, 2);
  });
});
