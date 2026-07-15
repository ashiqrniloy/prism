import type { Pool } from "pg";
import {
  CheckpointConflictError,
  type CheckpointQuery,
  type CheckpointRecord,
  type CheckpointStore,
  type OwnershipScope,
} from "@arnilo/prism";
import { qualifyTable } from "./identifiers.js";

interface Row {
  namespace: string; key: string; version: number; fencing_token: number | null; category: string | null;
  tenant_id: string | null; account_id: string | null; user_id: string | null;
  value: unknown; metadata: unknown; created_at: string | Date; updated_at: string | Date;
}

export function createPostgresCheckpointStore(pool: Pool, schema = "prism"): CheckpointStore {
  const table = qualifyTable(schema, "prism_checkpoints");
  let ready: Promise<void> | undefined;
  const ensureReady = () => ready ??= (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS ${table} (
      namespace TEXT NOT NULL, key TEXT NOT NULL, version INTEGER NOT NULL,
      fencing_token BIGINT, category TEXT, tenant_id TEXT, account_id TEXT, user_id TEXT,
      value JSONB NOT NULL, metadata JSONB, created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (namespace, key)
    )`);
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS fencing_token BIGINT`);
    await pool.query(`CREATE INDEX IF NOT EXISTS prism_checkpoints_list_idx ON ${table} (namespace, category, tenant_id, updated_at DESC, key)`);
  })();

  async function load(namespace: string, key: string): Promise<CheckpointRecord | null> {
    await ensureReady();
    const result = await pool.query(`SELECT * FROM ${table} WHERE namespace = $1 AND key = $2`, [namespace, key]);
    return rowToRecord(result.rows[0] as Row | undefined);
  }

  return {
    async saveCheckpoint(input) {
      throwIfAborted(input.signal);
      if (!input.namespace || !input.key || !Number.isSafeInteger(input.version) || input.version < 1) throw new CheckpointConflictError("Invalid checkpoint key or version");
      const previous = await load(input.namespace, input.key);
      if (previous) assertOwnership(input, previous);
      if (input.expectedVersion !== undefined && input.expectedVersion !== (previous?.version ?? 0)) throw staleExpected(input.expectedVersion, previous?.version ?? 0);
      if (previous && input.version <= previous.version) throw stale(input.version, previous.version);
      if (previous?.fencingToken !== undefined && (input.fencingToken === undefined || input.fencingToken < previous.fencingToken)) throw staleFence(input.fencingToken, previous.fencingToken);
      const now = new Date().toISOString();
      const result = await pool.query(`
INSERT INTO ${table} AS current_checkpoint (namespace, key, version, fencing_token, category, tenant_id, account_id, user_id, value, metadata, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::timestamptz,$12::timestamptz)
ON CONFLICT(namespace, key) DO UPDATE SET
  version=EXCLUDED.version, fencing_token=EXCLUDED.fencing_token, category=EXCLUDED.category, tenant_id=EXCLUDED.tenant_id,
  account_id=EXCLUDED.account_id, user_id=EXCLUDED.user_id, value=EXCLUDED.value,
  metadata=EXCLUDED.metadata, updated_at=EXCLUDED.updated_at
WHERE current_checkpoint.version < EXCLUDED.version
  AND ($13::bigint IS NULL OR current_checkpoint.version = $13)
  AND (current_checkpoint.fencing_token IS NULL OR EXCLUDED.fencing_token >= current_checkpoint.fencing_token)
RETURNING *`, [
        input.namespace, input.key, input.version, input.fencingToken ?? null, input.category ?? null,
        input.tenantId ?? null, input.accountId ?? null, input.userId ?? null,
        encodeJson(input.value, "Checkpoint value"), input.metadata === undefined ? null : encodeJson(input.metadata, "Checkpoint metadata"),
        previous?.createdAt ?? now, now, input.expectedVersion ?? null,
      ]);
      if (result.rowCount === 0) throw stale(input.version, previous?.version);
      return rowToRecord(result.rows[0] as Row)!;
    },

    async loadCheckpoint(input) {
      throwIfAborted(input.signal);
      const record = await load(input.namespace, input.key);
      if (!record) return null;
      assertOwnership(input, record);
      return record;
    },

    async listCheckpoints(query: CheckpointQuery = {}) {
      throwIfAborted(query.signal);
      await ensureReady();
      const clauses: string[] = [];
      const params: unknown[] = [];
      const add = (sql: string, value: unknown) => { params.push(value); clauses.push(sql.replace("?", `$${params.length}`)); };
      if (query.namespace !== undefined) add("namespace = ?", query.namespace);
      if (query.keyPrefix !== undefined) {
        params.push(query.keyPrefix); const low = `$${params.length}`;
        params.push(`${query.keyPrefix}\uffff`); const high = `$${params.length}`;
        clauses.push(`key >= ${low} AND key < ${high}`);
      }
      if (query.tenantId !== undefined) add("tenant_id = ?", query.tenantId);
      if (query.accountId !== undefined) add("account_id = ?", query.accountId);
      if (query.userId !== undefined) add("user_id = ?", query.userId);
      const categories = query.category === undefined ? [] : Array.isArray(query.category) ? query.category : [query.category];
      if (categories.length) { params.push(categories); clauses.push(`category = ANY($${params.length}::text[])`); }
      const offset = decodeCursor(query.cursor);
      const limit = Math.min(Math.max(1, query.limit ?? 100), 500);
      params.push(limit + 1, offset);
      const result = await pool.query(`SELECT * FROM ${table} ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC, key ASC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
      const rows = result.rows as Row[];
      return { items: rows.slice(0, limit).map((row) => rowToRecord(row)!), ...(rows.length > limit ? { nextCursor: String(offset + limit) } : {}) };
    },

    async deleteCheckpoint(input) {
      throwIfAborted(input.signal);
      const record = await load(input.namespace, input.key);
      if (!record) return false;
      assertOwnership(input, record);
      const result = await pool.query(`DELETE FROM ${table} WHERE namespace = $1 AND key = $2`, [input.namespace, input.key]);
      return (result.rowCount ?? 0) > 0;
    },
  };
}

function rowToRecord(row?: Row): CheckpointRecord | null {
  if (!row) return null;
  return {
    namespace: row.namespace, key: row.key, version: Number(row.version),
    ...(row.fencing_token === null ? {} : { fencingToken: Number(row.fencing_token) }), value: row.value,
    ...(row.category === null ? {} : { category: row.category }),
    ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
    ...(row.account_id === null ? {} : { accountId: row.account_id }),
    ...(row.user_id === null ? {} : { userId: row.user_id }),
    createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
    ...(row.metadata == null ? {} : { metadata: row.metadata as Record<string, unknown> }),
  };
}
function toIso(value: string | Date): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
function assertOwnership(expected: OwnershipScope, actual: OwnershipScope): void {
  if (expected.tenantId !== actual.tenantId || expected.accountId !== actual.accountId || expected.userId !== actual.userId) throw new CheckpointConflictError("Checkpoint ownership mismatch");
}
function stale(version: number, current?: number): CheckpointConflictError { return new CheckpointConflictError(`Stale checkpoint version ${version} (current ${current ?? "unknown"})`); }
function staleExpected(expected: number, current: number): CheckpointConflictError { return new CheckpointConflictError(`Checkpoint compare-and-swap failed (expected ${expected}, current ${current})`); }
function staleFence(fence: number | undefined, current: number): CheckpointConflictError { return new CheckpointConflictError(`Stale checkpoint fencing token ${fence ?? "missing"} (current ${current})`); }
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
function throwIfAborted(signal?: AbortSignal): void { if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError"); }
