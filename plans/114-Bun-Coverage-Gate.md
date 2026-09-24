# Bun Coverage Gate

Depends on `plans/113-Bun-Dev-Toolchain.md` (Task 2 minimum: `bun.lock`, `bun ci`, `setup-bun` in CI). Do not start before plan 113 Task 2 lands; the coverage binaries and install surface it installs are this plan's substrate.

Moves the coverage measurement and its gates from Node's `node --test --experimental-test-coverage` (60/70/75 floors plus the per-workspace freeze in `scripts/coverage-thresholds.json`) to `bun test --coverage`. The decision was greenfield-reviewed, not assumed: Bun 1.4.2's threshold semantics were probed on this machine (fraction 0–1, `{ lines, functions, statements }` keys, no `branches` key, enforcement tied to the text reporter, per-loaded-file checking). Those probes are the seed of Task 1; Task 1 re-runs them as transcripts and owns every decision this plan acts on. Floors are recalibrated under Bun's instrument with plan 023's methodology (freeze = measured − 3pp); Node's numbers are not ported, because Node's coverage and Bun's coverage are different instruments and a ported floor gates nothing real.

Node stays the test runtime for everything this plan does not own: the Postgres TAP leg, the budget gate, the wiki-scratch isolation leg, `node22-compat`, and publish. `npm` stays the publish contract. Nothing here changes package exports, `engines.node`, or consumer install.

## Objectives

- `bun test --coverage` is the only coverage instrument for the core gate and every gated workspace row in `scripts/coverage-summary.mjs`. `--experimental-test-coverage` appears in no default script after this plan.
- Floors are Bun-instrument numbers: core gate plus `scripts/coverage-thresholds.json` recomputed as measured − 3pp on Bun 1.4.2, old Node values archived in the evidence file, not carried over.
- The branch floor gets an explicit disposition, not a silent loss: either parsed from lcov (`BRDA`/`BRF`/`BRH`) for the core gate, or dropped with the reasoning and the ceiling recorded in the evidence file.
- `scripts/coverage-summary.mjs` keeps its shape — one script, one artifact (`scripts/coverage-summary.json`), same failure-tail redaction, same protected-integration exemptions — with the child command, the table regex, and the thresholds swapped. No second summary tool, no new dependency.

## Expected Outcome

- `npm run test:coverage` runs the core suite under `bun test --coverage` (text reporter as the gate; lcov, if kept, as a written artifact that never gates on 1.4.2) and `scripts/coverage-summary.mjs` spawns `bun` for core and every gated workspace. Exit codes gate; the `All files` vacuous-pass trap (a failed run printing 100% rows) stays guarded.
- `scripts/coverage-thresholds.json` holds Bun-measured floors; a row below floor fails the stage. Protected-integration packages (Postgres/NATS legs) stay exempt and reported separately.
- `scripts/phase23-coverage.test.mjs` and `scripts/phase23-skip-manifest.test.mjs` assert the new reporter/row shape; frozen era-evidence files under `scripts/` are not edited.
- CI coverage jobs run `bun` (already installed by plan 113); `setup-node` stays on every job that still runs `node` legs. `sdk:ready` keeps its name and order.
- A `mise.toml` user runs the same coverage command locally as CI.

## Tasks

