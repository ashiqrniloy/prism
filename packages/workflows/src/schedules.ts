import {
  createSecretRedactor,
  type CheckpointRecord,
  type CheckpointStore,
  type LeaseStore,
  type OwnershipScope,
  type SecretRedactor,
} from "@arnilo/prism";
import { createHash } from "node:crypto";
import { WorkflowCheckpointError, WorkflowRuntimeError } from "./errors.js";
import {
  DEFAULT_MAX_SCHEDULE_CLAIMS,
  DEFAULT_MAX_SCHEDULE_INPUT_BYTES,
  DEFAULT_SCHEDULE_LEASE_TTL_MS,
  DEFAULT_SCHEDULE_PAGE_SIZE,
  DEFAULT_SCHEDULE_POLL_INTERVAL_MS,
  HARD_MAX_SCHEDULE_CLAIMS,
  HARD_MAX_SCHEDULE_INPUT_BYTES,
  HARD_SCHEDULE_PAGE_CAP,
} from "./limits.js";
import { enqueueWorkflow } from "./coordinator.js";
import type {
  WorkflowCheckpointAdapter,
  WorkflowDefinition,
  WorkflowRunHandle,
} from "./types.js";
import { assertWithinBytes, nowIso, redactValue, sleep } from "./util.js";

const SCHEDULE_NAMESPACE = "prism.workflow.schedule";
const SCHEDULE_LEASE_NAMESPACE = "prism.workflow.schedule.fire";

export type WorkflowScheduleStatus = "active" | "paused" | "completed";

export interface WorkflowScheduleRecord {
  readonly id: string;
  readonly workflowId: string;
  readonly status: WorkflowScheduleStatus;
  readonly input?: unknown;
  readonly nextRunAt: string;
  readonly intervalMs?: number;
  readonly calculatorId?: string;
  readonly lastRunAt?: string;
  readonly lastRunId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly version: number;
}

