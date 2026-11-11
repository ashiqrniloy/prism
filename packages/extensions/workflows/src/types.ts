import type {
  Agent,
  AgentEvent,
  JsonObject,
  OwnershipScope,
  Principal,
  RunLedger,
  RunLimits,
  RunOptions,
  RunResult,
  SecretRedactor,
  Session,
  SubscribeOptions,
} from "@arnilo/prism";
import type { WORKFLOW_LOOP_ITERATION_SCHEMA_VERSION } from "./limits.js";

export type WorkflowRunStatus = "queued" | "running" | "suspended" | "succeeded" | "failed" | "denied" | "aborted";

export type WorkflowNodeStatus = "pending" | "ready" | "running" | "suspended" | "succeeded" | "failed" | "denied" | "skipped" | "aborted";

export interface WorkflowSuspensionDescriptor {
  readonly nodeId: string;
  readonly reason: string;
  readonly data?: unknown;
  readonly resumeSchema?: JsonObject;
  readonly requestedAt: string;
}

export interface WorkflowSuspension<ResumeInput = unknown> {
  readonly type: "workflow_suspend";
  readonly reason: string;
  readonly data?: unknown;
  readonly resumeSchema?: JsonObject;
  /** Compile-time marker for the expected resume input type. */
  readonly __resumeInput?: ResumeInput;
}

export interface WorkflowResumeRequest {
  readonly decision: "approve" | "deny";
  readonly input?: unknown;
  /** Version shown to the reviewer; required to claim a suspended checkpoint exactly once. */
  readonly expectedVersion: number;
}

export interface WorkflowResumeRecord extends WorkflowResumeRequest {
  readonly nodeId: string;
  readonly resumedAt: string;
}

export interface WorkflowResumeContext {
  readonly input?: unknown;
  readonly resumedAt: string;
}

export interface WorkflowResumeValidationInput {
  readonly value: unknown;
  readonly schema?: JsonObject;
  readonly suspension: WorkflowSuspensionDescriptor;
}

export type WorkflowResumeValidator = (input: WorkflowResumeValidationInput) => void | Promise<void>;

export type WorkflowNodeKind =
  | "agent"
  | "function"
  | "conditional"
  | "fan_out"
  | "join"
  | "workflow"
  | "loop"
  | "route"
  | "gate"
  | "human_gate";

export interface WorkflowStateUpdateOptions {
  readonly mode?: "merge" | "replace";
}

export interface WorkflowStateValidationInput {
  readonly value: JsonObject;
  readonly schema?: JsonObject;
  readonly signal?: AbortSignal;
}

export type WorkflowStateValidator = (input: WorkflowStateValidationInput) => void | Promise<void>;

export interface WorkflowStateConfig {
  readonly initial?: JsonObject;
  readonly schema?: JsonObject;
}

export interface WorkflowNodeContext {
  readonly workflowId: string;
  readonly runId: string;
  readonly nodeId: string;
  readonly workflowInput: unknown;
  readonly upstream: Readonly<Record<string, unknown>>;
  readonly state: Readonly<JsonObject>;
  readonly stateVersion: number;
  updateState(patch: JsonObject, options?: WorkflowStateUpdateOptions): Promise<Readonly<JsonObject>>;
  readonly signal?: AbortSignal;
  readonly ownership?: OwnershipScope;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Present only while re-entering the node selected by an approved durable resume. */
  readonly resume?: WorkflowResumeContext;
}

export interface WorkflowLoopNodeContext extends WorkflowNodeContext {
  /** Zero-based iteration index. */
  readonly iteration: number;
  /** Stable compensation key; includes tenantId when ownership is supplied. */
  readonly iterationId: string;
  /** Previous body output; for `until`, this is the current body output. */
  readonly previousOutput?: unknown;
}

export interface WorkflowNodeBase {
  readonly kind: WorkflowNodeKind;
  readonly retries?: number;
  readonly timeoutMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly activation?: "all" | "any";
  readonly scope?: string;
  /**
   * What `resumeWorkflow` does with this node when the process died while it ran. `"rerun"` (default
   * for every kind but `agent`) runs it again; `"resume-session"` (default for `agent`, valid only
   * there) reopens the same child session; `"fail"` fails the run with code `not_idempotent`.
   */
  readonly idempotent?: NodeIdempotency;
}

