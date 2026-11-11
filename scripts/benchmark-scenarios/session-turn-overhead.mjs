#!/usr/bin/env node
/**
 * Plan 210 Task 0.1: session turn-overhead scenario (hot-path baseline).
 *
 * One session runs RUNS runs on a network-free scripted provider. Each run is two provider turns
 * plus one tool call: turn 1 asks for `fetch_record`, the tool returns a ~2 KB result, and turn 2
 * replies with ~2 KB of text. The same workload runs once over `createMemorySessionStore` and once
 * over the SQLite session store (`@arnilo/prism-extensions/store-sqlite`, temp file).
 *
 * Per variant it reports per-run p50/p95, first-window and last-window p50s, `growthRatio`
 * (last-window p50 / first-window p50, same-process so it travels across machines), and
 * `storeEntriesReadPerRun`: entries returned by `readBranchPath`, `list` and `get`, counted by a
 * wrapping store after a warm-up. That counter is the deterministic O(history) signal.
 *
 * `PRISM_BENCH_RUNS` overrides the run count for both stores (the gate runs a reduced count). No
 * message text is reported. Usage: bun scripts/benchmark.mjs --scenario session-turn-overhead
 */
import { mkdtempSync, rmSync } from "node:fs";
import { cpus, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { createSqlitePersistence } from "@arnilo/prism-extensions/store-sqlite";
import { createAgent, createMemorySessionStore, providerDone, providerTextDelta, providerToolCall } from "../../src/index.ts";
import { providerPackage } from "../../src/provider-kit/index.ts";
import { loadBudgets } from "../budget-gates.mjs";

const fixture = loadBudgets().sessionTurnOverhead.fixture;
export const RUNS = Number(process.env.PRISM_BENCH_RUNS ?? fixture.runs);
export const WINDOW = fixture.window;
export const WARMUP_RUNS = fixture.warmupRuns;
/** `PRISM_BENCH_VARIANTS=memory` (or `sqlite`) runs one store, for a per-workload CPU profile. */
const VARIANTS = (process.env.PRISM_BENCH_VARIANTS ?? "memory,sqlite").split(",").map((name) => name.trim());
export const PAYLOAD_BYTES = fixture.payloadBytes;

const TOOL_NAME = "fetch_record";

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function payload(seed) {
  const unit = `record ${seed} field value lorem ipsum dolor sit amet `;
  return unit.repeat(Math.ceil(PAYLOAD_BYTES / unit.length)).slice(0, PAYLOAD_BYTES);
}

/** Turn 1 of a run asks for the tool; the turn after a tool result replies with ~2 KB of text. */
function createScriptedProvider(stats) {
  return {
    id: "mock",
    async *generate(request) {
      stats.turns += 1;
      const last = request.messages.at(-1);
      if (last?.role === "tool") {
        yield providerTextDelta(payload(`reply-${stats.turns}`));
      } else {
        yield providerToolCall({ type: "tool_call", id: `call-${stats.turns}`, name: TOOL_NAME, arguments: { id: stats.turns } });
      }
      yield providerDone();
    },
  };
}

/** Counts entries the kernel reads back; every other store method passes through unchanged. */
function countingStore(store, counter) {
  return new Proxy(store, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      if (property === "list") {
        return async (...args) => {
          const entries = await value.apply(target, args);
          counter.list += entries.length;
          return entries;
        };
      }
      if (property === "readBranchPath") {
        return async (...args) => {
          const page = await value.apply(target, args);
          counter.readBranchPath += page.items.length;
          return page;
        };
      }
      if (property === "get") {
        return async (...args) => {
          const entry = await value.apply(target, args);
          if (entry !== undefined) counter.get += 1;
          return entry;
        };
      }
      return value.bind(target);
    },
  });
}

