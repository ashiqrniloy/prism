# AG-UI adoption evaluation

## What it does

This page records Prism's compatibility review against official AG-UI `@ag-ui/core` **0.0.57** and the official repository at commit [`a40b5c0`](https://github.com/ag-ui-protocol/ag-ui/commit/a40b5c0824564eb2f9ab9edf2be43f355f42a3b8). It separates shipped transport/replay support from remaining work needed to claim full AG-UI support, including AG-UI fronting MCP and A2A agents.

Official material reviewed:

- [Events](https://docs.ag-ui.com/concepts/events), [messages](https://docs.ag-ui.com/concepts/messages), [tools](https://docs.ag-ui.com/concepts/tools), [state](https://docs.ag-ui.com/concepts/state), [reasoning](https://docs.ag-ui.com/concepts/reasoning), [interrupts](https://docs.ag-ui.com/concepts/interrupts), [capabilities](https://docs.ag-ui.com/concepts/capabilities), [serialization](https://docs.ag-ui.com/concepts/serialization), [server quickstart](https://docs.ag-ui.com/quickstart/server), and [protocol architecture](https://docs.ag-ui.com/concepts/architecture).
- Official [MCP/A2A/AG-UI relationship](https://docs.ag-ui.com/agentic-protocols), [integrations](https://docs.ag-ui.com/integrations), [`@ag-ui/mcp-middleware`](https://github.com/ag-ui-protocol/ag-ui/tree/main/middlewares/mcp-middleware), [`@ag-ui/mcp-apps-middleware`](https://github.com/ag-ui-protocol/ag-ui/tree/main/middlewares/mcp-apps-middleware), [`@ag-ui/a2ui-middleware`](https://github.com/ag-ui-protocol/ag-ui/tree/main/middlewares/a2ui-middleware) (Prism ships an in-package opt-in painter with frozen caps; no runtime dependency), [`@ag-ui/a2a`](https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/a2a/typescript), and [`@ag-ui/a2a-middleware`](https://github.com/ag-ui-protocol/ag-ui/tree/main/middlewares/a2a-middleware).
- A2A [current specification](https://a2a-protocol.org/latest/specification/) and [streaming rules](https://a2a-protocol.org/latest/topics/streaming-and-async/).
- MCP Apps [SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp) and the [`io.modelcontextprotocol/ui` draft specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx).

## When to use it

Use this matrix when selecting Prism for an AG-UI client or planning protocol work. Tasks 3A and 3B complete full AG-UI 0.0.57 request/event compatibility plus explicit hardened MCP, MCP Apps, and remote A2A fronting. These are opt-in adapters over existing Prism clients, not an alternate runtime or discovery path.

## Inputs / request

Official `RunAgentInput` fields—lineage, all message roles/history, state, tools, context, props, media, and resume—are schema/bound checked then have no authority until `input.project` returns host-selected messages. Client tools remain client handoffs; state/props/media never grant identity, ownership, or server tools. Resume is exact `${runId}:${version}` CAS; edited arguments deny.

## Outputs / response / events

Prism emits current standard lifecycle, step, text, tool, state, messages, activity, reasoning, raw, and custom families when its mapper or an explicit projector can prove them. Deprecated `THINKING_*` and convenience chunk output are intentionally absent. SSE is baseline; capabilities truthfully narrow to configured replay/projectors/lifecycle, and source cursors remain bounded `prismCursor` metadata for reconnect.

## Request/response example

```json
{
  "type": "TEXT_MESSAGE_CONTENT",
  "messageId": "message-1",
  "delta": "hello",
  "prismEventId": "event-42",
  "prismCursor": "opaque-owner-run-bound-cursor"
}
```

## Implementation example

```ts
import { createAgentEventSourceAgUiReplay, createAgUiHandler } from "@arnilo/prism-ag-ui";

const replay = createAgentEventSourceAgUiReplay(persistence.events, {
  resolveRun: hostResolveProtocolRun,
  ownership: (authorization) => authorization.ownership,
});

const handle = createAgUiHandler({ authorize, sessionFactory, lifecycle, resolveRun, replay });
```

## Extension and configuration notes

### A2A adoption

A2A stays separately mounted. `createA2AAgentEventSource()` maps durable runs to task events; `afterEventId` remains Prism-only.

`createAgUiA2AAdapter({ client, select, correlate, projectPart })` fronts one verified host-selected client: task text/status becomes AG-UI text/activity, correlation persists before output, and non-text/tool/A2UI needs a schema-validated projector. It uses streaming when declared; fallback accepts only a terminal task. Client origin/card/auth/bounds/abort checks remain active.

### MCP adoption through AG-UI

Prism adapts its hardened MCP bridge; no official middleware or second runtime. `connectMcpTools({ mcpApps: true })` requires `io.modelcontextprotocol/ui` acknowledgement, retains nested UI metadata over deprecated flat metadata, hides app-only tools, and bounds linked `ui://` HTML through `bridge.apps`. `createAgUiMcpAdapter()` selects model-visible tools for normal core dispatch; `createAgUiMcpAppHandler()` reauthorizes one-bridge initialize/ping/logging/tool/resource calls with approval and visibility; sandbox helper returns fixed iframe/CSP constraints. No generic proxy, cross-server call, raw HTML rendering, or automatic mutation retry.

## Security and performance notes

- Every replay/reconnect reauthorizes, then source access uses exact host ownership and host-resolved internal run IDs. Cursor content never selects ownership.
- Durable streams are at-least-once. Clients deduplicate `prismEventId`; source cursors resume strictly after a durable record.
- Client tools, state, context, forwarded properties, media URLs/data, remote A2A parts, MCP metadata, HTML, iframe messages, and reasoning blobs are untrusted. Projectors must use existing Prism media URL/SSRF/MIME policy before any resolution.
- `input.project` and all output projectors are allow-lists; all generic JSON has byte/depth/property/array caps and prototype-pollution keys fail before host callbacks. Tool handoffs are client-only and cannot widen identity, ownership, permissions, or active server tools.
- MCP Apps requires sandbox-origin separation, restrictive CSP, declared-domain ceilings, audited JSON-RPC, app/tool visibility checks, and user approval for UI-initiated mutations. The shipped proxy does not retry those mutations; Task 4 adds generic durable effect recovery.

## Related APIs

- [Frontend interoperability](ag-ui.md): shipped Prism AG-UI/ACP API.
- [Agent events](agent-events.md): source events and durable delivery.
- [Web-standard server](server.md): SSE `Last-Event-ID` reconnect route.
- [A2A interoperability](a2a.md): separately mounted A2A lifecycle and durable source adapter.
- [MCP bridge/server](mcp-tools.md): hardened MCP transport and capability boundary reused by future AG-UI MCP support.
