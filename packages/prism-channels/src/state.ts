// Plan 079 Task 3: durable channel journal on the generic `CheckpointStore` (no new SQL schema).
// Commit order is explicit because the store offers single-record CAS only:
// operation save before cursor advance, operation claim before provider work, reply before send.
// Keys embed connection + ownership + external ids so a foreign lookup misses instead of
// colliding (the record key itself is scope-free and a mismatched scope throws).
import type { CheckpointStore, OwnershipScope } from "@arnilo/prism";
import type { ChannelOperationRecord, ChannelOperationState } from "./types.js";

/** Namespaces are versioned so a schema change is a new namespace, never a silent reinterpretation. */
export const CHANNEL_JOURNAL_NAMESPACES = {
  binding: "prism.channels.v1.binding",
  operation: "prism.channels.v1.operation",
  cursor: "prism.channels.v1.cursor",
  reply: "prism.channels.v1.reply",
  control: "prism.channels.v1.control",
} as const;

export type ChannelJournalNamespace = (typeof CHANNEL_JOURNAL_NAMESPACES)[keyof typeof CHANNEL_JOURNAL_NAMESPACES];

const CATEGORY: Readonly<Record<ChannelJournalNamespace, string>> = {
  [CHANNEL_JOURNAL_NAMESPACES.binding]: "channel-binding",
  [CHANNEL_JOURNAL_NAMESPACES.operation]: "channel-operation",
  [CHANNEL_JOURNAL_NAMESPACES.cursor]: "channel-cursor",
  [CHANNEL_JOURNAL_NAMESPACES.reply]: "channel-reply",
  [CHANNEL_JOURNAL_NAMESPACES.control]: "channel-control",
};

/**
 * Operations that still need host attention: a claim that has not settled. A reconciling host
 * resolves these; `execution_unknown`/`abandoned` are filed dead-letters, not open work.
 */
export const UNRESOLVED_OPERATION_STATES: readonly ChannelOperationState[] = ["accepted", "executing"];

/** Durable binding state for one connection + actor + alias; `generation` is `/new`'s counter. */
export interface ChannelBindingRecord {
  readonly sessionId: string;
  readonly leafId?: string;
  readonly agentAlias: string;
  readonly generation: number;
  readonly suspended: boolean;
  /** Durable core correlation for a binding blocked on an approval. */
  readonly suspendedRun?: { readonly operationId: string; readonly runId: string; readonly sessionId: string };
  readonly updatedAt: string;
}

/** Durable intake cursor; advanced only after the operation record is committed. */
export interface ChannelCursorRecord {
  readonly admitted: number;
  readonly lastEventId?: string;
  readonly updatedAt: string;
}

export interface ChannelJournalEntry<T> {
  readonly key: string;
  readonly version: number;
  readonly record: T;
  readonly updatedAt: string;
}

export interface StoredChannelRecord<T> {
  readonly version: number;
  readonly record: T;
  /** Present when the underlying checkpoint was written under a lease fence. */
  readonly fencingToken?: number;
}

export interface ChannelBindingKeyInput {
  readonly ownership: OwnershipScope;
  readonly connectionId: string;
  readonly externalConversationId: string;
  readonly externalActorId: string;
  readonly threadId?: string;
  readonly agentAlias: string;
}

export interface ChannelStateStore {
  list<T>(input: {
    readonly ownership: OwnershipScope;
    readonly namespace: ChannelJournalNamespace;
    readonly limit: number;
  }): Promise<readonly ChannelJournalEntry<T>[]>;
  remove(input: {
    readonly ownership: OwnershipScope;
    readonly namespace: ChannelJournalNamespace;
    readonly key: string;
  }): Promise<boolean>;
  loadBinding(input: ChannelBindingKeyInput): Promise<StoredChannelRecord<ChannelBindingRecord> | null>;
  /** `null` when a record already exists (concurrent create); never overwrites. */
  createBinding(input: ChannelBindingKeyInput, record: ChannelBindingRecord): Promise<StoredChannelRecord<ChannelBindingRecord> | null>;
  /** `null` on CAS conflict; caller re-reads before retrying a state change. */
  saveBinding(
    input: ChannelBindingKeyInput,
    record: ChannelBindingRecord,
    expectedVersion: number,
    fencingToken?: number,
  ): Promise<StoredChannelRecord<ChannelBindingRecord> | null>;
  loadOperation(input: ChannelOperationKeyInput): Promise<StoredChannelRecord<ChannelOperationRecord> | null>;
  /** `null` when this connection + event id was already admitted (durable dedup). */
  createOperation(
    input: ChannelOperationKeyInput,
    record: ChannelOperationRecord,
  ): Promise<StoredChannelRecord<ChannelOperationRecord> | null>;
  saveOperation(
    input: ChannelOperationKeyInput,
    record: ChannelOperationRecord,
    expectedVersion: number,
    fencingToken?: number,
  ): Promise<StoredChannelRecord<ChannelOperationRecord> | null>;
  /** Drop an operation record that never applied an effect (a denial or a failed command). */
  removeOperation(input: ChannelOperationKeyInput): Promise<boolean>;
  /** Read the cursor; used for ordering evidence, never for dedup. */
  loadCursor(input: ChannelCursorKeyInput): Promise<StoredChannelRecord<ChannelCursorRecord> | null>;
  /** Best-effort ordering evidence written after a successful operation save. */
  advanceCursor(input: ChannelCursorKeyInput, lastEventId?: string): Promise<void>;
}

