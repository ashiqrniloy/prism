// scripts/phase16-tree-shake.mjs — zero-dep tree-shake measurement (plan 016 Task 3, 0.1.4).
// Records the post-split dist snapshot (dist/agents.js + dist/contracts.js byte sizes,
// dist/*.js and dist/*.d.ts module counts, static-import reachability from the minimal
// entry proxy) into the treeShake block of scripts/phase16-baseline.json and compares it
// against the Task 0 pre-split splitBaseline block. Stat + one regex scan over dist/*.js:
// no network, no bundler, <5s.
//
// # ponytail: static import-graph reachability is an upper-bound proxy — a real bundler
// # with actual consumer code is the true measure. The reachability numbers are reported,
// # not gated. Upgrade to an esbuild-bundled smoke import behind a 0.1.7 DX demand gate
// # if a host wants a byte-accurate tree-shake budget.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, normalize, relative } from "node:path";

const distDir = new URL("../dist/", import.meta.url).pathname;
const outPath = process.argv[2] ?? new URL("./phase16-baseline.json", import.meta.url).pathname;

const jsFiles = readdirSync(distDir).filter((f) => f.endsWith(".js"));
const dtsFiles = readdirSync(distDir).filter((f) => f.endsWith(".d.ts"));

// Relative import/export specifiers per module: import x from "./y.js", import "./y.js",
// export * from "./y.js", export { a } from "./y.js", import("./y.js").
const importRe = /\b(?:import|export)\b(?:[^"']*?\bfrom\s*)?["'](\.[^"']+)["']/g;

function moduleTargets(file) {
  const text = readFileSync(join(distDir, file), "utf8");
  const targets = new Set();
  for (const match of text.matchAll(importRe)) {
    const resolved = normalize(join(relative(distDir, distDir), file, "..", match[1])).replace(/\\/g, "/");
    // keep only targets that land inside dist/*.js (bare specifiers and non-js are ignored)
    if (!resolved.startsWith("../") && resolved.endsWith(".js") && jsFiles.includes(resolved)) targets.add(resolved);
  }
  return targets;
}

const graph = new Map(jsFiles.map((f) => [f, moduleTargets(f)]));

function reachableFrom(entry) {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length) {
    for (const target of graph.get(queue.shift()) ?? []) {
      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return seen.size;
}

const agentsJsBytes = statSync(join(distDir, "agents.js")).size;
const contractsJsBytes = statSync(join(distDir, "contracts.js")).size;
const reachableFromAgentsJs = reachableFrom("agents.js");
const reachableFromContractsJs = reachableFrom("contracts.js");

const baseline = JSON.parse(readFileSync(outPath, "utf8"));
const pre = baseline.splitBaseline ?? {};
const treeShake = {
  // ponytail: date stamp refreshed only under PRISM_PHASE16_RECORD_EVIDENCE=1 (phase12 restart-recovery convention);
  // a bare audit run must never rewrite the tracked baseline.
  measured:
    process.env.PRISM_PHASE16_RECORD_EVIDENCE === "1"
      ? new Date().toISOString().slice(0, 10)
      : (baseline.treeShake?.measured ?? new Date().toISOString().slice(0, 10)),
  agentsJsBytes,
  contractsJsBytes,
  distJsCount: jsFiles.length,
  distDtsCount: dtsFiles.length,
  reachableFromAgentsJs,
  reachableFromContractsJs,
  agentsJsShrunk: pre.distAgentsJsBytes !== undefined ? agentsJsBytes < pre.distAgentsJsBytes : undefined,
  contractsJsShrunk: pre.distContractsJsBytes !== undefined ? contractsJsBytes < pre.distContractsJsBytes : undefined,
  moduleCountRose: pre.distJsCount !== undefined ? jsFiles.length > pre.distJsCount : undefined,
  reachabilityNoWorse: pre.reachableFromAgentsJs !== undefined ? reachableFromAgentsJs <= pre.reachableFromAgentsJs : undefined,
};
baseline.treeShake = treeShake;
writeFileSync(outPath, `${JSON.stringify(baseline, null, 2)}\n`);

console.log(`dist/agents.js        ${agentsJsBytes} bytes (pre-split ${pre.distAgentsJsBytes ?? "n/a"})`);
console.log(`dist/contracts.js     ${contractsJsBytes} bytes (pre-split ${pre.distContractsJsBytes ?? "n/a"})`);
console.log(`dist modules          ${jsFiles.length} js / ${dtsFiles.length} d.ts (pre-split ${pre.distJsCount ?? "n/a"} js)`);
console.log(`reachable from agents.js:   ${reachableFromAgentsJs} (pre-split ${pre.reachableFromAgentsJs ?? "n/a"})`);
console.log(`reachable from contracts.js: ${reachableFromContractsJs} (pre-split ${pre.reachableFromContractsJs ?? "n/a"})`);
console.log(`treeShake block written to ${outPath}`);
