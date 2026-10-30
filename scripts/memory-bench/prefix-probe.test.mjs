import { test } from "bun:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { summarizeRequests } from "./prefix-probe.mjs";

const exec = promisify(execFile);
const probe = async () =>
  JSON.parse((await exec(process.execPath, ["scripts/memory-bench/prefix-probe.mjs"], { timeout: 60_000, maxBuffer: 4_000_000 })).stdout);

test("prefix_probe_detects_a_seeded_prefix_change", () => {
  const request = (content) => ({ context: [{ content, metadata: { source: "fabric-core" } }], messages: [] });
  const result = summarizeRequests([
    { turn: 1, writes: [], request: request("seed") },
    { turn: 2, writes: [], request: request("seed") },
    { turn: 3, writes: ["memory.insert"], request: request("changed") },
  ]);
  assert.equal(result.firstChanges["fabric-core"].request, 3);
  assert.deepEqual(result.firstChanges["fabric-core"].writes, ["memory.insert"]);
  assert.equal(result.firstChanges.prefix.request, 3);
  assert.notEqual(result.requests[1].prefixSha256, result.requests[2].prefixSha256);
});

test("prefix_probe_is_deterministic", async () => {
  const first = await probe();
  assert.deepEqual(await probe(), first);
  assert.equal(first.scenarios.length, 7);
  for (const scenario of first.scenarios) assert.equal(new Set(scenario.requests.map((row) => row.turn)).size, 10);
  assert.equal(first.assumptions.storageStrength.increasesOnRecordedUse, true);
  assert.equal(first.assumptions.storageStrength.coreOnlyCitationRecorded, false);
  assert.equal(first.assumptions.tail.afterTranscript, true);
  assert.equal(first.assumptions.tail.beforeLatestUser, false);
  assert.equal(first.assumptions.tail.afterPriorTranscript, true);
  assert.ok(first.assumptions.tail.requests > 0);
  assert.equal(first.assumptions.extractor.calls, 2);
  assert.equal(first.assumptions.extractor.systemIdentical, true);
  assert.equal(first.assumptions.extractor.toolsIdentical, true);
  for (const sample of first.assumptions.extractor.samples) {
    assert.equal(sample.withoutIdEnumsSha256, sample.toolsSha256, "the shipped schema contains no per-call id enums");
    assert.equal(sample.withoutIdEnumsBytes, sample.encodedBytes);
    if (first.assumptions.extractor.tokenCountsMeasured) {
      assert.ok(sample.withoutIdEnumsEncodedTokens > 0);
      assert.equal(sample.withoutIdEnumsEncodedTokens, sample.encodedTokens);
    } else assert.equal(sample.encodedTokens, null);
  }
  assert.equal(first.tailCache.sessionsClosed, 4);
  assert.equal(first.tailCache.entriesAfterClose, 0);
  const byId = Object.fromEntries(first.scenarios.map((row) => [row.id, row]));
  assert.equal(byId["exchange-archive"].archivedExchanges, 10);
  for (const id of ["exchange-archive", "cited-core", "insert", "working-update", "background-promote"]) {
    assert.equal(byId[id].distinctPrefixes, 1, `${id}: additive writes keep the epoch prefix`);
  }
  assert.equal(byId.forget.distinctPrefixes, 2);
  assert.equal(byId.forget.firstChanges.prefix.request, 7, "the forget tool follow-up breaks the epoch immediately");
  assert.equal(byId["background-promote"].consolidationPasses, 2);
  assert.equal(byId["background-promote"].storedNotes, 3);
  assert.equal(byId.forget.forgottenNoteVisibleOnLastRequest, false);
  assert.equal(byId["second-instance"].forgottenNoteReadable, false);
  assert.equal(
    byId["second-instance"].forgottenNoteVisibleOnLastRequest,
    false,
    "another process's forget leaves the next request (Task 4.14)",
  );
}, 120_000);

test("prefix_probe_report_carries_no_note_text", async () => {
  const report = await probe();
  const json = JSON.stringify(report);
  for (const text of ["canary rollouts", "violet orchard", "retry budget", "remember", "content", "messages", "tool_call"]) {
    assert.equal(json.includes(text), false, `public evidence leaked ${text}`);
  }
  assert.match(report.sha256, /^[a-f0-9]{64}$/);
  const { sha256, ...payload } = report;
  assert.equal(createHash("sha256").update(JSON.stringify(payload)).digest("hex"), sha256);
  for (const scenario of report.scenarios) {
    for (const row of scenario.requests) assert.match(row.prefixSha256, /^[a-f0-9]{64}$/);
  }
}, 60_000);

