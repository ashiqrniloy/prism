import type { CacheUsageReport } from "./provider-kit/cache-helpers.js";

/** One hook that completed during a restore. The runner lives in `@arnilo/prism-extensions/workflows`. */
export interface CheckpointRestoreAuditEntry {
  readonly hook: string;
  readonly durationMs: number;
}

/** Audit of a completed restore: every hook that ran, in order. */
export interface CheckpointRestoreAudit {
  readonly hooks: readonly CheckpointRestoreAuditEntry[];
  readonly durationMs: number;
}
import type {
  CompactionOptions,
  ContentBlock,
  ErrorInfo,
  JsonObject,
  JsonValue,
  Message,
  ModelConfig,
  ModelRef,
  ModelSpec,
  OwnershipScope,
  ProviderRequestOptions,
  ProviderStopReason,
  RetryOptions,
  RunLimitBreach,
  RunLimits,
  SystemPromptConfig,
  ToolCallAuthority,
  ToolCallContent,
  TurnBudgets,
  Usage,
} from "./contracts-core.js";
import type { AgentRunInterruption, PendingDecision } from "./contracts-run-state.js";
import type { BudgetExhaustionAttribution } from "./run-limits.js";
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
  | { readonly type: "done"; readonly usage?: Usage; readonly stopReason?: ProviderStopReason }
  | { readonly type: "error"; readonly error: ErrorInfo };

/** Provider-input ordering. `"cache_aware"` (stable instructions, attachments, summaries, history, tool results, then input) is the only layout. */
export type InputAssemblyLayout = "cache_aware";

/** Opaque provenance ref for the resolved prompt version that produced a run
 *  (plan 042). Identity only — never prompt content; the body is recoverable
 *  from the prompt store via `hash`. */
export interface PromptVersionRef {
  /** Prompt name within the host's prompt store. */
  readonly name: string;
  /** Immutable version number assigned by the prompt store. */
  readonly version: number;
  /** Content hash of the exact UTF-8 body bytes: `sha256:<64 lowercase hex>`. */
  readonly hash: string;
}

export interface RunOptions {
  readonly signal?: AbortSignal;
  readonly model?: ModelRef;
  /** Run-scoped ceilings. When an agent config also sets limits, these can only narrow it. */
  readonly limits?: RunLimits;
  readonly providerOptions?: ProviderRequestOptions;
  /** Portable thinking intent for this run. Overrides `AgentConfig.thinkingLevel`. */
  readonly thinkingLevel?: string;
  readonly systemPrompt?: SystemPromptConfig;
  readonly compaction?: false | CompactionOptions;
  readonly retry?: false | RetryOptions;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /**
   * Whether this run may ask the host a question (roadmap §2.4). Defaults to `true` when the agent
   * has a `HostUi`. `false` skips only the kernel ask confirm (`resolveAskDecisions`); the ask suspends
   * without a prompt. Package `host.ui` requests still reach the host. An ACP/AG-UI host uses that to
   * answer approvals through `session.resume` instead of a boolean confirm.
   */
  readonly interactive?: boolean;
  readonly redactor?: SecretRedactor;
  readonly runLedger?: RunLedger;
  /** Optional durable recovery store. Per-run value overrides this agent default. */
  readonly effectStore?: ToolEffectStore;
  /**
   * Narrows the session's effective ownership scope for this run (plan 177 Task 4): it may add fields the
   * session left undefined or repeat them, but a field that changes the session's value throws
   * `OwnershipScopeError` (`ERR_PRISM_OWNERSHIP_WIDEN`) before any event. The branch is re-checked against
   * the effective scope before the run writes anything.
   */
  readonly ownership?: OwnershipScope;
  /** Opaque host principal; overrides the agent default without kernel verification. */
  readonly principal?: import("./contracts-core/principal.js").Principal;
  readonly idempotencyKey?: string;
  readonly validate?: ToolValidator;
  /**
   * Optional per-run allow-list of registered tool names. Omitted → every registered tool (legacy).
   * Empty → no tools this run. Unknown names fail closed. Cannot widen the agent registry or a
   * checkpointed grant; resume intersects this list with current authority.
   */
  readonly tools?: { readonly only?: readonly string[] };
  /** Opt-in: tools hidden by `RunOptions.tools` stay callable by name (default off). Overrides agent config. */
  readonly allowHiddenToolCalls?: true;
  readonly inputLayout?: InputAssemblyLayout;
  /** Prompt provenance: copied verbatim onto this run's start and finish ledger records. */
  readonly promptVersion?: PromptVersionRef;
}

