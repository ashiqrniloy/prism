import assert from "node:assert/strict";
import test from "node:test";
import type { AgentEvent } from "@arnilo/prism";
import { createSecretRedactor } from "@arnilo/prism";
import type { WorkflowCheckpointValue, WorkflowEvent } from "../../../runtime/workflows/types.js";
import type { EvaluationTrace } from "../../evals/types.js";
import {
  createTimelineFolder,
  createWorkflowTimelineFolder,
  projectAgentTimeline,
  projectTraceTimeline,
  projectWorkflowTimeline,
  TimelineError,
} from "../timeline.js";
import { summarizeTimeline } from "../summary.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sid = "session-1";
const rid = "run-1";
const ts = "2026-01-01T00:00:00.000Z";

function agentEvent(type: string, extra: Record<string, unknown> = {}): AgentEvent {
  return { type, sessionId: sid, runId: rid, ...extra } as AgentEvent;
}

// ─── Test 1: Agent run with 2 turns, 1 tool ──────────────────────────────────

test("agent run with 2 turns 1 tool: order and parentIds correct, default no args", () => {
  const events: AgentEvent[] = [
    agentEvent("agent_started"),
    agentEvent("turn_started", { turn: 1 }),
    agentEvent("provider_turn_started", { turn: 1, metadata: { providerId: "mock", model: "gpt-4", attempt: 1 } }),
    agentEvent("tool_execution_started", { call: { id: "tc-1", name: "search", arguments: { q: "hello" } } }),
    agentEvent("tool_execution_finished", {
      result: { toolCallId: "tc-1", name: "search", value: "result-value" },
      metadata: { durationMs: 100, status: "finished" },
    }),
    agentEvent("provider_turn_finished", {
      turn: 1,
      metadata: { providerId: "mock", model: "gpt-4", attempt: 1 },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    }),
    agentEvent("turn_finished", { turn: 1 }),
    agentEvent("turn_started", { turn: 2 }),
    agentEvent("provider_turn_started", { turn: 2, metadata: { providerId: "mock", model: "gpt-4", attempt: 1 } }),
    agentEvent("provider_turn_finished", {
      turn: 2,
      metadata: { providerId: "mock", model: "gpt-4", attempt: 1 },
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    }),
    agentEvent("turn_finished", { turn: 2 }),
    agentEvent("agent_finished", { usage: { inputTokens: 30, outputTokens: 15, totalTokens: 45 } }),
  ];

  const timeline = projectAgentTimeline(events);

  // Verify schema version and metadata.
  assert.equal(timeline.schemaVersion, 1);
  assert.equal(timeline.runId, rid);
  assert.equal(timeline.content, "metadata");
  assert.equal(timeline.redacted, true); // metadata mode always sets redacted

  // Verify step kinds and order.
  const kinds = timeline.steps.map((s) => s.kind);
  assert.deepStrictEqual(kinds, ["run", "turn", "provider", "tool", "turn", "provider"]);

  // Verify orders are sequential.
  const orders = timeline.steps.map((s) => s.order);
  assert.deepStrictEqual(orders, [0, 1, 2, 3, 4, 5]);

  // Verify parentIds form correct tree.
  const runStep = timeline.steps[0]!;
  const turn1 = timeline.steps[1]!;
  const provider1 = timeline.steps[2]!;
  const tool1 = timeline.steps[3]!;
  const turn2 = timeline.steps[4]!;

  assert.equal(runStep.parentId, undefined);
  assert.equal(turn1.parentId, runStep.id);
  assert.equal(provider1.parentId, turn1.id);
  assert.equal(tool1.parentId, turn1.id);
  assert.equal(turn2.parentId, runStep.id);

  // Default metadata content — tool args/results must be absent.
  assert.equal(tool1.input, undefined, "tool input must be absent in metadata mode");
  assert.equal(tool1.output, undefined, "tool output must be absent in metadata mode");

  // Status check.
  assert.equal(tool1.status, "succeeded");
  assert.equal(runStep.status, "succeeded");
});

// ─── Test 2: redacted_io includes redacted tool args; secret string absent ───

