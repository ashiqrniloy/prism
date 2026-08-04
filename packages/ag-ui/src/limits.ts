import { AgUiError } from "./errors.js";

/** Phase 7 frozen baseline transport caps. */
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

/** Full AG-UI request/projection caps. They can narrow but never exceed these hard limits. */
export const DEFAULT_MAX_INPUT_TOOLS = 32;
export const HARD_MAX_INPUT_TOOLS = 256;
export const DEFAULT_MAX_INPUT_CONTEXTS = 32;
export const HARD_MAX_INPUT_CONTEXTS = 256;
export const DEFAULT_MAX_INPUT_INTERRUPTS = 8;
export const HARD_MAX_INPUT_INTERRUPTS = 64;
export const DEFAULT_MAX_INPUT_MEDIA_PARTS = 16;
export const HARD_MAX_INPUT_MEDIA_PARTS = 64;
export const DEFAULT_MAX_INPUT_MEDIA_BYTES = 64 * 1024;
export const HARD_MAX_INPUT_MEDIA_BYTES = 1024 * 1024;
export const DEFAULT_MAX_INPUT_TOOL_BYTES = 16 * 1024;
export const HARD_MAX_INPUT_TOOL_BYTES = 256 * 1024;
export const DEFAULT_MAX_INPUT_CONTEXT_BYTES = 16 * 1024;
export const HARD_MAX_INPUT_CONTEXT_BYTES = 256 * 1024;
export const DEFAULT_MAX_STATE_BYTES = 64 * 1024;
export const HARD_MAX_STATE_BYTES = 1024 * 1024;
export const DEFAULT_MAX_PATCH_OPERATIONS = 128;
export const HARD_MAX_PATCH_OPERATIONS = 4096;
export const DEFAULT_MAX_ACTIVITY_BYTES = 64 * 1024;
export const HARD_MAX_ACTIVITY_BYTES = 1024 * 1024;
export const DEFAULT_MAX_REASONING_BYTES = 64 * 1024;
export const HARD_MAX_REASONING_BYTES = 1024 * 1024;
export const DEFAULT_MAX_RAW_EVENT_BYTES = 64 * 1024;
export const HARD_MAX_RAW_EVENT_BYTES = 1024 * 1024;
export const DEFAULT_MAX_JSON_DEPTH = 16;
export const HARD_MAX_JSON_DEPTH = 64;
export const DEFAULT_MAX_JSON_PROPERTIES = 128;
export const HARD_MAX_JSON_PROPERTIES = 4096;
export const DEFAULT_MAX_JSON_ARRAY_ITEMS = 512;
export const HARD_MAX_JSON_ARRAY_ITEMS = 8192;

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
  readonly maxInputTools?: number;
  readonly maxInputContexts?: number;
  readonly maxInputInterrupts?: number;
  readonly maxInputMediaParts?: number;
  readonly maxInputMediaBytes?: number;
  readonly maxInputToolBytes?: number;
  readonly maxInputContextBytes?: number;
  readonly maxStateBytes?: number;
  readonly maxPatchOperations?: number;
  readonly maxActivityBytes?: number;
  readonly maxReasoningBytes?: number;
  readonly maxRawEventBytes?: number;
  readonly maxJsonDepth?: number;
  readonly maxJsonProperties?: number;
  readonly maxJsonArrayItems?: number;
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
  readonly maxInputTools: number;
  readonly maxInputContexts: number;
  readonly maxInputInterrupts: number;
  readonly maxInputMediaParts: number;
  readonly maxInputMediaBytes: number;
  readonly maxInputToolBytes: number;
  readonly maxInputContextBytes: number;
  readonly maxStateBytes: number;
  readonly maxPatchOperations: number;
  readonly maxActivityBytes: number;
  readonly maxReasoningBytes: number;
  readonly maxRawEventBytes: number;
  readonly maxJsonDepth: number;
  readonly maxJsonProperties: number;
  readonly maxJsonArrayItems: number;
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
  maxInputTools: DEFAULT_MAX_INPUT_TOOLS,
  maxInputContexts: DEFAULT_MAX_INPUT_CONTEXTS,
  maxInputInterrupts: DEFAULT_MAX_INPUT_INTERRUPTS,
  maxInputMediaParts: DEFAULT_MAX_INPUT_MEDIA_PARTS,
  maxInputMediaBytes: DEFAULT_MAX_INPUT_MEDIA_BYTES,
  maxInputToolBytes: DEFAULT_MAX_INPUT_TOOL_BYTES,
  maxInputContextBytes: DEFAULT_MAX_INPUT_CONTEXT_BYTES,
  maxStateBytes: DEFAULT_MAX_STATE_BYTES,
  maxPatchOperations: DEFAULT_MAX_PATCH_OPERATIONS,
  maxActivityBytes: DEFAULT_MAX_ACTIVITY_BYTES,
  maxReasoningBytes: DEFAULT_MAX_REASONING_BYTES,
  maxRawEventBytes: DEFAULT_MAX_RAW_EVENT_BYTES,
  maxJsonDepth: DEFAULT_MAX_JSON_DEPTH,
  maxJsonProperties: DEFAULT_MAX_JSON_PROPERTIES,
  maxJsonArrayItems: DEFAULT_MAX_JSON_ARRAY_ITEMS,
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
  maxInputTools: HARD_MAX_INPUT_TOOLS,
  maxInputContexts: HARD_MAX_INPUT_CONTEXTS,
  maxInputInterrupts: HARD_MAX_INPUT_INTERRUPTS,
  maxInputMediaParts: HARD_MAX_INPUT_MEDIA_PARTS,
  maxInputMediaBytes: HARD_MAX_INPUT_MEDIA_BYTES,
  maxInputToolBytes: HARD_MAX_INPUT_TOOL_BYTES,
  maxInputContextBytes: HARD_MAX_INPUT_CONTEXT_BYTES,
  maxStateBytes: HARD_MAX_STATE_BYTES,
  maxPatchOperations: HARD_MAX_PATCH_OPERATIONS,
  maxActivityBytes: HARD_MAX_ACTIVITY_BYTES,
  maxReasoningBytes: HARD_MAX_REASONING_BYTES,
  maxRawEventBytes: HARD_MAX_RAW_EVENT_BYTES,
  maxJsonDepth: HARD_MAX_JSON_DEPTH,
  maxJsonProperties: HARD_MAX_JSON_PROPERTIES,
  maxJsonArrayItems: HARD_MAX_JSON_ARRAY_ITEMS,
};

export function resolveAgUiLimits(options: AgUiLimitOptions = {}): ResolvedAgUiLimits {
  return Object.fromEntries(
    Object.entries(DEFAULT_AG_UI_LIMITS).map(([name, defaultValue]) => [
      name,
      validate(name as keyof ResolvedAgUiLimits, options[name as keyof AgUiLimitOptions] ?? defaultValue),
    ]),
  ) as unknown as ResolvedAgUiLimits;
}

function validate(name: keyof ResolvedAgUiLimits, value: number): number {
  const hard = HARD_AG_UI_LIMITS[name];
  const minimum =
    name.endsWith("Bytes") || name === "requestTimeoutMs" ? (name === "maxTextBytes" || name === "maxErrorBytes" ? 16 : 1_024) : 1;
  if (!Number.isSafeInteger(value) || value < minimum || value > hard) {
    throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", `${name} must be a safe integer from ${minimum} through ${hard}`);
  }
  return value;
}
