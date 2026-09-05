# Web-standard server handler

## What it does

`@arnilo/prism-core/runtime/server` exposes explicitly selected agents and workflows through one framework-free `(Request) => Promise<Response>` handler. It supports direct agent results, bounded agent/workflow SSE, cross-replica durable agent-event reconnect, opt-in durable agent status/resume, durable workflow start/enqueue/status/cancel/resume/replay, ownership-scoped schedules, host authorization, ownership propagation, redaction, resource ceilings, and optional deployment seams (health/readiness, drain, host rate-limit adapter, ownership-scoped event replay, worker/coordinator lease election).

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
import { createPrismHandler } from "@arnilo/prism-core/runtime/server";

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
- The agent resume endpoint (`/prism/agents/{id}/runs/{runId}/resume`) accepts `{ decision: "approve" | "deny" }` or `{ decisions: [{ approvalId, outcome, reason?, modifiedArguments?, elicitation? }] }` next to `expectedVersion` — exactly one of `decision`/`decisions`. Entries are validated at the boundary (count ≤ 128, four outcomes, bounded reason/payloads) and core applies them atomically under the run's CAS; unknown ids, stale versions, and malformed batches fail closed without touching the run.
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

## Outbound webhooks

### What it does

`createWebhookNotifier()` posts selected terminal agent/workflow events to host-registered HTTPS endpoints. Every JSON envelope is redacted before HMAC-SHA-256 signing; `X-Prism-Signature` is `sha256=<hex>` and `X-Prism-Timestamp` carries the signed envelope timestamp.

### When to use it

Use it for host-owned PagerDuty, Slack, or application hooks after a run completes, fails, or suspends. Omit targets when no outbound notification is wanted: no target means no queued delivery or network activity.

### Inputs / request

| Field | Meaning |
| --- | --- |
| `targets` | Host-configured `{ url, events }` entries. URLs must be public HTTPS, without credentials/fragments; private and metadata literals fail during registration. |
| `allowLoopbackHttp` | Explicit opt-in permitting `http:` for loopback hostnames (development receivers only); never combined with private or metadata targets. Default false. |
| `signer.key` | Host-held `Uint8Array` HMAC key, at least 32 bytes. |
| `redactor` | Required `SecretRedactor`; its result is placed in `redactedPayload` before signing. |
| `limits.maxQueuedEvents` | Global outbound queue cap; default 128, hard cap 4,096. Overflow drops newest and increments `diagnostics().dropped`. |
| `limits.timeoutMs` / `maxEventBytes` | Per-attempt timeout (5 s default, 30 s hard) and JSON envelope byte cap (64 KiB default, 1 MiB hard). |
| `limits.retries` / `retryBaseDelayMs` / `retryMaxDelayMs` / `retryJitter` | Retries after the first attempt (3 default, 10 hard); exponential 100 ms→5 s delays (30 s hard), with ±25% jitter by default. Set jitter to `0` only for deterministic tests. |
| `limits.maxFailureRecords` | Redacted terminal failure-record ring buffer; 32 default, 256 hard. |

`notify()` accepts `run.completed`, `run.failed`, `run.suspended`, `workflow.completed`, `workflow.failed`, or `workflow.suspended`. `onAgentEvent()` and `onWorkflowEvent()` translate Prism lifecycle events into those names.

### Outputs / response / events

`notify()` returns immediately after bounded enqueue. Pass `{ signal }` as its second argument to cancel queued or retrying delivery for that run. `diagnostics()` returns `{ queued, delivered, failed, dropped, retries, cancelled, failures, lastError? }`: `failed` is the `prism.webhook.failed` terminal-failure counter, `failures` is bounded and redacted, and `lastError` is its latest redacted error.

A `2xx` delivery succeeds. `4xx` is terminal except `429`; `429`, `5xx`, and transport failures retry within the configured cap. `Retry-After` is honored within `retryMaxDelayMs`. Delivery is at-least-once: receiver timeouts after processing can yield duplicates.

```json
{
  "id": "01d2...",
  "event": "run.failed",
  "runId": "run-42",
  "status": "failed",
  "redactedPayload": { "error": "[REDACTED]" },
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

### Request/response example

Receivers verify the raw request body, not a parsed/re-serialized object:

```ts
const expected = createHmac("sha256", hostHmacKey).update(rawBody).digest("hex");
const valid = request.headers.get("x-prism-signature") === `sha256=${expected}`;
```

### Implementation example

```ts
import { createSecretRedactor, type AgentSession } from "@arnilo/prism";
import { createWebhookNotifier } from "@arnilo/prism-core/runtime/server";

const notifier = createWebhookNotifier({
  targets: [{ url: "https://ops.example.test/prism", events: ["run.failed", "workflow.suspended"] }],
  signer: { key: Buffer.from(process.env.PRISM_WEBHOOK_HMAC!, "hex") },
  redactor: createSecretRedactor([process.env.PRISM_WEBHOOK_HMAC]),
});

export function wireWebhookAgentSession(session: AgentSession): AgentSession {
  void (async () => {
    for await (const event of session.subscribe()) notifier.onAgentEvent(event);
  })();
  return session;
}

