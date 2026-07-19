import { mkdtempSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createSecretRedactor } from "@arnilo/prism";
import {
  assertPersistenceQueryPaginationConforms,
  assertTenantScopedQueryIsolation,
} from "@arnilo/prism/testing/persistence-schema";
import { runFeedbackConformance } from "@arnilo/prism/testing/feedback";
import { runRunLedgerConformance } from "@arnilo/prism/testing/run-ledger-conformance";
import { runSessionStoreConformance } from "@arnilo/prism/testing/session-store-conformance";
import { createSqlitePersistence } from "../persistence.js";
import { applySqliteMigrations } from "../migrations.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function tempDbPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "prism-sqlite-"));
  tempDirs.push(dir);
  return join(dir, `${name}.db`);
}

describe("createSqlitePersistence", () => {
  it("passes full session-store conformance with reopen and branch reads", async () => {
    const filename = tempDbPath("session");
    await runSessionStoreConformance(
      () => createSqlitePersistence({ filename }),
      {
        exerciseReadBranchPath: true,
        exerciseConcurrentParentAppend: true,
        exerciseReopen: true,
      },
    );
  });

  it("passes run-ledger conformance with reopen and tenant isolation", async () => {
    const filename = tempDbPath("ledger");
    await runRunLedgerConformance(
      () => {
        const persistence = createSqlitePersistence({ filename });
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

  it("persists ownership-scoped run feedback with shared conformance", async () => {
    const filename = tempDbPath("feedback");
    const persistence = createSqlitePersistence({ filename });
    persistence.appendRun({
      id: "feedback-run-a",
      sessionId: "feedback-session",
      startedAt: "2026-01-01T00:00:00Z",
      tenantId: "feedback-tenant",
      userId: "feedback-user",
    });
    await runFeedbackConformance(() => persistence.feedback);
    persistence.appendRun({ id: "feedback-run-account", sessionId: "feedback-session", startedAt: "2026-01-01T00:00:00Z", tenantId: "feedback-tenant", accountId: "other-account", userId: "feedback-user" });
    await persistence.feedback.append({ id: "account-feedback", runId: "feedback-run-account", rating: 1, tenantId: "feedback-tenant", accountId: "other-account", userId: "feedback-user" });
    persistence.close();
    const reopened = createSqlitePersistence({ filename, feedbackRedactor: createSecretRedactor(["feedback-canary"]) });
    await reopened.feedback.append({ id: "redacted", runId: "feedback-run-a", comment: "feedback-canary", tags: ["feedback-canary"], tenantId: "feedback-tenant", userId: "feedback-user" });
    const stored = await reopened.feedback.query({ tenantId: "feedback-tenant", userId: "feedback-user" });
    assert.equal(stored.items.length, 2);
    assert.doesNotMatch(JSON.stringify(stored), /feedback-canary/);
    assert.equal((await reopened.feedback.query({ tenantId: "feedback-tenant", userId: "other" })).items.length, 0);
    await assert.rejects(reopened.feedback.append({ id: "missing", runId: "missing", rating: 1, tenantId: "feedback-tenant", userId: "feedback-user" }), /Run not found/);
    reopened.close();
  });

  it("filters usage scopes so billing queries cannot mix turn and run totals", async () => {
    const persistence = createSqlitePersistence({ filename: tempDbPath("usage-scope") });
    const base = {
      sessionId: "usage-session",
      runId: "usage-run",
      recordedAt: "2026-01-01T00:00:00.000Z",
      usage: { totalTokens: 8 },
    } as const;
    await persistence.appendUsage({ ...base, id: "turn", scope: "provider_turn", turn: 1, attempt: 1 });
    await persistence.appendUsage({ ...base, id: "total", scope: "run_total" });
    assert.deepEqual((await persistence.queryUsage({ scope: "provider_turn" })).items.map((row) => row.id), ["turn"]);
    assert.deepEqual((await persistence.queryUsage({ scope: "run_total" })).items.map((row) => row.id), ["total"]);
    persistence.close();
  });

  it("applies migrations once and matches shared schema on reopen", async () => {
    const filename = tempDbPath("migrate");
    const first = createSqlitePersistence({ filename });
    const firstMigrations = await first.queryMigrations({});
    assert.deepEqual(firstMigrations.items.map((row) => row.name).sort(), ["001_init", "002_usage_scope", "003_run_feedback"]);
    first.close();

    const reopened = createSqlitePersistence({ filename });
    const secondMigrations = await reopened.queryMigrations({});
    assert.deepEqual(
      secondMigrations.items.map((row) => row.name),
      firstMigrations.items.map((row) => row.name),
    );
    reopened.close();
  });

  it("backfills only complete legacy checksum history after shape verification", async () => {
    const filename = tempDbPath("legacy-checksum");
    const db = new Database(filename);
    applySqliteMigrations(db);
    db.prepare("UPDATE prism_migrations SET checksum = NULL").run();
    const persistence = createSqlitePersistence({ filename, database: db });
    assert.equal((await persistence.queryMigrations({})).items.every((row) => typeof row.checksum === "string" && row.checksum.length === 64), true);
    db.close();
  });

  it("fails closed on migration checksum or schema drift before adapter use", () => {
    const filename = tempDbPath("migration-drift");
    const db = new Database(filename);
    applySqliteMigrations(db);
    db.prepare("UPDATE prism_migrations SET checksum = 'tampered' WHERE name = '001_init'").run();
    assert.throws(() => createSqlitePersistence({ filename, database: db }), /checksum mismatch/);
    db.prepare("UPDATE prism_migrations SET checksum = NULL").run();
    db.exec("DROP INDEX prism_usage_session_scope_recorded_idx");
    assert.throws(() => createSqlitePersistence({ filename, database: db }), /missing required index/);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM prism_migrations WHERE checksum IS NULL").get() as { count: number }).count, 3);
    db.close();
  });

  it("survives close and reopen with durable rows", async () => {
    const filename = tempDbPath("reopen");
    const first = createSqlitePersistence({ filename });
    await first.append({
      id: "persist-root",
      sessionId: "persist",
      timestamp: "2026-01-01T00:00:00.000Z",
      kind: "label",
      label: "root",
    });
    first.close();

    const second = createSqlitePersistence({ filename });
    const listed = await second.list("persist");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, "persist-root");
    second.close();
  });

  it("honors entry pagination cursors without overlap", async () => {
    const filename = tempDbPath("pagination");
    const persistence = createSqlitePersistence({ filename });
    await assertPersistenceQueryPaginationConforms({
      seedEntries: async (entries) => {
        for (const entry of entries) {
          await persistence.append(entry);
        }
      },
      queryEntries: (query) => persistence.queryEntries(query),
    });
    persistence.close();
  });

  it("isolates tenant-scoped run queries", async () => {
    const filename = tempDbPath("tenant");
    const persistence = createSqlitePersistence({ filename });
    persistence.appendRun({
      id: "run-a",
      sessionId: "tenant-session-a",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      tenantId: "tenant-a",
    });
    persistence.appendRun({
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
    persistence.close();
  });

  it("exposes durable generic checkpoints across reopen", async () => {
    const filename = tempDbPath("checkpoints");
    const first = createSqlitePersistence({ filename });
    await first.checkpoints.saveCheckpoint({
      namespace: "workflow",
      key: "wf/run",
      version: 1,
      value: { status: "running" },
      tenantId: "tenant-a",
    });
    first.close();

    const reopened = createSqlitePersistence({ filename });
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
    reopened.close();
  });

  it("coordinates leases across database handles with monotonic fencing", async () => {
    const filename = tempDbPath("leases");
    const first = createSqlitePersistence({ filename });
    const second = createSqlitePersistence({ filename });
    const claim1 = await first.leases.tryAcquireLease({ namespace: "workflow", key: "wf/run", ownerId: "worker-a", ttlMs: 15, tenantId: "tenant-a" });
    assert.ok(claim1);
    assert.equal(await second.leases.tryAcquireLease({ namespace: "workflow", key: "wf/run", ownerId: "worker-b", ttlMs: 15, tenantId: "tenant-a" }), null);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const claim2 = await second.leases.tryAcquireLease({ namespace: "workflow", key: "wf/run", ownerId: "worker-b", ttlMs: 50, tenantId: "tenant-a" });
    assert.ok(claim2);
    assert.equal(claim2.fencingToken, claim1.fencingToken + 1);
    assert.equal(await first.leases.releaseLease({ namespace: "workflow", key: "wf/run", ownerId: "worker-a", token: claim1.token, tenantId: "tenant-a" }), false);
    first.close();
    second.close();
  });

  it("binds injection-like session ids and idempotency keys as parameters", async () => {
    const filename = tempDbPath("injection");
    const persistence = createSqlitePersistence({ filename });
    const maliciousSession = `sess'; DROP TABLE prism_session_entries; --`;
    const maliciousKey = `' OR '1'='1`;
    await persistence.append({
      id: "inj-root",
      sessionId: maliciousSession,
      timestamp: "2026-01-01T00:00:00.000Z",
      kind: "label",
      label: "safe",
    }, { idempotencyKey: maliciousKey });
    await assert.doesNotReject(async () => {
      await persistence.append({
        id: "inj-child",
        parentId: "inj-root",
        sessionId: maliciousSession,
        timestamp: "2026-01-01T00:00:01.000Z",
        kind: "label",
        label: "still-safe",
      }, { expectedParentId: "inj-root", idempotencyKey: maliciousKey });
    });
    const relisted = await persistence.list(maliciousSession);
    assert.equal(relisted.length, 2);
    persistence.close();
  });
});
