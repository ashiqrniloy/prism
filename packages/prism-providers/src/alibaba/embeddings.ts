import type { EmbeddingsProvider, EmbeddingsResult } from "@arnilo/prism";
import { type CredentialValueSource, EmbeddingsError, redactSecrets, resolveCredentialValue } from "@arnilo/prism";
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

/** Shared adapter options (base URL/preset/credentials/transport) for the embedder and the contract provider. */
interface AlibabaEmbeddingsAdapterOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly preset?: AlibabaBasePreset;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface AlibabaEmbedderOptions extends AlibabaEmbeddingsAdapterOptions {
  /** Embedding model id, e.g. `text-embedding-v4`. */
  readonly model: string;
  /** Output dimensions (64–2048; default 1024). Sent on the wire when set. */
  readonly dimensions?: number;
  /** `encoding_format` passthrough (default `float`). */
  readonly encodingFormat?: string;
}

export interface AlibabaEmbeddingsProviderOptions extends AlibabaEmbeddingsAdapterOptions {
  readonly id?: string;
  /** Default output dimensions when a request omits `dimensions` (default 1024). */
  readonly dimensions?: number;
  /** `encoding_format` passthrough (default `float`). */
  readonly encodingFormat?: string;
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
  readonly usage?: { readonly prompt_tokens?: number; readonly total_tokens?: number };
}

/** Single bounded DashScope embeddings request; vectors mapped back to input order. */
async function alibabaEmbeddingsCall(args: {
  baseUrl: string;
  fetchImpl: typeof fetch;
  headers?: Readonly<Record<string, string>>;
  token: string | undefined;
  model: string;
  inputs: readonly string[];
  dimensions: number;
  encodingFormat: string;
  signal?: AbortSignal;
}): Promise<EmbeddingsResult> {
  const response = await args.fetchImpl(`${args.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      ...args.headers,
      ...(args.token ? { authorization: `Bearer ${args.token}` } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      input: args.inputs,
      dimensions: args.dimensions,
      encoding_format: args.encodingFormat,
    }),
    signal: args.signal,
  });
  if (!response.ok) {
    const body = await readBoundedResponseText(response, { secrets: [args.token] });
    throw new EmbeddingsError("request_failed", `Alibaba embeddings failed: ${response.status} ${redactSecrets(body, [args.token])}`);
  }
  const payload = await readBoundedResponseJson<AlibabaEmbeddingsResponse>(response);
  if (!Array.isArray(payload.data)) throw new EmbeddingsError("response_malformed", "Alibaba embeddings response missing data array");
  const byIndex = new Map<number, readonly number[]>();
  for (const entry of payload.data) {
    if (!Array.isArray(entry.embedding)) throw new EmbeddingsError("response_malformed", "Alibaba embeddings entry missing embedding");
    byIndex.set(entry.index ?? byIndex.size, entry.embedding);
  }
  const vectors: (readonly number[])[] = [];
  for (let i = 0; i < args.inputs.length; i += 1) {
    const vector = byIndex.get(i);
    if (!vector) throw new EmbeddingsError("response_malformed", `Alibaba embeddings response missing index ${i}`);
    vectors.push([...vector]);
  }
  return {
    vectors,
    usage: {
      ...(payload.usage?.prompt_tokens !== undefined ? { inputTokens: payload.usage.prompt_tokens } : {}),
      ...(payload.usage?.total_tokens !== undefined ? { totalTokens: payload.usage.total_tokens } : {}),
    },
    dimensions: vectors[0]?.length ?? args.dimensions,
  };
}

/**
 * Caller-gated DashScope embeddings over the OpenAI-compatible `POST {base}/embeddings`.
 * Strict batch semantics: requests over `ALIBABA_EMBEDDING_BATCH_SIZE` (10) reject with
 * `EmbeddingsError("batch_too_large")` — callers chunk (e.g. memory's `embedBatched`).
 * No network on construction; the key resolves per call and is redacted from all errors.
 */
export function createAlibabaEmbeddingsProvider(options: AlibabaEmbeddingsProviderOptions): EmbeddingsProvider {
  const id = options.id ?? "alibaba";
  const baseUrl = alibabaBaseUrl(options);
  const defaultDimensions = options.dimensions ?? ALIBABA_EMBEDDING_DEFAULT_DIMENSIONS;
  const encodingFormat = options.encodingFormat ?? "float";
  const fetchImpl = options.fetch ?? fetch;

  return {
    id,
    async embedMany(request) {
      if (request.inputs.length === 0) throw new EmbeddingsError("empty_input", "embedMany requires at least one input");
      if (request.inputs.length > ALIBABA_EMBEDDING_BATCH_SIZE) {
        throw new EmbeddingsError(
          "batch_too_large",
          `Alibaba embeddings accept at most ${ALIBABA_EMBEDDING_BATCH_SIZE} inputs per request; got ${request.inputs.length} — chunk the caller`,
        );
      }
      const token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
      return alibabaEmbeddingsCall({
        baseUrl,
        fetchImpl,
        headers: options.headers,
        token,
        model: request.model,
        inputs: request.inputs,
        dimensions: request.dimensions ?? defaultDimensions,
        encodingFormat,
        signal: request.signal,
      });
    },
  };
}

/**
 * Caller-gated DashScope embedder for the memory host `Embedder` seam (structural
 * contract, no package dependency). Inputs are chunked at `ALIBABA_EMBEDDING_BATCH_SIZE`
 * (10) per request; vectors are returned in input order. Empty input returns `[]` without
 * a fetch. The credential resolves once per `embed()` call — a rotating
 * `CredentialValueSource` is never consumed twice per batch.
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
      const vectors: (readonly number[])[] = [];
      for (let offset = 0; offset < texts.length; offset += ALIBABA_EMBEDDING_BATCH_SIZE) {
        const result = await alibabaEmbeddingsCall({
          baseUrl,
          fetchImpl,
          headers: options.headers,
          token,
          model: options.model,
          inputs: texts.slice(offset, offset + ALIBABA_EMBEDDING_BATCH_SIZE),
          dimensions,
          encodingFormat,
          signal: embedOptions.signal,
        });
        vectors.push(...result.vectors);
      }
      return vectors;
    },
  };
}
