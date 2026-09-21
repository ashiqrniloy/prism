import type {
  Agent,
  AgentEvent,
  AgentIdentity,
  AgentRunResult,
  BudgetAxisUsage,
  BudgetConsumedCounters,
  CheckpointStore,
  OwnershipScope,
  PermissionPolicy,
  ResumeNestedRun,
  RunLimitBreach,
  SecretRedactor,
  ToolCallSummary,
  ToolEffectStore,
  Usage,
} from "@arnilo/prism";
import type { ResolvedSupervisorLimits, SupervisorLimits } from "./limits.js";

/** `task` (default) is bounded to the caller turn; `session` detaches from the caller signal. */
export type ChildLifetime = "task" | "session";

/** How much of a child's activity reaches the supervisor stream. */
export type ChildReportPolicy = "on-complete" | "milestones" | "stream";

/** When a `report: "milestones"` child reports: every N turns, a host predicate, or both. */
export interface SupervisorMilestonePolicy {
  /** Emit one `child_milestone` every N child turns. */
  readonly everyTurns?: number;
  /** Host-defined predicate over child events. Host policy only; never model-facing. */
  readonly predicate?: (event: AgentEvent) => boolean;
}

/** Host-authored ceilings/defaults for one child. Requests may only narrow them. */
export interface SupervisorChildPolicy {
  /** Capability flag: requests may choose `session` only when this is `session`. Default `task`. */
  readonly lifetime?: ChildLifetime;
  /** Default and maximum report verbosity; a request may only lower it. Default `on-complete`. */
  readonly report?: ChildReportPolicy;
  /** Default and maximum milestone chattiness (a request may only raise `everyTurns`). */
  readonly milestone?: SupervisorMilestonePolicy;
  /** Default and ceiling fraction (0, 1] of this child's inherited run limits. */
  readonly budgetShare?: number;
}

export interface DelegationRequest {
  readonly childId: string;
  readonly input: string;
  readonly threadId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly limits?: SupervisorLimits;
  /** `session` detaches from the caller signal and survives caller turns; requires host child policy. */
  readonly lifetime?: ChildLifetime;
  /** Clamped to the child's host policy ceiling; default `on-complete`. */
  readonly report?: ChildReportPolicy;
  readonly milestone?: SupervisorMilestonePolicy;
  /** Fraction (0, 1] of inherited run limits; clamped to the child's host policy share. */
  readonly budgetShare?: number;
  readonly signal?: AbortSignal;
}

export interface DelegationHandle {
  readonly delegationId: string;
  readonly status: "running";
}

/** A completed child result, or the terminal result of host cancellation. */
export type DelegationWaitResult = AgentRunResult | { readonly delegationId: string; readonly status: "cancelled" };

export interface DelegationWaitOptions {
  /** Stops this wait only; it does not cancel the delegated child. */
  readonly signal?: AbortSignal;
}

export interface DelegationChildContext {
  readonly childId: string;
  readonly delegationId: string;
  readonly depth: number;
  readonly path: readonly string[];
  readonly ownership: OwnershipScope;
  /** Parent-verified identity; child factories cannot widen it. */
  readonly identity?: AgentIdentity;
  /** One shared durable effect store for every child run. */
  readonly effectStore?: ToolEffectStore;
  readonly resourceId: string;
  readonly threadId: string;
  readonly permission: PermissionPolicy;
  readonly signal: AbortSignal;
  delegate(request: DelegationRequest): Promise<AgentRunResult>;
}

export interface SupervisorChild {
  readonly description?: string;
  /** Optional host-authored child scope subset. Omitted preserves the parent identity. */
  readonly scopes?: readonly string[];
  readonly permission?: PermissionPolicy;
  readonly limits?: SupervisorLimits;
  /** Lifetime/report/budget-share ceilings and defaults; requests may only narrow them. */
  readonly policy?: SupervisorChildPolicy;
  createAgent(context: DelegationChildContext): Agent | Promise<Agent>;
}

export interface DelegationHookDecision {
  readonly allowed?: boolean;
  readonly reason?: string;
  readonly input?: string;
  readonly limits?: SupervisorLimits;
  readonly permission?: PermissionPolicy;
}

