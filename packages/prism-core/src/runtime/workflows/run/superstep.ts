/**
 * superstep (Plan 130 Task 3).
 * Wave-based superstep execution engine for cyclic workflow graphs and dynamic routing.
 */

import type { AgentSession } from "@arnilo/prism";
import { WorkflowAbortError, WorkflowLoopLimitError, WorkflowRuntimeError, WorkflowSuperstepLimitError } from "../errors.js";
import { createWorkflowEventBus } from "../events.js";
import { DEFAULT_MAX_CONCURRENCY, DEFAULT_MAX_NESTED_DEPTH, DEFAULT_MAX_NODES } from "../limits.js";
import type { RunWorkflowOptions, WorkflowEvent, WorkflowEventInput, WorkflowRunResult, WorkflowRunStatus } from "../types.js";
import { errorCode, errorMessage, isAbortError, nowIso } from "../util.js";
import { cloneState, isCheckpointFailure, persistCheckpoint } from "./checkpoint.js";
import type { SchedulerState } from "./main.js";
import { runNode } from "./node-execution.js";
import { markRemaining, skipNode } from "./skip.js";
import { validateState } from "./validation.js";

export async function executeSuperstepScheduler(state: SchedulerState, options: RunWorkflowOptions): Promise<WorkflowRunResult> {
  const workflowConcurrency = state.workflow.limits?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  const concurrency = Math.min(options.concurrency ?? workflowConcurrency, workflowConcurrency);
  const maxNodes = state.workflow.limits?.maxNodes ?? DEFAULT_MAX_NODES;
  const nestedDepth = options.nestedDepth ?? 0;
  const maxNestedDepth = Math.min(
    options.nestedDepthLimit ?? DEFAULT_MAX_NESTED_DEPTH,
    state.workflow.limits?.maxNestedDepth ?? DEFAULT_MAX_NESTED_DEPTH,
  );
  if (nestedDepth > maxNestedDepth) {
    throw new WorkflowRuntimeError(
      `Workflow exceeds maxNestedDepth (${nestedDepth} > ${maxNestedDepth})`,
      "ERR_PRISM_WORKFLOW_NESTED_DEPTH",
    );
  }
  await validateState(state, options);
  if (Object.keys(state.workflow.nodes).length > maxNodes) {
    throw new WorkflowRuntimeError(`Workflow exceeds maxNodes (${Object.keys(state.workflow.nodes).length} > ${maxNodes})`);
  }

  const ownedBus = !options.eventBus;
  const bus =
    options.eventBus ??
    createWorkflowEventBus({
      workflowId: state.workflow.id,
      runId: state.runId,
      signal: options.signal,
    });

  const emit = (event: WorkflowEventInput) => {
    bus.emit(event);
    const sequenced = { ...event, sequence: event.sequence ?? bus.sequence } as WorkflowEvent;
    options.onEvent?.(sequenced);
  };

  let fatalError: unknown;
  const activeSessions = new Map<string, AgentSession>();

  const abortAllSessions = () => {
    for (const session of activeSessions.values()) {
      try {
        session.abort(options.signal?.reason ?? new WorkflowAbortError());
      } catch {
        // ignore
      }
    }
  };

  const onAbort = () => {
    state.status = "aborted";
    abortAllSessions();
  };
  if (options.signal) {
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
  }

  emit({
    type: "workflow_started",
    workflowId: state.workflow.id,
    runId: state.runId,
    timestamp: nowIso(),
  });
  if (state.resume) {
    emit({
      type: "workflow_resumed",
      workflowId: state.workflow.id,
      runId: state.runId,
      resume: state.resume,
      ...(state.restore ? { restore: state.restore } : {}),
      timestamp: nowIso(),
    });
  }

  state.superstep ??= 0;
  state.pendingActivations ??= new Map();
  const maxSupersteps = state.workflow.limits?.maxSupersteps;

  await persistCheckpoint(state, options, emit);

  try {
    while (state.status === "running" && !fatalError) {
      if (options.signal?.aborted) {
        fatalError = new WorkflowAbortError();
        state.status = "aborted";
        abortAllSessions();
        break;
      }

      // If no nodes are ready for this wave, check if pending activations can trigger nodes
      if (state.ready.length === 0) {
        resolvePendingActivations(state);
      }

      // If still empty: idle drain completion
      if (state.ready.length === 0) {
        for (const [nodeId, node] of state.nodes) {
          if (node.status === "pending" || node.status === "ready") {
            skipNode(state, nodeId, "unmet dependencies", emit);
          }
        }
        state.ready = [];
        state.status = [...state.nodes.values()].some((node) => node.status === "failed") ? "failed" : "succeeded";
        break;
      }

      // Check budget before scheduling this wave
      if (maxSupersteps !== undefined && state.superstep >= maxSupersteps) {
        fatalError = new WorkflowSuperstepLimitError(state.superstep, maxSupersteps);
        state.status = "failed";
        markRemaining(state, "aborted");
        break;
      }

      // Prepare current wave
      const currentWave = [...state.ready];
      state.ready = [];

      // Execute current wave within concurrency worker pool
      let waveIndex = 0;
      const workerCount = Math.min(concurrency, currentWave.length);
      const workers: Promise<void>[] = [];

      const worker = async (): Promise<void> => {
        while (waveIndex < currentWave.length && state.status === "running" && !fatalError) {
          if (options.signal?.aborted) {
            fatalError = new WorkflowAbortError();
            state.status = "aborted";
            abortAllSessions();
            return;
          }
          const nodeId = currentWave[waveIndex++];
          if (!nodeId) break;
          state.running.add(nodeId);
          try {
            await runNode(state, nodeId, options, bus, emit, activeSessions);
          } catch (error) {
            if (!fatalError || isCheckpointFailure(error)) {
              fatalError = error;
              state.status = isAbortError(error) || options.signal?.aborted ? "aborted" : "failed";
              abortAllSessions();
            }
          } finally {
            state.running.delete(nodeId);
          }
        }
      };

      for (let i = 0; i < workerCount; i++) {
        workers.push(worker());
      }
      await Promise.all(workers);
      if (isCheckpointFailure(fatalError)) throw fatalError;

      // Check if suspended or denied
      const currentStatus = state.status as WorkflowRunStatus;
      if (currentStatus === "suspended" || currentStatus === "denied") {
        break;
      }

      if (options.signal?.aborted || currentStatus === "aborted") {
        state.status = "aborted";
        markRemaining(state, "aborted");
        break;
      }

      if (fatalError) {
        state.status = "failed";
        markRemaining(state, "aborted");
        break;
      }

      // Advance superstep counter
      state.superstep += 1;

      // Resolve pending activations for next wave
      resolvePendingActivations(state);

      // Wave barrier: persist checkpoint before reporting node completion.
      await persistCheckpoint(state, options, emit);
      for (const nodeId of currentWave) {
        const node = state.nodes.get(nodeId);
        if (node?.status === "succeeded") {
          emit({
            type: "node_finished",
            workflowId: state.workflow.id,
            runId: state.runId,
            nodeId,
            iteration: state.workflow.nodes[nodeId]?.kind === "loop" ? (node.iteration ?? 0) : (node.iteration ?? 1) - 1,
            timestamp: nowIso(),
          });
        }
      }
    }

    if (options.signal?.aborted || state.status === "aborted") {
      state.status = "aborted";
      markRemaining(state, "aborted");
    } else if (fatalError) {
      state.status = "failed";
      markRemaining(state, "aborted");
    }

    await persistCheckpoint(state, options, emit);

    if (state.status !== "suspended") {
      emit({
        type: "workflow_finished",
        workflowId: state.workflow.id,
        runId: state.runId,
        status: state.status,
        timestamp: nowIso(),
      });
    }

    if (state.status === "aborted") {
      if (fatalError instanceof WorkflowAbortError) throw fatalError;
      throw new WorkflowAbortError(fatalError instanceof Error ? fatalError.message : "Workflow aborted");
    }
    if (state.status === "failed") {
      if (fatalError instanceof WorkflowLoopLimitError) throw fatalError;
      if (fatalError instanceof WorkflowSuperstepLimitError) throw fatalError;
      const failed = [...state.nodes.values()].find((node) => node.status === "failed");
      throw new WorkflowRuntimeError(
        failed?.error?.message ?? errorMessage(fatalError) ?? "Workflow failed",
        failed?.error?.code ?? errorCode(fatalError) ?? "ERR_PRISM_WORKFLOW_FAILED",
      );
    }

    return formatResult(state);
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    if (ownedBus) bus.close();
  }
}

