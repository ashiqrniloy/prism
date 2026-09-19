import assert from "node:assert/strict";
import test from "node:test";
import type { Agent, AgentRunResult, AIProvider, BeforeProviderTurnPayload } from "@arnilo/prism";
import { createAgent, createMiddlewareRegistry, providerDone } from "@arnilo/prism";
import type { ExecutionStep, ExecutionTimeline } from "../../observability/timeline-types.js";
import { defineDataset } from "../dataset.js";
import { runExperiment } from "../experiment.js";
import { createModelJudge } from "../judge.js";
import { runScenario } from "../scenarios.js";
import { scoreRun } from "../score.js";
import { defineScorer } from "../scorer.js";
import { assertEvaluationThreshold, EvalThresholdError } from "../threshold.js";
import {
  createApprovalBeforeEffectScorer,
  createDeterministicTurnScorer,
  createErrorClassScorer,
  createNoLoopScorer,
  createSchemaScorer,
  createStepBudgetScorer,
  createToolCallMatchScorer,
} from "../trajectory.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRunResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    sessionId: "sess-1",
    runId: "run-1",
    status: "succeeded",
    text: "all done",
    content: [],
    ...overrides,
  };
}

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
    content: "redacted_io",
    ...overrides,
  };
}

function makeToolStep(order: number, name: string, input?: unknown): ExecutionStep {
  return {
    id: `tool-${order}`,
    kind: "tool",
    name,
    order,
    status: "succeeded",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:00.100Z",
    ...(input !== undefined ? { input } : {}),
  };
}

// ─── Test 1: Match modes: strict, unordered, subset, superset ────────────────

test("tool call match scorer: strict, unordered, subset, superset", async () => {
  const stepSearch = makeToolStep(0, "search", { q: "prism" });
  const stepRead = makeToolStep(1, "read_file", { path: "/a" });
  const stepWrite = makeToolStep(2, "write_file", { path: "/b" });

  const timelineSeq = makeTimeline([stepSearch, stepRead]);
  const result = makeRunResult();

  // Strict: passes on exact sequence
  const strictScorer = createToolCallMatchScorer({
    mode: "strict",
    expected: ["search", "read_file"],
  });
  const resStrictPass = await strictScorer.score({ result, timeline: timelineSeq });
  assert.equal(resStrictPass.score, 1);

  // Strict: fails on reversed sequence
  const resStrictFail = await strictScorer.score({
    result,
    timeline: makeTimeline([stepRead, stepSearch]),
  });
  assert.equal(resStrictFail.score, 0);

  // Strict: fails on extra call
  const resStrictExtra = await strictScorer.score({
    result,
    timeline: makeTimeline([stepSearch, stepRead, stepWrite]),
  });
  assert.equal(resStrictExtra.score, 0);

  // Unordered: passes on reversed order
  const unorderedScorer = createToolCallMatchScorer({
    mode: "unordered",
    expected: ["read_file", "search"],
  });
  const resUnorderedPass = await unorderedScorer.score({ result, timeline: timelineSeq });
  assert.equal(resUnorderedPass.score, 1);

  // Unordered: fails on count mismatch
  const resUnorderedFail = await unorderedScorer.score({
    result,
    timeline: makeTimeline([stepSearch]),
  });
  assert.equal(resUnorderedFail.score, 0);

  // Subset: extra tool in actual fails
  const subsetScorer = createToolCallMatchScorer({
    mode: "subset",
    expected: ["search"],
  });
  const resSubsetFail = await subsetScorer.score({ result, timeline: timelineSeq });
  assert.equal(resSubsetFail.score, 0, "subset must fail when extra tool read_file is present");

  const resSubsetPass = await subsetScorer.score({
    result,
    timeline: makeTimeline([stepSearch]),
  });
  assert.equal(resSubsetPass.score, 1, "subset must pass when all actual calls are in expected");

  // Superset: extra tool in actual is ok, as long as expected is called
  const supersetScorer = createToolCallMatchScorer({
    mode: "superset",
    expected: ["search"],
  });
  const resSupersetPass = await supersetScorer.score({
    result,
    timeline: makeTimeline([stepSearch, stepRead, stepWrite]),
  });
  assert.equal(resSupersetPass.score, 1, "superset must pass when expected call is present even with extra tools");

  const resSupersetFail = await supersetScorer.score({
    result,
    timeline: makeTimeline([stepRead, stepWrite]),
  });
  assert.equal(resSupersetFail.score, 0, "superset must fail when expected call is missing");
});

