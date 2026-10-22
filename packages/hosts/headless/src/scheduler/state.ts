import type { Agent, JsonObject, OwnershipScope, RunOptions, RunResult } from "@arnilo/prism";
import { CHECKPOINT_CONFLICT_CODE, type CheckpointRecord, type CheckpointStore, type WorkflowRunStatus } from "@arnilo/prism-workflows";
import { HeadlessError } from "../errors.js";

export type SchedulerTarget =
  | { readonly kind: "agent"; readonly agent: Agent; readonly input: string; readonly runOptions?: RunOptions }
  | { readonly kind: "workflow"; readonly agent: Agent; readonly command: string; readonly input: JsonObject }
  /** Runs one registered package command with no model turn; its arguments are the command's input. */
  | { readonly kind: "command"; readonly agent: Agent; readonly command: string; readonly input: JsonObject };

export interface SchedulerFiring {
  readonly firingId: string;
  readonly status: RunResult["status"] | WorkflowRunStatus | "skipped" | "lease_lost";
  readonly dueAt?: string;
  readonly missed?: number;
  readonly policy?: "skip" | "run-once";
  readonly fencingToken?: number;
  readonly sessionId?: string;
  readonly workflowRunId?: string;
}

export interface ScheduleState {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly target: string;
  readonly input: string | JsonObject;
  readonly cron?: string;
  readonly at?: string;
  readonly tz: string;
  readonly nextRunAt: string | null;
  readonly status: "active" | "paused" | "completed" | "deleted";
  readonly scheduleSessionId: string;
  readonly lastFiring?: SchedulerFiring;
}

export type ScheduleInput = { readonly id: string; readonly target: string } & (
  | { readonly cron: string; readonly tz?: string; readonly at?: never }
  | { readonly at: string | number | Date; readonly cron?: never; readonly tz?: never }
);

export const isConflict = (error: unknown): boolean =>
  error instanceof Error && (("code" in error && error.code === CHECKPOINT_CONFLICT_CODE) || error.name === "CheckpointConflictError");

export function validInput(target: SchedulerTarget, input: unknown): asserts input is string | JsonObject {
  if (target.kind === "agent") {
    if (typeof input !== "string") throw new HeadlessError("invalid_schedule");
  } else if (!input || typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) {
    throw new HeadlessError("invalid_schedule");
  }
  // Reject lossy/non-JSON input before opening a session or writing schedule state.
  const visit = (value: unknown, ancestors: Set<object>): void => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (!value || typeof value !== "object" || ancestors.has(value)) throw new HeadlessError("invalid_schedule");
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) throw new HeadlessError("invalid_schedule");
    ancestors.add(value);
    for (const item of Object.values(value)) visit(item, ancestors);
    ancestors.delete(value);
  };
  visit(input, new Set());
}

export function scheduleStore(checkpoints: CheckpointStore, ownership: OwnershipScope) {
  const scope = { tenantId: ownership.tenantId, accountId: ownership.accountId, userId: ownership.userId };
  const namespace = "headless.schedules";
  const scoped = (row: CheckpointRecord) =>
    row.tenantId === scope.tenantId && row.accountId === scope.accountId && row.userId === scope.userId;
  const decode = (row: CheckpointRecord): ScheduleState => {
    const s = row.value as ScheduleState;
    const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
    if (
      s?.schemaVersion !== 1 ||
      row.namespace !== namespace ||
      s.id !== row.key ||
      !s.id ||
      !Number.isSafeInteger(row.version) ||
      row.version < 1 ||
      (typeof s.input !== "string" && (!s.input || typeof s.input !== "object" || Array.isArray(s.input))) ||
      typeof s.target !== "string" ||
      !s.target ||
      typeof s.scheduleSessionId !== "string" ||
      !s.scheduleSessionId ||
      typeof s.tz !== "string" ||
      !["active", "paused", "completed", "deleted"].includes(s.status) ||
      (s.nextRunAt !== null && !date(s.nextRunAt)) ||
      (s.status === "active" && s.nextRunAt === null) ||
      (s.cron === undefined ? !date(s.at) : typeof s.cron !== "string" || s.at !== undefined) ||
      (s.lastFiring !== undefined && (!s.lastFiring.firingId || typeof s.lastFiring.status !== "string"))
    ) {
      throw new HeadlessError("invalid_schedule_state");
    }
    return structuredClone(s);
  };
  return {
    decode,
    async load(id: string) {
      const row = await checkpoints.loadCheckpoint({ ...scope, namespace, key: id });
      if (row && !scoped(row)) throw new HeadlessError("invalid_schedule_state");
      if (row) decode(row);
      return row;
    },
    async rows() {
      const rows: CheckpointRecord[] = [];
      let cursor: string | undefined;
      do {
        const page = await checkpoints.listCheckpoints({ ...scope, namespace, limit: 1000, ...(cursor === undefined ? {} : { cursor }) });
        for (const row of page.items)
          if (scoped(row)) {
            decode(row);
            rows.push(row);
          }
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      return rows;
    },
    save(state: ScheduleState, version: number) {
      return checkpoints.saveCheckpoint({
        ...scope,
        namespace,
        key: state.id,
        value: state,
        expectedVersion: version,
        version: version + 1,
      });
    },
  };
}
