import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import type { AgentIdentity } from "@arnilo/prism";
import { Pool } from "pg";
import { createPostgresEnterpriseState } from "../enterprise.js";
import { EnterprisePostgresError } from "../errors.js";
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
});
