/**
 * E2E surface coverage gate tests (plans/064 Task 3). Hermetic: fixture
 * package trees in tmp dirs + one real-repo baseline leg. Registered in the
 * root `npm test` chain.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { computeCoverage, discoverSurfaces, REPO_ROOT } from "./e2e-coverage-gate.mjs";

/** Fixture repo: root pkg with one file surface, workspace pkg with one dir
 * surface. Returns root path; coverage manifests are written per-test. */
function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "prism-e2e-cov-"));
  mkdirSync(join(root, "src", "__tests__"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "@fixture/root",
      workspaces: ["pkg"],
      exports: { ".": "./dist/index.js", "./x": "./dist/x.js" },
    }),
  );
  writeFileSync(join(root, "src", "index.ts"), "export const x = 1;\n");
  writeFileSync(join(root, "src", "x.ts"), "export const y = 2;\n");
  writeFileSync(join(root, "src", "__tests__", "index.test.ts"), "import { x } from '../index.js';\n");
  mkdirSync(join(root, "pkg", "src", "y", "__tests__"), { recursive: true });
  writeFileSync(
    join(root, "pkg", "package.json"),
    JSON.stringify({
      name: "@fixture/pkg",
      exports: { "./y": "./dist/y/index.js" },
    }),
  );
  writeFileSync(join(root, "pkg", "src", "y", "index.ts"), "export const z = 3;\n");
  writeFileSync(join(root, "pkg", "src", "y", "__tests__", "y.test.ts"), "import { z } from '../index.js';\n");
  return root;
}

test("discovery: exports keys become surfaces, ./package.json skipped, dist paths resolve to src", () => {
  const root = fixtureRoot();
  const surfaces = discoverSurfaces(root);
  const key = (s) => `${s.pkgName}|${s.subpath}`;
  assert.deepEqual(surfaces.map(key).sort(), ["@fixture/pkg|./y", "@fixture/root|.", "@fixture/root|./x"]);
  const x = surfaces.find((s) => s.subpath === "./x");
  assert.ok(x.srcPath.endsWith("src/x.ts"), `file surface: ${x.srcPath}`);
  const y = surfaces.find((s) => s.pkgName === "@fixture/pkg");
  assert.ok(y.srcPath.endsWith("src/y"), `dir surface: ${y.srcPath}`);
});

test("gate fails on an unannotated surface (both modes)", () => {
  const root = fixtureRoot();
  const coverage = { packages: { "@fixture/root": { ".": { suites: ["src/__tests__/index.test.ts"] } } } };
  for (const mode of ["baseline", "full"]) {
    const { errors } = computeCoverage(root, coverage, { mode });
    assert.ok(
      errors.some((e) => e.includes("unannotated surface @fixture/root|./x")),
      mode,
    );
  }
});

test("gate passes with annotations in full mode", () => {
  const root = fixtureRoot();
  const coverage = {
    packages: {
      "@fixture/root": { ".": { suites: ["src/__tests__/index.test.ts"] }, "./x": { suites: ["src/__tests__/index.test.ts"] } },
      "@fixture/pkg": { "./y": { suites: ["pkg/src/y/__tests__/y.test.ts"] } },
    },
  };
  const { errors, summary } = computeCoverage(root, coverage, { mode: "full" });
  assert.deepEqual(errors, [], errors.join("\n"));
  assert.deepEqual(summary, { total: 3, covered: 3, pending: 0, mode: "full" });
});

test("gate fails when an annotated suite file does not exist", () => {
  const root = fixtureRoot();
  const coverage = {
    packages: {
      "@fixture/root": { ".": { suites: ["src/__tests__/index.test.ts"] }, "./x": { suites: ["src/__tests__/ghost.test.ts"] } },
      "@fixture/pkg": { "./y": { suites: ["pkg/src/y/__tests__/y.test.ts"] } },
    },
  };
  const { errors } = computeCoverage(root, coverage, { mode: "full" });
  assert.ok(errors.some((e) => e.includes("ghost.test.ts")));
});

test("gate fails on a stale annotation for a removed surface", () => {
  const root = fixtureRoot();
  const coverage = {
    packages: {
      "@fixture/root": {
        ".": { suites: ["src/__tests__/index.test.ts"] },
        "./x": { suites: ["src/__tests__/index.test.ts"] },
        "./gone": { suites: ["src/__tests__/index.test.ts"] },
      },
      "@fixture/pkg": { "./y": { suites: ["pkg/src/y/__tests__/y.test.ts"] } },
    },
  };
  for (const mode of ["baseline", "full"]) {
    const { errors } = computeCoverage(root, coverage, { mode });
    assert.ok(
      errors.some((e) => e.includes("stale annotation @fixture/root|./gone")),
      mode,
    );
  }
});

test("empty suite list: pending is allowed in baseline, fails in full", () => {
  const root = fixtureRoot();
  const coverage = {
    packages: {
      "@fixture/root": { ".": { suites: ["src/__tests__/index.test.ts"] }, "./x": { suites: [] } },
      "@fixture/pkg": { "./y": { suites: ["pkg/src/y/__tests__/y.test.ts"] } },
    },
  };
  const baseline = computeCoverage(root, coverage, { mode: "baseline" });
  assert.deepEqual(baseline.errors, []);
  assert.equal(baseline.summary.pending, 1);
  const full = computeCoverage(root, coverage, { mode: "full" });
  assert.ok(full.errors.some((e) => e.includes("@fixture/root|./x") && e.includes("no covering suite")));
  assert.equal(full.exitCode !== undefined, false); // pure function: exit decided by CLI
});

// ── real repo leg (the chain gate) ───────────────────────────────────────────

test("real repo: manifest covers every exports surface in baseline mode", () => {
  const coverage = JSON.parse(readFileSync(join(REPO_ROOT, "scripts", "e2e-coverage.json"), "utf8"));
  assert.equal(coverage.schemaVersion, 1);
  assert.equal(coverage.mode, "baseline", "flip to full after plans/064 Tasks 4-9 land");
  const { errors, summary } = computeCoverage(REPO_ROOT, coverage, { mode: coverage.mode });
  assert.deepEqual(errors, [], errors.join("\n"));
  assert.equal(summary.total, 98);
  assert.equal(summary.pending, 0, "Tasks 4-9 will re-introduce pending entries as planned suites register");
});

test("real repo: every annotated suite file exists on disk", () => {
  const coverage = JSON.parse(readFileSync(join(REPO_ROOT, "scripts", "e2e-coverage.json"), "utf8"));
  for (const [pkg, subs] of Object.entries(coverage.packages)) {
    for (const [sub, entry] of Object.entries(subs)) {
      for (const suite of entry.suites) {
        assert.ok(existsSync(join(REPO_ROOT, suite)), `${pkg} ${sub}: ${suite}`);
      }
    }
  }
});
