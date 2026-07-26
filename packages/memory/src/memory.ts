import type { ContextProvider, JsonObject, Message } from "@arnilo/prism";
import { embedBatched } from "./embedder.js";
import { MemoryLimitError, MemoryScopeError, MemoryValidationError } from "./errors.js";
import {
  DEFAULT_MEMORY_RETENTION_BATCH,
  HARD_MEMORY_RETENTION_BATCH_CAP,
  estimateTokens,
  resolveMemoryLimits,
} from "./limits.js";
import { validateAgainstJsonSchema } from "./schema.js";
import {
  assertNotAborted,
  assertTextLimit,
  latestUserText,
  mergeJsonObjects,
  redactJson,
  renderTemplate,
  requireNonEmptyString,
  requireScope,
  resolveRedactor,
} from "./util.js";
import { createMemoryVectorStore, selectAdjacentRecords } from "./vector-memory.js";
import { createMemoryWorkingStore, validateWorkingValue } from "./working-memory.js";
import type {
  CreateMemoryOptions,
  Memory,
  MemoryConsent,
  MemoryConsentInput,
  MemoryContextProviderOptions,
  MemoryEntryInput,
  MemoryRetentionResult,
  MemoryRetentionPolicy,
  MemoryScope,
  MemoryVectorHit,
  MemoryVectorRecord,
  RecallOptions,
  RecallResult,
  RememberInput,
  RememberOptions,
  RememberResult,
  WorkingMemoryProcessorOptions,
  WorkingMemoryRecord,
  WorkingMemoryUpdateOptions,
} from "./types.js";

export function createMemory(options: CreateMemoryOptions): Memory {
  const scope = requireScope(options);
  const limits = resolveMemoryLimits(options.limits);
  const redactor = resolveRedactor(options.redactor, options.secrets);
  const vectorStore = options.vectorStore ?? createMemoryVectorStore({ maxEntryTextChars: limits.maxEntryTextChars });
  const workingStore =
    options.workingStore ?? createMemoryWorkingStore({ maxWorkingMemoryBytes: limits.maxWorkingMemoryBytes });
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

  async function updateWorking(
    patch: JsonObject,
    updateOptions: WorkingMemoryUpdateOptions = {},
  ): Promise<WorkingMemoryRecord> {
    assertNotAborted(updateOptions.signal);
    const redactedPatch = redactJson(patch, redactor);
    const mode = updateOptions.mode ?? "merge";
    const existing = await workingStore.get(scope, { signal: updateOptions.signal });
    const previewValue =
      mode === "replace" ? redactedPatch : mergeJsonObjects(existing?.value ?? {}, redactedPatch);
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

    const hits = await vectorStore.query({
      ...threadScope,
      embedding: embedding!,
      topK: boundedTopK,
      signal: recallOptions.signal,
    });

    let adjacent: MemoryVectorRecord[] = [];
    if (boundedRange > 0) {
      const threadRecords = vectorStore.getByThread
        ? await vectorStore.getByThread(threadScope)
        : hits;
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

  async function correct(
    entryId: string,
    text: string,
    correctOptions: { signal?: AbortSignal } = {},
  ): Promise<MemoryVectorRecord> {
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

  async function forget(
    filter: { ids?: readonly string[] } = {},
    forgetOptions: { signal?: AbortSignal } = {},
  ): Promise<number> {
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
    if (!vectorStore.getByThread) {
      throw new MemoryScopeError("retention requires a getByThread-capable vector store");
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
    // ponytail: per-thread scan only; shard by resource/thread if a single thread grows unbounded.
    const records = await vectorStore.getByThread(threadScope);
    const now = Date.now();
    const cutoff = policy.maxAgeDays !== undefined ? now - policy.maxAgeDays * 86_400_000 : Number.NEGATIVE_INFINITY;
    const expired = new Set<string>();
    for (const record of records) {
      if (Date.parse(record.createdAt) < cutoff) expired.add(record.id);
    }
    if (policy.maxEntries !== undefined) {
      const survivors = records.filter((record) => !expired.has(record.id));
      const overflow = survivors.length - policy.maxEntries;
      for (let i = 0; i < overflow; i += 1) expired.add(survivors[i]!.id); // oldest by sequence
    }
    const ids = [...expired].slice(0, batchSize);
    const deleted = ids.length > 0
      ? await vectorStore.delete({ ...threadScope, ids }, { signal: retentionOptions.signal })
      : 0;
    return { deleted, scanned: records.length };
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
    createContextProvider,
    createWorkingMemoryProcessor,
  };
}

function resolveQuery(
  providerOptions: MemoryContextProviderOptions,
  messages: readonly Message[],
): string | undefined {  if (typeof providerOptions.query === "string") return providerOptions.query;
  if (typeof providerOptions.query === "function") return providerOptions.query({ messages });
  return latestUserText(messages);
}

function formatRecall(
  hits: readonly MemoryVectorHit[],
  adjacent: readonly MemoryVectorRecord[],
  tokenBudget: number,
): string | undefined {
  const lines: string[] = [];
  let remaining = tokenBudget;
  const ordered = [
    ...hits.map((hit) => ({ text: hit.text, kind: "hit" as const, score: hit.score })),
    ...adjacent.map((record) => ({ text: record.text, kind: "adjacent" as const, score: undefined as number | undefined })),
  ];
  for (const item of ordered) {
    const line =
      item.kind === "hit"
        ? `- (${item.score.toFixed(3)}) ${item.text}`
        : `- (adjacent) ${item.text}`;
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
function normalizeConsent(
  input: MemoryConsentInput | undefined,
  prior: MemoryConsent | undefined,
  now: string,
): MemoryConsent {
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
