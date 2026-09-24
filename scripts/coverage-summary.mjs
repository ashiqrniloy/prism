#!/usr/bin/env node
/**
 * Combined coverage summary (core + workspaces) — additive reporting with
 * evidence-based per-package gates (plan 023 Task 2; instrument moved to Bun by
 * plan 114 Task 2). Runs the core coverage suite once under `bun test --coverage`
 * and every workspace test suite once from its own package directory, then prints
 * one labeled row per package. Workspaces are discovered by "has *.test.js under
 * dist/" (recursive), not by a top-level dist/__tests__ directory:
 * @arnilo/prism-acp-agent builds its tests to dist/src/__tests__ and
 * @arnilo/prism-work to dist/<area>/__tests__ (plan 070 Task 7).
 * Scoping: Bun 1.4.2 reads coveragePathIgnorePatterns only from $cwd/bunfig.toml,
 * so the core run scopes with the root bunfig and each gated workspace carries a
 * package-local bunfig (`["../**"]`) — the working equivalent of the old Node
 * --test-coverage-include=dist/** (docs/_evidence/phase114-bun-coverage.md §1.6).
 * The core gate is the parsed `All files` row (lines/functions floors from
 * scripts/coverage-thresholds.json); each non-protected workspace is gated on
 * lines >= its evidence-based threshold (captured at freeze = recompute - 3pp).
 * Protected-integration packages (durable legs requiring PRISM_TEST_POSTGRES_URL
 * or a real NATS server) are exempt from the gate and reported separately. Emits
 * scripts/coverage-summary.json (machine-readable, CI-retained): a failing row
 * carries `status`, `exitCode`, and a redacted `tail` of the child's output
 * (scripts/coverage-failure.mjs), so a bare `suite failed` is never the whole
 * story (plan 071 Task 15).
 * Requires `npm run build` first. No third-party coverage tooling; reuses Bun's
 * built-in coverage.
 *
 * Env overrides: PRISM_COVERAGE_THRESHOLDS (thresholds file path),
 * PRISM_COVERAGE_ARTIFACT (artifact output path), and the captured-core seam
 * PRISM_COVERAGE_CORE_OUTPUT + PRISM_COVERAGE_CORE_EXIT (`npm run test:coverage` runs the
 * core suite first and hands that run over, so the core row is read instead of measured).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { failureRow, TAIL_LINES, tailOf } from "./coverage-failure.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packagesDir = join(root, "packages");

const THRESHOLDS_PATH = process.env.PRISM_COVERAGE_THRESHOLDS ?? join(root, "scripts", "coverage-thresholds.json");
const ARTIFACT_PATH = process.env.PRISM_COVERAGE_ARTIFACT ?? join(root, "scripts", "coverage-summary.json");

// `All files | % Funcs | % Lines` aggregate row — Bun's column order, the reverse
// of the old Node `file | line % | branch % | funcs %`. Only trusted when the run
// itself passed: a failed or empty Bun run prints no aggregate row at all, and a
// row parsed from a non-zero exit is never coverage.
const ALL_FILES = /all files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/i;

// ponytail: Bun 1.4.2 lcov emits no BRDA/BRF/BRH and its text table has no branch
// column, so the branch floor is dropped and every row records branches: null
// (docs/_evidence/phase114-bun-coverage.md §2.5). Upgrade: parse BRDA/BRF/BRH from
// a written lcov.info once Bun emits branch records.

// A failing child's tail is diagnostic evidence, so it is scrubbed before it is
// printed or written: the repo root and home become placeholders, and the values
// of credential-shaped env vars (names only are ever reported by the manifest
// tooling) are redacted through the public createSecretRedactor helper. Values
// shorter than 4 chars are skipped — redacting a one-character needle would
// shred the output it is meant to explain.
const SECRET_ENV_NAME = /(?:TOKEN|SECRET|PASSWORD|PASS|KEY|CREDENTIAL|AUTH|DSN|URL|PRISM_)/i;
const HOME = process.env.HOME || "\u0000";
function redactTail(tail) {
  return tail ? redactor.redact(tail.split(root).join("<repo>").split(HOME).join("<home>")) : tail;
}

const coreTests = join(root, "dist/__tests__");
if (!existsSync(coreTests)) {
  console.error("coverage-summary: no dist/__tests__ — run `npm run build` first");
  process.exit(1);
}
const { createSecretRedactor } = await import(pathToFileURL(join(root, "dist", "index.js")).href);
const redactor = createSecretRedactor(
  Object.entries(process.env)
    .filter(([name, value]) => SECRET_ENV_NAME.test(name) && typeof value === "string" && value.length >= 4)
    .map(([, value]) => value),
);

function runCoverage(fileArgs, cwd = root) {
  // NODE_TEST_* env inherited from a test-worker parent makes nested `node --test`
  // runs inside the suite skip everything; strip it so the child really runs.
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST_")));
  const result = spawnSync("bun", ["test", "--coverage", "--timeout=0", ...fileArgs], {
    cwd,
    encoding: "utf8",
    env: childEnv,
  });
  return parseRun(`${result.stdout ?? ""}${result.stderr ?? ""}`, result.status);
}

function parseRun(output, exitCode) {
  const match = output.match(ALL_FILES);
  const ok = exitCode === 0;
  return {
    ok,
    exitCode,
    functions: ok && match ? Number(match[1]) : undefined,
    lines: ok && match ? Number(match[2]) : undefined,
    // Only a failing run keeps a tail: a green row must stay byte-identical.
    tail: ok && match ? "" : redactTail(tailOf(output)),
  };
}

// Plan 115 Task 6: the stage already ran the core suite and captured its output, so the
// core row reuses that run instead of spawning a second ~36 s one. The seam is trusted only
// as a pair — both vars set, exit code 0, capture present — and the capture is unlinked once
// it is read, so a failed run, a missing file, or a leftover from an earlier run falls back
// to a real measurement instead of reporting a stale number.
// ponytail: the capture is one file at a fixed path that the runner deletes when the stage
// ends; a crash between the two steps leaves it in gitignored node_modules until the next
// run overwrites it.
function capturedCoreRun() {
  if (process.env.PRISM_COVERAGE_CORE_EXIT !== "0") return undefined;
  const captured = process.env.PRISM_COVERAGE_CORE_OUTPUT;
  if (!captured || !existsSync(captured)) return undefined;
  const output = readFileSync(captured, "utf8");
  unlinkSync(captured);
  return parseRun(output, 0);
}

function printTail(run) {
  if ((run.ok && run.lines !== undefined) || !run.tail) return;
  console.log(`    ── child output (last ${TAIL_LINES} lines of stdout+stderr, redacted) ──`);
  for (const line of run.tail.split("\n")) console.log(`    ${line}`);
}

function format(name, run, note) {
  if (run.lines === undefined) return `  ${name.padEnd(32)} no coverage data${run.ok ? "" : " (suite failed)"}`;
  const cells = [`functions ${run.functions.toFixed(2).padStart(6)}`, `lines ${run.lines.toFixed(2).padStart(6)}`];
  return `  ${name.padEnd(32)} ${cells.join("  ")}${note ? `  ${note}` : ""}`;
}

// Proxy for the coverage denominator: .js files under dist/ (tests excluded).
function findTestFiles(packageDir) {
  const dist = join(packageDir, "dist");
  if (!existsSync(dist)) return [];
  const tests = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".test.js")) tests.push(relative(packageDir, p));
    }
  };
  walk(dist);
  return tests;
}

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

const coreThreshold = thresholds.core;
if (!coreThreshold || !Number.isFinite(coreThreshold.lines) || !Number.isFinite(coreThreshold.functions)) {
  console.error(`coverage-summary: ${THRESHOLDS_PATH} needs a core { lines, functions } entry (Bun-measured floors)`);
  process.exit(1);
}
const CORE_GATE = `lines>=${coreThreshold.lines.toFixed(2)} functions>=${coreThreshold.functions.toFixed(2)}`;

let anyFailed = false;
const artifact = { captured: new Date().toISOString(), core: {}, packages: {}, belowThreshold: [] };

console.log(`Combined coverage summary (bun test --coverage; core gate ${CORE_GATE} + per-package lines thresholds; protected exempt)`);
const core = capturedCoreRun() ?? runCoverage(findTestFiles(root));
let corePass = true;
let coreNote = `[gate ${CORE_GATE}]`;
if (core.lines === undefined) {
  corePass = false;
  coreNote = core.ok ? "no coverage data" : "(suite failed)";
} else if (core.lines < coreThreshold.lines || core.functions < coreThreshold.functions) {
  corePass = false;
  coreNote = `[FAIL lines ${core.lines.toFixed(2)}/${coreThreshold.lines.toFixed(2)} functions ${core.functions.toFixed(2)}/${coreThreshold.functions.toFixed(2)}]`;
}
console.log(format("@arnilo/prism (core)", core, coreNote));
printTail(core);
artifact.core = {
  lines: core.lines ?? null,
  branches: null,
  functions: core.functions ?? null,
  pass: corePass,
  gate: CORE_GATE,
  ...failureRow(core),
};
if (!corePass) anyFailed = true;

const workspaceNames = readdirSync(packagesDir)
  .filter((name) => existsSync(join(packagesDir, name, "package.json")))
  .filter((name) => findTestFiles(join(packagesDir, name)).length > 0)
  .sort();
for (const name of workspaceNames) {
  const pkg = JSON.parse(readFileSync(join(packagesDir, name, "package.json"), "utf8"));
  const pkgName = pkg.name ?? name;
  const testFiles = findTestFiles(join(packagesDir, name));
  const run = testFiles.length ? runCoverage(testFiles, join(packagesDir, name)) : { ok: true, lines: undefined, functions: undefined };
  const thresholdEntry = thresholds.packages?.[pkgName];
  const denominatorFiles = countDenominatorFiles(join(packagesDir, name));
  if (!thresholdEntry) {
    // Fail-closed: a workspace with no evidence-based threshold is a config gap.
    console.error(`coverage-summary: ${pkgName} has no threshold entry in ${THRESHOLDS_PATH}`);
    console.log(format(pkgName, run, "NO THRESHOLD ENTRY"));
    printTail(run);
    artifact.packages[pkgName] = {
      lines: run.lines ?? null,
      branches: null,
      functions: run.functions ?? null,
      denominatorFiles,
      threshold: null,
      pass: false,
      protectedException: null,
      ...failureRow(run),
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
  printTail(run);
  artifact.packages[pkgName] = {
    lines: run.lines ?? null,
    branches: null,
    functions: run.functions ?? null,
    denominatorFiles,
    threshold,
    pass,
    protectedException,
    ...failureRow(run),
  };
  if (!run.ok) anyFailed = true;
}

writeFileSync(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(
  `\n${workspaceNames.length} workspace suites + core reported. Core gate ${CORE_GATE}; per-package lines thresholds enforced (protected exempt). Artifact: ${ARTIFACT_PATH}`,
);
if (anyFailed) {
  console.error("coverage-summary: failures above — a suite failed or a non-protected package regressed below its threshold");
  process.exit(1);
}
