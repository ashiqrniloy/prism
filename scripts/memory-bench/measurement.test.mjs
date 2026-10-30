import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditKappas, parseAuditLabels, renderReviewPage, selectAuditItems } from "./audit/review.mjs";
import { applyJudgeAudit, combineVerdicts, judgeAgreement, judgeFamily, resolveJudgePanel } from "./judge.mjs";
import { comparatorSessions, selectComparatorContext, selectLexicalRounds, sessionRounds } from "./replay.mjs";
import { compareJudges } from "./report.mjs";
import { runBench } from "./run.mjs";
import { cacheAdjustedCost, costReport, resolveRate } from "./usage.mjs";

const RATE = { input: 3, output: 12, cacheRead: 0.3, cacheWrite: 3.75 };

test("panel_never_uses_only_the_answer_model", () => {
  assert.throws(() => resolveJudgePanel({ judges: ["opencode-go/mimo-v2.5"] }), /at least two judges/);
  assert.throws(
    () => resolveJudgePanel({ judges: ["opencode-go/mimo-v2.5", "hyper/mimo-v2.5-pro"], answerModel: "hyper/mimo-v2.5-pro" }),
    /answer model cannot judge/,
  );
  // Two resellers of one family are not two independent judges.
  assert.throws(
    () => resolveJudgePanel({ judges: ["hyper/deepseek-v4-flash", "opencode-go/deepseek-v4-pro"], answerModel: null }),
    /different model families/,
  );
  assert.equal(judgeFamily("hyper/deepseek-v4-flash"), "deepseek");
  assert.deepEqual(
    resolveJudgePanel({ judges: ["hyper/deepseek-v4-flash", "opencode-go/mimo-v2.5"], answerModel: "hyper/gemma-4" }).families.sort(),
    ["deepseek", "mimo"],
  );
  assert.equal(combineVerdicts({ a: "yes", b: "no" }), "no", "a tie is not a pass");
  assert.equal(combineVerdicts({ a: "yes", b: "yes", c: "no" }), "yes");
});

test("kappa_below_threshold_drops_judge", () => {
  const panel = resolveJudgePanel({
    judges: ["hyper/deepseek-v4-flash", "opencode-go/mimo-v2.5", "hyper/glm-5"],
    answerModel: null,
  });
  const audit = {
    judges: {
      "hyper/deepseek-v4-flash": { n: 150, kappa: 0.84 },
      "opencode-go/mimo-v2.5": { n: 150, kappa: 0.77 },
      "hyper/glm-5": { n: 150, kappa: 0.81 },
    },
  };
  const applied = applyJudgeAudit({ panel, audit });
  assert.deepEqual(applied.active, ["hyper/deepseek-v4-flash", "hyper/glm-5"]);
  assert.deepEqual(applied.dropped, ["opencode-go/mimo-v2.5"]);
  // Dropping below two leaves no scorable panel.
  const pair = resolveJudgePanel({ judges: ["hyper/deepseek-v4-flash", "opencode-go/mimo-v2.5"], answerModel: null });
  assert.throws(
    () =>
      applyJudgeAudit({
        panel: pair,
        audit: { judges: { "hyper/deepseek-v4-flash": { n: 150, kappa: 0.84 }, "opencode-go/mimo-v2.5": { n: 150, kappa: 0.2 } } },
      }),
    /fewer than two judges/,
  );
  assert.equal(
    judgeAgreement(
      [
        { correct: true, judgeVerdicts: { a: "yes", b: "yes" } },
        { correct: false, judgeVerdicts: { a: "no", b: "yes" } },
        { correct: true, judgeVerdicts: { a: "yes", b: "yes" } },
      ],
      ["a", "b"],
    ).pairs[0].agreement,
    2 / 3,
  );
});

