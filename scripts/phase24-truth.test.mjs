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
const hasAntigravityPackage = phase30Manifest.amendments?.antigravity?.tasks?.task6 === "done";
const hasWikiPackage = existsSync(join(ROOT, "packages", "prism-wiki", "package.json"));
const hasGraftPackage = existsSync(join(ROOT, "packages", "prism-graft")); // plan 033 optional context-graph package
const hasObscuraPackage = existsSync(join(ROOT, "packages", "obscura", "package.json")); // plan 039 optional Obscura browser package
const hasDevInspectorPackage = existsSync(join(ROOT, "packages", "prism-dev", "package.json")); // plan 040 dev inspector (omitted from umbrellas)

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

test("counts match manifests at the 0.3.0 truth graph plus the Task 7 desktop package", () => {
  const t = computePackageTruth();
  const added =
    Number(hasDesktopPackage) +
    Number(hasAntigravityPackage) +
    Number(hasWikiPackage) +
    Number(hasGraftPackage) +
    Number(hasObscuraPackage) +
    Number(hasDevInspectorPackage);
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
  assert.equal(t.peerPolicy.decision, "B");
  assert.equal(t.peerPolicy.spec, `^${t.root.version}`);
  assert.equal(t.peerPolicy.atomicUpgrade, false);
});

test("umbrella closures match manifests", () => {
  const t = computePackageTruth();
  const providers = t.umbrella["prism-providers"];
  assert.equal(providers.deps.length, 14);
  assert.deepEqual(providers.omitsProviders, [
    "@arnilo/prism-provider-azure",
    "@arnilo/prism-provider-bedrock",
    "@arnilo/prism-provider-vertex",
  ]);
  const all = t.umbrella["prism-all"];
  assert.equal(all.deps.length, 21);
  assert.equal(all.closure, 47, "21 direct deps expand through code/sdk/profile deps to 47 workspace packages");
  assert.equal(
    all.omits.length,
    6 +
      Number(hasDesktopPackage) +
      Number(hasAntigravityPackage) +
      Number(hasWikiPackage) +
      Number(hasGraftPackage) +
      Number(hasObscuraPackage) +
      Number(hasDevInspectorPackage),
  );
  for (const name of [
    "@arnilo/prism-caveman",
    "@arnilo/prism-document-reader",
    "@arnilo/prism-impeccable",
    "@arnilo/prism-openapi-tools",
    "@arnilo/prism-ponytail",
    "@arnilo/prism-session-store-nats",
    ...(hasDesktopPackage ? ["@arnilo/prism-computer-use-linux"] : []),
    ...(hasAntigravityPackage ? ["@arnilo/prism-antigravity-agent"] : []),
    ...(hasWikiPackage ? ["@arnilo/prism-wiki"] : []),
    ...(hasGraftPackage ? ["@arnilo/prism-graft"] : []),
    ...(hasObscuraPackage ? ["@arnilo/prism-obscura"] : []),
    ...(hasDevInspectorPackage ? ["@arnilo/prism-dev"] : []),
  ]) {
    assert.ok(all.omits.includes(name), `prism-all omits ${name}`);
  }
});

test("profile closures match manifests", () => {
  const t = computePackageTruth();
  assert.equal(t.profiles["prism-providers"].length, 14);
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
    // Decision B window: peers either track the current root patch (^0.3.2 for
    // the plan 050 set, ^0.3.1 for the plan 039 set) or keep the prior ^0.3.0
    // window peer — all satisfy the root while the line is 0.3.x.
    assert.ok(
      spec === `^${t.root.version}` || spec === "^0.3.0" || spec === "^0.3.1",
      `${p.name} must peer @arnilo/prism inside the Decision B window, got ${spec}`,
    );
    assert.match(spec, /^\^\d+\.\d+\.\d+$/, `${p.name} peer spec must be a 0.x caret range, got ${spec}`);
    const extra = Object.keys(p.peerDependencies).filter((n) => n.startsWith("@arnilo/prism-"));
    if (extra.length > 0) secondPeers[p.name] = extra;
    // devDependency on the root so the workspace resolves the peer locally
    // (session-store-codecs is the one package with no devDependencies at all)
    if (p.name !== "@arnilo/prism-session-store-codecs") {
      assert.equal(p.devDependencies?.["@arnilo/prism"], "file:../..", `${p.name} must devDepend on the root`);
    }
  }
  assert.deepEqual(secondPeers, {
    "@arnilo/prism-acp-agent": ["@arnilo/prism-ag-ui"],
    "@arnilo/prism-ag-ui": ["@arnilo/prism-mcp", "@arnilo/prism-supervisor"],
    "@arnilo/prism-coding-agent": ["@arnilo/prism-workflows"],
    "@arnilo/prism-coding-security": ["@arnilo/prism-coding-agent"],
    ...(hasDesktopPackage ? { "@arnilo/prism-computer-use-linux": ["@arnilo/prism-mcp"] } : {}),
    ...(hasObscuraPackage ? { "@arnilo/prism-obscura": ["@arnilo/prism-mcp", "@arnilo/prism-browser", "@arnilo/prism-web-tools"] } : {}),
    ...(hasDevInspectorPackage ? { "@arnilo/prism-dev": ["@arnilo/prism-ag-ui", "@arnilo/prism-server"] } : {}),
    ...(hasAntigravityPackage ? { "@arnilo/prism-antigravity-agent": ["@arnilo/prism-coding-agent", "@arnilo/prism-mcp"] } : {}),
    "@arnilo/prism-document-reader": ["@arnilo/prism-coding-agent"],
    "@arnilo/prism-rag": ["@arnilo/prism-memory"],
    "@arnilo/prism-server": ["@arnilo/prism-workflows"],
  });
  const ponytail = pkgs.find((p) => p.name === "@arnilo/prism-ponytail");
  assert.equal(ponytail.peerDependencies["@dietrichgebert/ponytail"], "^4.9.0");
  // the 6 pure-manifest family/profile packages declare no core peer
  for (const n of [
    "@arnilo/prism-all",
    "@arnilo/prism-base",
    "@arnilo/prism-code",
    "@arnilo/prism-compaction",
    "@arnilo/prism-providers",
    "@arnilo/prism-sdk",
  ]) {
    assert.equal(pkgs.find((x) => x.name === n).peerDependencies?.["@arnilo/prism"], undefined, `${n} must have no core peer`);
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
    "packages/prism-all/README.md",
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
