// Plan 079 Task 6: opaque, one-use channel controls. Core owns decision validation and CAS;
// this record only binds a short-lived transport token to that core decision.
import { createHash, randomBytes } from "node:crypto";
import { OwnershipScope } from "@arnilo/prism";
import type { CheckpointStore } from "./checkpoint-contract.js";
import type { AgentIdentity } from "./identity.js";
import { CHANNEL_JOURNAL_NAMESPACES } from "./state.js";
import type { ChannelApprovalOutcome } from "./types.js";

const TOKEN_BYTES = 32;

interface ChannelApprovalRecord {
  readonly connectionId: string;
  readonly externalConversationId: string;
  readonly externalActorId: string;
  readonly threadId?: string;
  readonly principalKind: string;
  readonly principalId: string;
  readonly grantRevision: string;
  readonly agentAlias?: string;
  readonly definitionRevision?: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly approvalId: string;
  readonly expectedVersion?: number;
  readonly outcome: ChannelApprovalOutcome;
  readonly state: "pending" | "consumed";
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly consumedAt?: string;
}

interface ApprovalTarget {
  readonly ownership: OwnershipScope;
  readonly identity: AgentIdentity;
  readonly connectionId: string;
  readonly externalConversationId: string;
  readonly externalActorId: string;
  readonly threadId?: string;
  readonly grantRevision: string;
  readonly agentAlias?: string;
  readonly definitionRevision?: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly approvalId: string;
  readonly expectedVersion?: number;
  readonly outcome: ChannelApprovalOutcome;
}

interface StoredApproval {
  readonly version: number;
  readonly record: ChannelApprovalRecord;
}

export interface ChannelApprovalStore {
  create(
    input: ApprovalTarget & { readonly ttlMs: number; readonly now?: string },
  ): Promise<{ readonly token: string; readonly record: ChannelApprovalRecord }>;
  load(input: {
    readonly ownership: OwnershipScope;
    readonly connectionId: string;
    readonly token: string;
  }): Promise<StoredApproval | null>;
  consume(input: {
    readonly ownership: OwnershipScope;
    readonly connectionId: string;
    readonly token: string;
    readonly expectedVersion: number;
    readonly now?: string;
  }): Promise<"consumed" | "invalid" | "expired" | "already_consumed">;
}

function scopeOf(ownership: OwnershipScope): OwnershipScope {
  return {
    ...(ownership.tenantId === undefined ? {} : { tenantId: ownership.tenantId }),
    ...(ownership.accountId === undefined ? {} : { accountId: ownership.accountId }),
    ...(ownership.userId === undefined ? {} : { userId: ownership.userId }),
  };
}

function scopeTag(ownership: OwnershipScope): string {
  return `${ownership.tenantId ?? "-"}:${ownership.accountId ?? "-"}:${ownership.userId ?? "-"}`;
}

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function controlKey(ownership: OwnershipScope, connectionId: string, tokenHash: string, prefix = "a1"): string {
  return [prefix, connectionId || "-", scopeTag(ownership), tokenHash.slice(0, 40)].join(":");
}

function asRecord(value: unknown): ChannelApprovalRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Partial<ChannelApprovalRecord>;
  if (
    typeof record.connectionId !== "string" ||
    typeof record.externalConversationId !== "string" ||
    typeof record.externalActorId !== "string" ||
    typeof record.principalKind !== "string" ||
    typeof record.principalId !== "string" ||
    typeof record.grantRevision !== "string" ||
    (record.agentAlias !== undefined && typeof record.agentAlias !== "string") ||
    (record.definitionRevision !== undefined && typeof record.definitionRevision !== "string") ||
    typeof record.sessionId !== "string" ||
    typeof record.runId !== "string" ||
    typeof record.approvalId !== "string" ||
    (record.expectedVersion !== undefined && (!Number.isSafeInteger(record.expectedVersion) || record.expectedVersion < 1)) ||
    (record.outcome !== "allow_once" && record.outcome !== "reject_once" && record.outcome !== "allow_for_run") ||
    (record.state !== "pending" && record.state !== "consumed") ||
    typeof record.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(record.expiresAt))
  ) {
    return null;
  }
  return record as ChannelApprovalRecord;
}

export function createChannelApprovalStore(checkpoints: CheckpointStore): ChannelApprovalStore {
  return createControlStore(checkpoints, "a1", asRecord, (input: ApprovalTarget & { ttlMs: number; now?: string }, now) => {
    return {
      connectionId: input.connectionId,
      externalConversationId: input.externalConversationId,
      externalActorId: input.externalActorId,
      ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
      principalKind: input.identity.principal.kind,
      principalId: input.identity.principal.id,
      grantRevision: input.grantRevision,
      agentAlias: input.agentAlias ?? "default",
      definitionRevision: input.definitionRevision ?? "1",
      sessionId: input.sessionId,
      runId: input.runId,
      approvalId: input.approvalId,
      expectedVersion: input.expectedVersion ?? 1,
      outcome: input.outcome,
      state: "pending",
      createdAt: now,
      expiresAt: new Date(Date.parse(now) + input.ttlMs).toISOString(),
    };
  });
}

