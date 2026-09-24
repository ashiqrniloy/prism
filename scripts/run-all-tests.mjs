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
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readManifest } from "./package-truth.mjs";

const ROOT = join(import.meta.dirname, "..");

// The gate segment, unchanged from the pre-runner chain (plan 070 Task 15) plus
// this runner's own regression test. The timing-sensitive performance budget runs
// alone below. Retired `phase<N>-(freeze|release)` gates
// stay OUT: they are immutable release evidence, audited standalone (see
// scripts/truth-current.test.mjs). scripts/run-all-tests.test.mjs asserts both
// halves of that policy against this list, so it can never pass by being empty.
export const GATE_FILES = [
  "scripts/release-gate.test.mjs",
  "scripts/tooling-gate.test.mjs",
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
  "scripts/host-completeness-evidence.test.mjs",
  "scripts/attention-measurements.test.mjs",
  "scripts/plan-review-gate.test.mjs",
  "scripts/phase23-quality-gates.test.mjs",
  "scripts/phase24-truth.test.mjs",
  "scripts/phase25-bounded-accumulation.test.mjs",
  "scripts/phase27-ha.test.mjs",
  "scripts/phase27-erp-journey.test.mjs",
  "scripts/phase37-provider-matrix.test.mjs",
  "scripts/phase26-index-benchmark.test.mjs",
  "scripts/obscura-host-conformance.test.mjs",
  "scripts/phase54-package-map.test.mjs",
  "scripts/phase54-legacy-registry-dry-run.test.mjs",
  "scripts/phase54-legacy-registry-apply.test.mjs",
  "scripts/phase54-legacy-registry-fail-closed.test.mjs",
  "scripts/truth-current.test.mjs",
  "scripts/scan-secrets.test.mjs",
  "scripts/packaging-current.test.mjs",
  "scripts/import-hygiene.test.mjs",
  "scripts/live-matrix.test.mjs",
  "scripts/e2e-coverage.test.mjs",
  "scripts/live-doc-check.test.mjs",
  "scripts/version-literal-gate.test.mjs",
  "scripts/workflow-liveness.test.mjs",
  "scripts/wiki-scratch-isolation.test.mjs",
  "scripts/blocked-gate.test.mjs",
  "scripts/branch-coverage.test.mjs",
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

// Plan 113 Task 3: the measured runner split. `bun test --timeout=0` owns the one file set Task 1's
// inventory classified `bun-ok` and this task measured faster than `node --test` (the SQLite suites:
// 24 pass / 0 fail, 356–369 ms vs 388–407 ms). Everything else stays on Node: the root glob is 2.3×
// slower under Bun (30.1 s vs 13.2 s, Task 1 §4) with a Bun-only failure, the prism-core workspace
// glob is 2.4× slower (8.9 s vs 3.7 s, Task 3 note), `bun --test` is not `node --test` (Task 1 §1.2),
// and coverage migration is plan 114's. Children spawn `node` / `bun` by name: under a Bun parent the
// Node binary is not `process.execPath`, and `bun run --bun` (which symlinks `node` to Bun) is rejected.
export const SQLITE_TEST_GLOB = "packages/prism-core/dist/sessions/sqlite/__tests__/*.test.js";

// Plan 115 Task 2: the workspace stage runs one npm process per package behind a bounded
// pool instead of npm's serial `--workspaces` loop. Task 1 measured the lock as the real
// bound (a concurrent executor alone recovered nothing because every leaf took the
// exclusive lock), so each package's `test` script takes the shared reader mode and the
// pool below overlaps them. `--if-present` keeps npm's skip-a-package-without-test rule.
const WORKSPACE_LEAVES = readManifest(join(ROOT, "package.json")).workspaces.map((dir) => ({
  name: dir,
  command: "npm",
  args: ["run", "test", "--workspace", dir, "--if-present"],
}));

// The dist-consuming suites run behind the build lock (they import root dist/ via
// the @arnilo/prism self-symlink); the build-race gate runs UNWRAPPED on purpose —
// its children acquire the real lock, which a parent holding it would deadlock.
export const STAGES = [
  { name: "build", command: "npm", args: ["run", "build"] },
  {
    // The cold-import check cannot share Node's default parallel test worker pool:
    // its absolute ceiling measures host contention, not Prism import work.
    name: "performance budget",
    command: "node",
    args: ["scripts/with-build-lock.mjs", "node", "--test", "scripts/budget-gate.test.mjs"],
  },
  {
    name: "root suites",
    command: "node",
    args: ["scripts/with-build-lock.mjs", "node", "--test", "dist/__tests__/*.test.js"],
  },
  {
    // Task 1 measured this file set `bun-ok` (the database actually opens `:memory:`). `--timeout=0`
    // matches Node's no-default-timeout — Bun's default 5000 ms would fail a slow test Node never
    // times out — and per-test `{ timeout }` options still fire. prism-core's own Node run excludes
    // this glob, so each SQLite file runs exactly once.
    name: "sqlite suites",
    command: "node",
    args: ["scripts/with-build-lock.mjs", "bun", "test", "--timeout=0", SQLITE_TEST_GLOB],
  },
  {
    name: "gate suites",
    command: "node",
    args: ["scripts/with-build-lock.mjs", "node", "--test", ...GATE_FILES],
  },
  { name: "build race", command: "node", args: ["--test", "scripts/phase23-build-race.test.mjs"] },
  {
    // packages are independent readers (shared lock), so run them concurrently;
    // a bounded pool keeps package suites from thrashing a small host.
    // ponytail: fixed 2 workers, not 4 — measured 2026-09-23, the workspace suites carry
    // soft real-time budget assertions (prism-work document extract < 2000 ms, memory
    // source-scan < 5 ms) that flaked at 3–4 concurrent leaves (3 leaf failures in 9 pool runs)
    // but stayed green at 2 (2/2). Raise the bound only on a host with idle cores, or bound
    // each package's own `node --test` worker count first.
    name: "workspace suites",
    parallel: WORKSPACE_LEAVES,
    concurrency: 2,
  },
  {
    // Plan 120 Task 7. Sequential .ts spawns so each child loads one type stripper.
    // ponytail: sequential; Promise.allSettled chunks if this stage exceeds 5 min.
    name: "examples execution",
    command: "node",
    args: ["scripts/with-build-lock.mjs", "node", "--test", "scripts/examples-execution.test.mjs"],
  },
  {
    // Plan 120 Task 6. Core dist only, after the build. Bun's coverage gate is untouched.
    name: "branch coverage",
    command: "node",
    args: ["scripts/with-build-lock.mjs", "node", "scripts/branch-coverage-audit.mjs"],
  },
];

// Glob expansion happens at run time only: importing this module never reads the tree.
function stageArgs(stage) {
  return stage.args.flatMap(expandGlob);
}

function renderStage(stage) {
  if (stage.parallel) {
    return `parallel(${stage.concurrency}): ${stage.parallel.map((leaf) => [leaf.command, ...leaf.args].join(" ")).join(" | ")}`;
  }
  return [stage.command, ...stage.args].join(" ");
}

/** `package.json` `test` plus every stage command — the effective `npm test` chain. */
export function effectiveTestChain(rootDir = ROOT) {
  const { scripts } = readManifest(join(rootDir, "package.json"));
  return [scripts.test, ...STAGES.map(renderStage)].join(" && ");
}

function spawnStage(leaf) {
  return new Promise((resolve) => {
    const child = spawn(leaf.command, stageArgs(leaf), { cwd: ROOT, env: process.env, stdio: "inherit" });
    child.on("error", (error) => {
      process.stderr.write(`${leaf.name ?? leaf.command}: ${error.message}\n`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1)); // signal-killed stages have a null code
  });
}

/**
 * Run every leaf through a fixed-size worker pool. Every leaf still runs and streams its
 * own output after a failure, and the caller fails the stage if any leaf failed — the
 * guarantee npm's serial workspace loop gave, now without serializing the stage.
 * Exported so the runner's test can assert the bound and the failure path with fake leaves.
 */
export async function runParallelLeaves(leaves, concurrency, execute = spawnStage) {
  const queue = [...leaves];
  const results = [];
  const size = Math.max(1, Math.min(concurrency, queue.length));
  await Promise.all(
    Array.from({ length: size }, async () => {
      for (let leaf = queue.shift(); leaf; leaf = queue.shift()) {
        results.push({ name: leaf.name, status: await execute(leaf) });
      }
    }),
  );
  return { results, failed: results.filter((result) => result.status !== 0) };
}

async function executeStage(stage) {
  if (!stage.parallel) return spawnStage(stage);
  const { failed } = await runParallelLeaves(stage.parallel, stage.concurrency ?? 4);
  if (failed.length) {
    process.stderr.write(`${stage.name}: ${failed.length} leaf(s) failed: ${failed.map((leaf) => leaf.name).join(", ")}\n`);
  }
  return failed.length === 0 ? 0 : 1;
}

/** Run every stage, report one table, never short-circuit. Returns `{ results, failed }`. */
export async function runStages(stages = STAGES, { execute = executeStage, write = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const results = [];
  for (const stage of stages) {
    write(`\n▶ ${stage.name}`);
    const startedAt = Date.now();
    let status;
    try {
      status = await execute(stage);
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
  const { failed } = await runStages();
  if (failed.length) process.exitCode = 1;
}
