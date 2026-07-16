# Trace/Run Feedback and Evaluation Linkage

## Objectives
- Add bounded, ownership-scoped, redacted feedback records linked to durable Prism runs/traces and optional Phase 4 evaluations.
- Persist/query/delete immutable feedback through memory, SQLite, and PostgreSQL implementations.
- Project only safe metadata into optional OpenTelemetry spans/events; never copy comments, tags, IDs, or arbitrary metadata into metric labels.

## Expected Outcome
- Hosts can append ratings/comments/tags and scorer/evaluation references only for an existing owned run, query bounded pages, and delete owned records for retention/privacy.
- Evaluation records expose their linked feedback through a small composition helper without coupling core or persistence adapters to `@arnilo/prism-evals`.
- Existing agent runs remain unaffected when feedback telemetry/exporters fail; no vendor adapter or auto-activation is added.

## Tasks

- [x] Inventory reusable persistence, evaluation, ownership, redaction, and OpenTelemetry primitives
  - Acceptance Criteria:
    - Functional: map existing run IDs, ownership fields, cursor pages, evaluation IDs, redactors, retention/deletion expectations, and telemetry interfaces.
    - Performance: identify current page/JSON bounds and indexed SQL query patterns before adding storage.
    - Code Quality: reuse `ProductionPersistenceStore`, existing adapter migrations/query helpers, `EvaluationStore`, and Prism telemetry wrappers where they hold.
    - Security: identify trust boundaries for comments/tags, run existence, tenant ownership, deletion, and metric cardinality.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 12; `docs/observability.md`; `docs/runs-and-usage.md`; `docs/evaluations.md`; `docs/database-persistence.md`; SQLite/PostgreSQL persistence docs.
      - `src/contracts.ts`; `src/testing/persistence-schema.ts`; eval store/types; OTel instrumentation; SQLite/PostgreSQL DDL, migrations, row mappers, and query implementations.
    - Options Considered:
      - OTel-only feedback: rejected because exported spans cannot provide durable post-run query/update/delete semantics.
      - New feedback package: rejected; feedback is a small persistence capability and would add package registration/installation overhead.
      - Core contract + package-local implementations + eval/OTel composition helpers: chosen.
    - Chosen Approach:
      - Add one generic immutable record/store contract; expose it optionally from production persistence; keep SQL and memory implementation details package-local.
    - API Notes and Examples:
      ```ts
      await store.feedback.append({ id: "fb_1", runId, rating: 1, createdAt, tenantId, userId });
      ```
    - Files to Create/Edit:
      - `plans/064-trace-run-feedback-evaluation-linkage.md`: executable Phase 12 plan.
      - Existing source/docs listed above: primitive inventory only.
    - References:
      - Phase 12 roadmap acceptance criteria; Phase 4 evaluation package; Phase 2 usage migration pattern.
  - Test Cases to Write:
    - Inventory only; implementation tasks own behavior tests.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; inventory only.
    - Docs pages to create/edit: none for inventory.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add bounded feedback contracts, validation, memory storage, and evaluation linkage
  - Acceptance Criteria:
    - Functional: immutable feedback supports rating, bounded comment/tags, trace/scorer/evaluation links, cursor queries, and ownership-scoped deletion; append rejects missing or cross-owned runs through a host run resolver.
    - Performance: page size, comment bytes, tag/link counts, tag/id lengths, and metadata bytes have defaults/hard caps.
    - Code Quality: strict reusable types; one conformance helper validates any `RunFeedbackStore`; eval helper links records by IDs without copying scorer payloads.
    - Security: mandatory tenant plus account/user ownership, redaction before storage, no mutation by reference, abort propagation, and no unrestricted record query.
  - Approach:
    - Documentation Reviewed:
      - Core persistence contracts/query shapes; eval package store/redaction patterns; `src/testing/*` conformance patterns.
    - Options Considered:
      - Mutable update: rejected; immutable append + owned delete is simpler and preserves review evidence.
      - Feedback embedded in `RunRecord.metadata`: rejected; no independent pagination/deletion/linkage.
    - Chosen Approach:
      - Core `RunFeedbackRecord`, input/query/store/error/limits and `createMemoryRunFeedbackStore`; optional `ProductionPersistenceStore.feedback`; shared conformance helper; eval `appendEvaluationFeedback()` helper that resolves IDs from `EvaluationStore`.
    - API Notes and Examples:
      ```ts
      const feedback = createMemoryRunFeedbackStore({ runs: async ({ runId }) => runId === result.runId });
      const record = await feedback.append({ id: "fb_1", runId: result.runId, rating: 1, comment: "Useful", tenantId, userId });
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`, `src/feedback.ts`, `src/index.ts`, `src/testing/feedback.ts`, package exports/tests.
      - `packages/evals/src/types.ts`, `packages/evals/src/index.ts`, `packages/evals/src/feedback.ts`, eval tests.
    - References:
      - `PersistencePage`, `OwnershipScope`, `SecretRedactor`, `EvaluationRecord.id/scorerId/runId/traceId`.
  - Test Cases to Write:
    - Append/query/delete immutability, pagination, filters, abort, bounds, duplicate IDs, missing/cross-owned run, and canary redaction.
    - Evaluation linkage resolves same-run IDs from `EvaluationStore` and rejects mismatched run/trace/ownership or unknown evaluation IDs.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new feedback and eval linkage exports.
    - Docs pages to create/edit: `docs/runs-and-usage.md`, `docs/evaluations.md`, `docs/public-contracts.md`.
    - `docs/index.md` update: yes; update runs/evaluations descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add SQLite/PostgreSQL migration 003 and durable feedback adapters
  - Acceptance Criteria:
    - Functional: both adapters append/query/delete feedback, verify linked run + exact ownership, paginate deterministically, filter linkage fields, and survive reopen.
    - Performance: indexed ownership/run/trace/created cursors; bounded query limit; no full payload copied into indexes.
    - Code Quality: shared schema model/migration version 3, parameterized SQL, dialect-local DDL/row mapping, shared feedback conformance.
    - Security: DB constraints plus append/select/delete ownership predicates prevent cross-tenant linkage/read/delete; comments/tags/metadata are already redacted and byte-bounded at adapter boundary.
  - Approach:
    - Documentation Reviewed:
      - `src/testing/persistence-schema.ts`; adapter DDL/migration/row mapper/persistence tests; PostgreSQL live integration workflow.
    - Options Considered:
      - JSON feedback in generic checkpoints: rejected; poor run FK and query/index semantics.
      - Dedicated `prism_run_feedback` table in migration 003: chosen.
    - Chosen Approach:
      - One immutable table with FK to `prism_runs`; adapters implement `feedback` store over parameterized statements/queries and shared validation.
    - API Notes and Examples:
      ```sql
      SELECT * FROM prism_run_feedback
      WHERE tenant_id = ? AND user_id = ? AND run_id = ?
      ORDER BY created_at, id LIMIT ?;
      ```
    - Files to Create/Edit:
      - `src/testing/persistence-schema.ts` and persistence-schema tests.
      - SQLite/PostgreSQL `ddl.ts`, `migrations.ts`, `row-mappers.ts`, `persistence.ts`, tests/changelogs/docs.
    - References:
      - Migration 002 pattern; adapter `queryTable`; Postgres schema identifier qualification.
  - Test Cases to Write:
    - Migration up/reopen/version 3; schema table/index presence; append/query/delete; missing run; cross-owner denial; pagination; redaction persistence; live PostgreSQL when configured.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; production adapter schema and capability change.
    - Docs pages to create/edit: `docs/database-persistence.md`, `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`, `docs/release-and-install.md` if migration guidance changes.
    - `docs/index.md` update: no new page; existing persistence descriptions remain.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add safe OpenTelemetry feedback/evaluation projection
  - Acceptance Criteria:
    - Functional: instrumentation accepts feedback/evaluation notifications and emits metadata-only span events/attributes or standalone spans when run span ended; exporter errors remain isolated.
    - Performance: no comments, tag values, evaluation/scorer IDs, run/trace IDs, or arbitrary metadata become metric labels; only bounded counts/rating/link-presence/status are projected.
    - Code Quality: package-owned telemetry notification types; no dependency on evals or vendor SDKs.
    - Security: unrestricted text never reaches telemetry; high-cardinality identifiers remain span-only; disabled/exporter-failing instrumentation cannot affect persistence or agent runs.
  - Approach:
    - Documentation Reviewed:
      - `docs/observability.md`; current `PrismSpan`/meter wrappers and instrumentation tests.
    - Options Considered:
      - Metrics with tag/scorer labels: rejected due cardinality/PII.
      - Safe span event API + low-cardinality counters: chosen.
    - Chosen Approach:
      - Extend `PrismSpan` with optional `addEvent`; expose `handleRunFeedback`/`handleEvaluation` methods using safe scalar attributes and fixed metric label vocabularies.
    - API Notes and Examples:
      ```ts
      telemetry.handleRunFeedback({ runId, rating: 1, tagCount: 1, evaluationCount: 1 });
      ```
    - Files to Create/Edit:
      - `packages/observability-opentelemetry/src/instrumentation.ts`, exports/tests/README/changelog.
    - References:
      - Existing exporter isolation and low-cardinality metric policy.
  - Test Cases to Write:
    - Active/ended-run projection; safe attributes only; no comments/tags/IDs in metrics; disabled behavior; throwing exporter isolation.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; instrumentation gains feedback/evaluation handlers.
    - Docs pages to create/edit: `docs/observability.md`, `docs/evaluations.md`.
    - `docs/index.md` update: yes; update Observability description.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Document, benchmark, validate, and mark Phase 12 complete
  - Acceptance Criteria:
    - Functional: examples/docs cover append/query/delete/eval link/telemetry without vendor services.
    - Performance: focused benchmarks record bounded memory query/SQL pack impact; full release gate remains within budget.
    - Code Quality: docs, changelogs, public exports, migration contracts, and roadmap agree; `sdk:ready` passes.
    - Security: threat docs cover PII, deletion, retention, tenant isolation, metric cardinality, and exporter isolation; audit is clean.
  - Approach:
    - Documentation Reviewed:
      - Prism wiki structure, release checklist, performance docs, package README/changelog conventions.
    - Options Considered:
      - New feedback docs page: rejected; feedback belongs in run/usage, evaluation, observability, and persistence pages.
    - Chosen Approach:
      - Update existing API pages/navigation and one runnable example; record exact test/pack/audit evidence in roadmap and this plan.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      npm audit --audit-level=high
      ```
    - Files to Create/Edit:
      - `examples/run-feedback.ts`, `examples/README.md`; relevant docs/index/README/changelogs/performance/migration/review coverage; `roadmap.md`; this plan.
    - References:
      - `.agents/skills/create-plan/references/prism-wiki.md`; Phase 12 roadmap acceptance criteria.
  - Test Cases to Write:
    - Run example; full build/typecheck/tests/packs/audit; `git diff --check`; strict-source scans.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; public Phase 12 API must be discoverable.
    - Docs pages to create/edit: `docs/runs-and-usage.md`, `docs/evaluations.md`, `docs/observability.md`, persistence pages, `docs/performance.md`, `docs/migration.md`, `docs/review-coverage-2026-07-15.md`.
    - `docs/index.md` update: yes; revise Runs, Evaluations, and Observability entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Feedback records are immutable append/delete rows; no update API or revision chain was added. Hosts correct feedback by appending another ID and may delete obsolete rows.
- Feedback requires exact tenant plus account/user scope even though older persistence queries permit partial ownership. This is intentionally stricter and avoids ambiguous cross-account/user reads.
- `EvaluationStore` remains package-local/in-memory. `appendEvaluationFeedback()` resolves existing records through its seam and persists only IDs into durable feedback; it does not turn evaluation score/reason payloads into a second SQL schema.
- Scorer/evaluation/tag filters use bounded JSON-array predicates; only owner/run/trace creation paths are indexed. Add store-native link tables only if measured query plans require them.
- Retention is explicit owned deletion or run cascade, not an auto-started cleanup worker. Hosts already own retention scheduling/policy.
- Post-run OTel projection creates a short span when the agent span has ended. The tiny tracer seam cannot re-parent an exported span or mutate exported history; vendor-specific trace mutation was not added.
- PostgreSQL feedback behavior is covered by DDL tests and env-gated live conformance; local release validation had no `PRISM_TEST_POSTGRES_URL` and retained the explicit live skips.

## Further Actions
- Priority medium: add an optional durable `EvaluationStore` adapter only when hosts need score/reason SQL queries; keep it separate from feedback linkage.
- Priority medium: add feedback retention execution helpers if hosts repeatedly implement the same age-based owned deletion loop.
- Priority medium: add normalized feedback-link tables/indexes only after query-plan evidence shows bounded JSON predicates are insufficient.
- Priority low: extend `PrismTracer.startSpan` with host-supplied parent/link context if post-export trace association is needed across telemetry SDKs.
- Priority low: add feedback revision/supersession IDs if product workflows need visible correction history rather than append/delete semantics.
