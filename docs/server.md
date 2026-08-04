# Web-standard server handler

## What it does

`@arnilo/prism-server` exposes explicitly selected agents and workflows through one framework-free `(Request) => Promise<Response>` handler. It supports direct agent results, bounded agent/workflow SSE, cross-replica durable agent-event reconnect, opt-in durable agent status/resume, durable workflow start/enqueue/status/cancel/resume/replay, ownership-scoped schedules, host authorization, ownership propagation, redaction, resource ceilings, and optional deployment seams (health/readiness, drain, host rate-limit adapter, ownership-scoped event replay, worker/coordinator lease election).

No listener starts on import. Empty `agents`/`workflows` maps expose nothing. Authentication, authorization, route selection, durable stores, TLS, distributed rate limiting, queues, and framework/serverless adaptation remain host-owned.

## When to use it

Use it when a Node 20, serverless, worker, or framework host already speaks Web `Request`/`Response` and needs a small Prism API boundary. Wrap it in the platform's native adapter rather than adding Express, Fastify, Hono, Koa, Nest, or Next to Prism.

Use `AgentSession` or workflow APIs directly for in-process applications. Do not treat this package as an auth provider, user database, firewall, durable agent-result store, or public listener.

## Inputs / request

```ts
const drain = createPrismDrainController({ deadlineMs: 30_000 });
const handler = createPrismHandler({
  agents?: Record<string, Agent | PrismAgentExposure>, // exposure may include events + resolveRun
  agentRuns?: Record<string, PrismAgentRunExposure>, // explicit durable status/resume only
  workflows?: Record<string, PrismWorkflowExposure>,
  schedules?: WorkflowSchedules | ((authorization, signal) => WorkflowSchedules),
  authorize: async ({ request, operation, capabilityId }) => false | {
    ownership: { tenantId?: string; accountId?: string; userId?: string },
    identity?: AgentIdentity, // optional host-verified; must match ownership
    metadata?: Record<string, unknown>,
  },
  drain?, // blocks admit ops with 503 while draining
  rateLimit?, // host adapter after authorize, before session/run create
  basePath?: "/prism",
  allowedHosts?: string[],
  allowedOrigins?: string[],
  redactor?: SecretRedactor,
  limits?: PrismServerLimits,
  disconnectAborts?: boolean,
});
const health = createPrismHealthHandler({ ready: () => store.ping(), drain });
```

At least one non-empty ownership field must come from `authorize()`. Request JSON never chooses ownership.

| Method and route | Authorization operation | Body |
| --- | --- | --- |
| `POST /prism/agents/:id/runs` | `agent.run` | `{ "input": string | Message | Message[] }` |
| `POST /prism/agents/:id/stream` | `agent.stream` | same; SSE response |
| `GET /prism/agents/:id/runs/:runId` | `agent.status` | none; redacted public state/version only |
| `POST /prism/agents/:id/runs/:runId/resume` | `agent.resume` | `{ "decision": "approve" | "deny", "expectedVersion": number }` |
| `GET /prism/agents/:id/runs/:runId/events?cursor=` | `agent.events` | none; durable SSE, also accepts `Last-Event-ID` |
| `POST /prism/workflows/:id/runs` | `workflow.run` | `{ "input": unknown, "runId"?: string }` |
| `POST /prism/workflows/:id/stream` | `workflow.stream` | same; SSE response |
| `POST /prism/workflows/:id/enqueue` | `workflow.enqueue` | `{ "input": unknown, "runId"?: string }`; returns `202` queued handle |
| `GET /prism/workflows/:id/runs/:runId` | `workflow.status` | none |
| `DELETE /prism/workflows/:id/runs/:runId` | `workflow.cancel` | none |
| `POST /prism/workflows/:id/runs/:runId/resume` | `workflow.resume` | `{ "decision": "approve" | "deny", "input"?: unknown, "expectedVersion": number }` |
| `POST /prism/workflows/:id/runs/:runId/replay` | `workflow.replay` | `{ "fromNodeId": string, "runId"?: string }` |
| `POST /prism/schedules/:id` | `schedule.create` | `{ "workflowId", "nextRunAt", "input"?, "intervalMs"?, "calculatorId"?, "paused"?, "metadata"? }` |
| `GET /prism/schedules?status=&cursor=&limit=` | `schedule.list` | none |
| `POST /prism/schedules/:id/pause` | `schedule.pause` | `{}` |
| `POST /prism/schedules/:id/resume` | `schedule.resume` | `{ "nextRunAt"?: string }` |
| `POST /prism/schedules/:id/trigger` | `schedule.trigger` | `{ "idempotencyKey": string }` |
| `DELETE /prism/schedules/:id` | `schedule.delete` | none |

