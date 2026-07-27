import type { OwnershipScope } from "./contracts.js";

/** Host-authenticated actor (user, service, or agent principal). */
export interface Principal {
  readonly kind: "user" | "service" | "agent" | string;
  readonly id: string;
  readonly displayName?: string;
}

/**
 * Host-verified identity context. Projects onto {@link OwnershipScope}.
 * `verified: true` marks host-verifier output; trust boundaries must obtain this
 * via {@link IdentityVerifier}, never by accepting caller-asserted claims alone.
 */
export interface AgentIdentity {
  readonly tenantId: string;
  readonly accountId?: string;
  readonly userId?: string;
  /** Acting principal for this run/tool/delegation. */
  readonly principal: Principal;
  /** Human sponsor accountable for the agent lifecycle (Entra-style). */
  readonly sponsor?: Principal;
  /** Resource owner when distinct from sponsor. */
  readonly owner?: Principal;
  /** Parent principal when this identity is a narrowed delegation. */
  readonly delegatedFrom?: Principal;
  readonly scopes: readonly string[];
  /** Late-bound credential resolver keys — never secret material. */
  readonly credentialRefs?: readonly string[];
  readonly issuedAt: string;
  readonly expiresAt?: string;
  readonly revokedAt?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly verified: true;
}

export interface IdentityVerifier {
  verify(input: unknown): AgentIdentity | Promise<AgentIdentity>;
}

export interface AssertIdentityActiveOptions {
  readonly now?: number;
  /** When set, identity.tenantId must equal this value. */
  readonly expectedTenantId?: string;
  readonly limits?: IdentityLimits;
}

export interface NarrowIdentityOptions {
  readonly scopes: readonly string[];
  readonly principal?: Principal;
  readonly credentialRefs?: readonly string[];
  readonly expiresAt?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly limits?: IdentityLimits;
}

export interface IdentityLimits {
  readonly maxScopes?: number;
  readonly maxScopeBytes?: number;
  readonly maxMetadataBytes?: number;
  readonly maxCredentialRefBytes?: number;
  readonly maxPrincipalIdBytes?: number;
}

export interface ResolvedIdentityLimits {
  readonly maxScopes: number;
  readonly maxScopeBytes: number;
  readonly maxMetadataBytes: number;
  readonly maxCredentialRefBytes: number;
  readonly maxPrincipalIdBytes: number;
}

export const DEFAULT_IDENTITY_LIMITS: ResolvedIdentityLimits = {
  maxScopes: 64,
  maxScopeBytes: 128,
  maxMetadataBytes: 4 * 1024,
  maxCredentialRefBytes: 256,
  maxPrincipalIdBytes: 256,
};

export const HARD_IDENTITY_LIMITS: ResolvedIdentityLimits = {
  maxScopes: 256,
  maxScopeBytes: 512,
  maxMetadataBytes: 16 * 1024,
  maxCredentialRefBytes: 2 * 1024,
  maxPrincipalIdBytes: 2 * 1024,
};

export class IdentityError extends Error {
  readonly code = "ERR_PRISM_IDENTITY";
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "IdentityError";
  }
}

export function resolveIdentityLimits(input: IdentityLimits = {}): ResolvedIdentityLimits {
  return {
    maxScopes: bound("maxScopes", input.maxScopes, DEFAULT_IDENTITY_LIMITS.maxScopes, HARD_IDENTITY_LIMITS.maxScopes),
    maxScopeBytes: bound("maxScopeBytes", input.maxScopeBytes, DEFAULT_IDENTITY_LIMITS.maxScopeBytes, HARD_IDENTITY_LIMITS.maxScopeBytes),
    maxMetadataBytes: bound(
      "maxMetadataBytes",
      input.maxMetadataBytes,
      DEFAULT_IDENTITY_LIMITS.maxMetadataBytes,
      HARD_IDENTITY_LIMITS.maxMetadataBytes,
    ),
    maxCredentialRefBytes: bound(
      "maxCredentialRefBytes",
      input.maxCredentialRefBytes,
      DEFAULT_IDENTITY_LIMITS.maxCredentialRefBytes,
      HARD_IDENTITY_LIMITS.maxCredentialRefBytes,
    ),
    maxPrincipalIdBytes: bound(
      "maxPrincipalIdBytes",
      input.maxPrincipalIdBytes,
      DEFAULT_IDENTITY_LIMITS.maxPrincipalIdBytes,
      HARD_IDENTITY_LIMITS.maxPrincipalIdBytes,
    ),
  };
}

