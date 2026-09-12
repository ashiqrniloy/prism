import { parseErrorBody, providerHttpError, RETRYABLE_STATUSES, readRetryAfterMs } from "../shared/retry-http.js";

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
 * Classify a Hyper error response into a retry decision. The numeric `code` is
 * intended for `ErrorInfo.code` so the Prism default retry policy
 * (`transientCodes` includes 429/500/502/503) decides retryability without
 * provider-specific core branches. Classification is O(1) and makes no extra
 * provider calls.
 *
 * Hyper retries 429 and 5xx ({@link RETRYABLE_STATUSES}); 400/401/402/403/404 are
 * non-retryable (402 billing_error = insufficient Hypercredits; retrying cannot
 * succeed).
 */
export function classifyHyperError(input: HyperErrorInput): HyperRetryDecision {
  const { status } = input;
  const errorBody = parseErrorBody(input.body);
  const retryAfterMs = readRetryAfterMs(input.headers);
  const retryable = RETRYABLE_STATUSES.has(status);
  return {
    status,
    retryable,
    code: status,
    retryAfterMs: retryable ? retryAfterMs : undefined,
    errorCode: typeof errorBody?.error?.code === "string" ? errorBody.error.code : undefined,
  };
}

/**
 * Build a redacted `Error` for a failed Hyper response, with `code` set to the
 * numeric HTTP status so the runtime retry policy can classify it. The message is
 * redacted of the provided secrets through the shared HTTP helper.
 */
export function hyperHttpError(decision: HyperRetryDecision, bodyText: string, secrets: readonly (string | undefined)[]): Error {
  return providerHttpError("Hyper", decision, bodyText, secrets);
}
