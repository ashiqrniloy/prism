/**
 * Shared System One wire client for decision models that answer typed questions in one
 * non-autoregressive pass through `POST /v1/systemone`: TypeSafe Jev's hosted API and Laya's
 * self-hosted `laya-serve`, which mirrors Jev's wire shape by design.
 *
 * The client owns the wire contract — request body, optional Bearer auth, bounded JSON
 * parsing, usage mapping, retryable/non-retryable error classification — and carries no
 * vendor constants: base URLs, model ids and env var names stay in the provider packages.
 */
import type { CredentialValueSource, JsonObject, Usage } from "@arnilo/prism";
import { createDefaultRetryPolicy, resolveCredentialValue, trimTrailingSlashes, waitForRetry } from "@arnilo/prism";
import { readBoundedResponseJson, readBoundedResponseText } from "@arnilo/prism/providers/transport";
import { parseErrorBody, providerHttpError, readRetryAfterMs } from "./retry-http.js";

/** Text, structured criteria, or message-part arrays accepted as question instructions. */
export type SystemOneInstructions = string | JsonObject | readonly unknown[];

export interface SystemOneNoulQuestion {
  readonly type: "noul";
  readonly instructions: SystemOneInstructions;
  /** Optional descriptions for the true/false outcomes. */
  readonly criteria?: { readonly true?: string; readonly false?: string };
}

export interface SystemOneChoiceQuestion {
  readonly type: "choice";
  readonly instructions: SystemOneInstructions;
  /** Option → description (or `null` for no description); 2–255 options. */
  readonly criteria: Readonly<Record<string, string | null>>;
}

export interface SystemOneScoreQuestion {
  readonly type: "score";
  readonly instructions: SystemOneInstructions;
  /** Ordered level descriptions; 2–10 levels. */
  readonly criteria: readonly string[];
}

/** One typed decision question, discriminated by `type`. */
export type SystemOneQuestion = SystemOneNoulQuestion | SystemOneChoiceQuestion | SystemOneScoreQuestion;

export interface SystemOneNoulAnswer {
  readonly type: "noul";
  /** Calibrated probability in 0..1. */
  readonly noul: number;
}

export interface SystemOneChoiceAnswer {
  readonly type: "choice";
  readonly choice: string;
  readonly probabilities?: Readonly<Record<string, number>>;
  /** Calibrated confidence in 0..1. */
  readonly confidence?: number;
}

export interface SystemOneScoreAnswer {
  readonly type: "score";
  /** May land between levels. */
  readonly score: number;
  readonly legend?: Readonly<Record<string, string>>;
  readonly probabilities?: Readonly<Record<string, number>>;
  readonly confidence?: number;
}

/** One answered question, discriminated by `type`. */
export type SystemOneAnswer = SystemOneNoulAnswer | SystemOneChoiceAnswer | SystemOneScoreAnswer;

/** Conversation content only — questions written into `state` get judged, not answered. */
export type SystemOneState = string | JsonObject | readonly unknown[];

/** `POST /v1/systemone` request body. */
export interface SystemOneBody {
  readonly model: string;
  readonly state: SystemOneState;
  readonly questions: Readonly<Record<string, SystemOneQuestion>>;
}

export interface SystemOneUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
}

export interface SystemOneResponse {
  /** Checkpoint that answered; the request's `model` is advisory. */
  readonly model: string;
  readonly answers: Readonly<Record<string, SystemOneAnswer>>;
  readonly usage?: SystemOneUsage;
}

/** Base failure of a System One request; `code`/`status` are the numeric HTTP status. */
export class SystemOneError extends Error {
  readonly status: number;
  readonly code: number;
  readonly retryAfterMs?: number;

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = "SystemOneError";
    this.status = status;
    this.code = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** 401 — the configured API key was rejected; never retried. */
export class SystemOneAuthError extends SystemOneError {
  constructor(message: string, status = 401, retryAfterMs?: number) {
    super(message, status, retryAfterMs);
    this.name = "SystemOneAuthError";
  }
}

/** 422 — the API rejected the request body; the message carries the field-level detail. Never retried. */
export class SystemOneInvalidRequestError extends SystemOneError {
  constructor(message: string, status = 422, retryAfterMs?: number) {
    super(message, status, retryAfterMs);
    this.name = "SystemOneInvalidRequestError";
  }
}

/** A retryable status (429/5xx) survived every bounded retry attempt. */
export class SystemOneRetryExhaustedError extends SystemOneError {
  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message, status, retryAfterMs);
    this.name = "SystemOneRetryExhaustedError";
  }
}

export interface SystemOneClientOptions {
  /** Name used in error messages and credential resolution, e.g. `"TypeSafe Jev"`. */
  readonly provider: string;
  /** Base URL without the path; `/v1/systemone` is appended (trailing slashes trimmed). */
  readonly baseUrl: string;
  /** Bearer credential; omitted → no `Authorization` header (anonymous `laya-serve`). */
  readonly apiKey?: CredentialValueSource;
  /** Fetch implementation; defaults to global `fetch` (tests inject a fake). */
  readonly fetch?: typeof fetch;
  /** Retries after the first attempt. Default: {@link DEFAULT_SYSTEMONE_MAX_RETRIES}. */
  readonly maxRetries?: number;
  /** Base backoff before jitter, forwarded to the shared retry policy. */
  readonly baseDelayMs?: number;
  /** Backoff ceiling — also caps a `Retry-After` hint. Forwarded to the shared retry policy. */
  readonly maxDelayMs?: number;
  /** Symmetric jitter fraction, forwarded to the shared retry policy. Default 0.25. */
  readonly jitter?: number;
  /** Random source for jitter (tests); defaults to `Math.random`. */
  readonly random?: () => number;
}

