import { type JsonObject, resolveRedactor } from "@arnilo/prism";
import type { MemoryVectorRecord } from "@arnilo/prism-memory";
import { chunkText } from "./chunk.js";
import { RagScopeError, RagValidationError } from "./errors.js";
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
}

export async function replaceSource(options: ReplaceSourceOptions): Promise<SourceMutationResult> {
  const sourceId = requireSourceId(options.sourceId);
  const scope = requireScope(options.scope);
  assertTransactionalStore(options.store);
  if (options.chunks.some((chunk) => chunk.sourceId !== sourceId)) {
    throw new RagValidationError("replaceSource chunks must all belong to sourceId");
  }

  const redactor = resolveRedactor(options.redactor, options.secrets);
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
  try {
    const staged: MemoryVectorRecord[] = [];
    const indexed = await indexChunkBatches({ ...options, statusStore: undefined }, async (records) => {
      staged.push(...records);
    });
    assertNotAborted(options.signal);
    const result = await options.store.transaction(
      async (store) => {
        const previous = await sourceRecords(store, sourceId, scope, options.signal);
        assertNotAborted(options.signal);
        if (previous.length) {
          await store.delete(
            { tenantId: scope.tenantId, resourceId: scope.resourceId, threadId: scope.corpusId, ids: previous.map((record) => record.id) },
            { signal: options.signal },
          );
        }
        if (staged.length) await store.upsert(staged, { signal: options.signal });
        return Object.freeze({ sourceId, deleted: previous.length, indexed: indexed.indexed });
      },
      { signal: options.signal },
    );
    await setStatus("indexed");
    return result;
  } catch (error) {
    await setStatus("failed", error);
    throw error;
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
