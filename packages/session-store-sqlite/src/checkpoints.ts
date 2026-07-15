import type Database from "better-sqlite3";
import {
  CheckpointConflictError,
  type CheckpointKey,
  type CheckpointQuery,
  type CheckpointRecord,
  type CheckpointStore,
  type OwnershipScope,
} from "@arnilo/prism";

interface Row {
  namespace: string;
  key: string;
  version: number;
  fencing_token: number | null;
  category: string | null;
  tenant_id: string | null;
  account_id: string | null;
  user_id: string | null;
  value: string;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export function createSqliteCheckpointStore(database: Database.Database): CheckpointStore {
  database.exec(`
CREATE TABLE IF NOT EXISTS prism_checkpoints (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  version INTEGER NOT NULL,
  fencing_token INTEGER,
  category TEXT,
  tenant_id TEXT,
  account_id TEXT,
  user_id TEXT,
  value TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (namespace, key)
);
CREATE INDEX IF NOT EXISTS prism_checkpoints_list_idx
  ON prism_checkpoints (namespace, category, tenant_id, updated_at DESC, key);
`);
  const columns = database.prepare("PRAGMA table_info(prism_checkpoints)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "fencing_token")) database.exec("ALTER TABLE prism_checkpoints ADD COLUMN fencing_token INTEGER");
  const select = database.prepare("SELECT * FROM prism_checkpoints WHERE namespace = ? AND key = ?");
  const remove = database.prepare("DELETE FROM prism_checkpoints WHERE namespace = ? AND key = ?");
  const upsert = database.prepare(`
INSERT INTO prism_checkpoints (
  namespace, key, version, fencing_token, category, tenant_id, account_id, user_id,
  value, metadata, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(namespace, key) DO UPDATE SET
  version = excluded.version,
  fencing_token = excluded.fencing_token,
  category = excluded.category,
  tenant_id = excluded.tenant_id,
  account_id = excluded.account_id,
  user_id = excluded.user_id,
  value = excluded.value,
  metadata = excluded.metadata,
  updated_at = excluded.updated_at
WHERE prism_checkpoints.version < excluded.version
  AND (? IS NULL OR prism_checkpoints.version = ?)
  AND (prism_checkpoints.fencing_token IS NULL OR excluded.fencing_token >= prism_checkpoints.fencing_token)
`);

  return {
    async saveCheckpoint(input) {
      throwIfAborted(input.signal);
      assertInput(input);
      const previous = rowToRecord(select.get(input.namespace, input.key) as Row | undefined);
      if (previous) assertOwnership(input, previous);
      if (input.expectedVersion !== undefined && input.expectedVersion !== (previous?.version ?? 0)) throw staleExpected(input.expectedVersion, previous?.version ?? 0);
      if (previous && input.version <= previous.version) throw stale(input.version, previous.version);
      if (previous?.fencingToken !== undefined && (input.fencingToken === undefined || input.fencingToken < previous.fencingToken)) throw staleFence(input.fencingToken, previous.fencingToken);
      const now = new Date().toISOString();
      const result = upsert.run(
        input.namespace, input.key, input.version, input.fencingToken ?? null, input.category ?? null,
        input.tenantId ?? null, input.accountId ?? null, input.userId ?? null,
        encodeJson(input.value, "Checkpoint value"), input.metadata === undefined ? null : encodeJson(input.metadata, "Checkpoint metadata"),
        previous?.createdAt ?? now, now, input.expectedVersion ?? null, input.expectedVersion ?? null,
      );
      if (result.changes === 0) throw stale(input.version, previous?.version);
      return rowToRecord(select.get(input.namespace, input.key) as Row)!;
    },

    async loadCheckpoint(input) {
      throwIfAborted(input.signal);
      const record = rowToRecord(select.get(input.namespace, input.key) as Row | undefined);
      if (!record) return null;
      assertOwnership(input, record);
      return record;
    },

    async listCheckpoints(query: CheckpointQuery = {}) {
      throwIfAborted(query.signal);
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (query.namespace !== undefined) { clauses.push("namespace = ?"); params.push(query.namespace); }
      if (query.keyPrefix !== undefined) {
        clauses.push("key >= ? AND key < ?");
        params.push(query.keyPrefix, `${query.keyPrefix}\uffff`);
      }
      for (const [column, value] of [["tenant_id", query.tenantId], ["account_id", query.accountId], ["user_id", query.userId]] as const) {
        if (value !== undefined) { clauses.push(`${column} = ?`); params.push(value); }
      }
      const categories = query.category === undefined ? [] : Array.isArray(query.category) ? query.category : [query.category];
      if (categories.length) { clauses.push(`category IN (${categories.map(() => "?").join(", ")})`); params.push(...categories); }
      const offset = decodeCursor(query.cursor);
      const limit = Math.min(Math.max(1, query.limit ?? 100), 500);
      const rows = database.prepare(`SELECT * FROM prism_checkpoints ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC, key ASC LIMIT ? OFFSET ?`).all(...params, limit + 1, offset) as Row[];
      const hasMore = rows.length > limit;
      return { items: rows.slice(0, limit).map((row) => rowToRecord(row)!), ...(hasMore ? { nextCursor: String(offset + limit) } : {}) };
    },

    async deleteCheckpoint(input) {
      throwIfAborted(input.signal);
      const record = rowToRecord(select.get(input.namespace, input.key) as Row | undefined);
      if (!record) return false;
      assertOwnership(input, record);
      return remove.run(input.namespace, input.key).changes > 0;
    },
  };
}

function rowToRecord(row?: Row): CheckpointRecord | null {
  if (!row) return null;
  return {
    namespace: row.namespace, key: row.key, version: row.version,
    ...(row.fencing_token === null ? {} : { fencingToken: row.fencing_token }),
    value: JSON.parse(row.value),
    ...(row.category === null ? {} : { category: row.category }),
    ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
    ...(row.account_id === null ? {} : { accountId: row.account_id }),
    ...(row.user_id === null ? {} : { userId: row.user_id }),
    createdAt: row.created_at, updatedAt: row.updated_at,
    ...(row.metadata === null ? {} : { metadata: JSON.parse(row.metadata) as Record<string, unknown> }),
  };
}

function assertInput(input: CheckpointKey & { version: number }): void {
  if (!input.namespace || !input.key || !Number.isSafeInteger(input.version) || input.version < 1) throw new CheckpointConflictError("Invalid checkpoint key or version");
}
function assertOwnership(expected: OwnershipScope, actual: OwnershipScope): void {
  if (expected.tenantId !== actual.tenantId || expected.accountId !== actual.accountId || expected.userId !== actual.userId) throw new CheckpointConflictError("Checkpoint ownership mismatch");
}
function stale(version: number, current?: number): CheckpointConflictError {
  return new CheckpointConflictError(`Stale checkpoint version ${version} (current ${current ?? "unknown"})`);
}
function staleExpected(expected: number, current: number): CheckpointConflictError {
  return new CheckpointConflictError(`Checkpoint compare-and-swap failed (expected ${expected}, current ${current})`);
}
function staleFence(fence: number | undefined, current: number): CheckpointConflictError {
  return new CheckpointConflictError(`Stale checkpoint fencing token ${fence ?? "missing"} (current ${current})`);
}
function encodeJson(value: unknown, label: string): string {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("not JSON serializable");
    return encoded;
  } catch (error) {
    throw new CheckpointConflictError(`${label} must be JSON serializable: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function decodeCursor(cursor?: string): number {
  const value = cursor === undefined ? 0 : Number(cursor);
  if (!Number.isSafeInteger(value) || value < 0) throw new CheckpointConflictError("Invalid checkpoint cursor");
  return value;
}
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}