/** `RunOptions` after the run's edge parsed `model` into a `ModelSpec`. */
export type ResolvedRunOptions = Omit<RunOptions, "model"> & { readonly model?: ModelSpec };

export interface ProviderTurnMetadata {
  readonly providerId: string;
  readonly model: ModelConfig;
  readonly requestId?: string;
  readonly latencyMs?: number;
  readonly attempt?: number;
  readonly httpStatus?: number;
  readonly rateLimitRemaining?: number;
  readonly rateLimitResetMs?: number;
  /** Why the provider turn stopped (plan 087 T1); present on `turn.completed` only. */
  readonly stopReason?: ProviderStopReason;
  /** Effective budget state at turn end (plan 087 T1); present on `turn.completed` only. */
  readonly budgets?: TurnBudgets;
  /** Provider-reported cache usage and derived hit rate; absent when cache usage is unknown. */
  readonly cache?: CacheUsageReport;
  /** Effective tool menu this turn. Names hashed in request order; never includes args. */
  readonly tools?: {
    readonly count: number;
    readonly idsHash: string;
  };
}

export interface ToolExecutionMetadata {
  readonly durationMs: number;
  readonly status: ToolCallStatus;
}

export type DelegatedAgentStepState = "active" | "done" | "error";
export type DelegatedAgentStepKind = "assistant" | "tool" | "subagent" | "checkpoint" | "unknown";

/** Token counters only; delegated adapters must never put thought text in this shape. */
export interface DelegatedAgentStepUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly thinkingTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly totalTokens?: number;
}

/**
 * Safe delegated timeline metadata, carried as the `data` of a `package.event` named `agent.step`.
 * Raw arguments, results, paths, URIs, and event bodies are not fields.
 */
export interface DelegatedAgentStepData {
  readonly adapterId: string;
  readonly externalConversationId: string;
  readonly stepIndex: number;
  readonly state: DelegatedAgentStepState;
  readonly kind: DelegatedAgentStepKind;
  readonly durationMs?: number;
  readonly usage?: DelegatedAgentStepUsage;
  readonly toolName?: string;
  readonly subagentType?: string;
  readonly detail?: {
    readonly referenceId?: string;
    readonly label?: string;
  };
}

/** Why a run stopped cleanly. `hook_stop` is a `turn.before` stop and `hook_limit` a `run.end` continuation cap; the rest are loop ceilings (F4). */
export type AgentFinishReason = "turn_limit" | "token_limit" | "refusal" | "hook_limit" | "hook_stop" | "denied";

/**
 * Where an event came from (K3). Absent means "this agent, executed by Prism". `vendor` is an
 * opaque string set by the driver; `profile` is a profile name, never a credential.
 */
export interface EventOrigin {
  readonly kind: "prism" | "external";
  readonly agent: string;
  readonly vendor?: string;
  readonly profile?: string;
  readonly agentId: string;
  readonly remote?: string;
  readonly delegationId?: string;
  readonly parentSessionId?: string;
  readonly parentToolCallId?: string;
  readonly subagentId?: string;
  /** Nesting depth: 0 is the run's own agent, 1 a direct subagent. */
  readonly depth: number;
  readonly executedBy?: "prism" | "external";
}

/** Payload union of every agent event; the exported `AgentEvent` adds the optional `origin` tag. */
/**
 * The frozen event catalog (roadmap §2.3). Every member is also an observe hook of the same
 * name (`src/hooks/catalog.ts`), and no other name is legal: `OBSERVE_HOOKS` is keyed by this
 * union, so adding a member fails to compile until it is listed there too.
 *
 * A folded event carries the fields of everything it replaced. `run.completed` distinguishes a
 * natural end from a clean stop; `tool.completed` carries the call's status; `turn.completed`
 * carries usage. Folds keep one event per occurrence, so a run's event count never grows.
 */
