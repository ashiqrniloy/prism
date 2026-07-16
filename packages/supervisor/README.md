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

Also exports A2A 1.0 `createA2AAgentCard`, `signA2AAgentCard`, `verifyA2AAgentCard`, `createA2AHandler`, and `createA2AClient`. Only text parts and JSON-RPC `SendMessage`, `SendStreamingMessage`, and `GetExtendedAgentCard` are supported. Hosts own authentication, TLS, endpoint allow-lists, child credential resolution, and memory construction from package-derived resource/thread IDs.

See [Supervisors](../../docs/supervisors.md) and [A2A interoperability](../../docs/a2a.md).
