#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertAll,
  checkCeiling,
  checkThroughput,
  checkUpperBound,
  loadBudgets,
  measureRootPack,
  measureStartupMs,
} from "./budget-gates.mjs";

/**
 * Release 0.0.16 performance evidence + budget gate (plan 079, Task 8).
 *
 * 0.0.16 is a simplification/readiness release: it added no performance-affecting
 * code, so the six network-free scenario medians are reused unchanged from
 * scripts/benchmark-0.0.15.mjs (spawned below, not reimplemented). The 0.0.16
 * story is the artifact diet (smaller root tarball) with startup and scenario
 * throughput held. Every measured value is compared against scripts/budgets.json
 * and the process exits non-zero on a regression beyond tolerance.
 */

const budgets = loadBudgets();
const checks = [];

// 1. Artifact diet + startup (deterministic-ish, measured here).
const pack = measureRootPack();
const startupMs = measureStartupMs();
checks.push(
  checkUpperBound("root packedBytes", pack.packedBytes, budgets.root.packedBytes.baseline, budgets.root.packedBytes.tolerance),
  checkUpperBound("root unpackedBytes", pack.unpackedBytes, budgets.root.unpackedBytes.baseline, budgets.root.unpackedBytes.tolerance),
  checkUpperBound("root fileCount", pack.fileCount, budgets.root.fileCount.baseline, budgets.root.fileCount.tolerance),
  checkCeiling("startup import", startupMs, budgets.startup.importMsCeiling),
);

// 2. Reuse the 0.0.15 scenario runner for the six medians.
const bench = spawnSync(process.execPath, [fileURLToPath(new URL("./benchmark-0.0.15.mjs", import.meta.url))], {
  stdio: ["pipe", "pipe", "pipe"],
  encoding: "utf8",
});
if (bench.status !== 0) {
  console.error(bench.stderr);
  throw new Error(`benchmark-0.0.15.mjs exited ${bench.status}`);
}
const scenarioReport = JSON.parse(bench.stdout);
const byScenario = new Map(scenarioReport.results.map((row) => [row.scenario, row]));

const tolerance = budgets.benchmarkMedians.tolerance;
const measuredMedians = {};
for (const [name, baseline] of Object.entries(budgets.benchmarkMedians.scenarios)) {
  const row = byScenario.get(name);
  if (!row) throw new Error(`benchmark-0.0.15.mjs did not report scenario ${name}`);
  measuredMedians[name] = { throughputPerSecond: row.throughputPerSecond, p50Ms: row.p50Ms, p95Ms: row.p95Ms };
  checks.push(
    checkThroughput(`${name} throughput`, row.throughputPerSecond, baseline.throughputPerSecond, tolerance),
    checkUpperBound(`${name} p50Ms`, row.p50Ms, baseline.p50Ms, tolerance),
    checkUpperBound(`${name} p95Ms`, row.p95Ms, baseline.p95Ms, tolerance),
  );
}

const report = {
  generatedAt: new Date().toISOString(),
  release: "0.0.16",
  environment: { node: process.version, platform: process.platform, arch: process.arch, network: false, credentials: false },
  artifactDiet: {
    root: pack,
    aggregateBaseline: budgets.aggregate,
    startupImportMs: Number(startupMs.toFixed(2)),
    reviewCoverageExcluded: true,
  },
  benchmarkMedians: measuredMedians,
  budgets: { passed: checks.filter((c) => c.ok).length, total: checks.length },
  results: checks.map((c) => ({ ok: c.ok, message: c.message })),
};
console.log(JSON.stringify(report, null, 2));

assertAll(checks);
console.error(`0.0.16 budget gate passed: ${checks.length}/${checks.length} checks within tolerance.`);
