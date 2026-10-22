/**
 * Plan 188.4 Task 5: duplicate merging is deterministic grouping, episode merging is one fail-closed
 * model call per cluster, and the survivor inherits the evidence the others carried.
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { JsonObject, ModelClient } from "@arnilo/prism";
import { providerDone, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import { createMemoryVectorStore } from "@arnilo/prism-memory-core";
import { resolveLifecycleConfig } from "../../config.js";
import { createMemoryFabric } from "../../create.js";
import { createMemory } from "../../memory.js";
import { encodeMemoryNoteMetadata, parseMemoryNoteMetadata } from "../../types.js";
import { duplicateGroups, EPISODE_MERGE_TOOL, episodeClusters, mergedMetadata } from "../merge.js";
import type { CapacityNote } from "../capacity.js";
import type { MemoryNoteMetadata } from "../../types.js";

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

function summaryClient(onCall: () => void, reply: JsonObject): ModelClient {
  return {
    model: { provider: "test", model: "episode-merge" },
    async *generate(request) {
      onCall();
      assert.equal(request.tools?.[0]?.name, EPISODE_MERGE_TOOL);
      yield providerToolCall(toolCallContent("x1", EPISODE_MERGE_TOOL, reply));
      yield providerDone();
    },
  };
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
    assert.deepEqual(duplicateGroups([capacityNote("ffffffffffff", { key: "k", pinned: true }, "x"), capacityNote("111111111111", { key: "k" }, "x")]), []);
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

  it("episode_cluster_merges_into_one_candidate_and_archives_sources", async () => {
    const { store, memory } = makeMemory();
    const ids = await writeEpisodes(memory, 6, "canary.drain");
    let calls = 0;
    const lifecycle = resolveLifecycleConfig({
      capacity: { project: { notes: 3, tokens: 10_000 } },
      merge: { episodes: { minCluster: 5 } },
    });
    const fabric = createMemoryFabric({
      memory,
      vectorStore: store,
      consolidate: false,
      lifecycle,
      clock: () => 0,
      resolveModelClient: () =>
        summaryClient(() => {
          calls += 1;
        }, { text: "Drain the canary pool before every rollback", kind: "procedure", keywords: ["canary"] }),
    });

    const report = await fabric.maintain();
    assert.equal(calls, 1, "one model call per cluster");
    assert.equal(report.episodesMerged, 1);
    assert.equal(report.merged, 0, "episodes count as clusters, not as duplicate folds");
    assert.equal(report.evicted, 0, "merging alone brought the scope inside its budget");
    const archived = await memory.getEntry(ids[0]!);
    assert.equal(archived?.metadata?.status, "archived");
    const summaryId = parseMemoryNoteMetadata(archived?.metadata)?.mergedInto;
    assert.ok(summaryId !== undefined, "the archived episode names its summary");
    const summary = await memory.getEntry(summaryId!);
    const metadata = parseMemoryNoteMetadata(summary?.metadata);
    assert.equal(metadata?.kind, "procedure");
    assert.equal(summary?.metadata?.status, "candidate", "a merged episode note must still earn verification");
    assert.equal(metadata?.generated?.by, "promotion");
    assert.deepEqual(metadata?.sourceEntryIds, [...ids], "the episodes are the summary's evidence");
    const survived = (await fabric.recall("drain the canary pool before rollback", { kinds: ["procedure"] })).hits;
    assert.equal(survived[0]?.id, summaryId, "the summary is recallable");
    for (const id of ids) {
      const entry = await memory.getEntry(id);
      assert.equal(entry?.metadata?.status, "archived");
      assert.equal(parseMemoryNoteMetadata(entry?.metadata)?.mergedInto, summaryId);
    }
  });

  it("episode_merge_off_makes_no_model_call", async () => {
    const { store, memory } = makeMemory();
    const ids = await writeEpisodes(memory, 6, "canary.drain");
    let calls = 0;
    const lifecycle = resolveLifecycleConfig({ capacity: { project: { notes: 3, tokens: 10_000 } } });
    const fabric = createMemoryFabric({
      memory,
      vectorStore: store,
      consolidate: false,
      lifecycle,
      clock: () => 0,
      resolveModelClient: () =>
        summaryClient(() => {
          calls += 1;
        }, { text: "never written", kind: "procedure" }),
    });

    const report = await fabric.maintain();
    assert.equal(calls, 0, "episode merging is off until it is configured");
    assert.equal(report.episodesMerged, 0);
    assert.equal(report.merged, 0);
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
    assert.equal(resolved.merge.episodes, undefined, "episode merging is opt-in");
    assert.equal(resolveLifecycleConfig({ merge: { episodes: false } }).merge.episodes, undefined);
    assert.deepEqual(resolveLifecycleConfig({ merge: { episodes: {} } }).merge.episodes, { minCluster: 5 });
    assert.deepEqual(resolveLifecycleConfig({ capacity: { project: { notes: 10 } } }).capacity.project, { notes: 10, tokens: 60_000 });
    for (const bad of [
      { capacity: { project: { notes: 0 } } },
      { capacity: { project: { tokens: 1_000_001 } } },
      { merge: { duplicateDice: 0.4 } },
      { merge: { duplicateDice: 1.1 } },
      { merge: { episodes: { minCluster: 1 } } },
      { merge: { episodes: { minCluster: 51 } } },
      { merge: { episodes: { model: "" } } },
    ]) {
      assert.throws(() => resolveLifecycleConfig(bad as never), /lifecycle\./);
    }
  });

  it("episode_clusters_need_a_subject_and_minimum_size", () => {
    const notes = [
      capacityNote("aaaaaaaaaaaa", { kind: "episode", key: "k" }, "one"),
      capacityNote("bbbbbbbbbbbb", { kind: "episode", key: "k" }, "two"),
      capacityNote("cccccccccccc", { kind: "episode", tags: ["tag"] }, "three"),
      capacityNote("dddddddddddd", { kind: "episode", tags: ["tag"] }, "four"),
      capacityNote("eeeeeeeeeeee", { kind: "episode" }, "no subject"),
      capacityNote("111111111111", { kind: "fact", key: "k" }, "not an episode"),
    ];
    assert.deepEqual(
      episodeClusters(notes, 2).map((cluster) => [cluster.subject, cluster.notes.length]),
      [
        ["#tag", 2],
        ["k", 2],
      ],
    );
    assert.deepEqual(episodeClusters(notes, 3), []);
  });
});
