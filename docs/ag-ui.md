# Frontend interoperability (AG-UI and ACP)

## What it does

`@arnilo/prism-ag-ui` is an optional, framework-free protocol adapter over Prism's existing redacted `AgentEvent`, session, durable-run, and persistence seams.

- Root export maps Prism events to AG-UI `@ag-ui/core` **0.0.57** events and offers `createAgUiHandler()` (`Request` → SSE `Response`), compatible `createPersistenceAgUiReplay()` pages, distributed `createAgentEventSourceAgUiReplay()` follow, and explicit `createAgUiMcpAdapter()` / `createAgUiMcpAppHandler()` / `createAgUiA2AAdapter()` protocol handshakes.
- `@arnilo/prism-ag-ui/acp` is the stable ACP **v1** sibling: `createAcpEventMapper()` and `createPrismAcpAgent()` over `@agentclientprotocol/sdk` **1.3.0** root exports. ACP is a protocol adapter — sessions, modes, MCP, fs/terminal, lifecycle mapping, and caps live on the host seams. See [ACP coding-host interop](acp.md) for the full reference; this page covers AG-UI only.
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
| `projection` | Explicit safe tool/state/messages/activity/reasoning/raw/custom/interrupt projection. Omit each callback for default deny. Prefer `composeAgUiProjections(createMessagesFromSessionProjection(...), createStateFromStoreProjection(...), createActivityFromToolProgressProjection(), host)` for standard families. |
| `a2ui` | Opt-in A2UI painting middleware (`{ catalogId, mode, renderToolName?, allowedCatalogIds?, limits? }`). Detects `a2ui_operations` tool results and/or streams from `render_a2ui` args; paints `a2ui-surface` activity events. Absent = inert. |
| `capabilities` | Optional host declaration narrowed to implemented SSE/projector/lifecycle features; read `handler.capabilities`. |
| `redactor`, `limits` | Host redaction and narrowing-only finite caps. |

The handler accepts only `POST` JSON validated with official AG-UI `RunAgentInputSchema`. Every aggregate is bounded before a callback runs. With no `input.project`, it preserves compatibility: final text user message only; non-empty state or frontend tools fail before authorization/session lookup. With a projector, all current roles/history, context, state, forwarded props, multimodal parts, parent lineage, and tool-result continuations are available as untrusted input. The projector must apply Prism media URL/SSRF/MIME policy before forwarding media. Start a run with no `resume` and no `?cursor=`; replay supplies `?cursor=`.

## Outputs / response / events

The handler returns `text/event-stream`, one `data: <AG-UI event>\n\n` frame per output. Mapper lifecycle is ordered: `RUN_*`, `STEP_*`, `TEXT_MESSAGE_*`, and `TOOL_CALL_*` are deterministic Prism mappings. Host projectors may additionally prove and emit `STATE_SNAPSHOT`/`STATE_DELTA`, `MESSAGES_SNAPSHOT`, `ACTIVITY_*`, current `REASONING_*`, `RAW`, and named `CUSTOM` values. All values revalidate against official `EventSchemas`; deprecated `THINKING_*` and convenience chunk events are not produced. Active message/tool/reasoning/step sequences close before error, interruption, or finish.

A Prism durable `agent_suspended` returns `RUN_FINISHED` with core interrupt id `${runId}:${version}` and a strict `{ decision: "approve" | "deny" }` schema. `projection.interrupt` may attach bounded expiry/metadata or additional host policy interrupts but must retain that core id. Without `interrupts.resume`, one exact entry is required; `cancelled` means deny. An aggregate policy may validate bounded multiple entries, then returns one current-version core decision. Payloads containing `editedArgs`/`args` always deny: Prism does not mutate persisted tool calls. The adapter checks host authorization, selected run, suspended status, and checkpoint version, then calls `AgentRunLifecycle.resumeStream()` once. Claimed/dispatched tools are never replayed.

