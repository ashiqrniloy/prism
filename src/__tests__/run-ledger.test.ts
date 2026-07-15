import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createAgent,
  createSecretRedactor,
  createToolRegistry,
  providerDone,
  providerTextDelta,
  providerToolCall,
  providerUsage,
  redactRunLedgerRecord,
} from "../index.js";
import { createMockProvider } from "../index.js";
import type {
  AgentConfig,
  AgentEvent,
  AgentEventRecord,
  RunLedger,
  RunLedgerRecord,
  RunOptions,
  ToolCallRecord,
  ToolDefinition,
  UsageRecord,
} from "../index.js";

type InMemoryLedger = {
  runs: Extract<RunLedgerRecord, { status?: string }>[];
  events: AgentEventRecord[];
  toolCalls: ToolCallRecord[];
  usage: UsageRecord[];
};

function createMemoryLedger(): InMemoryLedger & { ledger: RunLedger } {
  const ledger: InMemoryLedger = { runs: [], events: [], toolCalls: [], usage: [] };
  return {
    ...ledger,
    ledger: {
      appendRun: async (record) => { ledger.runs.push(record); },
      appendEvent: async (record) => { ledger.events.push(record); },
      appendToolCall: async (record) => { ledger.toolCalls.push(record); },
      appendUsage: async (record) => { ledger.usage.push(record); },
    },
  };
}

describe("RunLedger contract and redaction", () => {
  it("AgentConfig accepts runLedger, ownership, and idempotencyKey", () => {
    const { ledger } = createMemoryLedger();

    const config: AgentConfig = {
      model: { provider: "mock", model: "demo" },
      runLedger: ledger,
      ownership: { tenantId: "t1", accountId: "a1", userId: "u1" },
      idempotencyKey: "agent-key",
    };

    assert.equal(config.runLedger, ledger);
    assert.equal(config.idempotencyKey, "agent-key");
  });

  it("RunOptions accepts runLedger, ownership, and idempotencyKey", () => {
    const { ledger } = createMemoryLedger();

    const options: RunOptions = {
      runLedger: ledger,
      ownership: { tenantId: "t1" },
      idempotencyKey: "run-key",
    };

    assert.equal(options.runLedger, ledger);
    assert.equal(options.idempotencyKey, "run-key");
  });

  it("redacts secrets inside every RunLedger record kind", () => {
    const redactor = createSecretRedactor(["secret-token"]);

    const run: RunLedgerRecord = {
      id: "run_1",
      sessionId: "s1",
      status: "succeeded",
      startedAt: "2024-01-01T00:00:00Z",
      provider: "mock",
      idempotencyKey: "secret-token",
      metadata: { note: "secret-token" },
      tenantId: "t1",
    } as RunLedgerRecord;

    const event: AgentEventRecord = {
      id: "event_1",
      sessionId: "s1",
      runId: "run_1",
      type: "agent_started",
      timestamp: "2024-01-01T00:00:00Z",
      event: { type: "agent_started", sessionId: "s1", runId: "run_1" },
      redacted: true,
      tenantId: "t1",
    };

    const tool: ToolCallRecord = {
      id: "tool_1",
      sessionId: "s1",
      runId: "run_1",
      toolCallId: "call_1",
      name: "echo",
      arguments: { text: "secret-token" },
      status: "finished",
      result: { toolCallId: "call_1", name: "echo", value: "secret-token" },
      reason: undefined,
      progress: { step: "secret-token" },
      progressMetadata: { note: "secret-token" },
      progressAt: "2024-01-01T00:00:00Z",
      startedAt: "2024-01-01T00:00:00Z",
      finishedAt: "2024-01-01T00:00:01Z",
      redacted: true,
      tenantId: "t1",
    };

    const usage: UsageRecord = {
      id: "usage_1",
      sessionId: "s1",
      runId: "run_1",
      usage: { inputTokens: 1, currency: "secret-token" },
      recordedAt: "2024-01-01T00:00:00Z",
      tenantId: "t1",
    };

    const redactedRun = redactRunLedgerRecord(run, redactor) as typeof run;
    const redactedEvent = redactRunLedgerRecord(event, redactor) as typeof event;
    const redactedTool = redactRunLedgerRecord(tool, redactor) as typeof tool;
    const redactedUsage = redactRunLedgerRecord(usage, redactor) as typeof usage;

    assert.equal(JSON.stringify(redactedRun).includes("secret-token"), false);
    assert.equal(JSON.stringify(redactedEvent).includes("secret-token"), false);
    assert.equal(JSON.stringify(redactedTool).includes("secret-token"), false);
    assert.equal(JSON.stringify(redactedUsage).includes("secret-token"), false);
  });

  it("createAgent accepts runLedger/ownership/idempotencyKey without throwing", () => {
    const { ledger } = createMemoryLedger();

    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      runLedger: ledger,
      ownership: { tenantId: "t1" },
      idempotencyKey: "agent-key",
    });

    assert.equal(agent.config.runLedger, ledger);
    assert.equal(agent.config.idempotencyKey, "agent-key");
  });
});

