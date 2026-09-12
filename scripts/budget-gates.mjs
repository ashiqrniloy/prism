import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { basename, dirname, join } from "node:path";

// Shared performance-budget helpers (plan 079, Task 8). Used by
// scripts/budget-gate.test.mjs (fast gate) and scripts/benchmark.mjs
// (release evidence). Mirrors the scripts/release-gates.mjs pattern.

export function loadBudgets(file = new URL("./budgets.json", import.meta.url)) {
  return JSON.parse(readFileSync(file, "utf8"));
}

// Bigger-is-worse (pack bytes, file count, latency): fail above baseline*(1+tolerance).
export function checkUpperBound(label, measured, baseline, tolerance) {
  const limit = baseline * (1 + tolerance);
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toPrecision(4));
  return {
    ok: measured <= limit,
    message: `${label}: measured ${fmt(measured)} vs baseline ${fmt(baseline)} (limit ${fmt(limit)}, +${(tolerance * 100).toFixed(0)}%)`,
  };
}

// Throughput: lower-is-worse, fail below baseline*(1-tolerance).
export function checkThroughput(label, measured, baseline, tolerance) {
  const floor = baseline * (1 - tolerance);
  return {
    ok: measured >= floor,
    message: `${label}: measured ${measured}/s vs baseline ${baseline}/s (floor ${floor.toFixed(1)}, -${(tolerance * 100).toFixed(0)}%)`,
  };
}

export function checkCeiling(label, measured, ceiling) {
  return { ok: measured <= ceiling, message: `${label}: measured ${measured.toFixed(1)} vs ceiling ${ceiling}` };
}

export function measureRootPack(cwd = process.cwd()) {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd, stdio: ["pipe", "pipe", "pipe"] }).toString();
  const entry = JSON.parse(out)[0];
  return { packedBytes: entry.size, unpackedBytes: entry.unpackedSize, fileCount: entry.files.length };
}

// Trimmed mean (min and max dropped) of the finite samples; 1–2 samples average
// as-is since there is nothing to trim. Plan 071 Task 3: the startup gate needs a
// statistic that ignores a single straggler sample without the variance of a
// median over an odd, small sample.
export function trimmedMean(samples) {
  const sorted = samples.filter(Number.isFinite).sort((a, b) => a - b);
  const kept = sorted.length > 2 ? sorted.slice(1, -1) : sorted;
  return kept.length ? kept.reduce((sum, value) => sum + value, 0) / kept.length : Number.NaN;
}

// One cold-process import of `./dist/index.js` per run; each spawned process
// prints its own import wall time. `spawn` is injectable so the trimming logic is
// unit-testable without timing real processes.
export function sampleStartupMs(cwd = process.cwd(), runs = 5, spawn = spawnSync) {
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const result = spawn(
      process.execPath,
      ["-e", "const t=process.hrtime.bigint();import('./dist/index.js').then(()=>{console.log(Number(process.hrtime.bigint()-t)/1e6)})"],
      { cwd, stdio: ["pipe", "pipe", "pipe"] },
    );
    samples.push(Number(String(result.stdout).trim()));
  }
  return samples;
}

// Trimmed-mean cold-process import wall time over `runs` spawns.
export function measureStartupMs(cwd = process.cwd(), runs = 5, spawn = spawnSync) {
  return trimmedMean(sampleStartupMs(cwd, runs, spawn));
}

// Median wall time of an empty `node -e ""` process start: the same-machine,
// same-run denominator for the startup ratio (plan 071 Task 3). Machine load and
// CPU generation scale both numbers, so import/process-start cancels most of the
// machine out of the measurement while a genuinely slower import still stands out.
export function measureProcessStartupMs(runs = 3, spawn = spawnSync) {
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const started = process.hrtime.bigint();
    spawn(process.execPath, ["-e", ""], { stdio: ["pipe", "pipe", "pipe"] });
    samples.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return samples.length ? samples[Math.floor(samples.length / 2)] : Number.NaN;
}

// Plan 071 Task 3: a 1-minute load average per CPU at or above this means the
// machine is busy with something else, so the absolute startup ceiling becomes
// evidence-of-record (scripts/benchmark.mjs) instead of an in-chain assertion. The
// machine-relative ratio gate is always on. loadavg() reports zeros on Windows,
// which reads as "unloaded" and keeps the absolute check active there.
export const LOADED_LOADAVG_PER_CPU = 1.5;

