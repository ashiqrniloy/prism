import { Client } from "@modelcontextprotocol/sdk/client";
import {
  CompatibilityCallToolResultSchema,
  ListToolsResultSchema,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JsonObject, ToolDefinition, ToolExecutionContext, ToolResult } from "@arnilo/prism";
import {
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_LIST_CACHE_TTL_MS,
  DEFAULT_MAX_RESULT_BYTES,
} from "./constants.js";
import {
  boundedMcpErrorMessage,
  mapMcpContentToBlocks,
  mcpCallError,
  summarizeMcpContent,
} from "./content.js";
import { measureBoundedJson } from "./json-bounds.js";
import {
  resolveMcpClientLimits,
  type McpClientLimitsInput,
  type ResolvedMcpClientLimits,
} from "./limits.js";
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
  readonly limits: ResolvedMcpClientLimits;
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

  const abortListener = () => { void closeBridge(state); };
  options.signal?.addEventListener("abort", abortListener, { once: true });

  try {
    await client.connect(transport, {
      signal: options.signal,
      timeout: state.limits.callTimeoutMs,
      maxTotalTimeout: state.limits.callTimeoutMs,
    });
    options.signal?.throwIfAborted();
    await refreshBridgeTools(state, { force: true, signal: options.signal });
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
  await refreshBridgeTools(state, { force: true, signal: options.signal });
  return createBridgeFacade(state);
}

