import type {
  AgentLoopOptions,
  AgentLoopStrategy,
  ArtifactValidation,
  CompactionOptions,
  ContentBlock,
  ErrorInfo,
  GuardrailRecord,
  Guardrails,
  InstructionInjector,
  JsonObject,
  Message,
  ModelConfig,
  OwnershipScope,
  ProviderRequestOptions,
  ProviderRequestPolicy,
  ProviderResolver,
  RetryOptions,
  RunLimitBreach,
  RunLimits,
  Skill,
  SubscriberOverflowPolicy,
  SystemPromptConfig,
  ToolCallAuthority,
  ToolCallContent,
  Usage,
} from "./contracts-core.js";
import type { AgentRunInterruption, AgentRunStateOptions } from "./contracts-run-state.js";
import type { SecretRedactor } from "./redaction.js";
import type { ToolValidator } from "./tools.js";

export type ProviderEvent =
  | { readonly type: "message_start"; readonly messageId?: string }
  | { readonly type: "content_delta"; readonly content: ContentBlock }
  | {
      readonly type: "tool_call_delta";
      readonly index: number;
      readonly id?: string;
      readonly name?: string;
      readonly argumentsText?: string;
      readonly authority?: ToolCallAuthority;
    }
  | { readonly type: "tool_call"; readonly call: ToolCallContent }
  | { readonly type: "usage"; readonly usage: Usage }
  | { readonly type: "continuation_required"; readonly cursor: string; readonly reason?: string }
  | { readonly type: "done"; readonly usage?: Usage }
  | { readonly type: "error"; readonly error: ErrorInfo };

export type RealtimeEvent =
  | { readonly type: "session_started"; readonly sessionId?: string }
  | { readonly type: "audio_delta"; readonly audio: Uint8Array }
  | { readonly type: "transcript_delta"; readonly text: string; readonly role: "user" | "assistant" }
  | { readonly type: "tool_call"; readonly call: ToolCallContent }
  | { readonly type: "interrupted" }
  | { readonly type: "session_closed"; readonly reason?: string }
  | { readonly type: "error"; readonly error: ErrorInfo };

/** Neutral bidirectional realtime session seam. The provider owns the transport
 *  (e.g. WebSocket); the host owns audio capture/playback and session lifecycle. */
export type InputAssemblyLayout = "legacy" | "cache_aware";

export interface RunOptions {
  readonly signal?: AbortSignal;
  readonly model?: ModelConfig;
  readonly providerSource?: ProviderResolver;
  /** Run-scoped ceilings. When an agent config also sets limits, these can only narrow it. */
  readonly limits?: RunLimits;
  readonly providerOptions?: ProviderRequestOptions;
  readonly providerRequestPolicies?: ProviderRequestPolicy | readonly ProviderRequestPolicy[];
  readonly systemPrompt?: SystemPromptConfig;
  readonly compaction?: false | CompactionOptions;
  readonly retry?: false | RetryOptions;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly redactor?: SecretRedactor;
  readonly runLedger?: RunLedger;
  /** Optional durable recovery store. Per-run value overrides this agent default. */
  readonly effectStore?: ToolEffectStore;
  readonly ownership?: OwnershipScope;
  /** Host-verified identity; when set, must project onto `ownership` without widening. */
  readonly identity?: import("./identity.js").AgentIdentity;
  readonly idempotencyKey?: string;
  readonly validate?: ToolValidator;
  readonly activeSkills?: readonly string[];
  readonly skills?: readonly Skill[];
  /** Migration opt-in: activate every skill in a configured `SkillRegistry` when `activeSkills` / `skills` are unset. */
  readonly activateAllSkills?: true;
  /** Progressive: catalog (name+description) unless loaded; eager: full instructions every turn. Default progressive. */
  readonly skillsDisclosure?: import("./skill-disclosure.js").SkillsDisclosure;
  /** Opt-in projection-only fold for aged large tool results in provider view; store untouched. */
  readonly toolResultFold?: import("./tool-result-fold.js").ToolResultFoldOptions;
  readonly instructionInjectors?: readonly InstructionInjector[];
  readonly inputLayout?: InputAssemblyLayout;
  readonly loop?: AgentLoopStrategy | AgentLoopOptions;
  /** Appended to agent-level guardrails for this run. */
  readonly guardrails?: Guardrails;
  /** Opt-in durable interruption/checkpointing. */
  readonly runState?: AgentRunStateOptions;
}

