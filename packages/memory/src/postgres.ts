import type { JsonObject } from "@arnilo/prism";
import type { Pool, PoolClient, PoolConfig } from "pg";
import { assertAccessConstraint, assertAccessGrants, assertAuthorizationTenant } from "./acl.js";
import { MemoryConflictError, MemoryValidationError } from "./errors.js";
import { assertInvalidationBatch, assertShareGrant, HARD_LINEAGE_EDGES } from "./lineage.js";
import { decodeMemoryCursor, encodeMemoryCursor } from "./pagination.js";
import { buildMemoryDdl, buildVectorSearchDdl, DEFAULT_MEMORY_SCHEMA, DEFAULT_VECTOR_TABLE } from "./postgres-ddl.js";
import { qualifyTable, quoteIdentifier, validateIdentifier } from "./postgres-identifiers.js";
import { normalizeImportance } from "./scoring.js";
import type {
  MemoryConsent,
  MemoryInvalidationRecord,
  MemoryShareGrant,
  MemoryVectorHit,
  MemoryVectorOrder,
  MemoryVectorRecord,
  RagAccessConstraint,
  StoreDenial,
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
    aclTable: `${quoteIdentifier(schema)}.${quoteIdentifier(`${DEFAULT_VECTOR_TABLE}_rag_source_acl`)}`,
    invalidationTable: `${quoteIdentifier(schema)}.${quoteIdentifier(`${DEFAULT_VECTOR_TABLE}_invalidation`)}`,
    shareGrantTable: `${quoteIdentifier(schema)}.${quoteIdentifier(`${DEFAULT_VECTOR_TABLE}_share_grant`)}`,
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
  /** Fully qualified per-source ACL table. */
  readonly aclTable: string;
  readonly invalidationTable: string;
  readonly shareGrantTable: string;
  readonly maxEntryTextChars: number;
  readonly dimensions?: number;
  /** Whether the text_tsv column exists — gates the lexical leg declaration. */
  readonly lexical: boolean;
}

/** The grant predicate itself, so the reporting statement can negate it without rewriting it. */
function authorizationExists(authorization: RagAccessConstraint, aclTable: string, tenantId: string, params: unknown[]): string {
  const auth = assertAccessConstraint(authorization);
  assertAuthorizationTenant(auth, tenantId);
  params.push(auth.principalId);
  const principal = params.length;
  params.push([...(auth.groupIds ?? [])]);
  const groups = params.length;
  params.push(auth.accessVersion ?? null);
  const version = params.length;
  return `EXISTS (
    SELECT 1 FROM ${aclTable} a
    WHERE a.tenant_id = t.tenant_id
      AND a.resource_id = t.resource_id
      AND a.thread_id = t.thread_id
      AND a.source_id = t.metadata->'_rag'->>'sourceId'
      AND (a.principal_id = $${principal} OR (cardinality($${groups}::text[]) > 0 AND a.group_id = ANY($${groups}::text[])))
      AND ($${version}::int IS NULL OR a.access_version = $${version})
  )`;
}

function authorizationPredicate(
  authorization: RagAccessConstraint | undefined,
  aclTable: string,
  tenantId: string,
  params: unknown[],
): string {
  if (!authorization) return "";
  return ` AND ${authorizationExists(authorization, aclTable, tenantId, params)}`;
}

function invalidationPredicate(invalidationTable: string): string {
  return ` AND NOT EXISTS (
    SELECT 1 FROM ${invalidationTable} i
    WHERE i.tenant_id = t.tenant_id
      AND i.resource_id = t.resource_id
      AND i.thread_id = t.thread_id
      AND (
        (i.id = t.id AND i.reason <> 'corrected')
        OR (
          i.id <> t.id
          AND COALESCE(t.metadata->'_lineage'->'sourceIds', '[]'::jsonb) ? i.id
        )
      )
  )`;
}

