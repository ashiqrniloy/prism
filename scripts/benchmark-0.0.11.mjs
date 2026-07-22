#!/usr/bin/env node
/**
 * Release 0.0.11 reproducible session-search + context-budget benchmark.
 * Default mode is network-free (memory SessionStore + assembleProviderInput).
 * Evidence fields only — never a flaky default CI timing gate.
 */
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const iterations = Number(process.env.PRISM_BENCH_ITERATIONS ?? 100);
if (!Number.isInteger(iterations) || iterations < 10 || iterations > 100_000) {
  throw new Error("PRISM_BENCH_ITERATIONS must be 10..100000");
}

const REQUIRED_RESULT_FIELDS = Object.freeze([
  "scenario",
  "mode",
  "iterations",
  "throughputPerSecond",
  "p50Ms",
  "p95Ms",
  "memoryBytes",
  "diskBytes",
  "processCount",
  "estimatedCostUsd",
  "backpressureSignals",
  "resourceLimitSignals",
]);

const percentile = (values, ratio) =>
  [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * ratio) - 1)];

const results = [];

function assertResultSchema(row) {
  for (const field of REQUIRED_RESULT_FIELDS) {
    if (!(field in row)) throw new Error(`benchmark result missing field: ${field}`);
  }
  if (!Number.isFinite(row.throughputPerSecond) || row.throughputPerSecond < 0) {
    throw new Error(`invalid throughput for ${row.scenario}`);
  }
  if (!Number.isFinite(row.p50Ms) || !Number.isFinite(row.p95Ms)) {
    throw new Error(`invalid latency for ${row.scenario}`);
  }
}

async function measure(scenario, mode, operation, details = {}) {
  const latencies = [];
  const started = performance.now();
  let resourceLimitSignals = details.resourceLimitSignals ?? 0;
  for (let index = 0; index < iterations; index += 1) {
    const before = performance.now();
    const signal = await operation(index);
    if (signal === "limit") resourceLimitSignals += 1;
    latencies.push(performance.now() - before);
  }
  const durationMs = performance.now() - started;
  const row = {
    scenario,
    mode,
    iterations,
    throughputPerSecond: Number((iterations / (durationMs / 1000)).toFixed(2)),
    p50Ms: Number(percentile(latencies, 0.5).toFixed(4)),
    p95Ms: Number(percentile(latencies, 0.95).toFixed(4)),
    memoryBytes: process.memoryUsage().heapUsed,
    diskBytes: details.diskBytes ?? 0,
    processCount: details.processCount ?? 1,
    estimatedCostUsd: 0,
    backpressureSignals: details.backpressureSignals ?? 0,
    resourceLimitSignals,
  };
  assertResultSchema(row);
  results.push(row);
}

async function importWorkspace(specifier, relativeFromRoot) {
  try {
    return await import(specifier);
  } catch {
    return import(pathToFileURL(join(process.cwd(), relativeFromRoot)).href);
  }
}

const core = await importWorkspace("@arnilo/prism", "dist/index.js");
const {
  createMemorySessionStore,
  createSessionEntry,
  assembleProviderInput,
  estimateTextTokens,
  getContextBudgetReport,
  SESSION_SEARCH_WORKSPACE_METADATA_KEY,
} = core;

const seedCount = 200;
const store = createMemorySessionStore();
for (let i = 0; i < seedCount; i += 1) {
  const sessionId = `s-${i}`;
  await store.append(createSessionEntry({
    id: `e-${i}`,
    sessionId,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    kind: "message",
    label: i % 17 === 0 ? "auth-flake" : `noise-${i}`,
    summary: i % 17 === 0 ? "flaky login" : `summary-${i}`,
    message: {
      role: "user",
      content: [{ type: "text", text: i % 17 === 0 ? "auth flake detail" : `body-${i}` }],
    },
    metadata: { [SESSION_SEARCH_WORKSPACE_METADATA_KEY]: "/ws" },
  }));
}

await measure("memory-linear-search-label", "memory-linear", async () => {
  const page = await store.searchSessions({ label: "auth-flake", limit: 20 });
  if (!page.items.length) throw new Error("expected search hits");
});

await measure("memory-linear-search-query", "memory-linear", async () => {
  const page = await store.searchSessions({
    workspaceRoot: "/ws",
    query: "auth flake",
    limit: 20,
  });
  if (!page.items.length) throw new Error("expected query hits");
});

const history = [];
for (let i = 0; i < 40; i += 1) {
  history.push({
    id: `h-${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    content: [{ type: "text", text: `history-${i}-${"x".repeat(80)}` }],
  });
}
const model = { provider: "bench", model: "bench-model" };
const budgetTokens = estimateTextTokens("System instruction:\nBe brief.")
  + estimateTextTokens("current question")
  + 200;

await measure("context-budget-evict", "assembler", async () => {
  const request = await assembleProviderInput({
    model,
    input: "current question",
    systemInstructions: "Be brief.",
    history,
    contextBudget: { maxInputTokens: budgetTokens, reportOmissions: true },
  });
  const report = getContextBudgetReport(request);
  if (!report || report.omitted.length === 0) return "limit";
});

await measure("context-budget-fit", "assembler", async () => {
  const request = await assembleProviderInput({
    model,
    input: "current question",
    systemInstructions: "Be brief.",
    history: history.slice(0, 2),
    contextBudget: { maxInputTokens: 50_000, reportOmissions: true },
  });
  const report = getContextBudgetReport(request);
  if (!report) throw new Error("missing budget report");
});

const report = {
  generatedAt: new Date().toISOString(),
  release: "0.0.11",
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    network: false,
    credentials: false,
  },
  schema: { requiredResultFields: REQUIRED_RESULT_FIELDS },
  results,
};
for (const row of results) assertResultSchema(row);
console.log(JSON.stringify(report, null, 2));
