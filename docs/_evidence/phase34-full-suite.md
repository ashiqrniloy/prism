# Plan 034 — Task 10 full-suite verification evidence (2026-08-26)

## Gates

| Gate | Result |
| --- | --- |
| `npm run build` | clean, 0 TS errors (workspaces reordered: memory, rag before observability-*) |
| `npm test` | core 1669/1669 + all workspace suites, **0 failures** |
| `biome lint .` / `biome format .` | clean (12 files from Tasks 2–9 formatted) |
| `test:coverage` + `coverage:summary` | exit 0; rag **95.46** lines (threshold ≥91.82), branches 79.76, functions 96.75; otel above freeze; protected packages exempt per `scripts/coverage-thresholds.json` |
| `security:threat-suites` | 50/50 pass |
| `test:postgres` (live pgvector/pg16 docker) | all durable suites fail 0; `postgres-vector.integration.test.js` **8/8, zero skips** |

Flake note: `field-policy.test.js` frozen-overhead benchmark failed once under parallel load
(115.7% vs 10% cap), passed on both subsequent runs. Timing-sensitive benchmark in core,
unrelated to RAG changes.

## Fixes made during verification

- `plans/README.md`: plan 034 was never registered — root cause of "plans index links every
  active numbered plan" failure. Row added.
- Formatting drift from Tasks 2–9 files fixed via biome.

## Acceptance-criteria traceability (`prism-production-rag.md` §Acceptance criteria)

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | PG `replaceSource` atomicity (kill before commit → old chunks retrieve; after commit → only new) | ✅ Task 3 | `packages/memory/src/__tests__/postgres-vector.integration.test.ts` — rollback-inside-operation + post-commit-only-new-chunks tests; live pgvector run green |
| 2 | `lexical:"fts"` returns lexical-only hit vector misses + paraphrase hit FTS misses; fused list RRF-ordered | ✅ Task 4 | `rag.test.ts` stub-leg test (hybrid > tie-broken legs, labels per hit); `fusion.test.ts` hand-computed RRF incl. dedupe/tie-breaks |
| 3 | Embedder B over vectors from A throws `ERR_PRISM_RAG_EMBEDDER_MISMATCH` | ✅ Task 2 | `rag.test.ts` drift + legacy-record fail-closed tests |
| 4 | Unchanged-hash `replaceSource` performs zero embed calls | ✅ Task 5 | `rag.test.ts` hash-skip suite — counting embedder frozen at 1 call; `{indexed:0, skipped:true}` |
| 5 | Heading metadata (`metadata.heading`) on markdown chunks | ⏳ blocked on open plan-Task 7 |
| 6 | Generation swap visibility incl. `rag.index_generation` in traces | ⏳ blocked on open plan-Task 6 (telemetry attribute deliberately deferred with it) |
| 7 | Span tree without host logger when OTel configured; `chunk_retrieved` has no raw text | ✅ Task 9 | `rag/src/__tests__/telemetry.test.ts` exact tree + leakage scan; otel `rag-telemetry.test.ts` real-retrieve traceId/parentSpanId chain + allow-list drops |
| 8 | `createTeiReranker` reorder/fail-closed/provenance | ⏳ blocked on open plan-Task 8 |
| 9 | Memory + hash-embedder suites stay green; no new required cloud service | ✅ this task | memory 16/16, alibaba (hash embedder id) 10/10; git diff shows **no new runtime dependencies** (otel gains only a devDependency for rag types); everything runs network-free by default |

Criteria 5, 6, 8 require re-running this verification after their tasks land; nothing shipped
so far depends on them.

---

## Task 14 — Full-suite verification against multi-scope + P1–P8 acceptance (2026-08-26)

### Gates

| Gate | Result |
| --- | --- |
| `npm run build` | clean, 0 TS errors |
| `npm test` | core **1669/1669 pass, 0 fail**; all workspace suites **350/350 pass, 0 fail** |
| `biome check` | clean, 0 lint/format issues (13 organize-imports fixed in this task) |
| `scripts/phase34-freeze.test.mjs` | 3/3 pass: exactly three manifests at 0.3.1, internal `^0.3.0` ranges hold, docs name 0.3.1 |
| `scripts/budget-gate.test.mjs` | 10/10 pass; no budget regression |
| `scripts/release-gate.test.mjs` | 8/8 pass |
| `PRISM_TEST_POSTGRES_URL` live pgvector | memory 26/26 pass, 0 fail, 0 skip |
| compat surface vs Task 12 baseline | additive-only: `HARD_RETRIEVE_SCOPE_CAP` (new constant, rag), `DEFAULT_RRF_K` + `HARD_RRF_K_CAP` (Task 4, already baselined); no name removals; `scopes?: readonly RagScope[]` is a type-field addition, not a new export name |

