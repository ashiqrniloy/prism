import { ModelRouterError } from "./errors.js";
import type { ModelRouterLimits, ResolvedModelRouterLimits } from "./types.js";

/** Defaults; `createModelRouter({ limits })` takes the host's values, which are the cap (plan 239 Task 5). */
export const DEFAULT_MODEL_ROUTER_LIMITS: ResolvedModelRouterLimits = {
  maxAttempts: 3,
  maxCircuitKeys: 1_024,
  maxDiagnosticsBytes: 8 * 1024,
  maxRateKeys: 4_096,
  maxBudgetKeys: 4_096,
};

export const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 3;
export const DEFAULT_CIRCUIT_COOLDOWN_MS = 30_000;

export function resolveModelRouterLimits(input: ModelRouterLimits = {}): ResolvedModelRouterLimits {
  const out = {} as Record<keyof ResolvedModelRouterLimits, number>;
  for (const key of Object.keys(DEFAULT_MODEL_ROUTER_LIMITS) as (keyof ResolvedModelRouterLimits)[]) {
    const value = input[key] ?? DEFAULT_MODEL_ROUTER_LIMITS[key];
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new ModelRouterError(`${key} must be a positive safe integer`, "ERR_PRISM_MODEL_ROUTER_LIMITS");
    }
    out[key] = value;
  }
  return out as unknown as ResolvedModelRouterLimits;
}
