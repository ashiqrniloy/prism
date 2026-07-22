import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import {
  SessionAppendConflictError,
  prepareRunFeedback,
  requireRunFeedbackOwnership,
  runFeedbackPageLimit,
  RunFeedbackError,
  DEFAULT_MAX_SESSION_SEARCH_FTS_CANDIDATES,
  DEFAULT_MAX_SESSION_SEARCH_SNIPPET_BYTES,
  SESSION_SEARCH_WORKSPACE_METADATA_KEY,
  resolveSessionSearchQuery,
  type AgentDefinitionQuery,
  type AgentEventQuery,
  type AgentEventRecord,
  type BranchQuery,
  type CheckpointStore,
  type LeaseStore,
  type MigrationQuery,
  type PersistencePage,
  type ProductionPersistenceStore,
  type RetentionPolicyQuery,
  type RunFeedbackQuery,
  type RunFeedbackRecord,
  type RunFeedbackStore,
  type RunLedger,
  type RunQuery,
  type RunRecord,
  type SessionAppendOptions,
  type SessionBranchRead,
  type SessionEntry,
  type SessionEntryQuery,
  type SessionQuery,
  type SessionSearchHit,
  type SessionSearchQuery,
  type SessionStore,
  type ToolCallQuery,
  type ToolCallRecord,
  type UsageQuery,
  type UsageRecord,
} from "@arnilo/prism";
import {
  applySqliteMigrations,
  assertSqliteSchemaReady,
  configureSqliteDatabase,
  maybeRestrictFileMode,
  verifyMigrationIdempotency,
} from "./migrations.js";
import {
  agentEventRecordToRow,
  decodeEntryCursor,
  encodeEntryCursor,
  parentKey,
  rowToAgentDefinitionRecord,
  rowToAgentEventRecord,
  rowToBranchRecord,
  rowToMigrationRecord,
  rowToRetentionPolicy,
  rowToRunRecord,
  rowToSessionEntry,
  rowToSessionRecord,
  rowToToolCallRecord,
  rowToUsageRecord,
  runRecordToRow,
  sessionEntryToRow,
  toolCallRecordToRow,
  usageRecordToRow,
  type SessionEntryRow,
} from "./row-mappers.js";
import { createSqliteCheckpointStore } from "./checkpoints.js";
import { createSqliteLeaseStore } from "./leases.js";
import type { SqlitePersistenceOptions } from "./types.js";
import { DEFAULT_BUSY_TIMEOUT_MS } from "./types.js";

export interface SqlitePersistence extends SessionStore, RunLedger, ProductionPersistenceStore {
  readonly name: "sqlite";
  readonly checkpoints: CheckpointStore;
  readonly leases: LeaseStore;
  readonly feedback: RunFeedbackStore;
  readonly metadata: Readonly<{
    readonly kind: "sqlite";
    readonly multiProcess: true;
    readonly driver: "better-sqlite3";
  }>;
  close(): void;
}

