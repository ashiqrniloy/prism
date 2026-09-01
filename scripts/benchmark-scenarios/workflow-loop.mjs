#!/usr/bin/env node
/**
 * Plan 045 Task 3 network-free workflow-loop benchmark.
 * Five serial loop iterations run a mock-provider refinement body. The frozen
 * p95 budget is one 50 ms node-execution envelope per iteration.
 *
 * Usage: node scripts/benchmark.mjs --scenario workflow-loop
 */
import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { createAgent, providerDone, providerTextDelta } from "../../dist/index.js";
import {
  createMemoryWorkflowCheckpoints,
  defineWorkflow,
  loopNode,
  runWorkflow,
} from "../../packages/prism-core/dist/runtime/workflows/index.js";
import { loadBudgets } from "../budget-gates.mjs";

export const LOOP_ITERATIONS = 5;
export const WARMUPS = Number(process.env.PRISM_BENCH_WARMUPS ?? 5);
export const ITERATIONS = Number(process.env.PRISM_BENCH_ITERATIONS ?? 20);

let sequence = 0;

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function createMockProvider(stats) {
  return {
    id: "mock",
    async *generate(request) {
      stats.active += 1;
      stats.calls += 1;
      stats.peak = Math.max(stats.peak, stats.active);
      try {
        if (request.signal?.aborted) throw request.signal.reason ?? new Error("aborted");
        yield providerTextDelta("refined");
        yield providerDone();
      } finally {
        stats.active -= 1;
      }
    },
  };
}

export async function runWorkflowLoop({ iterations = LOOP_ITERATIONS, runId = `workflow-loop-${++sequence}` } = {}) {
  const stats = { calls: 0, active: 0, peak: 0 };
  const events = [];
  const agent = createAgent({
    model: { provider: "mock", model: "demo" },
    provider: createMockProvider(stats),
  });
  const workflow = defineWorkflow({
    id: "workflow-loop-benchmark",
    revision: "1",
    nodes: {
      refine: loopNode({
        execute: async (ctx) => {
          const result = await agent.createSession({ id: `${runId}-${ctx.iteration}` }).run("refine");
          return { iteration: ctx.iteration, draft: result.text ?? "refined" };
        },
        until: (ctx) => ctx.iteration === iterations - 1,
        maxIterations: iterations,
      }),
    },
  });
  const startedAt = performance.now();
  const result = await runWorkflow(workflow, "seed", {
    checkpoints: createMemoryWorkflowCheckpoints(),
    runId,
    onEvent: (event) => events.push(event),
  });
  const finishedIterations = events.filter((event) => event.type === "node_iteration_finished");
  return {
    ms: performance.now() - startedAt,
    status: result.status,
    iterations,
    providerCalls: stats.calls,
    finishedIterations: finishedIterations.length,
    peakActiveProviderCalls: stats.peak,
    activeAfter: stats.active,
  };
}

export async function runScenario() {
  const budget = loadBudgets().workflowLoop;
  const fixture = budget.fixture;
  const warmups = Number(process.env.PRISM_BENCH_WARMUPS ?? fixture.warmups);
  const measuredOperations = Number(process.env.PRISM_BENCH_ITERATIONS ?? fixture.measuredOperations);
  const samples = [];
  let providerCalls = 0;
  let finishedIterations = 0;
  let peakActiveProviderCalls = 0;
  let activeAfter = 0;
  for (let n = 0; n < warmups + measuredOperations; n += 1) {
    const row = await runWorkflowLoop({ iterations: fixture.iterations, runId: `workflow-loop-${n}` });
    if (row.providerCalls !== fixture.iterations || row.finishedIterations !== fixture.iterations || row.status !== "succeeded") {
      throw new Error(`workflow loop invariant failed: ${JSON.stringify(row)}`);
    }
    if (n < warmups) continue;
    samples.push(row.ms);
    providerCalls = row.providerCalls;
    finishedIterations = row.finishedIterations;
    peakActiveProviderCalls = Math.max(peakActiveProviderCalls, row.peakActiveProviderCalls);
    activeAfter = Math.max(activeAfter, row.activeAfter);
  }
  const p50Ms = percentile(samples, 0.5);
  const p95Ms = percentile(samples, 0.95);
  const row = {
    name: "workflowLoop",
    operations: samples.length,
    p50Ms: Number(p50Ms.toFixed(3)),
    p95Ms: Number(p95Ms.toFixed(3)),
    p95PerIterationMs: Number((p95Ms / fixture.iterations).toFixed(3)),
    throughputPerSecond: Number((samples.length / Math.max(samples.reduce((sum, ms) => sum + ms, 0) / 1000, 0.000001)).toFixed(2)),
    iterations: fixture.iterations,
    providerCallsPerRun: providerCalls,
    finishedIterationsPerRun: finishedIterations,
    peakActiveProviderCalls,
    activeAfter,
  };
  return {
    version: "0.3.2",
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model ?? "unknown",
      memoryBytes: totalmem(),
      network: false,
      credentials: false,
    },
    fixture: { ...fixture, warmups, measuredOperations },
    ceilingsMs: {
      workflowLoop: budget.p95CeilingMs,
      perIteration: budget.nodeExecutionP95CeilingMs,
    },
    results: [row],
  };
}

async function main() {
  const report = await runScenario();
  const row = report.results[0];
  const budget = loadBudgets().workflowLoop;
  if (row.p95Ms > budget.p95CeilingMs || row.p95PerIterationMs > budget.nodeExecutionP95CeilingMs) {
    console.error(
      `BUDGET FAIL: workflowLoop p95 ${row.p95Ms}ms (${row.p95PerIterationMs}ms/iteration) exceeds ${budget.p95CeilingMs}ms (${budget.nodeExecutionP95CeilingMs}ms/iteration)`,
    );
    process.exitCode = 1;
  }
  if (row.activeAfter !== 0 || row.peakActiveProviderCalls > 1) {
    console.error(`INVARIANT FAIL: activeAfter=${row.activeAfter}, peak=${row.peakActiveProviderCalls}`);
    process.exitCode = 1;
  }
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