POST routes require `Content-Type: application/json`. Capability/run IDs are bounded URL-safe identifiers. A custom `PrismAgentExposure.sessionFactory` can build sessions from authorized host context; otherwise an `Agent` creates a fresh session.

## Outputs / response / events

Direct routes return bounded JSON. New-run stream routes return `text/event-stream`; every event is one `data: <AgentEvent|WorkflowEvent>` frame. Durable event reconnect frames add `id: <opaque source cursor>` before `data: <AgentEvent>` and resume strictly after either matching `?cursor=` or `Last-Event-ID`. Conflicting header/query cursors fail before source access. Status returns the ownership-scoped durable checkpoint record. Resume uses Phase 8 expected-version CAS. Cancel aborts active work or marks eligible durable checkpoints aborted.

Errors use `{ "error": { "code", "message" } }`. Unknown routes/capabilities are `404`, authorization/policy denial `403`, malformed input `400`, unsupported content type `415`, body overflow `413`, concurrency overflow `429`, and result overflow `507`. Unexpected errors are generic and never include stacks.

## Request/response example

```json
{
  "request": { "method": "POST", "path": "/prism/agents/support/runs", "body": { "input": "Summarize this" } },
  "response": { "status": "succeeded", "sessionId": "...", "runId": "...", "text": "Summary" }
}
```

## Implementation example

```ts
import { createAgent, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { createPrismHandler } from "@arnilo/prism-server";

const agent = createAgent({
  model: { provider: "mock", model: "offline" },
  provider: createMockProvider([providerTextDelta("ready"), providerDone()]),
});

const handler = createPrismHandler({
  agents: { support: agent },
  authorize: async ({ request }) => request.headers.get("authorization") === "Bearer host-validated"
    ? { ownership: { tenantId: "tenant-1", userId: "user-1" } }
    : false,
  allowedHosts: ["api.example.test"],
  allowedOrigins: ["https://app.example.test"],
});

// Cloudflare/Bun/Deno-style: export { handler as fetch }.
// Node/framework hosts adapt their request to Web Request and return Web Response.
```

## Extension and configuration notes

- `basePath` defaults to `/prism`; URL root exposure is rejected.
- Agent maps and workflow maps are immutable host selections. No registry/package discovery runs.
- Workflow exposure requires its existing `WorkflowCheckpointAdapter`; no server-owned database exists.
- Schedule exposure is optional and may be one service or an authorization-selected resolver. Returned service ownership must exactly match authorized tenant/account/user scope; otherwise request is forbidden.
- `PrismWorkflowExposure.runOptions` can supply agent/tool/policy/resume-validator wiring. Server-owned ownership, signal, checkpoint, redactor, run ID, and event bus fields cannot be overridden.
- Host/origin checks and CORS headers activate only when their allow-lists are configured. Hosts still own reverse-proxy trust and canonical host handling.

Default/hard ceilings:

| Limit | Default | Hard cap |
| --- | ---: | ---: |
| JSON request | 64 KiB | 1 MiB |
| direct response | 1 MiB | 8 MiB |
| SSE event | 64 KiB | 1 MiB |
| SSE total | 10 MiB | 64 MiB |
| SSE event count | 10,000 | 100,000 |
| concurrent runs | 16 | 256 |
| subscriber queue | 128 | 4,096 |
| request/run timeout | 120 s | 30 min |
| health response | 4 KiB | 64 KiB |
| drain admit cutoff | 30 s | 5 min |
| replay page / cursor | 100 / 4 KiB | 500 / 16 KiB |

## Deployment seams (optional)

Compose beside `createPrismHandler` — Prism starts no listener, container orchestrator, or queue worker.

| Helper | Role |
| --- | --- |
| `createPrismHealthHandler` | `GET /health`, `/livez`, `/readyz`. Minimal JSON; `?detail=1` requires `authorizeDetail`. No secrets/tenant payloads by default. Ready fails while draining. |
| `createPrismDrainController` | `beginDrain()` rejects admit ops (`agent.run`/`stream`/`resume`, workflow run/stream/enqueue/resume/replay, schedule create/trigger) with `503 ERR_PRISM_SERVER_DRAINING`. Status/cancel/list stay open. |
| `rateLimit` on handler | Host adapter after authorize, before session create. Return denial `{ retryAfterMs, code, message }` → `429` + optional `Retry-After`. `createMemoryRateLimiter` is single-process only. |
| `createPrismAgentEventReplay` | Shared `AgentEventSource` page/follow semantics for exact-owned runs. |
| `createPrismEventReplay` / `createPrismReplayHandler` | Compatible ownership-scoped legacy `queryEvents` pages (`redacted: true`). Does not re-run work. Unauthorized replay denies. |
| `createPrismDeploymentLease` | Lease election under `prism.server.deployment`. Coordinator replica holds `key: "coordinator"` before schedule ticks; workers run `@arnilo/prism-workflows` `createWorkflowCoordinator` for queued runs (fencing tokens). |
| `createConversationService` / `createConversationHandler` | Durable user-scoped conversation threads (create/list/continue/branch/archive/export/delete) over session + event-ledger seams, with thread-bound reconnectable replay. Mounts beside the handler; see [Conversations](conversations.md). |
| `createArtifactService` / `createArtifactHandler` | Durable artifact co-work review (attach/revise/compare/approve/reject/last-validated/delivery-link + authorized download) over the versioned checkpoint store; records persist metadata/revisions/approvals only, never file bodies. Mounts beside the handler; see [Work artifacts and review](work-artifacts-and-review.md). |

