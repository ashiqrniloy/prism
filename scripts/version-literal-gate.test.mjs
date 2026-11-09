#!/usr/bin/env node
import { test } from "bun:test";
// Plan 071 Task 1 (plan 070 FA 10): one source for the release version, and one
// pre-flight that names every surface a half-finished cut left behind.
//
// `currentVersion()` (scripts/package-truth.mjs) reads the root manifest, which
// `release.mjs bump` rewrites first. This gate then asserts that every surface
// which CLAIMS the release version equals it: all 14 manifests, all internal
// `@arnilo/*` caret ranges, the lockfile, the `src/index.ts` version constant,
// the `docs/index.md` current-line banner, the release-workflow tag list, and the
// generated package-truth artifact.
//
// Why an equality gate rather than a stale-literal sweep (Task 1 deviation, plan
// 071): a sweep over every `0.x.y` literal cannot tell a claim from frozen history
// — the repo keeps thousands of legitimate ones in changelog assertions, migration
// prose, audit gates, release-graph fixtures, and protocol version constants. An
// equality gate has no such false positives and still catches every real miss,
// because a claim surface left at the old version is exactly what it checks. It
// also replaces the planned separate lockstep helper: manifests + ranges + lockfile
// + index constant is the lockstep check.
//
//   node --test scripts/version-literal-gate.test.mjs
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseBunLock } from "./bun-lock.mjs";
import { currentVersion, expandWorkspaceDirs, readManifest } from "./package-truth.mjs";

const ROOT = join(import.meta.dirname, "..");
const INTERNAL_PACKAGE = "@arnilo/";
const MANIFEST = /^(?:package\.json|packages\/(?:[^/]+\/)*[^/]+\/package\.json)$/;
/**
 * Packages on their own version line, read from `scripts/independent-packages.json` (the one source,
 * shared with release.mjs and src/__tests__/packaging.test.ts): its `packages` plus its `experimental`
 * list (plan 215 Task 2). Independent packages do not claim the lockstep version, so the gate holds
 * them to self-consistency instead: the lockfile, package-truth, and every internal range that targets
 * them must equal their own manifest version. An experimental package must carry an
 * `x.y.z-experimental.N` version and is pinned exactly, because a caret never matches a prerelease;
 * no other package may carry a prerelease identifier.
 */
function loadIndependentLines(root) {
  const data = JSON.parse(readFileSync(join(root, "scripts", "independent-packages.json"), "utf8"));
  const experimental = new Set(data.experimental ?? []);
  return { independent: new Set([...(data.packages ?? []), ...experimental]), experimental };
}
const { independent: INDEPENDENT_LINES, experimental: EXPERIMENTAL_LINES } = loadIndependentLines(ROOT);
const EXPERIMENTAL_VERSION = /^\d+\.\d+\.\d+-experimental\.\d+$/;

/** Every file this gate reads, keyed by repo-relative path. */
function claimFiles(rootDir) {
  const files = new Map();
  const put = (path) => {
    if (existsSync(join(rootDir, path))) files.set(path, readFileSync(join(rootDir, path), "utf8"));
  };
  put("package.json");
  for (const dir of expandWorkspaceDirs(rootDir, readManifest(join(rootDir, "package.json")).workspaces ?? [])) {
    put(`${dir.slice(rootDir.length + 1).replaceAll("\\", "/")}/package.json`);
  }
  for (const path of ["bun.lock", "src/index.ts", "docs/index.md", ".github/workflows/release.yml", "scripts/package-truth.json"]) {
    put(path);
  }
  return files;
}

/** Non-test TypeScript sources under a workspace's `src/`. */
function packageSources(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__" && entry.name !== "node_modules") walk(path);
      } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") && !entry.name.endsWith(".test.ts")) {
        found.push(path);
      }
    }
  };
  const src = join(dir, "src");
  if (existsSync(src)) walk(src);
  return found;
}

/** Index just past a quoted string starting at `i` (source[i] is the opening quote). */
function skipString(source, i) {
  const quote = source[i];
  i += 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}

