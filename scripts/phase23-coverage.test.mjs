// scripts/phase23-coverage.test.mjs — Task 2 regression.
//
// Runs at the END of `npm run test:coverage`, immediately AFTER coverage-summary.mjs
// wrote the real artifact (scripts/coverage-summary.json), so the well-formedness and
// reproduction checks read it directly. The fail-closed check spawns ONE extra run with
// PRISM_COVERAGE_THRESHOLDS + PRISM_COVERAGE_ARTIFACT overrides (sabotaged temp files),
// so the real thresholds JSON and the real artifact are never touched.
//
// Denominator proof: @arnilo/prism-mcp imported root core dist in the 0.2.2 run and
// reported 45.47 lines (polluted, Node instrument); its Bun freeze threshold here is
// 91.32 (recompute 94.32 - 3pp). The `lines >= threshold` gate failing for mcp would
// therefore be the observable symptom of a broken package-local bunfig filter.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { failureRow, MAX_TAIL_CHARS, TAIL_LINES, tailOf } from "./coverage-failure.mjs";
import { computePackageTruth } from "./package-truth.mjs";

const ROOT = join(import.meta.dirname, "..");
const SUMMARY = join(ROOT, "scripts", "coverage-summary.mjs");
const THRESHOLDS = join(ROOT, "scripts", "coverage-thresholds.json");
const ARTIFACT = join(ROOT, "scripts", "coverage-summary.json");
const PACKAGES = join(ROOT, "packages");

const source = readFileSync(SUMMARY, "utf8");
const thresholds = JSON.parse(readFileSync(THRESHOLDS, "utf8"));

// Mirrors coverage-summary.mjs's workspace discovery (any *.test.js under dist/,
// recursively: acp-agent builds to dist/src/__tests__, work to dist/<area>/__tests__).
function hasTestJs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (hasTestJs(path)) return true;
    } else if (entry.name.endsWith(".test.js")) {
      return true;
    }
  }
  return false;
}

const hasDistTests = (name) => {
  const dist = join(PACKAGES, name, "dist");
  return existsSync(dist) && hasTestJs(dist);
};

const workspaceDirs = readdirSync(PACKAGES)
  .filter((n) => existsSync(join(PACKAGES, n, "package.json")))
  .sort();
const workspaceNames = workspaceDirs.filter(hasDistTests);
const pkgName = (n) => JSON.parse(readFileSync(join(PACKAGES, n, "package.json"), "utf8")).name ?? n;
const workspacePackageNames = workspaceDirs.map(pkgName).sort();

function assertArtifactPackageNames(artifact) {
  assert.deepEqual(
    Object.keys(artifact.packages).sort(),
    workspacePackageNames,
    "coverage artifact package keys must exactly match live workspace manifests",
  );
}

// Plan 070 Task 7: the live workspace graph from the manifest truth (root excluded —
// @arnilo/prism is the core row, never a workspace row in the thresholds file).
const truth = computePackageTruth();
const liveWorkspaceNames = new Set(Object.keys(truth.versions).filter((name) => name !== truth.root.name));
const retiredThresholdRows = (packages) => Object.keys(packages).filter((name) => !liveWorkspaceNames.has(name));

function runSummary(env) {
  return spawnSync(process.execPath, [SUMMARY], { encoding: "utf8", env: { ...process.env, ...env } });
}

