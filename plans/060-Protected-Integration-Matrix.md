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

- [x] PostgreSQL integration job (sessions + enterprise)
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
    - Chosen Approach: `on: push` to `main`/`master` + `workflow_dispatch`; service `postgres:16` on localhost (job is not containerized). `@arnilo/prism-core` had no `test:postgres` script, so root `test:postgres --if-present` was a no-op for sessions/enterprise — added that script. Job runs it plus `scripts/phase27-ha.test.mjs`. URL masked via `::add-mask::`. No workflow-lint in repo.
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
      - `packages/prism-core/package.json` (`test:postgres` script).
      - `docs/release-and-install.md` (matrix row).
    - References: review §5 missing-evidence list; `docs/0.1.0-readiness.md` matrix conventions.
  - Test Cases to Write:
    - None new — the point is making existing protected suites required. Add a workflow-lint check if repo has one.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `docs/release-and-install.md` (matrix row for the new job).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] NATS integration job
  - Acceptance Criteria:
    - Functional: protected-branch job runs distributed-event/cursor/restart suites with `PRISM_TEST_NATS_URL` against a `nats` service container; blocks merge on failure.
    - Performance: job <8 min including container start.
    - Code Quality: same workflow file or sibling; single source for the env var name.
    - Security: test credentials only; no production credentials in workflow.
  - Approach:
    - Documentation Reviewed: existing NATS test gates (`PRISM_TEST_NATS_URL` skip logic); nats docker image conventions.
    - Options Considered: fold into postgres job (mixed failure domains) vs separate job (chosen: clearer required-check naming).
    - Chosen Approach: `integration-nats.yml` on push to `main`/`master`. GHA service containers cannot pass `nats-server -js`, so the job `docker run`s `nats:2 -js` and waits on 4222. No real-NATS suite existed (fake-jetstream only; skip-manifest named the gap) — added `test:nats` + one integration file that runs existing `assertAgentEventSourceConforms` + cursor-resume reopen against `PRISM_TEST_NATS_URL`.
    - API Notes and Examples:
      ```yaml
      services:
        nats: { image: "nats:2", ports: ["4222:4222"] }
      env:
        PRISM_TEST_NATS_URL: "nats://nats:4222"
      ```
    - Files to Create/Edit:
      - `.github/workflows/integration-nats.yml` (create).
      - `packages/prism-core/src/sessions/nats/__tests__/nats.integration.test.ts` (create).
      - `packages/prism-core/package.json` + root `package.json` (`test:nats`).
      - `scripts/require-nats-url.mjs` (create).
      - `docs/release-and-install.md` (matrix row).
    - References: review §5.
  - Test Cases to Write: none new (existing suites).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `docs/release-and-install.md` matrix row.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Sandbox/browser threat suite on supported Linux runner
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
    - Chosen Approach: reused `sandbox-browser.yml` instead of a new `integration-sandbox.yml` (it already ran the full suite: adversarial fixtures, protected Docker matrix, native T9, blocker gate — a new file would duplicate it). Fixed two latent breaks: 3× stale `-w @arnilo/prism-coding-security` refs (renamed to `@arnilo/prism-coding-tools` in phase54; build step failed, so no evidence step ever ran) and the T9 evidence gate (node ignores `--test-name-pattern` after file args, so the full suite ran and unrelated doc-reader skips forced `native=skipped` forever — now matches the T9 line itself, missing line fails closed). Added push-to-`main`/`master` trigger, Playwright chromium cache, runner-requirements comment, and an always-on network-free egress/policy legs step. Residual risk: T9 needs netns (`unshare --net`); if hosted runners deny it the gate fails closed and the deferred self-hosted option triggers.
    - API Notes and Examples: n/a (workflow).
    - Files to Create/Edit:
      - `.github/workflows/sandbox-browser.yml` (edit: trigger, workspace fix, T9 gate, cache, egress step).
      - `docs/release-and-install.md` (matrix row).
    - References: review §5 sandbox bullet; `docs/0.1.0-readiness.md` security policy section.
  - Test Cases to Write: none new (existing threat suites become required).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `docs/release-and-install.md` matrix row.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Office golden validation job
  - Acceptance Criteria:
    - Functional: protected job runs office golden-file round-trips (docx/xlsx/pptx/diagrams generate→parse→compare) on packed artifacts (`npm pack` output), not just workspace source.
    - Performance: job <8 min.
    - Code Quality: golden corpus lives in repo; failures print first diffing file only (no log wall).
    - Security: corpus contains only synthetic documents.
  - Approach:
    - Documentation Reviewed: `packages/office` test layout; review §5 Office golden bullet.
    - Options Considered: run inside unit tests (already partial) vs packed-artifact job (chosen — catches packaging regressions unit tests miss).
    - Chosen Approach: `integration-office.yml` on push to `main`/`master` (8-min cap). release.yml `office-validation` already covers LibreOffice conversion on workspace source, so the new leg is packed-only: `scripts/office-golden-packed.test.mjs` runs `npm pack`, extracts under `node_modules/.prism-office-packed-*` (hoisted prod-dep resolution), and replays the golden corpus (parse→compare, regenerate→parse→compare per format + diagrams canonicalize stability) importing generate/parse from the tarball. Equality helpers reused from workspace dist (test-only logic; code under test is packed). Verified tarball holds dist and excludes golden/tests/src. Single test body = first diffing file only.
    - API Notes and Examples: n/a.
    - Files to Create/Edit:
      - `.github/workflows/integration-office.yml` (create).
      - `scripts/office-golden-packed.test.mjs` (create).
      - `docs/release-and-install.md` (matrix row).
    - References: review §5.
  - Test Cases to Write: none new.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `docs/release-and-install.md` matrix row.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Operator-gated live-provider canary (protected)
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
    - Chosen Approach: `canary-providers.yml`, nightly `0 3 * * *` + dispatch (never blocks PRs by construction). No new smoke script: matrix legs run each provider's existing live suite (text + tool-call/structured legs, `assertNoSecretLeak` inside) via `node --test dist/<provider>/__tests__/live.test.js`; provider set is `vars.PRISM_CANARY_PROVIDERS` JSON array (default `["openai"]`), keys all from the existing `live-canaries` environment (missing key = skip). Evidence is job summaries (statuses only); `report` job opens one issue on failure (`issues: write` scoped to that job). Per-leg 5-min cap keeps runtime <5 min.
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

