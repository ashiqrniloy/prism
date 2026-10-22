#!/usr/bin/env bun
/**
 * Warm-cache lifecycle replay matrix (plan 188.6 Task 6). Every arm is replayed twice against one
 * shared extractor cache: the second pass must make zero model calls and reproduce the first metrics.
 * Source-level historical mechanisms need the `variants.mjs` preload, so each arm runs as its own
 * child process and the cache dir is shared across children.
 */
import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { replayLedgers } from "./lifecycle/replay.mjs";
import { synthLedgers } from "./lifecycle/synth.mjs";
import { VARIANT_PATHS, variantProvenance } from "./variants.mjs";

const CACHE = resolve(".cache/memory-bench/replay-matrix/extractor");
const OUT = resolve("docs/_evidence/memory-bench/task6/replays-v2.json");
const WARM_BOUND_MS = 60_000;
const DELIVERY = /^fabric\.(inject|directory|core|cues)/;
const TOOL_PATH = /^(om\.|fabric\.(multiQuery|snippetBudget|keyWeight|crossSourceDedup))/;

export function replayMatrixArms() {
  const policy = { promote: {} };
  const arms = [{ id: "baseline", policy, sourceVariants: [], replayVariants: [] }];
  for (const spec of Object.keys(VARIANT_PATHS))
    arms.push({ id: spec.replace(/[.=]/g, "-"), policy, sourceVariants: [spec], replayVariants: [] });
  for (const spec of ["lifecycle.scope=flat"])
    arms.push({ id: spec.replace(/[.=]/g, "-"), policy, sourceVariants: [], replayVariants: [spec] });
  for (const setting of ["core", "cues"])
    arms.push({ id: `${setting}-off`, policy: { ...policy, [setting]: false }, sourceVariants: [], replayVariants: [] });
  for (const notes of [2, 5, 10, 20, 50, 100, 200, 500])
    arms.push({
      id: `capacity-${notes}`,
      policy: { ...policy, lifecycle: { capacity: Object.fromEntries(["user", "agent", "project"].map((scope) => [scope, { notes }])) } },
      sourceVariants: [],
      replayVariants: [],
    });
  const ids = new Set();
  for (const arm of arms) {
    if (ids.has(arm.id)) throw new Error(`replay matrix duplicate arm ${arm.id}`);
    ids.add(arm.id);
    if (arm.replayVariants.includes("lifecycle.scope=flat"))
      arm.exercise = "Replay maps every persona project onto one flat resource; this measures the flat-scope policy, not a live prompt.";
    else if (arm.sourceVariants.some((spec) => TOOL_PATH.test(spec)))
      arm.exercise =
        "Source transformation is recorded, but replay uses no OM workers, tool-driven recall, SQLite FTS or draft delivery; unchanged replay metrics cannot establish mechanism value.";
    else if (arm.sourceVariants.some((spec) => DELIVERY.test(spec)))
      arm.exercise =
        "Delivery rendering is not invoked by offline replay; this policy arm cannot measure prompt cost or live task success.";
  }
  return arms;
}

const MECHANISM_METRICS = ["promotionPrecision", "promotionRecall", "archiveRegret", "graveyardIndex", "scopeAccuracy"];

/**
 * Offline replay can transform source without exercising a tool/delivery path. Such an arm is
 * "unexercised", never live evidence; an unchanged mechanism arm is "insensitive", not a win.
 */
export function classifyMechanism({ arm, baselineMetrics, metrics }) {
  const changedMetrics = MECHANISM_METRICS.filter((key) => metrics?.[key] !== baselineMetrics?.[key]);
  if (arm.id === "baseline") return { id: arm.id, status: "baseline", changedMetrics: [] };
  if (arm.exercise) return { id: arm.id, status: "unexercised", exercise: arm.exercise, changedMetrics };
  if (!arm.sourceVariants?.length && !arm.replayVariants?.length) return { id: arm.id, status: "policy", changedMetrics };
  return { id: arm.id, status: changedMetrics.length ? "exercised" : "insensitive", changedMetrics };
}

function metricsOf(arm) {
  const { promotionPrecision: precision, promotionRecall: recall, archiveRegret: regret, graveyardIndex: graveyard } = arm.metrics;
  return { precision, recall, regret, graveyard };
}

