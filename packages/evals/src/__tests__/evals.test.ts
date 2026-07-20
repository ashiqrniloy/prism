import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAgent,
  createMockProvider,
  createMemoryRunFeedbackStore,
  createSecretRedactor,
  providerDone,
  providerTextDelta,
  providerUsage,
  type AgentRunResult,
  type ProductionPersistenceStore,
} from "@arnilo/prism";
import {
  appendEvaluationFeedback,
  assertEvaluationThreshold,
  createMemoryEvaluationStore,
  createModelJudge,
  createPersistenceTraceResolver,
  defineDataset,
  defineScorer,
  EvalDatasetError,
  EvalError,
  runComparison,
  runExperiment,
  scoreRun,
  serializeEvaluationReport,
  scoreRunLive,
} from "../index.js";

function mockAgent(text: string) {
  return createAgent({
    model: { provider: "mock", model: "demo" },
    provider: createMockProvider([
      providerTextDelta(text),
      providerUsage({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
      providerDone(),
    ]),
  });
}

function sampleResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    sessionId: "session_1",
    runId: "run_1",
    status: "succeeded",
    text: "hello [citation]",
    content: [{ type: "text", text: "hello [citation]" }],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    ...overrides,
  };
}

describe("defineScorer / scoreRun", () => {
  it("scores deterministically and rejects out-of-range scores", async () => {
    const ok = defineScorer({
      id: "contains-citation",
      score: ({ result }) => ({ score: result.text.includes("[") ? 1 : 0, reason: "bracket" }),
    });
    const records = await scoreRun({ result: sampleResult(), scorers: [ok] });
    assert.equal(records.length, 1);
    assert.equal(records[0]?.status, "scored");
    assert.equal(records[0]?.score, 1);
    assert.equal(records[0]?.runId, "run_1");

    const bad = defineScorer({
      id: "bad",
      score: () => ({ score: 2 }),
    });
    const failed = await scoreRun({ result: sampleResult(), scorers: [bad] });
    assert.equal(failed[0]?.status, "failed");
    assert.ok(failed[0]?.error?.message.includes("[0, 1]"));
  });

  it("honors sampleRate skips without invoking the scorer body", async () => {
    let calls = 0;
    const scorer = defineScorer({
      id: "counted",
      score: () => {
        calls += 1;
        return { score: 1 };
      },
    });
    const skipped = await scoreRun({
      result: sampleResult(),
      scorers: [scorer],
      sampleRate: 0,
    });
    assert.equal(calls, 0);
    assert.equal(skipped[0]?.status, "skipped");
    assert.equal(skipped[0]?.sampled, false);

    const scored = await scoreRun({
      result: sampleResult(),
      scorers: [scorer],
      sampleRate: 0.5,
      random: () => 0.1,
    });
    assert.equal(calls, 1);
    assert.equal(scored[0]?.status, "scored");
  });

  it("records scorer abort/timeout as failed without throwing", async () => {
    const controller = new AbortController();
    controller.abort(new Error("timeout"));
    const scorer = defineScorer({
      id: "abortable",
      score: ({ signal }) => {
        signal?.throwIfAborted();
        return { score: 1 };
      },
    });
    const records = await scoreRun({
      result: sampleResult(),
      scorers: [scorer],
      signal: controller.signal,
    });
    assert.equal(records[0]?.status, "failed");
    assert.match(records[0]?.error?.message ?? "", /timeout|abort/i);
  });
});

describe("evaluation feedback linkage", () => {
  it("links matching evaluation ids/scorers without copying scorer payloads", async () => {
    const ownership = { tenantId: "tenant-a", userId: "user-a" } as const;
    const feedback = createMemoryRunFeedbackStore({
      resolveRun: ({ runId }) => ({ runId, sessionId: "session_1", traceId: "trace_1", ...ownership }),
    });
    const evaluation = {
      id: "eval-1",
      scorerId: "quality",
      status: "scored" as const,
      sampled: true,
      score: 1,
      reason: "private scorer reason",
      runId: "run_1",
      sessionId: "session_1",
      traceId: "trace_1",
      createdAt: "2026-01-01T00:00:00Z",
      ...ownership,
    };
    const evaluationStore = createMemoryEvaluationStore([evaluation]);
    const record = await appendEvaluationFeedback({
      feedbackStore: feedback,
      evaluationStore,
      evaluationIds: [evaluation.id],
      feedback: { id: "feedback-1", runId: "run_1", traceId: "trace_1", rating: 1, ...ownership },
    });
    assert.deepEqual(record.evaluationIds, ["eval-1"]);
    assert.deepEqual(record.scorerIds, ["quality"]);
    assert.doesNotMatch(JSON.stringify(record), /private scorer reason/);
    await assert.rejects(appendEvaluationFeedback({
      feedbackStore: feedback,
      evaluationStore: createMemoryEvaluationStore([{ ...evaluation, runId: "other" }]),
      evaluationIds: [evaluation.id],
      feedback: { id: "feedback-2", runId: "run_1", rating: 1, ...ownership },
    }), EvalError);
    await assert.rejects(appendEvaluationFeedback({
      feedbackStore: feedback,
      evaluationStore,
      evaluationIds: ["missing"],
      feedback: { id: "feedback-3", runId: "run_1", rating: 1, ...ownership },
    }), /evaluation not found/);
  });
});

