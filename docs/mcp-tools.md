# MCP client bridge and server exposure

## What it does

`@arnilo/prism-mcp` has two explicit directions. Its client bridge connects hosts to remote [Model Context Protocol](https://modelcontextprotocol.io) servers and maps discovered tools to ordinary `ToolDefinition`s. Its server API registers selected Prism `ToolDefinition` and `CommandDefinition` values on the official SDK `McpServer`, with required authorization and a bounded optional Web-standard Streamable HTTP handler. The package pins the modular TypeScript SDK v2 packages `@modelcontextprotocol/client` and `@modelcontextprotocol/server` **2.0.0** (MCP protocol negotiation remains SDK-owned; the 2026-07-28 adoption is tracked in plan 063) and adds no MCP branch to core Prism.

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

Advanced hosts that manage their own `Client` + `Transport` can call `attachMcpToolBridge()` or `attachMcpCapabilities()` after connect. `connectMcpCapabilities()` keeps resources/prompts as host-facing facades rather than converting them into model tools, and declares roots/sampling/elicitation only when callbacks are supplied.

MCP Apps is an explicit opt-in on the normal bridge:

```ts
const bridge = await connectMcpTools({ serverId: "weather", transport, mcpApps: true });
// Fails unless the server acknowledges io.modelcontextprotocol/ui.
const app = await bridge.apps!.readResource("ui://weather/card");
// bridge.tools excludes _meta.ui.visibility: ["app"] tools.
```

`bridge.apps` exposes reviewed UI metadata, linked bounded `ui://` HTML, and same-server app tools for a host renderer/proxy; it never creates an iframe or executes HTML.

**Conformance and verification record (plan 063 task 7):** the official `@modelcontextprotocol/conformance` suite runs against the dual-era serving stack via `node scripts/mcp-conformance-2026.mjs` — the 20 expressible scenarios pass and the 14 scenarios requiring surface Prism does not expose (server-initiated sampling/elicitation/logging/progress from tool callbacks, `resources/subscribe`, completion capability, session-based SSE polling, non-text tool content blocks) are recorded as documented boundaries in `scripts/mcp-conformance-2026-baseline.yaml`. The CLI publishes scenarios only up to spec version 2025-11-25; the run is repeated when 2026-07-28 scenarios ship upstream. Measured on the loopback fixture (single process): legacy connect ~60ms, auto connect (with the one discovery probe) ~40ms, pinned modern connect ~20ms, steady-state bridge tool call ~4ms, uncached list walk ~5ms, cached list refresh ~2ms — the only added connect cost versus 1.x is the single negotiation probe plus SDK codec work. Security regression coverage lives in the package suites: malformed envelopes/headers, auth mix-up (`ERR_PRISM_MCP_OAUTH_ORIGIN`), SSRF/DNS-rebinding, oversized JSON/schema/results, MRTR round/replay, subscription exhaustion caps, cross-principal cache/session isolation, timeouts, cancellation, and redaction.

**Extension status (revalidated 2026-09-05 against the modular SDK v2, plan 063 task 6):** MCP Apps (`io.modelcontextprotocol/ui`) is the only extension Prism negotiates — on both the 2025 legacy handshake and 2026-07-28 (modern capabilities ride per request in `params._meta`); resource reads/pagination now go through SDK v2 `listResources`/`readResource` with the same per-descriptor byte bounds, item caps, cursor-loop detection, and linked-HTML validation as before. **Tasks (`io.modelcontextprotocol/tasks`) is intentionally not advertised and not supported in this release**: neither the bridge client nor `createPrismMcpServer` declares it, draft-era `task` members on tool results fail closed (`McpBridgeError` surfaced as a `ToolResult.error`, never read as tool output; modern `resultType: "task"` fails SDK decode), and task handles are not accepted without a supported extension codec plus a durable ownership model. Re-evaluate Tasks when the official TypeScript client/server extension codec supports task result dispatch, polling/update/cancel, and subscription notifications with green conformance.

```ts
const bridge = await connectMcpCapabilities({
  serverId: "research",
  transport: { type: "streamable-http", url, allowedOrigins: [origin] },
  roots: () => [{ uri: "file:///workspace", name: "workspace" }], // deprecated: kept for legacy callers only
  sampling: hostSampling,       // deprecated: kept for legacy callers only
  elicitation: hostElicitation, // active; URL mode returns approval; Prism never opens/fetches URL
});
await bridge.listResources();
await bridge.getPrompt("review", { topic: "security" });
```

Roots and sampling callbacks are **deprecated with MCP 2026-07-28 (SEP-2577)** and kept only for existing legacy callers; Synapta adds nothing on those surfaces and they may be removed when the protocol revision does (earliest per spec: a revision released on or after 2027-07-28). Elicitation is the active capability: on the modern era a server answering a tool call with `input_required` is fulfilled by the SDK's MRTR driver against the same `elicitation` callback, capped by `maxMrtrRounds` (default 10, the SDK's own bound — the option can only tighten it) with the call timeout as the outer ceiling; on the legacy era the same handler serves direct `elicitation/create` requests. `humanInteraction: true` remains mandatory for accepted elicitation, and no hand-written retry/state machinery exists on either path.

