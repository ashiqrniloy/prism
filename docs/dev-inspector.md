# Dev inspector

## What it does

`@arnilo/prism-dev` is a **loopback-only local dev inspector** over a host's already-configured Prism agent — the `prism dev` playground server (plan 040). It is a **composition-only consumer**: it adds zero core primitives and imports no core internals. Every capability is an existing public seam consumed verbatim:

- `@arnilo/prism-server` `createPrismHandler` — direct `POST /prism/agents/:id/runs` and SSE `POST /prism/agents/:id/stream` agent routes, authorization, ownership propagation, and the durable `Last-Event-ID` event route when an exposure carries `events` + `resolveRun`.
- Core durable `AgentEventSource` contract (`page`/`subscribe`) — replay and reconnect without re-execution.
- `@arnilo/prism-ag-ui/renderer` — event projection for the served UI page (plan 040 Task 3).
- Run-ledger records (`RunRecord`/`AgentEventRecord`/`ToolCallRecord`/`UsageRecord`) surfaced only through the seams above — the package never touches a ledger.
- Pending-decision resume through the server's fail-closed decision validation (plan 040 Task 2) — the inspector adds none.

## When to use it

Use it when iterating on prompts in a local Prism host and you want a inspectable timeline (events, tool calls, usage, HITL decisions, run replay) instead of building your own trace viewer. Do not deploy it: it is a developer-time surface, intentionally omitted from `@arnilo/prism-all` and the profile packages, and it must never be the production API boundary — that stays `@arnilo/prism-server` under host authorization.

### Quickstart — `prism dev` (plan 040 Task 4)

```bash
npm install --save-dev @arnilo/prism-dev
cd my-agent && npm run dev   # → prism dev → http://127.0.0.1:4311
```

`prism dev` (and the standalone `prism-dev` bin, plus the programmatic `runDevCli` from `@arnilo/prism-dev/cli`) boots the inspector over the current `prism init` scaffold: it imports `dist/agent.js` and calls its `createAppAgent()` export — the scaffold's own agent, with its own credentials. It defaults to `127.0.0.1:4311`, prints the loopback URL once listening (start-to-listen under 1s excluding provider network), and `Ctrl+C` drains and closes. A non-loopback `--host` is refused before binding (`ERR_PRISM_DEV_REMOTE_BIND`); the CLI never reads environment secrets itself. See `docs/cli-rpc.md` for the flag table.

## Inputs / request

`createPrismDevInspector(options)`:

| Field | Purpose |
| --- | --- |
| `agent` | Required host-built `Agent` (mock or provider-backed). The inspector never constructs the agent or reads credentials. |
| `eventSource` | Optional durable `AgentEventSource`; opts the server exposure into durable event routes, SSE reconnect, and the paged replay endpoint. Requires `resolveRun`. |
| `resolveRun` | Required with `eventSource`: resolves a public run selector to exact internal session/run IDs. Refusing a selector (foreign/unknown run) fails closed with `404`. |
| `checkpoints` | Optional host checkpoint store backing the agent's `runState`; wiring it enables the durable status/resume capability behind the decision endpoint. Host-owned — the inspector only composes the core lifecycle seam (`createAgentRunLifecycle`) over the host's own agent. |
| `definitionRevision` | Definition revision declared for the lifecycle resolve; default `"1"`. |
| `authorize` | Optional per-operation authorizer. Loopback default: single synthetic local user (`local`, ownership `tenantId`/`userId` both `local` so durable event scoping passes); request JSON can never widen ownership (server seam enforces). |
| `host` | Bind host, default `127.0.0.1`. **Non-loopback fails closed** unless `remoteAuthorize` resolves `true` and a real `authorize` callback is supplied. |
| `port` | Default `4311`; `0` picks an ephemeral port. |
| `remoteAuthorize` | Explicit opt-in callback for a non-loopback bind, consulted by `listen()`. |
| `redactor` | Host `SecretRedactor` passed through to the server handler and the replay pager; rendered tool args/results stay host-redacted on both the SSE and replay paths. |
| `limits` / `basePath` | Server limits and route base path passthrough. |

## Outputs / response / events

The inspector exposes `handler` (the composed `PrismRequestHandler`), `listen()`, `close()`, and once listening `url`/`host`/`port`. Boot (create + bind, excluding host model calls) stays under the 1s envelope. Configuration refusals throw `DevInspectorError` (`ERR_PRISM_DEV_INSPECTOR`, or `ERR_PRISM_DEV_REMOTE_BIND` for bind-policy failures).

