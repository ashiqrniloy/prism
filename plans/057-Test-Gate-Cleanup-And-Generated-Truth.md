# Test-Gate Cleanup and Generated Truth

Source: `docs/_evidence/implementation-review-2026-09-03.md` §2.1, §2.4, §2.5 and §8 step 2.
Executes the review's recommended order step 2: retire historical freeze machinery
from current gates; make package truth generated, never hand-copied.

Context: the antigravity removal and dependency bumps each broke hard-coded
11-package/54-retired/mtime assertions across phase13–30 scripts. That churn is
structural: current `npm test` asserts frozen history instead of current invariants.

## Objectives

- Remove `phase13-*` … `phase30-*` freeze/release scripts from the `npm test` path while preserving their evidence files as immutable history.
- Replace them with three current-invariant suites: (a) workspace/lock/package-truth consistency, (b) export/pack/install consistency, (c) release/security gate integrity.
- Guarantee no importable `scripts/*.mjs` has execution side effects.
- Make every hand-copied package count/table in active docs derive from `scripts/package-truth.json`.
- Purge stale 0.3-era package names from active docs (history stays in changelog/migration pages).

## Expected Outcome

- `npm test` runs current invariants only; historical-count churn class of failure is structurally gone.
- Docs package tables regenerate with one command; single source of truth.
- Faster suite (fewer redundant node --test files) with equal or better failure specificity.
- Green offline suite; lint/format clean.

## Tasks

