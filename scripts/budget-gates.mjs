import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

export const budgetFile = join(new URL(".", import.meta.url).pathname, "budgets.json");
