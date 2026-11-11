// Plan 024 Task 2: package-truth generator conformance. Runs in the bun run test
// gate segment after phase23-quality-gates.test.mjs.

import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { computePackageTruth, expandWorkspaceDirs, readManifest, workspacePackageCounts } from "./package-truth.mjs";

const ROOT = join(import.meta.dirname, "..");
const run = (args, cwd = ROOT) => spawnSync(process.execPath, args, { cwd, encoding: "utf8" });
const stripStamp = ({ generatedAt, ...rest }) => rest;
const phase30Manifest = JSON.parse(readFileSync(join(ROOT, "scripts", "phase30-freeze-manifest.json"), "utf8"));
const hasDesktopPackage = phase30Manifest.tasks.task7 === "done";
const hasWikiPackage = existsSync(join(ROOT, "packages", "prism-wiki", "package.json"));
const hasGraftPackage = existsSync(join(ROOT, "packages", "prism-graft")); // plan 033 optional context-graph package
const hasObscuraPackage = existsSync(join(ROOT, "packages", "obscura", "package.json")); // plan 039 optional Obscura browser package
const hasDevInspectorPackage = existsSync(join(ROOT, "packages", "prism-dev", "package.json")); // plan 040 dev inspector (omitted from umbrellas)
const hasPromptPackage = existsSync(join(ROOT, "packages", "prompts", "package.json")); // plan 042 versioned prompt registry (omitted from umbrellas)
const packages = workspacePackageCounts();
const hasWorkPackage = packages.has("work") || packages.has("tools"); // plan 083 Task 2 work family; plan 155 Task 5 moved it under packages/tools/
const hasDocumentsPackage = existsSync(join(ROOT, "packages", "documents", "package.json")); // plan 051 documents engine (omitted from umbrellas)
const hasSheetsPackage = existsSync(join(ROOT, "packages", "sheets", "package.json")); // plan 052 sheets engine (omitted from umbrellas)
const hasDiagramsPackage = existsSync(join(ROOT, "packages", "diagrams", "package.json")); // plan 053 diagrams engine (omitted from umbrellas)

const hasCodingToolsPackage = packages.has("prism-" + "coding-tools");
const hasCorePackage = packages.has("prism-core");
// Plan 174 Tasks 6-7: the 0.13 tree has no core, no 0.12 family workspaces, and no umbrella profiles.
// Branches written for the pre-0.13 shape key off this instead of the retired coding-tools workspace.
const isThirteen = !hasCodingToolsPackage && !hasCorePackage && (packages.has("coding") || packages.has("tools"));

test("generator reproducible: two runs byte-identical modulo generatedAt", () => {
  assert.deepEqual(stripStamp(computePackageTruth()), stripStamp(computePackageTruth()));
});

test("committed artifact equals the generator output (regenerate via bun scripts/package-truth.mjs)", () => {
  const artifact = JSON.parse(readFileSync(join(ROOT, "scripts", "package-truth.json"), "utf8"));
  assert.deepEqual(
    stripStamp(artifact),
    stripStamp(computePackageTruth()),
    "scripts/package-truth.json is stale; run: bun scripts/package-truth.mjs",
  );
});

