import { setTimeout as sleep } from "node:timers/promises";
import type { ErrorInfo, RetryDecision, RetryOptions, RetryPolicy } from "../contracts.js";

export interface DefaultRetryPolicyOptions {
  readonly name?: string;
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly transientCodes?: readonly (string | number)[];
  /** Symmetric jitter fraction applied to computed delays (default 0.25 → ±25%).
   *  Prevents thundering-herd retries under a shared outage. Set 0 to disable. */
  readonly jitter?: number;
  /** Random source for jitter (tests); defaults to Math.random. */
  readonly random?: () => number;
  /** Longest `Retry-After` hint honored (default 60,000; hard cap 600,000). A longer hint stops retrying. */
  readonly maxRetryAfterMs?: number;
}

/** Default policy: 4 attempts, 500 ms base doubling per attempt, 30 s cap, ±25% jitter. */
const DEFAULT_RETRY_MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_RETRY_MAX_DELAY_MS = 30_000;
/**
 * Longest sleep on one `Retry-After` hint when the host sets no `retry.maxRetryAfterMs`. The host's value is the
 * ceiling (plan 239 Task 4): a provider's hint above it is not honored as a delay.
 */
const DEFAULT_MAX_RETRY_AFTER_MS = 60_000;

/**
 * Connection failures worth another attempt: the Node/undici spellings and what Bun's `fetch`
 * throws for a reset, a refused connection and a DNS failure (plan 227 Task 1(b)). One set serves
 * `isTransientErrorInfo` and `classifyProviderFailure`.
 */
export const TRANSIENT_NETWORK_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
]);

const TRANSIENT_CODES: ReadonlySet<string | number> = new Set<string | number>([
  ...TRANSIENT_NETWORK_CODES,
  "timeout",
  "rate_limit",
  "overloaded",
  "temporarily_unavailable",
  408,
  425,
  429,
  500,
  502,
  503,
  504,
]);

/** Failure classes no retry can fix: the same request meets the same answer until the caller acts. */
const NEVER_RETRIED = new Set<ErrorInfo["failureClass"]>(["quota", "auth", "permanent", "context_overflow"]);

export function createDefaultRetryPolicy(options: DefaultRetryPolicyOptions = {}): RetryPolicy {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_RETRY_MAX_ATTEMPTS);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS);
  const maxRetryAfterMs = Math.max(0, options.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS);
  const jitter = Math.min(1, Math.max(0, options.jitter ?? 0.25));
  const random = options.random ?? Math.random;
  const transientCodes = new Set([...TRANSIENT_CODES, ...(options.transientCodes ?? [])]);
  return {
    name: options.name ?? "default-retry",
    decide(context) {
      if (context.signal?.aborted || context.attempt >= maxAttempts || !isTransientErrorInfo(context.error, transientCodes))
        return { retry: false };
      // The provider's backpressure hint is the delay, exactly, when it is within the bound; a longer
      // hint fails the turn now rather than pinning the run, so a hostile `Retry-After` costs nothing.
      const hint = context.error.retryAfterMs;
      if (hint !== undefined && Number.isFinite(hint) && hint >= 0) {
        return hint <= maxRetryAfterMs ? { retry: true, delayMs: Math.round(hint) } : { retry: false };
      }
      const base = Math.min(baseDelayMs * 2 ** Math.max(0, context.attempt - 1), maxDelayMs);
      const delayMs = jitter > 0 ? Math.round(base * (1 - jitter + random() * 2 * jitter)) : base;
      return { retry: true, delayMs };
    },
  };
}

/**
 * Whether a failure is worth another attempt, from its structured fields only: `name`, `failureClass`
 * and `code`. Message text is never read, so wording ("connection aborted") cannot flip the answer.
 */
