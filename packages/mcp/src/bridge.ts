import type { JsonObject, ToolDefinition, ToolEffectDeclaration, ToolExecutionContext, ToolResult } from "@arnilo/prism";
import { Client } from "@modelcontextprotocol/sdk/client";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CompatibilityCallToolResultSchema,
  ListResourcesResultSchema,
  ListToolsResultSchema,
  ReadResourceResultSchema,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { DEFAULT_CALL_TIMEOUT_MS, DEFAULT_LIST_CACHE_TTL_MS, DEFAULT_MAX_RESULT_BYTES } from "./constants.js";
import { boundedMcpErrorMessage, mapMcpContentToBlocks, mcpCallError, summarizeMcpContent } from "./content.js";
import { measureBoundedJson } from "./json-bounds.js";
import { type McpClientLimitsInput, type ResolvedMcpClientLimits, resolveMcpClientLimits } from "./limits.js";
import { assertValidServerId, defaultMcpNamePrefix, formatMcpToolName } from "./names.js";
import { createMcpTransport } from "./transport.js";
import type {
  AttachMcpToolBridgeOptions,
  ConnectMcpToolsOptions,
  McpAppResource,
  McpAppsBridge,
  McpAppTool,
  McpToolBridge,
  McpToolEffectPolicy,
  McpUiResourceMetadata,
} from "./types.js";
import { McpBridgeClosedError, McpBridgeError, McpToolNameCollisionError } from "./types.js";

type ListedMcpTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];

interface BridgeState {
  readonly client: Client;
  readonly transport: Transport;
  readonly serverId: string;
  readonly namePrefix: string;
  readonly limits: ResolvedMcpClientLimits;
  tools: ToolDefinition[];
  remoteTools: ListedMcpTool[];
  appTools: McpAppTool[];
  readonly mcpApps: boolean;
  readonly effect?: McpToolEffectPolicy;
  listFetchedAt: number;
  closed: boolean;
  listRefresh?: Promise<void>;
}

export async function connectMcpTools(options: ConnectMcpToolsOptions): Promise<McpToolBridge> {
  assertValidServerId(options.serverId);
  options.signal?.throwIfAborted();

  const transport = createMcpTransport(options.transport);
  const client = createMcpBridgeClient(options.mcpApps === true);
  const state = createBridgeState(client, transport, options);

  const abortListener = () => {
    void closeBridge(state);
  };
  options.signal?.addEventListener("abort", abortListener, { once: true });

  try {
    await client.connect(transport, {
      signal: options.signal,
      timeout: state.limits.callTimeoutMs,
      maxTotalTimeout: state.limits.callTimeoutMs,
    });
    options.signal?.throwIfAborted();
    if (state.mcpApps) assertMcpAppsNegotiated(client);
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
  if (state.mcpApps) assertMcpAppsNegotiated(client);
  await refreshBridgeTools(state, { force: true, signal: options.signal });
  return createBridgeFacade(state);
}

/** List through raw SDK requests so untrusted output schemas are bounded before any Ajv compilation. */
export async function listAllMcpTools(client: Client, signal?: AbortSignal, input: McpClientLimitsInput = {}): Promise<ListedMcpTool[]> {
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
    const page = await client.request({ method: "tools/list", params: cursor ? { cursor } : undefined }, ListToolsResultSchema, {
      signal,
      timeout: limits.callTimeoutMs,
      maxTotalTimeout: limits.callTimeoutMs,
    });
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
    readonly effectForRemoteTool?: (remote: ListedMcpTool) => ToolEffectDeclaration;
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
      effect: context.effectForRemoteTool?.(remote) ?? unsupportedRemoteEffect(),
      execute: (args, executionContext) => {
        if (context.isClosed()) throw new McpBridgeClosedError();
        return context.callRemoteTool(remote.name, args, executionContext);
      },
    });
  }

  return tools;
}

function unsupportedRemoteEffect(): ToolEffectDeclaration {
  return { kind: "external_mutation", idempotency: "unsupported" };
}

function resolveRemoteToolEffect(state: BridgeState, remote: ListedMcpTool): ToolEffectDeclaration {
  const effect = state.effect?.({ serverId: state.serverId, remoteName: remote.name });
  const resolved = effect ?? unsupportedRemoteEffect();
  if (
    !["none", "local_mutation", "external_mutation"].includes(resolved.kind) ||
    !["none", "optional", "required", "tool_managed", "unsupported"].includes(resolved.idempotency) ||
    (resolved.kind === "none" && resolved.idempotency !== "none")
  ) {
    throw new McpBridgeError("MCP tool effect policy returned an invalid declaration");
  }
  return Object.freeze({ kind: resolved.kind, idempotency: resolved.idempotency });
}