// ─── Test 2: Forbidden tool invariant cannot be averaged away ────────────────

test("good answer after forbidden tool -> invariant 0; aggregate fails threshold", async () => {
  const stepGood = makeToolStep(0, "search", { q: "prism" });
  const stepForbidden = makeToolStep(1, "delete_database", {});
  const timeline = makeTimeline([stepGood, stepForbidden]);

  const result = makeRunResult({ text: "Superb answer" });

  const textScorer = defineScorer({
    id: "text_quality",
    score: () => ({ score: 1.0, reason: "excellent answer" }),
  });

  const invariantScorer = createToolCallMatchScorer({
    id: "no_forbidden_tool",
    mode: "superset",
    expected: ["search"],
    deny: ["delete_database"],
  });

  const records = await scoreRun({
    result,
    injectedTimeline: timeline,
    scorers: [textScorer, invariantScorer],
  });

  assert.equal(records.length, 2);
  const textRecord = records.find((r) => r.scorerId === "text_quality")!;
  const invRecord = records.find((r) => r.scorerId === "no_forbidden_tool")!;

  assert.equal(textRecord.score, 1.0);
  assert.equal(invRecord.score, 0.0);
  assert.ok(invRecord.reason?.includes("forbidden tool"));

  // Mock an experiment report with these evaluations
  const mockReport = {
    experimentId: "exp-1",
    datasetId: "ds-1",
    status: "succeeded" as const,
    items: [],
    evaluations: records,
    aggregate: {
      itemCount: 1,
      scoredCount: 2,
      skippedCount: 0,
      failedCount: 0,
      meanScore: 0.5, // (1.0 + 0.0) / 2
      scoresByScorer: {
        text_quality: { count: 1, mean: 1.0 },
        no_forbidden_tool: { count: 1, mean: 0.0 },
      },
      invariantsPassed: false,
    },
  };

  // Threshold check must fail because the hard invariant failed, even if minimumMean is lower
  assert.throws(
    () => assertEvaluationThreshold(mockReport, { minimumMean: 0.4 }),
    (err: unknown) => {
      assert.ok(err instanceof EvalThresholdError);
      assert.ok(err.message.includes("hard invariant failed"));
      return true;
    },
  );
});

// ─── Test 3: Approval-before-effect scorer ────────────────────────────────────

test("required ordering; missing/stale approval-before-effect -> 0", async () => {
  const approvalScorer = createApprovalBeforeEffectScorer({
    toolName: "execute_refund",
  });

  // 1. Missing approval: effect runs at order 0 with no prior hitl/guardrail approval
  const unapprovedTimeline = makeTimeline([makeToolStep(0, "execute_refund", { amount: 50 })]);
  const resUnapproved = await approvalScorer.score({
    result: makeRunResult(),
    timeline: unapprovedTimeline,
  });
  assert.equal(resUnapproved.score, 0);
  assert.ok(resUnapproved.reason?.includes("without prior approval"));

  // 2. Approved: HITL step appears before the effect
  const approvedTimeline = makeTimeline([
    {
      id: "hitl-0",
      kind: "hitl",
      name: "manager_review",
      order: 0,
      status: "succeeded",
      startedAt: "2026-01-01T00:00:00.000Z",
    },
    makeToolStep(1, "execute_refund", { amount: 50 }),
  ]);
  const resApproved = await approvalScorer.score({
    result: makeRunResult(),
    timeline: approvedTimeline,
  });
  assert.equal(resApproved.score, 1);

  // 3. Stale/Late approval: approval appears AFTER the effect
  const lateApprovalTimeline = makeTimeline([
    makeToolStep(0, "execute_refund", { amount: 50 }),
    {
      id: "hitl-1",
      kind: "hitl",
      name: "manager_review",
      order: 1,
      status: "succeeded",
      startedAt: "2026-01-01T00:00:01.000Z",
    },
  ]);
  const resLate = await approvalScorer.score({
    result: makeRunResult(),
    timeline: lateApprovalTimeline,
  });
  assert.equal(resLate.score, 0, "approval after effect must fail");
});

