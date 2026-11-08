import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { MemoryValidationError } from "@arnilo/prism-memory-core";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory-core";
import { createMemory, createMemoryFabric, createMemoryWorkingStore, parseMemoryNoteMetadata } from "../index.js";
import { DEFAULT_CONSOLIDATION_THRESHOLD } from "../consolidate.js";

const scope = { tenantId: "t1", resourceId: "u1", threadId: "th1" };

function makeMemory() {
  const vectors = createMemoryVectorStore();
  const working = createMemoryWorkingStore();
  const memory = createMemory({ ...scope, embedder: createHashEmbedder(), vectorStore: vectors, workingStore: working });
  return { memory, vectors, working };
}

/** The opt-in workers run on a write when their config enables them. */

/** Raw rows for a query, including superseded and non-fabric rows the fabric recall would hide. */
async function rawRows(memory: ReturnType<typeof makeMemory>["memory"], query: string) {
  return (await memory.recall(query, { topK: 20 })).hits;
}

describe("memory fabric consolidation", () => {
  it("similar_different_text_inserts_both_notes_without_a_link", async () => {
    const { memory } = makeMemory();
    let modelCalls = 0;
    const fabric = createMemoryFabric({ memory, consolidate: { threshold: 0.4 }, resolveModelClient: () => { modelCalls++; throw new Error("off"); } });
    const alice = await fabric.remember({ kind: "fact", content: "Alice flight leaves at noon" });
    const bob = await fabric.remember({ kind: "fact", content: "Bob flight leaves at noon" });
    assert.notEqual(alice.id, bob.id);
    assert.equal(bob.supersedes, undefined);
    assert.equal(bob.links, undefined);
    assert.equal(parseMemoryNoteMetadata((await memory.getEntry(alice.id))?.metadata)?.validTo, undefined);
    const result = await fabric.recall("flight");
    assert.equal(result.hits.length, 2);
    assert.equal(result.explain.find(row => row.id === bob.id)?.links, undefined);
    assert.equal(modelCalls, 0);
  });




  it("folds an identical note in place instead of duplicating it", async () => {
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({ memory });

    const first = await fabric.remember({ kind: "fact", content: "User prefers metric units", keywords: ["units"] });
    const second = await fabric.remember({ kind: "fact", content: "User prefers metric units", keywords: ["prefs"], tags: ["ui"] });

    assert.equal(second.id, first.id);
    assert.equal(second.keywords?.join(","), "units,prefs");
    assert.equal(second.tags?.join(","), "ui");
    assert.equal((await rawRows(memory, "User prefers metric units")).length, 1);
    assert.equal((await fabric.recall("User prefers metric units")).hits.length, 1);
  });

  it("explicit_supersedes_retires_note: old row gets validTo, new row carries supersedes", async () => {
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({ memory });

    const first = await fabric.remember({ kind: "fact", content: "Deploy service with canary" });
    const second = await fabric.remember({ kind: "fact", content: "Deploy service with canary disabled", supersedes: first.id });

    assert.equal(second.supersedes, first.id);
    const rows = await rawRows(memory, "Deploy service with canary");
    assert.equal(rows.length, 2);
    const oldMetadata = parseMemoryNoteMetadata(rows.find((row) => row.id === first.id)?.metadata);
    assert.equal(oldMetadata?.validTo, second.ingestedAt);
    assert.deepEqual(
      (await fabric.recall("Deploy service with canary")).hits.map((hit) => hit.id),
      [second.id],
    );
    const historical = await fabric.recall("Deploy service with canary", { asOf: "2020-01-01T00:00:00.000Z" });
    assert.deepEqual(historical.hits.map((hit) => hit.id).sort(), [first.id, second.id].sort());
  });

  it("supersede keeps host metadata keys on the superseded row", async () => {
    const { memory } = makeMemory();
    await memory.remember(
      {
        entries: [
          {
            id: "0badc0ffee11",
            text: "Office is in Berlin",
            createdAt: "2026-01-01T00:00:00.000Z",
            metadata: { owner: "host", fabric: { v: 1, kind: "fact" } },
          },
        ],
      },
      { wait: true },
    );
    const fabric = createMemoryFabric({ memory });

    const note = await fabric.remember({ kind: "fact", content: "Office is in Berlin today", supersedes: "0badc0ffee11" });

    assert.equal(note.supersedes, "0badc0ffee11");
    const row = (await rawRows(memory, "Office is in Berlin")).find((hit) => hit.id === "0badc0ffee11");
    assert.equal((row?.metadata as Record<string, unknown> | undefined)?.owner, "host");
    assert.equal(parseMemoryNoteMetadata(row?.metadata)?.validTo, note.ingestedAt);
  });

  it("never folds a file note into a different path and updates the same path in place", async () => {
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({ memory });

    const alpha = await fabric.remember({ kind: "file", path: "docs/alpha.md", content: "Service deploy uses canary rollout plan" });
    const beta = await fabric.remember({ kind: "file", path: "docs/beta.md", content: "Service deploy uses canary rollout plan" });
    assert.notEqual(beta.id, alpha.id);
    assert.equal((await rawRows(memory, "Service deploy uses canary rollout plan")).length, 2);

    const alphaAgain = await fabric.remember({
      kind: "file",
      path: "docs/alpha.md",
      content: "Service deploy uses canary rollout plan v2",
      keywords: ["canary"],
    });
    assert.equal(alphaAgain.id, alpha.id);
    assert.equal(alphaAgain.path, "docs/alpha.md");
    assert.equal((await rawRows(memory, "Service deploy uses canary rollout plan")).length, 2);
    const hits = await fabric.recall("Service deploy uses canary rollout plan v2", { kinds: ["file"] });
    assert.equal(hits.hits.find((hit) => hit.id === alpha.id)?.content, "Service deploy uses canary rollout plan v2");
  });

  it("writes unconditionally when consolidation is off", async () => {
    const { memory } = makeMemory();
    const fabric = createMemoryFabric({ memory, consolidate: false });

    const first = await fabric.remember({ kind: "fact", content: "User prefers metric units" });
    const second = await fabric.remember({ kind: "fact", content: "User prefers metric units" });
    assert.notEqual(second.id, first.id);
    assert.equal((await rawRows(memory, "User prefers metric units")).length, 2);
  });





  it("validates consolidation options and keeps distant notes apart", async () => {
    const { memory } = makeMemory();
    assert.throws(() => createMemoryFabric({ memory, consolidate: { threshold: 2 } }), MemoryValidationError);
    assert.throws(() => createMemoryFabric({ memory, consolidate: "yes" as unknown as boolean }), MemoryValidationError);

    const fabric = createMemoryFabric({ memory });
    await fabric.remember({ kind: "fact", content: "Canary rollout protects deploys" });
    await fabric.remember({ kind: "fact", content: "Dashboards track rollout health" });
    assert.equal((await fabric.recall("rollout", { topK: 10 })).hits.length, 2);
    assert.equal(DEFAULT_CONSOLIDATION_THRESHOLD, 0.85);
  });
});
