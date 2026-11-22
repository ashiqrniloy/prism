/**
 * Plan 218.3 Task 12 (Session-Bench diagnostic, 2026-11-20): STM saw a tool call and its output in separate batches. A
 * background pass ran at turn end, before the output existed, and an output larger than the batch budget travelled
 * alone. STM recorded "no tool result was shown"; the compaction then removed the output and recall could not reach it.
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { type ModelProvider, providerDone, providerToolCall, type SessionEntry, toolCallContent } from "@arnilo/prism";
import { openToolRoundStart, withRequestContext } from "../flush.js";
import { serializeSourceBatches } from "../serialize.js";
import { fallbackObservations, runStm, STM_FALLBACK_BATCH_CHARS, STM_FALLBACK_LINE_CHARS, withToolResults } from "../workers/stm.js";
import { clientFor } from "./helpers.js";

const at = "2026-11-20T00:00:00.000Z";
const user = (id: string, text: string): SessionEntry =>
  ({ id, sessionId: "s", timestamp: at, kind: "message", message: { role: "user", content: [{ type: "text", text }] } }) as SessionEntry;
const call = (id: string, ...callIds: string[]): SessionEntry =>
  ({
    id,
    sessionId: "s",
    timestamp: at,
    kind: "message",
    message: { role: "assistant", content: callIds.map((callId) => toolCallContent(callId, "read_file", { path: "logs/a.log" })) },
  }) as SessionEntry;
const result = (id: string, callId: string, text: string): SessionEntry =>
  ({
    id,
    sessionId: "s",
    timestamp: at,
    kind: "message",
    message: { role: "tool", content: [{ type: "tool_result", toolCallId: callId, name: "read_file", result: text }] },
  }) as SessionEntry;

describe("tool rounds in STM batches (plan 218.3 Task 12)", () => {
  it("oversized_output_travels_with_its_call", () => {
    const entries = [user("u1", "Count the ERROR lines in logs/a.log."), call("a1", "c1"), result("t1", "c1", "x".repeat(70_000))];
    const batches = serializeSourceBatches(entries, [], 60_000);
    assert.deepEqual(
      batches.map((batch) => batch.entries.map((entry) => entry.id)),
      [["u1"], ["a1", "t1"]],
    );
    for (const batch of batches) assert.ok(Buffer.byteLength(batch.text) <= 60_000);
    assert.match(batches[1]!.text, /\[truncated: entry t1 is \d+ bytes/);
  });

  it("batch_closes_before_a_call_not_between_call_and_output", () => {
    const entries = [user("u1", "u".repeat(300)), call("a1", "c1"), result("t1", "c1", "r".repeat(600))];
    const batches = serializeSourceBatches(entries, [], 4_000, 800);
    assert.deepEqual(
      batches.map((batch) => batch.entries.map((entry) => entry.id)),
      [["u1"], ["a1", "t1"]],
    );
  });

  it("a_tail_that_fits_is_still_one_batch", () => {
    const entries = [user("u1", "hi"), call("a1", "c1"), result("t1", "c1", "ok")];
    assert.equal(serializeSourceBatches(entries, [], 60_000).length, 1);
  });

  it("background_pass_holds_an_open_tool_round", () => {
    assert.equal(openToolRoundStart([user("u1", "go"), call("a1", "c1")]), 1);
    assert.equal(openToolRoundStart([user("u1", "go"), call("a1", "c1", "c2"), result("t1", "c1", "ok")]), 1);
    assert.equal(openToolRoundStart([user("u1", "go"), call("a1", "c1"), result("t1", "c1", "ok")]), 3);
    assert.equal(openToolRoundStart([user("u1", "go")]), 1);
  });

  it("batch_without_the_request_carries_it_as_context", () => {
    const branch = [user("u1", "Count the ERROR lines in logs/a.log."), call("a1", "c1"), result("t1", "c1", "log")];
    const text = withRequestContext({ entries: branch.slice(1), text: "BATCH" }, branch, []);
    assert.equal(text, "[context, not a source: the current user request, recorded earlier] Count the ERROR lines in logs/a.log.\nBATCH");
    // No entry id in the context line: the worker cites the batch's own entries.
    assert.ok(!text.includes("u1"));
    assert.equal(withRequestContext({ entries: branch, text: "BATCH" }, branch, []), "BATCH");
  });

  it("a_cited_call_brings_its_outputs", () => {
    const entries = [call("a1", "c1"), result("t1", "c1", "log"), call("a2", "c2"), result("t2", "c2", "other")];
    assert.deepEqual(withToolResults(["a1"], entries), ["a1", "t1"]);
    assert.deepEqual(withToolResults(["t2"], entries), ["t2"]);
    assert.deepEqual(withToolResults([], entries), []);
  });

  it("stm_pass_at_its_output_cap_retries_with_thinking_off", async () => {
    // Live on hy4-flash-free with a 2,048-token output: 78 of 87 STM calls spent it all reasoning and recorded nothing,
    // yet coverage advanced past the batch, so a compaction removed content STM never recorded.
    const levels: unknown[] = [];
    const firstCapped: ModelProvider = {
      id: "mock",
      async *generate(request) {
        levels.push(request.options?.compat?.reasoning_effort);
        if (levels.length === 1) {
          yield providerDone(undefined, "max_output_tokens");
          return;
        }
        if (!request.messages.some((message) => message.role === "tool"))
          yield providerToolCall(
            toolCallContent("r1", "record_event", {
              kind: "request",
              description: "User asked to count ERROR lines",
              sourceEntryIds: ["u1"],
            }),
          );
        yield providerDone();
      },
    };
    const model = { provider: "mock", model: "m", compat: { thinkingFamily: "reasoning_effort" } };
    const recorded = await runStm({
      verbatimUserChars: 0,
      entries: [user("u1", "Count the ERROR lines.")],
      client: clientFor(firstCapped, model),
      maxTurns: 2,
      thinkingLevel: "low",
    });
    assert.deepEqual(levels.slice(0, 2), ["low", "none"], "the retry asks with thinking off");
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]!.fallback, undefined, "a model record");
    // A model that answers in prose without reaching the cap read the batch and found nothing to record.
    const quiet: ModelProvider = {
      id: "mock",
      async *generate() {
        yield providerDone();
      },
    };
    assert.deepEqual(await runStm({ verbatimUserChars: 0, entries: [user("u1", "hi")], client: clientFor(quiet), maxTurns: 1 }), []);
  });

  it("stm_pass_at_its_output_cap_twice_records_without_the_model", async () => {
    let calls = 0;
    const capped: ModelProvider = {
      id: "mock",
      async *generate() {
        calls++;
        yield providerDone(undefined, "max_output_tokens");
      },
    };
    const entries = [
      user("u1", "Count the ERROR lines in logs/a.log."),
      call("a1", "c1"),
      result("t1", "c1", "ERROR one\nERROR two\nINFO three"),
    ];
    const recorded = await runStm({ verbatimUserChars: 0, entries, client: clientFor(capped), maxTurns: 1, thinkingLevel: "low" });
    assert.equal(calls, 2, "one retry, then no more model calls");
    assert.deepEqual(
      recorded.map((item) => [item.kind, item.fallback, item.sourceEntryIds]),
      [
        ["request", "output_cap", ["u1"]],
        ["action", "output_cap", ["a1", "t1"]],
      ],
    );
    assert.match(recorded[0]!.description, /^\[not read by STM\] User: Count the ERROR lines/);
    assert.match(recorded[1]!.description, /Called read_file \{"path":"logs\/a\.log"\} → ERROR one ERROR two/);
  });

  it("fallback_records_stay_within_the_batch_budget_and_keep_requests", () => {
    const entries: SessionEntry[] = [user("u1", "Assign the owner.")];
    for (let i = 0; i < 40; i++) entries.push(call(`a${i}`, `c${i}`), result(`t${i}`, `c${i}`, "x".repeat(1_000)));
    entries.push(user("u2", `Then close it. ${"y".repeat(2_000)}`));
    const records = fallbackObservations(entries, [], "worker_error", 0);
    const chars = records.reduce((sum, item) => sum + item.description.length - "[not read by STM] ".length, 0);
    assert.ok(chars <= STM_FALLBACK_BATCH_CHARS, `${chars} chars`);
    assert.deepEqual(
      records.filter((item) => item.kind === "request").map((item) => item.sourceEntryIds[0]),
      ["u1", "u2"],
    );
    assert.ok(records.at(-2)?.sourceEntryIds.includes("a39"), "the newest tool lines stay");
    assert.ok(records.every((item) => !item.description.includes("\n")));
    assert.ok(records.find((item) => item.sourceEntryIds[0] === "u2")!.description.length <= STM_FALLBACK_LINE_CHARS + 30);
  });
});
