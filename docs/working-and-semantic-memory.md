# Working and semantic memory

## What it does

`@arnilo/prism-memory` is an optional package for schema/template-backed working memory and embedding-based semantic recall. It owns narrow `Embedder` and `VectorStore` contracts reused by `@arnilo/prism-rag`, plus an in-memory reference path and one PostgreSQL/pgvector production adapter.

## When to use it

Use it when a host needs durable per-tenant profile/state (working memory) or top-K semantic retrieval over prior thread entries. Do not use it as a replacement for observational memory compaction: observational memory compresses source-backed observations; semantic memory retrieves embeddings; working memory stores the current structured profile.

Ordinary Prism sessions do not require this package or any vector backend.

## Inputs / request

`createMemory(options)`:

| Field | Required | Meaning |
| --- | --- | --- |
| `tenantId` | yes | Tenant isolation key |
| `resourceId` | yes | Resource/user isolation key |
| `threadId` | for semantic ops | Thread isolation; optional for resource-scoped working memory |
| `embedder` | yes | Host-owned or package hash embedder |
| `vectorStore` / `workingStore` | no | Defaults to in-memory adapters |
| `schema` / `validateWorkingMemory` | no | Working-memory shape checks (JSON Schema subset or host hook) |
| `workingMemoryTemplate` | no | `{{path}}` template for context injection |
| `limits` | no | top-K, adjacent range, batch, payload, injected-token caps |
| `redactor` / `secrets` | no | Redact text/metadata before persist/inject |

Semantic indexing:

```ts
await memory.remember({ entries: [{ id, text, metadata?, sequence? }] }, { wait?: boolean })
```

Semantic recall:

```ts
await memory.recall(query, { topK?, messageRange?, signal? })
```

## Outputs / response / events

| API | Result |
| --- | --- |
| `updateWorking` / `getWorking` | Versioned `WorkingMemoryRecord` |
| `remember` | `{ accepted, pending, done }` — default `wait: false` indexes asynchronously |
| `recall` | `{ hits, adjacent }` tenant/thread scoped |
| `createContextProvider()` | Inert `ContextProvider` blocks for working and/or semantic text |
| `createWorkingMemoryProcessor({ extract })` | Explicit host-invoked updater; never auto-runs |

No package-owned agent events are emitted. Injection uses existing context assembly only.

## Request/response example

```json
{
  "tenantId": "t1",
  "resourceId": "user-ada",
  "threadId": "thread-1",
  "working": { "name": "Ada", "preferences": { "format": "concise" } },
  "recall": {
    "query": "preferred response format",
    "topK": 5,
    "messageRange": 1
  }
}
```

## Implementation example

```ts
import { createAgent, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { createHashEmbedder, createMemory } from "@arnilo/prism-memory";

const memory = createMemory({
  tenantId: "t1",
  resourceId: "user-ada",
  threadId: "thread-1",
  embedder: createHashEmbedder(),
  workingMemoryTemplate: "Name: {{name}}; Format: {{preferences.format}}",
  schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      preferences: {
        type: "object",
        properties: { format: { type: "string" } },
        required: ["format"],
        additionalProperties: false,
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
});

await memory.updateWorking({ name: "Ada", preferences: { format: "concise" } });
await memory.remember({ entries: [{ id: "m1", text: "Prefers concise answers" }] });

const agent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider: createMockProvider([providerTextDelta("Got it."), providerDone()]),
  context: [memory.createContextProvider()],
});
```

PostgreSQL/pgvector:

```ts
import { createPostgresMemoryStores, createMemory, createHashEmbedder } from "@arnilo/prism-memory";

const stores = await createPostgresMemoryStores({
  connectionString: process.env.DATABASE_URL!,
  schema: "prism_memory",
  dimensions: 32,
});

const memory = createMemory({
  tenantId: "t1",
  resourceId: "user-ada",
  threadId: "thread-1",
  embedder: createHashEmbedder({ dimensions: 32 }),
  workingStore: stores.workingStore,
  vectorStore: stores.vectorStore,
});
```

## Extension and configuration notes

- Hosts wire the context provider into `AgentConfig.context` or `resolveContextProviders()`.
- The working-memory processor is opt-in and host-invoked; middleware is not required.
- `createHashEmbedder()` is for tests/demos only; production hosts supply a real `Embedder`.
- Observational memory (`@arnilo/prism-compaction-observational-memory`) remains unchanged and composable.
- Profile bundles do not include this package yet.

Shared conformance:

```ts
import { runMemoryConformance, createHashEmbedder, createMemoryVectorStore, createMemoryWorkingStore } from "@arnilo/prism-memory";

await runMemoryConformance(() => ({
  embedder: createHashEmbedder(),
  vectorStore: createMemoryVectorStore(),
  workingStore: createMemoryWorkingStore(),
}));
```

## Security and performance notes

- Every write/query/delete requires `tenantId` + `resourceId`; semantic paths also require `threadId`.
- Cross-tenant and cross-thread access is denied.
- Configure `secrets` / `redactor` so memory text and metadata cannot persist or inject raw canaries.
- Injected context is inert text — it cannot grant tools or permissions.
- Hard caps: top-K ≤ 32, messageRange ≤ 4, embed batch ≤ 128, injected tokens ≤ 8000, payload/working-memory byte limits enforced.
- Default `remember()` does not block agent completion; pass `{ wait: true }` when indexing must finish first.
- PostgreSQL live suite is gated by `PRISM_TEST_POSTGRES_URL` and requires the `vector` extension.

## Delegated-agent isolation

Supervisor child factories receive unique derived `resourceId` and `threadId` values. Construct each child's `createMemory()` facade from those exact values; never reuse parent memory scope or let model-supplied IDs select another resource.

## Related APIs

- [Supervisor delegation](supervisors.md): package-derived child resource/thread scope.
- [Retrieval-augmented generation](rag.md): bounded document chunks reuse this package's embed/vector contracts.
- [Context and skills](context-and-skills.md): `ContextProvider` injection seam.
- [Observational memory compaction package](compaction-observational-memory.md): source-backed observation/reflection memory distinction.
- [PostgreSQL persistence](postgres-persistence.md): session/run persistence; memory vectors live in this optional package instead.
- [Middleware hooks](middleware-hooks.md): reuse existing `context` hook if hosts transform injected blocks.
