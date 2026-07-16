# Phase 7 — Working Memory and Semantic Recall

## Objectives
- Add an optional `@arnilo/prism-memory` package with narrow `Embedder` / `VectorStore` / working-memory contracts.
- Enable tenant/resource/thread-scoped working memory and semantic recall that injects through existing `ContextProvider` seams.
- Ship in-memory reference adapters plus one PostgreSQL/pgvector production path with shared conformance.
- Keep observational memory unchanged and leave RAG chunking to Phase 9.

## Expected Outcome
- Hosts can `createMemory({ tenantId, resourceId, threadId, embedder, ... })`, update schema-backed working memory, index/recall semantic entries, and inject selected memories via a context provider.
- Default offline suite stays network-free; PostgreSQL/pgvector coverage is env-gated.
- Docs, example, packaging guards, migration notes, review coverage, and roadmap Phase 7 are updated.
- Publishable graph becomes 27 packages; memory stays out of profile bundles pending size/use review.

## Tasks

- [x] Inventory primitives and lock the package-owned surface
  - Acceptance Criteria:
    - Functional: Existing `ContextProvider`, middleware hooks, `OwnershipScope`, `SecretRedactor`, JSON Schema validation hooks, PostgreSQL pool patterns, and observational-memory boundaries are inventoried; Phase 7 adds only package-local memory/vector contracts.
    - Performance: Bound defaults/caps are recorded for top-K, adjacent range, embedding batch, payload bytes, injected tokens, and vector dimensions.
    - Code Quality: No core dependency, no SessionStore overload, no vector-adapter zoo, no Zod requirement.
    - Security: Mandatory `tenantId` + `resourceId` on every write/query/delete; thread isolation and redaction are required.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 7, `docs/review-coverage-2026-07-15.md` F-005, `docs/context-and-skills.md`, `docs/compaction-observational-memory.md`, `docs/postgres-persistence.md`, `docs/middleware-hooks.md`.
      - Mastra working-memory / semantic-recall / resource-thread isolation concepts (comparison only).
    - Options Considered:
      - Extend `SessionStore` with vectors: rejected; overloads history adapters.
      - Many vector backends: rejected; one in-memory + one pgvector reference for 0.0.5.
      - Optional package with package-owned contracts + context injection: chosen.
    - Chosen Approach:
      - Create `@arnilo/prism-memory` with `Embedder`, `VectorStore`, `WorkingMemoryStore`, `createMemory`, in-memory adapters, context provider, optional working-memory processor, conformance helpers, and pgvector adapter under the same package.
    - API Notes and Examples:
      ```ts
      const memory = createMemory({
        tenantId: "t1",
        resourceId: "user-ada",
        threadId: "thread-1",
        embedder,
      });
      await memory.updateWorking({ name: "Ada", preferences: { format: "concise" } });
      await memory.remember({ entries: [{ id: "m1", text: "Prefers concise answers" }] });
      const recalled = await memory.recall("preferred response format", { topK: 5, messageRange: 1 });
      ```
    - Files to Create/Edit:
      - `plans/059-working-and-semantic-memory.md`: this plan.
      - `packages/memory/**`: new package (subsequent tasks).
    - References:
      - Existing `ContextProvider`, `createSecretRedactor`, `packages/evals` packaging pattern, `packages/session-store-postgres` opt-in integration tests.
  - Test Cases to Write:
    - Inventory assertions live in later conformance/docs tasks; this task records rejected alternatives and bound table.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new optional package.
    - Docs pages to create/edit: planned in docs task (`docs/working-and-semantic-memory.md` and related).
    - `docs/index.md` update: yes under Compaction/session memory.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Implement package contracts, in-memory adapters, and `createMemory`
  - Acceptance Criteria:
    - Functional: Working memory supports get/update(merge|replace)/delete with optional JSON Schema or host validator; semantic remember/recall performs embed + tenant-scoped top-K with optional adjacent range.
    - Performance: Limits enforce topK≤32, messageRange≤4, batch≤128, payload bytes, injected-token budget, and dimension caps; default `remember({ wait: false })` does not block callers on indexing completion.
    - Code Quality: Zero runtime deps for the default path; narrow exported types; fail-closed validation.
    - Security: Cross-tenant/resource/thread denial; redaction of text/metadata before persist/inject; canary secrets never leave stores unredacted when redactor configured.
  - Approach:
    - Documentation Reviewed:
      - `packages/evals` and `packages/provider-ai-sdk` package manifests/exports.
      - Core `ContextProvider` / `JsonObject` / redaction helpers.
    - Options Considered:
      - Ajv dependency for working-memory schema: unnecessary for a small subset; rejected for default path.
      - Host validator hook plus optional minimal JSON Schema subset checker: chosen.
    - Chosen Approach:
      - Implement cosine in-memory `VectorStore`, map-backed `WorkingMemoryStore`, deterministic mock embedder for tests, and `createMemory` facade.
    - API Notes and Examples:
      ```ts
      export interface Embedder {
        readonly dimensions: number;
        embed(texts: readonly string[], options?: { signal?: AbortSignal }): Promise<readonly (readonly number[])[]>;
      }
      ```
    - Files to Create/Edit:
      - `packages/memory/package.json`, `tsconfig.json`, `LICENSE`, `README.md`, `CHANGELOG.md`
      - `packages/memory/src/{types,limits,errors,util,redact,schema,embedder,vector-memory,working-memory,memory,index}.ts`
    - References:
      - Roadmap API sketch; evals packaging.
  - Test Cases to Write:
    - Working-memory schema validation, merge/replace, version conflict, thread isolation.
    - Semantic top-K ordering, adjacent range, empty result, embedding failure, abort, limits.
    - Cross-tenant denial and canary-secret redaction.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit: deferred to docs task.
    - `docs/index.md` update: deferred to docs task.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add context provider, optional processor, and shared conformance
  - Acceptance Criteria:
    - Functional: `createContextProvider()` injects working and/or semantic blocks through existing context resolution; optional processor updates working memory from host-supplied extract callback.
    - Performance: Injected content respects token/byte budgets; recall work is bounded by top-K/range caps.
    - Code Quality: Conformance helper exercises any `Embedder`/`VectorStore`/`WorkingMemoryStore` trio without postgres.
    - Security: Injected context is inert text only — no tools/permissions; scope cannot widen inside provider/processor.
  - Approach:
    - Documentation Reviewed:
      - `docs/context-and-skills.md`, middleware hook list.
    - Options Considered:
      - New core middleware hook: rejected; reuse `context` / host wiring.
      - Package-owned context provider + opt-in processor function: chosen.
    - Chosen Approach:
      - Provider reads latest user text (or explicit query) for recall; processor is an explicit `process(messages)` helper hosts call — not auto-activated.
    - API Notes and Examples:
      ```ts
      const agent = createAgent({
        context: [memory.createContextProvider({ includeWorking: true, includeSemantic: true })],
        ...
      });
      ```
    - Files to Create/Edit:
      - `packages/memory/src/{context,processor,conformance}.ts`
      - `packages/memory/src/__tests__/memory.test.ts`
    - References:
      - `resolveContextProviders`, evals test style.
  - Test Cases to Write:
    - Context injection order/budgets, processor merge, conformance runner against in-memory adapters.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit: deferred to docs task.
    - `docs/index.md` update: deferred.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add PostgreSQL/pgvector adapter and env-gated live suite
  - Acceptance Criteria:
    - Functional: One production adapter persists working memory and vectors with mandatory scope filters; migrations create required tables/indexes; live suite passes behind `PRISM_TEST_POSTGRES_URL` (+ pgvector).
    - Performance: Queries are scoped and limited; default unit suite remains network-free when env unset.
    - Code Quality: `pg` is an optional package dependency only; adapter reuses package contracts.
    - Security: Cross-tenant SQL paths deny; schema identifiers validated; secrets redacted before write.
  - Approach:
    - Documentation Reviewed:
      - `packages/session-store-postgres` pool/schema/migration/integration patterns.
    - Options Considered:
      - Put adapter in session-store-postgres: couples history persistence to vectors; rejected.
      - Keep adapter inside `@arnilo/prism-memory`: chosen.
    - Chosen Approach:
      - `createPostgresMemoryStores({ pool|connectionString, schema })` returns working + vector stores; integration tests skip without env/extension.
    - API Notes and Examples:
      ```ts
      const { workingStore, vectorStore } = await createPostgresMemoryStores({ connectionString, schema: "prism_memory" });
      ```
    - Files to Create/Edit:
      - `packages/memory/src/{postgres,postgres-ddl,postgres-identifiers}.ts`
      - `packages/memory/src/__tests__/postgres-memory.integration.test.ts`
      - `packages/memory/package.json` scripts/deps
    - References:
      - Postgres persistence integration test gating.
  - Test Cases to Write:
    - Offline: adapter factory validation without network.
    - Live: reopen survival, tenant isolation, top-K ordering, working-memory CAS.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit: include postgres section in memory docs + pointer from `docs/postgres-persistence.md`.
    - `docs/index.md` update: yes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Wire workspace packaging, example, and documentation
  - Acceptance Criteria:
    - Functional: Package is a workspace member; packaging/install-smoke lists include it; example compiles; docs page + index/migration/observational-memory distinction ship.
    - Performance: Example uses mock embedder only; no live network.
    - Code Quality: README/CHANGELOG/LICENSE present; stays out of profile bundles.
    - Security: Docs state mandatory scope, redaction, and inert injection.
  - Approach:
    - Documentation Reviewed:
      - `docs/api-page-template.md`, Phase 6 doc/migration updates.
    - Options Considered:
      - Add to prism-all immediately: rejected pending size/use review.
    - Chosen Approach:
      - Explicit workspace entry + packaging arrays; full API wiki page; light cross-links.
    - API Notes and Examples:
      - `examples/working-semantic-memory.ts`
    - Files to Create/Edit:
      - `package.json` workspaces, packaging/install-smoke arrays
      - `docs/working-and-semantic-memory.md`, `docs/index.md`, `docs/migration.md`, `docs/compaction-observational-memory.md`, `docs/postgres-persistence.md`, `docs/release-and-install.md`, `docs/review-coverage-2026-07-15.md`, `docs/performance.md`, `CHANGELOG.md`, `README.md` as needed
      - `examples/working-semantic-memory.ts`
    - References:
      - prism-wiki API page structure.
  - Test Cases to Write:
    - Packaging/install-smoke pick up new package; example typechecks via root `tsc -p examples`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit: listed above.
    - `docs/index.md` update: yes; Working and semantic memory under Compaction/session memory.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Verify suite and close Phase 7 in roadmap/plan
  - Acceptance Criteria:
    - Functional: Focused memory tests pass; `npm run sdk:ready` passes with 0 fail; Phase 7 checkbox and completion evidence updated.
    - Performance: Offline suite remains within release budget expectations.
    - Code Quality: Plan tasks checked; compromises/further actions filled.
    - Security: No new default network/persistence activation.
  - Approach:
    - Documentation Reviewed:
      - Roadmap Phase 6 completion-evidence format.
    - Options Considered:
      - Defer roadmap update: rejected; user requested plan/roadmap closeout.
    - Chosen Approach:
      - Run package tests then `sdk:ready`; update `roadmap.md` and this plan.
    - API Notes and Examples:
      ```bash
      npm test -w @arnilo/prism-memory
      npm run sdk:ready
      ```
    - Files to Create/Edit:
      - `roadmap.md`, `plans/059-working-and-semantic-memory.md`
    - References:
      - Phase 6 completion evidence block.
  - Test Cases to Write:
    - Full offline gate.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no additional; closeout only.
    - Docs pages to create/edit: none beyond evidence already written.
    - `docs/index.md` update: no further.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Kept `@arnilo/prism-memory` out of profile bundles and `prism-all` pending size/use review (same opt-in policy as evals/AI SDK).
- Used a minimal JSON Schema subset checker instead of Ajv to keep the default path free of Zod and avoid a second schema engine for working memory.
- `createHashEmbedder` is deterministic bag-of-tokens for offline demos/tests only; hosts must supply production embedders.
- CI PostgreSQL image moved from `postgres:16` to `pgvector/pgvector:pg16` so the memory live suite can enable the `vector` extension.

## Further Actions
- Priority medium: add a thin host-owned OpenAI/compatible embedder adapter example once a first production embedder is chosen.
- Priority low: consider making `pg` an optionalDependency if pure in-memory installs want zero native/network DB client.
- Priority low: Phase 9 RAG should import `Embedder`/`VectorStore` from this package rather than duplicating contracts.
