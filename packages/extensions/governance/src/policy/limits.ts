import { PolicyError } from "./errors.js";
import type { PolicyLimits, ResolvedPolicyLimits } from "./types.js";

/** Defaults; `resolvePolicyLimits(input)` takes the host's values, which are the cap. */
export const DEFAULT_POLICY_LIMITS: ResolvedPolicyLimits = {
  maxDecisionBytes: 8 * 1024,
  maxReasonBytes: 1024,
  maxEvidenceRefBytes: 1024,
  maxEvidenceRefs: 16,
  maxExportPageSize: 100,
  maxIdBytes: 128,
  maxPolicyIdBytes: 128,
  maxPolicyVersionBytes: 64,
  maxTargetBytes: 256,
};

export function resolvePolicyLimits(input: PolicyLimits = {}): ResolvedPolicyLimits {
  const out = {} as Record<keyof ResolvedPolicyLimits, number>;
  for (const key of Object.keys(DEFAULT_POLICY_LIMITS) as (keyof ResolvedPolicyLimits)[]) {
    const value = input[key] ?? DEFAULT_POLICY_LIMITS[key];
    // Host-set: the host's value is the cap (plan 239 Task 5).
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new PolicyError(`${key} must be a positive safe integer`, "ERR_PRISM_POLICY_LIMITS");
    }
    out[key] = value;
  }
  return out as unknown as ResolvedPolicyLimits;
}