export type AgentEventPayload =
  // --- run ---------------------------------------------------------------------------------
  | {
      readonly type: "run.started";
      readonly sessionId: string;
      readonly runId: string;
      /** A durable resume of a suspended run, rather than a fresh run. */
      readonly resumed?: boolean;
      /** Plan 094 Task 3: audit of the external-state restore hooks that ran before this claim. */
      readonly restore?: CheckpointRestoreAudit;
    }
  | {
      readonly type: "run.completed";
      readonly sessionId: string;
      readonly runId: string;
      /** `completed` is a natural end; `stopped` is a clean stop the `stopReason` names. */
      readonly status: "completed" | "stopped";
      readonly usage?: Usage;
      /** Why the loop stopped, when a limit/ceiling, a `turn.before` stop, or a `run.end` continuation cap ended the run cleanly (F4). */
      readonly stopReason?: AgentFinishReason;
      /** Why the `turn.before` hook stopped the run (≤256 bytes, redacted). Present only with `stopReason: "hook_stop"`. */
      readonly stopDetail?: string;
    }
  | {
      /**
       * A run that ended in failure. `error` is redacted. When a configured ceiling ended the run
       * this carries `limit` and `attribution` (the former `run_limit_exceeded` and `budget_exhausted`).
       * `sessionId`/`runId` are optional because a pre-run failure has no run yet.
       */
      readonly type: "run.failed";
      readonly sessionId?: string;
      readonly runId?: string;
      readonly error: ErrorInfo;
      /** Present when the run hit a configured resource ceiling. */
      readonly limit?: RunLimitBreach;
      /** Present with `limit`: which axis fired, counters at exhaustion, and hashes of recent tool calls (plan 087 T2). */
      readonly attribution?: BudgetExhaustionAttribution;
    }
  | {
      readonly type: "run.suspended";
      readonly sessionId: string;
      readonly runId: string;
      readonly interruption: AgentRunInterruption;
      readonly version: number;
    }
  // --- turn --------------------------------------------------------------------------------
  | {
      /**
       * One provider attempt began: `metadata` carries the provider, model, and attempt number.
       * A retry re-opens the turn with `attempt` and `retry` set (the former `retry_scheduled`).
       */
      readonly type: "turn.started";
      readonly sessionId: string;
      readonly runId: string;
      readonly turn: number;
      readonly metadata: ProviderTurnMetadata;
      readonly attempt?: number;
      /** Set when this attempt follows a retry decision. `error` is redacted. */
      readonly retry?: { readonly delayMs: number; readonly error: ErrorInfo };
    }
  | {
      /** The attempt settled: `metadata` carries latency, stop reason, budgets, and cache. */
      readonly type: "turn.completed";
      readonly sessionId: string;
      readonly runId: string;
      readonly turn: number;
      readonly metadata: ProviderTurnMetadata;
      readonly usage?: Usage;
      /** Redacted; present when the attempt failed (the former `provider_turn_finished` error case). */
      readonly error?: ErrorInfo;
    }
  // --- message -----------------------------------------------------------------------------
  | { readonly type: "message.delta"; readonly sessionId: string; readonly runId: string; readonly content: ContentBlock }
  | { readonly type: "message.completed"; readonly sessionId: string; readonly runId: string; readonly message: Message }
  // --- tool --------------------------------------------------------------------------------
  | { readonly type: "tool.started"; readonly sessionId: string; readonly runId: string; readonly call: ToolCallContent }
  | {
      readonly type: "tool.progress";
      readonly sessionId: string;
      readonly runId: string;
      readonly toolCallId: string;
      readonly name: string;
      readonly progress?: unknown;
      readonly metadata?: Readonly<Record<string, unknown>>;
    }
  | {
      /**
       * A tool call settled. `status` is the call's `ToolExecutionMetadata.status`, so the former
       * `tool_execution_error` (`error`) and `tool_execution_blocked` (`blocked` + `reason`) are the
       * same event with a different status. `error`/`reason` stay redacted exactly as before.
       */
      readonly type: "tool.completed";
      readonly sessionId: string;
      readonly runId: string;
      /** The settled call's id; falls back to `result.toolCallId` when a producer omits it. */
      readonly toolCallId?: string;
      /** The settled call's tool name; falls back to `result.name`. */
      readonly name?: string;
      readonly result: ToolResult;
      readonly metadata: ToolExecutionMetadata;
      readonly status: ToolCallStatus;
      /** Redacted; present when `status` is `"error"` (a throwing tool) or `"blocked"`. */
      readonly error?: ErrorInfo;
      /** Redacted; present when `status` is `"blocked"` — why the call never ran. */
      readonly reason?: string;
    }
  // --- decision ----------------------------------------------------------------------------
  | {
      /**
       * One or more `ask` decisions were staged for suspension. Carries the redacted
       * {@link PendingDecision} records only — never raw tool arguments.
       */
      readonly type: "decision.pending";
      readonly sessionId: string;
      readonly runId: string;
      readonly decisions: readonly PendingDecision[];
    }
  | {
      /**
       * A staged decision batch settled: inline by a host answer, or later by `resume(decisions)`.
       * One entry per settled decision — the tool call id and the outcome, never the arguments.
       */
      readonly type: "decision.resolved";
      readonly sessionId: string;
      readonly runId: string;
      readonly decisions: readonly { readonly toolCallId: string; readonly outcome: "allow" | "deny" }[];
      readonly via: "inline" | "resume";
    }
  // --- compaction --------------------------------------------------------------------------
  | { readonly type: "compaction.started"; readonly sessionId: string; readonly runId?: string }
  | {
      readonly type: "compaction.completed";
      readonly sessionId: string;
      readonly runId?: string;
      readonly summary?: string;
      readonly entriesCompacted?: number;
      /** Who asked: the configured auto trigger, a manual compact, or overflow recovery. */
      readonly trigger?: import("./contracts-core/compaction.js").CompactionReason | string;
      /** Redacted; present when compaction failed (the former `compaction_failed`). */
      readonly error?: ErrorInfo;
    }
  // --- hook / package ----------------------------------------------------------------------
  | {
      readonly type: "hook.error";
      readonly sessionId: string;
      readonly runId: string;
      /** Hook that threw (catalog name), e.g. `run.input` or an observe event name. */
      readonly hook: string;
      /** Owning package/host set by the kernel; never chosen by a handler. */
      readonly owner: string;
      readonly error: ErrorInfo;
    }
  | {
      readonly type: "package.event";
      readonly sessionId: string;
      readonly runId: string;
      /** Registered package that emitted the event. Kernel modules use `"kernel"`. */
      readonly package: string;
      /** Package-defined event name, e.g. `memory.session.status` or `guardrail.decision`. */
      readonly name: string;
      readonly data?: JsonValue;
    }
  /**
   * Session lifecycle (roadmap §2.3). Not run-scoped, so `runId` is empty. Delivered to hooks only, so
   * an existing session stream is unchanged. `session.opened` fires once the session's package state has
   * hydrated: before its first run, command, or `close()`.
   */
  | {
      readonly type: "session.opened";
      readonly sessionId: string;
      readonly runId: string;
      /** The branch already held entries when the session was opened (a reopened or forked session). */
      readonly restored: boolean;
    }
  | {
      readonly type: "session.closed";
      readonly sessionId: string;
      readonly runId: string;
      readonly reason?: string;
    }
  /** A package's `status.note`. Agent-scoped (`sessionId` and `runId` are empty) and redacted. */
  | {
      readonly type: "package.status";
      readonly sessionId: string;
      readonly runId: string;
      readonly package: string;
      readonly level: "info" | "warn";
      readonly message: string;
      readonly at: string;
    }
  /** A `SessionContext.background` task started. `package` is set when a loaded package started it. */
  | {
      readonly type: "background.started";
      readonly sessionId: string;
      readonly runId: string;
      readonly package?: string;
      readonly name: string;
      readonly taskId: string;
    }
  | {
      readonly type: "background.completed";
      readonly sessionId: string;
      readonly runId: string;
      readonly package?: string;
      readonly name: string;
      readonly taskId: string;
      readonly durationMs: number;
    }
  /** `reason: "aborted"` means `close()` gave up on the task and carries no error. `error` is redacted. */
  | {
      readonly type: "background.failed";
      readonly sessionId: string;
      readonly runId: string;
      readonly package?: string;
      readonly name: string;
      readonly taskId: string;
      readonly reason: "error" | "aborted";
      readonly error?: ErrorInfo;
    };

