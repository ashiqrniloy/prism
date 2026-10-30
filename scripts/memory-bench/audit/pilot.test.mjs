import { test } from "bun:test";
import assert from "node:assert/strict";
import { pilotComparisons, pilotDisposition, pilotMayStart, tracedProviders, validateContinuation } from "./pilot.mjs";

test("muse_pilot_authorizes_only_the_named_paid_answer_route_and_prices_usage", async () => {
  const { readinessAnswerProfile, pilotProductCost } = await import("./pilot.mjs");
  const muse = readinessAnswerProfile(5);
  assert.equal(muse.ref, "commandcode/meta/muse-spark-1.3-contributor");
  assert.equal(muse.freeOnly, false);
  assert.equal(pilotProductCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, muse), 0.3);
  assert.equal(pilotProductCost({ inputTokens: 1_000_000, cacheReadTokens: 1_000_000 }, muse), 0.002);
  for (const revision of [1, 2, 3, 4]) {
    const previous = readinessAnswerProfile(revision);
    assert.equal(previous.freeOnly, true);
    assert.equal(pilotProductCost({ inputTokens: 1_000_000 }, previous), 0);
  }
  assert.equal(readinessAnswerProfile(6).ref, muse.ref);
  assert.throws(() => readinessAnswerProfile(7), /Unknown readiness revision/);
});

test("pilot_continuation_refuses_changed_answers_or_judging", () => {
  const prior = {
    kind: "202-corrected-pilot-v2",
    productHash: "p",
    criteriaHash: "c",
    answerModel: "a",
    judges: ["j1", "j2"],
    generation: { maxTokens: 8192 },
    jobs: [{ id: "q" }],
    judgeTemplateVersion: "b",
    gradedTemplateVersion: "g",
    annotationPolicy: "off",
  };
  validateContinuation(prior, { ...prior, kind: "202-corrected-pilot-v3", harnessHash: "new" });
  for (const key of [
    "productHash",
    "criteriaHash",
    "answerModel",
    "judges",
    "generation",
    "jobs",
    "judgeTemplateVersion",
    "gradedTemplateVersion",
    "annotationPolicy",
  ]) {
    assert.throws(() => validateContinuation(prior, { ...prior, [key]: "changed" }), /continuation/);
  }
});

test("pilot_trace_preserves_stopping_after_a_long_text_stream", async () => {
  const trace = [];
  const [provider] = tracedProviders(
    [
      {
        async *generate() {
          for (let i = 0; i < 200; i++) yield { type: "content_delta", text: "a" };
          yield { type: "tool_call", call: { name: "memory.recall" } };
          yield { type: "done", stopReason: "tool_calls" };
        },
      },
    ],
    trace,
  );
  const events = [];
  for await (const event of provider.generate({ messages: [] })) events.push(event);
  assert.equal(events.length, 202, "instrumentation must not alter model events");
  assert(trace[0].events.some((event) => JSON.parse(event).type === "done"));
});

test("pilot_reports_every_requested_cell_including_ineligible_and_failed", () => {
  const jobs = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(
    pilotDisposition(jobs, [
      { jobId: "a", outcome: "comparator_ineligible" },
      { jobId: "b", outcome: "error" },
    ]).map((r) => r.outcome),
    ["comparator_ineligible", "error", "not_started"],
  );
});

test("pilot_stops_at_declared_limits_without_starting_broad_grid", () => {
  const limits = { wireAttempts: 2, inputTokens: 100, outputTokens: 50, wallMs: 1000 };
  assert.equal(pilotMayStart({ wireAttempts: 1, inputTokens: 99, outputTokens: 49 }, 999, limits), true);
  for (const [key, value] of Object.entries(limits)) {
    assert.equal(pilotMayStart(key === "wallMs" ? {} : { [key]: value }, key === "wallMs" ? value : 0, limits), false);
  }
});

