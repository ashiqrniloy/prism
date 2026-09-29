import { Database } from "bun:sqlite";
import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecretRedactor } from "@arnilo/prism";
import { runFeedbackConformance } from "@arnilo/prism/testing/feedback";
import {
  assertPersistenceBranchQueryConforms,
  assertPersistenceQueryPaginationConforms,
  assertTenantScopedQueryIsolation,
  createPersistenceMigrationContract,
} from "@arnilo/prism/testing/persistence-schema";
import { runRunLedgerConformance } from "@arnilo/prism/testing/run-ledger-conformance";
import { runSessionStoreConformance } from "@arnilo/prism/testing/session-store-conformance";
import { assertPersistenceSearchQueryParity } from "../../codecs/__tests__/query-conformance.js";
import {
  MIGRATION_001_INIT,
  MIGRATION_002_USAGE_SCOPE,
  MIGRATION_003_RUN_FEEDBACK,
  MIGRATION_004_SESSION_SEARCH,
  MIGRATION_005_LIFECYCLE_HOLD_QUOTA,
  MIGRATION_006_AGENT_EVENT_SOURCE,
  MIGRATION_007_AGENT_EVENT_RETENTION_INDEX,
} from "../ddl.js";
import { applySqliteMigrations } from "../migrations.js";
import { createSqlitePersistence } from "../persistence.js";

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
    await runSessionStoreConformance(() => createSqlitePersistence({ filename }), {
      exerciseReadBranchPath: true,
      exerciseConcurrentParentAppend: true,
      exerciseReopen: true,
      exerciseSearchSessions: true,
    });
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
    persistence.appendRun({
      id: "feedback-run-account",
      sessionId: "feedback-session",
      startedAt: "2026-01-01T00:00:00Z",
      tenantId: "feedback-tenant",
      accountId: "other-account",
      userId: "feedback-user",
    });
    await persistence.feedback.append({
      id: "account-feedback",
      runId: "feedback-run-account",
      rating: 1,
      tenantId: "feedback-tenant",
      accountId: "other-account",
      userId: "feedback-user",
    });
    persistence.close();
    const reopened = createSqlitePersistence({ filename, feedbackRedactor: createSecretRedactor(["feedback-canary"]) });
    await reopened.feedback.append({
      id: "redacted",
      runId: "feedback-run-a",
      comment: "feedback-canary",
      tags: ["feedback-canary"],
      tenantId: "feedback-tenant",
      userId: "feedback-user",
    });
    const stored = await reopened.feedback.query({ tenantId: "feedback-tenant", userId: "feedback-user" });
    assert.equal(stored.items.length, 2);
    assert.doesNotMatch(JSON.stringify(stored), /feedback-canary/);
    assert.equal((await reopened.feedback.query({ tenantId: "feedback-tenant", userId: "other" })).items.length, 0);
    await assert.rejects(
      reopened.feedback.append({ id: "missing", runId: "missing", rating: 1, tenantId: "feedback-tenant", userId: "feedback-user" }),
      /Run not found/,
    );
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
    assert.deepEqual(
      (await persistence.queryUsage({ scope: "provider_turn" })).items.map((row) => row.id),
      ["turn"],
    );
    assert.deepEqual(
      (await persistence.queryUsage({ scope: "run_total" })).items.map((row) => row.id),
      ["total"],
    );
    persistence.close();
  });

  it("keeps session activity monotonic across run, usage, and event writes", async () => {
    const filename = tempDbPath("activity");
    const persistence = createSqlitePersistence({ filename });
    const appendSession = persistence.appendSession;
    if (!appendSession) throw new Error("appendSession required");
    const sessionId = "activity-session";
    const old = "2026-01-01T00:00:00.000Z";
    const recent = "2026-01-03T00:00:00.001Z";
    await appendSession({
      id: sessionId,
      tenantId: "tenant-a",
      createdAt: old,
      updatedAt: "2026-01-01T01:00:00+01:00",
      metadata: { title: "first" },
    });
    assert.equal((await persistence.querySessions({ id: sessionId })).items[0]?.updatedAt, old);
    await persistence.appendRun({ id: "new-run", sessionId, startedAt: recent });
    await persistence.appendUsage({
      id: "older-usage",
      sessionId,
      runId: "new-run",
      scope: "run_total",
      recordedAt: "2026-01-03T00:30:00+01:00",
      usage: { totalTokens: 1 },
    });
    await persistence.appendEvent({
      id: "older-event",
      sessionId,
      runId: "new-run",
      tenantId: "tenant-a",
      timestamp: old,
      type: "agent_started",
      redacted: true,
      event: { type: "agent_started", sessionId, runId: "new-run" },
    });
    assert.equal((await persistence.querySessions({ id: sessionId, tenantId: "tenant-a" })).items[0]?.updatedAt, recent);

    // A pre-existing non-canonical row must compare as an instant, not lexically.
    const legacy = "2026-01-03T01:00:00.001+01:00";
    const raw = new Database(filename);
    raw.prepare("UPDATE prism_sessions SET updated_at = ? WHERE id = ?").run(legacy, sessionId);
    raw.close();
    await persistence.appendRun({ id: "older-run", sessionId, startedAt: "2026-01-03T00:00:00.000Z" });
    assert.equal((await persistence.querySessions({ id: sessionId })).items[0]?.updatedAt, legacy);

    // Metadata CAS remains caller-authoritative, including an explicit backdated timestamp.
    assert.deepEqual(
      await appendSession({
        id: sessionId,
        tenantId: "tenant-a",
        createdAt: old,
        updatedAt: old,
        expectedVersion: 1,
        metadata: { title: "second" },
      }),
      { version: 2 },
    );
    assert.equal((await persistence.querySessions({ id: sessionId })).items[0]?.updatedAt, old);
    await Promise.all([
      persistence.appendRun({ id: "racing-new", sessionId, startedAt: "2026-01-04T00:00:00.000Z" }),
      persistence.appendUsage({
        id: "racing-old",
        sessionId,
        runId: "new-run",
        scope: "run_total",
        recordedAt: old,
        usage: { totalTokens: 1 },
      }),
    ]);
    await persistence.appendUsage({
      id: "same-instant",
      sessionId,
      runId: "new-run",
      scope: "run_total",
      recordedAt: "2026-01-04T01:00:00+01:00",
      usage: { totalTokens: 1 },
    });
    await persistence.appendUsage({
      id: "newer-millisecond",
      sessionId,
      runId: "new-run",
      scope: "run_total",
      recordedAt: "2026-01-04T01:00:00.002+01:00",
      usage: { totalTokens: 1 },
    });
    await persistence.appendEvent({
      id: "newer-event",
      sessionId,
      runId: "new-run",
      tenantId: "tenant-a",
      timestamp: "2026-01-04T00:00:00.003Z",
      type: "turn_started",
      redacted: true,
      event: { type: "turn_started", sessionId, runId: "new-run", turn: 1 },
    });
    const current = (await persistence.querySessions({ id: sessionId, tenantId: "tenant-a" })).items[0];
    assert.equal(current?.updatedAt, "2026-01-04T00:00:00.003Z");
    assert.deepEqual(current?.metadata, { title: "second" });
    assert.equal((await persistence.querySessions({ id: sessionId, tenantId: "tenant-b" })).items.length, 0);
    await assert.rejects(appendSession({ id: "invalid-time", createdAt: old, updatedAt: "2026-01-04T00:00:00" }), RangeError);
    assert.equal((await persistence.querySessions({ id: "invalid-time" })).items.length, 0);
    persistence.close();
  });

  it("applies migrations once and matches shared schema on reopen", async () => {
    const filename = tempDbPath("migrate");
    const first = createSqlitePersistence({ filename });
    const firstMigrations = await first.queryMigrations({});
    assert.deepEqual(firstMigrations.items.map((row) => row.name).sort(), [
      "001_init",
      "002_usage_scope",
      "003_run_feedback",
      "004_session_search",
      "005_lifecycle_hold_quota",
      "006_agent_event_source",
      "007_agent_event_retention_index",
      "008_session_version",
      "009_run_prompt_version",
    ]);
    first.close();

    const reopened = createSqlitePersistence({ filename });
    const secondMigrations = await reopened.queryMigrations({});
    assert.deepEqual(
      secondMigrations.items.map((row) => row.name),
      firstMigrations.items.map((row) => row.name),
    );
    reopened.close();
  });

  it("allocates per-run event sequences through the v6 stream counter", async () => {
    const filename = tempDbPath("event-sequences");
    const persistence = createSqlitePersistence({ filename });
    const base = {
      sessionId: "event-session",
      runId: "event-run",
      tenantId: "tenant-a",
      timestamp: "2026-01-01T00:00:00.000Z",
      redacted: true,
    } as const;
    await persistence.appendEvent({
      ...base,
      id: "event-a",
      type: "agent_started",
      event: { type: "agent_started", sessionId: base.sessionId, runId: base.runId },
    });
    await persistence.appendEvent({
      ...base,
      id: "event-b",
      type: "turn_started",
      timestamp: "2026-01-01T00:00:01.000Z",
      event: { type: "turn_started", sessionId: base.sessionId, runId: base.runId, turn: 1 },
    });
    assert.deepEqual(
      (await persistence.queryEvents({ runId: base.runId })).items.map((item) => item.sequence),
      [1, 2],
    );
    persistence.close();
    const db = new Database(filename);
    assert.equal(
      (
        db
          .prepare("SELECT next_sequence FROM prism_agent_event_streams WHERE session_id = ? AND run_id = ?")
          .get(base.sessionId, base.runId) as {
          next_sequence: number;
        }
      ).next_sequence,
      3,
    );
    db.close();
  });

  it("backfills only complete legacy checksum history after shape verification", async () => {
    const filename = tempDbPath("legacy-checksum");
    const db = new Database(filename);
    applySqliteMigrations(db);
    db.prepare("UPDATE prism_migrations SET checksum = NULL").run();
    const persistence = createSqlitePersistence({ filename, database: db });
    assert.equal(
      (await persistence.queryMigrations({})).items.every((row) => typeof row.checksum === "string" && row.checksum.length === 64),
      true,
    );
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
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM prism_migrations WHERE checksum IS NULL").get() as { count: number }).count, 9);
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

  it("limits SQL branch-path pages while preserving root-to-leaf offset cursors", async () => {
    const filename = tempDbPath("branch-pages");
    const db = new Database(filename);
    const prepare = db.prepare.bind(db);
    const counts: number[] = [];
    const sql: string[] = [];
    db.prepare = ((text: string) => {
      const statement = prepare(text);
      if (text.includes("WITH RECURSIVE branch_path")) {
        sql.push(text);
        const all = statement.all.bind(statement) as (...params: unknown[]) => unknown[];
        statement.all = ((...params: unknown[]) => {
          const rows = all(...params);
          counts.push(rows.length);
          return rows;
        }) as typeof statement.all;
      }
      return statement;
    }) as typeof db.prepare;
    const persistence = createSqlitePersistence({ filename, database: db });
    if (!persistence.readBranchPath) throw new Error("readBranchPath required");
    for (let i = 0; i < 300; i++) {
      await persistence.append({
        id: `entry-${i}`,
        sessionId: "long-branch",
        parentId: i ? `entry-${i - 1}` : undefined,
        timestamp: "2026-01-01T00:00:00.000Z",
        kind: "label",
        label: `${i}`,
      });
    }
    const query = { sessionId: "long-branch", leafId: "entry-299", limit: 2 };
    const first = await persistence.readBranchPath(query);
    assert.deepEqual(
      first.items.map((entry) => entry.id),
      ["entry-0", "entry-1"],
    );
    assert.equal(first.nextCursor, "2");
    assert.deepEqual(
      (await persistence.readBranchPath({ ...query, cursor: first.nextCursor })).items.map((entry) => entry.id),
      ["entry-2", "entry-3"],
    );
    const deep = await persistence.readBranchPath({ ...query, cursor: "296" });
    assert.deepEqual(
      deep.items.map((entry) => entry.id),
      ["entry-296", "entry-297"],
    );
    assert.equal(deep.nextCursor, "298");
    const last = await persistence.readBranchPath({ ...query, cursor: deep.nextCursor });
    assert.deepEqual(
      last.items.map((entry) => entry.id),
      ["entry-298", "entry-299"],
    );
    assert.equal(last.nextCursor, undefined);
    assert.deepEqual(counts.slice(0, 4), [3, 3, 3, 2]);
    assert.ok(sql.every((text) => /LIMIT \? OFFSET \?/.test(text)));
    assert.deepEqual((await persistence.readBranchPath({ ...query, cursor: "300" })).items, []);
    assert.deepEqual((await persistence.readBranchPath({ ...query, cursor: String(Number.MAX_SAFE_INTEGER) })).items, []);
    assert.deepEqual((await persistence.readBranchPath({ sessionId: "foreign", leafId: query.leafId, limit: 2 })).items, []);
    assert.deepEqual((await persistence.readBranchPath({ ...query, leafId: "missing" })).items, []);
    for (const cursor of ["", "1e3", "9007199254740992", "-1", "9".repeat(10_000)]) {
      await assert.rejects(persistence.readBranchPath({ ...query, cursor }), /Invalid branch pagination cursor/);
    }
    await assert.rejects(persistence.readBranchPath({ ...query, limit: 0 }), RangeError);
    assert.equal((await persistence.readBranchPath({ sessionId: query.sessionId, leafId: query.leafId })).items.length, 300);
    db.close();
  });

  it("filters and keyset-paginates branch entry queries", async () => {
    const persistence = createSqlitePersistence({ filename: tempDbPath("branch-query") });
    await assertPersistenceBranchQueryConforms({
      seedEntries: async (entries) => {
        for (const entry of entries) await persistence.append(entry);
      },
      queryEntries: (query) => persistence.queryEntries(query),
    });
    persistence.close();
  });

  it("scopes ordinary and leaf entry queries to the owning session", async () => {
    const persistence = createSqlitePersistence({ filename: tempDbPath("entry-ownership") });
    const appendSession = persistence.appendSession;
    if (!appendSession) throw new Error("appendSession required");
    const timestamp = "2026-01-01T00:00:00.000Z";
    for (const [sessionId, tenantId, accountId, userId] of [
      ["session-a", "tenant-a", "account-a", "user-a"],
      ["session-b", "tenant-b", "account-b", "user-b"],
    ] as const) {
      await appendSession({ id: sessionId, tenantId, accountId, userId, createdAt: timestamp, updatedAt: timestamp });
      await persistence.append({ id: `${sessionId}-root`, sessionId, timestamp, kind: "label", label: "root" });
      await persistence.append({
        id: `${sessionId}-leaf`,
        sessionId,
        parentId: `${sessionId}-root`,
        timestamp,
        kind: "label",
        label: "leaf",
      });
    }
    const own = { sessionId: "session-a", tenantId: "tenant-a", accountId: "account-a", userId: "user-a" };
    async function assertEmpty(query: Parameters<typeof persistence.queryEntries>[0]) {
      const page = await persistence.queryEntries(query);
      assert.deepEqual(page.items, []);
      assert.equal(page.nextCursor, undefined);
    }
    const first = await persistence.queryEntries({ ...own, limit: 1 });
    assert.deepEqual(
      first.items.map((entry) => entry.id),
      ["session-a-leaf"],
    );
    assert.ok(first.nextCursor);
    assert.deepEqual(
      (await persistence.queryEntries({ ...own, limit: 1, cursor: first.nextCursor })).items.map((entry) => entry.id),
      ["session-a-root"],
    );
    assert.deepEqual(
      (await persistence.queryEntries({ ...own, leafId: "session-a-leaf" })).items.map((entry) => entry.id),
      ["session-a-leaf", "session-a-root"],
    );
    assert.deepEqual(
      (await persistence.queryEntries({ tenantId: "tenant-a" })).items.map((entry) => entry.sessionId),
      ["session-a", "session-a"],
    );
    assert.equal((await persistence.queryEntries({ sessionId: "session-a" })).items.length, 2);
    assert.equal((await persistence.queryEntries({ sessionId: "session-a", leafId: "session-a-leaf" })).items.length, 2);
    for (const mismatch of [
      { tenantId: "tenant-b" },
      { accountId: "account-b" },
      { userId: "user-b" },
      { tenantId: "" },
      { ...own, userId: "user-b" },
      { tenantId: "' OR '1'='1" },
    ]) {
      await assertEmpty({ sessionId: "session-a", ...mismatch });
      await assertEmpty({ sessionId: "session-a", leafId: "session-a-leaf", ...mismatch });
    }
    await assertEmpty({ ...own, sessionId: "session-b" });
    await assertEmpty({ tenantId: "tenant-a", accountId: "account-b" });
    await assertEmpty({ ...own, leafId: "session-b-leaf" });
    await assertEmpty({ ...own, sessionId: "session-a' OR 1=1 --" });
    await persistence.append({
      id: "cross-session-parent",
      sessionId: "session-a",
      parentId: "session-b-root",
      timestamp,
      kind: "label",
    });
    assert.deepEqual(
      (await persistence.queryEntries({ ...own, leafId: "cross-session-parent" })).items.map((entry) => entry.id),
      ["cross-session-parent"],
    );
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

  it("round-trips the prompt provenance ref on run rows", async () => {
    const filename = tempDbPath("prompt-version");
    const ref = { name: "support-agent", version: 7, hash: `sha256:${"a".repeat(64)}` };
    const first = createSqlitePersistence({ filename });
    first.appendRun({
      id: "run-prompt",
      sessionId: "prompt-session",
      status: "succeeded",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z",
      promptVersion: ref,
    });
    first.appendRun({
      id: "run-plain",
      sessionId: "prompt-session",
      status: "succeeded",
      startedAt: "2026-01-01T00:00:02.000Z",
      finishedAt: "2026-01-01T00:00:03.000Z",
    });
    first.close();

    const reopened = createSqlitePersistence({ filename });
    const page = await reopened.queryRuns({ sessionId: "prompt-session" });
    const withRef = page.items.find((row) => row.id === "run-prompt");
    assert.deepEqual(withRef?.promptVersion, ref);
    const withoutRef = page.items.find((row) => row.id === "run-plain");
    assert.equal(withoutRef?.promptVersion, undefined);
    reopened.close();
  });

  it("exposes durable generic checkpoints across reopen", async () => {
    const filename = tempDbPath("checkpoints");
    const first = createSqlitePersistence({ filename });
    await first.checkpoints.saveCheckpoint({
      namespace: "workflow",
      key: "wf/run",
      version: 1,
      value: { status: "running" },
      metadata: { gitCommit: "abc123", docVersion: "v12" },
      tenantId: "tenant-a",
    });
    first.close();

    const reopened = createSqlitePersistence({ filename });
    assert.deepEqual((await reopened.checkpoints.loadCheckpoint({ namespace: "workflow", key: "wf/run", tenantId: "tenant-a" }))?.value, {
      status: "running",
    });
    assert.deepEqual(
      (await reopened.checkpoints.loadCheckpoint({ namespace: "workflow", key: "wf/run", tenantId: "tenant-a" }))?.metadata,
      { gitCommit: "abc123", docVersion: "v12" },
    );
    // Plan 080 Task 3: a foreign scope is a miss and a foreign write is a generic
    // CAS conflict; neither distinguishes "other tenant owns this key" from "missing".
    assert.equal(await reopened.checkpoints.loadCheckpoint({ namespace: "workflow", key: "wf/run", tenantId: "tenant-b" }), null);
    await assert.rejects(
      reopened.checkpoints.saveCheckpoint({
        namespace: "workflow",
        key: "wf/run",
        version: 9,
        value: { status: "evil" },
        tenantId: "tenant-b",
      }),
      /compare-and-swap failed/,
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
    reopened.close();
  });

  it("coordinates leases across database handles with monotonic fencing", async () => {
    const filename = tempDbPath("leases");
    const first = createSqlitePersistence({ filename });
    const second = createSqlitePersistence({ filename });
    const claim1 = await first.leases.tryAcquireLease({
      namespace: "workflow",
      key: "wf/run",
      ownerId: "worker-a",
      ttlMs: 15,
      tenantId: "tenant-a",
    });
    assert.ok(claim1);
    assert.equal(
      await second.leases.tryAcquireLease({ namespace: "workflow", key: "wf/run", ownerId: "worker-b", ttlMs: 15, tenantId: "tenant-a" }),
      null,
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    const claim2 = await second.leases.tryAcquireLease({
      namespace: "workflow",
      key: "wf/run",
      ownerId: "worker-b",
      ttlMs: 50,
      tenantId: "tenant-a",
    });
    assert.ok(claim2);
    assert.equal(claim2.fencingToken, claim1.fencingToken + 1);
    assert.equal(
      await first.leases.releaseLease({
        namespace: "workflow",
        key: "wf/run",
        ownerId: "worker-a",
        token: claim1.token,
        tenantId: "tenant-a",
      }),
      false,
    );
    first.close();
    second.close();
  });

  it("binds injection-like session ids and idempotency keys as parameters", async () => {
    const filename = tempDbPath("injection");
    const persistence = createSqlitePersistence({ filename });
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
    persistence.close();
  });

  it("shares filter-only search ordering, scoping, and cursor semantics", async () => {
    const persistence = createSqlitePersistence({ filename: tempDbPath("search-query-parity") });
    await assertPersistenceSearchQueryParity(persistence);
    persistence.close();
  });

  it("searches sessions by label, FTS message text, workspace, and ownership", async () => {
    const filename = tempDbPath("search");
    const persistence = createSqlitePersistence({ filename });
    await persistence.append({
      id: "search-root",
      sessionId: "search-session",
      timestamp: "2026-01-01T00:00:00.000Z",
      kind: "message",
      runId: "search-run",
      label: "auth-flake",
      summary: "flaky login",
      message: { role: "user", content: [{ type: "text", text: "fix flaky auth test timeout" }] },
    });
    await persistence.append({
      id: "other-root",
      sessionId: "other-session",
      timestamp: "2026-01-01T00:00:00.000Z",
      kind: "label",
      label: "unrelated",
    });
    persistence.appendRun({
      id: "search-run",
      sessionId: "search-session",
      startedAt: "2026-01-01T00:00:00.000Z",
      provider: "anthropic",
      model: { provider: "anthropic", model: "claude-sonnet" },
    });

    const db = new Database(filename);
    db.prepare(
      `UPDATE prism_sessions
       SET tenant_id = ?, metadata = ?
       WHERE id = ?`,
    ).run("tenant-a", JSON.stringify({ workspaceRoot: "/repo", title: "Auth flake fix" }), "search-session");
    db.close();

    const byLabel = await persistence.searchSessions!({ label: "auth-flake", limit: 10 });
    assert.equal(byLabel.items.length, 1);
    assert.equal(byLabel.items[0]?.sessionId, "search-session");
    assert.equal(byLabel.items[0]?.leafId, "search-root");

    const byFts = await persistence.searchSessions!({ query: "flaky auth", limit: 10 });
    const ftsHit = byFts.items.find((hit) => hit.sessionId === "search-session");
    assert.ok(ftsHit);
    assert.equal(ftsHit.entryId, "search-root");
    assert.equal(ftsHit.runId, "search-run");
    assert.equal(ftsHit.turn, 1);
    assert.ok((ftsHit.score ?? 0) > 0);
    assert.match(ftsHit.snippet ?? "", /flaky auth/);

    // Kind filter: the match is a message entry, so annotation-only search misses it.
    const annotationOnly = await persistence.searchSessions!({ query: "flaky auth", kind: ["label", "summary"], limit: 10 });
    assert.equal(annotationOnly.items.length, 0);
    const annotationList = await persistence.searchSessions!({ kind: "label", limit: 10 });
    assert.deepEqual(
      annotationList.items.map((hit) => hit.sessionId),
      ["other-session"],
    );
    await assert.rejects(() => persistence.searchSessions!({ kind: "bogus" as never }), TypeError);

    // Transcript-text-only: tool result payloads are never indexed (redaction posture by omission).
    await persistence.append({
      id: "tool-root",
      sessionId: "tool-session",
      timestamp: "2026-01-01T00:00:03.000Z",
      kind: "message",
      message: {
        role: "tool",
        content: [{ type: "tool_result", toolCallId: "call-1", name: "read_file", result: { text: "unindexed-tool-secret" } }],
      },
    });
    const toolHits = await persistence.searchSessions!({ query: "unindexed-tool-secret", limit: 10 });
    assert.equal(toolHits.items.length, 0);

    // Workspace isolation: the same query text in another workspace never leaks across.
    await persistence.append({
      id: "other-ws-root",
      sessionId: "other-ws-session",
      timestamp: "2026-01-01T00:00:04.000Z",
      kind: "message",
      message: { role: "user", content: [{ type: "text", text: "fix flaky auth test timeout" }] },
    });
    const otherDb = new Database(filename);
    otherDb
      .prepare("UPDATE prism_sessions SET metadata = ? WHERE id = ?")
      .run(JSON.stringify({ workspaceRoot: "/elsewhere" }), "other-ws-session");
    otherDb.close();
    const scoped = await persistence.searchSessions!({ query: "flaky auth", workspaceRoot: "/repo", limit: 10 });
    assert.deepEqual(
      scoped.items.map((hit) => hit.sessionId),
      ["search-session"],
    );
    const elsewhere = await persistence.searchSessions!({ query: "flaky auth", workspaceRoot: "/elsewhere", limit: 10 });
    assert.deepEqual(
      elsewhere.items.map((hit) => hit.sessionId),
      ["other-ws-session"],
    );

    const byWorkspace = await persistence.searchSessions!({ workspaceRoot: "/repo", limit: 10 });
    assert.deepEqual(
      byWorkspace.items.map((hit) => hit.sessionId),
      ["search-session"],
    );
    assert.equal(byWorkspace.items[0]?.metadata?.workspaceRoot, "/repo");
    // Safe display metadata carries the title; messageCount counts kind='message' entries only.
    assert.equal(byWorkspace.items[0]?.metadata?.title, "Auth flake fix");
    assert.equal(byWorkspace.items[0]?.messageCount, 1);

    const byProvider = await persistence.searchSessions!({ provider: "anthropic", limit: 10 });
    assert.ok(byProvider.items.some((hit) => hit.sessionId === "search-session"));

    const owned = await persistence.searchSessions!({ tenantId: "tenant-a", limit: 10 });
    assert.ok(owned.items.every((hit) => hit.sessionId === "search-session"));
    const missing = await persistence.searchSessions!({ tenantId: "missing", limit: 10 });
    assert.equal(missing.items.length, 0);

    const page1 = await persistence.searchSessions!({ limit: 1, order: "asc" });
    assert.equal(page1.items.length, 1);
    assert.ok(page1.nextCursor);
    const page2 = await persistence.searchSessions!({ limit: 1, order: "asc", cursor: page1.nextCursor });
    assert.equal(page2.items.length, 1);
    assert.notEqual(page2.items[0]?.sessionId, page1.items[0]?.sessionId);

    await assert.rejects(() => persistence.searchSessions!({ limit: 0 }), TypeError);
    await assert.rejects(() => persistence.searchSessions!({ query: "x".repeat(16 * 1024 + 1) }), TypeError);

    // One hit per session: a second matching entry in the same session ranks behind the best
    // match and must not add a second row (Postgres `DISTINCT ON` and the linear stores agree).
    await persistence.append({
      id: "search-summary",
      sessionId: "search-session",
      parentId: "search-root",
      timestamp: "2026-01-01T00:00:05.000Z",
      kind: "summary",
      summary: "flaky login fixed",
    });
    const deduped = await persistence.searchSessions!({ query: "flaky", limit: 10 });
    const searchSessionHits = deduped.items.filter((hit) => hit.sessionId === "search-session");
    assert.equal(searchSessionHits.length, 1);
    assert.ok(searchSessionHits[0]?.entryId === "search-root" || searchSessionHits[0]?.entryId === "search-summary");
    assert.ok((searchSessionHits[0]?.score ?? 0) > 0);

    persistence.close();
  });

  it("upserts session records and filters querySessions by id and metadata key under ownership", async () => {
    const persistence = createSqlitePersistence({ filename: tempDbPath("sessions") });
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
    await persistence.appendSession!({
      id: "plain-1",
      tenantId: "tenant-a",
      userId: "user-1",
      createdAt: now,
      updatedAt: now,
    });

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

    // Ownership isolation: another user sees nothing.
    const foreign = await persistence.querySessions({ tenantId: "tenant-a", userId: "user-2", metadataKey: "prismConversation" });
    assert.equal(foreign.items.length, 0);

    // Invalid metadata keys fail closed instead of reaching the json path.
    await assert.rejects(
      () => persistence.querySessions({ tenantId: "tenant-a", metadataKey: "bad\"'; DROP TABLE prism_sessions;--" }),
      RangeError,
    );

    persistence.close();
  });
});

describe("appendSession metadata CAS (008_session_version)", () => {
  const record = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    tenantId: "cas-tenant",
    userId: "cas-user",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    metadata: { note: "first" },
    ...extra,
  });

  function persistenceWithAppend() {
    const persistence = createSqlitePersistence({ filename: tempDbPath("cas") });
    if (!persistence.appendSession) throw new Error("appendSession required");
    return { persistence, appendSession: persistence.appendSession };
  }

  it("create-only expectedVersion 0 inserts once (version 1) and conflicts on duplicate", async () => {
    const { persistence, appendSession } = persistenceWithAppend();
    const created = await appendSession(record("cas-1", { expectedVersion: 0 }));
    assert.deepEqual(created, { version: 1 });
    await assert.rejects(appendSession(record("cas-1", { expectedVersion: 0, metadata: { note: "second" } })), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "metadata_conflict");
      assert.equal((error as { conflict?: { currentVersion?: number } }).conflict?.currentVersion, 1);
      return true;
    });
    // The duplicate create did not overwrite the winner's metadata.
    const page = await persistence.querySessions({ id: "cas-1" });
    const meta = page.items[0]?.metadata;
    assert.equal((meta as { note?: string } | undefined)?.note, "first");
    assert.equal(page.items[0]?.version, 1);
    persistence.close();
  });

  it("expectedVersion N requires the exact current version and never resurrects a deleted row", async () => {
    const { persistence, appendSession } = persistenceWithAppend();
    await appendSession(record("cas-2"));
    assert.deepEqual(await appendSession(record("cas-2", { expectedVersion: 1, metadata: { note: "second" } })), {
      version: 2,
    });
    // Stale expected version is rejected with the current version in the conflict.
    await assert.rejects(
      appendSession(record("cas-2", { expectedVersion: 1, metadata: { note: "stale" } })),
      (error: unknown) => (error as { conflict?: { currentVersion?: number } }).conflict?.currentVersion === 2,
    );
    assert.deepEqual(await appendSession(record("cas-2", { expectedVersion: 2, metadata: { note: "third" } })), {
      version: 3,
    });
    // Deleted row + positive expectedVersion = conflict, never a re-created row.
    await persistence.lifecycle?.applyRetention({
      policy: { id: "p", name: "p", createdAt: "1970-01-01T00:00:00.000Z" },
      candidates: ["cas-2"],
      tenantId: "cas-tenant",
      userId: "cas-user",
    });
    await assert.rejects(
      appendSession(record("cas-2", { expectedVersion: 3, metadata: { note: "zombie" } })),
      (error: unknown) => (error as { conflict?: { currentVersion?: number } }).conflict?.currentVersion === 0,
    );
    assert.equal((await persistence.querySessions({ id: "cas-2" })).items.length, 0);
    persistence.close();
  });

  it("legacy callers without expectedVersion keep last-write-wins and bump the version", async () => {
    const { persistence, appendSession } = persistenceWithAppend();
    await appendSession(record("cas-3"));
    await appendSession(record("cas-3", { metadata: { note: "legacy-overwrite" }, userId: undefined }));
    const page = await persistence.querySessions({ id: "cas-3" });
    const meta = page.items[0]?.metadata;
    assert.equal((meta as { note?: string } | undefined)?.note, "legacy-overwrite");
    assert.equal(page.items[0]?.version, 2);
    persistence.close();
  });

  it("rejects a cross-ownership CAS write before the version guard", async () => {
    const { persistence, appendSession } = persistenceWithAppend();
    await appendSession(record("cas-4"));
    await assert.rejects(
      appendSession(record("cas-4", { tenantId: "other-tenant", expectedVersion: 1, metadata: { note: "stolen" } })),
      (error: unknown) => (error as { code?: string }).code === "metadata_conflict",
    );
    const page = await persistence.querySessions({ id: "cas-4" });
    const meta = page.items[0]?.metadata;
    assert.equal((meta as { note?: string } | undefined)?.note, "first");
    persistence.close();
  });

  it("legacy pre-0.2.2 rows are backfilled to version 1 so branch/archive CAS works on them", async () => {
    const filename = tempDbPath("cas-legacy-upgrade");
    const raw = new Database(filename);
    // Apply migrations 001-007 only (the pre-0.2.2 schema) and record their checksummed history.
    const steps = createPersistenceMigrationContract().steps.slice(0, 7);
    for (const step of steps) {
      const ddl =
        step.name === "001_init"
          ? MIGRATION_001_INIT
          : step.name === "002_usage_scope"
            ? MIGRATION_002_USAGE_SCOPE
            : step.name === "003_run_feedback"
              ? MIGRATION_003_RUN_FEEDBACK
              : step.name === "004_session_search"
                ? MIGRATION_004_SESSION_SEARCH
                : step.name === "005_lifecycle_hold_quota"
                  ? MIGRATION_005_LIFECYCLE_HOLD_QUOTA
                  : step.name === "006_agent_event_source"
                    ? MIGRATION_006_AGENT_EVENT_SOURCE
                    : MIGRATION_007_AGENT_EVENT_RETENTION_INDEX;
      raw.exec(ddl);
      raw
        .prepare("INSERT INTO prism_migrations (id, name, version, applied_at, applied_by, checksum) VALUES (?, ?, ?, ?, ?, ?)")
        .run(randomUUID(), step.name, String(step.version), new Date(Date.now() + step.version).toISOString(), "test", step.checksum);
    }
    raw
      .prepare("INSERT INTO prism_sessions (id, tenant_id, user_id, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?, ?)")
      .run(
        "cas-5",
        "cas-tenant",
        "cas-user",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        '{"prismConversation": {"state": "active"}}',
      );
    raw.close();
    // Reopen: migration 008 applies, backfilling the legacy row to version 1.
    const persistence = createSqlitePersistence({ filename });
    if (!persistence.appendSession) throw new Error("appendSession required");
    const bumped = await persistence.appendSession(record("cas-5", { expectedVersion: 1, metadata: { note: "branched" } }));
    assert.deepEqual(bumped, { version: 2 });
    persistence.close();
  });
});

