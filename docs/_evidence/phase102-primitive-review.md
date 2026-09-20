# Phase 102 — Primitive Review: Propagation, Rerank, and Grant-Integration Reuse Seams

Plan: [102-Retrieval-Revocation-And-Reranker-Follow-Ups.md](../../plans/102-Retrieval-Revocation-And-Reranker-Follow-Ups.md) Task 1.
Date: 2026-09-19. Baseline: `0.9.0` working tree, HEAD `f6b1da81` (plan 089 shipped).
Scope: **read-only inventory**. This document is the gate for Tasks 2–11: every later task either
reuses a row below as-is, extends one with an additive field/mode, or adds a handler/helper on a
contract named here. No task may open a seam this file does not map.

Cite convention: `covers:` spans are `file:Lstart–Lend` verified in this tree. Every `reuse:` row
names the exact exported symbol. Every `gap:` row names the file that must change.

Source of the work: plan 089 `Compromises Made` + `Further Actions`
([089-Retrieval-Revocation-Completeness-And-Default-Reranker.md](../../plans/089-Retrieval-Revocation-Completeness-And-Default-Reranker.md)),
plus the current contracts in `docs/rag.md`, `docs/policy-and-audit.md`,
`docs/compaction-observational-memory.md`, `docs/wiki.md`, `docs/memory-fabric.md`, `docs/live-testing.md`.

---

## 1. Reuse inventory (what the later tasks build on)

### 1.1 Propagation and lineage

| Span | Exported symbol | Behavior |
| --- | --- | --- |
| `packages/memory/src/propagation.ts:L74–L172` | `createDeletionPropagator` | One privileged pass: lineage-closed id set → one `invalidate` transaction → registered handlers with `{ sourceId, ids, scope, signal }`; returns `{ sourceId, ids, tombstoned, layers, batched }`. |
| `packages/memory/src/propagation.ts:L28–L30` | `DeletionPropagationStore` | `VectorStore` + optional `transaction(operation)`. |
| `packages/memory/src/propagation.ts:L40–L46` | `DeletionPropagationHandler` | `{ kind, delete(context): number \| Promise<number> }` — the handler contract Task 2 targets. |
| `packages/memory/src/propagation.ts:L111–L167` | `propagate` | Expands with `collectInvalidationIds`, tombstones via `invalidate`, then runs each handler once and validates the returned count. |
| `packages/memory/src/propagation.ts:L25` | `HARD_PROPAGATION_EDGES` | 4,096-edge one-pass ceiling; over-cap rejects whole. |
| `packages/memory/src/lineage.ts:L145–L154` | `listInvalidatedIds` | Reads per-scope tombstones once, filters out `reason: "corrected"`; `[]` for stores without lineage. Task 8's bridge. |
| `packages/memory/src/lineage.ts:L178` | `collectInvalidationIds` | Depth-8 walk over `_lineage.sourceIds`; the id set every handler sees. |
| `packages/memory/src/lineage.ts:L16–L26` | `LINEAGE_META_KEY`, `HARD_LINEAGE_*`, `HARD_INVALIDATION_BATCH` | `_lineage` at `v: 1`, depth 8, 256 edges, 32 source ids, 64-entry invalidation batches. |
| `packages/memory/src/rag/sources.ts:L178–L196` | `createRagDeletionHandler` | Existing physical-removal handler (`kind: "rag"`) — the shape Task 2's handler sits beside. |

### 1.2 Re-point

| Span | Exported symbol | Behavior |
| --- | --- | --- |
| `packages/memory/src/repoint.ts:L133–L236` | `repointSource` | Re-keys chunk ids + `_rag.sourceId`/`citationId`, rewrites `_lineage` edges, deletes old ids, all in one `transaction` when present; `assertRepointAccess` checks both ids on ACL stores. |
| `packages/memory/src/repoint.ts:L27` | `HARD_REPOINT_RECORDS` | 4,096-record whole-scope cap — Task 10 turns this into a per-page bound. |
| `packages/memory/src/repoint.ts:L32–L35` | `RepointStore` | `VectorStore` + optional `getByThread`/`transaction`. |
| `packages/memory/src/repoint.ts:L48–L51` | `RepointHandler` | `{ kind, repoint(context): number \| Promise<number> }` — Task 11's contract. |
| `packages/memory/src/repoint.ts:L37–L46` | `RepointContext` | `{ from, to, scope, ids, movedChunks, signal? }` handed to each handler after the store write. |
| `packages/memory/src/repoint.ts:L66–L77` | `RepointSourceResult` | `{ from, to, movedChunks, rewrittenEdges, layers, batched }` — Tasks 7/10 extend this shape. |
| `packages/memory/src/repoint.ts:L156–L158` | record read + cap | `getByThread(scope)` reads the whole scope before the cap check — the read Task 10 pages over. |
| `packages/memory/src/wiki/repoint.ts:L125–L147` | `createWikiRepointHandler` | Existing re-point handler (`kind: "wiki"`); Task 7 passes it in the rename list, Task 11 mirrors its shape. |
| `packages/memory/src/wiki/repoint.ts:L42–L123` | `repointWikiSources` | Manifest `rawSources`/`anchors`, hashes, page text, log line — no recompilation. |

