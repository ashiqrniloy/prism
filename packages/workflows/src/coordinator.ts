import type { LeaseRecord, LeaseStore, OwnershipScope } from "@arnilo/prism";
import { buildGraph } from "./define.js";
import { WorkflowAbortError, WorkflowRuntimeError } from "./errors.js";
import { WORKFLOW_CHECKPOINT_SCHEMA_VERSION } from "./limits.js";
import { resumeWorkflow } from "./run.js";
import type {
  RunWorkflowOptions,
  WorkflowCheckpointAdapter,
  WorkflowDefinition,
  WorkflowNodeCheckpoint,
  WorkflowRunResult,
} from "./types.js";
import { combineSignals, createRunId, hashWorkflowDefinition, nowIso } from "./util.js";

const WORKFLOW_LEASE_NAMESPACE = "prism.workflow.run";

export interface EnqueueWorkflowOptions {
  readonly checkpoints: WorkflowCheckpointAdapter;
  readonly runId?: string;
  readonly ownership?: OwnershipScope;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export async function enqueueWorkflow(
  workflow: WorkflowDefinition,
  input: unknown,
  options: EnqueueWorkflowOptions,
): Promise<{ readonly workflowId: string; readonly runId: string; readonly status: "queued" }> {
  const runId = options.runId ?? createRunId();
  const graph = buildGraph(workflow);
  const readyNodeIds = [...graph.indegree].filter(([, degree]) => degree === 0).map(([id]) => id).sort();
  const nodes: Record<string, WorkflowNodeCheckpoint> = {};
  for (const nodeId of Object.keys(workflow.nodes)) {
    nodes[nodeId] = { nodeId, status: readyNodeIds.includes(nodeId) ? "ready" : "pending" };
  }
  const timestamp = nowIso();
  const state = JSON.parse(JSON.stringify(workflow.state?.initial ?? {})) as import("@arnilo/prism").JsonObject;
  await options.checkpoints.save({
    workflowId: workflow.id,
    runId,
    version: 1,
    expectedVersion: 0,
    ownership: options.ownership,
    signal: options.signal,
    value: {
      schemaVersion: WORKFLOW_CHECKPOINT_SCHEMA_VERSION,
      workflowId: workflow.id,
      runId,
      definitionHash: hashWorkflowDefinition(workflow),
      status: "queued",
      readyNodeIds,
      completedNodeIds: [],
      nodes,
      workflowInput: input,
      createdAt: timestamp,
      updatedAt: timestamp,
      redacted: false,
      state,
      stateVersion: 0,
      stateHistory: { "0": state },
      metadata: options.metadata,
    },
  });
  return { workflowId: workflow.id, runId, status: "queued" };
}

/** Explicit background start; durable coordinator execution remains opt-in. */
export const startWorkflowBackground = enqueueWorkflow;

export interface WorkflowCoordinatorOptions {
  readonly coordinatorId: string;
  readonly workflows: Readonly<Record<string, WorkflowDefinition>> | ((workflowId: string) => WorkflowDefinition | undefined | Promise<WorkflowDefinition | undefined>);
  readonly checkpoints: WorkflowCheckpointAdapter;
  readonly leases: LeaseStore;
  readonly ownership?: OwnershipScope;
  readonly runOptions?: Omit<RunWorkflowOptions, "checkpoints" | "runId" | "fencingToken" | "checkpointGuard" | "ownership">;
  readonly leaseTtlMs?: number;
  readonly renewalIntervalMs?: number;
  readonly pollIntervalMs?: number;
  readonly maxConcurrentRuns?: number;
  readonly pageSize?: number;
  readonly onResult?: (result: WorkflowRunResult) => void;
  readonly onError?: (error: unknown, run: { readonly workflowId: string; readonly runId: string }) => void;
}

export interface WorkflowCoordinator {
  pollOnce(): Promise<number>;
  run(input: { readonly signal: AbortSignal }): Promise<void>;
  readonly activeRuns: number;
}

export function createWorkflowCoordinator(options: WorkflowCoordinatorOptions): WorkflowCoordinator {
  const leaseTtlMs = integer(options.leaseTtlMs ?? 30_000, "leaseTtlMs");
  const renewalIntervalMs = integer(options.renewalIntervalMs ?? Math.max(1, Math.floor(leaseTtlMs / 3)), "renewalIntervalMs");
  const pollIntervalMs = integer(options.pollIntervalMs ?? 1_000, "pollIntervalMs");
  const maxConcurrentRuns = integer(options.maxConcurrentRuns ?? 4, "maxConcurrentRuns");
  const pageSize = Math.min(integer(options.pageSize ?? 100, "pageSize"), 500);
  if (renewalIntervalMs >= leaseTtlMs) throw new WorkflowRuntimeError("renewalIntervalMs must be less than leaseTtlMs");
  if (!options.coordinatorId) throw new WorkflowRuntimeError("coordinatorId is required");
  const active = new Map<string, Promise<void>>();

  const pollOnce = async (): Promise<number> => {
    const available = maxConcurrentRuns - active.size;
    if (available <= 0) return 0;
    if (!options.checkpoints.list) throw new WorkflowRuntimeError("Distributed coordinator requires checkpoint list()");
    const page = await options.checkpoints.list({
      ownership: options.ownership,
      status: ["queued", "running"],
      limit: pageSize,
    });
    let claimed = 0;
    for (const record of page.items) {
      if (active.size >= maxConcurrentRuns) break;
      const id = `${record.workflowId}\0${record.runId}`;
      if (active.has(id)) continue;
      const lease = await options.leases.tryAcquireLease({
        namespace: WORKFLOW_LEASE_NAMESPACE,
        key: leaseKey(record.workflowId, record.runId),
        ownerId: options.coordinatorId,
        ttlMs: leaseTtlMs,
        ...options.ownership,
      });
      if (!lease) continue;
      const job = executeClaim(record.workflowId, record.runId, lease)
        .catch((error) => options.onError?.(error, { workflowId: record.workflowId, runId: record.runId }))
        .finally(() => active.delete(id));
      active.set(id, job);
      claimed += 1;
    }
    return claimed;
  };

  const executeClaim = async (workflowId: string, runId: string, lease: LeaseRecord): Promise<void> => {
    const workflow = typeof options.workflows === "function"
      ? await options.workflows(workflowId)
      : options.workflows[workflowId];
    if (!workflow) {
      await release(lease);
      options.onError?.(new WorkflowRuntimeError(`Unknown queued workflow ${workflowId}`), { workflowId, runId });
      return;
    }
    const controller = new AbortController();
    let ownsLease = true;
    let stopped = false;
    const heartbeatController = new AbortController();
    const heartbeat = async () => {
      while (!stopped) {
        await delay(renewalIntervalMs, heartbeatController.signal);
        if (stopped) break;
        try {
          if (await options.checkpoints.isCancelRequested?.({ workflowId, runId, ownership: options.ownership })) {
            controller.abort(new WorkflowAbortError("Workflow cancellation requested"));
            break;
          }
          const renewed = await options.leases.renewLease({
            namespace: lease.namespace, key: lease.key, ownerId: lease.ownerId, token: lease.token,
            ttlMs: leaseTtlMs, ...options.ownership,
          });
          if (!renewed) {
            ownsLease = false;
            controller.abort(new WorkflowRuntimeError("Workflow lease lost", "ERR_PRISM_WORKFLOW_LEASE_LOST"));
            break;
          }
        } catch (error) {
          ownsLease = false;
          controller.abort(error);
          break;
        }
      }
    };
    const heartbeatPromise = heartbeat();
    try {
      if (await options.checkpoints.isCancelRequested?.({ workflowId, runId, ownership: options.ownership })) {
        controller.abort(new WorkflowAbortError("Workflow cancellation requested"));
      }
      const result = await resumeWorkflow(workflow, { workflowId, runId }, {
        ...options.runOptions,
        checkpoints: options.checkpoints,
        ownership: options.ownership,
        fencingToken: lease.fencingToken,
        checkpointGuard: () => ownsLease,
        signal: combineSignals([options.runOptions?.signal, controller.signal]),
      });
      options.onResult?.(result);
    } catch (error) {
      options.onError?.(error, { workflowId, runId });
    } finally {
      stopped = true;
      heartbeatController.abort();
      await heartbeatPromise;
      if (ownsLease) {
        await release(lease);
        await options.checkpoints.clearCancelRequest?.({ workflowId, runId, ownership: options.ownership });
      }
    }
  };

  const release = (lease: LeaseRecord) => options.leases.releaseLease({
    namespace: lease.namespace, key: lease.key, ownerId: lease.ownerId, token: lease.token,
    ...options.ownership,
  });

  return {
    pollOnce,
    async run({ signal }) {
      while (!signal.aborted) {
        await pollOnce();
        await delay(pollIntervalMs, signal);
      }
      await Promise.allSettled(active.values());
    },
    get activeRuns() { return active.size; },
  };
}

function leaseKey(workflowId: string, runId: string): string {
  return `${encodeURIComponent(workflowId)}/${encodeURIComponent(runId)}`;
}
function integer(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new WorkflowRuntimeError(`${name} must be a positive safe integer`);
  return value;
}
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() { signal?.removeEventListener("abort", done); clearTimeout(timer); resolve(); }
    signal?.addEventListener("abort", done, { once: true });
  });
}
