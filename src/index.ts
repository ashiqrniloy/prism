export type { AgentEventSourceErrorCode, CheckpointRestoreAudit, CheckpointRestoreAuditEntry } from "./contracts-protocol.js";
export { AgentEventSourceError, isKnownAgentEventType, isTerminalAgentEventType } from "./contracts-protocol.js";
export { ContextOverflowError } from "./agent-session/context-overflow.js";
export type { PendingToolCall, StoredAgentRunState } from "./agent-run-state.js";
export {
  AGENT_RUN_STATE_SCHEMA_VERSION,
  agentFingerprint,
  DEFAULT_MAX_AGENT_RUN_STATE_BYTES,
  HARD_MAX_AGENT_RUN_STATE_BYTES,
} from "./agent-run-state.js";
export { SubscriberOverflowError } from "./agent-session/event-subscriber.js";
export { createAgent } from "./agents.js";
export type { DefaultCompactorOptions } from "./compaction.js";
export { createDefaultCompactor, isCompactionEntryData } from "./compaction.js";
export type { ConfigLayer, ConfigLoadContext, ConfigProvider } from "./config.js";
export { assertJsonObject, isJsonObject, loadConfigLayers, mergeConfigLayers } from "./config.js";
export type {
  AudioContent,
  DocumentContent,
  FileContent,
  MediaContentBlock,
  MediaContentBounds,
  MediaHostAddress,
  MediaHostnameResolver,
  MediaMimePolicy,
  MediaUrlRequest,
  MediaUrlRequester,
  ModelInputCapability,
  ResolvedMediaContent,
  ResolveMediaContentOptions,
  SsrfPolicy,
} from "./content.js";
export {
  assertDeclaredMediaTypeMatches,
  assertMediaBlocksWithinBounds,
  assertMessagesSupportModelCapabilities,
  assertModelSupportsContentBlocks,
  assertSsrfAllowedUrl,
  collectMessageContentBlocks,
  contentBlockInputModality,
  DEFAULT_MAX_AUDIO_DURATION_MS,
  DEFAULT_MAX_MEDIA_ITEM_BYTES,
  DEFAULT_MAX_MEDIA_ITEMS_PER_REQUEST,
  DEFAULT_MAX_MEDIA_REQUEST_BYTES,
  DEFAULT_MEDIA_FETCH_TIMEOUT_MS,
  loadBoundedBinaryResource,
  MediaContentError,
  MODEL_INPUT_CAPABILITIES,
  resolveMediaContentBlock,
  resolveMediaContentBlocks,
  sniffMediaMimeType,
  UnsupportedModalityError,
} from "./content.js";
export type { ContextSource } from "./context-build.js";
export { registerContextSources, withContextBlocks } from "./context-build.js";
export type * from "./contracts.js";
export type {
  EvaluationRecord,
  EvaluationStatus,
  EvaluationQuery,
  EvaluationStore,
  ExperimentReportRecord,
  ExperimentReportQuery,
  ExperimentReportStore,
} from "./contracts-core/persistence.js";
export type {
  ApprovalOutcome,
  CompactionTrigger,
  CompactionTriggerContext,
  ContextMeter,
  Decision,
  DecisionScope,
  ModelFamily,
  NestedRunApproval,
  NestedRunOutcome,
  NestedRunRef,
  PendingDecision,
  PendingDecisionKind,
  ProviderResolver,
  ResolveShouldCompactInput,
  ResolveShouldCompactOptions,
  ResumeNestedRun,
  RunLimitCounters,
  RunLimitName,
  StickyDecision,
  TokenEstimate,
  TokenEstimateConfidence,
  ToolCallAuthority,
  ToolCapabilityKind,
  ToolEffectClassifier,
  ToolEffectDeclaration,
  ToolEffectIdempotency,
  ToolEffectKey,
  ToolEffectKind,
  ToolEffectRecord,
  ToolEffectStatus,
  ToolEffectStore,
  ToolEffectTransition,
  ToolElicitationRequest,
} from "./contracts.js";
export {
  AGENT_DISPOSED_CODE,
  AgentDisposedError,
  AgentDecisionError,
  AgentDelegationSuspendedError,
  AgentLoopStateError,
  AgentRunStateError,
  assertCompactionTrigger,
  assertDecisionRequest,
  assertDecisionsSupported,
  assertEmbeddingsSupported,
  assertSessionMetadataKey,
  DEFAULT_MAX_DECISION_IMAGE_BYTES,
  DEFAULT_MAX_DECISION_STATE_BYTES,
  DEFAULT_MAX_PENDING_DECISIONS,
  DEFAULT_MAX_PENDING_STEER_BYTES,
  DEFAULT_MAX_PENDING_STEERS,
  DEFAULT_MAX_SESSION_SEARCH_CURSOR_BYTES,
  DEFAULT_MAX_SESSION_SEARCH_FTS_CANDIDATES,
  DEFAULT_MAX_SESSION_SEARCH_LINEAR_BYTES,
  DEFAULT_MAX_SESSION_SEARCH_LINEAR_ENTRIES,
  DEFAULT_MAX_SESSION_SEARCH_LINEAR_SESSIONS,
  DEFAULT_MAX_SESSION_SEARCH_QUERY_BYTES,
  DEFAULT_MAX_SESSION_SEARCH_SNIPPET_BYTES,
  DEFAULT_MAX_STICKY_DECISIONS,
  DEFAULT_SESSION_LIST_LIMIT,
  DEFAULT_SESSION_SEARCH_LIMIT,
  DEFAULT_SNAPSHOT_CACHE_TTL_MS,
  DecisionsError,
  EmbeddingsError,
  HARD_MAX_ACTION_CONSTRAINT_BYTES,
  HARD_MAX_ACTION_CONSTRAINTS,
  HARD_MAX_DECISION_REASON_BYTES,
  HARD_MAX_ELICITATION_BYTES,
  HARD_MAX_PENDING_DECISIONS,
  HARD_MAX_PENDING_STEER_BYTES,
  HARD_MAX_PENDING_STEERS,
  HARD_MAX_SESSION_LIST_LIMIT,
  HARD_MAX_SESSION_SEARCH_CURSOR_BYTES,
  HARD_MAX_SESSION_SEARCH_FTS_CANDIDATES,
  HARD_MAX_SESSION_SEARCH_LIMIT,
  HARD_MAX_SESSION_SEARCH_LINEAR_BYTES,
  HARD_MAX_SESSION_SEARCH_LINEAR_ENTRIES,
  HARD_MAX_SESSION_SEARCH_LINEAR_SESSIONS,
  HARD_MAX_SESSION_SEARCH_QUERY_BYTES,
  HARD_MAX_SESSION_SEARCH_SNIPPET_BYTES,
  HARD_MAX_SNAPSHOT_CACHE_TTL_MS,
  HARD_MAX_STICKY_DECISIONS,
  assertSessionLinkFilter,
  assertSessionLinks,
  isSessionAppendConflict,
  isSessionEntryKind,
  isSessionMetadataConflict,
  isSessionNotFound,
  isSessionSearchUnsupported,
  isUnsupportedStoreCapability,
  MAX_ACTION_CONSTRAINT_BYTES,
  MAX_ACTION_CONSTRAINTS,
  MAX_ATTRIBUTION_DEPTH,
  MAX_DECISION_CHOICE_OPTIONS,
  MAX_DECISION_QUESTIONS,
  MAX_DECISION_REASON_BYTES,
  MAX_DECISION_SCORE_LEVELS,
  MAX_ELICITATION_BYTES,
  MAX_SESSION_LINK_ID_LENGTH,
  modelSupportsDecisions,
  modelSupportsEmbeddings,
  OWNERSHIP_WIDEN_CODE,
  OwnershipScopeError,
  resolveSessionSearchQuery,
  resolveShouldCompact,
  SESSION_APPEND_CONFLICT_CODE,
  SESSION_ENTRY_KINDS,
  SESSION_ENTRY_SCHEMA_VERSION,
  SESSION_LINKS_DATA_KEY,
  SESSION_METADATA_CONFLICT_CODE,
  SESSION_NOT_FOUND_CODE,
  SESSION_SEARCH_UNSUPPORTED_CODE,
  SESSION_SEARCH_WORKSPACE_METADATA_KEY,
  SESSION_TITLE_MAX_LENGTH,
  SESSION_TITLE_METADATA_KEY,
  SessionAppendConflictError,
  SessionMetadataConflictError,
  SessionNotFoundError,
  SessionSearchUnsupportedError,
  toRunResultStatus,
  UNSUPPORTED_STORE_CAPABILITY_CODE,
  UnsupportedStoreCapabilityError,
} from "./contracts.js";
// Plan 159 Task 8: `Principal` is the only identity type the kernel names; the rest of the identity
// module moved to `@arnilo/prism-extensions/governance`.
export type { Principal } from "./contracts-core/principal.js";
export { parseAgentFile, parseSkillFile } from "./contribution-parsing.js";
export type { CredentialRecord } from "./credentials/index.js";
export { CredentialRefNotWritableError, CredentialStoreUnavailableError } from "./credentials/index.js";