Server capability matrix for the modular TypeScript SDK v2 (`@modelcontextprotocol/client` + `@modelcontextprotocol/server` 2.0.0): tools/resources/prompts and their list-change notifications are supported through official registrations; roots/sampling/form+URL elicitation are supported as explicit client callbacks. Missing server resources/prompts throw `McpUnsupportedCapabilityError` with `ERR_PRISM_MCP_UNSUPPORTED_CAPABILITY`. Resource/prompt results and sampling/elicitation inputs/results are bounded JSON. Accepted form/URL elicitation requires host-only `humanInteraction: true`; bridge strips marker before protocol output and fails closed when absent. Automatic root discovery/consent, model selection, credential resolution, URL navigation, generic command proxying, and custom JSON-RPC are unsupported.

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
  // Omit these two for dual-era serving without legacy sessions.
  sessionIdGenerator: crypto.randomUUID,
  resolveIdentity: (_request, auth) => auth ? { id: validatedPrincipalId(auth) } : false,
});
```

`createPrismMcpWebHandler()` is dual-era on the modular SDK v2 serving entries. Default (factory, no `sessionIdGenerator`): modern 2026-07-28 serving through SDK `createMcpHandler` — one fresh `McpServer` per request, SDK-generated `server/discover`, result metadata, cancellation and modern headers — with the SDK stateless fallback answering 2025-era traffic; modern responses carry no `Mcp-Session-Id`. Supplying `sessionIdGenerator` keeps documented legacy `MCP-Session-Id` POST/GET/DELETE/SSE lifecycle on a sessionful `WebStandardStreamableHTTPServerTransport` beside a strict modern handler (classified legacy traffic routes separately), and still requires exact `allowedOrigins` plus host `resolveIdentity`; every request re-authenticates, and a different principal receives non-disclosing 404. `Last-Event-ID` replay remains explicitly unsupported.

Security gates run in front of the SDK entries because `createMcpHandler` intentionally provides none: exact Host/Origin allowlist checks execute before body parsing, auth, and dispatch; bounded body parsing feeds `parsedBody`; verified `AuthInfo` is passed explicitly; authorization and identity checks run on every request; modern serving state never trusts a transport session id. A bare `McpServer` instance with sessions keeps legacy-only behavior; stateless mode requires a factory (one fresh server per request). The returned value stays callable and carries SDK lifecycle properties: `fetch` (same function), `close()` (tears down both eras), `notify.toolsChanged()/promptsChanged()/resourcesChanged()/resourceUpdated(uri)`, and `bus` for `subscriptions/listen`. `maxSubscriptions` (SDK default 1024) and `keepAliveMs` (SDK default 15000, 0 disables) bound modern subscription streams.

`servePrismMcpStdio(factory, options)` serves dual-era stdio: the opening exchange pins the era (one factory instance per connection; `legacy: "serve"` default keeps 2025 openings working, `"reject"` answers them with the unsupported-protocol-version error), and stdout stays protocol-only. `McpServer.connect(transport)` remains available for in-memory transports; direct `server.connect()` over HTTP is legacy-only. `createPrismMcpServer({ cacheHints })` emits SEP-2549 cache hints on cacheable 2026-07-28 results (default `ttlMs: 0`, `private`). Neither HTTP nor stdio helper starts a listener or process lifecycle for you.

## When to use it

- **Integrate external MCP tool servers** (filesystem, databases, SaaS adapters) without reimplementing JSON-RPC transports in your app.
- **Bridge a specific upstream server through a reviewed adapter** — e.g. the optional [`@arnilo/prism-web-tools/obscura`](obscura.md) subpath wraps `connectMcpTools` with Obscura-specific command validation and conservative effect classification for the complete advertised tool surface.
- **Keep core dispatch gates** — register returned tools and let `dispatchToolCall` enforce permission, JSON Schema validation (`ToolValidator`), middleware, abort, and parallel execution (Plan 055 Tasks 1–2).
- **Explicit lifecycle** — connect, refresh on `notifications/tools/list_changed`, and `close()` when the session ends.
- **Expose selected capabilities** — register a reviewed tool/command allow-list for MCP clients without a custom JSON-RPC server.

Do **not** use this package as a sandbox, permission engine, or auto-discovery loader. Hosts must trust configured commands/URLs and gate registration.

## Inputs / request

`connectMcpTools()` requires a stable `serverId` plus an explicit stdio or Streamable HTTP transport. Optional bounds control list caching, call timeout, result bytes, name prefix, and abort behavior; defaults are listed below.

## Outputs / response / events

`McpToolBridge` exposes `tools`, optional `apps`, `refresh()`, and `close()`. Normal tools are Prism `ToolDefinition`s. Apps requires server acknowledgement; nested resource metadata wins over flat/deprecated and app-only tools stay outside `tools`. Resource reads require linked bounded `ui://` HTML5 with exact MIME; content metadata wins over list defaults.

