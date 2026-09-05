import { type SsrfPolicy } from "@arnilo/prism";
import { RagValidationError } from "./errors.js";
import {
  orderScores,
  postRerankJson,
  rerankEndpoint,
  resolveRerankFetch,
  resolveRerankLimits,
  validateRerankUrl,
} from "./rerank-shared.js";
import type { RagHit, Reranker } from "./types.js";

/**
 * Hosted rerank adapters over the existing `Reranker` host contract (plan 062,
 * review §7 P1): the OpenAI-compatible `rerank` route (Cohere-shaped
 * `{model, query, documents}` → `{results: [{index, relevance_score}]}`, spoken
 * by Jina, vLLM, SiliconFlow, Together, …) and Voyage AI as one independent
 * provider (`…/v1/rerank` → `{data: [{index, relevance_score}]}`).
 *
 * - Like `createTeiReranker`, both return a permutation-only reorder of the
 *   provided `RagHit[]` (same object references — provenance/trust untouched)
 *   and fail closed on short/duplicate/out-of-range indices, non-finite scores,
 *   HTTP errors, timeouts, and oversized bodies. No `top_k` is sent: the
 *   retrieval seam owns top-K; the provider returns the full permutation.
 * - One request per rerank call — no adapter-side batching beyond the
 *   provider's single-request document limit. Seam caps (`maxRerankBytes`,
 *   `maxRerankMs`, `rerankConcurrency`) stay enforced by `rerankHits` around
 *   these adapters.
 * - No SaaS default URL: hosts pass `baseUrl` (including the `/v1` segment
 *   where the provider uses one) and their own `apiKey` (Bearer). Document
 *   content is never logged — errors carry status/host only.
 */

export interface HostedRerankerOptions {
  /** Base URL including any version segment, e.g. `https://api.jina.ai/v1`. `/rerank` is appended. */
  readonly baseUrl: string;
  /** Reranker model name sent in the request body. */
  readonly model?: string;
  /** Bearer credential; sent as `Authorization: Bearer <apiKey>` and never logged. */
  readonly apiKey?: string;
  /** Per-call timeout combined with the caller signal; aborts fail closed. */
  readonly timeoutMs?: number;
  /** SSRF policy applied on resolved hosts (default: core default). */
  readonly ssrf?: SsrfPolicy;
  /** Allow loopback destinations (local/dev gateways). Default `false`. */
  readonly allowLoopback?: boolean;
  /** Maximum response body bytes. Default 65,536 (plan 021 ceiling precedent). */
  readonly maxResponseBytes?: number;
  /** Trusted custom transport; host owns DNS/SSRF protection (OPA precedent). */
  readonly fetch?: typeof globalThis.fetch;
}

export interface CreateOpenAiCompatibleRerankerOptions extends HostedRerankerOptions {}

export interface CreateVoyageRerankerOptions extends HostedRerankerOptions {
  /** Voyage requires a Bearer API key. */
  readonly apiKey: string;
}

interface HostedShape {
  readonly label: string;
  readonly resultsKey: "results" | "data";
  readonly requireApiKey: boolean;
}

function createHostedReranker(shape: HostedShape, options: HostedRerankerOptions): Reranker {
  const url = validateRerankUrl(options.baseUrl, shape.label);
  resolveRerankLimits(options, shape.label);
  if (shape.requireApiKey && !options.apiKey?.trim()) throw new RagValidationError(`${shape.label} apiKey is required`);
  if (options.apiKey && /[\r\n]/.test(options.apiKey)) {
    throw new RagValidationError(`${shape.label} apiKey must not contain control characters`);
  }
  const endpoint = rerankEndpoint(url, "/rerank");
  const transport = resolveRerankFetch(options, shape.label);
  const headers = options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : undefined;

  return {
    async rerank({ query, hits, signal }): Promise<readonly RagHit[]> {
      const payload = { ...(options.model ? { model: options.model } : {}), query, documents: hits.map((hit) => hit.text) };
      const parsed = await postRerankJson(transport, endpoint, payload, options, signal, shape.label, url.host, headers);
      return orderScores(hits, parsed, shape.resultsKey, "relevance_score", shape.label);
    },
  };
}

/** OpenAI-compatible `POST <baseUrl>/rerank` → `{results: [{index, relevance_score}]}`. */
export function createOpenAiCompatibleReranker(options: CreateOpenAiCompatibleRerankerOptions): Reranker {
  return createHostedReranker({ label: "rerank", resultsKey: "results", requireApiKey: false }, options);
}

/** Voyage AI `POST <baseUrl>/rerank` → `{data: [{index, relevance_score}]}` (independent provider). */
export function createVoyageReranker(options: CreateVoyageRerankerOptions): Reranker {
  return createHostedReranker({ label: "Voyage rerank", resultsKey: "data", requireApiKey: true }, options);
}
