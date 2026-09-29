#!/usr/bin/env node
import { test } from "bun:test";
// workflow-liveness gate — plan 071 Task 4 (plan 070 FA 3).
//
// `.github/workflows/*.yml` name workspaces and npm scripts, and nothing used to
// resolve those names. `sandbox-browser.yml` kept building `@arnilo/prism-evals`,
// `-workflows`, `-coding-agent` and `-diagrams` long after those packages were
// retired, and its draw.io leg called a `test:drawio` script that no package has:
// the drift only showed up in a scheduled CI run. This gate resolves every
// `-w <pkg>` / `--workspace[= ]<pkg>` target against the live workspace inventory
// and every named npm script against that package's manifest (the root manifest for
// a bare `npm run x`), so the next rename or retirement fails `bun run test` instead.
//
// The same drift class lives in `scripts/**`: the phase-26 journey packed
// `packages/coding-agent`/`-security` and `phase11-auth` imported
// `@arnilo/prism-openapi-tools`/`-server` long after plan 054 folded those packages,
// and nothing resolved those specifiers either (plan 071 Task 5). Every `@arnilo/*`
// specifier in `scripts/**/*.mjs` is resolved against the live package and its
// `exports` subpaths below.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expandWorkspaceDirs, readManifest } from "./package-truth.mjs";

const ROOT = join(import.meta.dirname, "..");
const WORKFLOWS = join(ROOT, ".github", "workflows");

/** Live workspace names → `{ dir, scripts, exports }`, plus the root manifest's scripts. */
export function workspaceInventory(rootDir = ROOT) {
  const root = readManifest(join(rootDir, "package.json"));
  // The root package is importable under its own name (`@arnilo/prism`) and is a valid
  // `-w` target, even though it is not listed in its own `workspaces` array.
  const packages = new Map([[root.name, { dir: rootDir, scripts: root.scripts ?? {}, exports: root.exports ?? {} }]]);
  for (const dir of expandWorkspaceDirs(rootDir, root.workspaces)) {
    const manifest = readManifest(join(dir, "package.json"));
    packages.set(manifest.name, { dir, scripts: manifest.scripts ?? {}, exports: manifest.exports ?? {} });
  }
  return { packages, rootScripts: root.scripts ?? {} };
}

/** `-w <pkg>`, `-w=<pkg>`, `--workspace <pkg>`, `--workspace=<pkg>`, `--filter <pkg>`,
 *  `-F <pkg>` (quoted or not). `--filter`/`-F` is Bun's workspace selector — Bun has no
 *  `--workspace <name>` form (plan 124 Task 5). */
const WORKSPACE = /(?:^|\s)(?:-w|--workspace|-F|--filter)[=\s]+("[^"]+"|'[^']+'|\S+)/;
/** Script claims only: `npm run <script>`, `bun run <script>` and the `npm test` alias.
 *  Installer/utility commands (`bun ci`, `npm pack --workspaces`, `bun audit`, `npm sbom`)
 *  name no package script and are deliberately not resolved. */
const SCRIPT_RUN = /\b(?:npm|bun)\s+run\s+([\w:.-]+)/;
/** `bun run --filter <pkg> <script>`: the selector consumes the token `SCRIPT_RUN` would need. */
const FILTER_RUN = /\b(?:npm|bun)\s+run\s+(?:-F|--filter)[=\s]+\S+\s+([\w:.-]+)/;
/** Registry toolchain commands allowed to keep npm (plan 125 Task 5's exception list). */
// deprecate is the same class as publish: a registry mutation that needs the publish auth.
const NPM_REGISTRY_OPS = new Set(["pack", "publish", "sbom", "view", "deprecate"]);
/** The one Bun setup action, pinned to a full commit SHA (plan 124 Task 5). */
const SETUP_BUN = "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6";

/**
 * Every unresolvable workspace or script name in one workflow's text, as
 * `line N: …` strings. Command lists are split on `&&`/`||`/`;` first so a `-w`
 * binds to its own `npm` command (`npm run build:core && npm run build -w pkg`).
 */
