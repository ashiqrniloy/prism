import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMockProvider, createProviderRegistry, createProviderResolver, providerDone, type ProviderResolver } from "../index.js";

describe("createProviderResolver", () => {
  it("resolves by model.provider from a ProviderRegistry source", () => {
    const own = createMockProvider([providerDone()], { id: "own" });
    const resolver = createProviderResolver(createProviderRegistry([own]));

    assert.equal(resolver({ provider: "own", model: "x" }), own);
  });

  it("resolves by model.provider from an AIProvider[] source", () => {
    const a = createMockProvider([providerDone()], { id: "a" });
    const b = createMockProvider([providerDone()], { id: "b" });
    const resolver = createProviderResolver([a, b]);

    assert.equal(resolver({ provider: "a", model: "x" }), a);
    assert.equal(resolver({ provider: "b", model: "x" }), b);
  });

  it("returns undefined for an unknown provider (does not throw)", () => {
    const resolver = createProviderResolver([]);

    assert.equal(resolver({ provider: "missing", model: "x" }), undefined);
  });

  it("array source keeps the last provider for duplicate ids", () => {
    const first = createMockProvider([providerDone()], { id: "dup" });
    const last = createMockProvider([providerDone()], { id: "dup" });
    const resolver = createProviderResolver([first, last]);

    assert.equal(resolver({ provider: "dup", model: "x" }), last);
  });

  it("custom ProviderResolver function is callable and returns undefined for misses", () => {
    const own = createMockProvider([providerDone()], { id: "fn" });
    const map = new Map([[own.id, own]]);
    const resolver: ProviderResolver = (model) => map.get(model.provider);

    assert.equal(resolver({ provider: "fn", model: "x" }), own);
    assert.equal(resolver({ provider: "nope", model: "x" }), undefined);
  });

  it("registry source and array source behave identically for a known id", () => {
    const own = createMockProvider([providerDone()], { id: "same" });
    const byRegistry = createProviderResolver(createProviderRegistry([own]));
    const byArray = createProviderResolver([own]);
    const model = { provider: "same", model: "x" };

    assert.equal(byRegistry(model), byArray(model));
  });
});
