import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

// Read every file under a directory tree matching a suffix (layout-agnostic union for split modules).
function readTree(dir: string, suffix: string): string {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(readTree(full, suffix));
    else if (ent.name.endsWith(suffix)) out.push(readFileSync(full, "utf8"));
  }
  return out.join("\n");
}

// ponytail: SDK surface freeze. The root `@arnilo/prism` barrel is the public
// API; these two snapshots pin every value and type export of `src/index.ts` so
// any add/remove is a deliberate test update, not silent drift. Plan 174 Task 8:
// the kernel publishes TypeScript source, so value exports are resolved against the
// live `src/index.ts` module (Bun strips the types) and type exports against the
// source declaration surface `src/index.ts` re-exports — there is no `dist/` emit
// to check any more. Update both arrays together when the surface changes.
const FROZEN_VALUE_EXPORTS: readonly string[] = [
  "AGENT_DISPOSED_CODE",
  "AGENT_RUN_STATE_SCHEMA_VERSION",
  "AgentDisposedError",
  "AgentDecisionError",
  "AgentDelegationSuspendedError",
  "AgentEventSourceError",
  "AgentLoopStateError",
  "AgentRunStateError",
  "ContextOverflowError",
  "CredentialRefNotWritableError",
  "CredentialStoreUnavailableError",
  "CredentialUnavailableError",
  "DecisionsError",
  "DEFAULT_INPUT_RESERVE_TOKENS",
  "DEFAULT_LOAD_SKILL_TOOL_NAME",
  "DEFAULT_MAX_AGENT_RUN_STATE_BYTES",
  "DEFAULT_MAX_AUDIO_DURATION_MS",
  "DEFAULT_MAX_DECISION_IMAGE_BYTES",
  "DEFAULT_MAX_DECISION_STATE_BYTES",
  "DEFAULT_MAX_MEDIA_ITEMS_PER_REQUEST",
  "DEFAULT_MAX_MEDIA_ITEM_BYTES",
  "DEFAULT_MAX_MEDIA_REQUEST_BYTES",
  "DEFAULT_MAX_PENDING_DECISIONS",
  "DEFAULT_MAX_PENDING_STEERS",
  "DEFAULT_MAX_PENDING_STEER_BYTES",
  "DEFAULT_MAX_SESSION_SEARCH_CURSOR_BYTES",
  "DEFAULT_MAX_SESSION_SEARCH_FTS_CANDIDATES",
  "DEFAULT_MAX_SESSION_SEARCH_LINEAR_BYTES",
  "DEFAULT_MAX_SESSION_SEARCH_LINEAR_ENTRIES",
  "DEFAULT_MAX_SESSION_SEARCH_LINEAR_SESSIONS",
  "DEFAULT_MAX_SESSION_SEARCH_QUERY_BYTES",
  "DEFAULT_MAX_SESSION_SEARCH_SNIPPET_BYTES",
  "DEFAULT_MAX_SKILL_CATALOG_ENTRIES",
  "DEFAULT_MAX_SKILL_DESCRIPTION_BYTES",
  "DEFAULT_MAX_SKILL_INSTRUCTION_BYTES",
  "DEFAULT_MAX_STICKY_DECISIONS",
  "DEFAULT_MEDIA_FETCH_TIMEOUT_MS",
  "DEFAULT_RUN_LIMITS",
  "DEFAULT_SESSION_LIST_LIMIT",
  "DEFAULT_SESSION_SEARCH_LIMIT",
  "DEFAULT_SNAPSHOT_CACHE_TTL_MS",
  "EMPTY_SKILL_DESCRIPTION",
  "EMPTY_TOOL_RESULT_TEXT",
  "UNTRUSTED_EXTERNAL_TRUST",
  "EmbeddingsError",
  "GuardrailError",
  "HARD_MAX_ACTION_CONSTRAINTS",
  "HARD_MAX_ACTION_CONSTRAINT_BYTES",
  "HARD_MAX_AGENT_RUN_STATE_BYTES",
  "HARD_MAX_DECISION_REASON_BYTES",
  "HARD_MAX_ELICITATION_BYTES",
  "HARD_MAX_PENDING_DECISIONS",
  "HARD_MAX_PENDING_STEERS",
  "HARD_MAX_PENDING_STEER_BYTES",
  "HARD_MAX_PERSISTED_SKILL_BODY_TOTAL_BYTES",
  "HARD_MAX_SESSION_LIST_LIMIT",
  "HARD_MAX_SESSION_SEARCH_CURSOR_BYTES",
  "HARD_MAX_SESSION_SEARCH_FTS_CANDIDATES",
  "HARD_MAX_SESSION_SEARCH_LIMIT",
  "HARD_MAX_SESSION_SEARCH_LINEAR_BYTES",
  "HARD_MAX_SESSION_SEARCH_LINEAR_ENTRIES",
  "HARD_MAX_SESSION_SEARCH_LINEAR_SESSIONS",
  "HARD_MAX_SESSION_SEARCH_QUERY_BYTES",
  "HARD_MAX_SESSION_SEARCH_SNIPPET_BYTES",
  "HARD_MAX_SKILL_INSTRUCTION_BYTES",
  "HARD_MAX_SNAPSHOT_CACHE_TTL_MS",
  "HARD_MAX_STICKY_DECISIONS",
  "HARD_RUN_LIMITS",
  "HOOK_CATALOG",
  "HookError",
  "HookRejectedError",
  "KERNEL_API_LEVEL",
  "MAX_ACTION_CONSTRAINTS",
  "MAX_ACTION_CONSTRAINT_BYTES",
  "MAX_ATTRIBUTION_DEPTH",
  "MAX_DECISION_CHOICE_OPTIONS",
  "MAX_DECISION_QUESTIONS",
  "MAX_DECISION_REASON_BYTES",
  "MAX_DECISION_SCORE_LEVELS",
  "MAX_ELICITATION_BYTES",
  "MAX_GUARDRAIL_CONCURRENCY",
  "MAX_LOAD_SKILL_RESULT_BYTES",
  "MAX_PERSISTED_SKILL_BODIES",
  "MAX_PERSISTED_SKILL_BODY_BYTES",
  "MAX_PERSISTED_SKILL_BODY_NAME_CHARS",
  "MAX_SESSION_LINK_ID_LENGTH",
  "MODEL_INPUT_CAPABILITIES",
  "MediaContentError",
  "ModelRefError",
  "PackageLoadError",
  "OWNERSHIP_WIDEN_CODE",
  "PermissionDeniedError",
  "RunLimitError",
  "SESSION_APPEND_CONFLICT_CODE",
  "SESSION_ENTRY_KINDS",
  "SESSION_ENTRY_SCHEMA_VERSION",
  "SESSION_LINKS_DATA_KEY",
  "SESSION_METADATA_CONFLICT_CODE",
  "SESSION_NOT_FOUND_CODE",
  "SESSION_SEARCH_UNSUPPORTED_CODE",
  "SESSION_SEARCH_WORKSPACE_METADATA_KEY",
  "SESSION_TITLE_MAX_LENGTH",
  "SESSION_TITLE_METADATA_KEY",
  "SKILL_LOAD_ERROR_CODE",
  "SUSPENDED_RUN_ENTRY_SCHEMA_VERSION",
  "SessionAppendConflictError",
  "SessionMetadataConflictError",
  "SessionNotFoundError",
  "OwnershipScopeError",
  "SessionSearchUnsupportedError",
  "SkillLoadError",
  "SlotConflictError",
  "SubscriberOverflowError",
  "ToolDefinitionError",
  "ToolEffectError",
  "TrustDeniedError",
  "UNSUPPORTED_STORE_CAPABILITY_CODE",
  "UnknownHookError",
  "UnknownSlotError",
  "UnknownSlotOwnerError",
  "UnsupportedModalityError",
  "UnsupportedStoreCapabilityError",
  "agentFingerprint",
  "applyRestoredSkillBodies",
  "askEveryTool",
  "assembleProviderInput",
  "assertCompactionTrigger",
  "assertDecisionRequest",
  "assertDecisionsSupported",
  "assertDeclaredMediaTypeMatches",
  "assertEmbeddingsSupported",
  "assertGuardrailsAllowed",
  "assertJsonObject",
  "assertMediaBlocksWithinBounds",
  "assertMessagesSupportModelCapabilities",
  "assertModelSupportsContentBlocks",
  "assertPermission",
  "assertSessionLinkFilter",
  "assertSessionLinks",
  "assertSessionMetadataKey",
  "assertSsrfAllowedUrl",
  "assertTrusted",
  "checkPermission",
  "collectMessageContentBlocks",
  "composeSystemPrompt",
  "contentBlockInputModality",
  "createAgent",
  "createDefaultCompactor",
  "createDefaultInputBuilder",
  "createDefaultRetryPolicy",
  "createEnvRefCredentialResolver",
  "createLoadSkillTool",
  "createLoadedSkillSet",
  "createMemorySessionStore",
  "createMemoryToolEffectStore",
  "createModelRegistry",
  "createPathTrustPolicy",
  "createProviderRegistry",
  "createProviderResolver",
  "createProviderTurnMetadata",
  "createRunLimitTracker",
  "createSecretRedactor",
  "createSessionEntry",
  "createSessionIndex",
  "createSkillRegistry",
  "createSlotDefaults",
  "createSlotRegistry",
  "createStaticPermissionPolicy",
  "createStaticTrustPolicy",
  "createToolParameterValidator",
  "createToolRegistry",
  "defaultLoop",
  "definePackage",
  "denialToErrorInfo",
  "description",
  "dispatchToolCall",
  "errorToErrorInfo",
  "estimateAssemblyTokens",
  "estimateMessageBytes",
  "estimateMessageTokens",
  "estimateTextBytes",
  "estimateTextTokens",
  "filterTools",
  "formatUntrustedToolText",
  "getSessionBranchEntries",
  "guardrailRefusalText",
  "isCompactionEntryData",
  "isFlushableRunLedger",
  "isJsonObject",
  "isKnownAgentEventType",
  "isPathInside",
  "isPathInsideReal",
  "isSessionAppendConflict",
  "isSessionEntryKind",
  "isSessionMetadataConflict",
  "isSessionNotFound",
  "isSessionSearchUnsupported",
  "isSkillLoadError",
  "isTerminalAgentEventType",
  "isTransientErrorInfo",
  "isTrusted",
  "isUnsupportedStoreCapability",
  "listSessionBranches",
  "loadBinaryResource",
  "loadBoundedBinaryResource",
  "loadConfigLayers",
  "loadJsonResource",
  "loadSuspendedRunEntry",
  "loadTextResource",
  "mapProviderStopReason",
  "mergeConfigLayers",
  "mergeSystemPromptConfig",
  "modelSupportsDecisions",
  "modelSupportsEmbeddings",
  "name",
  "parseAgentFile",
  "parseModelRef",
  "parseSkillFile",
  "parseSuspendedRunEntry",
  "providerContentDelta",
  "providerContinuationRequired",
  "providerDone",
  "providerError",
  "providerTextDelta",
  "providerThinkingDelta",
  "providerToolCall",
  "providerToolCallDelta",
  "providerUsage",
  "readProviderHttpStatus",
  "rebuildSessionContext",
  "redactAgentEvent",
  "redactMessage",
  "redactProviderRequest",
  "redactRunLedgerRecord",
  "redactSecrets",
  "redactSessionEntry",
  "registerContextSources",
  "renderPromptTemplate",
  "resolveActiveSkills",
  "resolveInputCap",
  "resolveMediaContentBlock",
  "resolveMediaContentBlocks",
  "resolveRedactor",
  "resolveRunLimits",
  "resolveSessionSearchQuery",
  "resolveShouldCompact",
  "resolveSkillLoad",
  "resolveSkillsDisclosure",
  "resolveToolEffects",
  "runGuardrailList",
  "sessionLinksMatch",
  "sessionLinksOf",
  "selectTranscript",
  "sessionLinksOfEntry",
  "sessionStoreCapabilities",
  "snapshotLoadedSkillBodies",
  "sniffMediaMimeType",
  "summaryLinkFields",
  "toRunResultStatus",
  "toolCallContent",
  "toolCallFromArgumentsText",
  "trimTrailingSlashes",
  "validateJsonSchema",
  "validateLoadedSkillBodies",
  "version",
  "waitForRetry",
  "withContextBlocks",
];

