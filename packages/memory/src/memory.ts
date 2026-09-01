import { type ContextProvider, type JsonObject, type Message, resolveRedactor } from "@arnilo/prism";
import { embedBatched } from "./embedder.js";
import { MemoryAbortError, MemoryLimitError, MemoryScopeError, MemoryValidationError } from "./errors.js";
import { DEFAULT_MEMORY_RETENTION_BATCH, estimateTokens, HARD_MEMORY_RETENTION_BATCH_CAP, resolveMemoryLimits } from "./limits.js";
import { validateAgainstJsonSchema } from "./schema.js";
import { deriveEntryImportance, RECALL_OVERSAMPLE, rerankRecallHits, resolveRecallScoring } from "./scoring.js";
import type {
  CreateMemoryOptions,
  ExportMemoryOptions,
  Memory,
  MemoryConsent,
  MemoryConsentInput,
  MemoryContextProviderOptions,
  MemoryEntryInput,
  MemoryExportResult,
  MemoryRetentionPolicy,
  MemoryRetentionResult,
  MemoryScope,
  MemoryVectorHit,
  MemoryVectorRecord,
  RebuildIndexOptions,
  RebuildIndexResult,
  RecallOptions,
  RecallResult,
  RememberInput,
  RememberOptions,
  RememberResult,
  WorkingMemoryProcessorOptions,
  WorkingMemoryRecord,
  WorkingMemoryUpdateOptions,
} from "./types.js";
import {
  assertFiniteVector,
  assertNotAborted,
  assertSameScope,
  assertTextLimit,
  byteLengthOfJson,
  latestUserText,
  mergeJsonObjects,
  redactJson,
  renderTemplate,
  requireNonEmptyString,
  requireScope,
} from "./util.js";
import { createMemoryVectorStore, selectAdjacentRecords } from "./vector-memory.js";
import { createMemoryWorkingStore, validateWorkingValue } from "./working-memory.js";

