import type { LeaseAcquireInput, LeaseClaimInput, LeaseKey, LeaseRecord, LeaseStore, OwnershipScope } from "./contracts.js";

export const LEASE_CONFLICT_CODE = "ERR_PRISM_LEASE_CONFLICT";

export class LeaseConflictError extends Error {
  readonly code = LEASE_CONFLICT_CODE;
  constructor(message: string) {
    super(message);
    this.name = "LeaseConflictError";
  }
}

/** Drop expired rows once the map reaches this size. Live rows are never evicted. */
const EXPIRED_LEASE_SWEEP_AT = 1_024;
/** Test-only size probe. Not a LeaseStore field. */
const LEASE_RECORD_COUNT = Symbol.for("prism.lease.recordCount");

/** In-process reference implementation. Durable adapters provide cross-process exclusion. */
export function createMemoryLeaseStore(): LeaseStore {
  const records = new Map<string, LeaseRecord>();

  // ponytail: full scan only at EXPIRED_LEASE_SWEEP_AT, so a write is O(1) until then.
  // Live leases are unbounded. Upgrade: cap live rows if a host holds more than the threshold.
  function sweepExpired(now: number): void {
    if (records.size < EXPIRED_LEASE_SWEEP_AT) return;
    for (const [id, record] of records) {
      if (Date.parse(record.expiresAt) <= now) records.delete(id);
    }
  }

  const store: LeaseStore = {
    async tryAcquireLease(input) {
      validateAcquire(input);
      const id = keyOf(input);
      const current = records.get(id);
      if (current) assertOwnership(input, current);
      const now = Date.now();
      sweepExpired(now);
      const held = records.get(id);
      if (held && Date.parse(held.expiresAt) > now) return null;
      const timestamp = new Date(now).toISOString();
      const record: LeaseRecord = {
        namespace: input.namespace,
        key: input.key,
        ownerId: input.ownerId,
        token: crypto.randomUUID(),
        fencingToken: (held?.fencingToken ?? 0) + 1,
        acquiredAt: timestamp,
        expiresAt: new Date(now + input.ttlMs).toISOString(),
        updatedAt: timestamp,
        ...ownership(input),
      };
      records.set(id, record);
      return record;
    },

    async renewLease(input) {
      validateClaim(input, true);
      const current = records.get(keyOf(input));
      if (!current) {
        sweepExpired(Date.now());
        return null;
      }
      assertOwnership(input, current);
      const now = Date.now();
      if (current.ownerId !== input.ownerId || current.token !== input.token || Date.parse(current.expiresAt) <= now) {
        sweepExpired(now);
        return null;
      }
      const record = {
        ...current,
        expiresAt: new Date(now + input.ttlMs).toISOString(),
        updatedAt: new Date(now).toISOString(),
      };
      records.set(keyOf(input), record);
      sweepExpired(now);
      return record;
    },

    async releaseLease(input) {
      validateClaim(input, false);
      const current = records.get(keyOf(input));
      if (!current) {
        sweepExpired(Date.now());
        return false;
      }
      assertOwnership(input, current);
      if (current.ownerId !== input.ownerId || current.token !== input.token) return false;
      const now = new Date().toISOString();
      records.set(keyOf(input), { ...current, expiresAt: now, updatedAt: now });
      sweepExpired(Date.now());
      return true;
    },

    async getLease(input) {
      throwIfAborted(input.signal);
      const current = records.get(keyOf(input));
      if (!current) return null;
      assertOwnership(input, current);
      return Date.parse(current.expiresAt) > Date.now() ? current : null;
    },
  };
  Object.defineProperty(store, LEASE_RECORD_COUNT, { get: () => records.size });
  return store;
}

function keyOf(input: Pick<LeaseKey, "namespace" | "key">): string {
  return `${input.namespace}\0${input.key}`;
}
function ownership(input: OwnershipScope): OwnershipScope {
  return {
    ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
    ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
    ...(input.userId === undefined ? {} : { userId: input.userId }),
  };
}
function assertOwnership(expected: OwnershipScope, actual: OwnershipScope): void {
  if (expected.tenantId !== actual.tenantId || expected.accountId !== actual.accountId || expected.userId !== actual.userId) {
    throw new LeaseConflictError("Lease ownership mismatch");
  }
}
function validateKey(input: LeaseKey): void {
  throwIfAborted(input.signal);
  if (!input.namespace || !input.key) throw new LeaseConflictError("Lease namespace and key are required");
}
function validateAcquire(input: LeaseAcquireInput): void {
  validateKey(input);
  if (!input.ownerId || !Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1)
    throw new LeaseConflictError("Lease ownerId and positive ttlMs are required");
}
function validateClaim(input: LeaseClaimInput, requireTtl: boolean): void {
  validateKey(input);
  if (!input.ownerId || !input.token || (requireTtl && (!Number.isSafeInteger(input.ttlMs) || input.ttlMs! < 1))) {
    throw new LeaseConflictError("Lease ownerId, token, and positive ttlMs are required");
  }
}
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}
