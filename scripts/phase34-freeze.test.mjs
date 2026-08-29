/**
 * Plan 034 Task 12: Decision B — only rag/memory/otel move to 0.3.1.
 * Superseded by plan 039, then by plan 050 (changed-package cut from the
 * plan-039 cut baseline): the freeze derives expected versions from the
 * current baseline with the same release.mjs logic instead of pinning
 * era literals forever.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { changedPackages, defaultBaselineVersion, incrementVersion, loadRelease } from "./release.mjs";

// Plan 050 baseline — the parent commit of the plan 050 implementation work
// (the plan 039 cut result).
const BASELINE = "edb4fcf69689683bf0dd3a9d1f2e88299db06603";

function loadManifests() {
  const pkgs = [{ path: ".", ...JSON.parse(readFileSync(new URL("../package.json", import.meta.url))) }];
  for (const name of readdirSync(new URL("../packages", import.meta.url)).sort()) {
    const file = new URL(`../packages/${name}/package.json`, import.meta.url);
    try {
      pkgs.push({ path: `packages/${name}`, ...JSON.parse(readFileSync(file)) });
    } catch {
      // not a package
    }
  }
  return pkgs;
}

test("phase34 freeze (plan 039 derivation): versions match the changed-package cut from the plan-035 baseline", () => {
  const release = loadRelease(new URL("..", import.meta.url).pathname);
  const changed = new Set(changedPackages(release, { baseline: BASELINE }).map((pkg) => pkg.manifest.name));
  for (const pkg of loadManifests()) {
    const base = defaultBaselineVersion(new URL("..", import.meta.url).pathname, BASELINE, pkg.path);
    // New packages since the baseline publish at their reviewed initial version.
    const expected = base === undefined ? pkg.version : changed.has(pkg.name) ? incrementVersion(base, "patch") : base;
    assert.equal(pkg.version, expected, `${pkg.name} expected ${expected}, got ${pkg.version}`);
  }
});

test("phase34 freeze (plan 039 derivation): root peers carry ^<root>; non-root internal ranges stay in the ^0.3.0 window", () => {
  const rootVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).version;
  for (const pkg of loadManifests()) {
    for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
      for (const [name, range] of Object.entries(pkg[field] ?? {})) {
        if (!name.startsWith("@arnilo/")) continue;
        if (String(range).startsWith("file:")) continue;
        if (name === "@arnilo/prism") {
          assert.ok(
            range === `^${rootVersion}` || range === "^0.3.0" || range === "^0.3.1",
            `${pkg.name} ${field}.${name} outside the Decision B window: ${range}`,
          );
        } else {
          assert.equal(range, "^0.3.0", `${pkg.name} ${field}.${name} is ${range}`);
        }
      }
    }
  }
});

test("phase34 freeze: changelog, migration, and handoff name 0.3.1", () => {
  const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../docs/migration.md", import.meta.url), "utf8");
  const release = readFileSync(new URL("../docs/release-and-install.md", import.meta.url), "utf8");
  assert.ok(changelog.includes("## [0.3.1] - 2026-08-26"), "root CHANGELOG missing [0.3.1]");
  assert.ok(changelog.includes("ERR_PRISM_RAG_EMBEDDER_MISMATCH"), "CHANGELOG missing embedder mismatch");
  assert.ok(migration.includes("## 0.3.0 → 0.3.1"), "migration.md missing 0.3.0 → 0.3.1");
  assert.ok(migration.includes("Embedder.id"), "migration.md must name Embedder.id");
  assert.ok(release.includes("### 0.3.1 independent RAG engine patch (plan 034 Task 12)"), "release page missing 0.3.1 handoff");
  for (const dir of ["rag", "memory", "observability-opentelemetry"]) {
    const text = readFileSync(new URL(`../packages/${dir}/CHANGELOG.md`, import.meta.url), "utf8");
    assert.ok(text.includes("## [0.3.1] - 2026-08-26"), `packages/${dir}/CHANGELOG.md missing [0.3.1]`);
  }
});
