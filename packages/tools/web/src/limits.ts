import type { ResolvedWebLimits, WebLimits } from "./types.js";

export const DEFAULT_WEB_LIMITS: ResolvedWebLimits = {
  maxQueryBytes: 4 * 1024,
  maxResults: 10,
  maxUrls: 5,
  maxRequestBytes: 256 * 1024,
  maxResponseBytes: 2 * 1024 * 1024,
  maxMarkdownBytes: 1024 * 1024,
  maxExtractBytes: 256 * 1024,
  maxSchemaBytes: 64 * 1024,
  maxAggregateBytes: 2 * 1024 * 1024,
  maxJsonDepth: 64,
  maxJsonProperties: 10_000,
  maxRetries: 2,
  maxRateLimitDelayMs: 5_000,
  maxConcurrency: 4,
  maxQueued: 64,
  maxPollingAttempts: 20,
  pollingDelayMs: 1_000,
  timeoutMs: 60_000,
};
export function resolveWebLimits(input: WebLimits = {}): ResolvedWebLimits {
  const out = {} as Record<keyof ResolvedWebLimits, number>;
  for (const key of Object.keys(DEFAULT_WEB_LIMITS) as (keyof ResolvedWebLimits)[]) {
    const value = input[key] ?? DEFAULT_WEB_LIMITS[key];
    const permitsZero = key === "maxRetries" || key === "pollingDelayMs";
    // Host-set: the host's value is the cap (plan 239 Task 5).
    if (!Number.isSafeInteger(value) || value < (permitsZero ? 0 : 1))
      throw new RangeError(`${key} must be ${permitsZero ? "a non-negative" : "a positive"} safe integer`);
    out[key] = value;
  }
  return out as unknown as ResolvedWebLimits;
}
