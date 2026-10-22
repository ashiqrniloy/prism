import type { Principal } from "@arnilo/prism";

/**
 * Structural stand-in for a host-verified identity.
 * ponytail: active check only — shape and byte limits stay in `@arnilo/prism-governance`.
 * This package must not depend on it (plan 159 Task 1 (g)).
 */
export interface AgentIdentity {
  readonly tenantId: string;
  readonly accountId?: string;
  readonly userId?: string;
  readonly principal: Principal;
  readonly scopes: readonly string[];
  readonly issuedAt: string;
  readonly expiresAt?: string;
  readonly revokedAt?: string;
  readonly verified: true;
}

export function assertIdentityActive(identity: AgentIdentity, now = Date.now()): void {
  if (identity.verified !== true || identity.tenantId.length === 0 || identity.scopes.length === 0) {
    throw new Error("Identity is not host-verified");
  }
  if (identity.revokedAt !== undefined) {
    const revokedAt = Date.parse(identity.revokedAt);
    if (!Number.isFinite(revokedAt) || revokedAt <= now) throw new Error("Identity has been revoked");
  }
  if (identity.expiresAt !== undefined) {
    const expiresAt = Date.parse(identity.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new Error("Identity has expired");
  }
  const issuedAt = Date.parse(identity.issuedAt);
  if (!Number.isFinite(issuedAt) || issuedAt > now + 60_000) throw new Error("Identity issuedAt is invalid");
}
