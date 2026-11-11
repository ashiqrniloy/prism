import { Database } from "bun:sqlite";
import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecretRedactor, type SessionEntry } from "@arnilo/prism";
import { assertPersistenceSearchQueryParity, storeConformance } from "@arnilo/prism/testing";
import { runRunLedgerConformance } from "@arnilo/prism/testing/run-ledger-conformance";
import {
  assertPersistenceBranchQueryConforms,
  assertPersistenceQueryPaginationConforms,
  assertTenantScopedQueryIsolation,
  createPersistenceMigrationContract,
  runFeedbackConformance,
} from "@arnilo/prism-extensions/store-codecs";
import {
  MIGRATION_001_INIT,
  MIGRATION_002_USAGE_SCOPE,
  MIGRATION_003_RUN_FEEDBACK,
  MIGRATION_004_SESSION_SEARCH,
  MIGRATION_005_LIFECYCLE_HOLD_QUOTA,
  MIGRATION_006_AGENT_EVENT_SOURCE,
  MIGRATION_007_AGENT_EVENT_RETENTION_INDEX,
} from "../ddl.js";
import { applySqliteMigrations, configureSqliteDatabase } from "../migrations.js";
import { createSqlitePersistence } from "../persistence.js";
import { DEFAULT_BUSY_TIMEOUT_MS } from "../types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDbPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "prism-sqlite-"));
  tempDirs.push(dir);
  return join(dir, `${name}.db`);
}

