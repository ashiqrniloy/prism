#!/usr/bin/env node
/**
 * Phase 35 network-free multi-agent runtime benchmark.
 * Concurrent sessions, supervisor fan-out/saturation, workflow agent nodes,
 * tool concurrency, and abort settle — mock providers, in-process stores.
 *
 * Usage: node scripts/benchmark.mjs --scenario multi-agent-runtime
 */
import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import {
  applyContextBudget,
  createAgent,
  createMemorySessionStore,
  estimateTextTokens,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "../../dist/index.js";
import { createSupervisor, SupervisorLimitError } from "../../packages/supervisor/dist/index.js";
import { agentNode, defineWorkflow, fanOutNode, runWorkflow } from "../../packages/workflows/dist/index.js";
import { loadBudgets } from "../budget-gates.mjs";

export const WARMUPS = Number(process.env.PRISM_BENCH_WARMUPS ?? 5);
export const ITERATIONS = Number(process.env.PRISM_BENCH_ITERATIONS ?? 20);
export const DELAY_MS = Number(process.env.PRISM_BENCH_DELAY_MS ?? 8);
export const SESSION_COUNTS = [1, 4, 16, 32];
export const SUPERVISOR_CAP = 4;
export const WORKFLOW_CONCURRENCY = 2;
export const TOOL_CONCURRENCY = 4;
export const TOOL_CALLS = 8;
export const ABORT_COUNT = 32;
export const ABORT_SETTLE_MS = 1000;
export const LARGE_HISTORY_COUNT = 10_000;
export const HIGH_FREQUENCY_DELTA_COUNT = 5_000;

const OWNERSHIP = { tenantId: "bench", userId: "bench" };
let seq = 0;
const nextId = (prefix) => `${prefix}-${++seq}`;

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });
}

function createTracker() {
  let active = 0;
  let peak = 0;
  let started = 0;
  return {
    enter() {
      active += 1;
      started += 1;
      if (active > peak) peak = active;
    },
    leave() {
      active -= 1;
    },
    get active() {
      return active;
    },
    get peak() {
      return peak;
    },
    get started() {
      return started;
    },
  };
}

function trackingProvider(tracker, delayMs, events) {
  return {
    id: "mock",
    async *generate(request) {
      tracker.enter();
      try {
        if (delayMs > 0) await delay(delayMs, request.signal);
        for (const event of events ?? [providerTextDelta("ok"), providerDone()]) {
          if (request.signal?.aborted) throw request.signal.reason;
          yield event;
        }
      } finally {
        tracker.leave();
      }
    },
  };
}

function toolRoundProvider(toolCount) {
  let turn = 0;
  return {
    id: "mock",
    async *generate(request) {
      turn += 1;
      if (turn === 1) {
        for (let i = 0; i < toolCount; i += 1) {
          if (request.signal?.aborted) throw request.signal.reason;
          yield providerToolCall(toolCallContent(`c${i}`, "work", { i }));
        }
        yield providerDone();
        return;
      }
      yield providerTextDelta("done");
      yield providerDone();
    },
  };
}

async function drainAvailable(iterator, counters, idleMs = 15) {
  for (;;) {
    const next = await Promise.race([iterator.next(), delay(idleMs).then(() => ({ timeout: true }))]);
    if (next.timeout || next.done) return;
    counters.delivered += 1;
  }
}

function drain(session, counters) {
  const subscription = session.subscribe({ maxQueuedEvents: 256, overflow: "drop_oldest" });
  const iterator = subscription[Symbol.asyncIterator]();
  const task = (async () => {
    for (;;) {
      const next = await iterator.next();
      if (next.done) return;
      counters.delivered += 1;
      if (next.value?.type === "event_subscriber_overflow") counters.dropped += next.value.droppedEvents ?? 0;
    }
  })();
  return async () => {
    await iterator.return?.();
    await task;
  };
}

