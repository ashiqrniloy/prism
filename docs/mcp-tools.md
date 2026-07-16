# MCP client bridge and server exposure

## What it does

`@arnilo/prism-mcp` has two explicit directions. Its client bridge connects hosts to remote [Model Context Protocol](https://modelcontextprotocol.io) servers and maps discovered tools to ordinary `ToolDefinition`s. Its server API registers selected Prism `ToolDefinition` and `CommandDefinition` values on the official SDK `McpServer`, with required authorization and a bounded optional Web-standard Streamable HTTP handler. The package wraps `@modelcontextprotocol/sdk` v1.29+ and adds no MCP branch to core Prism.

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

Server direction:

```ts
import { createPrismMcpServer, createPrismMcpWebHandler } from "@arnilo/prism-mcp";

const server = createPrismMcpServer({
  tools: [approvedTool],
  commands: [approvedWorkflowStatusCommand],
  authorize: async ({ authInfo, kind, name }) => hostPolicy(authInfo, kind, name)
    ? { allowed: true, ownership: { tenantId: "tenant-1" } }
    : false,
  validate,
  permission,
  redactor,
});

const handleMcp = await createPrismMcpWebHandler(server, {
  resolveAuthInfo: authenticateRequest,
  allowedHosts: ["api.example.test"],
  allowedOrigins: ["https://app.example.test"],
});
```

`McpServer.connect(transport)` remains available for SDK stdio or in-memory transports. The helper uses SDK `WebStandardStreamableHTTPServerTransport` in bounded stateless JSON-response mode; it does not start a listener.

## When to use it

- **Integrate external MCP tool servers** (filesystem, databases, SaaS adapters) without reimplementing JSON-RPC transports in your app.
- **Keep core dispatch gates** — register returned tools and let `dispatchToolCall` enforce permission, JSON Schema validation (`ToolValidator`), middleware, abort, and parallel execution (Plan 055 Tasks 1–2).
- **Explicit lifecycle** — connect, refresh on `notifications/tools/list_changed`, and `close()` when the session ends.
- **Expose selected capabilities** — register a reviewed tool/command allow-list for MCP clients without a custom JSON-RPC server.

Do **not** use this package as a sandbox, permission engine, or auto-discovery loader. Hosts must trust configured commands/URLs and gate registration.

## Inputs / request

`connectMcpTools()` requires a stable `serverId` plus an explicit stdio or Streamable HTTP transport. Optional bounds control list caching, call timeout, result bytes, name prefix, and abort behavior; defaults are listed below.

## Outputs / response / events

The resolved `McpToolBridge` exposes `tools`, `refresh()`, and `close()`. Each discovered MCP tool becomes a normal Prism `ToolDefinition`; calls return `ToolResult`, with remote `isError` mapped to `ToolResult.error`. List-change notifications invalidate the cache but register nothing automatically.

`createPrismMcpServer()` returns the SDK `McpServer`. It lists only passed tools/commands; JSON Schema parameters are converted through installed Zod v4 for SDK validation, then Prism tool calls still pass through `dispatchToolCall` permission/validator/redactor gates. Command definitions support explicitly selected direct/background/replay workflow operations and optional ownership-scoped schedule operations from `createWorkflowCommands()`; none are registered unless the host passes those command definitions. Calls return bounded MCP text content and `isError` on denial/failure. `createPrismMcpWebHandler()` returns `(Request) => Promise<Response>`.

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

### MCP server options

| Option | Default | Purpose |
| --- | --- | --- |
| `tools` / `commands` | empty | Explicit allow-list; zero default exposure |
| `authorize` | required | Per-call host authz using SDK auth/session metadata |
| `permission` / `validate` / `redactor` | none | Core tool-dispatch gates and known-secret redaction |
| `maxResultBytes` | 1 MiB (8 MiB hard) | Bound mapped MCP call output |
| `maxConcurrentCalls` | 16 (256 hard) | Bound active tool/command execution |
| `callTimeoutMs` | 60 s (30 min hard) | Abort and return timed-out calls |

Web handler defaults: 1 MiB request (8 MiB hard), 2 MiB response (16 MiB hard), 32 concurrent requests (512 hard), and 60 s timeout (30 min hard). It parses bounded JSON before passing `parsedBody` to the SDK transport. `allowedHosts`/`allowedOrigins` activate SDK DNS-rebinding checks only when explicitly configured. Authentication data comes only from host `resolveAuthInfo()`.

## Security and performance notes

| Risk | Mitigation |
| --- | --- |
| Untrusted subprocess (stdio) | Explicit `command` / `args` / `env` / `cwd`; review before deploy |
| SSRF / open redirects (HTTP) | Host URL allow-lists, network policy, no implicit discovery |
| Tool-name shadowing | Prefixed names + `createToolRegistry({ duplicate: "error" })` |
| Oversized server output | `maxResultBytes` on content mapping |
| Unvalidated arguments | Register tools with `createJsonSchemaToolArgumentValidator()` at dispatch |
| Missing permission gate | Client direction: `PermissionPolicy` on `tool:mcp:<serverId>:<name>:execute`; server direction: required MCP `authorize` plus optional core `PermissionPolicy` |
| Accidental server exposure | Empty default arrays, duplicate-name rejection, explicit tools/commands only |
| Unbounded MCP HTTP | Bounded pre-parsed JSON, response bytes, concurrent requests, call timeout, SDK web-standard transport |
| Cross-tenant operation | Authorizer derives ownership from validated auth and passes it to tool dispatch/selected workflow commands; never trust arguments as identity |

MCP output is untrusted. Apply `SecretRedactor` and host logging policy to `ToolResult` before persisting or displaying. MCP server authorization does not replace tool `PermissionPolicy`, argument validation, coding `ExecutionPolicy`, workflow ownership checks, TLS, rate limiting, or sandboxing. A timed-out tool must cooperate with `AbortSignal` to stop side effects; the response is bounded even when untrusted code ignores abort.

## Related APIs

- [Tools](tools.md): registry, dispatch, validation
- [Tool execution primitives](tool-execution-primitives.md): Plan 055 design and conformance matrix
- [Host security guide](host-security.md): permission, trust, validation checklist
- [Web-standard server handler](server.md): agent/workflow HTTP routes and shared remote-boundary rules
- Package README: [`@arnilo/prism-mcp`](../packages/mcp/README.md)

## Testing

Package tests use in-memory MCP transports (no network). Hosts should integration-test their configured stdio commands and HTTP endpoints in staging before production registration.
