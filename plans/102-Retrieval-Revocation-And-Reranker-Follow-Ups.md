# Retrieval Revocation and Reranker Follow-Ups: Host Wiring, Live Evidence, and Durable Propagation

Release: 0.9.x follow-up to plan 089, recorded from that plan's Further Actions. Not part of plan 099's 0.9.0 cut unless a host pulls it forward first: plan 089 already ships correct, documented, fail-closed behavior, and these tasks turn its remaining seams into measured (live reranker), durable (Postgres propagation), and host-usable surfaces.

## Objectives
- Close the two plan-089 gaps a host hits first: an observational ledger that physically records invalidation drops (instead of leaving every host to write its own `OBSERVATIONS_DROPPED` entry) and a deletion-propagation leg that runs against the durable Postgres vector store, not only the in-memory reference store.
- Put a machine behind the local reranker's numbers: a gated live leg that loads the real transformers.js runtime through `createTransformersRerankRuntime`, proves the shipped seam runs `runRerankerConformance` against real weights, and records top-50 latency plus rerank-on/off recall on named hardware in `docs/rag.md`.
- Make the retrieval ACL story auditable end to end: sources silently filtered inside an ACL-declaring store must be reportable to the retrieval boundary (`onAccessDenied`-shaped), and a host-owned source-rename list must be able to drive `repointSource` without a new store event contract.
- Finish the 089 derived-artifact coverage: pruned wiki entities must surface in `prism-wiki lint` and the `wiki-maintainer` skill, file-path fabric notes must follow a move, and re-pointing must not stop at the 4,096-record single-pass cap.

## Expected Outcome
- `createObservationalMemoryDropHandler(...)` is registered on a `DeletionPropagator` and appends one `om.observations.dropped` entry per invalidation batch, so a later `foldObservationalMemoryLedger` no longer shows the invalidated observations; the same ids stay blocked at projection time either way (defense in depth).
- `PRISM_TEST_LOCAL_RERANK=1` runs a network-free-after-download live suite in the live matrix (strict mode fails closed when the gate is set and the runtime or weights are missing), and `docs/_evidence/` carries the latency table with model id, dtype, device, and machine name.
- `docs/rag.md` states measured recall with rerank on/off and the per-platform defaults (`dtype`, shared weight-cache directory), so "the local reranker is usually better" is a number a host can check, not a claim.
- `npm run test:postgres` exercises propagation (1k artifacts, one transaction per propagate call) against pgvector with `PRISM_TEST_POSTGRES_URL`, and `scripts/postgres-evidence.mjs` covers it like the other memory legs.
- A store that declares `authorization: "acl"` can report the sources its own predicate withheld, so the retrieval boundary's `onAccessDenied` sees store-internal filtering too (opt-in, no cost when unused).
- `prism-wiki lint` reports entities whose `rawSources` were pruned by retire/re-point, and the `wiki-maintainer` skill says to re-file them from remaining sources.
- `repointSource` pages past `HARD_REPOINT_RECORDS` with a resumable cursor, and a fabric-note handler moves `kind: "file"` note metadata with the workspace path.

## Tasks

- [x] Task 1: Primitive review — reuse seams for propagation, rerank, and grant integration
  - Acceptance Criteria:
    - Functional: `docs/_evidence/phase102-primitive-review.md` exists and has three sections — (a) reuse rows for every primitive the later tasks build on, each with a `path:line` span, (b) gap rows naming what no current seam does, (c) rejected alternatives with the reason (including every item in the Rejected list below).
    - Functional: the review states per later task whether it reuses a seam as-is, extends a seam, or adds a new one — Task 2 (`DeletionPropagator` handler + `appendCustomEntry`), Task 3 (`createTransformersRerankRuntime` + `runRerankerConformance` + `scripts/live-matrix.mjs`), Task 4 (`docs/rag.md` sizing section), Task 5 (`scripts/postgres-evidence.mjs` + package `test:postgres`), Task 6 (`VectorStore` contract + `authorizationPredicate`), Task 7 (`repointSource` + handlers), Task 8 (`createDeletionPropagator` + `listInvalidatedIds`), Task 9 (`LintReport` + `WikiLinter` + `wiki-maintainer` skill), Task 10 (`HARD_REPOINT_RECORDS` + `repointSource`), Task 11 (`RepointHandler` + `toNoteMetadata`).
    - Performance: the review records the measured cost of the reference paths it cites (propagate 1k tombstones, re-point 1k chunks, access-recheck 50 sources) from the shipping suites rather than restating the plan's claims.
    - Code Quality: the review is deterministic evidence, not prose; every "reuse" row names the exact exported symbol, and every "gap" row names the file that would have to change.
    - Security: the review explicitly rejects any design that adds a second ACL decision path, any store-level event bus, a declared inference dependency, and a file-format reader for fabric notes.
  - Approach:
    - Documentation Reviewed:
      - Plan 089 `Compromises Made` + `Further Actions` (the source of every task here) and `docs/rag.md` (deletion propagation, grant recheck, re-pointing, reranker sizing).
      - `docs/policy-and-audit.md`, `docs/compaction-observational-memory.md`, `docs/wiki.md`, `docs/live-testing.md`.
    - Options Considered:
      - New plan with fresh designs for each item — rejected: 089 shipped the seams; the remaining work is wiring plus two additive surfaces (store reporting, lint rows).
      - Implement directly without a review artifact — rejected by the create-plan primitive rule for plans that add an extension point; Tasks 6 and 9 change contracts, so the reuse/gap decisions need one evidence file.
    - Chosen Approach: one evidence file that maps every 089 Further Action to an existing primitive or a named gap, with spans, before any task touches code.
    - API Notes and Examples:
      ```text
      reuse: packages/memory/src/propagation.ts:?  createDeletionPropagator        → Tasks 2, 8
      reuse: packages/memory/src/repoint.ts:?      repointSource / HARD_REPOINT_RECORDS → Tasks 7, 10, 11
      reuse: packages/memory/src/lineage.ts:?      listInvalidatedIds              → Task 8
      gap:   packages/memory/src/types.ts:?        VectorStore denial reporting    → Task 6
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase102-primitive-review.md` (new).
    - References:
      - Plan 074 Task 1 review (`docs/_evidence/phase74-primitive-review.md`) as the artifact shape; `scripts/plan-review-gate.test.mjs` for the span-citation expectation.
  - Test Cases to Write:
    - None (evidence artifact); the check is that every later task's Approach cites a row from this file.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (internal evidence).
    - Docs pages to create/edit: none (evidence file lives under `docs/_evidence/`)
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (evidence files are not navigation targets).

- [x] Task 2: Observational ledger invalidation drop handler
  - Acceptance Criteria:
    - Functional: `createObservationalMemoryDropHandler({ session, appendEntry })` returns a `DeletionPropagator`-compatible handler that folds the session ledger once (`foldObservationalMemoryLedger(await session.entries())`), selects every active observation where `observationBlockedByInvalidation(observation, new Set(context.ids))` holds, appends exactly one `om.observations.dropped` entry naming those observation ids (`coversUpToId` omitted — the propagator supplies a tombstone set, not a coverage position), and returns the count. Nothing matches → no append, count `0`.
    - Functional: the handler works alongside the token-budget dropper: `foldObservationalMemoryLedger` hides the dropped observations after the entry lands, while `buildObservationalMemoryProjection({ invalidatedIds })` already hides them before it lands (defense in depth, both asserted).
    - Performance: one `session.entries()` read plus one in-memory fold per invocation — the ledger is the sourceEntryIds ↔ observation-id mapping, so no store query and no per-invalidated-id scan; a no-match batch appends nothing.
    - Code Quality: the implementation reuses `appendCustomEntry` from `compaction/observational-memory/append-custom.ts` (no new entry writer, no new ledger fold); exported from the observational-memory surface with the handler typed against the propagator's handler signature so a host cannot register a shape the propagator does not call.
    - Security: no cross-scope writes (the caller supplies the session), no content in the drop entry beyond the observation ids, and the handler must not resurrect or rewrite observation text.
  - Approach:
    - Documentation Reviewed:
      - `docs/compaction-observational-memory.md` (ledger, drop semantics, `listInvalidatedIds` row).
      - Plan 089 Compromises, Task 1 bullet on the OM handler seam.
    - Options Considered:
      - Have the propagator write the ledger entry itself — rejected: the memory package's propagator has no session/append seam and would need a second `SessionEntry` writer.
      - Extend `appendCustomEntry`'s `CustomEntryAppendOptions` — rejected: the shape already matches; only a documented constructor is missing.
      - Have the propagator pass observation ids instead of record ids — rejected: only the ledger knows `sourceEntryIds` ↔ observation ids, and keeping that mapping in the handler keeps the propagator ledger-agnostic.
      - Export `appendCustomEntry` directly and let hosts write the entry — chosen-baseline, but it leaks the entry shape (`type`, `observationIds`, `coversUpToId`) to every host; the handler wrapper is the smaller host-facing surface.
    - Chosen Approach: a thin handler that folds the ledger with the existing `observationBlockedByInvalidation` predicate and delegates the write to `appendCustomEntry`, exported next to the ledger helpers.
    - API Notes and Examples:
      ```ts
      const propagator = createDeletionPropagator({
        scope, vectorStore, authorization,
        handlers: [
          createWikiDeletionHandler({ workspaceRoot }),
          createObservationalMemoryDropHandler({ session, appendEntry }),
        ],
      });
      await propagator.propagate("doc:payroll"); // one om.observations.dropped entry for the affected observations
      ```
    - Files to Create/Edit:
      - `packages/memory/src/compaction/observational-memory/drop-invalidated.ts` (new): handler + options type.
      - `packages/memory/src/compaction/observational-memory/index.ts`: exports (the OM subpath is its own entry point; root `packages/memory/src/index.ts` does not re-export this surface).
      - `packages/memory/package.json`: register the new test file in `test`/`test:postgres` if it lands in its own suite. (Not needed: the existing `dist/compaction/observational-memory/__tests__/*.test.js` glob already runs it.)
      - `docs/rag.md`: one bullet in the deletion-propagation list (executed addition; the example enumerates handlers).
      - `scripts/budgets.json`: export ceiling `@arnilo/prism-memory` 892 → 893 with a reason entry (executed; the new handler name is counted by the src-wide export budget).
    - References:
      - `packages/memory/src/compaction/observational-memory/append-custom.ts:13` (`appendCustomEntry`), `types.ts:5` (`OBSERVATIONS_DROPPED`), `types.ts:41` (`ObservationsDroppedData`), `runtime.ts:266` (existing drop write path), `ledger.ts:22` (`foldObservationalMemoryLedger`), `ledger.ts:64` (`activeObservations`), `ledger.ts:69` (`observationBlockedByInvalidation`).
      - `packages/memory/src/propagation.ts` (handler registry + tombstone ids), `packages/memory/src/lineage.ts` (`listInvalidatedIds`).
  - Test Cases to Write:
    - Drop handler: a session whose ledger holds observations X (from `sourceEntryIds: ["r1"]`) and Y (from `["r2"]`), propagated with `ids: ["r1"]`, appends one drop entry naming X; Y stays active after the fold.
    - No match: a propagate whose ids touch no observation appends nothing (append spy not called) and reports `0`.
    - Idempotence: a second propagate of the same source does not append a second entry (X is no longer active).
    - Projection parity: the same ids passed as `invalidatedIds` and dropped via the entry produce the same rendered memory.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new exported handler on the observational-memory surface.
    - Docs pages to create/edit: `docs/compaction-observational-memory.md` (one row/paragraph: revocation drop handler; the `listInvalidatedIds` row points at it).
    - `docs/index.md` update: no (page exists).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Task 2 Outcome (2026-09-20): all acceptance criteria met; no deviation from the review's seam map.
    - `packages/memory/src/compaction/observational-memory/drop-invalidated.ts` (new): `createObservationalMemoryDropHandler(options: CustomEntryAppendOptions): DeletionPropagationHandler`, `kind: "observational"`; one `session.entries()` read plus one `foldObservationalMemoryLedger`, `activeObservations` filtered by `observationBlockedByInvalidation`, one `appendCustomEntry` write when the set is non-empty (`coversUpToId` omitted), returns the count. No new options type (the reused `CustomEntryAppendOptions` is exported with the handler), no new entry writer, no second fold, no store query. `packages/memory/src/index.ts` untouched (OM is its own subpath entry); `packages/memory/package.json` untouched; `scripts/budgets.json` export ceiling `@arnilo/prism-memory` 892 → 893 with a reason entry (the handler; the reused `CustomEntryAppendOptions` was already counted as a src-wide export).
    - Tests (`packages/memory/src/compaction/observational-memory/__tests__/drop-invalidated.test.ts`, 4/4 pass): real `createDeletionPropagator` + `createMemoryVectorStore` over a real session — only the observation resting on the tombstoned id drops and exactly one entry names it with no `coversUpToId`, the untouched observation stays active, a no-match propagation appends nothing and reports `0`, a repeated propagation reports `0` (idempotent), and `invalidatedIds`-before vs entry-after render identical memory. Memory package suite: 486 pass / 4 skipped / 0 fail; `dist/__tests__/docs.test.js`: 155 pass.
    - Docs: one row in `docs/compaction-observational-memory.md` plus one bullet in `docs/rag.md`'s deletion-propagation list (executed addition beyond the planned page — that list enumerates handlers and would otherwise leave OM looking unhandled); `docs/index.md` untouched.