### 1.3 Observational-memory ledger

| Span | Exported symbol | Behavior |
| --- | --- | --- |
| `packages/memory/src/compaction/observational-memory/append-custom.ts:L13–L23` | `appendCustomEntry` | The only custom-entry writer: builds the entry, appends through the host callback, verifies branch ownership, fails closed otherwise. Task 2 reuses it as-is. |
| `packages/memory/src/compaction/observational-memory/append-custom.ts:L8–L11` | `CustomEntryAppendOptions` | `{ session, appendEntry }` — already matches what a drop handler needs. |
| `packages/memory/src/compaction/observational-memory/ledger.ts:L22–L62` | `foldObservationalMemoryLedger` | Fold of recorded/dropped/reflection entries into observations, drops, coverage. |
| `packages/memory/src/compaction/observational-memory/ledger.ts:L64–L71` | `activeObservations` | Observations not covered by a drop entry. |
| `packages/memory/src/compaction/observational-memory/ledger.ts:L89–L95` | `observationBlockedByInvalidation` | `observation.id` or any `sourceEntryIds` entry in the invalidated set — Task 2's selector. |
| `packages/memory/src/compaction/observational-memory/types.ts:L5` | `OBSERVATIONS_DROPPED` | `"om.observations.dropped"`. |
| `packages/memory/src/compaction/observational-memory/types.ts:L40–L44` | `ObservationsDroppedData` | `{ type, observationIds, coversUpToId? }`. |
| `packages/memory/src/compaction/observational-memory/runtime.ts:L264–L270` | existing drop write | Runtime calls `appendCustomEntry(..., { type: OBSERVATIONS_DROPPED, observationIds: dropped, coversUpToId })` — the only current writer, token-budget driven. |
| `packages/memory/src/compaction/observational-memory/projection.ts:L27–L40` | `buildObservationalMemoryProjection` | `options.invalidatedIds` withholds observations/reflections at projection time (defense in depth beside Task 2's physical drop). |
| `packages/memory/src/compaction/observational-memory/recent-messages.ts:L59` | `buildObservationalMemoryContextBlocks` | Same `invalidatedIds` option on the context-block path. |
| `docs/compaction-observational-memory.md:L46` | `om.observations.dropped` row | Documented event shape; Task 2 edits beside it. |

### 1.4 Reranker

| Span | Exported symbol | Behavior |
| --- | --- | --- |
| `packages/memory/src/rag/local-reranker.ts:L70–L98` | `createTransformersRerankRuntime` | The real transformers.js runtime: `AutoTokenizer` + `AutoModelForSequenceClassification`, one batched `score`, `cache_dir`/`dtype`/`device`/`local_files_only` settings. Task 3 loads this, no stub. |
| `packages/memory/src/rag/local-reranker.ts:L143–L185` | `createLocalReranker` | Lazy memoized load, one `score` call per rerank, loud redacted failure. |
| `packages/memory/src/rag/local-reranker.ts:L22` | `DEFAULT_LOCAL_RERANK_MODEL` | `Xenova/bge-reranker-base`. |
| `packages/memory/src/rag/local-reranker.ts:L39–L43` | `LocalRerankRuntime` | `{ load(model) → { id, score({ query, documents, signal }) } }` host seam. |
| `packages/memory/src/rag/local-reranker.ts:L45–L54` | `TransformersRerankRuntimeOptions` | `cacheDir`, `allowRemoteModels`, `dtype`, `device` — Task 4's documented defaults live here. |
| `packages/memory/src/rag/reranker-config.ts:L32–L50` | `resolveReranker` | Declarative config → adapter; `{ kind: "local" }` is the zero-service path. |
| `packages/memory/src/rag/conformance.ts:L11–L33` | `runRerankerConformance` | Network-free invariants: empty short-circuit, permutation of exact references, provenance/trust untouched, determinism. Task 3 runs it against real weights. |
| `packages/memory/src/rag/__tests__/rerank-fixtures.ts:L8–L32`, `L34` | `reliefHit`, `withRerankServer` | Existing rerank fixtures Task 3/4 reuse instead of new shapes. |
| `packages/memory/src/rag/__tests__/local-reranker.test.ts:L147–L163` | installed-runtime probe | Current coverage is the absent-package guidance path; the installed path is exactly the gap Task 3 fills. |
| `docs/rag.md:L178` | sizing paragraph | Prose claim ("tens to low hundreds of ms") Task 4 replaces with measured numbers + defaults (executed). |
| `docs/rag.md:L177`, `L179–L181` | runtime seam, no-network, caps | Contract text Task 3/4 cite and extend. |

### 1.5 Live matrix and Postgres evidence

| Span | Exported symbol / file | Behavior |
| --- | --- | --- |
| `scripts/live-matrix.mjs:L59–L61` | `loadMatrix` | Loads `scripts/live-matrix.json`. |
| `scripts/live-matrix.mjs:L128–L135` | `resolveSuiteState` | `requires` all-of / `requiresAny` any-of → run or skip-with-reason; strict mode inverts. |
| `scripts/live-matrix.json:L723–L752` | `memory/rag-rerankers-live` | The existing hosted/TEI rerank leg (endpoint env vars, ≤2 requests, least-privilege scope) — Task 3 adds a separate local leg beside it. |
| `docs/live-testing.md:L36` | skip-not-fail contract | A suite with absent credentials skips with a reason, never fails. |
| `docs/live-testing.md:L48` | least-privilege rule | Narrowest credential per row; Task 3's leg requires none. |
| `docs/live-testing.md:L124` | add-a-suite checklist | `id`, `package`, `status`, `source`, `command`, `cwd`, `requires`, model wiring, `scope`, `cost` — Task 3's registration fields. |
| `packages/memory/package.json:L61–L62` | `test` / `test:postgres` | Per-package chains; Task 5 appends its suite to `test:postgres` (and `test`). |
| `package.json:L154–L155` | root `test:postgres` | `scripts/postgres-evidence.mjs` → `test:postgres:run` → workspace chains. Evidence runner counts TAP totals; it does **not** enumerate suites, so Task 5 needs no edit there. |
| `scripts/postgres-evidence.mjs:L8–L33` | evidence runner | Runs `test:postgres:run`, requires a clean TAP summary, writes `scripts/postgres-evidence.json` with `gitHead`/`counts`. |
| `packages/memory/src/__tests__/postgres-vector.integration.test.ts:L17–L18` | gate | `PRISM_TEST_POSTGRES_URL` present → `describe`, absent → `describe.skip`; Task 5 mirrors this. |
| `packages/memory/src/postgres.ts:L822+` | `createPostgresVectorStore` | Durable store Task 5 exercises through `propagate`/`repointSource`. |
| `docs/live-testing.md:L102` | `memory/postgres` row | The durable leg's documented credential and cost (row text now names propagation/re-point). |

### 1.6 Store contract, ACL predicate, and access recheck

| Span | Exported symbol | Behavior |
| --- | --- | --- |
| `packages/memory/src/types.ts:L188–L227` | `VectorStore` | Contract Task 6 extends **additively**: `query` (`L190`), `lexicalQuery` (`L197`), `authorization: "acl"` (`L201`), `checkSourceAccess` (`L203–L208`), `lineage: "invalidation"` + `listInvalidated` (`L214–L217`). |
| `packages/memory/src/postgres.ts:L316–L341` | `authorizationPredicate` | Builds the SQL grant predicate (source id + principal/group + `accessVersion`) shared by both query legs; Task 6 adds optional denial counting here. |
| `packages/memory/src/postgres.ts:L422–L430` | `query` | ACL predicate assembled in the vector leg. |
| `packages/memory/src/postgres.ts:L739–L745` | `lexicalQuery` | Same predicate in the lexical leg. |
| `packages/memory/src/postgres.ts:L370` | `authorization: "acl"` | The declaration that makes the store a first-line filter. |
| `packages/memory/src/vector-memory.ts:L152–L205`, `L283–L292` | reference store query/lexicalQuery | Filters row-by-row, so Task 6 reports denials by construction with no extra statement. |
| `packages/memory/src/rag/access-recheck.ts:L22–L31` | `CreateAccessRecheckOptions` | `onDenied` audit sink + redactor — the existing path Task 6 feeds. |
| `packages/memory/src/rag/access-recheck.ts:L33–L40` | `AccessRecheck` | `allows` (pre-filter), `allowsAfterRerank` (fresh read), `report()` per-source denials, emitted once. |
| `packages/memory/src/rag/access-recheck.ts:L42–L43` | `PRE_FILTER` / `AFTER_RERANK` | Two phases; memoized per source, re-read after rerank. |
| `packages/memory/src/rag/retrieve.ts:L81–L85` | recheck wiring | `createAccessRecheck({ store, authorization, onDenied })` per query. |
| `packages/memory/src/rag/retrieve.ts:L386–L390` | tombstone guard | Reads per-scope invalidations before assembly; skips when the store has no lineage capability. |
| `docs/policy-and-audit.md:L112–L119` | audit table | `rag.acl_denied` shape, `Repointed` result, invalidation rows — Task 6/7 edit here. |
| `docs/rag.md:L118–L163` | grant recheck + re-point | Current contract; Task 6 adds the store-filtered denial sentence, Tasks 7/10 add helper/paging rows. |

### 1.7 Wiki lint and fabric notes

| Span | Exported symbol | Behavior |
| --- | --- | --- |
| `packages/memory/src/wiki/types.ts:L77–L83` | `LintReport` | `{ deadAnchors, brokenLinks, orphans, gaps, ok }` — Task 9 adds `prunedSources` additively. |
| `packages/memory/src/wiki/engine/linter.ts:L7–L9` | `WikiLinter.lint` | Reads the manifest once; Task 9's rule sits beside the orphan rule. |
| `packages/memory/src/wiki/engine/linter.ts:L141–L147` | orphan rule | Reference shape for the new rule. |
| `packages/memory/src/wiki/manifest.ts:L131` | `entity.rawSources` | The per-entity source list Task 9 diffs against the file-existence set. |
| `packages/memory/src/wiki/retire.ts:L52–L122` | `retireWikiSources` | Prunes `rawSources`/`anchors`, deletes fully-derived pages, leaves shared entities for the maintainer — the outcome Task 9 surfaces. |
| `packages/memory/src/wiki/commands/lint.ts:L5–L13` | `lintWiki` | The report factory both the command and the CLI call. |
| `packages/memory/src/wiki/commands/lint.ts:L15–L30` | `createWikiLintCommand` | Summary text + `metadata: { trust: "untrusted_external", ok }`. |
| `packages/memory/src/wiki/cli.ts:L101–L113` | CLI text | Renders counts and first paths; Task 9 extends the line, not the command set. |
| `packages/memory/src/fabric/create.ts:L100–L122` | `toNoteMetadata` | Note metadata fields (including `path`, `sourceEntryIds`) — Task 11 reuses these, adding no schema. |
| `packages/memory/src/fabric/types.ts:L65` | `sourceEntryIds` | Note→ledger link that Task 11 must leave pointing at the same entries. |
| `packages/memory/src/fabric/types.ts:L272–L288` | `MemoryNoteMetadata` | Parsed metadata shape (v/kind/path/…). |
| `packages/memory/src/fabric/types.ts:L361` | `encodeMemoryNoteMetadata` | The single encoder/decoder pair for note metadata. |
| `docs/memory-fabric.md:L13`, `L104`, `L204–L205` | file-note contract | File notes are path-keyed in the store; no journal exists. |
| `packages/memory/skills/wiki-maintainer/SKILL.md:L64–L71` | health-check section | Where Task 9 tells the maintainer what to do with pruned entities. |
| `docs/wiki.md:L48`, `L61`, `L152–L155` | lint output, CLI, skills | Docs surface Task 9 edits. |

---

## 2. Per-task verdict (reuse as-is / extend / add new)

| Task | Verdict | Seam | New surface |
| --- | --- | --- | --- |
| 2 — OM drop handler | **Add new handler, reuse everything else as-is** | `DeletionPropagationHandler` (`packages/memory/src/propagation.ts:L40`), `appendCustomEntry` (`packages/memory/src/compaction/observational-memory/append-custom.ts:L13`), `foldObservationalMemoryLedger` (`packages/memory/src/compaction/observational-memory/ledger.ts:L22`), `observationBlockedByInvalidation` (`packages/memory/src/compaction/observational-memory/ledger.ts:L89`), `OBSERVATIONS_DROPPED` (`packages/memory/src/compaction/observational-memory/types.ts:L5`) | `createObservationalMemoryDropHandler` + options in a new `packages/memory/src/compaction/observational-memory/drop-invalidated.ts`; exports from the OM subpath (root `index.ts` does not re-export this surface); one docs row + one bullet in `docs/rag.md`. |
| 3 — local rerank live leg | **Add a test leg + matrix row; reranker seams reused as-is** | `createTransformersRerankRuntime` (`packages/memory/src/rag/local-reranker.ts:L70`), `runRerankerConformance` (`packages/memory/src/rag/conformance.ts:L11`), `resolveReranker` (`packages/memory/src/rag/reranker-config.ts:L32`), `reliefHit` fixtures (`packages/memory/src/rag/__tests__/rerank-fixtures.ts:L8`), `resolveSuiteState` (`scripts/live-matrix.mjs:L128`) | New gated suite `packages/memory/src/rag/__tests__/local-reranker-live.test.ts`, one suite object in `scripts/live-matrix.json`, generated `docs/_evidence/phase102-local-rerank-latency.md`. Executed: the first real-weights run exposed a tokenizer-batching bug in `createTransformersRerankRuntime` (`` `packages/memory/src/rag/local-reranker.ts` ``), fixed in Task 3 — no API change, no new export. |
| 4 — recall + defaults | **Add test-local corpus/helper + docs numbers** | Task 3's runtime; `TransformersRerankRuntimeOptions` (`packages/memory/src/rag/local-reranker.ts:L45`); `docs/rag.md:L178` | Executed: corpus + recall helper inline in the gated leg (`packages/memory/src/rag/__tests__/local-reranker-live.test.ts` — a separate fixture module would have exported data into the src-wide export budget, `scripts/budget-gates.mjs` `countDirExports`), docs numbers/defaults in `docs/rag.md`, cross-ref in `docs/embeddings.md`. No new option (defaults are documented, not code). |
| 5 — Postgres propagation leg | **Add integration suite; store + propagation/re-point reused as-is** | `createPostgresVectorStore` (`packages/memory/src/postgres.ts:L822`), `createDeletionPropagator` (`packages/memory/src/propagation.ts:L74`), `repointSource` (`packages/memory/src/repoint.ts:L133`), gate shape (`packages/memory/src/__tests__/postgres-vector.integration.test.ts:L17`) | Executed: new `packages/memory/src/__tests__/postgres-propagation.integration.test.ts` (also in the hermetic chain so the named skip runs in CI); appended to `packages/memory/package.json:L61–L62`. Runner (`postgres-evidence.mjs`) unchanged. No store change needed: the SQL invalidation predicate already hides derived chunk rows by `_lineage`, and source-owned rows leave through the `deleteSource` handler — the durable leg asserted both. |
| 6 — store denial reporting | **Extend the contract, additively** | `VectorStore.query`/`lexicalQuery` (`packages/memory/src/types.ts:L190`, `L197`), `authorizationPredicate` (`packages/memory/src/postgres.ts:L316`), `AccessRecheck` (`packages/memory/src/rag/access-recheck.ts:L33`), `retrieveContext` wiring (`packages/memory/src/rag/retrieve.ts:L81`) | Optional `onDeniedSources` on the two query types; opt-in grouped statement in Postgres; by-construction reporting in `vector-memory.ts`; forwarding + dedupe in `access-recheck.ts`/`retrieve.ts`; docs rows. |
| 7 — source-rename helper | **Add helper over `repointSource`; no store event** | `repointSource` (`packages/memory/src/repoint.ts:L133`), `RepointHandler` (`packages/memory/src/repoint.ts:L48`), `createWikiRepointHandler` (`packages/memory/src/wiki/repoint.ts:L125`) | `applySourceRenames` + result types in `repoint.ts` (or sibling), audit event row in `docs/policy-and-audit.md`. No `VectorStore` change. |
| 8 — host entry point / OM wiring | **Reuse as-is; add example/recipe (facade only on demand, as a function)** | `createDeletionPropagator` (`packages/memory/src/propagation.ts:L74`), `listInvalidatedIds` (`packages/memory/src/lineage.ts:L145`), projection `invalidatedIds` (`packages/memory/src/compaction/observational-memory/projection.ts:L30`), context blocks (`packages/memory/src/compaction/observational-memory/recent-messages.ts:L59`) | Network-free example/recipe + docs snippets; `docs/index.md` only if a new page appears. No store facade method. |
| 9 — pruned-entity lint | **Extend `LintReport` + one linter rule + CLI text** | `LintReport` (`packages/memory/src/wiki/types.ts:L77`), `WikiLinter.lint` (`packages/memory/src/wiki/engine/linter.ts:L7`), `rawSources` (`packages/memory/src/wiki/manifest.ts:L131`), retire/repoint pruning (`packages/memory/src/wiki/retire.ts:L52`), `createWikiLintCommand` (`packages/memory/src/wiki/commands/lint.ts:L15`), CLI (`packages/memory/src/wiki/cli.ts:L101`) | Additive `prunedSources` field, non-fatal; count/paths in command + CLI; `wiki-maintainer` skill section. |
| 10 — paged re-point | **Extend `RepointSourceOptions`/`Result`; per-page code path reused as-is** | `repointSource` (`packages/memory/src/repoint.ts:L133`), `HARD_REPOINT_RECORDS` (`packages/memory/src/repoint.ts:L27`), scope read (`packages/memory/src/repoint.ts:L156`) | `pageSize`/`cursor` fields + cursor result; one transaction per page; `HARD_REPOINT_RECORDS` becomes a per-page default. No second re-key path. |
| 11 — fabric-note re-point handler | **Add handler on the existing re-point contract** | `RepointHandler` (`packages/memory/src/repoint.ts:L48`), `toNoteMetadata` (`packages/memory/src/fabric/create.ts:L100`), `sourceEntryIds` (`packages/memory/src/fabric/types.ts:L65`), `createRagDeletionHandler` shape (`packages/memory/src/rag/sources.ts:L178`) | New `packages/memory/src/fabric/repoint.ts` + exports; retire uses the same handler (path deleted → invalidate notes). No note schema change. |

---

## 3. Gap list (no current seam does this)

| # | Gap | File that must change | Task |
| --- | --- | --- | --- |
| G1 | No ledger-drop writer keyed by invalidation ids; the only `OBSERVATIONS_DROPPED` writer is the token-budget dropper (`packages/memory/src/compaction/observational-memory/runtime.ts:L264`). | `packages/memory/src/compaction/observational-memory/drop-invalidated.ts` (new) + `index.ts` exports | 2 |
| G2 | No gated live suite or matrix row for the local reranker; only the absent-package path is tested (`packages/memory/src/rag/__tests__/local-reranker.test.ts:L147`). | `packages/memory/src/rag/__tests__/local-reranker-live.test.ts` (new), `scripts/live-matrix.json` | 3 |
| G3 | No measured recall and no documented per-platform defaults/weight-cache convention; `docs/rag.md:L178` is prose. `createLocalReranker` has no default `cacheDir`. | Inline recall corpus + helper in `packages/memory/src/rag/__tests__/local-reranker-live.test.ts`, `docs/rag.md`, `docs/embeddings.md` | 4 |
| G4 | No propagation or re-point leg against the durable store; `test:postgres` has no propagation suite. | `packages/memory/src/__tests__/postgres-propagation.integration.test.ts` (new), `packages/memory/package.json:L62` | 5 |
| G5 | Stores that filter inside `query`/`lexicalQuery` cannot report withheld sources; no `onDeniedSources` field exists and the Postgres predicate discards denial counts. | `packages/memory/src/types.ts:L188`, `packages/memory/src/postgres.ts:L316/L422/L739`, `packages/memory/src/vector-memory.ts:L152`, `packages/memory/src/rag/access-recheck.ts:L22`, `packages/memory/src/rag/retrieve.ts:L81`, `packages/memory/src/rag/types.ts` | 6 |
| G6 | No rename-list contract and no grant-change notification; a host must loop `repointSource` itself with hand-rolled audit/error handling. | `packages/memory/src/repoint.ts` (new helper) | 7 |
| G7 | No in-tree host composes `createDeletionPropagator` + OM projection, and no runtime-level `propagateDeletion` facade exists. | `examples/` or a snippet test; facade only if a host asks | 8 |
| G8 | `LintReport` has no pruned-source field; prune outcomes are invisible to `prism-wiki lint`. | `packages/memory/src/wiki/types.ts:L77`, `packages/memory/src/wiki/engine/linter.ts`, `packages/memory/src/wiki/commands/lint.ts`, `packages/memory/src/wiki/cli.ts`, `packages/memory/skills/wiki-maintainer/SKILL.md` | 9 |
| G9 | `HARD_REPOINT_RECORDS` is a global one-pass ceiling; there is no cursor, so >4,096 records cannot move at all. | `packages/memory/src/repoint.ts:L27`, `L133` | 10 |
| G10 | No handler touches `metadata.path` on `kind: "file"` notes; the `_lineage` walk cannot see path-keyed notes, so a moved/deleted path leaves stale notes in recall. | `packages/memory/src/fabric/repoint.ts` (new) + exports | 11 |

---

## 4. Rejected alternatives (frozen)

Every item below is an option the later tasks considered and this review rejects, with the reason.
None may reappear as an implementation without a new review row.

| # | Rejected | Reason |
| --- | --- | --- |
| R1 | Propagator writes the OM ledger entry itself (Task 2) | `propagation.ts` owns no session and no `SessionEntry` writer; it would need a second append path beside `appendCustomEntry` (`packages/memory/src/compaction/observational-memory/append-custom.ts:L13`). |
| R2 | Extend `CustomEntryAppendOptions` for drops (Task 2) | The existing `{ session, appendEntry }` shape already matches; only a documented constructor is missing. |
| R3 | Propagator passes observation ids instead of record ids (Task 2) | Only the ledger knows `sourceEntryIds` ↔ observation ids; moving that mapping into the propagator couples it to OM internals. |
| R4 | Fold the local leg into the hosted-rerank live suite (Task 3) | That suite requires endpoint credentials (`scripts/live-matrix.json:L723`); the local leg's point is needing none. |
| R5 | Assert a fixed latency ceiling in CI (Task 3) | Hardware- and dtype-dependent; the strict-mode gate proves the seam, the evidence file carries the number. |
| R6 | Ship model weights in the repo (Task 3) | Size and licensing; the host cache dir is the documented answer. |
| R7 | Download BEIR wholesale for recall (Task 4) | Needs a download and a corpus far beyond what the prune-vs-keep regression measures. |
| R8 | Assert a recall floor in CI (Task 4) | Model- and hardware-dependent; the number is evidence, not a gate. |
| R9 | Document only "measure it yourself" (Task 4) | The follow-up exists because the sizing table must carry a number. |
| R10 | Time Postgres propagation with a raw script instead of a test (Task 5) | The skip gate and evidence runner already exist for tests; a script needs its own CI wiring. |
| R11 | Reuse the in-memory numbers as "durable" (Task 5) | Transactions and round trips differ; that is the whole follow-up. |
| R12 | Have the store emit audit events itself / add a store-level audit sink or event bus (Tasks 6, 7) | The store has no audit sink and would duplicate the boundary's redaction/telemetry path; explicitly rejected by this review's security rule. |
| R13 | Always run the "denied counts" statement (Task 6) | Doubles query cost for every host that never reads the callback. |
| R14 | Drop store-side filtering and let the boundary filter everything (Task 6) | Creates a second, unindexed ACL decision path and leaks denied rows across the process boundary — rejected: one ACL decision path only. |
| R15 | `VectorStore.onSourceAccessChanged` + auto-re-point (Task 7) | Requires every store to implement an event, the events carry no rename mapping, and it is a store-level event bus the contract does not define; needs two real hosts first. |
| R16 | Facade method on the memory store (Task 8) | The memory facade holds no rag/wiki/observational deps (089 Compromises); a facade must be a function over propagator inputs. |
| R17 | Wire the composition into an in-tree host runtime (Task 8) | No in-tree host composes an OM runtime with a memory vector store; inventing one is a new feature, not a follow-up. |
| R18 | Make `retireWikiSources` rewrite pages itself (Task 9) | Needs the symbol extractor and raw reads for zero content change (089 Compromises). |
| R19 | Fail lint when sources are pruned (Task 9) | Pruning is a legitimate propagation outcome; failing health would make propagation and lint fight. |
| R20 | Add a separate `wiki-pruned` command (Task 9) | One report, one command is the existing shape. |
| R21 | Raise `HARD_REPOINT_RECORDS` (Task 10) | A bigger single transaction is the failure mode the cap exists to bound. |
| R22 | Background job with its own store (Task 10) | No scheduler in this package; a cursor returns control to the host. |
| R23 | Add `_lineage` metadata to fabric notes so the generic walk finds them (Task 11) | Notes are not derived chunk rows; their path link is the path itself. |
| R24 | A `.memory` journal / file-format reader for fabric notes (Task 11) | No such file format exists in this repo; notes are store-backed. |
| R25 | Declare `@huggingface/transformers` as a dependency (Task 3) | Changes the workspace dependency fingerprint and every consumer's release graph; the repo posture is that every external system is a host seam (089 Compromises, Task 2). |

Chosen baselines (not rejections, recorded so later tasks do not "improve" them): exporting
`appendCustomEntry` and letting hosts write the drop entry directly (Task 2), and having a host loop
`repointSource` itself (Task 7) — the handler/helper only removes leaked shape and duplicate
audit/error handling.

---

## 5. Measured cost of the reference paths

Method: the shipping suite shapes were re-run against the built package (`@arnilo/prism-memory@0.9.0`,
`dist` rebuilt from HEAD `f6b1da81`) with a throwaway harness that prints timings — same fixtures,
same call order as the suites named below; the harness is not committed. The suites themselves assert
the bounds; they are the regression home for these numbers. Machine: `aerynos`, AMD Ryzen 9 PRO
7940HS, Node v24.19.0, in-memory reference store (no Postgres), 2026-09-19.

| Path | Shipping suite | Measured | Suite assertion |
| --- | --- | --- | --- |
| `propagate` 1k tombstones (1 source + 1,000 derived rows) | `packages/memory/src/__tests__/deletion-propagation.test.ts:L186–L204` | 1,001 tombstoned, **1 transaction**, 5 runs `[14.7, 3.4, 4.1, 3.9, 2.0]ms`, median **3.9ms** (first run includes JIT warmup) | `elapsed < 2_000ms`, `tombstoned == 1_001`, `transactions == 1` |
| `repointSource` 1k chunks (`doc:a` → `doc:b`, destination granted) | shape of `packages/memory/src/__tests__/repoint.test.ts:L73–L130` (that suite has no 1k row) | 1,000 chunks moved, **batched**, **1 transaction**, **8.9ms** | suite asserts one transaction + embedding reuse on the small fixture; the 1k number is new evidence for Task 5/10 |
| `createAccessRecheck` 50 sources / 200 hits | `packages/memory/src/rag/__tests__/access-recheck.test.ts:L223–L273` | 250 lookups (50 per gate × 5 runs), 5 runs `[0.47, 0.17, 0.25, 0.20, 0.17]ms`, median **0.20ms** | `lookups == 50 × runs`, median `< 5ms` |
| `listInvalidatedIds` (2 tombstones, one scope read) | `packages/memory/src/__tests__/repoint.test.ts:L285–L335` | **0.7ms** | no bound asserted (correctness only) |

Consequences the later tasks carry: the 1k propagation budget is not at risk on the durable store
either (Task 5 re-measured it there: 1,001 rows, 1 transaction, 22 statements, 29–155 ms), re-point at
1k is cheap enough that Task 10's paging exists for crash-resumability and transaction size, not
throughput, and the recheck hook stays source-count-bound (Task 6's extra grouped statement is only
paid when the callback is present).

Task 7 shipped as reviewed: the batch helper is a loop over `repointSource` (one scope read and one
store transaction per pair, with the whole batch validated as a set before the first read) and adds no
store method, no second re-key path, and no event — R12/R15 stay rejected, and the per-pair ACL check
was asserted (both ids of every pair, no decision carried across pairs) rather than assumed.

Task 11 shipped as reviewed, and the gaps the rows above name were the real ones: the handler had to be
built on `RepointHandler` + the note metadata fields (no `_lineage` on notes, R23; no file-format reader,
R24 — both still rejected), and the retire leg needed the *other* seam, so the same object is registered as
a `DeletionPropagationHandler` too (`kind: "fabric"` on both) and tombstones note ids through
`store.invalidate`, which propagates tombstones by record id and by `_lineage` edge — never by
`metadata.fabric.path`, which is why nothing else could have done it. Two deviations from the plan's own
text, recorded here rather than silently: the export lives on the `@arnilo/prism-memory/fabric` subpath
(the root barrel does not publish fabric — Task 2's finding, applied again), and the no-transaction
fallback is one `upsert` call carrying every selected row rather than one call per note (fewer round trips,
same non-atomic exposure). Embeddings are reused verbatim, so the leg adds no embedder call — asserted.

Task 10 shipped as reviewed, with the two rejected options (R21/R22) still rejected: the cap became a page size
rather than a bigger transaction, and the cursor — the last record id in ascending id order — returns control to
the host instead of a background job. The window holds only records that still touch `from`, which is what makes a
stale resume a no-op and keeps the page count honest; `maxRecords` survives as the opt-in all-or-nothing bound, so
plan 089's "over the cap nothing moves" posture is still available to a host that wants it.

Task 9 shipped as reviewed and slightly wider than the note above: `prunedSources` is additive and non-fatal
(as recorded), and the rule reads the manifest's `rawSources` *plus* the page's own `## Raw Sources` list —
`retireWikiSources` prunes the manifest but never rewrites the page, so the page body is the only surviving
record of a pruned path; `normalizeWikiSourcePath` keeps every reported path workspace-relative.

Task 8 shipped as reviewed too: the composition is an executed host recipe
(`packages/memory/src/__tests__/host-wiring.test.ts`), not a runtime and not a facade — R16/R17 stay
rejected, and the read path uses the same tombstone set as the drop leg (one `listInvalidatedIds` read
per projection build), so the review's `listInvalidatedIds` row above is now covered by an executing
test rather than a snippet.

---

## 6. Security confirmations and hard rejections

- **One ACL decision path only.** Store predicates (`packages/memory/src/postgres.ts:L316`, `packages/memory/src/vector-memory.ts:L152`) and the
  boundary gate (`packages/memory/src/rag/access-recheck.ts:L61`) decide; Task 6's callback **reports** predicate outcomes and
  must not widen the predicate (a denied source stays denied). Any design that adds a second decision
  path (e.g. R14, or a store that re-decides after the boundary) is rejected here.
- **No store-level event bus.** Task 7 ships a caller-supplied rename list; R12/R15 (store audit sink,
  `onSourceAccessChanged`) are rejected until the `VectorStore` contract defines such an event.
- **No declared inference dependency.** The local reranker stays a host seam; R25 is rejected. Task 3's
  leg requires no credentials, fetches only the documented model id into the documented cache dir, and
  its report must be asserted secret-free.
- **No file-format reader for fabric notes.** R24 is rejected; Task 11 reads/writes store metadata
  (`metadata.path`, `sourceEntryIds`) through `toNoteMetadata`/`encodeMemoryNoteMetadata`.
- **Redaction stays put.** Denial events carry ids/reasons only (no chunk text, no principal ids, 256-char
  redacted errors: `packages/memory/src/rag/access-recheck.ts:L20`); OM drop entries carry observation ids only (no observation
  text); audit rows keep the `docs/policy-and-audit.md:L112–L119` shape.
- **Scope and privilege.** Propagation and re-point stay privileged (`assertRepointAccess`,
  `propagation.ts` ACL block); Task 7 must not pre-authorize or cache decisions across rename pairs;
  Task 11 touches only the caller's scope; Task 3/9 report no absolute host paths.
- **Fail closed.** Over-cap propagation/re-point rejects whole; a missing runtime or weights under
  `PRISM_TEST_LOCAL_RERANK=1` fails the strict live run (never a silent skip); lint stays non-fatal only
  for pruning, and `ok` semantics (`LintReport:L82`) do not change for broken links/anchors.

## 7. Evidence-artifact scope

Read-only for the tree: this file adds no code, no test, no docs navigation. `docs/index.md` is not
touched (evidence files are not navigation targets, `.agents/skills/create-plan/references/prism-wiki.md`).
Tasks 2–11 must cite a row from §1/§2; any new primitive they need that is absent here is a review gap
and must be added to §3 before implementation.
