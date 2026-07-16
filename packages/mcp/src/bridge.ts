import { Client } from "@modelcontextprotocol/sdk/client";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JsonObject, ToolDefinition, ToolExecutionContext, ToolResult } from "@arnilo/prism";
import {
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_LIST_CACHE_TTL_MS,
  DEFAULT_MAX_RESULT_BYTES,
} from "./constants.js";
import {
  mapMcpContentToBlocks,
  mcpCallError,
  summarizeMcpContent,
} from "./content.js";
import { assertValidServerId, defaultMcpNamePrefix, formatMcpToolName } from "./names.js";
import { createMcpTransport } from "./transport.js";
import type { AttachMcpToolBridgeOptions, ConnectMcpToolsOptions, McpToolBridge } from "./types.js";
import { McpBridgeClosedError, McpBridgeError, McpToolNameCollisionError } from "./types.js";

type ListedMcpTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];

interface BridgeState {
  readonly client: Client;
  readonly transport: Transport;
  readonly serverId: string;
  readonly namePrefix: string;
  readonly listCacheTtlMs: number;
  readonly callTimeoutMs: number;
  readonly maxResultBytes: number;
  tools: ToolDefinition[];
  listFetchedAt: number;
  closed: boolean;
  listRefresh?: Promise<void>;
}

export async function connectMcpTools(options: ConnectMcpToolsOptions): Promise<McpToolBridge> {
  assertValidServerId(options.serverId);
  options.signal?.throwIfAborted();

  const transport = createMcpTransport(options.transport);
  const client = createMcpBridgeClient();
  const state = createBridgeState(client, transport, options);

  const abortListener = () => {
    void closeBridge(state);
  };
  options.signal?.addEventListener("abort", abortListener, { once: true });

  try {
    await client.connect(transport, { signal: options.signal });
    options.signal?.throwIfAborted();
    await refreshBridgeTools(state, { force: true });
  } catch (error) {
    options.signal?.removeEventListener("abort", abortListener);
    await closeBridge(state);
    throw error;
  }

  options.signal?.removeEventListener("abort", abortListener);
  return createBridgeFacade(state);
}

export async function attachMcpToolBridge(
  client: Client,
  transport: Transport,
  options: AttachMcpToolBridgeOptions,
): Promise<McpToolBridge> {
  assertValidServerId(options.serverId);
  const state = createBridgeState(client, transport, options);
  await refreshBridgeTools(state, { force: true });
  return createBridgeFacade(state);
}

export async function listAllMcpTools(client: Client, signal?: AbortSignal): Promise<ListedMcpTool[]> {
  const tools: ListedMcpTool[] = [];
  let cursor: string | undefined;
  do {
    signal?.throwIfAborted();
    const page = await client.listTools(cursor ? { cursor } : undefined, { signal });
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

export function mapMcpToolsToDefinitions(
  remoteTools: readonly ListedMcpTool[],
  context: {
    readonly namePrefix: string;
    readonly serverId: string;
    readonly callTimeoutMs: number;
    readonly maxResultBytes: number;
    readonly isClosed: () => boolean;
    readonly callRemoteTool: (remoteName: string, args: JsonObject, ctx: ToolExecutionContext) => Promise<ToolResult>;
  },
): ToolDefinition[] {
  const seen = new Map<string, string>();
  const tools: ToolDefinition[] = [];

  for (const remote of remoteTools) {
    const prefixedName = formatMcpToolName(context.namePrefix, remote.name);
    const previous = seen.get(prefixedName);
    if (previous !== undefined) {
      throw new McpToolNameCollisionError(prefixedName, remote.name);
    }
    seen.set(prefixedName, remote.name);

    const parameters = remote.inputSchema as ToolDefinition["parameters"];
    tools.push({
      name: prefixedName,
      description: remote.description,
      parameters,
      execute: (args, executionContext) => {
        if (context.isClosed()) {
          throw new McpBridgeClosedError();
        }
        return context.callRemoteTool(remote.name, args, executionContext);
      },
    });
  }

  return tools;
}

function createMcpBridgeClient(): Client {
  return new Client({ name: "prism-mcp-bridge", version: "0.0.5" }, { capabilities: {} });
}

function createBridgeState(
  client: Client,
  transport: Transport,
  options: AttachMcpToolBridgeOptions,
): BridgeState {
  const state: BridgeState = {
    client,
    transport,
    serverId: options.serverId,
    namePrefix: options.namePrefix ?? defaultMcpNamePrefix(options.serverId),
    listCacheTtlMs: options.listCacheTtlMs ?? DEFAULT_LIST_CACHE_TTL_MS,
    callTimeoutMs: options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
    maxResultBytes: options.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES,
    tools: [],
    listFetchedAt: 0,
    closed: false,
  };

  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    state.listFetchedAt = 0;
  });

  return state;
}

