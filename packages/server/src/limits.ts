export const DEFAULT_MAX_REQUEST_BYTES = 64 * 1024;
export const HARD_MAX_REQUEST_BYTES = 1024 * 1024;
export const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
export const HARD_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_EVENT_BYTES = 64 * 1024;
export const HARD_MAX_EVENT_BYTES = 1024 * 1024;
export const DEFAULT_MAX_STREAM_BYTES = 10 * 1024 * 1024;
export const HARD_MAX_STREAM_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_STREAM_EVENTS = 10_000;
export const HARD_MAX_STREAM_EVENTS = 100_000;
export const DEFAULT_MAX_CONCURRENT_RUNS = 16;
export const HARD_MAX_CONCURRENT_RUNS = 256;
export const DEFAULT_MAX_QUEUED_EVENTS = 128;
export const HARD_MAX_QUEUED_EVENTS = 4096;
export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
export const HARD_REQUEST_TIMEOUT_MS = 30 * 60_000;
/** Phase 8 freeze: health body 4 KiB / 64 KiB; drain deadline 30 s / 5 min; replay page 100 / 500; cursor 4 / 16 KiB. */
export const DEFAULT_MAX_HEALTH_BYTES = 4 * 1024;
export const HARD_MAX_HEALTH_BYTES = 64 * 1024;
export const DEFAULT_DRAIN_DEADLINE_MS = 30_000;
export const HARD_DRAIN_DEADLINE_MS = 5 * 60_000;
export const DEFAULT_MAX_REPLAY_EVENTS = 100;
export const HARD_MAX_REPLAY_EVENTS = 500;
export const DEFAULT_MAX_REPLAY_CURSOR_BYTES = 4 * 1024;
export const HARD_MAX_REPLAY_CURSOR_BYTES = 16 * 1024;

export interface PrismServerLimits {
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxEventBytes?: number;
  readonly maxStreamBytes?: number;
  readonly maxStreamEvents?: number;
  readonly maxConcurrentRuns?: number;
  readonly maxQueuedEvents?: number;
  readonly requestTimeoutMs?: number;
}

export interface ResolvedPrismServerLimits {
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
  readonly maxEventBytes: number;
  readonly maxStreamBytes: number;
  readonly maxStreamEvents: number;
  readonly maxConcurrentRuns: number;
  readonly maxQueuedEvents: number;
  readonly requestTimeoutMs: number;
}

export interface PrismDeploymentLimits {
  readonly maxHealthBytes?: number;
  readonly drainDeadlineMs?: number;
  readonly maxReplayEvents?: number;
  readonly maxReplayCursorBytes?: number;
}

export interface ResolvedPrismDeploymentLimits {
  readonly maxHealthBytes: number;
  readonly drainDeadlineMs: number;
  readonly maxReplayEvents: number;
  readonly maxReplayCursorBytes: number;
}

export function resolvePrismServerLimits(input: PrismServerLimits = {}): ResolvedPrismServerLimits {
  return {
    maxRequestBytes: bounded(input.maxRequestBytes, DEFAULT_MAX_REQUEST_BYTES, HARD_MAX_REQUEST_BYTES, "maxRequestBytes"),
    maxResponseBytes: bounded(input.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, HARD_MAX_RESPONSE_BYTES, "maxResponseBytes"),
    maxEventBytes: bounded(input.maxEventBytes, DEFAULT_MAX_EVENT_BYTES, HARD_MAX_EVENT_BYTES, "maxEventBytes"),
    maxStreamBytes: bounded(input.maxStreamBytes, DEFAULT_MAX_STREAM_BYTES, HARD_MAX_STREAM_BYTES, "maxStreamBytes"),
    maxStreamEvents: bounded(input.maxStreamEvents, DEFAULT_MAX_STREAM_EVENTS, HARD_MAX_STREAM_EVENTS, "maxStreamEvents"),
    maxConcurrentRuns: bounded(input.maxConcurrentRuns, DEFAULT_MAX_CONCURRENT_RUNS, HARD_MAX_CONCURRENT_RUNS, "maxConcurrentRuns"),
    maxQueuedEvents: bounded(input.maxQueuedEvents, DEFAULT_MAX_QUEUED_EVENTS, HARD_MAX_QUEUED_EVENTS, "maxQueuedEvents"),
    requestTimeoutMs: bounded(input.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, HARD_REQUEST_TIMEOUT_MS, "requestTimeoutMs"),
  };
}

export function resolvePrismDeploymentLimits(input: PrismDeploymentLimits = {}): ResolvedPrismDeploymentLimits {
  return {
    maxHealthBytes: bounded(input.maxHealthBytes, DEFAULT_MAX_HEALTH_BYTES, HARD_MAX_HEALTH_BYTES, "maxHealthBytes"),
    drainDeadlineMs: bounded(input.drainDeadlineMs, DEFAULT_DRAIN_DEADLINE_MS, HARD_DRAIN_DEADLINE_MS, "drainDeadlineMs"),
    maxReplayEvents: bounded(input.maxReplayEvents, DEFAULT_MAX_REPLAY_EVENTS, HARD_MAX_REPLAY_EVENTS, "maxReplayEvents"),
    maxReplayCursorBytes: bounded(input.maxReplayCursorBytes, DEFAULT_MAX_REPLAY_CURSOR_BYTES, HARD_MAX_REPLAY_CURSOR_BYTES, "maxReplayCursorBytes"),
  };
}

function bounded(value: number | undefined, fallback: number, cap: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > cap) {
    throw new RangeError(`${name} must be a positive safe integer <= ${cap}`);
  }
  return resolved;
}
