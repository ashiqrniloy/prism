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
| `limits` | no | top-K, adjacent range, batch, payload, injected-token, export, and rebuild caps |
| `redactor` / `secrets` | no | Redact text/metadata before persist/inject |
| `requireConsent` | no | Strict mode: recall/injection excludes entries lacking explicit consent |

Semantic indexing (entries carry `MemoryConsent` source/visibility; unset defaults to `{ source: "user", scope: "thread", visible: true }`):

| `MemoryConsent` field | Meaning |
| --- | --- |
| `source` | `"user"`, `"agent"`, or `"system"` provenance. |
| `scope` | `"thread"`, `"profile"`, or `"user"` control scope. |
| `visible` | `false` immediately excludes the record from recall, injection, export, and telemetry. |
| `grantedAt` / `revokedAt` | Optional host/audit timestamps; a revocation excludes the record. |

```ts
await memory.remember({ entries: [{ id, text, metadata?, consent?, sequence? }] }, { wait?: boolean })
```

Semantic recall (honors consent/visibility at assembly time):

```ts
await memory.recall(query, { topK?, messageRange?, requireConsent?, signal? })
```

Consent + lifecycle (real grant/correct/delete/retention on stored entries):

```ts
await memory.setConsent(entryId, { visible?: boolean, source?, scope? }) // grant/revoke; no re-embed
await memory.correct(entryId, text)                                       // re-embeds, preserves consent
await memory.forget({ ids? })                                             // real delete (whole thread if no ids)
await memory.applyRetention({ maxAgeDays?, maxEntries?, batchSize? })     // bounded real-delete sweep

const page = await memory.exportMemory({
  identity: { tenantId, resourceId, threadId }, // exact host-verified owner
  cursor?, limit?, maxBytes?, maxMs?, signal?,
}); // visible, explicitly consented, redacted records only

const rebuilt = await memory.rebuildIndex({ cursor?, batchSize?, maxMs?, signal? });
// re-embeds one page; save rebuilt.nextCursor and call again to resume
```

## Outputs / response / events

| API | Result |
| --- | --- |
| `updateWorking` / `getWorking` | Versioned `WorkingMemoryRecord` |
| `remember` | `{ accepted, pending, done }` — default `wait: false` indexes asynchronously |
| `recall` | `{ hits, adjacent }` tenant/thread scoped; invisible/revoked entries excluded |
| `setConsent` / `correct` | Updated `MemoryVectorRecord` with stamped grant/revoke times |
| `forget` | Removed count (real delete) |
| `applyRetention` | `{ deleted, scanned }` bounded real-delete sweep |
| `exportMemory` | `{ entries, bytes, nextCursor? }` redacted, explicitly consented, identity-bound page |
| `rebuildIndex` | `{ rebuilt, nextCursor? }` re-embedded bounded page; caller owns resume scheduling |
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

Standalone durable vector store for RAG:

```ts
import { createPostgresVectorStore, createHashEmbedder } from "@arnilo/prism-memory";

const store = await createPostgresVectorStore({
  connectionString: process.env.DATABASE_URL!,
  schema: "prism_memory", // default
  table: "semantic_memory", // default
  dimension: 32, // optional; pins the embedding column width (HNSW + drift guard)
}); // PostgresVectorStoreOptions; dimension must match the embedder's dimensions
// store implements rag's VectorStore/TransactionalVectorStore contract: upsert,
// query, getBySource, transaction, lexicalQuery (fts, when available), and
// getCurrentGeneration/setCurrentGeneration. close() ends adapter-owned pools.
```

`createPostgresVectorStore()` is the production counterpart to `createMemoryVectorStore()` used by `@arnilo/prism-rag`; `createPostgresMemoryStores()` reuses the same vector implementation internally.

## Extension and configuration notes

- Hosts wire the context provider into `AgentConfig.context` or `resolveContextProviders()`.
- The working-memory processor is opt-in and host-invoked; middleware is not required.
- `createHashEmbedder()` is for tests/demos only; production hosts supply a real `Embedder`.
- Observational memory (`@arnilo/prism-compaction-observational-memory`) remains unchanged and composable.
- Consent is enforced at the single `recall()` gate, so both direct recall and `createContextProvider()` injection honor it; `visible: false` (or a revoked grant) keeps an entry out of prompts, events, exports, and telemetry. `setConsent`/`correct` re-upsert in place (consent change does not re-embed); `forget`/`applyRetention` are real deletes, not tombstones. Retention uses indexed oldest-first pages plus a scoped count, deleting one default-500/hard-5000 batch without reading a corpus into memory. The PostgreSQL adapter persists consent in a `consent JSONB` column added by `buildMemoryDdl`.
- The PostgreSQL vector path owns its DDL in Prism (`buildMemoryDdl`/`buildVectorSearchDdl` exported): the `<table>_rag_scope_generations` per-scope generation pointer table, `text_tsv` tsvector column + GIN index for the lexical RAG leg, and an HNSW index when the embedding dimension is pinned. DDL runs against the host's **knowledge database** — the host names `schema`/`table` (defaults `prism_memory`/`semantic_memory`), owns backup/retention of that database, and can run migrations manually with `skipMigrations: true`. Identifiers are validated/quoted; values stay parameterized.
- `createPostgresVectorStore({ dimension })` pins the embedding column width before building indexes: pgvector can only build HNSW over `vector(N)` columns, and dimension mismatch fails closed instead of drifting.
- `exportMemory()` requires an exact `{ tenantId, resourceId, threadId }` identity equal to its `createMemory()` scope. It excludes legacy consent-less, invisible, and revoked records even when normal recall allows legacy entries. It returns a stable sequence cursor page, redacted before response, with defaults/hard caps of 100/200 entries, 4/32 MiB, and 10/60 seconds. `rebuildIndex()` uses the same stable cursor shape to re-embed one 32/128-record page under a 10/60-second cap; save the cursor durably to resume. Both APIs require a store implementing bounded `listByThread()`; retention also requires `countByThread()`. PostgreSQL/pgvector and the in-memory reference adapter conform; SQLite persistence stores sessions, not semantic vectors.
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
- Revoked/invisible/non-consented memories never enter prompts, events, exports, or telemetry; `requireConsent: true` additionally drops consent-less (legacy) entries. Consent checks are O(hits) at recall, within the existing injected-token cap.
- Configure `secrets` / `redactor` so memory text and metadata cannot persist or inject raw canaries.
- Injected context is inert text — it cannot grant tools or permissions.
- Hard caps: top-K ≤ 32, messageRange ≤ 4, embed batch ≤ 128, injected tokens ≤ 8000, payload/working-memory byte limits enforced.
- Every embedding is a non-empty finite number vector. `embedBatched()`, in-memory `VectorStore` upserts/queries, PostgreSQL/pgvector parameters, and export/rebuild page boundaries reject NaN, ±Infinity, non-numbers, and wrong configured dimensions before similarity scoring, SQL, response, or re-indexing. Custom adapters can call `assertFiniteVector(vector, label, expectedLength?)` at their trust boundary.
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
