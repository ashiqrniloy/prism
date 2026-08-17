import { type AgentIdentity, assertIdentityActive, type PersistencePage } from "@arnilo/prism";
import { randomUUID } from "node:crypto";
import { PolicyError } from "./errors.js";
import { assertNoUnrestrictedPayload } from "./prepare.js";
import type { PolicyActorRef } from "./types.js";

/** Frozen approval caps (plan 027 Task 3). Hosts may tighten per request, never loosen. */
export const APPROVAL_HARD_LIMITS = Object.freeze({
  maxRequirements: 100,
  maxQuorum: 100,
  maxDecisions: 100,
  maxDelegationDepth: 8,
  maxIdBytes: 128,
  maxTenantBytes: 256,
  maxRoleBytes: 256,
  maxKindBytes: 256,
  maxDigestBytes: 512,
  maxReasonBytes: 1024,
  maxAuditRefBytes: 512,
  maxPolicyRevisionBytes: 128,
  maxRequirementJsonBytes: 64 * 1024,
  maxActorJsonBytes: 16 * 1024,
  maxDecisionJsonBytes: 256 * 1024,
} as const);

export interface ApprovalAction {
  readonly kind: string;
  readonly digest: string;
}

export interface ApprovalRequirement {
  readonly role: string;
  /** Distinct verified principals that must approve through this role. */
  readonly quorum: number;
}

export type ApprovalDecisionValue = "approve" | "reject";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "revoked" | "consumed";

export type ApprovalActorRef = PolicyActorRef;

/** Role authority accepted at decision time, including the full bounded delegation chain. */
export interface ApprovalRoleGrant {
  readonly role: string;
  /** Authority window for this role; never later than the request expiry. */
  readonly expiresAt?: string;
  /** Delegation chain, delegator first; absent means direct authority. */
  readonly delegatedFrom?: readonly PolicyActorRef[];
}

/** Host-supplied role/authority resolution. Hosts own identity verification and role source. */
export interface ApprovalAuthority {
  readonly policyRevision: string;
  resolveRoles(identity: AgentIdentity, request: ApprovalRequest): readonly ApprovalRoleGrant[] | Promise<readonly ApprovalRoleGrant[]>;
}

/** Immutable actor decision record (approve/reject per requirement role). */
export interface ApprovalDecision {
  readonly id: string;
  readonly actor: PolicyActorRef;
  readonly role: string;
  readonly decision: ApprovalDecisionValue;
  readonly grant: ApprovalRoleGrant;
  readonly reason?: string;
  readonly auditRef: string;
  readonly createdAt: string;
}

/** Immutable approval request data. */
export interface ApprovalRequest {
  readonly id: string;
  readonly tenantId: string;
  readonly requester: PolicyActorRef;
  readonly action: ApprovalAction;
  readonly requirements: readonly ApprovalRequirement[];
  readonly separateFromRequester: boolean;
  /** 0 = delegation not accepted; bounded chain length otherwise. */
  readonly delegationMaxDepth: number;
  readonly expiresAt: string;
  readonly createdAt: string;
}

/** Current view of one approval: immutable request + durable status/provenance. */
export interface ApprovalRecord extends ApprovalRequest {
  readonly status: ApprovalStatus;
  readonly revision: number;
  /** Policy revision pinned when the request was created. */
  readonly policyRevision: string;
  readonly decisions: readonly ApprovalDecision[];
  readonly lastActionRef?: string;
  readonly updatedAt: string;
}

export interface ApprovalCreateInput {
  readonly tenantId: string;
  readonly requester: AgentIdentity;
  readonly action: ApprovalAction;
  readonly requirements: readonly ApprovalRequirement[];
  readonly separateFromRequester: boolean;
  readonly expiresAt: string;
  /** Bounded delegation depth; defaults to 0 (no delegation). */
  readonly delegationMaxDepth?: number;
  readonly signal?: AbortSignal;
}

export interface ApprovalDecideInput {
  readonly tenantId: string;
  readonly requestId: string;
  readonly expectedRevision: number;
  /** Requirement role this decision addresses; the actor must hold it. */
  readonly role: string;
  readonly actor: AgentIdentity;
  readonly decision: ApprovalDecisionValue;
  readonly reason?: string;
  readonly auditRef: string;
  readonly signal?: AbortSignal;
}

