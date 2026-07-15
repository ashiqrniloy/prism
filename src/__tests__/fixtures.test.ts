import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createJsonlSessionStore, readJsonlSessionEntries } from "../node/session-store-jsonl.js";
import { rebuildSessionContext, getSessionBranchEntries, listSessionBranches } from "../session-stores.js";
import type { SessionEntry } from "../contracts.js";

const fixturesDir = "examples/fixtures";

test("branching_fixture_yields_two_branches_from_a_shared_root", async () => {
  const { entries } = await readJsonlSessionEntries(`${fixturesDir}/branching.jsonl`);
  assert.equal(entries.length, 3);
  const branches = listSessionBranches(entries);
  assert.equal(branches.length, 2);
  assert.deepEqual(
    branches.map((b) => b.leafId).sort(),
    ["b2", "b3"],
  );
  // Both leaves share the root as their parent.
  for (const leaf of ["b2", "b3"]) {
    const leafEntry = entries.find((e) => e.id === leaf);
    assert.equal(leafEntry?.parentId, "b1");
  }
  assert.equal(getSessionBranchEntries(entries).length, 2, "default branch is one leaf path, not all entries");
});

test("compaction_fixture_appends_a_compaction_entry_with_summary_and_data", async () => {
  const { entries } = await readJsonlSessionEntries(`${fixturesDir}/compaction.jsonl`);
  const compaction = entries.find((e) => e.kind === "compaction");
  assert.ok(compaction, "expected a compaction entry");
  assert.equal(typeof compaction?.summary, "string");
  assert.ok(compaction?.summary && compaction.summary.length > 0);
  assert.equal(typeof (compaction?.data as Record<string, unknown> | undefined)?.droppedEntryIds, "object");
  // Compaction entry is the leaf: its parentId is the last message.
  const lastMessage = entries.filter((e) => e.kind === "message").at(-1);
  assert.equal(compaction?.parentId, lastMessage?.id);
  const snapshot = rebuildSessionContext(entries);
  assert.equal(snapshot.leafId, compaction?.id);
});

test("llm_summary_fixture_carries_provider_and_turn_prefix_metadata", async () => {
  const { entries } = await readJsonlSessionEntries(`${fixturesDir}/llm-summary.jsonl`);
  const summary = entries.find((e) => e.kind === "compaction");
  assert.ok(summary, "expected a compaction entry");
  const data = summary?.data as Record<string, unknown> | undefined;
  assert.equal(data?.provider, "mock");
  assert.equal(data?.model, "summary");
  assert.equal(data?.includeFileOperations, true);
  assert.ok(typeof summary?.summary === "string" && summary.summary.includes("Turn prefix"));
});

test("observational_memory_ledger_records_observations_reflections_and_drops", async () => {
  const { entries } = await readJsonlSessionEntries(`${fixturesDir}/observational-memory-ledger.jsonl`);
  const customs = entries.filter((e) => e.kind === "custom");
  assert.equal(customs.length, 3);
  const types = customs.map((c) => (c.data as { type: string }).type);
  assert.deepEqual(types, ["observations_recorded", "reflections_recorded", "observations_dropped"]);
  const observations = (customs[0].data as { observations: { id: string }[] }).observations;
  assert.equal(observations[0].id.length, 12, "observation id must be 12 hex chars");
  const reflections = (customs[1].data as { reflections: { id: string; supportingObservationIds: string[] }[] }).reflections;
  assert.deepEqual(reflections[0].supportingObservationIds, [observations[0].id]);
  const dropped = (customs[2].data as { observationIds: string[] }).observationIds;
  assert.equal(dropped.length, 1);
});

test("tool_result_replay_fixture_pairs_tool_call_with_tool_result", async () => {
  const { entries } = await readJsonlSessionEntries(`${fixturesDir}/tool-result-replay.jsonl`);
  const snapshot = rebuildSessionContext(entries);
  // Reassembled messages alternate user, assistant(tool_call), user(tool_result), assistant(text).
  const roles = snapshot.messages.map((m) => m.role);
  assert.deepEqual(roles, ["user", "assistant", "user", "assistant"]);
  const toolCall = snapshot.messages[1].content.find((b) => b.type === "tool_call");
  const toolResult = snapshot.messages[2].content.find((b) => b.type === "tool_result");
  assert.ok(toolCall && "id" in toolCall, "expected a tool_call block");
  assert.ok(toolResult && "toolCallId" in toolResult, "expected a tool_result block");
  // The result correlates to the call by toolCallId.
  assert.equal((toolResult as { toolCallId: string }).toolCallId, (toolCall as { id: string }).id);
});

test("corrupt_fixture_is_quarantined_fail_closed", async () => {
  const { entries, errors } = await readJsonlSessionEntries(`${fixturesDir}/corrupt.jsonl`);
  // Exactly one entry (the first, well-formed context line) survives; every
  // other line is rejected into errors[].
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "x1");
  assert.ok(errors.length >= 10, `expected at least 10 parse errors, got ${errors.length}`);
  // list() only returns the surviving valid entry; corrupt lines never surface.
  const store = createJsonlSessionStore({ path: `${fixturesDir}/corrupt.jsonl`, createDirectory: false });
  const listed = await store.list("s1");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, "x1");
  // Every error carries a line number and a message.
  for (const err of errors) {
    assert.ok(typeof err.line === "number" && err.line > 0);
    assert.ok(typeof err.message === "string" && err.message.length > 0);
  }
  // Append is fail-closed when the backing file still has parse errors.
  const dup: SessionEntry = { ...entries[0] };
  await assert.rejects(() => store.append(dup), /Invalid JSONL at line/);
});

test("no_fixture_file_contains_a_real_looking_secret", async () => {
  const secret = /(?:sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,})/;
  for (const file of readdirSync(fixturesDir)) {
    if (!file.endsWith(".jsonl")) continue;
    const text = readFileSync(`${fixturesDir}/${file}`, "utf8");
    assert.ok(!secret.test(text), `${file} contains a real-looking secret`);
  }
});