function createMcpBridgeClient(mcpApps: boolean): Client {
  return new Client(
    { name: "prism-mcp-bridge", version: "0.0.12" },
    { capabilities: mcpApps ? { extensions: { "io.modelcontextprotocol/ui": {} } } : {} },
  );
}

function createBridgeState(client: Client, transport: Transport, options: AttachMcpToolBridgeOptions): BridgeState {
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
    remoteTools: [],
    appTools: [],
    mcpApps: options.mcpApps === true,
    effect: options.effect,
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
    ...(state.mcpApps ? { apps: createMcpAppsFacade(state) } : {}),
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
  if (state.listRefresh) {
    await state.listRefresh;
    return;
  }

  state.listRefresh = (async () => {
    const remoteTools = await listAllMcpTools(state.client, options?.signal, state.limits);
    const appTools = state.mcpApps ? remoteTools.map((tool) => toMcpAppTool(tool, state)) : [];
    const nextTools = mapMcpToolsToDefinitions(
      state.mcpApps ? remoteTools.filter((_tool, index) => appTools[index]!.visibility.includes("model")) : remoteTools,
      {
        namePrefix: state.namePrefix,
        serverId: state.serverId,
        callTimeoutMs: state.limits.callTimeoutMs,
        maxResultBytes: state.limits.maxResultBytes,
        isClosed: () => state.closed,
        callRemoteTool: (remoteName, args, ctx) => callRemoteTool(state, remoteName, args, ctx),
        effectForRemoteTool: (remote) => resolveRemoteToolEffect(state, remote),
      },
    );
    state.remoteTools = remoteTools;
    state.appTools = appTools;
    state.tools = nextTools;
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
  state.remoteTools = [];
  state.appTools = [];
  try {
    await state.client.close();
  } catch {
    /* Best-effort shutdown. */
  }
  try {
    await state.transport.close();
  } catch {
    /* Best-effort shutdown. */
  }
}

function assertOpen(state: BridgeState): void {
  if (state.closed) throw new McpBridgeClosedError();
}

function assertMcpAppsNegotiated(client: Client): void {
  const capabilities = record(client.getServerCapabilities());
  if (!record(capabilities?.extensions)?.["io.modelcontextprotocol/ui"]) throw new McpBridgeError("MCP Apps extension was not negotiated");
}

function createMcpAppsFacade(state: BridgeState): McpAppsBridge {
  return {
    serverId: state.serverId,
    negotiated: true,
    get tools() {
      assertOpen(state);
      return state.appTools;
    },
    listResources: () => listMcpAppResources(state),
    readResource: (uri) => readMcpAppResource(state, uri),
    callTool: (name, args, context) => {
      assertOpen(state);
      const tool = state.appTools.find((candidate) => candidate.name === name && candidate.visibility.includes("app"));
      if (!tool) throw new McpBridgeError("MCP App tool is unavailable");
      return callRemoteTool(state, name, args, context);
    },
  };
}

function toMcpAppTool(tool: ListedMcpTool, state: BridgeState): McpAppTool {
  const meta = uiMetadata((tool as { readonly _meta?: unknown })._meta, state.limits, `MCP tool ${tool.name}`);
  const visibility = toolVisibility((tool as { readonly _meta?: unknown })._meta, state.limits, `MCP tool ${tool.name}`);
  const resourceUri = meta?.resourceUri;
  return {
    name: tool.name,
    prismName: formatMcpToolName(state.namePrefix, tool.name),
    ...(tool.description === undefined ? {} : { description: tool.description }),
    inputSchema: tool.inputSchema as JsonObject,
    ...(resourceUri === undefined ? {} : { resourceUri }),
    visibility,
  };
}

async function listMcpAppResources(state: BridgeState): Promise<readonly Omit<McpAppResource, "html">[]> {
  assertOpen(state);
  const resources: Omit<McpAppResource, "html">[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < state.limits.maxListPages; page += 1) {
    const result = await state.client.request(
      { method: "resources/list", params: cursor === undefined ? undefined : { cursor } },
      ListResourcesResultSchema,
      { timeout: state.limits.callTimeoutMs, maxTotalTimeout: state.limits.callTimeoutMs },
    );
    measureBoundedJson(result, {
      maxBytes: state.limits.maxResultBytes,
      maxDepth: state.limits.maxJsonDepth,
      maxProperties: state.limits.maxJsonProperties,
      label: "MCP Apps resources/list",
    });
    for (const resource of result.resources) {
      const parsed = resourceDescriptor(resource, state.limits);
      if (parsed) resources.push(parsed);
      if (resources.length > state.limits.maxTools) throw new McpBridgeError("MCP Apps resources/list exceeds configured item limit");
    }
    cursor = result.nextCursor || undefined;
    if (!cursor) return resources;
    assertStringBytes("MCP Apps resources/list cursor", cursor, state.limits.maxCursorBytes);
    if (seen.has(cursor)) throw new McpBridgeError("MCP Apps resources/list repeated a pagination cursor");
    seen.add(cursor);
  }
  throw new McpBridgeError(`MCP Apps resources/list exceeds ${state.limits.maxListPages} pages`);
}

async function readMcpAppResource(state: BridgeState, uri: string): Promise<McpAppResource> {
  assertOpen(state);
  assertUiUri(uri, "MCP App resource URI");
  const tool = state.appTools.find((candidate) => candidate.resourceUri === uri);
  if (!tool) throw new McpBridgeError("MCP App resource is unavailable");
  const result = await state.client.request({ method: "resources/read", params: { uri } }, ReadResourceResultSchema, {
    timeout: state.limits.callTimeoutMs,
    maxTotalTimeout: state.limits.callTimeoutMs,
  });
  measureBoundedJson(result, {
    maxBytes: state.limits.maxResultBytes,
    maxDepth: state.limits.maxJsonDepth,
    maxProperties: state.limits.maxJsonProperties,
    label: "MCP Apps resources/read",
  });
  const listed = await listMcpAppResources(state);
  const listedResource = listed.find((candidate) => candidate.uri === uri);
  const content = result.contents.find((candidate) => candidate.uri === uri);
  if (content?.mimeType !== "text/html;profile=mcp-app") throw new McpBridgeError("MCP App resource must be declared HTML");
  const text = "text" in content && typeof content.text === "string" ? content.text : undefined;
  const blob = "blob" in content && typeof content.blob === "string" ? decodeHtmlBlob(content.blob) : undefined;
  if ((text === undefined) === (blob === undefined)) throw new McpBridgeError("MCP App resource requires one HTML body");
  const html = text ?? blob!;
  if (Buffer.byteLength(html, "utf8") > state.limits.maxResultBytes || !/<!doctype\s+html[\s>]/iu.test(html) || !/<html[\s>]/iu.test(html))
    throw new McpBridgeError("MCP App resource is not bounded HTML5");
  // Content metadata takes precedence over the reviewable resources/list default.
  const ui = uiResourceMetadata((content as { readonly _meta?: unknown })._meta, state.limits, "MCP App resource") ?? listedResource?.ui;
  return {
    uri,
    name: tool.name,
    ...(tool.description === undefined ? {} : { description: tool.description }),
    mimeType: "text/html;profile=mcp-app",
    html,
    ...(ui === undefined ? {} : { ui }),
  };
}

function resourceDescriptor(value: unknown, limits: ResolvedMcpClientLimits): Omit<McpAppResource, "html"> | undefined {
  const resource = record(value);
  if (
    !resource ||
    typeof resource.uri !== "string" ||
    typeof resource.name !== "string" ||
    resource.mimeType !== "text/html;profile=mcp-app"
  )
    return undefined;
  assertUiUri(resource.uri, "MCP App resource URI");
  assertStringBytes("MCP App resource name", resource.name, limits.maxToolNameBytes);
  if (resource.description !== undefined && typeof resource.description !== "string")
    throw new McpBridgeError("MCP App resource description is invalid");
  const ui = uiResourceMetadata(resource._meta, limits, "MCP App resource");
  return {
    uri: resource.uri,
    name: resource.name,
    ...(resource.description === undefined ? {} : { description: resource.description }),
    mimeType: "text/html;profile=mcp-app",
    ...(ui === undefined ? {} : { ui }),
  };
}

function toolVisibility(meta: unknown, limits: ResolvedMcpClientLimits, label: string): readonly ("model" | "app")[] {
  const ui = uiRecord(meta, limits, label);
  const value = ui?.visibility;
  if (value === undefined) return ["model", "app"];
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 2 ||
    new Set(value).size !== value.length ||
    !value.every((item) => item === "model" || item === "app")
  )
    throw new McpBridgeError(`${label} has invalid MCP Apps visibility`);
  return value as ("model" | "app")[];
}

function uiMetadata(meta: unknown, limits: ResolvedMcpClientLimits, label: string): { readonly resourceUri?: string } | undefined {
  const ui = uiRecord(meta, limits, label);
  const flat = record(meta)?.["ui/resourceUri"];
  const resourceUri = ui?.resourceUri ?? flat; // Nested metadata supersedes deprecated flat metadata.
  if (resourceUri === undefined) return undefined;
  if (typeof resourceUri !== "string") throw new McpBridgeError(`${label} has invalid MCP Apps resource URI`);
  assertUiUri(resourceUri, `${label} MCP Apps resource URI`);
  return { resourceUri };
}

function uiResourceMetadata(meta: unknown, limits: ResolvedMcpClientLimits, label: string): McpUiResourceMetadata | undefined {
  const ui = uiRecord(meta, limits, label);
  if (!ui) return undefined;
  const domains = (key: "connectDomains" | "resourceDomains" | "frameDomains" | "baseUriDomains") => {
    const csp = record(ui.csp);
    const value = csp?.[key];
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > 32 || !value.every((item) => typeof item === "string"))
      throw new McpBridgeError(`${label} has invalid MCP Apps CSP`);
    for (const item of value) assertCspOrigin(item, key);
    return [...value] as readonly string[];
  };
  const csp = compact({
    connectDomains: domains("connectDomains"),
    resourceDomains: domains("resourceDomains"),
    frameDomains: domains("frameDomains"),
    baseUriDomains: domains("baseUriDomains"),
  });
  const permissionsSource = record(ui.permissions);
  const permissions = permissionsSource
    ? compact(
        Object.fromEntries(
          ["camera", "microphone", "geolocation", "clipboardWrite"].map((key) => [key, record(permissionsSource[key]) ? true : undefined]),
        ),
      )
    : undefined;
  const domain = typeof ui.domain === "string" && /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/iu.test(ui.domain) ? ui.domain : undefined;
  if (ui.domain !== undefined && domain === undefined) throw new McpBridgeError(`${label} has invalid MCP Apps domain`);
  if (ui.prefersBorder !== undefined && typeof ui.prefersBorder !== "boolean")
    throw new McpBridgeError(`${label} has invalid MCP Apps border preference`);
  const output = compact({
    csp: Object.keys(csp).length ? csp : undefined,
    permissions: permissions && Object.keys(permissions).length ? permissions : undefined,
    domain,
    prefersBorder: ui.prefersBorder,
  });
  return Object.keys(output).length ? (output as McpUiResourceMetadata) : undefined;
}

