/**
 * Consumer-gated coding lifecycle event vocabulary (Phase 10 Task 1 freeze).
 *
 * Ships only event kinds with a consumer in 0.0.27 (ACP mapper and/or host
 * `CodingLifecycleEmitter` callback). Deferred kinds — check_started/finished,
 * task_created/completed, compaction_started/finished — MUST NOT be added here
 * until a consumer exists (scripts/phase10-freeze-manifest.json lifecycle.deferredEvents).
 *
 * Types only: no runtime code, so a tool that type-imports the event it emits does not pull the
 * limits or the emitter (those live in `lifecycle.ts`, which re-exports this module).
 */
import type { AgentFinishReason, AgentRunStatus, RunLimitName } from "@arnilo/prism";
import type { CodingProcessEvent } from "./process/types.js";

export type FileChangeOp = "write" | "edit" | "delete" | "move";

export interface FileChangedEvent {
  readonly type: "file_changed";
  /** Workspace-relative or policy-checked absolute path. Never a raw file body. */
  readonly path: string;
  readonly op: FileChangeOp;
  readonly toolCallId?: string;
}

export interface WorktreeChangedEvent {
  readonly type: "worktree_changed";
  readonly action: "add" | "remove";
  readonly path: string;
  readonly toolCallId?: string;
}

export interface PermissionDeniedEvent {
  readonly type: "permission_denied";
  /** Policy decision reason. Never includes raw tool arguments. */
  readonly reason: string;
  readonly toolName: string;
  readonly toolCallId?: string;
  readonly approvalId?: string;
}

export interface ConfigurationChangedEvent {
  readonly type: "configuration_changed";
  /** Changed config keys only; values never travel in the event. */
  readonly keys: readonly string[];
}

export interface PlanChangedEvent {
  readonly type: "plan_changed";
  /** Workspace-relative plan path; doubles as the plan id on the ACP wire. */
  readonly planPath: string;
  /** Complete todo list at this point (same shape as `CodingTodoItem`). */
  readonly todos: readonly { readonly id: string; readonly text: string; readonly done: boolean }[];
}

export interface PlanRemovedEvent {
  readonly type: "plan_removed";
  /** Workspace-relative plan path; doubles as the plan id on the ACP wire. */
  readonly planPath: string;
}

/** Redacted supervisor milestone. Never includes child input, output, or path. */
export interface SubagentStartedEvent {
  readonly type: "subagent_started";
  readonly childId: string;
  readonly delegationId: string;
  readonly depth: number;
}

/**
 * Redacted child failure attribution. Carried on `subagent_stopped` only when the observer opts into
 * `includeFailure`, and only for the stop an error produced. Never carries child input, output, paths,
 * tool arguments, or tool results.
 */
export interface SubagentFailure {
  /** Supervisor-redacted terminal reason, truncated to `DEFAULT_LIFECYCLE_MAX_REASON_BYTES`. */
  readonly reason: string;
  /** Fired run-limit axis when the child died on a configured ceiling; counts only, no child text. */
  readonly limit?: RunLimitName;
  /** The child's own terminal stop reason, when the run reported one. */
  readonly stopReason?: AgentFinishReason;
}

/** Local mirror of the supervisor's per-child outcome vocabulary (no core-supervisor type import). */
export type SubagentRecoveryOutcome = "idle" | "running" | AgentRunStatus | "rejected";

/**
 * Per-child recovery counters read from `summary()` at stop. Carried on `subagent_stopped` only when
 * the observer opts into `includeRecovery` and the source exposes `summary`; integers and enums only.
 */
export interface SubagentRecovery {
  readonly attempts: number;
  readonly retries: number;
  readonly failures: number;
  readonly failureRadius: number;
  /** `idle` before the first delegation, `running` while one is live, else the terminal outcome. */
  readonly outcome: SubagentRecoveryOutcome;
}

/** Terminal redacted supervisor milestone. */
export interface SubagentStoppedEvent {
  readonly type: "subagent_stopped";
  readonly childId: string;
  readonly delegationId: string;
  readonly depth: number;
  readonly status: AgentRunStatus;
  /** Present only when the observer's `includeFailure` is on and the stop followed a `child_failed`. */
  readonly failure?: SubagentFailure;
  /** Present only when the observer's `includeRecovery` is on and the source exposes `summary`. */
  readonly recovery?: SubagentRecovery;
}

export type CodingLifecycleEvent =
  | CodingProcessEvent
  | FileChangedEvent
  | WorktreeChangedEvent
  | PermissionDeniedEvent
  | ConfigurationChangedEvent
  | PlanChangedEvent
  | PlanRemovedEvent
  | SubagentStartedEvent
  | SubagentStoppedEvent;
