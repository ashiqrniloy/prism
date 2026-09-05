/** Provider-neutral embeddings contract (plan 061 Task 2).
 *  One-shot batch shape: the request carries the abort signal, results report the
 *  shared `Usage`. Adapters enforce provider batch caps with typed errors — they
 *  never silently auto-chunk; callers chunk (e.g. memory's `embedBatched`).
 *  ponytail: per-item token caps are server-enforced; the local cap is batch count. */
import type { ModelCapabilities, ModelConfig, Usage } from "./content.js";

export interface EmbeddingsRequest {
  readonly model: string;
  readonly inputs: readonly string[];
  /** Output dimensions override; only for models that support reduced dimensions. */
  readonly dimensions?: number;
  readonly signal?: AbortSignal;
}

export interface EmbeddingsResult {
  /** Vectors in input order; `vectors[i]` corresponds to `inputs[i]`. */
  readonly vectors: readonly (readonly number[])[];
  readonly usage: Usage;
  readonly dimensions: number;
}

export interface EmbeddingsProvider {
  readonly id: string;
  embedMany(request: EmbeddingsRequest): Promise<EmbeddingsResult>;
}

export type EmbeddingsErrorCode = "empty_input" | "batch_too_large" | "request_failed" | "response_malformed" | "unsupported_model";

export class EmbeddingsError extends Error {
  readonly code: EmbeddingsErrorCode;

  constructor(code: EmbeddingsErrorCode, message: string) {
    super(message);
    this.name = "EmbeddingsError";
    this.code = code;
  }
}

export function modelSupportsEmbeddings(capabilities?: ModelCapabilities): boolean {
  return capabilities?.embeddings === true;
}

export function assertEmbeddingsSupported(model: ModelConfig): void {
  if (!modelSupportsEmbeddings(model.capabilities)) {
    throw new EmbeddingsError("unsupported_model", `Model ${model.provider}/${model.model} does not declare the embeddings capability`);
  }
}
