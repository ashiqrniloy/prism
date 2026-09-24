#!/usr/bin/env node
/**
 * Plan 120 Task 6. Node branch-coverage audit for the core dist suite.
 * Bun's gate stays `branches: null` (plan 114). This script does not replace it.
 *
 * # ponytail: Node's instrument measures branches Bun cannot (plan 114 row 11).
 * Two instruments means two floor semantics. Upgrade path: one instrument when Bun ships BRDA.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(import.meta.dirname, "..");
export const ARTIFACT = join(root, "scripts", "branch-coverage-summary.json");
export const BRANCH_FLOOR = 83.49;

export function parseBranchCoverage(output) {
  const matches = [...output.matchAll(/all files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/gi)];
  const match = matches.at(-1);
  if (!match) return undefined;
  return { lines: Number(match[1]), branches: Number(match[2]), functions: Number(match[3]) };
}

// Wall-clock asserts flake under this instrument. The uninstrumented root suite owns them.
// # ponytail: message match, not a file allowlist. A non-timing failure still fails the stage.
const TIMING_ASSERT = /(?:took|was) [\d.]+ ?ms|exceeds frozen \d+% cap|exceeds \d+ ?ms ceiling/;

/** True only when every recorded failure is an instrumented timing assert. */
export function isKnownFlake(output, exitCode) {
  if (exitCode === 0) return false;
  const fails = [...output.matchAll(/^ℹ fail (\d+)\s*$/gm)];
  const count = Number(fails.at(-1)?.[1]);
  if (!Number.isInteger(count) || count < 1) return false;
  const messages = [...output.matchAll(/AssertionError(?: \[ERR_ASSERTION\])?: ([^\n]+)/g)].map((match) => match[1]);
  if (messages.length !== count) return false;
  return messages.every((message) => TIMING_ASSERT.test(message));
}

export function assertBranchFloor(artifact) {
  const branches = artifact?.core?.branches;
  if (!Number.isFinite(branches)) throw new Error("branch-coverage: artifact missing numeric core.branches");
  if (branches < BRANCH_FLOOR) {
    const delta = (BRANCH_FLOOR - branches).toFixed(2);
    throw new Error(`branch-coverage: core branches ${branches.toFixed(2)} is ${delta}pp below floor ${BRANCH_FLOOR}`);
  }
}

function coreTests() {
  const dir = join(root, "dist", "__tests__");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".test.js"))
    .sort()
    .map((name) => join("dist", "__tests__", name));
}

function tail(output) {
  return output
    .split(root)
    .join("<repo>")
    .split(process.env.HOME || "\u0000")
    .join("<home>")
    .split("\n")
    .slice(-40)
    .join("\n");
}

function writeArtifact(artifact) {
  let next = artifact;
  try {
    const prev = JSON.parse(readFileSync(ARTIFACT, "utf8"));
    if (prev.core?.branches === artifact.core.branches) next = { ...artifact, measuredAt: prev.measuredAt };
  } catch {
    // first write
  }
  writeFileSync(ARTIFACT, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function auditBranchCoverage() {
  const files = coreTests();
  if (files.length === 0) {
    console.error("branch-coverage: no dist/__tests__ — run npm run build first");
    return 1;
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("NODE_TEST_")));
  const started = Date.now();
  const result = spawnSync(
    "node",
    ["--test", "--experimental-test-coverage", "--test-coverage-include=dist/**", "--test-coverage-exclude=dist/__tests__/**", ...files],
    { cwd: root, encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024, timeout: 180_000 },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.error) {
    console.error(`branch-coverage: ${result.error.message}`);
    return 1;
  }
  const parsed = parseBranchCoverage(output);
  if (!parsed) {
    console.error("branch-coverage: no all-files branch column");
    console.error(tail(output));
    return 1;
  }
  const flake = isKnownFlake(output, result.status ?? 1);
  const artifact = writeArtifact({
    measuredAt: new Date().toISOString(),
    core: { branches: Math.round(parsed.branches * 100) / 100 },
  });
  const ms = Date.now() - started;
  console.log(`branch-coverage: core branches ${artifact.core.branches.toFixed(2)} (${ms}ms)`);
  if (flake) console.log("branch-coverage: ignored instrumented timing assertion(s); floor still applies");
  try {
    assertBranchFloor(artifact);
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  if ((result.status ?? 1) !== 0 && !flake) {
    console.error("branch-coverage: suite failed for a reason other than an instrumented timing assertion");
    console.error(tail(output));
    return 1;
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = auditBranchCoverage();
}