/** Project verified identity onto ownership scope fields used by persistence/server. */
export function ownershipFromIdentity(identity: AgentIdentity): OwnershipScope {
  return {
    tenantId: identity.tenantId,
    ...(identity.accountId !== undefined ? { accountId: identity.accountId } : {}),
    ...(identity.userId !== undefined ? { userId: identity.userId } : {}),
  };
}

/**
 * Fail closed on shape/limits/expiry/revocation/tenant mismatch.
 * Sync and network-free — host {@link IdentityVerifier} owns remote checks.
 */
export function assertIdentityActive(identity: AgentIdentity, options: AssertIdentityActiveOptions = {}): void {
  const limits = resolveIdentityLimits(options.limits);
  assertIdentityShape(identity, limits);
  if (identity.verified !== true) throw new IdentityError("Identity is not host-verified", "unverified");
  if (options.expectedTenantId !== undefined && identity.tenantId !== options.expectedTenantId) {
    throw new IdentityError("Identity tenant mismatch", "wrong_tenant");
  }
  const now = options.now ?? Date.now();
  if (identity.revokedAt !== undefined) {
    const revokedAt = Date.parse(identity.revokedAt);
    if (!Number.isFinite(revokedAt)) throw new IdentityError("Identity revokedAt is invalid", "invalid_revoked_at");
    if (revokedAt <= now) throw new IdentityError("Identity has been revoked", "revoked");
  }
  if (identity.expiresAt !== undefined) {
    const expiresAt = Date.parse(identity.expiresAt);
    if (!Number.isFinite(expiresAt)) throw new IdentityError("Identity expiresAt is invalid", "invalid_expires_at");
    if (expiresAt <= now) throw new IdentityError("Identity has expired", "expired");
  }
  const issuedAt = Date.parse(identity.issuedAt);
  if (!Number.isFinite(issuedAt)) throw new IdentityError("Identity issuedAt is invalid", "invalid_issued_at");
  if (issuedAt > now + 60_000) throw new IdentityError("Identity issuedAt is in the future", "invalid_issued_at");
}

/** Delegation may only narrow scopes; tenant and ownership ids stay immutable. */
export function narrowIdentity(parent: AgentIdentity, options: NarrowIdentityOptions): AgentIdentity {
  assertIdentityActive(parent, { limits: options.limits });
  const limits = resolveIdentityLimits(options.limits);
  if (options.scopes.length === 0) throw new IdentityError("Delegated scopes must be non-empty", "empty_scopes");
  const parentScopes = new Set(parent.scopes);
  for (const scope of options.scopes) {
    if (!parentScopes.has(scope)) throw new IdentityError(`Delegation widens scope: ${scope}`, "scope_widen");
  }
  if (options.expiresAt !== undefined) {
    const childExp = Date.parse(options.expiresAt);
    if (!Number.isFinite(childExp)) throw new IdentityError("Delegated expiresAt is invalid", "invalid_expires_at");
    if (parent.expiresAt !== undefined) {
      const parentExp = Date.parse(parent.expiresAt);
      if (Number.isFinite(parentExp) && childExp > parentExp) {
        throw new IdentityError("Delegation cannot extend expiry", "expiry_widen");
      }
    }
  }
  const child: AgentIdentity = {
    tenantId: parent.tenantId,
    ...(parent.accountId !== undefined ? { accountId: parent.accountId } : {}),
    ...(parent.userId !== undefined ? { userId: parent.userId } : {}),
    principal: options.principal ?? parent.principal,
    ...(parent.sponsor !== undefined ? { sponsor: parent.sponsor } : {}),
    ...(parent.owner !== undefined ? { owner: parent.owner } : {}),
    delegatedFrom: parent.principal,
    scopes: Object.freeze([...options.scopes]),
    credentialRefs: Object.freeze([...(options.credentialRefs ?? parent.credentialRefs ?? [])]),
    issuedAt: parent.issuedAt,
    ...(options.expiresAt !== undefined
      ? { expiresAt: options.expiresAt }
      : parent.expiresAt !== undefined
        ? { expiresAt: parent.expiresAt }
        : {}),
    ...(parent.revokedAt !== undefined ? { revokedAt: parent.revokedAt } : {}),
    ...(options.metadata !== undefined
      ? { metadata: options.metadata }
      : parent.metadata !== undefined
        ? { metadata: parent.metadata }
        : {}),
    verified: true,
  };
  assertIdentityActive(child, { limits: options.limits });
  assertPrincipalBounds(child.principal, limits);
  return child;
}

