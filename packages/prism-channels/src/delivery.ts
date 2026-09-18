// Plan 079 Task 3: reply journal. A reply is persisted before `deliver` is called, so a crash
// between the run and the send never reruns model/tool work and never loses the answer. A
// `deliver` throw is ambiguous (`delivery_unknown`), a returned failure is `delivery_failed`;
// neither state is resent automatically — only an authorized `reconcile` call resends.
import type { CheckpointStore, OwnershipScope } from "@arnilo/prism";
import { CHANNEL_JOURNAL_NAMESPACES, type StoredChannelRecord } from "./state.js";
import type { ChannelPruneResult, ChannelReplyRecord } from "./types.js";

export interface ChannelReplyKeyInput {
  readonly ownership: OwnershipScope;
  readonly connectionId: string;
  readonly operationId: string;
}

export interface ChannelDeliveryJournal {
  load(input: ChannelReplyKeyInput): Promise<StoredChannelRecord<ChannelReplyRecord> | null>;
  /** `null` when a reply for this operation already exists; never overwrites a staged reply. */
  stage(input: ChannelReplyKeyInput, record: ChannelReplyRecord): Promise<StoredChannelRecord<ChannelReplyRecord> | null>;
  /** `null` on CAS conflict; the caller keeps the previous durable state. */
  mark(
    input: ChannelReplyKeyInput,
    record: ChannelReplyRecord,
    expectedVersion: number,
    fencingToken?: number,
  ): Promise<StoredChannelRecord<ChannelReplyRecord> | null>;
}

export interface ChannelDeliveryJournalOptions {
  readonly checkpoints: CheckpointStore;
  readonly maxJournalRecordBytes: number;
}

/** Reply states that are settled and therefore eligible for retention-based deletion. */
export function isSettledReply(record: ChannelReplyRecord): boolean {
  return record.state === "delivered" || record.state === "delivery_failed";
}

export function emptyPruneResult(): ChannelPruneResult {
  return { scanned: 0, deleted: 0, retained: 0 };
}

function scopeTag(ownership: OwnershipScope): string {
  return `${ownership.tenantId ?? "-"}:${ownership.accountId ?? "-"}:${ownership.userId ?? "-"}`;
}

function replyKey(input: ChannelReplyKeyInput): string {
  return ["r1", input.connectionId || "-", scopeTag(input.ownership), input.operationId].join(":");
}

function scopeOf(ownership: OwnershipScope): OwnershipScope {
  return {
    ...(ownership.tenantId === undefined ? {} : { tenantId: ownership.tenantId }),
    ...(ownership.accountId === undefined ? {} : { accountId: ownership.accountId }),
    ...(ownership.userId === undefined ? {} : { userId: ownership.userId }),
  };
}

function asReplyRecord(value: unknown): ChannelReplyRecord {
  if (typeof value !== "object" || value === null || typeof (value as ChannelReplyRecord).text !== "string") {
    throw new TypeError("Channel reply record is corrupt");
  }
  return value as ChannelReplyRecord;
}

export function createChannelDeliveryJournal(options: ChannelDeliveryJournalOptions): ChannelDeliveryJournal {
  const { checkpoints } = options;
  const maxBytes = Math.max(1024, options.maxJournalRecordBytes);

  async function save(
    input: ChannelReplyKeyInput,
    record: ChannelReplyRecord,
    expectedVersion: number,
    fencingToken?: number,
  ): Promise<StoredChannelRecord<ChannelReplyRecord> | null> {
    const value = JSON.parse(JSON.stringify(record)) as ChannelReplyRecord;
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > maxBytes) {
      throw new RangeError(`Channel reply record exceeds maxJournalRecordBytes (${maxBytes})`);
    }
    try {
      const saved = await checkpoints.saveCheckpoint({
        namespace: CHANNEL_JOURNAL_NAMESPACES.reply,
        key: replyKey(input),
        ...scopeOf(input.ownership),
        category: "channel-reply",
        expectedVersion,
        version: expectedVersion + 1,
        ...(fencingToken === undefined ? {} : { fencingToken }),
        value,
      });
      return { version: saved.version, record: asReplyRecord(saved.value) };
    } catch (error) {
      if (error instanceof Error && error.name === "CheckpointConflictError") return null;
      throw error;
    }
  }

  return {
    async load(input) {
      const stored = await checkpoints.loadCheckpoint({
        namespace: CHANNEL_JOURNAL_NAMESPACES.reply,
        key: replyKey(input),
        ...scopeOf(input.ownership),
      });
      return stored === null ? null : { version: stored.version, record: asReplyRecord(stored.value) };
    },

    async stage(input, record) {
      return save(input, record, 0);
    },

    async mark(input, record, expectedVersion, fencingToken) {
      return save(input, record, expectedVersion, fencingToken);
    },
  };
}
