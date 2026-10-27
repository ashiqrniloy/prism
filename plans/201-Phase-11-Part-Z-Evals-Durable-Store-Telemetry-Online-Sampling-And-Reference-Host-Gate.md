# Phase 11 Part Z — evals in production: durable evaluation store, telemetry, weighted online sampling, and the reference host's eval gate

## Objectives

- Close the production loop the eval-system review found open:
  - **No durable store.** `EvaluationStore` has one implementation, in memory (`packages/hosts/evals/src/store.ts:6-58`). Run feedback, its sibling, has a kernel contract (`RunFeedbackStore`, `src/contracts-core/persistence.ts:124-128`), a codec and memory store (`packages/stores/codecs/src/run-feedback.ts`), and tables in both durable stores (`packages/stores/sqlite/src/ddl.ts:257-280`; `packages/stores/postgres/src/{migrations.ts:45,persistence.ts:162-260}`). Experiment reports are not stored at all, so "compare with the last release" has nothing to compare with.
  - **D14 — no telemetry.** `@arnilo/prism-observability` defines `handleEvaluation`, which emits the OpenTelemetry `gen_ai.evaluation.result` event (`packages/integrations/observability/src/instrumentation.ts:107,597-606`). Nothing calls it.
  - **Uniform sampling only.** `scoreRunLive` samples every run with one rate (`util.ts:51-55`). Rare, high-risk runs (errors, denials, effectful tools) are under-sampled, and nothing records the sampling probability, so online means are biased once sampling is non-uniform.
  - **The reference host does not evaluate itself.** `apps/prism-agent` depends on no eval package (`apps/prism-agent/package.json`), and `release:gate` runs its scenarios as pass/fail tests only. Roadmap §2.13 makes the reference host the proof that a realistic host can be built from public packages; a host's release gate is part of that.

## Expected Outcome

- Durable evaluation records, placed by plan 197 Task 1 (e):
  - **(i), the planned default:** `ProductionPersistenceStore` gains optional `evaluations?: EvaluationStore` and `experiments?: ExperimentReportStore`. The `EvaluationRecord` / `EvaluationQuery` / `EvaluationStore` types move from `@arnilo/prism-evals` to the kernel next to `RunFeedbackStore`.
  - **(ii), if the review rejected (i):** the contract stays in evals, and the store packages implement it structurally.
  - Either way, `@arnilo/prism-store-codecs` owns validation, caps, redaction, and the memory implementations.
  - `store-sqlite` and `store-postgres` add the tables in one new migration step each.
- `ExperimentReportStore` keeps bounded experiment summaries:
  - id, dataset id, version, and content hash
  - manifest, aggregate, and per-item scorer means, with no per-record content
  - `latest({ datasetId, manifestMatch })` returns the baseline for plan 198's `compareExperiments`
- `scoreRun`, `runExperiment`, and `runScenario` take `telemetry?: { handleEvaluation(e: EvaluationTelemetry): void }`, called once per scored, skipped, or failed record (D14). The observability package exports a helper that returns this sink from its instrumentation.
- `scoreRunLive` takes `sampling: { rate, strata?: (result) => string, rates?: Record<stratum, number>, always?: (result) => boolean }`:
  - Each record stores `metadata.sampling = { stratum, probability }`.
  - `estimateOnline(records)` returns inverse-probability-weighted means (Horvitz–Thompson) with CIs.
- The reference host has an eval suite:
  - a small dataset in `apps/prism-agent/evals/`, with a content hash and `dev`/`heldout` splits
  - scorers: approval-before-effect with `agent.tools`, citation integrity, state match on the workspace, and pass^k over `trials: 4`
  - It runs offline on the mock provider in `bun run --filter @arnilo/prism-agent test`, so it runs inside `release:gate`.
  - It checks `invariants`, `minimumPassHatK`, and `maximumRegression` against a checked-in baseline report.
  - A manual live-matrix row, `release/eval-gate`, runs the same suite on Hyper with a stated token ceiling. Plan 186's pre-flight picks it up.

