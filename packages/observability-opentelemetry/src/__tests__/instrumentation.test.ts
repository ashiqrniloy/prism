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

  const runSpan = memory.spans.find((span) => span.name === "invoke_agent prism");
  const providerSpan = memory.spans.find((span) => span.name === "chat demo");
  const toolSpan = memory.spans.find((span) => span.name === "execute_tool echo");
  assert.ok(runSpan && providerSpan && toolSpan);
  assert.equal(providerSpan.attributes["gen_ai.provider.name"], "mock");
  assert.equal(providerSpan.parentSpanId, runSpan.spanId);
  assert.equal(providerSpan.traceId, runSpan.traceId);
  assert.equal(providerSpan.ended, true);
  assert.equal(toolSpan.attributes["gen_ai.tool.name"], "echo");
  assert.equal(toolSpan.parentSpanId, runSpan.spanId);
  assert.equal(toolSpan.ended, true);
  assert.ok(memory.metrics.some((metric) => metric.name === "gen_ai.client.operation.duration"));
  assert.ok(memory.metrics.some((metric) => metric.name === "gen_ai.execute_tool.duration"));
  assert.equal(events.some((event) => event.type === "provider_turn_started"), true);
});

test("guardrail and delegation spans share run context without content", () => {
  const memory = createInMemoryTelemetry();
  const references: string[] = [];
  const telemetry = createOpenTelemetryInstrumentation({ tracer: memory.tracer, onTraceReference: ({ traceId }) => references.push(traceId) });
  telemetry.handleAgentEvent({ type: "agent_started", sessionId: "s1", runId: "r1" });
  telemetry.handleAgentEvent({
    type: "guardrail_decision", sessionId: "s1", runId: "r1",
    record: { guardrail: "secret-name", stage: "input", action: "allow", reason: "secret-reason", metadata: { secret: "canary" } },
  });
  telemetry.handleDelegation({ type: "started", runId: "r1", delegationId: "d1", childId: "research" });
  telemetry.handleDelegation({ type: "finished", runId: "r1", delegationId: "d1", childId: "research" });
  telemetry.handleAgentEvent({ type: "agent_finished", sessionId: "s1", runId: "r1" });

  const run = memory.spans.find((span) => span.name === "invoke_agent prism")!;
  for (const span of memory.spans.filter((item) => item !== run)) {
    assert.equal(span.parentSpanId, run.spanId);
    assert.equal(span.traceId, run.traceId);
  }
  assert.equal(references[0], run.traceId);
  assert.equal(telemetry.traceId("r1"), run.traceId);
  assert.doesNotMatch(JSON.stringify(memory.spans), /secret-name|secret-reason|canary/);
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
  const span = memory.spans.find((item) => item.name === "chat demo");
  assert.equal(span?.status?.code, "error");
  assert.equal(span?.attributes["http.response.status_code"], 503);
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
  assert.equal(ends.get("invoke_agent prism"), 1);
  assert.equal(ends.get("chat demo"), 1);

  async function* events(): AsyncIterableIterator<AgentEvent> {
    yield { type: "agent_started", sessionId: "s2", runId: "r2" };
    await new Promise(() => {});
  }
  const detach = telemetry.attachSession({ id: "s2", subscribe: events });
  await new Promise((resolve) => setImmediate(resolve));
  detach();
  assert.equal(ends.get("invoke_agent prism"), 2);
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

test("token metrics follow GenAI semantic conventions without run-total double counting", () => {
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
    memory.metrics.filter((metric) => metric.name === "gen_ai.client.token.usage").map((metric) => metric.attributes["gen_ai.token.type"]),
    ["input", "output"],
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

test("wrapOpenTelemetryApi bridges parent and ambient context", () => {
  const calls: string[] = [];
  const contexts: unknown[] = [];
  const wrapped = wrapOpenTelemetryApi(
    {
      startSpan(name, _options, context) {
        calls.push(`span:${name}`);
        contexts.push(context);
        return {
          setAttribute() {},
          setStatus() {},
          spanContext: () => ({ traceId: "a".repeat(32), spanId: "b".repeat(16) }),
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
    { context: { active: () => "ambient" }, trace: { setSpan: (_context, span) => ({ parent: span }) } },
  );
  const telemetry = createOpenTelemetryInstrumentation({ tracer: wrapped.tracer, meter: wrapped.meter, parentContext: "host-parent" });
  telemetry.handleAgentEvent({ type: "agent_started", sessionId: "s1", runId: "r1" });
  telemetry.handleAgentEvent({ type: "provider_turn_started", sessionId: "s1", runId: "r1", turn: 1, metadata: { providerId: "mock", model: { provider: "mock", model: "demo" } } });
  telemetry.handleAgentEvent({ type: "agent_finished", sessionId: "s1", runId: "r1" });
  assert.ok(calls.includes("span:invoke_agent prism"));
  assert.equal(contexts[0], "host-parent");
  assert.equal(typeof contexts[1], "object");
});

test("feedback and evaluations project safe metadata without high-cardinality metric labels", () => {
  const memory = createInMemoryTelemetry();
  const telemetry = createOpenTelemetryInstrumentation({ tracer: memory.tracer, meter: memory.meter });
  telemetry.handleAgentEvent({ type: "agent_started", sessionId: "session-secret", runId: "run-secret" });
  telemetry.handleRunFeedback({ runId: "run-secret", rating: 1, hasComment: true, tagCount: 2, scorerCount: 1, evaluationCount: 1 });
  telemetry.handleEvaluation({ runId: "run-secret", status: "scored", score: 0.75, hasReason: true });
  const run = memory.spans.find((span) => span.name === "invoke_agent prism");
  assert.deepEqual(run?.events.map((event) => event.name), ["prism.run.feedback", "gen_ai.evaluation.result"]);
  assert.equal(run?.events[0]?.attributes["prism.feedback.tag_count"], 2);
  assert.equal(run?.events[1]?.attributes["gen_ai.evaluation.score.value"], 0.75);
  const metricJson = JSON.stringify(memory.metrics.filter((metric) => metric.name.includes("feedback") || metric.name.includes("evaluation")));
  assert.doesNotMatch(metricJson, /run-secret|session-secret|comment|scorer|evaluation_id|tag_count/);
  assert.match(metricJson, /positive|scored/);

  telemetry.handleAgentEvent({ type: "agent_finished", sessionId: "session-secret", runId: "run-secret" });
  telemetry.handleRunFeedback({ runId: "run-after", hasComment: false, tagCount: 0, scorerCount: 0, evaluationCount: 0 });
  assert.ok(memory.spans.some((span) => span.name === "prism.run.feedback" && span.ended));
  assert.equal(telemetry.traceId("run-secret"), run?.traceId);
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
  assert.ok(memory.metrics.some((metric) => metric.name === "gen_ai.execute_tool.duration" && metric.attributes.outcome === "blocked"));
});
