import { type JsonObject, resolveRedactor } from "@arnilo/prism";
import type { MemoryVectorRecord } from "../types.js";
import { chunkText } from "./chunk.js";
import { RagScopeError, RagValidationError } from "./errors.js";
import { isValidContentHash } from "./hash.js";
import { indexChunkBatches } from "./indexing.js";
import { ingestionStatus } from "./ingestion-status.js";
import type {
  DeleteSourceOptions,
  ReplaceDocumentOptions,
  ReplaceSourceOptions,
  SourceVectorStore,
  TransactionalVectorStore,
} from "./types.js";
import { assertNotAborted, byteLength, requireScope, requireSourceId } from "./util.js";

export interface SourceMutationResult {
  readonly sourceId: string;
  readonly deleted: number;
  readonly indexed: number;
  /** Set when an unchanged document hash short-circuited the replace. */
  readonly skipped?: true;
}

function storedDocHash(record: MemoryVectorRecord): string | undefined {
  const value = (record.metadata as { _rag?: { contentHash?: unknown } } | undefined)?._rag?.contentHash;
  return isValidContentHash(value) ? value : undefined;
}

export async function replaceSource(options: ReplaceSourceOptions): Promise<SourceMutationResult> {
  const sourceId = requireSourceId(options.sourceId);
  const scope = requireScope(options.scope);
  assertTransactionalStore(options.store);
  if (options.chunks.some((chunk) => chunk.sourceId !== sourceId)) {
    throw new RagValidationError("replaceSource chunks must all belong to sourceId");
  }

  const redactor = resolveRedactor(options.redactor, options.secrets);
  if (options.contentHash !== undefined && !isValidContentHash(options.contentHash)) {
    throw new RagValidationError("contentHash must be a hex digest of 32..128 characters");
  }
  const contentHash = options.contentHash?.toLowerCase();
  const totalBytes = options.chunks.reduce((total, chunk) => total + byteLength(redactor?.redact(chunk.text) ?? chunk.text), 0);
  const setStatus = async (state: "pending" | "indexed" | "failed", error?: unknown): Promise<void> => {
    if (!options.statusStore) return;
    const message = error instanceof Error ? error.message : error === undefined ? undefined : "source replacement failed";
    await options.statusStore.set(
      ingestionStatus(
        scope,
        sourceId,
        state,
        state === "indexed" ? totalBytes : 0,
        state === "indexed" ? options.chunks.length : 0,
        message ? (redactor?.redact(message) ?? message) : undefined,
      ),
    );
  };
  await setStatus("pending");
  const telemetry = options.telemetry;
  const root = telemetry?.startSpan("rag_index", {
    "rag.scope.tenant_id": scope.tenantId,
    "rag.source_id": sourceId,
    "rag.embedder_id": options.embedder.id,
    "rag.chunk_count": options.chunks.length,
  });
  try {
    // One read decides the skip; unchanged sources cost zero embeds and zero writes.
    const previous = await sourceRecords(options.store, sourceId, scope, options.signal);
    if (
      contentHash &&
      options.skipIfUnchanged !== false &&
      previous.length > 0 &&
      previous.every((record) => storedDocHash(record) === contentHash)
    ) {
      // Incoming stats describe the now-live content even though nothing was rewritten.
      await setStatus("indexed", undefined);
      return Object.freeze({ sourceId, deleted: 0, indexed: 0, skipped: true as const });
    }
    const reuseEmbeddings = new Map<string, { text: string; embedding: readonly number[] }>();
    if (options.skipIfUnchanged !== false) {
      // skipIfUnchanged: false means rebuild everything — no embedding reuse either.
      for (const record of previous) {
        if (record.embedderId === options.embedder.id) {
          reuseEmbeddings.set(record.id, { text: record.text, embedding: record.embedding });
        }
      }
    }
    const staged: MemoryVectorRecord[] = [];
    const indexed = await indexChunkBatches(
      { ...options, statusStore: undefined, contentHash, reuseEmbeddings, telemetry, telemetryParent: root },
      async (records) => {
        staged.push(...records);
      },
    );
    assertNotAborted(options.signal);
    const result = await options.store.transaction(
      async (store) => {
        // Generation visibility: stamp chunks at N+1 and advance the scope pointer in the
        // same transaction as the swap. Stores without generation tracking keep legacy behavior.
        const getCurrent = store.getCurrentGeneration?.bind(store);
        const setCurrent = store.setCurrentGeneration?.bind(store);
        let nextGeneration: number | undefined;
        if (getCurrent && setCurrent) {
          const current = await getCurrent({
            tenantId: scope.tenantId,
            resourceId: scope.resourceId,
            threadId: scope.corpusId,
          });
          nextGeneration = (current === undefined ? 0 : Number(current)) + 1;
          root?.setAttribute("rag.index_generation", nextGeneration);
        }
        const previous = await sourceRecords(store, sourceId, scope, options.signal);
        assertNotAborted(options.signal);
        if (previous.length) {
          await store.delete(
            { tenantId: scope.tenantId, resourceId: scope.resourceId, threadId: scope.corpusId, ids: previous.map((record) => record.id) },
            { signal: options.signal },
          );
        }
        if (staged.length) {
          const stamped = nextGeneration === undefined ? staged : staged.map((record) => ({ ...record, generation: nextGeneration }));
          await store.upsert(stamped, { signal: options.signal });
        }
        if (setCurrent && nextGeneration !== undefined) {
          await setCurrent(
            {
              tenantId: scope.tenantId,
              resourceId: scope.resourceId,
              threadId: scope.corpusId,
            },
            nextGeneration,
          );
        }
        return Object.freeze({ sourceId, deleted: previous.length, indexed: indexed.indexed });
      },
      { signal: options.signal },
    );
    await setStatus("indexed");
    return result;
  } catch (error) {
    root?.recordError();
    await setStatus("failed", error);
    throw error;
  } finally {
    root?.end();
  }
}

