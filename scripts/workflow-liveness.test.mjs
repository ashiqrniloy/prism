#!/usr/bin/env node
import { test } from "bun:test";
// workflow-liveness gate — plan 071 Task 4 (plan 070 FA 3).
//
// `.github/workflows/*.yml` name workspaces and npm scripts, and nothing used to
// resolve those names. `sandbox-browser.yml` kept building `@arnilo/prism-hosts/evals`,
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
import { effectiveTestChain } from "./run-all-tests.mjs";

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
 * npm/npx uses in a workflow, as `line N: …` strings. Bun is the only runner (plan 124 Task 5):
 * every step is `bun`/`bun run`/`bunx`. Plan 175 Task 8 took the last npm call site (the deprecation
 * job) to the registry HTTP API, so no workflow may run npm at all.
 */
// Plan 215 Task 38: publishing is npm's (OIDC trusted publishing has no Bun equivalent), so the one
// sanctioned form is the version pin, `npm install -g npm@<exact>`. Every other npm form still fails.
const NPM_VERSION_PIN = /^\s*(?:-\s*)?(?:run:\s*)?npm install -g npm@\d+\.\d+\.\d+\s*$/;

export function nonBunCommandProblems(text) {
  const problems = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const code = line.replace(/#.*$/, "");
    if (NPM_VERSION_PIN.test(code)) return;
    if (/\bnpx\b/.test(code)) problems.push(`line ${index + 1}: npx is not bunx`);
    if (/\bnpm\s+run\b/.test(code)) problems.push(`line ${index + 1}: npm run is not bun run`);
    for (const match of code.matchAll(/\bnpm\s+([\w-]+)/g)) {
      if (match[1] === "run") continue;
      problems.push(`line ${index + 1}: npm ${match[1]} is not a Bun command`);
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
  return (
    text
      .split(/\r?\n/)
      .map((line, index) => ({ line: index + 1, match: /^\s*(?:-\s*)?uses:\s*(\S+?)(?:\s|$|#)/.exec(line) }))
      // A local reusable workflow (`./.github/workflows/x.yml`) is this repo's own tree, not
      // an external ref, so there is no revision to pin (plan 215 Task 36).
      .filter(({ match }) => match && !match[1].startsWith("./") && !/@[0-9a-f]{40}$/.test(match[1]))
      .map(({ line, match }) => `line ${line}: ${match[1]} is not pinned to a full commit SHA`)
  );
}

/** Static and dynamic `@arnilo/*` specifiers in one file's text. */
const ARNILO_IMPORT = /(?:from\s+|import\()"(@arnilo\/[^"]+)"(?!\s*\+)/g;

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

test("ci_workflow_filters_name_workspaces: every workspace and script reference resolves", () => {
  const inventory = workspaceInventory();
  const workflows = readWorkflows();
  assert.ok(workflows.length >= 8, `expected the workflow set, found ${workflows.length}`);
  // Non-vacuity: the scan must actually be seeing workspace-targeted commands.
  const references = workflows.flatMap(({ text }) => text.match(/(?:-w|--workspace|-F|--filter)[= ]@arnilo\//g) ?? []);
  assert.ok(references.length > 0, `expected workspace references in the workflows, found ${references.length}`);
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
  const unknownSubpath = "@arnilo/prism-extensions/workflows/nope";
  assert.match(
    unresolvedScriptImports(`import { createProcessSessions } from "${retired}";`, inventory).join("\n"),
    /@arnilo\/prism-coding-agent names a package that is not a live workspace/,
    "a retired package must be reported",
  );
  assert.match(
    unresolvedScriptImports(`await import("${unknownSubpath}");`, inventory).join("\n"),
    /@arnilo\/prism-extensions declares no "\.\/workflows\/nope" export/,
    "an unknown subpath must be reported",
  );
  assert.deepEqual(unresolvedScriptImports('import { createAgent } from "@arnilo/prism";', inventory), []);
  assert.deepEqual(unresolvedScriptImports('await import("@arnilo/prism-extensions/" + subpath);', inventory), []);
  // Non-@arnilo scope and prose without an import form are ignored.
  assert.deepEqual(unresolvedScriptImports('import { Client } from "@modelcontextprotocol/client";', inventory), []);
  assert.deepEqual(unresolvedScriptImports(`// see ${retired} for the retired shape`, inventory), []);
});

test("a retired package or missing script in a live workflow fails (positive control)", () => {
  const inventory = workspaceInventory();
  const file = join(WORKFLOWS, "sandbox-browser.yml");
  const text = readFileSync(file, "utf8");
  assert.deepEqual(workflowReferenceProblems(text, inventory), [], "sandbox-browser.yml must be live");
  const retired = `${text}\n bun run --filter @arnilo/prism-diagrams test`;
  assert.match(
    workflowReferenceProblems(retired, inventory).join("\n"),
    /unknown workspace "@arnilo\/prism-diagrams"/,
    "a retired package name must be reported",
  );
  const missingScript = `${text}\n          npm run test:drawio -w @arnilo/prism-tools\n`;
  assert.match(
    workflowReferenceProblems(missingScript, inventory).join("\n"),
    /@arnilo\/prism-tools has no "test:drawio" script/,
    "a script no package declares must be reported",
  );
});

test("ci_actions_pinned_by_sha: every action carries a 40-hex SHA and a version comment", () => {
  // `docs/release-and-install.md` states this for all workflows; sandbox-browser.yml
  // shipped `actions/cache@v4` (a movable tag) until plan 071 Task 4. An unpinned or
  // retired action reference is the same silent-drift class as a retired package.
  const workflows = readWorkflows();
  for (const { file, text } of workflows) {
    assert.deepEqual(unpinnedActionUses(text), [], `${file} has an unpinned action`);
  }
  const pinned = workflows.flatMap(({ text }) => text.match(/^\s*(?:-\s*)?uses:/gm) ?? []);
  assert.ok(pinned.length >= 8, `expected action references to scan, found ${pinned.length}`);
  // A bare SHA is not reviewable: the comment is what a dependabot bump or a reader compares.
  // A local reusable workflow (`./.github/workflows/x.yml`) is not an external ref and needs none.
  const uncommented = workflows.flatMap(({ file, text }) =>
    text
      .split(/\r?\n/)
      .map((line, index) => [index + 1, line.trimEnd()])
      .filter(([, line]) => /^-?\s*uses:\s*\S+$/.test(line) && !/^\s*(?:-\s*)?uses:\s*\.\//.test(line))
      .map(([line]) => `${file}:${line}`),
  );
  assert.deepEqual(uncommented, [], "every uses: needs a `# vX.Y.Z` comment beside its SHA");
  assert.match(
    unpinnedActionUses("      - uses: actions/cache@v4").join("\n"),
    /actions\/cache@v4 is not pinned/,
    "positive control: a tag-pinned action must be reported",
  );
});

test("workflows install Bun and declare no Node leg", () => {
  const workflows = readWorkflows();
  // Plan 125 Task 1 retired the two declared Node legs (release.yml's Node 24 smoke and the
  // `node22-compat` job) with the engines flip: `engines.bun >=1.4.2` is the only declared runtime.
  // Plan 215 Task 38 brings back exactly one: the publish job's setup-node, because OIDC trusted
  // publishing is npm's. Anything else would be a second runtime the repo does not test.
  const publish = jobBody(readFileSync(join(WORKFLOWS, "release.yml"), "utf8"), "publish") ?? "";
  const setupNode = workflows.filter(({ text }) => text.includes("actions/setup-node"));
  assert.deepEqual(
    setupNode.map(({ file }) => file),
    ["release.yml"],
    "only release.yml may set up Node, for the npm publish step",
  );
  assert.match(publish, /actions\/setup-node@/, "the Node leg lives inside the publish job");
  for (const { text } of setupNode) {
    const outsidePublish = text.replace(publish, "");
    assert.doesNotMatch(outsidePublish, /actions\/setup-node@/, "no other job sets up Node");
  }
  for (const { file, text } of workflows) {
    assert.ok(text.includes(SETUP_BUN), `${file} must set up Bun from the pinned action SHA`);
    assert.ok(text.includes('bun-version: "1.4.2"'), `${file} must pin bun-version 1.4.2`);
    assert.ok(text.includes("bun ci"), `${file} must install with bun ci`);
  }
});

test("no workflow step calls npm", () => {
  const problems = readWorkflows().flatMap(({ file, text }) => nonBunCommandProblems(text).map((p) => `${file} ${p}`));
  assert.deepEqual(problems, [], "workflows must run bun/bun run/bunx; no workflow may run npm (plan 175 Task 8)");
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
  // npm is retired from workflows: every npm form is reported, the registry ops included.
  assert.deepEqual(nonBunCommandProblems("          npm pack --json\n          npm sbom --sbom-format spdx\n          npm publish"), [
    "line 1: npm pack is not a Bun command",
    "line 2: npm sbom is not a Bun command",
    "line 3: npm publish is not a Bun command",
  ]);
  assert.deepEqual(nonBunCommandProblems("          npm ci"), ["line 1: npm ci is not a Bun command"]);
});

test("ci_workflows_reference_existing_files: every script a workflow names exists", () => {
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
  // Plan 175 Task 8: no package carries a `build` script any more (the migration publishes TS
  // source), so the fixture uses a live one.
  assert.deepEqual(
    workflowReferenceProblems("      - run: npm run build:core && npm run typecheck -w @arnilo/prism-extensions", inventory),
    [],
  );
  assert.match(
    workflowReferenceProblems("      - run: npm run build:core:typo", inventory).join("\n"),
    /the root package has no "build:core:typo" script/,
  );
});

// ---------------------------------------------------------------------------
// Plan 215 Task 36: the CI-integrity checks. They live in this file rather than a
// separate `scripts/ci-integrity.test.mjs`, because two of the six checks the plan
// named (`ci_workflows_reference_existing_files`, `ci_actions_pinned_by_sha`) already
// run here and a second file would need the same helpers and register these tests twice.
// ---------------------------------------------------------------------------

/** One workflow job's body text, by job id (`^  <id>:` under `jobs:`). Empty when absent. */
export function jobBody(text, id) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^  ${id}:\\s*$`).test(line));
  if (start === -1) return "";
  const end = lines.findIndex((line, index) => index > start && /^ {2}[\w-]+:\s*$|^\S/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

/** Top-level `permissions:` values of one workflow (`key: value` pairs, indented under it). */
export function topLevelPermissions(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf("permissions:");
  if (start === -1) return null;
  const values = {};
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const match = /^ {2}([\w-]+):\s*(\S+)\s*$/.exec(line);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

/**
 * Jobs that declare no `permissions:` while the workflow's top-level block grants more
 * than read — the "least privilege per job, `contents: read` by default" rule. A read-only
 * top-level block is inherited safely, so those jobs need no block of their own.
 */
export function permissionProblems(text) {
  const top = topLevelPermissions(text);
  const readOnlyTop = top !== null && Object.values(top).every((value) => value === "read" || value === "none");
  const problems = [];
  if (top === null) problems.push("the workflow declares no top-level permissions block");
  const jobsAt = text.split(/\r?\n/).indexOf("jobs:");
  const lines = text.split(/\r?\n/);
  const ids = lines
    .map((line, index) => ({ index, id: /^ {2}([\w-]+):\s*$/.exec(line)?.[1] }))
    .filter(({ index, id }) => id !== undefined && index > jobsAt && jobsAt !== -1);
  for (const { id } of ids) {
    const body = jobBody(text, id);
    if (/^ {4}permissions:/m.test(body)) continue;
    if (readOnlyTop) continue;
    problems.push(`${id}: declares no permissions and the top-level block is not read-only`);
  }
  return problems;
}

/** `actions/checkout` steps that do not set `persist-credentials: false`. */
export function checkoutCredentialProblems(text) {
  const lines = text.split(/\r?\n/);
  const problems = [];
  lines.forEach((line, index) => {
    const match = /^(\s*)-\s*uses:\s*actions\/checkout@/.exec(line);
    if (!match) return;
    const indent = match[1].length;
    const step = [line];
    for (const next of lines.slice(index + 1)) {
      const nextIndent = next.match(/^\s*/)[0].length;
      if (next.trim() !== "" && nextIndent <= indent) break;
      step.push(next);
    }
    if (!step.join("\n").includes("persist-credentials: false")) {
      problems.push(`line ${index + 1}: actions/checkout leaves credentials in .git/config`);
    }
  });
  return problems;
}

/**
 * Release conditions that compare the ref against a version literal, or a tag list that
 * names versions. Both stopped at `v0.12.1` while v0.13.0 was cut, so `v0.13.0` skipped
 * `codeql-release` and `publish` (plan 215 Task 1 (b)). One pattern, never a list.
 */
export function releaseTagLiteralProblems(text) {
  const problems = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const code = line.replace(/#.*$/, "");
    if (/refs\/tags\/v\d/.test(code)) problems.push(`line ${index + 1}: a condition names one tag: ${code.trim()}`);
    if (/\bv\d+\.\d+\.\d+\b/.test(code)) problems.push(`line ${index + 1}: a version literal in a release condition: ${code.trim()}`);
  });
  return problems;
}

/**
 * Evaluate a publish/security guard, which may only be `startsWith(github.ref, '<prefix>')`
 * clauses joined by `||`. Anything else throws: the pattern form is the contract, so an
 * enumerated version list can never come back unnoticed.
 */
export function evaluateRefCondition(expression, ref) {
  for (const clause of expression.split("||")) {
    const match = /^startsWith\(\s*github\.ref\s*,\s*'([^']+)'\s*\)$/.exec(clause.trim());
    if (!match) throw new Error(`unsupported release condition: ${clause.trim()}`);
    if (ref.startsWith(match[1])) return true;
  }
  return false;
}

test("ci_jobs_declare_permissions: every job declares permissions or inherits a read-only block", () => {
  const problems = readWorkflows().flatMap(({ file, text }) => permissionProblems(text).map((p) => `${file}: ${p}`));
  assert.deepEqual(problems, [], "every job needs least privilege (plan 215 Task 36, Security)");
  // Non-vacuity: the scan sees the job set, and a write-granting top-level block fails a job
  // that declares nothing.
  const jobs = readWorkflows().flatMap(({ text }) => text.match(/^ {2}[\w-]+:\s*$/gm) ?? []);
  assert.ok(jobs.length >= 15, `expected jobs to scan, found ${jobs.length}`);
  assert.match(
    permissionProblems("permissions:\n  contents: write\n\njobs:\n  x:\n    runs-on: ubuntu-latest\n").join("\n"),
    /x: declares no permissions/,
  );
  assert.deepEqual(permissionProblems("permissions:\n  contents: read\n\njobs:\n  x:\n    runs-on: ubuntu-latest\n"), []);
  assert.deepEqual(
    permissionProblems(
      "permissions:\n  contents: read\n\njobs:\n  x:\n    runs-on: ubuntu-latest\n  y:\n    permissions:\n      contents: read\n    runs-on: ubuntu-latest\n",
    ),
    [],
  );
});

test("ci_checkout_does_not_persist_credentials", () => {
  const problems = readWorkflows().flatMap(({ file, text }) => checkoutCredentialProblems(text).map((p) => `${file} ${p}`));
  assert.deepEqual(problems, [], "a checkout must not leave the token in .git/config");
  const checkouts = readWorkflows().flatMap(({ text }) => text.match(/actions\/checkout@/g) ?? []);
  assert.ok(checkouts.length >= 8, `expected checkout steps to scan, found ${checkouts.length}`);
  assert.match(
    checkoutCredentialProblems(
      "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          fetch-depth: 0\n",
    ).join("\n"),
    /leaves credentials in \.git\/config/,
  );
});

test("release_publish_path_for_v0_13_0: every tag publishes, and no condition names a version", () => {
  const text = readFileSync(join(WORKFLOWS, "release.yml"), "utf8");
  assert.deepEqual(releaseTagLiteralProblems(text), [], "release.yml must gate on a pattern, not a version list");
  // The trigger has to admit the ref before any job can select it.
  assert.match(text, /tags: \["v\*", "@arnilo\/\*@\*"\]/, "the tag trigger must be the two patterns");
  for (const ref of ["refs/tags/v0.13.0", "refs/tags/v0.14.2", "refs/tags/@arnilo/prism-knowledge/wiki@0.13.0-experimental.1"]) {
    for (const id of ["publish", "security-release"]) {
      const guard = /^ {4}if: (.+)$/m.exec(jobBody(text, id));
      assert.ok(guard, `${id} must keep a tag guard`);
      assert.equal(evaluateRefCondition(guard[1], ref), true, `${id} must run for ${ref}`);
    }
  }
  for (const ref of ["refs/heads/main", "refs/pull/7/merge"]) {
    for (const id of ["publish", "security-release"]) {
      const guard = /^ {4}if: (.+)$/m.exec(jobBody(text, id));
      assert.equal(evaluateRefCondition(guard[1], ref), false, `${id} must not run for ${ref}`);
    }
  }
  // The publish step's shell takes the lockstep branch for `v*` and the independent branch
  // otherwise — the same rule, in one place.
  const step = jobBody(text, "publish").split("publish in dependency order")[1];
  assert.match(step, /GITHUB_REF_NAME#v/, "the publish step must branch on the v prefix");
  assert.doesNotMatch(step, /v0\.\d/, "the publish step must not enumerate versions");
  // Fail closed: an enumerated condition is rejected, not silently mis-evaluated.
  assert.throws(() => evaluateRefCondition("github.ref == 'refs/tags/v0.12.1'", "refs/tags/v0.12.1"), /unsupported release condition/);
});

test("release_gate_runs_plan_gates: the gates this plan adds stay in bun run test or release:gate", () => {
  const chain = effectiveTestChain();
  const root = readManifest(join(ROOT, "package.json"));
  const releaseGate = root.scripts["release:gate"];
  // The root-suites stage runs `bun test <…> src`, so every `src/__tests__` file is in it.
  assert.ok(chain.includes("bun test") && chain.includes(" src"), "the root-suites stage must run src");
  const gates = [
    ["stable_packages_never_depend_on_experimental", "src/__tests__/experimental-boundary.test.ts"],
    ["experimental_packages_carry_notice", "src/__tests__/docs.test.ts"],
    ["prefix stability conformance", "src/__tests__/prefix-stability-conformance.test.ts"],
    ["host_builder_kit_matches_surface", "src/__tests__/host-builder-kit.test.ts"],
    ["package_skills_conform", "scripts/package-skills-conformance.mjs"],
    ["no_retired_name_in_live_tree", "scripts/retired-names.test.mjs"],
  ];
  for (const [gate, file] of gates) {
    assert.ok(existsSync(join(ROOT, file)), `${gate} must keep its home at ${file}`);
    const reached = file.startsWith("src/__tests__/") || chain.includes(file) || releaseGate.includes(file);
    assert.ok(reached, `${gate} (${file}) must run in bun run test or release:gate`);
  }
  // A file in neither place fails: the check is not vacuous.
  assert.ok(!(chain.includes("scripts/not-a-gate.test.mjs") || releaseGate.includes("scripts/not-a-gate.test.mjs")));
});

test("canary_provider_matrix_names_shipped_providers", () => {
  const text = readFileSync(join(WORKFLOWS, "canary-providers.yml"), "utf8");
  const fallback = /fromJSON\(vars\.PRISM_CANARY_PROVIDERS \|\| '(\[[^']*\])'\)/.exec(text);
  assert.ok(fallback, "the matrix must keep a JSON array fallback");
  const providers = JSON.parse(fallback[1]);
  assert.ok(providers.length > 0, "the fallback must name at least one provider");
  for (const provider of providers) {
    assert.ok(
      existsSync(join(ROOT, "packages", "providers", provider, "src", "__tests__", "live.test.ts")),
      `canary fallback names ${provider}, which has no live suite (retired provider?)`,
    );
  }
});

test("workflows_reference_no_npm_token: no workflow carries an npm credential", () => {
  const problems = readWorkflows().flatMap(({ file, text }) => {
    const lines = text.split(/\r?\n/);
    return lines.flatMap((line, index) => {
      const code = line.replace(/#.*$/, "");
      if (!/NPM_TOKEN|NODE_AUTH_TOKEN|_authToken|npm_token/.test(code)) return [];
      return [`${file}:${index + 1} ${code.trim()}`];
    });
  });
  assert.deepEqual(problems, [], "trusted publishing means no workflow reads an npm token (plan 215 Task 38)");
  // Non-vacuity: the scan reports the shapes it is guarding, including an `.npmrc` auth line.
  const shapes = ["env:\n  NODE_AUTH_TOKEN: secrets.NPM_TOKEN", "printf '//registry.npmjs.org/:_authToken=%s\\n' \"$TOKEN\""];
  assert.deepEqual(
    shapes.filter((shape) => !/NPM_TOKEN|NODE_AUTH_TOKEN|_authToken/.test(shape)),
    [],
    "positive control: a token env line and an .npmrc auth line are both detected",
  );
});

test("publish_job_requires_environment_and_id_token", () => {
  const workflow = readFileSync(join(WORKFLOWS, "release.yml"), "utf8");
  const publish = jobBody(workflow, "publish");
  assert.ok(publish, "release.yml must keep a publish job");
  assert.match(publish, /environment:\s*npm-publish/, "the publish job runs in the protected environment");
  assert.match(publish, /id-token:\s*write/, "OIDC needs the id-token scope");
  assert.match(publish, /attestations:\s*write/, "the build attestation stays");
  assert.match(publish, /if:\s*startsWith\(github\.ref, 'refs\/tags\/'\)/, "only a tag publishes");
  assert.doesNotMatch(publish, /NODE_AUTH_TOKEN|secrets\.NPM_TOKEN|_authToken/, "no token reaches the publish job");
  assert.doesNotMatch(publish, /printf .*npmrc/, "the .npmrc auth step is gone");
});

test("publish_job_meets_trusted_publishing_minimums", () => {
  const workflow = readFileSync(join(WORKFLOWS, "release.yml"), "utf8");
  const publish = jobBody(workflow, "publish");
  const nodeVersion = /node-version:\s*"?(\d+)\.(\d+)\.(\d+)"?/.exec(publish);
  assert.ok(nodeVersion, "the publish job pins a Node version");
  const [major, minor] = [Number(nodeVersion[1]), Number(nodeVersion[2])];
  assert.ok(major > 22 || (major === 22 && minor >= 14), `Node ${nodeVersion[0]} is below the 22.14.0 floor`);
  assert.match(publish, /actions\/setup-node@[0-9a-f]{40} # v\d+\.\d+\.\d+/, "setup-node is pinned by SHA with its version");
  // npm comes from the Node release (24.x bundles npm >= 11.6), so no global install is needed and
  // no npm command line sits in the workflow. The floor is stated where the pipeline is documented.
  assert.doesNotMatch(publish, /npm install|npm i\b/, "the publish job installs no npm of its own");
  assert.match(
    readFileSync(join(ROOT, "docs", "release.md"), "utf8"),
    /npm 11\.5\.1|11\.5\.1/,
    "docs/release.md must state the npm floor trusted publishing needs",
  );
});

test("ci_verify_runs_sdk_ready_steps: pull-request CI runs every sdk:ready step", () => {
  // `sdk:ready` is the release profile (docs/release.md). PR CI must not drift from it: a
  // missing step is a gate that only fails at the tag. The one documented extra is the
  // threat-suite set, which release:gate does not run.
  const VERIFY_ONLY = new Set(["security:threat-suites"]);
  const root = readManifest(join(ROOT, "package.json"));
  const sdkReady = root.scripts["sdk:ready"].split("&&").map((step) => /\bbun run ([\w:.-]+)/.exec(step)?.[1]);
  assert.ok(sdkReady.length >= 5, `expected the sdk:ready steps, found ${sdkReady.length}`);
  const verify = jobBody(readFileSync(join(WORKFLOWS, "release.yml"), "utf8"), "verify");
  // A phase line may carry leading `ENV=value` assignments (release:gate's profile markers).
  const phases = [...verify.matchAll(/^\s+(?:[\w-]+=\S*\s+)*phase .+ bun run ([\w:.-]+)$/gm)].map((match) => match[1]);
  assert.ok(phases.length >= 5, `expected the verify phases, found ${phases.length}`);
  for (const step of sdkReady) {
    assert.ok(phases.includes(step), `the verify job must run sdk:ready's "${step}"`);
  }
  for (const phase of phases) {
    assert.ok(
      sdkReady.includes(phase) || VERIFY_ONLY.has(phase),
      `"${phase}" runs in CI but not in sdk:ready — record it in docs/release.md`,
    );
  }
});
