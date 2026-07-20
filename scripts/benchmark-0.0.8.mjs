#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createBatchedRunLedger } from "../dist/index.js";
import { createInMemoryTelemetry, createOpenTelemetryInstrumentation } from "../packages/observability-opentelemetry/dist/index.js";

const iterations = Number(process.env.PRISM_BENCH_ITERATIONS ?? 1_000);
if (!Number.isInteger(iterations) || iterations < 10 || iterations > 100_000) throw new Error("PRISM_BENCH_ITERATIONS must be 10..100000");
const percentile = (values, ratio) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * ratio) - 1)];
const dir = await mkdtemp(join(tmpdir(), "prism-bench-"));
const results = [];

async function measure(scenario, operation, details = {}) {
  const latencies = [];
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    const before = performance.now();
    await operation(index);
    latencies.push(performance.now() - before);
  }
  const durationMs = performance.now() - started;
  results.push({
    scenario,
    iterations,
    throughputPerSecond: Number((iterations / (durationMs / 1000)).toFixed(2)),
    p50Ms: Number(percentile(latencies, 0.5).toFixed(4)),
    p95Ms: Number(percentile(latencies, 0.95).toFixed(4)),
    memoryBytes: process.memoryUsage().heapUsed,
    diskBytes: details.diskBytes ?? 0,
    estimatedCostUsd: 0,
    backpressureSignals: details.backpressureSignals ?? 0,
  });
}

try {
  const envelope = (scenario) => async (index) => {
    JSON.parse(JSON.stringify({ scenario, index, query: "bounded synthetic request", result: [index, index + 1] }));
  };
  await measure("provider-envelope", envelope("provider"));

  let persisted = 0;
  const target = {
    async appendRun() { persisted += 1; }, async appendEvent() { persisted += 1; },
    async appendToolCall() { persisted += 1; }, async appendUsage() { persisted += 1; },
  };
  const ledger = createBatchedRunLedger(target, { maxBatchEntries: 128, durability: "buffered", maxDelayMs: 60_000 });
  await measure("batched-ledger", (index) => ledger.appendEvent({ runId: "benchmark", sequence: index, type: "delta" }), {
    backpressureSignals: Math.floor(iterations / 128),
  });
  await ledger.flush();
  if (persisted !== iterations) throw new Error("batched ledger lost records");
  await ledger.dispose();

  const snapshot = new Map([["leaf:0", { generation: 0, entries: [] }]]);
  await measure("snapshot-cache-hit", () => { if (!snapshot.get("leaf:0")) throw new Error("snapshot cache miss"); });

  const memory = createInMemoryTelemetry();
  const telemetry = createOpenTelemetryInstrumentation({ tracer: memory.tracer });
  await measure("otel-agent-span", (index) => {
    const runId = `run-${index}`;
    telemetry.handleAgentEvent({ type: "agent_started", sessionId: "benchmark", runId });
    telemetry.handleAgentEvent({ type: "agent_finished", sessionId: "benchmark", runId });
    memory.clear();
  });

  let diskBytes = 0;
  await measure("postgres-ledger-shaped-file", async (index) => {
    const payload = JSON.stringify({ runId: "benchmark", sequence: index, status: "running" });
    diskBytes += Buffer.byteLength(payload);
    if (index % 128 === 127) await writeFile(join(dir, "ledger.json"), payload);
    else JSON.parse(payload);
  });
  results.at(-1).diskBytes = diskBytes;
  results.at(-1).backpressureSignals = Math.floor(iterations / 128);

  await measure("mcp-envelope", envelope("mcp"));
  await measure("a2a-envelope", envelope("a2a"));
  await measure("web-tools-envelope", envelope("web-tools"));

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, arch: process.arch, network: false, credentials: false },
    results,
  }, null, 2));
} finally {
  await rm(dir, { recursive: true, force: true });
}