- [ ] Inventory + retire freeze tests from `npm test`
  - Acceptance Criteria:
    - Functional: `package.json` `test` script no longer runs `phase13-freeze` … `phase30-release`, `phase34-freeze`, and equivalent historical freeze files; their `.mjs`/evidence files remain in repo untouched.
    - Performance: root script-stage test count drops materially (measure before/after `ℹ tests`); total wall time reduced.
    - Code Quality: removal is a single `test` script edit; no scripts deleted (history preserved).
    - Security: release/security gates (phase23-quality-gates, scan-secrets, release-gate, tooling-gate, budget-gate) remain in the run.
  - Approach:
    - Documentation Reviewed:
      - `package.json` test script (current file list).
      - `docs/_evidence/implementation-review-2026-09-03.md` §2.1 recommendation.
      - `plans/README.md` note: historical plan archives intentionally removed — same principle for freeze tests.
    - Options Considered:
      - Keep freeze tests, update all counts each change (status quo — the churn source; rejected).
      - Delete scripts entirely (rejected: immutable evidence for past releases).
      - Move out of `npm test`, keep files (chosen).
    - Chosen Approach: prune the `test` script file list; keep every retired file executable standalone via `node --test <file>` for audits.
    - API Notes and Examples:
      ```jsonc
      // package.json — keep current-invariant + gate files only:
      "test": "npm run build && node scripts/with-build-lock.mjs node --test dist/__tests__/*.test.js && node scripts/with-build-lock.mjs node --test scripts/{release-gate,tooling-gate,budget-gate,truth-current,packaging-current}.test.mjs && …"
      ```
    - Files to Create/Edit:
      - `package.json` (test script).
    - References: review §2.1; phase-count churn incidents in session records.
  - Test Cases to Write:
    - `scripts/truth-current.test.mjs` (next task) covers the invariants the retired files enforced.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (developer gate composition).
    - Docs pages to create/edit: `docs/release-and-install.md` — test-stage composition description update.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Three current-invariant suites replace retired coverage
  - Acceptance Criteria:
    - Functional: `scripts/truth-current.test.mjs` asserts (a) workspace manifests ↔ lockfile ↔ `package-truth.json` counts agree; (b) every active package packs/exports/installs (reuse existing packaging/install-smoke assertions, consolidated); (c) release + security gates listed in `package.json` exist and reference real files.
    - Performance: runs in seconds, no npm network calls.
    - Code Quality: derives every expected value from `computePackageTruth()` import — zero hard-coded package counts.
    - Security: keeps the scan-secrets/release-gate presence assertions (gate integrity).
  - Approach:
    - Documentation Reviewed:
      - `scripts/package-truth.mjs` (exported `computePackageTruth`, `PRISM_FAMILY`).
      - `scripts/phase54-package-map.test.mjs`, `src/__tests__/{packaging,install-smoke}.test.ts` (assertions worth carrying forward).
    - Options Considered:
      - Fold into existing `docs.test.ts` (rejected: mixes doc-content checks with structural gates).
      - One new consolidated suite (chosen).
    - Chosen Approach: single `truth-current.test.mjs` importing truth functions; assertions about shapes, not frozen numbers.
    - API Notes and Examples:
      ```js
      import { computePackageTruth } from "./package-truth.mjs";
      const truth = computePackageTruth(rootDir);
      assert.equal(manifests.length, truth.families.length + truth.capability.length /* … */);
      ```
    - Files to Create/Edit:
      - `scripts/truth-current.test.mjs` (create).
      - `scripts/packaging-current.test.mjs` (create; consolidated pack/install assertions).
    - References: review §2.1 "replace with three current tests".
  - Test Cases to Write:
    - Deliberately mismatch a temp copy of package-truth vs manifests → suite fails naming the drift.
    - Remove a gate file listed in `npm test` → gate-integrity assertion fails.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `docs/release-and-install.md` (test composition).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] No import side effects in `scripts/*.mjs`
  - Acceptance Criteria:
    - Functional: every `scripts/*.mjs` that exports functions performs file writes/process exit only under direct execution (the `package-truth.mjs` guard pattern); a sweep test imports each export-bearing script and asserts zero files written and zero `process.exitCode` changes.
    - Performance: sweep completes <2 s.
    - Code Quality: one-line `if (process.argv[1] === fileURLToPath(import.meta.url))` guard convention, documented in scripts README or header comment.
    - Security: no script mutates tracked files as an import side effect (the package-truth bug class).
  - Approach:
    - Documentation Reviewed:
      - Fixed `scripts/package-truth.mjs` guard (this session).
      - Review §2.4.
    - Options Considered: split every script into lib+cli files (more files, no behavior gain) vs guard convention + sweep test (chosen).
    - Chosen Approach: guard pattern everywhere + `scripts/import-hygiene.test.mjs`.
    - API Notes and Examples:
      ```js
      if (process.argv[1] === fileURLToPath(import.meta.url)) { /* CLI main */ }
      ```
    - Files to Create/Edit:
      - Each export-bearing `scripts/*.mjs` (guard added where missing).
      - `scripts/import-hygiene.test.mjs` (create).
    - References: review §2.4; package-truth fix commit.
  - Test Cases to Write:
    - Hygiene sweep: import all export-bearing scripts in a temp cwd; snapshot repo `git status --porcelain` before/after → identical.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Generate docs package tables from `package-truth.json`
  - Acceptance Criteria:
    - Functional: package/version tables in `docs/index.md`, `README.md`, `docs/release-and-install.md`, `docs/provider-packages.md` are generated (or asserted) from `scripts/package-truth.json`; zero hand-copied counts remain in active docs.
    - Performance: generation step <1 s; runs inside existing gates.
    - Code Quality: one generator (`node scripts/package-truth.mjs --emit-docs` or a small renderer) reused by docs tests; no per-page ad hoc lists.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - `scripts/package-truth.mjs` (already single source; byte-stable output).
      - `src/__tests__/docs.test.ts` current token assertions (to be replaced by structural ones).
    - Options Considered:
      - Keep prose counts + tests pinning them (status quo churn; rejected).
      - Generate tables into docs at regen time + tests assert table↔truth equality (chosen).
    - Chosen Approach: truth-driven table blocks with generated markers; docs tests compare against live `computePackageTruth()`.
    - API Notes and Examples:
      ```md
      <!-- generated:package-truth:packages begin -->(table)<!-- end -->
      ```
    - Files to Create/Edit:
      - `scripts/package-truth.mjs` (optional `--emit-docs`) or `scripts/render-package-tables.mjs` (tentative — pick one, not both).
      - `README.md`, `docs/index.md`, `docs/release-and-install.md`, `docs/provider-packages.md`.
      - `src/__tests__/docs.test.ts` (structural assertions).
    - References: review §2.5; this session's 11→10 manifest churn across docs.
  - Test Cases to Write:
    - Edit a generated table by hand → docs test fails naming the page.
    - Regenerate → byte-diff only in generated blocks.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (docs truth pipeline).
    - Docs pages to create/edit: the four pages above.
    - `docs/index.md` update: yes — generated package table replaces hand list.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Purge 0.3-era package names from active docs
  - Acceptance Criteria:
    - Functional: no active docs page (outside `CHANGELOG.md`, `docs/migrate-to-0.4.md`, `docs/_evidence/**`) references retired 0.3 package names as current; historical mentions are explicitly past-tense/migration-scoped.
    - Performance: n/a.
    - Code Quality: a docs test enforces the allow-list (retired names allowed only in history pages).
    - Security: n/a.
  - Approach:
    - Documentation Reviewed: `docs/migrate-to-0.4.md` (canonical history location); review §2.5.
    - Options Considered: manual pass only (drifts again) vs allow-list test (chosen).
    - Chosen Approach: manual sweep + permanent enforcement test.
    - API Notes and Examples: n/a.
    - Files to Create/Edit:
      - Active `docs/*.md` sweep; `src/__tests__/docs.test.ts` (retired-name allow-list).
    - References: `scripts/phase54-package-map.mjs` retired list (data source for the test).
  - Test Cases to Write:
    - Retired name appears in an active page → test fails listing page+line.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: swept pages.
    - `docs/index.md` update: no (covered by table task).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Full verification and evidence
  - Acceptance Criteria:
    - Functional: offline `npm test` green with the new composition; `npm run test:coverage` thresholds pass; biome lint/format clean.
    - Performance: record before/after suite wall time in evidence.
    - Code Quality: `docs/_evidence/test-gate-cleanup-<date>.md` records old→new file list, counts, timing, and retired-file inventory.
    - Security: release/security gates confirmed still enforced.
  - Approach:
    - Documentation Reviewed: `docs/release-and-install.md` verification section.
    - Options Considered: n/a.
    - Chosen Approach: run full gates; write evidence; update `plans/README.md` status.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: evidence file; this plan's checkboxes.
    - References: review §8 step 2.
  - Test Cases to Write: n/a (runs suites).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: evidence file.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