const REQUIRED_SDK_CONTRACT_TYPES: readonly string[] = [
  "EvaluationRecord",
  "EvaluationStatus",
  "EvaluationQuery",
  "EvaluationStore",
  "ExperimentReportRecord",
  "ExperimentReportQuery",
  "ExperimentReportStore",

  "ModelProvider",
  "ProviderRequest",
  "ProviderEvent",
  "ProviderFailureClass",
  "Message",
  "ContentBlock",
  "Usage",
  "ModelConfig",
  "Agent",
  "AgentConfig",
  "Session",
  "RunResult",
  "AgentRunStatus",
  "AgentRunState",
  "AgentRunInterruption",
  "AgentRunRef",
  // Plan 168 Task 5 retired the checkpoint lifecycle: the durable run contracts that stay are the
  // decision/nested-run shapes, not a host-supplied checkpoint store.
  "Decision",
  "DecisionScope",
  "PendingDecision",
  "NestedRunRef",
  "NestedRunOutcome",
  "ResumeNestedRun",
  "AgentEventSource",
  "Principal",
  "Guardrail",
  "GuardrailDecision",
  "GuardrailRecord",
  "ResolvedRunLimits",
  "RunLimitBreach",
  "RunLimits",
  "RunOptions",
  "PromptVersionRef",
  "ToolDefinition",
  "ToolRegistry",
  "ToolResult",
  "Skill",
  "SkillRegistry",
  "SessionEntry",
  "SessionStore",
  "SessionSearchIndex",
  "SessionSearchQuery",
  "SessionSearchKind",
  "SessionSearchHit",
  "RunLedger",
  "AgentEventRecord",
  "DurableAgentEventRecord",
  "AgentEventEnvelope",
  "AgentEventSourcePage",
  "AgentEventSourceRead",
  "AgentEventSourceCleanup",
  "AgentEventSourceOptions",
  "DelegatedAgentStepData",
  "DelegatedAgentStepKind",
  "DelegatedAgentStepState",
  "DelegatedAgentStepUsage",
  "RunFeedbackStore",
  "ProductionPersistenceStore",
  "RetryPolicy",
  "CredentialResolver",
  "CredentialContext",
  "Secret",
];

