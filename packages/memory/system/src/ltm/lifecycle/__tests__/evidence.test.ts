/** Citation evidence: outcome tags and user corrections (plan 188.4 Task 1). */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createSessionEntry, type SessionEntry } from "@arnilo/prism";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory-system/core";
import { createLongTermMemory } from "../../create.js";
import { citationEvidence } from "../../lifecycle/evidence.js";
import { createFabricLifecycle } from "../../lifecycle/index.js";
import { createMemory } from "../../memory.js";
import { parseMemoryNoteMetadata } from "../../types.js";

const AT = "2026-10-19T10:00:00.000Z";
const NOTE_ID = "0123456789ab";

function entry(id: string, runId: string, kind: "user" | "assistant" | "tool_call" | "tool_result", text: string): SessionEntry {
  if (kind === "user" || kind === "assistant") {
    return createSessionEntry({
      id,
      sessionId: "s1",
      timestamp: AT,
      runId,
      kind: "message",
      message: { role: kind, content: [{ type: "text", text }] },
    });
  }
  if (kind === "tool_call") {
    return createSessionEntry({
      id,
      sessionId: "s1",
      timestamp: AT,
      runId,
      kind: "message",
      message: {
        role: "assistant",
        content: [{ type: "tool_call", id: "call-1", name: "bash", arguments: { command: text } }],
      },
    });
  }
  return createSessionEntry({
    id,
    sessionId: "s1",
    timestamp: AT,
    runId,
    kind: "message",
    message: { role: "tool", content: [{ type: "tool_result", toolCallId: "call-1", name: "bash", result: { ok: true } }] },
  });
}

function makeMemory() {
  return createMemory({
    tenantId: "t",
    resourceId: "r",
    threadId: "s",
    embedder: createHashEmbedder({ dimensions: 8 }),
    vectorStore: createMemoryVectorStore(),
  });
}

describe("citation evidence", () => {
  it("outcome_after_citation_counts_helpful", () => {
    const entries = [
      entry("u1", "run-1", "user", "Always run bun test with a timeout."),
      entry("c1", "run-1", "tool_call", "bun test"),
      entry("t1", "run-1", "tool_result", ""),
    ];
    const evidence = citationEvidence({ entries, cited: [NOTE_ID] });
    assert.deepEqual(evidence.helpful, [NOTE_ID], "a successful outcome in the citing run credits the note");
    assert.deepEqual(evidence.harmful, []);
    assert.equal(evidence.cursor, "t1");
  });

  it("no_outcome_credits_nothing", () => {
    const entries = [entry("u1", "run-1", "user", "Always run bun test with a timeout.")];
    assert.deepEqual(citationEvidence({ entries, cited: [NOTE_ID] }).helpful, []);
  });

  it("a_credited_note_is_not_credited_twice_in_one_session", () => {
    const entries = [
      entry("u1", "run-1", "user", "Always run bun test with a timeout."),
      entry("c1", "run-1", "tool_call", "bun test"),
      entry("t1", "run-1", "tool_result", ""),
    ];
    const first = citationEvidence({ entries, cited: [NOTE_ID] });
    const second = citationEvidence({
      entries: [...entries, entry("u2", "run-2", "user", "Always run bun test.")],
      cited: [NOTE_ID],
      helped: new Set(first.helpful),
      cursor: first.cursor,
    });
    assert.deepEqual(second.helpful, []);
  });

  it("user_correction_citing_note_counts_harmful_and_reopens_the_note", async () => {
    const entries = [
      entry("a1", "run-1", "assistant", `The pool size is 10 [${NOTE_ID}].`),
      entry("u2", "run-2", "user", "No, that's wrong: the pool size is 25 instead."),
    ];
    const evidence = citationEvidence({ entries, cited: [NOTE_ID] });
    assert.deepEqual(evidence.harmful, [NOTE_ID], "a correction that cites the note is harmful evidence");
    assert.deepEqual(evidence.helpful, []);

    const memory = makeMemory();
    const fabric = createLongTermMemory({ memory, consolidate: false });
    const lifecycle = createFabricLifecycle(memory);
    const note = await fabric.remember({ kind: "fact", id: NOTE_ID, content: "Postgres pool size defaults to 10" });
    assert.equal((await memory.getEntry(NOTE_ID))?.metadata?.status, undefined, "absent status means verified");

    assert.deepEqual(await lifecycle.recordEvidence({ harmful: evidence.harmful }), { helpful: 0, harmful: 1 });
    const row = await memory.getEntry(NOTE_ID);
    const meta = parseMemoryNoteMetadata(row?.metadata);
    assert.equal(meta?.harmful, 1);
    assert.equal(meta?.reconsolidate, true, "the note is reopened for reconsolidation");
    assert.equal(row?.metadata?.status, "candidate", "a corrected verified note returns to candidate");

    // The note now needs a re-extraction, so uses alone cannot re-verify it.
    await lifecycle.recordUses("session-2", [NOTE_ID], { clock: 2 });
    await lifecycle.recordUses("session-3", [NOTE_ID], { clock: 3 });
    assert.equal((await memory.getEntry(NOTE_ID))?.metadata?.status, "candidate");
    assert.equal(note.id, NOTE_ID);
  });

  it("invented_ids_are_never_evidence_for_a_correction", () => {
    const entries = [entry("a1", "run-1", "assistant", "I am citing [aaaaaaaaaaaa]."), entry("u2", "run-2", "user", "No, that's wrong.")];
    assert.deepEqual(citationEvidence({ entries, cited: [NOTE_ID] }).harmful, [], "only an id the session was shown counts");
  });
});
