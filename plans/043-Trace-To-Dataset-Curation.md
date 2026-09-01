# 043 — Trace-to-Dataset Curation: `datasetFromRuns`

Adoption-list item #4 (LangSmith loop: "a failure you saw once becomes a test").
Roadmap phase: **0.3.x**.
Baseline: `@arnilo/prism-evals` **0.3.0**.
Target: extend `@arnilo/prism-evals` with a curation helper that turns live run/session records into immutable dataset items in one call — closing production-incident → regression-test without hand-copying transcripts.

## Objectives

- Add `datasetFromRuns`: pull redacted input/output (and optional expected output) for given run or session ids through the existing `createPersistenceTraceResolver`, and append them as items to a dataset (new immutable version — datasets are already immutable, so curation is append-as-new-version).
- Redact before persist: every extracted item passes the host `redactor` / field policy — dataset items never carry secrets.
- Keep it ~one module over existing seams; no new store, no schema change.

## Expected Outcome

- Hosts call `datasetFromRuns({ runIds, dataset, store, redactor, ownership })` and get a new dataset version containing graded-able items (`input`, optional `expected` from recorded feedback or host mapping, stable unique ids).
- A production incident transcript becomes a `runExperiment` input in ≤ 5 lines of host code.
- No behavior change to existing evals APIs.

## Tasks

- [x] Task 1 — Curation Helper Over Existing Seams
  - Acceptance Criteria:
    - Functional: `datasetFromRuns` accepts run ids and/or session ids; resolves inputs/outputs via `createPersistenceTraceResolver` (exact session/run/ownership, existing page/byte bounds); maps each run to one item via a host-supplied `toItem` (default: input + output as expected); appends as a **new dataset version** (existing immutability honored — old version untouched); returns `{ dataset, version, added, skipped }` with skip reasons (missing run, ownership mismatch, empty output).
    - Performance: bounded by existing trace-resolver page/byte caps; concurrency capped by existing limits; 50-run curation within the evals performance envelope.
    - Code Quality: one new module `packages/evals/src/curate.ts` + types; no changes to `dataset.ts`/`experiment.ts`; pure function over injected resolver (testable with fakes).
    - Security: host `redactor` applied to every field before item construction (fail-closed: unredactable item → skip with reason, never store raw); ownership filter passed through to the resolver (cross-tenant runs are never readable); item byte caps enforced (frozen limit, `ERR_PRISM_EVAL_CURATE` on oversized).
  - Approach:
    - Documentation Reviewed:
      - `packages/evals/src/trace.ts` (`createPersistenceTraceResolver`), `packages/evals/src/dataset.ts` (immutable `defineDataset`, version semantics), `packages/evals/src/limits.ts`, `docs/evaluations.md`, `src/redaction.ts` / `src/field-policy.ts` (redaction seams).
    - Options Considered:
      - New "dataset curation" package: rejected — single helper, wrong to split from evals.
      - Raw transcript copy without redaction seam: rejected — violates every Prism persistence redaction boundary.
      - Helper in `@arnilo/prism-evals` reusing trace resolver + redactor: chosen — both seams already exist and are conformance-tested.
    - Chosen Approach:
      - Thin composition: resolve → redact → map (host `toItem`, safe default) → append new dataset version.
    - API Notes and Examples:
      ```ts
      import { datasetFromRuns, defineDataset } from "@arnilo/prism-evals";
      const result = await datasetFromRuns({
        runIds: ["run_9f2", "run_a71"],
        dataset: defineDataset({ id: "support-regressions", items: [] }),
        store, ownership, redactor,
        toItem: (run) => ({ input: run.input, expected: run.feedback?.expected }),
      });
      // → { dataset, version: 2, added: 2, skipped: [] }
      ```
    - Files to Create/Edit:
      - `packages/evals/src/curate.ts` (new), `packages/evals/src/index.ts` (export), `packages/evals/src/__tests__/curate.test.ts` (new).
  - Test Cases to Write:
    - Happy path: two runs (fake persistence store) → new dataset version, items carry redacted input/output, stable order by run id.
    - Redaction: secret-shaped value in output → redacted before storage; raw secret absent from stored dataset (assert).
    - Skip matrix: unknown run id, foreign ownership, empty output → skipped with reason; dataset version still created for the rest.
    - Immutability: prior dataset version items unchanged after append.
    - Bounds: oversized item → fail-closed error, partial nothing persisted (atomic append).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new exported function in `@arnilo/prism-evals`.
    - Docs pages to create/edit: `docs/evaluations.md` — new "Curating datasets from production runs" section with the API table row for `datasetFromRuns`.
    - `docs/index.md` update: yes — Evaluations entry description extended with trace→dataset curation.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2 — Feedback-to-Expected Mapping and Docs
  - Acceptance Criteria:
    - Functional: default `toItem` uses recorded `RunFeedbackRecord` fields as `expected` when present (feedback store linkage already id-only — honor that); document that human-graded expected values come from the feedback seam, never re-derived from untrusted outputs.
    - Performance: one bounded feedback query per run batch (existing feedback store caps).
    - Code Quality: default mapping documented and typed; host override always wins.
    - Security: expected values pass the same redactor; feedback linkage stays id-based (no new data flows).
  - Approach:
    - Documentation Reviewed: `packages/evals/src/feedback.ts` (`appendEvaluationFeedback`, feedback records), `docs/runs-and-usage.md` (immutable run/trace feedback).
    - Options Considered: LLM-generated expected outputs at curation time — rejected (nondeterministic, costs a call, untrusted-output contamination); hosts may add their own via `toItem`.
    - Chosen Approach: feedback-seam default, host override.
    - API Notes and Examples:
      ```ts
      // default: expected = run.feedback?.expected (if present)
      ```
    - Files to Create/Edit: `packages/evals/src/curate.ts` (default mapping), `docs/evaluations.md`.
  - Test Cases to Write:
    - Feedback-present run → item carries expected; feedback-absent → expected omitted (not fabricated).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (default behavior of Task 1 function).
    - Docs pages to create/edit: `docs/evaluations.md` curation section complete.
    - `docs/index.md` update: no (Task 1 covered).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- Default `toItem` mapping (post-Task 2): `input` = first user message from the trace, `expected` = `metadata.expected` of the latest human-graded `RunFeedbackRecord` when present, recorded output preserved as `metadata.output`. `RunFeedbackRecord` has no dedicated `expected` column, so the human-graded gold value rides feedback `metadata` (bounded and store-redacted by the feedback seam itself); outputs are never re-derived into `expected` (feedback-absent → item omits `expected`).