Per-task surface (plan 040): Task 1 wires agent routes + bind policy; Task 2 (shipped) adds the data-defined inspector routes below; Task 3 serves the static UI page; Task 4 ships the `prism dev` CLI composition.

## HTTP surface (plan 040 Task 2)

Data-defined route table over the server seam — each route either rewrites the URL into the already conformance-tested `PrismRequestHandler` or pages the durable event source. Unmatched requests forward unchanged to the raw `/{basePath}/*` server surface on the same listener.

| Route | Purpose | Adapts to |
| --- | --- | --- |
| `POST /prompt` | Runs the agent (direct run). | server handler direct agent run. |
| `GET /events?runId=<id>` | Durable SSE stream of normalized events. `Last-Event-ID` header reconnect and `?cursor=` are honored by the server seam; missing `runId` → `400 ERR_PRISM_DEV_ROUTE`. |
| `GET /runs/:id/replay?cursor=…` | Paged replay of a stored run from the durable `AgentEventSource` — **no session, no provider, no re-execution** (`createPrismAgentEventReplay` page). Returns `{ items, nextCursor?, terminal }`; unknown/foreign run ids → `404`. |
| `POST /runs/:runId/decisions/:decisionId` | Resumes/denies one suspended approval. Body `{ outcome: "allow_once" \| "allow_always" \| "deny", expectedVersion? }` → forwarded as a single-entry core decision batch; unknown discriminants and stale versions fail closed (`400`) at the core boundary **before any state write**. |

Reconnect semantics: every SSE frame carries `id: <cursor>`; a reconnecting client sends `Last-Event-ID: <cursor>` and receives exactly the post-cursor events — no duplicates, no loss (server conformance-tested). Replay pages are bounded by the deployment limits (`maxReplayEvents`, `maxReplayCursorBytes`) and ownership-scoped by the source seam itself.

## UI walkthrough (plan 040 Task 3)

Opening the inspector URL serves one static page (`GET /` → `page` + `GET /assets/inspector.js`; bootstrap via same-origin `GET /config` → `{ basePath, agentId }`). No external fetches — the bundle is offline-capable, served with a strict CSP (`default-src 'none'; script-src 'self'; connect-src 'self'`, `nosniff`, `no-store`), and every dynamic payload reaches the DOM through text nodes only (redacted strings render as-is, never parsed as markup).

Panels:

- **Prompt box** — `POST {basePath}/agents/{id}/stream` (server SSE seam); frames arrive as redacted `AgentEvent` JSON and fold into the timeline live.
- **Event timeline** — message deltas merged into per-stream text items, thinking separately, turn boundaries as separators. Rows render incrementally through a **windowed list** (last `MAX_RENDERED_WINDOW` = 400 rows; older rows collapse into a counter line) so 1k+ event runs never lock the page. Tool calls are expandable `<details>`: streamed args, finished results, blocked/error state.
- **Usage** — per-run totals summed from `provider_turn_finished.usage` and the terminal `agent_finished.usage` (input/output/total tokens, cost when the model reports it).
- **Decisions** — `agent_suspended` renders one card per pending decision (`PendingDecision.approvalId`, tool name, redacted reason, `expectedVersion` from the event's run version). Buttons post `POST /runs/:runId/decisions/:approvalId` ({ outcome: `allow_once` | `allow_always` | `deny`, expectedVersion }); rejections show the seam's fail-closed error verbatim, and a remaining-multi-decision suspension re-renders from the response's `runState.interruption`.
- **Run selector** — session runs (live + loaded) with status; a durable view of any past run loads via `GET {basePath}/events?runId=…` over `EventSource` — the seam's own `Last-Event-ID` reconnect applies. Without a durable event source wired, loading by runId surfaces that fact instead of pretending to replay.

## Request/response example

```json
POST /prompt
{ "input": "Summarize the release notes" }
```

Suspended approval surfaced by that response (`runState.interruption.pendingDecisions`) resumes via:

```json
POST /runs/<runId>/decisions/<approvalId>
{ "outcome": "allow_once", "expectedVersion": 1 }
```

## Implementation example

```ts
import { createPrismDevInspector } from "@arnilo/prism-dev";

const inspector = createPrismDevInspector({
  agent, // host-built agent (mock or provider-backed)
  eventSource, // optional durable AgentEventSource for replay
  host: "127.0.0.1",
  port: 4311,
});
await inspector.listen(); // http://127.0.0.1:4311 — loopback only
```

Loopback policy: default bind is `127.0.0.1:4311`; a non-loopback bind is refused unless an explicit `remoteAuthorize` callback opts in and a real `authorize` callback is supplied; loopback default authorization is one synthetic local user; the inspector stores no secrets and never reads `process.env` for credentials.