export type NodeIdempotency = "rerun" | "resume-session" | "fail";

/** Worktree policy of an `agentNode`: `true` is `{ dispose: "keep" }`. */
export type AgentNodeWorktree = boolean | { readonly dispose?: "keep" | "dispose" };

/** Where an `agentNode` worktree is recorded for the merge gate. */
export interface AgentNodeWorktreeOutput {
  readonly path: string;
  readonly branch: string;
}

export interface AgentNodeDefinition extends WorkflowNodeBase {
  readonly kind: "agent";
  /** Any `Agent`, including a driver agent. The node uses only its public session API. */
  readonly agent: Agent;
  /** Supplies the child session; default is a new one linked to the workflow run. */
  readonly session?: (ctx: WorkflowNodeContext) => Session | Promise<Session>;
  readonly input?: (ctx: WorkflowNodeContext) => unknown | Promise<unknown>;
  readonly runOptions?: Omit<RunOptions, "signal" | "metadata">;
  /** Run in a disposable git worktree from the `workspace` service; fails closed without that service. */
  readonly worktree?: AgentNodeWorktree;
  /** Maps the child's `RunResult` to the node output; default is the final assistant text. */
  readonly output?: (result: RunResult, ctx: WorkflowNodeContext) => unknown | Promise<unknown>;
}

export interface FunctionNodeDefinition extends WorkflowNodeBase {
  readonly kind: "function";
  readonly execute: (ctx: WorkflowNodeContext) => unknown | Promise<unknown>;
}

export interface WorkflowLoopBodyDefinition extends Omit<FunctionNodeDefinition, "execute"> {
  readonly execute: (ctx: WorkflowLoopNodeContext) => unknown | Promise<unknown>;
}

export interface InlineLoopNodeDefinition extends WorkflowNodeBase {
  readonly kind: "loop";
  readonly execute: (ctx: WorkflowLoopNodeContext) => unknown | Promise<unknown>;
  readonly body?: never;
  readonly until: (ctx: WorkflowLoopNodeContext) => boolean | Promise<boolean>;
  readonly maxIterations: number;
}

export interface NodeLoopNodeDefinition extends WorkflowNodeBase {
  readonly kind: "loop";
  readonly execute?: never;
  /** Interior function/tool sub-step; graph edges still see one loop node. */
  readonly body: WorkflowLoopBodyDefinition;
  readonly until: (ctx: WorkflowLoopNodeContext) => boolean | Promise<boolean>;
  readonly maxIterations: number;
}

export type LoopNodeDefinition = InlineLoopNodeDefinition | NodeLoopNodeDefinition;
export type LoopNodeConfig = Omit<InlineLoopNodeDefinition, "kind"> | Omit<NodeLoopNodeDefinition, "kind">;

export interface ConditionalNodeDefinition extends WorkflowNodeBase {
  readonly kind: "conditional";
  readonly when: (ctx: WorkflowNodeContext) => boolean | Promise<boolean>;
  /** When true, only these successors remain eligible (others skipped). */
  readonly then?: readonly string[];
  /** When false, only these successors remain eligible (others skipped). */
  readonly else?: readonly string[];
}

/** A node a `fanOut` item may route to: one that runs to a value without graph edges. */
export type FanOutItemNode = AgentNodeDefinition | FunctionNodeDefinition | NestedWorkflowNodeDefinition;

export interface FanOutNodeDefinition extends WorkflowNodeBase {
  readonly kind: "fan_out";
  readonly items: (ctx: WorkflowNodeContext) => readonly unknown[] | Promise<readonly unknown[]>;
  /** Picks the node that runs one item. Called once per item, in item order, before it starts. */
  readonly route: (item: unknown, index: number, ctx: WorkflowNodeContext) => FanOutItemNode;
  /** Most items running at once; also capped by the workflow's `maxConcurrency`. */
  readonly maxConcurrency?: number;
  readonly maxFanOut?: number;
  /** Longest wait before an item that met a busy profile is tried again, ms. Default 2000. */
  readonly maxProfileBackoffMs?: number;
}

export interface JoinNodeDefinition extends WorkflowNodeBase {
  readonly kind: "join";
  /** Upstream fan-out (or array-producing) node id; defaults to sole predecessor. */
  readonly from?: string;
  readonly reduce?: (items: readonly unknown[], ctx: WorkflowNodeContext) => unknown | Promise<unknown>;
}

