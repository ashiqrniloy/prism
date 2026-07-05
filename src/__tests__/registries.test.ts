import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createModelRegistry, createProviderRegistry } from "../index.js";
import type { AIProvider, ModelRegistry, ProviderRegistry } from "../index.js";

const provider: AIProvider = {
  id: "mock",
  async *generate() {
    yield { type: "done" };
  },
};

describe("provider registry", () => {
  it("registers gets lists and resolves providers", () => {
    const registry: ProviderRegistry = createProviderRegistry();

    registry.register(provider);

    assert.equal(registry.get("mock"), provider);
    assert.deepEqual(registry.list(), [provider]);
    assert.equal(registry.resolve({ provider: "mock" }), provider);
    assert.equal(registry.resolve("mock"), provider);
  });

  it("hosts can select providers with explicit registries", () => {
    const providers = createProviderRegistry([provider]);
    const models = createModelRegistry([{ provider: "mock", model: "demo" }]);
    const model = models.resolve("mock", "demo");

    assert.equal(providers.resolve(model), provider);
  });

  it("replaces duplicate providers by default", () => {
    const replacement: AIProvider = { ...provider, generate: async function* () { yield { type: "done" }; } };
    const registry = createProviderRegistry([provider, replacement]);

    assert.equal(registry.resolve("mock"), replacement);
    assert.deepEqual(registry.list(), [replacement]);
  });

  it("strict mode rejects duplicate providers", () => {
    assert.throws(() => createProviderRegistry([provider, provider], { duplicate: "error" }), /Duplicate provider: mock/);
    const registry = createProviderRegistry([provider], { duplicate: "error" });

    assert.throws(() => registry.register(provider), /Duplicate provider: mock/);
  });

  it("unknown provider fails before generate", async () => {
    let called = false;
    const registry = createProviderRegistry([
      {
        id: "known",
        async *generate() {
          called = true;
          yield { type: "done" };
        },
      },
    ]);

    assert.throws(() => registry.resolve({ provider: "missing" }), /Unknown provider: missing/);
    assert.equal(called, false);
  });
});

describe("model registry", () => {
  it("registers gets lists and resolves models", () => {
    const model = { provider: "mock", model: "demo", parameters: { temperature: 0 } };
    const registry: ModelRegistry = createModelRegistry();

    registry.register(model);

    assert.equal(registry.get("mock", "demo"), model);
    assert.deepEqual(registry.list(), [model]);
    assert.equal(registry.resolve("mock", "demo"), model);
  });

  it("replaces duplicate models by default", () => {
    const first = { provider: "mock", model: "demo", parameters: { temperature: 0 } };
    const second = { provider: "mock", model: "demo", parameters: { temperature: 1 } };
    const registry = createModelRegistry([first, second]);

    assert.equal(registry.resolve("mock", "demo"), second);
    assert.deepEqual(registry.list(), [second]);
  });

  it("strict mode rejects duplicate models", () => {
    const model = { provider: "mock", model: "demo" };

    assert.throws(() => createModelRegistry([model, model], { duplicate: "error" }), /Duplicate model: mock\/demo/);
    const registry = createModelRegistry([model], { duplicate: "error" });

    assert.throws(() => registry.register(model), /Duplicate model: mock\/demo/);
  });

  it("unknown model fails before provider call", () => {
    let called = false;
    const registry = createModelRegistry([{ provider: "mock", model: "demo" }]);
    const providerWithCallFlag: AIProvider = {
      id: "mock",
      async *generate() {
        called = true;
        yield { type: "done" };
      },
    };

    assert.throws(() => registry.resolve("mock", "missing"), /Unknown model: mock\/missing/);
    assert.equal(providerWithCallFlag.id, "mock");
    assert.equal(called, false);
  });
});
