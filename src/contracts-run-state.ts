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
  /** Redacted delegation path (child ids, root first). */
  readonly path: readonly string[];
  readonly approvals: readonly NestedRunApproval[];
  /** Decisions persisted by a partial batch, keyed by root-visible approval id. */
  readonly decisions?: Readonly<Record<string, Decision>>;
}

/** Outcome of resuming a nested run through the host-supplied hook. */
/** Reference to an agent run as a nested child identifies it (plan 168 Task 5: kept for the nested-run path). */
export interface AgentRunRef {
  readonly runId: string;
  readonly sessionId?: string;
}

export type NestedRunOutcome =
  | { readonly status: "suspended"; readonly pendingDecisions: readonly PendingDecision[] }
  | { readonly status: "completed"; readonly value?: JsonValue }
  | { readonly status: "failed"; readonly code: string; readonly message: string };

/**
 * Host hook that resumes a nested run (supervisor child) with child-visible decisions.
 * Used both when a nested suspension first surfaces (sticky auto-apply) and when root
 * decisions route back to the child on resume.
 */
export type ResumeNestedRun = (
  nested: { readonly ref: AgentRunRef; readonly toolCallId: string; readonly path: readonly string[] },
  decisions: readonly Decision[],
) => Promise<NestedRunOutcome>;

/**
 * Thrown by a delegated-run host (e.g. the supervisor) when a nested run suspends on
 * pending decisions inside a tool execution. Core converts it into a root suspension
 * with attributed, root-visible approval ids; the dispatching wrapper attaches `toolCall`.
 */
export class AgentDelegationSuspendedError extends Error {
  readonly code = "ERR_PRISM_DELEGATION_SUSPENDED";
  toolCall?: ToolCallContent;
  constructor(
    readonly ref: AgentRunRef,
    readonly pendingDecisions: readonly PendingDecision[],
    /** Redacted delegation path (child ids) used when decisions carry no attribution. */
    readonly path?: readonly string[],
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

export const DEFAULT_MAX_PENDING_DECISIONS = 32;
export const HARD_MAX_PENDING_DECISIONS = 128;
export const DEFAULT_MAX_STICKY_DECISIONS = 64;
export const HARD_MAX_STICKY_DECISIONS = 256;
export const MAX_DECISION_REASON_BYTES = 2 * 1024;
export const HARD_MAX_DECISION_REASON_BYTES = 8 * 1024;
export const MAX_ELICITATION_BYTES = 16 * 1024;
export const HARD_MAX_ELICITATION_BYTES = 64 * 1024;
export const MAX_ACTION_CONSTRAINTS = 32;
export const HARD_MAX_ACTION_CONSTRAINTS = 64;
/** Maximum delegation attribution depth for surfaced nested pending decisions. */
export const MAX_ATTRIBUTION_DEPTH = 8;
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

/** Durable-loop contract violations: hook-less custom strategy on a durable run, invalid snapshot, or revision drift. */
export class AgentLoopStateError extends Error {
  constructor(
    readonly code: "ERR_PRISM_LOOP_NOT_DURABLE" | "ERR_PRISM_LOOP_SNAPSHOT" | "ERR_PRISM_LOOP_REVISION",
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "AgentLoopStateError";
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
  /** Why a `stopped` run stopped: a ceiling, a `turn.before` stop, a `run.end` continuation cap, or `denied`. */
  readonly stopReason?: AgentFinishReason;
  /** Why the `turn.before` hook stopped the run (≤256 bytes, redacted). */
  readonly stopDetail?: string;
  /** Present when `status` is `"suspended"`: the unresolved decisions to pass to `session.resume`. Redacted. */
  readonly pending?: readonly PendingDecision[];
  /** Present for durable suspended/terminal runs. Payload is redacted and bounded. */
  readonly runState?: AgentRunState;
}

/** Mid-run steer queue: default pending message count (fail closed at this cap). */
export const DEFAULT_MAX_PENDING_STEERS = 8;
/** Absolute pending steer count ceiling if hosts later expose overrides. */
export const HARD_MAX_PENDING_STEERS = 32;
/** Mid-run steer queue: default total UTF-8 byte budget across pending messages. */
export const DEFAULT_MAX_PENDING_STEER_BYTES = 64 * 1024;
/** Absolute pending steer byte ceiling if hosts later expose overrides. */
export const HARD_MAX_PENDING_STEER_BYTES = 256 * 1024;

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
  /** Plan 137 Task 3: loaded skill names currently active in this session. */
  getLoadedSkillNames?(): readonly string[];
  /** Plan 015 / Plan 137 Task 3: re-add loaded skill names to session. */
  restoreLoadedSkills?(names: readonly string[]): void;
}
