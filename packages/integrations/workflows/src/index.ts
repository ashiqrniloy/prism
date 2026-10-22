/**
 * `@arnilo/prism-workflows` — typed graph workflows (DAG and cyclic) that orchestrate any set of
 * `Agent`s from outside their sessions (roadmap §2.12.13).
 *
 * ```ts
 * import workflows, { defineWorkflow, functionNode, routeNode, runWorkflow } from "@arnilo/prism-workflows";
 * const wf = defineWorkflow({ id: "triage", revision: "1", nodes: {
 *   classify: functionNode({ execute: (ctx) => classify(ctx.input) }),
 *   route: routeNode({ routes: { bug: "fix", other: "done" }, select: (ctx) => ctx.outputs.classify.kind }),
 * }, edges: [["classify", "route"]] });
 * const result = await runWorkflow(wf, { text: "…" });
 * ```
 */

import manifest from "../package.json" with { type: "json" };
import { definePackage, type PackageAPI } from "@arnilo/prism";
import { CHECKPOINTS_SERVICE, createWorkflowRuntime, WORKFLOWS_SERVICE } from "./services.js";

export {
  createMemoryWorkflowCheckpoints,
  createWorkflowCheckpoints,
  type GenericWorkflowCheckpointOptions,
  redactCheckpointOutputs,
} from "./checkpoints.js";
export { type WorkflowCommandOptions, type WorkflowCommandResult, workflowCommand } from "./command.js";
export type {
  CheckpointKey,
  CheckpointQuery,
  CheckpointRecord,
  CheckpointSaveInput,
  CheckpointStore,
  LeaseAcquireInput,
  LeaseClaimInput,
  LeaseKey,
  LeaseRecord,
  LeaseStore,
  OwnershipScope,
  PersistencePage,
  PersistenceQuery,
} from "./contracts.js";
export type { DefineWorkflowInput } from "./define.js";
export { buildGraph, defineWorkflow } from "./define.js";
export {
  WorkflowAbortError,
  WorkflowCheckpointError,
  WorkflowDefinitionError,
  WorkflowLoopLimitError,
  WorkflowRuntimeError,
  WorkflowSuperstepLimitError,
} from "./errors.js";
export { createWorkflowTransitionChannel } from "./events.js";
export {
  CheckpointRestoreError,
  DEFAULT_CHECKPOINT_RESTORE_TIMEOUT_MS,
  runCheckpointRestoreHooks,
} from "./checkpoint-restore.js";
export type {
  CheckpointRestoreCompensation,
  CheckpointRestoreHandler,
  CheckpointRestoreHook,
  RunCheckpointRestoreHooksOptions,
} from "./checkpoint-restore.js";
export {
  createEventMultiplexer,
  EVENT_MULTIPLEXER_SINGLE_CONSUMER_CODE,
  EventMultiplexerError,
} from "./event-multiplexer.js";
export type {
  EventMultiplexer,
  EventMultiplexerOptions,
  EventOverflowInfo,
  EventOverflowPolicy,
} from "./event-multiplexer.js";
export {
  collectWorkflowGraphs,
  createWorkflowGraphRunFolder,
  projectWorkflowGraphRun,
  serializeWorkflowGraph,
  type WorkflowGraphEdge,
  type WorkflowGraphNode,
  type WorkflowGraphNodeRunState,
  type WorkflowGraphRunFolder,
  type WorkflowGraphRunNode,
  type WorkflowGraphRunView,
  type WorkflowGraphView,
  type WorkflowRunTimelineSource,
} from "./graph.js";
export {
  type DotExportOptions,
  type MermaidExportOptions,
  workflowGraphToDot,
  workflowGraphToMermaid,
} from "./graph-export.js";
export {
  DEFAULT_EVENT_BUFFER,
  DEFAULT_LIST_PAGE_SIZE,
  DEFAULT_MAX_CHECKPOINT_BYTES,
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_MAX_FAN_OUT,
  DEFAULT_MAX_NESTED_DEPTH,
  DEFAULT_MAX_NODE_OUTPUT_BYTES,
  DEFAULT_MAX_NODES,
  DEFAULT_MAX_REPLAY_DEPTH,
  DEFAULT_MAX_STATE_BYTES,
  DEFAULT_MAX_STATE_HISTORY,
  HARD_LIST_PAGE_CAP,
  HARD_MAX_CHECKPOINT_BYTES,
  HARD_MAX_CONCURRENCY,
  HARD_MAX_FAN_OUT,
  HARD_MAX_LOOP_ITERATIONS,
  HARD_MAX_NESTED_DEPTH,
  HARD_MAX_NODE_OUTPUT_BYTES,
  HARD_MAX_NODE_RETRIES,
  HARD_MAX_NODE_TIMEOUT_MS,
  HARD_MAX_NODES,
  HARD_MAX_REPLAY_DEPTH,
  HARD_MAX_STATE_BYTES,
  HARD_MAX_STATE_HISTORY,
  HARD_MAX_SUPERSTEPS,
  WORKFLOW_CHECKPOINT_SCHEMA_VERSION,
  WORKFLOW_LOOP_ITERATION_SCHEMA_VERSION,
} from "./limits.js";
export { type LoopAgentStepConfig, loopAgentNode, type WorkflowLoopOptions, workflowLoop, workflowLoopStrategy } from "./loop.js";
export {
  CHECKPOINT_CONFLICT_CODE,
  CheckpointConflictError,
  createMemoryCheckpointStore,
  type MemoryCheckpointStoreOptions,
} from "./memory-checkpoints.js";
export { createMemoryLeaseStore, LEASE_CONFLICT_CODE, LeaseConflictError } from "./memory-leases.js";
export {
  agentNode,
  conditionalNode,
  fanOut,
  functionNode,
  gateNode,
  humanGate,
  joinNode,
  loopNode,
  routeNode,
  workflowNode,
} from "./nodes.js";
export {
  type StartWorkflowOptions,
  startWorkflow,
  WORKFLOW_EVENTS,
  type WorkflowPackageEvent,
  type WorkflowParentSession,
  type WorkflowRun,
  type WorkflowStreamEvent,
} from "./parent-session.js";
export {
  type ReplayWorkflowInput,
  type ReplayWorkflowOptions,
  replayWorkflow,
} from "./replay.js";
export { resolveMaxFanOut, resumeWorkflow, runWorkflow, suspend } from "./run.js";
export {
  createScopedContext,
  createScopedState,
  type ScopedSubgraphConfig,
  type ScopedWorkflowNodeContext,
  scopedSubgraphNode,
  validateScopeKey,
  withNodeScope,
} from "./scoped.js";
export {
  CHECKPOINTS_SERVICE,
  createWorkflowRuntime,
  LEASES_SERVICE,
  WORKFLOWS_SERVICE,
  type WorkflowRuntime,
} from "./services.js";
export type {
  AgentNodeDefinition,
  AgentNodeWorktree,
  AgentNodeWorktreeOutput,
  ConditionalNodeDefinition,
  FanOutItemNode,
  FanOutNodeDefinition,
  FunctionNodeDefinition,
  GateCheckResult,
  GateNodeDefinition,
  GateNodeOutput,
  HumanGateNodeDefinition,
  HumanGateRequest,
  JoinNodeDefinition,
  LoopNodeConfig,
  LoopNodeDefinition,
  NestedWorkflowNodeDefinition,
  NodeIdempotency,
  RouteNodeConfig,
  RouteNodeDefinition,
  RunWorkflowOptions,
  WorkflowCheckpointAdapter,
  WorkflowCheckpointAdapterOptions,
  WorkflowCheckpointListInput,
  WorkflowCheckpointListPage,
  WorkflowCheckpointLoadInput,
  WorkflowCheckpointRecord,
  WorkflowCheckpointSaveInput,
  WorkflowCheckpointValue,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowEventInput,
  WorkflowEventMergeOptions,
  WorkflowExecutionCheckpoint,
  WorkflowExecutionPendingActivation,
  WorkflowLimits,
  WorkflowLoopBodyDefinition,
  WorkflowLoopIterationRecord,
  WorkflowLoopNodeContext,
  WorkflowNodeBase,
  WorkflowNodeCheckpoint,
  WorkflowNodeContext,
  WorkflowNodeDefinition,
  WorkflowNodeKind,
  WorkflowNodeStatus,
  WorkflowReplayLineage,
  WorkflowResumeContext,
  WorkflowResumeRecord,
  WorkflowResumeRequest,
  WorkflowResumeValidationInput,
  WorkflowResumeValidator,
  WorkflowRunHandle,
  WorkflowRunResult,
  WorkflowRunStatus,
  WorkflowStateConfig,
  WorkflowStateUpdateOptions,
  WorkflowStateValidationInput,
  WorkflowStateValidator,
  WorkflowSuspension,
  WorkflowSuspensionDescriptor,
  WorkflowTransitionChannel,
} from "./types.js";

const PACKAGE = "@arnilo/prism-workflows";

function setup(prism: PackageAPI): void {
  prism.services.provide(WORKFLOWS_SERVICE, createWorkflowRuntime(prism));
  if (prism.services.consume(CHECKPOINTS_SERVICE) === undefined) {
    prism.status.note("info", "no checkpoints service; workflow runs are not durable across processes");
  }
}

/** The package definition. Test seam so a host can register it under its own name. */
export function createWorkflowPackageDefinition() {
  return definePackage({
    name: PACKAGE,
    version: manifest.version,
    description:
      "Typed graph workflows (DAG and cyclic) that orchestrate any set of agents from outside their sessions: checkpoints, suspend/resume, replay, graph export.",
    capabilities: ["session-state", "host-ui"],
    requires: { api: 1 },
    setup,
  });
}

export default createWorkflowPackageDefinition();

export const packageName = PACKAGE;
