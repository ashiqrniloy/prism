import { assertIdentityActive, ownershipFromIdentity } from "@arnilo/prism";
import { PolicyError } from "./errors.js";
import { preparePolicyDecision, type PreparePolicyDecisionOptions } from "./prepare.js";
import type {
  AppendPolicyDecisionInput,
  PolicyDecisionRecord,
  PolicyDecisionStore,
  PolicyEvaluateRequest,
  PolicyEvaluateResult,
  PolicyEvaluator,
} from "./types.js";

export interface CreatePolicyEvaluatorOptions {
  readonly policyId: string;
  readonly policyVersion: string;
  readonly evaluate: (request: PolicyEvaluateRequest) => PolicyEvaluateResult | Promise<PolicyEvaluateResult>;
}

/** Host-supplied evaluator stamped with immutable policy id/version. */
export function createPolicyEvaluator(options: CreatePolicyEvaluatorOptions): PolicyEvaluator {
  if (!options.policyId?.trim() || !options.policyVersion?.trim()) {
    throw new PolicyError("policyId and policyVersion required", "ERR_PRISM_POLICY_VALIDATION");
  }
  return {
    policyId: options.policyId,
    policyVersion: options.policyVersion,
    async evaluate(request) {
      request.signal?.throwIfAborted();
      assertIdentityActive(request.identity);
      if (!request.action?.trim()) throw new PolicyError("action required", "ERR_PRISM_POLICY_VALIDATION");
      if (!request.resource?.kind?.trim() || !request.resource?.id?.trim()) {
        throw new PolicyError("resource.kind and resource.id required", "ERR_PRISM_POLICY_VALIDATION");
      }
      const result = await options.evaluate(request);
      request.signal?.throwIfAborted();
      if (!result || !["allow", "deny", "modify", "approval"].includes(result.outcome)) {
        throw new PolicyError("evaluator must return allow|deny|modify|approval", "ERR_PRISM_POLICY_VALIDATION");
      }
      return result;
    },
  };
}

export interface EvaluateAndAppendOptions extends PreparePolicyDecisionOptions {
  readonly store: PolicyDecisionStore;
  readonly evaluator: PolicyEvaluator;
  readonly id: string;
}

/** Evaluate then append a redacted decision (common enterprise host path). */
export async function evaluateAndAppend(
  request: PolicyEvaluateRequest,
  options: EvaluateAndAppendOptions,
): Promise<PolicyDecisionRecord> {
  const result = await options.evaluator.evaluate(request);
  const ownership = ownershipFromIdentity(request.identity);
  const input: AppendPolicyDecisionInput = {
    id: options.id,
    policyId: options.evaluator.policyId,
    policyVersion: options.evaluator.policyVersion,
    outcome: result.outcome,
    identity: request.identity,
    target: request.resource,
    reason: result.reason,
    evidenceRefs: result.evidenceRefs,
    expiresAt: result.expiresAt,
    signal: request.signal,
    ...ownership,
  };
  return options.store.append(input);
}
