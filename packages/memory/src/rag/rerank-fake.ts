import type { RagHit, Reranker } from "./types.js";

/**
 * Network-free deterministic `Reranker` for tests and conformance
 * (plan 062): scores each hit by word-overlap with the query (fraction of
 * query terms present, ties keep retrieval order). Never fetches, never
 * throws for non-empty input; returns a permutation of the same references.
 */
export function createFakeReranker(): Reranker {
  return {
    async rerank({ query, hits }): Promise<readonly RagHit[]> {
      const terms = new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
      return Object.freeze(
        hits
          .map((hit, index) => {
            const found = new Set((hit.text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((term) => terms.has(term)));
            return { hit, score: terms.size ? found.size / terms.size : 0, index };
          })
          .sort((a, b) => b.score - a.score || a.index - b.index)
          .map((entry) => entry.hit),
      );
    },
  };
}
