/**
 * Plan 188.4 Task 4: archiving needs both strengths low and a grace window of scope sessions,
 * never sets `validTo`, stays searchable, and a later citation revives the note.
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createMemoryVectorStore } from "@arnilo/prism-memory-core";
import { createMemoryFabric } from "../../create.js";
import { parseMemoryNoteMetadata } from "../../index.js";
import { createFabricLifecycle } from "../index.js";
import { DEFAULT_ARCHIVE_CONFIG, shouldArchive } from "../archive.js";
import { storageStrength } from "../index.js";
import { createMemory } from "../../memory.js";
import type { MemoryNoteMetadata, MemoryNoteUseEvent } from "../../types.js";

const AT = "2026-01-01T00:00:00.000Z";

function makeMemory(options: { readonly embedder?: boolean } = {}) {
  const store = createMemoryVectorStore();
  const memory = createMemory({
    tenantId: "t",
    resourceId: "r",
    threadId: "s",
    ...(options.embedder !== true ? {} : { embedder: {
      id: "test-hash",
      dimensions: 8,
      available: () => true,
      embed: async (texts: readonly string[]) =>
        texts.map((text) => {
          const vector = new Array(8).fill(0);
          for (let i = 0; i < text.length; i++) vector[i % 8] = ((vector[i % 8] + text.charCodeAt(i)) % 100) / 100;
          return vector;
        }),
    } }),
    vectorStore: store,
  });
  return { store, memory };
}

async function advance(store: ReturnType<typeof createMemoryVectorStore>, sessions: number): Promise<void> {
  for (let index = 0; index < sessions; index += 1) {
    await store.scopeCounter.increment({ tenantId: "t", resourceId: "r", name: "sessions" });
  }
}

function note(fields: Partial<MemoryNoteMetadata> = {}): MemoryNoteMetadata {
  return { v: 1, kind: "fact", ...fields };
}

function use(s: number): MemoryNoteUseEvent {
  return { s, at: AT };
}

describe("shouldArchive (plan 188.4 Task 4)", () => {
  it("archive_requires_low_r_and_low_s_and_grace", () => {
    // One use long ago: R ≈ −2.4 at 500 sessions, S = 0, creation 0 → archived.
    const stale = note({ uses: [use(0)], useSessions: 1 });
    assert.equal(shouldArchive(stale, 500), true);
    assert.ok(DEFAULT_ARCHIVE_CONFIG.retrievalBelow < 0);
    // Grace: both strengths are low, but the note is younger than the window.
    const young = note({ uses: [use(0)], useSessions: 1, created: 500 });
    assert.equal(shouldArchive(young, 505), false, "5 sessions old is inside the grace window");
    assert.equal(shouldArchive(young, 510), true, "10 sessions old is past it");
    // Fresh use: R is high, so nothing archives however old the note is.
    assert.equal(shouldArchive(note({ uses: [use(499)], useSessions: 1, created: 0 }), 500), false);
    // A note with no use at all still needs the same grace window.
    assert.equal(shouldArchive(note({ created: 0 }), 5), false);
  });

  it("high_storage_note_is_never_archived_by_decay", () => {
    const promoted = note({ uses: [use(0)], useSessions: 1, promotion: { score: 1, signals: { explicit: 1 }, pass: "p1" } });
    assert.ok(storageStrength(promoted) >= DEFAULT_ARCHIVE_CONFIG.storageBelow);
    assert.equal(shouldArchive(promoted, 5_000), false, "explicit evidence keeps an unused note");
    const reinforced = note({ uses: [use(0)], useSessions: 6, helpful: 3, promotion: { score: 1, signals: { explicit: 1, outcome: 1 }, pass: "p1" } });
    assert.equal(shouldArchive(reinforced, 5_000), false);
    // Same note without the evidence is archived: the two strengths are what differ.
    assert.equal(shouldArchive(note({ uses: [use(0)], useSessions: 1 }), 5_000), true);
  });

  it("pinned_or_held_note_is_never_archived", async () => {
    assert.equal(shouldArchive(note({ uses: [use(0)], pinned: true }), 5_000), false);
    // Legal hold is the store's business: a held row never reaches a scan, so maintain leaves it alone.
    const { store, memory } = makeMemory();
    const fabric = createMemoryFabric({ memory, vectorStore: store, consolidate: false });
    const noteHit = await fabric.remember({ kind: "fact", content: "held deploy doctrine" });
    await fabric.forget({ id: noteHit.id, hold: true });
    await advance(store, 200);
    assert.equal((await fabric.maintain()).archived, 0);
    assert.equal((await memory.getEntry(noteHit.id))?.metadata?.status, undefined, "a held note keeps its status");
  });

  it("maintain_archives_only_what_the_rule_selects", async () => {
    const { store, memory } = makeMemory();
    let ordinal = 0;
    const fabric = createMemoryFabric({ memory, vectorStore: store, consolidate: false, clock: () => ordinal });
    const stale = await fabric.remember({ kind: "fact", content: "old rollback ritual" });
    const pinned = await fabric.remember({ kind: "fact", content: "pinned rollback ritual" });
    assert.equal(await fabric.pin(pinned.id), true);
    ordinal = 200;
    const recent = await fabric.remember({ kind: "fact", content: "fresh rollback ritual" });
    await advance(store, 200);

    assert.deepEqual(await fabric.maintain(), {
      archived: 1,
      merged: 0,
      episodesMerged: 0,
      evicted: 0,
      overBudget: [],
    });
    const archivedRow = await memory.getEntry(stale.id);
    assert.equal(archivedRow?.metadata?.status, "archived");
    assert.equal(parseMemoryNoteMetadata(archivedRow?.metadata)?.validTo, undefined, "archive never sets validTo");
    assert.ok(parseMemoryNoteMetadata(archivedRow?.metadata)?.archivedAt);
    assert.equal(parseMemoryNoteMetadata(archivedRow?.metadata)?.archivedFrom, "verified");
    assert.equal((await memory.getEntry(pinned.id))?.metadata?.status, undefined, "a pinned note is exempt");
    // A note younger than the grace window is untouched: `created` is the current ordinal.
    assert.equal((await memory.getEntry(recent.id))?.metadata?.status, undefined, "ten sessions of grace");
  });

  it("archive_never_sets_valid_to", async () => {
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({ memory, consolidate: false });
    const hit = await fabric.remember({ kind: "fact", content: "superseded only by lineage" });
    const lifecycle = createFabricLifecycle(memory);
    assert.equal(await lifecycle.archive(hit.id), true);
    const metadata = (await memory.getEntry(hit.id))?.metadata;
    assert.equal(metadata?.status, "archived");
    assert.equal(parseMemoryNoteMetadata(metadata)?.validTo, undefined);
    assert.equal(parseMemoryNoteMetadata(metadata)?.archivedFrom, "verified");
    // Archiving twice is a no-op, and a retired note is not archivable.
    assert.equal(await lifecycle.archive(hit.id), false);
  });
});

describe("archive search and revival (plan 188.4 Task 4)", () => {
  it("weak_active_result_appends_marked_archived_hits", async () => {
    // Lexical mode reports coverage, which is what the 0.34 weak-result rule is written against.
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({ memory, consolidate: false });
    const archived = await fabric.remember({ kind: "fact", content: "rollback build steps for the release" });
    const active = await fabric.remember({ kind: "fact", content: "release build uses tsc --build" });
    await createFabricLifecycle(memory).archive(archived.id);

    // A strong active hit keeps archived notes out of the way.
    const strong = await fabric.recall("build", { minSimilarity: 0, topK: 3 });
    assert.deepEqual(strong.hits.map((hit) => hit.id), [active.id]);

    // A weak result appends the archived note, after the active hits and marked by its status.
    const weak = await fabric.recall("rollback", { minSimilarity: 0, topK: 3 });
    assert.deepEqual(weak.hits.map((hit) => hit.id), [archived.id]);
    assert.equal(weak.hits[0]?.status, "archived");

    // The explicit flag searches both regardless of how strong the active hit is.
    const both = await fabric.recall("build", { minSimilarity: 0, topK: 3, includeArchived: true });
    assert.deepEqual(both.hits.map((hit) => hit.id), [active.id, archived.id]);
    assert.equal(both.hits[1]?.status, "archived");

    // Passive injection never asks for archived notes: the default path leaves them out.
    assert.equal((await fabric.recall("build", { minSimilarity: 0 })).hits.some((hit) => hit.status === "archived"), false);
  });

  it("citing_archived_note_revives_it_and_logs", async () => {
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({ memory, consolidate: false });
    const hit = await fabric.remember({ kind: "fact", content: "revived fact" });
    const lifecycle = createFabricLifecycle(memory);
    await lifecycle.archive(hit.id);

    // The citation arrives through archive search, so the use is recorded with the scope ordinal.
    assert.deepEqual(await lifecycle.recordUses("s9", [hit.id], { clock: 120 }), [], "revival is not a promotion");
    const record = await memory.getEntry(hit.id);
    const metadata = parseMemoryNoteMetadata(record?.metadata);
    assert.equal(record?.metadata?.status, "verified", "the pre-archive status comes back");
    assert.equal(metadata?.archivedAt, undefined);
    assert.equal(metadata?.archivedFrom, undefined);
    assert.equal(metadata?.useSessions, 1, "the revival counts as a use session");
    assert.equal(metadata?.uses?.[0]?.s, 120, "the use log resets R at the current ordinal");
    assert.equal(record?.metadata?.auditVerb, "revived", "the markdown audit line names the revival");
    assert.ok(storageStrength(metadata!) > 0);
    // One session never counts twice, so nothing else changes.
    assert.deepEqual(await lifecycle.recordUses("s9", [hit.id], { clock: 121 }), []);
    assert.equal(parseMemoryNoteMetadata((await memory.getEntry(hit.id))?.metadata)?.useSessions, 1);
  });
});
