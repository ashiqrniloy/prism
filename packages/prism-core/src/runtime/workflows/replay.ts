import type { JsonObject, OwnershipScope } from "@arnilo/prism";
import { buildGraph } from "./define.js";
import { WorkflowCheckpointError, WorkflowRuntimeError } from "./errors.js";
import { DEFAULT_MAX_REPLAY_DEPTH, WORKFLOW_CHECKPOINT_SCHEMA_VERSION } from "./limits.js";
import { resumeWorkflow } from "./run.js";
import type {
  RunWorkflowOptions,
  WorkflowCheckpointAdapter,
  WorkflowDefinition,
  WorkflowNodeCheckpoint,
  WorkflowNodeDefinition,
  WorkflowReplayLineage,
  WorkflowRunResult,
} from "./types.js";
import { createRunId, hashWorkflowDefinition, nowIso, ownershipMatches } from "./util.js";

export interface ReplayWorkflowInput {
  readonly sourceRunId: string;
  readonly fromNodeId: string;
  readonly runId?: string;
  /** Replay from a specific 0-based iteration index of the selected node. */
  readonly iteration?: number;
  /** Injected state patch merged over the restored state before the replayed node executes. */
  readonly injectState?: JsonObject;
  /** Optional workflow input override. */
  readonly injectInput?: unknown;
}

export interface ReplayWorkflowOptions extends RunWorkflowOptions {
  readonly checkpoints: WorkflowCheckpointAdapter;
  readonly ownership?: OwnershipScope;
}

/** Create a new run from one completed source node without mutating source evidence. */
export async function replayWorkflow(
  workflow: WorkflowDefinition,
  input: ReplayWorkflowInput,
  options: ReplayWorkflowOptions,
): Promise<WorkflowRunResult> {
  const source = await options.checkpoints.load({
    workflowId: workflow.id,
    runId: input.sourceRunId,
    ownership: options.ownership,
    signal: options.signal,
  });
  if (!source) throw new WorkflowCheckpointError(`No source checkpoint for run ${input.sourceRunId}`);
  if (!ownershipMatches(options.ownership, source.ownership)) {
    throw new WorkflowCheckpointError("Replay source tenant/ownership mismatch");
  }
  if (source.value.definitionHash !== hashWorkflowDefinition(workflow)) {
    throw new WorkflowCheckpointError("Workflow definition hash mismatch on replay");
  }
  if (source.value.status !== "succeeded") {
    throw new WorkflowCheckpointError("Only succeeded workflow runs are replayable");
  }
  const selected = source.value.nodes[input.fromNodeId];
  if (selected?.status !== "succeeded" || selected?.error !== undefined) {
    throw new WorkflowCheckpointError(`Replay node ${input.fromNodeId} must be succeeded`);
  }

  let targetIteration: import("./types.js").WorkflowLoopIterationRecord | undefined;
  if (input.iteration !== undefined) {
    if (typeof input.iteration !== "number" || !Number.isInteger(input.iteration) || input.iteration < 0) {
      throw new WorkflowCheckpointError("Replay iteration must be a non-negative integer");
    }
    targetIteration = selected.iterations?.find((it) => it.iteration === input.iteration);
    if (!targetIteration) {
      throw new WorkflowCheckpointError(
        `Replay node ${input.fromNodeId} iteration ${input.iteration} not found (recorded iterations: ${selected.iterations?.length ?? 0})`,
      );
    }
  }

  const graph = buildGraph(workflow);
  const backEdges = findBackEdges(workflow);
  const blocked = new Set(graph.predecessors.get(input.fromNodeId) ?? []);
  const rerun = descendants(input.fromNodeId, graph.successors, backEdges, blocked);
  const copied = Object.keys(workflow.nodes).filter((nodeId) => !rerun.has(nodeId));
  for (const nodeId of copied) {
    const nodeDef = workflow.nodes[nodeId];
    if (nodeDef && containsApproval(nodeDef)) {
      throw new WorkflowCheckpointError(`Replay would reuse durable approval at ${nodeId}; replay from that node or earlier`);
    }
  }

  const lineage: WorkflowReplayLineage = {
    sourceRunId: source.runId,
    fromNodeId: input.fromNodeId,
    rootRunId: source.value.lineage?.rootRunId ?? source.runId,
    depth: (source.value.lineage?.depth ?? 0) + 1,
    createdAt: nowIso(),
  };
  const maxDepth = workflow.limits?.maxReplayDepth ?? DEFAULT_MAX_REPLAY_DEPTH;
  if (lineage.depth > maxDepth) {
    throw new WorkflowRuntimeError(`Replay exceeds maxReplayDepth (${lineage.depth} > ${maxDepth})`, "ERR_PRISM_WORKFLOW_REPLAY_DEPTH");
  }

  const stateVersion = targetIteration?.stateVersionBefore ?? selected.stateVersionBefore ?? 0;
  let restoredState = source.value.stateHistory?.[String(stateVersion)] ?? source.value.state ?? {};
  if (input.injectState !== undefined) {
    if (typeof input.injectState !== "object" || input.injectState === null || Array.isArray(input.injectState)) {
      throw new WorkflowCheckpointError("Replay injectState must be a plain object");
    }
    restoredState = { ...restoredState, ...input.injectState };
  }

  const nodes: Record<string, WorkflowNodeCheckpoint> = {};
  const completedNodeIds: string[] = [];
  for (const nodeId of Object.keys(workflow.nodes)) {
    if (rerun.has(nodeId)) {
      nodes[nodeId] = { nodeId, status: nodeId === input.fromNodeId ? "ready" : "pending" };
      continue;
    }
    const prior = source.value.nodes[nodeId];
    if (!prior || !["succeeded", "skipped", "denied"].includes(prior.status)) {
      throw new WorkflowCheckpointError(`Replay predecessor evidence for ${nodeId} is not terminal`);
    }
    let resolvedOutput = prior.output;
    if (targetIteration) {
      const matchingIter = prior.iterations?.filter((it) => it.iteration <= targetIteration.iteration).at(-1);
      if (matchingIter?.output !== undefined) {
        resolvedOutput = matchingIter.output;
      } else if (resolvedOutput === undefined) {
        resolvedOutput = prior.iterations?.at(-1)?.output ?? prior.lastOutput;
      }
    } else {
      const lastIteration = prior.iterations?.at(-1);
      resolvedOutput = prior.output ?? lastIteration?.output ?? prior.lastOutput;
    }
    nodes[nodeId] = {
      ...prior,
      ...(resolvedOutput !== undefined ? { output: resolvedOutput, lastOutput: resolvedOutput } : {}),
    };
    completedNodeIds.push(nodeId);
  }

  const effectiveWorkflowInput = input.injectInput !== undefined ? input.injectInput : source.value.workflowInput;
  const runId = input.runId ?? createRunId();
  const timestamp = nowIso();
  await options.checkpoints.save({
    workflowId: workflow.id,
    runId,
    version: 1,
    expectedVersion: 0,
    ownership: options.ownership,
    signal: options.signal,
    value: {
      schemaVersion: WORKFLOW_CHECKPOINT_SCHEMA_VERSION,
      workflowId: workflow.id,
      runId,
      definitionHash: hashWorkflowDefinition(workflow),
      status: "queued",
      readyNodeIds: [input.fromNodeId],
      completedNodeIds: completedNodeIds.sort((a, b) => a.localeCompare(b)),
      nodes,
      workflowInput: effectiveWorkflowInput,
      createdAt: timestamp,
      updatedAt: timestamp,
      redacted: source.value.redacted,
      state: restoredState,
      stateVersion: 0,
      stateHistory: { "0": restoredState },
      lineage,
      metadata: {
        ...source.value.metadata,
        replaySourceRunId: source.runId,
        replayFromNodeId: input.fromNodeId,
        ...(input.iteration !== undefined ? { replayIteration: input.iteration } : {}),
        ...(input.injectState !== undefined ? { injectedStateKeys: Object.keys(input.injectState) } : {}),
      },
      ...(workflow.execution === "supersteps"
        ? {
            execution: {
              mode: "supersteps" as const,
              superstep: 0,
              ...(workflow.limits?.maxSupersteps !== undefined ? { maxSupersteps: workflow.limits.maxSupersteps } : {}),
              pending: {},
            },
          }
        : {}),
    },
  });

  return resumeWorkflow(
    workflow,
    { workflowId: workflow.id, runId },
    {
      ...options,
      checkpoints: options.checkpoints,
      runId,
    },
  );
}

