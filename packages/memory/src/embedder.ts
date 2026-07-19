import { MemoryLimitError, MemoryValidationError } from "./errors.js";
import { assertFiniteVector, assertNotAborted, chunkArray } from "./util.js";
import type { Embedder } from "./types.js";

export interface HashEmbedderOptions {
  readonly dimensions?: number;
}

/**
 * Deterministic bag-of-tokens embedder for tests and offline demos.
 * Not suitable as a production semantic model.
 */
export function createHashEmbedder(options: HashEmbedderOptions = {}): Embedder {
  const dimensions = options.dimensions ?? 32;
  if (!Number.isInteger(dimensions) || dimensions <= 0 || dimensions > 4096) {
    throw new MemoryValidationError("dimensions must be an integer in 1..4096");
  }

  return {
    dimensions,
    async embed(texts, embedOptions = {}) {
      assertNotAborted(embedOptions.signal);
      return texts.map((text) => hashEmbed(text, dimensions));
    },
  };
}

export async function embedBatched(
  embedder: Embedder,
  texts: readonly string[],
  batchSize: number,
  options: { readonly signal?: AbortSignal; readonly maxDimensions: number } ,
): Promise<(readonly number[])[]> {
  if (embedder.dimensions > options.maxDimensions) {
    throw new MemoryLimitError(`embedder dimensions ${embedder.dimensions} exceed cap ${options.maxDimensions}`);
  }
  const output: (readonly number[])[] = [];
  for (const batch of chunkArray(texts, batchSize)) {
    assertNotAborted(options.signal);
    const vectors = await embedder.embed(batch, { signal: options.signal });
    if (vectors.length !== batch.length) {
      throw new MemoryValidationError("embedder returned unexpected vector count");
    }
    for (const vector of vectors) {
      assertFiniteVector(vector, "embedder returned vector", embedder.dimensions);
      output.push(vector);
    }
  }
  return output;
}

function hashEmbed(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length === 0) {
    vector[0] = 1;
    return normalize(vector);
  }
  for (const token of tokens) {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i += 1) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const index = Math.abs(hash) % dimensions;
    vector[index] += 1;
  }
  return normalize(vector);
}

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}
