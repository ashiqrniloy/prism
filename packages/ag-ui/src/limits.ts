import { AgUiError } from "./errors.js";

/** Phase 7 frozen outbound projection caps. */
export const DEFAULT_MAX_EVENT_BYTES = 64 * 1024;
export const HARD_MAX_EVENT_BYTES = 1024 * 1024;
export const DEFAULT_MAX_TEXT_BYTES = 64 * 1024;
export const HARD_MAX_TEXT_BYTES = 1024 * 1024;
export const DEFAULT_MAX_ERROR_BYTES = 8 * 1024;
export const HARD_MAX_ERROR_BYTES = 64 * 1024;
export const DEFAULT_MAX_REQUEST_BYTES = 64 * 1024;
export const HARD_MAX_REQUEST_BYTES = 1024 * 1024;
export const DEFAULT_MAX_INPUT_MESSAGES = 128;
export const HARD_MAX_INPUT_MESSAGES = 1024;
export const DEFAULT_MAX_INPUT_TEXT_BYTES = 64 * 1024;
export const HARD_MAX_INPUT_TEXT_BYTES = 1024 * 1024;
export const DEFAULT_MAX_CURSOR_BYTES = 4 * 1024;
export const HARD_MAX_CURSOR_BYTES = 16 * 1024;
export const DEFAULT_MAX_REPLAY_EVENTS = 100;
export const HARD_MAX_REPLAY_EVENTS = 500;
export const DEFAULT_MAX_STREAM_EVENTS = 10_000;
export const HARD_MAX_STREAM_EVENTS = 100_000;
export const DEFAULT_MAX_STREAM_BYTES = 10 * 1024 * 1024;
export const HARD_MAX_STREAM_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_QUEUED_EVENTS = 128;
export const HARD_MAX_QUEUED_EVENTS = 4096;
export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
export const HARD_REQUEST_TIMEOUT_MS = 30 * 60_000;

export interface AgUiLimitOptions {
  readonly maxEventBytes?: number;
  readonly maxTextBytes?: number;
  readonly maxErrorBytes?: number;
  readonly maxRequestBytes?: number;
  readonly maxInputMessages?: number;
  readonly maxInputTextBytes?: number;
  readonly maxCursorBytes?: number;
  readonly maxReplayEvents?: number;
  readonly maxStreamEvents?: number;
  readonly maxStreamBytes?: number;
  readonly maxQueuedEvents?: number;
  readonly requestTimeoutMs?: number;
}

export interface ResolvedAgUiLimits {
  readonly maxEventBytes: number;
  readonly maxTextBytes: number;
  readonly maxErrorBytes: number;
  readonly maxRequestBytes: number;
  readonly maxInputMessages: number;
  readonly maxInputTextBytes: number;
  readonly maxCursorBytes: number;
  readonly maxReplayEvents: number;
  readonly maxStreamEvents: number;
  readonly maxStreamBytes: number;
  readonly maxQueuedEvents: number;
  readonly requestTimeoutMs: number;
}

export const DEFAULT_AG_UI_LIMITS: ResolvedAgUiLimits = {
  maxEventBytes: DEFAULT_MAX_EVENT_BYTES,
  maxTextBytes: DEFAULT_MAX_TEXT_BYTES,
  maxErrorBytes: DEFAULT_MAX_ERROR_BYTES,
  maxRequestBytes: DEFAULT_MAX_REQUEST_BYTES,
  maxInputMessages: DEFAULT_MAX_INPUT_MESSAGES,
  maxInputTextBytes: DEFAULT_MAX_INPUT_TEXT_BYTES,
  maxCursorBytes: DEFAULT_MAX_CURSOR_BYTES,
  maxReplayEvents: DEFAULT_MAX_REPLAY_EVENTS,
  maxStreamEvents: DEFAULT_MAX_STREAM_EVENTS,
  maxStreamBytes: DEFAULT_MAX_STREAM_BYTES,
  maxQueuedEvents: DEFAULT_MAX_QUEUED_EVENTS,
  requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
};

export const HARD_AG_UI_LIMITS: ResolvedAgUiLimits = {
  maxEventBytes: HARD_MAX_EVENT_BYTES,
  maxTextBytes: HARD_MAX_TEXT_BYTES,
  maxErrorBytes: HARD_MAX_ERROR_BYTES,
  maxRequestBytes: HARD_MAX_REQUEST_BYTES,
  maxInputMessages: HARD_MAX_INPUT_MESSAGES,
  maxInputTextBytes: HARD_MAX_INPUT_TEXT_BYTES,
  maxCursorBytes: HARD_MAX_CURSOR_BYTES,
  maxReplayEvents: HARD_MAX_REPLAY_EVENTS,
  maxStreamEvents: HARD_MAX_STREAM_EVENTS,
  maxStreamBytes: HARD_MAX_STREAM_BYTES,
  maxQueuedEvents: HARD_MAX_QUEUED_EVENTS,
  requestTimeoutMs: HARD_REQUEST_TIMEOUT_MS,
};

export function resolveAgUiLimits(options: AgUiLimitOptions = {}): ResolvedAgUiLimits {
  return {
    maxEventBytes: validate("maxEventBytes", options.maxEventBytes ?? DEFAULT_MAX_EVENT_BYTES),
    maxTextBytes: validate("maxTextBytes", options.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES),
    maxErrorBytes: validate("maxErrorBytes", options.maxErrorBytes ?? DEFAULT_MAX_ERROR_BYTES),
    maxRequestBytes: validate("maxRequestBytes", options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES),
    maxInputMessages: validate("maxInputMessages", options.maxInputMessages ?? DEFAULT_MAX_INPUT_MESSAGES),
    maxInputTextBytes: validate("maxInputTextBytes", options.maxInputTextBytes ?? DEFAULT_MAX_INPUT_TEXT_BYTES),
    maxCursorBytes: validate("maxCursorBytes", options.maxCursorBytes ?? DEFAULT_MAX_CURSOR_BYTES),
    maxReplayEvents: validate("maxReplayEvents", options.maxReplayEvents ?? DEFAULT_MAX_REPLAY_EVENTS),
    maxStreamEvents: validate("maxStreamEvents", options.maxStreamEvents ?? DEFAULT_MAX_STREAM_EVENTS),
    maxStreamBytes: validate("maxStreamBytes", options.maxStreamBytes ?? DEFAULT_MAX_STREAM_BYTES),
    maxQueuedEvents: validate("maxQueuedEvents", options.maxQueuedEvents ?? DEFAULT_MAX_QUEUED_EVENTS),
    requestTimeoutMs: validate("requestTimeoutMs", options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS),
  };
}

function validate(name: keyof ResolvedAgUiLimits, value: number): number {
  const hard = HARD_AG_UI_LIMITS[name];
  const minimum = name === "maxEventBytes" || name === "maxRequestBytes" || name === "maxInputTextBytes" || name === "maxCursorBytes" || name === "maxStreamBytes"
    ? 1_024
    : name === "maxTextBytes" || name === "maxErrorBytes" ? 16 : 1;
  if (!Number.isSafeInteger(value) || value < minimum || value > hard) {
    throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", `${name} must be a safe integer from ${minimum} through ${hard}`);
  }
  return value;
}
