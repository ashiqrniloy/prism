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

function keyFor(identity: AgentIdentity) {
  return {
    tenantId: identity.tenantId,
    userId: identity.userId,
    principalId: identity.principal.id,
    provider: "openai",
    model: "gpt",
  };
}

describe("../index.js", () => {
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
    assert.equal(resolveModelRouterLimits().maxRateKeys, 4_096);
    assert.equal(resolveModelRouterLimits().maxBudgetKeys, 4_096);
    assert.throws(() => resolveModelRouterLimits({ maxRateKeys: 65_536 + 1 }));
    assert.throws(() => resolveModelRouterLimits({ maxBudgetKeys: 65_536 + 1 }));
    assert.throws(() => createModelRouter({ resolver: () => provider("ok"), budgets: { reservationTtlMs: 31 * 24 * 60 * 60_000 + 1 } }));
  });

  it("reserves budget atomically: parallel admissions never oversubscribe and remaining is never negative", async () => {
    const state = createMemoryModelRouterStateStore();
    const key = {
      tenantId: identity.tenantId,
      userId: identity.userId,
      principalId: identity.principal.id,
      provider: "openai",
      model: "gpt",
    };
    const maxTokens = 1_000;
    const requests = Array.from({ length: 8 }, () =>
      state.reserveBudget({ key, tokens: maxTokens / 8 + 1, maxTokens, windowMs: 60_000, reservationTtlMs: 60_000, now: 0 }),
    );
    const results = await Promise.all(requests);
    assert.equal(results.filter((result) => result.admitted).length, 7);
    assert.equal(results.filter((result) => !result.admitted).length, 1);
    assert.ok(results.find((result) => !result.admitted)?.retryAfterMs !== undefined);
    // A follow-up reserve that exceeds remaining capacity must deny while all 7 reservations hold capacity.
    const after = await state.reserveBudget({ key, tokens: 200, maxTokens, windowMs: 60_000, reservationTtlMs: 60_000, now: 0 });
    assert.equal(after.admitted, false);
    const used = await state.readBudget({ key, windowMs: 60_000, now: 0 });
    assert.equal(used.tokens, 0);
  });

  it("does not oversubscribe under 16 and 32 parallel reservations", async () => {
    const identityKey = {
      tenantId: identity.tenantId,
      userId: identity.userId,
      principalId: identity.principal.id,
      provider: "openai",
    };
    for (const workers of [16, 32]) {
      const state = createMemoryModelRouterStateStore();
      const key = { ...identityKey, model: `gpt-${workers}` };
      const results = await Promise.all(
        Array.from({ length: workers }, () =>
          state.reserveBudget({
            key,
            tokens: 26,
            maxTokens: 100,
            windowMs: 60_000,
            reservationTtlMs: 60_000,
            now: 0,
          }),
        ),
      );
      assert.equal(results.filter((result) => result.admitted).length, 3, `${workers} workers must admit 3`);
      assert.equal(results.filter((result) => !result.admitted).length, workers - 3);
      assert.ok(results.find((result) => !result.admitted)?.retryAfterMs !== undefined);
      const used = await state.readBudget({ key, windowMs: 60_000, now: 0 });
      assert.equal(used.tokens, 0);
    }
  });

  it("commits actual deltas, releases remainders, and rejects stale fencing", async () => {
    const state = createMemoryModelRouterStateStore();
    const key = {
      tenantId: identity.tenantId,
      userId: identity.userId,
      principalId: identity.principal.id,
      provider: "openai",
      model: "gpt",
    };
    const first = await state.reserveBudget({ key, tokens: 100, maxTokens: 200, windowMs: 60_000, reservationTtlMs: 60_000, now: 0 });
    const second = await state.reserveBudget({ key, tokens: 100, maxTokens: 200, windowMs: 60_000, reservationTtlMs: 60_000, now: 0 });
    assert.ok(first.admitted && second.admitted);
    // Actual (40) < reserved (100): the 60-token remainder is released back.
    const committed = await state.commitBudget({
      key,
      reservationId: first.reservationId!,
      fencingToken: first.fencingToken!,
      tokens: 40,
      windowMs: 60_000,
      now: 1_000,
    });
    assert.equal(committed.unknownUsage, false);
    // Stale/foreign fencing on the still-held reservation is rejected.
    await assert.rejects(
      () =>
        state.commitBudget({
          key,
          reservationId: second.reservationId!,
          fencingToken: "foreign",
          tokens: 1,
          windowMs: 60_000,
          now: 1_000,
        }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_STATE",
    );
    // A release after commit is not found and fails loud.
    await assert.rejects(
      () =>
        state.releaseBudget({
          key,
          reservationId: first.reservationId!,
          fencingToken: first.fencingToken!,
          windowMs: 60_000,
          now: 1_000,
        }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_STATE",
    );
    await state.releaseBudget({
      key,
      reservationId: second.reservationId!,
      fencingToken: second.fencingToken!,
      windowMs: 60_000,
      now: 1_000,
    });
    // Window total reflects actuals only: 40 committed, 100 released.
    assert.deepEqual(await state.readBudget({ key, windowMs: 60_000, now: 1_000 }), { tokens: 40, costUsd: 0 });
    const again = await state.reserveBudget({ key, tokens: 100, maxTokens: 200, windowMs: 60_000, reservationTtlMs: 60_000, now: 1_000 });
    assert.equal(again.admitted, true);
  });

  it("releases expired reservations and reconciles a late commit as unknown usage", async () => {
    const state = createMemoryModelRouterStateStore();
    const key = {
      tenantId: identity.tenantId,
      userId: identity.userId,
      principalId: identity.principal.id,
      provider: "openai",
      model: "gpt",
    };
    const reserved = await state.reserveBudget({ key, tokens: 100, maxTokens: 200, windowMs: 60_000, reservationTtlMs: 10, now: 0 });
    assert.ok(reserved.admitted);
    // TTL (10ms) elapsed: capacity is free for a new admission.
    const afterExpiry = await state.reserveBudget({ key, tokens: 100, maxTokens: 200, windowMs: 60_000, reservationTtlMs: 10, now: 20 });
    assert.equal(afterExpiry.admitted, true);
    // The late commit charges the reserved amount (100) and reports unknown usage.
    const late = await state.commitBudget({
      key,
      reservationId: reserved.reservationId!,
      fencingToken: reserved.fencingToken!,
      tokens: 30,
      windowMs: 60_000,
      now: 20,
    });
    assert.equal(late.unknownUsage, true);
    assert.deepEqual(await state.readBudget({ key, windowMs: 60_000, now: 20 }), { tokens: 100, costUsd: 0 });
    // Releasing the still-held (not yet expired) reservation is a plain release, no charge.
    await state.releaseBudget({
      key,
      reservationId: afterExpiry.reservationId!,
      fencingToken: afterExpiry.fencingToken!,
      windowMs: 60_000,
      now: 30,
    });
    const second = await state.reserveBudget({ key, tokens: 50, maxTokens: 200, windowMs: 60_000, reservationTtlMs: 10, now: 30 });
    assert.equal(second.admitted, true);
    assert.deepEqual(await state.readBudget({ key, windowMs: 60_000, now: 30 }), { tokens: 100, costUsd: 0 });
  });

  it("caps and LRU-evicts rate/budget maps without dropping a held reservation's row", async () => {
    const state = createMemoryModelRouterStateStore();
    const base = {
      tenantId: identity.tenantId,
      userId: identity.userId,
      principalId: identity.principal.id,
      provider: "openai",
    };
    const key = (modelId: string, windowMs: number) => ({ ...base, model: modelId, windowMs });
    // maxRateKeys: the oldest (first-inserted) key is evicted on the next new key.
    await state.consumeRate({ key: key("m1", 1), maxRequests: 1, windowMs: 1, maxRateKeys: 2, now: 0 });
    await state.consumeRate({ key: key("m2", 1), maxRequests: 1, windowMs: 1, maxRateKeys: 2, now: 1 });
    await state.consumeRate({ key: key("m3", 1), maxRequests: 1, windowMs: 1, maxRateKeys: 2, now: 2 });
    // m1 was evicted: its window restarts fresh.
    assert.equal((await state.consumeRate({ key: key("m1", 1), maxRequests: 1, windowMs: 1, maxRateKeys: 2, now: 3 })).admitted, true);
    // maxBudgetKeys with a held reservation: the held row is pinned, the LRU non-held row is evicted.
    const held = await state.reserveBudget({
      key: key("m1", 2),
      tokens: 1,
      maxTokens: 10,
      windowMs: 2,
      reservationTtlMs: 60_000,
      maxBudgetKeys: 2,
      now: 0,
    });
    assert.ok(held.admitted);
    await state.addUsage({ key: key("m2", 2), tokens: 1, windowMs: 2, maxBudgetKeys: 2, now: 1 });
    // m1's row is held (pinned); inserting m3 must evict m2 (the only non-held row).
    const third = await state.reserveBudget({
      key: key("m3", 2),
      tokens: 1,
      maxTokens: 10,
      windowMs: 2,
      reservationTtlMs: 60_000,
      maxBudgetKeys: 2,
      now: 2,
    });
    assert.ok(third.admitted);
    // The held reservation still commits against its pinned row.
    assert.equal(
      (
        await state.commitBudget({
          key: key("m1", 2),
          reservationId: held.reservationId!,
          fencingToken: held.fencingToken!,
          tokens: 1,
          windowMs: 2,
          now: 1,
        })
      ).unknownUsage,
      false,
    );
    // Rows: m1 (non-held after commit), m3 (held). Inserting m4 evicts the LRU non-held row m1.
    const fourth = await state.reserveBudget({
      key: key("m4", 2),
      tokens: 1,
      maxTokens: 10,
      windowMs: 2,
      reservationTtlMs: 60_000,
      maxBudgetKeys: 2,
      now: 4,
    });
    assert.ok(fourth.admitted);
    // All rows held (m3 and m4 reserve with long TTLs): capacity exhausted fails closed.
    await assert.rejects(
      () =>
        state.reserveBudget({
          key: key("m5", 2),
          tokens: 1,
          maxTokens: 10,
          windowMs: 2,
          reservationTtlMs: 60_000,
          maxBudgetKeys: 2,
          now: 5,
        }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_STATE",
    );
  });

  it("routes reservations through resolve/recordUsage and releases on internal denial", async () => {
    const clock = { t: 1_000 };
    const seen: unknown[] = [];
    const state = createMemoryModelRouterStateStore();
    const router = createModelRouter({
      resolver: () => provider("openai"),
      stateStore: state,
      budgets: { maxTokens: 100 },
      now: () => clock.t,
      onDiagnostics: (diagnostics) => {
        seen.push(diagnostics);
      },
    });
    // Resolve with a per-request cap reserves it and returns the handle.
    const resolved = await router.resolve({ model: model("openai", "gpt"), identity, maxTokens: 100 });
    assert.ok(resolved.budgetReservation?.reservationId);
    // A second admission cannot reserve: capacity is pinned by the first.
    await assert.rejects(
      () => router.resolve({ model: model("openai", "gpt"), identity, maxTokens: 100 }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_BUDGET",
    );
    // Commit actuals; the window reflects only the actual 40 tokens (remainder released).
    await router.recordUsage({
      identity,
      provider: "openai",
      model: "gpt",
      tokens: 40,
      budgetReservation: resolved.budgetReservation!,
    });
    assert.equal((await state.readBudget({ key: keyFor(identity), windowMs: 24 * 60 * 60_000, now: clock.t })).tokens, 40);
    // Second admission reserves the remaining 60.
    const second = await router.resolve({ model: model("openai", "gpt"), identity, maxTokens: 60 });
    assert.ok(second.budgetReservation);
    // Commit past the default 60s TTL charges the reserved amount + one redacted unknown_usage diagnostic.
    clock.t += 61_000;
    await router.recordUsage({
      identity,
      provider: "openai",
      model: "gpt",
      tokens: 10,
      budgetReservation: second.budgetReservation!,
    });
    assert.equal(
      seen.filter((entry) => typeof entry === "object" && entry !== null && (entry as { reason?: string }).reason === "unknown_usage")
        .length,
      1,
    );
    assert.equal(
      seen.some((entry) => JSON.stringify(entry).includes("sk-")),
      false,
    );
    assert.equal((await state.readBudget({ key: keyFor(identity), windowMs: 24 * 60 * 60_000, now: clock.t })).tokens, 40 + 60);
    // Internal denial (rate limit) releases the reservation: capacity frees immediately.
    const rateState = createMemoryModelRouterStateStore();
    const rateRouter = createModelRouter({
      resolver: () => provider("openai"),
      stateStore: rateState,
      budgets: { maxTokens: 200 },
      rateLimit: { maxRequests: 1, windowMs: 60_000 },
      now: () => clock.t,
    });
    await rateRouter.resolve({ model: model("openai", "gpt"), identity, maxTokens: 100 });
    await assert.rejects(
      () => rateRouter.resolve({ model: model("openai", "gpt"), identity, maxTokens: 100 }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_RATE_LIMIT",
    );
    // The rate-denied attempt reserved 100 then released it: only the first 100 remain pinned.
    const probe = await rateState.reserveBudget({
      key: keyFor(identity),
      tokens: 101,
      maxTokens: 200,
      windowMs: 24 * 60 * 60_000,
      reservationTtlMs: 60_000,
      now: clock.t,
    });
    assert.equal(probe.admitted, false);
    const fits = await rateState.reserveBudget({
      key: keyFor(identity),
      tokens: 100,
      maxTokens: 200,
      windowMs: 24 * 60 * 60_000,
      reservationTtlMs: 60_000,
      now: clock.t,
    });
    assert.equal(fits.admitted, true);
    await rateState.releaseBudget({
      key: keyFor(identity),
      reservationId: fits.reservationId!,
      fencingToken: fits.fencingToken!,
      windowMs: 24 * 60 * 60_000,
      now: clock.t,
    });
  });
});
