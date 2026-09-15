import { WorkflowDefinitionError } from "./errors.js";
import { DEFAULT_MAX_NODES, HARD_MAX_NODES } from "./limits.js";
import type {
  ConditionalNodeDefinition,
  WorkflowCheckpointValue,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowNodeKind,
  WorkflowNodeStatus,
} from "./types.js";
import { hashWorkflowDefinition } from "./util.js";

// ─── Graph View Types (R-G1) ──────────────────────────────────────────────────

export interface WorkflowGraphNode {
  readonly id: string;
  readonly kind: WorkflowNodeKind;
  readonly label: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  readonly nestedWorkflowId?: string;
  readonly loop?: { readonly maxIterations: number };
}

export interface WorkflowGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: "always" | "then" | "else";
}

export interface WorkflowGraphView {
  readonly schemaVersion: 1;
  readonly workflowId: string;
  readonly revision: string;
  readonly definitionHash: string;
  readonly nodes: readonly WorkflowGraphNode[];
  readonly edges: readonly WorkflowGraphEdge[];
}

// ─── Graph Run Overlay Types (R-G3) ───────────────────────────────────────────

export interface WorkflowGraphNodeRunState {
  readonly status: WorkflowNodeStatus;
  readonly durationMs?: number;
  readonly attempt?: number;
  readonly errorCode?: string | number;
  readonly skippedReason?: string;
}

export interface WorkflowGraphRunNode extends WorkflowGraphNode {
  readonly run?: WorkflowGraphNodeRunState;
}

export interface WorkflowGraphRunView {
  readonly schemaVersion: 1;
  readonly workflowId: string;
  readonly revision: string;
  readonly definitionHash: string;
  readonly runId: string;
  readonly runStatus: string;
  readonly activeNodeIds: readonly string[];
  readonly nodes: readonly WorkflowGraphRunNode[];
  readonly edges: readonly WorkflowGraphEdge[];
  readonly nodeStates: Readonly<Record<string, WorkflowGraphNodeRunState>>;
}

export interface WorkflowGraphRunFolder {
  push(event: WorkflowEvent): void;
  snapshot(): WorkflowGraphRunView;
}

export interface WorkflowRunTimelineSource {
  readonly runId: string;
  readonly status: string;
  readonly steps: readonly {
    readonly id?: string;
    readonly kind: string;
    readonly name: string;
    readonly status: string;
    readonly durationMs?: number;
    readonly error?: { readonly message?: string; readonly code?: string | number };
    readonly metadata?: Readonly<Record<string, unknown>>;
  }[];
}

// ─── Serialization (R-G1) ─────────────────────────────────────────────────────

export function serializeWorkflowGraph(workflow: WorkflowDefinition): WorkflowGraphView {
  if (!workflow || typeof workflow !== "object") {
    throw new WorkflowDefinitionError("Workflow definition is required");
  }

  const maxNodes = workflow.limits?.maxNodes ?? DEFAULT_MAX_NODES;
  const nodeEntries = Object.entries(workflow.nodes ?? {});
  if (nodeEntries.length > maxNodes) {
    throw new WorkflowDefinitionError(`Workflow nodes count (${nodeEntries.length}) exceeds maxNodes limit of ${maxNodes}`);
  }
  if (nodeEntries.length > HARD_MAX_NODES) {
    throw new WorkflowDefinitionError(`Workflow nodes count (${nodeEntries.length}) exceeds hard limit of ${HARD_MAX_NODES}`);
  }

  // Stable sort nodes by ID ascending
  const sortedNodeEntries = [...nodeEntries].sort(([a], [b]) => a.localeCompare(b));

  const nodes: WorkflowGraphNode[] = sortedNodeEntries.map(([id, node]) => {
    const rawTitle = typeof node.metadata?.title === "string" ? node.metadata.title : undefined;
    const rawLabel = typeof node.metadata?.label === "string" ? node.metadata.label : undefined;
    const label = rawTitle || rawLabel || id;

    let metadata: Record<string, string | number | boolean> | undefined;
    if (node.metadata && typeof node.metadata === "object") {
      const filtered: Record<string, string | number | boolean> = {};
      for (const [k, v] of Object.entries(node.metadata)) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          filtered[k] = v;
        }
      }
      if (Object.keys(filtered).length > 0) {
        metadata = Object.freeze(filtered);
      }
    }

    const graphNode: WorkflowGraphNode = {
      id,
      kind: node.kind,
      label,
      ...(metadata ? { metadata } : {}),
      ...(node.kind === "workflow" && node.workflow?.id ? { nestedWorkflowId: node.workflow.id } : {}),
      ...(node.kind === "loop" && typeof node.maxIterations === "number" ? { loop: { maxIterations: node.maxIterations } } : {}),
    };
    return Object.freeze(graphNode);
  });

  // Derive edge kinds: conditional then/else vs always
  const edges: WorkflowGraphEdge[] = (workflow.edges ?? []).map(([from, to]) => {
    const sourceNode = workflow.nodes?.[from];
    let kind: "always" | "then" | "else" = "always";

    if (sourceNode?.kind === "conditional") {
      const cond = sourceNode as ConditionalNodeDefinition;
      if (cond.then?.includes(to)) {
        kind = "then";
      } else if (cond.else?.includes(to)) {
        kind = "else";
      } else {
        kind = "always";
      }
    }

    return Object.freeze({ from, to, kind });
  });

  // Stable sort edges: from ASC, to ASC, kind ASC
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind));

  return Object.freeze({
    schemaVersion: 1 as const,
    workflowId: workflow.id,
    revision: workflow.revision,
    definitionHash: hashWorkflowDefinition(workflow),
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
  });
}

