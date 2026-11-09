// The library surface (plan 188.11 Task 5): what a host reads (config, ledger record names and folds,
// `createMemoryId`). Long-term memory imports the helpers it shares with the session tiers in-package
// (plan 216 Task 5), so none is exported for it. Workers, prompts, tuning constants, settings, flush, commands and the compactor stay inside
// the package; its tests import them by relative path. The package's contributions live in `setup`.

export type {
  MemorySessionComponents,
  MemorySessionConfig,
  MemorySessionConfigInput,
  MemorySystemRehearsalPolicy,
  MemorySystemWorkerConfig,
  ResolvedMemorySystemConfig,
  ResolvedWorkerSettings,
} from "./config.js";
export {
  type MemorySystemCompactAt,
  type ResolvedCompactAt,
  resolveMemorySystemConfig,
} from "./config.js";
export { createMemoryId } from "./ids.js";
export type { ObservationalMemoryLedger } from "./ledger.js";
export {
  activeObservations,
  activeReflections,
  foldObservationalMemoryLedger,
} from "./ledger.js";
export type {
  RecallBranchPageRequest,
  RecallBranchPageResult,
  RecallPageDetail,
  RecallPageDirection,
} from "./recall.js";
export type {
  ObservationalMemoryContextOptions,
  RecentMessageWindowOptions,
} from "./recent-messages.js";
export { buildObservationalMemoryContextBlocks } from "./recent-messages.js";
export type {
  BoundaryRecordedData,
  FoldedMemoryDetails,
  MemoryBoundary,
  MemoryBoundaryReason,
  MemoryChunkRef,
  MemoryEventKind,
  MemoryId,
  MemoryObservation,
  MemoryReflection,
  MemoryRelevance,
  MemoryTaskState,
  MemoryTombstone,
  ObservationsRecordedData,
  ObservationsRepeatedData,
  ObservationsTombstonedData,
  ReflectionsRecordedData,
  TaskStateRecordedData,
} from "./types.js";
export {
  BOUNDARY_RECORDED,
  MemorySessionLedgerError,
  OBSERVATIONS_RECORDED,
  OBSERVATIONS_REPEATED,
  OBSERVATIONS_TOMBSTONED,
  REFLECTIONS_RECORDED,
  TASK_STATE_RECORDED,
} from "./types.js";
