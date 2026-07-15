# MCP client bridge

## What it does

`@arnilo/prism-mcp` connects Prism hosts to remote [Model Context Protocol](https://modelcontextprotocol.io) servers and maps discovered tools to ordinary `ToolDefinition`s. Transports are stdio subprocesses and Streamable HTTP. The package wraps the official MCP TypeScript SDK (`@modelcontextprotocol/sdk` v1.29+) and does **not** add MCP-specific branches to core Prism.

Primary API:

```ts
import { connectMcpTools } from "@arnilo/prism-mcp";

const bridge = await connectMcpTools({
  serverId: "fs",
  transport: { type: "stdio", command: "node", args: ["server.js"] },
});

// bridge.tools are ToolDefinition[] — register with createToolRegistry / createAgent
await bridge.refresh(); // re-list after notifications or TTL expiry
await bridge.close();   // close client + transport
```

Advanced hosts that manage their own `Client` + `Transport` can call `attachMcpToolBridge(client, transport, options)` after `client.connect(transport)`.

## When to use it

- **Integrate external MCP tool servers** (filesystem, databases, SaaS adapters) without reimplementing JSON-RPC transports in your app.
- **Keep core dispatch gates** — register returned tools and let `dispatchToolCall` enforce permission, JSON Schema validation (`ToolValidator`), middleware, abort, and parallel execution (Plan 055 Tasks 1–2).
- **Explicit lifecycle** — connect, refresh on `notifications/tools/list_changed`, and `close()` when the session ends.

Do **not** use this package as a sandbox, permission engine, or auto-discovery loader. Hosts must trust configured commands/URLs and gate registration.

## Inputs / request

`connectMcpTools()` requires a stable `serverId` plus an explicit stdio or Streamable HTTP transport. Optional bounds control list caching, call timeout, result bytes, name prefix, and abort behavior; defaults are listed below.

## Outputs / response / events

The resolved `McpToolBridge` exposes `tools`, `refresh()`, and `close()`. Each discovered MCP tool becomes a normal Prism `ToolDefinition`; calls return `ToolResult`, with remote `isError` mapped to `ToolResult.error`. List-change notifications invalidate the cache but register nothing automatically.

## Request/response example

```json
{
  "request": { "serverId": "docs", "transport": { "type": "stdio", "command": "node", "args": ["server.js"] } },
  "mappedTool": { "name": "mcp:docs:search", "parameters": { "type": "object" } }
}
```

## Implementation example

```ts
import { createToolRegistry } from "@arnilo/prism";
import { connectMcpTools } from "@arnilo/prism-mcp";

const bridge = await connectMcpTools({
  serverId: "docs",
  transport: { type: "stdio", command: "node", args: ["server.js"] },
  callTimeoutMs: 30_000,
});
const registry = createToolRegistry({ duplicate: "error" });
for (const tool of bridge.tools) registry.register(tool);
```

## Tool naming and mapping

| MCP | Prism |
| --- | --- |
| `tools/list` `inputSchema` | `ToolDefinition.parameters` |
| `tools/call` arguments | Parsed `ToolCallContent.arguments` |
| `tools/call` content blocks | `ToolResult.content` (`text`, `image`; resource/audio/link → descriptive `text`) |
| Tool `name` | Prefixed `mcp:<serverId>:<name>` (override with `namePrefix`) |
| `isError` results | `ToolResult.error` with summarized text |
| `structuredContent` | `ToolResult.value` / metadata |

Duplicate prefixed names throw `McpToolNameCollisionError` at refresh time.

## Extension and configuration notes

| Option | Default | Purpose |
| --- | --- | --- |
| `serverId` | required | Stable identifier used in default name prefix |
| `transport` | required | `stdio` or `streamable-http` config |
| `namePrefix` | `mcp:<serverId>:` | Registry namespace for remote tools |
| `listCacheTtlMs` | `30000` | Skip re-listing until TTL expires (invalidated on list-changed) |
| `callTimeoutMs` | `60000` | Per-call MCP request timeout |
| `maxResultBytes` | `10000000` | Bound mapped result content |
| `signal` | none | Abort connect and trigger close on abort |

### Stdio transport

```ts
{
  type: "stdio",
  command: "node",
  args: ["path/to/server.js"],
  env?: Record<string, string>,
  cwd?: string,
  stderr?: "inherit" | "pipe" | "ignore" | "overlapped",
}
```

The host explicitly chooses the executable, arguments, environment, and working directory. Prism does not search `PATH` for unknown servers or inject credentials.

### Streamable HTTP transport

```ts
{
  type: "streamable-http",
  url: "https://mcp.example.com/mcp",
  requestInit?: RequestInit,
  sessionId?: string,
}
```

Only `http:` and `https:` URLs are accepted. Authentication (Bearer tokens, cookies) is supplied through `requestInit.headers` by the host.

## Security and performance notes

| Risk | Mitigation |
| --- | --- |
| Untrusted subprocess (stdio) | Explicit `command` / `args` / `env` / `cwd`; review before deploy |
| SSRF / open redirects (HTTP) | Host URL allow-lists, network policy, no implicit discovery |
| Tool-name shadowing | Prefixed names + `createToolRegistry({ duplicate: "error" })` |
| Oversized server output | `maxResultBytes` on content mapping |
| Unvalidated arguments | Register tools with `createJsonSchemaToolArgumentValidator()` at dispatch |
| Missing permission gate | `PermissionPolicy` on `tool:mcp:<serverId>:<name>:execute` (or broader deny rules) |

MCP output is untrusted. Apply `SecretRedactor` and host logging policy to `ToolResult` before persisting or displaying.

## Related APIs

- [Tools](tools.md): registry, dispatch, validation
- [Tool execution primitives](tool-execution-primitives.md): Plan 055 design and conformance matrix
- [Host security guide](host-security.md): permission, trust, validation checklist
- Package README: [`@arnilo/prism-mcp`](../packages/mcp/README.md)

## Testing

Package tests use in-memory MCP transports (no network). Hosts should integration-test their configured stdio commands and HTTP endpoints in staging before production registration.