export async function replayMatrixArm(arm, { cache = CACHE } = {}) {
  const options = {
    ledgers: synthLedgers({ seed: 7, personas: 4, projects: 3, sessions: 8 }),
    offline: true,
    cache,
    policy: arm.policy,
    variants: [...arm.sourceVariants, ...arm.replayVariants],
  };
  const initial = await replayLedgers(options);
  const start = performance.now();
  const warm = await replayLedgers(options);
  const elapsedMs = performance.now() - start;
  if (warm.status !== "completed") throw new Error(`arm ${arm.id} warm replay ${warm.status}`);
  if (warm.calls.extractor !== 0) throw new Error(`arm ${arm.id} warm replay made ${warm.calls.extractor} extractor calls`);
  if (JSON.stringify(warm.metrics) !== JSON.stringify(initial.metrics)) throw new Error(`arm ${arm.id} warm metrics differ`);
  return {
    ...arm,
    policyHash: warm.policyHash,
    variantProvenance: await variantProvenance(arm.sourceVariants),
    status: warm.status,
    calls: warm.calls,
    initialCalls: initial.calls,
    elapsedMs,
    counts: warm.counts,
    metrics: warm.metrics,
    limitations: warm.limitations,
    ledgerHashes: warm.ledgerHashes,
  };
}

async function main() {
  const armIndex = process.argv.indexOf("--arm");
  if (armIndex !== -1) {
    const arm = await replayMatrixArm(JSON.parse(process.argv[armIndex + 1]));
    process.stdout.write(`${JSON.stringify(arm)}\n`);
    return;
  }
  if (process.argv.includes("--clean")) await rm(CACHE, { recursive: true, force: true });
  await mkdir(CACHE, { recursive: true, mode: 0o700 });
  const arms = [];
  for (const arm of replayMatrixArms()) {
    const env = { ...process.env };
    delete env.PRISM_MEMORY_BENCH_VARIANTS;
    if (arm.sourceVariants.length) env.PRISM_MEMORY_BENCH_VARIANTS = JSON.stringify(arm.sourceVariants);
    const args = [
      ...(arm.sourceVariants.length ? ["--preload", resolve("scripts/memory-bench/variants.mjs")] : []),
      resolve("scripts/memory-bench/replay-matrix.mjs"),
      "--arm",
      JSON.stringify(arm),
    ];
    const result = spawnSync("bun", args, { env, encoding: "utf8", timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`${arm.id}: ${result.stderr}`);
    const report = JSON.parse(result.stdout);
    if (report.elapsedMs > WARM_BOUND_MS) throw new Error(`${arm.id} warm replay exceeded ${WARM_BOUND_MS} ms`);
    arms.push(report);
    console.log(`${arm.id} ${report.elapsedMs.toFixed(0)}ms ${JSON.stringify(metricsOf(report))}`);
  }
  const baselineMetrics = arms[0].metrics;
  for (const arm of arms) arm.mechanism = classifyMechanism({ arm, baselineMetrics, metrics: arm.metrics });
  const ledgerHashes = arms[0].ledgerHashes;
  if (arms.some((arm) => JSON.stringify(arm.ledgerHashes) !== JSON.stringify(ledgerHashes))) throw new Error("arm ledgers differ");
  for (const arm of arms) delete arm.ledgerHashes;
  const evidence = {
    schemaVersion: 1,
    provenance: "synthetic-construction",
    provisional: true,
    seed: 7,
    personas: 4,
    projects: 3,
    sessionsPerProject: 8,
    ledgerHashes,
    mechanismExercise: arms.map(({ id, mechanism }) => ({ id, ...mechanism })),
    cacheProtocol:
      "First then warm replay of every arm in one shared extractor cache; initial calls can hit preceding arm cache. Every warm run asserts extractor calls=0 and exact equality of initial/warm metrics.",
    limitations: [
      "No live calls or human-audited gold. Construction component metrics do not establish task-success or production-default superiority.",
      "Delivery, OM and tool-only variants may transform source without exercising that path; per-arm exercise notes identify these limits.",
      "Capacity sweep varies per-scope note limits while retaining shipped token limits; protected notes can exceed capacity.",
    ],
    arms,
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`${arms.length} arms; warm extractor calls ${arms.reduce((sum, arm) => sum + arm.calls.extractor, 0)}; ${OUT}`);
}

if (import.meta.main) await main();