export function isTransientErrorInfo(error: ErrorInfo, transientCodes: ReadonlySet<string | number> = TRANSIENT_CODES): boolean {
  if (error.name === "AbortError") return false;
  // A quota failure is a plan state, not congestion: the same attempt consumes the same allowance
  // and cannot succeed until the caller acts, so a 429 alone must not make it transient.
  if (NEVER_RETRIED.has(error.failureClass)) return false;
  if (error.code !== undefined && transientCodes.has(typeof error.code === "string" ? normalizeCode(error.code) : error.code)) return true;
  return error.failureClass === "transient" || error.failureClass === "rate_limited";
}

function normalizeCode(code: string): string {
  return TRANSIENT_NETWORK_CODES.has(code.toUpperCase()) ? code.toUpperCase() : code;
}

export async function waitForRetry(decision: RetryDecision, signal?: AbortSignal): Promise<void> {
  const delayMs = Math.max(0, decision.delayMs ?? 0);
  if (delayMs === 0) return;
  await sleep(delayMs, undefined, { signal, ref: false });
}

export function errorFromInfo(error: ErrorInfo): Error {
  return Object.assign(new Error(error.message), {
    name: error.name ?? "Error",
    cause: error.cause,
    code: error.code,
    failureClass: error.failureClass,
    ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
  });
}

/**
 * The effective retry options for one call, in three states: `undefined` when the run or the agent
 * said `retry: false` (off), `{}` when neither configured retry (the default policy), or the merged
 * explicit options (run fields over agent fields, defaults for any field both omit).
 */
export function mergeRetry(agent: false | RetryOptions | undefined, run: false | RetryOptions | undefined): RetryOptions | undefined {
  if (run === false) return undefined;
  if (run) return { ...(agent || {}), ...run };
  if (agent === false) return undefined;
  return agent ?? {};
}

export interface RetryLoopOptions {
  readonly retry: RetryOptions | undefined;
  readonly sessionId: string;
  readonly runId: string;
  readonly signal?: AbortSignal;
  /** Failures that skip retry entirely and propagate unchanged (guardrails, a steer interrupt). */
  readonly passthrough?: (error: unknown) => boolean;
  /** The redacted failure, and whether it is final (no policy may retry it). */
  readonly classify: (error: unknown) => { readonly info: ErrorInfo; readonly final?: boolean };
  /** Called after the policy decided to retry and before the wait. */
  readonly onRetry?: (info: ErrorInfo, delayMs: number, attempt: number) => void;
}

/**
 * Asks, from inside a failing attempt and before it settles, whether the loop will retry this failure.
 * The policy is consulted once per attempt: the loop reuses that decision when the attempt then throws,
 * so the attempt can act on it (plan 227 Task 4: a retried attempt projects no usage estimate).
 */
export type RetryProbe = (info: ErrorInfo, final?: boolean) => Promise<boolean>;

/**
 * The one retry loop: runs `attempt` until it succeeds, the policy says stop, or the failure is final.
 * Used by run turns (`generateWithRetry`) and by `models.client`, so both honor the same `RetryOptions`.
 */
export async function retryLoop<T>(attempt: (n: number, willRetry: RetryProbe) => Promise<T>, options: RetryLoopOptions): Promise<T> {
  const { retry, signal } = options;
  const policy = retry?.policy ?? (retry ? createDefaultRetryPolicy(retry) : undefined);
  for (let n = 1; ; n += 1) {
    let decided: RetryDecision | undefined;
    const decide = async (info: ErrorInfo): Promise<RetryDecision> => {
      decided ??= await policy!.decide({
        sessionId: options.sessionId,
        runId: options.runId,
        attempt: n,
        error: info,
        metadata: retry?.metadata,
        signal,
      });
      return decided;
    };
    const willRetry: RetryProbe = async (info, final) => (!policy || final ? false : (await decide(info)).retry);
    try {
      return await attempt(n, willRetry);
    } catch (error) {
      if (options.passthrough?.(error)) throw error;
      const { info, final } = options.classify(error);
      if (!policy || final) throw errorFromInfo(info);
      const decision = await decide(info);
      if (!decision.retry) throw errorFromInfo(info);
      options.onRetry?.(info, decision.delayMs ?? 0, n);
      await waitForRetry(decision, signal);
    }
  }
}
