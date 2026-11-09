import { type ContextDraft, type HookContext, type HookRegistrar, type JsonObject, resolveRedactor } from "@arnilo/prism";
import type {
  CreateMemoryOptions,
  ExportMemoryOptions,
  Memory,
  MemoryConsent,
  MemoryConsentInput,
  MemoryContextProviderOptions,
  MemoryDirectoryQuery,
  MemoryEntryInput,
  MemoryExportResult,
  MemoryInvalidationReason,
  MemoryInvalidationRecord,
  MemoryRetentionPolicy,
  MemoryRetentionResult,
  MemoryScope,
  MemoryTagCount,
  MemoryTopTagsQuery,
  MemoryVectorHit,
  MemoryVectorRecord,
  RebuildIndexOptions,
  RebuildIndexResult,
  RecallOptions,
  RecallResult,
  RememberInput,
  RememberOptions,
  RememberResult,
} from "@arnilo/prism-memory-core";
import {
  assertFiniteVector,
  assertNotAborted,
  assertSameScope,
  assertTextLimit,
  byteLengthOfJson,
  collectInvalidationIds,
  createMemoryVectorStore,
  DEFAULT_MEMORY_RETENTION_BATCH,
  deriveEntryImportance,
  embedBatched,
  explainRecord,
  fuseRankings,
  HARD_INVALIDATION_BATCH,
  HARD_MEMORY_RETENTION_BATCH_CAP,
  indexInvalidations,
  MemoryAbortError,
  MemoryLimitError,
  MemoryScopeError,
  MemoryValidationError,
  RECALL_OVERSAMPLE,
  recordBlocked,
  redactJson,
  requireNonEmptyString,
  requireScope,
  rerankRecallHits,
  resolveMemoryLimits,
  resolveRecallScoring,
  selectAdjacentRecords,
  shareGrantAllows,
  stampLineage,
  toInvalidationEvent,
} from "@arnilo/prism-memory-core";
import { createFabricContext } from "./context.js";
import { createLongTermMemory } from "./create.js";
import { noteMemoryRetraction, noteMemoryWrite } from "./directory.js";
import { registerMemoryFabricContext } from "./provider.js";
import { parseMemoryNoteMetadata } from "./types.js";

