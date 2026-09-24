# Bun Toolchain Second Trigger Follow-Ups: Branch Floor, Suite-Budget Trim, Retired-Flag Rule

Recorded from `plans/117-Bun-Toolchain-Trigger-Follow-Ups.md` Further Actions after that plan closed
all six tasks (2026-09-23): Tasks 1, 2, 3, and 5 as dated no-ops with their probes re-recorded, Tasks 4
and 6 as edits. The live items are homed here one-to-one — each task names its source item — so no
trigger from plan 117 is left as folklore. All three are trigger-gated re-probes with a defined close:
the change they name, or a dated no-op transcript naming the next trigger.

Plan 117's Further Action 4 (the two source comments that still name the retired Node coverage flag,
`src/__tests__/field-policy.test.ts:307` and `packages/prism-work/src/document-reader/__tests__/index.test.ts:23`)
is folded into Task 3, which is where a scan would have to decide about them. Further Action 5 (plan
107 Task 4's remainder: `scripts/package-truth.json` refresh, `docs/release-and-install.md` counts, the
cut-time `release:gate` run, and the changelog placement) is **not** restated here: it is already an
unchecked task in `plans/107-Behavior-And-Graft-Integration-Removals.md`, which owns its checkbox and
its remaining half.

Each task's no-op close appends its transcript next to the evidence it supersedes: Task 1 to
`docs/_evidence/phase114-bun-coverage.md` §2.8 (digest in `docs/_evidence/phase115-suite-budget.md` §17),
Task 2 to `docs/_evidence/phase115-suite-budget.md` §18, and Task 3 to the same file's §19 — so the next
owner inherits a measurement, not a wish.

## Objectives

- The branch floor returns the moment `bun test --coverage` emits real branch records, calibrated by
  plan 023's method rather than ported from the retired Node numbers — or the no-op is re-recorded with
  the next version boundary named.
- The documented suite budget stays a measured number with one source of truth: any stage addition or
  budget rise is preceded by a trim of the measured serialization, and the re-pin touches the marker and
  both doc statements in one change.
- The retired-flag scan stops being a filename allowlist the day a fifth legitimate occurrence forces
  the question, using the occurrence shapes plan 117 §16.1 enumerated instead of a second list.
- Every plan 117 trigger has an owner here (or in plan 107) with a probe command and a defined close.

## Expected Outcome

- Either `scripts/coverage-thresholds.json` carries `core.branches` plus per-package `branches` values
  (min of two back-to-back runs − 3pp, `marginPp` 3), the `branches: null` placeholders and the
  `ponytail:` ceiling comment in `scripts/coverage-summary.mjs` are gone, and `scripts/phase23-coverage.test.mjs`
  gates the branch shape — or `docs/_evidence/phase114-bun-coverage.md` §2.8 records the dated no-op, the
  unchanged lcov census, and the next boundary with `scripts/coverage-thresholds.json` byte-identical.
- Either the default suite measures under a re-pinned number after a recorded trim (marker +
  `docs/release-and-install.md` sentence/row + `docs/testing.md` table all naming the same number), or
  §18 records the three-run table, the trigger, and no edit.
- Either `scripts/phase23-coverage.test.mjs` contains one occurrence-shape rule with plan 117 §16.2's
  four carve-outs and no `NEGATIVE_ASSERTIONS` set, or §19 records the census, the trigger, and no edit.
- `plans/README.md` lists this plan, and no task here re-executes plan 117's absorbed work (the
  baselines, the capture seam, and the retired-flag inventory are current as of 2026-09-23).

## Tasks

