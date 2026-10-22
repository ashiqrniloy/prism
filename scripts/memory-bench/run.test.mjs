import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, providerDone, providerError, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { loadDataset, normalizeDataset, selectQuestions } from "./datasets.mjs";
import {
  causalSessions,
  extractEvidence,
  gradeEvidence,
  isTruncatedStreamFailure,
  mockProvider,
  replay,
  retrievalStage,
} from "./replay.mjs";
import { askJudge, isRetryableJudgeFailure, missingUsageCount, runBench } from "./run.mjs";
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

test("agentic_limit_failure_has_bounded_trace_and_explicit_protocol", async () => {
  const state = benchState();
  const provider = {
    id: "mock",
    async *generate() {
      yield providerToolCall(toolCallContent("recall", "memory.recall", { query: "project color", kinds: ["all"] }));
      yield providerDone();
    },
  };
  try {
    await replay(
      retryQuestion,
      { config: "fabric-agentic", suite: "longmemeval-s", modelConfig: { provider: "mock", model: "m" }, inputCap: 128000 },
      [provider],
      state,
    );
    assert.fail("agentic loop must hit the turn limit");
  } catch (error) {
    assert.match(error.message, /MemoryBenchAnswerError:ERR_PRISM_RUN_LIMIT/);
    assert.equal(error.diagnostics.maxTurns, 8);
    assert.ok(error.diagnostics.turns <= 8);
    assert.ok(error.diagnostics.tools.length <= 8);
    assert.ok(error.diagnostics.tools.every((name) => name === "memory.recall"));
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
  const hits = ["a", "b"].map((id) => ({ id, kind: "episode", ingestedAt: "2023-01-01", content: `${id} PRIVATE_FIXTURE `.repeat(150) }));
  const rounds = hits.map((hit) => ({ id: hit.id, messages: [{ hasAnswer: true, text: hit.content }] }));
  const metrics = deliveryMetrics({
    question: { question: "fixture query" },
    query: "Question date: 2023-05-30T23:40:00Z\nfixture query",
    hits,
    rounds,
    fine: new Set(["a", "b"]),
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
  assert.deepEqual(selectInjection([]), { ids: [], tokens: 0 });
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
  for (const candidates of [hits, hits.slice(1)]) {
    // Exact boundary: the citation preamble must consume budget too.
    for (const budgetTokens of [1, 600, selectInjection(candidates, 10000).tokens]) {
      const draft = await createFabricContext(memory, async () => ({ hits: candidates, explain: [] }), { budgetTokens, topK: 3 }).build(
        { messages: [user.message] },
        context,
      );
      const rendered = draft.messages[0].content.map((block) => block.text ?? "").join("\n");
      assert.deepEqual(
        candidates.filter((hit) => rendered.includes(`[${hit.id}]`)).map((hit) => hit.id),
        selectInjection(candidates, budgetTokens).ids,
      );
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
