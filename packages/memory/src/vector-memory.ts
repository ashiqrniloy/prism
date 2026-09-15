import { assertAccessConstraint, assertAccessGrants, assertAuthorizationTenant, grantAllows, sourceIdFromRecord } from "./acl.js";
import { MemoryScopeError, MemoryValidationError } from "./errors.js";
import { assertInvalidationBatch, assertShareGrant, HARD_LINEAGE_EDGES, recordBlocked } from "./lineage.js";
import { compareMemoryRecord, compareMemoryRecords, decodeMemoryCursor, encodeMemoryCursor } from "./pagination.js";
import { normalizeImportance } from "./scoring.js";
import type {
  MemoryInvalidationRecord,
  MemoryShareGrant,
  MemoryVectorHit,
  MemoryVectorOrder,
  MemoryVectorRecord,
  RagAccessConstraint,
  VectorDeleteFilter,
  VectorQuery,
  VectorStore,
} from "./types.js";
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

interface StoredGrant {
  principalIds: string[];
  groupIds: string[];
  accessVersion: number;
}

type SourceStore = VectorStore & {
  readonly authorization: "acl";
  getByThread(scope: { tenantId: string; resourceId: string; threadId: string }): Promise<readonly MemoryVectorRecord[]>;
  listByThread: NonNullable<VectorStore["listByThread"]>;
  countByThread: NonNullable<VectorStore["countByThread"]>;
  getBySource(
    scope: { tenantId: string; resourceId: string; threadId: string },
    sourceId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<readonly MemoryVectorRecord[]>;
  setSourceAccess: NonNullable<VectorStore["setSourceAccess"]>;
  checkSourceAccess: NonNullable<VectorStore["checkSourceAccess"]>;
  readonly lineage: "invalidation";
  invalidate: NonNullable<VectorStore["invalidate"]>;
  listInvalidated: NonNullable<VectorStore["listInvalidated"]>;
  clearInvalidation: NonNullable<VectorStore["clearInvalidation"]>;
  setShareGrant: NonNullable<VectorStore["setShareGrant"]>;
  getShareGrant: NonNullable<VectorStore["getShareGrant"]>;
};

export function createMemoryVectorStore(options: MemoryVectorStoreOptions = {}): SourceStore & {
  transaction<T>(operation: (store: SourceStore) => Promise<T>, transactionOptions?: { readonly signal?: AbortSignal }): Promise<T>;
} {
  const maxEntryTextChars = options.maxEntryTextChars ?? 64_384;
  const records = new Map<string, MemoryVectorRecord>();
  // Explicit generation pointer per exact scope; set by setCurrentGeneration (rollback/swap).
  const generationPointers = new Map<string, bigint | number>();
  const accessGrants = new Map<string, StoredGrant>();
  const invalidations = new Map<string, MemoryInvalidationRecord>();
  const shareGrants = new Map<string, MemoryShareGrant>();
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

  function grantKey(tenantId: string, resourceId: string, threadId: string, sourceId: string): string {
    return `${tenantId}\u0000${resourceId}\u0000${threadId}\u0000${sourceId}`;
  }

  function invKey(tenantId: string, resourceId: string, threadId: string, id: string): string {
    return `${tenantId}\u0000${resourceId}\u0000${threadId}\u0000${id}`;
  }

  function shareKey(tenantId: string, parentThreadId: string, childThreadId: string): string {
    return `${tenantId}\u0000${parentThreadId}\u0000${childThreadId}`;
  }

  function scopeInvalidations(
    table: Map<string, MemoryInvalidationRecord>,
    tenantId: string,
    resourceId: string,
    threadId: string,
  ): Map<string, MemoryInvalidationRecord> {
    const prefix = `${tenantId}\u0000${resourceId}\u0000${threadId}\u0000`;
    const out = new Map<string, MemoryInvalidationRecord>();
    for (const [key, value] of table) if (key.startsWith(prefix)) out.set(value.id, value);
    return out;
  }

  function idsAllowed(ids: readonly string[] | undefined, id: string): boolean {
    if (!ids) return true;
    if (ids.length === 0) return false;
    if (ids.length > HARD_LINEAGE_EDGES) throw new MemoryValidationError(`query ids exceed hard cap ${HARD_LINEAGE_EDGES}`);
    return ids.includes(id);
  }

  function recordAllowed(
    record: MemoryVectorRecord,
    tenantId: string,
    resourceId: string,
    threadId: string,
    authorization: RagAccessConstraint | undefined,
    grants: Map<string, StoredGrant>,
  ): boolean {
    if (!authorization) return true;
    const sourceId = sourceIdFromRecord(record);
    if (!sourceId) return false;
    const grant = grants.get(grantKey(tenantId, resourceId, threadId, sourceId));
    return grant !== undefined && grantAllows(grant, authorization);
  }

  function createStore(
    target: Map<string, MemoryVectorRecord>,
    pointers: Map<string, bigint | number>,
    grants: Map<string, StoredGrant>,
    invTable: Map<string, MemoryInvalidationRecord>,
    shares: Map<string, MemoryShareGrant>,
  ): SourceStore {
    return {
      authorization: "acl",
      lineage: "invalidation",
      async upsert(input, upsertOptions = {}) {
        assertNotAborted(upsertOptions.signal);
        for (const record of input) {
          requireScope(record, true);
          requireNonEmptyString(record.id, "id");
          assertTextLimit(record.text, maxEntryTextChars, "vector text");
          assertFiniteVector(record.embedding, "embedding");
          if (!Number.isInteger(record.sequence)) throw new MemoryValidationError("sequence must be an integer");
          if (record.generation !== undefined) requireValidGeneration(record.generation);
          const importance = normalizeImportance(record.importance);
          if (
            record.embedderId !== undefined &&
            (typeof record.embedderId !== "string" || record.embedderId.length === 0 || record.embedderId.length > 256)
          ) {
            throw new MemoryValidationError("embedderId must be a non-empty string of at most 256 characters");
          }
          target.set(
            recordKey(record),
            Object.freeze({ ...record, embedding: [...record.embedding], ...(importance !== undefined ? { importance } : {}) }),
          );
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
        const authorization = query.authorization ? assertAccessConstraint(query.authorization) : undefined;
        if (authorization) assertAuthorizationTenant(authorization, scope.tenantId);
        const blocked = scopeInvalidations(invTable, scope.tenantId, scope.resourceId, scope.threadId);
        const hits: MemoryVectorHit[] = [];
        for (const record of target.values()) {
          if (record.tenantId !== scope.tenantId || record.resourceId !== scope.resourceId || record.threadId !== scope.threadId) continue;
          if (record.embedding.length !== query.embedding.length) continue;
          // Generation visibility: legacy rows stay retrievable; generated rows only at the current generation.
          if (currentValue !== undefined && record.generation !== undefined && Number(record.generation) !== currentValue) continue;
          if (!idsAllowed(query.ids, record.id)) continue;
          if (!recordAllowed(record, scope.tenantId, scope.resourceId, scope.threadId, authorization, grants)) continue;
          if (recordBlocked(record, blocked)) continue;
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
              sourceIdFromRecord(record) === sourceId,
          ),
        );
      },

      lexicalModes: ["fts"],

      async lexicalQuery(lexicalQuery) {
        assertNotAborted(lexicalQuery.signal);
        const required = requireScope(lexicalQuery, true) as Required<MemoryVectorRecord>;
        const terms = tokenizeLexical(requireNonEmptyString(lexicalQuery.text, "text"));
        if (terms.size === 0 || lexicalQuery.topK < 1) return [];
        const authorization = lexicalQuery.authorization ? assertAccessConstraint(lexicalQuery.authorization) : undefined;
        if (authorization) assertAuthorizationTenant(authorization, required.tenantId);
        const blocked = scopeInvalidations(invTable, required.tenantId, required.resourceId, required.threadId);
        const scored: MemoryVectorHit[] = [];
        for (const record of target.values()) {
          if (record.tenantId !== required.tenantId || record.resourceId !== required.resourceId || record.threadId !== required.threadId) {
            continue;
          }
          if (!idsAllowed(lexicalQuery.ids, record.id)) continue;
          if (!recordAllowed(record, required.tenantId, required.resourceId, required.threadId, authorization, grants)) continue;
          if (recordBlocked(record, blocked)) continue;
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

      async setSourceAccess(scope, input, accessOptions = {}) {
        assertNotAborted(accessOptions.signal);
        const required = requireScope(scope, true) as Required<MemoryVectorRecord>;
        for (const grant of assertAccessGrants(input)) {
          grants.set(grantKey(required.tenantId, required.resourceId, required.threadId, grant.sourceId), {
            principalIds: [...(grant.principalIds ?? [])],
            groupIds: [...(grant.groupIds ?? [])],
            accessVersion: grant.accessVersion,
          });
        }
      },

      async checkSourceAccess(scope, sourceId, authorization, accessOptions = {}) {
        assertNotAborted(accessOptions.signal);
        const required = requireScope(scope, true) as Required<MemoryVectorRecord>;
        requireNonEmptyString(sourceId, "sourceId");
        const auth = assertAccessConstraint(authorization);
        assertAuthorizationTenant(auth, required.tenantId);
        const grant = grants.get(grantKey(required.tenantId, required.resourceId, required.threadId, sourceId));
        return grant !== undefined && grantAllows(grant, auth);
      },

      async invalidate(scope, entries, invalidateOptions = {}) {
        assertNotAborted(invalidateOptions.signal);
        const required = requireScope(scope, true) as Required<MemoryVectorRecord>;
        for (const entry of assertInvalidationBatch(entries)) {
          const key = invKey(required.tenantId, required.resourceId, required.threadId, entry.id);
          const prior = invTable.get(key);
          const hold = prior?.hold === true || entry.hold === true || entry.reason === "legal_hold";
          const reason = prior?.hold === true || prior?.reason === "legal_hold" ? prior.reason : entry.reason;
          invTable.set(key, Object.freeze({ ...entry, reason, ...(hold ? { hold: true } : {}) }));
        }
      },

      async listInvalidated(scope, listOptions = {}) {
        assertNotAborted(listOptions.signal);
        const required = requireScope(scope, true) as Required<MemoryVectorRecord>;
        return Object.freeze([...scopeInvalidations(invTable, required.tenantId, required.resourceId, required.threadId).values()]);
      },

      async clearInvalidation(scope, ids, clearOptions = {}) {
        assertNotAborted(clearOptions.signal);
        const required = requireScope(scope, true) as Required<MemoryVectorRecord>;
        for (const id of ids) {
          const key = invKey(required.tenantId, required.resourceId, required.threadId, id);
          const prior = invTable.get(key);
          if (!prior || prior.hold === true || prior.reason === "legal_hold") continue;
          invTable.delete(key);
        }
      },

      async setShareGrant(scope, input, shareOptions = {}) {
        assertNotAborted(shareOptions.signal);
        const required = requireScope(scope, true) as Required<MemoryVectorRecord>;
        const grant = assertShareGrant({ ...input, tenantId: required.tenantId, parentThreadId: required.threadId });
        const key = shareKey(grant.tenantId, grant.parentThreadId, grant.childThreadId);
        if (grant.sourceIds.length === 0) shares.delete(key);
        else shares.set(key, grant);
      },

      async getShareGrant(scope, childThreadId, shareOptions = {}) {
        assertNotAborted(shareOptions.signal);
        const required = requireScope(scope, true) as Required<MemoryVectorRecord>;
        return shares.get(shareKey(required.tenantId, required.threadId, requireNonEmptyString(childThreadId, "childThreadId")));
      },
    };
  }

  const store = createStore(records, generationPointers, accessGrants, invalidations, shareGrants);
  return {
    ...store,
    async transaction(operation, transactionOptions = {}) {
      assertNotAborted(transactionOptions.signal);
      const staged = new Map(records);
      const stagedPointers = new Map(generationPointers);
      const stagedGrants = new Map<string, StoredGrant>();
      for (const [key, grant] of accessGrants) {
        stagedGrants.set(key, {
          principalIds: [...grant.principalIds],
          groupIds: [...grant.groupIds],
          accessVersion: grant.accessVersion,
        });
      }
      const stagedInv = new Map(invalidations);
      const stagedShares = new Map(shareGrants);
      const result = await operation(createStore(staged, stagedPointers, stagedGrants, stagedInv, stagedShares));
      assertNotAborted(transactionOptions.signal);
      records.clear();
      for (const [key, record] of staged) records.set(key, record);
      generationPointers.clear();
      for (const [key, value] of stagedPointers) generationPointers.set(key, value);
      accessGrants.clear();
      for (const [key, grant] of stagedGrants) accessGrants.set(key, grant);
      invalidations.clear();
      for (const [key, value] of stagedInv) invalidations.set(key, value);
      shareGrants.clear();
      for (const [key, value] of stagedShares) shareGrants.set(key, value);
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