function uiRecord(meta: unknown, limits: ResolvedMcpClientLimits, label: string): Record<string, unknown> | undefined {
  if (meta === undefined) return undefined;
  measureBoundedJson(meta, {
    maxBytes: limits.maxToolDescriptionBytes,
    maxDepth: limits.maxJsonDepth,
    maxProperties: limits.maxJsonProperties,
    label: `${label} MCP Apps metadata`,
  });
  const value = record(meta)?.ui;
  if (value === undefined) return undefined;
  const parsed = record(value);
  if (!parsed) throw new McpBridgeError(`${label} has invalid MCP Apps metadata`);
  return parsed;
}

function assertUiUri(value: string, label: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new McpBridgeError(`${label} is invalid`);
  }
  if (url.protocol !== "ui:" || !url.hostname || url.username || url.password || url.hash || Buffer.byteLength(value, "utf8") > 4 * 1024)
    throw new McpBridgeError(`${label} is invalid`);
}

function assertCspOrigin(value: string, kind: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new McpBridgeError("MCP Apps CSP origin is invalid");
  }
  const protocol = kind === "connectDomains" ? /^(https:|wss:)$/u : /^https:$/u;
  if (
    !protocol.test(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.hostname.includes("*") ||
    Buffer.byteLength(value, "utf8") > 512
  )
    throw new McpBridgeError("MCP Apps CSP origin is invalid");
}

function decodeHtmlBlob(value: string): string {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value))
    throw new McpBridgeError("MCP App HTML blob is invalid");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(value, "base64"));
  } catch {
    throw new McpBridgeError("MCP App HTML blob is invalid");
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function assertStringBytes(label: string, value: string, maxBytes: number): void {
  if (Buffer.byteLength(value, "utf8") > maxBytes) throw new McpBridgeError(`${label} exceeds ${maxBytes} bytes`);
}