// ─── Test 4: Step budget scorer ──────────────────────────────────────────────

test("budget: over maxToolCalls -> 0 with reason", async () => {
  const budgetScorer = createStepBudgetScorer({
    maxToolCalls: 2,
    maxTurns: 3,
  });

  const passTimeline = makeTimeline([makeToolStep(0, "search"), makeToolStep(1, "read")]);
  const resPass = await budgetScorer.score({
    result: makeRunResult(),
    timeline: passTimeline,
  });
  assert.equal(resPass.score, 1);

  const failTimeline = makeTimeline([makeToolStep(0, "search"), makeToolStep(1, "read"), makeToolStep(2, "write")]);
  const resFail = await budgetScorer.score({
    result: makeRunResult(),
    timeline: failTimeline,
  });
  assert.equal(resFail.score, 0);
  assert.ok(resFail.reason?.includes("tool calls exceeded maxToolCalls"));
});

// ─── Test 5: No-loop scorer ───────────────────────────────────────────────────

test("loop: three identical tool+args -> 0", async () => {
  const noLoopScorer = createNoLoopScorer({ maxRepeatedToolCalls: 2 });

  // 3 consecutive calls with same name and same input arguments
  const loopTimeline = makeTimeline([
    makeToolStep(0, "retry_fetch", { url: "http://api" }),
    makeToolStep(1, "retry_fetch", { url: "http://api" }),
    makeToolStep(2, "retry_fetch", { url: "http://api" }),
  ]);

  const resLoop = await noLoopScorer.score({
    result: makeRunResult(),
    timeline: loopTimeline,
  });
  assert.equal(resLoop.score, 0);
  assert.ok(resLoop.reason?.includes("loop detected"));

  // 2 calls with same name and arguments is below threshold (threshold is 2, so 2 is allowed)
  const okTimeline = makeTimeline([
    makeToolStep(0, "retry_fetch", { url: "http://api" }),
    makeToolStep(1, "retry_fetch", { url: "http://api" }),
    makeToolStep(2, "other_tool", { url: "http://api" }),
  ]);
  const resOk = await noLoopScorer.score({
    result: makeRunResult(),
    timeline: okTimeline,
  });
  assert.equal(resOk.score, 1);
});

// ─── Test 6: Environment scorer sees host object, not model text ─────────────

test("environment scorer sees host object, not model text", async () => {
  const hostTicketData = {
    ticketId: "T-42",
    status: "closed",
    resolvedAt: "2026-01-01T01:00:00Z",
  };

  const envScorer = defineScorer({
    id: "ticket_closed_in_db",
    score: (input) => {
      const env = input.environment as typeof hostTicketData | undefined;
      assert.ok(env, "environment must be provided to scorer");
      assert.equal(env.ticketId, "T-42");
      return {
        score: env.status === "closed" ? 1 : 0,
        metadata: { ticketId: env.ticketId },
      };
    },
  });

  const records = await scoreRun({
    result: makeRunResult({ text: "I have closed your ticket T-42" }),
    scorers: [envScorer],
    environment: hostTicketData,
  });

  assert.equal(records.length, 1);
  assert.equal(records[0]?.score, 1);
});

// ─── Test 7: Default timeline: off JSON is comparable to pre-change fixture ──

test("default timeline: off experiment JSON comparable to pre-change fixture", async () => {
  const mockAgent = {
    config: {},
    createSession() {
      return {
        id: "sess-mock",
        agent: undefined,
        currentLeafId: undefined,
        async run() {
          return makeRunResult({ text: "mock response" });
        },
        subscribe() {
          return {
            async *[Symbol.asyncIterator]() {},
          };
        },
      };
    },
  } as unknown as Agent;

  const dataset = defineDataset({
    id: "test-ds",
    items: [{ id: "item-1", input: "hello" }],
  });

  const simpleScorer = defineScorer({
    id: "has_text",
    score: (input) => ({ score: input.result.text ? 1 : 0 }),
  });

  const report = await runExperiment({
    agent: mockAgent,
    dataset,
    scorers: [simpleScorer],
    timeline: "off",
  });

  assert.equal(report.status, "succeeded");
  assert.equal(report.items.length, 1);
  assert.equal(report.evaluations.length, 1);
  assert.equal(report.aggregate.meanScore, 1);
  // Evaluated without needing a timeline
  assert.equal(report.aggregate.invariantsPassed, undefined);
});