test("workspace rows use the package-local bunfig; core row parses Bun's All files", () => {
  // Bun 1.4.2 reads coveragePathIgnorePatterns only from $cwd/bunfig.toml (plan 114
  // evidence §1.6), so every gated workspace carries its own filter file and the
  // summary spawns `bun test --coverage` from the package directory.
  assert.match(source, /spawnSync\("bun", \["test", "--coverage", "--timeout=0"/, "runs must spawn bun test --coverage");
  assert.ok(!source.includes("--experimental-test-coverage"), "the Node coverage instrument must be gone");
  for (const name of workspaceNames) {
    const bunfig = join(PACKAGES, name, "bunfig.toml");
    assert.ok(existsSync(bunfig), `${name} needs a package-local bunfig.toml for coverage scoping`);
    assert.match(
      readFileSync(bunfig, "utf8"),
      /coveragePathIgnorePatterns = \["\.\.\/\*\*"\]/,
      `${name} must scope the row to its own dist`,
    );
  }
  assert.match(
    readFileSync(join(ROOT, "bunfig.toml"), "utf8"),
    /coveragePathIgnorePatterns = \["\*\*\/packages\/\*\*", "\*\*\/scripts\/\*\*", "\*\*\/examples\/\*\*", "\.\.\/\*\*"\]/,
    "the root bunfig must scope the core row",
  );
  assert.match(source, /ponytail:[\s\S]*?branch/, "the dropped branch floor must keep its ponytail: ceiling note");
  assert.match(source, /branches: null/, "rows must record branches: null, never a stale number");
});

test("default scripts carry the Bun instrument, never the Node one", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const script = pkg.scripts["test:coverage"];
  assert.match(script, /bun test --coverage --timeout=0/, "test:coverage must run the Bun instrument");
  assert.equal((script.match(/bun test --coverage/g) ?? []).length, 1, "the stage must measure the core suite exactly once");
  assert.match(
    script,
    /PRISM_COVERAGE_CORE_OUTPUT=node_modules\/\.prism-core-coverage\.out PRISM_COVERAGE_CORE_EXIT=\$core_exit/,
    "the stage must hand its captured core run to the summary instead of letting it re-spawn",
  );
  assert.match(script, /rm -f node_modules\/\.prism-core-coverage\.out/, "the stage must clean its capture up");
  assert.ok(
    !JSON.stringify(pkg.scripts).includes("--experimental-test-coverage"),
    "no default script may keep --experimental-test-coverage",
  );
});

// A fake `bun` on PATH that records every spawn and fails: a test can then prove WHICH runs the
// summary spawned (a count, not a wall clock) without touching the real instrument.
function fakeBun(dir, body = "") {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const log = join(dir, "spawns.log");
  writeFileSync(join(bin, "bun"), `#!/bin/sh\necho "$@" >> ${log}\n${body}exit 3\n`);
  chmodSync(join(bin, "bun"), 0o755);
  return { log, path: `${bin}:${process.env.PATH}` };
}
const spawnCount = (log) =>
  existsSync(log)
    ? readFileSync(log, "utf8")
        .split("\n")
        .filter((line) => line.trim()).length
    : 0;

function withTempDir(name, body) {
  const realArtifact = existsSync(ARTIFACT) ? readFileSync(ARTIFACT, "utf8") : null;
  const dir = mkdtempSync(join(tmpdir(), name));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(readFileSync(ARTIFACT, "utf8"), realArtifact, "the real artifact must be untouched");
}

test("one measurement: the summary reads the captured core run and spawns only for workspaces", () => {
  withTempDir("prism-cov-seam-", (dir) => {
    const { log, path } = fakeBun(dir);
    const captured = join(dir, "core.out");
    writeFileSync(captured, "\n All files | 99.60 | 99.50\n");
    const tempArtifact = join(dir, "artifact.json");
    const r = runSummary({
      PRISM_COVERAGE_ARTIFACT: tempArtifact,
      PRISM_COVERAGE_CORE_OUTPUT: captured,
      PRISM_COVERAGE_CORE_EXIT: "0",
      PATH: path,
    });
    const artifact = JSON.parse(readFileSync(tempArtifact, "utf8"));
    assert.deepEqual(
      [artifact.core.lines, artifact.core.functions, artifact.core.pass],
      [99.5, 99.6, true],
      "the core row must be the captured run's numbers",
    );
    assert.ok(!("status" in artifact.core), "a reused passing run keeps the green row shape byte-for-byte");
    assert.match(r.stdout, /@arnilo\/prism \(core\)\s+functions\s+99\.60\s+lines\s+99\.50/, "the printed row is the captured one");
    assert.equal(spawnCount(log), workspaceNames.length, "only the workspace rows may spawn bun (no core re-run)");
    assert.ok(!existsSync(captured), "the consumed capture is unlinked, so nothing can reuse it");
    assert.notEqual(r.status, 0, "the fake bun fails every workspace row — the core row stays green");
  });
});

test("standalone: with no seam set the summary still measures the core suite itself", () => {
  withTempDir("prism-cov-standalone-", (dir) => {
    const { log, path } = fakeBun(dir);
    const tempArtifact = join(dir, "artifact.json");
    // An empty seam is the standalone contract, and it survives a leaked value in the parent
    // environment: neither var may be trusted unless the stage set both.
    const r = runSummary({
      PRISM_COVERAGE_ARTIFACT: tempArtifact,
      PRISM_COVERAGE_CORE_OUTPUT: "",
      PRISM_COVERAGE_CORE_EXIT: "",
      PATH: path,
    });
    const artifact = JSON.parse(readFileSync(tempArtifact, "utf8"));
    assert.equal(spawnCount(log), workspaceNames.length + 1, "the core row must be measured when the seam is absent");
    assert.equal(artifact.core.status, "failed", "a dead core child still fails the row like a measured run");
    assert.equal(artifact.core.exitCode, 3);
    assert.equal(artifact.core.lines, null);
    assert.notEqual(r.status, 0);
  });
});

test("seam honesty: a captured run that failed is measured, never read", () => {
  const canary = "PRISM_COVERAGE_SEAM_CANARY_must_not_appear";
  withTempDir("prism-cov-seam-fail-", (dir) => {
    const { log, path } = fakeBun(dir, 'echo "boom: token=$PRISM_COVERAGE_TEST_SECRET"\n');
    const captured = join(dir, "core.out");
    // A stale green aggregate sits in the capture: trusting the seam would report 99.50 from a
    // run that failed (and is not this stage's), so a non-zero exit code must win.
    writeFileSync(captured, "\n All files | 99.60 | 99.50\n");
    const tempArtifact = join(dir, "artifact.json");
    const r = runSummary({
      PRISM_COVERAGE_ARTIFACT: tempArtifact,
      PRISM_COVERAGE_CORE_OUTPUT: captured,
      PRISM_COVERAGE_CORE_EXIT: "3",
      PRISM_COVERAGE_TEST_SECRET: canary,
      PATH: path,
    });
    const artifact = JSON.parse(readFileSync(tempArtifact, "utf8"));
    assert.equal(artifact.core.status, "failed", "a failed capture produces the measured failing row");
    assert.equal(artifact.core.exitCode, 3);
    assert.equal(artifact.core.lines, null, "no number from the ignored capture, stale or not");
    assert.ok(artifact.core.tail.includes("boom: token=[REDACTED]"), `the reused path keeps redaction: ${artifact.core.tail}`);
    assert.ok(!r.stdout.includes("99.50"), "the stale capture must never be printed");
    assert.ok(!JSON.stringify(artifact).includes(canary), "the env value must never reach the artifact");
    assert.equal(spawnCount(log), workspaceNames.length + 1, "the core row was measured, not reused");
    assert.ok(existsSync(captured), "an ignored capture is left for the runner to clean up");
  });
});

test("the retired Node coverage instrument survives only where it is asserted on", () => {
  // Live spawns must run the instrument that ships — scenario 4 of the build-race fixture
  // included. The string stays in files that negative-assert or fixture it, and in the retired
  // phase*-baseline.json evidence; a new occurrence anywhere else is a live spawn to review.
  // Files that only assert on the retired flag: this suite and tooling-gate's negative
  // fixtures, run-all-tests' "coverage is its own stage" check, and plan-review-gate's plan 113
  // keyword list. Their occurrences are needles, never spawn arguments.
  const NEGATIVE_ASSERTIONS = new Set([
    "phase23-coverage.test.mjs",
    "plan-review-gate.test.mjs",
    "run-all-tests.test.mjs",
    "tooling-gate.test.mjs",
  ]);
  // Plan 120 Task 6: the one live Node instrument. It audits branches. It is not the Bun coverage gate.
  const ALLOWED_LIVE = new Set(["branch-coverage-audit.mjs"]);
  const offenders = readdirSync(join(ROOT, "scripts"))
    .filter((entry) => /\.(?:mjs|js|json)$/.test(entry))
    .filter((entry) => !/-baseline\.json$/.test(entry) && !/freeze/.test(entry))
    .filter((entry) => !NEGATIVE_ASSERTIONS.has(entry) && !ALLOWED_LIVE.has(entry))
    .filter((entry) => readFileSync(join(ROOT, "scripts", entry), "utf8").includes("--experimental-test-coverage"));
  assert.deepEqual(offenders, [], "no live script except the branch audit may keep the Node coverage instrument");
  assert.match(
    readFileSync(join(ROOT, "scripts", "branch-coverage-audit.mjs"), "utf8"),
    /spawnSync\(\s*"node",[\s\S]*--experimental-test-coverage/,
    "the branch audit must spawn node by name",
  );
  const race = readFileSync(join(ROOT, "scripts", "phase23-build-race.test.mjs"), "utf8");
  assert.ok(!race.includes("--experimental-test-coverage"), "scenario 4 must run the shipping instrument");
  assert.match(race, /\["test", "--coverage", "--timeout=0"/, "scenario 4's leaf must spawn `bun test --coverage`");
  assert.match(race, /run\("bun", coverage\)/, "…through `bun` by name, not process.execPath (plan 115 Task 3)");
});

test("thresholds JSON covers every workspace package and is well-formed", () => {
  assert.equal(thresholds.marginPp, 3, "margin must be the frozen 3pp");
  assert.ok(
    Number.isFinite(thresholds.core?.lines) && Number.isFinite(thresholds.core?.functions),
    "the Bun-measured core floors must be recorded",
  );
  for (const name of workspaceNames) {
    const entry = thresholds.packages[pkgName(name)];
    assert.ok(entry, `${pkgName(name)} missing from coverage-thresholds.json`);
    if (entry.protectedException) {
      assert.ok(entry.protectedException.length > 0, "protected exception needs a reason");
    } else {
      assert.ok(Number.isFinite(entry.lines) && entry.lines > 0 && entry.lines < 100, `${pkgName(name)} lines threshold out of range`);
      assert.equal(entry.branches, null, `${pkgName(name)} branches must be null — Bun 1.4.2 emits no branch data`);
      assert.ok(Number.isFinite(entry.functions), `${pkgName(name)} functions must be recorded`);
    }
  }
});

test("thresholds JSON names only live workspace packages — no retired rows", () => {
  // Cheap O(rows) truth check: a row left behind by a package consolidation is a
  // gate that never runs, and reads as live evidence in docs and release tooling.
  assert.deepEqual(retiredThresholdRows(thresholds.packages), [], "every threshold row must name a current workspace package");
  // Negative fixtures: the check flags a retired name and accepts live ones.
  assert.deepEqual(retiredThresholdRows({ ...thresholds.packages, "@arnilo/prism-caveman": { lines: 1 } }), ["@arnilo/prism-caveman"]);
  assert.deepEqual(retiredThresholdRows({}), []);
  for (const name of Object.keys(thresholds.packages)) {
    assert.ok(liveWorkspaceNames.has(name), `${name} is not in the live workspace graph`);
  }
});

test("coverage artifact package keys match live workspace manifests", () => {
  const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8"));
  assertArtifactPackageNames(artifact);
  assert.throws(
    () => assertArtifactPackageNames({ ...artifact, packages: { ...artifact.packages, "@arnilo/prism-office": {} } }),
    /coverage artifact package keys must exactly match live workspace manifests/,
  );
});

test("real artifact is well-formed and every non-protected package passes its gate", () => {
  const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8"));
  assert.equal(
    artifact.core.gate,
    `lines>=${thresholds.core.lines.toFixed(2)} functions>=${thresholds.core.functions.toFixed(2)}`,
    "the core gate string must name the Bun-measured floors",
  );
  assert.equal(artifact.core.pass, true, "the core row just passed");
  assert.ok(Number.isFinite(artifact.core.lines) && Number.isFinite(artifact.core.functions));
  assert.equal(artifact.core.branches, null, "Bun coverage has no branch number to record");
  assert.equal(artifact.belowThreshold.length, 0, "the real run just passed — belowThreshold must be empty");
  // Plan 071 Task 15: failure fields are additive — a green row keeps its shape
  // byte-for-byte (the tail only ever appears on a row that failed).
  for (const [name, row] of [["core", artifact.core], ...Object.entries(artifact.packages)]) {
    for (const field of ["status", "exitCode", "tail"]) {
      assert.ok(!(field in row), `${name} passed — it must not carry ${field}`);
    }
  }
  for (const name of workspaceNames) {
    const row = artifact.packages[pkgName(name)];
    assert.ok(row, `${pkgName(name)} missing from the artifact`);
    assert.ok(Number.isFinite(row.lines) && Number.isFinite(row.functions));
    assert.equal(row.branches, null, `${pkgName(name)} must record branches: null`);
    assert.ok(Number.isInteger(row.denominatorFiles) && row.denominatorFiles >= 0);
    const protectedException = thresholds.packages[pkgName(name)].protectedException ?? null;
    assert.equal(row.protectedException, protectedException);
    if (protectedException) {
      assert.equal(row.threshold, null, "protected packages are never threshold-gated");
      assert.equal(row.pass, true);
    } else {
      assert.ok(row.lines >= row.threshold, `${pkgName(name)} below its threshold: ${row.lines} < ${row.threshold}`);
      assert.equal(row.pass, true);
    }
  }
  // Denominator proof: mcp imported root core dist in 0.2.2 (45.47 lines, polluted); the
  // package-local bunfig filter must keep the Bun recompute at the frozen 94.32-class level.
  assert.ok(artifact.packages["@arnilo/prism-mcp"].lines >= 80, "mcp recompute must stay package-only (bunfig filter working)");
});

test("fail-closed: a non-protected package below its threshold exits 1, is listed, and never touches the real files", () => {
  const realThresholds = readFileSync(THRESHOLDS, "utf8");
  const realArtifact = existsSync(ARTIFACT) ? readFileSync(ARTIFACT, "utf8") : null;
  const dir = mkdtempSync(join(tmpdir(), "prism-cov-gate-"));
  try {
    // Sabotage one non-protected package: demand 100 lines (impossible).
    const sabotaged = JSON.parse(realThresholds);
    sabotaged.packages["@arnilo/prism-ag-ui"] = { lines: 100, branches: 100, functions: 100 };
    const tempThresholds = join(dir, "thresholds.json");
    const tempArtifact = join(dir, "artifact.json");
    writeFileSync(tempThresholds, JSON.stringify(sabotaged, null, 2));
    const r = runSummary({ PRISM_COVERAGE_THRESHOLDS: tempThresholds, PRISM_COVERAGE_ARTIFACT: tempArtifact });
    assert.notEqual(r.status, 0, "coverage-summary must fail closed when a non-protected package regresses");
    const artifact = JSON.parse(readFileSync(tempArtifact, "utf8"));
    assert.deepEqual(artifact.belowThreshold, ["@arnilo/prism-ag-ui"]);
    assert.equal(artifact.packages["@arnilo/prism-ag-ui"].pass, false);
    // The failing row is self-describing on stdout (plan 071 Task 15): the numbers
    // carry the reason for a threshold regression, and a green child has no tail.
    assert.match(
      r.stdout,
      /@arnilo\/prism-ag-ui\s+functions[^\n]*\[FAIL lines [\d.]+ < 100\.00\]/,
      "the failing row must print its reason",
    );
    assert.ok(!artifact.packages["@arnilo/prism-ag-ui"].tail, "a green child records no tail");
    // Protected packages are exempt even when the gate fails elsewhere.
    for (const [pkg, entry] of Object.entries(thresholds.packages)) {
      if (entry.protectedException) assert.ok(!artifact.belowThreshold.includes(pkg), `${pkg} must never be a threshold failure`);
    }
    // Reproduction: back-to-back runs land well inside this window; the window
    // absorbs runner wobble, it is not the sabotage detector.
    //   @arnilo/prism-browser  0.13pp on a loaded 2-vCPU runner 2026-08-14
    //   @arnilo/prism-acp-agent 1.12pp (93.60 vs 94.72) in one GitHub job
    //                       2026-09-15 with functions identical (92.59 both
    //                       passes) — same functions, fewer lines/branches, so
    //                       a scheduling/load-sensitive arm, not a missing
    //                       suite; local runs are byte-identical at 94.72.
    // A vacuous/mis-instrumented run differs by tens of pp or produces
    // 100.00/missing rows, so 2pp keeps the signal (and the mcp denominator
    // proof: pollution reads 45.47 lines against a 90.25 expectation).
    for (const name of workspaceNames) {
      const real = JSON.parse(realArtifact).packages[pkgName(name)];
      const temp = artifact.packages[pkgName(name)];
      assert.ok(Math.abs(real.lines - temp.lines) < 2, `${pkgName(name)} coverage not reproduced: ${real.lines} vs ${temp.lines}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(readFileSync(THRESHOLDS, "utf8"), realThresholds, "real thresholds JSON must be untouched");
  assert.equal(readFileSync(ARTIFACT, "utf8"), realArtifact, "real artifact must be untouched");
});

test("failure diagnostics: tailOf keeps the last lines, CRLF/ANSI-safe and char-bounded", () => {
  assert.equal(TAIL_LINES, 40, "the tail window is the documented ~40 lines");
  assert.ok(MAX_TAIL_CHARS >= 1024 && MAX_TAIL_CHARS <= 65536, "the char cap keeps the artifact small");
  const lines = Array.from({ length: TAIL_LINES + 10 }, (_, i) => `line ${i}`).join("\r\n");
  const tail = tailOf(lines);
  assert.equal(tail.split("\n").length, 40, "exactly the window is kept");
  assert.ok(tail.startsWith("line 10") && tail.endsWith("line 49"), "the tail is the end of the output");
  assert.ok(!tail.includes("\r"), "CRLF output must not leak carriage returns");
  assert.equal(tailOf("a\r\nb\n\n\n"), "a\nb", "trailing blank lines are dropped");
  assert.equal(tailOf("\u001b[31mboom\u001b[0m"), "\u001b[31mboom\u001b[0m", "ANSI codes pass through untouched");
  assert.equal(tailOf(""), "");
  assert.equal(tailOf(undefined), "");
  const huge = tailOf(`head${"x".repeat(MAX_TAIL_CHARS * 2)}`);
  assert.ok(huge.startsWith("[…truncated]"), "one pathological line must be char-bounded");
  assert.ok(huge.length <= MAX_TAIL_CHARS + 64, "the bound holds");
});

test("failure diagnostics: only a failed child adds status/exitCode/tail to its row", () => {
  // Green run: byte-identical shape (no extra keys at all).
  assert.deepEqual(failureRow({ ok: true, lines: 91.5, exitCode: 0, tail: "" }), {});
  // Crashed child: the exit code and the tail are the reason.
  assert.deepEqual(failureRow({ ok: false, lines: undefined, exitCode: 3, tail: "boom" }), {
    status: "failed",
    exitCode: 3,
    tail: "boom",
  });
  // Green child that printed no aggregate row (mis-instrumented run): failed, no output to show.
  assert.deepEqual(failureRow({ ok: true, lines: undefined, exitCode: 0, tail: "" }), {
    status: "failed",
    exitCode: 0,
    tail: "",
  });
});

test("failure diagnostics: a crashed child is self-describing — tail recorded, exit code kept, env values redacted", () => {
  const realArtifact = existsSync(ARTIFACT) ? readFileSync(ARTIFACT, "utf8") : null;
  const canary = "PRISM_COVERAGE_CANARY_TOKEN_must_not_appear";
  const dir = mkdtempSync(join(tmpdir(), "prism-cov-tail-"));
  try {
    // Every coverage child dies before the suite runs and prints a credential-shaped
    // env value: the shape that used to surface as a bare `(suite failed)`. The summary
    // spawns `bun` by name (plan 113 rule), so a fake bun earlier on PATH kills every
    // child without touching the real instrument or needing a runner-specific preload.
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const fakeBun = join(bin, "bun");
    writeFileSync(fakeBun, '#!/bin/sh\necho "boom: token=$PRISM_COVERAGE_TEST_SECRET"\nexit 3\n');
    chmodSync(fakeBun, 0o755);
    const tempArtifact = join(dir, "artifact.json");
    const r = runSummary({
      PRISM_COVERAGE_ARTIFACT: tempArtifact,
      PRISM_COVERAGE_TEST_SECRET: canary,
      PATH: `${bin}:${process.env.PATH}`,
    });
    assert.notEqual(r.status, 0, "crashed coverage children must fail the summary");
    const artifact = JSON.parse(readFileSync(tempArtifact, "utf8"));
    const failed = Object.entries(artifact.packages).filter(([, row]) => row.status === "failed");
    assert.equal(failed.length, workspaceNames.length, "every workspace row records its failure");
    for (const [name, row] of failed) {
      assert.equal(row.exitCode, 3, `${name} must record the child exit code`);
      assert.equal(row.lines, null, `${name} must not report coverage from a dead child`);
      assert.ok(row.tail.includes("boom: token=[REDACTED]"), `${name} tail must carry the redacted output: ${row.tail}`);
      // Protected packages stay exempt from the gate (their row is not a threshold
      // failure) but the crashed child still fails the run — that is pre-existing.
      if (!row.protectedException) assert.equal(row.pass, false);
    }
    assert.equal(artifact.core.status, "failed");
    assert.equal(artifact.core.exitCode, 3);
    assert.equal(artifact.core.lines, null, "a dead child must never produce the core coverage row");
    assert.ok(artifact.core.tail.includes("boom: token=[REDACTED]"), "the core row records its tail too");
    // The operator sees the same diagnostic on stdout, indented under the row.
    assert.match(r.stdout, /── child output \(last 40 lines of stdout\+stderr, redacted\) ──/);
    assert.ok(r.stdout.includes("boom: token=[REDACTED]"), "the printed tail is the recorded one");
    // Security: the env value is never printed or written (redacted tail only).
    assert.ok(!r.stdout.includes(canary), "the value must not reach stdout");
    assert.ok(!JSON.stringify(artifact).includes(canary), "the value must not reach the artifact");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(readFileSync(ARTIFACT, "utf8"), realArtifact, "the real artifact must be untouched by the synthetic run");
});
