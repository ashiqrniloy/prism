/**
 * Wiki scratch isolation gate (plan 071 Task 6, plan 070 FA 7).
 *
 * The wiki helpers default `workspaceRoot`/`wikiRoot` to `process.cwd()`, so a
 * suite that passes a repo-relative scratch root writes into the repository:
 * `packages/memory/.wiki/` is tracked, and a run from the repository root used
 * to scaffold an untracked `<repo>/.wiki/`. This gate runs the wiki suites from
 * both working directories a real run uses (the package, and the repo root) and
 * asserts the repository is untouched:
 *
 *   1. the three tracked fixture files are byte-identical (sha256);
 *   2. no file is added or removed inside `packages/memory/.wiki/`;
 *   3. no `<repo>/.wiki/` directory is scaffolded;
 *   4. no cwd-relative `dist/__tests__/scratch-*` directory appears.
 *
 * The gate itself only reads and spawns; children write to `tmpdir()`. The three
 * detector branches are exercised against a synthetic repo (same layout) so a
 * vacuous detector — one that cannot fail — is caught here.
 *
 * Stale state: if `<repo>/.wiki/` already exists, the gate fails and names it
 * instead of deleting it; a pre-existing wiki may be a host's real workspace.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const MEMORY = join(ROOT, "packages", "memory");
const WIKI_SUITE_DIR = join(MEMORY, "dist", "wiki", "__tests__");
// The glob is expanded by the child runner, so it must be relative to that cwd.
const suiteGlob = (cwd) => `${relative(cwd, WIKI_SUITE_DIR).split("\\").join("/")}/*.test.js`;
const FIXTURE_NAMES = [".manifest.json", "SCHEMA.md", "log.md"];
const FIXTURE_DIR = join("packages", "memory", ".wiki");
// Pre-isolation scratch locations: `join(process.cwd(), "dist/__tests__", …)`.
const RETIRED_SCRATCH_PREFIXES = ["scratch-", "fixture-"];

const fixtureDir = (repoRoot) => join(repoRoot, FIXTURE_DIR);
const fixturePaths = (repoRoot) => FIXTURE_NAMES.map((name) => join(fixtureDir(repoRoot), name));

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fixtureEntries(repoRoot) {
  return readdirSync(fixtureDir(repoRoot)).sort().join("\n");
}

function scratchDirs(cwd) {
  const dir = join(cwd, "dist", "__tests__");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => RETIRED_SCRATCH_PREFIXES.some((prefix) => name.startsWith(prefix)))
    .sort();
}

/**
 * Run `body` and list every way the wiki suites can pollute `repoRoot`.
 * Split out from the spawn so planted writes can drive the same code path.
 */
function detectPollution(repoRoot, cwd, body) {
  const before = {
    hashes: Object.fromEntries(fixturePaths(repoRoot).map((path) => [path, hashFile(path)])),
    entries: fixtureEntries(repoRoot),
    rootWiki: existsSync(join(repoRoot, ".wiki")),
    scratch: scratchDirs(cwd),
  };
  body();
  const findings = [];
  for (const [path, hash] of Object.entries(before.hashes)) {
    if (hashFile(path) !== hash) findings.push(`tracked fixture rewritten: ${path.slice(repoRoot.length + 1)}`);
  }
  if (fixtureEntries(repoRoot) !== before.entries) findings.push("fixture directory listing changed");
  if (!before.rootWiki && existsSync(join(repoRoot, ".wiki"))) findings.push("scaffolded <repo>/.wiki/");
  const appeared = scratchDirs(cwd).filter((name) => !before.scratch.includes(name));
  if (appeared.length > 0) findings.push(`created cwd-relative scratch dirs: ${appeared.join(", ")}`);
  return findings;
}

function runWikiSuites(cwd) {
  const label = cwd.slice(ROOT.length + 1) || ".";
  // A nested `node --test` refuses to run ("skipping running files") while
  // NODE_TEST_CONTEXT is inherited — it exits 0 with no output, so a gate that
  // spawns the runner must strip it and assert a pass count afterwards.
  const result = spawnSync(process.execPath, ["--test", suiteGlob(cwd)], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NODE_TEST_CONTEXT: undefined, NODE_TEST_WORKER_ID: undefined },
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  assert.equal(result.status, 0, `wiki suites must pass with cwd=${label}:\n${output.slice(-4000)}`);
  assert.match(output, /ℹ pass [1-9]/, `wiki suites reported no passing tests with cwd=${label}`);
}