function descendants(
  nodeId: string,
  successors: ReadonlyMap<string, readonly string[]>,
  backEdges: ReadonlySet<string>,
  blocked: ReadonlySet<string>,
): Set<string> {
  const found = new Set([nodeId]);
  const queue = [nodeId];
  while (queue.length > 0) {
    const curr = queue.shift();
    if (!curr) break;
    for (const next of successors.get(curr) ?? []) {
      if (!backEdges.has(`${curr}->${next}`) && !blocked.has(next) && !found.has(next)) {
        found.add(next);
        queue.push(next);
      }
    }
  }
  return found;
}

function findBackEdges(workflow: WorkflowDefinition): Set<string> {
  const nodeIds = Object.keys(workflow.nodes);
  const indegree = new Map<string, number>();
  const successors = new Map<string, string[]>();
  for (const id of nodeIds) {
    indegree.set(id, 0);
    successors.set(id, []);
  }
  for (const [from, to] of workflow.edges) {
    if (successors.has(from) && successors.has(to)) {
      successors.get(from)?.push(to);
      indegree.set(to, (indegree.get(to) ?? 0) + 1);
    }
  }

  const backEdges = new Set<string>();
  const state = new Map<string, "visiting" | "visited">();

  function dfs(u: string) {
    state.set(u, "visiting");
    for (const v of successors.get(u) ?? []) {
      if (state.get(v) === "visiting") {
        backEdges.add(`${u}->${v}`);
      } else if (!state.has(v)) {
        dfs(v);
      }
    }
    state.set(u, "visited");
  }

  for (const id of nodeIds) {
    if ((indegree.get(id) ?? 0) === 0 && !state.has(id)) {
      dfs(id);
    }
  }

  for (const id of nodeIds) {
    if (!state.has(id)) {
      dfs(id);
    }
  }

  return backEdges;
}

function containsApproval(node: WorkflowNodeDefinition): boolean {
  if (node.kind === "tool") return Boolean(node.approval);
  return node.kind === "workflow" && Object.values(node.workflow.nodes).some(containsApproval);
}
