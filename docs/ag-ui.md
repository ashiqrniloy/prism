# Frontend interoperability (AG-UI and ACP)

## What it does

`@arnilo/prism-ag-ui` is an optional, framework-free protocol adapter over Prism's existing redacted `AgentEvent`, session, durable-run, and persistence seams.

- Root export maps Prism events to AG-UI `@ag-ui/core` **0.0.57** events and offers `createAgUiHandler()` (`Request` → SSE `Response`) plus `createPersistenceAgUiReplay()`.
- `@arnilo/prism-ag-ui/acp` uses stable `@agentclientprotocol/sdk` **1.3.0** root exports for `createAcpEventMapper()` and `createPrismAcpAgent()`.
- Core remains protocol-free. `resumeAgentRunStream()` / `AgentRunLifecycle.resumeStream()` are generic durable-resume streams shared by adapters.

This is not an app TUI, desktop shell, conversation database, terminal/filesystem bridge, A2A implementation, or frontend tool registry.

## When to use it

Use AG-UI when a host already authenticates users, owns sessions and durable run correlation, and needs a bounded Web endpoint for a browser/TUI/desktop client. Use ACP when an editor client already supplies an ACP transport and needs text, safe tool status, usage, and approval updates from a Prism session.

Use [A2A interoperability](a2a.md) for remote agent-to-agent JSON-RPC/HTTPS tasks. AG-UI/ACP are frontend/client protocol adapters; neither replaces A2A task lifecycle or storage.

## Inputs / request

Install the optional package beside the core runtime (it becomes publishable with the 0.0.12 release graph):

```bash
npm install @arnilo/prism @arnilo/prism-ag-ui
```

`createAgUiHandler()` takes host-owned callbacks:

| Input | Purpose |
| --- | --- |
| `authorize` | Rebinds untrusted AG-UI thread/run selectors to host ownership on every request. `false` returns 403. |
| `sessionFactory` | Returns an authorized Prism `AgentSession`; client input never selects tools or capabilities. |
| `lifecycle` + `resolveRun` | Optional durable status/resume path. Required only for a resumed interruption. |
| `replay` | Optional `createPersistenceAgUiReplay(store, options)` adapter for ownership-scoped durable pages. |
| `projection` | Explicit safe tool args/results, paths, or state projection. Omit it for default deny. |
| `redactor`, `limits` | Host redaction and narrowing-only finite caps. |

The handler accepts only `POST` JSON validated with AG-UI `RunAgentInputSchema`. IDs are bounded URL-safe values; it uses only the last text user message. Frontend tools and non-empty frontend state are rejected before authorization or session lookup. Start a run with no `resume` and no `?cursor=`; resume has exactly one entry; replay supplies `?cursor=`.

## Outputs / response / events

The handler returns `text/event-stream`, one `data: <AG-UI event>\n\n` frame per output. Mapper lifecycle is ordered: Prism `agent_started`/assistant text/tool events map to `RUN_STARTED`, `TEXT_MESSAGE_*`, and `TOOL_CALL_*`; terminal success maps to `RUN_FINISHED`; runtime errors map to `RUN_ERROR`. Active AG-UI message/tool sequences close before an error, interruption, or finish.

A Prism durable `agent_suspended` returns `RUN_FINISHED` with interrupt id `${runId}:${version}` and a strict `{ decision: "approve" | "deny" }` schema. A client must address that exact current id. `cancelled` means deny; a resolved resume payload must contain only that decision. The adapter checks host authorization, selected run, suspended status, and checkpoint version, then calls `AgentRunLifecycle.resumeStream()` once. Claimed/dispatched tools are never replayed.

`createPersistenceAgUiReplay()` queries only the host-resolved run with ownership and ascending bounded pagination. Every record must already be redacted. Events carry `prismEventId` for at-least-once page-boundary de-duplication; a nonterminal final page may attach a filtered live subscriber. Terminal pages never create a session or rerun a provider/tool.

ACP maps assistant text to `agent_message_chunk`, safe tool lifecycle to `tool_call`/`tool_call_update`, provider usage to `usage_update`, and durable suspension to `session/request_permission`. Only `allow_once` approves; reject, cancellation, unknown outcomes, and request failure deny. It advertises only close-session capability—no terminal, filesystem, MCP, editor state, location, diff, or raw input/output capability.

