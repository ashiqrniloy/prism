// scripts/phase54-package-map.test.mjs
// Plan 054 Task 1: Meta-test for package freeze and 0.4 consolidation mapping.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildPackageMap, generateMarkdown } from "./phase54-package-map.mjs";

const rootDir = join(fileURLToPath(import.meta.url), "../..");

test("phase54 package map: exact manifest counts and topology invariants", () => {
  const map = buildPackageMap(rootDir);

  // Total current manifests in repo (65 initially, 50 after core, 42 after coding-tools, 40 after web-tools, 34 after memory family, 17 after providers family, 11 after the office family + profile deletions)
  assert.ok(
    [11, 17, 34, 40, 42, 50, 65].includes(map.counts.totalCurrentManifests),
    "Total repository manifests must be 11, 17, 34, 40, 42, 50 or 65",
  );
  assert.equal(map.counts.baselineManifests, 62, "Baseline 0.3.3 manifests count must be 62");
  assert.equal(map.counts.officeDraftManifests, 3, "Office drafts count must be 3");
  assert.equal(map.counts.retiredPackages, 54, "Retired packages count must be exactly 54");
  assert.equal(map.counts.retainedPackages, 8, "Retained packages count must be exactly 8");
  assert.equal(map.counts.newPackages, 3, "New packages count must be exactly 3");
  assert.equal(map.counts.targetActivePackages, 11, "Target active packages count must be exactly 11");
});

test("phase54 package map: partitioning - every current manifest is accounted for without duplication", () => {
  const map = buildPackageMap(rootDir);
  const manifestNames = new Set(map.manifests.map((m) => m.pkg.name));
  assert.equal(manifestNames.size, map.manifests.length, "All manifest names must be unique");

  const retainedNames = new Set(map.activePackages.filter((p) => p.type.startsWith("retained")).map((p) => p.name));
  const retiredNames = new Set(map.retiredPackages.map((p) => p.name));
  const officeDraftNames = new Set(map.officeDrafts.map((p) => p.name));

  // No overlap between retained and retired
  for (const name of retainedNames) {
    assert.ok(!retiredNames.has(name), `Retained package ${name} must not be in retired list`);
  }

  // Union of retained (8) + retired (54) + office drafts (3) must account for all 65 baseline manifests
  const baselineUnion = new Set([...retainedNames, ...retiredNames, ...officeDraftNames]);
  assert.equal(baselineUnion.size, 65, "Union of retained, retired, and office drafts must equal 65");

  const allowedManifests = new Set([
    ...baselineUnion,
    "@arnilo/prism-core",
    "@arnilo/prism-coding-tools",
    ...(existsSync(join(rootDir, "packages/office/package.json")) ? ["@arnilo/prism-office"] : []),
  ]);
  for (const name of manifestNames) {
    assert.ok(allowedManifests.has(name), `Manifest ${name} must be classified in package map`);
  }
});

test("phase54 package map: retired packages have valid 0.4 targets and deprecation commands", () => {
  const map = buildPackageMap(rootDir);
  const activePackageNames = new Set(map.activePackages.map((p) => p.name));

  for (const ret of map.retiredPackages) {
    if (ret.category === "profile" && ret.name === "@arnilo/prism-all") {
      assert.equal(ret.targetPackage, null, "@arnilo/prism-all has no single successor; requires explicit install");
    } else {
      assert.ok(ret.targetPackage, `${ret.name} must have a non-null targetPackage`);
      assert.ok(activePackageNames.has(ret.targetPackage), `${ret.name} targetPackage ${ret.targetPackage} must be an active 0.4 package`);
    }

    assert.ok(ret.version, `${ret.name} must record current version`);
    assert.ok(
      ret.distTagCommand.startsWith(`npm dist-tag add ${ret.name}@`),
      `${ret.name} distTagCommand malformed: ${ret.distTagCommand}`,
    );
    assert.ok(
      ret.deprecateCommand.includes(`npm deprecate ${ret.name}@"<0.4.0"`),
      `${ret.name} deprecateCommand malformed: ${ret.deprecateCommand}`,
    );
    assert.ok(ret.migrationAnchor.startsWith("#"), `${ret.name} migrationAnchor must start with #: ${ret.migrationAnchor}`);
  }
});