export interface CreateWorkflowScheduleInput {
  readonly id: string;
  readonly workflowId: string;
  readonly nextRunAt: string | Date;
  readonly input?: unknown;
  readonly intervalMs?: number;
  readonly calculatorId?: string;
  readonly paused?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface WorkflowScheduleListInput {
  readonly status?: WorkflowScheduleStatus | readonly WorkflowScheduleStatus[];
  readonly cursor?: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface WorkflowScheduleListPage {
  readonly items: readonly WorkflowScheduleRecord[];
  readonly nextCursor?: string;
}

export interface WorkflowScheduleCalculatorInput {
  readonly schedule: WorkflowScheduleRecord;
  readonly firedAt: string;
  readonly signal?: AbortSignal;
}

export type WorkflowScheduleCalculator = (
  input: WorkflowScheduleCalculatorInput,
) => string | Date | null | Promise<string | Date | null>;

export type WorkflowScheduleEvent =
  | { readonly type: "schedule_fired"; readonly scheduleId: string; readonly workflowId: string; readonly runId: string; readonly firedAt: string }
  | { readonly type: "schedule_failed"; readonly scheduleId: string; readonly workflowId: string; readonly error: string; readonly timestamp: string };

export interface CreateWorkflowSchedulesOptions {
  readonly store: CheckpointStore;
  readonly leases: LeaseStore;
  readonly checkpoints: WorkflowCheckpointAdapter;
  readonly workflows: Readonly<Record<string, WorkflowDefinition>> | ((workflowId: string) => WorkflowDefinition | undefined | Promise<WorkflowDefinition | undefined>);
  readonly ownership: OwnershipScope;
  readonly ownerId: string;
  readonly calculators?: Readonly<Record<string, WorkflowScheduleCalculator>>;
  readonly redactor?: SecretRedactor;
  readonly secrets?: readonly (string | undefined)[];
  readonly maxInputBytes?: number;
  readonly maxClaimsPerPoll?: number;
  readonly pageSize?: number;
  readonly pollIntervalMs?: number;
  readonly leaseTtlMs?: number;
  readonly onEvent?: (event: WorkflowScheduleEvent) => void;
}

export interface WorkflowSchedules {
  readonly ownership: OwnershipScope;
  create(input: CreateWorkflowScheduleInput, signal?: AbortSignal): Promise<WorkflowScheduleRecord>;
  get(id: string, signal?: AbortSignal): Promise<WorkflowScheduleRecord | null>;
  list(input?: WorkflowScheduleListInput): Promise<WorkflowScheduleListPage>;
  pause(id: string, signal?: AbortSignal): Promise<WorkflowScheduleRecord>;
  resume(id: string, nextRunAt?: string | Date, signal?: AbortSignal): Promise<WorkflowScheduleRecord>;
  trigger(id: string, input: { readonly idempotencyKey: string; readonly signal?: AbortSignal }): Promise<WorkflowRunHandle>;
  delete(id: string, signal?: AbortSignal): Promise<boolean>;
  pollOnce(input?: { readonly now?: Date; readonly signal?: AbortSignal }): Promise<number>;
  run(input: { readonly signal: AbortSignal }): Promise<void>;
}

/** Explicit durable schedule facade over generic checkpoint and lease stores. */
export function createWorkflowSchedules(options: CreateWorkflowSchedulesOptions): WorkflowSchedules {
  requireOwnership(options.ownership);
  requireId(options.ownerId, "ownerId");
  const redactor = options.redactor ?? (options.secrets?.some(Boolean) ? createSecretRedactor(options.secrets) : undefined);
  const maxInputBytes = capped(options.maxInputBytes ?? DEFAULT_MAX_SCHEDULE_INPUT_BYTES, HARD_MAX_SCHEDULE_INPUT_BYTES, "maxInputBytes");
  const maxClaims = capped(options.maxClaimsPerPoll ?? DEFAULT_MAX_SCHEDULE_CLAIMS, HARD_MAX_SCHEDULE_CLAIMS, "maxClaimsPerPoll");
  const pageSize = capped(options.pageSize ?? DEFAULT_SCHEDULE_PAGE_SIZE, HARD_SCHEDULE_PAGE_CAP, "pageSize");
  const pollIntervalMs = positive(options.pollIntervalMs ?? DEFAULT_SCHEDULE_POLL_INTERVAL_MS, "pollIntervalMs");
  const leaseTtlMs = positive(options.leaseTtlMs ?? DEFAULT_SCHEDULE_LEASE_TTL_MS, "leaseTtlMs");

  const resolveWorkflow = async (workflowId: string): Promise<WorkflowDefinition> => {
    const workflow = typeof options.workflows === "function"
      ? await options.workflows(workflowId)
      : options.workflows[workflowId];
    if (!workflow) throw new WorkflowRuntimeError(`Unknown scheduled workflow ${workflowId}`, "ERR_PRISM_WORKFLOW_NOT_FOUND");
    return workflow;
  };

  const get = async (id: string, signal?: AbortSignal): Promise<WorkflowScheduleRecord | null> => {
    requireId(id, "schedule id");
    const record = await options.store.loadCheckpoint({ namespace: SCHEDULE_NAMESPACE, key: id, ...options.ownership, signal });
    return record ? parseRecord(record) : null;
  };

  const save = async (
    value: Omit<WorkflowScheduleRecord, "version">,
    expectedVersion: number,
    signal?: AbortSignal,
  ): Promise<WorkflowScheduleRecord> => {
    if (value.input !== undefined) assertWithinBytes(value.input, maxInputBytes, "Schedule input");
    const safe = redactValue(value, redactor);
    assertWithinBytes(safe, maxInputBytes + 64 * 1024, "Schedule record");
    const record = await options.store.saveCheckpoint({
      namespace: SCHEDULE_NAMESPACE,
      key: value.id,
      version: expectedVersion + 1,
      expectedVersion,
      value: safe,
      category: value.status,
      ...options.ownership,
      signal,
    });
    return parseRecord(record);
  };

  const withScheduleLease = async <T>(
    id: string,
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ): Promise<T> => {
    const lease = await options.leases.tryAcquireLease({
      namespace: SCHEDULE_LEASE_NAMESPACE,
      key: id,
      ownerId: options.ownerId,
      ttlMs: leaseTtlMs,
      ...options.ownership,
      signal,
    });
    if (!lease) throw new WorkflowRuntimeError(`Schedule ${id} is busy`, "ERR_PRISM_WORKFLOW_SCHEDULE_BUSY");
    try {
      return await operation();
    } finally {
      await options.leases.releaseLease({
        namespace: lease.namespace, key: lease.key, ownerId: lease.ownerId, token: lease.token, ...options.ownership,
      });
    }
  };

  const mutate = (
    id: string,
    signal: AbortSignal | undefined,
    update: (record: WorkflowScheduleRecord) => Omit<WorkflowScheduleRecord, "version">,
  ): Promise<WorkflowScheduleRecord> => withScheduleLease(id, signal, async () => {
    const current = await get(id, signal);
    if (!current) throw new WorkflowCheckpointError(`Unknown schedule ${id}`);
    return save(update(current), current.version, signal);
  });

  const enqueueIdempotent = async (
    schedule: WorkflowScheduleRecord,
    runId: string,
    signal?: AbortSignal,
  ): Promise<WorkflowRunHandle> => {
    const workflow = await resolveWorkflow(schedule.workflowId);
    try {
      const queued = await enqueueWorkflow(workflow, schedule.input, {
        checkpoints: options.checkpoints,
        runId,
        ownership: options.ownership,
        metadata: { scheduleId: schedule.id, scheduled: true },
        signal,
      });
      return { ...queued, version: 1 };
    } catch (error) {
      const existing = await options.checkpoints.load({ workflowId: workflow.id, runId, ownership: options.ownership, signal });
      if (!existing) throw error;
      return { workflowId: workflow.id, runId, status: existing.value.status, version: existing.version };
    }
  };

  const fire = async (candidate: WorkflowScheduleRecord, now: Date, signal?: AbortSignal): Promise<boolean> => {
    const fireAt = candidate.nextRunAt;
    const lease = await options.leases.tryAcquireLease({
      namespace: SCHEDULE_LEASE_NAMESPACE,
      key: candidate.id,
      ownerId: options.ownerId,
      ttlMs: leaseTtlMs,
      ...options.ownership,
      signal,
    });
    if (!lease) return false;
    try {
      const current = await get(candidate.id, signal);
      if (!current || current.status !== "active" || current.version !== candidate.version || current.nextRunAt !== fireAt || Date.parse(fireAt) > now.getTime()) return false;
      const runId = scheduledRunId(current.id, fireAt);
      await enqueueIdempotent(current, runId, signal);
      const nextRunAt = await calculateNext(current, now, options.calculators, signal);
      await save({
        ...withoutVersion(current),
        status: nextRunAt ? "active" : "completed",
        nextRunAt: nextRunAt ?? current.nextRunAt,
        lastRunAt: now.toISOString(),
        lastRunId: runId,
        updatedAt: nowIso(),
      }, current.version, signal);
      options.onEvent?.({ type: "schedule_fired", scheduleId: current.id, workflowId: current.workflowId, runId, firedAt: now.toISOString() });
      return true;
    } finally {
      await options.leases.releaseLease({
        namespace: lease.namespace,
        key: lease.key,
        ownerId: lease.ownerId,
        token: lease.token,
        ...options.ownership,
      });
    }
  };

  return {
    ownership: { ...options.ownership },
    async create(input, signal) {
      requireId(input.id, "schedule id");
      requireId(input.workflowId, "workflowId");
      await resolveWorkflow(input.workflowId);
      if (input.intervalMs !== undefined && input.calculatorId !== undefined) {
        throw new WorkflowRuntimeError("Schedule cannot declare both intervalMs and calculatorId", "ERR_PRISM_WORKFLOW_SCHEDULE");
      }
      if (input.intervalMs !== undefined) positive(input.intervalMs, "intervalMs");
      if (input.calculatorId !== undefined && !options.calculators?.[input.calculatorId]) {
        throw new WorkflowRuntimeError(`Unknown schedule calculator ${input.calculatorId}`, "ERR_PRISM_WORKFLOW_SCHEDULE");
      }
      const timestamp = nowIso();
      return save({
        id: input.id,
        workflowId: input.workflowId,
        status: input.paused ? "paused" : "active",
        input: input.input,
        nextRunAt: toIso(input.nextRunAt, "nextRunAt"),
        intervalMs: input.intervalMs,
        calculatorId: input.calculatorId,
        createdAt: timestamp,
        updatedAt: timestamp,
        metadata: input.metadata,
      }, 0, signal);
    },
    get,
    async list(input = {}) {
      const limit = capped(input.limit ?? pageSize, HARD_SCHEDULE_PAGE_CAP, "limit");
      const page = await options.store.listCheckpoints({
        namespace: SCHEDULE_NAMESPACE,
        category: input.status,
        ...options.ownership,
        cursor: input.cursor,
        limit,
        signal: input.signal,
      });
      return { items: page.items.map(parseRecord), nextCursor: page.nextCursor };
    },
    pause(id, signal) {
      return mutate(id, signal, (record) => {
        if (record.status === "completed") throw new WorkflowRuntimeError("Completed schedule cannot be paused", "ERR_PRISM_WORKFLOW_SCHEDULE");
        return { ...withoutVersion(record), status: "paused", updatedAt: nowIso() };
      });
    },
    resume(id, nextRunAt, signal) {
      return mutate(id, signal, (record) => {
        if (record.status === "completed" && nextRunAt === undefined) {
          throw new WorkflowRuntimeError("Completed schedule resume requires nextRunAt", "ERR_PRISM_WORKFLOW_SCHEDULE");
        }
        return {
          ...withoutVersion(record),
          status: "active",
          nextRunAt: nextRunAt === undefined ? record.nextRunAt : toIso(nextRunAt, "nextRunAt"),
          updatedAt: nowIso(),
        };
      });
    },
    async trigger(id, input) {
      requireId(input.idempotencyKey, "idempotencyKey");
      return withScheduleLease(id, input.signal, async () => {
        const record = await get(id, input.signal);
        if (!record) throw new WorkflowCheckpointError(`Unknown schedule ${id}`);
        return enqueueIdempotent(record, manualRunId(record.id, input.idempotencyKey), input.signal);
      });
    },
    async delete(id, signal) {
      requireId(id, "schedule id");
      return withScheduleLease(id, signal, () => options.store.deleteCheckpoint({ namespace: SCHEDULE_NAMESPACE, key: id, ...options.ownership, signal }));
    },
    async pollOnce(input = {}) {
      const now = input.now ?? new Date();
      if (!Number.isFinite(now.getTime())) throw new WorkflowRuntimeError("Invalid poll time", "ERR_PRISM_WORKFLOW_SCHEDULE");
      // ponytail: one bounded page per poll; raise pageSize (hard 500) or shard ownership if schedule volume grows.
      const page = await options.store.listCheckpoints({
        namespace: SCHEDULE_NAMESPACE,
        category: "active",
        ...options.ownership,
        limit: pageSize,
        signal: input.signal,
      });
      const due = page.items.map(parseRecord)
        .filter((record) => Date.parse(record.nextRunAt) <= now.getTime())
        .sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt) || a.id.localeCompare(b.id))
        .slice(0, maxClaims);
      let fired = 0;
      for (const schedule of due) {
        try {
          if (await fire(schedule, now, input.signal)) fired += 1;
        } catch (error) {
          if (input.signal?.aborted) throw error;
          options.onEvent?.({
            type: "schedule_failed",
            scheduleId: schedule.id,
            workflowId: schedule.workflowId,
            error: redactValue(error instanceof Error ? error.message : String(error), redactor),
            timestamp: nowIso(),
          });
        }
      }
      return fired;
    },
    async run({ signal }) {
      while (!signal.aborted) {
        try {
          await this.pollOnce({ signal });
        } catch (error) {
          if (!signal.aborted) throw error;
          break;
        }
        try {
          await sleep(pollIntervalMs, signal);
        } catch (error) {
          if (!signal.aborted) throw error;
        }
      }
    },
  };
}

