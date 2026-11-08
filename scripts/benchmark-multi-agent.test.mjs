#!/usr/bin/env node
import { describe, it } from "bun:test";
/**
 * Phase 35 Task 1: multi-agent scenario schema, safety, and runtime invariants.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
import { workspacePackageCounts } from "./package-truth.mjs";

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
  // Grouped layout (plan 147/152): a `packages/<group>/` base holds packages one level deeper.
  const manifests = [];
  for (const dir of readdirSync(join(here, "../packages"))) {
    const top = join(here, "../packages", dir);
    if (existsSync(join(top, "package.json"))) manifests.push(join(top, "package.json"));
    else for (const child of readdirSync(top)) manifests.push(join(top, child, "package.json"));
  }
  for (const manifest of manifests) {
    if (!existsSync(manifest)) continue;
    names.push(JSON.parse(readFileSync(manifest, "utf8")).name);
  }
  return names.sort();
}

describe("multi-agent runtime coverage and baselines", () => {
  it("inventories all current manifests in the evidence matrix", () => {
    const names = workspaceManifests();
    const packages = workspacePackageCounts();
    const hasCore = packages.has("prism-core");
    const hasChannels = names.includes("@arnilo/prism-channels");
    const hasWorkFamily = packages.has("work");
    // The tree's shape is discovered, not assumed: one manifest per workspace package plus the root.
    // (The pre-0.12 branches hardcoded 17/34/45/50/65 and went stale on every package split.)
    assert.equal(names.length, packages.size + 1, `expected ${packages.size + 1} manifests, found ${names.length}`);
    const evidence = readFileSync(evidencePath, "utf8");
    for (const name of names) {
      if (hasWorkFamily && name === "@arnilo/prism-tools-work") continue;
      if (hasChannels && name === "@arnilo/prism-channels") continue;
      if (hasCore && name === "@arnilo/" + "prism-core") continue;
      // Covered by their own suites, not the frozen 0.3.3 multi-agent evidence matrix.
      if (
        name === "@arnilo/prism-hooks-json" ||
        // Plan 152 Task 5: these four never shipped as a standalone 0.3 package either.
        name === "@arnilo/prism-provider-hyper" ||
        name === "@arnilo/prism-provider-laya" ||
        name === "@arnilo/prism-provider-typesafe" ||
        // Plan 152 Task 7: the keyring package never shipped as a 0.3 package either.
        name === "@arnilo/prism-credentials-keyring" ||
        // Plan 153 Tasks 3-5: the store packages never shipped as a 0.3 package either.
        name === "@arnilo/prism-store-jsonl" ||
        name === "@arnilo/prism-store-codecs" ||
        name === "@arnilo/prism-store-sqlite" ||
        name === "@arnilo/prism-store-postgres" ||
        // Plan 154 Task 3: the coding-tools package, split out of the retired family package.
        name === "@arnilo/prism-tools-coding" ||
        // Plan 155 Task 2: the web-tools package, split out of prism-web-tools.
        name === "@arnilo/prism-tools-web" ||
        // Plan 155 Task 3: the browser-tools package, split out of prism-web-tools.
        name === "@arnilo/prism-tools-browser" ||
        // Plan 155 Task 4: the OpenAPI and computer-use packages, split out of the retired family.
        name === "@arnilo/prism-tools-openapi" ||
        name === "@arnilo/prism-tools-computer-use" ||
        // Plan 154 Task 6: the approval package never shipped as a 0.3 package either.
        name === "@arnilo/prism-approval" ||
        // Plan 157 Tasks 3-5: the compaction and observational-memory packages, split out of the
        // memory family (which is the 0.3 package this matrix froze).
        name === "@arnilo/prism-memory-compaction" ||
        name === "@arnilo/prism-memory-observational" ||
        // Plan 158 Tasks 2-6: the memory core/rag/fabric/wiki split plus the context-engineering
        // package. None of them shipped as a standalone 0.3 package.
        name === "@arnilo/prism-memory-core" ||
        name === "@arnilo/prism-rag" ||
        name === "@arnilo/prism-memory-fabric" ||
        name === "@arnilo/prism-wiki" ||
        name === "@arnilo/prism-context-engineering" ||
        // Plan 160 Task 4: the delegate package replaces the in-process supervisor; no 0.3 package.
        name === "@arnilo/prism-delegate" ||
        // Plan 161 Task 3: the acp-agent package renamed to acp; the frozen row keeps the 0.3 name.
        name === "@arnilo/prism-acp" ||
        // Plans 159-164: the 0.13 packages that split out of the kernel, the memory family, or the
        // retired tool families after the frozen 0.3.3 matrix was written.
        name === "@arnilo/prism-mcp-server" ||
        name === "@arnilo/prism-guardrail-packs" ||
        name === "@arnilo/prism-governance" ||
        name === "@arnilo/prism-observability" ||
        name === "@arnilo/prism-devtools" ||
        name === "@arnilo/prism-tools-research" ||
        name === "@arnilo/prism-headless" ||
        name === "@arnilo/prism-driver-process" ||
        name === "@arnilo/prism-remote" ||
        name === "@arnilo/prism-context-files"
      )
        continue;
      assert.ok(evidence.includes(`| ${name} |`), `evidence missing ${name}`);
    }
    const classes = ["hot-path", "optional-in-run", "persistence-coordination", "setup-only"];
    const paths = ["model-call", "prompt-assembly", "tool-execution", "coordination", "storage", "telemetry", "setup-only"];
    const rows = evidence.split("\n").filter((line) => line.startsWith("| @"));
    assert.equal(rows.length, 65, "evidence table has 65 package rows"); // frozen 0.3.3 baseline: 17 subpath adapters collapse into one family row
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

  it("fan-out maps 8x20ms items at concurrency 2 with ordered output and >=1.4x speedup", async () => {
    let row = await runWorkflowFanOut({ delayMs: 20, concurrency: 2, itemCount: 8 });
    if (row.speedup < 1.4) row = await runWorkflowFanOut({ delayMs: 20, concurrency: 2, itemCount: 8 });
    assert.equal(row.status, "succeeded");
    assert.equal(row.completions, 8);
    assert.ok(row.peakWorkers <= 2);
    assert.equal(row.activeAfter, 0);
    // Ideal is ~2x; 1.4 leaves headroom for wall-clock noise on loaded CI
    // runners while still proving concurrency actually parallelizes (ponytail:
    // raise to 1.75 if this ever stops catching a real serialization bug).
    // Plan 124 Task 4: re-measured under Bun 1.4.2 (2026-09-25, five back-to-back
    // runs) at 1.871-1.890x (same-session Node 1.869-1.898x), so 1.4 stays.
    assert.ok(row.speedup >= 1.4, `speedup ${row.speedup}x`);
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
