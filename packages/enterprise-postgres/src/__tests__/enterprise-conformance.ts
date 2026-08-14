import assert from "node:assert/strict";
import type { AgentIdentity } from "@arnilo/prism";
import type { EvaluationStore } from "@arnilo/prism-evals";
import { ModelRouterError, type ModelRouterStateStore } from "@arnilo/prism-model-router";
import type { PolicyDecisionStore } from "@arnilo/prism-policy";
import type { IdempotencyStore } from "@arnilo/prism-work-tools";

export interface EnterpriseConformanceStores {
  readonly policy: PolicyDecisionStore;
  readonly evaluations: EvaluationStore;
  readonly workIdempotency: IdempotencyStore;
  readonly modelRouter: ModelRouterStateStore;
}

function identity(tenantId: string): AgentIdentity {
  return {
    tenantId,
    userId: "user",
    principal: { kind: "agent", id: "agent" },
    scopes: ["model:route", "work:mutate"],
    issuedAt: "2026-08-03T00:00:00.000Z",
    verified: true,
  };
}

/** Shared domain-only behavior used against memory and PostgreSQL stores. */
export async function runEnterpriseStoreConformance(stores: EnterpriseConformanceStores, prefix: string): Promise<void> {
  const own = identity(`${prefix}-tenant`);
  const foreign = identity(`${prefix}-foreign`);
  const policyInput = {
    id: `${prefix}-policy`,
    policyId: "benchmark",
    policyVersion: "1",
    outcome: "allow" as const,
    identity: own,
    target: { kind: "record", id: "one" },
    tenantId: own.tenantId,
    userId: own.userId,
  };
  await stores.policy.append(policyInput);
  assert.equal((await stores.policy.query({ tenantId: own.tenantId, userId: own.userId })).items[0]?.id, policyInput.id);
  assert.equal((await stores.policy.query({ tenantId: foreign.tenantId, userId: foreign.userId })).items.length, 0);
  await assert.rejects(() => stores.policy.append(policyInput));

  const evaluation = {
    id: `${prefix}-evaluation`,
    scorerId: "benchmark",
    status: "scored" as const,
    score: 1,
    sampled: true,
    createdAt: "2026-08-03T00:00:00.000Z",
    tenantId: own.tenantId,
    userId: own.userId,
  };
  await stores.evaluations.append(evaluation);
  assert.equal(
    (await stores.evaluations.query({ tenantId: own.tenantId, userId: own.userId, scorerId: "benchmark" })).items[0]?.id,
    evaluation.id,
  );
  assert.equal((await stores.evaluations.query({ tenantId: foreign.tenantId, userId: foreign.userId })).items.length, 0);
  await assert.rejects(async () => {
    await stores.evaluations.append(evaluation);
  });

  const mutation = { identity: own, key: `${prefix}-mutation`, op: "benchmark.mutate" };
  const claim = await stores.workIdempotency.begin(mutation);
  assert.equal(claim.outcome, "acquired");
  assert.ok(claim.record.claimToken);
  assert.equal((await stores.workIdempotency.begin(mutation)).outcome, "existing");
  await stores.workIdempotency.complete({
    ...mutation,
    claimToken: claim.record.claimToken!,
    expectedVersion: claim.record.version,
    result: { draftId: "draft" },
  });
  assert.equal((await stores.workIdempotency.begin(mutation)).outcome, "existing");
  assert.equal(await stores.workIdempotency.get({ ...mutation, identity: foreign }), undefined);

  const key = { tenantId: own.tenantId, userId: own.userId, principalId: own.principal.id, provider: "benchmark", model: "model" };
  assert.equal((await stores.modelRouter.consumeRate({ key, maxRequests: 1, windowMs: 60_000, now: 0 })).admitted, true);
  assert.equal((await stores.modelRouter.consumeRate({ key, maxRequests: 1, windowMs: 60_000, now: 0 })).admitted, false);
  await stores.modelRouter.addUsage({ key, tokens: 3, costUsd: 0.5, windowMs: 60_000, now: 0 });
  assert.deepEqual(await stores.modelRouter.readBudget({ key, windowMs: 60_000, now: 0 }), { tokens: 3, costUsd: 0.5 });
  await stores.modelRouter.recordCircuitOutcome({ key, success: false, failureThreshold: 1, coolDownMs: 60_000, maxKeys: 16_384, now: 0 });
  assert.deepEqual(await stores.modelRouter.claimCircuitProbe({ key, failureThreshold: 1, coolDownMs: 60_000, maxKeys: 16_384, now: 0 }), {
    admitted: false,
  });

  // Reservation agreement: parallel admissions never oversubscribe; commit/release
  // reconcile actuals; stale fencing is rejected; TTL expiry charges the reserved
  // amount as unknown usage. Same probe runs against memory and durable stores.
  const reservationKey = { ...key, model: "reserved" };
  const parallel = await Promise.all(
    Array.from({ length: 4 }, () =>
      stores.modelRouter.reserveBudget({
        key: reservationKey,
        tokens: 26,
        maxTokens: 100,
        windowMs: 60_000,
        reservationTtlMs: 60_000,
        now: 0,
      }),
    ),
  );
  assert.equal(parallel.filter((result) => result.admitted).length, 3);
  assert.equal(parallel.filter((result) => !result.admitted).length, 1);
  assert.ok(parallel.find((result) => !result.admitted)?.retryAfterMs !== undefined);
  const admitted = parallel.filter((result) => result.admitted);
  // Stale/foreign fencing on a held reservation is rejected.
  await assert.rejects(
    () =>
      stores.modelRouter.commitBudget({
        key: reservationKey,
        reservationId: admitted[2]!.reservationId!,
        fencingToken: "stale",
        tokens: 1,
        windowMs: 60_000,
        now: 1_000,
      }),
    (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_STATE",
  );
  // Actual (10) < reserved (26): remainder released; window total reflects actuals only.
  const committed = await stores.modelRouter.commitBudget({
    key: reservationKey,
    reservationId: admitted[0]!.reservationId!,
    fencingToken: admitted[0]!.fencingToken!,
    tokens: 10,
    windowMs: 60_000,
    now: 1_000,
  });
  assert.equal(committed.unknownUsage, false);
  await stores.modelRouter.releaseBudget({
    key: reservationKey,
    reservationId: admitted[1]!.reservationId!,
    fencingToken: admitted[1]!.fencingToken!,
    windowMs: 60_000,
    now: 1_000,
  });
  assert.deepEqual(await stores.modelRouter.readBudget({ key: reservationKey, windowMs: 60_000, now: 1_000 }), {
    tokens: 10,
    costUsd: 0,
  });

  // TTL expiry: a 1ms reservation is expired after a real tick; the late commit
  // charges the reserved amount and reports unknown usage on both stores.
  const ttlKey = { ...key, model: "ttl" };
  const shortLived = await stores.modelRouter.reserveBudget({
    key: ttlKey,
    tokens: 7,
    maxTokens: 100,
    windowMs: 60_000,
    reservationTtlMs: 1,
    now: 0,
  });
  assert.ok(shortLived.admitted);
  await new Promise((resolve) => setTimeout(resolve, 25));
  const late = await stores.modelRouter.commitBudget({
    key: ttlKey,
    reservationId: shortLived.reservationId!,
    fencingToken: shortLived.fencingToken!,
    tokens: 1,
    windowMs: 60_000,
    now: Date.now(),
  });
  assert.equal(late.unknownUsage, true);
  assert.deepEqual(await stores.modelRouter.readBudget({ key: ttlKey, windowMs: 60_000, now: Date.now() }), {
    tokens: 7,
    costUsd: 0,
  });
}
