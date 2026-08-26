# Release 0.3.1 — Production RAG Engine (hybrid retrieve, transactional store, traces)

Source request: `prism-production-rag.md` (P1–P8, Synapta Plan 080) plus
`prism-multi-scope-retrieve.md` (one embed / global RRF+rerank, Synapta Plan 082),
filed against `@arnilo/prism-rag@0.3.0` / `@arnilo/prism-memory@0.3.0`.

## Objectives

- Implement every requested item P1–P8: durable transactional Postgres `VectorStore`, hybrid lexical+vector retrieval with RRF fusion, embedder identity with drift guard, content-hash skip in `replaceSource`, heading/structure metadata on chunks, index generation visibility, RAG OpenTelemetry span/event schema, and an in-cluster TEI reranker adapter.
- Preserve all existing 0.3.0 behavior listed under "Existing 0.3.0 behavior to keep" (exact `RagScope`, inert trust triple, reranker cannot overwrite provenance/trust, ingestion status stores, caps, optional context provider, parser seams).
- Accept `scopes: RagScope[]` on one `retrieveContext` call: one query embed, per-scope vector/lexical legs, one RRF over the union, one rerank, `topK` cut. Singular `scope` stays. Empty `scopes` is the host “no allowed corpora” path.
- Ship as release 0.3.1 under Decision B: only changed packages (`prism-rag`, `prism-memory`, `prism-observability-opentelemetry`) bump exactly one version (0.3.0 → 0.3.1); no other package version changes and internal `^0.3.0` ranges stay valid. Multi-scope lands in the same unpublished 0.3.1 (no second increment).

## Expected Outcome

- `replaceSource`/`deleteSource` run atomically against a Postgres/pgvector adapter (`getBySource` + `transaction` implemented); a crash between embed and commit leaves the previous chunks retrievable, after commit only the new chunks are retrievable.
- `retrieveContext` supports `lexical: "fts" | "bm25" | "off"` with RRF fusion (`fusion: "rrf"`, `rrfK`), records `retrieval: "vector" | "lexical" | "hybrid"` plus pre-rerank `retrievalRank`, fails closed on unsupported `"bm25"`.
- Every stored record carries `embedderId`; retrieving with a different embedder throws `ERR_PRISM_RAG_EMBEDDER_MISMATCH`.
- `replaceSource({ contentHash })` skips re-embedding unchanged documents (`{ indexed: 0, skipped: true }`) and reuses stored embeddings for unchanged chunks.
- `chunkMarkdown` stamps `metadata.heading` (heading stack incl. parents); parser metadata (`page`, `section`, …) is copied onto chunks by `replaceDocument`.
- Records carry a monotonic `generation`; `replaceSource` commits a new generation atomically; retrieval returns only the current generation (plus legacy rows without generation).
- A configured tracer produces the specified span tree (`rag_request` / `rag_index` with embedding/retrieval/fusion/rerank/prompt-assembly children) and `chunk_retrieved` events with no raw chunk text by default.
- `createTeiReranker({ baseUrl, model, timeoutMs })` reorders candidates against a host-supplied TEI endpoint, permutation-only, caps enforced, provenance preserved.
- `retrieveContext({ scopes })` embeds once, searches each exact scope against that scope’s current generation, fuses all legs with one RRF, reranks once; `scopes: []` returns empty without store/embed/rerank calls; both `scope` and `scopes` throws.
- Three package manifests at 0.3.1, CHANGELOG entry covers P1–P8 plus multi-scope, compat baseline regenerated, all gates green.

## Tasks