/**
 * One agent event. `origin` is set when the event did not come from this agent's own Prism
 * loop (driver-observed activity, forwarded subagent work). It never replaces the event's own
 * `sessionId`/`runId`.
 */
export type AgentEvent = AgentEventPayload & { readonly origin?: EventOrigin };

export type AgentEventSourceErrorCode =
  | "ERR_PRISM_AGENT_EVENT_SOURCE_INPUT"
  | "ERR_PRISM_AGENT_EVENT_SOURCE_CURSOR"
  | "ERR_PRISM_AGENT_EVENT_SOURCE_RETENTION"
  | "ERR_PRISM_AGENT_EVENT_SOURCE_OVERFLOW"
  | "ERR_PRISM_AGENT_EVENT_SOURCE_CLOSED";

export class AgentEventSourceError extends Error {
  constructor(
    readonly code: AgentEventSourceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentEventSourceError";
  }
}

// Keyed by `AgentEventType` so a new event type fails the build until it is listed here.
const KNOWN_AGENT_EVENT_TYPES: { readonly [K in AgentEvent["type"]]: true } = {
  "run.started": true,
  "run.completed": true,
  "run.failed": true,
  "run.suspended": true,
  "turn.started": true,
  "turn.completed": true,
  "message.delta": true,
  "message.completed": true,
  "tool.started": true,
  "tool.progress": true,
  "tool.completed": true,
  "decision.pending": true,
  "decision.resolved": true,
  "compaction.started": true,
  "compaction.completed": true,
  "background.started": true,
  "background.completed": true,
  "background.failed": true,
  "hook.error": true,
  "package.event": true,
  "package.status": true,
  "session.opened": true,
  "session.closed": true,
};