- Feedback costs one owner-scoped, store-bounded `query({ order: "desc" })` per curation batch; the newest record wins per run. ponytail: single feedback page — feedback beyond the first page is ignored, which only omits `expected` (`ERR_PRISM_RUN_FEEDBACK_BOUNDS` caps pages at 500); hosts needing more should curate via `sessionIds`/feedback-scoped `toItem`.
- A failed feedback query (e.g. tenant-only curation scope vs. the feedback store's tenant+account/user contract) omits `expected` rather than aborting the batch — feedback is optional enrichment and its absence never fabricates data.
- Bare `runIds` (no session) are located by one ownership-bounded scan of the run ledger (`queryRuns` paginated under the resolver's page/byte caps) because `RunQuery` has no run-id filter; a run not found within the page cap skips as `missing run`.
- `pages`/`limit` helpers in `trace.ts` were exported for reuse instead of duplicated; item redaction runs a second pass after host `toItem` so host-supplied `expected` values also pass the redaction boundary (fail-closed skip on redactor throw).
- Dataset versioning is numeric-increment (`undefined` → `"2"`, `"3"` → `"4"`); non-numeric versions append `"-2"`. No persistent dataset store was added — curation returns the new in-memory immutable snapshot, matching `defineDataset`'s existing seams.

## Further Actions

- Consider a first-party persistence adapter for feedback-with-expected curation at scale (cursor continuation beyond one feedback page) if production curation batches routinely exceed 500 feedback records.