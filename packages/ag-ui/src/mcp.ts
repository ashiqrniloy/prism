import type { AgentEvent, ToolDefinition, ToolResult } from "@arnilo/prism";
import type { McpAppsBridge, McpToolBridge } from "@arnilo/prism-mcp";
import type { ParsedAgUiInput } from "./input.js";
import type { AgUiActivitySnapshot } from "./projection.js";
import type { AgUiAuthorization } from "./types.js";

export interface AgUiMcpToolSelectionInput<Authorization> {
  readonly request: ParsedAgUiInput;
  readonly authorization: Authorization;
  readonly tools: readonly ToolDefinition[];
  readonly signal: AbortSignal;
}

export interface AgUiMcpPrepareInput<Authorization> extends Omit<AgUiMcpToolSelectionInput<Authorization>, "tools"> {
  readonly maxTools: number;
}

/** Explicit adapter over a reviewed, already-connected Prism MCP bridge. */
export interface AgUiMcpAdapter<Authorization extends AgUiAuthorization = AgUiAuthorization> {
  readonly apps?: McpAppsBridge;
  prepare(input: AgUiMcpPrepareInput<Authorization>): Promise<readonly ToolDefinition[]>;
  /** Internal safe activity projection for a linked MCP App result. */
  activity(event: AgentEvent): AgUiActivitySnapshot | undefined;
}

export interface CreateAgUiMcpAdapterOptions<Authorization extends AgUiAuthorization = AgUiAuthorization> {
  readonly bridge: McpToolBridge;
  /** Picks reviewed model-visible bridge tool names. Raw AG-UI tools never select server tools. */
  readonly select: (
    input: AgUiMcpToolSelectionInput<Authorization>,
  ) => readonly string[] | undefined | Promise<readonly string[] | undefined>;
  /** Optional host allow-list for result data sent to an MCP App renderer. */
  readonly projectResult?: (input: { readonly result: ToolResult; readonly app: McpAppsBridge["tools"][number] }) => unknown;
}

/**
 * Supplies selected Prism MCP tools to `sessionFactory`. The normal Prism agent loop
 * still dispatches calls; this adapter never performs its own model/tool continuation.
 */
export function createAgUiMcpAdapter<Authorization extends AgUiAuthorization = AgUiAuthorization>(
  options: CreateAgUiMcpAdapterOptions<Authorization>,
): AgUiMcpAdapter<Authorization> {
  const apps = options.bridge.apps;
  const activity = (event: AgentEvent): AgUiActivitySnapshot | undefined => {
    if (event.type !== "tool_execution_finished" || !apps) return undefined;
    const app = apps.tools.find((tool) => tool.prismName === event.result.name && tool.resourceUri !== undefined);
    if (!app?.resourceUri) return undefined;
    let result: unknown;
    try {
      result = options.projectResult?.({ result: event.result, app });
    } catch {
      result = undefined;
    }
    return {
      type: "snapshot",
      messageId: `${event.result.toolCallId}:mcp-app`,
      activityType: "mcp-apps",
      content: {
        serverId: apps.serverId,
        toolName: app.name,
        resourceUri: app.resourceUri,
        ...(result === undefined ? {} : { result }),
      },
    };
  };
  return {
    ...(apps === undefined ? {} : { apps }),
    activity,
    async prepare(input) {
      const available = options.bridge.tools;
      const selected = await options.select({
        request: input.request,
        authorization: input.authorization,
        tools: available,
        signal: input.signal,
      });
      if (!selected?.length) return [];
      if (selected.length > input.maxTools) throw new Error("AG-UI MCP tool selection exceeds max tools");
      const names = new Set<string>();
      const tools: ToolDefinition[] = [];
      for (const name of selected) {
        if (typeof name !== "string" || names.has(name)) throw new Error("AG-UI MCP tool selection is invalid");
        const tool = available.find((candidate) => candidate.name === name);
        if (!tool) throw new Error("AG-UI MCP tool is unavailable");
        names.add(name);
        tools.push(tool);
      }
      return tools;
    },
  };
}
