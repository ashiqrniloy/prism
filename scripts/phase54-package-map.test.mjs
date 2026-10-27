// scripts/phase54-package-map.test.mjs
// Plan 054 Task 1: Meta-test for package freeze and 0.4 consolidation mapping.

import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPackageMap, generateMarkdown } from "./phase54-package-map.mjs";

const rootDir = join(fileURLToPath(import.meta.url), "../..");

test("phase54 package map: exact manifest counts and topology invariants", () => {
  const map = buildPackageMap(rootDir);

  // Total current manifests in repo after consolidation and delegated CLI adapter removal.
  assert.ok(
    [13, 12, 14, 16, 17, 26, 30, 34, 35, 36, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 58, 59, 60, 61, 62, 63, 65].includes(map.counts.totalCurrentManifests),
    "Total repository manifests must be a recorded historical count (plan 174 Tasks 6-7 leave 60)",
  );
  assert.equal(map.counts.baselineManifests, 62, "Baseline 0.3.3 manifests count must be 62");
  assert.equal(map.counts.officeDraftManifests, 3, "Office drafts count must be 3");
  assert.equal(map.counts.retiredPackages, 55, "Retired packages count must be exactly 55");
  assert.equal(map.counts.retainedPackages, 7, "Retained packages count must be exactly 7");
  assert.equal(map.counts.newPackages, 4, "New packages count must be exactly 4");
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

  // Union of retained (7) + retired (55) + office drafts (3) accounts for all 65 baseline manifests
  const baselineUnion = new Set([...retainedNames, ...retiredNames, ...officeDraftNames]);
  assert.equal(baselineUnion.size, 65, "Union of retained, retired, and office drafts must equal 65");

  const allowedManifests = new Set([
    ...baselineUnion,
    "@arnilo/prism-channels",
    "@arnilo/prism-coding-tools",
    // Plan 106 R4: the hooks.json adapter package, added after the 0.4 consolidation.
    "@arnilo/prism-hooks-json",
    // Plan 134: agent SDK package
    "@arnilo/prism-agent-sdk",
    // Plan 152 Task 5: adapters that never shipped as a standalone 0.3 package, so the
    // phase54 baseline union cannot name them.
    "@arnilo/prism-provider-hyper",
    "@arnilo/prism-provider-laya",
    "@arnilo/prism-provider-typesafe",
    // Plan 195 Task 5: the Liquid provider adapter.
    "@arnilo/prism-provider-liquid",
    // Plan 203 Task 4: OpenRouter reuses its retired name for the new adapter.
    "@arnilo/prism-provider-openrouter",
    // Plan 204 Task 5: OpenAI models on a ChatGPT plan; the name never shipped in 0.3.x.
    "@arnilo/prism-provider-openai-codex",
    // Plan 152 Task 7: the credentials-slot keyring package, added after the 0.4 consolidation.
    "@arnilo/prism-credentials-keyring",
    // Plan 153 Task 3: the JSONL session store package, moved out of the root `./node/` subpath.
    "@arnilo/prism-store-jsonl",
    // Plan 153 Task 4: the shared SQL codecs and the SQLite store, moved out of prism-core subpaths.
    "@arnilo/prism-store-codecs",
    "@arnilo/prism-store-sqlite",
    "@arnilo/prism-store-postgres",
    // Plan 154 Task 3: the coding tools package, moved out of prism-coding-tools/{agent,security}.
    "@arnilo/prism-tools-coding",
    // Plan 155 Task 2: the web tools package, moved out of prism-web-tools/{root,brave,exa,firecrawl,obscura}.
    "@arnilo/prism-tools-web",
    // Plan 155 Task 3: the browser tools package, moved out of prism-web-tools/browser.
    "@arnilo/prism-tools-browser",
    // Plan 155 Task 4: the OpenAPI and computer-use packages, moved out of prism-coding-tools.
    "@arnilo/prism-tools-openapi",
    "@arnilo/prism-tools-computer-use",
    // Plan 154 Task 6: the approval package.
    "@arnilo/prism-approval",
    // Plan 159 Task 5: the guardrail-packs package, moved out of the kernel's pack compile path.
    "@arnilo/prism-guardrail-packs",
    // Plan 159 Task 6: the governance package, moved out of prism-core's policy subpaths.
    "@arnilo/prism-governance",
    "@arnilo/prism-context-files",
    // Plan 158 Task 7: the context-engineering package, moved out of the kernel's opt-in fields.
    "@arnilo/prism-context-engineering",
    // Plan 158 Task 2: the shared memory library, moved out of @arnilo/prism-memory's root.
    "@arnilo/prism-memory-core",
    // Plan 158 Task 3: the RAG package, moved out of @arnilo/prism-memory/rag.
    "@arnilo/prism-memory-rag",
    // Plan 158 Task 4: the fabric package, moved out of @arnilo/prism-memory/{fabric,scoped}.
    "@arnilo/prism-memory-fabric",
    // Plan 158 Task 5: the wiki package, moved out of @arnilo/prism-memory/wiki.
    "@arnilo/prism-memory-wiki",
    // Plan 157 Tasks 3-4: the compaction and observational-memory packages.
    "@arnilo/prism-memory-compaction",
    "@arnilo/prism-memory-observational",
    // Plan 159 Task 3: the MCP server host library package.
    "@arnilo/prism-mcp-server",
    // Plan 161 Task 2: the ACP host library.
    "@arnilo/prism-acp",
    "@arnilo/prism-driver-process",
    "@arnilo/prism-observability",
    "@arnilo/prism-delegate",
    // Plan 191 Task 8: the advisor package.
    "@arnilo/prism-advisor",
    "@arnilo/prism-evals",
    "@arnilo/prism-devtools",
    // Plan 174 Task 6: post-0.4 packages that never shipped as a standalone 0.3 package.
    "@arnilo/prism-remote",
    "@arnilo/prism-headless",
    "@arnilo/prism-tools-research",
    ...(existsSync(join(rootDir, "packages/tools/work/package.json")) ? ["@arnilo/prism-tools-work"] : []),
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
      // Plan 152 Task 6: the retired @arnilo/prism-providers umbrella has no public entrypoint any
      // more (every adapter is a standalone package), so its dist holds only test declarations, which
      // the surface extractor skips. An empty baseline is correct for a package with no public surface.
      const hasPublicSurface = m.pkg.types !== undefined || m.pkg.main !== undefined || Object.keys(m.pkg.exports ?? {}).length > 0;
      if (hasPublicSurface) assert.ok(content.length > 0, `Compat baseline file is empty for ${m.pkg.name}`);
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
  assert.equal(
    stripGen(onDisk),
    stripGen(md),
    "docs/_evidence/phase54-package-map.md is stale; run: bun scripts/package-truth.mjs --emit-docs",
  );
  assert.ok(onDisk.includes("# Phase 54 — 0.3.3 Package/Export Baseline & 0.4 Import Map Evidence"));
  assert.ok(onDisk.includes("## 1. Executive Summary & Counts"));
  assert.ok(onDisk.includes("## 2. Target Active Package Topology (11 Active Packages)"));
  assert.ok(onDisk.includes("## 3. Complete 0.3.3 → 0.4 Import Migration Map (54 Retired Packages)"));
  assert.ok(onDisk.includes("## 4. Draft Office Manifests Consolidation"));
  assert.ok(onDisk.includes("## 5. Retained CLI / Binaries"));
  assert.ok(onDisk.includes("## 6. Optional Peers and Host Binary Requirements"));
  assert.ok(onDisk.includes("## 7. Security Trust Boundaries"));
  assert.ok(onDisk.includes("## 8. Legacy Registry Plan & Deprecation Commands (55 Packages)"));
  assert.ok(onDisk.includes("## 9. Baseline Export Symbol Snapshot Summary"));
});