test("redacted_io includes tool args with secrets redacted", () => {
  const secret = "sk-supersecret-key-12345";
  const redactor = createSecretRedactor([secret]);

  const events: AgentEvent[] = [
    agentEvent("agent_started"),
    agentEvent("turn_started", { turn: 1 }),
    agentEvent("tool_execution_started", {
      call: { id: "tc-1", name: "api_call", arguments: { key: secret, query: "safe" } },
    }),
    agentEvent("tool_execution_finished", {
      result: { toolCallId: "tc-1", name: "api_call", value: { data: `response with ${secret} inside` } },
      metadata: { durationMs: 50, status: "finished" },
    }),
    agentEvent("turn_finished", { turn: 1 }),
    agentEvent("agent_finished"),
  ];

  const timeline = projectAgentTimeline(events, { content: "redacted_io", redactor });

  assert.equal(timeline.content, "redacted_io");

  const toolStep = timeline.steps.find((s) => s.kind === "tool")!;
  assert.ok(toolStep.input !== undefined, "tool input must be present in redacted_io mode");
  assert.ok(toolStep.output !== undefined, "tool output must be present in redacted_io mode");

  // Secret must not appear in the timeline JSON.
  const json = JSON.stringify(timeline);
  assert.ok(!json.includes(secret), "secret must not appear anywhere in redacted_io timeline");
});

// ─── Test 3: Persistence trace round-trip equals live fold ───────────────────

test("persistence trace fold matches live fold for same events (order + kinds + names)", () => {
  const events: AgentEvent[] = [
    agentEvent("agent_started"),
    agentEvent("turn_started", { turn: 1 }),
    agentEvent("provider_turn_started", { turn: 1, metadata: { providerId: "p", model: "m", attempt: 1 } }),
    agentEvent("provider_turn_finished", { turn: 1, metadata: { providerId: "p", model: "m", attempt: 1 } }),
    agentEvent("turn_finished", { turn: 1 }),
    agentEvent("agent_finished"),
  ];

  // Live fold.
  const liveTimeline = projectAgentTimeline(events);

  // Persistence fold — wrap events in AgentEventRecord shape.
  const eventRecords = events.map((e, i) => ({
    id: `evt-${i}`,
    sessionId: sid,
    runId: rid,
    sequence: i + 1,
    entryId: `entry-${i}`,
    type: e.type,
    timestamp: ts,
    event: e,
    redacted: true,
    tenantId: "t",
    accountId: "a",
    userId: "u",
  }));
  const trace: EvaluationTrace = {
    run: {
      id: rid,
      sessionId: sid,
      status: "succeeded",
      startedAt: ts,
      tenantId: "t",
      accountId: "a",
      userId: "u",
    },
    events: eventRecords,
    toolCalls: [],
    usage: [],
  };

  const traceTimeline = projectTraceTimeline(trace);

  // Verify kinds match.
  assert.deepStrictEqual(
    liveTimeline.steps.map((s) => s.kind),
    traceTimeline.steps.map((s) => s.kind),
    "step kinds must match between live and persistence fold",
  );

  // Verify names match.
  assert.deepStrictEqual(
    liveTimeline.steps.map((s) => s.name),
    traceTimeline.steps.map((s) => s.name),
    "step names must match between live and persistence fold",
  );

  // Verify order values match.
  assert.deepStrictEqual(
    liveTimeline.steps.map((s) => s.order),
    traceTimeline.steps.map((s) => s.order),
    "step orders must match between live and persistence fold",
  );
});

// ─── Test 4: Workflow 2-node DAG, checkpoint outputs with redacted_io ────────

