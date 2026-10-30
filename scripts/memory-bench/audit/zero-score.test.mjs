import { test } from "bun:test";
import assert from "node:assert/strict";
import { baselineCells, summarizeBaseline } from "../baseline.mjs";
import { stableHash } from "../journal.mjs";
import {
  combineGraded,
  createJudgeCache,
  GRADED_TEMPLATE_VERSION,
  gradedPrompt,
  JUDGE_TEMPLATE_VERSION,
  judgePrompt,
  orderingScore,
  resolveJudgePanel,
  scoreAnswer,
  scoreGraded,
  scoreGradedCached,
  scoreGradedPanel,
} from "../judge.mjs";
import prompts from "../judge-prompts.json" with { type: "json" };
import { mockProvider, replay } from "../replay.mjs";
import { robustnessCriteriaHash } from "../robustness.mjs";
import { claimDossier, classifyClaims, judgeControlsPassed, rateLimitDisposition, summarizeClaimClassification } from "./zero-score.mjs";

test("free_openrouter_judges_are_distinct_families", () => {
  const panel = resolveJudgePanel({
    judges: ["openrouter/dots-studio/dots-3-note-preview:free", "openrouter/cohere/north-mini-code:free"],
    answerModel: "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
  });
  assert.deepEqual(panel.families, ["dots", "cohere"]);
});

test("free_pool_429_is_transient_but_daily_cap_stops_the_diagnostic", () => {
  assert.equal(rateLimitDisposition(200, ""), "pass");
  assert.equal(
    rateLimitDisposition(429, '{"error":{"metadata":{"raw":"is temporarily rate-limited upstream. Please retry shortly"}}}'),
    "retry",
  );
  assert.equal(rateLimitDisposition(429, '{"error":{"message":"free-models-per-day-high-balance"}}'), "stop");
  assert.equal(rateLimitDisposition(429, '{"error":{"message":"Rate limit exceeded: 1000 requests per day"}}'), "stop");
  assert.equal(rateLimitDisposition(429, undefined), "retry");
});

test("ordering_and_summary_judge_controls_detect_inverted_or_overstrict_grading", async () => {
  for (const ability of ["event_ordering", "summarization"]) {
    const question = {
      id: ability,
      ability,
      question: "What happened?",
      answers: ["First A, then B."],
      sourceAnnotations: { rubric: ["A precedes B"] },
    };
    const generate = async (prompt) => (prompt.endsWith('"First A, then B."}') ? "yes" : "no");
    assert.equal((await scoreAnswer(question, question.answers[0], "beam-100k", generate)).correct, true);
    assert.equal((await scoreAnswer(question, "B preceded A; A never happened.", "beam-100k", generate)).correct, false);
    const prompt = judgePrompt(question, "response", "beam-100k");
    assert.match(prompt, /A precedes B/);
    assert.match(prompt, /order|chronolog/i);
    assert.match(prompt, /paraphrase|equivalent/i);
  }
  assert.ok(JUDGE_TEMPLATE_VERSION);
  assert.equal(judgeControlsPassed([{ positive: { j: "yes" }, negative: { j: "no" } }], ["j"]), true);
  for (const [positive, negative] of [
    ["no", "yes"],
    ["no", "no"],
    ["yes", "yes"],
  ]) {
    assert.equal(judgeControlsPassed([{ positive: { j: positive }, negative: { j: negative } }], ["j"]), false);
  }
  assert.equal(judgeControlsPassed([], ["j"]), false);
  assert.equal(judgeControlsPassed([{ positive: {}, negative: {} }], ["j"]), false);
});

test("ability_rubrics_reach_judging_but_not_answer_generation", async () => {
  const marker = "PRIVATE_RUBRIC_SENTINEL";
  const question = { id: "q", ability: "summarization", question: "Summarize", answers: ["gold"], sourceAnnotations: { rubric: [marker] } };
  assert.ok(judgePrompt(question, "response", "beam-100k").includes(marker));
  assert.ok(!judgePrompt(question, "response", "longmemeval-s").includes(marker));
  const state = {
    phase: "ingest",
    calls: { observer: 0, reflector: 0, dropper: 0, embedding: 0, decider: 0 },
    turns: 0,
    injections: [],
    injectionText: new Map(),
    injectedContextTokens: 0,
    mockInputTokens: 0,
    ceilingReached: () => false,
  };
  let requests = 0;
  const base = mockProvider(state);
  const provider = {
    id: "mock",
    async *generate(request) {
      requests++;
      assert.ok(!JSON.stringify(request).includes(marker));
      yield* base.generate(request);
    },
  };
  await replay(
    { ...question, date: "2024-01-02", sessions: [{ id: "s", date: "2024-01-01", messages: [{ id: "m", role: "user", text: "source" }] }] },
    { config: "full", suite: "beam-100k", modelConfig: { provider: "mock", model: "m" }, inputCap: 128000 },
    [provider],
    state,
  );
  assert.ok(requests > 0);
});