export type { GuardrailRunResult, RunGuardrailListOptions } from "./guardrails.js";
export {
  assertGuardrailsAllowed,
  GuardrailError,
  guardrailRefusalText,
  MAX_GUARDRAIL_CONCURRENCY,
  runGuardrailList,
} from "./guardrails.js";
export type {
  AroundHook,
  AroundHookName,
  CompactionWhenDecision,
  CompactionWhenPayload,
  ContextDraft,
  DecideHook,
  DecideHookName,
  HookCatalog,
  HookContext,
  HookDecision,
  HookHandler,
  HookKind,
  HookName,
  HookOptions,
  HookPayload,
  HookRegistrar,
  HookRegistrationInfo,
  HookRejection,
  HookResult,
  ModelRequestTransformResult,
  NamedHookCatalog,
  NamedHookName,
  ObserveHook,
  ObserveHookName,
  RunEndDecision,
  RunEndPayload,
  ToolCallDecision,
  ToolCallHookPayload,
  ToolExecuteHookPayload,
  TransformHook,
  TransformHookName,
  TurnBeforeDecision,
  TurnBeforePayload,
} from "./hooks/index.js";
export { askEveryTool, HOOK_CATALOG, HookError, HookRejectedError, UnknownHookError } from "./hooks/index.js";
export type {
  HostPort,
  HostUi,
  HostUiAnswerMap,
  HostUiConfirmRequest,
  HostUiInputRequest,
  HostUiNotifyRequest,
  HostUiTerminalRequest,
  HostUiOpenUrlRequest,
  HostUiRequest,
  HostUiRequestBase,
  HostUiRequestKind,
  HostUiResponse,
  HostUiSecretRequest,
  HostUiSelectOption,
  HostUiSelectRequest,
} from "./host/index.js";
export type {
  AgentInput,
  AssembleProviderInputOptions,
  DefaultInputBuildContext,
  DefaultInputBuilder,
  InputAttachment,
  PromptInstruction,
  PromptTemplateOptions,
} from "./input.js";
export {
  assembleProviderInput,
  createDefaultInputBuilder,
  EMPTY_TOOL_RESULT_TEXT,
  formatUntrustedToolText,
  renderPromptTemplate,
  UNTRUSTED_EXTERNAL_TRUST,
} from "./input.js";
export type {
  ExternalActivity,
  ExternalAskSupport,
  ExternalToolDecision,
  ExternalToolRequest,
  LoopStrategy,
  RunController,
  RunEndResult,
  RunTurnOptions,
  RunTurnResult,
} from "./loop/index.js";
export { defaultLoop } from "./loop/index.js";
export { CredentialUnavailableError } from "./models/builtin.js";
export type { InputCapOptions, TokenEstimator } from "./models/estimate.js";
export {
  DEFAULT_INPUT_RESERVE_TOKENS,
  estimateAssemblyTokens,
  estimateMessageBytes,
  estimateMessageTokens,
  estimateTextBytes,
  estimateTextTokens,
  resolveInputCap,
} from "./models/estimate.js";
export {
  mapProviderStopReason,
  providerContentDelta,
  providerContinuationRequired,
  providerDone,
  providerError,
  providerTextDelta,
  providerThinkingDelta,
  providerToolCall,
  providerToolCallDelta,
  providerUsage,
  toolCallContent,
  toolCallFromArgumentsText,
} from "./models/events.js";
export type { ProviderRegistry, ProviderRegistryOptions } from "./models/providers.js";
export { createProviderRegistry, createProviderResolver } from "./models/providers.js";
export { ModelRefError, parseModelRef } from "./models/ref.js";
export type { ModelRegistry, ModelRegistryOptions } from "./models/registry.js";
export { createModelRegistry } from "./models/registry.js";
export type { DefaultRetryPolicyOptions } from "./models/retry.js";
export { createDefaultRetryPolicy, isTransientErrorInfo, waitForRetry } from "./models/retry.js";
// Node-only path helpers, exported from the root so an external context/files package can reuse
// them instead of copying security-critical containment code. Importing them pulls node:fs/promises
// into the root entry graph.
export { createPathTrustPolicy, isPathInside, isPathInsideReal } from "./node/trust.js";
export { createProviderTurnMetadata, readProviderHttpStatus } from "./observability.js";
export type { SecretRedactor } from "./redaction.js";
export {
  createSecretRedactor,
  errorToErrorInfo,
  redactAgentEvent,
  redactMessage,
  redactProviderRequest,
  redactRunLedgerRecord,
  redactSecrets,
  redactSessionEntry,
  resolveRedactor,
} from "./redaction.js";
export type { DuplicateRegistrationOptions, DuplicateRegistrationPolicy } from "./registry-options.js";
export type { LoadBinaryResourceOptions } from "./resources.js";
export { loadBinaryResource, loadJsonResource, loadTextResource } from "./resources.js";
export { isFlushableRunLedger } from "./run-ledger.js";
export type { BudgetExhaustionAttribution, RunLimitTracker, RunLimitTrackerOptions } from "./run-limits.js";
export {
  createRunLimitTracker,
  DEFAULT_RUN_LIMITS,
  HARD_RUN_LIMITS,
  RunLimitError,
  resolveRunLimits,
} from "./run-limits.js";
export type { PermissionDecision, PermissionPolicy, PermissionRequest, TrustDecision, TrustPolicy, TrustRequest } from "./security.js";
export {
  assertPermission,
  assertTrusted,
  checkPermission,
  createStaticPermissionPolicy,
  createStaticTrustPolicy,
  denialToErrorInfo,
  isTrusted,
  PermissionDeniedError,
  TrustDeniedError,
} from "./security.js";
export type {
  CreateMemorySessionStoreOptions,
  CreateSessionEntryOptions,
  MemorySessionSearchMode,
  SessionBranch,
  SessionBranchOptions,
  SessionContextSnapshot,
} from "./session-stores.js";
export {
  createMemorySessionStore,
  createSessionEntry,
  getSessionBranchEntries,
  listSessionBranches,
  rebuildSessionContext,
  sessionLinksMatch,
  sessionLinksOf,
  sessionLinksOfEntry,
  sessionStoreCapabilities,
  summaryLinkFields,
} from "./session-stores.js";
export { selectTranscript, type TranscriptOptions, type TranscriptSlice } from "./agent-session/transcript.js";
export { createSessionIndex } from "./agent/sessions.js";
export type { LoadedSkillSet, SkillRenderContext, SkillsDisclosure } from "./skill-disclosure.js";
export {
  createLoadedSkillSet,
  DEFAULT_MAX_SKILL_CATALOG_ENTRIES,
  DEFAULT_MAX_SKILL_DESCRIPTION_BYTES,
  DEFAULT_MAX_SKILL_INSTRUCTION_BYTES,
  EMPTY_SKILL_DESCRIPTION,
  HARD_MAX_SKILL_INSTRUCTION_BYTES,
  resolveSkillsDisclosure,
} from "./skill-disclosure.js";
export type {
  CreateLoadSkillToolOptions,
  LoadedSkillBodiesEntry,
  ResolveSkillLoadOptions,
} from "./skill-load.js";
export {
  applyRestoredSkillBodies,
  createLoadSkillTool,
  DEFAULT_LOAD_SKILL_TOOL_NAME,
  HARD_MAX_PERSISTED_SKILL_BODY_TOTAL_BYTES,
  isSkillLoadError,
  MAX_LOAD_SKILL_RESULT_BYTES,
  MAX_PERSISTED_SKILL_BODIES,
  MAX_PERSISTED_SKILL_BODY_BYTES,
  MAX_PERSISTED_SKILL_BODY_NAME_CHARS,
  resolveSkillLoad,
  SKILL_LOAD_ERROR_CODE,
  SkillLoadError,
  snapshotLoadedSkillBodies,
  validateLoadedSkillBodies,
} from "./skill-load.js";
export type { ResolveActiveSkillsOptions, SkillRegistryOptions } from "./skills.js";
export { createSkillRegistry, resolveActiveSkills } from "./skills.js";
export type { Compactor, SlotAssignments, SlotContracts, SlotName, SlotProvider, SlotRegistry } from "./slots/index.js";
export {
  createEnvRefCredentialResolver,
  createSlotDefaults,
  createSlotRegistry,
  SlotConflictError,
  UnknownSlotError,
  UnknownSlotOwnerError,
} from "./slots/index.js";
export type { SuspendedRunEntryData, SuspendedRunLoopRef } from "./suspended-run.js";
export { loadSuspendedRunEntry, parseSuspendedRunEntry, SUSPENDED_RUN_ENTRY_SCHEMA_VERSION } from "./suspended-run.js";
export type { ComposeSystemPromptOptions } from "./system-prompts.js";
export { composeSystemPrompt, mergeSystemPromptConfig } from "./system-prompts.js";
export type { ToolEffectErrorCode } from "./tool-effects.js";
export { createMemoryToolEffectStore, ToolEffectError } from "./tool-effects.js";
export type {
  DispatchToolCallOptions,
  ToolArgumentValidationError,
  ToolArgumentValidationResult,
  ToolArgumentValidator,
  ToolFilter,
  ToolFilterInput,
  ToolParameterValidatorOptions,
  ToolRegistryOptions,
  ToolValidator,
} from "./tools.js";
export {
  createToolParameterValidator,
  createToolRegistry,
  dispatchToolCall,
  filterTools,
  resolveToolEffects,
  ToolDefinitionError,
} from "./tools.js";
export { trimTrailingSlashes } from "./trim-trailing-slashes.js";

export const name = "prism";
export const version = "0.13.0";
export const description = "Agent harness for AI providers, agents, sessions, and tools.";
export type { AgentInspection, InspectedContribution, InspectedHook, InspectedPackage } from "./agent/inspect.js";
export type { Logger } from "./host/types.js";
export type {
  Capability,
  JsonSchema,
  ModelClient,
  PackageAPI,
  PackageCommand,
  PackageCommandContext,
  PackageCommandInfo,
  PackageConfigSource,
  PackageDefinition,
  PackageDefinitionInput,
  PackageInput,
  PackageInstance,
  PackageInstanceOptions,
  PackageLoadErrorCode,
  PackageRequires,
  PackageSource,
  PackageToolOptions,
  SlotRegistrar,
  SlotRegistrarEntry,
} from "./packages/index.js";
export { definePackage, PackageLoadError, validateJsonSchema } from "./packages/index.js";
export { KERNEL_API_LEVEL } from "./version.js";
export type { ExternalStateData, ExternalStateHandle } from "./session/external-state.js";
export type { AgentState, SessionLog, SessionState } from "./session/state.js";
export type { SessionContext } from "./session-context.js";