export interface DelegationHookInput {
  readonly childId: string;
  readonly delegationId: string;
  readonly depth: number;
  readonly path: readonly string[];
  readonly input: string;
  readonly limits: ResolvedSupervisorLimits;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
}

export interface DelegationCompletion {
  readonly childId: string;
  readonly delegationId: string;
  readonly depth: number;
  readonly status: AgentRunResult["status"] | "rejected";
  readonly text: string;
  readonly usage?: AgentRunResult["usage"];
  readonly error?: string;
}

export interface SupervisorHooks {
  before?(input: DelegationHookInput): DelegationHookDecision | Promise<DelegationHookDecision>;
  after?(completion: DelegationCompletion): void | Promise<void>;
}

export type SupervisorEvent =
  | {
      readonly type: "delegation_started";
      readonly childId: string;
      readonly delegationId: string;
      readonly depth: number;
      readonly resourceId: string;
      readonly threadId: string;
    }
  | {
      readonly type: "delegation_finished";
      readonly childId: string;
      readonly delegationId: string;
      readonly depth: number;
      readonly status: AgentRunResult["status"];
      readonly totalTokens: number;
    }
  | {
      readonly type: "delegation_rejected";
      readonly childId: string;
      readonly delegationId: string;
      readonly depth: number;
      readonly reason: string;
    }
  | {
      readonly type: "delegation_error";
      readonly childId: string;
      readonly delegationId: string;
      readonly depth: number;
      readonly error: string;
    }
  | {
      readonly type: "delegation_child_event";
      readonly childId: string;
      readonly delegationId: string;
      readonly depth: number;
      readonly childEvent: AgentEvent;
    }
  | {
      readonly type: "delegation_child_events_capped";
      readonly childId: string;
      readonly delegationId: string;
      readonly depth: number;
      readonly maxChildEvents: number;
    }
  | {
      /** One `report: "milestones"` cadence report; `turn` is the child turn at emission. */
      readonly type: "child_milestone";
      readonly childId: string;
      readonly delegationId: string;
      readonly depth: number;
      readonly turn: number;
      readonly childEvent: AgentEvent;
    }
  | {
      /** Rate coalescing dropped child events in the last window; never silently. */
      readonly type: "delegation_child_events_coalesced";
      readonly childId: string;
      readonly delegationId: string;
      readonly depth: number;
      readonly dropped: number;
      readonly maxChildEventsPerSecond: number;
    }
  | {
      /**
       * Structured child failure attribution. `limit` follows the plan 086/087 `RunLimitBreach`
       * taxonomy when a run ceiling fired; `status`/`stopReason` carry the child's own terminal
       * vocabulary otherwise (denials and host cancels are not failures and never emit this).
       */
      readonly type: "child_failed";
      readonly childId: string;
      readonly delegationId: string;
      readonly depth: number;
      readonly reason: string;
      readonly status?: AgentRunResult["status"];
      readonly limit?: RunLimitBreach;
      readonly stopReason?: AgentRunResult["stopReason"];
      readonly usage?: Usage;
      /** Plan-087 attribution carried by the child's own `AgentRunResult.attribution` on a ceiling death. */
      readonly consumed?: BudgetConsumedCounters;
      readonly closestOtherAxes?: readonly BudgetAxisUsage[];
      readonly recentToolCalls?: readonly ToolCallSummary[];
    };

/**
 * Counted outcome per child: `idle` before the first delegation, `running` while one is live,
 * otherwise the terminal run status (`succeeded`/`failed`/`aborted`/`suspended`/`denied`) or
 * `rejected` for a host-hook denial. Same vocabulary as `delegation_finished.status`.
 */
export type SupervisorChildOutcome = "idle" | "running" | AgentRunResult["status"] | "rejected";

