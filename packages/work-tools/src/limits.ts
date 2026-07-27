import { WorkToolError } from "./errors.js";
import type { ResolvedWorkLimits, WorkLimits } from "./types.js";

export const DEFAULT_WORK_LIMITS: ResolvedWorkLimits = {
  maxPaginationPages: 20,
  maxItemsPerPage: 50,
  maxAggregateItems: 200,
  maxRequestBytes: 256 * 1024,
  maxResponseBytes: 2 * 1024 * 1024,
  maxAttachmentBytes: 5 * 1024 * 1024,
  maxFileBytes: 10 * 1024 * 1024,
  maxStdoutBytes: 2 * 1024 * 1024,
  maxStderrBytes: 2 * 1024 * 1024,
  timeoutMs: 60_000,
  maxConcurrency: 2,
  maxRetries: 2,
  maxIdempotencyKeyBytes: 256,
  maxJsonDepth: 64,
  maxJsonProperties: 10_000,
};

export const HARD_WORK_LIMITS: ResolvedWorkLimits = {
  maxPaginationPages: 100,
  maxItemsPerPage: 500,
  maxAggregateItems: 2_000,
  maxRequestBytes: 2 * 1024 * 1024,
  maxResponseBytes: 16 * 1024 * 1024,
  maxAttachmentBytes: 25 * 1024 * 1024,
  maxFileBytes: 50 * 1024 * 1024,
  maxStdoutBytes: 16 * 1024 * 1024,
  maxStderrBytes: 16 * 1024 * 1024,
  timeoutMs: 10 * 60_000,
  maxConcurrency: 8,
  maxRetries: 4,
  maxIdempotencyKeyBytes: 2 * 1024,
  maxJsonDepth: 128,
  maxJsonProperties: 100_000,
};

export function resolveWorkLimits(input: WorkLimits = {}): ResolvedWorkLimits {
  const out = {} as Record<keyof ResolvedWorkLimits, number>;
  for (const key of Object.keys(DEFAULT_WORK_LIMITS) as (keyof ResolvedWorkLimits)[]) {
    const value = input[key] ?? DEFAULT_WORK_LIMITS[key];
    if (!Number.isFinite(value) || value < 0 || value > HARD_WORK_LIMITS[key]) {
      throw new WorkToolError("ERR_PRISM_WORK_LIMIT", `Work limit ${key} out of range`);
    }
    out[key] = value;
  }
  return out as ResolvedWorkLimits;
}