export async function runIndependentSessions(count, options = {}) {
  const delayMs = options.delayMs ?? DELAY_MS;
  const tracker = createTracker();
  const events = { delivered: 0, dropped: 0 };
  const heapBefore = process.memoryUsage().heapUsed;
  const agent = createAgent({
    model: { provider: "mock", model: "demo" },
    store: createMemorySessionStore(),
    provider: trackingProvider(tracker, delayMs),
  });
  const sessions = Array.from({ length: count }, () => agent.createSession({ id: nextId("s") }));
  const stops = sessions.map((session) => drain(session, events));
  const start = performance.now();
  const results = await Promise.all(sessions.map((session) => session.run("go")));
  const ms = performance.now() - start;
  await Promise.all(stops.map((stop) => stop()));
  return {
    ms,
    completions: results.length,
    peakActiveProviderCalls: tracker.peak,
    activeAfter: tracker.active,
    heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
    queuedEvents: events.delivered,
    droppedEvents: events.dropped,
  };
}

export async function runSupervisorFanOut(options = {}) {
  const delayMs = options.delayMs ?? DELAY_MS;
  const cap = options.maxActiveChildren ?? SUPERVISOR_CAP;
  const tracker = createTracker();
  const events = { delivered: 0, dropped: 0 };
  const heapBefore = process.memoryUsage().heapUsed;
  let peakChildren = 0;
  const supervisor = createSupervisor({
    id: nextId("sup"),
    ownership: OWNERSHIP,
    limits: { maxActiveChildren: cap, timeoutMs: 5_000 },
    children: {
      child: {
        createAgent: () => {
          peakChildren = Math.max(peakChildren, supervisor.activeChildren);
          return createAgent({
            model: { provider: "mock", model: "demo" },
            provider: trackingProvider(tracker, delayMs),
          });
        },
      },
    },
  });
  const iterator = supervisor.subscribe()[Symbol.asyncIterator]();
  const start = performance.now();
  const results = await Promise.all(
    Array.from({ length: cap }, (_, i) => supervisor.delegate({ childId: "child", input: "go", threadId: `t${i}` })),
  );
  const ms = performance.now() - start;
  await drainAvailable(iterator, events);
  return {
    ms,
    completions: results.length,
    peakActiveProviderCalls: tracker.peak,
    peakActiveChildren: peakChildren,
    activeAfter: tracker.active + supervisor.activeChildren,
    heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
    queuedEvents: events.delivered,
    droppedEvents: 0,
  };
}

export async function runSupervisorSaturation(options = {}) {
  const delayMs = options.delayMs ?? DELAY_MS;
  const cap = options.maxActiveChildren ?? SUPERVISOR_CAP;
  const attempted = options.attempted ?? 32;
  const tracker = createTracker();
  let peakChildren = 0;
  const supervisor = createSupervisor({
    id: nextId("sat"),
    ownership: OWNERSHIP,
    limits: { maxActiveChildren: cap, timeoutMs: 5_000 },
    children: {
      child: {
        createAgent: () => {
          peakChildren = Math.max(peakChildren, supervisor.activeChildren);
          return createAgent({
            model: { provider: "mock", model: "demo" },
            provider: trackingProvider(tracker, delayMs),
          });
        },
      },
    },
  });
  const start = performance.now();
  const settled = await Promise.allSettled(
    Array.from({ length: attempted }, (_, i) => supervisor.delegate({ childId: "child", input: "go", threadId: `t${i}` })),
  );
  const ms = performance.now() - start;
  const fulfilled = settled.filter((row) => row.status === "fulfilled").length;
  const rejected = settled.filter((row) => row.status === "rejected");
  const limitRejected = rejected.filter((row) => row.reason instanceof SupervisorLimitError).length;
  return {
    ms,
    completions: fulfilled,
    rejected: rejected.length,
    limitRejected,
    peakActiveChildren: Math.max(peakChildren, tracker.peak),
    peakActiveProviderCalls: tracker.peak,
    activeAfter: tracker.active + supervisor.activeChildren,
    heapDeltaBytes: 0,
    queuedEvents: 0,
    droppedEvents: 0,
    cap,
    attempted,
  };
}

