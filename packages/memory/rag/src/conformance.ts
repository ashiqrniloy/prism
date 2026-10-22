import assert from "node:assert/strict";
import type { RagContentTrust, RagHit, RagProvenance, Reranker } from "./types.js";

/**
 * Network-free conformance for `Reranker` implementations (plan 062): empty
 * input short-circuits to `[]`, output is a permutation of the exact input
 * references (provenance/trust untouched), and repeated calls are
 * deterministic. Run any Reranker that needs no live endpoint; HTTP adapters
 * are exercised with injected transports in their own suites.
 */
export async function runRerankerConformance(createReranker: () => Reranker): Promise<void> {
  const reranker = createReranker();

  // Empty input → empty output.
  assert.deepEqual(await reranker.rerank({ query: "q", hits: [] }), []);

  const hits = [rerankHit("src#0001", "alpha beta"), rerankHit("src#0002", "gamma delta"), rerankHit("src#0003", "alpha gamma")];

  // Permutation: every hit exactly once, same references, provenance/trust preserved.
  const ordered = await reranker.rerank({ query: "alpha", hits });
  assert.equal(ordered.length, hits.length);
  assert.equal(new Set(ordered.map((hit) => hit.id)).size, hits.length);
  for (const hit of ordered) {
    assert.ok(hits.includes(hit), `returned hit ${hit.id} is not the input reference`);
  }

  // Deterministic across calls.
  const again = await reranker.rerank({ query: "alpha", hits });
  assert.deepEqual(
    again.map((hit) => hit.id),
    ordered.map((hit) => hit.id),
  );
}

function rerankHit(id: string, text: string): RagHit {
  const provenance: RagProvenance = {
    sourceId: "src",
    chunkId: id,
    citationId: id,
    provider: "host",
    tenantId: "t",
    resourceId: "r",
    corpusId: "c",
    retrieval: "vector",
    retrievedAt: "0",
  };
  const trust: RagContentTrust = { untrusted: true, inert: true, injectionCapable: true };
  return { id, citationId: id, sourceId: "src", index: 0, start: 0, end: text.length, text, score: 0, retrievalRank: 0, provenance, trust };
}
