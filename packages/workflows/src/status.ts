import { abortActiveWorkflowRun } from "./active-runs.js";
import {
  WorkflowAbortError,
  WorkflowCheckpointError,
  WorkflowRuntimeError,
} from "./errors.js";
import type {
  WorkflowCheckpointAdapter,
  WorkflowCheckpointListInput,
  WorkflowCheckpointListPage,
  WorkflowCheckpointLoadInput,
  WorkflowCheckpointRecord,
  WorkflowRunStatus,
} from "./types.js";
import type { OwnershipScope } from "@arnilo/prism";
import { nowIso, ownershipMatches } from "./util.js";

export async function getWorkflowRun(
  checkpoints: WorkflowCheckpointAdapter,
  input: WorkflowCheckpointLoadInput,
): Promise<WorkflowCheckpointRecord | null> {
  return checkpoints.load(input);
}

export async function listWorkflowRuns(
  checkpoints: WorkflowCheckpointAdapter,
  input: WorkflowCheckpointListInput = {},
): Promise<WorkflowCheckpointListPage> {
  if (!checkpoints.list) {
    throw new WorkflowCheckpointError("Checkpoint adapter does not support list()");
  }
  return checkpoints.list(input);
}

export interface CancelWorkflowRunInput {
  readonly workflowId: string;
  readonly runId: string;
  readonly checkpoints?: WorkflowCheckpointAdapter;
  readonly ownership?: OwnershipScope;
  readonly signal?: AbortSignal;
}

export interface CancelWorkflowRunResult {
  readonly aborted: boolean;
  readonly wasActive: boolean;
  readonly status?: WorkflowRunStatus;
}

/**
 * Cancel an in-process workflow run. If the run is not active but a durable
 * checkpoint still says `running`/`pending`, mark it `aborted` (orphaned resume).
 */
export async function cancelWorkflowRun(
  input: CancelWorkflowRunInput,
): Promise<CancelWorkflowRunResult> {
  const wasActive = abortActiveWorkflowRun(
    input.workflowId,
    input.runId,
    new WorkflowAbortError("Workflow cancelled"),
  );

  if (wasActive) {
    return { aborted: true, wasActive: true, status: "aborted" };
  }

  if (!input.checkpoints) {
    throw new WorkflowRuntimeError(
      `No active workflow run ${input.workflowId}/${input.runId}`,
      "ERR_PRISM_WORKFLOW_NOT_FOUND",
    );
  }

  const record = await input.checkpoints.load({
    workflowId: input.workflowId,
    runId: input.runId,
    ownership: input.ownership,
    signal: input.signal,
  });
  if (!record) {
    throw new WorkflowRuntimeError(
      `No workflow run ${input.workflowId}/${input.runId}`,
      "ERR_PRISM_WORKFLOW_NOT_FOUND",
    );
  }
  if (!ownershipMatches(input.ownership, record.ownership)) {
    throw new WorkflowCheckpointError("Checkpoint tenant/ownership mismatch");
  }

  if (record.value.status === "aborted") {
    return { aborted: true, wasActive: false, status: "aborted" };
  }
  if (record.value.status === "succeeded" || record.value.status === "failed") {
    return { aborted: false, wasActive: false, status: record.value.status };
  }

  if (record.fencingToken !== undefined && input.checkpoints.requestCancel) {
    await input.checkpoints.requestCancel({
      workflowId: input.workflowId,
      runId: input.runId,
      ownership: input.ownership,
      signal: input.signal,
    });
    return { aborted: true, wasActive: false, status: record.value.status };
  }

  const updatedAt = nowIso();
  await input.checkpoints.save({
    workflowId: record.workflowId,
    runId: record.runId,
    version: record.version + 1,
    expectedVersion: record.version,
    ownership: record.ownership,
    value: {
      ...record.value,
      status: "aborted",
      updatedAt,
    },
    signal: input.signal,
  });
  await input.checkpoints.clearCancelRequest?.({
    workflowId: record.workflowId,
    runId: record.runId,
    ownership: record.ownership,
    signal: input.signal,
  });

  return { aborted: true, wasActive: false, status: "aborted" };
}
