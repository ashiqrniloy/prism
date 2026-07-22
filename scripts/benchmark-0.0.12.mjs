#!/usr/bin/env node
/**
 * Release 0.0.12 network-free AG-UI/ACP-adjacent and coding-compaction evidence.
 * Evidence fields only — bounds/fixtures, not timings, gate release.
 */
import { performance } from "node:perf_hooks";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const iterations = Number(process.env.PRISM_BENCH_ITERATIONS ?? 100);
if (!Number.isInteger(iterations) || iterations < 10 || iterations > 100_000) {
  throw new Error("PRISM_BENCH_ITERATIONS must be 10..100000");
}

const REQUIRED_RESULT_FIELDS = Object.freeze([
  "scenario", "mode", "iterations", "throughputPerSecond", "p50Ms", "p95Ms",
  "memoryBytes", "peakQueueEvents", "eventBytes", "diskBytes", "processCount",
  "estimatedCostUsd", "backpressureSignals", "resourceLimitSignals",
]);
const percentile = (values, ratio) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * ratio) - 1)];
const results = [];

function assertResultSchema(row) {
  for (const field of REQUIRED_RESULT_FIELDS) if (!(field in row)) throw new Error(`benchmark result missing field: ${field}`);
  for (const field of ["throughputPerSecond", "p50Ms", "p95Ms", "memoryBytes", "peakQueueEvents", "eventBytes"]) {
    if (!Number.isFinite(row[field]) || row[field] < 0) throw new Error(`invalid ${field} for ${row.scenario}`);
  }
}

async function measure(scenario, mode, operation) {
  const latencies = [];
  let peakQueueEvents = 0;
  let eventBytes = 0;
  let resourceLimitSignals = 0;
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    const before = performance.now();
    const details = await operation(index);
    latencies.push(performance.now() - before);
    peakQueueEvents = Math.max(peakQueueEvents, details?.queueEvents ?? 0);
    eventBytes = Math.max(eventBytes, details?.eventBytes ?? 0);
    resourceLimitSignals += details?.limit ? 1 : 0;
  }
  const durationMs = performance.now() - started;
  const row = {
    scenario, mode, iterations,
    throughputPerSecond: Number((iterations / (durationMs / 1000)).toFixed(2)),
    p50Ms: Number(percentile(latencies, 0.5).toFixed(4)),
    p95Ms: Number(percentile(latencies, 0.95).toFixed(4)),
    memoryBytes: process.memoryUsage().heapUsed,
    peakQueueEvents, eventBytes,
    diskBytes: 0, processCount: 1, estimatedCostUsd: 0, backpressureSignals: 0, resourceLimitSignals,
  };
  assertResultSchema(row);
  results.push(row);
}

async function workspace(specifier, fallback) {
  try { return await import(specifier); }
  catch { return import(pathToFileURL(join(process.cwd(), fallback)).href); }
}

const core = await workspace("@arnilo/prism", "dist/index.js");
const agUi = await workspace("@arnilo/prism-ag-ui", "packages/ag-ui/dist/index.js");
const compaction = await workspace("@arnilo/prism-compaction-llm", "packages/compaction-llm/dist/index.js");
const mapper = agUi.createAgUiEventMapper();

await measure("ag-ui-mapper", "in-process", () => {
  const events = mapper.map({ type: "message_delta", sessionId: "bench-thread", runId: "bench-run", content: { type: "text", text: "delta" } });
  return { queueEvents: events.length, eventBytes: Buffer.byteLength(JSON.stringify(events), "utf8") };
});

const agent = core.createAgent({
  model: { provider: "mock", model: "bench" },
  provider: { id: "mock", async *generate() { yield core.providerTextDelta("ok"); yield core.providerDone(); } },
});
const handler = agUi.createAgUiHandler({ authorize: () => ({ ownership: { userId: "bench" } }), sessionFactory: () => agent.createSession() });
await measure("ag-ui-handler", "web-in-process", async (index) => {
  const response = await handler(new Request("https://bench.test/ag-ui", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ threadId: `thread-${index}`, runId: `run-${index}`, state: {}, tools: [], context: [], forwardedProps: {}, messages: [{ id: `message-${index}`, role: "user", content: "hello" }] }),
  }));
  const output = await response.text();
  return { queueEvents: output.trim().split("\n\n").filter(Boolean).length, eventBytes: Buffer.byteLength(output, "utf8") };
});

const records = [
  { id: "event-start", sessionId: "bench-session", runId: "stored-run", type: "agent_started", timestamp: "2026-07-22T00:00:00.000Z", redacted: true, event: { type: "agent_started", sessionId: "bench-session", runId: "stored-run" } },
  { id: "event-finish", sessionId: "bench-session", runId: "stored-run", type: "agent_finished", timestamp: "2026-07-22T00:00:01.000Z", redacted: true, event: { type: "agent_finished", sessionId: "bench-session", runId: "stored-run" } },
];
const replay = agUi.createPersistenceAgUiReplay({ queryEvents: async () => ({ items: records }) }, {
  resolveRun: () => ({ ref: { sessionId: "bench-session", runId: "stored-run" } }),
  ownership: (authorization) => authorization.ownership,
});
const replayHandler = agUi.createAgUiHandler({ authorize: () => ({ ownership: { userId: "bench" } }), sessionFactory: () => { throw new Error("terminal replay must not start"); }, replay });
await measure("ag-ui-replay", "memory-page", async () => {
  const response = await replayHandler(new Request("https://bench.test/ag-ui?cursor=cursor", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ threadId: "bench-thread", runId: "stored-run", state: {}, tools: [], context: [], forwardedProps: {}, messages: [{ id: "message", role: "user", content: "replay" }] }),
  }));
  const output = await response.text();
  return { queueEvents: output.trim().split("\n\n").filter(Boolean).length, eventBytes: Buffer.byteLength(output, "utf8") };
});

const entries = Array.from({ length: 40 }, (_, index) => core.createSessionEntry({
  id: `entry-${index}`, sessionId: "bench", timestamp: "2026-07-22T00:00:00.000Z", kind: "message",
  message: { role: index % 2 ? "assistant" : "user", content: [{ type: "text", text: `plan/check/path-${index} ${"x".repeat(96)}` }] },
}));
await measure("coding-compaction-preparation", "in-process", () => {
  const prepared = compaction.prepareLlmCompaction({ entries, trigger: "manual" }, { keepRecentTokens: 1, trackFileOperations: true });
  return { queueEvents: prepared.entriesToKeep.length, eventBytes: Buffer.byteLength(JSON.stringify(prepared.data), "utf8") };
});

const report = {
  generatedAt: new Date().toISOString(), release: "0.0.12",
  environment: { node: process.version, platform: process.platform, arch: process.arch, network: false, credentials: false },
  schema: { requiredResultFields: REQUIRED_RESULT_FIELDS }, results,
};
for (const row of results) assertResultSchema(row);
console.log(JSON.stringify(report, null, 2));
