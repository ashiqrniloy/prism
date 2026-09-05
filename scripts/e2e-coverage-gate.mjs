#!/usr/bin/env node
/**
 * E2E surface coverage gate (plans/064 Task 3) — the "100%" enforcement.
 *
 * "100% e2e coverage" is defined as: every public export subpath (root + 9
 * workspaces, from package.json `exports` maps — no hand-maintained lists) is
 * covered by at least one real test suite: journey / live / real-wire /
 * conformance-over-real-wire. The checked-in scripts/e2e-coverage.json maps
 * every subpath to its covering suite files (generated skeleton +
 * hand-annotated).
 *
 * Modes:
 * - baseline (current): fails on REGRESSIONS only — a surface that lost its
 *   annotation, a stale annotation for a removed surface, an annotated test
 *   file that no longer exists, or a new unannotated surface. Empty suite
 *   lists are pending work (plans/064 Tasks 4-9) and pass.
 * - full: additionally fails on any empty suite list. Switch by setting
 *   "mode": "full" in the manifest after Tasks 4-9 land.
 *
 * CLI:
 *   node scripts/e2e-coverage-gate.mjs              run gate (mode from manifest)
 *   node scripts/e2e-coverage-gate.mjs --baseline   force baseline mode
 *   node scripts/e2e-coverage-gate.mjs --generate   regenerate skeleton, preserving annotations
 *   node scripts/e2e-coverage-gate.mjs --json       machine-readable summary
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_EXPORT_KEYS = new Set(["./package.json"]); // metadata, not a functional surface
const MANIFEST_PATH = "scripts/e2e-coverage.json";

/** Root package + all workspace packages: [{name, dir, pkg}]. */
export function listPackages(root = REPO_ROOT) {
  const pkgs = [];
  const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  pkgs.push({ name: rootPkg.name, dir: root, pkg: rootPkg });
  const workspaces = rootPkg.workspaces ?? [];
  for (const ws of workspaces) {
    // workspaces entries may be package dirs themselves ("packages/mcp") or
    // bases containing packages ("packages/*")
    const candidates = existsSync(join(root, ws, "package.json")) ? [join(root, ws)] : [];
    if (!candidates.length) {
      const base = join(root, ws);
      if (existsSync(base)) {
        for (const d of readdirSync(base, { withFileTypes: true })) {
          if (d.isDirectory() && !d.name.startsWith(".")) candidates.push(join(base, d.name));
        }
      }
    }
    for (const dir of candidates) {
      const path = join(dir, "package.json");
      if (existsSync(path)) {
        const pkg = JSON.parse(readFileSync(path, "utf8"));
        if (pkg.exports) pkgs.push({ name: pkg.name, dir, pkg });
      }
    }
  }
  return pkgs;
}

/** Resolve an exports value to the SOURCE path (dir or file) it serves. */
function resolveSourcePath(pkgDir, value) {
  const target = typeof value === "string" ? value : (value?.import ?? value?.default ?? Object.values(value ?? {})[0]);
  if (typeof target !== "string") return null;
  let src = target.startsWith("./dist/") ? target.replace("./dist/", "./src/") : target;
  src = src.replace(/\.js$/, "");
  // dist/<x>/index.js is compiled from src/<x>/index.ts — the surface is the
  // enclosing dir when an index is involved.
  if (src === "index" || src.endsWith("/index")) {
    const dir = src === "index" ? join(pkgDir, "src") : join(pkgDir, src.replace("/index", ""));
    if (existsSync(dir)) return dir;
  }
  const ts = join(pkgDir, `${src}.ts`);
  if (existsSync(ts)) return src.split("/").pop() === "index" ? dirname(ts) : ts;
  const asDir = join(pkgDir, src);
  if (existsSync(asDir)) return asDir;
  const asIndexDir = join(pkgDir, src.replace(/\/index$/, ""));
  if (existsSync(asIndexDir)) return asIndexDir;
  return null;
}

/** Every public export subpath: [{pkgName, pkgDir, subpath, srcPath}]. */
export function discoverSurfaces(root = REPO_ROOT) {
  const surfaces = [];
  for (const { name, dir, pkg } of listPackages(root)) {
    for (const [subpath, value] of Object.entries(pkg.exports ?? {})) {
      if (SKIP_EXPORT_KEYS.has(subpath)) continue;
      surfaces.push({ pkgName: name, pkgDir: dir, subpath, srcPath: resolveSourcePath(dir, value) });
    }
  }
  return surfaces;
}