// ─── Test 8: Judge request contains target.timeline only when enabled ─────────

test("judge request contains target.timeline only when enabled; still no tools/credentials", async () => {
  let capturedTarget: any;

  const judgeScorer = createModelJudge({
    id: "test_judge",
    rubric: "Rate answer quality 0-1",
    rubricVersion: "v1",
    judge: async (req) => {
      capturedTarget = req.target;
      return { score: 1.0, reason: "good" };
    },
  });

  const timeline = makeTimeline([makeToolStep(0, "search", { q: "test" })]);
  const result = makeRunResult({ text: "model answer" });

  // 1. With timeline present
  await judgeScorer.score({
    result,
    timeline,
  });

  assert.ok(capturedTarget);
  assert.ok(capturedTarget.result);
  assert.ok(capturedTarget.timeline);
  assert.equal(capturedTarget.timeline.runId, "run-1");
  // Verified: no provider tools, credentials, or secrets in target
  assert.equal(capturedTarget.tools, undefined);
  assert.equal(capturedTarget.credentials, undefined);

  // 2. Without timeline
  capturedTarget = undefined;
  await judgeScorer.score({
    result,
  });

  assert.ok(capturedTarget);
  assert.ok(capturedTarget.result);
  assert.equal(capturedTarget.timeline, undefined, "timeline must be undefined when not projected/enabled");
});

// ─── Test 9: Schema scorer validation ─────────────────────────────────────────

test("schema scorer validates result JSON against schema", async () => {
  const schemaScorer = createSchemaScorer({
    schema: {
      type: "object",
      properties: {
        count: { type: "number" },
        name: { type: "string" },
      },
      required: ["count", "name"],
    },
  });

  // Valid output
  const resPass = await schemaScorer.score({
    result: makeRunResult({ text: JSON.stringify({ count: 5, name: "Prism" }) }),
  });
  assert.equal(resPass.score, 1);

  // Invalid output
  const resFail = await schemaScorer.score({
    result: makeRunResult({ text: JSON.stringify({ count: "not-a-number" }) }),
  });
  assert.equal(resFail.score, 0);
  assert.ok(resFail.reason?.includes("schema validation failed"));
});

// ─── Test 10: Error class scorer ──────────────────────────────────────────────

test("error class scorer flags denied error codes", async () => {
  const errorScorer = createErrorClassScorer({
    deny: ["ERR_SECURITY_DENIED", "ERR_FATAL"],
  });

  const okTimeline = makeTimeline([makeToolStep(0, "search")]);
  const resOk = await errorScorer.score({
    result: makeRunResult(),
    timeline: okTimeline,
  });
  assert.equal(resOk.score, 1);

  const deniedTimeline = makeTimeline([
    {
      id: "step-err",
      kind: "tool",
      name: "sensitive_api",
      order: 0,
      status: "failed",
      startedAt: "2026-01-01T00:00:00Z",
      error: { message: "Access denied", code: "ERR_SECURITY_DENIED" },
    },
  ]);
  const resDenied = await errorScorer.score({
    result: makeRunResult(),
    timeline: deniedTimeline,
  });
  assert.equal(resDenied.score, 0);
  assert.ok(resDenied.reason?.includes("ERR_SECURITY_DENIED"));
});

// ─── Deterministic (no-model) turn coverage scorer (plan 096) ────────────────