function parseRecord(record: CheckpointRecord): WorkflowScheduleRecord {
  if (!record.value || typeof record.value !== "object" || Array.isArray(record.value)) {
    throw new WorkflowCheckpointError("Invalid schedule record");
  }
  const value = record.value as Omit<WorkflowScheduleRecord, "version">;
  requireId(value.id, "schedule id");
  requireId(value.workflowId, "workflowId");
  if (!["active", "paused", "completed"].includes(value.status)) throw new WorkflowCheckpointError("Invalid schedule status");
  toIso(value.nextRunAt, "nextRunAt");
  return { ...value, version: record.version };
}

function withoutVersion(record: WorkflowScheduleRecord): Omit<WorkflowScheduleRecord, "version"> {
  const { version: _version, ...value } = record;
  return value;
}

async function calculateNext(
  schedule: WorkflowScheduleRecord,
  now: Date,
  calculators?: Readonly<Record<string, WorkflowScheduleCalculator>>,
  signal?: AbortSignal,
): Promise<string | null> {
  if (schedule.intervalMs !== undefined) {
    const next = Math.max(Date.parse(schedule.nextRunAt) + schedule.intervalMs, now.getTime() + schedule.intervalMs);
    return new Date(next).toISOString();
  }
  if (schedule.calculatorId) {
    const calculator = calculators?.[schedule.calculatorId];
    if (!calculator) throw new WorkflowRuntimeError(`Unknown schedule calculator ${schedule.calculatorId}`, "ERR_PRISM_WORKFLOW_SCHEDULE");
    const result = await awaitWithSignal(Promise.resolve(calculator({ schedule, firedAt: now.toISOString(), signal })), signal);
    if (result === null) return null;
    const next = toIso(result, "calculator nextRunAt");
    if (Date.parse(next) <= now.getTime()) throw new WorkflowRuntimeError("Schedule calculator must return a future time", "ERR_PRISM_WORKFLOW_SCHEDULE");
    return next;
  }
  return null;
}

