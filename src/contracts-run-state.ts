import type {
  CompactionOptions,
  CompactionResult,
  ContentBlock,
  ContextMeter,
  ErrorInfo,
  JsonObject,
  JsonValue,
  Message,
  ModelConfig,
  RunLimitBreach,
  SessionEntry,
  SessionForkOptions,
  SessionLimitsStatus,
  SubscribeOptions,
  ToolCallContent,
  Usage,
} from "./contracts-core.js";
import type { AgentEvent, AgentFinishReason, RunOptions, ToolEffectKind } from "./contracts-protocol.js";
import type { BudgetExhaustionAttribution } from "./run-limits.js";

export type AgentRunStatus = "succeeded" | "failed" | "aborted" | "suspended" | "denied";

export type AgentRunInterruptionKind = "input_guardrail" | "tool_approval" | "elicitation";

export type ApprovalOutcome = "allow_once" | "allow_for_run" | "reject_once" | "reject_for_run";

export type PendingDecisionKind = "tool_approval" | "elicitation";

/** Redacted match scope for one pending or sticky decision; never contains raw tool arguments. */
export interface DecisionScope {
  readonly toolName?: string;
  readonly effectKind?: ToolEffectKind;
  /** Redacted principal reference (tenant/kind/id); never a credential. */
  readonly identity?: string;
  /** Bounded argument-value constraints; deep-equal matched per key. */
  readonly actionConstraints?: Readonly<Record<string, JsonValue>>;
  /** SHA-256 of canonical JSON arguments; present instead of raw arguments. */
  readonly argumentsHash?: string;
}

/** One redacted, unresolved approval request inside a suspended durable run. */
export interface PendingDecision {
  /** Unique within the run; nested runs use supervisor-prefixed ids. */
  readonly approvalId: string;
  readonly kind: PendingDecisionKind;
  readonly toolCallId?: string;
  readonly scope: DecisionScope;
  /** Bounded, redacted. */
  readonly reason: string;
  /** Typed payload contract for elicitation decisions. */
  readonly elicitationSchema?: JsonObject;
  /**
   * Plan 104 T3: pack `ask` rule that gated this call as `pack:<pack>/<rule>` (bounded by the
   * compile-time id limits), present only when a pack rule raised the decision.
   */
  readonly guardrail?: string;
  /** Plan 104 T3: machine-readable ids behind `guardrail`, so a host never parses the name. */
  readonly guardrailRule?: { readonly pack: string; readonly rule: string };
  /** Delegation chain, root-first; core-written, never client-supplied. */
  readonly attribution?: { readonly path: readonly string[] };
}

/** Redacted safe-boundary descriptor; never contains tool arguments. */
export interface AgentRunInterruption {
  readonly kind: AgentRunInterruptionKind;
  readonly reason: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  /** Plan 104 T3: the pack rule that raised this suspension (`pack:<pack>/<rule>`), when one did. */
  readonly guardrail?: string;
  /** All unresolved approval requests of this suspension; absent for legacy single approvals. */
  readonly pendingDecisions?: readonly PendingDecision[];
}

/** One host decision applied to one pending approval request. */
export interface Decision {
  readonly approvalId: string;
  readonly outcome: ApprovalOutcome;
  /** Bounded to 2 KiB; redacted. */
  readonly reason?: string;
  /** Revalidated (schema, guardrails, policy) before dispatch; produces a new arguments hash. */
  readonly modifiedArguments?: JsonObject;
  /** Elicitation payload; validated against the pending decision's elicitationSchema. */
  readonly elicitation?: JsonObject;
}

/** Run-scoped sticky decision; exact scope match, rechecked against policy, dropped at run end. */
export interface StickyDecision {
  readonly scope: DecisionScope;
  readonly outcome: "allow_for_run" | "reject_for_run";
  readonly reason?: string;
  readonly decidedAt: string;
  /** Delegation path when the sticky was created for a nested-run decision. */
  readonly attribution?: { readonly path: readonly string[] };
}

