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

`createPrismMcpServer()` returns the SDK `McpServer`. It lists only passed tools/commands and explicitly selected `agentRuns` lifecycle tools; JSON Schema parameters are converted through installed Zod v4 for SDK validation, then Prism tool calls still pass through `dispatchToolCall` permission/validator/redactor gates. Command definitions support explicitly selected direct/background/replay workflow operations and optional ownership-scoped schedule operations from `createWorkflowCommands()`; none are registered unless the host passes those command definitions. Calls return bounded MCP text content and `isError` on denial/failure. `createPrismMcpWebHandler()` returns `(Request) => Promise<Response>`.

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
| `structuredContent` | `ToolResult.value` (MCP attribution/byte count remains in metadata) |

Duplicate prefixed names throw `McpToolNameCollisionError` at refresh time.

## Extension and configuration notes

| Option | Default | Purpose |
| --- | --- | --- |
| `serverId` | required | Stable identifier used in default name prefix |
| `transport` | required | `stdio` or `streamable-http` config |
| `namePrefix` | `mcp:<serverId>:` | Registry namespace for remote tools |
| `listCacheTtlMs` | 30 s (24 h hard) | Skip re-listing until TTL expires (invalidated on list-changed) |
| `callTimeoutMs` | 60 s (30 min hard) | Connect, list-page, and tool-call SDK request timeout/abort |
| `maxListPages` / `maxTools` | 20 / 500 (hard 100 / 5,000) | Stop pagination before another request/append |
| `maxCursorBytes` | 4 KiB (16 KiB hard) | Reject long or repeated cursors |
| `maxToolNameBytes` | 256 B (1 KiB hard) | Bound each remote name before mapping |
| `maxToolDescriptionBytes` | 16 KiB (64 KiB hard) | Bound each retained description |
| `maxToolSchemaBytes` | 256 KiB (1 MiB hard) | Combined input/output schemas per tool |
| `maxTotalToolSchemaBytes` | 4 MiB (16 MiB hard) | Aggregate schemas per refresh |
| `maxResultBytes` | 10,000,000 B (16 MiB hard) | Aggregate remote result before `ToolResult` |
| `maxJsonDepth` / `maxJsonProperties` | 64 / 10,000 (hard 128 / 100,000) | Bound schema and result JSON walks |
| `signal` | none | Abort connect/list and trigger close on connect abort |

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
  allowedOrigins: ["https://mcp.example.com"],
  maxResponseBytes?: number,       // 16 MiB default, 64 MiB hard
  allowLoopbackHttp?: boolean,     // false; development loopback only
  requestInit?: RequestInit,
  sessionId?: string,
  resolveHostname?: MediaHostnameResolver,
}
```

HTTPS and at least one exact origin are required. The endpoint and every SDK session/reconnect request must match both the configured endpoint origin and `allowedOrigins`; origins cannot contain paths, credentials, fragments, or wildcards. Each request resolves at most 32 addresses, rejects the whole answer on any private/malformed address, pins one validated address through Node's HTTP(S) `lookup` seam, rejects redirects, and streams through the response cap. This covers initialization POSTs, SSE GET/reconnect, tool calls, and session DELETE. Authorization headers therefore never cross an origin or redirect.

Plaintext is accepted only when `allowLoopbackHttp: true`, the URL hostname is loopback/`localhost`, and every DNS answer is loopback. This is a development escape hatch, not private-network MCP access. `resolveHostname` is a test/host DNS seam; returned addresses still receive all checks and pinning. Authentication headers/cookies remain explicit host input through `requestInit.headers`.

### MCP server options

| Option | Default | Purpose |
| --- | --- | --- |
| `tools` / `commands` | empty | Explicit allow-list; zero default exposure |
| `agentRuns` | empty | Explicit `{ [agentId]: { lifecycle } }` map; registers `agent.<id>.status` and `agent.<id>.resume` only |
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
| SSRF / DNS rebinding / redirects (HTTP) | Exact HTTPS origins; credentials/fragments/redirects denied; every DNS answer public; one address pinned per request; explicit loopback-only HTTP escape hatch |
| Hostile discovery / schema compilation | Raw SDK `tools/list` requests avoid SDK Ajv output-schema compilation; finite pages/tools/cursors/metadata/schema totals; failed refresh leaves previous tools unchanged |
| Tool-name shadowing | Prefixed names + `createToolRegistry({ duplicate: "error" })` |
| Oversized/deep/wide server output | One aggregate byte/depth/property walk covers content, structured content, compatibility `toolResult`, and bounded remote errors before `ToolResult` |
| Unvalidated arguments | Register tools with `createJsonSchemaToolArgumentValidator()` at dispatch |
| Missing permission gate | Client direction: `PermissionPolicy` on `tool:mcp:<serverId>:<name>:execute`; server direction: required MCP `authorize` plus optional core `PermissionPolicy` |
| Accidental server exposure | Empty default arrays/maps, duplicate-name rejection, explicit tools/commands/lifecycle only |
| Agent lifecycle data leak or cross-tenant resume | `agentRuns` requires exact tenant plus account/user ownership; core lifecycle returns public redacted state only and CAS-resumes with current agent/revision |
| Unbounded MCP HTTP | Bounded pre-parsed JSON, response bytes, concurrent requests, call timeout, SDK web-standard transport |
| Cross-tenant operation | Authorizer derives ownership from validated auth and passes it to tool dispatch/selected workflow commands; never trust arguments as identity |

For durable lifecycle exposure, construct `createAgentRunLifecycle({ checkpoints, resolveAgent })` in core, then pass selected entries as `agentRuns: { support: { lifecycle } }`. MCP registers two tools: `agent.support.status` accepts `{ runId, sessionId? }`; `agent.support.resume` accepts `{ runId, sessionId?, decision, expectedVersion }`. Do not expose an agent without durable checkpoints and a restart-safe `SessionStore`; no lifecycle tool appears by default.

MCP output is untrusted. Register bridge tools through core dispatch with a `SecretRedactor` so bounded remote content/errors are redacted before persistence or display. `CreatePrismMcpServerOptions.guardrails` applies shared tool-input/output stages to registered Prism tools; commands remain host callbacks. See [Guardrails](guardrails.md). Prism does not infer unknown secrets. MCP server authorization does not replace tool `PermissionPolicy`, argument validation, coding `ExecutionPolicy`, workflow ownership checks, TLS, rate limiting, or sandboxing. A timed-out tool must cooperate with `AbortSignal` to stop side effects; protocol retention and HTTP responses remain bounded when remote work ignores abort.

Discovery validation is atomic: cursor/page/tool/name/description/schema failures reject `refresh()` and preserve the previous immutable tool-array reference. The bridge intentionally uses raw SDK `request()` for `tools/list` and `tools/call`; this avoids eager Ajv compilation/validation of untrusted remote output schemas. Host `ToolValidator` remains the argument-validation owner.

## Related APIs

- [Tools](tools.md): registry, dispatch, validation
- [Tool execution primitives](tool-execution-primitives.md): Plan 055 design and conformance matrix
- [Host security guide](host-security.md): permission, trust, validation checklist
- [Web-standard server handler](server.md): agent/workflow HTTP routes and shared remote-boundary rules
- Package README: [`@arnilo/prism-mcp`](../packages/mcp/README.md)

## Testing

Package tests use in-memory MCP transports plus loopback-only HTTP fixtures for redirect, rebinding, response-cap, abort, and POST/GET/DELETE policy coverage. No public network is required. Hosts should integration-test configured stdio commands and HTTPS endpoints in staging before production registration.
