import { spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, providerDone, providerError, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { loadDataset, MemoryBenchDatasetError, normalizeDataset, selectQuestions } from "./datasets.mjs";
import {
  causalSessions,
  extractEvidence,
  gradeEvidence,
  isTruncatedStreamFailure,
  mockProvider,
  replay,
  retrievalStage,
  sessionRounds,
} from "./replay.mjs";
import { summarize } from "./report.mjs";
import { CEILING_GRID, ceilingCells, ceilingScan, deliveryMetrics, restageReport } from "./retrieval-diagnostics.mjs";
import { askJudge, isRetryableJudgeFailure, missingUsageCount, questionFailureDisposition, runBench } from "./run.mjs";
import { compare, mcnemar } from "./stats.mjs";
import subsets from "./subsets.json" with { type: "json" };

test("malformed_judge_answers_are_retried_but_a_real_verdict_is_not", () => {
  assert.equal(isRetryableJudgeFailure(new Error("MemoryBenchJudgeError: invalid verdict JSON")), true);
  assert.equal(isRetryableJudgeFailure(new Error("Chat stream ended without completion evidence")), true);
  assert.equal(isRetryableJudgeFailure(new Error("MemoryBenchTokenCeiling")), false);
});

test("duplicate_haystack_session_ids_are_disambiguated", () => {
  const row = {
    question_id: "q1",
    question_type: "single-session-user",
    question: "q?",
    answer: "a",
    question_date: "2026-01-01",
    haystack_session_ids: ["same", "same"],
    haystack_dates: ["2026-01-01", "2026-01-02"],
    haystack_sessions: [[{ role: "user", content: "one" }], [{ role: "user", content: "two", has_answer: true }]],
    answer_session_ids: ["same"],
  };
  const [question] = normalizeDataset([row], "longmemeval-s");
  assert.deepEqual(new Set(question.sessions.map((session) => session.id)), new Set(["same", "same~2"]));
  assert.deepEqual(
    new Set(question.sessions.flatMap((session) => session.messages.map((message) => message.id))),
    new Set(["same:0", "same~2:0"]),
  );
  assert.deepEqual(new Set(question.answerSessionIds), new Set(["same", "same~2"]));
});

test("usage_less_exchanges_are_flagged_not_fatal", () => {
  const rows = [
    { status: 200, rawUsage: { input_tokens: 10 } },
    { status: 200, rawUsage: { prompt_tokens: 4 } },
    { status: 200, rawUsage: {} },
    { status: 200 },
    { status: 500 },
  ];
  assert.equal(missingUsageCount(rows), 2);
});

test("truncated_stream_is_retried_but_a_real_failure_is_not", () => {
  const truncated = {
    status: "failed",
    error: { message: "Chat stream ended without completion evidence ([DONE]: missing, finish_reason: missing)" },
  };
  assert.equal(isTruncatedStreamFailure(truncated), true);
  assert.equal(isTruncatedStreamFailure({ status: "completed", error: undefined }), false);
  assert.equal(
    isTruncatedStreamFailure({ status: "failed", error: { code: "ERR_PRISM_RUN_LIMIT", message: "without completion evidence" } }),
    false,
  );
  assert.equal(isTruncatedStreamFailure({ status: "failed", error: { message: "HTTP 400 bad request" } }), false);
});

function benchState() {
  return {
    phase: "ingest",
    calls: { observer: 0, reflector: 0, dropper: 0, embedding: 0, decider: 0 },
    turns: 0,
    injections: [],
    injectionText: new Map(),
    injectedContextTokens: 0,
    mockInputTokens: 0,
    ceilingReached: () => false,
  };
}

const retryQuestion = {
  id: "retry-question",
  question: "What color is the project?",
  answers: ["cobalt"],
  date: "2024-01-02T00:00:00.000Z",
  sessions: [
    {
      id: "s1",
      date: "2024-01-01T00:00:00.000Z",
      messages: [{ id: "m1", role: "user", text: "The project color is cobalt." }],
    },
  ],
};

function truncatingProvider(state, onAnswer, onIngest) {
  const base = mockProvider(state);
  let first = true;
  return {
    id: "mock",
    async *generate(request) {
      const names = request.tools?.map((tool) => tool.name) ?? [];
      const worker = names.some((name) => ["record_observation", "record_reflection", "drop_observations"].includes(name));
      if (!worker) {
        const answerAttempt = first ? 1 : 2;
        onAnswer?.(request, answerAttempt);
        if (first) {
          first = false;
          yield providerTextDelta("PARTIAL_ANSWER_MUST_NOT_LEAK");
          yield providerError(new Error("Chat stream ended without completion evidence ([DONE]: missing, finish_reason: missing)"));
          return;
        }
      } else onIngest?.(request);
      yield* base.generate(request);
    },
  };
}

test("truncated_answer_retry_sees_identical_clean_history", async () => {
  const state = benchState();
  const seen = [];
  const provider = truncatingProvider(state, (request) => seen.push(JSON.stringify(request.messages)));
  const result = await replay(
    retryQuestion,
    { config: "full", suite: "longmemeval-s", modelConfig: { provider: "mock", model: "m" }, inputCap: 128000 },
    [provider],
    state,
  );
  assert.equal(result.answerRetries, 1);
  assert.equal(seen.length, 2);
  assert.ok(!seen[1].includes("PARTIAL_ANSWER_MUST_NOT_LEAK"), "the retry must not see partial output");
  assert.ok(seen[1].includes("The project color is cobalt."), "the retry sees the original source history");
  assert.equal(result.answer, "cobalt");
});

test("retry_ingests_once_and_accounts_all_attempts", async () => {
  const state = benchState();
  let embeddingsWhenFirstAnswerFailed;
  const provider = truncatingProvider(state, () => {
    embeddingsWhenFirstAnswerFailed ??= state.calls.embedding;
  });
  const result = await replay(
    retryQuestion,
    {
      config: "fabric-hybrid",
      suite: "longmemeval-s",
      offline: true,
      embeddings: "mock/embeddings",
      modelConfig: { provider: "mock", model: "m" },
      inputCap: 128000,
    },
    [provider],
    state,
  );
  assert.equal(result.answerRetries, 1);
  assert.ok(embeddingsWhenFirstAnswerFailed > 0, "ingestion embedded the corpus");
  assert.equal(state.embeddingPhases.ingest, 1, "the retry did not ingest again");
  assert.equal(state.embeddingPhases.answer, 2, "both answer attempts are accounted");
  assert.equal(result.storage.fabric, "disposable");
});

test("retry_does_not_duplicate_om_workers_or_promotions", async () => {
  const state = benchState();
  let sourceObservations = 0;
  let sourcesAtFailure;
  let sourcesBeforeRetry;
  const provider = truncatingProvider(
    state,
    (_request, attempt) => {
      if (attempt === 1) sourcesAtFailure = sourceObservations;
      else sourcesBeforeRetry = sourceObservations;
    },
    (request) => {
      if (JSON.stringify(request.messages).includes("The project color is cobalt.")) sourceObservations++;
    },
  );
  const result = await replay(
    retryQuestion,
    { config: "om", suite: "longmemeval-s", offline: true, modelConfig: { provider: "mock", model: "m" }, inputCap: 128000 },
    [provider],
    state,
  );
  assert.equal(result.answerRetries, 1);
  assert.ok(sourcesAtFailure > 0, "OM observed the ingested history");
  assert.equal(sourcesBeforeRetry, sourcesAtFailure, "the answer retry did not re-observe the ingested history");
  assert.ok(state.calls.observer >= sourcesAtFailure);
});

test("combined_history_has_no_future_foreign_or_target_oracle_records", async () => {
  const state = benchState();
  let answerRequest;
  const provider = mockProvider(state);
  const seen = {
    id: "mock",
    async *generate(request) {
      if (!request.tools?.length) answerRequest = JSON.stringify(request.messages);
      yield* provider.generate(request);
    },
  };
  const question = {
    ...retryQuestion,
    id: "causal-question",
    oracle: { secret: "TARGET_ORACLE_MUST_NOT_LEAK" },
    sessions: [
      ...retryQuestion.sessions,
      {
        id: "future",
        date: "2024-02-01T00:00:00.000Z",
        messages: [{ id: "future:1", role: "user", text: "FUTURE_SESSION_MUST_NOT_LEAK" }],
      },
    ],
  };
  assert.equal(causalSessions(question).length, 1);
  const result = await replay(
    question,
    { config: "full", suite: "longmemeval-s", modelConfig: { provider: "mock", model: "m" }, inputCap: 128000 },
    [seen],
    state,
  );
  assert.equal(result.answer, "cobalt");
  assert.ok(answerRequest.includes("The project color is cobalt."));
  assert.ok(!answerRequest.includes("FUTURE_SESSION_MUST_NOT_LEAK"));
  assert.ok(!answerRequest.includes("TARGET_ORACLE_MUST_NOT_LEAK"));
});

test("auth_permanent_budget_and_runlimit_failures_keep_original_reason", async () => {
  const state = benchState();
  let requests = 0;
  const provider = {
    id: "mock",
    async *generate() {
      requests++;
      yield providerError(Object.assign(new Error("invalid api key"), { code: "401", failureClass: "auth" }));
    },
  };
  await assert.rejects(
    replay(
      retryQuestion,
      { config: "full", suite: "longmemeval-s", modelConfig: { provider: "mock", model: "m" }, inputCap: 128000 },
      [provider],
      state,
    ),
    /MemoryBenchAnswerError:401/,
  );
  assert.equal(requests, 1, "auth is never retried");
});

test("run_limit_answer_is_scored_wrong_and_arm_continues", async () => {
  const module = await import("./replay.mjs");
  const original = module.replay;
  let requests = 0;
  const provider = {
    id: "mock",
    async *generate() {
      requests++;
      yield providerToolCall(toolCallContent("recall", "memory.recall", { query: "project color", kinds: ["all"] }));
      yield providerDone();
    },
  };
  let questions = 0;
  const spy = spyOn(module, "replay").mockImplementation((question, options, providers, state) =>
    original(question, options, questions++ === 0 ? [provider] : providers, state),
  );
  try {
    const report = await runBench({ offline: true, config: "fabric-agentic" });
    assert.equal(report.status, "completed");
    assert.ok(report.results.length > 1);
    const row = report.results[0];
    assert.equal(row.outcome, "run_limit");
    assert.equal(row.correct, false);
    assert.equal(row.answerRetries, 0);
    assert.equal(requests, 8, "run_limit_is_not_retried: exactly the standard turn allowance");
    assert.ok(row.turnTrace.length > 0 && row.turnTrace.length <= 64);
    assert.ok(row.turnTrace.every((name) => name === "memory.recall"));
    assert.equal(report.abilities[row.ability].runLimitRate, 1 / report.abilities[row.ability].n);
    assert.equal(report.runLimitRate, 1 / report.results.length);
    assert.ok(!JSON.stringify(row).includes("project color"));
    assert.equal(report.protocol.maxTurns, 8);
    assert.ok(report.results.slice(1).every((result) => result.outcome !== "run_limit"));
    const { summarize } = await import("./report.mjs");
    assert.equal(summarize({ results: [] }).runLimitRate, 0);
  } finally {
    spy.mockRestore();
  }
});

test("malformed_judge_retry_uses_fresh_session", async () => {
  let requests = 0;
  let secondRequest = "";
  const provider = {
    id: "mock",
    async *generate(request) {
      requests++;
      if (requests === 2) secondRequest = JSON.stringify(request.messages);
      yield providerTextDelta(requests === 1 ? "not-json" : '{"verdict":"yes"}');
      yield providerDone();
    },
  };
  const agent = await createAgent({
    model: { provider: "mock", model: "m", capabilities: { structuredOutput: "json_schema" } },
    compaction: false,
    retry: false,
    packages: [providerPackage("test-judge", [provider])],
    limits: { maxTurns: 1, maxInputTokens: null, maxTotalTokens: null, maxWallTimeMs: 60_000 },
  });
  const calls = { judge: 0, judgeAttempts: 0 };
  let checks = 0;
  let releases = 0;
  try {
    const verdict = await askJudge({
      agent,
      prompt: "Judge this answer.",
      labels: ["yes", "no"],
      admission: { check: () => checks++, release: () => releases++ },
      account: async () => {},
      ceilingReached: () => false,
      calls,
      backoffMs: () => 0,
    });
    assert.equal(verdict, "yes");
    assert.equal(checks, 2, "every retry re-checks admission");
    assert.equal(releases, 2);
    assert.equal(calls.judge, 1, "one logical judge request");
    assert.equal(calls.judgeAttempts, 2, "two provider attempts");
    assert.ok(!secondRequest.includes("not-json"), "the retry starts from a fresh session");
  } finally {
    await agent.dispose();
  }
});

test("judge_auth_failure_keeps_original_reason_and_is_not_retried", async () => {
  let requests = 0;
  const provider = {
    id: "mock",
    async *generate() {
      requests++;
      yield providerError(Object.assign(new Error("invalid api key"), { code: "401", failureClass: "auth" }));
    },
  };
  const agent = await createAgent({
    model: { provider: "mock", model: "m", capabilities: { structuredOutput: "json_schema" } },
    compaction: false,
    retry: false,
    packages: [providerPackage("test-judge-auth", [provider])],
    limits: { maxTurns: 1, maxInputTokens: null, maxTotalTokens: null, maxWallTimeMs: 60_000 },
  });
  const calls = { judge: 0, judgeAttempts: 0 };
  try {
    await assert.rejects(
      askJudge({
        agent,
        prompt: "Judge this answer.",
        labels: ["yes", "no"],
        account: async () => {},
        ceilingReached: () => false,
        calls,
        backoffMs: () => 0,
      }),
      (error) => error.message === "MemoryBenchJudgeError:401" && error.cause?.failureClass === "auth",
    );
    assert.equal(requests, 1);
    assert.equal(calls.judgeAttempts, 1);
  } finally {
    await agent.dispose();
  }
});

test("valid_negative_verdict_is_not_retried", async () => {
  let requests = 0;
  const provider = {
    id: "mock",
    async *generate() {
      requests++;
      yield providerTextDelta('{"verdict":"no"}');
      yield providerDone();
    },
  };
  const agent = await createAgent({
    model: { provider: "mock", model: "m", capabilities: { structuredOutput: "json_schema" } },
    compaction: false,
    retry: false,
    packages: [providerPackage("test-judge-negative", [provider])],
    limits: { maxTurns: 1, maxInputTokens: null, maxTotalTokens: null, maxWallTimeMs: 60_000 },
  });
  const calls = { judge: 0, judgeAttempts: 0 };
  try {
    assert.equal(
      await askJudge({
        agent,
        prompt: "Judge this answer.",
        labels: ["yes", "no"],
        account: async () => {},
        ceilingReached: () => false,
        calls,
        backoffMs: () => 0,
      }),
      "no",
    );
    assert.equal(requests, 1);
    assert.equal(calls.judgeAttempts, 1);
  } finally {
    await agent.dispose();
  }
});

test("valid_wrong_answer_is_not_retried", async () => {
  const state = benchState();
  let requests = 0;
  const provider = {
    id: "mock",
    async *generate() {
      requests++;
      yield providerTextDelta("wrong");
      yield providerDone();
    },
  };
  const result = await replay(
    retryQuestion,
    { config: "full", suite: "longmemeval-s", modelConfig: { provider: "mock", model: "m" }, inputCap: 128000 },
    [provider],
    state,
  );
  assert.equal(result.answer, "wrong");
  assert.equal(result.answerRetries, 0);
  assert.equal(requests, 1, "a completed wrong answer is not retried");
});

test("lifecycle_suite_offline_smoke_reports_all_metrics", async () => {
  const report = await runBench({ suite: "lifecycle", offline: true, projects: 2, sessions: 2 });
  assert.equal(report.status, "completed");
  assert.equal(report.sessions.length, 4);
  assert.deepEqual(
    Object.keys(report.metrics).sort(),
    [
      "taskSuccess",
      "crossProjectLeakage",
      "foreignContextExposure",
      "staleUseRate",
      "repeatedErrorRate",
      "rightTimeRecall",
      "abstentionCorrectness",
      "tokensPerSession",
      "poisonStored",
      "poisonVisible",
      "poisonReused",
      "poisonPersistence",
    ].sort(),
  );
  assert.equal(new Set(report.sessions.map((r) => r.cluster)).size, 1);
  assert.ok(report.inputTokens > 0);
  assert.ok(report.calls.observer > 0);
  assert.ok(!JSON.stringify(report).includes("flush-before-retry"));
});

test("lifecycle_suite_full_schedule_and_ceiling", async () => {
  const full = await runBench({ suite: "lifecycle", offline: true, config: "fabric" });
  assert.equal(full.status, "completed");
  assert.equal(full.sessions.length, 24);
  assert.ok(Object.values(full.metrics).every(Number.isFinite));
  const partial = await runBench({ suite: "lifecycle", offline: true, maxInputTokens: 1 });
  assert.equal(partial.status, "token-ceiling");
  assert.ok(partial.sessions.length < 24);
  assert.ok(partial.inputTokens > 0);
});

test("lifecycle_suite_cli_writes_metrics_and_refuses_unsafe_modes", async () => {
  const { rm, readFile } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "lifecycle-report-"));
  try {
    const out = join(dir, "report.json");
    const child = Bun.spawn(
      [
        "timeout",
        "60s",
        "bun",
        "scripts/memory-bench/run.mjs",
        "--suite",
        "lifecycle",
        "--offline",
        "--persona",
        "scripted",
        "--seed",
        "8",
        "--output",
        out,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    assert.equal(await child.exited, 0, await new Response(child.stderr).text());
    assert.equal(JSON.parse(await readFile(out, "utf8")).sessions.length, 24);
    assert.match(await readFile(out.replace(".json", ".md"), "utf8"), /tokensPerSession/);
    await assert.rejects(runBench({ suite: "lifecycle", offline: true, persona: "llm" }), /Arguments/);
    await assert.rejects(runBench({ suite: "lifecycle", offline: true, policy: { scopes: { user: false } } }), /Identity/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("memory_bench_refuses_checksum_mismatch", async () => {
  const cache = await mkdtemp(join(tmpdir(), "memory-bench-"));
  await writeFile(join(cache, "locomo.json"), "tampered");
  await assert.rejects(loadDataset("locomo", { cache }), { name: "MemoryBenchDatasetError" });
});
test("memory_bench_offline_smoke_reports_every_ability", async () => {
  const report = await runBench({ offline: true });
  assert.deepEqual(Object.keys(report.abilities).sort(), [...subsets.abilities].sort());
  assert.ok(report.inputTokens > 0);
  assert.equal(report.abilityGroups["information-extraction"].n, 3);
  assert.equal(report.cacheReadTokens, 0);
  assert.equal(report.results.length, subsets.abilities.length);
  assert.equal(report.status, "completed");
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes("cobalt") && !serialized.includes("What color"));
});
test("memory_bench_aborts_at_token_ceiling", async () => {
  const report = await runBench({ offline: true, maxInputTokens: 1 });
  assert.equal(report.status, "token-ceiling");
  assert.equal(report.results.length, 1);
  assert.ok(report.inputTokens > 1);
});
test("memory_bench_keeps_small_om_history_without_duplicate_injection", async () => {
  const report = await runBench({ offline: true, config: "om" });
  assert.equal(report.injections.length, 0); // No compaction boundary in this small fixture (plan 188 Task 5).
  assert.equal(
    report.injections.reduce((n, item) => n + item.tokens, 0),
    report.injectedContextTokens,
  );
  assert.ok(report.injections.every((item) => item.source === "om" && item.id && item.placement));
});
test("memory_bench_compare_is_paired_mcnemar", () => {
  assert.equal(mcnemar(0, 5), 0.0625);
  assert.equal(mcnemar(0, 0), 1);
  const a = { suite: "s", subset: "base", results: [{ id: "1", ability: "a", correct: true }] };
  const b = { ...a, results: [{ id: "2", ability: "a", correct: false }] };
  assert.throws(() => compare(a, b), /paired/);
  assert.equal(compare(a, a).a.p, 1);
});
test("memory_bench_targeted_subset_contains_base_subset", () => {
  for (const [ability, ids] of Object.entries(subsets.longmemeval.targeted)) {
    assert.equal(ids.length, 30);
    assert.equal(new Set(ids).size, 30);
    assert.ok(subsets.longmemeval.base[ability].every((id) => ids.includes(id)));
  }
});
test("memory_bench_subset_refuses_missing_ids", () => {
  assert.throws(() => selectQuestions([], "longmemeval-s"), /subset/);
});

test("memory_bench_keeps_dates_and_trims_oldest_complete_turns", async () => {
  const { datedMessages, capMessages } = await import("./replay.mjs");
  const source = { role: "user", content: [{ type: "text", text: "old" }], metadata: { sourceDate: "2025-01-01T00:00:00.000Z" } };
  const dated = datedMessages([source]);
  assert.match(dated[0].content[0].text, /^\[2025-01-01/);
  assert.equal(source.content[0].text, "old");
  const newest = { role: "user", content: [{ type: "text", text: "question" }] };
  const state = {};
  const trimmed = capMessages([source, { role: "assistant", content: [{ type: "text", text: "x".repeat(1000) }] }, newest], 100, state);
  assert.deepEqual(trimmed, [newest]);
  assert.equal(state.truncated, true);
});
test("memory_bench_scoring_uses_alternatives_and_refuses_invalid_judges", async () => {
  const { scoreAnswer, normalizeMab } = await import("./judge.mjs");
  const question = { ability: "knowledge-update", question: "current?", answers: ["the blue-box", "green"] };
  assert.equal((await scoreAnswer(question, "A bluebox.", "memoryagentbench-cr")).correct, true);
  assert.equal(normalizeMab("The A. B!"), "b");
  await assert.rejects(
    scoreAnswer(question, "green", "longmemeval-s", async () => "maybe"),
    /JudgeError/,
  );
});
test("judge_json_protocol_preserves_strict_enum_validation", async () => {
  const { judgeOutput, judgeProviderOptions } = await import("./judge.mjs");
  assert.equal(judgeOutput('{"verdict":"used"}', ["used", "irrelevant"]), "used");
  for (const text of ['"used"', '{"verdict":"maybe"}', '{"verdict":"used","extra":true}', "used because relevant"])
    assert.throws(() => judgeOutput(text, ["used", "irrelevant"]), /JudgeError/);
  assert.deepEqual(judgeProviderOptions(["yes", "no"]).structuredOutput.schema.properties.verdict.enum, ["yes", "no"]);
});
test("memory_bench_rejects_unknown_flags_and_invalid_limits", async () => {
  const { parseArgs } = await import("./run.mjs");
  assert.throws(() => parseArgs(["--max-input-tokens", "NaN"]), /Arguments/);
  assert.throws(() => parseArgs(["--unknown"]), /Arguments/);
  assert.equal(parseArgs(["--max-input-tokens", "1"]).maxInputTokens, 1);
});
test("memory_bench_dataset_protocols_preserve_roles_dates_and_adversarial_gold", async () => {
  const { normalizeDataset, isoDate } = await import("./datasets.mjs");
  assert.equal(isoDate("1:56 pm on 8 May, 2023"), "2023-05-08T13:56:00.000Z");
  const rows = normalizeDataset(
    [
      {
        sample_id: "c",
        conversation: {
          speaker_a: "A",
          speaker_b: "B",
          session_1_date_time: "1:56 pm on 8 May, 2023",
          session_1: [{ speaker: "B", dia_id: "D1", text: "hello" }],
        },
        qa: [{ category: 5, question: "q", adversarial_answer: "wrong" }],
      },
    ],
    "locomo",
  );
  assert.equal(rows[0].sessions[0].messages[0].role, "assistant");
  assert.equal(rows[0].sessions[0].messages[0].id, "D1");
  assert.ok(!rows[0].answers.includes("wrong"));
  const facts = normalizeDataset(
    [{ context: "old\nnew", metadata: { source: "factconsolidation_sh_6k" }, questions: ["q"], answers: [["a", "b"]] }],
    "memoryagentbench-cr",
  );
  assert.equal(facts[0].syntheticDates, true);
  assert.deepEqual(facts[0].answers, ["a", "b"]);
  assert.deepEqual(
    facts[0].sessions.map((s) => s.messages[0].text),
    ["old", "new"],
  );
});
test("memory_bench_question_pool_is_bounded_and_stops_admission", async () => {
  const { runQuestionPool } = await import("./run.mjs");
  let active = 0,
    peak = 0,
    stopped = false;
  const seen = [];
  await runQuestionPool(
    [1, 2, 3, 4, 5],
    2,
    async (question) => {
      active++;
      peak = Math.max(peak, active);
      seen.push(question);
      await new Promise((resolve) => setTimeout(resolve, 1));
      stopped = true;
      active--;
    },
    () => stopped,
  );
  assert.equal(peak, 2);
  assert.deepEqual(seen, [1, 2]);
});

test("memory_bench_logs_item_metadata_and_judges_only_each_item_text", async () => {
  const { createAgent, definePackage, providerDone } = await import("@arnilo/prism");
  const { providerPackage } = await import("@arnilo/prism/provider-kit");
  const { injectionLogger, tokens } = await import("./injection-log.mjs");
  const content = "# Memory\n- [short] blue\n- [long] a much longer unrelated source-backed memory";
  const state = { phase: "answer", questionId: "q", turns: 0, injectedContextTokens: 0, injections: [], injectionText: new Map() };
  const agent = await createAgent({
    model: "mock/m",
    packages: [
      providerPackage("bench-test-provider", [
        {
          id: "mock",
          async *generate() {
            yield providerDone();
          },
        },
      ]),
      definePackage({
        name: "bench-test-memory",
        version: "0.13.0",
        requires: { api: 1 },
        setup(prism) {
          prism.hooks.on("context.build", (draft) => ({
            ...draft,
            context: [{ title: "memory", content, metadata: { source: "fabric-semantic", itemIds: ["short", "long"] } }],
          }));
        },
      }),
      injectionLogger(state),
    ],
  });
  try {
    const session = await agent.session();
    await session.run("q");
    assert.equal(state.injections.length, 2);
    assert.equal(state.injectedContextTokens, tokens(content));
    assert.equal(
      state.injections.reduce((sum, item) => sum + item.tokens, 0),
      tokens(content),
    );
    assert.ok(state.injections[1].tokens > state.injections[0].tokens);
    assert.ok(!state.injectionText.get(state.injections[0]).includes("unrelated"));
    assert.ok(state.injections.every((item) => item.source === "fabric-semantic" && item.granularity === "item"));
  } finally {
    await agent.dispose();
  }
});

test("memory_bench_logs_tail_context_metadata_and_item_tokens", async () => {
  const { createAgent, definePackage, providerDone } = await import("@arnilo/prism");
  const { providerPackage } = await import("@arnilo/prism/provider-kit");
  const { withTailContext } = await import("@arnilo/prism-memory-core");
  const { injectionLogger, tokens } = await import("./injection-log.mjs");
  const content = "# Memory\n- [short] blue\n- [long] a much longer unrelated source-backed memory";
  const state = { phase: "answer", questionId: "q", turns: 0, injectedContextTokens: 0, injections: [], injectionText: new Map() };
  const agent = await createAgent({
    model: "mock/m",
    packages: [
      providerPackage("bench-test-provider", [
        {
          id: "mock",
          async *generate() {
            yield providerDone();
          },
        },
      ]),
      definePackage({
        name: "bench-test-memory",
        version: "0.13.0",
        requires: { api: 1 },
        setup(prism) {
          prism.hooks.on("context.build", (draft) =>
            withTailContext(draft, [
              {
                title: "memory",
                content,
                metadata: {
                  source: "fabric-semantic",
                  itemIds: ["short", "long"],
                  tokens: tokens(content),
                  coverageById: { short: 0.5, long: 0.8 },
                },
              },
            ]),
          );
        },
      }),
      injectionLogger(state),
    ],
  });
  try {
    const session = await agent.session();
    await session.run("q");
    assert.equal(state.injections.length, 2);
    assert.deepEqual(
      state.injections.map((item) => item.coverage),
      [0.5, 0.8],
    );
    assert.ok(state.injections.every((item) => item.placement === "tail"));
    assert.equal(state.injectedContextTokens, tokens(content));
    assert.equal(
      state.injections.reduce((sum, item) => sum + item.tokens, 0),
      tokens(content),
    );
    assert.ok(state.injections[1].tokens > state.injections[0].tokens);
    assert.ok(!state.injectionText.get(state.injections[0]).includes("unrelated"));
    assert.ok(state.injections.every((item) => item.source === "fabric-semantic" && item.granularity === "item"));
  } finally {
    await agent.dispose();
  }
});

test("memory_bench_replay_uses_distinct_ids_and_suite_abstention", async () => {
  const { replay } = await import("./replay.mjs");
  const { providerTextDelta, providerDone } = await import("@arnilo/prism");
  const ids = [];
  const instructions = [];
  const provider = {
    id: "mock",
    async *generate(request) {
      ids.push(request.options.sessionId);
      instructions.push(JSON.stringify(request.messages));
      yield providerTextDelta("answer");
      yield providerDone();
    },
  };
  const question = { id: "q", question: "q", date: "2025-01-01T00:00:00.000Z", sessions: [] };
  const state = () => ({
    phase: "answer",
    calls: {},
    turns: 0,
    injections: [],
    injectionText: new Map(),
    injectedContextTokens: 0,
    ceilingReached: () => false,
  });
  await Promise.all(
    ["longmemeval-s", "locomo"].map((suite) =>
      replay(question, { suite, config: "full", inputCap: 128000, modelConfig: { provider: "mock", model: "m" } }, [provider], state()),
    ),
  );
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
  assert.ok(instructions.some((text) => text.includes("say unknown")));
  assert.ok(instructions.some((text) => text.includes("say no information available")));
});
test("memory_bench_base_subset_interleaves_every_stratum", () => {
  const questions = Object.entries(subsets.longmemeval.base).flatMap(([ability, ids]) => ids.map((id) => ({ id, ability })));
  const selected = selectQuestions(questions, "longmemeval-s");
  assert.equal(selected.length, 70);
  assert.equal(new Set(selected.slice(0, 7).map((row) => row.ability)).size, 7);
});
test("memory_bench_refuses_unpaired_judges_and_duplicate_questions", () => {
  const base = { suite: "s", subset: "base", judge: "p/a", results: [{ id: "q", ability: "a", correct: true }] };
  assert.throws(() => compare(base, { ...base, judge: "p/b" }), /paired/);
  assert.throws(() => compare(base, { ...base, results: [...base.results, ...base.results] }), /paired/);
});

test("memory_bench_retries_empty_gateway_errors_but_not_validation_errors", async () => {
  const { benchmarkFetch } = await import("./run.mjs");
  let calls = 0,
    retries = 0;
  const transport = benchmarkFetch({
    fetch: async () => {
      calls++;
      return calls === 1 ? new Response("event: error\ndata: {}\n\n", { status: 400 }) : new Response("ok");
    },
    onRetry: () => retries++,
  });
  assert.equal((await transport("https://example.invalid")).status, 200);
  assert.equal(calls, 2);
  assert.equal(retries, 1);
  calls = 0;
  const invalid = benchmarkFetch({
    fetch: async () => {
      calls++;
      return new Response("invalid schema", { status: 400 });
    },
  });
  assert.equal((await invalid("https://example.invalid")).status, 400);
  assert.equal(calls, 1);
  calls = 0;
  const ceiling = benchmarkFetch({
    beforeAttempt: async () => {
      throw new Error("MemoryBenchTokenCeiling");
    },
    fetch: async () => {
      calls++;
      return new Response("ok");
    },
  });
  await assert.rejects(ceiling("https://example.invalid"), /TokenCeiling/);
  assert.equal(calls, 0);
});

test("memory_bench_report_writes_remain_valid_under_concurrent_checkpoints", async () => {
  const { writeReport, summarize } = await import("./report.mjs");
  const dir = await mkdtemp(join(tmpdir(), "memory-bench-report-"));
  const path = join(dir, "report.json");
  const report = summarize({
    suite: "s",
    config: "full",
    status: "running",
    judge: "mock",
    inputTokens: 1,
    cacheReadTokens: 0,
    turns: 0,
    injections: [],
    results: [],
  });
  await Promise.all([1, 2, 3].map((value) => writeReport({ ...report, inputTokens: value }, path)));
  const final = await Bun.file(path).json();
  assert.ok([1, 2, 3].includes(final.inputTokens));
  await assert.rejects(writeReport(report, join(dir, "invalid.md")), /output must end/);
});

test("memory_bench_cancels_dataset_download_at_pinned_byte_cap", async () => {
  const cache = await mkdtemp(join(tmpdir(), "memory-bench-download-"));
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(loadDataset("locomo", { cache, fetch: async () => new Response(stream) }), { name: "MemoryBenchDatasetError" });
  assert.equal(cancelled, true);
  assert.equal(await Bun.file(join(cache, "locomo.json")).exists(), false);
});

test("markdown_scale_smoke_reports_all_metrics", async () => {
  const child = Bun.spawn([process.execPath, "scripts/memory-bench/markdown-scale.mjs", "--notes", "200"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill(), 60000);
  try {
    const output = await new Response(child.stdout).text();
    const errors = await new Response(child.stderr).text();
    assert.equal(await child.exited, 0, errors);
    const result = JSON.parse(output.trim().split("\n").at(-1));
    assert.equal(result.notes, 200);
    assert.equal(result.editedNotes, 2);
    for (const key of ["cold", "warm", "edited"]) assert.ok(result[key].ms > 0);
    for (const key of ["writeP50Ms", "writeP95Ms", "recallP50Ms", "recallP95Ms", "indexBytes", "treeBytes"])
      assert.ok(Number.isFinite(result[key]) && result[key] > 0, key);
    assert.ok(result.writeP95Ms >= result.writeP50Ms);
    assert.ok(result.recallP95Ms >= result.recallP50Ms);
    assert.ok(result.treeBytes > result.indexBytes);
  } finally {
    clearTimeout(timer);
  }
}, 65000);

test("mock_agentic_question_converges_in_three_turns", async () => {
  // Plan 188.9 Task 6: recall returns snippets, so the mock reads the ids it was shown, then answers.
  const report = await runBench({ offline: true, config: "fabric-agentic", maxQuestions: 1 });
  const row = report.results[0];
  assert.deepEqual(row.turnTrace, ["memory.recall", "memory.read"], "recall -> read ids -> answer, no discovery call");
  assert.equal(row.turns, 3, "three model rounds: recall, read, answer");
  assert.equal(row.toolCalls, 2);
  assert.equal(report.protocol.maxTurns, 8, "the treatment is the tools, not a raised turn limit");
  assert.notEqual(row.outcome, "run_limit");
});

test("memory_bench_fabric_hybrid_requires_embeddings", async () => {
  await assert.rejects(runBench({ offline: true, config: "fabric-hybrid" }), /fabric-hybrid requires --embeddings/);
});

test("memory_bench_fabric_configs_offline_smoke", async () => {
  const configs = [
    { config: "fabric" },
    { config: "fabric-hybrid", embeddings: "mock/embeddings" },
    { config: "fabric-agentic" },
    { config: "om+fabric" },
  ];
  for (const opt of configs) {
    const report = await runBench({ offline: true, ...opt, maxQuestions: 2 });
    assert.equal(report.status, "partial");
    assert.equal(report.results.length, 2);
    if (opt.config === "fabric") {
      assert.equal(report.toolCalls, 0);
      assert.equal(report.recallCalls, 2);
      assert.equal(report.calls.embedding, 0);
    } else if (opt.config === "fabric-agentic") {
      assert.ok(report.toolCalls > 0);
      assert.ok(report.recallCalls > 0);
      assert.equal(report.calls.embedding, 0);
    } else if (opt.config === "fabric-hybrid") {
      assert.ok(report.calls.embedding > 0);
      assert.equal(report.toolCalls, 0);
      assert.equal(report.recallCalls, 2);
    } else if (opt.config === "om+fabric") {
      assert.ok(report.calls.observer > 0, "OM ingests dated history");
      assert.equal(report.toolCalls, 0, "combined public arm stays passive");
      assert.ok(report.recallCalls > 0, "fabric supplies a passive memory channel");
    }
    assert.equal(
      report.results.every((result) => result.storage.fabric === "disposable"),
      true,
    );
    const serialized = JSON.stringify(report);
    assert.ok(!serialized.includes("cobalt") && !serialized.includes("What color"));
  }
});

test("memory_bench_passes_scopes_and_keeps_single_project_questions_paired", async () => {
  const report = await runBench({ offline: true, config: "fabric", maxQuestions: 2 });
  const scopes = report.memoryConfig.fabric.scopes;
  // One project scope per question; user and agent scopes stay off so each answer pairs with 188.1.
  assert.equal(scopes.tenantId, "prism");
  assert.deepEqual(scopes.active, [{ level: "project", resourceId: "projects/bench--00000000" }]);
  assert.equal(report.results.length, 2);
  assert.deepEqual(
    report.results.map((result) => result.id),
    report.selectedQuestionIds.slice(0, 2),
  );
});

test("memory_bench_reports_retrieval_recall_and_tool_calls", async () => {
  const report = await runBench({ offline: true, config: "fabric", maxQuestions: 7 });
  assert.equal(report.results.length, 7);
  assert.equal(typeof report.toolCalls, "number");
  assert.equal(report.toolCallsPerQuestion, report.toolCalls / report.results.length);
  assert.equal(typeof report.recallCalls, "number");
  assert.equal(typeof report.retrievedSnippetTokens, "number");
  assert.ok(report.retrievedSnippetTokens > 0);
  assert.equal(typeof report.retrievalRecallAtK, "number");
  assert.ok(report.retrievalRecallAtK >= 0 && report.retrievalRecallAtK <= 1);
  const abstention = report.results.find((r) => r.ability === "abstention");
  assert.ok(abstention);
  assert.equal(abstention.retrievalRecallAtK, null);
  const ku = report.results.find((r) => r.ability === "knowledge-update");
  assert.ok(ku);
  assert.equal(typeof ku.retrievalRecallAtK, "boolean");
});

test("memory_bench_lifecycle_replay_cli_smoke", async () => {
  const { rm } = await import("node:fs/promises");
  const { synthLedgers } = await import("./lifecycle/synth.mjs");
  const { writeLedger } = await import("./lifecycle/io.mjs");
  const { parseArgs } = await import("./run.mjs");
  const dir = await mkdtemp(join(tmpdir(), "memory-lifecycle-cli-"));
  try {
    const ledgers = join(dir, "ledgers");
    for (const ledger of synthLedgers({ personas: 1, projects: 2, sessions: 2 })) await writeLedger(ledger, ledgers);
    const options = parseArgs([
      "--replay",
      ledgers,
      "--policy",
      "scripts/memory-bench/lifecycle/policies/gated.json",
      "--cache",
      join(dir, "extractor"),
      "--offline",
    ]);
    const report = await runBench(options);
    assert.equal(report.suite, "lifecycle-replay");
    assert.equal(report.counts.sessions, 4);
    const process = Bun.spawn(
      [
        "timeout",
        "30s",
        "bun",
        "scripts/memory-bench/run.mjs",
        "--replay",
        ledgers,
        "--policy",
        options.policy,
        "--cache",
        options.cache,
        "--offline",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(process.stdout).text();
    assert.equal(await process.exited, 0);
    assert.equal(JSON.parse(output).calls.extractor, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("memory_bench_offline_label_cli_smoke", async () => {
  const { rm, readFile } = await import("node:fs/promises");
  const { writeLedger } = await import("./lifecycle/io.mjs");
  const { synthLedgers } = await import("./lifecycle/synth.mjs");
  const dir = await mkdtemp(join(tmpdir(), "memory-bench-label-"));
  try {
    const ledgers = join(dir, "ledgers"),
      out = join(dir, "labels"),
      evidence = join(dir, "evidence.md");
    for (const ledger of synthLedgers({ personas: 1, projects: 1, sessions: 2 })) await writeLedger(ledger, ledgers);
    const child = Bun.spawn(
      [
        "bun",
        "scripts/memory-bench/lifecycle/label.mjs",
        "--ledgers",
        ledgers,
        "--out",
        out,
        "--offline",
        "--pairs",
        "10",
        "--evidence",
        evidence,
      ],
      { stdout: "pipe", stderr: "pipe", timeout: 30000 },
    );
    const text = await new Response(child.stdout).text();
    assert.equal(await child.exited, 0, await new Response(child.stderr).text());
    const report = JSON.parse(text);
    assert.equal(report.pairs, 10);
    assert.equal(report.provenance, "synthetic-construction");
    assert.equal(report.audited, 0);
    assert.match(await readFile(evidence, "utf8"), /Cohen's κ/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resume_reuses_scored_ids_only_for_identical_protocol", async () => {
  const first = await runBench({ offline: true, config: "fabric" });
  assert.ok(first.results.length > 0);
  assert.ok(first.protocolHash);
  const second = await runBench({ offline: true, config: "fabric", resume: first });
  assert.equal(second.resumedResults, first.results.length, "every validated score is reused");
  assert.equal(second.results.length, first.results.length);
  assert.equal(second.turns, 0, "reused questions make no provider calls");
  assert.equal(second.status, "completed");
  await assert.rejects(() => runBench({ offline: true, config: "om", resume: first }), /MemoryBenchResumeMismatch/);
  await assert.rejects(
    () => runBench({ offline: true, config: "fabric", resume: { ...first, protocolHash: "0".repeat(64) } }),
    /MemoryBenchResumeMismatch/,
  );
});

test("irrelevant_round_in_answer_session_is_not_fine_evidence_hit", () => {
  const question = { answerSessionIds: ["s1"], evidence: ["d2"], answers: ["gold"] };
  const rounds = [
    { id: "s1-r0", sessionId: "s1", text: "irrelevant chatter", messages: [{ id: "d1", role: "user", text: "irrelevant chatter" }] },
    { id: "s2-r0", sessionId: "s2", text: "the gold appears", messages: [{ id: "d2", role: "user", text: "the gold appears" }] },
  ];
  const grade = gradeEvidence({ evidence: extractEvidence(question, rounds), recalledIds: ["s1-r0"] });
  assert.equal(grade.answerSessionHitAtK, true, "coarse session hit");
  assert.equal(grade.evidenceRoundCoverage, 0);
  assert.equal(grade.evidenceAllRequired, false);
  assert.equal(grade.fineEvidenceRecall, 0, "the coarse round hit is not gold dia id d2");
});

test("multihop_coverage_requires_all_labelled_facts", () => {
  const question = { evidence: ["d1", "d2"], answers: ["answer"] };
  const rounds = [
    { id: "s1-r0", sessionId: "s1", text: "fact one", messages: [{ id: "d1", role: "user", text: "fact one" }] },
    { id: "s2-r0", sessionId: "s2", text: "fact two", messages: [{ id: "d2", role: "user", text: "fact two" }] },
  ];
  const evidence = extractEvidence(question, rounds);
  const partial = gradeEvidence({ evidence, recalledIds: ["s1-r0"] });
  assert.equal(partial.evidenceRoundCoverage, 0.5);
  assert.equal(partial.evidenceAllRequired, false);
  const complete = gradeEvidence({ evidence, recalledIds: ["s1-r0", "s2-r0"] });
  assert.equal(complete.evidenceRoundCoverage, 1);
  assert.equal(complete.evidenceAllRequired, true);
});

test("answer_session_message_evidence_is_fine_evidence", () => {
  const question = { answerSessionIds: ["s1"], answers: ["gold"] };
  const rounds = [
    { id: "s1-r0", sessionId: "s1", text: "labelled fact", messages: [{ id: "d1", role: "user", text: "labelled fact", hasAnswer: true }] },
    { id: "s1-r1", sessionId: "s1", text: "more of the session", messages: [{ id: "d2", role: "assistant", text: "more" }] },
  ];
  const evidence = extractEvidence(question, rounds);
  assert.deepEqual([...evidence.messageEvidenceRounds], ["s1-r0"], "message gold is not lost inside an answer session");
  assert.equal(gradeEvidence({ evidence, recalledIds: ["s1-r0"] }).evidenceRoundCoverage, 1);
});

test("retrieval_failure_stage_is_attributable_without_source_text", () => {
  assert.equal(retrievalStage({ goldRounds: ["g"], candidateRounds: [], selectedRounds: [], correct: false }), "candidate_gap");
  assert.equal(retrievalStage({ goldRounds: ["g"], candidateRounds: ["g"], selectedRounds: [], correct: false }), "selection_gap");
  assert.equal(retrievalStage({ goldRounds: ["g"], candidateRounds: ["g"], selectedRounds: ["g"], correct: false }), "answer_gap");
  assert.equal(
    retrievalStage({
      goldRounds: ["session"],
      candidateRounds: ["session"],
      selectedRounds: ["session"],
      fineGoldRounds: ["round"],
      fineSelectedRounds: [],
      correct: false,
    }),
    "fine_selection_gap",
  );
  assert.equal(retrievalStage({ goldRounds: [], candidateRounds: [], selectedRounds: [], correct: false }), "gold_unknown");
  assert.equal(retrievalStage({ goldRounds: [], candidateRounds: [], selectedRounds: [], correct: true }), "correct");
});

test("partial_evidence_is_not_answer_gap", () => {
  // Three fine rounds, one visible, wrong answer: partial evidence, not a synthesis gap.
  assert.equal(
    retrievalStage({
      goldRounds: ["session"],
      candidateRounds: ["session"],
      selectedRounds: ["session", "fine-a"],
      fineGoldRounds: ["fine-a", "fine-b", "fine-c"],
      fineSelectedRounds: ["fine-a"],
      correct: false,
    }),
    "partial_evidence",
  );
  assert.equal(
    retrievalStage({
      goldRounds: ["session"],
      candidateRounds: ["session"],
      selectedRounds: ["session", "fine-a", "fine-b"],
      fineGoldRounds: ["fine-a", "fine-b", "fine-c"],
      fineSelectedRounds: ["fine-a", "fine-b"],
      correct: false,
    }),
    "partial_evidence",
  );
});

test("answer_gap_requires_every_fine_round", () => {
  assert.equal(
    retrievalStage({
      goldRounds: ["session"],
      candidateRounds: ["session"],
      selectedRounds: ["session", "fine-a", "fine-b", "fine-c"],
      fineGoldRounds: ["fine-a", "fine-b", "fine-c"],
      fineSelectedRounds: ["fine-a", "fine-b", "fine-c"],
      correct: false,
    }),
    "answer_gap",
  );
  // One fine round is answer_gap once it is visible: the old classifier's meaning is preserved.
  assert.equal(
    retrievalStage({
      goldRounds: ["session"],
      candidateRounds: ["session"],
      selectedRounds: ["session", "fine-a"],
      fineGoldRounds: ["fine-a"],
      fineSelectedRounds: ["fine-a"],
      correct: false,
    }),
    "answer_gap",
  );
  assert.equal(retrievalStage({ goldRounds: ["g"], candidateRounds: ["g"], selectedRounds: ["g"], correct: true }), "correct");
});

test("ceiling_refuses_heldout", async () => {
  // Refusal happens before any dataset read or ingestion.
  await assert.rejects(ceilingScan({ suite: "longmemeval-s", subset: "heldout-v2" }), MemoryBenchDatasetError);
  await assert.rejects(ceilingScan({ suite: "longmemeval-s", subset: "base" }), MemoryBenchDatasetError);
  assert.equal(CEILING_GRID.budgetTokens.includes(2000), true);
  assert.equal(ceilingCells().length, 6 * 5 * 3 * 2);
  assert.equal(new Set(ceilingCells().map((cell) => JSON.stringify(cell))).size, ceilingCells().length);
});

test("ceiling_reproduces_investigation_cells", () => {
  const hit = (id, chars) => ({
    id,
    kind: "episode",
    level: "project",
    ingestedAt: "2025-01-01T00:00:00.000Z",
    content: "x".repeat(chars),
  });
  const hits = [hit("fine-a", 1000), hit("fine-b", 900), hit("other", 400)];
  const question = { question: "where is the key", ability: "single-session-user" };
  const rounds = [];
  const fine = new Set(["fine-a", "fine-b"]);
  const at = (budgetTokens, topK, renderer) =>
    deliveryMetrics({ question, query: question.question, hits, rounds, fine, renderer, budgetTokens, topK });
  // A budget smaller than the second round leaves partial evidence; the whole budget shows both.
  assert.equal(at(100, 16, "whole").allNeededVisible, false);
  assert.equal(at(600, 16, "whole").allNeededVisible, true);
  assert.equal(at(600, 1, "excerpt").allNeededVisible, false);
  assert.equal(at(600, 6, "excerpt").allNeededVisible, true);
});

test("stage_correction_contains_no_text", () => {
  const source = {
    protocol: "delivery-stage-v2",
    suite: "longmemeval-s",
    subset: "development",
    injectionRenderer: "excerpt",
    rows: [
      {
        id: "q1",
        ability: "multi-session",
        answerCorrect: false,
        allNeededVisible: false,
        answerMessageVisible: false,
        goldRounds: 1,
        candidateGold: 1,
        selectedGold: 1,
        fineRounds: 3,
        selectedFine: 1,
        selectedRounds: 3,
        stage: "answer_gap",
        question: "SECRET QUESTION TEXT",
        content: "SECRET NOTE TEXT",
      },
    ],
  };
  const correction = restageReport(source);
  assert.equal(correction.rows[0].stage, "partial_evidence");
  assert.equal(correction.stagesBefore.answer_gap, 1);
  assert.equal(correction.stagesAfter.partial_evidence, 1);
  const text = JSON.stringify(correction);
  assert.equal(text.includes("SECRET"), false);
});

test("missing_gold_stays_unknown", () => {
  const question = { answers: ["answer"] };
  const grade = gradeEvidence({
    evidence: extractEvidence(question, [{ id: "s1-r0", sessionId: "s1", text: "answer", messages: [] }]),
    recalledIds: [],
  });
  assert.equal(grade.fineEvidenceRecall, null);
  assert.equal(grade.fineEvidencePrecision, null);
  assert.equal(grade.answerSessionHitAtK, null);
  assert.equal(grade.evidenceRoundCoverage, null);
});

// Plan 188.8: keep these in the existing root gate's explicit test file.
test("heldout_v2_is_disjoint_from_base_confirmatory_and_targeted", async () => {
  const { default: heldout } = await import("./heldout-v2.json", { with: { type: "json" } });
  const { default: confirmatory } = await import("./confirmatory.json", { with: { type: "json" } });
  const excluded = new Set([
    ...Object.values(subsets.longmemeval.base).flat(),
    ...Object.values(subsets.longmemeval.targeted).flat(),
    ...Object.values(confirmatory.abilities).flat(),
  ]);
  const ids = Object.values(heldout.abilities).flat();
  assert.equal(ids.length, 100);
  assert.ok(Object.values(heldout.abilities).every((ids) => ids.length === 20));
  assert.equal(heldout.seed, "prism-188.8-memory-bench-v2");
  assert.equal(new Set(ids).size, 100);
  assert.ok(ids.every((id) => !excluded.has(id)));
  assert.deepEqual(heldout.developmentOnly, ["single-session-preference", "abstention"]);
  const rows = ids.map((id) => ({ id }));
  assert.equal(selectQuestions(rows, "longmemeval-s", { subset: "heldout-v2" }).length, 100);
  assert.throws(() => selectQuestions(rows.slice(1), "longmemeval-s", { subset: "heldout-v2" }), /Pinned subset/);
});

test("heldout_v2_draw_is_deterministic_and_fails_closed_when_a_stratum_is_short", async () => {
  const { drawHeldoutV2 } = await import("./datasets.mjs");
  const { createHash } = await import("node:crypto");
  const { default: heldout } = await import("./heldout-v2.json", { with: { type: "json" } });
  const rows = Object.keys(heldout.abilities).flatMap((ability) =>
    Array.from({ length: 25 }, (_, i) => ({ id: `${ability}-${i}`, ability })),
  );
  const expected = Object.fromEntries(
    Object.keys(heldout.abilities).map((ability) => [
      ability,
      rows
        .filter((row) => row.ability === ability)
        .sort((a, b) =>
          createHash("sha256")
            .update(`prism-188.8-memory-bench-v2:${a.id}`)
            .digest("hex")
            .localeCompare(createHash("sha256").update(`prism-188.8-memory-bench-v2:${b.id}`).digest("hex")),
        )
        .slice(0, 20)
        .map((row) => row.id),
    ]),
  );
  assert.deepEqual(drawHeldoutV2(rows), expected);
  assert.deepEqual(drawHeldoutV2([...rows].reverse()), expected);
  assert.throws(() => drawHeldoutV2(rows.slice(10)), { name: "MemoryBenchDatasetError" });
});

test("delivery_diagnostic_reports_all_needed_visible_without_text", async () => {
  const { deliveryMetrics } = await import("./retrieval-diagnostics.mjs");
  // "a" fits whole; "b" is larger than what remains, so it is skipped rather than truncated.
  const hits = ["a", "b"].map((id) => ({
    id,
    kind: "episode",
    ingestedAt: "2023-01-01",
    content: `${id} PRIVATE_FIXTURE `.repeat(id === "a" ? 50 : 150),
  }));
  const rounds = hits.map((hit) => ({ id: hit.id, messages: [{ hasAnswer: true, text: hit.content }] }));
  const metrics = deliveryMetrics({
    question: { question: "fixture query" },
    query: "Question date: 2023-05-30T23:40:00Z\nfixture query",
    hits,
    rounds,
    fine: new Set(["a", "b"]),
    // A 600-token budget is smaller than one note: whole-note delivery cannot fit both.
    budgetTokens: 600,
  });
  assert.equal(metrics.allNeededVisible, false);
  assert.equal(metrics.answerMessageVisible, true);
  assert.equal(metrics.allNeededAt[1], false);
  assert.equal(metrics.allNeededAt[3], true);
  assert.deepEqual(metrics.fineEvidenceRanks, [
    { id: "a", rank: 1 },
    { id: "b", rank: 2 },
  ]);
  assert.ok(metrics.nonQuestionTermShare > 0);
  assert.equal(JSON.stringify(metrics).includes("PRIVATE_FIXTURE"), false);
  const hidden = deliveryMetrics({
    question: { question: "q" },
    query: "q",
    hits: [{ ...hits[0], content: "different text" }],
    rounds,
    fine: new Set(["a"]),
  });
  assert.equal(hidden.answerMessageVisible, false, "round selection alone is not message visibility");
});

test("delivery_diagnostic_mirrors_shipped_injection_rule", async () => {
  const { createFabricContext } = await import("../../packages/memory/fabric/src/context.ts");
  const { createMemory, createMemoryFabric } = await import("@arnilo/prism-memory-fabric");
  const { selectInjection } = await import("./retrieval-diagnostics.mjs");
  assert.deepEqual(selectInjection([], "question"), { ids: [], lines: [], tokens: 0 });
  const memory = createMemory({ tenantId: "t", resourceId: "r", threadId: "s" });
  const fabric = createMemoryFabric({ memory, consolidate: false });
  const hits = [];
  for (const content of ["x".repeat(2400), "short", "tiny"]) {
    const note = await fabric.remember({ kind: "fact", content });
    hits.push({ ...note, score: 1 });
  }
  const user = {
    id: "u",
    kind: "message",
    timestamp: "2026-10-22T00:00:00Z",
    message: { role: "user", content: [{ type: "text", text: "question" }] },
  };
  const context = { sessionId: "s", session: { id: "s", entries: async () => [user] } };
  const long = await fabric.remember({ kind: "fact", content: `${"filler ".repeat(300)}question${" tail".repeat(300)}` });
  for (const candidates of [hits, hits.slice(1), [hits[1], { ...long, score: 1 }, hits[2]]]) {
    // Exact boundary: the citation preamble must consume budget too.
    for (const budgetTokens of [1, 300, 600, selectInjection(candidates, "question", 10000).tokens]) {
      const draft = await createFabricContext(memory, async () => ({ hits: candidates, explain: [] }), { budgetTokens, topK: 3 }).build(
        { messages: [user.message] },
        context,
      );
      const rendered = draft.messages[0].content.map((block) => block.text ?? "").join("\n");
      const mirrored = selectInjection(candidates, "question", budgetTokens);
      // Delivery is chronological, so compare the selected set and then that both agree on the order.
      assert.deepEqual(
        candidates
          .filter((hit) => rendered.includes(`[${hit.id}]`))
          .map((hit) => hit.id)
          .sort(),
        [...mirrored.ids].sort(),
      );
      const positions = mirrored.ids.map((id) => rendered.indexOf(`[${id}]`));
      assert.deepEqual(
        positions,
        [...positions].sort((a, b) => a - b),
        "the product delivers in the mirror's order",
      );
      // Same rendered text too, excerpts included, not just the same ids.
      for (const line of mirrored.lines) assert.ok(rendered.includes(line));
    }
  }
});

test("delivery_seams_date_prefix_order_store_timestamp_and_iso_period", async () => {
  const { createMemorySessionStore, definePackage } = await import("@arnilo/prism");
  const { createFabricContext, recallPeriod } = await import("../../packages/memory/fabric/src/context.ts");
  const { createMemory } = await import("@arnilo/prism-memory-fabric");
  const { datedMessages } = await import("./replay.mjs");
  const sourceDate = "2023-05-30T23:40:00.000Z";
  const store = createMemorySessionStore();
  const append = store.append.bind(store);
  let answerPhase = false;
  store.append = (entry, options) => append(answerPhase ? { ...entry, timestamp: sourceDate } : entry, options);
  let observedQuery;
  let observedTimestamp;
  const memory = createMemory({ tenantId: "t", resourceId: "r", threadId: "s" });
  const projection = createFabricContext(
    memory,
    async (query) => {
      observedQuery = query;
      return { hits: [], explain: [] };
    },
    { query: "user" },
  );
  const agent = await createAgent({
    model: "mock/m",
    slots: { store },
    packages: [
      providerPackage("seam-provider", [
        {
          id: "mock",
          async *generate() {
            yield providerDone();
          },
        },
      ]),
      definePackage({
        name: "delivery-seam-probe",
        version: "0.13.0",
        requires: { api: 1 },
        capabilities: ["session-state"],
        setup(prism) {
          prism.hooks.on("context.build", (draft) => ({ ...draft, messages: datedMessages(draft.messages) }), { priority: -1000 });
          prism.hooks.on(
            "context.build",
            async (draft, context) => {
              observedTimestamp = (await context.session.entries()).findLast((entry) => entry.message?.role === "user").timestamp;
              return projection.build(draft, context);
            },
            { priority: -1100 },
          );
        },
      }),
    ],
  });
  try {
    const session = await agent.session();
    answerPhase = true;
    const response = await session.run({ role: "user", content: [{ type: "text", text: "what did I buy" }], metadata: { sourceDate } });
    assert.equal(response.error, undefined);
    assert.equal(observedQuery, `[${sourceDate}] what did I buy`);
    assert.equal(observedTimestamp, sourceDate);
    const prompt = `Question date: ${sourceDate}\nwhat did I buy`;
    assert.equal(recallPeriod(prompt, sourceDate).options.tRef, undefined);
    // Simulate the proposed regex widening: matching the datetime's date part creates a day window.
    const widened = /\b\d{4}-\d{2}-\d{2}(?=T|\b)/.exec(prompt)[0];
    assert.deepEqual(recallPeriod(widened, sourceDate).options.tRef, {
      from: "2023-05-30T00:00:00.000Z",
      to: "2023-05-31T00:00:00.000Z",
    });
  } finally {
    await agent.dispose();
  }
});

test("v2_question_message_carries_date_metadata_not_query_text", async () => {
  const context = await import("../../packages/memory/fabric/src/context.ts");
  const build = context.createFabricContext;
  const queries = [];
  const probe = spyOn(context, "createFabricContext").mockImplementation((memory, recall, ...args) =>
    build(
      memory,
      (query, options) => {
        queries.push(query);
        return recall(query, options);
      },
      ...args,
    ),
  );
  try {
    await replay(
      retryQuestion,
      { config: "fabric", offline: true, modelConfig: { provider: "mock", model: "m" }, inputCap: 128000 },
      [mockProvider(benchState())],
      benchState(),
    );
    assert.deepEqual(queries, [retryQuestion.question]);
  } finally {
    probe.mockRestore();
  }
});

test("v2_answer_entry_timestamp_equals_question_date_including_retry_fork", async () => {
  const sdk = await import("@arnilo/prism");
  const createStore = sdk.createMemorySessionStore;
  const entries = [];
  const probe = spyOn(sdk, "createMemorySessionStore").mockImplementation(() => {
    const store = createStore();
    const append = store.append.bind(store);
    store.append = (entry, options) => {
      entries.push(entry);
      return append(entry, options);
    };
    return store;
  });
  try {
    for (const config of ["full", "fabric"]) {
      const state = benchState();
      const result = await replay(
        retryQuestion,
        { config, offline: true, modelConfig: { provider: "mock", model: "m" }, inputCap: 128000 },
        [truncatingProvider(state)],
        state,
      );
      assert.equal(result.answerRetries, 1);
    }
    const questions = entries.filter((entry) => entry.message?.metadata?.sourceDate === retryQuestion.date);
    assert.equal(questions.length, 4);
    assert.ok(questions.every((entry) => entry.timestamp === retryQuestion.date));
    assert.ok(questions.every((entry) => entry.message.content[0].text === retryQuestion.question));
    const history = entries.filter((entry) => entry.message?.metadata?.sourceId === "m1");
    assert.ok(history.length > 0);
    assert.ok(history.every((entry) => entry.timestamp === retryQuestion.sessions[0].date));
  } finally {
    probe.mockRestore();
  }
});

test("named_month_resolves_against_question_date_in_replay", async () => {
  const context = await import("../../packages/memory/fabric/src/context.ts");
  const build = context.createFabricContext;
  const periods = [];
  const probe = spyOn(context, "createFabricContext").mockImplementation((memory, recall, ...args) =>
    build(
      memory,
      (query, options) => {
        periods.push(options.tRef);
        return recall(query, options);
      },
      ...args,
    ),
  );
  try {
    for (const [phrase, from, to] of [
      ["in March", "2023-03-01T00:00:00.000Z", "2023-04-01T00:00:00.000Z"],
      ["last week", "2023-05-22T00:00:00.000Z", "2023-05-29T00:00:00.000Z"],
    ]) {
      const state = benchState();
      await replay(
        { ...retryQuestion, date: "2023-05-30T23:40:00.000Z", question: `What did I buy ${phrase}?` },
        { config: "fabric", offline: true, modelConfig: { provider: "mock", model: "m" }, inputCap: 128000 },
        [mockProvider(state)],
        state,
      );
      assert.deepEqual(periods.at(-1), { from, to });
    }
  } finally {
    probe.mockRestore();
  }
});

test("full_and_memory_arms_render_the_same_dated_question", async () => {
  const questions = [];
  for (const config of ["full", "om", "fabric", "fabric-hybrid", "fabric-agentic", "om+fabric"]) {
    const state = benchState();
    const base = mockProvider(state);
    const provider = {
      id: "mock",
      async *generate(request) {
        if (state.phase === "answer") {
          const message = request.messages.findLast((message) => message.role === "user");
          if (message?.metadata?.sourceDate === retryQuestion.date) questions.push(message);
        }
        yield* base.generate(request);
      },
    };
    await replay(
      retryQuestion,
      { config, offline: true, embeddings: "mock/embeddings", modelConfig: { provider: "mock", model: "m" }, inputCap: 128000 },
      [provider],
      state,
    );
  }
  assert.ok(questions.length >= 6);
  for (const message of questions) {
    assert.deepEqual(message.content, [{ type: "text", text: `[${retryQuestion.date}] ${retryQuestion.question}` }]);
  }
});

test("v1_checkpoint_is_not_resumed_into_v2", async () => {
  const { protocolFingerprint } = await import("./run.mjs");
  const report = await runBench({ offline: true, config: "fabric" });
  assert.equal(report.protocolVersion, 2);
  const prior = { ...report, protocolVersion: 1 };
  prior.protocolHash = protocolFingerprint(prior);
  assert.notEqual(prior.protocolHash, report.protocolHash);
  await assert.rejects(() => runBench({ offline: true, config: "fabric", resume: prior }), /MemoryBenchResumeMismatch/);
  delete prior.protocolVersion;
  prior.protocolHash = protocolFingerprint(prior);
  await assert.rejects(() => runBench({ offline: true, config: "fabric", resume: prior }), /MemoryBenchResumeMismatch/);
});

// Plan 188.8 Task 5: one held-out question trips the core 64,384-character entry limit.
test("one_question_product_error_is_scored_wrong_and_the_arm_continues", () => {
  const productError = new Error("vector text exceeds 64384 characters");
  productError.name = "MemoryLimitError";
  assert.equal(questionFailureDisposition({ error: productError, errored: 0, total: 100 }), "scored");
  assert.equal(questionFailureDisposition({ error: productError, errored: 2, total: 100 }), "scored");
  // A provider or transport failure carries a cause and still ends the arm.
  const providerFailure = Object.assign(new Error("MemoryBenchReplayError"), { cause: { failureClass: "auth", code: "E401" } });
  assert.equal(questionFailureDisposition({ error: providerFailure, errored: 0, total: 100 }), "failed");
  assert.equal(questionFailureDisposition({ error: productError, budget: true }), "token-ceiling");
  // A systematic product break cannot pass as a score.
  assert.equal(questionFailureDisposition({ error: productError, errored: 5, total: 100 }), "failed");
  const report = summarize({
    schemaVersion: 1,
    suite: "longmemeval-s",
    inputTokens: 10,
    cacheReadTokens: 0,
    results: [
      { id: "a", ability: "knowledge-update", correct: false, outcome: "error", errorCode: "MemoryLimitError" },
      { id: "b", ability: "knowledge-update", correct: true },
    ],
  });
  assert.equal(report.errorRate, 0.5);
  assert.equal(report.abilities["knowledge-update"].errorRate, 0.5);
  assert.equal(report.abilities["knowledge-update"].accuracy, 0.5);
});

// Plan 188.8 Task 5: the before arm is diagnosed with the renderer it shipped.
test("whole_note_injection_mirrors_the_prefix_delivery_rule", async () => {
  const { wholeNoteInjection } = await import("./retrieval-diagnostics.mjs");
  const hit = (id, chars) => ({ id, level: "user", kind: "episode", ingestedAt: "2023-05-30T00:00:00.000Z", content: "x".repeat(chars) });
  // The best hit is always shown, even alone past the 600-token budget.
  const best = wholeNoteInjection([hit("best", 3000)], 600, 3);
  assert.deepEqual(best.ids, ["best"]);
  // A later note that does not fit is dropped; a short one fits.
  assert.deepEqual(wholeNoteInjection([hit("a", 3000), hit("b", 2400)], 600, 3).ids, ["a"]);
  assert.deepEqual(wholeNoteInjection([hit("a", 100), hit("b", 100)], 600, 3).ids, ["a", "b"]);
  assert.ok(wholeNoteInjection([hit("a", 100), hit("b", 400)], 600, 3).tokens <= 600);
});

// --- Plan 188.9 Task 3: fast run path -------------------------------------------------------

const benchDirs = async (name) => {
  const root = await mkdtemp(join(tmpdir(), `memory-bench-${name}-`));
  return { answersDir: join(root, "answers"), judgeCacheDir: join(root, "judge"), root };
};

test("report_records_per_call_latency_by_role", async () => {
  const dirs = await benchDirs("timing");
  const report = await runBench({
    offline: true,
    maxQuestions: 1,
    answersDir: dirs.answersDir,
    judgeCacheDir: dirs.judgeCacheDir,
  });
  const { timing } = report;
  assert.ok(timing.wallMs > 0);
  assert.equal(timing.concurrency.initial, 1);
  assert.equal(timing.questions.n, 1);
  assert.ok(timing.questions.wallMs.p50 >= 0);
  assert.ok(timing.roles.solver.calls >= 1);
  assert.ok(timing.roles.judge.calls >= 1);
  for (const role of Object.values(timing.roles)) {
    assert.ok(role.totalMs.p50 <= role.totalMs.p95);
    assert.ok(role.firstByteMs.p50 <= role.totalMs.p95);
  }
  // No prompt, question or answer text rides along with the timings.
  const text = JSON.stringify(timing);
  assert.ok(!/cobalt|synthetic:knowledge-update/.test(text));
});

test("concurrency_bounds_in_flight_calls_and_halves_on_429", async () => {
  const { createGate } = await import("./timing.mjs");
  const gate = createGate(8);
  assert.equal(gate.limit, 8);
  for (let i = 0; i < 8; i++) await gate.acquire();
  assert.equal(gate.active, 8);
  // Overload shrinks the ceiling without dropping an in-flight permit, and never below one.
  assert.equal(gate.halve(), true);
  assert.equal(gate.limit, 4);
  assert.equal(gate.active, 8);
  gate.release();
  assert.equal(gate.active, 7);
  for (let i = 0; i < 3; i++) gate.release();
  assert.equal(gate.active, 4);
  gate.halve();
  gate.halve();
  gate.halve();
  assert.equal(gate.limit, 1);
  assert.equal(gate.halve(), false);

  // The fetch wrapper reports an overload status to the arm so it can halve.
  const { benchmarkFetch } = await import("./run.mjs");
  let overloads = 0;
  const responses = [new Response("busy", { status: 429 }), new Response("ok", { status: 200 })];
  const wrapped = benchmarkFetch({ onOverload: () => overloads++, fetch: async () => responses.shift() });
  const response = await wrapped("http://bench.invalid/v1/chat/completions", {});
  assert.equal(response.status, 200);
  assert.equal(overloads, 1);
});

test("answer_phase_makes_no_judge_call_and_judge_phase_resumes_it", async () => {
  const dirs = await benchDirs("phases");
  const base = { offline: true, answersDir: dirs.answersDir, judgeCacheDir: dirs.judgeCacheDir };
  const answers = await runBench({ ...base, phase: "answer", output: join(dirs.root, "answers.json") });
  assert.equal(answers.status, "answers");
  assert.equal(answers.calls.judge, 0, "the answer phase must not pay for a judge");
  assert.equal(answers.results.length, 14, "the synthetic fixture has 14 questions");
  assert.ok(answers.results.every((row) => row.outcome === "answered" && row.correct === undefined && row.answerKey));
  assert.ok(answers.timing.roles.judge === undefined);
  assert.equal(answers.abilities[answers.results[0].ability].accuracy, null);

  const judged = await runBench({
    ...base,
    phase: "judge",
    resume: join(dirs.root, "answers.json"),
    output: join(dirs.root, "judged.json"),
    concurrency: 3,
  });
  assert.equal(judged.status, "completed");
  assert.ok(judged.calls.judge > 0);
  assert.equal(judged.turns, 0, "the judge phase must not replay a question");
  assert.equal(judged.timing.roles.solver, undefined);
  assert.ok(judged.results.every((row) => typeof row.correct === "boolean"));
});

test("judge_cache_hit_spends_nothing_and_misses_on_template_change", async () => {
  const { createJudgeCache, JUDGE_TEMPLATE_VERSION } = await import("./judge.mjs");
  const dir = await mkdtemp(join(tmpdir(), "memory-bench-judge-cache-"));
  const generation = { temperature: 0, maxTokens: 4096 };
  const cache = createJudgeCache({ root: dir, judge: "opencode-go/mimo-v2.5", generation });
  const item = { suite: "longmemeval-s", ability: "multi-session", id: "q1", answer: "cobalt" };
  const key = cache.key(item);
  await cache.write(key, { correct: true });
  assert.deepEqual(await cache.read(key), { correct: true });
  assert.notEqual(cache.key({ ...item, id: "q2" }), key, "a different question id is a miss");
  assert.notEqual(cache.key({ ...item, answer: "cerulean" }), key, "a different answer is a miss");
  assert.notEqual(createJudgeCache({ root: dir, judge: "other/model", generation }).key(item), key);
  assert.equal(createJudgeCache({ root: dir, judge: "opencode-go/mimo-v2.5", generation }).key(item), key);
  // A prompt-template edit invalidates every cached verdict.
  assert.notEqual(createJudgeCache({ root: dir, judge: "opencode-go/mimo-v2.5", generation, version: "edited" }).key(item), key);
  assert.match(JUDGE_TEMPLATE_VERSION, /^[a-f0-9]{64}$/);

  // End to end: the second judge phase answers from the cache and makes no provider call.
  const dirs = await benchDirs("judge-cache");
  const base = {
    offline: true,
    maxQuestions: 2,
    answersDir: dirs.answersDir,
    judgeCacheDir: dirs.judgeCacheDir,
    labelInjections: "off",
  };
  await runBench({ ...base, phase: "answer", output: join(dirs.root, "answers.json") });
  const first = await runBench({ ...base, phase: "judge", resume: join(dirs.root, "answers.json") });
  assert.ok(first.calls.judge > 0);
  const second = await runBench({ ...base, phase: "judge", resume: join(dirs.root, "answers.json") });
  assert.equal(second.calls.judge, 0, "a cached verdict spends nothing");
  assert.equal(second.calls.judgeCacheHits, first.calls.judge);
  assert.equal(second.calls.judgeCacheMisses, 0);
});

test("label_injections_off_is_refused_in_acceptance_manifest", async () => {
  const { labelInjectionsArg } = await import("./campaign.mjs");
  assert.deepEqual(labelInjectionsArg({ labelInjections: "off" }, { acceptance: false }), ["--label-injections", "off"]);
  assert.deepEqual(labelInjectionsArg({ labelInjections: "on" }, { acceptance: true }), ["--label-injections", "on"]);
  assert.deepEqual(labelInjectionsArg({}, { acceptance: true }), []);
  assert.throws(() => labelInjectionsArg({ labelInjections: "off" }, { acceptance: true }), /refused in an acceptance manifest/);
  assert.throws(() => labelInjectionsArg({ labelInjections: "maybe" }, {}), /must be on or off/);
});

test("label_injections_off_records_not_labelled_instead_of_a_zero_rate", async () => {
  const report = await runBench({ offline: true, maxQuestions: 1, labelInjections: "off" });
  assert.equal(report.labelInjections, "off");
  assert.equal(report.injectionPrecision, null);
  assert.equal(report.injectionPrecisionReason, "not-labelled");
});

test("split_phase_arm_is_faster_than_serial_on_delayed_mock", async () => {
  // 20 questions, one solver call and one judge call each, 100 ms per call. The plan's 2 s
  // latency is scaled down only to keep the suite fast; the ratio it asserts is unchanged.
  const questions = Array.from({ length: 20 }, (_, index) => ({
    id: `timing:${index}`,
    ability: "knowledge-update",
    question: "What is the project color?",
    answers: ["cobalt"],
  }));
  const latency = 100;
  const dirs = await benchDirs("speed");
  const base = { offline: true, questions, mockLatencyMs: latency, answersDir: dirs.answersDir, judgeCacheDir: dirs.judgeCacheDir };
  const startedSerial = performance.now();
  await runBench({ ...base, phase: "all", concurrency: 1, judgeCacheDir: join(dirs.root, "judge-serial") });
  const serial = performance.now() - startedSerial;
  const startedSplit = performance.now();
  await runBench({ ...base, phase: "answer", concurrency: 8, output: join(dirs.root, "answers.json") });
  await runBench({
    ...base,
    phase: "judge",
    concurrency: 8,
    resume: join(dirs.root, "answers.json"),
    judgeCacheDir: join(dirs.root, "judge-split"),
  });
  const split = performance.now() - startedSplit;
  assert.ok(serial > 20 * latency, `serial run too fast to measure: ${serial}ms`);
  assert.ok(split < serial * 0.4, `split phases ${split.toFixed(0)}ms vs serial ${serial.toFixed(0)}ms`);
});

test("caches_never_enter_evidence_and_hold_no_secret", async () => {
  const { readFile, readdir, stat } = await import("node:fs/promises");
  const dirs = await benchDirs("cache-secret");
  const report = await runBench({
    offline: true,
    maxQuestions: 1,
    phase: "answer",
    answersDir: dirs.answersDir,
    judgeCacheDir: dirs.judgeCacheDir,
    output: join(dirs.root, "checkpoint.json"),
  });
  assert.ok(report.results[0].answerKey);
  for (const file of await readdir(dirs.answersDir)) {
    assert.equal((await stat(join(dirs.answersDir, file))).mode & 0o777, 0o600, "answer cache must be private");
  }
  const checkpoint = await readFile(join(dirs.root, "checkpoint.json"), "utf8");
  const rendered = await readFile(join(dirs.root, "checkpoint.md"), "utf8");
  for (const text of [checkpoint, rendered]) {
    assert.ok(!/cobalt/.test(text), "no answer text in a report");
    assert.ok(!/OPENCODE|API_KEY|Bearer/.test(text), "no credential in a report");
  }
  // The caches live under the gitignored `.cache/` tree, never under the evidence directory.
  assert.match(await readFile(new URL("../../.gitignore", import.meta.url), "utf8"), /^\/\.cache\/$/m);
  assert.ok(dirs.answersDir.includes(tmpdir()));
});

// --- Plan 188.9 Task 4: reuse and the write-side cache ---------------------------------------

test("reuse_copies_only_on_matching_fingerprint_and_refuses_otherwise", async () => {
  const { writeReport } = await import("./report.mjs");
  const dir = await mkdtemp(join(tmpdir(), "memory-bench-reuse-"));
  const source = join(dir, "source.json");
  const first = await runBench({ offline: true, output: join(dir, "checkpoint.json") });
  await writeReport(first, source);
  assert.match(first.runPathFingerprint ?? "", /^[a-f0-9]{64}$/);

  const reused = await runBench({ offline: true, reuseFrom: source });
  assert.equal(reused.status, "completed");
  assert.equal(reused.inputTokens, 0, "reuse charges nothing");
  assert.ok(reused.results.every((row) => row.reused === true));
  assert.equal(reused.results.length, first.results.length);
  assert.deepEqual(
    reused.results.map((row) => row.correct),
    first.results.map((row) => row.correct),
  );
  assert.equal(reused.reusedFrom.fingerprint, first.runPathFingerprint);

  await assert.rejects(
    () => runBench({ offline: true, config: "fabric", reuseFrom: source }),
    /MemoryBenchReuseMismatch: run-path fingerprint differs/,
  );
  const fallback = await runBench({ offline: true, config: "fabric", reuseFrom: source, reuseFallback: "run" });
  assert.equal(fallback.status, "completed");
  assert.match(fallback.reuseRefusal ?? "", /MemoryBenchReuseMismatch/);
  assert.ok(fallback.inputTokens > 0, "a refused reuse runs the arm instead of claiming a score");

  // A completed arm is required, and a partial checkpoint is never reused.
  const partial = await runBench({ offline: true, maxQuestions: 3, output: join(dir, "partial.json") });
  await writeReport(partial, join(dir, "partial.json"));
  await assert.rejects(() => runBench({ offline: true, reuseFrom: join(dir, "partial.json") }), /source is partial/);
});

test("missing_write_side_snapshot_fails_closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memory-bench-write-"));
  await assert.rejects(
    () => runBench({ offline: true, config: "fabric", maxQuestions: 1, seedSnapshot: join(dir, "absent") }),
    /MemoryBenchWriteSideMissing/,
  );
  // A snapshot directory that exists but lacks the question still fails, and is never re-ingested.
  await mkdir(join(dir, "empty"), { recursive: true });
  await assert.rejects(
    () => runBench({ offline: true, config: "fabric", maxQuestions: 1, seedSnapshot: join(dir, "empty") }),
    /MemoryBenchWriteSideMissing/,
  );
});

test("write_side_snapshot_round_trips_and_keys_every_input", async () => {
  const { readdir, readFile, stat } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "memory-bench-snapshot-"));
  const produced = await runBench({ offline: true, config: "fabric", maxQuestions: 1, writeSnapshot: dir });
  const entries = await readdir(dir);
  assert.equal(entries.length, 1);
  const snapshot = join(dir, entries[0]);
  assert.ok((await stat(join(snapshot, "notes"))).isDirectory());

  const seeded = await runBench({ offline: true, config: "fabric", maxQuestions: 1, seedSnapshot: dir });
  assert.equal(seeded.status, produced.status);
  assert.equal(seeded.results.length, 1);
  // The read side reads the ingester's store: the same note files are present after seeding.
  const files = (await readdir(join(snapshot, "notes"), { recursive: true })).filter((file) => String(file).endsWith(".md"));
  assert.ok(files.length > 0);
  assert.ok((await readFile(join(snapshot, "notes", String(files[0])), "utf8")).length > 0);

  const { writeSideKey, writeSideCacheDir } = await import("./acceptance.mjs");
  const base = {
    config: "fabric-xc",
    dataset: "longmemeval-s@98d7416c",
    productHash: "a".repeat(64),
    extractorModel: "opencode-go/mimo-v2.5",
    generation: "temperature=0;maxTokens=4096",
    promptTemplateHash: "b".repeat(64),
    ingestHash: "c".repeat(64),
  };
  const key = writeSideKey(base);
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(writeSideKey({ ...base }), key);
  for (const [field, value] of [
    ["config", "fabric-x"],
    ["dataset", "locomo@x"],
    ["productHash", "d".repeat(64)],
    ["extractorModel", "other/model"],
    ["generation", "temperature=1;maxTokens=4096"],
    ["promptTemplateHash", "e".repeat(64)],
    ["ingestHash", "f".repeat(64)],
  ])
    assert.notEqual(writeSideKey({ ...base, [field]: value }), key, `${field} must change the key`);
  assert.throws(() => writeSideKey({ ...base, productHash: "" }), /productHash is required/);
  assert.match(await writeSideCacheDir(), /^[a-f0-9]{64}$/);
  assert.notEqual(await writeSideCacheDir({ config: "fabric-x" }), await writeSideCacheDir({ config: "fabric-xc" }));
});

test("fabric_x_exchanges_match_session_rounds", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const fixture = (await import("./fixtures/synthetic.json", { with: { type: "json" } })).default;
  const dir = await mkdtemp(join(tmpdir(), "memory-bench-x-"));
  const report = await runBench({ offline: true, config: "fabric-x", maxQuestions: 1, phase: "write", writeSnapshot: dir });
  assert.equal(report.ingestion, "product-per-session", "the x arm ingests through the product write path");
  assert.equal(report.results[0].outcome, "ingested");
  const [snapshotId] = await readdir(dir);
  const root = join(dir, snapshotId, "notes");
  const files = (await readdir(root, { recursive: true }))
    .map(String)
    .filter((file) => file.includes("/exchanges/") && file.endsWith(".md"));
  const raw = fixture.questions[0];
  const sessions = causalSessions({
    ...raw,
    sessions: raw.sessions ?? fixture.sessions,
    date: raw.date ?? raw.sessions?.at(-1)?.date ?? fixture.sessions.at(-1).date,
  });
  const rounds = sessions.flatMap((session, index) => sessionRounds(session, index));
  assert.equal(files.length, rounds.length, "one exchange note per haystack round (the fixture has no tool payloads)");
  const matched = new Set();
  for (const file of files) {
    const text = await readFile(join(root, file), "utf8");
    const body = text
      .split(/\n---\n/)
      .at(-1)
      .trim();
    const round = rounds.find((candidate) => {
      const user = candidate.messages.find((message) => message.role === "user");
      const assistant = candidate.messages.find((message) => message.role === "assistant");
      return user !== undefined && assistant !== undefined && body === `user: ${user.text}\n\nassistant: ${assistant.text}`;
    });
    assert.ok(round, `archived exchange text is the round's user and assistant text: ${body.slice(0, 60)}`);
    const sources = JSON.parse(/^sources: (\[.*\])$/m.exec(text)[1]).map((source) => source.id);
    const user = round.messages.find((message) => message.role === "user");
    const assistant = round.messages.find((message) => message.role === "assistant");
    assert.deepEqual(sources, [`source:${user.id}`, `source:${assistant.id}`], "source ids are the session entries of the round");
    matched.add(round.id);
  }
  assert.equal(matched.size, rounds.length);
  // The producer's index is what a read-side arm uses: every archived note maps to its round.
  const index = JSON.parse(await readFile(join(dir, snapshotId, "exchange-rounds.json"), "utf8"));
  assert.deepEqual(new Set(Object.values(index)), new Set(rounds.map((round) => round.id)));
});

test("xc_runs_one_consolidate_per_haystack_session", async () => {
  const state = benchState();
  const calls = [];
  const base = mockProvider(state);
  const provider = {
    id: "mock",
    async *generate(request) {
      const names = request.tools?.map((tool) => tool.name) ?? [];
      if (names.includes("record_notes")) {
        calls.push(request);
        // A valid answer: one call per session, no shape repair.
        yield providerToolCall(toolCallContent("n1", "record_notes", { notes: [] }));
        return;
      }
      yield* base.generate(request);
    },
  };
  const result = await replay(
    {
      ...retryQuestion,
      sessions: [
        {
          id: "s1",
          date: "2024-01-01T00:00:00.000Z",
          messages: [
            { id: "m1", role: "user", text: "The project color is cobalt." },
            { id: "m1a", role: "assistant", text: "Noted." },
          ],
        },
        {
          id: "s2",
          date: "2024-01-02T00:00:00.000Z",
          messages: [
            { id: "m2", role: "user", text: "The project color is cobalt now." },
            { id: "m2a", role: "assistant", text: "Still cobalt." },
          ],
        },
      ],
    },
    { config: "fabric-xc", suite: "longmemeval-s", offline: true, modelConfig: { provider: "mock", model: "m" }, inputCap: 128000 },
    [provider],
    state,
  );
  assert.equal(calls.length, 2, "one extractor call per haystack session, not per turn");
  assert.equal(result.ingest.sessions, 2);
  assert.equal(result.ingest.consolidationFailures, 0);
  assert.equal(result.storage.fabric, "disposable");
});

test("read_side_refuses_without_write_snapshot", async () => {
  const { writeSideUnavailable, orderJobs } = await import("./campaign.mjs");
  const { assertJobDependencies } = await import("./acceptance.mjs");
  const jobs = [
    { id: "read", suite: "longmemeval-s", config: "fabric-xc-agentic", writeSide: "write" },
    { id: "write", suite: "longmemeval-s", config: "fabric-xc" },
  ];
  assert.doesNotThrow(() => assertJobDependencies(jobs));
  assert.deepEqual(
    orderJobs(jobs).map((job) => job.id),
    ["write", "read"],
  );
  const read = jobs[0];
  assert.equal(writeSideUnavailable(read, { producer: { status: "completed" }, snapshotPresent: true }), false);
  assert.equal(writeSideUnavailable(read, { producer: undefined, snapshotPresent: true }), true);
  assert.equal(writeSideUnavailable(read, { producer: { status: "failed" }, snapshotPresent: true }), true);
  assert.equal(writeSideUnavailable(read, { producer: { status: "completed" }, snapshotPresent: false }), true);
  assert.equal(writeSideUnavailable(jobs[1], { producer: undefined, snapshotPresent: false }), false, "a producer has no write side");
  const dir = await mkdtemp(join(tmpdir(), "memory-bench-xc-read-"));
  await assert.rejects(
    () => runBench({ offline: true, config: "fabric-xc-agentic", maxQuestions: 1, seedSnapshot: join(dir, "absent") }),
    /MemoryBenchWriteSideMissing/,
  );
});

test("legacy_direct_ingest_is_labelled_in_report", async () => {
  const legacy = await runBench({ offline: true, config: "fabric", maxQuestions: 1 });
  assert.equal(legacy.ingestion, "legacy-direct-ingest");
  const product = await runBench({ offline: true, config: "fabric-x", maxQuestions: 1 });
  assert.equal(product.ingestion, "product-per-session");
  const plain = await runBench({ offline: true, config: "full", maxQuestions: 1 });
  assert.equal(plain.ingestion, "none");
});

test("ingestion_respects_causal_cutoff", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memory-bench-causal-"));
  const question = {
    id: "causal-cutoff",
    ability: "knowledge-update",
    question: "What color is the project?",
    answers: ["amber"],
    date: "2024-01-02T00:00:00.000Z",
    sessions: [
      {
        id: "s1",
        date: "2024-01-01T00:00:00.000Z",
        messages: [
          { id: "u1", role: "user", text: "The project color is amber." },
          { id: "a1", role: "assistant", text: "Noted." },
        ],
      },
      {
        id: "s2",
        date: "2024-01-03T00:00:00.000Z",
        messages: [
          { id: "u2", role: "user", text: "The project color is now cobalt." },
          { id: "a2", role: "assistant", text: "Updated." },
        ],
      },
    ],
    oracle: { answer: "cobalt", sessions: [] },
    hasAnswer: true,
  };
  const report = await runBench({
    offline: true,
    config: "fabric-x",
    questions: [question],
    maxQuestions: 1,
    phase: "write",
    writeSnapshot: dir,
  });
  assert.equal(report.results[0].ingest.sessions, 1, "only the session dated at or before the question");
  const text = await (await import("node:fs/promises")).readFile(join(dir, "causal-cutoff", "exchange-rounds.json"), "utf8");
  assert.equal(Object.keys(JSON.parse(text)).length, 1);
  const { readdir: listFiles, readFile: readText } = await import("node:fs/promises");
  const notes = join(dir, "causal-cutoff", "notes");
  const files = (await listFiles(notes, { recursive: true })).map(String).filter((file) => file.includes("/exchanges/"));
  const written = await Promise.all(files.map((file) => readText(join(notes, file), "utf8")));
  assert.ok(
    written.every((body) => !body.includes("now cobalt")),
    "a future session never enters the store",
  );
});

test("offline_smoke_covers_new_configs", async () => {
  for (const config of ["fabric-x", "fabric-xc", "fabric-xc-agentic"]) {
    const report = await runBench({ offline: true, config, maxQuestions: 1 });
    assert.equal(report.results.length, 1, config);
    assert.equal(report.ingestion, "product-per-session", config);
    assert.equal(report.memoryConfig.fabric.exchanges.enabled, true, `${config} archives exchanges`);
    assert.equal(report.memoryConfig.fabric.promote.enabled, config !== "fabric-x", `${config} promotion`);
    const inject = report.memoryConfig.fabric.inject;
    assert.deepEqual(
      inject === false ? false : inject.kinds,
      config === "fabric-xc-agentic" ? false : config === "fabric-x" ? ["exchange"] : ["fact", "exchange"],
    );
  }
});

test("fabric_x_delivery_diagnostic_describes_the_product_store", async () => {
  const { readFile } = await import("node:fs/promises");
  const product = JSON.parse(await readFile("docs/_evidence/memory-bench/188.9/delivery-development-fabric-x.json", "utf8"));
  const direct = JSON.parse(await readFile("docs/_evidence/memory-bench/188.9/delivery-development.json", "utf8"));
  assert.equal(product.storeSource, "product-snapshot");
  assert.equal(product.injectionRenderer, "excerpt");
  assert.equal(product.questions, 140);
  assert.equal(direct.questions, 140);
  // The exchange store carries the assistant reply (and no date prefix) instead of an episode
  // round, so stages move by a few questions; a large drift means the product write path changed.
  const before = direct.summary.byStage;
  const after = product.summary.byStage;
  const stages = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const stage of stages) assert.ok(Math.abs((before[stage] ?? 0) - (after[stage] ?? 0)) <= 4, `${stage} drifted`);
  const directReached = direct.rows.filter((row) => row.candidateGold > 0).length;
  const productReached = product.rows.filter((row) => row.candidateGold > 0).length;
  assert.ok(Math.abs(directReached - productReached) <= 6, "the product store recalls the labelled evidence about as often");
});

test("screen_v1_draw_is_deterministic_and_stratified", async () => {
  const { drawScreenV1 } = await import("./datasets.mjs");
  const screen = (await import("./screen-v1.json", { with: { type: "json" } })).default;
  const drawn = drawScreenV1();
  assert.deepEqual(drawn, screen.abilities, "the committed draw matches the frozen salt");
  assert.deepEqual(drawScreenV1(), drawn);
  const confirmatory = (await import("./confirmatory.json", { with: { type: "json" } })).default;
  const heldout = (await import("./heldout-v2.json", { with: { type: "json" } })).default;
  const devIds = new Set(Object.values(confirmatory.abilities).flat());
  const heldIds = new Set(Object.values(heldout.abilities).flat());
  assert.equal(Object.keys(drawn).length, 7);
  for (const [ability, ids] of Object.entries(drawn)) {
    assert.equal(ids.length, 5, `${ability} needs five ids`);
    assert.equal(new Set(ids).size, 5);
    for (const id of ids) {
      assert.ok(devIds.has(id), `${id} is a development id`);
      assert.ok(!heldIds.has(id), `${id} must not be held out`);
    }
  }
  assert.equal(new Set(Object.values(drawn).flat()).size, 35);
});

// --- Plan 188.10 Task 2: held-out v3 and the multi-session development screen -----------------

test("heldout_v3_draw_is_label_blind_and_frozen", async () => {
  const { createHash } = await import("node:crypto");
  const { drawHeldoutV3, HELDOUT_V3_SALT, HELDOUT_V3_STRATA } = await import("./datasets.mjs");
  const heldout = (await import("./heldout-v3.json", { with: { type: "json" } })).default;
  const rows = Object.keys(HELDOUT_V3_STRATA).flatMap((ability) =>
    Array.from({ length: 50 }, (_, i) => ({
      id: `${ability}-${i}`,
      ability,
      question: `question ${i}`,
      answers: [`answer ${i}`],
      sessions: [{ messages: [{ text: `PRIVATE_${i}` }] }],
    })),
  );
  const drawn = drawHeldoutV3(rows);
  const hash = (id) => createHash("sha256").update(`${HELDOUT_V3_SALT}:${id}`).digest("hex");
  assert.deepEqual(Object.keys(drawn), Object.keys(HELDOUT_V3_STRATA));
  for (const [ability, size] of Object.entries(HELDOUT_V3_STRATA)) {
    const expected = rows
      .filter((row) => row.ability === ability)
      .map((row) => row.id)
      .sort((a, b) => hash(a).localeCompare(hash(b)))
      .slice(0, size);
    assert.deepEqual(drawn[ability], expected, `${ability} is salted and ascending`);
  }
  // Label-blind: answers, questions and haystacks never reach the draw.
  const mutated = rows.map((row) => ({ ...row, question: "mutated", answers: ["mutated"], sessions: [], answerSessionIds: ["x"] }));
  assert.deepEqual(drawHeldoutV3(mutated), drawn);
  assert.deepEqual(drawHeldoutV3([...rows].reverse()), drawn);
  // Short stratum: 39 multi-session candidates cannot fill 40.
  assert.throws(() => drawHeldoutV3(rows.filter((row) => row.ability !== "multi-session" || Number(row.id.split("-").at(-1)) > 10)), {
    name: "MemoryBenchDatasetError",
  });
  // The frozen file is a hash chain over the same facts, with the residual pool that bounds it.
  assert.equal(heldout.seed, HELDOUT_V3_SALT);
  assert.equal(heldout.datasetSha256.length, 64);
  assert.deepEqual(heldout.exclusions, ["base", "targeted", "confirmatory", "heldout-v2"]);
  assert.deepEqual(heldout.residualPool, {
    "multi-session": 71,
    "knowledge-update": 22,
    "temporal-reasoning": 77,
    "single-session-user": 14,
    "single-session-assistant": 6,
  });
  const ids = Object.values(heldout.abilities).flat().sort();
  assert.equal(ids.length, 100);
  assert.equal(heldout.idsHash, createHash("sha256").update(JSON.stringify(ids)).digest("hex"));
  const { fileHash, ...rest } = heldout;
  assert.equal(fileHash, createHash("sha256").update(JSON.stringify(rest)).digest("hex"));
  // A different salt draws different ids, so the frozen file hash no longer describes the draw.
  assert.notEqual(
    createHash("sha256")
      .update(JSON.stringify({ ...rest, seed: "prism-188.10-memory-bench-v4" }))
      .digest("hex"),
    fileHash,
  );
});

test("heldout_v3_excludes_every_prior_partition", async () => {
  const { selectQuestions } = await import("./datasets.mjs");
  const heldout = (await import("./heldout-v3.json", { with: { type: "json" } })).default;
  const confirmatory = (await import("./confirmatory.json", { with: { type: "json" } })).default;
  const prior = (await import("./heldout-v2.json", { with: { type: "json" } })).default;
  const ids = Object.values(heldout.abilities).flat();
  const development = new Set(Object.values(confirmatory.abilities).flat());
  const v2 = new Set(Object.values(prior.abilities).flat());
  const excluded = new Set([
    ...Object.values(subsets.longmemeval.base).flat(),
    ...Object.values(subsets.longmemeval.targeted).flat(),
    ...development,
  ]);
  assert.equal(ids.length, 100);
  assert.equal(new Set(ids).size, 100);
  assert.ok(
    ids.every((id) => !excluded.has(id)),
    "no base, targeted or development id",
  );
  // The v3 manifest refuses a development or prior held-out id.
  assert.ok(ids.every((id) => !development.has(id) && !v2.has(id)));
  const rows = ids.map((id) => ({ id }));
  assert.equal(selectQuestions(rows, "longmemeval-s", { subset: "heldout-v3" }).length, 100);
  assert.throws(() => selectQuestions(rows.slice(1), "longmemeval-s", { subset: "heldout-v3" }), /Pinned subset/);
});

test("screen_ms_v1_is_development_only_and_refuses_v3", async () => {
  const { createHash } = await import("node:crypto");
  const { drawScreenMsV1, SCREEN_MS_V1_SALT, SCREEN_MS_V1_DEVELOPMENT_COUNT } = await import("./datasets.mjs");
  const screen = (await import("./screen-ms-v1.json", { with: { type: "json" } })).default;
  const drawn = drawScreenMsV1();
  assert.deepEqual(drawn, screen.abilities, "the committed draw matches the frozen salt");
  assert.deepEqual(drawScreenMsV1(), drawn);
  assert.equal(screen.salt, SCREEN_MS_V1_SALT);
  assert.equal(screen.developmentOnly, true);
  const confirmatory = (await import("./confirmatory.json", { with: { type: "json" } })).default;
  const prior = (await import("./heldout-v2.json", { with: { type: "json" } })).default;
  const heldout = (await import("./heldout-v3.json", { with: { type: "json" } })).default;
  const v1 = (await import("./screen-v1.json", { with: { type: "json" } })).default;
  const development = new Set([
    ...Object.values(confirmatory.abilities).flat(),
    ...Object.values(subsets.longmemeval.targeted).flat(),
    ...Object.values(prior.abilities).flat(),
  ]);
  const live = new Set(Object.values(heldout.abilities).flat());
  const ids = Object.values(drawn).flat();
  assert.equal(ids.length, 60);
  assert.equal(new Set(ids).size, 60);
  assert.ok(
    ids.every((id) => development.has(id)),
    "every screen id is development data",
  );
  assert.ok(
    ids.every((id) => !live.has(id)),
    "the screen never touches the held-out v3 draw",
  );
  // Multi-session: all 20 prior held-out ids, then a fresh 10 from the development pool.
  const multi = drawn["multi-session"];
  assert.equal(multi.length, 30);
  assert.deepEqual(multi.slice(0, 20), prior.abilities["multi-session"]);
  const pool = new Set(subsets.longmemeval.targeted["multi-session"]);
  const fresh = multi.slice(20);
  assert.equal(fresh.length, SCREEN_MS_V1_DEVELOPMENT_COUNT);
  assert.ok(fresh.every((id) => pool.has(id) && !prior.abilities["multi-session"].includes(id)));
  // The other six abilities are screen-v1's 30 non-multi-session ids, five each.
  for (const [ability, list] of Object.entries(v1.abilities)) {
    if (ability === "multi-session") continue;
    assert.deepEqual(drawn[ability], list);
  }
  const sorted = ids.slice().sort();
  assert.equal(screen.idsHash, createHash("sha256").update(JSON.stringify(sorted)).digest("hex"));
  const { fileHash, ...rest } = screen;
  assert.equal(fileHash, createHash("sha256").update(JSON.stringify(rest)).digest("hex"));
  const rows = ids.map((id) => ({ id }));
  assert.equal(selectQuestions(rows, "longmemeval-s", { subset: "screen-ms-v1" }).length, 60);
  assert.throws(() => selectQuestions(rows.slice(1), "longmemeval-s", { subset: "screen-ms-v1" }), /Pinned subset/);
});

/**
 * A two-session fixture whose product store holds one superseded fact and one active fact, so the
 * multi-session diagnostic is exercised end to end against the same code the CLI runs.
 */
async function multiSessionFixture({ instances = false } = {}) {
  const { createMarkdownMemoryStores } = await import("@arnilo/prism-memory-core/fabric");
  const { createMemory, createMemoryFabric, resolveMemoryFabricConfig } = await import("@arnilo/prism-memory-fabric");
  const { BENCH_SCOPE } = await import("./bench-scope.mjs");
  const { EXCHANGE_ROUNDS_FILE } = await import("./replay.mjs");
  const dir = await mkdtemp(join(tmpdir(), "prism-ms-diagnostics-"));
  const question = {
    id: instances ? "q-ms-instances" : "q-ms-1",
    ability: "multi-session",
    question: instances ? "Which doctors has the user seen?" : "Which coffee brand does the user keep buying?",
    date: "2024-03-10",
    evidence: ["m-old", "m-new"],
    answerSessionIds: ["s1", "s2"],
    sessions: [
      {
        id: "s1",
        date: "2024-01-02",
        messages: [
          {
            id: "m-old",
            role: "user",
            text: instances ? "I saw a doctor, Dr. Patel, about a rash." : "I buy Sourceless Roasters coffee every week.",
            hasAnswer: true,
          },
        ],
      },
      {
        id: "s2",
        date: "2024-02-05",
        messages: [
          {
            id: "m-new",
            role: "user",
            text: instances ? "I saw a doctor, Dr. Ruiz, about chest pain." : "I switched to Blackwater Coffee now.",
            hasAnswer: true,
          },
        ],
      },
      {
        id: "s3",
        date: "2024-03-01",
        messages: [
          { id: "m-weather", role: "user", text: "The weather is grey today." },
          { id: "m-reply", role: "assistant", text: "Grey indeed." },
        ],
      },
    ],
  };
  const rounds = question.sessions.flatMap((session, index) => sessionRounds(session, index));
  const questionRoot = join(dir, encodeURIComponent(question.id));
  const stores = await createMarkdownMemoryStores({ root: join(questionRoot, "notes") });
  const memory = createMemory({ ...BENCH_SCOPE, vectorStore: stores.vectorStore, workingStore: stores.workingStore });
  const config = resolveMemoryFabricConfig({ retrieval: "lexical", inject: { query: "task", kinds: ["fact", "exchange"] } });
  const { scopes: _scopes, tools: _tools, store: _store, ...fabricOptions } = config;
  const fabric = createMemoryFabric({ memory, vectorStore: stores.vectorStore, ...fabricOptions });
  const exchangeRounds = {};
  const exchangeIdByRound = {};
  for (const round of rounds) {
    const note = await fabric.remember({ kind: "exchange", content: round.text, scope: "project" });
    exchangeRounds[note.id] = round.id;
    exchangeIdByRound[round.id] = note.id;
  }
  const link = (roundId) => [{ id: exchangeIdByRound[roundId], relation: "evidence" }];
  const oldFact = await fabric.remember({
    kind: "fact",
    // Plan 188.10 Task 6: the instance variant carries category keywords and no key at all.
    content: instances ? "The user saw a dermatologist, Dr. Patel, about a rash." : "Coffee brand: Sourceless Roasters.",
    scope: "project",
    ...(instances ? { keywords: ["doctor", "health", "appointment"] } : { key: "coffee.brand" }),
    tRef: "2024-01-02T00:00:00.000Z",
    links: link("s1-r0"),
  });
  await fabric.remember({
    kind: "fact",
    content: instances ? "The user saw a cardiologist, Dr. Ruiz, about chest pain." : "Coffee brand: Blackwater.",
    scope: "project",
    ...(instances ? { keywords: ["doctor", "health", "appointment"] } : { key: "coffee.brand", supersedes: oldFact.id }),
    tRef: "2024-02-05T00:00:00.000Z",
    links: link("s2-r0"),
  });
  await stores.close();
  await writeFile(join(questionRoot, EXCHANGE_ROUNDS_FILE), JSON.stringify(exchangeRounds));
  return { dir, question };
}

test("fabric_x_tools_keeps_memory_tools_and_injection", async () => {
  const { isToolsConfig, memoryConfigs } = await import("./ablations.mjs");
  // Plan 188.10 Task 4: the product's shape is passive injection *and* tools; agentic is tools only.
  assert.equal(isToolsConfig("fabric-x-tools"), true);
  assert.equal(isToolsConfig("fabric-xc-tools"), true);
  assert.equal(isToolsConfig("fabric-xc-agentic"), true);
  // `replay.mjs` strips `memory.*` only when this is false.
  for (const config of ["fabric-x", "fabric-xc", "fabric", "fabric-hybrid", "om+fabric"])
    assert.equal(isToolsConfig(config), false, `${config} keeps the shipped no-tools passive shape`);
  const x = memoryConfigs({ config: "fabric-x-tools" });
  assert.deepEqual(x.fabric.inject, { query: "task", kinds: ["exchange"] });
  assert.equal(x.fabric.promote, undefined, "fabric-x-tools is the exchange store's local write side");
  assert.deepEqual(x.fabric.exchanges, {});
  const xc = memoryConfigs({ config: "fabric-xc-tools" });
  assert.deepEqual(xc.fabric.inject, { query: "task", kinds: ["fact", "exchange"] });
  assert.deepEqual(xc.fabric.promote, {}, "the xc write side promotes exchanges into facts");
  // The agentic arm is unchanged: tools only, no passive injection.
  assert.equal(memoryConfigs({ config: "fabric-xc-agentic" }).fabric.inject, false);
  // The solver protocol is unchanged.
  const { BENCH_MAX_TURNS } = await import("./replay.mjs");
  assert.deepEqual(BENCH_MAX_TURNS, { standard: 8, coding: 250 });
});

test("bench_write_generation_does_not_change_answer_generation", async () => {
  const { parseArgs } = await import("./run.mjs");
  const { extractorSettings, memoryConfigs, writeGeneration } = await import("./ablations.mjs");
  // Plan 188.10 Task 5: the extractor's budget is a write-side setting; the answer keeps 4,096.
  const options = parseArgs(["--write-output-tokens", "8192", "--write-thinking", "low"]);
  assert.equal(options.writeOutputTokens, 8192);
  assert.equal(options.writeThinking, "low");
  assert.throws(() => parseArgs(["--write-output-tokens", "128"]), /write-output-tokens/);
  assert.throws(() => parseArgs(["--write-output-tokens", "40000"]), /write-output-tokens/);
  assert.throws(() => parseArgs(["--write-thinking", "very-high"]), /write-thinking/);

  assert.deepEqual(extractorSettings(options), { maxOutputTokens: 8192, thinkingLevel: "low" });
  // Only an arm that promotes takes the budget: `fabric-x` has no extractor to budget.
  assert.equal(memoryConfigs({ config: "fabric-x", ...options }).fabric.promote, undefined);
  assert.deepEqual(memoryConfigs({ config: "fabric-xc", ...options }).fabric.promote, {
    maxOutputTokens: 8192,
    thinkingLevel: "low",
  });
  assert.deepEqual(memoryConfigs({ config: "fabric-xc" }).fabric.promote, {});

  // The manifest records the write generation beside — never inside — the answer generation.
  assert.deepEqual(writeGeneration(options), { temperature: 0, maxTokens: 8192, thinkingLevel: "low" });
  assert.deepEqual(writeGeneration({}), { temperature: 0, maxTokens: 4096 });
  assert.equal(writeGeneration({ offline: true }), null);
  const report = await runBench({ offline: true, config: "fabric-xc", maxQuestions: 1, phase: "write", ...options });
  assert.equal(report.generation, null, "offline runs record no live generation");
  assert.equal(report.writeGeneration, null);
});

test("write_side_key_separates_extractor_budgets", async () => {
  const { writeSideKey, writeSideCacheDir } = await import("./acceptance.mjs");
  const base = {
    config: "fabric-xc",
    dataset: "longmemeval-s@98d7416c",
    productHash: "a".repeat(64),
    extractorModel: "opencode-go/mimo-v2.5",
    generation: "temperature=0;maxTokens=4096",
    promptTemplateHash: "b".repeat(64),
    ingestHash: "c".repeat(64),
  };
  const key = writeSideKey(base);
  assert.equal(writeSideKey({ ...base, writeGeneration: "temperature=0;maxTokens=4096" }), key, "the default is explicit");
  assert.notEqual(writeSideKey({ ...base, writeGeneration: "temperature=0;maxTokens=8192;thinkingLevel=low" }), key);
  assert.throws(() => writeSideKey({ ...base, writeGeneration: "" }), /writeGeneration is required/);
  assert.notEqual(
    await writeSideCacheDir({ writeGeneration: "temperature=0;maxTokens=8192" }),
    await writeSideCacheDir({ writeGeneration: "temperature=0;maxTokens=4096" }),
  );
});

test("multi_session_diagnostic_reports_reachability_without_text", async () => {
  const { multiSessionDiagnostic } = await import("./retrieval-diagnostics.mjs");
  const { rm } = await import("node:fs/promises");
  const { dir, question } = await multiSessionFixture();
  try {
    const report = await multiSessionDiagnostic({ suite: "longmemeval-s", subset: "screen-ms-v1", storeFrom: dir, questions: [question] });
    assert.equal(report.questions, 1);
    assert.equal(report.protocol, "multi-session-recall-v1");
    assert.equal(report.storeSource, "product-snapshot");
    assert.equal(report.summary.neededRounds, 2);
    assert.equal(report.summary.sessionsSpanned, 2);
    // Both needed rounds share "coffee"/"buy" with the question.
    assert.equal(report.summary.reachableRounds, 2);
    assert.equal(report.summary.questionsAllReachable, 1);
    const row = report.rows[0];
    assert.deepEqual(
      row.rounds.map((round) => round.id),
      ["s1-r0", "s2-r0"],
    );
    assert.ok(row.rounds.every((round) => round.reachable && Number.isInteger(round.rank) && round.rank >= 1));
    assert.deepEqual(row.allNeededAt, { 10: true, 20: true, uncapped: true });
    assert.equal(row.allNeededVisible, true);
    assert.equal(report.summary.passiveVisible, 1);
    assert.equal(report.summary.partialEvidence, 0);
    // Text-free: ids, ranks, counts and booleans only.
    const text = JSON.stringify(report);
    for (const secret of ["Sourceless", "Blackwater", "coffee", "weather", "Grey indeed", question.question])
      assert.ok(!text.includes(secret), `no question, note or fact text: ${secret}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("supersession_loss_counts_needed_round_whose_fact_is_superseded", async () => {
  const { multiSessionDiagnostic } = await import("./retrieval-diagnostics.mjs");
  const { rm } = await import("node:fs/promises");
  const { dir, question } = await multiSessionFixture();
  try {
    const report = await multiSessionDiagnostic({ suite: "longmemeval-s", subset: "screen-ms-v1", storeFrom: dir, questions: [question] });
    // Two links, one per needed round; only the newer keyed instance is active.
    assert.equal(report.summary.facts.linkedRounds, 2);
    assert.equal(report.summary.facts.activeRounds, 1);
    assert.equal(report.summary.facts.supersessionLostRounds, 1);
    assert.equal(report.summary.facts.factsPerNeededRound, 1);
    const [older, newer] = report.rows[0].rounds;
    assert.deepEqual([older.activeFacts, older.supersededFacts], [0, 1]);
    assert.deepEqual([newer.activeFacts, newer.supersededFacts], [1, 0]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("instance_facts_leave_no_supersession_loss", async () => {
  const { multiSessionDiagnostic } = await import("./retrieval-diagnostics.mjs");
  const { rm } = await import("node:fs/promises");
  const { dir, question } = await multiSessionFixture({ instances: true });
  try {
    const report = await multiSessionDiagnostic({ suite: "longmemeval-s", subset: "screen-ms-v1", storeFrom: dir, questions: [question] });
    // Plan 188.10 Task 6: two visits, two notes; the instance rule keeps the first one active.
    assert.equal(report.summary.neededRounds, 2);
    assert.equal(report.summary.reachableRounds, 2, "the category word reaches both rounds");
    assert.equal(report.summary.facts.activeRounds, 2, "each instance is its own covering fact");
    assert.equal(report.summary.facts.supersessionLostRounds, 0, "an un-keyed instance supersedes nothing");
    assert.equal(report.summary.facts.factsPerNeededRound, 1);
    assert.deepEqual(
      report.rows[0].rounds.map((round) => [round.activeFacts, round.supersededFacts]),
      [
        [1, 0],
        [1, 0],
      ],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("multi_session_diagnostic_refuses_heldout_v3_and_a_missing_snapshot", async () => {
  const { multiSessionDiagnostic } = await import("./retrieval-diagnostics.mjs");
  await assert.rejects(
    multiSessionDiagnostic({ suite: "longmemeval-s", subset: "heldout-v3", storeFrom: "/nonexistent" }),
    MemoryBenchDatasetError,
  );
  await assert.rejects(
    multiSessionDiagnostic({ suite: "longmemeval-s", subset: "screen-ms-v1", storeFrom: join(tmpdir(), "prism-no-such-snapshot") }),
    /no product store snapshot/,
  );
  await assert.rejects(multiSessionDiagnostic({ suite: "longmemeval-s", subset: "screen-ms-v1" }), /needs --store-from/);
});

test("runner_accepts_the_two_new_longmemeval_subsets", async () => {
  const { spawnSync } = await import("node:child_process");
  for (const subset of ["heldout-v3", "screen-ms-v1"]) {
    const run = spawnSync(process.execPath, ["scripts/memory-bench/run.mjs", "--suite", "longmemeval-s", "--subset", subset], {
      encoding: "utf8",
    });
    assert.notEqual(run.status, 0);
    assert.doesNotMatch(`${run.stdout}${run.stderr}`, /invalid subset/, `${subset} is a known subset`);
    assert.match(`${run.stdout}${run.stderr}`, /provider, model and judge required/, "validation reaches the provider check");
  }
  const bad = spawnSync(process.execPath, ["scripts/memory-bench/run.mjs", "--suite", "longmemeval-s", "--subset", "heldout-v4"], {
    encoding: "utf8",
  });
  assert.match(`${bad.stdout}${bad.stderr}`, /invalid subset/);
});

test("diagnostics_refuse_heldout_v3", async () => {
  const { diagnoseRetrieval } = await import("./retrieval-diagnostics.mjs");
  // Refusal happens before any dataset read.
  await assert.rejects(ceilingScan({ suite: "longmemeval-s", subset: "heldout-v3" }), MemoryBenchDatasetError);
  await assert.rejects(diagnoseRetrieval({ suite: "longmemeval-s", subset: "heldout-v3" }), MemoryBenchDatasetError);
});

// --- Plan 188.9 Task 5: evidence-sized delivery ---------------------------------------------

test("defaults_match_pre_registered_grid_choice", async () => {
  const { readFile } = await import("node:fs/promises");
  const { chooseDeliveryDefaults, INJECT_DEFAULTS } = await import("./retrieval-diagnostics.mjs");
  const { memoryFabricConfigSchema } = await import("../../packages/memory/fabric/src/config.ts");
  const report = JSON.parse(await readFile("docs/_evidence/memory-bench/188.9/ceiling-development.json", "utf8"));
  const chosen = chooseDeliveryDefaults(report);
  assert.deepEqual(chosen, INJECT_DEFAULTS);
  assert.deepEqual(chosen, { budgetTokens: 4000, topK: 12, minSimilarity: 0.2 });
  // The schema's declared defaults are the same cell, so a caller reading the schema sees the truth.
  const inject = memoryFabricConfigSchema.properties.inject.anyOf[1].properties;
  assert.deepEqual(
    {
      budgetTokens: inject.budgetTokens.default,
      topK: inject.topK.default,
      minSimilarity: inject.minSimilarity.default,
    },
    chosen,
  );
  // Rejected neighbours are still in the evidence: the chosen cell is not the cheapest, but no 4k cell
  // delivers more evidence, and the next step up costs more than a third again.
  const cell = (budgetTokens, topK, minSimilarity) =>
    report.cells.find(
      (row) => row.budgetTokens === budgetTokens && row.topK === topK && row.minSimilarity === minSimilarity && row.renderer === "excerpt",
    );
  const abilities = ["knowledge-update", "multi-session", "temporal-reasoning", "single-session-user", "single-session-assistant"];
  const s = (row) => abilities.reduce((sum, ability) => sum + row.byAbility[ability].allNeededVisible, 0);
  assert.ok(s(cell(4000, 8, 0.2)) < s(cell(4000, 12, 0.2)));
  assert.ok(cell(6000, 12, 0.2).tokensMean > cell(4000, 12, 0.2).tokensMean * 1.3);
});
