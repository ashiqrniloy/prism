#!/usr/bin/env node
/**
 * Release 0.0.27 network-free benchmark (plan 010 Task 8).
 * Ceilings from the Task 0 freeze (p95Targets): fs read/write round trip
 * ≤ 250 ms, mode switch ≤ 250 ms, terminal chunk ack ≤ 1000 ms, prompt first
 * update ≤ 2000 ms, prompt end ≤ 30000 ms. All measured through the real
 * `createPrismAcpAgent` + SDK in-process transport; the client answers fs and
 * terminal methods from memory, so nothing leaves the process.
 *
 * Usage: node scripts/benchmark.mjs --scenario phase10-acp
 */
import { performance } from "node:perf_hooks";
import { client, methods, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { createPrismAcpAgent } from "../../packages/ag-ui/dist/acp/index.js";

const WARMUPS = Number(process.env.PRISM_BENCH_WARMUPS ?? 20);
const ITERATIONS = Number(process.env.PRISM_BENCH_ITERATIONS ?? 100);

const ceilingsMs = {
  fsReadWriteRoundTripMs: 250,
  modeSwitchMs: 250,
  terminalChunkAckMs: 1000,
  promptFirstUpdateMs: 2000,
  promptEndMs: 30000,
};

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function summarize(name, samples) {
  const totalMs = samples.reduce((sum, value) => sum + value, 0);
  return {
    name,
    operations: samples.length,
    p50Ms: Number(percentile(samples, 0.5).toFixed(3)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
    throughputPerSecond: Number((samples.length / (totalMs / 1000)).toFixed(1)),
  };
}

const fsLatencies = [];
const terminalLatencies = [];
const modeLatencies = [];
const promptFirstUpdateLatencies = [];
const promptEndLatencies = [];

// The prompt stream carries the fs/terminal measurement loops once; every
// prompt yields a message_delta so the first-update latency is observable.
let measured = false;
let firstUpdateArmed = false;
let firstUpdateStart = 0;

const agent = createPrismAcpAgent({
  authorize: () => ({ ownership: { userId: "bench" } }),
  sessionFactory: (input) => ({
    session: {
      id: input.sessionId ?? "bench-session",
      async *stream() {
        if (!measured) {
          measured = true;
          const fs = input.coding?.filesystem;
          if (fs) {
            for (let i = 0; i < ITERATIONS; i += 1) {
              const start = performance.now();
              await fs.readTextFile({ path: "/workspace/a.txt" });
              await fs.writeTextFile({ path: "/workspace/b.txt", content: "x" });
              fsLatencies.push(performance.now() - start);
            }
          }
          const terminals = input.coding?.processes;
          if (terminals) {
            for (let i = 0; i < ITERATIONS; i += 1) {
              const terminal = await terminals.create({ command: "ls" });
              const start = performance.now();
              await terminal.output();
              terminalLatencies.push(performance.now() - start);
            }
          }
        }
        yield { type: "message_delta", sessionId: "bench-session", runId: "run", content: { type: "text", text: "tick" } };
        yield { type: "agent_done", sessionId: "bench-session", runId: "run", reason: "end_turn" };
      },
    },
  }),
  lifecycle: { async *resumeStream() {} },
  modes: {
    modes: [
      { id: "edit", name: "Edit" },
      { id: "review", name: "Review" },
    ],
    defaultModeId: "edit",
  },
  coding: {
    filesystem: async (client, sessionId) => ({
      async readTextFile({ path }) {
        const response = await client.request(methods.client.fs.readTextFile, { sessionId, path });
        return { text: response.content };
      },
      async writeTextFile({ path, content }) {
        await client.request(methods.client.fs.writeTextFile, { sessionId, path, content });
      },
    }),
    processes: async (client, sessionId) => ({
      async create({ command }) {
        const response = await client.request(methods.client.terminal.create, { sessionId, command });
        return {
          id: response.terminalId,
          async output() {
            const output = await client.request(methods.client.terminal.output, { sessionId, terminalId: response.terminalId });
            return { output: output.output, truncated: output.truncated ?? false };
          },
        };
      },
    }),
  },
});

const acpClient = client({ name: "benchmark-client" })
  .onNotification(methods.client.session.update, () => {
    if (firstUpdateArmed) {
      firstUpdateArmed = false;
      promptFirstUpdateLatencies.push(performance.now() - firstUpdateStart);
    }
  })
  .onRequest(methods.client.fs.readTextFile, () => ({ content: "hello" }))
  .onRequest(methods.client.fs.writeTextFile, () => ({}))
  .onRequest(methods.client.terminal.create, () => ({ terminalId: "term" }))
  .onRequest(methods.client.terminal.output, () => ({ output: "line\n", truncated: false }));

await acpClient.connectWith(agent, async (connection) => {
  await connection.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
  });
  const created = await connection.request(methods.agent.session.new, { cwd: "/workspace", mcpServers: [] });

  // Warmups: fs/terminal loops + a few prompts and mode switches.
  for (let i = 0; i < WARMUPS; i += 1) {
    await connection.request(methods.agent.session.prompt, {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: "warmup" }],
    });
    await connection.request(methods.agent.session.setMode, { sessionId: created.sessionId, modeId: i % 2 ? "edit" : "review" });
  }

  // Mode switch round trips.
  for (let i = 0; i < ITERATIONS; i += 1) {
    const start = performance.now();
    await connection.request(methods.agent.session.setMode, { sessionId: created.sessionId, modeId: i % 2 ? "edit" : "review" });
    modeLatencies.push(performance.now() - start);
  }

  // Prompt streams: first-update and end latencies.
  for (let i = 0; i < ITERATIONS; i += 1) {
    firstUpdateArmed = true;
    firstUpdateStart = performance.now();
    const start = performance.now();
    await connection.request(methods.agent.session.prompt, {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: "go" }],
    });
    promptEndLatencies.push(performance.now() - start);
  }
});

const results = [
  summarize("fsReadWriteRoundTripMs", fsLatencies),
  summarize("terminalChunkAckMs", terminalLatencies),
  summarize("modeSwitchMs", modeLatencies),
  summarize("promptFirstUpdateMs", promptFirstUpdateLatencies),
  summarize("promptEndMs", promptEndLatencies),
];

const failures = results.filter((result) => result.p95Ms > ceilingsMs[result.name]);
if (failures.length) {
  throw new Error(`benchmark ceiling exceeded:\n${failures.map((f) => `  - ${f.name} p95 ${f.p95Ms} > ${ceilingsMs[f.name]}`).join("\n")}`);
}

console.log(
  JSON.stringify(
    {
      version: "0.0.27",
      generatedAt: new Date().toISOString(),
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: process.env.PRISM_BENCH_CPU ?? "local",
        memoryBytes: Number(process.env.PRISM_BENCH_MEMORY_BYTES ?? 0) || undefined,
        network: false,
      },
      fixture: { warmups: WARMUPS, measuredOperations: ITERATIONS },
      ceilingsMs,
      results,
    },
    null,
    2,
  ),
);
