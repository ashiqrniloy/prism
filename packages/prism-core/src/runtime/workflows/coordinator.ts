import type { LeaseRecord, LeaseStore, OwnershipScope } from "@arnilo/prism";
import { buildGraph } from "./define.js";
import { WorkflowAbortError, WorkflowRuntimeError } from "./errors.js";
import {
  DEFAULT_ADMISSION_PAGES,
  HARD_ADMISSION_PAGES,
  HARD_LIST_PAGE_CAP,
  HARD_MAX_CONCURRENCY,
  validateWorkflowLimit,
  WORKFLOW_CHECKPOINT_SCHEMA_VERSION,
} from "./limits.js";
import { resumeWorkflow } from "./run.js";
import type {
  RunWorkflowOptions,
  WorkflowCheckpointAdapter,
  WorkflowCheckpointRecord,
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
  const readyNodeIds = [...graph.indegree]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id)
    .sort();
  const nodes: Record<string, WorkflowNodeCheckpoint> = {};
  for (const nodeId of Object.keys(workflow.nodes)) {
    nodes[nodeId] = { nodeId, status: readyNodeIds.includes(nodeId) ? "ready" : "pending" };
  }
  const timestamp = nowIso();
  const state = structuredClone(workflow.state?.initial ?? {}) as import("@arnilo/prism").JsonObject;
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

/** Duck-typed drain so workflows does not import the server package. */
export interface WorkflowAdmissionDrain {
  readonly isDraining: boolean;
  snapshot(): { readonly draining: boolean; readonly expired?: boolean; readonly deadlineAt?: string };
}

export interface WorkflowAdmissionMetric {
  readonly outcome: "claimed" | "skipped_quota" | "skipped_lease" | "skipped_deadline" | "skipped_drain" | "skipped_active";
  /** Allowlisted `metadata.workloadClass`, else `default` / `other`. Never tenant or run ids. */
  readonly class: string;
}

export interface WorkflowAdmissionPolicy {
  /** Max concurrent claimed runs per tenant on this worker. */
  readonly perTenant?: number;
  /** Max concurrent claimed runs per workload class on this worker. */
  readonly perClass?: number;
  /** Skip claiming runs whose `createdAt` is older than this. */
  readonly deadlineMs?: number;
  readonly clock?: () => number;
  readonly drain?: WorkflowAdmissionDrain;
  /** List pages scanned per `pollOnce`. Default 4, hard 16. */
  readonly maxPagesPerPoll?: number;
  readonly onMetric?: (event: WorkflowAdmissionMetric) => void;
}

export interface WorkflowCoordinatorOptions {
  readonly coordinatorId: string;
  readonly workflows:
    | Readonly<Record<string, WorkflowDefinition>>
    | ((workflowId: string) => WorkflowDefinition | undefined | Promise<WorkflowDefinition | undefined>);
  readonly checkpoints: WorkflowCheckpointAdapter;
  readonly leases: LeaseStore;
  readonly ownership?: OwnershipScope;
  readonly runOptions?: Omit<RunWorkflowOptions, "checkpoints" | "runId" | "fencingToken" | "checkpointGuard" | "ownership">;
  readonly leaseTtlMs?: number;
  readonly renewalIntervalMs?: number;
  readonly pollIntervalMs?: number;
  readonly maxConcurrentRuns?: number;
  readonly pageSize?: number;
  readonly admission?: WorkflowAdmissionPolicy;
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
  const maxConcurrentRuns = validateWorkflowLimit("maxConcurrentRuns", options.maxConcurrentRuns ?? 4, HARD_MAX_CONCURRENCY);
  const pageSize = validateWorkflowLimit("pageSize", options.pageSize ?? 100, HARD_LIST_PAGE_CAP);
  const admission = options.admission ?? {};
  const maxPagesPerPoll = validateWorkflowLimit(
    "maxPagesPerPoll",
    admission.maxPagesPerPoll ?? DEFAULT_ADMISSION_PAGES,
    HARD_ADMISSION_PAGES,
  );
  if (admission.perTenant !== undefined) validateWorkflowLimit("perTenant", admission.perTenant, HARD_MAX_CONCURRENCY);
  if (admission.perClass !== undefined) validateWorkflowLimit("perClass", admission.perClass, HARD_MAX_CONCURRENCY);
  if (admission.deadlineMs !== undefined) integer(admission.deadlineMs, "deadlineMs");
  if (renewalIntervalMs >= leaseTtlMs) throw new WorkflowRuntimeError("renewalIntervalMs must be less than leaseTtlMs");
  if (!options.coordinatorId) throw new WorkflowRuntimeError("coordinatorId is required");
  const clock = admission.clock ?? Date.now;
  const active = new Map<string, { readonly tenant: string; readonly class: string; readonly job: Promise<void> }>();
  let listCursor: string | undefined;

  const metric = (outcome: WorkflowAdmissionMetric["outcome"], className = "default") => {
    admission.onMetric?.({ outcome, class: className });
  };

