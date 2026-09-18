import type { OwnershipScope } from "@arnilo/prism";

/**
 * Cross-tenant trust boundary: the ownership-scope comparison. Shared so both
 * SQL adapters route every ownership decision through one tested helper — a
 * single place to audit the tenant/account/user filter. Each adapter decides
 * what a mismatch means: a foreign checkpoint load or delete is a miss (plan
 * 080 Task 3), a foreign checkpoint save is a generic CAS conflict, and lease /
 * lifecycle writes still fail closed with their store-specific error.
 */
export function ownershipScopeMatches(expected: OwnershipScope, actual: OwnershipScope): boolean {
  return expected.tenantId === actual.tenantId && expected.accountId === actual.accountId && expected.userId === actual.userId;
}

/** Throwing form of {@link ownershipScopeMatches} for stores that fail closed (leases, lifecycle holds). */
export function assertOwnershipScope(expected: OwnershipScope, actual: OwnershipScope, makeError: () => Error): void {
  if (!ownershipScopeMatches(expected, actual)) throw makeError();
}

/**
 * Asserts an ownership scope is present: at least one of tenant/account/user is a
 * non-empty string. Used by the lifecycle store's ownership-required guard; the
 * adapter supplies the error.
 */
export function assertOwnershipRequired(input: OwnershipScope, makeError: () => Error): void {
  if (![input.tenantId, input.accountId, input.userId].some((value) => typeof value === "string" && value.length > 0)) {
    throw makeError();
  }
}

/**
 * Normalizes an ownership scope to its defined fields (drops `undefined` keys so
 * the result carries only the set tenant/account/user).
 */
export function ownershipScope(input: OwnershipScope): OwnershipScope {
  return {
    ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
    ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
    ...(input.userId === undefined ? {} : { userId: input.userId }),
  };
}
