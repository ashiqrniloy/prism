#!/usr/bin/env node
/**
 * Phase 35 Task 1: multi-agent scenario schema, safety, and runtime invariants.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { SCENARIOS } from "./benchmark.mjs";
import {
  ABORT_COUNT,
  HIGH_FREQUENCY_DELTA_COUNT,
  LARGE_HISTORY_COUNT,
  runAbortStorm,
  runIndependentSessions,
  runLargeHistoryBudget,
  runProviderDeltas,
  runSupervisorFanOut,
  runSupervisorSaturation,
  runToolConcurrency,
  runWorkflowAgentNodes,
  runWorkflowFanOut,
  SESSION_COUNTS,
  SUPERVISOR_CAP,
  TOOL_CALLS,
  TOOL_CONCURRENCY,
  WORKFLOW_CONCURRENCY,
} from "./benchmark-scenarios/multi-agent-runtime.mjs";
import { loadBudgets } from "./budget-gates.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const runner = join(here, "benchmark.mjs");
const evidencePath = join(here, "../docs/_evidence/phase35-ai-runtime-package-matrix.md");
const ROW_NAMES = [
  ...SESSION_COUNTS.map((count) => `independentSessions-${count}`),
  "contextBudget-10k-history",
  "provider-5k-deltas",
  "supervisorFanOut",
  "supervisorSaturation",
  "workflowFanOut",
  "workflowAgentNodes",
  "toolConcurrency",
  "abortStorm",
];

function workspaceManifests() {
  const root = JSON.parse(readFileSync(join(here, "../package.json"), "utf8"));
  const names = [root.name];
  for (const dir of readdirSync(join(here, "../packages"))) {
    const manifest = join(here, "../packages", dir, "package.json");
    if (!existsSync(manifest)) continue;
    names.push(JSON.parse(readFileSync(manifest, "utf8")).name);
  }
  return names.sort();
}

describe("multi-agent runtime coverage and baselines", () => {
  it("inventories all 60 manifests in the evidence matrix", () => {
    const names = workspaceManifests();
    assert.equal(names.length, 60, `expected 60 manifests, found ${names.length}`);
    const evidence = readFileSync(evidencePath, "utf8");
    for (const name of names) {
      assert.ok(evidence.includes(`| ${name} |`), `evidence missing ${name}`);
    }
    const classes = ["hot-path", "optional-in-run", "persistence-coordination", "setup-only"];
    const paths = ["model-call", "prompt-assembly", "tool-execution", "coordination", "storage", "telemetry", "setup-only"];
    const rows = evidence.split("\n").filter((line) => line.startsWith("| @"));
    assert.equal(rows.length, 60, "evidence table has 60 package rows");
    for (const row of rows) {
      assert.ok(
        classes.some((value) => row.includes(`| ${value} |`)),
        `class missing in ${row}`,
      );
      assert.ok(
        paths.some((value) => row.includes(`| ${value} |`)),
        `path missing in ${row}`,
      );
    }
  });

  it("10k history eviction and 5k provider deltas complete within bounded paths", async () => {
    const history = runLargeHistoryBudget({ historyCount: LARGE_HISTORY_COUNT });
    assert.equal(history.completions, 1);
    assert.equal(history.historyRemaining, 0);

    const deltas = await runProviderDeltas({ deltaCount: HIGH_FREQUENCY_DELTA_COUNT });
    assert.equal(deltas.completions, 1);
    assert.equal(deltas.deltaCount, HIGH_FREQUENCY_DELTA_COUNT);
    assert.ok(deltas.responseBytes > 0);
  });

  it("32 independent sessions complete under the provider-call cap with no shared-state rejection", async () => {
    const row = await runIndependentSessions(32, { delayMs: 8 });
    assert.equal(row.completions, 32);
    assert.equal(row.peakActiveProviderCalls, 32);
    assert.equal(row.activeAfter, 0);
    assert.equal(row.droppedEvents, 0);
    assert.ok(row.queuedEvents > 0, "session events were delivered");
  });

  it("supervisor saturation stays within maxActiveChildren and rejects the overflow", async () => {
    const fan = await runSupervisorFanOut({ delayMs: 8, maxActiveChildren: SUPERVISOR_CAP });
    assert.equal(fan.completions, SUPERVISOR_CAP);
    assert.ok(fan.peakActiveChildren <= SUPERVISOR_CAP);
    assert.equal(fan.activeAfter, 0);

    const sat = await runSupervisorSaturation({
      delayMs: 20,
      maxActiveChildren: SUPERVISOR_CAP,
      attempted: 32,
    });
    assert.equal(sat.completions, SUPERVISOR_CAP);
    assert.equal(sat.limitRejected, 32 - SUPERVISOR_CAP);
    assert.ok(sat.peakActiveChildren <= SUPERVISOR_CAP);
    assert.equal(sat.activeAfter, 0);
  });

  it("fan-out maps 8x20ms items at concurrency 2 with ordered output and >=1.75x speedup", async () => {
    const row = await runWorkflowFanOut({ delayMs: 20, concurrency: 2, itemCount: 8 });
    assert.equal(row.status, "succeeded");
    assert.equal(row.completions, 8);
    assert.ok(row.peakWorkers <= 2);
    assert.equal(row.activeAfter, 0);
    assert.ok(row.speedup >= 1.75, `speedup ${row.speedup}x`);
  });

  it("parallel workflow agent nodes complete outputs and events under configured concurrency", async () => {
    const row = await runWorkflowAgentNodes({ delayMs: 8, concurrency: WORKFLOW_CONCURRENCY, nodeCount: 4 });
    assert.equal(row.status, "succeeded");
    assert.equal(row.completions, 4);
    assert.equal(row.nodeStarted, 4);
    assert.equal(row.nodeFinished, 4);
    assert.ok(row.peakActiveProviderCalls <= WORKFLOW_CONCURRENCY);
    assert.equal(row.peakActiveProviderCalls, WORKFLOW_CONCURRENCY);
    assert.equal(row.activeAfter, 0);
  });

  it("abort storm settles provider/tool work and returns active counts to zero", async () => {
    const row = await runAbortStorm({ delayMs: 30, count: ABORT_COUNT, settleDeadlineMs: 1000 });
    assert.equal(row.completions + row.aborted, ABORT_COUNT);
    assert.equal(row.activeAfter, 0);
    assert.equal(row.abortSettled, true);
    assert.ok(row.abortSettledMs < 1000);
  });

  it("tool concurrency never exceeds the configured cap", async () => {
    const row = await runToolConcurrency({ delayMs: 15, toolConcurrency: TOOL_CONCURRENCY, toolCount: TOOL_CALLS });
    assert.equal(row.completions, 1);
    assert.equal(row.peakActiveTools, TOOL_CONCURRENCY);
    assert.equal(row.activeAfter, 0);
  });

  it("scenario registry, report schema, and budgets stay network-free", () => {
    assert.equal(SCENARIOS["multi-agent-runtime"].protected, false);
    const budgets = loadBudgets().multiAgentRuntime;
    for (const name of ROW_NAMES) {
      assert.ok(name in budgets.p95CeilingsMs, `missing ceiling for ${name}`);
    }
    const run = spawnSync(process.execPath, [runner, "--scenario", "multi-agent-runtime"], {
      env: { ...process.env, PRISM_BENCH_ITERATIONS: "1", PRISM_BENCH_WARMUPS: "0", PRISM_BENCH_DELAY_MS: "1" },
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const report = JSON.parse(run.stdout);
    assert.equal(report.environment.network, false);
    assert.equal(report.environment.credentials, false);
    const blob = JSON.stringify(report);
    assert.doesNotMatch(blob, /sk-|postgresql:\/\/|api[_-]?key|BEGIN [A-Z ]+PRIVATE KEY/i);
    const names = report.results.map((row) => row.name);
    assert.deepEqual(names, ROW_NAMES);
    for (const row of report.results) {
      for (const field of [
        "name",
        "p50Ms",
        "p95Ms",
        "throughputPerSecond",
        "operations",
        "heapDeltaBytes",
        "queuedEvents",
        "droppedEvents",
        "peakActiveProviderCalls",
      ]) {
        assert.ok(field in row, `missing ${field} in ${row.name}`);
      }
      assert.equal(row.activeAfter, 0, `${row.name} leaked active work`);
    }
  });
});
