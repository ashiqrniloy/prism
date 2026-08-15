/**
 * Durable ACP/live-task run recovery (plan 026 Task 5).
 *
 * Host-facing recovery for ACP sessions that survived a restart or replica
 * switch: re-resolve a persisted active-run reference against the durable
 * `AgentRunLifecycle`, and provide the minimum durable cancellation primitive
 * for recovered runs. Cancellation is ownership/version/fence checked,
 * terminal/idempotent, aborts no unrelated run, and never replays a
 * pending/dispatched tool: a cancelled run reports `cancelled` and must not be
 * resumed. Unprovable in-flight streams report `unknown` rather than restart
 * the prompt.
 *
 * The persisted `activeRun` ref itself is advisory metadata only (frozen
 * 512-byte cap); the authoritative status is always re-queried from the
 * durable run state. Cancel markers live in their own versioned checkpoint
 * namespace and are CAS + LeaseStore fenced.
 */
import type { AgentRunLifecycle, AgentRunRef, CheckpointStore, LeaseStore, OwnershipScope } from "@arnilo/prism";
import { AgentRunStateError } from "@arnilo/prism";

/** Versioned namespace for durable run-cancel markers. */
export const ACP_RUN_CANCEL_NAMESPACE = "prism.coding-agent.cancel.v1";
export const ACP_RUN_CANCEL_CATEGORY = "coding-cancel";
export const ACP_RUN_CANCEL_SCHEMA_VERSION = 1;
const ACP_RUN_CANCEL_LEASE_NAMESPACE = "prism.coding-agent.cancel.lease.v1";
const DEFAULT_CANCEL_LEASE_TTL_MS = 30_000;
const HARD_CANCEL_LEASE_TTL_MS = 300_000;
const MAX_RUN_ID_BYTES = 128;
const MAX_OWNER_ID_BYTES = 512;

export type AcpRecoveredRunStatus = "suspended" | "terminal" | "unknown" | "cancelled";

/** Bounded recovery report for one active-run reference. */
export interface AcpRunStatusReport {
  readonly status: AcpRecoveredRunStatus;
  /** Durable run version at report time (approval/decision epoch). */
  readonly version?: number;
  /** Pending approval ids preserved across restart (suspended runs). */
  readonly pendingApprovalIds: readonly string[];
  /** Interruption reason for suspended runs. */
  readonly interruptionReason?: string;
  /** Cancel marker timestamp when the run was durably cancelled. */
  readonly cancelledAt?: string;
}

/** Result of a durable cancel attempt. */
export interface AcpRunCancelResult {
  /** True when the cancel marker was (or already had been) written. */
  readonly cancelled: boolean;
  /** True when the run was already terminal; no marker is written. */
  readonly terminal: boolean;
  readonly at?: string;
}

export interface CreateAcpRunRecoveryOptions {
  readonly lifecycle: AgentRunLifecycle;
  readonly checkpoints: CheckpointStore;
  readonly leases: LeaseStore;
  /** Replica/worker identity recorded on cancel markers and leases. */
  readonly ownerId: string;
  /** Lease TTL for cancel markers; default 30s, hard cap 300s. */
  readonly leaseTtlMs?: number;
}

/** Durable cancel marker (metadata only; never a credential or tool payload). */
export interface AcpRunCancelMarker {
  readonly schemaVersion: typeof ACP_RUN_CANCEL_SCHEMA_VERSION;
  readonly runId: string;
  readonly sessionId: string;
  readonly ownerId: string;
  /** Version the canceller observed; a later resume with a newer version still refuses. */
  readonly expectedVersion?: number;
  readonly cancelledAt: string;
}

export type AcpRecoveryErrorCode =
  | "ERR_PRISM_RECOVERY_UNSUPPORTED"
  | "ERR_PRISM_RECOVERY_FENCE"
  | "ERR_PRISM_RECOVERY_OWNERSHIP"
  | "ERR_PRISM_RECOVERY_LIMIT"
  | "ERR_PRISM_RECOVERY_UNKNOWN"
  | "ERR_PRISM_RECOVERY_UNTRUSTED";

export class AcpRecoveryError extends Error {
  readonly code: AcpRecoveryErrorCode;
  constructor(code: AcpRecoveryErrorCode, message: string) {
    super(message);
    this.name = "AcpRecoveryError";
    this.code = code;
  }
}

