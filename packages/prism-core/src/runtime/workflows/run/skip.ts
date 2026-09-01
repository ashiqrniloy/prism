/** skip (0.2.5 plan 025 Task 1 split). Moved verbatim from run.ts; public surface unchanged behind the barrel. */
import type { WorkflowEventInput } from "../types.js";
import { nowIso } from "../util.js";
import type { SchedulerState } from "./main.js";

export function applyConditionalSkip(
  state: SchedulerState,
  nodeId: string,
  passed: boolean,
  emit: (event: WorkflowEventInput) => void,
): void {
  const node = state.workflow.nodes[nodeId];
  if (node?.kind !== "conditional") return;
  const successors = state.successors.get(nodeId) ?? [];
  const allowed = new Set(passed ? (node.then ?? successors) : (node.else ?? []));
  if (!passed && !node.else && !node.then) {
    // Default: skip all direct successors when false and no else/then configured.
    for (const next of successors) allowed.delete(next);
  }
  for (const next of successors) {
    if (!allowed.has(next)) {
      skipTransitive(state, next, `conditional ${nodeId} skipped`, emit);
    }
  }
}

function skipTransitive(state: SchedulerState, nodeId: string, reason: string, emit: (event: WorkflowEventInput) => void): void {
  if (state.skipped.has(nodeId) || state.completed.has(nodeId)) return;
  skipNode(state, nodeId, reason, emit);
  for (const next of state.successors.get(nodeId) ?? []) {
    // Only skip successor if all predecessors are completed/skipped and this path is the sole enabler —
    // for simplicity in v1: skip transitive only when every predecessor is skipped or the predecessor set is subset of skipped+current.
    const preds = state.predecessors.get(next) ?? [];
    if (preds.every((pred) => state.skipped.has(pred) || state.completed.has(pred))) {
      const allSkipped = preds.every((pred) => state.skipped.has(pred) || pred === nodeId);
      if (allSkipped && !state.completed.has(next)) {
        skipTransitive(state, next, reason, emit);
      }
    }
  }
}

export function skipNode(state: SchedulerState, nodeId: string, reason: string, emit: (event: WorkflowEventInput) => void): void {
  if (state.skipped.has(nodeId) || state.completed.has(nodeId)) return;
  const nodeState = state.nodes.get(nodeId);
  if (!nodeState) return;
  nodeState.status = "skipped";
  state.skipped.add(nodeId);
  state.completed.add(nodeId);
  state.ready = state.ready.filter((id) => id !== nodeId);
  emit({
    type: "node_skipped",
    workflowId: state.workflow.id,
    runId: state.runId,
    nodeId,
    reason,
    timestamp: nowIso(),
  });
  releaseSuccessors(state, nodeId, emit);
}

export function releaseSuccessors(state: SchedulerState, nodeId: string, emit: (event: WorkflowEventInput) => void): void {
  for (const next of state.successors.get(nodeId) ?? []) {
    if (state.skipped.has(next) || state.completed.has(next)) continue;
    const degree = Math.max(0, (state.remainingIndegree.get(next) ?? 0) - 1);
    state.remainingIndegree.set(next, degree);
    if (degree === 0) {
      // If all predecessors skipped and node not already marked, leave ready for execution
      // unless every predecessor was skipped AND node was marked skipped transitively.
      if (state.skipped.has(next)) continue;
      state.nodes.get(next)!.status = "ready";
      if (!state.ready.includes(next) && !state.running.has(next)) {
        state.ready.push(next);
        state.ready.sort((a, b) => a.localeCompare(b));
      }
    }
  }
  void emit;
}

export function markRemaining(state: SchedulerState, status: "aborted" | "skipped"): void {
  for (const [nodeId, node] of state.nodes) {
    if (node.status === "pending" || node.status === "ready" || node.status === "running") {
      node.status = status;
      state.completed.add(nodeId);
      if (status === "skipped") state.skipped.add(nodeId);
    }
  }
  state.ready = [];
}