const FROZEN_TYPE_EXPORTS: readonly string[] = [
  "EvaluationRecord",
  "EvaluationStatus",
  "EvaluationQuery",
  "EvaluationStore",
  "ExperimentReportRecord",
  "ExperimentReportQuery",
  "ExperimentReportStore",

  "AgentEventSourceErrorCode",
  "AgentInput",
  "AgentInspection",
  "AgentState",
  "ApprovalOutcome",
  "AroundHook",
  "AroundHookName",
  "AssembleProviderInputOptions",
  "AudioContent",
  "BudgetExhaustionAttribution",
  "Capability",
  "CheckpointRestoreAudit",
  "CheckpointRestoreAuditEntry",
  "CompactionTrigger",
  "CompactionTriggerContext",
  "CompactionWhenDecision",
  "CompactionWhenPayload",
  "Compactor",
  "ComposeSystemPromptOptions",
  "ConfigLayer",
  "ConfigLoadContext",
  "ConfigProvider",
  "ContextDraft",
  "ContextMeter",
  "ContextSource",
  "CreateLoadSkillToolOptions",
  "CreateMemorySessionStoreOptions",
  "CreateSessionEntryOptions",
  "CredentialRecord",
  "DecideHook",
  "DecideHookName",
  "Decision",
  "DecisionScope",
  "DefaultCompactorOptions",
  "DefaultInputBuildContext",
  "DefaultInputBuilder",
  "DefaultRetryPolicyOptions",
  "DispatchToolCallOptions",
  "DocumentContent",
  "DuplicateRegistrationOptions",
  "DuplicateRegistrationPolicy",
  "ExternalActivity",
  "ExternalAskSupport",
  "ExternalStateData",
  "ExternalStateHandle",
  "ExternalToolDecision",
  "ExternalToolRequest",
  "FileContent",
  "GuardrailRunResult",
  "HookCatalog",
  "HookContext",
  "HookDecision",
  "HookHandler",
  "HookKind",
  "HookName",
  "HookOptions",
  "HookPayload",
  "HookRegistrar",
  "HookRegistrationInfo",
  "HookRejection",
  "HookResult",
  "HostPort",
  "HostUi",
  "HostUiAnswerMap",
  "HostUiConfirmRequest",
  "HostUiInputRequest",
  "HostUiNotifyRequest",
  "HostUiOpenUrlRequest",
  "HostUiRequest",
  "HostUiRequestBase",
  "HostUiRequestKind",
  "HostUiResponse",
  "HostUiSecretRequest",
  "HostUiSelectOption",
  "HostUiSelectRequest",
  "HostUiTerminalRequest",
  "InputAttachment",
  "InputCapOptions",
  "InspectedContribution",
  "InspectedHook",
  "InspectedPackage",
  "JsonSchema",
  "LoadBinaryResourceOptions",
  "LoadedSkillBodiesEntry",
  "LoadedSkillSet",
  "Logger",
  "LoopStrategy",
  "MediaContentBlock",
  "MediaContentBounds",
  "MediaHostAddress",
  "MediaHostnameResolver",
  "MediaMimePolicy",
  "MediaUrlRequest",
  "MediaUrlRequester",
  "MemorySessionSearchMode",
  "ModelClient",
  "ModelFamily",
  "ModelInputCapability",
  "ModelRegistry",
  "ModelRegistryOptions",
  "ModelRequestTransformResult",
  "NamedHookCatalog",
  "NamedHookName",
  "NestedRunApproval",
  "NestedRunOutcome",
  "NestedRunRef",
  "ObserveHook",
  "ObserveHookName",
  "PackageAPI",
  "PackageCommand",
  "PackageCommandContext",
  "PackageCommandInfo",
  "PackageConfigSource",
  "PackageDefinition",
  "PackageDefinitionInput",
  "PackageInput",
  "PackageInstance",
  "PackageInstanceOptions",
  "PackageLoadErrorCode",
  "PackageRequires",
  "PackageSource",
  "PackageToolOptions",
  "PendingDecision",
  "PendingDecisionKind",
  "PendingToolCall",
  "PermissionDecision",
  "PermissionPolicy",
  "PermissionRequest",
  "Principal",
  "PromptInstruction",
  "PromptTemplateOptions",
  "ProviderRegistry",
  "ProviderRegistryOptions",
  "ProviderResolver",
  "ResolveActiveSkillsOptions",
  "ResolveMediaContentOptions",
  "ResolveShouldCompactInput",
  "ResolveShouldCompactOptions",
  "ResolveSkillLoadOptions",
  "ResolvedMediaContent",
  "ResumeNestedRun",
  "RunController",
  "RunEndDecision",
  "RunEndPayload",
  "RunEndResult",
  "RunGuardrailListOptions",
  "RunLimitCounters",
  "RunLimitName",
  "RunLimitTracker",
  "RunLimitTrackerOptions",
  "RunTurnOptions",
  "RunTurnResult",
  "SecretRedactor",
  "SessionBranch",
  "SessionBranchOptions",
  "SessionContext",
  "SessionContextSnapshot",
  "SessionLog",
  "SessionState",
  "SkillRegistryOptions",
  "SkillRenderContext",
  "SkillsDisclosure",
  "SlotAssignments",
  "SlotContracts",
  "SlotName",
  "SlotProvider",
  "SlotRegistrar",
  "SlotRegistrarEntry",
  "SlotRegistry",
  "SsrfPolicy",
  "StickyDecision",
  "StoredAgentRunState",
  "SuspendedRunEntryData",
  "SuspendedRunLoopRef",
  "TokenEstimate",
  "TokenEstimateConfidence",
  "TokenEstimator",
  "ToolArgumentValidationError",
  "ToolArgumentValidationResult",
  "ToolArgumentValidator",
  "ToolCallAuthority",
  "ToolCallDecision",
  "ToolCallHookPayload",
  "ToolCapabilityKind",
  "ToolEffectClassifier",
  "ToolEffectDeclaration",
  "ToolEffectErrorCode",
  "ToolEffectIdempotency",
  "ToolEffectKey",
  "ToolEffectKind",
  "ToolEffectRecord",
  "ToolEffectStatus",
  "ToolEffectStore",
  "ToolEffectTransition",
  "ToolElicitationRequest",
  "ToolExecuteHookPayload",
  "ToolFilter",
  "ToolFilterInput",
  "ToolParameterValidatorOptions",
  "ToolRegistryOptions",
  "ToolValidator",
  "TransformHook",
  "TransformHookName",
  "TranscriptOptions",
  "TranscriptSlice",
  "TrustDecision",
  "TrustPolicy",
  "TrustRequest",
  "TurnBeforeDecision",
  "TurnBeforePayload",
];

