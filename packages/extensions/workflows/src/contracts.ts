/**
 * The `checkpoints` and `leases` service contracts (roadmap §2.12.13, plan 168 Task 3).
 *
 * Moved from `@arnilo/prism`'s `src/contracts-core/persistence.ts`; the kernel copy stays until
 * plan 168 Task 5 deletes it. A store package provides the implementations (Task 4).
 */

/** Ownership scope identifiers. Hosts may use these for multi-tenant isolation. */
export interface OwnershipScope {
  readonly tenantId?: string;
  readonly accountId?: string;
  readonly userId?: string;
}

/** Cursor-paginated result page. */
export interface PersistencePage<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
  readonly total?: number;
}

/** Common query controls for cursor-based pagination. */
export interface PersistenceQuery {
  readonly cursor?: string;
  readonly limit?: number;
  readonly order?: "asc" | "desc";
}

/** Generic versioned checkpoint key. Namespaces prevent consumer collisions. */
export interface CheckpointKey extends OwnershipScope {
  readonly namespace: string;
  readonly key: string;
  readonly signal?: AbortSignal;
}

/** Input for an optimistic checkpoint write. Versions must strictly increase. */
export interface CheckpointSaveInput extends CheckpointKey {
  readonly version: number;
  /** Exact current version required before update; use 0 for create-only. */
  readonly expectedVersion?: number;
  /** Monotonic lease fence. Lower or absent worker fences cannot replace a fenced record. */
  readonly fencingToken?: number;
  readonly value: unknown;
  readonly category?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Durable generic checkpoint record. */
export interface CheckpointRecord extends OwnershipScope {
  readonly namespace: string;
  readonly key: string;
  readonly version: number;
  readonly fencingToken?: number;
  readonly value: unknown;
  readonly category?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Bounded checkpoint query. */
export interface CheckpointQuery extends PersistenceQuery, OwnershipScope {
  readonly namespace?: string;
  readonly keyPrefix?: string;
  readonly category?: string | readonly string[];
  readonly signal?: AbortSignal;
}

/** Generic versioned checkpoint capability for persistence adapters. */
export interface CheckpointStore {
  saveCheckpoint(input: CheckpointSaveInput): Promise<CheckpointRecord>;
  loadCheckpoint(input: CheckpointKey): Promise<CheckpointRecord | null>;
  listCheckpoints(query?: CheckpointQuery): Promise<PersistencePage<CheckpointRecord>>;
  deleteCheckpoint(input: CheckpointKey): Promise<boolean>;
}

/** Generic lease key. Ownership fields are part of the trust boundary. */
export interface LeaseKey extends OwnershipScope {
  readonly namespace: string;
  readonly key: string;
  readonly signal?: AbortSignal;
}

export interface LeaseAcquireInput extends LeaseKey {
  readonly ownerId: string;
  readonly ttlMs: number;
}

export interface LeaseClaimInput extends LeaseKey {
  readonly ownerId: string;
  readonly token: string;
  readonly ttlMs?: number;
}

export interface LeaseRecord extends OwnershipScope {
  readonly namespace: string;
  readonly key: string;
  readonly ownerId: string;
  readonly token: string;
  readonly fencingToken: number;
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly updatedAt: string;
}

/** Atomic distributed lease capability. Expired rows retain fencing counters. */
export interface LeaseStore {
  tryAcquireLease(input: LeaseAcquireInput): Promise<LeaseRecord | null>;
  renewLease(input: LeaseClaimInput & { readonly ttlMs: number }): Promise<LeaseRecord | null>;
  releaseLease(input: LeaseClaimInput): Promise<boolean>;
  getLease(input: LeaseKey): Promise<LeaseRecord | null>;
}