async function awaitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function requireOwnership(ownership: OwnershipScope): void {
  if (!ownership.tenantId || (!ownership.accountId && !ownership.userId)) {
    throw new WorkflowRuntimeError("Schedules require tenantId and accountId or userId", "ERR_PRISM_WORKFLOW_SCHEDULE_OWNERSHIP");
  }
}

function requireId(value: string, label: string): void {
  if (!value || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new WorkflowRuntimeError(`${label} is invalid`, "ERR_PRISM_WORKFLOW_SCHEDULE");
  }
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new WorkflowRuntimeError(`${label} must be a positive safe integer`, "ERR_PRISM_WORKFLOW_SCHEDULE");
  return value;
}

function capped(value: number, cap: number, label: string): number {
  const resolved = positive(value, label);
  if (resolved > cap) throw new WorkflowRuntimeError(`${label} exceeds hard cap ${cap}`, "ERR_PRISM_WORKFLOW_SCHEDULE");
  return resolved;
}

function toIso(value: string | Date, label: string): string {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(time)) throw new WorkflowRuntimeError(`${label} must be a valid timestamp`, "ERR_PRISM_WORKFLOW_SCHEDULE");
  return new Date(time).toISOString();
}

function scheduledRunId(scheduleId: string, fireAt: string): string {
  return `wfs_${createHash("sha256").update(`${scheduleId}\0${fireAt}`).digest("hex").slice(0, 32)}`;
}

function manualRunId(scheduleId: string, key: string): string {
  return `wfm_${createHash("sha256").update(`${scheduleId}\0${key}`).digest("hex").slice(0, 32)}`;
}