export async function runWorkflowFanOut(options = {}) {
  const delayMs = options.delayMs ?? 20;
  const concurrency = options.concurrency ?? WORKFLOW_CONCURRENCY;
  const itemCount = options.itemCount ?? 8;
  let active = 0;
  let peak = 0;
  const expand = fanOutNode({
    items: () => Array.from({ length: itemCount }, (_, index) => index),
    map: async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      try {
        if (delayMs > 0) await delay(delayMs);
        return item;
      } finally {
        active -= 1;
      }
    },
  });
  const workflow = defineWorkflow({
    revision: "1",
    id: nextId("fan"),
    nodes: { expand },
    limits: { maxConcurrency: concurrency, maxFanOut: itemCount },
  });
  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  const result = await runWorkflow(workflow, null);
  const ms = performance.now() - start;
  const outputs = result.outputs?.expand;
  return {
    ms,
    completions: Array.isArray(outputs) ? outputs.length : 0,
    status: result.status,
    peakWorkers: peak,
    peakActiveProviderCalls: 0,
    activeAfter: active,
    heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
    queuedEvents: 0,
    droppedEvents: 0,
    speedup: (delayMs * itemCount) / Math.max(ms, 0.001),
    concurrency,
    itemCount,
  };
}

export async function runWorkflowAgentNodes(options = {}) {
  const delayMs = options.delayMs ?? DELAY_MS;
  const concurrency = options.concurrency ?? WORKFLOW_CONCURRENCY;
  const nodeCount = options.nodeCount ?? 4;
  const tracker = createTracker();
  const collected = [];
  const heapBefore = process.memoryUsage().heapUsed;
  const nodes = Object.fromEntries(
    Array.from({ length: nodeCount }, (_, i) => {
      const id = `n${i}`;
      return [id, agentNode({ agent: id, input: () => "go" })];
    }),
  );
  const workflow = defineWorkflow({
    revision: "1",
    id: nextId("wf"),
    nodes,
    limits: { maxConcurrency: concurrency },
  });
  const start = performance.now();
  const result = await runWorkflow(workflow, "go", {
    agentFactory: (name) =>
      createAgent({
        model: { provider: "mock", model: "demo" },
        provider: trackingProvider(tracker, delayMs),
      }).createSession({ id: nextId(name) }),
    onEvent: (event) => collected.push(event.type),
  });
  const ms = performance.now() - start;
  return {
    ms,
    completions: Object.keys(result.outputs ?? {}).length,
    status: result.status,
    peakActiveProviderCalls: tracker.peak,
    activeAfter: tracker.active,
    heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
    queuedEvents: collected.length,
    droppedEvents: 0,
    nodeStarted: collected.filter((type) => type === "node_started").length,
    nodeFinished: collected.filter((type) => type === "node_finished").length,
    concurrency,
  };
}

export async function runToolConcurrency(options = {}) {
  const delayMs = options.delayMs ?? DELAY_MS;
  const toolConcurrency = options.toolConcurrency ?? TOOL_CONCURRENCY;
  const toolCount = options.toolCount ?? TOOL_CALLS;
  const tracker = createTracker();
  const heapBefore = process.memoryUsage().heapUsed;
  const agent = createAgent({
    model: { provider: "mock", model: "demo" },
    loop: { strategy: "single-shot", toolConcurrency },
    provider: toolRoundProvider(toolCount),
    tools: [
      {
        name: "work",
        execute: async (_args, context) => {
          tracker.enter();
          try {
            if (delayMs > 0) await delay(delayMs, context.signal);
            return { toolCallId: context.toolCallId, name: "work", value: 1 };
          } finally {
            tracker.leave();
          }
        },
      },
    ],
  });
  const session = agent.createSession({ id: nextId("tool") });
  const start = performance.now();
  const result = await session.run("go");
  const ms = performance.now() - start;
  return {
    ms,
    completions: result.status === "succeeded" ? 1 : 0,
    peakActiveProviderCalls: tracker.peak,
    peakActiveTools: tracker.peak,
    activeAfter: tracker.active,
    heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
    queuedEvents: 0,
    droppedEvents: 0,
    toolConcurrency,
    toolCount,
  };
}

