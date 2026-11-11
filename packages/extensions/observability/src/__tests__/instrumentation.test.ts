import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  type AgentEvent,
  createAgent,
  createToolRegistry,
  dispatchToolCall,
  type EventOrigin,
  type ModelProvider,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import type { DelegationTelemetry } from "../instrumentation.js";
import { createInMemoryTelemetry, createOpenTelemetryInstrumentation, wrapOpenTelemetryApi } from "../instrumentation.js";

/** The origin a delegate reports for one child (K3): `agent` is the child's configured name. */
const DELEGATE_ORIGIN: EventOrigin = { kind: "prism", agent: "research", agentId: "delegate-research", delegationId: "d1", depth: 1 };

test("disabled instrumentation is a no-op", () => {
  const memory = createInMemoryTelemetry();
  const telemetry = createOpenTelemetryInstrumentation({ enabled: false, tracer: memory.tracer, meter: memory.meter });
  telemetry.handleAgentEvent({ type: "run.started", sessionId: "s1", runId: "r1" });
  assert.equal(telemetry.enabled, false);
  assert.equal(memory.spans.length, 0);
});

test("provider_turn and tool spans record metadata without content", async () => {
  const memory = createInMemoryTelemetry();
  const telemetry = createOpenTelemetryInstrumentation({ tracer: memory.tracer, meter: memory.meter });
  const provider: ModelProvider = {
    id: "mock",
    async *generate() {
      yield providerToolCall(toolCallContent("call_1", "echo", { text: "hi" }));
      yield providerTextDelta("done");
      yield providerDone({ inputTokens: 3, outputTokens: 4 });
    },
  };
  const session = await (
    await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [provider])],
      tools: {
        add: [
          {
            name: "echo",
            execute(_args, ctx) {
              return { toolCallId: ctx.toolCallId, name: "echo" };
            },
          },
        ],
      },
    })
  ).session();

  const detach = telemetry.attachSession(session);
  const reader = (async () => {
    const collected: AgentEvent[] = [];
    for await (const event of session.subscribe()) collected.push(event);
    return collected;
  })();

  await session.run("use echo", { limits: { maxToolRounds: 1 } });
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
  assert.equal(
    events.some((event) => event.type === "turn.started"),
    true,
  );
});

test("guardrail and delegation spans share run context without content", () => {
  const memory = createInMemoryTelemetry();
  const references: string[] = [];
  const telemetry = createOpenTelemetryInstrumentation({
    tracer: memory.tracer,
    onTraceReference: ({ traceId }) => references.push(traceId),
  });
  telemetry.handleAgentEvent({ type: "run.started", sessionId: "s1", runId: "r1" });
  telemetry.handleAgentEvent({
    type: "package.event",
    sessionId: "s1",
    runId: "r1",
    package: "kernel",
    name: "guardrail.decision",
    data: {
      record: { guardrail: "secret-name", stage: "input", action: "allow", reason: "secret-reason", metadata: { secret: "canary" } },
    },
  });
  telemetry.handleDelegation({ type: "started", runId: "r1", delegationId: "d1", origin: DELEGATE_ORIGIN });
  telemetry.handleDelegation({ type: "finished", runId: "r1", delegationId: "d1", origin: DELEGATE_ORIGIN });
  telemetry.handleAgentEvent({ type: "run.completed", sessionId: "s1", status: "completed", runId: "r1" });

  const run = memory.spans.find((span) => span.name === "invoke_agent prism")!;
  for (const span of memory.spans.filter((item) => item !== run)) {
    assert.equal(span.parentSpanId, run.spanId);
    assert.equal(span.traceId, run.traceId);
  }
  assert.equal(references[0], run.traceId);
  assert.equal(telemetry.traceId("r1"), run.traceId);
  assert.doesNotMatch(JSON.stringify(memory.spans), /secret-name|secret-reason|canary/);
});

test("delegate_child_events_carry_origin", () => {
  // Plan 174 Task 9: the delegation span is attributed through `origin` (K3) — the same record and the
  // same attribute names as every catalog event — and the retired `prism.delegation.child` is gone.
  const memory = createInMemoryTelemetry();
  const telemetry = createOpenTelemetryInstrumentation({ tracer: memory.tracer, meter: memory.meter });
  telemetry.handleDelegation({ type: "started", runId: "r1", delegationId: "d1", origin: DELEGATE_ORIGIN });
  const span = memory.spans.find((item) => item.name === "prism.agent.delegate");
  assert.ok(span, "the delegation span is opened");
  assert.equal(span.attributes["prism.origin.agent"], "research");
  assert.equal(span.attributes["prism.origin.delegation_id"], "d1");
  assert.equal(span.attributes["prism.origin.executed_by"], "prism");
  assert.equal(
    Object.keys(span.attributes).some((key) => key === "prism.delegation.child"),
    false,
    "no bespoke child attribute survives",
  );
});

