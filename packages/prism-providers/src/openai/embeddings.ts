/** OpenAI-compatible embeddings adapter over `POST {base}/embeddings` (plan 061 Task 2).
 *  Strict batch semantics: oversized inputs reject with a typed error instead of
 *  auto-chunking — callers chunk (e.g. memory's `embedBatched`). Keys resolve through
 *  the existing `CredentialValueSource` seam and are redacted from every error. */

import type { EmbeddingsProvider, } from "@arnilo/prism";
import { type CredentialValueSource, EmbeddingsError, redactSecrets, resolveCredentialValue, trimTrailingSlashes } from "@arnilo/prism";
import { readBoundedResponseJson, readBoundedResponseText } from "@arnilo/prism/providers/transport";

/** OpenAI embeddings batch cap: at most 2,048 inputs per request. */
export const OPENAI_EMBEDDINGS_MAX_BATCH_SIZE = 2048;

export interface OpenAIEmbeddingsOptions {
  readonly id?: string;
  readonly apiKey?: CredentialValueSource;
  /** Explicit base URL; defaults to `https://api.openai.com/v1`. */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly headers?: Readonly<Record<string, string>>;
}

interface OpenAIEmbeddingEntry {
  readonly index?: number;
  readonly embedding?: readonly number[];
}

interface OpenAIEmbeddingsResponse {
  readonly data?: readonly OpenAIEmbeddingEntry[];
  readonly usage?: { readonly prompt_tokens?: number; readonly total_tokens?: number };
}

export function createOpenAIEmbeddingsProvider(options: OpenAIEmbeddingsOptions = {}): EmbeddingsProvider {
  const id = options.id ?? "openai";
  const baseUrl = trimTrailingSlashes(options.baseUrl ?? "https://api.openai.com/v1");
  const fetchImpl = options.fetch ?? fetch;

  return {
    id,
    async embedMany(request) {
      if (request.inputs.length === 0) throw new EmbeddingsError("empty_input", "embedMany requires at least one input");
      if (request.inputs.length > OPENAI_EMBEDDINGS_MAX_BATCH_SIZE) {
        throw new EmbeddingsError(
          "batch_too_large",
          `OpenAI embeddings accept at most ${OPENAI_EMBEDDINGS_MAX_BATCH_SIZE} inputs per request; got ${request.inputs.length} — chunk the caller`,
        );
      }
      const token = await resolveCredentialValue(options.apiKey, { provider: id, name: "apiKey" });
      const response = await fetchImpl(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          ...options.headers,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: request.model,
          input: request.inputs,
          ...(request.dimensions !== undefined ? { dimensions: request.dimensions } : {}),
        }),
        signal: request.signal,
      });
      if (!response.ok) {
        const body = await readBoundedResponseText(response, { secrets: [token] });
        throw new EmbeddingsError("request_failed", `OpenAI embeddings failed: ${response.status} ${redactSecrets(body, [token])}`);
      }
      const payload = await readBoundedResponseJson<OpenAIEmbeddingsResponse>(response);
      if (!Array.isArray(payload.data)) throw new EmbeddingsError("response_malformed", "OpenAI embeddings response missing data array");
      const byIndex = new Map<number, readonly number[]>();
      for (const entry of payload.data) {
        if (!Array.isArray(entry.embedding)) throw new EmbeddingsError("response_malformed", "OpenAI embeddings entry missing embedding");
        byIndex.set(entry.index ?? byIndex.size, entry.embedding);
      }
      const vectors: (readonly number[])[] = [];
      for (let i = 0; i < request.inputs.length; i += 1) {
        const vector = byIndex.get(i);
        if (!vector) throw new EmbeddingsError("response_malformed", `OpenAI embeddings response missing index ${i}`);
        if (request.dimensions !== undefined && vector.length !== request.dimensions) {
          throw new EmbeddingsError(
            "response_malformed",
            `OpenAI embeddings vector at index ${i} has ${vector.length} dimensions, expected ${request.dimensions}`,
          );
        }
        vectors.push(vector);
      }
      return {
        vectors,
        usage: {
          ...(payload.usage?.prompt_tokens !== undefined ? { inputTokens: payload.usage.prompt_tokens } : {}),
          ...(payload.usage?.total_tokens !== undefined ? { totalTokens: payload.usage.total_tokens } : {}),
        },
        dimensions: request.dimensions ?? vectors[0]?.length ?? 0,
      };
    },
  };
}
