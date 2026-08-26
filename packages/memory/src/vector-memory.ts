import { MemoryScopeError, MemoryValidationError } from "./errors.js";
import { compareMemoryRecord, compareMemoryRecords, decodeMemoryCursor, encodeMemoryCursor } from "./pagination.js";
import type { MemoryVectorHit, MemoryVectorOrder, MemoryVectorRecord, VectorDeleteFilter, VectorQuery, VectorStore } from "./types.js";
import {
  assertFiniteVector,
  assertNotAborted,
  assertSameScope,
  assertTextLimit,
  cosineSimilarity,
  requireNonEmptyString,
  requireScope,
} from "./util.js";

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
  // Explicit generation pointer per exact scope; set by setCurrentGeneration (rollback/swap).
  const generationPointers = new Map<string, bigint | number>();
  function recordKey(record: Pick<MemoryVectorRecord, "tenantId" | "resourceId" | "threadId" | "id">): string {
    return `${record.tenantId}\0${record.resourceId}\0${record.threadId}\0${record.id}`;
  }

  function maxPresentGeneration(
    target: Map<string, MemoryVectorRecord>,
    tenantId: string,
    resourceId: string,
    threadId: string,
  ): number | undefined {
    let max: number | undefined;
    for (const record of target.values()) {
      if (record.tenantId !== tenantId || record.resourceId !== resourceId || record.threadId !== threadId) continue;
      if (record.generation === undefined) continue;
      const value = Number(record.generation);
      if (max === undefined || value > max) max = value;
    }
    return max;
  }

  function requireValidGeneration(generation: bigint | number): void {
    if (
      !(
        (typeof generation === "number" && Number.isInteger(generation) && generation >= 0) ||
        (typeof generation === "bigint" && generation >= 0)
      )
    ) {
      throw new MemoryValidationError("generation must be a non-negative integer");
    }
  }

  function createStore(target: Map<string, MemoryVectorRecord>, pointers: Map<string, bigint | number>): SourceStore {
    return {
      async upsert(input, upsertOptions = {}) {
        assertNotAborted(upsertOptions.signal);
        for (const record of input) {
          requireScope(record, true);
          requireNonEmptyString(record.id, "id");
          assertTextLimit(record.text, maxEntryTextChars, "vector text");
          assertFiniteVector(record.embedding, "embedding");
          if (!Number.isInteger(record.sequence)) throw new MemoryValidationError("sequence must be an integer");
          if (record.generation !== undefined) requireValidGeneration(record.generation);
          if (
            record.embedderId !== undefined &&
            (typeof record.embedderId !== "string" || record.embedderId.length === 0 || record.embedderId.length > 256)
          ) {
            throw new MemoryValidationError("embedderId must be a non-empty string of at most 256 characters");
          }
          target.set(recordKey(record), Object.freeze({ ...record, embedding: [...record.embedding] }));
        }
      },

      async query(query: VectorQuery) {
        assertNotAborted(query.signal);
        const scope = requireScope(query, true) as Required<typeof query>;
        assertFiniteVector(query.embedding, "query embedding");
        const scopeKey = `${scope.tenantId}\0${scope.resourceId}\0${scope.threadId}`;
        // # ponytail: memory adapter derives current from max present unless explicitly pointed (rollback); durable adapter keeps a real pointer table
        const current = pointers.get(scopeKey) ?? maxPresentGeneration(target, scope.tenantId, scope.resourceId, scope.threadId);
        const currentValue = current === undefined ? undefined : Number(current);
        const hits: MemoryVectorHit[] = [];
        for (const record of target.values()) {
          if (record.tenantId !== scope.tenantId || record.resourceId !== scope.resourceId || record.threadId !== scope.threadId) continue;
          if (record.embedding.length !== query.embedding.length) continue;
          // Generation visibility: legacy rows stay retrievable; generated rows only at the current generation.
          if (currentValue !== undefined && record.generation !== undefined && Number(record.generation) !== currentValue) continue;
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
        return sorted(
          [...target.values()].filter(
            (record) =>
              record.tenantId === required.tenantId && record.resourceId === required.resourceId && record.threadId === required.threadId,
          ),
        );
      },

      async listByThread(query) {
        assertNotAborted(query.signal);
        const required = requireScope(query, true) as Required<MemoryVectorRecord>;
        if (!Number.isInteger(query.limit) || query.limit < 1)
          throw new MemoryValidationError("memory page limit must be a positive integer");
        const order: MemoryVectorOrder = query.order ?? "sequence";
        const cursor = decodeMemoryCursor(query.cursor, order);
        const candidates = [...target.values()]
          .filter(
            (record) =>
              record.tenantId === required.tenantId && record.resourceId === required.resourceId && record.threadId === required.threadId,
          )
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
          if (record.tenantId === required.tenantId && record.resourceId === required.resourceId && record.threadId === required.threadId)
            count += 1;
        }
        return count;
      },

      async getBySource(scope, sourceId, sourceOptions = {}) {
        assertNotAborted(sourceOptions.signal);
        const required = requireScope(scope, true) as Required<MemoryVectorRecord>;
        requireNonEmptyString(sourceId, "sourceId");
        return sorted(
          [...target.values()].filter(
            (record) =>
              record.tenantId === required.tenantId &&
              record.resourceId === required.resourceId &&
              record.threadId === required.threadId &&
              ragSourceId(record) === sourceId,
          ),
        );
      },

      lexicalModes: ["fts"],

      async lexicalQuery(lexicalQuery) {
        assertNotAborted(lexicalQuery.signal);
        const required = requireScope(lexicalQuery, true) as Required<MemoryVectorRecord>;
        const terms = tokenizeLexical(requireNonEmptyString(lexicalQuery.text, "text"));
        if (terms.size === 0 || lexicalQuery.topK < 1) return [];
        const scored: MemoryVectorHit[] = [];
        for (const record of target.values()) {
          if (record.tenantId !== required.tenantId || record.resourceId !== required.resourceId || record.threadId !== required.threadId) {
            continue;
          }
          const recordTerms = tokenizeLexical(record.text);
          let matches = 0;
          for (const term of terms) if (recordTerms.has(term)) matches += 1;
          if (matches === 0) continue;
          scored.push({ ...record, score: matches / terms.size });
        }
        scored.sort((a, b) => b.score - a.score || a.sequence - b.sequence || a.id.localeCompare(b.id));
        return scored.slice(0, lexicalQuery.topK);
      },

      async getCurrentGeneration(scope) {
        const required = requireScope(scope, true) as Required<MemoryVectorRecord>;
        const key = `${required.tenantId}\0${required.resourceId}\0${required.threadId}`;
        return pointers.get(key) ?? maxPresentGeneration(target, required.tenantId, required.resourceId, required.threadId);
      },

      async setCurrentGeneration(scope, generation) {
        requireValidGeneration(generation);
        const required = requireScope(scope, true) as Required<MemoryVectorRecord>;
        pointers.set(`${required.tenantId}\0${required.resourceId}\0${required.threadId}`, generation);
      },
    };
  }

  const store = createStore(records, generationPointers);
  return {
    ...store,
    async transaction(operation, transactionOptions = {}) {
      assertNotAborted(transactionOptions.signal);
      const staged = new Map(records);
      const stagedPointers = new Map(generationPointers);
      const result = await operation(createStore(staged, stagedPointers));
      assertNotAborted(transactionOptions.signal);
      records.clear();
      for (const [key, record] of staged) records.set(key, record);
      generationPointers.clear();
      for (const [key, value] of stagedPointers) generationPointers.set(key, value);
      return result;
    },
  };
}

/** Lowercase alphanumeric tokens; the shared tokenizer behind the memory store's fts leg. */
export function tokenizeLexical(text: string): Set<string> {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g);
  return new Set((matches ?? []).filter((term) => term.length > 1));
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
