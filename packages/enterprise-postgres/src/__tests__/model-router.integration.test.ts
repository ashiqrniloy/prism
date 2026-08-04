import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import type { AgentIdentity, AIProvider, ModelConfig } from "@arnilo/prism";
import { createModelRouter, ModelRouterError } from "@arnilo/prism-model-router";
import { Pool } from "pg";
import { createPostgresEnterpriseState } from "../enterprise.js";
import { EnterprisePostgresError } from "../errors.js";
import { qualifyTable } from "../identifiers.js";

const postgresUrl = process.env.PRISM_TEST_POSTGRES_URL;
const describeIntegration = postgresUrl ? describe : describe.skip;

function uniqueSchema(): string {
  return `prism_enterprise_r_${randomUUID().replaceAll("-", "")}`;
}

function identity(tenantId = "tenant"): AgentIdentity {
  return {
    tenantId,
    userId: "user",
    principal: { kind: "agent", id: "agent" },
    scopes: ["model:route"],
    issuedAt: "2026-08-03T00:00:00.000Z",
    verified: true,
  };
}

function key(provider = "openai", model = "gpt") {
  return { tenantId: "tenant", userId: "user", principalId: "agent", provider, model };
}

function provider(id: string): AIProvider {
  return {
    id,
    async *generate() {
      /* unused */
    },
  };
}

function model(providerId: string, modelId: string): ModelConfig {
  return { provider: providerId, model: modelId };
}