async function runVariant(name, baseStore, runs) {
  const counter = { list: 0, readBranchPath: 0, get: 0 };
  const stats = { turns: 0 };
  const agent = await createAgent({
    id: "session-turn-overhead",
    model: { provider: "mock", model: "demo" },
    slots: { store: countingStore(baseStore, counter) },
    // The whole branch is the prompt on every turn, so token caps would stop the run long before
    // 1,000 runs; the byte caps (maxRequestBytes / maxResponseBytes) stay at their defaults.
    limits: { maxInputTokens: null, maxTotalTokens: null },
    packages: [providerPackage("mock", [createScriptedProvider(stats)])],
    tools: {
      add: [
        {
          name: TOOL_NAME,
          description: "Returns a record",
          parameters: { type: "object", properties: { id: { type: "number" } } },
          execute: (args, context) => ({ toolCallId: context.toolCallId, name: TOOL_NAME, value: payload(`tool-${args.id}`) }),
        },
      ],
    },
  });
  const session = await agent.session();
  const durations = [];
  let readsAtWarmup = 0;
  let failedRuns = 0;
  const startedAt = performance.now();
  for (let run = 0; run < runs; run += 1) {
    if (run === WARMUP_RUNS) readsAtWarmup = counter.list + counter.readBranchPath + counter.get;
    const start = performance.now();
    const result = await session.run(`run ${run}`);
    durations.push(performance.now() - start);
    if (result.status !== "completed") failedRuns += 1;
  }
  const totalMs = performance.now() - startedAt;
  const totalReads = counter.list + counter.readBranchPath + counter.get;
  const measuredRuns = Math.max(1, runs - WARMUP_RUNS);
  const firstWindowP50 = percentile(durations.slice(0, WINDOW), 0.5);
  const lastWindowP50 = percentile(durations.slice(-WINDOW), 0.5);
  return {
    name,
    runs,
    providerTurns: stats.turns,
    failedRuns,
    totalMs: Number(totalMs.toFixed(1)),
    p50Ms: Number(percentile(durations, 0.5).toFixed(3)),
    p95Ms: Number(percentile(durations, 0.95).toFixed(3)),
    firstWindowP50Ms: Number(firstWindowP50.toFixed(3)),
    lastWindowP50Ms: Number(lastWindowP50.toFixed(3)),
    growthRatio: Number((lastWindowP50 / firstWindowP50).toFixed(3)),
    storeEntriesReadPerRun: Number(((totalReads - readsAtWarmup) / measuredRuns).toFixed(2)),
    storeReads: { ...counter },
  };
}

export async function runScenario() {
  const variants = [];
  if (VARIANTS.includes("memory")) variants.push(await runVariant("memory", createMemorySessionStore(), RUNS));
  if (VARIANTS.includes("sqlite")) {
    const dir = mkdtempSync(join(tmpdir(), "prism-session-turn-bench-"));
    const persistence = createSqlitePersistence({ filename: join(dir, "bench.db") });
    try {
      variants.push(await runVariant("sqlite", persistence, RUNS));
    } finally {
      persistence.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return {
    version: "0.13.0",
    generatedAt: new Date().toISOString(),
    environment: {
      runtime: typeof Bun === "undefined" ? `node ${process.version}` : `bun ${Bun.version}`,
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model ?? "unknown",
      memoryBytes: totalmem(),
      network: false,
      credentials: false,
    },
    fixture: {
      runs: RUNS,
      window: WINDOW,
      warmupRuns: WARMUP_RUNS,
      payloadBytes: PAYLOAD_BYTES,
      providerTurnsPerRun: 2,
      toolCallsPerRun: 1,
    },
    results: variants,
    checks: [
      { name: "every_requested_variant_ran", pass: variants.length === VARIANTS.length },
      { name: "every_run_completed", pass: variants.every((variant) => variant.failedRuns === 0) },
      { name: "two_provider_turns_per_run", pass: variants.every((variant) => variant.providerTurns === variant.runs * 2) },
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runScenario();
  for (const check of report.checks) if (!check.pass) console.error(`SCENARIO FAIL: ${check.name}`);
  console.log(JSON.stringify(report, null, 2));
  if (report.checks.some((check) => !check.pass)) process.exitCode = 1;
}
