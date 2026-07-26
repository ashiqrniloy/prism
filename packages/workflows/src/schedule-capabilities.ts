import { randomUUID } from "node:crypto";
import type { CheckpointRecord, CheckpointStore, OwnershipScope } from "@arnilo/prism";
import { WorkflowCheckpointError, WorkflowRuntimeError } from "./errors.js";
import { DEFAULT_CAPABILITY_TTL_MS, HARD_CAPABILITY_TOKEN_BYTES, HARD_CAPABILITY_TTL_MS } from "./limits.js";
import type { WorkflowSchedules } from "./schedules.js";
import { assertWithinBytes, nowIso } from "./util.js";

const CAPABILITY_NAMESPACE = "prism.workflow.schedule.capability";

/** Redacted actor refs projected from verified identity — never JWTs or secrets. */
export interface CapabilityActorRef {
  readonly tenantId: string;
  readonly accountId?: string;
  readonly userId?: string;
  readonly principalId: string;
  readonly principalKind: string;
}

/** Scoped, expiring, revocable grant that enables one proactive schedule. */
export interface ScheduleCapabilityToken {
  readonly tokenId: string;
  readonly scheduleId: string;
  readonly workflowId: string;
  readonly scope: string;
  readonly actor: CapabilityActorRef;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revoked: boolean;
  readonly revokedAt?: string;
  readonly version: number;
}

export type ScheduleCapabilityEvent =
  | { readonly type: "capability_enabled"; readonly tokenId: string; readonly scheduleId: string; readonly workflowId: string; readonly scope: string; readonly actor: CapabilityActorRef; readonly timestamp: string }
  | { readonly type: "capability_revoked"; readonly tokenId: string; readonly scheduleId: string; readonly scope: string; readonly actor: CapabilityActorRef; readonly timestamp: string }
  | { readonly type: "capability_denied"; readonly tokenId: string; readonly reason: string; readonly timestamp: string };

export interface EnableCapabilityInput {
  readonly workflowId: string;
  readonly scope: string;
  readonly actor: CapabilityActorRef;
  readonly nextRunAt: string | Date;
  readonly intervalMs?: number;
  readonly calculatorId?: string;
  readonly input?: unknown;
  readonly ttlMs?: number;
  readonly scheduleId?: string;
  readonly tokenId?: string;
}

export interface ProactiveScheduleCapabilitiesOptions {
  readonly schedules: WorkflowSchedules;
  readonly store: CheckpointStore;
  readonly ownership: OwnershipScope;
  readonly ownerId: string;
  readonly defaultTtlMs?: number;
  readonly maxTtlMs?: number;
  readonly onCapability?: (event: ScheduleCapabilityEvent) => void;
}

export interface ProactiveScheduleCapabilities {
  readonly ownership: OwnershipScope;
  enable(input: EnableCapabilityInput, signal?: AbortSignal): Promise<ScheduleCapabilityToken>;
  revoke(tokenId: string, actor: CapabilityActorRef, signal?: AbortSignal): Promise<ScheduleCapabilityToken>;
  get(tokenId: string, signal?: AbortSignal): Promise<ScheduleCapabilityToken | null>;
  /** Fail-closed guard for manual trigger paths; throws on missing/revoked/expired. */
  assertActive(tokenId: string, signal?: AbortSignal): Promise<ScheduleCapabilityToken>;
}

/**
 * Wraps durable workflow schedules in explicit, revocable capability tokens.
 * Proactive runs require a granted token; revocation pauses the underlying
 * schedule so `pollOnce` never fires it (fail-closed), and `assertActive`
 * guards manual trigger paths. Hosts bridge `onCapability` to a policy ledger.
 */