`createPrismMcpServer()` returns the SDK `McpServer`. It lists only passed tools/commands and explicitly selected `agentRuns` lifecycle tools; JSON Schema parameters are converted through installed Zod v4 for SDK validation, then Prism tool calls still pass through `dispatchToolCall` permission/validator/redactor gates. Command definitions support explicitly selected direct/background/replay workflow operations and optional ownership-scoped schedule operations from `createWorkflowCommands()`; none are registered unless the host passes those command definitions. Calls return bounded MCP text content and `isError` on denial/failure. `createPrismMcpWebHandler()` remains callable for source compatibility and additionally carries `fetch`, `close`, `notify`, and `bus` from the SDK serving entry.

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
| `mcpApps` | `false` | Explicitly negotiate `io.modelcontextprotocol/ui`; exposes `bridge.apps` only after server acknowledgement |
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

MCP elicitation maps onto the shared decision model: `mcpElicitationDecision(approvalId, params)` converts an untrusted `ElicitRequest` (message ≤ 2 KiB, schema ≤ 16 KiB) into a kind-`elicitation` pending decision, and `mcpElicitationResultFromDecision(decision, { humanInteraction })` maps a decision back to a protocol result — `reject_*` declines, `allow_*` accepts with the payload and fails closed unless the host proved explicit human interaction. Wire behavior is unchanged; the marker never reaches protocol output.

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
| `resources` / `prompts` | empty | Static URI/name registrations with bounded host callbacks and per-read/get authorization |
| `agentRuns` | empty | Explicit `{ [agentId]: { lifecycle } }` map; registers `agent.<id>.status` and `agent.<id>.resume` only |
| `authorize` | required | Per-call host authz using SDK auth/session metadata |
| `permission` / `validate` / `redactor` | none | Core tool-dispatch gates and known-secret redaction |
| `maxResultBytes` | 1 MiB (8 MiB hard) | Bound mapped MCP call output |
| `maxConcurrentCalls` | 16 (256 hard) | Bound active tool/command execution |
| `callTimeoutMs` | 60 s (30 min hard) | Abort and return timed-out calls |

Web handler defaults: 1 MiB request (8 MiB hard), 2 MiB response (16 MiB hard), 32 concurrent requests (512 hard), 60 s timeout (30 min hard), and 32 sessions (512 hard). Stateful mode is intentionally one official SDK transport/session lineage per handler; use one handler/server instance per independently hosted endpoint when multi-tenant transport isolation is required. It parses bounded JSON before passing `parsedBody` to the SDK transport. `allowedHosts`/`allowedOrigins` activate SDK DNS-rebinding checks only when explicitly configured. Authentication data comes only from host `resolveAuthInfo()`.

Remote MCP tools default to `external_mutation`/`unsupported` unless the host `effect` policy classifies them. MCP Apps (`io.modelcontextprotocol/ui`) stay behind host CSP/origin/visibility gates. See [tool effects](tool-effects.md) and [AG-UI adoption](ag-ui-adoption.md).

## Security and performance notes

