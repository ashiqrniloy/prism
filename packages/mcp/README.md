# @arnilo/prism-mcp

Optional MCP client bridge for Prism. Connects to MCP servers over stdio or Streamable HTTP, discovers tools, and maps them to ordinary `ToolDefinition`s your host registers and dispatches through core Prism gates (permission, JSON Schema validation, parallelism).

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

## Security

- Stdio command, args, env, and cwd are **explicit host configuration** — Prism does not auto-launch unknown servers.
- HTTP URLs and auth headers are host-supplied; use URL allow-lists and network policy to mitigate SSRF.
- MCP server output is treated as untrusted; `maxResultBytes` bounds mapped content.
- Register returned tools only after reviewing server trust; core `PermissionPolicy` and `ToolValidator` still apply at dispatch.

See [MCP tools](../../docs/mcp-tools.md) and [Tool execution primitives](../../docs/tool-execution-primitives.md).