export interface ApprovalRevokeInput {
  readonly tenantId: string;
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly authorizedBy: AgentIdentity;
  readonly reason?: string;
  readonly auditRef: string;
  readonly signal?: AbortSignal;
}

export interface ApprovalConsumeInput {
  readonly tenantId: string;
  readonly requestId: string;
  readonly expectedRevision: number;
  /** Must match the stored action; release is denied on mismatch. */
  readonly action: ApprovalAction;
  readonly authorizedBy: AgentIdentity;
  readonly auditRef: string;
  /** Optional caller-owned transaction seam (PostgreSQL); policy never embeds pg. */
  readonly client?: ApprovalQueryClient;
  readonly signal?: AbortSignal;
}

export interface ApprovalGetInput {
  readonly tenantId: string;
  readonly requestId: string;
  readonly signal?: AbortSignal;
}

export interface ApprovalQuery {
  readonly tenantId: string;
  readonly status?: ApprovalStatus;
  readonly cursor?: string;
  readonly limit?: number;
  readonly order?: "asc" | "desc";
  readonly signal?: AbortSignal;
}

/** Minimal structural query seam so grant consumption can join a caller-owned transaction without a pg dependency. */
export interface ApprovalQueryClient {
  query(
    text: string,
    params?: readonly unknown[],
  ): Promise<{
    readonly rows: readonly Record<string, unknown>[];
    readonly rowCount: number | null;
  }>;
}

export interface ApprovalStore {
  create(input: ApprovalCreateInput): Promise<ApprovalRecord>;
  decide(input: ApprovalDecideInput): Promise<ApprovalRecord>;
  revoke(input: ApprovalRevokeInput): Promise<ApprovalRecord>;
  consume(input: ApprovalConsumeInput): Promise<ApprovalRecord>;
  get(input: ApprovalGetInput): Promise<ApprovalRecord | null>;
  query(query: ApprovalQuery): Promise<PersistencePage<ApprovalRecord>>;
}

/** Pure quorum evaluation. A rejection is a terminal veto; approval needs every requirement's quorum. */
export function evaluateApproval(
  requirements: readonly ApprovalRequirement[],
  decisions: readonly ApprovalDecision[],
): "pending" | "approved" | "rejected" {
  if (decisions.some((decision) => decision.decision === "reject")) return "rejected";
  for (const requirement of requirements) {
    const approvers = new Set(
      decisions
        .filter((decision) => decision.decision === "approve" && decision.role === requirement.role)
        .map((decision) => decision.actor.principalId),
    );
    if (approvers.size < requirement.quorum) return "pending";
  }
  return "approved";
}

export interface ApprovalTransitionContext {
  readonly authority: ApprovalAuthority;
  readonly now: number;
}

export interface PreparedApprovalCreate {
  readonly request: ApprovalRequest;
  readonly policyRevision: string;
}

/** Validate and normalize an approval request. Pure; stores persist the returned shape. */
export function prepareApprovalCreate(input: ApprovalCreateInput, context: ApprovalTransitionContext, id: string): PreparedApprovalCreate {
  input.signal?.throwIfAborted();
  assertNoUnrestrictedPayload(input);
  const tenantId = text(input.tenantId, "approval tenant", APPROVAL_HARD_LIMITS.maxTenantBytes);
  assertIdentityActive(input.requester, { expectedTenantId: tenantId, now: context.now });
  const requester = actorRef(input.requester);
  const action = normalizeAction(input.action);
  const requirements = normalizeRequirements(input.requirements);
  const separateFromRequester = input.separateFromRequester === true;
  const delegationMaxDepth = boundedInt(
    input.delegationMaxDepth ?? 0,
    "approval delegation depth",
    0,
    APPROVAL_HARD_LIMITS.maxDelegationDepth,
  );
  const expiresAt = isoAfter(input.expiresAt, context.now, "approval expiry");
  if (!input.requester.tenantId || input.requester.tenantId !== tenantId) {
    throw new PolicyError("requester tenant must match request tenant", "ERR_PRISM_POLICY_OWNERSHIP");
  }
  return {
    request: Object.freeze({
      id: text(id, "approval id", APPROVAL_HARD_LIMITS.maxIdBytes),
      tenantId,
      requester,
      action,
      requirements,
      separateFromRequester,
      delegationMaxDepth,
      expiresAt,
      createdAt: new Date(context.now).toISOString(),
    }),
    policyRevision: text(context.authority.policyRevision, "approval policy revision", APPROVAL_HARD_LIMITS.maxPolicyRevisionBytes),
  };
}

