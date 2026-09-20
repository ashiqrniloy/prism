export type { CustomEntryAppendOptions } from "./append-custom.js";
export type { MemoryCommandOptions } from "./commands.js";
export { createMemoryStatusCommand, createMemoryViewCommand, createObservationalMemoryCommands } from "./commands.js";
export type {
  AttachedObservationalMemorySession,
  CreateObservationalMemoryOptions,
  ObservationalMemory,
  ObservationalMemoryAppendOptions,
  ObservationalMemoryAttachOptions,
  ObservationalMemoryContextConfig,
  ObservationalMemoryDropperConfig,
  ObservationalMemoryObservationConfig,
  ObservationalMemoryReflectionConfig,
  ObservationalMemoryRetrievalConfig,
  ObservationalMemoryWorkerConfig,
} from "./compose.js";
export { createObservationalMemory, resumeAgentRun, resumeAgentRunStream } from "./compose.js";
export {
  eligibleObservationSources,
  eligibleObservationTokenCount,
  isEligibleObservationSourceEntry,
  observationsUncoveredByReflection,
  unscannedEntries,
} from "./coverage-helpers.js";
export { createObservationalMemoryDropHandler } from "./drop-invalidated.js";
export type { ObservationalMemoryExtensionOptions } from "./extension.js";
export { createObservationalMemoryExtension } from "./extension.js";
export { createMemoryId, isMemoryId } from "./ids.js";
export type { ObservationalMemoryLedger } from "./ledger.js";
export { activeObservations, foldObservationalMemoryLedger, mergeObservationalMemoryLedgers } from "./ledger.js";
export type { MemoryWorkerLimitOptions, ResolvedMemoryWorkerLimits } from "./limits.js";
export {
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
  resolveMemoryWorkerLimits,
  resolveRecallPageLimit,
} from "./limits.js";
export type { BoundedMemoryPayload } from "./memory-bounds.js";
export { boundMemoryPayload, HARD_MAX_FOLDED_PAYLOAD_BYTES, HARD_MAX_RENDERED_MEMORY_BYTES } from "./memory-bounds.js";
export type { ObservationalMemoryProjection } from "./projection.js";
export { buildObservationalMemoryProjection, createFoldedMemoryDetails } from "./projection.js";
export type {
  MemoryRecallResult,
  RecallBranchPageRequest,
  RecallBranchPageResult,
  RecallKind,
  RecallMemoryOptions,
  RecallPageDetail,
  RecallPageDirection,
} from "./recall.js";
export { recallObservationalMemory, recallObservationalMemoryBranchPage } from "./recall.js";
export type { ObservationalMemoryContextOptions, RecentMessageWindowOptions } from "./recent-messages.js";
export {
  buildObservationalMemoryContextBlocks,
  DEFAULT_KEEP_RECENT_ENTRIES,
  HARD_MAX_RECENT_MESSAGE_RENDER_BYTES,
  renderRecentMessageWindow,
  selectRecentMessageEntries,
  selectRecentMessageEntryIds,
} from "./recent-messages.js";
export type { RenderObservationalMemoryOptions } from "./render.js";
export { renderObservationalMemory } from "./render.js";
export type {
  ObservationalMemoryFlushOptions,
  ObservationalMemoryFlushResult,
  ObservationalMemoryRuntime,
  ObservationalMemoryRuntimeStatus,
  ObservationalMemoryWorkerRuntimeConfig,
} from "./runtime.js";
export { createObservationalMemoryRuntime } from "./runtime.js";
export type {
  WorkBindRef,
  WorkScope,
  WorkScopeBoundData,
  WorkScopeClosedData,
  WorkScopeController,
  WorkScopeControllerOptions,
  WorkScopeEnteredData,
  WorkScopeEntryData,
  WorkScopeGrantedData,
  WorkScopeId,
  WorkScopeLeftData,
  WorkScopeMap,
  WorkScopeOpenedData,
  WorkScopeRevokedData,
  WorkScopeSpec,
  WorkScopeUnboundData,
} from "./scopes.js";
export {
  createWorkScopeController,
  foldWorkScopeGrants,
  foldWorkScopeMap,
  isWorkBindRef,
  isWorkPrincipalId,
  isWorkScopeBoundData,
  isWorkScopeClosedData,
  isWorkScopeEnteredData,
  isWorkScopeGrantedData,
  isWorkScopeId,
  isWorkScopeLeftData,
  isWorkScopeOpenedData,
  isWorkScopeRevokedData,
  isWorkScopeUnboundData,
  MAX_WORK_PRINCIPAL_ID_CHARS,
  MAX_WORK_SCOPE_BINDS,
  MAX_WORK_SCOPE_DEPTH,
  MAX_WORK_SCOPE_LABEL_CHARS,
  MAX_WORK_SCOPE_PRINCIPALS,
  MAX_WORK_SCOPE_STACK,
  MAX_WORK_SCOPES,
  SESSION_WORK_SCOPE_ID,
  WORK_SCOPE_BOUND,
  WORK_SCOPE_CLOSED,
  WORK_SCOPE_ENTERED,
  WORK_SCOPE_GRANTED,
  WORK_SCOPE_LEFT,
  WORK_SCOPE_OPENED,
  WORK_SCOPE_REVOKED,
  WORK_SCOPE_UNBOUND,
  withWorkScope,
} from "./scopes.js";
export type {
  ProjectWorkMemoryOptions,
  WorkMemoryProjection,
  WorkScopeClosed,
  WorkScopeInclude,
  WorkScopeOutline,
} from "./scopes-project.js";
export { projectWorkMemory } from "./scopes-project.js";
export { serializeSessionEntry, serializeSourceEntries } from "./serialize.js";
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
export { defaultObservationalMemorySettings, resolveObservationalMemorySettings } from "./settings.js";
export type {
  MergedSharedScopes,
  ResolveSharedScopesOptions,
  SharedScopeAccessEvent,
  SharedScopeAccessReason,
  SharedScopeMemory,
  SharedWorkScopeConfig,
  SharedWorkScopeConfigEntry,
} from "./shared-scopes.js";
export { mergeSharedScopes, resolveSharedScopes } from "./shared-scopes.js";
export type { ObservationalMemoryCompactionStrategyOptions } from "./strategy.js";
export { createObservationalMemoryCompactionStrategy } from "./strategy.js";
export { estimateEntryTokens, estimateMessageTokens, estimateTextTokens } from "./tokens.js";
export type { GetMemoryEntries, RecallMemoryToolOptions } from "./tool.js";
export { createRecallMemoryTool } from "./tool.js";
export type {
  CoverageTier,
  FoldedMemoryDetails,
  MemoryId,
  MemoryObservation,
  MemoryReflection,
  MemoryRelevance,
  ObservationsDroppedData,
  ObservationsRecordedData,
  ReflectionsRecordedData,
} from "./types.js";
export {
  coverageTierValues,
  FOLDED_MEMORY,
  foldedMemoryFromEntry,
  isFoldedMemoryDetails,
  isMemoryObservation,
  isMemoryReflection,
  isObservationsDroppedData,
  isObservationsRecordedData,
  isReflectionsRecordedData,
  OBSERVATIONS_DROPPED,
  OBSERVATIONS_RECORDED,
  REFLECTIONS_RECORDED,
  relevanceValues,
} from "./types.js";
export { coverageTier } from "./workers/coverage.js";
export type { RunDropperOptions } from "./workers/dropper.js";
export { DEFAULT_DROPPER_INSTRUCTION, dropObservationsToTarget, runDropper } from "./workers/dropper.js";
export type { RunObserverOptions } from "./workers/observer.js";
export { DEFAULT_OBSERVER_INSTRUCTION, runObserver } from "./workers/observer.js";
export type { RunReflectorOptions } from "./workers/reflector.js";
export { DEFAULT_REFLECTOR_INSTRUCTION, runReflector } from "./workers/reflector.js";

export const packageName = "@arnilo/prism-memory/compaction/observational-memory";
