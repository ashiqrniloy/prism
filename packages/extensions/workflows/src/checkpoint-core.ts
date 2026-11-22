import { type SecretRedactor } from "@arnilo/prism";
import { WorkflowCheckpointError } from "./errors.js";
import {
  DEFAULT_LIST_PAGE_SIZE,
  DEFAULT_MAX_CHECKPOINT_BYTES,
  DEFAULT_MAX_LIST_LIMIT,
  DEFAULT_MAX_NODE_OUTPUT_BYTES,
  validateWorkflowLimit,
  WORKFLOW_CHECKPOINT_SCHEMA_VERSION,
  WORKFLOW_LOOP_ITERATION_SCHEMA_VERSION,
} from "./limits.js";
import type {
  WorkflowCheckpointAdapterOptions,
  WorkflowCheckpointRecord,
  WorkflowCheckpointSaveInput,
  WorkflowCheckpointValue,
  WorkflowNodeCheckpoint,
  WorkflowRunStatus,
} from "./types.js";
import { assertWithinBytes, boundCheckpointValue, nowIso, ownershipMatches } from "./util.js";

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException(String(signal.reason ?? "Aborted"), "AbortError");
  }
}

export function resolveListLimit(limit?: number, maxListLimit = DEFAULT_MAX_LIST_LIMIT): number {
  return Math.min(Math.max(1, limit ?? DEFAULT_LIST_PAGE_SIZE), maxListLimit);
}

export function normalizeStatuses(
  status: WorkflowRunStatus | readonly WorkflowRunStatus[] | undefined,
): Set<WorkflowRunStatus> | undefined {
  if (!status) return undefined;
  return new Set(Array.isArray(status) ? status : [status]);
}

export function assertOwnershipForLoad(
  expected: WorkflowCheckpointSaveInput["ownership"] | undefined,
  actual: WorkflowCheckpointRecord["ownership"] | undefined,
): void {
  if (!ownershipMatches(expected, actual)) {
    throw new WorkflowCheckpointError("Checkpoint tenant/ownership mismatch");
  }
}

export function assertOwnershipForSave(existing: WorkflowCheckpointRecord | null | undefined, input: WorkflowCheckpointSaveInput): void {
  if (existing?.ownership && input.ownership) {
    if (!ownershipMatches(existing.ownership, input.ownership)) {
      throw new WorkflowCheckpointError("Checkpoint ownership mismatch on save");
    }
  }
}

export function assertVersionAdvance(existing: WorkflowCheckpointRecord | null | undefined, version: number): void {
  if (existing && version <= existing.version) {
    throw new WorkflowCheckpointError(`Stale checkpoint version ${version} (current ${existing.version})`);
  }
}

export function prepareCheckpointRecord(
  input: WorkflowCheckpointSaveInput,
  options: {
    readonly maxCheckpointBytes: number;
    readonly maxNodeOutputBytes: number;
    readonly redactor?: SecretRedactor;
  },
): WorkflowCheckpointRecord {
  throwIfAborted(input.signal);
  if (input.value.schemaVersion < 1 || input.value.schemaVersion > WORKFLOW_CHECKPOINT_SCHEMA_VERSION) {
    throw new WorkflowCheckpointError(`Unsupported checkpoint schemaVersion ${input.value.schemaVersion}`);
  }
  for (const node of Object.values(input.value.nodes)) {
    validateLoopCheckpointFields(node, options.maxNodeOutputBytes);
    if (node.output !== undefined) {
      assertWithinBytes(node.output, options.maxNodeOutputBytes, `Node ${node.nodeId} output`);
    }
    if (node.lastOutput !== undefined) {
      assertWithinBytes(node.lastOutput, options.maxNodeOutputBytes, `Node ${node.nodeId} last output`);
    }
  }

  const redactedValue = boundCheckpointValue(input.value, {
    maxCheckpointBytes: options.maxCheckpointBytes,
    redactor: options.redactor,
  }) as WorkflowCheckpointValue;

  const updatedAt = nowIso();
  return {
    workflowId: input.workflowId,
    runId: input.runId,
    version: input.version,
    ownership: input.ownership,
    value: {
      ...redactedValue,
      redacted: Boolean(options.redactor) || redactedValue.redacted,
      updatedAt,
    },
    updatedAt,
  };
}