`createPersistenceAgUiReplay()` remains a compatible page adapter. `createAgentEventSourceAgUiReplay()` resolves exact ownership/run once per open, then consumes the shared durable source through terminal or live follow; it never attaches replica-local `session.subscribe()`. Every record must already be redacted. Mapped events carry stable `prismEventId` and bounded opaque `prismCursor`; records with no standard mapping emit `CUSTOM prism.replay_cursor`, so clients can persist progress. Terminal replay never creates a session or reruns a provider/tool.

ACP maps assistant text to `agent_message_chunk`, safe tool lifecycle to `tool_call`/`tool_call_update` (locations/diffs only from projection allow-lists), provider usage to `usage_update`, and durable suspension to `session/request_permission` with the four shared outcomes — plus, per the client's advertised capabilities, editor-buffer fs, terminal, prompt media, modes/config options, lifecycle events, and elicitation. Advertisement is a pure function of the wired seams: no seam, no capability, no method. Only `allow_once` approves; reject, cancellation, unknown outcomes, and request failure deny. See [ACP coding-host interop](acp.md).

Selected MCP tools use normal `TOOL_CALL_*` core dispatch. Linked Apps add safe `mcp-apps` activity; app-only tools stay model-hidden. The separate reauthorizing Apps proxy allow-lists initialize/ping/logging/tool/resource calls for one bridge; its sandbox helper returns CSP/iframe config and never executes HTML.

### UI-initiated mutation retry through `ToolEffectStore` (FR-4)

`createAgUiMcpAppHandler` accepts an optional `effectStore` (Phase 7 `ToolEffectStore`) plus `effectContext` (identity/ownership; falls back to `authorization.ownership` + `context.identity`). Every approved `tools/call` then records `begin` → `markDispatched` → `complete`/`fail`/`markUnknown` in the store; effect keys derive from identity + ownership + tool name + arguments hash (`deriveAppEffectKey`). The proxy **never auto-retries** — the host decides:

```ts
import { createAgUiMcpAppHandler, reconcileAppEffect } from "@arnilo/prism-ag-ui";

const handler = createAgUiMcpAppHandler({
  apps, authorize, context, approveToolCall, allowedOrigins,
  effectStore, // optional: records UI mutations for idempotent retry
  effectContext: ({ authorization, context }) => ({ identity: context.identity, ownership: authorization.ownership }),
});

// After transport/abort loss the record is `unknown`; the host verifies the
// actual outcome and resolves it (claim/CAS), then the UI can retry idempotently:
await reconcileAppEffect({ effectStore, identity, ownership, sessionId, runId, toolName, arguments: args, outcome: "completed", result });
```

A retried call whose record is `completed` replays the recorded result without re-dispatching; `failed_retryable`/`failed_terminal`/`dispatched`/`unknown` records fail closed with a `409` until the host reconciles. Wrong-owner or unresolvable identity/ownership fails closed; absent `effectStore` keeps 0.0.25 behavior exactly.

`createAgUiA2AAdapter()` maps verified task text/activity. Non-text/tool/A2UI parts need host `projectPart`; non-streaming fallback accepts only a terminal task, otherwise host follows saved correlation. `createAgUiA2AServer()` fronts a local AG-UI agent as an A2A 1.0 server for remote A2A clients (reverse direction; see [A2A interoperability](a2a.md)).

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

See runnable network-free [`examples/ag-ui-server.ts`](../examples/ag-ui-server.ts). For ACP, construct `createPrismAcpAgent({ authorize, sessionFactory, lifecycle, ...seams })` and connect the returned stable SDK agent through the host's ACP transport — see [`examples/acp-coding-host.ts`](../examples/acp-coding-host.ts) and [ACP coding-host interop](acp.md).

## Extension and configuration notes

All identity, authorization, session/thread mapping, durable checkpoint lookup, persistence selection, replay cursor persistence, transport adaptation, MCP bridge/card configuration, app sandbox DOM, remote A2A task correlation, and optional projection are host-owned. The adapter owns no listener, database, background reconnect loop, credential resolver, or UI state.