export interface ProviderTurnMetadata {
  readonly providerId: string;
  readonly model: ModelConfig;
  readonly requestId?: string;
  readonly latencyMs?: number;
  readonly attempt?: number;
  readonly httpStatus?: number;
  readonly rateLimitRemaining?: number;
  readonly rateLimitResetMs?: number;
}

export interface ToolExecutionMetadata {
  readonly durationMs: number;
  readonly status: ToolCallStatus;
}

export type AgentFinishReason = "turn_limit" | "token_limit" | "refusal";

export type AgentEvent =
  | { readonly type: "agent_started"; readonly sessionId: string; readonly runId: string }
  | {
      readonly type: "agent_finished";
      readonly sessionId: string;
      readonly runId: string;
      readonly usage?: Usage;
      /** Why the loop stopped, when a limit/ceiling ended the run cleanly (F4). Absent = natural end. */
      readonly finishReason?: AgentFinishReason;
    }
  | {
      readonly type: "agent_suspended";
      readonly sessionId: string;
      readonly runId: string;
      readonly interruption: AgentRunInterruption;
      readonly version: number;
    }
  | { readonly type: "agent_resumed"; readonly sessionId: string; readonly runId: string; readonly version: number }
  | {
      readonly type: "agent_denied";
      readonly sessionId: string;
      readonly runId: string;
      readonly interruption: AgentRunInterruption;
      readonly version: number;
    }
  | { readonly type: "turn_started"; readonly sessionId: string; readonly runId: string; readonly turn: number }
  | { readonly type: "turn_finished"; readonly sessionId: string; readonly runId: string; readonly turn: number }
  | {
      readonly type: "provider_turn_started";
      readonly sessionId: string;
      readonly runId: string;
      readonly turn: number;
      readonly metadata: ProviderTurnMetadata;
    }
  | {
      readonly type: "provider_turn_finished";
      readonly sessionId: string;
      readonly runId: string;
      readonly turn: number;
      readonly metadata: ProviderTurnMetadata;
      readonly usage?: Usage;
      readonly error?: ErrorInfo;
    }
  | { readonly type: "message_started"; readonly sessionId: string; readonly runId: string; readonly message: Message }
  | { readonly type: "message_delta"; readonly sessionId: string; readonly runId: string; readonly content: ContentBlock }
  | { readonly type: "message_finished"; readonly sessionId: string; readonly runId: string; readonly message: Message }
  | { readonly type: "tool_execution_started"; readonly sessionId: string; readonly runId: string; readonly call: ToolCallContent }
  | {
      readonly type: "tool_execution_progress";
      readonly sessionId: string;
      readonly runId: string;
      readonly toolCallId: string;
      readonly name: string;
      readonly progress?: unknown;
      readonly metadata?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: "tool_execution_finished";
      readonly sessionId: string;
      readonly runId: string;
      readonly result: ToolResult;
      readonly metadata: ToolExecutionMetadata;
    }
  | {
      readonly type: "tool_execution_error";
      readonly sessionId: string;
      readonly runId: string;
      readonly call: ToolCallContent;
      readonly error: ErrorInfo;
      readonly metadata: ToolExecutionMetadata;
    }
  | {
      readonly type: "tool_execution_blocked";
      readonly sessionId: string;
      readonly runId: string;
      readonly toolCallId: string;
      readonly name: string;
      readonly reason: string;
      readonly error: ErrorInfo;
      readonly metadata: ToolExecutionMetadata;
    }
  | {
      readonly type: "guardrail_decision";
      readonly sessionId: string;
      readonly runId: string;
      readonly toolCallId?: string;
      readonly toolName?: string;
      readonly record: GuardrailRecord;
    }
  | { readonly type: "run_limit_exceeded"; readonly sessionId: string; readonly runId: string; readonly breach: RunLimitBreach }
  | { readonly type: "queue_updated"; readonly sessionId: string; readonly runId: string; readonly size: number }
  | {
      /** A steered message was dropped by a terminal input guardrail; the run continues without it. */
      readonly type: "steer_rejected";
      readonly sessionId: string;
      readonly runId: string;
      readonly message: Message;
      readonly record: GuardrailRecord;
    }
  | {
      readonly type: "event_subscriber_overflow";
      readonly sessionId: string;
      readonly runId?: string;
      readonly droppedEvents: number;
      readonly maxQueuedEvents: number;
      readonly overflow: SubscriberOverflowPolicy;
    }
  | { readonly type: "compaction_started"; readonly sessionId: string; readonly runId?: string }
  | { readonly type: "compaction_finished"; readonly sessionId: string; readonly runId?: string; readonly summary: string }
  | {
      readonly type: "retry_scheduled";
      readonly sessionId: string;
      readonly runId: string;
      readonly attempt: number;
      readonly delayMs: number;
      readonly error: ErrorInfo;
    }
  | { readonly type: "error"; readonly sessionId?: string; readonly runId?: string; readonly error: ErrorInfo }
  | {
      readonly type: "artifact_validation_started";
      readonly sessionId: string;
      readonly runId: string;
      readonly turn: number;
      readonly attempt: number;
    }
  | {
      readonly type: "artifact_validation_finished";
      readonly sessionId: string;
      readonly runId: string;
      readonly turn: number;
      readonly attempt: number;
      readonly result: ArtifactValidation;
    }
  | {
      readonly type: "artifact_revision_started";
      readonly sessionId: string;
      readonly runId: string;
      readonly turn: number;
      readonly attempt: number;
      readonly failure: ArtifactValidation;
    }
  | {
      readonly type: "artifact_finished";
      readonly sessionId: string;
      readonly runId: string;
      readonly turn: number;
      readonly attempt: number;
      readonly result: ArtifactValidation;
    }
  | {
      readonly type: "artifact_failed";
      readonly sessionId: string;
      readonly runId: string;
      readonly turn: number;
      readonly attempt: number;
      readonly result: ArtifactValidation;
    };