function createBridgeFacade(state: BridgeState): McpToolBridge {
  return {
    get tools() {
      assertOpen(state);
      return state.tools;
    },
    refresh: () => refreshBridgeTools(state, { force: true }),
    close: () => closeBridge(state),
  };
}

async function refreshBridgeTools(state: BridgeState, options?: { force?: boolean }): Promise<void> {
  assertOpen(state);
  const now = Date.now();
  if (!options?.force && state.tools.length > 0 && now - state.listFetchedAt < state.listCacheTtlMs) {
    return;
  }
  if (state.listRefresh) {
    await state.listRefresh;
    return;
  }

  state.listRefresh = (async () => {
    const remoteTools = await listAllMcpTools(state.client);
    state.tools = mapMcpToolsToDefinitions(remoteTools, {
      namePrefix: state.namePrefix,
      serverId: state.serverId,
      callTimeoutMs: state.callTimeoutMs,
      maxResultBytes: state.maxResultBytes,
      isClosed: () => state.closed,
      callRemoteTool: (remoteName, args, ctx) => callRemoteTool(state, remoteName, args, ctx),
    });
    state.listFetchedAt = Date.now();
  })();

  try {
    await state.listRefresh;
  } finally {
    state.listRefresh = undefined;
  }
}

async function callRemoteTool(
  state: BridgeState,
  remoteName: string,
  args: JsonObject,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  assertOpen(state);

  const signal = context.signal;
  const timeoutMs = state.callTimeoutMs;
  const abortController = new AbortController();
  const listeners: Array<() => void> = [];

  const onAbort = () => abortController.abort(context.signal?.reason ?? new Error("aborted"));
  if (signal) {
    if (signal.aborted) {
      abortController.abort(signal.reason);
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
      listeners.push(() => signal.removeEventListener("abort", onAbort));
    }
  }

  const timeout = setTimeout(() => {
    abortController.abort(new McpBridgeError(`MCP tool call timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  listeners.push(() => clearTimeout(timeout));

  try {
    const result = await state.client.callTool(
      { name: remoteName, arguments: args },
      undefined,
      { signal: abortController.signal, timeout: timeoutMs },
    );

    if ("toolResult" in result) {
      return {
        toolCallId: context.toolCallId,
        name: formatMcpToolName(state.namePrefix, remoteName),
        value: result.toolResult,
      };
    }

    const mapped = mapMcpContentToBlocks(result.content, { maxResultBytes: state.maxResultBytes });
    const prefixedName = formatMcpToolName(state.namePrefix, remoteName);
    const metadata = {
      mcp: {
        serverId: state.serverId,
        remoteName,
        truncated: mapped.truncated,
        bytesUsed: mapped.bytesUsed,
      },
      ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
    };

    if (result.isError) {
      return {
        toolCallId: context.toolCallId,
        name: prefixedName,
        content: mapped.content,
        error: mcpCallError(summarizeMcpContent(result.content)),
        metadata,
      };
    }

    return {
      toolCallId: context.toolCallId,
      name: prefixedName,
      content: mapped.content,
      value: result.structuredContent,
      metadata,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      toolCallId: context.toolCallId,
      name: formatMcpToolName(state.namePrefix, remoteName),
      error: mcpCallError(message),
      metadata: {
        mcp: { serverId: state.serverId, remoteName },
      },
    };
  } finally {
    for (const dispose of listeners) dispose();
  }
}

async function closeBridge(state: BridgeState): Promise<void> {
  if (state.closed) return;
  state.closed = true;
  state.listFetchedAt = 0;
  state.tools = [];
  try {
    await state.client.close();
  } catch {
    // Best-effort shutdown.
  }
  try {
    await state.transport.close();
  } catch {
    // Best-effort shutdown.
  }
}

function assertOpen(state: BridgeState): void {
  if (state.closed) {
    throw new McpBridgeClosedError();
  }
}
