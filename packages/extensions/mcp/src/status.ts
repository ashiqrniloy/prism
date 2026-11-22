import type { JsonObject, ToolDefinition, ToolResult } from "@arnilo/prism";
import type { McpServerConfig } from "./config.js";
import { mcpCallError } from "./content.js";
import type { McpToolBridge } from "./types.js";

export type McpServerState = "connected" | "reconnecting" | "failed" | "disabled" | "closed";

export interface McpServerStatus {
  readonly id: string;
  readonly serverId: string;
  readonly state: McpServerState;
  readonly toolCount: number;
  readonly added?: number;
  readonly error?: string;
  readonly reason?: string;
  /** An OAuth sign-in started during setup is still waiting for the person (plan 234 Task 4). */
  readonly signingIn?: boolean;
  /** While `reconnecting`: the attempt in progress (1-based) and the configured attempts. */
  readonly attempt?: number;
  readonly attempts?: number;
}

export interface InternalServerEntry {
  readonly config: McpServerConfig;
  state: McpServerState;
  bridge?: McpToolBridge;
  /** The last mapping of `bridge.tools`, reused while the bridge answers the same list. */
  mapped?: { readonly from: readonly ToolDefinition[]; readonly tools: readonly ToolDefinition[] };
  /** Tool names at the last connect, so a reconnect can count what it added. */
  connectedNames?: readonly string[];
  signingIn?: boolean;
  attempt?: number;
  attempts?: number;
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

/**
 * The server's model-visible tools now, each with `effects` from the server's `readOnly` setting (never from the
 * server's own annotations). Empty unless connected; a closed bridge's `tools` getter throws, which reads as empty.
 */
export function currentServerTools(entry: InternalServerEntry): readonly ToolDefinition[] {
  if (entry.state !== "connected" || !entry.bridge) return [];
  let tools: readonly ToolDefinition[];
  try {
    tools = entry.bridge.tools;
  } catch {
    return [];
  }
  if (entry.mapped?.from === tools) return entry.mapped.tools;
  const effects = entry.config.readOnly ? (["read"] as const) : (["external"] as const);
  const bridge = entry.bridge;
  const mapped = tools.map(
    (tool): ToolDefinition => ({
      ...tool,
      effects: [...effects],
      // A run keeps the tools it started with; once this bridge is gone the call names the server's state.
      execute: (args, context) => {
        if (entry.state === "connected" && entry.bridge === bridge) return tool.execute(args, context);
        const message =
          entry.state === "connected"
            ? `MCP server "${entry.config.id}" reconnected; its tools are available from the next run`
            : `MCP server "${entry.config.id}" is ${entry.state}`;
        return { toolCallId: context.toolCallId, name: tool.name, error: mcpCallError(message) } satisfies ToolResult;
      },
    }),
  );
  entry.mapped = { from: tools, tools: mapped };
  return mapped;
}

export function toServerStatus(entry: InternalServerEntry): McpServerStatus & JsonObject {
  const status = {
    id: entry.config.id,
    serverId: entry.config.id,
    state: entry.state,
    toolCount: currentServerTools(entry).length,
    ...(entry.added !== undefined ? { added: entry.added } : {}),
    ...(entry.error !== undefined ? { error: entry.error } : {}),
    ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
    ...(entry.signingIn ? { signingIn: true } : {}),
    ...(entry.state === "reconnecting" && entry.attempt !== undefined ? { attempt: entry.attempt, attempts: entry.attempts } : {}),
  };
  return status as McpServerStatus & JsonObject;
}