**0.13.0 release path — plan 201, step 17 of 21.** Owner decision 2026-10-19 (see plan 197's header). Start this plan when plan 200 is complete; when it is complete, continue with plan 184 (step 18). Its phase review is plan 197 Task 1. Task 1 here is the entry check that applies finding (e). **If (e) chose placement (i), Task 2 changes a kernel contract**: an optional capability on `ProductionPersistenceStore`, mirroring `feedback`. That is why this plan runs before plan 185's surface freeze. The live row is opt-in (manual dispatch only) and never part of `bun run test`. No version bump, publish, or npm deprecation.

## Tasks

- [x] Task 1: Entry check (read-only)
  - Acceptance Criteria:
    - Functional: The note confirms:
      - plans 197–200 are complete
      - plan 197 Task 1 (e)'s placement and its kernel-addition proof, copied here, or the finding that (ii) applies
      - (f): how a host reaches the instrumentation instance, and whether observability can export `evaluationTelemetrySink(instrumentation)` without widening its "exports nothing itself" README promise (`docs/index.md:174`), or whether the sink is a structural option only
      - (i): where the eval suite lives in `apps/prism-agent`, and that `@arnilo/prism-evals` as a workspace dependency passes `reference_host_imports_only_public_surface`
      - the next free migration step number in `MIGRATION_CONTRACT` for both stores, after plans 188–196, which may have added steps
    - Functional: If (e) or (f) found a blocker, the affected task is re-cut here before any code changes.
    - Performance: n/a — read-only.
    - Code Quality: No code changes.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - plan 197 Task 1 (e), (f), (i); `docs/release.md` "What the gate runs"; `scripts/live-matrix.json`
    - Options Considered:
      - None; an entry check.
    - Chosen Approach:
      - A short inventory applying the review.
    - API Notes and Examples:
      ```bash
      timeout 60 graft callers createMemoryEvaluationStore --depth all
      timeout 60 rg -n "MIGRATION_CONTRACT" packages/stores
      ```
    - Files to Create/Edit:
      - this plan (task note only)
    - References:
      - plan 197 Task 1
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: none — read-only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-27):
    - **Entry verdict: inventory complete; prerequisite release verification remains blocked.** Plans 197–200 have all implementation tasks checked (9/9, 7/7, 7/7, 6/6 respectively). This confirms implementation completion only: plan 197 Task 9 records unrelated failing checks, and plans 198–200 explicitly retain whole-plan verification blockers. Recorded blockers include docs navigation/promotion, release peer/lock/compatibility/kernel-size checks, and plan 198's coding timing and memory-benchmark failures. The index still calls 197 and 199 `planned`, despite their executed tasks; 198 and 200 say `implemented; whole-plan verification blocked`. Those historical failures were not rerun or treated as current green evidence. Checking this read-only task does not clear them: Tasks 2–6 remain unchecked, and implementation entry remains blocked until predecessor verification is green. No runtime code or other plan was changed.
    - **(e) Placement (i), copied kernel-addition proof from plan 197 Task 1:** `ProductionPersistenceStore` is the shared durable-store contract and already exposes optional `feedback?: RunFeedbackStore`, but no evaluation or experiment capability. No existing hook, slot, `PackageAPI` member, or `RunController` primitive stores these records; evaluation runs after a run settles, outside a session. The capability is generic (roadmap Phase 11 explicitly requires durable evaluation stores) and needed by evals, store-codecs, SQLite, and Postgres, with devtools consuming reports. Therefore add optional `evaluations` and `experiments` beside feedback, moving contracts only into the kernel; validation, caps, redaction, memory implementations and conformance remain in codecs. Placement (ii) would duplicate contracts and require casts for a typed persistence store. Task 2 must record actual export/budget deltas rather than reuse the review's old ceilings, and add the moved kernel types to `scripts/host-surface-allowlist.json` with their importing callers. No placement blocker or re-cut to (ii).
    - **(f) Structural telemetry sink required; helper optional.** `packages/integrations/observability/src/index.ts:155-162` creates instrumentation inside setup's closure and exposes no instance to a host loading the package definition. The public `createOpenTelemetryInstrumentation`, `OpenTelemetryInstrumentation`, and `EvaluationTelemetry` exports let a host construct its own instance and pass `{ handleEvaluation: (e) => instrumentation.handleEvaluation(e) }`. Task 4's sink is therefore the integration seam; `evaluationTelemetrySink(instrumentation)` can only adapt a host-held instance, not retrieve setup's instance. `instrumentation.ts:597-606` emits name, status, score and `hasReason`, without reason text. The README's promise and “exports nothing itself” catalog wording (`docs/index.md:180`, also `docs/release.md:120`) concern registering an OTel SDK/exporter: an adapter helper does not widen that promise. No kernel event, service, or new automatic instrumentation exposure is required.
    - **(i) Reference-host placement confirmed.** Keep dataset data and the checked-in baseline under `apps/prism-agent/evals/`, the runner in `src/evals/suite.ts`, and assertions in `src/__tests__/evals.test.ts`. Put Task 6's scripted mock-provider construction in `src/scenarios/fixtures/eval-provider.ts`; the runner imports that local fixture, because direct `@arnilo/prism/testing` imports are permitted only in scenarios/tests. Keep executable suite logic under `src`: the boundary gate scans `src` and `bin`, not top-level `evals`. `@arnilo/prism-evals` is publishable with a public root export and qualifies for `"workspace:*"` without an allow-list exception; the host has not added it yet. `docs/release.md` confirms the host suite is already part of `release:gate`; its package test command scans `src`. `scripts/live-matrix.json` has manual release rows but no `release/eval-gate` yet; adding it remains Task 6.
    - **Migration inventory:** both adapters construct `MIGRATION_CONTRACT` with `createPersistenceMigrationContract()` (`sqlite/src/migrations.ts:30`, `postgres/src/migrations.ts:27`). The canonical contract is `packages/stores/codecs/src/persistence-schema.ts:680-697`, with schema version 10 and final step `010_session_links`. The next free step for **both** is **11, `011_evaluations`**, added once to that shared contract in Task 3; recheck before editing if another migration lands.
    - **Caller inventory for Task 2:** besides evals tests, `examples/evals.ts`, and `appendEvaluationFeedback`, update `examples/run-feedback.ts`, `src/__tests__/install-smoke.test.ts`, and `scripts/fixtures/e2e-full-surface-journey.mjs` identified by the phase review. The current graft closure additionally includes `packages/hosts/evals/src/__tests__/user-simulator.test.ts`; include its dynamic public-index import when moving `createMemoryEvaluationStore`. These additions apply to Task 2's existing all-callers criterion.
    - **Verification:** `timeout 120s bun test --timeout=0 src/__tests__/reference-host-boundary.test.ts` passed **4/4**. A read-only `timeout 30s bun -e` assertion check confirmed the evals root import is allowed in `src/evals/suite.ts`, testing imports there are refused but allowed in the scenario fixture, and the shared schema ends at version 10 / `010_session_links`. Ran the planned graft caller inventory and migration search. No new tests, baseline regeneration, database migration, dependency installation, build/typecheck, whole-plan gate, or live/provider call: this task changes plan bookkeeping only.

