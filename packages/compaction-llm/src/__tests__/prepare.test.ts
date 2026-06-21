import assert from "node:assert/strict";
import test from "node:test";
import { createSessionEntry, type SessionEntry } from "prism";
import { prepareLlmCompaction } from "../prepare.js";

const timestamp = "2026-01-01T00:00:00.000Z";

function textEntry(id: string, role: "user" | "assistant", text: string, parentId?: string): SessionEntry {
  return createSessionEntry({ id, parentId, sessionId: "s1", timestamp, kind: "message", message: { role, content: [{ type: "text", text }] } });
}

function toolEntry(id: string, parentId?: string): SessionEntry {
  return createSessionEntry({ id, parentId, sessionId: "s1", timestamp, kind: "message", message: { role: "tool", content: [{ type: "tool_result", toolCallId: "call-1", name: "read", result: "ok" }] } });
}

test("prepare_llm_compaction_keeps_recent_tokens_and_sets_boundary_data", () => {
  const entries = [
    textEntry("u1", "user", "x".repeat(40)),
    textEntry("a2", "assistant", "x".repeat(40), "u1"),
    textEntry("u3", "user", "x".repeat(40), "a2"),
    textEntry("a4", "assistant", "x".repeat(40), "u3"),
  ];

  const prep = prepareLlmCompaction({ entries, trigger: "manual" }, { keepRecentTokens: 15 });

  assert.deepEqual(prep.entriesToSummarize.map((entry) => entry.id), ["u1", "a2"]);
  assert.deepEqual(prep.entriesToKeep.map((entry) => entry.id), ["u3", "a4"]);
  assert.equal(prep.data.throughEntryId, "a2");
  assert.equal(prep.data.firstKeptEntryId, "u3");
  assert.deepEqual(prep.data.keepEntryIds, ["u3", "a4"]);
  assert.equal(prep.data.trigger, "manual");
  assert.equal(typeof prep.data.estimatedTokensBefore, "number");
  assert.equal(typeof prep.data.estimatedTokensAfter, "number");
});

test("prepare_llm_compaction_does_not_cut_at_tool_result", () => {
  const entries = [
    textEntry("u1", "user", "old"),
    createSessionEntry({ id: "a2", parentId: "u1", sessionId: "s1", timestamp, kind: "message", message: { role: "assistant", content: [{ type: "tool_call", id: "call-1", name: "read", arguments: { path: "src/a.ts" } }] } }),
    toolEntry("t3", "a2"),
  ];

  const prep = prepareLlmCompaction({ entries }, { keepRecentTokens: 1 });

  assert.deepEqual(prep.entriesToKeep.map((entry) => entry.id), ["a2", "t3"]);
  assert.equal(prep.data.throughEntryId, "u1");
});

test("prepare_llm_compaction_uses_previous_summary_on_repeated_compaction", () => {
  const previous = createSessionEntry({
    id: "c3",
    parentId: "a2",
    sessionId: "s1",
    timestamp,
    kind: "compaction",
    summary: "previous summary",
    data: { throughEntryId: "u1", keepEntryIds: ["a2"], firstKeptEntryId: "a2" },
  });
  const entries = [textEntry("u1", "user", "old"), textEntry("a2", "assistant", "kept", "u1"), previous, textEntry("u4", "user", "new", "c3")];

  const prep = prepareLlmCompaction({ entries }, { keepRecentTokens: 1 });

  assert.equal(prep.previousSummary, "previous summary");
  assert.equal(prep.entriesToSummarize[0]?.id, "a2");
});

test("prepare_llm_compaction_detects_split_turn_prefix", () => {
  const entries = [
    textEntry("u1", "user", "old"),
    textEntry("u2", "user", "request " + "x".repeat(400), "u1"),
    textEntry("a3", "assistant", "work " + "x".repeat(400), "u2"),
  ];

  const prep = prepareLlmCompaction({ entries }, { keepRecentTokens: 50 });

  assert.equal(prep.data.isSplitTurn, true);
  assert.deepEqual(prep.turnPrefixEntries.map((entry) => entry.id), ["u2"]);
  assert.deepEqual(prep.entriesToKeep.map((entry) => entry.id), ["a3"]);
});