describe("defineDataset / store", () => {
  it("freezes datasets and rejects duplicate item ids", () => {
    const dataset = defineDataset({
      id: "qa",
      version: "1",
      items: [{ id: "1", input: "a", expected: "A" }],
    });
    assert.ok(Object.isFrozen(dataset));
    assert.ok(Object.isFrozen(dataset.items));
    assert.throws(
      () => defineDataset({ id: "qa", items: [{ id: "1", input: "a" }, { id: "1", input: "b" }] }),
      EvalDatasetError,
    );
  });

  it("filters by ownership and redacts secrets", async () => {
    const store = createMemoryEvaluationStore();
    const scorer = defineScorer({
      id: "secret-reason",
      score: () => ({ score: 1, reason: "token=SECRET_CANARY_VALUE" }),
    });
    const records = await scoreRun({
      result: sampleResult(),
      scorers: [scorer],
      store,
      ownership: { tenantId: "t1" },
      redactor: createSecretRedactor(["SECRET_CANARY_VALUE"]),
    });
    assert.equal(records[0]?.reason?.includes("SECRET_CANARY_VALUE"), false);
    assert.equal(records[0]?.reason?.includes("[REDACTED]"), true);

    const page = await store.query({ tenantId: "t1" });
    assert.equal(page.items.length, 1);
    const other = await store.query({ tenantId: "t2" });
    assert.equal(other.items.length, 0);
  });
});

describe("bounded trace, judge, comparison, and thresholds", () => {
  it("resolves an exact owner-scoped trace and supplies it to scorers", async () => {
    const ownership = { tenantId: "t1" } as const;
    const run = { id: "run_1", sessionId: "session_1", status: "succeeded" as const, startedAt: "2026-01-01T00:00:00Z", ...ownership };
    const store = {
      queryRuns: async () => ({ items: [run] }),
      queryEvents: async () => ({ items: [{ id: "e1", sessionId: "session_1", runId: "run_1", type: "agent_started", timestamp: run.startedAt, event: { type: "agent_started", agentId: "a", runId: "run_1", sessionId: "session_1", timestamp: run.startedAt }, redacted: true, ...ownership }] }),
      queryToolCalls: async () => ({ items: [] }),
      queryUsage: async () => ({ items: [] }),
    } as unknown as ProductionPersistenceStore;
    const records = await scoreRun({
      result: sampleResult(), ownership, traceResolver: createPersistenceTraceResolver(store),
      scorers: [defineScorer({ id: "trace", score: ({ target }) => ({ score: target?.trace?.events.length === 1 ? 1 : 0 }) })],
    });
    assert.equal(records[0]?.score, 1);
    await assert.rejects(() => createPersistenceTraceResolver(store)({ sessionId: "session_1", runId: "run_1", tenantId: "other" }), /ownership/);
  });

  it("bounds model judges, attributes rubrics, and records timeout failures", async () => {
    let attempts = 0;
    const judge = createModelJudge({
      id: "quality", rubric: "Score quality", rubricVersion: "v2", maxAttempts: 2,
      judge: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("retry");
        return { score: 0.8 };
      },
    });
    const scored = await scoreRun({ result: sampleResult(), scorers: [judge] });
    assert.equal(scored[0]?.score, 0.8);
    assert.equal(scored[0]?.metadata?.rubricVersion, "v2");
    assert.equal(attempts, 2);

    const timeout = createModelJudge({ id: "slow", rubric: "x", rubricVersion: "1", timeoutMs: 1, judge: () => new Promise(() => {}) });
    const failed = await scoreRun({ result: sampleResult(), scorers: [timeout] });
    assert.equal(failed[0]?.status, "failed");
    assert.match(failed[0]?.error?.message ?? "", /timeout/);
  });

  it("keeps pairwise order deterministic and gates bounded redacted reports", async () => {
    const dataset = defineDataset({ id: "pair", version: "1", items: [{ id: "i", input: "x" }] });
    const report = await runComparison({
      dataset,
      candidates: { zeta: async () => sampleResult({ text: "z" }), alpha: async () => sampleResult({ text: "a" }) },
      scorers: [{ id: "prefer-alpha", score: ({ left }) => ({ preference: left.name === "alpha" ? "left" : "right", reason: "SECRET" }) }],
      secrets: ["SECRET"],
    });
    assert.deepEqual(report.candidates, ["alpha", "zeta"]);
    assert.equal(report.wins.alpha, 1);
    assert.equal(report.records[0]?.reason, "[REDACTED]");
    assert.doesNotThrow(() => assertEvaluationThreshold(report, { maximumFailures: 0, minimumCandidateWins: { alpha: 1 } }));

    const experiment = await runExperiment({ agent: mockAgent("ok"), dataset, scorers: [defineScorer({ id: "s", score: () => ({ score: 1 }) })] });
    assert.doesNotThrow(() => assertEvaluationThreshold(experiment, { minimumMean: 1, maximumFailures: 0, minimumByScorer: { s: 1 } }));
    assert.throws(() => assertEvaluationThreshold(experiment, { minimumMean: 1, maximumFailures: 0, minimumByScorer: { missing: 1 } }), /missing mean/);
    assert.doesNotMatch(serializeEvaluationReport({ reason: "SECRET" }, { secrets: ["SECRET"] }), /SECRET/);
    assert.throws(() => serializeEvaluationReport(experiment, { maxBytes: 1 }), /byte limit/);
  });
});