`AgUiProjection` is an allow-list. Without a callback, raw tool arguments/results/progress, arbitrary state/patches/transcripts/activity/reasoning/raw events, paths, ACP locations/diffs/terminals/raw I/O, and frontend-supplied tools remain absent. Reasoning signatures do not become AG-UI encrypted values automatically: a host must explicitly provide an already client-encrypted opaque value. `input.project` is also an allow-list: do not merge client state/forwarded props into ownership, identity, tools, permissions, provider options, or media fetch policy.

### Reasoning encrypted-value helper (FR-3)

`createReasoningEncryptedValue({ encrypt, content, event, maxBytes? })` produces the `encryptedValue` fragment for the `reasoning` projection callback (AG-UI `REASONING_ENCRYPTED_VALUE`):

```ts
import { createReasoningEncryptedValue } from "@arnilo/prism-ag-ui";

const mapper = createAgUiEventMapper({
  projection: {
    reasoning: (content, event) =>
      createReasoningEncryptedValue({ encrypt: hostEncryptForClient, content, event }),
  },
});
```

`encrypt` is host-owned (client key) and receives the redacted `ThinkingContent` and the Prism event; return `undefined` to decline. The helper is synchronous and pure like the other projection callbacks: it never infers an encrypted value from a Prism reasoning signature, fails closed (returns `undefined`) when `encrypt` is missing, throws, or returns a non-string, and truncates output to `maxBytes` (default `DEFAULT_MAX_REASONING_BYTES`, clamped to `HARD_MAX_REASONING_BYTES`). The mapper additionally caps the emitted value at the resolved `maxReasoningBytes` limit.

Co-work projection reuses the same allow-list: `AgUiProjection.coWork(event)` may return a curated, JSON-serializable payload for a co-work event; absent it, the redacted event fields are exposed. Wire `coWorkContext` to derive thread/artifact/identity from the authorized request (never client JSON) and `coWork` to a `createCoWorkReplay()` over your durable artifact/draft/snapshot stores. The handler projects one bounded page after the run; mount a dedicated cursor-paged co-work endpoint when full pagination is needed.

Durable interrupts carry the shared decision batch: the fallback interrupt includes the redacted `pendingDecisions` under `metadata` and its `responseSchema` accepts either the legacy `{ decision: "approve" | "deny" }` or a `{ decisions: [{ approvalId, outcome, reason?, modifiedArguments?, elicitation? }] }` batch. All batch entries are shape- and cap-validated at the boundary (count ≤ 128, ids ≤ 128 chars, four outcomes, reason ≤ 8 KiB, payloads ≤ 64 KiB) and core re-validates each against the recorded pending set under the single CAS. `interrupts.resume` may return the batch form (`{ decisions, expectedVersion? }`); legacy `editedArgs` resume payloads still deny. ACP permission prompts offer the four outcomes (`allow_once` / `allow_always` / `reject_once` / `reject_always`) and map them onto the batch; a cancelled prompt stays deny-closed.

### Standard projectors (opt-in)

Three batteries-included factories return `AgUiProjection` fragments. Compose with host projectors via `composeAgUiProjections(...fragments)` — **first defined callback wins** (left to right); `undefined` fragments are skipped. Absent factories keep 0.0.24 default-deny.

```ts
createAgUiHandler({
  projection: composeAgUiProjections(
    // async transcript source: AgentSession.entries() is async
    createMessagesFromSessionProjection({
      getMessages: async () => (await session.entries()).map(entryToAgUiMessage),
      redact,
    }),
    createStateFromStoreProjection(runStateStore),
    createActivityFromToolProgressProjection(),
    hostCustom,
  ),
});
```

Every `AgUiProjection` callback may return a promise (types are `Awaitable<T>` — Task 15, 0.0.26), so projectors can call async host APIs like `session.entries()` directly. Sync-only hosts keep exact prior behavior: sync return values short-circuit, hooks are awaited strictly in event order (never `Promise.all`), and a rejected hook fails closed per event (omitted value, stream continues) exactly like today's sync throw handling. `createMessagesFromSessionProjection({ getMessages })` accepts an async transcript source and emits `MESSAGES_SNAPSHOT` from it at `agent_started` and `message_finished` (no sync `getMessages` needed for full session history); `agent_finished` is terminal and the mapper projects nothing after it, so the final snapshot arrives at the last `message_finished`.

