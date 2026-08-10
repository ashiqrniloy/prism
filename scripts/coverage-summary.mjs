#!/usr/bin/env node
/**
 * Combined coverage summary (core + workspaces) — additive reporting only
 * (plan 013 Task 3). Runs the core coverage suite once with the frozen core
 * gate thresholds and every workspace test suite once with
 * --experimental-test-coverage, then prints one labeled row per package.
 * The core gate (lines>=60, functions>=70, branches>=75) remains the ONLY
 * hard threshold: workspace rows are reported, never failed on coverage.
 * Requires `npm run build` first (coverage runs against dist/).
 * No third-party coverage tooling; reuses Node's built-in coverage.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packagesDir = join(root, "packages");

// Mirrors the core test:coverage excludes except **/packages/** (a workspace
// run must measure its own dist, which lives under packages/).
const SHARED_EXCLUDES = ["**/__tests__/**", "**/node_modules/**", "**/scripts/**", "**/examples/**"];
const CORE_EXCLUDES = [...SHARED_EXCLUDES, "**/packages/**"];
const CORE_GATE = ["--test-coverage-lines=60", "--test-coverage-functions=70", "--test-coverage-branches=75"];

// `file | line % | branch % | funcs %` aggregate row. Only trusted when the
// run itself passed: a failed/empty run still prints a vacuous `all files |
// 100.00 | 100.00 | 100.00` row, which must never be reported as coverage.
const ALL_FILES = /all files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/;

function runCoverage(fileArgs, cwd = root) {
  const result = spawnSync(process.execPath, ["--test", "--experimental-test-coverage", ...fileArgs], { cwd, encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const match = output.match(ALL_FILES);
  const ok = result.status === 0;
  return {
    ok,
    lines: ok && match ? Number(match[1]) : undefined,
    branches: ok && match ? Number(match[2]) : undefined,
    functions: ok && match ? Number(match[3]) : undefined,
  };
}

function format(name, run, note) {
  if (run.lines === undefined) return `  ${name.padEnd(32)} no coverage data${run.ok ? "" : " (suite failed)"}`;
  const cells = [
    `lines ${run.lines.toFixed(2).padStart(6)}`,
    `branches ${run.branches.toFixed(2).padStart(6)}`,
    `functions ${run.functions.toFixed(2).padStart(6)}`,
  ];
  return `  ${name.padEnd(32)} ${cells.join("  ")}${note ? `  ${note}` : ""}`;
}

let anyFailed = false;

const coreTests = join(root, "dist/__tests__");
if (!existsSync(coreTests)) {
  console.error("coverage-summary: no dist/__tests__ — run `npm run build` first");
  process.exit(1);
}
console.log("Combined coverage summary (additive reporting; the core gate is the only hard threshold)");
console.log("  (core row: lines>=60 functions>=70 branches>=75)");
const core = runCoverage([...CORE_GATE, ...CORE_EXCLUDES.map((e) => `--test-coverage-exclude=${e}`), "dist/__tests__/*.test.js"]);
console.log(format("@arnilo/prism (core)", core, "[gate]"));
if (!core.ok) anyFailed = true;

const workspaceNames = readdirSync(packagesDir)
  .filter((name) => existsSync(join(packagesDir, name, "package.json")))
  .filter((name) => existsSync(join(packagesDir, name, "dist/__tests__")))
  .sort();
for (const name of workspaceNames) {
  const pkg = JSON.parse(readFileSync(join(packagesDir, name, "package.json"), "utf8"));
  const run = runCoverage(
    [...SHARED_EXCLUDES.map((e) => `--test-coverage-exclude=${e}`), "dist/__tests__/*.test.js"],
    join(packagesDir, name),
  );
  console.log(format(pkg.name ?? name, run));
  if (!run.ok) anyFailed = true;
}

console.log(`\n${workspaceNames.length} workspace suites + core reported. Core gate only; workspace rows never fail on coverage.`);
if (anyFailed) {
  console.error("coverage-summary: at least one suite failed (tests, not coverage)");
  process.exit(1);
}
