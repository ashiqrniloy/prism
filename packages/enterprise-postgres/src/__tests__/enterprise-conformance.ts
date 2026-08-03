import assert from "node:assert/strict";
import type { AgentIdentity } from "@arnilo/prism";
import type { EvaluationStore } from "@arnilo/prism-evals";
import type { ModelRouterStateStore } from "@arnilo/prism-model-router";
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
}
