import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createHashEmbedder, createMemoryVectorStore, MemoryValidationError } from "@arnilo/prism-memory-core";
import { createMemory, createMemoryFabric, encodeMemoryNoteMetadata, parseMemoryNoteMetadata } from "../index.js";

const REF = "2026-03-15T12:00:00.000Z";

describe("time-scoped recall", () => {
  function harness() {
    const vectorStore = createMemoryVectorStore();
    const memory = createMemory({
      tenantId: "t",
      resourceId: "u",
      threadId: "th",
      embedder: createHashEmbedder({ dimensions: 8 }),
      vectorStore,
    });
    return { fabric: createMemoryFabric({ memory, vectorStore, consolidate: false }), memory };
  }

  it("recall_time_window_filters_and_orders", async () => {
    const { fabric } = harness();
    const january = await fabric.remember({
      kind: "fact",
      content: "checkup january booking",
      dates: [{ text: "in January", resolved: "2026-01-01T00:00:00.000Z", precision: "month" }],
    });
    const february = await fabric.remember({
      kind: "fact",
      content: "checkup february booking",
      dates: [{ text: "last month", resolved: "2026-02-01T00:00:00.000Z", precision: "month" }],
    });
    const march = await fabric.remember({
      kind: "fact",
      content: "checkup march booking",
      dates: [{ text: "last Tuesday", resolved: "2026-03-10T00:00:00.000Z", precision: "day" }],
    });

    const all = await fabric.recall("checkup booking", { kinds: ["fact"], topK: 10 });
    assert.equal(all.hits.length, 3);

    const window = await fabric.recall("checkup booking", {
      kinds: ["fact"],
      topK: 10,
      from: "2026-02-01",
      to: "2026-02-28",
      order: "time",
    });
    assert.deepEqual(
      window.hits.map((hit) => hit.id),
      [february.id],
    );

    const ordered = await fabric.recall("checkup booking", { kinds: ["fact"], topK: 10, order: "time" });
    assert.deepEqual(
      ordered.hits.map((hit) => hit.id),
      [january.id, february.id, march.id],
    );
    assert.equal(ordered.hits[1]!.dates?.[0]?.text, "last month");

    await assert.rejects(() => fabric.recall("checkup", { from: "2026-03-01", to: "2026-02-01" }), MemoryValidationError);
    await assert.rejects(() => fabric.recall("checkup", { order: "newest" as "time" }), MemoryValidationError);
  });


  it("time_window_finds_archived_note_beyond_the_relevance_preload", async () => {
    const { fabric, memory } = harness();
    const entries = Array.from({ length: 40 }, (_, index) => ({
      id: index.toString(16).padStart(12, "0"),
      text: "dentist appointment scheduling dentist appointment scheduling",
      metadata: {
        status: "archived",
        fabric: encodeMemoryNoteMetadata({
          kind: "fact" as const,
          dates: [{ text: "in March", resolved: "2026-03-01T00:00:00.000Z", precision: "month" as const }],
        }),
      },
    }));
    const far = {
      id: "ffffffffffff",
      text: "dentist",
      metadata: {
        status: "archived",
        fabric: encodeMemoryNoteMetadata({
          kind: "fact" as const,
          dates: [{ text: "2020-06-15", resolved: "2020-06-15T00:00:00.000Z", precision: "day" as const }],
        }),
      },
    };
    await memory.remember({ entries: [...entries, far] }, { wait: true });

    const hits = await fabric.recall("dentist appointment scheduling", {
      kinds: ["fact"],
      includeArchived: true,
      topK: 5,
      archiveSearch: true,
      from: "2020-06-01",
      to: "2020-06-30",
    });
    assert.deepEqual(
      hits.hits.map((hit) => hit.id),
      [far.id],
    );
  });

  it("fallback_note_without_dates_uses_tref_in_the_window", async () => {
    const { fabric } = harness();
    const note = await fabric.remember({ kind: "fact", content: "checkup without event date", tRef: "2026-02-14T10:00:00.000Z" });
    const hits = await fabric.recall("checkup event date", { kinds: ["fact"], from: "2026-02-14", to: "2026-02-14" });
    assert.deepEqual(
      hits.hits.map((hit) => hit.id),
      [note.id],
    );
  });

  it("old_reader_preserves_dates_field", () => {
    const dates = [{ text: "yesterday", resolved: "2026-03-14T00:00:00.000Z", precision: "day" }] as const;
    const encoded = encodeMemoryNoteMetadata({ kind: "exchange", tRef: REF, dates, unknown: { futureKey: "kept" } });
    const parsed = parseMemoryNoteMetadata({ fabric: encoded });
    assert.deepEqual(parsed?.dates, dates);
    assert.deepEqual(parsed?.unknown, { futureKey: "kept" });
    const { v: _v, ...fields } = parsed!;
    const rewritten = encodeMemoryNoteMetadata(fields);
    assert.deepEqual(rewritten.dates, dates);
  });
});