export interface ChannelOperationKeyInput {
  readonly ownership: OwnershipScope;
  readonly connectionId: string;
  /** Derived deterministically from connection + transport event id, so dedup is a keyed CAS create. */
  readonly operationId: string;
}

export interface ChannelCursorKeyInput {
  readonly ownership: OwnershipScope;
  readonly connectionId: string;
}

export interface ChannelStateStoreOptions {
  readonly checkpoints: CheckpointStore;
  /** Per-record value bound enforced before save (store ceilings stay above this). */
  readonly maxJournalRecordBytes: number;
}

function scopeTag(ownership: OwnershipScope): string {
  return `${ownership.tenantId ?? "-"}:${ownership.accountId ?? "-"}:${ownership.userId ?? "-"}`;
}

function keyPart(value: string | undefined): string {
  return value === undefined || value === "" ? "-" : value;
}

function bindingKey(input: ChannelBindingKeyInput): string {
  return [
    "b1",
    keyPart(input.connectionId),
    scopeTag(input.ownership),
    keyPart(input.externalConversationId),
    keyPart(input.threadId),
    keyPart(input.externalActorId),
    keyPart(input.agentAlias),
  ].join(":");
}

function operationKey(input: ChannelOperationKeyInput): string {
  return ["o1", keyPart(input.connectionId), scopeTag(input.ownership), keyPart(input.operationId)].join(":");
}

function cursorKey(input: ChannelCursorKeyInput): string {
  return ["c1", keyPart(input.connectionId), scopeTag(input.ownership)].join(":");
}

function scopeOf(ownership: OwnershipScope): OwnershipScope {
  return {
    ...(ownership.tenantId === undefined ? {} : { tenantId: ownership.tenantId }),
    ...(ownership.accountId === undefined ? {} : { accountId: ownership.accountId }),
    ...(ownership.userId === undefined ? {} : { userId: ownership.userId }),
  };
}

