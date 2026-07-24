import type { AgentIdentity, OwnershipScope, PersistencePage } from "@arnilo/prism";

/** allow / deny / modify / approval — maps onto guardrail/permission/tool-approval outcomes. */
export type PolicyDecisionOutcome = "allow" | "deny" | "modify" | "approval";

export interface PolicyTarget {
  readonly kind: string;
  readonly id: string;
}

/** Redacted actor refs projected from verified identity — never JWTs or secrets. */
export interface PolicyActorRef {
  readonly tenantId: string;
  readonly accountId?: string;
  readonly userId?: string;
  readonly principalId: string;
  readonly principalKind: string;
  readonly sponsorId?: string;
}

export interface PolicyDecisionRecord extends OwnershipScope {
  readonly id: string;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly outcome: PolicyDecisionOutcome;
  readonly actor: PolicyActorRef;
  readonly target: PolicyTarget;
  readonly reason?: string;
  readonly evidenceRefs: readonly string[];
  readonly createdAt: string;
  readonly expiresAt?: string;
}

export interface PolicyEvaluateRequest {
  readonly identity: AgentIdentity;
  readonly action: string;
  readonly resource: PolicyTarget;
  /** Evaluator-only; never persisted on the ledger. */
  readonly context?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface PolicyEvaluateResult {
  readonly outcome: PolicyDecisionOutcome;
  readonly reason?: string;
  readonly evidenceRefs?: readonly string[];
  readonly expiresAt?: string;
}

export interface PolicyEvaluator {
  readonly policyId: string;
  readonly policyVersion: string;
  evaluate(request: PolicyEvaluateRequest): PolicyEvaluateResult | Promise<PolicyEvaluateResult>;
}

export interface AppendPolicyDecisionInput extends OwnershipScope {
  readonly id: string;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly outcome: PolicyDecisionOutcome;
  readonly identity: AgentIdentity;
  readonly target: PolicyTarget;
  readonly reason?: string;
  readonly evidenceRefs?: readonly string[];
  readonly createdAt?: string;
  readonly expiresAt?: string;
  readonly signal?: AbortSignal;
}

export interface PolicyDecisionQuery extends OwnershipScope {
  readonly policyId?: string;
  readonly policyVersion?: string;
  readonly outcome?: PolicyDecisionOutcome;
  readonly cursor?: string;
  readonly limit?: number;
  readonly order?: "asc" | "desc";
  readonly signal?: AbortSignal;
}

export interface PolicyDecisionStore {
  append(input: AppendPolicyDecisionInput): Promise<PolicyDecisionRecord>;
  query(query: PolicyDecisionQuery): Promise<PersistencePage<PolicyDecisionRecord>>;
}

/** Host WORM / SIEM sink — package never embeds KMS or cloud WORM SDKs. */
export interface PolicyExportSink {
  write(records: readonly PolicyDecisionRecord[]): Promise<void>;
}

export interface PolicyExportOptions extends OwnershipScope {
  readonly cursor?: string;
  readonly limit?: number;
  readonly policyId?: string;
  readonly policyVersion?: string;
  readonly sink?: PolicyExportSink;
  readonly signal?: AbortSignal;
}

export interface PolicyLimits {
  readonly maxDecisionBytes?: number;
  readonly maxReasonBytes?: number;
  readonly maxEvidenceRefBytes?: number;
  readonly maxEvidenceRefs?: number;
  readonly maxExportPageSize?: number;
  readonly maxIdBytes?: number;
  readonly maxPolicyIdBytes?: number;
  readonly maxPolicyVersionBytes?: number;
  readonly maxTargetBytes?: number;
}

export interface ResolvedPolicyLimits {
  readonly maxDecisionBytes: number;
  readonly maxReasonBytes: number;
  readonly maxEvidenceRefBytes: number;
  readonly maxEvidenceRefs: number;
  readonly maxExportPageSize: number;
  readonly maxIdBytes: number;
  readonly maxPolicyIdBytes: number;
  readonly maxPolicyVersionBytes: number;
  readonly maxTargetBytes: number;
}