export function createMemory(options: CreateMemoryOptions): Memory {
  const scope = requireScope(options);
  const limits = resolveMemoryLimits(options.limits);
  const redactor = resolveRedactor(options.redactor, options.secrets);
  const vectorStore = options.vectorStore ?? createMemoryVectorStore({ maxEntryTextChars: limits.maxEntryTextChars });
  const embedder = options.embedder;
  // The mode is derived here, not per call: an embedder means hybrid, its absence means lexical.
  // A hybrid embedder whose provider has not arrived yet falls back to lexical per call.
  const retrieval: "lexical" | "hybrid" = embedder ? "hybrid" : "lexical";
  const embeddingActive = (): boolean => embedder !== undefined && (embedder.available?.() ?? true);
  if (embedder && embedder.dimensions > limits.maxVectorDimensions) {
    throw new MemoryLimitError(`embedder dimensions exceed cap ${limits.maxVectorDimensions}`);
  }
  if (!embedder && !vectorStore.lexicalQuery) {
    throw new MemoryValidationError("createMemory requires an embedder or a vector store with lexicalQuery");
  }

  function embeddingKey(text: string, metadata?: JsonObject): string {
    const note = parseMemoryNoteMetadata(metadata);
    const key = redactJson(
      [text, ...(note?.keywords ?? []), ...(note?.tags ?? []), note?.context ?? ""].filter(Boolean).join("\n"),
      redactor,
    );
    assertTextLimit(key, limits.maxEntryTextChars, "embedding key");
    return key;
  }

  let sequenceCounter = 0;

  function threadScopeOrThrow(): Required<MemoryScope> {
    if (!scope.threadId) throw new MemoryScopeError("threadId is required for semantic memory operations");
    return scope as Required<MemoryScope>;
  }

  async function loadInvalidations(thread: Required<MemoryScope>, signal?: AbortSignal) {
    if (!vectorStore.listInvalidated) return new Map<string, MemoryInvalidationRecord>();
    return indexInvalidations(await vectorStore.listInvalidated(thread, { signal }));
  }

  async function markInvalidated(
    threadScope: Required<MemoryScope>,
    roots: readonly string[],
    reason: MemoryInvalidationReason,
    markOptions: { hold?: boolean; supersedesId?: string; signal?: AbortSignal } = {},
  ): Promise<readonly string[]> {
    if (vectorStore.lineage !== "invalidation" || !vectorStore.invalidate) {
      return roots;
    }
    const records = vectorStore.getByThread ? await vectorStore.getByThread(threadScope) : [];
    const ids = collectInvalidationIds(records, roots);
    const at = new Date().toISOString();
    const hold = markOptions.hold === true || reason === "legal_hold";
    const markedReason: MemoryInvalidationReason = hold ? "legal_hold" : reason;
    const entries = ids.map((id) => ({
      id,
      reason: markedReason,
      at,
      ...(hold ? { hold: true as const } : {}),
      ...(markOptions.supersedesId ? { supersedesId: markOptions.supersedesId } : {}),
    }));
    noteMemoryRetraction(memory);
    for (let offset = 0; offset < entries.length; offset += HARD_INVALIDATION_BATCH) {
      await vectorStore.invalidate(threadScope, entries.slice(offset, offset + HARD_INVALIDATION_BATCH), {
        signal: markOptions.signal,
      });
      noteMemoryRetraction(memory);
    }
    await options.onInvalidate?.(toInvalidationEvent(markedReason, ids, hold));
    return ids;
  }

  async function indexEntries(entries: readonly MemoryEntryInput[], signal?: AbortSignal): Promise<void> {
    const threadScope = threadScopeOrThrow();
    assertNotAborted(signal);
    if (entries.length === 0) return;

    for (const entry of entries) {
      requireNonEmptyString(entry.id, "entry.id");
      requireNonEmptyString(entry.text, "entry.text");
      assertTextLimit(entry.text, limits.maxEntryTextChars, "entry.text");
    }

    const texts = entries.map((entry) => redactJson(entry.text, redactor));
    const vectors = embeddingActive()
      ? await embedBatched(
          embedder!,
          entries.map((entry, index) => embeddingKey(texts[index]!, entry.metadata)),
          limits.embedBatchSize,
          {
            signal,
            maxDimensions: limits.maxVectorDimensions,
          },
        )
      : entries.map(() => [] as readonly number[]);

    const records: MemoryVectorRecord[] = entries.map((entry, index) => {
      const sequence = entry.sequence ?? ++sequenceCounter;
      if (entry.sequence !== undefined) sequenceCounter = Math.max(sequenceCounter, entry.sequence);
      const metadata = stampLineage(entry.metadata ? redactJson(entry.metadata, redactor) : undefined, entry.lineage);
      const createdAt = entry.createdAt ?? new Date().toISOString();
      const importance = deriveEntryImportance(entry, options.importanceFrom, redactor);
      const record: MemoryVectorRecord = {
        id: entry.id,
        tenantId: threadScope.tenantId,
        resourceId: threadScope.resourceId,
        threadId: threadScope.threadId,
        text: texts[index]!,
        embedding: vectors[index]!,
        sequence,
        createdAt,
        consent: normalizeConsent(entry.consent, undefined, createdAt),
        ...(metadata ? { metadata } : {}),
        ...(importance !== undefined ? { importance } : {}),
      };
      const payloadBytes = Buffer.byteLength(JSON.stringify(record), "utf8");
      if (payloadBytes > limits.maxPayloadBytes) {
        throw new MemoryLimitError(`memory entry ${entry.id} exceeds payload byte limit`);
      }
      return record;
    });

    await vectorStore.upsert(records, { signal });
    noteMemoryWrite(memory);
  }

  async function remember(input: RememberInput, rememberOptions: RememberOptions = {}): Promise<RememberResult> {
    if (!Array.isArray(input.entries)) throw new MemoryValidationError("entries must be an array");
    const wait = rememberOptions.wait === true;
    const done = indexEntries(input.entries, rememberOptions.signal);
    if (wait) {
      await done;
      return { accepted: input.entries.length, pending: false, done };
    }
    void done.catch(() => undefined);
    return { accepted: input.entries.length, pending: true, done };
  }

  async function recall(query: string, recallOptions: RecallOptions = {}): Promise<RecallResult> {
    const threadScope = threadScopeOrThrow();
    assertNotAborted(recallOptions.signal);
    const q = requireNonEmptyString(query, "query");
    const floor = recallOptions.minSimilarity;
    if (floor !== undefined && (!Number.isFinite(floor) || floor < -1 || floor > 1))
      throw new MemoryValidationError("minSimilarity must be in [-1,1]");
    const boundedTopK = resolveMemoryLimits({
      topK: recallOptions.topK ?? limits.topK,
    }).topK;
    const boundedRange = resolveMemoryLimits({
      messageRange: recallOptions.messageRange ?? limits.messageRange,
    }).messageRange;

    const embedding = embeddingActive()
      ? (
          await embedBatched(embedder!, [redactJson(q, redactor)], limits.embedBatchSize, {
            signal: recallOptions.signal,
            maxDimensions: limits.maxVectorDimensions,
          })
        )[0]
      : undefined;
    const lexicalOnly = embedding === undefined;

    // Composite scoring: fetch an oversized candidate batch, blend in-TS, cut to topK.
    // The same pure re-rank serves the postgres path, keeping adapter orderings in parity.
    const scoring = resolveRecallScoring(recallOptions.scoring);
    const fetchK = scoring ? boundedTopK * RECALL_OVERSAMPLE : boundedTopK;
    const fetchLeg = async (scope: Required<MemoryScope>, ids?: readonly string[]): Promise<readonly MemoryVectorHit[]> =>
      lexicalOnly
        ? vectorStore.lexicalQuery!({
            ...scope,
            text: q,
            topK: fetchK,
            ...(ids === undefined ? {} : { ids }),
            signal: recallOptions.signal,
          })
        : vectorStore.query({
            ...scope,
            embedding: embedding!,
            topK: fetchK,
            ...(ids === undefined ? {} : { ids }),
            signal: recallOptions.signal,
          });
    let candidates = [...(await fetchLeg(threadScope))];
    let parentInv: ReadonlyMap<string, MemoryInvalidationRecord> = new Map();
    if (recallOptions.shareFromParentThreadId) {
      if (!vectorStore.getShareGrant) throw new MemoryScopeError("vector store does not support share grants");
      const parentThreadId = requireNonEmptyString(recallOptions.shareFromParentThreadId, "shareFromParentThreadId");
      const grant = await vectorStore.getShareGrant({ ...threadScope, threadId: parentThreadId }, threadScope.threadId, {
        signal: recallOptions.signal,
      });
      if (!grant) throw new MemoryScopeError("no share grant for parent thread");
      if (grant.expiresAt !== undefined && Date.now() >= Date.parse(grant.expiresAt)) {
        throw new MemoryValidationError("share grant expired");
      }
      if (!shareGrantAllows(grant, { tenantId: threadScope.tenantId, childThreadId: threadScope.threadId })) {
        throw new MemoryScopeError("share grant does not allow this child");
      }
      const parentHits = await fetchLeg({ ...threadScope, threadId: parentThreadId }, [...grant.sourceIds]);
      parentInv = await loadInvalidations({ ...threadScope, threadId: parentThreadId }, recallOptions.signal);
      candidates = [...candidates, ...parentHits];
    }
    const hitKey = (hit: MemoryVectorHit) => `${hit.threadId}\0${hit.id}`;
    if (lexicalOnly) {
      // Lexical-only: the store's coverage is the [0,1] similarity, and store order breaks ties.
      candidates = candidates.map((hit) => ({ ...hit, score: hit.coverage ?? hit.score, retrieval: "lexical" as const }));
      if (floor !== undefined) candidates = candidates.filter((hit) => hit.score >= floor);
    } else {
      const lexical = vectorStore.lexicalQuery
        ? await vectorStore.lexicalQuery({ ...threadScope, text: q, topK: fetchK, signal: recallOptions.signal })
        : [];
      const vectorScores = new Map(candidates.map((hit) => [hitKey(hit), hit.score]));
      const vectors = candidates
        .filter((hit) => floor === undefined || hit.score >= floor)
        .map((hit) => ({ ...hit, similarity: hit.score }));
      const words = lexical.filter((hit) => {
        const cosine = vectorScores.get(hitKey(hit));
        if (cosine !== undefined) return floor === undefined || cosine >= floor;
        return (hit.coverage ?? 0) > 0;
      });
      candidates = fuseRankings([
        { hits: vectors, leg: "vector" },
        { hits: words, leg: "lexical" },
      ]).map(({ hit, score, retrieval }) => ({ ...hit, score, retrieval }));
    }
    const components = new Map(candidates.map((hit) => [hitKey(hit), hit.similarity]));
    const ranked = (
      scoring
        ? rerankRecallHits(candidates, scoring).map((hit) => {
            if (lexicalOnly) return hit;
            const { similarity: _rrf, ...rest } = hit;
            const similarity = components.get(hitKey(hit));
            return similarity === undefined ? rest : { ...rest, similarity };
          })
        : candidates
    ).slice(0, boundedTopK);

    let adjacent: MemoryVectorRecord[] = [];
    if (boundedRange > 0) {
      const threadRecords = vectorStore.getByThread ? await vectorStore.getByThread(threadScope) : ranked;
      adjacent = selectAdjacentRecords(threadRecords, ranked, boundedRange);
    }

    const strict = recallOptions.requireConsent ?? options.requireConsent ?? false;
    const ownInv = await loadInvalidations(threadScope, recallOptions.signal);
    const visibleHits = ranked.filter((hit) => {
      const inv = hit.threadId === threadScope.threadId ? ownInv : parentInv;
      return !recordBlocked(hit, inv) && isInjectable(hit, strict);
    });
    const visibleAdjacent = adjacent.filter((record) => !recordBlocked(record, ownInv) && isInjectable(record, strict));
    const redactedHits = visibleHits.map((hit) => redactJson(hit, redactor));
    const redactedAdjacent = visibleAdjacent.map((record) => redactJson(record, redactor));
    if (!recallOptions.explain) return { hits: redactedHits, adjacent: redactedAdjacent };
    return {
      hits: redactedHits,
      adjacent: redactedAdjacent,
      explanations: visibleHits.map((hit) => {
        const inv = hit.threadId === threadScope.threadId ? ownInv : parentInv;
        return explainRecord(hit, inv.get(hit.id));
      }),
    };
  }

  async function findEntry(threadScope: Required<MemoryScope>, id: string): Promise<MemoryVectorRecord | undefined> {
    if (!vectorStore.getByThread) {
      throw new MemoryScopeError("operation requires a getByThread-capable vector store");
    }
    const records = await vectorStore.getByThread(threadScope);
    return records.find((record) => record.id === id);
  }

  async function get(ids: readonly string[], getOptions: { readonly signal?: AbortSignal } = {}): Promise<readonly MemoryVectorRecord[]> {
    const scope = threadScopeOrThrow();
    assertNotAborted(getOptions.signal);
    if (ids.length > 1000) throw new MemoryLimitError("get ids exceeds 1000");
    const selected = [...new Set(ids.map((id) => requireNonEmptyString(id, "entryId")))];
    if (!selected.length) return [];
    if (!vectorStore.getByIds) throw new MemoryScopeError("operation requires a getByIds-capable vector store");
    const records = await vectorStore.getByIds(scope, selected, getOptions);
    const invalidations = await loadInvalidations(scope, getOptions.signal);
    return records
      .filter(
        (record) =>
          record.tenantId === scope.tenantId &&
          record.resourceId === scope.resourceId &&
          record.threadId === scope.threadId &&
          selected.includes(record.id) &&
          !recordBlocked(record, invalidations) &&
          isInjectable(record, options.requireConsent ?? false),
      )
      .map((record) => redactJson(record, redactor));
  }

  async function countByKind(query: MemoryDirectoryQuery = {}): Promise<Readonly<Record<string, number>>> {
    const threadScope = threadScopeOrThrow();
    assertNotAborted(query.signal);
    if (!vectorStore.countByKind) throw new MemoryScopeError("operation requires a countByKind-capable vector store");
    return vectorStore.countByKind(threadScope, query);
  }

  async function topTags(query: MemoryTopTagsQuery = {}): Promise<readonly MemoryTagCount[]> {
    const threadScope = threadScopeOrThrow();
    assertNotAborted(query.signal);
    if (!vectorStore.topTags) throw new MemoryScopeError("operation requires a topTags-capable vector store");
    return vectorStore.topTags(threadScope, query);
  }

  async function touch(ids: readonly string[], touchOptions: { readonly signal?: AbortSignal } = {}): Promise<void> {
    const threadScope = threadScopeOrThrow();
    assertNotAborted(touchOptions.signal);
    const selected = new Set(ids.map((id) => requireNonEmptyString(id, "entryId")));
    if (selected.size === 0) return;
    if (!vectorStore.getByThread) throw new MemoryScopeError("operation requires a getByThread-capable vector store");
    const records = await vectorStore.getByThread(threadScope);
    const invalidations = await loadInvalidations(threadScope, touchOptions.signal);
    const lastAccessedAt = new Date().toISOString();
    const updates = records
      .filter((record) => selected.has(record.id) && record.consent?.visible !== false && !recordBlocked(record, invalidations))
      .map((record) => ({ ...record, lastAccessedAt }));
    if (updates.length > 0) await vectorStore.upsert(updates, { signal: touchOptions.signal });
  }

  async function patchMetadata(
    entryId: string,
    mutate: (metadata: JsonObject) => JsonObject,
    patchOptions: { readonly signal?: AbortSignal } = {},
  ): Promise<boolean> {
    const threadScope = threadScopeOrThrow();
    assertNotAborted(patchOptions.signal);
    const id = requireNonEmptyString(entryId, "entryId");
    const existing = await findEntry(threadScope, id);
    const invalidations = await loadInvalidations(threadScope, patchOptions.signal);
    if (!existing || existing.consent?.visible === false || recordBlocked(existing, invalidations)) return false;
    const previous = parseMemoryNoteMetadata(existing.metadata);
    const wasActive =
      previous !== undefined && (existing.metadata?.status ?? "verified") === "verified" && (previous.flags?.length ?? 0) === 0;
    const metadata = mutate(existing.metadata ?? {});
    const note = parseMemoryNoteMetadata(metadata);
    // Lifecycle/evidence patches stay additive; removals and unparseable replacements fail closed.
    const retracts =
      wasActive &&
      ((metadata.status ?? "verified") !== "verified" ||
        note === undefined ||
        note.validTo !== previous?.validTo ||
        (note.flags?.length ?? 0) > 0);
    try {
      await vectorStore.upsert([{ ...existing, metadata }], { signal: patchOptions.signal });
    } finally {
      if (retracts) noteMemoryRetraction(memory);
    }
    noteMemoryWrite(memory);
    return true;
  }

  async function setConsent(
    entryId: string,
    consentInput: MemoryConsentInput,
    consentOptions: { signal?: AbortSignal } = {},
  ): Promise<MemoryVectorRecord> {
    const threadScope = threadScopeOrThrow();
    assertNotAborted(consentOptions.signal);
    const id = requireNonEmptyString(entryId, "entryId");
    const existing = await findEntry(threadScope, id);
    if (!existing) throw new MemoryValidationError(`memory entry ${id} not found`);
    const updated: MemoryVectorRecord = {
      ...existing,
      consent: normalizeConsent(consentInput, existing.consent, new Date().toISOString()),
    };
    try {
      await vectorStore.upsert([updated], { signal: consentOptions.signal });
    } finally {
      if (updated.consent?.visible === false) noteMemoryRetraction(memory);
    }
    noteMemoryWrite(memory);
    if (updated.consent?.visible === false) {
      // Revocation blocks recall but is not a legal hold: an explicit forget must still be able to purge it.
      await markInvalidated(threadScope, [id], "revoked", { signal: consentOptions.signal });
    } else if (existing.consent?.visible === false && vectorStore.clearInvalidation) {
      // Un-revoke only restores what revocation itself blocked; a corrected/forgotten invalidation must survive.
      await vectorStore.clearInvalidation(threadScope, [id], { signal: consentOptions.signal });
    }
    noteMemoryWrite(memory);
    return redactJson(updated, redactor);
  }

  async function getEntry(entryId: string, options: { readonly signal?: AbortSignal } = {}): Promise<MemoryVectorRecord | undefined> {
    const threadScope = threadScopeOrThrow();
    assertNotAborted(options.signal);
    const id = requireNonEmptyString(entryId, "entryId");
    const existing = await findEntry(threadScope, id);
    const invalidations = await loadInvalidations(threadScope, options.signal);
    if (!existing || existing.consent?.visible === false || recordBlocked(existing, invalidations)) return undefined;
    return redactJson(existing, redactor);
  }

  async function correct(entryId: string, text: string, correctOptions: { signal?: AbortSignal } = {}): Promise<MemoryVectorRecord> {
    const threadScope = threadScopeOrThrow();
    assertNotAborted(correctOptions.signal);
    const id = requireNonEmptyString(entryId, "entryId");
    if (typeof text !== "string") throw new MemoryValidationError("text must be a string");
    const nextText = text;
    assertTextLimit(nextText, limits.maxEntryTextChars, "entry.text");
    const existing = await findEntry(threadScope, id);
    if (!existing) throw new MemoryValidationError(`memory entry ${id} not found`);
    const redactedText = redactJson(nextText, redactor);
    const embedding = embeddingActive()
      ? (
          await embedBatched(embedder!, [embeddingKey(redactedText, existing.metadata)], limits.embedBatchSize, {
            signal: correctOptions.signal,
            maxDimensions: limits.maxVectorDimensions,
          })
        )[0]!
      : existing.embedding;
    const updated: MemoryVectorRecord = { ...existing, text: redactedText, embedding };
    const payloadBytes = Buffer.byteLength(JSON.stringify(updated), "utf8");
    if (payloadBytes > limits.maxPayloadBytes) {
      throw new MemoryLimitError(`memory entry ${id} exceeds payload byte limit`);
    }
    try {
      await vectorStore.upsert([updated], { signal: correctOptions.signal });
    } finally {
      noteMemoryRetraction(memory);
    }
    await markInvalidated(threadScope, [id], "corrected", { supersedesId: id, signal: correctOptions.signal });
    noteMemoryWrite(memory);
    return redactJson(updated, redactor);
  }

  async function forget(
    filter: { ids?: readonly string[]; hold?: boolean } = {},
    forgetOptions: { signal?: AbortSignal } = {},
  ): Promise<number> {
    try {
      return await forgetEntries(filter, forgetOptions);
    } finally {
      noteMemoryRetraction(memory);
    }
  }

  /** Remove edges pointing at purged notes, so a later read or export never exposes a dangling id. */
  async function removeDanglingNoteLinks(
    threadScope: Required<MemoryScope>,
    removed: readonly string[],
    signal?: AbortSignal,
  ): Promise<void> {
    if (removed.length === 0 || vectorStore.getByThread === undefined) return;
    const gone = new Set(removed);
    const records = await vectorStore.getByThread(threadScope);
    const updates: MemoryVectorRecord[] = [];
    for (const record of records) {
      const metadata = record.metadata;
      const fabric = metadata?.fabric;
      if (fabric === null || typeof fabric !== "object" || Array.isArray(fabric)) continue;
      const links = (fabric as { readonly links?: unknown }).links;
      if (!Array.isArray(links)) continue;
      const kept = links.filter(
        (link): link is JsonObject =>
          link !== null && typeof link === "object" && !Array.isArray(link) && !gone.has(String((link as { readonly id?: unknown }).id)),
      );
      if (kept.length === links.length) continue;
      const { links: _old, ...rest } = fabric as JsonObject;
      const nextFabric: JsonObject = kept.length === 0 ? rest : { ...rest, links: kept };
      updates.push({ ...record, metadata: { ...(metadata as JsonObject), fabric: nextFabric } });
    }
    if (updates.length === 0) return;
    await vectorStore.upsert(updates, { signal });
    noteMemoryWrite(memory);
  }

  async function forgetEntries(
    filter: { ids?: readonly string[]; hold?: boolean },
    forgetOptions: { signal?: AbortSignal },
  ): Promise<number> {
    const threadScope = threadScopeOrThrow();
    assertNotAborted(forgetOptions.signal);
    const hold = filter.hold === true;
    let roots = filter.ids && filter.ids.length > 0 ? [...filter.ids] : undefined;
    if (!roots) {
      if (!vectorStore.getByThread) {
        return vectorStore.delete({ ...threadScope }, { signal: forgetOptions.signal });
      }
      roots = (await vectorStore.getByThread(threadScope)).map((record) => record.id);
    }
    if (roots.length === 0) return 0;
    const marked = await markInvalidated(threadScope, roots, hold ? "legal_hold" : "forgotten", {
      hold,
      signal: forgetOptions.signal,
    });
    if (hold) return 0;
    const listed = vectorStore.listInvalidated ? await vectorStore.listInvalidated(threadScope, { signal: forgetOptions.signal }) : [];
    const held = new Set(listed.filter((entry) => entry.hold === true || entry.reason === "legal_hold").map((entry) => entry.id));
    const purge = marked.filter((id) => !held.has(id));
    let deleted = 0;
    for (let offset = 0; offset < purge.length; offset += HARD_INVALIDATION_BATCH) {
      deleted += await vectorStore.delete(
        { ...threadScope, ids: purge.slice(offset, offset + HARD_INVALIDATION_BATCH) },
        { signal: forgetOptions.signal },
      );
    }
    await removeDanglingNoteLinks(threadScope, purge, forgetOptions.signal);
    return deleted;
  }

  async function listInvalidated(options: { readonly signal?: AbortSignal } = {}): Promise<readonly MemoryInvalidationRecord[]> {
    const threadScope = threadScopeOrThrow();
    assertNotAborted(options.signal);
    return vectorStore.listInvalidated ? vectorStore.listInvalidated(threadScope, options) : [];
  }

  async function shareWith(
    childThreadId: string,
    sourceIds: readonly string[],
    shareOptions: { expiresAt?: string; signal?: AbortSignal } = {},
  ): Promise<void> {
    const threadScope = threadScopeOrThrow();
    assertNotAborted(shareOptions.signal);
    if (!vectorStore.setShareGrant) throw new MemoryScopeError("vector store does not support share grants");
    await vectorStore.setShareGrant(
      threadScope,
      {
        tenantId: threadScope.tenantId,
        parentThreadId: threadScope.threadId,
        childThreadId,
        sourceIds,
        ...(shareOptions.expiresAt ? { expiresAt: shareOptions.expiresAt } : {}),
      },
      { signal: shareOptions.signal },
    );
  }

  async function revokeShare(childThreadId: string, shareOptions: { signal?: AbortSignal } = {}): Promise<void> {
    await shareWith(childThreadId, [], shareOptions);
  }

  async function applyRetention(
    policy: MemoryRetentionPolicy,
    retentionOptions: { signal?: AbortSignal } = {},
  ): Promise<MemoryRetentionResult> {
    const threadScope = threadScopeOrThrow();
    assertNotAborted(retentionOptions.signal);
    const listByThread = vectorStore.listByThread;
    const countByThread = vectorStore.countByThread;
    if (!listByThread || !countByThread) {
      throw new MemoryScopeError("retention requires listByThread- and countByThread-capable vector storage");
    }
    if (policy.maxAgeDays === undefined && policy.maxEntries === undefined) {
      throw new MemoryValidationError("retention policy requires maxAgeDays or maxEntries");
    }
    if (policy.maxAgeDays !== undefined && (!Number.isFinite(policy.maxAgeDays) || policy.maxAgeDays < 0)) {
      throw new MemoryValidationError("maxAgeDays must be a non-negative number");
    }
    if (policy.maxEntries !== undefined && (!Number.isInteger(policy.maxEntries) || policy.maxEntries < 0)) {
      throw new MemoryValidationError("maxEntries must be a non-negative integer");
    }
    const batchSize = clampRetentionBatch(policy.batchSize);
    const expired = new Set<string>();
    let scanned = 0;
    if (policy.maxAgeDays !== undefined) {
      const page = await listByThread({ ...threadScope, limit: batchSize, order: "createdAt", signal: retentionOptions.signal });
      scanned += page.records.length;
      const cutoff = Date.now() - policy.maxAgeDays * 86_400_000;
      for (const record of page.records) {
        if (Date.parse(record.createdAt) < cutoff) expired.add(record.id);
        else break; // oldest-first page makes later rows ineligible for this sweep.
      }
    }
    if (policy.maxEntries !== undefined && expired.size < batchSize) {
      const overflow = (await countByThread(threadScope, { signal: retentionOptions.signal })) - policy.maxEntries;
      if (overflow > 0) {
        const page = await listByThread({
          ...threadScope,
          limit: Math.min(batchSize - expired.size, overflow),
          order: "sequence",
          signal: retentionOptions.signal,
        });
        scanned += page.records.length;
        for (const record of page.records) expired.add(record.id);
      }
    }
    if (vectorStore.listInvalidated && expired.size > 0) {
      const listed = await vectorStore.listInvalidated(threadScope, { signal: retentionOptions.signal });
      for (const entry of listed) {
        if (entry.hold === true || entry.reason === "legal_hold") expired.delete(entry.id);
      }
    }
    const ids = [...expired];
    let deleted = 0;
    if (ids.length > 0) {
      try {
        deleted = await vectorStore.delete({ ...threadScope, ids }, { signal: retentionOptions.signal });
      } finally {
        noteMemoryRetraction(memory);
      }
    }
    if (deleted > 0) noteMemoryWrite(memory);
    return { deleted, scanned };
  }

  async function exportMemory(exportOptions: ExportMemoryOptions): Promise<MemoryExportResult> {
    const threadScope = threadScopeOrThrow();
    assertNotAborted(exportOptions.signal);
    const identity = requireScope(exportOptions.identity, true) as Required<MemoryScope>;
    assertSameScope(threadScope, identity, "memory export identity");
    if (!vectorStore.listByThread) throw new MemoryScopeError("export requires a listByThread-capable vector store");
    const exportLimits = resolveMemoryLimits({
      exportPageSize: exportOptions.limit ?? limits.exportPageSize,
      maxExportBytes: exportOptions.maxBytes ?? limits.maxExportBytes,
      exportMs: exportOptions.maxMs ?? limits.exportMs,
    });
    if (exportLimits.exportPageSize < 1 || exportLimits.maxExportBytes < 1 || exportLimits.exportMs < 1) {
      throw new MemoryValidationError("memory export limits must be positive");
    }
    const page = await withinDeadline(
      (signal) => vectorStore.listByThread!({ ...threadScope, cursor: exportOptions.cursor, limit: exportLimits.exportPageSize, signal }),
      exportLimits.exportMs,
      exportOptions.signal,
      "memory export",
    );
    // Exports require explicit visible consent even when recall runs in legacy-compatible mode.
    const inv = await loadInvalidations(threadScope, exportOptions.signal);
    const entries = page.records
      .filter((record) => record.consent?.visible === true && !recordBlocked(record, inv))
      .map((record) => {
        if (embeddingActive()) assertFiniteVector(record.embedding, "stored embedding", embedder!.dimensions);
        return redactJson(record, redactor);
      });
    const bytes = byteLengthOfJson(entries);
    if (bytes > exportLimits.maxExportBytes) throw new MemoryLimitError(`memory export exceeds ${exportLimits.maxExportBytes} bytes`);
    return { entries, bytes, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
  }

  async function rebuildIndex(rebuildOptions: RebuildIndexOptions = {}): Promise<RebuildIndexResult> {
    const threadScope = threadScopeOrThrow();
    assertNotAborted(rebuildOptions.signal);
    if (!vectorStore.listByThread) throw new MemoryScopeError("rebuild requires a listByThread-capable vector store");
    const rebuildLimits = resolveMemoryLimits({
      rebuildBatchSize: rebuildOptions.batchSize ?? limits.rebuildBatchSize,
      rebuildMs: rebuildOptions.maxMs ?? limits.rebuildMs,
    });
    if (rebuildLimits.rebuildBatchSize < 1 || rebuildLimits.rebuildMs < 1) {
      throw new MemoryValidationError("memory rebuild limits must be positive");
    }
    const result = await withinDeadline(
      async (signal) => {
        const page = await vectorStore.listByThread!({
          ...threadScope,
          cursor: rebuildOptions.cursor,
          limit: rebuildLimits.rebuildBatchSize,
          signal,
        });
        if (page.records.length === 0) return { rebuilt: 0, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
        if (!embeddingActive()) return { rebuilt: page.records.length, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
        for (const record of page.records) assertFiniteVector(record.embedding, "stored embedding", embedder!.dimensions);
        const embeddings = await embedBatched(
          embedder!,
          page.records.map((record) => embeddingKey(record.text, record.metadata)),
          limits.embedBatchSize,
          {
            signal,
            maxDimensions: limits.maxVectorDimensions,
          },
        );
        await vectorStore.upsert(
          page.records.map((record, index) => ({ ...record, embedding: embeddings[index]! })),
          { signal },
        );
        return { rebuilt: page.records.length, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
      },
      rebuildLimits.rebuildMs,
      rebuildOptions.signal,
      "memory rebuild",
    );
    return result;
  }

  let projection: ReturnType<typeof createFabricContext> | undefined;
  let projectionKey: string | undefined;
  let projectionQuery: MemoryContextProviderOptions["query"];
  function contextBlocks(
    draft: ContextDraft,
    context: HookContext,
    providerOptions: MemoryContextProviderOptions = {},
  ): Promise<ContextDraft> {
    const key = JSON.stringify(providerOptions);
    if (!projection || projectionKey !== key || projectionQuery !== providerOptions.query) {
      projectionKey = key;
      projectionQuery = providerOptions.query;
      projection = createFabricContext(
        memory,
        createLongTermMemory({ memory, consolidate: false }).recall,
        providerOptions.includeSemantic === true ? { topK: providerOptions.topK } : false,
        providerOptions,
      );
    }
    return projection.build(draft, context);
  }

  function registerContextBuild(hooks: HookRegistrar, providerOptions: MemoryContextProviderOptions = {}): void {
    registerMemoryFabricContext(hooks, memory, providerOptions);
  }

  const memory: Memory = {
    scope,
    limits,
    retrieval,
    remember,
    recall,
    touch,
    patchMetadata,
    get,
    countByKind,
    topTags,
    setConsent,
    correct,
    getEntry,
    forget,
    listInvalidated,
    shareWith,
    revokeShare,
    applyRetention,
    exportMemory,
    rebuildIndex,
    contextBlocks,
    registerContextBuild,
  };
  return memory;
}

const CONSENT_SOURCES = new Set(["user", "agent", "system"]);
const CONSENT_SCOPES = new Set(["thread", "profile", "user"]);

function normalizeConsent(input: MemoryConsentInput | undefined, prior: MemoryConsent | undefined, now: string): MemoryConsent {
  const source = input?.source ?? prior?.source ?? "user";
  const scope = input?.scope ?? prior?.scope ?? "thread";
  if (!CONSENT_SOURCES.has(source)) throw new MemoryValidationError(`consent.source must be one of user|agent|system`);
  if (!CONSENT_SCOPES.has(scope)) throw new MemoryValidationError(`consent.scope must be one of thread|profile|user`);
  const visible = input?.visible ?? prior?.visible ?? true;
  return {
    source,
    scope,
    visible,
    grantedAt: visible ? (prior?.grantedAt ?? now) : prior?.grantedAt,
    revokedAt: visible ? undefined : now,
  };
}

/** Injection gate: revoked/invisible entries never enter prompts; strict mode also drops consent-less entries. */
function isInjectable(record: MemoryVectorRecord, requireConsent: boolean): boolean {
  const consent = record.consent;
  if (!consent) return !requireConsent;
  return consent.visible !== false;
}

function clampRetentionBatch(value: number | undefined): number {
  const resolved = value ?? DEFAULT_MEMORY_RETENTION_BATCH;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new MemoryValidationError("retention batchSize must be a positive integer");
  }
  if (resolved > HARD_MEMORY_RETENTION_BATCH_CAP) {
    throw new MemoryLimitError(`retention batchSize exceeds hard cap ${HARD_MEMORY_RETENTION_BATCH_CAP}`);
  }
  return resolved;
}

async function withinDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  maxMs: number,
  signal: AbortSignal | undefined,
  label: string,
): Promise<T> {
  assertNotAborted(signal);
  const controller = new AbortController();
  let rejectAbort: ((error: Error) => void) | undefined;
  const abort = () => {
    controller.abort();
    rejectAbort?.(new MemoryAbortError());
  };
  signal?.addEventListener("abort", abort, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new MemoryLimitError(`${label} exceeded ${maxMs}ms`));
      }, maxMs);
    });
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    return await Promise.race([operation(controller.signal), timedOut, aborted]);
  } finally {
    if (timeout) clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