describe("createSqlitePersistence", () => {
  it("passes full session-store conformance with reopen and branch reads", async () => {
    const filename = tempDbPath("session");
    await storeConformance(() => createSqlitePersistence({ filename }), {
      reopen: () => createSqlitePersistence({ filename }),
      exerciseConcurrentParentAppend: true,
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
      type: "run.started",
      redacted: true,
      event: { type: "run.started", sessionId, runId: "new-run" },
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
      type: "turn.started",
      redacted: true,
      event: {
        type: "turn.started",
        sessionId,
        runId: "new-run",
        turn: 1,
        metadata: { providerId: "mock", model: { provider: "mock", model: "demo" } },
      },
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
      "010_session_links",
      "011_evaluations",
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
      type: "run.started",
      event: { type: "run.started", sessionId: base.sessionId, runId: base.runId },
    });
    await persistence.appendEvent({
      ...base,
      id: "event-b",
      type: "turn.started",
      timestamp: "2026-01-01T00:00:01.000Z",
      event: {
        type: "turn.started",
        sessionId: base.sessionId,
        runId: base.runId,
        turn: 1,
        metadata: { providerId: "mock", model: { provider: "mock", model: "demo" } },
      },
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

  it("sqlite_migration_adds_link_columns: a database at schema 9 opens, gains the columns, and old rows list with absent links", async () => {
    const filename = tempDbPath("links-migration");
    const db = new Database(filename);
    applySqliteMigrations(db);
    // Rewind to the schema before migration 010, with one session written the old way.
    for (const index of ["parent", "agent", "workflow", "delegation", "actor"]) db.exec(`DROP INDEX prism_sessions_link_${index}_idx`);
    for (const column of ["agent_id", "workflow_run_id", "delegation_id", "actor_kind", "actor_agent", "actor_vendor"]) {
      db.exec(`ALTER TABLE prism_sessions DROP COLUMN ${column}`);
    }
    db.prepare("DELETE FROM prism_migrations WHERE CAST(version AS INTEGER) >= 10").run();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO prism_sessions (id, created_at, updated_at, version) VALUES ('old', ?, ?, 1)").run(now, now);
    db.prepare("INSERT INTO prism_session_entries (id, session_id, timestamp, kind) VALUES ('old-1', 'old', ?, 'label')").run(now);

    const persistence = createSqlitePersistence({ filename, database: db });
    const columns = (db.prepare("PRAGMA table_info(prism_sessions)").all() as { name: string }[]).map((column) => column.name);
    for (const column of ["agent_id", "workflow_run_id", "delegation_id", "actor_kind", "actor_agent", "actor_vendor"]) {
      assert.ok(columns.includes(column), `${column} must be added`);
    }
    const old = (await persistence.listSessions({ limit: 10 })).items.find((item) => item.sessionId === "old");
    assert.ok(old, "the pre-migration session must still list");
    assert.equal(old.workflowRunId, undefined);
    assert.equal(old.actor, undefined);

    await persistence.append({
      id: "new-links",
      sessionId: "new",
      timestamp: new Date().toISOString(),
      kind: "metadata",
      data: { links: { sessionId: "old", workflowRunId: "wf", actor: { kind: "external", agent: "driver" } } },
    });
    const filtered = await persistence.listSessions({ workflowRunId: "wf", limit: 10 });
    assert.deepEqual(
      filtered.items.map((item) => item.sessionId),
      ["new"],
    );
    assert.equal(filtered.items[0]?.parentSessionId, "old");
    assert.deepEqual(
      (await persistence.listSessions({ parentSessionId: "old", limit: 10 })).items.map((item) => item.sessionId),
      ["new"],
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
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM prism_migrations WHERE checksum IS NULL").get() as { count: number }).count,
      11,
    );
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

  // Plan 210 Task 0.4: the branch CTE walks ancestors by primary key, not through the session_id index.
  async function seedChain(persistence: ReturnType<typeof createSqlitePersistence>, sessionId: string, depth: number) {
    const payload = "x".repeat(200);
    for (let i = 0; i < depth; i++) {
      await persistence.append({
        id: `${sessionId}-${i}`,
        sessionId,
        parentId: i ? `${sessionId}-${i - 1}` : undefined,
        timestamp: new Date(Date.UTC(2026, 0, 1) + i).toISOString(),
        kind: "message",
        message: { role: "user", content: [{ type: "text", text: payload }] },
      });
    }
    return `${sessionId}-${depth - 1}`;
  }

  it("branch_read_query_plan_uses_primary_key", async () => {
    const db = new Database(":memory:");
    const sql: string[] = [];
    const prepare = db.prepare.bind(db);
    db.prepare = ((text: string) => {
      if (text.includes("WITH RECURSIVE branch_path")) sql.push(text);
      return prepare(text);
    }) as typeof db.prepare;
    const persistence = createSqlitePersistence({ filename: ":memory:", database: db });
    const leafId = await seedChain(persistence, "plan", 20);
    await persistence.readBranchPath?.({ sessionId: "plan", leafId });
    await persistence.queryEntries({ sessionId: "plan", leafId });
    assert.equal(sql.length, 2);
    for (const text of sql) {
      const params = text.includes("OFFSET") ? [leafId, "plan", "plan", -1, 0] : [leafId, "plan", "plan", "plan", 101];
      const detail = (prepare(`EXPLAIN QUERY PLAN ${text}`).all(...params) as { detail: string }[]).map((row) => row.detail);
      const recursive = detail.slice(detail.indexOf("RECURSIVE STEP"));
      assert.ok(
        recursive.some((line) => /^SEARCH parent USING INDEX sqlite_autoindex_prism_session_entries_1 \(id=\?\)$/.test(line)),
        detail.join("\n"),
      );
      assert.ok(!recursive.some((line) => /session_id_idx|session_id=\?/.test(line) && /parent|current/.test(line)), detail.join("\n"));
      if (text.includes("OFFSET")) {
        assert.ok(detail.includes("SEARCH e USING INDEX sqlite_autoindex_prism_session_entries_1 (id=?)"), detail.join("\n"));
        assert.ok(!detail.some((line) => /^SCAN e\b/.test(line)), detail.join("\n"));
      }
    }
    persistence.close();
  });

  it("branch_read_cost_is_linear_in_depth", async () => {
    async function timeRead(depth: number): Promise<number> {
      const persistence = createSqlitePersistence({ filename: ":memory:", database: new Database(":memory:") });
      // One session of `depth` entries: the old plan scanned the whole session on every ancestor step.
      const leafId = await seedChain(persistence, "deep", depth);
      if (!persistence.readBranchPath) throw new Error("readBranchPath required");
      await persistence.readBranchPath({ sessionId: "deep", leafId });
      const samples: number[] = [];
      for (let i = 0; i < 5; i++) {
        const started = performance.now();
        const page: { items: readonly SessionEntry[] } = await persistence.readBranchPath({ sessionId: "deep", leafId });
        samples.push(performance.now() - started);
        assert.equal(page.items.length, depth);
      }
      persistence.close();
      return samples.sort((a, b) => a - b)[2] ?? 0;
    }
    const small = await timeRead(200);
    const large = await timeRead(2000);
    // Linear is ~10x, the old quadratic plan ~100x+. Floor the small read so timer noise cannot inflate the ratio.
    assert.ok(large / Math.max(small, 0.2) <= 15, `200 → ${small.toFixed(2)} ms, 2000 → ${large.toFixed(2)} ms`);
  });

  it("branch_read_results_unchanged", async () => {
    // The pre-Task-0.4 query, kept verbatim as the reference output.
    const legacy = (ownerClause: string) => `WITH RECURSIVE branch_path(id, depth) AS (
         SELECT seed.id, 0 FROM prism_session_entries seed
         WHERE seed.id = ? AND seed.session_id = ? ${ownerClause}
         UNION ALL
         SELECT parent.id, bp.depth + 1
         FROM branch_path bp
         INNER JOIN prism_session_entries current ON current.id = bp.id
         INNER JOIN prism_session_entries parent ON parent.id = current.parent_id AND parent.session_id = current.session_id
         WHERE current.session_id = ?
       )
       SELECT e.id FROM prism_session_entries e
       INNER JOIN branch_path bp ON e.id = bp.id
       ORDER BY bp.depth DESC, e.timestamp ASC, e.id ASC
       LIMIT ? OFFSET ?`;
    const db = new Database(":memory:");
    const persistence = createSqlitePersistence({ filename: ":memory:", database: db });
    if (!persistence.readBranchPath || !persistence.appendSession) throw new Error("branch read and sessions required");
    const timestamp = "2026-01-01T00:00:00.000Z";
    await persistence.appendSession({ id: "a", tenantId: "t-a", userId: "u-a", createdAt: timestamp, updatedAt: timestamp });
    await persistence.appendSession({ id: "b", tenantId: "t-b", userId: "u-b", createdAt: timestamp, updatedAt: timestamp });
    // Session a: a trunk of 12 with two forks off entry 5, equal timestamps to exercise the id tiebreak.
    await seedChain(persistence, "a", 12);
    for (const fork of ["x", "y"]) {
      for (let i = 0; i < 4; i++) {
        await persistence.append({
          id: `a-${fork}${i}`,
          sessionId: "a",
          parentId: i ? `a-${fork}${i - 1}` : "a-5",
          timestamp,
          kind: "label",
          label: fork,
        });
      }
    }
    await seedChain(persistence, "b", 3);
    await persistence.append({ id: "a-cross", sessionId: "a", parentId: "b-2", timestamp, kind: "label", label: "cross" });
    const legacyIds = (leafId: string, sessionId: string, limit: number, offset: number) =>
      (db.prepare(legacy("")).all(leafId, sessionId, sessionId, limit, offset) as { id: string }[]).map((row) => row.id);
    const cases: [string, string][] = [
      ["a-11", "a"],
      ["a-x3", "a"],
      ["a-y1", "a"],
      ["a-5", "a"],
      ["a-0", "a"],
      ["a-cross", "a"],
      ["b-2", "b"],
      ["b-2", "a"],
      ["missing", "a"],
    ];
    for (const [leafId, sessionId] of cases) {
      const full: string[] = (await persistence.readBranchPath({ sessionId, leafId })).items.map((entry: SessionEntry) => entry.id);
      assert.deepEqual(full, legacyIds(leafId, sessionId, -1, 0), `${sessionId}/${leafId}`);
      for (const limit of [1, 3, 5]) {
        const paged: string[] = [];
        let cursor: string | undefined;
        do {
          const page: { items: readonly SessionEntry[]; nextCursor?: string } = await persistence.readBranchPath({
            sessionId,
            leafId,
            limit,
            cursor,
          });
          assert.deepEqual(
            page.items.map((entry: SessionEntry) => entry.id),
            legacyIds(leafId, sessionId, limit, cursor ? Number(cursor) : 0),
          );
          paged.push(...page.items.map((entry: SessionEntry) => entry.id));
          cursor = page.nextCursor;
        } while (cursor);
        assert.deepEqual(paged, full);
      }
      const branchQuery = (await persistence.queryEntries({ sessionId, leafId, limit: 500 })).items.map((entry) => entry.id);
      assert.deepEqual([...branchQuery].sort(), [...full].sort());
    }
    // The ownership clause still gates the seed row (the store's internal scope argument).
    const scoped = persistence.readBranchPath as (
      query: { sessionId: string; leafId: string },
      scope: { tenantId?: string; userId?: string },
    ) => Promise<{ items: readonly SessionEntry[] }>;
    assert.equal((await scoped({ sessionId: "a", leafId: "a-11" }, { tenantId: "t-a", userId: "u-a" })).items.length, 12);
    assert.deepEqual((await scoped({ sessionId: "a", leafId: "a-11" }, { tenantId: "t-b" })).items, []);
    assert.deepEqual((await scoped({ sessionId: "a", leafId: "a-11" }, { tenantId: "t-a", userId: "u-b" })).items, []);
    persistence.close();
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
    // `searchSessions` is optional on the SessionStore contract; this store always implements it.
    const search = persistence.searchSessions;
    assert.ok(search, "the sqlite store must implement searchSessions");
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

    const byLabel = await search.call(persistence, { label: "auth-flake", limit: 10 });
    assert.equal(byLabel.items.length, 1);
    assert.equal(byLabel.items[0]?.sessionId, "search-session");
    assert.equal(byLabel.items[0]?.leafId, "search-root");

    const byFts = await search.call(persistence, { query: "flaky auth", limit: 10 });
    const ftsHit = byFts.items.find((hit) => hit.sessionId === "search-session");
    assert.ok(ftsHit);
    assert.equal(ftsHit.entryId, "search-root");
    assert.equal(ftsHit.runId, "search-run");
    assert.equal(ftsHit.turn, 1);
    assert.ok((ftsHit.score ?? 0) > 0);
    assert.match(ftsHit.snippet ?? "", /flaky auth/);

    // Kind filter: the match is a message entry, so annotation-only search misses it.
    const annotationOnly = await search.call(persistence, { query: "flaky auth", kind: ["label", "summary"], limit: 10 });
    assert.equal(annotationOnly.items.length, 0);
    const annotationList = await search.call(persistence, { kind: "label", limit: 10 });
    assert.deepEqual(
      annotationList.items.map((hit) => hit.sessionId),
      ["other-session"],
    );
    await assert.rejects(() => search.call(persistence, { kind: "bogus" as never }), TypeError);

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
    const toolHits = await search.call(persistence, { query: "unindexed-tool-secret", limit: 10 });
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
    const scoped = await search.call(persistence, { query: "flaky auth", workspaceRoot: "/repo", limit: 10 });
    assert.deepEqual(
      scoped.items.map((hit) => hit.sessionId),
      ["search-session"],
    );
    const elsewhere = await search.call(persistence, { query: "flaky auth", workspaceRoot: "/elsewhere", limit: 10 });
    assert.deepEqual(
      elsewhere.items.map((hit) => hit.sessionId),
      ["other-ws-session"],
    );

    const byWorkspace = await search.call(persistence, { workspaceRoot: "/repo", limit: 10 });
    assert.deepEqual(
      byWorkspace.items.map((hit) => hit.sessionId),
      ["search-session"],
    );
    assert.equal(byWorkspace.items[0]?.metadata?.workspaceRoot, "/repo");
    // Safe display metadata carries the title; messageCount counts kind='message' entries only.
    assert.equal(byWorkspace.items[0]?.metadata?.title, "Auth flake fix");
    assert.equal(byWorkspace.items[0]?.messageCount, 1);

    const byProvider = await search.call(persistence, { provider: "anthropic", limit: 10 });
    assert.ok(byProvider.items.some((hit) => hit.sessionId === "search-session"));

    const owned = await search.call(persistence, { tenantId: "tenant-a", limit: 10 });
    assert.ok(owned.items.every((hit) => hit.sessionId === "search-session"));
    const missing = await search.call(persistence, { tenantId: "missing", limit: 10 });
    assert.equal(missing.items.length, 0);

    const page1 = await search.call(persistence, { limit: 1, order: "asc" });
    assert.equal(page1.items.length, 1);
    assert.ok(page1.nextCursor);
    const page2 = await search.call(persistence, { limit: 1, order: "asc", cursor: page1.nextCursor });
    assert.equal(page2.items.length, 1);
    assert.notEqual(page2.items[0]?.sessionId, page1.items[0]?.sessionId);

    await assert.rejects(() => search.call(persistence, { limit: 0 }), TypeError);
    await assert.rejects(() => search.call(persistence, { query: "x".repeat(16 * 1024 + 1) }), TypeError);

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
    const deduped = await search.call(persistence, { query: "flaky", limit: 10 });
    const searchSessionHits = deduped.items.filter((hit) => hit.sessionId === "search-session");
    assert.equal(searchSessionHits.length, 1);
    assert.ok(searchSessionHits[0]?.entryId === "search-root" || searchSessionHits[0]?.entryId === "search-summary");
    assert.ok((searchSessionHits[0]?.score ?? 0) > 0);

    persistence.close();
  });

  it("upserts session records and filters querySessions by id and metadata key under ownership", async () => {
    const persistence = createSqlitePersistence({ filename: tempDbPath("sessions") });
    const appendSession = persistence.appendSession;
    assert.ok(appendSession, "the sqlite store must implement the session-record upsert");
    const now = new Date().toISOString();

    await appendSession.call(persistence, {
      id: "conv-1",
      tenantId: "tenant-a",
      userId: "user-1",
      createdAt: now,
      updatedAt: now,
      metadata: { prismConversation: { state: "active", title: "first" } },
    });
    await appendSession.call(persistence, {
      id: "conv-2",
      tenantId: "tenant-a",
      userId: "user-1",
      createdAt: now,
      updatedAt: now,
      metadata: { prismConversation: { state: "active" } },
    });
    await appendSession.call(persistence, {
      id: "plain-1",
      tenantId: "tenant-a",
      userId: "user-1",
      createdAt: now,
      updatedAt: now,
    });

    // Upsert updates metadata/updatedAt but never ownership columns.
    await appendSession.call(persistence, {
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
  const targets = [new URL("../bun-runtime.ts", import.meta.url)];
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

describe("listSessions and deleteSession", () => {
  const at = (n: number) => new Date(Date.UTC(2026, 0, 2, 0, 0, n)).toISOString();

  /** One entry carrying an ownership stamp, the shape `entriesInScope` reads. */
  function stamped(id: string, sessionId: string, timestamp: string, tenantId?: string) {
    return {
      id,
      sessionId,
      timestamp,
      kind: "message" as const,
      message: { role: "user" as const, content: [{ type: "text" as const, text: `${sessionId} body` }] },
      ...(tenantId === undefined ? {} : { metadata: { tenantId } }),
    };
  }

  it("sqlite_list_sessions_filters_foreign_scope", async () => {
    const persistence = createSqlitePersistence({ filename: ":memory:" });
    await persistence.append(stamped("mine-1", "mine", at(1), "tenant-a"));
    await persistence.append(stamped("theirs-1", "theirs", at(2), "tenant-b"));
    await persistence.append(stamped("unstamped-1", "unstamped", at(3)));

    const scored = await persistence.listSessions({ tenantId: "tenant-a", limit: 100 });
    assert.deepEqual(
      scored.items.map((item) => item.sessionId),
      ["mine"],
    );
    assert.equal(scored.items[0]?.title, undefined);
    assert.equal(scored.items[0]?.messageCount, 1);
    assert.equal(typeof scored.items[0]?.leafId, "string");
    assert.equal(JSON.stringify(scored.items).includes("body"), false, "a session page must not carry transcript text");

    const unscoped = await persistence.listSessions({ limit: 100 });
    assert.deepEqual(
      unscoped.items.map((item) => item.sessionId),
      ["unstamped", "theirs", "mine"],
      "unscoped listing is newest-first",
    );
    assert.deepEqual((await persistence.listSessions({ tenantId: "missing", limit: 100 })).items, []);

    // The rule is every entry, not any entry: one unstamped append drops the session out of the scope.
    await persistence.append(stamped("mine-2", "mine", at(4)));
    assert.deepEqual((await persistence.listSessions({ tenantId: "tenant-a", limit: 100 })).items, []);
    const unscopedAgain = (await persistence.listSessions({ limit: 100 })).items;
    assert.ok(
      unscopedAgain.some((item) => item.sessionId === "mine"),
      "an unstamped append drops the session out of the named scope, not out of the store",
    );

    // One-row pages resume strictly after the served row through the keyset cursor.
    const first = await persistence.listSessions({ limit: 1 });
    assert.equal(first.items.length, 1);
    assert.equal(typeof first.nextCursor, "string");
    const second = await persistence.listSessions({ limit: 1, cursor: first.nextCursor });
    assert.notEqual(second.items[0]?.sessionId, first.items[0]?.sessionId);
    await assert.rejects(() => persistence.listSessions({ limit: 0 }), TypeError);
    await assert.rejects(() => persistence.listSessions({ limit: 101 }), TypeError);
    await assert.rejects(() => persistence.listSessions({ order: "sideways" as never }), TypeError);
    persistence.close();
  });

  it("sqlite_delete_session_is_one_transaction_and_cascades", async () => {
    const filename = tempDbPath("delete-cascade");
    const persistence = createSqlitePersistence({ filename });
    await persistence.append(stamped("doomed-1", "doomed", at(1), "tenant-a"));
    await persistence.append(stamped("kept-1", "kept", at(2), "tenant-a"));
    await persistence.appendRun({ id: "run-1", sessionId: "doomed", startedAt: at(1), tenantId: "tenant-a" });
    await persistence.appendEvent({
      id: "event-1",
      sessionId: "doomed",
      runId: "run-1",
      type: "run.started",
      timestamp: at(1),
      event: { type: "run.started", sessionId: "doomed", runId: "run-1" },
      redacted: false,
    });
    await persistence.appendToolCall({
      id: "tool-1",
      sessionId: "doomed",
      runId: "run-1",
      toolCallId: "call-1",
      name: "echo",
      arguments: {},
      status: "finished",
      startedAt: at(1),
      redacted: false,
    });
    await persistence.appendUsage({
      id: "usage-1",
      sessionId: "doomed",
      runId: "run-1",
      scope: "run_total",
      usage: { totalTokens: 1 },
      recordedAt: at(1),
    });
    const appendSession = persistence.appendSession;
    assert.ok(appendSession, "the sqlite store must expose the session-record upsert");
    await appendSession.call(persistence, { id: "doomed", tenantId: "tenant-a", createdAt: at(1), updatedAt: at(1) });
    await persistence.append({ ...stamped("branch-1", "doomed", at(3), "tenant-a"), parentId: "doomed-1" });

    // A refused delete (foreign scope) must not write anything.
    assert.equal(await persistence.deleteSession("doomed", { tenantId: "tenant-b" }), false);
    assert.equal((await persistence.list("doomed")).length, 2, "a refused delete must not remove entries");
    assert.equal((await persistence.queryRuns({ sessionId: "doomed" })).items.length, 1);
    assert.equal(await persistence.deleteSession("absent", { tenantId: "tenant-a" }), false);

    assert.equal(await persistence.deleteSession("doomed", { tenantId: "tenant-a" }), true);
    assert.equal((await persistence.list("doomed")).length, 0);
    assert.equal(await persistence.deleteSession("doomed", { tenantId: "tenant-a" }), false, "an absent session answers false");
    assert.equal((await persistence.list("kept")).length, 1, "deleteSession must not touch another session");
    assert.equal((await persistence.listSessions({ limit: 100 })).items.map((item) => item.sessionId).includes("kept"), true);
    persistence.close();

    // Every row the session owned is gone, in one transaction, at the raw-table level.
    const db = new Database(filename);
    for (const table of [
      "prism_session_entries",
      "prism_session_search_fts",
      "prism_session_append_idempotency",
      "prism_branches",
      "prism_runs",
      "prism_agent_events",
      "prism_agent_event_streams",
      "prism_tool_calls",
      "prism_usage",
    ]) {
      const rows = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE session_id = ?`).get("doomed") as { n: number };
      assert.equal(rows.n, 0, `${table} still holds rows for the deleted session`);
    }
    const record = db.prepare("SELECT COUNT(*) AS n FROM prism_sessions WHERE id = ?").get("doomed") as { n: number };
    assert.equal(record.n, 0, "prism_sessions still holds the deleted session record");
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM prism_sessions WHERE id = ?").get("kept") as { n: number }).n, 1);
    db.close();
  });
});

describe("sqlite open pragmas", () => {
  it("sets the busy timeout before the journal-mode pragma", () => {
    // Two connections opening the same file at once race on `journal_mode`; with the timeout still
    // unset the loser fails "database is locked" instead of waiting (scheduler-leases was flaky on it).
    const executed: string[] = [];
    configureSqliteDatabase({ exec: (sql: string) => executed.push(sql) } as unknown as Database, {});
    assert.equal(
      executed[0],
      `PRAGMA busy_timeout = ${DEFAULT_BUSY_TIMEOUT_MS}`,
      "the timeout must be set before any statement that takes a lock",
    );
    assert.ok(executed.includes("PRAGMA foreign_keys = ON"));
    assert.equal(executed.at(-1), "PRAGMA journal_mode = WAL");
  });
});
