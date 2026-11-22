#!/usr/bin/env bun
/**
 * Plan 239 Task 7: long-run soak benchmark.
 *
 * Drives one agent on a scripted mock provider through `runs` runs of `turns` turns each on a single
 * session (default: 200 runs × 50 turns = 10,000 turns, one tool call per tool round), with the default
 * compactor active.
 *
 * Budgeted leg: `@arnilo/prism-extensions/store-sqlite` (has `readBranchPath({ from: "compaction" })`).
 * Comparison leg: `@arnilo/prism-extensions/store-jsonl` (no tail read; caches entries in memory), run
 * at a smaller run count to report its linear growth alongside SQLite's flat curve.
 *
 * Usage:
 *   bun scripts/benchmark-long-job.mjs --runs 200 --turns 50 --out docs/_evidence/long-run-soak.md
 *   bun scripts/benchmark-long-job.mjs --runs 40 --turns 50 --jsonl-runs 0
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { createJsonlSessionStore } from "@arnilo/prism-extensions/store-jsonl";
import { createSqlitePersistence } from "@arnilo/prism-extensions/store-sqlite";
import { createAgent, providerDone, providerTextDelta, providerToolCall } from "../src/index.ts";
import { providerPackage } from "../src/provider-kit/index.ts";
import { countingStore, payload, percentile } from "./benchmark-scenarios/session-turn-overhead.mjs";
import { loadBudgets } from "./budget-gates.mjs";

const TOOL_NAME = "fetch_record";

function forceGc() {
  if (typeof Bun !== "undefined" && typeof Bun.gc === "function") {
    Bun.gc(true);
    Bun.gc(true);
  } else if (typeof globalThis.gc === "function") {
    globalThis.gc();
    globalThis.gc();
  }
}

function heapUsedBytes() {
  forceGc();
  return process.memoryUsage().heapUsed;
}

function parseArgs(argv) {
  const budgets = loadBudgets().longRun;
  const options = {
    runs: budgets.fixture.runs,
    turns: budgets.fixture.turns,
    jsonlRuns: budgets.fixture.jsonlRuns,
    payloadBytes: budgets.fixture.payloadBytes,
    contextWindow: budgets.fixture.contextWindow,
    out: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--runs" && next) {
      options.runs = Number(next);
      i += 1;
    } else if (arg === "--turns" && next) {
      options.turns = Number(next);
      i += 1;
    } else if (arg === "--jsonl-runs" && next) {
      options.jsonlRuns = Number(next);
      i += 1;
    } else if (arg === "--payload-bytes" && next) {
      options.payloadBytes = Number(next);
      i += 1;
    } else if (arg === "--context-window" && next) {
      options.contextWindow = Number(next);
      i += 1;
    } else if (arg === "--out" && next) {
      options.out = next;
      i += 1;
    }
  }
  return options;
}

/**
 * Warms up JSC JIT tiers, SQLite statements, and compaction paths on a disposable session before taking
 * heap/timing baselines, so the short gate run measures session retention rather than initial compilation.
 */