/** Root-visible link between one nested approval and the child-run approval id. */
export interface NestedRunApproval {
  /** Root-visible approval id (hashed, non-enumerating across runs). */
  readonly id: string;
  /** Approval id as the nested run recorded it. */
  readonly childApprovalId: string;
}

/** Root-visible link between a suspended nested run and the tool call that hosted it. */
export interface NestedRunRef {
  readonly runId: string;
  readonly sessionId?: string;
  readonly toolCallId: string;
  /** The hosting tool: its `resumeNested` settles the call on resume. */
  readonly toolName: string;
  /** This level's attribution: the hosting tool call id, then the child (session id, else run id). */
  readonly path: readonly string[];
  readonly approvals: readonly NestedRunApproval[];
}

/** Reference to an agent run as a nested child identifies it. */
export interface AgentRunRef {
  readonly runId: string;
  readonly sessionId?: string;
}

/** Outcome of resuming a nested run through the hosting tool's `resumeNested`. */
export type NestedRunOutcome =
  | { readonly status: "suspended"; readonly pendingDecisions: readonly PendingDecision[] }
  | { readonly status: "completed"; readonly value?: JsonValue }
  | { readonly status: "failed"; readonly code: string; readonly message: string };

/**
 * `ToolDefinition.resumeNested` (plan 232 Task 3): resume a child run with child-visible decisions.
 * The kernel calls it when a parent `session.resume` routes decisions to the child, and when a sticky
 * `allow_for_run` / `reject_for_run` already covers every ask of a newly surfaced nested suspension.
 * `context` is the hosting call's tool context (session view, principal, signal).
 */
export type ResumeNestedRun = (
  nested: { readonly ref: AgentRunRef; readonly toolCallId: string; readonly path: readonly string[] },
  decisions: readonly Decision[],
  context: import("./contracts-protocol.js").ToolExecutionContext,
) => Promise<NestedRunOutcome>;

/**
 * Thrown by a tool's `execute` when a child run it started suspends on pending decisions. The kernel
 * stages it like a gated ask: the round's other calls finish, then the run suspends with the child's
 * decisions under root-visible approval ids and an attribution path naming the call and the child.
 * The tool must define `resumeNested`, else the call fails closed.
 */
export class AgentDelegationSuspendedError extends Error {
  readonly code = "ERR_PRISM_DELEGATION_SUSPENDED";
  toolCall?: ToolCallContent;
  constructor(
    readonly ref: AgentRunRef,
    readonly pendingDecisions: readonly PendingDecision[],
  ) {
    super("Delegated run suspended");
    this.name = "AgentDelegationSuspendedError";
  }
}

/** Shared decision-contract violations. Unknown and foreign approval ids share one non-enumerating error. */
export class AgentDecisionError extends Error {
  constructor(
    readonly code:
      | "ERR_PRISM_DECISION_STALE"
      | "ERR_PRISM_DECISION_UNKNOWN"
      | "ERR_PRISM_DECISION_DUPLICATE"
      | "ERR_PRISM_DECISION_SCOPE"
      | "ERR_PRISM_DECISION_INVALID"
      | "ERR_PRISM_DECISION_LIMIT",
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "AgentDecisionError";
  }
}

/** Shipped `ceilings.pendingDecisions`: pending decisions per run, and the size of one decision batch. */
export const HARD_MAX_PENDING_DECISIONS = 128;
/** Shipped `ceilings.stickyDecisions`: sticky decisions one run may hold. */
export const DEFAULT_MAX_STICKY_DECISIONS = 64;
export const MAX_DECISION_REASON_BYTES = 2 * 1024;
export const HARD_MAX_DECISION_REASON_BYTES = 8 * 1024;
export const MAX_ELICITATION_BYTES = 16 * 1024;
export const HARD_MAX_ELICITATION_BYTES = 64 * 1024;
export const MAX_ACTION_CONSTRAINTS = 32;
export const HARD_MAX_ACTION_CONSTRAINTS = 64;
/** Maximum delegation attribution depth for surfaced nested pending decisions (two entries per level). */
export const MAX_ATTRIBUTION_DEPTH = 8;
/**
 * How many times one nested suspension is resumed in a row by sticky decisions alone before it is
 * surfaced to the host, so a child that keeps re-asking cannot spin the parent.
 */
