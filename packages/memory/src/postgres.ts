import type { JsonObject } from "@arnilo/prism";
import type { Pool, PoolClient, PoolConfig } from "pg";
import { MemoryConflictError, MemoryLimitError, MemoryValidationError } from "./errors.js";
import { buildMemoryDdl, DEFAULT_MEMORY_SCHEMA } from "./postgres-ddl.js";
import { qualifyTable, validateIdentifier } from "./postgres-identifiers.js";
import {
  assertByteLimit,
  assertFiniteVector,
  assertNotAborted,
  assertTextLimit,
  cloneJsonObject,
  mergeJsonObjects,
  requireNonEmptyString,
  requireScope,
} from "./util.js";
import type {
  MemoryVectorHit,
  MemoryVectorRecord,
  VectorDeleteFilter,
  VectorQuery,
  VectorStore,
  WorkingMemoryKey,
  WorkingMemoryRecord,
  WorkingMemoryStore,
  WorkingMemoryUpdateOptions,
} from "./types.js";

export interface PostgresMemoryStoresOptions {
  readonly pool?: Pool;
  readonly connectionString?: string;
  readonly schema?: string;
  readonly poolMax?: number;
  readonly poolConfig?: Omit<PoolConfig, "connectionString" | "max">;
  readonly skipMigrations?: boolean;
  readonly maxWorkingMemoryBytes?: number;
  readonly maxEntryTextChars?: number;
  readonly dimensions?: number;
}

export interface PostgresMemoryStores {
  readonly workingStore: WorkingMemoryStore;
  readonly vectorStore: VectorStore & {
    getByThread(scope: { tenantId: string; resourceId: string; threadId: string }): Promise<readonly MemoryVectorRecord[]>;
  };
  readonly pool: Pool;
  readonly schema: string;
  close(): Promise<void>;
}

type Queryable = Pick<Pool | PoolClient, "query">;

