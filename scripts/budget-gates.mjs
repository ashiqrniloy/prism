import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

// Median cold-process import wall time over `runs` spawns.
export function measureStartupMs(cwd = process.cwd(), runs = 3) {
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const result = spawnSync(
      process.execPath,
      ["-e", "const t=process.hrtime.bigint();import('./dist/index.js').then(()=>{console.log(Number(process.hrtime.bigint()-t)/1e6)})"],
      { cwd, stdio: ["pipe", "pipe", "pipe"] },
    );
    const ms = Number(result.stdout.toString().trim());
    if (Number.isFinite(ms)) samples.push(ms);
  }
  samples.sort((a, b) => a - b);
  return samples.length ? samples[Math.floor(samples.length / 2)] : Number.NaN;
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
