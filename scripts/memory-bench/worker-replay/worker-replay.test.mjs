import { test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { assertMemoryModelFixture, MEMORY_MODEL_CRITERIA } from "../robustness.mjs";
import {
  buildWorkerReplayFixture,
  LONG_SCOPE_MIN_BYTES,
  loadWorkerReplayFixture,
  STM_SETS,
  WORKER_REPLAY_MAX_REQUESTS,
  workerReplayIndex,
} from "./build.mjs";
import {
  assertReplayGate,
  assertRulesUnchanged,
  OFFLINE_EXPECTED,
  OFFLINE_MODEL,
  offlineSummary,
  REPLAY_GATE,
  refusedReasons,
  replayReport,
  rulesHash,
  runReplay,
  scriptedClients,
  waitForNetwork,
} from "./run.mjs";
import { aggregateStm, aggregateWm, pairReplays, REPLAY_RULES, scoreStmRequest, scoreWmRequest } from "./score.mjs";

const fixture = loadWorkerReplayFixture();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

let offline;
async function offlineReport() {
  if (!offline) {
    const results = await runReplay({ fixture, models: [{ ref: OFFLINE_MODEL, makeClient: scriptedClients() }] });
    offline = replayReport({ results, fixture, label: "offline", productHash: "0".repeat(64), startedAt: "t0", finishedAt: "t1" });
  }
  return offline;
}

test("replay_fixture_is_frozen_and_hash_matches_the_criteria_index", () => {
  // The committed files match index.json (loadWorkerReplayFixture refuses otherwise), and index.json is the criteria pin.
  assert.equal(assertMemoryModelFixture("worker-replay"), fixture.indexSha256);
  // A case changed without an amendment: the rebuild no longer matches the committed bytes.
  const rebuilt = workerReplayIndex(buildWorkerReplayFixture());
  assert.deepEqual(rebuilt.sha256, fixture.index.sha256);
  const changed = buildWorkerReplayFixture();
  changed["stm.json"].requests[0].entries[0].message.content[0].text += " (edited)";
  assert.notEqual(workerReplayIndex(changed).sha256["stm.json"], fixture.index.sha256["stm.json"]);
  // Shape: at most 120 requests, every hard case at least 6 times, the long scope at least 16 KB.
  const { stm, wm } = fixture.index.counts;
  const total = Object.values(stm).reduce((a, b) => a + b, 0) + Object.values(wm).reduce((a, b) => a + b, 0);
  assert.ok(total <= WORKER_REPLAY_MAX_REQUESTS, `${total} requests`);
  for (const set of STM_SETS.filter((name) => name !== "base")) assert.ok(stm[set] >= 6, `${set}: ${stm[set]}`);
  for (const request of fixture.wm.requests.filter((r) => r.set === "long-scope")) assert.ok(request.scope.bytes >= LONG_SCOPE_MIN_BYTES);
  // The long-session fixture and its pinned hash are untouched.
  const longSession = MEMORY_MODEL_CRITERIA.fixtures.index.find((entry) => entry.id === "long-session-replay");
  assert.equal(longSession.hash, "50a496470d0a9ac90b77e1f3656b558069cadc28bcd24797b91112fa3a8c06cb");
  assert.equal(sha256(readFileSync(longSession.hashOf)), longSession.hash);
});

const entry = (id, role, text) => ({
  id,
  sessionId: "t",
  kind: "message",
  timestamp: "2026-11-02T09:00:00.000Z",
  message: { role, content: [{ type: "text", text }] },
});
const event = (id, kind, description, sourceEntryIds, extra = {}) => ({
  id,
  kind,
  description,
  count: 1,
  timestamp: "2026-11-02T09:00:00.000Z",
  relevance: "medium",
  sourceEntryIds,
  tokenCount: 10,
  ...extra,
});
const run = (extra = {}) => ({
  turns: 1,
  usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0 },
  refused: {},
  sourceTokens: 1000,
  ...extra,
});