function idsPredicate(ids: readonly string[] | undefined, params: unknown[]): string {
  if (!ids) return "";
  if (ids.length === 0) return " AND FALSE";
  if (ids.length > HARD_LINEAGE_EDGES) throw new MemoryValidationError(`query ids exceed hard cap ${HARD_LINEAGE_EDGES}`);
  params.push([...ids]);
  return ` AND t.id = ANY($${params.length}::text[])`;
}

/** Grant lookup for the reporting statement's reason column, at any version or exactly one. */
function grantLookup(aclTable: string, principal: number, groups: number, version?: number): string {
  const atVersion = version === undefined ? "" : `\n           AND a.access_version = $${version}`;
  return `SELECT 1 FROM ${aclTable} a
         WHERE a.tenant_id = t.tenant_id
           AND a.resource_id = t.resource_id
           AND a.thread_id = t.thread_id
           AND a.source_id = t.metadata->'_rag'->>'sourceId'
           AND (a.principal_id = $${principal} OR (cardinality($${groups}::text[]) > 0 AND a.group_id = ANY($${groups}::text[])))${atVersion}`;
}

/** Mirrors the per-leg filters of `query`/`lexicalQuery`; the leg's own ACL predicate is the negated one. */
interface DeniedSourcesQuery {
  readonly q: Queryable;
  readonly deps: VectorTableDeps;
  readonly scope: { readonly tenantId: string; readonly resourceId: string; readonly threadId: string };
  readonly authorization: RagAccessConstraint;
  readonly ids: readonly string[] | undefined;
  /** Lexical leg only: the same full-text filter the main statement applies. */
  readonly text?: string;
}

/**
 * Plan 102 Task 6: one grouped statement naming the sources the store's ACL predicate withheld for this
 * query, with the rule that withheld them. Runs only when the caller opted in through `onDeniedSources`:
 * the main leg keeps its predicate untouched, so a query without the callback is byte-identical and one
 * statement cheaper (pinned by `postgres-vector.integration.test.ts`).
 */
async function reportDeniedSources(options: DeniedSourcesQuery): Promise<readonly StoreDenial[]> {
  const { q, deps, scope, authorization, ids, text } = options;
  const params: unknown[] = [scope.tenantId, scope.resourceId, scope.threadId];
  let search = "";
  if (text !== undefined) {
    requireNonEmptyString(text, "text");
    params.push(text);
    search = `\n           AND text_tsv @@ websearch_to_tsquery('english', $${params.length})`;
  }
  // `authorizationExists` pushed exactly [principal, groups, version] last, so the CASE reuses its indices.
  const acl = authorizationExists(authorization, deps.aclTable, scope.tenantId, params);
  const classPrincipal = params.length - 2;
  const classGroups = params.length - 1;
  const classVersion = params.length;
  const idsSql = idsPredicate(ids, params);
  const inv = invalidationPredicate(deps.invalidationTable);
  const source = "t.metadata->'_rag'->>'sourceId'";
  const result = await q.query(
    `SELECT ${source} AS source_id,
            CASE
              WHEN NOT EXISTS (
                ${grantLookup(deps.aclTable, classPrincipal, classGroups)}
              ) THEN 'no_grant'
              WHEN $${classVersion}::int IS NOT NULL AND NOT EXISTS (
                ${grantLookup(deps.aclTable, classPrincipal, classGroups, classVersion)}
              ) THEN 'version_mismatch'
              ELSE 'unknown'
            END AS reason
     FROM ${deps.table} t
     WHERE tenant_id = $1 AND resource_id = $2 AND thread_id = $3
       AND (generation IS NULL OR generation = COALESCE(
             (SELECT current_generation FROM ${deps.generationsTable}
              WHERE tenant_id = $1 AND resource_id = $2 AND thread_id = $3), generation))${search}
       AND ${source} IS NOT NULL AND ${source} <> ''
       AND NOT (${acl})${idsSql}${inv}
     GROUP BY 1, 2`,
    params,
  );
  return result.rows.map((row) =>
    Object.freeze({
      sourceId: String((row as { source_id: string }).source_id),
      reason: (row as { reason: StoreDenial["reason"] }).reason,
    }),
  );
}

