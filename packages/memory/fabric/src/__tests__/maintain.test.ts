import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createMemoryVectorStore, MemoryValidationError, type VectorStore } from "@arnilo/prism-memory-core";
import { createMemoryFabric } from "../create.js";
import { createMemory } from "../memory.js";

function makeMemory(store: VectorStore) {
  return createMemory({
    tenantId: "t",
    resourceId: "r",
    threadId: "s",
    embedder: {
      id: "test-hash",
      dimensions: 8,
      available: () => true,
      embed: async (texts: readonly string[]) =>
        texts.map((text) => {
          const vector = new Array(8).fill(0);
          for (let i = 0; i < text.length; i++) vector[i % 8] = ((vector[i % 8] + text.charCodeAt(i)) % 100) / 100;
          return vector;
        }),
    },
    vectorStore: store,
  });
}

/** A store without the plan 188.4 additions: recall and writes work, maintenance cannot scan. */
function storeWithoutScan(): VectorStore {
  const base = createMemoryVectorStore();
  return {
    upsert: base.upsert,
    query: base.query,
    delete: base.delete,
    getByIds: base.getByIds,
    listByThread: base.listByThread,
    lexicalQuery: base.lexicalQuery,
    lexicalModes: base.lexicalModes,
  };
}

describe("Maintenance capability gate (plan 188.4 Task 2)", () => {
  it("maintain_without_scan_fails_closed_and_recall_still_works", async () => {
    const store = storeWithoutScan();
    const memory = makeMemory(store);
    const fabric = createMemoryFabric({ memory, vectorStore: store });

    await assert.rejects(fabric.maintain(), (error: Error) => {
      assert.ok(error instanceof MemoryValidationError);
      assert.equal(error.message, "maintenance requires scanMetadata");
      return true;
    });

    // Nothing else changes shape: a write lands and a recall finds it.
    await fabric.remember({ kind: "fact", content: "rollback uses fly releases rollback", key: "deploy.rollback" });
    const recalled = await fabric.recall("rollback", { minSimilarity: 0 });
    assert.ok(recalled.hits.length >= 1, "recall is unaffected by the missing scan");
  });

  it("maintain_with_scan_returns_empty_counts_until_the_passes_land", async () => {
    const store = createMemoryVectorStore();
    const fabric = createMemoryFabric({ memory: makeMemory(store), vectorStore: store });
    assert.deepEqual(await fabric.maintain(), {
      archived: 0,
      merged: 0,
      episodesMerged: 0,
      evicted: 0,
      overBudget: [],
    });
  });
});
