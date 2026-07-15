/**
 * In-process registry of active workflow runs for cancel/status.
 * Durable adapters own persistence; this map only covers the current process.
 */

export interface ActiveWorkflowRun {
  readonly workflowId: string;
  readonly runId: string;
  readonly controller: AbortController;
  readonly startedAt: string;
}

const activeRuns = new Map<string, ActiveWorkflowRun>();

function keyOf(workflowId: string, runId: string): string {
  return `${workflowId}::${runId}`;
}

export function registerActiveWorkflowRun(input: {
  readonly workflowId: string;
  readonly runId: string;
  readonly controller: AbortController;
}): void {
  activeRuns.set(keyOf(input.workflowId, input.runId), {
    workflowId: input.workflowId,
    runId: input.runId,
    controller: input.controller,
    startedAt: new Date().toISOString(),
  });
}

export function unregisterActiveWorkflowRun(workflowId: string, runId: string): void {
  activeRuns.delete(keyOf(workflowId, runId));
}

export function getActiveWorkflowRun(
  workflowId: string,
  runId: string,
): ActiveWorkflowRun | undefined {
  return activeRuns.get(keyOf(workflowId, runId));
}

/** Returns true when an in-process run was aborted. */
export function abortActiveWorkflowRun(
  workflowId: string,
  runId: string,
  reason: unknown = new Error("Workflow cancelled"),
): boolean {
  const active = activeRuns.get(keyOf(workflowId, runId));
  if (!active) return false;
  if (!active.controller.signal.aborted) {
    active.controller.abort(reason);
  }
  return true;
}

export function listActiveWorkflowRuns(filter?: {
  readonly workflowId?: string;
}): readonly ActiveWorkflowRun[] {
  const items = [...activeRuns.values()];
  if (!filter?.workflowId) return items;
  return items.filter((item) => item.workflowId === filter.workflowId);
}
