// Plan 079 Task 3: restart-safe pairing. A pairing token is returned once, stored only as a
// SHA-256 hash, bound to exact ownership + external ids + grant revision, and consumed by CAS
// so a replay or a concurrent double consume can never bind twice. Confirmation stays in the
// trusted host interface; this store never sends the token anywhere.
import { createHash, randomBytes } from "node:crypto";
import type { CheckpointStore, OwnershipScope } from "@arnilo/prism";
import { CHANNEL_JOURNAL_NAMESPACES } from "./state.js";

/** Review section 6: 5 minutes, host-tightenable, never longer. */
export const DEFAULT_PAIRING_TTL_MS = 5 * 60_000;
export const HARD_PAIRING_TTL_MS = 5 * 60_000;
const TOKEN_BYTES = 32;

export interface ChannelPairingRecord {
  readonly connectionId: string;
  readonly externalConversationId: string;
  readonly externalActorId: string;
  readonly threadId?: string;
  readonly agentAlias: string;
  readonly grantRevision: string;
  readonly state: "pending" | "consumed";
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly consumedAt?: string;
}

export interface CreateChannelPairingInput extends OwnershipScope {
  readonly connectionId: string;
  readonly externalConversationId: string;
  readonly externalActorId: string;
  readonly threadId?: string;
  readonly agentAlias: string;
  readonly grantRevision: string;
  readonly ttlMs?: number;
  readonly now?: string;
}

export interface ChannelPairingGrant {
  /** Returned exactly once; the store keeps only its hash. */
  readonly token: string;
  readonly expiresAt: string;
  /** The binding target the host applies after an authorized confirmation. */
  readonly target: ChannelPairingRecord;
}

export interface ConsumeChannelPairingInput extends OwnershipScope {
  readonly connectionId: string;
  readonly token: string;
  readonly now?: string;
}

export type ChannelPairingConsumption =
  | { readonly status: "consumed"; readonly target: ChannelPairingRecord }
  | { readonly status: "invalid" | "expired" | "already_consumed" };

export interface ChannelPairingStore {
  create(input: CreateChannelPairingInput): Promise<ChannelPairingGrant>;
  /** One-use: exactly one caller observes `consumed`; replay observes `already_consumed`. */
  consume(input: ConsumeChannelPairingInput): Promise<ChannelPairingConsumption>;
}

export interface ChannelPairingStoreOptions {
  readonly checkpoints: CheckpointStore;
}

function scopeTag(ownership: OwnershipScope): string {
  return `${ownership.tenantId ?? "-"}:${ownership.accountId ?? "-"}:${ownership.userId ?? "-"}`;
}

function scopeOf(ownership: OwnershipScope): OwnershipScope {
  return {
    ...(ownership.tenantId === undefined ? {} : { tenantId: ownership.tenantId }),
    ...(ownership.accountId === undefined ? {} : { accountId: ownership.accountId }),
    ...(ownership.userId === undefined ? {} : { userId: ownership.userId }),
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function pairingKey(ownership: OwnershipScope, connectionId: string, tokenHash: string): string {
  return ["p1", connectionId || "-", scopeTag(ownership), tokenHash.slice(0, 40)].join(":");
}

export function createChannelPairingStore(options: ChannelPairingStoreOptions): ChannelPairingStore {
  const { checkpoints } = options;

  async function load(ownership: OwnershipScope, connectionId: string, token: string) {
    const tokenHash = hashToken(token);
    const stored = await checkpoints.loadCheckpoint({
      namespace: CHANNEL_JOURNAL_NAMESPACES.control,
      key: pairingKey(ownership, connectionId, tokenHash),
      ...scopeOf(ownership),
    });
    if (stored === null) return null;
    const record = stored.value as ChannelPairingRecord;
    if (record.connectionId !== connectionId) return null;
    return { version: stored.version, record, tokenHash };
  }

  return {
    async create(input) {
      const ttl = Math.min(Math.max(1_000, input.ttlMs ?? DEFAULT_PAIRING_TTL_MS), HARD_PAIRING_TTL_MS);
      const now = input.now ?? new Date().toISOString();
      const token = randomBytes(TOKEN_BYTES).toString("base64url");
      const record: ChannelPairingRecord = {
        connectionId: input.connectionId,
        externalConversationId: input.externalConversationId,
        externalActorId: input.externalActorId,
        ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
        agentAlias: input.agentAlias,
        grantRevision: input.grantRevision,
        state: "pending",
        createdAt: now,
        expiresAt: new Date(Date.parse(now) + ttl).toISOString(),
      };
      await checkpoints.saveCheckpoint({
        namespace: CHANNEL_JOURNAL_NAMESPACES.control,
        key: pairingKey(input, input.connectionId, hashToken(token)),
        ...scopeOf(input),
        category: "channel-control",
        expectedVersion: 0,
        version: 1,
        value: record,
      });
      return { token, expiresAt: record.expiresAt, target: record };
    },

    async consume(input) {
      const found = await load(input, input.connectionId, input.token);
      if (found === null) return { status: "invalid" };
      if (found.record.state === "consumed") return { status: "already_consumed" };
      const now = input.now ?? new Date().toISOString();
      if (Date.parse(found.record.expiresAt) <= Date.parse(now)) return { status: "expired" };
      const consumed: ChannelPairingRecord = {
        ...found.record,
        state: "consumed",
        consumedAt: now,
      };
      try {
        const saved = await checkpoints.saveCheckpoint({
          namespace: CHANNEL_JOURNAL_NAMESPACES.control,
          key: pairingKey(input, input.connectionId, found.tokenHash),
          ...scopeOf(input),
          category: "channel-control",
          expectedVersion: found.version,
          version: found.version + 1,
          value: consumed,
        });
        return { status: "consumed", target: saved.value as ChannelPairingRecord };
      } catch (error) {
        if (error instanceof Error && error.name === "CheckpointConflictError") return { status: "already_consumed" };
        throw error;
      }
    },
  };
}
