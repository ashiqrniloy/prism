export {
  DEFAULT_CHUNK_SIZE,
  HARD_CHUNK_SIZE_CAP,
  DEFAULT_CHUNK_OVERLAP,
  HARD_CHUNK_OVERLAP_CAP,
  DEFAULT_MAX_DOCUMENT_CHARS,
  HARD_MAX_DOCUMENT_CHARS_CAP,
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
  resolveRagLimits,
} from "./limits.js";
export type { RagLimits, RagLimitsInput } from "./limits.js";

export { RagAbortError, RagError, RagLimitError, RagScopeError, RagValidationError } from "./errors.js";
export { chunkMarkdown, chunkText } from "./chunk.js";
export { indexChunks } from "./indexing.js";
export { retrieveContext } from "./retrieve.js";
export { createRagContextProvider } from "./context.js";

export type {
  ChunkOptions,
  IndexChunksOptions,
  IndexChunksResult,
  RagChunk,
  RagCitation,
  RagContextProvider,
  RagContextProviderOptions,
  RagContextResult,
  RagHit,
  RagScope,
  RetrieveContextOptions,
} from "./types.js";

export const packageName = "@arnilo/prism-rag";
