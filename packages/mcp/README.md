# @arnilo/prism-mcp

Bounded MCP client capabilities and explicit Prism MCP server exposure, pinned to the modular TypeScript SDK v2 packages (@modelcontextprotocol/client and @modelcontextprotocol/server 2.0.0). Client direction connects over stdio or Streamable HTTP and maps discovered tools to `ToolDefinition`s. Server direction registers selected Prism tools/commands on SDK `McpServer`, with required authorization and an optional bounded web-standard handler. Shared elicitation helpers (`mcpElicitationDecision` / `mcpElicitationResultFromDecision`) map onto Prism pending decisions and require host `humanInteraction: true` on accept. Server `guardrails` apply shared core tool stages to registered tools; commands remain host callbacks.

## Install

```bash
npm install @arnilo/prism-mcp @arnilo/prism
```

## Usage

```ts
import { createAgent } from "@arnilo/prism";
import { connectMcpTools } from "@arnilo/prism-mcp";

const bridge = await connectMcpTools({
  serverId: "fs",
  transport: {
    type: "stdio",
    command: "node",
    args: ["path/to/mcp-server.js"],
  },
});

const agent = createAgent({
  model,
  tools: bridge.tools,
});

// When finished:
await bridge.close();
```

Streamable HTTP:

```ts
const bridge = await connectMcpTools({
  serverId: "remote",
  transport: {
    type: "streamable-http",
    url: "https://mcp.example.com/mcp",
    allowedOrigins: ["https://mcp.example.com"],
    requestInit: {
      headers: { Authorization: "Bearer <token>" },
    },
  },
});
```

Remote tool names are prefixed as `mcp:<serverId>:<toolName>` by default to avoid registry collisions. Use `connectMcpCapabilities()` for separate bounded resources/prompts plus explicit host roots/sampling/elicitation callbacks; missing capability calls throw `ERR_PRISM_MCP_UNSUPPORTED_CAPABILITY`.

MCP Apps requires explicit negotiation, not metadata guessing:

```ts
const bridge = await connectMcpTools({ serverId: "weather", transport, mcpApps: true });
const resource = await bridge.apps!.readResource("ui://weather/card");
```

`mcpApps: true` advertises and requires `io.modelcontextprotocol/ui`. `bridge.tools` excludes app-only tools; `bridge.apps` preserves UI metadata, permits linked bounded HTML resource reads, and calls only same-server app-visible tools. Use `@arnilo/prism-ag-ui` to mount an authenticated proxy and separate-origin renderer sandbox; this package never renders HTML.

## Server exposure

```ts
import { createPrismMcpServer, createPrismMcpWebHandler } from "@arnilo/prism-mcp";

const server = createPrismMcpServer({
  tools: [approvedTool],
  commands: [approvedWorkflowCommand],
  authorize: async ({ authInfo }) => hostAllows(authInfo)
    ? { allowed: true, ownership: { tenantId: "tenant-1" } }
    : false,
  validate,
  permission,
  redactor,
});

const handleMcp = await createPrismMcpWebHandler(server, { resolveAuthInfo });
// Dual-era serving: modern 2026-07-28 through SDK createMcpHandler (one fresh
// McpServer per request) plus the SDK stateless legacy fallback. Stateful mode
// additionally requires sessionIdGenerator, exact allowedOrigins, and
// resolveIdentity to bind every POST/GET/DELETE/SSE request to one principal;
// classified legacy session traffic routes beside a strict modern handler.
// The handler stays callable and carries fetch/close/notify/bus;
// servePrismMcpStdio(factory) serves dual-era stdio.
```

Nothing is exposed by default. To expose a durable agent, pass `agentRuns: { support: { lifecycle: createAgentRunLifecycle({ checkpoints, resolveAgent }) } }`; this registers only `agent.support.status` and `agent.support.resume` under normal MCP authorization. Handler uses the SDK dual-era serving entries; no listener or auth provider starts. Request/result/concurrency/timeouts are bounded, and Host/Origin allowlists run before body parsing and auth. Use `server.connect()` directly for in-memory transports; direct HTTP `server.connect()` is legacy-only.

## Security

- Stdio command, args, env, and cwd are **explicit host configuration** — Prism does not auto-launch unknown servers.
- Streamable HTTP requires HTTPS plus an exact `allowedOrigins` entry. Every POST/GET/DELETE/reconnect resolves all DNS answers, rejects mixed/private results, pins one public address, rejects credentials/fragments/redirects, and bounds each response. Plaintext requires `allowLoopbackHttp: true` and loopback-only DNS.
- Discovery defaults to 20 pages/500 tools, finite metadata/schema budgets, and atomic refresh. Raw SDK list/call requests avoid compiling untrusted output schemas.
- Every result branch (`content`, `structuredContent`, legacy `toolResult`) shares `maxResultBytes`, JSON depth, and property bounds before `ToolResult` retention.
- Register returned tools only after reviewing server trust; core `PermissionPolicy` and `ToolValidator` still apply at dispatch.
- MCP Apps keeps nested metadata over deprecated flat metadata, permits only linked `ui://` `text/html;profile=mcp-app` HTML5 bodies, and leaves iframe sandbox/CSP, app-call approval, and mutation recovery to the host/AG-UI adapter.
- Server resources/prompts re-authorize every callback. Sampling/model choice, roots, credentials, and form/URL consent remain host-owned; Prism never opens elicitation URLs. Stateful sessions bind a non-secret principal ID and disclose mismatches only as 404.

See [MCP client/server exposure](../../docs/mcp-tools.md) and [Tool execution primitives](../../docs/tool-execution-primitives.md).