- [x] Task 1: Primitive review — inventory existing memory/rag/telemetry primitives before implementation
  - **Completed.** Inventory written to `docs/_evidence/phase34-primitives.md`. Headline findings: (1) `createPostgresMemoryStores` already ships a durable pgvector `VectorStore` (`semantic_memory`, `<=>` cosine, `$n::vector` casts) — P1 reduces to `getBySource` + `transaction` + HNSW/tsvector/new columns in DDL, not a new adapter; (2) `replaceSource` already stages-then-commits inside `store.transaction` — hash-skip and generation increment slot into the existing flow; (3) `rerankHits` already enforces bytes/time/concurrency caps and permutation completeness — the TEI adapter is fetch+reorder only; (4) `PrismTracer`/`PrismSpan` shape is the structural template for the dependency-free `RagTelemetry` seam; (5) `RagError(message, code)` accepts codes — no new error class needed for `ERR_PRISM_RAG_EMBEDDER_MISMATCH`; (6) PG methods are already parameterized over `Queryable = Pick<Pool | PoolClient, "query">`, so binding them to one client gives `transaction` almost for free.
  - Acceptance Criteria:
    - Functional: Written inventory (in this task's notes or a short `docs/_evidence/phase34-primitives.md`) covering: `VectorStore`/`SourceVectorStore`/`TransactionalVectorStore` contracts, `createMemoryVectorStore` transaction pattern, `createPostgresMemoryStores` + `buildMemoryDdl` + identifier-quoting helpers, `resolveRagLimits` cap machinery, redaction/scope asserts in `retrieveContext`, `PrismTracer`/`InMemoryTelemetry` seam shape.
    - Performance: n/a (read-only task).
    - Code Quality: Every P1–P8 item mapped to either an existing primitive to reuse or a named new primitive; no mode-specific logic planned where a generic primitive fits.
    - Security: Inventory records which primitives already enforce scope checks, redaction, and fail-closed caps so new code reuses rather than reimplements them.
  - Approach:
    - Documentation Reviewed:
      - Graft nodes: `packages/rag/src/retrieve.ts:L22-L137`, `packages/rag/src/types.ts:L72-L74` (`TransactionalVectorStore`), `packages/memory/src/vector-memory.ts:L29-L155` (memory store incl. `transaction` L145–L153), `packages/memory/src/types.ts:L48-L64` (`Embedder`, `MemoryVectorRecord`), `packages/memory/src/postgres.ts:L57` (`createPostgresMemoryStores`), `packages/memory/src/postgres-ddl.ts` (`buildMemoryDdl`), `packages/memory/src/postgres-identifiers.ts` (`quoteIdentifier`/`validateIdentifier`), `packages/rag/src/sources.ts:L22-L157` (`replaceSource`, assert guards), `packages/rag/src/chunk.ts:L14-L57` (`chunkDocument`), `packages/observability-opentelemetry/src/instrumentation.ts:L15-L25,L140-L195` (`PrismTracer`, `InMemoryTelemetry`).
      - Repo conventions: `CHANGELOG.md` 0.3.0 entry (Decision B independent versions), `docs/observability.md` (instrumentation attach pattern), test gating via `PRISM_TEST_POSTGRES_URL`.
    - Options Considered:
      - New standalone RAG-postgres package vs. extending `prism-memory` (which already owns `VectorStore`, DDL, PG identifiers) — chosen: extend `prism-memory`, matching the suggested surface `createPostgresVectorStore` in `@arnilo/prism-memory`.
      - Rag-specific telemetry interface vs. reusing `PrismTracer` shape — chosen: minimal dependency-free `RagTelemetry` seam in `prism-rag` mirroring the `PrismTracer` subset, adapted by the otel package.
    - Chosen Approach:
      - Reuse: limits resolution, redaction pipeline, scope assertion, ingestion-status stores, DDL builder + identifier quoting, memory-store transaction semantics as the reference implementation.
      - New generic primitives: `RagLexicalQuery` optional store method, `RagTelemetry` seam, record fields (`embedderId`, `contentHash`, `generation`) on `MemoryVectorRecord` — all generic and reusable beyond Synapta's use case.
    - API Notes and Examples:
      ```ts
      // Existing primitive to reuse (packages/memory/src/vector-memory.ts:L145-L153):
      transaction<T>(operation: (store: SourceVectorStore) => Promise<T>, options?): Promise<T>;
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase34-primitives.md`: tentative — inventory notes (may live in task notes if trivial).
    - References:
      - `prism-production-rag.md` P1–P8; `docs/architecture/knowledge-rag.md` is referenced by the request but does not exist in-repo (noted, not created here).
  - Test Cases to Write:
    - None (review task; output is the inventory itself).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (analysis only).
    - Docs pages to create/edit: none with reason — read-only inventory.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Task 2: Embedder identity — required `Embedder.id`, persisted `embedderId`, drift-guard error code
  - **Completed.** Changes: `packages/memory/src/types.ts` (`Embedder.id` required; `MemoryVectorRecord.embedderId?`), `packages/memory/src/embedder.ts` (`createHashEmbedder` id option, default `prism-hash-embedder`), `packages/memory/src/vector-memory.ts` (upsert validates embedderId: non-empty string ≤256 chars), `packages/rag/src/indexing.ts` (validates `embedder.id`, stamps `embedderId` on every record), `packages/rag/src/retrieve.ts` (mismatch guard inside the candidate loop, after `assertScope`, throwing `RagError("ERR_PRISM_RAG_EMBEDDER_MISMATCH")`; legacy records without `embedderId` fail closed naming the re-index path), `packages/provider-alibaba/src/embeddings.ts` (`AlibabaEmbedder.id = options.model` — required for structural assignability). Test fakes updated in rag/memory suites; new tests cover id mismatch, dimension mismatch via permissive store, legacy-record failure, persisted `embedderId` via `getBySource`, hash-embedder ids, upsert validation, and alibaba id passthrough. Suites: rag 16/16, memory 15/15, alibaba embeddings 10/10. Notes: (1) identity check ordered *after* scope assert so foreign records report `RagScopeError`, not drift details — trust-boundary order; one existing test's fake hits gained realistic `embedderId`s accordingly. (2) Dimension drift against the PG adapter fails closed at write time via the typed `vector(dim)` column (Task 3) and SQL error at read time; the retrieve-side dims check covers stores that return mixed-length records.
  - Acceptance Criteria:
    - Functional: `Embedder` gains required `readonly id: string`. `createHashEmbedder` sets a deterministic test id. `indexChunks`/`replaceSource` persist `embedderId` (+ dimensions) on every record. `retrieveContext` throws `RagError("ERR_PRISM_RAG_EMBEDDER_MISMATCH")` when any candidate record has a differing `embedderId` or dimensionality; records lacking `embedderId` (legacy/pre-upgrade) also fail closed with the same code naming the re-index path.
    - Performance: Mismatch check is O(candidates) field comparison; no additional store round-trips.
    - Code Quality: Type change flows through `MemoryVectorRecord` (optional `embedderId?: string`) so both stores pass it through without per-store branching; error follows existing `errors.ts` code style.
    - Security: No new inputs accepted beyond a bounded non-empty string id (length-capped, validated like other ids).
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/src/types.ts:L48-L51` (`Embedder`), `L53-L64` (`MemoryVectorRecord`); `packages/memory/src/embedder.ts` (`createHashEmbedder`); `packages/rag/src/errors.ts`; `packages/rag/src/retrieve.ts:L22-L137` (query embed + candidate loop).
    - Options Considered:
      - Stash `embedderId` under `metadata._rag` vs. top-level typed record field — chosen: top-level optional field; it must survive to SQL columns in the PG adapter and metadata is host-owned/free-form.
      - Warn-and-filter on mismatch vs. throw — spec mandates throw; repo convention is fail closed.
    - Chosen Approach:
      - Add `readonly id: string` to `Embedder`; update the two first-party embedders and every test fake via a small helper so the diff stays mechanical. Add `embedderId?: string` to `MemoryVectorRecord`; `upsert` persists what it is given (memory store already copies input verbatim). `retrieveContext` compares after fetching candidates, before scoring.
    - API Notes and Examples:
      ```ts
      export interface Embedder {
        readonly id: string; // e.g. "nomic-embed-text-v1.5"
        readonly dimensions: number;
        embed(texts: readonly string[], options?: { readonly signal?: AbortSignal }): Promise<readonly (readonly number[])[]>;
      }
      ```
    - Files to Create/Edit:
      - `packages/memory/src/types.ts`: `Embedder.id` required; `MemoryVectorRecord.embedderId?`.
      - `packages/memory/src/embedder.ts`: hash embedder id.
      - `packages/memory/src/vector-memory.ts`: validation only (non-empty id string on records that carry one).
      - `packages/rag/src/types.ts`, `packages/rag/src/errors.ts`, `packages/rag/src/retrieve.ts`, `packages/rag/src/indexing.ts`: persist + compare.
      - All test fakes implementing `Embedder`: add ids.
    - References:
      - Request P3; acceptance criteria "Retrieving with embedder B against vectors from embedder A throws".
  - Test Cases to Write:
    - Mismatch: index with embedder A, retrieve with embedder B → `ERR_PRISM_RAG_EMBEDDER_MISMATCH`.
    - Dimension mismatch with equal id → same error.
    - Legacy record without `embedderId` → same error, message names re-index.
    - Happy path: matching id + dimensions retrieves normally; `embedderId` observable on stored records via `getBySource`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — breaking interface change (`Embedder.id` required) + new error code + persisted record field.
    - Docs pages to create/edit:
      - `docs/rag.md`: embedder identity section (id requirement, mismatch error, re-index guidance) — combined with Task 11 doc sweep.
      - `docs/working-and-semantic-memory.md`: `Embedder.id` + `embedderId` record field (tentative page split with Task 11).
    - `docs/index.md` update: yes — refresh rag/memory entry descriptions when features land (done in Task 11).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Postgres transactional vector store (`createPostgresVectorStore`) — request P1
  - **Completed.** Changes: `packages/memory/src/postgres.ts` — vector statement body extracted into `createVectorMethods(q: Queryable, deps)` (pool-bound for direct use, PoolClient-bound inside transactions) + `runVectorTransaction` (BEGIN/COMMIT/ROLLBACK, client release in `finally`) + `assembleVectorStore`; `upsert` now persists `embedder_id` and validates it (non-empty ≤256); `getBySource(scope, sourceId)` via `metadata->'_rag'->>'sourceId' = $4`, ordered sequence ASC; standalone `createPostgresVectorStore({ pool?, connectionString?, schema?, table?, dimension?, skipMigrations?, poolMax?, poolConfig?, maxEntryTextChars? })` returning the full `PostgresVectorStore` (+ pool/schema/close). `createPostgresMemoryStores().vectorStore` widened to the same surface (backwards-compatible). `packages/memory/src/postgres-ddl.ts` — `buildMemoryDdl(schema, table?)` parameterized table, additive `embedder_id`/`content_hash`/`generation` columns + `knowledge_generation` pointer table (Task 6 consumer); new exported `buildVectorSearchDdl` (HNSW `vector_cosine_ops`, tsvector generated column + GIN) applied best-effort by both factories — pre-0.5 pgvector / pre-12 PG degrades to seq scan, stays correct (`# ponytail:` noted in source). Exports added in `index.ts`. Tests: `postgres-vector.integration.test.ts` — ungated DDL/identifier-injection unit tests + gated live suite (transaction rollback vs commit, multi-record upsert batch atomicity under pinned dimension drift, exact-scope getBySource + tenant isolation, HNSW cosine order matched against brute-force cosine ranking on 40 seeded vectors, embedderId round-trip, shared builders with memory bundle); file wired into package.json `test` and `test:postgres`. Verified against live pgvector/pg16 docker: vector integration 9/9 (incl. existing PG conformance), rag 16/16, memory 15/15, full workspace build clean.
  - Notes: (1) INSERT column list kept separate from SELECT list constant (`VECTOR_INSERT_COLUMNS`) after a `::text AS` alias syntax error caught by the live run. (2) Dimension pinning remains best-effort `ALTER TYPE vector(n)` with catch — same precedent as before; client-side `assertFiniteVector` fails closed first when `dimension` is declared.
  - Acceptance Criteria:
    - Functional: `createPostgresVectorStore(options: { pool; schema?; table?; dimension }): SourceVectorStore & TransactionalVectorStore` over `pg` pool + pgvector. Implements `upsert`, `query` (cosine, `hnsw` index), `delete`, `getByThread`, `listByThread`, `countByThread`, `getBySource(scope, sourceId)`, and `transaction(fn)` running the operation against one client with BEGIN/COMMIT/ROLLBACK. Host supplies pool/table/schema (or applies Prism DDL to its knowledge database). Exact-scope enforcement identical to the memory store.
    - Performance: HNSW (`USING hnsw (embedding vector_cosine_ops)`) on the embedding column; parameterized queries; p95 query target low hundreds of ms at ~100k chunks (documented envelope, integration-gated benchmark optional).
    - Code Quality: Reuse `quoteIdentifier`/`validateIdentifier`/`qualifyTable` and the `buildMemoryDdl` builder pattern; SQL stays in one module; abort-signal checks mirror existing adapters.
    - Security: Identifiers validated then quoted (no injection through table names); scope columns filtered on every statement; no credentials handled by the package; connection errors do not leak query text with user data.
  - Approach:
    - Documentation Reviewed:
      - pgvector README (pgxn vector 0.8.2): `CREATE INDEX ON items USING hnsw (embedding vector_cosine_ops)`; `<=>` cosine distance operator.
      - Existing PG patterns: `packages/memory/src/postgres.ts:L57`, `packages/memory/src/postgres-ddl.ts`, `packages/memory/src/__tests__/postgres-memory.integration.test.ts` (`PRISM_TEST_POSTGRES_URL` gating).
      - Postgres `tsvector`/`ts_rank` docs (for the lexical leg consumed by Task 6).
    - Options Considered:
      - `float8[]` column + app-side cosine vs. pgvector `vector` + HNSW — chosen: pgvector/HNSW (spec requires HNSW; index-backed at 100k chunks).
      - Adapter-managed migrations vs. exported DDL builder applied by host — chosen: exported DDL builder (spec: "Prism DDL applied only on the host's knowledge database"); no silent migration side effects.
    - Chosen Approach:
      - **Extend, don't rebuild** (confirmed by Task 1): the durable pgvector store already exists inside `createPostgresMemoryStores` (`postgres.ts:L188-L320`). Extract its statement builders into a shared internal factory so a standalone `createPostgresVectorStore({ pool; schema?; table?; dimension? })` exposes the spec surface while `createPostgresMemoryStores().vectorStore` gains the same capabilities (backwards-compatible widening). Add `getBySource` + `transaction(fn)` (bind operations to one checked-out `PoolClient`, BEGIN/COMMIT/ROLLBACK), HNSW index, tsvector generated column + GIN index, and `embedder_id`/`content_hash`/`generation` columns via additive `ADD COLUMN IF NOT EXISTS` in the DDL builder. Current-generation pointer table for swap semantics (Task 6). Integration tests gated on `PRISM_TEST_POSTGRES_URL` like the existing suite.
    - API Notes and Examples:
      ```sql
      CREATE INDEX IF NOT EXISTS <table>_emb_hnsw ON <table> USING hnsw (embedding vector_cosine_ops);
      -- upsert cast: $n::vector ; delete-by-source within the caller's transaction
      DELETE FROM <table> WHERE tenant_id=$1 AND resource_id=$2 AND thread_id=$3 AND source_id=$4;
      ```
    - Files to Create/Edit:
      - `packages/memory/src/postgres.ts`: extend/extract pgvector store — `getBySource`, `transaction`, standalone `createPostgresVectorStore` factory sharing statement builders.
      - `packages/memory/src/postgres-ddl.ts`: HNSW index, tsvector column + GIN index, `embedder_id`/`content_hash`/`generation` columns, current-generation pointer table.
      - `packages/memory/src/index.ts`: exports (`createPostgresVectorStore`, DDL builder).
      - `packages/memory/package.json`: add `pg` + `@types/pg` (peer/dev as in `postgres.ts` precedent).
      - `packages/memory/src/__tests__/postgres-vector.integration.test.ts`: new.
    - References:
      - Request P1; acceptance criteria kill-process atomicity (tested as rollback-inside-operation + post-commit assertions since a real SIGKILL mid-txn is equivalent to rollback).
  - Test Cases to Write:
    - Atomicity: operation throws after upserts → prior chunks still retrieve; committed run → only new chunks retrieve.
    - `getBySource` exact scope; foreign-scope reads return nothing and cross-scope writes fail closed.
    - HNSW cosine query returns nearest-first ordering matching brute-force on a small fixture.
    - DDL builder: identifier injection attempt (table name with `"; DROP`) rejected by validator.
    - Integration gating: skipped with reason when `PRISM_TEST_POSTGRES_URL` unset.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new package export + DDL surface.
    - Docs pages to create/edit:
      - `docs/postgres-persistence.md`: `createPostgresVectorStore` section (inputs, DDL ownership, extension requirements) — combined with Task 11.
    - `docs/index.md` update: yes — persistence group gains the adapter mention (Task 11).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4: Hybrid retrieve — lexical path, RRF fusion, retrieval labels — request P2
  - **Completed.** Changes: `packages/rag/src/fusion.ts` (new — pure `fuseReciprocalRank(vectorHits, lexicalHits, rrfK)` → `FusedCandidate {hit, retrieval: "vector"|"lexical"|"hybrid"}`, Σ1/(rrfK+rank), deterministic ties by best-rank then id, vector-leg hit object wins on doubles); `types.ts` (`RagProvenance.retrieval` widened to the union; `RetrieveContextOptions.lexical?/fusion?/rrfK?`); `limits.ts` (`DEFAULT_RRF_K=60`, `HARD_RRF_K_CAP=1000`, `rrfK` in `RagLimits`); `retrieve.ts` (option validation fail-closed; two-leg orchestration — vector leg unchanged, lexical leg calls optional `store.lexicalQuery({scope triple, text: safeQuery, topK: queryCandidates, signal})`, fused loop keeps scope-assert → embedder-mismatch → parse order with per-hit retrieval label and pre-rerank `retrievalRank`). Default semantics: omitted `lexical` runs fts when the store declares capability, silently skips otherwise; explicit `"fts"`/`"bm25"` on an unsupported store throws `RagValidationError`; `"bm25"` additionally requires declared BM25 mode; `"off"` byte-preserves legacy single-leg behavior (verified by spy test). Memory adapter: `vector-memory.ts` ships tokenized-overlap `lexicalQuery` + `lexicalModes: ["fts"]` (shared `tokenizeLexical` exported). PG adapter: `postgres.ts` gains conditional tsvector/ts_rank `lexicalQuery` via `websearch_to_tsquery('english', …)`, attached only when a new `textTsvAvailable` probe confirms the column exists (never lies about capability). DDL fix discovered by live run: pgvector cannot build HNSW over untyped `vector` columns and the failed multi-statement DDL rolled back the tsvector piece — `buildVectorSearchDdl(schema, table, dimension?)` now emits HNSW only when a dimension is declared, and both factories pin `vector(N)` **before** applying search DDL. No adapter declares bm25 yet (# ponytail noted in source): capability seam exists, any explicit bm25 request fails closed until a ParadeDB dependency is justified. Exports: rag (`fuseReciprocalRank`, `FusedCandidate`, `RetrievalLeg`), memory (`tokenizeLexical`, `VectorLexicalQuery`, `LexicalMode`). Tests: fusion unit tests with hand-computed RRF incl. dedupe/tie-breaks; stub-store leg-label ordering + redacted-text-to-lexical-leg spy + `lexical:"off"` zero-call regression + full fail-closed matrix (no-capability fts, no-bm25-mode, unknown fusion, rrfK 0/1001) + real memory-store hybrid end-to-end; memory-store tokenized-overlap suite; gated PG live test for ts_rank lexical hits + scope isolation + HNSW index presence on pinned stores. Verified against live pgvector/pg16: PG integration 10/10 (zero skips), rag 24/24, memory 16/16, alibaba 10/10, full build clean.
  - Acceptance Criteria:
    - Functional: `RetrieveContextOptions` accepts `lexical?: "fts" | "bm25" | "off"` (default `"fts"` when the store supports lexical, else treated as `"off"` only if explicitly `"off"` — unsupported non-off values fail closed `RagValidationError`), `fusion?: "rrf"` (only supported value; default), `rrfK?: number` (default 60, capped). Vector leg runs as today; lexical leg calls an optional `lexicalQuery` on the store; hits fuse via RRF `Σ 1/(rrfK + rank)`. Each hit's `provenance.retrieval` widens to `"vector" | "lexical" | "hybrid"` (additive union); `retrievalRank` is the pre-rerank fused rank. Metadata filter + scope recheck unchanged. `lexical: "bm25"` requires store-declared BM25 support (PG adapter with `pg_search` present); unavailable → fail closed, never silent degrade. Memory store ships an equivalent tokenized-overlap lexical implementation labeled `fts` so tests stay offline.
    - Performance: Both legs bounded by `queryCandidates`; fusion is O(n) over ≤2·candidates; rerank path unchanged; no extra embed calls.
    - Code Quality: Fusion is a pure function unit-testable without stores; option validation goes through `resolveRagLimits` extension.
    - Security: Lexical query text passes the same redactor as vector query; scope asserted on lexical hits identically.
  - Approach:
    - Documentation Reviewed:
      - `packages/rag/src/retrieve.ts:L22-L137` (current single-leg flow, rank assignment, render loop); `packages/rag/src/limits.ts` (cap pattern); Postgres `ts_rank` docs; ParadeDB `pg_search` BM25 (extension presence check via `SELECT 1 FROM pg_extension WHERE extname='pg_search'` or adapter option flag — chosen: explicit adapter capability flag, lazy and dependency-free).
    - Options Considered:
      - Fuse scores (normalized) vs. rank-fuse RRF — chosen: RRF per spec (score-scale-free, robust across legs).
      - Lexical inside `retrieveContext` via SQL strings vs. store method — chosen: optional `lexicalQuery?(q: {text, scope, topK, signal})` on `VectorStore`; keeps dialect ownership per adapter (repo precedent: "SQL dialect stays per-adapter").
    - Chosen Approach:
      - Extend `types.ts` (`RagProvenance.retrieval` union, options), `limits.ts` (`rrfK` bounds), new `fusion.ts` pure RRF, `retrieve.ts` two-leg orchestration keeping today's ordering/render/citation behavior byte-compatible when `lexical:"off"` and no reranker.
    - API Notes and Examples:
      ```ts
      await retrieveContext(query, { embedder, store, scope, lexical: "fts", fusion: "rrf", rrfK: 60, topK: 8, queryCandidates: 32 });
      ```
    - Files to Create/Edit:
      - `packages/rag/src/types.ts`, `limits.ts`, `retrieve.ts`, new `fusion.ts`, `index.ts` exports.
      - `packages/memory/src/vector-memory.ts` + `packages/memory/src/postgres-vector.ts`: `lexicalQuery` implementations (tokenized overlap / tsvector-ts_rank).
    - References:
      - Request P2; fixture acceptance criteria (lexical-only hit vector misses; paraphrase hit FTS misses; fused list RRF-ordered).
  - Test Cases to Write:
    - Fixture A: exact-term document retrieved lexically but absent from top vector hits → appears fused, labeled `lexical`.
    - Fixture B: paraphrase hit strong vector-only score → labeled `vector`.
    - Hit appearing in both lists → `hybrid`, RRF order verified against hand-computed ranks.
    - `rrfK` bounds enforced; unknown `fusion` value rejected; `bm25` on store without capability → fail-closed error.
    - `lexical:"off"` regression: results byte-equal to pre-change behavior on existing fixtures.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new options, widened provenance type, store capability seam.
    - Docs pages to create/edit:
      - `docs/rag.md`: hybrid retrieval section (options table, RRF formula, capability matrix memory vs. postgres) — Task 11.
    - `docs/index.md` update: yes — Task 11.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5: Hash skip inside `replaceSource` — request P4
  - **Completed.** Changes: `packages/rag/src/hash.ts` (new — pure `isValidContentHash`: hex digest, 32..128 chars, host-supplied hashes never computed over unbounded bytes in-engine); `types.ts` (`ReplaceSourceOptions.contentHash?/skipIfUnchanged?`, `IndexChunksOptions.contentHash?/reuseEmbeddings?`, `ReusableEmbedding {text, embedding}`); `indexing.ts` (stamps `_rag.contentHash` into record metadata pre-`assertBytes`; embeds only the delta — chunks whose id+redacted-text match a `reuseEmbeddings` entry reuse the stored vector, fresh embedder calls cover the rest, and every vector passes the existing length/finiteness validation); `sources.ts` (`SourceMutationResult.skipped?: true`; one `getBySource` read before staging decides: all stored records carrying a matching `_rag.contentHash` → `{indexed: 0, skipped: true}` with zero embeds/writes and status set indexed; otherwise builds a reuse map from previous records filtered by `embedderId === options.embedder.id` so cross-embedder drift forces fresh embeddings; `skipIfUnchanged: false` bypasses BOTH the doc skip and reuse — full rebuild semantics per acceptance). Chunk-level delta uses direct id+text comparison rather than stored chunk hashes (# ponytail: text equality is strictly stronger than hash equality here; add `_rag.chunkHash` stamping only if cross-process diffs ever need it without loading texts). Exports: `isValidContentHash`, `ReusableEmbedding`. Tests: unchanged-hash double-call → `{indexed:0, skipped:true}` with embed-call counter frozen at 1; hash change → full replace + new digest stamped lowercase on records; one-paragraph edit → exactly one delta embed call and survivor embedding byte-identical while edited text updates; `skipIfUnchanged:false` forces re-embed (calls 1→2); legacy unhashed store never skips; malformed digest rejected by `RagValidationError /hex digest/`; pure validator unit asserts. Verified: rag 28/28, memory 16/16, build clean.
  - Acceptance Criteria:
    - Functional: `ReplaceSourceOptions` gains `contentHash?: string` and `skipIfUnchanged?: boolean` (default true when hash present). If the current ready source's stored hash matches → return `{ indexed: 0, skipped: true }` with zero embed calls and zero delete/upserts. Chunks may carry `contentHash`; chunk-level delta reuses stored embeddings for unchanged texts (re-embed only the delta). Document-level skip is required; chunk-level ships in this release per spec allowance.
    - Performance: Unchanged re-index performs zero embed calls (acceptance criterion) and one `getBySource` read.
    - Code Quality: Hash comparison helper pure + unit-tested; result type extended additively (`skipped?: true`).
    - Security: `contentHash` validated (bounded hex string); hash comes from host, never computed over unbounded bytes inside the engine.
  - Approach:
    - Documentation Reviewed:
      - `packages/rag/src/sources.ts:L22-L74` (`replaceSource`, `setStatus`), `L124-L144` (`sourceRecords`); `SourceMutationResult` shape.
    - Options Considered:
      - Compute SHA-256 internally from chunk text vs. host-supplied document hash — chosen: both (host doc hash gates the whole source; chunk text hashes derived deterministically in-engine for chunk-level reuse, capped by existing chunk limits).
    - Chosen Approach:
      - Read existing records via `getBySource` before staging; compare `_rag.contentHash` (stored on record metadata by indexing, or top-level `contentHash` field added in Task 2 — follow Task 2's decision). Match → skip entirely. Else diff chunk hashes against stored per-chunk hashes; reuse embeddings of unchanged chunk ids/texts; embed only deltas; all writes inside the store `transaction`.
    - API Notes and Examples:
      ```ts
      const r = await replaceSource({ ..., contentHash: sha256(bytes), skipIfUnchanged: true });
      // r => { indexed: 0, skipped: true } on unchanged bytes
      ```
    - Files to Create/Edit:
      - `packages/rag/src/types.ts` (`ReplaceSourceOptions`, `SourceMutationResult`, chunk `contentHash?` on `RagChunk.metadata` contract), `sources.ts`, `indexing.ts` (persist per-chunk hash).
    - References:
      - Request P4; acceptance criterion "zero embed calls on unchanged bytes".
  - Test Cases to Write:
    - Same hash twice → second call `{indexed: 0, skipped: true}`, embed call count 0 (counting embedder).
    - Changed hash → full replace, old chunks gone.
    - Chunk-level: one paragraph edited → embed called only for delta chunks; surviving chunks keep embeddings (assert via embedder call log).
    - `skipIfUnchanged: false` forces re-embed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new options/result fields.
    - Docs pages to create/edit: `docs/rag.md` hash-skip section — Task 11.
    - `docs/index.md` update: yes — Task 11.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 6: Generation visibility — request P6
  - **Completed.** `MemoryVectorRecord.generation?: bigint \| number` (integer-validated, ≥0, on both adapters). Durable adapter: scope pointer table `<table>_rag_scope_generations(tenant_id, resource_id, thread_id, current_generation)` (replaces Task 3's never-used per-source `knowledge_generation` dead table); `getCurrentGeneration`/`setCurrentGeneration` (UPSERT) on the store and inside transactions via the shared `createVectorMethods` binding; query + lexical SQL fold visibility into one predicate: `generation IS NULL OR generation = COALESCE((SELECT current_generation ...), generation)` — no JS post-filter; no pointer row = everything visible. Memory adapter: current derived from max present generation unless explicitly pointed (rollback), pointers staged transactionally (`# ponytail:` noted); legacy rows (no generation) always retrievable. `replaceSource` reads pointer → stamps chunks at N+1 → advances pointer, all inside the caller's transaction; stores without generation tracking keep legacy behavior; skip path never bumps. Retrieval filtering stays store-side — `retrieveContext` untouched except reporting: `rag.index_generation` attribute now flows to `rag_request` and `rag_index` spans (Task 9 seam). Rollback recipe: host re-seeds or keeps prior-generation rows, then `store.setCurrentGeneration(scope, n)`; previous generations remain readable via explicit `getBySource`. Tests: memory unit suite covers derive/swap/rollback/bigint/validation/tx-pointer-rollback/scope-isolation; rag suites cover N+1 stamping, pointer advance, skip-no-bump, model-upgrade journey (A→B rebuild, old-model retrieval fails closed with ERR_PRISM_RAG_EMBEDDER_MISMATCH, pre-generation rows with embedderId stay retrievable); PG integration (live pgvector) covers pointer filter on query AND fts legs, rollback, validation; telemetry test asserts generation attrs on both span roots. Verified: memory 20/20, rag 34/34 (incl. fusion+telemetry), full workspace build clean, biome clean, full `npm test` 0 failures, live-PG `test:postgres` all fail 0.
  - Acceptance Criteria:
    - Functional: `MemoryVectorRecord.generation?: bigint | number` (monotonic per exact scope). Durable adapter tracks a current-generation pointer per scope updated in the same transaction as `replaceSource`'s writes; memory adapter derives current = max generation present. Retrieval returns only records whose `generation === current` (records without generation = legacy, remain retrievable until the host re-indexes). Corpus re-embed flow documented: build N+1 with new `embedderId`, swap current; previous generation readable via `getBySource`-style explicit read until dropped.
    - Performance: Generation filter folded into existing store `query` predicate (SQL WHERE / memory filter) — no post-filter in JS for the durable path.
    - Code Quality: Swap logic lives in the store adapters, not in `retrieveContext`; `replaceSource` auto-increments.
    - Security: Generation is integer-validated; scope-keyed like all other state.
  - Approach:
    - Documentation Reviewed:
      - Request P6 ("Postgres analog of an ES alias", explicitly *not* a second physical alias API); `vector-memory.ts` transaction pattern; Task 3 DDL.
    - Options Considered:
      - Current-pointer table vs. max()-derived current — chosen: pointer table on durable adapter (spec requires readable-for-rollback previous generation, which max() cannot express once N+1 lands... actually max() equals newest; rollback needs explicit swap, hence pointer); memory adapter uses max() (test-only convenience, `ponytail:` comment noting ceiling).
    - Chosen Approach:
      - DDL adds `*_rag_scope_generations(tenant_id, resource_id, thread_id, current_generation)`; `replaceSource` reads pointer, writes chunks at N+1, advances pointer — all in the caller's `transaction`. `query()` joins/filters `generation IS NULL OR generation = current`. Explicit `setCurrentGeneration(scope, n)` on the durable adapter for the model-upgrade swap.
    - API Notes and Examples:
      ```ts
      // model upgrade: build gen N+1 with new embedder, then
      await store.setCurrentGeneration(scope, nextGen);
      ```
    - Files to Create/Edit:
      - `packages/memory/src/postgres-vector.ts` (pointer table + filter + swap), `vector-memory.ts` (max-derived filter), `packages/rag/src/sources.ts` (auto-increment write), `packages/rag/src/retrieve.ts` (pass-through; filtering stays store-side).
    - References:
      - Request P6; acceptance criteria "after swap, retrieve never returns old generation".
  - Test Cases to Write:
    - Replace commits generation N+1; retrieve shows only new chunks (fixture mirrors kill-process criteria from Task 3).
    - Legacy rows (no generation) still retrievable; mixed legacy+generated scopes behave per filter rule.
    - Model-upgrade journey: index with A → swap to B-built generation → retrieve with B succeeds, A-era rows invisible; traces (Task 9) show new generation.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — record field, adapter methods, retrieval semantics.
    - Docs pages to create/edit: `docs/rag.md` generations section (re-embed/rollback recipe) — Task 11.
    - `docs/index.md` update: yes — Task 11.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 7: Structure metadata on chunks — request P5
  - **Completed.** `chunkMarkdown` now stamps `metadata.heading` on every chunk under an ATX heading — ordered array of heading texts, parents first (`["Policy", "3.2 Leave"]`). Pre-heading preamble chunks carry no `heading` key (no crash). Caller-supplied `metadata.heading` takes precedence over auto-stamp. `chunkText` (plain mode) never stamps headings. Implementation: single-line pre-scan collects heading positions (`#`–`######`, trim, no closing-hash / inline-style support — `# ponytail:` setext/ATX-edge cases noted as future work if fixtures demand them); the chunk loop advances a heading stack in lockstep — O(n) one-pass, no new deps. Offset/start/end/`sourceId#0001` ids byte-identical — existing deterministic + section-boundary fixtures unchanged and passing. Parser metadata propagation verified already handled by `mergeMetadata` (parser fields win over caller-supplied) — locked with a regression test through `replaceDocument` (fake loader+parser returning `{page:2, section:"intro"}` → chunks carry both). Security criterion satisfied by existing caps: caller metadata is bounded by `assertBytes(…, 64KB)` in `chunkDocument`, heading text is document-derived and so bounded by `maxDocumentChars` — no new byte path. Tests: heading-stack nesting + preamble + precedence + plain-text + parser propagation added, all green. Verified: rag suites 38/38, full workspace build clean, biome clean, full `npm test` 0 failures.
  - Notes: heading stack is reset per `chunkMarkdown` call — no cross-document state; setext headers (`===`/`---`) intentionally ignored (not in acceptance).
  - Acceptance Criteria:
    - Functional: `chunkMarkdown` stamps `metadata.heading` on every chunk — array/string form recording the current heading stack including parent headings (e.g. `["Policy", "3.2 Leave"]` for a chunk under `## 3.2 Leave` in `# Policy`). Host `Parser` metadata (`page`, `section`, …) copied onto chunks by `replaceDocument`/chunker merge. Offsets and stable `sourceId#0001` ids unchanged. No semantic chunking.
    - Performance: Heading tracking is a single pass alongside existing scan — O(n) unchanged.
    - Code Quality: Heading stack maintained inside `chunkDocument`; no new deps.
    - Security: Headings are document text → pass through existing metadata byte caps (`maxMetadataBytes`).
  - Approach:
    - Documentation Reviewed:
      - `packages/rag/src/chunk.ts:L14-L57` (`chunkDocument`, `preferredEnd`), `mergeMetadata` in `sources.ts:L119-L122`, existing tests asserting stable ids.
    - Options Considered:
      - Heading string (`"# Policy > ## 3.2 Leave"`) vs. structured stack — chosen: ordered array of heading texts (parents first) — machine-consumable, trivially joinable.
    - Chosen Approach:
      - Track ATX heading stack while scanning; stamp `metadata.heading` unless caller supplied one. `replaceDocument` already merges parser metadata via `mergeMetadata` — extend the chunk-stamping step so parser fields land on each chunk's metadata alongside `_rag`.
    - Files to Create/Edit:
      - `packages/rag/src/chunk.ts`, `packages/rag/src/sources.ts`, `packages/rag/src/types.ts` (document the `heading` metadata key on `ChunkOptions`/`RagChunk`).
    - References:
      - Request P5; acceptance criterion "`## 3.2 Leave` chunks include that heading and parent `# Policy`".
  - Test Cases to Write:
    - Nested markdown fixture → every chunk under `## 3.2 Leave` has `metadata.heading` containing `Policy` and `3.2 Leave`.
    - Pre-heading preamble chunk → empty/absent heading stack, no crash.
    - Parser metadata propagation: fake parser returning `{page: 2}` → chunk metadata includes `page: 2`.
    - Offsets/id stability regression: existing chunk fixtures byte-identical apart from new metadata key.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — chunk metadata contract addition.
    - Docs pages to create/edit: `docs/rag.md` chunking section — Task 11.
    - `docs/index.md` update: yes — Task 11.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 8: In-cluster TEI reranker adapter — request P8
  - **Completed.** New `packages/rag/src/tei-reranker.ts` exporting `createTeiReranker({ baseUrl, model?, timeoutMs? (default 2000), maxResponseBytes? (default 65,536), ssrf?, allowLoopback?, fetch? }): Reranker`. Posts `{query, texts, raw_scores:false}` (+ optional `model`) to `<baseUrl>/rerank` (trailing-slash-safe join), maps `results[{index,score}]` to a **permutation-only reorder of the same hit objects** — provenance/trust untouched by reference (verified in test). Strict response parse: results array length must equal hits length; index must be an in-range integer, unique, finite score — any violation fails closed with `RagValidationError`. HTTP !ok, non-JSON body fail closed; oversized select set exceeds `maxRerankBytes` → rejected by `rerankHits` seam before any fetch (test asserts `fetch` never called). Per-call `timeoutMs` via `AbortSignal.timeout` combined with caller signal (`AbortSignal.any`); timeout → `RagLimitError` (plans test: slow server at 500ms vs 50ms bound). Response body bounded both by the pinned transport (`MediaContentError` converted to `RagLimitError`) and by local `readBoundedBody` for injected fetches. Transport defaults to core `pinnedFetch` (DNS-pinned, redirect-free, SSRF-checked, no credentials/fragment allowed) with `ssrf`/`allowLoopback` passthrough, mirroring the OPA adapter precedent; hosts may inject their own `fetch` for cluster networking (OPA precedent). Construction rejects empty/non-http(s) URLs, embedded credentials, and bad limits. No SaaS default URL. Exported from `packages/rag/src/index.ts` (`createTeiReranker` + `CreateTeiRerankerOptions` type).
  - Tests (`packages/rag/src/__tests__/tei-reranker.test.ts`, 4 tests, local http server on 127.0.0.1 with `allowLoopback`): reorder + same-reference provenance/trust + payload shape (`raw_scores:false`, texts order); fail-closed matrix (short/duplicate/out-of-range/NaN/null scores, HTTP 500, malformed JSON); body-bound + timeout; construction rejections + seam `maxRerankBytes` pre-fetch rejection. Verified: rag suites 42/42, workspace build clean, biome clean, full `npm test` 0 failures. Docs (`docs/rag.md` TEI subsection, `docs/index.md` entry) belong to Task 11.
  - Acceptance Criteria:
    - Functional: `createTeiReranker({ baseUrl, model?, timeoutMs? }): Reranker` posting `{query, texts, raw_scores:false}` to `<baseUrl>/rerank` (Hugging Face TEI REST), mapping `results[{index,score}]` to a permutation-only reorder of the provided `RagHit[]`. Provenance/trust untouched. Non-complete or out-of-range permutations, HTTP errors, timeout, or oversized payloads fail closed (existing rerank error family). Existing seam caps (`maxRerankBytes`, `maxRerankMs`, `rerankConcurrency`) still enforced by `rerankHits`. No credentials, no SaaS default URL.
    - Performance: One batched POST per rerank invocation; `timeoutMs` → `AbortSignal.timeout` combined with caller signal.
    - Code Quality: Fetch via core `pinnedFetch` precedent where applicable; response body size-bounded like other outbound reads (65,536 ceiling precedent from plan 021).
    - Security: HTTPS or loopback/http(s) cluster URLs accepted; adapter validates URL shape but policy enforcement stays host-side (documented); response parsed strictly (array length == hits length).
  - Approach:
    - Documentation Reviewed:
      - TEI REST quick tour: `curl 127.0.0.1:8080/rerank -d '{"query":..., "texts":[...], "raw_scores":false}'` → `[{index,score}]`; TEI OpenAPI (`/docs` route).
      - `packages/rag/src/rerank.ts` (`rerankHits`, caps, redacted candidates), existing Reranker seam tests.
    - Options Considered:
      - OpenAI-compatible `/v1/rerank` shape vs. native TEI shape — chosen: native TEI shape (spec names TEI first; OpenAI-compatible noted as compatible because payload/response superset handling can accept both `results` arrays).
    - Chosen Approach:
      - Single file `tei-reranker.ts`; strict JSON parse; map scores onto hits by index; sort desc; verify permutation completeness before returning.
    - API Notes and Examples:
      ```ts
      const reranker = createTeiReranker({ baseUrl: "http://tei.svc:8080", model: "bge-reranker-v2-m3", timeoutMs: 500 });
      ```
    - Files to Create/Edit:
      - `packages/rag/src/tei-reranker.ts` (new), `packages/rag/src/index.ts` (export).
    - References:
      - Request P8; acceptance criterion "fake TEI endpoint reorders candidates; timeout/oversized fail closed; provenance kept".
  - Test Cases to Write:
    - Fake endpoint (local http server) returns reversed indices → hits reordered, trust/provenance objects identical by reference.
    - Malformed response (short array, dup index, NaN score) → fail-closed error.
    - Timeout via never-responding server → abort error within bound.
    - Oversized text set exceeding `maxRerankBytes` → rejected before fetch.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new export.
    - Docs pages to create/edit: `docs/rag.md` rerank section gains TEI adapter subsection (URL ownership, security notes) — Task 11.
    - `docs/index.md` update: yes — Task 11.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 9: RAG OpenTelemetry spans/events — request P7
  - **Completed.** (User requested this as "task 6 RAG telemetry seam"; it is Task 9 in this plan — Task 6 is generation visibility, still open.) Changes: `packages/rag/src/telemetry.ts` (new — dependency-free seam: `RagTelemetry.startSpan(name, attributes?, parent?)` → `RagTelemetrySpan {setAttribute, addEvent, recordError, end}`; `recordError()` deliberately carries no message so error text never leaves the host); `types.ts` (`telemetry?` on `RetrieveContextOptions`; `telemetry?/telemetryParent?` on `IndexChunksOptions`, inherited by `ReplaceSourceOptions`); `retrieve.ts` (root `rag_request` span with `rag.scope.tenant_id`/`rag.embedder_id`/`rag.top_k`/`rag.lexical_mode`; children `embedding.query`, `retrieval.vector_search` (+`rag.vector_candidates`), `retrieval.lexical` (+`rag.lexical_candidates`), `retrieval.fusion` (+`rag.fused_candidates`), `retrieval.rerank`, `prompt.assembly` (+`rag.result_count`); `chunk_retrieved` events per final hit with `rag.chunk.source_id/id/rank/score/embedder_id`; shared `span()` helper = try/finally end + recordError, zero-cost when telemetry omitted via `?.`); `sources.ts` (`rag_index` root with tenant/source/embedder/chunk_count; skip path still opens+closes the root; passes itself as `telemetryParent`); `indexing.ts` (`embedding.index` child around the batch loop). `packages/observability-opentelemetry/src/rag-telemetry.ts` (new): `createRagTelemetry({tracer, meter?, attributeFilter?})` → PrismTracer adapter; allow-lists span names to the nine rag spans and attribute keys to `^rag\.[a-z0-9_.]+$`, event names to `chunk_retrieved`; unknown spans collapse to a no-op; `attributeFilter` transforms values (`undefined` drops) for tenant redaction; latency histogram `rag.operation.duration` per span when meter supplied; status ok/error from `recordError`. Exports: rag (`RagTelemetry`, `RagTelemetrySpan`, `RagTelemetryAttributeValue`), otel (`createRagTelemetry`, `CreateRagTelemetryOptions`). Build-graph fix: root `workspaces` reordered (memory, rag before observability-*) because the otel package now type-depends on rag's dist — without it workspace builds compiled otel against stale types. `@arnilo/prism-rag` added as otel devDependency. `rag.index_generation` attributes deferred until plan-Task 6 lands (records carry no generation yet; emitting a constant would be noise). Tests: rag recorder asserts exact hybrid tree order + parent linkage, required attrs, per-hit chunk events with exact key sets, no-text/no-title leakage scan (incl. error text), error flagging, `rag_index`+`embedding.index` nesting, and skip-path single-span; otel tests drive a REAL retrieveContext through the in-memory tracer (traceId/parentSpanId chain, latency samples ≥0), allow-list drops (unknown span/event/key), filter redaction + drop, error status. Verified: rag 31/31, otel 18/18, memory 16/16, alibaba 10/10, full workspace build clean.
  - Acceptance Criteria:
    - Functional: `prism-rag` defines a dependency-free optional telemetry seam (`telemetry?: RagTelemetry` on `RetrieveContextOptions` and `ReplaceSourceOptions`). `retrieveContext` opens root span `rag_request`, children `embedding.query`, `retrieval.vector_search`, `retrieval.lexical`, `retrieval.fusion`, `retrieval.rerank`, `prompt.assembly`; `replaceSource` opens `rag_index` with `embedding.index`. Required attributes: `rag.scope.tenant_id` (host-redactable via attribute hook), `rag.embedder_id`, `rag.index_generation`, `rag.top_k`, latency ms, candidate counts; `chunk_retrieved` events carrying `sourceId`, `chunkId`, `rank`, `score`, `embedderId`, `indexGeneration`. Raw chunk/document text never emitted by default. `@arnilo/prism-observability-opentelemetry` exports `createRagTelemetry({ tracer, meter?, attributeFilter? })` adapting OTel API to the seam; no host logger required.
    - Performance: When `telemetry` omitted → zero allocations/branch cost beyond one undefined check (matches "disabled instrumentation performs no per-delta span work" precedent).
    - Code Quality: Span lifecycle wrapped in one small helper (try/finally end with status); rag package stays dependency-free.
    - Security: Attribute allow-list; tenant id passes through optional redaction hook; events contain ids/scores only; indexing spans never log document bytes.
  - Approach:
    - Documentation Reviewed:
      - `packages/observability-opentelemetry/src/instrumentation.ts` (`PrismTracer` L15–L25, `InMemoryTelemetry` L140+, exporter-error isolation pattern); `docs/observability.md` attach pattern; request P7 span tree.
    - Options Considered:
      - Emit spans directly from rag via `@opentelemetry/api` dep vs. seam + otel-package adapter — chosen: seam + adapter (keeps rag dependency-free and lets hosts use the in-memory tracer in tests; mirrors how core stays otel-free).
    - Chosen Approach:
      - `RagTelemetry` interface in rag types (~startSpan/addEvent/setAttribute/end subset); instrumentation call sites at the seven boundaries; otel adapter maps names/attrs verbatim, enforces attribute allow-list + filter hook.
    - API Notes and Examples:
      ```ts
      import { createRagTelemetry } from "@arnilo/prism-observability-opentelemetry";
      await retrieveContext(q, { ..., telemetry: createRagTelemetry({ tracer }) });
      ```
    - Files to Create/Edit:
      - `packages/rag/src/telemetry.ts` (seam types + no-op), `retrieve.ts`, `sources.ts`, `types.ts`, `index.ts`.
      - `packages/observability-opentelemetry/src/rag-telemetry.ts` (new), `index.ts` (export).
    - References:
      - Request P7; acceptance criteria span-tree-with-in-memory-tracer and no-raw-text defaults.
  - Test Cases to Write:
    - In-memory tracer captures exact tree + attributes for a hybrid retrieve (all children present, latencies ≥ 0).
    - `chunk_retrieved` event fields exact; no `text`/`title` keys anywhere in recorded spans.
    - `attributeFilter` redacts tenant id.
    - Omitted telemetry → behavior byte-identical to today (existing suites green unchanged).
    - `rag_index` span on replaceSource with `rag.index_generation` set.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new options field in two packages, new otel export.
    - Docs pages to create/edit: `docs/observability.md` RAG section (span tree, attributes, privacy defaults) — Task 11.
    - `docs/index.md` update: yes — Task 11.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 10: Full-suite verification against request acceptance criteria
  - **Completed.** Gates: `npm run build` clean; `npm test` 1669/1669 core + all workspace suites, 0 failures; biome lint/format clean (12 files from Tasks 2–9 formatted); coverage gate exit 0 — rag lines **95.46** ≥ frozen 91.82 (branches 79.76, functions 96.75), otel above freeze, protected packages exempt per `scripts/coverage-thresholds.json`; `security:threat-suites` 50/50; `test:postgres` against live pgvector/pg16 all suites fail 0 with `postgres-vector.integration.test.js` 8/8 zero skips. No new runtime dependencies introduced anywhere (otel gains only a devDependency on rag for types); default gates stay network-free. Fixes at root cause during verification: plan 034 was missing from `plans/README.md` (docs index test failure) — row added; format drift fixed. Flake noted: core `field-policy.test.js` frozen-overhead benchmark failed once under parallel load and passed twice after (timing-sensitive, unrelated to RAG). Traceability matrix vs `prism-production-rag.md` §Acceptance criteria lives in `docs/_evidence/phase34-full-suite.md`: criteria 1–4, 7, 9 traced to passing tests (Tasks 2–5, 9); criteria 5 (heading metadata), 6 (generation swap), 8 (`createTeiReranker`) remain blocked on open plan-Tasks 7, 6, 8 respectively and require a re-run of this verification once they land.
  - Acceptance Criteria:
    - Functional: Every bullet in `prism-production-rag.md` §Acceptance criteria traced to a passing test (list the mapping in task completion notes): postgres atomicity, lexical/paraphrase fusion fixtures, embedder-mismatch throw, zero-embed hash skip, heading metadata, generation swap visibility, otel span tree without raw text, TEI reorder/fail-closed, memory+hash-embedder suites green, no new required cloud service.
    - Performance: Existing coverage thresholds hold (`scripts/coverage-thresholds.json`); rag/memory suites runtime not materially regressed.
    - Code Quality: Biome clean; additive-only compat except reviewed `Embedder.id` break (Task 11 gate).
    - Security: `npm run security:threat-suites` (or equivalent gate) green; no secrets/cloud creds introduced.
  - Approach:
    - Documentation Reviewed:
      - Root `package.json` test script (build-lock + node --test + workspace tests); `scripts/release-gate*` conventions from plans 023–030.
    - Options Considered:
      - New phase34 gate script vs. extending existing suites — chosen: extend package suites + one `scripts/phase34-freeze.test.mjs` only if a manifest/version-literal check is needed for the three bumped versions (mirror phase30 freeze precedent).
    - Chosen Approach:
      - Run full `npm test`; add acceptance-criteria traceability notes; fix regressions at root cause.
    - Files to Create/Edit:
      - `scripts/phase34-freeze.test.mjs`: tentative — version-literal freeze for the three 0.3.1 manifests if gate conventions require it.
    - References:
      - Plan 030 freeze script precedent; plan 023 quality-gate conventions.
  - Test Cases to Write:
    - Covered by tasks 2–9; this task runs the aggregate gates and records evidence.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (verification).
    - Docs pages to create/edit: none with reason — evidence lives in task notes/`docs/_evidence/` if needed.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Task 11: Documentation sweep + `docs/index.md`
  - **Completed.** Targeted additions to four pages (template headings retained):
    - `docs/rag.md`: What-it-does summary rewritten for heading-stack metadata, embedder-identity drift guards, content-hash skip, generation visibility, hybrid retrieval, TEI adapter; new Inputs rows (`heading`, `lexical`, `fusion`/`rrfK`, `contentHash`, `reuseEmbeddings`, `telemetry`/`telemetryParent`); Outputs updated (`retrieval` label `vector|lexical|hybrid`, `skipped?`, `embedderId`, `generation`, `getCurrentGeneration`/`setCurrentGeneration`); new Implementation examples (hybrid+TEI+telemetry, content-hash skip); Extension notes (TEI URL/SSRF ownership, hybrid/fusion with `fuseReciprocalRank`/`FusedCandidate`/`RetrievalLeg`/`LexicalMode`/`tokenizeLexical`, embedder mismatch error code, generation semantics); Security notes (privacy/identity boundary, heading passes `maxMetadataBytes`, content-hash/reuse never leak embeddings, TEI fail-closed parse + 65,536 response ceiling, telemetry allow-list, DDL-on-host-knowledge-db rule). Type names mentioned: `CreateTeiRerankerOptions`, `ReusableEmbedding`.
    - `docs/observability.md`: RAG span tree table (rag_request/rag_index roots + embedding.query/index, retrieval.vector_search/lexical/fusion/rerank, prompt.assembly children with attribute caps), `createRagTelemetry()` in APIs list, implementation example, span-name/`rag.*`-key allow-list + `attributeFilter` note.
    - `docs/working-and-semantic-memory.md`: standalone `createPostgresVectorStore` example (schema/table/dimension options, store surface incl. lexicalQuery + generation methods, `PostgresVectorStoreOptions` note), DDL-ownership extension bullet (`buildMemoryDdl`/`buildVectorSearchDdl`, generation pointer table, `text_tsv` GIN, HNSW-when-dimension-pinned, `skipMigrations`, host knowledge-db ownership, identifier validation/parameterization, dimension pins before HNSW).
    - `docs/index.md`: rag entry rewritten (hybrid, drift guards, hash skip, generations, TEI, heading metadata, telemetry seam); memory entry (+ `createPostgresVectorStore`, generation pointers); observability entry (+ RAG span tree); postgres-persistence entry cross-references `createPostgresVectorStore` without duplicating a nav link (nav-link test enforced one link per page).
  - Acceptance satisfied: all four pages updated; `docs/index.md` entries refreshed with functional descriptions; API sections follow the wiki template (What/When/Inputs/Outputs/Example/Extension/Security/Related — headings pre-existing, additions stay within them); spot-check: every export added by tasks 2–10 (`createPostgresVectorStore`, `createTeiReranker`, `createRagTelemetry`, `fuseReciprocalRank`, `isValidContentHash`, `tokenizeLexical`, `getCurrentGeneration`/`setCurrentGeneration`, `lexicalModes`/`lexicalQuery`, `buildMemoryDdl`/`buildVectorSearchDdl`, plus option/type names `PostgresVectorStoreOptions`, `CreateTeiRerankerOptions`, `ReusableEmbedding`, `LexicalMode`, `RetrievalLeg`, `RagTelemetry`) now appears in non-evidence docs (grep-verified per symbol); security criteria: privacy defaults stated (telemetry allow-list drops raw text), TEI URL/security ownership documented, DDL-on-host-knowledge-db rule stated.
  - Regression safety: docs gate (`docs.test.js`) passes — "exactly one navigation link per page" (fixed a second `working-and-semantic-memory.md` link I had added to the postgres entry) and the phase-10 rerank literal assertions (`host reranking, ingestion status`, `Reranker`, `maxRerankBytes`, etc.) all green. Full `npm test`: 0 failures.
  - Acceptance Criteria:
    - Functional: `docs/rag.md` covers hybrid retrieve, embedder identity/mismatch, hash skip, generations, heading metadata, TEI reranker, telemetry attachment; `docs/postgres-persistence.md` (or `working-and-semantic-memory.md`) covers `createPostgresVectorStore` + DDL ownership; `docs/observability.md` covers the RAG span tree; `docs/index.md` entries updated with functional descriptions. API sections follow the wiki page structure (What/When/Inputs/Outputs/Example/Extension/Security/Related).
    - Performance: n/a.
    - Code Quality: No undocumented public export from tasks 2–10 (spot-check against `packages/*/src/index.ts` diffs).
    - Security: Docs state privacy defaults (raw text off), URL/security ownership for TEI, and DDL-on-host-knowledge-db rule.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` (page structure, index rules); current `docs/rag.md`, `docs/observability.md`, `docs/index.md:75` rag entry.
    - Options Considered:
      - One mega-page rewrite vs. targeted section additions — chosen: targeted additions; existing page structure retained.
    - Chosen Approach:
      - Edit the four pages + index; use the API page template sections for each new export.
    - Files to Create/Edit:
      - `docs/rag.md`, `docs/postgres-persistence.md`, `docs/working-and-semantic-memory.md`, `docs/observability.md`, `docs/index.md`.
    - References:
      - prism-wiki.md; `docs/api-page-template.md`.
  - Test Cases to Write:
    - Doc-truth spot check: exported symbol grep vs. docs mentions (manual or extend `scripts/phase24-truth` conventions if cheap).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (this task *is* the documentation).
    - Docs pages to create/edit: listed above.
    - `docs/index.md` update: yes — refresh rag/memory/persistence/observability entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 12: Release 0.3.1 — one-version bumps for changed packages only, CHANGELOG, compat gate
  - **Completed.** Official `release.mjs bump --package … --type patch` on `@arnilo/prism-memory`, `@arnilo/prism-rag`, `@arnilo/prism-observability-opentelemetry` (0.3.0 → 0.3.1). Lockfile versions match. Internal `^0.3.0` ranges untouched (rag still peers `^0.3.0` on memory). Root + every other workspace package stay at pre-plan versions (`0.3.0`, except graft/wiki `0.0.1`). CHANGELOG `[0.3.1]` summarizes P1–P8; per-package changelogs gain matching entries. `docs/migration.md` `0.3.0 → 0.3.1` documents the required `Embedder.id` implementer break + additive opt-ins. `docs/release-and-install.md` adds `0.3.1 independent RAG engine patch` handoff (package tags, no root current-line change). Freeze test `scripts/phase34-freeze.test.mjs` wired into `npm test` (3/3). Compat baselines regenerated (`--update-baseline`): memory +9 names (`createPostgresVectorStore`, `buildVectorSearchDdl`, `tokenizeLexical`, `LexicalMode`, `VectorLexicalQuery`, `PostgresVector*`, `DEFAULT_VECTOR_TABLE`), rag +12 (`createTeiReranker`, `fuseReciprocalRank`, `isValidContentHash`, telemetry/fusion types), otel +2 (`createRagTelemetry`, `CreateRagTelemetryOptions`); **zero removals**. Independent ranges + tarball deny gate clean (59 packages). `--allow-break` not required — scanner is name-level; Embedder.id documented in migration. `scripts/budgets.json` root `unpackedBytes` re-baselined 3055343 → 3212522 (docs+CHANGELOG growth, same precedent as plan 033). `npm test` 0 failures. Full `release:gate` stays blocked on operator `PRISM_TEST_POSTGRES_URL` evidence only — publication remains operator handoff.
  - Acceptance Criteria:
    - Functional: Exactly three manifests move 0.3.0 → 0.3.1: `@arnilo/prism-rag`, `@arnilo/prism-memory`, `@arnilo/prism-observability-opentelemetry`. No other package.json version changes; internal ranges (`^0.3.0`, Decision B) remain untouched and still resolve. CHANGELOG gains a `[0.3.1]` entry summarizing P1–P8. Compat baseline regenerated (`--update-baseline`; `--allow-break` review for the required `Embedder.id` per plan 017 precedent). Publication remains operator handoff per `docs/release-and-install.md`.
    - Performance: n/a.
    - Code Quality: `grep -r '"version"'` audit confirms only the three bumps; freeze/gate scripts updated if they pin version literals.
    - Security: Supply-chain gates unchanged; no new dependencies beyond `pg` peer already established in Task 3.
  - Approach:
    - Documentation Reviewed:
      - `CHANGELOG.md` 0.3.0 entry (Decision B: "changed packages patch/minor independently inside `<0.4.0`"); `docs/release-and-install.md`; compat-gate usage from plan 017.
    - Options Considered:
      - Minor bump 0.3.0 → 0.4.0 vs. patch 0.3.1 — chosen: 0.3.1; Decision B constrains changes to `<0.4.0` and the user constraint fixes one-version bumps; repo precedent allows reviewed breaks inside patch lines (plan 017).
    - Chosen Approach:
      - Manual three-manifest bump, CHANGELOG entry, baseline regen, freeze-script literals if any, release:gate run.
    - Files to Create/Edit:
      - `packages/rag/package.json`, `packages/memory/package.json`, `packages/observability-opentelemetry/package.json` (versions only), `CHANGELOG.md`, compat baseline artifacts, possibly `scripts/phase34-freeze.test.mjs` from Task 10.
    - References:
      - User constraint ("only update the packages that change by one version"); Decision B; plan 017 breaking-cut precedent.
  - Test Cases to Write:
    - Freeze test asserting the three manifests equal 0.3.1 and all other workspace manifests still equal their pre-plan versions.
    - Full install/build/test cycle green post-bump.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (release line) — covered by CHANGELOG + `docs/release-and-install.md` if it enumerates versions (check during execution; edit if the page pins 0.3.0 literals).
    - Docs pages to create/edit: `docs/release-and-install.md`: conditional version-literal refresh.
    - `docs/index.md` update: only if it pins version literals (verify).
    - Documentation structure reference: prism-wiki.md.

- [x] Task 13: Multi-scope retrieve — one embed, per-scope legs, one RRF, one rerank
  - **Completed.** `RetrieveContextOptions` takes `scope?` or `scopes?` (never both, never neither). Empty `scopes` returns `{ hits: [], citations: [], truncated: false }` with no embed/query/lexical/rerank. N scopes: one `embedder.embed`, sequential per-scope `query`/`lexicalQuery` at `queryCandidates` each, internal `fuseReciprocalRankLists` (fusion key includes tenant/resource/thread/id), one `rerankHits`. `HARD_RETRIEVE_SCOPE_CAP = 8`. Dedup scopes. `rag.scope_count` on `rag_request`; `chunk_retrieved` adds `rag.chunk.tenant_id` + `rag.chunk.corpus_id`. Provenance now carries `tenantId`/`resourceId`/`corpusId`. `rag.index_generation` only when N=1. Public `fuseReciprocalRank(vector, lexical, rrfK)` unchanged. Tests: 4 multi-scope cases + telemetry `rag.scope_count`; existing retrieve/fusion/tei suites green (47 rag tests). Docs: `docs/rag.md`, `docs/observability.md`, `docs/index.md`.
  - Acceptance Criteria:
    - Functional: `retrieveContext` accepts either `scope` or `scopes` (never both). `scopes: []` returns `{ hits: [], citations: [], truncated: false }` and does not call `embed` / `store.query` / `lexicalQuery` / `reranker`. N>1 scopes: query embed once; vector (and lexical when on) run per exact scope against that scope’s current generation; one RRF over the union of all legs; one reranker call on the fused list; `hits.length <= topK`; each hit’s scope matches exactly one requested scope. A row stored under a non-requested corpus never appears. Embedder mismatch in any requested scope still throws `ERR_PRISM_RAG_EMBEDDER_MISMATCH`. Single-`scope` tests from Tasks 2/4/6/9 stay green. `queryCandidates` is **per scope**. Telemetry: `rag.scope_count` on `rag_request`; `chunk_retrieved` carries `rag.chunk.tenant_id` + `rag.chunk.corpus_id` (no raw text).
    - Performance: Extra cost is N store queries (and N lexical queries), not N embeds or N reranks. Scope count capped (`HARD_RETRIEVE_SCOPE_CAP`, 8). Sequential per-scope search (abort-safe); do not UNION-then-filter.
    - Code Quality: No `retrieveContextMulti`. Keep `fuseReciprocalRank(vector, lexical, rrfK)` public signature; add an internal N-list helper. `createRagContextProvider` inherits `scopes` via `RetrieveContextOptions`. Dedup requested scopes by `tenantId+resourceId+corpusId`.
    - Security: Fail-closed foreign-scope rows (existing `assertScope`). Trust triple unchanged. Reranker still cannot overwrite provenance/trust/scope. Empty `scopes` is the host “no allowed corpora” path — Prism does not see OpenFGA. Neither `scope` nor `scopes` throws `RagValidationError`. Scope ids validated with existing `requireScope` / `nonEmpty`.
  - Approach:
    - Documentation Reviewed:
      - `prism-multi-scope-retrieve.md` (requested behavior, ACs, out-of-scope).
      - `packages/rag/src/retrieve.ts:L24-L230` (single-scope embed → vector → lexical → RRF → rerank → assemble).
      - `packages/rag/src/types.ts:L205-L232` (`RetrieveContextOptions.scope` required today).
      - `packages/rag/src/fusion.ts` (`fuseReciprocalRank` two-list RRF).
      - `packages/rag/src/util.ts:L22-L28` (`requireScope`).
      - `packages/rag/src/limits.ts` (`HARD_QUERY_CANDIDATES_CAP` 128, `HARD_TOP_K_CAP` 32).
      - `packages/observability-opentelemetry/src/rag-telemetry.ts` (`rag.*` allow-list already matches `rag.scope_count` / `rag.chunk.tenant_id`).
    - Options Considered:
      - Host fan-out (N `retrieveContext` calls) — rejected by the FR (N embeds, N RRFs, N reranks, broken CitationList rank).
      - `retrieveContextMulti` second function — rejected; extend `retrieveContext`.
      - Global `queryCandidates` cap across all scopes vs per-scope — chosen: per-scope so a distinctive chunk in each of three corpora can survive the pre-fusion cut.
      - Change public `fuseReciprocalRank` to N lists — rejected; that is a signature change of an unpublished 0.3.1 export. Keep the 2-arg wrapper, internal N-list helper.
      - Parallel `Promise.all` per scope vs sequential — chosen: sequential (abort-safe, smaller). Parallel if p95 needs it.
    - Chosen Approach:
      - `scope?: RagScope; scopes?: readonly RagScope[]`. Resolve: both → `RagValidationError`; neither → `RagValidationError`; `scopes` (incl. `[]`) wins when present; `scope` ≡ `scopes: [scope]`.
      - Cap resolved scopes at 8. Dedup. Empty list → return existing empty result after query validation; skip embed/search/rerank; still emit `rag_request` with `rag.scope_count=0` if telemetry is on.
      - One `embedder.embed([safeQuery])`. For each scope: `getCurrentGeneration` (filter is already inside the store), `store.query({ threadId: corpusId, topK: queryCandidates })`, optional `lexicalQuery`. Collect legs. Fuse all legs with internal N-list RRF (fusion key `tenantId\0resourceId\0corpusId\0id` so cross-scope id collisions cannot merge). One `rerankHits`. Provenance scope stays the record’s stored scope.
      - `rag.index_generation` only when N=1 (compat). N>1 omits it (generations differ per scope).
    - API Notes and Examples:
      ```ts
      retrieveContext(query, {
        embedder, store,
        scopes: [org, user, session], // or scope: one
        lexical: "fts", fusion: "rrf", topK: 8, reranker,
      });
      // scopes: [] → { hits: [], citations: [], truncated: false } ; no embed
      ```
    - Files to Create/Edit:
      - `packages/rag/src/types.ts`: `scope?` + `scopes?`.
      - `packages/rag/src/retrieve.ts`: resolve scopes, one embed, per-scope legs, one fusion/rerank, telemetry attrs.
      - `packages/rag/src/fusion.ts`: internal N-list RRF; keep 2-arg public wrapper.
      - `packages/rag/src/limits.ts`: `HARD_RETRIEVE_SCOPE_CAP = 8`.
      - `packages/rag/src/__tests__/rag.test.ts`: FR cases below.
      - `packages/rag/src/__tests__/telemetry.test.ts`: `rag.scope_count` + chunk tenant/corpus.
      - `docs/rag.md`, `docs/observability.md`, `docs/index.md`: Inputs/example/security + `rag.scope_count`.
    - References:
      - `prism-multi-scope-retrieve.md`; Task 4 hybrid retrieve; Task 9 telemetry allow-list.
  - Test Cases to Write:
    - Three scopes, one distinctive chunk each: fused+reranked `hits.length <= topK`, all three sources can appear, each hit scope ∈ requested list.
    - Embed spy: `embedder.embed` called once for N=3.
    - Reranker spy: called once on the fused union, not per scope.
    - `scopes: []`: empty result; embed/query/lexicalQuery/reranker not called.
    - Both `scope` and `scopes` → `RagValidationError`.
    - Neither → `RagValidationError`.
    - Foreign corpus `{ tenantId: "org_a", corpusId: "user_other" }` never appears when scopes are org + `user_self` + session.
    - Embedder-B query vs embedder-A vectors in any requested scope → `ERR_PRISM_RAG_EMBEDDER_MISMATCH`.
    - Single-`scope` existing tests stay green (no fixture rewrite beyond types).
    - `queryCandidates` per scope: store.query `topK` equals resolved `queryCandidates` on each call.
    - Scope cap: 9 scopes → validation error.
    - Telemetry: `rag.scope_count` is 3; each `chunk_retrieved` has tenant_id + corpus_id; no raw text.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `RetrieveContextOptions.scope` becomes optional; new `scopes`; retrieve semantics for N≠1.
    - Docs pages to create/edit:
      - `docs/rag.md`: Inputs (`scopes`), example (org+user+session), security (empty list, reject both, fail-closed foreign, per-scope generation).
      - `docs/observability.md`: `rag.scope_count`; `chunk_retrieved` tenant/corpus attrs.
      - `docs/index.md`: rag entry mentions multi-scope retrieve.
    - `docs/index.md` update: yes — refresh rag one-liner; no new nav page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 14: Full-suite verification against multi-scope + P1–P8 acceptance
  - **Completed.** Gates: `npm run build` clean; `npm test` core 1669/1669 + workspace 350/350, 0 failures; `biome check` clean; freeze 3/3; budget 10/10; release-gate 8/8; live pgvector 26/26, 0 skip. All 8 `prism-multi-scope-retrieve.md` ACs traced to passing Task 13 tests (3-scope fusion, 1 embed, 1 rerank, empty-scopes skip, both/neither reject, foreign-corpus fail-close, embedder drift). All 9 `prism-production-rag.md` ACs green (P1–P9 unblocked since Tasks 6–8 landed). Docs truth: `scopes`, `HARD_RETRIEVE_SCOPE_CAP`, `rag.scope_count`, chunk tenant/corpus all present on `docs/rag.md`, `docs/observability.md`, `docs/index.md`. Compat surface additive-only — `HARD_RETRIEVE_SCOPE_CAP` is a new export name (defer baseline update to Task 15). `RagProvenance.tenantId`/`resourceId`/`corpusId` are interface member additions invisible to compat scanner. No new runtime dependencies. Evidence appended to `docs/_evidence/phase34-full-suite.md`.
  - Acceptance Criteria:
    - Functional: `npm test` 0 failures. Task 13 tests green. Existing P2/P3/P6/P7 retrieve tests still pass. Docs truth: `scopes`, `rag.scope_count`, `HARD_RETRIEVE_SCOPE_CAP` appear on the pages Task 13 named. `docs/index.md` still one nav link per page.
    - Performance: No new root-tarball budget break beyond Task 12 baseline; if docs push `unpackedBytes` over +5%, re-baseline with a comment (plan 033/034 precedent) rather than inventing a new budget system.
    - Code Quality: `npm run build` clean. No new dependencies. Compat surface vs Task 12 baseline is additive-only (optional `scopes` is a type-field, not a new export name — expect 0 new names unless an export was added).
    - Security: Confirm empty-`scopes` path does not embed; foreign-scope test still fail-closed; telemetry events still carry no raw chunk text.
  - Approach:
    - Documentation Reviewed:
      - Task 10 evidence style (`docs/_evidence/phase34-full-suite.md`); `prism-multi-scope-retrieve.md` AC list; `docs/rag.md` after Task 13.
    - Options Considered:
      - New evidence file vs append to `phase34-full-suite.md` — chosen: append a “Task 14 multi-scope” section so one artifact covers the release.
    - Chosen Approach:
      - Run rag unit + telemetry + memory + `npm test`. Grep docs for the new symbols. Record a short traceability table (FR AC → test name).
    - API Notes and Examples:
      ```bash
      npm test --workspace=@arnilo/prism-rag && npm test
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase34-full-suite.md`: append Task 14 results.
    - References:
      - Task 10; `prism-multi-scope-retrieve.md` Acceptance criteria.
  - Test Cases to Write:
    - None new (this task runs Task 13 + prior tests).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (verification).
    - Docs pages to create/edit: `docs/_evidence/phase34-full-suite.md` only.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Task 15: Release refresh — fold multi-scope into unpublished 0.3.1
  - **Completed.** No second version increment — manifests stay `@arnilo/prism-rag@0.3.1`, `@arnilo/prism-memory@0.3.1`, `@arnilo/prism-observability-opentelemetry@0.3.1`. Root `CHANGELOG.md` [0.3.1] gains multi-scope bullet. `packages/rag/CHANGELOG.md` [0.3.1] adds multi-scope + `HARD_RETRIEVE_SCOPE_CAP`. `docs/migration.md` 0.3.0 → 0.3.1 notes `scopes` as additive (`scope` still valid). `docs/release-and-install.md` 0.3.1 handoff mentions multi-scope + provenance fields. Compat baselines regenerated with `--update-baseline`: `HARD_RETRIEVE_SCOPE_CAP` (new export, additive) picked up; gate clean. Freeze 3/3 pass. Publication remains operator handoff.
  - Acceptance Criteria:
    - Functional: No second version increment. Manifests stay exactly the Task 12 set (`prism-rag` / `prism-memory` / `prism-observability-opentelemetry` at 0.3.1; everything else pre-plan). `CHANGELOG.md` `[0.3.1]` gains a multi-scope bullet. `docs/migration.md` `0.3.0 → 0.3.1` notes `scopes` as additive (`scope` still valid). Compat baseline regenerated only if Task 13 added a public name; expect additive / no `--allow-break`. Freeze test still asserts the three 0.3.1 manifests. Publication remains operator handoff.
    - Performance: n/a.
    - Code Quality: `scripts/phase34-freeze.test.mjs` still green. Independent ranges + tarball deny clean. Do not bump rag to 0.3.2 before the first 0.3.1 tag.
    - Security: Supply-chain gates unchanged; no new dependencies.
  - Approach:
    - Documentation Reviewed:
      - Task 12 completion notes; Decision B; user constraint (“only update the packages that change by one version”); `docs/release-and-install.md` `0.3.1 independent RAG engine patch`.
    - Options Considered:
      - Bump `@arnilo/prism-rag` 0.3.1 → 0.3.2 — rejected while 0.3.1 is unpublished (“Before publishing”); would be two increments from published 0.3.0.
      - New plan 035 as a separate 0.3.2 — rejected; user asked to add the FR back to this plan.
    - Chosen Approach:
      - Fold into unpublished 0.3.1: CHANGELOG + migration sentence + freeze (no version rewrite). If a new export name appeared, `--update-baseline`. If 0.3.1 is already tagged when this task runs, stop and bump **only** rag `0.3.1 → 0.3.2`.
    - API Notes and Examples:
      ```bash
      node --test scripts/phase34-freeze.test.mjs
      # only if a new export name landed:
      node scripts/release.mjs gate --update-baseline --skip-tarball
      ```
    - Files to Create/Edit:
      - `CHANGELOG.md`, `packages/rag/CHANGELOG.md`, `docs/migration.md`, `docs/release-and-install.md` (one-line multi-scope mention), compat baseline if needed.
    - References:
      - Task 12; Decision B; `prism-multi-scope-retrieve.md`.
  - Test Cases to Write:
    - Freeze test still: exactly three manifests at 0.3.1; ranges `^0.3.0`; CHANGELOG `[0.3.1]` names multi-scope / `scopes`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (release note only).
    - Docs pages to create/edit: `CHANGELOG.md`, `docs/migration.md`, `docs/release-and-install.md`.
    - `docs/index.md` update: no (Task 13 already refreshed the rag one-liner).
    - Documentation structure reference: prism-wiki.md.

## Compromises Made

- `@arnilo/prism-provider-alibaba` gained `Embedder.id` (Task 2 consumer) but stays at 0.3.0. Task 12 acceptance is exactly three manifests; default independent gate baselines against `v0.2.9` so the unbumped alibaba change still validates. A later `--baseline v0.3.0` check would require bumping alibaba too.
- Compat scanner is name-level only: required `Embedder.id` is a TypeScript implementer break documented in `docs/migration.md`, not a `--allow-break` name removal. Reviewed; no export removed.
- Package-level CHANGELOGs still skip 0.2.x/0.3.0 lockstep entries (pre-existing); only 0.3.1 is added.
- Roadmap `### 0.3.1 — Review` is the delegated-agent track, not this RAG patch. Left untouched to avoid colliding two 0.3.1 meanings. Root current line stays 0.3.0.
- Root tarball `unpackedBytes` crossed the 5% ceiling after Task 11 docs + Task 12 CHANGELOG. Re-baselined in `scripts/budgets.json` (plan 033 precedent); packedBytes/fileCount stayed inside the old ceiling.

## Further Actions

- Reopened for `prism-multi-scope-retrieve.md` (Tasks 13–15). **All tasks complete 2026-08-26.** Do not publish 0.3.1 until the operator handoff.
- Operator publication (after Task 15): tag `@arnilo/prism-memory@0.3.1`, `@arnilo/prism-rag@0.3.1`, `@arnilo/prism-observability-opentelemetry@0.3.1` and push (not this plan).
- Re-index existing 0.3.0 vector rows so they carry `embedderId` before retrieve; unstamped rows fail closed.
- Bump `@arnilo/prism-provider-alibaba` on the next alibaba-side change (or immediately if a `v0.3.0` baseline check is required).
