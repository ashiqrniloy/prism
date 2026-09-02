import { redactSecrets } from "@arnilo/prism";

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
 * Retryable Command Code statuses: `429` upstream rate limits (retry with
 * backoff) and `5xx` upstream failures. `400` (wrong endpoint / bad body),
 * `401`, `403 upgrade_required` (Go plan — no API access) and
 * `422 cmd_zdr_no_providers` (ZDR requested, no ZDR-capable upstream) are
 * non-retryable: retrying cannot succeed.
 */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);

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
 * Build a redacted `Error` for a failed Command Code response, with `code` set
 * to the numeric HTTP status so the runtime retry policy can classify it.
 * Error bodies may carry the upstream provider's error message — always
 * redacted of the provided secrets (API key / bearer token).
 */
export function commandCodeHttpError(
  decision: CommandCodeRetryDecision,
  bodyText: string,
  secrets: readonly (string | undefined)[],
): Error {
  const parts = [`Command Code request failed: ${decision.status}`];
  if (decision.errorCode) parts.push(`code=${decision.errorCode}`);
  if (decision.retryAfterMs !== undefined) parts.push(`retry_after_ms=${decision.retryAfterMs}`);
  const suffix = bodyText ? ` ${redactSecrets(bodyText, secrets)}` : "";
  const error = new Error(`${parts.join(" ")}${suffix}`);
  Object.defineProperty(error, "code", { value: decision.code, enumerable: true, writable: false, configurable: false });
  return error;
}

function parseErrorBody(body: unknown): { error?: { code?: unknown; type?: unknown } } | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const error = (body as { error?: unknown }).error;
  if (error && typeof error === "object" && !Array.isArray(error)) {
    return { error: error as { code?: unknown; type?: unknown } };
  }
  return undefined;
}

function readRetryAfterMs(headers: CommandCodeErrorInput["headers"]): number | undefined {
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