/** List through raw SDK requests so untrusted output schemas are bounded before any Ajv compilation. */
export async function listAllMcpTools(
  client: Client,
  signal?: AbortSignal,
  input: McpClientLimitsInput = {},
): Promise<ListedMcpTool[]> {
  const limits = resolveMcpClientLimits(input, {
    maxResultBytes: DEFAULT_MAX_RESULT_BYTES,
    callTimeoutMs: DEFAULT_CALL_TIMEOUT_MS,
    listCacheTtlMs: DEFAULT_LIST_CACHE_TTL_MS,
  });
  const tools: ListedMcpTool[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  let totalSchemaBytes = 0;

  do {
    signal?.throwIfAborted();
    pages += 1;
    if (pages > limits.maxListPages) {
      throw new McpBridgeError(`MCP tools/list exceeds ${limits.maxListPages} pages`);
    }
    const page = await client.request(
      { method: "tools/list", params: cursor ? { cursor } : undefined },
      ListToolsResultSchema,
      { signal, timeout: limits.callTimeoutMs, maxTotalTimeout: limits.callTimeoutMs },
    );
    if (tools.length + page.tools.length > limits.maxTools) {
      throw new McpBridgeError(`MCP tools/list exceeds ${limits.maxTools} tools`);
    }

    for (const tool of page.tools) {
      assertStringBytes("MCP tool name", tool.name, limits.maxToolNameBytes);
      if (tool.description !== undefined) {
        assertStringBytes("MCP tool description", tool.description, limits.maxToolDescriptionBytes);
      }
      let toolSchemaBytes = measureBoundedJson(tool.inputSchema, {
        maxBytes: limits.maxToolSchemaBytes,
        maxDepth: limits.maxJsonDepth,
        maxProperties: limits.maxJsonProperties,
        label: `MCP tool ${tool.name} input schema`,
      }).bytes;
      if (tool.outputSchema !== undefined) {
        const remaining = limits.maxToolSchemaBytes - toolSchemaBytes;
        try {
          toolSchemaBytes += measureBoundedJson(tool.outputSchema, {
            maxBytes: remaining,
            maxDepth: limits.maxJsonDepth,
            maxProperties: limits.maxJsonProperties,
            label: `MCP tool ${tool.name} output schema`,
          }).bytes;
        } catch (error) {
          if (error instanceof McpBridgeError && /exceeds .* bytes/.test(error.message)) {
            throw new McpBridgeError(`MCP tool ${tool.name} schemas exceed ${limits.maxToolSchemaBytes} bytes`, { cause: error });
          }
          throw error;
        }
      }
      totalSchemaBytes += toolSchemaBytes;
      if (totalSchemaBytes > limits.maxTotalToolSchemaBytes) {
        throw new McpBridgeError(`MCP tool schemas exceed ${limits.maxTotalToolSchemaBytes} aggregate bytes`);
      }
      tools.push(tool);
    }

    const nextCursor = page.nextCursor || undefined;
    if (nextCursor) {
      assertStringBytes("MCP tools/list cursor", nextCursor, limits.maxCursorBytes);
      if (seenCursors.has(nextCursor)) throw new McpBridgeError("MCP tools/list repeated a pagination cursor");
      seenCursors.add(nextCursor);
      if (pages >= limits.maxListPages) {
        throw new McpBridgeError(`MCP tools/list exceeds ${limits.maxListPages} pages`);
      }
    }
    cursor = nextCursor;
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
    if (seen.has(prefixedName)) throw new McpToolNameCollisionError(prefixedName, remote.name);
    seen.set(prefixedName, remote.name);

    tools.push({
      name: prefixedName,
      description: remote.description,
      parameters: remote.inputSchema as ToolDefinition["parameters"],
      execute: (args, executionContext) => {
        if (context.isClosed()) throw new McpBridgeClosedError();
        return context.callRemoteTool(remote.name, args, executionContext);
      },
    });
  }

  return tools;
}

function createMcpBridgeClient(): Client {
  return new Client({ name: "prism-mcp-bridge", version: "0.0.12" }, { capabilities: {} });
}

function createBridgeState(
  client: Client,
  transport: Transport,
  options: AttachMcpToolBridgeOptions,
): BridgeState {
  const limits = resolveMcpClientLimits(options, {
    maxResultBytes: DEFAULT_MAX_RESULT_BYTES,
    callTimeoutMs: DEFAULT_CALL_TIMEOUT_MS,
    listCacheTtlMs: DEFAULT_LIST_CACHE_TTL_MS,
  });
  const state: BridgeState = {
    client,
    transport,
    serverId: options.serverId,
    namePrefix: options.namePrefix ?? defaultMcpNamePrefix(options.serverId),
    limits,
    tools: [],
    listFetchedAt: 0,
    closed: false,
  };

  client.setNotificationHandler(ToolListChangedNotificationSchema, () => { state.listFetchedAt = 0; });
  return state;
}

function createBridgeFacade(state: BridgeState): McpToolBridge {
  return {
    get tools() { assertOpen(state); return state.tools; },
    refresh: () => refreshBridgeTools(state, { force: true }),
    close: () => closeBridge(state),
  };
}

async function refreshBridgeTools(
  state: BridgeState,
  options?: { readonly force?: boolean; readonly signal?: AbortSignal },
): Promise<void> {
  assertOpen(state);
  const now = Date.now();
  if (!options?.force && state.tools.length > 0 && now - state.listFetchedAt < state.limits.listCacheTtlMs) return;
  if (state.listRefresh) { await state.listRefresh; return; }

  state.listRefresh = (async () => {
    const remoteTools = await listAllMcpTools(state.client, options?.signal, state.limits);
    const nextTools = mapMcpToolsToDefinitions(remoteTools, {
      namePrefix: state.namePrefix,
      serverId: state.serverId,
      callTimeoutMs: state.limits.callTimeoutMs,
      maxResultBytes: state.limits.maxResultBytes,
      isClosed: () => state.closed,
      callRemoteTool: (remoteName, args, ctx) => callRemoteTool(state, remoteName, args, ctx),
    });
    state.tools = nextTools;
    state.listFetchedAt = Date.now();
  })();

  try { await state.listRefresh; } finally { state.listRefresh = undefined; }
}

async function callRemoteTool(
  state: BridgeState,
  remoteName: string,
  args: JsonObject,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  assertOpen(state);
  const abortController = new AbortController();
  const listeners: Array<() => void> = [];
  const onAbort = () => abortController.abort(context.signal?.reason ?? new Error("aborted"));
  if (context.signal) {
    if (context.signal.aborted) abortController.abort(context.signal.reason);
    else {
      context.signal.addEventListener("abort", onAbort, { once: true });
      listeners.push(() => context.signal?.removeEventListener("abort", onAbort));
    }
  }
  const timeout = setTimeout(() => {
    abortController.abort(new McpBridgeError(`MCP tool call timed out after ${state.limits.callTimeoutMs}ms`));
  }, state.limits.callTimeoutMs);
  listeners.push(() => clearTimeout(timeout));

  const prefixedName = formatMcpToolName(state.namePrefix, remoteName);
  try {
    const result = await state.client.request(
      { method: "tools/call", params: { name: remoteName, arguments: args } },
      CompatibilityCallToolResultSchema,
      {
        signal: abortController.signal,
        timeout: state.limits.callTimeoutMs,
        maxTotalTimeout: state.limits.callTimeoutMs,
      },
    );
    const measured = measureBoundedJson(result, {
      maxBytes: state.limits.maxResultBytes,
      maxDepth: state.limits.maxJsonDepth,
      maxProperties: state.limits.maxJsonProperties,
      label: `MCP tool ${remoteName} result`,
    });

    if ("toolResult" in result) {
      return {
        toolCallId: context.toolCallId,
        name: prefixedName,
        value: result.toolResult,
        metadata: { mcp: { serverId: state.serverId, remoteName, bytesUsed: measured.bytes } },
      };
    }

    const mapped = mapMcpContentToBlocks(result.content, { maxResultBytes: state.limits.maxResultBytes });
    const metadata = {
      mcp: {
        serverId: state.serverId,
        remoteName,
        truncated: mapped.truncated,
        bytesUsed: measured.bytes,
      },
    };

    if (result.isError) {
      return {
        toolCallId: context.toolCallId,
        name: prefixedName,
        content: mapped.content,
        error: mcpCallError(summarizeMcpContent(result.content, Math.min(8 * 1024, state.limits.maxResultBytes))),
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
    return {
      toolCallId: context.toolCallId,
      name: prefixedName,
      error: mcpCallError(boundedMcpErrorMessage(error, Math.min(8 * 1024, state.limits.maxResultBytes))),
      metadata: { mcp: { serverId: state.serverId, remoteName } },
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
  try { await state.client.close(); } catch { /* Best-effort shutdown. */ }
  try { await state.transport.close(); } catch { /* Best-effort shutdown. */ }
}

function assertOpen(state: BridgeState): void {
  if (state.closed) throw new McpBridgeClosedError();
}

function assertStringBytes(label: string, value: string, maxBytes: number): void {
  if (Buffer.byteLength(value, "utf8") > maxBytes) throw new McpBridgeError(`${label} exceeds ${maxBytes} bytes`);
}
