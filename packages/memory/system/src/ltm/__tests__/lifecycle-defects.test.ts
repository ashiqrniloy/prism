import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { ContextDraft, HookContext, Session, SessionEntry } from "@arnilo/prism";
import { createMemoryVectorStore } from "@arnilo/prism-memory-system/core";
import { createFabricContext } from "../context.js";
import { createFabricDirectory, DEFAULT_DIRECTORY_OPTIONS, renderFabricDirectory } from "../directory.js";
import { createLongTermMemory, parseMemoryNoteMetadata } from "../exports.js";
import { createFabricLifecycle } from "../lifecycle/index.js";
import { createMemory } from "../memory.js";

const _DAY = 86_400_000;

function createHashEmbedder() {
  return {
    id: "test-hash",
    dimensions: 8,
    available: () => true,
    embed: async (texts: readonly string[]) =>
      texts.map((text) => {
        const vector = new Array(8).fill(0);
        for (let i = 0; i < text.length; i++) {
          vector[i % 8] = ((vector[i % 8] + text.charCodeAt(i)) % 100) / 100;
        }
        return vector;
      }),
  };
}

function makeMemory(store = createMemoryVectorStore()) {
  return createMemory({
    tenantId: "t",
    resourceId: "r",
    threadId: "s",
    embedder: createHashEmbedder(),
    vectorStore: store,
  });
}

function mockSession(entries: SessionEntry[]): Session {
  return {
    id: "session-test",
    entries: async () => entries,
  } as unknown as Session;
}

