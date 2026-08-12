import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentIdentity, AIProvider, ModelConfig } from "@arnilo/prism";
import { createCostLatencySelection, createModelRouter, ModelRouterError } from "../index.js";

function provider(id: string): AIProvider {
  return {
    id,
    async *generate() {
      /* unused */
    },
  };
}

function model(providerId: string, modelId: string, cost?: ModelConfig["cost"]): ModelConfig {
  return { provider: providerId, model: modelId, ...(cost ? { cost } : {}) };
}

const identity: AgentIdentity = {
  tenantId: "tenant-1",
  userId: "user-1",
  principal: { kind: "agent", id: "agent-1" },
  scopes: ["model:route"],
  issuedAt: new Date().toISOString(),
  verified: true,
};

function routerWith(
  policy: Parameters<typeof createModelRouter>[0]["selection"],
  overrides: Partial<Omit<Parameters<typeof createModelRouter>[0], "selection">> = {},
) {
  const { resolver = (m: ModelConfig) => provider(m.provider), ...rest } = overrides;
  return createModelRouter({
    resolver,
    ...rest,
    ...(policy ? { selection: policy } : {}),
  });
}

describe("cost/latency selection policy", () => {
  it("default unchanged: no selection keeps ordered primary-then-fallbacks with identical diagnostics", async () => {
    const router = routerWith(undefined, { resolver: (m) => (m.provider === "c" ? provider("c") : undefined) });
    const { diagnostics } = await router.resolve({
      model: model("a", "primary"),
      identity,
      fallbacks: [model("b", "f1"), model("c", "f2")],
    });
    assert.equal(diagnostics.outcome, "allow");
    assert.equal(diagnostics.selectedModel, "f2");
    assert.deepEqual(
      diagnostics.attempts.map((a) => [a.model, a.outcome]),
      [
        ["primary", "miss"],
        ["f1", "miss"],
        ["f2", "selected"],
      ],
      "no selection: candidates tried in input order",
    );
    assert.equal(diagnostics.selection, undefined, "no selection name recorded");
  });

  it("cost ordering: cheaper candidate selected first, cost units normalized", async () => {
    const expensive = model("a", "big", { input: 10, output: 10, cacheRead: 5 });
    const cheap = model("b", "small", { input: 1, output: 1, cacheRead: 0.5 });
    const router = routerWith(createCostLatencySelection());
    const { diagnostics } = await router.resolve({ model: expensive, identity, fallbacks: [cheap] });
    assert.equal(diagnostics.selectedModel, "small", "cheaper unit price wins");
    assert.deepEqual(
      diagnostics.attempts.map((a) => a.model),
      ["small"],
      "policy order is walked first: the cheap fallback is tried before the expensive primary",
    );

    // per_million_tokens divisor: 3e-6 < 2 per-token
    const perMillion = model("a", "pm", { input: 3, unit: "per_million_tokens" });
    const perToken = model("b", "pt", { input: 2 });
    const second = await routerWith(createCostLatencySelection()).resolve({
      model: perToken,
      identity,
      fallbacks: [perMillion],
    });
    assert.equal(second.diagnostics.selectedModel, "pm");
  });

  it("walk order: a policy-ordered candidate that misses yields to the next in policy order", async () => {
    const expensive = model("a", "big", { input: 10 });
    const cheap = model("b", "small", { input: 1 });
    const router = routerWith(createCostLatencySelection(), { resolver: (m) => (m.provider === "b" ? undefined : provider(m.provider)) });
    const { diagnostics } = await router.resolve({ model: expensive, identity, fallbacks: [cheap] });
    assert.equal(diagnostics.selectedModel, "big", "cheap candidate misses, policy order walks to the next");
    assert.deepEqual(
      diagnostics.attempts.map((a) => [a.model, a.outcome]),
      [
        ["small", "miss"],
        ["big", "selected"],
      ],
    );
  });

  it("unknown costs rank after priced models, preserving relative input order", async () => {
    const unpricedPrimary = model("a", "free1");
    const unpricedFallback = model("b", "free2");
    const priced = model("c", "cheap", { input: 1 });
    const router = routerWith(createCostLatencySelection());
    const { diagnostics } = await router.resolve({
      model: unpricedPrimary,
      identity,
      fallbacks: [priced, unpricedFallback],
    });
    assert.equal(diagnostics.selectedModel, "cheap");
    // invalid cost metadata (NaN) is treated as unknown, never NaN-compared
    const nanCost = model("a", "nan", { input: Number.NaN });
    const second = await routerWith(createCostLatencySelection()).resolve({ model: nanCost, identity, fallbacks: [priced] });
    assert.equal(second.diagnostics.selectedModel, "cheap");
  });

  it("latency EMA: after recorded outcomes the faster candidate wins ties; cold start is pure cost order", async () => {
    const a = model("a", "alpha", { input: 5 });
    const b = model("b", "beta", { input: 5 });
    const router = routerWith(createCostLatencySelection());

    // cold start: equal prices, no samples -> input order (alpha first)
    let resolved = await router.resolve({ model: a, identity, fallbacks: [b] });
    assert.equal(resolved.diagnostics.selectedModel, "alpha");

    // feed latency: beta is much faster
    await router.recordOutcome({ identity, provider: "a", model: "alpha", success: true, latencyMs: 800 });
    await router.recordOutcome({ identity, provider: "b", model: "beta", success: true, latencyMs: 120 });
    resolved = await router.resolve({ model: a, identity, fallbacks: [b] });
    assert.equal(resolved.diagnostics.selectedModel, "beta", "faster candidate breaks the cost tie");

    // EMA smoothing: a single slow sample does not flip an established fast EMA
    await router.recordOutcome({ identity, provider: "b", model: "beta", success: true, latencyMs: 800 });
    resolved = await router.resolve({ model: a, identity, fallbacks: [b] });
    assert.equal(resolved.diagnostics.selectedModel, "beta", "EMA still favors beta (weight 0.5)");
  });

  it("latencyWeight extremes: 0 keeps the first sample, 1 tracks only the latest", async () => {
    const a = model("a", "alpha", { input: 5 });
    const b = model("b", "beta", { input: 5 });
    const sticky = routerWith(createCostLatencySelection({ latencyWeight: 0 }));
    await sticky.recordOutcome({ identity, provider: "a", model: "alpha", success: true, latencyMs: 100 });
    await sticky.recordOutcome({ identity, provider: "b", model: "beta", success: true, latencyMs: 100 });
    await sticky.recordOutcome({ identity, provider: "b", model: "beta", success: true, latencyMs: 999 });
    let resolved = await sticky.resolve({ model: a, identity, fallbacks: [b] });
    assert.equal(resolved.diagnostics.selectedModel, "alpha", "weight 0: beta EMA stuck at first sample 100, tie with alpha");

    const latest = routerWith(createCostLatencySelection({ latencyWeight: 1 }));
    await latest.recordOutcome({ identity, provider: "a", model: "alpha", success: true, latencyMs: 100 });
    await latest.recordOutcome({ identity, provider: "b", model: "beta", success: true, latencyMs: 100 });
    await latest.recordOutcome({ identity, provider: "b", model: "beta", success: true, latencyMs: 999 });
    resolved = await latest.resolve({ model: a, identity, fallbacks: [b] });
    assert.equal(resolved.diagnostics.selectedModel, "alpha", "weight 1: beta EMA tracks 999, alpha wins");
  });

  it("fallback chain: a policy-ordered miss yields to the next candidate; attempts recorded in order", async () => {
    const primary = model("a", "primary", { input: 1 });
    const fallback = model("b", "fallback", { input: 10 });
    const router = routerWith(createCostLatencySelection(), { resolver: (m) => (m.provider === "b" ? provider("b") : undefined) });
    const { diagnostics } = await router.resolve({ model: primary, identity, fallbacks: [fallback] });
    assert.equal(diagnostics.outcome, "allow");
    assert.equal(diagnostics.selectedModel, "fallback");
    assert.deepEqual(
      diagnostics.attempts.map((a) => [a.model, a.outcome]),
      [
        ["primary", "miss"],
        ["fallback", "selected"],
      ],
      "policy order first (cheap primary), then the fallback, in walk order",
    );
    assert.equal(diagnostics.selection, "cost-latency", "policy name recorded in diagnostics");
  });

  it("policy confinement: a non-permutation result fails closed; governance still binds the ranked order", async () => {
    // misbehaving policy: drops a candidate
    const dropping = {
      name: "drop",
      rank: () => [model("b", "only")],
    };
    const router = routerWith(dropping);
    await assert.rejects(
      () => router.resolve({ model: model("a", "primary"), identity, fallbacks: [model("b", "only")] }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_POLICY",
    );

    // misbehaving policy: invents a candidate that was not in the input
    const inventing = {
      name: "invent",
      rank: (candidates: readonly ModelConfig[]) => [candidates[1]!, model("x", "smuggled")],
    };
    const smuggler = routerWith(inventing);
    await assert.rejects(
      () => smuggler.resolve({ model: model("a", "primary"), identity, fallbacks: [model("b", "only")] }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_POLICY",
    );

    // policy reorders but allow-list still binds: a ranked-first non-listed candidate is a terminal deny
    // (0.1.7 semantics: allow-list violations fail closed per request, never walk on to a fallback)
    const ranked = routerWith(createCostLatencySelection(), { allowList: { providers: ["b"] } });
    await assert.rejects(
      () => ranked.resolve({ model: model("a", "cheap", { input: 1 }), identity, fallbacks: [model("b", "expensive", { input: 10 })] }),
      (error: unknown) => {
        assert.ok(error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_ALLOW_LIST");
        assert.equal(error.diagnostics?.attempts[0]?.model, "cheap", "ranked-first non-listed candidate denied first");
        assert.equal(error.diagnostics?.attempts[0]?.reason, "allow_list");
        return true;
      },
    );
  });

  it("recordOutcome latencyMs is validated; invalid values never reach the policy", async () => {
    const a = model("a", "alpha", { input: 5 });
    const b = model("b", "beta", { input: 5 });
    const router = routerWith(createCostLatencySelection());
    await assert.rejects(
      () => router.recordOutcome({ identity, provider: "a", model: "alpha", success: true, latencyMs: -1 }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_LIMITS",
    );
    // a rejected recordOutcome feeds nothing; order stays input order
    const resolved = await router.resolve({ model: a, identity, fallbacks: [b] });
    assert.equal(resolved.diagnostics.selectedModel, "alpha");
  });

  it("selection policy validation happens at construction; malformed policies fail loud", () => {
    assert.throws(
      () => routerWith({ name: "", rank: () => [] }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_VALIDATION",
    );
    assert.throws(
      () => routerWith({ name: "x".repeat(129), rank: () => [] }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_VALIDATION",
    );
    assert.throws(
      () =>
        routerWith({ name: "no-rank", rank: undefined } as unknown as NonNullable<Parameters<typeof createModelRouter>[0]["selection"]>),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_VALIDATION",
    );
    assert.throws(() => createCostLatencySelection({ latencyWeight: 2 }), TypeError);
    assert.throws(() => createCostLatencySelection({ latencyWeight: Number.NaN }), TypeError);
  });

  it("redaction: oversized diagnostics from many candidates truncate via the existing cap", async () => {
    const fallbacks: ModelConfig[] = [];
    for (let i = 0; i < 10; i += 1) fallbacks.push(model("p", `model-with-a-very-long-name-${i}`, { input: 1 }));
    const router = routerWith(createCostLatencySelection(), {
      limits: { maxDiagnosticsBytes: 256 },
      onDiagnostics: (diagnostics) => {
        assert.equal(diagnostics.reason, "diagnostics_truncated", "oversized diagnostics truncate");
        assert.ok(diagnostics.attempts.length <= 3, "attempt list is capped when truncated");
      },
    });
    const result = await router.resolve({ model: model("q", "tiny", { input: 1 }), identity, fallbacks });
    assert.ok(result.diagnostics.attempts.length <= 3);
  });
});
