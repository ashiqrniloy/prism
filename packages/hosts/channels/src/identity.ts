import type { OwnershipScope, Principal } from "@arnilo/prism";

export interface AgentIdentity {
  readonly tenantId: string;
  readonly accountId?: string;
  readonly userId?: string;
  readonly principal: Principal;
  readonly sponsor?: Principal;
  readonly owner?: Principal;
  readonly delegatedFrom?: Principal;
  readonly scopes: readonly string[];
  readonly credentialRefs?: readonly string[];
  readonly issuedAt: string;
  readonly expiresAt?: string;
  readonly revokedAt?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly verified: true;
}

export function ownershipFromIdentity(identity: AgentIdentity): OwnershipScope {
  return {
    tenantId: identity.tenantId,
    ...(identity.accountId !== undefined ? { accountId: identity.accountId } : {}),
    ...(identity.userId !== undefined ? { userId: identity.userId } : {}),
  };
}

export function assertIdentityActive(identity: AgentIdentity): void {
  if (identity.verified !== true) throw new Error("Identity is not host-verified");
  const now = Date.now();
  if (identity.revokedAt !== undefined) {
    const revokedAt = Date.parse(identity.revokedAt);
    if (!Number.isFinite(revokedAt) || revokedAt <= now) throw new Error("Identity has been revoked");
  }
  if (identity.expiresAt !== undefined) {
    const expiresAt = Date.parse(identity.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new Error("Identity has expired");
  }
}

export function assertIdentityMatchesOwnership(identity: AgentIdentity, ownership?: OwnershipScope): void {
  if (!ownership) return;
  if (identity.tenantId !== ownership.tenantId) throw new Error("Identity tenant mismatch");
  if (ownership.accountId !== undefined && identity.accountId !== ownership.accountId) throw new Error("Identity account mismatch");
  if (ownership.userId !== undefined && identity.userId !== ownership.userId) throw new Error("Identity user mismatch");
}