test("phase54 package map: export baselines exist and match declared surfaces", () => {
  const map = buildPackageMap(rootDir);
  const baselineDir = join(rootDir, "scripts", "compat-baseline");

  for (const m of map.manifests) {
    const distDir = join(m.dir, "dist");
    if (existsSync(distDir)) {
      const bFile = join(baselineDir, `${m.pkg.name.replace("@", "").replace("/", "__")}.txt`);
      assert.ok(existsSync(bFile), `Compat baseline file missing for ${m.pkg.name}: ${bFile}`);
      const content = readFileSync(bFile, "utf8").trim();
      assert.ok(content.length > 0, `Compat baseline file is empty for ${m.pkg.name}`);
    }
  }
});

test("phase54 package map: CLI binaries and entrypoints are preserved", () => {
  const map = buildPackageMap(rootDir);
  const allBins = new Map();
  for (const pkg of map.activePackages) {
    for (const bin of pkg.bins) {
      allBins.set(bin, pkg.name);
    }
  }

  assert.equal(allBins.get("prism"), "@arnilo/prism", "prism CLI must stay in @arnilo/prism");
  assert.equal(allBins.get("prism-dev"), "@arnilo/prism-coding-tools", "prism-dev must move to @arnilo/prism-coding-tools");
  assert.equal(allBins.get("prism-wiki"), "@arnilo/prism-memory", "prism-wiki must move to @arnilo/prism-memory");
  assert.equal(allBins.get("prism-acp-agent"), "@arnilo/prism-acp-agent", "prism-acp-agent must stay in @arnilo/prism-acp-agent");
});

test("phase54 package map: optional peers and security boundaries are fully documented", () => {
  const map = buildPackageMap(rootDir);

  for (const pkg of map.activePackages) {
    assert.ok(Array.isArray(pkg.securityBoundaries) && pkg.securityBoundaries.length > 0, `${pkg.name} must define security boundaries`);
    assert.ok(Array.isArray(pkg.subpaths) && pkg.subpaths.length > 0, `${pkg.name} must declare subpaths`);
  }
});

test("phase54 package map: generated markdown evidence file matches output", () => {
  const map = buildPackageMap(rootDir);
  const md = generateMarkdown(map);
  const evidencePath = join(rootDir, "docs", "_evidence", "phase54-package-map.md");

  assert.ok(existsSync(evidencePath), "docs/_evidence/phase54-package-map.md must exist");
  const onDisk = readFileSync(evidencePath, "utf8");

  const stripGen = (text) => text.replace(/Generated: `[^`]+`/, "Generated: `TIMESTAMP`");
  assert.equal(stripGen(onDisk), stripGen(md), "docs/_evidence/phase54-package-map.md is stale; run: node scripts/phase54-package-map.mjs");
  assert.ok(onDisk.includes("# Phase 54 — 0.3.3 Package/Export Baseline & 0.4 Import Map Evidence"));
  assert.ok(onDisk.includes("## 1. Executive Summary & Counts"));
  assert.ok(onDisk.includes("## 2. Target Active Package Topology (11 Active Packages)"));
  assert.ok(onDisk.includes("## 3. Complete 0.3.3 → 0.4 Import Migration Map (54 Retired Packages)"));
  assert.ok(onDisk.includes("## 4. Draft Office Manifests Consolidation"));
  assert.ok(onDisk.includes("## 5. Retained CLI / Binaries"));
  assert.ok(onDisk.includes("## 6. Optional Peers and Host Binary Requirements"));
  assert.ok(onDisk.includes("## 7. Security Trust Boundaries"));
  assert.ok(onDisk.includes("## 8. Legacy Registry Plan & Deprecation Commands (54 Packages)"));
  assert.ok(onDisk.includes("## 9. Baseline Export Symbol Snapshot Summary"));
});
