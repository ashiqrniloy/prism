import { createRequire } from "node:module";
import {
  type AgentDefinitionQuery,
  type AgentEventQuery,
  type AgentEventRecord,
  type AgentEventSource,
  assertSessionMetadataKey,
  type BranchQuery,
  type CheckpointStore,
  DEFAULT_MAX_SESSION_SEARCH_FTS_CANDIDATES,
  DEFAULT_SESSION_LIST_LIMIT,
  HARD_MAX_SESSION_LIST_LIMIT,
  type LeaseStore,
  type MigrationQuery,
  type OwnershipScope,
  type PersistencePage,
  type ProductionPersistenceStore,
  prepareRunFeedback,
  type RetentionPolicyQuery,
  RunFeedbackError,
  type RunFeedbackQuery,
  type RunFeedbackStore,
  type RunLedger,
  type RunQuery,
  type RunRecord,
  requireRunFeedbackOwnership,
  resolveSessionSearchQuery,
  runFeedbackPageLimit,
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
  canonicalSessionTimestamp,
  clipSearchSnippet,
  createSessionRowMappers,
  decodeBranchCursor,
  encodeBranchCursor,
  entrySearchFields,
  rowToRunFeedbackRecord as mapFeedbackRow,
  ownershipColumns,
  parseSessionMetadata,
  type SessionEntryRow,
  safeSearchMetadata,
} from "@arnilo/prism-store-codecs";
import type { Pool, PoolClient, PoolConfig } from "pg";
import { createPostgresCheckpointStore } from "./checkpoints.js";
import { createPostgresAgentEventSource } from "./event-source.js";
import { qualifyTable } from "./identifiers.js";
import { createPostgresLeaseStore } from "./leases.js";
import { createPostgresPersistenceLifecycle } from "./lifecycle.js";
import { applyPostgresMigrations, assertPostgresSchemaReady, verifyMigrationIdempotency } from "./migrations.js";

const require = createRequire(import.meta.url);

function getPgPoolConstructor(): new (config?: PoolConfig) => Pool {
  try {
    const mod = require("pg");
    return mod.Pool ?? (mod.default ? mod.default.Pool : undefined);
  } catch (error) {
    throw new Error(
      "@arnilo/prism-store-postgres: dependency 'pg' is not installed. " + "Install it (npm i pg) to use PostgreSQL persistence.",
      { cause: error },
    );
  }
}

const {
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
} = createSessionRowMappers<boolean>({
  encode: (redacted) => redacted,
  decode: (redacted) => redacted,
});

import { DEFAULT_POOL_MAX, DEFAULT_SCHEMA, type PostgresPersistenceOptions } from "./types.js";

export interface PostgresPersistence extends SessionStore, RunLedger, ProductionPersistenceStore {
  readonly name: "postgres";
  readonly checkpoints: CheckpointStore;
  readonly events: AgentEventSource;
  readonly leases: LeaseStore;
  readonly feedback: RunFeedbackStore;
  readonly lifecycle: import("@arnilo/prism").PersistenceLifecycleStore;
  readonly metadata: Readonly<{
    readonly kind: "postgres";
    readonly multiProcess: true;
    readonly driver: "pg";
    readonly schema: string;
  }>;
  listSessions(query: SessionListQuery): Promise<PersistencePage<SessionSummary>>;
  deleteSession(sessionId: string, scope?: OwnershipScope): Promise<boolean>;
  /**
   * Merges `patch` into the session record's `metadata`, bumping the record version. `onlyIfMissing`
   * keys must be absent for the update to apply (`undefined` when the guard fails), which is what the
   * kernel's title path uses to keep a user-set title.
   */
  mergeSessionMetadata(
    id: string,
    patch: Readonly<Record<string, unknown>>,
    options?: { readonly onlyIfMissing?: readonly string[] },
  ): Promise<{ readonly version: number } | undefined>;
  close(): Promise<void>;
}

