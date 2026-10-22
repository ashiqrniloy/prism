import type { EmbeddingsProvider } from "@arnilo/prism";

/** Deterministic 2-d vectors. Scenarios only — no network embedder. */
export function fixtureEmbeddings(): EmbeddingsProvider {
  return {
    id: "fixture",
    async embedMany(request) {
      return {
        vectors: request.inputs.map((_, index) => [index, 1]),
        dimensions: 2,
        usage: { inputTokens: request.inputs.length, outputTokens: 0 },
      };
    },
  };
}
