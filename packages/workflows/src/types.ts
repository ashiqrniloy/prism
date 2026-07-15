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
  | "succeeded"
  | "failed"
  | "aborted";

export type WorkflowNodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "aborted";

export type WorkflowNodeKind =
  | "agent"
  | "function"
  | "tool"
  | "conditional"
  | "fan_out"
  | "join";

export interface WorkflowNodeContext {
  readonly workflowId: string;
  readonly runId: string;
  readonly nodeId: string;
  readonly workflowInput: unknown;
  readonly upstream: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
  readonly ownership?: OwnershipScope;
  readonly metadata?: Readonly<Record<string, unknown>>;
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

export interface ToolNodeDefinition extends WorkflowNodeBase {
  readonly kind: "tool";
  readonly tool: ToolDefinition | string;
  readonly args: (ctx: WorkflowNodeContext) => JsonObject | Promise<JsonObject>;
  readonly action?: (
    ctx: WorkflowNodeContext,
    args: JsonObject,
  ) => ExecutionAction | Promise<ExecutionAction>;
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

export type WorkflowNodeDefinition =
  | AgentNodeDefinition
  | FunctionNodeDefinition
  | ToolNodeDefinition
  | ConditionalNodeDefinition
  | FanOutNodeDefinition
  | JoinNodeDefinition;

export interface WorkflowLimits {
  readonly maxNodes?: number;
  readonly maxFanOut?: number;
  readonly maxConcurrency?: number;
  readonly maxNodeOutputBytes?: number;
  readonly maxCheckpointBytes?: number;
}

export interface WorkflowDefinition {
  readonly id: string;
  readonly nodes: Readonly<Record<string, WorkflowNodeDefinition>>;
  readonly edges: readonly (readonly [string, string])[];
  readonly limits?: WorkflowLimits;
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
  readonly failurePolicy?: "fail-fast";
  readonly metadata?: Readonly<Record<string, unknown>>;
}