export interface AcpRunRecovery {
  /** Re-resolve a persisted active-run ref against durable run state. Never restarts a prompt. */
  status(ref: AgentRunRef, options?: { readonly ownership?: OwnershipScope; readonly agentId?: string; readonly signal?: AbortSignal }): Promise<AcpRunStatusReport>;
  /** Durable cancel: ownership/version/fence checked, terminal/idempotent, never replays tools. */
  cancel(ref: AgentRunRef, options?: { readonly ownership?: OwnershipScope; readonly agentId?: string; readonly expectedVersion?: number; readonly signal?: AbortSignal }): Promise<AcpRunCancelResult>;
  /** Read-only cancel-marker check. */
  isCancelled(ref: AgentRunRef, options?: { readonly ownership?: OwnershipScope; readonly signal?: AbortSignal }): Promise<{ readonly cancelled: boolean; readonly cancelledAt?: string }>;
}

function validateCancelMarker(value: unknown): AcpRunCancelMarker {
  if (typeof value !== "object" || value === null) {
    throw new AcpRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "cancel marker is not an object");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== ACP_RUN_CANCEL_SCHEMA_VERSION) {
    throw new AcpRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "unsupported cancel marker schema version");
  }
  for (const forbidden of ["env", "token", "credential", "secret", "payload", "toolCall", "commandOutput", "rawOutput"]) {
    if (forbidden in record) {
      throw new AcpRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", `forbidden field ${forbidden} in cancel marker`);
    }
  }
  const runId = record.runId as string | undefined;
  const sessionId = record.sessionId as string | undefined;
  const ownerId = record.ownerId as string | undefined;
  const expectedVersion = record.expectedVersion as number | undefined;
  const cancelledAt = record.cancelledAt as string | undefined;
  if (typeof runId !== "string" || runId.length === 0 || Buffer.byteLength(runId, "utf8") > MAX_RUN_ID_BYTES) {
    throw new AcpRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "malformed cancel marker runId");
  }
  if (typeof sessionId !== "string" || sessionId.length === 0 || Buffer.byteLength(sessionId, "utf8") > MAX_RUN_ID_BYTES) {
    throw new AcpRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "malformed cancel marker sessionId");
  }
  if (typeof ownerId !== "string" || ownerId.length === 0 || Buffer.byteLength(ownerId, "utf8") > MAX_OWNER_ID_BYTES) {
    throw new AcpRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "malformed cancel marker ownerId");
  }
  if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)) {
    throw new AcpRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "malformed cancel marker expectedVersion");
  }
  if (typeof cancelledAt !== "string" || Number.isNaN(Date.parse(cancelledAt))) {
    throw new AcpRecoveryError("ERR_PRISM_RECOVERY_UNTRUSTED", "malformed cancel marker cancelledAt");
  }
  const marker: AcpRunCancelMarker = {
    schemaVersion: ACP_RUN_CANCEL_SCHEMA_VERSION,
    runId,
    sessionId,
    ownerId,
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    cancelledAt,
  };
  if (Buffer.byteLength(JSON.stringify(marker), "utf8") > 4096) {
    throw new AcpRecoveryError("ERR_PRISM_RECOVERY_LIMIT", "cancel marker exceeds 4096 bytes");
  }
  return marker;
}

const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set(["succeeded", "failed", "aborted", "denied"]);