export interface NestedWorkflowNodeDefinition extends WorkflowNodeBase {
  readonly kind: "workflow";
  readonly workflow: WorkflowDefinition;
  readonly input?: (ctx: WorkflowNodeContext) => unknown | Promise<unknown>;
  readonly output?: (result: WorkflowRunResult, ctx: WorkflowNodeContext) => unknown | Promise<unknown>;
}

export interface RouteNodeDefinition extends WorkflowNodeBase {
  readonly kind: "route";
  readonly select: (
    ctx: WorkflowNodeContext,
  ) => readonly string[] | WorkflowSuspension<unknown> | Promise<readonly string[] | WorkflowSuspension<unknown>>;
}

export type RouteNodeConfig = Omit<RouteNodeDefinition, "kind">;

/** Result of a deterministic gate check. A failure routes to `route`, or by default to the gate's predecessor. */
export type GateCheckResult =
  | { readonly pass: true; readonly output?: unknown }
  | { readonly pass: false; readonly reason: string; readonly route?: string };

export interface GateNodeDefinition extends WorkflowNodeBase {
  readonly kind: "gate";
  /** Deterministic. The context has no model client; a throw is a failed gate (`check_threw`). */
  readonly check: (ctx: WorkflowNodeContext) => GateCheckResult | Promise<GateCheckResult>;
  /** Failure routing target when `check` does not name one. Must be a declared successor. */
  readonly onFail?: string;
  /** Bound on executions of this gate; default and hard cap `HARD_MAX_LOOP_ITERATIONS`. */
  readonly maxIterations?: number;
}

/** Every `HostUi` request kind a human gate may send: not `terminal`, and never `secret`. */
export type HumanGateRequest = Exclude<import("@arnilo/prism").HostUiRequest, { kind: "terminal" | "secret" }>;

export interface HumanGateNodeDefinition extends WorkflowNodeBase {
  readonly kind: "human_gate";
  /** Sent through `host.ui` as the workflows package; `package` and `sessionId` are kernel-set. */
  readonly request: HumanGateRequest extends infer R ? (R extends unknown ? Omit<R, "package" | "sessionId"> : never) : never;
  /** Failure routing target for a dismissed or declined request; default is the predecessor. */
  readonly onFail?: string;
  readonly maxIterations?: number;
}

/** What a gate node stores as its output. */
export type GateNodeOutput =
  | { readonly pass: true; readonly output?: unknown }
  | { readonly pass: false; readonly reason: string; readonly route: readonly string[] };

export type WorkflowNodeDefinition =
  | GateNodeDefinition
  | HumanGateNodeDefinition
  | AgentNodeDefinition
  | FunctionNodeDefinition
  | LoopNodeDefinition
  | ConditionalNodeDefinition
  | FanOutNodeDefinition
  | JoinNodeDefinition
  | NestedWorkflowNodeDefinition
  | RouteNodeDefinition;

export interface WorkflowLimits {
  readonly maxNodes?: number;
  readonly maxFanOut?: number;
  readonly maxConcurrency?: number;
  readonly maxSupersteps?: number;
  readonly maxNodeOutputBytes?: number;
  readonly maxCheckpointBytes?: number;
  readonly maxNestedDepth?: number;
  readonly maxStateBytes?: number;
  readonly maxStateHistory?: number;
  readonly maxReplayDepth?: number;
}

export interface WorkflowDefinition {
  readonly id: string;
  readonly revision: string;
  readonly nodes: Readonly<Record<string, WorkflowNodeDefinition>>;
  readonly edges: readonly (readonly [string, string])[];
  readonly limits?: WorkflowLimits;
  readonly state?: WorkflowStateConfig;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly execution?: "supersteps";
}

export interface WorkflowLoopIterationRecord {
  readonly schemaVersion: typeof WORKFLOW_LOOP_ITERATION_SCHEMA_VERSION;
  readonly iteration: number;
  /** Stable host/saga compensation key; tenant-prefixed when ownership is supplied. */
  readonly iterationId: string;
  /** True when this record satisfied `until` and terminalized the loop. */
  readonly done: boolean;
  readonly output?: unknown;
  /** State version captured before this iteration executed. */
  readonly stateVersionBefore?: number;
}

