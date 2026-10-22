# @arnilo/prism-mcp-server

Host library serving a Prism **agent** over the Model Context Protocol (MCP).

`serveMcp(agent, options)` exposes the agent as one tool (`prompt`, rename with `toolName`) and lists
`agent.commands` as MCP prompts. It never dispatches a bare tool: every call runs
`session.run(prompt)` on the session bound to the MCP session, so approvals, governance hooks, and
limits all fire. Serving a generic `ToolDefinition[]` to a vendor's own agent is
[`serveTools`](#serving-tools-and-permissions-to-an-external-agent), built beside `serveMcp` on the
same transport helpers.

```ts
import { createAgent } from "@arnilo/prism";
import { mcpHost, serveMcp } from "@arnilo/prism-mcp-server";

const agent = await createAgent({ model, packages, host: mcpHost() });
await serveMcp(agent, { stdio: true }).closed;
```

## Transports

`serveMcp` takes exactly one of:

| Option | Transport | Handler |
| --- | --- | --- |
| `{ stdio: true }` | dual-era stdio subprocess | `servePrismMcpStdio` |
| `{ transport }` | caller-owned `Transport` (in-process tests, embedded hosts) | `servePrismMcpStdio` |
| `{ http: { … } }` | MCP 2026-07-28 Streamable HTTP + 2025 legacy fallback | `createPrismMcpWebHandler` |

The returned handle carries `closed`, `close()`, and — for `{ http }` — a web-standard
`handler(request) => Promise<Response>`. Both transport helpers stay public and can be used
directly with any `McpServer` factory.

## Serving tools and permissions to an external agent

`serveTools(run, options)` bridges a subset of a run's tools to an external agent over the run's
callback broker, so the vendor's own agent loop calls Prism tools through the same `tool.call` gate
the internal loop uses. It is what a Prism *driver* hands its vendor binary; the vendor maps the
neutral `endpoint` into its own MCP configuration.

```ts
import { serveTools } from "@arnilo/prism-mcp-server";

const served = await serveTools(run, {
  broker,
  tools: definitions,
  allow: ["read", "edit"],
  transport: "loopback-http",
  origin: { kind: "external", agent: "claude", agentId: "claude", vendor: "anthropic", depth: 0 },
});
try {
  // spawn the binary with served.endpoint in its MCP config and served.env in its environment
} finally {
  await served.close();
}
```

| Option | Meaning |
| --- | --- |
| `broker` | The run's callback broker. `serveTools` mounts its handler on `broker.route("mcp")`. |
| `tools` | The `ToolDefinition[]` the allow list resolves against (there is no run-time registry read). |
| `allow` | Tool names to serve. Empty fails with `serve_tools_empty`; an unknown name fails with `unknown_tool` before anything is served. |
| `transport` | `"loopback-http"` or `"stdio-relay"`. |
| `origin` | The bridge origin every served call is attributed to. |
| `prefix` | Prepended to each served tool name in `tools/list` and `tools/call`. |
| `resources` | Static `{ uri, name, mimeType?, text }` resources, each bounded to 256 KiB. |
| `limits` | `{ maxConcurrentCalls?, resultBytes? }`. Defaults 8 / 1 MiB; hard caps 64 / 8 MiB. |
| `permissionTool` | `{ name, effects?, rewrite?, codec? }`: also serve a permission-prompt tool backed by `run.ask`. |
| `relay` | `{ command }`, required for `stdio-relay`. |
| `headerEnv` | The bearer-token variable name. Default `PRISM_MCP_TOKEN`. |

The handle returns `endpoint`, `env`, `tools`, and `close()`:

| Transport | `endpoint` | `env` |
| --- | --- | --- |
| `loopback-http` | `{ transport: "http", url: <broker>/mcp, headerEnv }` | `{ [headerEnv]: <broker token> }` |
| `stdio-relay` | `{ transport: "stdio", command, args: […, "relay", "mcp", "--run", <run dir>] }` | `{}` |

The token is never part of `endpoint`. Only the allow-listed tools are registered, so every other
tool is absent from `tools/list` and a `tools/call` naming one is a JSON-RPC error that never reaches
`executeTools`. A call over `maxConcurrentCalls` is a JSON-RPC error, never queued. `close()` is
idempotent, unregisters the route (later relay frames get the broker's `no MCP route is registered`),
and closes the handler; it runs on `run.signal` abort and after an `approval_pending` result. A call
after close is refused with JSON-RPC `-32000` and `served tools are closed`.

### Permission tool

`permissionTool` serves one more tool, `prefix + name`, for a vendor whose binary has a
permission-prompt hook (`claude --permission-prompt-tool`). It only **asks**; it never executes. Each
call is one `run.ask`, and one bounded `prism.permissions` `external_state` entry holding
`{ toolName, toolCallId, behavior, reason }` — never the input.

Neutral input: `{ toolName: string, input: object, toolCallId?: string }`. Neutral output text:
JSON `{ behavior: "allow" | "deny", updatedInput?, message? }`.

| `run.ask` answer | Output |
| --- | --- |
| `{ allow: true }` | `{ behavior: "allow" }` |
| `{ allow: true, args }` | `{ behavior: "allow", updatedInput: args }`, only with `rewrite: true` |
| `{ allow: false, reason: "approval_pending" }` | `{ behavior: "deny", message }` — the run is suspended; the server then closes |
| `{ allow: false, reason: "non_interactive" }` | `{ behavior: "deny", message }` — no one can approve |
| any other reason | `{ behavior: "deny", message: "denied: <reason>" }` |

| Option | Meaning |
| --- | --- |
| `name` | The served tool name, `prefix + name`. Must not collide with an allow-listed tool. |
| `effects` | `(toolName) => effects` for `run.ask`. Default every effect, as `effectsTable` treats an unknown name. |
| `rewrite` | Pass `rewrite: true` to `run.ask` so a gate rewrite becomes `updatedInput`. Default `false`. |
| `codec` | `{ decode(args): PermissionRequest; encode(decision): CallToolResult }`, the only vendor-shape hook. |

```ts
import { effectsTable } from "@arnilo/prism/driver-kit";

permissionTool: {
  name: "permission",
  effects: effectsTable({ Bash: ["execute"], Write: ["write"] }),
  rewrite: true,
};
```

A `codec` replaces the neutral input and output — its `decode` receives the raw `tools/call`
arguments and its `encode` returns the whole MCP result. When a codec is set, the tool registers an
open object input schema, so any vendor shape reaches `decode`.

**It fails closed.** A throwing `decode` or gate, an `encode` that throws, and a decision that cannot
be recorded each answer `deny` in the neutral shape (`isError` only when even that cannot be built).
A `deny` is a normal result, not `isError`: the vendor reads the JSON as a decision. The tool cannot
bypass `tool.call` — it only asks, so nothing runs without the gate's own answer.

## Sessions and approvals

One Prism session per MCP session: `ctx.sessionId` selects `agent.session({ id, create: true })`,
and a transport without session ids (stdio, in-process) gets one anonymous session per connection.
`session.run` always runs with `interactive: false`, so a kernel ask suspends instead of prompting.

A suspended run answers the tool call with the SDK's multi-round-trip `input_required` result when
the client advertised `elicitation.form`; the client's retry arrives as `inputResponses`, which map
to `session.resume(decisions)`. The `requestedSchema` is `{ outcome: "allow_once" | "allow_for_run" |
"reject_once" | "reject_for_run" }`; anything missing or unrecognized resumes as `reject_once`.
Without elicitation the tool result is `isError: true` naming the pending approval and **no gated
tool runs**.

`mcpHost()` is the `HostPort` passed to `createAgent`. It answers `unavailable` for `terminal` requests and for kernel asks
(`package` absent), `secret` requests, unbound sessions, and every notification; package
`confirm`/`select`/`input` reach the client only through the 2025-era `elicitInput` channel bound
while a run is in flight. On the 2026 era `elicitInput` throws, so mid-run package elicitation
answers `unavailable` (a Phase 14+ gap).

## Security

- `authorize` runs before any session is opened and before any run; absent allows a local peer, a
  throwing callback denies. `PrismMcpAuthorization.ownership` is passed through unchanged — identity
  enforcement belongs to the agent's own governance hooks.
- Results and errors are redacted with `options.redactor` (default `agent.config.redactor`) and
  truncated to `maxResultBytes` (default 1 MiB, hard cap 8 MiB). `maxPromptBytes` bounds one prompt
  (default 64 KiB, hard cap 1 MiB).
- `serveTools` results are already redacted by the kernel (`dispatchToolCall` applies the agent's
  redactor) and truncated to `limits.resultBytes` here. Its resource `text` is host-supplied and
  served verbatim, so **never put a secret in a `resources` entry**.
- The HTTP helper keeps exact `allowedHosts`/`allowedOrigins` checks ahead of body parsing, bounded
  request/response bytes, per-principal session binding, and RFC 9728 protected-resource challenges.
  `serveTools` sets no Host/Origin allowlist: the broker's no-`Origin` 403 and bearer 401 already
  gate every relayed frame.

## Example

`examples/serve-tools.ts` serves a run's tools to an external agent's own loop, offline. Inside one
`session.run` an inline `defineDriver` driver binds a `workspace` worktree for the run's session,
materializes the vendor's MCP configuration into it with `excludeOverlay` (so the file never reaches
a diff), and serves `read`, `edit`, and the permission tool with `serveTools` — first over
`loopback-http`, then over `stdio-relay` — driving the scripted `jsonl-stream` CLI as the vendor
binary through `--mcp-endpoint`. It prints, per transport: the served names, an allowed `edit` that
changes the file in the worktree, a declined `edit` under `@arnilo/prism-approval` in `ask` mode, the
permission tool's `deny` and `allow`, an unserved name as a JSON-RPC error, a call after `close()`
refused, and the served calls' `origin` on the run's events. Then the worktree diff (the edit, not
the overlay) and a conflicting `merge` reported unresolved. `bun examples/serve-tools.ts` prints the
result as JSON; the served environment is printed as `[redacted]`, never with the token.

`examples/external-agent.ts` is the Phase 13 counterpart: it bridges tools to a vendor through the
broker's MCP route itself, without `serveTools`.
