import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { Pool } from "pg";
import { ENTERPRISE_INDEX_NAMES, ENTERPRISE_TABLE_NAMES } from "../ddl.js";
import { createPostgresEnterpriseState } from "../enterprise.js";
import { EnterprisePostgresError } from "../errors.js";
import { qualifyTable, quoteIdentifier } from "../identifiers.js";

const postgresUrl = process.env.PRISM_TEST_POSTGRES_URL;
const describeIntegration = postgresUrl ? describe : describe.skip;

function uniqueSchema(): string {
  return `prism_enterprise_t_${randomUUID().replaceAll("-", "")}`;
}

describeIntegration("enterprise PostgreSQL migrations", () => {
  const pools: Pool[] = [];

  after(async () => {
    while (pools.length) await pools.pop()!.end();
  });

  function createPool(): Pool {
    const pool = new Pool({ connectionString: postgresUrl, max: 3 });
    pools.push(pool);
    return pool;
  }

  it("migrates once, verifies complete catalog shape, and serializes three opens", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    await Promise.all([
      createPostgresEnterpriseState({ pool: createPool(), schema }),
      createPostgresEnterpriseState({ pool: createPool(), schema }),
      createPostgresEnterpriseState({ pool, schema }),
    ]);
    const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = $1", [schema]);
    assert.deepEqual(tables.rows.map((row) => String(row.tablename)).sort(), [...ENTERPRISE_TABLE_NAMES].sort());
    const indexes = await pool.query("SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = ANY($2::text[])", [
      schema,
      ENTERPRISE_INDEX_NAMES,
    ]);
    assert.deepEqual(indexes.rows.map((row) => String(row.indexname)).sort(), [...ENTERPRISE_INDEX_NAMES].sort());
    const history = await pool.query(`SELECT name, version, checksum FROM ${qualifyTable(schema, "prism_enterprise_migrations")}`);
    assert.equal(history.rowCount, 1);
    assert.equal(history.rows[0]?.name, "001_enterprise_state");
    assert.match(String(history.rows[0]?.checksum), /^[a-f0-9]{64}$/);
  });

  it("fails closed for migration checksum and catalog drift", async () => {
    const checksumSchema = uniqueSchema();
    const checksumPool = createPool();
    await createPostgresEnterpriseState({ pool: checksumPool, schema: checksumSchema });
    await checksumPool.query(`UPDATE ${qualifyTable(checksumSchema, "prism_enterprise_migrations")} SET checksum = 'drift'`);
    await assert.rejects(
      () => createPostgresEnterpriseState({ pool: checksumPool, schema: checksumSchema }),
      (error: unknown) => error instanceof EnterprisePostgresError && error.code === "ERR_PRISM_ENTERPRISE_POSTGRES_MIGRATION",
    );

    const catalogSchema = uniqueSchema();
    const catalogPool = createPool();
    await createPostgresEnterpriseState({ pool: catalogPool, schema: catalogSchema });
    await catalogPool.query(`DROP INDEX ${quoteIdentifier(catalogSchema)}.${quoteIdentifier("prism_evaluations_owner_run_created_idx")}`);
    await assert.rejects(
      () => createPostgresEnterpriseState({ pool: catalogPool, schema: catalogSchema }),
      (error: unknown) => error instanceof EnterprisePostgresError && error.code === "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA",
    );
  });

  it("cleans only exact owners in oldest-first bounded concurrent batches", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    const state = await createPostgresEnterpriseState({ pool, schema });
    const rates = qualifyTable(schema, "prism_model_router_rates");
    const owner = { tenantId: "tenant", userId: "user", principalId: "agent" };
    const insert = async (tenantId: string, model: string) =>
      pool.query(
        `INSERT INTO ${rates} (tenant_id, account_key, user_key, principal_id, provider, model, window_ms, window_started_at, request_count, last_used_at, expires_at)
         VALUES ($1, '', $2, $3, 'openai', $4, 1000, clock_timestamp() - INTERVAL '2 seconds', 1, clock_timestamp() - INTERVAL '1 second', clock_timestamp() - INTERVAL '1 second')`,
        [tenantId, owner.userId, owner.principalId, model],
      );
    await insert(owner.tenantId, "a");
    await insert(owner.tenantId, "b");
    await insert("foreign", "foreign");

    assert.deepEqual(await state.cleanup({ ...owner, limit: 1 }), { removed: 1, transitioned: 0 });
    assert.deepEqual(
      (await pool.query(`SELECT model FROM ${rates} WHERE tenant_id = $1`, [owner.tenantId])).rows.map((row) => row.model),
      ["b"],
    );
    const concurrent = await Promise.all([state.cleanup({ ...owner, limit: 1 }), state.cleanup({ ...owner, limit: 1 })]);
    assert.equal(
      concurrent.reduce((total, result) => total + result.removed, 0),
      1,
    );
    assert.equal((await pool.query(`SELECT 1 FROM ${rates} WHERE tenant_id = $1`, [owner.tenantId])).rowCount, 0);
    assert.equal((await pool.query(`SELECT 1 FROM ${rates} WHERE tenant_id = 'foreign'`)).rowCount, 1);
  });

  it("uses database time, transitions active claims/probes, and cleans bounded expired rows", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    const state = await createPostgresEnterpriseState({ pool, schema });
    const owner = { tenantId: "tenant", userId: "user", principalId: "agent" };
    const work = qualifyTable(schema, "prism_work_idempotency");
    const rates = qualifyTable(schema, "prism_model_router_rates");
    const budgets = qualifyTable(schema, "prism_model_router_budgets");
    const circuits = qualifyTable(schema, "prism_model_router_circuits");

    await pool.query(
      `INSERT INTO ${work} (tenant_id, account_key, user_key, principal_id, idempotency_key, op, status, attempt, version, claim_token, created_at, updated_at, expires_at)
       VALUES ($1, '', $2, $3, 'active', 'mail.send', 'in_progress', 1, 1, 'claim', clock_timestamp(), clock_timestamp(), clock_timestamp() - INTERVAL '1 second'),
              ($1, '', $2, $3, 'retained', 'mail.send', 'completed', 1, 2, NULL, clock_timestamp(), clock_timestamp(), clock_timestamp() - INTERVAL '1 second')`,
      [owner.tenantId, owner.userId, owner.principalId],
    );
    await pool.query(
      `INSERT INTO ${circuits} (tenant_id, account_key, user_key, principal_id, provider, model, failures, cool_down_ms, open_until, probe_token, probe_expires_at, last_used_at, expires_at)
       VALUES ($1, '', $2, $3, 'openai', 'gpt', 3, 1000, clock_timestamp(), 'probe', clock_timestamp() - INTERVAL '1 second', clock_timestamp(), NULL)`,
      [owner.tenantId, owner.userId, owner.principalId],
    );
    await pool.query(
      `INSERT INTO ${rates} (tenant_id, account_key, user_key, principal_id, provider, model, window_ms, window_started_at, request_count, last_used_at, expires_at)
       VALUES ($1, '', $2, $3, 'openai', 'gpt', 1000, clock_timestamp() - INTERVAL '2 seconds', 1, clock_timestamp(), clock_timestamp() - INTERVAL '1 second')`,
      [owner.tenantId, owner.userId, owner.principalId],
    );
    await pool.query(
      `INSERT INTO ${budgets} (tenant_id, account_key, user_key, principal_id, provider, model, window_ms, window_started_at, tokens, cost_usd, last_used_at, expires_at)
       VALUES ($1, '', $2, $3, 'openai', 'gpt', 1000, clock_timestamp() - INTERVAL '2 seconds', 1, 0.1, clock_timestamp(), clock_timestamp() - INTERVAL '1 second')`,
      [owner.tenantId, owner.userId, owner.principalId],
    );

    assert.deepEqual(await state.cleanup({ ...owner, limit: 2 }), { removed: 0, transitioned: 2 });
    const active = await pool.query(`SELECT status, expires_at FROM ${work} WHERE idempotency_key = 'active'`);
    assert.equal(active.rows[0]?.status, "unknown");
    assert.equal(active.rows[0]?.expires_at, null);
    const probe = await pool.query(`SELECT probe_token, probe_expires_at, open_until > clock_timestamp() AS reopened FROM ${circuits}`);
    assert.equal(probe.rows[0]?.probe_token, null);
    assert.equal(probe.rows[0]?.probe_expires_at, null);
    assert.equal(probe.rows[0]?.reopened, true);

    assert.deepEqual(await state.cleanup({ ...owner, limit: 10 }), { removed: 3, transitioned: 0 });
    assert.equal((await pool.query(`SELECT 1 FROM ${work} WHERE idempotency_key = 'retained'`)).rowCount, 0);
    assert.equal((await pool.query(`SELECT 1 FROM ${rates}`)).rowCount, 0);
    assert.equal((await pool.query(`SELECT 1 FROM ${budgets}`)).rowCount, 0);
  });
});