test("pilot_reports_graded_and_binary_for_rubric_abilities_with_oracle_excluded", () => {
  const rows = ["full", "fabric-x", "oracle"].map((config, i) => ({
    config,
    id: "q",
    cluster: "c",
    ability: "summarization",
    correct: i > 0,
    graded: i / 2,
    outcome: "completed",
  }));
  const result = pilotComparisons(rows, ["q"]);
  assert.equal(result.length, 2);
  assert.equal(result[0].binary.diff, 1);
  assert.equal(result[1].graded.diff, 0.5);
  assert(!JSON.stringify(result).includes("oracle"));
  assert.throws(
    () =>
      pilotComparisons(
        rows.map((r) => ({ ...r, graded: undefined })),
        ["q"],
      ),
    /graded/,
  );
  assert.equal(pilotComparisons(rows.slice(1), ["q"])[0].status, "incomplete");
});

test("phased_pilot_preserves_usage_and_subtracts_all_prior_budgets", async () => {
  const { combinePilotUsage, pilotPhaseLimits } = await import("./pilot.mjs");
  const prior = {
    inputTokens: 12,
    outputTokens: 3,
    accountedInputTokens: 12,
    accountedOutputTokens: 3,
    wireAttempts: 2,
    usageMissingExchanges: 0,
    usageComplete: true,
  };
  const current = { ...prior, inputTokens: 5, accountedInputTokens: 5, wireAttempts: 1 };
  assert.equal(combinePilotUsage(prior, current).inputTokens, 17);
  assert.equal(combinePilotUsage(prior, current).wireAttempts, 3);
  const limits = { wireAttempts: 10, inputTokens: 100, outputTokens: 40, wallMs: 1000, activeWallMs: 600 };
  const remaining = pilotPhaseLimits(prior, 400, 100, limits);
  assert.deepEqual([remaining.wireAttempts, remaining.inputTokens, remaining.outputTokens, remaining.wallMs], [8, 88, 37, 500]);
  assert.throws(() => pilotPhaseLimits({ ...prior, usageComplete: false }, 0, 0, limits), /incomplete/);
  assert.throws(() => pilotPhaseLimits(prior, 1001, 0, limits), /exhausted/);
  assert.throws(() => pilotPhaseLimits(prior, 0, 601, limits), /exhausted/);
});

test("new_judge_panel_reuses_only_proven_complete_answers_without_reusing_scores", async () => {
  const { validateJudgeTransition } = await import("./pilot.mjs");
  const manifest = {
    kind: "202-readiness-pilot-v5",
    answerModel: "commandcode/meta/muse-spark-1.3-contributor",
    generation: { maxTokens: 8192 },
    jobs: [{ id: "full.q", config: "full" }],
    criteriaHash: "c",
    productHash: "p",
    sdkHash: "s",
    judgeTemplateVersion: "b",
    gradedTemplateVersion: "g",
    annotationPolicy: "blind",
  };
  const source = {
    status: "answers_completed",
    manifestHash: (await import("../journal.mjs")).stableHash(manifest),
    accounting: { usageComplete: true },
    cells: [{ jobId: "full.q", answerKey: "key", outcome: "completed" }],
  };
  const current = {
    ...manifest,
    kind: "202-readiness-pilot-v6",
    judges: ["commandcode/minimax/minimax-m3.1-flash", "commandcode/z-ai/glm-5.3-flash"],
  };
  validateJudgeTransition(manifest, source, current);
  for (const key of [
    "generation",
    "jobs",
    "criteriaHash",
    "productHash",
    "sdkHash",
    "judgeTemplateVersion",
    "gradedTemplateVersion",
    "annotationPolicy",
  ])
    assert.throws(() => validateJudgeTransition(manifest, source, { ...current, [key]: "drift" }), /Judge transition/);
  assert.throws(() => validateJudgeTransition(manifest, { ...source, manifestHash: "wrong" }, current), /Judge transition/);
  assert.throws(
    () => validateJudgeTransition(manifest, { ...source, cells: [{ ...source.cells[0], correct: true }] }, current),
    /Judge transition/,
  );
  assert.throws(() => validateJudgeTransition(manifest, { ...source, cells: [] }, current), /Judge transition/);
});
