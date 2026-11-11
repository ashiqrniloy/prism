import type { RunLimits } from "@arnilo/prism";
import type { DelegateChildLimits } from "./config.js";

/** Defaults a child gets when its config sets nothing: enough to finish a coding task, not a chat turn. */
export const DEFAULT_CHILD_LIMITS = { maxTurns: 50, maxToolCalls: 200, maxTotalTokens: 500_000, maxWallTimeMs: 15 * 60_000 } as const;
/** Ceilings a child config can never exceed. */
export const HARD_CHILD_LIMITS = { maxTurns: 200, maxToolCalls: 1000, maxTotalTokens: 2_000_000, maxWallTimeMs: 60 * 60_000 } as const;

/** The child's run limits: each requested value, clamped to the hard ceiling; the default otherwise. */
export function resolveChildLimits(requested: DelegateChildLimits = {}): RunLimits {
  const out: Record<string, number> = {};
  for (const key of Object.keys(DEFAULT_CHILD_LIMITS) as (keyof typeof DEFAULT_CHILD_LIMITS)[]) {
    out[key] = Math.min(requested[key] ?? DEFAULT_CHILD_LIMITS[key], HARD_CHILD_LIMITS[key]);
  }
  return out as RunLimits;
}

/** Default answer text the parent sees per delegation. */
export const DEFAULT_RESULT_MAX_CHARS = 12_000;
/** Ceiling for `resultMaxChars`; a larger value is clamped. */
export const HARD_MAX_RESULT_MAX_CHARS = 64_000;
/** What one delegation entry retains for `delegate_wait` paging. A child's own limits can produce far more. */
export const HARD_RETAINED_RESULT_CHARS = 256_000;

export function resolveResultMaxChars(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_RESULT_MAX_CHARS;
  return Math.min(requested, HARD_MAX_RESULT_MAX_CHARS);
}