/** One row of `Supervisor.summary()`; counters are incremental and survive terminal retention. */
export interface SupervisorChildSummary {
  readonly childId: string;
  /** Delegations started (hook rejections included); resumption of a suspended run is not a new attempt. */
  readonly attempts: number;
  /** Attempts started after a previous `failed`/`aborted` terminal outcome (recovery re-dispatches). */
  readonly retries: number;
  /** Attempts that died on an error or a limit; host cancels, denials, and hook rejections are excluded. */
  readonly failures: number;
  /** Task-lifetime descendant delegations live at this child's most recent failure (blast radius). */
  readonly failureRadius: number;
  readonly outcome: SupervisorChildOutcome;
}

/** Recovery/telemetry snapshot: one row per allow-listed child, O(children). */
export interface SupervisorRunSummary {
  readonly children: readonly SupervisorChildSummary[];
}

export interface CreateSupervisorOptions {
  readonly id?: string;
  readonly ownership: OwnershipScope;
  /** Optional parent-verified identity, propagated unchanged to every child. */
  readonly identity?: AgentIdentity;
  /** Optional parent effect store, propagated unchanged to every child. */
  readonly effectStore?: ToolEffectStore;
  readonly children: Readonly<Record<string, SupervisorChild>>;
  readonly permission?: PermissionPolicy;
  readonly limits?: SupervisorLimits;
  readonly hooks?: SupervisorHooks;
  readonly redactor?: SecretRedactor;
  /**
   * Session lifetime: aborting ends every running child (session and task) and closes the
   * event stream. Abort it on host session end for a clean shutdown.
   */
  readonly signal?: AbortSignal;
  /**
   * Opt-in host sink for projected child events: called with the same redacted, capped,
   * rate-coalesced event published on the supervisor stream, tagged with its `child` origin, so
   * a host can route it onto the parent session's stream. Throwing is advisory. Default off.
   */
  readonly childEventSink?: (event: AgentEvent) => void;
  /**
   * Opt-in supervisor-wide default report ceiling: projects a redacted, capped milestone subset
   * of child `AgentEvent`s (`agent_started`/`finished`/`suspended`/`denied` and tool-execution
   * events) onto the supervisor stream as `delegation_child_event`. Default off — the stream is
   * unchanged when unset/false. Per-child `policy.report` overrides it (lower or equal). Full
   * per-token streaming is out of scope.
   */
  readonly childEvents?: boolean;
  /**
   * Durable child runs: with `checkpoints` + `definitionRevision`, every child runs with
   * `interruptBeforeTool`; a child that suspends on pending decisions throws
   * `AgentDelegationSuspendedError` so the hosting root run can surface them.
   */
  readonly checkpoints?: CheckpointStore;
  /** Host-authored revision shared by child durable runs; bump on policy/definition change. */
  readonly definitionRevision?: string;
}

export interface Supervisor {
  /** Host-authored child IDs advertised by `createSpawnAgentTool`; factories remain private. */
  readonly childIds: readonly string[];
  /** Applies the supervisor's configured redactor to model-visible spawn results. */
  redact(value: string): string;
  delegate(request: DelegationRequest): Promise<AgentRunResult>;
  /** Starts a child without awaiting it. Set `lifetime: "session"` to detach it from the caller signal. */
  delegateAsync(request: DelegationRequest): Promise<DelegationHandle>;
  /** Joins one local async child. Wait is capped at this supervisor's timeout. */
  wait(delegationId: string, options?: DelegationWaitOptions): Promise<DelegationWaitResult>;
  /** Aborts one running local async child, session-lifetime included; false means its known handle is already terminal. */
  cancel(delegationId: string): boolean;
  /**
   * Routes root-run decisions back to the suspended child. Pass as `resumeNestedRun` in the
   * root run's `runState` (sticky auto-apply) and every `resumeAgentRun` options object.
   * Throws when `checkpoints`/`definitionRevision` are not configured.
   */
  readonly resumeNestedRun: ResumeNestedRun;
  subscribe(): AsyncIterable<SupervisorEvent>;
  /**
   * Per-child attempts/retries/failures/failure-radius counters; one row per allow-listed child.
   * Cumulative for the supervisor's lifetime; `reset: true` starts a new counting window instead
   * (every counter zeroed, `outcome` restated as `running` when the child has a live delegation,
   * else `idle`).
   */
  summary(options?: { readonly reset?: boolean }): SupervisorRunSummary;
  readonly activeChildren: number;
}
