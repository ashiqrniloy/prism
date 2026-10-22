# @arnilo/prism-ag-ui

Host library that serves a Prism `Agent` over AG-UI, plus the framework-free protocol adapters and a reference renderer. Import is inert: no network, listener, run, tool, state, filesystem, or editor capability starts or appears on import.

> Released in 0.0.12 as an event mapper; Phase 8 HITL/A2UI in 0.0.25. Phase 10 (plan 161) reshapes it into a host library over the public `Agent`/`Session` API and moves it to `packages/hosts/ag-ui`. Install it with the matching `@arnilo/prism` version.

## AG-UI

```ts
import { createAgUiHandler } from "@arnilo/prism-ag-ui";

const handle = createAgUiHandler(agent, { authorize: (req) => checkBearer(req) });
Bun.serve({ port: 8787, fetch: handle });
```

`createAgUiHandler(agent, options?)` returns a `(request: Request) => Promise<Response>` and a schema-validated `capabilities` snapshot:

- `threadId` selects the session: `agent.session({ id: threadId, create: true, ownership: authorization.ownership })`.
- The run streams `session.stream(messages, { ownership: authorization.ownership, interactive: false })` as bounded AG-UI SSE through `createAgUiEventMapper`.
- A suspended run ends in `RUN_FINISHED` with `outcome: { type: "interrupt", interrupts }`. Each interrupt stands for one pending decision and carries its `approvalId`, tool call id, tool name, and redacted reason in `metadata`.
- A later request resumes per `@ag-ui/core` `ResumeEntry`: `{ interruptId, status: "resolved" | "cancelled", payload? }`. `status: "cancelled"` is `reject_once`; a resolved payload is exactly `{ outcome: ApprovalOutcome }`. The batch becomes `session.resume(decisions, { ownership: authorization.ownership })` after opening `agent.session({ id: threadId, ownership: authorization.ownership })`.
- A client disconnect (or the request's `signal`) aborts the run through `session.abort()`.
- `authorize` is the per-request gate and defaults to **default-deny**: omit it, or return `false`, and the request is `403` before any session opens.

`allow_once` / `allow_for_run` / `reject_once` / `reject_for_run` map straight through to the kernel's `ApprovalOutcome`; the kernel re-validates every decision against the recorded pending set under CAS, so a foreign interrupt id, an unknown id, or a drifted agent fails closed before any tool runs.

Other root exports:

- `createAgUiEventMapper()` — ordered current AG-UI lifecycle/step/text/tool/state/activity/reasoning/raw/custom mapper through safe host projection.
- `createReasoningEncryptedValue()` — bounded `REASONING_ENCRYPTED_VALUE` fragment from a host-owned `encrypt` function; fails closed, never infers from reasoning signatures.
- `createPersistenceAgUiReplay()` / `createAgentEventSourceAgUiReplay()` / `createCoWorkReplay()` — ownership-scoped durable replay and co-work page adapters (host-wired; the handler only projects one bounded co-work page after the run when `coWork` is set).
- `createMessagesFromSessionProjection` / `createStateFromStoreProjection` / `createActivityFromToolProgressProjection` / `composeAgUiProjections` — standard projectors. `Awaitable<T>` hooks are awaited in event order, never `Promise.all`.
- `createAgUiMcpAdapter()` — host-selected reviewed Prism MCP tools for a host-assembled agent; linked Apps emit standard activity.
- `createAgUiMcpAppHandler()` / `createAgUiMcpAppSandbox()` — authenticated single-bridge Apps JSON-RPC proxy plus renderer sandbox/CSP config; never executes HTML.
- `@arnilo/prism-ag-ui/renderer` — framework-free reference renderer: `createA2UiRenderer({ stream, catalog?, limits?, onAction?, onError?, dom? })` consumes an AG-UI event stream and renders `a2ui-surface` snapshots/deltas into DOM surfaces from a host component catalog. DOM-free `reduceA2UiOps` core, thin DOM binding with default text/container catalog, server-side A2UI caps enforced client-side, fail-closed drops with bounded error events, unknown components render explicit placeholders, never executes remote HTML. Main entry stays runtime-agnostic.

Hosts supply authorization, redaction, safe projections, and replay correlation storage. Raw tool args/results/progress, state, activity, reasoning, and raw events stay absent unless a bounded projector returns safe data. Secrets never reach an SSE frame.

## ACP

ACP v1 serving lives in [`@arnilo/prism-acp`](../acp/README.md) (plan 161). `@arnilo/prism-ag-ui` no longer ships the `./acp` subpath: `serveAcp(agent, …)` and `acpHost()` serve any Prism `Agent`, and the ACP event mapper lives there too. See [docs/acp.md](../acp/README.md) for the released 0.12 contract.

## Cost, security, and failure behavior

- **Narrow-only session ownership:** `createAgUiHandler` passes `authorization.ownership` both when opening the session (`agent.session({ id: threadId, create, ownership: authorization.ownership })`) and on `session.stream` / `session.resume`. Both session opens happen before the SSE response starts.
- **Indistinguishable `404` on absent or foreign sessions:** `SessionNotFoundError` and `OwnershipScopeError` map to `404 ERR_PRISM_AG_UI_NOT_FOUND` (`{"error":{"code":"ERR_PRISM_AG_UI_NOT_FOUND","message":"Session not found"}}`) before the SSE stream opens, so a response never distinguishes an absent thread from another user's thread.
- **Scoped pending interrupts:** the handler's in-memory `pending` interrupt map records `authorization.ownership` alongside `threadId` and `approvalId`. A resume request from a different ownership scope is rejected before any session open as a foreign interrupt (`400 ERR_PRISM_AG_UI_INPUT`, matching a wrong `threadId`).
- **Thread-id squatting avoidance:** because `create: true` on a `threadId` already owned by another scope fails closed with `404 ERR_PRISM_AG_UI_NOT_FOUND`, multi-user hosts should generate `threadId` values on the server or namespace client-supplied ids by principal/scope (for example `${tenantId}:${userId}:${clientThreadId}`).

## Limits and security

Defaults / hard: request/event/state/activity/reasoning/raw 64 KiB / 1 MiB; input 128 / 1024 messages, 32 / 256 tools/contexts, 8 / 64 interrupts, 16 / 64 media parts; patches 128 / 4096 operations; JSON depth 16 / 64, properties 128 / 4096, arrays 512 / 8192; replay 100 / 500 records; queue 128 / 4096 events; stream 10,000 / 100,000 events and 10 / 64 MiB; request wall time 120 seconds / 30 minutes. SSE only; WebSocket/protobuf/push stay undeclared. Overflow closes with a bounded error. Resume decisions are bounded to 128 entries, 8 KiB reasons, and 64 KiB payloads before the kernel re-validates them.

Run the demos with `bun examples/ag-ui-server.ts` (approval interrupt/resume), `bun examples/ag-ui-a2ui.ts` (A2UI painting), and `bun examples/ag-ui-mcp-apps.ts` (MCP Apps proxy).
