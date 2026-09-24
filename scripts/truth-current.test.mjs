// Plan 057 Task 2: current-invariant truth suite (a) — workspace manifests ↔
// lockfile ↔ package-truth.json consistency, and (c) release/security gate
// integrity. Replaces the historical phase13–34 freeze/release closeout
// assertions (retired from npm test by plan 057 Task 1): every expected value
// here derives from computePackageTruth() or the filesystem — zero
// hard-coded package counts.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  applyGeneratedBlock,
  computePackageTruth,
  DOC_BLOCK_TARGETS,
  expandWorkspaceDirs,
  readManifest,
  renderGeneratedDocs,
  renderInventoryBlock,
  renderProvidersBlock,
} from "./package-truth.mjs";
import { effectiveTestChain } from "./run-all-tests.mjs";
import { readBunLock } from "./bun-lock.mjs";

const ROOT = join(import.meta.dirname, "..");
const stripStamp = ({ generatedAt, ...rest }) => rest;
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

test("committed package-truth.json equals the live generator output (regen: node scripts/package-truth.mjs)", () => {
  const artifact = readJson("scripts/package-truth.json");
  assert.deepEqual(stripStamp(artifact), stripStamp(computePackageTruth(ROOT)), "scripts/package-truth.json is stale");
});

test("workspace manifests, truth counts, and taxonomy partition agree", () => {
  const truth = computePackageTruth(ROOT);
  const root = readManifest(join(ROOT, "package.json"));
  const dirs = expandWorkspaceDirs(ROOT, root.workspaces);

  assert.equal(truth.root.name, root.name);
  assert.equal(truth.root.version, root.version);
  assert.equal(truth.counts.workspace, dirs.length, "truth workspace count matches workspace globs");
  assert.equal(truth.counts.publishable, dirs.length + 1, "publishable = root + workspaces");

  // every workspace package has a manifest, and the taxonomy covers each exactly once
  const names = dirs.map((d) => readManifest(join(d, "package.json")).name).sort();
  const providerManifests = names.filter((n) => n.startsWith("@arnilo/prism-provider-"));
  assert.equal(
    truth.counts.workspace,
    truth.family.length + truth.capability.length + providerManifests.length,
    "family + capability + standalone provider manifests = workspace count",
  );
  const all = new Set([...truth.family, ...truth.capability, ...providerManifests]);
  assert.equal(all.size, truth.counts.workspace, "taxonomy sets do not overlap");
  for (const n of names) assert.ok(all.has(n), `workspace package ${n} missing from truth taxonomy`);
});

test("lockfile agrees with manifests: workspace name-set, versions, root identity, counts", () => {
  const truth = computePackageTruth(ROOT);
  const root = readManifest(join(ROOT, "package.json"));
  const lock = readBunLock(ROOT);
  const lockRoot = lock.workspaces[""];
  assert.ok(lockRoot, "bun.lock has a root workspace entry");
  assert.equal(lockRoot.name, root.name, "bun.lock root name drifted from package.json");
  // The root entry has no `version` today (phase 113 Task 1); if Bun adds one it is a claim.
  if (lockRoot.version !== undefined) assert.equal(lockRoot.version, root.version, "bun.lock root version drifted from package.json");

  const lockWorkspaces = Object.fromEntries(
    Object.entries(lock.workspaces)
      .filter(([key]) => key.startsWith("packages/"))
      .map(([key, entry]) => [key, { name: entry.name, version: entry.version }]),
  );
  const manifests = Object.fromEntries(
    expandWorkspaceDirs(ROOT, root.workspaces).map((dir) => [
      dir.slice(ROOT.length + 1).replaceAll("\\", "/"),
      readManifest(join(dir, "package.json")),
    ]),
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(lockWorkspaces).map(([key, entry]) => [key, entry.name])),
    Object.fromEntries(Object.entries(manifests).map(([key, manifest]) => [key, manifest.name])),
    "bun.lock workspace name-set drifted; run bun install",
  );
  for (const [key, manifest] of Object.entries(manifests)) {
    assert.equal(lockWorkspaces[key].version, manifest.version, `bun.lock ${key} version drifted; run bun install`);
  }
  assert.equal(Object.keys(lockWorkspaces).length, truth.counts.workspace, "bun.lock workspace count drifted from truth");
});

