import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowEvent } from "../../../runtime/workflows/types.js";
import { createInMemoryTelemetry, createOpenTelemetryInstrumentation } from "../instrumentation.js";
import { MAX_SUMMARY_DISTINCT_TOOLS, summarizeSession, summarizeTimeline } from "../summary.js";
import { projectWorkflowTimeline } from "../timeline.js";
import type { ExecutionStep, ExecutionTimeline } from "../timeline-types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTimeline(steps: ExecutionStep[], overrides: Partial<ExecutionTimeline> = {}): ExecutionTimeline {
  return {
    schemaVersion: 1,
    runId: "run-1",
    sessionId: "sess-1",
    status: "succeeded",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    steps: Object.freeze(steps),
    redacted: false,
    content: "metadata",
    ...overrides,
  };
}

// ─── Test 1: Tool counts cap at 64 + other ─────────────────────────────────────
test("summary toolCounts caps at 64 + other", () => {
  // Create 70 distinct tools with varying call frequencies:
  // tool_0 called 1 time, tool_1 called 2 times, ..., tool_69 called 70 times.
  const steps: ExecutionStep[] = [];
  let order = 0;
  let totalCalls = 0;

  for (let i = 0; i < 70; i++) {
    const count = i + 1;
    totalCalls += count;
    for (let c = 0; c < count; c++) {
      steps.push({
        id: `step-${order}`,
        kind: "tool",
        name: `tool_${i}`,
        order: order++,
        status: "succeeded",
        startedAt: "2026-01-01T00:00:00.000Z",
      });
    }
  }

  const timeline = makeTimeline(steps);
  const summary = summarizeTimeline(timeline);

  assert.equal(summary.toolCallCount, totalCalls);

  const keys = Object.keys(summary.toolCounts);
  // Must cap at 64 distinct named tools + 1 "other" bucket = 65 keys
  assert.equal(keys.length, MAX_SUMMARY_DISTINCT_TOOLS + 1);
  assert.ok(keys.includes("other"), "must include other bucket");

  // Sum of counts in tools 0..5 (the 6 lowest frequency tools: 1+2+3+4+5+6 = 21)
  const expectedOtherCount = 1 + 2 + 3 + 4 + 5 + 6;
  assert.equal(summary.toolCounts.other, expectedOtherCount);

  // Total calls across all buckets must equal the original toolCallCount
  const summed = Object.values(summary.toolCounts).reduce((acc, n) => acc + n, 0);
  assert.equal(summed, totalCalls);
});

// ─── Test 2: Session summary sums two runs without double-counting ─────────────

