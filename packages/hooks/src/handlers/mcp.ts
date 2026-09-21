/**
 * The `mcp_tool` handler: call a tool on a host-provided MCP client. Codex's only
 * substitution feature is `${field.path}` templates in `input`; that is the only
 * substitution here (no shell, no expressions).
 */
import type { McpToolHookHandler } from "../schema.js";
import { type HookHandlerInput, type HookOutcome, parseHookDecision } from "./command.js";

/** Minimal MCP client surface the adapter needs. The host owns transport, auth, and trust. */
export interface McpToolClient {
  callTool(request: {
    readonly server: string;
    readonly tool: string;
    readonly arguments: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly content?: unknown; readonly isError?: boolean }>;
}

export interface McpHandlerOptions {
  readonly mcpClient?: McpToolClient;
}

/** Everything a `${...}` template may read. */
export function templateScope(input: HookHandlerInput): Record<string, unknown> {
  return {
    event: input.event,
    session_id: input.sessionId,
    sessionId: input.sessionId,
    run_id: input.runId,
    runId: input.runId,
    ...input.payload,
  };
}

const TEMPLATE = /\$\{([^}]+)\}/g;

/** Substitute `${field.path}` in a value tree; an unknown field is an error, never an empty string. */
export function substituteTemplates(value: unknown, scope: Readonly<Record<string, unknown>>, path = "input"): unknown {
  if (typeof value === "string") {
    return value.replace(TEMPLATE, (_match, expression: string) => {
      const resolved = resolvePath(scope, expression.trim());
      if (resolved === undefined) throw new Error(`${path}: unknown template field \${${expression.trim()}}`);
      return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
    });
  }
  if (Array.isArray(value)) return value.map((item, index) => substituteTemplates(item, scope, `${path}[${index}]`));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = substituteTemplates(item, scope, `${path}.${key}`);
    return out;
  }
  return value;
}

function resolvePath(scope: Readonly<Record<string, unknown>>, expression: string): unknown {
  let current: unknown = scope;
  for (const segment of expression.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text"
        ? String((block as { text?: unknown }).text ?? "")
        : "",
    )
    .join("\n")
    .trim();
}

function empty(overrides: Partial<HookOutcome> = {}): HookOutcome {
  return { blocked: false, stopped: false, reason: "", context: "", timedOut: false, failed: false, exitCode: null, ...overrides };
}

/** Run one MCP handler. Never rejects. */
export async function runMcpToolHandler(
  handler: McpToolHookHandler,
  input: HookHandlerInput,
  options: McpHandlerOptions = {},
): Promise<HookOutcome> {
  const client = options.mcpClient;
  if (!client) return empty({ failed: true, reason: `no MCP client was provided for ${handler.server}/${handler.tool}` });
  let args: Readonly<Record<string, unknown>>;
  try {
    const scope = templateScope(input);
    args = (substituteTemplates(handler.input ?? {}, scope) ?? {}) as Readonly<Record<string, unknown>>;
  } catch (error) {
    return empty({ failed: true, reason: (error as Error).message });
  }
  try {
    const result = await client.callTool({ server: handler.server, tool: handler.tool, arguments: args });
    const text = contentText(result.content);
    if (result.isError) return empty({ failed: true, reason: text !== "" ? text : `${handler.server}/${handler.tool} returned an error` });
    return parseHookDecision(text, 0, "");
  } catch (error) {
    return empty({ failed: true, reason: (error as Error).message });
  }
}
