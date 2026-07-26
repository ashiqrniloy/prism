export {
  DEFAULT_CHUNK_SIZE,
  HARD_CHUNK_SIZE_CAP,
  DEFAULT_CHUNK_OVERLAP,
  HARD_CHUNK_OVERLAP_CAP,
  DEFAULT_MAX_DOCUMENT_CHARS,
  HARD_MAX_DOCUMENT_CHARS_CAP,
  DEFAULT_MAX_DOCUMENT_BYTES,
  HARD_MAX_DOCUMENT_BYTES_CAP,
  DEFAULT_MAX_PARSE_MS,
  HARD_MAX_PARSE_MS_CAP,
  DEFAULT_MAX_PDF_PAGES,
  HARD_MAX_PDF_PAGES_CAP,
  DEFAULT_MAX_CHUNKS,
  HARD_MAX_CHUNKS_CAP,
  DEFAULT_EMBED_BATCH_SIZE,
  HARD_EMBED_BATCH_SIZE_CAP,
  DEFAULT_TOP_K,
  HARD_TOP_K_CAP,
  DEFAULT_QUERY_CANDIDATES,
  HARD_QUERY_CANDIDATES_CAP,
  DEFAULT_MAX_RESULT_BYTES,
  HARD_MAX_RESULT_BYTES_CAP,
  DEFAULT_MAX_CONTEXT_TOKENS,
  HARD_MAX_CONTEXT_TOKENS_CAP,
  DEFAULT_MAX_METADATA_BYTES,
  HARD_MAX_METADATA_BYTES_CAP,
  DEFAULT_MAX_VECTOR_DIMENSIONS,
  DEFAULT_MAX_RERANK_BYTES,
  HARD_MAX_RERANK_BYTES_CAP,
  DEFAULT_MAX_RERANK_MS,
  HARD_MAX_RERANK_MS_CAP,
  DEFAULT_RERANK_CONCURRENCY,
  HARD_RERANK_CONCURRENCY_CAP,
  DEFAULT_INGESTION_STATUS_PAGE_SIZE,
  HARD_INGESTION_STATUS_PAGE_SIZE_CAP,
  resolveRagLimits,
} from "./limits.js";
export type { RagLimits, RagLimitsInput } from "./limits.js";

export { RagAbortError, RagError, RagLimitError, RagScopeError, RagValidationError } from "./errors.js";
export { chunkMarkdown, chunkText } from "./chunk.js";
export { createResourceDocumentLoader, createWebFetchDocumentLoader } from "./loaders.js";
export { htmlParser, markdownParser, pdfParser, textParser } from "./parsers.js";
export { indexChunks } from "./indexing.js";
export { deleteSource, replaceDocument, replaceSource } from "./sources.js";
export type { SourceMutationResult } from "./sources.js";
export { createMemoryIngestionStatusStore, listIngestionStatus } from "./ingestion-status.js";
export { retrieveContext } from "./retrieve.js";
export { createRagContextProvider } from "./context.js";

export type {
  ChunkOptions,
  Chunker,
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
  RagChunk,
  LoadedDocument,
  ParsedDocument,
  Parser,
  RagCitation,
  RagContextProvider,
  RagContextProviderOptions,
  RagContextResult,
  RagContentTrust,
  RagHit,
  RagProvenance,
  Reranker,
  RagScope,
  ReplaceDocumentOptions,
  ReplaceSourceOptions,
  RetrieveContextOptions,
  SourceVectorStore,
  TransactionalVectorStore,
} from "./types.js";

export const packageName = "@arnilo/prism-rag";
