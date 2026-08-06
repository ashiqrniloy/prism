#!/usr/bin/env node
/**
 * Release 0.0.25 network-free benchmark (plan 008 Task 7).
 * Ceilings from Task 0 freeze: decision/sticky p95 ≤ 5 ms, snapshot ≤ 20 ms @ ~256 KiB,
 * A2UI paint ≤ 10 ms / 64 ops. Fixture uses practical gate max (32 pending) — hard 128 is
 * a batch reject ceiling, not a collectable pending count under DEFAULT_MAX_PENDING_DECISIONS.
 *
 * Usage: node scripts/benchmark-0.0.25.mjs > scripts/benchmark-0.0.25.json
 */
import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import {
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  HARD_MAX_AGENT_RUN_STATE_BYTES,
  providerDone,
  providerTextDelta,
  resumeAgentRun,
  toolCallContent,
} from "../dist/index.js";
import { createAgUiEventMapper } from "../packages/ag-ui/dist/index.js";

const WARMUPS = Number(process.env.PRISM_BENCH_WARMUPS ?? 20);
const ITERATIONS = Number(process.env.PRISM_BENCH_ITERATIONS ?? 100);
const PENDING = 32;
const SNAPSHOT_BYTES = 250_000;
const A2UI_OPS = 64;

const ceilings = {
  decisionApply: 5,
  stickyMatch: 5,
  snapshotCaptureRestore: 20,
  a2uiPaint: 10,
};

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function summarize(name, samples) {
  const p50 = percentile(samples, 0.5);
  const p95 = percentile(samples, 0.95);
  return {
    name,
    operations: samples.length,
    p50Ms: Number(p50.toFixed(3)),
    p95Ms: Number(p95.toFixed(3)),
    throughputPerSecond: Number((1000 / (samples.reduce((a, b) => a + b, 0) / samples.length)).toFixed(2)),
  };
}

function parallelProvider(count) {
  let turn = 0;
  return {
    id: "mock",
    async *generate() {
      turn += 1;
      if (turn === 1) {
        for (let i = 0; i < count; i += 1) {
          yield { type: "tool_call", call: toolCallContent(`c${i}`, "write", { i }) };
        }
        yield providerDone();
        return;
      }
      yield providerTextDelta("done");
      yield providerDone();
    },
  };
}

async function measureDecisionApply() {
  const samples = [];
  for (let n = 0; n < WARMUPS + ITERATIONS; n += 1) {
    const checkpoints = createMemoryCheckpointStore();
    const agent = createAgent({
      id: "bench-decision",
      model: { provider: "mock", model: "demo" },
      store: createMemorySessionStore(),
      provider: parallelProvider(PENDING),
      tools: [
        {
          name: "write",
          parameters: {},
          execute: (_a, c) => ({ toolCallId: c.toolCallId, name: "write", value: 1 }),
        },
      ],
    });
    const first = await agent.createSession({ id: `d-${n}` }).run("go", {
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });
    const decisions = first.interruption.pendingDecisions.map((d) => ({
      approvalId: d.approvalId,
      outcome: "allow_once",
    }));
    const start = performance.now();
    await resumeAgentRun(
      agent,
      { runId: first.runId, sessionId: first.sessionId },
      { expectedVersion: first.runState.version, decisions },
      { checkpoints, definitionRevision: "1" },
    );
    const ms = performance.now() - start;
    if (n >= WARMUPS) samples.push(ms);
  }
  return summarize("decisionApply", samples);
}

async function measureStickyMatch() {
  // Time allow_for_run resume that seeds sticky then dispatches a matching same-scope call.
  const samples = [];
  for (let n = 0; n < WARMUPS + ITERATIONS; n += 1) {
    const checkpoints = createMemoryCheckpointStore();
    let turn = 0;
    const agent = createAgent({
      id: "bench-sticky",
      model: { provider: "mock", model: "demo" },
      store: createMemorySessionStore(),
      provider: {
        id: "mock",
        async *generate() {
          turn += 1;
          if (turn === 1) {
            yield { type: "tool_call", call: toolCallContent("c1", "write", { same: true }) };
            yield providerDone();
            return;
          }
          if (turn === 2) {
            yield { type: "tool_call", call: toolCallContent("c2", "write", { same: true }) };
            yield providerDone();
            return;
          }
          yield providerTextDelta("done");
          yield providerDone();
        },
      },
      tools: [
        {
          name: "write",
          parameters: {},
          execute: (_a, c) => ({ toolCallId: c.toolCallId, name: "write", value: 1 }),
        },
      ],
    });
    const first = await agent.createSession({ id: `s-${n}` }).run("go", {
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });
    const start = performance.now();
    await resumeAgentRun(
      agent,
      { runId: first.runId, sessionId: first.sessionId },
      {
        expectedVersion: first.runState.version,
        decisions: [{ approvalId: first.interruption.pendingDecisions[0].approvalId, outcome: "allow_for_run" }],
      },
      { checkpoints, definitionRevision: "1" },
    );
    const ms = performance.now() - start;
    if (n >= WARMUPS) samples.push(ms);
  }
  return summarize("stickyMatch", samples);
}