export const MAX_NESTED_STICKY_RESUMES = 4;
export const MAX_ACTION_CONSTRAINT_BYTES = 4 * 1024;
export const HARD_MAX_ACTION_CONSTRAINT_BYTES = 16 * 1024;

/** Versioned, redacted checkpoint payload. Treat as opaque except status/version/interruption. */
export interface AgentRunState {
  readonly schemaVersion: 1;
  readonly agentId: string;
  readonly definitionRevision: string;
  readonly fingerprint: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly leafId?: string;
  readonly model?: ModelConfig;
  readonly status: AgentRunStatus | "running";
  readonly interruption?: AgentRunInterruption;
  readonly version?: number;
}

export class AgentRunStateError extends Error {
  readonly code = "ERR_PRISM_AGENT_RUN_STATE";
  constructor(message: string) {
    super(message);
    this.name = "AgentRunStateError";
  }
}

/**
 * Durable-loop contract violations: hook-less custom strategy on a durable run, invalid snapshot, revision
 * drift, or a second concurrent run on a strategy that keeps its state on the strategy object.
 */
export class AgentLoopStateError extends Error {
  constructor(
    readonly code: "ERR_PRISM_LOOP_NOT_DURABLE" | "ERR_PRISM_LOOP_SNAPSHOT" | "ERR_PRISM_LOOP_REVISION" | "ERR_PRISM_LOOP_SHARED_STATE",
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "AgentLoopStateError";
  }
}

export const SESSION_NOTHING_TO_CONTINUE_CODE = "nothing_to_continue" as const;

/**
 * Thrown by `session.continue()` / `continueStream()` when the branch owes no model turn: it is empty,
 * or its tail is a completed assistant message. A pending suspension rejects with `AgentDecisionError`.
 */
export class SessionContinueError extends Error {
  readonly code = SESSION_NOTHING_TO_CONTINUE_CODE;
  constructor(
    readonly sessionId: string,
    message = `Session "${sessionId}" has nothing to continue: its branch does not owe a model turn`,
  ) {
    super(message);
    this.name = "SessionContinueError";
  }
}

/** How a run ended, as the host sees it. `AgentRunStatus` stays the persisted checkpoint/ledger vocabulary. */
export type RunResultStatus = "completed" | "stopped" | "suspended" | "failed" | "aborted";

/**
 * Map the persisted run status (and the clean-stop reason, when the loop recorded one) to the status
 * a host sees: a bare `succeeded` is `completed`, a clean stop is `stopped`, and a denied resume is a
 * `stopped` run whose `stopReason` is `denied`.
 */
export function toRunResultStatus(status: AgentRunStatus, stopReason?: AgentFinishReason): RunResultStatus {
  switch (status) {
    case "succeeded":
      return stopReason ? "stopped" : "completed";
    case "denied":
      return "stopped";
    default:
      return status;
  }
}

/**
 * Result of `session.run()`. A run that fails or is aborted after it started resolves to a result
 * with `status: "failed" | "aborted"` and `error`; it does not throw. Only a call that cannot start
 * a run at all (an active run, an invalid option) rejects.
 */
