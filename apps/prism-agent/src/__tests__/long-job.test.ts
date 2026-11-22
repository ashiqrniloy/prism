import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type HostConfig, loadHostConfig } from "../host/config.js";
import { LONG_JOB_CRASH_RUN, LONG_JOB_RUNS, type LongJobResult, longJob } from "../scenarios/long-job.js";

const MODEL = { provider: "mock", model: "m", limits: { contextWindow: 64_000, maxOutputTokens: 0 } };

let root: string;
let result: LongJobResult;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "pa-job-"));
  const config: HostConfig = {
    models: { orchestrator: MODEL, coding: MODEL, research: MODEL },
    storePath: join(root, "s.db"),
    workspace: join(root, "workspace"),
    approval: "auto",
    web: { backend: "obscura" },
    sessionLimits: { maxRuns: 50, maxTotalTokens: 1_000_000 },
  };
  result = await longJob(config);
}, 60_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

test("long_job_scenario_finishes_after_a_simulated_crash", () => {
  expect(result.crashedMidRun).toBe(true);
  expect(result.result).toMatchObject({ status: "done", reason: "done", runs: LONG_JOB_RUNS });
  // The in-flight run was continued: one model turn for it, two for each of the 18 runs after it.
  expect(result.requestsAfterCrash).toBe(1 + 2 * (LONG_JOB_RUNS - LONG_JOB_CRASH_RUN));
  // No message was sent twice and no tool ran twice.
  expect(result.userMessages).toBe(LONG_JOB_RUNS);
  expect(result.toolResults).toBe(LONG_JOB_RUNS);
  expect(result.files).toHaveLength(LONG_JOB_RUNS);
  expect(result.finalText).toBe(`step ${LONG_JOB_RUNS} of ${LONG_JOB_RUNS}: ALL DONE`);
});

test("the_host_session_limits_count_runs_across_the_crash", () => {
  expect(result.limits.limits.maxRuns).toBe(50);
  expect(result.limits.exhausted).toBe(false);
  // Runs 1–11 in the first process, the continued run 12 and runs 13–30 in the second.
  expect(result.limits.counters.runs).toBe(LONG_JOB_RUNS);
  // Two 50-token model turns per run, less the turn that never answered.
  expect(result.limits.counters.totalTokens).toBe((2 * LONG_JOB_RUNS - 1) * 50);
  expect(result.result.usage.totalTokens).toBe((2 * LONG_JOB_RUNS - 1) * 50);
});

test("host_config_session_limits_are_unset_by_default_and_reject_unknown_keys", () => {
  const base = {
    models: { orchestrator: MODEL, coding: MODEL, research: MODEL },
    storePath: "s.db",
    workspace: ".",
    approval: "auto",
    web: { backend: "obscura" },
  };
  const path = join(root, "prism-agent.json");
  writeFileSync(path, JSON.stringify(base));
  expect(loadHostConfig(path).sessionLimits).toBeUndefined();
  writeFileSync(path, JSON.stringify({ ...base, sessionLimits: { maxRuns: 5, deadline: null } }));
  expect(loadHostConfig(path).sessionLimits).toEqual({ maxRuns: 5, deadline: null });
  writeFileSync(path, JSON.stringify({ ...base, sessionLimits: { maxSteps: 5 } }));
  expect(() => loadHostConfig(path)).toThrow("sessionLimits has unknown key maxSteps");
});
