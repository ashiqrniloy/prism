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
}

const TRANSIENT_CODES = new Set<string | number>([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ENOTFOUND",
  "timeout",
  "rate_limit",
  "overloaded",
  "temporarily_unavailable",
  408,
  409,
  425,
  429,
  500,
  502,
  503,
  504,
]);

export function createDefaultRetryPolicy(options: DefaultRetryPolicyOptions = {}): RetryPolicy {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 100);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 1000);
  const jitter = Math.min(1, Math.max(0, options.jitter ?? 0.25));
  const random = options.random ?? Math.random;
  const transientCodes = new Set([...TRANSIENT_CODES, ...(options.transientCodes ?? [])]);
  return {
    name: options.name ?? "default-retry",
    decide(context) {
      if (context.signal?.aborted || context.attempt >= maxAttempts || !isTransientErrorInfo(context.error, transientCodes))
        return { retry: false };
      // Provider backpressure hint (Retry-After) wins over computed backoff, always
      // capped at maxDelayMs so a hostile/huge hint cannot pin a run.
      const hint = context.error.retryAfterMs;
      const base = Math.min(
        hint !== undefined && Number.isFinite(hint) && hint >= 0 ? hint : baseDelayMs * 2 ** Math.max(0, context.attempt - 1),
        maxDelayMs,
      );
      const delayMs = jitter > 0 ? Math.round(base * (1 - jitter + random() * 2 * jitter)) : base;
      return { retry: true, delayMs };
    },
  };
}

export function isTransientErrorInfo(error: ErrorInfo, transientCodes: ReadonlySet<string | number> = TRANSIENT_CODES): boolean {
  if (error.name === "AbortError" || /aborted|abort/i.test(error.message)) return false;
  // A quota failure is a plan state, not congestion: the same attempt consumes the same allowance
  // and cannot succeed until the caller acts, so a 429 alone must not make it transient.
  if (error.failureClass === "quota") return false;
  if (error.code !== undefined && transientCodes.has(error.code)) return true;
  return /timeout|temporar|rate.?limit|overload|unavailable/i.test(error.message);
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
  });
}

export function mergeRetry(agent: false | RetryOptions | undefined, run: false | RetryOptions | undefined): RetryOptions | undefined {
  if (run === false) return undefined;
  if (run) return { ...(agent || {}), ...run };
  return agent || undefined;
}

export interface RetryLoopOptions {
  readonly retry: RetryOptions | undefined;
  readonly sessionId: string;
  readonly runId: string;
  readonly signal?: AbortSignal;
  /** Failures that skip retry entirely and propagate unchanged (guardrails, a steer interrupt). */
  readonly passthrough?: (error: unknown) => boolean;
  /** The redacted failure, and whether it is final (an already-observable failure is never retried). */
  readonly classify: (error: unknown) => { readonly info: ErrorInfo; readonly final?: boolean };
  /** Called after the policy decided to retry and before the wait. */
  readonly onRetry?: (info: ErrorInfo, delayMs: number, attempt: number) => void;
}

/**
 * The one retry loop: runs `attempt` until it succeeds, the policy says stop, or the failure is final.
 * Used by run turns (`generateWithRetry`) and by `models.client`, so both honor the same `RetryOptions`.
 */
export async function retryLoop<T>(attempt: (n: number) => Promise<T>, options: RetryLoopOptions): Promise<T> {
  const { retry, signal } = options;
  const policy = retry?.policy ?? (retry ? createDefaultRetryPolicy(retry) : undefined);
  for (let n = 1; ; n += 1) {
    try {
      return await attempt(n);
    } catch (error) {
      if (options.passthrough?.(error)) throw error;
      const { info, final } = options.classify(error);
      if (!policy || final) throw errorFromInfo(info);
      const decision = await policy.decide({
        sessionId: options.sessionId,
        runId: options.runId,
        attempt: n,
        error: info,
        metadata: retry?.metadata,
        signal,
      });
      if (!decision.retry) throw errorFromInfo(info);
      options.onRetry?.(info, decision.delayMs ?? 0, n);
      await waitForRetry(decision, signal);
    }
  }
}
