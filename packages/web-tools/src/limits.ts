import type { ResolvedWebLimits, WebLimits } from "./types.js";

export const DEFAULT_WEB_LIMITS: ResolvedWebLimits = {
  maxQueryBytes: 4 * 1024, maxResults: 10, maxUrls: 5, maxRequestBytes: 256 * 1024,
  maxResponseBytes: 2 * 1024 * 1024, maxMarkdownBytes: 1024 * 1024, maxExtractBytes: 256 * 1024,
  maxSchemaBytes: 64 * 1024, maxAggregateBytes: 2 * 1024 * 1024, maxJsonDepth: 64,
  maxJsonProperties: 10_000, maxRetries: 2, maxRateLimitDelayMs: 5_000, maxConcurrency: 4,
  maxPollingAttempts: 20, pollingDelayMs: 1_000, timeoutMs: 60_000,
};
export const HARD_WEB_LIMITS: ResolvedWebLimits = {
  maxQueryBytes: 16 * 1024, maxResults: 20, maxUrls: 20, maxRequestBytes: 1024 * 1024,
  maxResponseBytes: 16 * 1024 * 1024, maxMarkdownBytes: 8 * 1024 * 1024, maxExtractBytes: 1024 * 1024,
  maxSchemaBytes: 256 * 1024, maxAggregateBytes: 16 * 1024 * 1024, maxJsonDepth: 128,
  maxJsonProperties: 100_000, maxRetries: 4, maxRateLimitDelayMs: 60_000, maxConcurrency: 16,
  maxPollingAttempts: 100, pollingDelayMs: 60_000, timeoutMs: 30 * 60_000,
};
export function resolveWebLimits(input: WebLimits = {}): ResolvedWebLimits {
  const out = {} as Record<keyof ResolvedWebLimits, number>;
  for (const key of Object.keys(DEFAULT_WEB_LIMITS) as (keyof ResolvedWebLimits)[]) {
    const value = input[key] ?? DEFAULT_WEB_LIMITS[key];
    const permitsZero = key === "maxRetries" || key === "pollingDelayMs";
    if (!Number.isSafeInteger(value) || value < (permitsZero ? 0 : 1) || value > HARD_WEB_LIMITS[key]) throw new RangeError(`${key} must be ${permitsZero ? "a non-negative" : "a positive"} safe integer no greater than ${HARD_WEB_LIMITS[key]}`);
    out[key] = value;
  }
  return out as unknown as ResolvedWebLimits;
}