export interface PreparedApprovalDecision {
  readonly decision: ApprovalDecision;
  readonly changed: boolean;
  readonly status: ApprovalStatus;
  readonly nextRevision: number;
  readonly lastActionRef: string;
}

/** Validate one decision against the current locked record. Pure; duplicate votes are idempotent. */
export async function prepareApprovalDecision(
  current: ApprovalRecord,
  input: ApprovalDecideInput,
  context: ApprovalTransitionContext,
): Promise<PreparedApprovalDecision> {
  input.signal?.throwIfAborted();
  assertNoUnrestrictedPayload(input);
  assertRequestMatch(current, input.tenantId, input.requestId);
  requireUnchanged(current, input.expectedRevision);
  requirePending(current, context.now);
  if (context.authority.policyRevision !== current.policyRevision) {
    throw new PolicyError("approval policy revision mismatch", "ERR_PRISM_POLICY_AUTHORITY");
  }
  const decisionValue = decisionValueOf(input.decision);
  if (!current.requirements.some((requirement) => requirement.role === input.role)) {
    throw new PolicyError(`role ${input.role} is not required`, "ERR_PRISM_POLICY_VALIDATION");
  }
  if (decisionValue === "approve" && current.separateFromRequester) {
    requireNotRequester(current, input.actor, context.now);
  }
  const grant = await resolveRoleGrant(current, input, context);
  const existing = current.decisions.find(
    (decision) => decision.actor.principalId === grantActor(input.actor, current, context.now).principalId && decision.role === input.role,
  );
  if (existing) {
    if (existing.decision !== decisionValue) {
      throw new PolicyError("an actor decision cannot be changed", "ERR_PRISM_POLICY_APPROVAL");
    }
    return {
      decision: existing,
      changed: false,
      status: current.status,
      nextRevision: current.revision,
      lastActionRef: input.auditRef,
    };
  }
  const decision: ApprovalDecision = Object.freeze({
    id: randomUUID(),
    actor: grantActor(input.actor, current, context.now),
    role: input.role,
    decision: decisionValue,
    grant: Object.freeze({ ...grant }),
    ...(input.reason === undefined ? {} : { reason: text(input.reason, "approval reason", APPROVAL_HARD_LIMITS.maxReasonBytes) }),
    auditRef: text(input.auditRef, "approval audit reference", APPROVAL_HARD_LIMITS.maxAuditRefBytes),
    createdAt: new Date(context.now).toISOString(),
  });
  const decisions = [...current.decisions, decision];
  if (decisions.length > APPROVAL_HARD_LIMITS.maxDecisions) {
    throw new PolicyError(`approval decisions exceed ${APPROVAL_HARD_LIMITS.maxDecisions}`, "ERR_PRISM_POLICY_BOUNDS");
  }
  return {
    decision,
    changed: true,
    status: evaluateApproval(current.requirements, decisions),
    nextRevision: current.revision + 1,
    lastActionRef: input.auditRef,
  };
}

export interface PreparedApprovalTransition {
  readonly status: ApprovalStatus;
  readonly nextRevision: number;
  readonly lastActionRef: string;
}

