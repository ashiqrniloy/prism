/** scheduler (0.2.5 plan 025 Task 1 split). Moved verbatim from run.ts; public surface unchanged behind the barrel. */
import type { AgentSession } from "@arnilo/prism";
import { registerActiveWorkflowRun, unregisterActiveWorkflowRun } from "../active-runs.js";
import { WorkflowAbortError, WorkflowLoopLimitError, WorkflowRuntimeError } from "../errors.js";
import { createWorkflowEventBus } from "../events.js";
import { DEFAULT_MAX_CONCURRENCY, DEFAULT_MAX_NESTED_DEPTH, DEFAULT_MAX_NODES } from "../limits.js";
import type { RunWorkflowOptions, WorkflowEvent, WorkflowEventInput, WorkflowRunResult } from "../types.js";
import { combineSignals, errorCode, errorMessage, isAbortError, nowIso } from "../util.js";
import { cloneState, persistCheckpoint } from "./checkpoint.js";
import type { SchedulerState } from "./main.js";
import { runNode } from "./node-execution.js";
import { markRemaining, skipNode } from "./skip.js";
import { validateState } from "./validation.js";

export async function executeScheduler(state: SchedulerState, options: RunWorkflowOptions): Promise<WorkflowRunResult> {
  const runController = new AbortController();
  const signal = combineSignals([options.signal, runController.signal]);
  options = { ...options, signal };
  registerActiveWorkflowRun({
    workflowId: state.workflow.id,
    runId: state.runId,
    ownership: options.ownership,
    definitionHash: state.definitionHash,
    controller: runController,
  });

  try {
    return await executeSchedulerBody(state, options);
  } finally {
    unregisterActiveWorkflowRun(state.workflow.id, state.runId, options.ownership);
  }
}

async function executeSchedulerBody(state: SchedulerState, options: RunWorkflowOptions): Promise<WorkflowRunResult> {
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
  let settle: (() => void) | undefined;
  let pendingKick = false;
  const kick = () => {
    if (settle) {
      settle();
      settle = undefined;
      pendingKick = false;
      return;
    }
    pendingKick = true;
  };
  const waitForProgress = () => {
    if (pendingKick) {
      pendingKick = false;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      settle = resolve;
    });
  };

  const abortAllSessions = () => {
    for (const session of activeSessions.values()) {
      try {
        session.abort(options.signal?.reason ?? new WorkflowAbortError());
      } catch {
        // ignore
      }
    }
    kick();
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
      timestamp: nowIso(),
    });
  }

  await persistCheckpoint(state, options, emit);

  try {
    while ((state.ready.length > 0 || state.running.size > 0) && state.status === "running" && !fatalError) {
      while (state.ready.length > 0 && state.running.size < concurrency && state.status === "running") {
        const nodeId = state.ready.shift()!;
        if (state.skipped.has(nodeId) || state.completed.has(nodeId)) continue;
        state.running.add(nodeId);
        void runNode(state, nodeId, options, bus, emit, activeSessions)
          .catch((error) => {
            fatalError = error;
            state.status = isAbortError(error) || options.signal?.aborted ? "aborted" : "failed";
            abortAllSessions();
          })
          .finally(() => {
            state.running.delete(nodeId);
            kick();
          });
      }

      if (state.running.size === 0) break;
      if (options.signal?.aborted) {
        fatalError = new WorkflowAbortError();
        state.status = "aborted";
        abortAllSessions();
        break;
      }
      await waitForProgress();
    }

    while (state.running.size > 0) {
      await waitForProgress();
    }

    if (options.signal?.aborted || state.status === "aborted") {
      state.status = "aborted";
      markRemaining(state, "aborted");
    } else if (fatalError) {
      state.status = "failed";
      markRemaining(state, "aborted");
    } else if (state.status === "suspended" || state.status === "denied") {
      // Suspension and denial are already fully represented in the checkpoint.
    } else if ([...state.nodes.values()].some((node) => node.status === "failed")) {
      state.status = "failed";
    } else if ([...state.nodes.values()].every((node) => node.status === "succeeded" || node.status === "skipped")) {
      state.status = "succeeded";
    } else if (state.ready.length === 0 && state.running.size === 0) {
      // Stuck pending nodes imply unmet deps from skips — treat unresolved as skipped if all preds skipped/succeeded.
      for (const [nodeId, node] of state.nodes) {
        if (node.status === "pending" || node.status === "ready") {
          skipNode(state, nodeId, "unmet dependencies", emit);
        }
      }
      state.status = [...state.nodes.values()].some((node) => node.status === "failed") ? "failed" : "succeeded";
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
      const failed = [...state.nodes.values()].find((node) => node.status === "failed");
      throw new WorkflowRuntimeError(
        failed?.error?.message ?? errorMessage(fatalError) ?? "Workflow failed",
        failed?.error?.code ?? errorCode(fatalError) ?? "ERR_PRISM_WORKFLOW_FAILED",
      );
    }

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
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    if (ownedBus) bus.close();
  }
}
