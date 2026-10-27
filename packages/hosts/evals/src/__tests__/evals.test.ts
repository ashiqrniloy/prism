import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  createAgent,
  createSecretRedactor,
  type Agent,
  type AgentEvent,
  type Usage,
  type ProductionPersistenceStore,
  providerDone,
  providerTextDelta,
  providerToolCall,
  providerUsage,
  type RunResult,
} from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import { createMemoryEvaluationStore, createMemoryRunFeedbackStore } from "@arnilo/prism-store-codecs";
import {
  appendEvaluationFeedback,
  assertEvaluationThreshold,
  createErrorClassScorer,
  createModelJudge,
  createPersistenceTraceResolver,
  createToolCallMatchScorer,
  defineDataset,
  defineScorer,
  estimateOnline,
  EvalDatasetError,
  EvalError,
  passAtK,
  passHatK,
  paretoFrontier,
  runComparison,
  runExperiment,
  runScenario,
  scoreRun,
  scoreRunLive,
  serializeEvaluationReport,
} from "../index.js";
import { loadTimeline, setTimelineImporterForTests } from "../timeline.js";
import type { ExecutionStep, ExecutionTimeline } from "../types.js";

async function mockAgent(text: string) {
  return await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [
      mockProvider([[providerTextDelta(text), providerUsage({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }), providerDone()]]),
    ],
  });
}

function sampleResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    sessionId: "session_1",
    runId: "run_1",
    status: "completed",
    text: "hello [citation]",
    content: [{ type: "text", text: "hello [citation]" }],
    messages: [],
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

  it("honors sampling.rate skips and zero-probability strata without invoking the scorer body", async () => {
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
      sampling: { rate: 0.5 },
      random: () => 0.9,
    });
    assert.equal(calls, 0);
    assert.equal(skipped[0]?.status, "skipped");
    assert.equal(skipped[0]?.sampled, false);
    assert.deepEqual(skipped[0]?.metadata?.sampling, { stratum: "default", probability: 0.5 });

    const unrecorded = await scoreRun({
      result: sampleResult(),
      scorers: [scorer],
      sampling: { rate: 0 },
    });
    assert.equal(calls, 0);
    assert.equal(unrecorded.length, 0);

    const scored = await scoreRun({
      result: sampleResult(),
      scorers: [scorer],
      sampling: { rate: 0.5 },
      random: () => 0.1,
    });
    assert.equal(calls, 1);
    assert.equal(scored[0]?.status, "scored");
    assert.deepEqual(scored[0]?.metadata?.sampling, { stratum: "default", probability: 0.5 });
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

function stepTimeline(steps: ExecutionStep[]): ExecutionTimeline {
  return { schemaVersion: 1, status: "completed", startedAt: "2026-01-01T00:00:00.000Z", steps };
}

function toolStep(id: string, name: string, order: number): ExecutionStep {
  return { id, kind: "tool", name, order, status: "succeeded", startedAt: "2026-01-01T00:00:00.000Z" };
}

describe("scorer requirements", () => {
  it("throws before the run when a trajectory scorer has no timeline", async () => {
    let factoryCalls = 0;
    const agent = () => {
      factoryCalls += 1;
      return mockAgent("done");
    };
    const options = {
      agent,
      dataset: defineDataset({ id: "d", items: [{ id: "i", input: "x" }] }),
      scorers: [createErrorClassScorer()],
    };

    await assert.rejects(runExperiment(options), (error: any) => {
      assert.equal(error.code, "ERR_PRISM_EVAL_TIMELINE_REQUIRED");
      assert.match(error.message, /error_class/);
      return true;
    });
    assert.equal(factoryCalls, 0, "no agent was constructed");

    await assert.rejects(runExperiment({ ...options, timeline: "off" }), /requires timeline/);

    await assert.rejects(
      scoreRun({ result: sampleResult(), scorers: [createToolCallMatchScorer({ mode: "unordered", expected: [] })] }),
      (error: any) => error.code === "ERR_PRISM_EVAL_TIMELINE_REQUIRED",
    );

    // The agent is never reached, so a bare object proves the check runs before any turn.
    await assert.rejects(
      runScenario({ agent: {} as never, turns: ["hi"], scorers: [createErrorClassScorer()] }),
      (error: any) => error.code === "ERR_PRISM_EVAL_TIMELINE_REQUIRED",
    );
  });

  it("checks environment and trace requirements, and leaves undeclared scorers alone", async () => {
    const envScorer = defineScorer({ id: "env", requires: ["environment"], score: ({ environment }) => ({ score: environment ? 1 : 0 }) });
    await assert.rejects(scoreRun({ result: sampleResult(), scorers: [envScorer] }), (error: any) => {
      assert.equal(error.code, "ERR_PRISM_EVAL_ENVIRONMENT_REQUIRED");
      return true;
    });
    const withEnv = await scoreRun({ result: sampleResult(), scorers: [envScorer], environment: { ok: true } });
    assert.equal(withEnv[0]?.score, 1);

    const traceScorer = defineScorer({ id: "trace", requires: ["trace"], score: ({ target }) => ({ score: target?.trace ? 1 : 0 }) });
    await assert.rejects(scoreRun({ result: sampleResult(), scorers: [traceScorer] }), (error: any) => {
      assert.equal(error.code, "ERR_PRISM_EVAL_TRACE_REQUIRED");
      return true;
    });

    const plain = defineScorer({ id: "plain", score: () => ({ score: 1 }) });
    const records = await scoreRun({ result: sampleResult(), scorers: [plain] });
    assert.equal(records[0]?.score, 1, "a scorer without requires needs no timeline");
  });
});

