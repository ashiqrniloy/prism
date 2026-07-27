import { RagLimitError } from "./errors.js";

export const DEFAULT_CHUNK_SIZE = 1_000;
export const HARD_CHUNK_SIZE_CAP = 16_384;
export const DEFAULT_CHUNK_OVERLAP = 100;
export const HARD_CHUNK_OVERLAP_CAP = 4_096;
export const DEFAULT_MAX_DOCUMENT_CHARS = 1_048_576;
export const HARD_MAX_DOCUMENT_CHARS_CAP = 8_388_608;
export const DEFAULT_MAX_DOCUMENT_BYTES = 1_048_576;
export const HARD_MAX_DOCUMENT_BYTES_CAP = 8 * 1024 * 1024;
export const DEFAULT_MAX_PARSE_MS = 30_000;
export const HARD_MAX_PARSE_MS_CAP = 30_000;
export const DEFAULT_MAX_PDF_PAGES = 256;
export const HARD_MAX_PDF_PAGES_CAP = 256;
export const DEFAULT_MAX_CHUNKS = 2_048;
export const HARD_MAX_CHUNKS_CAP = 8_192;
export const DEFAULT_EMBED_BATCH_SIZE = 32;
export const HARD_EMBED_BATCH_SIZE_CAP = 128;
export const DEFAULT_TOP_K = 5;
export const HARD_TOP_K_CAP = 32;
export const DEFAULT_QUERY_CANDIDATES = 20;
export const HARD_QUERY_CANDIDATES_CAP = 128;
export const DEFAULT_MAX_RESULT_BYTES = 64 * 1024;
export const HARD_MAX_RESULT_BYTES_CAP = 512 * 1024;
export const DEFAULT_MAX_CONTEXT_TOKENS = 2_000;
export const HARD_MAX_CONTEXT_TOKENS_CAP = 8_000;
export const DEFAULT_MAX_METADATA_BYTES = 16 * 1024;
export const HARD_MAX_METADATA_BYTES_CAP = 64 * 1024;
export const DEFAULT_MAX_VECTOR_DIMENSIONS = 4_096;
export const DEFAULT_MAX_RERANK_BYTES = 64 * 1024;
export const HARD_MAX_RERANK_BYTES_CAP = 256 * 1024;
export const DEFAULT_MAX_RERANK_MS = 2_000;
export const HARD_MAX_RERANK_MS_CAP = 10_000;
export const DEFAULT_RERANK_CONCURRENCY = 2;
export const HARD_RERANK_CONCURRENCY_CAP = 8;
export const DEFAULT_INGESTION_STATUS_PAGE_SIZE = 50;
export const HARD_INGESTION_STATUS_PAGE_SIZE_CAP = 200;

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
  readonly ingestionStatusPageSize: number;
}

export type RagLimitsInput = Partial<RagLimits>;

function integer(value: number | undefined, fallback: number, cap: number, label: string, minimum = 1): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum) {
    throw new RagLimitError(`${label} must be an integer >= ${minimum}`);
  }
  if (resolved > cap) throw new RagLimitError(`${label} exceeds hard cap ${cap}`);
  return resolved;
}

export function resolveRagLimits(input: RagLimitsInput = {}): RagLimits {
  const chunkSize = integer(input.chunkSize, DEFAULT_CHUNK_SIZE, HARD_CHUNK_SIZE_CAP, "chunkSize");
  const chunkOverlap = integer(input.chunkOverlap, DEFAULT_CHUNK_OVERLAP, HARD_CHUNK_OVERLAP_CAP, "chunkOverlap", 0);
  if (chunkOverlap >= chunkSize) throw new RagLimitError("chunkOverlap must be smaller than chunkSize");
  const topK = integer(input.topK, DEFAULT_TOP_K, HARD_TOP_K_CAP, "topK");
  const queryCandidates = integer(
    input.queryCandidates,
    Math.max(DEFAULT_QUERY_CANDIDATES, topK),
    HARD_QUERY_CANDIDATES_CAP,
    "queryCandidates",
  );
  if (queryCandidates < topK) throw new RagLimitError("queryCandidates must be >= topK");
  return Object.freeze({
    chunkSize,
    chunkOverlap,
    maxDocumentChars: integer(input.maxDocumentChars, DEFAULT_MAX_DOCUMENT_CHARS, HARD_MAX_DOCUMENT_CHARS_CAP, "maxDocumentChars"),
    maxDocumentBytes: integer(input.maxDocumentBytes, DEFAULT_MAX_DOCUMENT_BYTES, HARD_MAX_DOCUMENT_BYTES_CAP, "maxDocumentBytes"),
    maxParseMs: integer(input.maxParseMs, DEFAULT_MAX_PARSE_MS, HARD_MAX_PARSE_MS_CAP, "maxParseMs"),
    maxPdfPages: integer(input.maxPdfPages, DEFAULT_MAX_PDF_PAGES, HARD_MAX_PDF_PAGES_CAP, "maxPdfPages"),
    maxChunks: integer(input.maxChunks, DEFAULT_MAX_CHUNKS, HARD_MAX_CHUNKS_CAP, "maxChunks"),
    embedBatchSize: integer(input.embedBatchSize, DEFAULT_EMBED_BATCH_SIZE, HARD_EMBED_BATCH_SIZE_CAP, "embedBatchSize"),
    topK,
    queryCandidates,
    maxResultBytes: integer(input.maxResultBytes, DEFAULT_MAX_RESULT_BYTES, HARD_MAX_RESULT_BYTES_CAP, "maxResultBytes"),
    maxContextTokens: integer(input.maxContextTokens, DEFAULT_MAX_CONTEXT_TOKENS, HARD_MAX_CONTEXT_TOKENS_CAP, "maxContextTokens"),
    maxMetadataBytes: integer(input.maxMetadataBytes, DEFAULT_MAX_METADATA_BYTES, HARD_MAX_METADATA_BYTES_CAP, "maxMetadataBytes"),
    maxVectorDimensions: integer(
      input.maxVectorDimensions,
      DEFAULT_MAX_VECTOR_DIMENSIONS,
      DEFAULT_MAX_VECTOR_DIMENSIONS,
      "maxVectorDimensions",
    ),
    maxRerankBytes: integer(input.maxRerankBytes, DEFAULT_MAX_RERANK_BYTES, HARD_MAX_RERANK_BYTES_CAP, "maxRerankBytes"),
    maxRerankMs: integer(input.maxRerankMs, DEFAULT_MAX_RERANK_MS, HARD_MAX_RERANK_MS_CAP, "maxRerankMs"),
    rerankConcurrency: integer(input.rerankConcurrency, DEFAULT_RERANK_CONCURRENCY, HARD_RERANK_CONCURRENCY_CAP, "rerankConcurrency"),
    ingestionStatusPageSize: integer(
      input.ingestionStatusPageSize,
      DEFAULT_INGESTION_STATUS_PAGE_SIZE,
      HARD_INGESTION_STATUS_PAGE_SIZE_CAP,
      "ingestionStatusPageSize",
    ),
  });
}
