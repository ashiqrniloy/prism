import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  DEFAULT_COMPACT_AT_RATIO,
  DEFAULT_KEEP_RECENT_RATIO,
  DEFAULT_REHEARSAL_TARGET_TOKENS,
  OBSERVATIONS_POOL_CAP_RATIO,
  OBSERVATIONS_POOL_MAX_TOKENS,
  resolveModelInputCap,
  resolveObservationsPoolTokens,
} from "../../../packages/memory/system/src/session/config.ts";
import { estimateMessageTokens as productTailTokens } from "../../../packages/memory/system/src/session/tokens.ts";
import { createSession, partitionIds, sessionBenchPartitions } from "../session-bench/generate.mjs";
import {
  MAX_OUTPUT_TOKENS as RUNNER_MAX_OUTPUT_TOKENS,
  requestTokens,
  runArmSession,
  sessionBenchAgentMock,
  sessionBenchWorkerMock,
} from "../session-bench/run.mjs";
import { JOB_ARTIFACT_TOKENS } from "../session-bench/templates/build.mjs";
import {
  blockTokens,
  compactAtTokens,
  FIXED_REQUEST_PARTS,
  FIXED_REQUEST_TOKENS,
  GATE_FILE,
  harnessInputCap,
  keepRecentTokens,
  LIVE_FIXED_REQUEST_TOKENS,
  LONG_JOB_ARTIFACT_TOKENS,
  MAX_OUTPUT_TOKENS,
  maxArtifactTokens,
  PRODUCT_RULES,
  poolOverflowTask,
  poolTokens,
  pressureReport,
  productInputCap,
  productMessageTokens,
  sessionPressure,
  underTriggerRequest,
  WORST_REQUEST_SHARE,
  windowTokens,
  worstRequest,
} from "./pressure.mjs";

// The design review's measured worst case (36 STM-only sessions after plan 218.5 Task 1), as the gate record holds it.
const MEASURED = {
  render: { lineCharsPerDescriptionToken: 5.2442, headerChars: 1187 },
  round: { overheadTokens: 2222, escapeRatio: 1.0275 },
};

test("pool_overflow_task_follows_the_bound", () => {
  // 190 tokens per task: 47 tasks hold 8,930, the 48th passes 8,985.
  assert.equal(poolOverflowTask(190, 8_985), 48);
  // The pool at W = 32K is 30% of the product's input cap (28,928), so 8,678: the same rate overflows two tasks sooner.
  assert.equal(poolTokens(32_000), 8_678);
  assert.equal(poolOverflowTask(190, poolTokens(32_000)), 46);
  // The scope's records are there before the first task.
  assert.equal(poolOverflowTask(190, 8_985, 400), 46);
  // A large window holds the fixed 20,000.
  assert.equal(poolTokens(200_000), 20_000);
  assert.equal(poolOverflowTask(190, poolTokens(200_000)), 106);
  assert.throws(() => poolOverflowTask(0, 8_985), /positive/);
});

test("worst_request_fits_the_input_cap", () => {
  const cap = harnessInputCap();
  const chosen = worstRequest({ ...MEASURED, artifactTokens: LONG_JOB_ARTIFACT_TOKENS[1] });
  assert.ok(chosen.tokens <= WORST_REQUEST_SHARE * cap, `the chosen maximum reaches ${chosen.share} of the cap`);
  // A larger artifact fails the 90% rule; v3's artifacts exceed the cap itself with the pool at its bound.
  const larger = worstRequest({ ...MEASURED, artifactTokens: LONG_JOB_ARTIFACT_TOKENS[1] + 500 });
  assert.ok(larger.tokens > WORST_REQUEST_SHARE * cap);
  assert.ok(worstRequest({ ...MEASURED, artifactTokens: JOB_ARTIFACT_TOKENS[1] }).tokens > cap);
  // The largest artifact that fits is where the rule turns.
  const most = maxArtifactTokens(MEASURED);
  assert.ok(most >= LONG_JOB_ARTIFACT_TOKENS[1] && most < LONG_JOB_ARTIFACT_TOKENS[1] + 500);
  assert.ok(worstRequest({ ...MEASURED, artifactTokens: most }).tokens <= WORST_REQUEST_SHARE * cap);
  assert.ok(worstRequest({ ...MEASURED, artifactTokens: most + 1 }).tokens > WORST_REQUEST_SHARE * cap);
  // A round smaller than the keep budget leaves the tail at the budget, never below it.
  const small = worstRequest({ ...MEASURED, artifactTokens: 100 });
  assert.equal(small.tailTokens, Math.ceil((keepRecentTokens() * 4) / 3.5));
  // A request under the mid-loop trigger stays under the cap, with little room.
  const under = underTriggerRequest();
  assert.ok(under.tokens < cap && under.share > WORST_REQUEST_SHARE);
});

