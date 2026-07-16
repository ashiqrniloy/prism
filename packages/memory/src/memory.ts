import type { ContextProvider, JsonObject, Message } from "@arnilo/prism";
import { embedBatched } from "./embedder.js";
import { MemoryLimitError, MemoryScopeError, MemoryValidationError } from "./errors.js";
import { estimateTokens, resolveMemoryLimits } from "./limits.js";
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
  MemoryContextProviderOptions,
  MemoryEntryInput,
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
      const record: MemoryVectorRecord = {
        id: entry.id,
        tenantId: threadScope.tenantId,
        resourceId: threadScope.resourceId,
        threadId: threadScope.threadId,
        text: texts[index]!,
        embedding: vectors[index]!,
        sequence,
        createdAt: entry.createdAt ?? new Date().toISOString(),
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

    return {
      hits: hits.map((hit) => redactJson(hit, redactor)),
      adjacent: adjacent.map((record) => redactJson(record, redactor)),
    };
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
    createContextProvider,
    createWorkingMemoryProcessor,
  };
}

function resolveQuery(
  providerOptions: MemoryContextProviderOptions,
  messages: readonly Message[],
): string | undefined {
  if (typeof providerOptions.query === "string") return providerOptions.query;
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
