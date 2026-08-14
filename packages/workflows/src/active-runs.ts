import type { OwnershipScope } from "@arnilo/prism";
import { WorkflowCheckpointError, WorkflowRuntimeError } from "./errors.js";
import { exactOwnershipKey } from "./util.js";

/**
 * In-process, non-durable active-run registry (single process only — does not
 * survive restart; durable active-run recovery is a later milestone). Bounded
 * lifecycle: `registerActiveWorkflowRun` sweeps aborted/leaked entries on every
 * insert and fails closed at `MAX_ACTIVE_WORKFLOW_RUNS`; hosts can also call
 * `sweepActiveWorkflowRuns()` explicitly. Durable adapters own persistence.
 */
export interface ActiveWorkflowRun {
  readonly workflowId: string;
  readonly runId: string;
  readonly ownership?: OwnershipScope;
  readonly definitionHash: string;
  readonly controller: AbortController;
  readonly startedAt: string;
}

/** Cap on concurrent in-process run registrations (parallel to the A2A task registry cap 512). */
export const MAX_ACTIVE_WORKFLOW_RUNS = 512;

export const ACTIVE_WORKFLOW_RUNS_OVERFLOW_CODE = "ERR_PRISM_WORKFLOW_RUN_REGISTRY_OVERFLOW";

const activeRuns = new Map<string, ActiveWorkflowRun>();

function keyOf(workflowId: string, runId: string, ownership?: OwnershipScope): string {
  return JSON.stringify([workflowId, runId, exactOwnershipKey(ownership)]);
}

/** Removes registrations whose run was aborted but never unregistered (leaked), oldest first. */
export function sweepActiveWorkflowRuns(): number {
  let removed = 0;
  for (const [key, run] of activeRuns) {
    if (run.controller.signal.aborted) {
      activeRuns.delete(key);
      removed += 1;
    }
  }
  return removed;
}

export function registerActiveWorkflowRun(input: {
  readonly workflowId: string;
  readonly runId: string;
  readonly ownership?: OwnershipScope;
  readonly definitionHash: string;
  readonly controller: AbortController;
}): void {
  const key = keyOf(input.workflowId, input.runId, input.ownership);
  if (activeRuns.has(key)) {
    throw new WorkflowRuntimeError("Workflow run is already active", "ERR_PRISM_WORKFLOW_ALREADY_ACTIVE");
  }
  // Bounded lifecycle: a run whose promise never settles leaks its registration
  // forever (the finally-unregister never runs), so every register sweeps aborted
  // entries first; if the cap is still reached the registry fails closed rather
  // than evicting a live entry (which would allow a duplicate concurrent run).
  sweepActiveWorkflowRuns();
  if (activeRuns.size >= MAX_ACTIVE_WORKFLOW_RUNS) {
    throw new WorkflowRuntimeError(
      `Active workflow run registry is full (${MAX_ACTIVE_WORKFLOW_RUNS}); abort or await leaked runs first`,
      ACTIVE_WORKFLOW_RUNS_OVERFLOW_CODE,
    );
  }
  activeRuns.set(key, {
    ...input,
    ownership: input.ownership ? Object.freeze({ ...input.ownership }) : undefined,
    startedAt: new Date().toISOString(),
  });
}

export function unregisterActiveWorkflowRun(workflowId: string, runId: string, ownership?: OwnershipScope): void {
  activeRuns.delete(keyOf(workflowId, runId, ownership));
}

export function getActiveWorkflowRun(workflowId: string, runId: string, ownership?: OwnershipScope): ActiveWorkflowRun | undefined {
  return activeRuns.get(keyOf(workflowId, runId, ownership));
}

/** Returns true when the exact owned in-process run was aborted. */
export function abortActiveWorkflowRun(
  workflowId: string,
  runId: string,
  ownership: OwnershipScope | undefined,
  definitionHash: string,
  reason: unknown = new Error("Workflow cancelled"),
): boolean {
  const active = getActiveWorkflowRun(workflowId, runId, ownership);
  if (!active) return false;
  if (active.definitionHash !== definitionHash) {
    throw new WorkflowCheckpointError("Workflow definition hash mismatch on cancel");
  }
  if (!active.controller.signal.aborted) active.controller.abort(reason);
  return true;
}

export function listActiveWorkflowRuns(
  filter: { readonly workflowId?: string; readonly ownership?: OwnershipScope } = {},
): readonly ActiveWorkflowRun[] {
  return [...activeRuns.values()].filter(
    (item) =>
      exactOwnershipKey(item.ownership) === exactOwnershipKey(filter.ownership) &&
      (filter.workflowId === undefined || item.workflowId === filter.workflowId),
  );
}