test("oracle_diagnostic_cannot_enter_product_acceptance", () => {
  const diagnostic = {
    suite: "beam-100k",
    provider: "mock",
    model: "test",
    config: "oracle",
    results: [{ id: "q", ability: "summarization", correct: true }],
  };
  assert.deepEqual(baselineCells([diagnostic]), []);
  const fullDiagnostic = { ...diagnostic, config: "full", diagnosticOnly: true };
  assert.deepEqual(summarizeBaseline([fullDiagnostic]).cells, []);
  assert.deepEqual(summarizeBaseline([diagnostic]).gaps, []);
});

/** A stand-in judge that reads the untrusted evidence JSON like a faithful model: markers in the response are rubric points present. */
const markerJudge = async (prompt) => {
  const evidence = JSON.parse(prompt.slice(prompt.indexOf('{"ability"')).split("\n")[0]);
  if (evidence.ability === "event_ordering") {
    const spots = evidence.rubric
      .map(({ n, point }) => ({ n, at: evidence.response.indexOf(point) }))
      .filter(({ at }) => at >= 0)
      .sort((a, b) => a.at - b.at);
    return JSON.stringify({ order: spots.map(({ n }) => n) });
  }
  return JSON.stringify({ scores: evidence.rubric.map(({ point }) => (evidence.response.includes(point) ? 1 : 0)) });
};
const gradedQuestion = (ability, points) => ({
  id: `${ability}:q`,
  ability,
  question: "Q",
  answers: [points.join(" ")],
  sourceAnnotations: { rubric: points },
});
// the real judge callback applies `parse` to the raw text inside askJudge
const asJudge = async (prompt, { parse }) => parse(await markerJudge(prompt));
const judged = (question, response) => scoreGraded(question, response, asJudge);

test("graded_rubric_score_gives_partial_credit_and_keeps_binary_unchanged", async () => {
  const points = ["P-one", "P-two", "P-three", "P-four", "P-five"];
  const question = gradedQuestion("summarization", points);
  const missingOne = points.slice(0, 4).join(" ");
  assert.match(gradedPrompt(question, "r"), /untrusted data/);
  assert.ok(gradedPrompt(question, "r").includes("P-three"));
  assert.equal((await judged(question, points.join(" "))).graded, 1);
  assert.equal((await judged(question, missingOne)).graded, 0.8);
  assert.equal((await judged(question, "nothing relevant")).graded, 0);
  assert.equal((await judged(question, `${points.join(" ")} plus correct extra detail`)).graded, 1);
  // binary prompt/verdict path is untouched: it still reads the reference/rubric template and is not graded
  assert.match(judgePrompt(question, missingOne, "beam-100k"), /Answer yes or no only/);
  assert.equal((await scoreAnswer(question, points.join(" "), "beam-100k", async () => "yes")).correct, true);
  assert.equal((await scoreAnswer(question, missingOne, "beam-100k", async () => "no")).correct, false);
});

test("ordering_graded_score_ranks_adjacent_swap_above_reversal", async () => {
  const points = ["E-a", "E-b", "E-c", "E-d", "E-e"];
  const question = gradedQuestion("event_ordering", points);
  const gold = (await judged(question, points.join(", "))).graded;
  const swap = (await judged(question, ["E-a", "E-b", "E-d", "E-c", "E-e"].join(", "))).graded;
  const reversed = (await judged(question, [...points].reverse().join(", "))).graded;
  assert.equal(gold, 1);
  assert.equal(reversed, 0);
  assert.ok(swap > reversed && swap < gold, `swap ${swap}`);
  assert.ok(Math.abs(swap - 0.9) < 1e-9, "one discordant pair of ten under tau-b normalised to [0,1]");
  // set overlap would score these identically; the metric must see order
  assert.notEqual(swap, reversed);
  // a response that names none of the labelled events has no defined tau and takes the floor, not NaN
  assert.equal(orderingScore([0, 0], 5).graded, 0);
  assert.equal(orderingScore([], 5).graded, 0);
  // a missing item is handled like upstream: it ranks tied last, so the remaining order still counts
  const partial = orderingScore([1, 2, 3, 4], 5);
  assert.ok(partial.graded > 0.5 && partial.graded < 1);
});

