import { createSecretRedactor, type SecretRedactor } from "@arnilo/prism";
import { WorkflowCheckpointError } from "./errors.js";
import {
  DEFAULT_LIST_PAGE_SIZE,
  DEFAULT_MAX_CHECKPOINT_BYTES,
  DEFAULT_MAX_NODE_OUTPUT_BYTES,
  HARD_LIST_PAGE_CAP,
  HARD_MAX_CHECKPOINT_BYTES,
  HARD_MAX_NODE_OUTPUT_BYTES,
  validateWorkflowLimit,
  WORKFLOW_CHECKPOINT_SCHEMA_VERSION,
} from "./limits.js";
import type {
  WorkflowCheckpointAdapterOptions,
  WorkflowCheckpointRecord,
  WorkflowCheckpointSaveInput,
  WorkflowCheckpointValue,
  WorkflowRunStatus,
} from "./types.js";
import {
  assertWithinBytes,
  boundCheckpointValue,
  nowIso,
  ownershipMatches,
} from "./util.js";

export function resolveRedactor(
  options: WorkflowCheckpointAdapterOptions = {},
): SecretRedactor | undefined {
  if (options.redactor) return options.redactor;
  if (options.secrets?.some((secret) => Boolean(secret))) {
    return createSecretRedactor(options.secrets);
  }
  return undefined;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException(String(signal.reason ?? "Aborted"), "AbortError");
  }
}

export function resolveListLimit(limit?: number): number {
  return Math.min(Math.max(1, limit ?? DEFAULT_LIST_PAGE_SIZE), HARD_LIST_PAGE_CAP);
}

export function parseListOffsetCursor(cursor?: string): number {
  if (cursor === undefined) return 0;
  const offset = Number.parseInt(cursor, 10);
  if (!Number.isFinite(offset) || offset < 0) {
    throw new WorkflowCheckpointError("Invalid list cursor");
  }
  return offset;
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

export function assertOwnershipForSave(
  existing: WorkflowCheckpointRecord | null | undefined,
  input: WorkflowCheckpointSaveInput,
): void {
  if (existing?.ownership && input.ownership) {
    if (!ownershipMatches(existing.ownership, input.ownership)) {
      throw new WorkflowCheckpointError("Checkpoint ownership mismatch on save");
    }
  }
}

export function assertVersionAdvance(
  existing: WorkflowCheckpointRecord | null | undefined,
  version: number,
): void {
  if (existing && version <= existing.version) {
    throw new WorkflowCheckpointError(
      `Stale checkpoint version ${version} (current ${existing.version})`,
    );
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
  if (input.value.schemaVersion !== WORKFLOW_CHECKPOINT_SCHEMA_VERSION) {
    throw new WorkflowCheckpointError(
      `Unsupported checkpoint schemaVersion ${input.value.schemaVersion}`,
    );
  }
  for (const node of Object.values(input.value.nodes)) {
    if (node.output !== undefined) {
      assertWithinBytes(node.output, options.maxNodeOutputBytes, `Node ${node.nodeId} output`);
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
} {
  return {
    maxCheckpointBytes: validateWorkflowLimit(
      "maxCheckpointBytes",
      options.maxCheckpointBytes ?? DEFAULT_MAX_CHECKPOINT_BYTES,
      HARD_MAX_CHECKPOINT_BYTES,
    ),
    maxNodeOutputBytes: validateWorkflowLimit(
      "maxNodeOutputBytes",
      options.maxNodeOutputBytes ?? DEFAULT_MAX_NODE_OUTPUT_BYTES,
      HARD_MAX_NODE_OUTPUT_BYTES,
    ),
  };
}

export function parseCheckpointValue(raw: unknown): WorkflowCheckpointValue {
  if (typeof raw === "string") {
    return JSON.parse(raw) as WorkflowCheckpointValue;
  }
  if (raw && typeof raw === "object") {
    return raw as WorkflowCheckpointValue;
  }
  throw new WorkflowCheckpointError("Invalid checkpoint value payload");
}
