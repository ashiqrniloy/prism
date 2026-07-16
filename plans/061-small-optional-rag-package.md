# Small Optional RAG Package

## Objectives
- Add optional `@arnilo/prism-rag` for bounded plain-text/Markdown chunking, embedding/indexing, retrieval, and stable citations.
- Reuse Phase 7 `Embedder`/`VectorStore` and core `ContextProvider` without changing core input assembly or adding a document-framework dependency.
- Preserve mandatory tenant/resource/corpus isolation, abort propagation, redaction, deterministic output, and package/release boundaries.

## Expected Outcome
- Hosts can chunk text or Markdown, batch-index chunks into any Phase 7 vector store, retrieve bounded filtered top-K context, and attach it explicitly to an agent.
- RAG remains opt-in and excluded from profile bundles pending size/use review; all package, docs, examples, tests, and release gates pass.

## Tasks

- [x] Inventory reusable memory, context, resource, and package primitives
  - Acceptance Criteria:
    - Functional: identify existing contracts for embeddings, vector persistence, context injection, redaction, resource loading, and ownership scope.
    - Performance: identify reusable batching/query/token/byte bounds before defining new limits.
    - Code Quality: add no core or memory primitive when existing seams hold.
    - Security: preserve host-owned I/O and mandatory tenant/resource isolation; retrieved text grants no capability.
  - Approach:
    - Documentation Reviewed:
      - `docs/working-and-semantic-memory.md`, `docs/context-and-skills.md`, `docs/resource-loading.md`, `docs/multimodal-content.md`.
      - `packages/memory/src/types.ts`, `embedder.ts`, `vector-memory.ts`, `postgres.ts`, and `src/contracts.ts` ContextProvider definitions.
    - Options Considered:
      - Add RAG to core: rejected; unrelated optional document behavior.
      - Add another embedder/vector interface: rejected; Phase 7 contracts fit.
      - Reuse memory contracts and core context blocks: chosen.
    - Chosen Approach:
      - Map RAG `corpusId` to required `VectorStore.threadId`, source metadata to `MemoryVectorRecord.metadata`, and retrieval to bounded vector candidates plus deterministic package-local filtering/rendering.
    - API Notes and Examples:
      ```ts
      const scope = { tenantId: "t1", resourceId: "docs", corpusId: "handbook" };
      ```
    - Files to Create/Edit:
      - `plans/061-small-optional-rag-package.md`: inventory and executable plan.
    - References:
      - `roadmap.md` Phase 9 acceptance criteria; `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - No code test; implementation tasks prove reuse through memory-package contract imports and ContextProvider integration.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; inventory only.
    - Docs pages to create/edit:
      - none; implementation task owns public API docs.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Implement deterministic bounded chunking and indexing
  - Acceptance Criteria:
    - Functional: plain text and Markdown chunk deterministically with size/overlap/source metadata/stable citation IDs; indexing embeds and upserts in bounded batches and is idempotent for duplicate source content.
    - Performance: document chars, chunk chars/count, overlap, metadata bytes, vector dimensions, and embedding batch size have defaults and hard caps; abort is checked between all batches.
    - Code Quality: strict TypeScript, stdlib-only chunker, package-owned errors/types, no `any`, parser dependency, PDF/HTML/semantic chunking, or core edit.
    - Security: scope requires non-empty tenant/resource/corpus IDs; source text/metadata are redacted before persistence; package performs no filesystem/network access.
  - Approach:
    - Documentation Reviewed:
      - Phase 9 roadmap; Phase 7 `embedBatched`, `Embedder`, `VectorStore`, `MemoryVectorRecord`; resource-loader trust boundary docs.
    - Options Considered:
      - Fixed character windows only: smallest but poor Markdown boundaries.
      - Full Markdown AST dependency: rejected for initial scope.
      - Boundary-aware character windows preferring headings/paragraphs/newlines: chosen.
    - Chosen Approach:
      - `chunkText()` uses deterministic character ceilings and preferred boundary search; `chunkMarkdown()` shares engine with Markdown heading/paragraph preference. IDs derive from source ID + zero-padded chunk index; indexing maps corpus to vector thread and batches via Phase 7 helper.
    - API Notes and Examples:
      ```ts
      const chunks = chunkMarkdown(markdown, { sourceId: "guide", size: 1_000, overlap: 100 });
      await indexChunks({ chunks, embedder, store, scope, signal });
      ```
    - Files to Create/Edit:
      - `packages/rag/package.json`, `tsconfig.json`, `LICENSE`, `CHANGELOG.md`, `README.md`.
      - `packages/rag/src/{index,types,errors,limits,util,chunk,indexing}.ts`.
    - References:
      - `packages/memory/src/embedder.ts`, `packages/memory/src/types.ts`, `packages/memory/src/util.ts` behavior.
  - Test Cases to Write:
    - Deterministic text/Markdown boundaries, overlap, stable IDs, empty input, invalid/oversized input and limits.
    - Batch sizes, abort, vector mismatch, redacted persistence, and duplicate-source upsert idempotency.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new chunk/index exports.
    - Docs pages to create/edit:
      - `docs/rag.md`: chunking/indexing API, limits, trust boundary.
    - `docs/index.md` update: yes; add RAG under input/context assembly.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Implement bounded retrieval, filtering, citations, and context injection
  - Acceptance Criteria:
    - Functional: bounded semantic query supports shallow metadata filter, deterministic top-K ordering, stable citation records/rendering, and explicit ContextProvider injection using latest user text or host query callback.
    - Performance: candidate count, top-K, result bytes, and context tokens are bounded; query embed and vector query honor abort.
    - Code Quality: retrieval composes memory contracts and returns frozen typed values; no reranker/GraphRAG/extraction framework.
    - Security: vector hits are rechecked for exact tenant/resource/corpus scope, malformed foreign records fail closed, text/metadata are redacted, and context remains inert text.
  - Approach:
    - Documentation Reviewed:
      - `docs/context-and-skills.md`; core `ContextProvider`/`ContextResolutionContext`; memory vector query behavior.
    - Options Considered:
      - Extend `VectorQuery` with RAG filters: rejected; breaks generic Phase 7 contract/adapters.
      - Query bounded candidates then filter locally: chosen; portable across current stores.
    - Chosen Approach:
      - `retrieveContext()` embeds one query, requests capped candidates, validates/filters hits, truncates by result/context budgets, and renders `[citation-id] text`; `createRagContextProvider()` contributes one explicit context block.
    - API Notes and Examples:
      ```ts
      const result = await retrieveContext("How do approvals work?", { embedder, store, scope, topK: 4 });
      const provider = createRagContextProvider({ embedder, store, scope });
      ```
    - Files to Create/Edit:
      - `packages/rag/src/{retrieve,context}.ts`, `packages/rag/src/index.ts`, tests and README.
    - References:
      - `src/contracts.ts` ContextProvider; `packages/memory/src/vector-memory.ts` deterministic hit ordering.
  - Test Cases to Write:
    - Top-K/filter/citation rendering, result-byte truncation, query abort, malformed/cross-scope hit rejection.
    - Context provider latest-user query, token bound, prompt-injection text remains inert, and secret redaction.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; retrieval and ContextProvider exports.
    - Docs pages to create/edit:
      - `docs/rag.md`, `docs/working-and-semantic-memory.md`, `docs/context-and-skills.md`.
    - `docs/index.md` update: yes; RAG navigation entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Register package, document usage, and pass release validation
  - Acceptance Criteria:
    - Functional: workspace/package/export/example/install/pack registration is complete; package remains opt-in and example runs offline.
    - Performance: benchmark/package measurements stay within frozen ceilings and are recorded.
    - Code Quality: package build/typecheck/tests, examples, docs tests, install smoke, pack checks, audit, and `sdk:ready` pass.
    - Security: example uses mock embedder/store and no credentials; tarball excludes source/tests/maps; profile bundles do not activate RAG.
  - Approach:
    - Documentation Reviewed:
      - Existing package registration in `package.json`, packaging/install/docs tests, `docs/release-and-install.md`, and `examples/tsconfig.json`.
    - Options Considered:
      - Add RAG to `prism-all`: rejected pending measured size/use review.
      - Publish standalone optional package only: chosen.
    - Chosen Approach:
      - Register all hardcoded package inventory locations, add one offline example/API page, update cross-links/release inventory/review coverage/roadmap, then run focused and full gates.
    - API Notes and Examples:
      ```bash
      npm install @arnilo/prism @arnilo/prism-memory @arnilo/prism-rag
      npm run sdk:ready
      ```
    - Files to Create/Edit:
      - `package.json`, `package-lock.json`, `src/__tests__/{packaging,install-smoke,docs}.test.ts`.
      - `docs/{rag,index,migration,performance,release-and-install,review-coverage-2026-07-15}.md` and related memory/context docs.
      - `examples/rag.ts`, `examples/README.md`, `examples/tsconfig.json`, root `README.md`, `CHANGELOG.md`, `roadmap.md`.
      - `plans/061-small-optional-rag-package.md`.
    - References:
      - Existing `@arnilo/prism-memory` and `@arnilo/prism-evals` optional-package enrollment.
  - Test Cases to Write:
    - Public package import/install smoke; dry-run tarball contents; profile exclusion; docs headings/index/example coverage.
    - Full `npm run sdk:ready`, `npm audit`, package-size and test-count recording.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new optional package and docs navigation.
    - Docs pages to create/edit:
      - `docs/rag.md` plus index, memory/context, migration, release, review, and performance pages.
    - `docs/index.md` update: yes; add RAG under input, prompt, and context assembly.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Chunk sizes are deterministic UTF-16 character ceilings and context tokens use the existing conservative chars/4 estimate; no tokenizer/parser dependency was added.
- Metadata filtering happens after a bounded vector candidate query because Phase 7 deliberately keeps `VectorQuery` store-neutral. Highly selective filters may need a larger configured candidate bound.
- Stable chunk IDs make identical indexing retries idempotent. Replacing a source with fewer chunks requires the host to delete stale source IDs first because generic `VectorStore.getByThread` is optional and no source-delete contract was added.
- Only plain text and Markdown boundary preference ship. PDF/HTML/LaTeX extraction, semantic chunking, metadata agents, rerankers, GraphRAG, and remote loading remain out of scope.
- RAG stays outside every profile bundle pending measured adoption; install `@arnilo/prism-rag` and its `@arnilo/prism-memory` peer explicitly.

## Further Actions
- Priority medium: add `replaceSource()` only if production hosts repeatedly need atomic changed-document replacement; first determine whether a generic optional source-enumeration/delete seam belongs in Phase 7 stores.
- Priority medium: evaluate store-native metadata filter extension after both in-memory and pgvector users need it; keep bounded package-local filtering until measured recall suffers.
- Priority low: add an optional tokenizer/chunker adapter seam only when a real model-specific token ceiling cannot use character bounds.
- Priority low: revisit profile inclusion during Phase 14 size/use review; current package is 9.0 kB packed / 34.6 kB unpacked.
