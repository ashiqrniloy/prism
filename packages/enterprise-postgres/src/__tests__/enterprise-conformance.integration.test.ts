import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import type { AgentIdentity } from "@arnilo/prism";
import { Pool } from "pg";
import { createPostgresEnterpriseState } from "../enterprise.js";
import { EnterprisePostgresError } from "../errors.js";
import { ModelRouterError } from "@arnilo/prism-model-router";
import { qualifyTable } from "../identifiers.js";
import { runEnterpriseStoreConformance } from "./enterprise-conformance.js";

const postgresUrl = process.env.PRISM_TEST_POSTGRES_URL;
const describeIntegration = postgresUrl ? describe : describe.skip;
const workers = 16;

function uniqueSchema(): string {
  return `prism_enterprise_c_${randomUUID().replaceAll("-", "")}`;
}

function identity(tenantId = "tenant"): AgentIdentity {
  return {
    tenantId,
    userId: "user",
    principal: { kind: "agent" as const, id: "agent" },
    scopes: ["model:route", "work:mutate"],
    issuedAt: "2026-08-03T00:00:00.000Z",
    verified: true,
  };
}

function key(tenantId = "tenant", model = "model") {
  return { tenantId, userId: "user", principalId: "agent", provider: "benchmark", model };
}

async function retryContention<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!(error instanceof EnterprisePostgresError) || error.code !== "ERR_PRISM_ENTERPRISE_POSTGRES_RETRYABLE") throw error;
    }
  }
  throw lastError;
}