export interface RunResult {
  readonly sessionId: string;
  readonly runId: string;
  readonly status: RunResultStatus;
  /** Branch leaf after the run settles. */
  readonly leafId?: string;
  /** Concatenated text blocks from the final assistant message, or `""` when none. */
  readonly text: string;
  /** Content blocks from the final assistant message, or `[]` when none. */
  readonly content: readonly ContentBlock[];
  /** Final assistant message when the run produced one. */
  readonly message?: Message;
  /** Messages this run appended to the branch (input, assistant turns, tool results), in order. */
  readonly messages: readonly Message[];
  /** Aggregate usage across provider turns (`run_total` scope). */
  readonly usage?: Usage;
  /** Present when the run hit a configured resource ceiling. */
  readonly limit?: RunLimitBreach;
  /**
   * Present with `limit` when the run died on a ceiling: the same plan-087 attribution payload the
   * `run.failed` event carries (`limit` stays on {@link RunResult.limit}).
   */
  readonly attribution?: BudgetExhaustionAttribution;
  /** Present when `status` is `"failed"` or when a failed attempt still produced partial output. */
  readonly error?: ErrorInfo;
  /** String form of the abort reason when `status` is `"aborted"`. */
  readonly abortReason?: string;
  /** Why a `stopped` run stopped: a ceiling, a `turn.before` stop, a `run.end` continuation cap, `denied`, or an `endRun` tool result (`tool_end_run`). */
  readonly stopReason?: AgentFinishReason;
  /** Why the `turn.before` hook or an `endRun` tool result stopped the run (≤256 bytes, redacted). */
  readonly stopDetail?: string;
  /** Present when `status` is `"suspended"`: the unresolved decisions to pass to `session.resume`. Redacted. */
  readonly pending?: readonly PendingDecision[];
  /** Present for durable suspended/terminal runs. Payload is redacted and bounded. */
  readonly runState?: AgentRunState;
  /**
   * The final reply parsed as JSON and validated against `providerOptions.structuredOutput.schema`.
   * Present only on a succeeded run that asked for structured output and whose reply passed.
   */
  readonly output?: unknown;
  /** Why the final reply did not yield {@link RunResult.output}. Never present with `output`. */
  readonly outputError?: RunOutputError;
}

/** Maximum entries in {@link RunOutputError.errors}. */
export const MAX_RUN_OUTPUT_ERRORS = 8;

/**
 * A structured-output reply that did not parse (`invalid_json`) or did not satisfy the schema
 * (`schema_mismatch`). Entries name a JSON path and the expected shape, never reply content.
 */
export interface RunOutputError {
  readonly code: "invalid_json" | "schema_mismatch";
  /** At most {@link MAX_RUN_OUTPUT_ERRORS} entries. */
  readonly errors: readonly { readonly path: string; readonly message: string }[];
}

/** Shipped `ceilings.pendingSteers`: queued steer messages per session (fail closed at this cap). */
export const DEFAULT_MAX_PENDING_STEERS = 8;
/** Shipped `ceilings.pendingSteerBytes`: total UTF-8 bytes of queued steer messages per session. */
export const DEFAULT_MAX_PENDING_STEER_BYTES = 64 * 1024;

export interface SteerOptions {
  /**
   * When true, abort the in-flight provider stream and continue the same run after
   * injecting steered user text. Default false: inject before the next provider turn
   * (after the current tool batch completes).
   */
  readonly softInterrupt?: boolean;
}

