import { McpBridgeError } from "./types.js";

export const DEFAULT_MAX_LIST_PAGES = 20;
export const HARD_MAX_LIST_PAGES = 100;
export const DEFAULT_MAX_TOOLS = 500;
export const HARD_MAX_TOOLS = 5_000;
export const DEFAULT_MAX_CURSOR_BYTES = 4 * 1024;
export const HARD_MAX_CURSOR_BYTES = 16 * 1024;
export const DEFAULT_MAX_TOOL_NAME_BYTES = 256;
export const HARD_MAX_TOOL_NAME_BYTES = 1024;
export const DEFAULT_MAX_TOOL_DESCRIPTION_BYTES = 16 * 1024;
export const HARD_MAX_TOOL_DESCRIPTION_BYTES = 64 * 1024;
export const DEFAULT_MAX_TOOL_SCHEMA_BYTES = 256 * 1024;
export const HARD_MAX_TOOL_SCHEMA_BYTES = 1024 * 1024;
export const DEFAULT_MAX_TOTAL_TOOL_SCHEMA_BYTES = 4 * 1024 * 1024;
export const HARD_MAX_TOTAL_TOOL_SCHEMA_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MAX_JSON_DEPTH = 64;
export const HARD_MAX_JSON_DEPTH = 128;
export const DEFAULT_MAX_JSON_PROPERTIES = 10_000;
export const HARD_MAX_JSON_PROPERTIES = 100_000;
export const HARD_MAX_RESULT_BYTES = 16 * 1024 * 1024;
export const HARD_CALL_TIMEOUT_MS = 30 * 60_000;
export const HARD_LIST_CACHE_TTL_MS = 24 * 60 * 60_000;
export const DEFAULT_MAX_HTTP_RESPONSE_BYTES = 16 * 1024 * 1024;
export const HARD_MAX_HTTP_RESPONSE_BYTES = 64 * 1024 * 1024;

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
  readonly callTimeoutMs?: number;
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

export function validateMcpLimit(name: string, value: number, hardCap: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > hardCap) {
    throw new McpBridgeError(`${name} must be a positive safe integer <= ${hardCap}`);
  }
  return value;
}

export function resolveMcpClientLimits(
  input: McpClientLimitsInput,
  defaults: { readonly maxResultBytes: number; readonly callTimeoutMs: number; readonly listCacheTtlMs: number },
): ResolvedMcpClientLimits {
  return {
    maxListPages: validateMcpLimit("maxListPages", input.maxListPages ?? DEFAULT_MAX_LIST_PAGES, HARD_MAX_LIST_PAGES),
    maxTools: validateMcpLimit("maxTools", input.maxTools ?? DEFAULT_MAX_TOOLS, HARD_MAX_TOOLS),
    maxCursorBytes: validateMcpLimit("maxCursorBytes", input.maxCursorBytes ?? DEFAULT_MAX_CURSOR_BYTES, HARD_MAX_CURSOR_BYTES),
    maxToolNameBytes: validateMcpLimit("maxToolNameBytes", input.maxToolNameBytes ?? DEFAULT_MAX_TOOL_NAME_BYTES, HARD_MAX_TOOL_NAME_BYTES),
    maxToolDescriptionBytes: validateMcpLimit("maxToolDescriptionBytes", input.maxToolDescriptionBytes ?? DEFAULT_MAX_TOOL_DESCRIPTION_BYTES, HARD_MAX_TOOL_DESCRIPTION_BYTES),
    maxToolSchemaBytes: validateMcpLimit("maxToolSchemaBytes", input.maxToolSchemaBytes ?? DEFAULT_MAX_TOOL_SCHEMA_BYTES, HARD_MAX_TOOL_SCHEMA_BYTES),
    maxTotalToolSchemaBytes: validateMcpLimit("maxTotalToolSchemaBytes", input.maxTotalToolSchemaBytes ?? DEFAULT_MAX_TOTAL_TOOL_SCHEMA_BYTES, HARD_MAX_TOTAL_TOOL_SCHEMA_BYTES),
    maxJsonDepth: validateMcpLimit("maxJsonDepth", input.maxJsonDepth ?? DEFAULT_MAX_JSON_DEPTH, HARD_MAX_JSON_DEPTH),
    maxJsonProperties: validateMcpLimit("maxJsonProperties", input.maxJsonProperties ?? DEFAULT_MAX_JSON_PROPERTIES, HARD_MAX_JSON_PROPERTIES),
    maxResultBytes: validateMcpLimit("maxResultBytes", input.maxResultBytes ?? defaults.maxResultBytes, HARD_MAX_RESULT_BYTES),
    callTimeoutMs: validateMcpLimit("callTimeoutMs", input.callTimeoutMs ?? defaults.callTimeoutMs, HARD_CALL_TIMEOUT_MS),
    listCacheTtlMs: validateMcpLimit("listCacheTtlMs", input.listCacheTtlMs ?? defaults.listCacheTtlMs, HARD_LIST_CACHE_TTL_MS),
  };
}