export type ToolEffectKind = "none" | "local_mutation" | "external_mutation";

export type ToolEffectIdempotency = "none" | "optional" | "required" | "tool_managed" | "unsupported";

/** Static or validated-argument classification of one tool call's side-effect behavior. */
export interface ToolEffectDeclaration {
  readonly kind: ToolEffectKind;
  readonly idempotency: ToolEffectIdempotency;
}

/** Runs after argument validation. It must be synchronous, deterministic, bounded, and side-effect-free. */
export type ToolEffectClassifier = (args: JsonObject, context: ToolExecutionContext) => ToolEffectDeclaration;

/**
 * Elicitation contract declared by a tool. When a durable gated run suspends on this tool,
 * the pending decision has kind `elicitation` and carries this schema as its payload contract;
 * the resume decision's `elicitation` payload resolves the call without executing it.
 */
export interface ToolElicitationRequest {
  /** Typed payload contract; bounded to HARD_MAX_ELICITATION_BYTES when serialized. */
  readonly schema: JsonObject;
  /** Human-facing reason (e.g. the question); bounded to MAX_DECISION_REASON_BYTES. */
  readonly reason?: string;
  /** Answer-shape validation beyond structural schema checks; throw to reject the payload. */
  readonly validate?: (payload: JsonObject) => void;
}

/** Neutral tool-kind union mirroring the ACP `ToolKind` set (B4); never an ACP import in `src/`. */
export type ToolKind = "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "switch_mode" | "other";

export interface ToolDefinition {
  readonly name: string;
  /** Optional explicit kind; consumers (e.g. the ACP mapper) use it instead of name heuristics. */
  readonly kind?: ToolKind;
  readonly description?: string;
  readonly parameters?: JsonObject;
  /** Force any provider turn containing this tool to dispatch sequentially. */
  readonly exclusive?: boolean;
  /** Optional side-effect declaration. Omitted tools retain legacy unmanaged dispatch. */
  readonly effect?: ToolEffectDeclaration | ToolEffectClassifier;
  /** Optional elicitation contract for durable gating; return undefined to fall back to plain tool approval. */
  readonly elicitation?: (args: JsonObject, context: ToolExecutionContext) => ToolElicitationRequest | undefined;
  execute(args: JsonObject, context: ToolExecutionContext): Promise<ToolResult> | ToolResult;
}

export interface ToolRegistry {
  register(tool: ToolDefinition): void;
  get(name: string): ToolDefinition | undefined;
  resolve(name: string): ToolDefinition;
  list(): readonly ToolDefinition[];
}

