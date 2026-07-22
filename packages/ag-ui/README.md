# @arnilo/prism-ag-ui

Optional, framework-free frontend interoperability for Prism. Import is inert: no network, listener, run, tool, state, filesystem, or editor capability starts or appears on import.

> Released in 0.0.12 as an optional package. Install it with the matching `@arnilo/prism` version.

## AG-UI

Root exports use `@ag-ui/core@0.0.57` to map redacted Prism `AgentEvent` values and provide:

- `createAgUiEventMapper()` — ordered AG-UI lifecycle/text/tool/status mapper.
- `createAgUiHandler()` — host-authorized Web `Request` → bounded SSE `Response`.
- `createPersistenceAgUiReplay()` — ownership-scoped, already-redacted durable event page adapter.

Hosts supply authorization, session/thread/run correlation, durable lifecycle/replay storage, redaction, and any safe projection. Client tools and non-empty state are rejected. Raw tool args/results/progress, paths, arbitrary state, and raw events are omitted unless a host projector explicitly returns safe display data.

Durable approval uses `AgentRunLifecycle.resumeStream()` with exact `${runId}:${version}` interrupt correlation. Replay is at-least-once; terminal pages never start sessions or rerun provider/tool work.

```ts
import { createAgUiHandler } from "@arnilo/prism-ag-ui";

const handle = createAgUiHandler({ authorize, sessionFactory, lifecycle, resolveRun, redactor });
const response = await handle(request);
```

## ACP sibling

`@arnilo/prism-ag-ui/acp` exposes stable ACP v1 `createAcpEventMapper()` and `createPrismAcpAgent()` using `@agentclientprotocol/sdk@1.3.0` root exports only. It streams text, safe tool status, usage, and durable `session/request_permission` approvals through Prism sessions/lifecycle.

It does not expose experimental ACP v2, terminal, filesystem, MCP, editor state, locations, diffs, raw tool I/O, or automatic permissions. Only ACP `allow_once` approves; reject, cancel, unknown, and failed permission outcomes deny.

## Limits and security

Defaults / hard: request and event 64 KiB / 1 MiB; replay 100 / 500 records; queue 128 / 4096 events; stream 10,000 / 100,000 events and 10 / 64 MiB; request wall time 120 seconds / 30 minutes. Overflow closes with a bounded error.

Authorize every AG-UI or ACP operation. Bind untrusted protocol selectors to host ownership; persist run correlation before exposing interruption; keep secret redaction active; default-deny sensitive projection. This package is not A2A, a TUI, a desktop app, or a credential provider.

Full contract and runnable offline example: [`docs/ag-ui.md`](../../docs/ag-ui.md), [`examples/ag-ui-server.ts`](../../examples/ag-ui-server.ts).
