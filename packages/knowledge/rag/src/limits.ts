import { RagLimitError } from "./errors.js";

export const DEFAULT_CHUNK_SIZE = 1_000;
export const DEFAULT_CHUNK_OVERLAP = 100;
export const DEFAULT_MAX_DOCUMENT_CHARS = 1_048_576;
export const DEFAULT_MAX_DOCUMENT_BYTES = 1_048_576;
export const DEFAULT_MAX_PARSE_MS = 30_000;
export const DEFAULT_MAX_PDF_PAGES = 256;
export const DEFAULT_MAX_CHUNKS = 2_048;
export const DEFAULT_EMBED_BATCH_SIZE = 32;
export const DEFAULT_TOP_K = 5;
export const DEFAULT_QUERY_CANDIDATES = 20;
export const DEFAULT_MAX_RESULT_BYTES = 64 * 1024;
export const DEFAULT_MAX_CONTEXT_TOKENS = 2_000;
export const DEFAULT_MAX_METADATA_BYTES = 16 * 1024;
export const DEFAULT_MAX_VECTOR_DIMENSIONS = 4_096;
export const DEFAULT_MAX_RERANK_BYTES = 64 * 1024;
export const DEFAULT_MAX_RERANK_MS = 2_000;
export const DEFAULT_RERANK_CONCURRENCY = 2;
export const DEFAULT_RRF_K = 60;
export const DEFAULT_INGESTION_STATUS_PAGE_SIZE = 50;
/** Characters a retrieval query may carry; the query can come from a model's `rag_search` argument. */
export const DEFAULT_MAX_QUERY_CHARS = 16_384;
/** Chunk size for `indexDocument` when the caller gives no `maxChunkChars`. */
export const DEFAULT_MAX_CHUNK_CHARS = 16_384;

export interface RagLimits {
  readonly chunkSize: number;
  readonly chunkOverlap: number;
  readonly maxDocumentChars: number;
  readonly maxDocumentBytes: number;
  readonly maxParseMs: number;
  readonly maxPdfPages: number;
  readonly maxChunks: number;
  readonly embedBatchSize: number;
  readonly topK: number;
  readonly queryCandidates: number;
  readonly maxResultBytes: number;
  readonly maxContextTokens: number;
  readonly maxMetadataBytes: number;
  readonly maxVectorDimensions: number;
  readonly maxRerankBytes: number;
  readonly maxRerankMs: number;
  readonly rerankConcurrency: number;
  readonly rrfK: number;
  readonly ingestionStatusPageSize: number;
}

export type RagLimitsInput = Partial<RagLimits>;

/** The host's value is the cap (plan 239): a limit is validated, never clamped to a hidden maximum. */
function integer(value: number | undefined, fallback: number, label: string, minimum = 1): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum) {
    throw new RagLimitError(`${label} must be an integer >= ${minimum}`);
  }
  return resolved;
}

export function resolveRagLimits(input: RagLimitsInput = {}): RagLimits {
  const chunkSize = integer(input.chunkSize, DEFAULT_CHUNK_SIZE, "chunkSize");
  const chunkOverlap = integer(input.chunkOverlap, DEFAULT_CHUNK_OVERLAP, "chunkOverlap", 0);
  if (chunkOverlap >= chunkSize) throw new RagLimitError("chunkOverlap must be smaller than chunkSize");
  const topK = integer(input.topK, DEFAULT_TOP_K, "topK");
  const queryCandidates = integer(input.queryCandidates, Math.max(DEFAULT_QUERY_CANDIDATES, topK), "queryCandidates");
  if (queryCandidates < topK) throw new RagLimitError("queryCandidates must be >= topK");
  return Object.freeze({
    chunkSize,
    chunkOverlap,
    maxDocumentChars: integer(input.maxDocumentChars, DEFAULT_MAX_DOCUMENT_CHARS, "maxDocumentChars"),
    maxDocumentBytes: integer(input.maxDocumentBytes, DEFAULT_MAX_DOCUMENT_BYTES, "maxDocumentBytes"),
    maxParseMs: integer(input.maxParseMs, DEFAULT_MAX_PARSE_MS, "maxParseMs"),
    maxPdfPages: integer(input.maxPdfPages, DEFAULT_MAX_PDF_PAGES, "maxPdfPages"),
    maxChunks: integer(input.maxChunks, DEFAULT_MAX_CHUNKS, "maxChunks"),
    embedBatchSize: integer(input.embedBatchSize, DEFAULT_EMBED_BATCH_SIZE, "embedBatchSize"),
    topK,
    queryCandidates,
    maxResultBytes: integer(input.maxResultBytes, DEFAULT_MAX_RESULT_BYTES, "maxResultBytes"),
    maxContextTokens: integer(input.maxContextTokens, DEFAULT_MAX_CONTEXT_TOKENS, "maxContextTokens"),
    maxMetadataBytes: integer(input.maxMetadataBytes, DEFAULT_MAX_METADATA_BYTES, "maxMetadataBytes"),
    maxVectorDimensions: integer(input.maxVectorDimensions, DEFAULT_MAX_VECTOR_DIMENSIONS, "maxVectorDimensions"),
    maxRerankBytes: integer(input.maxRerankBytes, DEFAULT_MAX_RERANK_BYTES, "maxRerankBytes"),
    maxRerankMs: integer(input.maxRerankMs, DEFAULT_MAX_RERANK_MS, "maxRerankMs"),
    rerankConcurrency: integer(input.rerankConcurrency, DEFAULT_RERANK_CONCURRENCY, "rerankConcurrency"),
    rrfK: integer(input.rrfK, DEFAULT_RRF_K, "rrfK"),
    ingestionStatusPageSize: integer(input.ingestionStatusPageSize, DEFAULT_INGESTION_STATUS_PAGE_SIZE, "ingestionStatusPageSize"),
  });
}