- [x] Task 3: Local reranker live leg (real transformers.js runtime, named hardware)
  - Acceptance Criteria:
    - Functional: a gated live suite (`PRISM_TEST_LOCAL_RERANK=1`) loads the real runtime through `createTransformersRerankRuntime` (no injected stub), runs `runRerankerConformance` against `resolveReranker({ kind: "local" })`, and asserts the conformance result plus an ordering sanity check on a fixed fixture query.
    - Functional: the suite is registered in `scripts/live-matrix.mjs` with its env var, cost note, and least-privilege scope (no credentials), so `npm run test:live` and `PRISM_LIVE_STRICT=1` account for it; without the gate it skips with a reason (never silently passes).
    - Functional: the run writes `docs/_evidence/phase102-local-rerank-latency.md` (or the matrix report carries it) with top-50 median latency, model id, `dtype`, `device`, machine name, Node version, and whether weights came from cache or a download.
    - Performance: after the first load the leg makes zero network calls (assert via a fetch/transport spy or an offline second score call); top-50 latency is recorded, not asserted to a fixed number, because hardware varies.
    - Code Quality: the suite reuses `runRerankerConformance` and the existing rerank fixtures instead of new shapes; the evidence file is generated by the run (no hand-typed numbers).
    - Security: weights are fetched only from the documented model id into the documented cache dir; the leg asserts no secret-shaped strings in the report; no credentials are required for a local model.
  - Approach:
    - Documentation Reviewed:
      - `docs/rag.md` (local reranker section + sizing paragraph), `docs/live-testing.md` (gate/strict/report conventions), plan 064 Task 6 (remote TEI/hosted rerank legs already registered — this is the missing local leg).
    - Options Considered:
      - Add the local reranker leg to the existing hosted-rerank live suite — rejected: that suite needs network credentials and a service URL; the local leg's whole point is no service.
      - Assert a fixed latency ceiling in CI — rejected: hardware-dependent; the evidence file carries the number and the strict-mode gate proves the seam works.
      - Ship weights in the repo — rejected: size and licensing; the host cache dir is the documented answer.
    - Chosen Approach: env-gated live suite + live-matrix registration + generated evidence row.
    - API Notes and Examples:
      ```ts
      const reranker = resolveReranker({ kind: "local", dtype: "q8", device: "cpu", cacheDir: weightsDir });
      const result = await runRerankerConformance(reranker);   // real weights, no stub
      ```
    - Files to Create/Edit:
      - `packages/memory/src/rag/__tests__/local-reranker-live.test.ts` (new): gated suite.
      - `scripts/live-matrix.mjs` (suite registration), `docs/_evidence/phase102-local-rerank-latency.md` (generated).
      - `packages/memory/package.json`: include the new suite in `test` (skip-gated) if the matrix runs per-package, not only via root. (Not needed: the existing `dist/rag/__tests__/*.test.js` glob already runs it, gate unset → skip.)
      - `packages/memory/src/rag/local-reranker.ts`: fix the built-in transformers.js loader's tokenizer batching (executed fix; the live leg is what exposed it).
    - References:
      - `packages/memory/src/rag/local-reranker.ts` (`createLocalReranker`, `createTransformersRerankRuntime`, `DEFAULT_LOCAL_RERANK_MODEL`), `rag/reranker-config.ts` (`resolveReranker`), `rag/conformance.ts` (`runRerankerConformance`), `scripts/live-matrix.mjs`, `docs/live-testing.md`.
  - Test Cases to Write:
    - Gate unset: suite skipped with a reason that names `PRISM_TEST_LOCAL_RERANK`.
    - Gate set, runtime missing: fail closed with install guidance (not a silent skip).
    - Gate set, weights present: conformance passes, permutation/reference invariants hold, second call issues no fetch, evidence row written.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — new test leg + evidence.
    - Docs pages to create/edit: `docs/live-testing.md` (generated matrix row appears automatically once registered); `docs/rag.md` sizing paragraph gains the evidence link.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Task 3 Outcome (2026-09-20): all acceptance criteria met; one real bug found and fixed by the leg.
    - `packages/memory/src/rag/__tests__/local-reranker-live.test.ts` (new): `PRISM_TEST_LOCAL_RERANK=1` gate, real `resolveReranker({ kind: "local", model, dtype: "q8", device: "cpu", cacheDir })` (no injected runtime), `runRerankerConformance`, top-1 ordering on the fixed "capital of France" fixture, top-50 latency (one warm-up + 5 timed runs, median), and an offline replay through a second reranker with `allowRemoteModels: false` sharing the cache dir — the zero-network-after-load assertion. Writes `docs/_evidence/phase102-local-rerank-latency.md` and asserts the report carries no secret-shaped string and no absolute host path. Gate unset → `skip` naming `PRISM_TEST_LOCAL_RERANK`; gate set with a missing runtime/broken weights → the load error propagates (fail closed, never a silent skip; the install-guidance message itself is asserted hermetically in `rag/__tests__/local-reranker.test.ts`).
    - **Deviation (bug fix):** the first real run failed — `createTransformersRerankRuntime` called `tokenizer(query: string, { text_pair: documents: string[] })`, which transformers.js rejects ("since `text` is a string, `text_pair` must also be a string"). The loader now batches pairs (`tokenizer(documents.map(() => query), { text_pair: documents, … })`), so the built-in zero-config path actually scores. No API change; `packages/memory/src/rag/local-reranker.ts` only. Plan 089 shipped the seam with hermetic stub runtimes, so nothing caught it until this leg.
    - Registration: `scripts/live-matrix.json` gains `memory/local-rerank-live` (`requires: [PRISM_TEST_LOCAL_RERANK]`, `PRISM_LIVE_LOCAL_RERANK_MODEL` wired, no credentials, cost = one ≈280 MB int8 download on a cold cache) and `docs/live-testing.md` is regenerated (`node scripts/generate-live-docs.mjs --write`). Strict run: `PRISM_LIVE_FILTER=local-rerank PRISM_TEST_LOCAL_RERANK=1 PRISM_LIVE_STRICT=1 npm run test:live` → 1 ran / 0 skipped / 0 failed, e2e coverage 108/108.
    - Evidence (two gated runs, cache hit both times, q8/cpu `Xenova/bge-reranker-base`, AMD Ryzen 9 PRO 7940HS / Node 24 / linux x64, 282.7 MB cache): lazy load 1.3–1.5 s, top-50 median 196 ms and 289 ms; conformance, ordering, and offline replay pass. `docs/rag.md`'s sizing paragraph now links the evidence file and quotes the run range instead of the old prose claim.
    - Checks: memory package suite 485 pass / 6 skipped / 0 fail (the new live leg skips without the gate, and `local-reranker.test.ts`'s absent-runtime leg self-skips on a host where the optional runtime is installed — its documented behaviour); `dist/__tests__/docs.test.js` 155 pass; `scripts/live-matrix.test.mjs` + `scripts/live-doc-check.test.mjs` 20 pass; `scripts/e2e-coverage-gate.mjs` 108/108; `scripts/budget-gate.test.mjs` 19/19 (the 4 new non-null sites were rewritten away; `scripts/budgets.json` export ceiling `@arnilo/prism-memory` 892→893 carries Task 2's handler with a reason entry).

