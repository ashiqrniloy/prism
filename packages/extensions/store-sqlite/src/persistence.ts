import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  type EvaluationQuery,
  type EvaluationStore,
  type ExperimentReportQuery,
  type ExperimentReportStore,
  type AgentDefinitionQuery,
  type AgentEventQuery,
  type AgentEventRecord,
  assertSessionLinkFilter,
  assertSessionMetadataKey,
  type BranchQuery,
  DEFAULT_MAX_SESSION_SEARCH_FTS_CANDIDATES,
  DEFAULT_SESSION_LIST_LIMIT,
  HARD_MAX_SESSION_LIST_LIMIT,
  type MigrationQuery,
  type OwnershipScope,
  type PersistencePage,
  type ProductionPersistenceStore,
  type ResolvedSessionSearchQuery,
  type RetentionPolicyQuery,
  type RunFeedbackQuery,
  type RunFeedbackStore,
  type RunLedger,
  type RunQuery,
  type RunRecord,
  resolveSessionSearchQuery,
  SESSION_METADATA_CONFLICT_CODE,
  SESSION_SEARCH_WORKSPACE_METADATA_KEY,
  SESSION_TITLE_METADATA_KEY,
  SessionAppendConflictError,
  type SessionAppendOptions,
  type SessionBranchRead,
  type SessionEntry,
  type SessionEntryQuery,
  type SessionListQuery,
  SessionMetadataConflictError,
  type SessionQuery,
  type SessionSearchHit,
  type SessionSearchQuery,
  type SessionStore,
  type SessionSummary,
  type ToolCallQuery,
  type ToolCallRecord,
  type UsageQuery,
  type UsageRecord,
} from "@arnilo/prism";
import {
  prepareEvaluationRecord,
  prepareExperimentReportRecord,
  EvaluationStoreError,
  canonicalSessionTimestamp,
  clipSearchSnippet,
  createSessionRowMappers,
  decodeBranchCursor,
  encodeBranchCursor,
  entrySearchFields,
  rowToRunFeedbackRecord as mapFeedbackRow,
  ownershipColumns,
  parseSessionMetadata,
  prepareRunFeedback,
  RunFeedbackError,
  requireRunFeedbackOwnership,
  runFeedbackPageLimit,
  SESSION_LINK_COLUMN_NAMES,
  type SessionEntryRow,
  safeSearchMetadata,
  sessionLinkColumns,
  sessionLinkFilterColumns,
  sessionLinkSummaryFields,
} from "@arnilo/prism-extensions/store-codecs";
import type { CheckpointStore, LeaseStore } from "@arnilo/prism-extensions/workflows";
import { BunSqlite } from "./bun-runtime.js";
import {
  applySqliteMigrations,
  assertSqliteSchemaReady,
  configureSqliteDatabase,
  maybeRestrictFileMode,
  verifyMigrationIdempotency,
} from "./migrations.js";

const {
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
} = createSessionRowMappers<number>({
  encode: (redacted) => (redacted ? 1 : 0),
  decode: (redacted) => redacted === 1,
});

import { createSqliteCheckpointStore } from "./checkpoints.js";
import { createSqliteLeaseStore } from "./leases.js";
import { createSqlitePersistenceLifecycle } from "./lifecycle.js";
import type { SqlitePersistenceOptions } from "./types.js";
import { DEFAULT_BUSY_TIMEOUT_MS } from "./types.js";

export interface SqlitePersistence extends SessionStore, RunLedger, ProductionPersistenceStore {
  readonly name: "sqlite";
  readonly checkpoints: CheckpointStore;
  readonly leases: LeaseStore;
  readonly feedback: RunFeedbackStore;
  readonly evaluations: EvaluationStore;
  readonly experiments: ExperimentReportStore;
  readonly lifecycle: import("@arnilo/prism-extensions/store-codecs").PersistenceLifecycleStore;
  readonly metadata: Readonly<{
    readonly kind: "sqlite";
    readonly multiProcess: true;
    readonly driver: "bun:sqlite";
  }>;
  /** Bounded session listing: entry-metadata ownership scope, newest-first by `updated_at`/`id`, keyset cursor. */
  listSessions(query: SessionListQuery): Promise<PersistencePage<SessionSummary>>;
  /** Removes every row the session owns in one transaction; resolves `false` for an absent, entry-less, or foreign-scope session. */
  deleteSession(sessionId: string, scope?: OwnershipScope): Promise<boolean>;
  /**
   * Merge `patch` into the stored session metadata and bump `version`; never rewrites
   * keys outside `patch`, and never touches `updated_at` (last activity stays entry-driven).
   * `options.onlyIfMissing` skips the write when any named key is already present.
   * Returns `undefined` when the session row does not exist.
   */
  mergeSessionMetadata(
    id: string,
    patch: Readonly<Record<string, unknown>>,
    options?: { readonly onlyIfMissing?: readonly string[] },
  ): { readonly version: number } | undefined;
  close(): void;
}

