import type { AntigravityRunnerLimits, ResolvedAntigravityRunnerLimits } from "./types.js";

export const DEFAULT_MAX_RUNNER_LIFETIME_MS = 10 * 60 * 1000; // 10 minutes
export const HARD_MAX_RUNNER_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24 hours

export const DEFAULT_MAX_RUNNER_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MiB
export const HARD_MAX_RUNNER_OUTPUT_BYTES = 100 * 1024 * 1024; // 100 MiB

export const DEFAULT_MAX_RUNNER_OUTPUT_CHUNK_BYTES = 64 * 1024; // 64 KiB
export const HARD_MAX_RUNNER_OUTPUT_CHUNK_BYTES = 1024 * 1024; // 1 MiB

export const DEFAULT_MAX_RUNNER_LINE_BYTES = 64 * 1024; // 64 KiB
export const HARD_MAX_RUNNER_LINE_BYTES = 1024 * 1024; // 1 MiB

export const DEFAULT_MAX_RUNNER_EVENTS = 5_000;
export const HARD_MAX_RUNNER_EVENTS = 50_000;

export const DEFAULT_MAX_RUNNER_STEPS = 500;
export const HARD_MAX_RUNNER_STEPS = 5_000;

export const DEFAULT_MAX_RUNNER_TOOL_CALLS = 500;
export const HARD_MAX_RUNNER_TOOL_CALLS = 5_000;

export const DEFAULT_MAX_RUNNER_SUBAGENTS = 100;
export const HARD_MAX_RUNNER_SUBAGENTS = 1_000;

export const DEFAULT_MAX_RUNNER_STDERR_BYTES = 256 * 1024; // 256 KiB
export const HARD_MAX_RUNNER_STDERR_BYTES = 5 * 1024 * 1024; // 5 MiB

function clampLimit(name: string, value: number, defaultValue: number, hardMax: number): number {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== "number" || !Number.isFinite(value) || Number.isNaN(value)) {
    throw new TypeError(`Invalid limit '${name}': must be a finite number`);
  }
  const intVal = Math.floor(value);
  if (intVal <= 0) {
    throw new RangeError(`Invalid limit '${name}': must be positive (> 0), got ${value}`);
  }
  return Math.min(intVal, hardMax);
}

export function resolveRunnerLimits(limits?: AntigravityRunnerLimits): ResolvedAntigravityRunnerLimits {
  return {
    maxLifetimeMs: clampLimit(
      "maxLifetimeMs",
      limits?.maxLifetimeMs ?? DEFAULT_MAX_RUNNER_LIFETIME_MS,
      DEFAULT_MAX_RUNNER_LIFETIME_MS,
      HARD_MAX_RUNNER_LIFETIME_MS,
    ),
    maxOutputBytes: clampLimit(
      "maxOutputBytes",
      limits?.maxOutputBytes ?? DEFAULT_MAX_RUNNER_OUTPUT_BYTES,
      DEFAULT_MAX_RUNNER_OUTPUT_BYTES,
      HARD_MAX_RUNNER_OUTPUT_BYTES,
    ),
    maxOutputChunkBytes: clampLimit(
      "maxOutputChunkBytes",
      limits?.maxOutputChunkBytes ?? DEFAULT_MAX_RUNNER_OUTPUT_CHUNK_BYTES,
      DEFAULT_MAX_RUNNER_OUTPUT_CHUNK_BYTES,
      HARD_MAX_RUNNER_OUTPUT_CHUNK_BYTES,
    ),
    maxLineBytes: clampLimit(
      "maxLineBytes",
      limits?.maxLineBytes ?? DEFAULT_MAX_RUNNER_LINE_BYTES,
      DEFAULT_MAX_RUNNER_LINE_BYTES,
      HARD_MAX_RUNNER_LINE_BYTES,
    ),
    maxEvents: clampLimit("maxEvents", limits?.maxEvents ?? DEFAULT_MAX_RUNNER_EVENTS, DEFAULT_MAX_RUNNER_EVENTS, HARD_MAX_RUNNER_EVENTS),
    maxSteps: clampLimit("maxSteps", limits?.maxSteps ?? DEFAULT_MAX_RUNNER_STEPS, DEFAULT_MAX_RUNNER_STEPS, HARD_MAX_RUNNER_STEPS),
    maxToolCalls: clampLimit(
      "maxToolCalls",
      limits?.maxToolCalls ?? DEFAULT_MAX_RUNNER_TOOL_CALLS,
      DEFAULT_MAX_RUNNER_TOOL_CALLS,
      HARD_MAX_RUNNER_TOOL_CALLS,
    ),
    maxSubagents: clampLimit(
      "maxSubagents",
      limits?.maxSubagents ?? DEFAULT_MAX_RUNNER_SUBAGENTS,
      DEFAULT_MAX_RUNNER_SUBAGENTS,
      HARD_MAX_RUNNER_SUBAGENTS,
    ),
    maxStderrBytes: clampLimit(
      "maxStderrBytes",
      limits?.maxStderrBytes ?? DEFAULT_MAX_RUNNER_STDERR_BYTES,
      DEFAULT_MAX_RUNNER_STDERR_BYTES,
      HARD_MAX_RUNNER_STDERR_BYTES,
    ),
  };
}

export function formatDurationForAgy(ms: number): string {
  if (ms <= 0) return "1s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) {
    if (minutes % 60 === 0) {
      return `${minutes / 60}h`;
    }
    return `${minutes}m`;
  }
  return `${minutes}m${remainingSeconds}s`;
}