test("counts match manifests at the truth graph", () => {
  const t = computePackageTruth();
  const added =
    Number(hasDesktopPackage) +
    Number(hasWikiPackage) +
    Number(hasGraftPackage) +
    Number(hasObscuraPackage) +
    Number(hasDevInspectorPackage) +
    Number(hasPromptPackage) +
    Number(hasDocumentsPackage) +
    Number(hasSheetsPackage) +
    Number(hasDiagramsPackage);
  if (hasWorkPackage) {
    // Plan 224: one kernel and six bundles; provider entries remain individual subpaths.
    assert.equal(t.counts.publishable, 7);
    assert.equal(t.counts.workspace, 6);
    assert.equal(t.counts.provider, 11);
    assert.equal(t.counts.prismFamily, 0);
    assert.equal(t.counts.capability, 6);
    assert.equal(t.counts.codeWithPeer, 6);
    assert.equal(t.counts.pureManifest, 0);
  } else if (hasCodingToolsPackage) {
    assert.equal(t.counts.publishable, 17);
    assert.equal(t.counts.workspace, 16);
    assert.equal(t.counts.provider, 17);
    assert.equal(t.counts.prismFamily, 7);
    assert.equal(t.counts.capability, 9);
    assert.equal(t.counts.codeWithPeer, 12);
    assert.equal(t.counts.pureManifest, 4);
  } else if (hasCorePackage) {
    assert.equal(t.counts.publishable, 50);
    assert.equal(t.counts.workspace, 49);
    assert.equal(t.counts.provider, 17);
    assert.equal(t.counts.prismFamily, 11);
    assert.equal(t.counts.capability, 21);
    assert.equal(t.counts.codeWithPeer, 43);
    assert.equal(t.counts.pureManifest, 6);
  } else {
    assert.equal(t.counts.publishable, 56 + added);
    assert.equal(t.counts.workspace, 55 + added);
    assert.equal(t.counts.provider, 17);
    assert.equal(t.counts.prismFamily, 10);
    assert.equal(t.counts.capability, 27 + added);
    assert.equal(t.counts.codeWithPeer, 49 + added);
    assert.equal(t.counts.pureManifest, 6);
    assert.equal(t.providers.length, 17);
    assert.equal(t.family.length, 10);
    assert.equal(t.capability.length, 27 + added);
  }
  assert.equal(t.peerPolicy.decision, "B");
  assert.equal(t.peerPolicy.spec, `^${t.root.version}`);
  assert.equal(t.peerPolicy.atomicUpgrade, false);
});

test("umbrella closures match manifests", () => {
  const t = computePackageTruth();
  // Plan 152 Task 8: the @arnilo/prism-providers workspace is deleted, so the provider family is
  // no longer an umbrella at all — the truth graph must not resurrect it as a closure.
  assert.equal(t.umbrella["prism-providers"], undefined, "the retired provider family must not appear as an umbrella");
  assert.equal(t.umbrella["prism-all"], undefined);
  assert.equal(Object.keys(t.umbrella).length, 0, "no umbrella profile remains after plan 152");
});

test("profile closures match manifests", () => {
  const t = computePackageTruth();
  if (hasWorkPackage) {
    // Plan 054 Task 8: profile manifests are deleted; only the provider family remains.
    assert.deepEqual(t.profiles, {});
    return;
  }
  assert.equal(t.profiles["prism-providers"].length, hasCodingToolsPackage ? 0 : 14);
  if (hasCodingToolsPackage) {
    assert.equal(t.profiles["prism-base"], undefined);
    assert.equal(t.profiles["prism-sdk"], undefined);
  } else if (hasCorePackage) {
    assert.equal(t.profiles["prism-base"], undefined);
    assert.equal(t.profiles["prism-sdk"], undefined);
  } else {
    assert.equal(t.profiles["prism-all"].length, 48);
    for (const name of ["@arnilo/prism-compaction", "@arnilo/prism-tool-validator-json-schema", "@arnilo/prism-compaction-llm"]) {
      assert.ok(t.profiles["prism-base"].includes(name), `prism-base closure includes ${name}`);
    }
    for (const name of [
      "@arnilo/prism-extensions/workflows",
      "@arnilo/prism-credentials-node",
      "@arnilo/prism-observability-opentelemetry",
    ]) {
      assert.ok(t.profiles["prism-sdk"].includes(name), `prism-sdk closure includes ${name}`);
    }
  }
});