/** Index just past the `}` matching the `{` at `open`, skipping strings and comments, or -1. */
function matchBrace(source, open) {
  let depth = 0;
  let i = open;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(source, i);
      continue;
    }
    if (ch === "/" && (source[i + 1] === "/" || source[i + 1] === "*")) {
      const end = source[i + 1] === "/" ? source.indexOf("\n", i) : source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + (source[i + 1] === "/" ? 1 : 2);
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return -1;
}

const DEFINITION_CALL = /define(?:Provider)?Package\s*(?:<[^>]*>)?\s*\(/g;

/** `{ name, version }` source text for each `definePackage`/`defineProviderPackage` call in `source`. */
export function definitionCalls(source) {
  const calls = [];
  DEFINITION_CALL.lastIndex = 0;
  let match;
  while ((match = DEFINITION_CALL.exec(source))) {
    const open = source.indexOf("{", match.index + match[0].length);
    if (open === -1) continue;
    const end = matchBrace(source, open);
    if (end === -1) continue;
    const body = source.slice(open + 1, end);
    calls.push({
      name: body.match(/\bname:\s*("(?:[^"\\]|\\.)*"|[A-Za-z_$][\w$.]*)/)?.[1] ?? "",
      version: body.match(/\bversion:\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? null,
    });
    DEFINITION_CALL.lastIndex = end;
  }
  return calls;
}

/**
 * Package definitions that hardcode a version. A call whose `name` is a string literal that is not a
 * workspace package is an in-process test/conformance package (`apps/prism-agent`, driver conformance)
 * and is allowed to carry its own version; a first-party name, or a name held in a const/expression,
 * must read the package's own `package.json`.
 */
export function definitionVersionProblems(sources, workspaceNames) {
  const problems = [];
  for (const [path, source] of sources) {
    for (const { name, version } of definitionCalls(source)) {
      if (version === null) continue;
      const literal = name.startsWith('"') ? name.slice(1, -1) : null;
      if (literal !== null && !workspaceNames.has(literal)) continue;
      problems.push(`${path}: package definition for ${name} hardcodes version "${version}"`);
    }
  }
  return problems;
}

const MCP_SERVER_LITERAL = /serverVersion\s*\?\?\s*"\d+\.\d+\.\d+"|new (?:McpServer|Client)\(\s*\{[^}]*version:\s*"\d+\.\d+\.\d+"/;
const AGENT_INFO_LITERAL = /(?:agentInfo|hostInfo):\s*\{[^}]*version:\s*"\d+\.\d+\.\d+"/;

/** Server/host identities (`serverVersion`, `new McpServer`/`new Client`, ACP `agentInfo`, MCP Apps `hostInfo`) that hardcode a version. */
export function identityVersionProblems(sources) {
  const problems = [];
  for (const [path, source] of sources) {
    if (MCP_SERVER_LITERAL.test(source)) problems.push(`${path}: the MCP server identity hardcodes a version`);
    if (AGENT_INFO_LITERAL.test(source)) problems.push(`${path}: agentInfo hardcodes a version`);
  }
  return problems;
}

function parseJson(files, path, problems) {
  const raw = files.get(path);
  if (raw === undefined) {
    problems.push(`${path}: missing (the gate cannot verify this surface)`);
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    problems.push(`${path}: malformed JSON`);
    return undefined;
  }
}

/** Capture one claim from a text surface, reporting a missing surface as a problem. */
function capture(files, path, pattern, label, problems) {
  const raw = files.get(path);
  if (raw === undefined) {
    problems.push(`${path}: missing (the gate cannot verify ${label})`);
    return undefined;
  }
  const match = raw.match(pattern);
  if (!match) {
    problems.push(`${path}: no ${label} found — the gate would pass vacuously`);
    return undefined;
  }
  return match[1];
}

/** bun.lock is JSONC-shaped (trailing commas), so it parses through the shared reader. */
function parseLock(files, path, problems) {
  const raw = files.get(path);
  if (raw === undefined) {
    problems.push(`${path}: missing (the gate cannot verify this surface)`);
    return undefined;
  }
  try {
    return parseBunLock(raw);
  } catch {
    problems.push(`${path}: malformed lockfile`);
    return undefined;
  }
}

/**
 * Claim surfaces that do not equal `current`, as human-readable lines.
 * Pure: `files` is a path→text map, so the positive control can mutate a fixture
 * rather than the checkout.
 */
export function claimViolations(files, current) {
  const problems = [];
  const manifests = [...files.keys()].filter((path) => MANIFEST.test(path)).sort();
  // Plan 216 Task 5 folded the fabric into memory-system: 51 manifests (root + 50 workspaces).
  if (manifests.length !== 51) {
    problems.push(`expected 51 manifests (root + 50 workspaces) to check for lockstep ${current}, got ${manifests.length}`);
  }
  const parsed = new Map();
  for (const path of manifests) {
    const pkg = parseJson(files, path, problems);
    if (pkg !== undefined) parsed.set(path, pkg);
  }
  /** The version a package claims: its own manifest for an independent line, else the lockstep version. */
  const independentVersions = new Map(
    [...parsed.values()].filter((pkg) => INDEPENDENT_LINES.has(pkg.name)).map((pkg) => [pkg.name, pkg.version]),
  );
  const expected = (name) => independentVersions.get(name) ?? current;
  /** The range a pin must carry: exact into an experimental prerelease, caret into everything else. */
  const expectedRange = (name) => (EXPERIMENTAL_LINES.has(name) ? expected(name) : `^${expected(name)}`);
  for (const [path, pkg] of parsed) {
    if (!INDEPENDENT_LINES.has(pkg.name) && pkg.version !== current) problems.push(`${path}: version ${pkg.version} != ${current}`);
    if (EXPERIMENTAL_LINES.has(pkg.name) && !EXPERIMENTAL_VERSION.test(String(pkg.version))) {
      problems.push(`${path}: experimental package version ${pkg.version} is not x.y.z-experimental.N`);
    }
    if (!EXPERIMENTAL_LINES.has(pkg.name) && /-/.test(String(pkg.version))) {
      problems.push(`${path}: version ${pkg.version} carries a prerelease but ${pkg.name} is not experimental`);
    }
    for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
      for (const [name, range] of Object.entries(pkg[field] ?? {})) {
        if (!name.startsWith(INTERNAL_PACKAGE) || String(range).startsWith("file:")) continue;
        // A package on its own version line owns its pins *into* the lockstep line: a cut must not
        // rewrite them, or the next release --resume sees a manifest the registry does not have. Its
        // pin on another independent line (the app on the SDK) is still a claim.
        if (INDEPENDENT_LINES.has(pkg.name) && !INDEPENDENT_LINES.has(name)) continue;
        // The kernel peer is the API-level window (`>=0.13.0 <1.0.0`), not a cut pin; a kernel minor
        // does not rewrite it (docs/compatibility.md).
        if (name === "@arnilo/prism" && /^>=\d+\.\d+\.\d+ <1\.0\.0$/.test(String(range))) continue;
        if (range !== expectedRange(name)) problems.push(`${path}: ${field}.${name} is ${range}, expected ${expectedRange(name)}`);
      }
    }
  }

  const lock = parseLock(files, "bun.lock", problems);
  if (lock !== undefined) {
    // Root `workspaces[""]` carries no version today; if a future Bun writes one,
    // it is a release claim and must match. Workspace entries always carry one.
    const rootEntry = lock.workspaces?.[""];
    if (rootEntry?.version !== undefined && rootEntry.version !== current) {
      problems.push(`bun.lock: root version ${rootEntry.version} != ${current}`);
    }
    for (const [path, entry] of Object.entries(lock.workspaces ?? {})) {
      if (path === "") continue;
      if (!MANIFEST.test(`${path}/package.json`)) continue;
      if (entry.version !== expected(entry.name)) problems.push(`bun.lock: ${path} version ${entry.version} != ${expected(entry.name)}`);
    }
  }

  const indexVersion = capture(files, "src/index.ts", /export const version = "([^"]+)"/, "`export const version`", problems);
  if (indexVersion !== undefined && indexVersion !== current) {
    problems.push(`src/index.ts: version constant ${indexVersion} != ${current}`);
  }

  const banner = capture(files, "docs/index.md", /Current line \(([^)]+)\)/, "`Current line (x.y.z)` banner", problems);
  if (banner !== undefined && banner !== current) problems.push(`docs/index.md: current line ${banner} != ${current}`);

  const tags = capture(files, ".github/workflows/release.yml", /tags:\s*\[([^\]]*)\]/, "release tag list", problems);
  if (tags !== undefined) {
    const entries = tags.split(",").map((entry) => entry.trim());
    if (!entries.includes(`"v${current}"`)) problems.push(`.github/workflows/release.yml: tag list has no "v${current}"`);
    if (entries.at(-1) !== '"@arnilo/*@*"') {
      problems.push(".github/workflows/release.yml: package-tag glob must stay the last tag entry");
    }
  }

  const truth = parseJson(files, "scripts/package-truth.json", problems);
  if (truth !== undefined) {
    if (truth.root?.version !== current) {
      problems.push(`scripts/package-truth.json: root.version ${truth.root?.version} != ${current} (regenerate with --emit-docs)`);
    }
    for (const [name, version] of Object.entries(truth.versions ?? {})) {
      if (version !== expected(name))
        problems.push(`scripts/package-truth.json: ${name} version ${version} != ${expected(name)} (regenerate)`);
    }
  }

  return problems;
}

