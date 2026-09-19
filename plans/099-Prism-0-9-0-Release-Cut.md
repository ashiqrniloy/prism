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

- [x] Task 0: Pre-release budget rebaseline (export ceiling, tarball diet, non-null assertions)
  - Acceptance Criteria:
    - Functional: `scripts/budget-gate.test.mjs` is green before the version bump. The three regressed ceilings are either reduced or rebaselined with the measured value and a dated `$comment` reason naming the plan(s) that caused the growth: `@arnilo/prism` export surface (measured 1445 vs ceiling 1400, +45), root artifact diet (packedBytes 1412699 vs baseline 1320080, unpackedBytes 4643130 vs baseline 4356107, fileCount 533 vs baseline 505 — all over the +5% limit), and non-null assertions (`src` 551 vs 537, `examples` 33 vs 29, total 2205 vs ceiling 2176). Growth is first checked for dead exports (`scripts/dead-exports.mjs`, `node scripts/sweep-unused.mjs`) and removable tarball weight; anything left standing is rebaselined in one commit, not raised per-plan as work lands.
    - Performance: `budget-gate` runtime unchanged; `startup.importMsCeiling` and the benchmark rows are only rebaselined if measured over the ceiling on CI hardware (no local-machine raise).
    - Code Quality: every raised ceiling carries the measured number in its reason string; `src/__tests__/public-export-contract.test.ts` `FROZEN_VALUE_EXPORTS`/`FROZEN_TYPE_EXPORTS` already list the 086–098 + 100 additions, so the rebaseline commit only touches numbers, not the export contract; `docs/_evidence/phase54-package-map.md` regenerated so the recorded export count matches the gate.
    - Security: tarball diet never moves tests or scripts into the published tarballs (plan 026 rule); no secrets in the regenerated evidence.
  - Notes (executed 2026-09-19):
    - Dead exports: `node scripts/dead-exports.mjs` reported 0 actionable candidates (11 zero-ref exports stay keep-classified) and `node scripts/sweep-unused.mjs` found only 5 pre-existing test-local diagnostics, so no export was deleted to offset the growth.
    - Tarball diet checked before rebaselining: `docs/history/**` (~513 KiB of the 4.6 MiB unpacked pack, 19 files) and `CHANGELOG.md` (170 KiB) are the only large removables, and both are deliberate shipped traceability — dropping the archive needs link surgery across the 10 docs pages that link into it plus the `docs/index.md` archive entry, so it is recorded as a follow-up instead of done in this cut. No test, script, plan, or source file entered the pack; `docs/_evidence/**` stays excluded.
    - Measured at rebaseline: root **1414295 packed / 4647338 unpacked / 533 files** (the plan's 1412699/4643130 predate the plan-098 doc edits and this task's own `docs/release-and-install.md` bullet, which is itself part of the final measurement); exports **`@arnilo/prism` 1445 / `@arnilo/prism-memory` 892** (the plan named only the root +45 — memory was also over, +21 from plan 098 shared work scope); non-null assertions **src 551, examples 33, `packages/memory/src` 221** (also over, +12 from plan 098's `shared-scopes.test.ts`), total 2217 — `packages/prism-core/src` measured 414 against its 435 allowance, so that row stayed.
    - `docs/_evidence/phase54-package-map.md` regenerated with `node scripts/package-truth.mjs --emit-docs`; its section 9 now carries the gate's own count in a **Budget-Gated Exports (src)** column beside the dist/compat-baseline column, so the recorded number equals `scripts/budgets.json` by construction (generator change in `scripts/phase54-package-map.mjs`).
    - `startup.importMsCeiling` and the benchmark medians were not touched: the startup leg passed off-load on this machine, so no local-machine raise.
    - Plan 100 Task 1 was still unchecked at rebaseline time, so its documented `@arnilo/prism` +1 is not in the measured 1445; that task must keep its addition inside the new ceiling or re-run this rebaseline when it lands (called out in the budgets.json reason). `src/__tests__/public-export-contract.test.ts` already lists the 086–098 additions and passes unchanged — no export-contract edit in the rebaseline commit.
    - Checks: `node --test scripts/budget-gate.test.mjs` 19/19 green (was 3 failing legs); `node --test scripts/truth-current.test.mjs scripts/phase54-package-map.test.mjs` 17/17; `dist/__tests__/public-export-contract.test.js` + `dist/__tests__/packaging.test.js` 293/293; `dist/__tests__/docs.test.js` 155/155.
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

- [x] Task 1: Version bump + workspace-wide type/test/lint green
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
  - Notes (executed 2026-09-19):
    - Bump: `node scripts/release.mjs bump --from 0.8.0 --to 0.9.0 --ranges caret` rewrote all 11 manifests, rewrote the 10 internal dependency ranges to `^0.9.0`, and regenerated `package-lock.json`. The three hand-claim surfaces the version-literal gate checks were then moved by hand: `src/index.ts` `version` constant, `docs/index.md` banner + `current **0.9.0**` bullet, and `.github/workflows/release.yml` (tag list, both `if:` tag conditions, the publish-step shell tag test).
    - Deviation from the task's "docs pages to create/edit: none": `docs/release-and-install.md` is a claim surface — the plan 025–029/085 freeze tests assert the live root version as `@arnilo/prism@^<version>` and `arnilo-prism-<version>.tgz` in it, so its current-line paragraph, lockstep paragraph, tarball-filename list, Node row, and required-peer bullet now read 0.9.0. `docs/index.md`, `README.md`, `docs/release-and-install.md`, `docs/provider-packages.md`, and `docs/_evidence/phase54-package-map.md` were regenerated with `node scripts/package-truth.mjs --emit-docs`.
    - The 085 release-contract test was refactored version-agnostic (`assert.equal(version, "0.8.0")` dropped; banner split now uses the live version; the messaging-channels blurb is asserted on the page, not on the live current-line slice) so the 0.9.0 cut keeps the gate instead of bypassing it — the same treatment `071_release_0_6_0_contract_is_documented` got at 0.7.0/0.8.0. `docs/index.md` current-line bullets still describe the 0.8.0 line under the 0.9.0 banner; Task 3 rewrites that section (the banner is gate-enforced, the blurbs are not).
    - Two pre-existing reds blocked the task's green acceptance and were fixed:
      - `packages/memory/src/rag/__tests__/local-reranker.test.ts` hand-patched the global fetch, violating the network-free guard (plan 089 shipped it; plan 094 had already recorded it as a pre-existing failure). Replaced with `t.mock.method(globalThis, "fetch", …)`, which Node restores automatically — the guard's rule and plan 009's earlier debt fix both point the same way.
      - `npm run format:check` was red on 11 files from plans 086–098 (biome format), and `sdk:ready` — the CI verify leg — runs it, so the cut could not have published. Formatted those 11 (cosmetic only: line joining/wrapping, no semantic change, verified file by file) and deleted `packages/prism-core/probe2.mjs`, an unreferenced scratch probe accidentally committed in the WIP commit `6413b0e3`.
    - Release evidence: `scripts/release-evidence.json` (gitignored) regenerated — release `0.9.0`, 43 surfaces, `blocked=true` locally, which is the documented state under plain `npm test`; Task 2's `release:gate` enforces zero blocked after the full `sdk:ready`.
    - Checks: `npm run typecheck` 0, `npm run lint` 0, `npm run format:check` 0, `npm audit` 0 vulnerabilities, `npm test` 6/6 stages (root suites 24.7s, gate 59.8s, workspace 42.8s). Budget gate green at **1414316 packed / 4647354 unpacked / 533 files** (baseline 1414295 / 4647338 / 533; +21 packed from the version-string and formatting churn, inside the +5% band, so no rebaseline). The workspace stage flaked once on the known `packages/memory/dist/wiki/__tests__/cli.test.js` IPC deserialization error (VENT 4×); the unchanged rerun passed.
  - Documentation/Wiki Assessment (executed): docs pages edited — `docs/index.md`, `docs/release-and-install.md`, `README.md`, `docs/provider-packages.md` (all generated blocks + the release-page version claims listed above); no new pages, so no index additions.

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
- The rebaseline commit carries one non-numeric change: `scripts/phase54-package-map.mjs` now renders the gate's `measureExportCounts` value as a Budget-Gated Exports column so the evidence doc and `scripts/budgets.json` cannot disagree. Without it the task's "recorded export count equals the gate's measured value" case was unverifiable — the pre-existing column counts the built dist surface, a different metric (root 1030 vs the gate's 1445).
- Executed measurements differ from the plan's recorded ones (packed 1414294 not 1412699, unpacked 4647338 not 4643130), and two over-budget rows the task did not name were raised: `@arnilo/prism-memory` exports 871 → 892 and `packages/memory/src` non-null assertions 209 → 221, both from plan 098. The plan text keeps the pre-execution figures as the record of what was estimated; `scripts/budgets.json` carries the executed numbers in its reasons.
- `docs/history/**` eviction from the tarball was rejected for this cut (link surgery across 10 docs pages + `docs/index.md`) and deferred to Further Actions, so the artifact diet ceiling was raised instead of lowered.
- Plan 100 Task 1 was still unchecked, so the 1445 root export ceiling does not include its documented +1; that task's own budget step stays the owner rather than pre-raising a ceiling for code that does not exist.
- Task 1 carries three changes that are not literally "version plumbing", because the task's own green acceptance required them: the release-page version claims (the freeze tests assert the live version against that page), the network-free-guard fix in the plan 089 local-reranker test (the root suite fails on the guard violation), and the biome format pass over 11 plan 086–098 files (CI's `sdk:ready` verify leg fails on `format:check`). The format pass is cosmetic-only and the scratch probe deletion is unreferenced code, so no behavior ships with the bump.
- The 0.9.0 manifests were bumped while plan 100 Task 1 is still open (0/1), so the version does not yet carry the `budget_exhausted` live-delivery surface the plan header lists. Landing plan 100 after the bump means its documented `@arnilo/prism` +1 must fit inside the 1445 ceiling and its own budget step runs against a 0.9.0 manifest set; Task 2's compat baseline regeneration must come after it or the frozen baseline misses the terminal-event predicate.
- `docs/index.md`'s current-line bullets still describe 0.8.0 under the new 0.9.0 banner (the banner is version-literal-gate enforced, the bullet content is not); Task 3 owns the rewrite, so this intermediate state is committed rather than fixed twice.

## Further Actions
- Land plan 100 Task 1 before Tasks 1–2 of this plan and confirm its `@arnilo/prism` +1 fits 1445; if it pushes past, fold it into a second small budget commit rather than a second full rebaseline. Priority: high (release ordering).
- Evict `docs/history/**` (~513 KiB unpacked, the only large measured diet left) from the root tarball by moving the archive out of the shipped `docs/` tree and rewriting the 18 links in 10 pages plus the `docs/index.md` archive entry; would absorb future docs growth without raising the ceiling again. Priority: medium (docs-only, needs the docs link check green before a cut).
- Add `npm run format:check` (and a `release-evidence.json` freshness check) to the per-plan execution checklist, not just the cut: eleven files from plans 086–098 sat unformatted until Task 1 ran the full sdk:ready chain, and a red format gate is invisible to `npm test`/`lint`. Priority: medium (one line in the execution skill beats finding it at the cut).
- `docs/performance.md` still records the 2026-08-27 pack numbers (923,045 / 3,149,665 / 375) as historical evidence; if a current-line number is wanted there, generate that paragraph from `scripts/budgets.json#root`. Priority: low (frozen evidence page).
