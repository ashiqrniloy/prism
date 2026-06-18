import { setTimeout as sleep } from "node:timers/promises";
import type { ErrorInfo, RetryContext, RetryDecision, RetryPolicy } from "./contracts.js";

export interface DefaultRetryPolicyOptions {
  readonly name?: string;
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly transientCodes?: readonly (string | number)[];
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
  const transientCodes = new Set([...TRANSIENT_CODES, ...(options.transientCodes ?? [])]);
  return {
    name: options.name ?? "default-retry",
    decide(context) {
      if (context.signal?.aborted || context.attempt >= maxAttempts || !isTransientErrorInfo(context.error, transientCodes)) return { retry: false };
      return { retry: true, delayMs: Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, context.attempt - 1)) };
    },
  };
}

export function isTransientErrorInfo(error: ErrorInfo, transientCodes: ReadonlySet<string | number> = TRANSIENT_CODES): boolean {
  if (error.name === "AbortError" || /aborted|abort/i.test(error.message)) return false;
  if (error.code !== undefined && transientCodes.has(error.code)) return true;
  return /timeout|temporar|rate.?limit|overload|unavailable/i.test(error.message);
}

export async function waitForRetry(decision: RetryDecision, signal?: AbortSignal): Promise<void> {
  const delayMs = Math.max(0, decision.delayMs ?? 0);
  if (delayMs === 0) return;
  await sleep(delayMs, undefined, { signal, ref: false });
}