  const pollOnce = async (): Promise<number> => {
    if (admission.drain?.isDraining) {
      metric("skipped_drain");
      return 0;
    }
    if (active.size >= maxConcurrentRuns) return 0;
    if (!options.checkpoints.list) throw new WorkflowRuntimeError("Distributed coordinator requires checkpoint list()");
    let claimed = 0;
    let pages = 0;
    let wrapped = false;
    const origin = listCursor;
    while (pages < maxPagesPerPoll && active.size < maxConcurrentRuns) {
      const page = await options.checkpoints.list({
        ownership: options.ownership,
        status: ["queued", "running"],
        limit: pageSize,
        cursor: listCursor,
      });
      pages += 1;
      for (const record of page.items) {
        if (active.size >= maxConcurrentRuns) break;
        const id = `${record.workflowId}\0${record.runId}`;
        const className = workloadClass(record);
        if (active.has(id)) {
          metric("skipped_active", className);
          continue;
        }
        if (pastDeadline(record, admission.deadlineMs, clock())) {
          metric("skipped_deadline", className);
          continue;
        }
        const tenant = tenantKey(record);
        if (admission.perTenant !== undefined && countActive("tenant", tenant) >= admission.perTenant) {
          metric("skipped_quota", className);
          continue;
        }
        if (admission.perClass !== undefined && countActive("class", className) >= admission.perClass) {
          metric("skipped_quota", className);
          continue;
        }
        const runOwnership = ownershipFor(record, options.ownership);
        const lease = await options.leases.tryAcquireLease({
          namespace: WORKFLOW_LEASE_NAMESPACE,
          key: leaseKey(record.workflowId, record.runId),
          ownerId: options.coordinatorId,
          ttlMs: leaseTtlMs,
          ...runOwnership,
        });
        if (!lease) {
          metric("skipped_lease", className);
          continue;
        }
        const job = executeClaim(record.workflowId, record.runId, lease, runOwnership)
          .catch((error) => options.onError?.(error, { workflowId: record.workflowId, runId: record.runId }))
          .finally(() => active.delete(id));
        active.set(id, { tenant, class: className, job });
        metric("claimed", className);
        claimed += 1;
      }
      if (page.nextCursor) {
        listCursor = page.nextCursor;
      } else {
        listCursor = undefined;
        if (wrapped || origin === undefined) break;
        wrapped = true;
      }
    }
    return claimed;
  };

  const countActive = (axis: "tenant" | "class", value: string): number => {
    let n = 0;
    for (const entry of active.values()) {
      if ((axis === "tenant" ? entry.tenant : entry.class) === value) n += 1;
    }
    return n;
  };

  const executeClaim = async (
    workflowId: string,
    runId: string,
    lease: LeaseRecord,
    runOwnership: OwnershipScope | undefined,
  ): Promise<void> => {
    const workflow = typeof options.workflows === "function" ? await options.workflows(workflowId) : options.workflows[workflowId];
    if (!workflow) {
      await release(lease, runOwnership);
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
          if (admission.drain?.snapshot().expired) {
            controller.abort(new WorkflowAbortError("Workflow drain deadline expired"));
            break;
          }
          if (await options.checkpoints.isCancelRequested?.({ workflowId, runId, ownership: runOwnership })) {
            controller.abort(new WorkflowAbortError("Workflow cancellation requested"));
            break;
          }
          const renewed = await options.leases.renewLease({
            namespace: lease.namespace,
            key: lease.key,
            ownerId: lease.ownerId,
            token: lease.token,
            ttlMs: leaseTtlMs,
            ...runOwnership,
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
      if (await options.checkpoints.isCancelRequested?.({ workflowId, runId, ownership: runOwnership })) {
        controller.abort(new WorkflowAbortError("Workflow cancellation requested"));
      }
      const result = await resumeWorkflow(
        workflow,
        { workflowId, runId },
        {
          ...options.runOptions,
          checkpoints: options.checkpoints,
          ownership: runOwnership,
          fencingToken: lease.fencingToken,
          checkpointGuard: () => ownsLease,
          signal: combineSignals([options.runOptions?.signal, controller.signal]),
        },
      );
      options.onResult?.(result);
    } catch (error) {
      options.onError?.(error, { workflowId, runId });
    } finally {
      stopped = true;
      heartbeatController.abort();
      await heartbeatPromise;
      if (ownsLease) {
        await release(lease, runOwnership);
        await options.checkpoints.clearCancelRequest?.({ workflowId, runId, ownership: runOwnership });
      }
    }
  };

  const release = (lease: LeaseRecord, runOwnership: OwnershipScope | undefined) =>
    options.leases.releaseLease({
      namespace: lease.namespace,
      key: lease.key,
      ownerId: lease.ownerId,
      token: lease.token,
      ...runOwnership,
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
    get activeRuns() {
      return active.size;
    },
  };
}

function leaseKey(workflowId: string, runId: string): string {
  return `${encodeURIComponent(workflowId)}/${encodeURIComponent(runId)}`;
}

const CLASS_RE = /^[a-z][a-z0-9_-]{0,31}$/;

function workloadClass(record: WorkflowCheckpointRecord): string {
  const raw = record.value.metadata?.workloadClass;
  if (typeof raw !== "string" || !CLASS_RE.test(raw)) return "default";
  return raw;
}

function tenantKey(record: WorkflowCheckpointRecord): string {
  return record.ownership?.tenantId ?? "_";
}

function ownershipFor(record: WorkflowCheckpointRecord, fallback?: OwnershipScope): OwnershipScope | undefined {
  const ownership = record.ownership;
  if (ownership && (ownership.tenantId || ownership.accountId || ownership.userId)) return ownership;
  return fallback;
}

function pastDeadline(record: WorkflowCheckpointRecord, deadlineMs: number | undefined, now: number): boolean {
  if (deadlineMs === undefined) return false;
  const created = Date.parse(record.value.createdAt);
  return Number.isFinite(created) && now - created > deadlineMs;
}
function integer(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new WorkflowRuntimeError(`${name} must be a positive safe integer`);
  return value;
}
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