test("product_rules_mirror_the_product", () => {
  assert.equal(MAX_OUTPUT_TOKENS, RUNNER_MAX_OUTPUT_TOKENS);
  assert.deepEqual(PRODUCT_RULES, {
    poolMaxTokens: OBSERVATIONS_POOL_MAX_TOKENS,
    poolCapRatio: OBSERVATIONS_POOL_CAP_RATIO,
    compactAtRatio: DEFAULT_COMPACT_AT_RATIO,
    keepRecentRatio: DEFAULT_KEEP_RECENT_RATIO,
    rehearsalTargetTokens: DEFAULT_REHEARSAL_TARGET_TOKENS,
  });
  for (const window of [32_000, 64_000, 200_000]) {
    const model = { limits: { contextWindow: window, maxOutputTokens: MAX_OUTPUT_TOKENS } };
    assert.equal(productInputCap(window), resolveModelInputCap(model));
    assert.equal(poolTokens(window), resolveObservationsPoolTokens(resolveModelInputCap(model)));
    assert.equal(compactAtTokens(window), resolveModelInputCap(model) * DEFAULT_COMPACT_AT_RATIO);
  }
  // The product sizes itself from a smaller cap than the provider wrapper enforces.
  assert.equal(productInputCap(32_000), 28_928);
  assert.equal(harnessInputCap(32_000), 29_952);
  const message = { role: "tool", content: [{ type: "tool_result", toolCallId: "c1", name: "read_file", result: 'line one\nline "two"' }] };
  assert.equal(productMessageTokens(message), productTailTokens(message));
});

test("fixed_request_tokens_match_the_runner", async () => {
  // The scope exchange of one v3 session on the STM-only arm: the first main request holds the fixed part and the scope.
  const session = { ...createSession(partitionIds(sessionBenchPartitions(), "dev")[0]), tasks: [] };
  const seen = [];
  await runArmSession({
    session,
    arm: "STM-only",
    providers: (state) => {
      const main = sessionBenchAgentMock(state);
      return [
        {
          ...main,
          async *generate(request) {
            seen.push(request);
            yield* main.generate(request);
          },
        },
        sessionBenchWorkerMock(),
      ];
    },
    model: { provider: "mock", model: "main" },
    workerModel: "worker/session-bench",
  });
  const [first] = seen;
  const system = first.messages.filter((message) => message.role === "system");
  const rest = first.messages.filter((message) => message.role !== "system");
  assert.equal(first.tools.length, 14);
  assert.equal(requestTokens(first) - windowTokens(first.messages), FIXED_REQUEST_PARTS.toolDeclarations);
  // The mock declares no tool support, so the kernel adds the tool list message; the live model gets the declarations only.
  assert.deepEqual(
    system.map((message) => windowTokens([message])),
    [FIXED_REQUEST_PARTS.instruction, FIXED_REQUEST_PARTS.toolList],
  );
  assert.equal(requestTokens(first) - windowTokens(rest), FIXED_REQUEST_TOKENS);
  assert.equal(LIVE_FIXED_REQUEST_TOKENS, FIXED_REQUEST_TOKENS - FIXED_REQUEST_PARTS.toolList);
}, 60_000);