test("cache_adjusted_cost_uses_reported_cache_tokens", () => {
  assert.equal(
    cacheAdjustedCost({ inputTokens: 1000, cacheReadTokens: 800, outputTokens: 100 }, RATE),
    (200 * 3 + 800 * 0.3 + 100 * 12) / 1e6,
  );
  assert.equal(cacheAdjustedCost({ inputTokens: 1000, cacheWriteTokens: 200, outputTokens: 0 }, RATE), (800 * 3 + 200 * 3.75) / 1e6);
  // Implicit-cache routes publish no write rate; a zero write count must not unpriced the arm.
  assert.equal(cacheAdjustedCost({ inputTokens: 1000, outputTokens: 100 }, { ...RATE, cacheWrite: null }), (1000 * 3 + 100 * 12) / 1e6);
  assert.equal(cacheAdjustedCost({ inputTokens: 1000, cacheWriteTokens: 100, outputTokens: 0 }, { ...RATE, cacheWrite: null }), null);
  // A missing rate is unpriced, never free.
  assert.equal(cacheAdjustedCost({ inputTokens: 1000, outputTokens: 100 }, null), null);
  assert.equal(cacheAdjustedCost({ inputTokens: 1000, outputTokens: 100 }, { ...RATE, output: null }), null);
  assert.equal(resolveRate({ models: { "hyper/deepseek-v4-flash-2026": RATE } }, "hyper/deepseek-v4-flash-2026").input, 3);
});

test("full_multi_turn_cost_counts_prefix_as_cache_read", () => {
  const report = costReport({ inputTokens: 1_000_000, outputTokens: 10_000 }, RATE, { config: "full" });
  assert.equal(report.cachedPrefixSimulation, (1_000_000 * 0.3 + 10_000 * 12) / 1e6);
  assert.equal(report.measured, (1_000_000 * 3 + 10_000 * 12) / 1e6);
  const memory = costReport({ inputTokens: 1_000_000, cacheReadTokens: 900_000, outputTokens: 10_000 }, RATE, { config: "fabric" });
  assert.equal(memory.cachedPrefixSimulation, null, "only the full arm simulates a cached prefix");
});

test("repeats_report_pass_k_and_sd", async () => {
  const report = await runBench({ offline: true, repeats: 2, maxQuestions: 4 });
  assert.equal(report.repeats, 2);
  assert.equal(report.results.length, 4);
  assert.ok(report.passK >= 0 && report.passK <= 1);
  assert.ok(report.passAtK >= 0 && report.passAtK <= 1);
  assert.equal(report.repeatAccuracy.length, 2);
  assert.ok(report.repeatAccuracySd === null || report.repeatAccuracySd >= 0);
  assert.ok(report.results.some((row) => row.id.includes("#r1")));
});

test("lexical_topk_and_truncated_arms_never_see_memory_product", async () => {
  for (const config of ["lexical-topk", "full-truncated", "oracle"]) {
    const report = await runBench({ offline: true, config, maxQuestions: 2 });
    assert.ok(!report.memoryConfig.fabric, `${config} has no fabric`);
    assert.ok(!report.memoryConfig.observational, `${config} has no OM`);
    for (const row of report.results) {
      assert.equal(row.recallCalls, 0, `${config} never calls memory.recall`);
      assert.deepEqual(row.writes, [], `${config} never writes memory`);
      assert.ok(!(row.visibleChannels ?? []).some((channel) => channel.startsWith("fabric")), `${config} sees no fabric channel`);
    }
  }
});

test("lexical_topk_selects_only_relevant_rounds", () => {
  const question = { id: "q", question: "Which validation library did we adopt?", date: "2024-04-01" };
  const sessions = [
    {
      id: "s1",
      date: "2024-03-01",
      messages: [
        { id: "m1", role: "user", text: "We adopted zod for validation." },
        { id: "m2", role: "assistant", text: "Noted." },
        { id: "m3", role: "user", text: "Lunch was pasta." },
        { id: "m4", role: "assistant", text: "Okay." },
      ],
    },
  ];
  const rounds = sessions.flatMap((session, index) => sessionRounds(session, index));
  const selected = selectLexicalRounds(question, rounds);
  assert.equal(selected.length, 1);
  assert.match(selected[0].text, /zod/);
  const filtered = comparatorSessions("lexical-topk", sessions, rounds, { allRoundIds: new Set() }, question);
  assert.equal(filtered[0].messages.length, 2);
  assert.ok(filtered[0].messages.every((message) => message.id === "m1" || message.id === "m2"));
});