// Plan 174 Task 9: every published subpath carries its own frozen surface, so an add or a removal on
// `provider-kit`, `driver-kit`, `manifest`, or `testing` fails here rather than shipping silently.
// The frozen unit is the runtime namespace (`Object.keys`), which is what a consumer imports; type-only
// subpath exports are covered by the root `FROZEN_TYPE_EXPORTS` where the kernel re-exports them.
const FROZEN_PROVIDER_KIT_EXPORTS: readonly string[] = [
  "DEFAULT_MAX_ARGUMENT_BYTES",
  "DEFAULT_MAX_BUFFER_BYTES",
  "DEFAULT_MAX_EVENT_BYTES",
  "DEFAULT_MAX_RESPONSE_BODY_BYTES",
  "DEFAULT_MAX_STRUCTURED_OUTPUT_NAME_LENGTH",
  "DEFAULT_MAX_STRUCTURED_OUTPUT_SCHEMA_BYTES",
  "DEFAULT_MAX_SYSTEMONE_STATE_BYTES",
  "DEFAULT_OWNED_COMPAT_KEYS",
  "DEFAULT_PROVIDER_MEDIA_ITEM_BYTES",
  "DEFAULT_PROVIDER_UPLOAD_CACHE_ENTRIES",
  "DEFAULT_RESPONSES_PROMPT_CACHE_KEY_MAX",
  "DEFAULT_SYSTEMONE_BOOLEAN_THRESHOLD",
  "DEFAULT_SYSTEMONE_MAX_RETRIES",
  "DEFAULT_SYSTEMONE_PATH",
  "MAX_SYSTEMONE_CHOICE_OPTIONS",
  "MAX_SYSTEMONE_QUESTIONS",
  "MAX_SYSTEMONE_SCORE_LEVELS",
  "OMITTED_TOOL_RESULT_IMAGE_NOTE",
  "OPENAI_RESPONSES_MIN_OUTPUT_TOKENS",
  "OPENAI_RESPONSES_UNSUPPORTED_FIELDS",
  "ProviderRequirementError",
  "ProviderTransportError",
  "RETRYABLE_STATUSES",
  "anthropicAdaptiveThinking",
  "ResponsesMaxOutputTokensError",
  "StructuredOutputError",
  "SystemOneAbortedError",
  "SystemOneAuthError",
  "SystemOneError",
  "SystemOneInvalidRequestError",
  "SystemOneRetryExhaustedError",
  "SystemOneSchemaError",
  "THINKING_LEVELS",
  "anthropicCacheEnabled",
  "anthropicMessagesBody",
  "anthropicMessagesEvents",
  "applyCacheControl",
  "applyDefaultProviderRequestOptions",
  "applyOpenAIChatStructuredOutput",
  "applyThinkingLevel",
  "applyThinkingLevelForModel",
  "artifactStructuredOutputRequest",
  "askSystemOneDecisions",
  "assertAbortIsObserved",
  "assertAuthDescriptorsWellFormed",
  "assertCanonicalToolParameters",
  "assertModelsListValid",
  "assertNoFetches",
  "assertNoForeignCacheFields",
  "assertNoSecretLeak",
  "assertNotAborted",
  "assertOpenAIChatMessage",
  "assertProviderMediaCapability",
  "assertProviderOwnedHeadersWin",
  "assertProviderStreamConforms",
  "assertRecordedStreamConforms",
  "assertSerializedRequestCoversContent",
  "assertStructuredOutputRequestSupported",
  "assertToolCallDeltasReconstruct",
  "assertUsageAccounting",
  "baseUrlProperty",
  "buildOpenAIChatBody",
  "buildOpenAIResponsesBody",
  "bytesToBase64",
  "cacheHitRate",
  "cacheSavings",
  "cacheUsageReport",
  "canonicalizeJsonSchema",
  "classifyProviderFailure",
  "collectProviderEvents",
  "compileSystemOneQuestions",
  "compileSystemOneState",
  "createBoundedUploadCache",
  "createOpenAICompatibleProvider",
  "createRoutedProvider",
  "createToolNameMap",
  "createSystemOneDecisionProvider",
  "defaultProviderFilename",
  "defineProviderPackage",
  "httpStatusError",
  "isContextOverflowMessage",
  "isLoopbackHost",
  "isPdfMediaType",
  "isPlaintextRemote",
  "isRetryableSystemOneStatus",
  "isSupportedThinkingLevel",
  "isSystemOneAnswer",
  "isSystemOneResponse",
  "isThinkingLevel",
  "mapCacheRetention",
  "mapOpenAIChatUsage",
  "mapOpenAIResponsesUsage",
  "mapSystemOneUsage",
  "mediaFingerprint",
  "mergeProviderRequestOptions",
  "modelEntrySchema",
  "modelSupportsStructuredOutput",
  "modelsProperty",
  "normalizeSystemOnePath",
  "normalizeThinkingLevel",
  "normalizeUsage",
  "openAIChatBody",
  "openAIChatEvents",
  "openAIResponsesBody",
  "openAIResponsesEvents",
  "optionalRefSource",
  "parseErrorBody",
  "parseJsonObjectArguments",
  "parseRetryAfterMs",
  "parseThinkingLevel",
  "plaintextRemoteOrigin",
  "postSystemOne",
  "preserveThinking",
  "productToolName",
  "providerConformance",
  "providerHttpError",
  "providerPackage",
  "providerPackageInstance",
  "providerUploadCacheKey",
  "readBoundedResponseJson",
  "readBoundedResponseText",
  "readRetryAfterMs",
  "readSseData",
  "readSseEvents",
  "reasoningEffort",
  "reasoningObject",
  "refSource",
  "rejectProviderMediaBlock",
  "renderSystemOneOutput",
  "replayFetch",
  "resolveBreakpoint",
  "resolvePreserveThinking",
  "resolvePromptCachePlan",
  "resolveProviderApiKey",
  "resolveProviderMediaMessages",
  "resolveReasoningEffort",
  "resolveReasoningObject",
  "resolveRunProviderOptions",
  "resolveThinkingObject",
  "runEmbeddingsConformance",
  "sanitizeCacheKey",
  "secretRefProperty",
  "serializeOpenAIChatMessage",
  "serializeOpenAIChatStructuredOutput",
  "serializeOpenAITool",
  "serializePdfDocumentWireBlock",
  "serializeResponsesTool",
  "serializeToolResultText",
  "snapThinkingLevel",
  "stripOwnedCompat",
  "systemCacheControlField",
  "systemOneConformance",
  "systemOneProviderPackage",
  "thinkingCompatFor",
  "thinkingFamilyForModel",
  "thinkingLevelsForModel",
  "thinkingObject",
  "tryParseJsonObjectArguments",
  "validateStructuredOutputOptions",
  "warnIfPlaintextRemote",
  "wireToolName",
  "withoutStructuredOutput",
];

