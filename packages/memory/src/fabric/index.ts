export {
  type AttachedMemoryFabricSession,
  createFabricAttach,
  type MemoryFabricAttachableSession,
  type MemoryFabricAttachOptions,
} from "./attach.js";
export { DEFAULT_CONSOLIDATION_THRESHOLD } from "./consolidate.js";
export { createMemoryFabric } from "./create.js";
export { DEFAULT_FABRIC_MAX_FILE_BYTES, HARD_FABRIC_MAX_FILE_BYTES } from "./files.js";
export { caseConclusionsNotProcedures } from "./invariants.js";
export { DEFAULT_LINKER_TOP_K, HARD_MAX_FABRIC_LINK_TOP_K } from "./links.js";
export { createMemoryFabricContextProvider, DEFAULT_MEMORY_FABRIC_PROVIDER_NAME } from "./provider.js";
export { createFabricRepointHandler } from "./repoint.js";
export { DEFAULT_CONVERSATION_SEARCH_TOP_K } from "./search.js";
export {
  type CreateMemoryFabricOptions,
  DEFAULT_RECALL_KINDS,
  encodeMemoryNoteMetadata,
  isMemoryNoteKind,
  isMemoryNoteValidAt,
  MEMORY_FABRIC_WORKING_KEY,
  MEMORY_NOTE_KINDS,
  MEMORY_NOTE_METADATA_KEY,
  type MemoryFabric,
  type MemoryFabricConsolidationOptions,
  type MemoryFabricConversationHit,
  type MemoryFabricConversationSearchOptions,
  type MemoryFabricConversationSearchResult,
  type MemoryFabricEvolutionOptions,
  type MemoryFabricExplainEntry,
  type MemoryFabricForgetInput,
  type MemoryFabricForgetResult,
  type MemoryFabricLinkerOptions,
  type MemoryFabricObservationSource,
  type MemoryFabricRecallOptions,
  type MemoryFabricRecallResult,
  type MemoryFabricRememberInput,
  type MemoryFabricToolsOptions,
  type MemoryFabricWriteOptions,
  type MemoryNote,
  type MemoryNoteHit,
  type MemoryNoteKind,
  type MemoryNoteLink,
  type MemoryNoteMetadata,
  type MemoryNotePromotion,
  parseMemoryNoteMetadata,
} from "./types.js";

export { type MemoryFabricSettings, resolveMemoryFabricSettings } from "./workers.js";

export const packageName = "@arnilo/prism-memory/fabric";