test("per_judge_arm_difference_uses_each_judge_verdict", () => {
  const base = {
    suite: "beam-100k",
    subset: "dev",
    judge: "j1",
    judgePanel: ["j1", "j2"],
    judgeProtocol: "enum-json-v1",
    metricVersion: 2,
    status: "completed",
  };
  const rows = (verdicts) =>
    verdicts.map(([id, ability, v1, v2]) => ({
      id,
      ability,
      cluster: id,
      correct: v1 === "yes",
      judgeVerdicts: { j1: v1, j2: v2 },
    }));
  const a = {
    ...base,
    results: rows([
      ["q1", "x", "yes", "no"],
      ["q2", "x", "no", "no"],
    ]),
  };
  const b = {
    ...base,
    results: rows([
      ["q1", "x", "no", "no"],
      ["q2", "x", "yes", "yes"],
    ]),
  };
  const byJudge = compareJudges(a, b, { iterations: 50, simulations: 10 });
  assert.ok(byJudge.j1 && byJudge.j2);
  // j1: a=1/2, b=1/2 (no diff). j2: a=0/2, b=1/2 (b better by half a point).
  assert.equal(byJudge.j1.x.rawMeans.a, 0.5);
  assert.equal(byJudge.j1.x.rawMeans.b, 0.5);
  assert.equal(byJudge.j2.x.rawMeans.a, 0);
  assert.equal(byJudge.j2.x.rawMeans.b, 0.5);
});

test("audit_set_is_balanced_private_and_scores_kappa", () => {
  const rows = [
    ...Array.from({ length: 20 }, (_, i) => ({
      id: `a${i}`,
      ability: "multi-session",
      question: "q",
      answers: ["gold"],
      answer: "a",
      correct: i % 2 === 0,
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      id: `b${i}`,
      ability: "abstention",
      question: "q",
      answers: ["unknown"],
      answer: "unknown",
      correct: true,
    })),
  ];
  const selected = selectAuditItems(rows, { n: 12 });
  assert.equal(selected.length, 12);
  assert.ok(
    selected.some((row) => row.ability === "abstention"),
    "a small ability still gets items",
  );
  const page = renderReviewPage([{ id: "x", ability: "a", question: "<script>alert(1)</script>", gold: "g", answer: "a" }]);
  // Text is embedded as JSON data and rendered with textContent; a closing tag is escaped so it
  // cannot break out of the script element.
  assert.ok(page.includes("<script>alert(1)"));
  assert.ok(page.includes("<\\/script>"));
  assert.ok(!page.includes("</script><script>alert(1)"));
  // Labels carry ids and verdicts only; any text field is refused.
  assert.deepEqual(parseAuditLabels(JSON.stringify({ items: [{ id: "x", verdict: "correct" }] })), [{ id: "x", verdict: "correct" }]);
  assert.throws(
    () => parseAuditLabels(JSON.stringify({ items: [{ id: "x", verdict: "correct", answer: "leak" }] })),
    /only id and verdict/,
  );
  const scored = [
    { id: "x", correct: true, judgeVerdicts: { j1: "yes", j2: "yes" } },
    { id: "y", correct: false, judgeVerdicts: { j1: "no", j2: "no" } },
    { id: "z", correct: true, judgeVerdicts: { j1: "yes", j2: "yes" } },
  ];
  const result = auditKappas(
    scored,
    [
      { id: "x", verdict: "correct" },
      { id: "y", verdict: "incorrect" },
      { id: "z", verdict: "correct" },
    ],
    ["j1", "j2"],
  );
  assert.equal(result.judges.j1.n, 3);
  assert.equal(result.judges.j1.kappa, 1);
  assert.equal(result.active.length, 2);
});

const contextMessages = [
  { role: "system", content: [{ type: "text", text: "Answer briefly." }] },
  { role: "user", content: [{ type: "text", text: "x".repeat(8000) }], metadata: { sourceId: "m1" } },
  { role: "assistant", content: [{ type: "text", text: "Okay." }], metadata: { sourceId: "m2" } },
  { role: "user", content: [{ type: "text", text: "What happened?" }] },
];