/** Validate a revoke against the current locked record. Pure. */
export function prepareApprovalRevoke(
  current: ApprovalRecord,
  input: ApprovalRevokeInput,
  context: ApprovalTransitionContext,
): PreparedApprovalTransition {
  input.signal?.throwIfAborted();
  assertNoUnrestrictedPayload(input);
  assertRequestMatch(current, input.tenantId, input.requestId);
  requireUnchanged(current, input.expectedRevision);
  if (current.status !== "pending" && current.status !== "approved") {
    throw new PolicyError(`approval cannot be revoked from ${current.status}`, "ERR_PRISM_POLICY_APPROVAL");
  }
  if (context.now > Date.parse(current.expiresAt)) {
    throw new PolicyError("approval request has expired", "ERR_PRISM_POLICY_APPROVAL");
  }
  assertIdentityActive(input.authorizedBy, { expectedTenantId: current.tenantId, now: context.now });
  return {
    status: "revoked",
    nextRevision: current.revision + 1,
    lastActionRef: text(input.auditRef, "approval audit reference", APPROVAL_HARD_LIMITS.maxAuditRefBytes),
  };
}

/** Validate grant consumption against the current locked record. Pure. */
export function prepareApprovalConsume(
  current: ApprovalRecord,
  input: ApprovalConsumeInput,
  context: ApprovalTransitionContext,
): PreparedApprovalTransition {
  input.signal?.throwIfAborted();
  assertNoUnrestrictedPayload(input);
  assertRequestMatch(current, input.tenantId, input.requestId);
  requireUnchanged(current, input.expectedRevision);
  if (current.status !== "approved") {
    throw new PolicyError(`grant is not approved (${current.status})`, "ERR_PRISM_POLICY_APPROVAL");
  }
  if (context.now > Date.parse(current.expiresAt)) {
    throw new PolicyError("approval request has expired", "ERR_PRISM_POLICY_APPROVAL");
  }
  if (input.action.kind !== current.action.kind || input.action.digest !== current.action.digest) {
    throw new PolicyError("grant action does not match release action", "ERR_PRISM_POLICY_APPROVAL");
  }
  assertIdentityActive(input.authorizedBy, { expectedTenantId: current.tenantId, now: context.now });
  return {
    status: "consumed",
    nextRevision: current.revision + 1,
    lastActionRef: text(input.auditRef, "approval audit reference", APPROVAL_HARD_LIMITS.maxAuditRefBytes),
  };
}

async function resolveRoleGrant(
  current: ApprovalRecord,
  input: ApprovalDecideInput,
  context: ApprovalTransitionContext,
): Promise<ApprovalRoleGrant> {
  const grants = await context.authority.resolveRoles(input.actor, current);
  if (!Array.isArray(grants)) throw new PolicyError("authority returned no role grants", "ERR_PRISM_POLICY_AUTHORITY");
  const grant = grants.find((candidate) => candidate?.role === input.role);
  if (!grant) throw new PolicyError(`actor does not hold required role ${input.role}`, "ERR_PRISM_POLICY_AUTHORITY");
  const expiresAt = grant.expiresAt === undefined ? undefined : isoAtOrAfter(grant.expiresAt, context.now, "approval role grant");
  if (expiresAt !== undefined && expiresAt > current.expiresAt) {
    throw new PolicyError("role grant cannot outlive the request", "ERR_PRISM_POLICY_AUTHORITY");
  }
  const chain = normalizeDelegationChain(grant.delegatedFrom, current, input.actor);
  const normalized = Object.freeze({
    role: text(grant.role, "approval role", APPROVAL_HARD_LIMITS.maxRoleBytes),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(chain.length === 0 ? {} : { delegatedFrom: chain }),
  } satisfies ApprovalRoleGrant);
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > APPROVAL_HARD_LIMITS.maxDecisionJsonBytes / 4) {
    throw new PolicyError("role grant exceeds byte cap", "ERR_PRISM_POLICY_BOUNDS");
  }
  return normalized;
}