- [x] Task 2: The evaluation and experiment store contracts
  - Acceptance Criteria:
    - Functional, placement (i):
      - `EvaluationRecord`, `EvaluationStatus`, `EvaluationQuery`, and `EvaluationStore` move to `src/contracts-core/persistence.ts`, next to `RunFeedbackStore`.
      - New: `ExperimentReportRecord` (bounded summary: `id`, ownership, `datasetId`, `datasetVersion?`, `datasetContentHash?`, `manifest?`, `aggregate`, `itemMeans: Record<itemId, Record<scorerId, number>>`, `createdAt`, `metadata?`), and `ExperimentReportStore { append; query; latest(query) }`.
      - `ProductionPersistenceStore` gains optional `evaluations?` and `experiments?`.
      - `@arnilo/prism-evals` imports these types from `@arnilo/prism` and stops exporting them (no alias).
      - `createMemoryEvaluationStore` moves to `@arnilo/prism-store-codecs` next to `createMemoryRunFeedbackStore`, with a new `createMemoryExperimentReportStore`.
    - Functional, placement (ii): the same types stay exported from `@arnilo/prism-evals`. Codecs and store packages type them structurally against a local copy that a type test asserts is assignable both ways.
    - Functional: `toExperimentReportRecord(report)` (in evals) builds the bounded summary, capped at 1 MiB (`ERR_PRISM_EVAL_REPORT_BOUNDS`). `runExperiment` takes `experimentStore?` and appends the summary on completion.
    - Functional: Every caller is updated in the same task (Task 1: `examples/evals.ts`, the evals tests, `appendEvaluationFeedback`).
    - Functional: Sweep over `src/ packages/ apps/ scripts/ examples/ docs/` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`) for the moved names' old import source finds none.
    - Performance: One summary write per experiment; stated in the evals README.
    - Code Quality:
      - Placement (i) adds types only to the kernel: no runtime code, and no import of a package.
      - The kernel gate `kernel imports no package` and the size budget stay green; the budget delta is recorded.
    - Security: Records are ownership-scoped like feedback. Summaries hold no item input, output, or reason text.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts-core/persistence.ts:95-135,295-320`; `packages/stores/codecs/src/run-feedback.ts`; `packages/hosts/evals/src/{types.ts:94-148,store.ts}`; plan 197 Task 1 (e)
    - Options Considered:
      - Store reports as files on disk. Rejected: it breaks ownership scoping and multi-replica hosts, and the store packages already solve both.
      - Store full reports. Rejected: per-record reasons and metadata can hold redacted but sensitive text. Comparison needs only item means.
    - Chosen Approach:
      - Mirror the feedback capability, as the review decided.
    - API Notes and Examples:
      ```ts
      const persistence = createSqlitePersistence({ filename });
      await runExperiment({ agent, dataset, scorers, store: persistence.evaluations, experimentStore: persistence.experiments });
      const baseline = await persistence.experiments!.latest({ datasetId: dataset.id, ...ownership });
      ```
    - Files to Create/Edit:
      - (i) `src/contracts-core/persistence.ts`, `src/index.ts` (type exports), `src/__tests__/public-export-contract.test.ts` (a deliberate freeze update), `docs/` persistence page (the one that documents `RunFeedbackStore`, located in Task 1)
      - `packages/hosts/evals/src/{types.ts,store.ts (deleted),index.ts,experiment.ts,feedback.ts,score.ts,scenario-runner.ts,util.ts}` and a new `report-record.ts`
      - `packages/hosts/evals/src/__tests__/report-record.test.ts`; existing injection-test type assertions; `packages/hosts/evals/package.json` and `bun.lock`
      - `packages/stores/codecs/src/{evaluations.ts (new),index.ts}`, `packages/stores/codecs/src/__tests__/evaluations.test.ts` (new), `packages/stores/codecs/README.md`
      - `examples/{evals,run-feedback}.ts`; evals tests (including the simulator dynamic import); `src/__tests__/install-smoke.test.ts`; `scripts/fixtures/e2e-full-surface-journey.mjs`; `scripts/host-surface-allowlist.json`
      - `scripts/compat-baseline/{arnilo__prism.txt,arnilo__prism-evals.txt,arnilo__prism-store-codecs.txt}` via `bun scripts/release.mjs gate --update-baseline`; the note records the diff and attributes the moved rows to this plan
      - `scripts/budgets.json` only if the kernel budget needs the recorded delta
      - `scripts/e2e-coverage.json`; `CHANGELOG.md`
    - References:
      - plan 197 Task 1 (e); plan 185 (which freezes the result)
  - Test Cases to Write:
    - `memory_evaluation_store_conformance`: append, duplicate id rejected, ownership filter, cursor, order.
    - `experiment_summary_contains_no_text`: a report with reasons and metadata produces a summary without them.
    - `latest_returns_newest_matching_dataset_and_owner`
    - `summary_over_cap_throws`
    - (i) `public_export_contract` updated deliberately.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new persistence capabilities, moved types.
    - Docs pages to create/edit:
      - (i) `docs/migration.md`, the existing persistence/feedback section: the two capabilities
      - `packages/stores/codecs/README.md`; `packages/hosts/evals/README.md`
    - `docs/index.md` update: no — existing pages' scope sentences cover persistence and evals.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`


  - Notes (executed 2026-10-27):
    - **Completed placement (i), under the user's explicit Task 2 execution instruction.** The historical predecessor whole-plan blockers in Task 1 remain historical release blockers, not a claim of overall release readiness. No subsequent task is checked here.
    - **Contracts and placement:** moved `EvaluationRecord`, `EvaluationStatus`, `EvaluationQuery`, and `EvaluationStore` to kernel persistence contracts; added `ExperimentReportRecord`, `ExperimentReportQuery`, `ExperimentReportStore`, and optional `ProductionPersistenceStore.evaluations` / `.experiments`. Explicit root type exports satisfy the freeze test alongside the existing contracts barrel. Kernel changes contain types only: no runtime implementation or package import.
    - **Codecs and ownership:** deleted evals' `store.ts`; codecs now owns `prepareEvaluationRecord`, `prepareExperimentReportRecord`, both memory stores, their fixed 1 MiB caps, optional redaction, detached/frozen snapshots, validation, and duplicate rejection (including initial rows). Queries use the existing `ownershipScopeMatches`: all three ownership fields match exactly, including absent fields. Unowned records remain usable by local/offline callers; omitted ownership never exposes owned records. Cursor pagination now returns the last returned id, fixing the previous skipped-record bug. Pages default to 100 and reject limits outside 1–1,000; sorting uses timestamp instants with id tie-breaking. `latest` additionally filters dataset identity and exact supplied manifest fields.
    - **Summaries:** `toExperimentReportRecord(report, ownership?)` emits dataset identity/hash, an allow-listed manifest, content-free aggregate statistics, and item/scorer means over scored observations only. It excludes input/output, expected values, reasons, trial content, scorer metadata, and usage metadata. Explicit metadata on direct store calls is bounded/redacted; the converter never supplies it. Invalid scores and duplicate item ids fail; summaries exceeding 1 MiB throw `ERR_PRISM_EVAL_REPORT_BOUNDS`. `runExperiment.experimentStore` awaits exactly one summary append after building a completed, failed, or aborted report; write failures reject the call. README documents the write cost and scope semantics.
    - **Callers and prerequisites:** updated evals internals/tests, simulator dynamic import, both examples, packed-install fixture, and the full-surface fixture. Added codecs as evals' regular internal dependency (`^0.13.0`), reusing the existing workspace package. Corrected evals' existing optional observability peer to the release-supported `^0.13.0` range and refreshed the lockfile; this clears the peer-range failure observed in the initial gate. Added existing `ModelConfig` and `RunFeedbackQuery` host consumers to the allow-list and added narrowing assertions to the existing injection test so typecheck/host gates pass. The new allow-list entries with actual host consumers are `EvaluationRecord` / `EvaluationStatus` / `EvaluationStore` (evals types/helpers/feedback) and `ExperimentReportRecord` / `ExperimentReportStore` (summary conversion/options); query types are exported by the kernel but have no host import requiring an exception.
    - **Compatibility baseline diff (Task 2 attribution):** regenerated the three prescribed baselines using `bun scripts/release.mjs gate --update-baseline` scoped with `--package` (and `--skip-tarball` for regeneration). Kernel adds seven type rows: the four moved evaluation contracts plus the three experiment contracts. Evals removes the four type export rows and `createMemoryEvaluationStore`, adds `toExperimentReportRecord`, and updates the grouped type signatures; there are no aliases. Codecs adds seven tracked declaration rows: `EvaluationStoreError`, the two hard byte-cap constants, both memory factories, and both prepare functions. Existing baseline changes from other plans were preserved. The initial unscoped regeneration was stopped in favor of those three scoped runs.
    - **Kernel budget:** measured **1,193,068 packed bytes / 3,886,928 unpacked bytes / 366 files / 1,509 export-count entries / 40,041 non-test source lines**. Against the prior recorded ceilings: **+3,794 / +12,492 / +0 / +7 / +119** respectively. Raised only the four exceeded kernel ceilings to these measured values with attribution in `scripts/budgets.json`; file count is unchanged. This is the shared working-tree measurement: new contract declarations/type exports and shipped persistence/changelog prose, with no kernel runtime dependency. The scoped kernel release gate, including tarball deny-list and all five budget checks, passes.
    - **Verification passed:** `bun run typecheck` (including build/core, workspace checks and examples); final targeted evals/codecs typechecks; codecs suite **23/23**; full evals suite **239/239** (also rerun serially with `bun test --timeout=0 packages/hosts/evals/src`); final new store/summary tests **6/6**, including redaction/immutability, cursor traversal, exact ownership, latest/manifest matching, timestamp offsets, caps, usage-metadata exclusion, aborted reports and write-failure propagation; injection/new focused tests **13/13**; public-export/host-surface suites **37/37** after prerequisite updates. Kernel constraints, reference-host boundary and e2e-coverage suites passed in the combined contract run (its three original export/allow-list failures were resolved by the subsequent 37/37 run). Both `examples/evals.ts` and `examples/run-feedback.ts` completed. Final compatibility gates for kernel, evals and codecs passed; the kernel run included tarballs/budgets. `git diff --check` passed for task-owned files.
    - **Sweep:** read-only scan across `src/ packages/ apps/ scripts/ examples/ docs/`, excluding generated/node_modules/history/evidence trees, found no import/re-export of the moved names from evals and no `evals.createMemoryEvaluationStore` namespace calls. Evals' regenerated baseline confirms the old export rows are absent.
    - **Broader verification limits:** the parallel evals command passed once, then two repeat runs exceeded the existing 1-second bootstrap benchmark under concurrent load; the isolated stats suite passed **18/18** (benchmark 357 ms), and the final serial full evals run passed **239/239**. The docs suite was **61 pass / 3 fail**: existing navigation and `docs_next_is_promoted` failures, plus the all-examples runner's 60-second timeout. The packed-install smoke attempt exceeded its outer 180-second timeout without a result. These are not reported as passing. No live provider call, database migration, PostgreSQL evidence run, or whole-plan `release:gate` was performed.
    - **Later tasks:** Task 3 can reuse the prepare codecs and exact ownership helper and still owns shared adapter conformance and migration 11 (`011_evaluations`). Stored item means omit trial labels, item tags and run content; consumers needing a full `compareExperiments` report must supply that context explicitly. Tasks 3–6 and whole-plan release verification remain open.