/** Refuse ownership that widens or conflicts with a verified identity. */
export function assertIdentityMatchesOwnership(identity: AgentIdentity, ownership?: OwnershipScope): void {
  assertIdentityActive(identity);
  if (!ownership) return;
  if (ownership.tenantId !== undefined && ownership.tenantId !== identity.tenantId) {
    throw new IdentityError("Ownership tenant conflicts with identity", "ownership_tenant");
  }
  if (ownership.accountId !== undefined) {
    if (identity.accountId === undefined || ownership.accountId !== identity.accountId) {
      throw new IdentityError("Ownership account conflicts with identity", "ownership_account");
    }
  }
  if (ownership.userId !== undefined) {
    if (identity.userId === undefined || ownership.userId !== identity.userId) {
      throw new IdentityError("Ownership user conflicts with identity", "ownership_user");
    }
  }
}

/**
 * Propagation check: child must share tenant, not widen scopes, and remain active.
 * Used by supervisor/A2A/MCP/server when forwarding identity across a boundary.
 */
export function assertIdentityPropagation(parent: AgentIdentity, child: AgentIdentity, options: AssertIdentityActiveOptions = {}): void {
  assertIdentityActive(parent, options);
  assertIdentityActive(child, options);
  if (child.tenantId !== parent.tenantId) throw new IdentityError("Propagated identity changed tenant", "tenant_widen");
  if (parent.accountId !== undefined && child.accountId !== parent.accountId) {
    throw new IdentityError("Propagated identity changed account", "account_widen");
  }
  if (parent.userId !== undefined && child.userId !== parent.userId) {
    throw new IdentityError("Propagated identity changed user", "user_widen");
  }
  const parentScopes = new Set(parent.scopes);
  for (const scope of child.scopes) {
    if (!parentScopes.has(scope)) throw new IdentityError(`Propagated identity widens scope: ${scope}`, "scope_widen");
  }
}

/** Redacted identity refs safe for telemetry/ledger metadata (no secrets, no raw JWT). */
export function identityTelemetryAttributes(identity: AgentIdentity): Readonly<Record<string, string>> {
  assertIdentityActive(identity);
  return {
    "prism.identity.tenant_id": identity.tenantId,
    "prism.identity.principal_kind": String(identity.principal.kind),
    "prism.identity.principal_id": identity.principal.id,
    "prism.identity.scope_count": String(identity.scopes.length),
    ...(identity.accountId !== undefined ? { "prism.identity.account_id": identity.accountId } : {}),
    ...(identity.userId !== undefined ? { "prism.identity.user_id": identity.userId } : {}),
    ...(identity.sponsor !== undefined ? { "prism.identity.sponsor_id": identity.sponsor.id } : {}),
    ...(identity.credentialRefs?.length ? { "prism.identity.credential_ref_count": String(identity.credentialRefs.length) } : {}),
  };
}