export async function createPostgresPersistence(options: PostgresPersistenceOptions): Promise<PostgresPersistence> {
  const ownsPool = !options.pool;
  const pool =
    options.pool ??
    new (getPgPoolConstructor())({
      connectionString: options.connectionString,
      max: options.poolMax ?? DEFAULT_POOL_MAX,
      ...options.poolConfig,
    });
  if (!options.pool && !options.connectionString) {
    throw new Error("PostgresPersistenceOptions requires pool or connectionString");
  }

  const schema = options.schema ?? DEFAULT_SCHEMA;
  const sessions = qualifyTable(schema, "prism_sessions");
  const entries = qualifyTable(schema, "prism_session_entries");
  const idempotency = qualifyTable(schema, "prism_session_append_idempotency");
  const runs = qualifyTable(schema, "prism_runs");
  const events = qualifyTable(schema, "prism_agent_events");
  const toolCalls = qualifyTable(schema, "prism_tool_calls");
  const usage = qualifyTable(schema, "prism_usage");
  const feedbackTable = qualifyTable(schema, "prism_run_feedback");
  const searchTable = qualifyTable(schema, "prism_session_search");

  if (!options.skipMigrations) {
    await applyPostgresMigrations(pool, schema);
    await assertPostgresSchemaReady(pool, schema);
    await verifyMigrationIdempotency(pool, schema);
  }

  const eventSource = createPostgresAgentEventSource({
    pool,
    schema,
    limits: options.eventSource,
    cursorSecret: options.eventCursorSecret,
  });

  async function ensureSession(sessionId: string, timestamp: string): Promise<void> {
    const activityAt = canonicalSessionTimestamp(timestamp);
    await pool.query(
      `INSERT INTO ${sessions} (id, created_at, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT(id) DO UPDATE SET updated_at = EXCLUDED.updated_at
       WHERE EXCLUDED.updated_at::timestamptz > ${sessions}.updated_at::timestamptz`,
      [sessionId, activityAt, activityAt],
    );
  }

  const feedback: RunFeedbackStore = {
    async append(input) {
      const duplicate = await pool.query(`SELECT 1 FROM ${feedbackTable} WHERE id = $1 LIMIT 1`, [input.id]);
      if (duplicate.rowCount) throw new RunFeedbackError("Duplicate feedback id", "ERR_PRISM_RUN_FEEDBACK_DUPLICATE");
      const record = await prepareRunFeedback(input, {
        redactor: options.feedbackRedactor,
        resolveRun: async ({ runId, ownership }) => {
          const result = await pool.query(
            `SELECT id, session_id, tenant_id, account_id, user_id FROM ${runs}
             WHERE id = $1 AND tenant_id = $2 AND account_id IS NOT DISTINCT FROM $3 AND user_id IS NOT DISTINCT FROM $4 LIMIT 1`,
            [runId, ownership.tenantId, ownership.accountId ?? null, ownership.userId ?? null],
          );
          const row = result.rows[0] as Record<string, unknown> | undefined;
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
      await pool.query(
        `INSERT INTO ${feedbackTable} (
          id, run_id, session_id, trace_id, rating, comment, tags, scorer_ids, evaluation_ids,
          created_at, created_by, tenant_id, account_id, user_id, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
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
        ],
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
      const add = (filter: (index: number) => string, value: unknown) => {
        params.push(value);
        filters.push(filter(params.length));
      };
      if (query.runId) add((i) => `run_id = $${i}`, query.runId);
      if (query.sessionId) add((i) => `session_id = $${i}`, query.sessionId);
      if (query.traceId) add((i) => `trace_id = $${i}`, query.traceId);
      if (query.rating !== undefined) add((i) => `rating = $${i}`, query.rating);
      if (query.scorerId) add((i) => `scorer_ids::jsonb @> $${i}::jsonb`, JSON.stringify([query.scorerId]));
      if (query.evaluationId) add((i) => `evaluation_ids::jsonb @> $${i}::jsonb`, JSON.stringify([query.evaluationId]));
      if (query.tag) add((i) => `tags::jsonb @> $${i}::jsonb`, JSON.stringify([query.tag]));
      if (query.fromCreatedAt) add((i) => `created_at >= $${i}`, query.fromCreatedAt);
      if (query.toCreatedAt) add((i) => `created_at <= $${i}`, query.toCreatedAt);
      return queryTable(
        pool,
        feedbackTable,
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
      const result = await pool.query(
        `DELETE FROM ${feedbackTable} WHERE id = $1 AND tenant_id = $2 AND account_id IS NOT DISTINCT FROM $3 AND user_id IS NOT DISTINCT FROM $4`,
        [input.id, ownership.tenantId, ownership.accountId ?? null, ownership.userId ?? null],
      );
      return Boolean(result.rowCount);
    },
  };

  async function readEntryBranch(query: SessionBranchRead, scope?: OwnershipScope): Promise<PersistencePage<SessionEntry>> {
    const start = query.cursor === undefined ? 0 : decodeBranchCursor(query.cursor);
    if (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit >= Number.MAX_SAFE_INTEGER)) {
      throw new RangeError("Invalid branch pagination limit");
    }
    const leafId = query.leafId ?? (await findLatestLeafId(pool, entries, query.sessionId));
    if (!leafId) return { items: [] };
    const ownership = buildOwnershipFilters(scope ?? {}, 3);
    const ownerClause = ownership.filters.length
      ? `AND EXISTS (SELECT 1 FROM ${sessions} s WHERE s.id = seed.session_id AND ${ownership.filters.map((filter) => `s.${filter}`).join(" AND ")})`
      : "";

    // ponytail: no limit preserves full-chain reads; default paging needs the reader's 64-page cap revisited first.
    const result = await pool.query(
      `WITH RECURSIVE branch_path(id, depth) AS (
         SELECT seed.id, 0 FROM ${entries} seed
         WHERE seed.id = $1 AND seed.session_id = $2 ${ownerClause}
         UNION ALL
         SELECT parent.id, bp.depth + 1
         FROM branch_path bp
         INNER JOIN ${entries} current ON current.id = bp.id
         INNER JOIN ${entries} parent ON parent.id = current.parent_id AND parent.session_id = current.session_id
         WHERE current.session_id = $${3 + ownership.params.length}
       )
       SELECT e.* FROM ${entries} e
       INNER JOIN branch_path bp ON e.id = bp.id
       ORDER BY bp.depth DESC, e.timestamp ASC, e.id ASC
       LIMIT $${4 + ownership.params.length} OFFSET $${5 + ownership.params.length}`,
      [leafId, query.sessionId, ...ownership.params, query.sessionId, query.limit === undefined ? null : query.limit + 1, start],
    );
    const rows = result.rows as SessionEntryRow[];
    return {
      items: (query.limit === undefined ? rows : rows.slice(0, query.limit)).map(rowToSessionEntry),
      nextCursor: query.limit !== undefined && rows.length > query.limit ? encodeBranchCursor(start + query.limit) : undefined,
    };
  }

  const persistence: PostgresPersistence = {
    name: "postgres",
    checkpoints: createPostgresCheckpointStore(pool, schema),
    events: eventSource,
    leases: createPostgresLeaseStore(pool, schema),
    feedback,
    lifecycle: createPostgresPersistenceLifecycle(pool, schema),
    metadata: { kind: "postgres", multiProcess: true, driver: "pg", schema },

    async append(entry: SessionEntry, appendOptions?: SessionAppendOptions): Promise<void> {
      const now = new Date().toISOString();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        await client.query(
          `INSERT INTO ${sessions} (id, created_at, updated_at)
           VALUES ($1, $2, $3)
           ON CONFLICT(id) DO UPDATE SET updated_at = EXCLUDED.updated_at
           WHERE EXCLUDED.updated_at::timestamptz > ${sessions}.updated_at::timestamptz`,
          [entry.sessionId, now, now],
        );

        if (appendOptions?.expectedParentId) {
          const parent = await client.query(`SELECT 1 FROM ${entries} WHERE id = $1 AND session_id = $2 LIMIT 1`, [
            appendOptions.expectedParentId,
            entry.sessionId,
          ]);
          if (parent.rowCount === 0) {
            throw new SessionAppendConflictError({
              code: "session_append_conflict",
              expectedParentId: appendOptions.expectedParentId,
            });
          }
        }

        const expectedParent = parentKey(appendOptions?.expectedParentId);
        if (appendOptions?.idempotencyKey) {
          const existing = await client.query(
            `SELECT entry_id FROM ${idempotency}
             WHERE session_id = $1 AND expected_parent_id = $2 AND idempotency_key = $3`,
            [entry.sessionId, expectedParent, appendOptions.idempotencyKey],
          );
          if (existing.rowCount && existing.rowCount > 0) {
            throw new SessionAppendConflictError({
              code: "session_append_conflict",
              idempotencyDuplicate: true,
            });
          }
        }

        const duplicate = await client.query(`SELECT 1 FROM ${entries} WHERE id = $1 LIMIT 1`, [entry.id]);
        if (duplicate.rowCount && duplicate.rowCount > 0) {
          throw new Error(`Duplicate session entry id: ${entry.id}`);
        }

        const row = sessionEntryToRow(entry);
        await client.query(
          `INSERT INTO ${entries} (
            id, session_id, parent_id, run_id, timestamp, kind, schema_version,
            message, event, model, previous_model, label, summary, data, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
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
          ],
        );
        const search = entrySearchFields(entry);
        await client.query(
          `INSERT INTO ${searchTable} (entry_id, session_id, label, summary, body)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (entry_id) DO UPDATE SET
             label = EXCLUDED.label,
             summary = EXCLUDED.summary,
             body = EXCLUDED.body`,
          [row.id, row.session_id, search.label, search.summary, search.body],
        );

        if (appendOptions?.idempotencyKey) {
          await client.query(
            `INSERT INTO ${idempotency} (
              session_id, expected_parent_id, idempotency_key, entry_id, created_at
            ) VALUES ($1, $2, $3, $4, $5)`,
            [entry.sessionId, expectedParent, appendOptions.idempotencyKey, entry.id, now],
          );
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async list(sessionId: string): Promise<readonly SessionEntry[]> {
      const result = await pool.query(`SELECT * FROM ${entries} WHERE session_id = $1 ORDER BY timestamp ASC, ctid ASC`, [sessionId]);
      return (result.rows as SessionEntryRow[]).map(rowToSessionEntry);
    },

    async get(id: string): Promise<SessionEntry | undefined> {
      const result = await pool.query(`SELECT * FROM ${entries} WHERE id = $1 LIMIT 1`, [id]);
      const row = result.rows[0] as SessionEntryRow | undefined;
      return row ? rowToSessionEntry(row) : undefined;
    },

    readBranchPath: readEntryBranch,

    async appendRun(record: RunRecord): Promise<void> {
      await ensureSession(record.sessionId, record.startedAt);
      const row = runRecordToRow(record);
      await pool.query(
        `INSERT INTO ${runs} (
          id, session_id, branch_id, agent_definition_id, agent_definition_version,
          status, started_at, finished_at, model, provider, idempotency_key,
          abort_reason, error, tenant_id, account_id, user_id, metadata, prompt_version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT(id) DO UPDATE SET
          status = EXCLUDED.status,
          finished_at = EXCLUDED.finished_at,
          started_at = CASE
            WHEN ${runs}.started_at IS NOT NULL AND ${runs}.started_at != '' THEN ${runs}.started_at
            ELSE EXCLUDED.started_at
          END,
          model = EXCLUDED.model,
          provider = EXCLUDED.provider,
          abort_reason = EXCLUDED.abort_reason,
          error = EXCLUDED.error,
          metadata = EXCLUDED.metadata,
          prompt_version = EXCLUDED.prompt_version`,
        [
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
        ],
      );
    },

    async appendEvent(record: AgentEventRecord): Promise<void> {
      await eventSource.appendLedger(record);
    },

    async appendToolCall(record: ToolCallRecord): Promise<void> {
      await ensureSession(record.sessionId, record.startedAt);
      const row = toolCallRecordToRow(record);
      await pool.query(
        `INSERT INTO ${toolCalls} (
          id, session_id, run_id, entry_id, tool_call_id, name, arguments, result,
          status, reason, progress, progress_metadata, progress_at, started_at,
          finished_at, redacted, tenant_id, account_id, user_id, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
        [
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
        ],
      );
    },

    async appendUsage(record: UsageRecord): Promise<void> {
      await ensureSession(record.sessionId, record.recordedAt);
      const row = usageRecordToRow(record);
      await pool.query(
        `INSERT INTO ${usage} (
          id, session_id, run_id, entry_id, scope, turn, attempt, usage, recorded_at,
          tenant_id, account_id, user_id, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
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
        ],
      );
    },

    async querySessions(query: SessionQuery) {
      const filters: string[] = [];
      const params: unknown[] = [];
      if (query.id) {
        filters.push(`id = $${params.length + 1}`);
        params.push(query.id);
      }
      if (query.metadataKey !== undefined) {
        filters.push(`(metadata IS NOT NULL AND (metadata::jsonb) ? $${params.length + 1})`);
        params.push(assertSessionMetadataKey(query.metadataKey));
      }
      return queryTable(pool, qualifyTable(schema, "prism_sessions"), query, filters, mapSessionRow, params);
    },

    async appendSession(record) {
      const result = await pool.query(
        `INSERT INTO ${sessions} (
          id, tenant_id, account_id, user_id, parent_session_id,
          agent_definition_id, agent_definition_version, created_at, updated_at,
          expires_at, retention_policy_id, metadata, version
        ) SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1
        WHERE $13::bigint IS NULL OR $13::bigint = 0
           OR EXISTS (SELECT 1 FROM ${sessions} WHERE id = $1)
        ON CONFLICT(id) DO UPDATE SET
          updated_at = EXCLUDED.updated_at,
          metadata = EXCLUDED.metadata,
          version = ${sessions}.version + 1
        WHERE ($13::bigint IS NULL)
           OR ($13::bigint > 0 AND ${sessions}.version = $13
               AND ${sessions}.tenant_id IS NOT DISTINCT FROM $2
               AND ${sessions}.account_id IS NOT DISTINCT FROM $3
               AND ${sessions}.user_id IS NOT DISTINCT FROM $4)
        RETURNING version`,
        [
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
        ],
      );
      const row = result.rows[0] as { version: number } | undefined;
      if (!row) {
        const current = await pool.query(`SELECT version FROM ${sessions} WHERE id = $1`, [record.id]);
        throw new SessionMetadataConflictError({
          code: SESSION_METADATA_CONFLICT_CODE,
          id: record.id,
          expectedVersion: record.expectedVersion ?? 0,
          currentVersion: (current.rows[0] as { version: number } | undefined)?.version ?? 0,
        });
      }
      return { version: Number(row.version) };
    },

    async searchSessions(query: SessionSearchQuery): Promise<PersistencePage<SessionSearchHit>> {
      return searchPostgresSessions(
        pool,
        {
          sessions,
          entries,
          runs,
          searchTable,
        },
        query,
      );
    },

    async listSessions(query: SessionListQuery): Promise<PersistencePage<SessionSummary>> {
      return listPostgresSessions(pool, { sessions, entries }, query);
    },

    async deleteSession(sessionId: string, scope?: OwnershipScope): Promise<boolean> {
      // One transaction: a refused delete writes nothing, and an accepted one removes every row the session owns.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (!(await postgresSessionInScope(client, { sessions, entries }, sessionId, scope))) {
          await client.query("ROLLBACK");
          return false;
        }
        for (const statement of [
          `DELETE FROM ${searchTable} WHERE session_id = $1`,
          `DELETE FROM ${idempotency} WHERE session_id = $1`,
          `DELETE FROM ${entries} WHERE session_id = $1`,
          `DELETE FROM ${qualifyTable(schema, "prism_branches")} WHERE session_id = $1`,
          `DELETE FROM ${events} WHERE session_id = $1`,
          `DELETE FROM ${qualifyTable(schema, "prism_agent_event_streams")} WHERE session_id = $1`,
          `DELETE FROM ${toolCalls} WHERE session_id = $1`,
          `DELETE FROM ${usage} WHERE session_id = $1`,
          `DELETE FROM ${runs} WHERE session_id = $1`,
          `DELETE FROM ${sessions} WHERE id = $1`,
        ]) {
          await client.query(statement, [sessionId]);
        }
        await client.query("COMMIT");
        return true;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    /**
     * The record-path merge the kernel's title handling uses: `metadata` is TEXT, so the patch is one
     * jsonb `||` (a shallow merge, right side wins) behind the `onlyIfMissing` guards, and `version`
     * bumps in the same statement.
     */
    async mergeSessionMetadata(id, patch, options) {
      const keys = Object.keys(patch);
      if (keys.length === 0) throw new TypeError("mergeSessionMetadata requires at least one metadata key");
      for (const key of keys) assertSessionMetadataKey(key);
      const patchJson = JSON.stringify(patch);
      if (patchJson === undefined) throw new TypeError("mergeSessionMetadata patch is not JSON-serializable");
      const params: unknown[] = [patchJson, id];
      const guards = (options?.onlyIfMissing ?? []).map((key) => {
        params.push(assertSessionMetadataKey(key));
        return `(metadata::jsonb ->> $${params.length}) IS NULL`;
      });
      const result = await pool.query(
        `UPDATE ${sessions}
         SET metadata = (COALESCE(metadata, '{}')::jsonb || $1::jsonb)::text, version = version + 1
         WHERE id = $2${guards.length > 0 ? ` AND ${guards.join(" AND ")}` : ""}
         RETURNING version`,
        params,
      );
      const row = result.rows[0] as { version: number } | undefined;
      return row ? { version: Number(row.version) } : undefined;
    },

    async queryBranches(query: BranchQuery) {
      const filters: string[] = [];
      const params: unknown[] = [];
      if (query.sessionId) {
        filters.push(`session_id = $${params.length + 1}`);
        params.push(query.sessionId);
      }
      if (query.name) {
        filters.push(`name = $${params.length + 1}`);
        params.push(query.name);
      }
      if (query.parentBranchId) {
        filters.push(`parent_branch_id = $${params.length + 1}`);
        params.push(query.parentBranchId);
      }
      if (query.hasLeaf === true) filters.push("leaf_entry_id IS NOT NULL");
      if (query.hasLeaf === false) filters.push("leaf_entry_id IS NULL");
      return queryTable(pool, qualifyTable(schema, "prism_branches"), query, filters, mapBranchRow, params, "created_at", "id");
    },

    async queryEntries(query: SessionEntryQuery): Promise<PersistencePage<SessionEntry>> {
      if (query.leafId !== undefined && !query.sessionId) throw new TypeError("leafId requires sessionId");
      if (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1)) {
        throw new RangeError("Entry query limit must be a positive safe integer");
      }
      const filters: string[] = [];
      const params: unknown[] = [];
      let branchSql = "";
      if (query.leafId !== undefined) {
        const ownership = buildOwnershipFilters(query, 3);
        const ownerClause = ownership.filters.length
          ? `AND EXISTS (SELECT 1 FROM ${sessions} s WHERE s.id = seed.session_id AND ${ownership.filters.map((filter) => `s.${filter}`).join(" AND ")})`
          : "";
        branchSql = `WITH RECURSIVE branch_path(id) AS (
          SELECT seed.id FROM ${entries} seed WHERE seed.id = $1 AND seed.session_id = $2 ${ownerClause}
          UNION ALL
          SELECT parent.id FROM branch_path bp
          JOIN ${entries} current ON current.id = bp.id
          JOIN ${entries} parent ON parent.id = current.parent_id AND parent.session_id = current.session_id
          WHERE current.session_id = $${3 + ownership.params.length}
        )`;
        params.push(query.leafId, query.sessionId, ...ownership.params, query.sessionId);
      }
      if (query.sessionId) {
        filters.push(`e.session_id = $${params.length + 1}`);
        params.push(query.sessionId);
      }
      if (query.runId) {
        filters.push(`e.run_id = $${params.length + 1}`);
        params.push(query.runId);
      }
      if (query.parentId) {
        filters.push(`e.parent_id = $${params.length + 1}`);
        params.push(query.parentId);
      }
      if (query.leafId === undefined) {
        const ownership = buildOwnershipFilters(query, params.length + 1);
        if (ownership.filters.length) {
          filters.push(
            `EXISTS (SELECT 1 FROM ${sessions} s WHERE s.id = e.session_id AND ${ownership.filters.map((filter) => `s.${filter}`).join(" AND ")})`,
          );
          params.push(...ownership.params);
        }
      }
      if (query.kind) {
        if (Array.isArray(query.kind)) {
          const placeholders = query.kind.map((_, index) => `$${params.length + index + 1}`).join(", ");
          filters.push(query.kind.length ? `e.kind IN (${placeholders})` : "1 = 0");
          params.push(...query.kind);
        } else {
          filters.push(`e.kind = $${params.length + 1}`);
          params.push(query.kind);
        }
      }
      if (query.fromTimestamp) {
        filters.push(`e.timestamp >= $${params.length + 1}`);
        params.push(query.fromTimestamp);
      }
      if (query.toTimestamp) {
        filters.push(`e.timestamp <= $${params.length + 1}`);
        params.push(query.toTimestamp);
      }
      const order = query.order === "desc" ? "DESC" : "ASC";
      if (query.cursor !== undefined) {
        const cursor = decodeEntryCursor(query.cursor);
        const tsParam = params.length + 1;
        const idParam = params.length + 3;
        if (order === "ASC") {
          filters.push(`(e.timestamp > $${tsParam} OR (e.timestamp = $${tsParam + 1} AND e.id > $${idParam}))`);
          params.push(cursor.timestamp, cursor.timestamp, cursor.id);
        } else {
          filters.push(`(e.timestamp < $${tsParam} OR (e.timestamp = $${tsParam + 1} AND e.id < $${idParam}))`);
          params.push(cursor.timestamp, cursor.timestamp, cursor.id);
        }
      }

      const limit = query.limit ?? 100;
      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const limitParam = params.length + 1;
      const result = await pool.query(
        `${branchSql} SELECT e.* FROM ${entries} e ${query.leafId !== undefined ? "JOIN branch_path bp ON bp.id = e.id" : ""} ${where}
         ORDER BY e.timestamp ${order}, e.id ${order}
         LIMIT $${limitParam}`,
        [...params, limit + 1],
      );
      const rows = result.rows as SessionEntryRow[];
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
        filters.push(`session_id = $${params.length + 1}`);
        params.push(query.sessionId);
      }
      if (query.branchId) {
        filters.push(`branch_id = $${params.length + 1}`);
        params.push(query.branchId);
      }
      if (query.status) {
        const statuses = Array.isArray(query.status) ? query.status : [query.status];
        const placeholders = statuses.map((_, index) => `$${params.length + index + 1}`).join(", ");
        filters.push(`status IN (${placeholders})`);
        params.push(...statuses);
      }
      return queryTable(pool, runs, query, filters, mapRunRow, params, "started_at", "id");
    },

    async queryEvents(query: AgentEventQuery) {
      const filters: string[] = [];
      const params: unknown[] = [];
      if (query.sessionId) {
        filters.push(`session_id = $${params.length + 1}`);
        params.push(query.sessionId);
      }
      if (query.runId) {
        filters.push(`run_id = $${params.length + 1}`);
        params.push(query.runId);
      }
      if (query.type) {
        const types = Array.isArray(query.type) ? query.type : [query.type];
        const placeholders = types.map((_, index) => `$${params.length + index + 1}`).join(", ");
        filters.push(`type IN (${placeholders})`);
        params.push(...types);
      }
      return queryTable(pool, events, query, filters, mapEventRow, params, "timestamp", "id");
    },

    async queryToolCalls(query: ToolCallQuery) {
      const filters: string[] = [];
      const params: unknown[] = [];
      if (query.sessionId) {
        filters.push(`session_id = $${params.length + 1}`);
        params.push(query.sessionId);
      }
      if (query.runId) {
        filters.push(`run_id = $${params.length + 1}`);
        params.push(query.runId);
      }
      if (query.name) {
        filters.push(`name = $${params.length + 1}`);
        params.push(query.name);
      }
      return queryTable(pool, toolCalls, query, filters, mapToolCallRow, params, "started_at", "id");
    },

    async queryUsage(query: UsageQuery) {
      const filters: string[] = [];
      const params: unknown[] = [];
      if (query.sessionId) {
        filters.push(`session_id = $${params.length + 1}`);
        params.push(query.sessionId);
      }
      if (query.runId) {
        filters.push(`run_id = $${params.length + 1}`);
        params.push(query.runId);
      }
      if (query.scope) {
        filters.push(`scope = $${params.length + 1}`);
        params.push(query.scope);
      }
      if (query.turn !== undefined) {
        filters.push(`turn = $${params.length + 1}`);
        params.push(query.turn);
      }
      if (query.attempt !== undefined) {
        filters.push(`attempt = $${params.length + 1}`);
        params.push(query.attempt);
      }
      return queryTable(pool, usage, query, filters, mapUsageRow, params, "recorded_at", "id");
    },

    async queryAgentDefinitions(query: AgentDefinitionQuery) {
      const filters: string[] = [];
      const params: unknown[] = [];
      if (query.name) {
        filters.push(`name = $${params.length + 1}`);
        params.push(query.name);
      }
      if (query.version) {
        filters.push(`version = $${params.length + 1}`);
        params.push(query.version);
      }
      return queryTable(
        pool,
        qualifyTable(schema, "prism_agent_definitions"),
        query,
        filters,
        mapAgentDefinitionRow,
        params,
        "created_at",
        "id",
      );
    },

    async queryRetentionPolicies(query: RetentionPolicyQuery) {
      const filters: string[] = [];
      const params: unknown[] = [];
      if (query.name) {
        filters.push(`name = $${params.length + 1}`);
        params.push(query.name);
      }
      return queryTable(
        pool,
        qualifyTable(schema, "prism_retention_policies"),
        query,
        filters,
        mapRetentionRow,
        params,
        "created_at",
        "id",
      );
    },

    async queryMigrations(query: MigrationQuery) {
      const filters: string[] = [];
      const params: unknown[] = [];
      if (query.name) {
        filters.push(`name = $${params.length + 1}`);
        params.push(query.name);
      }
      if (query.version) {
        filters.push(`version = $${params.length + 1}`);
        params.push(query.version);
      }
      return queryTable(pool, qualifyTable(schema, "prism_migrations"), query, filters, mapMigrationRow, params, "applied_at", "id");
    },

    async close(): Promise<void> {
      await eventSource.close();
      if (ownsPool) {
        await pool.end();
      }
    },
  };

  return persistence;
}

export async function reopenPostgresPersistence(options: PostgresPersistenceOptions): Promise<PostgresPersistence> {
  return createPostgresPersistence(options);
}

async function findLatestLeafId(pool: Pool, entriesTable: string, sessionId: string): Promise<string | undefined> {
  const result = await pool.query(
    `SELECT e.id FROM ${entriesTable} e
     WHERE e.session_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM ${entriesTable} child
         WHERE child.session_id = e.session_id AND child.parent_id = e.id
       )
     ORDER BY e.timestamp DESC, e.id DESC
     LIMIT 1`,
    [sessionId],
  );
  return result.rows[0]?.id as string | undefined;
}

const ENTRY_SCOPE_KEYS = ["tenantId", "accountId", "userId"] as const;

/**
 * The kernel's `entriesInScope` in SQL: a session is inside `scope` only when every entry it holds
 * carries each named key with the same value (an entry without the stamp is outside any named scope).
 * `sessionIdExpression` is the session-id SQL expression the subquery compares against, so the same
 * helper serves a page query (`s.id`) and a single-session check (`s.id` with the id as a param).
 * `IS DISTINCT FROM` is Postgres' null-safe *inequality* (SQLite's `IS NOT`): the subquery matches an
 * entry that does NOT carry the scope, so `NOT EXISTS` holds only when every entry carries it, and an
 * unstamped entry is outside any named scope. Undefined scope values are skipped by the caller.
 */
function pushEntryScopeFilters(
  filters: string[],
  params: unknown[],
  entriesTable: string,
  scope: OwnershipScope,
  sessionIdExpression: string,
): void {
  for (const key of ENTRY_SCOPE_KEYS) {
    const value = scope[key];
    if (value === undefined) continue;
    params.push(value);
    filters.push(
      `NOT EXISTS (SELECT 1 FROM ${entriesTable} scoped WHERE scoped.session_id = ${sessionIdExpression} AND (scoped.metadata::jsonb ->> '${key}') IS DISTINCT FROM $${params.length})`,
    );
  }
}

/** Fail-closed, non-enumerating scope check for `deleteSession`: an absent, entry-less, or foreign-scope session is a miss. */
async function postgresSessionInScope(
  client: PoolClient,
  tables: { sessions: string; entries: string },
  sessionId: string,
  scope: OwnershipScope | undefined,
): Promise<boolean> {
  const filters = [`EXISTS (SELECT 1 FROM ${tables.entries} present WHERE present.session_id = s.id)`];
  const params: unknown[] = [sessionId];
  if (scope) pushEntryScopeFilters(filters, params, tables.entries, scope, "s.id");
  const result = await client.query(`SELECT 1 FROM ${tables.sessions} s WHERE s.id = $1 AND ${filters.join(" AND ")} LIMIT 1`, params);
  return result.rowCount === 1;
}

/**
 * Bounded session listing: one indexed page query on `prism_sessions(updated_at, id)` (migration 004),
 * plus one leaf query and one message-count query for the page — never per row, and never the
 * transcript. The scope filter is the entry-metadata rule above, and the cursor is the
 * `(updated_at, id)` keyset pair `queryTable` and the search page already emit, so a page always
 * resumes strictly after the last served session.
 *
 * ponytail: the leaf and count queries touch only the entries of the page's sessions, so a very long
 * transcript makes a page cost linear in that session's entries. Denormalize the leaf id and message
 * count onto `prism_sessions` if a host measures it.
 */
async function listPostgresSessions(
  pool: Pool,
  tables: { sessions: string; entries: string },
  query: SessionListQuery,
): Promise<PersistencePage<SessionSummary>> {
  query.signal?.throwIfAborted();
  const limit = query.limit ?? DEFAULT_SESSION_LIST_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > HARD_MAX_SESSION_LIST_LIMIT) {
    throw new TypeError(`SessionListQuery.limit must be a safe integer from 1 to ${HARD_MAX_SESSION_LIST_LIMIT}`);
  }
  const order = query.order ?? "desc";
  if (order !== "asc" && order !== "desc") throw new TypeError('SessionListQuery.order must be "asc" or "desc"');

  const filters = [`EXISTS (SELECT 1 FROM ${tables.entries} present WHERE present.session_id = s.id)`];
  const params: unknown[] = [];
  pushEntryScopeFilters(filters, params, tables.entries, query, "s.id");
  const direction = order === "asc" ? "ASC" : "DESC";
  if (query.cursor !== undefined) {
    const cursor = decodeEntryCursor(query.cursor);
    params.push(cursor.timestamp, cursor.timestamp, cursor.id);
    const first = params.length - 2;
    filters.push(
      order === "asc"
        ? `(s.updated_at > $${first} OR (s.updated_at = $${first + 1} AND s.id > $${first + 2}))`
        : `(s.updated_at < $${first} OR (s.updated_at = $${first + 1} AND s.id < $${first + 2}))`,
    );
  }
  params.push(limit + 1);
  const result = await pool.query(
    `SELECT s.id AS session_id, s.created_at, s.updated_at, s.metadata
     FROM ${tables.sessions} s
     WHERE ${filters.join(" AND ")}
     ORDER BY s.updated_at ${direction}, s.id ${direction}
     LIMIT $${params.length}`,
    params,
  );
  query.signal?.throwIfAborted();

  const rows = result.rows as Array<{ session_id: string; created_at: string; updated_at: string; metadata: string | null }>;
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const leafBySession = new Map<string, string>();
  const messageCountBySession = new Map<string, number>();
  if (pageRows.length > 0) {
    const sessionIds = pageRows.map((row) => row.session_id);
    // Leaves order per session (timestamp desc, id desc); the first row wins for each session.
    const leafRows = await pool.query(
      `SELECT e.session_id, e.id FROM ${tables.entries} e
       WHERE e.session_id = ANY($1::text[])
         AND NOT EXISTS (SELECT 1 FROM ${tables.entries} child WHERE child.session_id = e.session_id AND child.parent_id = e.id)
       ORDER BY e.session_id ASC, e.timestamp DESC, e.id DESC`,
      [sessionIds],
    );
    for (const row of leafRows.rows as Array<{ session_id: string; id: string }>) {
      if (!leafBySession.has(row.session_id)) leafBySession.set(row.session_id, row.id);
    }
    const countRows = await pool.query(
      `SELECT session_id, COUNT(*) AS message_count FROM ${tables.entries}
       WHERE session_id = ANY($1::text[]) AND kind = 'message' GROUP BY session_id`,
      [sessionIds],
    );
    for (const row of countRows.rows as Array<{ session_id: string; message_count: string | number }>) {
      messageCountBySession.set(row.session_id, Number(row.message_count));
    }
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
    };
  });
  const last = pageRows.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeEntryCursor(last.updated_at, last.session_id) : undefined,
  };
}

