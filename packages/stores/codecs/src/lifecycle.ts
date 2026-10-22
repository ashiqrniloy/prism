import type { OwnershipScope, PersistencePage, PersistenceQuery, RetentionPolicy } from "@arnilo/prism";
import { assertOwnershipRequired } from "./ownership.js";

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
/**
 * @deprecated No replacement: nothing reads it since the 0.13 split. Kept for the deprecation
 * wave and removed at the next breaking cut (docs/_evidence/dead-export-verification-2026-09-03.md).
 */
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
  readonly delta?: number;
  readonly signal?: AbortSignal;
}

/** Optional persistence lifecycle capability (retention / hold / export / quota). */
export interface PersistenceLifecycleStore {
  putLegalHold(input: PutLegalHoldInput): Promise<LegalHoldRecord>;
  releaseLegalHold(input: ReleaseLegalHoldInput): Promise<boolean>;
  listLegalHolds(query: LegalHoldQuery): Promise<PersistencePage<LegalHoldRecord>>;
  applyRetention(input: ApplyRetentionInput): Promise<ApplyRetentionResult>;
  exportUnderHold(input: ExportUnderHoldInput): Promise<PersistencePage<LegalHoldExportItem>>;
  setTenantQuota(input: SetTenantQuotaInput): Promise<TenantQuota>;
  getTenantQuota(
    input: OwnershipScope & { readonly resourceKind: PersistenceResourceKind; readonly signal?: AbortSignal },
  ): Promise<TenantQuota | null>;
  consumeTenantQuota(input: ConsumeTenantQuotaInput): Promise<TenantQuota>;
}

export function assertLifecycleOwnership(input: OwnershipScope): void {
  assertOwnershipRequired(input, () => new PersistenceLifecycleError("ownership required", "ERR_PRISM_LIFECYCLE_OWNERSHIP"));
}

export function rowToTenantQuota(row: Record<string, unknown>): TenantQuota {
  return {
    resourceKind: row.resource_kind as TenantQuota["resourceKind"],
    limit: Number(row.limit_count),
    used: Number(row.used_count),
    updatedAt: String(row.updated_at),
    ...(row.tenant_id == null ? {} : { tenantId: String(row.tenant_id) }),
    ...(row.account_id == null ? {} : { accountId: String(row.account_id) }),
    ...(row.user_id == null ? {} : { userId: String(row.user_id) }),
  };
}

export function assertHoldReason(reason: string): string {
  if (typeof reason !== "string" || !reason.trim()) throw new PersistenceLifecycleError("reason is required", "ERR_PRISM_LIFECYCLE_HOLD");
  if (Buffer.byteLength(reason, "utf8") > HARD_MAX_HOLD_REASON_BYTES) {
    throw new PersistenceLifecycleError("reason exceeds limit", "ERR_PRISM_LIFECYCLE_HOLD");
  }
  return reason;
}

export function lifecyclePageLimit(limit?: number): number {
  const resolved = limit ?? DEFAULT_LIFECYCLE_PAGE_SIZE;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > HARD_LIFECYCLE_PAGE_SIZE) {
    throw new PersistenceLifecycleError(`limit must be 1..${HARD_LIFECYCLE_PAGE_SIZE}`, "ERR_PRISM_LIFECYCLE_LIMITS");
  }
  return resolved;
}
