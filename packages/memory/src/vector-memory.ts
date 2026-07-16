import { MemoryScopeError, MemoryValidationError } from "./errors.js";
import {
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
  VectorQuery,
  VectorStore,
} from "./types.js";

export interface MemoryVectorStoreOptions {
  readonly maxEntryTextChars?: number;
}

export function createMemoryVectorStore(options: MemoryVectorStoreOptions = {}): VectorStore & {
  getByThread(scope: { tenantId: string; resourceId: string; threadId: string }): Promise<readonly MemoryVectorRecord[]>;
} {
  const maxEntryTextChars = options.maxEntryTextChars ?? 64_384;
  const records = new Map<string, MemoryVectorRecord>();

  function recordKey(record: Pick<MemoryVectorRecord, "tenantId" | "resourceId" | "threadId" | "id">): string {
    return `${record.tenantId}\0${record.resourceId}\0${record.threadId}\0${record.id}`;
  }

  return {
    async upsert(input, upsertOptions = {}) {
      assertNotAborted(upsertOptions.signal);
      for (const record of input) {
        requireScope(record, true);
        requireNonEmptyString(record.id, "id");
        assertTextLimit(record.text, maxEntryTextChars, "vector text");
        if (!Array.isArray(record.embedding) || record.embedding.length === 0) {
          throw new MemoryValidationError("embedding must be a non-empty number array");
        }
        if (!Number.isInteger(record.sequence)) {
          throw new MemoryValidationError("sequence must be an integer");
        }
        records.set(recordKey(record), Object.freeze({ ...record, embedding: [...record.embedding] }));
      }
    },

    async query(query) {
      assertNotAborted(query.signal);
      const scope = requireScope(query, true) as Required<typeof query>;
      const hits: MemoryVectorHit[] = [];
      for (const record of records.values()) {
        if (
          record.tenantId !== scope.tenantId ||
          record.resourceId !== scope.resourceId ||
          record.threadId !== scope.threadId
        ) {
          continue;
        }
        if (record.embedding.length !== query.embedding.length) continue;
        hits.push({ ...record, score: cosineSimilarity(query.embedding, record.embedding) });
      }
      hits.sort((a, b) => b.score - a.score || a.sequence - b.sequence || a.id.localeCompare(b.id));
      return hits.slice(0, query.topK);
    },

    async delete(filter, deleteOptions = {}) {
      assertNotAborted(deleteOptions.signal);
      const scope = requireScope(filter);
      let removed = 0;
      for (const [key, record] of records) {
        if (record.tenantId !== scope.tenantId || record.resourceId !== scope.resourceId) continue;
        if (scope.threadId !== undefined && record.threadId !== scope.threadId) continue;
        if (filter.ids && !filter.ids.includes(record.id)) continue;
        assertSameScope(scope, record, "vector delete");
        records.delete(key);
        removed += 1;
      }
      return removed;
    },

    async getByThread(scope) {
      const required = requireScope(scope, true) as Required<MemoryVectorRecord>;
      const items = [...records.values()].filter(
        (record) =>
          record.tenantId === required.tenantId &&
          record.resourceId === required.resourceId &&
          record.threadId === required.threadId,
      );
      items.sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
      return items;
    },
  };
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