export function adapterByteLimits(options: WorkflowCheckpointAdapterOptions = {}): {
  readonly maxCheckpointBytes: number;
  readonly maxNodeOutputBytes: number;
  readonly maxListLimit: number;
} {
  return {
    maxCheckpointBytes: validateWorkflowLimit("maxCheckpointBytes", options.maxCheckpointBytes ?? DEFAULT_MAX_CHECKPOINT_BYTES),
    maxNodeOutputBytes: validateWorkflowLimit("maxNodeOutputBytes", options.maxNodeOutputBytes ?? DEFAULT_MAX_NODE_OUTPUT_BYTES),
    maxListLimit: validateWorkflowLimit("maxListLimit", options.maxListLimit ?? DEFAULT_MAX_LIST_LIMIT),
  };
}

export function parseCheckpointValue(raw: unknown, maxNodeOutputBytes = DEFAULT_MAX_NODE_OUTPUT_BYTES): WorkflowCheckpointValue {
  const value =
    typeof raw === "string"
      ? (JSON.parse(raw) as WorkflowCheckpointValue)
      : raw && typeof raw === "object"
        ? (raw as WorkflowCheckpointValue)
        : undefined;
  if (!value?.nodes || typeof value.nodes !== "object" || Array.isArray(value.nodes)) {
    throw new WorkflowCheckpointError("Invalid checkpoint value payload");
  }
  if (value.schemaVersion !== undefined) {
    if (value.schemaVersion < 1 || value.schemaVersion > WORKFLOW_CHECKPOINT_SCHEMA_VERSION) {
      throw new WorkflowCheckpointError(`Unsupported checkpoint schemaVersion ${value.schemaVersion}`);
    }
  }
  for (const node of Object.values(value.nodes)) {
    validateLoopCheckpointFields(node, maxNodeOutputBytes);
  }
  return value;
}

function validateLoopCheckpointFields(node: WorkflowNodeCheckpoint, maxNodeOutputBytes: number): void {
  if (!node || typeof node !== "object") throw new WorkflowCheckpointError("Malformed workflow node checkpoint");
  if (node.iteration !== undefined && (!Number.isSafeInteger(node.iteration) || node.iteration < 0)) {
    throw new WorkflowCheckpointError(`Node ${node.nodeId} has an invalid loop iteration count`);
  }
  if (node.iterations === undefined) return;
  // The record count follows the node's own `maxIterations`; the checkpoint as a whole is bounded by `maxCheckpointBytes`.
  if (!Array.isArray(node.iterations)) {
    throw new WorkflowCheckpointError(`Node ${node.nodeId} has malformed loop iteration records`);
  }
  // `WorkflowLimits.maxIterationRecords` keeps only the newest records, so the ledger may start past 0.
  const first = (node.iteration ?? node.iterations.length) - node.iterations.length;
  for (const [index, iteration] of node.iterations.entries()) {
    if (
      !iteration ||
      typeof iteration !== "object" ||
      iteration.schemaVersion !== WORKFLOW_LOOP_ITERATION_SCHEMA_VERSION ||
      typeof iteration.iterationId !== "string" ||
      typeof iteration.done !== "boolean" ||
      iteration.iterationId.length === 0
    ) {
      throw new WorkflowCheckpointError(`Node ${node.nodeId} has malformed loop iteration record`);
    }
    if (iteration.iteration !== first + index) {
      throw new WorkflowCheckpointError(`Node ${node.nodeId} loop iteration count does not match its records`);
    }
    if (iteration.output !== undefined) {
      assertWithinBytes(iteration.output, maxNodeOutputBytes, `Node ${node.nodeId} iteration ${index} output`);
    }
  }
  if (node.iteration === undefined || first < 0) {
    throw new WorkflowCheckpointError(`Node ${node.nodeId} loop iteration count does not match its records`);
  }
}
