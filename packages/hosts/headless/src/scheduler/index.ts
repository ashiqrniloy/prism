import { createHash } from "node:crypto";
import type { OwnershipScope } from "@arnilo/prism";
import type { CheckpointRecord, CheckpointStore, LeaseStore } from "@arnilo/prism-extensions/workflows";
import { HeadlessError } from "../errors.js";
import { type SchedulerClock, systemClock } from "./clock.js";
import { nextCron } from "./cron.js";
import { runFiring } from "./firing.js";
import { holdFiringLease } from "./lease.js";
import { missedOccurrences } from "./missed.js";
import {
  isConflict,
  type ScheduleInput,
  type SchedulerFiring,
  type SchedulerTarget,
  type ScheduleState,
  scheduleStore,
  validInput,
} from "./state.js";

export type { SchedulerClock } from "./clock.js";
export type { ScheduleInput, SchedulerFiring, SchedulerTarget, ScheduleState } from "./state.js";

export interface SchedulerOptions {
  readonly checkpoints: CheckpointStore;
  readonly leases?: LeaseStore;
  readonly missed?: "skip" | "run-once";
  readonly targets: Readonly<Record<string, SchedulerTarget>>;
  readonly ownership: OwnershipScope;
  readonly clock?: SchedulerClock;
  readonly limits?: { readonly maxSchedules?: number; readonly maxConcurrentFirings?: number; readonly firingLeaseMs?: number };
}

export interface Scheduler {
  schedule(input: ScheduleInput): Promise<ScheduleState>;
  list(): Promise<readonly ScheduleState[]>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  delete(id: string): Promise<void>;
  trigger(target: string, options?: { readonly input?: unknown }): Promise<SchedulerFiring>;
  start(): void;
  /** Cancels the timer, drains active firings, and surfaces background storage/clock failures. */
  stop(): Promise<void>;
}