describeIntegration("enterprise PostgreSQL model-router state", () => {
  const pools: Pool[] = [];

  after(async () => {
    while (pools.length) await pools.pop()!.end();
  });

  function createPool(): Pool {
    const pool = new Pool({ connectionString: postgresUrl, max: 4 });
    pools.push(pool);
    return pool;
  }

  it("atomically shares rate windows and budget usage across replicas", async () => {
    const schema = uniqueSchema();
    const firstPool = createPool();
    const first = await createPostgresEnterpriseState({ pool: firstPool, schema });
    const second = await createPostgresEnterpriseState({ pool: createPool(), schema });
    const hostile = key(`openai'; DROP TABLE prism_model_router_rates; --`);

    const admissions = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 ? first : second).modelRouter.consumeRate({
          key: hostile,
          maxRequests: 3,
          windowMs: 1_000,
          now: 0,
        }),
      ),
    );
    assert.equal(admissions.filter((result) => result.admitted).length, 3);
    assert.ok(admissions.find((result) => !result.admitted)?.retryAfterMs);
    const rates = qualifyTable(schema, "prism_model_router_rates");
    assert.equal((await firstPool.query(`SELECT count(*) AS count FROM ${rates}`)).rows[0]?.count, "1");

    await Promise.all([
      first.modelRouter.addUsage({ key: hostile, tokens: 1, costUsd: 0.1, windowMs: 1_000, now: 0 }),
      second.modelRouter.addUsage({ key: hostile, tokens: 2, costUsd: 0.2, windowMs: 1_000, now: 0 }),
      first.modelRouter.addUsage({ key: hostile, tokens: 3, costUsd: 0.3, windowMs: 1_000, now: 0 }),
      second.modelRouter.addUsage({ key: hostile, tokens: 4, costUsd: 0.4, windowMs: 1_000, now: 0 }),
    ]);
    const sharedBudget = await second.modelRouter.readBudget({ key: hostile, windowMs: 1_000, now: 0 });
    assert.equal(sharedBudget.tokens, 10);
    assert.ok(Math.abs(sharedBudget.costUsd - 1) < 1e-12);

    const budgets = qualifyTable(schema, "prism_model_router_budgets");
    await firstPool.query(`UPDATE ${rates} SET window_started_at = clock_timestamp() - INTERVAL '2 seconds'`);
    await firstPool.query(`UPDATE ${budgets} SET window_started_at = clock_timestamp() - INTERVAL '2 seconds'`);
    assert.equal((await second.modelRouter.consumeRate({ key: hostile, maxRequests: 3, windowMs: 1_000, now: 0 })).admitted, true);
    assert.deepEqual(await first.modelRouter.readBudget({ key: hostile, windowMs: 1_000, now: 0 }), { tokens: 0, costUsd: 0 });
    assert.equal(
      (await second.modelRouter.consumeRate({ key: { ...hostile, tenantId: "foreign" }, maxRequests: 1, windowMs: 1_000, now: 0 }))
        .admitted,
      true,
    );

    await firstPool.query(`UPDATE ${budgets} SET tokens = 'NaN'::double precision WHERE tenant_id = $1`, [hostile.tenantId]);
    await assert.rejects(
      () => first.modelRouter.readBudget({ key: hostile, windowMs: 1_000, now: 0 }),
      (error: unknown) => error instanceof EnterprisePostgresError && error.code === "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA",
    );
  });

  it("opens circuits atomically, grants one probe, recovers abandoned probes, and never evicts open state", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    const first = await createPostgresEnterpriseState({ pool, schema });
    const second = await createPostgresEnterpriseState({ pool: createPool(), schema });
    const circuitKey = key();
    const circuitInput = { key: circuitKey, failureThreshold: 1, coolDownMs: 1_000, maxKeys: 1, now: 0 };

    await Promise.all([
      first.modelRouter.recordCircuitOutcome({ ...circuitInput, success: false }),
      second.modelRouter.recordCircuitOutcome({ ...circuitInput, success: false }),
    ]);
    assert.deepEqual(await first.modelRouter.claimCircuitProbe(circuitInput), { admitted: false });
    const circuits = qualifyTable(schema, "prism_model_router_circuits");
    await pool.query(
      `UPDATE ${circuits} SET open_until = clock_timestamp() - INTERVAL '1 millisecond' WHERE tenant_id = $1 AND provider = $2`,
      [circuitKey.tenantId, circuitKey.provider],
    );
    const probes = await Promise.all([
      first.modelRouter.claimCircuitProbe(circuitInput),
      second.modelRouter.claimCircuitProbe(circuitInput),
    ]);
    const probe = probes.find((result) => result.admitted)!;
    assert.equal(probes.filter((result) => result.admitted).length, 1);
    assert.ok(probe.probeToken);
    await second.modelRouter.recordCircuitOutcome({ ...circuitInput, success: true, probeToken: probe.probeToken });
    assert.deepEqual(await first.modelRouter.claimCircuitProbe(circuitInput), { admitted: true });

    await first.modelRouter.recordCircuitOutcome({ ...circuitInput, success: false });
    await pool.query(`UPDATE ${circuits} SET open_until = clock_timestamp() - INTERVAL '1 millisecond' WHERE tenant_id = $1`, [
      circuitKey.tenantId,
    ]);
    const abandoned = await first.modelRouter.claimCircuitProbe(circuitInput);
    assert.ok(abandoned.probeToken);
    await pool.query(`UPDATE ${circuits} SET probe_expires_at = clock_timestamp() - INTERVAL '1 millisecond' WHERE tenant_id = $1`, [
      circuitKey.tenantId,
    ]);
    assert.deepEqual(await second.modelRouter.claimCircuitProbe(circuitInput), { admitted: false });

    await assert.rejects(
      () => second.modelRouter.recordCircuitOutcome({ ...circuitInput, key: { ...circuitKey, model: "other" }, success: true }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_STATE",
    );
    assert.equal((await pool.query(`SELECT count(*) AS count FROM ${circuits}`)).rows[0]?.count, "1");
    await first.modelRouter.recordCircuitOutcome({ ...circuitInput, success: true });
    await second.modelRouter.recordCircuitOutcome({ ...circuitInput, key: { ...circuitKey, model: "other" }, success: true });
    assert.equal((await pool.query(`SELECT model FROM ${circuits}`)).rows[0]?.model, "other");
  });

  it("wires durable router preflight, restart, cleanup, and no-sync bypass", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    const state = await createPostgresEnterpriseState({ pool, schema });
    let resolverCalls = 0;
    const router = createModelRouter({
      resolver: () => {
        resolverCalls += 1;
        return provider("openai");
      },
      stateStore: state.modelRouter,
      rateLimit: { maxRequests: 1, windowMs: 1_000 },
      budgets: { maxTokens: 5, windowMs: 1_000 },
    });
    assert.throws(
      () => router.providerSource(model("openai", "gpt")),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_ASYNC_STATE",
    );
    await assert.rejects(
      () => router.resolve({ model: model("openai", "gpt") }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_IDENTITY",
    );
    assert.equal(resolverCalls, 0);
    await router.resolve({ model: model("openai", "gpt"), identity: identity() });
    await assert.rejects(
      () => router.resolve({ model: model("openai", "gpt"), identity: identity() }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_RATE_LIMIT",
    );
    await router.recordUsage({ identity: identity(), provider: "openai", model: "budget", tokens: 5 });
    const reopened = await createPostgresEnterpriseState({ pool, schema });
    const budgetRouter = createModelRouter({
      resolver: () => provider("openai"),
      stateStore: reopened.modelRouter,
      budgets: { maxTokens: 5, windowMs: 1_000 },
    });
    await assert.rejects(
      () => budgetRouter.resolve({ model: model("openai", "budget"), identity: identity() }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_BUDGET",
    );

    const rates = qualifyTable(schema, "prism_model_router_rates");
    const budgets = qualifyTable(schema, "prism_model_router_budgets");
    await pool.query(`UPDATE ${rates} SET expires_at = clock_timestamp() - INTERVAL '1 millisecond'`);
    await pool.query(`UPDATE ${budgets} SET expires_at = clock_timestamp() - INTERVAL '1 millisecond'`);
    assert.deepEqual(await state.modelRouter.cleanup({ owner: key(), limit: 10, now: 0 }), { removed: 3 });
    await assert.rejects(
      () => state.modelRouter.addUsage({ key: key(), tokens: Number.NaN, windowMs: 1_000, now: 0 }),
      (error: unknown) => error instanceof ModelRouterError && error.code === "ERR_PRISM_MODEL_ROUTER_BUDGET",
    );
  });
});