export interface Session {
  readonly id: string;
  /** Current branch leaf entry id; advances on every append/run and is re-pointed by `checkout`.
   *  Undefined until the first entry lands (a fresh session with no history). */
  readonly leafId: string | undefined;
  run(input: string | Message | readonly Message[], options?: RunOptions): Promise<RunResult>;
  /**
   * Enqueue user text into an active run. Default injects before the next provider turn.
   * `softInterrupt: true` aborts the current provider stream, then continues the same run.
   * Fails closed when no run is active or the pending queue exceeds caps.
   */
  steer(input: string | Message | readonly Message[], options?: SteerOptions): void;
  /**
   * Subscribe first, then start exactly one run and yield only that run's events until it terminates.
   * This subscription belongs to `stream()`: it is closed when the owned run settles (so a pre-flight
   * rejection unblocks the consumer instead of parking it behind a run that never emits).
   */
  stream(input: string | Message | readonly Message[], options?: RunOptions & SubscribeOptions): AsyncIterable<AgentEvent>;
  compact(options?: CompactionOptions): Promise<CompactionResult>;
  /**
   * Subscribe to this session's live events. A run-scoped subscriber (default) is closed when the run
   * ends, suspends, or is denied; `SubscribeOptions.acrossRuns: true` keeps it open across runs until
   * `subscription.close()`, `closeSubscribers()`, or a queue overflow closes it.
   */
  subscribe(options?: SubscribeOptions): AsyncIterable<AgentEvent>;
  /**
   * Session teardown: closes every subscriber (`acrossRuns` included); calling it twice is a no-op. Call after the
   * active run settles. Subscriber-only teardown stays `break`ing the `for await` (or calling the
   * iterator's `return()`). See [Agent/session runtime](agent-session-runtime.md).
   */
  close(): Promise<void>;
  abort(reason?: unknown): void;
  /**
   * The stored messages of the current branch (after `message.append`), never the `context.build`
   * draft a provider saw. Reads the branch snapshot cache, so a warm session adds no store read.
   */
  messages(): Promise<readonly Message[]>;
  /** Kernel member: the current branch's raw entries (hosts that render or project the transcript). */
  entries(): Promise<readonly SessionEntry[]>;
  /**
   * Continue this session's suspended run with one decision per pending `ask`. It reads the suspension
   * from the session's branch, so it works on a fresh `agent.session({ id })` in a new process over the
   * same store. Every pending id must be decided exactly once: an unknown, duplicate, or missing id, no
   * pending suspension, or a drifted agent (fingerprint, hook ids, loop revision) fails closed. It yields
   * `decision.resolved`, then the resumed run's events from `run.started { resumed: true }`. The
   * `SubscribeOptions` bound this resume's own subscriber, so a slow consumer fails loudly
   * (plan 168 Task 5 kept the guarantee when the checkpoint resume stream was retired).
   */
  resume(decisions: readonly Decision[], options?: RunOptions & SubscribeOptions): AsyncIterable<AgentEvent>;
  /**
   * Start a run with no new input on a branch that stopped partway: a crash, a provider failure, a
   * limit breach, or an abort. The branch must owe a model turn (its tail is a user message, tool
   * results, or an assistant message with unanswered calls), else it rejects with
   * {@link SessionContinueError}; a pending suspension rejects with `AgentDecisionError` (use `resume`).
   * Each unanswered call at the tip first gets a persisted result: its stored effect result, an
   * outcome-unknown result for an effect that was dispatched, or `tool_call_interrupted`. No tool is
   * re-dispatched. The run is a new run id with fresh counters and emits `run.started { continued: true }`.
   */
  continue(options?: RunOptions): Promise<RunResult>;
  /** The streaming form of {@link Session.continue}, as `stream` is of `run`. */
  continueStream(options?: RunOptions & SubscribeOptions): AsyncIterable<AgentEvent>;
  /** Kernel member: re-point this session at another entry of its own branch tree (Prism Code branching). */
  checkout(leafId?: string): Promise<void>;
  /**
   * Context-fill read (plan 091 T2): latest provider turn's input tokens
   * (reported or labeled estimate) plus the resolved per-request cap, run input
   * budget, and used ratio. Before any provider turn it estimates stored history.
   */
  contextMeter(): ContextMeter;
  /**
   * Copy the branch that ends at `at` (default: the current leaf) into a new session, package state
   * included, and resolve that session opened. The original is untouched.
   */
  fork(options?: SessionForkOptions): Promise<Session>;
  /**
   * Current session-wide limit counters and remaining budget (`SessionOptions.limits` / `AgentConfig.sessionLimits`),
   * restored from the store across restarts.
   */
  limits(): Promise<SessionLimitsStatus>;
  /** Plan 137 Task 3: loaded skill names currently active in this session. */
  getLoadedSkillNames?(): readonly string[];
  /** Plan 015 / Plan 137 Task 3: re-add loaded skill names to session. */
  restoreLoadedSkills?(names: readonly string[]): void;
}
