import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgent,
  createToolRegistry,
  dispatchToolCall,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
  type AgentEvent,
  type AIProvider,
} from "@arnilo/prism";
import {
  createInMemoryTelemetry,
  createOpenTelemetryInstrumentation,
  wrapOpenTelemetryApi,
} from "../instrumentation.js";

test("disabled instrumentation is a no-op", () => {
  const memory = createInMemoryTelemetry();
  const telemetry = createOpenTelemetryInstrumentation({ enabled: false, tracer: memory.tracer, meter: memory.meter });
  telemetry.handleAgentEvent({ type: "agent_started", sessionId: "s1", runId: "r1" });
  assert.equal(telemetry.enabled, false);
  assert.equal(memory.spans.length, 0);
});

test("provider_turn and tool spans record metadata without content", async () => {
  const memory = createInMemoryTelemetry();
  const telemetry = createOpenTelemetryInstrumentation({ tracer: memory.tracer, meter: memory.meter });
  const provider: AIProvider = {
    id: "mock",
    async *generate() {
      yield providerToolCall(toolCallContent("call_1", "echo", { text: "hi" }));
      yield providerTextDelta("done");
      yield providerDone({ inputTokens: 3, outputTokens: 4 });
    },
  };
  const session = createAgent({
    model: { provider: "mock", model: "demo" },
    provider,
    tools: createToolRegistry([
      {
        name: "echo",
        execute(_args, ctx) {
          return { toolCallId: ctx.toolCallId, name: "echo" };
        },
      },
    ]),
  }).createSession();

  const detach = telemetry.attachSession(session);
  const reader = (async () => {
    const collected: AgentEvent[] = [];
    for await (const event of session.subscribe()) collected.push(event);
    return collected;
  })();

  await session.run("use echo", { maxToolRounds: 1 });
  detach();
  const events = await reader;

  const providerSpan = memory.spans.find((span) => span.name === "prism.provider.turn");
  const toolSpan = memory.spans.find((span) => span.name === "prism.tool.execute");
  assert.ok(providerSpan);
  assert.equal(providerSpan.attributes["prism.provider_id"], "mock");
  assert.equal(providerSpan.ended, true);
  assert.ok(toolSpan);
  assert.equal(toolSpan.attributes["prism.tool_name"], "echo");
  assert.equal(toolSpan.ended, true);
  assert.ok(memory.metrics.some((metric) => metric.name === "prism.provider.turn.duration_ms"));
  assert.ok(memory.metrics.some((metric) => metric.name === "prism.tool.execution.duration_ms"));
  assert.equal(events.some((event) => event.type === "provider_turn_started"), true);
});

test("provider error turn ends span with error status", () => {
  const memory = createInMemoryTelemetry();
  const telemetry = createOpenTelemetryInstrumentation({ tracer: memory.tracer, meter: memory.meter });
  telemetry.handleAgentEvent({
    type: "provider_turn_started",
    sessionId: "s1",
    runId: "r1",
    turn: 1,
    metadata: { providerId: "mock", model: { provider: "mock", model: "demo" }, attempt: 2 },
  });
  telemetry.handleAgentEvent({
    type: "provider_turn_finished",
    sessionId: "s1",
    runId: "r1",
    turn: 1,
    metadata: { providerId: "mock", model: { provider: "mock", model: "demo" }, attempt: 2, latencyMs: 12, httpStatus: 503 },
    error: { message: "upstream unavailable" },
  });
  const span = memory.spans.find((item) => item.name === "prism.provider.turn");
  assert.equal(span?.status?.code, "error");
  assert.equal(span?.attributes["http.status_code"], 503);
  assert.ok(memory.metrics.some((metric) => metric.attributes.outcome === "error"));
});

test("exporter failures are isolated", () => {
  const telemetry = createOpenTelemetryInstrumentation({
    tracer: {
      startSpan() {
        throw new Error("exporter down");
      },
    },
    onExporterError(error) {
      assert.match(String(error), /exporter down/);
    },
  });
  assert.doesNotThrow(() => {
    telemetry.handleAgentEvent({ type: "agent_started", sessionId: "s1", runId: "r1" });
  });
});

test("wrapOpenTelemetryApi bridges optional api types", () => {
  const calls: string[] = [];
  const wrapped = wrapOpenTelemetryApi(
    {
      startSpan(name) {
        calls.push(`span:${name}`);
        return {
          setAttribute() {},
          setStatus() {},
          end() {
            calls.push("end");
          },
        };
      },
    },
    {
      createCounter(name) {
        calls.push(`counter:${name}`);
        return { add: () => calls.push("counter-add") };
      },
      createHistogram(name) {
        calls.push(`histogram:${name}`);
        return { record: () => calls.push("histogram-record") };
      },
    },
  );
  const telemetry = createOpenTelemetryInstrumentation({ tracer: wrapped.tracer, meter: wrapped.meter });
  telemetry.handleAgentEvent({ type: "agent_started", sessionId: "s1", runId: "r1" });
  telemetry.handleAgentEvent({ type: "agent_finished", sessionId: "s1", runId: "r1" });
  assert.ok(calls.includes("span:prism.agent.run"));
});

test("blocked tool records duration metric without started span", async () => {
  const memory = createInMemoryTelemetry();
  const telemetry = createOpenTelemetryInstrumentation({ tracer: memory.tracer, meter: memory.meter });
  await dispatchToolCall({
    call: { type: "tool_call", id: "c1", name: "missing", arguments: {} },
    registry: createToolRegistry(),
    context: { sessionId: "s1", runId: "r1", toolCallId: "c1" },
    emit: (event) => telemetry.handleAgentEvent(event),
  });
  assert.equal(memory.spans.length, 0);
  assert.ok(memory.metrics.some((metric) => metric.name === "prism.tool.execution.duration_ms" && metric.attributes.status === "blocked"));
});