export async function runAbortStorm(options = {}) {
  const delayMs = options.delayMs ?? Math.max(DELAY_MS, 8);
  const count = options.count ?? ABORT_COUNT;
  const settleDeadlineMs = options.settleDeadlineMs ?? ABORT_SETTLE_MS;
  const tracker = createTracker();
  const heapBefore = process.memoryUsage().heapUsed;
  const agent = createAgent({
    model: { provider: "mock", model: "demo" },
    provider: trackingProvider(tracker, delayMs),
  });
  const controllers = [];
  const promises = Array.from({ length: count }, () => {
    const ac = new AbortController();
    controllers.push(ac);
    return agent.createSession({ id: nextId("abort") }).run("go", { signal: ac.signal });
  });
  await delay(Math.max(1, Math.min(2, delayMs / 4)));
  const abortStart = performance.now();
  for (const ac of controllers) ac.abort();
  const settled = await Promise.allSettled(promises);
  const deadline = abortStart + settleDeadlineMs;
  while (tracker.active > 0 && performance.now() < deadline) await delay(1);
  const abortSettledMs = performance.now() - abortStart;
  return {
    ms: abortSettledMs,
    abortSettledMs,
    abortSettled: tracker.active === 0 && abortSettledMs <= settleDeadlineMs,
    completions: settled.filter((row) => row.status === "fulfilled").length,
    aborted: settled.filter((row) => row.status === "rejected").length,
    peakActiveProviderCalls: tracker.peak,
    activeAfter: tracker.active,
    heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
    queuedEvents: 0,
    droppedEvents: 0,
  };
}

export function runLargeHistoryBudget(options = {}) {
  const count = options.historyCount ?? LARGE_HISTORY_COUNT;
  const heapBefore = process.memoryUsage().heapUsed;
  const groups = {
    instructions: [{ id: "system", role: "system", content: [{ type: "text", text: "sys" }] }],
    summaries: [],
    history: Array.from({ length: count }, (_, index) => ({
      id: `history-${index}`,
      role: "user",
      content: [{ type: "text", text: "history" }],
    })),
    input: [{ role: "user", content: [{ type: "text", text: "current" }] }],
    attachments: [],
    toolResults: [],
  };
  const start = performance.now();
  const result = applyContextBudget({
    groups,
    budget: {
      maxInputTokens: estimateTextTokens("sys") + estimateTextTokens("current"),
      reportOmissions: true,
    },
  });
  return {
    ms: performance.now() - start,
    completions: result.groups.history.length === 0 ? 1 : 0,
    peakActiveProviderCalls: 0,
    activeAfter: 0,
    heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
    queuedEvents: 0,
    droppedEvents: 0,
    historyCount: count,
    historyRemaining: result.groups.history.length,
  };
}

export async function runProviderDeltas(options = {}) {
  const count = options.deltaCount ?? HIGH_FREQUENCY_DELTA_COUNT;
  const text = options.text ?? "😀";
  const delta = providerTextDelta(text);
  const done = providerDone();
  const heapBefore = process.memoryUsage().heapUsed;
  const agent = createAgent({
    model: { provider: "mock", model: "demo" },
    provider: {
      id: "mock",
      async *generate(request) {
        for (let index = 0; index < count; index += 1) {
          if (request.signal?.aborted) throw request.signal.reason ?? new Error("aborted");
          yield delta;
        }
        yield done;
      },
    },
  });
  const start = performance.now();
  const result = await agent.createSession({ id: nextId("delta") }).run("go");
  return {
    ms: performance.now() - start,
    completions: result.status === "succeeded" ? 1 : 0,
    peakActiveProviderCalls: 0,
    activeAfter: 0,
    heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
    queuedEvents: 0,
    droppedEvents: 0,
    deltaCount: count,
    responseBytes: count * Buffer.byteLength(JSON.stringify(delta), "utf8") + Buffer.byteLength(JSON.stringify(done), "utf8"),
  };
}

