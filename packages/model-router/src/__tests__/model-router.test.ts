import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentIdentity, AIProvider, ModelConfig, ProviderRequest } from "@arnilo/prism";
import {
  createMemoryModelRouterStateStore,
  createModelRouter,
  HARD_MODEL_ROUTER_LIMITS,
  ModelRouterError,
  resolveModelRouterLimits,
} from "../index.js";

function provider(id: string): AIProvider {
  return {
    id,
    async *generate() {
      /* unused */
    },
  };
}

function model(providerId: string, modelId: string, compat?: ModelConfig["compat"]): ModelConfig {
  return { provider: providerId, model: modelId, ...(compat ? { compat } : {}) };
}

const identity: AgentIdentity = {
  tenantId: "tenant-1",
  userId: "user-1",
  principal: { kind: "agent", id: "agent-1" },
  scopes: ["model:route"],
  issuedAt: new Date().toISOString(),
  verified: true,
};

describe("@arnilo/prism-model-router", () => {
  it("denies allow-list and residency misses before calling resolver", async () => {
    let calls = 0;
    const router = createModelRouter({
      resolver: () => {
        calls += 1;
        return provider("openai");
      },
      allowList: { providers: ["openai"], models: ["gpt-4o"] },
      allowedResidencies: ["eu"],
    });

    await assert.rejects(
      () => router.resolve({ model: model("anthropic", "claude"), residency: "eu" }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_ALLOW_LIST",
    );
    await assert.rejects(
      () => router.resolve({ model: model("openai", "gpt-4o"), residency: "us" }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_RESIDENCY",
    );
    assert.equal(calls, 0);
  });

  it("falls back across outage/circuit and stops at attempt cap", async () => {
    const clock = { t: 1_000 };
    const router = createModelRouter({
      resolver: (m) => (m.provider === "b" ? provider("b") : undefined),
      fallbacks: [model("b", "m2"), model("c", "m3")],
      limits: { maxAttempts: 3 },
      circuit: { failureThreshold: 1, coolDownMs: 60_000 },
      now: () => clock.t,
    });

    await router.recordOutcome({ identity, provider: "a", model: "m1", success: false });
    const result = await router.resolve({ model: model("a", "m1"), identity });
    assert.equal(result.provider.id, "b");
    assert.equal(result.diagnostics.attempts.length, 2);
    assert.equal(result.diagnostics.attempts[0]?.outcome, "circuit_open");
    assert.equal(result.diagnostics.selectedProvider, "b");

    await assert.rejects(
      () =>
        createModelRouter({
          resolver: () => undefined,
          fallbacks: [model("a", "1"), model("b", "2"), model("c", "3"), model("d", "4")],
          limits: { maxAttempts: 3 },
        }).resolve({ model: model("z", "0") }),
      (error: unknown) => error instanceof ModelRouterError && (error.diagnostics?.attempts as unknown[])?.length === 3,
    );
  });

  it("enforces token/cost budgets and rate limits", async () => {
    const router = createModelRouter({
      resolver: () => provider("openai"),
      budgets: { maxTokens: 100, maxCostUsd: 0.5 },
      rateLimit: { maxRequests: 1, windowMs: 1_000 },
      now: () => 5_000,
    });
    await router.resolve({ model: model("openai", "gpt") });
    await assert.rejects(
      () => router.resolve({ model: model("openai", "gpt") }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_RATE_LIMIT",
    );

    const budgetRouter = createModelRouter({
      resolver: () => provider("openai"),
      budgets: { maxTokens: 10 },
    });
    await budgetRouter.recordUsage({ identity, provider: "openai", model: "gpt", tokens: 10 });
    await assert.rejects(
      () => budgetRouter.resolve({ model: model("openai", "gpt"), identity }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_BUDGET",
    );
  });

  it("redacts diagnostics and gates OpenRouter routing metadata", async () => {
    const seen: unknown[] = [];
    const router = createModelRouter({
      resolver: () => provider("openrouter"),
      allowOpenRouterRouting: false,
      onDiagnostics: (d) => {
        seen.push(d);
      },
    });
    const withRouting = model("openrouter", "auto", {
      openRouterRouting: { order: ["anthropic"], data_collection: "deny" },
      secret: "sk-should-not-matter",
    });
    const result = await router.resolve({
      model: withRouting,
      identity: {
        tenantId: "t1",
        userId: "u1",
        principal: { kind: "agent", id: "a1" },
        scopes: ["model:route"],
        issuedAt: new Date().toISOString(),
        verified: true,
      },
    });
    assert.equal(result.diagnostics.openRouterRoutingHonored, false);
    assert.equal(result.model.compat?.openRouterRouting, undefined);
    assert.equal(result.diagnostics.identityRefs?.principalId, "a1");
    assert.ok(!JSON.stringify(result.diagnostics).includes("sk-"));

    const patched = await result.providerRequestPolicy.apply({
      request: {
        model: withRouting,
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        options: { compat: { openRouterRouting: { order: ["openai"] } } },
      } as ProviderRequest,
    });
    const patchedRequest = "request" in patched ? patched.request : patched;
    assert.equal(patchedRequest.options?.compat?.openRouterRouting, undefined);
    assert.equal(seen.length, 1);

    const allowed = createModelRouter({
      resolver: () => provider("openrouter"),
      allowOpenRouterRouting: true,
    });
    const honored = await allowed.resolve({ model: withRouting });
    assert.equal(honored.diagnostics.openRouterRoutingHonored, true);
    assert.deepEqual(honored.model.compat?.openRouterRouting, { order: ["anthropic"], data_collection: "deny" });
  });

  it("enforces durable identity, atomic rate/budget state, and one half-open probe", async () => {
    const state = createMemoryModelRouterStateStore();
    let calls = 0;
    const rateRouter = createModelRouter({
      resolver: () => {
        calls += 1;
        return provider("openai");
      },
      stateStore: state,
      rateLimit: { maxRequests: 1, windowMs: 1_000 },
      budgets: { maxTokens: 10, windowMs: 1_000 },
      now: () => 1_000,
    });
    await assert.rejects(
      () => rateRouter.resolve({ model: model("openai", "gpt") }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_IDENTITY",
    );
    assert.equal(calls, 0);
    assert.throws(
      () => rateRouter.providerSource(model("openai", "gpt")),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_ASYNC_STATE",
    );
    await rateRouter.resolve({ model: model("openai", "gpt"), identity });
    await assert.rejects(
      () => rateRouter.resolve({ model: model("openai", "gpt"), identity }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_RATE_LIMIT",
    );
    await Promise.all([
      rateRouter.recordUsage({ identity, provider: "openai", model: "gpt", tokens: 4 }),
      rateRouter.recordUsage({ identity, provider: "openai", model: "gpt", tokens: 6 }),
    ]);
    await assert.rejects(
      () => rateRouter.resolve({ model: model("openai", "gpt"), identity, maxTokens: 10 }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_BUDGET",
    );

    const clock = { t: 0 };
    const circuitRouter = createModelRouter({
      resolver: () => provider("openai"),
      stateStore: createMemoryModelRouterStateStore(),
      circuit: { failureThreshold: 1, coolDownMs: 10 },
      now: () => clock.t,
    });
    await circuitRouter.recordOutcome({ identity, provider: "openai", model: "gpt", success: false });
    await assert.rejects(() => circuitRouter.resolve({ model: model("openai", "gpt"), identity }), /circuit open/);
    clock.t += 10;
    const probes = await Promise.allSettled([
      circuitRouter.resolve({ model: model("openai", "gpt"), identity }),
      circuitRouter.resolve({ model: model("openai", "gpt"), identity }),
    ]);
    const probe = probes.find(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof circuitRouter.resolve>>> => result.status === "fulfilled",
    );
    assert.ok(probe?.value.circuitProbeToken);
    assert.equal(probes.filter((result) => result.status === "fulfilled").length, 1);
    await circuitRouter.recordOutcome({
      identity,
      provider: "openai",
      model: "gpt",
      success: true,
      circuitProbeToken: probe!.value.circuitProbeToken,
    });
    await circuitRouter.resolve({ model: model("openai", "gpt"), identity });
  });

  it("cleans expired owned state in bounded batches", async () => {
    const state = createMemoryModelRouterStateStore();
    const key = {
      tenantId: identity.tenantId,
      userId: identity.userId,
      principalId: identity.principal.id,
      provider: "openai",
      model: "gpt",
    };
    await state.consumeRate({ key, maxRequests: 1, windowMs: 10, now: 0 });
    assert.deepEqual(await state.cleanup({ owner: key, limit: 1, now: 10 }), { removed: 1 });
  });

  it("never evicts open state and reopens an abandoned probe", async () => {
    const state = createMemoryModelRouterStateStore();
    const key = {
      tenantId: identity.tenantId,
      userId: identity.userId,
      principalId: identity.principal.id,
      provider: "openai",
      model: "gpt",
    };
    await state.recordCircuitOutcome({
      key,
      success: false,
      failureThreshold: 1,
      coolDownMs: 10,
      maxKeys: 1,
      now: 0,
    });
    await assert.rejects(
      () =>
        state.claimCircuitProbe({
          key: { ...key, model: "other" },
          failureThreshold: 1,
          coolDownMs: 10,
          maxKeys: 1,
          now: 0,
        }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_STATE",
    );
    const probe = await state.claimCircuitProbe({ key, failureThreshold: 1, coolDownMs: 10, maxKeys: 1, now: 10 });
    assert.ok(probe.probeToken);
    assert.deepEqual(await state.claimCircuitProbe({ key, failureThreshold: 1, coolDownMs: 10, maxKeys: 1, now: 20 }), { admitted: false });
  });

  it("providerSource facade and frozen limits", () => {
    const router = createModelRouter({
      resolver: (m) => (m.provider === "ok" ? provider("ok") : undefined),
      allowList: { providers: ["ok"] },
    });
    assert.equal(router.providerSource(model("ok", "m"))?.id, "ok");
    assert.throws(() => router.providerSource(model("nope", "m")), /allow-listed/);
    assert.equal(resolveModelRouterLimits().maxAttempts, 3);
    assert.throws(() => resolveModelRouterLimits({ maxAttempts: HARD_MODEL_ROUTER_LIMITS.maxAttempts + 1 }));
    assert.throws(() =>
      createModelRouter({ resolver: () => provider("ok"), rateLimit: { maxRequests: 1, windowMs: 31 * 24 * 60 * 60_000 + 1 } }),
    );
  });
});