describe("invariants", () => {
  const dataset = defineDataset({ id: "d", items: [{ id: "i", input: "x" }] });

  it("a throwing invariant scorer fails the gate and carries the flag on its failed record", async () => {
    const report = await runExperiment({
      agent: await mockAgent("done"),
      dataset,
      scorers: [
        defineScorer({
          id: "boom",
          invariant: true,
          score: () => {
            throw new Error("boom");
          },
        }),
      ],
    });
    assert.equal(report.evaluations[0]?.status, "failed");
    assert.equal(report.evaluations[0]?.metadata?.invariant, true, "the stamp comes from the declaration");
    assert.equal(report.aggregate.invariantsPassed, false);
    assert.throws(() => assertEvaluationThreshold(report, {}), /hard invariant failed/);
  });

  it("requireInvariants fails when no invariant scorer ran", async () => {
    const report = await runExperiment({
      agent: await mockAgent("done"),
      dataset,
      scorers: [defineScorer({ id: "plain", score: () => ({ score: 1 }) })],
    });
    assert.equal(report.aggregate.invariantsPassed, undefined);
    assert.doesNotThrow(() => assertEvaluationThreshold(report, {}));
    assert.throws(() => assertEvaluationThreshold(report, { requireInvariants: true }), /no invariant scorers evaluated/);
    assert.throws(
      () => assertEvaluationThreshold({ wins: {}, failures: 0 } as never, { requireInvariants: true }),
      /no invariant scorers evaluated/,
    );
  });

  it("a non-invariant failed record does not set invariantsPassed false", async () => {
    const report = await runExperiment({
      agent: await mockAgent("done"),
      dataset,
      scorers: [
        defineScorer({ id: "gate", invariant: true, score: () => ({ score: 1 }) }),
        defineScorer({
          id: "flaky_judge",
          score: () => {
            throw new Error("judge timeout");
          },
        }),
      ],
    });
    assert.equal(report.aggregate.failedCount, 1);
    assert.equal(report.evaluations.find((record) => record.scorerId === "flaky_judge")?.metadata?.invariant, undefined);
    assert.equal(report.aggregate.invariantsPassed, true);
    assert.doesNotThrow(() => assertEvaluationThreshold(report, { maximumFailures: 1 }));
  });

  it("a returned metadata.invariant no longer decides invariance", async () => {
    const sneaky = defineScorer({ id: "sneaky", score: () => ({ score: 0, metadata: { invariant: true, note: "kept" } }) });
    const records = await scoreRun({ result: sampleResult(), scorers: [sneaky] });
    assert.equal(records[0]?.metadata?.invariant, undefined);
    assert.equal(records[0]?.metadata?.note, "kept");

    const report = await runExperiment({ agent: await mockAgent("done"), dataset, scorers: [sneaky] });
    assert.equal(report.aggregate.invariantsPassed, undefined);
  });
});