function normalizeDelegationChain(
  chain: readonly PolicyActorRef[] | undefined,
  current: ApprovalRecord,
  actor: AgentIdentity,
): readonly PolicyActorRef[] {
  if (!chain?.length) return Object.freeze([]);
  if (current.separateFromRequester && chain.some((ref) => ref.principalId === current.requester.principalId)) {
    throw new PolicyError("delegated authority cannot derive from the requester", "ERR_PRISM_POLICY_AUTHORITY");
  }
  if (chain.length > current.delegationMaxDepth) {
    throw new PolicyError(`delegation chain exceeds request depth ${current.delegationMaxDepth}`, "ERR_PRISM_POLICY_AUTHORITY");
  }
  const actorPrincipal = actor.principal?.id;
  const seen = new Set<string>();
  const normalized: PolicyActorRef[] = [];
  for (const ref of chain) {
    const actorRef = normalizeActorRef(ref, current.tenantId);
    if (seen.has(actorRef.principalId) || actorRef.principalId === actorPrincipal) {
      throw new PolicyError("delegation chain contains duplicate or self principals", "ERR_PRISM_POLICY_AUTHORITY");
    }
    seen.add(actorRef.principalId);
    normalized.push(actorRef);
  }
  return Object.freeze(normalized);
}

function requirePending(current: ApprovalRecord, now: number): void {
  if (current.status !== "pending") {
    throw new PolicyError(`approval is not pending (${current.status})`, "ERR_PRISM_POLICY_APPROVAL");
  }
  if (now > Date.parse(current.expiresAt)) {
    throw new PolicyError("approval request has expired", "ERR_PRISM_POLICY_APPROVAL");
  }
}

function requireNotRequester(current: ApprovalRecord, actor: AgentIdentity, now: number): void {
  assertIdentityActive(actor, { expectedTenantId: current.tenantId, now });
  if (actor.principal?.id === current.requester.principalId) {
    throw new PolicyError("separation of duties denies the requester", "ERR_PRISM_POLICY_AUTHORITY");
  }
}

function assertRequestMatch(record: ApprovalRecord, tenantId: string, requestId: string): void {
  if (record.tenantId !== tenantId || record.id !== requestId) {
    throw new PolicyError("approval request not found", "ERR_PRISM_POLICY_OWNERSHIP");
  }
}

function requireUnchanged(record: ApprovalRecord, expectedRevision: number): void {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== record.revision) {
    throw new PolicyError("approval revision is stale", "ERR_PRISM_POLICY_APPROVAL");
  }
}

function grantActor(identity: AgentIdentity, request: ApprovalRequest, now: number): PolicyActorRef {
  assertIdentityActive(identity, { expectedTenantId: request.tenantId, now });
  return actorRef(identity);
}

function normalizeAction(action: ApprovalAction | undefined): ApprovalAction {
  if (!action || typeof action !== "object") throw new PolicyError("approval action required", "ERR_PRISM_POLICY_VALIDATION");
  return Object.freeze({
    kind: text(action.kind, "approval action kind", APPROVAL_HARD_LIMITS.maxKindBytes),
    digest: text(action.digest, "approval action digest", APPROVAL_HARD_LIMITS.maxDigestBytes),
  });
}

function normalizeRequirements(requirements: readonly ApprovalRequirement[] | undefined): readonly ApprovalRequirement[] {
  if (!Array.isArray(requirements) || requirements.length < 1) {
    throw new PolicyError("approval requirements required", "ERR_PRISM_POLICY_VALIDATION");
  }
  if (requirements.length > APPROVAL_HARD_LIMITS.maxRequirements) {
    throw new PolicyError(`approval requirements exceed ${APPROVAL_HARD_LIMITS.maxRequirements}`, "ERR_PRISM_POLICY_BOUNDS");
  }
  const roles = new Set<string>();
  const normalized: ApprovalRequirement[] = [];
  for (const requirement of requirements) {
    const role = text(requirement?.role, "approval role", APPROVAL_HARD_LIMITS.maxRoleBytes);
    if (roles.has(role)) throw new PolicyError(`duplicate requirement role ${role}`, "ERR_PRISM_POLICY_VALIDATION");
    roles.add(role);
    const quorum = boundedInt(requirement?.quorum, `approval quorum for ${role}`, 1, APPROVAL_HARD_LIMITS.maxQuorum);
    normalized.push(Object.freeze({ role, quorum }));
  }
  const encoded = JSON.stringify(normalized);
  if (Buffer.byteLength(encoded, "utf8") > APPROVAL_HARD_LIMITS.maxRequirementJsonBytes) {
    throw new PolicyError("approval requirements exceed byte cap", "ERR_PRISM_POLICY_BOUNDS");
  }
  return Object.freeze(normalized);
}