/** Retries after the first attempt when {@link SystemOneClientOptions.maxRetries} is omitted. */
export const DEFAULT_SYSTEMONE_MAX_RETRIES = 2;

/** 429 rate limits and every 5xx upstream failure (529 overloaded included) are retryable. */
export function isRetryableSystemOneStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Minimal success-body gate: an object carrying `model` and an `answers` record. */
export function isSystemOneResponse(value: unknown): value is SystemOneResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as { readonly model?: unknown; readonly answers?: unknown };
  return (
    typeof response.model === "string" && !!response.answers && typeof response.answers === "object" && !Array.isArray(response.answers)
  );
}

/**
 * Maps a System One `usage` envelope to Prism `Usage`. Decision models produce no output
 * tokens (the wire's `output_tokens` is always 0), so only input tokens are counted.
 */
export function mapSystemOneUsage(usage: SystemOneUsage | undefined): Usage | undefined {
  if (!usage) return undefined;
  const inputTokens = usage.input_tokens ?? 0;
  return { inputTokens, outputTokens: 0, totalTokens: inputTokens };
}

/**
 * POST one System One body and return the parsed answers. One round trip per successful
 * request; retryable statuses (429/5xx) are retried up to `maxRetries` with jittered
 * backoff honoring `Retry-After`. 401/422 and other non-retryable statuses throw their
 * typed error immediately; the response is read through the bounded JSON helper and the
 * API key is redacted from every error message.
 */
export async function postSystemOne(
  body: SystemOneBody,
  options: SystemOneClientOptions,
  signal?: AbortSignal,
): Promise<SystemOneResponse> {
  signal?.throwIfAborted();
  const fetchImpl = options.fetch ?? fetch;
  const apiKey = await resolveCredentialValue(options.apiKey, { provider: options.provider, name: "apiKey" });
  const secrets = [apiKey];
  const url = `${trimTrailingSlashes(options.baseUrl)}/v1/systemone`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const payload = JSON.stringify(body);
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_SYSTEMONE_MAX_RETRIES);

  for (let attempt = 1; ; attempt += 1) {
    signal?.throwIfAborted();
    const response = await fetchImpl(url, { method: "POST", headers, body: payload, signal });
    if (response.ok) {
      return await readBoundedResponseJson<SystemOneResponse>(response, { signal, secrets, shape: isSystemOneResponse });
    }

    const bodyText = await readBoundedResponseText(response, { secrets });
    const status = response.status;
    const retryable = isRetryableSystemOneStatus(status);
    const retryAfterMs = retryable ? readRetryAfterMs(response.headers) : undefined;
    const decision = { status, code: status, retryAfterMs, errorCode: readErrorCode(bodyText) };
    if (!retryable) throw systemOneError(options.provider, decision, bodyText, secrets, false);

    const outcome = await systemOneRetryDecision(options, attempt, maxRetries, status, retryAfterMs, signal);
    if (!outcome.retry) throw systemOneError(options.provider, decision, bodyText, secrets, true);
    await waitForRetry(outcome, signal);
  }
}

/**
 * Backoff for a status this client already classified retryable. The shared policy computes
 * the jittered delay and honors `Retry-After`; the status is registered as transient because
 * the policy's default table covers 429/500/502/503/504 only, not every 5xx.
 */
function systemOneRetryDecision(
  options: SystemOneClientOptions,
  attempt: number,
  maxRetries: number,
  status: number,
  retryAfterMs: number | undefined,
  signal?: AbortSignal,
) {
  const policy = createDefaultRetryPolicy({
    name: `${options.provider} systemone`,
    maxAttempts: maxRetries + 1,
    baseDelayMs: options.baseDelayMs,
    maxDelayMs: options.maxDelayMs,
    jitter: options.jitter,
    random: options.random,
    transientCodes: [status],
  });
  return policy.decide({
    sessionId: "systemone",
    runId: "systemone",
    attempt,
    error: { name: "SystemOneError", message: "retryable System One response", code: status, retryAfterMs },
    signal,
  });
}

/**
 * Builds the typed error through the redacting error builder, so the response body (which
 * may echo state) and the API key never reach logs unredacted. `providerHttpError` computes
 * the message (status, safe error code, retry-after, redacted body); the typed subclass is
 * chosen by status.
 */
function systemOneError(
  provider: string,
  decision: { readonly status: number; readonly code: number; readonly errorCode?: string; readonly retryAfterMs?: number },
  bodyText: string,
  secrets: readonly (string | undefined)[],
  retryExhausted: boolean,
): SystemOneError {
  const message = providerHttpError(provider, decision, bodyText, secrets).message;
  if (retryExhausted) return new SystemOneRetryExhaustedError(message, decision.status, decision.retryAfterMs);
  if (decision.status === 401) return new SystemOneAuthError(message, decision.status, decision.retryAfterMs);
  if (decision.status === 422) return new SystemOneInvalidRequestError(message, decision.status, decision.retryAfterMs);
  return new SystemOneError(message, decision.status, decision.retryAfterMs);
}

/** Safe error-envelope code string (`error.code`) when the body carries one. */
function readErrorCode(bodyText: string): string | undefined {
  if (!bodyText.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return undefined;
  }
  const error = parseErrorBody(parsed)?.error;
  return typeof error?.code === "string" ? error.code : undefined;
}