test("graded_panel_is_mean_with_disagreement_rate_not_and_rule", () => {
  const split = combineGraded({ a: 1, b: 0 });
  assert.equal(split.graded, 0.5);
  assert.equal(split.spread, 1);
  assert.equal(split.disagreement, true);
  const close = combineGraded({ a: 0.8, b: 0.9 });
  assert.ok(Math.abs(close.graded - 0.85) < 1e-9);
  assert.equal(close.disagreement, false);
  // the binary rule would floor {1, 0} to "no"; the graded mean must not
  assert.notEqual(combineGraded({ a: 1, b: 0 }).graded, 0);
});

test("graded_template_hash_is_distinct_and_binary_cache_still_hits", async () => {
  // adding graded templates must not move the binary template version
  assert.equal(JUDGE_TEMPLATE_VERSION, stableHash(prompts.prompts));
  assert.notEqual(GRADED_TEMPLATE_VERSION, JUDGE_TEMPLATE_VERSION);
  assert.equal(GRADED_TEMPLATE_VERSION, stableHash(prompts.graded));
  const binary = createJudgeCache({ root: "/nonexistent", judge: "j", generation: "g" });
  const graded = createJudgeCache({
    root: "/nonexistent",
    judge: "j",
    generation: "g",
    version: GRADED_TEMPLATE_VERSION,
    kind: "judge-graded-v1",
  });
  const id = { suite: "beam-100k", ability: "summarization", id: "q", answer: "a" };
  assert.equal(binary.key(id), stableHash({ kind: "judge-v1", version: JUDGE_TEMPLATE_VERSION, judge: "j", generation: "g", ...id }));
  assert.notEqual(binary.key(id), graded.key(id));
  const store = new Map();
  const cache = {
    key: graded.key,
    read: async (name) => store.get(name) ?? null,
    write: async (name, value) => void store.set(name, value),
  };
  const question = gradedQuestion("summarization", ["P1", "P2"]);
  let calls = 0;
  const generate = async (prompt, options) => {
    calls++;
    return asJudge(prompt, options);
  };
  const first = await scoreGradedCached(question, "P1 P2", "beam-100k", generate, cache);
  const second = await scoreGradedCached(question, "P1 P2", "beam-100k", generate, cache);
  assert.equal(calls, 1);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(second.score.graded, 1);
});

test("graded_score_cannot_change_frozen_task18_criteria_hash", () => {
  assert.equal(robustnessCriteriaHash(), "dd1add49cd1d4f023c8ecf027145ac69d10d764137db87cb015166bd80e80ea7");
});

test("complete_history_claims_classified_against_full_source_not_labels_only", () => {
  const question = {
    id: "q",
    evidence: ["s0:m1"],
    sessions: [
      {
        id: "s0",
        messages: [
          { id: "s0:m0", role: "user", text: "I picked Postgres for the ledger database" },
          { id: "s0:m1", role: "user", text: "Redis handles the session cache" },
        ],
      },
      { id: "s1", messages: [{ id: "s1:m0", role: "user", text: "Actually I moved the ledger database to SQLite" }] },
    ],
  };
  const dossier = claimDossier(question, "You chose Postgres for the ledger database. Redis handles sessions.");
  const ledger = dossier.claims[0].candidates.map((c) => c.messageId);
  assert.ok(ledger.includes("s0:m0"), "a candidate outside the labelled evidence is found");
  assert.ok(ledger.includes("s1:m0"), "a later message that may supersede it is found");
  assert.equal(dossier.claims[0].candidates.find((c) => c.messageId === "s0:m0").labelled, false);
  assert.equal(dossier.claims[1].candidates.find((c) => c.messageId === "s0:m1").labelled, true);
  const summary = summarizeClaimClassification(
    [
      { id: "q", claim: 0, class: "superseded" },
      { id: "q", claim: 1, class: "supported-labelled" },
    ],
    [dossier.claims.length && { id: "q", claims: dossier.claims.length }],
  );
  assert.deepEqual(summary.q, { "supported-labelled": 1, superseded: 1 });
  assert.throws(() => summarizeClaimClassification([{ id: "q", claim: 0, class: "vibes" }], [{ id: "q", claims: 1 }]), /class/);
  assert.throws(() => summarizeClaimClassification([], [{ id: "q", claims: 1 }]), /unclassified/);
});

