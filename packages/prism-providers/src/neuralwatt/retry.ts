import { parseErrorBody, providerHttpError, RETRYABLE_STATUSES, readRetryAfterMs } from "../shared/retry-http.js";

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

/**
 * Classify a NeuralWatt error response into a retry decision. Status 400/401/402/
 * 403/404 are non-retryable; 429/500/502/503 are retryable. For 429 and 503 the
 * classifier reads `Retry-After` (header or `error.retry_after` — the body fallback
 * is NeuralWatt-only) and preserves the safe `retry_strategy` fields. Classification
 * is O(1) over status/headers/body and makes no extra provider calls.
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
  const retryAfterMs = readRetryAfterMs(input.headers, errorBody?.error?.retry_after);
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
 * the numeric HTTP status so the runtime retry policy can classify it. The message is
 * redacted of the provided secrets through the shared HTTP helper.
 */
export function neuralWattHttpError(decision: NeuralWattRetryDecision, bodyText: string, secrets: readonly (string | undefined)[]): Error {
  return providerHttpError("NeuralWatt", decision, bodyText, secrets);
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