export function loadPerCpu() {
  const [oneMinute] = loadavg();
  return oneMinute / Math.max(cpus().length, 1);
}

export function isMachineLoaded(threshold = LOADED_LOADAVG_PER_CPU) {
  return loadPerCpu() >= threshold;
}

// Plan 071 Task 3: which ratio ceiling applies. Off-load the tight ceiling catches
// a ~2.4x startup regression; under load a wider ceiling tolerates the observed
// contention spikes (import alone spiked to 258ms while a process start stayed at
// 33ms, and plan 070 recorded a 1104.8ms import) while still catching a >3x
// regression. The absolute importMs ceiling in budgets.json is the tight bound off
// load and evidence-of-record in scripts/benchmark.mjs.
export function selectStartupRatioCeiling(startup, loaded = isMachineLoaded()) {
  return loaded ? startup.importRatioCeilingUnderLoad : startup.importRatioCeiling;
}

export function assertAll(checks) {
  const failures = checks.filter((c) => !c.ok);
  if (failures.length) throw new Error(`budget regression:\n${failures.map((f) => `  - ${f.message}`).join("\n")}`);
}

// Per-package public-surface count (plan 058 Task 4). Same export-name classes
// as scripts/dead-exports.mjs — declaration exports plus named re-exports,
// deduped per package by name; `export *` barrels are excluded (names not
// attributable). Reads each package's src/ directly (no build needed).
function countDirExports(dir) {
  const walk = (d) => {
    let out = [];
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) out = out.concat(walk(p));
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const names = new Set();
  for (const file of walk(dir)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class|interface|type)\s+([A-Za-z_$][\w$]*)/g))
      names.add(m[1]);
    for (const m of src.matchAll(/export\s*\{([^}]+)\}/g))
      for (const tok of m[1].split(",")) {
        const t = tok.trim();
        if (!t) continue;
        const alias = t.match(/as\s+([A-Za-z_$][\w$]*)\s*$/);
        const sym = (alias ? alias[1] : t.split(/\s+/)[0]).trim();
        if (/^[A-Za-z_$][\w$]*$/.test(sym)) names.add(sym);
      }
  }
  return names.size;
}

export function measureExportCounts(cwd = process.cwd()) {
  const counts = {};
  counts[JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).name] = countDirExports(join(cwd, "src"));
  const packagesDir = join(cwd, "packages");
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = join(packagesDir, entry.name, "package.json");
    if (!existsSync(manifest)) continue;
    const name = JSON.parse(readFileSync(manifest, "utf8")).name;
    counts[name] = countDirExports(join(packagesDir, entry.name, "src"));
  }
  return counts;
}

// Ceiling check that names the package and the exact delta on growth.
export function checkExportBudget(name, measured, ceiling) {
  const delta = measured - ceiling;
  return {
    ok: delta <= 0,
    message:
      delta > 0
        ? `${name} export surface grew: measured ${measured} vs ceiling ${ceiling} (+${delta}) — remove exports or rebaseline budgets.json with a reason entry`
        : `${name} export surface within ceiling: measured ${measured} vs ceiling ${ceiling}`,
  };
}

export const budgetFile = join(new URL(".", import.meta.url).pathname, "budgets.json");

// --- non-null assertion allowance (plan 071 Task 9, plan 070 FA 2) ------------
//
// `style/noNonNullAssertion` is an error repo-wide in biome.json and switched back
// off per directory through `overrides`; the directories that still carry sites are
// recorded in budgets.json under `nonNullAssertions`. One biome pass measures
// everything — `--only` reports the rule inside allowlisted directories too
// (verified against Biome 2.5.13) and the JSON summary is the true total regardless
// of `--max-diagnostics`, while the diagnostics array is what gets grouped.

const NON_NULL_DIAGNOSTIC_LIMIT = 10000;

function runBiomeJson(rootDir, args) {
  const bin = join(rootDir, "node_modules", ".bin", "biome");
  const options = { cwd: rootDir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] };
  let stdout;
  try {
    stdout = execFileSync(bin, args, options);
  } catch (error) {
    // Non-zero is expected while sites remain outside the allowlist (the rule is an
    // error there); the JSON report is still on stdout.
    stdout = typeof error.stdout === "string" ? error.stdout : (error.stdout ?? "").toString();
    if (!stdout.trim()) throw new Error(`biome ${args.join(" ")} failed without a report: ${error.message}`);
  }
  return JSON.parse(stdout);
}

