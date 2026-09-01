import { PolicyError } from "./errors.js";
import type { PolicyLimits, ResolvedPolicyLimits } from "./types.js";

/** Phase 8 freeze: decision 8 KiB / 64 KiB; reason/evidence 1 KiB / 8 KiB; export page 100 / 500. */
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

export const HARD_POLICY_LIMITS: ResolvedPolicyLimits = {
  maxDecisionBytes: 64 * 1024,
  maxReasonBytes: 8 * 1024,
  maxEvidenceRefBytes: 8 * 1024,
  maxEvidenceRefs: 64,
  maxExportPageSize: 500,
  maxIdBytes: 512,
  maxPolicyIdBytes: 512,
  maxPolicyVersionBytes: 256,
  maxTargetBytes: 2 * 1024,
};

export function resolvePolicyLimits(input: PolicyLimits = {}): ResolvedPolicyLimits {
  const out = {} as Record<keyof ResolvedPolicyLimits, number>;
  for (const key of Object.keys(DEFAULT_POLICY_LIMITS) as (keyof ResolvedPolicyLimits)[]) {
    const value = input[key] ?? DEFAULT_POLICY_LIMITS[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > HARD_POLICY_LIMITS[key]) {
      throw new PolicyError(`${key} must be a positive safe integer ≤ ${HARD_POLICY_LIMITS[key]}`, "ERR_PRISM_POLICY_LIMITS");
    }
    out[key] = value;
  }
  return out as unknown as ResolvedPolicyLimits;
}
