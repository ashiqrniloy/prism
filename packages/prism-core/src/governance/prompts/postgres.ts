import type { Pool, PoolConfig } from "pg";
import { diffPromptRecords } from "./diff.js";
import { PromptNotFoundError } from "./errors.js";
import { resolvePromptPageLimit } from "./limits.js";
import { decodePromptCursor, encodePromptCursor } from "./pagination.js";
import { DEFAULT_PROMPT_SCHEMA } from "./postgres-ddl.js";
import { qualifyPromptTable, validatePromptIdentifier } from "./postgres-identifiers.js";
import { applyPostgresPromptMigrations } from "./postgres-migrations.js";
import { createPromptStoreOptions } from "./store.js";
import type {
  PromptDiff,
  PromptDiffInput,
  PromptListQuery,
  PromptOwnership,
  PromptRecord,
  PromptResolveInput,
  PromptStore,
  PromptStoreOptions,
  PutPromptInput,
} from "./types.js";
import { normalizeOwnership, normalizeStoredPrompt, preparePrompt, requireLabel, requireName, requireVersion } from "./util.js";

export interface PostgresPromptStoreOptions extends PromptStoreOptions {
  /** Existing `pg` pool. Caller owns its lifecycle when supplied. */
  readonly pool?: Pool;
  /** Connection string used when `pool` is omitted. */
  readonly connectionString?: string;
  /** PostgreSQL schema for prompt tables. Defaults to `prism`. */
  readonly schema?: string;
  /** Maximum size of an adapter-owned pool. Defaults to `10`. */
  readonly poolMax?: number;
  /** Additional options for an adapter-owned pool. */
  readonly poolConfig?: Omit<PoolConfig, "connectionString" | "max">;
  /** Skip automatic migrations (tests and already-managed schemas only). */
  readonly skipMigrations?: boolean;
}

export interface PostgresPromptStore extends PromptStore {
  readonly name: "postgres";
  readonly pool: Pool;
  readonly schema: string;
  close(): Promise<void>;
}

type PromptRow = Record<string, unknown>;