describe("runExperiment / scoreRunLive", () => {
  it("bounds concurrency, preserves item order, and aggregates scores", async () => {
    let active = 0;
    let maxActive = 0;
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([
        providerTextDelta("answer"),
        providerDone(),
      ]),
    });
    const dataset = defineDataset({
      id: "batch",
      version: "v1",
      items: [
        { id: "a", input: "one", expected: "one" },
        { id: "b", input: "two", expected: "two" },
        { id: "c", input: "three", expected: "three" },
      ],
    });
    const scorer = defineScorer({
      id: "non-empty",
      score: async ({ result, item }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return { score: result.text.length > 0 ? 1 : 0, metadata: { itemId: item?.id } };
      },
    });

    const report = await runExperiment({
      agent,
      dataset,
      scorers: [scorer],
      concurrency: 2,
      experimentId: "exp_1",
    });

    assert.equal(report.status, "succeeded");
    assert.equal(report.experimentId, "exp_1");
    assert.equal(report.items.map((item) => item.item.id).join(","), "a,b,c");
    assert.equal(report.aggregate.itemCount, 3);
    assert.equal(report.aggregate.scoredCount, 3);
    assert.equal(report.aggregate.meanScore, 1);
    assert.ok(maxActive <= 2);
    assert.equal(report.evaluations.every((record) => record.experimentId === "exp_1"), true);
  });

  it("live scoring does not mutate the agent result and isolates failures", async () => {
    const agent = mockAgent("ok");
    const session = agent.createSession();
    const result = await session.run("hi");
    const snapshot = structuredClone(result);

    let sawError = false;
    const scorer = defineScorer({
      id: "throws",
      score: () => {
        throw new Error("scorer boom");
      },
    });
    const store = createMemoryEvaluationStore();
    const live = await scoreRunLive(result, {
      scorers: [scorer],
      store,
      onError: () => {
        sawError = true;
      },
    });
    assert.deepEqual(result, snapshot);
    assert.equal(live[0]?.status, "failed");
    assert.equal(sawError, false);
    assert.equal((await store.query()).items.length, 1);
  });

  it("rejects invalid concurrency", async () => {
    await assert.rejects(
      () => runExperiment({
        agent: mockAgent("x"),
        dataset: defineDataset({ id: "d", items: [{ id: "1", input: "x" }] }),
        scorers: [defineScorer({ id: "s", score: () => ({ score: 1 }) })],
        concurrency: 0,
      }),
      EvalError,
    );
  });
});
