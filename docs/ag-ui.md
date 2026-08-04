# Frontend interoperability (AG-UI and ACP)

## What it does

`@arnilo/prism-ag-ui` is an optional, framework-free protocol adapter over Prism's existing redacted `AgentEvent`, session, durable-run, and persistence seams.

- Root export maps Prism events to AG-UI `@ag-ui/core` **0.0.57** events and offers `createAgUiHandler()` (`Request` → SSE `Response`), compatible `createPersistenceAgUiReplay()` pages, distributed `createAgentEventSourceAgUiReplay()` follow, and explicit `createAgUiMcpAdapter()` / `createAgUiMcpAppHandler()` / `createAgUiA2AAdapter()` protocol handshakes.
- `@arnilo/prism-ag-ui/acp` uses stable `@agentclientprotocol/sdk` **1.3.0** root exports for `createAcpEventMapper()` and `createPrismAcpAgent()`.
- Core remains protocol-free. `resumeAgentRunStream()` / `AgentRunLifecycle.resumeStream()` are generic durable-resume streams shared by adapters.

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
| `sessionFactory` | Returns an authorized Prism `AgentSession`; it receives only host-approved `AgUiPreparedInput`, never raw client tools/state. |
| `input.project` | Opts into full `RunAgentInput`; turns bounded, still-untrusted history, state, context, forwarded props, media, and lineage into host-selected Prism `Message` values. Omit for legacy final-text mode. |
| `input.frontendTools` | Explicitly selects client-side handoffs. Returned names must be request-tool subset; adapter never turns JSON tool declarations into Prism `ToolDefinition`s. |
| `mcp` | Optional `createAgUiMcpAdapter({ bridge, select })`; host selects reviewed `bridge.tools`, then `sessionFactory` receives them as `input.serverTools`. Normal Prism dispatch/loop remains sole executor. |
| `a2a` | Optional `createAgUiA2AAdapter({ client, select, correlate })`; verified remote A2A task stream replaces this handler's local session only. Host selection/correlation binds each remote task to ownership. |
| `lifecycle` + `resolveRun` | Optional durable status/resume path. Required only for a resumed interruption. |
| `interrupts.resume` | Optional host aggregate-policy callback for multiple AG-UI interrupts; it returns one current-version core approve/deny decision. |
| `replay` | Optional page adapter or `createAgentEventSourceAgUiReplay(source, options)` for gap-free distributed replay/live follow. |
| `projection` | Explicit safe tool/state/messages/activity/reasoning/raw/custom/interrupt projection. Omit each callback for default deny. |
| `capabilities` | Optional host declaration narrowed to implemented SSE/projector/lifecycle features; read `handler.capabilities`. |
| `redactor`, `limits` | Host redaction and narrowing-only finite caps. |

The handler accepts only `POST` JSON validated with official AG-UI `RunAgentInputSchema`. Every aggregate is bounded before a callback runs. With no `input.project`, it preserves compatibility: final text user message only; non-empty state or frontend tools fail before authorization/session lookup. With a projector, all current roles/history, context, state, forwarded props, multimodal parts, parent lineage, and tool-result continuations are available as untrusted input. The projector must apply Prism media URL/SSRF/MIME policy before forwarding media. Start a run with no `resume` and no `?cursor=`; replay supplies `?cursor=`.

## Outputs / response / events

The handler returns `text/event-stream`, one `data: <AG-UI event>\n\n` frame per output. Mapper lifecycle is ordered: `RUN_*`, `STEP_*`, `TEXT_MESSAGE_*`, and `TOOL_CALL_*` are deterministic Prism mappings. Host projectors may additionally prove and emit `STATE_SNAPSHOT`/`STATE_DELTA`, `MESSAGES_SNAPSHOT`, `ACTIVITY_*`, current `REASONING_*`, `RAW`, and named `CUSTOM` values. All values revalidate against official `EventSchemas`; deprecated `THINKING_*` and convenience chunk events are not produced. Active message/tool/reasoning/step sequences close before error, interruption, or finish.

