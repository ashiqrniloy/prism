# `@arnilo/prism-extensions/mcp`

Connect Model Context Protocol servers to a Prism agent, and bridge their tools.

## What it does

`@arnilo/prism-extensions/mcp` is a native Prism package. List it and it connects each allowed server during `setup`, registers the discovered tools with `effects`, and exposes status, reconnect, and close as package commands. The MCP client library (`connectMcpTools`, `McpToolBridge`, `createMcpClientAuth`, the transports, and the bounds) stays exported for hosts that build their own bridge.

## When to use it

A host wants an agent to call tools from one or more MCP servers. Put the servers in package config. Do not put secrets in the config — every header and secret env value is a `env:`/`keyring:` ref.

## Install

```bash
bun add @arnilo/prism-extensions @arnilo/prism
```

## Inputs

```ts
import mcp from "@arnilo/prism-extensions/mcp";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model,
  packages: [
    mcp({
      servers: [
        {
          id: "docs",
          transport: "http",
          url: "https://mcp.example.com/mcp",
          allow: "https://mcp.example.com",
          headers: { Authorization: { ref: "env:DOCS_MCP_TOKEN", prefix: "Bearer " } },
        },
        { id: "fs", transport: "stdio", command: "mcp-fs", args: ["."], allow: "stdio:mcp-fs" },
      ],
    }),
  ],
});
```

### Config

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `servers[]` | `McpServerConfig[]` | `[]` | No servers means `setup` registers nothing. |
| `servers[].id` | `string` | required | Unique per agent. |
| `servers[].transport` | `"stdio" \| "http" \| "streamable-http" \| "sse" \| "raw"` | required | |
| `servers[].command` / `args` / `cwd` | stdio | — | `command` is required for `stdio`. |
| `servers[].env` | `Record<string, string \| { ref }>` | — | A secret value must be a `{ ref }`; a literal is allowed for non-secrets. |
| `servers[].url` | `string` | required for HTTP | |
| `servers[].headers` | `Record<string, { ref, prefix? }>` | — | Ref-only. Resolved through `prism.credentials.resolve` at connect. |
| `servers[].allowedOrigins` | `string[]` | the URL origin | Exact origins for the HTTP transport. |
| `servers[].allow` | `string \| string[]` | — | Required per server unless the plane `allow` is set. |
| `servers[].namePrefix` | `string` | `mcp:<id>` | Remote tools are `mcp:<id>:<toolName>`. |
| `servers[].connectTimeoutMs` | `integer` | `15000` | Per-server connect bound. |
| `servers[].readOnly` | `boolean` | `false` | `true` registers tools with `effects: ["read"]`; `false` gives `["external"]`. |
| `servers[].enabled` | `boolean` | `true` | `false` reports `disabled`. |
| `allow` | `string \| string[]` | — | Plane-level allow list; a server must match its own `allow` and this one. |
| `trusted` | `string[]` | `[]` | Fingerprints (`mcpServerFingerprint`) trusted without a prompt. Ignored from the project scope. |
| `connectTimeoutMs` | `integer` | `15000` | Plane-level default. |

A `raw` server takes its transport from the `mcp.transport` service, keyed by server id. A missing service or entry makes that server `failed`.

### Capabilities

`host-ui`, `credentials`. `host-ui` is used for the project-trust prompt; `credentials` resolves every header and secret env ref.

### Project trust

A server whose `servers` config came from the **project** manifest connects only after `host.ui` `confirm` answers yes. `answered: false`, `dismissed`, and `unavailable` all mean it never spawns. A fingerprint listed in `trusted` from a `code` or `host` source skips the prompt. A `trusted` list from a project source is ignored, with a status note.

### Commands

| Command | Args | Result |
| --- | --- | --- |
| `mcp:status` | — | `{ servers: [{ id, state, toolCount, added?, error?, reason? }] }` |
| `mcp:reconnect` | `{ id }` | Reconnects one server; trust is not re-asked for an already-trusted server. |
| `mcp:close` | `{ id? }` | Closes one server, or all of them. |

Each transition emits an `mcp.status` package event with the server status. A tool that first appears after a reconnect is counted in `added` and a status note says to recreate the agent.

### Effects

Bridged tools declare `effects: ["external"]`, or `["read"]` with `readOnly: true`, so approval and governance decide generically.

## Cost

Servers connect concurrently in `setup`, so setup latency is the slowest server's `connectTimeoutMs`, not the sum. With no servers configured, `setup` registers nothing.

## Client library

```ts
import { connectMcpTools } from "@arnilo/prism-extensions/mcp";

const bridge = await connectMcpTools({
  serverId: "fs",
  transport: { type: "stdio", command: "node", args: ["path/to/mcp-server.js"] },
});
```

Remote tool names are prefixed as `mcp:<serverId>:<toolName>` by default. Use `connectMcpCapabilities()` for separate bounded resources/prompts plus explicit host roots/sampling/elicitation callbacks; missing capability calls throw `ERR_PRISM_MCP_UNSUPPORTED_CAPABILITY`. MCP Apps requires explicit negotiation (`mcpApps: true`); `bridge.tools` excludes app-only tools and `bridge.apps` preserves UI metadata. Use `@arnilo/prism-hosts/ag-ui` to mount an authenticated proxy and separate-origin renderer sandbox; this package never renders HTML.

## Server exposure

Server exposure (`serveMcp`, `createPrismMcpWebHandler`, `servePrismMcpStdio`) has moved to the [`@arnilo/prism-hosts/mcp-server`](../../hosts/mcp-server) host library package.

```bash
bun add @arnilo/prism-hosts/mcp-server
```

```ts
import { createPrismMcpWebHandler, serveMcp, servePrismMcpStdio } from "@arnilo/prism-hosts/mcp-server";
```

## Security

- Stdio command, args, env, and cwd are **explicit host configuration** — Prism does not auto-launch unknown servers, and an untrusted project server never spawns.
- Streamable HTTP requires HTTPS plus an exact `allowedOrigins` entry. Every POST/GET/DELETE/reconnect resolves all DNS answers, rejects mixed/private results, pins one public address, rejects credentials/fragments/redirects, and bounds each response. Plaintext requires `allowLoopbackHttp: true` and loopback-only DNS.
- Header values are ref-only and never leave the transport; they do not appear in events, `inspect()`, status notes, command results, or errors.
- Discovery defaults to 20 pages/500 tools, finite metadata/schema budgets, and atomic refresh. Raw SDK list/call requests avoid compiling untrusted output schemas.
- Every result branch (`content`, `structuredContent`, legacy `toolResult`) shares `maxResultBytes`, JSON depth, and property bounds before `ToolResult` retention.
- Register returned tools only after reviewing server trust; core `PermissionPolicy` and `ToolValidator` still apply at dispatch.
- MCP Apps keeps nested metadata over deprecated flat metadata, permits only linked `ui://` `text/html;profile=mcp-app` HTML5 bodies, and leaves iframe sandbox/CSP, app-call approval, and mutation recovery to the host/AG-UI adapter.
- Server resources/prompts re-authorize every callback. Sampling/model choice, roots, credentials, and form/URL consent remain host-owned; Prism never opens elicitation URLs. Stateful sessions bind a non-secret principal ID and disclose mismatches only as 404.

See [MCP client/server exposure](README.md) and [Tool execution primitives](../../../docs/tools.md).

## Optional peer

Install the optional peers with `bun add @modelcontextprotocol/client zod` before loading configured MCP servers.
