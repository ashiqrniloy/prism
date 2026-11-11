/** The use log and the counters it feeds (plan 188.4 Task 1). */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { ToolExecutionContext } from "@arnilo/prism";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory-system/core";
import { createFabricCitationTracker } from "../../context.js";
import { createFabricLifecycle } from "../../lifecycle/index.js";
import { appendUseEvent, MAX_USE_EVENTS, readUseEvents } from "../../lifecycle/events.js";
import { createLongTermMemory } from "../../create.js";
import { createMemory } from "../../memory.js";
import { createLongTermMemoryTools } from "../../tools.js";
import { parseMemoryNoteMetadata } from "../../types.js";

function makeMemory() {
  return createMemory({
    tenantId: "t",
    resourceId: "r",
    threadId: "s",
    embedder: createHashEmbedder({ dimensions: 8 }),
    vectorStore: createMemoryVectorStore(),
  });
}

const context = (sessionId: string): ToolExecutionContext => ({ toolCallId: "call-1", sessionId, runId: "run-1" });

describe("the use log", () => {
  it("keeps the last 32 uses and holds one entry per use", () => {
    let uses: ReturnType<typeof appendUseEvent> = [];
    for (let ordinal = 0; ordinal < MAX_USE_EVENTS + 8; ordinal++) {
      uses = appendUseEvent(uses, { s: ordinal, at: new Date(ordinal).toISOString() });
    }
    assert.equal(uses.length, MAX_USE_EVENTS);
    assert.equal(uses[0]?.s, 8, "the oldest events are dropped, not the newest");
    assert.equal(uses.at(-1)?.s, MAX_USE_EVENTS + 7);
    assert.deepEqual(readUseEvents(JSON.parse(JSON.stringify(uses))), uses);
  });

  it("fails closed on a malformed log", () => {
    assert.equal(readUseEvents([{ s: -1, at: "2026-01-01T00:00:00.000Z" }]), undefined);
    assert.equal(readUseEvents([{ s: 1, at: "not a date" }]), undefined);
    assert.equal(readUseEvents([{ s: 1 }]), undefined);
    assert.equal(readUseEvents("nope"), undefined);
  });
});

describe("lifecycle counters", () => {
  it("retrieval_without_citation_changes_no_lifecycle_field_but_retrievals", async () => {
    const memory = makeMemory();
    const fabric = createLongTermMemory({ memory, consolidate: false });
    const tracker = createFabricCitationTracker();
    const tools = createLongTermMemoryTools({
      memory,
      remember: fabric.remember,
      recall: fabric.recall,
      forget: fabric.forget,
      tracker,
    })();
    const note = await fabric.remember({ kind: "fact", content: "Canary rollouts reduce blast radius" }, { status: "candidate" });
    const recallTool = tools.find((tool) => tool.name === "memory.recall")!;

    await recallTool.execute({ query: "blast radius" }, context("session-1"));
    await recallTool.execute({ query: "canary rollouts" }, context("session-1"));
    assert.deepEqual(tracker.cited("session-1"), [], "a shown id nobody cited is not a use");

    const retrievals = tracker.takeRetrievals("session-1");
    assert.equal(retrievals[note.id], 2, "each return is one retrieval");
    await createFabricLifecycle(memory).recordRetrievals(retrievals);

    const meta = parseMemoryNoteMetadata((await memory.getEntry(note.id))?.metadata);
    assert.equal(meta?.retrievals, 2);
    assert.equal(meta?.useSessions, undefined, "no use was recorded");
    assert.equal(meta?.uses, undefined, "the use log stays empty");
    assert.equal(meta?.lastSession, undefined);
    assert.equal(meta?.helpful, undefined);
    assert.equal(meta?.harmful, undefined);
    assert.equal((await memory.getEntry(note.id))?.metadata?.status, "candidate");
  });

  it("use_counts_once_per_session_and_verifies_at_two_sessions", async () => {
    const memory = makeMemory();
    const fabric = createLongTermMemory({ memory, consolidate: false });
    const lifecycle = createFabricLifecycle(memory);
    const note = await fabric.remember({ kind: "fact", content: "Postgres pool size defaults to 10" }, { status: "candidate" });

    assert.deepEqual(await lifecycle.recordUses("session-1", [note.id], { clock: 1 }), []);
    assert.deepEqual(await lifecycle.recordUses("session-1", [note.id], { clock: 1 }), [], "one session counts once");
    let meta = parseMemoryNoteMetadata((await memory.getEntry(note.id))?.metadata);
    assert.equal(meta?.useSessions, 1);
    assert.deepEqual(meta?.uses, [{ s: 1, at: meta!.uses![0]!.at }], "one logged use");
    assert.equal((await memory.getEntry(note.id))?.metadata?.status, "candidate");

    assert.deepEqual(await lifecycle.recordUses("session-2", [note.id], { clock: 2 }), [note.id]);
    meta = parseMemoryNoteMetadata((await memory.getEntry(note.id))?.metadata);
    assert.equal(meta?.useSessions, 2);
    assert.deepEqual(
      meta?.uses?.map((use) => use.s),
      [1, 2],
    );
    assert.equal((await memory.getEntry(note.id))?.metadata?.status, "verified");

    assert.deepEqual(await lifecycle.recordUses("session-3", [note.id], { clock: 3 }), [], "a verified note is not re-verified");
    meta = parseMemoryNoteMetadata((await memory.getEntry(note.id))?.metadata);
    assert.equal(meta?.useSessions, 3, "later uses still accumulate for retrieval strength");
  });

  it("harmful_evidence_blocks_verification_until_a_correction_is_reconsolidated", async () => {
    const memory = makeMemory();
    const fabric = createLongTermMemory({ memory, consolidate: false });
    const lifecycle = createFabricLifecycle(memory);
    const note = await fabric.remember({ kind: "fact", content: "SSH listens on port 22" }, { status: "candidate" });
    await lifecycle.recordEvidence({ harmful: [note.id] });
    await lifecycle.recordUses("session-1", [note.id], { clock: 1 });
    await lifecycle.recordUses("session-2", [note.id], { clock: 2 });
    const row = await memory.getEntry(note.id);
    assert.equal(row?.metadata?.status, "candidate", "harmful evidence blocks verification");
    assert.equal(parseMemoryNoteMetadata(row?.metadata)?.reconsolidate, true);
  });

  it("helpful_evidence_accumulates_without_verifying", async () => {
    const memory = makeMemory();
    const fabric = createLongTermMemory({ memory, consolidate: false });
    const lifecycle = createFabricLifecycle(memory);
    const note = await fabric.remember({ kind: "fact", content: "Deploys use canaries" }, { status: "candidate" });
    assert.deepEqual(await lifecycle.recordEvidence({ helpful: [note.id] }), { helpful: 1, harmful: 0 });
    const meta = parseMemoryNoteMetadata((await memory.getEntry(note.id))?.metadata);
    assert.equal(meta?.helpful, 1);
    assert.equal((await memory.getEntry(note.id))?.metadata?.status, "candidate");
  });
});