function normalizeActorRef(ref: PolicyActorRef | undefined, tenantId: string): PolicyActorRef {
  if (!ref || typeof ref !== "object") throw new PolicyError("delegation ref is invalid", "ERR_PRISM_POLICY_AUTHORITY");
  if (ref.tenantId !== tenantId) throw new PolicyError("delegation ref tenant mismatch", "ERR_PRISM_POLICY_OWNERSHIP");
  return objectActorRef(ref);
}

function actorRef(identity: AgentIdentity): PolicyActorRef {
  return Object.freeze({
    tenantId: identity.tenantId,
    ...(identity.accountId === undefined ? {} : { accountId: identity.accountId }),
    ...(identity.userId === undefined ? {} : { userId: identity.userId }),
    principalId: text(identity.principal?.id, "approval principal", APPROVAL_HARD_LIMITS.maxIdBytes),
    principalKind: text(identity.principal?.kind, "approval principal kind", APPROVAL_HARD_LIMITS.maxIdBytes),
    ...(identity.sponsor ? { sponsorId: identity.sponsor.id } : {}),
  });
}

function objectActorRef(ref: PolicyActorRef): PolicyActorRef {
  return Object.freeze({
    tenantId: text(ref.tenantId, "approval principal tenant", APPROVAL_HARD_LIMITS.maxTenantBytes),
    ...(ref.accountId === undefined
      ? {}
      : { accountId: text(ref.accountId, "approval principal account", APPROVAL_HARD_LIMITS.maxIdBytes) }),
    ...(ref.userId === undefined ? {} : { userId: text(ref.userId, "approval principal user", APPROVAL_HARD_LIMITS.maxIdBytes) }),
    principalId: text(ref.principalId, "approval principal", APPROVAL_HARD_LIMITS.maxIdBytes),
    principalKind: text(ref.principalKind, "approval principal kind", APPROVAL_HARD_LIMITS.maxIdBytes),
    ...(ref.sponsorId === undefined
      ? {}
      : { sponsorId: text(ref.sponsorId, "approval principal sponsor", APPROVAL_HARD_LIMITS.maxIdBytes) }),
  });
}

function decisionValueOf(value: unknown): ApprovalDecisionValue {
  if (value === "approve" || value === "reject") return value;
  throw new PolicyError("decision must be approve|reject", "ERR_PRISM_POLICY_VALIDATION");
}

function isoAfter(value: unknown, now: number, label: string): string {
  const normalized = iso(value, label);
  if (Date.parse(normalized) <= now) throw new PolicyError(`${label} must be in the future`, "ERR_PRISM_POLICY_VALIDATION");
  return normalized;
}

function isoAtOrAfter(value: unknown, now: number, label: string): string {
  const normalized = iso(value, label);
  if (Date.parse(normalized) < now) throw new PolicyError(`${label} has expired`, "ERR_PRISM_POLICY_AUTHORITY");
  return normalized;
}

function iso(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new PolicyError(`${label} must be an ISO timestamp`, "ERR_PRISM_POLICY_VALIDATION");
  }
  return value;
}

function boundedInt(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new PolicyError(`${label} is out of range`, "ERR_PRISM_POLICY_BOUNDS");
  }
  return Number(value);
}

function text(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new PolicyError(`${label} is invalid`, "ERR_PRISM_POLICY_VALIDATION");
  }
  return value;
}

export interface MemoryApprovalStoreOptions {
  readonly authority: ApprovalAuthority;
  /** Injectable clock for deterministic tests; a function allows time to advance between calls. */
  readonly now?: number | (() => number);
  readonly initial?: readonly ApprovalRecord[];
}