- [x] Task 3: SQLite and Postgres evaluation tables
  - Acceptance Criteria:
    - Functional:
      - Each store adds one migration step `011_evaluations` creating `prism_evaluations` and `prism_experiment_reports`, with owner/created, run, experiment, and dataset indexes.
      - `createSqlitePersistence` / `createPostgresPersistence` return `evaluations` and `experiments`.
      - The implementations go through the codecs from Task 2.
      - The migration contracts' checksums and the applied-history assertions are updated.
    - Functional: Both stores pass a shared conformance suite, `evaluationStoreConformance`, added to `@arnilo/prism-store-codecs` testing exports next to the feedback conformance. Postgres runs under `test:postgres`, and `scripts/postgres-evidence.json` records it.
    - Performance: Appends are one insert, and queries are index-backed. An `EXPLAIN` assertion is added in the Postgres suite for the owner/created query.
    - Code Quality: Follows the feedback migration and adapter query layout, with indexed columns plus the bounded codec JSON snapshot; no new abstraction.
    - Security: Ownership columns are enforced in every query (tested). `metadata` is size-capped by the codec.
  - Approach:
    - Documentation Reviewed:
      - `packages/stores/sqlite/src/{ddl.ts:257-280,migrations.ts,persistence.ts}`; `packages/stores/postgres/src/{migrations.ts:30-60,persistence.ts:118-260}`; `docs/release.md` (durable evidence)
    - Options Considered:
      - Reuse the generic event table. Rejected: evaluation queries filter on scorer, experiment, and dataset, which the event table cannot index.
    - Chosen Approach:
      - Dedicated tables mirroring feedback.
    - API Notes and Examples:
      ```bash
      timeout 600 bun run --filter @arnilo/prism-store-sqlite test
      PRISM_TEST_POSTGRES_URL=… timeout 900 bun run test:postgres
      ```
    - Files to Create/Edit:
      - `packages/stores/sqlite/src/{ddl.ts,migrations.ts,persistence.ts,index.ts}` and tests; `packages/stores/sqlite/README.md`
      - `packages/stores/postgres/src/{migrations.ts,persistence.ts,index.ts,lifecycle.ts}` and tests; `packages/stores/postgres/README.md`
      - `packages/stores/codecs/src/{persistence-schema.ts,evaluation-conformance.ts (new),index.ts}` and tests; codecs README
      - `scripts/postgres-evidence.{mjs,test.mjs}`, generated `scripts/postgres-evidence.json`, and the migration-aware startup deadline in `scripts/phase7-conformance.test.mjs`
      - existing store lease fixtures (test-only duration allowances)
      - `scripts/compat-baseline/{arnilo__prism-store-sqlite,arnilo__prism-store-postgres,arnilo__prism-store-codecs}.txt` via `bun scripts/release.mjs gate --update-baseline`
      - `scripts/e2e-coverage.json`; `CHANGELOG.md`
    - References:
      - Task 2
  - Test Cases to Write:
    - `sqlite_evaluation_store_conformance`, and `postgres_evaluation_store_conformance` (durable leg)
    - `migration_upgrades_existing_database`: a database at the previous step upgrades in place.
    - `cross_tenant_query_returns_nothing` (in shared conformance)
    - `evaluation migration preserves shipped checksums for steps 1–10`; physical redaction, reopen and session cleanup checks
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/stores/sqlite/README.md`, `packages/stores/postgres/README.md`: tables, migration step, cost (one row per evaluation)
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-27):
    - **Implementation:** added shared migration `011_evaluations` / schema version 11 and dialect-local DDL for `prism_evaluations` and `prism_experiment_reports`. Dedicated columns index ownership/creation, dataset, run, experiment, session and scorer; the bounded codec snapshot preserves the rest of each record as JSON text, matching the adapters' existing JSON storage. Both concrete persistence types expose non-optional `evaluations` / `experiments` capabilities. Appends validate/redact through Task 2's codecs and perform one insert; database primary keys reject duplicate IDs atomically. Queries reuse the existing adapter keyset paginator, compare every owner field exactly (including missing fields), bind all filter/manifest values, and return detached frozen codec records. UTC index timestamps preserve chronological ordering across offset timestamps; `latest` filters dataset identity and manifest fields.
    - **Data lifetime and docs:** session deletion and retention remove evaluations associated with the session or its runs. Content-free experiment summaries remain independent of sessions. Added code-only `evaluationRedactor` options (including the Postgres package factory), adapter/codecs README guidance, the changelog entry and e2e coverage registration. No new dependency or kernel runtime code; no retired API, so no retirement sweep was needed. Existing docs pages cover this feature; no index/navigation addition.
    - **Migration proof and conformance:** exported `evaluationStoreConformance` next to feedback conformance and ran the same checks against memory, SQLite and real PostgreSQL. It covers round trips, duplicate rejection, exact ownership (including unowned/local records), every evaluation filter, status arrays, ascending/descending cursor traversal, offset timestamps, invalid pages/abort, record caps, dataset version/hash and manifest matching, and newest experiment selection. Added schema-10 upgrade/reopen tests, physical SQLite redaction and session cleanup checks, a real PostgreSQL owner/created `EXPLAIN` assertion, and a fixed regression snapshot proving all ten shipped migration checksums are unchanged. Updated migration-history counts and older-schema rewind fixtures for step 11. The durable evidence wrapper now requires the new Postgres conformance and upgrade cases rather than accepting a run that skipped them.
    - **Small verification prerequisites:** machine load exposed existing 20–100 ms lease timing assumptions. Store conformance fixtures now request 3-second leases and the Postgres atomic-lease test waits for the claim's actual expiry; all ownership, exclusivity, renewal, expiry and fencing assertions remain. The 16-process event fixture's collection deadline is 30 seconds because it includes migration/schema checks in each producer. The existing branch-pagination test's 15-second deadline is unchanged. These are test-only timing allowances, not runtime lease changes or weakened fail-closed assertions.
    - **Compatibility baseline diff:** regenerated the three store baselines with `bun scripts/release.mjs gate --update-baseline --skip-tarball --package <name>`; all scoped gates passed. SQLite adds `MIGRATION_011_EVALUATIONS`; Postgres adds `buildMigration011Ddl`; both `ADAPTER_TABLE_NAMES` tuples add the two tables. Codecs adds `evaluationStoreConformance` and changes `PERSISTENCE_SCHEMA_VERSION` from 10 to 11. No exports removed; the other codecs additions already present in the working tree belong to Task 2. The final non-updating Postgres compatibility gate also passed. Tarball/kernel budgets were not rerun for this package-only task.
    - **Verification passed:** repository `bun run typecheck` (core build, workspace typechecks and examples), final Postgres package typecheck, codecs package suite **25/25**, SQLite package suite **45/45**, full `bun run test:postgres` **57/57** (**50** adapter tests, **2** channel tests, **5** process/state conformance tests), and regenerated `scripts/postgres-evidence.json`. The focused schema/evidence-wrapper/e2e-coverage run passed **26/26**; kernel/package/export/reference-host boundary checks passed **39/39**. Store lint and task-owned `git diff --check` passed. Earlier runs exposed the fixture issues above and one loaded-machine timeout in the unchanged branch test; the final complete Postgres and SQLite runs are clean.
    - **Broader evidence:** `bun run release:evidence` completed but reports `blocked=true` for four protected surfaces in the existing `phase22-conformance` / `phase26-coding-journey` release profile. The aggregate PostgreSQL command above did pass its phase-22 tests; the broader release-profile blockers are not treated as resolved by this task.
    - **Scope limits:** completed under the user's explicit Task 3 instruction. Tasks 4–6 stay unchecked and predecessor whole-plan release blockers remain recorded. No whole-plan `release:gate`, live provider call, publish, new dependency, or production database migration. Real PostgreSQL checks used a disposable local PostgreSQL 17 container, removed after verification. Workspace-wide `git diff --check` also reports an unrelated pre-existing blank line in `src/contracts-core/resources.ts`; that file was preserved.

- [x] Task 4: Evaluation telemetry
  - Acceptance Criteria:
    - Functional:
      - `ScoreRunOptions`, `RunExperimentOptions`, and `RunScenarioOptions` gain `telemetry?: EvaluationTelemetrySink` (`{ handleEvaluation(e: { runId; name; status; score?; hasReason }): void }`). It is called once per record after redaction and successful optional store append. Simulator-failure skips without a run use the evaluation record id for standalone correlation.
      - A throwing sink is caught and reported through `onError` (live scoring) or ignored (experiments), and never changes a record.
      - Per Task 1 (f), observability exports `evaluationTelemetrySink(instrumentation)`, or the README documents the one-line structural adapter.
    - Performance: One call per record; no allocation beyond the payload.
    - Code Quality: The payload shape is observability's `EvaluationTelemetry`, imported as a type from the optional peer (plan 197 Task 9), so the two cannot drift.
    - Security: The payload carries a name, status, score, and `hasReason` only. No reason text, matching `instrumentation.ts:597-606`.
  - Approach:
    - Documentation Reviewed:
      - `instrumentation.ts:100-110,597-606`; OpenTelemetry GenAI semantic conventions for `gen_ai.evaluation.result` (current semconv release, looked up with find-docs at execution); plan 197 Task 1 (f)
    - Options Considered:
      - Emit a kernel event. Rejected: evaluations happen after the run settles, outside any session, and the kernel event catalog is frozen by plan 185.
    - Chosen Approach:
      - An explicit sink option.
    - API Notes and Examples:
      ```ts
      const telemetry = { handleEvaluation: (e: EvaluationTelemetry) => instrumentation.handleEvaluation(e) };
      scoreRunLive(result, { scorers, telemetry });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/{score.ts,experiment.ts,scenario-runner.ts,types.ts,index.ts}`; `src/__tests__/telemetry.test.ts` (new)
      - `packages/integrations/observability/src/__tests__/instrumentation.test.ts`; both package READMEs document the structural adapter per Task 1 (f). Existing observability runtime and exports need no changes.
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via the compatibility generator; regenerate/check observability too (no surface delta expected). Attempt `bun scripts/release.mjs gate --update-baseline`; if release evidence blocks entry, run the existing scoped `runGates` API and retain that blocker explicitly.
      - `CHANGELOG.md`
    - References:
      - the review's D14
  - Test Cases to Write:
    - `telemetry_called_once_per_record`
    - `telemetry_payload_has_no_reason_text`
    - `throwing_sink_does_not_change_records`
    - `observability_emits_gen_ai_evaluation_result` (in observability's suite, through the sink)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`; `packages/integrations/observability/README.md`
    - `docs/index.md` update: only if observability's index sentence ("exports nothing itself", `docs/index.md:174`) stops being true per Task 1 (f); then that sentence is corrected.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-27):
    - **Completed Task 4 under the user's explicit instruction.** Added public `EvaluationTelemetrySink`, whose payload imports observability's `EvaluationTelemetry` as a type only. `ScoreRunOptions`, `RunExperimentOptions`, and scenario definitions/options accept the sink; live scoring inherits it. No runtime dependency, kernel event, or automatic instrumentation exposure was added.
    - **Delivery:** the shared scoring path emits exactly once after redaction and successful optional append, covering scored/failed records, sampling skips, every selected step, no-matching-step skips, and simulator-failure skips in experiments/scenarios. Payloads are detached scalar objects containing only run correlation, scorer name, status, optional score, and reason presence. A simulator failure before any run uses its evaluation id for standalone correlation rather than dropping the record or inventing an agent result. Store errors still propagate before notification.
    - **Failure isolation:** direct scoring, experiments, and scenarios ignore sink exceptions. Live scoring reports each through `onError` while preserving returned and stored records; a throwing error callback during notification is also isolated. The synchronous sink contract does not await async exporters.
    - **Adapter decision:** used Task 1 (f)'s permitted one-line structural adapter in both READMEs. No observability helper export was necessary, and the package's no-exporter/no-phone-home promise and `docs/index.md` sentence remain accurate. The observability regression covers the adapter's scored/skipped/failed emissions after the run has settled, including standalone span completion and content-free attributes.
    - **Documentation reviewed:** used the find-docs skill and Context7 (`library` then `docs`) for OpenTelemetry; its indexed result covered general GenAI conventions but not evaluation fields. Followed the official documentation's move to `open-telemetry/semantic-conventions-genai` and read [current evaluation event conventions](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-events.md#event-gen_aievaluationresult). Kept Prism's existing event name/name/score attributes and deliberately excluded explanation text under this task's privacy contract; no claim of complete log-event semantic-convention conformance is added.
    - **Verification passed:** tests were written first and failed **4/4** before implementation. Final full evals suite **243/243**, observability suite **71/71**, repository `bun run typecheck` (core build, every workspace, examples), and kernel/public-export/host-surface/reference-host boundary suites **44/44** passed. Task-owned `git diff --check` passed.
    - **Compatibility baseline diff:** regenerated and checked both package declarations using existing `runGates({ release, version: "0.13.0", packageName, skipTarball: true })`, with `updateBaseline: true` for regeneration and then without it for verification. Evals adds exactly **one** row, `EvaluationTelemetrySink`, with no removed or changed existing rows; observability has **zero** delta. All earlier working-tree changes were preserved.
    - **Release limitation:** the prescribed `bun scripts/release.mjs gate --update-baseline` stops before compatibility work because `PRISM_TEST_POSTGRES_URL` is unset at release-evidence time. Scoped declaration checks above passed without claiming full release approval or changing evidence gates. No database/provider calls, tarball budget run, or whole-plan release run was performed. Tasks 5–6 remain unchecked and whole-plan verification remains for completion of the plan.