export function createMemory(options: CreateMemoryOptions): Memory {
  const scope = requireScope(options);
  const limits = resolveMemoryLimits(options.limits);
  const redactor = resolveRedactor(options.redactor, options.secrets);
  const vectorStore = options.vectorStore ?? createMemoryVectorStore({ maxEntryTextChars: limits.maxEntryTextChars });
  const workingStore = options.workingStore ?? createMemoryWorkingStore({ maxWorkingMemoryBytes: limits.maxWorkingMemoryBytes });
  const embedder = options.embedder;
  if (embedder.dimensions > limits.maxVectorDimensions) {
    throw new MemoryLimitError(`embedder dimensions exceed cap ${limits.maxVectorDimensions}`);
  }

  let sequenceCounter = 0;

  function threadScopeOrThrow(): Required<MemoryScope> {
    if (!scope.threadId) throw new MemoryScopeError("threadId is required for semantic memory operations");
    return scope as Required<MemoryScope>;
  }

  async function getWorking(getOptions: { signal?: AbortSignal } = {}): Promise<WorkingMemoryRecord | undefined> {
    const record = await workingStore.get(scope, getOptions);
    return record ? redactJson(record, redactor) : undefined;
  }

  async function updateWorking(patch: JsonObject, updateOptions: WorkingMemoryUpdateOptions = {}): Promise<WorkingMemoryRecord> {
    assertNotAborted(updateOptions.signal);
    const redactedPatch = redactJson(patch, redactor);
    const mode = updateOptions.mode ?? "merge";
    const existing = await workingStore.get(scope, { signal: updateOptions.signal });
    const previewValue = mode === "replace" ? redactedPatch : mergeJsonObjects(existing?.value ?? {}, redactedPatch);
    await validateWorkingValue(previewValue, {
      schema: options.schema,
      validateWorkingMemory: options.validateWorkingMemory,
      validateAgainstJsonSchema,
    });
    const record = await workingStore.update(scope, redactedPatch, updateOptions);
    return redactJson(record, redactor);
  }

  async function deleteWorking(deleteOptions: { signal?: AbortSignal } = {}): Promise<boolean> {
    return workingStore.delete(scope, deleteOptions);
  }

  async function renderWorking(template = options.workingMemoryTemplate): Promise<string | undefined> {
    const record = await getWorking();
    if (!record) return undefined;
    if (!template) return JSON.stringify(record.value);
    return renderTemplate(template, record.value);
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
    const vectors = await embedBatched(embedder, texts, limits.embedBatchSize, {
      signal,
      maxDimensions: limits.maxVectorDimensions,
    });

    const records: MemoryVectorRecord[] = entries.map((entry, index) => {
      const sequence = entry.sequence ?? ++sequenceCounter;
      if (entry.sequence !== undefined) sequenceCounter = Math.max(sequenceCounter, entry.sequence);
      const metadata = entry.metadata ? redactJson(entry.metadata, redactor) : undefined;
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
    const boundedTopK = resolveMemoryLimits({
      topK: recallOptions.topK ?? limits.topK,
    }).topK;
    const boundedRange = resolveMemoryLimits({
      messageRange: recallOptions.messageRange ?? limits.messageRange,
    }).messageRange;

    const [embedding] = await embedBatched(embedder, [redactJson(q, redactor)], limits.embedBatchSize, {
      signal: recallOptions.signal,
      maxDimensions: limits.maxVectorDimensions,
    });

    // Composite scoring: fetch an oversized candidate batch, blend in-TS, cut to topK.
    // The same pure re-rank serves the postgres path, keeping adapter orderings in parity.
    const scoring = resolveRecallScoring(recallOptions.scoring);
    const candidates = await vectorStore.query({
      ...threadScope,
      embedding: embedding!,
      topK: scoring ? boundedTopK * RECALL_OVERSAMPLE : boundedTopK,
      signal: recallOptions.signal,
    });
    const hits = scoring ? rerankRecallHits(candidates, scoring).slice(0, boundedTopK) : candidates;

    let adjacent: MemoryVectorRecord[] = [];
    if (boundedRange > 0) {
      const threadRecords = vectorStore.getByThread ? await vectorStore.getByThread(threadScope) : hits;
      adjacent = selectAdjacentRecords(threadRecords, hits, boundedRange);
    }

    const strict = recallOptions.requireConsent ?? options.requireConsent ?? false;
    const visibleHits = hits.filter((hit) => isInjectable(hit, strict));
    const visibleAdjacent = adjacent.filter((record) => isInjectable(record, strict));

    return {
      hits: visibleHits.map((hit) => redactJson(hit, redactor)),
      adjacent: visibleAdjacent.map((record) => redactJson(record, redactor)),
    };
  }

  async function findEntry(threadScope: Required<MemoryScope>, id: string): Promise<MemoryVectorRecord | undefined> {
    if (!vectorStore.getByThread) {
      throw new MemoryScopeError("operation requires a getByThread-capable vector store");
    }
    const records = await vectorStore.getByThread(threadScope);
    return records.find((record) => record.id === id);
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
    await vectorStore.upsert([updated], { signal: consentOptions.signal });
    return redactJson(updated, redactor);
  }

  async function correct(entryId: string, text: string, correctOptions: { signal?: AbortSignal } = {}): Promise<MemoryVectorRecord> {
    const threadScope = threadScopeOrThrow();
    assertNotAborted(correctOptions.signal);
    const id = requireNonEmptyString(entryId, "entryId");
    const nextText = requireNonEmptyString(text, "text");
    assertTextLimit(nextText, limits.maxEntryTextChars, "entry.text");
    const existing = await findEntry(threadScope, id);
    if (!existing) throw new MemoryValidationError(`memory entry ${id} not found`);
    const redactedText = redactJson(nextText, redactor);
    const [embedding] = await embedBatched(embedder, [redactedText], limits.embedBatchSize, {
      signal: correctOptions.signal,
      maxDimensions: limits.maxVectorDimensions,
    });
    const updated: MemoryVectorRecord = { ...existing, text: redactedText, embedding: embedding! };
    const payloadBytes = Buffer.byteLength(JSON.stringify(updated), "utf8");
    if (payloadBytes > limits.maxPayloadBytes) {
      throw new MemoryLimitError(`memory entry ${id} exceeds payload byte limit`);
    }
    await vectorStore.upsert([updated], { signal: correctOptions.signal });
    return redactJson(updated, redactor);
  }

  async function forget(filter: { ids?: readonly string[] } = {}, forgetOptions: { signal?: AbortSignal } = {}): Promise<number> {
    const threadScope = threadScopeOrThrow();
    assertNotAborted(forgetOptions.signal);
    return vectorStore.delete(
      { ...threadScope, ...(filter.ids && filter.ids.length > 0 ? { ids: filter.ids } : {}) },
      { signal: forgetOptions.signal },
    );
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
    const ids = [...expired];
    const deleted = ids.length > 0 ? await vectorStore.delete({ ...threadScope, ids }, { signal: retentionOptions.signal }) : 0;
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
    const entries = page.records
      .filter((record) => record.consent?.visible === true)
      .map((record) => {
        assertFiniteVector(record.embedding, "stored embedding", embedder.dimensions);
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
        for (const record of page.records) assertFiniteVector(record.embedding, "stored embedding", embedder.dimensions);
        const embeddings = await embedBatched(
          embedder,
          page.records.map((record) => record.text),
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

  function createContextProvider(providerOptions: MemoryContextProviderOptions = {}): ContextProvider {
    const name = providerOptions.name ?? "prism-memory";
    const includeWorking = providerOptions.includeWorking !== false;
    const includeSemantic = providerOptions.includeSemantic !== false;

    return {
      name,
      async resolve(context) {
        assertNotAborted(context.signal);
        const blocks: { title?: string; content: string; metadata?: Record<string, unknown> }[] = [];
        let tokenBudget = limits.maxInjectedTokens;

        if (includeWorking) {
          const rendered = await renderWorking();
          if (rendered) {
            const tokens = estimateTokens(rendered);
            if (tokens <= tokenBudget) {
              blocks.push({
                title: "Working memory",
                content: rendered,
                metadata: { source: "working-memory" },
              });
              tokenBudget -= tokens;
            }
          }
        }

        if (includeSemantic) {
          const query = resolveQuery(providerOptions, context.messages);
          if (query) {
            const recalled = await recall(query, {
              topK: providerOptions.topK ?? limits.topK,
              messageRange: providerOptions.messageRange ?? limits.messageRange,
              signal: context.signal,
            });
            const semanticText = formatRecall(recalled.hits, recalled.adjacent, tokenBudget);
            if (semanticText) {
              blocks.push({
                title: "Semantic memory",
                content: semanticText,
                metadata: { source: "semantic-memory", hitCount: recalled.hits.length },
              });
            }
          }
        }

        return blocks;
      },
    };
  }

  function createWorkingMemoryProcessor(processorOptions: WorkingMemoryProcessorOptions) {
    return {
      async process(messages: readonly Message[], processOptions: { signal?: AbortSignal } = {}) {
        assertNotAborted(processOptions.signal);
        const patch = await processorOptions.extract(messages);
        if (!patch) return undefined;
        return updateWorking(patch, {
          mode: processorOptions.mode ?? "merge",
          signal: processOptions.signal,
        });
      },
    };
  }

  return {
    scope,
    limits,
    getWorking,
    updateWorking,
    deleteWorking,
    renderWorking,
    remember,
    recall,
    setConsent,
    correct,
    forget,
    applyRetention,
    exportMemory,
    rebuildIndex,
    createContextProvider,
    createWorkingMemoryProcessor,
  };
}

function resolveQuery(providerOptions: MemoryContextProviderOptions, messages: readonly Message[]): string | undefined {
  if (typeof providerOptions.query === "string") return providerOptions.query;
  if (typeof providerOptions.query === "function") return providerOptions.query({ messages });
  return latestUserText(messages);
}

function formatRecall(hits: readonly MemoryVectorHit[], adjacent: readonly MemoryVectorRecord[], tokenBudget: number): string | undefined {
  const lines: string[] = [];
  let remaining = tokenBudget;
  const ordered = [
    ...hits.map((hit) => ({ text: hit.text, kind: "hit" as const, score: hit.score })),
    ...adjacent.map((record) => ({ text: record.text, kind: "adjacent" as const, score: undefined as number | undefined })),
  ];
  for (const item of ordered) {
    const line = item.kind === "hit" ? `- (${item.score.toFixed(3)}) ${item.text}` : `- (adjacent) ${item.text}`;
    const tokens = estimateTokens(line);
    if (tokens > remaining) break;
    lines.push(line);
    remaining -= tokens;
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

const CONSENT_SOURCES = new Set(["user", "agent", "system"]);
const CONSENT_SCOPES = new Set(["thread", "profile", "user"]);

/** Merge a consent grant/update over prior consent, stamping grant/revoke times. */
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