| Risk | Mitigation |
| --- | --- |
| Untrusted subprocess (stdio) | Explicit `command` / `args` / `env` / `cwd`; review before deploy |
| SSRF / DNS rebinding / redirects (HTTP) | Exact HTTPS origins; credentials/fragments/redirects denied; every DNS answer public; one address pinned per request; explicit loopback-only HTTP escape hatch. Since 0.2.1 the client transport re-routes through the shared core `pinnedFetch` primitive (DNS-pinned fetch) with byte-identical `McpBridgeError`/`McpOAuthError` wrapping |
| Hostile discovery / schema compilation | Raw SDK `tools/list` requests avoid SDK Ajv output-schema compilation; finite pages/tools/cursors/metadata/schema totals; failed refresh leaves previous tools unchanged |
| Tool-name shadowing | Prefixed names + `createToolRegistry({ duplicate: "error" })` |
| MCP Apps metadata/HTML | Explicit extension acknowledgement; bounded nested metadata; app-only tools absent from model list; only linked `ui://` HTML/MIME resource body reaches the host renderer |
| Oversized/deep/wide server output | One aggregate byte/depth/property walk covers content, structured content, compatibility `toolResult`, and bounded remote errors before `ToolResult` |
| Unvalidated arguments | Register tools with `createJsonSchemaToolArgumentValidator()` at dispatch |
| Missing permission gate | Client direction: `PermissionPolicy` on `tool:mcp:<serverId>:<name>:execute`; server direction: required MCP `authorize` plus optional core `PermissionPolicy` |
| Unverified / widened identity | Optional `PrismMcpAuthorization.identity` must be host-verified and match ownership; invalid identity is forbidden before tool dispatch |
| Accidental server exposure | Empty default arrays/maps, duplicate-name rejection, explicit tools/commands/lifecycle only |
| Agent lifecycle data leak or cross-tenant resume | `agentRuns` requires exact tenant plus account/user ownership; core lifecycle returns public redacted state only and CAS-resumes with current agent/revision |
| Unbounded MCP HTTP | Bounded pre-parsed JSON, response bytes, concurrent requests, call timeout, SDK web-standard transport |
| Cross-tenant operation | Authorizer derives ownership from validated auth and passes it to tool/resource/prompt dispatch; stateful handler binds session to stable validated principal on every request; never trust arguments as identity |
| Sampling / elicitation authority | Host callbacks alone choose model/provider/credentials or obtain consent; bounded URL elicitation is returned to host UI and never fetched/opened automatically; auth tokens never enter callback params/results |

For durable lifecycle exposure, construct `createAgentRunLifecycle({ checkpoints, resolveAgent })` in core, then pass selected entries as `agentRuns: { support: { lifecycle } }`. MCP registers two tools: `agent.support.status` accepts `{ runId, sessionId? }`; `agent.support.resume` accepts `{ runId, sessionId?, decision, expectedVersion }`. Do not expose an agent without durable checkpoints and a restart-safe `SessionStore`; no lifecycle tool appears by default.

MCP output is untrusted. Register bridge tools through core dispatch with a `SecretRedactor`. Apps renderer needs separate origin, `allow-scripts allow-same-origin`, no-wider CSP, and authenticated proxy approval; no app mutation retry before Task 4 recovery. `CreatePrismMcpServerOptions.guardrails` applies shared tool-input/output stages to registered Prism tools; commands remain host callbacks. See [Guardrails](guardrails.md). Prism does not infer unknown secrets. MCP server authorization does not replace tool `PermissionPolicy`, argument validation, coding `ExecutionPolicy`, workflow ownership checks, TLS, rate limiting, or sandboxing. A timed-out tool must cooperate with `AbortSignal` to stop side effects; protocol retention and HTTP responses remain bounded when remote work ignores abort.

Discovery validation is atomic: cursor/page/tool/name/description/schema failures reject `refresh()` and preserve the previous immutable tool-array reference. The bridge intentionally uses raw SDK `request()` for `tools/list` and `tools/call`; this avoids eager Ajv compilation/validation of untrusted remote output schemas. Host `ToolValidator` remains the argument-validation owner.

## MCP OAuth (0.0.28)

Optional RFC 9728/8414 OAuth client and server wiring for Streamable HTTP transports.

**Client** — pass `auth` to the transport/bridge options:

```ts
import { createMcpClientAuth } from "@arnilo/prism-mcp";

const auth = createMcpClientAuth(
  {
    state, // required persistence seam: load/save tokens, discovery, client info, code verifier
    strategy: { kind: "cimd", clientMetadataUrl: "https://client.example/oauth/metadata.json" }, // preferred
    // or { kind: "static", clientId: "prism", clientSecret: "..." }
    // or { kind: "dcr", clientMetadata } — deprecated (RFC 7591), application_type defaults to "native"
    redirectUri: "http://localhost:33418/callback",
    onRedirectRequired: (url) => openBrowser(url), // interactive flows
    onInsufficientScope: "reauthorize", // or "throw" to surface SDK InsufficientScopeError instead
  },
  { serverUrl: "https://mcp.example.com/api", fetch },
);
```

