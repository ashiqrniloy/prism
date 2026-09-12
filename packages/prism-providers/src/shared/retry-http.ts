/**
 * HTTP-plane helpers shared by the provider retry classifiers (plan 070 Task 11).
 *
 * Providers keep their own decisions — status tables, which body fields they honor,
 * `retry_strategy` preservation, everything wire-specific — and share only the mechanical
 * reading plus the redacting error builder, so provider error text meets `redactSecrets`
 * in exactly one place. Classification is O(1) and makes no extra provider calls.
 */
import { redactSecrets } from "@arnilo/prism";

/** Upstream statuses every classifier retries: 429 rate limits and 5xx upstream failures. */
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503]);

/** Decision fields the redacting error builder reads (every provider decision satisfies this). */
interface RetryDecisionFields {
  readonly status: number;
  readonly code: number;
  readonly errorCode?: string;
  readonly retryAfterMs?: number;
}

/** `Retry-After` sources: a `Headers` instance or a plain header record. */
type RetryHeaders = Headers | Record<string, string> | undefined;

/**
 * `Retry-After` as milliseconds, read from the header (seconds) or — when the caller passes
 * `bodyRetryAfter` — from a numeric/string body field (NeuralWatt's `error.retry_after`;
 * callers that do not honor a body field leave it undefined). Malformed or negative values
 * yield `undefined` (no hint) rather than a bogus delay.
 */
export function readRetryAfterMs(headers: RetryHeaders, bodyRetryAfter?: unknown): number | undefined {
  const raw = readHeader(headers, "retry-after") ?? readNumber(bodyRetryAfter);
  if (raw === undefined) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : undefined;
}

/** `error` object of a provider error envelope, or `undefined` for any other body shape. */
export function parseErrorBody(body: unknown): { error?: Record<string, unknown> } | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const error = (body as { error?: unknown }).error;
  return error && typeof error === "object" && !Array.isArray(error) ? { error: error as Record<string, unknown> } : undefined;
}

/**
 * Build a redacted `Error` for a failed provider response. `code` carries the numeric HTTP
 * status so the Prism default retry policy (`transientCodes`) can classify it without
 * provider-specific core branches; the message includes the status, a safe error code, and
 * a retry-after hint, with the response body passed through `redactSecrets`.
 */
export function providerHttpError(
  providerName: string,
  decision: RetryDecisionFields,
  bodyText: string,
  secrets: readonly (string | undefined)[],
): Error {
  const parts = [`${providerName} request failed: ${decision.status}`];
  if (decision.errorCode) parts.push(`code=${decision.errorCode}`);
  if (decision.retryAfterMs !== undefined) parts.push(`retry_after_ms=${decision.retryAfterMs}`);
  const suffix = bodyText ? ` ${redactSecrets(bodyText, secrets)}` : "";
  const error = new Error(`${parts.join(" ")}${suffix}`);
  Object.defineProperty(error, "code", { value: decision.code, enumerable: true, writable: false, configurable: false });
  return error;
}

function readHeader(headers: RetryHeaders, name: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const lower = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === lower);
  const value = entry?.[1];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() && Number.isFinite(Number(value))
      ? Number(value)
      : undefined;
}