function resolvePendingActivations(state: SchedulerState): void {
  if (!state.pendingActivations) return;
  const nextReady: string[] = [];

  for (const [targetId, pending] of state.pendingActivations) {
    const targetNode = state.workflow.nodes[targetId];
    if (!targetNode) continue;
    const activation = targetNode.activation ?? "all";

    if (activation === "any") {
      if (pending.from.size > 0) {
        nextReady.push(targetId);
        pending.from.clear();
      }
    } else {
      const predecessors = state.predecessors.get(targetId) ?? [];
      if (predecessors.length > 0 && predecessors.every((p) => pending.from.has(p))) {
        nextReady.push(targetId);
        pending.from.clear();
      }
    }
  }

  for (const [targetId, pending] of state.pendingActivations) {
    if (pending.from.size === 0) {
      state.pendingActivations.delete(targetId);
    }
  }

  if (nextReady.length > 0) {
    nextReady.sort((a, b) => a.localeCompare(b));
    for (const id of nextReady) {
      const nodeState = state.nodes.get(id);
      if (nodeState) nodeState.status = "ready";
    }
    state.ready.push(...nextReady);
  }
}

function formatResult(state: SchedulerState): WorkflowRunResult {
  const outputs: Record<string, unknown> = {};
  for (const [nodeId, output] of state.outputs) outputs[nodeId] = output;
  return {
    workflowId: state.workflow.id,
    runId: state.runId,
    status: state.status,
    version: state.version,
    outputs,
    suspension: state.suspension,
    resume: state.resume,
    state: cloneState(state.state),
    lineage: state.lineage,
  };
}