export function workflowReferenceProblems(text, inventory) {
  const problems = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const segment of line.split(/&&|\|\||;/)) {
      if (!/\b(?:npm|bun)\s/.test(segment)) continue;
      const workspaceMatch = WORKSPACE.exec(segment);
      const script = FILTER_RUN.exec(segment)?.[1] ?? SCRIPT_RUN.exec(segment)?.[1] ?? (/\bnpm\s+test\b/.test(segment) ? "test" : null);
      if (script === null && workspaceMatch === null) continue;
      const target = workspaceMatch?.[1]?.replace(/^["']|["']$/g, "");
      const pkg = target === undefined ? undefined : inventory.packages.get(target);
      if (target !== undefined && pkg === undefined) {
        problems.push(`line ${index + 1}: unknown workspace "${target}"`);
        continue;
      }
      if (script === null) continue;
      const scripts = pkg?.scripts ?? (target === undefined ? inventory.rootScripts : {});
      if (!(script in scripts)) {
        problems.push(`line ${index + 1}: ${target ?? "the root package"} has no "${script}" script`);
      }
    }
  });
  return problems;
}

/**
 * npm/npx uses that are not the registry-toolchain exception, as `line N: …` strings.
 * Bun is the only runner in these workflows (plan 124 Task 5): every step is `bun`/`bun run`/
 * `bunx`, and the only npm left is the release-host registry ops (plan 125 Task 5).
 */
export function nonBunCommandProblems(text) {
  const problems = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const code = line.replace(/#.*$/, "");
    if (/\bnpx\b/.test(code)) problems.push(`line ${index + 1}: npx is not bunx`);
    if (/\bnpm\s+run\b/.test(code)) problems.push(`line ${index + 1}: npm run is not bun run`);
    for (const match of code.matchAll(/\bnpm\s+([\w-]+)/g)) {
      if (!NPM_REGISTRY_OPS.has(match[1])) problems.push(`line ${index + 1}: npm ${match[1]} is not a registry op`);
    }
  });
  return problems;
}

/** `scripts/*.mjs` paths a workflow names that are not on disk (retired/renamed scripts). */
export function missingScriptPaths(text, rootDir = ROOT) {
  const problems = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(/\bscripts\/[\w./-]+\.mjs\b/g)) {
      if (!existsSync(join(rootDir, match[0]))) problems.push(`line ${index + 1}: ${match[0]} does not exist`);
    }
  });
  return problems;
}

/** `uses:` refs that are not a full 40-hex revision (a tag can be re-pointed). */
export function unpinnedActionUses(text) {
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line: index + 1, match: /^\s*(?:-\s*)?uses:\s*(\S+?)(?:\s|$|#)/.exec(line) }))
    .filter(({ match }) => match && !/@[0-9a-f]{40}$/.test(match[1]))
    .map(({ line, match }) => `line ${line}: ${match[1]} is not pinned to a full commit SHA`);
}

/** Static and dynamic `@arnilo/*` specifiers in one file's text. */
const ARNILO_IMPORT = /(?:from\s+|import\()"(@arnilo\/[^"]+)"/g;

/**
 * Every `@arnilo/*` specifier in one script's text that does not resolve, as
 * `line N: …` strings: the package must be a live workspace and, when a subpath is
 * named, an `exports` key of that package.
 */
export function unresolvedScriptImports(text, inventory) {
  const problems = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(ARNILO_IMPORT)) {
      const spec = match[1];
      const groups = /^(@arnilo\/[^/]+)(\/.*)?$/.exec(spec);
      const [pkgName, subpath = ""] = [groups[1], groups[2] ?? ""];
      const pkg = inventory.packages.get(pkgName);
      if (pkg === undefined) {
        problems.push(`line ${index + 1}: ${spec} names a package that is not a live workspace`);
        continue;
      }
      // ponytail: exact `exports` keys only — no workspace declares a wildcard subpath today;
      // add `*`-pattern matching when one does.
      if (subpath !== "" && !(`.${subpath}` in pkg.exports)) {
        problems.push(`line ${index + 1}: ${spec} — ${pkgName} declares no ".${subpath}" export`);
      }
    }
  });
  return problems;
}

function readWorkflows() {
  return readdirSync(WORKFLOWS)
    .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
    .sort()
    .map((file) => ({ file, text: readFileSync(join(WORKFLOWS, file), "utf8") }));
}

function readScripts() {
  return readdirSync(join(ROOT, "scripts"), { recursive: true })
    .filter((entry) => entry.endsWith(".mjs"))
    .sort()
    .map((entry) => ({ file: `scripts/${entry}`, text: readFileSync(join(ROOT, "scripts", entry), "utf8") }));
}

