import { randomUUID } from "node:crypto";
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import {
  assertPersistenceQueryPaginationConforms,
  assertTenantScopedQueryIsolation,
} from "@arnilo/prism/testing/persistence-schema";
import { runFeedbackConformance } from "@arnilo/prism/testing/feedback";
import { runRunLedgerConformance } from "@arnilo/prism/testing/run-ledger-conformance";
import { runSessionStoreConformance } from "@arnilo/prism/testing/session-store-conformance";
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
    await runSessionStoreConformance(
      async () => createPostgresPersistence({ pool, schema }),
      {
        exerciseReadBranchPath: true,
        exerciseConcurrentParentAppend: true,
        exerciseReopen: true,
      },
    );
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
    assert.deepEqual(
      (await reopened.checkpoints.loadCheckpoint({ namespace: "workflow", key: "wf/run", tenantId: "tenant-a" }))?.value,
      { status: "running" },
    );
    await assert.rejects(
      reopened.checkpoints.loadCheckpoint({ namespace: "workflow", key: "wf/run", tenantId: "tenant-b" }),
      /ownership mismatch/,
    );
    await reopened.checkpoints.saveCheckpoint({ namespace: "workflow", key: "wf/run", version: 2, expectedVersion: 1, fencingToken: 2, value: { status: "claimed" }, tenantId: "tenant-a" });
    await assert.rejects(
      reopened.checkpoints.saveCheckpoint({ namespace: "workflow", key: "wf/run", version: 3, expectedVersion: 2, fencingToken: 1, value: null, tenantId: "tenant-a" }),
      /fencing token/,
    );
  });

  it("coordinates atomic leases across persistence instances", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    const first = await createPostgresPersistence({ pool, schema });
    const second = await createPostgresPersistence({ pool, schema });
    const claim1 = await first.leases.tryAcquireLease({ namespace: "workflow", key: "wf/run", ownerId: "worker-a", ttlMs: 20, tenantId: "tenant-a" });
    assert.ok(claim1);
    assert.equal(await second.leases.tryAcquireLease({ namespace: "workflow", key: "wf/run", ownerId: "worker-b", ttlMs: 20, tenantId: "tenant-a" }), null);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const claim2 = await second.leases.tryAcquireLease({ namespace: "workflow", key: "wf/run", ownerId: "worker-b", ttlMs: 100, tenantId: "tenant-a" });
    assert.ok(claim2);
    assert.equal(claim2.fencingToken, claim1.fencingToken + 1);
  });

  it("applies migrations once and matches shared schema on reopen", async () => {
    const schema = uniqueSchema();
    const pool = createPool();
    const first = await createPostgresPersistence({ pool, schema });
    const firstMigrations = await first.queryMigrations({});
    assert.deepEqual(firstMigrations.items.map((row) => row.name).sort(), ["001_init", "002_usage_scope", "003_run_feedback"]);

    const reopened = await createPostgresPersistence({ pool, schema });
    const secondMigrations = await reopened.queryMigrations({});
    assert.deepEqual(
      secondMigrations.items.map((row) => row.name),
      firstMigrations.items.map((row) => row.name),
    );
    await reopened.close();
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
    assert.equal(migrations.items.length, 3);
    await persistence.close();
  });
});
