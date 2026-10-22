import { afterAll, beforeAll, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, UsageError } from "../cli/args.js";
import { scheduledRunTwoProcesses, type ScheduledRunResult } from "../scenarios/scheduled-run-two-processes.js";

let root: string;
let skip: ScheduledRunResult;
let runOnce: ScheduledRunResult;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "pa-sch-"));
  skip = await scheduledRunTwoProcesses({ root: join(root, "a"), ticks: 3, missed: "skip", missedTicks: 5 });
  runOnce = await scheduledRunTwoProcesses({ root: join(root, "b"), ticks: 2, missed: "run-once", missedTicks: 5 });
}, 120_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

test("scheduled_run_fires_once_per_tick_across_two_processes", () => {
  assert.deepEqual(skip.perTick, [1, 2, 3]);
  assert.equal(skip.doubleFirings, 0);
});

test("missed_firing_policy_honored_after_restart", () => {
  // skip: five missed minutes produce no firing; run-once: exactly one catch-up firing.
  assert.equal(skip.afterRestart, 0);
  assert.equal(runOnce.afterRestart, 1);
});

test("schedule_command_exits_0_on_sigterm", () => {
  assert.deepEqual(skip.exitCodes, [0, 0]);
  assert.deepEqual(runOnce.exitCodes, [0, 0]);
});

test("schedule_command_takes_only_config", () => {
  assert.deepEqual(parseArgs(["schedule", "--config", "x.json"]), { command: "schedule", config: "x.json" });
  assert.throws(() => parseArgs(["schedule", "--agent", "coding"]), UsageError);
  assert.throws(() => parseArgs(["schedule", "extra"]), UsageError);
});
