import { parseErrorBody, providerHttpError, RETRYABLE_STATUSES, readRetryAfterMs } from "../shared/retry-http.js";

/** Inputs to {@link classifyCommandCodeError}. */
export interface CommandCodeErrorInput {
  readonly status: number;
  readonly headers?: Headers | Record<string, string>;
  readonly body?: unknown;
}

/** Result of classifying a Command Code error response. */
export interface CommandCodeRetryDecision {
  readonly status: number;
  /** Whether the runtime retry policy should retry this error (numeric `code` in the core transient set). */
  readonly retryable: boolean;
  readonly code: number;
  readonly retryAfterMs?: number;
  /**
   * Error code string from the OpenAI envelope (`error.code`) or the Anthropic
   * envelope (`error.type`), e.g. `upgrade_required`, `cmd_zdr_no_providers`,
   * `rate_limit_error`, `invalid_request_error`.
   */
  readonly errorCode?: string;
}

/**
 * Classify a Command Code error response into a retry decision. Retryable statuses are
 * `429` upstream rate limits and `5xx` upstream failures ({@link RETRYABLE_STATUSES});
 * `400` (wrong endpoint or bad body), `401`, `403 upgrade_required` (Go plan — no API
 * access) and `422 cmd_zdr_no_providers` (ZDR requested, no ZDR-capable upstream) are
 * non-retryable: retrying cannot succeed. The numeric `code` is the HTTP status, for the
 * Prism retry policy's `transientCodes`; the `error.code`/`error.type` envelope field is
 * Command Code-only.
 */
export function classifyCommandCodeError(input: CommandCodeErrorInput): CommandCodeRetryDecision {
  const { status } = input;
  const errorBody = parseErrorBody(input.body);
  const retryable = RETRYABLE_STATUSES.has(status);
  return {
    status,
    retryable,
    code: status,
    retryAfterMs: retryable ? readRetryAfterMs(input.headers) : undefined,
    errorCode:
      typeof errorBody?.error?.code === "string"
        ? errorBody.error.code
        : typeof errorBody?.error?.type === "string"
          ? errorBody.error.type
          : undefined,
  };
}

/**
 * Build a redacted `Error` for a failed Command Code response, with `code` set to the
 * numeric HTTP status so the runtime retry policy can classify it. Error bodies may carry
 * the upstream provider's error message — redacted of the provided secrets through the
 * shared HTTP helper (API key / bearer token).
 */
export function commandCodeHttpError(
  decision: CommandCodeRetryDecision,
  bodyText: string,
  secrets: readonly (string | undefined)[],
): Error {
  return providerHttpError("Command Code", decision, bodyText, secrets);
}
