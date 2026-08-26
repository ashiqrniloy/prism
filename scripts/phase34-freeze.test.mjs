/**
 * Plan 034 Task 12: Decision B — only rag/memory/otel move to 0.3.1.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const BUMPED = new Set(["@arnilo/prism-rag", "@arnilo/prism-memory", "@arnilo/prism-observability-opentelemetry"]);
const FROZEN = {
  "@arnilo/prism-graft": "0.0.1",
  "@arnilo/prism-wiki": "0.0.1",
};

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

test("phase34 freeze: exactly three manifests at 0.3.1; others stay pre-plan", () => {
  const pkgs = loadManifests();
  const bumped = [];
  for (const pkg of pkgs) {
    const expected = BUMPED.has(pkg.name) ? "0.3.1" : (FROZEN[pkg.name] ?? "0.3.0");
    assert.equal(pkg.version, expected, `${pkg.name} expected ${expected}, got ${pkg.version}`);
    if (pkg.version === "0.3.1") bumped.push(pkg.name);
  }
  assert.deepEqual(bumped.sort(), [...BUMPED].sort());
});

test("phase34 freeze: internal first-party ranges stay ^0.3.0", () => {
  for (const pkg of loadManifests()) {
    for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
      for (const [name, range] of Object.entries(pkg[field] ?? {})) {
        if (!name.startsWith("@arnilo/")) continue;
        if (String(range).startsWith("file:")) continue;
        assert.equal(range, "^0.3.0", `${pkg.name} ${field}.${name} is ${range}`);
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