test("replay_scores_scripted_worker_exactly", async () => {
  // STM: one real correction, one "actually" that corrects nothing, a failed check, a passed outcome that says "0 failed".
  const request = {
    id: "r",
    set: "base",
    entries: [
      entry("e1", "user", "That's wrong, use the other file."),
      entry("e2", "user", "Actually, also add a doc comment."),
      entry("e3", "tool", "ReferenceError: x is not defined"),
      entry("e4", "assistant", "Fixed the failing test; 0 failed."),
    ],
  };
  const annotation = {
    outcomes: [{ entries: ["e4"], status: "passed", resolves: ["aaaaaaaaaaaa"] }],
    checks: [{ entries: ["e3"], status: "failed" }],
    corrections: [{ entry: "e1" }],
    nonCorrections: [{ entry: "e2" }],
    durable: [{ entry: "e2", kind: "constraint" }],
    evidence: [{ entry: "e3", text: "ReferenceError: x is not defined" }],
  };
  const events = [
    event("000000000001", "statement", "User said that is wrong.", ["e1"]),
    event("000000000002", "request", "User asked for a doc comment.", ["e2"]),
    event("000000000003", "error", "Tests failed: ReferenceError.", ["e3"]),
    event("000000000004", "outcome", "Fixed the failing test; 0 failed.", ["e4"], { resolves: ["aaaaaaaaaaaa", "bbbbbbbbbbbb"] }),
  ];
  const chunks = new Map([["000000000003", [{ text: "ReferenceError:  x is not defined", bytes: 31 }]]]);
  const row = scoreStmRequest({
    request,
    annotation,
    events,
    chunks,
    schema: new Set(["kind", "resolves"]),
    run: run({ refused: { no_valid_ids: 1 } }),
  });
  // Patterns: "That's wrong" and "Actually" both read as corrections; the outcome's "failing" reads as a failed check.
  assert.deepEqual(row.correction, { annotated: 1, pattern: { found: 1, tp: 1, fp: 1 }, field: null });
  assert.deepEqual(row.failure, { annotated: 1, pattern: { found: 1, tp: 1, fp: 1 }, field: null });
  assert.deepEqual(row.durable, { annotated: 1, recorded: 1, field: null });
  assert.deepEqual(row.resolves, { annotated: 1, field: { found: 1, tp: 1, fp: 1 } });
  assert.deepEqual(row.evidence, { annotated: 1, covered: 1 });
  assert.deepEqual(row.outcomes, { annotated: 1, found: 1 });
  assert.equal(row.chunkBytes, 31);
  const agg = aggregateStm([row]);
  assert.equal(agg.correction.pattern.precision, 0.5);
  assert.equal(agg.eventsPer10kSourceTokens, 40);
  assert.deepEqual(agg.refused, { no_valid_ids: 1 });

  // WM: keep, summarize, discard and a record left without a verdict.
  const records = ["111111111111", "222222222222", "333333333333", "444444444444"].map((id) => event(id, "result", `r ${id}`, ["e1"]));
  const wmRow = scoreWmRequest({
    request: { id: "w", set: "base", records },
    annotation: {
      laterStep: ["111111111111", "333333333333"],
      changedValues: [{ record: "222222222222", mustInclude: ["retry", "7"] }],
      durable: ["333333333333"],
      finished: ["333333333333", "444444444444"],
    },
    output: {
      items: [
        { id: "i1", kind: "event", text: "r 111111111111", citedIds: ["111111111111"], tokenCount: 4 },
        { id: "i2", kind: "summary", text: "retry 3 → 7", citedIds: ["222222222222"], tokenCount: 3 },
      ],
      verdicts: new Map([
        ["111111111111", { verdict: "keep" }],
        ["222222222222", { verdict: "summarize" }],
        ["333333333333", { verdict: "discard" }],
      ]),
    },
    run: { ...run({ refused: { protected: 2 } }), capStop: 0 },
  });
  assert.equal(wmRow.verdicts, 3);
  assert.deepEqual(wmRow.laterStep, { annotated: 2, kept: 1, discarded: 1 });
  assert.deepEqual(wmRow.changedValues, { annotated: 1, kept: 1 });
  assert.deepEqual(wmRow.durable, { annotated: 1, discarded: 1 });
  assert.deepEqual(wmRow.finished, { annotated: 2, discarded: 1 });
  assert.equal(aggregateWm([wmRow]).verdictShare, 0.75);
  assert.equal(aggregateWm([wmRow]).achievedRatio, 7 / 30);

  // Refusals come from the worker transcript's tool results: an error code or an `{ ok: false }` reason.
  assert.deepEqual(
    refusedReasons([
      { role: "tool", content: [{ type: "tool_result", result: { ok: false, reason: "protected" } }] },
      { role: "tool", content: [{ type: "tool_result", error: { code: "tool_call_limit" } }] },
      { role: "tool", content: [{ type: "tool_result", result: { ok: true } }] },
    ]),
    { protected: 1, tool_call_limit: 1 },
  );

  // The whole fixture on the scripted worker reproduces the frozen counts.
  assert.deepEqual(offlineSummary(await offlineReport()), OFFLINE_EXPECTED);
});