test("engines floor lockstep: every publishable manifest declares the Bun runtime floor", () => {
  // Plan 125 Task 1: the runtime contract is Bun, so the lockstep is engines.bun — a package
  // drifting to a looser floor, or keeping the retired engines.node, fails here.
  const root = readManifest(join(ROOT, "package.json"));
  assert.equal(root.engines?.bun, ">=1.4.4", "root manifest must declare the Bun runtime floor");
  assert.equal(root.engines?.node, undefined, "root manifest must not declare the retired engines.node");
  const dirs = expandWorkspaceDirs(ROOT, root.workspaces);
  assert.ok(dirs.length > 0, "workspace globs must match at least one package");
  for (const dir of dirs) {
    const manifest = readManifest(join(dir, "package.json"));
    assert.equal(manifest.engines?.bun, root.engines.bun, `${manifest.name} must declare the root engines floor ${root.engines.bun}`);
    assert.equal(manifest.engines?.node, undefined, `${manifest.name} must not declare the retired engines.node`);
  }
});

/**
 * A code package on the lockstep line pins `@arnilo/prism` at the caret of the current version. A
 * package that owns its version line (scripts/independent-packages.json) pins the same 0.x line at a
 * floor instead: a lockstep cut rewriting it would change an already-published manifest, and the next
 * release --resume then refuses ("already exists on the registry") because the local manifest no
 * longer matches the registry's.
 */
export function assertCorePin(dep, range, rootVersion, owner) {
  const independent = new Set(JSON.parse(readFileSync(join(ROOT, "scripts", "independent-packages.json"), "utf8")).packages);
  if (independent.has(owner)) {
    const [major, minor] = rootVersion.split(".");
    assert.match(
      range ?? "",
      new RegExp(`^\\^${major}\\.${minor}\\.\\d+$`),
      `${owner} must depend on ${dep} with a caret on the ${major}.${minor} line, got ${range}`,
    );
    return;
  }
  if (dep === "@arnilo/prism") {
    // The kernel peer is the API-level window, not a cut pin: every package admits the whole 0.x line.
    assert.match(range ?? "", /^>=\d+\.\d+\.\d+ <1\.0\.0$/, `${owner} must peer ${dep} with the 0.x API window, got ${range}`);
    return;
  }
  assert.equal(range, `^${rootVersion}`, `${owner} must depend on ${dep}@^${rootVersion}`);
}

