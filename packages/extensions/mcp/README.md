# `@arnilo/prism-extensions/mcp`

Connect Model Context Protocol servers to a Prism agent, and bridge their tools.

## What it does

`@arnilo/prism-extensions/mcp` is a native Prism package. List it and it connects each allowed server during `setup`, supplies each server's current tools with `effects` through a tool source, and exposes status, reconnect, and close as package commands. The MCP client library (`connectMcpTools`, `McpToolBridge`, `createMcpClientAuth`, the transports, and the bounds) stays exported for hosts that build their own bridge.

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
| `servers[].auth` | `{ kind: "oauth", tokens, scopes?, clientId?, callback? }` | — | HTTP only. Signs in with OAuth; see [OAuth](#oauth). |
| `servers[].allowedOrigins` | `string[]` | the URL origin | Exact origins for the HTTP transport. |
| `servers[].allow` | `string \| string[]` | — | Required per server unless the plane `allow` is set. |
| `servers[].namePrefix` | `string` | `mcp:<id>` | Remote tools are `mcp:<id>:<toolName>`. |
| `servers[].connectTimeoutMs` | `integer` | `15000` | Bounds connect and the first `tools/list` only. |
| `servers[].callTimeoutMs` | `integer` | `60000` | Bounds one tool call without progress; each server progress notification resets it. Later `tools/list` refreshes use it too. |
| `servers[].maxCallTimeMs` | `integer` | `300000` | Ends a tool call however much progress arrives. Must be at least `callTimeoutMs`. |
| `servers[].readOnly` | `boolean` | `false` | `true` registers tools with `effects: ["read"]`; `false` gives `["external"]`. |
| `servers[].enabled` | `boolean` | `true` | `false` reports `disabled`. |
| `allow` | `string \| string[]` | — | Plane-level allow list; a server must match its own `allow` and this one. |
| `trusted` | `string[]` | `[]` | Fingerprints (`mcpServerFingerprint`) trusted without a prompt. Ignored from the project scope. |
| `connectTimeoutMs` / `callTimeoutMs` / `maxCallTimeMs` | `integer` | `15000` / `60000` / `300000` | Plane-level defaults; a server's own value wins. |
| `reconnect.attempts` | `integer` ≥ 0 | `5` | Automatic reconnect attempts after a drop. `0` disables: a dropped server is `failed` with `reason: "connection_lost"`. |
| `reconnect.baseDelayMs` / `reconnect.maxDelayMs` | `integer` | `1000` / `30000` | Attempt *n* waits `min(maxDelayMs, baseDelayMs × 2^(n-1))`. |
| `limits` | `object` | client defaults | Bounds on what every server sends: `maxListPages` (20), `maxTools` (500), `maxCursorBytes`, `maxToolNameBytes`, `maxToolDescriptionBytes`, `maxToolSchemaBytes`, `maxTotalToolSchemaBytes`, `maxJsonDepth`, `maxJsonProperties`, `maxResultBytes` (10,000,000), `listCacheTtlMs` (30,000). The host's values are the caps. |
| `signInTimeoutMs` | `integer` | `300000` | How long a person has to finish an OAuth sign-in. |

The host's values are the caps: hours are allowed. A non-positive value, or a `maxCallTimeMs` below `callTimeoutMs`, fails the load. A call that runs out of time returns a tool error naming the server and the limit, and the request is cancelled on the server: `notifications/cancelled` on the 2025 protocol, or an aborted HTTP request on a 2026-07-28 Streamable HTTP connection. Aborting the run cancels a call at once.

A `raw` server takes its transport from the `mcp.transport` service, keyed by server id. A missing service or entry makes that server `failed`.

### Capabilities

`host-ui`, `credentials`, and `credentials:write` when any server has `auth`. `host-ui` is used for the project-trust prompt and OAuth sign-in; `credentials` resolves every header and secret env ref; `credentials:write` stores and deletes the OAuth sign-in record. Without `credentials:write`, an `auth` entry fails the load with `capability_missing`.

### OAuth

```ts
{
  id: "tracker",
  transport: "http",
  url: "https://mcp.example.com/mcp",
  allow: "https://mcp.example.com",
  auth: { kind: "oauth", tokens: "keyring:mcp-tracker" },
}
```

| Field | Default | Notes |
| --- | --- | --- |
| `tokens` | required | A writable `keyring:` ref. An `env:` ref or a literal fails the load. |
| `scopes` | — | Requested during authorization. |
| `clientId` | — | A static client id, or an `https://` client metadata URL (CIMD). Omitted: dynamic client registration. |
| `callback` | `"listen"` | `listen` binds a loopback listener on `127.0.0.1`; `paste` asks `host.ui` (`input`) for the full callback URL. |

When the server answers 401 at connect, or on `mcp:login`, the package runs the library flow: discovery, registration or the configured client, and PKCE. It sends the authorization URL through `host.ui` `open-url`, then waits up to 5 minutes for the callback, outside the connect timer, and connects again on a fresh transport. During `setup` the wait does not hold `createAgent`: the server reports `failed` with `reason: "auth_required"` and `signingIn: true` at once, the sign-in continues in the background, and its tools reach the next run once it connects. Disposing the agent or running `mcp:login` cancels that wait.

- The loopback listener accepts one callback, checks `state`, and closes. The `paste` path takes the full callback URL so `state` and `iss` are checked; a bare code is refused.
- The redirect URI's port is saved with the record and tried first. If it is busy, a random port is used and a dynamically registered client registers again.
- The whole sign-in record (tokens, client registration, discovery, PKCE verifier, authorization state) is one JSON record in the ref's `Secret.metadata`, bounded at 64 KiB. The access token is the secret value, so the kernel redacts it. Tokens never appear in events, status notes, `inspect()`, or errors.
- Refresh happens inside the flow on expiry, with no prompt, and the new tokens are written back.
- With no `host.ui`, or an `unavailable` or dismissed answer, the server is `failed` with `reason: "auth_required"` and no URL is opened.
- Plaintext and loopback discovery and token endpoints are allowed only when the server URL is itself loopback.
- An `auth` entry is part of the server fingerprint, so a project manifest that adds one asks for trust again.

A server without `auth` that answers 401 is `failed`, with a status note naming the `auth` field.

### Project trust

A server whose `servers` config came from the **project** manifest connects only after `host.ui` `confirm` answers yes. `answered: false`, `dismissed`, and `unavailable` all mean it never spawns. A fingerprint listed in `trusted` from a `code` or `host` source skips the prompt. A `trusted` list from a project source is ignored, with a status note.

### Commands

| Command | Args | Result |
| --- | --- | --- |
| `mcp:status` | — | `{ servers: [{ id, state, toolCount, added?, error?, reason?, signingIn?, attempt?, attempts? }] }` |
| `mcp:reconnect` | `{ id }` | Reconnects one server now, interactively, and stops a pending automatic reconnect; trust is not re-asked for an already-trusted server. |
| `mcp:close` | `{ id? }` | Closes one server, or all of them, and stops a pending reconnect or sign-in. |
| `mcp:login` | `{ id }` | OAuth servers only. Drops the stored tokens, signs in through `host.ui`, and reconnects. |
| `mcp:logout` | `{ id }` | OAuth servers only. Deletes the stored sign-in record and closes the server (`reason: "signed_out"`). |

Each transition emits an `mcp.status` package event with the server status. A tool that first appears after a reconnect is counted in `added`.

| State | Meaning |
| --- | --- |
| `connected` | The server's tools reach new runs. |
| `reconnecting` | The connection dropped; `attempt` of `attempts` is waiting or connecting. |
| `failed` | Connect failed, reconnect gave up, or sign-in is needed (`reason: "auth_required"`, `"connection_lost"`, `"credential_unavailable"`, …). |
| `disabled` | `enabled: false`, outside `allow`, or not trusted (`reason`). |
| `closed` | `mcp:close`, `mcp:logout`, or dispose. |

### Reconnect

The bridge reports a drop when a stdio child exits, or when an HTTP request fails with a closed connection, a network error, or a 404 (the server dropped the session). A request timeout or a server error is not a drop. The package then reconnects with the `reconnect` backoff, emitting `reconnecting` before each attempt and `connected` or `failed` at the end; failed attempts in between are not reported one by one.

- While a server is not `connected`, its tools leave new runs. A call from a run already going returns a tool error naming the server's state.
- Each attempt resolves credentials again, so a rotated secret is picked up and a removed one fails closed (`credential_unavailable`, no further attempts).
- Trust is not asked again: the trust cache is keyed by `mcpServerFingerprint`, so only a server whose fingerprint changed asks.
- An automatic reconnect never opens a sign-in. A 401 that a token refresh cannot fix ends the attempts with `reason: "auth_required"`; run `mcp:login`.
- `mcp:reconnect`, `mcp:login`, `mcp:logout`, `mcp:close`, and dispose cancel a pending reconnect.

### Live tool lists

The package registers one tool source per server (`PackageAPI.tools.source`) instead of registering tools in `setup`. At the start of each run the kernel reads the server's current list: tools a `tools/list_changed` notification, a reconnect, or a late sign-in added appear, tools the server removed disappear, and a run already going keeps the set it started with. A server that is not `connected` supplies no tools. A tool whose name another package or the host already holds is dropped with a status note. No agent needs recreating.

### Effects

Bridged tools declare `effects: ["external"]`, or `["read"]` with `readOnly: true`, so approval and governance decide generically.

## Cost

Servers connect concurrently in `setup`, so setup latency is the slowest server's `connectTimeoutMs`, not the sum; an OAuth sign-in does not add to it. With no servers configured, `setup` registers nothing. A live tool list costs one in-memory read per server per run start; the server is asked again only after a `list_changed` notification. Reconnect makes requests only after a drop, at most `reconnect.attempts` connects per drop, and nothing polls a connected server.

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
