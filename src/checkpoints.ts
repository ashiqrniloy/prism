import type {
  CheckpointKey,
  CheckpointQuery,
  CheckpointRecord,
  CheckpointSaveInput,
  CheckpointStore,
  OwnershipScope,
} from "./contracts.js";

export const CHECKPOINT_CONFLICT_CODE = "ERR_PRISM_CHECKPOINT_CONFLICT";

export class CheckpointConflictError extends Error {
  readonly code = CHECKPOINT_CONFLICT_CODE;

  constructor(message: string) {
    super(message);
    this.name = "CheckpointConflictError";
  }
}

export interface MemoryCheckpointStoreOptions {
  readonly maxPageSize?: number;
}

/** In-process reference implementation of the generic checkpoint contract. */
export function createMemoryCheckpointStore(
  options: MemoryCheckpointStoreOptions = {},
): CheckpointStore {
  const records = new Map<string, CheckpointRecord>();
  const maxPageSize = Math.max(1, options.maxPageSize ?? 500);

  return {
    async saveCheckpoint(input) {
      throwIfAborted(input.signal);
      assertKey(input);
      if (!Number.isSafeInteger(input.version) || input.version < 1) {
        throw new CheckpointConflictError("Checkpoint version must be a positive safe integer");
      }
      const id = recordKey(input);
      const existing = records.get(id);
      if (existing) assertOwnership(input, existing);
      if (input.expectedVersion !== undefined && input.expectedVersion !== (existing?.version ?? 0)) {
        throw new CheckpointConflictError(`Checkpoint compare-and-swap failed (expected ${input.expectedVersion}, current ${existing?.version ?? 0})`);
      }
      if (existing && input.version <= existing.version) {
        throw new CheckpointConflictError(`Stale checkpoint version ${input.version} (current ${existing.version})`);
      }
      if (existing?.fencingToken !== undefined && (input.fencingToken === undefined || input.fencingToken < existing.fencingToken)) {
        throw new CheckpointConflictError(`Stale checkpoint fencing token ${input.fencingToken ?? "missing"} (current ${existing.fencingToken})`);
      }
      const now = new Date().toISOString();
      const value = cloneJson(input.value, "Checkpoint value");
      const metadata = input.metadata === undefined ? undefined : cloneJson(input.metadata, "Checkpoint metadata") as Readonly<Record<string, unknown>>;
      const record: CheckpointRecord = {
        namespace: input.namespace,
        key: input.key,
        version: input.version,
        ...(input.fencingToken === undefined ? {} : { fencingToken: input.fencingToken }),
        value,
        ...(input.category === undefined ? {} : { category: input.category }),
        ...ownership(input),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        ...(metadata === undefined ? {} : { metadata }),
      };
      records.set(id, record);
      return record;
    },

    async loadCheckpoint(input) {
      throwIfAborted(input.signal);
      assertKey(input);
      const record = records.get(recordKey(input));
      if (!record) return null;
      assertOwnership(input, record);
      return record;
    },

    async listCheckpoints(query: CheckpointQuery = {}) {
      throwIfAborted(query.signal);
      const offset = decodeCursor(query.cursor);
      const limit = Math.min(Math.max(1, query.limit ?? 100), maxPageSize);
      const categories = query.category === undefined
        ? undefined
        : new Set(Array.isArray(query.category) ? query.category : [query.category]);
      const items = [...records.values()]
        .filter((record) => query.namespace === undefined || record.namespace === query.namespace)
        .filter((record) => query.keyPrefix === undefined || record.key.startsWith(query.keyPrefix))
        .filter((record) => categories === undefined || (record.category !== undefined && categories.has(record.category)))
        .filter((record) => ownershipFilterMatches(query, record))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.key.localeCompare(b.key));
      const page = items.slice(offset, offset + limit);
      const next = offset + page.length;
      return {
        items: page,
        ...(next < items.length ? { nextCursor: String(next) } : {}),
      };
    },

    async deleteCheckpoint(input) {
      throwIfAborted(input.signal);
      assertKey(input);
      const id = recordKey(input);
      const record = records.get(id);
      if (!record) return false;
      assertOwnership(input, record);
      return records.delete(id);
    },
  };
}

function recordKey(input: Pick<CheckpointKey, "namespace" | "key">): string {
  return `${input.namespace}\0${input.key}`;
}

function assertKey(input: Pick<CheckpointKey, "namespace" | "key">): void {
  if (!input.namespace || !input.key) throw new CheckpointConflictError("Checkpoint namespace and key are required");
}

function ownership(input: OwnershipScope): OwnershipScope {
  return {
    ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
    ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
    ...(input.userId === undefined ? {} : { userId: input.userId }),
  };
}

function ownershipMatches(expected: OwnershipScope, actual: OwnershipScope): boolean {
  return expected.tenantId === actual.tenantId
    && expected.accountId === actual.accountId
    && expected.userId === actual.userId;
}

function ownershipFilterMatches(expected: OwnershipScope, actual: OwnershipScope): boolean {
  return (expected.tenantId === undefined || expected.tenantId === actual.tenantId)
    && (expected.accountId === undefined || expected.accountId === actual.accountId)
    && (expected.userId === undefined || expected.userId === actual.userId);
}

function assertOwnership(expected: OwnershipScope, actual: OwnershipScope): void {
  if (!ownershipMatches(expected, actual)) {
    throw new CheckpointConflictError("Checkpoint ownership mismatch");
  }
}

function cloneJson(value: unknown, label: string): unknown {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("not JSON serializable");
    return JSON.parse(encoded) as unknown;
  } catch (error) {
    throw new CheckpointConflictError(`${label} must be JSON serializable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function decodeCursor(cursor?: string): number {
  if (cursor === undefined) return 0;
  const value = Number(cursor);
  if (!Number.isSafeInteger(value) || value < 0) throw new CheckpointConflictError("Invalid checkpoint cursor");
  return value;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}