test("session summary sums two runs' tokens, does not double-count run_total + provider_turn", () => {
  // Run 1: has run_total usage (100 in, 50 out, 150 total) and provider_turn usage
  const run1Steps: ExecutionStep[] = [
    {
      id: "run-step-1",
      kind: "run",
      name: "run",
      order: 0,
      status: "succeeded",
      startedAt: "2026-01-01T00:00:00.000Z",
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cost: 0.05, currency: "USD" },
    },
    {
      id: "turn-1",
      kind: "turn",
      name: "turn-1",
      order: 1,
      status: "succeeded",
      startedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "prov-1",
      kind: "provider",
      name: "gpt-4",
      order: 2,
      status: "succeeded",
      startedAt: "2026-01-01T00:00:00.000Z",
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, // provider turn duplicates run_total
    },
    {
      id: "tool-1",
      kind: "tool",
      name: "read_file",
      order: 3,
      status: "succeeded",
      startedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const run1 = makeTimeline(run1Steps, {
    runId: "run-1",
    sessionId: "sess-abc",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:00.500Z",
  });

  // Run 2: has run_total usage (200 in, 80 out, 280 total) and 2 provider turns
  const run2Steps: ExecutionStep[] = [
    {
      id: "run-step-2",
      kind: "run",
      name: "run",
      order: 0,
      status: "succeeded",
      startedAt: "2026-01-01T00:00:01.000Z",
      usage: { inputTokens: 200, outputTokens: 80, totalTokens: 280, cost: 0.1, currency: "USD" },
    },
    {
      id: "turn-2",
      kind: "turn",
      name: "turn-1",
      order: 1,
      status: "succeeded",
      startedAt: "2026-01-01T00:00:01.000Z",
    },
    {
      id: "prov-2a",
      kind: "provider",
      name: "gpt-4",
      order: 2,
      status: "succeeded",
      startedAt: "2026-01-01T00:00:01.000Z",
      usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
    },
    {
      id: "prov-2b",
      kind: "provider",
      name: "gpt-4",
      order: 3,
      status: "succeeded",
      startedAt: "2026-01-01T00:00:01.500Z",
      usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
    },
  ];
  const run2 = makeTimeline(run2Steps, {
    runId: "run-2",
    sessionId: "sess-abc",
    startedAt: "2026-01-01T00:00:01.000Z",
    finishedAt: "2026-01-01T00:00:01.800Z",
  });

  const session = summarizeSession([run1, run2]);

  assert.equal(session.sessionId, "sess-abc");
  assert.equal(session.runCount, 2);
  assert.equal(session.durationMs, 1300);
  assert.equal(session.turnCount, 2);
  // Plan 096: provider-answered fixtures count as model turns.
  assert.deepEqual(session.turns, { model: 2, deterministic: 0 });
  assert.equal(session.toolCallCount, 1);
  assert.equal(session.providerAttempts, 3);

  // Crucial check: inputTokens must be 100 + 200 = 300, NEVER 600
  assert.equal(session.usage?.inputTokens, 300);
  assert.equal(session.usage?.outputTokens, 130);
  assert.equal(session.usage?.totalTokens, 430);
  assert.equal(session.cost?.amount, 0.15);
  assert.equal(session.cost?.currency, "USD");
  assert.equal(session.status, "succeeded");
});

// ─── Test 3: Workflow OTel start/finish + 2 node spans, parent/child ──────────

test("workflow OTel: start/finish + 2 node spans, parent/child; exporter throw does not fail runWorkflow", async () => {
  const memory = createInMemoryTelemetry();
  const telemetry = createOpenTelemetryInstrumentation({
    tracer: memory.tracer,
    meter: memory.meter,
  });

  const workflowId = "data-pipeline";
  const runId = "wf-run-101";

  // Simulate workflow execution events
  const events: WorkflowEvent[] = [
    { type: "workflow_started", workflowId, runId, timestamp: "2026-01-01T00:00:00Z", sequence: 1 },
    { type: "node_started", workflowId, runId, nodeId: "fetch_data", timestamp: "2026-01-01T00:00:00.100Z", sequence: 2 },
    { type: "node_finished", workflowId, runId, nodeId: "fetch_data", timestamp: "2026-01-01T00:00:00.300Z", sequence: 3 },
    { type: "node_started", workflowId, runId, nodeId: "process_data", timestamp: "2026-01-01T00:00:00.400Z", sequence: 4 },
    { type: "node_finished", workflowId, runId, nodeId: "process_data", timestamp: "2026-01-01T00:00:00.600Z", sequence: 5 },
    { type: "workflow_finished", workflowId, runId, status: "succeeded", timestamp: "2026-01-01T00:00:00.700Z", sequence: 6 },
  ];

  for (const event of events) {
    telemetry.handleWorkflowEvent(event);
  }

  // Check spans recorded
  assert.equal(memory.spans.length, 3);

  const rootSpan = memory.spans.find((s) => s.name === "invoke_workflow data-pipeline");
  assert.ok(rootSpan, "root workflow span must exist");
  assert.equal(rootSpan.ended, true);
  assert.equal(rootSpan.status?.code, "ok");

  const node1Span = memory.spans.find((s) => s.name === "prism.workflow.node fetch_data");
  assert.ok(node1Span, "node 1 span must exist");
  assert.equal(node1Span.parentSpanId, rootSpan.spanId, "node 1 must be child of root span");
  assert.equal(node1Span.traceId, rootSpan.traceId, "must share traceId");

  const node2Span = memory.spans.find((s) => s.name === "prism.workflow.node process_data");
  assert.ok(node2Span, "node 2 span must exist");
  assert.equal(node2Span.parentSpanId, rootSpan.spanId, "node 2 must be child of root span");
  assert.equal(node2Span.traceId, rootSpan.traceId, "must share traceId");

  // Trace ID resolver check
  assert.equal(telemetry.traceId(runId), rootSpan.traceId);

  // Exporter throw isolation check: telemetry must never throw to caller
  let exporterErrorCaught = false;
  const failingTelemetry = createOpenTelemetryInstrumentation({
    tracer: {
      startSpan() {
        throw new Error("Simulated exporter connection failure");
      },
    },
    onExporterError: (_err) => {
      exporterErrorCaught = true;
    },
  });

  assert.doesNotThrow(() => {
    failingTelemetry.handleWorkflowEvent({
      type: "workflow_started",
      workflowId: "fail-wf",
      runId: "wf-fail-1",
      timestamp: "2026-01-01T00:00:00Z",
      sequence: 1,
    });
  });
  assert.equal(exporterErrorCaught, true, "onExporterError must receive the caught exporter error");
});

// ─── Test 4: Disabled tracer records no spans ─────────────────────────────────

test("disabled tracer: no spans recorded", () => {
  const memory = createInMemoryTelemetry();
  const telemetry = createOpenTelemetryInstrumentation({
    enabled: false,
    tracer: memory.tracer,
  });

  telemetry.handleWorkflowEvent({
    type: "workflow_started",
    workflowId: "test-wf",
    runId: "run-disabled",
    timestamp: "2026-01-01T00:00:00Z",
    sequence: 1,
  });

  assert.equal(memory.spans.length, 0);
  assert.equal(telemetry.traceId("run-disabled"), undefined);
});

// ─── Test 5: Timeline traceId filled from instrumentation handle ───────────────

test("Timeline traceId filled from onTraceReference when host passes instrumentation handle", () => {
  const memory = createInMemoryTelemetry();
  const telemetry = createOpenTelemetryInstrumentation({
    tracer: memory.tracer,
  });

  const runId = "run-trace-fill";
  telemetry.handleWorkflowEvent({
    type: "workflow_started",
    workflowId: "wf-trace",
    runId,
    timestamp: "2026-01-01T00:00:00Z",
    sequence: 1,
  });

  const expectedTraceId = telemetry.traceId(runId);
  assert.ok(expectedTraceId, "traceId must be available from telemetry");

  // Project workflow timeline passing instrumentation handle
  const events: WorkflowEvent[] = [
    { type: "workflow_started", workflowId: "wf-trace", runId, timestamp: "2026-01-01T00:00:00Z", sequence: 1 },
    { type: "workflow_finished", workflowId: "wf-trace", runId, status: "succeeded", timestamp: "2026-01-01T00:00:01Z", sequence: 2 },
  ];

  const timeline = projectWorkflowTimeline(events, {
    instrumentation: telemetry,
  });

  assert.equal(timeline.traceId, expectedTraceId, "timeline.traceId must match telemetry traceId");
});

// ─── Test: deterministic (no-model) turns split the turn count (plan 096) ─────

test("summary turns split model vs deterministic turns", () => {
  const steps: ExecutionStep[] = [
    { id: "turn-1", kind: "turn", name: "turn-1", order: 1, status: "succeeded", startedAt: "2026-01-01T00:00:00.000Z" },
    {
      id: "provider-1",
      parentId: "turn-1",
      kind: "provider",
      name: "gpt-4",
      order: 2,
      status: "succeeded",
      startedAt: "2026-01-01T00:00:00.000Z",
    },
    { id: "turn-2", kind: "turn", name: "turn-2", order: 3, status: "succeeded", startedAt: "2026-01-01T00:00:00.500Z" },
    {
      id: "deterministic-2",
      parentId: "turn-2",
      kind: "deterministic",
      name: "desk",
      order: 4,
      status: "succeeded",
      startedAt: "2026-01-01T00:00:00.500Z",
      metadata: { turn: 2, middleware: "desk" },
    },
  ];

  const summary = summarizeTimeline(makeTimeline(steps));
  assert.equal(summary.turnCount, 2);
  assert.deepEqual(summary.turns, { model: 1, deterministic: 1 });
  assert.equal(summary.providerAttempts, 1);

  // A deterministic step that never landed under a turn step cannot turn into a model turn.
  const orphan = summarizeTimeline(
    makeTimeline([
      { id: "deterministic-1", kind: "deterministic", name: "desk", order: 1, status: "succeeded", startedAt: "2026-01-01T00:00:00.000Z" },
    ]),
  );
  assert.deepEqual(orphan.turns, { model: 0, deterministic: 1 });
});