async function searchPostgresSessions(
  pool: Pool,
  tables: { sessions: string; entries: string; runs: string; searchTable: string },
  query: SessionSearchQuery,
): Promise<PersistencePage<SessionSearchHit>> {
  const q = resolveSessionSearchQuery(query);
  q.signal?.throwIfAborted();

  const filters: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    filters.push(sql.replace("?", `$${params.length}`));
  };

  // Full-text match plus kind filter, if any; text-query params come first (the CTE is emitted
  // ahead of the WHERE clause), so ownership/date/filter params keep positional numbering.
  let ftsParam: string | undefined;
  let kindFilter = "";
  if (q.query) {
    params.push(q.query);
    ftsParam = `$${params.length}`;
    if (q.kind) {
      const first = params.length + 1;
      params.push(...q.kind);
      kindFilter = `AND e.kind IN (${q.kind.map((_, index) => `$${first + index}`).join(", ")})`;
    }
  }

  if (q.tenantId) add("s.tenant_id = ?", q.tenantId);
  if (q.accountId) add("s.account_id = ?", q.accountId);
  if (q.userId) add("s.user_id = ?", q.userId);
  if (q.workspaceRoot) {
    add(`s.metadata::jsonb ->> '${SESSION_SEARCH_WORKSPACE_METADATA_KEY}' = ?`, q.workspaceRoot);
  }
  if (q.fromUpdatedAt) add("s.updated_at >= ?", q.fromUpdatedAt);
  if (q.toUpdatedAt) add("s.updated_at <= ?", q.toUpdatedAt);
  if (q.label) {
    add(`EXISTS (SELECT 1 FROM ${tables.entries} e WHERE e.session_id = s.id AND position(? in e.label) > 0)`, q.label);
  }
  if (q.summary) {
    add(`EXISTS (SELECT 1 FROM ${tables.entries} e WHERE e.session_id = s.id AND position(? in e.summary) > 0)`, q.summary);
  }
  if (q.provider) {
    add(`EXISTS (SELECT 1 FROM ${tables.runs} r WHERE r.session_id = s.id AND r.provider = ?)`, q.provider);
  }
  if (q.model) {
    add(`EXISTS (SELECT 1 FROM ${tables.runs} r WHERE r.session_id = s.id AND r.model::jsonb ->> 'model' = ?)`, q.model);
  }
  if (!q.query && q.kind) {
    add(`EXISTS (SELECT 1 FROM ${tables.entries} k WHERE k.session_id = s.id AND k.kind = ANY(?::text[]))`, q.kind);
  }

  const order = q.order === "asc" ? "ASC" : "DESC";
  if (q.cursor) {
    const cursor = decodeEntryCursor(q.cursor);
    params.push(cursor.timestamp, cursor.timestamp, cursor.id);
    const a = `$${params.length - 2}`;
    const b = `$${params.length - 1}`;
    const c = `$${params.length}`;
    if (order === "ASC") {
      filters.push(`(s.updated_at > ${a} OR (s.updated_at = ${b} AND s.id > ${c}))`);
    } else {
      filters.push(`(s.updated_at < ${a} OR (s.updated_at = ${b} AND s.id < ${c}))`);
    }
  }

  params.push(q.limit + 1);
  const limitParam = `$${params.length}`;
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const result = await pool.query(
    `${buildPostgresSearchCte(tables, ftsParam, kindFilter)}
     SELECT s.id AS session_id, s.updated_at, s.metadata,
       (
         SELECT e.label FROM ${tables.entries} e
         WHERE e.session_id = s.id AND e.label IS NOT NULL
         ORDER BY e.timestamp DESC, e.id DESC LIMIT 1
       ) AS label,
       (
         SELECT e.summary FROM ${tables.entries} e
         WHERE e.session_id = s.id AND e.summary IS NOT NULL
         ORDER BY e.timestamp DESC, e.id DESC LIMIT 1
       ) AS summary${
         q.query
           ? `,
       m.entry_id AS entry_id,
       m.score AS score,
       m.snippet AS match_snippet,
       me.run_id AS run_id,
       (
         SELECT COUNT(*) FROM ${tables.entries} t
         WHERE t.session_id = s.id AND (t.timestamp, t.id) <= (me.timestamp, me.id)
       ) AS turn`
           : ""
       }
     FROM ${tables.sessions} s${
       q.query
         ? `
     JOIN best m ON m.session_id = s.id
     JOIN ${tables.entries} me ON me.id = m.entry_id`
         : ""
     }
     ${where}
     ORDER BY s.updated_at ${order}, s.id ${order}
     LIMIT ${limitParam}`,
    params,
  );
  q.signal?.throwIfAborted();

  const rows = result.rows as Array<{
    session_id: string;
    updated_at: string;
    metadata: string | null;
    label: string | null;
    summary: string | null;
    entry_id?: string | null;
    score?: number | string | null;
    match_snippet?: string | null;
    run_id?: string | null;
    turn?: number | string | null;
  }>;
  const hasMore = rows.length > q.limit;
  const pageRows = hasMore ? rows.slice(0, q.limit) : rows;
  const items: SessionSearchHit[] = [];
  for (const row of pageRows) {
    items.push({
      sessionId: row.session_id,
      leafId: await findLatestLeafId(pool, tables.entries, row.session_id),
      updatedAt: row.updated_at,
      label: row.label ?? undefined,
      summary: row.summary ?? undefined,
      snippet: clipSearchSnippet(row.match_snippet ?? row.label ?? row.summary ?? undefined),
      metadata: safeSearchMetadata(parseSessionMetadata(row.metadata)),
      entryId: row.entry_id ?? undefined,
      runId: row.run_id ?? undefined,
      turn: row.turn === null || row.turn === undefined ? undefined : Number(row.turn),
      score: row.score === null || row.score === undefined ? undefined : Number(row.score),
    });
  }
  const last = pageRows.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeEntryCursor(last.updated_at, last.session_id) : undefined,
  };
}

