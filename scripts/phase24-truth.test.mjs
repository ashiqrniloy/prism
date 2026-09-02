// Plan 024 Task 2: package-truth generator conformance. Runs in the npm test
// gate segment after phase23-quality-gates.test.mjs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { computePackageTruth, expandWorkspaceDirs, readManifest } from "./package-truth.mjs";

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
const hasOfficePackage = existsSync(join(ROOT, "packages", "office", "package.json")); // plan 054 Task 8 office family
const hasDocumentsPackage = existsSync(join(ROOT, "packages", "documents", "package.json")); // plan 051 documents engine (omitted from umbrellas)
const hasSheetsPackage = existsSync(join(ROOT, "packages", "sheets", "package.json")); // plan 052 sheets engine (omitted from umbrellas)
const hasDiagramsPackage = existsSync(join(ROOT, "packages", "diagrams", "package.json")); // plan 053 diagrams engine (omitted from umbrellas)

const hasCodingToolsPackage = existsSync(join(ROOT, "packages", "prism-coding-tools", "package.json"));
const hasCorePackage = existsSync(join(ROOT, "packages", "prism-core", "package.json"));

test("generator reproducible: two runs byte-identical modulo generatedAt", () => {
  assert.deepEqual(stripStamp(computePackageTruth()), stripStamp(computePackageTruth()));
});

