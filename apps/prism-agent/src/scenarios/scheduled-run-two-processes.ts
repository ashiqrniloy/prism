import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSessionIndex } from "@arnilo/prism";
import { createSqlitePersistence } from "@arnilo/prism-extensions/store-sqlite";
import type { HostConfig } from "../host/index.js";
import { BRIEF_SCHEDULE, SCHEDULE_OWNERSHIP } from "../host/index.js";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "../../bin/prism-agent.ts");
const MINUTE = 60_000;
/** 2026-10-14T00:00:00Z. The fake clock starts here; every tick is one cron minute. */
export const T0 = Date.UTC(2026, 9, 14);

export interface ScheduledRunResult {
  /** Firings counted after each tick, from sessions parented on the schedule session. */
  readonly perTick: readonly number[];
  readonly doubleFirings: number;
  readonly exitCodes: readonly (number | null)[];
  /** Firings recorded after the restart past `missedTicks` minutes, under the configured policy. */
  readonly afterRestart: number;
  readonly missedTicks: number;
  readonly lastFiringStatus: string | undefined;
}

export interface ScheduledRunOptions {
  readonly root: string;
  readonly ticks: number;
  readonly missed: "skip" | "run-once";
  readonly missedTicks: number;
}

function spawnScheduler(configPath: string, clockPath: string): ChildProcess {
  return spawn(process.execPath, [BIN, "schedule", "--config", configPath], {
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, PRISM_AGENT_CLOCK: `file:${clockPath}`, PRISM_AGENT_MOCK: "schedule-text" },
  });
}

function exited(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) resolve(child.exitCode);
    else child.once("exit", (code) => resolve(code));
  });
}

async function until(label: string, check: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`scheduled-run-two-processes: ${label} did not settle`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Two `prism-agent schedule` processes share one SQLite file and one fake clock file. */
export async function scheduledRunTwoProcesses(options: ScheduledRunOptions): Promise<ScheduledRunResult> {
  mkdirSync(options.root, { recursive: true });
  const clockPath = join(options.root, "clock");
  const configPath = join(options.root, "prism-agent.json");
  const storePath = join(options.root, "s.db");
  const model = { provider: "mock", model: "m", limits: { contextWindow: 64_000, maxOutputTokens: 0 } };
  const config: HostConfig = {
    models: { orchestrator: model, coding: model, research: model },
    storePath,
    workspace: options.root,
    approval: "ask",
    web: { backend: "obscura" },
    schedule: { tz: "UTC", missed: options.missed, brief: { cron: "* * * * *", prompt: "Write the daily brief." } },
  };
  writeFileSync(configPath, JSON.stringify(config));
  writeFileSync(clockPath, String(T0));
  const probe = createSqlitePersistence({ filename: storePath });
  const state = async () => {
    const page = await probe.checkpoints.listCheckpoints({ ...SCHEDULE_OWNERSHIP, namespace: "headless.schedules", limit: 10 });
    return page.items.find((row) => row.key === BRIEF_SCHEDULE)?.value as
      | { scheduleSessionId: string; lastFiring?: { status: string } }
      | undefined;
  };
  const firings = async () => {
    const current = await state();
    if (current === undefined) return 0;
    const page = await createSessionIndex(probe).list({ parentSessionId: current.scheduleSessionId });
    return page.items.length;
  };
  const exitCodes: (number | null)[] = [];
  const perTick: number[] = [];
  let children = [spawnScheduler(configPath, clockPath), spawnScheduler(configPath, clockPath)];
  try {
    await until("schedule created", async () => (await state()) !== undefined);
    // Give the second process time to reach its loop; duplicate_schedule must not kill it.
    await new Promise((resolve) => setTimeout(resolve, 600));
    for (let tick = 1; tick <= options.ticks; tick += 1) {
      writeFileSync(clockPath, String(T0 + tick * MINUTE));
      await until(`tick ${tick}`, async () => (await firings()) >= tick);
      // A double firing would land shortly after the claim; leave room for it.
      await new Promise((resolve) => setTimeout(resolve, 300));
      perTick.push(await firings());
    }
    const doubleFirings = perTick.reduce((sum, count, index) => sum + Math.max(0, count - (index + 1)), 0);
    // Stop both, jump the clock past missed ticks, restart one.
    for (const child of children) child.kill("SIGTERM");
    for (const child of children) exitCodes.push(await exited(child));
    const before = await firings();
    writeFileSync(clockPath, String(T0 + (options.ticks + options.missedTicks) * MINUTE + 30_000));
    children = [spawnScheduler(configPath, clockPath)];
    // run-once fires exactly one catch-up firing once the restart boots; skip fires none.
    if (options.missed === "run-once") await until("catch-up firing", async () => (await firings()) > before);
    else await new Promise((resolve) => setTimeout(resolve, 1_200));
    const afterRestart = (await firings()) - before;
    for (const child of children) child.kill("SIGTERM");
    for (const child of children) await exited(child);
    return {
      perTick,
      doubleFirings,
      exitCodes,
      afterRestart,
      missedTicks: options.missedTicks,
      lastFiringStatus: (await state())?.lastFiring?.status,
    };
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
    probe.close?.();
  }
}