- [x] Task 4: Reranker recall measurement and host defaults
  - Acceptance Criteria:
    - Functional: a fixture corpus (golden queries with known relevant chunks, checked in under the memory package fixtures) produces recall@k with rerank on and off; the numbers replace the sizing paragraph's prose claim in `docs/rag.md` and name the corpus size, `k`, model id, dtype, and device.
    - Functional: `docs/rag.md` documents the per-platform default recommendation (`dtype: "q8"` on x86 CPU; fp16/GPU opt-in) and the shared weight-cache convention with embedders (one cache dir per host, model-id subdirs), including what happens on a cache miss.
    - Performance: the measurement runs offline after the first model load and records both latency (reused from Task 3) and quality deltas; the corpus stays small enough to run in the gated leg (no scheduled CI cost without the gate).
    - Code Quality: recall computation is a local helper in the test/evidence path, not a new public export; the corpus is data, not code, and the evidence file is generated.
    - Security: corpus content is non-sensitive; no credential or host path leaks into the evidence row.
  - Approach:
    - Documentation Reviewed:
      - `docs/rag.md` local reranker + sizing sections; `docs/embeddings.md` for the embedder cache conventions the weight cache should mirror.
    - Options Considered:
      - Buy a public benchmark (BEIR) wholesale — rejected: needs a download and a document corpus far beyond what the plumbing regression needs; the fixture corpus targets prune-vs-keep decisions the reranker actually makes.
      - Assert a recall floor in CI — rejected: model- and hardware-dependent; the gate is the strict-mode live leg, the number is evidence.
      - Document only "measure it yourself" — rejected by the follow-up: the sizing table must carry a number.
    - Chosen Approach: fixture corpus + gated measurement + docs numbers, reusing Task 3's runtime.
    - API Notes and Examples:
      ```ts
      // evidence row shape (generated)
      // corpus: 24 queries / 96 chunks | k=5 | bge-reranker-base q8 cpu | recall@5 0.83 → 0.96
      ```
    - Files to Create/Edit:
      - `packages/memory/src/rag/__tests__/rerank-recall.fixtures.ts` (new, corpus), measurement leg extending Task 3's suite. (Executed inline in the Task 3 suite instead: the export budget counts every `src/**` export including test fixtures, so a corpus module would have raised the ceiling for data.)
      - `docs/rag.md` (measured numbers + defaults), `docs/_evidence/phase102-local-rerank-latency.md` (recall section).
      - `docs/embeddings.md` (shared-cache cross-reference).
    - References:
      - `docs/rag.md:177` (current sizing paragraph), `packages/memory/src/rag/local-reranker.ts` (options), plan 064 Task 6 (existing fixtures `packages/memory/src/rag/__tests__/rerank-fixtures.ts`).
  - Test Cases to Write:
    - Recall helper: a synthetic ordering where the reranker promotes a known relevant chunk raises recall@k; an identity ordering returns the baseline number (negative control).
    - Defaults: constructing the local reranker without a cache dir resolves the documented convention; a missing-cache run reports a download in the evidence row.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (defaults are documented, not new options).
    - Docs pages to create/edit: `docs/rag.md` (numbers + defaults), `docs/embeddings.md` (cross-reference the shared cache convention).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Task 4 Outcome (2026-09-20): all acceptance criteria met; measured numbers differ from the plan's illustrative row (the corpus is harder for a lexical baseline than the example assumed, and that is the finding).
    - Corpus + measurement (`packages/memory/src/rag/__tests__/local-reranker-live.test.ts`): 24 topics × (one answering chunk + three *mention-only* chunks: option-list/TOC lines that repeat the query's words and answer nothing) = 24 queries / 96 chunks, indexed once with `createHashEmbedder` (deterministic, no download, no semantics) and queried through the real `retrieveContext` path. Both measured legs score the **whole corpus** as the candidate pool, so the recall delta is ordering only — nothing is unreachable. Local helper `recallAtK` (no new export; the corpus is inlined because `scripts/budget-gates.mjs` `countDirExports` counts test-file exports too — a fixtures module would have cost the @arnilo/prism-memory export ceiling).
    - Measured (gated run, cache hit, `Xenova/bge-reranker-base` q8/cpu, AMD Ryzen 9 PRO 7940HS, Node 24 linux x64): **recall@5 0.208 → 0.792**; pool-bound rows `recall@20 = 0.625` (the package's default `queryCandidates`) and `recall@32 = 0.792`; 5 misses remain after reranking (telemetry-span, sandbox-scope, wiki-raw-source, audit-log, conformance); top-50 median 119 ms (min 118 / max 129) over 5 timed runs. Latency and recall are recorded, never asserted as floors (R8).
    - Deviations: (1) no `rerank-recall.fixtures.ts` — inlined (budget reason above); (2) measurement pool = whole corpus instead of a 20-candidate window, because a narrow pool is a *different* finding (it caps recall) and would have confounded the reranker's contribution — both narrow depths are reported as rows instead; (3) `docs/rag.md:177` (now 178) is a rewritten sizing bullet plus a new **Host defaults** bullet (`dtype: "q8"`/`device: "cpu"` on x86, fp16/GPU opt-in, one shared `cacheDir` with per-model-id subdirectories, cache-miss behavior, `allowRemoteModels: false` for offline hosts) rather than a table; (4) `docs/embeddings.md` gains the shared-cache sentence next to the existing local-reranker bullet.
    - Defaults test cases (as written): the helper's synthetic-ordering case (rank 6 → 0, promoted → 1, no relevant ids → 0) and the identity reranker, which must reproduce the baseline number over the whole corpus (hermetic, ungated — runs in normal CI at ~30 ms). The documented cache convention is asserted on the live leg instead of a stub: `existsSync(cacheDir)` plus weights present under a path naming the model id (the model-id subdirectory layout), and the evidence row reports cache hit vs downloaded-on-this-run.
    - Checks: memory package suite 487 pass / 6 skipped / 0 fail (2 new hermetic tests; the live leg skips without the gate); `dist/__tests__/docs.test.js` 155 pass; strict matrix run `PRISM_LIVE_FILTER=local-rerank PRISM_TEST_LOCAL_RERANK=1 PRISM_LIVE_STRICT=1 npm run test:live` → 1 ran / 0 skipped / 0 failed, e2e coverage 108/108 (`docs/_evidence/live-matrix-report.*` left at their committed state); `scripts/budget-gate.test.mjs` 19/19 with **no** export-ceiling change; biome clean. The gated leg now takes ≈30 s (24 queries × 96 candidates).

- [x] Task 5: Postgres deletion-propagation leg
  - Acceptance Criteria:
    - Functional: `postgres-propagation.integration.test.ts` seeds 1,000 derived chunk rows (plus lineage edges and grants) in a pgvector store with `PRISM_TEST_POSTGRES_URL`, calls `createDeletionPropagator(...).propagate(sourceId)`, and asserts every derived row is tombstoned (`listInvalidated` count), the source rows are gone, and a later `retrieveContext` returns zero hits for the deleted source.
    - Functional: the test also runs a re-point (`repointSource`) on the durable store and asserts re-keyed ids, rewritten lineage edges, and a single transaction per operation (transaction count via `pg_stat_database.xact_commit` delta or a statement-count spy on the pool).
    - Performance: 1k artifacts propagate inside the plan's 2s dev-hardware budget on the durable store too, or the task records the measured number and the reason if it does not.
    - Code Quality: skipped without `PRISM_TEST_POSTGRES_URL` with an explicit reason; registered in `packages/memory/package.json` `test:postgres` and covered by `scripts/postgres-evidence.mjs`; no new fixture store (reuses the existing Postgres integration helpers).
    - Security: ACL mode on (`authorization: "acl"`): the propagation leg proves a principal without a grant cannot propagate, and the re-point leg proves the destination grant is required.
  - Approach:
    - Documentation Reviewed:
      - `docs/rag.md` (propagation + re-point behavior), `docs/live-testing.md`/`docs/_evidence/` Postgres evidence conventions, plan 089 Compromises (durable-store number was measured only in-memory).
    - Options Considered:
      - Time propagation with a raw script instead of a test — rejected: the skip gate and the evidence runner already exist for tests; a script would need its own CI wiring.
      - Reuse the in-memory numbers as "durable" — rejected: the follow-up exists precisely because transactions and round trips differ.
    - Chosen Approach: a Postgres integration suite in the same shape as `postgres-vector.integration.test.ts`, registered in the memory `test:postgres` chain.
    - API Notes and Examples:
      ```ts
      const store = await createPostgresVectorStore({ connectionString: process.env.PRISM_TEST_POSTGRES_URL!, dimension: 8 });
      const result = await createDeletionPropagator({ scope, vectorStore: store, authorization, handlers: [] }).propagate("doc:a");
      assert.equal((await store.listInvalidated(scope)).length, 1_000);
      ```
    - Files to Create/Edit:
      - `packages/memory/src/__tests__/postgres-propagation.integration.test.ts` (new).
      - `packages/memory/package.json` (`test:postgres` entry, plus the hermetic `test` chain so the named skip is visible in normal CI), `scripts/live-matrix.json` (`memory/postgres` scope/notes → `docs/live-testing.md` regenerated). `scripts/postgres-evidence.mjs` needed no change: it totals whatever the chain runs, and `scripts/postgres-evidence.json` is gitignored.
    - References:
      - `packages/memory/src/__tests__/postgres-vector.integration.test.ts` (shape), `packages/memory/src/postgres.ts:822` (`createPostgresVectorStore`), `packages/memory/src/postgres.ts:422`/`739` (`query`/`lexicalQuery`), `packages/memory/src/rag/retrieve.ts` (tombstone guard).
  - Test Cases to Write:
    - 1k tombstone propagation + zero-hit retrieval afterwards.
    - Re-point on the durable store: chunk ids/`_rag` rewritten in one transaction, lineage edges moved, old ids absent.
    - ACL fail-closed: propagation without a grant and re-point to an ungranted destination both reject with rows unchanged.
    - Skip path: suite reports skipped with the env var name when `PRISM_TEST_POSTGRES_URL` is unset.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evidence for existing behavior.
    - Docs pages to create/edit: `docs/rag.md` (durable-store numbers next to the in-memory ones).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Task 5 Outcome (2026-09-20): all acceptance criteria met on `pgvector/pgvector:pg16`; no production change was needed, and the leg's real find was a fixture-shape question that changed what the test proves.
    - Suite (`packages/memory/src/__tests__/postgres-propagation.integration.test.ts`, 3 tests, skipped with the named reason `set PRISM_TEST_POSTGRES_URL to run the durable deletion-propagation leg`):
      (1) **Propagation.** 1,000 derived chunk rows (each a real chunk of a derived source: `_rag` identity + `_lineage.sourceIds = [doc:large]`) plus one indexed source document and its ACL grant; the propagator registers `createRagDeletionHandler`, so the pass is the real flow — tombstone the derived artifacts, then physically remove the source's own chunk rows. Measured: `tombstoned = 1,001` (root + 1,000 derived), `batched = true`, **1 transaction** (BEGIN/COMMIT counted on the pooled client — the same seam `runVectorTransaction` uses, chosen over `pg_stat_database.xact_commit` because `node --test` runs test files in parallel and the delta would be noisy), **22 statements** of which 16 are `HARD_INVALIDATION_BATCH`-sized inserts, `elapsed` 29–47 ms idle / 155 ms under full-chain load, asserted `< 2,000 ms`. `listInvalidated` = 1,001 rows; `getByThread` = the 1,000 derived rows (tombstones, never a purge) and no `doc:large#…` rows; `store.query` = 0 rows, `retrieveContext` = 0 hits.
      (2) **Re-point.** 1 chunk row + 3 lineage edges with grants for both ids: `movedChunks`/`rewrittenEdges` correct, `batched = true`, 1 transaction (3–8 ms); old ids retired, `_rag.sourceId`/`citationId` rewritten, text and embedding byte-identical (no re-embed); then propagation of the old source no longer reaches the derived rows and propagation of the new source tombstones them — the durable version of the lineage-rewrite invariant.
      (3) **ACL fail-closed.** Denied propagation and a re-point to an ungranted destination both reject with `MemoryScopeError` and **no transaction is opened** (`BEGIN` count 0); tombstones stay empty, the source chunk keeps its old id, and no row appears under the ungranted destination.
    - Fixture-shape finding (recorded, not a defect): the durable SQL predicate (`invalidationPredicate`, `packages/memory/src/postgres.ts:L342`) hides a row by its own tombstone or by a tombstoned `_lineage.sourceIds` edge — not by `_rag.sourceId`, exactly like the in-memory store (`recordBlocked`, `packages/memory/src/lineage.ts:L157`). Source-owned chunk rows are therefore hidden at the retrieval boundary by `retrieveContext`'s `_rag.sourceId` guard and physically removed by the `rag` handler; the first fixture (source rows left in place) would have asserted store-level hiding that neither store promises. Rewriting the fixture to derived chunk rows made the test prove the durable predicate for real (`store.query` 0 rows) and made “the source rows are gone” literal.
    - Checks: `PRISM_TEST_POSTGRES_URL=… npm run test:postgres` → **589 tests / 583 pass / 0 fail** (memory workspace 503/497/0, including the 3 new durable tests); hermetic `npm test --workspace @arnilo/prism-memory` 493/487/0 with the new suite reporting as a named skip; strict live run `PRISM_LIVE_FILTER=postgres PRISM_LIVE_STRICT=1 npm run test:live` → 2 ran / 0 skipped / 0 failed, e2e coverage 108/108; `scripts/budget-gate.test.mjs` 19/19 (no export-ceiling or assertion-budget change); docs + plan + live-matrix gates 176 pass; dead-export scan 0 candidates; biome clean. Docs carry the durable numbers next to the in-memory ones (`docs/rag.md` propagation and re-point sections).

- [x] Task 6: Store-level denial reporting for ACL-filtering stores
  - Acceptance Criteria:
    - Functional: an ACL-declaring store can report which sources its own predicate withheld, opt-in per query: `VectorQuery.lexicalQuery`/`query` accept an optional `onDeniedSources?(denials: readonly { sourceId: string; reason: "no_grant" | "version_mismatch" | "unknown" }[]) => void`, and the Postgres store fills it only when provided.
    - Functional: `retrieveContext` forwards the store callback into the same `AccessRecheck` audit path, so a source filtered inside SQL produces the same `onAccessDenied` event as a boundary denial (one event per source per query, not per row).
    - Functional: without the callback the SQL is byte-identical to today (the predicate stays in the query; no extra statement) — verified by an EXPLAIN/statement-count test.
    - Performance: when the callback is present the store may issue one extra grouped statement (`SELECT source_id, count(*) … WHERE NOT <authorization predicate> GROUP BY source_id`) — measured and documented; absent, zero overhead.
    - Code Quality: the callback is an optional field on the existing query types, not a new capability object or event bus; the in-memory reference store implements it by construction (it already sees every row) so both stores satisfy the same contract.
    - Security: the reporting path must not widen the predicate (a denied source is still denied), the callback receives ids and reasons only (no chunk text, no principal ids), and the audit event keeps the existing redaction rules.
  - Approach:
    - Documentation Reviewed:
      - `docs/policy-and-audit.md` (memory retrieval ACL denial events), `docs/rag.md` (grant recheck), plan 089 Compromises (audit surface split by who filters).
    - Options Considered:
      - Have the store emit audit events itself — rejected: the store has no audit sink and would need one, duplicating the boundary's redaction/telemetry path.
      - Always run the "denied counts" statement — rejected: doubles query cost for every host that never reads the callback.
      - Drop store-side filtering and let the boundary filter everything — rejected: that moves the ACL join out of the indexed query and would leak denied rows across the process boundary for no gain.
    - Chosen Approach: optional per-query callback, implemented in the store's existing predicate assembly, consumed by the access recheck.
    - API Notes and Examples:
      ```ts
      await retrieveContext(query, {
        store, scope, embedder, authorization,
        onAccessDenied: (d) => audit.write(d),   // now also fires for store-filtered sources
      });
      ```
    - Files to Create/Edit:
      - `packages/memory/src/types.ts` (query types + doc comments), `packages/memory/src/rag/types.ts` (retrieval plumbing).
      - `packages/memory/src/postgres.ts` (`authorizationPredicate` reporting + the opt-in statement), `packages/memory/src/vector-memory.ts` (reference store parity).
      - `packages/memory/src/rag/access-recheck.ts`, `packages/memory/src/rag/retrieve.ts` (forwarding + dedupe).
    - References:
      - `packages/memory/src/postgres.ts:316` (`authorizationPredicate`), `:370` (`authorization: "acl"`), `:422`/`:739` (query assembly), `packages/memory/src/rag/access-recheck.ts` (`allows`, `report`), `docs/policy-and-audit.md`.
  - Test Cases to Write:
    - Postgres leg: a revoked grant produces one denial event with the right source id and reason; the same query without the callback issues no extra statement.
    - Reference store: parity — the same scenario yields the same single event.
    - Dedupe: 20 denied chunks from one source yield one event; two sources yield two.
    - No-widening: hits returned with and without the callback are identical.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — additive optional query field and new audit coverage.
    - Docs pages to create/edit: `docs/policy-and-audit.md` (store-filtered denials now reportable), `docs/rag.md` (one line in the grant-recheck section).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Task 6 Outcome (2026-09-20): all acceptance criteria met on both stores; the one place the shipped shape differs from the plan sketch is that the callback carries ids and reasons **without** a per-source count (the plan's type lists `{ sourceId, reason }`), so the grouped statement groups without counting.
    - Contract (`packages/memory/src/types.ts`): `StoreDenial = { sourceId, reason: "no_grant" | "version_mismatch" | "unknown" }` + `StoreDenialReason`, with `onDeniedSources?: (denials: readonly StoreDenial[]) => void` added to `VectorQuery` and `VectorLexicalQuery` — one optional field on the existing query types, no capability object and no event bus. The callback fires once per query with the whole list (empty list included, so a host gets a per-query signal) and only for rows the leg considered: an empty lexical query and a `topK < 1` lexical leg report nothing in both stores, a `topK < 1` vector leg still reports what it scanned.
    - PostgreSQL (`packages/memory/src/postgres.ts`): `authorizationPredicate` was split into `authorizationExists` (the predicate itself) so the reporting statement can negate it without rewriting it, and `reportDeniedSources` adds **one** grouped anti-join when — and only when — the caller opts in and an authorization constraint is present. The reason column is a `CASE` over two grant `EXISTS` probes (`no_grant` = no grant for this principal/groups; `version_mismatch` = a grant exists at another `accessVersion`; `unknown` = the fail-closed label for a withholding the probes cannot name, unreachable in both shipped stores by construction). The statement mirrors the leg's own filters — scope, generation, the lexical `text_tsv` match, `ids`, and the invalidation predicate — so a source whose text does not match the query is not reported as a denial; rows without a `_rag.sourceId` are left out entirely rather than attributed to nobody.
    - Memory adapter (`packages/memory/src/vector-memory.ts`): `createDenialReporter` collects during the same scan that already sees every row, and the ACL check moved after the invalidation and text checks in both legs so the report cannot over-claim rows that would have been filtered for another reason. Reasons are classified per source (grant absent → `no_grant`, grant at another version → `version_mismatch`).
    - Boundary plumbing (`packages/memory/src/rag/access-recheck.ts`, `rag/retrieve.ts`): `AccessRecheck.noteStoreDenials(scope, denials)` seeds the same per-source entry map, so a store-filtered source produces **one** `onAccessDenied` event per query even when both legs report it; a boundary answer for a source wins over its store report (if the boundary allowed it, the caller got hits and there is nothing withheld to audit), and `hits: 0` records that no hit ever existed. Store reasons collapse to the boundary's `no_grant` — the event is the one the boundary would have produced for that source — and the finer rule stays on the query-level callback. Forwarding is gated on `options.onAccessDenied`, so a host with no sink never pays for the extra statement.
    - Tests: `postgres-vector.integration.test.ts` (durable leg: exactly 1 statement without the callback and 2 with it, the main SQL captured byte-for-byte and compared across both runs, one entry for 20 withheld rows of one source, `no_grant`/`version_mismatch` classified, hits identical with and without the report, the lexical leg not reporting a withheld source whose text does not match); `rag-acl.test.ts` (memory-store parity on both legs, per-source grouping, per-query once, no-widening); `rag/__tests__/access-recheck.test.ts` (retriever forwarding: 20 withheld rows of one source → one event from both legs, the same event a boundary denial raises, and the store never asked when no sink is supplied).
    - Checks: `PRISM_TEST_POSTGRES_URL=… npm run test:postgres` → **506 tests / 500 pass / 0 fail**; hermetic `npm test --workspace @arnilo/prism-memory` 495/489/0 (6 named skips); strict live `PRISM_LIVE_FILTER=postgres PRISM_LIVE_STRICT=1 npm run test:live` → 2 ran / 0 failed, e2e 108/108; docs + plan + live-doc gates 162 pass; `scripts/budget-gate.test.mjs` 19/19 after rebaselining the `@arnilo/prism-memory` export ceiling 893 → 895 (+2: `StoreDenial`, `StoreDenialReason`) and removing every non-null assertion the new tests would have added (memory `src` stays at its recorded 221); dead-export scan 0 candidates. Measured opt-in cost of the report statement: **1.2–1.4ms** per query on the 23-row fixture idle (3.6ms under the full parallel chain), documented in `docs/rag.md` and `docs/policy-and-audit.md` together with the store-level callback example.

- [x] Task 7: Source-rename driven re-pointing (demand-gated)
  - Acceptance Criteria:
    - Functional: `applySourceRenames({ scope, vectorStore, renames, authorization?, handlers?, signal? })` takes host-owned `{ from, to }` pairs, validates them (no duplicates, no chained/overlapping moves in one call, non-empty ids), and calls `repointSource` per pair, returning per-rename results plus failures instead of stopping at the first error only when `continueOnError` is set (default: fail fast, no partial silent success).
    - Functional: the helper records one audit event per rename (from, to, moved chunks, layers, outcome), so a host can log identity moves exactly like it logs denials.
    - Functional: the task explicitly decides the store-level push question: it ships only if a host provides a real change source that cannot be polled; otherwise the rename list is the contract and no store event is added (decision recorded in the plan's Compromises).
    - Performance: N renames cost N propagations, each bounded by `HARD_REPOINT_RECORDS`; the helper adds no store round trip of its own.
    - Code Quality: thin loop over `repointSource` (no second re-key implementation, no new store method); the type accepts the same handler list so wiki/fabric handlers run per rename.
    - Security: renames run under the caller's authorization; each pair is ACL-checked by `repointSource` on both ids (the helper must not pre-authorize or cache decisions across pairs).
  - Approach:
    - Documentation Reviewed:
      - `docs/rag.md` (re-pointing section), plan 089 Compromises (re-point is an explicit host call; no grant-change event exists).
    - Options Considered:
      - Add `VectorStore.onSourceAccessChanged` and auto-re-point — rejected for now: it requires every store to implement an event, and the events would carry no rename mapping, so the host would still supply `{from,to}` pairs; two hosts must need push before this earns a contract change.
      - Have the host loop `repointSource` itself — chosen baseline; the helper only removes the audit/error-shape duplication.
    - Chosen Approach: demand-gated helper over the existing re-point seam, audited, with the push notification documented as the upgrade path.
    - API Notes and Examples:
      ```ts
      const { results, failures } = await applySourceRenames({
        scope, vectorStore, authorization,
        renames: [{ from: "doc:a", to: "doc:b" }],
        handlers: [createWikiRepointHandler({ workspaceRoot })],
      });
      ```
    - Files to Create/Edit:
      - `packages/memory/src/repoint.ts` (helper + types) or a sibling module if the file grows past its budget.
      - `packages/memory/src/index.ts` (exports).
    - References:
      - `packages/memory/src/repoint.ts` (`repointSource`, `RepointHandler`, `HARD_REPOINT_RECORDS`), `packages/memory/src/wiki/repoint.ts` (`createWikiRepointHandler`), `docs/policy-and-audit.md` (audit shape).
  - Test Cases to Write:
    - Two renames: both applied, two audit events, handlers run per rename.
    - Validation: duplicate/overlapping ids reject before any store write.
    - Fail-fast vs `continueOnError`: one failing pair leaves the other untouched in fail-fast mode and is reported in the continuation mode.
    - ACL: an ungranted destination fails that pair only; previously moved pairs stay moved (documented, asserted).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new exported helper.
    - Docs pages to create/edit: `docs/rag.md` (re-point host helper), `docs/policy-and-audit.md` (rename audit event).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Task 7 Outcome (2026-09-20): shipped as an audited loop over `repointSource`; the store-level push question is decided (no event — see Compromises). One shipped shape differs from the plan sketch: validation claims every id **once** across the whole batch, so a chain (`a→b`, `b→c`) and an overlap (`a→b`, `c→a`) are both rejected as ambiguous rather than ordered.
    - API (`packages/memory/src/repoint.ts`, exported from `packages/memory/src/index.ts`): `applySourceRenames({ scope, vectorStore, renames, authorization?, handlers?, signal?, maxRecords?, continueOnError?, onRenamed?, redact? })` → `{ results, failures }`, reusing `RepointSourceOptions` through `Omit<…, "from" | "to">` so it accepts the same handler list, authorization, signal, and cap. New names: `applySourceRenames`, `SourceRename`, `SourceRenameEvent`, `ApplySourceRenamesOptions`, `ApplySourceRenamesResult` (+5 → export ceiling 895 → 900). No new file, no new store method, no second re-key path.
    - Validation is whole-batch and runs before the first store read: duplicate ids, a chained move, an overlapping move, `from === to`, an empty id, a missing array, or a non-object pair all reject with `MemoryValidationError` and touch no store call (asserted with a call counter: 0 reads, 0 writes). An empty list is a documented no-op (`{ results: [], failures: [] }`), not an error.
    - Fail-fast is the default: each pair is handed to `repointSource` as-is (no pre-authorization, no cached decision — 3 pairs = 6 `checkSourceAccess` calls asserted), a failing pair writes nothing, later pairs never start, and the original error propagates after that pair's audit event. `continueOnError: true` records `{ from, to, error }` in `failures` and keeps going; `error` passes through the optional `redact` and is capped at 256 chars.
    - Audit (`onRenamed`, one event per rename that settled): `{ from, to, outcome: "moved", movedChunks, rewrittenEdges, layers }` or `{ from, to, outcome: "failed", error }` — ids, counts, and a redacted reason only, never rows or text. A pair a fail-fast run never started is not audited (documented: diff your own list or use `continueOnError`), and an abort stops the batch without being recorded as a rename failure (asserted mid-batch: the committed pair is audited, the aborted pair is not).
    - Performance held as specified: N renames cost N propagations, each bounded by `HARD_REPOINT_RECORDS`, and the helper adds no store round trip — asserted as one scope read per rename (2 renames → 2 reads) and one store transaction per pair.
    - Tests (`packages/memory/src/__tests__/repoint.test.ts`, new `host rename batch` suite, 5 cases): batch apply with per-rename handlers and per-rename audit; whole-batch validation before any store call; fail-fast; `continueOnError` + per-pair ACL re-check + redaction; abort mid-batch.
    - Checks: `npm test --workspace @arnilo/prism-memory` → **500 tests / 494 pass / 0 fail** (6 named skips, +5 new); docs + plan + live-doc gates 162 pass; `scripts/budget-gate.test.mjs` 19/19 after the export rebaseline (no non-null assertions added); `scripts/dead-exports.mjs` 0 candidates; `biome lint` + `biome format` clean across `packages/memory/src` and `docs` (the `assist/source/organizeImports` findings `biome check` reports in untouched files are pre-existing and outside the repo's `npm run lint`).
    - Docs: `docs/rag.md` gained a "Renaming in batches" block (contract, validation, fail-fast vs `continueOnError`, audit shape); `docs/policy-and-audit.md` gained the `rag.repointed` row plus a paragraph tying rename audit to the denial events; the primitive review records that Task 7 shipped as reviewed (R12/R15 still rejected).

- [x] Task 8: Cross-layer host entry point and invalidated-OM wiring (demand-gated)
  - Acceptance Criteria:
    - Functional: an in-tree, network-free example (or recipe doc with a compiling snippet that the docs test executes) shows a host composing `createDeletionPropagator` with the RAG, wiki, OM-drop, and fabric handlers in one place, plus feeding `listInvalidatedIds(store, scope)` into `buildObservationalMemoryProjection({ invalidatedIds })` / recall so already-emitted blocks go stale.
    - Functional: the demand-gated `propagateDeletion` facade (if a host asks) is a runtime-level function that takes the propagator inputs and registered handlers and returns the same result shape — no facade method on the memory store, no duplicated handler registry.
    - Functional: the example/recipe is registered in `docs/index.md` navigation if it becomes a page; otherwise the wiring lives in `docs/rag.md` + `docs/compaction-observational-memory.md` snippets.
    - Performance: the recipe does one `listInvalidatedIds` read per projection build (documented cost); the facade adds no work beyond the propagator.
    - Code Quality: no new abstraction unless a host exists; the example must compile against the public exports only (a packed-install-style import check where practical).
    - Security: the recipe keeps `authorization` privileged (host-verified principal), states that OM ids are withheld whether or not the physical drop ran, and never prints observation text into audit output.
  - Approach:
    - Documentation Reviewed:
      - `docs/rag.md:162` (`listInvalidatedIds` paragraph), `docs/compaction-observational-memory.md`, docs structure rules in `prism-wiki.md` (example page shape).
    - Options Considered:
      - Wire the composition into an in-tree host runtime — rejected: no in-tree host composes an OM runtime with a memory vector store yet (plan 089's recorded gap); inventing one is not a follow-up, it is a new feature.
      - Facade method on the memory store — rejected: the memory facade holds no rag/wiki/observational deps (plan 089 Compromises).
    - Chosen Approach: executable example/recipe now; facade only when a host asks, shaped as a function.
    - API Notes and Examples:
      ```ts
      const blocked = await listInvalidatedIds(store, scope);
      const blocks = buildObservationalMemoryContextBlocks(entries, { invalidatedIds: blocked });
      ```
    - Files to Create/Edit:
      - `examples/` (new network-free example) and/or `packages/memory/src/__tests__/` snippet test; `docs/rag.md`, `docs/compaction-observational-memory.md`; `docs/index.md` only if a new page is created.
    - References:
      - `packages/memory/src/lineage.ts` (`listInvalidatedIds`), `packages/memory/src/propagation.ts` (`createDeletionPropagator`), `packages/memory/src/compaction/observational-memory/projection.ts:30` (`invalidatedIds`), plan 089 Further Actions.
  - Test Cases to Write:
    - Snippet test: the composed wiring compiles and runs against the reference store with one fake handler; the projection drops an observation whose source was invalidated.
    - Regression: without `invalidatedIds` the same projection keeps the observation (control).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes if the facade lands; the example itself is documentation.
    - Docs pages to create/edit: `docs/rag.md`, `docs/compaction-observational-memory.md` (and a new example page only if it grows beyond a snippet).
    - `docs/index.md` update: only if a new page is created.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Task 8 Outcome (2026-09-20): shipped the executable recipe; no page was created, so `docs/index.md` and `examples/` are untouched, and the demand-gated facade was not added (no host asked — see Compromises).
    - Executable recipe (`packages/memory/src/__tests__/host-wiring.test.ts`, new; registered in both the `test` and `test:postgres` chains in `packages/memory/package.json`): one propagation pass wires three legs in one place — `createRagDeletionHandler({ store, scope })`, `createWikiDeletionHandler({ workspaceRoot })`, `createObservationalMemoryDropHandler({ session, appendEntry })` — against the reference store and a real session ledger, importing only published entry points (`@arnilo/prism-memory`, `/rag`, `/wiki`, `/compaction/observational-memory`).
    - What the pass proves: `layers: { rag: 1, wiki: 1, observational: 1 }` on one `propagate(sourceId)`; the source's chunk rows are physically gone while the derived row survives as a tombstone; the wiki manifest drops the retired entity and the log records the path; one ledger append carries `om.observations.dropped` with observation ids and the test asserts no observation text appears anywhere in it.
    - Both host paths are asserted, not described: the fold path (`buildObservationalMemoryProjection(entries)` after the drop entry) and the read path (`listInvalidatedIds(store, scope)` → `buildObservationalMemoryProjection(before, undefined, { invalidatedIds })` from a pre-propagation snapshot) render the **same** memory, one `listInvalidated` read per `listInvalidatedIds` call is counted (the documented cost), and the control — the same snapshot without `invalidatedIds` — keeps both observations. So an id is withheld whether or not the physical drop ran.
    - Security: `authorization` stays a required, host-verified principal (the type requires it, and a cross-tenant principal is refused with `MemoryScopeError` before any write); the recipe states that tombstoned ids are withheld on both paths, and the audit assertion pins that the drop entry carries ids only.
    - No fabric leg: fabric notes are store-backed metadata rather than derived chunk rows, so they need no handler here; plan 102 Task 11 owns the path handler, and both docs say so.
    - Fixture trap worth remembering: a seeded observation must be chained through `parentId: session.leafId` before `session.checkout(entry.id)` — an unchained entry is a sibling branch, and the handler folds the *current branch*, so the observation is invisible to the drop leg (found by this leg, recorded here rather than in the recipe).
    - Checks: `npm test --workspace @arnilo/prism-memory` → **501 tests / 495 pass / 0 fail** (6 named skips, +1); docs + plan + live-doc gates 162 pass; `scripts/budget-gate.test.mjs` 19/19 with **no** export change (the recipe is a test) and no non-null assertion added; `scripts/dead-exports.mjs` 0 candidates; `biome lint` + `biome format` clean across `packages/memory/src`, `packages/memory/package.json`, and `docs`.
    - Docs: `docs/rag.md` gained "One wiring, every layer (host recipe)" (composition, per-layer evidence, both read paths, the no-facade statement, fabric note); `docs/compaction-observational-memory.md` gained "Revocation wiring (plan 102 Tasks 2/8)" with the two-line read path next to the write path; the primitive review records that Task 8 shipped as reviewed (R16/R17 stay rejected).

- [x] Task 9: Wiki pruned-entity surfacing in lint and the maintainer skill
  - Acceptance Criteria:
    - Functional: `LintReport` gains `prunedSources` (or `staleEntities`): entities whose `rawSources` are all missing on disk or were pruned by `retireWikiSources`/`repointWikiSources`, each with the entity page and the offending source paths; `ok` stays true when only pruned sources remain (a pruned entity is work for the maintainer, not a broken wiki).
    - Functional: `prism-wiki lint` / `createWikiLintCommand` outputs the count and the first few paths, and the summary line distinguishes "pruned sources needing re-file" from dead anchors/broken links/orphans.
    - Functional: `packages/memory/skills/wiki-maintainer/SKILL.md` gains a short section: on a pruned-entity report, re-read the remaining sources and re-file the page; delete the page when no sources remain.
    - Performance: lint reads the manifest and the file existence set once (no per-entity glob); the check is skipped for a wiki without a manifest.
    - Code Quality: the new rule lives in `WikiLinter.lint` next to the orphan rule and reuses the manifest's `rawSources`; no new report file format, no new CLI command.
    - Security: report paths are workspace-relative (no absolute host paths), and the lint command keeps its untrusted-external metadata.
  - Approach:
    - Documentation Reviewed:
      - `docs/wiki.md` (lint output + maintainer skill), plan 089 Compromises (shared entities are pruned and left for the maintainer).
    - Options Considered:
      - Make `retireWikiSources` rewrite pages itself — rejected: it would need the symbol extractor and raw reads for zero content change (plan 089 Compromises).
      - Fail lint on pruned sources — rejected: pruning is a legitimate propagation outcome; failing the health check would make propagation and lint fight.
      - Add a separate `wiki-pruned` command — rejected: one report, one command is the existing shape.
    - Chosen Approach: extend `LintReport`/`WikiLinter` with a non-fatal pruned-sources list and teach the skill what to do with it.
    - API Notes and Examples:
      ```ts
      const report = await lintWiki({ wikiRoot: ".wiki", workspaceRoot });
      report.prunedSources; // [{ page: "entities/acme.md", missing: ["docs/acme.md"] }]
      ```
    - Files to Create/Edit:
      - `packages/memory/src/wiki/types.ts` (`LintReport`), `packages/memory/src/wiki/engine/linter.ts` (rule), `packages/memory/src/wiki/commands/lint.ts` (summary), `packages/memory/src/wiki/cli.ts` (text output if it renders fields).
      - `packages/memory/skills/wiki-maintainer/SKILL.md`, `docs/wiki.md`.
    - References:
      - `packages/memory/src/wiki/types.ts:77` (`LintReport`), `wiki/engine/linter.ts:144` (orphan rule), `wiki/manifest.ts:131` (`rawSources`), `packages/memory/src/wiki/retire.ts` (pruning), `packages/memory/skills/wiki-maintainer/SKILL.md`.
  - Test Cases to Write:
    - An entity whose only source was retired shows up in `prunedSources` while `ok` stays true.
    - A partially pruned entity (one of two sources gone) is reported with only the missing path.
    - A wiki with no manifest: no pruned report, no throw.
    - CLI/command text contains the count and a workspace-relative path.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — additive `LintReport` field and CLI output.
    - Docs pages to create/edit: `docs/wiki.md` (lint output section + maintainer skill behavior).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Task 9 Outcome (2026-09-20): shipped as reviewed — one additive `LintReport` field, one linter rule, one non-fatal text line, and the skill section; no new command, no new report file, no page rewrite.
    - Report (`packages/memory/src/wiki/types.ts`): `PrunedSource { page, missing }` plus `LintReport.prunedSources`. `ok` is unchanged by it (dead anchors and broken links still decide `ok`), so a pruned projection reads as maintainer work rather than a broken wiki.
    - Rule (`packages/memory/src/wiki/engine/linter.ts`, new step 6 next to the orphan rule): for every manifest entity it unions the manifest's `rawSources` with the paths the page lists under `## Raw Sources` (the compiler's projection, which `retireWikiSources` deliberately does not rewrite) and reports the ones missing on disk, normalized through the existing `normalizeWikiSourcePath` so every reported path is workspace-relative. Existence is resolved once per distinct path (`access` + a per-run cache — no per-entity glob), and the whole rule is skipped when there is no manifest (the early return now carries `prunedSources: []`).
    - Why both sources of truth: the manifest catches a source deleted out-of-band (and a re-point target that does not exist), while the page body is the only place a *pruned* path survives — `retireWikiSources` drops it from `rawSources`/anchors, so a partially pruned entity is invisible to a manifest-only check. The tests pin both, and pin the boundary: a *fully* pruned entity is deleted by `retireWikiSources` (entry + page), so it correctly reports nothing.
    - Text (`packages/memory/src/wiki/commands/lint.ts` `renderPrunedSources`, shared with `packages/memory/src/wiki/cli.ts` so the two surfaces cannot drift): a count plus the first few `page (missing…)` entries, capped at 3 pages/3 paths each. The summary line keeps pruned sources separate from "N dead anchor(s), N broken link(s), N orphan(s)"; the CLI prints the same line and its per-page detail, and still exits **0** on a clean wiki that only has pruned pages — verified by the CLI test capturing stdout.
    - Skill (`packages/memory/skills/wiki-maintainer/SKILL.md`, Health Check section): a `Pruned Sources` bullet plus a four-step response — re-read the surviving sources, re-file the page (`wiki-refresh` or a manual rewrite that drops the pruned path), delete the page and its index entry when no sources remain, and never restore a revoked source by copying content into the wiki.
    - Docs (`docs/wiki.md`): `/wiki-lint` bullet, CLI comment, and a lint-output paragraph recording the report shape, that `prunedSources` never fails the check, and the maintainer response. `docs/index.md` unchanged (no new page).
    - Checks: `npm test --workspace @arnilo/prism-memory` → **507 tests / 501 pass / 0 fail** (6 named skips, +6); docs + plan + live-doc + package-boundary + install-smoke gates 181 pass; `scripts/budget-gate.test.mjs` 19/19 after rebaselining the memory export ceiling 900 → **902** with a recorded reason (+2: `PrunedSource`/`prunedSources` and the shared `renderPrunedSources`; no non-null assertions added); `scripts/dead-exports.mjs` 0 candidates; `biome lint`/`format` clean.

- [x] Task 10: Paged re-point above the single-pass cap
  - Acceptance Criteria:
    - Functional: `repointSource` gains a paging mode (`pageSize?`/`resumeFrom?` or an async iterator) that re-keys more than `HARD_REPOINT_RECORDS` records in bounded pages, each page atomic (ids re-keyed + edges rewritten + old ids deleted in one transaction), and returns a cursor so a host can resume after a crash without re-embedding or double-moving.
    - Functional: resuming with a stale cursor is safe: a page whose records were already moved is a no-op, and a destination collision still fails closed.
    - Functional: `HARD_REPOINT_RECORDS` remains a per-page bound, not a global ceiling; the docs say which one a host hits.
    - Performance: page size is host-tunable with a documented default (e.g. 4,096); each page is one transaction and the ACL check runs once per call, not per page.
    - Code Quality: the page loop reuses the existing per-page implementation (no second re-key path), and the cursor is an opaque value derived from the record id ordering the store already returns.
    - Security: a resumed re-point re-validates authorization once at start (the caller's principal cannot change mid-call), and a cursor from a different scope/source pair is rejected.
  - Approach:
    - Documentation Reviewed:
      - `docs/rag.md` (re-point section + `HARD_REPOINT_RECORDS`), plan 089 Compromises (one-pass cap; paging needs resumable cursors across ACL check, store write, handler pass).
    - Options Considered:
      - Raise the cap — rejected: a bigger single transaction is the failure mode the cap exists to bound.
      - Background job with its own store — rejected: no scheduler in this package; a cursor returns control to the host.
    - Chosen Approach: cursor-based paging over the existing per-page code path, handlers run once per page with the page's moved ids.
    - API Notes and Examples:
      ```ts
      let cursor: string | undefined;
      do {
        const page = await repointSource({ scope, vectorStore, from, to, authorization, handlers, cursor, pageSize: 1_000 });
        cursor = page.cursor;
      } while (cursor);
      ```
    - Files to Create/Edit:
      - `packages/memory/src/repoint.ts` (paging + cursor type), `packages/memory/src/index.ts`, handler contracts if a handler needs per-page ids.
      - `packages/memory/src/__tests__/repoint.test.ts` (extend) or a paging suite.
    - References:
      - `packages/memory/src/repoint.ts` (`HARD_REPOINT_RECORDS`, transaction body), `packages/memory/src/types.ts` (store paging/order guarantees).
  - Test Cases to Write:
    - 4,097 records move across two pages with one transaction each; final state has no old ids and no duplicates.
    - Crash between pages: resume with the returned cursor completes without re-moving the first page.
    - Stale/foreign cursor: rejected with a validation error before any write.
    - Handler run count: one per page, with that page's ids.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — re-point options/result grow cursor fields.
    - Docs pages to create/edit: `docs/rag.md` (paging mode + cap wording).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Task 10 Outcome (2026-09-20): shipped as reviewed — a page size, a cursor, and one reused per-record path; R21 (raise the cap) and R22 (background job) stay rejected.
    - API (`packages/memory/src/repoint.ts`): `repointSource` gained `pageSize?` (default `HARD_REPOINT_RECORDS` = 4,096) and `cursor?`, and `RepointSourceResult` gained `cursor?`. **One call moves one page**: the scope is no longer capped, a page is the first `pageSize` records that still need work past the cursor, and each page commits in its own transaction (`batched: true`). Zero new exports, so the package export ceiling was untouched.
    - Cursor: base64url of `{ v, from, to, tenantId, resourceId, threadId, after }` where `after` is the last record id the page considered. Ids are compared directly and the window is id-sorted, so a resume is deterministic even if a store returns rows in another order. Malformed, tampered, or foreign cursors fail with `MemoryValidationError` **before** the store is read; a cursor is opaque to hosts but not a secret (a caller who can pass `authorization` can already pick a page size and stop early) — recorded in the source comment so nobody later mistakes it for an integrity token.
    - Stale resume is a real no-op, not just a tolerated one: the window holds only records that still touch `from` (`_rag.sourceId === from` or a lineage edge), so rows an earlier page already moved are skipped rather than consuming the window, a stale cursor returns `movedChunks: 0` with no transaction and no handler pass, and a completed move reports no cursor. Destination collisions still fail closed on whichever page they appear in.
    - Kept plan 089's posture as an opt-in: `maxRecords` no longer bounds a whole scope by default but still means "reject instead of paging" when a host passes it — a partial move stays opt-in rather than the default.
    - `applySourceRenames` (Task 7) walks the page loop per rename (`applyOne`), so a rename above one page still moves completely, each page keeps one ACL check / one transaction / one handler pass, and the audit event carries the rename's totals across pages; the batch result never exposes a `cursor` (`ApplySourceRenamesOptions` omits it — a batch is all pages or an error).
    - Cost: the whole scope is read once per page (`getByThread` — no store exposes a ranged read), while the write, the transaction, and the embedding reuse stay bounded by `pageSize`; the ACL check runs once per call and a resumed call re-validates instead of caching a decision.
    - Tests (`packages/memory/src/__tests__/repoint.test.ts`, +5): 4,097 rows move across two pages with exactly one transaction each and no old ids/duplicates; a stale cursor is a no-op (no transaction, no writes, no handler pass, ids unchanged); foreign/another-thread/malformed cursors and `pageSize: 0` are rejected with the store untouched (write counter on the staged transaction view); handlers run once per page with exactly that page's ids; a destination collision on a later page still fails closed without overwriting the occupant.
    - Checks: `npm test --workspace @arnilo/prism-memory` → **512 tests / 506 pass / 0 fail** (6 named skips, +5); docs + plan + live-doc + package-boundary + install-smoke gates 181 pass; `scripts/budget-gate.test.mjs` 19/19 with no export or non-null change; `scripts/dead-exports.mjs` 0 candidates; `biome lint`/`format` clean; the pgvector leg (`postgres-propagation.integration.test.ts`, pgvector/pgvector:pg16 on 55433) 16/16 with the durable re-point still one transaction.
    - Docs: `docs/rag.md` re-point section now documents one page per call, the loop, cursor semantics (stale no-op, foreign rejection, id ordering), per-page atomicity, and which bound a host hits (`pageSize` by default, `maxRecords` when it opts into all-or-nothing); the chunk-row and PostgreSQL bullets were corrected from "the whole move lands in one transaction" to one transaction per page, and the batch-rename bullet records the per-rename page loop. The primitive review records Task 10 shipped with R21/R22 still rejected and its two paging notes (the read stays whole-scope; the cap is now a page size) as built.

- [x] Task 11: Fabric-note re-point handler
  - Acceptance Criteria:
    - Functional: `createFabricRepointHandler({ scope, vectorStore })` (or a handler that takes the memory note store) rewrites `metadata.path` on `kind: "file"` notes whose path moved, keeps `sourceEntryIds` pointing at the same entries, and leaves non-file notes untouched.
    - Functional: the handler updates note metadata in one transaction when the store supports it and falls back to per-note updates otherwise; it reports counts in the propagator's `layers` result.
    - Functional: notes for a *deleted* path (retire, not move) are tombstoned through the same invalidation path so recall stops returning them (`_lineage`-based walk cannot see them — this handler is the only path, which is why the task exists).
    - Performance: one read of the affected notes per move (by `metadata.path`), no embedding recomputation, no full-store scan when the store supports metadata filtering.
    - Code Quality: built on the existing `RepointHandler` contract, reusing `toNoteMetadata`'s fields rather than introducing a new note schema; no `_lineage` field added to notes (the walk stays for records that have it).
    - Security: the handler only touches notes in the caller's scope and runs under the propagator's privileged ACL path.
  - Approach:
    - Documentation Reviewed:
      - `docs/rag.md` (fabric-note gap recorded in plan 089 Compromises), fabric types (`kind: "file"`, `path`, `sourceEntryIds`).
    - Options Considered:
      - Add `_lineage` metadata to fabric notes so the generic walk finds them — rejected: notes are not derived chunk rows; their link to a path is the path itself.
      - A `.memory` journal reader — rejected: no such file format exists in this repo; notes live in the store.
    - Chosen Approach: a metadata-path handler on the re-point seam, with the same handler used for retire (path deleted → invalidate notes).
    - API Notes and Examples:
      ```ts
      await repointSource({ scope, vectorStore, from: "docs/a.md", to: "docs/b.md",
        handlers: [createFabricRepointHandler({ scope, vectorStore })] });
      ```
    - Files to Create/Edit:
      - `packages/memory/src/fabric/repoint.ts` (new) or `fabric/create.ts` sibling; `packages/memory/src/fabric/index.ts`, `packages/memory/src/index.ts`.
      - `packages/memory/src/fabric/__tests__/` (new suite).
    - References:
      - `packages/memory/src/fabric/create.ts:100` (`toNoteMetadata`), `:117` (metadata fields), `fabric/types.ts:65` (`sourceEntryIds`), `packages/memory/src/repoint.ts` (`RepointHandler`), `packages/memory/src/rag/sources.ts` (delete handler shape).
  - Test Cases to Write:
    - Move: a file note for `docs/a.md` follows to `docs/b.md`; other notes and non-file kinds unchanged.
    - Retire: notes for a deleted path are invalidated and no longer returned by recall.
    - Counts: `layers.fabric` (or equivalent) reports the moved note count; empty move is a no-op.
    - Scope isolation: a note in another scope with the same path is untouched.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new exported handler.
    - Docs pages to create/edit: `docs/rag.md` (re-point handlers list) and `docs/memory-fabric.md` (file notes follow path moves; deleting a path invalidates its notes).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Task 11 Outcome (2026-09-20): shipped as reviewed — one handler object on both seams (`kind: "fabric"`), no `_lineage` on notes, no file-format reader (R23/R24 stay rejected).
    - API (`packages/memory/src/fabric/repoint.ts`, new): `createFabricRepointHandler({ scope, vectorStore, reason? })` returns `RepointHandler & DeletionPropagationHandler` — the structural intersection, so no new exported type or options interface was needed. Registered on `repointSource()` it rewrites `metadata.fabric.path`; registered on `createDeletionPropagator()` it tombstones the notes of the deleted path. Both legs select `kind: "file"` notes whose `path` is the moved/deleted id, read the scope once, and act only on the handler's own scope.
    - Move: id, text, embedding, `sequence`, `sourceEntryIds`, and every other metadata field (host keys included) are reused verbatim — only the `fabric.path` field changes, written back through `encodeMemoryNoteMetadata` + `MEMORY_NOTE_METADATA_KEY` so the stored shape stays the one `toNoteMetadata` produces. Nothing is re-embedded (asserted with a counting embedder), nothing is re-scored, and no note schema is invented.
    - Retire: notes are tombstoned through the store's own invalidation path (`store.invalidate`, batched at `HARD_INVALIDATION_BATCH`) inside one transaction when the store has one, exactly like the propagator's own batch. `forgotten` by default; `legal_hold` (with `hold: true`, which the store also derives from the reason) when the handler is given it. Recall stops serving the notes immediately — no lineage edge was ever walked, so this is the only path that could have reached them.
    - Transaction split: one `store.transaction()` per call when supported, otherwise the same batched write un-wrapped (the propagator's fallback shape). The no-transaction move writes one `upsert` call carrying every selected row rather than one call per note — recorded as a deviation from the plan's wording below.
    - Scope guard: a composition whose re-point/deletion scope differs from the handler's rejects with `MemoryScopeError` before anything is read, so a mis-wired host cannot cross-write threads; the store's ACL check for `from`/`to` (and `sourceId`) still happens on the seam itself, so this leg adds no second privilege decision.
    - Export deviation (recorded): the plan lists `packages/memory/src/index.ts`, but fabric is a **subpath** surface (`@arnilo/prism-memory/fabric`) that the root barrel deliberately does not publish — same finding as Task 2. `createFabricRepointHandler` is exported from `fabric/index.ts`; the root index was left alone. Export count +1 (902 → 903).
    - Tests (`packages/memory/src/fabric/__tests__/repoint.test.ts`, new, 6 cases): a moved file note keeps its id/text/embedding/`sourceEntryIds` and recall serves it under the new path while a sibling file note and a fact note stay untouched; one transaction + one write when the store has a transaction, zero of both on a no-op move, and both legs still move the note on a store without `transaction`; the retire leg tombstones the note and recall stops returning it while another path survives; `legal_hold` reaches the tombstone with `hold: true`; another thread's note with the same path is untouched and a mismatched handler scope is refused. `packages/memory/src/__tests__/host-wiring.test.ts` gained the fabric leg, so the Task 8 recipe now covers all four layers in one `propagate()` call (`layers: { rag, wiki, observational, fabric }`).
    - Checks: `npm test --workspace @arnilo/prism-memory` → **518 tests / 512 pass / 0 fail** (6 named skips, +6); docs + plan + live-doc + package-boundary + install-smoke gates pass; `scripts/budget-gate.test.mjs` 19/19 after the 903 rebaseline; `scripts/dead-exports.mjs` 0 candidates; `biome lint`/`format` clean.
    - Docs: `docs/memory-fabric.md` gained "Following the file (path moves and deletes)" (both seams, the metadata-preserving move, the invalidation-based retire, the one-scope-read cost, the scope guard); `docs/rag.md` gained the handler as a re-point bullet and the fabric leg in the "One wiring, every layer" recipe (its old "fabric needs no leg here" line now states why it is the leg that cannot be omitted); `docs/_evidence/phase102-primitive-review.md` records Task 11 shipped with R23/R24 still rejected and the two deviations above.

## Compromises Made

- **No store-level rename push (Task 7).** `applySourceRenames` takes the caller-supplied `{ from, to }` list as the contract and no `VectorStore` event was added — the same decision the primitive review froze as R12/R15. An event would carry no rename mapping (the host still supplies the pairs), it would need every store to implement it, and no host has yet brought a change source that cannot be polled; the upgrade path, if two hosts need push, is an event that only tells the host *when* to re-read a rename list it already owns.
- **The deletion seam hands handlers no reason (Tasks 2, 11).** `DeletionPropagationHandler.delete(context)` carries ids, scope, and signal — not the propagator's `reason` — so a fabric handler can only tombstone with the reason it was constructed with. A host that passes `legal_hold` to the propagator and not to the handler gets `forgotten` tombstones for the notes (the walk's own entries stay correct). Documented in both docs; the fix is a seam change (add `reason` to the handler context), not a second tombstone plane.
- **Fabric notes are matched by exact path (Task 11).** A directory move needs one `repointSource()` per file; the wiki handler's `pathsFor(sourceId → paths)` is where expansion lives, and the fabric handler has no equivalent because a note's link *is* the one path it names. Likewise the leg reads the whole scope and filters on `metadata.fabric.path` in process — a durable store with a metadata-jsonb index could push that down later.
- **A paged re-point re-reads the whole scope per page (Task 10).** No store in this package exposes a ranged or cursor-based read, so the bound is the write path (transaction, embedding reuse, handler pass) and the read stays O(scope) per page. For a scope that is huge *and* paged this is the cost to revisit: a store-level ranged read (`getByThread` + `afterId`) would cut it, and it is the one place the cursor could become a store contract instead of a host-facing token.
- **Pruned sources are detected from the manifest plus the page's own source list, not by rewriting pages (Task 9).** Pruning still leaves the page body stale (plan 089: rewriting needs the symbol extractor and raw reads for zero content change), so lint reads that stale list instead of fixing it, and a fully pruned entity — deleted by `retireWikiSources` along with its page — is out of scope by construction. Re-filing stays a `wiki-maintainer` action; if a host ever wants pruning to rewrite pages, that is the plan 089 compromise to revisit, not a lint change.
- **No `propagateDeletion` facade (Task 8).** The composition ships as a recipe plus an executing test, not as a runtime-level function: no host has asked, and the propagator's own inputs plus a handler list already are the entry point. The two rejected shapes stay rejected — a method on the memory store (the facade holds no rag/wiki/observational deps) and a second handler registry (the propagator owns registration and privilege). If a host asks, the shape is a function over the propagator inputs returning the same `DeletionPropagationResult`, never a store member.
- **A rename batch is not atomic across pairs (Task 7).** Fail-fast stops at the first failure and pairs already moved stay moved; cross-pair atomicity would need a multi-source move in the store contract. `repointSource` is idempotent per pair, so re-running a failed pair (or a whole batch) after fixing the cause is safe and reports `movedChunks: 0` for what already landed, which is also why a failed rename's audit event carries no counts.
- **Boundary denial events stay coarse (Task 6).** Store-level `no_grant`/`version_mismatch`/`unknown` collapse to the boundary's `no_grant` so the event matches what the boundary itself would have raised; the finer rule stays on the query-level `onDeniedSources` callback instead of widening the event shape.
- **Store-level filtering still does not see source-owned tombstones (Task 5).** The durable `invalidationPredicate` hides rows by record id and lineage edge, not by `_rag.sourceId`; rows owned by a tombstoned source are hidden at the retrieval boundary or physically removed by `createRagDeletionHandler`. Recorded as a finding rather than changed: a metadata expression index for it would cost write throughput for a case the boundary already closes.
- **Reranker recall is measured, not promised (Tasks 3/4).** The corpus is deterministic hash-embedder (lexical) and one machine; the default 20-candidate pool caps recall at ~0.63 regardless of reranker quality, documented rather than raising `queryCandidates` by default, because rerank cost is CPU-bound and the host owns the pool size.
- **The OM drop entry has no `coversUpToId` (Task 2).** A tombstone set is not a coverage position, so the entry records the dropped observation ids only — the fold treats it as a drop, not as progress.

## Further Actions


- **Directory-move expansion for fabric (plan 102 Task 11 upgrade path).** A `pathsFor`-style mapper on the handler would let one host call cover a moved directory of noted files; today the host issues one re-point per path.
- **Store-level ranged read for paged re-point (plan 102 Task 10 upgrade path).** If a host re-points scopes far above the page size, add an optional `afterId`/`limit` read to the store contract and let the page loop use it; today the loop reads the whole scope and filters, which is correct but pays O(scope) per page.
- **`propagateDeletion` facade when the first host asks (plan 102 Task 8).** Shape: `propagateDeletion({ scope, vectorStore, authorization, sourceId, handlers, signal })` → `DeletionPropagationResult` — a propagator construction plus one `propagate()`, so there is still one registry, one privilege check, and one result shape. Take it only with a host that would otherwise re-implement the wiring.
- **Rename push notification, demand-gated (plan 102 Task 7 upgrade path).** If a host brings a rename change source that cannot be polled, add a store/ingest event that *hints* (no mapping) so the host re-reads its own rename list; needs two real hosts before it earns a `VectorStore` contract change.
- **Per-rule denial detail at the boundary (Task 6 follow-up).** If a host needs `version_mismatch`/`unknown` on the boundary `onAccessDenied` event rather than only on the query-level callback, extend `AccessDenial` with an optional reason detail instead of overloading `reason`.
- **Store-level source-owned invalidation (Task 5 follow-up).** A partial index on `metadata->'_rag'->>'sourceId'` would let the durable predicate hide source-owned rows itself; take it only if a host measures boundary filtering as the bottleneck.
- **Reranker sizing on a semantic embedder and non-CPU dtype (Task 4 follow-up).** The 0.21 → 0.79 recall and 119–289 ms latencies are one data point; re-measure with a real embedder, and with fp16/GPU if a host provisions it, before touching the package defaults.
- **Batch renames as one transaction, if a host asks (Task 7 follow-up).** Today a 100-pair batch is 100 transactions; a multi-source move would be a new store contract for atomic batch renames, not a helper change.

- **Gaps G1–G10 in the primitive review are all owned by shipped work.** Every gap row ([`docs/_evidence/phase102-primitive-review.md`](../docs/_evidence/phase102-primitive-review.md)) names the task that owned it (G1→2, G2/G3→3–4, G4→5, G5→6, G6→7, G7→8, G8→9, G9→10, G10→11), and each of those tasks recorded its deltas. Two halves stay deliberately open: G3's *library-owned* default `cacheDir` (the per-host cache directory stays a documented host convention, since a library-chosen home path is a permissions policy decision) and the fabric handler's whole-scope read behind G10.

Two of these items needed no host and are ordered as tasks in [111](111-Deletion-Handler-Reason-Seam-And-Reranker-Embedder-Evidence.md): the propagator's reason reaching deletion handlers (the `legal_hold` → `forgotten` mislabel this list recorded as a compromise) and the reranker's recall/latency evidence on a semantic embedder (Task 4's one-machine, one-embedder caveat). The rest stay here, demand-gated, with the trigger named above; plan 111 Task 1 records the demand evidence per item.
