#!/usr/bin/env node
/**
 * Combined coverage summary (core + workspaces) — additive reporting with
 * evidence-based per-package gates (plan 023 Task 2). Runs the core coverage
 * suite once with the frozen core gate thresholds and every workspace test
 * suite once with --experimental-test-coverage and a package-local
 * --test-coverage-include=dist/**, then prints one labeled row per package.
 * The include filter keeps the symlinked root core dist (resolved via
 * node_modules/@arnilo/prism -> ../..) out of each workspace denominator.
 * The core gate (lines>=60, functions>=70, branches>=75) is the only hard
 * core threshold; each non-protected workspace is additionally gated on
 * lines >= its evidence-based threshold (scripts/coverage-thresholds.json,
 * captured at freeze = recompute - 3pp). Protected-integration packages
 * (durable legs requiring PRISM_TEST_POSTGRES_URL or a real NATS server)
 * are exempt from the gate and reported separately. Emits
 * scripts/coverage-summary.json (machine-readable, CI-retained).
 * Requires `npm run build` first. No third-party coverage tooling; reuses
 * Node's built-in coverage.
 *
 * Env overrides: PRISM_COVERAGE_THRESHOLDS (thresholds file path),
 * PRISM_COVERAGE_ARTIFACT (artifact output path).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

const THRESHOLDS_PATH = process.env.PRISM_COVERAGE_THRESHOLDS ?? join(root, "scripts", "coverage-thresholds.json");
const ARTIFACT_PATH = process.env.PRISM_COVERAGE_ARTIFACT ?? join(root, "scripts", "coverage-summary.json");

function runCoverage(fileArgs, cwd = root) {
  // NODE_TEST_* env inherited from a test-worker parent makes nested `node --test`
  // runs skip everything; strip it so coverage children really run the suites.
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST_")));
  const result = spawnSync(process.execPath, ["--test", "--experimental-test-coverage", ...fileArgs], {
    cwd,
    encoding: "utf8",
    env: childEnv,
  });
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

// Proxy for the coverage denominator: .js files under dist/ (tests excluded).
function countDenominatorFiles(packageDir) {
  const dist = join(packageDir, "dist");
  if (!existsSync(dist)) return 0;
  let count = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") walk(p);
      } else if (entry.name.endsWith(".js")) {
        count++;
      }
    }
  };
  walk(dist);
  return count;
}

let thresholds;
try {
  thresholds = JSON.parse(readFileSync(THRESHOLDS_PATH, "utf8"));
} catch (err) {
  console.error(`coverage-summary: cannot read thresholds ${THRESHOLDS_PATH}: ${err.message}`);
  process.exit(1);
}

let anyFailed = false;
const artifact = { captured: new Date().toISOString(), core: {}, packages: {}, belowThreshold: [] };

const coreTests = join(root, "dist/__tests__");
if (!existsSync(coreTests)) {
  console.error("coverage-summary: no dist/__tests__ — run `npm run build` first");
  process.exit(1);
}
console.log("Combined coverage summary (core gate 60/70/75 + per-package lines thresholds; protected packages exempt)");
console.log("  (core row: lines>=60 functions>=70 branches>=75)");
const core = runCoverage([...CORE_GATE, ...CORE_EXCLUDES.map((e) => `--test-coverage-exclude=${e}`), "dist/__tests__/*.test.js"]);
console.log(format("@arnilo/prism (core)", core, "[gate 60/70/75]"));
artifact.core = { lines: core.lines ?? null, branches: core.branches ?? null, functions: core.functions ?? null, gate: "60/70/75" };
if (!core.ok) anyFailed = true;

const workspaceNames = readdirSync(packagesDir)
  .filter((name) => existsSync(join(packagesDir, name, "package.json")))
  .filter((name) => existsSync(join(packagesDir, name, "dist/__tests__")))
  .sort();
for (const name of workspaceNames) {
  const pkg = JSON.parse(readFileSync(join(packagesDir, name, "package.json"), "utf8"));
  const pkgName = pkg.name ?? name;
  const run = runCoverage(
    ["--test-coverage-include=dist/**", ...SHARED_EXCLUDES.map((e) => `--test-coverage-exclude=${e}`), "dist/__tests__/*.test.js"],
    join(packagesDir, name),
  );
  const thresholdEntry = thresholds.packages?.[pkgName];
  const denominatorFiles = countDenominatorFiles(join(packagesDir, name));
  if (!thresholdEntry) {
    // Fail-closed: a workspace with no evidence-based threshold is a config gap.
    console.error(`coverage-summary: ${pkgName} has no threshold entry in ${THRESHOLDS_PATH}`);
    console.log(format(pkgName, run, "NO THRESHOLD ENTRY"));
    artifact.packages[pkgName] = {
      lines: run.lines ?? null,
      branches: run.branches ?? null,
      functions: run.functions ?? null,
      denominatorFiles,
      threshold: null,
      pass: false,
      protectedException: null,
    };
    anyFailed = true;
    continue;
  }
  const protectedException = thresholdEntry.protectedException ?? null;
  const threshold = protectedException ? null : thresholdEntry.lines;
  let pass = true;
  let note;
  if (protectedException) {
    note = `[protected: ${protectedException}]`;
  } else if (run.lines === undefined) {
    pass = false;
    note = run.ok ? "no coverage data" : "(suite failed)";
    anyFailed = true; // a run that produced no aggregate row is a broken run, never a pass
  } else if (run.lines < threshold) {
    pass = false;
    note = `[FAIL lines ${run.lines.toFixed(2)} < ${threshold.toFixed(2)}]`;
    artifact.belowThreshold.push(pkgName);
    anyFailed = true;
  } else {
    note = `[>=${threshold.toFixed(2)}]`;
  }
  console.log(format(pkgName, run, note));
  artifact.packages[pkgName] = {
    lines: run.lines ?? null,
    branches: run.branches ?? null,
    functions: run.functions ?? null,
    denominatorFiles,
    threshold,
    pass,
    protectedException,
  };
  if (!run.ok) anyFailed = true;
}

writeFileSync(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(
  `\n${workspaceNames.length} workspace suites + core reported. Core gate 60/70/75; per-package lines thresholds enforced (protected exempt). Artifact: ${ARTIFACT_PATH}`,
);
if (anyFailed) {
  console.error("coverage-summary: failures above — a suite failed or a non-protected package regressed below its threshold");
  process.exit(1);
}