export const webhookWorkflowRunOptions = { onEvent: notifier.onWorkflowEvent };
```

The agent `sessionFactory` is the server-handler adapter. Workflow `onEvent` receives the same events emitted through its event bus, including `workflow_finished` and `workflow_suspended`.

### Extension and configuration notes

Targets are static host configuration, never request JSON, tool output, or extension discovery. Event filters are exact. The notifier is a server-package export; it neither starts a listener nor owns a durable queue, auth provider, or webhook receiver.

### Security and performance notes

Delivery uses core `pinnedFetch` only: every attempt DNS-pins a public address and rejects all redirects, including redirects toward private targets. The HMAC key, signature, and delivery errors are never logged by the notifier; bounded failure records redact error text before retention. HTTPS is mandatory; plaintext HTTP is allowed only with explicit `allowLoopbackHttp: true` and a loopback hostname, and still pins/validates DNS. Queue overflow deliberately drops newest deliveries so earlier accepted lifecycle events retain order; use `diagnostics()` to observe loss. The in-memory queue does not survive restart; a durable outbox is required when cross-restart delivery matters. The outbound-webhook threat leg lives in `npm run security:threat-suites` (`scripts/phase46-webhooks-security.test.mjs` plus the package and pinned-fetch fixtures).

### Related APIs

- [Multimodal content](multimodal-content.md): shared DNS-pinned outbound fetch primitive.
- [Workflows](workflows.md): workflow event-bus and `onEvent` lifecycle seam.
- [Host security guide](host-security.md): remote-boundary controls.

## Deployment seams (optional)

Compose beside `createPrismHandler` — Prism starts no listener, container orchestrator, or queue worker.

| Helper | Role |
| --- | --- |
| `createPrismHealthHandler` | `GET /health`, `/livez`, `/readyz`. Minimal JSON; `?detail=1` requires `authorizeDetail`. No secrets/tenant payloads by default. Ready fails while draining. |
| `createPrismDrainController` | `beginDrain()` rejects admit ops (`agent.run`/`stream`/`resume`, workflow run/stream/enqueue/resume/replay, schedule create/trigger) with `503 ERR_PRISM_SERVER_DRAINING`. Status/cancel/list stay open. |
| `rateLimit` on handler | Host adapter after authorize, before session create. Return denial `{ retryAfterMs, code, message }` → `429` + optional `Retry-After`. `createMemoryRateLimiter` is single-process only. |
| `createPrismAgentEventReplay` | Shared `AgentEventSource` page/follow semantics for exact-owned runs. |
| `createPrismEventReplay` / `createPrismReplayHandler` | Compatible ownership-scoped legacy `queryEvents` pages (`redacted: true`). Does not re-run work. Unauthorized replay denies. |
| `createPrismDeploymentLease` | Lease election under `prism.server.deployment`. Coordinator replica holds `key: "coordinator"` before schedule ticks; workers run `@arnilo/prism-core/runtime/workflows` `createWorkflowCoordinator` for queued runs (fencing tokens). |
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
- Source inputs/resource URLs remain host responsibilities and use existing resource/media SSRF policies. Apart from explicitly configured `WebhookNotifier` targets, server package features do not fetch URLs.
- Schedule routes never accept ownership from JSON. Services carry mandatory ownership and explicit workflow/calculator registries; route authorization cannot broaden either. Replay applies workflow ownership/hash/approval checks.
- Agent status/resume routes exist only for keys in `agentRuns`. Supply one core `createAgentRunLifecycle({ checkpoints, resolveAgent })` capability per selected agent; its resolver returns current `{ agent, definitionRevision }`. It reuses core checkpoint parsing/CAS/fingerprint checks, returns only public state/version, and needs a durable `SessionStore` as well as checkpoints for restart-safe resume. Empty/default configuration adds no agent lifecycle route, polling, or server cache.

A2A routes are not added to `createPrismHandler()`. Install `@arnilo/prism-core/runtime/supervisor` and explicitly mount `createA2AHandler()` when protocol interoperability is required; this keeps cards and remote invoke absent from ordinary Prism servers.

## Related APIs

- [Agent identity](agent-identity.md): optional verified identity on authorize results.
- [Performance](performance.md): capacity notes for concurrent runs and deployment probes.
- [Agent/session runtime](agent-session-runtime.md): direct result and event stream semantics.
- [Workflows](workflows.md): durable checkpoints, status, cancellation, exact-once resume, and `createWorkflowCoordinator` workers.
- [MCP client and server exposure](mcp-tools.md): selected MCP capabilities and web-standard MCP transport.
- [Host security guide](host-security.md): remote-boundary checklist.
- [A2A interoperability](a2a.md): separately mounted A2A 1.0 handler/client.
- [Obscura browser engine](obscura.md): optional binary-backed generic tools for hosted agents.
- [Conversations](conversations.md): durable user-scoped conversation service, replay, branches, export, deletion.
- [Work artifacts and review](work-artifacts-and-review.md): durable artifact review service, revisions, approvals, authorized expiring delivery links.
- [Frontend interoperability (AG-UI and ACP)](ag-ui.md): separately installed authorized AG-UI Web handler.
- [AG-UI adoption evaluation](ag-ui-adoption.md): official 0.0.57 support matrix and MCP/A2A follow-up scope.
- [Release and install](release-and-install.md): optional package installation and profiles.