test("full_context_truncation_cannot_qualify_as_complete_history", () => {
  const state = {};
  assert.throws(() => selectComparatorContext(contextMessages, 500, state, "full"), /MemoryBenchComparatorIneligible/);
  assert.equal(state.contextEligibility.completeHistory, false);
  assert.equal(state.contextEligibility.eligible, false);
  assert.equal(state.contextEligibility.removedSourceMessages, 2);
});

test("full_truncated_records_removed_source_content", () => {
  const state = {};
  const selected = selectComparatorContext(contextMessages, 500, state, "full-truncated");
  assert.equal(selected.length, 2);
  assert.equal(state.contextEligibility.eligible, true);
  assert.equal(state.contextEligibility.completeHistory, false);
  assert.equal(state.contextEligibility.removedSourceMessages, 2);
  assert.ok(state.contextEligibility.removedEstimatedTokens > 1900);
  assert.equal(state.contextEligibility.messageCap, 500);
});

test("equivalent_context_arms_are_not_a_truncation_treatment", () => {
  const full = {},
    bounded = {};
  selectComparatorContext(contextMessages, 10000, full, "full");
  selectComparatorContext(contextMessages, 10000, bounded, "full-truncated");
  assert.equal(full.contextEligibility.contextHash, bounded.contextEligibility.contextHash);
  assert.equal(full.contextEligibility.completeHistory, true);
});

test("cold_ingestion_and_warm_answer_have_separate_timers", async () => {
  const report = await runBench({ offline: true, config: "full", maxQuestions: 1, mockLatencyMs: 5 });
  assert.equal(report.timing.phases.ingestion.n, 1);
  assert.equal(report.timing.phases.answer.n, 1);
  assert.ok(report.timing.phases.answer.wallMs.mean >= 5);
  assert.ok(report.results[0].phaseTiming.ingestion >= 0);
});

