import type { JsonObject, ToolDefinition } from "@arnilo/prism";
import type { McpServerConfig } from "./config.js";
import type { McpToolBridge } from "./types.js";

export type McpServerState = "connected" | "failed" | "disabled" | "closed";

export interface McpServerStatus {
  readonly id: string;
  readonly serverId: string;
  readonly state: McpServerState;
  readonly toolCount: number;
  readonly added?: number;
  readonly error?: string;
  readonly reason?: string;
}

export interface InternalServerEntry {
  readonly config: McpServerConfig;
  state: McpServerState;
  bridge?: McpToolBridge;
  tools: ToolDefinition[];
  added?: number;
  error?: string;
  reason?: string;
}

const MAX_MCP_ERROR_LENGTH = 1024;

export function redactMcpError(server: McpServerConfig, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  let message = raw;
  if (server.transport === "http" || server.transport === "streamable-http" || server.transport === "sse") {
    if (server.headers) {
      for (const ref of Object.values(server.headers)) {
        if (ref.ref) {
          message = message.split(ref.ref).join("[redacted]");
        }
      }
    }
  }
  message = message.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
  message = message.replace(/((?:token|secret|password|api[_-]?key)=)[^&\s"']+/gi, "$1[redacted]");
  return message.length > MAX_MCP_ERROR_LENGTH ? `${message.slice(0, MAX_MCP_ERROR_LENGTH)}...` : message;
}

export function toServerStatus(entry: InternalServerEntry): McpServerStatus & JsonObject {
  const status = {
    id: entry.config.id,
    serverId: entry.config.id,
    state: entry.state,
    toolCount: entry.state === "connected" ? entry.tools.length : 0,
    ...(entry.added !== undefined ? { added: entry.added } : {}),
    ...(entry.error !== undefined ? { error: entry.error } : {}),
    ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
  };
  return status as McpServerStatus & JsonObject;
}
