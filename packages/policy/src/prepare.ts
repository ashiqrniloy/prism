import {
  assertIdentityActive,
  assertIdentityMatchesOwnership,
  ownershipFromIdentity,
  type AgentIdentity,
  type OwnershipScope,
} from "@arnilo/prism";
import { PolicyError } from "./errors.js";
import { DEFAULT_POLICY_LIMITS, resolvePolicyLimits } from "./limits.js";
import type {
  AppendPolicyDecisionInput,
  PolicyActorRef,
  PolicyDecisionOutcome,
  PolicyDecisionRecord,
  PolicyLimits,
  PolicyTarget,
  ResolvedPolicyLimits,
} from "./types.js";

const OUTCOMES = new Set<PolicyDecisionOutcome>(["allow", "deny", "modify", "approval"]);
const FORBIDDEN_APPEND_KEYS = new Set([
  "payload", "prompt", "prompts", "messages", "toolArguments", "arguments", "body", "content",
  "raw", "secret", "token", "jwt", "credential", "credentials",
]);

export interface PreparePolicyDecisionOptions {
  readonly limits?: PolicyLimits;
  /** When set, appends with a different policyVersion fail closed. */
  readonly requirePolicyVersion?: string;
  readonly now?: number;
}

function utf8Bytes(value: unknown): number {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

function requireNonEmpty(value: string | undefined, label: string, maxBytes: number): string {
  if (typeof value !== "string" || !value.trim()) throw new PolicyError(`${label} required`, "ERR_PRISM_POLICY_VALIDATION");
  if (utf8Bytes(value) > maxBytes) throw new PolicyError(`${label} exceeds ${maxBytes} bytes`, "ERR_PRISM_POLICY_BOUNDS");
  return value;
}

function requireOwnership(input: OwnershipScope): OwnershipScope {
  if (!input.tenantId?.trim()) throw new PolicyError("tenantId required", "ERR_PRISM_POLICY_OWNERSHIP");
  if (!input.accountId?.trim() && !input.userId?.trim()) {
    throw new PolicyError("accountId or userId required", "ERR_PRISM_POLICY_OWNERSHIP");
  }
  return {
    tenantId: input.tenantId,
    ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
    ...(input.userId !== undefined ? { userId: input.userId } : {}),
  };
}

function sameOwnership(a: OwnershipScope, b: OwnershipScope): boolean {
  return a.tenantId === b.tenantId && a.accountId === b.accountId && a.userId === b.userId;
}

function actorFromIdentity(identity: AgentIdentity): PolicyActorRef {
  return Object.freeze({
    tenantId: identity.tenantId,
    ...(identity.accountId !== undefined ? { accountId: identity.accountId } : {}),
    ...(identity.userId !== undefined ? { userId: identity.userId } : {}),
    principalId: identity.principal.id,
    principalKind: identity.principal.kind,
    ...(identity.sponsor ? { sponsorId: identity.sponsor.id } : {}),
  });
}

function normalizeTarget(target: PolicyTarget, maxBytes: number): PolicyTarget {
  const kind = requireNonEmpty(target?.kind, "target.kind", maxBytes);
  const id = requireNonEmpty(target?.id, "target.id", maxBytes);
  if (utf8Bytes({ kind, id }) > maxBytes) throw new PolicyError("target exceeds byte cap", "ERR_PRISM_POLICY_BOUNDS");
  return Object.freeze({ kind, id });
}

function normalizeEvidenceRefs(refs: readonly string[] | undefined, limits: ResolvedPolicyLimits): readonly string[] {
  if (!refs?.length) return Object.freeze([]);
  if (refs.length > limits.maxEvidenceRefs) {
    throw new PolicyError(`evidenceRefs exceeds ${limits.maxEvidenceRefs}`, "ERR_PRISM_POLICY_BOUNDS");
  }
  return Object.freeze(refs.map((ref, i) => {
    if (typeof ref !== "string" || !ref.trim()) throw new PolicyError(`evidenceRefs[${i}] required`, "ERR_PRISM_POLICY_VALIDATION");
    if (utf8Bytes(ref) > limits.maxEvidenceRefBytes) {
      throw new PolicyError(`evidenceRefs[${i}] exceeds ${limits.maxEvidenceRefBytes} bytes`, "ERR_PRISM_POLICY_BOUNDS");
    }
    return ref;
  }));
}

/** Reject unrestricted payload keys on append input (ledger stores refs only). */
export function assertNoUnrestrictedPayload(input: object): void {
  for (const key of Object.keys(input)) {
    if (FORBIDDEN_APPEND_KEYS.has(key)) {
      throw new PolicyError(`unrestricted payload field rejected: ${key}`, "ERR_PRISM_POLICY_PAYLOAD");
    }
  }
}

/** Validate, ownership-check, bound, and freeze one policy decision record. */
export function preparePolicyDecision(
  input: AppendPolicyDecisionInput,
  options: PreparePolicyDecisionOptions = {},
): PolicyDecisionRecord {
  input.signal?.throwIfAborted();
  assertNoUnrestrictedPayload(input);
  const limits = resolvePolicyLimits(options.limits);
  assertIdentityActive(input.identity, { now: options.now });
  const fromIdentity = ownershipFromIdentity(input.identity);
  const ownership = requireOwnership({
    tenantId: input.tenantId ?? fromIdentity.tenantId,
    accountId: input.accountId ?? fromIdentity.accountId,
    userId: input.userId ?? fromIdentity.userId,
  });
  assertIdentityMatchesOwnership(input.identity, ownership);
  if (options.requirePolicyVersion !== undefined && input.policyVersion !== options.requirePolicyVersion) {
    throw new PolicyError("policy version mismatch", "ERR_PRISM_POLICY_VERSION");
  }
  if (!OUTCOMES.has(input.outcome)) {
    throw new PolicyError("outcome must be allow|deny|modify|approval", "ERR_PRISM_POLICY_VALIDATION");
  }
  const id = requireNonEmpty(input.id, "id", limits.maxIdBytes);
  const policyId = requireNonEmpty(input.policyId, "policyId", limits.maxPolicyIdBytes);
  const policyVersion = requireNonEmpty(input.policyVersion, "policyVersion", limits.maxPolicyVersionBytes);
  const reason = input.reason === undefined ? undefined : requireNonEmpty(input.reason, "reason", limits.maxReasonBytes);
  const evidenceRefs = normalizeEvidenceRefs(input.evidenceRefs, limits);
  const target = normalizeTarget(input.target, limits.maxTargetBytes);
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) throw new PolicyError("createdAt must be ISO timestamp", "ERR_PRISM_POLICY_VALIDATION");
  if (input.expiresAt !== undefined && !Number.isFinite(Date.parse(input.expiresAt))) {
    throw new PolicyError("expiresAt must be ISO timestamp", "ERR_PRISM_POLICY_VALIDATION");
  }
  const record: PolicyDecisionRecord = Object.freeze({
    id,
    policyId,
    policyVersion,
    outcome: input.outcome,
    actor: actorFromIdentity(input.identity),
    target,
    ...(reason !== undefined ? { reason } : {}),
    evidenceRefs,
    createdAt,
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    ...ownership,
  });
  if (utf8Bytes(record) > limits.maxDecisionBytes) {
    throw new PolicyError(`decision exceeds ${limits.maxDecisionBytes} bytes`, "ERR_PRISM_POLICY_BOUNDS");
  }
  return record;
}

export function ownershipMatches(query: OwnershipScope, record: OwnershipScope): boolean {
  return sameOwnership(requireOwnership(query), record);
}

export { sameOwnership, requireOwnership, DEFAULT_POLICY_LIMITS };
