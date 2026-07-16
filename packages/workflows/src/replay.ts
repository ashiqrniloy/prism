import type { OwnershipScope } from "@arnilo/prism";
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
  if (!selected || selected.status !== "succeeded") {
    throw new WorkflowCheckpointError(`Replay node ${input.fromNodeId} must be succeeded`);
  }

  const graph = buildGraph(workflow);
  const rerun = descendants(input.fromNodeId, graph.successors);
  const copied = Object.keys(workflow.nodes).filter((nodeId) => !rerun.has(nodeId));
  for (const nodeId of copied) {
    if (containsApproval(workflow.nodes[nodeId]!)) {
      throw new WorkflowCheckpointError(
        `Replay would reuse durable approval at ${nodeId}; replay from that node or earlier`,
      );
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

  const stateVersion = selected.stateVersionBefore ?? 0;
  const restoredState = source.value.stateHistory?.[String(stateVersion)] ?? source.value.state ?? {};
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
    nodes[nodeId] = { ...prior };
    completedNodeIds.push(nodeId);
  }

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
      workflowInput: source.value.workflowInput,
      createdAt: timestamp,
      updatedAt: timestamp,
      redacted: source.value.redacted,
      state: restoredState,
      stateVersion: 0,
      stateHistory: { "0": restoredState },
      lineage,
      metadata: { ...source.value.metadata, replaySourceRunId: source.runId, replayFromNodeId: input.fromNodeId },
    },
  });

  return resumeWorkflow(workflow, { workflowId: workflow.id, runId }, {
    ...options,
    checkpoints: options.checkpoints,
    runId,
  });
}

function descendants(
  nodeId: string,
  successors: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const found = new Set([nodeId]);
  const queue = [nodeId];
  while (queue.length > 0) {
    for (const next of successors.get(queue.shift()!) ?? []) {
      if (!found.has(next)) {
        found.add(next);
        queue.push(next);
      }
    }
  }
  return found;
}

function containsApproval(node: WorkflowNodeDefinition): boolean {
  if (node.kind === "tool") return Boolean(node.approval);
  return node.kind === "workflow" && Object.values(node.workflow.nodes).some(containsApproval);
}
