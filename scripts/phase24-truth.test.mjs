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
const hasWorkPackage = packages.has("work"); // plan 083 Task 2 work family; plan 155 Task 5 moved it under packages/tools/
const hasDocumentsPackage = existsSync(join(ROOT, "packages", "documents", "package.json")); // plan 051 documents engine (omitted from umbrellas)
const hasSheetsPackage = existsSync(join(ROOT, "packages", "sheets", "package.json")); // plan 052 sheets engine (omitted from umbrellas)
const hasDiagramsPackage = existsSync(join(ROOT, "packages", "diagrams", "package.json")); // plan 053 diagrams engine (omitted from umbrellas)

const hasCodingToolsPackage = packages.has("prism-" + "coding-tools");
const hasCorePackage = packages.has("prism-core");
// Plan 174 Tasks 6-7: the 0.13 tree has no core, no 0.12 family workspaces, and no umbrella profiles.
// Branches written for the pre-0.13 shape key off this instead of the retired coding-tools workspace.
const isThirteen = !hasCodingToolsPackage && !hasCorePackage && packages.has("coding");

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
    // Current package set: delegated CLI adapter removed; every first-party provider adapter is a
    // standalone @arnilo/prism-provider-<vendor> package (plan 152 Tasks 3-6) and the retired
    // @arnilo/prism-providers umbrella workspace is deleted (plan 152 Task 8).
    // Plan 152 Task 7: the credentials-slot keyring package is a capability package; plan 153
    // Tasks 3-5 add the JSONL, codecs, SQLite, and Postgres store packages; plan 154 Task 3 adds
    // @arnilo/prism-tools-coding, so capability is 15; plan 154 Task 6 adds
    // @arnilo/prism-approval and Task 7 adds @arnilo/prism-context-files, so capability is 17.
    // Plan 155 Task 2 adds @arnilo/prism-tools-web, Task 3 adds @arnilo/prism-tools-browser, and
    // Task 4 adds @arnilo/prism-tools-openapi and @arnilo/prism-tools-computer-use, so capability is 20.
    // Plan 157 Tasks 3-4 add the compaction and observational-memory packages, so capability is 22;
    // plan 158 Task 2 adds the shared memory-core library, Task 3 adds memory-rag, Task 4 adds
    // memory-fabric, and Task 5 adds memory-wiki, so capability is 26. Plan 158 Task 6 deletes the
    // `@arnilo/prism-memory` family workspace, so publishable was 50, workspace 49, capability 25,
    // and codeWithPeer 47. Plan 158 Task 7 adds the @arnilo/prism-context-engineering capability
    // package, so publishable was 51, workspace 50, capability 26, and codeWithPeer 48.
    // Plan 159 Task 3 adds the @arnilo/prism-mcp-server host library and Task 5 adds the
    // @arnilo/prism-guardrail-packs capability package, so publishable is 53, workspace 52,
    // capability 28, and codeWithPeer 50. Plan 159 Task 6 adds the @arnilo/prism-governance
    // capability package, so publishable is 54, workspace 53, capability 29, and codeWithPeer 51.
    // Plan 160 Task 2 adds the @arnilo/prism-model-router capability package, so publishable is 55,
    // workspace 54, capability 30, and codeWithPeer 52. Plan 160 Task 3 adds the
    // @arnilo/prism-observability capability package, so publishable is 56, workspace 55,
    // capability 31, and codeWithPeer 53. Plan 160 Task 4 adds the @arnilo/prism-delegate capability
    // package, so publishable is 57, workspace 56, capability 32, and codeWithPeer 54.
    // Plan 161 Task 2 adds the @arnilo/prism-acp host library, so publishable is 58,
    // workspace 57, capability 33, and codeWithPeer 55.
    // Plans 162 and 166 add evals, devtools, and the process driver. Plan 168 Task 2 adds the
    // @arnilo/prism-workflows capability package; plans 170-172 add @arnilo/prism-remote,
    // @arnilo/prism-headless, and @arnilo/prism-tools-research, so publishable is 65, workspace 64,
    // capability 40, and codeWithPeer 62. Plan 173 Task 8 deletes the Prism Code app workspace, so
    // publishable is 64, workspace 63, capability 39, codeWithPeer 62, and pureManifest 1.
    // Plan 174 Task 6 retires the core family package, so publishable is 63, workspace 62,
    // prismFamily 2, and codeWithPeer 61. Plan 174 Task 7 retires the three 0.12 workspaces,
    // so publishable is 60, workspace 59, prismFamily 1, capability 37, codeWithPeer 59,
    // and pureManifest 0. Plan 182 Task 2 retires the 17 provider packages, so publishable is 43,
    // workspace 42, provider 4, capability 37, codeWithPeer 42, and pureManifest 0.
    // Plan 195 Task 5 adds the @arnilo/prism-provider-liquid provider package, so provider is 5;
    // plan 191 Task 8 adds the @arnilo/prism-advisor capability package, so publishable is 45,
    // workspace 44, capability 38, and codeWithPeer 44.
    // Plan 203 Task 4 restores OpenRouter as a lockstep provider package.
    // Plan 204 Task 5 adds the @arnilo/prism-provider-openai-codex provider package, so publishable
    // is 47, workspace 46, provider 7, capability 38, and codeWithPeer 46.
    // Plan 205 Task 2 adds the @arnilo/prism-provider-commandcode provider package, so publishable is
    // 48, workspace 47, provider 8, and codeWithPeer 47.
    assert.equal(t.counts.publishable, 48);
    assert.equal(t.counts.workspace, 47);
    assert.equal(t.counts.provider, 8);
    assert.equal(t.counts.prismFamily, 1);
    assert.equal(t.counts.capability, 38);
    assert.equal(t.counts.codeWithPeer, 47);
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
    assert.equal(t.counts.codeWithPeer, 48 + added);
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
    assert.equal(t.profiles["prism-all"].length, 47);
    for (const name of ["@arnilo/prism-compaction", "@arnilo/prism-tool-validator-json-schema", "@arnilo/prism-compaction-llm"]) {
      assert.ok(t.profiles["prism-base"].includes(name), `prism-base closure includes ${name}`);
    }
    for (const name of ["@arnilo/prism-workflows", "@arnilo/prism-credentials-node", "@arnilo/prism-observability-opentelemetry"]) {
      assert.ok(t.profiles["prism-sdk"].includes(name), `prism-sdk closure includes ${name}`);
    }
  }
});