/** Defense in depth: records are stored in the caller's scope, so a foreign read can never match. */
function storedValue<T>(record: T): T {
  return JSON.parse(JSON.stringify(record)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asBindingRecord(value: unknown): ChannelBindingRecord {
  if (
    !isRecord(value) ||
    typeof value.sessionId !== "string" ||
    !Number.isSafeInteger(value.generation) ||
    typeof value.suspended !== "boolean"
  ) {
    throw new TypeError("Channel binding record is corrupt");
  }
  const suspendedRun = value.suspendedRun;
  if (
    suspendedRun !== undefined &&
    (!isRecord(suspendedRun) ||
      typeof suspendedRun.operationId !== "string" ||
      typeof suspendedRun.runId !== "string" ||
      typeof suspendedRun.sessionId !== "string")
  ) {
    throw new TypeError("Channel binding record is corrupt");
  }
  return value as unknown as ChannelBindingRecord;
}

function asOperationRecord(value: unknown): ChannelOperationRecord {
  if (!isRecord(value) || typeof value.operationId !== "string" || typeof value.state !== "string") {
    throw new TypeError("Channel operation record is corrupt");
  }
  return value as unknown as ChannelOperationRecord;
}

function asCursorRecord(value: unknown): ChannelCursorRecord {
  if (!isRecord(value) || typeof value.admitted !== "number") throw new TypeError("Channel cursor record is corrupt");
  return value as unknown as ChannelCursorRecord;
}

export function createChannelStateStore(options: ChannelStateStoreOptions): ChannelStateStore {
  const { checkpoints } = options;
  const maxBytes = Math.max(1024, options.maxJournalRecordBytes);

  async function save<T>(
    namespace: ChannelJournalNamespace,
    ownership: OwnershipScope,
    key: string,
    value: T,
    expectedVersion: number,
    fencingToken?: number,
  ): Promise<StoredChannelRecord<T> | null> {
    const encoded = storedValue(value);
    if (Buffer.byteLength(JSON.stringify(encoded), "utf8") > maxBytes) {
      throw new RangeError(`Channel journal record exceeds maxJournalRecordBytes (${maxBytes})`);
    }
    try {
      const record = await checkpoints.saveCheckpoint({
        namespace,
        key,
        ...scopeOf(ownership),
        category: CATEGORY[namespace],
        expectedVersion,
        version: expectedVersion + 1,
        ...(fencingToken === undefined ? {} : { fencingToken }),
        value: encoded,
      });
      return { version: record.version, record: record.value as T };
    } catch (error) {
      // CAS conflicts are a normal outcome (another worker won); everything else is unavailability.
      if (error instanceof Error && error.name === "CheckpointConflictError") return null;
      throw error;
    }
  }

  async function load<T>(
    namespace: ChannelJournalNamespace,
    ownership: OwnershipScope,
    key: string,
  ): Promise<StoredChannelRecord<T> | null> {
    const record = await checkpoints.loadCheckpoint({ namespace, key, ...scopeOf(ownership) });
    if (record === null) return null;
    return record.fencingToken === undefined
      ? { version: record.version, record: record.value as T }
      : { version: record.version, record: record.value as T, fencingToken: record.fencingToken };
  }

  return {
    async list<T>(input: { ownership: OwnershipScope; namespace: ChannelJournalNamespace; limit: number }) {
      const page = await checkpoints.listCheckpoints({
        namespace: input.namespace,
        ...scopeOf(input.ownership),
        limit: input.limit,
        order: "desc",
      });
      return page.items.map((item) => ({
        key: item.key,
        version: item.version,
        updatedAt: item.updatedAt,
        record: item.value as T,
      }));
    },

    async remove(input) {
      return checkpoints.deleteCheckpoint({ namespace: input.namespace, key: input.key, ...scopeOf(input.ownership) });
    },

    async loadBinding(input) {
      const stored = await load<unknown>(CHANNEL_JOURNAL_NAMESPACES.binding, input.ownership, bindingKey(input));
      return stored === null ? null : { ...stored, record: asBindingRecord(stored.record) };
    },

    async createBinding(input, record) {
      const stored = await save(CHANNEL_JOURNAL_NAMESPACES.binding, input.ownership, bindingKey(input), record, 0);
      return stored === null ? null : { version: stored.version, record: asBindingRecord(stored.record) };
    },

    async saveBinding(input, record, expectedVersion, fencingToken) {
      const stored = await save(
        CHANNEL_JOURNAL_NAMESPACES.binding,
        input.ownership,
        bindingKey(input),
        record,
        expectedVersion,
        fencingToken,
      );
      return stored === null ? null : { version: stored.version, record: asBindingRecord(stored.record) };
    },

    async loadOperation(input) {
      const stored = await load<unknown>(CHANNEL_JOURNAL_NAMESPACES.operation, input.ownership, operationKey(input));
      return stored === null ? null : { ...stored, record: asOperationRecord(stored.record) };
    },

    async createOperation(input, record) {
      const stored = await save(CHANNEL_JOURNAL_NAMESPACES.operation, input.ownership, operationKey(input), record, 0);
      return stored === null ? null : { version: stored.version, record: asOperationRecord(stored.record) };
    },

    async saveOperation(input, record, expectedVersion, fencingToken) {
      const stored = await save(
        CHANNEL_JOURNAL_NAMESPACES.operation,
        input.ownership,
        operationKey(input),
        record,
        expectedVersion,
        fencingToken,
      );
      return stored === null ? null : { version: stored.version, record: asOperationRecord(stored.record) };
    },

    async removeOperation(input) {
      return checkpoints.deleteCheckpoint({
        namespace: CHANNEL_JOURNAL_NAMESPACES.operation,
        key: operationKey(input),
        ...scopeOf(input.ownership),
      });
    },

    async loadCursor(input) {
      const stored = await load<unknown>(CHANNEL_JOURNAL_NAMESPACES.cursor, input.ownership, cursorKey(input));
      return stored === null ? null : { version: stored.version, record: asCursorRecord(stored.record) };
    },

    async advanceCursor(input, lastEventId) {
      const current = await load<unknown>(CHANNEL_JOURNAL_NAMESPACES.cursor, input.ownership, cursorKey(input));
      const previous = current === null ? null : asCursorRecord(current.record);
      const record: ChannelCursorRecord = {
        admitted: (previous?.admitted ?? 0) + 1,
        ...(lastEventId === undefined ? {} : { lastEventId }),
        updatedAt: new Date().toISOString(),
      };
      await save(CHANNEL_JOURNAL_NAMESPACES.cursor, input.ownership, cursorKey(input), record, current?.version ?? 0);
    },
  };
}