/** Durable run recovery + minimum durable cancellation for recovered ACP runs. */
export function createAcpRunRecovery(options: CreateAcpRunRecoveryOptions): AcpRunRecovery {
  const leaseTtlMs = Math.min(options.leaseTtlMs ?? DEFAULT_CANCEL_LEASE_TTL_MS, HARD_CANCEL_LEASE_TTL_MS);
  if (!Number.isSafeInteger(leaseTtlMs) || leaseTtlMs < 1_000) {
    throw new AcpRecoveryError("ERR_PRISM_RECOVERY_LIMIT", `leaseTtlMs must be a positive safe integer`);
  }
  const { checkpoints, leases, lifecycle } = options;

  const cancelKey = (runId: string) => ({ namespace: ACP_RUN_CANCEL_NAMESPACE, key: runId });

  async function loadMarker(runId: string, ownership?: OwnershipScope, signal?: AbortSignal): Promise<AcpRunCancelMarker | null> {
    const record = await checkpoints.loadCheckpoint({ ...cancelKey(runId), ...ownership, signal });
    if (!record) return null;
    try {
      return validateCancelMarker(record.value);
    } catch {
      return null; // corrupt marker fails closed as absent-unknown; cancel rewrites it
    }
  }

  return {
    async status(ref, request = {}) {
      request.signal?.throwIfAborted();
      const marker = await loadMarker(ref.runId, request.ownership, request.signal);
      if (marker) {
        return { status: "cancelled", version: marker.expectedVersion, pendingApprovalIds: [], cancelledAt: marker.cancelledAt };
      }
      let report: AcpRunStatusReport;
      try {
        const { state, version } = await lifecycle.status(ref, { ownership: request.ownership, agentId: request.agentId, signal: request.signal });
        if (state.status === "suspended") {
          const pendingApprovalIds = (state.interruption?.pendingDecisions ?? [])
            .map((decision) => decision.approvalId)
            .filter((id): id is string => typeof id === "string");
          report = { status: "suspended", version, pendingApprovalIds, interruptionReason: state.interruption?.reason };
        } else if (TERMINAL_RUN_STATUSES.has(state.status)) {
          report = { status: "terminal", version, pendingApprovalIds: [] };
        } else {
          // 'running': a provider turn may still be in flight on another replica.
          // Unprovable -> unknown; never restart the prompt.
          report = { status: "unknown", version, pendingApprovalIds: [] };
        }
      } catch (error) {
        if (request.signal?.aborted) throw error;
        if (error instanceof AgentRunStateError) {
          report = { status: "unknown", pendingApprovalIds: [] }; // stale ref: no durable run to prove
        } else {
          throw error;
        }
      }
      return report;
    },

    async cancel(ref, request = {}) {
      request.signal?.throwIfAborted();
      // Terminal runs cancel idempotently without a marker.
      let terminal = false;
      try {
        const { state } = await lifecycle.status(ref, { ownership: request.ownership, agentId: request.agentId, signal: request.signal });
        if (TERMINAL_RUN_STATUSES.has(state.status)) terminal = true;
      } catch (error) {
        if (request.signal?.aborted) throw error;
        if (!(error instanceof AgentRunStateError)) throw error;
        // Unknown durable run: fail closed toward cancellation (never replay).
      }
      if (terminal) return { cancelled: false, terminal: true };
      const existing = await loadMarker(ref.runId, request.ownership, request.signal);
      if (existing) return { cancelled: true, terminal: false, at: existing.cancelledAt };
      if (request.expectedVersion !== undefined) {
        // Version check: the canceller's observed durable version must still hold.
        try {
          const { version } = await lifecycle.status(ref, { ownership: request.ownership, agentId: request.agentId, signal: request.signal });
          if (version !== request.expectedVersion) {
            throw new AcpRecoveryError("ERR_PRISM_RECOVERY_FENCE", "run version moved since the activeRun ref was observed");
          }
        } catch (error) {
          if (request.signal?.aborted) throw error;
          if (error instanceof AcpRecoveryError) throw error;
          // no durable run: the version check cannot bind; proceed with marker only
        }
      }
      let lease: import("@arnilo/prism").LeaseRecord | null;
      try {
        lease = await leases.tryAcquireLease({
          namespace: ACP_RUN_CANCEL_LEASE_NAMESPACE,
          key: `cancel:${ref.runId}`,
          ownerId: options.ownerId,
          ttlMs: leaseTtlMs,
          ...request.ownership,
          signal: request.signal,
        });
      } catch (error) {
        if (request.signal?.aborted) throw error;
        throw new AcpRecoveryError("ERR_PRISM_RECOVERY_OWNERSHIP", "cancel lease ownership mismatch");
      }
      if (!lease) {
        throw new AcpRecoveryError("ERR_PRISM_RECOVERY_FENCE", "cancel lease is held by another replica");
      }
      try {
        const marker: AcpRunCancelMarker = {
          schemaVersion: ACP_RUN_CANCEL_SCHEMA_VERSION,
          runId: ref.runId,
          sessionId: ref.sessionId ?? "",
          ownerId: options.ownerId,
          ...(request.expectedVersion !== undefined ? { expectedVersion: request.expectedVersion } : {}),
          cancelledAt: new Date().toISOString(),
        };
        const current = await checkpoints.loadCheckpoint({ ...cancelKey(ref.runId), ...request.ownership, signal: request.signal });
        try {
          await checkpoints.saveCheckpoint({
            ...cancelKey(ref.runId),
            category: ACP_RUN_CANCEL_CATEGORY,
            value: marker,
            version: (current?.version ?? 0) + 1,
            expectedVersion: current?.version ?? 0,
            fencingToken: lease.fencingToken,
            ...request.ownership,
            signal: request.signal,
          });
        } catch (error) {
          if (request.signal?.aborted) throw error;
          throw new AcpRecoveryError("ERR_PRISM_RECOVERY_FENCE", "cancel marker CAS or fencing conflict");
        }
        return { cancelled: true, terminal: false, at: marker.cancelledAt };
      } finally {
        try {
          await leases.releaseLease({
            namespace: ACP_RUN_CANCEL_LEASE_NAMESPACE,
            key: `cancel:${ref.runId}`,
            ownerId: options.ownerId,
            token: lease.token,
            ...request.ownership,
            signal: request.signal,
          });
        } catch {
          // best effort: lease expiry is the backstop
        }
      }
    },

    async isCancelled(ref, request = {}) {
      const marker = await loadMarker(ref.runId, request.ownership, request.signal);
      return marker ? { cancelled: true, cancelledAt: marker.cancelledAt } : { cancelled: false };
    },
  };
}
