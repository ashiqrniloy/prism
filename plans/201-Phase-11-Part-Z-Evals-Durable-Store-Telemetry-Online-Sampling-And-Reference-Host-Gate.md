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

- [ ] Task 1: Entry check (read-only)
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

- [ ] Task 2: The evaluation and experiment store contracts
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
      - `packages/hosts/evals/src/{types.ts,store.ts (deleted or moved),index.ts,experiment.ts,feedback.ts}` and a new `report-record.ts`
      - `packages/stores/codecs/src/{evaluations.ts (new),index.ts}`, `packages/stores/codecs/src/__tests__/evaluations.test.ts` (new), `packages/stores/codecs/README.md`
      - `examples/evals.ts`; evals tests
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
      - (i) the kernel persistence page in `docs/`: the two capabilities
      - `packages/stores/codecs/README.md`; `packages/hosts/evals/README.md`
    - `docs/index.md` update: no — existing pages' scope sentences cover persistence and evals.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: SQLite and Postgres evaluation tables
  - Acceptance Criteria:
    - Functional:
      - Each store adds one migration step `0NN_evaluations` (the number from Task 1) creating `prism_evaluations` and `prism_experiment_reports`, with owner/created, run, experiment, and dataset indexes.
      - `createSqlitePersistence` / `createPostgresPersistence` return `evaluations` and `experiments`.
      - The implementations go through the codecs from Task 2.
      - The migration contracts' checksums and the applied-history assertions are updated.
    - Functional: Both stores pass a shared conformance suite, `evaluationStoreConformance`, added to `@arnilo/prism-store-codecs` testing exports next to the feedback conformance. Postgres runs under `test:postgres`, and `scripts/postgres-evidence.json` records it.
    - Performance: Appends are one insert, and queries are index-backed. An `EXPLAIN` assertion is added in the Postgres suite for the owner/created query.
    - Code Quality: Follows the `prism_run_feedback` table and code layout exactly; no new abstraction.
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
      - the shared migration contract in `packages/stores/codecs/src/` (located in Task 1)
      - `scripts/compat-baseline/{arnilo__prism-store-sqlite,arnilo__prism-store-postgres,arnilo__prism-store-codecs}.txt` via `bun scripts/release.mjs gate --update-baseline`
      - `scripts/e2e-coverage.json`; `CHANGELOG.md`
    - References:
      - Task 2
  - Test Cases to Write:
    - `sqlite_evaluation_store_conformance`, and `postgres_evaluation_store_conformance` (durable leg)
    - `migration_upgrades_existing_database`: a database at the previous step upgrades in place.
    - `cross_tenant_query_returns_nothing`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/stores/sqlite/README.md`, `packages/stores/postgres/README.md`: tables, migration step, cost (one row per evaluation)
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Evaluation telemetry
  - Acceptance Criteria:
    - Functional:
      - `ScoreRunOptions`, `RunExperimentOptions`, and `RunScenarioOptions` gain `telemetry?: EvaluationTelemetrySink` (`{ handleEvaluation(e: { runId; name; status; score?; hasReason }): void }`). It is called once per record after redaction.
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
      scoreRunLive(result, { scorers, telemetry: evaluationTelemetrySink(instrumentation) });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/{score.ts,experiment.ts,scenario-runner.ts,types.ts}`; tests
      - `packages/integrations/observability/src/{instrumentation.ts,index.ts}` and tests, per Task 1 (f); `packages/integrations/observability/README.md`
      - `scripts/compat-baseline/{arnilo__prism-evals,arnilo__prism-observability}.txt` via `bun scripts/release.mjs gate --update-baseline`
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

- [ ] Task 5: Stratified, weighted online sampling
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

- [ ] Task 6: The reference host's eval suite and release gate
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

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
