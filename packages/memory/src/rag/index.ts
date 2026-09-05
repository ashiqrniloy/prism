export { chunkMarkdown, chunkText } from "./chunk.js";
export { runRerankerConformance } from "./conformance.js";
export { createRagContextProvider } from "./context.js";
export { RagAbortError, RagError, RagLimitError, RagScopeError, RagValidationError } from "./errors.js";
export type { FusedCandidate, RetrievalLeg } from "./fusion.js";
export { fuseReciprocalRank } from "./fusion.js";
export { isValidContentHash } from "./hash.js";
export type { CreateOpenAiCompatibleRerankerOptions, CreateVoyageRerankerOptions } from "./hosted-rerankers.js";
export { createOpenAiCompatibleReranker, createVoyageReranker } from "./hosted-rerankers.js";
export { indexChunks } from "./indexing.js";
export { createMemoryIngestionStatusStore, listIngestionStatus } from "./ingestion-status.js";
export type { RagLimits, RagLimitsInput } from "./limits.js";
export {
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_EMBED_BATCH_SIZE,
  DEFAULT_INGESTION_STATUS_PAGE_SIZE,
  DEFAULT_MAX_CHUNKS,
  DEFAULT_MAX_CONTEXT_TOKENS,
  DEFAULT_MAX_DOCUMENT_BYTES,
  DEFAULT_MAX_DOCUMENT_CHARS,
  DEFAULT_MAX_METADATA_BYTES,
  DEFAULT_MAX_PARSE_MS,
  DEFAULT_MAX_PDF_PAGES,
  DEFAULT_MAX_RERANK_BYTES,
  DEFAULT_MAX_RERANK_MS,
  DEFAULT_MAX_RESULT_BYTES,
  DEFAULT_MAX_VECTOR_DIMENSIONS,
  DEFAULT_QUERY_CANDIDATES,
  DEFAULT_RERANK_CONCURRENCY,
  DEFAULT_TOP_K,
  HARD_CHUNK_OVERLAP_CAP,
  HARD_CHUNK_SIZE_CAP,
  HARD_EMBED_BATCH_SIZE_CAP,
  HARD_INGESTION_STATUS_PAGE_SIZE_CAP,
  HARD_MAX_CHUNKS_CAP,
  HARD_MAX_CONTEXT_TOKENS_CAP,
  HARD_MAX_DOCUMENT_BYTES_CAP,
  HARD_MAX_DOCUMENT_CHARS_CAP,
  HARD_MAX_METADATA_BYTES_CAP,
  HARD_MAX_PARSE_MS_CAP,
  HARD_MAX_PDF_PAGES_CAP,
  HARD_MAX_RERANK_BYTES_CAP,
  HARD_MAX_RERANK_MS_CAP,
  HARD_MAX_RESULT_BYTES_CAP,
  HARD_QUERY_CANDIDATES_CAP,
  HARD_RERANK_CONCURRENCY_CAP,
  HARD_RETRIEVE_SCOPE_CAP,
  HARD_TOP_K_CAP,
  resolveRagLimits,
} from "./limits.js";
export { createResourceDocumentLoader, createWebFetchDocumentLoader } from "./loaders.js";
export { htmlParser, markdownParser, pdfParser, textParser } from "./parsers.js";
export { createFakeReranker } from "./rerank-fake.js";
export { retrieveContext } from "./retrieve.js";
export type { SourceMutationResult } from "./sources.js";
export { deleteSource, replaceDocument, replaceSource } from "./sources.js";
export type { CreateTeiRerankerOptions } from "./tei-reranker.js";
export { createTeiReranker } from "./tei-reranker.js";
export type { RagTelemetry, RagTelemetryAttributeValue, RagTelemetrySpan } from "./telemetry.js";

export type {
  Chunker,
  ChunkOptions,
  DeleteSourceOptions,
  DocumentLoader,
  DocumentLoadOptions,
  DocumentParseOptions,
  IndexChunksOptions,
  IndexChunksResult,
  IngestionState,
  IngestionStatus,
  IngestionStatusQuery,
  IngestionStatusStore,
  LoadedDocument,
  ParsedDocument,
  Parser,
  RagChunk,
  RagCitation,
  RagContentTrust,
  RagContextProvider,
  RagContextProviderOptions,
  RagContextResult,
  RagHit,
  RagProvenance,
  RagScope,
  ReplaceDocumentOptions,
  ReplaceSourceOptions,
  Reranker,
  RetrieveContextOptions,
  ReusableEmbedding,
  SourceVectorStore,
  TransactionalVectorStore,
} from "./types.js";

export const packageName = "@arnilo/prism-memory/rag";