- [x] Long-run leak tests
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
  - Implementation Notes (completed):
    - `leak-sessions.test.ts`: 200 subscribe/dispose cycles assert `session.subscribers` back to 0 each cycle; plus per-cycle parked-waiter release + bounded-queue drain + disposed-is-done against `EventSubscriber` directly (first draft parked 200 waiters and awaited a promise only `close()` could resolve — sequential-await deadlock, fixed by per-cycle design).
    - `leak-pages.test.ts`: 200 `open`/`closeRun` cycles on `FakeBrowser`; `hasRun` false after each closeRun and after manager `close()`.
    - `leak-processes.test.ts`: 200 spawn/exit across exit/kill/release modes (native `node -e`, no sandbox) assert zero non-terminal records, registry empty after `await disposeSessions` (un-awaited dispose was a false 198-residue failure), release-mode skips `wait()` (throws "session released" by design).
    - Terminal records are retained in `host.sessions` by design (re-readable job table), so the leak invariant is terminal-only residue + post-dispose empty, not size 0 mid-run.
    - All suites skip on heaps <512 MiB (`heap_size_limit`), no sleeps, total ~2s.
    - Deliberate-leak canary proven locally then deleted: 200 undisposed subscriptions left `subscribers.size = 200` and the baseline assertion exited nonzero.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Migration rollback/restore drill as release evidence
  - Acceptance Criteria:
    - Functional: a test drills apply-migration → seed → rollback-one-version → verify-schema-compat → re-apply for PostgreSQL (and SQLite in-process), asserting data defined as durable survives documented rollback policy.
    - Performance: drill <5 min inside postgres job.
    - Code Quality: drill is one script usable locally (`node scripts/drill-migration-rollback.mjs --url …`).
    - Security: operates only on the CI database; refuses default/production-looking URLs.
  - Approach:
    - Documentation Reviewed: `docs/release-and-install.md` migration policy text; prism-core migration runner.
    - Options Considered: document-only (status quo, rejected by review) vs executable drill (chosen).
    - Chosen Approach: `scripts/drill-migration-rollback.mjs` wired into `integration-postgres.yml` (self-test step first, then the real drill against `$PRISM_TEST_POSTGRES_URL`). Flow per store: apply all 9 migrations → seed via the real persistence `append` → downgrade one version (inverse of 009's additive DDL: drop `prompt_version` + delete the history row — the documented package-version-rollback policy) → verify the 008-shape store still works and seeded data survived → re-apply → `verifyMigrationIdempotency` + data intact → tamper a checksum row and prove the runner fails closed. SQLite leg runs the same flow in-process on a temp file. Refuses any non-loopback URL (host allowlist localhost/127.0.0.1/::1) — `--self-test` verifies the refusals without a database. Prints one-line JSON summary; runtime ~0.2 s locally, far under the 5-min cap. Historical prose-only drill claims in frozen release notes stay untouched; this page's matrix row is the executed evidence link.
    - API Notes and Examples: `node scripts/drill-migration-rollback.mjs --url "$PRISM_TEST_POSTGRES_URL"`.
    - Files to Create/Edit: `scripts/drill-migration-rollback.mjs` (create); `.github/workflows/integration-postgres.yml` (step).
    - References: review §4 P1 drill bullet.
  - Test Cases to Write:
    - Drill refuses non-CI URL pattern (safety assertion).
    - Drill fails when schemaVersion mismatch is introduced (proves it detects breakage).
  - Implementation Notes (completed):
    - Both canaries live inside the drill: URL refusal is asserted by `--self-test` (runs before the drill in CI); the checksum-tamper canary is a drill step (`checksum-fail-closed`) — tampered row must reject the next apply.
    - Store `append`/`list` are async on BOTH Postgres and SQLite (`createPostgresPersistence` is async; un-awaited SQLite appends were lost on close) — the drill awaits everywhere.
    - The drill passes `skipMigrations: true` and owns the migration lifecycle explicitly (apply, downgrade, re-apply via the runner) instead of letting the store re-assert internally.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `docs/release-and-install.md` — replace prose-only drill claim with executed evidence link.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Required-check wiring + release evidence links
  - Acceptance Criteria:
    - Functional: branch protection lists the new integration jobs as required (documented; settings change is an owner action); each release evidence page links the latest matrix runs.
    - Performance: n/a.
    - Code Quality: `docs/release-and-install.md` carries a single matrix table: job → workflow path → cadence → evidence location.
    - Security: secrets inventory documented (which env vars each job needs).
  - Approach:
    - Documentation Reviewed: current required checks; release evidence format.
    - Options Considered: n/a (wiring task).
    - Chosen Approach: documented in `docs/release-and-install.md` directly under the matrix table: (1) **required-checks block** — the four check names to mark required on `main` (owner action; GitHub API reports `main` has **no branch protection at all** yet — 404): `postgres (sessions + enterprise)`, `nats (events + cursor + restart)`, `office golden (packed artifacts)`, `protected-matrix` (sandbox job id); canary + its `report` job deliberately not required. (2) **release evidence links** — per-release pointer convention: latest green run of each workflow (`github.com/ashiqrniloy/prism/actions/workflows/<file>`); `_evidence/` snapshots stay frozen. (3) **secrets inventory** — the three integration jobs need NO repo secrets (service-container URLs generated in-job and masked); `sandbox-browser` uses repo variables only (6 named, `sandbox-browser` environment); only `canary-providers` uses secrets (9 provider API keys, `live-canaries` environment) + `PRISM_CANARY_PROVIDERS` var. Matrix table gained the canary row (5 rows, single table, job → workflow → cadence → evidence).
    - Dry-run dispatch: verified blocked by design until push — `gh workflow run integration-postgres.yml --ref main` returns `HTTP 404: workflow not found on the default branch` (files exist only in this working tree; the repo shows only the pre-existing 5 workflows). Post-push dispatch commands are in the docs block; dispatching requires no secrets.
    - API Notes and Examples: `gh workflow run integration-postgres.yml --ref <branch>`.
    - Files to Create/Edit: `docs/release-and-install.md`; this plan's checkboxes.
    - References: review §8 step 4.
  - Test Cases to Write: n/a.
  - Implementation Notes (completed):
    - Check names verified against each workflow's `name:`/job id (GitHub check name = job `name:` if set, else job id — `protected-matrix` has no `name:`, so that is its check name).
    - `plans/README.md` was missing the `063-Synapta-MCP-2026-07-28-Adoption.md` index row (pre-existing, unrelated); added it so the plans-index docs test passes.
    - `budget-gate` startup ceiling flaked under post-suite machine load (252–285 ms vs 250 ceiling); warm-cache reruns measure 157–244 ms and the suite passes — no product change, noted here so the flake is not misread as a regression.
    - The drill is import-safe for `import-hygiene.test.mjs`: CLI-only guard (`import.meta.url === argv[1]`) gates all side effects, and pg/better-sqlite3 load lazily inside it so importing the file loads node builtins only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `docs/release-and-install.md`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- Protected-branch-only runs (never PRs): PRs can't reach the environment secrets, and the matrix is cheap enough per push. Trade-off: main-branch breakage is caught after merge instead of at PR time — mitigated by every job also having `workflow_dispatch` for pre-merge verification.
- No real-NATS suite existed, so one minimal integration file (conformance + cursor-reopen) was added rather than inventing new coverage; deeper NATS scenarios stay out of scope until a named consumer exists.
- Sandbox/browser work reused the existing `sandbox-browser.yml` (fixing two latent breaks: stale `@arnilo/prism-coding-security` package refs and a T9 gate that could never go green) instead of duplicating the suite in a new workflow.
- Office golden runs on packed tarballs only (release.yml already covers workspace-source LibreOffice conversion); first-diffing-file-only failure output keeps logs short.
- Leak tests assert explicit registry/terminal-state sizes (deterministic) instead of heap-snapshot diffing (flaky); terminal session records retained by design — the invariant is terminal-only residue + post-dispose emptiness, not size 0 mid-run.
- Required-check wiring is documentation, not configuration: branch protection is an owner action in GitHub settings (this repo currently has none); the docs block lists the exact check names and the post-push dispatch verification.
- Budget-gate startup ceiling flakes under machine load (local-only observation); left the 250 ms ceiling untouched and recorded the warm-cache numbers in the task notes.

## Further Actions

- Owner: push this branch to `main`, then (1) create the environments (`sandbox-browser`, `live-canaries`) with the inventoried variables/secrets, (2) run one `gh workflow run <file> --ref main` per new workflow to register + verify them, (3) enable branch protection on `main` with the four required check names from the docs block.
- Owner: keep `PRISM_CANARY_PROVIDERS` as the single knob for canary provider set; missing keys skip their leg (never fail the nightly).
- If hosted runners deny `unshare --net` for the native T9 gate, revisit the deferred self-hosted runner option (fail-closed today).
- Add deeper NATS scenarios (multi-consumer, stream reset) only when a consumer names the need; the skip manifest already records the protected gap.
- Watch the budget-gate startup ceiling on CI hardware; if hosted runners measure near the ceiling, rebaseline `startup.importMsCeiling` in `scripts/budgets.json` with a recorded reason.