describe("forEach", () => {
  const perStep = (input: { step?: ExecutionStep }) => ({ score: input.step?.name === "read" ? 1 : 0 });

  it("passes the matching step to the scorer", async () => {
    const scorer = defineScorer({ id: "per_step", requires: ["timeline"], score: perStep });
    const records = await scoreRun({
      result: sampleResult(),
      scorers: [scorer],
      injectedTimeline: stepTimeline([toolStep("t1", "read", 0), toolStep("t2", "write", 1)]),
      forEach: "tool",
    });
    assert.deepEqual(
      records.map((record) => [record.stepId, record.score]),
      [
        ["t1", 1],
        ["t2", 0],
      ],
    );
  });

  it("records an explicit skip when no step matches", async () => {
    const scorer = defineScorer({ id: "per_step", requires: ["timeline"], score: () => ({ score: 1 }) });
    const records = await scoreRun({
      result: sampleResult(),
      scorers: [scorer],
      injectedTimeline: stepTimeline([{ ...toolStep("s1", "turn", 0), kind: "turn" }]),
      forEach: "tool",
    });
    assert.equal(records.length, 1, "one record per scorer, not zero");
    assert.equal(records[0]?.status, "skipped");
    assert.equal(records[0]?.reason, "no matching steps");
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
    await assert.rejects(
      appendEvaluationFeedback({
        feedbackStore: feedback,
        evaluationStore: createMemoryEvaluationStore([{ ...evaluation, runId: "other" }]),
        evaluationIds: [evaluation.id],
        feedback: { id: "feedback-2", runId: "run_1", rating: 1, ...ownership },
      }),
      EvalError,
    );
    await assert.rejects(
      appendEvaluationFeedback({
        feedbackStore: feedback,
        evaluationStore,
        evaluationIds: ["missing"],
        feedback: { id: "feedback-3", runId: "run_1", rating: 1, ...ownership },
      }),
      /evaluation not found/,
    );
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
      () =>
        defineDataset({
          id: "qa",
          items: [
            { id: "1", input: "a" },
            { id: "1", input: "b" },
          ],
        }),
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
      queryEvents: async () => ({
        items: [
          {
            id: "e1",
            sessionId: "session_1",
            runId: "run_1",
            type: "run.started",
            timestamp: run.startedAt,
            event: { type: "run.started", agentId: "a", runId: "run_1", sessionId: "session_1", timestamp: run.startedAt },
            redacted: true,
            ...ownership,
          },
        ],
      }),
      queryToolCalls: async () => ({ items: [] }),
      queryUsage: async () => ({ items: [] }),
    } as unknown as ProductionPersistenceStore;
    const records = await scoreRun({
      result: sampleResult(),
      ownership,
      traceResolver: createPersistenceTraceResolver(store),
      scorers: [defineScorer({ id: "trace", score: ({ target }) => ({ score: target?.trace?.events.length === 1 ? 1 : 0 }) })],
    });
    assert.equal(records[0]?.score, 1);
    await assert.rejects(
      () => createPersistenceTraceResolver(store)({ sessionId: "session_1", runId: "run_1", tenantId: "other" }),
      /ownership/,
    );
  });

  it("bounds model judges, attributes rubrics, and records timeout failures", async () => {
    let attempts = 0;
    const judge = createModelJudge({
      id: "quality",
      rubric: "Score quality",
      rubricVersion: "v2",
      maxAttempts: 2,
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

  it("hands scorers the resolved redactor so a judge prompt never carries a secret", async () => {
    // The run text and the item input are raw at the scorer boundary; a judge must redact both.
    const leaked: string[] = [];
    const judge = createModelJudge({
      id: "seam",
      rubric: "Rate the answer",
      rubricVersion: "1",
      judge: async ({ target, item }) => {
        leaked.push(JSON.stringify({ target, item }));
        return { score: 1 };
      },
    });
    const dataset = defineDataset({ id: "seam", items: [{ id: "i", input: "ask with SECRET_CANARY_VALUE" }] });
    const result = { ...sampleResult(), text: "answer with SECRET_CANARY_VALUE" };
    const options = {
      result,
      scorers: [judge],
      item: dataset.items[0]!,
      datasetId: dataset.id,
      itemId: "i",
    };

    const explicit = await scoreRun({ ...options, redactor: createSecretRedactor(["SECRET_CANARY_VALUE"]) });
    assert.equal(explicit[0]?.score, 1);
    assert.ok(!leaked[0]!.includes("SECRET_CANARY_VALUE"), "the judge prompt must not carry the secret");

    // `secrets` is the same seam without a redactor instance.
    leaked.length = 0;
    await scoreRun({ ...options, secrets: ["SECRET_CANARY_VALUE"] });
    assert.ok(!leaked[0]!.includes("SECRET_CANARY_VALUE"), "secrets must reach the scorer as a redactor");

    // With no redactor configured there is nothing to redact, and the seam stays undefined.
    let sawRedactor: unknown = "unset";
    leaked.length = 0;
    await scoreRun({
      ...options,
      scorers: [
        defineScorer({
          id: "view",
          score: (input) => {
            sawRedactor = input.redactor;
            return { score: 1 };
          },
        }),
      ],
    });
    assert.equal(sawRedactor, undefined);
    assert.ok(leaked.length === 0);
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

    const experiment = await runExperiment({
      agent: await mockAgent("ok"),
      dataset,
      scorers: [defineScorer({ id: "s", score: () => ({ score: 1 }) })],
    });
    assert.doesNotThrow(() => assertEvaluationThreshold(experiment, { minimumMacroMean: 1, maximumFailures: 0, minimumByScorer: { s: 1 } }));
    assert.throws(
      () => assertEvaluationThreshold(experiment, { minimumMacroMean: 1, maximumFailures: 0, minimumByScorer: { missing: 1 } }),
      /missing mean/,
    );
    assert.doesNotMatch(serializeEvaluationReport({ reason: "SECRET" }, { secrets: ["SECRET"] }), /SECRET/);
    assert.throws(() => serializeEvaluationReport(experiment, { maxBytes: 1 }), /byte limit/);
  });
});

describe("runExperiment / scoreRunLive", () => {
  it("bounds concurrency, preserves item order, and aggregates scores", async () => {
    let active = 0;
    let maxActive = 0;
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [mockProvider([[providerTextDelta("answer"), providerDone()]])],
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
    assert.equal(report.aggregate.macroMean, 1);
    assert.ok(maxActive <= 2);
    assert.equal(
      report.evaluations.every((record) => record.experimentId === "exp_1"),
      true,
    );
  });

  it("live scoring does not mutate the agent result and isolates failures", async () => {
    const agent = await mockAgent("ok");
    const session = await agent.session();
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
      async () =>
        runExperiment({
          agent: await mockAgent("x"),
          dataset: defineDataset({ id: "d", items: [{ id: "1", input: "x" }] }),
          scorers: [defineScorer({ id: "s", score: () => ({ score: 1 }) })],
          concurrency: 0,
        }),
      EvalError,
    );
  });
});

// ─── Optional observability peer (plan 197 Task 9) ────────────────────────────

describe("optional observability peer", () => {
  const dataset = defineDataset({ id: "peer", items: [{ id: "i", input: "x" }] });

  it("timeline_unavailable_throws_named_error", async () => {
    const agent = await mockAgent("search");
    setTimelineImporterForTests(async () => {
      throw new Error("Cannot find module '@arnilo/prism-observability'");
    });
    try {
      await assert.rejects(
        () => loadTimeline(),
        (error: unknown) =>
          error instanceof EvalError &&
          error.code === "ERR_PRISM_EVAL_TIMELINE_UNAVAILABLE" &&
          error.message.includes("@arnilo/prism-observability") &&
          error.cause instanceof Error,
      );
      // The named error also reaches the public entry points that need a timeline.
      const report = await runExperiment({
        agent,
        dataset,
        timeline: "metadata",
        scorers: [defineScorer({ id: "tl", requires: ["timeline"], score: () => ({ score: 1 }) })],
      });
      assert.equal(report.status, "failed");
      assert.equal(report.items[0]?.error?.code, "ERR_PRISM_EVAL_TIMELINE_UNAVAILABLE");
      assert.match(report.items[0]?.error?.message ?? "", /@arnilo\/prism-observability/);
    } finally {
      setTimelineImporterForTests();
    }
  });

  it("text_only_experiment_does_not_load_observability", async () => {
    const agent = await mockAgent("search");
    let loads = 0;
    setTimelineImporterForTests(async () => {
      loads += 1;
      throw new Error("observability must not load on the text-only path");
    });
    try {
      const textOnly = await runExperiment({
        agent,
        dataset,
        scorers: [defineScorer({ id: "len", score: ({ result }) => ({ score: result.text.length > 0 ? 1 : 0 }) })],
      });
      assert.equal(textOnly.evaluations.length, 1);
      assert.equal(textOnly.evaluations[0]?.status, "scored");
      const scored = await scoreRun({ result: sampleResult(), scorers: [defineScorer({ id: "text", score: () => ({ score: 1 }) })] });
      assert.equal(scored[0]?.status, "scored");
      assert.equal(loads, 0, "a text-only run never imports the optional peer");
    } finally {
      setTimelineImporterForTests();
    }
  });

  it("timeline_request_loads_observability_once_per_run", async () => {
    const agent = await mockAgent("search");
    let loads = 0;
    setTimelineImporterForTests(async () => {
      loads += 1;
      return await import("@arnilo/prism-observability");
    });
    try {
      const projected = await runExperiment({
        agent,
        dataset,
        timeline: "metadata",
        scorers: [defineScorer({ id: "tl", requires: ["timeline"], score: ({ timeline }) => ({ score: timeline ? 1 : 0 }) })],
      });
      assert.equal(projected.evaluations[0]?.score, 1);
      assert.ok(loads >= 1);
    } finally {
      setTimelineImporterForTests();
    }
  });
});


describe("per-scorer aggregate statistics", () => {
  async function report(values: number[][], seed = 7, passThreshold?: number) {
    const calls = new Map<string, number>();
    return runExperiment({
      agent: await mockAgent("ok"),
      dataset: defineDataset({ id: "stats", items: values.map((_, i) => ({ id: String(i), input: String(i) })) }),
      trials: Math.max(1, ...values.map(v => v.length)), seed,
      scorers: [defineScorer({ id: "s", passThreshold, score: ({ item }) => {
        const id = item!.id, i = Number(id), trial = calls.get(id) ?? 0;
        calls.set(id, trial + 1);
        if (trial >= values[i]!.length) throw new Error("unscored trial");
        return { score: values[i]![trial]! };
      } })],
    });
  }

  it("pass_hat_k_drops_with_flaky_item", async () => {
    const stats = (await report([[1, 0, 1, 0]])).aggregate.scorers.s!;
    assert.equal(stats.passRate, .5);
    assert.equal(stats.passAtK?.[4], 1);
    assert.equal(stats.passHatK?.[4], 0);
    assert.deepEqual(JSON.parse(serializeEvaluationReport({ stats })).stats.passHatK, stats.passHatK);
    assert.deepEqual(stats.passKCounts?.[4], { items: 1, excludedItems: 0 });
    for (let n = 2; n <= 6; n++) {
      for (let c = 0; c <= n; c++) {
        const actual = (await report([[...Array(c).fill(1), ...Array(n - c).fill(0)]])).aggregate.scorers.s!;
        for (let k = 1; k <= n; k++) {
          assert.ok(Math.abs(actual.passAtK![k]! - passAtK(n, c, k)) < 1e-12);
          assert.ok(Math.abs(actual.passHatK![k]! - passHatK(n, c, k)) < 1e-12);
        }
      }
    }
  });

  it("items_with_too_few_trials_are_excluded_and_counted", async () => {
    const stats = (await report([[1, 0, 1, 0], [1], []])).aggregate.scorers.s!;
    assert.equal(stats.passRate, .75);
    assert.equal(stats.passHatK?.[1], .75);
    assert.deepEqual(stats.passKCounts?.[1], { items: 2, excludedItems: 1 });
    assert.deepEqual(stats.passKCounts?.[4], { items: 1, excludedItems: 2 });
    assert.equal(stats.passHatK?.[4], 0);
    const missing = (await report([[1], [], [], []])).aggregate.scorers.s!;
    assert.equal(missing.passAtK, undefined); // Only one configured trial.
    const unscored = (await report([[1, 1], [1]])).aggregate.scorers.s!;
    assert.deepEqual(unscored.passKCounts?.[2], { items: 1, excludedItems: 1 });
  });

  it("pass_threshold_defaults_to_one_and_accepts_boundary_scores", async () => {
    assert.equal((await report([[.5, .7]])).aggregate.scorers.s?.passRate, 0);
    assert.equal((await report([[.5, .7]], 7, .7)).aggregate.scorers.s?.passRate, .5);
    assert.equal((await report([[0, .5]], 7, 0)).aggregate.scorers.s?.passRate, 1);
    for (const passThreshold of [-1, 1.1, NaN, Infinity]) {
      assert.throws(() => defineScorer({ id: "bad", passThreshold, score: () => ({ score: 1 }) }), EvalError);
      let built = false;
      await assert.rejects(runExperiment({
        agent: async () => { built = true; return mockAgent("ok"); },
        dataset: defineDataset({ id: "bad", items: [{ id: "a", input: "a" }] }),
        scorers: [{ id: "bad", passThreshold, score: () => ({ score: 1 }) }],
      }), EvalError);
      assert.equal(built, false);
    }
  });

  it("minimum_pass_hat_k_gate_fails", async () => {
    const r = await report([[1, 0, 1, 0]]);
    assert.throws(() => assertEvaluationThreshold(r, { minimumPassHatK: { s: { k: 4, minimum: .8 } } }), /s pass\^4/);
    assert.doesNotThrow(() => assertEvaluationThreshold(r, { minimumPassHatK: { s: { k: 1, minimum: .5 } } }));
    for (const [scorer, k] of [["missing", 1], ["s", 5]] as const) {
      assert.throws(() => assertEvaluationThreshold(r, { minimumPassHatK: { [scorer]: { k, minimum: 0 } } }));
    }
    for (const k of [0, -1, 1.5, NaN, Infinity]) {
      assert.throws(() => assertEvaluationThreshold(r, { minimumPassHatK: { s: { k, minimum: 0 } } }), /k must be/);
    }
    for (const minimum of [-1, 1.1, NaN, Infinity]) {
      assert.throws(() => assertEvaluationThreshold(r, { minimumPassHatK: { s: { k: 1, minimum } } }), EvalError);
    }
    const short = await report([[1]]);
    assert.throws(() => assertEvaluationThreshold(short, { minimumPassHatK: { s: { k: 1, minimum: 0 } } }));
    let calls = 0;
    const insufficient = await runExperiment({ agent: await mockAgent("ok"), trials: 4,
      dataset: defineDataset({ id: "short", items: [{ id: "a", input: "a" }] }),
      scorers: [defineScorer({ id: "s", score: () => { if (calls++) throw new Error("unscored"); return { score: 1 }; } })],
    });
    assert.deepEqual(insufficient.aggregate.scorers.s?.passKCounts?.[4], { items: 0, excludedItems: 1 });
    assert.equal(insufficient.aggregate.scorers.s?.passHatK?.[4], undefined);
    assert.throws(() => assertEvaluationThreshold(insufficient, {
      maximumFailures: 3, minimumPassHatK: { s: { k: 4, minimum: 0 } },
    }), /s pass\^4/);
    const skipped = await runExperiment({ agent: await mockAgent("ok"), trials: 4, sampling: { rate: 0 },
      dataset: defineDataset({ id: "skip", items: [{ id: "a", input: "a" }] }),
      scorers: [defineScorer({ id: "s", score: () => ({ score: 1 }) })],
    });
    assert.deepEqual(skipped.aggregate.scorers, {});
    assert.throws(() => assertEvaluationThreshold(skipped, { minimumPassHatK: { s: { k: 4, minimum: 0 } } }));
  });

  it("trials_do_not_outweigh_items_in_mean", async () => {
    const r = await report([[1, 1, 1, 1, 1], [0]]);
    assert.equal(r.aggregate.scorers.s?.mean, .5);
    assert.equal(r.aggregate.scorers.s?.items, 2);
    assert.equal(r.aggregate.scorers.s?.records, 6);
    assert.equal(r.aggregate.failedCount, 4);
    assert.equal(r.aggregate.macroMean, .5);
  });

  it("se_is_clustered_by_item and bootstrap is reproducible", async () => {
    const single = await report([[1], [0], [1]]);
    const repeated = await report([[1, 1, 1], [0, 0, 0], [1, 1, 1]]);
    assert.equal(repeated.aggregate.scorers.s?.se, single.aggregate.scorers.s?.se);
    assert.equal(repeated.aggregate.scorers.s?.method, "cluster_bootstrap");
    assert.deepEqual(repeated.aggregate.scorers, (await report([[1, 1, 1], [0, 0, 0], [1, 1, 1]])).aggregate.scorers);
    assert.equal(single.aggregate.scorers.s?.method, "wilson");
    assert.ok(single.aggregate.scorers.s?.ci95);
  });

  it("single item and empty samples have no uncertainty", async () => {
    const one = await report([[.5, .7]]);
    assert.equal(one.aggregate.scorers.s?.mean, .6);
    assert.equal(one.aggregate.scorers.s?.method, "single_item");
    assert.equal(one.aggregate.scorers.s?.ci95, undefined);
    assert.equal(one.aggregate.scorers.s?.se, undefined);
    const empty = await report([[]]);
    assert.deepEqual(empty.aggregate.scorers, {});
    assert.equal(empty.aggregate.macroMean, undefined);
  });

  it("lower_bound_gate_fails_on_small_noisy_suite", async () => {
    const r = await report(Array.from({ length: 10 }, (_, i) => [Number(i < 9)]));
    assert.doesNotThrow(() => assertEvaluationThreshold(r, { minimumByScorer: { s: .8 } }));
    assert.throws(() => assertEvaluationThreshold(r, { minimumLowerBound: { s: .8 } }), /s.*lower bound.*0\.8.*ci95/);
    assert.doesNotThrow(() => assertEvaluationThreshold(r, {
      minimumLowerBound: { s: r.aggregate.scorers.s!.ci95!.low },
    }));
    for (const minimum of [NaN, Infinity, -.1, 1.1]) {
      assert.throws(() => assertEvaluationThreshold(r, { minimumLowerBound: { s: minimum } }), EvalError);
    }
  });

  it("lower_bound_gate_fails_without_interval", async () => {
    const r = await report([[1]]);
    for (const scorer of ["s", "missing"]) {
      assert.throws(() => assertEvaluationThreshold(r, { minimumLowerBound: { [scorer]: 0 } }), /ci95 unavailable/);
    }
    const valid = await report([[1], [1]]);
    for (const ci95 of [{ low: NaN, high: 1 }, { low: .9, high: .8 }, { low: 0, high: Infinity }]) {
      const malformed = { ...valid, aggregate: { ...valid.aggregate, scorers: {
        s: { ...valid.aggregate.scorers.s!, ci95 },
      } } };
      assert.throws(() => assertEvaluationThreshold(malformed, { minimumLowerBound: { s: 0 } }));
    }
    assert.throws(() => assertEvaluationThreshold({ wins: {}, failures: 0 } as never,
      { minimumLowerBound: { s: 0 } }));
  });

  it("regression_gate_fails_on_significant_drop_and_passes_on_noise", async () => {
    const baseline = await report(Array.from({ length: 40 }, () => [1]));
    const candidate = await report(Array.from({ length: 40 }, (_, i) => [Number(i < 32)]));
    const noise = await report(Array.from({ length: 40 }, (_, i) => [Number(i < 39)]));
    const maximumRegression = { baseline };
    assert.throws(() => assertEvaluationThreshold(candidate, { maximumRegression }),
      /s.*difference.*-0\.2.*-0.*ci95.*p=.*q=/);
    assert.doesNotThrow(() => assertEvaluationThreshold(baseline, { maximumRegression }));
    assert.doesNotThrow(() => assertEvaluationThreshold(noise, { maximumRegression }));
    assert.doesNotThrow(() => assertEvaluationThreshold(baseline, { maximumRegression: { baseline: candidate } }));
    assert.doesNotThrow(() => assertEvaluationThreshold(candidate, { maximumRegression: { baseline, delta: .2 } }));
    assert.doesNotThrow(() => assertEvaluationThreshold(candidate, { maximumRegression: { baseline, alpha: .001 } }));
    for (const delta of [NaN, Infinity, -.1, 1.1]) {
      assert.throws(() => assertEvaluationThreshold(candidate, { maximumRegression: { baseline, delta } }), EvalError);
    }
    for (const alpha of [NaN, 0, 1]) {
      assert.throws(() => assertEvaluationThreshold(candidate, { maximumRegression: { baseline, alpha } }), EvalError);
    }
    assert.throws(() => assertEvaluationThreshold(candidate, { maximumRegression: { baseline, scorers: ["missing"] } }),
      /Missing scorer/);
    assert.throws(() => assertEvaluationThreshold({ ...candidate, datasetId: "other" }, { maximumRegression }),
      /matching dataset ids/);
    assert.throws(() => assertEvaluationThreshold({ wins: {}, failures: 0 } as never, { maximumRegression }));

    // Six discordances: raw p=.03125, but q=.0625 when the stable scorer is also compared.
    const marginal = await report(Array.from({ length: 40 }, (_, i) => [Number(i < 34)]));
    const withStable = (r: typeof baseline) => ({ ...r, items: r.items.map(item => ({ ...item,
      evaluations: [...item.evaluations, ...item.evaluations.map(row => ({ ...row, scorerId: "stable", score: 1 }))],
    })) });
    assert.doesNotThrow(() => assertEvaluationThreshold(withStable(marginal), {
      maximumRegression: { baseline: withStable(baseline) },
    }));
    assert.throws(() => assertEvaluationThreshold(withStable(marginal), {
      maximumRegression: { baseline: withStable(baseline), scorers: ["s"] },
    }), /q=0\.03125/);
  });

  it("macro_mean_ignores_record_counts and threshold_minimum_macro_mean", async () => {
    let calls = 0;
    const r = await runExperiment({ agent: await mockAgent("ok"),
      dataset: defineDataset({ id: "macro", items: [{ id: "a", input: "a" }, { id: "b", input: "b" }] }),
      scorers: [defineScorer({ id: "many", score: () => ({ score: 1 }) }),
        defineScorer({ id: "few", score: () => { if (calls++) throw new Error("unscored"); return { score: 0 }; } })],
    });
    assert.equal(r.aggregate.macroMean, .5);
    assert.doesNotThrow(() => assertEvaluationThreshold(r, { minimumMacroMean: .5, maximumFailures: 1 }));
    assert.throws(() => assertEvaluationThreshold(r, { minimumMacroMean: .6, maximumFailures: 1 }));
  });
});


describe("experiment usage, cost, latency and Pareto frontier", () => {
  async function accountingReport(runs: { usage?: Usage; turns?: (Usage | undefined)[]; status?: RunResult["status"]; throws?: boolean; delayMs?: number; terminal?: boolean }[], itemCount = 1) {
    let index = 0;
    const agent = { session: async () => {
      const run = runs[index++]!;
      return {
        subscribe: async function* () {
          for (const usage of run.turns ?? [run.usage]) {
            yield { type: "turn.started" } as AgentEvent;
            yield { type: "turn.completed", usage } as AgentEvent;
          }
          if (run.terminal !== false) yield { type: "run.completed", runId: "run_1" } as AgentEvent;
        },
        run: async () => {
          await new Promise(resolve => setTimeout(resolve, run.delayMs ?? 1));
          if (run.throws) throw new Error("run failed");
          return sampleResult({ usage: run.usage, status: run.status ?? "completed" });
        },
      };
    } } as unknown as Agent;
    return await runExperiment({ agent, concurrency: 1, trials: runs.length / itemCount,
      dataset: defineDataset({ id: "usage", items: Array.from({ length: itemCount }, (_, i) => ({ id: String(i), input: "hello" })) }),
      scorers: [defineScorer({ id: "pass", score: () => ({ score: 1 }) })],
    });
  }

  it("report_totals_usage_across_trials", async () => {
    const usage = { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cost: .25, currency: "USD" };
    const report = await accountingReport(Array.from({ length: 4 }, (_, i) => ({ usage, delayMs: (i + 1) * 10 })), 2);
    const cost = report.aggregate.cost!;
    assert.equal(cost.inputTokens, 40);
    assert.equal(cost.outputTokens, 8);
    assert.equal(cost.cacheReadTokens, 12);
    assert.equal(cost.cost, 1);
    assert.equal(cost.currency, "USD");
    assert.equal(cost.costComplete, true);
    assert.equal(cost.meanPerItem.inputTokens, 20);
    assert.equal(cost.meanPerItem.cost, .5);
    const durations = report.items.flatMap(item => item.trials.map(trial => trial.durationMs!)).sort((a, b) => a - b);
    assert.equal(cost.meanPerItem.durationMs, durations.reduce((sum, value) => sum + value, 0) / 2);
    assert.deepEqual(cost.durationMs, { p50: durations[1], p95: durations[3] });
    assert.deepEqual(report.items.map(item => item.trials.length), [2, 2]);
    assert.equal(report.items[0]!.trials[0]!.status, "completed");
    assert.deepEqual(report.items[0]!.trials[0]!.usage, usage);
    assert.deepEqual(JSON.parse(serializeEvaluationReport(report)).aggregate.cost, cost);
  });

  it("missing_cost_marks_cost_incomplete", async () => {
    const priced = { inputTokens: 2, cost: 1, currency: "USD" };
    for (const run of [
      { usage: { inputTokens: 2 } },
      { usage: undefined },
      { usage: { ...priced, estimated: true } },
      { usage: { ...priced, currency: "EUR" } },
      { usage: { ...priced, currency: undefined } },
      { usage: { ...priced, cost: NaN } },
      { usage: { ...priced, cost: -1 } },
      // A partial run total conceals an unpriced turn, or differently priced currencies.
      { usage: priced, turns: [priced, { inputTokens: 1 }] },
      { usage: priced, turns: [priced, { ...priced, currency: "EUR" }] },
      { usage: priced, turns: [] },
      { usage: priced, terminal: false },
    ]) {
      const report = await accountingReport([{ usage: priced }, run]);
      assert.equal(report.aggregate.cost!.costComplete, false);
      assert.equal(report.aggregate.cost!.cost, undefined);
      assert.equal(report.aggregate.cost!.meanPerItem.cost, undefined);
    }
    const free = await accountingReport([{ usage: { cost: 0 } }]);
    assert.equal(free.aggregate.cost!.costComplete, true);
    assert.equal(free.aggregate.cost!.cost, 0);
  });

  it("retains_failed_and_aborted_trials_without_timeline", async () => {
    const report = await accountingReport([{ throws: true }, { status: "aborted" }, { status: "failed" }]);
    assert.deepEqual(report.items[0]!.trials.map(trial => trial.status), ["failed", "aborted", "failed"]);
    assert.ok(report.items[0]!.trials.every(trial => Number.isFinite(trial.durationMs) && trial.durationMs! >= 0));
    assert.equal(report.aggregate.cost!.costComplete, false);
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    const aborted = await runExperiment({ agent: await mockAgent("ok"), signal: controller.signal,
      dataset: defineDataset({ id: "abort", items: [{ id: "a", input: "hi" }] }),
      scorers: [defineScorer({ id: "pass", score: () => ({ score: 1 }) })], trials: 2 });
    assert.deepEqual(aborted.items[0]!.trials.map(trial => trial.status), ["aborted", "aborted"]);
    assert.equal(aborted.aggregate.cost!.costComplete, false);
    assert.equal(aborted.aggregate.cost!.durationMs, undefined);
  });

  it("collects_real_provider_usage_without_timeline", async () => {
    const report = await runExperiment({
      agent: await createAgent({ model: { provider: "mock", model: "demo" },
        packages: [mockProvider([[providerUsage({ inputTokens: 5, outputTokens: 1, cost: .5, currency: "USD" }), providerDone()]])] }),
      dataset: defineDataset({ id: "real", items: [{ id: "a", input: "hi" }] }),
      scorers: [defineScorer({ id: "pass", score: () => ({ score: 1 }) })], trials: 2,
    });
    assert.equal(report.aggregate.cost!.costComplete, true);
    assert.equal(report.aggregate.cost!.cost, 1);
    assert.equal(report.aggregate.cost!.inputTokens, 10);
    assert.ok(report.items.every(item => item.trials.every(trial => trial.durationMs! >= 0)));
  });

  it("real_multi_turn_partial_cost_is_not_a_total", async () => {
    const agent = await createAgent({ model: { provider: "mock", model: "demo" },
      packages: [mockProvider([
        [providerToolCall({ type: "tool_call", id: "c1", name: "read", arguments: {} }),
          providerUsage({ inputTokens: 5, outputTokens: 1, cost: .5, currency: "USD" }), providerDone()],
        [providerTextDelta("done"), providerUsage({ inputTokens: 7, outputTokens: 2 }), providerDone()],
      ])],
      tools: { add: [{ name: "read", description: "read fixture", parameters: { type: "object", properties: {} },
        async execute(_args, ctx) { return { toolCallId: ctx.toolCallId, name: "read", value: "ok" }; },
      }] },
    });
    const report = await runExperiment({ agent,
      dataset: defineDataset({ id: "mixed", items: [{ id: "a", input: "read" }] }),
      scorers: [defineScorer({ id: "pass", score: () => ({ score: 1 }) })],
    });
    assert.equal(report.items[0]!.result!.text, "done");
    assert.equal(report.items[0]!.trials[0]!.usage!.cost, .5); // The kernel total alone is partial.
    assert.equal(report.items[0]!.trials[0]!.costComplete, false);
    assert.equal(report.aggregate.cost!.inputTokens, 12);
    assert.equal(report.aggregate.cost!.cost, undefined);
    assert.equal(report.aggregate.cost!.costComplete, false);
  });

  it("pareto_excludes_dominated_report_and_preserves_ties", () => {
    const points = [{ q: 1, c: 4 }, { q: .5, c: 1 }, { q: .5, c: 2 }, { q: .7, c: 3 }, { q: .6, c: 3 }, { q: 1, c: 4 }];
    const axes = { quality: (r: typeof points[number]) => r.q, cost: (r: typeof points[number]) => r.c };
    assert.deepEqual(paretoFrontier(points, axes), [points[1], points[3], points[0], points[5]]);
    assert.deepEqual(points.map(p => p.c), [4, 1, 2, 3, 3, 4]);
    assert.deepEqual(paretoFrontier([], axes), []);
    assert.deepEqual(paretoFrontier([{ q: 1, c: Infinity }, { q: .5, c: 1 }], axes).map(p => p.c), [1, Infinity]);
    for (const q of [NaN, Infinity, -Infinity]) assert.throws(() => paretoFrontier([{ q, c: 1 }], axes), { code: "ERR_PRISM_EVAL_STATS" });
    for (const c of [NaN, -Infinity]) assert.throws(() => paretoFrontier([{ q: 1, c }], axes), { code: "ERR_PRISM_EVAL_STATS" });
  });
});


describe("dataset hygiene", () => {
  it("content_hash_is_stable_across_key_order", () => {
    const a = defineDataset({ id: "a", items: [{ id: "i", input: { z: 1, a: { y: 2, x: undefined } } }] });
    const b = defineDataset({ id: "b", version: "2", items: [{ id: "i", input: { a: { y: 2 }, z: 1 } }] });
    assert.match(a.contentHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(a.contentHash, b.contentHash);
    assert.equal(a.contentHash, "sha256:9619dc26a6d02701045203c07d08cdd5eefa4fe28585e2ecf8ded2080226877b");
  });

  it("content_hash_changes_with_any_item_change_and_snapshot_stays_pinned", () => {
    const row = { id: "i", input: { text: "before" }, split: "dev" as const, tags: ["a"], label: { source: "human" as const } };
    const a = defineDataset({ id: "d", items: [row] });
    for (const changed of [{ ...row, input: { text: "after" } }, { ...row, split: "test" as const },
      { ...row, tags: ["b"] }, { ...row, label: { source: "model" as const } }, { ...row, expected: "gold" },
      { ...row, id: "j" }, { ...row, metadata: { note: "changed" } }, { ...row, expectedTrajectory: [{ name: "read" }] }]) {
      assert.notEqual(defineDataset({ id: "d", items: [changed] }).contentHash, a.contentHash);
    }
    assert.notEqual(defineDataset({ id: "d", items: [row, { id: "j", input: row.input }] }).contentHash,
      defineDataset({ id: "d", items: [{ id: "j", input: row.input }, row] }).contentHash);
    row.input.text = "mutated";
    row.tags.push("b");
    assert.equal(a.items[0]!.input.text, "before");
    assert.deepEqual(a.items[0]!.tags, ["a"]);
    assert.ok(Object.isFrozen(a.items[0]!.input));
  });

  it("function_valued_item_throws_not_serializable", () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    for (const input of [() => 1, { nested: () => 1 }, NaN, Infinity, 1n, Symbol("x"), new Date(), new Map(), cycle]) {
      assert.throws(() => defineDataset({ id: "d", items: [{ id: "i", input }] }),
        (e: unknown) => e instanceof EvalDatasetError && /not serializable/.test(e.message));
    }
  });

  it("validates_hygiene_fields", () => {
    for (const fields of [{ split: "train" }, { tags: Array(17).fill("a") }, { tags: ["a".repeat(65)] },
      { tags: [1] }, { tags: "tag" }, { label: { source: "unknown" } }, { label: { source: "human", adjudicated: "yes" } },
      { label: { source: "human", by: 1 } }]) {
      assert.throws(() => defineDataset({ id: "d", items: [{ id: "i", input: "x", ...fields } as never] }), EvalDatasetError);
    }
    assert.throws(() => defineDataset({ id: "d", items: [], canary: "x".repeat(129) }), EvalDatasetError);
  });

  it("heldout_requires_explicit_allow_and_filters_before_running", async () => {
    const dataset = defineDataset({ id: "d", canary: "prism-canary-test", items: [
      { id: "dev", input: "x", split: "dev", tags: ["shared", "dev", "dev"] },
      { id: "held", input: "x", split: "heldout", tags: ["shared"] },
      { id: "legacy", input: "x" },
    ] });
    const options = { agent: await mockAgent("ok"), dataset, scorers: [defineScorer({ id: "ok", score: ({ item }) => ({ score: item?.id === "dev" ? 1 : 0 }) })] };
    await assert.rejects(runExperiment(options), (e: unknown) => e instanceof EvalDatasetError && e.code === "ERR_PRISM_EVAL_HELDOUT");
    await assert.rejects(runExperiment({ ...options, split: "invalid" as never }), EvalDatasetError);
    const dev = await runExperiment({ ...options, split: ["dev"] });
    assert.deepEqual(dev.items.map(x => x.item.id), ["dev"]);
    assert.deepEqual(dev.split, ["dev"]);
    const report = await runExperiment({ ...options, allowHeldout: true });
    assert.equal(report.datasetContentHash, dataset.contentHash);
    assert.equal(dataset.metadata?.canary, "prism-canary-test");
    assert.match(serializeEvaluationReport(report), /prism-canary-test/);
    assert.equal(report.aggregate.byTag?.shared?.scorers.ok?.items, 2);
    assert.equal(report.aggregate.byTag?.dev?.scorers.ok?.records, 1);
    assert.equal(report.aggregate.byTag?.shared?.scorers.ok?.mean, .5);
    assert.equal((await runExperiment({ ...options, split: "heldout", allowHeldout: true })).items.length, 1);
  });
});

describe("stratified weighted online sampling", () => {
  it("always_predicate_samples_with_probability_one", async () => {
    let strataCalls = 0;
    const s1 = defineScorer({ id: "s1", score: ({ result }) => ({ score: result.status === "completed" ? 1 : 0 }) });
    const s2 = defineScorer({ id: "s2", score: () => ({ score: 1 }) });
    const sampling = {
      rate: 0.05,
      strata: (r: RunResult) => {
        strataCalls += 1;
        return r.status;
      },
      rates: { completed: 0.1, aborted: 0 },
      always: (r: RunResult) => r.status === "failed",
    };

    const failedRecords = await scoreRunLive(sampleResult({ runId: "r_fail", status: "failed" }), {
      scorers: [s1, s2],
      sampling,
      random: () => 0.99,
    });
    assert.equal(strataCalls, 1, "strata called once per run across multiple scorers");
    assert.equal(failedRecords.length, 2);
    assert.equal(failedRecords[0]?.status, "scored");
    assert.equal(failedRecords[0]?.score, 0);
    assert.deepEqual(failedRecords[0]?.metadata?.sampling, { stratum: "failed", probability: 1 });
    assert.deepEqual(failedRecords[1]?.metadata?.sampling, { stratum: "failed", probability: 1 });

    const skippedCompleted = await scoreRunLive(sampleResult({ runId: "r_ok", status: "completed" }), {
      scorers: [s1],
      sampling,
      random: () => 0.99,
    });
    assert.equal(strataCalls, 2);
    assert.equal(skippedCompleted.length, 1);
    assert.equal(skippedCompleted[0]?.status, "skipped");
    assert.deepEqual(skippedCompleted[0]?.metadata?.sampling, { stratum: "completed", probability: 0.1 });

    const zeroStratum = await scoreRunLive(sampleResult({ runId: "r_abort", status: "aborted" }), {
      scorers: [s1],
      sampling,
      random: () => 0,
    });
    assert.equal(strataCalls, 3);
    assert.equal(zeroStratum.length, 0, "probability 0 for a stratum records nothing");
  });

  it("weighted_estimate_is_unbiased_on_synthetic_population", async () => {
    const scorer = defineScorer({
      id: "helpfulness",
      score: ({ result }) => ({ score: result.status === "completed" ? 1 : 0 }),
    });
    const store = createMemoryEvaluationStore();
    const totalRuns = 600;
    const failedRuns = 60; // 10% failure rate -> true population mean is 0.90
    const trueMean = (totalRuns - failedRuns) / totalRuns;

    for (let i = 0; i < totalRuns; i++) {
      const failed = i < failedRuns;
      const result = sampleResult({
        runId: `run_${i}`,
        status: failed ? "failed" : "completed",
        text: failed ? "error" : "ok [1]",
      });
      await scoreRunLive(result, {
        scorers: [scorer],
        store,
        seed: 42,
        sampling: {
          rate: 0.1,
          strata: (r) => r.status,
          rates: { completed: 0.1 },
          always: (r) => r.status !== "completed",
        },
      });
    }

    const stored = (await store.query({ scorerId: "helpfulness", limit: 1000 })).items;
    const scoredOnly = stored.filter((r) => r.status === "scored");
    const unweightedMean = scoredOnly.reduce((sum, r) => sum + (r.score ?? 0), 0) / scoredOnly.length;
    assert.ok(unweightedMean < 0.7, `unweighted mean (${unweightedMean}) should be heavily biased by oversampled failures`);

    const estimate = estimateOnline(stored, { scorerId: "helpfulness", seed: 42 });
    assert.equal(estimate.scorerId, "helpfulness");
    assert.equal(estimate.n, scoredOnly.length);
    assert.ok(Math.abs(estimate.mean - trueMean) < 0.05, `weighted mean ${estimate.mean} should be near ${trueMean}`);
    assert.ok(
      estimate.ci95.low <= trueMean && trueMean <= estimate.ci95.high,
      `true mean ${trueMean} must lie inside 95% CI [${estimate.ci95.low}, ${estimate.ci95.high}]`,
    );
    assert.ok(unweightedMean < estimate.ci95.low, "biased unweighted mean falls outside the weighted CI");
    assert.equal(estimate.byStratum.failed?.n, failedRuns);
    assert.equal(estimate.byStratum.failed?.mean, 0);
    assert.equal(estimate.byStratum.completed?.mean, 1);
  });

  it("estimate_refuses_unweighted_records", async () => {
    const scorer = defineScorer({ id: "helpfulness", score: () => ({ score: 1 }) });
    const unweighted = await scoreRun({ result: sampleResult(), scorers: [scorer] });
    assert.equal(unweighted[0]?.metadata?.sampling, undefined);
    assert.throws(
      () => estimateOnline(unweighted, { scorerId: "helpfulness" }),
      (err: unknown) => err instanceof EvalError && err.code === "ERR_PRISM_EVAL_STATS",
    );

    const baseRecord = unweighted[0]!;
    for (const badSampling of [
      null,
      {},
      { stratum: "", probability: 0.5 },
      { stratum: "default", probability: 0 },
      { stratum: "default", probability: -0.1 },
      { stratum: "default", probability: 1.2 },
      { stratum: "default", probability: NaN },
    ]) {
      assert.throws(
        () => estimateOnline([{ ...baseRecord, metadata: { sampling: badSampling } }], { scorerId: "helpfulness" }),
        (err: unknown) => err instanceof EvalError && err.code === "ERR_PRISM_EVAL_STATS",
      );
    }
  });
});