// Plan 215 Task 26: network plumbing and artifact records moved off the root onto their own subpaths.
const FROZEN_NET_EXPORTS: readonly string[] = [
  "boundResponse",
  "defaultResolver",
  "isLoopbackAddress",
  "isLoopbackHostname",
  "normalizeHostname",
  "pinnedFetch",
  "raceAbort",
  "requestPinned",
  "resolvePinnedAddress",
];

const FROZEN_ARTIFACTS_EXPORTS: readonly string[] = [
  "ARTIFACT_BODY_ERROR_CODES",
  "ARTIFACT_CHECKPOINT_NAMESPACE",
  "ArtifactBodyStoreError",
  "ArtifactError",
  "HARD_CITATION_EXCERPT_BYTES",
  "artifactApprovalState",
  "artifactCheckpointKey",
  "citationBindingDigest",
];

const FROZEN_DRIVER_KIT_EXPORTS: readonly string[] = [
  "ALL_TOOL_EFFECTS",
  "DEFAULT_ENV_ALLOWLIST",
  "DriverError",
  "EMPTY_VENDOR_SCHEMA",
  "EXTERNAL_ACTIVITY_EVENTS",
  "EXTERNAL_AGENT_SPEC_KEYS",
  "JsonRpcError",
  "agentEventGuards",
  "assertDriverDescriptor",
  "assertDriverRequires",
  "assertIsolation",
  "bridgeTools",
  "buildChildEnv",
  "createCallbackBroker",
  "createDriverLoop",
  "createJsonRpcPeer",
  "createPolicyGuard",
  "createProfiles",
  "createRunDirectory",
  "createStdinWriter",
  "defineDriver",
  "driverPackage",
  "effectsTable",
  "externalAgentSpecSchema",
  "isAgentEventName",
  "isInside",
  "mapDiff",
  "mapPlan",
  "mapUsage",
  "materializeSkills",
  "probeBinary",
  "readJsonl",
  "redactedStderr",
  "relayCommand",
  "resolveGitExclude",
  "resolveProtected",
  "signalLadder",
  "subagentScopes",
  "writeExcludeBlock",
];

const FROZEN_MANIFEST_EXPORTS: readonly string[] = [
  "MANIFEST_V1_SCHEMA",
  "MAX_CLOSURE_PACKAGES",
  "ManifestError",
  "assignSlot",
  "configure",
  "hashPackageClosure",
  "hashPackageTree",
  "importDefinition",
  "install",
  "installedPackageDir",
  "isInstalledEntry",
  "list",
  "loadManifest",
  "manifestSchemaDocument",
  "mergeManifestScopes",
  "parseManifest",
  "readManifest",
  "remove",
  "resolveUserHome",
  "scopeDirs",
  "setEnabled",
  "toPackageDefinition",
  "verify",
  "verifyInstalled",
  "writeManifest",
];

const FROZEN_TESTING_EXPORTS: readonly string[] = [
  "DriverConformanceError",
  "DEFAULT_LIVE_CACHE_PREFIX",
  "LIVE_WEATHER_TOOL",
  "STORE_CONFORMANCE_STEPS",
  "assertAgentEventSourceConforms",
  "assertPersistenceSearchQueryParity",
  "bindManifestInstance",
  "checkLayaServerReachable",
  "createMemoryAgentEventSource",
  "createMockProvider",
  "createScriptedCli",
  "createScriptedHostUi",
  "defineScriptedDialect",
  "driverConformance",
  "echoTool",
  "executeProviderLiveScenarios",
  "executeSystemOneLiveScenarios",
  "jsonRpcDialect",
  "jsonlStreamDialect",
  "loadProviderPackage",
  "loopConformance",
  "mockProvider",
  "packageConformance",
  "providerDone",
  "providerTextDelta",
  "providerToolCall",
  "providerToolCallDelta",
  "providerUsage",
  "recordFixtures",
  "runProviderLiveScenarios",
  "runSystemOneLiveScenarios",
  "storeConformance",
  "textProvider",
  "toolCallContent",
  "twoTurnProvider",
];

// A dynamic import of kernel source by path. A literal `import("../x.ts")` needs
// `allowImportingTsExtensions`; resolving through a URL keeps the tests on source and the tsconfig strict.
const importSource = (relative: string) => import(new URL(relative, import.meta.url).href);

// The brace-matched body of one exported interface, so a named-contract assertion cannot be satisfied
// by a declaration in a neighbouring type.
function interfaceBody(src: string, name: string): string {
  const start = src.indexOf(`export interface ${name}`);
  assert.notEqual(start, -1, `src has no export interface ${name}`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start);
}

// Parse `src/index.ts` into { value, type } export identifier sets. Mirrors the
// extraction used to derive FROZEN_*_EXPORTS so the snapshot stays self-checking.
function extractIndexExports(src: string): { value: Set<string>; type: Set<string> } {
  const value = new Set<string>();
  const type = new Set<string>();
  for (const m of src.matchAll(/export\s+type\s+\{([^}]*)\}\s+from/g)) {
    for (const p of m[1].split(",")) {
      const id = p
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        .trim();
      if (id) type.add(id);
    }
  }
  for (const m of src.matchAll(/export\s+\{([^}]*)\}/g)) {
    for (let part of m[1].split(",")) {
      part = part.trim();
      const isType = /^type\s+/.test(part);
      const id = part
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        .trim();
      if (!id) continue;
      (isType ? type : value).add(id);
    }
  }
  for (const m of src.matchAll(/export\s+(function|const|class)\s+([A-Za-z0-9_]+)/g)) value.add(m[2]);
  for (const m of src.matchAll(/export\s+(interface|type)\s+([A-Za-z0-9_]+)/g)) type.add(m[2]);
  return { value, type };
}

// Every non-test TypeScript module the kernel publishes: the declaration surface a consumer
// sees is this source tree, since every `exports` target points at `src/**/*.ts`.
function readShippedSource(dir = join(repoRoot, "src")): string {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "__tests__" || ent.name === "fixtures") continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(readShippedSource(full));
    else if (ent.name.endsWith(".ts")) out.push(readFileSync(full, "utf8"));
  }
  return out.join("\n");
}

// ponytail: data-driven contract; one entry per published package (shared shape
// with packaging.test.ts / install-smoke.test.ts). Adding a package is one line.
const packages = [{ dir: ".", name: "@arnilo/prism", isCore: true }];

type Manifest = {
  exports?: Record<string, Record<string, string> | string>;
  main?: string;
  types?: string;
  bin?: string | Record<string, string>;
};

function readPkg(dir: string): Manifest {
  return JSON.parse(readFileSync(join(repoRoot, dir, "package.json"), "utf8"));
}

