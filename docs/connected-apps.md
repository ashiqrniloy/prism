# Connected apps

## What it does

`createConnectedAppSession()` groups host-selected MCP bridges under one verified identity. It exposes only prefixed `ToolDefinition`s selected by the host and leaves transport construction, OAuth, credentials, and remote effect classification with that host.

## When to use it

Use connected apps when one agent needs a small, identity-scoped set of SaaS or internal MCP servers. Use typed [work tools](work-tools.md) instead for high-trust Google Workspace or Microsoft 365 actions that require Prism's draft/approve lifecycle.

## Inputs / request

| Input | Required | Contract |
| --- | --- | --- |
| `identity` | yes | Active, verified `AgentIdentity` bound to every connection. A `bind()` identity, if supplied, must match tenant, account, user, and principal. |
| `select` | yes | Host admission callback. `false` denies before any MCP connection. |
| `effect` | no | Shared `McpToolEffectPolicy`. Omit it to retain MCP's `external_mutation` / `unsupported` default. |
| `connect` | no | Test seam. Production uses `connectMcpTools`. |
| `maxApps` | no | Maximum bindings; defaults to 8 and has a hard cap of 32. |
| `bind({ appId, serverId, transport, allowTools, effect })` | yes | `appId` and `serverId` are unique session identifiers. `transport` is already host-built. `allowTools` is an exact remote-name allowlist; per-binding `effect` overrides the shared policy. |

## Outputs / response / events

`bind()` connects one admitted bridge. `tools()` returns its prefixed tools without re-listing. `refresh()` re-lists every bound bridge. `list()` returns only `appId`, `serverId`, and visible prefixed tool names. `unbind()` and `close()` close their bridges.

## Host composition inspection

Pass only `apps.list()` identifiers into `inspectHostComposition()`; inspection never connects, refreshes, or receives a transport. A business host with connected apps must provide a verified identity.

```ts
const bindings = apps.list();
const report = inspectHostComposition({
  profile: "business",
  agent,
  connectedApps: {
    appIds: bindings.map(({ appId }) => appId),
    serverIds: bindings.map(({ serverId }) => serverId),
  },
});
```

## Request/response example

```json
{
  "binding": {
    "appId": "slack",
    "serverId": "slack",
    "transport": { "type": "stdio", "command": "/usr/bin/slack-mcp", "args": ["mcp"] },
    "allowTools": ["list_channels", "post_message"]
  },
  "list": [{ "appId": "slack", "serverId": "slack", "tools": ["mcp:slack:list_channels", "mcp:slack:post_message"] }]
}
```

## Implementation example

```ts
import { createToolRegistry, type AgentIdentity } from "@arnilo/prism";
import { createConnectedAppSession } from "@arnilo/prism-mcp";

const identity: AgentIdentity = {
  tenantId: "tenant-a",
  userId: "user-a",
  principal: { kind: "user", id: "user-a" },
  scopes: ["tools:execute"],
  issuedAt: new Date().toISOString(),
  verified: true,
};
const apps = createConnectedAppSession({
  identity,
  select: ({ transport }) => transport.type === "stdio" && transport.command === "/usr/bin/slack-mcp",
  effect: ({ remoteName }) =>
    remoteName.startsWith("list_") ? { kind: "none", idempotency: "none" } : undefined,
});
await apps.bind({
  appId: "slack",
  serverId: "slack",
  transport: { type: "stdio", command: "/usr/bin/slack-mcp", args: ["mcp"] },
  allowTools: ["list_channels", "post_message"],
});

const registry = createToolRegistry({ duplicate: "error" });
for (const tool of apps.tools()) registry.register(tool);
```

## Slack MCP wrap example

[`examples/connected-slack-mcp.ts`](../examples/connected-slack-mcp.ts) is a network-free template: a mock bridge exposes read and write Slack names, an exact `allowTools` list exposes only the intended tools, and the host policy marks `list_*`, `get_*`, and `search_*` as observations. `post_*`, `update_*`, and `delete_*` remain the MCP external-mutation default.

For a real Slack server, the host `select` callback must admit its exact stdio command or HTTP origin. Build credentials into stdio `env` or MCP OAuth before `bind()`; never place tokens in model context.

## Open Connector sidecar (example only)

[`examples/open-connector-sidecar/`](../examples/open-connector-sidecar/README.md) shows the opposite shape: Prism as the host for a sibling connector gateway over loopback MCP. The recipe pins an immutable `ghcr.io/oomol-lab/open-connector` release tag (never `main`/`tip`/`latest`), binds port `3000` on `127.0.0.1`, and keeps runtime tokens host-supplied.

Admission stays with the host: `select` must admit the exact loopback origin with `allowLoopbackHttp: true`, and an exact `allowTools` list (`search_actions`, `get_action_guide`, `execute_action`) keeps the provider catalog and connection listings off the model. Reads stay observations; `execute_action` is intentionally left unclassified and therefore remains `external_mutation` / `unsupported`. MCP `execute_action` accepts no `Idempotency-Key` — use HTTP `POST /v1/actions/:actionId` for retry-safe writes, or keep writes in [work tools](work-tools.md).

Identity mapping is host glue: Open Connector has no Prism identity, so the host resolves `connectionName`/`x-oo-connector-alias` from the verified `AgentIdentity` and issues one runtime token per identity. OC provider egress (including `skipDnsValidation` executors and `OOMOL_CONNECT_ALLOWED_PROXIES`) stays inside Open Connector; Prism's `pinnedFetch` policy cannot be layered over it.

No workspace package depends on Open Connector, no OC source is vendored, and `examples/open-connector-sidecar.ts` proves the admission and effect behavior network-free.

## Extension and configuration notes

Build stdio `env` and Streamable HTTP `requestInit.headers` in host code before `bind()`. Use `createMcpOAuthTransport()` when the host chooses MCP OAuth. The session does not discover catalogs, construct commands, resolve credentials, or add a second OAuth implementation.

## Security and performance notes

`select` is mandatory and deny-by-default. The session never infers an effect from remote descriptions or annotations; unclassified tools stay external mutations with unsupported idempotency. `allowTools` is an allowlist. `list()` excludes transports, headers, environment, and tokens. Binding performs one MCP connect; `tools()` uses cached bridge definitions until explicit `refresh()`.

## Related APIs

- [MCP client bridge and server exposure](mcp-tools.md): underlying MCP transports, bridge limits, OAuth, and tool mapping.
- [Agent identity](agent-identity.md): verified identity lifecycle and delegation boundaries.
- [Recoverable tool effects](tool-effects.md): effect declarations and mutation recovery semantics.
- [Work tools](work-tools.md): typed high-trust M365 and Google Workspace actions.