export async function deleteSource(options: DeleteSourceOptions): Promise<SourceMutationResult> {
  const sourceId = requireSourceId(options.sourceId);
  const scope = requireScope(options.scope);
  assertSourceStore(options.store);
  const records = await sourceRecords(options.store, sourceId, scope, options.signal);
  assertNotAborted(options.signal);
  const deleted = records.length
    ? await options.store.delete(
        { tenantId: scope.tenantId, resourceId: scope.resourceId, threadId: scope.corpusId, ids: records.map((record) => record.id) },
        { signal: options.signal },
      )
    : 0;
  await options.statusStore?.delete(scope, sourceId);
  return Object.freeze({ sourceId, deleted, indexed: 0 });
}

export async function replaceDocument(options: ReplaceDocumentOptions): Promise<SourceMutationResult> {
  const loaded = await options.loader.load(options.uri, {
    ...options.loaderOptions,
    signal: options.signal ?? options.loaderOptions?.signal,
  });
  assertNotAborted(options.signal);
  const parsed = await options.parser.parse(loaded, {
    ...options.parserOptions,
    signal: options.signal ?? options.parserOptions?.signal,
  });
  assertNotAborted(options.signal);
  const sourceId = options.sourceId ?? loaded.sourceId;
  if (!sourceId) throw new RagValidationError("replaceDocument requires sourceId when its loader does not provide one");
  const { metadata, ...chunk } = options.chunk ?? {};
  const mergedMetadata = mergeMetadata(parsed.metadata, metadata);
  const chunks = (options.chunker ?? chunkText)(parsed.text, {
    ...chunk,
    sourceId,
    ...(mergedMetadata ? { metadata: mergedMetadata } : {}),
  });
  return replaceSource({
    ...options,
    sourceId,
    chunks,
  });
}

function mergeMetadata(parser: JsonObject | undefined, supplied: JsonObject | undefined): JsonObject | undefined {
  if (!parser && !supplied) return undefined;
  return { ...supplied, ...parser }; // Loader trust metadata wins over caller-supplied metadata.
}

async function sourceRecords(
  store: SourceVectorStore,
  sourceId: string,
  scope: { readonly tenantId: string; readonly resourceId: string; readonly corpusId: string },
  signal?: AbortSignal,
): Promise<readonly MemoryVectorRecord[]> {
  assertNotAborted(signal);
  const records = await store.getBySource({ tenantId: scope.tenantId, resourceId: scope.resourceId, threadId: scope.corpusId }, sourceId, {
    signal,
  });
  for (const record of records) {
    if (record.tenantId !== scope.tenantId || record.resourceId !== scope.resourceId || record.threadId !== scope.corpusId) {
      throw new RagScopeError("source lookup crossed tenant/resource/corpus boundary");
    }
    const rag = record.metadata?._rag;
    if (typeof rag !== "object" || rag === null || Array.isArray(rag) || rag.sourceId !== sourceId) {
      throw new RagScopeError("source lookup returned a different source");
    }
  }
  return records;
}

function assertSourceStore(store: unknown): asserts store is SourceVectorStore {
  if (!store || typeof store !== "object" || typeof (store as Partial<SourceVectorStore>).getBySource !== "function") {
    throw new RagValidationError("source deletion requires a scoped source-aware vector store");
  }
}

function assertTransactionalStore(store: unknown): asserts store is TransactionalVectorStore {
  if (!store || typeof store !== "object" || typeof (store as Partial<TransactionalVectorStore>).transaction !== "function") {
    throw new RagValidationError("atomic source replacement requires a transactional vector store");
  }
  assertSourceStore(store);
}