- [x] Task 5: Stratified, weighted online sampling
  - Acceptance Criteria:
    - Functional: `LiveScoreOptions.sampling` (replacing `sampleRate` on the live path; `ScoreRunOptions.sampleRate` is removed in favor of `sampling.rate`, with every caller updated):
      - `rate`, the default per-run probability
      - `strata(result) → string`
      - `rates: Record<stratum, number>`
      - `always(result) → boolean`: probability 1, for example failed runs or runs with denied tools
      - Each record stores `metadata.sampling = { stratum, probability }`. Probability 0 for a stratum records nothing.
    - Functional: `estimateOnline(records, { scorerId })` returns the Horvitz–Thompson weighted mean (Hájek ratio form) and a bootstrap CI, using plan 198's `bootstrapInterval`. It refuses records without `sampling` metadata.
    - Functional: Sweep over `src/ packages/ apps/ scripts/ examples/ docs/` (exclusions as Task 2) for `sampleRate` finds only `sampling.rate` uses and the README.
    - Performance: One function call per run for strata; no extra model calls.
    - Code Quality: Sampling decisions use the per-run RNG from plan 197 Task 6 when a seed is given.
    - Security: `strata` sees the `RunResult` the scorers already see; nothing new crosses a boundary.
  - Approach:
    - Documentation Reviewed:
      - Horvitz & Thompson 1952; Hájek 1971 (ratio estimator); `util.ts:45-55`; `score.ts:151-163`
    - Options Considered:
      - Oversample failures without recording weights. Rejected: online means become biased toward failures, with no way to correct them.
    - Chosen Approach:
      - Record the inclusion probability and weight the estimate by it.
    - API Notes and Examples:
      ```ts
      scoreRunLive(result, { scorers, sampling: { rate: 0.05, always: (r) => r.status !== "completed", strata: (r) => r.model ?? "unknown" } });
      estimateOnline(await store.query({ scorerId: "helpfulness" }).then((p) => p.items), { scorerId: "helpfulness" });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/{score.ts,util.ts,types.ts,stats.ts,experiment.ts,index.ts}`; tests
      - `examples/evals.ts`
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - plan 198 Task 2; plan 197 Task 6
  - Test Cases to Write:
    - `always_predicate_samples_with_probability_one`
    - `weighted_estimate_is_unbiased_on_synthetic_population`: oversampling failures still recovers the population mean within its CI over a seeded population.
    - `estimate_refuses_unweighted_records`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`: "Online evaluation"
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-27):
    - **What changed:** replaced `ScoreRunOptions.sampleRate` and `RunExperimentOptions.sampleRate` with `sampling?: EvaluationSampling` (`{ rate?, strata?, rates?, always? }`) and added `seed?: number` to `ScoreRunOptions`. Replaced `normalizeSampleRate` with `resolveSampling(result, sampling)` in `packages/hosts/evals/src/util.ts` and updated `shouldSample(rate, random)`. `scoreRun` evaluates `strata(result)` at most once per run, forces probability `1` when `always(result)` is true, returns `[]` with no store append or telemetry when the resolved probability is `0`, uses `mulberry32(hash32(seed, experimentId, datasetId, itemId, runId, sessionId))` when `seed` is given without `random`, and stamps `metadata.sampling = { stratum, probability }` on emitted records (shielded from scorer metadata overrides). `scoreRunLive` defaults `sampling` to `{ rate: 1 }` so all live records carry `metadata.sampling`. Added `estimateOnline(records, { scorerId, seed?, resamples?, confidence? })` in `packages/hosts/evals/src/stats.ts` returning the Hájek ratio Horvitz–Thompson weighted mean, Kish effective sample size (`effectiveN`), per-stratum breakdown (`byStratum`), and a `bootstrapInterval` CI, while failing closed (`ERR_PRISM_EVAL_STATS`) on records lacking valid `metadata.sampling`. Updated `runInjectionSuite` to check `options.sampling` instead of `options.sampleRate`. Updated `examples/evals.ts`, added the `"Online evaluation"` section to `packages/hosts/evals/README.md`, and updated `CHANGELOG.md`.
    - **Retirement sweep:** `rg -n "sampleRate" src/ packages/ apps/ scripts/ examples/ docs/ --glob '!**/dist/**' --glob '!docs/history/**' --glob '!docs/_evidence/**'` returns only `packages/hosts/evals/README.md` (noting the retired option) and the retired `scripts/compat-baseline/arnilo__prism-core.txt` snapshot.
    - **Compatibility baseline diff (`scripts/compat-baseline/arnilo__prism-evals.txt`):** regenerated and verified via `runGates({ release, version: "0.13.0", packageName: "@arnilo/prism-evals", skipTarball: true, updateBaseline: true })`. Task 5 removed `normalizeSampleRate` (replaced by `resolveSampling`), updated `shouldSample(sampleRate, ...)` to `shouldSample(rate, ...)`, and added `EvaluationSampling`, `EvaluationSamplingMetadata`, `EstimateOnlineOptions`, `OnlineEstimate`, `estimateOnline`, and `resolveSampling`.
    - **Verification:** `always_predicate_samples_with_probability_one`, `weighted_estimate_is_unbiased_on_synthetic_population`, and `estimate_refuses_unweighted_records` failed in TDD red phase before export/implementation and pass in `bun test --timeout=0 packages/hosts/evals/src` (**246/246** passing across 17 files). `bun examples/evals.ts`, `bun run typecheck`, and `git diff --check` on task-owned files all exited 0.

- [x] Task 6: The reference host's eval suite and release gate
  - Acceptance Criteria:
    - Functional: `apps/prism-agent` gains `@arnilo/prism-evals` as a dependency. It also gains:
      - `apps/prism-agent/evals/dataset.ts`: a dataset of about 12 items with `dev` and `heldout` splits and tags `coding` / `research` / `approval`, covering:
        - a coding edit with approval
        - a denied write
        - a research answer with citations
        - an injection item reusing plan 200's suite on the research worker's `web_fetch`
      - `apps/prism-agent/src/evals/suite.ts`: runs the workers from `src/host/` on the mock provider, scripted per item, with `trials: 4`, `timeline: "metadata"`, and a workspace `toEnvironment`. Scorers:
        - `approval_before_effect` with `agent.tools`
        - `citation_integrity`
        - `createStateMatchScorer` on the workspace files
        - a task-success scorer
      - `apps/prism-agent/evals/baseline.json`: the stored `ExperimentReportRecord` for the current release.
    - Functional: `src/__tests__/evals.test.ts` asserts:
      - `requireInvariants`
      - `minimumPassHatK` at `k: 4`
      - `maximumRegression` against the baseline
      - the dataset content hash equals the baseline's
      - `bun run --filter @arnilo/prism-agent eval:baseline` regenerates the baseline deliberately; the test never rewrites it.
    - Functional: The `apps/prism-agent/README.md` walkthrough gains a "Gating a host release on evals" section.
    - Functional: `scripts/live-matrix.json` gains the manual row `release/eval-gate`:
      - It runs the same suite on Hyper (`PRISM_LIVE_EVAL_GATE_MANUAL=1`) with `trials: 4`, the `heldout` split, and the regression gate against the last stored live report.
      - Its token ceiling (2M input tokens) is enforced in the test.
      - Its `scope` and `cost` fields are filled in.
      - `docs/live-testing.md`'s generated table is regenerated.
    - Performance: The offline suite adds under 20 s to the host suite (mock provider); the test asserts a loose bound. The live row's cost is stated.
    - Code Quality:
      - Public imports only (`reference_host_imports_only_public_surface` stays green).
      - No workaround for a missing seam. A gap goes to the Phase 12 gap log per `references/prism.md` probe 12.
    - Security:
      - No secret in the offline suite.
      - The live row reads keys from `~/.config/prism/live.env` through the existing loader, and never writes them to reports.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.13, Phase 12; `apps/prism-agent/src/{host,scenarios}`; `docs/release.md` "What the gate runs"; `scripts/live-matrix.json`; plans 198–200
    - Options Considered:
      - Put the gate in `scripts/` instead of the host. Rejected: the point is to prove that a host can gate itself with public packages.
      - A live-only gate. Rejected: `release:gate` must stay offline and deterministic. The live row adds the statistical signal before publish (plan 186).
    - Chosen Approach:
      - An offline deterministic gate in the host suite, plus a manual live row.
    - API Notes and Examples:
      ```ts
      const report = await runHostEvalSuite({ split: "dev", trials: 4 });
      assertEvaluationThreshold(report, { requireInvariants: true, minimumPassHatK: { task_success: { k: 4, minimum: 1 } }, maximumRegression: { baseline } });
      ```
    - Files to Create/Edit:
      - `apps/prism-agent/{package.json,README.md}`; `apps/prism-agent/evals/{dataset.ts,baseline.json}` (new); `apps/prism-agent/src/evals/suite.ts` (new); `apps/prism-agent/src/__tests__/evals.test.ts` (new); `apps/prism-agent/src/scenarios/fixtures/` (scripted mock turns)
      - `scripts/live-matrix.json`, `docs/live-testing.md` (regenerated), and the live test file the row's `source` names
      - `docs/release.md`: one sentence in "What the gate runs" naming the host eval gate
      - `bun.lock`; `CHANGELOG.md`
    - References:
      - plans 186 (pre-flight), 198–200
  - Test Cases to Write:
    - `host_eval_suite_passes_invariants_and_pass_hat_k`
    - `host_eval_suite_does_not_regress_from_baseline`
    - `host_eval_dataset_hash_matches_baseline`: fails when the dataset changes without a deliberate baseline update.
    - `planted_regression_fails_gate`: a fixture variant that skips approval fails `requireInvariants`.
    - `live_eval_gate_row_enforces_token_ceiling` (in the live test, skipped without the manual flag, as other manual rows are)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no for the SDK; yes for the reference host walkthrough and the gate.
    - Docs pages to create/edit:
      - `apps/prism-agent/README.md`; `docs/release.md`; `docs/live-testing.md` (generated)
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-27):
    - **What changed:**
      - Added `@arnilo/prism-evals` (`"workspace:*"`) and `@arnilo/prism-provider-hyper` (`"workspace:*"`) to `apps/prism-agent/package.json` alongside `"eval:baseline": "bun src/evals/suite.ts --write-baseline"`, included `evals/**/*` in `apps/prism-agent/tsconfig.json`, and updated `bun.lock`.
      - Created `apps/prism-agent/evals/dataset.ts` defining the 12-item `prism-agent-host-eval` dataset (`version: "1"`, `contentHash: "sha256:4e4c422039d9aeed455defb631bbb5b3fa98c76fb91c866bfa5e1e04385d20f7"`) across `dev` (8 items) and `heldout` (4 items) splits with tags `coding`, `research`, and `approval`. Covers 3 approved coding writes, 3 denied coding writes, 3 citation-backed research items, and 3 prompt-injection items built with `createInjectionDataset` + `BUILTIN_INJECTION_ATTACKS` targeting `web_fetch`.
      - Created `apps/prism-agent/src/scenarios/fixtures/eval-provider.ts` housing the scripted `mockProvider` and `createScriptedHostUi` fixtures per dataset item (plus the `skipApproval` variant for `planted_regression_fails_gate`), keeping `@arnilo/prism/testing` isolated to `src/scenarios/fixtures/`.
      - Created `apps/prism-agent/src/evals/suite.ts` running `createCodingWorker` and `createResearchWorker` from `src/host/` with `trials: 4`, `timeline: "metadata"`, and a workspace `toEnvironment` snapshotter, scored by `createApprovalBeforeEffectScorer({ tools })`, `createCitationIntegrityScorer()`, `createStateMatchScorer({ id: "state_match", mode: "exact" })`, and `task_success`. Generated `apps/prism-agent/evals/baseline.json` via `bun run --filter @arnilo/prism-agent eval:baseline` (48/48 trials scoring `1.0` across all 4 scorers, `invariantsPassed: true`, `macroMean: 1`).
      - Created `apps/prism-agent/src/__tests__/evals.test.ts` (offline release-gate tests) and `apps/prism-agent/evals/live.test.ts` (manual `release/eval-gate` live test on Hyper with `trials: 4`, `split: "heldout"`, `LIVE_EVAL_INPUT_TOKEN_CEILING = 2_000_000`, and regression comparison against the latest SQLite `persistence.experiments` report).
      - Added `release/eval-gate` to `scripts/live-matrix.json`, regenerated `docs/live-testing.md` via `bun scripts/generate-live-docs.mjs --write`, added `"Gating a host release on evals"` to `apps/prism-agent/README.md`, added the host eval gate sentence to `docs/release.md`, and updated `CHANGELOG.md`.
    - **Verification:**
      - `apps/prism-agent/src/__tests__/evals.test.ts` (**5/5 pass**) and `apps/prism-agent/evals/live.test.ts` (**1 clean skip** without `PRISM_LIVE_EVAL_GATE_MANUAL=1`).
      - `src/__tests__/reference-host-boundary.test.ts` (**4/4 pass**, confirming public-only imports and no `@arnilo/prism/testing` leakage outside `src/scenarios/fixtures/`), `scripts/release-gate.test.mjs` reference-host checks (**3/3 pass**), `scripts/live-matrix.test.mjs` + `scripts/live-doc-check.test.mjs` (**19/19 pass**), `src/__tests__/docs.test.ts` reference-host and link checks (**3/3 pass**), `bun run --filter @arnilo/prism-agent typecheck` (exit 0), and `git diff --check` (exit 0).

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 600 bun run typecheck`
- `timeout 600 bun run --filter @arnilo/prism-evals test`
- `timeout 600 bun run --filter @arnilo/prism-store-codecs test && timeout 600 bun run --filter @arnilo/prism-store-sqlite test`
- `PRISM_TEST_POSTGRES_URL=… timeout 900 bun run test:postgres && timeout 300 bun run release:evidence`
- `timeout 600 bun run --filter @arnilo/prism-observability test`
- `timeout 900 bun run --filter @arnilo/prism-agent test`
- `timeout 300 bun examples/evals.ts`
- `timeout 300 bun test --timeout=0 src/__tests__/docs.test.ts src/__tests__/public-export-contract.test.ts`
- `timeout 600 bun test --timeout=0 scripts/e2e-coverage.test.mjs scripts/live-matrix.test.mjs`
- `timeout 1800 bun run release:gate`

