# Prism production RAG engine (hybrid retrieve, transactional store, traces)

Status: **requested** — filed against Prism `@arnilo/prism-rag@0.3.0` / `@arnilo/prism-memory@0.3.0`. Synapta Plan 080 is **blocked** until a release implements every item below and Synapta pins that release. Architecture: [`docs/architecture/knowledge-rag.md`](../architecture/knowledge-rag.md).

## Summary

`@arnilo/prism-rag` 0.3.0 is a correct **bounded host engine** (scope, inert trust, `replaceSource` fail-closed, rerank seam, citations) and a **vector demo** underneath:

- `getBySource` + `transaction` exist only on the in-memory `VectorStore`. Durable `replaceSource` cannot run.
- `retrieveContext` is vector-only. No lexical path, no RRF.
- `Embedder` has `dimensions` and no `id`. Records do not store which model wrote the vector. Query/index drift is silent.
- `replaceSource` always re-embeds. No document/chunk content hash skip.
- `chunkMarkdown` prefers heading boundaries but does not stamp heading/page on chunks.
- No index `generation` / `valid_from`. A crash mid-upsert on a non-transactional store mixes versions.
- `@arnilo/prism-observability-opentelemetry` has no RAG span/event schema.
- `Reranker` is a seam with no in-cluster TEI adapter.

Synapta will not reimplement these in `knowledge.rs`. We will host Docling, TEI, OpenFGA, Temporal, and UI on this engine once it is production-shaped.

## Why Synapta wants it