**Queues:** Redis/SQS/other adapters are absent. Postgres checkpoint polling via `createWorkflowCoordinator` remains the default background path until a measured polling/load justification is recorded.

Network-free demo: [`examples/server-deployment-seams.ts`](../examples/server-deployment-seams.ts).

## Security and performance notes

- `authorize()` is required and runs for every matched operation before capability lookup or body execution. Return `false` on missing/invalid credentials. Do not trust caller ownership fields.
- Optional `authorization.identity` must be host-verified (`AgentIdentity.verified`); the handler asserts activity and ownership match, then forwards identity into agent runs. Caller-asserted identity without a host verifier is rejected.
- Use authorization metadata only for non-secret audit context. Never put credentials in metadata, input, route IDs, run IDs, checkpoints, events, or responses.
- Configure `SecretRedactor` before runs. Redaction matches known secrets; it is not DLP.
- Agent tools and workflow tool nodes still need their own `PermissionPolicy`, `ToolValidator`, and `ExecutionPolicy`. HTTP authorization does not replace side-effect policy.
- Host and origin allow-lists are exact string matches. Configure reverse-proxy normalization, TLS, IP policy, CSRF/cookie policy, and authentication outside Prism. Optional `rateLimit` is an attributable short-circuit only — not a WAF.
- Health endpoints reveal process/liveness only by default; detail flags require host authorize and must omit secrets/tenant dumps.
- Drain and event replay require the same ownership/authorize boundary as other routes; replay never invokes providers or tools. Durable event routes exist only on object `PrismAgentExposure` entries with both `events` and `resolveRun`; every reconnect authorizes again, resolves public run ID to exact internal session/run IDs, and opens the shared source without `sessionFactory`.
- SSE uses bounded upstream subscriber queues. Consumer cancellation aborts owned work by default and releases concurrency; set `disconnectAborts: false` only when the host deliberately owns background completion.
- Source inputs/resource URLs remain host responsibilities and use existing resource/media SSRF policies. Server package does not fetch URLs.
- Schedule routes never accept ownership from JSON. Services carry mandatory ownership and explicit workflow/calculator registries; route authorization cannot broaden either. Replay applies workflow ownership/hash/approval checks.
- Agent status/resume routes exist only for keys in `agentRuns`. Supply one core `createAgentRunLifecycle({ checkpoints, resolveAgent })` capability per selected agent; its resolver returns current `{ agent, definitionRevision }`. It reuses core checkpoint parsing/CAS/fingerprint checks, returns only public state/version, and needs a durable `SessionStore` as well as checkpoints for restart-safe resume. Empty/default configuration adds no agent lifecycle route, polling, or server cache.

A2A routes are not added to `createPrismHandler()`. Install `@arnilo/prism-supervisor` and explicitly mount `createA2AHandler()` when protocol interoperability is required; this keeps cards and remote invoke absent from ordinary Prism servers.

## Related APIs

- [Agent identity](agent-identity.md): optional verified identity on authorize results.
- [Performance](performance.md): capacity notes for concurrent runs and deployment probes.
- [Agent/session runtime](agent-session-runtime.md): direct result and event stream semantics.
- [Workflows](workflows.md): durable checkpoints, status, cancellation, exact-once resume, and `createWorkflowCoordinator` workers.
- [MCP client and server exposure](mcp-tools.md): selected MCP capabilities and web-standard MCP transport.
- [Host security guide](host-security.md): remote-boundary checklist.
- [A2A interoperability](a2a.md): separately mounted A2A 1.0 handler/client.
- [Conversations](conversations.md): durable user-scoped conversation service, replay, branches, export, deletion.
- [Work artifacts and review](work-artifacts-and-review.md): durable artifact review service, revisions, approvals, authorized expiring delivery links.
- [Frontend interoperability (AG-UI and ACP)](ag-ui.md): separately installed authorized AG-UI Web handler.
- [AG-UI adoption evaluation](ag-ui-adoption.md): official 0.0.57 support matrix and MCP/A2A follow-up scope.
- [Release and install](release-and-install.md): optional package installation and profiles.
