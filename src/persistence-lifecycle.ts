import type { OwnershipScope, PersistencePage, PersistenceQuery, RetentionPolicy } from "./contracts.js";

/** Resource classes covered by holds, quotas, and retention sweeps. */
export type PersistenceResourceKind =
  | "session"
  | "entry"
  | "run"
  | "event"
  | "tool_call"
  | "usage"
  | "checkpoint"
  | "feedback"
  | "audit"
  | "work_artifact"
  | "connector_operation";

export const DEFAULT_LIFECYCLE_PAGE_SIZE = 100;
export const HARD_LIFECYCLE_PAGE_SIZE = 500;
export const DEFAULT_MAX_HOLD_REASON_BYTES = 1024;
export const HARD_MAX_HOLD_REASON_BYTES = 8 * 1024;

export class PersistenceLifecycleError extends Error {
  constructor(
    message: string,
    readonly code = "ERR_PRISM_PERSISTENCE_LIFECYCLE",
  ) {
    super(message);
    this.name = "PersistenceLifecycleError";
  }
}

export interface LegalHoldRecord extends OwnershipScope {
  readonly id: string;
  readonly resourceKind: PersistenceResourceKind;
  readonly resourceId: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly createdBy?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PutLegalHoldInput extends OwnershipScope {
  readonly resourceKind: PersistenceResourceKind;
  readonly resourceId: string;
  readonly reason: string;
  readonly id?: string;
  readonly createdBy?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface ReleaseLegalHoldInput extends OwnershipScope {
  readonly id: string;
  readonly signal?: AbortSignal;
}

export interface LegalHoldQuery extends PersistenceQuery, OwnershipScope {
  readonly resourceKind?: PersistenceResourceKind;
  readonly resourceId?: string;
  readonly holdId?: string;
  readonly signal?: AbortSignal;
}

export interface ApplyRetentionInput extends OwnershipScope {
  readonly policy: RetentionPolicy;
  /** When omitted, adapters discover expired/over-limit session ids for this ownership page. */
  readonly candidates?: readonly string[];
  readonly cursor?: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface ApplyRetentionResult {
  readonly deleted: readonly string[];
  readonly skippedHeld: readonly string[];
  readonly nextCursor?: string;
}

export interface LegalHoldExportItem {
  readonly holdId: string;
  readonly resourceKind: PersistenceResourceKind;
  readonly resourceId: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly redacted: true;
}

export interface ExportUnderHoldInput extends OwnershipScope {
  readonly holdId?: string;
  readonly resourceKind?: PersistenceResourceKind;
  readonly cursor?: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface TenantQuota extends OwnershipScope {
  readonly resourceKind: PersistenceResourceKind;
  readonly limit: number;
  readonly used: number;
  readonly updatedAt: string;
}

export interface SetTenantQuotaInput extends OwnershipScope {
  readonly resourceKind: PersistenceResourceKind;
  readonly limit: number;
  readonly signal?: AbortSignal;
}

export interface ConsumeTenantQuotaInput extends OwnershipScope {
  readonly resourceKind: PersistenceResourceKind;
  /** Units to consume. Default 1. */
  readonly delta?: number;
  readonly signal?: AbortSignal;
}

/** Optional persistence lifecycle capability (retention / hold / export / quota). */
export interface PersistenceLifecycleStore {
  putLegalHold(input: PutLegalHoldInput): Promise<LegalHoldRecord>;
  releaseLegalHold(input: ReleaseLegalHoldInput): Promise<boolean>;
  listLegalHolds(query: LegalHoldQuery): Promise<PersistencePage<LegalHoldRecord>>;
  /** Deletes candidates not under legal hold. Hold always wins over retention. */
  applyRetention(input: ApplyRetentionInput): Promise<ApplyRetentionResult>;
  exportUnderHold(input: ExportUnderHoldInput): Promise<PersistencePage<LegalHoldExportItem>>;
  setTenantQuota(input: SetTenantQuotaInput): Promise<TenantQuota>;
  getTenantQuota(
    input: OwnershipScope & { readonly resourceKind: PersistenceResourceKind; readonly signal?: AbortSignal },
  ): Promise<TenantQuota | null>;
  /** Fails closed when used + delta would exceed limit. */
  consumeTenantQuota(input: ConsumeTenantQuotaInput): Promise<TenantQuota>;
}

export function createMemoryPersistenceLifecycle(): PersistenceLifecycleStore {
  const holds = new Map<string, LegalHoldRecord>();
  const quotas = new Map<string, TenantQuota>();
  const deleted = new Set<string>();

  return {
    async putLegalHold(input) {
      throwIfAborted(input.signal);
      assertOwnership(input);
      const reason = assertReason(input.reason);
      if (!input.resourceId || !input.resourceKind) {
        throw new PersistenceLifecycleError("resourceKind and resourceId are required", "ERR_PRISM_LIFECYCLE_HOLD");
      }
      const id = input.id ?? crypto.randomUUID();
      const record: LegalHoldRecord = {
        id,
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
        reason,
        createdAt: new Date().toISOString(),
        ...(input.createdBy === undefined ? {} : { createdBy: input.createdBy }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        ...ownership(input),
      };
      holds.set(id, record);
      return record;
    },

    async releaseLegalHold(input) {
      throwIfAborted(input.signal);
      assertOwnership(input);
      const current = holds.get(input.id);
      if (!current) return false;
      assertSameOwnership(input, current);
      holds.delete(input.id);
      return true;
    },

    async listLegalHolds(query) {
      throwIfAborted(query.signal);
      assertOwnership(query);
      const limit = pageLimit(query.limit);
      const items = [...holds.values()]
        .filter((hold) => sameOwnership(query, hold))
        .filter((hold) => query.holdId === undefined || hold.id === query.holdId)
        .filter((hold) => query.resourceKind === undefined || hold.resourceKind === query.resourceKind)
        .filter((hold) => query.resourceId === undefined || hold.resourceId === query.resourceId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const start = query.cursor ? items.findIndex((item) => item.id === query.cursor) + 1 : 0;
      const slice = items.slice(Math.max(0, start), Math.max(0, start) + limit);
      const next = start + limit < items.length ? slice.at(-1)?.id : undefined;
      return { items: slice, ...(next === undefined ? {} : { nextCursor: next }) };
    },

    async applyRetention(input) {
      throwIfAborted(input.signal);
      assertOwnership(input);
      const held = new Set(
        [...holds.values()].filter((hold) => sameOwnership(input, hold) && hold.resourceKind === "session").map((hold) => hold.resourceId),
      );
      const candidates = input.candidates ?? [];
      const deletedIds: string[] = [];
      const skippedHeld: string[] = [];
      for (const id of candidates) {
        if (held.has(id)) {
          skippedHeld.push(id);
          continue;
        }
        deleted.add(id);
        deletedIds.push(id);
      }
      return { deleted: deletedIds, skippedHeld };
    },

    async exportUnderHold(input) {
      throwIfAborted(input.signal);
      assertOwnership(input);
      const page = await this.listLegalHolds({
        ...ownership(input),
        holdId: input.holdId,
        resourceKind: input.resourceKind,
        cursor: input.cursor,
        limit: input.limit,
        signal: input.signal,
      });
      return {
        items: page.items.map((hold) => ({
          holdId: hold.id,
          resourceKind: hold.resourceKind,
          resourceId: hold.resourceId,
          reason: hold.reason,
          createdAt: hold.createdAt,
          redacted: true as const,
        })),
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      };
    },

    async setTenantQuota(input) {
      throwIfAborted(input.signal);
      assertOwnership(input);
      if (!Number.isSafeInteger(input.limit) || input.limit < 0) {
        throw new PersistenceLifecycleError("limit must be a non-negative safe integer", "ERR_PRISM_LIFECYCLE_QUOTA");
      }
      const key = quotaKey(input, input.resourceKind);
      const previous = quotas.get(key);
      const record: TenantQuota = {
        ...ownership(input),
        resourceKind: input.resourceKind,
        limit: input.limit,
        used: previous?.used ?? 0,
        updatedAt: new Date().toISOString(),
      };
      if (record.used > record.limit) {
        throw new PersistenceLifecycleError("quota already exceeded", "ERR_PRISM_LIFECYCLE_QUOTA");
      }
      quotas.set(key, record);
      return record;
    },

    async getTenantQuota(input) {
      throwIfAborted(input.signal);
      assertOwnership(input);
      return quotas.get(quotaKey(input, input.resourceKind)) ?? null;
    },

    async consumeTenantQuota(input) {
      throwIfAborted(input.signal);
      assertOwnership(input);
      const delta = input.delta ?? 1;
      if (!Number.isSafeInteger(delta) || delta < 1) {
        throw new PersistenceLifecycleError("delta must be a positive safe integer", "ERR_PRISM_LIFECYCLE_QUOTA");
      }
      const key = quotaKey(input, input.resourceKind);
      const current = quotas.get(key);
      if (!current) {
        throw new PersistenceLifecycleError("tenant quota not configured", "ERR_PRISM_LIFECYCLE_QUOTA");
      }
      if (current.used + delta > current.limit) {
        throw new PersistenceLifecycleError(`tenant quota exhausted for ${input.resourceKind}`, "ERR_PRISM_LIFECYCLE_QUOTA_EXHAUSTED");
      }
      const next: TenantQuota = {
        ...current,
        used: current.used + delta,
        updatedAt: new Date().toISOString(),
      };
      quotas.set(key, next);
      return next;
    },
  };
}

/** True when a session/resource id is under an active legal hold in the page of holds. */
export function isResourceHeld(
  holds: readonly Pick<LegalHoldRecord, "resourceKind" | "resourceId">[],
  resourceKind: PersistenceResourceKind,
  resourceId: string,
): boolean {
  return holds.some((hold) => hold.resourceKind === resourceKind && hold.resourceId === resourceId);
}

function ownership(input: OwnershipScope): OwnershipScope {
  return {
    ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
    ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
    ...(input.userId === undefined ? {} : { userId: input.userId }),
  };
}

function sameOwnership(a: OwnershipScope, b: OwnershipScope): boolean {
  return a.tenantId === b.tenantId && a.accountId === b.accountId && a.userId === b.userId;
}

function assertSameOwnership(expected: OwnershipScope, actual: OwnershipScope): void {
  if (!sameOwnership(expected, actual)) {
    throw new PersistenceLifecycleError("ownership mismatch", "ERR_PRISM_LIFECYCLE_OWNERSHIP");
  }
}

function assertOwnership(input: OwnershipScope): void {
  if (![input.tenantId, input.accountId, input.userId].some((value) => typeof value === "string" && value.length > 0)) {
    throw new PersistenceLifecycleError("ownership required", "ERR_PRISM_LIFECYCLE_OWNERSHIP");
  }
}

function assertReason(reason: string): string {
  if (typeof reason !== "string" || !reason.trim()) {
    throw new PersistenceLifecycleError("reason is required", "ERR_PRISM_LIFECYCLE_HOLD");
  }
  if (Buffer.byteLength(reason, "utf8") > HARD_MAX_HOLD_REASON_BYTES) {
    throw new PersistenceLifecycleError("reason exceeds limit", "ERR_PRISM_LIFECYCLE_HOLD");
  }
  return reason;
}

function pageLimit(limit?: number): number {
  const resolved = limit ?? DEFAULT_LIFECYCLE_PAGE_SIZE;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > HARD_LIFECYCLE_PAGE_SIZE) {
    throw new PersistenceLifecycleError(`limit must be 1..${HARD_LIFECYCLE_PAGE_SIZE}`, "ERR_PRISM_LIFECYCLE_LIMITS");
  }
  return resolved;
}

function quotaKey(ownership: OwnershipScope, kind: PersistenceResourceKind): string {
  return `${ownership.tenantId ?? ""}\0${ownership.accountId ?? ""}\0${ownership.userId ?? ""}\0${kind}`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}
