#!/usr/bin/env node
/**
 * Plan 120 Task 6. Node branch-coverage audit for the core dist suite.
 * Bun's gate stays `branches: null` (plan 114). This script does not replace it.
 *
 * # ponytail: Node's instrument measures branches Bun cannot (plan 114 row 11).
 * Two instruments means two floor semantics. Upgrade path: probeBunBranchRecords()
 * fails this stage when Bun ships BRDA; then delete this Node spawn.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
  // Distinct messages: the reporter repeats each failure in its summary block.
  const messages = new Set([...output.matchAll(/AssertionError(?: \[ERR_ASSERTION\])?: ([^\n]+)/g)].map((match) => match[1]));
  if (messages.size !== count) return false;
  return [...messages].every((message) => TIMING_ASSERT.test(message));
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

/** Failing test names and messages first: the coverage table floods `tail`. */
function failureDigest(output) {
  const cleaned = output
    .split(root)
    .join("<repo>")
    .split(process.env.HOME || "\u0000")
    .join("<home>");
  const names = [...new Set([...cleaned.matchAll(/^\s*[\u2716\u00d7] (.+)$/gm)].map((match) => match[1]))];
  const messages = [
    ...new Set([...cleaned.matchAll(/(?:AssertionError(?: \[ERR_ASSERTION\])?|Error): ([^\n]+)/g)].map((match) => match[1])),
  ];
  return [...names.slice(0, 12), ...messages.slice(0, 12)].join("\n");
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

/** True when lcov contains branch records. Bun 1.4.2 emits line/function records only. */
export function lcovHasBranchRecords(lcov) {
  return /^BRDA:/m.test(lcov);
}

/**
 * One covered if/else under `bun test --coverage`. True only when this Bun emits `BRDA`.
 * # ponytail: temp dir, one file. The Node instrument below is the thing this replaces.
 */
export function probeBunBranchRecords() {
  const dir = mkdtempSync(join(tmpdir(), "prism-brda-"));
  try {
    writeFileSync(join(dir, "sample.ts"), "export function sign(n) {\n  if (n > 0) return 1;\n  if (n < 0) return -1;\n  return 0;\n}\n");
    writeFileSync(
      join(dir, "sample.test.ts"),
      'import assert from "node:assert/strict";\nimport { test } from "bun:test";\nimport { sign } from "./sample.ts";\ntest("branches", () => {\n  assert.equal(sign(1), 1);\n  assert.equal(sign(-1), -1);\n  assert.equal(sign(0), 0);\n});\n',
    );
    const result = spawnSync("bun", ["test", "--coverage", "--coverage-reporter=lcov"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 60_000,
    });
    let lcov = "";
    try {
      lcov = readFileSync(join(dir, "coverage", "lcov.info"), "utf8");
    } catch {
      lcov = "";
    }
    if ((result.status ?? 1) !== 0 || !lcov) {
      const detail = (result.stderr || result.error?.message || `exit ${result.status}`).split("\n")[0];
      throw new Error(`branch-coverage: Bun BRDA probe failed: ${detail}`);
    }
    return lcovHasBranchRecords(lcov);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function auditBranchCoverage() {
  if (probeBunBranchRecords()) {
    console.error(
      "branch-coverage: Bun now emits BRDA. Delete this Node spawn and the NODE_SPAWN_EXCEPTIONS entry for scripts/branch-coverage-audit.mjs (plan 127 §14).",
    );
    return 1;
  }
  const files = coreTests();
  if (files.length === 0) {
    console.error("branch-coverage: no dist/__tests__ — run bun run build first");
    return 1;
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("NODE_TEST_")));
  const started = Date.now();
  const shimDir = mkdtempSync(join(tmpdir(), "prism-node-bun-shim-"));
  let result;
  try {
    const shimPath = join(shimDir, "shim.mjs");
    const loaderPath = join(shimDir, "loader.mjs");
    writeFileSync(
      shimPath,
      [
        `import * as nodeTest from ${JSON.stringify("node:test")};`,
        "export const describe = nodeTest.describe;",
        "export const it = nodeTest.it;",
        "export const test = nodeTest.test;",
        "export const before = nodeTest.before;",
        "export const after = nodeTest.after;",
        "export const beforeAll = nodeTest.before;",
        "export const afterAll = nodeTest.after;",
        "export const beforeEach = nodeTest.beforeEach;",
        "export const afterEach = nodeTest.afterEach;",
        "function skipIf(condition) { return condition ? this.skip : this; }",
        "if (!describe.skipIf) describe.skipIf = skipIf.bind(describe);",
        "if (!it.skipIf) it.skipIf = skipIf.bind(it);",
        "if (!test.skipIf) test.skipIf = skipIf.bind(test);",
        "export default nodeTest;",
      ].join("\n"),
    );
    writeFileSync(
      loaderPath,
      [
        'import { registerHooks } from "node:module";',
        "registerHooks({",
        "  resolve(specifier, context, nextResolve) {",
        '    if (specifier === "bun:test") {',
        '      return { format: "module", shortCircuit: true, url: new URL("./shim.mjs", import.meta.url).href };',
        "    }",
        "    return nextResolve(specifier, context);",
        "  }",
        "});",
      ].join("\n"),
    );
    result = spawnSync(
      "node",
      [
        "--import",
        loaderPath,
        "--test",
        "--experimental-test-coverage",
        "--test-coverage-include=dist/**",
        "--test-coverage-exclude=dist/__tests__/**",
        ...files,
      ],
      { cwd: root, encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024, timeout: 180_000 },
    );
  } finally {
    rmSync(shimDir, { recursive: true, force: true });
  }
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
    console.error(failureDigest(output));
    console.error(tail(output));
    return 1;
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = auditBranchCoverage();
}