test("equivalence_mismatch_lists_arms_to_rerun_and_never_merges_cells", async () => {
  const { compareAnswerCaptures, requestSegments } = await import("./prefix-probe.mjs");
  const segments = (tailPosition, system = "s") => ({ system, tools: "t", context: "c", transcript: "x", tail: "l", tailPosition });
  const request = (sha256, tailPosition, system) => ({ sha256, bytes: 1, segments: segments(tailPosition, system) });
  const capture = (rows) => ({
    arms: Object.entries(rows).map(([id, questions]) => ({
      id,
      config: `config-${id}`,
      questions: Object.entries(questions).map(([qid, requests]) => ({ id: qid, requests })),
    })),
  });
  const same = { q1: [request("a", "none"), request("b", "none")] };
  const identical = compareAnswerCaptures(
    capture({ "preset-r1": same, "passive-only": same }),
    capture({ "preset-r1": same, "passive-only": same }),
  );
  assert.equal(identical.status, "identical");
  assert.deepEqual(identical.rerunArms, []);
  assert.equal(identical.requestsCompared, 4);

  const moved = { q1: [request("a", "none"), request("c", "after-latest-user", "s2")], q2: [request("d", "none")] };
  const different = compareAnswerCaptures(
    capture({ "preset-r1": { ...same, q2: [request("d", "none")] }, "passive-only": same }),
    capture({ "preset-r1": moved, "passive-only": same }),
  );
  assert.equal(different.status, "different");
  assert.deepEqual(different.differingArms, ["preset-r1"]);
  assert.deepEqual(different.rerunArms, ["preset-r1"], "only the differing arm is rerun");
  assert.equal(different.mergeWithPreChangeCells, false);
  assert.deepEqual(different.differing[0].differingSegments, ["system", "tailPosition"]);
  assert.deepEqual(different.differing[0].questions, [{ id: "q1", baseRequests: 2, postRequests: 2, firstDifferentRequest: 2 }]);
  // A missing arm or a different request count is a difference, not a skipped comparison.
  assert.equal(
    compareAnswerCaptures(capture({ "preset-r1": same }), capture({ "preset-r1": { q1: [request("a", "none")] } })).status,
    "different",
  );
  assert.equal(compareAnswerCaptures(capture({ "preset-r1": same }), capture({})).status, "different");

  const tail = { role: "system", content: [], metadata: { contextBlocks: [{ source: "fabric-semantic" }] } };
  const user = { role: "user", content: [{ type: "text", text: "q" }] };
  assert.equal(requestSegments({ messages: [tail, user] }).tailPosition, "before-latest-user");
  assert.equal(requestSegments({ messages: [user, tail] }).tailPosition, "after-latest-user");
  assert.equal(requestSegments({ messages: [user] }).tailPosition, "none");
});

test("answer_path_capture_is_deterministic_and_holds_hashes_only", async () => {
  const { mkdtemp, readFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "prism-capture-"));
  const run = async (name) => {
    const out = join(dir, name);
    await exec(
      process.execPath,
      ["--preload", `${import.meta.dir}/equivalence-preload.mjs`, `${import.meta.dir}/prefix-probe.mjs`, "--capture-answers", out],
      {
        timeout: 120_000,
        maxBuffer: 4_000_000,
      },
    );
    return readFile(out, "utf8");
  };
  const first = await run("one.json");
  assert.equal(await run("two.json"), first, "pinned ids and clock make two captures byte-identical");
  const capture = JSON.parse(first);
  assert.deepEqual(
    capture.arms.map((arm) => arm.id),
    ["preset-r1", "passive-only"],
  );
  for (const arm of capture.arms) assert.ok(arm.questions.length > 0 && arm.questions.every((question) => question.requests.length > 0));
  for (const text of ["cobalt", "amber", "project color", "Answer the final question"])
    assert.equal(first.includes(text), false, `capture leaked ${text}`);
  await assert.rejects(
    exec(process.execPath, ["scripts/memory-bench/prefix-probe.mjs", "--capture-answers", join(dir, "unpinned.json")], { timeout: 60_000 }),
    /preload/,
  );
}, 240_000);
