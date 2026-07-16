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

test("run errors and detach close outstanding spans exactly once", async () => {
  const ends = new Map<string, number>();
  const telemetry = createOpenTelemetryInstrumentation({
    tracer: {
      startSpan(name) {
        return {
          setAttribute() {},
          setStatus() {},
          end() { ends.set(name, (ends.get(name) ?? 0) + 1); },
        };
      },
    },
  });
  telemetry.handleAgentEvent({ type: "agent_started", sessionId: "s1", runId: "r1" });
  telemetry.handleAgentEvent({
    type: "provider_turn_started",
    sessionId: "s1",
    runId: "r1",
    turn: 1,
    metadata: { providerId: "mock", model: { provider: "mock", model: "demo" } },
  });
  telemetry.handleAgentEvent({ type: "error", sessionId: "s1", runId: "r1", error: { message: "aborted" } });
  telemetry.handleAgentEvent({ type: "error", sessionId: "s1", runId: "r1", error: { message: "aborted again" } });
  assert.equal(ends.get("prism.agent.run"), 1);
  assert.equal(ends.get("prism.provider.turn"), 1);

  async function* events(): AsyncIterableIterator<AgentEvent> {
    yield { type: "agent_started", sessionId: "s2", runId: "r2" };
    await new Promise(() => {});
  }
  const detach = telemetry.attachSession({ id: "s2", subscribe: events });
  await new Promise((resolve) => setImmediate(resolve));
  detach();
  assert.equal(ends.get("prism.agent.run"), 2);
});

test("failed and aborted agent runs leave no active spans", async () => {
  for (const mode of ["failed", "aborted"] as const) {
    const memory = createInMemoryTelemetry();
    const telemetry = createOpenTelemetryInstrumentation({ tracer: memory.tracer, meter: memory.meter });
    const controller = new AbortController();
    const session = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: {
        id: "mock",
        async *generate() {
          if (mode === "aborted") controller.abort(new Error("cancelled"));
          throw new Error(mode === "failed" ? "provider failed" : "cancelled");
        },
      },
    }).createSession();
    const detach = telemetry.attachSession(session);
    await assert.rejects(session.run("test", mode === "aborted" ? { signal: controller.signal } : undefined));
    detach();
    assert.ok(memory.spans.length > 0);
    assert.equal(memory.spans.every((span) => span.ended), true, `${mode} run leaked a span`);
  }
});

test("provider and aggregate token metrics use distinct instruments", () => {
  const memory = createInMemoryTelemetry();
  const telemetry = createOpenTelemetryInstrumentation({ tracer: memory.tracer, meter: memory.meter });
  const usage = { inputTokens: 10, outputTokens: 2, totalTokens: 12 };
  telemetry.handleAgentEvent({
    type: "provider_turn_finished",
    sessionId: "s1",
    runId: "r1",
    turn: 1,
    metadata: { providerId: "mock", model: { provider: "mock", model: "demo" } },
    usage,
  });
  telemetry.handleAgentEvent({ type: "agent_finished", sessionId: "s1", runId: "r1", usage });
  assert.deepEqual(
    memory.metrics.filter((metric) => metric.kind === "counter").map((metric) => metric.name),
    ["prism.provider.tokens", "prism.provider.tokens", "prism.run.tokens", "prism.run.tokens"],
  );
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

test("feedback and evaluations project safe metadata without high-cardinality metric labels", () => {
  const memory = createInMemoryTelemetry();
  const telemetry = createOpenTelemetryInstrumentation({ tracer: memory.tracer, meter: memory.meter });
  telemetry.handleAgentEvent({ type: "agent_started", sessionId: "session-secret", runId: "run-secret" });
  telemetry.handleRunFeedback({ runId: "run-secret", rating: 1, hasComment: true, tagCount: 2, scorerCount: 1, evaluationCount: 1 });
  telemetry.handleEvaluation({ runId: "run-secret", status: "scored", score: 0.75, hasReason: true });
  const run = memory.spans.find((span) => span.name === "prism.agent.run");
  assert.deepEqual(run?.events.map((event) => event.name), ["prism.run.feedback", "prism.run.evaluation"]);
  assert.equal(run?.events[0]?.attributes["prism.feedback.tag_count"], 2);
  assert.equal(run?.events[1]?.attributes["prism.evaluation.score"], 0.75);
  const metricJson = JSON.stringify(memory.metrics.filter((metric) => metric.name.includes("feedback") || metric.name.includes("evaluation")));
  assert.doesNotMatch(metricJson, /run-secret|session-secret|comment|scorer|evaluation_id|tag_count/);
  assert.match(metricJson, /positive|scored/);

  telemetry.handleAgentEvent({ type: "agent_finished", sessionId: "session-secret", runId: "run-secret" });
  telemetry.handleRunFeedback({ runId: "run-after", hasComment: false, tagCount: 0, scorerCount: 0, evaluationCount: 0 });
  assert.ok(memory.spans.some((span) => span.name === "prism.run.feedback" && span.ended));
});

test("feedback exporter failures are isolated", () => {
  let errors = 0;
  const telemetry = createOpenTelemetryInstrumentation({
    tracer: {
      startSpan() {
        return { setAttribute() {}, setStatus() {}, addEvent() { throw new Error("feedback exporter down"); }, end() {} };
      },
    },
    onExporterError() { errors += 1; },
  });
  telemetry.handleAgentEvent({ type: "agent_started", sessionId: "s1", runId: "r1" });
  assert.doesNotThrow(() => telemetry.handleRunFeedback({ runId: "r1", hasComment: true, tagCount: 1, scorerCount: 0, evaluationCount: 0 }));
  assert.equal(errors, 1);
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
