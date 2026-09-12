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
//
// Plan 070 Task 10 added a second sweep to this file: a static ESM cycle check
// over the shipped `src/` graph (`content.ts` used to import `pinned-fetch.ts`,
// which imported it back). Runtime edges only — `import type`/`export type`
// clauses and all-type `import { type X }` clauses are erased by tsc and cannot
// order module init, and dynamic `import()` is not a static edge.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
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

// Plan 070 Task 10: static runtime-import cycle detector for the shipped `src/` graph.
// `__tests__` and `.d.ts` files are not shipped modules, so they are not walked.
const RUNTIME_FROM = /^\s*(import|export)\s+([^"']*?)\s*from\s*["'](\.[^"']+)["']/;
const SIDE_EFFECT_IMPORT = /^\s*import\s+["'](\.[^"']+)["']/;

function runtimeSpecifier(line) {
  const match = line.match(RUNTIME_FROM);
  if (match) {
    const clause = match[2].trim();
    if (/^type\b/.test(clause)) return undefined; // import type { X } / export type { X } from
    if (clause.startsWith("{")) {
      const inner = clause.slice(1, clause.lastIndexOf("}"));
      // `import { type A, type B } from` is elided by tsc; a mixed clause is not.
      if (inner.split(",").every((token) => !token.trim() || /^type\b/.test(token.trim()))) return undefined;
    }
    return match[3];
  }
  return line.match(SIDE_EFFECT_IMPORT)?.[1];
}

function srcModuleFiles(root) {
  const walk = (dir) => {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__" && entry.name !== "node_modules") out.push(...walk(full));
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
    }
    return out;
  };
  return walk(join(root, "src"));
}

function resolveSpecifier(file, specifier) {
  const base = resolve(dirname(file), specifier.replace(/\.(js|jsx|mjs|cjs)$/, ""));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** One entry per distinct cycle, each a path list from the first node back to itself. */
function srcRuntimeCycles(root) {
  const files = srcModuleFiles(root);
  const graph = new Map(
    files.map((file) => [
      file,
      readFileSync(file, "utf8")
        .split("\n")
        .map(runtimeSpecifier)
        .filter(Boolean)
        .map((specifier) => resolveSpecifier(file, specifier))
        .filter(Boolean),
    ]),
  );
  const cycles = [];
  const state = new Map();
  const visit = (node, stack) => {
    state.set(node, 1);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (state.get(next) === 1) cycles.push([...stack.slice(stack.indexOf(next)), next]);
      else if (!state.has(next)) visit(next, stack);
    }
    stack.pop();
    state.set(node, 2);
  };
  for (const file of files) if (!state.has(file)) visit(file, []);
  return cycles;
}

test("src/ has no ESM cycle between content.ts and pinned-fetch.ts", () => {
  const cycles = srcRuntimeCycles(ROOT);
  const names = cycles.map((cycle) => cycle.map((file) => relative(ROOT, file)).join(" -> "));
  // Positive control: the detector must find the cycles that existed when this gate
  // was written, otherwise a parse regression would make it pass vacuously. Either
  // cycle later broken → update this list; the control is the point, not the pair.
  assert.ok(
    names.some((cycle) => cycle.includes("src/agent-session/create-agent.ts") && cycle.includes("src/agent-session/session.ts")),
    `detector found no create-agent/session cycle (found: ${names.join("; ") || "none"})`,
  );
  assert.ok(
    names.some((cycle) => cycle.includes("src/provider-request-policy.ts") && cycle.includes("src/thinking.ts")),
    `detector found no provider-request-policy/thinking cycle (found: ${names.join("; ") || "none"})`,
  );
  // Plan 070 Task 10 moved the SSRF gate, `MediaContentError`, and the host/address
  // types into the leaf `src/media-types.ts` to remove this pair's module-init cycle.
  const reintroduced = names.filter((cycle) => cycle.includes("src/content.ts") && cycle.includes("src/pinned-fetch.ts"));
  assert.deepEqual(reintroduced, [], `content.ts <-> pinned-fetch.ts cycle is back: ${reintroduced.join("; ")}`);
});

test("cycle detector flags a reintroduced value cycle and ignores type-only back-edges", () => {
  const fixture = mkdtempSync(join(tmpdir(), "prism-cycle-fixture-"));
  try {
    mkdirSync(join(fixture, "src"));
    writeFileSync(
      join(fixture, "src", "content.ts"),
      'import { pinnedFetch } from "./pinned-fetch.js";\nexport const url = pinnedFetch;\n',
    );
    writeFileSync(join(fixture, "src", "pinned-fetch.ts"), 'import { url } from "./content.js";\nexport const pinnedFetch = url;\n');
    const cycles = srcRuntimeCycles(fixture).map((cycle) => cycle.map((file) => relative(fixture, file)).join(" -> "));
    assert.equal(cycles.length, 1, JSON.stringify(cycles));
    assert.ok(cycles[0].includes("src/content.ts") && cycles[0].includes("src/pinned-fetch.ts"), cycles[0]);

    // The same back-edge as a type-only import cannot order module init → not a cycle.
    writeFileSync(
      join(fixture, "src", "pinned-fetch.ts"),
      'import type { url } from "./content.js";\nexport type PinnedFetch = typeof url;\n',
    );
    assert.deepEqual(srcRuntimeCycles(fixture), []);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

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