export async function createPostgresMemoryStores(
  options: PostgresMemoryStoresOptions,
): Promise<PostgresMemoryStores> {
  const schema = validateIdentifier(options.schema ?? DEFAULT_MEMORY_SCHEMA, "schema");
  const maxWorkingMemoryBytes = options.maxWorkingMemoryBytes ?? 256 * 1024;
  const maxEntryTextChars = options.maxEntryTextChars ?? 64_384;
  const dimensions = options.dimensions;
  if (dimensions !== undefined && (!Number.isInteger(dimensions) || dimensions <= 0)) {
    throw new MemoryValidationError("dimensions must be a positive integer");
  }

  const { Pool: PgPool } = await import("pg");
  const ownsPool = !options.pool;
  const pool =
    options.pool ??
    new PgPool({
      connectionString: requireNonEmptyString(options.connectionString, "connectionString"),
      max: options.poolMax ?? 10,
      ...(options.poolConfig ?? {}),
    });

  if (!options.skipMigrations) {
    await pool.query(buildMemoryDdl(schema));
    if (dimensions !== undefined) {
      // Ensure embedding column width when host declares dimensions up front.
      await pool.query(
        `ALTER TABLE ${qualifyTable(schema, "semantic_memory")}
         ALTER COLUMN embedding TYPE vector(${dimensions})
         USING embedding::vector`,
      ).catch(() => undefined);
    }
  }

  const workingTable = qualifyTable(schema, "working_memory");
  const semanticTable = qualifyTable(schema, "semantic_memory");

  const workingStore: WorkingMemoryStore = {
    async get(key, getOptions = {}) {
      assertNotAborted(getOptions.signal);
      const scope = requireScope(key);
      const threadId = scope.threadId ?? "";
      const result = await pool.query(
        `SELECT tenant_id, resource_id, thread_id, value, version, updated_at
         FROM ${workingTable}
         WHERE tenant_id = $1 AND resource_id = $2 AND thread_id = $3`,
        [scope.tenantId, scope.resourceId, threadId],
      );
      const row = result.rows[0];
      return row ? mapWorkingRow(row) : undefined;
    },

    async set(record, setOptions = {}) {
      assertNotAborted(setOptions.signal);
      const scope = requireScope(record);
      if (!Number.isInteger(record.version) || record.version < 1) {
        throw new MemoryValidationError("version must be an integer >= 1");
      }
      assertByteLimit(record.value, maxWorkingMemoryBytes, "working memory");
      const threadId = scope.threadId ?? "";
      await pool.query(
        `INSERT INTO ${workingTable} (tenant_id, resource_id, thread_id, value, version, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6::timestamptz)
         ON CONFLICT (tenant_id, resource_id, thread_id)
         DO UPDATE SET value = EXCLUDED.value, version = EXCLUDED.version, updated_at = EXCLUDED.updated_at`,
        [scope.tenantId, scope.resourceId, threadId, JSON.stringify(record.value), record.version, record.updatedAt],
      );
    },

    async update(key, patch, updateOptions: WorkingMemoryUpdateOptions = {}) {
      assertNotAborted(updateOptions.signal);
      const scope = requireScope(key);
      const threadId = scope.threadId ?? "";
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query(
          `SELECT tenant_id, resource_id, thread_id, value, version, updated_at
           FROM ${workingTable}
           WHERE tenant_id = $1 AND resource_id = $2 AND thread_id = $3
           FOR UPDATE`,
          [scope.tenantId, scope.resourceId, threadId],
        );
        const existing = current.rows[0] ? mapWorkingRow(current.rows[0]) : undefined;
        if (updateOptions.expectedVersion !== undefined) {
          const currentVersion = existing?.version ?? 0;
          if (currentVersion !== updateOptions.expectedVersion) {
            throw new MemoryConflictError(
              `working memory version conflict: expected ${updateOptions.expectedVersion}, found ${currentVersion}`,
            );
          }
        }
        const mode = updateOptions.mode ?? "merge";
        const nextValue =
          mode === "replace" ? cloneJsonObject(patch) : mergeJsonObjects(existing?.value ?? {}, patch);
        assertByteLimit(nextValue, maxWorkingMemoryBytes, "working memory");
        const nextVersion = (existing?.version ?? 0) + 1;
        const updatedAt = new Date().toISOString();
        await client.query(
          `INSERT INTO ${workingTable} (tenant_id, resource_id, thread_id, value, version, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6::timestamptz)
           ON CONFLICT (tenant_id, resource_id, thread_id)
           DO UPDATE SET value = EXCLUDED.value, version = EXCLUDED.version, updated_at = EXCLUDED.updated_at`,
          [scope.tenantId, scope.resourceId, threadId, JSON.stringify(nextValue), nextVersion, updatedAt],
        );
        await client.query("COMMIT");
        return {
          ...scope,
          value: nextValue,
          version: nextVersion,
          updatedAt,
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async delete(key, deleteOptions = {}) {
      assertNotAborted(deleteOptions.signal);
      const scope = requireScope(key);
      const threadId = scope.threadId ?? "";
      const result = await pool.query(
        `DELETE FROM ${workingTable}
         WHERE tenant_id = $1 AND resource_id = $2 AND thread_id = $3`,
        [scope.tenantId, scope.resourceId, threadId],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };

  const vectorStore: VectorStore & {
    getByThread(scope: { tenantId: string; resourceId: string; threadId: string }): Promise<readonly MemoryVectorRecord[]>;
  } = {
    async upsert(records, upsertOptions = {}) {
      assertNotAborted(upsertOptions.signal);
      if (records.length === 0) return;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const record of records) {
          requireScope(record, true);
          requireNonEmptyString(record.id, "id");
          assertTextLimit(record.text, maxEntryTextChars, "vector text");
          assertFiniteVector(record.embedding, "embedding", dimensions);
          await client.query(
            `INSERT INTO ${semanticTable}
              (tenant_id, resource_id, thread_id, id, text, embedding, sequence, metadata, created_at)
             VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8::jsonb, $9::timestamptz)
             ON CONFLICT (tenant_id, resource_id, thread_id, id)
             DO UPDATE SET text = EXCLUDED.text, embedding = EXCLUDED.embedding, sequence = EXCLUDED.sequence,
                           metadata = EXCLUDED.metadata, created_at = EXCLUDED.created_at`,
            [
              record.tenantId,
              record.resourceId,
              record.threadId,
              record.id,
              record.text,
              toVectorLiteral(record.embedding),
              record.sequence,
              record.metadata ? JSON.stringify(record.metadata) : null,
              record.createdAt,
            ],
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

    async query(query: VectorQuery) {
      assertNotAborted(query.signal);
      const scope = requireScope(query, true) as Required<WorkingMemoryKey> & { threadId: string };
      assertFiniteVector(query.embedding, "query embedding", dimensions);
      const result = await pool.query(
        `SELECT tenant_id, resource_id, thread_id, id, text, embedding::text AS embedding, sequence, metadata, created_at,
                1 - (embedding <=> $4::vector) AS score
         FROM ${semanticTable}
         WHERE tenant_id = $1 AND resource_id = $2 AND thread_id = $3
         ORDER BY embedding <=> $4::vector ASC, sequence ASC, id ASC
         LIMIT $5`,
        [scope.tenantId, scope.resourceId, scope.threadId, toVectorLiteral(query.embedding), query.topK],
      );
      return result.rows.map((row) => mapVectorRow(row, Number(row.score))) as MemoryVectorHit[];
    },

    async delete(filter: VectorDeleteFilter, deleteOptions = {}) {
      assertNotAborted(deleteOptions.signal);
      const scope = requireScope(filter);
      const params: unknown[] = [scope.tenantId, scope.resourceId];
      let sql = `DELETE FROM ${semanticTable} WHERE tenant_id = $1 AND resource_id = $2`;
      if (scope.threadId !== undefined) {
        params.push(scope.threadId);
        sql += ` AND thread_id = $${params.length}`;
      }
      if (filter.ids && filter.ids.length > 0) {
        params.push(filter.ids);
        sql += ` AND id = ANY($${params.length})`;
      }
      const result = await pool.query(sql, params);
      return result.rowCount ?? 0;
    },

    async getByThread(scope) {
      const required = requireScope(scope, true) as Required<MemoryVectorRecord>;
      const result = await pool.query(
        `SELECT tenant_id, resource_id, thread_id, id, text, embedding::text AS embedding, sequence, metadata, created_at
         FROM ${semanticTable}
         WHERE tenant_id = $1 AND resource_id = $2 AND thread_id = $3
         ORDER BY sequence ASC, id ASC`,
        [required.tenantId, required.resourceId, required.threadId],
      );
      return result.rows.map((row) => mapVectorRow(row));
    },
  };

  return {
    workingStore,
    vectorStore,
    pool,
    schema,
    async close() {
      if (ownsPool) await pool.end();
    },
  };
}

function mapWorkingRow(row: Record<string, unknown>): WorkingMemoryRecord {
  const threadId = row.thread_id === "" || row.thread_id == null ? undefined : String(row.thread_id);
  return {
    tenantId: String(row.tenant_id),
    resourceId: String(row.resource_id),
    ...(threadId ? { threadId } : {}),
    value: (typeof row.value === "string" ? JSON.parse(row.value) : row.value) as JsonObject,
    version: Number(row.version),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapVectorRow(row: Record<string, unknown>, score?: number): MemoryVectorRecord | MemoryVectorHit {
  const embedding = parseVectorLiteral(String(row.embedding));
  assertFiniteVector(embedding, "stored embedding");
  if (score !== undefined && !Number.isFinite(score)) throw new MemoryValidationError("stored vector score must be finite");
  const metadata =
    row.metadata == null
      ? undefined
      : (typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata) as JsonObject;
  const base: MemoryVectorRecord = {
    tenantId: String(row.tenant_id),
    resourceId: String(row.resource_id),
    threadId: String(row.thread_id),
    id: String(row.id),
    text: String(row.text),
    embedding,
    sequence: Number(row.sequence),
    createdAt: new Date(String(row.created_at)).toISOString(),
    ...(metadata ? { metadata } : {}),
  };
  return score === undefined ? base : { ...base, score };
}

function toVectorLiteral(values: readonly number[]): string {
  assertFiniteVector(values, "embedding");
  return `[${values.join(",")}]`;
}

function parseVectorLiteral(value: string): number[] {
  const trimmed = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!trimmed) return [];
  return trimmed.split(",").map((part) => Number(part.trim()));
}

/** Test helper: run arbitrary SQL against an open pool. */
export async function queryPostgres(pool: Queryable, sql: string, params: unknown[] = []) {
  return pool.query(sql, params);
}
