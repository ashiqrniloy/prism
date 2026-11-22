import { ObscuraError } from "./errors.js";

export interface ObscuraProcessLimits {
  /** Bounded wait for a readiness probe before the owned process is killed. */
  readonly startupTimeoutMs: number;
  /** Grace period for SIGTERM before SIGKILL. */
  readonly shutdownTimeoutMs: number;
  /** Cap on retained stderr used for post-mortem diagnostics. */
  readonly maxStderrBytes: number;
  readonly maxArgvEntries: number;
  readonly maxArgvBytes: number;
  readonly maxEnvEntries: number;
  readonly maxEnvValueBytes: number;
}

export const DEFAULT_OBSCURA_PROCESS_LIMITS: ObscuraProcessLimits = {
  startupTimeoutMs: 10_000,
  shutdownTimeoutMs: 5_000,
  maxStderrBytes: 64 * 1024,
  maxArgvEntries: 256,
  maxArgvBytes: 64 * 1024,
  maxEnvEntries: 64,
  maxEnvValueBytes: 16 * 1024,
};

export function resolveObscuraProcessLimits(input: Partial<ObscuraProcessLimits> = {}): ObscuraProcessLimits {
  const out = {} as Record<keyof ObscuraProcessLimits, number>;
  for (const key of Object.keys(DEFAULT_OBSCURA_PROCESS_LIMITS) as (keyof ObscuraProcessLimits)[]) {
    const value = input[key] ?? DEFAULT_OBSCURA_PROCESS_LIMITS[key];
    if (!Number.isFinite(value) || value < 0) {
      throw new ObscuraError("ERR_OBSCURA_LIMIT", `Obscura limit ${key} out of range`);
    }
    out[key] = value;
  }
  return out;
}

/** Bounds for the CLI-backed web tools (search/fetch/scrape child processes). */
export interface ObscuraWebLimits {
  readonly maxQueryBytes: number;
  readonly maxResults: number;
  readonly maxUrls: number;
  readonly maxConcurrency: number;
  readonly maxOutputBytes: number;
  readonly maxStderrBytes: number;
  readonly timeoutMs: number;
  readonly maxEvalBytes: number;
}

export const DEFAULT_OBSCURA_WEB_LIMITS: ObscuraWebLimits = {
  maxQueryBytes: 4096,
  maxResults: 10,
  maxUrls: 25,
  maxConcurrency: 5,
  maxOutputBytes: 2 * 1024 * 1024,
  maxStderrBytes: 64 * 1024,
  timeoutMs: 30_000,
  maxEvalBytes: 4096,
};

export function resolveObscuraWebLimits(input: Partial<ObscuraWebLimits> = {}): ObscuraWebLimits {
  const out = {} as Record<keyof ObscuraWebLimits, number>;
  for (const key of Object.keys(DEFAULT_OBSCURA_WEB_LIMITS) as (keyof ObscuraWebLimits)[]) {
    const value = input[key] ?? DEFAULT_OBSCURA_WEB_LIMITS[key];
    if (!Number.isFinite(value) || value <= 0) {
      throw new ObscuraError("ERR_OBSCURA_LIMIT", `Obscura web limit ${key} out of range`);
    }
    out[key] = value;
  }
  return out;
}
