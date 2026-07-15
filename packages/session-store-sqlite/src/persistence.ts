import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import {
  SessionAppendConflictError,
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
  type RunLedger,
  type RunQuery,
  type RunRecord,
  type SessionAppendOptions,
  type SessionBranchRead,
  type SessionEntry,
  type SessionEntryQuery,
  type SessionQuery,
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
  const insertIdempotency = db.prepare(
    `INSERT INTO prism_session_append_idempotency (
      session_id, expected_parent_id, idempotency_key, entry_id, created_at
    ) VALUES (?, ?, ?, ?, ?)`,
  );
  const listEntries = db.prepare(
    `SELECT * FROM prism_session_entries WHERE session_id = ? ORDER BY rowid ASC`,
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
      id, session_id, run_id, entry_id, usage, recorded_at,
      tenant_id, account_id, user_id, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const persistence: SqlitePersistence = {
    name: "sqlite",
    checkpoints: createSqliteCheckpointStore(db),
    leases: createSqliteLeaseStore(db),
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
const mapAgentDefinitionRow = rowToAgentDefinitionRecord;
const mapRetentionRow = rowToRetentionPolicy;
const mapMigrationRow = rowToMigrationRecord;

export { DEFAULT_BUSY_TIMEOUT_MS };
