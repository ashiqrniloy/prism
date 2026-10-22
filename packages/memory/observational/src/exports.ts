// The library surface: the moved observational-memory modules, importable for hosts that build
// their own worker or read the ledger directly. The package's contributions live in `setup`.

export { createMemoryId } from "./ids.js";
export {
  DEFAULT_MAX_TASK_STATE_BYTES,
  HARD_MAX_TASK_STATE_BYTES,
  DEFAULT_MAX_WORKER_ARGUMENT_BYTES,
  DEFAULT_MAX_WORKER_ERROR_BYTES,
  DEFAULT_MAX_WORKER_MESSAGE_BYTES,
  DEFAULT_MAX_WORKER_RESULT_BYTES,
  DEFAULT_MAX_WORKER_TOOL_CALLS,
  DEFAULT_MAX_WORKER_TOOL_CALLS_PER_TURN,
  DEFAULT_MAX_WORKER_TURNS,
  DEFAULT_RECALL_PAGE_LIMIT,
  HARD_MAX_RECALL_PAGE_LIMIT,
  HARD_MAX_WORKER_ARGUMENT_BYTES,
  HARD_MAX_WORKER_ERROR_BYTES,
  HARD_MAX_WORKER_MESSAGE_BYTES,
  HARD_MAX_WORKER_RESULT_BYTES,
  HARD_MAX_WORKER_TOOL_CALLS,
  HARD_MAX_WORKER_TOOL_CALLS_PER_TURN,
  HARD_MAX_WORKER_TURNS,
  joinWorkerText,
  measureWorkerJson,
  resolveMemoryWorkerLimits,
  resolveRecallPageLimit,
  truncateWorkerText,
} from "./limits.js";
export { HARD_MAX_FOLDED_PAYLOAD_BYTES, HARD_MAX_RENDERED_MEMORY_BYTES, boundMemoryPayload } from "./memory-bounds.js";
export { buildObservationalMemoryProjection, createFoldedMemoryDetails } from "./projection.js";
export { serializeSessionEntry, serializeSourceEntries } from "./serialize.js";
export { renderObservationalMemory } from "./render.js";
export {
  DEFAULT_KEEP_RECENT_ENTRIES,
  HARD_MAX_RECENT_MESSAGE_RENDER_BYTES,
  buildObservationalMemoryContextBlocks,
  renderRecentMessageWindow,
  selectRecentMessageEntries,
  selectRecentMessageEntryIds,
} from "./recent-messages.js";
export { recallObservationalMemory, recallObservationalMemoryBranchPage } from "./recall.js";
export {
  activeObservations,
  activeReflections,
  foldObservationalMemoryLedger,
  mergeObservationalMemoryLedgers,
  observationBlockedByInvalidation,
  recordData,
  reflectionBlockedByInvalidation,
} from "./ledger.js";
export { assertNoRemovedFlatKeys, defaultObservationalMemorySettings, resolveObservationalMemorySettings } from "./settings.js";
export { createObservationalMemoryCompactor } from "./strategy.js";
export { estimateEntryTokens, estimateMessageTokens, estimateTextTokens } from "./tokens.js";
export {
  TASK_STATE_RECORDED,
  isTaskStateRecordedData,
  FOLDED_MEMORY,
  OBSERVATIONS_DROPPED,
  OBSERVATIONS_RECORDED,
  REFLECTIONS_RECORDED,
  coverageTierValues,
  foldedMemoryFromEntry,
  isFoldedMemoryDetails,
  isMemoryId,
  isMemoryObservation,
  isMemoryReflection,
  isObservationsDroppedData,
  isObservationsRecordedData,
  isReflectionsRecordedData,
  relevanceValues,
} from "./types.js";
export {
  eligibleObservationSources,
  eligibleObservationTokenCount,
  isEligibleObservationSourceEntry,
  observationsUncoveredByReflection,
  unscannedEntries,
} from "./coverage-helpers.js";
export { ObservationalMemoryError, ObservationalMemoryLimitError } from "./errors.js";
export { runMemoryWorkerLoop } from "./worker-loop.js";
export { coverageTier } from "./workers/coverage.js";
export { DEFAULT_DROPPER_INSTRUCTION, dropObservationsToTarget, runDropper } from "./workers/dropper.js";
export { DEFAULT_OBSERVER_INSTRUCTION, runObserver } from "./workers/observer.js";
export { DEFAULT_REFLECTOR_INSTRUCTION, runReflector } from "./workers/reflector.js";
export {
  DEFAULT_COMPACT_AFTER_TOKENS,
  DEFAULT_CONTEXT_RECENT_MESSAGES,
  DEFAULT_DROPPER_TARGET_TOKENS,
  DEFAULT_OBSERVER_MESSAGE_TOKENS,
  DEFAULT_REFLECTOR_OBSERVATION_TOKENS,
  OBSERVATIONS_POOL_MAX_TOKENS,
  OBSERVATIONS_POOL_TARGET_TOKENS,
  memoryObservationalConfigSchema,
  resolveMemoryObservationalConfig,
} from "./config.js";
export {
  OM_LEDGER_KEY,
  OM_STATE_KEY,
  initialObservationalMemoryState,
  ledgerOf,
  readObservationalMemoryState,
  storedModelRef,
  toStoredModelRef,
  writeObservationalMemoryState,
} from "./state.js";
export { memoryBlocksFrom, observationalMemoryBlock } from "./context.js";
export { createObservationalCompactor } from "./compactor.js";
export { createObservationalFlush } from "./flush.js";
export { createObservationalRecallTool } from "./recall-tool.js";
export { createObservationalMemoryCommands } from "./commands.js";