function listTestFiles(root, pkgDir) {
  const srcDir = join(pkgDir, "src");
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".test.ts") && path.includes("__tests__")) out.push(path);
    }
  };
  if (existsSync(srcDir)) walk(srcDir);
  return out.map((p) => relative(root, p));
}

function grepImporters(root, _pkgDir, srcRelWithoutExt, candidates) {
  const needle = (srcRelWithoutExt.startsWith("src/") ? srcRelWithoutExt.slice(4) : srcRelWithoutExt).replace(/\.ts$/, "");
  // relative import of exactly this module: from "../<needle>" or "../<needle>.js"
  const re = new RegExp(`from ["']\\.\\./${needle}(\\.js)?["']`);
  const hits = [];
  for (const testPath of candidates) {
    if (re.test(readFileSync(join(root, testPath), "utf8"))) hits.push(testPath);
  }
  return hits.slice(0, 3);
}

/**
 * Map each surface to covering test files (generation heuristic):
 * - dir surface: all __tests__ files under it, owned by the DEEPEST matching
 *   surface (nested subpath steals its own subtree); files in a shared
 *   __tests__ dir tiebreak by file-name stem.
 * - file surface: sibling __tests__/<base>.test.ts, then src/__tests__
 *   stem matches (<base>, <parent>-<base>), then import-graph grep.
 * - leftover package tests attach to the "." surface (umbrella export).
 * Returns Map "pkgName|subpath" -> sorted test paths (repo-relative).
 */
export function collectTests(root = REPO_ROOT, surfaces = discoverSurfaces(root)) {
  const assignment = new Map();
  const byPkg = new Map();
  for (const s of surfaces) {
    if (!byPkg.has(s.pkgName)) byPkg.set(s.pkgName, []);
    byPkg.get(s.pkgName).push(s);
    assignment.set(`${s.pkgName}|${s.subpath}`, []);
  }
  for (const [pkgName, pkgSurfaces] of byPkg) {
    const rootDir = pkgSurfaces[0].pkgDir;
    const allTests = listTestFiles(root, rootDir);
    // deepest-prefix ownership for directory surfaces
    const claim = (testPath) => {
      const dirOfTest = dirname(relative(join(rootDir, "src"), join(root, testPath)));
      const dirCandidates = pkgSurfaces
        .filter((s) => s.srcPath && !s.srcPath.endsWith(".ts"))
        .map((s) => ({ s, relSrc: relative(join(rootDir, "src"), s.srcPath) }))
        .filter(({ relSrc }) => dirOfTest === relSrc || dirOfTest.startsWith(`${relSrc}/`))
        .sort((a, b) => b.s.srcPath.length - a.s.srcPath.length);
      return dirCandidates[0]?.s ?? null;
    };
    const claimed = new Set();
    for (const testPath of allTests) {
      const owner = claim(testPath);
      const key = owner ? `${owner.pkgName}|${owner.subpath}` : null;
      if (owner) {
        assignment.get(key).push(testPath);
        claimed.add(testPath);
      }
    }
    // shared-__tests__ tiebreak: file stem may name a nested subpath
    for (const [key, tests] of assignment) {
      const surface = pkgSurfaces.find((s) => `${s.pkgName}|${s.subpath}` === key);
      if (!surface?.subpath.startsWith("./") || surface.subpath === ".") continue;
      const leaf = surface.subpath.split("/").pop();
      for (const testPath of [...tests]) {
        const stem = testPath.split("/").pop().replace(".test.ts", "");
        const parent = surface.subpath.split("/").slice(0, -1).pop();
        const isShared = assignment.get(`${pkgName}|./${parent}`)?.includes(testPath) && (stem === leaf || stem === `${parent}-${leaf}`);
        if (isShared) {
          assignment.get(`${pkgName}|./${parent}`).splice(assignment.get(`${pkgName}|./${parent}`).indexOf(testPath), 1);
        }
      }
    }
    // file surfaces: stem / import-graph fallback
    for (const s of pkgSurfaces) {
      const key = `${s.pkgName}|${s.subpath}`;
      if (!s.srcPath?.endsWith(".ts") || assignment.get(key).length) continue;
      const rel = relative(join(rootDir, "src"), s.srcPath);
      const base = rel.split("/").pop().replace(/\.ts$/, "");
      const parent = rel.split("/").slice(0, -1).pop();
      const stemHits = allTests.filter((t) => {
        const stem = t.split("/").pop().replace(".test.ts", "");
        return stem === base || (parent && stem === `${parent}-${base}`);
      });
      const grepHits = stemHits.length ? [] : grepImporters(root, rootDir, rel, allTests);
      assignment.set(key, (stemHits.length ? stemHits : grepHits).sort());
    }
    // leftovers cover the umbrella "." surface
    const dotKey = `${pkgName}|.`;
    if (assignment.has(dotKey)) {
      const owned = new Set([...assignment.values()].flat());
      const leftovers = allTests.filter((t) => !owned.has(t));
      assignment.set(dotKey, [...new Set([...assignment.get(dotKey), ...leftovers])].sort());
    }
  }
  return assignment;
}