test("every release-version claim surface equals currentVersion()", () => {
  const current = currentVersion(ROOT);
  const files = claimFiles(ROOT);
  assert.deepEqual(claimViolations(files, current), [], `release claims drifted from ${current}`);
});

test("positive control: a half-finished cut is reported surface by surface", () => {
  const files = claimFiles(ROOT);
  const current = currentVersion(ROOT);
  assert.deepEqual(claimViolations(files, current), [], "control fixture starts clean");

  const bump = (source, pattern, replacement) => source.replace(pattern, replacement);
  // The 0.5.7-cut failure mode: the root manifest moves, sibling surfaces do not.
  const next = current.replace(/\.(\d+)$/, ".99");
  const half = new Map(files);
  half.set("package.json", bump(files.get("package.json"), `"version": "${current}"`, `"version": "${next}"`));
  const halfProblems = claimViolations(half, next);
  for (const [label, fragment] of [
    ["workspace manifest", "packages/hosts/ag-ui/package.json: version"],
    ["internal range", "package.json: peerDependencies"],
    ["lockfile", "bun.lock:"],
    ["index constant", "src/index.ts: version constant"],
    ["docs banner", "docs/index.md: current line"],
    ["workflow tag", ".github/workflows/release.yml: tag list has no"],
    ["package truth", "scripts/package-truth.json: root.version"],
  ]) {
    assert.ok(
      halfProblems.some((problem) => problem.includes(fragment)),
      `${label} must be reported, got:\n${halfProblems.join("\n")}`,
    );
  }
  assert.ok(halfProblems.length >= 10, `every stale surface must be named, got ${halfProblems.length}`);

  // A renamed/dropped surface must fail loudly instead of passing vacuously.
  const vacuous = new Map(half);
  vacuous.delete("docs/index.md");
  assert.ok(
    claimViolations(vacuous, next).some((problem) => problem.includes("docs/index.md: missing")),
    "a deleted surface must be reported as unverifiable",
  );
});

