import type { PrismServerAuthorization, PrismServerOperation } from "./types.js";

export interface PrismServerRateLimitDenial {
  readonly retryAfterMs?: number;
  /** Attributable denial code for hosts/logs. Default ERR_PRISM_SERVER_RATE_LIMIT. */
  readonly code?: string;
  readonly message?: string;
}

export interface PrismServerRateLimitInput {
  readonly request: Request;
  readonly operation: PrismServerOperation;
  readonly capabilityId: string;
  readonly authorization: PrismServerAuthorization;
  readonly signal: AbortSignal;
}

/** Return `true` to admit; return a denial object to short-circuit with 429. */
export type PrismServerRateLimiter = (
  input: PrismServerRateLimitInput,
) => true | PrismServerRateLimitDenial | Promise<true | PrismServerRateLimitDenial>;

export interface MemoryRateLimiterOptions {
  readonly maxRequests: number;
  readonly windowMs: number;
  /** Default: identity tenant/account/user + operation. */
  readonly key?: (input: PrismServerRateLimitInput) => string;
  /** Cap distinct keys retained (oldest eviction). Default 1024. */
  readonly maxKeys?: number;
}

/** Tiny in-memory sliding window for tests/single-process hosts. Not a distributed limiter. */
export function createMemoryRateLimiter(options: MemoryRateLimiterOptions): PrismServerRateLimiter {
  if (!Number.isSafeInteger(options.maxRequests) || options.maxRequests < 1) {
    throw new RangeError("maxRequests must be a positive safe integer");
  }
  if (!Number.isSafeInteger(options.windowMs) || options.windowMs < 1) {
    throw new RangeError("windowMs must be a positive safe integer");
  }
  const maxKeys = options.maxKeys ?? 1024;
  if (!Number.isSafeInteger(maxKeys) || maxKeys < 1) throw new RangeError("maxKeys must be a positive safe integer");
  const buckets = new Map<string, number[]>();

  return (input) => {
    input.signal.throwIfAborted();
    const key = options.key?.(input) ?? defaultKey(input);
    const now = Date.now();
    const windowStart = now - options.windowMs;
    let stamps = (buckets.get(key) ?? []).filter((t) => t > windowStart);
    if (stamps.length >= options.maxRequests) {
      const oldest = stamps[0] ?? now;
      return {
        retryAfterMs: Math.max(1, oldest + options.windowMs - now),
        code: "ERR_PRISM_SERVER_RATE_LIMIT",
        message: "Rate limit exceeded",
      };
    }
    stamps = [...stamps, now];
    if (!buckets.has(key) && buckets.size >= maxKeys) {
      const first = buckets.keys().next().value;
      if (first !== undefined) buckets.delete(first);
    }
    buckets.set(key, stamps);
    return true;
  };
}

function defaultKey(input: PrismServerRateLimitInput): string {
  const o = input.authorization.ownership;
  return `${o.tenantId ?? ""}\0${o.accountId ?? ""}\0${o.userId ?? ""}\0${input.operation}\0${input.capabilityId}`;
}
