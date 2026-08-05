# @arnilo/prism-ag-ui

Optional, framework-free frontend interoperability for Prism. Import is inert: no network, listener, run, tool, state, filesystem, or editor capability starts or appears on import.

> Released in 0.0.12; Phase 8 HITL/A2UI in 0.0.25 as an optional package. Install it with the matching `@arnilo/prism` version.

## AG-UI

Root exports use `@ag-ui/core@0.0.57` to map redacted Prism `AgentEvent` values and provide:

- `createAgUiEventMapper()` — ordered current AG-UI lifecycle/step/text/tool/state/activity/reasoning/raw/custom mapper through safe host projection.
- `createAgUiHandler()` — host-authorized Web `Request` → bounded SSE `Response`, `handler.capabilities`, opt-in full input/projector, A2UI painting (`a2ui` option), standard projectors (`createMessagesFromSessionProjection` / `createStateFromStoreProjection` / `createActivityFromToolProgressProjection` + `composeAgUiProjections`), and aggregate-interrupt seams.
- `createPersistenceAgUiReplay()` — compatible ownership-scoped durable event page adapter.
- `createAgentEventSourceAgUiReplay()` — shared durable replay/live follow with `prismEventId` and opaque `prismCursor`, no local-session handoff.
- `createAgUiMcpAdapter()` — host-selected reviewed Prism MCP tools passed to `sessionFactory` for normal core dispatch; linked Apps emit standard activity.
- `createAgUiMcpAppHandler()` / `createAgUiMcpAppSandbox()` — authenticated single-bridge Apps JSON-RPC proxy plus renderer sandbox/CSP config; never executes HTML.
- `createAgUiA2AAdapter()` — verified host-selected remote A2A task/message stream to AG-UI events without a local session.

Hosts supply authorization, session/thread/run correlation, durable lifecycle/replay storage, redaction, and safe projections. Without `input.project`, client tools/non-empty state are rejected and only final text reaches a session. With it, full official input reaches an authorized host callback; only callback-returned Prism messages/handoffs run. Client tool JSON never becomes a Prism `ToolDefinition`. Raw tool args/results/progress, state, activity, reasoning, and raw events stay absent unless a bounded projector returns safe data.

Durable approval uses `AgentRunLifecycle.resumeStream()` with exact `${runId}:${version}` correlation. Aggregate host interrupt policy may require multiple bounded entries; edited arguments deny because persisted calls are immutable. Replay is at-least-once; terminal pages never start sessions or rerun provider/tool work.

```ts
import { createAgUiHandler } from "@arnilo/prism-ag-ui";

const handle = createAgUiHandler({ authorize, sessionFactory, lifecycle, resolveRun, redactor });
const response = await handle(request);
```

## ACP sibling

`@arnilo/prism-ag-ui/acp` exposes stable ACP v1 `createAcpEventMapper()` and `createPrismAcpAgent()` using `@agentclientprotocol/sdk@1.3.0` root exports only. It streams text, safe tool status, usage, and durable `session/request_permission` approvals through Prism sessions/lifecycle.

It does not expose experimental ACP v2, terminal, filesystem, MCP, editor state, locations, diffs, raw tool I/O, or automatic permissions. Permission prompts offer four outcomes (`allow_once` / `allow_always` / `reject_once` / `reject_always`) mapped onto the shared batch decision model; cancel stays deny-closed.

## Limits and security

Defaults / hard: request/event/state/activity/reasoning/raw 64 KiB / 1 MiB; input 128 / 1024 messages, 32 / 256 tools/contexts, 8 / 64 interrupts, 16 / 64 media parts; patches 128 / 4096 operations; JSON depth 16 / 64, properties 128 / 4096, arrays 512 / 8192; replay 100 / 500 records; queue 128 / 4096 events; stream 10,000 / 100,000 events and 10 / 64 MiB; request wall time 120 seconds / 30 minutes. SSE only; WebSocket/protobuf/push stay undeclared. Overflow closes with a bounded error.

Authorize every AG-UI or ACP operation. Bind untrusted protocol selectors to host ownership; persist run correlation before exposing interruption; keep secret redaction active; default-deny sensitive projection. This package is not A2A, a TUI, a desktop app, or a credential provider.

0.0.14 co-work events: `mapCoWork()` (+ ACP `mapCoWork()` parity) projects artifact progress/approval/download-link, connector drafts, and redacted browser snapshots into named `CUSTOM` events over the existing durable-resume stream; `projectCoWorkEvent()` validates/host-projects/redacts/byte-caps each event (malformed/oversized fail closed to nothing). No local paths, raw tool args/results, or secrets are exposed.

MCP Apps needs optional peer `@arnilo/prism-mcp`; remote A2A needs optional peer `@arnilo/prism-supervisor`; no protocol client starts on import. Full contract, official support audit, and runnable offline example: [`docs/ag-ui.md`](../../docs/ag-ui.md), [`docs/ag-ui-adoption.md`](../../docs/ag-ui-adoption.md), [`examples/ag-ui-server.ts`](../../examples/ag-ui-server.ts).