export function createSqlitePersistence(options: SqlitePersistenceOptions): SqlitePersistence {
  const ownsDatabase = !options.database;
  let db = options.database ?? openDatabase(options);

  if (!options.skipMigrations) {
    applySqliteMigrations(db);
    assertSqliteSchemaReady(db);
    verifyMigrationIdempotency(db);
  }

  const ensureSession = db.prepare(
    `INSERT INTO prism_sessions (id, created_at, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
  );
  const selectParent = db.prepare(
    `SELECT 1 FROM prism_session_entries WHERE id = ? AND session_id = ? LIMIT 1`,
  );
  const selectIdempotency = db.prepare(
    `SELECT entry_id FROM prism_session_append_idempotency
     WHERE session_id = ? AND expected_parent_id = ? AND idempotency_key = ?`,
  );
  const selectEntryById = db.prepare(`SELECT * FROM prism_session_entries WHERE id = ? LIMIT 1`);
  const insertEntry = db.prepare(
    `INSERT INTO prism_session_entries (
      id, session_id, parent_id, run_id, timestamp, kind, schema_version,
      message, event, model, previous_model, label, summary, data, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertSearchFts = db.prepare(
    `INSERT INTO prism_session_search_fts(session_id, entry_id, label, summary, body)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertIdempotency = db.prepare(
    `INSERT INTO prism_session_append_idempotency (
      session_id, expected_parent_id, idempotency_key, entry_id, created_at
    ) VALUES (?, ?, ?, ?, ?)`,
  );
  const listEntries = db.prepare(
    `SELECT * FROM prism_session_entries WHERE session_id = ? ORDER BY rowid ASC`,
  );
  const insertFeedback = db.prepare(
    `INSERT INTO prism_run_feedback (
      id, run_id, session_id, trace_id, rating, comment, tags, scorer_ids, evaluation_ids,
      created_at, created_by, tenant_id, account_id, user_id, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const upsertRun = db.prepare(
    `INSERT INTO prism_runs (
      id, session_id, branch_id, agent_definition_id, agent_definition_version,
      status, started_at, finished_at, model, provider, idempotency_key,
      abort_reason, error, tenant_id, account_id, user_id, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      finished_at = excluded.finished_at,
      started_at = CASE WHEN prism_runs.started_at IS NOT NULL AND prism_runs.started_at != '' THEN prism_runs.started_at ELSE excluded.started_at END,
      model = excluded.model,
      provider = excluded.provider,
      abort_reason = excluded.abort_reason,
      error = excluded.error,
      metadata = excluded.metadata`,
  );
  const nextEventSequence = db.prepare(
    `SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM prism_agent_events WHERE run_id = ?`,
  );
  const insertEvent = db.prepare(
    `INSERT INTO prism_agent_events (
      id, session_id, run_id, entry_id, sequence, type, timestamp, event,
      redacted, tenant_id, account_id, user_id, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertToolCall = db.prepare(
    `INSERT INTO prism_tool_calls (
      id, session_id, run_id, entry_id, tool_call_id, name, arguments, result,
      status, reason, progress, progress_metadata, progress_at, started_at,
      finished_at, redacted, tenant_id, account_id, user_id, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertUsage = db.prepare(
    `INSERT INTO prism_usage (
      id, session_id, run_id, entry_id, scope, turn, attempt, usage, recorded_at,
      tenant_id, account_id, user_id, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const feedback: RunFeedbackStore = {
    async append(input) {
      if (db.prepare("SELECT 1 FROM prism_run_feedback WHERE id = ?").get(input.id)) {
        throw new RunFeedbackError("Duplicate feedback id", "ERR_PRISM_RUN_FEEDBACK_DUPLICATE");
      }
      const record = await prepareRunFeedback(input, {
        redactor: options.feedbackRedactor,
        resolveRun: ({ runId, ownership }) => {
          const row = db.prepare(
            "SELECT id, session_id, tenant_id, account_id, user_id FROM prism_runs WHERE id = ? AND tenant_id = ? AND account_id IS ? AND user_id IS ? LIMIT 1",
          ).get(runId, ownership.tenantId, ownership.accountId ?? null, ownership.userId ?? null) as Record<string, unknown> | undefined;
          return row ? {
            runId: String(row.id),
            sessionId: String(row.session_id),
            tenantId: String(row.tenant_id),
            accountId: row.account_id === null ? undefined : String(row.account_id),
            userId: row.user_id === null ? undefined : String(row.user_id),
          } : false;
        },
      });
      insertFeedback.run(
        record.id, record.runId, record.sessionId, record.traceId ?? null, record.rating ?? null,
        record.comment ?? null, JSON.stringify(record.tags), JSON.stringify(record.scorerIds), JSON.stringify(record.evaluationIds),
        record.createdAt, record.createdBy ?? null, record.tenantId, record.accountId ?? null, record.userId ?? null,
        record.metadata === undefined ? null : JSON.stringify(record.metadata),
      );
      return record;
    },
    async query(query: RunFeedbackQuery) {
      requireRunFeedbackOwnership(query);
      query.signal?.throwIfAborted();
      const filters: string[] = [];
      const params: unknown[] = [];
      if (query.accountId === undefined) filters.push("account_id IS NULL");
      if (query.userId === undefined) filters.push("user_id IS NULL");
      if (query.runId) { filters.push("run_id = ?"); params.push(query.runId); }
      if (query.sessionId) { filters.push("session_id = ?"); params.push(query.sessionId); }
      if (query.traceId) { filters.push("trace_id = ?"); params.push(query.traceId); }
      if (query.rating !== undefined) { filters.push("rating = ?"); params.push(query.rating); }
      if (query.scorerId) { filters.push("EXISTS (SELECT 1 FROM json_each(scorer_ids) WHERE value = ?)"); params.push(query.scorerId); }
      if (query.evaluationId) { filters.push("EXISTS (SELECT 1 FROM json_each(evaluation_ids) WHERE value = ?)"); params.push(query.evaluationId); }
      if (query.tag) { filters.push("EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)"); params.push(query.tag); }
      if (query.fromCreatedAt) { filters.push("created_at >= ?"); params.push(query.fromCreatedAt); }
      if (query.toCreatedAt) { filters.push("created_at <= ?"); params.push(query.toCreatedAt); }
      return queryTable(db, "prism_run_feedback", { ...query, limit: runFeedbackPageLimit(query.limit) }, filters, mapFeedbackRow, params, "created_at", "id");
    },
    async delete(input) {
      input.signal?.throwIfAborted();
      const ownership = requireRunFeedbackOwnership(input);
      return db.prepare("DELETE FROM prism_run_feedback WHERE id = ? AND tenant_id = ? AND account_id IS ? AND user_id IS ?")
        .run(input.id, ownership.tenantId, ownership.accountId ?? null, ownership.userId ?? null).changes > 0;
    },
  };

  const persistence: SqlitePersistence = {
    name: "sqlite",
    checkpoints: createSqliteCheckpointStore(db),
    leases: createSqliteLeaseStore(db),
    feedback,
    metadata: { kind: "sqlite", multiProcess: true, driver: "better-sqlite3" },

    async append(entry: SessionEntry, appendOptions?: SessionAppendOptions): Promise<void> {
      const now = new Date().toISOString();
      const appendTx = db.transaction(() => {
        ensureSession.run(entry.sessionId, now, now);

        if (appendOptions?.expectedParentId) {
          const parent = selectParent.get(appendOptions.expectedParentId, entry.sessionId);
          if (!parent) {
            throw new SessionAppendConflictError({
              code: "session_append_conflict",
              expectedParentId: appendOptions.expectedParentId,
            });
          }
        }

        const expectedParent = parentKey(appendOptions?.expectedParentId);
        if (appendOptions?.idempotencyKey) {
          const existing = selectIdempotency.get(entry.sessionId, expectedParent, appendOptions.idempotencyKey) as
            | { entry_id: string }
            | undefined;
          if (existing) {
            throw new SessionAppendConflictError({
              code: "session_append_conflict",
              idempotencyDuplicate: true,
            });
          }
        }

        const duplicate = selectEntryById.get(entry.id);
        if (duplicate) {
          throw new Error(`Duplicate session entry id: ${entry.id}`);
        }

        const row = sessionEntryToRow(entry);
        insertEntry.run(
          row.id,
          row.session_id,
          row.parent_id,
          row.run_id,
          row.timestamp,
          row.kind,
          row.schema_version,
          row.message,
          row.event,
          row.model,
          row.previous_model,
          row.label,
          row.summary,
          row.data,
          row.metadata,
        );
        const search = entrySearchFields(entry);
        insertSearchFts.run(row.session_id, row.id, search.label, search.summary, search.body);

        if (appendOptions?.idempotencyKey) {
          insertIdempotency.run(
            entry.sessionId,
            expectedParent,
            appendOptions.idempotencyKey,
            entry.id,
            now,
          );
        }
      });

      appendTx();
    },

    async list(sessionId: string): Promise<readonly SessionEntry[]> {
      return (listEntries.all(sessionId) as SessionEntryRow[]).map(rowToSessionEntry);
    },

    async get(id: string): Promise<SessionEntry | undefined> {
      const row = selectEntryById.get(id) as SessionEntryRow | undefined;
      return row ? rowToSessionEntry(row) : undefined;
    },

    async readBranchPath(query: SessionBranchRead): Promise<PersistencePage<SessionEntry>> {
      const leafId = query.leafId ?? findLatestLeafId(db, query.sessionId);
      if (!leafId) return { items: [] };

      const rows = db
        .prepare(
          `WITH RECURSIVE branch_path(id, depth) AS (
             SELECT id, 0 FROM prism_session_entries WHERE id = ? AND session_id = ?
             UNION ALL
             SELECT parent.id, bp.depth + 1
             FROM branch_path bp
             INNER JOIN prism_session_entries current ON current.id = bp.id
             INNER JOIN prism_session_entries parent ON parent.id = current.parent_id
             WHERE current.session_id = ?
           )
           SELECT e.* FROM prism_session_entries e
           INNER JOIN branch_path bp ON e.id = bp.id
           ORDER BY bp.depth DESC, e.timestamp ASC, e.id ASC`,
        )
        .all(leafId, query.sessionId, query.sessionId) as SessionEntryRow[];

      const limit = query.limit ?? rows.length;
      const start = query.cursor ? decodeBranchCursor(query.cursor) : 0;
      const slice = rows.slice(start, start + limit);
      const nextStart = start + slice.length;
      return {
        items: slice.map(rowToSessionEntry),
        nextCursor: nextStart < rows.length ? encodeBranchCursor(nextStart) : undefined,
      };
    },

    appendRun(record: RunRecord): void {
      ensureSession.run(record.sessionId, record.startedAt, record.startedAt);
      const row = runRecordToRow(record);
      upsertRun.run(
        row.id,
        row.session_id,
        row.branch_id,
        row.agent_definition_id,
        row.agent_definition_version,
        row.status,
        row.started_at,
        row.finished_at,
        row.model,
        row.provider,
        row.idempotency_key,
        row.abort_reason,
        row.error,
        row.tenant_id,
        row.account_id,
        row.user_id,
        row.metadata,
      );
    },

    appendEvent(record: AgentEventRecord): void {
      ensureSession.run(record.sessionId, record.timestamp, record.timestamp);
      const sequenceRow = nextEventSequence.get(record.runId ?? "") as { next_sequence: number } | undefined;
      const sequence = sequenceRow?.next_sequence ?? 1;
      const row = agentEventRecordToRow(record, sequence);
      insertEvent.run(
        row.id,
        row.session_id,
        row.run_id,
        row.entry_id,
        row.sequence,
        row.type,
        row.timestamp,
        row.event,
        row.redacted,
        row.tenant_id,
        row.account_id,
        row.user_id,
        row.metadata,
      );
    },

    appendToolCall(record: ToolCallRecord): void {
      ensureSession.run(record.sessionId, record.startedAt, record.startedAt);
      const row = toolCallRecordToRow(record);
      insertToolCall.run(
        row.id,
        row.session_id,
        row.run_id,
        row.entry_id,
        row.tool_call_id,
        row.name,
        row.arguments,
        row.result,
        row.status,
        row.reason,
        row.progress,
        row.progress_metadata,
        row.progress_at,
        row.started_at,
        row.finished_at,
        row.redacted,
        row.tenant_id,
        row.account_id,
        row.user_id,
        row.metadata,
      );
    },

    appendUsage(record: UsageRecord): void {
      ensureSession.run(record.sessionId, record.recordedAt, record.recordedAt);
      const row = usageRecordToRow(record);
      insertUsage.run(
        row.id,
        row.session_id,
        row.run_id,
        row.entry_id,
        row.scope,
        row.turn,
        row.attempt,
        row.usage,
        row.recorded_at,
        row.tenant_id,
        row.account_id,
        row.user_id,
        row.metadata,
      );
    },

    async querySessions(query: SessionQuery): Promise<PersistencePage<ReturnType<typeof rowToSessionRecord>>> {
      return queryTable(db, "prism_sessions", query, [], mapSessionRow);
    },

    async searchSessions(query: SessionSearchQuery): Promise<PersistencePage<SessionSearchHit>> {
      return searchSqliteSessions(db, query);
    },

    async queryBranches(query: BranchQuery): Promise<PersistencePage<ReturnType<typeof rowToBranchRecord>>> {
      const filters: string[] = [];
      const params: unknown[] = [];
      if (query.sessionId) {
        filters.push("session_id = ?");
        params.push(query.sessionId);
      }
      if (query.name) {
        filters.push("name = ?");
        params.push(query.name);
      }
      if (query.parentBranchId) {
        filters.push("parent_branch_id = ?");
        params.push(query.parentBranchId);
      }
      if (query.hasLeaf === true) filters.push("leaf_entry_id IS NOT NULL");
      if (query.hasLeaf === false) filters.push("leaf_entry_id IS NULL");
      return queryTable(db, "prism_branches", query, filters, mapBranchRow, params, "created_at", "id");
    },

    async queryEntries(query: SessionEntryQuery): Promise<PersistencePage<SessionEntry>> {
      const filters: string[] = [];
      const params: unknown[] = [];
      if (query.sessionId) {
        filters.push("session_id = ?");
        params.push(query.sessionId);
      }
      if (query.runId) {
        filters.push("run_id = ?");
        params.push(query.runId);
      }
      if (query.parentId) {
        filters.push("parent_id = ?");
        params.push(query.parentId);
      }
      if (query.leafId) {
        const chain = await persistence.readBranchPath!({ sessionId: query.sessionId ?? "", leafId: query.leafId });
        return { items: chain.items.slice(0, query.limit ?? chain.items.length) };
      }
      if (query.kind) {
        if (Array.isArray(query.kind)) {
          filters.push(`kind IN (${query.kind.map(() => "?").join(", ")})`);
          params.push(...query.kind);
        } else {
          filters.push("kind = ?");
          params.push(query.kind);
        }
      }
      if (query.fromTimestamp) {
        filters.push("timestamp >= ?");
        params.push(query.fromTimestamp);
      }
      if (query.toTimestamp) {
        filters.push("timestamp <= ?");
        params.push(query.toTimestamp);
      }
      const order = query.order === "desc" ? "DESC" : "ASC";
      if (query.cursor) {
        const cursor = decodeEntryCursor(query.cursor);
        if (order === "ASC") {
          filters.push("(timestamp > ? OR (timestamp = ? AND id > ?))");
          params.push(cursor.timestamp, cursor.timestamp, cursor.id);
        } else {
          filters.push("(timestamp < ? OR (timestamp = ? AND id < ?))");
          params.push(cursor.timestamp, cursor.timestamp, cursor.id);
        }
      }

      const limit = query.limit ?? 100;
      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const rows = db
        .prepare(
          `SELECT * FROM prism_session_entries ${where}
           ORDER BY timestamp ${order}, id ${order}
           LIMIT ?`,
        )
        .all(...params, limit + 1) as SessionEntryRow[];
      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const last = pageRows.at(-1);
      return {
        items: pageRows.map(rowToSessionEntry),
        nextCursor: hasMore && last ? encodeEntryCursor(last.timestamp, last.id) : undefined,
      };
    },

    async queryRuns(query: RunQuery): Promise<PersistencePage<RunRecord>> {
      const filters: string[] = [];
      const params: unknown[] = [];
      if (query.sessionId) {
        filters.push("session_id = ?");
        params.push(query.sessionId);
      }
      if (query.branchId) {
        filters.push("branch_id = ?");
        params.push(query.branchId);
      }
      if (query.status) {
        const statuses = Array.isArray(query.status) ? query.status : [query.status];
        filters.push(`status IN (${statuses.map(() => "?").join(", ")})`);
        params.push(...statuses);
      }
      return queryTable(db, "prism_runs", query, filters, mapRunRow, params, "started_at", "id");
    },

    async queryEvents(query: AgentEventQuery): Promise<PersistencePage<ReturnType<typeof rowToAgentEventRecord>>> {
      const filters: string[] = [];
      const params: unknown[] = [];
      if (query.sessionId) {
        filters.push("session_id = ?");
        params.push(query.sessionId);
      }
      if (query.runId) {
        filters.push("run_id = ?");
        params.push(query.runId);
      }
      if (query.type) {
        const types = Array.isArray(query.type) ? query.type : [query.type];
        filters.push(`type IN (${types.map(() => "?").join(", ")})`);
        params.push(...types);
      }
      return queryTable(db, "prism_agent_events", query, filters, mapEventRow, params, "timestamp", "id");
    },

    async queryToolCalls(query: ToolCallQuery): Promise<PersistencePage<ReturnType<typeof rowToToolCallRecord>>> {
      const filters: string[] = [];
      const params: unknown[] = [];
      if (query.sessionId) {
        filters.push("session_id = ?");
        params.push(query.sessionId);
      }
      if (query.runId) {
        filters.push("run_id = ?");
        params.push(query.runId);
      }
      if (query.name) {
        filters.push("name = ?");
        params.push(query.name);
      }
      return queryTable(db, "prism_tool_calls", query, filters, mapToolCallRow, params, "started_at", "id");
    },

    async queryUsage(query: UsageQuery): Promise<PersistencePage<ReturnType<typeof rowToUsageRecord>>> {
      const filters: string[] = [];
      const params: unknown[] = [];
      if (query.sessionId) {
        filters.push("session_id = ?");
        params.push(query.sessionId);
      }
      if (query.runId) {
        filters.push("run_id = ?");
        params.push(query.runId);
      }
      if (query.scope) {
        filters.push("scope = ?");
        params.push(query.scope);
      }
      if (query.turn !== undefined) {
        filters.push("turn = ?");
        params.push(query.turn);
      }
      if (query.attempt !== undefined) {
        filters.push("attempt = ?");
        params.push(query.attempt);
      }
      return queryTable(db, "prism_usage", query, filters, mapUsageRow, params, "recorded_at", "id");
    },

    async queryAgentDefinitions(query: AgentDefinitionQuery) {
      const filters: string[] = [];
      const params: unknown[] = [];
      if (query.name) {
        filters.push("name = ?");
        params.push(query.name);
      }
      if (query.version) {
        filters.push("version = ?");
        params.push(query.version);
      }
      return queryTable(db, "prism_agent_definitions", query, filters, mapAgentDefinitionRow, params, "created_at", "id");
    },

    async queryRetentionPolicies(query: RetentionPolicyQuery) {
      const filters: string[] = [];
      const params: unknown[] = [];
      if (query.name) {
        filters.push("name = ?");
        params.push(query.name);
      }
      return queryTable(db, "prism_retention_policies", query, filters, mapRetentionRow, params, "created_at", "id");
    },

    async queryMigrations(query: MigrationQuery) {
      const filters: string[] = [];
      const params: unknown[] = [];
      if (query.name) {
        filters.push("name = ?");
        params.push(query.name);
      }
      if (query.version) {
        filters.push("version = ?");
        params.push(query.version);
      }
      return queryTable(db, "prism_migrations", query, filters, mapMigrationRow, params, "applied_at", "id");
    },

    close(): void {
      if (ownsDatabase) {
        db.close();
      }
    },
  };

  return persistence;
}

export function reopenSqlitePersistence(options: SqlitePersistenceOptions): SqlitePersistence {
  return createSqlitePersistence(options);
}

function openDatabase(options: SqlitePersistenceOptions): Database.Database {
  if (options.filename !== ":memory:") {
    mkdirSync(dirname(options.filename), { recursive: true });
  }
  const db = new Database(options.filename);
  configureSqliteDatabase(db, options);
  maybeRestrictFileMode(options.filename, options.fileMode);
  return db;
}

function findLatestLeafId(db: Database.Database, sessionId: string): string | undefined {
  const row = db
    .prepare(
      `SELECT e.id FROM prism_session_entries e
       WHERE e.session_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM prism_session_entries child
           WHERE child.session_id = e.session_id AND child.parent_id = e.id
         )
       ORDER BY e.timestamp DESC, e.id DESC
       LIMIT 1`,
    )
    .get(sessionId) as { id: string } | undefined;
  return row?.id;
}

function searchSqliteSessions(db: Database.Database, query: SessionSearchQuery): PersistencePage<SessionSearchHit> {
  const q = resolveSessionSearchQuery(query);
  q.signal?.throwIfAborted();

  const filters: string[] = [];
  const params: unknown[] = [];
  if (q.tenantId) { filters.push("s.tenant_id = ?"); params.push(q.tenantId); }
  if (q.accountId) { filters.push("s.account_id = ?"); params.push(q.accountId); }
  if (q.userId) { filters.push("s.user_id = ?"); params.push(q.userId); }
  if (q.workspaceRoot) {
    filters.push(`json_extract(s.metadata, '$.${SESSION_SEARCH_WORKSPACE_METADATA_KEY}') = ?`);
    params.push(q.workspaceRoot);
  }
  if (q.fromUpdatedAt) { filters.push("s.updated_at >= ?"); params.push(q.fromUpdatedAt); }
  if (q.toUpdatedAt) { filters.push("s.updated_at <= ?"); params.push(q.toUpdatedAt); }
  if (q.label) {
    filters.push("EXISTS (SELECT 1 FROM prism_session_entries e WHERE e.session_id = s.id AND instr(e.label, ?) > 0)");
    params.push(q.label);
  }
  if (q.summary) {
    filters.push("EXISTS (SELECT 1 FROM prism_session_entries e WHERE e.session_id = s.id AND instr(e.summary, ?) > 0)");
    params.push(q.summary);
  }
  if (q.provider) {
    filters.push("EXISTS (SELECT 1 FROM prism_runs r WHERE r.session_id = s.id AND r.provider = ?)");
    params.push(q.provider);
  }
  if (q.model) {
    filters.push("EXISTS (SELECT 1 FROM prism_runs r WHERE r.session_id = s.id AND json_extract(r.model, '$.model') = ?)");
    params.push(q.model);
  }
  if (q.query) {
    filters.push(
      `s.id IN (
         SELECT session_id FROM prism_session_search_fts
         WHERE prism_session_search_fts MATCH ?
         LIMIT ${DEFAULT_MAX_SESSION_SEARCH_FTS_CANDIDATES}
       )`,
    );
    params.push(fts5Phrase(q.query));
  }

  const order = q.order === "asc" ? "ASC" : "DESC";
  if (q.cursor) {
    const cursor = decodeEntryCursor(q.cursor);
    if (order === "ASC") {
      filters.push("(s.updated_at > ? OR (s.updated_at = ? AND s.id > ?))");
    } else {
      filters.push("(s.updated_at < ? OR (s.updated_at = ? AND s.id < ?))");
    }
    params.push(cursor.timestamp, cursor.timestamp, cursor.id);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const rows = db.prepare(
    `SELECT s.id AS session_id, s.updated_at, s.metadata,
       (
         SELECT e.label FROM prism_session_entries e
         WHERE e.session_id = s.id AND e.label IS NOT NULL
         ORDER BY e.timestamp DESC, e.id DESC LIMIT 1
       ) AS label,
       (
         SELECT e.summary FROM prism_session_entries e
         WHERE e.session_id = s.id AND e.summary IS NOT NULL
         ORDER BY e.timestamp DESC, e.id DESC LIMIT 1
       ) AS summary
     FROM prism_sessions s
     ${where}
     ORDER BY s.updated_at ${order}, s.id ${order}
     LIMIT ?`,
  ).all(...params, q.limit + 1) as Array<{
    session_id: string;
    updated_at: string;
    metadata: string | null;
    label: string | null;
    summary: string | null;
  }>;

  q.signal?.throwIfAborted();
  const hasMore = rows.length > q.limit;
  const pageRows = hasMore ? rows.slice(0, q.limit) : rows;
  const items: SessionSearchHit[] = pageRows.map((row) => {
    const metadata = parseSessionMetadata(row.metadata);
    const hit: SessionSearchHit = {
      sessionId: row.session_id,
      leafId: findLatestLeafId(db, row.session_id),
      updatedAt: row.updated_at,
      label: row.label ?? undefined,
      summary: row.summary ?? undefined,
      snippet: clipSearchSnippet(row.label ?? row.summary ?? undefined),
      metadata: safeSearchMetadata(metadata),
    };
    return hit;
  });
  const last = pageRows.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeEntryCursor(last.updated_at, last.session_id) : undefined,
  };
}

function entrySearchFields(entry: SessionEntry): { label: string; summary: string; body: string } {
  const texts: string[] = [];
  for (const block of entry.message?.content ?? []) {
    if (block.type === "text" && typeof block.text === "string") texts.push(block.text);
  }
  // ponytail: 64KiB body cap keeps FTS dual-write bounded; raise if hosts need longer message search.
  return {
    label: entry.label ?? "",
    summary: entry.summary ?? "",
    body: texts.join("\n").slice(0, 64 * 1024),
  };
}

function fts5Phrase(query: string): string {
  return `"${query.replaceAll('"', '""')}"`;
}

function clipSearchSnippet(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= DEFAULT_MAX_SESSION_SEARCH_SNIPPET_BYTES) return value;
  return new TextDecoder().decode(bytes.slice(0, DEFAULT_MAX_SESSION_SEARCH_SNIPPET_BYTES));
}

function parseSessionMetadata(raw: string | null): Readonly<Record<string, unknown>> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Readonly<Record<string, unknown>>
      : undefined;
  } catch {
    return undefined;
  }
}

function safeSearchMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (!metadata) return undefined;
  const workspaceRoot = metadata[SESSION_SEARCH_WORKSPACE_METADATA_KEY];
  if (typeof workspaceRoot !== "string") return undefined;
  return { [SESSION_SEARCH_WORKSPACE_METADATA_KEY]: workspaceRoot };
}

function buildOwnershipFilters(scope: { tenantId?: string; accountId?: string; userId?: string }): string[] {
  const filters: string[] = [];
  if (scope.tenantId) filters.push("tenant_id = ?");
  if (scope.accountId) filters.push("account_id = ?");
  if (scope.userId) filters.push("user_id = ?");
  return filters;
}

function ownershipParams(scope: { tenantId?: string; accountId?: string; userId?: string }): unknown[] {
  const params: unknown[] = [];
  if (scope.tenantId) params.push(scope.tenantId);
  if (scope.accountId) params.push(scope.accountId);
  if (scope.userId) params.push(scope.userId);
  return params;
}

function queryTable<T>(
  db: Database.Database,
  table: string,
  query: { cursor?: string; limit?: number; order?: "asc" | "desc"; tenantId?: string; accountId?: string; userId?: string },
  filters: string[],
  mapRow: (row: Record<string, unknown>) => T,
  baseParams: unknown[] = [],
  sortColumn = "created_at",
  idColumn = "id",
): PersistencePage<T> {
  const order = query.order === "desc" ? "DESC" : "ASC";
  const allFilters = [...filters, ...buildOwnershipFilters(query)];
  const allParams = [...baseParams, ...ownershipParams(query)];
  if (query.cursor) {
    const cursor = decodeEntryCursor(query.cursor);
    if (order === "ASC") {
      allFilters.push(`(${sortColumn} > ? OR (${sortColumn} = ? AND ${idColumn} > ?))`);
      allParams.push(cursor.timestamp, cursor.timestamp, cursor.id);
    } else {
      allFilters.push(`(${sortColumn} < ? OR (${sortColumn} = ? AND ${idColumn} < ?))`);
      allParams.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
  }

  const limit = query.limit ?? 100;
  const where = allFilters.length ? `WHERE ${allFilters.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT * FROM ${table} ${where}
       ORDER BY ${sortColumn} ${order}, ${idColumn} ${order}
       LIMIT ?`,
    )
    .all(...allParams, limit + 1) as Record<string, unknown>[];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);
  return {
    items: pageRows.map(mapRow),
    nextCursor:
      hasMore && last
        ? encodeEntryCursor(String(last[sortColumn]), String(last[idColumn]))
        : undefined,
  };
}

function encodeBranchCursor(offset: number): string {
  return String(offset);
}

function decodeBranchCursor(cursor: string): number {
  const value = Number(cursor);
  if (!Number.isInteger(value) || value < 0) throw new Error("Invalid branch pagination cursor");
  return value;
}

const mapSessionRow = rowToSessionRecord;
const mapBranchRow = rowToBranchRecord;
const mapRunRow = (row: Record<string, unknown>) => rowToRunRecord(row as never);
const mapEventRow = (row: Record<string, unknown>) => rowToAgentEventRecord(row as never);
const mapToolCallRow = (row: Record<string, unknown>) => rowToToolCallRecord(row as never);
const mapUsageRow = (row: Record<string, unknown>) => rowToUsageRecord(row as never);
const mapFeedbackRow = (row: Record<string, unknown>): RunFeedbackRecord => Object.freeze({
  id: String(row.id),
  runId: String(row.run_id),
  sessionId: String(row.session_id),
  traceId: row.trace_id === null ? undefined : String(row.trace_id),
  rating: row.rating === null ? undefined : Number(row.rating),
  comment: row.comment === null ? undefined : String(row.comment),
  tags: Object.freeze(parseStringArray(row.tags)),
  scorerIds: Object.freeze(parseStringArray(row.scorer_ids)),
  evaluationIds: Object.freeze(parseStringArray(row.evaluation_ids)),
  createdAt: String(row.created_at),
  createdBy: row.created_by === null ? undefined : String(row.created_by),
  tenantId: String(row.tenant_id),
  accountId: row.account_id === null ? undefined : String(row.account_id),
  userId: row.user_id === null ? undefined : String(row.user_id),
  metadata: row.metadata === null ? undefined : deepFreeze(JSON.parse(String(row.metadata)) as Readonly<Record<string, unknown>>),
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function parseStringArray(value: unknown): string[] {
  const parsed: unknown = JSON.parse(String(value));
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) throw new RunFeedbackError("Invalid stored feedback array");
  return parsed;
}
const mapAgentDefinitionRow = rowToAgentDefinitionRecord;
const mapRetentionRow = rowToRetentionPolicy;
const mapMigrationRow = rowToMigrationRecord;

export { DEFAULT_BUSY_TIMEOUT_MS };
