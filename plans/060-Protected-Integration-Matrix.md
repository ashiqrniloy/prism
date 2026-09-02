# Protected Integration and Coverage Evidence Matrix

Source: `docs/_evidence/implementation-review-2026-09-03.md` §5 (coverage assessment),
§4 P1 (migration drills), §8 step 4. Line coverage is not the risk; missing
environment-backed evidence is. This plan makes a small protected CI matrix required.

Current state: prism-core coverage gate is protected because `PRISM_TEST_POSTGRES_URL` /
`PRISM_TEST_NATS_URL` are absent on regular runs; sandbox/browser validation failed for
missing Docker + native capability evidence (CI runs observed failing for exactly this).

## Objectives

- Required protected-branch jobs: PostgreSQL (sessions + enterprise), NATS, Docker sandbox/browser threat suite, Office golden validation, small operator-gated live-provider canary.
- Add long-run leak tests for the known registries (sessions, browser pages, process registries, subscribers, event queues).
- Promote migration rollback/restore drills from documentation to release evidence.
- Keep unit coverage thresholds as-is; publish environment-backed evidence links per release.

## Expected Outcome

- Protected branches require the matrix; PRs without secrets still pass (jobs use repo-level environment secrets, not PR labels).
- Each release evidence page links latest matrix runs.
- Leak tests catch subscriber/page/process growth regressions before release.

## Tasks

