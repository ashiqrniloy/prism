# @arnilo/prism-mcp

Optional MCP client bridge and explicit Prism MCP server exposure. Client direction connects over stdio or Streamable HTTP and maps discovered tools to `ToolDefinition`s. Server direction registers selected Prism tools/commands on SDK `McpServer`, with required authorization and an optional bounded web-standard handler.

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
    requestInit: {
      headers: { Authorization: "Bearer <token>" },
    },
  },
});
```

Remote tool names are prefixed as `mcp:<serverId>:<toolName>` by default to avoid registry collisions.

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
```

Nothing is exposed by default. Handler uses SDK Web-standard Streamable HTTP transport; no listener or auth provider starts. Request/result/concurrency/timeouts are bounded. Use `server.connect()` directly for SDK stdio/in-memory transports.

## Security

- Stdio command, args, env, and cwd are **explicit host configuration** — Prism does not auto-launch unknown servers.
- HTTP URLs and auth headers are host-supplied; use URL allow-lists and network policy to mitigate SSRF.
- MCP server output is treated as untrusted; `maxResultBytes` bounds mapped content.
- Register returned tools only after reviewing server trust; core `PermissionPolicy` and `ToolValidator` still apply at dispatch.

See [MCP client/server exposure](../../docs/mcp-tools.md) and [Tool execution primitives](../../docs/tool-execution-primitives.md).
