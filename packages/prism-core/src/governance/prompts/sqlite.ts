import { createRequire } from "node:module";
import type Database from "better-sqlite3";
import { diffPromptRecords } from "./diff.js";
import { PromptNotFoundError, PromptValidationError } from "./errors.js";
import { resolvePromptPageLimit } from "./limits.js";
import { decodePromptCursor, encodePromptCursor } from "./pagination.js";
import { applySqlitePromptMigrations, assertSqlitePromptSchemaReady } from "./sqlite-migrations.js";
import { createPromptStoreOptions } from "./store.js";

const require = createRequire(import.meta.url);

function getSqliteConstructor(): new (filename: string, options?: Database.Options) => Database.Database {
  try {
    const mod = require("better-sqlite3");
    return mod.default ?? mod;
  } catch (error) {
    throw new Error(
      "@arnilo/prism-core/governance/prompts: optional peer dependency 'better-sqlite3' is not installed. " +
        "Install it (npm i better-sqlite3) to use SQLite prompt storage.",
      { cause: error },
    );
  }
}

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

export interface SqlitePromptStoreOptions extends PromptStoreOptions {
  /** SQLite database file path. Defaults to `:memory:`. */
  readonly filename?: string;
  /** Existing open database handle. Caller owns its lifecycle when supplied. */
  readonly database?: Database.Database;
  /** Enable SQLite WAL mode. Defaults to `true`. */
  readonly wal?: boolean;
  /** SQLite busy timeout in milliseconds. Defaults to `5000`. */
  readonly busyTimeoutMs?: number;
  /** Skip automatic migrations (tests and already-managed schemas only). */
  readonly skipMigrations?: boolean;
}

export interface SqlitePromptStore extends PromptStore {
  readonly name: "sqlite";
  readonly database: Database.Database;
  close(): void;
}

const DEFAULT_BUSY_TIMEOUT_MS = 5000;

type PromptRow = Record<string, unknown>;

export function createSqlitePromptStore(options: SqlitePromptStoreOptions = {}): SqlitePromptStore {
  const { limits, ownership: fallback, now } = createPromptStoreOptions(options);
  const ownsDatabase = options.database === undefined;
  const DatabaseConstructor = getSqliteConstructor();
  const database = options.database ?? new DatabaseConstructor(options.filename ?? ":memory:");
  let closed = false;
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0 || busyTimeoutMs > 120_000) {
    if (ownsDatabase) database.close();
    throw new PromptValidationError("busyTimeoutMs must be an integer in [0, 120000]", "ERR_PRISM_PROMPT_LIMITS");
  }
  try {
    database.pragma("foreign_keys = ON");
    if (options.wal !== false) database.pragma("journal_mode = WAL");
    database.pragma(`busy_timeout = ${busyTimeoutMs}`);
    if (!options.skipMigrations) applySqlitePromptMigrations(database);
    else assertSqlitePromptSchemaReady(database);
  } catch (error) {
    if (ownsDatabase) database.close();
    throw error;
  }

  const insertPrompt = database.prepare(
    `INSERT INTO prism_prompts (
      tenant_id, account_id, user_id, name, version, body, hash, labels, metadata, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertLabel = database.prepare(
    `INSERT INTO prism_prompt_labels (tenant_id, account_id, user_id, name, version, label)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const nextVersion = database.prepare(
    `SELECT COALESCE(MAX(version), 0) + 1 AS version
     FROM prism_prompts
     WHERE tenant_id = ? AND account_id = ? AND user_id = ? AND name = ?`,
  );
  const append = database.transaction((input: PutPromptInput): PromptRecord => {
    const scope = normalizeOwnership(input, fallback);
    const name = requireName(input.name, limits);
    const next = Number((nextVersion.get(scope.tenantId, scope.accountId, scope.userId, name) as { version: number }).version);
    const record = preparePrompt(input, next, scope, limits, now);
    insertPrompt.run(
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
    );
    for (const label of record.labels) insertLabel.run(scope.tenantId, scope.accountId, scope.userId, record.name, record.version, label);
    return record;
  });

  async function put(input: PutPromptInput): Promise<PromptRecord> {
    input.signal?.throwIfAborted();
    return append(input);
  }

  async function list(query: PromptListQuery = {}) {
    query.signal?.throwIfAborted();
    const scope = normalizeOwnership(query, fallback);
    const name = query.name === undefined ? undefined : requireName(query.name, limits);
    const label = query.label === undefined ? undefined : requireLabel(query.label, limits);
    const order = query.order === "desc" ? "desc" : "asc";
    const cursor = decodePromptCursor(query.cursor, scope, { name, label, order }, limits);
    const pageSize = resolvePromptPageLimit(query.limit, limits);
    const clauses = ["p.tenant_id = ?", "p.account_id = ?", "p.user_id = ?"];
    const params: unknown[] = [scope.tenantId, scope.accountId, scope.userId];
    if (name !== undefined) {
      clauses.push("p.name = ?");
      params.push(name);
    }
    if (label !== undefined) {
      clauses.push(
        `EXISTS (
          SELECT 1 FROM prism_prompt_labels l
          WHERE l.tenant_id = p.tenant_id AND l.account_id = p.account_id AND l.user_id = p.user_id
            AND l.name = p.name AND l.version = p.version AND l.label = ?
        )`,
      );
      params.push(label);
    }
    if (cursor) {
      if (name !== undefined) {
        clauses.push(`p.version ${order === "asc" ? ">" : "<"} ?`);
        params.push(cursor.lastVersion);
      } else {
        clauses.push(order === "asc" ? "(p.name > ? OR (p.name = ? AND p.version > ?))" : "(p.name < ? OR (p.name = ? AND p.version < ?))");
        params.push(cursor.lastName, cursor.lastName, cursor.lastVersion);
      }
    }
    const rows = database
      .prepare(
        `SELECT p.* FROM prism_prompts p
         WHERE ${clauses.join(" AND ")}
         ORDER BY p.name ${order.toUpperCase()}, p.version ${order.toUpperCase()}
         LIMIT ?`,
      )
      .all(...params, pageSize + 1) as PromptRow[];
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
    const clauses = ["p.tenant_id = ?", "p.account_id = ?", "p.user_id = ?", "p.name = ?"];
    const params: unknown[] = [scope.tenantId, scope.accountId, scope.userId, name];
    if (input.version !== undefined) {
      clauses.push("p.version = ?");
      params.push(requireVersion(input.version));
    }
    if (label !== undefined) {
      clauses.push(
        `EXISTS (
          SELECT 1 FROM prism_prompt_labels l
          WHERE l.tenant_id = p.tenant_id AND l.account_id = p.account_id AND l.user_id = p.user_id
            AND l.name = p.name AND l.version = p.version AND l.label = ?
        )`,
      );
      params.push(label);
    }
    const row = database
      .prepare(
        `SELECT p.* FROM prism_prompts p
         WHERE ${clauses.join(" AND ")}
         ORDER BY p.version DESC
         LIMIT 1`,
      )
      .get(...params) as PromptRow | undefined;
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
    name: "sqlite",
    database,
    put,
    list,
    resolve,
    diff,
    close() {
      if (ownsDatabase && !closed) {
        closed = true;
        database.close();
      }
    },
  };
}

export function reopenSqlitePromptStore(
  filename: string,
  options: Omit<SqlitePromptStoreOptions, "filename" | "database"> = {},
): SqlitePromptStore {
  return createSqlitePromptStore({ ...options, filename });
}
