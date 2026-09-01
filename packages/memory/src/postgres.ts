import type { JsonObject } from "@arnilo/prism";
import type { Pool, PoolClient, PoolConfig } from "pg";
import { MemoryConflictError, MemoryValidationError } from "./errors.js";
import { decodeMemoryCursor, encodeMemoryCursor } from "./pagination.js";
import { buildMemoryDdl, buildVectorSearchDdl, DEFAULT_MEMORY_SCHEMA, DEFAULT_VECTOR_TABLE } from "./postgres-ddl.js";
import { qualifyTable, quoteIdentifier, validateIdentifier } from "./postgres-identifiers.js";
import { normalizeImportance } from "./scoring.js";
import type {
  MemoryConsent,
  MemoryVectorHit,
  MemoryVectorOrder,
  MemoryVectorRecord,
  VectorDeleteFilter,
  VectorQuery,
  VectorStore,
  WorkingMemoryKey,
  WorkingMemoryRecord,
  WorkingMemoryStore,
  WorkingMemoryUpdateOptions,
} from "./types.js";
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
  readonly vectorStore: PostgresVectorStore;
  readonly pool: Pool;
  readonly schema: string;
  close(): Promise<void>;
}

type Queryable = Pick<Pool | PoolClient, "query">;

const VECTOR_COLUMNS =
  "tenant_id, resource_id, thread_id, id, text, embedding::text AS embedding, sequence, metadata, consent, created_at, embedder_id, generation, importance";
const VECTOR_INSERT_COLUMNS =
  "tenant_id, resource_id, thread_id, id, text, embedding, sequence, metadata, consent, created_at, embedder_id, generation, importance";

