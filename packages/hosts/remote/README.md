# @arnilo/prism-remote

Host library that serves a Prism `Agent` to remote clients and connects to remote agents over `prism.remote/1`.

## Install

```bash
bun add @arnilo/prism @arnilo/prism-remote
```

This is a host library, not a native package: import it in the host; do not add it to an agent's manifest or `packages` list. Network serving requires Bun. It registers no tools, skills, commands, hooks, slots, or services and declares no package capabilities.

## What it does

- `serveAgent(agent, { transport, authenticate?, ownershipFor?, operator?, allowModifiedArguments?, hostUi?, resumeAuthority?, limits?, endpointId? })` serves any `Agent` over `prism.remote/1`: open, list, and resume sessions; `run` with events streamed as unchanged `run.event` notifications, then `run.settled`; `steer`, `abort`, `commands.*`, `inspect`, `models.list`, and `sessions.messages`.
- `remoteHostUi()` is a plain `HostUi`. Create the agent with it as `host.ui` and pass the same object to `serveAgent({ hostUi })`. Session-scoped requests route to a connection of the session's owning principal; agent-scoped requests (`sessionId` absent) route only to operator connections (`operator(principal) === true`, or single-principal connections). With no matching connection, or after a disconnect, it answers `unavailable`, so the kernel suspends the run durably (`suspended_run`). Package requests that do not suspend fail closed under their own contract.
- When the owning principal next initializes or reopens a suspended session, the server sends one `hostUi.request` per pending decision (read from the session's branch, so it works after a restart). The answers become `session.resume(decisions)`.
- Notifications for a run can arrive before the `run` response. Route them by `sessionId`.

- `connectAgent(endpoint, { host?, mirror?, ownership?, endpointId?, limits? })` returns an `Agent` proxy (`endpoint` is `{ kind: "stdio", command, env?, cwd? }` `{ kind: "memory", transport }`, `{ kind: "websocket", url, token? }`, or `{ kind: "http", url, token? }`). Use it anywhere an `Agent` goes, for example `agentNode({ agent: remote })`.
  - Forwarded events keep their catalog `type` and gain `origin.remote`. An event that already has a nested `origin` keeps it. Every `tool.*` event carries `origin.executedBy: "external"`: the remote ran the tool under its own `tool.call` gate, so no local hook fires.
  - The remote's `hostUi.request`s go to `host.ui`. With no local UI they answer `unavailable`, the remote run suspends, and `run()` resolves `status: "suspended"` with the pending decisions; `session.resume(decisions)` continues it.
  - `mirror: store` archives each remote session into `store`: one links `metadata` entry (the session's `parent`, plus `actor: { kind: "prism", agent }`), then one `message` entry per `message.completed` (never per delta). `createSessionIndex(store).search({ query, workflowRunId })` finds them. Mirroring trusts the remote's redaction: entries are stored as received.
  - `run`/`stream` send only `metadata`, `limits`, and `interactive`; `principal`, `ownership`, `redactor`, `runLedger`, and `signal` stay local (an aborted `signal` sends `abort`).
  - Unsupported on a remote: `fork`, `checkout`, `compact`, `contextMeter`, `entries()` without a mirror, `models.resolve`, and `sessions.get/delete/search`. They fail with `remote_unsupported`.
  - A disconnect rejects the active run with `disconnected`; the remote run suspends at its next ask.

## When to use it

Serve an agent in another process, connect a workflow to a remote worker, or route a remote approval to the host's UI. The remote agent owns its packages, tools, persistence, and gates.

## Configuration

### `serveAgent(agent, options)`

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `transport` | stdio, WebSocket, HTTP, or `RemoteTransport` | required | Listener or frame transport. |
| `hostUi` | `HostUi` from `remoteHostUi()` | absent | Same object used as the agent's `host.ui`. |
| `resumeAuthority` | `RemoteResumeAuthority` | absent | Host-owned resume coordinator shared with other entry points, such as a headless router. |
| `authenticate` | `(Request) => { principal } \| undefined`, optionally async | bearer auth | Network authentication override; throwing denies access. |
| `ownershipFor` | `(principal: Principal) => OwnershipScope` | absent | Derives the kernel `OwnershipScope` for an authenticated principal across `sessions.open`, `sessions.list`, `run`, `sessions.resume`, and pending-decision resume. |
| `operator` | `(principal: Principal) => boolean` | absent | Marks a principal as an operator allowed to receive agent-scoped `hostUi` requests and `agent.event` notifications. |
| `allowModifiedArguments` | `boolean` | `false` | Allows clients to send `Decision.modifiedArguments` in `sessions.resume` (re-gated by the kernel before execution). |
| `endpointId` | string | random id | Endpoint attribution sent to clients. |
| `limits` | `RemoteLimitOptions` | below | Bounds shared by dispatchers and transports. |

Network `transport` fields:

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `kind` | `"websocket" \| "http"` | required | WebSocket or HTTP with SSE. |
| `hostname` | string | `127.0.0.1` | Non-loopback requires `authenticate`. |
| `port` | number | `0` | Ephemeral port. |
| `token` | secret ref only (`env:` / `keyring:`) | generated | Resolved once; literals refused. |
| `allowedHosts` | string[] | loopback hosts with bound port | Exact Host allow-list. |
| `allowedOrigins` | string[] | loopback HTTP origins | Exact Origin allow-list when Origin is present. |
| `maxRequestBytes` | number | `limits.maxFrameBytes` | Can narrow, never exceed the frame cap. |

Stdio accepts optional `input` and `output`, defaulting to process stdin/stdout. Keep stdout reserved for protocol frames.

### `connectAgent(endpoint, options?)`

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `endpoint` | stdio, WebSocket, HTTP, or memory endpoint | required | Stdio: `{ kind: "stdio", command: string[], env?, cwd? }`; network: `{ kind, url, token? }`; memory: `{ kind: "memory", transport }`. |
| `host.ui` | `HostUi` | absent | Answers remote requests; absent answers `unavailable`. |
| `mirror` | `SessionStore` | absent | Opt-in local archive. |
| `ownership` | `OwnershipScope` | absent | Scope stamped on mirrored entries. |
| `endpointId` | string | server endpoint id | Override attribution for this connection. |
| `limits` | `RemoteLimitOptions` | below | Client dispatcher bounds. |

Network endpoint `token` is the resolved bearer value (for example `served.token`), unlike the server transport's ref-only `token`. Stdio `command` is an argv array, never shell text; its `env` overlays the inherited environment. Dispose the proxy to close the connection and terminate its owned child.

### Limits

| Field | Default | Hard maximum | Purpose |
| --- | --- | --- | --- |
| `maxFrameBytes` | 1,048,576 | 16,777,216 | UTF-8 bytes per frame (minimum 1024). |
| `maxConnections` | 64 | 1024 | Network connections. |
| `keepAliveMs` | 15,000 | 60,000 | SSE keep-alive interval. |
| `maxConcurrentRequests` | 16 | 256 | Concurrent inbound handlers. |
| `maxPendingRequests` | 64 | 1024 | Outstanding outbound requests. |
| `maxQueuedEvents` | 1000 | 100,000 | Queued transport events. |

All limits are positive safe integers; values above hard maxima are rejected. Slow consumers disconnect rather than grow an unbounded queue.

## Protocol

JSON-RPC 2.0 frames negotiate `prism.remote/1` in `initialize`. Unsupported versions fail with `protocol_unsupported` before sessions open. Capabilities are the intersection of both peers' known `hostUi`, `hostUi.secret`, and `agentEvents` flags; unknown flags are ignored.

| Method | Direction | Behavior |
| --- | --- | --- |
| `initialize` | client → server | Protocol, capabilities, endpoint and agent descriptors. |
| `sessions.open` | client → server | Create or reopen a session, optionally with parent links. |
| `sessions.list` | client → server | List sessions with a query. |
| `sessions.resume` | client → server | Resume pending decisions. |
| `sessions.messages` | client → server | Read branch messages. |
| `run` | client → server | Start a run; returns run id. |
| `steer` | client → server | Steer an active session. |
| `abort` | client → server | Abort an active session. |
| `commands.list` | client → server | List command descriptors. |
| `commands.run` | client → server | Run a command, optionally in a session. |
| `inspect` | client → server | Agent inspection. |
| `models.list` | client → server | List models. |
| `hostUi.request` | server → client | Request a negotiated UI answer. |
| `run.event` | server → client notification | Unchanged catalog event with session/run ids. |
| `run.settled` | server → client notification | Final run result. |
| `agent.event` | server → client notification | Negotiated agent-scoped event. |

### Wire parameter allow-lists (`wire.ts`)

Every inbound wire payload is validated before reaching the kernel; unknown or out-of-range fields fail closed with `invalid_params`:

| Surface | Allowed fields & bounds | Rejected / stripped |
| --- | --- | --- |
| `run.options` / `sessions.resume.options` | `metadata` (object), `limits` (object), `interactive` (boolean) | `principal`, `ownership`, `redactor`, `runLedger`, `signal`, and any unknown key (`invalid_params`). |
| `sessions.resume.decisions[]` | `approvalId` (non-empty string ≤ 256), `outcome` (`allow_once` \| `allow_for_run` \| `reject_once` \| `reject_for_run`), `reason` (string ≤ 2 KiB), `elicitation` (JSON object, only for pending `elicitation` decisions), `modifiedArguments` (JSON object, only when `allowModifiedArguments: true`) | `modifiedArguments` when `allowModifiedArguments` is omitted/`false`, `elicitation` on `tool_approval` decisions, and any extra key (`invalid_params`). |
| `steer.options` | `softInterrupt` (boolean) | Any other key or non-boolean `softInterrupt` (`invalid_params`). |
| `sessions.list.query` | `cursor` (non-empty string ≤ 512), `limit` (integer `1..100`), `order` (`"asc"` \| `"desc"`), `agentId`, `parentSessionId`, `workflowRunId`, `delegationId`, `actorAgent` (non-empty strings ≤ `MAX_SESSION_LINK_ID_LENGTH`), `actorKind` (`"prism"` \| `"external"`) | Client-supplied `tenantId`, `accountId`, `userId` are stripped (server `ownershipFor` scope applies); any other key or out-of-range value is `invalid_params`. |
| `sessions.open.parent` | `sessionId`, `agentId`, `workflowRunId`, `delegationId` (non-empty strings ≤ `MAX_SESSION_LINK_ID_LENGTH`) | Any other key, empty string, or string > 256 chars (`invalid_params`). |

Stdio uses newline-delimited JSON; WebSocket uses one frame per message; HTTP uses JSON POST bodies and SSE `data` frames. A run's notifications can precede its request response: route by session id.

## Attribution and mirroring

An event without an origin gains `{ kind: "prism", agent, agentId, remote: endpointId, depth: 0 }`. Existing origins keep every field and gain `remote` only if absent: the innermost endpoint wins across multiple hops. Every forwarded `tool.*` event sets `origin.executedBy: "external"`, even when `origin.kind` is `"prism"`. This means external to the connecting host: the remote's tool gate ran, and no local `tool.call` hook fires.

Mirroring is off by default. Enabling it adds one links metadata write when a session is new and one write per completed message, never per delta. Entries chain through `parentId`, retain workflow `parent` links, and carry `metadata.remote` and optional local ownership. Only `message.completed` is archived; user inputs and remote internal entries are not copied. Search with `createSessionIndex(store).search({ query: "report", workflowRunId })`. Run settlement waits for mirror writes; a write failure rejects locally even if execution completed remotely.

Mirroring trusts the remote's redaction and stores messages as received, without a second redactor. Choose a trusted remote and scope the local store appropriately.

## Suspension and failure behavior

`remoteHostUi()` is a plain `HostUi`. Pass the same object to `createAgent({ host: { ui } })` and `serveAgent(agent, { hostUi: ui })`. No attached client or a lost connection answers `unavailable`. Only kernel asks and elicitations have durable suspension semantics; other package requests fail closed under their own contract. Use a persistent store on the served agent to survive restarts.

A later client initializes and opens the suspended session; the server reads pending decisions from the remote branch and sends UI requests, then resumes from answers. Unavailable answers leave decisions pending. Explicit `session.resume(decisions)` also works. A disconnected active proxy run rejects with `disconnected`; reconnect and reopen the session to inspect or continue it. Disposing a stdio proxy terminates its owned child, so persistence is needed for later recovery.

The proxy caches `inspect()` and command descriptors at initialization. Unsupported local operations fail with `remote_unsupported`; there is no local execution fallback. No extra model calls are made by this library.

## Network transports

```ts
const served = serveAgent(agent, { transport: { kind: "http", port: 0 }, hostUi: ui });
const remote = await connectAgent({ kind: "http", url: served.url!, token: served.token });
// Use remote as an Agent, then await remote.dispose() and served.close().
```

Use `kind: "websocket"` on both sides for WebSocket. Each socket or SSE stream owns a dispatcher connection. HTTP uses `GET /events` for notifications and server requests; its `x-prism-connection` header identifies the stream. `POST /rpc?connection=<id>` carries client frames, returning RPC responses in the POST body. Server-request answers and notifications return 202.

The default bind is `127.0.0.1` on an ephemeral port, with a random 32-byte bearer token available only on `served.token`. Server configuration accepts `token: "env:NAME"` or `"keyring:name"`; literals fail with `literal_secret`. Keyring uses Bun's OS secret store, service `prism`; await `served.ready` before reading `url` or `token` for a keyring ref. Resolution failure rejects `ready` without opening a listener. Env refs resolve synchronously once at startup.

`authenticate(request)` on `serveAgent` replaces bearer authentication and must return `{ principal }` or `undefined`. Throws deny access. Non-loopback binds require this hook. Its principal supplies every run and resume; HTTP reauthenticates every POST and requires the same principal as the SSE stream. Wire callers cannot choose a principal.

Authorization travels only in `Authorization: Bearer`, never query parameters. Browser WebSocket clients cannot set this header: use a host authentication hook or HTTP with SSE. The client rejects credential-bearing URLs and redirects.

Host matching includes the port and is exact, case insensitive. Default allowed hosts are `127.0.0.1:<port>`, `localhost:<port>`, and `[::1]:<port>`. Default allowed origins are their `http://` origins. Missing Origin is accepted; a present unlisted Origin is rejected. Set `allowedHosts`/`allowedOrigins` on the transport to customize; an explicit empty list disables that gate, matching the MCP host library.

`maxRequestBytes` defaults to `limits.maxFrameBytes` and can only narrow it. Bodies are capped while reading. Authentication, Host and Origin gates run before dispatch, including WebSocket upgrades. Errors use fixed codes and do not echo credentials or hook errors.

`limits.maxConnections` defaults to 64 (hard maximum 1024); `limits.keepAliveMs` defaults to 15000 (hard maximum 60000). SSE comments keep the stream alive, and cancellation releases its dispatcher and HostUi binding. Queues and WebSocket backpressure are bounded; slow consumers disconnect.

## Multi-user deployments

Every connection opened on a served agent is partitioned by its authenticated `Principal` (`kind` and `id`). Single-principal transports (`stdio`, memory, or loopback bearer authentication where `authenticate` is omitted) share the default single-principal partition, which also acts as operator.

- **Session isolation floor:** `ServerState.sessions` is keyed by principal and session id, backed by an $O(1)$ `sessionOwners` map. Independently of `ownershipFor`, any wire call (`sessions.open(id)`, `sessions.messages`, `run`, `steer`, `abort`, `sessions.resume`, or `commands.run` with `sessionId`) for a session owned by another principal rejects with `session_not_found`.
- **Kernel ownership scope (`ownershipFor`):** When `ownershipFor: (principal) => OwnershipScope` is configured on `serveAgent`, the derived scope is passed into `sessions.open` (`SessionOptions.ownership`), `sessions.list` (stripping any client-supplied ownership keys), `run`, `sessions.resume`, and reconnect pending-decision resume (`RunOptions.ownership`).
- **Owner-routed `remoteHostUi` and pending delivery:** Requests carrying `request.sessionId` route in $O(1)$ to a bound connection of that session's owning principal, or return `unavailable` (suspending the run durably) if that principal has no bound connection. On connect, `deliverPending` delivers only the connecting principal's suspended sessions.
- **Operator-only agent-scoped requests and events (`operator`):** `hostUi` requests without a `sessionId` and `agent.event` notifications without a `sessionId` (or from host-local sessions not owned by a remote principal) route only to connections where `operator(principal) === true` (or single-principal connections). Session-scoped `agent.event` notifications (`session.opened`, `background.*`) reach only that session's owning principal.

```ts
serveAgent(agent, {
  transport: { kind: "websocket", hostname: "0.0.0.0", port: 8443 },
  authenticate: verifyJwt,
  ownershipFor: (p) => ({ userId: p.id }),
  operator: (p) => p.kind === "service",
  hostUi,
});
```

## Conformance

`@arnilo/prism-remote/testing` exercises run, stream, steer, abort, resume,
inline HostUi answers, commands, and suspension on disconnect over stdio,
WebSocket, and HTTP with SSE. Every collected event must carry `origin.remote`
and must exclude the network bearer token. Results identify each transport and leg.

```ts
import { remoteConformance } from "@arnilo/prism-remote/testing";

const result = await remoteConformance({
  module: new URL("./fixture-agent.ts", import.meta.url).href,
  prompts: { run: "hello", approve: "write the file" },
});
if (result.failures.length) throw new Error(JSON.stringify(result.failures));
```

The module exports `async create({ hostUi, stateDirectory })`, returning a fresh
Agent with the supplied HostUi. The `run` prompt must complete without approval;
`approve` must request approval before completing. Include at least one command
that accepts no arguments and returns a deterministic result. The suite compares
stream event types and order with a fresh in-process agent.

Use `stateDirectory` for the fixture's persistent store. Stdio reconnect starts a
new child using the same directory; its fixture drains the pending approval before
exiting. The fixture module is loaded in both the caller and a Bun child process,
so its imports must resolve in both. The suite creates and removes its temporary
directories; it never constructs an agent or imports kernel testing helpers.

The optional second argument accepts `transports` (default all three) and
`timeoutMs` (default 2000 per leg). A timeout reports the transport and leg name.
The stdio fixture ships under `src/testing-fixtures` with the package.

## Example

A manifest-free host can serve an already constructed agent:

```ts
import { createAgent, providerDone, providerTextDelta } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import { connectAgent, remoteHostUi, serveAgent } from "@arnilo/prism-remote";

const ui = remoteHostUi();
const agent = await createAgent({
  model: { provider: "mock", model: "demo" },
  packages: [mockProvider([[providerTextDelta("Hello"), providerDone()]])],
  host: { ui },
});
const served = serveAgent(agent, { transport: { kind: "http", port: 0 }, hostUi: ui });
await served.ready;
const remote = await connectAgent({ kind: "http", url: served.url!, token: served.token });
try {
  console.log((await (await remote.session()).run("hello")).text);
} finally {
  await remote.dispose();
  await served.close();
  await agent.dispose();
}
```

Run `bun examples/remote-agent.ts` from the repository for the offline stdio example: a child mock agent asks approval through local scripted UI, runs beside a local workflow agent, prints the merged event stream with `origin.remote`, and finds both replies in one SQLite search. The paired `remote-agent-server.ts` owns stdout for protocol traffic.

When a headless router can also resume this agent, pass the same `createResumeAuthority(agent)` instance to `serveAgent` and `routeHostUi` as `resumeAuthority`. Both reconnect delivery and explicit `sessions.resume` then use its guarded resume stream while preserving connection principal and stream limits. The remote library imports no headless implementation. Without this option the existing remote-only guard applies; separate authorities or direct kernel resumes are not coordinated. Cross-process arbitration remains outside this guard.
