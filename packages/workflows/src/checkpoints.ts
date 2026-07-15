import {
  createMemoryCheckpointStore,
  type CheckpointRecord,
  type CheckpointStore,
  type SecretRedactor,
} from "@arnilo/prism";
import {
  adapterByteLimits,
  normalizeStatuses,
  parseCheckpointValue,
  prepareCheckpointRecord,
  resolveListLimit,
  resolveRedactor,
} from "./checkpoint-core.js";
import { WorkflowCheckpointError } from "./errors.js";
import type {
  WorkflowCheckpointAdapter,
  WorkflowCheckpointAdapterOptions,
  WorkflowCheckpointListInput,
  WorkflowCheckpointListPage,
  WorkflowCheckpointLoadInput,
  WorkflowCheckpointRecord,
} from "./types.js";
import { redactValue } from "./util.js";

const WORKFLOW_CHECKPOINT_NAMESPACE = "prism.workflow";
const WORKFLOW_CANCEL_NAMESPACE = "prism.workflow.cancel";

export interface GenericWorkflowCheckpointOptions extends WorkflowCheckpointAdapterOptions {
  readonly store: CheckpointStore;
}

/** Adapts Prism's generic core CheckpointStore to workflow checkpoint shapes. */
export function createWorkflowCheckpoints(
  options: GenericWorkflowCheckpointOptions,
): WorkflowCheckpointAdapter {
  const limits = adapterByteLimits(options);
  const redactor = resolveRedactor(options);

  return {
    async save(input): Promise<void> {
      const record = prepareCheckpointRecord(input, { ...limits, redactor });
      try {
        await options.store.saveCheckpoint({
          namespace: WORKFLOW_CHECKPOINT_NAMESPACE,
          key: encodeKey(input.workflowId, input.runId),
          version: input.version,
          expectedVersion: input.expectedVersion,
          fencingToken: input.fencingToken,
          value: record.value,
          category: record.value.status,
          ...input.ownership,
          signal: input.signal,
        });
      } catch (error) {
        throw asWorkflowCheckpointError(error);
      }
    },

    async load(input): Promise<WorkflowCheckpointRecord | null> {
      try {
        const record = await options.store.loadCheckpoint({
          namespace: WORKFLOW_CHECKPOINT_NAMESPACE,
          key: encodeKey(input.workflowId, input.runId),
          ...input.ownership,
          signal: input.signal,
        });
        return record ? toWorkflowRecord(record) : null;
      } catch (error) {
        throw asWorkflowCheckpointError(error);
      }
    },

    async list(input: WorkflowCheckpointListInput = {}): Promise<WorkflowCheckpointListPage> {
      const statuses = normalizeStatuses(input.status);
      try {
        const page = await options.store.listCheckpoints({
          namespace: WORKFLOW_CHECKPOINT_NAMESPACE,
          keyPrefix: input.workflowId === undefined ? undefined : `${encodeURIComponent(input.workflowId)}/`,
          category: statuses ? [...statuses] : undefined,
          ...input.ownership,
          cursor: input.cursor,
          limit: resolveListLimit(input.limit),
          signal: input.signal,
        });
        return { items: page.items.map(toWorkflowRecord), nextCursor: page.nextCursor };
      } catch (error) {
        throw asWorkflowCheckpointError(error);
      }
    },

    async delete(input: WorkflowCheckpointLoadInput): Promise<boolean> {
      try {
        return await options.store.deleteCheckpoint({
          namespace: WORKFLOW_CHECKPOINT_NAMESPACE,
          key: encodeKey(input.workflowId, input.runId),
          ...input.ownership,
          signal: input.signal,
        });
      } catch (error) {
        throw asWorkflowCheckpointError(error);
      }
    },

    async requestCancel(input: WorkflowCheckpointLoadInput): Promise<void> {
      const key = encodeKey(input.workflowId, input.runId);
      try {
        const current = await options.store.loadCheckpoint({ namespace: WORKFLOW_CANCEL_NAMESPACE, key, ...input.ownership, signal: input.signal });
        try {
          await options.store.saveCheckpoint({
            namespace: WORKFLOW_CANCEL_NAMESPACE, key,
            version: (current?.version ?? 0) + 1,
            expectedVersion: current?.version ?? 0,
            value: { requested: true }, category: "requested",
            ...input.ownership, signal: input.signal,
          });
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ERR_PRISM_CHECKPOINT_CONFLICT")
            || !(await options.store.loadCheckpoint({ namespace: WORKFLOW_CANCEL_NAMESPACE, key, ...input.ownership, signal: input.signal }))) throw error;
        }
      } catch (error) {
        throw asWorkflowCheckpointError(error);
      }
    },

    async isCancelRequested(input: WorkflowCheckpointLoadInput): Promise<boolean> {
      try {
        return Boolean(await options.store.loadCheckpoint({
          namespace: WORKFLOW_CANCEL_NAMESPACE, key: encodeKey(input.workflowId, input.runId),
          ...input.ownership, signal: input.signal,
        }));
      } catch (error) {
        throw asWorkflowCheckpointError(error);
      }
    },

    async clearCancelRequest(input: WorkflowCheckpointLoadInput): Promise<void> {
      try {
        await options.store.deleteCheckpoint({
          namespace: WORKFLOW_CANCEL_NAMESPACE, key: encodeKey(input.workflowId, input.runId),
          ...input.ownership, signal: input.signal,
        });
      } catch (error) {
        throw asWorkflowCheckpointError(error);
      }
    },
  };
}

