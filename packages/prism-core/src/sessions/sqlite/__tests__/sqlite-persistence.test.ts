import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { createSecretRedactor } from "@arnilo/prism";
import { runFeedbackConformance } from "@arnilo/prism/testing/feedback";
import {
  assertPersistenceQueryPaginationConforms,
  assertTenantScopedQueryIsolation,
  createPersistenceMigrationContract,
} from "@arnilo/prism/testing/persistence-schema";
import { runRunLedgerConformance } from "@arnilo/prism/testing/run-ledger-conformance";
import { runSessionStoreConformance } from "@arnilo/prism/testing/session-store-conformance";
import Database from "better-sqlite3";
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
      tenantId: "tenant-a",
    });
    first.close();

    const reopened = createSqlitePersistence({ filename });
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

  it("searches sessions by label, FTS message text, workspace, and ownership", async () => {
    const filename = tempDbPath("search");
    const persistence = createSqlitePersistence({ filename });
    await persistence.append({
      id: "search-root",
      sessionId: "search-session",
      timestamp: "2026-01-01T00:00:00.000Z",
      kind: "message",
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
    ).run("tenant-a", JSON.stringify({ workspaceRoot: "/repo" }), "search-session");
    db.close();

    const byLabel = await persistence.searchSessions!({ label: "auth-flake", limit: 10 });
    assert.equal(byLabel.items.length, 1);
    assert.equal(byLabel.items[0]?.sessionId, "search-session");
    assert.equal(byLabel.items[0]?.leafId, "search-root");

    const byFts = await persistence.searchSessions!({ query: "flaky auth", limit: 10 });
    assert.ok(byFts.items.some((hit) => hit.sessionId === "search-session"));

    const byWorkspace = await persistence.searchSessions!({ workspaceRoot: "/repo", limit: 10 });
    assert.deepEqual(
      byWorkspace.items.map((hit) => hit.sessionId),
      ["search-session"],
    );
    assert.equal(byWorkspace.items[0]?.metadata?.workspaceRoot, "/repo");

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