The flow reuses the MCP SDK's `auth()` helper (401 → protected-resource metadata → RFC 8414 discovery → PKCE S256 → token exchange/refresh) wrapped in Prism policy: discovery URLs are SSRF-checked, https-only (loopback http opt-in), DNS-pinned, zero-redirect, and byte-bounded; RFC 8707 resource binding is enforced on every token request (`ERR_PRISM_MCP_OAUTH_AUDIENCE` on origin drift); issuer origin must match the discovered authorization server (`ERR_PRISM_MCP_OAUTH_ORIGIN`); bearer tokens are only ever attached to the allow-listed server origin.

2026-07-28 authorization conformance (plan 063 task 5):

- **Callback completion takes the full query**: `await auth.finishAuth(new URL(callbackUrl).searchParams)`. The persisted OAuth `state` is validated first (fail-closed `ERR_PRISM_MCP_OAUTH_STATE` when absent or mismatched), then the RFC 9207 `iss` parameter is checked against the persisted authorization server; the SDK independently validates `iss` against the recorded issuer (RFC 9207 §2.4) and the callback-leg AS binding (SEP-2352) before redeeming the code. Callback `error`/`error_description` fields are never surfaced after an issuer mismatch. A bare code string is accepted as the legacy form (no state/iss validation).
- **Issuer-keyed credential storage**: persisted token/client records are SDK issuer-stamped (`StoredOAuthTokens`/`StoredOAuthClientInformation`); `McpClientAuthState` credential methods take the validated `issuer` so partitioned stores can key on it. Records stamped for a different issuer are never served, and ambiguous un-stamped pre-upgrade records are refused on issuer-keyed reads rather than guessed — re-authorization runs once and every persisted record is stamped thereafter.
- **Registration strategy**: CIMD (SEP-991 URL-based client ids) is preferred, `static` remains supported, and `dcr` is deprecated; the DCR metadata defaults `application_type` to `"native"` when the host omits it.
- **Insufficient-scope policy**: `onInsufficientScope: "reauthorize"` (default) runs the SDK's bounded step-up flow; `"throw"` surfaces the typed SDK `InsufficientScopeError` (with the challenge scope) instead of redirecting. Hosts gate interactive consent either way.

`McpClientAuthState` has no default implementation — production hosts back it with an encrypted/keychain store (refresh tokens must not live in plaintext persistence).

**Server** — advertise protected-resource metadata and challenge unauthenticated requests:

```ts
const handler = await createPrismMcpWebHandler(factory, {
  protectedResource: {
    authorizationServers: ["https://as.example.com/"],
    resource: "https://mcp.example.com/mcp", // required (RFC 9728)
    scopesSupported: ["mcp"],
  },
  resolveIdentity, // host-owned token verification stays here
});
```

The handler serves `GET /.well-known/oauth-protected-resource` and returns `401 WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource", scope="<configured scopes>"` on rejected requests. Token verification remains entirely host-owned via `resolveIdentity` — the host token verifier must validate the token audience (`aud`) against the protected resource and enforce the challenged scopes; Prism only advertises and challenges.

## Vendor web MCP prototype boundary

Official Exa/Firecrawl MCP servers may be tested only as explicit hardened prototypes: pin endpoint/origin/auth, inspect declared capabilities, allow-list individual tools/resources, retain all MCP bounds, and never expose generic remote passthrough. Production web research uses direct host-selected `@arnilo/prism-web-tools` adapters so provider choice, credentials, schema, and costs remain outside model control.

## Related APIs

- [Agent identity](agent-identity.md): optional verified identity on MCP authorize results
- [Tools](tools.md): registry, dispatch, validation
- [Web search, fetch, and extraction](web-tools.md): preferred direct bounded Brave/Exa/Firecrawl production path
- [Tool execution primitives](tool-execution-primitives.md): Plan 055 design and conformance matrix
- [Host security guide](host-security.md): permission, trust, validation checklist
- [Web-standard server handler](server.md): agent/workflow HTTP routes and shared remote-boundary rules
- [ACP coding-host interop](acp.md): ACP clients may attach MCP servers to sessions — bounded configs (8/32 servers, 16 KiB/256 KiB config, 4 KiB/64 KiB header values), http/sse only when advertised, stdio accepted behind the gate, UNSTABLE `acp` always rejected, and every server approved by host `mcp.select` before the bridge connects.

## Testing

Package tests use in-memory MCP transports plus loopback-only HTTP fixtures for redirect, rebinding, response-cap, abort, and POST/GET/DELETE policy coverage. No public network is required. Hosts should integration-test configured stdio commands and HTTPS endpoints in staging before production registration.
