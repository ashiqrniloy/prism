import { CheckpointConflictError, type CheckpointQuery, type CheckpointRecord, type CheckpointStore } from "@arnilo/prism";
import type Database from "better-sqlite3";
import {
  assertCheckpointInput,
  assertOwnershipScope,
  decodeCheckpointCursor,
  encodeCheckpointJson,
  staleCheckpoint,
  staleCheckpointExpected,
  staleCheckpointFence,
  throwIfAborted,
} from "../codecs/index.js";

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
  if (!columns.some((column) => column.name === "fencing_token"))
    database.exec("ALTER TABLE prism_checkpoints ADD COLUMN fencing_token INTEGER");
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
      assertCheckpointInput(input);
      const previous = rowToRecord(select.get(input.namespace, input.key) as Row | undefined);
      if (previous) assertOwnershipScope(input, previous, () => new CheckpointConflictError("Checkpoint ownership mismatch"));
      if (input.expectedVersion !== undefined && input.expectedVersion !== (previous?.version ?? 0))
        throw staleCheckpointExpected(input.expectedVersion, previous?.version ?? 0);
      if (previous && input.version <= previous.version) throw staleCheckpoint(input.version, previous.version);
      if (previous?.fencingToken !== undefined && (input.fencingToken === undefined || input.fencingToken < previous.fencingToken))
        throw staleCheckpointFence(input.fencingToken, previous.fencingToken);
      const now = new Date().toISOString();
      const result = upsert.run(
        input.namespace,
        input.key,
        input.version,
        input.fencingToken ?? null,
        input.category ?? null,
        input.tenantId ?? null,
        input.accountId ?? null,
        input.userId ?? null,
        encodeCheckpointJson(input.value, "Checkpoint value"),
        input.metadata === undefined ? null : encodeCheckpointJson(input.metadata, "Checkpoint metadata"),
        previous?.createdAt ?? now,
        now,
        input.expectedVersion ?? null,
        input.expectedVersion ?? null,
      );
      if (result.changes === 0) throw staleCheckpoint(input.version, previous?.version);
      return rowToRecord(select.get(input.namespace, input.key) as Row)!;
    },

    async loadCheckpoint(input) {
      throwIfAborted(input.signal);
      const record = rowToRecord(select.get(input.namespace, input.key) as Row | undefined);
      if (!record) return null;
      assertOwnershipScope(input, record, () => new CheckpointConflictError("Checkpoint ownership mismatch"));
      return record;
    },

    async listCheckpoints(query: CheckpointQuery = {}) {
      throwIfAborted(query.signal);
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (query.namespace !== undefined) {
        clauses.push("namespace = ?");
        params.push(query.namespace);
      }
      if (query.keyPrefix !== undefined) {
        clauses.push("key >= ? AND key < ?");
        params.push(query.keyPrefix, `${query.keyPrefix}\uffff`);
      }
      for (const [column, value] of [
        ["tenant_id", query.tenantId],
        ["account_id", query.accountId],
        ["user_id", query.userId],
      ] as const) {
        if (value !== undefined) {
          clauses.push(`${column} = ?`);
          params.push(value);
        }
      }
      const categories = query.category === undefined ? [] : Array.isArray(query.category) ? query.category : [query.category];
      if (categories.length) {
        clauses.push(`category IN (${categories.map(() => "?").join(", ")})`);
        params.push(...categories);
      }
      const offset = decodeCheckpointCursor(query.cursor);
      const limit = Math.min(Math.max(1, query.limit ?? 100), 500);
      const rows = database
        .prepare(
          `SELECT * FROM prism_checkpoints ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC, key ASC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit + 1, offset) as Row[];
      const hasMore = rows.length > limit;
      return { items: rows.slice(0, limit).map((row) => rowToRecord(row)!), ...(hasMore ? { nextCursor: String(offset + limit) } : {}) };
    },

    async deleteCheckpoint(input) {
      throwIfAborted(input.signal);
      const record = rowToRecord(select.get(input.namespace, input.key) as Row | undefined);
      if (!record) return false;
      assertOwnershipScope(input, record, () => new CheckpointConflictError("Checkpoint ownership mismatch"));
      return remove.run(input.namespace, input.key).changes > 0;
    },
  };
}

function rowToRecord(row?: Row): CheckpointRecord | null {
  if (!row) return null;
  return {
    namespace: row.namespace,
    key: row.key,
    version: row.version,
    ...(row.fencing_token === null ? {} : { fencingToken: row.fencing_token }),
    value: JSON.parse(row.value),
    ...(row.category === null ? {} : { category: row.category }),
    ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
    ...(row.account_id === null ? {} : { accountId: row.account_id }),
    ...(row.user_id === null ? {} : { userId: row.user_id }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.metadata === null ? {} : { metadata: JSON.parse(row.metadata) as Record<string, unknown> }),
  };
}
