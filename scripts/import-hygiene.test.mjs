// Plan 057 Task 3: import-hygiene sweep — importing any export-bearing
// scripts/*.mjs (an importable API) must not write files, exit, or change the
// process exit code (the package-truth / phase25-split bug class: scripts that
// mutate tracked files or kill the process at module top level).
//
// Convention for every export-bearing script (package-truth.mjs pattern):
// file writes / process.exit happen only under a direct-execution guard:
//
//   if (process.argv[1] === fileURLToPath(import.meta.url)) { /* CLI main */ }
//
// Sweep: import each export-bearing script from a temp cwd (relative writes
// would land there), then assert no files were written, no exitCode change,
// and the repo `git status` is byte-identical.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function gitStatus() {
  return execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
}

// Lines starting with `export ` that are not inside a template literal. (The
// phase25-split barrel templates contain `export * from ...` lines that would
// otherwise read as module exports.) Escaped backticks (\`) don't toggle state.
function exportBearing(source) {
  let inTemplate = false;
  for (const line of source.split("\n")) {
    const wasIn = inTemplate;
    const ticks = (line.match(/(?<!\\)`/g) ?? []).length;
    if (ticks % 2 === 1) inTemplate = !inTemplate;
    if (!wasIn && line.startsWith("export ")) return true;
  }
  return false;
}

test("importing every export-bearing scripts/*.mjs mutates nothing", async () => {
  const scriptsDir = join(ROOT, "scripts");
  const files = readdirSync(scriptsDir)
    .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs") && exportBearing(readFileSync(join(scriptsDir, f), "utf8")))
    .sort();

  const before = gitStatus();
  const exitBefore = process.exitCode;
  const tmp = mkdtempSync(join(tmpdir(), "prism-import-hygiene-"));
  const previousCwd = process.cwd();
  process.chdir(tmp);
  try {
    for (const f of files) {
      await import(pathToFileURL(join(scriptsDir, f)));
    }
    assert.deepEqual(readdirSync(tmp), [], `importing ${files.join(", ")} wrote files into the cwd`);
  } finally {
    process.chdir(previousCwd);
    rmSync(tmp, { recursive: true, force: true });
  }
  assert.equal(process.exitCode, exitBefore, "imports must not change process.exitCode");
  assert.equal(gitStatus(), before, "imports must not mutate the repo (git status changed)");
});
