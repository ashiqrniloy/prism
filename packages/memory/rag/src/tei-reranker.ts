import { type SsrfPolicy } from "@arnilo/prism";
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
 * Hugging Face TEI rerank adapter (plan 034 Task 8 / request P8):
 * `POST <baseUrl>/rerank` with `{query, texts, raw_scores:false}` →
 * `{results: [{index, score}]}` mapped to a permutation-only reorder of the
 * provided `RagHit[]` (same object references — provenance/trust untouched).
 *
 * - URL shape validated at construction (absolute, http/https, no embedded
 *   credentials or fragment); SSRF/enforcement is host-side via `ssrf`,
 *   `allowLoopback`, or an injected `fetch`. Default transport is the core
 *   `pinnedFetch` primitive (DNS-pinned, redirect-free, byte-bounded).
 * - Out-of-range/duplicate/missing indices, non-finite scores, HTTP errors,
 *   timeouts, and oversized bodies all fail closed in the rerank error
 *   family. Seam caps (`maxRerankBytes`, `maxRerankMs`, `rerankConcurrency`)
 *   stay enforced by `rerankHits` around this adapter.
 * - No credentials, no SaaS default URL.
 */

export interface CreateTeiRerankerOptions {
  /** Base URL of the TEI service, e.g. `http://tei.svc:8080`. `/rerank` is appended. */
  readonly baseUrl: string;
  /** Optional model name sent in the rerank body. */
  readonly model?: string;
  /** Per-call timeout combined with the caller signal; aborts fail closed. */
  readonly timeoutMs?: number;
  /** SSRF policy applied on resolved hosts (default: core default). */
  readonly ssrf?: SsrfPolicy;
  /** Allow loopback destinations (local/dev TEI). Default `false`. */
  readonly allowLoopback?: boolean;
  /** Maximum response body bytes. Default 65,536 (plan 021 ceiling precedent). */
  readonly maxResponseBytes?: number;
  /** Trusted custom transport; host owns DNS/Bonding protection (OPA precedent). */
  readonly fetch?: typeof globalThis.fetch;
}

export function createTeiReranker(options: CreateTeiRerankerOptions): Reranker {
  const url = validateRerankUrl(options.baseUrl, "TEI reranker");
  resolveRerankLimits(options, "TEI rerank");
  const endpoint = rerankEndpoint(url, "/rerank");
  const transport = resolveRerankFetch(options, "TEI rerank");

  return {
    async rerank({ query, hits, signal }): Promise<readonly RagHit[]> {
      const payload = { query, texts: hits.map((hit) => hit.text), raw_scores: false, ...(options.model ? { model: options.model } : {}) };
      const parsed = await postRerankJson(transport, endpoint, payload, options, signal, "TEI rerank", url.host);
      return orderScores(hits, parsed, "results", "score", "TEI rerank");
    },
  };
}