test("peer policy Decision B: all code packages peer the 0.x kernel window", () => {
  const t = computePackageTruth();
  const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const pkgs = expandWorkspaceDirs(ROOT, root.workspaces)
    .map((dir) => ({
      dir,
      ...readManifest(join(dir, "package.json")),
    }))
    .filter((pkg) => pkg.private !== true);
  const codeWithPeer = pkgs.filter((p) => p.peerDependencies?.["@arnilo/prism"] !== undefined);
  assert.equal(codeWithPeer.length, t.counts.codeWithPeer, "code packages with a core peer");
  const secondPeers = {};
  for (const p of codeWithPeer) {
    const spec = p.peerDependencies["@arnilo/prism"];
    // Plan 071 Task 1 (plan 070 FA 10): a compatibility bump moves the whole 0.x API window; a
    // package that owns its version line pins the same line at a floor (see assertCorePin).
    assertCorePin("@arnilo/prism", spec, t.root.version, p.name);
    assert.match(spec, /^>=\d+\.\d+\.\d+ <1\.0\.0$/, `${p.name} peer spec must be the 0.x API window, got ${spec}`);
    const extra = Object.keys(p.peerDependencies).filter((n) => n.startsWith("@arnilo/prism-"));
    if (extra.length > 0) secondPeers[p.name] = extra;
  }
  // Plan 181 Task 1: the root links itself (`"@arnilo/prism": "file:."` in its devDependencies),
  // so a workspace resolves the peer locally through that one self-reference and declares no
  // `file:` kernel devDependency. Two lockfile entries per package made `bun ci` re-resolve the
  // workspace root on every install and never freeze.
  assert.equal(root.devDependencies?.["@arnilo/prism"], "file:.", "the root must link itself for local peer resolution");
  for (const p of codeWithPeer) {
    assert.equal(p.devDependencies?.["@arnilo/prism"], undefined, `${p.name} must not carry a file: kernel devDependency`);
  }
  if (hasCodingToolsPackage || isThirteen) {
    // Bundle manifests own peer declarations; sibling subpaths share one install unit.
    assert.deepEqual(secondPeers, {
      "@arnilo/prism-tools": ["@arnilo/prism-extensions"],
      "@arnilo/prism-knowledge": ["@arnilo/prism-tools"],
    });
  } else if (hasCorePackage) {
    assert.deepEqual(secondPeers, {
      "@arnilo/prism-hosts/ag-ui": ["@arnilo/prism-extensions"],
      "@arnilo/prism-coding-agent": [],
      "@arnilo/prism-coding-security": ["@arnilo/prism-coding-agent"],
      ...(hasDesktopPackage ? { "@arnilo/prism-computer-use-linux": ["@arnilo/prism-extensions/mcp"] } : {}),
      ...(hasDevInspectorPackage ? { "@arnilo/prism-dev": ["@arnilo/prism-hosts/ag-ui"] } : {}),
      "@arnilo/prism-document-reader": ["@arnilo/prism-coding-agent"],
      ...(hasObscuraPackage
        ? { "@arnilo/prism-obscura": ["@arnilo/prism-extensions/mcp", "@arnilo/prism-browser", "@arnilo/prism-web-tools"] }
        : {}),
      "@arnilo/prism-knowledge/rag": ["@arnilo/prism-memory"],
    });
  } else {
    assert.deepEqual(secondPeers, {
      "@arnilo/prism-hosts/ag-ui": ["@arnilo/prism-extensions/mcp", "@arnilo/prism-supervisor"],
      "@arnilo/prism-coding-agent": ["@arnilo/prism-extensions/workflows"],
      "@arnilo/prism-coding-security": ["@arnilo/prism-coding-agent"],
      ...(hasDesktopPackage ? { "@arnilo/prism-computer-use-linux": ["@arnilo/prism-extensions/mcp"] } : {}),
      ...(hasObscuraPackage
        ? { "@arnilo/prism-obscura": ["@arnilo/prism-extensions/mcp", "@arnilo/prism-browser", "@arnilo/prism-web-tools"] }
        : {}),
      ...(hasDevInspectorPackage ? { "@arnilo/prism-dev": ["@arnilo/prism-hosts/ag-ui", "@arnilo/prism-server"] } : {}),
      "@arnilo/prism-document-reader": ["@arnilo/prism-coding-agent"],
      "@arnilo/prism-knowledge/rag": ["@arnilo/prism-memory"],
      "@arnilo/prism-server": ["@arnilo/prism-extensions/workflows"],
      ...(hasPromptPackage ? { "@arnilo/prism-prompts": ["@arnilo/prism-hosts/evals"] } : {}),
    });
  }
  // Plan 107 Task 2 removed the caveman/ponytail persona subpaths and their optional peer; plan 174
  // Task 7 retired the coding-tools workspace that carried the check, so nothing asserts it here.
  // Plan 054 Task 8: profile manifests are deleted; every workspace package is a
  // code package with a core peer, so nothing may lack one.
  if (hasWorkPackage) {
    for (const p of pkgs) {
      assert.notEqual(p.peerDependencies?.["@arnilo/prism"], undefined, `${p.name} must peer @arnilo/prism`);
    }
  }
});

