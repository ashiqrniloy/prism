/**
 * Plan 188.4 Task 5: duplicate merging is deterministic grouping, and the survivor inherits the evidence the others
 * carried. Episode-cluster merging was removed with the episode view (plan 216 Task 7).
 */

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createMemoryVectorStore } from "@arnilo/prism-memory-system/core";
import { resolveLifecycleConfig } from "../../config.js";
import { createLongTermMemory } from "../../create.js";
import { createMemory } from "../../memory.js";
import type { MemoryNoteMetadata } from "../../types.js";
import { encodeMemoryNoteMetadata, parseMemoryNoteMetadata } from "../../types.js";
import type { CapacityNote } from "../capacity.js";
import { duplicateGroups, mergedMetadata } from "../merge.js";

function capacityNote(id: string, fields: Partial<Omit<MemoryNoteMetadata, "v">>, text: string): CapacityNote {
  return { id, metadata: { v: 1, kind: "fact", ...fields }, status: "verified", text, tokens: 1 };
}

function makeMemory() {
  const store = createMemoryVectorStore();
  const memory = createMemory({ tenantId: "t", resourceId: "r", threadId: "s", vectorStore: store });
  return { store, memory };
}

async function writeEpisodes(memory: ReturnType<typeof createMemory>, count: number, key: string): Promise<readonly string[]> {
  const ids = Array.from({ length: count }, (_value, index) => `${index}`.padStart(12, "0"));
  await memory.remember(
    {
      entries: ids.map((id, index) => ({
        id,
        text: `Canary drain episode ${index}: drain the pool before the rollback`,
        createdAt: "2026-01-01T00:00:00.000Z",
        metadata: { fabric: encodeMemoryNoteMetadata({ kind: "episode", key, scope: "project", created: 0 }), status: "candidate" },
      })),
    },
    { wait: true },
  );
  return ids;
}

describe("capacity merging (plan 188.4 Task 5)", () => {
  it("duplicate_groups_use_the_key_then_dice", () => {
    const keyed = [
      capacityNote("aaaaaaaaaaaa", { key: "drain.order" }, "Drain the canary pool before rollback"),
      capacityNote("bbbbbbbbbbbb", { key: "drain.order" }, "Drain the canary pool first, then roll back"),
    ];
    const similar = [
      capacityNote("cccccccccccc", {}, "Bun runs the test suite with a timeout"),
      capacityNote("dddddddddddd", {}, "Run bun with a timeout for the test suite"),
    ];
    const alone = capacityNote("eeeeeeeeeeee", {}, "The release gate reads budgets.json");
    const groups = duplicateGroups([...keyed, ...similar, alone]);
    assert.equal(groups.length, 2);
    // Pass 1 is by key, whatever the text says; the survivor is the stronger note, then the lower id.
    assert.deepEqual(
      groups[0]!.others.map((note) => note.id),
      ["bbbbbbbbbbbb"],
      "the higher id folds into the lower one on a strength tie",
    );
    assert.ok(groups.some((group) => group.survivor.id === "cccccccccccc" && group.others[0]?.id === "dddddddddddd"));
    assert.equal(groups.flatMap((group) => [group.survivor.id, ...group.others.map((note) => note.id)]).includes(alone.id), false);
    // A pinned note is never an input: a merge archives the loser.
    assert.deepEqual(
      duplicateGroups([capacityNote("ffffffffffff", { key: "k", pinned: true }, "x"), capacityNote("111111111111", { key: "k" }, "x")]),
      [],
    );
  });

  it("merged_metadata_unions_and_sums", () => {
    const survivor = capacityNote(
      "aaaaaaaaaaaa",
      {
        keywords: ["canary"],
        tags: ["release"],
        sourceEntryIds: ["e1"],
        uses: [{ s: 4, at: "2026-01-01T00:00:00.000Z" }],
        useSessions: 1,
        helpful: 1,
      },
      "Drain the pool",
    );
    const other = capacityNote(
      "bbbbbbbbbbbb",
      {
        keywords: ["pool"],
        tags: ["canary"],
        sourceEntryIds: ["e2", "e1"],
        uses: [{ s: 2, at: "2026-01-01T00:00:00.000Z" }],
        useSessions: 3,
        harmful: 2,
        retrievals: 5,
        lastSession: "s1",
      },
      "Drain the pool first",
    );
    const merged = mergedMetadata(survivor.metadata, [other.metadata]);
    assert.deepEqual([...(merged.keywords ?? [])], ["canary", "pool"]);
    assert.deepEqual([...(merged.tags ?? [])], ["release", "canary"]);
    assert.deepEqual([...(merged.sourceEntryIds ?? [])], ["e1", "e2"]);
    assert.equal(merged.useSessions, 4);
    assert.equal(merged.helpful, 1);
    assert.equal(merged.harmful, 2);
    assert.equal(merged.retrievals, 5);
    assert.equal(merged.lastSession, "s1");
    assert.deepEqual(
      (merged.uses ?? []).map((use) => use.s),
      [2, 4],
      "the use log keeps both histories, oldest first",
    );
    assert.equal(merged.kind, "fact", "the survivor's own claims stay");
  });

  it("stored_episode_rows_are_never_merged_and_fall_to_eviction", async () => {
    const { store, memory } = makeMemory();
    const ids = await writeEpisodes(memory, 6, "canary.drain");
    let calls = 0;
    const lifecycle = resolveLifecycleConfig({ capacity: { project: { notes: 3, tokens: 10_000 } } });
    const fabric = createLongTermMemory({
      memory,
      vectorStore: store,
      consolidate: false,
      lifecycle,
      clock: () => 0,
      resolveModelClient: () => {
        calls += 1;
        throw new Error("maintenance never calls a model");
      },
    });

    const report = await fabric.maintain();
    assert.equal(calls, 0, "maintenance makes no model call");
    assert.equal("episodesMerged" in report, false);
    assert.equal(report.merged, 0, "an episode is never a duplicate");
    assert.equal(report.evicted, 3, "budget pressure falls back to eviction");
    for (const id of ids) {
      assert.equal(parseMemoryNoteMetadata((await memory.getEntry(id))?.metadata)?.mergedInto, undefined);
    }
  });

  it("resolver_bounds_capacity_and_merge", () => {
    const resolved = resolveLifecycleConfig({});
    assert.deepEqual(resolved.capacity.project, { notes: 500, tokens: 60_000 });
    assert.deepEqual(resolved.capacity.user, { notes: 200, tokens: 20_000 });
    assert.equal(resolved.merge.duplicateDice, 0.8);
    assert.deepEqual(resolved.merge, { duplicateDice: 0.8 }, "duplicate folding is the only merge");
    assert.deepEqual(resolveLifecycleConfig({ capacity: { project: { notes: 10 } } }).capacity.project, { notes: 10, tokens: 60_000 });
    assert.deepEqual(resolved.exchangeCapacity, { hotTokens: 200_000 });
    assert.deepEqual(resolveLifecycleConfig({ exchangeCapacity: { hotTokens: 20_000 } }).exchangeCapacity, { hotTokens: 20_000 });
    for (const bad of [
      { exchangeCapacity: { hotTokens: 0 } },
      { exchangeCapacity: { hotTokens: 1_000_001 } },
      { capacity: { project: { notes: 0 } } },
      { capacity: { project: { tokens: 1_000_001 } } },
      { merge: { duplicateDice: 0.4 } },
      { merge: { duplicateDice: 1.1 } },
    ]) {
      assert.throws(() => resolveLifecycleConfig(bad as never), /lifecycle\./);
    }
  });
});
