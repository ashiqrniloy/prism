#!/usr/bin/env node
/**
 * Summarize a V8/Bun `.cpuprofile` (plan 210 Task 0.1): top self-time and inclusive-time rows by
 * function, as a share of all sampled time. Inclusive time counts a function once per sample even
 * when it recurses. Usage: bun scripts/cpu-profile-summary.mjs <file.cpuprofile> [--top 20] [--json]
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

function label(frame) {
  const name = frame.functionName || "(anonymous)";
  const file = frame.url ? basename(frame.url) : "";
  return file ? `${name} (${file}:${frame.lineNumber + 1})` : name;
}

export function summarizeProfile(profile, top = 20) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const parent = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
  const deltas = profile.timeDeltas ?? [];
  const weight = new Map();
  for (let index = 0; index < profile.samples.length; index += 1) {
    const id = profile.samples[index];
    weight.set(id, (weight.get(id) ?? 0) + Math.max(0, deltas[index] ?? 0));
  }
  const self = new Map();
  const inclusive = new Map();
  let total = 0;
  for (const [id, microseconds] of weight) {
    const node = byId.get(id);
    if (!node) continue;
    const name = label(node.callFrame);
    if (name === "(idle)" || name === "(program)") continue;
    total += microseconds;
    self.set(name, (self.get(name) ?? 0) + microseconds);
    const seen = new Set();
    for (let cursor = id; cursor !== undefined; cursor = parent.get(cursor)) {
      const ancestor = label(byId.get(cursor).callFrame);
      if (seen.has(ancestor)) continue;
      seen.add(ancestor);
      inclusive.set(ancestor, (inclusive.get(ancestor) ?? 0) + microseconds);
    }
  }
  const rows = (map) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, top)
      .map(([name, microseconds]) => ({
        name,
        ms: Number((microseconds / 1000).toFixed(1)),
        pct: Number(((100 * microseconds) / total).toFixed(1)),
      }));
  return { sampledMs: Number((total / 1000).toFixed(1)), self: rows(self), inclusive: rows(inclusive) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const file = args.find((arg) => !arg.startsWith("--") && args[args.indexOf(arg) - 1] !== "--top");
  if (!file) {
    console.error("usage: bun scripts/cpu-profile-summary.mjs <file.cpuprofile> [--top 20] [--json]");
    process.exit(1);
  }
  const topIndex = args.indexOf("--top");
  const top = topIndex === -1 ? 20 : Number(args[topIndex + 1]);
  const summary = summarizeProfile(JSON.parse(readFileSync(file, "utf8")), top);
  if (args.includes("--json")) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`sampled ${summary.sampledMs} ms`);
    for (const kind of ["self", "inclusive"]) {
      console.log(`\n${kind}:`);
      for (const row of summary[kind]) console.log(`${String(row.pct).padStart(6)}%  ${String(row.ms).padStart(9)} ms  ${row.name}`);
    }
  }
}