test("malformed manifest exits non-zero and names the file", () => {
  const dir = mkdtempSync(join(tmpdir(), "prism-truth-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0", workspaces: ["packages/*"] }));
    mkdirSync(join(dir, "packages", "a"), { recursive: true });
    writeFileSync(join(dir, "packages", "a", "package.json"), "{ not json");
    const result = run([join(ROOT, "scripts", "package-truth.mjs"), "--root", dir, "--out", join(dir, "out.json")]);
    assert.notEqual(result.status, 0, "malformed manifest must exit non-zero");
    assert.ok(result.stderr.includes("malformed manifest"), `stderr names the malformed manifest: ${result.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("workspace glob matching no directory exits non-zero", () => {
  const dir = mkdtempSync(join(tmpdir(), "prism-truth-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0", workspaces: ["packages/*", "missing/*"] }));
    mkdirSync(join(dir, "packages"), { recursive: true });
    const result = run([join(ROOT, "scripts", "package-truth.mjs"), "--root", dir, "--out", join(dir, "out.json")]);
    assert.notEqual(result.status, 0, "unmatched workspace glob must exit non-zero");
    assert.ok(result.stderr.includes("matches no directory"), `stderr names the glob: ${result.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Plan 024 Task 5: built public-entry and docs-wide truth conformance over the
// generated artifact. The frozen export surface itself is pinned by
// src/__tests__/public-export-contract.test.ts; this leg checks the published
// entry against the root manifest version, the docs current-line, and the umbrella
// wording freeze (no "all"/"every" claim without closure proof).
// Plan 174 Task 8: the entry is TypeScript source, not `dist/index.js`.
test("published entry exposes the manifest version and the frozen surface resolves", async () => {
  const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const entry = join(ROOT, "src", "index.ts");
  assert.ok(existsSync(entry), "src/index.ts missing — the kernel publishes TypeScript source");
  const mod = await import(pathToFileURL(entry).href);
  assert.equal(mod.version, root.version, "version export must equal the root manifest version");
  assert.equal(typeof mod.agentFingerprint, "function", "frozen public surface must resolve from the published entry");
});

test("docs current-line version equals the root manifest version", () => {
  const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const index = readFileSync(join(ROOT, "docs", "index.md"), "utf8");
  assert.ok(index.includes(`current **${root.version}**`), `docs/index.md current-line must be ${root.version}`);
});

test("no page claims all/every for the two umbrellas without closure proof", () => {
  const files = [
    "README.md",
    "docs/release.md",
    "docs/index.md",
    "docs/history/0.1.0-readiness.md",
    // Plan 152 Task 8: the provider family README is deleted with its workspace; the
    // standalone package READMEs live under packages/providers/*/README.md.
    ...(existsSync(join(ROOT, "packages/prism-all/README.md")) ? ["packages/prism-all/README.md"] : []),
  ];
  // The false-claim shapes Task 1 removed; Task 4's derived tests pin the true
  // wording, this scan bans the unproven shapes from returning. Quantified or
  // omission-named claims ("11 of 14", "all eleven") are closure-proven and
  // deliberately not banned.
  const falseClaims = [
    /all 14 first-party provider adapters/i,
    /every first-party package, including/i,
    /installs all first-party prism provider adapters/i,
    /complete prism umbrella/i,
    /all first-party prism provider/i,
    /every current publishable package/i,
  ];
  for (const file of files) {
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const pattern of falseClaims) {
      assert.doesNotMatch(text, pattern, `${file} re-introduces an unproven umbrella claim: ${pattern}`);
    }
  }
});

test("gate accounting: roadmap §0.2.4 names the five acceptance criteria this suite enforces", () => {
  const roadmap = readFileSync(join(ROOT, "roadmap.md"), "utf8");
  const criteria = [
    /no page claims ["“]every["”] or ["“]all["”] unless dependency closure proves it/,
    /packed-install tests assert documented contents/,
    /generated checks catch drift/,
    /stale 0\.1\.1\/0\.0\.23 ["“]current line["”] text and contradictory provider counts are gone/,
    /docs tests fail on wrong package closure\/version\/navigation while permitting editorial changes/,
  ];
  for (const pattern of criteria) {
    assert.ok(pattern.test(roadmap), `roadmap §0.2.4 must state: ${pattern}`);
  }
});