describe("Lifecycle defect fixes (D4, D5, D13)", () => {
  it("superseded_reflection_retires_its_note", async () => {
    const memory = makeMemory();
    const lifecycle = createFabricLifecycle(memory);
    const entries: SessionEntry[] = [
      {
        id: "entry-1",
        sessionId: "s",
        kind: "package_state",
        timestamp: "2026-10-18T10:00:00.000Z",
        data: {
          op: "append",
          value: {
            type: "memory.session.wm.recorded",
            items: [
              {
                id: "012345678901",
                kind: "summary",
                text: "Always prefer small retry budget.",
                relevance: "medium",
                citedIds: ["aaaaaaaaaaaa"],
                tokenCount: 5,
              },
            ],
          },
        },
      },
    ];
    const session = mockSession(entries);
    const fabric = createLongTermMemory({ memory, observational: { session } });
    const noteA = await fabric.remember({ kind: "fact", reflectionId: "012345678901" }, { status: "candidate" });

    const result = await lifecycle.handleSupersededReflections(new Set(["012345678901"]));
    assert.equal(result.reconsolidated.length, 0);
    assert.equal(result.supersededNotes.get("012345678901")?.id, noteA.id, "the note is handed to the pass for retirement");
    await lifecycle.retireNote(noteA.id, "2026-10-18T12:00:00.000Z");
    const rowA = await memory.getEntry(noteA.id);
    assert.ok(rowA);
    assert.ok(parseMemoryNoteMetadata(rowA.metadata)?.validTo, "validTo is set on the superseded note");
    assert.ok(!(await fabric.recall("small retry budget", { minSimilarity: 0 })).hits.some((hit) => hit.id === noteA.id));
  });

  it("promotion_keeps_edited_note_and_marks_reconsolidate", async () => {
    const memory = makeMemory();
    const lifecycle = createFabricLifecycle(memory);
    const entries: SessionEntry[] = [
      {
        id: "entry-1",
        sessionId: "s",
        kind: "package_state",
        timestamp: "2026-10-18T10:00:00.000Z",
        data: {
          op: "append",
          value: {
            type: "memory.session.wm.recorded",
            items: [
              {
                id: "012345678901",
                kind: "summary",
                text: "Always prefer small retry budget.",
                relevance: "medium",
                citedIds: ["aaaaaaaaaaaa"],
                tokenCount: 5,
              },
            ],
          },
        },
      },
    ];
    const session = mockSession(entries);
    const fabric = createLongTermMemory({ memory, observational: { session } });
    const noteA = await fabric.remember({ kind: "fact", reflectionId: "012345678901" }, { status: "candidate" });

    // Verify noteA and then edit it (creating correction lineage)
    await lifecycle.verify(noteA.id);
    await memory.correct(noteA.id, "Always prefer small retry budget, specifically 2.");

    const result = await lifecycle.handleSupersededReflections(new Set(["012345678901"]));
    assert.deepEqual(result.reconsolidated, [noteA.id]);

    // Note A must NOT be retired: it was edited after promotion
    const rowA = await memory.getEntry(noteA.id);
    assert.ok(rowA);
    assert.notEqual(rowA.metadata?.status, "retired");
    const metaA = parseMemoryNoteMetadata(rowA.metadata);
    assert.equal(metaA?.validTo, undefined, "validTo not set because note was preserved");
    assert.equal(metaA?.reconsolidate, true, "marked reconsolidate");

    // Census counts it under reconsolidate
    const census = await lifecycle.census();
    assert.equal(census.reconsolidate, 1);
  });

  it("archive_sets_status_not_valid_to_and_as_of_recall_still_sees_it", async () => {
    const memory = makeMemory();
    const fabric = createLongTermMemory({ memory });
    const lifecycle = createFabricLifecycle(memory);

    const note = await fabric.remember({ kind: "fact", content: "Rarely used feature X" }, { status: "candidate" });

    assert.equal(await lifecycle.archive(note.id), true);

    const row = await memory.getEntry(note.id);
    assert.ok(row);
    assert.equal(row.metadata?.status, "archived");
    const meta = parseMemoryNoteMetadata(row.metadata);
    assert.equal(meta?.validTo, undefined, "validTo must not be set on archive");
    assert.ok(meta?.archivedAt, "archivedAt must be set");

    // Active recall only reaches it through archive search: the result is weak, so the archived
    // note is appended and marked (Task 4) instead of being returned as if it were active.
    const activeHits = (await fabric.recall("Rarely used feature X", { minSimilarity: 0 })).hits;
    assert.equal(activeHits.find((h) => h.id === note.id)?.status, "archived");
    const withoutArchiveSearch = (await fabric.recall("Rarely used feature X", { minSimilarity: 0, archiveSearch: false })).hits;
    assert.equal(
      withoutArchiveSearch.some((h) => h.id === note.id),
      false,
      "no archive search, no archived hit",
    );

    // Historical recall (asOf before archivedAt) still sees it as valid
    const pastAsOf = new Date(Date.now() - 60_000);
    const historicalHits = (await fabric.recall("Rarely used feature X", { minSimilarity: 0, asOf: pastAsOf })).hits;
    assert.equal(
      historicalHits.some((h) => h.id === note.id),
      true,
      "historical recall before archivedAt sees it",
    );
  });

  it("archived_note_marked_in_recall_and_excluded_from_inject_and_directory", async () => {
    const memory = makeMemory();
    const fabric = createLongTermMemory({ memory });
    const lifecycle = createFabricLifecycle(memory);

    const note = await fabric.remember({ kind: "fact", content: "Temporary notice 12345", tags: ["notice"] }, { status: "candidate" });
    await lifecycle.archive(note.id);

    // 1) Only through archive search, and marked as archived
    const hits = (await fabric.recall("Temporary notice 12345", { minSimilarity: 0 })).hits;
    assert.equal(hits.find((h) => h.id === note.id)?.status, "archived", "recall marks the archived hit");

    // 2) Excluded from passive context injection
    const projection = createFabricContext(memory, fabric.recall, { topK: 5, minSimilarity: 0 });
    const draft: ContextDraft = { messages: [] };
    const hookCtx = {
      session: {
        id: "session-active",
        entries: async () => [
          {
            id: "msg-1",
            sessionId: "session-active",
            kind: "message",
            timestamp: new Date().toISOString(),
            message: { role: "user", content: [{ type: "text", text: "Temporary notice 12345" }] },
          },
        ],
      },
    } as unknown as HookContext;

    const projected = await projection.build(draft, hookCtx);
    const contextText = JSON.stringify(projected);
    assert.equal(contextText.includes(note.id), false, "excluded from passive context injection");

    // 3) Excluded from renderFabricDirectory
    const directory = createFabricDirectory({ memory });
    const snapshot = await directory.snapshot();
    const rendered = renderFabricDirectory(snapshot, DEFAULT_DIRECTORY_OPTIONS);
    assert.equal(snapshot.counts.fact ?? 0, 0, "directory counts exclude archived note");
    assert.equal(rendered, undefined, "empty directory renders undefined");
  });
});