Ask-mode RAG must survive handbook updates, embedder upgrades, and “why did we retrieve that?” tickets without serving stale or deleted chunks. Target bar: [RAG in Production](https://arpitbhayani.me/blogs/rag-production/) minus Elasticsearch aliases, cloud embeddings, semantic-chunking agents, and per-request rationale LLM calls.

Demand: one org handbook + per-user library + per-session attachments; hybrid retrieve + rerank; p95 retrieve in the low hundreds of ms at ~100k chunks.

## Requested behavior

### P1 — Durable transactional `VectorStore`

Postgres/pgvector adapter implements `TransactionalVectorStore`:

- `getBySource(scope, sourceId)` — exact tenant/resource/thread (`corpusId`)
- `transaction(fn)` — one SQL transaction: delete previous source IDs, upsert staged records
- HNSW on the embedding column; host supplies pool / table name (or Prism DDL applied only on the host’s knowledge database)

`replaceSource` / `deleteSource` must run against this adapter with the same fail-closed rules as the memory store. Without P1, hosts will hand-roll delete+insert and reintroduce partial updates.

### P2 — Hybrid retrieve

`retrieveContext` gains a lexical path and fusion:

```ts
retrieveContext(query, {
  embedder, store, scope,
  lexical: "fts" | "bm25" | "off",  // default "fts"
  fusion: "rrf",
  rrfK: 60,
  topK: 8,
  queryCandidates: 32,
  reranker?,
});
```

- `fts` = Postgres `tsvector` / `ts_rank` (or equivalent on the durable adapter).
- `bm25` = real BM25 when the adapter supports it (`pg_search` / equivalent); if unavailable, fail closed on `"bm25"` — do not silently degrade.
- Hits record `retrieval: "vector" | "lexical" | "hybrid"`, score, `retrievalRank` (pre-rerank).
- Metadata filter and scope recheck stay as today.

### P3 — Embedder identity

```ts
interface Embedder {
  readonly id: string;          // e.g. "nomic-embed-text-v1.5"
  readonly dimensions: number;
  embed(texts: readonly string[], options?: { signal?: AbortSignal }): Promise<readonly (readonly number[])[]>;
}
```

Every stored vector record persists `embedderId` (+ dimensions). `retrieveContext` embeds the query with the provided embedder and **throws** (`ERR_PRISM_RAG_EMBEDDER_MISMATCH`) if any candidate’s `embedderId` or dimensions differ. `createHashEmbedder` sets a test id. This is the article’s “silent model drift” guard.

### P4 — Hash skip inside `replaceSource`

- Options: `contentHash?: string` and `skipIfUnchanged?: boolean` (default true when hash present).
- If the current ready source hash matches → `{ indexed: 0, skipped: true }`, no delete/upsert.
- Chunks may carry `contentHash`. Unchanged chunk texts reuse stored embeddings (re-embed only the delta). Document-level skip is the required v1; chunk-level may ship in the same release.

### P5 — Structure metadata on chunks

`chunkMarkdown` stamps `metadata.heading` (current heading stack, parent included) on every chunk. Host `Parser` metadata (`page`, `section`, …) is copied onto chunks by `replaceDocument` / the chunker. Offsets and stable `sourceId#0001` ids stay.

Do **not** add a semantic-chunking agent. Recursive / heading-aware character chunking is enough.

### P6 — Generation visibility (Postgres analog of an ES alias)

Not a second physical Elasticsearch-style alias API.

- Store a monotonic `generation` (or `valid_from`) per record and a current generation per exact scope.
- `replaceSource` commits the new generation atomically; retrieve filters `generation === current` (and optional `valid_from <= now()`).
- Corpus re-embed (model upgrade): build generation N+1 with the new `embedderId`, then swap `current`. Previous generation remains readable for rollback until the host drops it.
- Retrieve never mixes generations or embedders.

### P7 — RAG OpenTelemetry

`@arnilo/prism-observability-opentelemetry` (or rag package instrumentation the host can attach) emits one root span per `retrieveContext` / `replaceSource`:

```text
rag_request | rag_index
  ├── embedding.query | embedding.index
  ├── retrieval.vector_search
  ├── retrieval.lexical
  ├── retrieval.fusion
  ├── retrieval.rerank
  └── prompt.assembly   // retrieveContext render only
```

Required attributes: `rag.scope.tenant_id` (or a host redaction hook), `rag.embedder_id`, `rag.index_generation`, `rag.top_k`, latencies, candidate counts.

`chunk_retrieved` events: `sourceId`, `chunkId`, `rank`, `score`, `embedderId`, `indexGeneration`. **Raw chunk text off by default** (hosts with ACL must not leak titles/bodies into traces). Indexing spans must not log document bytes.

### P8 — In-cluster TEI reranker adapter

Keep the existing `Reranker` seam (redacted candidates, permutation-only, byte/time/concurrency caps).

Add a reference adapter, e.g. `createTeiReranker({ baseUrl, model, timeoutMs })`, talking to Hugging Face TEI (or OpenAI-compatible rerank) **at a host-supplied URL**. No Cohere/Voyage default. No credentials in the package. Fail closed on non-HTTP(S) loopback/cluster policy is the host’s job; the adapter must not invent a public SaaS URL.

## Existing 0.3.0 behavior to keep

- Exact `RagScope` on every call; foreign records fail closed.
- `trust: { untrusted: true, inert: true, injectionCapable: true }` on every hit/citation.
- Reranker cannot overwrite provenance/trust.
- `IngestionStatusStore` + `listIngestionStatus` (hosts persist it).
- Caps (bytes, chunks, topK, rerank). Do not remove them.
- `createRagContextProvider` remains optional. Synapta Ask uses a host tool over `retrieveContext`, not auto-inject, but the provider must keep working.
- Parsers stay seams. Synapta supplies Docling. Do not expand `pdfParser` into a full Office stack.

## Out of scope (do not add)

- GraphRAG, crawl, filesystem discovery, URL fetch outside web-tools
- Semantic-chunking / LLM splitters
- Cloud embed or cloud rerank as defaults
- Elasticsearch / OpenSearch product dependency
- Agent-facing SQL
- Changing Prism core into a hosted RAG product

## Acceptance criteria

- `replaceSource` against the postgres adapter is atomic: kill the process after embed and before commit → previous chunks still retrieve; after commit → only new chunks retrieve.
- `retrieveContext` with `lexical: "fts"` returns a lexical-only hit that vector search misses (fixture) and a paraphrase hit that FTS misses; fused list is RRF-ordered.
- Retrieving with embedder B against vectors from embedder A throws `ERR_PRISM_RAG_EMBEDDER_MISMATCH`.
- `replaceSource({ contentHash, skipIfUnchanged: true })` on unchanged bytes performs zero embed calls.
- Markdown chunks under `## 3.2 Leave` include that heading (and parent `# Policy`) in `metadata.heading`.
- After a model-upgrade generation swap, traces show the new `rag.index_generation` and retrieve does not return the old generation.
- A retrieve with no host logger still produces the span tree above when OTel is configured; `chunk_retrieved` has no raw text by default.
- `createTeiReranker` against a fake TEI endpoint reorders candidates; timeout/oversized input fail closed; returned hits keep Prism provenance.
- Memory store + hash embedder tests stay green. No new required cloud service.

## Suggested package surface

```ts
// @arnilo/prism-memory
createPostgresVectorStore(options: { pool: unknown; /* host table / schema */ }): TransactionalVectorStore

// @arnilo/prism-rag
retrieveContext(query, { lexical?: "fts" | "bm25" | "off"; fusion?: "rrf"; rrfK?: number; ... })
createTeiReranker(options: { baseUrl: string; model: string; timeoutMs?: number }): Reranker

// Embedder.id required; records persist embedderId
```

Exact names may change; Synapta 080 will pin the shipped names.

## Reproduction (current 0.3.0 gaps)

```ts
import { createMemoryVectorStore } from "@arnilo/prism-memory";
import { replaceSource } from "@arnilo/prism-rag";

// Durable path: postgres adapter has no getBySource / transaction.
// replaceSource(postgresStore) throws:
//   "atomic source replacement requires a transactional vector store"

// retrieveContext has no lexical/fusion options — vector only.

// Embedder has no id — silent mix of two models is allowed.
```