- [x] Task 1: Restore the branch floor when the pinned Bun emits branch data (trigger-gated)
  - Acceptance Criteria:
    - Functional (source: plan 117 Further Action 1): probe first and record the transcript with the
      date. `bun --version` and `npm view bun dist-tags` establish whether the pin moved past `1.4.2`;
      then the plan 114 §2.6 probe runs unchanged: `bun test --coverage --timeout=0
      --coverage-reporter=lcov --coverage-dir=<scratch> dist/__tests__/*.test.js` (2083 pass on plan
      117's tree), `grep -c '^BR' <scratch>/lcov.info` for `BRDA`/`BRF`/`BRH`, and the default
      reporter's table header read separately because `--coverage-reporter=lcov` replaces the text
      reporter. A single branch-bearing file (`dist/__tests__/agent-approval-coverage.test.js`) is the
      control. Appended to `docs/_evidence/phase114-bun-coverage.md` §2.8, with a digest row in
      `docs/_evidence/phase115-suite-budget.md` §17.
    - Functional: if the pin is still `1.4.2` and lcov still has zero `^BR` lines and no branch column,
      the task closes as a recorded no-op: transcript, verdict, and `Trigger:` line naming
      [oven-sh/bun#7100](https://github.com/oven-sh/bun/issues/7100) plus the next version boundary —
      no flag, floor, gate, or doc change, `scripts/coverage-thresholds.json` untouched.
    - Functional: on the restore path, branch parsing lands beside `parseCoverageTable` in
      `scripts/coverage-summary.mjs` (`BRDA`/`BRF`/`BRH` pairs, `FNF`-style aggregates read the same
      way); `scripts/coverage-thresholds.json` regains `core.branches` and a per-package `branches`
      value calibrated by plan 023's method (min of two back-to-back runs − 3pp, `marginPp` 3) — never
      ported from the retired Node 75; the `branches: null` placeholders and the `ponytail:` ceiling
      comment are deleted in the same edit; `scripts/phase23-coverage.test.mjs` gates the new shape;
      `docs/testing.md` and `docs/release-and-install.md` state the floors as Bun-measured.
    - Functional: the enforcement decision from plan 114 Task 1 is unchanged — the parsed `All files`
      aggregate in `coverage-summary.mjs`, not a native `bunfig.toml` threshold — and a run with no
      branch records fails closed rather than passing vacuously (the exit-code guard stays).
    - Performance: the probe is ~36 s wall (plan 115 §14 measured 35.17 s for the same command). The
      restore adds no core-suite run: the branch numbers come from the same run the §13 capture seam
      already hands `coverage-summary.mjs` (or from a second parse of that text), so the ~137 s
      `test:coverage` stage does not grow.
    - Code Quality: one parse helper beside `parseCoverageTable`, one thresholds source, no second
      branch computation in tests, no new dependency; the ceiling comment is deleted rather than
      left contradicting the new floor.
    - Security: no threshold is raised without a fresh measured recalibration recorded in evidence; a
      below-floor branch row fails the stage and the `sdk:ready` chain; artifact tails stay redacted
      (`scripts/coverage-failure.mjs`).
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/phase114-bun-coverage.md` §2.5 (the dropped-branch ceiling and its exact
        `ponytail:` text), §2.6–§2.7 (the recorded no-op probes this task re-runs), §4 (the Task 2
        handoff for the branch disposition), §6 (the rejected directions, including porting Node's 75);
        `docs/_evidence/phase115-suite-budget.md` §14 and §17.
      - `scripts/coverage-summary.mjs` (`parseCoverageTable`, the ceiling comment),
        `scripts/coverage-thresholds.json`, `scripts/phase23-coverage.test.mjs` (the `branches: null`
        assertions), `docs/testing.md`, `docs/release-and-install.md`.
      - oven-sh/bun#7100 (`bun:test`, open, no milestone; proposed Phase 2 = lcov `BRDA`/`BRF`/`BRH`
        plus thresholds) and any v1.4.x/v1.5 release-notes item naming branch or statement coverage.
    - Options Considered:
      - Probe the `1.4.2-canary` build — rejected: a canary cannot set a floor, and plan 117 Task 1
        already rejected it on the same grounds.
      - Port the archived Node 60/70/75 floor, or keep c8/nyc — rejected: plan 114 §6 recorded both as
        REJECTED (different instrument, non-comparable numbers).
      - Set a floor from a single run — rejected: plan 023's calibration rule is the min of two
        back-to-back runs minus 3pp, and the freeze exists to absorb run-to-run wobble.
    - Chosen Approach: re-run the recorded probe at the version boundary and restore the floor only on
      live branch records, exactly the shape plan 115 Task 7 designed for this moment.
    - API Notes and Examples:
      ```bash
      bun --version && npm view bun dist-tags
      bun test --coverage --timeout=0 --coverage-reporter=lcov --coverage-dir=/tmp/bun-lcov dist/__tests__/*.test.js
      grep -c '^BR' /tmp/bun-lcov/lcov.info          # BRDA/BRF/BRH: 0 today
      node --test scripts/phase23-coverage.test.mjs   # the gate that asserts the shape
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase114-bun-coverage.md`: §2.8 append on both paths.
      - `docs/_evidence/phase115-suite-budget.md`: §17 digest row.
      - Restore path only: `scripts/coverage-summary.mjs`, `scripts/coverage-thresholds.json`,
        `scripts/phase23-coverage.test.mjs`, `docs/testing.md`, `docs/release-and-install.md`.
    - References:
      - Plan 117 Task 1's executed note (the recorded no-op and its exact probe transcript); plan 114
        Task 1 §2.5–§2.7 and §4; plan 115 Task 7's restore definition; plan 023's calibration method.
  - Test Cases to Write:
    - No-op: the transcript shows `grep -c '^BR'` = 0, the table header without a branch column, and
      the control file's `SF:` count — so a no-op is distinguishable from a skipped check.
    - Restore: `scripts/phase23-coverage.test.mjs` fails on a row below the branch floor and passes
      above it, with the artifact carrying the finite number; the thresholds JSON branch rows equal the
      recalibrated values; a run whose output carries no branch records fails closed.
    - Either path: `node --test scripts/phase23-coverage.test.mjs` and `src/__tests__/docs.test.ts`
      stay green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (contributor coverage gate and its floors only).
    - Docs pages to create/edit: `docs/testing.md` (branches in the coverage row) and
      `docs/release-and-install.md` (floor provenance sentence) on the restore path; `none` on the
      no-op path.
    - `docs/index.md` update: no (no behavior delta).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Executed 2026-09-24 — recorded no-op; evidence appended to `docs/_evidence/phase114-bun-coverage.md` §2.8 (digest in `docs/_evidence/phase115-suite-budget.md` §17). Trigger checked first and not fired: `package.json:L6` `packageManager` still `bun@1.4.2`, `bun --version` → `1.4.2`, `npm view bun dist-tags` → `latest: 1.4.2` (canary `1.4.2-canary.20260923.1` — the same 1.4.2 line, not what ships, and a canary probe cannot change a floor). Probe re-ran §2.6's command unchanged: `bun test --coverage --timeout=0 --coverage-reporter=lcov --coverage-dir=/tmp/bun-lcov-p119 dist/__tests__/*.test.js` → 2083 pass / 0 fail / 162 files, exit 0, 35.17 s reported (35.196 s wall). The lcov census is `DA:` 19436 and `FNF:`/`FNH:`/`LF:`/`LH:`/`SF:`/`TN:` 148 each with **0** `^BR`/`^BRDA:`/`^BRF:`/`^BRH:`; the default reporter's table header is still `File | % Funcs | % Lines | Uncovered Line #s` (no branch column, read separately because `--coverage-reporter=lcov` replaces the text reporter); the single branch-bearing control file (`dist/__tests__/agent-approval-coverage.test.js`, 43 pass / 0 fail, 49 `SF:`) is also 0. §2.6's and §2.7's numbers reproduce exactly. Verdict: no flag, floor, gate, threshold, or doc change — `scripts/coverage-thresholds.json`, its `branches: null` placeholders, and the `ponytail:` ceiling in `scripts/coverage-summary.mjs` stay untouched.

- [x] Task 2: Trim the suite's measured serialization and re-pin the budget in one change (trigger-gated)
  - Acceptance Criteria:
    - Functional (source: plan 117 Further Action 2): trigger first — a stage or test file joins the
      default suite (`STAGES`/`GATE_FILES` change), or two consecutive `npm test` runs exceed the pin
      minus 4 s (`< 80s` today, so > 76 s), or the documented number must rise for any other reason. If
      none fired, the task closes as a dated no-op appending the fresh three-run table to
      `docs/_evidence/phase115-suite-budget.md` §18 with the trigger re-stated and no edit.
    - Functional: the probe is plan 115 Task 1's method — three consecutive `npm test` runs with
      per-stage wall clock and exit codes, per-file gate timings from the runner's own `GATE_FILES`
      list, per-package workspace timings, `nproc`, and host load per run — starting from the targets
      plan 117 §15 measured: the gate stage's 18.634 s `phase54-legacy-registry-apply.test.mjs` and
      18.468 s `-fail-closed.test.mjs` against a 20.227 s stage wall, and the `web-tools` 5.446 s /
      `ag-ui` 5.410 s leaves that set the pool-2 critical path (serial sum 27.065 s vs 16.855–17.277 s
      stage wall).
    - Functional: the trim precedes the re-pin. A trim is a restructure — split the measured critical
      path, move work off it, or widen the pool after measuring — never a deleted or advisory gate, and
      any reverted trim records the spread that justified the revert (plan 115 §11.1's shape).
    - Functional: the re-pin is one change: the evidence marker, `docs/release-and-install.md:317`'s
      sentence and `:466`'s `budget pinned` row, and `docs/testing.md`'s stage table, with
      `src/__tests__/docs.test.ts`'s pin test green and a planted different pin failing.
    - Performance: the new number is measured, never projected; every stage keeps its current pass/fail
      set; the workspace pool widens only with a recorded run that keeps the `memory` and `prism-work`
      soft budget assertions green (plan 115 §11.2 flaked at 3–4 concurrent leaves).
    - Code Quality: no new stage abstraction, no runner rewrite, no new dependency;
      `scripts/run-all-tests.mjs` changes only if a stage or the pool bound changes, and its own test
      keeps asserting the partition, the bound, and failure propagation.
    - Security: no gate is deleted, merged, or made non-blocking to buy wall clock; a flaky stage is
      re-measured, not skipped, and `npm test`'s exit code keeps meaning what it means today.
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/phase115-suite-budget.md` §11.1–§11.4 (the trims, the pool measurement, and the
        budget decision that produced `< 80s`) and §15 (plan 117's four-run re-probe, the per-file and
        per-package tables, and the named trim targets); `docs/release-and-install.md:317`/`:466`;
        `docs/testing.md`'s stage table.
      - `scripts/run-all-tests.mjs` (`STAGES`, `GATE_FILES`, `runParallelLeaves`) and its test;
        `scripts/with-build-lock.mjs --shared`; the `ponytail:` pool ceiling comment.
    - Options Considered:
      - Raise the number first — rejected: §11.4 and the budget sentence both document measure → trim →
        re-pin, and `docs/release-and-install.md` says the next stage addition needs the trim first.
      - Delete or merge the build-race stage — rejected: it proves the reader/writer lock the workspace
        stage depends on (plan 115 §11.3).
      - Widen the workspace pool to 3–4 by preference — rejected until the 5 ms source-scan budgets are
        re-measured under load; §11.2 recorded the flakes that set the bound at 2.
      - Trim the coverage stage — rejected: it is not a `STAGES` member; its numbers belong to plan 114
        and `docs/release-and-install.md`'s separate sentence.
    - Chosen Approach: measure the current shape with plan 115 Task 1's method, trim the largest measured
      serialization, then re-pin once with the marker and both doc statements in the same change.
    - API Notes and Examples:
      ```bash
      for i in 1 2 3; do start=$(date +%s%3N); npm test > /tmp/npmtest-$i.log; \
        echo "run $i rc=$? wall=$(( $(date +%s%3N) - start ))ms"; \
        grep -A9 '^npm test summary:' /tmp/npmtest-$i.log | tail -9; done
      node scripts/with-build-lock.mjs node --test --test-reporter=junit \
        $(node -e 'import("./scripts/run-all-tests.mjs").then(m=>console.log(m.GATE_FILES.join(" ")))') > /tmp/gate.xml
      node --test scripts/run-all-tests.test.mjs && node --test scripts/plan-review-gate.test.mjs
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase115-suite-budget.md`: §18 append on both paths.
      - Trim path only: `scripts/run-all-tests.mjs` and/or `scripts/run-all-tests.test.mjs` (stage shape
        or pool bound), the split gate/workspace test file, `docs/release-and-install.md`,
        `docs/testing.md`, and `README.md` only if its scripts row names the number.
    - References:
      - Plan 117 Task 3's executed note (§15) and plan 115 Task 1's method and §11's tables; plan 057's
        retirement precedent (a trim restructures, never deletes a gate).
  - Test Cases to Write:
    - Table: the three-run stage arithmetic is reproducible from the recorded stage numbers and each
      run's wall clock; the trim's before/after rows come from the same host and flags.
    - Pin: `src/__tests__/docs.test.ts`'s budget test passes with the new marker, and a planted page
      restating a different pin fails.
    - Stage shape: `scripts/run-all-tests.test.mjs` stays green, including the gate partition, the pool
      bound, and failure propagation.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no consumer contract; the contributor test budget and possibly
      the stage shape change — a development-contract change.
    - Docs pages to create/edit: `docs/release-and-install.md` (budget sentence + requirements row) and
      `docs/testing.md` (stage table) on the trim path; `none` on the no-op path.
    - `docs/index.md` update: no (same stage list, no number on the page).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Executed 2026-09-24 — recorded no-op; fresh probe appended to `docs/_evidence/phase115-suite-budget.md` §18. Trigger checked first, neither clause fired. Clause 1: no stage or test file joined the suite — `STAGES` is the same seven stages, same order, same runners as `docs/testing.md`'s table (including the 11-leaf workspace stage at pool width 2 and the split `phase54-legacy-registry-{dry-run,apply,fail-closed}` gate files), `GATE_FILES` is still 43, and `scripts/run-all-tests.test.mjs` is 14/14. Clause 2: five consecutive `npm test` runs on 16 CPUs / Node v26.9.0 / Bun 1.4.2, exit 0 and all 7 stages green each: **77.736 s** (1.94/1.38/1.33), **73.153 s** (11.85/4.45/2.40), **73.063 s** (9.53/5.50/2.93), **73.427 s** (8.88/6.97/3.75), **74.049 s** (9.21/7.86/4.34). Only run 1 is over the 76 s line, and its excess is the gate stage alone (24.011 s vs 20.060–20.369 s in runs 2–5) with every other stage inside its spread, so no two consecutive runs exceed 76 s and the pin keeps 2.26 s of margin on the worst run. Method tables recorded: the standalone gate stage (43 `GATE_FILES`, rc 0, 271 tests = 269 pass / 2 skip / 0 fail, 21.016 s wall; top per-file `phase54-legacy-registry-apply` 19.460 s, `-fail-closed` 19.321 s, `phase23-quality-gates` 17.417 s, `sweep-unused` 15.650 s, `packaging-current` 11.975 s, `-dry-run` 10.681 s — 115.480 s over Node's pool, so the longest single file still bounds the stage) and per-package workspace timings (serial sum 30.949 s vs 17.202–17.826 s stage wall; `web-tools` 5445 ms and `ag-ui` 5409 ms are the critical path, so pool width 2 stands). Pin consistency verified unchanged: marker `pin="< 80s" baseline_s="72"`, `docs/release-and-install.md:317` sentence and `:466` row, `docs/testing.md` table, and `src/__tests__/docs.test.ts`'s pin-uniqueness test (156/156) all green. Verdict: no trim, no re-pin, no page edit — one gate-spike run is not the consecutive-run drift the trigger defines, and no new serialization appeared. **Trigger (unchanged):** a stage/test file joining the suite, or two consecutive runs over 76 s; then three-run table → trim → one re-pin of the marker and both doc statements.

- [x] Task 3: Turn the retired-flag scan into an occurrence-shape rule when a fifth file appears (trigger-gated)
  - Acceptance Criteria:
    - Functional (source: plan 117 Further Action 3): trigger first — `grep -rn --
      '--experimental-test-coverage' scripts/` shows a fifth file legitimately carrying the flag, or the
      four-name `NEGATIVE_ASSERTIONS` set in `scripts/phase23-coverage.test.mjs` would need a second
      extension (a fifth name or another exclusion pattern). Otherwise the task closes as a dated no-op
      appending the census to `docs/_evidence/phase115-suite-budget.md` §19 with the trigger re-stated.
      Today: seven entries — four negative-assertion files (5/4/1/1 lines) plus the three retired
      `phase1{3,4,5}-baseline.json` files.
    - Functional: on the rule path the scan decides by occurrence shape, not filename:
      `scripts/phase23-coverage.test.mjs` allows the flag inside an assertion needle (an
      `assert`/`match`/`includes` argument, including a multi-line `assert.ok`'s message string), a
      fixture body string, a comment, and a regex literal or keyword-list string; a flag that reaches a
      spawn argument list fails, naming the offending file. The four names in `NEGATIVE_ASSERTIONS` are
      deleted, not extended.
    - Functional: the `-baseline.json` and `freeze` exclusions stay (retired evidence is history); the
      existing positive/negative fixtures still fail and pass respectively; a planted live-spawn file in
      `scripts/` fails and is named, and removing it passes.
    - Functional: the two in-repo source comments that name the flag
      (`src/__tests__/field-policy.test.ts:307`,
      `packages/prism-work/src/document-reader/__tests__/index.test.ts:23`) are inventoried in the note —
      either the scan widens to `src/`/`packages/` source (never `dist/`, which mirrors them) and both
      are allowed as comments, or the note records why the scan stays `scripts/`-only. Plan 117 §16.1's
      per-line table is the starting inventory.
    - Performance: the scan stays one read pass over `scripts/` (3.2 ms over 190 entries today); no
      per-line regex over every file in the repository.
    - Code Quality: one rule, one comment stating why a spawn argument and an assertion needle differ,
      with plan 117 §16.2's four carve-outs named in that comment; no helper module; no second scan test.
    - Security: n/a (a test-only scan over in-repo sources; no secrets, no external paths).
  - Approach:
    - Documentation Reviewed:
      - `scripts/phase23-coverage.test.mjs` — the "retired Node coverage instrument survives only where
        it is asserted on" test, its `NEGATIVE_ASSERTIONS` set, and the `-baseline.json`/`freeze`
        exclusions; `scripts/tooling-gate.test.mjs` — the sibling rule-plus-fixtures style; the
        `scripts/phase23-build-race.test.mjs` spawn shape the scan protects.
      - `docs/_evidence/phase115-suite-budget.md` §16, §16.1 (the per-line shape table), and §16.2 (why
        the rule waits for a fifth file).
    - Options Considered:
      - Keep extending the filename allowlist — rejected: an allowlist that grows per legitimate
        occurrence is a changelog, not a rule.
      - Ban the string everywhere including negative assertions — rejected: the negative assertions are
        what keep the retirement visible and testable.
      - Move the rule into `scripts/tooling-gate.test.mjs` — rejected: that gate owns spawn shape, not
        the retired-instrument inventory; two rules in one file blur both.
      - Ship the rule now, below its trigger — rejected: §16.2 measured that the rule needs a second
        shape list about as long as the four names it replaces at today's count.
    - Chosen Approach: when the fifth file arrives, replace the filename set with an occurrence-shape
      rule carrying the four measured carve-outs, keep the baseline exclusion by name, and prove it with
      the existing fixtures plus one planted live-spawn file.
    - API Notes and Examples:
      ```js
      // rule shape: allowed as a needle, fixture, comment, or rule literal — never a spawn argument
      const ALLOWED = [
        /assert\.[a-z]+\([^)]*--experimental-test-coverage/,          // needle, incl. a message arg
        /includes\(\s*["'][^"']*--experimental-test-coverage/,        // needle
        /`[^`]*--experimental-test-coverage[^`]*`/,                   // fixture body string
        /^\s*(\/\/|\*|\/\*)/,                                          // comment
        /\/--test\\b\|--test-isolation\|--experimental-test-coverage\//, // rule regex
        /^\s*"[^"]*--experimental-test-coverage",?\s*$/,              // keyword-list string
      ];
      ```
    - Files to Create/Edit:
      - `scripts/phase23-coverage.test.mjs`: the scan test (the rule replaces `NEGATIVE_ASSERTIONS`).
      - `docs/_evidence/phase115-suite-budget.md`: §19 append on both paths.
      - Only if the scope widens: the two source comments listed in the acceptance criteria.
    - References:
      - Plan 117 Task 5's executed note and §16; `scripts/phase23-coverage.test.mjs`'s fixtures;
        `scripts/tooling-gate.test.mjs`'s rule-plus-fixtures pattern.
  - Test Cases to Write:
    - Rule: a fixture file with the flag in a spawn argument fails the scan and is named; a fixture with
      the flag only inside an assertion needle passes; one fixture per §16.1 carve-out (comment, regex
      literal, fixture body, keyword-list string, multi-line assert message) passes so the rule cannot
      regress to a bare `includes` check.
    - Planting: a violating file added to `scripts/` fails the scan, and removing it passes.
    - Exclusion: the retired `phase*-baseline.json` files stay exempt by name.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (test-only scan).
    - Docs pages to create/edit: none — no `/docs` page describes the scan's allowlist.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable (no `/docs` change).
  - Executed 2026-09-24 — recorded no-op; census appended to `docs/_evidence/phase115-suite-budget.md` §19. Trigger checked first, neither clause fired: `grep -rn -- '--experimental-test-coverage' scripts/` returns **14 lines across 7 files** — the four `NEGATIVE_ASSERTIONS` names (`phase23-coverage.test.mjs` 5 lines, `tooling-gate.test.mjs` 4, `run-all-tests.test.mjs` 1, `plan-review-gate.test.mjs` 1) plus the three retired `phase1{3,4,5}-baseline.json` files the scan exempts by name — exactly plan 117 §16's census, so there is no fifth `scripts/` file and no second allowlist extension pending. The 11 in-file lines are shape-identical to §16.1's per-line table with the same line numbers (needles at `phase23-coverage.test.mjs:81/112/237/240`, an assertion message at `:113`, a comment at `tooling-gate.test.mjs:99`, a rule regex at `:104`, a fixture body at `:130`, a needle at `:156`, a needle at `run-all-tests.test.mjs:153`, and a token-list string at `plan-review-gate.test.mjs:446`); none is a spawn argument list. Plan 117 Further Action 4's two source comments were inventoried in the same section — `src/__tests__/field-policy.test.ts:307` and `packages/prism-work/src/document-reader/__tests__/index.test.ts:23` (plus gitignored `dist/` mirrors) are the only `src/`/`packages/` occurrences and both are prose about V8 instrumentation, with no spawn carrying the flag, which is the recorded reason the scan stays `scripts/`-only. Scan green and cheap: `node --test --test-name-pattern='retired Node coverage instrument' scripts/phase23-coverage.test.mjs` 1/1 (281 ms filtered); the read pass costs 7.8 ms over 138 candidates (198 `scripts/` entries). Verdict: no edit to `scripts/phase23-coverage.test.mjs`; the `NEGATIVE_ASSERTIONS` set, the `-baseline.json`/`freeze` exclusions, and the build-race assertions stay. **Trigger (unchanged):** a fifth `scripts/` file legitimately carrying the flag, or a second allowlist extension; then the occurrence-shape rule with §16.1/§19's four carve-outs, failing any flag that reaches a spawn argument list.

## Compromises Made

- **All three tasks closed as recorded no-ops, by design.** No trigger fired on 2026-09-24: the pinned Bun is still 1.4.2 with zero lcov branch records (Task 1), the default suite held `< 80s` with no new stage or consecutive > 76 s pair (Task 2), and no fifth `scripts/` file carries the retired Node flag (Task 3). The plan's payload is the re-measured evidence and the unchanged triggers, not a speculative edit.
- **Task 2's first run overshot its own trigger line and was classified, not smoothed.** Run 1 measured 77.736 s with the gate stage alone at 24.011 s against 20.060–20.369 s in the next four runs; the standalone gate re-measure (21.016 s) confirmed an environmental spike, and no two consecutive runs exceeded 76 s. The five-run spread (73.1–77.7 s, with the pin 2.26 s above the worst run) is recorded in §18 so the thin margin stays visible.
- **Task 3 declined the shape rule on the same grounds plan 117 did.** Five of the eleven flag lines are not assert needles (comment, rule regex, fixture body, assertion message, token-list string), so the rule's carve-out list would be about as long as the four-name set it replaces; the trigger still asks for a fifth legitimate file, and §19 carries the census plus the two-comment source inventory for the day it fires.
- **Further Action 4 from plan 117 is now dispositioned, not just homed.** The two `src/`/`packages/` comments that name the flag are inventoried in §19 with the recorded reason the scan stays `scripts/`-only; nothing edits them, because they explain instrumentation behavior rather than spawn it.

## Further Actions

1. **Branch-floor restore stays the one task with a real payoff (priority: high when it fires).** Re-probe lcov the moment `packageManager` moves past `bun@1.4.2` ([oven-sh/bun#7100](https://github.com/oven-sh/bun/issues/7100)); the probe command and the restore shape (parse + `core.branches`/per-package `branches` by plan 023's min-of-two-runs − 3pp, the `phase23-coverage` gate, both doc pages) are recorded in `docs/_evidence/phase114-bun-coverage.md` §2.6 and §2.8 plus `phase115-suite-budget.md` §17. **Trigger: the next `packageManager` bump past 1.4.2, or a v1.4.x/v1.5 release-notes item naming branch/statement coverage.**
2. **Budget headroom needs a trim before the next stage lands (priority: medium).** 73.1–77.7 s against `< 80s`, trigger line 76 s: the order is §18's three-run table → trim the measured serialization → one re-pin of the marker and both doc statements. The gate stage's 19.5 s single-file critical path and the two ~5.4 s workspace leaves (`web-tools`, `ag-ui`) are the named targets. **Trigger: a stage or test file joining the suite, or two consecutive runs over 76 s.**
3. **Install the occurrence-shape scan rule when a fifth `scripts/` file legitimately carries the retired flag (priority: low).** The rule must allow the four shapes §16.1/§19 enumerate (needle, fixture body, comment, regex/list string), still fail a flag reaching a spawn argument list (naming the file), and keep the retired baselines excluded by name. **Trigger: a fifth `scripts/` file, or a second allowlist extension.**
4. **The two source comments still name the retired flag on purpose (priority: low).** `src/__tests__/field-policy.test.ts:307` and `packages/prism-work/src/document-reader/__tests__/index.test.ts:23` explain why a test tolerates V8 instrumentation; if a future scan ever wants the string gone repo-wide, §19 is the inventory and the rationale. **Trigger: a scanner asked to cover `src/`/`packages/` source.**