| Factory | Emits | Notes |
| --- | --- | --- |
| `createMessagesFromSessionProjection` | `MESSAGES_SNAPSHOT` | Host `getMessages()` for authorized history (sync or async), or live `message_finished` accumulation. Caps 128/1024. Redact drops closed. |
| `createStateFromStoreProjection(store)` | `STATE_SNAPSHOT` on `agent_started`; RFC 6902 `STATE_DELTA` (add/replace/remove) when `store.get()` changes | Host store; optional `subscribe` only marks dirty — no Prism watcher. Oversized/throw → drop closed. |
| `createActivityFromToolProgressProjection` | `ACTIVITY_SNAPSHOT` / `ACTIVITY_DELTA` from `tool_execution_progress` | Default `activityType: "tool-progress"`. Missing progress+metadata → drop closed. |

### A2UI painting middleware (opt-in)

`createAgUiHandler({ a2ui: { catalogId, mode } })` paints A2UI v0.9 surfaces without a host `projection.activity` callback:

| Mode | Source | Paint |
| --- | --- | --- |
| `fixed-schema` | Tool result `{ a2ui_operations: [...] }` | First batch with `createSurface` → `ACTIVITY_SNAPSHOT` (`activityType: "a2ui-surface"`); later batches → `ACTIVITY_DELTA` |
| `streaming` | `tool_call_delta` args of `renderToolName` (default `render_a2ui`) | Progressive `ACTIVITY_SNAPSHOT` with `replace: true` only when complete ops extractable — never partial JSON |
| `both` | Both paths; streamed surfaces are not re-painted from the final envelope |

Host `catalogId` is stamped when absent; model-supplied ids outside `allowedCatalogIds` (default `[catalogId]`) are overwritten. Invalid ops emit one bounded `CUSTOM` event `prism.a2ui.error` and paint nothing. Caps: 64/512 ops per message, 64 KiB/1 MiB per op, 16/64 surfaces per run, depth 32/64.

User actions arrive as untrusted `AgUiA2UiAction` values on `input.project({ a2uiActions })` (from `forwardedProps.a2uiAction` or activity/tool-result shapes). Without `input.project` they stay default-deny — Prism never synthesizes a `log_a2ui_event` tool call (documented divergence from official `@ag-ui/a2ui-middleware`). Example: `examples/ag-ui-a2ui.ts`.

### Reference frontend renderer (Task 14, 0.0.26)

`@arnilo/prism-ag-ui/renderer` ships a framework-free client renderer for AG-UI/A2UI surfaces: it consumes an AG-UI event stream (SSE via `@ag-ui/client`, or any `AsyncIterable`) and renders `a2ui-surface` activity snapshots/deltas into DOM surfaces from a host component catalog. No framework dependency, no host build step, no jsdom (tests use an in-memory DOM stub).

```ts
import { createA2UiRenderer } from "@arnilo/prism-ag-ui/renderer";

const renderer = createA2UiRenderer({
  stream: agUiEventStream,        // SSE or AsyncIterable of AGUIEvent
  catalog: myComponents,          // optional; defaults to Text/Container/Column/Row/Button
  onAction: (action) => sendA2UiAction(action), // optional: Button clicks etc.
  onError: (error) => console.warn(error.code, error.message),
});
const surface = await renderer.surface("chat"); // detached DOM node, kept in sync
```

