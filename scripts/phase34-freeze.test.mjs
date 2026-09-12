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

// Plan 071 Task 1 (plan 070 FA 10): derive the expected version from the root
// manifest instead of pinning the cut era here — the per-cut history (0.3.1, 0.4.1,
// 0.5.x, …) lives in CHANGELOG.md, where the changelog assertions below still read it.
const rootVersion = () => loadManifests().find((pkg) => pkg.path === ".").version;

test("phase34 freeze (plan 054 Task 9): every active manifest matches the root lockstep version", () => {
  const expected = rootVersion();
  for (const pkg of loadManifests()) {
    assert.equal(pkg.version, expected, `${pkg.name} expected ${expected}, got ${pkg.version}`);
  }
});

test("phase34 freeze (plan 054 Task 9): internal @arnilo ranges are caret-pinned to the root version", () => {
  const expected = `^${rootVersion()}`;
  for (const pkg of loadManifests()) {
    for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
      for (const [name, range] of Object.entries(pkg[field] ?? {})) {
        if (!name.startsWith("@arnilo/")) continue;
        if (String(range).startsWith("file:")) continue;
        assert.equal(range, expected, `${pkg.name} ${field}.${name} is ${range}`);
      }
    }
  }
});

test("phase34 freeze: changelog, migration, and handoff name 0.3.1", () => {
  const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../docs/history/migration-0.3.md", import.meta.url), "utf8");
  const release = readFileSync(new URL("../docs/history/release-handoffs.md", import.meta.url), "utf8");
  assert.ok(changelog.includes("## [0.3.1] - 2026-08-26"), "root CHANGELOG missing [0.3.1]");
  assert.ok(changelog.includes("ERR_PRISM_RAG_EMBEDDER_MISMATCH"), "CHANGELOG missing embedder mismatch");
  assert.ok(migration.includes("## 0.3.0 → 0.3.1"), "migration.md missing 0.3.0 → 0.3.1");
  assert.ok(migration.includes("Embedder.id"), "migration.md must name Embedder.id");
  assert.ok(release.includes("### 0.3.1 independent RAG engine patch (plan 034 Task 12)"), "release page missing 0.3.1 handoff");
  for (const dir of ["memory"]) {
    const text = readFileSync(new URL(`../packages/${dir}/CHANGELOG.md`, import.meta.url), "utf8");
    assert.ok(text.includes("## [0.3.1] - 2026-08-26"), `packages/${dir}/CHANGELOG.md missing [0.3.1]`);
  }
});
