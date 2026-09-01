import type {
  AgentSessionCloneOptions,
  AgentSessionForkOptions,
  CheckpointStore,
  CompactionOptions,
  CompactionResult,
  ContentBlock,
  ErrorInfo,
  JsonObject,
  JsonValue,
  Message,
  ModelConfig,
  OwnershipScope,
  RunLimitBreach,
  SessionEntry,
  SubscribeOptions,
  ToolCallContent,
  Usage,
} from "./contracts-core.js";
import type { AgentEvent, RunOptions, ToolEffectKind } from "./contracts-protocol.js";

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
  /** Delegation chain, root-first; core-written, never client-supplied. */
  readonly attribution?: { readonly path: readonly string[] };
}

/** Redacted safe-boundary descriptor; never contains tool arguments. */
export interface AgentRunInterruption {
  readonly kind: AgentRunInterruptionKind;
  readonly reason: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  /** All unresolved approval requests of this suspension; absent for legacy single approvals. */
  readonly pendingDecisions?: readonly PendingDecision[];
}

/** One host decision applied to one pending approval request. */
export interface RunDecision {
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
  readonly decisions?: Readonly<Record<string, RunDecision>>;
}

/** Outcome of resuming a nested run through the host-supplied hook. */
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
  decisions: readonly RunDecision[],
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

export interface AgentRunStateOptions {
  readonly checkpoints: CheckpointStore;
  /** Host-authored immutable revision required for durable runs. */
  readonly definitionRevision: string;
  /** Suspend every tool call before its side effect. */
  readonly interruptBeforeTool?: boolean;
  readonly maxStateBytes?: number;
  readonly fencingToken?: number;
  /** Enables sticky auto-apply when a nested suspension first surfaces during this run. */
  readonly resumeNestedRun?: ResumeNestedRun;
  /**
   * Opt-in (plan 015 Task 4): persist the session's loaded-skill names in the run-state
   * checkpoint and restore them on resume. Names only — bodies reload via `load_skill`.
   * Default off: checkpoint shape is identical to 0.1.2.
   */
  readonly persistSessionState?: boolean;
  /**
   * Opt-in (plan 018 Task 6 closeout `checkpoint-bodies`): alongside
   * `persistSessionState`, persist the exact loaded-skill instructions
   * (`{name, instructions}` pairs, redacted at the checkpoint boundary like all state)
   * so resume re-renders them registry-independently — no `load_skill` round-trip, no
   * drift when the live registry changed or lost the skill. Both the run and the resume
   * options must set it. Bounds: ≤64 bodies, ≤256-char names, ≤262144-byte bodies,
   * ≤1 MiB total; the `maxStateBytes` ceiling refuses oversize with a recorded error
   * (never silently truncates). Default off: checkpoint shape is identical to 0.1.3.
   */
  readonly includeSkillBodies?: boolean;
}

/** Versioned, redacted checkpoint payload. Treat as opaque except status/version/interruption. */
export interface AgentRunState {
  readonly schemaVersion: 1;
  readonly agentId: string;
  readonly definitionRevision: string;
  readonly fingerprint: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly leafId?: string;
  readonly model: ModelConfig;
  readonly status: AgentRunStatus | "running";
  readonly interruption?: AgentRunInterruption;
  readonly version?: number;
}

export interface AgentRunResume {
  readonly expectedVersion: number;
  /** Legacy single-approval path; `approve` allows all pending once, `deny` terminates the run denied. */
  readonly decision?: "approve" | "deny";
  /** Batch decision path; exactly one of decision/decisions. Applied as one atomic CAS transition. */
  readonly decisions?: readonly RunDecision[];
}

