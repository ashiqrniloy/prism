export {
  DEFAULT_TOP_K,
  HARD_TOP_K_CAP,
  DEFAULT_MESSAGE_RANGE,
  HARD_MESSAGE_RANGE_CAP,
  DEFAULT_EMBED_BATCH_SIZE,
  HARD_EMBED_BATCH_CAP,
  DEFAULT_MAX_PAYLOAD_BYTES,
  HARD_MAX_PAYLOAD_BYTES_CAP,
  DEFAULT_MAX_INJECTED_TOKENS,
  HARD_MAX_INJECTED_TOKENS_CAP,
  DEFAULT_MAX_VECTOR_DIMENSIONS,
  HARD_MAX_VECTOR_DIMENSIONS_CAP,
  DEFAULT_MAX_ENTRY_TEXT_CHARS,
  HARD_MAX_ENTRY_TEXT_CHARS_CAP,
  DEFAULT_MAX_WORKING_MEMORY_BYTES,
  HARD_MAX_WORKING_MEMORY_BYTES_CAP,
  estimateTokens,
  resolveMemoryLimits,
} from "./limits.js";
export type { MemoryLimits, MemoryLimitsInput } from "./limits.js";

export {
  MemoryAbortError,
  MemoryConflictError,
  MemoryError,
  MemoryLimitError,
  MemoryScopeError,
  MemoryValidationError,
} from "./errors.js";

export { validateAgainstJsonSchema } from "./schema.js";
export { createHashEmbedder, embedBatched } from "./embedder.js";
export { assertFiniteVector } from "./util.js";
export type { HashEmbedderOptions } from "./embedder.js";

export { createMemoryVectorStore, selectAdjacentRecords } from "./vector-memory.js";
export type { MemoryVectorStoreOptions } from "./vector-memory.js";

export { createMemoryWorkingStore, validateWorkingValue } from "./working-memory.js";
export type { MemoryWorkingStoreOptions } from "./working-memory.js";

export { createMemory } from "./memory.js";
export { runMemoryConformance } from "./conformance.js";
export type { MemoryConformanceStores } from "./conformance.js";

export {
  createPostgresMemoryStores,
  queryPostgres,
} from "./postgres.js";
export type { PostgresMemoryStores, PostgresMemoryStoresOptions } from "./postgres.js";
export { DEFAULT_MEMORY_SCHEMA, buildMemoryDdl } from "./postgres-ddl.js";
export { validateIdentifier, quoteIdentifier, qualifyTable } from "./postgres-identifiers.js";

export type {
  CreateMemoryOptions,
  Embedder,
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
  VectorDeleteFilter,
  VectorQuery,
  VectorStore,
  WorkingMemoryKey,
  WorkingMemoryProcessorOptions,
  WorkingMemoryRecord,
  WorkingMemoryStore,
  WorkingMemoryUpdateMode,
  WorkingMemoryUpdateOptions,
} from "./types.js";

export const packageName = "@arnilo/prism-memory";
