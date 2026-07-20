# @arnilo/prism-supervisor

Optional bounded local child delegation and A2A 1.0 interoperability for Prism.

```bash
npm install @arnilo/prism-supervisor @arnilo/prism
```

```ts
import { createAgent, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { createSupervisor } from "@arnilo/prism-supervisor";

const supervisor = createSupervisor({
  ownership: { tenantId: "tenant", userId: "user" },
  children: {
    research: {
      createAgent: ({ resourceId, threadId, permission }) => createAgent({
        model: { provider: "mock", model: "research" },
        provider: createMockProvider([providerTextDelta(`${resourceId}:${threadId}`), providerDone()]),
        permission,
      }),
    },
  },
});

console.log((await supervisor.delegate({ childId: "research", input: "Check sources" })).text);
```

Also exports bounded A2A 1.0 cards, handler/client, rich one-of parts, host-owned `A2ATaskLifecycle`, reconnect subscriptions, and push-config CRUD. Direct text invocation remains compatible; durable get/list/cancel/subscribe and rich raw/data/URL parts require explicit adapters/policy. URL parts are validated but never fetched. Push persistence/network/credentials and exact-owner checks remain host-owned; explicit `deliverA2APushEvent()` only bounds attempts/time and forwards stable event IDs for host idempotency. Returned configs omit secrets. JSON-RPC/HTTPS is the only binding.

See [Supervisors](../../docs/supervisors.md) and [A2A interoperability](../../docs/a2a.md).
