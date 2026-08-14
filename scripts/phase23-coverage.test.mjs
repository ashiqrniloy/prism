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
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const SUMMARY = join(ROOT, "scripts", "coverage-summary.mjs");
const THRESHOLDS = join(ROOT, "scripts", "coverage-thresholds.json");
const ARTIFACT = join(ROOT, "scripts", "coverage-summary.json");
const PACKAGES = join(ROOT, "packages");

const source = readFileSync(SUMMARY, "utf8");
const thresholds = JSON.parse(readFileSync(THRESHOLDS, "utf8"));
const workspaceNames = readdirSync(PACKAGES)
  .filter((n) => existsSync(join(PACKAGES, n, "package.json")) && existsSync(join(PACKAGES, n, "dist/__tests__")))
  .sort();
const pkgName = (n) => JSON.parse(readFileSync(join(PACKAGES, n, "package.json"), "utf8")).name ?? n;

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

test("real artifact is well-formed and every non-protected package passes its gate", () => {
  const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8"));
  assert.equal(artifact.core.gate, "60/70/75");
  assert.equal(artifact.belowThreshold.length, 0, "the real run just passed — belowThreshold must be empty");
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