export interface ToolExecutionContext {
  readonly sessionId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly signal?: AbortSignal;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Host-verified identity for this tool invocation, when enterprise identity is active. */
  readonly identity?: import("./identity.js").AgentIdentity;
  /** Core-derived stable effect key. Never accept a model-supplied key as authority. */
  readonly idempotencyKey?: string;
  progress?(progress?: unknown, metadata?: Readonly<Record<string, unknown>>): void | Promise<void>;
}

export interface ToolResult {
  readonly toolCallId: string;
  readonly name: string;
  readonly content?: readonly ContentBlock[];
  readonly value?: unknown;
  readonly error?: ErrorInfo;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ToolEffectStatus = "pending" | "dispatched" | "completed" | "failed_retryable" | "failed_terminal" | "unknown";

export interface ToolEffectRecord extends OwnershipScope {
  readonly key: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly argumentsHash: string;
  readonly status: ToolEffectStatus;
  readonly attempt: number;
  readonly version: number;
  readonly claimToken?: string;
  readonly result?: ToolResult;
  readonly resultRef?: string;
  readonly failure?: { readonly code: string; readonly reference?: string };
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt?: string;
}

export interface ToolEffectKey {
  readonly identity: import("./identity.js").AgentIdentity;
  readonly ownership: OwnershipScope;
  readonly key: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly argumentsHash: string;
  readonly signal?: AbortSignal;
}

export interface ToolEffectTransition extends ToolEffectKey {
  readonly claimToken: string;
  readonly expectedVersion: number;
}

/** Durable claim/CAS store for recoverable tool effects. */
export interface ToolEffectStore {
  get(input: ToolEffectKey): Promise<ToolEffectRecord | undefined>;
  begin(
    input: ToolEffectKey & { readonly claimTtlMs?: number; readonly maxAttempts?: number },
  ): Promise<{ readonly outcome: "acquired" | "existing"; readonly record: ToolEffectRecord }>;
  markDispatched(input: ToolEffectTransition): Promise<ToolEffectRecord>;
  complete(input: ToolEffectTransition & { readonly result?: ToolResult; readonly resultRef?: string }): Promise<ToolEffectRecord>;
  fail(
    input: ToolEffectTransition & {
      readonly status: "failed_retryable" | "failed_terminal";
      readonly failure: { readonly code: string; readonly reference?: string };
    },
  ): Promise<ToolEffectRecord>;
  markUnknown(
    input: ToolEffectTransition & { readonly failure?: { readonly code: string; readonly reference?: string } },
  ): Promise<ToolEffectRecord>;
  resolveUnknown(
    input: ToolEffectKey & {
      readonly expectedVersion: number;
      readonly status: "completed" | "failed_retryable" | "failed_terminal";
      readonly result?: ToolResult;
      readonly resultRef?: string;
      readonly failure?: { readonly code: string; readonly reference?: string };
    },
  ): Promise<ToolEffectRecord>;
  cleanup(input: {
    readonly ownership: OwnershipScope;
    readonly before: string;
    readonly limit?: number;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly deleted: number }>;
}

export type RunStatus = "queued" | "running" | "suspended" | "denied" | "succeeded" | "failed" | "aborted";

/** Stored run record. */
export interface RunRecord extends OwnershipScope {
  readonly id: string;
  readonly sessionId: string;
  readonly branchId?: string;
  readonly agentDefinitionId?: string;
  readonly agentDefinitionVersion?: string;
  readonly model?: ModelConfig;
  readonly provider?: string;
  readonly idempotencyKey?: string;
  readonly status?: RunStatus;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly abortReason?: string;
  readonly error?: ErrorInfo;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type AgentEventType = AgentEvent["type"];

/** Stored agent event ledger row. The `event` payload should be redacted before storage when secrets are present. */
export interface AgentEventRecord extends OwnershipScope {
  readonly id: string;
  readonly sessionId: string;
  readonly runId?: string;
  /** Durable sources allocate positive, strictly increasing per-run positions. */
  readonly sequence?: number;
  readonly entryId?: string;
  readonly type: AgentEventType;
  readonly timestamp: string;
  readonly event: AgentEvent;
  readonly redacted: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** An event record returned by an {@link AgentEventSource}. */
export interface DurableAgentEventRecord extends AgentEventRecord {
  readonly runId: string;
  readonly sequence: number;
}

export interface AgentEventEnvelope {
  readonly record: DurableAgentEventRecord;
  /** Opaque cursor immediately after `record`. */
  readonly cursor: string;
}

export interface AgentEventSourcePage {
  readonly items: readonly AgentEventEnvelope[];
  readonly nextCursor?: string;
  /** True only after every event preceding a terminal event has been returned. */
  readonly terminal: boolean;
}

/** Exact-owned, per-run durable event read. `after` is exclusive. */
export interface AgentEventSourceRead {
  readonly ownership: OwnershipScope;
  readonly sessionId: string;
  readonly runId: string;
  readonly after?: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface AgentEventSourceCleanup {
  readonly ownership: OwnershipScope;
  readonly before: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface AgentEventSourceOptions {
  readonly maxEventBytes?: number;
  readonly maxPageSize?: number;
  readonly maxCursorBytes?: number;
  readonly maxQueuedEvents?: number;
  readonly maxSubscribers?: number;
  readonly pollIntervalMs?: number;
  readonly reconnectInitialMs?: number;
  readonly reconnectMaxMs?: number;
  readonly maxRetainedEventsPerRun?: number;
  readonly maxRetentionAgeMs?: number;
}

/** Optional durable event capability. `RunLedger` remains a write-only contract. */
export interface AgentEventSource {
  append(record: AgentEventRecord): Promise<DurableAgentEventRecord>;
  page(input: AgentEventSourceRead): Promise<AgentEventSourcePage>;
  subscribe(input: AgentEventSourceRead): AsyncIterable<AgentEventEnvelope>;
  cleanup(input: AgentEventSourceCleanup): Promise<{ readonly deleted: number }>;
}

export type ToolCallStatus = "started" | "finished" | "error" | "blocked";

/** Stored tool-call row. The `result` payload should be redacted before storage when secrets are present. */
export interface ToolCallRecord extends OwnershipScope {
  readonly id: string;
  readonly sessionId: string;
  readonly runId?: string;
  readonly entryId?: string;
  readonly toolCallId: string;
  readonly name: string;
  readonly arguments: JsonObject;
  readonly result?: ToolResult;
  readonly status?: ToolCallStatus;
  readonly reason?: string;
  readonly progress?: unknown;
  readonly progressMetadata?: Readonly<Record<string, unknown>>;
  readonly progressAt?: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly redacted: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type UsageScope = "provider_turn" | "run_total";

/** Stored usage row. `scope` prevents provider-turn and aggregate totals from being summed together. */
export interface UsageRecord extends OwnershipScope {
  readonly id: string;
  readonly sessionId: string;
  readonly runId?: string;
  readonly entryId?: string;
  readonly scope: UsageScope;
  readonly turn?: number;
  readonly attempt?: number;
  readonly usage: Usage;
  readonly recordedAt: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Host-implemented write-side ledger for runs, events, tool calls, and usage. */
export interface RunLedger {
  appendRun(record: RunRecord): Promise<void> | void;
  appendEvent(record: AgentEventRecord): Promise<void> | void;
  appendToolCall(record: ToolCallRecord): Promise<void> | void;
  appendUsage(record: UsageRecord): Promise<void> | void;
}

/** Union of records that may be handed to a {@link RunLedger}. */
export type RunLedgerRecord = RunRecord | AgentEventRecord | ToolCallRecord | UsageRecord;

export type RunLedgerDurability = "write_through" | "flush_on_terminal" | "buffered";

export interface RunLedgerFlushResult {
  readonly accepted: number;
  readonly flushed: number;
  readonly buffered: number;
}

/** Optional durability seam implemented by bounded ledger adapters. */
export interface FlushableRunLedger extends RunLedger {
  readonly durability: RunLedgerDurability;
  flush(): Promise<RunLedgerFlushResult>;
  status(): RunLedgerFlushResult;
  dispose(options?: { readonly flush?: boolean }): Promise<void>;
}

/** Immutable human feedback linked to an existing owned run/trace and optional evaluations. */
export interface ProviderTurnResult {
  readonly content: readonly ContentBlock[];
  readonly calls: readonly ToolCallContent[];
  readonly messageId?: string;
  readonly started: boolean;
  readonly usage?: Usage;
}
