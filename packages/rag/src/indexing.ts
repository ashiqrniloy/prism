import { type JsonObject, resolveRedactor } from "@arnilo/prism";
import type { MemoryVectorRecord } from "@arnilo/prism-memory";
import { RagValidationError } from "./errors.js";
import { ingestionStatus } from "./ingestion-status.js";
import { HARD_CHUNK_SIZE_CAP, resolveRagLimits } from "./limits.js";
import type { IndexChunksOptions, IndexChunksResult } from "./types.js";
import { assertBytes, assertNotAborted, byteLength, nonEmpty, requireScope, requireSourceId } from "./util.js";

type Progress = { bytes: number; chunks: number };

export async function indexChunks(options: IndexChunksOptions): Promise<IndexChunksResult> {
  return indexChunkBatches(options, async (records) => options.store.upsert(records, { signal: options.signal }));
}

export async function indexChunkBatches(
  options: IndexChunksOptions,
  write: (records: readonly MemoryVectorRecord[]) => Promise<void>,
): Promise<IndexChunksResult> {
  const scope = requireScope(options.scope);
  const limits = resolveRagLimits({
    embedBatchSize: options.batchSize,
    maxChunks: options.maxChunks,
    chunkSize: options.maxChunkChars ?? HARD_CHUNK_SIZE_CAP,
    maxVectorDimensions: options.maxVectorDimensions,
    maxMetadataBytes: options.maxMetadataBytes,
  });
  if (
    !Number.isInteger(options.embedder.dimensions) ||
    options.embedder.dimensions <= 0 ||
    options.embedder.dimensions > limits.maxVectorDimensions
  ) {
    throw new RagValidationError(`embedder dimensions must be an integer in 1..${limits.maxVectorDimensions}`);
  }
  if (options.chunks.length > limits.maxChunks) throw new RagValidationError(`chunk count exceeds ${limits.maxChunks}`);
  const redactor = resolveRedactor(options.redactor, options.secrets);
  const sourceIds = new Set<string>();
  const chunkIds = new Set<string>();
  const total = new Map<string, Progress>();
  const written = new Map<string, Progress>();
  for (const chunk of options.chunks) {
    nonEmpty(chunk.id, "chunk.id");
    requireSourceId(chunk.sourceId);
    if (chunk.id !== chunk.citationId || !chunk.citationId.startsWith(`${chunk.sourceId}#`))
      throw new RagValidationError("chunk has inconsistent citation identity");
    if (chunkIds.has(chunk.id)) throw new RagValidationError(`duplicate chunk id: ${chunk.id}`);
    if (
      !Number.isInteger(chunk.index) ||
      chunk.index < 0 ||
      !Number.isInteger(chunk.start) ||
      chunk.start < 0 ||
      !Number.isInteger(chunk.end) ||
      chunk.end < chunk.start
    ) {
      throw new RagValidationError("chunk has invalid index or offsets");
    }
    if (chunk.text.length > limits.chunkSize) throw new RagValidationError(`chunk text exceeds ${limits.chunkSize} characters`);
    chunkIds.add(chunk.id);
    sourceIds.add(chunk.sourceId);
    add(total, chunk.sourceId, byteLength(redactor?.redact(chunk.text) ?? chunk.text), 1);
  }
  const setStatus = async (state: "pending" | "indexed" | "failed" | "partial", error?: unknown): Promise<void> => {
    if (!options.statusStore) return;
    const message = error instanceof Error ? error.message : error === undefined ? undefined : "indexing failed";
    const safeError = message ? (redactor?.redact(message) ?? message) : undefined;
    for (const sourceId of sourceIds) {
      const progress = state === "indexed" ? total.get(sourceId)! : (written.get(sourceId) ?? { bytes: 0, chunks: 0 });
      await options.statusStore.set(ingestionStatus(scope, sourceId, state, progress.bytes, progress.chunks, safeError));
    }
  };
  await setStatus("pending");
  try {
    for (let offset = 0; offset < options.chunks.length; offset += limits.embedBatchSize) {
      assertNotAborted(options.signal);
      const batch = options.chunks.slice(offset, offset + limits.embedBatchSize);
      const texts = batch.map((chunk) => redactor?.redact(chunk.text) ?? chunk.text);
      const vectors = await options.embedder.embed(texts, { signal: options.signal });
      if (vectors.length !== batch.length) throw new RagValidationError("embedder returned unexpected vector count");
      const records: MemoryVectorRecord[] = batch.map((chunk, index) => {
        const embedding = vectors[index]!;
        if (embedding.length !== options.embedder.dimensions || embedding.some((value) => !Number.isFinite(value))) {
          throw new RagValidationError(`embedder returned invalid vector; expected ${options.embedder.dimensions} finite values`);
        }
        const safeMetadata = redactor?.redact(chunk.metadata ?? {}) ?? chunk.metadata ?? {};
        const metadata = {
          ...safeMetadata,
          _rag: { sourceId: chunk.sourceId, citationId: chunk.citationId, chunkIndex: chunk.index, start: chunk.start, end: chunk.end },
        };
        assertBytes(metadata, limits.maxMetadataBytes, "chunk metadata");
        return {
          id: chunk.id,
          tenantId: scope.tenantId,
          resourceId: scope.resourceId,
          threadId: scope.corpusId,
          text: texts[index]!,
          embedding,
          sequence: chunk.index,
          metadata: metadata as JsonObject,
          createdAt: new Date(0).toISOString(),
        };
      });
      assertNotAborted(options.signal);
      await write(records);
      for (const chunk of batch) add(written, chunk.sourceId, byteLength(redactor?.redact(chunk.text) ?? chunk.text), 1);
      await setStatus("pending");
    }
    await setStatus("indexed");
  } catch (error) {
    await setStatus([...written.values()].some((progress) => progress.chunks > 0) ? "partial" : "failed", error);
    throw error;
  }
  return Object.freeze({ indexed: options.chunks.length, sourceIds: Object.freeze([...sourceIds].sort()) });
}

function add(target: Map<string, Progress>, sourceId: string, bytes: number, chunks: number): void {
  const current = target.get(sourceId) ?? { bytes: 0, chunks: 0 };
  target.set(sourceId, { bytes: current.bytes + bytes, chunks: current.chunks + chunks });
}
