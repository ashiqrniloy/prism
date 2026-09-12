// scripts/phase23-coverage.test.mjs — Task 2 regression.
//
// Runs at the END of `npm run test:coverage`, immediately AFTER coverage-summary.mjs
// wrote the real artifact (scripts/coverage-summary.json), so the well-formedness and
// reproduction checks read it directly. The fail-closed check spawns ONE extra run with
// PRISM_COVERAGE_THRESHOLDS + PRISM_COVERAGE_ARTIFACT overrides (sabotaged temp files),
// so the real thresholds JSON and the real artifact are never touched.
//
// Denominator proof: @arnilo/prism-mcp imported root core dist in the 0.2.2 run and
// reported 45.47 lines (polluted); its freeze threshold here is 87.25 (recompute 90.25 -
// 3pp). The `lines >= threshold` gate failing for mcp would therefore be the observable
// symptom of a broken --test-coverage-include=dist/** filter.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
// recursively: acp-agent builds to dist/src/__tests__, office to dist/<area>/__tests__).
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

const workspaceNames = readdirSync(PACKAGES)
  .filter((n) => existsSync(join(PACKAGES, n, "package.json")) && hasDistTests(n))
  .sort();
const pkgName = (n) => JSON.parse(readFileSync(join(PACKAGES, n, "package.json"), "utf8")).name ?? n;

// Plan 070 Task 7: the live workspace graph from the manifest truth (root excluded —
// @arnilo/prism is the core row, never a workspace row in the thresholds file).
const truth = computePackageTruth();
const liveWorkspaceNames = new Set(Object.keys(truth.versions).filter((name) => name !== truth.root.name));
const retiredThresholdRows = (packages) => Object.keys(packages).filter((name) => !liveWorkspaceNames.has(name));

function runSummary(env) {
  return spawnSync(process.execPath, [SUMMARY], { encoding: "utf8", env: { ...process.env, ...env } });
}

test("workspace run uses the package-local include filter; core gate unchanged", () => {
  assert.match(source, /--test-coverage-include=dist\/\*\*/, "workspace run must include --test-coverage-include=dist/**");
  assert.match(
    source,
    /CORE_GATE = \["--test-coverage-lines=60", "--test-coverage-functions=70", "--test-coverage-branches=75"\]/,
    "core gate must stay 60/70/75",
  );
  assert.match(source, /"\*\*\/packages\/\*\*"/, "core run must still exclude packages/**");
});

test("thresholds JSON covers every workspace package and is well-formed", () => {
  assert.equal(thresholds.marginPp, 3, "margin must be the frozen 3pp");
  for (const name of workspaceNames) {
    const entry = thresholds.packages[pkgName(name)];
    assert.ok(entry, `${pkgName(name)} missing from coverage-thresholds.json`);
    if (entry.protectedException) {
      assert.ok(entry.protectedException.length > 0, "protected exception needs a reason");
    } else {
      assert.ok(Number.isFinite(entry.lines) && entry.lines > 0 && entry.lines < 100, `${pkgName(name)} lines threshold out of range`);
      assert.ok(
        Number.isFinite(entry.branches) && Number.isFinite(entry.functions),
        `${pkgName(name)} branches/functions must be recorded`,
      );
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

test("real artifact is well-formed and every non-protected package passes its gate", () => {
  const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8"));
  assert.equal(artifact.core.gate, "60/70/75");
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
    assert.ok(Number.isFinite(row.lines) && Number.isFinite(row.branches) && Number.isFinite(row.functions));
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
  // package-local include filter must keep the recompute at the frozen 90.25-class level.
  assert.ok(artifact.packages["@arnilo/prism-mcp"].lines >= 80, "mcp recompute must stay package-only (include filter working)");
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
    assert.match(r.stdout, /@arnilo\/prism-ag-ui\s+lines[^\n]*\[FAIL lines [\d.]+ < 100\.00\]/, "the failing row must print its reason");
    assert.ok(!artifact.packages["@arnilo/prism-ag-ui"].tail, "a green child records no tail");
    // Protected packages are exempt even when the gate fails elsewhere.
    for (const [pkg, entry] of Object.entries(thresholds.packages)) {
      if (entry.protectedException) assert.ok(!artifact.belowThreshold.includes(pkg), `${pkg} must never be a threshold failure`);
    }
    // Reproduction: back-to-back runs are stable well inside the 3pp margin.
    // 0.5pp absorbs rare runner noise (observed 0.13pp on @arnilo/prism-browser
    // on a loaded 2-vCPU runner 2026-08-14; local + container runs are
    // byte-identical at 83.78). A vacuous/mis-instrumented run differs by tens
    // of pp or produces 100.00/missing rows, far outside this window.
    for (const name of workspaceNames) {
      const real = JSON.parse(realArtifact).packages[pkgName(name)];
      const temp = artifact.packages[pkgName(name)];
      assert.ok(Math.abs(real.lines - temp.lines) < 0.5, `${pkgName(name)} coverage not reproduced: ${real.lines} vs ${temp.lines}`);
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
    // env value: the shape that used to surface as a bare `(suite failed)`. The argv
    // guard keeps the fixture from firing in the summary process itself (which must
    // inherit NODE_OPTIONS so its children do), so only the children die.
    const boom = join(dir, "boom.cjs");
    writeFileSync(
      boom,
      'if (!process.argv[1] || !process.argv[1].endsWith("coverage-summary.mjs")) { console.error("boom: token=" + process.env.PRISM_COVERAGE_TEST_SECRET); process.exit(3); }\n',
    );
    const tempArtifact = join(dir, "artifact.json");
    const r = runSummary({
      PRISM_COVERAGE_ARTIFACT: tempArtifact,
      PRISM_COVERAGE_TEST_SECRET: canary,
      NODE_OPTIONS: `--require ${boom}`,
    });
    assert.notEqual(r.status, 0, "crashed coverage children must fail the summary");
    const artifact = JSON.parse(readFileSync(tempArtifact, "utf8"));
    const failed = Object.entries(artifact.packages).filter(([, row]) => row.status === "failed");
    assert.equal(failed.length, workspaceNames.length, "every workspace row records its failure");
    for (const [name, row] of failed) {
      assert.equal(row.exitCode, 3, `${name} must record the child exit code`);
      assert.ok(row.tail.includes("boom: token=[REDACTED]"), `${name} tail must carry the redacted output: ${row.tail}`);
      // Protected packages stay exempt from the gate (their row is not a threshold
      // failure) but the crashed child still fails the run — that is pre-existing.
      if (!row.protectedException) assert.equal(row.pass, false);
    }
    assert.equal(artifact.core.status, "failed");
    assert.equal(artifact.core.exitCode, 3);
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