- [ ] PostgreSQL integration job (sessions + enterprise)
  - Acceptance Criteria:
    - Functional: a protected-branch workflow runs the prism-core protected suites (sessions sqlite↔postgres parity, enterprise persistence, fencing/HA unit legs) against a service PostgreSQL 16 container with `PRISM_TEST_POSTGRES_URL` from environment secrets; failures block merge.
    - Performance: job <10 min; migrations run once per job.
    - Code Quality: workflow reuses existing test entry points (no test duplication); job config in one file.
    - Security: credentials only via environment secrets; never echoed; job logs redact connection strings.
  - Approach:
    - Documentation Reviewed:
      - `.github/workflows/` existing release/security workflows (postgres service precedent in CI legs).
      - prism-core protected-skip logic (env-var gates).
      - `docs/release-and-install.md` protected canary matrix section.
    - Options Considered:
      - Run in PRs with ephemeral containers (cost + secrets policy rejected).
      - Protected-branch-only with service container (chosen).
    - Chosen Approach: `on: push` to protected branches + service `postgres:16`; run the existing protected suites.
    - API Notes and Examples:
      ```yaml
      services:
        postgres:
          image: postgres:16
          env: { POSTGRES_PASSWORD: prism-ci }
      env:
        PRISM_TEST_POSTGRES_URL: postgres://prism-ci:prism-ci@postgres:5432/prism
      ```
    - Files to Create/Edit:
      - `.github/workflows/integration-postgres.yml` (create).
    - References: review §5 missing-evidence list; `docs/0.1.0-readiness.md` matrix conventions.
  - Test Cases to Write:
    - None new — the point is making existing protected suites required. Add a workflow-lint check if repo has one.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `docs/release-and-install.md` (matrix row for the new job).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] NATS integration job
  - Acceptance Criteria:
    - Functional: protected-branch job runs distributed-event/cursor/restart suites with `PRISM_TEST_NATS_URL` against a `nats` service container; blocks merge on failure.
    - Performance: job <8 min including container start.
    - Code Quality: same workflow file or sibling; single source for the env var name.
    - Security: test credentials only; no production credentials in workflow.
  - Approach:
    - Documentation Reviewed: existing NATS test gates (`PRISM_TEST_NATS_URL` skip logic); nats docker image conventions.
    - Options Considered: fold into postgres job (mixed failure domains) vs separate job (chosen: clearer required-check naming).
    - Chosen Approach: `integration-nats.yml` with `nats:latest` service.
    - API Notes and Examples:
      ```yaml
      services:
        nats: { image: "nats:2", ports: ["4222:4222"] }
      env:
        PRISM_TEST_NATS_URL: "nats://nats:4222"
      ```
    - Files to Create/Edit: `.github/workflows/integration-nats.yml` (create).
    - References: review §5.
  - Test Cases to Write: none new (existing suites).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `docs/release-and-install.md` matrix row.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Sandbox/browser threat suite on supported Linux runner
  - Acceptance Criteria:
    - Functional: protected-branch job with Docker available runs the sandbox isolation + browser threat tests (isolation boundaries, egress denial, capability restrictions); the "missing Docker/native capability evidence" failure class is closed.
    - Performance: job <15 min; browsers cached between runs.
    - Code Quality: runner requirements (ubuntu-latest + docker) documented in the workflow.
    - Security: suite asserts egress denial and isolation (negative tests must fail-open-proof).
  - Approach:
    - Documentation Reviewed:
      - Failed CI run evidence (sandbox browser validation failed for missing Docker).
      - `packages/web-tools` + coding-tools sandbox test entry points.
    - Options Considered:
      - Self-hosted runner with nested virtualization (deferred — no infra yet).
      - ubuntu-latest with Docker (chosen — supports current suite).
    - Chosen Approach: `integration-sandbox.yml` on ubuntu-latest; install browser deps via existing setup scripts; run threat suites.
    - API Notes and Examples: n/a (workflow).
    - Files to Create/Edit: `.github/workflows/integration-sandbox.yml` (create).
    - References: review §5 sandbox bullet; `docs/0.1.0-readiness.md` security policy section.
  - Test Cases to Write: none new (existing threat suites become required).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `docs/release-and-install.md` matrix row.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Office golden validation job
  - Acceptance Criteria:
    - Functional: protected job runs office golden-file round-trips (docx/xlsx/pptx/diagrams generate→parse→compare) on packed artifacts (`npm pack` output), not just workspace source.
    - Performance: job <8 min.
    - Code Quality: golden corpus lives in repo; failures print first diffing file only (no log wall).
    - Security: corpus contains only synthetic documents.
  - Approach:
    - Documentation Reviewed: `packages/office` test layout; review §5 Office golden bullet.
    - Options Considered: run inside unit tests (already partial) vs packed-artifact job (chosen — catches packaging regressions unit tests miss).
    - Chosen Approach: pack office package, install into temp dir, run golden suite against packed tarball.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: `.github/workflows/integration-office.yml` (create).
    - References: review §5.
  - Test Cases to Write: none new.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `docs/release-and-install.md` matrix row.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Operator-gated live-provider canary (protected)
  - Acceptance Criteria:
    - Functional: one scheduled (nightly) protected workflow runs a minimal live-provider smoke (1 text completion + 1 structured output per enabled provider) using repo secrets; failures open an issue, block nothing in PR flow.
    - Performance: runtime <5 min; provider set configurable via repo variable.
    - Code Quality: results appended to a rolling evidence file in an automated commit or job summary (choose one; job summary first).
    - Security: keys only via environment secrets; responses never logged; redaction assertions run before any echo.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md` live-probe gating precedent (plan 055 operator ledger).
      - `packages/prism-providers` live test gating (`PRISM_LIVE_PROVIDER_TESTS`).
    - Options Considered:
      - Per-PR live tests (rejected: cost + secret exposure policy).
      - Scheduled canary with issue-on-failure (chosen).
    - Chosen Approach: nightly `schedule:` workflow; provider list from `vars.PRISM_CANARY_PROVIDERS`.
    - API Notes and Examples:
      ```yaml
      on: { schedule: [{ cron: "0 3 * * *" }] }
      env: { PRISM_LIVE_PROVIDER_TESTS: "1" }
      ```
    - Files to Create/Edit: `.github/workflows/canary-providers.yml` (create).
    - References: review §5 live-provider bullet; plan 055 live-probe ledger.
  - Test Cases to Write: none new (existing live tests, gated on).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `docs/provider-conformance.md` (canary cadence + evidence link).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Long-run leak tests
  - Acceptance Criteria:
    - Functional: new test files drive N=200 iterations of session create/teardown, browser page open/close, process spawn/exit, subscriber subscribe/dispose, event-queue drain; assert registries return to baseline size (weak-ref or explicit registry assertions).
    - Performance: total added suite time <60 s; tests skip gracefully in constrained CI memory.
    - Code Quality: table-driven; one file per package; no sleeps as synchronization.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed: review §4 P2 leak bullet; existing registry implementations (session/page/process registries).
    - Options Considered: heap-snapshot diffing (flaky in CI) vs registry-size assertions (chosen — deterministic).
    - Chosen Approach: assert explicit registry maps/sets empty after teardown loops.
    - API Notes and Examples:
      ```ts
      for (let i = 0; i < 200; i++) await cycleSession();
      assert.equal(sessionRegistry.size, 0, "sessions leaked");
      ```
    - Files to Create/Edit:
      - `src/__tests__/leak-sessions.test.ts`, `packages/web-tools/src/__tests__/leak-pages.test.ts`, `packages/prism-coding-tools/src/agent/__tests__/leak-processes.test.ts` (create; subscriber/queue tests in their owning packages).
    - References: review §4 P2.
  - Test Cases to Write:
    - The leak assertions themselves; plus one deliberate-leak canary test run locally to prove the assertion can fail (then deleted).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Migration rollback/restore drill as release evidence
  - Acceptance Criteria:
    - Functional: a test drills apply-migration → seed → rollback-one-version → verify-schema-compat → re-apply for PostgreSQL (and SQLite in-process), asserting data defined as durable survives documented rollback policy.
    - Performance: drill <5 min inside postgres job.
    - Code Quality: drill is one script usable locally (`node scripts/drill-migration-rollback.mjs --url …`).
    - Security: operates only on the CI database; refuses default/production-looking URLs.
  - Approach:
    - Documentation Reviewed: `docs/release-and-install.md` migration policy text; prism-core migration runner.
    - Options Considered: document-only (status quo, rejected by review) vs executable drill (chosen).
    - Chosen Approach: script + wire into integration-postgres job.
    - API Notes and Examples: `node scripts/drill-migration-rollback.mjs --url "$PRISM_TEST_POSTGRES_URL"`.
    - Files to Create/Edit: `scripts/drill-migration-rollback.mjs` (create); `.github/workflows/integration-postgres.yml` (step).
    - References: review §4 P1 drill bullet.
  - Test Cases to Write:
    - Drill refuses non-CI URL pattern (safety assertion).
    - Drill fails when schemaVersion mismatch is introduced (proves it detects breakage).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `docs/release-and-install.md` — replace prose-only drill claim with executed evidence link.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Required-check wiring + release evidence links
  - Acceptance Criteria:
    - Functional: branch protection lists the new integration jobs as required (documented; settings change is an owner action); each release evidence page links the latest matrix runs.
    - Performance: n/a.
    - Code Quality: `docs/release-and-install.md` carries a single matrix table: job → workflow path → cadence → evidence location.
    - Security: secrets inventory documented (which env vars each job needs).
  - Approach:
    - Documentation Reviewed: current required checks; release evidence format.
    - Options Considered: n/a (wiring task).
    - Chosen Approach: document + verify via one dry-run dispatch per workflow.
    - API Notes and Examples: `gh workflow run integration-postgres.yml --ref <branch>`.
    - Files to Create/Edit: `docs/release-and-install.md`; this plan's checkboxes.
    - References: review §8 step 4.
  - Test Cases to Write: n/a.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `docs/release-and-install.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
