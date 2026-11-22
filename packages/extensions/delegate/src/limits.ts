import type { RunLimits } from "@arnilo/prism";
import type { DelegateCeilings, DelegateChildLimits } from "./config.js";

/** Defaults a child gets when its config sets nothing: enough to finish a coding task, not a chat turn. */
export const DEFAULT_CHILD_LIMITS = { maxTurns: 50, maxToolCalls: 200, maxTotalTokens: 500_000, maxWallTimeMs: 15 * 60_000 } as const;
/**
 * Default ceilings a child config may not exceed (plan 239 Task 5). The host raises, lowers or disables (`null`) each
 * one in `config.ceilings`; a child value above its ceiling fails the load, it is never clamped.
 */
export const DEFAULT_CHILD_CEILINGS = { maxTurns: 200, maxToolCalls: 1000, maxTotalTokens: 2_000_000, maxWallTimeMs: 60 * 60_000 } as const;

/** Default answer text the parent sees per delegation. */
export const DEFAULT_RESULT_MAX_CHARS = 12_000;
/** Default ceiling for `resultMaxChars`; the host sets `ceilings.resultMaxChars`. */
export const DEFAULT_MAX_RESULT_MAX_CHARS = 64_000;
/** What one delegation entry retains for `delegate_wait` paging. A child's own limits can produce far more. */
export const DEFAULT_RETAINED_RESULT_CHARS = 256_000;

/** The child-limit axes with a delegate ceiling. */
export type DelegateCeilingAxis = keyof typeof DEFAULT_CHILD_CEILINGS;
const CEILING_AXES = Object.keys(DEFAULT_CHILD_CEILINGS) as DelegateCeilingAxis[];

export interface ResolvedDelegateCeilings {
  readonly maxTurns: number | null;
  readonly maxToolCalls: number | null;
  readonly maxTotalTokens: number | null;
  readonly maxWallTimeMs: number | null;
  readonly resultMaxChars: number;
  readonly retainedResultChars: number;
}

/** The host's `ceilings` over the defaults. The shape is schema-checked; this only fills defaults. */
export function resolveDelegateCeilings(ceilings: DelegateCeilings = {}): ResolvedDelegateCeilings {
  const resultMaxChars = ceilings.resultMaxChars ?? DEFAULT_MAX_RESULT_MAX_CHARS;
  return Object.freeze({
    maxTurns: ceilings.maxTurns === undefined ? DEFAULT_CHILD_CEILINGS.maxTurns : ceilings.maxTurns,
    maxToolCalls: ceilings.maxToolCalls === undefined ? DEFAULT_CHILD_CEILINGS.maxToolCalls : ceilings.maxToolCalls,
    maxTotalTokens: ceilings.maxTotalTokens === undefined ? DEFAULT_CHILD_CEILINGS.maxTotalTokens : ceilings.maxTotalTokens,
    maxWallTimeMs: ceilings.maxWallTimeMs === undefined ? DEFAULT_CHILD_CEILINGS.maxWallTimeMs : ceilings.maxWallTimeMs,
    resultMaxChars,
    retainedResultChars: ceilings.retainedResultChars ?? Math.max(DEFAULT_RETAINED_RESULT_CHARS, resultMaxChars),
  });
}

/** Thrown at load when a child config exceeds a delegate ceiling. Names the child and the axis, never a value. */
export class DelegateCeilingError extends Error {
  readonly code = "delegate_ceiling";
  constructor(child: string, axis: string) {
    super(`delegate child "${child}": ${axis} exceeds the delegate ceiling; raise config.ceilings.${axis} or lower the child's value`);
    this.name = "DelegateCeilingError";
  }
}

/**
 * Check a child's config against the ceilings at load (plan 239 Task 5: reject, never clamp). `null` (unbounded) on a
 * ceilinged axis is accepted only when that ceiling is `null` too.
 */
export function assertChildWithinCeilings(
  child: string,
  config: { readonly limits?: DelegateChildLimits; readonly resultMaxChars?: number },
  ceilings: ResolvedDelegateCeilings,
): void {
  for (const axis of CEILING_AXES) {
    const value = config.limits?.[axis];
    const ceiling = ceilings[axis];
    if (value === undefined || ceiling === null) continue;
    if (value === null || value > ceiling) throw new DelegateCeilingError(child, axis);
  }
  if (config.resultMaxChars !== undefined && config.resultMaxChars > ceilings.resultMaxChars) {
    throw new DelegateCeilingError(child, "resultMaxChars");
  }
}

/**
 * The child's run limits: every axis the child sets (already checked against the ceilings at load), and the default
 * for each ceilinged axis it leaves out, lowered to its ceiling when the host lowered one below the default.
 */
export function resolveChildLimits(
  requested: DelegateChildLimits = {},
  ceilings: ResolvedDelegateCeilings = resolveDelegateCeilings(),
): RunLimits {
  const out: Record<string, unknown> = { ...requested };
  for (const axis of CEILING_AXES) {
    if (requested[axis] !== undefined) continue;
    const ceiling = ceilings[axis];
    out[axis] = ceiling === null ? DEFAULT_CHILD_LIMITS[axis] : Math.min(DEFAULT_CHILD_LIMITS[axis], ceiling);
  }
  return out as RunLimits;
}

/** The answer text cap of one child: its value (checked at load), or the default lowered to the ceiling. */
export function resolveResultMaxChars(
  requested: number | undefined,
  ceilings: ResolvedDelegateCeilings = resolveDelegateCeilings(),
): number {
  return requested ?? Math.min(DEFAULT_RESULT_MAX_CHARS, ceilings.resultMaxChars);
}