export function createSqlitePersistence(options: SqlitePersistenceOptions): SqlitePersistence {
  const ownsDatabase = !options.database;
  const db = options.database ?? openDatabase(options);

  if (!options.skipMigrations) {
    applySqliteMigrations(db);
    assertSqliteSchemaReady(db);
    verifyMigrationIdempotency(db);
  }

  // ponytail: julianday compares legacy offsets at millisecond precision; migrate legacy sub-ms rows if finer ordering is needed.
  const ensureSession = db.prepare(
    `INSERT INTO prism_sessions (id, created_at, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
     WHERE julianday(excluded.updated_at) > julianday(prism_sessions.updated_at)`,
  );
  const upsertSessionRecord = db.prepare(
    `INSERT INTO prism_sessions (
      id, tenant_id, account_id, user_id, parent_session_id,
      agent_definition_id, agent_definition_version, created_at, updated_at,
      expires_at, retention_policy_id, metadata, version
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1
    WHERE ? IS NULL OR ? = 0 OR EXISTS (SELECT 1 FROM prism_sessions WHERE id = ?)
    ON CONFLICT(id) DO UPDATE SET
      updated_at = excluded.updated_at,
      metadata = excluded.metadata,
      version = prism_sessions.version + 1
    WHERE (? IS NULL)
       OR (? > 0 AND prism_sessions.version = ? AND tenant_id IS ? AND account_id IS ? AND user_id IS ?)
    RETURNING version`,
  );
  const setSessionLinks = db.prepare(
    `UPDATE prism_sessions SET ${SESSION_LINK_COLUMN_NAMES.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`,
  );
  const selectSessionVersion = db.prepare(`SELECT version FROM prism_sessions WHERE id = ?`);
  const selectParent = db.prepare(`SELECT 1 FROM prism_session_entries WHERE id = ? AND session_id = ? LIMIT 1`);
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
  const listEntries = db.prepare(`SELECT * FROM prism_session_entries WHERE session_id = ? ORDER BY rowid ASC`);
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
      abort_reason, error, tenant_id, account_id, user_id, metadata, prompt_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      finished_at = excluded.finished_at,
      started_at = CASE WHEN prism_runs.started_at IS NOT NULL AND prism_runs.started_at != '' THEN prism_runs.started_at ELSE excluded.started_at END,
      model = excluded.model,
      provider = excluded.provider,
      abort_reason = excluded.abort_reason,
      error = excluded.error,
      metadata = excluded.metadata,
      prompt_version = excluded.prompt_version`,
  );
  const nextEventSequence = db.prepare(
    `INSERT INTO prism_agent_event_streams (session_id, run_id, next_sequence, updated_at)
     VALUES (?, ?, 2, ?)
     ON CONFLICT(session_id, run_id) DO UPDATE SET
       next_sequence = prism_agent_event_streams.next_sequence + 1,
       updated_at = excluded.updated_at
     RETURNING next_sequence - 1 AS sequence`,
  );
  const insertEvent = db.prepare(
    `INSERT INTO prism_agent_events (
      id, session_id, run_id, entry_id, sequence, type, timestamp, event,
      redacted, tenant_id, account_id, user_id, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const appendEventRecord = db.transaction((record: AgentEventRecord) => {
    const timestamp = canonicalSessionTimestamp(record.timestamp);
    ensureSession.run(record.sessionId, timestamp, timestamp);
    const sequence = Number(
      (nextEventSequence.get(record.sessionId, record.runId ?? "", record.timestamp) as { sequence: number } | undefined)?.sequence ?? 1,
    );
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
  });
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

  const evaluations: EvaluationStore = {
    async append(input) {
      const record = prepareEvaluationRecord(input, { redactor: options.evaluationRedactor });
      db.prepare(
        `INSERT INTO prism_evaluations (id, tenant_id, account_id, user_id, scorer_id, session_id, run_id, experiment_id, dataset_id, item_id, status, created_at, record) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.id,
        record.tenantId ?? null,
        record.accountId ?? null,
        record.userId ?? null,
        record.scorerId ?? null,
        record.sessionId ?? null,
        record.runId ?? null,
        record.experimentId ?? null,
        record.datasetId ?? null,
        record.itemId ?? null,
        record.status,
        new Date(record.createdAt).toISOString(),
        JSON.stringify(record),
      );
    },
    async query(query: EvaluationQuery = {}) {
      query.signal?.throwIfAborted();
      const limit = query.limit ?? 100;
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 1000 ||
        (query.order !== undefined && query.order !== "asc" && query.order !== "desc")
      ) {
        throw new EvaluationStoreError("Invalid evaluation page limit or order");
      }
      const filters: string[] = [];
      const params: unknown[] = [];
      for (const [column, value] of [
        ["tenant_id", query.tenantId],
        ["account_id", query.accountId],
        ["user_id", query.userId],
      ] as const) {
        filters.push(`${column} IS ?`);
        params.push(value ?? null);
      }
      for (const [key, column] of [
        ["id", "id"],
        ["scorerId", "scorer_id"],
        ["sessionId", "session_id"],
        ["runId", "run_id"],
        ["experimentId", "experiment_id"],
        ["datasetId", "dataset_id"],
        ["itemId", "item_id"],
      ] as const) {
        if (query[key] !== undefined) {
          params.push(query[key]);
          filters.push(`${column} = ?`);
        }
      }
      if (query.status !== undefined) {
        const statuses = Array.isArray(query.status) ? query.status : [query.status];
        if (!statuses.length) filters.push("1 = 0");
        else {
          const placeholders = statuses.map((status) => {
            params.push(status);
            return "?";
          });
          filters.push(`status IN (${placeholders.join(", ")})`);
        }
      }
      return queryTable(
        db,
        "prism_evaluations",
        { cursor: query.cursor, order: query.order, limit },
        filters,
        (row) => prepareEvaluationRecord(JSON.parse(String(row.record))),
        params,
      );
    },
  };

  const experiments: ExperimentReportStore = {
    async append(input) {
      const record = prepareExperimentReportRecord(input, { redactor: options.evaluationRedactor });
      db.prepare(
        `INSERT INTO prism_experiment_reports (id, tenant_id, account_id, user_id, dataset_id, dataset_version, dataset_content_hash, created_at, record) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.id,
        record.tenantId ?? null,
        record.accountId ?? null,
        record.userId ?? null,
        record.datasetId ?? null,
        record.datasetVersion ?? null,
        record.datasetContentHash ?? null,
        new Date(record.createdAt).toISOString(),
        JSON.stringify(record),
      );
    },
    async query(query: ExperimentReportQuery = {}) {
      query.signal?.throwIfAborted();
      const limit = query.limit ?? 100;
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 1000 ||
        (query.order !== undefined && query.order !== "asc" && query.order !== "desc")
      ) {
        throw new EvaluationStoreError("Invalid evaluation page limit or order");
      }
      const filters: string[] = [];
      const params: unknown[] = [];
      for (const [column, value] of [
        ["tenant_id", query.tenantId],
        ["account_id", query.accountId],
        ["user_id", query.userId],
      ] as const) {
        filters.push(`${column} IS ?`);
        params.push(value ?? null);
      }
      for (const [key, column] of [
        ["id", "id"],
        ["datasetId", "dataset_id"],
        ["datasetVersion", "dataset_version"],
        ["datasetContentHash", "dataset_content_hash"],
      ] as const) {
        if (query[key] !== undefined) {
          params.push(query[key]);
          filters.push(`${column} = ?`);
        }
      }
      for (const [key, value] of Object.entries(query.manifestMatch ?? {})) {
        if (value === undefined) {
          filters.push("1 = 0");
          continue;
        }
        params.push(key, value);
        filters.push("EXISTS (SELECT 1 FROM json_each(record, '$.manifest') WHERE key = ? AND value = ?)");
      }
      return queryTable(
        db,
        "prism_experiment_reports",
        { cursor: query.cursor, order: query.order, limit },
        filters,
        (row) => prepareExperimentReportRecord(JSON.parse(String(row.record))),
        params,
      );
    },
    async latest(query) {
      if (typeof query.datasetId !== "string" || !query.datasetId.trim()) throw new EvaluationStoreError("Dataset id required");
      return (await experiments.query({ ...query, cursor: undefined, order: "desc", limit: 1 })).items[0];
    },
  };

  const feedback: RunFeedbackStore = {
    async append(input) {
      if (db.prepare("SELECT 1 FROM prism_run_feedback WHERE id = ?").get(input.id)) {
        throw new RunFeedbackError("Duplicate feedback id", "ERR_PRISM_RUN_FEEDBACK_DUPLICATE");
      }
      const record = await prepareRunFeedback(input, {
        redactor: options.feedbackRedactor,
        resolveRun: ({ runId, ownership }) => {
          const row = db
            .prepare(
              "SELECT id, session_id, tenant_id, account_id, user_id FROM prism_runs WHERE id = ? AND tenant_id = ? AND account_id IS ? AND user_id IS ? LIMIT 1",
            )
            .get(runId, ownership.tenantId, ownership.accountId ?? null, ownership.userId ?? null) as Record<string, unknown> | undefined;
          return row
            ? {
                runId: String(row.id),
                sessionId: String(row.session_id),
                tenantId: String(row.tenant_id),
                accountId: row.account_id === null ? undefined : String(row.account_id),
                userId: row.user_id === null ? undefined : String(row.user_id),
              }
            : false;
        },
      });
      insertFeedback.run(
        record.id,
        record.runId,
        record.sessionId,
        record.traceId ?? null,
        record.rating ?? null,
        record.comment ?? null,
        JSON.stringify(record.tags),
        JSON.stringify(record.scorerIds),
        JSON.stringify(record.evaluationIds),
        record.createdAt,
        record.createdBy ?? null,
        record.tenantId,
        record.accountId ?? null,
        record.userId ?? null,
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
      if (query.runId) {
        filters.push("run_id = ?");
        params.push(query.runId);
      }
      if (query.sessionId) {
        filters.push("session_id = ?");
        params.push(query.sessionId);
      }
      if (query.traceId) {
        filters.push("trace_id = ?");
        params.push(query.traceId);
      }
      if (query.rating !== undefined) {
        filters.push("rating = ?");
        params.push(query.rating);
      }
      if (query.scorerId) {
        filters.push("EXISTS (SELECT 1 FROM json_each(scorer_ids) WHERE value = ?)");
        params.push(query.scorerId);
      }
      if (query.evaluationId) {
        filters.push("EXISTS (SELECT 1 FROM json_each(evaluation_ids) WHERE value = ?)");
        params.push(query.evaluationId);
      }
      if (query.tag) {
        filters.push("EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)");
        params.push(query.tag);
      }
      if (query.fromCreatedAt) {
        filters.push("created_at >= ?");
        params.push(query.fromCreatedAt);
      }
      if (query.toCreatedAt) {
        filters.push("created_at <= ?");
        params.push(query.toCreatedAt);
      }
      return queryTable(
        db,
        "prism_run_feedback",
        { ...query, limit: runFeedbackPageLimit(query.limit) },
        filters,
        mapFeedbackRow,
        params,
        "created_at",
        "id",
      );
    },
    async delete(input) {
      input.signal?.throwIfAborted();
      const ownership = requireRunFeedbackOwnership(input);
      return (
        db
          .prepare("DELETE FROM prism_run_feedback WHERE id = ? AND tenant_id = ? AND account_id IS ? AND user_id IS ?")
          .run(input.id, ownership.tenantId, ownership.accountId ?? null, ownership.userId ?? null).changes > 0
      );
    },
  };

  async function readEntryBranch(query: SessionBranchRead, scope?: OwnershipScope): Promise<PersistencePage<SessionEntry>> {
    const start = query.cursor === undefined ? 0 : decodeBranchCursor(query.cursor);
    if (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit >= Number.MAX_SAFE_INTEGER)) {
      throw new RangeError("Invalid branch pagination limit");
    }
    const leafId = query.leafId ?? findLatestLeafId(db, query.sessionId);
    if (!leafId) return { items: [] };
    const ownerFilters = scope ? buildOwnershipFilters(scope).map((filter) => `s.${filter}`) : [];
    const ownerClause = ownerFilters.length
      ? `AND EXISTS (SELECT 1 FROM prism_sessions s WHERE s.id = seed.session_id AND ${ownerFilters.join(" AND ")})`
      : "";

    // ponytail: no limit preserves full-chain reads; default paging needs the reader's 64-page cap revisited first.
    // Each ancestor is found by primary key: the CTE carries parent_id, `+parent.session_id` keeps the planner off the
    // (session_id, id) index, and CROSS JOIN drives the final select from the path. Otherwise each step scans the session.
    const rows = db
      .prepare(
        `WITH RECURSIVE branch_path(id, parent_id, depth) AS (
           SELECT seed.id, seed.parent_id, 0 FROM prism_session_entries seed
           WHERE seed.id = ? AND seed.session_id = ? ${ownerClause}
           UNION ALL
           SELECT parent.id, parent.parent_id, bp.depth + 1
           FROM branch_path bp
           INNER JOIN prism_session_entries parent ON parent.id = bp.parent_id
           WHERE +parent.session_id = ?
         )
         SELECT e.* FROM branch_path bp
         CROSS JOIN prism_session_entries e ON e.id = bp.id
         ORDER BY bp.depth DESC, e.timestamp ASC, e.id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(
        leafId,
        query.sessionId,
        ...(scope ? ownershipParams(scope) : []),
        query.sessionId,
        query.limit === undefined ? -1 : query.limit + 1,
        start,
      ) as SessionEntryRow[];

    return {
      items: (query.limit === undefined ? rows : rows.slice(0, query.limit)).map(rowToSessionEntry),
      nextCursor: query.limit !== undefined && rows.length > query.limit ? encodeBranchCursor(start + query.limit) : undefined,
    };
  }

  const persistence: SqlitePersistence = {
    name: "sqlite",
    checkpoints: createSqliteCheckpointStore(db),
    leases: createSqliteLeaseStore(db),
    feedback,
    evaluations,
    experiments,
    lifecycle: createSqlitePersistenceLifecycle(db),
    metadata: { kind: "sqlite", multiProcess: true, driver: "bun:sqlite" },

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
        // The links entry is the source of truth; the session row's columns only index it.
        const links = sessionLinkColumns(entry);
        if (links) setSessionLinks.run(...links, entry.sessionId);

        if (appendOptions?.idempotencyKey) {
          insertIdempotency.run(entry.sessionId, expectedParent, appendOptions.idempotencyKey, entry.id, now);
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

    async listSessions(query: SessionListQuery): Promise<PersistencePage<SessionSummary>> {
      return listSqliteSessions(db, query);
    },

    async deleteSession(sessionId: string, scope?: OwnershipScope): Promise<boolean> {
      // One transaction: a refused delete writes nothing, and an accepted one removes every row the session owns.
      return db.transaction(() => {
        if (!sqliteSessionInScope(db, sessionId, scope)) return false;
        deleteSqliteSessionRows(db, sessionId);
        return true;
      })();
    },

    readBranchPath: readEntryBranch,

    appendRun(record: RunRecord): void {
      const timestamp = canonicalSessionTimestamp(record.startedAt);
      ensureSession.run(record.sessionId, timestamp, timestamp);
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
        row.prompt_version,
      );
    },

    appendEvent(record: AgentEventRecord): void {
      appendEventRecord(record);
    },

    appendToolCall(record: ToolCallRecord): void {
      const timestamp = canonicalSessionTimestamp(record.startedAt);
      ensureSession.run(record.sessionId, timestamp, timestamp);
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
      const timestamp = canonicalSessionTimestamp(record.recordedAt);
      ensureSession.run(record.sessionId, timestamp, timestamp);
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
      const filters: string[] = [];
      const params: unknown[] = [];
      if (query.id) {
        filters.push("id = ?");
        params.push(query.id);
      }
      if (query.metadataKey !== undefined) {
        filters.push("json_extract(metadata, ?) IS NOT NULL");
        params.push(`$.${assertSessionMetadataKey(query.metadataKey)}`);
      }
      return queryTable(db, "prism_sessions", query, filters, mapSessionRow, params);
    },

    async appendSession(record) {
      const row = upsertSessionRecord.get(
        record.id,
        record.tenantId ?? null,
        record.accountId ?? null,
        record.userId ?? null,
        record.parentSessionId ?? null,
        record.agentDefinitionId ?? null,
        record.agentDefinitionVersion ?? null,
        record.createdAt,
        canonicalSessionTimestamp(record.updatedAt),
        record.expiresAt ?? null,
        record.retentionPolicyId ?? null,
        record.metadata === undefined ? null : JSON.stringify(record.metadata),
        record.expectedVersion ?? null,
        record.expectedVersion ?? null,
        record.id,
        record.expectedVersion ?? null,
        record.expectedVersion ?? null,
        record.expectedVersion ?? null,
        record.tenantId ?? null,
        record.accountId ?? null,
        record.userId ?? null,
      ) as { version: number } | undefined;
      if (!row) {
        const current = selectSessionVersion.get(record.id) as { version: number } | undefined;
        throw new SessionMetadataConflictError({
          code: SESSION_METADATA_CONFLICT_CODE,
          id: record.id,
          expectedVersion: record.expectedVersion ?? 0,
          currentVersion: current?.version ?? 0,
        });
      }
      return { version: Number(row.version) };
    },

    mergeSessionMetadata(id, patch, options) {
      const keys = Object.keys(patch);
      if (keys.length === 0) throw new TypeError("mergeSessionMetadata requires at least one metadata key");
      const assignments: string[] = [];
      const params: unknown[] = [];
      for (const key of keys) {
        const safeKey = assertSessionMetadataKey(key);
        const value = JSON.stringify(patch[key]);
        if (value === undefined) throw new TypeError(`mergeSessionMetadata value for "${safeKey}" is not JSON-serializable`);
        assignments.push(`'$."${safeKey}"', json(?)`);
        params.push(value);
      }
      const missing = (options?.onlyIfMissing ?? []).map((key) => `json_extract(metadata, '$."${assertSessionMetadataKey(key)}"') IS NULL`);
      const where = missing.length > 0 ? `id = ? AND ${missing.join(" AND ")}` : "id = ?";
      const row = db
        .prepare(
          `UPDATE prism_sessions
           SET metadata = json_set(COALESCE(metadata, '{}'), ${assignments.join(", ")}), version = version + 1
           WHERE ${where}
           RETURNING version`,
        )
        .get(...params, id) as { version: number } | undefined;
      return row ? { version: Number(row.version) } : undefined;
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
      if (query.leafId !== undefined && !query.sessionId) throw new TypeError("leafId requires sessionId");
      if (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1)) {
        throw new RangeError("Entry query limit must be a positive safe integer");
      }
      const filters: string[] = [];
      const params: unknown[] = [];
      const ownerFilters = buildOwnershipFilters(query);
      let branchSql = "";
      if (query.leafId !== undefined) {
        const ownerClause = ownerFilters.length
          ? `AND EXISTS (SELECT 1 FROM prism_sessions s WHERE s.id = seed.session_id AND ${ownerFilters.map((filter) => `s.${filter}`).join(" AND ")})`
          : "";
        // Ancestors by primary key; see readEntryBranch.
        branchSql = `WITH RECURSIVE branch_path(id, parent_id) AS (
          SELECT seed.id, seed.parent_id FROM prism_session_entries seed WHERE seed.id = ? AND seed.session_id = ? ${ownerClause}
          UNION ALL
          SELECT parent.id, parent.parent_id FROM branch_path bp
          JOIN prism_session_entries parent ON parent.id = bp.parent_id
          WHERE +parent.session_id = ?
        )`;
        params.push(query.leafId, query.sessionId, ...ownershipParams(query), query.sessionId);
      }
      if (query.sessionId) {
        filters.push("e.session_id = ?");
        params.push(query.sessionId);
      }
      if (query.runId) {
        filters.push("e.run_id = ?");
        params.push(query.runId);
      }
      if (query.parentId) {
        filters.push("e.parent_id = ?");
        params.push(query.parentId);
      }
      if (query.leafId === undefined && ownerFilters.length) {
        filters.push(
          `EXISTS (SELECT 1 FROM prism_sessions s WHERE s.id = e.session_id AND ${ownerFilters.map((filter) => `s.${filter}`).join(" AND ")})`,
        );
        params.push(...ownershipParams(query));
      }
      if (query.kind) {
        if (Array.isArray(query.kind)) {
          filters.push(query.kind.length ? `e.kind IN (${query.kind.map(() => "?").join(", ")})` : "1 = 0");
          params.push(...query.kind);
        } else {
          filters.push("e.kind = ?");
          params.push(query.kind);
        }
      }
      if (query.fromTimestamp) {
        filters.push("e.timestamp >= ?");
        params.push(query.fromTimestamp);
      }
      if (query.toTimestamp) {
        filters.push("e.timestamp <= ?");
        params.push(query.toTimestamp);
      }
      const order = query.order === "desc" ? "DESC" : "ASC";
      if (query.cursor !== undefined) {
        const cursor = decodeEntryCursor(query.cursor);
        if (order === "ASC") {
          filters.push("(e.timestamp > ? OR (e.timestamp = ? AND e.id > ?))");
          params.push(cursor.timestamp, cursor.timestamp, cursor.id);
        } else {
          filters.push("(e.timestamp < ? OR (e.timestamp = ? AND e.id < ?))");
          params.push(cursor.timestamp, cursor.timestamp, cursor.id);
        }
      }

      const limit = query.limit ?? 100;
      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const rows = db
        .prepare(
          `${branchSql} SELECT e.* FROM prism_session_entries e ${query.leafId !== undefined ? "JOIN branch_path bp ON bp.id = e.id" : ""} ${where}
           ORDER BY e.timestamp ${order}, e.id ${order}
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

function openDatabase(options: SqlitePersistenceOptions): Database {
  if (options.filename !== ":memory:") {
    mkdirSync(dirname(options.filename), { recursive: true });
  }
  const db = new BunSqlite(options.filename);
  configureSqliteDatabase(db, options);
  maybeRestrictFileMode(options.filename, options.fileMode);
  return db;
}

function findLatestLeafId(db: Database, sessionId: string): string | undefined {
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

const ENTRY_SCOPE_KEYS = ["tenantId", "accountId", "userId"] as const;

/**
 * The kernel's `entriesInScope` in SQL: a session is inside `scope` only when every entry it holds
 * carries each named key with the same value (an entry without the stamp is outside any named scope).
 * `sessionIdExpression` is the session-id SQL expression the subquery compares against, so the same
 * helper serves a page query (`s.id`, no params) and a single-session check (`?`, the id param).
 */
function entryScopeFilters(
  scope: OwnershipScope,
  sessionIdExpression: string,
  sessionIdParams: readonly unknown[] = [],
): { readonly clause: string; readonly params: readonly unknown[] }[] {
  const filters: { clause: string; params: readonly unknown[] }[] = [];
  for (const key of ENTRY_SCOPE_KEYS) {
    const value = scope[key];
    if (value === undefined) continue;
    filters.push({
      clause: `NOT EXISTS (SELECT 1 FROM prism_session_entries scoped WHERE scoped.session_id = ${sessionIdExpression} AND json_extract(scoped.metadata, '$.${key}') IS NOT ?)`,
      params: [...sessionIdParams, value],
    });
  }
  return filters;
}

/** Fail-closed, non-enumerating scope check for `deleteSession`: an absent, entry-less, or foreign-scope session is a miss. */
function sqliteSessionInScope(db: Database, sessionId: string, scope: OwnershipScope | undefined): boolean {
  const filters = scope ? entryScopeFilters(scope, "?", [sessionId]) : [];
  const clauses = [
    "EXISTS (SELECT 1 FROM prism_session_entries present WHERE present.session_id = s.id)",
    ...filters.map((filter) => filter.clause),
  ];
  const params = [sessionId, ...filters.flatMap((filter) => filter.params)];
  // bun:sqlite's get() answers null (not undefined) on a miss, so the check is truthiness, not a nullish comparison.
  return Boolean(db.prepare(`SELECT 1 FROM prism_sessions s WHERE s.id = ? AND ${clauses.join(" AND ")}`).get(...params));
}

/**
 * One transaction, child rows first: the session's entries (and their FTS rows and idempotency keys),
 * branches, runs (feedback cascades from `prism_runs` by foreign key), events, tool calls, usage, and
 * finally the session record. The ownership decision happens before this runs, never inside it.
 */
function deleteSqliteSessionRows(db: Database, sessionId: string): void {
  for (const statement of [
    "DELETE FROM prism_session_search_fts WHERE session_id = ?",
    "DELETE FROM prism_session_append_idempotency WHERE session_id = ?",
    "DELETE FROM prism_session_entries WHERE session_id = ?",
    "DELETE FROM prism_branches WHERE session_id = ?",
    "DELETE FROM prism_agent_events WHERE session_id = ?",
    "DELETE FROM prism_agent_event_streams WHERE session_id = ?",
    "DELETE FROM prism_tool_calls WHERE session_id = ?",
    "DELETE FROM prism_usage WHERE session_id = ?",
    "DELETE FROM prism_evaluations WHERE session_id = ? OR run_id IN (SELECT id FROM prism_runs WHERE session_id = ?1)",
    "DELETE FROM prism_runs WHERE session_id = ?",
    "DELETE FROM prism_sessions WHERE id = ?",
  ]) {
    db.prepare(statement).run(sessionId);
  }
}

/**
 * Bounded session listing: one indexed page query on `prism_sessions(updated_at, id)` (migration 004),
 * plus one leaf query and one message-count query for the page — never per row, and never the
 * transcript. The scope filter is the entry-metadata rule above, and the cursor is the
 * `(updated_at, id)` keyset pair the other SQL pages use, so a page always resumes strictly after the
 * last served session.
 *
 * ponytail: the leaf and count queries touch only the entries of the page's sessions (measured 5.7 ms
 * for a 20-session page over a 10k-entry database), so a very long transcript makes a page cost linear
 * in that session's entries. Denormalize the leaf id and message count onto `prism_sessions` if a host
 * measures it.
 */
function listSqliteSessions(db: Database, query: SessionListQuery): PersistencePage<SessionSummary> {
  query.signal?.throwIfAborted();
  const limit = query.limit ?? DEFAULT_SESSION_LIST_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > HARD_MAX_SESSION_LIST_LIMIT) {
    throw new TypeError(`SessionListQuery.limit must be a safe integer from 1 to ${HARD_MAX_SESSION_LIST_LIMIT}`);
  }
  const order = query.order ?? "desc";
  if (order !== "asc" && order !== "desc") throw new TypeError('SessionListQuery.order must be "asc" or "desc"');

  const filters = ["EXISTS (SELECT 1 FROM prism_session_entries present WHERE present.session_id = s.id)"];
  const params: unknown[] = [];
  for (const filter of entryScopeFilters(query, "s.id")) {
    filters.push(filter.clause);
    params.push(...filter.params);
  }
  assertSessionLinkFilter(query);
  for (const [column, value] of sessionLinkFilterColumns(query)) {
    filters.push(`s.${column} = ?`);
    params.push(value);
  }
  const direction = order === "asc" ? "ASC" : "DESC";
  if (query.cursor !== undefined) {
    const cursor = decodeEntryCursor(query.cursor);
    filters.push(
      order === "asc" ? "(s.updated_at > ? OR (s.updated_at = ? AND s.id > ?))" : "(s.updated_at < ? OR (s.updated_at = ? AND s.id < ?))",
    );
    params.push(cursor.timestamp, cursor.timestamp, cursor.id);
  }

  const rows = db
    .prepare(
      `SELECT s.id AS session_id, s.created_at, s.updated_at, s.metadata, ${SESSION_LINK_COLUMN_NAMES.map((column) => `s.${column}`).join(", ")}
       FROM prism_sessions s
       WHERE ${filters.join(" AND ")}
       ORDER BY s.updated_at ${direction}, s.id ${direction}
       LIMIT ?`,
    )
    .all(...params, limit + 1) as {
    session_id: string;
    created_at: string;
    updated_at: string;
    metadata: string | null;
    [column: string]: unknown;
  }[];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const leafBySession = new Map<string, string>();
  const messageCountBySession = new Map<string, number>();
  if (pageRows.length > 0) {
    const sessionIds = pageRows.map((row) => row.session_id);
    const placeholders = sessionIds.map(() => "?").join(", ");
    // Leaves order per session (timestamp desc, id desc); the first row wins for each session.
    const leafRows = db
      .prepare(
        `SELECT e.session_id, e.id FROM prism_session_entries e
         WHERE e.session_id IN (${placeholders})
           AND NOT EXISTS (SELECT 1 FROM prism_session_entries child WHERE child.session_id = e.session_id AND child.parent_id = e.id)
         ORDER BY e.session_id ASC, e.timestamp DESC, e.id DESC`,
      )
      .all(...sessionIds) as { session_id: string; id: string }[];
    for (const row of leafRows) {
      if (!leafBySession.has(row.session_id)) leafBySession.set(row.session_id, row.id);
    }
    const countRows = db
      .prepare(
        `SELECT session_id, COUNT(*) AS message_count FROM prism_session_entries
         WHERE session_id IN (${placeholders}) AND kind = 'message' GROUP BY session_id`,
      )
      .all(...sessionIds) as { session_id: string; message_count: number }[];
    for (const row of countRows) messageCountBySession.set(row.session_id, Number(row.message_count));
  }

  const items: SessionSummary[] = pageRows.map((row) => {
    const safe = safeSearchMetadata(parseSessionMetadata(row.metadata));
    const title = safe?.[SESSION_TITLE_METADATA_KEY];
    const workspaceRoot = safe?.[SESSION_SEARCH_WORKSPACE_METADATA_KEY];
    const leafId = leafBySession.get(row.session_id);
    return {
      sessionId: row.session_id,
      ...(leafId === undefined ? {} : { leafId }),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: messageCountBySession.get(row.session_id) ?? 0,
      ...(typeof title === "string" ? { title } : {}),
      ...(typeof workspaceRoot === "string" ? { metadata: { [SESSION_SEARCH_WORKSPACE_METADATA_KEY]: workspaceRoot } } : {}),
      ...sessionLinkSummaryFields(row),
    };
  });
  const last = pageRows.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeEntryCursor(last.updated_at, last.session_id) : undefined,
  };
}

function searchSqliteSessions(db: Database, query: SessionSearchQuery): PersistencePage<SessionSearchHit> {
  const q = resolveSessionSearchQuery(query);
  q.signal?.throwIfAborted();

  const filters: string[] = [];
  const params: unknown[] = [];
  if (q.tenantId) {
    filters.push("s.tenant_id = ?");
    params.push(q.tenantId);
  }
  if (q.accountId) {
    filters.push("s.account_id = ?");
    params.push(q.accountId);
  }
  if (q.userId) {
    filters.push("s.user_id = ?");
    params.push(q.userId);
  }
  for (const [column, value] of sessionLinkFilterColumns(q)) {
    filters.push(`s.${column} = ?`);
    params.push(value);
  }
  if (q.workspaceRoot) {
    filters.push(`json_extract(s.metadata, '$.${SESSION_SEARCH_WORKSPACE_METADATA_KEY}') = ?`);
    params.push(q.workspaceRoot);
  }
  if (q.fromUpdatedAt) {
    filters.push("s.updated_at >= ?");
    params.push(q.fromUpdatedAt);
  }
  if (q.toUpdatedAt) {
    filters.push("s.updated_at <= ?");
    params.push(q.toUpdatedAt);
  }
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
  if (q.query === undefined && q.kind) {
    filters.push(
      `EXISTS (SELECT 1 FROM prism_session_entries k WHERE k.session_id = s.id AND k.kind IN (${q.kind.map(() => "?").join(", ")}))`,
    );
    params.push(...q.kind);
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
  // Display fields (latest label/summary, branch leaf, turn) are fetched per returned page row:
  // correlated subqueries in this SELECT are evaluated for every candidate session before LIMIT.
  const rows = db
    .prepare(
      `${buildSqliteSearchCte(q)}
     SELECT s.id AS session_id, s.updated_at, s.metadata${
       q.query
         ? `,
       m.entry_id AS entry_id,
       m.score AS score,
       m.snippet AS match_snippet,
       me.run_id AS run_id,
       me.timestamp AS match_timestamp,
       me.id AS match_entry_id`
         : ""
     }
     FROM prism_sessions s${q.query ? "\n     JOIN best m ON m.session_id = s.id\n     JOIN prism_session_entries me ON me.id = m.entry_id" : ""}
     ${where}
     ORDER BY s.updated_at ${order}, s.id ${order}
     LIMIT ?`,
    )
    .all(...matchParams(q), ...params, q.limit + 1) as Array<{
    session_id: string;
    updated_at: string;
    metadata: string | null;
    entry_id?: string | null;
    score?: number | null;
    match_snippet?: string | null;
    run_id?: string | null;
    match_timestamp?: string | null;
    match_entry_id?: string | null;
  }>;

  q.signal?.throwIfAborted();
  const hasMore = rows.length > q.limit;
  const pageRows = hasMore ? rows.slice(0, q.limit) : rows;
  const selectDisplay = db.prepare(
    `SELECT
       (SELECT e.label FROM prism_session_entries e
         WHERE e.session_id = ? AND e.label IS NOT NULL
         ORDER BY e.timestamp DESC, e.id DESC LIMIT 1) AS label,
       (SELECT e.summary FROM prism_session_entries e
         WHERE e.session_id = ? AND e.summary IS NOT NULL
         ORDER BY e.timestamp DESC, e.id DESC LIMIT 1) AS summary,
       (SELECT COUNT(*) FROM prism_session_entries e
         WHERE e.session_id = ? AND e.kind = 'message') AS message_count`,
  );
  const selectTurn = db.prepare(
    `SELECT COUNT(*) AS turn FROM prism_session_entries
      WHERE session_id = ? AND (timestamp < ? OR (timestamp = ? AND id <= ?))`,
  );
  const items: SessionSearchHit[] = pageRows.map((row) => {
    const display = selectDisplay.get(row.session_id, row.session_id, row.session_id) as {
      label: string | null;
      summary: string | null;
      message_count: number;
    };
    const turn =
      row.match_timestamp === undefined || row.match_timestamp === null
        ? undefined
        : (selectTurn.get(row.session_id, row.match_timestamp, row.match_timestamp, row.match_entry_id) as { turn: number }).turn;
    const hit: SessionSearchHit = {
      sessionId: row.session_id,
      leafId: findLatestLeafId(db, row.session_id),
      updatedAt: row.updated_at,
      messageCount: Number(display.message_count),
      label: display.label ?? undefined,
      summary: display.summary ?? undefined,
      snippet: clipSearchSnippet(row.match_snippet ?? display.label ?? display.summary ?? undefined),
      metadata: safeSearchMetadata(parseSessionMetadata(row.metadata)),
      entryId: row.entry_id ?? undefined,
      runId: row.run_id ?? undefined,
      turn,
      score: row.score ?? undefined,
    };
    return hit;
  });
  const last = pageRows.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeEntryCursor(last.updated_at, last.session_id) : undefined,
  };
}

function fts5Phrase(query: string): string {
  return `"${query.replaceAll('"', '""')}"`;
}

/** FTS5 snippet window (words of context around the match). */
const SESSION_SEARCH_SNIPPET_TOKENS = 12;

/**
 * Best-matching entry per session for a text query: bounded FTS candidate rows, ranked by
 * bm25 (lower = better), then one row per session. `kind` filters which entries may match.
 */
function buildSqliteSearchCte(q: ResolvedSessionSearchQuery): string {
  if (!q.query) return "";
  const kindFilter = q.kind
    ? `JOIN prism_session_entries matched ON matched.id = prism_session_search_fts.entry_id
       WHERE prism_session_search_fts MATCH ? AND matched.kind IN (${q.kind.map(() => "?").join(", ")})`
    : `WHERE prism_session_search_fts MATCH ?`;
  return `WITH ranked AS (
       SELECT prism_session_search_fts.session_id AS session_id,
              prism_session_search_fts.entry_id AS entry_id,
              bm25(prism_session_search_fts) AS rank,
              snippet(prism_session_search_fts, -1, '', '', '…', ${SESSION_SEARCH_SNIPPET_TOKENS}) AS snippet
       FROM prism_session_search_fts
       ${kindFilter}
       ORDER BY rank, prism_session_search_fts.entry_id
       LIMIT ${DEFAULT_MAX_SESSION_SEARCH_FTS_CANDIDATES}
     ),
     best AS (
       SELECT session_id, entry_id, score, snippet
       FROM (
         SELECT session_id, entry_id, -rank AS score, snippet,
                row_number() OVER (PARTITION BY session_id ORDER BY rank, entry_id) AS rn
         FROM ranked
       )
       WHERE rn = 1
     )`;
}

/** Parameters consumed by `buildSqliteSearchCte`, in SQL text order. */
function matchParams(q: ResolvedSessionSearchQuery): unknown[] {
  if (!q.query) return [];
  return [fts5Phrase(q.query), ...(q.kind ?? [])];
}

function buildOwnershipFilters(scope: OwnershipScope): string[] {
  return ownershipColumns(scope).map(([column]) => `${column} = ?`);
}

function ownershipParams(scope: OwnershipScope): string[] {
  return ownershipColumns(scope).map(([, value]) => value);
}

function queryTable<T>(
  db: Database,
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
    nextCursor: hasMore && last ? encodeEntryCursor(String(last[sortColumn]), String(last[idColumn])) : undefined,
  };
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