- [x] Task 1: Measured inventory — Bun 1.4.2 coverage semantics and recalibration (must run first)
  - Acceptance Criteria:
    - Functional: `docs/_evidence/phase114-bun-coverage.md` exists and records, with command transcripts, every probe below. Later tasks consume this file; they do not re-decide a row it closed.
    - Functional: the review reproduces these already-measured facts on Bun 1.4.2: `coverageThreshold` is a fraction 0–1 (`0.9` = 90%), not a percent (`100` = an impossible 10000%); `{ lines = 0.9, functions = 0.5 }` with functions exactly at 50% exits 0 while a flat `0.9` against 50% functions exits 1; the accepted keys are `lines` and `functions` (with `statements` accepted by docs — verify whether it is enforced); there is no `branches` key; `bun test --coverage` prints a `File | % Funcs | % Lines | Uncovered Line #s` table with an `All files` row.
    - Functional: the review records, on 1.4.2, whether threshold enforcement fires per-file or on the aggregate (`oven-sh/bun` PR #27933 claims the aggregate fix — probe it: one loaded file below floor, aggregate above floor, record the exit code), and whether `--coverage-reporter=lcov` alone skips enforcement (`oven-sh/bun` issue #32118, fixes #32121/#32849 — probe, do not trust the issue tracker). The gate mechanism decision (native `coverageThreshold` vs parsing the `All files` row in `coverage-summary.mjs`, which preserves today's aggregate semantics) cites those transcripts.
    - Functional: the review records which bunfig/CLI keys scope the measurement: `coveragePathIgnorePatterns` (or the working equivalent) replacing Node's `--test-coverage-include=dist/**` workspace isolation, and the fact that never-imported files are invisible to the table (probe with an unimported source file). It states what that invisibility means versus Node's behavior for zero-coverage files today, and whether any current gate relied on catching them.
    - Functional: the review measures every currently gated package (core plus each workspace row in `scripts/coverage-summary.mjs`) under `bun test --coverage` on the same built `dist/`, and recomputes `scripts/coverage-thresholds.json` as measured − 3pp (plan 023 methodology). Old Node floors go into the evidence file as an archived table. The core 60/70/75 becomes the Bun-measured core floors; the branch disposition is decided here: if lcov `BRDA`/`BRF`/`BRH` data covers branches, record a sample parse and the measured branch number; otherwise record the drop and the ceiling (`# ponytail:` comment in Task 2's parser names it and the upgrade path).
    - Functional: the review times the coverage stage under Node (current command) and under Bun on the same tree. Numbers and the majority-cost sentence go in the evidence file.
    - Functional: `scripts/plan-review-gate.test.mjs` gains a `PLAN_114_TASK_1` block (plan path, evidence path, required tokens, rejected tokens) checked by the existing `assertPrimitiveReview` helper.
    - Performance: timing table is wall clock, one machine, cold vs warm called out.
    - Code Quality: transcripts and a decision table, not a design essay. Every row names a path or an exit code.
    - Security: evidence contains no credentials, no `PRISM_*` secret values, no absolute home paths. Coverage artifacts (`coverage/`) are gitignored.
  - Approach:
    - Documentation Reviewed:
      - Bun 1.4.2 local: `bun test --help` (`--coverage`, `--coverage-reporter=text|lcov`, `--coverage-dir`, `--reporter=junit`); this session's scratch probes (fraction thresholds enforced; exact-boundary pass; table shape; unloaded-file invisibility) — re-run and paste.
      - https://bun.com/docs/test/code-coverage and https://bun.com/guides/test/coverage-threshold — `coverageThreshold` fraction semantics, `{ lines, functions }` keys, per-file checking language, `coveragePathIgnorePatterns`.
      - https://github.com/oven-sh/bun/issues/32118 and PRs #32121, #32849, #27933 — reporter-tied enforcement and aggregate-vs-per-file fixes; each verified by local probe before it is believed.
      - `scripts/coverage-summary.mjs` — `CORE_GATE`, `SHARED_EXCLUDES`, the `ALL_FILES` regex, thresholds JSON flow, protected-integration exemptions, `coverage-summary.json` artifact, `scripts/coverage-failure.mjs` tail redaction.
      - `package.json` `test:coverage` / `coverage:summary` / `sdk:ready`; `scripts/phase23-coverage.test.mjs`; `scripts/phase23-skip-manifest.test.mjs`; plan 023's freeze methodology (recorded in `coverage-summary.mjs` header).
    - Options Considered:
      - Port the Node 60/70/75 numbers directly — rejected: different instrument, miscalibrated floor, gates nothing.
      - Keep Node coverage forever — rejected: decision made upstream of this plan; Bun is the runner, the instrument should not fork per stage without cause. Cost of the split is a second parser shape in `coverage-summary.mjs`.
      - Adopt `c8`/`istanbul` on top of Bun — rejected: new dependency for what Bun's reporter already emits; `coverage-summary.mjs` already owns table parsing.
      - Gate on lcov only — rejected pending probe: #32118 says lcov-only skips thresholds on 1.4.2. Text reporter stays the gate; lcov at most an artifact.
      - Drop the branch floor silently — rejected: the disposition is recorded with numbers either way.
    - Chosen Approach: one evidence file freezing semantics probes, the recalibrated floors table, the branch disposition, and the timing table. Task 2 implements only what it allows.
    - API Notes and Examples:
      ```bash
      # seed probes (already measured; Task 1 pastes fresh transcripts)
      bun test --coverage dist/__tests__/*.test.js            # text table, the gate
      bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage dist/__tests__/*.test.js
      # thresholds are fractions: { lines = 0.6, functions = 0.7 } in bunfig [test]
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase114-bun-coverage.md`: transcripts, recalibration table, branch disposition, timings.
      - `scripts/plan-review-gate.test.mjs`: `PLAN_114_TASK_1` block and one `assertPrimitiveReview` test.
    - References:
      - Required tokens: `bun test --coverage`, `coverageThreshold`, `lcov`, `coveragePathIgnorePatterns`, `coverage-thresholds.json`, `All files`, `plan 023`, `measured − 3pp`, `phase23-coverage`.
      - Rejected tokens: `c8`, `nyc`, `istanbul`, `port the 60/70/75 numbers`, `lcov as the gate`, `skip the recalibration`, `silently drop the branch floor`.
  - Test Cases to Write:
    - Review gate: `PLAN_114_TASK_1` fails when the evidence file is missing, drops a required token, or gains a rejected token.
    - Fraction probe: transcript shows `0.9` failing 50% functions and exact-boundary `{ lines = 0.9, functions = 0.5 }` passing — Task 2's bunfig values rest on it.
    - Reporter probe: transcript shows the lcov-only enforcement skip (or its absence) on 1.4.2 — Task 2's gate-reporter choice rests on it.
    - Recalibration: the thresholds table in evidence matches the recomputed `scripts/coverage-thresholds.json` in Task 2; old Node floors appear only in the archived table.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (evidence artifact and a test-only gate block).
    - Docs pages to create/edit: `docs/_evidence/phase114-bun-coverage.md` only (evidence, not an API page).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2: Wire the gate — `bun test --coverage` in scripts, summary, CI, and docs
  - Acceptance Criteria:
    - Functional: `package.json` `test:coverage` runs the core suite as `bun test --coverage ...` (plus `--timeout=0` per plan 113's probe) under `scripts/with-build-lock.mjs`, then `scripts/coverage-summary.mjs`, then the phase23 tests. `--experimental-test-coverage` no longer appears in any default script; the only remaining `node --test` stages are the Postgres TAP leg, the budget gate, the wiki-scratch isolation leg, and any file plan 113 marked `bun-blocked`.
    - Functional: `scripts/coverage-summary.mjs` spawns `bun` for the core row and every gated workspace row. The `ALL_FILES` regex matches Bun's `File | % Funcs | % Lines` table, the vacuous-100%-on-failed-run guard is re-proven against Bun's output (a failed child must never report coverage), thresholds come from the recalibrated `scripts/coverage-thresholds.json`, protected-integration exemptions and the `coverage-summary.json` artifact shape (`status`, `exitCode`, redacted `tail`) are unchanged. Workspace isolation uses the Task 1-verified ignore/include key, not a copied Node flag.
    - Functional: thresholds are enforced the way Task 1 decided — native `coverageThreshold` (bunfig) or the parsed `All files` aggregate in `coverage-summary.mjs`. The branch disposition lands as decided: an lcov `BRDA`/`BRF`/`BRH` parse for the core gate, or a `# ponytail:` comment recording the dropped floor, the ceiling, and the upgrade path.
    - Functional: `scripts/phase23-coverage.test.mjs` and `scripts/phase23-skip-manifest.test.mjs` assert the new reporter and row shapes. Frozen era evidence (`scripts/phase16-freeze.test.mjs`, `scripts/phase27-release.test.mjs`, `scripts/phase30-release.test.mjs`, baseline hashes) is not edited.
    - Functional: CI jobs that run coverage use `bun` (installed by plan 113's pinned `setup-bun`); `cache:` entries that keyed off removed artifacts are cleaned; `setup-node` stays on jobs that still run `node` legs or publish.
    - Functional: `coverage/` output is gitignored; lcov files, if produced, are CI artifacts, never gates.
    - Performance: before/after coverage-stage wall clock recorded next to Task 1's table. If Bun coverage is slower than the Node stage it replaced, the numbers and the keep-decision are recorded in the evidence file — no silent regression.
    - Code Quality: one summary script, one parser, one thresholds file — no new files beyond `bunfig.toml`/gitignore entries and the evidence file. No new dependency. Spawn `bun` by name (plan 113's `process.execPath` rule).
    - Security: a below-floor row fails the stage and the `sdk:ready` chain. No threshold may be raised without a fresh measured recalibration recorded in evidence. Artifact tails stay redacted (`scripts/coverage-failure.mjs`).
  - Approach:
    - Documentation Reviewed:
      - Task 1 evidence file (semantics, floors, branch disposition, timings).
      - Plan 113 evidence (`docs/_evidence/phase113-bun-inventory.md`) for spawn rules, `--timeout=0`, and the workflow install list.
      - `scripts/coverage-summary.mjs`, `scripts/coverage-failure.mjs`, `scripts/phase23-coverage.test.mjs`, `scripts/phase23-skip-manifest.test.mjs`, `docs/testing.md`, `docs/release-and-install.md`.
    - Options Considered:
      - Per-workspace `bunfig.toml` files with native thresholds — rejected unless Task 1 proves per-file enforcement matches intent: today's gates are aggregate `All files` floors; per-file at the same number is a stricter gate that would fail packages with legitimately cold files.
      - Rewrite `coverage-summary.mjs` from scratch — rejected: the exemptions, artifact, redaction, and phase23 assertions are load-bearing; swapping the child command and the regex is the whole change.
      - Keep Node coverage for workspaces, Bun for core — rejected: two instruments in one summary table; a row would not be comparable to its neighbor.
    - Chosen Approach: swap the instrument inside the existing gate machinery. Same script, same artifact, same exemptions, recalibrated floors.
    - API Notes and Examples:
      ```bash
      # package.json (shape; exact flags per Task 1)
      "test:coverage": "node scripts/with-build-lock.mjs bun test --coverage --timeout=0 dist/__tests__/*.test.js && node scripts/with-build-lock.mjs node scripts/coverage-summary.mjs && node --test scripts/phase23-coverage.test.mjs && node --test scripts/phase23-skip-manifest.test.mjs"
      ```
      ```toml
      # bunfig.toml [test] — only if Task 1 chose native enforcement
      coverageThreshold = { lines = 0.6, functions = 0.7 }   # fractions, Bun-measured
      ```
    - Files to Create/Edit:
      - `package.json`: `test:coverage` (and `coverage:summary` if the child command changes).
      - `scripts/coverage-summary.mjs`: bun spawn, new `ALL_FILES` regex, thresholds source, branch parse or `ponytail:` note.
      - `scripts/coverage-thresholds.json`: recalibrated values (Task 1's table).
      - `scripts/phase23-coverage.test.mjs`, `scripts/phase23-skip-manifest.test.mjs`: new shapes.
      - `bunfig.toml`: root `[test] coveragePathIgnorePatterns` for the core row, **plus one `packages/<name>/bunfig.toml` per gated workspace** with `[test] coveragePathIgnorePatterns = ["../**"]` — Task 1 §1.6 measured that 1.4.2 reads config only from `$cwd/bunfig.toml` (`bun test --config`, `bun --config … test`, and the root file from a package cwd are all ignored). No native `coverageThreshold` keys (Task 1 §2.4).
      - `.gitignore`: `coverage/`.
      - `.github/workflows/*.yml`: coverage jobs' runner and cache entries.
      - `docs/testing.md`, `docs/release-and-install.md`: coverage command, instrument note (floors are Bun-measured), budget sentence.
      - `README.md`: contributor coverage row.
      - `docs/_evidence/phase114-bun-coverage.md`: Task 2 note with before/after timings.
    - References:
      - `scripts/coverage-summary.mjs` header (plan 023/070/071 history — the machinery this task preserves).
      - `docs/testing.md` five stages; `scripts/run-all-tests.mjs` is untouched — coverage is not a default-suite stage.
  - Test Cases to Write:
    - Summary parser: a fixture Bun table (including the `All files` row and a failed-child 100% trap) produces the same row/gate decisions as today's Node fixture test.
    - Threshold gate: a fixture `coverage-thresholds.json` floor above a fixture measured row fails the stage; below passes; protected rows are exempt either way.
    - Branch disposition: if kept, an lcov fixture with `BRDA`/`BRF`/`BRH` computes the branch percentage; if dropped, the `ponytail:` comment exists in `coverage-summary.mjs` and the evidence records why.
    - Script shape: `test:coverage` contains `bun test --coverage` and `--timeout=0`, and no `--experimental-test-coverage` anywhere in default scripts.
    - Budget: the coverage stage wall clock is recorded against Task 1's Node timing.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no package export or consumer contract. Contributor coverage command, gate floors, and CI behavior change — a development-contract change.
    - Docs pages to create/edit: `docs/testing.md` (coverage stage row), `docs/release-and-install.md` (coverage command + floor provenance sentence), `README.md` (script row).
    - `docs/index.md` update: yes, one existing sentence only — if the testing entry names the coverage command or floors, update it to the current command without plan numbers or version narrative. No new page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- **The coverage stage is ~33% slower: 128 s (Node instrument) → 169.7 / 170.2 s (Bun) on this
  16-core host.** The stage runs the core suite twice (the first `test:coverage` command and again
  inside `coverage-summary.mjs`) and the core suite is ~1.8× slower under Bun's instrument; the
  workspace rows are a wash (31.4 s vs 32.8 s). The instrument swap is the plan's objective, so the
  cost is recorded in the evidence file §7.2 and `docs/release-and-install.md` instead of hidden.
  Trimming the double core run is follow-up 3.
  **Superseded 2026-09-23 (plan 115 Task 6):** `docs/_evidence/phase115-suite-budget.md` §13 fused the
  two core runs through a capture seam — 169.7 / 170.2 / 175.8 s → 136.8 / 137.1 s, ~34.7 s recovered,
  core row and workspace rows unchanged — so the stage no longer re-measures the core suite; this bullet
  stays as the pre-§13 record.
- **The branch floor is dropped entirely.** Bun 1.4.2 emits no `BRDA`/`BRF`/`BRH` and its text table
  has no branch column (evidence §2.5), so the core 75 floor and the per-package `branches` numbers
  are gone; the JSON records `null` and the script carries a `ponytail:` ceiling with the upgrade
  path. Branch coverage is currently ungated at every level — the deliberate cost of the instrument.
- **Three Bun-runner failures were fixed to make the gate green, one of them inside plan 115 Task 3's
  scope.** core `cli-provider-add` spawned `process.execPath --test` (one line → `"node"`, plan 115's
  rule); `@arnilo/prism-ag-ui`'s `acp-recovery` test raced the client disconnect (now polls while
  connected); `@arnilo/prism-coding-tools`' `failHttp` destroyed the response but not the socket, so
  Bun delivered a clean empty 200 (now destroys `res.socket` first). All three reproduce
  deterministically under `bun test` and pass under `node --test` after the fix.
- **The ag-ui finding is a real product race, not just a test race.** A durable cancel is aborted by
  the notification signal when the client disconnects right after `notify`; Node wins that race by
  scheduling, Bun does not. The test now waits for the marker while connected and the product
  behavior is left unchanged (follow-up 1).
- **11 package-local `bunfig.toml` files were added beyond the plan's file list.** Task 1 §1.6
  measured that 1.4.2 reads `coveragePathIgnorePatterns` only from `$cwd/bunfig.toml` and ignores the
  root file, `bun test --config`, and `bun --config … test`; without them every workspace row would
  be polluted with repo-root dist rows (acp-agent measured 359 foreign rows).
- **`scripts/phase23-build-race.test.mjs` scenario 4 still spawns `node --test
  --experimental-test-coverage`.** It is a build-race fixture, not a default script, and swapping its
  leaf is follow-up 4. The "no `--experimental-test-coverage`" assertion in the coverage gate covers
  `package.json` scripts only, where the flag is gone.
- **The core gate is the parsed `All files` aggregate, not per-file native enforcement.** Native
  `coverageThreshold` is per-file on 1.4.2 (one cold file fails a passing aggregate), which would be
  a stricter gate than the aggregate floors running today; the parsed row keeps the semantics and
  goes through the existing fail-closed machinery.

## Further Actions

1. **ag-ui durable cancel vs client disconnect (product, medium).** The cancel notification's signal
   aborts the durable marker write when the client hangs up immediately; decide whether
   `runRecovery.cancel` should use a connection-independent signal, and cover it with a test that
   disconnects before observing the marker. **Destination: `plans/116-Acp-Durable-Cancel-Vs-Client-Disconnect.md` Task 1 (with `docs/_evidence/phase116-acp-cancel-disconnect.md`).**
2. **Plan 115 Task 3 remainder (low).** The `cli-provider-add` spawn is fixed here; the `run-bundle`
   `.js` read, the source-scanning gate for `process.execPath` + Node-only flags, and the clean
   `bun test --timeout=0 src/__tests__/*.test.ts` run remain there. **Destination: already in
   `plans/115-Bun-Toolchain-Follow-Ups.md` Task 3, amended to record this plan's half.**
3. **Trim the double core run (medium, ~36 s).** `test:coverage` runs the core suite, then
   `coverage-summary.mjs` runs it again for the core row. Have the summary consume the first run's
   artifact (or write the row from the first command) instead of re-measuring. **Destination:
   `plans/115-Bun-Toolchain-Follow-Ups.md` Task 6.**
4. **Haul the build-race fixture onto the Bun instrument (low).** Scenario 4's coverage leaf still
   uses the retired Node flag; a `bun test --coverage` leaf would keep the fixture representative.
   **Destination: `plans/115-Bun-Toolchain-Follow-Ups.md` Task 6.**
5. **Re-add a branch floor when Bun does (low, trigger-based).** When Bun emits `BRDA`/`BRF`/`BRH`
   (or a branch column), parse them and restore a floor calibrated the same way (plan 023
   methodology); the evidence §2.5 ceiling names this path. **Destination:
   `plans/115-Bun-Toolchain-Follow-Ups.md` Task 7.**
6. **Re-measure the stage after plan 115's trims (low).** The 170 s baseline is the number to beat;
   record before/after in the same table rather than re-baselining silently. **Destination:
   `plans/115-Bun-Toolchain-Follow-Ups.md` Task 6 (measured in the same session as the trim).**
