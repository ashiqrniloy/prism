#!/usr/bin/env node
// Plan 070 Task 15: aggregate the root `npm test` chain.
//
// The chain used to be a single `&&` list, so the first failing stage hid every
// later one (VENT 26-08-15/26-08-20/26-09-01: hidden failures and the count drift
// they caused). This runner executes the same stages in the same order, always
// runs all of them, prints one summary table, and exits non-zero if any stage
// failed. Stage output is inherited unchanged, so each stage's own TAP summary —
// including its skip lines (release skip-manifest evidence) — still streams.
//
//   npm test
//   node scripts/run-all-tests.mjs
//
// Import-safe (no writes, no exit at module scope) so chain-integrity gate tests
// can assert the effective chain: `effectiveTestChain()`, `STAGES`, `runStages()`.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readManifest } from "./package-truth.mjs";

const ROOT = join(import.meta.dirname, "..");

// The gate segment, unchanged from the pre-runner chain (plan 070 Task 15) plus
// this runner's own regression test. Retired `phase<N>-(freeze|release)` gates
// stay OUT: they are immutable release evidence, audited standalone (see
// scripts/truth-current.test.mjs). scripts/run-all-tests.test.mjs asserts both
// halves of that policy against this list, so it can never pass by being empty.
export const GATE_FILES = [
  "scripts/release-gate.test.mjs",
  "scripts/tooling-gate.test.mjs",
  "scripts/budget-gate.test.mjs",
  "scripts/run-all-tests.test.mjs",
  "scripts/phase8-conformance.test.mjs",
  "scripts/phase9-conformance.test.mjs",
  "scripts/phase10-conformance.test.mjs",
  "scripts/phase11-conformance.test.mjs",
  "scripts/benchmark-0.1.0.test.mjs",
  "scripts/benchmark-multi-agent.test.mjs",
  "scripts/benchmark-tool-search.test.mjs",
  "scripts/benchmark-workflow-loop.test.mjs",
  "scripts/benchmark-redaction.test.mjs",
  "scripts/sweep-unused.test.mjs",
  "scripts/dead-export-verify.test.mjs",
  "scripts/e2e-enterprise-journey.test.mjs",
  "scripts/e2e-coding-journey.test.mjs",
  "scripts/e2e-full-surface.test.mjs",
  "scripts/phase23-quality-gates.test.mjs",
  "scripts/phase24-truth.test.mjs",
  "scripts/phase25-bounded-accumulation.test.mjs",
  "scripts/phase27-ha.test.mjs",
  "scripts/phase27-erp-journey.test.mjs",
  "scripts/phase37-provider-matrix.test.mjs",
  "scripts/phase26-index-benchmark.test.mjs",
  "scripts/obscura-host-conformance.test.mjs",
  "scripts/phase54-package-map.test.mjs",
  "scripts/phase54-legacy-registry.test.mjs",
  "scripts/truth-current.test.mjs",
  "scripts/packaging-current.test.mjs",
  "scripts/import-hygiene.test.mjs",
  "scripts/live-matrix.test.mjs",
  "scripts/e2e-coverage.test.mjs",
  "scripts/live-doc-check.test.mjs",
  "scripts/version-literal-gate.test.mjs",
  "scripts/workflow-liveness.test.mjs",
  "scripts/wiki-scratch-isolation.test.mjs",
  "scripts/blocked-gate.test.mjs",
];

// The old chain left `dist/__tests__/*.test.js` to the shell. There is no shell
// here, and `node --test <dir>`/glob args are only understood from Node 22, so this
// stays inside the shell-free runner (which also names a missing build clearly)
// even though the declared floor is now >=22 (plan 071 Task 2).
function expandGlob(arg) {
  const star = arg.indexOf("*");
  if (star === -1) return [arg];
  const dir = arg.slice(0, star).replace(/\/$/, "") || ".";
  const suffix = arg.slice(star + 1);
  let files;
  try {
    files = readdirSync(dir).filter((file) => file.endsWith(suffix));
  } catch (error) {
    throw new Error(`cannot read ${dir}: ${error.message} (build first)`);
  }
  if (files.length === 0) throw new Error(`no files match ${arg} (build first)`);
  return files.sort().map((file) => join(dir, file));
}

// The dist-consuming suites run behind the build lock (they import root dist/ via
// the @arnilo/prism self-symlink); the build-race gate runs UNWRAPPED on purpose —
// its children acquire the real lock, which a parent holding it would deadlock.
export const STAGES = [
  { name: "build", command: "npm", args: ["run", "build"] },
  {
    name: "root suites",
    command: process.execPath,
    args: ["scripts/with-build-lock.mjs", process.execPath, "--test", "dist/__tests__/*.test.js"],
  },
  {
    name: "gate suites",
    command: process.execPath,
    args: ["scripts/with-build-lock.mjs", process.execPath, "--test", ...GATE_FILES],
  },
  { name: "build race", command: process.execPath, args: ["--test", "scripts/phase23-build-race.test.mjs"] },
  { name: "workspace suites", command: "npm", args: ["run", "test", "--workspaces", "--if-present"] },
];

// Glob expansion happens at run time only: importing this module never reads the tree.
function stageArgs(stage) {
  return stage.args.flatMap(expandGlob);
}

function renderStage(stage) {
  const command = stage.command === process.execPath ? "node" : stage.command;
  return [command, ...stage.args.map((arg) => (arg === process.execPath ? "node" : arg))].join(" ");
}

/** `package.json` `test` plus every stage command — the effective `npm test` chain. */
export function effectiveTestChain(rootDir = ROOT) {
  const { scripts } = readManifest(join(rootDir, "package.json"));
  return [scripts.test, ...STAGES.map(renderStage)].join(" && ");
}

function executeStage(stage) {
  const result = spawnSync(stage.command, stageArgs(stage), { cwd: ROOT, env: process.env, stdio: "inherit" });
  if (result.error) {
    process.stderr.write(`${stage.name}: ${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1; // signal-killed stages have a null status
}

/** Run every stage, report one table, never short-circuit. Returns `{ results, failed }`. */
export function runStages(stages = STAGES, { execute = executeStage, write = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const results = [];
  for (const stage of stages) {
    write(`\n▶ ${stage.name}`);
    const startedAt = Date.now();
    let status;
    try {
      status = execute(stage);
    } catch (error) {
      process.stderr.write(`${stage.name}: ${error.message}\n`);
      status = 1;
    }
    results.push({ name: stage.name, status, ms: Date.now() - startedAt });
  }
  write("");
  write("npm test summary:");
  for (const result of results) {
    write(`  ${result.status === 0 ? "pass" : "FAIL"}  ${String(result.ms).padStart(7)}ms  ${result.name}`);
  }
  const failed = results.filter((result) => result.status !== 0);
  write(
    failed.length
      ? `\n${failed.length} of ${results.length} stages failed: ${failed.map((result) => result.name).join(", ")}`
      : `\nall ${results.length} stages passed`,
  );
  return { results, failed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { failed } = runStages();
  if (failed.length) process.exitCode = 1;
}
