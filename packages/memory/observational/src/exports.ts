// The library surface (plan 188.11 Task 5): what a host reads (config, ledger record names and folds,
// `createMemoryId`) plus the memory-package shared helpers the fabric imports, which carry no host
// promise. Workers, prompts, tuning constants, settings, flush, commands and the compactor stay inside
// the package; its tests import them by relative path. The package's contributions live in `setup`.
export {
  createMemoryId,
} from "./ids.js";
export {
  HARD_MAX_RECALL_PAGE_LIMIT,
  resolveRecallPageLimit,
} from "./limits.js";
export {
  serializeSessionEntry,
} from "./serialize.js";
export {
  buildObservationalMemoryContextBlocks,
} from "./recent-messages.js";
export {
  recallObservationalMemoryBranchPage,
} from "./recall.js";
export {
  activeObservations,
  activeReflections,
  foldObservationalMemoryLedger,
  recordData,
} from "./ledger.js";
export {
  estimateMessageTokens,
  estimateTextTokens,
} from "./tokens.js";
export {
  TASK_STATE_RECORDED,
  isTaskStateRecordedData,
  OBSERVATIONS_RECORDED,
  REFLECTIONS_RECORDED,
  foldedMemoryFromEntry,
  isMemoryId,
  isMemoryObservation,
  isMemoryReflection,
  isObservationsRecordedData,
  isReflectionsRecordedData,
} from "./types.js";
export {
  isEligibleObservationSourceEntry,
} from "./coverage-helpers.js";
export {
  memoryObservationalConfigSchema,
  resolveMemoryObservationalConfig,
  type MemoryObservationalCompactAt,
  type ResolvedCompactAt,
} from "./config.js";
export type {
  ObservationalMemoryContextOptions,
  RecentMessageWindowOptions,
} from "./recent-messages.js";
export type {
  RecallBranchPageRequest,
  RecallBranchPageResult,
  RecallPageDetail,
  RecallPageDirection,
} from "./recall.js";
export type {
  ObservationalMemoryLedger,
} from "./ledger.js";
export type {
  FoldedMemoryDetails,
  MemoryTaskState,
  TaskStateRecordedData,
  MemoryId,
  MemoryObservation,
  MemoryReflection,
  MemoryRelevance,
  ObservationsRecordedData,
  ReflectionsRecordedData,
} from "./types.js";
export type {
  MemoryObservationalConfig,
  MemoryObservationalDropperPolicy,
  MemoryObservationalWorkerConfig,
  ResolvedMemoryObservationalConfig,
} from "./config.js";