// ─── Nested Workflow Collector (R-G5) ─────────────────────────────────────────

export function collectWorkflowGraphs(root: WorkflowDefinition): ReadonlyMap<string, WorkflowGraphView> {
  const result = new Map<string, WorkflowGraphView>();
  const visited = new Set<WorkflowDefinition>();

  function walk(wf: WorkflowDefinition) {
    if (visited.has(wf)) return;
    visited.add(wf);

    const view = serializeWorkflowGraph(wf);
    result.set(wf.id, view);

    for (const node of Object.values(wf.nodes ?? {})) {
      if (node.kind === "workflow" && node.workflow) {
        walk(node.workflow);
      }
    }
  }

  walk(root);
  return result;
}

// ─── Run Overlay Projection (R-G3) ────────────────────────────────────────────

function isTimelineSource(source: unknown): source is WorkflowRunTimelineSource {
  return typeof source === "object" && source !== null && "steps" in source && Array.isArray((source as { steps: unknown }).steps);
}

export function projectWorkflowGraphRun(
  view: WorkflowGraphView,
  source: WorkflowCheckpointValue | WorkflowRunTimelineSource,
): WorkflowGraphRunView {
  const nodeStates: Record<string, WorkflowGraphNodeRunState> = {};
  let runId = "";
  let runStatus = "pending";
  let activeNodeIds: string[] = [];

  if (isTimelineSource(source)) {
    runId = source.runId;
    runStatus = source.status;
    const activeSet = new Set<string>();

    for (const node of view.nodes) {
      // Find matching step by kind and node ID
      const matchingStep = source.steps.find(
        (s) => s.kind === "workflow_node" && (s.name === node.id || s.id === `wfnode:${node.id}` || s.id === node.id),
      );

      if (matchingStep) {
        const status = (matchingStep.status as WorkflowNodeStatus) || "pending";
        if (status === "running" || status === "ready") {
          activeSet.add(node.id);
        }
        nodeStates[node.id] = Object.freeze({
          status,
          ...(matchingStep.durationMs !== undefined ? { durationMs: matchingStep.durationMs } : {}),
          ...(matchingStep.error?.code !== undefined ? { errorCode: matchingStep.error.code } : {}),
          ...(typeof matchingStep.metadata?.skippedReason === "string" ? { skippedReason: matchingStep.metadata.skippedReason } : {}),
        });
      } else {
        nodeStates[node.id] = Object.freeze({ status: "pending" });
      }
    }

    activeNodeIds = Array.from(activeSet);
  } else {
    // Checkpoint source
    const checkpoint = source as WorkflowCheckpointValue;
    runId = checkpoint.runId;
    runStatus = checkpoint.status;
    activeNodeIds = [...(checkpoint.readyNodeIds ?? [])];

    for (const node of view.nodes) {
      const nodeCp = checkpoint.nodes?.[node.id];
      if (nodeCp) {
        nodeStates[node.id] = Object.freeze({
          status: nodeCp.status,
          ...(nodeCp.attempt !== undefined ? { attempt: nodeCp.attempt } : {}),
          ...(nodeCp.error?.code !== undefined ? { errorCode: nodeCp.error.code } : {}),
        });
      } else if (checkpoint.readyNodeIds?.includes(node.id)) {
        nodeStates[node.id] = Object.freeze({ status: "ready" });
      } else {
        nodeStates[node.id] = Object.freeze({ status: "pending" });
      }
    }
  }

  const nodes: WorkflowGraphRunNode[] = view.nodes.map((node) => {
    return Object.freeze({
      ...node,
      run: nodeStates[node.id],
    });
  });

  return Object.freeze({
    schemaVersion: 1 as const,
    workflowId: view.workflowId,
    revision: view.revision,
    definitionHash: view.definitionHash,
    runId,
    runStatus,
    activeNodeIds: Object.freeze(activeNodeIds),
    nodes: Object.freeze(nodes),
    edges: view.edges,
    nodeStates: Object.freeze(nodeStates),
  });
}