async function warmupRuntime(turnsPerRun, payloadBytes, contextWindow) {
  let turns = 0;
  const provider = {
    id: "mock",
    async *generate() {
      const turnInRun = (turns % turnsPerRun) + 1;
      turns += 1;
      if (turnInRun < turnsPerRun) {
        yield providerToolCall({ type: "tool_call", id: `warm-${turns}`, name: TOOL_NAME, arguments: { id: turns } });
      } else {
        yield providerTextDelta(payload(`warm-${turns}`, payloadBytes));
      }
      yield providerDone();
    },
  };
  const dir = mkdtempSync(join(tmpdir(), "prism-long-job-warm-"));
  const store = createSqlitePersistence({ filename: join(dir, "warm.db") });
  try {
    const agent = await createAgent({
      id: "long-job-warmup",
      model: { provider: "mock", model: "demo", limits: { contextWindow, maxOutputTokens: 1_024 } },
      slots: { store },
      limits: { maxTurns: null, maxToolCalls: null, maxInputTokens: null, maxTotalTokens: null, maxWallTimeMs: null },
      packages: [providerPackage("mock", [provider])],
      tools: {
        add: [
          {
            name: TOOL_NAME,
            description: "Warmup tool",
            parameters: { type: "object", properties: { id: { type: "number" } } },
            execute: (args, context) => ({
              toolCallId: context.toolCallId,
              name: TOOL_NAME,
              value: payload(`warm-tool-${args.id}`, payloadBytes),
            }),
          },
        ],
      },
    });
    const session = await agent.session({ id: "warmup", create: true });
    for (let i = 0; i < 25; i += 1) await session.run(`warm ${i}`);
    await session.close();
    await agent.dispose();
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
  forceGc();
}

/**
 * Runs `runs` × `turns` turns on one session. Each run performs `turns - 1` tool calls (one per turn)
 * followed by one final text response on the `turns`-th turn.
 */
async function runSoakLeg(name, baseStore, { runs, turns, payloadBytes, contextWindow }) {
  const counter = { list: 0, readBranchPath: 0, get: 0 };
  const turnDurationsMs = [];
  let totalTurns = 0;
  let totalToolCalls = 0;
  let compactions = 0;
  let failedRuns = 0;
  let stepStartMs = 0;

  const provider = {
    id: "mock",
    async *generate() {
      const turnInRun = (totalTurns % turns) + 1;
      totalTurns += 1;
      if (turnInRun < turns) {
        yield providerToolCall({
          type: "tool_call",
          id: `call-${totalTurns}`,
          name: TOOL_NAME,
          arguments: { id: totalTurns },
        });
      } else {
        yield providerTextDelta(payload(`reply-${totalTurns}`, payloadBytes));
      }
      yield providerDone();
    },
  };

  const agent = await createAgent({
    id: `long-job-${name}`,
    model: { provider: "mock", model: "demo", limits: { contextWindow, maxOutputTokens: 1_024 } },
    slots: { store: countingStore(baseStore, counter) },
    limits: {
      maxTurns: null,
      maxToolCalls: null,
      maxInputTokens: null,
      maxTotalTokens: null,
      maxWallTimeMs: null,
    },
    packages: [providerPackage("mock", [provider])],
    hooks: (hooks) => {
      hooks.on("turn.completed", () => {
        const now = performance.now();
        turnDurationsMs.push(now - stepStartMs);
        stepStartMs = now;
      });
      hooks.on("compaction.completed", (event) => {
        if (!event.error) compactions += 1;
      });
    },
    tools: {
      add: [
        {
          name: TOOL_NAME,
          description: "Returns a synthetic record",
          parameters: { type: "object", properties: { id: { type: "number" } } },
          execute: (args, context) => {
            totalToolCalls += 1;
            return { toolCallId: context.toolCallId, name: TOOL_NAME, value: payload(`tool-${args.id}`, payloadBytes) };
          },
        },
      ],
    },
  });

  const session = await agent.session({ id: `soak-${name}`, create: true });
  const baselineRun = runs >= 200 ? 50 : Math.max(1, Math.floor(runs * 0.5));
  const midRun = Math.max(baselineRun + 1, Math.floor(runs * 0.7));
  const warmupRun = Math.max(1, Math.floor(runs * 0.1));

  let readsAtWarmup = 0;
  let readsAtMid = 0;
  let heapAtBaselineBytes = 0;
  let heapAtEndBytes = 0;

  const startedAt = performance.now();
  for (let run = 1; run <= runs; run += 1) {
    stepStartMs = performance.now();
    const result = await session.run(`run ${run}`);
    if (result.status !== "completed") failedRuns += 1;
    if (run === warmupRun) readsAtWarmup = counter.list + counter.readBranchPath + counter.get;
    if (run === midRun) readsAtMid = counter.list + counter.readBranchPath + counter.get;
    if (run === baselineRun) heapAtBaselineBytes = heapUsedBytes();
  }
  heapAtEndBytes = heapUsedBytes();
  const totalMs = performance.now() - startedAt;
  const totalReads = counter.list + counter.readBranchPath + counter.get;

  // Measure median per-turn duration around turn 100 (turns 50..299) vs the final 20% of turns.
  const earlyStart = Math.min(50, Math.max(0, turnDurationsMs.length - 100));
  const earlyEnd = Math.min(turnDurationsMs.length, earlyStart + 250);
  const lateCount = Math.max(100, Math.floor(turnDurationsMs.length * 0.2));
  const earlyWindow = turnDurationsMs.slice(earlyStart, earlyEnd);
  const lateWindow = turnDurationsMs.slice(-lateCount);

  const turn100MedianMs = percentile(earlyWindow, 0.5);
  const endTurnMedianMs = percentile(lateWindow, 0.5);
  const turnOverheadRatio = turn100MedianMs > 0 ? endTurnMedianMs / turn100MedianMs : 1;
  const heapGrowthRatio = heapAtBaselineBytes > 0 ? heapAtEndBytes / heapAtBaselineBytes : 1;

  const earlyTurns = Math.max(1, (midRun - warmupRun) * turns);
  const lateTurns = Math.max(1, (runs - midRun) * turns);
  const measuredTurns = Math.max(1, (runs - warmupRun) * turns);
  const earlyReadsPerTurn = (readsAtMid - readsAtWarmup) / earlyTurns;
  const lateReadsPerTurn = (totalReads - readsAtMid) / lateTurns;
  const storeEntriesReadPerTurn = (totalReads - readsAtWarmup) / measuredTurns;
  const storeReadGrowthRatio = earlyReadsPerTurn > 0 ? lateReadsPerTurn / earlyReadsPerTurn : 1;

  await session.close();
  await agent.dispose();

  return {
    name,
    runs,
    turnsPerRun: turns,
    totalTurns,
    totalToolCalls,
    compactions,
    failedRuns,
    totalMs: Number(totalMs.toFixed(1)),
    turn100MedianMs: Number(turn100MedianMs.toFixed(4)),
    endTurnMedianMs: Number(endTurnMedianMs.toFixed(4)),
    turnOverheadRatio: Number(turnOverheadRatio.toFixed(3)),
    baselineRun,
    heapAtBaselineBytes,
    heapAtEndBytes,
    heapGrowthRatio: Number(heapGrowthRatio.toFixed(4)),
    heapGrowthPct: Number(((heapGrowthRatio - 1) * 100).toFixed(2)),
    storeEntriesReadPerTurn: Number(storeEntriesReadPerTurn.toFixed(3)),
    earlyReadsPerTurn: Number(earlyReadsPerTurn.toFixed(3)),
    lateReadsPerTurn: Number(lateReadsPerTurn.toFixed(3)),
    storeReadGrowthRatio: Number(storeReadGrowthRatio.toFixed(3)),
    storeReads: { ...counter },
  };
}

export async function runLongJobBenchmark(rawOptions = {}) {
  const budgets = loadBudgets().longRun;
  const runs = rawOptions.runs ?? budgets.fixture.runs;
  const turns = rawOptions.turns ?? budgets.fixture.turns;
  const jsonlRuns = rawOptions.jsonlRuns ?? budgets.fixture.jsonlRuns;
  const payloadBytes = rawOptions.payloadBytes ?? budgets.fixture.payloadBytes;
  const contextWindow = rawOptions.contextWindow ?? budgets.fixture.contextWindow;

  await warmupRuntime(turns, payloadBytes, contextWindow);

  const results = [];
  const sqliteDir = mkdtempSync(join(tmpdir(), "prism-long-job-sqlite-"));
  const persistence = createSqlitePersistence({ filename: join(sqliteDir, "soak.db") });
  try {
    results.push(await runSoakLeg("sqlite", persistence, { runs, turns, payloadBytes, contextWindow }));
  } finally {
    persistence.close();
    rmSync(sqliteDir, { recursive: true, force: true });
  }

  if (jsonlRuns > 0) {
    const jsonlDir = mkdtempSync(join(tmpdir(), "prism-long-job-jsonl-"));
    try {
      const store = createJsonlSessionStore({ dir: jsonlDir });
      results.push(await runSoakLeg("jsonl", store, { runs: jsonlRuns, turns, payloadBytes, contextWindow }));
    } finally {
      rmSync(jsonlDir, { recursive: true, force: true });
    }
  }

  const sqlite = results.find((entry) => entry.name === "sqlite");
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
    fixture: { runs, turns, totalTurns: runs * turns, jsonlRuns, payloadBytes, contextWindow },
    ceilings: budgets.ceilings,
    results,
    checks: [
      { name: "sqlite_all_runs_completed", pass: sqlite?.failedRuns === 0 },
      { name: "sqlite_compaction_exercised", pass: (sqlite?.compactions ?? 0) > 0 },
      {
        name: "sqlite_turn_overhead_within_budget",
        pass: (sqlite?.turnOverheadRatio ?? Infinity) <= budgets.ceilings.maxTurnOverheadRatio,
      },
      { name: "sqlite_heap_growth_within_budget", pass: (sqlite?.heapGrowthRatio ?? Infinity) <= budgets.ceilings.maxHeapGrowthRatio },
      {
        name: "sqlite_store_reads_per_turn_constant",
        pass: (sqlite?.storeReadGrowthRatio ?? Infinity) <= budgets.ceilings.maxStoreReadGrowthRatio,
      },
    ],
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Long-run soak evidence",
    "",
    `Generated: ${report.generatedAt}`,
    `Runtime: ${report.environment.runtime} (${report.environment.platform}/${report.environment.arch}, ${report.environment.cpu})`,
    "",
    `Workload: ${report.fixture.runs} runs × ${report.fixture.turns} turns (${report.fixture.totalTurns} total turns, one tool call per tool round), default compactor enabled (\`contextWindow: ${report.fixture.contextWindow}\`, \`payloadBytes: ${report.fixture.payloadBytes}\`).`,
    "",
    "## Results",
    "",
    "| Store | Runs × Turns | Compactions | Turn 100 median (ms) | End median (ms) | Overhead ratio | Heap baseline → end (MiB) | Heap growth | Store reads/turn (early → late) |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | --- |",
  ];
  for (const r of report.results) {
    const baseMiB = (r.heapAtBaselineBytes / (1024 * 1024)).toFixed(2);
    const endMiB = (r.heapAtEndBytes / (1024 * 1024)).toFixed(2);
    lines.push(
      `| ${r.name} | ${r.runs} × ${r.turnsPerRun} (${r.totalTurns}) | ${r.compactions} | ${r.turn100MedianMs.toFixed(4)} | ${r.endTurnMedianMs.toFixed(4)} | ${r.turnOverheadRatio.toFixed(3)}× | ${baseMiB} → ${endMiB} | ${r.heapGrowthPct >= 0 ? "+" : ""}${r.heapGrowthPct.toFixed(2)}% | ${r.storeEntriesReadPerTurn.toFixed(3)} (${r.earlyReadsPerTurn.toFixed(3)} → ${r.lateReadsPerTurn.toFixed(3)}) |`,
    );
  }
  lines.push(
    "",
    "## Notes",
    "",
    '- **SQLite (budgeted):** uses `readBranchPath({ from: "compaction" })` (tail snapshots) for both runs and compactions, keeping per-turn overhead, retained JS heap after forced GC, and store reads per turn flat across 10,000 turns.',
    `- **JSONL (comparison, ${report.fixture.jsonlRuns} runs):** has no \`readBranchPath\` and caches every session entry in memory, so store reads and retained heap grow linearly with branch length. Use SQLite or Postgres for multi-day jobs.`,
    "",
    "## Checks",
    "",
    ...report.checks.map((c) => `- [${c.pass ? "x" : " "}] \`${c.name}\``),
    "",
    "```json",
    JSON.stringify(report, null, 2),
    "```",
    "",
  );
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  const report = await runLongJobBenchmark(options);
  if (options.out) {
    mkdirSync(dirname(options.out), { recursive: true });
    const body = options.out.endsWith(".md") ? renderMarkdown(report) : `${JSON.stringify(report, null, 2)}\n`;
    writeFileSync(options.out, body, "utf8");
  }
  for (const check of report.checks) if (!check.pass) console.error(`SOAK FAIL: ${check.name}`);
  console.log(JSON.stringify(report, null, 2));
  if (report.checks.some((check) => !check.pass)) process.exitCode = 1;
}