function buildPostgresSearchCte(
  tables: { entries: string; searchTable: string },
  ftsParam: string | undefined,
  kindFilter: string,
): string {
  if (ftsParam === undefined) return "";
  return `WITH ranked AS (
       SELECT sr.session_id AS session_id, sr.entry_id AS entry_id,
              ts_rank_cd(sr.search_vector, plainto_tsquery('english', ${ftsParam})) AS score,
              ts_headline('english',
                CASE
                  WHEN to_tsvector('english', coalesce(sr.label, '')) @@ plainto_tsquery('english', ${ftsParam}) THEN sr.label
                  WHEN to_tsvector('english', coalesce(sr.summary, '')) @@ plainto_tsquery('english', ${ftsParam}) THEN sr.summary
                  ELSE sr.body
                END,
                plainto_tsquery('english', ${ftsParam}),
                'StartSel="", StopSel="", MaxWords=12, MinWords=6') AS snippet
       FROM ${tables.searchTable} sr
       JOIN ${tables.entries} e ON e.id = sr.entry_id
       WHERE sr.search_vector @@ plainto_tsquery('english', ${ftsParam}) ${kindFilter}
       ORDER BY score DESC, sr.entry_id
       LIMIT ${DEFAULT_MAX_SESSION_SEARCH_FTS_CANDIDATES}
     ),
     best AS (
       SELECT DISTINCT ON (session_id) session_id, entry_id, score, snippet
       FROM ranked
       ORDER BY session_id, score DESC, entry_id
     )`;
}

