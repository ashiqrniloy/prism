import type { OwnershipScope } from "@arnilo/prism";
import { WorkflowCheckpointError, WorkflowRuntimeError } from "./errors.js";
import { exactOwnershipKey } from "./util.js";

/** In-process run registry. Durable adapters own persistence. */
export interface ActiveWorkflowRun {
  readonly workflowId: string;
  readonly runId: string;
  readonly ownership?: OwnershipScope;
  readonly definitionHash: string;
  readonly controller: AbortController;
  readonly startedAt: string;
}

const activeRuns = new Map<string, ActiveWorkflowRun>();

function keyOf(workflowId: string, runId: string, ownership?: OwnershipScope): string {
  return JSON.stringify([workflowId, runId, exactOwnershipKey(ownership)]);
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
  activeRuns.set(key, {
    ...input,
    ownership: input.ownership ? Object.freeze({ ...input.ownership }) : undefined,
    startedAt: new Date().toISOString(),
  });
}

export function unregisterActiveWorkflowRun(
  workflowId: string,
  runId: string,
  ownership?: OwnershipScope,
): void {
  activeRuns.delete(keyOf(workflowId, runId, ownership));
}

export function getActiveWorkflowRun(
  workflowId: string,
  runId: string,
  ownership?: OwnershipScope,
): ActiveWorkflowRun | undefined {
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

export function listActiveWorkflowRuns(filter: {
  readonly workflowId?: string;
  readonly ownership?: OwnershipScope;
} = {}): readonly ActiveWorkflowRun[] {
  return [...activeRuns.values()].filter((item) =>
    exactOwnershipKey(item.ownership) === exactOwnershipKey(filter.ownership)
    && (filter.workflowId === undefined || item.workflowId === filter.workflowId));
}