test("committed artifact equals the generator output (regenerate via node scripts/package-truth.mjs)", () => {
  const artifact = JSON.parse(readFileSync(join(ROOT, "scripts", "package-truth.json"), "utf8"));
  assert.deepEqual(
    stripStamp(artifact),
    stripStamp(computePackageTruth()),
    "scripts/package-truth.json is stale; run: node scripts/package-truth.mjs",
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
  if (hasOfficePackage) {
    // Current package set: delegated CLI adapter removed; provider family has 19 subpaths.
    assert.equal(t.counts.publishable, 10);
    assert.equal(t.counts.workspace, 9);
    assert.equal(t.counts.provider, 19);
    assert.equal(t.counts.prismFamily, 3);
    assert.equal(t.counts.capability, 6);
    assert.equal(t.counts.codeWithPeer, 9);
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
    assert.equal(t.counts.publishable, 55 + added);
    assert.equal(t.counts.workspace, 54 + added);
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
  const providers = t.umbrella["prism-providers"];
  if (hasCodingToolsPackage) {
    // Plan 054 Task 6 + plan 055 Task 6: the family ships its 19 adapters as subpaths, not deps.
    assert.deepEqual(providers.deps, []);
    assert.equal(providers.subpaths.length, 19);
    assert.deepEqual(providers.omitsProviders, []);
  } else {
    assert.equal(providers.deps.length, 14);
    assert.deepEqual(providers.omitsProviders, [
      "@arnilo/prism-provider-azure",
      "@arnilo/prism-provider-bedrock",
      "@arnilo/prism-provider-vertex",
    ]);
  }
  if (hasOfficePackage) {
    // Plan 054 Task 8: prism-all is retired; the provider family is the only umbrella.
    assert.equal(t.umbrella["prism-all"], undefined);
    assert.deepEqual(providers.deps, []);
    return;
  }
  const all = t.umbrella["prism-all"];
  if (hasCodingToolsPackage) {
    assert.equal(all.deps.length, 8);
  } else if (hasCorePackage) {
    assert.equal(all.deps.length, 13);
  } else {
    assert.equal(all.deps.length, 21);
    assert.equal(all.closure, 47, "21 direct deps expand through code/sdk/profile deps to 47 workspace packages");
  }
});

test("profile closures match manifests", () => {
  const t = computePackageTruth();
  if (hasOfficePackage) {
    // Plan 054 Task 8: profile manifests are deleted; only the provider family remains.
    assert.deepEqual(t.profiles, {});
    return;
  }
  assert.equal(t.profiles["prism-providers"].length, hasCodingToolsPackage ? 0 : 14);
  if (hasCodingToolsPackage) {
    assert.ok(t.profiles["prism-base"].includes("@arnilo/prism-core"));
    assert.ok(t.profiles["prism-code"].includes("@arnilo/prism-coding-tools"));
    assert.ok(t.profiles["prism-sdk"].includes("@arnilo/prism-core"));
  } else if (hasCorePackage) {
    assert.ok(t.profiles["prism-base"].includes("@arnilo/prism-core"));
    assert.ok(t.profiles["prism-sdk"].includes("@arnilo/prism-core"));
  } else {
    assert.equal(t.profiles["prism-all"].length, 47);
    for (const name of ["@arnilo/prism-compaction", "@arnilo/prism-tool-validator-json-schema", "@arnilo/prism-compaction-llm"]) {
      assert.ok(t.profiles["prism-base"].includes(name), `prism-base closure includes ${name}`);
    }
    for (const name of ["@arnilo/prism-base", "@arnilo/prism-coding-agent", "@arnilo/prism-mcp"]) {
      assert.ok(t.profiles["prism-code"].includes(name), `prism-code closure includes ${name}`);
    }
    for (const name of ["@arnilo/prism-workflows", "@arnilo/prism-credentials-node", "@arnilo/prism-observability-opentelemetry"]) {
      assert.ok(t.profiles["prism-sdk"].includes(name), `prism-sdk closure includes ${name}`);
    }
  }
});

test("peer policy Decision B: all code packages peer the caret current line", () => {
  const t = computePackageTruth();
  const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const pkgs = expandWorkspaceDirs(ROOT, root.workspaces).map((dir) => ({
    dir,
    ...readManifest(join(dir, "package.json")),
  }));
  const codeWithPeer = pkgs.filter((p) => p.peerDependencies?.["@arnilo/prism"] !== undefined);
  assert.equal(codeWithPeer.length, t.counts.codeWithPeer, "code packages with a core peer");
  const secondPeers = {};
  for (const p of codeWithPeer) {
    const spec = p.peerDependencies["@arnilo/prism"];
    assert.equal(spec, "^0.4.0", `${p.name} must peer @arnilo/prism@^0.4.0, got ${spec}`);
    assert.match(spec, /^\^\d+\.\d+\.\d+$/, `${p.name} peer spec must be a 0.x caret range, got ${spec}`);
    const extra = Object.keys(p.peerDependencies).filter((n) => n.startsWith("@arnilo/prism-"));
    if (extra.length > 0) secondPeers[p.name] = extra;
    // devDependency on the root so the workspace resolves the peer locally
    // (session-store-codecs is the one package with no devDependencies at all)
    if (p.name !== "@arnilo/prism-session-store-codecs") {
      assert.equal(p.devDependencies?.["@arnilo/prism"], "file:../..", `${p.name} must devDepend on the root`);
    }
  }
  if (hasCodingToolsPackage) {
    // Plan 054 Task 6: the provider family is now a code package with a core peer.
    assert.deepEqual(secondPeers, {
      "@arnilo/prism-acp-agent": ["@arnilo/prism-ag-ui"],
      "@arnilo/prism-ag-ui": ["@arnilo/prism-core", "@arnilo/prism-mcp"],
      "@arnilo/prism-core": ["@arnilo/prism-memory"], // type-only optional peer: rag telemetry seam
      "@arnilo/prism-web-tools": ["@arnilo/prism-mcp"],
    });
  } else if (hasCorePackage) {
    assert.deepEqual(secondPeers, {
      "@arnilo/prism-acp-agent": ["@arnilo/prism-ag-ui"],
      "@arnilo/prism-ag-ui": ["@arnilo/prism-core", "@arnilo/prism-mcp"],
      "@arnilo/prism-coding-agent": ["@arnilo/prism-core"],
      "@arnilo/prism-coding-security": ["@arnilo/prism-coding-agent"],
      ...(hasDesktopPackage ? { "@arnilo/prism-computer-use-linux": ["@arnilo/prism-mcp"] } : {}),
      ...(hasDevInspectorPackage ? { "@arnilo/prism-dev": ["@arnilo/prism-ag-ui", "@arnilo/prism-core"] } : {}),
      "@arnilo/prism-document-reader": ["@arnilo/prism-coding-agent"],
      ...(hasObscuraPackage ? { "@arnilo/prism-obscura": ["@arnilo/prism-mcp", "@arnilo/prism-browser", "@arnilo/prism-web-tools"] } : {}),
      "@arnilo/prism-rag": ["@arnilo/prism-memory"],
    });
  } else {
    assert.deepEqual(secondPeers, {
      "@arnilo/prism-acp-agent": ["@arnilo/prism-ag-ui"],
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
  const ponytail = pkgs.find((p) => p.name === (hasCodingToolsPackage ? "@arnilo/prism-coding-tools" : "@arnilo/prism-ponytail"));
  assert.equal(ponytail.peerDependencies["@dietrichgebert/ponytail"], "^4.9.0");
  // Plan 054 Task 8: profile manifests are deleted; every workspace package is a
  // code package with a core peer, so nothing may lack one.
  if (hasOfficePackage) {
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
// src/__tests__/public-export-contract.test.ts; this leg checks the built dist
// against the root manifest version, the docs current-line, and the umbrella
// wording freeze (no "all"/"every" claim without closure proof).
test("built dist exposes the manifest version and the frozen surface resolves", async () => {
  const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const distIndex = join(ROOT, "dist", "index.js");
  assert.ok(existsSync(distIndex), "dist/index.js missing — run npm run build before this leg");
  const mod = await import(pathToFileURL(distIndex).href);
  assert.equal(mod.version, root.version, "dist version export must equal the root manifest version");
  assert.equal(typeof mod.resumeAgentRunStream, "function", "frozen public surface must resolve from the built dist");
});

test("docs current-line version equals the root manifest version", () => {
  const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const index = readFileSync(join(ROOT, "docs", "index.md"), "utf8");
  const readiness = readFileSync(join(ROOT, "docs", "0.1.0-readiness.md"), "utf8");
  assert.ok(index.includes(`current **${root.version}**`), `docs/index.md current-line must be ${root.version}`);
  assert.ok(readiness.includes(`## Current line (${root.version})`), `readiness current-line heading must be ${root.version}`);
});

test("no page claims all/every for the two umbrellas without closure proof", () => {
  const files = [
    "README.md",
    "docs/release-and-install.md",
    "docs/index.md",
    "docs/0.1.0-readiness.md",
    "packages/prism-providers/README.md",
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