test("positive control: the experimental line is accepted for exactly the experimental set", () => {
  const files = claimFiles(ROOT);
  const current = currentVersion(ROOT);
  assert.ok(EXPERIMENTAL_LINES.size > 0, "the experimental list is not empty");
  const memory = "packages/memory/system/package.json";
  const tools = "packages/tools/web/package.json";
  const manifest = JSON.parse(files.get(memory));
  assert.match(manifest.version, EXPERIMENTAL_VERSION, "an experimental package carries the prerelease");
  const mutate = (path, change) => {
    const next = new Map(files);
    const parsed = JSON.parse(files.get(path));
    change(parsed);
    next.set(path, JSON.stringify(parsed));
    return claimViolations(next, current);
  };
  assert.ok(
    mutate(memory, (m) => {
      m.version = current;
    }).some((problem) => problem.includes("is not x.y.z-experimental.N")),
    "an experimental package at the plain release version is reported",
  );
  assert.ok(
    mutate(tools, (m) => {
      m.version = `${current}-experimental.0`;
    }).some((problem) => problem.includes("is not experimental")),
    "the prerelease anywhere else is reported",
  );
  assert.ok(
    mutate("packages/knowledge/wiki/package.json", (m) => {
      m.dependencies["@arnilo/prism-memory-core"] = `^${current}`;
    }).some((problem) => problem.includes("expected 0.13.0-experimental")),
    "a caret pin into the experimental line is reported",
  );
});