test("workflow: 2-node DAG, checkpoint outputs appear only with checkpoint + redacted_io", () => {
  const wfId = "wf-1";
  const wfRunId = "wfr-1";

  const events: WorkflowEvent[] = [
    { type: "workflow_started", workflowId: wfId, runId: wfRunId, timestamp: "2026-01-01T00:00:00.000Z", sequence: 1 },
    { type: "node_started", workflowId: wfId, runId: wfRunId, nodeId: "nodeA", timestamp: "2026-01-01T00:00:01.000Z", sequence: 2 },
    { type: "node_finished", workflowId: wfId, runId: wfRunId, nodeId: "nodeA", timestamp: "2026-01-01T00:00:02.000Z", sequence: 3 },
    { type: "node_started", workflowId: wfId, runId: wfRunId, nodeId: "nodeB", timestamp: "2026-01-01T00:00:03.000Z", sequence: 4 },
    { type: "node_finished", workflowId: wfId, runId: wfRunId, nodeId: "nodeB", timestamp: "2026-01-01T00:00:04.000Z", sequence: 5 },
    {
      type: "workflow_finished",
      workflowId: wfId,
      runId: wfRunId,
      status: "succeeded",
      timestamp: "2026-01-01T00:00:05.000Z",
      sequence: 6,
    },
  ];

  const checkpoint: WorkflowCheckpointValue = {
    schemaVersion: 1,
    workflowId: wfId,
    runId: wfRunId,
    definitionHash: "hash-abc",
    status: "succeeded",
    readyNodeIds: [],
    completedNodeIds: ["nodeA", "nodeB"],
    nodes: {
      nodeA: { nodeId: "nodeA", status: "succeeded", output: { value: "resultA" } },
      nodeB: { nodeId: "nodeB", status: "succeeded", output: { value: "resultB" } },
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:05.000Z",
    redacted: false,
    metadata: { gitCommit: "abc123", docVersion: "v12" },
  };

  // Without checkpoint, metadata mode — no outputs.
  const metadataTimeline = projectWorkflowTimeline(events);
  const nodeSteps = metadataTimeline.steps.filter((s) => s.kind === "workflow_node");
  assert.equal(nodeSteps.length, 2);
  assert.equal(nodeSteps[0]!.output, undefined, "metadata mode must not have node output");
  assert.equal(nodeSteps[1]!.output, undefined, "metadata mode must not have node output");

  // With checkpoint + redacted_io — outputs present.
  const ioTimeline = projectWorkflowTimeline(events, { content: "redacted_io", checkpoint });
  const ioNodeSteps = ioTimeline.steps.filter((s) => s.kind === "workflow_node");
  assert.equal(ioNodeSteps.length, 2);
  assert.deepStrictEqual(ioNodeSteps[0]!.output, { value: "resultA" }, "checkpoint output must appear with redacted_io");
  assert.deepStrictEqual(ioNodeSteps[1]!.output, { value: "resultB" }, "checkpoint output must appear with redacted_io");

  // Verify workflowId and revision from checkpoint.
  assert.equal(ioTimeline.workflowId, wfId);
  assert.equal(ioTimeline.workflowRevision, "hash-abc");
  // Checkpoint sidecar metadata is projected verbatim (redacted at save).
  assert.deepStrictEqual(ioTimeline.workflowMetadata, { gitCommit: "abc123", docVersion: "v12" });
  assert.equal(metadataTimeline.workflowMetadata, undefined, "no checkpoint = no workflow metadata");
});

// ─── Test 5: Bounds — 1,001st step fails closed ─────────────────────────────

test("1001st step fails closed with ERR_PRISM_TIMELINE_BOUNDS", () => {
  const events: AgentEvent[] = [agentEvent("agent_started")];
  // Generate 1,000 more tool start events (total 1,001 steps including the run step).
  for (let i = 0; i < 1_000; i++) {
    events.push(
      agentEvent("tool_execution_started", {
        call: { id: `tc-${i}`, name: `tool-${i}`, arguments: {} },
      }),
    );
  }

  assert.throws(
    () => projectAgentTimeline(events, { maxSteps: 1_000 }),
    (err: unknown) => {
      assert.ok(err instanceof TimelineError);
      assert.equal(err.code, "ERR_PRISM_TIMELINE_BOUNDS");
      return true;
    },
    "must throw ERR_PRISM_TIMELINE_BOUNDS when exceeding maxSteps",
  );
});

// ─── Test 6: Incremental folder snapshot matches one-shot project ─────────────

test("incremental folder snapshot matches one-shot projectAgentTimeline", () => {
  const events: AgentEvent[] = [
    agentEvent("agent_started"),
    agentEvent("turn_started", { turn: 1 }),
    agentEvent("tool_execution_started", { call: { id: "tc-1", name: "read_file", arguments: { path: "/tmp/a" } } }),
    agentEvent("tool_execution_finished", {
      result: { toolCallId: "tc-1", name: "read_file", value: "contents" },
      metadata: { durationMs: 10, status: "finished" },
    }),
    agentEvent("turn_finished", { turn: 1 }),
    agentEvent("agent_finished"),
  ];

  // One-shot.
  const oneshot = projectAgentTimeline(events);

  // Incremental.
  const folder = createTimelineFolder();
  for (const event of events) folder.push(event);
  const incremental = folder.snapshot();

  // Step kinds and names must match.
  assert.deepStrictEqual(
    oneshot.steps.map((s) => [s.kind, s.name, s.order]),
    incremental.steps.map((s) => [s.kind, s.name, s.order]),
    "folder snapshot must match one-shot projection (kinds, names, orders)",
  );

  assert.equal(oneshot.status, incremental.status, "status must match");
  assert.equal(oneshot.content, incremental.content, "content policy must match");
});

// ─── Additional tests ─────────────────────────────────────────────────────────

test("unknown event types are ignored, not thrown", () => {
  const events: AgentEvent[] = [
    agentEvent("agent_started"),
    { type: "future_unknown_event", sessionId: sid, runId: rid } as unknown as AgentEvent,
    agentEvent("agent_finished"),
  ];

  // Must not throw.
  const timeline = projectAgentTimeline(events);
  // Only run step from agent_started.
  assert.equal(timeline.steps.length, 1);
  assert.equal(timeline.steps[0]!.kind, "run");
});

test("workflow timeline folder matches one-shot project", () => {
  const wfId = "wf-2";
  const wfRunId = "wfr-2";

  const events: WorkflowEvent[] = [
    { type: "workflow_started", workflowId: wfId, runId: wfRunId, timestamp: ts, sequence: 1 },
    { type: "node_started", workflowId: wfId, runId: wfRunId, nodeId: "n1", timestamp: ts, sequence: 2 },
    { type: "node_finished", workflowId: wfId, runId: wfRunId, nodeId: "n1", timestamp: ts, sequence: 3 },
    { type: "workflow_finished", workflowId: wfId, runId: wfRunId, status: "succeeded", timestamp: ts, sequence: 4 },
  ];

  const oneshot = projectWorkflowTimeline(events);

  const folder = createWorkflowTimelineFolder();
  for (const event of events) folder.push(event);
  const incremental = folder.snapshot();

  assert.deepStrictEqual(
    oneshot.steps.map((s) => [s.kind, s.name, s.order]),
    incremental.steps.map((s) => [s.kind, s.name, s.order]),
    "workflow folder snapshot must match one-shot",
  );
});

test("traceId is forwarded to timeline", () => {
  const events: AgentEvent[] = [agentEvent("agent_started"), agentEvent("agent_finished")];
  const timeline = projectAgentTimeline(events, { traceId: "abc-123" });
  assert.equal(timeline.traceId, "abc-123");
});

test("attention_compiled folds into an attention step with measured counts", () => {
  const events: AgentEvent[] = [
    agentEvent("agent_started"),
    agentEvent("turn_started", { turn: 1 }),
    agentEvent("provider_turn_started", { turn: 1, metadata: { providerId: "mock", model: "gpt-4", attempt: 1 } }),
    agentEvent("attention_compiled", {
      used: 12_000,
      usedAfter: 9_000,
      inputCap: 15_000,
      triggerRatio: 0.75,
      droppedThinkingTurns: 0,
      stubbedToolResults: 4,
      stubbedBytes: 48_000,
      truncated: true,
    }),
    agentEvent("turn_finished", { turn: 1 }),
    agentEvent("agent_finished"),
  ];
  const timeline = projectAgentTimeline(events);
  const step = timeline.steps.find((s) => s.kind === "attention");

  assert.ok(step, "attention step must exist");
  assert.equal(step.name, "attention_compiled");
  assert.equal(step.status, "succeeded");
  assert.deepEqual(step.metadata, {
    used: 12_000,
    usedAfter: 9_000,
    inputCap: 15_000,
    triggerRatio: 0.75,
    droppedThinkingTurns: 0,
    stubbedToolResults: 4,
    stubbedBytes: 48_000,
    truncated: true,
  });
  assert.equal(timeline.steps.filter((s) => s.kind === "attention").length, 1);
});

test("guardrail decision creates a step", () => {
  const events: AgentEvent[] = [
    agentEvent("agent_started"),
    agentEvent("turn_started", { turn: 1 }),
    agentEvent("guardrail_decision", {
      toolCallId: "tc-1",
      toolName: "delete_account",
      record: {
        guardrail: "pack:destructive-commands/no-recursive-force-delete",
        stage: "pre_execution",
        action: "deny",
        reason: "Recursive force delete is not allowed",
      },
    }),
    agentEvent("turn_finished", { turn: 1 }),
    agentEvent("agent_finished"),
  ];
  const timeline = projectAgentTimeline(events);
  const guardStep = timeline.steps.find((s) => s.kind === "guardrail");
  assert.ok(guardStep, "guardrail step must exist");
  assert.equal(guardStep.status, "denied");
  assert.equal(guardStep.name, "pre_execution");
  // Rule identity rides the step so trajectory scorers can name the pack rule (plan 092 T3).
  assert.equal(guardStep.metadata?.guardrail, "pack:destructive-commands/no-recursive-force-delete");
  assert.equal(guardStep.metadata?.toolName, "delete_account");
});

test("delegation event creates a step", () => {
  const events: AgentEvent[] = [
    agentEvent("agent_started"),
    agentEvent("turn_started", { turn: 1 }),
    {
      type: "delegated_agent_step",
      sessionId: sid,
      runId: rid,
      adapterId: "claude-adapter",
      externalConversationId: "ext-1",
      stepIndex: 0,
      state: "done",
      kind: "assistant",
      durationMs: 500,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    } satisfies AgentEvent,
    agentEvent("turn_finished", { turn: 1 }),
    agentEvent("agent_finished"),
  ];
  const timeline = projectAgentTimeline(events);
  const delStep = timeline.steps.find((s) => s.kind === "delegation");
  assert.ok(delStep, "delegation step must exist");
  assert.equal(delStep.status, "succeeded");
  assert.equal(delStep.durationMs, 500);
});

test("maxSteps validation rejects invalid values", () => {
  assert.throws(
    () => projectAgentTimeline([], { maxSteps: 0 }),
    (err: unknown) => err instanceof TimelineError && err.code === "ERR_PRISM_TIMELINE_BOUNDS",
  );
  assert.throws(
    () => projectAgentTimeline([], { maxSteps: 10_001 }),
    (err: unknown) => err instanceof TimelineError && err.code === "ERR_PRISM_TIMELINE_BOUNDS",
  );
});

test("host turn-policy stop lands on the timeline as stopReason plus bounded detail", () => {
  const events: AgentEvent[] = [
    agentEvent("agent_started"),
    agentEvent("turn_started", { turn: 1 }),
    agentEvent("turn_finished", { turn: 1 }),
    agentEvent("agent_finished", { finishReason: "host_policy", stopDetail: "l1-first-plan-paint" }),
  ];
  const timeline = projectAgentTimeline(events);
  assert.equal(timeline.status, "finished:host_policy");
  assert.equal(timeline.stopReason, "host_policy");
  assert.equal(timeline.stopDetail, "l1-first-plan-paint");
  // A natural end carries neither field, so existing projections stay byte-identical.
  const natural = projectAgentTimeline([agentEvent("agent_started"), agentEvent("agent_finished")]);
  assert.equal(natural.status, "succeeded");
  assert.equal(natural.stopReason, undefined);
  assert.equal(natural.stopDetail, undefined);
});

// ─── Plan 087: per-turn stop reasons + terminal limit attribution ────────────

const STOP_REASONS = ["end_turn", "tool_calls", "max_output_tokens", "content_filter", "abort", "provider_error", "unknown"] as const;

function providerTurn(turn: number, attempt: number, stopReason: string): AgentEvent[] {
  return [
    agentEvent("provider_turn_started", { turn, metadata: { providerId: "mock", model: "m", attempt } }),
    agentEvent("provider_turn_finished", { turn, metadata: { providerId: "mock", model: "m", attempt, stopReason } }),
  ];
}

test("every taxonomy stop reason badges its turn and provider step", () => {
  for (const stopReason of STOP_REASONS) {
    const timeline = projectAgentTimeline([
      agentEvent("agent_started"),
      agentEvent("turn_started", { turn: 1 }),
      ...providerTurn(1, 1, stopReason),
      agentEvent("turn_finished", { turn: 1 }),
      agentEvent("agent_finished"),
    ]);

    assert.equal(timeline.turns?.length, 1, `${stopReason}: one turn projected`);
    assert.equal(timeline.turns?.[0]?.turn, 1);
    assert.equal(timeline.turns?.[0]?.providerAttempts, 1);
    assert.equal(timeline.turns?.[0]?.stopReason, stopReason);
    assert.equal(timeline.steps.find((step) => step.kind === "provider")?.metadata?.stopReason, stopReason);
  }
});

test("a retried turn counts both attempts and badges the last stop reason", () => {
  const timeline = projectAgentTimeline([
    agentEvent("agent_started"),
    agentEvent("turn_started", { turn: 1 }),
    ...providerTurn(1, 1, "provider_error"),
    ...providerTurn(1, 2, "end_turn"),
    agentEvent("turn_finished", { turn: 1 }),
    agentEvent("agent_finished"),
  ]);

  assert.equal(timeline.turns?.[0]?.providerAttempts, 2);
  assert.equal(timeline.turns?.[0]?.stopReason, "end_turn");
});

test("projects weighted cache hit rates and recorded budgets without zero fills", () => {
  const budgets = {
    inputTokens: 100,
    inputTokensSource: "estimated" as const,
    inputCap: 128_000,
    runInputBudget: 200_000,
    runInputUsed: 100,
    turns: 1,
    maxTurns: 40,
  };
  const timeline = projectAgentTimeline([
    agentEvent("agent_started"),
    agentEvent("turn_started", { turn: 1 }),
    agentEvent("provider_turn_started", { turn: 1, metadata: { providerId: "mock", model: "m", attempt: 1 } }),
    agentEvent("provider_turn_finished", {
      turn: 1,
      metadata: { providerId: "mock", model: "m", attempt: 1, budgets },
      usage: { inputTokens: 100, cacheReadTokens: 80, cacheWriteTokens: 20 },
    }),
    agentEvent("turn_finished", { turn: 1 }),
    agentEvent("turn_started", { turn: 2 }),
    agentEvent("provider_turn_started", { turn: 2, metadata: { providerId: "mock", model: "m", attempt: 1 } }),
    agentEvent("provider_turn_finished", {
      turn: 2,
      metadata: { providerId: "mock", model: "m", attempt: 1 },
      usage: { inputTokens: 300, cacheReadTokens: 60 },
    }),
    agentEvent("turn_finished", { turn: 2 }),
    agentEvent("turn_started", { turn: 3 }),
    agentEvent("provider_turn_started", { turn: 3, metadata: { providerId: "mock", model: "m", attempt: 1 } }),
    agentEvent("provider_turn_finished", {
      turn: 3,
      metadata: { providerId: "mock", model: "m", attempt: 1 },
      usage: { inputTokens: 200 },
    }),
    agentEvent("turn_finished", { turn: 3 }),
    agentEvent("agent_finished", { usage: { inputTokens: 600, cacheReadTokens: 140, cacheWriteTokens: 20 } }),
  ]);

  assert.equal(timeline.turns?.[0]?.cacheHitRate, 0.8);
  assert.deepEqual(timeline.turns?.[0]?.budgets, budgets);
  assert.equal(timeline.turns?.[1]?.cacheHitRate, 0.2);
  assert.equal(timeline.turns?.[1]?.budgets, undefined);
  assert.equal(timeline.turns?.[2]?.cacheHitRate, undefined);
  assert.equal(timeline.cacheHitRate, 140 / 600, "run rate is weighted by input tokens, not averaged per turn");
});

test("maxTurns death projects the terminal attribution block and its summary line", () => {
  const events: AgentEvent[] = [
    agentEvent("agent_started"),
    agentEvent("turn_started", { turn: 1 }),
    ...providerTurn(1, 1, "tool_calls"),
    agentEvent("turn_finished", { turn: 1 }),
    agentEvent("turn_started", { turn: 2 }),
    ...providerTurn(2, 1, "end_turn"),
    agentEvent("turn_finished", { turn: 2 }),
    agentEvent("run_limit_exceeded", { breach: { limit: "maxTurns", maximum: 2, observed: 3 } }),
    agentEvent("budget_exhausted", {
      limit: "maxTurns",
      consumed: { turns: 3, inputTokens: 1_200, providerAttempts: 3, requestBytes: 4_096 },
      closestOtherAxes: [
        { axis: "maxToolCalls", usedRatio: 0.625 },
        { axis: "maxInputTokens", usedRatio: 0.4 },
      ],
      recentToolCalls: [{ id: "tc-9", name: "searchCodebase", argHash: "sha256:abc" }],
    }),
    agentEvent("error", { error: { code: "run_limit_exceeded", message: "maxTurns" } }),
  ];

  const trace: EvaluationTrace = {
    run: { id: rid, sessionId: sid, status: "failed", startedAt: ts, tenantId: "t", accountId: "a", userId: "u" },
    events: events.map((event, index) => ({
      id: `evt-${index}`,
      sessionId: sid,
      runId: rid,
      sequence: index + 1,
      entryId: `entry-${index}`,
      type: event.type,
      timestamp: ts,
      event,
      redacted: true,
      tenantId: "t",
      accountId: "a",
      userId: "u",
    })),
    toolCalls: [],
    usage: [],
  };

  const timeline = projectTraceTimeline(trace);
  assert.deepStrictEqual(
    timeline.turns?.map((turn) => [turn.turn, turn.stopReason]),
    [
      [1, "tool_calls"],
      [2, "end_turn"],
    ],
  );
  assert.deepStrictEqual(timeline.exhaustion, {
    limit: "maxTurns",
    maximum: 2,
    observed: 3,
    consumed: { turns: 3, inputTokens: 1_200, providerAttempts: 3, requestBytes: 4_096 },
    closestOtherAxes: [
      { axis: "maxToolCalls", usedRatio: 0.625 },
      { axis: "maxInputTokens", usedRatio: 0.4 },
    ],
    recentToolCalls: [{ id: "tc-9", name: "searchCodebase", argHash: "sha256:abc" }],
  });
  assert.equal(timeline.status, "failed");

  assert.equal(summarizeTimeline(timeline).exhaustion, "maxTurns exhausted (3/2); closest: maxToolCalls 0.625, maxInputTokens 0.4");

  // A run that ended any other way carries neither field, so existing projections stay unchanged.
  const natural = projectAgentTimeline([agentEvent("agent_started"), agentEvent("agent_finished")]);
  assert.equal(natural.turns, undefined);
  assert.equal(natural.exhaustion, undefined);
  assert.equal(summarizeTimeline(natural).exhaustion, undefined);
});

// ─── Plan 096: deterministic (no-model) turns fold to their own kind ──────────

test("deterministic_turn folds to a deterministic step with provenance and no usage", () => {
  const events: AgentEvent[] = [
    agentEvent("agent_started"),
    agentEvent("turn_started", { turn: 1 }),
    agentEvent("deterministic_turn", { turn: 1, middleware: "desk" }),
    agentEvent("turn_finished", { turn: 1 }),
    agentEvent("agent_finished"),
  ];

  const timeline = projectAgentTimeline(events);

  assert.deepStrictEqual(
    timeline.steps.map((step) => step.kind),
    ["run", "turn", "deterministic"],
  );
  const turn = timeline.steps[1]!;
  const deterministic = timeline.steps[2]!;
  assert.equal(deterministic.parentId, turn.id);
  assert.equal(deterministic.name, "desk");
  assert.deepStrictEqual(deterministic.metadata, { turn: 1, middleware: "desk" });
  assert.equal(deterministic.usage, undefined, "a deterministic step must never carry usage");
  assert.deepStrictEqual(
    timeline.turns?.map(({ turn: n, providerAttempts, cacheHitRate }) => [n, providerAttempts, cacheHitRate]),
    [[1, 0, undefined]],
  );

  // Plan 096 Task 2: the summary splits the answered turn from model turns.
  const summary = summarizeTimeline(timeline);
  assert.equal(summary.turnCount, 1);
  assert.deepStrictEqual(summary.turns, { model: 0, deterministic: 1 });
  assert.equal(summary.providerAttempts, 0);
});
