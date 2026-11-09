/**
 * E2E surface coverage gate tests (plans/064 Task 3). Hermetic: fixture
 * package trees in tmp dirs + one real-repo baseline leg. Registered in the
 * root `bun run test` chain.
 */

import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  // 114 minus the retired extension conformance subpath (plan 147 Task 6), the five `./providers/*`
  // subpaths and `./testing/provider-conformance` (plan 151 Task 4), plus `./provider-kit` and the plan
  // 150 `./manifest` surfaces; minus the five family subpaths plan 152 Task 5 retired
  // (./commandcode, ./decisions, ./hyper, ./laya, ./typesafe), plus their four standalone packages;
  // minus the six remaining family subpaths plan 152 Task 6 retired, plus the five cloud/adapter packages;
  // plus the plan 152 Task 7 credentials-keyring package; minus the retired `./testing/session-store-conformance`
  // subpath (plan 153 Task 2, folded into `./testing`).
  // plan 174 Task 2: minus agent-event-source-conformance, node/config, node/settings, node/agent-definitions.
  // plan 174 Task 4: minus testing/persistence-schema and testing/feedback (moved to store-codecs).
  // plan 174 Task 7: minus the three retired 0.12 workspaces (coding-tools, agent-sdk, acp-agent).
  // plan 176 Task 3: regenerated for the 0.13 grouped workspace set (retired family keys dropped, 64
  // dangling suite paths pruned). Four surfaces have no covering suite yet and stay pending in baseline mode.
  // plan 182 Task 2: minus the 17 retired provider packages (91 -> 74).
  // plan 188.1 Task 4: plus `@arnilo/prism-memory-core/fabric` (74 -> 75); the WIP 0.13 package
  // restructuring had already added one more surface without updating this count, so the live
  // total was 76. Plan 191 Task 8 adds `@arnilo/prism-advisor` and a later surface added one more,
  // so the live total is 78. Plan 204 Task 5 adds `@arnilo/prism-provider-openai-codex`, and the
  // regeneration also picked up the OpenRouter package plan 203 added without a row, so the live
  // total is 80. Plan 205 Task 2 adds `@arnilo/prism-provider-commandcode`, so 81. Plan 213 Task 2 adds
  // `@arnilo/prism-provider-kilo` and plan 214 Task 2 adds `@arnilo/prism-provider-litellm`, so 83.
  // Plan 206 Task 2 adds `@arnilo/prism-provider-ollama-cloud`, so 84. Plan 215 Task 14 adds
  // `@arnilo/prism-host-builder`, so 85. Plan 215 Task 26 added the kernel's `./net` and `./artifacts` subpaths; plan 216
  // Task 3 regenerated the manifest (the knowledge renames keep the count), so 87. Plan 216 Task 5 folded
  // the fabric package into `@arnilo/prism-memory-system`, so 86.
  assert.equal(summary.total, 86);
  assert.equal(summary.pending, 4, "four surfaces are unannotated after the 0.13 regeneration");
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