A Prism durable `agent_suspended` returns `RUN_FINISHED` with core interrupt id `${runId}:${version}` and a strict `{ decision: "approve" | "deny" }` schema. `projection.interrupt` may attach bounded expiry/metadata or additional host policy interrupts but must retain that core id. Without `interrupts.resume`, one exact entry is required; `cancelled` means deny. An aggregate policy may validate bounded multiple entries, then returns one current-version core decision. Payloads containing `editedArgs`/`args` always deny: Prism does not mutate persisted tool calls. The adapter checks host authorization, selected run, suspended status, and checkpoint version, then calls `AgentRunLifecycle.resumeStream()` once. Claimed/dispatched tools are never replayed.

`createPersistenceAgUiReplay()` remains a compatible page adapter. `createAgentEventSourceAgUiReplay()` resolves exact ownership/run once per open, then consumes the shared durable source through terminal or live follow; it never attaches replica-local `session.subscribe()`. Every record must already be redacted. Mapped events carry stable `prismEventId` and bounded opaque `prismCursor`; records with no standard mapping emit `CUSTOM prism.replay_cursor`, so clients can persist progress. Terminal replay never creates a session or reruns a provider/tool.

ACP maps assistant text to `agent_message_chunk`, safe tool lifecycle to `tool_call`/`tool_call_update`, provider usage to `usage_update`, and durable suspension to `session/request_permission`. Only `allow_once` approves; reject, cancellation, unknown outcomes, and request failure deny. It advertises only close-session capability—no terminal, filesystem, MCP, editor state, location, diff, or raw input/output capability.

Selected MCP tools use normal `TOOL_CALL_*` core dispatch. Linked Apps add safe `mcp-apps` activity; app-only tools stay model-hidden. The separate reauthorizing Apps proxy allow-lists initialize/ping/logging/tool/resource calls for one bridge; its sandbox helper returns CSP/iframe config and never executes HTML.

`createAgUiA2AAdapter()` maps verified task text/activity. Non-text/tool/A2UI parts need host `projectPart`; non-streaming fallback accepts only a terminal task, otherwise host follows saved correlation.

Co-work uses bounded, redacted `CUSTOM prism.cowork.*` events through `mapCoWork()` / `createCoWorkReplay()`; see [Work artifacts and review](work-artifacts-and-review.md).

## Request/response example

Resume a default single interrupt with `resume: [{ "interruptId": "run-1:4", "status": "resolved", "payload": { "decision": "approve" } }]`. Full history, client tool results, and mutable state need authorized `input.project` selection. This adapter is not a conversation database.

## Implementation example

```ts
import { createAgent, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { createAgentEventSourceAgUiReplay, createAgUiHandler } from "@arnilo/prism-ag-ui";

const agent = createAgent({
  model: { provider: "mock", model: "offline" },
  provider: createMockProvider([providerTextDelta("ready"), providerDone()]),
});

const replay = createAgentEventSourceAgUiReplay(persistence.events, {
  resolveRun,
  ownership: (authorization) => authorization.ownership,
});

const handle = createAgUiHandler({
  authorize: ({ request }) => request.headers.get("authorization") === "Bearer host-checked"
    ? { ownership: { userId: "user-1" } }
    : false,
  // Create a run-scoped agent/session using input.serverTools when mcp is enabled.
  sessionFactory: () => agent.createSession({ id: "host-owned-thread" }),
  replay,
  input: {
    project: () => ({
      messages: [{ id: "user", role: "user", content: [{ type: "text", text: "host-selected input" }] }],
    }),
  },
  projection: { toolArguments: () => undefined, toolResult: () => undefined },
});

const response = await handle(request); // adapt this Web Response in host framework
```

