import { DEFAULT_MAX_CALL_TIME_MS } from "./constants.js";
import { McpBridgeError } from "./types.js";

export const DEFAULT_MAX_LIST_PAGES = 20;
export const DEFAULT_MAX_TOOLS = 500;
export const DEFAULT_MAX_CURSOR_BYTES = 4 * 1024;
export const DEFAULT_MAX_TOOL_NAME_BYTES = 256;
export const DEFAULT_MAX_TOOL_DESCRIPTION_BYTES = 16 * 1024;
export const DEFAULT_MAX_TOOL_SCHEMA_BYTES = 256 * 1024;
export const DEFAULT_MAX_TOTAL_TOOL_SCHEMA_BYTES = 4 * 1024 * 1024;
export const DEFAULT_MAX_JSON_DEPTH = 64;
export const DEFAULT_MAX_JSON_PROPERTIES = 10_000;
export const DEFAULT_MAX_HTTP_RESPONSE_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MAX_CAPABILITY_BYTES = 1024 * 1024;
export const DEFAULT_MAX_CAPABILITY_ITEMS = 500;
export const DEFAULT_MAX_CAPABILITY_PAGES = 20;
/** MRTR auto-fulfilment rounds: SDK's own default is 10; the hard cap equals it so this option can only tighten, never widen. */
export const DEFAULT_MAX_MRTR_ROUNDS = 10;

export interface McpClientLimitsInput {
  readonly maxListPages?: number;
  readonly maxTools?: number;
  readonly maxCursorBytes?: number;
  readonly maxToolNameBytes?: number;
  readonly maxToolDescriptionBytes?: number;
  readonly maxToolSchemaBytes?: number;
  readonly maxTotalToolSchemaBytes?: number;
  readonly maxJsonDepth?: number;
  readonly maxJsonProperties?: number;
  readonly maxResultBytes?: number;
  /** Per-request timeout; a tool call's progress notifications reset it. */
  readonly callTimeoutMs?: number;
  /** Absolute bound on one tool call (default `max(300_000, callTimeoutMs)`); must be >= `callTimeoutMs`. */
  readonly maxCallTimeMs?: number;
  /** Bounds `connect` and the first `tools/list` only (default `callTimeoutMs`). */
  readonly connectTimeoutMs?: number;
  readonly listCacheTtlMs?: number;
}

export interface ResolvedMcpClientLimits {
  readonly maxListPages: number;
  readonly maxTools: number;
  readonly maxCursorBytes: number;
  readonly maxToolNameBytes: number;
  readonly maxToolDescriptionBytes: number;
  readonly maxToolSchemaBytes: number;
  readonly maxTotalToolSchemaBytes: number;
  readonly maxJsonDepth: number;
  readonly maxJsonProperties: number;
  readonly maxResultBytes: number;
  readonly callTimeoutMs: number;
  readonly listCacheTtlMs: number;
}

/** Internal: the resolved limits plus the two call-time bounds (kept off the public `ResolvedMcpClientLimits`). */
export interface ResolvedMcpBridgeLimits extends ResolvedMcpClientLimits {
  readonly maxCallTimeMs: number;
  readonly connectTimeoutMs: number;
}

/** A host-set MCP limit: a positive safe integer. The host's value is the cap (plan 239 Task 5). */
export function validateMcpLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new McpBridgeError(`${name} must be a positive safe integer`);
  }
  return value;
}

export function resolveMcpClientLimits(
  input: McpClientLimitsInput,
  defaults: { readonly maxResultBytes: number; readonly callTimeoutMs: number; readonly listCacheTtlMs: number },
): ResolvedMcpBridgeLimits {
  const callTimeoutMs = validateMcpLimit("callTimeoutMs", input.callTimeoutMs ?? defaults.callTimeoutMs);
  const maxCallTimeMs = validateMcpLimit("maxCallTimeMs", input.maxCallTimeMs ?? Math.max(DEFAULT_MAX_CALL_TIME_MS, callTimeoutMs));
  if (maxCallTimeMs < callTimeoutMs) throw new McpBridgeError("maxCallTimeMs must be >= callTimeoutMs");
  return {
    maxListPages: validateMcpLimit("maxListPages", input.maxListPages ?? DEFAULT_MAX_LIST_PAGES),
    maxTools: validateMcpLimit("maxTools", input.maxTools ?? DEFAULT_MAX_TOOLS),
    maxCursorBytes: validateMcpLimit("maxCursorBytes", input.maxCursorBytes ?? DEFAULT_MAX_CURSOR_BYTES),
    maxToolNameBytes: validateMcpLimit("maxToolNameBytes", input.maxToolNameBytes ?? DEFAULT_MAX_TOOL_NAME_BYTES),
    maxToolDescriptionBytes: validateMcpLimit(
      "maxToolDescriptionBytes",
      input.maxToolDescriptionBytes ?? DEFAULT_MAX_TOOL_DESCRIPTION_BYTES,
    ),
    maxToolSchemaBytes: validateMcpLimit("maxToolSchemaBytes", input.maxToolSchemaBytes ?? DEFAULT_MAX_TOOL_SCHEMA_BYTES),
    maxTotalToolSchemaBytes: validateMcpLimit(
      "maxTotalToolSchemaBytes",
      input.maxTotalToolSchemaBytes ?? DEFAULT_MAX_TOTAL_TOOL_SCHEMA_BYTES,
    ),
    maxJsonDepth: validateMcpLimit("maxJsonDepth", input.maxJsonDepth ?? DEFAULT_MAX_JSON_DEPTH),
    maxJsonProperties: validateMcpLimit("maxJsonProperties", input.maxJsonProperties ?? DEFAULT_MAX_JSON_PROPERTIES),
    maxResultBytes: validateMcpLimit("maxResultBytes", input.maxResultBytes ?? defaults.maxResultBytes),
    callTimeoutMs,
    maxCallTimeMs,
    connectTimeoutMs: validateMcpLimit("connectTimeoutMs", input.connectTimeoutMs ?? callTimeoutMs),
    listCacheTtlMs: validateMcpLimit("listCacheTtlMs", input.listCacheTtlMs ?? defaults.listCacheTtlMs),
  };
}
