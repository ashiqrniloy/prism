import { Pool } from "pg";
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
import { createPostgresCheckpointStore } from "./checkpoints.js";
import { createPostgresLeaseStore } from "./leases.js";
import { qualifyTable } from "./identifiers.js";
import {
  applyPostgresMigrations,
  assertPostgresSchemaReady,
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
import { DEFAULT_POOL_MAX, DEFAULT_SCHEMA, type PostgresPersistenceOptions } from "./types.js";

export interface PostgresPersistence extends SessionStore, RunLedger, ProductionPersistenceStore {
  readonly name: "postgres";
  readonly checkpoints: CheckpointStore;
  readonly leases: LeaseStore;
  readonly feedback: RunFeedbackStore;
  readonly metadata: Readonly<{
    readonly kind: "postgres";
    readonly multiProcess: true;
    readonly driver: "pg";
    readonly schema: string;
  }>;
  close(): Promise<void>;
}

export async function createPostgresPersistence(
  options: PostgresPersistenceOptions,
): Promise<PostgresPersistence> {
  const ownsPool = !options.pool;
  const pool =
    options.pool ??
    new Pool({
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

  async function ensureSession(sessionId: string, timestamp: string): Promise<void> {
    await pool.query(
      `INSERT INTO ${sessions} (id, created_at, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT(id) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
      [sessionId, timestamp, timestamp],
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
          return row ? {
            runId: String(row.id), sessionId: String(row.session_id), tenantId: String(row.tenant_id),
            accountId: row.account_id === null ? undefined : String(row.account_id),
            userId: row.user_id === null ? undefined : String(row.user_id),
          } : false;
        },
      });
      await pool.query(
        `INSERT INTO ${feedbackTable} (
          id, run_id, session_id, trace_id, rating, comment, tags, scorer_ids, evaluation_ids,
          created_at, created_by, tenant_id, account_id, user_id, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [record.id, record.runId, record.sessionId, record.traceId ?? null, record.rating ?? null, record.comment ?? null,
          JSON.stringify(record.tags), JSON.stringify(record.scorerIds), JSON.stringify(record.evaluationIds), record.createdAt,
          record.createdBy ?? null, record.tenantId, record.accountId ?? null, record.userId ?? null,
          record.metadata === undefined ? null : JSON.stringify(record.metadata)],
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
      const add = (filter: (index: number) => string, value: unknown) => { params.push(value); filters.push(filter(params.length)); };
      if (query.runId) add((i) => `run_id = $${i}`, query.runId);
      if (query.sessionId) add((i) => `session_id = $${i}`, query.sessionId);
      if (query.traceId) add((i) => `trace_id = $${i}`, query.traceId);
      if (query.rating !== undefined) add((i) => `rating = $${i}`, query.rating);
      if (query.scorerId) add((i) => `scorer_ids::jsonb @> $${i}::jsonb`, JSON.stringify([query.scorerId]));
      if (query.evaluationId) add((i) => `evaluation_ids::jsonb @> $${i}::jsonb`, JSON.stringify([query.evaluationId]));
      if (query.tag) add((i) => `tags::jsonb @> $${i}::jsonb`, JSON.stringify([query.tag]));
      if (query.fromCreatedAt) add((i) => `created_at >= $${i}`, query.fromCreatedAt);
      if (query.toCreatedAt) add((i) => `created_at <= $${i}`, query.toCreatedAt);
      return queryTable(pool, feedbackTable, { ...query, limit: runFeedbackPageLimit(query.limit) }, filters, mapFeedbackRow, params, "created_at", "id");
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

  const persistence: PostgresPersistence = {
    name: "postgres",
    checkpoints: createPostgresCheckpointStore(pool, schema),
    leases: createPostgresLeaseStore(pool, schema),
    feedback,
    metadata: { kind: "postgres", multiProcess: true, driver: "pg", schema },

    async append(entry: SessionEntry, appendOptions?: SessionAppendOptions): Promise<void> {
      const now = new Date().toISOString();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        await client.query(
          `INSERT INTO ${sessions} (id, created_at, updated_at)
           VALUES ($1, $2, $3)
           ON CONFLICT(id) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
          [entry.sessionId, now, now],
        );

        if (appendOptions?.expectedParentId) {
          const parent = await client.query(
            `SELECT 1 FROM ${entries} WHERE id = $1 AND session_id = $2 LIMIT 1`,
            [appendOptions.expectedParentId, entry.sessionId],
          );
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
      const result = await pool.query(
        `SELECT * FROM ${entries} WHERE session_id = $1 ORDER BY timestamp ASC, ctid ASC`,
        [sessionId],
      );
      return (result.rows as SessionEntryRow[]).map(rowToSessionEntry);
    },

    async get(id: string): Promise<SessionEntry | undefined> {
      const result = await pool.query(`SELECT * FROM ${entries} WHERE id = $1 LIMIT 1`, [id]);
      const row = result.rows[0] as SessionEntryRow | undefined;
      return row ? rowToSessionEntry(row) : undefined;
    },

    async readBranchPath(query: SessionBranchRead): Promise<PersistencePage<SessionEntry>> {
      const leafId = query.leafId ?? (await findLatestLeafId(pool, entries, query.sessionId));
      if (!leafId) return { items: [] };

      const result = await pool.query(
        `WITH RECURSIVE branch_path(id, depth) AS (
           SELECT id, 0 FROM ${entries} WHERE id = $1 AND session_id = $2
           UNION ALL
           SELECT parent.id, bp.depth + 1
           FROM branch_path bp
           INNER JOIN ${entries} current ON current.id = bp.id
           INNER JOIN ${entries} parent ON parent.id = current.parent_id
           WHERE current.session_id = $3
         )
         SELECT e.* FROM ${entries} e
         INNER JOIN branch_path bp ON e.id = bp.id
         ORDER BY bp.depth DESC, e.timestamp ASC, e.id ASC`,
        [leafId, query.sessionId, query.sessionId],
      );
      const rows = result.rows as SessionEntryRow[];
      const limit = query.limit ?? rows.length;
      const start = query.cursor ? decodeBranchCursor(query.cursor) : 0;
      const slice = rows.slice(start, start + limit);
      const nextStart = start + slice.length;
      return {
        items: slice.map(rowToSessionEntry),
        nextCursor: nextStart < rows.length ? encodeBranchCursor(nextStart) : undefined,
      };
    },

    async appendRun(record: RunRecord): Promise<void> {
      await ensureSession(record.sessionId, record.startedAt);
      const row = runRecordToRow(record);
      await pool.query(
        `INSERT INTO ${runs} (
          id, session_id, branch_id, agent_definition_id, agent_definition_version,
          status, started_at, finished_at, model, provider, idempotency_key,
          abort_reason, error, tenant_id, account_id, user_id, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
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
          metadata = EXCLUDED.metadata`,
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
        ],
      );
    },

    async appendEvent(record: AgentEventRecord): Promise<void> {
      await ensureSession(record.sessionId, record.timestamp);
      const sequenceResult = await pool.query(
        `SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM ${events} WHERE run_id = $1`,
        [record.runId ?? ""],
      );
      const sequence = Number(sequenceResult.rows[0]?.next_sequence ?? 1);
      const row = agentEventRecordToRow(record, sequence);
      await pool.query(
        `INSERT INTO ${events} (
          id, session_id, run_id, entry_id, sequence, type, timestamp, event,
          redacted, tenant_id, account_id, user_id, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
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
        ],
      );
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
      return queryTable(pool, qualifyTable(schema, "prism_sessions"), query, [], mapSessionRow);
    },

    async searchSessions(query: SessionSearchQuery): Promise<PersistencePage<SessionSearchHit>> {
      return searchPostgresSessions(pool, {
        sessions,
        entries,
        runs,
        searchTable,
      }, query);
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
      if (query.parentId) {
        filters.push(`parent_id = $${params.length + 1}`);
        params.push(query.parentId);
      }
      if (query.leafId) {
        const chain = await persistence.readBranchPath!({ sessionId: query.sessionId ?? "", leafId: query.leafId });
        return { items: chain.items.slice(0, query.limit ?? chain.items.length) };
      }
      if (query.kind) {
        if (Array.isArray(query.kind)) {
          const placeholders = query.kind.map((_, index) => `$${params.length + index + 1}`).join(", ");
          filters.push(`kind IN (${placeholders})`);
          params.push(...query.kind);
        } else {
          filters.push(`kind = $${params.length + 1}`);
          params.push(query.kind);
        }
      }
      if (query.fromTimestamp) {
        filters.push(`timestamp >= $${params.length + 1}`);
        params.push(query.fromTimestamp);
      }
      if (query.toTimestamp) {
        filters.push(`timestamp <= $${params.length + 1}`);
        params.push(query.toTimestamp);
      }
      const order = query.order === "desc" ? "DESC" : "ASC";
      if (query.cursor) {
        const cursor = decodeEntryCursor(query.cursor);
        const tsParam = params.length + 1;
        const idParam = params.length + 3;
        if (order === "ASC") {
          filters.push(`(timestamp > $${tsParam} OR (timestamp = $${tsParam + 1} AND id > $${idParam}))`);
          params.push(cursor.timestamp, cursor.timestamp, cursor.id);
        } else {
          filters.push(`(timestamp < $${tsParam} OR (timestamp = $${tsParam + 1} AND id < $${idParam}))`);
          params.push(cursor.timestamp, cursor.timestamp, cursor.id);
        }
      }

      const limit = query.limit ?? 100;
      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const limitParam = params.length + 1;
      const result = await pool.query(
        `SELECT * FROM ${entries} ${where}
         ORDER BY timestamp ${order}, id ${order}
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
      return queryTable(
        pool,
        qualifyTable(schema, "prism_migrations"),
        query,
        filters,
        mapMigrationRow,
        params,
        "applied_at",
        "id",
      );
    },

    async close(): Promise<void> {
      if (ownsPool) {
        await pool.end();
      }
    },
  };

  return persistence;
}

export async function reopenPostgresPersistence(
  options: PostgresPersistenceOptions,
): Promise<PostgresPersistence> {
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
  if (q.query) {
    params.push(q.query);
    const ftsParam = `$${params.length}`;
    filters.push(
      `s.id IN (
         SELECT session_id FROM ${tables.searchTable}
         WHERE search_vector @@ plainto_tsquery('english', ${ftsParam})
         LIMIT ${DEFAULT_MAX_SESSION_SEARCH_FTS_CANDIDATES}
       )`,
    );
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
    `SELECT s.id AS session_id, s.updated_at, s.metadata,
       (
         SELECT e.label FROM ${tables.entries} e
         WHERE e.session_id = s.id AND e.label IS NOT NULL
         ORDER BY e.timestamp DESC, e.id DESC LIMIT 1
       ) AS label,
       (
         SELECT e.summary FROM ${tables.entries} e
         WHERE e.session_id = s.id AND e.summary IS NOT NULL
         ORDER BY e.timestamp DESC, e.id DESC LIMIT 1
       ) AS summary
     FROM ${tables.sessions} s
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
      snippet: clipSearchSnippet(row.label ?? row.summary ?? undefined),
      metadata: safeSearchMetadata(parseSessionMetadata(row.metadata)),
    });
  }
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

function buildOwnershipFilters(
  scope: { tenantId?: string; accountId?: string; userId?: string },
  startIndex: number,
): { filters: string[]; params: unknown[] } {
  const filters: string[] = [];
  const params: unknown[] = [];
  let index = startIndex;
  if (scope.tenantId) {
    filters.push(`tenant_id = $${index}`);
    params.push(scope.tenantId);
    index += 1;
  }
  if (scope.accountId) {
    filters.push(`account_id = $${index}`);
    params.push(scope.accountId);
    index += 1;
  }
  if (scope.userId) {
    filters.push(`user_id = $${index}`);
    params.push(scope.userId);
  }
  return { filters, params };
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
  id: String(row.id), runId: String(row.run_id), sessionId: String(row.session_id),
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

export { DEFAULT_POOL_MAX, DEFAULT_SCHEMA };