export interface WorkflowNodeCheckpoint {
  readonly nodeId: string;
  readonly status: WorkflowNodeStatus;
  readonly output?: unknown;
  readonly error?: { readonly message: string; readonly code?: string | number };
  readonly attempt?: number;
  readonly sessionId?: string;
  readonly leafId?: string;
  readonly runId?: string;
  readonly stateVersionBefore?: number;
  /** The worktree an in-flight `agentNode` runs in, so a resume rebinds it or fails with `worktree_lost`. */
  readonly worktree?: { readonly path: string; readonly branch: string };
  /** Number of completed loop body iterations (zero-based context starts at this value). */
  readonly iteration?: number;
  /** Bounded last body output retained while a loop is running or failed. */
  readonly lastOutput?: unknown;
  /** Additive durable ledger of completed loop body iterations. */
  readonly iterations?: readonly WorkflowLoopIterationRecord[];
}

export interface WorkflowReplayLineage {
  readonly sourceRunId: string;
  readonly fromNodeId: string;
  readonly rootRunId: string;
  readonly depth: number;
  readonly createdAt: string;
}

export interface WorkflowExecutionPendingActivation {
  readonly from: readonly string[];
  readonly round: number;
}

export interface WorkflowExecutionCheckpoint {
  readonly mode: "supersteps";
  readonly superstep: number;
  readonly maxSupersteps?: number;
  readonly pending: Readonly<Record<string, WorkflowExecutionPendingActivation>>;
}

export interface WorkflowCheckpointValue {
  readonly schemaVersion: number;
  readonly workflowId: string;
  readonly runId: string;
  readonly definitionHash: string;
  readonly status: WorkflowRunStatus;
  readonly readyNodeIds: readonly string[];
  readonly completedNodeIds: readonly string[];
  readonly nodes: Readonly<Record<string, WorkflowNodeCheckpoint>>;
  readonly workflowInput?: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly redacted: boolean;
  readonly suspension?: WorkflowSuspensionDescriptor;
  readonly resume?: WorkflowResumeRecord;
  readonly state?: JsonObject;
  readonly stateVersion?: number;
  readonly stateHistory?: Readonly<Record<string, JsonObject>>;
  readonly lineage?: WorkflowReplayLineage;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly execution?: WorkflowExecutionCheckpoint;
}

export interface WorkflowCheckpointSaveInput {
  readonly workflowId: string;
  readonly runId: string;
  readonly version: number;
  readonly expectedVersion?: number;
  readonly fencingToken?: number;
  readonly ownership?: OwnershipScope;
  readonly value: WorkflowCheckpointValue;
  readonly signal?: AbortSignal;
}

export interface WorkflowCheckpointRecord {
  readonly workflowId: string;
  readonly runId: string;
  readonly version: number;
  readonly fencingToken?: number;
  readonly ownership?: OwnershipScope;
  readonly value: WorkflowCheckpointValue;
  readonly updatedAt: string;
}

export interface WorkflowCheckpointLoadInput {
  readonly workflowId: string;
  readonly runId: string;
  readonly ownership?: OwnershipScope;
  readonly signal?: AbortSignal;
}