export interface ChannelUiRequestRecord
  extends Omit<ChannelApprovalRecord, "sessionId" | "runId" | "approvalId" | "outcome" | "expectedVersion"> {
  readonly requestId: string;
  readonly valueKind: "confirm" | "select" | "input";
}

type UiTarget = Omit<ApprovalTarget, "sessionId" | "runId" | "approvalId" | "outcome" | "expectedVersion"> & {
  readonly requestId: string;
  readonly valueKind: ChannelUiRequestRecord["valueKind"];
  readonly ttlMs: number;
  readonly now?: string;
};

function asUiRecord(value: unknown): ChannelUiRequestRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const r = value as Partial<ChannelUiRequestRecord>;
  if (
    typeof r.connectionId !== "string" ||
    typeof r.externalConversationId !== "string" ||
    typeof r.externalActorId !== "string" ||
    (r.threadId !== undefined && typeof r.threadId !== "string") ||
    typeof r.principalKind !== "string" ||
    typeof r.principalId !== "string" ||
    typeof r.grantRevision !== "string" ||
    typeof r.requestId !== "string" ||
    !["confirm", "select", "input"].includes(r.valueKind ?? "") ||
    (r.state !== "pending" && r.state !== "consumed") ||
    typeof r.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(r.expiresAt))
  )
    return null;
  return r as ChannelUiRequestRecord;
}

export function createChannelUiRequestStore(checkpoints: CheckpointStore) {
  return createControlStore(
    checkpoints,
    "u1",
    asUiRecord,
    (input: UiTarget, now): ChannelUiRequestRecord => ({
      connectionId: input.connectionId,
      externalConversationId: input.externalConversationId,
      externalActorId: input.externalActorId,
      ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
      principalKind: input.identity.principal.kind,
      principalId: input.identity.principal.id,
      grantRevision: input.grantRevision,
      requestId: input.requestId,
      valueKind: input.valueKind,
      state: "pending",
      createdAt: now,
      expiresAt: new Date(Date.parse(now) + input.ttlMs).toISOString(),
    }),
  );
}

function createControlStore<
  T extends ChannelApprovalRecord | ChannelUiRequestRecord,
  I extends { ownership: OwnershipScope; connectionId: string; ttlMs: number; now?: string },
>(checkpoints: CheckpointStore, prefix: string, parse: (value: unknown) => T | null, build: (input: I, now: string) => T) {
  async function load(input: { readonly ownership: OwnershipScope; readonly connectionId: string; readonly token: string }) {
    const stored = await checkpoints.loadCheckpoint({
      namespace: CHANNEL_JOURNAL_NAMESPACES.control,
      key: controlKey(input.ownership, input.connectionId, hash(input.token), prefix),
      ...scopeOf(input.ownership),
    });
    if (stored === null) return null;
    const record = parse(stored.value);
    return record === null || record.connectionId !== input.connectionId ? null : { version: stored.version, record };
  }

  return {
    async create(input: I) {
      const now = input.now ?? new Date().toISOString();
      const token = randomBytes(TOKEN_BYTES).toString("base64url");
      const record = build(input, now);
      await checkpoints.saveCheckpoint({
        namespace: CHANNEL_JOURNAL_NAMESPACES.control,
        key: controlKey(input.ownership, input.connectionId, hash(token), prefix),
        ...scopeOf(input.ownership),
        category: "channel-control",
        expectedVersion: 0,
        version: 1,
        value: record,
      });
      return { token, record };
    },

    load,

    async consume(input: {
      ownership: OwnershipScope;
      connectionId: string;
      token: string;
      expectedVersion: number;
      now?: string;
    }): Promise<"consumed" | "invalid" | "expired" | "already_consumed"> {
      const found = await load(input);
      if (found === null || found.version !== input.expectedVersion) return "invalid";
      if (found.record.state === "consumed") return "already_consumed";
      const now = input.now ?? new Date().toISOString();
      if (Date.parse(found.record.expiresAt) <= Date.parse(now)) return "expired";
      try {
        await checkpoints.saveCheckpoint({
          namespace: CHANNEL_JOURNAL_NAMESPACES.control,
          key: controlKey(input.ownership, input.connectionId, hash(input.token), prefix),
          ...scopeOf(input.ownership),
          category: "channel-control",
          expectedVersion: found.version,
          version: found.version + 1,
          value: { ...found.record, state: "consumed", consumedAt: now },
        });
        return "consumed";
      } catch (error) {
        if (error instanceof Error && error.name === "CheckpointConflictError") return "already_consumed";
        throw error;
      }
    },
  };
}