/** In-process workflow adapter backed by core's generic reference store. */
export function createMemoryWorkflowCheckpoints(
  options: WorkflowCheckpointAdapterOptions = {},
): WorkflowCheckpointAdapter {
  return createWorkflowCheckpoints({ ...options, store: createMemoryCheckpointStore() });
}

function encodeKey(workflowId: string, runId: string): string {
  return `${encodeURIComponent(workflowId)}/${encodeURIComponent(runId)}`;
}

function decodeKey(key: string): readonly [string, string] {
  const separator = key.indexOf("/");
  if (separator < 1 || separator === key.length - 1) {
    throw new WorkflowCheckpointError("Invalid generic workflow checkpoint key");
  }
  return [decodeURIComponent(key.slice(0, separator)), decodeURIComponent(key.slice(separator + 1))];
}

function toWorkflowRecord(record: CheckpointRecord): WorkflowCheckpointRecord {
  const [workflowId, runId] = decodeKey(record.key);
  return {
    workflowId,
    runId,
    version: record.version,
    ...(record.fencingToken === undefined ? {} : { fencingToken: record.fencingToken }),
    ownership: {
      ...(record.tenantId === undefined ? {} : { tenantId: record.tenantId }),
      ...(record.accountId === undefined ? {} : { accountId: record.accountId }),
      ...(record.userId === undefined ? {} : { userId: record.userId }),
    },
    value: parseCheckpointValue(record.value),
    updatedAt: record.updatedAt,
  };
}

function asWorkflowCheckpointError(error: unknown): unknown {
  if (error instanceof WorkflowCheckpointError) return error;
  if (error instanceof Error && "code" in error && error.code === "ERR_PRISM_CHECKPOINT_CONFLICT") {
    return new WorkflowCheckpointError(error.message);
  }
  return error;
}

export function redactCheckpointOutputs(
  value: WorkflowCheckpointRecord["value"],
  redactor?: SecretRedactor,
): WorkflowCheckpointRecord["value"] {
  if (!redactor) return value;
  const nodes: Record<string, (typeof value.nodes)[string]> = {};
  for (const [id, node] of Object.entries(value.nodes)) {
    nodes[id] = node.output === undefined
      ? node
      : { ...node, output: redactValue(node.output, redactor) };
  }
  return {
    ...value,
    nodes,
    workflowInput: value.workflowInput === undefined
      ? value.workflowInput
      : redactValue(value.workflowInput, redactor),
    redacted: true,
  };
}

export { WorkflowCheckpointError };