test("slow_judging_does_not_inflate_product_answer_latency", async () => {
  const { createTiming } = await import("./timing.mjs");
  let now = 0;
  const timing = createTiming({ now: () => now });
  const row = {};
  const ingest = timing.startPhase(row, "ingestion");
  now += 100;
  ingest();
  const answer = timing.startPhase(row, "answer");
  now += 20;
  answer();
  const evaluation = timing.startPhase(row, "evaluation");
  now += 5000;
  evaluation();
  const summary = timing.summary({ results: [{ phaseTiming: row }] });
  assert.equal(summary.phases.answer.wallMs.p95, 20);
  assert.equal(summary.phases.evaluation.wallMs.mean, 5000);
  const root = await mkdtemp(join(tmpdir(), "prism-43-latency-"));
  try {
    const report = await runBench({
      offline: true,
      config: "full",
      maxQuestions: 1,
      mockLatencyMs: 40,
      answersDir: join(root, "answers"),
      judgeCacheDir: join(root, "judge"),
    });
    assert.ok(report.timing.phases.evaluation.wallMs.mean >= 40);
    assert.ok(
      report.timing.questions.wallMs.mean >= report.timing.phases.answer.wallMs.mean + report.timing.phases.evaluation.wallMs.mean - 1,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("role_usage_reconciles_to_wire_totals", async () => {
  const { roleUsage } = await import("./usage.mjs");
  const rows = [
    { role: "product", inputTokens: 100, outputTokens: 10, rate: RATE, status: 200, rawUsage: { input_tokens: 100 } },
    { role: "evaluation", inputTokens: 300, outputTokens: 20, rate: RATE, status: 200, rawUsage: { input_tokens: 300 } },
  ];
  const usage = roleUsage(rows);
  assert.equal(usage.product.inputTokens, 100);
  assert.equal(usage.evaluation.inputTokens, 300);
  assert.equal(usage.total.inputTokens, 400);
  assert.equal(usage.total.measured, usage.product.measured + usage.evaluation.measured);
  assert.equal(roleUsage([{ ...rows[0], rate: null }]).product.measured, null);
  assert.equal(roleUsage([{ ...rows[0], rawUsage: null }]).product.measured, null);
  const resumed = roleUsage(rows, usage);
  for (const key of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "exchanges"]) {
    assert.equal(resumed.total[key], usage.total[key] * 2);
    assert.equal(resumed.total[key], resumed.product[key] + resumed.evaluation[key] + resumed.unknown[key]);
  }
  const full = roleUsage([{ ...rows[0], cachedPrefix: true }]).product;
  assert.equal(full.cold, full.measured);
  assert.ok(full.warm < full.cold);
  assert.equal(full.inputWarm, (100 * RATE.cacheRead) / 1e6);
});

test("zero_or_unknown_comparator_cost_cannot_pass_ratio_gate", async () => {
  const { productMeasurementVerdict } = await import("./usage.mjs");
  const report = (cost, latency = 10) => ({
    usageComplete: true,
    results: [{ phaseTiming: { answer: latency } }],
    roleUsage: { product: { inputWarm: cost } },
    timing: { phases: { answer: { n: 1, wallMs: { p95: latency } } } },
  });
  for (const cost of [0, null, undefined]) assert.equal(productMeasurementVerdict(report(0), report(cost)).cost.met, false);
  assert.equal(productMeasurementVerdict(report(1), report(2)).cost.met, true);
  assert.equal(productMeasurementVerdict(report(1, 30), report(2)).latency.met, false);
  const seeded = report(1);
  seeded.measurementPolicy = { seedSnapshot: true };
  assert.equal(productMeasurementVerdict(seeded, report(2)).cost.met, false);
  const missing = report(1);
  missing.roleUsage.product.inputWarm = null;
  assert.equal(productMeasurementVerdict(missing, report(2)).cost.ratio, null);
});

test("role_usage_splits_extractor_by_cache_key", async () => {
  const { roleUsage, productMeasurementVerdict, usageRole, EXTRACT_CACHE_KEY } = await import("./usage.mjs");
  const base = { role: "product", rate: RATE, status: 200, outputTokens: 5 };
  const rows = [
    { ...base, inputTokens: 100, rawUsage: { input_tokens: 100 }, cacheKey: "session-1" },
    { ...base, inputTokens: 400, cacheReadTokens: 300, rawUsage: { input_tokens: 400 }, cacheKey: `${EXTRACT_CACHE_KEY}:default` },
    { ...base, inputTokens: 50, rawUsage: { input_tokens: 50 }, cacheKey: `${EXTRACT_CACHE_KEY}-lookalike` },
    { ...base, role: "evaluation", inputTokens: 7, rawUsage: { input_tokens: 7 }, cacheKey: EXTRACT_CACHE_KEY },
    { ...base, inputTokens: 9, rawUsage: { input_tokens: 9 } },
  ];
  assert.deepEqual(rows.map(usageRole), ["product", "product-extract", "product", "evaluation", "product"]);
  const usage = roleUsage(rows);
  assert.equal(usage.product.inputTokens, 159);
  assert.equal(usage["product-extract"].inputTokens, 400);
  assert.equal(usage["product-extract"].cacheReadTokens, 300);
  assert.equal(usage["product-extract"].exchanges, 1);
  assert.equal(usage.total.inputTokens, 566);
  assert.equal(roleUsage(rows.slice(0, 1))["product-extract"].exchanges, 0);
  // The registered cost criterion still counts every product-side call.
  const report = (answer, extract) => ({
    usageComplete: true,
    results: [{ phaseTiming: { answer: 1 } }],
    roleUsage: { product: { inputWarm: answer }, ...(extract === undefined ? {} : { "product-extract": { inputWarm: extract } }) },
    timing: { phases: { answer: { n: 1, wallMs: { p95: 1 } } } },
  });
  assert.equal(productMeasurementVerdict(report(1, 2), report(4)).cost.ratio, 0.75);
  assert.equal(productMeasurementVerdict(report(1, null), report(4)).cost.ratio, null);
});
