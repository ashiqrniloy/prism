import { redactSecrets } from "@arnilo/prism";

/** NeuralWatt `error.retry_strategy` object documented for 429/503 responses. */
export interface NeuralWattRetryStrategy {
  readonly type?: string;
  readonly suggested_initial_delay_s?: number;
  readonly max_delay_s?: number;
  readonly backoff?: string;
  readonly jitter?: string;
}

/** Inputs to {@link classifyNeuralWattError}. */
export interface NeuralWattErrorInput {
  readonly status: number;
  readonly headers?: Headers | Record<string, string>;
  readonly body?: unknown;
}

/** Result of classifying a NeuralWatt error response. */
export interface NeuralWattRetryDecision {
  /** HTTP status code of the failed response. */
  readonly status: number;
  /** Whether the runtime retry policy should retry this error. */
  readonly retryable: boolean;
  /** Numeric HTTP status suitable for `ErrorInfo.code` (set on emitted errors). */
  readonly code: number;
  /** Parsed `Retry-After` (seconds) or `error.retry_after`, converted to ms. */
  readonly retryAfterMs?: number;
  /** NeuralWatt error `code` string (e.g. `concurrent_budget_exceeded`). */
  readonly errorCode?: string;
  /** Preserved `retry_strategy` object, stripped to safe documented fields. */
  readonly strategy?: NeuralWattRetryStrategy;
}

/** Non-retryable NeuralWatt client status codes. */
const NON_RETRYABLE_STATUSES = new Set([400, 401, 402, 403, 404]);
/** Retryable NeuralWatt server/rate-limit status codes. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);

/**
 * Classify a NeuralWatt error response into a retry decision. Status 400/401/402/
 * 403/404 are non-retryable; 429/500/502/503 are retryable. For 429 and 503 the
 * classifier reads `Retry-After` (header or `error.retry_after`) and preserves
 * the safe `retry_strategy` fields. Classification is O(1) over status/headers/
 * body and makes no extra provider calls.
 *
 * The numeric `code` is intended for `ErrorInfo.code` so the Prism default retry
 * policy (`transientCodes` includes 429/500/502/503) can decide retryability
 * without provider-specific core branches. The host retry policy owns the exact
 * delay; `retryAfterMs` is surfaced for hosts/tests that want to honor it.
 */
export function classifyNeuralWattError(input: NeuralWattErrorInput): NeuralWattRetryDecision {
  const { status } = input;
  const retryable = RETRYABLE_STATUSES.has(status);
  const errorBody = parseErrorBody(input.body);
  const retryAfterMs = readRetryAfterMs(input.headers, errorBody);
  return {
    status,
    retryable,
    code: status,
    retryAfterMs: retryable ? retryAfterMs : undefined,
    errorCode: typeof errorBody?.error?.code === "string" ? errorBody.error.code : undefined,
    strategy: retryable ? cleanStrategy(errorBody?.error?.retry_strategy) : undefined,
  };
}

/**
 * Build a redacted `Error` for a failed NeuralWatt response, with `code` set to
 * the numeric HTTP status so the runtime retry policy can classify it. The
 * message is redacted of the provided secrets (API key / bearer token) and
 * includes the status, a safe error code, and retry-after hint when present.
 */
export function neuralWattHttpError(decision: NeuralWattRetryDecision, bodyText: string, secrets: readonly (string | undefined)[]): Error {
  const parts = [`NeuralWatt request failed: ${decision.status}`];
  if (decision.errorCode) parts.push(`code=${decision.errorCode}`);
  if (decision.retryAfterMs !== undefined) parts.push(`retry_after_ms=${decision.retryAfterMs}`);
  const suffix = bodyText ? ` ${redactSecrets(bodyText, secrets)}` : "";
  const error = new Error(`${parts.join(" ")}${suffix}`);
  Object.defineProperty(error, "code", { value: decision.code, enumerable: true, writable: false, configurable: false });
  return error;
}

function parseErrorBody(body: unknown): { error?: { code?: unknown; retry_after?: unknown; retry_strategy?: unknown } } | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const error = (body as { error?: unknown }).error;
  if (error && typeof error === "object" && !Array.isArray(error)) {
    return { error: error as { code?: unknown; retry_after?: unknown; retry_strategy?: unknown } };
  }
  return undefined;
}

function readRetryAfterMs(headers: NeuralWattErrorInput["headers"], body: { error?: { retry_after?: unknown } } | undefined): number | undefined {
  const raw = readHeader(headers, "retry-after") ?? readNumber(body?.error?.retry_after);
  if (raw === undefined) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : undefined;
}

function readHeader(headers: NeuralWattErrorInput["headers"], name: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) {
    const value = headers.get(name);
    return value ?? undefined;
  }
  const lower = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === lower);
  const value = entry?.[1];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined;
}

function cleanStrategy(value: unknown): NeuralWattRetryStrategy | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const s = value as Record<string, unknown>;
  return {
    type: typeof s.type === "string" ? s.type : undefined,
    suggested_initial_delay_s: typeof s.suggested_initial_delay_s === "number" ? s.suggested_initial_delay_s : undefined,
    max_delay_s: typeof s.max_delay_s === "number" ? s.max_delay_s : undefined,
    backoff: typeof s.backoff === "string" ? s.backoff : undefined,
    jitter: typeof s.jitter === "string" ? s.jitter : undefined,
  };
}