test("claim_classes_use_reviewer_overrides_then_triage_then_topic_rule", () => {
  const claim = (index, specifics, candidates) => ({ index, text: "t", specifics, candidates });
  const user = (labelled, score) => ({ messageId: "m", labelled, role: "user", order: 1, score });
  const dossier = {
    id: "q",
    claims: [
      claim(0, [{ token: "OIDC", inConversation: false, inLabelled: false, inUser: false }], [user(false, 0.5)]),
      claim(1, [{ token: "42", inConversation: true, inLabelled: true, inUser: true }], [user(true, 0.9)]),
      claim(2, [{ token: "42", inConversation: true, inLabelled: false, inUser: true }], [user(false, 0.9)]),
      claim(3, [], [user(false, 0.7)]),
      claim(4, [], []),
      claim(5, [], [user(true, 0.5)]),
    ],
  };
  const classes = classifyClaims(dossier, { "q#5": "superseded" }).map((row) => row.class);
  assert.deepEqual(classes, ["unsupported", "supported-labelled", "correct-unlabelled", "correct-unlabelled", "synthesis", "superseded"]);
});

test("graded_panel_scores_every_judge_and_reuses_the_cache", async () => {
  const question = gradedQuestion("summarization", ["P1", "P2", "P3", "P4"]);
  const stores = new Map([
    ["a", new Map()],
    ["b", new Map()],
  ]);
  const caches = new Map(
    [...stores].map(([ref, store]) => [
      ref,
      {
        key: (id) => stableHash(id),
        read: async (name) => store.get(name) ?? null,
        write: async (name, value) => void store.set(name, value),
      },
    ]),
  );
  // judge b is stricter: it never credits P4
  const generateFor =
    (ref) =>
    async (prompt, { parse }) => {
      const text = await markerJudge(prompt);
      return parse(ref === "b" ? text.replace(/,1\]/, ",0]") : text);
    };
  const args = { question, answer: "P1 P2 P3 P4", suite: "beam-100k", refs: ["a", "b"], generateFor, caches };
  const first = await scoreGradedPanel(args);
  assert.equal(first.fields.graded, 0.875);
  assert.equal(first.fields.gradedSpread, 0.25);
  assert.equal(first.fields.gradedDisagreement, true);
  assert.deepEqual(first.fields.gradedJudges, { a: 1, b: 0.75 });
  assert.deepEqual([first.hits, first.misses], [0, 2]);
  const second = await scoreGradedPanel(args);
  assert.deepEqual([second.hits, second.misses], [2, 0]);
  assert.equal(second.fields.graded, 0.875);
});

test("diagnostic_budget_retains_unknown_calls_at_their_declared_bounds", async () => {
  const { diagnosticAccounting } = await import("./zero-score.mjs");
  const requests = [{ provider: "p", exchange: 1, inputBound: 1000, outputBound: 100 }];
  const missing = diagnosticAccounting([], requests);
  assert.equal(missing.accountedInputTokens, 1000);
  assert.equal(missing.accountedOutputTokens, 100);
  assert.equal(missing.usageComplete, false);
  const known = diagnosticAccounting(
    [{ provider: "p", exchange: 1, status: 200, rawUsage: { prompt_tokens: 12 }, inputTokens: 12, outputTokens: 3 }],
    requests,
  );
  assert.equal(known.accountedInputTokens, 12);
  assert.equal(known.accountedOutputTokens, 3);
  assert.equal(known.usageComplete, true);
  const failed = diagnosticAccounting([{ provider: "p", exchange: 1, status: 502, rawUsage: null }], requests);
  assert.equal(failed.accountedInputTokens, 1000);
  const refused = diagnosticAccounting([{ provider: "p", exchange: 1, status: 429, rawUsage: null }], requests);
  assert.equal(refused.accountedInputTokens, 0);
});

test("new_panel_wrong_control_expects_zero_without_changing_borderline_metrics", async () => {
  const { expectedControl } = await import("./graded.mjs");
  for (const ability of ["summarization", "event_ordering"]) {
    const q = { ability, sourceAnnotations: { rubric: ["a", "b", "c"] } };
    assert.deepEqual(expectedControl(q, "wrong"), { binary: "no", graded: 0 });
    assert.deepEqual(expectedControl(q, "gold"), { binary: "yes", graded: 1 });
  }
});
