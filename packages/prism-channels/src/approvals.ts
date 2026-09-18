// Plan 079 Task 6: opaque, one-use channel controls. Core owns decision validation and CAS;
// this record only binds a short-lived transport token to that core decision.
import { createHash, randomBytes } from "node:crypto";
import type { AgentIdentity, CheckpointStore, OwnershipScope } from "@arnilo/prism";
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
  readonly agentAlias: string;
  readonly definitionRevision: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly approvalId: string;
  readonly expectedVersion: number;
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
  readonly agentAlias: string;
  readonly definitionRevision: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly approvalId: string;
  readonly expectedVersion: number;
  readonly outcome: ChannelApprovalOutcome;
}

interface StoredApproval {
  readonly version: number;
  readonly record: ChannelApprovalRecord;
}

interface ChannelApprovalStore {
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

function controlKey(ownership: OwnershipScope, connectionId: string, tokenHash: string): string {
  return ["a1", connectionId || "-", scopeTag(ownership), tokenHash.slice(0, 40)].join(":");
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
    typeof record.agentAlias !== "string" ||
    typeof record.definitionRevision !== "string" ||
    typeof record.sessionId !== "string" ||
    typeof record.runId !== "string" ||
    typeof record.approvalId !== "string" ||
    typeof record.expectedVersion !== "number" ||
    !Number.isSafeInteger(record.expectedVersion) ||
    record.expectedVersion < 1 ||
    (record.outcome !== "allow_once" && record.outcome !== "reject_once") ||
    (record.state !== "pending" && record.state !== "consumed") ||
    typeof record.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(record.expiresAt))
  ) {
    return null;
  }
  return record as ChannelApprovalRecord;
}

export function createChannelApprovalStore(checkpoints: CheckpointStore): ChannelApprovalStore {
  async function load(input: { readonly ownership: OwnershipScope; readonly connectionId: string; readonly token: string }) {
    const stored = await checkpoints.loadCheckpoint({
      namespace: CHANNEL_JOURNAL_NAMESPACES.control,
      key: controlKey(input.ownership, input.connectionId, hash(input.token)),
      ...scopeOf(input.ownership),
    });
    if (stored === null) return null;
    const record = asRecord(stored.value);
    return record === null || record.connectionId !== input.connectionId ? null : { version: stored.version, record };
  }

  return {
    async create(input) {
      const now = input.now ?? new Date().toISOString();
      const token = randomBytes(TOKEN_BYTES).toString("base64url");
      const record: ChannelApprovalRecord = {
        connectionId: input.connectionId,
        externalConversationId: input.externalConversationId,
        externalActorId: input.externalActorId,
        ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
        principalKind: input.identity.principal.kind,
        principalId: input.identity.principal.id,
        grantRevision: input.grantRevision,
        agentAlias: input.agentAlias,
        definitionRevision: input.definitionRevision,
        sessionId: input.sessionId,
        runId: input.runId,
        approvalId: input.approvalId,
        expectedVersion: input.expectedVersion,
        outcome: input.outcome,
        state: "pending",
        createdAt: now,
        expiresAt: new Date(Date.parse(now) + input.ttlMs).toISOString(),
      };
      await checkpoints.saveCheckpoint({
        namespace: CHANNEL_JOURNAL_NAMESPACES.control,
        key: controlKey(input.ownership, input.connectionId, hash(token)),
        ...scopeOf(input.ownership),
        category: "channel-control",
        expectedVersion: 0,
        version: 1,
        value: record,
      });
      return { token, record };
    },

    load,

    async consume(input) {
      const found = await load(input);
      if (found === null || found.version !== input.expectedVersion) return "invalid";
      if (found.record.state === "consumed") return "already_consumed";
      const now = input.now ?? new Date().toISOString();
      if (Date.parse(found.record.expiresAt) <= Date.parse(now)) return "expired";
      try {
        await checkpoints.saveCheckpoint({
          namespace: CHANNEL_JOURNAL_NAMESPACES.control,
          key: controlKey(input.ownership, input.connectionId, hash(input.token)),
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
