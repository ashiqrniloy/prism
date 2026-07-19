import { WorkflowDefinitionError } from "./errors.js";
import {
  DEFAULT_MAX_NODES,
  HARD_MAX_FAN_OUT,
  HARD_MAX_NODE_RETRIES,
  HARD_MAX_NODE_TIMEOUT_MS,
  validateWorkflowLimit,
  validateWorkflowLimits,
} from "./limits.js";
import type { WorkflowDefinition, WorkflowLimits, WorkflowNodeDefinition } from "./types.js";

export interface DefineWorkflowInput {
  readonly id: string;
  readonly revision: string;
  readonly nodes: Readonly<Record<string, WorkflowNodeDefinition>>;
  readonly edges?: readonly (readonly [string, string])[];
  readonly limits?: WorkflowLimits;
  readonly state?: WorkflowDefinition["state"];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function defineWorkflow(input: DefineWorkflowInput): WorkflowDefinition {
  const id = input.id?.trim();
  if (!id) throw new WorkflowDefinitionError("Workflow id is required");
  const revision = input.revision?.trim();
  if (!revision) throw new WorkflowDefinitionError("Workflow revision is required");

  validateWorkflowLimits(input.limits);
  const nodeIds = Object.keys(input.nodes);
  if (nodeIds.length === 0) throw new WorkflowDefinitionError("Workflow must declare at least one node");

  const maxNodes = input.limits?.maxNodes ?? DEFAULT_MAX_NODES;
  if (nodeIds.length > maxNodes) {
    throw new WorkflowDefinitionError(`Workflow exceeds maxNodes (${nodeIds.length} > ${maxNodes})`);
  }

  const nodeSet = new Set(nodeIds);
  const edges = input.edges ?? [];
  for (const [from, to] of edges) {
    if (!nodeSet.has(from)) throw new WorkflowDefinitionError(`Edge references unknown node "${from}"`);
    if (!nodeSet.has(to)) throw new WorkflowDefinitionError(`Edge references unknown node "${to}"`);
    if (from === to) throw new WorkflowDefinitionError(`Self-edge is not allowed on node "${from}"`);
  }

  assertAcyclic(nodeIds, edges);

  for (const [nodeId, node] of Object.entries(input.nodes)) {
    if (node.kind === "conditional") {
      for (const target of [...(node.then ?? []), ...(node.else ?? [])]) {
        if (!nodeSet.has(target)) {
          throw new WorkflowDefinitionError(`Conditional node "${nodeId}" references unknown node "${target}"`);
        }
      }
    }
    if (node.kind === "join" && node.from && !nodeSet.has(node.from)) {
      throw new WorkflowDefinitionError(`Join node "${nodeId}" references unknown node "${node.from}"`);
    }
    if (node.retries !== undefined && (!Number.isSafeInteger(node.retries) || node.retries < 0 || node.retries > HARD_MAX_NODE_RETRIES)) {
      throw new WorkflowDefinitionError(`Node "${nodeId}" retries must be a non-negative safe integer at most ${HARD_MAX_NODE_RETRIES}`);
    }
    if (node.timeoutMs !== undefined) {
      validateWorkflowLimit(`Node "${nodeId}" timeoutMs`, node.timeoutMs, HARD_MAX_NODE_TIMEOUT_MS);
    }
    if (node.kind === "fan_out" && node.maxFanOut !== undefined) {
      validateWorkflowLimit(`Node "${nodeId}" maxFanOut`, node.maxFanOut, HARD_MAX_FAN_OUT);
    }
  }

  return Object.freeze({
    id,
    revision,
    nodes: Object.freeze({ ...input.nodes }),
    edges: Object.freeze(edges.map(([from, to]) => Object.freeze([from, to] as const))),
    limits: input.limits ? Object.freeze({ ...input.limits }) : undefined,
    state: input.state ? Object.freeze({
      ...input.state,
      initial: input.state.initial ? Object.freeze({ ...input.state.initial }) : undefined,
      schema: input.state.schema ? Object.freeze({ ...input.state.schema }) : undefined,
    }) : undefined,
    metadata: input.metadata ? Object.freeze({ ...input.metadata }) : undefined,
  });
}

function assertAcyclic(
  nodeIds: readonly string[],
  edges: readonly (readonly [string, string])[],
): void {
  const successors = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of nodeIds) {
    successors.set(id, []);
    indegree.set(id, 0);
  }
  for (const [from, to] of edges) {
    successors.get(from)!.push(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, degree] of indegree) {
    if (degree === 0) queue.push(id);
  }

  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited += 1;
    for (const next of successors.get(id) ?? []) {
      const nextDegree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextDegree);
      if (nextDegree === 0) queue.push(next);
    }
  }

  if (visited !== nodeIds.length) {
    throw new WorkflowDefinitionError("Workflow graph contains a cycle");
  }
}

/** Build adjacency helpers used by the Kahn scheduler. */
export function buildGraph(workflow: WorkflowDefinition): {
  readonly successors: ReadonlyMap<string, readonly string[]>;
  readonly predecessors: ReadonlyMap<string, readonly string[]>;
  readonly indegree: ReadonlyMap<string, number>;
} {
  const successors = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of Object.keys(workflow.nodes)) {
    successors.set(id, []);
    predecessors.set(id, []);
    indegree.set(id, 0);
  }
  for (const [from, to] of workflow.edges) {
    successors.get(from)!.push(to);
    predecessors.get(to)!.push(from);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  }
  // Deterministic successor order for joins / event ordering.
  for (const [id, list] of successors) {
    list.sort((a, b) => a.localeCompare(b));
    successors.set(id, list);
  }
  for (const [id, list] of predecessors) {
    list.sort((a, b) => a.localeCompare(b));
    predecessors.set(id, list);
  }
  return { successors, predecessors, indegree };
}
