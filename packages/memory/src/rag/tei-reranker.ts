import { MediaContentError, pinnedFetch, type SsrfPolicy } from "@arnilo/prism";
import { RagAbortError, RagLimitError, RagValidationError } from "./errors.js";
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

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;

export function createTeiReranker(options: CreateTeiRerankerOptions): Reranker {
  const { baseUrl, model, timeoutMs = DEFAULT_TIMEOUT_MS, maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES, ssrf, allowLoopback } = options;
  if (!baseUrl.trim()) throw new RagValidationError("TEI reranker baseUrl is required");
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new RagValidationError("TEI reranker baseUrl must be an absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RagValidationError(`TEI reranker baseUrl must use http(s) (got ${url.protocol})`);
  }
  if (url.username || url.password) throw new RagValidationError("TEI reranker baseUrl must not embed credentials");
  if (url.hash) throw new RagValidationError("TEI reranker baseUrl must not contain a fragment");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new RagValidationError("TEI reranker timeoutMs must be a positive integer");
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new RagValidationError("TEI reranker maxResponseBytes must be a positive integer");
  }
  // Join without doubling a trailing slash.
  const endpoint = `${url.toString().replace(/\/+$/, "")}/rerank`;
  const pinnedRerankFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    pinnedFetch(input instanceof URL ? input : new URL(String(input)), init, {
      errorPrefix: "TEI rerank",
      hostnameErrorPrefix: "TEI rerank",
      ssrf,
      allowLoopback,
      maxResponseBytes,
    });
  const transport = options.fetch ?? pinnedRerankFetch;

  return {
    async rerank({ query, hits, signal }): Promise<readonly RagHit[]> {
      const payload = JSON.stringify({ query, texts: hits.map((hit) => hit.text), raw_scores: false, ...(model ? { model } : {}) });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      let response: Response;
      try {
        response = await transport(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: payload,
          signal: combined,
          redirect: "manual",
        });
      } catch (error) {
        if (error instanceof MediaContentError) {
          throw new RagValidationError(`TEI rerank request denied: ${error.message}`);
        }
        if (signal?.aborted) throw new RagAbortError();
        throw new RagLimitError(`TEI rerank exceeded ${timeoutMs}ms or failed to reach ${url.host}`);
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw new RagValidationError(`TEI rerank endpoint returned HTTP ${response.status}`);
      const text = await readBoundedBody(response, maxResponseBytes);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new RagValidationError("TEI rerank response is not valid JSON");
      }
      return orderByScores(hits, parsed);
    },
  };
}

/** Strictly parse `{results: [{index, score}]}` and reorder hits by score desc. */
function orderByScores(hits: readonly RagHit[], parsed: unknown): readonly RagHit[] {
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { results?: unknown }).results)) {
    throw new RagValidationError("TEI rerank response missing results array");
  }
  const results = (parsed as { results: unknown[] }).results;
  if (results.length !== hits.length) {
    throw new RagValidationError(`TEI rerank returned ${results.length} scores for ${hits.length} hits`);
  }
  const scores = new Array<number>(hits.length);
  const seen = new Set<number>();
  for (const item of results) {
    if (typeof item !== "object" || item === null) throw new RagValidationError("TEI rerank result must be an object");
    const index = (item as { index?: unknown }).index;
    const score = (item as { score?: unknown }).score;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= hits.length) {
      throw new RagValidationError("TEI rerank returned an out-of-range index");
    }
    if (seen.has(index)) throw new RagValidationError("TEI rerank returned a duplicate index");
    if (typeof score !== "number" || !Number.isFinite(score)) throw new RagValidationError("TEI rerank returned a non-finite score");
    seen.add(index);
    scores[index] = score;
  }
  // Stable sort by descending score; ties keep original array order.
  const ordered = hits
    .map((hit, i) => ({ hit, score: scores[i]! }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.hit);
  return Object.freeze(ordered);
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let out = "";
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new RagLimitError(`TEI rerank response exceeds ${maxBytes} bytes`);
      out += decoder.decode(value, { stream: true });
    }
    return out + decoder.decode();
  } catch (error) {
    // The pinned transport may already have errorred the stream (MediaContentError).
    if (error instanceof RagLimitError) throw error;
    throw new RagLimitError(`TEI rerank response exceeds ${maxBytes} bytes`);
  }
}
