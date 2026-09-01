import {
  type AgentIdentity,
  type GuardrailRecord,
  ownershipFromIdentity,
  type PermissionDecision,
  type PermissionRequest,
} from "@arnilo/prism";
import { PolicyError } from "./errors.js";
import type {
  AppendPolicyDecisionInput,
  PolicyDecisionOutcome,
  PolicyDecisionRecord,
  PolicyDecisionStore,
  PolicyEvaluator,
} from "./types.js";

function mapGuardrailAction(action: string): PolicyDecisionOutcome {
  if (action === "allow") return "allow";
  if (action === "block" || action === "tripwire") return "deny";
  if (action === "interrupt") return "approval";
  throw new PolicyError(`unsupported guardrail action: ${action}`, "ERR_PRISM_POLICY_VALIDATION");
}

/** Record a core GuardrailRecord into the policy ledger (evidence ref only). */
export async function recordGuardrailDecision(input: {
  readonly store: PolicyDecisionStore;
  readonly evaluator: Pick<PolicyEvaluator, "policyId" | "policyVersion">;
  readonly id: string;
  readonly identity: AgentIdentity;
  readonly record: GuardrailRecord;
  readonly evidenceRef?: string;
}): Promise<PolicyDecisionRecord> {
  const ownership = ownershipFromIdentity(input.identity);
  const append: AppendPolicyDecisionInput = {
    id: input.id,
    policyId: input.evaluator.policyId,
    policyVersion: input.evaluator.policyVersion,
    outcome: mapGuardrailAction(input.record.action),
    identity: input.identity,
    target: { kind: `guardrail:${input.record.stage}`, id: input.record.guardrail },
    reason: input.record.reason,
    evidenceRefs: input.evidenceRef ? [input.evidenceRef] : [`guardrail:${input.record.guardrail}:${input.record.stage}`],
    ...ownership,
  };
  return input.store.append(append);
}

/** Record a PermissionDecision into the policy ledger. */
export async function recordPermissionDecision(input: {
  readonly store: PolicyDecisionStore;
  readonly evaluator: Pick<PolicyEvaluator, "policyId" | "policyVersion">;
  readonly id: string;
  readonly identity: AgentIdentity;
  readonly request: PermissionRequest;
  readonly decision: PermissionDecision;
  readonly evidenceRef?: string;
}): Promise<PolicyDecisionRecord> {
  const ownership = ownershipFromIdentity(input.identity);
  const append: AppendPolicyDecisionInput = {
    id: input.id,
    policyId: input.evaluator.policyId,
    policyVersion: input.evaluator.policyVersion,
    outcome: input.decision.allowed ? "allow" : "deny",
    identity: input.identity,
    target: { kind: `permission:${input.request.kind}`, id: `${input.request.target}:${input.request.action}` },
    reason: input.decision.reason,
    evidenceRefs: input.evidenceRef ? [input.evidenceRef] : [`permission:${input.request.kind}:${input.request.target}`],
    ...ownership,
  };
  return input.store.append(append);
}

/** Record a tool_approval interruption as an attributable approval decision. */
export async function recordToolApprovalDecision(input: {
  readonly store: PolicyDecisionStore;
  readonly evaluator: Pick<PolicyEvaluator, "policyId" | "policyVersion">;
  readonly id: string;
  readonly identity: AgentIdentity;
  readonly toolName: string;
  readonly toolCallId: string;
  readonly reason?: string;
  readonly evidenceRef?: string;
}): Promise<PolicyDecisionRecord> {
  if (!input.identity) throw new PolicyError("verified identity required for approvals", "ERR_PRISM_POLICY_IDENTITY");
  const ownership = ownershipFromIdentity(input.identity);
  const append: AppendPolicyDecisionInput = {
    id: input.id,
    policyId: input.evaluator.policyId,
    policyVersion: input.evaluator.policyVersion,
    outcome: "approval",
    identity: input.identity,
    target: { kind: "tool_approval", id: input.toolName },
    reason: input.reason ?? "Tool side effect requires approval",
    evidenceRefs: input.evidenceRef ? [input.evidenceRef] : [`tool_call:${input.toolCallId}`],
    ...ownership,
  };
  return input.store.append(append);
}
