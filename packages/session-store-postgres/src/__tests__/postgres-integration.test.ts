import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { runFeedbackConformance } from "@arnilo/prism/testing/feedback";
import {
  assertPersistenceQueryPaginationConforms,
  assertTenantScopedQueryIsolation,
  createPersistenceMigrationContract,
} from "@arnilo/prism/testing/persistence-schema";
import { runRunLedgerConformance } from "@arnilo/prism/testing/run-ledger-conformance";
import { runSessionStoreConformance } from "@arnilo/prism/testing/session-store-conformance";
import { Pool } from "pg";
import {
  buildMigration001Ddl,
  buildMigration002Ddl,
  buildMigration003Ddl,
  buildMigration004Ddl,
  buildMigration005Ddl,
  buildMigration006Ddl,
} from "../ddl.js";
import { qualifyTable, quoteIdentifier } from "../identifiers.js";
import { createPostgresPersistence } from "../persistence.js";

const postgresUrl = process.env.PRISM_TEST_POSTGRES_URL;
const describeIntegration = postgresUrl ? describe : describe.skip;

function uniqueSchema(): string {
  return `prism_t_${randomUUID().replace(/-/g, "")}`;
}

describeIntegration("createPostgresPersistence integration", () => {
  const pools: Pool[] = [];

  after(async () => {
    while (pools.length > 0) {
      await pools.pop()!.end();
    }
  });

  function createPool(): Pool {
    const pool = new Pool({ connectionString: postgresUrl, max: 5 });
    pools.push(pool);
    return pool;
  }

  it("passes full session-store conformance with reopen and branch reads", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    await runSessionStoreConformance(async () => createPostgresPersistence({ pool, schema }), {
      exerciseReadBranchPath: true,
      exerciseConcurrentParentAppend: true,
      exerciseReopen: true,
      exerciseSearchSessions: true,
    });
  });

  it("passes run-ledger conformance with reopen and tenant isolation", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    await runRunLedgerConformance(
      async () => {
        const persistence = await createPostgresPersistence({ pool, schema });
        return {
          ledger: persistence,
          readRuns: async () => (await persistence.queryRuns({})).items,
          readEvents: async () => (await persistence.queryEvents({})).items,
          readToolCalls: async () => (await persistence.queryToolCalls({})).items,
          readUsage: async () => (await persistence.queryUsage({})).items,
        };
      },
      { exerciseReopen: true, exerciseTenantIsolation: true },
    );
  });

  it("persists ownership-scoped run feedback across instances", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    const persistence = await createPostgresPersistence({ pool, schema });
    await persistence.appendRun({
      id: "feedback-run-a",
      sessionId: "feedback-session",
      startedAt: "2026-01-01T00:00:00Z",
      tenantId: "feedback-tenant",
      userId: "feedback-user",
    });
    await runFeedbackConformance(() => persistence.feedback);
    const reopened = await createPostgresPersistence({ pool, schema });
    assert.equal((await reopened.feedback.query({ tenantId: "feedback-tenant", userId: "feedback-user" })).items.length, 1);
  });

  it("exposes durable generic checkpoints across persistence instances", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    const first = await createPostgresPersistence({ pool, schema });
    await first.checkpoints.saveCheckpoint({
      namespace: "workflow",
      key: "wf/run",
      version: 1,
      value: { status: "running" },
      tenantId: "tenant-a",
    });
    const reopened = await createPostgresPersistence({ pool, schema });
    assert.deepEqual((await reopened.checkpoints.loadCheckpoint({ namespace: "workflow", key: "wf/run", tenantId: "tenant-a" }))?.value, {
      status: "running",
    });
    await assert.rejects(
      reopened.checkpoints.loadCheckpoint({ namespace: "workflow", key: "wf/run", tenantId: "tenant-b" }),
      /ownership mismatch/,
    );
    await reopened.checkpoints.saveCheckpoint({
      namespace: "workflow",
      key: "wf/run",
      version: 2,
      expectedVersion: 1,
      fencingToken: 2,
      value: { status: "claimed" },
      tenantId: "tenant-a",
    });
    await assert.rejects(
      reopened.checkpoints.saveCheckpoint({
        namespace: "workflow",
        key: "wf/run",
        version: 3,
        expectedVersion: 2,
        fencingToken: 1,
        value: null,
        tenantId: "tenant-a",
      }),
      /fencing token/,
    );
  });

  it("coordinates atomic leases across persistence instances", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    const first = await createPostgresPersistence({ pool, schema });
    const second = await createPostgresPersistence({ pool, schema });
    const claim1 = await first.leases.tryAcquireLease({
      namespace: "workflow",
      key: "wf/run",
      ownerId: "worker-a",
      ttlMs: 20,
      tenantId: "tenant-a",
    });
    assert.ok(claim1);
    assert.equal(
      await second.leases.tryAcquireLease({ namespace: "workflow", key: "wf/run", ownerId: "worker-b", ttlMs: 20, tenantId: "tenant-a" }),
      null,
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    const claim2 = await second.leases.tryAcquireLease({
      namespace: "workflow",
      key: "wf/run",
      ownerId: "worker-b",
      ttlMs: 100,
      tenantId: "tenant-a",
    });
    assert.ok(claim2);
    assert.equal(claim2.fencingToken, claim1.fencingToken + 1);
  });

  it("applies migrations once and matches shared schema on reopen", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    const first = await createPostgresPersistence({ pool, schema });
    const firstMigrations = await first.queryMigrations({});
    assert.deepEqual(firstMigrations.items.map((row) => row.name).sort(), [
      "001_init",
      "002_usage_scope",
      "003_run_feedback",
      "004_session_search",
      "005_lifecycle_hold_quota",
      "006_agent_event_source",
      "007_agent_event_retention_index",
    ]);

    const reopened = await createPostgresPersistence({ pool, schema });
    const secondMigrations = await reopened.queryMigrations({});
    assert.deepEqual(
      secondMigrations.items.map((row) => row.name),
      firstMigrations.items.map((row) => row.name),
    );
    await reopened.close();
  });

  it("backfills complete legacy migration checksums and rejects shape drift", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    await createPostgresPersistence({ pool, schema });
    await pool.query(`UPDATE ${qualifyTable(schema, "prism_migrations")} SET checksum = NULL`);
    const backfilled = await createPostgresPersistence({ pool, schema });
    assert.equal(
      (await backfilled.queryMigrations({})).items.every((row) => typeof row.checksum === "string" && row.checksum.length === 64),
      true,
    );
    await pool.query(`DROP INDEX ${quoteIdentifier(schema)}.${quoteIdentifier("prism_usage_session_scope_recorded_idx")}`);
    await assert.rejects(createPostgresPersistence({ pool, schema }), /missing required index/);
  });

  it("upgrades an older shipped schema (v6) to the current contract without rewriting history", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    const contract = createPersistenceMigrationContract();
    // Simulate a store shipped before the v7 retention index: apply DDL for steps 001-006
    // and seed checksum-protected migration history rows exactly as the adapter would.
    const ddlBuilders = [
      buildMigration001Ddl,
      buildMigration002Ddl,
      buildMigration003Ddl,
      buildMigration004Ddl,
      buildMigration005Ddl,
      buildMigration006Ddl,
    ];
    for (let index = 0; index < 6; index += 1) {
      const step = contract.steps[index]!;
      await pool.query(ddlBuilders[index]!(schema));
      await pool.query(
        `INSERT INTO ${qualifyTable(schema, "prism_migrations")} (id, name, version, applied_at, applied_by, checksum)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), step.name, String(step.version), new Date(Date.now() + step.version).toISOString(), "test-seed", step.checksum],
      );
    }

    const upgraded = await createPostgresPersistence({ pool, schema });
    const rows = (await upgraded.queryMigrations({})).items;
    assert.deepEqual(
      rows.map((row) => row.name),
      contract.steps.map((step) => step.name),
    );
    assert.equal(
      rows.every((row) => typeof row.checksum === "string" && row.checksum.length === 64 && row.checksum !== ""),
      true,
      "upgraded history must keep intact SHA-256 checksums",
    );

    // Idempotent re-run: reopening must not rewrite or duplicate history.
    const reopened = await createPostgresPersistence({ pool, schema });
    assert.deepEqual((await reopened.queryMigrations({})).items, rows);
    await reopened.close();
    await upgraded.close();
  });

  it("refuses foreign or corrupt migration history with no partial apply", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    const contract = createPersistenceMigrationContract();
    const ddlBuilders = [
      buildMigration001Ddl,
      buildMigration002Ddl,
      buildMigration003Ddl,
      buildMigration004Ddl,
      buildMigration005Ddl,
      buildMigration006Ddl,
    ];
    for (let index = 0; index < 6; index += 1) {
      const step = contract.steps[index]!;
      await pool.query(ddlBuilders[index]!(schema));
      await pool.query(
        `INSERT INTO ${qualifyTable(schema, "prism_migrations")} (id, name, version, applied_at, applied_by, checksum)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), step.name, String(step.version), new Date(Date.now() + step.version).toISOString(), "test-seed", step.checksum],
      );
    }
    // Foreign row: a migration the contract does not know.
    await pool.query(
      `INSERT INTO ${qualifyTable(schema, "prism_migrations")} (id, name, version, applied_at, applied_by, checksum)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), "999_foreign", "999", new Date(Date.now() + 999).toISOString(), "test-seed", "0".repeat(64)],
    );
    await assert.rejects(createPostgresPersistence({ pool, schema }), /does not match|unknown rows/);
    // No partial apply: history is unchanged and no v7 retention index was created.
    const history = await pool.query(`SELECT name FROM ${qualifyTable(schema, "prism_migrations")} ORDER BY applied_at ASC, id ASC`);
    assert.equal(history.rowCount, 7);
    const index = await pool.query(`SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = 'prism_agent_events_retention_idx'`, [
      schema,
    ]);
    assert.equal(index.rowCount, 0, "refused migration must not apply partial DDL");

    // Corrupt checksum on a known row is also refused, leaving history untouched.
    const corruptSchema = uniqueSchema();
    const corruptPool = createPool();
    await createPostgresPersistence({ pool: corruptPool, schema: corruptSchema });
    await corruptPool.query(`UPDATE ${qualifyTable(corruptSchema, "prism_migrations")} SET checksum = 'deadbeef'`);
    await assert.rejects(createPostgresPersistence({ pool: corruptPool, schema: corruptSchema }), /checksum mismatch/);
    const after = await corruptPool.query(
      `SELECT checksum FROM ${qualifyTable(corruptSchema, "prism_migrations")} WHERE name = '001_init'`,
    );
    assert.equal(after.rows[0]?.checksum, "deadbeef", "refused migration must not rewrite corrupt history");
  });

  it("honors entry pagination cursors without overlap", async () => {
    const schema = uniqueSchema();
    const persistence = await createPostgresPersistence({ pool: createPool(), schema });
    await assertPersistenceQueryPaginationConforms({
      seedEntries: async (entries) => {
        for (const entry of entries) {
          await persistence.append(entry);
        }
      },
      queryEntries: (query) => persistence.queryEntries(query),
    });
    await persistence.close();
  });

  it("isolates tenant-scoped run queries", async () => {
    const schema = uniqueSchema();
    const persistence = await createPostgresPersistence({ pool: createPool(), schema });
    await persistence.appendRun({
      id: "run-a",
      sessionId: "tenant-session-a",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      tenantId: "tenant-a",
    });
    await persistence.appendRun({
      id: "run-b",
      sessionId: "tenant-session-b",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      tenantId: "tenant-b",
    });

    await assertTenantScopedQueryIsolation(async (tenantId) => {
      const page = await persistence.queryRuns({ tenantId });
      return page.items.map((row) => ({ id: row.id, tenantId: row.tenantId }));
    });
    await persistence.close();
  });

  it("binds injection-like session ids and idempotency keys as parameters", async () => {
    const schema = uniqueSchema();
    const persistence = await createPostgresPersistence({ pool: createPool(), schema });
    const maliciousSession = `sess'; DROP TABLE prism_session_entries; --`;
    const maliciousKey = `' OR '1'='1`;
    await persistence.append(
      {
        id: "inj-root",
        sessionId: maliciousSession,
        timestamp: "2026-01-01T00:00:00.000Z",
        kind: "label",
        label: "safe",
      },
      { idempotencyKey: maliciousKey },
    );
    await assert.doesNotReject(async () => {
      await persistence.append(
        {
          id: "inj-child",
          parentId: "inj-root",
          sessionId: maliciousSession,
          timestamp: "2026-01-01T00:00:01.000Z",
          kind: "label",
          label: "still-safe",
        },
        { expectedParentId: "inj-root", idempotencyKey: maliciousKey },
      );
    });
    const relisted = await persistence.list(maliciousSession);
    assert.equal(relisted.length, 2);
    await persistence.close();
  });

  it("serializes concurrent migration setup via advisory locks", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    await Promise.all([
      createPostgresPersistence({ pool, schema }),
      createPostgresPersistence({ pool, schema }),
      createPostgresPersistence({ pool, schema }),
    ]);
    const persistence = await createPostgresPersistence({ pool, schema });
    const migrations = await persistence.queryMigrations({});
    assert.equal(migrations.items.length, 7);
    await persistence.close();
  });

  it("upserts session records and filters querySessions by id and metadata key under ownership", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    const persistence = await createPostgresPersistence({ pool, schema });
    const now = new Date().toISOString();

    await persistence.appendSession!({
      id: "conv-1",
      tenantId: "tenant-a",
      userId: "user-1",
      createdAt: now,
      updatedAt: now,
      metadata: { prismConversation: { state: "active", title: "first" } },
    });
    await persistence.appendSession!({
      id: "conv-2",
      tenantId: "tenant-a",
      userId: "user-1",
      createdAt: now,
      updatedAt: now,
      metadata: { prismConversation: { state: "active" } },
    });
    await persistence.appendSession!({ id: "plain-1", tenantId: "tenant-a", userId: "user-1", createdAt: now, updatedAt: now });

    // Upsert updates metadata/updatedAt but never ownership columns.
    await persistence.appendSession!({
      id: "conv-1",
      tenantId: "tenant-evil",
      userId: "user-evil",
      createdAt: now,
      updatedAt: "2026-01-01T00:00:00.000Z",
      metadata: { prismConversation: { state: "archived", title: "updated" } },
    });
    const byId = await persistence.querySessions({ id: "conv-1", tenantId: "tenant-a", userId: "user-1" });
    assert.equal(byId.items.length, 1);
    assert.equal(byId.items[0]?.tenantId, "tenant-a");
    assert.equal(byId.items[0]?.userId, "user-1");
    assert.equal(byId.items[0]?.updatedAt, "2026-01-01T00:00:00.000Z");
    assert.deepEqual(byId.items[0]?.metadata, { prismConversation: { state: "archived", title: "updated" } });

    const marked = await persistence.querySessions({ tenantId: "tenant-a", userId: "user-1", metadataKey: "prismConversation" });
    assert.deepEqual(marked.items.map((item) => item.id).sort(), ["conv-1", "conv-2"]);

    const foreign = await persistence.querySessions({ tenantId: "tenant-a", userId: "user-2", metadataKey: "prismConversation" });
    assert.equal(foreign.items.length, 0);

    await assert.rejects(
      () => persistence.querySessions({ tenantId: "tenant-a", metadataKey: "bad\"'; DROP TABLE prism_sessions;--" }),
      RangeError,
    );

    await persistence.close();
  });
});