/** biome.json `overrides` that switch `style/noNonNullAssertion` off / back on. */
export function loadNonNullPolicy(rootDir = process.cwd()) {
  const config = JSON.parse(readFileSync(join(rootDir, "biome.json"), "utf8"));
  const allowlisted = [];
  const enforced = [];
  for (const override of config.overrides ?? []) {
    const rule = override.linter?.rules?.style?.noNonNullAssertion;
    if (rule === "off") allowlisted.push(...(override.includes ?? []));
    else if (rule === "error") enforced.push(...(override.includes ?? []));
  }
  return { allowlisted, enforced };
}

/** 1 for an existing path, else the number of files matching a single-`*` glob. */
function matchingFileCount(rootDir, pattern) {
  if (!pattern.includes("*")) return existsSync(join(rootDir, pattern)) ? 1 : 0;
  const dir = join(rootDir, dirname(pattern));
  if (!existsSync(dir)) return 0;
  const escaped = basename(pattern)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\*/g, "[^/]*");
  const matcher = new RegExp(`^${escaped}$`);
  return readdirSync(dir).filter((name) => matcher.test(name)).length;
}

/** Sites per allowlisted directory, sites outside the allowlist, enforced-file counts. */
export function measureNonNullAssertions(rootDir = process.cwd()) {
  const report = runBiomeJson(rootDir, [
    "lint",
    "--only=style/noNonNullAssertion",
    `--max-diagnostics=${NON_NULL_DIAGNOSTIC_LIMIT}`,
    "--reporter=json",
    ".",
  ]);
  const { allowlisted, enforced } = loadNonNullPolicy(rootDir);
  const expected = report.summary.errors + report.summary.warnings;
  if (report.diagnostics.length !== expected) {
    throw new Error(
      `non-null assertion measurement truncated: ${report.diagnostics.length} of ${expected} diagnostics reported — raise NON_NULL_DIAGNOSTIC_LIMIT`,
    );
  }
  const dirs = allowlisted
    .map((glob) => ({ key: glob.replace(/\/\*\*$/, ""), prefix: `${glob.replace(/\/\*\*$/, "")}/` }))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  const byPath = Object.fromEntries(dirs.map((dir) => [dir.key, 0]));
  const outside = [];
  for (const diagnostic of report.diagnostics) {
    const path = diagnostic.location.path;
    const match = dirs.find((dir) => path.startsWith(dir.prefix));
    if (match) byPath[match.key] += 1;
    else outside.push(path);
  }
  return {
    total: expected,
    byPath,
    outside,
    enforced: enforced.map((pattern) => ({
      pattern,
      files: matchingFileCount(rootDir, pattern),
      sites: report.diagnostics.filter((diagnostic) => diagnostic.location.path === pattern).length,
    })),
  };
}

/** Pure comparison so every failure mode is unit-testable without re-running biome. */
export function evaluateNonNullBudget({ budget, measured }) {
  const checks = [];
  const recorded = budget.byPath ?? {};
  for (const [dir, sites] of Object.entries(measured.byPath)) {
    const ceiling = recorded[dir];
    if (ceiling === undefined) {
      checks.push({ ok: false, message: `${dir}: allowlisted in biome.json but missing from budgets.json nonNullAssertions.byPath` });
      continue;
    }
    checks.push({ ok: sites <= ceiling, message: `${dir}: measured ${sites} non-null assertion(s) vs recorded ${ceiling}` });
    checks.push({ ok: sites > 0, message: `${dir}: no sites left — drop the biome.json allowlist entry and the budget row` });
  }
  for (const dir of Object.keys(recorded)) {
    checks.push({ ok: dir in measured.byPath, message: `budgets.json records ${dir} but biome.json does not allowlist it` });
  }
  checks.push({ ok: measured.total <= budget.ceiling, message: `total: measured ${measured.total} vs ceiling ${budget.ceiling}` });
  checks.push({
    ok: measured.outside.length === 0,
    message: `${measured.outside.length} non-null assertion site(s) outside the allowlist: ${[...new Set(measured.outside)].slice(0, 5).join(", ")}`,
  });
  for (const entry of measured.enforced) {
    checks.push({ ok: entry.files > 0, message: `${entry.pattern}: no file matches this enforced path — fix the biome.json override` });
    checks.push({
      ok: entry.sites === 0,
      message: `${entry.pattern}: ${entry.sites} non-null assertion(s) in a path that must stay clean`,
    });
  }
  return checks;
}