test("replay_refuses_a_rule_changed_after_the_baseline", () => {
  const draft = JSON.parse(readFileSync(REPLAY_GATE, "utf8"));
  assert.equal(draft.rulesHash, rulesHash());
  assert.deepEqual(draft.rules, JSON.parse(JSON.stringify(REPLAY_RULES)));
  assert.equal(draft.fixture.hash, fixture.indexSha256);
  const approved = { ...draft, approved: true, approvedBy: "owner", approvedAt: "2026-11-13", text: "go" };
  assert.equal(assertReplayGate(approved, { fixture }), approved);
  if (draft.approved !== true) assert.throws(() => assertReplayGate(draft, { fixture }), /not approved/);
  // A rule edited in the gate record is refused, even with its hash recomputed against the edit.
  const edited = structuredClone(approved);
  edited.rules.task5.minOutputTokensPerRecordFall = 0.1;
  assert.throws(() => assertReplayGate(edited, { fixture }), /decision rules differ/);
  edited.rulesHash = rulesHash(edited.rules);
  assert.throws(() => assertReplayGate(edited, { fixture }), /decision rules differ/);
  // Once a baseline exists, its rules hash is the one every later run must carry.
  assert.doesNotThrow(() => assertRulesUnchanged(approved, { rulesHash: rulesHash() }));
  assert.throws(() => assertRulesUnchanged(approved, { rulesHash: "0".repeat(64) }), /changed after the baseline/);
  assert.throws(
    () => assertRulesUnchanged({ ...approved, rulesHash: "1".repeat(64) }, { rulesHash: rulesHash() }),
    /changed after the baseline/,
  );
  // A free route is never a gate model.
  assert.throws(() => assertReplayGate({ ...approved, models: ["openrouter/free"] }, { fixture }), /free route/);
  // Plan 218.2 Task 8: a later fixture-only amendment keeps the approved criteria pin; a pin from before an owner
  // decision (amendment 6, qaSuitesRemoved) or one the log never held is refused.
  assert.equal(assertReplayGate(approved, { fixture, criteriaHash: "8".repeat(64) }), approved);
  for (const pin of ["52ba02ffcc489f93f9da6f940328e0ea61b6d650de0e2f98f7025c0d1d3fdd4e", "0".repeat(64)])
    assert.throws(() => assertReplayGate({ ...approved, memoryModelCriteriaHash: pin }, { fixture }), /criteria hash differs/);
});

test("replay_evidence_carries_no_text", async () => {
  const text = JSON.stringify(await offlineReport());
  const needles = new Set();
  const add = (value) => {
    for (const line of String(value).split("\n")) if (line.trim().length >= 24) needles.add(line.trim());
  };
  for (const request of fixture.stm.requests) {
    for (const item of request.entries)
      for (const block of item.message.content) add(block.text ?? (typeof block.result === "string" ? block.result : ""));
    for (const record of request.recent) add(record.description);
  }
  for (const request of fixture.wm.requests) {
    for (const record of request.records) add(record.description);
    for (const item of request.wmItems) add(item.text);
    add(request.scope.text);
    add(request.taskState.goal);
  }
  for (const annotation of Object.values(fixture.annotations.stm)) for (const span of annotation.evidence) add(span.text);
  assert.ok(needles.size > 1000, `${needles.size} needles`);
  const leaked = [...needles].filter((needle) => text.includes(needle));
  assert.deepEqual(leaked, []);
});