// ─── Incremental Run Folder (R-G4) ────────────────────────────────────────────

export function createWorkflowGraphRunFolder(view: WorkflowGraphView): WorkflowGraphRunFolder {
  let runId = "";
  let runStatus = "pending";
  const activeNodeIds = new Set<string>();
  const nodeStates = new Map<
    string,
    {
      status: WorkflowNodeStatus;
      startedAt?: string;
      durationMs?: number;
      attempt?: number;
      errorCode?: string | number;
      skippedReason?: string;
    }
  >();

  // Initialize all known nodes to pending
  for (const node of view.nodes) {
    nodeStates.set(node.id, { status: "pending" });
  }

  return {
    push(event: WorkflowEvent): void {
      if (!event || typeof event !== "object" || !("type" in event)) return;

      switch (event.type) {
        case "workflow_started": {
          runId = event.runId;
          runStatus = "running";
          break;
        }
        case "workflow_finished": {
          runStatus = event.status;
          activeNodeIds.clear();
          break;
        }
        case "workflow_suspended": {
          runStatus = "suspended";
          break;
        }
        case "workflow_resumed": {
          runStatus = "running";
          break;
        }
        case "node_started": {
          activeNodeIds.add(event.nodeId);
          let state = nodeStates.get(event.nodeId);
          if (!state) {
            state = { status: "running" };
            nodeStates.set(event.nodeId, state);
          }
          state.status = "running";
          state.startedAt = event.timestamp;
          state.attempt = (state.attempt ?? 0) + 1;
          break;
        }
        case "node_finished": {
          activeNodeIds.delete(event.nodeId);
          let state = nodeStates.get(event.nodeId);
          if (!state) {
            state = { status: "succeeded" };
            nodeStates.set(event.nodeId, state);
          }
          state.status = "succeeded";
          if (state.startedAt) {
            const start = Date.parse(state.startedAt);
            const end = Date.parse(event.timestamp);
            if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
              state.durationMs = end - start;
            }
          }
          break;
        }
        case "node_failed": {
          activeNodeIds.delete(event.nodeId);
          let state = nodeStates.get(event.nodeId);
          if (!state) {
            state = { status: "failed" };
            nodeStates.set(event.nodeId, state);
          }
          state.status = "failed";
          state.errorCode = event.error?.code;
          if (state.startedAt) {
            const start = Date.parse(state.startedAt);
            const end = Date.parse(event.timestamp);
            if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
              state.durationMs = end - start;
            }
          }
          break;
        }
        case "node_skipped": {
          activeNodeIds.delete(event.nodeId);
          let state = nodeStates.get(event.nodeId);
          if (!state) {
            state = { status: "skipped" };
            nodeStates.set(event.nodeId, state);
          }
          state.status = "skipped";
          if (event.reason) {
            state.skippedReason = event.reason;
          }
          break;
        }
        default:
          break;
      }
    },

    snapshot(): WorkflowGraphRunView {
      const frozenNodeStates: Record<string, WorkflowGraphNodeRunState> = {};
      for (const [id, state] of nodeStates.entries()) {
        frozenNodeStates[id] = Object.freeze({
          status: state.status,
          ...(state.durationMs !== undefined ? { durationMs: state.durationMs } : {}),
          ...(state.attempt !== undefined ? { attempt: state.attempt } : {}),
          ...(state.errorCode !== undefined ? { errorCode: state.errorCode } : {}),
          ...(state.skippedReason !== undefined ? { skippedReason: state.skippedReason } : {}),
        });
      }

      const nodes: WorkflowGraphRunNode[] = view.nodes.map((node) => {
        return Object.freeze({
          ...node,
          run: frozenNodeStates[node.id] ?? Object.freeze({ status: "pending" as WorkflowNodeStatus }),
        });
      });

      return Object.freeze({
        schemaVersion: 1 as const,
        workflowId: view.workflowId,
        revision: view.revision,
        definitionHash: view.definitionHash,
        runId,
        runStatus,
        activeNodeIds: Object.freeze(Array.from(activeNodeIds)),
        nodes: Object.freeze(nodes),
        edges: view.edges,
        nodeStates: Object.freeze(frozenNodeStates),
      });
    },
  };
}
