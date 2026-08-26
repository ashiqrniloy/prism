import { type CredentialValueSource, redactSecrets, resolveCredentialValue } from "@arnilo/prism";
import { readBoundedResponseJson, readBoundedResponseText } from "@arnilo/prism/providers/transport";
import { type AlibabaBasePreset, alibabaBaseUrl } from "./models.js";

/**
 * DashScope OpenAI-compatible embeddings batch cap (text-embedding-v3/v4):
 * at most 10 input texts per request, 8,192 tokens each.
 * @see https://docs.qwencloud.com/resources/faq-embedding-reranking
 */
export const ALIBABA_EMBEDDING_BATCH_SIZE = 10;

/** Default embedding dimensions for text-embedding-v3/v4 (configurable 64–2048). */
export const ALIBABA_EMBEDDING_DEFAULT_DIMENSIONS = 1024;

export interface AlibabaEmbedderOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Explicit OpenAI-compatible base URL (wins over `preset`). */
  readonly baseUrl?: string;
  /** Named deployment preset; defaults to `singapore`. */
  readonly preset?: AlibabaBasePreset;
  /** Embedding model id, e.g. `text-embedding-v4`. */
  readonly model: string;
  /** Output dimensions (64–2048; default 1024). Sent on the wire when set. */
  readonly dimensions?: number;
  /** `encoding_format` passthrough (default `float`). */
  readonly encodingFormat?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Structural `Embedder` shape (assignable to `@arnilo/prism-memory`'s `Embedder`
 * without importing it — the package stays dependency-free).
 */
export interface AlibabaEmbedder {
  /** Embedding model identity (`options.model`); persisted on indexed records for drift detection. */
  readonly id: string;
  readonly dimensions: number;
  embed(texts: readonly string[], options?: { readonly signal?: AbortSignal }): Promise<readonly (readonly number[])[]>;
}

interface AlibabaEmbeddingEntry {
  readonly index?: number;
  readonly embedding?: readonly number[];
}

interface AlibabaEmbeddingsResponse {
  readonly data?: readonly AlibabaEmbeddingEntry[];
}

/**
 * Caller-gated DashScope embeddings over the OpenAI-compatible `POST {base}/embeddings`.
 * Inputs are chunked at `ALIBABA_EMBEDDING_BATCH_SIZE` (10) per request; vectors are
 * returned in input order. Empty input returns `[]` without a fetch. No network on
 * construction; the key is resolved per call and redacted from all thrown errors.
 */
export function createAlibabaEmbedder(options: AlibabaEmbedderOptions): AlibabaEmbedder {
  const baseUrl = alibabaBaseUrl(options);
  const dimensions = options.dimensions ?? ALIBABA_EMBEDDING_DEFAULT_DIMENSIONS;
  const encodingFormat = options.encodingFormat ?? "float";
  const fetchImpl = options.fetch ?? fetch;

  return {
    id: options.model,
    dimensions,
    async embed(texts, embedOptions = {}) {
      if (texts.length === 0) return [];
      const token = await resolveCredentialValue(options.apiKey, { provider: "alibaba", name: "apiKey" });
      const vectors: number[][] = [];
      for (let offset = 0; offset < texts.length; offset += ALIBABA_EMBEDDING_BATCH_SIZE) {
        const batch = texts.slice(offset, offset + ALIBABA_EMBEDDING_BATCH_SIZE);
        const response = await fetchImpl(`${baseUrl}/embeddings`, {
          method: "POST",
          headers: {
            ...options.headers,
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: options.model,
            input: batch,
            dimensions,
            encoding_format: encodingFormat,
          }),
          signal: embedOptions.signal,
        });
        if (!response.ok) {
          const body = await readBoundedResponseText(response, { secrets: [token] });
          throw new Error(`Alibaba embeddings failed: ${response.status} ${redactSecrets(body, [token])}`);
        }
        const payload = await readBoundedResponseJson<AlibabaEmbeddingsResponse>(response);
        if (!Array.isArray(payload.data)) throw new Error("Alibaba embeddings response missing data array");
        const byIndex = new Map<number, readonly number[]>();
        for (const entry of payload.data) {
          if (!Array.isArray(entry.embedding)) throw new Error("Alibaba embeddings entry missing embedding");
          byIndex.set(entry.index ?? byIndex.size, entry.embedding);
        }
        for (let i = 0; i < batch.length; i += 1) {
          const vector = byIndex.get(i);
          if (!vector) throw new Error(`Alibaba embeddings response missing index ${i}`);
          vectors.push([...vector]);
        }
      }
      return vectors;
    },
  };
}
