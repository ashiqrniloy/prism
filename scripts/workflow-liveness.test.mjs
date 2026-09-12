#!/usr/bin/env node
// workflow-liveness gate — plan 071 Task 4 (plan 070 FA 3).
//
// `.github/workflows/*.yml` name workspaces and npm scripts, and nothing used to
// resolve those names. `sandbox-browser.yml` kept building `@arnilo/prism-evals`,
// `-workflows`, `-coding-agent` and `-diagrams` long after those packages were
// retired, and its draw.io leg called a `test:drawio` script that no package has:
// the drift only showed up in a scheduled CI run. This gate resolves every
// `-w <pkg>` / `--workspace[= ]<pkg>` target against the live workspace inventory
// and every named npm script against that package's manifest (the root manifest for
// a bare `npm run x`), so the next rename or retirement fails `npm test` instead.
//
// The same drift class lives in `scripts/**`: the phase-26 journey packed
// `packages/coding-agent`/`-security` and `phase11-auth` imported
// `@arnilo/prism-openapi-tools`/`-server` long after plan 054 folded those packages,
// and nothing resolved those specifiers either (plan 071 Task 5). Every `@arnilo/*`
// specifier in `scripts/**/*.mjs` is resolved against the live package and its
// `exports` subpaths below.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
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

/** `-w <pkg>`, `-w=<pkg>`, `--workspace <pkg>`, `--workspace=<pkg>` (quoted or not). */
const WORKSPACE = /(?:^|\s)(?:-w|--workspace)[=\s]+("[^"]+"|'[^']+'|\S+)/;
/** Script claims only: `npm run <script>` and the `npm test` alias. Installer/utility
 *  commands (`npm ci`, `npm pack --workspaces`, `npm audit`, `npm sbom`) name no
 *  package script and are deliberately not resolved. */
const NPM_RUN = /\bnpm\s+run\s+([\w:.-]+)/;

/**
 * Every unresolvable workspace or script name in one workflow's text, as
 * `line N: …` strings. Command lists are split on `&&`/`||`/`;` first so a `-w`
 * binds to its own `npm` command (`npm run build:core && npm run build -w pkg`).
 */
export function workflowReferenceProblems(text, inventory) {
  const problems = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const segment of line.split(/&&|\|\||;/)) {
      if (!segment.includes("npm ")) continue;
      const workspaceMatch = WORKSPACE.exec(segment);
      const script = NPM_RUN.exec(segment)?.[1] ?? (/\bnpm\s+test\b/.test(segment) ? "test" : null);
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
  const references = workflows.flatMap(({ text }) => text.match(/-w @arnilo\/|--workspace[= ]@arnilo\//g) ?? []);
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
  const retired = text.replace("@arnilo/prism-office", "@arnilo/prism-diagrams");
  assert.match(
    workflowReferenceProblems(retired, inventory).join("\n"),
    /unknown workspace "@arnilo\/prism-diagrams"/,
    "a retired package name must be reported",
  );
  const missingScript = `${text}\n          npm run test:drawio -w @arnilo/prism-office\n`;
  assert.match(
    workflowReferenceProblems(missingScript, inventory).join("\n"),
    /@arnilo\/prism-office has no "test:drawio" script/,
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

test("non-script npm commands and root scripts are handled without false positives", () => {
  const inventory = workspaceInventory();
  const installers = [
    "      - run: npm ci",
    "          npm pack --workspaces --json --pack-destination release-artifacts > out.json",
    "      - run: npm audit --audit-level=moderate",
    "          npm sbom --sbom-format spdx > sbom.spdx.json",
    "      - run: node scripts/benchmark.test.mjs",
  ].join("\n");
  assert.deepEqual(workflowReferenceProblems(installers, inventory), []);
  // Root scripts resolve against the root manifest, and a bogus one is reported.
  assert.deepEqual(workflowReferenceProblems("      - run: npm run build:core && npm run build -w @arnilo/prism-core", inventory), []);
  assert.match(
    workflowReferenceProblems("      - run: npm run build:core:typo", inventory).join("\n"),
    /the root package has no "build:core:typo" script/,
  );
});
