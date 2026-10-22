/**
 * `require` — the replacement for `createSecureAgent`'s build-time guarantees (plan 159 Task 7).
 *
 * `require: { principal, ownership }` fails a run closed when the session has no principal. The
 * kernel never synthesizes an identity (roadmap Phase 3), and a package cannot read `AgentConfig`
 * (`PackageAPI` exposes the package's own config, not the agent's), so this is enforced at the run
 * boundary rather than in `createAgent`: a `run.input` transform rejects and a `tool.call` decide
 * handler denies, both with {@link GOVERNANCE_REQUIREMENT_CODE}. `@arnilo/prism-governance`'s
 * readiness report (`assertHostCompositionReadiness`) covers the full ownership scope.
 */

export const GOVERNANCE_REQUIREMENT_CODE = "ERR_PRISM_GOVERNANCE_REQUIREMENT";

/** What the agent must carry before a run is allowed. Both default to off. */
export interface GovernanceRequireConfig {
  /** The session must have a host principal (`session.principal`). */
  readonly principal?: boolean;
  /** The session principal must be identified (a non-empty principal id). */
  readonly ownership?: boolean;
}

/** Thrown/returned when a configured requirement is unmet. Fail closed. */
export class GovernanceRequirementError extends Error {
  readonly code = GOVERNANCE_REQUIREMENT_CODE;
  constructor(message: string) {
    super(message);
    this.name = "GovernanceRequirementError";
  }
}

/** The reason the configured requirement is unmet, or `undefined` when it holds. */
export function unmetRequirement(
  require: GovernanceRequireConfig | undefined,
  session: { readonly principal?: { readonly id?: string } } | undefined,
): string | undefined {
  if (!require) return undefined;
  const principal = session?.principal;
  if (require.principal && !principal) {
    return `${GOVERNANCE_REQUIREMENT_CODE}: governance require.principal is set but the session has no principal`;
  }
  if (require.ownership && !principal?.id?.trim()) {
    return `${GOVERNANCE_REQUIREMENT_CODE}: governance require.ownership is set but the session has no identified principal`;
  }
  return undefined;
}
