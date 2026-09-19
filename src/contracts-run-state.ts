import type {
  AgentSessionCloneOptions,
  AgentSessionForkOptions,
  CheckpointRecord,
  CheckpointStore,
  CompactionOptions,
  CompactionResult,
  ContentBlock,
  ContextMeter,
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
import type { AgentEvent, AgentFinishReason, RunOptions, ToolEffectKind } from "./contracts-protocol.js";
import type { CheckpointRestoreHook } from "./checkpoint-restore.js";

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

/**
 * Opaque host sidecar pinned to one checkpoint *record* (git commit, document version,
 * workspace fingerprint) — never part of the run-state value, so it costs no `maxStateBytes`
 * budget and is invisible to state parsing. Bounded to `MAX_AGENT_RUN_METADATA_BYTES` (4 KiB)
 * and redacted like the state value at every write.
 */
export type AgentRunCheckpointMetadata = Readonly<Record<string, string>>;
/** Host source for checkpoint sidecar metadata: a fixed map or a live provider resolved per write. */
export type AgentRunCheckpointMetadataSource = AgentRunCheckpointMetadata | (() => AgentRunCheckpointMetadata | undefined);

export interface AgentRunStateOptions {
  readonly checkpoints: CheckpointStore;
  /** Host-authored immutable revision required for durable runs. */
  readonly definitionRevision: string;
  /**
   * Durable checkpoint cadence (plan 084 Task 1). `"decision"` (default) persists only on
   * suspension and terminal status. `"every-turn"` additionally persists a running-state
   * checkpoint at each provider-turn boundary — after the previous turn's tool results are in
   * the session store, before the next provider request — so a host process that dies mid-run
   * can `resumeAgentRun(..., { decision: "continue" })` from the last turn instead of re-running
   * the investigation. Costs one bounded, redacted checkpoint write per provider turn; the
   * policy is recorded in the checkpoint, so a later resume keeps checkpointing without the host
   * repeating the option.
   */
  readonly checkpointPolicy?: "decision" | "every-turn";
  /** Suspend every tool call before its side effect. */
  readonly interruptBeforeTool?: boolean;
  /**
   * Sidecar metadata written with every checkpoint of this run (and carried into a resumed
   * run). A provider is resolved at each checkpoint write, so a host closure can pin state
   * that moves mid-run (e.g. the current git commit). Absent = records stay byte-identical.
   */
  readonly checkpointMetadata?: AgentRunCheckpointMetadataSource;
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
  /**
   * Legacy decision path. `approve` allows all pending decisions once; `deny` terminates the run
   * as `denied`; `continue` resumes a running-state `"every-turn"` checkpoint that has no pending
   * decisions (crash recovery). A suspended run still requires `approve`/`deny` or a decision
   * batch — `continue` never bypasses an approval gate and is a host-API-only action.
   */
  readonly decision?: "approve" | "deny" | "continue";
  /** Batch decision path; exactly one of decision/decisions. Applied as one atomic CAS transition. */
  readonly decisions?: readonly RunDecision[];
}

/**
 * Checkpoint handed to a restore hook (plan 094 Task 3). `checkpoint.value` is the raw stored
 * run-state value; `metadata` is the redacted, bounded sidecar map hosts write via
 * `AgentRunStateOptions.checkpointMetadata`.
 */
export interface AgentCheckpointRestoreContext {
  readonly runId: string;
  readonly sessionId: string;
  /** Version of the checkpoint being claimed; a hook may pass it to an external system's own CAS. */
  readonly version: number;
  /** State being claimed: `running` for crash recovery, `suspended` for a decision resume. */
  readonly status: AgentRunStatus | "running";
  readonly metadata?: AgentRunCheckpointMetadata;
  readonly checkpoint: CheckpointRecord;
}

/** Host code restoring one external layer before a durable resume applies. */
export type AgentCheckpointRestoreHook = CheckpointRestoreHook<AgentCheckpointRestoreContext>;

export interface AgentRunResumeOptions {
  readonly checkpoints: CheckpointStore;
  /** Current host-authored revision; must exactly match the checkpoint. */
  readonly definitionRevision: string;
  readonly ownership?: OwnershipScope;
  readonly fencingToken?: number;
  /** Host abort for the resume: checked between steps and threaded into the resumed provider/tool turn. */
  readonly signal?: AbortSignal;
  /** Routes root decisions for nested-run approvals back to the child (e.g. supervisor). */
  readonly resumeNestedRun?: ResumeNestedRun;
  /**
   * Opt-in (plan 078 Task 7): receives the reconstructed session before the resumed run
   * starts, so an observer (e.g. the supervisor's child-event pump) can subscribe while the
   * run is still live. The session is valid only for the duration of this resume.
   */
  readonly onSession?: (session: AgentSession) => void;
  /** Opt-in (plan 015 Task 4): restore persisted loaded-skill names into the resumed session catalog. */
  readonly persistSessionState?: boolean;
  /** Opt-in (plan 018 Task 6): restore persisted loaded-skill bodies (requires `persistSessionState` too). */
  readonly includeSkillBodies?: boolean;
  /**
   * Checkpoint sidecar metadata for the claim write (and the resumed run's later checkpoints).
   * Absent = the record's existing metadata is preserved unchanged.
   */
  readonly checkpointMetadata?: AgentRunCheckpointMetadataSource;
  /**
   * Plan 094 Task 3: external-state restore hooks. Every hook must succeed (sequentially, each
   * within `restoreHookTimeoutMs`) before the claim write and the conversation restore apply;
   * the first failure throws `CheckpointRestoreError` naming the hook and leaves the checkpoint
   * suspended. Hosts that register hooks on the lifecycle instead pass them once there.
   */
  readonly restoreHooks?: readonly AgentCheckpointRestoreHook[];
  /** Per-hook restore ceiling in ms; defaults to `DEFAULT_CHECKPOINT_RESTORE_TIMEOUT_MS`. */
  readonly restoreHookTimeoutMs?: number;
}

/** Bounded live-event options for `resumeAgentRunStream()`; `signal` is inherited from the base resume options. */
export interface AgentRunResumeStreamOptions extends AgentRunResumeOptions, SubscribeOptions {}

export interface AgentRunRef {
  readonly runId: string;
  readonly sessionId?: string;
}

export interface AgentRunStatusResult {
  readonly state: AgentRunState;
  readonly version: number;
  /** Checkpoint sidecar metadata; absent when the record carries none (or carries only malformed entries). */
  readonly metadata?: AgentRunCheckpointMetadata;
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
  /** Present when the loop stopped on a ceiling or host turn policy instead of a natural end. */
  readonly stopReason?: AgentFinishReason;
  /** Host stop detail from `TurnPolicyOptions.stop` (≤256 bytes, redacted). */
  readonly stopDetail?: string;
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
  /**
   * Context-fill read (plan 091 T2): latest provider turn's input tokens
   * (reported or labeled estimate) plus the resolved per-request cap, run input
   * budget, and used ratio. Before any provider turn it estimates stored history.
   */
  contextMeter(): ContextMeter;
  fork(options?: AgentSessionForkOptions): AgentSession;
  clone(options?: AgentSessionCloneOptions): Promise<AgentSession>;
}
