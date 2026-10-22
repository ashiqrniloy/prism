import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "bun:test";
import type { MemoryFabric, MemoryNoteHit } from "../../types.js";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory-core";
import { createMemory } from "../../index.js";
import { createScopedMemoryPolicy } from "../index.js";

function hit(id: string, score: number, usesSimilarity = score, ingestedAt = new Date().toISOString(), useSessions = 0): MemoryNoteHit {
  return {
    id,
    kind: "fact",
    content: id,
    ingestedAt,
    tokenCount: 1,
    score,
    similarity: usesSimilarity,
    ...(useSessions === 0 ? {} : { useSessions }),
  };
}

function fakeFabric(hits: MemoryNoteHit[]): MemoryFabric {
  return {
    recall: async () => ({
      hits,
      explain: hits.map((row) => ({ id: row.id, score: row.score, link: false, valid: true })),
    }),
    remember: async () => {
      throw new Error("unused");
    },
    tools: () => [],
  } as unknown as MemoryFabric;
}

async function boundPolicy(hits: MemoryNoteHit[], knobs?: Parameters<typeof createScopedMemoryPolicy>[0]["policy"]) {
  const root = await mkdtemp(join(tmpdir(), "scoped-read-"));
  const memory = createMemory({
    tenantId: "t1",
    resourceId: root,
    threadId: "scoped",
    embedder: createHashEmbedder({ dimensions: 8 }),
    vectorStore: createMemoryVectorStore(),
  });
  const policy = createScopedMemoryPolicy({ memory, fabric: fakeFabric(hits), scopeRoot: root, policy: knobs });
  return { root, policy };
}

describe("policy.recall", () => {
  it("abstains when every hit is below the floor and writes nothing", async () => {
    const { root, policy } = await boundPolicy([hit("a", 0.2), hit("b", 0.1)]);
    const result = await policy.recall("q");
    assert.deepEqual(result.hits, []);
    assert.equal(result.abstained, true);
    assert.deepEqual(await readdir(root), [], "a retrieval is not a use and leaves no ledger");
  });

  it("clamps to topK in the fabric's order and keeps the score unchanged", async () => {
    // Relevance alone decides here: the fabric already added the strength priors (plan 188.4).
    const hits = [hit("weak", 0.9), hit("hot", 0.4, 0.4, new Date().toISOString(), 10), ...Array.from({ length: 8 }, (_, i) => hit(`n${i}`, 0.5))];
    const { root, policy } = await boundPolicy(hits);
    const result = await policy.recall("q");
    assert.equal(result.abstained, false);
    assert.equal(result.hits.length, 3);
    assert.deepEqual(result.hits.map((row) => row.id), ["weak", "n0", "n1"]);
    assert.deepEqual(result.hits.map((row) => row.score), [0.9, 0.5, 0.5], "no decay is multiplied into the score");
    assert.deepEqual(await readdir(root), [], "recall records no lifecycle state");
  });
});
