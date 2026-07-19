# @arnilo/prism-memory

Optional working memory and semantic recall for Prism agents.

Install explicitly. This package is not included in profile bundles until a size/use review. Ordinary Prism sessions do not require a vector backend.

## Install

```bash
npm install @arnilo/prism-memory @arnilo/prism
```

PostgreSQL/pgvector support uses the package `pg` dependency. Live adapter tests require `PRISM_TEST_POSTGRES_URL` and the `vector` extension.

## Usage

```ts
import { createAgent } from "@arnilo/prism";
import { createHashEmbedder, createMemory } from "@arnilo/prism-memory";

const memory = createMemory({
  tenantId: "t1",
  resourceId: "user-ada",
  threadId: "thread-1",
  embedder: createHashEmbedder(), // replace with a host-owned production embedder
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
await memory.remember({
  entries: [{ id: "m1", text: "Prefers concise answers" }],
}); // indexes asynchronously by default

const recalled = await memory.recall("preferred response format", { topK: 5, messageRange: 1 });

const agent = createAgent({
  // ...provider/model
  context: [memory.createContextProvider()],
});
```

## API surface

| Export | Role |
| --- | --- |
| `createMemory` | Facade for working memory + semantic recall |
| `Embedder` / `VectorStore` / `WorkingMemoryStore` | Narrow package-owned contracts (RAG reuses embed/vector) |
| `createHashEmbedder` | Deterministic offline embedder for tests/demos |
| `assertFiniteVector` | Reject empty, non-number, NaN, Infinity, or wrong-dimension vectors before a custom store |
| `createMemoryVectorStore` / `createMemoryWorkingStore` | In-memory reference adapters |
| `createPostgresMemoryStores` | PostgreSQL/pgvector production path |
| `runMemoryConformance` | Shared network-free conformance helper |
| `createContextProvider` / `createWorkingMemoryProcessor` | Existing context seam + opt-in update helper |

## Security

- `tenantId` and `resourceId` are mandatory on every write/query/delete; semantic operations also require `threadId`.
- Memory text/metadata are redacted when `secrets` / `redactor` are configured.
- Injected context is inert text only — no tools or permissions.
- Cross-tenant and cross-thread recall is denied.
- Embedder output, in-memory upserts/queries, and PostgreSQL/pgvector parameters accept only non-empty finite number vectors; NaN, ±Infinity, non-numbers, and wrong configured dimensions fail before scoring or SQL.

See [Working and semantic memory](../../docs/working-and-semantic-memory.md).
