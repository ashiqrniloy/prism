import assert from "node:assert/strict";
import { describe, it, test } from "bun:test";
import type { MemoryVectorHit } from "@arnilo/prism-memory-system/core";
import { fuseRankings } from "@arnilo/prism-memory-system/core";

function hit(id: string, score = 0.9): MemoryVectorHit {
  return {
    id,
    tenantId: "t",
    resourceId: "r",
    threadId: "c",
    text: `text ${id}`,
    embedding: [1],
    sequence: 0,
    embedderId: "m",
    metadata: {},
    createdAt: new Date(0).toISOString(),
    score,
  };
}

describe("core fuseRankings used by rag", () => {
  it("fuses by Σ 1/(rrfK + rank) with deterministic tie-breaking", () => {
    const fused = fuseRankings(
      [
        { hits: [hit("a"), hit("b"), hit("c")], leg: "vector" },
        { hits: [hit("b"), hit("d")], leg: "lexical" },
      ],
      { k: 2 },
    );
    // b: 1/3 + 1/3 = 2/3; a: 1/3 (best rank 1); d: 1/3 (best rank 1); c: 1/5
    assert.deepEqual(
      fused.map(({ hit, retrieval }) => [hit.id, retrieval]),
      [
        ["b", "hybrid"],
        ["a", "vector"],
        ["d", "lexical"],
        ["c", "vector"],
      ],
    );
  });

  it("keeps the vector-leg hit object when both legs surface a record", () => {
    const vectorOnlyScore = hit("x", 0.42);
    const fused = fuseRankings(
      [
        { hits: [vectorOnlyScore], leg: "vector" },
        { hits: [hit("x", 0.99)], leg: "lexical" },
      ],
      { k: 60 },
    );
    assert.equal(fused[0]?.hit.score, 0.42);
    assert.equal(fused[0]?.retrieval, "hybrid");
  });

  it("dedupes repeats within a single leg and tolerates an empty lexical list", () => {
    const fused = fuseRankings(
      [
        { hits: [hit("a"), hit("a"), hit("b")], leg: "vector" },
        { hits: [], leg: "lexical" },
      ],
      { k: 60 },
    );
    assert.deepEqual(
      fused.map(({ hit }) => hit.id),
      ["a", "b"],
    );
    assert.deepEqual(
      fused.map(({ retrieval }) => retrieval),
      ["vector", "vector"],
    );
  });
});

test("core fusion defaults k to 60, isolates scopes, and rejects invalid k", () => {
  const a = hit("same");
  const b = { ...a, tenantId: "other" };
  const lists = [
    { hits: [a, b], leg: "vector" as const },
    { hits: [b], leg: "lexical" as const },
  ];
  assert.deepEqual(fuseRankings(lists), fuseRankings(lists, { k: 60 }));
  assert.equal(fuseRankings(lists).length, 2);
  assert.equal(fuseRankings(lists)[0]!.hit, b);
  assert.throws(() => fuseRankings(lists, { k: -1 }), /fusion k/);
  assert.throws(() => fuseRankings(lists, { k: Number.NaN }), /fusion k/);
});