export type { MemoryWorkerLimitOptions, ResolvedMemoryWorkerLimits } from "./limits.js";
export type { BoundedMemoryPayload } from "./memory-bounds.js";
export type { ObservationalMemoryProjection } from "./projection.js";
export type { RenderObservationalMemoryOptions } from "./render.js";
export type { ObservationalMemoryContextOptions, RecentMessageWindowOptions } from "./recent-messages.js";
export type {
  MemoryRecallResult,
  RecallBranchPageRequest,
  RecallBranchPageResult,
  RecallKind,
  RecallMemoryOptions,
  RecallPageDetail,
  RecallPageDirection,
} from "./recall.js";
export type { ObservationalMemoryLedger, ObservationalMemoryLedgerSource, ObservationalMemoryRecord } from "./ledger.js";
export type {
  ObservationalMemoryContextSettings,
  ObservationalMemoryContextSettingsInput,
  ObservationalMemoryDropperPolicy,
  ObservationalMemoryDropperSettings,
  ObservationalMemoryDropperSettingsInput,
  ObservationalMemoryObservationSettings,
  ObservationalMemoryObservationSettingsInput,
  ObservationalMemoryReflectionSettings,
  ObservationalMemoryReflectionSettingsInput,
  ObservationalMemoryRetrievalSettings,
  ObservationalMemoryRetrievalSettingsInput,
  ObservationalMemorySettings,
  ObservationalMemorySettingsInput,
} from "./settings.js";
export type { ObservationalMemoryCompactorOptions } from "./strategy.js";
export type {
  CoverageTier,
  FoldedMemoryDetails,
  MemoryTaskState,
  TaskStateRecordedData,
  MemoryId,
  MemoryObservation,
  MemoryReflection,
  MemoryRelevance,
  ObservationsDroppedData,
  ObservationsRecordedData,
  ReflectionsRecordedData,
} from "./types.js";
export type { MemoryWorkerLoopOptions } from "./worker-loop.js";
export type { RunDropperOptions } from "./workers/dropper.js";
export type { RunObserverOptions } from "./workers/observer.js";
export type { RunReflectorOptions } from "./workers/reflector.js";
export type {
  MemoryObservationalConfig,
  MemoryObservationalDropperPolicy,
  MemoryObservationalWorkerConfig,
  ResolvedMemoryObservationalConfig,
} from "./config.js";
export type { ObservationalMemoryState } from "./state.js";
export type { MemoryBlockOptions } from "./context.js";
export type { ObservationalCompactorOptions } from "./compactor.js";
export type {
  ObservationalFlush,
  ObservationalFlushDeps,
  ObservationalFlushResult,
  ObservationalFlushStatus,
  ObservationalWorkerKind,
} from "./flush.js";
export type { RecallToolOptions } from "./recall-tool.js";
export type { MemoryCommandDeps } from "./commands.js";
