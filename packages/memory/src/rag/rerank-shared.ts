import { MediaContentError, pinnedFetch, type SsrfPolicy } from "@arnilo/prism";
import { RagAbortError, RagLimitError, RagValidationError } from "./errors.js";
import type { RagHit } from "./types.js";

/** Shared HTTP plumbing for the hosted rerank adapters (TEI, OpenAI-compatible, Voyage). */

export const RERANK_DEFAULT_TIMEOUT_MS = 2000;
export const RERANK_DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;

export interface RerankHttpOptions {
  /** Absolute http(s) base URL; the rerank path is appended by the adapter. */
  readonly baseUrl: string;
  /** Per-call timeout combined with the caller signal; aborts fail closed. */
  readonly timeoutMs?: number;
  /** Maximum response body bytes. Default 65,536 (plan 021 ceiling precedent). */
  readonly maxResponseBytes?: number;
  /** SSRF policy applied on resolved hosts (default: core default). */
  readonly ssrf?: SsrfPolicy;
  /** Allow loopback destinations (local/dev services). Default `false`. */
  readonly allowLoopback?: boolean;
  /** Trusted custom transport; host owns DNS/SSRF protection (OPA precedent). */
  readonly fetch?: typeof globalThis.fetch;
}

/** Validate absolute http(s) URL shape; SSRF enforcement stays host-side. */
export function validateRerankUrl(baseUrl: string, label: string): URL {
  if (!baseUrl.trim()) throw new RagValidationError(`${label} baseUrl is required`);
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new RagValidationError(`${label} baseUrl must be an absolute URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RagValidationError(`${label} baseUrl must use http(s) (got ${url.protocol})`);
  }
  if (url.username || url.password) throw new RagValidationError(`${label} baseUrl must not embed credentials`);
  if (url.hash) throw new RagValidationError(`${label} baseUrl must not contain a fragment`);
  return url;
}

/** Join without doubling a trailing slash; callers append their rerank path. */
export function rerankEndpoint(url: URL, path: string): string {
  return `${url.toString().replace(/\/+$/, "")}${path}`;
}

/** Validate positive-integer timeout/body limits and return them with defaults. */
export function resolveRerankLimits(
  options: RerankHttpOptions,
  label: string,
): {
  timeoutMs: number;
  maxResponseBytes: number;
} {
  const timeoutMs = options.timeoutMs ?? RERANK_DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? RERANK_DEFAULT_MAX_RESPONSE_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new RagValidationError(`${label} timeoutMs must be a positive integer`);
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new RagValidationError(`${label} maxResponseBytes must be a positive integer`);
  }
  return { timeoutMs, maxResponseBytes };
}

/** Default transport: core DNS-pinned, redirect-free, byte-bounded `pinnedFetch`. */
export function resolveRerankFetch(options: RerankHttpOptions, label: string): typeof globalThis.fetch {
  const limits = resolveRerankLimits(options, label);
  const pinnedRerankFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    pinnedFetch(input instanceof URL ? input : new URL(String(input)), init, {
      errorPrefix: label,
      hostnameErrorPrefix: label,
      ssrf: options.ssrf,
      allowLoopback: options.allowLoopback,
      maxResponseBytes: limits.maxResponseBytes,
    });
  return options.fetch ?? pinnedRerankFetch;
}

/** POST JSON, check status, bound the body, parse — every failure fails closed. */
export async function postRerankJson(
  transport: typeof globalThis.fetch,
  endpoint: string,
  payload: unknown,
  options: RerankHttpOptions,
  signal: AbortSignal | undefined,
  label: string,
  host: string,
  extraHeaders?: Record<string, string>,
): Promise<unknown> {
  const limits = resolveRerankLimits(options, label);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let response: Response;
  try {
    response = await transport(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...extraHeaders },
      body: JSON.stringify(payload),
      signal: combined,
      redirect: "manual",
    });
  } catch (error) {
    if (error instanceof MediaContentError) {
      throw new RagValidationError(`${label} request denied: ${error.message}`);
    }
    if (signal?.aborted) throw new RagAbortError();
    throw new RagLimitError(`${label} exceeded ${limits.timeoutMs}ms or failed to reach ${host}`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new RagValidationError(`${label} endpoint returned HTTP ${response.status}`);
  const text = await readBoundedBody(response, limits.maxResponseBytes, label);
  try {
    return JSON.parse(text);
  } catch {
    throw new RagValidationError(`${label} response is not valid JSON`);
  }
}

async function readBoundedBody(response: Response, maxBytes: number, label: string): Promise<string> {
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
      if (total > maxBytes) throw new RagLimitError(`${label} response exceeds ${maxBytes} bytes`);
      out += decoder.decode(value, { stream: true });
    }
    return out + decoder.decode();
  } catch (error) {
    // The pinned transport may already have errored the stream (MediaContentError).
    if (error instanceof RagLimitError) throw error;
    throw new RagLimitError(`${label} response exceeds ${maxBytes} bytes`);
  }
}

/**
 * Strictly parse `{<resultsKey>: [{index, <scoreKey>}]}` and reorder hits by
 * score desc. Short/duplicate/out-of-range indices and non-finite scores fail
 * closed; ties keep original array order. Returns a frozen permutation of the
 * same hit references — provenance/trust move untouched.
 */
export function orderScores(
  hits: readonly RagHit[],
  parsed: unknown,
  resultsKey: string,
  scoreKey: string,
  label: string,
): readonly RagHit[] {
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as Record<string, unknown>)[resultsKey])) {
    throw new RagValidationError(`${label} response missing ${resultsKey} array`);
  }
  const results = (parsed as Record<string, unknown[]>)[resultsKey]!;
  if (results.length !== hits.length) {
    throw new RagValidationError(`${label} returned ${results.length} scores for ${hits.length} hits`);
  }
  const scores = new Array<number>(hits.length);
  const seen = new Set<number>();
  for (const item of results) {
    if (typeof item !== "object" || item === null) throw new RagValidationError(`${label} result must be an object`);
    const index = (item as Record<string, unknown>).index;
    const score = (item as Record<string, unknown>)[scoreKey];
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= hits.length) {
      throw new RagValidationError(`${label} returned an out-of-range index`);
    }
    if (seen.has(index)) throw new RagValidationError(`${label} returned a duplicate index`);
    if (typeof score !== "number" || !Number.isFinite(score)) throw new RagValidationError(`${label} returned a non-finite score`);
    seen.add(index);
    scores[index] = score;
  }
  const ordered = hits
    .map((hit, i) => ({ hit, score: scores[i]! }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.hit);
  return Object.freeze(ordered);
}