async function measureSnapshot() {
  const samples = [];
  const blob = "x".repeat(SNAPSHOT_BYTES);
  for (let n = 0; n < WARMUPS + ITERATIONS; n += 1) {
    const checkpoints = createMemoryCheckpointStore();
    let turns = 0;
    const agent = createAgent({
      id: "bench-snap",
      model: { provider: "mock", model: "demo" },
      store: createMemorySessionStore(),
      provider: parallelProvider(1),
      loop: {
        name: "fat",
        revision: "1",
        snapshot: () => ({ blob, turns }),
        restore: (s) => {
          turns = s.turns;
        },
        async run(ctx) {
          turns += 1;
          const { calls } = await ctx.generate(await ctx.assemble([]));
          await ctx.chargeToolRound?.(calls);
          for (const call of calls) await ctx.dispatchToolCall(call);
        },
      },
      tools: [
        {
          name: "write",
          parameters: {},
          execute: (_a, c) => ({ toolCallId: c.toolCallId, name: "write", value: 1 }),
        },
      ],
    });
    const start = performance.now();
    const first = await agent.createSession({ id: `snap-${n}` }).run("go", {
      runState: {
        checkpoints,
        definitionRevision: "1",
        interruptBeforeTool: true,
        maxStateBytes: HARD_MAX_AGENT_RUN_STATE_BYTES,
      },
    });
    await resumeAgentRun(
      agent,
      { runId: first.runId, sessionId: first.sessionId },
      {
        expectedVersion: first.runState.version,
        decisions: first.interruption.pendingDecisions.map((d) => ({ approvalId: d.approvalId, outcome: "allow_once" })),
      },
      { checkpoints, definitionRevision: "1" },
    );
    const ms = performance.now() - start;
    if (n >= WARMUPS) samples.push(ms);
  }
  return summarize("snapshotCaptureRestore", samples);
}

async function measureA2uiPaint() {
  const catalogId = "https://a2ui.org/specification/v0_9/basic_catalog.json";
  const ops = [{ version: "v0.9", createSurface: { surfaceId: "bench" } }];
  for (let i = 0; i < A2UI_OPS - 1; i += 1) {
    ops.push({
      version: "v0.9",
      updateComponents: {
        surfaceId: "bench",
        components: [{ id: `c${i}`, component: "Text", text: `row-${i}` }],
      },
    });
  }
  const samples = [];
  for (let n = 0; n < WARMUPS + ITERATIONS; n += 1) {
    const mapper = createAgUiEventMapper({ a2ui: { catalogId, mode: "fixed-schema" } });
    const start = performance.now();
    await mapper.map({
      type: "tool_execution_finished",
      sessionId: "s",
      runId: `r-${n}`,
      result: { toolCallId: `t-${n}`, name: "paint", value: { a2ui_operations: ops } },
      metadata: { durationMs: 1, status: "finished" },
    });
    const ms = performance.now() - start;
    if (n >= WARMUPS) samples.push(ms);
  }
  return summarize("a2uiPaint", samples);
}

const decisionApply = await measureDecisionApply();
const stickyMatch = await measureStickyMatch();
const snapshotCaptureRestore = await measureSnapshot();
const a2uiPaint = await measureA2uiPaint();

const results = [decisionApply, stickyMatch, snapshotCaptureRestore, a2uiPaint];
const report = {
  version: "0.0.25",
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model ?? "unknown",
    memoryBytes: totalmem(),
    network: false,
  },
  fixture: {
    warmups: WARMUPS,
    measuredOperations: ITERATIONS,
    pendingDecisions: PENDING,
    snapshotBytes: SNAPSHOT_BYTES,
    a2uiOpsPerMessage: A2UI_OPS,
  },
  ceilingsMs: ceilings,
  results,
};

for (const row of results) {
  const ceiling = ceilings[row.name];
  if (row.p95Ms > ceiling) {
    console.error(`BUDGET FAIL: ${row.name} p95 ${row.p95Ms}ms > ${ceiling}ms`);
    process.exitCode = 1;
  }
}

console.log(JSON.stringify(report, null, 2));