/** Validate the checked-in manifest against the live exports maps. */
export function computeCoverage(root = REPO_ROOT, coverage, { mode } = {}) {
  const surfaces = discoverSurfaces(root);
  const effectiveMode = mode ?? coverage.mode ?? "baseline";
  const errors = [];
  const manifestKeys = new Set(
    Object.keys(coverage.packages ?? {}).flatMap((p) => Object.keys(coverage.packages[p]).map((s) => `${p}|${s}`)),
  );
  const surfaceKeys = new Set(surfaces.map((s) => `${s.pkgName}|${s.subpath}`));
  for (const s of surfaces) {
    const key = `${s.pkgName}|${s.subpath}`;
    const entry = coverage.packages?.[s.pkgName]?.[s.subpath];
    if (!entry) {
      errors.push(`unannotated surface ${key} — add it to ${MANIFEST_PATH}`);
      continue;
    }
    if (!Array.isArray(entry.suites)) errors.push(`${key}: suites must be an array`);
    for (const suite of entry.suites ?? []) {
      if (typeof suite !== "string" || !existsSync(join(root, suite))) errors.push(`${key}: annotated suite does not exist: ${suite}`);
    }
    if (!entry.suites?.length && effectiveMode === "full") errors.push(`${key}: no covering suite (mode: full)`);
  }
  for (const key of manifestKeys) {
    if (!surfaceKeys.has(key)) errors.push(`stale annotation ${key} — surface no longer exists in exports maps`);
  }
  const pending = surfaces.filter((s) => !coverage.packages?.[s.pkgName]?.[s.subpath]?.suites?.length).length;
  return {
    errors,
    mode: effectiveMode,
    summary: { total: surfaces.length, covered: surfaces.length - pending, pending, mode: effectiveMode },
  };
}

function generate(root = REPO_ROOT) {
  const path = join(root, MANIFEST_PATH);
  const existing = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { packages: {} };
  const surfaces = discoverSurfaces(root);
  const tests = collectTests(root, surfaces);
  const packages = {};
  for (const s of surfaces) {
    const key = s.pkgName;
    const prev = existing.packages?.[s.pkgName]?.[s.subpath];
    packages[key] ??= {};
    packages[key][s.subpath] = prev ?? { suites: tests.get(`${s.pkgName}|${s.subpath}`) ?? [], mode: "" };
  }
  const manifest = { schemaVersion: 1, mode: existing.mode ?? "baseline", packages };
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`generated ${MANIFEST_PATH}: ${surfaces.length} surfaces (existing annotations preserved)`);
}

function runGate(root = REPO_ROOT, { baseline = false, json = false } = {}) {
  const coverage = JSON.parse(readFileSync(join(root, MANIFEST_PATH), "utf8"));
  const { errors, summary } = computeCoverage(root, coverage, { mode: baseline ? "baseline" : undefined });
  if (json) {
    console.log(JSON.stringify({ ok: errors.length === 0, errors, ...summary }, null, 2));
  } else {
    console.log(`e2e-coverage: ${summary.covered}/${summary.total} surfaces covered, ${summary.pending} pending (mode: ${summary.mode})`);
    for (const e of errors) console.error(`E2E-COVERAGE: ${e}`);
  }
  process.exitCode = errors.length ? 1 : 0;
}

export async function main(argv = process.argv.slice(2)) {
  const root = REPO_ROOT;
  if (argv.includes("--generate")) return generate(root);
  runGate(root, { baseline: argv.includes("--baseline"), json: argv.includes("--json") });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
