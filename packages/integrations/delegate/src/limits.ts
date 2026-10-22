import type { RunLimits } from "@arnilo/prism";
import type { DelegateChildLimits } from "./config.js";

/** Defaults a child gets when its config sets nothing. `budgetShare` scales them. */
export const DEFAULT_CHILD_LIMITS = { maxTurns: 8, maxToolCalls: 32, maxTotalTokens: 20_000, maxWallTimeMs: 60_000 } as const;
/** Ceilings a child config can never exceed. */
export const HARD_CHILD_LIMITS = { maxTurns: 64, maxToolCalls: 256, maxTotalTokens: 1_000_000, maxWallTimeMs: 30 * 60_000 } as const;

/** The child's run limits: share of the defaults, then each requested value clamped to the hard ceiling. */
export function resolveChildLimits(requested: DelegateChildLimits = {}, budgetShare = 1): RunLimits {
  const out: Record<string, number> = {};
  for (const key of Object.keys(DEFAULT_CHILD_LIMITS) as (keyof typeof DEFAULT_CHILD_LIMITS)[]) {
    const scaled = Math.max(1, Math.floor(DEFAULT_CHILD_LIMITS[key] * budgetShare));
    out[key] = Math.min(requested[key] ?? scaled, HARD_CHILD_LIMITS[key]);
  }
  return out as RunLimits;
}