test("every workflow workspace and script reference resolves", () => {
  const inventory = workspaceInventory();
  const workflows = readWorkflows();
  assert.ok(workflows.length >= 8, `expected the workflow set, found ${workflows.length}`);
  // Non-vacuity: the scan must actually be seeing workspace-targeted commands.
  const references = workflows.flatMap(({ text }) => text.match(/(?:-w|--workspace|-F|--filter)[= ]@arnilo\//g) ?? []);
  assert.ok(references.length >= 10, `expected workspace references in the workflows, found ${references.length}`);
  for (const { file, text } of workflows) {
    assert.deepEqual(workflowReferenceProblems(text, inventory), [], `${file} references that do not resolve`);
  }
});

test("every @arnilo/* import in scripts/ resolves to a live package and export", () => {
  const inventory = workspaceInventory();
  const files = readScripts();
  assert.ok(files.length >= 50, `expected the script set, found ${files.length}`);
  const specifiers = files.flatMap(({ text }) => text.match(/@arnilo\/[^"]+/g) ?? []);
  assert.ok(specifiers.length >= 100, `expected @arnilo specifiers to scan, found ${specifiers.length}`);
  for (const { file, text } of files) {
    assert.deepEqual(unresolvedScriptImports(text, inventory), [], `${file} has imports that do not resolve`);
  }
});

test("a retired package or unknown subpath in a script fails (positive control)", () => {
  const inventory = workspaceInventory();
  // Planted specifiers are assembled at runtime so this gate's own source stays clean
  // under its own scan (a literal specifier in an import clause would be reported).
  const retired = "@arnilo/prism-coding-agent";
  const unknownSubpath = "@arnilo/prism-core/runtime/nope";
  assert.match(
    unresolvedScriptImports(`import { createProcessSessions } from "${retired}";`, inventory).join("\n"),
    /@arnilo\/prism-coding-agent names a package that is not a live workspace/,
    "a retired package must be reported",
  );
  assert.match(
    unresolvedScriptImports(`await import("${unknownSubpath}");`, inventory).join("\n"),
    /@arnilo\/prism-core declares no "\.\/runtime\/nope" export/,
    "an unknown subpath must be reported",
  );
  assert.deepEqual(unresolvedScriptImports('import { createAgent } from "@arnilo/prism";', inventory), []);
  // Non-@arnilo scope and prose without an import form are ignored.
  assert.deepEqual(unresolvedScriptImports('import { Client } from "@modelcontextprotocol/client";', inventory), []);
  assert.deepEqual(unresolvedScriptImports(`// see ${retired} for the retired shape`, inventory), []);
});

test("a retired package or missing script in a live workflow fails (positive control)", () => {
  const inventory = workspaceInventory();
  const file = join(WORKFLOWS, "sandbox-browser.yml");
  const text = readFileSync(file, "utf8");
  assert.deepEqual(workflowReferenceProblems(text, inventory), [], "sandbox-browser.yml must be live");
  const retired = text.replace("@arnilo/prism-work", "@arnilo/prism-diagrams");
  assert.match(
    workflowReferenceProblems(retired, inventory).join("\n"),
    /unknown workspace "@arnilo\/prism-diagrams"/,
    "a retired package name must be reported",
  );
  const missingScript = `${text}\n          npm run test:drawio -w @arnilo/prism-work\n`;
  assert.match(
    workflowReferenceProblems(missingScript, inventory).join("\n"),
    /@arnilo\/prism-work has no "test:drawio" script/,
    "a script no package declares must be reported",
  );
});

test("every workflow action is pinned to a full commit SHA", () => {
  // `docs/release-and-install.md` states this for all workflows; sandbox-browser.yml
  // shipped `actions/cache@v4` (a movable tag) until plan 071 Task 4. An unpinned or
  // retired action reference is the same silent-drift class as a retired package.
  const workflows = readWorkflows();
  for (const { file, text } of workflows) {
    assert.deepEqual(unpinnedActionUses(text), [], `${file} has an unpinned action`);
  }
  const pinned = workflows.flatMap(({ text }) => text.match(/^\s*(?:-\s*)?uses:/gm) ?? []);
  assert.ok(pinned.length >= 8, `expected action references to scan, found ${pinned.length}`);
  assert.match(
    unpinnedActionUses("      - uses: actions/cache@v4").join("\n"),
    /actions\/cache@v4 is not pinned/,
    "positive control: a tag-pinned action must be reported",
  );
});

test("workflows install Bun and declare no Node leg", () => {
  const workflows = readWorkflows();
  // Plan 125 Task 1 retired the two declared Node legs (release.yml's Node 24 smoke and the
  // `node22-compat` job) with the engines flip: `engines.bun >=1.4.2` is the only declared runtime,
  // so no workflow sets up Node. The 0.1.x Node matrix stays as the immutable era record in
  // scripts/phase12-freeze-manifest.json support.node, which no workflow measures any more.
  const setupNode = workflows.filter(({ text }) => text.includes("actions/setup-node"));
  assert.deepEqual(
    setupNode.map(({ file }) => file),
    [],
    "no workflow may declare a Node leg after the engines flip (plan 125 Task 1)",
  );
  // Registry-only workflows run no repo code (npm deprecate touches the registry and nothing else),
  // so they carry the Bun setup for the runner contract but skip the dependency install.
  const registryOnly = new Set(["npm-deprecate.yml"]);
  for (const { file, text } of workflows) {
    assert.ok(text.includes(SETUP_BUN), `${file} must set up Bun from the pinned action SHA`);
    assert.ok(text.includes('bun-version: "1.4.2"'), `${file} must pin bun-version 1.4.2`);
    if (!registryOnly.has(file)) assert.ok(text.includes("bun ci"), `${file} must install with bun ci`);
  }
});

test("no workflow step calls npm run or npx, and npm keeps only the registry ops", () => {
  const problems = readWorkflows().flatMap(({ file, text }) => nonBunCommandProblems(text).map((p) => `${file} ${p}`));
  assert.deepEqual(problems, [], "workflows must run bun/bun run/bunx; npm is the registry toolchain only");
  // Non-vacuity: the scan sees the sanctioned Bun forms it is guarding.
  const bunCommands = readWorkflows().flatMap(({ text }) => text.match(/\bbun (?:ci|run|test|x) /g) ?? []);
  assert.ok(bunCommands.length >= 20, `expected bun commands to scan, found ${bunCommands.length}`);
  // No workflow step executes node: the declared Node legs and their public-import smoke retired
  // with the engines flip (plan 125 Task 1).
  const nodeSteps = readWorkflows().flatMap(({ file, text }) =>
    text
      .split(/\r?\n/)
      .map((line, index) => [index + 1, line.replace(/#.*$/, "")])
      .filter(([, code]) => /\bnode\s+\S/.test(code))
      .map(([line, code]) => `${file}:${line} ${code.trim()}`),
  );
  assert.deepEqual(nodeSteps, [], "no workflow step may execute node (plan 125 Task 1)");
  assert.match(
    nonBunCommandProblems("      - run: npm run test\n          npx --no-install playwright-core install chromium").join("\n"),
    /npm run is not bun run[\s\S]*npx is not bunx/,
    "positive control: npm run and npx must be reported",
  );
  // Registry ops stay, in every workflow that needs them.
  assert.deepEqual(nonBunCommandProblems("          npm pack --json\n          npm sbom --sbom-format spdx\n          npm publish"), []);
  assert.deepEqual(nonBunCommandProblems("          npm ci"), ["line 1: npm ci is not a registry op"]);
});

test("every scripts/*.mjs a workflow names exists", () => {
  const problems = readWorkflows().flatMap(({ file, text }) => missingScriptPaths(text).map((p) => `${file} ${p}`));
  assert.deepEqual(problems, [], "workflows must not name a retired or renamed script");
  assert.match(missingScriptPaths("          bun scripts/not-a-real-script.mjs").join("\n"), /does not exist/);
  assert.deepEqual(missingScriptPaths("          bun scripts/with-build-lock.mjs"), []);
});

test("non-script npm commands and root scripts are handled without false positives", () => {
  const inventory = workspaceInventory();
  const installers = [
    "      - run: bun ci",
    "          npm pack --workspaces --json --pack-destination release-artifacts > out.json",
    "      - run: bun audit --audit-level=moderate",
    "          npm sbom --sbom-format spdx > sbom.spdx.json",
    "      - run: bun test --timeout=0 scripts/benchmark.test.mjs",
  ].join("\n");
  assert.deepEqual(workflowReferenceProblems(installers, inventory), []);
  // Root scripts resolve against the root manifest, and a bogus one is reported.
  assert.deepEqual(workflowReferenceProblems("      - run: npm run build:core && npm run build -w @arnilo/prism-core", inventory), []);
  assert.match(
    workflowReferenceProblems("      - run: npm run build:core:typo", inventory).join("\n"),
    /the root package has no "build:core:typo" script/,
  );
});