export interface AgentRunResumeOptions {
  readonly checkpoints: CheckpointStore;
  /** Current host-authored revision; must exactly match the checkpoint. */
  readonly definitionRevision: string;
  readonly ownership?: OwnershipScope;
  readonly fencingToken?: number;
  /** Routes root decisions for nested-run approvals back to the child (e.g. supervisor). */
  readonly resumeNestedRun?: ResumeNestedRun;
  /** Opt-in (plan 015 Task 4): restore persisted loaded-skill names into the resumed session catalog. */
  readonly persistSessionState?: boolean;
  /** Opt-in (plan 018 Task 6): restore persisted loaded-skill bodies (requires `persistSessionState` too). */
  readonly includeSkillBodies?: boolean;
}

/** Bounded, abortable options for `resumeAgentRunStream()`. */
export interface AgentRunResumeStreamOptions extends AgentRunResumeOptions, SubscribeOptions {
  readonly signal?: AbortSignal;
}

export interface AgentRunRef {
  readonly runId: string;
  readonly sessionId?: string;
}

export interface AgentRunStatusResult {
  readonly state: AgentRunState;
  readonly version: number;
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

/** Terminal result of `session.run()` / `session.prompt()`. Failed and aborted runs throw {@link AgentRunError} with this shape attached. */
export interface AgentRunResult {
  readonly sessionId: string;
  readonly runId: string;
  readonly status: AgentRunStatus;
  /** Branch leaf after the run settles. */
  readonly leafId?: string;
  /** Concatenated text blocks from the final assistant message, or `""` when none. */
  readonly text: string;
  /** Content blocks from the final assistant message, or `[]` when none. */
  readonly content: readonly ContentBlock[];
  /** Final assistant message when the run produced one. */
  readonly message?: Message;
  /** Aggregate usage across provider turns (`run_total` scope). */
  readonly usage?: Usage;
  /** Present when the run hit a configured resource ceiling. */
  readonly limit?: RunLimitBreach;
  /** Present when `status` is `"failed"` or when a failed attempt still produced partial output. */
  readonly error?: ErrorInfo;
  /** String form of the abort reason when `status` is `"aborted"`. */
  readonly abortReason?: string;
  /** Present for durable suspended/terminal runs. Payload is redacted and bounded. */
  readonly runState?: AgentRunState;
  /** Present only while awaiting an operator decision. */
  readonly interruption?: AgentRunInterruption;
}

export class AgentRunError extends Error {
  readonly result: AgentRunResult;

  constructor(result: AgentRunResult, options?: { readonly cause?: unknown }) {
    super(result.error?.message ?? (result.status === "aborted" ? "Agent run aborted" : "Agent run failed"), options);
    this.name = "AgentRunError";
    this.result = result;
  }
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

export interface AgentSession {
  readonly id: string;
  /** Current branch leaf entry id; advances on every append/run and is re-pointed by `checkout`.
   *  Undefined until the first entry lands (a fresh session with no history). */
  readonly leafId: string | undefined;
  run(input: string | Message | readonly Message[], options?: RunOptions): Promise<AgentRunResult>;
  prompt(input: string, options?: RunOptions): Promise<AgentRunResult>;
  /**
   * Enqueue user text into an active run. Default injects before the next provider turn.
   * `softInterrupt: true` aborts the current provider stream, then continues the same run.
   * Fails closed when no run is active or the pending queue exceeds caps.
   */
  steer(input: string | Message | readonly Message[], options?: SteerOptions): void;
  /** Subscribe first, then start exactly one run and yield only that run's events until it terminates. */
  stream(input: string | Message | readonly Message[], options?: RunOptions & SubscribeOptions): AsyncIterable<AgentEvent>;
  compact(options?: CompactionOptions): Promise<CompactionResult>;
  subscribe(options?: SubscribeOptions): AsyncIterable<AgentEvent>;
  abort(reason?: unknown): void;
  entries(): Promise<readonly SessionEntry[]>;
  checkout(leafId?: string): Promise<void>;
  fork(options?: AgentSessionForkOptions): AgentSession;
  clone(options?: AgentSessionCloneOptions): Promise<AgentSession>;
}
