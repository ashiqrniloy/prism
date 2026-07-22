# Web-standard server handler

## What it does

`@arnilo/prism-server` exposes explicitly selected agents and workflows through one framework-free `(Request) => Promise<Response>` handler. It supports direct agent results, bounded agent/workflow SSE, opt-in durable agent status/resume, durable workflow start/enqueue/status/cancel/resume/replay, ownership-scoped schedules, host authorization, ownership propagation, redaction, and resource ceilings.

No listener starts on import. Empty `agents`/`workflows` maps expose nothing. Authentication, authorization, route selection, durable stores, TLS, rate limiting, and framework/serverless adaptation remain host-owned.

## When to use it

Use it when a Node 20, serverless, worker, or framework host already speaks Web `Request`/`Response` and needs a small Prism API boundary. Wrap it in the platform's native adapter rather than adding Express, Fastify, Hono, Koa, Nest, or Next to Prism.

Use `AgentSession` or workflow APIs directly for in-process applications. Do not treat this package as an auth provider, user database, firewall, durable agent-result store, or public listener.

## Inputs / request

```ts
const handler = createPrismHandler({
  agents?: Record<string, Agent | PrismAgentExposure>,
  agentRuns?: Record<string, PrismAgentRunExposure>, // explicit durable status/resume only
  workflows?: Record<string, PrismWorkflowExposure>,
  schedules?: WorkflowSchedules | ((authorization, signal) => WorkflowSchedules),
  authorize: async ({ request, operation, capabilityId }) => false | {
    ownership: { tenantId?: string; accountId?: string; userId?: string },
    metadata?: Record<string, unknown>,
  },
  basePath?: "/prism",
  allowedHosts?: string[],
  allowedOrigins?: string[],
  redactor?: SecretRedactor,
  limits?: PrismServerLimits,
  disconnectAborts?: boolean,
});
```

At least one non-empty ownership field must come from `authorize()`. Request JSON never chooses ownership.

| Method and route | Authorization operation | Body |
| --- | --- | --- |
| `POST /prism/agents/:id/runs` | `agent.run` | `{ "input": string | Message | Message[] }` |
| `POST /prism/agents/:id/stream` | `agent.stream` | same; SSE response |
| `GET /prism/agents/:id/runs/:runId` | `agent.status` | none; redacted public state/version only |
| `POST /prism/agents/:id/runs/:runId/resume` | `agent.resume` | `{ "decision": "approve" | "deny", "expectedVersion": number }` |
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

Direct routes return bounded JSON. Stream routes return `text/event-stream`; every event is one `data: <AgentEvent|WorkflowEvent>` frame. Status returns the ownership-scoped durable checkpoint record. Resume uses Phase 8 expected-version CAS. Cancel aborts active work or marks eligible durable checkpoints aborted.

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

## Security and performance notes

- `authorize()` is required and runs for every matched operation before capability lookup or body execution. Return `false` on missing/invalid credentials. Do not trust caller ownership fields.
- Use authorization metadata only for non-secret audit context. Never put credentials in metadata, input, route IDs, run IDs, checkpoints, events, or responses.
- Configure `SecretRedactor` before runs. Redaction matches known secrets; it is not DLP.
- Agent tools and workflow tool nodes still need their own `PermissionPolicy`, `ToolValidator`, and `ExecutionPolicy`. HTTP authorization does not replace side-effect policy.
- Host and origin allow-lists are exact string matches. Configure reverse-proxy normalization, TLS, rate limiting, IP policy, CSRF/cookie policy, and authentication outside Prism.
- SSE uses bounded upstream subscriber queues. Consumer cancellation aborts owned work by default and releases concurrency; set `disconnectAborts: false` only when the host deliberately owns background completion.
- Source inputs/resource URLs remain host responsibilities and use existing resource/media SSRF policies. Server package does not fetch URLs.
- Schedule routes never accept ownership from JSON. Services carry mandatory ownership and explicit workflow/calculator registries; route authorization cannot broaden either. Replay applies workflow ownership/hash/approval checks.
- Agent status/resume routes exist only for keys in `agentRuns`. Supply one core `createAgentRunLifecycle({ checkpoints, resolveAgent })` capability per selected agent; its resolver returns current `{ agent, definitionRevision }`. It reuses core checkpoint parsing/CAS/fingerprint checks, returns only public state/version, and needs a durable `SessionStore` as well as checkpoints for restart-safe resume. Empty/default configuration adds no agent lifecycle route, polling, or server cache.

A2A routes are not added to `createPrismHandler()`. Install `@arnilo/prism-supervisor` and explicitly mount `createA2AHandler()` when protocol interoperability is required; this keeps cards and remote invoke absent from ordinary Prism servers.

## Related APIs

- [Agent/session runtime](agent-session-runtime.md): direct result and event stream semantics.
- [Workflows](workflows.md): durable checkpoints, status, cancellation, and exact-once resume.
- [MCP client and server exposure](mcp-tools.md): selected MCP capabilities and web-standard MCP transport.
- [Host security guide](host-security.md): remote-boundary checklist.
- [A2A interoperability](a2a.md): separately mounted A2A 1.0 handler/client.
- [Frontend interoperability (AG-UI and ACP)](ag-ui.md): separately installed authorized AG-UI Web handler; it is not a `@arnilo/prism-server` route.
- [Release and install](release-and-install.md): optional package installation and profiles.
