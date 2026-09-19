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

- [ ] Task 1: Primitive review — reuse seams for propagation, rerank, and grant integration
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

- [ ] Task 2: Observational ledger invalidation drop handler
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
      - `packages/memory/src/compaction/observational-memory/index.ts`, `packages/memory/src/index.ts`: exports.
      - `packages/memory/package.json`: register the new test file in `test`/`test:postgres` if it lands in its own suite.
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

- [ ] Task 3: Local reranker live leg (real transformers.js runtime, named hardware)
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
      - `packages/memory/package.json`: include the new suite in `test` (skip-gated) if the matrix runs per-package, not only via root.
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

- [ ] Task 4: Reranker recall measurement and host defaults
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
      - `packages/memory/src/rag/__tests__/rerank-recall.fixtures.ts` (new, corpus), measurement leg extending Task 3's suite.
      - `docs/rag.md` (measured numbers + defaults), `docs/_evidence/phase102-local-rerank-latency.md` (recall section).
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

- [ ] Task 5: Postgres deletion-propagation leg
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
      - `packages/memory/package.json` (`test:postgres` entry), `scripts/postgres-evidence.mjs` (leg coverage if it enumerates suites).
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

- [ ] Task 6: Store-level denial reporting for ACL-filtering stores
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

- [ ] Task 7: Source-rename driven re-pointing (demand-gated)
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

- [ ] Task 8: Cross-layer host entry point and invalidated-OM wiring (demand-gated)
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

- [ ] Task 9: Wiki pruned-entity surfacing in lint and the maintainer skill
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

- [ ] Task 10: Paged re-point above the single-pass cap
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

- [ ] Task 11: Fabric-note re-point handler
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

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