function summarize(name, samples, extras) {
  const totalMs = samples.reduce((sum, value) => sum + value, 0);
  return {
    name,
    operations: samples.length,
    p50Ms: Number(percentile(samples, 0.5).toFixed(3)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
    throughputPerSecond: Number((samples.length / Math.max(totalMs / 1000, 0.000001)).toFixed(2)),
    ...extras,
  };
}

async function measure(name, iterations, fn) {
  const samples = [];
  const extras = {
    heapDeltaBytes: 0,
    queuedEvents: 0,
    droppedEvents: 0,
    peakActiveProviderCalls: 0,
    completions: 0,
    activeAfter: 0,
  };
  for (let n = 0; n < WARMUPS + iterations; n += 1) {
    const row = await fn();
    if (n < WARMUPS) continue;
    samples.push(row.ms);
    extras.heapDeltaBytes = Math.max(extras.heapDeltaBytes, row.heapDeltaBytes ?? 0);
    extras.queuedEvents = Math.max(extras.queuedEvents, row.queuedEvents ?? 0);
    extras.droppedEvents += row.droppedEvents ?? 0;
    extras.peakActiveProviderCalls = Math.max(extras.peakActiveProviderCalls, row.peakActiveProviderCalls ?? 0);
    extras.completions += row.completions ?? 0;
    extras.activeAfter = Math.max(extras.activeAfter, row.activeAfter ?? 0);
    if (row.abortSettledMs !== undefined) extras.abortSettledMs = Math.max(extras.abortSettledMs ?? 0, row.abortSettledMs);
    if (row.abortSettled !== undefined) extras.abortSettled = extras.abortSettled === false ? false : row.abortSettled;
    if (row.peakActiveChildren !== undefined) {
      extras.peakActiveChildren = Math.max(extras.peakActiveChildren ?? 0, row.peakActiveChildren);
    }
    if (row.limitRejected !== undefined) extras.limitRejected = (extras.limitRejected ?? 0) + row.limitRejected;
    if (row.nodeStarted !== undefined) extras.nodeStarted = (extras.nodeStarted ?? 0) + row.nodeStarted;
    if (row.nodeFinished !== undefined) extras.nodeFinished = (extras.nodeFinished ?? 0) + row.nodeFinished;
    if (row.peakActiveTools !== undefined) extras.peakActiveTools = Math.max(extras.peakActiveTools ?? 0, row.peakActiveTools);
    if (row.peakWorkers !== undefined) extras.peakWorkers = Math.max(extras.peakWorkers ?? 0, row.peakWorkers);
    if (row.speedup !== undefined) extras.speedup = Math.min(extras.speedup ?? Number.POSITIVE_INFINITY, row.speedup);
    if (row.historyCount !== undefined) extras.historyCount = row.historyCount;
    if (row.historyRemaining !== undefined) extras.historyRemaining = row.historyRemaining;
    if (row.deltaCount !== undefined) extras.deltaCount = row.deltaCount;
    if (row.responseBytes !== undefined) extras.responseBytes = row.responseBytes;
  }
  return summarize(name, samples, extras);
}

export async function runScenario() {
  const budgets = loadBudgets();
  const fixture = budgets.multiAgentRuntime.fixture;
  const results = [];
  for (const count of SESSION_COUNTS) {
    results.push(await measure(`independentSessions-${count}`, ITERATIONS, () => runIndependentSessions(count)));
  }
  results.push(await measure("contextBudget-10k-history", ITERATIONS, () => runLargeHistoryBudget()));
  results.push(await measure("provider-5k-deltas", ITERATIONS, () => runProviderDeltas()));
  results.push(await measure("supervisorFanOut", ITERATIONS, () => runSupervisorFanOut()));
  results.push(await measure("supervisorSaturation", ITERATIONS, () => runSupervisorSaturation()));
  results.push(await measure("workflowFanOut", ITERATIONS, () => runWorkflowFanOut()));
  results.push(await measure("workflowAgentNodes", ITERATIONS, () => runWorkflowAgentNodes()));
  results.push(await measure("toolConcurrency", ITERATIONS, () => runToolConcurrency()));
  results.push(await measure("abortStorm", ITERATIONS, () => runAbortStorm()));
  return {
    version: "0.3.0",
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
    fixture: {
      ...fixture,
      warmups: WARMUPS,
      measuredOperations: ITERATIONS,
      providerDelayMs: DELAY_MS,
    },
    ceilingsMs: budgets.multiAgentRuntime.p95CeilingsMs,
    results,
  };
}

async function main() {
  const report = await runScenario();
  const ceilings = report.ceilingsMs;
  for (const row of report.results) {
    const ceiling = ceilings[row.name];
    if (ceiling != null && row.p95Ms > ceiling) {
      console.error(`BUDGET FAIL: ${row.name} p95 ${row.p95Ms}ms > ${ceiling}ms`);
      process.exitCode = 1;
    }
    if (row.activeAfter > 0) {
      console.error(`LEAK: ${row.name} activeAfter ${row.activeAfter}`);
      process.exitCode = 1;
    }
    if (row.abortSettled === false) {
      console.error(`ABORT FAIL: ${row.name} did not settle`);
      process.exitCode = 1;
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