function buildOwnershipFilters(scope: OwnershipScope, startIndex: number): { filters: string[]; params: string[] } {
  const columns = ownershipColumns(scope);
  return {
    filters: columns.map(([column], index) => `${column} = $${startIndex + index}`),
    params: columns.map(([, value]) => value),
  };
}

async function queryTable<T>(
  pool: Pool,
  table: string,
  query: {
    cursor?: string;
    limit?: number;
    order?: "asc" | "desc";
    tenantId?: string;
    accountId?: string;
    userId?: string;
  },
  filters: string[],
  mapRow: (row: Record<string, unknown>) => T,
  baseParams: unknown[] = [],
  sortColumn = "created_at",
  idColumn = "id",
): Promise<PersistencePage<T>> {
  const order = query.order === "desc" ? "DESC" : "ASC";
  const allFilters = [...filters];
  const allParams = [...baseParams];
  const ownership = buildOwnershipFilters(query, allParams.length + 1);
  allFilters.push(...ownership.filters);
  allParams.push(...ownership.params);

  if (query.cursor) {
    const cursor = decodeEntryCursor(query.cursor);
    const tsParam = allParams.length + 1;
    const idParam = allParams.length + 3;
    if (order === "ASC") {
      allFilters.push(`(${sortColumn} > $${tsParam} OR (${sortColumn} = $${tsParam + 1} AND ${idColumn} > $${idParam}))`);
      allParams.push(cursor.timestamp, cursor.timestamp, cursor.id);
    } else {
      allFilters.push(`(${sortColumn} < $${tsParam} OR (${sortColumn} = $${tsParam + 1} AND ${idColumn} < $${idParam}))`);
      allParams.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
  }

  const limit = query.limit ?? 100;
  const where = allFilters.length ? `WHERE ${allFilters.join(" AND ")}` : "";
  const limitParam = allParams.length + 1;
  const result = await pool.query(
    `SELECT * FROM ${table} ${where}
     ORDER BY ${sortColumn} ${order}, ${idColumn} ${order}
     LIMIT $${limitParam}`,
    [...allParams, limit + 1],
  );
  const rows = result.rows as Record<string, unknown>[];
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

export { DEFAULT_POOL_MAX, DEFAULT_SCHEMA };