// A stored session in the runner's shape: the scope exchange, two tasks, their records, one drop and one compaction.
function storedSession() {
  const text = (role, value) => ({ role, content: [{ type: "text", text: value }] });
  const message = (id, body) => ({ id, kind: "message", message: body });
  const ledger = (id, value) => ({ id, kind: "package_state", data: { key: "memory.session.ledger", value } });
  const record = (id, sources, fields) => ({
    id,
    kind: "result",
    description: `SECRET-TEXT ${id}`,
    relevance: "medium",
    attribution: "tool",
    sourceEntryIds: sources,
    tokenCount: 40,
    ...fields,
  });
  const artifact = "ERROR line\n".repeat(4_000);
  const records = [
    record("aaaaaaaaaaa0", ["e0"], { kind: "request", relevance: "high", attribution: "user", verbatim: true, tokenCount: 100 }),
    record("aaaaaaaaaaa1", ["e2"], { kind: "request", relevance: "high", attribution: "user", verbatim: true, tokenCount: 30 }),
    record("aaaaaaaaaaa2", ["e3", "e4"], {}),
    record("aaaaaaaaaaa3", ["e4"], { tokenCount: 20 }),
    record("aaaaaaaaaaa4", ["e6"], { kind: "statement", relevance: "high", attribution: "user", durable: "constraint", tokenCount: 10 }),
    record("aaaaaaaaaaa5", ["e7"], { tokenCount: 60 }),
  ];
  const kept = records.filter((item) => item.id !== "aaaaaaaaaaa3");
  const summary = [
    "# Session Memory",
    "## Observations",
    ...kept.map((item) => `- [${item.id}] 09:18 (${item.relevance}) ${item.kind}: ${item.description}`),
  ].join("\n");
  const entries = [
    message("e0", text("user", "Here is the plan for this session.")),
    message("e1", text("assistant", "OK.")),
    message("e2", text("user", "Task 1. Count the ERROR lines.")),
    message("e3", { role: "assistant", content: [{ type: "tool_call", id: "c1", name: "read_file", arguments: { path: "logs/a.log" } }] }),
    message("e4", { role: "tool", content: [{ type: "tool_result", toolCallId: "c1", name: "read_file", result: artifact }] }),
    ledger("s0", { type: "memory.session.observations.recorded", observations: records.slice(0, 4) }),
    message("e5", text("assistant", "Task 1 done: counted.")),
    message("e6", text("user", "Task 2. From now on label every ticket heron-42.")),
    message("e7", { role: "assistant", content: [{ type: "tool_call", id: "c2", name: "list_tickets", arguments: {} }] }),
    message("e8", { role: "tool", content: [{ type: "tool_result", toolCallId: "c2", name: "list_tickets", result: "T-1 open" }] }),
    ledger("s1", { type: "memory.session.observations.recorded", observations: records.slice(4) }),
    ledger("s2", { type: "memory.session.observations.dropped", observationIds: ["aaaaaaaaaaa3"], reason: "superseded" }),
    {
      id: "c0",
      kind: "compaction",
      summary,
      data: { keepEntryIds: ["e7", "e8"], point: "mid-loop", memory: { fullFold: false, observations: kept } },
    },
  ];
  return { entries, summary, artifact, kept };
}

test("session_pressure_counts_a_stored_session", () => {
  const { entries, summary, artifact, kept } = storedSession();
  const row = sessionPressure(entries);
  assert.equal(row.tasks, 2);
  assert.deepEqual(row.records, { recorded: 6, active: 5, verbatim: 2 });
  // The scope's record (task 0) is the session's fixed part; a dropped record leaves the pool.
  assert.deepEqual(row.descriptionTokens, { recorded: 260, active: 240, scope: 100, verbatim: 30, protected: 40 });
  assert.deepEqual(row.perTask, {
    records: 2,
    tokens: 70,
    byRelevance: { low: 0, medium: 50, high: 20, critical: 0 },
    highTokens: 20,
    protectedTokens: 20,
    recordedTokens: 130,
  });
  assert.equal(row.overflowTask, poolOverflowTask(70, poolTokens(), 100));
  assert.equal(row.render.records, 5);
  assert.equal(row.render.renderedLines, 5);
  assert.equal(row.render.descriptionTokens, 240);
  assert.equal(row.render.blockTokens, blockTokens(summary));
  // One artifact read: the round costs its call and the message overheads beyond the result.
  assert.equal(row.rounds.artifactReads, 1);
  assert.equal(
    row.rounds.overheadTokens.max,
    windowTokens(entries.slice(3, 5).map((entry) => entry.message)) - Math.ceil(JSON.stringify(artifact).length / 3.5),
  );
  assert.ok(row.rounds.escapeRatio > 1);
  // The request after the compaction: the live fixed part, the block and the kept tail.
  assert.equal(row.afterCompaction.midLoop, 1);
  assert.equal(
    row.afterCompaction.maxRequestTokens,
    LIVE_FIXED_REQUEST_TOKENS + blockTokens(summary) + windowTokens(entries.slice(8, 10).map((entry) => entry.message)),
  );
  assert.equal(kept.length, 5);
  assert.throws(() => sessionPressure(entries.slice(0, 2)), /no task prompt/);
});