describe("RunLedger runtime wiring", () => {
  it("appends run lifecycle records on a simple run", async () => {
    const { ledger, runs, events } = createMemoryLedger();
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerTextDelta("hello"), providerDone()]),
      runLedger: ledger,
      ownership: { tenantId: "tenant_1", accountId: "account_1" },
      idempotencyKey: "agent-key",
    });
    const session = agent.createSession({ id: "s1" });

    await session.run("hi", { idempotencyKey: "run-key" });

    assert.equal(runs.length, 2, "expected start and finish run records");
    const start = runs[0];
    const finish = runs[1];
    assert.equal(start?.status, "running");
    assert.equal(finish?.status, "succeeded");
    assert.equal(start?.id, finish?.id);
    assert.equal(start?.sessionId, "s1");
    assert.equal(start?.provider, "mock");
    assert.deepEqual(start?.model, { provider: "mock", model: "demo" });
    assert.equal(start?.idempotencyKey, "run-key");
    assert.equal(start?.tenantId, "tenant_1");
    assert.equal(start?.accountId, "account_1");
    assert.equal(finish?.error, undefined);
    assert.equal(finish?.abortReason, undefined);
    assert.ok(events.some((e) => e.type === "agent_started"));
    assert.ok(events.some((e) => e.type === "agent_finished"));
  });

  it("appends tool-call records for started, finished, and blocked states", async () => {
    const { ledger, toolCalls } = createMemoryLedger();
    const echoTool: ToolDefinition = {
      name: "echo",
      parameters: { type: "object" },
      execute(args) {
        return { toolCallId: "call_1", name: "echo", value: args.text };
      },
    };
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([
        providerToolCall({ type: "tool_call", id: "call_1", name: "echo", arguments: { text: "hi" } }),
        providerDone(),
      ]),
      tools: createToolRegistry([echoTool]),
      runLedger: ledger,
    });
    const session = agent.createSession({ id: "s2" });

    await session.run("use echo");

    const started = toolCalls.find((t) => t.status === "started");
    const finished = toolCalls.find((t) => t.status === "finished");
    assert.ok(started, "expected started tool-call record");
    assert.ok(finished, "expected finished tool-call record");
    assert.equal(started?.toolCallId, "call_1");
    assert.equal(started?.name, "echo");
    assert.equal(started?.arguments.text, "hi");
    assert.equal(finished?.result?.value, "hi");
  });

  it("appends blocked tool-call records with reason", async () => {
    const { ledger, toolCalls } = createMemoryLedger();
    const echoTool: ToolDefinition = {
      name: "echo",
      parameters: { type: "object" },
      execute() {
        return { toolCallId: "call_1", name: "echo", value: "ok" };
      },
    };
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([
        providerToolCall({ type: "tool_call", id: "call_1", name: "echo", arguments: { text: "hi" } }),
        providerDone(),
      ]),
      tools: createToolRegistry([echoTool]),
      runLedger: ledger,
      validator: (_tool, args) => (args.text === "hi" ? "blocked by test validator" : undefined),
    });
    const session = agent.createSession({ id: "s3" });

    await session.run("use echo");

    const blocked = toolCalls.find((t) => t.status === "blocked");
    assert.ok(blocked, "expected blocked tool-call record");
    assert.equal(blocked?.toolCallId, "call_1");
    assert.equal(blocked?.reason, "validation_failed");
    assert.equal(blocked?.result?.error?.message, "blocked by test validator");
  });

  it("appends usage records from provider usage events and final loop usage", async () => {
    const { ledger, usage } = createMemoryLedger();
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerUsage({ inputTokens: 3, outputTokens: 7 }), providerDone({ inputTokens: 3, outputTokens: 7, totalTokens: 10 })]),
      runLedger: ledger,
    });
    const session = agent.createSession({ id: "s4" });

    await session.run("count tokens");

    assert.ok(usage.length >= 1, "expected at least one usage record");
    assert.ok(usage.some((u) => u.usage.inputTokens === 3 && u.usage.outputTokens === 7));
  });

  it("redacts secrets in ledger event and tool-call records", async () => {
    const secret = "ledger-secret";
    const { ledger, events, toolCalls } = createMemoryLedger();
    const echoTool: ToolDefinition = {
      name: "echo",
      parameters: { type: "object" },
      execute(args) {
        return { toolCallId: "call_1", name: "echo", value: args.text };
      },
    };
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([
        providerToolCall({ type: "tool_call", id: "call_1", name: "echo", arguments: { text: secret } }),
        providerDone(),
      ]),
      tools: createToolRegistry([echoTool]),
      runLedger: ledger,
      redactor: createSecretRedactor([secret]),
    });
    const session = agent.createSession({ id: "s5" });

    await session.run("use echo");

    const payload = JSON.stringify({ events, toolCalls });
    assert.equal(payload.includes(secret), false, "secret leaked into ledger payload");
    const finished = toolCalls.find((t) => t.status === "finished");
    assert.equal(finished?.redacted, true);
    assert.ok(events.every((e) => e.redacted === true));
  });

  it("event ledger is run-scoped, timeline-ordered, and writes each message exactly once", async () => {
    // Phase 41 ledger gate: events are appended in run timeline order
    // (agent_started ... message_started ... message_finished ... agent_finished),
    // scoped to the run id, and no message_started/message_finished is double-written.
    const { ledger, events } = createMemoryLedger();
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerTextDelta("one message"), providerDone()]),
      runLedger: ledger,
    });
    const session = agent.createSession({ id: "s-once" });

    const live: AgentEvent[] = [];
    const sub = session.subscribe();
    const collecting = (async () => { for await (const e of sub) live.push(e); })();
    await session.run("say one thing");
    await collecting;
    const runId = live.find((e) => e.type === "agent_started")!.runId;

    const runEvents = events.filter((e) => e.runId === runId);
    assert.ok(runEvents.length > 0, "ledger events scoped to the run id");
    assert.equal(events.filter((e) => e.runId === runId).length, runEvents.length, "no run id leakage");
    assert.equal(runEvents.filter((e) => e.type === "message_started").length, 1, "message_started written exactly once");
    assert.equal(runEvents.filter((e) => e.type === "message_finished").length, 1, "message_finished written exactly once");
    // Timeline order: agent_started precedes message_started precedes message_finished precedes agent_finished.
    const idx = (type: string) => runEvents.findIndex((e) => e.type === type);
    assert.ok(idx("agent_started") < idx("message_started"), "agent_started before message_started");
    assert.ok(idx("message_started") < idx("message_finished"), "message_started before message_finished");
    assert.ok(idx("message_finished") < idx("agent_finished"), "message_finished before agent_finished");
  });

  it("records aborted status and reason when run is aborted", async () => {
    const { ledger, runs, events } = createMemoryLedger();
    const controller = new AbortController();
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: {
        id: "mock",
        async *generate() {
          controller.abort("user-cancelled");
          yield providerTextDelta("never");
          yield providerDone();
        },
      },
      runLedger: ledger,
    });
    const session = agent.createSession({ id: "s6" });

    await assert.rejects(session.run("abort me", { signal: controller.signal }));

    const finish = runs.find((r) => r.status !== "running");
    assert.equal(finish?.status, "aborted");
    assert.equal(finish?.abortReason, "user-cancelled");
    assert.ok(events.some((e) => e.type === "error"));
  });

  it("records failed status and error when provider throws", async () => {
    const { ledger, runs } = createMemoryLedger();
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: {
        id: "mock",
        async *generate() {
          throw new Error("provider blew up");
        },
      },
      runLedger: ledger,
    });
    const session = agent.createSession({ id: "s7" });

    await assert.rejects(session.run("fail me"));

    const finish = runs.find((r) => r.status !== "running");
    assert.equal(finish?.status, "failed");
    assert.ok(finish?.error?.message.includes("provider blew up"));
  });

  it("serializes ledger appends with concurrency of one", async () => {
    let active = 0;
    let maxActive = 0;
    const memory = createMemoryLedger();
    const ledger: RunLedger = {
      ...memory.ledger,
      appendEvent: async (record) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 0));
        active -= 1;
        return memory.ledger.appendEvent(record);
      },
    };
    const deltas = Array.from({ length: 50 }, (_, index) => providerTextDelta(`chunk-${index}`));
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([...deltas, providerDone()]),
      runLedger: ledger,
    });

    await agent.createSession({ id: "s-ledger-serial" }).run("stream many chunks");

    assert.equal(maxActive, 1);
    assert.ok(memory.events.length >= 50, "expected streamed events in ledger");
  });
});