export function createScheduler(options: SchedulerOptions): Scheduler {
  if (Object.keys(options).some((key) => !["checkpoints", "targets", "ownership", "clock", "limits", "leases", "missed"].includes(key)))
    throw new HeadlessError("invalid_schedule");
  if (Object.keys(options.limits ?? {}).some((key) => !["maxSchedules", "maxConcurrentFirings", "firingLeaseMs"].includes(key)))
    throw new HeadlessError("invalid_limit");
  if (options.missed !== undefined && !["skip", "run-once"].includes(options.missed)) throw new HeadlessError("invalid_missed_policy");
  const ownerId = crypto.randomUUID();
  const missedPolicy = options.missed ?? "skip";
  const clock = options.clock ?? systemClock;
  const ownership = Object.freeze({ ...options.ownership });
  const store = scheduleStore(options.checkpoints, ownership);
  const limit = (value: number | undefined, fallback: number, hard: number) => {
    const n = value ?? fallback;
    if (!Number.isSafeInteger(n) || n < 1 || n > hard) throw new HeadlessError("invalid_limit");
    return n;
  };
  const firingLeaseMs = limit(options.limits?.firingLeaseMs, 30000, 86400000);
  const maxSchedules = limit(options.limits?.maxSchedules, 1000, 10000);
  const maxConcurrent = limit(options.limits?.maxConcurrentFirings, 4, 1000);
  const targets = new Map(Object.entries(options.targets).map(([name, target]) => [name, { ...target }]));
  for (const target of targets.values()) {
    if (!["agent", "workflow", "command"].includes(target.kind)) throw new HeadlessError("invalid_schedule");
    const scope = target.agent.config.ownership;
    if (["tenantId", "accountId", "userId"].some((k) => scope?.[k as keyof OwnershipScope] !== ownership[k as keyof OwnershipScope])) {
      throw new HeadlessError("scheduler_ownership");
    }
    validInput(target, target.input);
    target.input = structuredClone(target.input);
    if (target.kind !== "agent") {
      if (typeof target.command !== "string" || !target.command.trim()) throw new HeadlessError("invalid_schedule");
      const missing = !target.agent.commands.list().some((c) => c.name === target.command);
      if (missing) throw new HeadlessError(target.kind === "workflow" ? "unknown_workflow_command" : "unknown_command");
    }
  }
  const targetOf = (name: string) => {
    const target = targets.get(name);
    if (!target) throw new HeadlessError("unknown_target");
    return target;
  };
  let running = false;
  let stopping = false;
  let loop: Promise<void> | undefined;
  let failure: unknown;
  let sleeper: AbortController | undefined;
  let revision = 0;
  const active = new Set<Promise<void>>();
  const activeSchedules = new Set<string>();
  const wake = () => {
    revision++;
    sleeper?.abort();
  };
  // Serialize local admission so concurrent schedule() calls cannot bypass the capacity check.
  let admission = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = admission.then(fn);
    admission = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  const list = async () => (await store.rows()).map(store.decode).filter((s) => s.status !== "deleted");
  const change = async (id: string, status: "paused" | "active" | "deleted") => {
    for (;;) {
      const row = await store.load(id);
      if (!row || store.decode(row).status === "deleted") throw new HeadlessError("schedule_not_found");
      const state = store.decode(row);
      if (state.status === "completed" && status !== "deleted") throw new HeadlessError("invalid_schedule");
      try {
        await store.save({ ...state, status }, row.version);
        wake();
        return;
      } catch (error) {
        if (!isConflict(error)) throw error;
      }
    }
  };
  const finish = async (id: string, result: SchedulerFiring) => {
    for (;;) {
      const row = await store.load(id);
      if (!row) return;
      const state = store.decode(row);
      if (state.lastFiring?.firingId !== result.firingId) return;
      try {
        await store.save({ ...state, lastFiring: result }, row.version);
        return;
      } catch (error) {
        if (!isConflict(error)) throw error;
      }
    }
  };
  const claim = async (row: CheckpointRecord, missed?: number) => {
    const state = store.decode(row);
    if (state.status !== "active" || state.nextRunAt === null) return;
    const target = targetOf(state.target);
    validInput(target, state.input);
    const held = options.leases
      ? await holdFiringLease(options.leases, {
          ...ownership,
          namespace: "headless.firing",
          key: `${state.id}:${state.nextRunAt}`,
          ownerId,
          ttlMs: firingLeaseMs,
        })
      : undefined;
    if (options.leases && !held) {
      await systemClock.sleep(Math.min(firingLeaseMs / 3, 1000), new AbortController().signal);
      return;
    }
    try {
      const firingId = crypto.randomUUID();
      const metadata = {
        dueAt: state.nextRunAt,
        ...(missed === undefined ? {} : { missed, policy: missedPolicy }),
        ...(held ? { fencingToken: held.fencingToken } : {}),
      };
      const nextRunAt = state.cron ? nextCron(state.cron, clock.now(), state.tz) : null;
      try {
        await store.save(
          {
            ...state,
            nextRunAt,
            status: nextRunAt === null ? "completed" : "active",
            lastFiring: { firingId, status: "running", ...metadata },
          },
          row.version,
        );
      } catch (error) {
        if (isConflict(error)) {
          wake();
          return;
        }
        throw error;
      }
      const result = await runFiring(target, state.input, state.scheduleSessionId, firingId);
      await held?.stop();
      await finish(state.id, { ...result, ...metadata, ...(held?.lost ? { status: "lease_lost" as const } : {}) });
    } finally {
      await held?.release();
    }
  };
  const launch = (fn: () => Promise<void>) => {
    const task = Promise.resolve()
      .then(fn)
      .catch((error) => {
        failure = error;
        running = false;
      })
      .finally(() => {
        active.delete(task);
        wake();
      });
    active.add(task);
  };
  const wait = async (ms: number | undefined, seen: number) => {
    if (!running || seen !== revision) return;
    const controller = new AbortController();
    sleeper = controller;
    try {
      // Re-check after installing the sleeper: a `wake()` that lands between the check above and
      // this line would otherwise be lost, and the loop would sleep until the next unrelated wake
      // (observed as `scheduler did not settle` in the concurrency tests).
      if (!running || seen !== revision) return;
      if (ms !== undefined) await clock.sleep(Math.max(0, ms), controller.signal);
      else await new Promise<void>((resolve) => controller.signal.addEventListener("abort", () => resolve(), { once: true }));
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      controller.abort();
      if (sleeper === controller) sleeper = undefined;
    }
  };
  const runLoop = async (startedAt: number) => {
    const overdue = new Map<string, number>();
    for (const row of await store.rows()) {
      const state = store.decode(row);
      if (state.status !== "active" || state.nextRunAt === null || Date.parse(state.nextRunAt) >= startedAt) continue;
      const missed = missedOccurrences(state, startedAt);
      if (missedPolicy === "run-once") overdue.set(`${state.id}:${state.nextRunAt}`, missed.count);
      else {
        try {
          await store.save(
            {
              ...state,
              nextRunAt: missed.nextRunAt,
              status: missed.nextRunAt === null ? "completed" : "active",
              lastFiring: {
                firingId: crypto.randomUUID(),
                status: "skipped",
                dueAt: state.nextRunAt,
                missed: missed.count,
                policy: missedPolicy,
              },
            },
            row.version,
          );
        } catch (error) {
          if (!isConflict(error)) throw error;
        }
      }
    }
    while (running) {
      const seen = revision;
      const rows = (await store.rows())
        .map((row) => ({ row, state: store.decode(row) }))
        .filter(({ state }) => state.status === "active" && !activeSchedules.has(state.id))
        .map(({ row, state }) => ({ row, id: state.id, dueAt: Date.parse(state.nextRunAt ?? "") }))
        // Ties break by id, not by store order: two schedules with the same `nextRunAt` must fire in
        // the same order on every run, and a store that returns rows in another order (a Map keyed
        // by id, a SQLite scan) otherwise decides which one wins the concurrency slot.
        .sort((a, b) => a.dueAt - b.dueAt || a.id.localeCompare(b.id));
      // One clock reading per iteration: the launch decision and the wait decision must agree. Read
      // twice and a schedule that becomes due between the two readings is neither fired nor waited
      // on (the loop parks on an unrelated wake instead), which a clock that jumps makes reachable.
      const now = clock.now();
      for (const candidate of rows) {
        if (!running || active.size >= maxConcurrent || candidate.dueAt > now) break;
        activeSchedules.add(candidate.id);
        launch(async () => {
          try {
            await claim(candidate.row, overdue.get(`${candidate.id}:${store.decode(candidate.row).nextRunAt}`));
            overdue.delete(`${candidate.id}:${store.decode(candidate.row).nextRunAt}`);
          } finally {
            activeSchedules.delete(candidate.id);
          }
        });
      }
      if (!running) break;
      const next = rows.find((candidate) => !activeSchedules.has(candidate.id) && candidate.dueAt > now);
      await wait(active.size >= maxConcurrent || !next ? undefined : next.dueAt - now, seen);
    }
  };
  return {
    list,
    schedule(input) {
      return serial(async () => {
        const target = targetOf(input.target);
        if (
          typeof input.id !== "string" ||
          !input.id.trim() ||
          input.id.length > 256 ||
          (input.cron === undefined) === (input.at === undefined)
        )
          throw new HeadlessError("invalid_schedule");
        const previous = await store.load(input.id);
        if (previous && store.decode(previous).status !== "deleted") throw new HeadlessError("duplicate_schedule");
        if ((await list()).length >= maxSchedules) throw new HeadlessError("schedule_limit");
        const tz = input.tz ?? "UTC";
        let nextRunAt: string;
        if (input.cron !== undefined) {
          if (typeof input.cron !== "string" || typeof tz !== "string") throw new HeadlessError("invalid_schedule");
          nextRunAt = nextCron(input.cron, clock.now(), tz);
        } else {
          if (input.tz !== undefined) throw new HeadlessError("invalid_schedule");
          const at =
            input.at instanceof Date
              ? input.at.getTime()
              : typeof input.at === "number"
                ? input.at
                : typeof input.at === "string"
                  ? Date.parse(input.at)
                  : NaN;
          if (!Number.isFinite(new Date(at).getTime())) throw new HeadlessError("invalid_schedule");
          if (at < clock.now()) throw new HeadlessError("past_one_off");
          nextRunAt = new Date(at).toISOString();
        }
        const session = await target.agent.session({ actor: { kind: "prism", agent: target.agent.id } });
        try {
          const state: ScheduleState = {
            schemaVersion: 1,
            id: input.id,
            target: input.target,
            input: structuredClone(target.input),
            tz,
            ...(input.cron === undefined ? { at: nextRunAt } : { cron: input.cron }),
            nextRunAt,
            status: "active",
            scheduleSessionId: session.id,
          };
          try {
            await store.save(state, previous?.version ?? 0);
          } catch (error) {
            if (isConflict(error)) throw new HeadlessError("duplicate_schedule");
            throw error;
          }
          wake();
          return structuredClone(state);
        } finally {
          await session.close();
        }
      });
    },
    pause: (id) => change(id, "paused"),
    resume: (id) => change(id, "active"),
    delete: (id) => change(id, "deleted"),
    async trigger(name, triggerOptions = {}) {
      if (stopping || active.size >= maxConcurrent) throw new HeadlessError("firing_limit");
      const target = targetOf(name);
      const input = triggerOptions.input === undefined ? target.input : triggerOptions.input;
      validInput(target, input);
      const snapshot = structuredClone(input);
      let resolve!: (result: SchedulerFiring) => void;
      let reject!: (error: unknown) => void;
      const result = new Promise<SchedulerFiring>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      launch(async () => {
        try {
          // Deterministic ids give every trigger of this target one durable parent, including after restart.
          const id = `headless-triggers:${createHash("sha256")
            .update(JSON.stringify([ownership.tenantId, ownership.accountId, ownership.userId, target.agent.id, name]))
            .digest("hex")}`;
          const parent = await target.agent.session({ id, create: true, actor: { kind: "prism", agent: target.agent.id } });
          let firing: SchedulerFiring;
          try {
            firing = await runFiring(target, snapshot, parent.id, crypto.randomUUID());
          } finally {
            await parent.close();
          }
          resolve(firing);
        } catch (error) {
          reject(error);
          throw error;
        }
      });
      wake();
      return result;
    },
    start() {
      if (running) return;
      if (stopping) throw new HeadlessError("scheduler_stopping");
      if (failure !== undefined) throw failure;
      running = true;
      loop = runLoop(clock.now()).catch((error) => {
        failure = error;
        running = false;
        wake();
      });
    },
    async stop() {
      stopping = true;
      running = false;
      wake();
      try {
        await loop;
        await Promise.all([...active]);
        await admission;
        if (failure !== undefined) throw failure;
      } finally {
        stopping = false;
      }
    },
  };
}