// Plan 176 Task 2: a package's `definePackage`/`defineProviderPackage` call, and every server/host
// identity it ships, must read the version from its own `package.json` — never a literal. Bumping a
// package then needs one edit, and the reported version can never drift from the published manifest.
test("no package definition or server identity hardcodes a version", () => {
  const dirs = expandWorkspaceDirs(ROOT, readManifest(join(ROOT, "package.json")).workspaces ?? []);
  const workspaceNames = new Set(dirs.map((dir) => readManifest(join(dir, "package.json")).name));
  const sources = dirs.flatMap((dir) =>
    packageSources(dir).map((file) => [relative(ROOT, file).replaceAll("\\", "/"), readFileSync(file, "utf8")]),
  );
  assert.ok(sources.length > 100, `the scan must cover the package sources, got ${sources.length}`);
  assert.deepEqual(definitionVersionProblems(sources, workspaceNames), [], "a package definition hardcodes a version");
  assert.deepEqual(identityVersionProblems(sources), [], "a server or host identity hardcodes a version");
});

test("positive control: a hardcoded definition version is reported, an in-process package is not", () => {
  const names = new Set(["@arnilo/prism-tools-web"]);
  const problemsFor = (source) => definitionVersionProblems([["a.ts", source]], names);

  assert.equal(problemsFor('definePackage({ name: "@arnilo/prism-tools-web", version: "0.13.0", setup() {} })').length, 1);
  assert.equal(
    problemsFor('const PACKAGE = "@arnilo/prism-tools-web";\ndefinePackage({ name: PACKAGE, version: "0.13.0", setup() {} })').length,
    1,
  );
  assert.equal(
    problemsFor('defineProviderPackage({ name: "@arnilo/prism-provider-hyper", version: "0.13.0", setup() {} })').length,
    0,
    "providers read the kernel version",
  );
  assert.deepEqual(
    problemsFor('definePackage({ name: "conformance-workspace", version: "1.0.0", setup() {} })'),
    [],
    "an in-process test package owns its version",
  );
  assert.deepEqual(
    problemsFor(
      'import manifest from "../package.json" with { type: "json" };\ndefinePackage({ name: PACKAGE, version: manifest.version, setup() {} })',
    ),
    [],
    "reading the manifest is the fix",
  );

  assert.equal(identityVersionProblems([["b.ts", 'version: options.serverVersion ?? "0.12.1"']]).length, 1);
  assert.deepEqual(identityVersionProblems([["c.ts", "version: options.serverVersion ?? manifest.version"]]), []);
  assert.equal(identityVersionProblems([["d.ts", 'agentInfo: { name: "prism", version: "0.12.1" }']]).length, 1);
  assert.equal(
    identityVersionProblems([["e.ts", 'new Client({ name: "prism-mcp-bridge", version: "0.0.12" }, {})']]).length,
    1,
    "the MCP client identity hardcodes a version",
  );
  assert.equal(
    identityVersionProblems([["f.ts", 'hostInfo: { name: "prism-ag-ui", version: "0.0.23" }']]).length,
    1,
    "the MCP Apps hostInfo hardcodes a version",
  );
  assert.deepEqual(identityVersionProblems([["g.ts", 'new Client({ name: "prism-mcp-bridge", version: manifest.version }, {})']]), []);
  assert.deepEqual(identityVersionProblems([["h.ts", 'hostInfo: { name: "prism-ag-ui", version: manifest.version }']]), []);
});