export function createProactiveScheduleCapabilities(
  options: ProactiveScheduleCapabilitiesOptions,
): ProactiveScheduleCapabilities {
  requireOwnership(options.ownership);
  requireId(options.ownerId, "ownerId");
  const maxTtlMs = positive(options.maxTtlMs ?? HARD_CAPABILITY_TTL_MS, "maxTtlMs");
  const defaultTtlMs = Math.min(positive(options.defaultTtlMs ?? DEFAULT_CAPABILITY_TTL_MS, "defaultTtlMs"), maxTtlMs);

  const key = (tokenId: string) => ({ namespace: CAPABILITY_NAMESPACE, key: tokenId, ...options.ownership });

  const load = async (tokenId: string, signal?: AbortSignal): Promise<ScheduleCapabilityToken | null> => {
    const record = await options.store.loadCheckpoint({ ...key(tokenId), signal });
    return record ? parseToken(record) : null;
  };

  const save = async (
    value: Omit<ScheduleCapabilityToken, "version">,
    expectedVersion: number,
    signal?: AbortSignal,
  ): Promise<ScheduleCapabilityToken> => {
    assertWithinBytes(value, HARD_CAPABILITY_TOKEN_BYTES, "Capability token record");
    const record = await options.store.saveCheckpoint({
      ...key(value.tokenId),
      version: expectedVersion + 1,
      expectedVersion,
      value,
      category: value.revoked ? "revoked" : "active",
      signal,
    });
    return parseToken(record);
  };

  const deny = (tokenId: string, reason: string): never => {
    options.onCapability?.({ type: "capability_denied", tokenId, reason, timestamp: nowIso() });
    throw new WorkflowRuntimeError(`Capability ${tokenId} denied: ${reason}`, "ERR_PRISM_WORKFLOW_CAPABILITY_DENIED");
  };

  return {
    ownership: { ...options.ownership },

    async enable(input, signal) {
      requireId(input.workflowId, "workflowId");
      requireId(input.scope, "scope");
      requireActor(input.actor);
      const ttlMs = Math.min(positive(input.ttlMs ?? defaultTtlMs, "ttlMs"), maxTtlMs);
      const timestamp = nowIso();
      const scheduleId = input.scheduleId ?? `wfcap_${randomUUID()}`;
      const schedule = await options.schedules.create(
        {
          id: scheduleId,
          workflowId: input.workflowId,
          nextRunAt: input.nextRunAt,
          ...(input.intervalMs !== undefined ? { intervalMs: input.intervalMs } : {}),
          ...(input.calculatorId !== undefined ? { calculatorId: input.calculatorId } : {}),
          ...(input.input !== undefined ? { input: input.input } : {}),
          metadata: { capabilityScope: input.scope, proactive: true },
        },
        signal,
      );
      const token = await save(
        {
          tokenId: input.tokenId ?? `wfcap_${randomUUID()}`,
          scheduleId: schedule.id,
          workflowId: input.workflowId,
          scope: input.scope,
          actor: input.actor,
          createdAt: timestamp,
          expiresAt: new Date(Date.parse(timestamp) + ttlMs).toISOString(),
          revoked: false,
        },
        0,
        signal,
      );
      options.onCapability?.({
        type: "capability_enabled",
        tokenId: token.tokenId,
        scheduleId: token.scheduleId,
        workflowId: token.workflowId,
        scope: token.scope,
        actor: token.actor,
        timestamp,
      });
      return token;
    },

    async revoke(tokenId, actor, signal) {
      requireId(tokenId, "tokenId");
      requireActor(actor);
      const current = await load(tokenId, signal);
      if (!current) throw new WorkflowCheckpointError(`Unknown capability ${tokenId}`);
      if (current.revoked) return current;
      const timestamp = nowIso();
      const revoked = await save(
        { ...withoutVersion(current), revoked: true, revokedAt: timestamp },
        current.version,
        signal,
      );
      // Fail-closed stop: paused schedules never fire in pollOnce. Best-effort —
      // a missing schedule is already stopped.
      await options.schedules.pause(revoked.scheduleId, signal).catch(() => undefined);
      options.onCapability?.({
        type: "capability_revoked",
        tokenId: revoked.tokenId,
        scheduleId: revoked.scheduleId,
        scope: revoked.scope,
        actor,
        timestamp,
      });
      return revoked;
    },

    get: load,

    async assertActive(tokenId, signal) {
      requireId(tokenId, "tokenId");
      const token = await load(tokenId, signal);
      if (!token) return deny(tokenId, "unknown");
      if (token.revoked) return deny(tokenId, "revoked");
      if (Date.parse(token.expiresAt) <= Date.now()) return deny(tokenId, "expired");
      return token;
    },
  };
}

function parseToken(record: CheckpointRecord): ScheduleCapabilityToken {
  if (!record.value || typeof record.value !== "object" || Array.isArray(record.value)) {
    throw new WorkflowCheckpointError("Invalid capability token");
  }
  const value = record.value as Omit<ScheduleCapabilityToken, "version">;
  requireId(value.tokenId, "tokenId");
  requireId(value.scheduleId, "scheduleId");
  requireActor(value.actor);
  return { ...value, version: record.version };
}

function withoutVersion(token: ScheduleCapabilityToken): Omit<ScheduleCapabilityToken, "version"> {
  const { version: _version, ...value } = token;
  return value;
}

function requireOwnership(ownership: OwnershipScope): void {
  if (!ownership.tenantId || (!ownership.accountId && !ownership.userId)) {
    throw new WorkflowRuntimeError("Capabilities require tenantId and accountId or userId", "ERR_PRISM_WORKFLOW_CAPABILITY_OWNERSHIP");
  }
}

function requireActor(actor: CapabilityActorRef): void {
  if (!actor || typeof actor.tenantId !== "string" || actor.tenantId.length === 0) {
    throw new WorkflowRuntimeError("Capability actor requires tenantId", "ERR_PRISM_WORKFLOW_CAPABILITY_ACTOR");
  }
  if (typeof actor.principalId !== "string" || actor.principalId.length === 0) {
    throw new WorkflowRuntimeError("Capability actor requires principalId", "ERR_PRISM_WORKFLOW_CAPABILITY_ACTOR");
  }
}

function requireId(value: string, label: string): void {
  if (!value || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new WorkflowRuntimeError(`${label} is invalid`, "ERR_PRISM_WORKFLOW_CAPABILITY");
  }
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new WorkflowRuntimeError(`${label} must be a positive safe integer`, "ERR_PRISM_WORKFLOW_CAPABILITY");
  }
  return value;
}