export async function createPostgresPromptStore(options: PostgresPromptStoreOptions): Promise<PostgresPromptStore>;
export async function createPostgresPromptStore(pool: Pool, schema?: string): Promise<PostgresPromptStore>;
export async function createPostgresPromptStore(
  optionsOrPool: PostgresPromptStoreOptions | Pool,
  schemaInput = DEFAULT_PROMPT_SCHEMA,
): Promise<PostgresPromptStore> {
  const options: PostgresPromptStoreOptions = isPool(optionsOrPool) ? { pool: optionsOrPool, schema: schemaInput } : optionsOrPool;
  const schema = validatePromptIdentifier(options.schema ?? DEFAULT_PROMPT_SCHEMA, "schema");
  const { limits, ownership: fallback, now } = createPromptStoreOptions(options);
  const ownsPool = options.pool === undefined;
  const { Pool: PgPool } = await import("pg");
  const pool =
    options.pool ??
    new PgPool({
      connectionString: requireConnectionString(options.connectionString),
      max: options.poolMax ?? 10,
      ...(options.poolConfig ?? {}),
    });
  let closed = false;
  try {
    if (!options.skipMigrations) await applyPostgresPromptMigrations(pool, schema);
  } catch (error) {
    if (ownsPool) await pool.end();
    throw error;
  }

  const prompts = qualifyPromptTable(schema, "prism_prompts");
  const labels = qualifyPromptTable(schema, "prism_prompt_labels");

  async function put(input: PutPromptInput): Promise<PromptRecord> {
    input.signal?.throwIfAborted();
    const scope = normalizeOwnership(input, fallback);
    const name = requireName(input.name, limits);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`prism-prompts:${scopeKey(scope, name)}`]);
      const max = await client.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS version
         FROM ${prompts}
         WHERE tenant_id = $1 AND account_id = $2 AND user_id = $3 AND name = $4`,
        [scope.tenantId, scope.accountId, scope.userId, name],
      );
      const version = Number((max.rows[0] as { version: number }).version);
      const record = preparePrompt(input, version, scope, limits, now);
      await client.query(
        `INSERT INTO ${prompts} (
          tenant_id, account_id, user_id, name, version, body, hash, labels, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)`,
        [
          scope.tenantId,
          scope.accountId,
          scope.userId,
          record.name,
          record.version,
          record.body,
          record.hash,
          JSON.stringify(record.labels),
          record.metadata === undefined ? null : JSON.stringify(record.metadata),
          record.createdAt,
        ],
      );
      for (const label of record.labels) {
        await client.query(
          `INSERT INTO ${labels} (tenant_id, account_id, user_id, name, version, label)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [scope.tenantId, scope.accountId, scope.userId, record.name, record.version, label],
        );
      }
      await client.query("COMMIT");
      return record;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function list(query: PromptListQuery = {}) {
    query.signal?.throwIfAborted();
    const scope = normalizeOwnership(query, fallback);
    const name = query.name === undefined ? undefined : requireName(query.name, limits);
    const label = query.label === undefined ? undefined : requireLabel(query.label, limits);
    const order = query.order === "desc" ? "desc" : "asc";
    const cursor = decodePromptCursor(query.cursor, scope, { name, label, order }, limits);
    const pageSize = resolvePromptPageLimit(query.limit, limits);
    const clauses = ["p.tenant_id = $1", "p.account_id = $2", "p.user_id = $3"];
    const params: unknown[] = [scope.tenantId, scope.accountId, scope.userId];
    if (name !== undefined) {
      clauses.push(`p.name = $${params.push(name)}`);
    }
    if (label !== undefined) {
      const placeholder = params.push(label);
      clauses.push(
        `EXISTS (
          SELECT 1 FROM ${labels} l
          WHERE l.tenant_id = p.tenant_id AND l.account_id = p.account_id AND l.user_id = p.user_id
            AND l.name = p.name AND l.version = p.version AND l.label = $${placeholder}
        )`,
      );
    }
    if (cursor) {
      if (name !== undefined) {
        const placeholder = params.push(cursor.lastVersion);
        clauses.push(`p.version ${order === "asc" ? ">" : "<"} $${placeholder}`);
      } else {
        const first = params.push(cursor.lastName);
        const second = params.push(cursor.lastName);
        const third = params.push(cursor.lastVersion);
        clauses.push(
          order === "asc"
            ? `(p.name > $${first} OR (p.name = $${second} AND p.version > $${third}))`
            : `(p.name < $${first} OR (p.name = $${second} AND p.version < $${third}))`,
        );
      }
    }
    const result = await pool.query(
      `SELECT p.tenant_id, p.account_id, p.user_id, p.name, p.version, p.body, p.hash,
              p.labels::text AS labels, p.metadata::text AS metadata, p.created_at
       FROM ${prompts} p
       WHERE ${clauses.join(" AND ")}
       ORDER BY p.name ${order.toUpperCase()}, p.version ${order.toUpperCase()}
       LIMIT $${params.push(pageSize + 1)}`,
      params,
    );
    const rows = result.rows as PromptRow[];
    const pageRows = rows.slice(0, pageSize);
    const items = pageRows.map((row) => normalizeStoredPrompt(row, limits));
    const last = items.at(-1);
    return {
      items: Object.freeze(items),
      ...(rows.length > pageSize && last ? { nextCursor: encodePromptCursor(scope, { name, label, order }, last.name, last.version) } : {}),
    };
  }

  async function resolve(input: PromptResolveInput): Promise<PromptRecord | null> {
    input.signal?.throwIfAborted();
    const scope = normalizeOwnership(input, fallback);
    const name = requireName(input.name, limits);
    const label = input.label === undefined ? undefined : requireLabel(input.label, limits);
    const clauses = ["p.tenant_id = $1", "p.account_id = $2", "p.user_id = $3", "p.name = $4"];
    const params: unknown[] = [scope.tenantId, scope.accountId, scope.userId, name];
    if (input.version !== undefined) clauses.push(`p.version = $${params.push(requireVersion(input.version))}`);
    if (label !== undefined) {
      const placeholder = params.push(label);
      clauses.push(
        `EXISTS (
          SELECT 1 FROM ${labels} l
          WHERE l.tenant_id = p.tenant_id AND l.account_id = p.account_id AND l.user_id = p.user_id
            AND l.name = p.name AND l.version = p.version AND l.label = $${placeholder}
        )`,
      );
    }
    const result = await pool.query(
      `SELECT p.tenant_id, p.account_id, p.user_id, p.name, p.version, p.body, p.hash,
              p.labels::text AS labels, p.metadata::text AS metadata, p.created_at
       FROM ${prompts} p
       WHERE ${clauses.join(" AND ")}
       ORDER BY p.version DESC
       LIMIT 1`,
      params,
    );
    const row = result.rows[0] as PromptRow | undefined;
    return row === undefined ? null : normalizeStoredPrompt(row, limits);
  }

  async function diff(
    first: PromptDiffInput | string,
    fromVersion?: number,
    toVersion?: number,
    ownership?: PromptOwnership,
  ): Promise<PromptDiff> {
    const input: PromptDiffInput =
      typeof first === "string"
        ? {
            name: first,
            fromVersion: requireVersion(fromVersion, "fromVersion"),
            toVersion: requireVersion(toVersion, "toVersion"),
            ...(ownership ?? {}),
          }
        : first;
    input.signal?.throwIfAborted();
    const from = await resolve({ ...input, version: input.fromVersion });
    const to = await resolve({ ...input, version: input.toVersion });
    if (!from || !to) throw new PromptNotFoundError(`${input.name}@${from ? input.toVersion : input.fromVersion} not found`);
    return diffPromptRecords(from, to, limits.maxDiffLines);
  }

  return {
    name: "postgres",
    pool,
    schema,
    put,
    list,
    resolve,
    diff,
    async close() {
      if (ownsPool && !closed) {
        closed = true;
        await pool.end();
      }
    },
  };
}

function isPool(value: PostgresPromptStoreOptions | Pool): value is Pool {
  return typeof (value as Pool).connect === "function";
}

function requireConnectionString(value: string | undefined): string {
  if (!value || value.trim().length === 0) throw new Error("PostgresPromptStoreOptions requires pool or connectionString");
  return value;
}

function scopeKey(scope: { readonly tenantId: string; readonly accountId: string; readonly userId: string }, name: string): string {
  return JSON.stringify([scope.tenantId, scope.accountId, scope.userId, name]);
}