test("deterministic turn scorer: passes on host-answered coverage, fails on model-only and provenance lies", async () => {
  const scorer = createDeterministicTurnScorer({ middleware: "desk" });
  const modelOnly = await scorer.score({
    result: makeRunResult(),
    timeline: makeTimeline([
      { id: "turn-1", kind: "turn", name: "turn-1", order: 1, status: "succeeded", startedAt: "2026-01-01T00:00:00Z" },
      {
        id: "provider-1",
        parentId: "turn-1",
        kind: "provider",
        name: "gpt-4",
        order: 2,
        status: "succeeded",
        startedAt: "2026-01-01T00:00:00Z",
      },
    ]),
  });
  assert.equal(modelOnly.score, 0);
  assert.match(modelOnly.reason ?? "", /expected at least 1 deterministic turn/);
  assert.deepEqual(modelOnly.metadata, { invariant: true, deterministicTurns: 0, modelTurns: 1 });

  const answered = await scorer.score({
    result: makeRunResult(),
    timeline: makeTimeline([
      { id: "turn-1", kind: "turn", name: "turn-1", order: 1, status: "succeeded", startedAt: "2026-01-01T00:00:00Z" },
      {
        id: "deterministic-1",
        parentId: "turn-1",
        kind: "deterministic",
        name: "desk",
        order: 2,
        status: "succeeded",
        startedAt: "2026-01-01T00:00:00Z",
        metadata: { turn: 1, middleware: "desk" },
      },
    ]),
  });
  assert.equal(answered.score, 1);
  assert.deepEqual(answered.metadata, { invariant: true, deterministicTurns: 1, modelTurns: 0 });

  // Same turn both answered deterministically and called the provider: provenance lie, not a pass.
  const lie = await scorer.score({
    result: makeRunResult(),
    timeline: makeTimeline([
      { id: "turn-1", kind: "turn", name: "turn-1", order: 1, status: "succeeded", startedAt: "2026-01-01T00:00:00Z" },
      {
        id: "deterministic-1",
        parentId: "turn-1",
        kind: "deterministic",
        name: "desk",
        order: 2,
        status: "succeeded",
        startedAt: "2026-01-01T00:00:00Z",
        metadata: { turn: 1, middleware: "desk" },
      },
      {
        id: "provider-1",
        parentId: "turn-1",
        kind: "provider",
        name: "gpt-4",
        order: 3,
        status: "succeeded",
        startedAt: "2026-01-01T00:00:00Z",
      },
    ]),
  });
  assert.equal(lie.score, 0);
  assert.match(lie.reason ?? "", /provenance violated/);
});

test("deterministic turn scorer: a real no-model scenario scores 1, the provider control scores 0", async () => {
  let providerCalls = 0;
  const provider: AIProvider = {
    id: "desk-mock",
    async *generate() {
      providerCalls += 1;
      yield providerDone();
    },
  };
  const middleware = createMiddlewareRegistry();
  middleware.use<BeforeProviderTurnPayload>("beforeProviderTurn", (payload) => ({
    ...payload,
    answer: { content: [{ type: "text", text: "answered from local records" }], provenance: { middleware: "desk" } },
  }));

  const answered = await runScenario({
    agent: createAgent({ model: { provider: "mock", model: "desk-mock" }, provider, middleware }),
    turns: [{ user: "what is the desk?", assertReply: (text) => assert.equal(text, "answered from local records") }],
    scorers: [createDeterministicTurnScorer()],
    timeline: "metadata",
  });
  assert.equal(answered.status, "succeeded");
  assert.equal(providerCalls, 0, "the answered scenario must not reach the provider");
  assert.equal(answered.evaluations[0]?.status, "scored");
  assert.equal(answered.evaluations[0]?.score, 1, answered.evaluations[0]?.reason);
  assert.deepEqual(answered.evaluations[0]?.metadata, { invariant: true, deterministicTurns: 1, modelTurns: 0 });

  const control = await runScenario({
    agent: createAgent({ model: { provider: "mock", model: "desk-mock" }, provider }),
    turns: ["what is the desk?"],
    scorers: [createDeterministicTurnScorer()],
    timeline: "metadata",
  });
  assert.equal(providerCalls, 1);
  assert.equal(control.evaluations[0]?.score, 0);
  assert.match(control.evaluations[0]?.reason ?? "", /expected at least 1 deterministic turn/);
});
