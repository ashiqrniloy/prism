import type { Pool } from "pg";
import {
  LeaseConflictError,
  type LeaseRecord,
  type LeaseStore,
  type OwnershipScope,
} from "@arnilo/prism";
import { qualifyTable } from "./identifiers.js";

interface Row {
  namespace: string; key: string; owner_id: string; token: string; fencing_token: string | number;
  tenant_id: string | null; account_id: string | null; user_id: string | null;
  acquired_at: string | Date; expires_at: string | Date; updated_at: string | Date;
}

export function createPostgresLeaseStore(pool: Pool, schema = "prism"): LeaseStore {
  const table = qualifyTable(schema, "prism_leases");
  let ready: Promise<void> | undefined;
  const ensureReady = () => ready ??= (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS ${table} (
      namespace TEXT NOT NULL, key TEXT NOT NULL, owner_id TEXT NOT NULL, token TEXT NOT NULL,
      fencing_token BIGINT NOT NULL, tenant_id TEXT, account_id TEXT, user_id TEXT,
      acquired_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (namespace, key)
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS prism_leases_expiry_idx ON ${table} (namespace, expires_at)`);
  })();
  const load = async (namespace: string, key: string, activeOnly = false): Promise<LeaseRecord | null> => {
    await ensureReady();
    const result = await pool.query(`SELECT * FROM ${table} WHERE namespace=$1 AND key=$2${activeOnly ? " AND expires_at > CURRENT_TIMESTAMP" : ""}`, [namespace, key]);
    return toRecord(result.rows[0] as Row | undefined);
  };

  return {
    async tryAcquireLease(input) {
      validate(input.namespace, input.key, input.ownerId, input.ttlMs, input.signal);
      await ensureReady();
      const result = await pool.query(`
INSERT INTO ${table} AS current_lease (namespace,key,owner_id,token,fencing_token,tenant_id,account_id,user_id,acquired_at,expires_at,updated_at)
VALUES ($1,$2,$3,$4,1,$5,$6,$7,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP + $8 * INTERVAL '1 millisecond',CURRENT_TIMESTAMP)
ON CONFLICT(namespace,key) DO UPDATE SET
  owner_id=EXCLUDED.owner_id, token=EXCLUDED.token, fencing_token=current_lease.fencing_token + 1,
  acquired_at=EXCLUDED.acquired_at, expires_at=EXCLUDED.expires_at, updated_at=EXCLUDED.updated_at
WHERE current_lease.expires_at <= CURRENT_TIMESTAMP
  AND current_lease.tenant_id IS NOT DISTINCT FROM EXCLUDED.tenant_id
  AND current_lease.account_id IS NOT DISTINCT FROM EXCLUDED.account_id
  AND current_lease.user_id IS NOT DISTINCT FROM EXCLUDED.user_id
RETURNING *`, [input.namespace, input.key, input.ownerId, crypto.randomUUID(), input.tenantId ?? null, input.accountId ?? null, input.userId ?? null, input.ttlMs]);
      if (result.rowCount) return toRecord(result.rows[0] as Row);
      const current = await load(input.namespace, input.key);
      if (current) assertOwnership(input, current);
      return null;
    },
    async renewLease(input) {
      validate(input.namespace, input.key, input.ownerId, input.ttlMs, input.signal, input.token);
      await ensureReady();
      const result = await pool.query(`UPDATE ${table} SET expires_at=CURRENT_TIMESTAMP + $5 * INTERVAL '1 millisecond', updated_at=CURRENT_TIMESTAMP
WHERE namespace=$1 AND key=$2 AND owner_id=$3 AND token=$4 AND expires_at > CURRENT_TIMESTAMP
  AND tenant_id IS NOT DISTINCT FROM $6 AND account_id IS NOT DISTINCT FROM $7 AND user_id IS NOT DISTINCT FROM $8
RETURNING *`, [input.namespace, input.key, input.ownerId, input.token, input.ttlMs, input.tenantId ?? null, input.accountId ?? null, input.userId ?? null]);
      if (result.rowCount) return toRecord(result.rows[0] as Row);
      const current = await load(input.namespace, input.key);
      if (current) assertOwnership(input, current);
      return null;
    },
    async releaseLease(input) {
      validate(input.namespace, input.key, input.ownerId, undefined, input.signal, input.token);
      await ensureReady();
      const result = await pool.query(`UPDATE ${table} SET expires_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
WHERE namespace=$1 AND key=$2 AND owner_id=$3 AND token=$4
  AND tenant_id IS NOT DISTINCT FROM $5 AND account_id IS NOT DISTINCT FROM $6 AND user_id IS NOT DISTINCT FROM $7`, [input.namespace, input.key, input.ownerId, input.token, input.tenantId ?? null, input.accountId ?? null, input.userId ?? null]);
      if (result.rowCount) return true;
      const current = await load(input.namespace, input.key);
      if (current) assertOwnership(input, current);
      return false;
    },
    async getLease(input) {
      if (input.signal?.aborted) throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
      const current = await load(input.namespace, input.key, true);
      if (current) assertOwnership(input, current);
      return current;
    },
  };
}

function toRecord(row?: Row): LeaseRecord | null {
  if (!row) return null;
  return {
    namespace: row.namespace, key: row.key, ownerId: row.owner_id, token: row.token,
    fencingToken: Number(row.fencing_token), acquiredAt: iso(row.acquired_at), expiresAt: iso(row.expires_at), updatedAt: iso(row.updated_at),
    ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
    ...(row.account_id === null ? {} : { accountId: row.account_id }),
    ...(row.user_id === null ? {} : { userId: row.user_id }),
  };
}
function iso(value: string | Date): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
function validate(namespace: string, key: string, ownerId: string, ttlMs?: number, signal?: AbortSignal, token?: string): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  if (!namespace || !key || !ownerId || (ttlMs !== undefined && (!Number.isSafeInteger(ttlMs) || ttlMs < 1)) || (token !== undefined && !token)) throw new LeaseConflictError("Invalid lease input");
}
function assertOwnership(expected: OwnershipScope, actual: OwnershipScope): void {
  if (expected.tenantId !== actual.tenantId || expected.accountId !== actual.accountId || expected.userId !== actual.userId) throw new LeaseConflictError("Lease ownership mismatch");
}
