#!/usr/bin/env node
// Plan 071 Task 1 (plan 070 FA 10): one source for the release version, and one
// pre-flight that names every surface a half-finished cut left behind.
//
// `currentVersion()` (scripts/package-truth.mjs) reads the root manifest, which
// `release.mjs bump` rewrites first. This gate then asserts that every surface
// which CLAIMS the release version equals it: all 10 manifests, all internal
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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { currentVersion, expandWorkspaceDirs, readManifest } from "./package-truth.mjs";

const ROOT = join(import.meta.dirname, "..");
const INTERNAL_PACKAGE = "@arnilo/";
const MANIFEST = /^(?:package\.json|packages\/[^/]+\/package\.json)$/;

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
  for (const path of [
    "package-lock.json",
    "src/index.ts",
    "docs/index.md",
    ".github/workflows/release.yml",
    "scripts/package-truth.json",
  ]) {
    put(path);
  }
  return files;
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

/**
 * Claim surfaces that do not equal `current`, as human-readable lines.
 * Pure: `files` is a path→text map, so the positive control can mutate a fixture
 * rather than the checkout.
 */
export function claimViolations(files, current) {
  const problems = [];
  const caret = `^${current}`;
  const manifests = [...files.keys()].filter((path) => MANIFEST.test(path)).sort();
  if (manifests.length !== 10) {
    problems.push(`expected 10 manifests (root + 9 workspaces) to check for lockstep ${current}, got ${manifests.length}`);
  }
  for (const path of manifests) {
    const pkg = parseJson(files, path, problems);
    if (pkg === undefined) continue;
    if (pkg.version !== current) problems.push(`${path}: version ${pkg.version} != ${current}`);
    for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
      for (const [name, range] of Object.entries(pkg[field] ?? {})) {
        if (!name.startsWith(INTERNAL_PACKAGE) || String(range).startsWith("file:")) continue;
        if (range !== caret) problems.push(`${path}: ${field}.${name} is ${range}, expected ${caret}`);
      }
    }
  }

  const lock = parseJson(files, "package-lock.json", problems);
  if (lock !== undefined) {
    if (lock.version !== current) problems.push(`package-lock.json: version ${lock.version} != ${current}`);
    for (const [path, entry] of Object.entries(lock.packages ?? {})) {
      const manifest = path === "" ? "package.json" : `${path}/package.json`;
      if (!MANIFEST.test(manifest)) continue;
      if (entry.version !== current) problems.push(`package-lock.json: ${path || "."} version ${entry.version} != ${current}`);
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
      if (version !== current) problems.push(`scripts/package-truth.json: ${name} version ${version} != ${current} (regenerate)`);
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
    ["workspace manifest", "packages/prism-core/package.json: version"],
    ["internal range", "package.json: peerDependencies"],
    ["lockfile", "package-lock.json: version"],
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