See runnable network-free [`examples/ag-ui-server.ts`](../examples/ag-ui-server.ts). For ACP, construct `createPrismAcpAgent({ authorize, sessionFactory, lifecycle })` and connect the returned stable SDK agent through the host's ACP transport.

## Extension and configuration notes

All identity, authorization, session/thread mapping, durable checkpoint lookup, persistence selection, replay cursor persistence, transport adaptation, MCP bridge/card configuration, app sandbox DOM, remote A2A task correlation, and optional projection are host-owned. The adapter owns no listener, database, background reconnect loop, credential resolver, or UI state.

`AgUiProjection` is an allow-list. Without a callback, raw tool arguments/results/progress, arbitrary state/patches/transcripts/activity/reasoning/raw events, paths, ACP locations/diffs/terminals/raw I/O, and frontend-supplied tools remain absent. Reasoning signatures do not become AG-UI encrypted values automatically: a host must explicitly provide an already client-encrypted opaque value. `input.project` is also an allow-list: do not merge client state/forwarded props into ownership, identity, tools, permissions, provider options, or media fetch policy.

Co-work projection reuses the same allow-list: `AgUiProjection.coWork(event)` may return a curated, JSON-serializable payload for a co-work event; absent it, the redacted event fields are exposed. Wire `coWorkContext` to derive thread/artifact/identity from the authorized request (never client JSON) and `coWork` to a `createCoWorkReplay()` over your durable artifact/draft/snapshot stores. The handler projects one bounded page after the run; mount a dedicated cursor-paged co-work endpoint when full pagination is needed.

## Security and performance notes

Authorize every start/replay/resume/proxy/follow. Treat protocol fields, MCP metadata/HTML, and A2A cards/parts as untrusted; persist run/task correlation before output and redact streams. MCP Apps requires extension acknowledgement, exact proxy origin, same-bridge visibility, approval, `ui://` HTML/MIME bounds, and sandbox CSP. It never retries UI mutations; Task 4 adds recovery.

Defaults / hard caps: request 64 KiB / 1 MiB; input 128 / 1024 messages, 32 / 256 tools/contexts, 8 / 64 interrupts, 16 / 64 media parts, and 64 KiB / 1 MiB text/state/media; frontend tool/context payloads 16 KiB / 256 KiB; projected event/state/activity/reasoning/raw values 64 KiB / 1 MiB; patches 128 / 4096 operations; JSON depth 16 / 64, properties 128 / 4096, arrays 512 / 8192; cursor 4 / 16 KiB; replay page 100 / 500 records; queue 128 / 4096 events; stream 10,000 / 100,000 events and 10 / 64 MiB; wall time 120 seconds / 30 minutes. Overflow yields a bounded error/closed stream, not an unbounded queue. SSE is declared; WebSocket/protobuf/push are not. Reconnect is at-least-once, so clients de-duplicate stable event/message/tool IDs.

## Related APIs

- [Agent/session runtime](agent-session-runtime.md): `session.stream()`, `resumeAgentRunStream()`, and durable lifecycle.
- [Agent events](agent-events.md): normalized source events and ledger redaction.
- [Runs and usage ledger](runs-and-usage.md): durable `AgentEventRecord` query source.
- [Web-standard server handler](server.md): generic Prism HTTP API, separate from AG-UI.
- [A2A interoperability](a2a.md): remote agent-to-agent tasks, not frontend protocol mapping.
- [AG-UI adoption evaluation](ag-ui-adoption.md): official 0.0.57 event/input matrix and shipped explicit MCP/MCP Apps/A2A handshakes.
- [MCP bridge/server](mcp-tools.md): `mcpApps` negotiation, bounded resources, and remote tool trust.
- [A2A interoperability](a2a.md): verified rich task client and remote task lifecycle.
- [Host security guide](host-security.md): authorization, ownership, redaction, and credential boundaries.
- [Work artifacts and review](work-artifacts-and-review.md): durable artifact service that produces the co-work approval/progress/download-link events projected here.
