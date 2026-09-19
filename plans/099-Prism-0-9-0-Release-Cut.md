# 0.9.0 Release Cut

Release: 0.9.0 (this plan). Ships plans 086–098 plus plan 100 (live stream terminal semantics, which delivers this line's `budget_exhausted` attribution to live subscribers). Plan [101](101-Cache-Stability-Follow-Ups.md) is a post-cut follow-up to 088 and is deliberately **not** part of this cut. Precedent: plan 085's 0.8.0 cut.

## Objectives
- Cut @arnilo/prism 0.9.0 with all 086–098 features behind their documented options, defaults preserving 0.8 behavior.
- Green `release:gate` with a deliberately regenerated compatibility baseline (plans 086–098 add public symbols; no removals are planned — any that appear must be listed here first).
- Migration notes, CHANGELOG, docs index consistent before publish.

## Expected Outcome
- `npm publish` artifacts green; hosts (clay 0.7→0.9 pin, synapta 0.7→0.9 pin) can adopt without behavior change until they opt into each new surface.
- `docs/migrate-to-0.9.md` covers every new option/event in one page.

## Tasks

- [ ] Task 0: Pre-release budget rebaseline (export ceiling, tarball diet, non-null assertions)
  - Acceptance Criteria:
    - Functional: `scripts/budget-gate.test.mjs` is green before the version bump. The three regressed ceilings are either reduced or rebaselined with the measured value and a dated `$comment` reason naming the plan(s) that caused the growth: `@arnilo/prism` export surface (measured 1445 vs ceiling 1400, +45), root artifact diet (packedBytes 1412699 vs baseline 1320080, unpackedBytes 4643130 vs baseline 4356107, fileCount 533 vs baseline 505 — all over the +5% limit), and non-null assertions (`src` 551 vs 537, `examples` 33 vs 29, total 2205 vs ceiling 2176). Growth is first checked for dead exports (`scripts/dead-exports.mjs`, `node scripts/sweep-unused.mjs`) and removable tarball weight; anything left standing is rebaselined in one commit, not raised per-plan as work lands.
    - Performance: `budget-gate` runtime unchanged; `startup.importMsCeiling` and the benchmark rows are only rebaselined if measured over the ceiling on CI hardware (no local-machine raise).
    - Code Quality: every raised ceiling carries the measured number in its reason string; `src/__tests__/public-export-contract.test.ts` `FROZEN_VALUE_EXPORTS`/`FROZEN_TYPE_EXPORTS` already list the 086–098 + 100 additions, so the rebaseline commit only touches numbers, not the export contract; `docs/_evidence/phase54-package-map.md` regenerated so the recorded export count matches the gate.
    - Security: tarball diet never moves tests or scripts into the published tarballs (plan 026 rule); no secrets in the regenerated evidence.
  - Approach:
    - Documentation Reviewed: `scripts/budgets.json` dated-`$comment` rebaseline convention, `scripts/budget-gate.test.mjs` / `scripts/budget-gates.mjs` (`assertAll` naming the delta), plan 058 export-ceiling design, plan 066/061/055 rebaseline precedents, `docs/release-and-install.md` budget section.
    - Options Considered: (a) rebaseline once after 086–098 + 100 stop moving the numbers ← chosen; (b) raise each ceiling as its plan lands — rejected, it absorbs unreviewed exports and hides dead ones; (c) shrink the root tarball by packing tests/scripts — forbidden by plan 026; (d) leave the gate red into the cut — rejected, Task 1 cannot be green with a red gate.
    - Chosen Approach: measure once, delete dead exports and dead tarball weight where cheap, then rebaseline the rest with reasons in a single evidence commit ahead of the bump.
    - API Notes and Examples:
      ```bash
      node --test scripts/budget-gate.test.mjs   # names every delta
      node scripts/dead-exports.mjs              # candidates to delete before raising a ceiling
      npm pack --dry-run --json                  # root tarball packed/unpacked/fileCount
      ```
    - Files to Create/Edit: `scripts/budgets.json` (ceilings + dated reasons); `docs/_evidence/phase54-package-map.md` (regenerated); `docs/release-and-install.md` (budget paragraphs name the 0.9.0 baselines instead of the plan 066 ones).
    - References: plan 058 (export ceilings), plan 026 (tarball rule), plan 096 Compromises Made (why the rebaseline was deferred to the cut).
  - Test Cases to Write:
    - `node --test scripts/budget-gate.test.mjs` exits 0 (export, artifact-diet, non-null-assertion legs).
    - `docs/_evidence/phase54-package-map.md` regenerated from the live tree and its export count equals the gate's measured value.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (budgets and evidence only).
    - Docs pages to create/edit: `docs/release-and-install.md` (export-count and offline-test budget paragraphs re-dated to the 0.9.0 baselines).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 1: Version bump + workspace-wide type/test/lint green
  - Acceptance Criteria:
    - Functional: All workspace packages bumped to 0.9.0 per release script conventions; full test suite, lint, typecheck pass.
    - Performance: CI budget unchanged.
    - Code Quality: No `skip` flags introduced by the cut.
    - Security: `npm audit` clean or explained in release notes.
  - Approach:
    - Documentation Reviewed: `docs/release-and-install.md`, plan 085 cut task.
    - Options Considered: n/a.
    - Chosen Approach: Standard release plumbing.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs bump 0.9.0
      ```
    - Files to Create/Edit: package.json versions via script.
    - References: `docs/release-and-install.md`.
  - Test Cases to Write:
    - Existing suites (cut adds none beyond regression runs).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: n/a.

- [ ] Task 2: Compatibility baseline regeneration + gate
  - Acceptance Criteria:
    - Functional: `node scripts/release.mjs gate --update-baseline` regenerates `scripts/compat-baseline/` files; `release:gate` green; diff reviewed so additions (attention trigger union, stop-reason/budget events, cache usage fields, toolNarrowing, estimation exports, guardrail packs, spawn lifetime options, checkpoint metadata/restore hooks, searchSessions, no-model turns, trajectory export, shared scopes, the terminal-event predicate from plan 100) are intentional; **any removals or signature breaks are listed in this task before regeneration** — planned: none.
    - Performance: Gate runtime within existing budget.
    - Code Quality: Baseline diff committed atomically with the version bump.
    - Security: Baseline contains no secrets (script guarantee, spot-checked).
  - Approach:
    - Documentation Reviewed: plan 083/084 lesson (baseline left unregenerated → gate red for every later plan); `scripts/compat-baseline/` current files.
    - Options Considered: Hand-edit baseline — forbidden; script-only regeneration.
    - Chosen Approach: Regenerate + human-reviewed diff.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs gate --update-baseline && npm run release:gate
      ```
    - Files to Create/Edit: `scripts/compat-baseline/*` (script-written).
    - References: plans 083/084 baseline incident notes.
  - Test Cases to Write:
    - `release:gate` exit 0.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (gate mechanics).
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: n/a.

- [ ] Task 3: Migration page, CHANGELOG, docs index
  - Acceptance Criteria:
    - Functional: `docs/migrate-to-0.9.md` lists every new option/event with 3-line before/after snippets, defaults statement ("all 0.9.0 surfaces default off / default to 0.8 behavior"), and per-knob sizing lines from plans 086/093/094/095/098; `CHANGELOG.md` 0.9.0 section summarizes features (no narrative duplication inside API pages — history rule); `docs/index.md` entries reviewed: new pages added if any plan created one, descriptions current-contract one-sentence style.
    - Functional (behavior notes): the migration page records the two 0.9.0 behavior changes that are not opt-in surfaces — a limit death now delivers `run_limit_exceeded` → `budget_exhausted` → `error` to live subscribers (plan 100; hosts that stopped at the first breach record should keep reading), and `provider_turn_finished` carries `stopReason`/`budgets` (plan 087).
    - Performance: n/a.
    - Code Quality: Index grouped under live headings; no plan numbers or version narrative in API pages.
    - Security: Migration examples use no secrets.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` (current-line vs history, index style)
      - plans 086–098 Documentation sections (the page list to reconcile)
      - `docs/migrate-to-0.8.md` as structural precedent.
    - Options Considered: Skip migration page (defaults unchanged) — rejected; hosts need one map of new surfaces.
    - Chosen Approach: One migration page + changelog + index reconciliation sweep.
    - API Notes and Examples:
      ```bash
      ls docs/migrate-to-0.9.md && grep -c "0.9" CHANGELOG.md
      ```
    - Files to Create/Edit:
      - `docs/migrate-to-0.9.md`: new.
      - `CHANGELOG.md`: 0.9.0 section.
      - `docs/index.md`: reconcile (additions only where new pages exist).
    - References: prism-wiki requirements file.
  - Test Cases to Write:
    - Docs link check (existing docs tooling) green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — release documentation surface.
    - Docs pages to create/edit: as listed above.
    - `docs/index.md` update: yes — migration entry under existing migration grouping.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 4: Publish + post-publish verification
  - Acceptance Criteria:
    - Functional: Packages published; `npm view @arnilo/prism version` → 0.9.0; smoke install in a temp project resolving imports for the headline exports (attention trigger union, searchSessions, guardrailPacks).
    - Performance: n/a.
    - Code Quality: Tag `v0.9.0` cut after publish verification.
    - Security: Publish via existing credential path; no tokens in logs.
  - Approach:
    - Documentation Reviewed: `docs/release-and-install.md`.
    - Options Considered: n/a.
    - Chosen Approach: Standard publish + smoke.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs publish && npm view @arnilo/prism version
      ```
    - Files to Create/Edit: none.
    - References: prior releases.
  - Test Cases to Write:
    - Smoke: temp project imports resolve, `createSession` with one new option works.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: n/a.

## Compromises Made
- To be filled after tasks are completed and tests pass.

## Further Actions
- To be filled after task completion with improvements, rationale, and priority.