test("replay_waits_out_an_outage_and_never_checkpoints_a_failure", async () => {
  // A worker whose first `failures` calls drop the connection, then answers as the scripted worker does.
  const flaky = (failures) => {
    const scripted = scriptedClients();
    let calls = 0;
    return (request, tier) => {
      const base = scripted(request, tier);
      return {
        ...base,
        async *generate(input) {
          calls += 1;
          if (calls <= failures) throw Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" });
          yield* base.generate(input);
        },
      };
    };
  };
  const saved = new Map();
  const checkpoint = {
    load: async (slug, id) => saved.get(`${slug}--${id}`),
    save: async (slug, id, value) => saved.set(`${slug}--${id}`, value),
  };
  const run = (makeClient, recover) =>
    runReplay({ fixture, models: [{ ref: OFFLINE_MODEL, makeClient }], only: "stm", limit: 1, checkpoint, recover, now: () => 0 });

  // An outage: two failed attempts while the network was down cost no attempt; the third succeeds and is checkpointed.
  let waits = 0;
  const outage = await run(flaky(2), async () => {
    waits += 1;
    return true;
  });
  const row = outage[OFFLINE_MODEL].rows.stm[0];
  assert.equal(waits, 2);
  assert.equal(row.failed ?? null, null);
  assert.equal(saved.size, 1);

  // A failure with the network up: three attempts, the row is reported failed and never checkpointed.
  saved.clear();
  let checks = 0;
  const broken = await run(flaky(Infinity), async () => {
    checks += 1;
    return false;
  });
  assert.equal(checks, 3);
  assert.equal(broken[OFFLINE_MODEL].rows.stm[0].failed.name, "Error");
  assert.equal(saved.size, 0);

  // waitForNetwork: polls until the probe answers and says whether it waited.
  const answers = [false, false, true];
  const slept = [];
  assert.equal(await waitForNetwork({ probe: async () => answers.shift(), sleep: async (ms) => slept.push(ms), pollMs: 5 }), true);
  assert.deepEqual(slept, [5, 5]);
  assert.equal(await waitForNetwork({ probe: async () => true, sleep: async () => assert.fail("no wait") }), false);
  assert.equal(await waitForNetwork({ probe: async () => false, sleep: async () => {}, pollMs: 5, maxWaitMs: 10 }), false);
});

test("replay_after_pairs_with_baseline_on_the_same_fixture_hash", async () => {
  const baseline = await offlineReport();
  const after = structuredClone(baseline);
  after.productHash = "1".repeat(64);
  const model = after.models[OFFLINE_MODEL];
  model.wm.all.verdicts += 1;
  model.wm.all.verdictShare = model.wm.all.verdicts / model.wm.all.records;
  const paired = pairReplays(after, baseline);
  assert.deepEqual(paired.productHash, { baseline: "0".repeat(64), after: "1".repeat(64) });
  assert.equal(paired.fixture, fixture.indexSha256);
  assert.deepEqual(paired.models, [OFFLINE_MODEL]);
  const row = paired.perModel[OFFLINE_MODEL];
  assert.ok(row.wm.all.verdictShare.delta > 0);
  assert.equal(row.stm.all["evidence.covered"].delta, 0);
  assert.equal(typeof row.stm.all.outputTokensPer10kSourceTokens.after, "number");
  // A different fixture, a different model set, different rules or a one-tier run is refused.
  assert.throws(() => pairReplays({ ...after, fixture: { indexSha256: "2".repeat(64) } }, baseline), /different fixtures/);
  assert.throws(() => pairReplays({ ...after, models: { "other/model": model } }, baseline), /different models/);
  assert.throws(() => pairReplays({ ...after, rulesHash: "3".repeat(64) }, baseline), /different rules/);
  assert.throws(() => pairReplays({ ...after, only: "stm" }, baseline), /both tiers/);
});