// Collect every public surface target a package.json can point a consumer at:
// exports.* (types + default), main, types, and (core) bin. Each entry is the
// raw manifest path (e.g. "./dist/index.js").
function collectTargets(pkg: { dir: string; isCore?: boolean }): Map<string, string> {
  const manifest = readPkg(pkg.dir);
  const out = new Map<string, string>(); // label -> target path
  const exports = manifest.exports ?? {};
  for (const [subpath, target] of Object.entries(exports)) {
    if (typeof target === "string") {
      out.set(`exports["${subpath}"]`, target);
      continue;
    }
    for (const field of ["types", "default"] as const) {
      if (target[field]) out.set(`exports["${subpath}"].${field}`, target[field]!);
    }
  }
  if (manifest.main) out.set("main", manifest.main);
  if (manifest.types) out.set("types", manifest.types);
  if (pkg.isCore && manifest.bin) {
    const bin = manifest.bin;
    if (typeof bin === "string") {
      out.set("bin", bin);
    } else {
      for (const [name, path] of Object.entries(bin)) out.set(`bin["${name}"]`, path);
    }
  }
  return out;
}

function norm(p: string): string {
  return p.replace(/^\.\//, "");
}

describe("public-export contract (build-time, pre-pack)", () => {
  it("testing_fixture_recorder_is_exported_from_built_subpath", async () => {
    const testing = (await import(new URL("../testing/index.ts", import.meta.url).href)) as Record<string, Record<string, unknown>>;
    for (const method of ["command", "finish", "load"] as const) {
      assert.equal(typeof testing.recordFixtures[method], "function");
    }
    const declarations = readFileSync(join(repoRoot, "src/testing/scripted-cli.ts"), "utf8");
    assert.ok(declarations.includes("locate?"));
    assert.ok(declarations.includes("readonly raw: string"));
    assert.ok(declarations.includes("readonly home?: string"));
  });

  it("root export surface is frozen (no silent add/remove)", async () => {
    const src = readFileSync(join(repoRoot, "src/index.ts"), "utf8");
    const { value, type } = extractIndexExports(src);
    assert.deepEqual(
      [...value].sort(),
      [...FROZEN_VALUE_EXPORTS].sort(),
      "src/index.ts value exports drifted from the frozen SDK surface; update FROZEN_VALUE_EXPORTS deliberately",
    );
    assert.deepEqual(
      [...type].sort(),
      [...FROZEN_TYPE_EXPORTS].sort(),
      "src/index.ts type exports drifted from the frozen SDK surface; update FROZEN_TYPE_EXPORTS deliberately",
    );
  });

  it("every frozen value export resolves at runtime in the built module", async () => {
    const built = (await import("../index.js")) as Record<string, unknown>;
    const missing = FROZEN_VALUE_EXPORTS.filter((name) => built[name] === undefined);
    assert.deepEqual(missing, [], `src/index.ts is missing value exports: ${missing.join(", ")}`);
  });

  it("every frozen type export appears in the published declaration surface", () => {
    const source = readShippedSource();
    const missing = FROZEN_TYPE_EXPORTS.filter((name) => !new RegExp(`\\b${name}\\b`).test(source));
    assert.deepEqual(missing, [], `the kernel source tree is missing type exports: ${missing.join(", ")}`);
  });

  it("root SDK contract type surface keeps important implementer contracts", () => {
    const indexSource = readFileSync(join(repoRoot, "src/index.ts"), "utf8");
    // 0.1.4 split: the declarations live in the split contract modules, resolved through the
    // contracts.ts barrel; scan the union so the check is layout-agnostic. 0.2.5 plan 025 Task 1:
    // contracts-core split into contracts-core/*.ts; scan the tree (layout-agnostic) so the SDK
    // contract types are found regardless of split depth. Plan 174 Task 8: scan the TypeScript
    // source instead of the emitted `.d.ts` — the source is what ships.
    const contractsSource = [
      readFileSync(join(repoRoot, "src/contracts.ts"), "utf8"),
      readTree(join(repoRoot, "src/contracts-core"), ".ts"),
      readFileSync(join(repoRoot, "src/contracts-run-state.ts"), "utf8"),
      readFileSync(join(repoRoot, "src/contracts-protocol.ts"), "utf8"),
    ].join("\n");
    assert.ok(indexSource.includes('export type * from "./contracts.js"'), "src/index.ts must re-export contract types");
    const missing = REQUIRED_SDK_CONTRACT_TYPES.filter(
      (name) => !new RegExp(`export\\s+(?:interface|type|class)\\s+${name}\\b`).test(contractsSource),
    );
    assert.deepEqual(missing, [], `src/contracts*.ts is missing SDK contract types: ${missing.join(", ")}`);
  });

  it("kernel_subpaths_removed (plan 154 Task 7)", async () => {
    const manifest = readPkg(".");
    for (const subpath of ["./node/trust", "./node/instruction-sources", "./node/system-prompts"]) {
      assert.equal(manifest.exports?.[subpath], undefined, `${subpath} must not be exported from the kernel`);
      await assert.rejects(
        async () => await import(`@arnilo/prism/${subpath.slice(2)}`),
        (error: unknown) =>
          ["ERR_MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED", "ERR_UNSUPPORTED_ESM_URL_SCHEME"].includes(
            (error as { code?: string }).code ?? "",
          ),
        `${subpath} must fail to resolve`,
      );
    }
    // The functions an external context/files package reuses are root exports now.
    const prism = (await import("../index.js")) as Record<string, unknown>;
    for (const name of ["createPathTrustPolicy", "isPathInside", "isPathInsideReal"]) {
      assert.equal(typeof prism[name], "function", `@arnilo/prism must export ${name}`);
    }
  });

  it("phase39_public_protocol_exports_and_types_do_not_drift", async () => {
    const prism = (await import("../index.js")) as Record<string, unknown>;
    assert.equal(typeof prism.providerToolCallDelta, "function");
    // 0.2.5 plan 025 Task 1: contracts-core split into src/contracts-core/*.ts; scan the tree.
    const contractsSrc = [
      readTree(join(repoRoot, "src/contracts-core"), ".ts"),
      readFileSync(join(repoRoot, "src/contracts-run-state.ts"), "utf8"),
      readFileSync(join(repoRoot, "src/contracts-protocol.ts"), "utf8"),
    ].join("\n");
    assert.ok(contractsSrc.includes("export interface ToolCallDeltaContent"));
    assert.ok(readFileSync(join(repoRoot, "src/index.ts"), "utf8").includes('export type * from "./contracts.js"'));
    assert.deepEqual(readPkg(".").exports?.["./testing"], "./src/testing/index.ts");
    assert.deepEqual(readPkg(".").exports?.["./provider-kit"], "./src/provider-kit/index.ts");
    assert.deepEqual(readPkg(".").exports?.["./driver-kit"], "./src/driver-kit/index.ts");

    const hooksJson = readPkg("packages/extensions");
    assert.equal(hooksJson.exports?.["./hooks-json"], "./hooks-json/src/index.ts");
    assert.equal(existsSync(join(repoRoot, "packages/extensions/hooks-json/src/index.d.ts")), false);

    const observationalPkg = readPkg("packages/memory");
    assert.equal(observationalPkg.exports?.["."], "./system/src/index.ts", "the memory system is source-exported");
  });

  it("process driver publishes a TypeScript source root with its named API", async () => {
    const pkg = readPkg("packages/hosts");
    assert.equal(pkg.exports?.["./driver-process"], "./driver-process/src/index.ts");
    const api = await import(new URL("../../packages/hosts/driver-process/src/index.ts", import.meta.url).href);
    assert.deepEqual(Object.keys(api).sort(), ["ProcessDriverError", "adapterDriver", "extendAdapter", "processDriver"].sort());
  });

  it("kernel_exports_typescript_source", () => {
    // Plan 174 Task 8: every kernel export target is the source module itself, so there is no
    // build step to consume it. A `dist` target (or a `types`/`default` pair) fails here.
    const pkg = readPkg(".");
    const exportsMap = (pkg.exports ?? {}) as Record<string, unknown>;
    assert.ok(Object.keys(exportsMap).length > 0, "the kernel publishes an export map");
    for (const [subpath, target] of Object.entries(exportsMap)) {
      assert.equal(typeof target, "string", `${subpath} must map to one source target, not a types/default pair`);
      if (target === "./manifest/schema.json") continue;
      assert.ok(
        (target as string).startsWith("./src/") && (target as string).endsWith(".ts"),
        `${subpath} -> ${String(target)} must be TypeScript source, never dist`,
      );
      assert.ok(existsSync(join(repoRoot, (target as string).slice(2))), `${subpath} -> ${String(target)} missing from disk`);
    }
    assert.equal(pkg.main, undefined, "a source kernel declares no main");
    assert.equal(pkg.types, undefined, "a source kernel declares no types");
    assert.deepEqual(pkg.bin, { prism: "./src/cli.ts" }, "the prism bin runs TypeScript source");
  });

  for (const pkg of packages) {
    describe(pkg.name, () => {
      const targets = collectTargets(pkg);
      const pkgRoot = join(repoRoot, pkg.dir);

      for (const [label, target] of targets) {
        it(`${label} (${target}) resolves to a published file`, () => {
          const rel = norm(target);
          // Plan 174 Task 8: the kernel publishes TypeScript source, so every public target is
          // either `src/**/*.ts` (the types and the runtime are the same file) or the emitted
          // manifest JSON Schema. No examples/, no dist/.
          const isSource = rel.startsWith("src/") && rel.endsWith(".ts");
          const isSchema = rel === "manifest/schema.json";
          assert.ok(isSource || isSchema, `${pkg.name} ${label} -> ${rel} must target src/**/*.ts or the manifest schema`);
          assert.ok(
            existsSync(join(pkgRoot, rel)),
            `${pkg.name} ${label} -> ${rel} missing from disk (run \`bun run build:core\` for the schema)`,
          );
        });
      }

      // negative guard: NO target of any kind escapes the published source tree. Catches a future
      // manifest edit that points main/exports/bin at a build output or at examples.
      it("no public target escapes the published source tree", () => {
        for (const [label, target] of targets) {
          const rel = norm(target);
          if (isAbsolute(target) || !(rel.startsWith("src/") || rel === "manifest/schema.json")) {
            assert.fail(`${pkg.name} ${label} -> ${target} escapes src/`);
          }
        }
      });
    });
  }

  // ---- Plan 174 Task 9: the reviewed 0.13 surface --------------------------------------------

  // One row per published subpath. `target` is the manifest entry a consumer resolves, `entry` the
  // module this test imports, `frozen` the namespace it must export exactly.
  const subpathSurfaces = [
    {
      label: "provider_kit",
      subpath: "./provider-kit",
      target: "./src/provider-kit/index.ts",
      entry: "../provider-kit/index.ts",
      frozen: FROZEN_PROVIDER_KIT_EXPORTS,
    },
    {
      label: "net",
      subpath: "./net",
      target: "./src/net/index.ts",
      entry: "../net/index.ts",
      frozen: FROZEN_NET_EXPORTS,
    },
    {
      label: "artifacts",
      subpath: "./artifacts",
      target: "./src/artifacts/index.ts",
      entry: "../artifacts/index.ts",
      frozen: FROZEN_ARTIFACTS_EXPORTS,
    },
    {
      label: "driver_kit",
      subpath: "./driver-kit",
      target: "./src/driver-kit/index.ts",
      entry: "../driver-kit/index.ts",
      frozen: FROZEN_DRIVER_KIT_EXPORTS,
    },
    {
      label: "manifest",
      subpath: "./manifest",
      target: "./src/manifest/index.ts",
      entry: "../manifest/index.ts",
      frozen: FROZEN_MANIFEST_EXPORTS,
    },
    {
      label: "testing",
      subpath: "./testing",
      target: "./src/testing/index.ts",
      entry: "../testing/index.ts",
      frozen: FROZEN_TESTING_EXPORTS,
    },
  ];

  for (const surface of subpathSurfaces) {
    it(`${surface.label}_surface_is_frozen`, async () => {
      assert.equal(readPkg(".").exports?.[surface.subpath], surface.target, `${surface.subpath} must publish its source entry`);
      const module = (await importSource(surface.entry)) as Record<string, unknown>;
      assert.deepEqual(
        Object.keys(module).sort(),
        [...surface.frozen].sort(),
        `${surface.subpath} surface drifted; update FROZEN_${surface.label.toUpperCase()}_EXPORTS deliberately`,
      );
    });
  }

  it("driver_kit_named_contract_is_frozen", async () => {
    // §2.12.9: one row per contract the subpath owes, so a rename inside the kit fails here by name.
    const kit = (await importSource("../driver-kit/index.ts")) as Record<string, unknown>;
    const contracts: Readonly<Record<string, string>> = {
      "driver contract": "defineDriver",
      "driver package": "driverPackage",
      "capability descriptor": "assertDriverDescriptor",
      "requires preflight": "assertDriverRequires",
      "isolation policy": "assertIsolation",
      "external agent spec schema": "externalAgentSpecSchema",
      "event name guard": "isAgentEventName",
      "subscription profiles": "createProfiles",
      "sign-in handoff": "createCallbackBroker",
      "auth policy guard": "createPolicyGuard",
      "tool bridge": "bridgeTools",
      "configuration materializer": "materializeSkills",
      "child environment": "buildChildEnv",
      "run directory": "createRunDirectory",
      "json-rpc peer": "createJsonRpcPeer",
      "stdin writer": "createStdinWriter",
      "diff normalization": "mapDiff",
      "plan normalization": "mapPlan",
      "usage normalization": "mapUsage",
      "signal ladder": "signalLadder",
      "subagent scopes": "subagentScopes",
      "relay command": "relayCommand",
    };
    for (const [contract, name] of Object.entries(contracts)) {
      assert.equal(typeof kit[name], "function", `driver-kit must export ${name} for the ${contract}`);
    }
    assert.ok(
      Array.isArray(kit.EXTERNAL_AGENT_SPEC_KEYS) && Array.isArray(kit.ALL_TOOL_EFFECTS) && Array.isArray(kit.DEFAULT_ENV_ALLOWLIST),
    );
    assert.equal(typeof kit.EMPTY_VENDOR_SCHEMA, "object");
    // §2.12.9 lists `driverConformance` with the driver kit; it ships from `./testing` so a host
    // imports the harness without the runtime kit (§2.2 puts conformance harnesses in `testing`).
    const testing = (await importSource("../testing/index.ts")) as Record<string, unknown>;
    assert.equal(typeof testing.driverConformance, "function");
  });

  it("run_controller_driver_primitives_are_named", () => {
    // §2.12.9 K2: the loop contract carries `observe`, `ask`, and `steers`, not only `turn`/`executeTools`.
    const body = interfaceBody(readFileSync(join(repoRoot, "src/loop/types.ts"), "utf8"), "RunController");
    for (const primitive of ["observe", "ask", "steers"]) {
      assert.ok(new RegExp(`\\b${primitive}\\??\\s*[:<(]`).test(body), `RunController must declare the driver primitive ${primitive}`);
    }
    const factory = readFileSync(join(repoRoot, "src/loop/run-controller.ts"), "utf8");
    for (const primitive of ["observe", "ask", "steers"]) {
      assert.ok(new RegExp(`^\\s+${primitive},$`, "m").test(factory), `createRunController must return ${primitive}`);
    }
    assert.ok(FROZEN_TYPE_EXPORTS.includes("RunController"), "RunController is a root type export");
  });

  it("terminal_host_request_kind_is_frozen", () => {
    // §2.12.9 K6: the one host request that runs a vendor login keeps its own kind and never
    // carries a secret (`env` is rejected when it names a credential ref).
    const body = interfaceBody(readFileSync(join(repoRoot, "src/host/types.ts"), "utf8"), "HostUiTerminalRequest");
    assert.ok(body.includes('readonly kind: "terminal"'), 'HostUiTerminalRequest must declare kind: "terminal"');
    for (const field of ["title", "command"]) assert.ok(body.includes(`readonly ${field}`), `the terminal request must carry ${field}`);
    assert.ok(FROZEN_TYPE_EXPORTS.includes("HostUiTerminalRequest"), "the terminal request is a root type export");
    assert.ok(FROZEN_TYPE_EXPORTS.includes("HostUiRequest"), "the terminal request is joined to HostUiRequest");
  });

  it("prism_relay_bin_is_frozen", async () => {
    assert.deepEqual(readPkg(".").bin, { prism: "./src/cli.ts" }, "the prism bin is the source entry");
    const relay = (await importSource("../cli-relay.ts")) as Record<string, unknown>;
    assert.equal(typeof relay.runRelay, "function", "the relay entry point stays exported");
    const cli = readFileSync(join(repoRoot, "src/cli.ts"), "utf8");
    assert.ok(cli.includes('argv[0] === "relay"'), "the bin dispatches the relay subcommand");
    assert.ok(cli.includes("./cli-relay.js"), "relay stays a dynamic import so a vendor hook loads it alone");
  });

  it("redaction_surface_is_closed", async () => {
    // The freeze ships no helper that reads or emits a secret past the redactor: the redaction
    // exports are exactly the reviewed set, and nothing is named like a bypass.
    const exported = FROZEN_VALUE_EXPORTS.filter((name) => /redact/i.test(name)).sort();
    assert.deepEqual(
      exported,
      [
        "createSecretRedactor",
        "redactAgentEvent",
        "redactMessage",
        "redactProviderRequest",
        "redactRunLedgerRecord",
        "redactSecrets",
        "redactSessionEntry",
        "resolveRedactor",
      ],
      "the redaction exports changed; a new one is a new trust boundary",
    );
    const bypass = /unredacted|rawsecret|leaksecret|revealsecret|bypassredact|skipredact|disableredact|plaintextsecret/i;
    assert.deepEqual(
      FROZEN_VALUE_EXPORTS.filter((name) => bypass.test(name)),
      [],
      "no export may bypass redaction",
    );
    const prism = (await import("../index.js")) as Record<string, unknown>;
    for (const name of exported) assert.notEqual(prism[name], undefined, `${name} must resolve at runtime`);
  });
});

// Plan 215 Task 26 (plan 179 Task 1 (c), refreshed by Task 25): the reviewed root-surface table.
describe("plan 215 Task 26: reviewed root surface", () => {
  const movedToNet = [...FROZEN_NET_EXPORTS, "PinnedFetchOptions"];
  const movedToArtifacts = [
    ...FROZEN_ARTIFACTS_EXPORTS,
    "ArtifactApproval",
    "ArtifactApprovalState",
    "ArtifactBodyErrorCode",
    "ArtifactBodyPresignOptions",
    "ArtifactBodyRef",
    "ArtifactBodyStore",
    "ArtifactBodyTransferOptions",
    "ArtifactCitation",
    "ArtifactDecisionState",
    "ArtifactDeliveryToken",
    "ArtifactRecord",
    "ArtifactRevision",
    "CitationSupport",
  ];
  const deleted = ["MODEL_FAMILY_TOKENS", "ModelFamilyTokens", "resolveModelFamily", "EventSubscriber"];

  it("root_surface_matches_reviewed_table", () => {
    const root = extractIndexExports(readFileSync(join(repoRoot, "src/index.ts"), "utf8"));
    for (const name of [...movedToNet, ...movedToArtifacts, ...deleted]) {
      assert.equal(root.value.has(name) || root.type.has(name), false, `${name} must not be a root export`);
    }
    // Kept at the root by the table: the SSRF gate hosts call, the shared context helpers, and the
    // tracker type public signatures (`RunController.limits`) name; the class is no longer a value.
    for (const name of [
      "assertSsrfAllowedUrl",
      "registerContextSources",
      "withContextBlocks",
      "createRunLimitTracker",
      "trimTrailingSlashes",
    ]) {
      assert.ok(root.value.has(name), `${name} stays a root value export`);
    }
    assert.ok(root.type.has("RunLimitTracker") && !root.value.has("RunLimitTracker"));
    assert.ok(root.type.has("ContextSource"));
  });

  it("net_subpath_exports_pinned_fetch", async () => {
    const net = (await importSource("../net/index.ts")) as Record<string, unknown>;
    assert.equal(readPkg(".").exports?.["./net"], "./src/net/index.ts");
    for (const name of ["pinnedFetch", "requestPinned", "resolvePinnedAddress", "defaultResolver"])
      assert.equal(typeof net[name], "function");
    assert.match(readFileSync(join(repoRoot, "src/net/index.ts"), "utf8"), /only supported SSRF-safe fetch/);
  });

  it("artifacts_subpath_exports_records", async () => {
    const artifacts = (await importSource("../artifacts/index.ts")) as Record<string, unknown>;
    assert.equal(readPkg(".").exports?.["./artifacts"], "./src/artifacts/index.ts");
    assert.equal(typeof artifacts.citationBindingDigest, "function");
    assert.equal(artifacts.HARD_CITATION_EXCERPT_BYTES, 8192);
    const source = readFileSync(join(repoRoot, "src/artifacts/index.ts"), "utf8");
    for (const name of ["ArtifactRecord", "ArtifactBodyStore", "ArtifactCitation", "ArtifactRevision"])
      assert.match(source, new RegExp(`\\b${name}\\b`));
  });
});
