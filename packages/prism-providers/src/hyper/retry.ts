import { redactSecrets } from "@arnilo/prism";

/** Inputs to {@link classifyHyperError}. */
export interface HyperErrorInput {
  readonly status: number;
  readonly headers?: Headers | Record<string, string>;
  readonly body?: unknown;
}

/** Result of classifying a Hyper error response. */
export interface HyperRetryDecision {
  readonly status: number;
  /** Whether the runtime retry policy should retry this error (numeric `code` in the core transient set). */
  readonly retryable: boolean;
  readonly code: number;
  readonly retryAfterMs?: number;
  /** OpenAI-style error `code` string, e.g. `billing_error` (402), `rate_limit_error`, `authentication_error`. */
  readonly errorCode?: string;
}

/**
 * Retryable Hyper status codes: 429 rate limits and 5xx upstream failures.
 * 400/401/402/403/404 are non-retryable (402 billing_error = insufficient
 * Hypercredits; retrying cannot succeed).
 */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);

/**
 * Classify a Hyper error response into a retry decision. The numeric `code` is
 * intended for `ErrorInfo.code` so the Prism default retry policy
 * (`transientCodes` includes 429/500/502/503) decides retryability without
 * provider-specific core branches. Classification is O(1) and makes no extra
 * provider calls.
 */
export function classifyHyperError(input: HyperErrorInput): HyperRetryDecision {
  const { status } = input;
  const errorBody = parseErrorBody(input.body);
  const retryAfterMs = readRetryAfterMs(input.headers);
  return {
    status,
    retryable: RETRYABLE_STATUSES.has(status),
    code: status,
    retryAfterMs: RETRYABLE_STATUSES.has(status) ? retryAfterMs : undefined,
    errorCode: typeof errorBody?.error?.code === "string" ? errorBody.error.code : undefined,
  };
}

/**
 * Build a redacted `Error` for a failed Hyper response, with `code` set to the
 * numeric HTTP status so the runtime retry policy can classify it. The message
 * is redacted of the provided secrets (API key / bearer token) and includes the
 * status, a safe error code, and retry-after hint when present.
 */
export function hyperHttpError(decision: HyperRetryDecision, bodyText: string, secrets: readonly (string | undefined)[]): Error {
  const parts = [`Hyper request failed: ${decision.status}`];
  if (decision.errorCode) parts.push(`code=${decision.errorCode}`);
  if (decision.retryAfterMs !== undefined) parts.push(`retry_after_ms=${decision.retryAfterMs}`);
  const suffix = bodyText ? ` ${redactSecrets(bodyText, secrets)}` : "";
  const error = new Error(`${parts.join(" ")}${suffix}`);
  Object.defineProperty(error, "code", { value: decision.code, enumerable: true, writable: false, configurable: false });
  return error;
}

function parseErrorBody(body: unknown): { error?: { code?: unknown } } | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const error = (body as { error?: unknown }).error;
  if (error && typeof error === "object" && !Array.isArray(error)) {
    return { error: error as { code?: unknown } };
  }
  return undefined;
}

function readRetryAfterMs(headers: HyperErrorInput["headers"]): number | undefined {
  if (!headers) return undefined;
  const raw = headers instanceof Headers ? headers.get("retry-after") : readHeader(headers, "retry-after");
  if (raw === undefined || raw === null) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : undefined;
}

function readHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === lower);
  const value = entry?.[1];
  return typeof value === "string" && value.trim() ? value : undefined;
}