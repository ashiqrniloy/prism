# @arnilo/prism-server

Optional framework-free Web `Request -> Response` exposure for selected Prism agents and workflows.

```bash
npm install @arnilo/prism @arnilo/prism-workflows @arnilo/prism-server
```

```ts
import { createPrismHandler } from "@arnilo/prism-server";

const handler = createPrismHandler({
  agents: { support: agent },
  workflows: { publish: { definition: workflow, checkpoints } },
  authorize: async ({ request }) => validHostToken(request)
    ? { ownership: { tenantId: "tenant-1", userId: "user-1" } }
    : false,
});

const response = await handler(new Request("https://api.example.test/prism/agents/support/runs", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ input: "Hello" }),
}));
```

Routes: direct/SSE agent run, cross-replica durable event reconnect through object agent exposures with `events` + `resolveRun`, explicitly selected durable agent status/resume through `agentRuns`, direct/SSE workflow run, durable workflow enqueue/status/cancel/resume/replay, and optional ownership-scoped schedule create/list/pause/resume/trigger/delete. `agentRuns` uses core `createAgentRunLifecycle()`; no lifecycle route exists by default. All bodies, responses, events, queues, concurrency, and timeouts are bounded.

Optional 0.0.14 co-work handlers (mount beside the API handler): `createConversationHandler` (durable user-scoped conversation threads with reconnectable redacted replay — `createConversationService`) and `createArtifactHandler` (artifact revisions, approve/reject review, expiring authorized delivery links — `createArtifactService` over the existing checkpoint store). Both are ownership-scoped and fail closed without authorization.

Optional deployment helpers (compose beside the API handler — no embedded listener):

```ts
import {
  createPrismDrainController,
  createPrismHealthHandler,
  createMemoryRateLimiter,
  createPrismDeploymentLease,
} from "@arnilo/prism-server";

const drain = createPrismDrainController();
const handler = createPrismHandler({
  agents: { support: agent },
  authorize,
  drain,
  rateLimit: createMemoryRateLimiter({ maxRequests: 60, windowMs: 60_000 }),
});
const health = createPrismHealthHandler({ drain, ready: () => store.ping() });
// Workers: createWorkflowCoordinator(...). Coordinators: createPrismDeploymentLease({ key: "coordinator", ... }).
```

Nothing is exposed by default. Authorization is required; ownership comes only from its result. No listener, framework, auth provider, user database, credential discovery, queue adapter, or hidden package activation ships.

Full API, route, limits, security, and deployment notes: [`docs/server.md`](../../docs/server.md).
