# @arnilo/prism-ag-ui

Optional, framework-free frontend interoperability for Prism. Import is inert: no network, listener, run, tool, state, filesystem, or editor capability starts or appears on import.

> Released in 0.0.12; Phase 8 HITL/A2UI in 0.0.25 as an optional package. Install it with the matching `@arnilo/prism` version.

## AG-UI

Root exports use `@ag-ui/core@0.0.57` to map redacted Prism `AgentEvent` values and provide:

- `createAgUiEventMapper()` — ordered current AG-UI lifecycle/step/text/tool/state/activity/reasoning/raw/custom mapper through safe host projection.
- `createReasoningEncryptedValue()` — bounded `REASONING_ENCRYPTED_VALUE` fragment from a host-owned `encrypt` function; fails closed, never infers from reasoning signatures.
- `createAgUiHandler()` — host-authorized Web `Request` → bounded SSE `Response`, `handler.capabilities`, opt-in full input/projector, A2UI painting (`a2ui` option), standard projectors (`createMessagesFromSessionProjection` / `createStateFromStoreProjection` / `createActivityFromToolProgressProjection` + `composeAgUiProjections`), and aggregate-interrupt seams.
- `createPersistenceAgUiReplay()` — compatible ownership-scoped durable event page adapter.
- `createAgentEventSourceAgUiReplay()` — shared durable replay/live follow with `prismEventId` and opaque `prismCursor`, no local-session handoff.
- `createAgUiMcpAdapter()` — host-selected reviewed Prism MCP tools passed to `sessionFactory` for normal core dispatch; linked Apps emit standard activity.
- `createAgUiMcpAppHandler()` / `createAgUiMcpAppSandbox()` — authenticated single-bridge Apps JSON-RPC proxy plus renderer sandbox/CSP config; never executes HTML. Optional `effectStore` records approved UI mutations for idempotent retry and unknown-outcome reconciliation (`reconcileAppEffect`).
- `createAgUiA2AAdapter()` — verified host-selected remote A2A task/message stream to AG-UI events without a local session.
- `createAgUiA2AServer()` — A2A 1.0 server-side exposure of a local AG-UI-fronted agent for remote A2A clients (Task 13): reuses `@arnilo/prism-supervisor` `createA2AHandler` transport; A2A messages run through the AG-UI input allow-list and event mapper; bounded live task registry plus optional durable replay; lazy optional-peer import; requires `@arnilo/prism-supervisor` only when called.
- `Awaitable<T>` — `T | Promise<T>`; every `AgUiProjection` hook return is `Awaitable` (Task 15): the AG-UI and ACP mappers await hooks in event order (never `Promise.all`) with per-event fail-closed; sync hooks keep exact prior behavior. `createMessagesFromSessionProjection({ getMessages })` accepts an async transcript source (`async () => (await session.entries()).map(entryToAgUiMessage)`); `projectCoWorkEvent` is now async.
- `@arnilo/prism-ag-ui/renderer` — framework-free reference renderer (Task 14): `createA2UiRenderer({ stream, catalog?, limits?, onAction?, onError?, dom? })` consumes an AG-UI event stream and renders `a2ui-surface` snapshots/deltas into DOM surfaces from a host component catalog. DOM-free `reduceA2UiOps` core, thin DOM binding with default text/container catalog, server-side A2UI caps enforced client-side, fail-closed drops with bounded error events, unknown components render explicit placeholders, never executes remote HTML. Main entry stays runtime-agnostic.

Hosts supply authorization, session/thread/run correlation, durable lifecycle/replay storage, redaction, and safe projections. Without `input.project`, client tools/non-empty state are rejected and only final text reaches a session. With it, full official input reaches an authorized host callback; only callback-returned Prism messages/handoffs run. Client tool JSON never becomes a Prism `ToolDefinition`. Raw tool args/results/progress, state, activity, reasoning, and raw events stay absent unless a bounded projector returns safe data.

Durable approval uses `AgentRunLifecycle.resumeStream()` with exact `${runId}:${version}` correlation. Aggregate host interrupt policy may require multiple bounded entries; edited arguments deny because persisted calls are immutable. Replay is at-least-once; terminal pages never start sessions or rerun provider/tool work.

```ts
import { createAgUiHandler } from "@arnilo/prism-ag-ui";

const handle = createAgUiHandler({ authorize, sessionFactory, lifecycle, resolveRun, redactor });
const response = await handle(request);
```

## ACP sibling

`@arnilo/prism-ag-ui/acp` exposes stable ACP v1 `createAcpEventMapper()` and `createPrismAcpAgent()` using `@agentclientprotocol/sdk@1.3.0` root exports only. It streams text, safe tool status, usage, and durable `session/request_permission` approvals through Prism sessions/lifecycle.

Since 0.0.27 the agent is a full coding-host adapter: capability advertisement is a pure function of the host seams (sessions load/list/delete/resume/dirs, prompt media/embedded, MCP http/sse), client-advertised fs/terminal methods are wrapped as coding seams, modes and config options are host overlays, `CodingLifecycleEvent`s map to session updates (locations/diffs only through projection allow-lists), and all-elicitation suspensions surface as `elicitation/create` when the client advertises it. It does not expose experimental ACP v2 or UNSTABLE fields (providers, nes, positionEncoding, fork, `mcpCapabilities.acp`/auth). Permission prompts offer four outcomes (`allow_once` / `allow_always` / `reject_once` / `reject_always`) mapped onto the shared batch decision model; cancel stays deny-closed. See [docs/acp.md](../../docs/acp.md) for the full reference.

## Limits and security

Defaults / hard: request/event/state/activity/reasoning/raw 64 KiB / 1 MiB; input 128 / 1024 messages, 32 / 256 tools/contexts, 8 / 64 interrupts, 16 / 64 media parts; patches 128 / 4096 operations; JSON depth 16 / 64, properties 128 / 4096, arrays 512 / 8192; replay 100 / 500 records; queue 128 / 4096 events; stream 10,000 / 100,000 events and 10 / 64 MiB; request wall time 120 seconds / 30 minutes. SSE only; WebSocket/protobuf/push stay undeclared. Overflow closes with a bounded error.

Authorize every AG-UI or ACP operation. Bind untrusted protocol selectors to host ownership; persist run correlation before exposing interruption; keep secret redaction active; default-deny sensitive projection. This package is not A2A, a TUI, a desktop app, or a credential provider.

0.0.14 co-work events: `mapCoWork()` (+ ACP `mapCoWork()` parity) projects artifact progress/approval/download-link, connector drafts, and redacted browser snapshots into named `CUSTOM` events over the existing durable-resume stream; `projectCoWorkEvent()` validates/host-projects/redacts/byte-caps each event (malformed/oversized fail closed to nothing). No local paths, raw tool args/results, or secrets are exposed.

MCP Apps needs optional peer `@arnilo/prism-mcp`; remote A2A needs optional peer `@arnilo/prism-supervisor`; no protocol client starts on import. Full contract, official support audit, and runnable offline example: [`docs/ag-ui.md`](../../docs/ag-ui.md), [`docs/ag-ui-adoption.md`](../../docs/ag-ui-adoption.md), [`examples/ag-ui-server.ts`](../../examples/ag-ui-server.ts).
