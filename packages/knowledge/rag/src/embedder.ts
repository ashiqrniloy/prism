/**
 * The `Embedder` memory's retrieval seam expects, over a kernel `EmbeddingsProvider`
 * (`prism.models.embeddings(ref)`). Batching is the package's job — adapters enforce provider caps and
 * never auto-chunk (plan 061). `dimensions` starts at 0 and is learned from the first response when the
 * config omits it; callers await {@link probeEmbedderDimensions} before the first retrieval.
 */
import type { EmbeddingsProvider } from "@arnilo/prism";
import type { Embedder } from "@arnilo/prism-memory-system/core";

import { DEFAULT_RAG_EMBED_BATCH } from "./config.js";

export interface ProviderEmbedderOptions {
  readonly provider: EmbeddingsProvider;
  readonly model: string;
  readonly dimensions?: number;
  readonly batchSize?: number;
}

/** A probe input no provider rejects as empty. */
const DIMENSION_PROBE = "dimension probe";

export function createProviderEmbedder(options: ProviderEmbedderOptions): Embedder {
  const batchSize = options.batchSize ?? DEFAULT_RAG_EMBED_BATCH;
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new TypeError("embeddings batchSize must be a positive integer");
  let dimensions = options.dimensions ?? 0;
  return {
    get id() {
      return `${options.provider.id}/${options.model}`;
    },
    get dimensions() {
      return dimensions;
    },
    async embed(texts, embedOptions) {
      const vectors: number[][] = [];
      for (let offset = 0; offset < texts.length; offset += batchSize) {
        const batch = texts.slice(offset, offset + batchSize);
        const result = await options.provider.embedMany({
          model: options.model,
          inputs: batch,
          ...(embedOptions?.signal ? { signal: embedOptions.signal } : {}),
        });
        if (result.vectors.length !== batch.length) {
          throw new Error(`embeddings provider returned ${result.vectors.length} vectors for ${batch.length} inputs`);
        }
        dimensions = result.dimensions;
        for (const vector of result.vectors) vectors.push([...vector]);
      }
      return vectors;
    },
  };
}

/** One embed call that fixes {@link Embedder.dimensions} when config did not declare it. */
export async function probeEmbedderDimensions(embedder: Embedder, signal?: AbortSignal): Promise<void> {
  if (embedder.dimensions > 0) return;
  await embedder.embed([DIMENSION_PROBE], signal ? { signal } : undefined);
}