test("wiki suites are hermetic: tracked fixtures and the repository root stay untouched", () => {
  assert.ok(existsSync(fixtureDir(ROOT)), "packages/memory/.wiki fixture must exist");
  assert.ok(existsSync(WIKI_SUITE_DIR), "packages/memory must be built first (dist/wiki/__tests__ missing)");
  const staleRootWiki = join(ROOT, ".wiki");
  assert.ok(!existsSync(staleRootWiki), `stale ${staleRootWiki} exists before the run; remove it (rm -rf ${staleRootWiki}) and re-run`);

  for (const cwd of [MEMORY, ROOT]) {
    const findings = detectPollution(ROOT, cwd, () => runWikiSuites(cwd));
    assert.deepEqual(findings, [], `wiki suites polluted the repository (cwd=${cwd.slice(ROOT.length + 1) || "."})`);
  }
});

test("wiki suites take every scratch root from tmpdir(), not the working directory", () => {
  const dir = join(MEMORY, "src", "wiki", "__tests__");
  const offenders = readdirSync(dir)
    .filter((name) => name.endsWith(".test.ts"))
    .filter((name) => readFileSync(join(dir, name), "utf8").includes("process.cwd()"));
  assert.deepEqual(
    offenders,
    [],
    "wiki suites must resolve scratch paths from mkdtempSync(join(tmpdir(), ...)) — process.cwd() is the package in the workspace stage and the repo root in a root-stage run",
  );
});

test("pollution detector fires on every branch it is supposed to watch", () => {
  // Synthetic repo with the same layout, so the controls never touch the real fixture.
  const repo = mkdtempSync(join(tmpdir(), "prism-wiki-isolation-control-"));
  try {
    mkdirSync(fixtureDir(repo), { recursive: true });
    for (const name of FIXTURE_NAMES) writeFileSync(join(fixtureDir(repo), name), `${name}\n`);
    const cwd = join(repo, "packages", "memory");
    mkdirSync(cwd, { recursive: true });

    // (a) fixture rewrite — the shape of the phase 070 FA 7 defect. The detector
    // samples end state, so the planted write persists until after the call.
    const logPath = join(fixtureDir(repo), "log.md");
    const originalLog = readFileSync(logPath);
    const rewritten = detectPollution(repo, cwd, () => writeFileSync(logPath, `${originalLog}planted\n`));
    writeFileSync(logPath, originalLog);
    assert.ok(
      rewritten.some((finding) => finding.includes("tracked fixture rewritten")),
      `planted fixture rewrite not detected: ${JSON.stringify(rewritten)}`,
    );

    // (b) fixture addition, then cleanup outside the sample window.
    const added = detectPollution(repo, cwd, () => {
      mkdirSync(join(fixtureDir(repo), "entities"), { recursive: true });
      writeFileSync(join(fixtureDir(repo), "entities", "planted.md"), "# Planted\n");
    });
    rmSync(join(fixtureDir(repo), "entities"), { recursive: true, force: true });
    assert.ok(
      added.some((finding) => finding.includes("fixture directory listing changed")),
      `planted fixture page not detected: ${JSON.stringify(added)}`,
    );

    // (c) untracked repo-root wiki scaffold.
    const rootWiki = detectPollution(repo, cwd, () => {
      mkdirSync(join(repo, ".wiki"), { recursive: true });
      writeFileSync(join(repo, ".wiki", "log.md"), "# Planted\n");
    });
    rmSync(join(repo, ".wiki"), { recursive: true, force: true });
    assert.ok(
      rootWiki.some((finding) => finding.includes("scaffolded <repo>/.wiki/")),
      `planted root wiki not detected: ${JSON.stringify(rootWiki)}`,
    );

    // (d) cwd-relative scratch dir (the retired `join(process.cwd(), "dist/__tests__/scratch-*")`).
    const plantedScratch = join(cwd, "dist", "__tests__", "scratch-planted-test");
    const scratch = detectPollution(repo, cwd, () => mkdirSync(plantedScratch, { recursive: true }));
    rmSync(join(cwd, "dist"), { recursive: true, force: true });
    assert.ok(
      scratch.some((finding) => finding.includes("created cwd-relative scratch dirs")),
      `planted scratch dir not detected: ${JSON.stringify(scratch)}`,
    );

    // (e) a clean run reports nothing, so the detector is not always-on — and a
    // write the suite cleans up before it exits is not pollution (the real gate
    // asserts end-state byte-identity, not absence of mid-run churn).
    const clean = detectPollution(repo, cwd, () => {
      writeFileSync(join(cwd, "untouched.txt"), "no fixture writes\n");
      unlinkSync(join(cwd, "untouched.txt"));
      writeFileSync(logPath, `${originalLog}transient\n`);
      writeFileSync(logPath, originalLog);
    });
    assert.deepEqual(clean, [], `clean run reported pollution: ${JSON.stringify(clean)}`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