test("engines floor lockstep: every publishable manifest declares the Bun runtime floor", () => {
  // Plan 125 Task 1: the runtime contract is Bun, so the lockstep is engines.bun — a package
  // drifting to a looser floor, or keeping the retired engines.node, fails here.
  const root = readManifest(join(ROOT, "package.json"));
  assert.equal(root.engines?.bun, ">=1.4.2", "root manifest must declare the Bun runtime floor");
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
    // Plan 054 Task 6: the provider family is now a code package with a core peer.
    assert.deepEqual(secondPeers, {
      "@arnilo/prism-ag-ui": ["@arnilo/prism-mcp"],
      "@arnilo/prism-tools-coding": ["@arnilo/prism-workflows"], // plan 168 Task 7: the goal→verify helper runs the workflow engine
      "@arnilo/prism-memory-rag": ["@arnilo/prism-tools-web"], // type-only optional peer: the web.fetch service shape
      "@arnilo/prism-memory-wiki": ["@arnilo/prism-tools-web"], // type-only optional peer: the web.fetch service shape
      "@arnilo/prism-tools-web": ["@arnilo/prism-mcp"],
      "@arnilo/prism-tools-computer-use": ["@arnilo/prism-mcp"],
    });
  } else if (hasCorePackage) {
    assert.deepEqual(secondPeers, {
      "@arnilo/prism-ag-ui": ["@arnilo/prism-mcp"],
      "@arnilo/prism-coding-agent": [],
      "@arnilo/prism-coding-security": ["@arnilo/prism-coding-agent"],
      ...(hasDesktopPackage ? { "@arnilo/prism-computer-use-linux": ["@arnilo/prism-mcp"] } : {}),
      ...(hasDevInspectorPackage ? { "@arnilo/prism-dev": ["@arnilo/prism-ag-ui"] } : {}),
      "@arnilo/prism-document-reader": ["@arnilo/prism-coding-agent"],
      ...(hasObscuraPackage ? { "@arnilo/prism-obscura": ["@arnilo/prism-mcp", "@arnilo/prism-browser", "@arnilo/prism-web-tools"] } : {}),
      "@arnilo/prism-rag": ["@arnilo/prism-memory"],
    });
  } else {
    assert.deepEqual(secondPeers, {
      "@arnilo/prism-ag-ui": ["@arnilo/prism-mcp", "@arnilo/prism-supervisor"],
      "@arnilo/prism-coding-agent": ["@arnilo/prism-workflows"],
      "@arnilo/prism-coding-security": ["@arnilo/prism-coding-agent"],
      ...(hasDesktopPackage ? { "@arnilo/prism-computer-use-linux": ["@arnilo/prism-mcp"] } : {}),
      ...(hasObscuraPackage ? { "@arnilo/prism-obscura": ["@arnilo/prism-mcp", "@arnilo/prism-browser", "@arnilo/prism-web-tools"] } : {}),
      ...(hasDevInspectorPackage ? { "@arnilo/prism-dev": ["@arnilo/prism-ag-ui", "@arnilo/prism-server"] } : {}),
      "@arnilo/prism-document-reader": ["@arnilo/prism-coding-agent"],
      "@arnilo/prism-rag": ["@arnilo/prism-memory"],
      "@arnilo/prism-server": ["@arnilo/prism-workflows"],
      ...(hasPromptPackage ? { "@arnilo/prism-prompts": ["@arnilo/prism-evals"] } : {}),
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