/** In-memory approval store (reference adapter) sharing the pure transition logic. */
export function createMemoryApprovalStore(options: MemoryApprovalStoreOptions): ApprovalStore {
  if (!options?.authority) throw new PolicyError("approval authority required", "ERR_PRISM_POLICY_VALIDATION");
  if (typeof options.authority.resolveRoles !== "function") {
    throw new PolicyError("approval authority resolveRoles required", "ERR_PRISM_POLICY_VALIDATION");
  }
  const records = new Map<string, ApprovalRecord>();
  for (const record of options.initial ?? []) records.set(recordKey(record.tenantId, record.id), Object.freeze({ ...record }));
  const resolveNow =
    options.now === undefined ? () => Date.now() : typeof options.now === "function" ? options.now : () => options.now as number;
  const context = () => ({ authority: options.authority, now: resolveNow() });

  return {
    async create(input) {
      const id = randomUUID();
      const prepared = prepareApprovalCreate(input, context(), id);
      const record: ApprovalRecord = Object.freeze({
        ...prepared.request,
        status: "pending",
        revision: 1,
        policyRevision: prepared.policyRevision,
        decisions: Object.freeze([]),
        updatedAt: prepared.request.createdAt,
      });
      records.set(recordKey(record.tenantId, record.id), record);
      return record;
    },

    async decide(input) {
      const current = requireRecord(records, input.tenantId, input.requestId);
      const prepared = await prepareApprovalDecision(current, input, context());
      if (!prepared.changed) return current;
      const record = transition(current, prepared.status, prepared.nextRevision, prepared.decision, prepared.lastActionRef);
      records.set(recordKey(record.tenantId, record.id), record);
      return record;
    },

    async revoke(input) {
      const current = requireRecord(records, input.tenantId, input.requestId);
      const prepared = prepareApprovalRevoke(current, input, context());
      const record = transition(current, prepared.status, prepared.nextRevision, undefined, prepared.lastActionRef);
      records.set(recordKey(record.tenantId, record.id), record);
      return record;
    },

    async consume(input) {
      const current = requireRecord(records, input.tenantId, input.requestId);
      const prepared = prepareApprovalConsume(current, input, context());
      const record = transition(current, prepared.status, prepared.nextRevision, undefined, prepared.lastActionRef);
      records.set(recordKey(record.tenantId, record.id), record);
      return record;
    },

    async get(input) {
      input.signal?.throwIfAborted();
      return records.get(recordKey(input.tenantId, input.requestId)) ?? null;
    },

    async query(query) {
      query.signal?.throwIfAborted();
      const tenantId = text(query.tenantId, "approval tenant", APPROVAL_HARD_LIMITS.maxTenantBytes);
      const limit = pageLimit(query.limit);
      const order = query.order === "desc" ? -1 : 1;
      const sorted = [...records.values()]
        .filter((record) => record.tenantId === tenantId && (query.status === undefined || record.status === query.status))
        .sort((left, right) => order * (left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)));
      const start = query.cursor ? sorted.findIndex((record) => record.id === query.cursor) + 1 : 0;
      if (query.cursor && start === 0) throw new PolicyError("Unknown approval cursor", "ERR_PRISM_POLICY_APPROVAL");
      const items = sorted.slice(start, start + limit);
      return {
        items,
        nextCursor: start + items.length < sorted.length ? items.at(-1)?.id : undefined,
        total: sorted.length,
      };
    },
  };
}

function transition(
  current: ApprovalRecord,
  status: ApprovalStatus,
  revision: number,
  decision: ApprovalDecision | undefined,
  lastActionRef: string,
): ApprovalRecord {
  return Object.freeze({
    ...current,
    status,
    revision,
    ...(decision === undefined ? {} : { decisions: Object.freeze([...current.decisions, decision]) }),
    lastActionRef,
    updatedAt: new Date().toISOString(),
  });
}

function requireRecord(records: Map<string, ApprovalRecord>, tenantId: string, requestId: string): ApprovalRecord {
  const record = records.get(recordKey(tenantId, requestId));
  if (!record) throw new PolicyError("approval request not found", "ERR_PRISM_POLICY_OWNERSHIP");
  return record;
}

function recordKey(tenantId: string, id: string): string {
  return `${tenantId}/${id}`;
}

function pageLimit(value: number | undefined): number {
  const limit = value ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new PolicyError("approval limit must be 1..500", "ERR_PRISM_POLICY_BOUNDS");
  }
  return limit;
}