The core is a DOM-free state machine (`reduceA2UiOps`): operations become a surface/component model (adjacency list with `id`/`component`/flat props, A2UI v0.9 JSON-Pointer data model, `deleteSurface`); a thin binding layer renders the model through catalog component renderers (framework-free `(props, ctx, dom) => node` functions). The core is also exported as values from the subpath entry (`A2UiSurfaceState`, `reduceA2UiOps`, `readA2UiBatch`, `resolvePointer`, `A2UI_VERSION`, 0.0.27, Synapta FR) so framework hosts can drive the validated surface state machine and own the view layer; behavior and frozen caps are unchanged. Snapshots replace a surface's model (streaming mode sends cumulative ops); RFC 6902 deltas append. The same frozen caps as the server painter are enforced client-side: 64/512 ops per message, 64 KiB/1 MiB per op, 16/64 surfaces per run, depth 32/64. Invalid or oversized ops drop closed with one bounded `prism.a2ui.error` event (host logging via `onError`); unknown catalog components render an explicit placeholder. The renderer never executes remote HTML: only `createElement`/`createTextNode`/`appendChild`, no HTML-string assignment, no dynamic code evaluation. Data bindings `{"path": "/pointer"}` resolve against the per-surface data model; `deleteSurface` detaches content. The main `@arnilo/prism-ag-ui` entry stays runtime-agnostic — DOM code lives only behind the `renderer` subpath (the root entry re-exports renderer types only, no values). Hosts embedding it should follow the MCP Apps CSP/sandbox guidance (`docs/ag-ui-adoption.md`) for iframe/worker placement.

## Security and performance notes

Authorize every start/replay/resume/proxy/follow. Treat protocol fields, MCP metadata/HTML, and A2A cards/parts as untrusted; persist run/task correlation before output and redact streams. MCP Apps requires extension acknowledgement, exact proxy origin, same-bridge visibility, approval, `ui://` HTML/MIME bounds, and sandbox CSP. It never retries UI mutations; with an `effectStore` it records them for host-driven idempotent retry and unknown-outcome reconciliation (FR-4).

Defaults / hard caps: request 64 KiB / 1 MiB; input 128 / 1024 messages, 32 / 256 tools/contexts, 8 / 64 interrupts, 16 / 64 media parts, and 64 KiB / 1 MiB text/state/media; frontend tool/context payloads 16 KiB / 256 KiB; projected event/state/activity/reasoning/raw values 64 KiB / 1 MiB; patches 128 / 4096 operations; JSON depth 16 / 64, properties 128 / 4096, arrays 512 / 8192; cursor 4 / 16 KiB; replay page 100 / 500 records; queue 128 / 4096 events; stream 10,000 / 100,000 events and 10 / 64 MiB; wall time 120 seconds / 30 minutes. Overflow yields a bounded error/closed stream, not an unbounded queue. SSE is declared; WebSocket/protobuf/push are not. Reconnect is at-least-once, so clients de-duplicate stable event/message/tool IDs.

## Related APIs

- [Agent/session runtime](agent-session-runtime.md): `session.stream()`, `resumeAgentRunStream()`, and durable lifecycle.
- [Agent events](agent-events.md): normalized source events and ledger redaction.
- [Runs and usage ledger](runs-and-usage.md): durable `AgentEventRecord` query source.
- [Web-standard server handler](server.md): generic Prism HTTP API, separate from AG-UI.
- [A2A interoperability](a2a.md): remote agent-to-agent tasks, not frontend protocol mapping.
- [AG-UI adoption evaluation](ag-ui-adoption.md): official 0.0.57 event/input matrix and shipped explicit MCP/MCP Apps/A2A handshakes.
- [ACP coding-host interop](acp.md): the full ACP reference — seam-based capability advertisement, session modes/config, MCP select, fs/terminal adapters, lifecycle mapping, elicitation, and caps.
- [MCP bridge/server](mcp-tools.md): `mcpApps` negotiation, bounded resources, and remote tool trust.
- [A2A interoperability](a2a.md): verified rich task client and remote task lifecycle.
- [Host security guide](host-security.md): authorization, ownership, redaction, and credential boundaries.
- [Work artifacts and review](work-artifacts-and-review.md): durable artifact service that produces the co-work approval/progress/download-link events projected here.
