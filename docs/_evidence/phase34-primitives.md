# Phase 34 primitive review — memory / rag / telemetry inventory

Task 1 output for `plans/034-Release-0-3-1-Production-RAG-Engine.md`. Read-only survey of
existing primitives; every P1–P8 item mapped to reuse-vs-new before implementation.
Line refs verified against working tree at review time.

## 1. Memory primitives (`@arnilo/prism-memory`)

| Primitive | Location | Notes |
| --- | --- | --- |
| `VectorStore` | `packages/memory/src/types.ts:L97-L104` | `upsert`, `query`, `delete`, optional `listByThread`, `countByThread`. |
| `Embedder` | `types.ts:L48-L51` | `{ dimensions, embed(texts, {signal}) }` — no `id` yet (P3 target). |
| `MemoryVectorRecord` | `types.ts:L53-L64` | Fixed shape: id, scope triple, text, embedding, sequence, metadata?, consent?, createdAt. New fields (`embedderId`, `contentHash`, `generation`) land here as optional. |
| `createHashEmbedder` | `embedder.ts:L13-L26` (+`hashEmbed` L52-L72, `normalize`, `embedBatched` L28-L50) | Test embedder; `embedBatched` already enforces batch size + max dims — indexing path reuses it as-is. |
| Memory vector store | `vector-memory.ts:L29-L155` | Full `SourceStore`: getByThread/listByThread/countByThread/getBySource(L125-L138)/**transaction(L145-L153)**. Reference implementation of the exact P1 contract. |
| Memory `transaction` semantics | `vector-memory.ts:L145-L153` | Copy-on-write: stages into a new Map, runs operation against the copy, swaps on success. Atomicity pattern to mirror in SQL BEGIN/COMMIT. |
| **Postgres vector store exists** | `postgres.ts:L188-L320` (returned at `L324`) | `createPostgresMemoryStores().vectorStore` is already a durable pgvector `VectorStore`: `semantic_memory` table, `$n::vector` casts (`L206`,`L245`), cosine `<=>` ordering in SQL (`L239-L245`), scope-scoped delete (`L254`), pagination/count. **P1 gap is narrower than the request implies**: missing only `getBySource`, `transaction`, HNSW index, lexical column, and the new record columns. |
| Postgres DDL builder | `postgres-ddl.ts` (`buildMemoryDdl`, `DEFAULT_MEMORY_SCHEMA`) | Idempotent `CREATE ... IF NOT EXISTS` style; already runs `CREATE EXTENSION IF NOT EXISTS vector`; optional `ALTER TYPE vector(dim)` pinning lives in `postgres.ts:L79-L88`. New columns/indexes extend this builder (additive `ADD COLUMN IF NOT EXISTS`). |
| Identifier safety | `postgres-identifiers.ts:L5-L19` | `validateIdentifier` → `quoteIdentifier` → `qualifyTable`. All table/schema names must route through these (injection guard). |
| Pool lifecycle | `postgres.ts:L57-L75` | Host-supplied pool or owned pool from `connectionString`; `skipMigrations` opt-out; `Queryable = Pick<Pool \| PoolClient, "query">` (`L68`) — methods already parameterized over pool-or-client, which is exactly what `transaction(fn)` needs (bind operations to one `PoolClient`). |
| Errors | `memory/src/errors.ts` | `MemoryValidationError` family; PG store errors map consistently. |

## 2. RAG primitives (`@arnilo/prism-rag`)

| Primitive | Location | Notes |
| --- | --- | --- |
| Store contracts | `rag/src/types.ts:L60-L74` | `SourceVectorStore` (+`getBySource`), `TransactionalVectorStore` (+`transaction`) already declared; only the memory store implements them today. |
| `retrieveContext` pipeline | `retrieve.ts:L22-L137` | caps → `requireScope` → limits → redactor → query embed + validation → `store.query` → per-candidate `assertScope` + filter → rerank → render/citations under byte/token budgets. Insertion points: two-leg retrieval after embed (P2), mismatch check after candidates (P3), generation filter is store-side (P6), telemetry wraps each phase boundary (P7). |
| Limits machinery | `limits.ts:L62-L113` | `integer(value, fallback, cap, label, min)` + `resolveRagLimits` — `rrfK` validation slots straight in; caps constants live beside the existing DEFAULT_/HARD_ pairs. |
| Redaction | via core `resolveRedactor(options.redactor, options.secrets)` | Applied to query (`retrieve.ts:L35`), hits, status messages (`sources.ts:L31`). Lexical path and telemetry attributes must reuse it — never re-implement. |
| Scope enforcement | `requireScope`, `assertScope(scope, candidate)` | Fail-closed foreign-record rejection already applied per candidate; applies equally to lexical hits. |
| `replaceSource` | `sources.ts:L22-L74` | Already stages all records first, then commits `delete(previous)` + `upsert(staged)` inside `store.transaction`. Hash-skip check slots in *before* staging (after `sourceRecords` read); generation increment slots inside the same txn. |
| `indexChunkBatches` | `indexing.ts:L15-L112` | Batched embed + record construction with progress accounting — the single point where `embedderId` (P3), chunk `contentHash` (P4) stamping belongs. |
| Rerank harness | `rerank.ts:L9-L60` | Byte cap, per-reranker WeakMap concurrency guard, `maxMs` timeout wrapper, permutation-completeness verification ("each hit exactly once", unknown-hit rejection, originals restored by id Map). The TEI adapter (P8) only reorders hits — all caps/trust preservation enforced *outside* it. Trust/provenance objects are carried by reference, so adapters cannot overwrite them without rebuilding hits (which the id-map restore prevents). |
| Chunker | `chunk.ts:L14-L57` (`chunkDocument`, `preferredEnd`) | Single scanning pass — heading-stack tracking inserts here (P5). Stable `sourceId#0001` ids produced in this loop. |
| Parser metadata merge | `sources.ts:L119-L122` (`mergeMetadata`) | Merge point for parser `page`/`section` onto chunks (P5). |
| Ingestion status | `ingestion-status.ts` | `IngestionStatusStore` + memory impl + `listIngestionStatus`; untouched by P1–P8. |
| Errors | `errors.ts:L1-L37` | `RagError(message, code="ERR_PRISM_RAG")` takes a code argument → `ERR_PRISM_RAG_EMBEDDER_MISMATCH` needs zero new classes. |

## 3. Telemetry primitives (`@arnilo/prism-observability-opentelemetry`)

| Primitive | Location | Notes |
| --- | --- | --- |
| `PrismSpan` / `PrismTracer` | `instrumentation.ts:L7-L25` | `startSpan(name, {attributes, kind, parent})` → span with `setAttribute/setStatus/addEvent?/end`. Exactly the seam shape P7 needs; `parent` support builds the required span tree. |
| `InMemoryTelemetry` | `instrumentation.ts:L140-L195` | Recorded-span test tracer — used directly in tests to assert the span tree. |
| OTel adapter + API wrap | `createOpenTelemetryInstrumentation`, `wrapOpenTelemetryApi` | Event/session-driven today (agent events); RAG gets its own thin adapter over the same wrapped tracer/meter rather than touching session instrumentation. |
| Field-policy precedent | `TelemetryFieldPolicy` (`L42-L58`) | Attribute filtering hook precedent for the P7 attribute allow-list/redaction hook. |
| Exporter isolation | `docs/observability.md:L160` | `onExporterError` isolation convention; adapter must not throw into retrieve/index paths. |

## 4. P1–P8 mapping

| Item | Reuse | New generic primitive needed |
| --- | --- | --- |
| P1 durable txn store | `postgres.ts` vector store body, `Queryable`, identifier guards, DDL builder, memory-store contract shape | `getBySource` + `transaction` on the PG store; HNSW/tsvector/new columns in DDL; standalone `createPostgresVectorStore` factory (spec surface) sharing internals with `createPostgresMemoryStores` |
| P2 hybrid | retrieve pipeline, redaction, scope asserts, limits | Optional `lexicalQuery` store capability (tokenized overlap for memory store; tsvector/ts_rank for PG; BM25 capability flag fail-closed); pure RRF fusion fn |
| P3 embedder identity | `Embedder`, `MemoryVectorRecord` passthrough, `RagError(code)` | Required `id` field; persisted `embedderId`; mismatch comparison in retrieve |
| P4 hash skip | `replaceSource` staging flow, `sourceRecords` | `contentHash` option + doc/chunk hash compare helpers |
| P5 headings | `chunkDocument` scan, `mergeMetadata` | `metadata.heading` stack stamping; parser-metadata propagation onto chunks |
| P6 generations | PG txn, memory txn, record passthrough | `generation` column + current-pointer table (PG), max-derived current (memory, ceiling noted), swap method, auto-increment in `replaceSource` |
| P7 telemetry | `PrismTracer`/`PrismSpan` shape, InMemory tracer, field-policy precedent | Dependency-free `RagTelemetry` seam in rag + call sites; `createRagTelemetry` adapter in otel pkg with attribute allow-list |
| P8 TEI reranker | entire `rerankHits` harness | `createTeiReranker` fetch/parse/permutation-map adapter only |

## 5. Decisions locked by this review

1. **Extend, don't rebuild**: P1 extends the existing pgvector store in `packages/memory/src/postgres.ts` (+DDL in `postgres-ddl.ts`); a standalone `createPostgresVectorStore({pool, schema?, table?, dimension})` factory exposes the spec surface while sharing the statement builders with `createPostgresMemoryStores`.
2. `RagTelemetry` mirrors `PrismTracer` structurally so the otel adapter is a trivial pass-through and tests use `InMemoryTelemetry`-style recording without cross-package deps.
3. TEI adapter contains no cap logic — the harness owns bytes/time/concurrency and trust restoration.
4. Memory-store `lexicalQuery` ships as tokenized overlap labeled `"fts"` (offline tests); PG uses tsvector/ts_rank; `"bm25"` requires an explicit adapter capability flag (pg_search present), else fail closed.
5. Hash-skip reads happen inside the existing pre-stage flow; skip result short-circuits before any delete/upsert/embed.