### Multi-scope acceptance criteria traceability (`prism-multi-scope-retrieve.md` §Acceptance criteria)

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Three scopes, one chunk per corpus: fused+reranked `hits.length <= topK`, all three sources can appear, each hit's scope matches exactly one requested scope | ✅ | `rag.test.ts` — "fuses three scopes with one embed and one rerank" (Task 13) |
| 2 | Query embed is invoked **once** (spy) for N>1 scopes | ✅ | `rag.test.ts` — embed spy counts 1 for 3 scopes |
| 3 | Reranker invoked **once** on fused union | ✅ | `rag.test.ts` — rerank spy counts 1 |
| 4 | `scopes: []` returns no hits, no `embed`/`store.query`/`lexicalQuery`/`reranker` calls | ✅ | `rag.test.ts` — "returns empty without embed/search/rerank when scopes is empty" (embeds=0, queries=0, lex=0, reranks=0) |
| 5 | Passing both `scope` and `scopes` throws validation error | ✅ | `rag.test.ts` — "rejects both, neither, and more than HARD_RETRIEVE_SCOPE_CAP scopes" (RagValidationError) |
| 6 | Foreign-corpus row never appears when scopes don't include that corpus | ✅ | `rag.test.ts` — "fails closed on a foreign corpus row and embedder drift in any requested scope" (RagScopeError) |
| 7 | Embedder-B query vs embedder-A vectors in **any** requested scope throws `ERR_PRISM_RAG_EMBEDDER_MISMATCH` | ✅ | Same test — drifted embedderId assertion |
| 8 | Single-`scope` tests from P2/P3/P6/P7 stay green | ✅ | All 31 pre-Task-13 rag tests pass (retrieve/ContextProvider, replaceSource hash skip, generation visibility) |

### P1–P8 acceptance criteria (updated, all unblocked)

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | PG `replaceSource` atomicity | ✅ Task 3 | `postgres-vector.integration.test.ts` — live pgvector green |
| 2 | `lexical:"fts"` hybrid retrieval + RRF fusion | ✅ Task 4 | `rag.test.ts` stub-leg + `fusion.test.ts` |
| 3 | Embedder mismatch → `ERR_PRISM_RAG_EMBEDDER_MISMATCH` | ✅ Task 2 | `rag.test.ts` drift + legacy-record fail-closed |
| 4 | Unchanged-hash `replaceSource` zero embed calls | ✅ Task 5 | `rag.test.ts` hash-skip suite |
| 5 | Heading metadata on chunks | ✅ Task 7 | `rag.test.ts` — heading-stack stamping, parser metadata propagation |
| 6 | Generation swap visibility | ✅ Task 6 | `rag.test.ts` — generation pointer advancement + model-upgrade journey |
| 7 | Span tree without host logger; `chunk_retrieved` no raw text | ✅ Task 9 | `telemetry.test.ts` exact tree, leakage scan; `rag-telemetry.test.ts` traceId chain, allow-list |
| 8 | `createTeiReranker` reorder/fail-closed/provenance | ✅ Task 8 | `tei-reranker.test.ts` — 4 tests passing (reorder, fail-closed, bounds, construction) |
| 9 | Memory + hash-embedder suites green; no new cloud deps | ✅ | memory 26/26, rag 47/47; zero new runtime dependencies |

### Docs truth

| Artifact | Check | Result |
| --- | --- | --- |
| `docs/rag.md` | `scope`/`scopes` documented | ✅ — Inputs table, outputs, examples, extension notes, security notes |
| `docs/rag.md` | `HARD_RETRIEVE_SCOPE_CAP` named | ✅ — "0..`HARD_RETRIEVE_SCOPE_CAP` (8) exact scopes" |
| `docs/rag.md` | `rag.scope_count` described | ✅ — extension note: “One `rag_request` span; add `rag.scope_count`” |
| `docs/observability.md` | `rag.scope_count` + `rag.chunk.tenant_id`/`corpus_id` | ✅ — rag_request table row updated |
| `docs/index.md` | RAG entry mentions multi-scope | ✅ — "multi-scope retrieve (one embed / one RRF / one rerank)" |
| `docs/index.md` | One nav link per page | ✅ — `docs/index.md` nav-link test passes (fixed in Task 10) |

### Notes

- Compat `HARD_RETRIEVE_SCOPE_CAP` is additive (new constant) — baseline re-update deferred to Task 15 release refresh.
- `RagProvenance` gained `tenantId`/`resourceId`/`corpusId` — an interface member addition invisible to the compat name scanner (docs/migration.md will note it in Task 15).
- No new runtime dependencies; otel's devDependency on rag for types from Task 9 unchanged.
