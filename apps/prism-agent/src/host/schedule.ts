import { readFileSync } from "node:fs";
import type { Agent, OwnershipScope } from "@arnilo/prism";
import { createScheduler, HeadlessError, type Scheduler, type SchedulerClock, type SchedulerTarget } from "@arnilo/prism-headless";
import { createSqlitePersistence } from "@arnilo/prism-store-sqlite";
import type { HostConfig } from "./config.js";

/** Scheduler and target agents share one scope; the scheduler refuses a target in another. */
export const SCHEDULE_OWNERSHIP: OwnershipScope = { tenantId: "prism-agent", userId: "prism-agent" };

export const BRIEF_SCHEDULE = "brief";
export const BUILD_SCHEDULE = "build";

export interface HostSchedulerDeps {
  readonly research: Agent;
  /** Present only when the build schedule is configured; its `build` command needs the four workers. */
  readonly orchestrator?: Agent;
  readonly clock?: SchedulerClock;
}

/**
 * Declarations only: fixed targets, cron strings from config, the store's checkpoint and lease services.
 * Schedules already in the store (another process, an earlier run) are left as they are.
 */
export async function createHostScheduler(config: HostConfig, deps: HostSchedulerDeps): Promise<Scheduler> {
  const spec = config.schedule;
  const persistence = createSqlitePersistence({ filename: config.storePath });
  const targets: Record<string, SchedulerTarget> = {};
  if (spec?.brief !== undefined) targets[BRIEF_SCHEDULE] = { kind: "agent", agent: deps.research, input: spec.brief.prompt };
  if (spec?.build !== undefined && deps.orchestrator !== undefined) {
    targets[BUILD_SCHEDULE] = { kind: "workflow", agent: deps.orchestrator, command: "build", input: {} };
  }
  const scheduler = createScheduler({
    checkpoints: persistence.checkpoints,
    leases: persistence.leases,
    ownership: SCHEDULE_OWNERSHIP,
    targets,
    ...(spec?.missed === undefined ? {} : { missed: spec.missed }),
    ...(deps.clock === undefined ? {} : { clock: deps.clock }),
  });
  const tz = spec?.tz ?? "UTC";
  const declared: [string, string | undefined][] = [
    [BRIEF_SCHEDULE, spec?.brief?.cron],
    [BUILD_SCHEDULE, deps.orchestrator === undefined ? undefined : spec?.build?.cron],
  ];
  for (const [id, cron] of declared) {
    if (cron === undefined) continue;
    try {
      await scheduler.schedule({ id, target: id, cron, tz });
    } catch (error) {
      if (!(error instanceof HeadlessError && error.code === "duplicate_schedule")) throw error;
    }
  }
  return scheduler;
}

/**
 * A clock that reads epoch milliseconds from a file, so two processes share one fake time.
 * `PRISM_AGENT_CLOCK=file:<path>`. Unset on a real run: the system clock is used.
 */
export function fileClock(path: string, pollMs = 5): SchedulerClock {
  const now = () => Number(readFileSync(path, "utf8").trim());
  return {
    now,
    sleep(ms, signal) {
      return new Promise((resolve) => {
        const until = now() + ms;
        const timer = setInterval(() => {
          if (signal.aborted || now() >= until) done();
        }, pollMs);
        const done = () => {
          clearInterval(timer);
          signal.removeEventListener("abort", done);
          resolve();
        };
        signal.addEventListener("abort", done, { once: true });
        if (signal.aborted) done();
      });
    },
  };
}

export function clockFromEnv(value: string | undefined): SchedulerClock | undefined {
  if (value === undefined || value.length === 0) return undefined;
  if (!value.startsWith("file:")) throw new Error("PRISM_AGENT_CLOCK must be file:<path>");
  return fileClock(value.slice("file:".length));
}