/** Resolve run identity: explicit option wins; otherwise agent default. Assert when present. */
export function resolveRunIdentity(
  runIdentity: AgentIdentity | undefined,
  agentIdentity: AgentIdentity | undefined,
  ownership: OwnershipScope | undefined,
  options: AssertIdentityActiveOptions = {},
): AgentIdentity | undefined {
  const identity = runIdentity ?? agentIdentity;
  if (!identity) return undefined;
  assertIdentityActive(identity, options);
  assertIdentityMatchesOwnership(identity, ownership ?? ownershipFromIdentity(identity));
  return identity;
}

function assertIdentityShape(identity: AgentIdentity, limits: ResolvedIdentityLimits): void {
  if (typeof identity.tenantId !== "string" || identity.tenantId.length === 0) {
    throw new IdentityError("Identity tenantId is required", "missing_tenant");
  }
  if (byteLength(identity.tenantId) > limits.maxPrincipalIdBytes) {
    throw new IdentityError("Identity tenantId exceeds byte limit", "tenant_too_large");
  }
  assertPrincipalBounds(identity.principal, limits);
  if (identity.sponsor) assertPrincipalBounds(identity.sponsor, limits);
  if (identity.owner) assertPrincipalBounds(identity.owner, limits);
  if (identity.delegatedFrom) assertPrincipalBounds(identity.delegatedFrom, limits);
  if (!Array.isArray(identity.scopes) || identity.scopes.length === 0) {
    throw new IdentityError("Identity scopes must be a non-empty array", "empty_scopes");
  }
  if (identity.scopes.length > limits.maxScopes) {
    throw new IdentityError(`Identity exceeds maxScopes (${limits.maxScopes})`, "too_many_scopes");
  }
  for (const scope of identity.scopes) {
    if (typeof scope !== "string" || scope.length === 0) throw new IdentityError("Identity scope is invalid", "invalid_scope");
    if (byteLength(scope) > limits.maxScopeBytes) throw new IdentityError("Identity scope exceeds byte limit", "scope_too_large");
  }
  if (identity.credentialRefs) {
    for (const ref of identity.credentialRefs) {
      if (typeof ref !== "string" || ref.length === 0) throw new IdentityError("Credential ref is invalid", "invalid_credential_ref");
      if (byteLength(ref) > limits.maxCredentialRefBytes) {
        throw new IdentityError("Credential ref exceeds byte limit", "credential_ref_too_large");
      }
    }
  }
  if (identity.metadata !== undefined) {
    let encoded: string;
    try {
      encoded = JSON.stringify(identity.metadata);
    } catch {
      throw new IdentityError("Identity metadata is not JSON-serializable", "invalid_metadata");
    }
    if (byteLength(encoded) > limits.maxMetadataBytes) {
      throw new IdentityError("Identity metadata exceeds byte limit", "metadata_too_large");
    }
  }
  if (identity.accountId !== undefined && byteLength(identity.accountId) > limits.maxPrincipalIdBytes) {
    throw new IdentityError("Identity accountId exceeds byte limit", "account_too_large");
  }
  if (identity.userId !== undefined && byteLength(identity.userId) > limits.maxPrincipalIdBytes) {
    throw new IdentityError("Identity userId exceeds byte limit", "user_too_large");
  }
}

function assertPrincipalBounds(principal: Principal, limits: ResolvedIdentityLimits): void {
  if (typeof principal.id !== "string" || principal.id.length === 0) {
    throw new IdentityError("Principal id is required", "missing_principal");
  }
  if (byteLength(principal.id) > limits.maxPrincipalIdBytes) {
    throw new IdentityError("Principal id exceeds byte limit", "principal_too_large");
  }
  if (typeof principal.kind !== "string" || principal.kind.length === 0 || byteLength(principal.kind) > 64) {
    throw new IdentityError("Principal kind is invalid", "invalid_principal_kind");
  }
  if (principal.displayName !== undefined && byteLength(principal.displayName) > limits.maxPrincipalIdBytes) {
    throw new IdentityError("Principal displayName exceeds byte limit", "display_name_too_large");
  }
}

function bound(name: string, value: number | undefined, fallback: number, hard: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > hard) {
    throw new RangeError(`${name} must be a positive safe integer no greater than ${hard}`);
  }
  return resolved;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}
