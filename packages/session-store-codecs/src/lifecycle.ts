import {
  DEFAULT_LIFECYCLE_PAGE_SIZE,
  HARD_LIFECYCLE_PAGE_SIZE,
  HARD_MAX_HOLD_REASON_BYTES,
  PersistenceLifecycleError,
  type TenantQuota,
} from "@arnilo/prism";

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
