import type {
  AgentEvent,
  AgentSession,
  ExecutionAction,
  ExecutionPolicy,
  JsonObject,
  OwnershipScope,
  RunLedger,
  SecretRedactor,
  SubscribeOptions,
  ToolDefinition,
} from "@arnilo/prism";
import type { WORKFLOW_CHECKPOINT_SCHEMA_VERSION } from "./limits.js";

export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "suspended"
  | "succeeded"
  | "failed"
  | "denied"
  | "aborted";

export type WorkflowNodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "suspended"
  | "succeeded"
  | "failed"
  | "denied"
  | "skipped"
  | "aborted";

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

export type WorkflowResumeValidator = (
  input: WorkflowResumeValidationInput,
) => void | Promise<void>;

export type WorkflowNodeKind =
  | "agent"
  | "function"
  | "tool"
  | "conditional"
  | "fan_out"
  | "join"
  | "workflow";

export interface WorkflowStateUpdateOptions {
  readonly mode?: "merge" | "replace";
}

export interface WorkflowStateValidationInput {
  readonly value: JsonObject;
  readonly schema?: JsonObject;
  readonly signal?: AbortSignal;
}

export type WorkflowStateValidator = (
  input: WorkflowStateValidationInput,
) => void | Promise<void>;

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

export interface WorkflowNodeBase {
  readonly kind: WorkflowNodeKind;
  readonly retries?: number;
  readonly timeoutMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AgentNodeDefinition extends WorkflowNodeBase {
  readonly kind: "agent";
  readonly agent: string;
  readonly input?: (ctx: WorkflowNodeContext) => unknown | Promise<unknown>;
  readonly output?: (
    ctx: WorkflowNodeContext & { readonly session: AgentSession },
  ) => unknown | Promise<unknown>;
}

export interface FunctionNodeDefinition extends WorkflowNodeBase {
  readonly kind: "function";
  readonly execute: (ctx: WorkflowNodeContext) => unknown | Promise<unknown>;
}

export interface WorkflowToolApproval {
  readonly reason: string;
  readonly data?: (
    ctx: WorkflowNodeContext,
    args: JsonObject,
  ) => unknown | Promise<unknown>;
  readonly resumeSchema?: JsonObject;
}

export interface ToolNodeDefinition extends WorkflowNodeBase {
  readonly kind: "tool";
  readonly tool: ToolDefinition | string;
  readonly args: (ctx: WorkflowNodeContext) => JsonObject | Promise<JsonObject>;
  readonly action?: (
    ctx: WorkflowNodeContext,
    args: JsonObject,
  ) => ExecutionAction | Promise<ExecutionAction>;
  /** Opt-in durable approval gate evaluated before any tool side effect. */
  readonly approval?: WorkflowToolApproval;
}

export interface ConditionalNodeDefinition extends WorkflowNodeBase {
  readonly kind: "conditional";
  readonly when: (ctx: WorkflowNodeContext) => boolean | Promise<boolean>;
  /** When true, only these successors remain eligible (others skipped). */
  readonly then?: readonly string[];
  /** When false, only these successors remain eligible (others skipped). */
  readonly else?: readonly string[];
}

export interface FanOutNodeDefinition extends WorkflowNodeBase {
  readonly kind: "fan_out";
  readonly items: (ctx: WorkflowNodeContext) => readonly unknown[] | Promise<readonly unknown[]>;
  readonly map: (
    item: unknown,
    index: number,
    ctx: WorkflowNodeContext,
  ) => unknown | Promise<unknown>;
  readonly maxFanOut?: number;
}

export interface JoinNodeDefinition extends WorkflowNodeBase {
  readonly kind: "join";
  /** Upstream fan-out (or array-producing) node id; defaults to sole predecessor. */
  readonly from?: string;
  readonly reduce?: (
    items: readonly unknown[],
    ctx: WorkflowNodeContext,
  ) => unknown | Promise<unknown>;
}

export interface NestedWorkflowNodeDefinition extends WorkflowNodeBase {
  readonly kind: "workflow";
  readonly workflow: WorkflowDefinition;
  readonly input?: (ctx: WorkflowNodeContext) => unknown | Promise<unknown>;
  readonly output?: (
    result: WorkflowRunResult,
    ctx: WorkflowNodeContext,
  ) => unknown | Promise<unknown>;
}

export type WorkflowNodeDefinition =
  | AgentNodeDefinition
  | FunctionNodeDefinition
  | ToolNodeDefinition
  | ConditionalNodeDefinition
  | FanOutNodeDefinition
  | JoinNodeDefinition
  | NestedWorkflowNodeDefinition;

export interface WorkflowLimits {
  readonly maxNodes?: number;
  readonly maxFanOut?: number;
  readonly maxConcurrency?: number;
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
}

export interface WorkflowReplayLineage {
  readonly sourceRunId: string;
  readonly fromNodeId: string;
  readonly rootRunId: string;
  readonly depth: number;
  readonly createdAt: string;
}

export interface WorkflowCheckpointValue {
  readonly schemaVersion: typeof WORKFLOW_CHECKPOINT_SCHEMA_VERSION;
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
      readonly timestamp: string;
      readonly sequence: number;
    }
  | {
      readonly type: "node_started";
      readonly workflowId: string;
      readonly runId: string;
      readonly nodeId: string;
      readonly timestamp: string;
      readonly sequence: number;
    }
  | {
      readonly type: "node_finished";
      readonly workflowId: string;
      readonly runId: string;
      readonly nodeId: string;
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
  readonly maxQueuedEvents?: number;
  readonly overflow?: "close" | "drop_oldest" | "drop_newest";
  readonly subscribeOptions?: SubscribeOptions;
  readonly signal?: AbortSignal;
}

export interface WorkflowEventBus {
  emit(event: WorkflowEventInput): void;
  subscribe(): AsyncIterable<WorkflowEvent>;
  observeAgentNode(input: {
    readonly nodeId: string;
    readonly session: AgentSession;
  }): () => void;
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

export interface RunWorkflowOptions {
  readonly concurrency?: number;
  readonly checkpoints?: WorkflowCheckpointAdapter;
  readonly agentFactory?: (agentName: string) => AgentSession | Promise<AgentSession>;
  readonly tools?: Readonly<Record<string, ToolDefinition>> | ((name: string) => ToolDefinition | undefined);
  readonly runLedger?: RunLedger;
  readonly ownership?: OwnershipScope;
  readonly redactor?: SecretRedactor;
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: WorkflowEvent) => void;
  readonly eventBus?: WorkflowEventBus;
  readonly executionPolicy?: ExecutionPolicy;
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
}
