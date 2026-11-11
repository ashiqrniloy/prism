import { ModelRouterError } from "./errors.js";
import type { ModelRouterLimits, ResolvedModelRouterLimits } from "./types.js";

/** Phase 8 freeze: attempts 3/8; circuit keys 1024/16384; diagnostics 8 KiB/64 KiB. Rate/budget keys 4096/65536 (window dimension inflates cardinality). */
export const DEFAULT_MODEL_ROUTER_LIMITS: ResolvedModelRouterLimits = {
  maxAttempts: 3,
  maxCircuitKeys: 1_024,
  maxDiagnosticsBytes: 8 * 1024,
  maxRateKeys: 4_096,
  maxBudgetKeys: 4_096,
};

export const HARD_MODEL_ROUTER_LIMITS: ResolvedModelRouterLimits = {
  maxAttempts: 8,
  maxCircuitKeys: 16_384,
  maxDiagnosticsBytes: 64 * 1024,
  maxRateKeys: 65_536,
  maxBudgetKeys: 65_536,
};

export const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 3;
export const DEFAULT_CIRCUIT_COOLDOWN_MS = 30_000;

export function resolveModelRouterLimits(input: ModelRouterLimits = {}): ResolvedModelRouterLimits {
  const out = {} as Record<keyof ResolvedModelRouterLimits, number>;
  for (const key of Object.keys(DEFAULT_MODEL_ROUTER_LIMITS) as (keyof ResolvedModelRouterLimits)[]) {
    const value = input[key] ?? DEFAULT_MODEL_ROUTER_LIMITS[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > HARD_MODEL_ROUTER_LIMITS[key]) {
      throw new ModelRouterError(
        `${key} must be a positive safe integer ≤ ${HARD_MODEL_ROUTER_LIMITS[key]}`,
        "ERR_PRISM_MODEL_ROUTER_LIMITS",
      );
    }
    out[key] = value;
  }
  return out as unknown as ResolvedModelRouterLimits;
}
