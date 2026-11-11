/**
 * Identity verification and principal enforcement (plan 159 Task 8, roadmap §2.9).
 *
 * Governance never builds a verifier. The host installs one as a service and config names it
 * (`identity.verifier`); `run.input` verifies the session principal before each run and caches the
 * result in `state.agent` until `expiresAt`, and every `tool.call` re-checks expiry/revocation and the
 * scopes a matching rule requires. The kernel names only the opaque `principal`.
 *
 * Fail closed: a missing service fails `createAgent`, a verifier that rejects/throws fails the run, and
 * an identity that cannot be re-validated denies the call. Denial text carries the frozen
 * `IdentityError.reason` only — never the error message, which could echo a token.
 */
import type { HookContext, HookRejection, PackageAPI, Principal } from "@arnilo/prism";

import type { GovernanceCallContext } from "./hooks.js";
import { requiredScopes } from "./hooks.js";
import type { GovernanceConfig, GovernanceIdentityConfig } from "./config.js";
import { assertIdentityActive, type AgentIdentity, type IdentityVerifier } from "./identity/index.js";

/** Service name for `verifier: "service"`. */
export const DEFAULT_IDENTITY_SERVICE = "identity.verifier";
/** Service name for `verifier: "oidc"`, so a host can install an OIDC verifier beside a generic one. */
export const OIDC_IDENTITY_SERVICE = "identity.verifier.oidc";

export function identityServiceName(config: GovernanceIdentityConfig): string {
  return config.service ?? (config.verifier === "oidc" ? OIDC_IDENTITY_SERVICE : DEFAULT_IDENTITY_SERVICE);
}

/** What the host verifier receives: the opaque session principal plus session metadata (a bearer token lives in either). */
export interface IdentityVerificationInput {
  readonly principal?: Principal;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function identityVerificationInput(context: HookContext): IdentityVerificationInput {
  const session = context.session;
  return {
    ...(session?.principal !== undefined ? { principal: session.principal } : {}),
    ...(session?.metadata !== undefined ? { metadata: session.metadata } : {}),
  };
}

/** Bounded denial text. Uses the frozen reason code only; an arbitrary error message could echo a token. */
export function identityDenialReason(error: unknown): string {
  const reason = (error as { readonly reason?: unknown } | undefined)?.reason;
  return typeof reason === "string" && reason.length > 0 && reason.length <= 64 ? `identity ${reason}` : "identity verification failed";
}

/** The `governance.identity` service: the verified identity for a session, for the router and the audit actor. */
export interface GovernanceIdentityService {
  readonly get: (sessionId: string) => AgentIdentity | undefined;
}

export interface GovernanceIdentityRuntime {
  readonly service: GovernanceIdentityService;
  /** `run.input` handler: verify, or reuse a cached result that is still active. */
  readonly verify: (context: HookContext) => Promise<HookRejection | undefined>;
  /** `tool.call` gate: `undefined` allows, otherwise the deny reason. */
  readonly gate: (toolName: string, effects: readonly string[], context: HookContext) => string | undefined;
  /** The active verified identity for a session, when there is one. */
  readonly active: (sessionId: string, principalId?: string) => AgentIdentity | undefined;
}

interface CachedVerification {
  readonly identity: AgentIdentity;
  readonly principalId?: string;
}

/**
 * Cache key for a verification. `HookContext.sessionId` is empty for transform hooks whose payload is
 * not a record (`run.input` carries messages), so the bound session view is the reliable source.
 */
function sessionKey(context: HookContext): string {
  return context.session?.id ?? context.sessionId;
}

export function createGovernanceIdentity(
  prism: PackageAPI<GovernanceConfig>,
  // biome-ignore lint/correctness/noUnusedFunctionParameters: the name is part of the published declaration surface (scripts/compat-baseline/arnilo__prism-governance.txt).
  config: GovernanceIdentityConfig,
  verifier: IdentityVerifier,
  now: () => number = Date.now,
): GovernanceIdentityRuntime {
  const cache = prism.state.agent<Record<string, CachedVerification>>("verifiedIdentities", {});
  const rules = prism.config.rules ?? [];

  const active = (sessionId: string, principalId?: string): AgentIdentity | undefined => {
    const entry = cache.get()[sessionId];
    if (!entry) return undefined;
    if (entry.principalId !== principalId) return undefined;
    try {
      assertIdentityActive(entry.identity, { now: now() });
      return entry.identity;
    } catch {
      return undefined; // expired or revoked: the next run verifies again
    }
  };

  const callContext = (effects: readonly string[], context: HookContext): GovernanceCallContext => {
    const principal = context.session?.principal;
    return {
      effects,
      ...(principal?.kind !== undefined ? { principalKind: principal.kind } : {}),
      ...(principal?.id !== undefined ? { principalId: principal.id } : {}),
    };
  };

  return {
    active,
    service: {
      // The service has no context to compare a principal against, so it answers on expiry alone.
      get: (sessionId) => {
        const entry = cache.get()[sessionId];
        if (!entry) return undefined;
        try {
          assertIdentityActive(entry.identity, { now: now() });
          return entry.identity;
        } catch {
          return undefined;
        }
      },
    },
    async verify(context) {
      const sessionId = sessionKey(context);
      const principalId = context.session?.principal?.id;
      if (sessionId) {
        const cached = cache.get()[sessionId];
        // Reuse only an unexpired result for the same principal; without `expiresAt` the verifier runs
        // once per run (roadmap §2.9 performance note).
        if (cached && cached.principalId === principalId && cached.identity.expiresAt !== undefined) {
          if (active(sessionId, principalId)) return undefined;
        }
      }
      try {
        const identity = await verifier.verify(identityVerificationInput(context));
        assertIdentityActive(identity, { now: now() });
        if (sessionId) cache.set({ ...cache.get(), [sessionId]: { identity, ...(principalId !== undefined ? { principalId } : {}) } });
        return undefined;
      } catch (error) {
        return context.reject(identityDenialReason(error));
      }
    },
    gate(toolName, effects, context) {
      const entry = cache.get()[sessionKey(context)];
      if (!entry) return `${toolName} denied: identity was not verified for this run`;
      try {
        assertIdentityActive(entry.identity, { now: now() });
      } catch (error) {
        return `${toolName} denied: ${identityDenialReason(error)}`;
      }
      if (entry.principalId !== context.session?.principal?.id) {
        return `${toolName} denied: identity principal changed since verification`;
      }
      const missing = requiredScopes(rules, toolName, callContext(effects, context)).filter(
        (scope) => !entry.identity.scopes.includes(scope),
      );
      return missing.length > 0 ? `${toolName} denied: identity lacks scope ${missing[0]}` : undefined;
    },
  };
}