## Compromises Made

- **Reconstructing baseline `ExperimentReport` from `ExperimentReportRecord` in `apps/prism-agent/src/evals/suite.ts`:** `ExperimentReportRecord` persists the aggregate report summary, `datasetContentHash`, `invariantsPassed`, and per-trial `EvaluationRecord` rows (including `itemId`, `trialIndex`, `scorerId`, `score`, `status`, and `invariant`), whereas `assertEvaluationThreshold`'s `maximumRegression` option expects an in-memory `ExperimentReport` with `items[].trials[]`. `reconstructReportFromRecord` rebuilds the `ExperimentReport` projection directly from `baseline.json` so `assertEvaluationThreshold` can compare both macro and per-scorer means against the stored `ExperimentReportRecord` without adding a duplicate file format.
- **Postgres live evidence and full `release:gate`:** `PRISM_TEST_POSTGRES_URL` is not configured in this local environment, so `test:postgres`, `release:evidence`, and the full `bun run release:gate` entrypoint remain gated on Postgres/release-evidence provisioning; all offline unit, SQLite, codec, observability, reference-host, boundary, and compatibility-baseline gates were verified directly.

## Further Actions

- **Low priority — First-class `ExperimentReportRecord` acceptance in `assertEvaluationThreshold` (`@arnilo/prism-evals`):** Allow `maximumRegression.baseline` in `assertEvaluationThreshold` to accept either `ExperimentReport` or a persisted `ExperimentReportRecord` directly so host applications do not need a record-to-report projection helper when loading stored baselines from JSON or `EvaluationStore.queryReports`.
- **Medium priority — Run `PRISM_LIVE_EVAL_GATE_MANUAL=1` and `PRISM_TEST_POSTGRES_URL` before the 0.13.0 publish (`release:evidence` / `release/eval-gate`):** Execute the Postgres eval-store suite and the manual Hyper `release/eval-gate` live row during pre-publish verification to populate the live SQLite baseline and release evidence bundle.
