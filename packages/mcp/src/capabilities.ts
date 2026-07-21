import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CreateMessageRequestSchema, ElicitRequestSchema, ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { measureBoundedJson } from "./json-bounds.js";
import { DEFAULT_MAX_CAPABILITY_BYTES, DEFAULT_MAX_CAPABILITY_ITEMS, DEFAULT_MAX_CAPABILITY_PAGES, HARD_MAX_CAPABILITY_BYTES, validateMcpLimit } from "./limits.js";
import { createMcpTransport } from "./transport.js";
import type { AttachMcpToolBridgeOptions, ConnectMcpCapabilitiesOptions, McpCapabilityBridge } from "./types.js";
import { McpBridgeError, McpUnsupportedCapabilityError } from "./types.js";
import { attachMcpToolBridge } from "./bridge.js";

/** Connect all explicitly selected MCP client capabilities without converting them into model tools. */
export async function connectMcpCapabilities(options: ConnectMcpCapabilitiesOptions): Promise<McpCapabilityBridge> {
  const transport = createMcpTransport(options.transport);
  const client = createMcpCapabilityClient(options);
  try {
    await client.connect(transport, { signal: options.signal, timeout: options.callTimeoutMs, maxTotalTimeout: options.callTimeoutMs });
    return await attachMcpCapabilities(client, transport, options);
  } catch (error) {
    try { await client.close(); } catch { /* best effort */ }
    try { await transport.close(); } catch { /* best effort */ }
    throw error;
  }
}

/** Test/host seam for an already-connected official SDK client and transport. */
export async function attachMcpCapabilities(
  client: Client,
  transport: Transport,
  options: AttachMcpToolBridgeOptions & Pick<ConnectMcpCapabilitiesOptions, "maxCapabilityBytes">,
): Promise<McpCapabilityBridge> {
  const maxBytes = validateMcpLimit("maxCapabilityBytes", options.maxCapabilityBytes ?? DEFAULT_MAX_CAPABILITY_BYTES, HARD_MAX_CAPABILITY_BYTES);
  const capabilities = (client.getServerCapabilities() ?? {}) as Readonly<Record<string, unknown>>;
  const tools = capabilities.tools ? await attachMcpToolBridge(client, transport, options) : undefined;
  const requireCapability = (name: string) => { if (!(name in capabilities)) throw new McpUnsupportedCapabilityError(name); };
  const collect = async (name: "resources" | "prompts") => {
    requireCapability(name);
    const out: unknown[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < DEFAULT_MAX_CAPABILITY_PAGES; page += 1) {
      const pageResult = name === "resources"
        ? await client.listResources(cursor ? { cursor } : undefined).then((result) => ({ items: result.resources as readonly unknown[], nextCursor: result.nextCursor, raw: result }))
        : await client.listPrompts(cursor ? { cursor } : undefined).then((result) => ({ items: result.prompts as readonly unknown[], nextCursor: result.nextCursor, raw: result }));
      bounded(pageResult.raw, maxBytes, `MCP ${name}/list`);
      if (out.length + pageResult.items.length > DEFAULT_MAX_CAPABILITY_ITEMS) throw new McpBridgeError(`MCP ${name}/list exceeds ${DEFAULT_MAX_CAPABILITY_ITEMS} items`);
      out.push(...pageResult.items);
      cursor = pageResult.nextCursor;
      if (!cursor) return out;
      if (seen.has(cursor)) throw new McpBridgeError(`MCP ${name}/list repeated a pagination cursor`);
      seen.add(cursor);
    }
    throw new McpBridgeError(`MCP ${name}/list exceeds ${DEFAULT_MAX_CAPABILITY_PAGES} pages`);
  };
  return {
    get tools() { return tools?.tools ?? []; },
    serverVersion: client.getServerVersion(),
    serverCapabilities: capabilities,
    refresh: () => tools?.refresh() ?? Promise.resolve(),
    close: async () => { if (tools) await tools.close(); else { try { await client.close(); } finally { await transport.close(); } } },
    listResources: () => collect("resources"),
    async readResource(uri) { requireCapability("resources"); return bounded(await client.readResource({ uri }), maxBytes, "MCP resource result"); },
    listPrompts: () => collect("prompts"),
    async getPrompt(name, args) { requireCapability("prompts"); return bounded(await client.getPrompt({ name, arguments: args }), maxBytes, "MCP prompt result"); },
  };
}

export function createMcpCapabilityClient(options: ConnectMcpCapabilitiesOptions): Client {
  const maxBytes = validateMcpLimit("maxCapabilityBytes", options.maxCapabilityBytes ?? DEFAULT_MAX_CAPABILITY_BYTES, HARD_MAX_CAPABILITY_BYTES);
  const client = new Client({ name: "prism-mcp-bridge", version: "0.0.10" }, { capabilities: {
    ...(options.roots ? { roots: { listChanged: true } } : {}),
    ...(options.sampling ? { sampling: {} } : {}),
    ...(options.elicitation ? { elicitation: { form: {}, url: {} } } : {}),
  } });
  if (options.roots) client.setRequestHandler(ListRootsRequestSchema, async () => {
    const roots = bounded(await Promise.resolve(options.roots!()), maxBytes, "MCP roots");
    if (roots.length > 500) throw new McpBridgeError("MCP roots exceed 500 items");
    for (const root of roots) {
      let uri: URL;
      try { uri = new URL(root.uri); } catch { throw new McpBridgeError(`Invalid MCP root URI: ${root.uri}`); }
      if (uri.protocol !== "file:") throw new McpBridgeError("MCP roots must use file: URIs approved by the host");
    }
    return { roots };
  });
  if (options.sampling) client.setRequestHandler(CreateMessageRequestSchema, async (request, extra) => bounded(await options.sampling!({ params: bounded(request.params, maxBytes, "MCP sampling request"), signal: extra.signal }), maxBytes, "MCP sampling result") as never);
  if (options.elicitation) client.setRequestHandler(ElicitRequestSchema, async (request, extra) => {
    const result = bounded(await options.elicitation!({ params: bounded(request.params, maxBytes, "MCP elicitation request"), signal: extra.signal }), maxBytes, "MCP elicitation result");
    if (!result || typeof result !== "object" || !("action" in result)) throw new McpBridgeError("Invalid MCP elicitation result");
    const marked = result as Record<string, unknown>;
    if (marked.action === "accept" && marked.humanInteraction !== true) throw new McpBridgeError("Accepted MCP elicitation requires explicit human interaction");
    const { humanInteraction: _marker, ...protocolResult } = marked;
    return protocolResult as never;
  });
  return client;
}

function bounded<T>(value: T, maxBytes: number, label: string): T {
  // SDK result objects may contain optional keys set to undefined; wire JSON omits them.
  const wireValue = JSON.parse(JSON.stringify(value)) as unknown;
  measureBoundedJson(wireValue, { maxBytes, maxDepth: 64, maxProperties: 10_000, label });
  return value;
}