it("merges session metadata without clobbering other keys and bumps the CAS version", async () => {
  const persistence = createSqlitePersistence({ filename: tempDbPath("metadata-merge") });
  if (!persistence.appendSession) throw new Error("appendSession required");
  const now = "2026-01-01T00:00:00.000Z";
  await persistence.appendSession({
    id: "merge-1",
    createdAt: now,
    updatedAt: now,
    metadata: { workspaceRoot: "/repo", title: "first" },
  });

  // Merge keeps existing keys and bumps version without touching updated_at.
  const merged = persistence.mergeSessionMetadata("merge-1", { title: "renamed", extra: { nested: true } }, {});
  assert.deepEqual(merged, { version: 2 });
  const row = await persistence.querySessions({ id: "merge-1" });
  assert.deepEqual(row.items[0]?.metadata, { workspaceRoot: "/repo", title: "renamed", extra: { nested: true } });
  assert.equal(row.items[0]?.updatedAt, now);

  // onlyIfMissing keeps the first title (first-prompt wins) but still records other keys.
  const skipped = persistence.mergeSessionMetadata("merge-1", { title: "second" }, { onlyIfMissing: ["title"] });
  assert.equal(skipped, undefined);
  const kept = await persistence.querySessions({ id: "merge-1" });
  assert.equal(kept.items[0]?.metadata?.title, "renamed");
  assert.equal(Boolean(kept.items[0]?.metadata?.extra), true);

  // Unknown ids and invalid keys fail predictably.
  assert.equal(persistence.mergeSessionMetadata("missing", { title: "x" }), undefined);
  assert.throws(() => persistence.mergeSessionMetadata("merge-1", { 'bad"key': "x" }), RangeError);
  assert.throws(() => persistence.mergeSessionMetadata("merge-1", {}), TypeError);

  persistence.close();
});

it("names the Bun runtime when the sqlite modules are imported under node", () => {
  const targets = [new URL("../persistence.js", import.meta.url), new URL("../../../governance/prompts/sqlite.js", import.meta.url)];
  for (const target of targets) {
    const result = spawnSync(
      "node",
      [
        "--input-type=module",
        "-e",
        `try { await import(${JSON.stringify(target.href)}); console.log("NO_THROW"); } catch (error) { console.log(error.message); console.log(error.cause?.code ?? ""); }`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /requires the Bun runtime \(bun:sqlite\)/);
    assert.equal(result.stdout.includes("ERR_UNSUPPORTED_ESM_URL_SCHEME"), false);
    assert.match(result.stdout, /MODULE_NOT_FOUND/);
  }
});