export interface WorkflowCheckpointListInput {
  readonly workflowId?: string;
  readonly ownership?: OwnershipScope;
  readonly status?: WorkflowRunStatus | readonly WorkflowRunStatus[];
  readonly cursor?: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface WorkflowCheckpointListPage {
  readonly items: readonly WorkflowCheckpointRecord[];
  readonly nextCursor?: string;
}

export interface WorkflowCheckpointAdapter {
  save(input: WorkflowCheckpointSaveInput): Promise<void>;
  load(input: WorkflowCheckpointLoadInput): Promise<WorkflowCheckpointRecord | null>;
  list?(input: WorkflowCheckpointListInput): Promise<WorkflowCheckpointListPage>;
  delete?(input: WorkflowCheckpointLoadInput): Promise<boolean>;
  requestCancel?(input: WorkflowCheckpointLoadInput): Promise<void>;
  isCancelRequested?(input: WorkflowCheckpointLoadInput): Promise<boolean>;
  clearCancelRequest?(input: WorkflowCheckpointLoadInput): Promise<void>;
}

export interface WorkflowCheckpointAdapterOptions {
  readonly maxCheckpointBytes?: number;
  readonly maxNodeOutputBytes?: number;
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
}

export type WorkflowEvent =
  | {
      readonly type: "workflow_started";
      readonly workflowId: string;
      readonly runId: string;
      readonly timestamp: string;
      readonly sequence: number;
    }
  | {
      readonly type: "workflow_finished";
      readonly workflowId: string;
      readonly runId: string;
      readonly status: WorkflowRunStatus;
      readonly timestamp: string;
      readonly sequence: number;
    }
  | {
      readonly type: "workflow_suspended";
      readonly workflowId: string;
      readonly runId: string;
      readonly suspension: WorkflowSuspensionDescriptor;
      readonly timestamp: string;
      readonly sequence: number;
    }
  | {
      readonly type: "workflow_resumed";
      readonly workflowId: string;
      readonly runId: string;
      readonly resume: WorkflowResumeRecord;
      /** Plan 094 Task 3: audit of the restore hooks that ran before this resume. */
      readonly restore?: import("@arnilo/prism").CheckpointRestoreAudit;
      readonly timestamp: string;
      readonly sequence: number;
    }
  | {
      readonly type: "node_started";
      readonly workflowId: string;
      readonly runId: string;
      readonly nodeId: string;
      readonly iteration?: number;
      readonly timestamp: string;
      readonly sequence: number;
    }
  | {
      readonly type: "node_finished";
      readonly workflowId: string;
      readonly runId: string;
      readonly nodeId: string;
      readonly iteration?: number;
      readonly timestamp: string;
      readonly sequence: number;
    }
  | {
      readonly type: "node_iteration_started";
      readonly workflowId: string;
      readonly runId: string;
      readonly nodeId: string;
      readonly iteration: number;
      readonly iterationId: string;
      readonly timestamp: string;
      readonly sequence: number;
    }
  | {
      readonly type: "node_iteration_finished";
      readonly workflowId: string;
      readonly runId: string;
      readonly nodeId: string;
      readonly iteration: number;
      readonly iterationId: string;
      readonly done: boolean;
      readonly output?: unknown;
      readonly timestamp: string;
      readonly sequence: number;
    }
  | {
      readonly type: "node_failed";
      readonly workflowId: string;
      readonly runId: string;
      readonly nodeId: string;
      readonly error: { readonly message: string; readonly code?: string | number };
      readonly timestamp: string;
      readonly sequence: number;
    }
  | {
      readonly type: "node_skipped";
      readonly workflowId: string;
      readonly runId: string;
      readonly nodeId: string;
      readonly reason?: string;
      readonly timestamp: string;
      readonly sequence: number;
    }
  | {
      readonly type: "checkpoint_saved";
      readonly workflowId: string;
      readonly runId: string;
      readonly version: number;
      readonly timestamp: string;
      readonly sequence: number;
    }
  | {
      readonly type: "agent_event";
      readonly workflowId: string;
      readonly runId: string;
      readonly nodeId: string;
      readonly sequence: number;
      readonly event: AgentEvent;
      readonly timestamp: string;
    }
  | {
      readonly type: "workflow_event_overflow";
      readonly workflowId: string;
      readonly runId: string;
      readonly droppedEvents: number;
      readonly maxQueuedEvents: number;
      readonly timestamp: string;
      readonly sequence: number;
    };

/** Distributive omit so emit() accepts any concrete WorkflowEvent variant without sequence. */
export type WorkflowEventInput = WorkflowEvent extends infer Event
  ? Event extends WorkflowEvent
    ? Omit<Event, "sequence"> & { readonly sequence?: number }
    : never
  : never;

export interface WorkflowEventMergeOptions {
  readonly workflowId: string;
  readonly runId: string;
  /** Parent session id stamped on stream-only notices. */
  readonly parentSessionId?: string;
  readonly maxQueuedEvents?: number;
  readonly overflow?: "close" | "drop_oldest" | "drop_newest";
  readonly subscribeOptions?: SubscribeOptions;
  readonly signal?: AbortSignal;
}

export interface WorkflowTransitionChannel {
  /** Redacted package transitions, published only after the parent log append succeeds. */
  stream(): AsyncIterable<import("./parent-session.js").WorkflowStreamEvent>;
  publish(event: import("./parent-session.js").WorkflowPackageEvent): void;
  /** Steers every active child session of `nodeId`; false when none could be steered. */
  steer(nodeId: string, input: string): boolean;
  /** Aborts every active child session. */
  abort(reason?: unknown): void;
  emit(event: WorkflowEventInput): void;
  subscribe(): AsyncIterable<WorkflowEvent>;
  observeAgentNode(input: { readonly nodeId: string; readonly session: Session }): () => void;
  close(): void;
  readonly sequence: number;
}

export interface WorkflowRunHandle {
  readonly workflowId: string;
  readonly runId: string;
  readonly status: WorkflowRunStatus;
  readonly version: number;
}

export interface WorkflowRunResult extends WorkflowRunHandle {
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly state: Readonly<JsonObject>;
  readonly suspension?: WorkflowSuspensionDescriptor;
  readonly resume?: WorkflowResumeRecord;
  readonly lineage?: WorkflowReplayLineage;
}

/**
 * Checkpoint handed to a workflow restore hook (plan 094 Task 3). `metadata` is the checkpoint's
 * sidecar map (`WorkflowCheckpointValue.metadata`), written by the host on start/resume.
 */
export interface WorkflowCheckpointRestoreContext {
  readonly workflowId: string;
  readonly runId: string;
  readonly version: number;
  readonly status: WorkflowCheckpointValue["status"];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly checkpoint: WorkflowCheckpointRecord;
}

/** Host code restoring or compensating one external layer before a workflow resume applies. */
export type WorkflowCheckpointRestoreHook = import("./checkpoint-restore.js").CheckpointRestoreHandler<WorkflowCheckpointRestoreContext>;

export interface RunWorkflowOptions {
  readonly parent?: import("./parent-session.js").WorkflowParentSession;
  /**
   * The package API whose services (`checkpoints`, `leases`, `workspace`) a headless resume uses.
   * With it, `resumeWorkflow` defaults `checkpoints` and `leases` to the registered services.
   */
  readonly prism?: import("@arnilo/prism").PackageAPI;
  /** Claims the run for one resumer. A second claim fails with `LeaseConflictError`. */
  readonly leases?: import("./contracts.js").LeaseStore;
  /** Lease time to live; it is renewed every half. Default 30 s. */
  readonly leaseTtlMs?: number;
  /** Lease owner id; default a random id per resume. */
  readonly ownerId?: string;
  readonly concurrency?: number;
  readonly checkpoints?: WorkflowCheckpointAdapter;
  readonly runLedger?: RunLedger;
  readonly ownership?: OwnershipScope;
  /** Host-verified principal propagated into agent nodes without silent widening. */
  readonly principal?: Principal;
  readonly redactor?: SecretRedactor;
  /** Passed to every agent node; child agent config can only be narrowed. */
  readonly limits?: RunLimits;
  readonly signal?: AbortSignal;
  readonly transitions?: WorkflowTransitionChannel;
  readonly runId?: string;
  /** Lease fencing token supplied by a distributed coordinator. */
  readonly fencingToken?: number;
  /** Internal ownership guard used to stop writes immediately after lease loss. */
  readonly checkpointGuard?: () => boolean;
  /** Required when resuming a suspended run. */
  readonly resume?: WorkflowResumeRequest;
  /** Host-selected validator; required when a suspension declares resumeSchema. */
  readonly validateResume?: WorkflowResumeValidator;
  /** Host-selected validator; required when the workflow declares a state schema. */
  readonly validateState?: WorkflowStateValidator;
  readonly initialState?: JsonObject;
  /** Internal nesting cursor; hosts normally leave this unset. */
  readonly nestedDepth?: number;
  /** Internal inherited nesting ceiling; hosts normally leave this unset. */
  readonly nestedDepthLimit?: number;
  readonly failurePolicy?: "fail-fast";
  readonly metadata?: Readonly<Record<string, unknown>>;
  /**
   * Plan 094 Task 3: external-state restore hooks, run once per resume (including crash
   * recovery) before the scheduler touches the checkpoint. The first failing or timing-out hook
   * throws `CheckpointRestoreError`; nothing is written and the checkpoint stays resumable.
   * Plan 109 Task 2: an entry may be `{ id?, restore, compensate? }`, and on failure the applied
   * layers are compensated in reverse order (best-effort) before the throw.
   */
  readonly restoreHooks?: readonly WorkflowCheckpointRestoreHook[];
  /** Per-hook restore ceiling in ms; defaults to `DEFAULT_CHECKPOINT_RESTORE_TIMEOUT_MS`. */
  readonly restoreHookTimeoutMs?: number;
}