test("drift detection: a tampered truth/manifest pair fails the equality gate", () => {
  const dir = mkdtempSync(join(tmpdir(), "prism-truth-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@x/root", version: "0.0.1", workspaces: ["pkgs/*"] }));
    mkdirSync(join(dir, "pkgs", "a"), { recursive: true });
    writeFileSync(join(dir, "pkgs", "a", "package.json"), JSON.stringify({ name: "@x/a", version: "0.0.1" }));
    const truth = computePackageTruth(dir);
    assert.equal(truth.counts.publishable, 2);
    // rename a manifest after capturing truth; the stale captured artifact now disagrees with the manifest set
    writeFileSync(join(dir, "pkgs", "a", "package.json"), JSON.stringify({ name: "@x/b", version: "0.0.1" }));
    assert.notDeepEqual(stripStamp(truth), stripStamp(computePackageTruth(dir)), "manifest rename must surface as drift");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("generated docs blocks match the live renderer on every target page", () => {
  const truth = computePackageTruth(ROOT);
  const renderers = { inventory: renderInventoryBlock, providers: renderProvidersBlock };
  for (const [file, types] of Object.entries(DOC_BLOCK_TARGETS)) {
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const type of types) {
      const rendered = renderers[type](truth);
      const begin = `<!-- generated:package-truth:${type} begin -->`;
      const end = `<!-- generated:package-truth:${type} end -->`;
      const start = text.indexOf(begin);
      const finish = text.indexOf(end, start);
      assert.ok(start !== -1 && finish !== -1, `${file} missing ${type} block marker`);
      assert.equal(
        text.slice(start, finish + end.length),
        rendered,
        `${file} ${type} block is stale — regenerate: node scripts/package-truth.mjs --emit-docs`,
      );
    }
  }
});

test("package-truth generated docs include current Phase 54 evidence", () => {
  const truth = computePackageTruth(ROOT);
  const rendered = renderGeneratedDocs(ROOT, truth);
  const actual = rendered["docs/_evidence/phase54-package-map.md"];
  const expected = readFileSync(join(ROOT, "docs", "_evidence", "phase54-package-map.md"), "utf8");
  const stripGenerated = (text) => text.replace(/Generated: `[^`]+`/, "Generated: `TIMESTAMP`");

  assert.equal(
    stripGenerated(actual),
    stripGenerated(expected),
    "Phase 54 evidence is stale; run: node scripts/package-truth.mjs --emit-docs",
  );
});

// Plan 057 Task 4 test case: hand-editing a generated block must be fixed by
// regeneration, and regeneration must never touch text outside the blocks.
test("regeneration edits only the generated blocks (scrambled content restores byte-identically)", () => {
  const truth = computePackageTruth(ROOT);
  const file = "README.md";
  const original = readFileSync(join(ROOT, file), "utf8");
  const scrambled = original.replace("core — runtime, CLI/RPC, templates, docs", "hand-edited garbage");
  assert.notEqual(scrambled, original, "scramble must actually change the block");
  const restored = applyGeneratedBlock(scrambled, "inventory", renderInventoryBlock(truth));
  assert.equal(restored, original, "applying the renderer must restore the page outside blocks untouched");
});

test("gate integrity: every scripts/*.mjs referenced by package.json scripts exists", () => {
  const referenced = new Set();
  const { scripts } = readManifest(join(ROOT, "package.json"));
  for (const value of Object.values(scripts ?? {})) {
    for (const m of value.matchAll(/scripts\/([A-Za-z0-9._-]+\.mjs)/g)) {
      referenced.add(m[1]);
    }
  }
  assert.ok(referenced.size > 0, "expected script references in package.json");
  for (const file of referenced) {
    assert.ok(existsSync(join(ROOT, "scripts", file)), `package.json script references missing scripts/${file}`);
  }
});

test("gate integrity: release/security gates stay in the npm test run", () => {
  const testScript = effectiveTestChain();
  for (const gate of ["release-gate", "tooling-gate", "budget-gate", "phase23-quality-gates", "truth-current", "packaging-current"]) {
    assert.ok(testScript.includes(`scripts/${gate}.test.mjs`), `test script must run scripts/${gate}.test.mjs`);
  }
  assert.ok(existsSync(join(ROOT, "scripts", "scan-secrets.mjs")), "scripts/scan-secrets.mjs must exist");
  const workflows = readdirSync(join(ROOT, ".github", "workflows"));
  assert.ok(
    workflows.some((f) => readFileSync(join(ROOT, ".github", "workflows", f), "utf8").includes("scan-secrets.mjs")),
    "scan-secrets.mjs must stay referenced by a workflow",
  );
});

test("gate integrity: retired historical freeze/release gates stay out of npm test", () => {
  const testScript = effectiveTestChain();
  const retired = readdirSync(join(ROOT, "scripts"))
    .filter((f) => /^phase\d+-(freeze|release)\.test\.mjs$/.test(f))
    .sort();
  assert.ok(retired.length > 0, "expected retired freeze/release gate files present");
  for (const file of retired) {
    assert.ok(
      !testScript.includes(`scripts/${file}`),
      `retired gate scripts/${file} must not run in npm test (plan 057); audit standalone: node --test scripts/${file}`,
    );
  }
  // the files themselves remain as immutable release evidence
  for (const file of retired) {
    assert.ok(existsSync(join(ROOT, "scripts", file)), `retired gate scripts/${file} missing`);
  }
});