describeIntegration("enterprise cross-store conformance", () => {
  const pools: Pool[] = [];

  after(async () => {
    while (pools.length) await pools.pop()!.end();
  });

  function createPool(): Pool {
    const pool = new Pool({ connectionString: postgresUrl, max: workers });
    pools.push(pool);
    return pool;
  }

  it("runs shared memory/SQL domain behavior and persists all four stores across reopen", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    const first = await createPostgresEnterpriseState({ pool, schema });
    await runEnterpriseStoreConformance(first, "postgres");
    await first.close();

    const reopened = await createPostgresEnterpriseState({ pool, schema });
    assert.equal((await reopened.policy.query({ tenantId: "postgres-tenant", userId: "user" })).items[0]?.id, "postgres-policy");
    assert.equal((await reopened.evaluations.query({ tenantId: "postgres-tenant", userId: "user" })).items[0]?.id, "postgres-evaluation");
    assert.equal(
      (await reopened.workIdempotency.get({ identity: identity("postgres-tenant"), key: "postgres-mutation", op: "benchmark.mutate" }))
        ?.status,
      "completed",
    );
    assert.deepEqual(await reopened.modelRouter.readBudget({ key: key("postgres-tenant"), windowMs: 60_000, now: 0 }), {
      tokens: 3,
      costUsd: 0.5,
    });
  });

  it("holds exact invariants under 16-client work/rate/budget/circuit contention", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    const first = await createPostgresEnterpriseState({ pool, schema });
    const second = await createPostgresEnterpriseState({ pool: createPool(), schema });
    const mutation = { identity: identity(), key: "same-key'; SELECT 1; --", op: "benchmark.mutate" };
    const claims = await Promise.all(
      Array.from({ length: workers }, (_, index) => (index % 2 ? first : second).workIdempotency.begin(mutation)),
    );
    const acquired = claims.filter((claim) => claim.outcome === "acquired");
    assert.equal(acquired.length, 1);
    assert.ok(acquired[0]?.record.claimToken);

    const routerKey = key();
    const rate = await Promise.all(
      Array.from({ length: workers }, (_, index) =>
        (index % 2 ? first : second).modelRouter.consumeRate({ key: routerKey, maxRequests: 1, windowMs: 60_000, now: 0 }),
      ),
    );
    assert.equal(rate.filter((result) => result.admitted).length, 1);
    await Promise.all(
      Array.from({ length: workers }, (_, index) =>
        (index % 2 ? first : second).modelRouter.addUsage({ key: routerKey, tokens: 1, costUsd: 0.01, windowMs: 60_000, now: 0 }),
      ),
    );
    const budget = await first.modelRouter.readBudget({ key: routerKey, windowMs: 60_000, now: 0 });
    assert.equal(budget.tokens, workers);
    assert.ok(Math.abs(budget.costUsd - workers * 0.01) < Number.EPSILON);

    const circuit = { key: routerKey, failureThreshold: 1, coolDownMs: 1_000, maxKeys: 16_384, now: 0 };
    await first.modelRouter.recordCircuitOutcome({ ...circuit, success: false });
    const circuits = qualifyTable(schema, "prism_model_router_circuits");
    await pool.query(`UPDATE ${circuits} SET open_until = clock_timestamp() - INTERVAL '1 millisecond' WHERE tenant_id = $1`, [
      routerKey.tenantId,
    ]);
    const probes = await Promise.all(
      Array.from({ length: workers }, (_, index) =>
        retryContention(() => (index % 2 ? first : second).modelRouter.claimCircuitProbe(circuit)),
      ),
    );
    assert.equal(probes.filter((probe) => probe.admitted).length, 1);
  });

  it("reserves budget atomically under 16-client contention and caps/evicts budget rows", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    const first = await createPostgresEnterpriseState({ pool, schema });
    const second = await createPostgresEnterpriseState({ pool: createPool(), schema });
    const routerKey = key();
    // 16 parallel reservations of 26 against a 100-token cap: exactly 3 admit.
    const reserved = await Promise.all(
      Array.from({ length: workers }, (_, index) =>
        (index % 2 ? first : second).modelRouter.reserveBudget({
          key: routerKey,
          tokens: 26,
          maxTokens: 100,
          windowMs: 60_000,
          reservationTtlMs: 60_000,
          now: 0,
        }),
      ),
    );
    assert.equal(reserved.filter((result) => result.admitted).length, 3);
    assert.equal(reserved.filter((result) => !result.admitted).length, workers - 3);
    const admitted = reserved.filter((result) => result.admitted);
    // Commit one (actual 10 < reserved 26): remainder released; window reflects actuals only.
    assert.equal(
      (
        await first.modelRouter.commitBudget({
          key: routerKey,
          reservationId: admitted[0]!.reservationId!,
          fencingToken: admitted[0]!.fencingToken!,
          tokens: 10,
          windowMs: 60_000,
          now: 0,
        })
      ).unknownUsage,
      false,
    );
    await second.modelRouter.releaseBudget({
      key: routerKey,
      reservationId: admitted[1]!.reservationId!,
      fencingToken: admitted[1]!.fencingToken!,
      windowMs: 60_000,
      now: 0,
    });
    // Stale fencing on the remaining held reservation is rejected.
    await assert.rejects(
      () =>
        first.modelRouter.commitBudget({
          key: routerKey,
          reservationId: admitted[2]!.reservationId!,
          fencingToken: "stale",
          tokens: 1,
          windowMs: 60_000,
          now: 0,
        }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_STATE",
    );
    // Release the last held reservation so the cap/eviction section starts with no pinned rows.
    await second.modelRouter.releaseBudget({
      key: routerKey,
      reservationId: admitted[2]!.reservationId!,
      fencingToken: admitted[2]!.fencingToken!,
      windowMs: 60_000,
      now: 0,
    });
    assert.deepEqual(await first.modelRouter.readBudget({ key: routerKey, windowMs: 60_000, now: 0 }), {
      tokens: 10,
      costUsd: 0,
    });

    // Cap/eviction in this fresh schema: inserting beyond maxBudgetKeys evicts the
    // LRU non-held row; a held reservation's row is pinned; all-held fails closed.
    const capKey = (model: string) => ({ ...key(), model });
    const held = await first.modelRouter.reserveBudget({
      key: capKey("c1"),
      tokens: 1,
      maxTokens: 10,
      windowMs: 60_000,
      reservationTtlMs: 60_000,
      maxBudgetKeys: 2,
      now: 0,
    });
    assert.ok(held.admitted);
    // c2 is a new key at cap with the only other row held: fail closed, no row created silently.
    await assert.rejects(
      () => first.modelRouter.addUsage({ key: capKey("c2"), tokens: 1, windowMs: 60_000, maxBudgetKeys: 2, now: 0 }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_STATE",
    );
    // c3's insert evicts the non-held c2 row (the held c1 row is pinned).
    const third = await first.modelRouter.reserveBudget({
      key: capKey("c3"),
      tokens: 1,
      maxTokens: 10,
      windowMs: 60_000,
      reservationTtlMs: 60_000,
      maxBudgetKeys: 2,
      now: 0,
    });
    assert.ok(third.admitted);
    // c1 and c3 are both held: a new key fails closed (the failed eviction leaves the
    // c2 row behind, so the next insert evicts it and admits; only when every row is
    // held does the cap fail closed).
    await assert.rejects(
      () => first.modelRouter.readBudget({ key: capKey("c2"), windowMs: 60_000, maxBudgetKeys: 2, now: 0 }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_STATE",
    );
    const fourth = await first.modelRouter.reserveBudget({
      key: capKey("c4"),
      tokens: 1,
      maxTokens: 10,
      windowMs: 60_000,
      reservationTtlMs: 60_000,
      maxBudgetKeys: 2,
      now: 0,
    });
    assert.ok(fourth.admitted);
    await assert.rejects(
      () =>
        first.modelRouter.reserveBudget({
          key: capKey("c5"),
          tokens: 1,
          maxTokens: 10,
          windowMs: 60_000,
          reservationTtlMs: 60_000,
          maxBudgetKeys: 2,
          now: 0,
        }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_STATE",
    );
    // Rate keys are capped the same way (LRU eviction on new-key insert; never self-eviction).
    for (const model of ["r1", "r2", "r3"]) {
      const admitted = await first.modelRouter.consumeRate({
        key: capKey(model),
        maxRequests: 1,
        windowMs: 60_000,
        maxRateKeys: 2,
        now: 0,
      });
      assert.equal(admitted.admitted, true);
    }
    await first.close();
    await second.close();
  });
});
