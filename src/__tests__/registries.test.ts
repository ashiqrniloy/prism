import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createModelRegistry, createProviderRegistry } from "../index.js";
import type { AIProvider } from "../index.js";

const provider: AIProvider = {
  id: "mock",
  async *generate() {
    yield { type: "done" };
  },
};

describe("provider registry", () => {
  it("registers gets lists and resolves providers", () => {
    const registry = createProviderRegistry();

    registry.register(provider);

    assert.equal(registry.get("mock"), provider);
    assert.deepEqual(registry.list(), [provider]);
    assert.equal(registry.resolve({ provider: "mock" }), provider);
    assert.equal(registry.resolve("mock"), provider);
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
    const registry = createModelRegistry();

    registry.register(model);

    assert.equal(registry.get("mock", "demo"), model);
    assert.deepEqual(registry.list(), [model]);
    assert.equal(registry.resolve("mock", "demo"), model);
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
