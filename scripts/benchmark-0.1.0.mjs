#!/usr/bin/env node
/**
 * Release 0.1.0 capacity envelope (plan 012 Task 5).
 *
 * Composes the six phase benchmark scripts (0.0.23-0.0.28) into one frozen
 * performance contract: each phase script already measures its envelopes with
 * its own fixtures, so this script reuses them as child processes (no new
 * benchmark framework) and merges their reports. Every row is then checked
 * against the Task 0 freeze-manifest ceilings (scripts/phase12-freeze-manifest.json
 * capacity block); startup/install-size rows reuse the shared budget-gate
 * helpers (scripts/budget-gates.mjs) so nothing is measured twice.
 *
 * Legs 0.0.25/0.0.26/0.0.27/0.0.28 are network-free and always run. Legs
 * 0.0.23/0.0.24 need live PostgreSQL and run only when PRISM_TEST_POSTGRES_URL
 * is set; without it those rows are recorded as skipped (protected) and the
 * network-free contract still gates.
 *
 * Usage:
 *   node scripts/benchmark-0.1.0.mjs                       # report to stdout
 *   node scripts/benchmark-0.1.0.mjs --out scripts/benchmark-0.1.0.json
 *   PRISM_TEST_POSTGRES_URL="postgresql://…" node scripts/benchmark-0.1.0.mjs --out …
 *
 * Exit code 1 on any frozen-ceiling breach (BUDGET FAIL lines on stderr).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBudgets, measureRootPack, measureStartupMs, checkUpperBound } from "./budget-gates.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const freeze = JSON.parse(readFileSync(join(here, "phase12-freeze-manifest.json"), "utf8"));
const budgets = loadBudgets();
const capacity = freeze.capacity;
const protectedUrl = process.env.PRISM_TEST_POSTGRES_URL;

const LEGS = [
  {
    source: "benchmark-0.0.25.mjs",
    phase: 8,
    protected: false,
    fixtures: budgets.phase8LoopsHitl,
  },
  {
    source: "benchmark-0.0.26.mjs",
    phase: 9,
    protected: false,
    fixtures: budgets.phase9,
  },
  {
    source: "benchmark-0.0.27.mjs",
    phase: 10,
    protected: false,
    fixtures: budgets.phase10,
  },
  {
    source: "benchmark-0.0.28.mjs",
    phase: 11,
    protected: false,
    fixtures: budgets.phase11,
  },
  {
    source: "benchmark-0.0.23.mjs",
    phase: 6,
    protected: true,
    fixtures: budgets.enterprisePostgres,
  },
  {
    source: "benchmark-0.0.24.mjs",
    phase: 7,
    protected: true,
    fixtures: budgets.phase7Postgres,
  },
];

function runLeg(leg) {
  if (leg.protected && !protectedUrl) {
    return {
      source: leg.source,
      phase: leg.phase,
      protected: true,
      status: "skipped",
      reason: "PRISM_TEST_POSTGRES_URL not set",
      results: [],
    };
  }
  const run = spawnSync(process.execPath, [join(here, leg.source)], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (run.status !== 0) {
    throw new Error(`${leg.source} failed (exit ${run.status}):\n${run.stderr || run.stdout}`);
  }
  const report = JSON.parse(run.stdout);
  return {
    source: leg.source,
    phase: leg.phase,
    protected: leg.protected,
    status: "run",
    fixture: report.fixture,
    storageBeforeCleanup: report.storageBeforeCleanup,
    storageAfterCleanup: report.storageAfterCleanup,
    results: report.results.map((row) => ({
      name: row.name,
      p50Ms: row.p50Ms,
      p95Ms: row.p95Ms,
      throughputPerSecond: row.throughputPerSecond,
      operations: row.operations,
      source: leg.source,
      protected: leg.protected,
    })),
  };
}

const legs = LEGS.map(runLeg);
const results = legs.flatMap((leg) => leg.results);

// Frozen contract rows: install/startup reproduced from the shared budget
// gate helpers (no duplicate measurement).
const pack = measureRootPack();
const installSize = {
  startupImportMs: measureStartupMs(),
  rootPackedBytes: pack.packedBytes,
  rootFileCount: pack.fileCount,
};

// Gate: freeze-manifest ceilings by exact name; startup ceiling; pack diet.
const failures = [];
for (const row of results) {
  const ceiling = capacity.ceilingsMs[row.name];
  if (ceiling !== undefined && row.p95Ms > ceiling) {
    failures.push(`${row.name} p95 ${row.p95Ms}ms > frozen ceiling ${ceiling}ms`);
  }
}
const protectedCeilings = {
  ...budgets.enterprisePostgres.p95CeilingsMs,
  ...budgets.phase7Postgres.p95CeilingsMs,
};
for (const row of results) {
  if (!row.protected) continue;
  const ceiling = protectedCeilings[row.name];
  if (ceiling !== undefined && row.p95Ms > ceiling) {
    failures.push(`${row.name} p95 ${row.p95Ms}ms > protected ceiling ${ceiling}ms`);
  }
}
if (installSize.startupImportMs > capacity.startupImportMsCeiling) {
  failures.push(`startupImport ${installSize.startupImportMs}ms > frozen ceiling ${capacity.startupImportMsCeiling}ms`);
}
const packChecks = [
  checkUpperBound("rootPackedBytes", installSize.rootPackedBytes, capacity.rootPackedBytes.baseline, capacity.rootPackedBytes.tolerance),
  checkUpperBound("rootFileCount", installSize.rootFileCount, capacity.rootFileCount.baseline, capacity.rootFileCount.tolerance),
];
for (const check of packChecks) {
  if (!check.ok) failures.push(check.message);
}

const report = {
  version: "0.1.0",
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: process.env.PRISM_BENCH_CPU ?? "local",
    network: false,
    protected: Boolean(protectedUrl),
  },
  contract: {
    ceilingsMs: capacity.ceilingsMs,
    startupImportMsCeiling: capacity.startupImportMsCeiling,
    rootPackedBytes: capacity.rootPackedBytes,
    rootFileCount: capacity.rootFileCount,
    medianTolerance: capacity.medianTolerance,
  },
  installSize,
  legs,
  results,
};

const out = process.argv.indexOf("--out");
if (out !== -1 && process.argv[out + 1]) writeFileSync(process.argv[out + 1], `${JSON.stringify(report, null, 2)}\n`);

if (failures.length) {
  console.error(`BUDGET FAIL:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(report, null, 2));
}