/** Non-transactional surface; every method issues plain statements against whatever Queryable it is bound to. */
export interface PostgresVectorSourceStore extends VectorStore {
  getByThread(scope: { tenantId: string; resourceId: string; threadId: string }): Promise<readonly MemoryVectorRecord[]>;
  listByThread: NonNullable<VectorStore["listByThread"]>;
  countByThread: NonNullable<VectorStore["countByThread"]>;
  getBySource(
    scope: { tenantId: string; resourceId: string; threadId: string },
    sourceId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<readonly MemoryVectorRecord[]>;
}

export interface PostgresVectorStore extends PostgresVectorSourceStore {
  transaction<T>(operation: (store: PostgresVectorSourceStore) => Promise<T>, options?: { readonly signal?: AbortSignal }): Promise<T>;
}

export interface PostgresVectorStoreOptions {
  readonly pool?: Pool;
  readonly connectionString?: string;
  readonly schema?: string;
  readonly table?: string;
  /** Pin the embedding column to exactly this many dimensions (fail closed on drift). */
  readonly dimension?: number;
  readonly skipMigrations?: boolean;
  readonly poolMax?: number;
  readonly poolConfig?: Omit<PoolConfig, "connectionString" | "max">;
  readonly maxEntryTextChars?: number;
}

export async function createPostgresMemoryStores(options: PostgresMemoryStoresOptions): Promise<PostgresMemoryStores> {
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
      // Pin embedding width first: pgvector can only build HNSW over vector(N) columns.
      await pool
        .query(
          `ALTER TABLE ${qualifyTable(schema, DEFAULT_VECTOR_TABLE)}
         ALTER COLUMN embedding TYPE vector(${dimensions})
         USING embedding::vector`,
        )
        .catch(() => undefined);
    }
    // Index-backed search is best-effort: old PostgreSQL versions stay correct via seq scan.
    await pool.query(buildVectorSearchDdl(schema, DEFAULT_VECTOR_TABLE, dimensions)).catch(() => undefined);
  }

  const workingTable = qualifyTable(schema, "working_memory");
  const semanticTable = qualifyTable(schema, DEFAULT_VECTOR_TABLE);

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
        const nextValue = mode === "replace" ? cloneJsonObject(patch) : mergeJsonObjects(existing?.value ?? {}, patch);
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

  const vectorStore = assembleVectorStore(pool, {
    table: semanticTable,
    generationsTable: `${quoteIdentifier(schema)}.${quoteIdentifier(`${DEFAULT_VECTOR_TABLE}_rag_scope_generations`)}`,
    maxEntryTextChars,
    dimensions,
    lexical: await textTsvAvailable(pool, schema, DEFAULT_VECTOR_TABLE).catch(() => false),
  });

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
    row.metadata == null ? undefined : ((typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata) as JsonObject);
  const consent =
    row.consent == null ? undefined : ((typeof row.consent === "string" ? JSON.parse(row.consent) : row.consent) as MemoryConsent);
  const base: MemoryVectorRecord = {
    tenantId: String(row.tenant_id),
    resourceId: String(row.resource_id),
    threadId: String(row.thread_id),
    id: String(row.id),
    text: String(row.text),
    embedding,
    sequence: Number(row.sequence),
    createdAt: new Date(String(row.created_at)).toISOString(),
    ...(row.embedder_id ? { embedderId: String(row.embedder_id) } : {}),
    ...(row.generation !== null && row.generation !== undefined ? { generation: Number(row.generation) } : {}),
    ...(row.importance !== null && row.importance !== undefined ? { importance: Number(row.importance) } : {}),
    ...(metadata ? { metadata } : {}),
    ...(consent ? { consent } : {}),
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

interface VectorTableDeps {
  readonly table: string;
  /** Fully qualified scope-generation pointer table. */
  readonly generationsTable: string;
  readonly maxEntryTextChars: number;
  readonly dimensions?: number;
  /** Whether the text_tsv column exists — gates the lexical leg declaration. */
  readonly lexical: boolean;
}

/** All vector statements bound to one Queryable — pool for direct use, PoolClient inside transactions. */
function createVectorMethods(q: Queryable, deps: VectorTableDeps): PostgresVectorSourceStore {
  const { table } = deps;
  const base: PostgresVectorSourceStore = {
    async upsert(records, upsertOptions = {}) {
      assertNotAborted(upsertOptions.signal);
      for (const record of records) {
        requireScope(record, true);
        requireNonEmptyString(record.id, "id");
        assertTextLimit(record.text, deps.maxEntryTextChars, "vector text");
        assertFiniteVector(record.embedding, "embedding", deps.dimensions);
        if (
          record.embedderId !== undefined &&
          (typeof record.embedderId !== "string" || record.embedderId.length === 0 || record.embedderId.length > 256)
        ) {
          throw new MemoryValidationError("embedderId must be a non-empty string of at most 256 characters");
        }
        if (
          record.generation !== undefined &&
          !(
            (typeof record.generation === "number" && Number.isInteger(record.generation) && record.generation >= 0) ||
            (typeof record.generation === "bigint" && record.generation >= 0)
          )
        ) {
          throw new MemoryValidationError("generation must be a non-negative integer");
        }
        const importance = normalizeImportance(record.importance);
        await q.query(
          `INSERT INTO ${table}
            (${VECTOR_INSERT_COLUMNS})
           VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8::jsonb, $9::jsonb, $10::timestamptz, $11::text, $12, $13::real)
           ON CONFLICT (tenant_id, resource_id, thread_id, id)
           DO UPDATE SET text = EXCLUDED.text, embedding = EXCLUDED.embedding, sequence = EXCLUDED.sequence,
                         metadata = EXCLUDED.metadata, consent = EXCLUDED.consent, created_at = EXCLUDED.created_at,
                         embedder_id = EXCLUDED.embedder_id, generation = EXCLUDED.generation, importance = EXCLUDED.importance`,
          [
            record.tenantId,
            record.resourceId,
            record.threadId,
            record.id,
            record.text,
            toVectorLiteral(record.embedding),
            record.sequence,
            record.metadata ? JSON.stringify(record.metadata) : null,
            record.consent ? JSON.stringify(record.consent) : null,
            record.createdAt,
            record.embedderId ?? null,
            record.generation === undefined ? null : String(record.generation),
            importance ?? null,
          ],
        );
      }
    },

    async query(query: VectorQuery) {
      assertNotAborted(query.signal);
      const scope = requireScope(query, true) as Required<WorkingMemoryKey> & { threadId: string };
      assertFiniteVector(query.embedding, "query embedding", deps.dimensions);
      const result = await q.query(
        `SELECT ${VECTOR_COLUMNS},
                1 - (embedding <=> $4::vector) AS score
         FROM ${table}
         WHERE tenant_id = $1 AND resource_id = $2 AND thread_id = $3
           AND (generation IS NULL OR generation = COALESCE(
                 (SELECT current_generation FROM ${deps.generationsTable}
                  WHERE tenant_id = $1 AND resource_id = $2 AND thread_id = $3), generation))
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
      let sql = `DELETE FROM ${table} WHERE tenant_id = $1 AND resource_id = $2`;
      if (scope.threadId !== undefined) {
        params.push(scope.threadId);
        sql += ` AND thread_id = $${params.length}`;
      }
      if (filter.ids && filter.ids.length > 0) {
        params.push(filter.ids);
        sql += ` AND id = ANY($${params.length})`;
      }
      const result = await q.query(sql, params);
      return result.rowCount ?? 0;
    },

    async getByThread(scope) {
      const required = requireScope(scope, true) as Required<MemoryVectorRecord>;
      const result = await q.query(
        `SELECT ${VECTOR_COLUMNS} FROM ${table}
         WHERE tenant_id = $1 AND resource_id = $2 AND thread_id = $3
         ORDER BY sequence ASC, id ASC`,
        [required.tenantId, required.resourceId, required.threadId],
      );
      return result.rows.map((row) => mapVectorRow(row));
    },

    async listByThread(query) {
      assertNotAborted(query.signal);
      const required = requireScope(query, true) as Required<MemoryVectorRecord>;
      if (!Number.isInteger(query.limit) || query.limit < 1)
        throw new MemoryValidationError("memory page limit must be a positive integer");
      const order: MemoryVectorOrder = query.order ?? "sequence";
      const cursor = decodeMemoryCursor(query.cursor, order);
      const params: unknown[] = [required.tenantId, required.resourceId, required.threadId];
      let where = "tenant_id = $1 AND resource_id = $2 AND thread_id = $3";
      let ordering = "sequence ASC, id ASC";
      if (cursor && order === "sequence") {
        params.push(cursor.value, cursor.id);
        where += ` AND (sequence, id) > ($${params.length - 1}, $${params.length})`;
      } else if (cursor) {
        params.push(new Date(cursor.value).toISOString(), cursor.sequence, cursor.id);
        where += ` AND (created_at, sequence, id) > ($${params.length - 2}::timestamptz, $${params.length - 1}, $${params.length})`;
      }
      if (order === "createdAt") ordering = "created_at ASC, sequence ASC, id ASC";
      params.push(query.limit + 1);
      const result = await q.query(
        `SELECT ${VECTOR_COLUMNS} FROM ${table} WHERE ${where} ORDER BY ${ordering} LIMIT $${params.length}`,
        params,
      );
      const records = result.rows.slice(0, query.limit).map((row) => mapVectorRow(row) as MemoryVectorRecord);
      const last = records.at(-1);
      return {
        records,
        ...(last && result.rows.length > records.length ? { nextCursor: encodeMemoryCursor(last, order) } : {}),
      };
    },

    async countByThread(scope, countOptions = {}) {
      assertNotAborted(countOptions.signal);
      const required = requireScope(scope, true) as Required<MemoryVectorRecord>;
      const result = await q.query(
        `SELECT count(*)::integer AS count FROM ${table} WHERE tenant_id = $1 AND resource_id = $2 AND thread_id = $3`,
        [required.tenantId, required.resourceId, required.threadId],
      );
      return Number(result.rows[0]?.count ?? 0);
    },

    async getBySource(scope, sourceId, sourceOptions = {}) {
      assertNotAborted(sourceOptions.signal);
      const required = requireScope(scope, true) as Required<MemoryVectorRecord>;
      requireNonEmptyString(sourceId, "sourceId");
      const result = await q.query(
        `SELECT ${VECTOR_COLUMNS} FROM ${table}
         WHERE tenant_id = $1 AND resource_id = $2 AND thread_id = $3 AND metadata->'_rag'->>'sourceId' = $4
         ORDER BY sequence ASC, id ASC`,
        [required.tenantId, required.resourceId, required.threadId, sourceId],
      );
      return result.rows.map((row) => mapVectorRow(row));
    },

    async getCurrentGeneration(scope) {
      const required = requireScope(scope, true) as Required<WorkingMemoryKey> & { threadId: string };
      const result = await q.query(
        `SELECT current_generation FROM ${deps.generationsTable}
         WHERE tenant_id = $1 AND resource_id = $2 AND thread_id = $3`,
        [required.tenantId, required.resourceId, required.threadId],
      );
      const value = result.rows[0]?.current_generation;
      return value === null || value === undefined ? undefined : Number(value);
    },

    async setCurrentGeneration(scope, generation) {
      if (
        !(
          (typeof generation === "number" && Number.isInteger(generation) && generation >= 0) ||
          (typeof generation === "bigint" && generation >= 0)
        )
      ) {
        throw new MemoryValidationError("generation must be a non-negative integer");
      }
      const required = requireScope(scope, true) as Required<WorkingMemoryKey> & { threadId: string };
      await q.query(
        `INSERT INTO ${deps.generationsTable} (tenant_id, resource_id, thread_id, current_generation)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, resource_id, thread_id)
         DO UPDATE SET current_generation = EXCLUDED.current_generation`,
        [required.tenantId, required.resourceId, required.threadId, String(generation)],
      );
    },
  };
  // Declared only when the tsvector column exists (buildVectorSearchDdl may have been skipped
  // on pre-12 PostgreSQL / pre-0.5 pgvector). Explicit "fts" requests fail closed otherwise.
  // # ponytail: bm25 undeclared until a ParadeDB pg_search dependency is justified; capability seam is VectorStore.lexicalModes
  if (!deps.lexical) return base;
  return {
    ...base,
    lexicalModes: ["fts"],
    async lexicalQuery(lexicalQuery) {
      assertNotAborted(lexicalQuery.signal);
      const scope = requireScope(lexicalQuery, true) as Required<WorkingMemoryKey> & { threadId: string };
      requireNonEmptyString(lexicalQuery.text, "text");
      const result = await q.query(
        `SELECT ${VECTOR_COLUMNS}, ts_rank(text_tsv, websearch_to_tsquery('english', $4)) AS score
         FROM ${table}
         WHERE tenant_id = $1 AND resource_id = $2 AND thread_id = $3
           AND text_tsv @@ websearch_to_tsquery('english', $4)
           AND (generation IS NULL OR generation = COALESCE(
                 (SELECT current_generation FROM ${deps.generationsTable}
                  WHERE tenant_id = $1 AND resource_id = $2 AND thread_id = $3), generation))
         ORDER BY score DESC, sequence ASC, id ASC
         LIMIT $5`,
        [scope.tenantId, scope.resourceId, scope.threadId, lexicalQuery.text, Math.max(1, lexicalQuery.topK)],
      );
      return result.rows.map((row) => mapVectorRow(row, Number(row.score))) as MemoryVectorHit[];
    },
  };
}

async function runVectorTransaction<T>(
  pool: Pool,
  deps: VectorTableDeps,
  operation: (store: PostgresVectorSourceStore) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  assertNotAborted(signal);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(createVectorMethods(client, deps));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function assembleVectorStore(pool: Pool, deps: VectorTableDeps): PostgresVectorStore {
  const direct = createVectorMethods(pool, deps);
  return {
    ...direct,
    // Batch upserts are atomic as a unit; single-statement upserts inside transactions skip the nested BEGIN.
    async upsert(records, options = {}) {
      if (records.length === 0) return;
      return runVectorTransaction(pool, deps, (view) => view.upsert(records, options), options.signal);
    },
    async transaction(operation, options = {}) {
      return runVectorTransaction(pool, deps, operation, options.signal);
    },
  };
}

async function textTsvAvailable(pool: Pool, schema: string, table: string): Promise<boolean> {
  const result = await pool.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = 'text_tsv' LIMIT 1",
    [schema, table],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Standalone durable pgvector knowledge store over an existing (or newly created) pool. */
export async function createPostgresVectorStore(
  options: PostgresVectorStoreOptions,
): Promise<PostgresVectorStore & { readonly pool: Pool; readonly schema: string; close(): Promise<void> }> {
  const schema = validateIdentifier(options.schema ?? DEFAULT_MEMORY_SCHEMA, "schema");
  const table = validateIdentifier(options.table ?? DEFAULT_VECTOR_TABLE, "table");
  const maxEntryTextChars = options.maxEntryTextChars ?? 64_384;
  const dimension = options.dimension;
  if (dimension !== undefined && (!Number.isInteger(dimension) || dimension <= 0)) {
    throw new MemoryValidationError("dimension must be a positive integer");
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

  const qualifiedTable = qualifyTable(schema, table);
  if (!options.skipMigrations) {
    await pool.query(buildMemoryDdl(schema, table));
    if (dimension !== undefined) {
      // Pin embedding width first: pgvector can only build HNSW over vector(N) columns.
      await pool
        .query(
          `ALTER TABLE ${qualifiedTable}
         ALTER COLUMN embedding TYPE vector(${dimension})
         USING embedding::vector`,
        )
        .catch(() => undefined);
    }
    await pool.query(buildVectorSearchDdl(schema, table, dimension)).catch(() => undefined);
  }

  return Object.assign(
    assembleVectorStore(pool, {
      table: qualifiedTable,
      generationsTable: `${quoteIdentifier(schema)}.${quoteIdentifier(`${table}_rag_scope_generations`)}`,
      maxEntryTextChars,
      dimensions: dimension,
      lexical: await textTsvAvailable(pool, schema, table).catch(() => false),
    }),
    {
      pool,
      schema,
      async close() {
        if (ownsPool) await pool.end();
      },
    },
  );
}
