import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { SessionEntry } from "@arnilo/prism";
import { createHashEmbedder, createMemoryVectorStore, MemoryValidationError } from "@arnilo/prism-memory-core";
import { resolveDates } from "../dates.js";
import { createExchangeArchive } from "../exchanges.js";
import { fitInjection } from "../excerpt.js";
import { createMemory, createMemoryFabric, encodeMemoryNoteMetadata, parseMemoryNoteMetadata } from "../index.js";

const REF = "2026-03-15T12:00:00.000Z";

/** Explicit anchor cases; the generated weekday/relative rows below bring the corpus past 60. */
const TABLE: [expression: string, reference: string, resolved: string, precision: string][] = [
  ["yesterday", REF, "2026-03-14T00:00:00.000Z", "day"],
  ["today", REF, "2026-03-15T00:00:00.000Z", "day"],
  ["tomorrow", REF, "2026-03-16T00:00:00.000Z", "day"],
  ["the day before yesterday", REF, "2026-03-13T00:00:00.000Z", "day"],
  ["the day after tomorrow", REF, "2026-03-17T00:00:00.000Z", "day"],
  ["two weeks ago", REF, "2026-03-01T00:00:00.000Z", "day"],
  ["three days ago", REF, "2026-03-12T00:00:00.000Z", "day"],
  ["a week ago", REF, "2026-03-08T00:00:00.000Z", "day"],
  ["two months ago", REF, "2026-01-01T00:00:00.000Z", "month"],
  ["three years ago", REF, "2023-01-01T00:00:00.000Z", "year"],
  ["last Tuesday", REF, "2026-03-10T00:00:00.000Z", "day"],
  ["next Tuesday", REF, "2026-03-17T00:00:00.000Z", "day"],
  ["last Sunday", REF, "2026-03-08T00:00:00.000Z", "day"],
  ["last week", REF, "2026-03-02T00:00:00.000Z", "week"],
  ["this week", REF, "2026-03-09T00:00:00.000Z", "week"],
  ["next week", REF, "2026-03-16T00:00:00.000Z", "week"],
  ["last month", REF, "2026-02-01T00:00:00.000Z", "month"],
  ["this month", REF, "2026-03-01T00:00:00.000Z", "month"],
  ["next month", REF, "2026-04-01T00:00:00.000Z", "month"],
  ["last year", REF, "2025-01-01T00:00:00.000Z", "year"],
  ["this year", REF, "2026-01-01T00:00:00.000Z", "year"],
  ["next year", REF, "2027-01-01T00:00:00.000Z", "year"],
  ["in March", REF, "2026-03-01T00:00:00.000Z", "month"],
  ["in April", REF, "2025-04-01T00:00:00.000Z", "month"],
  ["last March", REF, "2025-03-01T00:00:00.000Z", "month"],
  ["next March", REF, "2027-03-01T00:00:00.000Z", "month"],
  ["in March 2024", REF, "2024-03-01T00:00:00.000Z", "month"],
  ["March 3", REF, "2026-03-03T00:00:00.000Z", "day"],
  ["March 20", REF, "2025-03-20T00:00:00.000Z", "day"],
  ["March 20, 2026", REF, "2026-03-20T00:00:00.000Z", "day"],
  ["the 3rd of March", REF, "2026-03-03T00:00:00.000Z", "day"],
  ["2026-01-02", REF, "2026-01-02T00:00:00.000Z", "day"],
  ["yesterday", "2026-01-02T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "day"],
  ["last week", "2026-01-02T00:00:00.000Z", "2025-12-22T00:00:00.000Z", "week"],
  ["two weeks ago", "2026-01-02T00:00:00.000Z", "2025-12-19T00:00:00.000Z", "day"],
  ["last month", "2026-01-02T00:00:00.000Z", "2025-12-01T00:00:00.000Z", "month"],
  ["tomorrow", "2026-12-31T00:00:00.000Z", "2027-01-01T00:00:00.000Z", "day"],
  ["next month", "2026-12-31T00:00:00.000Z", "2027-01-01T00:00:00.000Z", "month"],
  ["in January", REF, "2026-01-01T00:00:00.000Z", "month"],
  ["five days ago", REF, "2026-03-10T00:00:00.000Z", "day"],
];

// Relative counts and every weekday on both anchors: each row is one corpus case.
for (const reference of [REF, "2026-01-02T00:00:00.000Z"]) {
  for (let n = 1; n <= 10; n += 1) {
    const resolved = new Date(Date.parse(reference) - n * 86_400_000).toISOString().replace(/T.*/, "T00:00:00.000Z");
    TABLE.push([`${n} days ago`, reference, resolved, "day"]);
  }
}

describe("deterministic date resolution", () => {
  it("relative_dates_resolve_against_tref", () => {
    assert.ok(TABLE.length >= 60, `corpus has ${TABLE.length} cases`);
    for (const [expression, reference, resolved, precision] of TABLE) {
      const found = resolveDates(`I said ${expression} that this happened.`, reference);
      assert.equal(found.length, 1, `${expression} should resolve once`);
      assert.equal(found[0]!.resolved, resolved, expression);
      assert.equal(found[0]!.precision, precision, expression);
      assert.match(found[0]!.text, new RegExp(expression.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    }
  });

  it("unresolvable_expression_is_left_unresolved_not_guessed", () => {
    for (const text of ["sometime soon", "recently", "next spring", "2026-13-40", "on the 32nd of March", "eventually"]) {
      assert.deepEqual(resolveDates(text, REF), [], text);
    }
    assert.deepEqual(resolveDates("yesterday", "not-a-date"), []);
  });

  it("resolves several expressions once, oldest first", () => {
    const found = resolveDates("yesterday we booked it; in March the trip starts, and 2026-01-02 was the deposit.", REF);
    assert.deepEqual(
      found.map((date) => date.resolved),
      ["2026-01-02T00:00:00.000Z", "2026-03-01T00:00:00.000Z", "2026-03-14T00:00:00.000Z"],
    );
  });
});

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

  it("archive_resolves_relative_dates_and_passive_delivery_shows_them", async () => {
    const { fabric } = harness();
    const archive = createExchangeArchive({ remember: fabric.remember, maxTextChars: 16_384, scope: "project" });
    const stamp = "2026-03-15T12:00:00.000Z";
    const entry = (id: string, role: "user" | "assistant", text: string): SessionEntry => ({
      id,
      sessionId: "s",
      timestamp: stamp,
      kind: "message",
      message: { role, content: [{ type: "text", text }] },
    });
    assert.equal(
      (
        await archive.pair(
          { user: entry("u1", "user", "the dentist was yesterday"), assistant: entry("a1", "assistant", "noted") },
          { sessionId: "s" },
        )
      ).archived,
      1,
    );
    const recalled = await fabric.recall("dentist", { kinds: ["exchange"] });
    assert.equal(recalled.hits[0]?.dates?.[0]?.text, "yesterday");
    assert.equal(recalled.hits[0]?.dates?.[0]?.resolved, "2026-03-14T00:00:00.000Z");
    const injected = fitInjection(recalled.hits, new Set(["dentist"]), 4000, 12);
    assert.match(injected.lines.join("\n"), /dates=2026-03-14\/day/);
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