test("provider error turn ends span with error status", () => {
  const memory = createInMemoryTelemetry();
  const telemetry = createOpenTelemetryInstrumentation({ tracer: memory.tracer, meter: memory.meter });
  telemetry.handleAgentEvent({
    type: "turn.started",
    sessionId: "s1",
    runId: "r1",
    turn: 1,
    metadata: { providerId: "mock", model: { provider: "mock", model: "demo" }, attempt: 2 },
  });
  telemetry.handleAgentEvent({
    type: "turn.completed",
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
          end() {
            ends.set(name, (ends.get(name) ?? 0) + 1);
          },
        };
      },
    },
  });
  telemetry.handleAgentEvent({ type: "run.started", sessionId: "s1", runId: "r1" });
  telemetry.handleAgentEvent({
    type: "turn.started",
    sessionId: "s1",
    runId: "r1",
    turn: 1,
    metadata: { providerId: "mock", model: { provider: "mock", model: "demo" } },
  });
  telemetry.handleAgentEvent({ type: "run.failed", sessionId: "s1", runId: "r1", error: { message: "aborted" } });
  telemetry.handleAgentEvent({ type: "run.failed", sessionId: "s1", runId: "r1", error: { message: "aborted again" } });
  assert.equal(ends.get("invoke_agent prism"), 1);
  assert.equal(ends.get("chat demo"), 1);

  async function* events(): AsyncIterableIterator<AgentEvent> {
    yield { type: "run.started", sessionId: "s2", runId: "r2" };
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
    const session = await (
      await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [
          providerPackage("test-provider", [
            {
              id: "mock",
              async *generate() {
                if (mode === "aborted") controller.abort(new Error("cancelled"));
                throw new Error(mode === "failed" ? "provider failed" : "cancelled");
              },
            },
          ]),
        ],
      })
    ).session();
    const detach = telemetry.attachSession(session);
    // The kernel settles a failed or aborted run as a non-completed result instead of rejecting.
    const result = await session.run("test", mode === "aborted" ? { signal: controller.signal } : undefined);
    assert.notEqual(result.status, "completed");
    detach();
    assert.ok(memory.spans.length > 0);
    assert.equal(
      memory.spans.every((span) => span.ended),
      true,
      `${mode} run leaked a span`,
    );
  }
});

test("token metrics follow GenAI semantic conventions without run-total double counting", () => {
  const memory = createInMemoryTelemetry();
  const telemetry = createOpenTelemetryInstrumentation({ tracer: memory.tracer, meter: memory.meter });
  const usage = { inputTokens: 10, outputTokens: 2, totalTokens: 12 };
  telemetry.handleAgentEvent({
    type: "turn.completed",
    sessionId: "s1",
    runId: "r1",
    turn: 1,
    metadata: { providerId: "mock", model: { provider: "mock", model: "demo" } },
    usage,
  });
  telemetry.handleAgentEvent({ type: "run.completed", sessionId: "s1", status: "completed", runId: "r1", usage });
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
    telemetry.handleAgentEvent({ type: "run.started", sessionId: "s1", runId: "r1" });
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
  telemetry.handleAgentEvent({ type: "run.started", sessionId: "s1", runId: "r1" });
  telemetry.handleAgentEvent({
    type: "turn.started",
    sessionId: "s1",
    runId: "r1",
    turn: 1,
    metadata: { providerId: "mock", model: { provider: "mock", model: "demo" } },
  });
  telemetry.handleAgentEvent({ type: "run.completed", sessionId: "s1", status: "completed", runId: "r1" });
  assert.ok(calls.includes("span:invoke_agent prism"));
  assert.equal(contexts[0], "host-parent");
  assert.equal(typeof contexts[1], "object");
});

test("feedback and evaluations project safe metadata without high-cardinality metric labels", () => {
  const memory = createInMemoryTelemetry();
  const telemetry = createOpenTelemetryInstrumentation({ tracer: memory.tracer, meter: memory.meter });
  telemetry.handleAgentEvent({ type: "run.started", sessionId: "session-secret", runId: "run-secret" });
  telemetry.handleRunFeedback({ runId: "run-secret", rating: 1, hasComment: true, tagCount: 2, scorerCount: 1, evaluationCount: 1 });
  telemetry.handleEvaluation({ runId: "run-secret", status: "scored", score: 0.75, hasReason: true });
  const run = memory.spans.find((span) => span.name === "invoke_agent prism");
  assert.deepEqual(
    run?.events.map((event) => event.name),
    ["prism.run.feedback", "gen_ai.evaluation.result"],
  );
  assert.equal(run?.events[0]?.attributes["prism.feedback.tag_count"], 2);
  assert.equal(run?.events[1]?.attributes["gen_ai.evaluation.score.value"], 0.75);
  const metricJson = JSON.stringify(
    memory.metrics.filter((metric) => metric.name.includes("feedback") || metric.name.includes("evaluation")),
  );
  assert.doesNotMatch(metricJson, /run-secret|session-secret|comment|scorer|evaluation_id|tag_count/);
  assert.match(metricJson, /positive|scored/);

  telemetry.handleAgentEvent({ type: "run.completed", sessionId: "session-secret", status: "completed", runId: "run-secret" });
  telemetry.handleRunFeedback({ runId: "run-after", hasComment: false, tagCount: 0, scorerCount: 0, evaluationCount: 0 });
  assert.ok(memory.spans.some((span) => span.name === "prism.run.feedback" && span.ended));
  assert.equal(telemetry.traceId("run-secret"), run?.traceId);
});