/**
 * True when `type` is an `AgentEvent` type this kernel version emits. A later minor may add types
 * (docs/compatibility.md); a host that only wants the ones it was built against filters with this.
 */
export function isKnownAgentEventType(type: unknown): type is AgentEvent["type"] {
  return typeof type === "string" && Object.hasOwn(KNOWN_AGENT_EVENT_TYPES, type);
}

/** A run stream ends on its outcome. A run-limit death is already `run.failed`. */
export function isTerminalAgentEventType(type: AgentEvent["type"]): boolean {
  return type === "run.completed" || type === "run.failed";
}

export type ToolEffectKind = "none" | "local_mutation" | "external_mutation";

/**
 * Capability annotation for a tool, reported to `tool.call` hooks. Independent of the recovery
 * `effect` declaration: `ToolEffectKind` classifies a call's side effects, `ToolCapabilityKind`
 * states what a tool is allowed to reach. A tool with no `effects` is reported as all kinds.
 */
export type ToolCapabilityKind = "read" | "write" | "execute" | "network" | "external";

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
  /**
   * Capabilities this tool may reach, reported to `tool.call` hooks. Omitted tools are reported as
   * all kinds (fail closed). Independent of `effect`, which classifies recovery behavior.
   */
  readonly effects?: readonly ToolCapabilityKind[];
  /** Optional elicitation contract for durable gating; return undefined to fall back to plain tool approval. */
  readonly elicitation?: (args: JsonObject, context: ToolExecutionContext) => ToolElicitationRequest | undefined;
  execute(args: JsonObject, context: ToolExecutionContext): Promise<ToolResult> | ToolResult;
}

export interface ToolRegistry {
  register(tool: ToolDefinition): void;
  get(name: string): ToolDefinition | undefined;
  resolve(name: string): ToolDefinition;
  list(): readonly ToolDefinition[];
  /** Removes a tool by name. Optional for host-supplied registries; returns whether it existed. */
  unregister?(name: string): boolean;
}

export interface ToolExecutionContext {
  readonly sessionId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly signal?: AbortSignal;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Opaque host principal, passed through unchanged. */
  readonly principal?: import("./contracts-core/principal.js").Principal;
  /** Core-derived stable effect key. Never accept a model-supplied key as authority. */
  readonly idempotencyKey?: string;
  /** The session as the executing tool's owner sees it (`when` predicates and package tools). */
  readonly session?: import("./session-context.js").SessionContext;
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
  /** Present when the loop stopped on a ceiling or a `turn.before` stop instead of a natural end. */
  readonly stopReason?: AgentFinishReason;
  /** Why the `turn.before` hook stopped the run (≤256 bytes, redacted). */
  readonly stopDetail?: string;
  readonly error?: ErrorInfo;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Provenance ref copied from `RunOptions.promptVersion` when the host supplied one. */
  readonly promptVersion?: PromptVersionRef;
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
  /**
   * Provenance for turns that did not come from the provider (plan 096):
   * `{ deterministic: { middleware } }`. Copied onto the assistant `Message.metadata`, so it
   * serializes with the transcript and survives replay. Absent for provider turns.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}
