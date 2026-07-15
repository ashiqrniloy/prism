import type Database from "better-sqlite3";
import {
  LeaseConflictError,
  type LeaseRecord,
  type LeaseStore,
  type OwnershipScope,
} from "@arnilo/prism";

interface Row {
  namespace: string; key: string; owner_id: string; token: string; fencing_token: number;
  tenant_id: string | null; account_id: string | null; user_id: string | null;
  acquired_at: string; expires_at: string; updated_at: string;
}

export function createSqliteLeaseStore(database: Database.Database): LeaseStore {
  database.exec(`
CREATE TABLE IF NOT EXISTS prism_leases (
  namespace TEXT NOT NULL, key TEXT NOT NULL, owner_id TEXT NOT NULL, token TEXT NOT NULL,
  fencing_token INTEGER NOT NULL, tenant_id TEXT, account_id TEXT, user_id TEXT,
  acquired_at TEXT NOT NULL, expires_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (namespace, key)
);
CREATE INDEX IF NOT EXISTS prism_leases_expiry_idx ON prism_leases (namespace, expires_at);
`);
  const select = database.prepare("SELECT * FROM prism_leases WHERE namespace = ? AND key = ?");
  const selectActive = database.prepare("SELECT * FROM prism_leases WHERE namespace = ? AND key = ? AND julianday(expires_at) > julianday('now')");
  const acquire = database.prepare(`
INSERT INTO prism_leases (
  namespace, key, owner_id, token, fencing_token, tenant_id, account_id, user_id,
  acquired_at, expires_at, updated_at
) VALUES (?, ?, ?, ?, 1, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now', ?), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(namespace, key) DO UPDATE SET
  owner_id=excluded.owner_id, token=excluded.token, fencing_token=prism_leases.fencing_token + 1,
  acquired_at=excluded.acquired_at, expires_at=excluded.expires_at, updated_at=excluded.updated_at
WHERE julianday(prism_leases.expires_at) <= julianday('now')
  AND prism_leases.tenant_id IS excluded.tenant_id
  AND prism_leases.account_id IS excluded.account_id
  AND prism_leases.user_id IS excluded.user_id
RETURNING *
`);
  const renew = database.prepare(`UPDATE prism_leases SET
    expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now', ?), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE namespace=? AND key=? AND owner_id=? AND token=?
      AND julianday(expires_at) > julianday('now')
      AND tenant_id IS ? AND account_id IS ? AND user_id IS ? RETURNING *`);
  const release = database.prepare(`UPDATE prism_leases SET
    expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE namespace=? AND key=? AND owner_id=? AND token=?
      AND tenant_id IS ? AND account_id IS ? AND user_id IS ?`);

  return {
    async tryAcquireLease(input) {
      validate(input.namespace, input.key, input.ownerId, input.ttlMs, input.signal);
      const row = acquire.get(
        input.namespace, input.key, input.ownerId, crypto.randomUUID(),
        input.tenantId ?? null, input.accountId ?? null, input.userId ?? null,
        `+${input.ttlMs / 1000} seconds`,
      ) as Row | undefined;
      if (row) return toRecord(row);
      const current = select.get(input.namespace, input.key) as Row | undefined;
      if (current) assertOwnership(input, toRecord(current));
      return null;
    },
    async renewLease(input) {
      validate(input.namespace, input.key, input.ownerId, input.ttlMs, input.signal, input.token);
      const row = renew.get(
        `+${input.ttlMs / 1000} seconds`, input.namespace, input.key, input.ownerId, input.token,
        input.tenantId ?? null, input.accountId ?? null, input.userId ?? null,
      ) as Row | undefined;
      if (row) return toRecord(row);
      const current = select.get(input.namespace, input.key) as Row | undefined;
      if (current) assertOwnership(input, toRecord(current));
      return null;
    },
    async releaseLease(input) {
      validate(input.namespace, input.key, input.ownerId, undefined, input.signal, input.token);
      const result = release.run(
        input.namespace, input.key, input.ownerId, input.token,
        input.tenantId ?? null, input.accountId ?? null, input.userId ?? null,
      );
      if (result.changes > 0) return true;
      const current = select.get(input.namespace, input.key) as Row | undefined;
      if (current) assertOwnership(input, toRecord(current));
      return false;
    },
    async getLease(input) {
      if (input.signal?.aborted) throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
      const row = selectActive.get(input.namespace, input.key) as Row | undefined;
      if (!row) return null;
      const record = toRecord(row);
      assertOwnership(input, record);
      return record;
    },
  };
}

function toRecord(row: Row): LeaseRecord {
  return {
    namespace: row.namespace, key: row.key, ownerId: row.owner_id, token: row.token,
    fencingToken: row.fencing_token, acquiredAt: row.acquired_at, expiresAt: row.expires_at,
    updatedAt: row.updated_at,
    ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
    ...(row.account_id === null ? {} : { accountId: row.account_id }),
    ...(row.user_id === null ? {} : { userId: row.user_id }),
  };
}
function validate(namespace: string, key: string, ownerId: string, ttlMs?: number, signal?: AbortSignal, token?: string): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  if (!namespace || !key || !ownerId || (ttlMs !== undefined && (!Number.isSafeInteger(ttlMs) || ttlMs < 1)) || (token !== undefined && !token)) throw new LeaseConflictError("Invalid lease input");
}
function assertOwnership(expected: OwnershipScope, actual: OwnershipScope): void {
  if (expected.tenantId !== actual.tenantId || expected.accountId !== actual.accountId || expected.userId !== actual.userId) throw new LeaseConflictError("Lease ownership mismatch");
}