/** All vector statements bound to one Queryable — pool for direct use, PoolClient inside transactions. */
function createVectorMethods(q: Queryable, deps: VectorTableDeps): PostgresVectorSourceStore {
  const { table } = deps;
  const base: PostgresVectorSourceStore = {
    authorization: "acl",
    lineage: "invalidation",
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
      const params: unknown[] = [scope.tenantId, scope.resourceId, scope.threadId, toVectorLiteral(query.embedding), query.topK];
      const acl = authorizationPredicate(query.authorization, deps.aclTable, scope.tenantId, params);
      const ids = idsPredicate(query.ids, params);
      const inv = invalidationPredicate(deps.invalidationTable);
      const result = await q.query(
        `SELECT ${VECTOR_COLUMNS},
                1 - (embedding <=> $4::vector) AS score
         FROM ${table} t
         WHERE tenant_id = $1 AND resource_id = $2 AND thread_id = $3
           AND (generation IS NULL OR generation = COALESCE(
                 (SELECT current_generation FROM ${deps.generationsTable}
                  WHERE tenant_id = $1 AND resource_id = $2 AND thread_id = $3), generation))
           ${acl}${ids}${inv}
         ORDER BY embedding <=> $4::vector ASC, sequence ASC, id ASC
         LIMIT $5`,
        params,
      );
      if (query.onDeniedSources) {
        query.onDeniedSources(
          query.authorization ? await reportDeniedSources({ q, deps, scope, authorization: query.authorization, ids: query.ids }) : [],
        );
      }
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

    async setSourceAccess(scope, input, accessOptions = {}) {
      assertNotAborted(accessOptions.signal);
      const required = requireScope(scope, true) as Required<WorkingMemoryKey> & { threadId: string };
      const grants = assertAccessGrants(input);
      if (grants.length === 0) return;
      const sourceIds = grants.map((grant) => grant.sourceId);
      await q.query(
        `DELETE FROM ${deps.aclTable}
         WHERE tenant_id = $1 AND resource_id = $2 AND thread_id = $3 AND source_id = ANY($4)`,
        [required.tenantId, required.resourceId, required.threadId, sourceIds],
      );
      const rows: unknown[] = [];
      const values: string[] = [];
      let index = 1;
      for (const grant of grants) {
        for (const principalId of grant.principalIds ?? []) {
          values.push(`($${index++},$${index++},$${index++},$${index++},$${index++},'',$${index++})`);
          rows.push(required.tenantId, required.resourceId, required.threadId, grant.sourceId, principalId, grant.accessVersion);
        }
        for (const groupId of grant.groupIds ?? []) {
          values.push(`($${index++},$${index++},$${index++},$${index++},'',$${index++},$${index++})`);
          rows.push(required.tenantId, required.resourceId, required.threadId, grant.sourceId, groupId, grant.accessVersion);
        }
      }
      if (values.length === 0) return;
      await q.query(
        `INSERT INTO ${deps.aclTable}
           (tenant_id, resource_id, thread_id, source_id, principal_id, group_id, access_version)
         VALUES ${values.join(",")}`,
        rows,
      );
    },

    async checkSourceAccess(scope, sourceId, authorization, accessOptions = {}) {
      assertNotAborted(accessOptions.signal);
      const required = requireScope(scope, true) as Required<WorkingMemoryKey> & { threadId: string };
      requireNonEmptyString(sourceId, "sourceId");
      const auth = assertAccessConstraint(authorization);
      assertAuthorizationTenant(auth, required.tenantId);
      const result = await q.query(
        `SELECT 1 FROM ${deps.aclTable}
         WHERE tenant_id = $1 AND resource_id = $2 AND thread_id = $3 AND source_id = $4
           AND (principal_id = $5 OR (cardinality($6::text[]) > 0 AND group_id = ANY($6::text[])))
           AND ($7::int IS NULL OR access_version = $7)
         LIMIT 1`,
        [
          required.tenantId,
          required.resourceId,
          required.threadId,
          sourceId,
          auth.principalId,
          [...(auth.groupIds ?? [])],
          auth.accessVersion ?? null,
        ],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async invalidate(scope, entries, invalidateOptions = {}) {
      assertNotAborted(invalidateOptions.signal);
      const required = requireScope(scope, true) as Required<WorkingMemoryKey> & { threadId: string };
      const batch = assertInvalidationBatch(entries);
      if (batch.length === 0) return;
      const rows: unknown[] = [];
      const values: string[] = [];
      let index = 1;
      for (const entry of batch) {
        values.push(`($${index++},$${index++},$${index++},$${index++},$${index++},$${index++}::timestamptz,$${index++},$${index++})`);
        rows.push(
          required.tenantId,
          required.resourceId,
          required.threadId,
          entry.id,
          entry.reason,
          entry.at,
          entry.hold === true || entry.reason === "legal_hold",
          entry.supersedesId ?? null,
        );
      }
      await q.query(
        `INSERT INTO ${deps.invalidationTable}
           (tenant_id, resource_id, thread_id, id, reason, at, hold, supersedes_id)
         VALUES ${values.join(",")}
         ON CONFLICT (tenant_id, resource_id, thread_id, id)
         DO UPDATE SET
           hold = ${deps.invalidationTable}.hold OR EXCLUDED.hold,
           reason = CASE
             WHEN ${deps.invalidationTable}.hold OR ${deps.invalidationTable}.reason = 'legal_hold'
             THEN ${deps.invalidationTable}.reason
             ELSE EXCLUDED.reason
           END,
           at = EXCLUDED.at,
           supersedes_id = COALESCE(EXCLUDED.supersedes_id, ${deps.invalidationTable}.supersedes_id)`,
        rows,
      );
    },

    async listInvalidated(scope, listOptions = {}) {
      assertNotAborted(listOptions.signal);
      const required = requireScope(scope, true) as Required<WorkingMemoryKey> & { threadId: string };
      const result = await q.query(
        `SELECT id, reason, at, hold, supersedes_id
         FROM ${deps.invalidationTable}
         WHERE tenant_id = $1 AND resource_id = $2 AND thread_id = $3`,
        [required.tenantId, required.resourceId, required.threadId],
      );
      return result.rows.map((row) => {
        const record: MemoryInvalidationRecord = {
          id: String(row.id),
          reason: row.reason as MemoryInvalidationRecord["reason"],
          at: new Date(row.at).toISOString(),
          ...(row.hold === true ? { hold: true } : {}),
          ...(row.supersedes_id ? { supersedesId: String(row.supersedes_id) } : {}),
        };
        return record;
      });
    },

    async clearInvalidation(scope, ids, clearOptions = {}) {
      assertNotAborted(clearOptions.signal);
      const required = requireScope(scope, true) as Required<WorkingMemoryKey> & { threadId: string };
      if (ids.length === 0) return;
      await q.query(
        `DELETE FROM ${deps.invalidationTable}
         WHERE tenant_id = $1 AND resource_id = $2 AND thread_id = $3
           AND id = ANY($4::text[])
           AND hold = FALSE AND reason <> 'legal_hold'`,
        [required.tenantId, required.resourceId, required.threadId, [...ids]],
      );
    },

    async setShareGrant(scope, input, shareOptions = {}) {
      assertNotAborted(shareOptions.signal);
      const required = requireScope(scope, true) as Required<WorkingMemoryKey> & { threadId: string };
      const grant = assertShareGrant({ ...input, tenantId: required.tenantId, parentThreadId: required.threadId });
      if (grant.sourceIds.length === 0) {
        await q.query(
          `DELETE FROM ${deps.shareGrantTable}
           WHERE tenant_id = $1 AND parent_thread_id = $2 AND child_thread_id = $3`,
          [grant.tenantId, grant.parentThreadId, grant.childThreadId],
        );
        return;
      }
      await q.query(
        `INSERT INTO ${deps.shareGrantTable}
           (tenant_id, parent_thread_id, child_thread_id, source_ids, expires_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
         ON CONFLICT (tenant_id, parent_thread_id, child_thread_id)
         DO UPDATE SET source_ids = EXCLUDED.source_ids, expires_at = EXCLUDED.expires_at`,
        [grant.tenantId, grant.parentThreadId, grant.childThreadId, JSON.stringify(grant.sourceIds), grant.expiresAt ?? null],
      );
    },

    async getShareGrant(scope, childThreadId, shareOptions = {}) {
      assertNotAborted(shareOptions.signal);
      const required = requireScope(scope, true) as Required<WorkingMemoryKey> & { threadId: string };
      const result = await q.query(
        `SELECT tenant_id, parent_thread_id, child_thread_id, source_ids, expires_at
         FROM ${deps.shareGrantTable}
         WHERE tenant_id = $1 AND parent_thread_id = $2 AND child_thread_id = $3`,
        [required.tenantId, required.threadId, requireNonEmptyString(childThreadId, "childThreadId")],
      );
      const row = result.rows[0];
      if (!row) return undefined;
      const grant: MemoryShareGrant = {
        tenantId: String(row.tenant_id),
        parentThreadId: String(row.parent_thread_id),
        childThreadId: String(row.child_thread_id),
        sourceIds: Array.isArray(row.source_ids) ? row.source_ids.map((id: unknown) => String(id)) : [],
        ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}),
      };
      return grant;
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
      const params: unknown[] = [scope.tenantId, scope.resourceId, scope.threadId, lexicalQuery.text, Math.max(1, lexicalQuery.topK)];
      const acl = authorizationPredicate(lexicalQuery.authorization, deps.aclTable, scope.tenantId, params);
      const ids = idsPredicate(lexicalQuery.ids, params);
      const inv = invalidationPredicate(deps.invalidationTable);
      const result = await q.query(
        `SELECT ${VECTOR_COLUMNS}, ts_rank(text_tsv, websearch_to_tsquery('english', $4)) AS score
         FROM ${table} t
         WHERE tenant_id = $1 AND resource_id = $2 AND thread_id = $3
           AND text_tsv @@ websearch_to_tsquery('english', $4)
           AND (generation IS NULL OR generation = COALESCE(
                 (SELECT current_generation FROM ${deps.generationsTable}
                  WHERE tenant_id = $1 AND resource_id = $2 AND thread_id = $3), generation))
           ${acl}${ids}${inv}
         ORDER BY score DESC, sequence ASC, id ASC
         LIMIT $5`,
        params,
      );
      // `topK < 1` mirrors the memory adapter, which returns before it reads any row: nothing considered, nothing reported.
      if (lexicalQuery.onDeniedSources && lexicalQuery.topK >= 1) {
        lexicalQuery.onDeniedSources(
          lexicalQuery.authorization
            ? await reportDeniedSources({
                q,
                deps,
                scope,
                authorization: lexicalQuery.authorization,
                ids: lexicalQuery.ids,
                text: lexicalQuery.text,
              })
            : [],
        );
      }
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
    async setSourceAccess(scope, grants, options = {}) {
      return runVectorTransaction(pool, deps, (view) => view.setSourceAccess!(scope, grants, options), options.signal);
    },
    async invalidate(scope, entries, options = {}) {
      return runVectorTransaction(pool, deps, (view) => view.invalidate!(scope, entries, options), options.signal);
    },
    async clearInvalidation(scope, ids, options = {}) {
      return runVectorTransaction(pool, deps, (view) => view.clearInvalidation!(scope, ids, options), options.signal);
    },
    async setShareGrant(scope, grant, options = {}) {
      return runVectorTransaction(pool, deps, (view) => view.setShareGrant!(scope, grant, options), options.signal);
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
      aclTable: `${quoteIdentifier(schema)}.${quoteIdentifier(`${table}_rag_source_acl`)}`,
      invalidationTable: `${quoteIdentifier(schema)}.${quoteIdentifier(`${table}_invalidation`)}`,
      shareGrantTable: `${quoteIdentifier(schema)}.${quoteIdentifier(`${table}_share_grant`)}`,
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