## Request/response example

```json
{
  "threadId": "thread-1",
  "runId": "run-1",
  "messages": [{ "id": "message-1", "role": "user", "content": "Summarize this" }],
  "tools": [],
  "state": {}
}
```

A suspended response includes this resumable interrupt shape:

```json
{
  "type": "RUN_FINISHED",
  "threadId": "thread-1",
  "runId": "run-1",
  "outcome": {
    "type": "interrupt",
    "interrupts": [{ "id": "run-1:4", "responseSchema": { "required": ["decision"] } }]
  }
}
```

Resume the same host thread/run with `resume: [{ "interruptId": "run-1:4", "status": "resolved", "payload": { "decision": "approve" } }]`. Do not send a copied session transcript, tool definitions, or mutable application state.

## Implementation example

```ts
import { createAgent, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { createAgUiHandler } from "@arnilo/prism-ag-ui";

const agent = createAgent({
  model: { provider: "mock", model: "offline" },
  provider: createMockProvider([providerTextDelta("ready"), providerDone()]),
});

const handle = createAgUiHandler({
  authorize: ({ request }) => request.headers.get("authorization") === "Bearer host-checked"
    ? { ownership: { userId: "user-1" } }
    : false,
  sessionFactory: () => agent.createSession({ id: "host-owned-thread" }),
  projection: { toolArguments: () => undefined, toolResult: () => undefined },
});

const response = await handle(request); // adapt this Web Response in host framework
```

See runnable network-free [`examples/ag-ui-server.ts`](../examples/ag-ui-server.ts). For ACP, construct `createPrismAcpAgent({ authorize, sessionFactory, lifecycle })` and connect the returned stable SDK agent through the host's ACP transport.

## Extension and configuration notes

All identity, authorization, session/thread mapping, durable checkpoint lookup, persistence selection, replay cursor persistence, transport adaptation, and optional projection are host-owned. The adapter owns no listener, database, background reconnect loop, credential resolver, or UI state.

`AgUiProjection` is an allow-list. Without a callback, raw tool arguments/results/progress, paths, arbitrary state, raw Prism events, ACP locations/diffs/terminals/raw I/O, and frontend-supplied tools remain absent. Use a projector that returns a redacted display value, not a host filesystem path or tool payload.

## Security and performance notes

Authorize every start, replay, resume, ACP new/prompt/cancel/close request. Treat thread IDs, run IDs, cursors, client messages, resume payloads, and protocol output as untrusted. Persist run ↔ protocol correlation before exposing an interrupt. Keep `SecretRedactor` active for streaming and ledger writes.

Defaults / hard caps: request 64 KiB / 1 MiB; input 128 / 1024 messages and 64 KiB / 1 MiB text; projected event 64 KiB / 1 MiB; error 8 KiB / 64 KiB; cursor 4 / 16 KiB; replay page 100 / 500 records; queue 128 / 4096 events; stream 10,000 / 100,000 events and 10 / 64 MiB; wall time 120 seconds / 30 minutes. Overflow yields a bounded error/closed stream, not an unbounded queue. Reconnect is at-least-once, so clients de-duplicate stable event/message/tool IDs.

Benchmark command/result placeholder: Task 8 adds `node scripts/benchmark-0.0.12.mjs` for mapper throughput, replay/handler latency, queue/heap, bytes, and coding-compaction preparation. No 0.0.12 timing result is claimed before that gate.

## Related APIs

- [Agent/session runtime](agent-session-runtime.md): `session.stream()`, `resumeAgentRunStream()`, and durable lifecycle.
- [Agent events](agent-events.md): normalized source events and ledger redaction.
- [Runs and usage ledger](runs-and-usage.md): durable `AgentEventRecord` query source.
- [Web-standard server handler](server.md): generic Prism HTTP API, separate from AG-UI.
- [A2A interoperability](a2a.md): remote agent-to-agent tasks, not frontend protocol mapping.
- [Host security guide](host-security.md): authorization, ownership, redaction, and credential boundaries.