test("report_holds_counts_and_no_text", () => {
  const { entries } = storedSession();
  const report = pressureReport({ sessions: [{ session: "sb-xx-01", entries }], ledgersHash: "0".repeat(64) });
  const text = JSON.stringify(report);
  for (const leak of ["SECRET-TEXT", "ERROR line", "heron-42", "Count the ERROR"]) assert.ok(!text.includes(leak), leak);
  assert.equal(report.pressure.overflowTask.mean, poolOverflowTask(70, poolTokens(), 100));
  assert.equal(report.buckets.beforeBelowTask, report.pressure.overflowTask.densest);
  assert.equal(report.buckets.afterAboveTask, report.pressure.overflowTask.mean + 10);
  assert.deepEqual(report.artifactTokens, [...LONG_JOB_ARTIFACT_TOKENS]);
  assert.deepEqual(
    report.findings.map((finding) => finding.id),
    [
      "pool-bounds-description-tokens",
      "product-cap-below-harness-cap",
      "trigger-near-the-cap",
      "eviction-reaches-medium-records-only",
      "rehearsal-drop-in-reach",
      "protected-records-fill-the-pool",
    ],
  );
});

test("gate_record_design_matches_the_script", () => {
  assert.ok(existsSync(GATE_FILE), "the gate record holds the design review (pressure.mjs --write)");
  const { design } = JSON.parse(readFileSync(GATE_FILE, "utf8"));
  assert.equal(design.window, 32_000);
  assert.deepEqual(design.caps, {
    harnessInputCap: harnessInputCap(),
    productInputCap: productInputCap(),
    poolTokens: poolTokens(),
    keepRecentTokens: keepRecentTokens(),
    compactAtTokens: compactAtTokens(),
    fixedRequestTokens: { live: LIVE_FIXED_REQUEST_TOKENS, withToolList: FIXED_REQUEST_TOKENS },
  });
  assert.deepEqual(design.artifactTokens, [...LONG_JOB_ARTIFACT_TOKENS]);
  // The record's worst case recomputes from the record's own measurements, and it is the one the tests above use.
  const measured = {
    render: { lineCharsPerDescriptionToken: design.render.lineCharsPerDescriptionToken.max, headerChars: design.render.headerChars },
    round: { overheadTokens: design.rounds.overheadTokens.max, escapeRatio: design.rounds.escapeRatio },
  };
  assert.deepEqual(measured, MEASURED);
  assert.deepEqual(design.worstRequest.chosenArtifact, worstRequest({ ...measured, artifactTokens: LONG_JOB_ARTIFACT_TOKENS[1] }));
  assert.ok(design.worstRequest.chosenArtifact.share <= WORST_REQUEST_SHARE);
  assert.equal(design.worstRequest.maxArtifactTokens, maxArtifactTokens(measured));
  assert.equal(
    design.pressure.overflowTask.mean,
    poolOverflowTask(design.pressure.tokensPerTask.mean, poolTokens(), design.pressure.scopeTokens),
  );
  assert.equal(design.buckets.beforeBelowTask, design.pressure.overflowTask.densest);
  assert.equal(design.buckets.afterAboveTask, design.pressure.overflowTask.mean + 10);
  // Counts and ids only.
  for (const row of design.sessions)
    assert.deepEqual(Object.keys(row), [
      "session",
      "tasks",
      "records",
      "descriptionTokens",
      "tokensPerTask",
      "overflowTask",
      "renderRatio",
    ]);
});