test("feedback exporter failures are isolated", () => {
  let errors = 0;
  const telemetry = createOpenTelemetryInstrumentation({
    tracer: {
      startSpan() {
        return {
          setAttribute() {},
          setStatus() {},
          addEvent() {
            throw new Error("feedback exporter down");
          },
          end() {},
        };
      },
    },
    onExporterError() {
      errors += 1;
    },
  });
  telemetry.handleAgentEvent({ type: "run.started", sessionId: "s1", runId: "r1" });
  assert.doesNotThrow(() =>
    telemetry.handleRunFeedback({ runId: "r1", hasComment: true, tagCount: 1, scorerCount: 0, evaluationCount: 0 }),
  );
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

test("field policy filters or masks exported span attributes (plan 027 Task 8)", () => {
  const memory = createInMemoryTelemetry();
  const telemetry = createOpenTelemetryInstrumentation({
    tracer: memory.tracer,
    meter: memory.meter,
    fieldPolicy: (input) => {
      if (input.path === "prism.origin.agent") return { action: "deny", reason: "no-child-leak" };
      if (input.path === "gen_ai.tool.name") return { action: "redact" };
      return { action: "allow" };
    },
  });
  telemetry.handleDelegation({
    type: "started",
    runId: "r1",
    delegationId: "d1",
    origin: { ...DELEGATE_ORIGIN, agent: "child-secret-id" },
  });
  telemetry.handleAgentEvent({
    type: "tool.started",
    sessionId: "s1",
    runId: "r1",
    call: { id: "c1", name: "secret-tool-name" },
  } as unknown as AgentEvent);
  const allAttrs = memory.spans.flatMap((span) => Object.entries(span.attributes));
  assert.equal(
    allAttrs.some(([k]) => k === "prism.origin.agent"),
    false,
    "denied attribute must be dropped",
  );
  const toolName = allAttrs.find(([k]) => k === "gen_ai.tool.name");
  assert.equal(toolName?.[1], "[REDACTED]", "redacted attribute must be masked");
});

test("telemetry field policy errors drop the attribute and never echo the value", () => {
  const memory = createInMemoryTelemetry();
  const telemetry = createOpenTelemetryInstrumentation({
    tracer: memory.tracer,
    meter: memory.meter,
    fieldPolicy: () => {
      throw new Error("policy exploded");
    },
  });
  telemetry.handleDelegation({
    type: "started",
    runId: "r2",
    delegationId: "d2",
    origin: { ...DELEGATE_ORIGIN, agent: "secret-value" },
  } satisfies DelegationTelemetry);
  const attrs = memory.spans.flatMap((span) => Object.entries(span.attributes));
  assert.ok(!JSON.stringify(attrs).includes("secret-value"), "no value may reach the sink on policy error");
});

test("observability_emits_gen_ai_evaluation_result through the structural sink after a run settles", () => {
  const memory = createInMemoryTelemetry();
  const instrumentation = createOpenTelemetryInstrumentation({ tracer: memory.tracer, meter: memory.meter });
  const sink = {
    handleEvaluation: (evaluation: import("../instrumentation.js").EvaluationTelemetry) => instrumentation.handleEvaluation(evaluation),
  };
  instrumentation.handleAgentEvent({ type: "run.started", sessionId: "session", runId: "run" });
  instrumentation.handleAgentEvent({ type: "run.completed", sessionId: "session", status: "completed", runId: "run" });
  for (const status of ["scored", "skipped", "failed"] as const) {
    sink.handleEvaluation({
      runId: "run",
      name: "quality",
      status,
      ...(status === "scored" ? { score: 0.75 } : {}),
      hasReason: status !== "failed",
    });
  }
  const spans = memory.spans.filter((span) => span.name === "gen_ai.evaluation.result");
  assert.equal(spans.length, 3);
  assert.ok(spans.every((span) => span.ended));
  assert.deepEqual(
    spans.map((span) => span.attributes),
    ["scored", "skipped", "failed"].map((status) => ({
      "prism.run_id": "run",
      "gen_ai.evaluation.name": "quality",
      "prism.evaluation.status": status,
      "prism.evaluation.has_reason": status !== "failed",
      ...(status === "scored" ? { "gen_ai.evaluation.score.value": 0.75 } : {}),
    })),
  );
  assert.doesNotMatch(JSON.stringify(spans), /explanation|reason_text|metadata|error/);
});
