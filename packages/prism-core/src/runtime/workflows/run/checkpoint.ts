/** checkpoint (0.2.5 plan 025 Task 1 split). Moved verbatim from run.ts; public surface unchanged behind the barrel. */
import type { JsonObject } from "@arnilo/prism";
import { WorkflowCheckpointError } from "../errors.js";
import { WORKFLOW_CHECKPOINT_SCHEMA_VERSION } from "../limits.js";
import type {
  RunWorkflowOptions,
  WorkflowCheckpointRecord,
  WorkflowCheckpointValue,
  WorkflowEventInput,
  WorkflowNodeCheckpoint,
  WorkflowRunResult,
  WorkflowSuspension,
} from "../types.js";
import { nowIso } from "../util.js";
import type { SchedulerState } from "./main.js";

export async function persistCheckpoint(
  state: SchedulerState,
  options: RunWorkflowOptions,
  emit: (event: WorkflowEventInput) => void,
): Promise<void> {
  if (!options.checkpoints) return;
  if (options.checkpointGuard && !options.checkpointGuard()) {
    throw new WorkflowCheckpointError("Workflow lease lost; checkpoint write fenced");
  }
  const expectedVersion = state.version;
  state.version += 1;
  const version = state.version;
  const nodes: Record<string, WorkflowNodeCheckpoint> = {};
  for (const [nodeId, node] of state.nodes) {
    nodes[nodeId] = {
      nodeId,
      status: node.status,
      output: node.output,
      error: node.error,
      attempt: node.attempt,
      sessionId: node.sessionId,
      leafId: node.leafId,
      runId: node.runId,
      stateVersionBefore: node.stateVersionBefore,
      iteration: node.iteration,
      lastOutput: node.lastOutput,
      iterations: node.iterations?.map((iteration) => ({ ...iteration })),
    };
  }
  const value: WorkflowCheckpointValue = {
    schemaVersion: WORKFLOW_CHECKPOINT_SCHEMA_VERSION,
    workflowId: state.workflow.id,
    runId: state.runId,
    definitionHash: state.definitionHash,
    status: state.status,
    readyNodeIds: [...state.ready].sort((a, b) => a.localeCompare(b)),
    completedNodeIds: [...state.completed].sort((a, b) => a.localeCompare(b)),
    nodes,
    workflowInput: state.workflowInput,
    createdAt: state.createdAt,
    updatedAt: nowIso(),
    redacted: Boolean(options.redactor),
    suspension: state.suspension,
    resume: state.resume,
    state: cloneState(state.state),
    stateVersion: state.stateVersion,
    stateHistory: Object.fromEntries([...state.stateHistory].map(([version, value]) => [String(version), cloneState(value)])),
    lineage: state.lineage,
    metadata: options.metadata,
  };
  // Terminal writes must land even when the run signal is already aborted
  // (cancel finalization / durable aborted status for resume).
  const terminal = state.status === "succeeded" || state.status === "failed" || state.status === "aborted";
  const operation = state.checkpointChain
    .catch(() => undefined)
    .then(async () => {
      try {
        await options.checkpoints!.save({
          workflowId: state.workflow.id,
          runId: state.runId,
          version,
          expectedVersion,
          fencingToken: options.fencingToken,
          ownership: options.ownership,
          value,
          signal: terminal ? undefined : options.signal,
        });
      } catch (error) {
        state.version = expectedVersion;
        throw error;
      }
      emit({
        type: "checkpoint_saved",
        workflowId: state.workflow.id,
        runId: state.runId,
        version,
        timestamp: nowIso(),
      });
    });
  state.checkpointChain = operation.catch(() => undefined);
  await operation;
}

export function isWorkflowSuspension(value: unknown): value is WorkflowSuspension {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in value &&
      value.type === "workflow_suspend" &&
      "reason" in value &&
      typeof value.reason === "string",
  );
}

export function resultFromRecord(workflowId: string, record: WorkflowCheckpointRecord): WorkflowRunResult {
  const outputs: Record<string, unknown> = {};
  for (const [nodeId, node] of Object.entries(record.value.nodes)) {
    if (node.status === "succeeded" && node.output !== undefined) outputs[nodeId] = node.output;
  }
  return {
    workflowId,
    runId: record.runId,
    status: record.value.status,
    version: record.version,
    outputs,
    suspension: record.value.suspension,
    resume: record.value.resume,
    state: cloneState(record.value.state ?? {}),
    lineage: record.value.lineage,
  };
}

export function cloneState(value: JsonObject): JsonObject {
  return structuredClone(value);
}

export function parseStateHistory(history: Readonly<Record<string, JsonObject>> | undefined, current: JsonObject): Map<number, JsonObject> {
  const parsed = new Map<number, JsonObject>();
  for (const [key, value] of Object.entries(history ?? {})) {
    const version = Number(key);
    if (Number.isSafeInteger(version) && version >= 0) parsed.set(version, cloneState(value));
  }
  if (parsed.size === 0) parsed.set(0, cloneState(current));
  return parsed;
}
