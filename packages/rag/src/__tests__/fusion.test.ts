import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MemoryVectorHit } from "@arnilo/prism-memory";
import { fuseReciprocalRank } from "../fusion.js";

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

describe("fuseReciprocalRank", () => {
  it("fuses by Σ 1/(rrfK + rank) with deterministic tie-breaking", () => {
    const fused = fuseReciprocalRank([hit("a"), hit("b"), hit("c")], [hit("b"), hit("d")], 2);
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
    const fused = fuseReciprocalRank([vectorOnlyScore], [hit("x", 0.99)], 60);
    assert.equal(fused[0]?.hit.score, 0.42);
    assert.equal(fused[0]?.retrieval, "hybrid");
  });

  it("dedupes repeats within a single leg and tolerates an empty lexical list", () => {
    const fused = fuseReciprocalRank([hit("a"), hit("a"), hit("b")], [], 60);
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
