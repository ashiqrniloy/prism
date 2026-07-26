import { MemoryScopeError, MemoryValidationError } from "./errors.js";
import { compareMemoryRecord, compareMemoryRecords, decodeMemoryCursor, encodeMemoryCursor } from "./pagination.js";
import {
  assertFiniteVector,
  assertNotAborted,
  assertSameScope,
  assertTextLimit,
  cosineSimilarity,
  requireNonEmptyString,
  requireScope,
} from "./util.js";
import type {
  MemoryVectorHit,
  MemoryVectorRecord,
  VectorDeleteFilter,
  MemoryVectorOrder,
  VectorQuery,
  VectorStore,
} from "./types.js";

export interface MemoryVectorStoreOptions {
  readonly maxEntryTextChars?: number;
}

type SourceStore = VectorStore & {
  getByThread(scope: { tenantId: string; resourceId: string; threadId: string }): Promise<readonly MemoryVectorRecord[]>;
  listByThread: NonNullable<VectorStore["listByThread"]>;
  countByThread: NonNullable<VectorStore["countByThread"]>;
  getBySource(
    scope: { tenantId: string; resourceId: string; threadId: string },
    sourceId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<readonly MemoryVectorRecord[]>;
};

export function createMemoryVectorStore(options: MemoryVectorStoreOptions = {}): SourceStore & {
  transaction<T>(operation: (store: SourceStore) => Promise<T>, transactionOptions?: { readonly signal?: AbortSignal }): Promise<T>;
} {
  const maxEntryTextChars = options.maxEntryTextChars ?? 64_384;
  const records = new Map<string, MemoryVectorRecord>();

  function recordKey(record: Pick<MemoryVectorRecord, "tenantId" | "resourceId" | "threadId" | "id">): string {
    return `${record.tenantId}\0${record.resourceId}\0${record.threadId}\0${record.id}`;
  }

  function createStore(target: Map<string, MemoryVectorRecord>): SourceStore {
    return {
      async upsert(input, upsertOptions = {}) {
        assertNotAborted(upsertOptions.signal);
        for (const record of input) {
          requireScope(record, true);
          requireNonEmptyString(record.id, "id");
          assertTextLimit(record.text, maxEntryTextChars, "vector text");
          assertFiniteVector(record.embedding, "embedding");
          if (!Number.isInteger(record.sequence)) throw new MemoryValidationError("sequence must be an integer");
          target.set(recordKey(record), Object.freeze({ ...record, embedding: [...record.embedding] }));
        }
      },

      async query(query: VectorQuery) {
        assertNotAborted(query.signal);
        const scope = requireScope(query, true) as Required<typeof query>;
        assertFiniteVector(query.embedding, "query embedding");
        const hits: MemoryVectorHit[] = [];
        for (const record of target.values()) {
          if (record.tenantId !== scope.tenantId || record.resourceId !== scope.resourceId || record.threadId !== scope.threadId) continue;
          if (record.embedding.length !== query.embedding.length) continue;
          hits.push({ ...record, score: cosineSimilarity(query.embedding, record.embedding) });
        }
        hits.sort((a, b) => b.score - a.score || a.sequence - b.sequence || a.id.localeCompare(b.id));
        return hits.slice(0, query.topK);
      },

      async delete(filter: VectorDeleteFilter, deleteOptions = {}) {
        assertNotAborted(deleteOptions.signal);
        const scope = requireScope(filter);
        let removed = 0;
        for (const [key, record] of target) {
          if (record.tenantId !== scope.tenantId || record.resourceId !== scope.resourceId) continue;
          if (scope.threadId !== undefined && record.threadId !== scope.threadId) continue;
          if (filter.ids && !filter.ids.includes(record.id)) continue;
          assertSameScope(scope, record, "vector delete");
          target.delete(key);
          removed += 1;
        }
        return removed;
      },

      async getByThread(scope) {
        const required = requireScope(scope, true) as Required<MemoryVectorRecord>;
        return sorted([...target.values()].filter(
          (record) => record.tenantId === required.tenantId && record.resourceId === required.resourceId && record.threadId === required.threadId,
        ));
      },

      async listByThread(query) {
        assertNotAborted(query.signal);
        const required = requireScope(query, true) as Required<MemoryVectorRecord>;
        if (!Number.isInteger(query.limit) || query.limit < 1) throw new MemoryValidationError("memory page limit must be a positive integer");
        const order: MemoryVectorOrder = query.order ?? "sequence";
        const cursor = decodeMemoryCursor(query.cursor, order);
        const candidates = [...target.values()]
          .filter((record) => record.tenantId === required.tenantId && record.resourceId === required.resourceId && record.threadId === required.threadId)
          .filter((record) => compareMemoryRecord(record, cursor, order) > 0)
          .sort((a, b) => compareMemoryRecords(a, b, order));
        const page = candidates.slice(0, query.limit);
        const last = page.at(-1);
        return {
          records: Object.freeze(page),
          ...(last && candidates.length > page.length ? { nextCursor: encodeMemoryCursor(last, order) } : {}),
        };
      },

      async countByThread(scope, countOptions = {}) {
        assertNotAborted(countOptions.signal);
        const required = requireScope(scope, true) as Required<MemoryVectorRecord>;
        let count = 0;
        for (const record of target.values()) {
          if (record.tenantId === required.tenantId && record.resourceId === required.resourceId && record.threadId === required.threadId) count += 1;
        }
        return count;
      },

      async getBySource(scope, sourceId, sourceOptions = {}) {
        assertNotAborted(sourceOptions.signal);
        const required = requireScope(scope, true) as Required<MemoryVectorRecord>;
        requireNonEmptyString(sourceId, "sourceId");
        return sorted([...target.values()].filter((record) =>
          record.tenantId === required.tenantId
          && record.resourceId === required.resourceId
          && record.threadId === required.threadId
          && ragSourceId(record) === sourceId,
        ));
      },
    };
  }

  const store = createStore(records);
  return {
    ...store,
    async transaction(operation, transactionOptions = {}) {
      assertNotAborted(transactionOptions.signal);
      const staged = new Map(records);
      const result = await operation(createStore(staged));
      assertNotAborted(transactionOptions.signal);
      records.clear();
      for (const [key, record] of staged) records.set(key, record);
      return result;
    },
  };
}

function sorted(records: readonly MemoryVectorRecord[]): readonly MemoryVectorRecord[] {
  return Object.freeze([...records].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id)));
}

function ragSourceId(record: MemoryVectorRecord): string | undefined {
  const rag = record.metadata?._rag;
  return typeof rag === "object" && rag !== null && !Array.isArray(rag) && typeof rag.sourceId === "string" ? rag.sourceId : undefined;
}

export function selectAdjacentRecords(
  threadRecords: readonly MemoryVectorRecord[],
  hits: readonly MemoryVectorHit[],
  messageRange: number,
): MemoryVectorRecord[] {
  if (messageRange <= 0 || hits.length === 0) return [];
  const byId = new Map(threadRecords.map((record) => [record.id, record]));
  const selected = new Map<string, MemoryVectorRecord>();
  for (const hit of hits) {
    for (const record of threadRecords) {
      if (Math.abs(record.sequence - hit.sequence) <= messageRange) {
        if (!byId.has(record.id)) throw new MemoryScopeError("adjacent record missing from thread");
        selected.set(record.id, record);
      }
    }
  }
  for (const hit of hits) selected.delete(hit.id);
  return [...selected.values()].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
}
