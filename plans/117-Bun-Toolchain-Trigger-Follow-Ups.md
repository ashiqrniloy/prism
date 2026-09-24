# Bun Toolchain Trigger Follow-Ups: Branch Floor, Runner Split, Budget Re-Pin

Recorded from `plans/115-Bun-Toolchain-Follow-Ups.md` Further Actions after that plan's seven tasks
landed (2026-09-23). All six items are homed here one-to-one — each task names its source item — so no
trigger from plan 115 is left as folklore. Three tasks are trigger-gated re-probes (branch data,
runner split, suite budget), one is plan-text reconciliation, and two are retired-flag hygiene.

Nothing dangles behind this plan's source either: plan 113's Further Actions are homed in plans 114
and 115, and plan 114's Further Actions are homed in 115 Tasks 6–7 and
`plans/116-Acp-Durable-Cancel-Vs-Client-Disconnect.md`. When a task here closes as a no-op, its probe
transcript and the next trigger are appended to the evidence file it names, so the next owner inherits
a measurement instead of a wish.

## Objectives

- Every trigger plan 115 recorded has an owner, a probe command, and a defined close: either the
  restore/flip it names, or a dated no-op transcript with the next version boundary.
- The pinned Bun is re-probed at the next pin bump for branch data and for parallel test-file
  behaviour before any flag, floor, or stage changes — the measurement comes first, never the flag.
- The documented suite budget stays a measured number with one source of truth: a stage addition or a
  run that drifts past the pinned number minus 4 s triggers a re-measure, a trim attempt, and one
  re-pin (the machine-readable marker in the evidence file, the sentence and requirements row in
  `docs/release-and-install.md`, and `docs/testing.md`'s stage table agree).
- Plan text absorbed by another plan is pointed at from the owning plan, without rewriting evidence
  history or flipping another plan's checkbox.

## Expected Outcome

- Either `scripts/coverage-thresholds.json` carries `core.branches` and per-package `branches` again
  (calibrated by plan 023's min-of-two-runs − 3pp, never ported) with the `branches: null`
  placeholders and the `ponytail:` ceiling deleted, or `docs/_evidence/phase114-bun-coverage.md` §2.6
  gains another dated no-op naming the new version and the next trigger.
- Either a stage flips its runner or its workspace pool widens on measured wall clock with an
  identical pass/fail set, or `docs/_evidence/phase113-bun-inventory.md` §12 gains a dated no-op. In
  both cases plan 113 Task 3's invariants hold: at most one Bun stage per file set, `--timeout=0` on
  every `bun test`, every test file runs exactly once.
- `docs/_evidence/phase115-suite-budget.md`'s `<!-- budget: pin="…" baseline_s="…" -->` marker,
  `docs/release-and-install.md`'s budget sentence plus its `budget pinned` requirements row, and
  `docs/testing.md`'s stage table all name the same number, and no page restates another.
- `plans/107-Behavior-And-Graft-Integration-Removals.md` says its Task 4 was absorbed by plan 115
  Task 5 (checkbox still 107's to flip) and `plans/114-Bun-Coverage-Gate.md`'s Task 2 note points at
  the superseding section; no evidence file is rewritten to make a pointer unnecessary.
- No live `scripts/` spawn carries a retired Node-only flag, and the scan that proves it is a rule
  over occurrence shape rather than a growing filename allowlist.

## Tasks

- [x] Task 1: Restore the branch floor when the pinned Bun emits branch data (trigger-gated)
  - Acceptance Criteria:
    - Functional (source: plan 115 Further Action 1): the task first probes the pinned Bun —
      `bun --version`, `npm view bun dist-tags`, then
      `bun test --coverage --timeout=0 --coverage-reporter=lcov --coverage-dir=<scratch> dist/__tests__/*.test.js`
      followed by `grep -c '^BR'`/`^BRDA:`/`^BRF:`/`^BRH:` on the lcov and a header check on the
      default reporter's text table — and records the transcript with the date and version. The
      `--timeout=0` flag is mandatory: plan 115's probe without it timed out two tests and counted
      2069 instead of 2083.
    - Functional: if the output still carries no `BRDA`/`BRF`/`BRH` and the text table has no branch
      column, the task closes as a recorded no-op: the probe, the verdict, and a `Trigger:` line (the
      upstream tracker plus the next version boundary) are **appended** to
      `docs/_evidence/phase114-bun-coverage.md` §2.6, and no flag, floor, gate, or doc changes.
    - Functional: if branch data exists, `scripts/coverage-summary.mjs` parses it (the text column
      when present, else the lcov `BRF`/`BRH` pair) beside `parseCoverageTable` and
      `scripts/coverage-thresholds.json` regains `core.branches` plus per-package `branches`,
      calibrated by plan 023's method (min of two back-to-back runs − 3pp) — never ported from the
      retired 75; the `branches: null` placeholders and the `ponytail:` ceiling note are deleted in
      the same edit.
    - Functional: `scripts/phase23-coverage.test.mjs` gates the branch number again (finite, above
      the floor, present in the artifact), and `docs/release-and-install.md`'s coverage row and
      `docs/testing.md`'s gate note name the branch floor in the same change.
    - Performance: the no-op path costs one probe (~36 s wall clock on the current tree, 35.60 s
      measured); if the parse lands, the lcov write's added seconds are measured and recorded, and the
      text-table instrument stays the default unless the branch number requires lcov.
    - Code Quality: the parse is one small pure function beside `parseCoverageTable`; nothing else
      grows, and the null placeholder plus its ceiling comment are the only deletions.
    - Security: the parse reads the same in-repo `coverage/` output; no path leaves the repo, and
      redaction is verified unchanged (lcov records file paths; a fixture proves no secret-shaped
      value is copied into the artifact).
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/phase114-bun-coverage.md` §2.5 (the ceiling and the `ponytail:` marker) and
        §2.6 (plan 115 Task 7's dated no-op probe this task appends to); §1.4/§2.4 — the parsed-table
        gate decision.
      - `scripts/coverage-summary.mjs` — `parseRun`/`parseCoverageTable`, the core row, and the
        `branches: null` shape; `scripts/coverage-thresholds.json` — the `core` and per-package rows;
        `scripts/phase23-coverage.test.mjs` — the null-case assertions.
      - Plan 023's floor method (`docs/_evidence/phase23-*`, the recapture rule in
        `docs/release-and-install.md`); Bun's coverage docs for `--coverage-reporter` and the text
        table's columns.
    - Options Considered:
      - Add the lcov writer now so the number is "available" — rejected: 0 branch records in 148
        files of real lcov output on 1.4.2, so it is a flag with no number and a slower spawn.
      - Gate branches from a third-party reporter — rejected: no new dependency for a number the
        pinned runner does not emit.
      - Leave the ceiling note and never revisit — rejected: that is exactly the folklore plan 115
        Task 7 replaced with a named trigger.
      - Probe every release without a pin bump — rejected: the pinned binary is what ships to
        contributors, and a canary probe cannot change a floor.
    - Chosen Approach: probe first at the pin bump, then either a dated no-op append or the full
      restore (parse + floors + gate + docs) in one change.
    - API Notes and Examples:
      ```bash
      bun --version && npm view bun dist-tags --json          # pinned vs published
      bun test --coverage --timeout=0 --coverage-reporter=lcov --coverage-dir=/tmp/bun-lcov-p dist/__tests__/*.test.js
      grep -c '^BR' /tmp/bun-lcov-p/lcov.info                 # 0 today: no BRDA/BRF/BRH
      # the lcov reporter REPLACES the text reporter; check the table separately
      bun test --coverage --timeout=0 dist/__tests__/index.test.js 2>&1 | grep -E 'File.*Funcs'
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase114-bun-coverage.md`: §2.6 append (probe, verdict, `Trigger:`, date).
      - `scripts/coverage-summary.mjs`, `scripts/coverage-thresholds.json`,
        `scripts/phase23-coverage.test.mjs`: only if the parse and floors land.
      - `docs/release-and-install.md`, `docs/testing.md`: only if a branch floor lands.
    - References:
      - Plan 115 Task 7 note and Further Action 1; plan 114 Further Action 5; plan 023's recapture
        method; `oven-sh/bun#7100` (open, `enhancement`/`bun:test`, no milestone — its proposed
        Phase 2 is lcov `BRDA`/`BRF`/`BRH` plus thresholds).
  - Test Cases to Write:
    - Probe: the recorded transcript shows the actual `grep -c '^BR'` result and the pinned version,
      so a no-op is distinguishable from a skipped check.
    - Parse (only if it lands): a fixture lcov with known `BRF`/`BRH` yields the expected percentage;
      a fixture without branch records still yields `branches: null` rather than 100 or NaN.
    - Gate (only if it lands): `phase23-coverage` fails on a row below the branch floor and passes
      above it, with the artifact carrying the finite number.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no consumer contract; the contributor coverage gate and its
      floors change only on the restore branch.
    - Docs pages to create/edit: the evidence append on the no-op path; `docs/release-and-install.md`
      and `docs/testing.md` only if the branch floor lands.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Executed 2026-09-23 — recorded no-op; evidence appended to `docs/_evidence/phase114-bun-coverage.md` §2.7, under §2.6's own trigger (the pin had not moved). Probe: `package.json:L6` `packageManager` still `bun@1.4.2`, `bun --version` → `1.4.2`, `npm view bun dist-tags` → `latest: 1.4.2` (canary `1.4.2-canary.20260922.1` — the same 1.4.2 line, not what ships, and a canary probe cannot change a floor). `bun test --coverage --timeout=0 --coverage-reporter=lcov --coverage-dir=/tmp/bun-lcov-p117 dist/__tests__/*.test.js` → 2083 pass / 0 fail / 162 files, exit 0, 35.195 s wall (35.17 s reported); the lcov prefix census is `DA:` 19436 and `FNF:`/`FNH:`/`LF:`/`LH:`/`SF:`/`TN:` 148 each with **0** `^BR`/`^BRDA:`/`^BRF:`/`^BRH:`; the default reporter's header is still `File | % Funcs | % Lines | Uncovered Line #s`; the single branch-bearing file (`dist/__tests__/agent-approval-coverage.test.js`, 43 pass, 49 `SF:`) is also 0. Verdict: no flag, floor, gate, threshold, or doc change — `scripts/coverage-thresholds.json`, its `branches: null` placeholders, and the `ponytail:` ceiling in `scripts/coverage-summary.mjs` stay untouched. **Trigger (unchanged):** re-probe at the next `packageManager` bump past 1.4.2; tracker [oven-sh/bun#7100](https://github.com/oven-sh/bun/issues/7100) (open, no milestone, proposed Phase 2 = lcov `BRDA`/`BRF`/`BRH` + thresholds).

- [x] Task 2: Re-measure the Bun/Node runner split at the next pinned-Bun boundary (trigger-gated)
  - Acceptance Criteria:
    - Functional (source: plan 115 Further Action 2): the task first probes the pinned Bun for
      parallel test-file execution and for path-based file resolution (`bun test --help`, `bun
      --version`, the pinned line's release notes) and records the transcript in
      `docs/_evidence/phase113-bun-inventory.md` §12 (append-only) with the date and version.
    - Functional: if the pinned version's behaviour is unchanged, the task closes as a recorded
      no-op — no code change, no speculative `--parallel`/`--concurrency` flag added to any script,
      and the note names the triggers to watch plus the next version boundary.
    - Functional: if a stage can flip, the task re-runs plan 113 §10's revert table on the same tree
      (root `dist/__tests__/*.test.js`, root source glob, whole `prism-core` workspace glob, SQLite
      set) with ≥2 runs per candidate and a same-session Node baseline, and flips only the stages
      whose wall clock improves while the pass/fail set is identical to Node's. Two specifics must be
      re-probed rather than assumed: whether Bun still resolves a file argument by path suffix (the
      `zz-collide` repro — `dist/__tests__/{content,schema}.test.js` also matching workspace files),
      and whether the workspace pool can widen past its current bound of 2 with the
      `memory`/`prism-work` 5 ms source-scan budgets measured under load.
    - Functional: any flip keeps plan 113 Task 3's invariants (one Bun stage per file set, every file
      exactly once, `--timeout=0` on every `bun test`), updates `docs/testing.md`'s stage table only
      where the runner or width changed, and records the measurement in the evidence file.
    - Performance: wall clock, same host, ≥2 runs per candidate, host load stated; a widened pool is
      kept only if it improves beyond run-to-run variance and survives ≥3 consecutive green stage
      runs (the plan 115 Task 4 flake was one run in six at load 5.97).
    - Code Quality: no flag lands without a flip; if the pool bound changes, the fixed constant keeps
      its `ponytail:` comment naming the ceiling and the upgrade path.
    - Security: the re-measured Bun runs use the default suite's environment hygiene (the
      `NODE_TEST_*` strip unchanged; no invented `BUN_*` strip — plan 113 §1.5 measured none).
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/phase113-bun-inventory.md` §4/§10 (the revert table, the single-process
        explanation) and §12 (plan 115 Task 4's measured no-flip: path-suffix matching, the
        reverted `prism-core` leaf, the pool spread).
      - `scripts/run-all-tests.mjs` `STAGES` and the workspace pool; `scripts/run-all-tests.test.mjs`
        partition and stage-shape assertions; `docs/testing.md` stage table.
      - Bun's test-runner docs for `--parallel`/`--isolate`/`--shard` on the pinned line.
    - Options Considered:
      - Flip the root stage now on the measured speed — rejected: Bun is faster (11.9–12.9 s vs Node
        13.7–14.0 s) but path-suffix matching breaks the every-file-exactly-once partition.
      - Widen the pool now — rejected: the last attempt at 3–4 flaked on timing-sensitive package
        budgets, and a flaky stage is worse than a slower one.
      - Skip the re-measure — rejected: the classification is a measurement with an expiry date, and
        plan 115 recorded the triggers precisely so this task exists.
    - Chosen Approach: probe, then either flip on evidence or record a dated no-op; re-probe the two
      named specifics (path-suffix resolution, pool width) before touching any flag.
    - API Notes and Examples:
      ```bash
      bun test --help | grep -iE 'parallel|isolate|concurren|worker'
      # path-suffix collision repro (plan 115 Task 4): same-suffix vs different-suffix control
      bun test --parallel=8 dist/__tests__/zz-collide.test.js; bun test --parallel=8 dist/__tests__/zz-collide2.test.js
      # pool width: the stage's own `concurrency` bound (2 today, with its ponytail: comment)
      node -e 'import("./scripts/run-all-tests.mjs").then(m=>console.log(m.STAGES.find(s=>s.name==="workspace suites").concurrency))'
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase113-bun-inventory.md`: §12 append (probe, verdict, date) on the no-op
        path; the flip measurement otherwise.
      - `scripts/run-all-tests.mjs` and `scripts/run-all-tests.test.mjs`: only if a flip or a pool
        width change lands.
      - `docs/testing.md`: only if the stage table's runner or width text changes.
      - `packages/prism-core/package.json`: only if the workspace leaf flip is re-adopted with
        measured stage-level gain.
    - References:
      - Plan 115 Task 4 note and Further Action 2; plan 113 Task 3's partition rule; plan 113 §10's
        revert table.
  - Test Cases to Write:
    - Probe: the recorded transcript shows the flag search's actual output on the pinned version and
      the path-collision result, so a no-op is distinguishable from a skipped check.
    - Partition (on a flip): every test file still runs exactly once across the Bun and Node stages,
      and the one-Bun-stage-per-file-set rule still holds.
    - Pool (on a width change): the bound and failure-propagation assertions still hold, and the
      widened pool passes three consecutive stage runs without a budget flake.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no, unless a stage flips (then the contributor test contract
      changes and the stage table is the record).
    - Docs pages to create/edit: `docs/testing.md` only on a flip; otherwise the evidence append.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Executed 2026-09-23 — recorded no-op; probe and verdict appended to `docs/_evidence/phase113-bun-inventory.md` §12.1, under §12's own pinned-version trigger (the pin had not moved). Probed the pinned Bun: `package.json:L6` `packageManager` still `bun@1.4.2`, `bun --version` → `1.4.2`, `npm view bun dist-tags` → `latest: 1.4.2` (canary `1.4.2-canary.20260923.1` — the same 1.4.2 line, not what ships). `bun test --help` flag set unchanged (`--parallel`, `--isolate`/`--no-isolate`, `--parallel-delay`, `--shard`, `--timings`/`--update-timings`, `--max-concurrency`); `zz-collide` repro re-run: `bun test dist/__tests__/zz-collide.test.js` → 2 tests / 2 files (root-collide + `packages/hooks/dist/__tests__/zz-collide.test.js` pkg-collide) versus `node --test` → 1 test / 1 file, and the different-suffix control runs 1 file only; suffix twins re-enumerated at 2 of 160 (`content.test.js` → mcp, `schema.test.js` → hooks), the whole 2069 → 2083 gap; workspace pool bound still 2 (fixed constant with its `ponytail:` comment), stage runners unchanged (root suites node, sqlite suites node + `--timeout=0`, workspace leaves bun). Verdict: no `--parallel`/`--concurrency` flag added, `scripts/run-all-tests.mjs`, `scripts/run-all-tests.test.mjs`, and `docs/testing.md` untouched. Wall-clock candidates were not re-timed — an unchanged binary cannot change a runner, and §12's table is the measurement of record. **Triggers (unchanged):** (1) Bun changing argument→suffix matching, (2) a change to the workspace pool or the memory/prism-work real-time budgets, (3) the next pinned-version boundary (`packageManager`/`bun-version` off `1.4.2`, 1.5.x release notes).

- [x] Task 3: Re-pin the suite budget when a stage lands or a run drifts past the pin (trigger-gated)
  - Acceptance Criteria:
    - Functional (source: plan 115 Further Action 3): the task triggers when a new stage or test file
      joins the default suite, or when two consecutive `npm test` runs measure more than the pinned
      number minus 4 s (`< 80s` today, so > 76 s), and it starts by recording the three-run stage
      table using plan 115 Task 1's method (per-stage wall clock, per-file gate timings from the
      runner's own `GATE_FILES` list, per-package workspace timings) plus the host CPU count.
    - Functional: the measured serialization is trimmed before the number is raised — the order
      (measure, split or parallelize one measured serialization, re-pin) is the one plan 115 Task 2
      established, and a raise without a trim attempt in the same note is not acceptable.
    - Functional: exactly one number is pinned: the `<!-- budget: pin="…" baseline_s="…" -->` marker
      in `docs/_evidence/phase115-suite-budget.md`, the `pinned at **…** with a measured local
      baseline of **~…s**` sentence plus the `budget pinned` requirements row in
      `docs/release-and-install.md`, and `docs/testing.md`'s stage table agree;
      `src/__tests__/docs.test.ts`'s stale-pin check stays green, and the evidence file remains the
      only page allowed to narrate older numbers.
    - Functional: the stage table in `docs/testing.md` matches `scripts/run-all-tests.mjs`'s `STAGES`
      exactly (names, order, runner per stage) and the budget sentence keeps the stage breakdown that
      produced the number.
    - Performance: before/after twice, per stage, with the trim's gain separated from run-to-run
      variance; any stage that does not improve beyond its spread is reverted and the residue is
      absorbed by the re-pin, not by leaving a slower stage in place.
    - Code Quality: no new dependency, no runner abstraction; every deliberate simplification (fixed
      worker count, fixed pool bound) carries a `ponytail:` comment naming the ceiling.
    - Security: the evidence file carries no credentials, no `PRISM_*` secret values, and no absolute
      home paths; if the workspace stage changes, the reader/writer exclusion proof stays green.
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/phase115-suite-budget.md` §11 (plan 115 Task 2's before/after table and the
        budget marker) and §13 (the coverage stage's re-measured ~137 s, which is not a default-suite
        stage); `src/__tests__/docs.test.ts`'s budget-marker test.
      - `scripts/run-all-tests.mjs` `STAGES`/`GATE_FILES` and the pool; `docs/testing.md` stage table;
        `docs/release-and-install.md:317` (budget sentence) and its requirements row.
      - `scripts/with-build-lock.mjs` — the shared/exclusive protocol any workspace-stage change must
        preserve.
    - Options Considered:
      - Raise the number first and trim later — rejected: that is the drift plan 115 removed, and the
        docs test now pins one number precisely so a silent raise is visible.
      - Trim opportunistically without a stage table — rejected: the last trim's target was found by
        per-file and per-package measurement, not by reading the runner.
      - Leave the budget at `< 80s` and let a stage overrun it — rejected: a pinned budget every run
        violates stops being a gate.
    - Chosen Approach: measure the stage table, trim the measured serialization, then re-pin the
      marker and both doc statements in one change with the before/after table recorded.
    - API Notes and Examples:
      ```bash
      # three-run stage table, then per-file gate timings over the runner's own list
      for i in 1 2 3; do /usr/bin/time -f '%e s' node scripts/run-all-tests.mjs; done
      node --test --test-reporter=spec $(node -e 'import("./scripts/run-all-tests.mjs").then(m=>console.log(m.STAGES.find(s=>s.name==="gate suites").args.filter(a=>a.endsWith(".test.mjs")).join(" ")))') | grep -aE '^(✔|✖) '
      # the single pinned number and its machine-readable marker
      grep -n 'budget: pin=' docs/_evidence/phase115-suite-budget.md
      node --test --test-name-pattern='offline test budget is pinned once' src/__tests__/docs.test.ts
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase115-suite-budget.md`: new section with the stage table, the trim
        decision, the before/after runs, and the updated `<!-- budget: … -->` marker.
      - `docs/release-and-install.md`: the budget sentence and the `budget pinned` requirements row.
      - `docs/testing.md`: the stage table (and the budget sentence if it names the number).
      - `scripts/run-all-tests.mjs`, `scripts/run-all-tests.test.mjs`: only if the trim changes a
        stage or the pool bound.
      - `README.md`: only if its scripts row names the budget.
    - References:
      - Plan 115 Task 2 note and Further Action 3; plan 115 Task 1's measurement method and §11's
        table; plan 057's retirement precedent (trim means restructure, never delete a gate).
  - Test Cases to Write:
    - Pin: `docs.test.ts`'s budget test passes with the new marker, and a planted page restating a
      different pin fails (the stale-pin probe).
    - Stage table: `docs/testing.md`'s rows equal `STAGES` in name, order, and runner.
    - Trim: the before/after table's arithmetic is reproducible from the recorded stage and per-file
      numbers, and any reverted stage shows the spread that justified the revert.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no consumer contract; the contributor test budget and possibly
      the stage shape change — a development-contract change.
    - Docs pages to create/edit: `docs/release-and-install.md` (budget sentence + requirements row),
      `docs/testing.md` (stage table), `docs/_evidence/phase115-suite-budget.md` (new section +
      marker), `README.md` only if its scripts row names the budget.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Executed 2026-09-23 — recorded no-op; probe, stage table, and verdict appended to `docs/_evidence/phase115-suite-budget.md` §15. Trigger checked first: no stage or test file joined the suite (`STAGES` is the same seven stages, same order, same runners as `docs/testing.md`'s table; `scripts/run-all-tests.test.mjs` 14/14), and no two consecutive runs exceeded the 76 s line — four consecutive `npm test` runs on 16 CPUs, exit 0 and all 7 stages green each: **70.724 s** (load 0.76/0.69/1.10), **71.791 s** (10.34/3.41/2.01), **76.450 s** (10.01/4.93/2.65), **74.277 s** (9.31/6.78/3.59). Run 3 is the only one over the line, by 0.45 s, and the excess is the gate stage alone (24.406 s vs 19.205/19.347/20.870 s) at a 1-minute load of 13.71 — a host spike, not a suite change; run 1 and run 2 reproduce plan 115's 71.690/73.890 baseline. Method tables recorded: the standalone gate stage (43 `GATE_FILES`, rc 0, 271 tests = 269 pass / 2 skip / 0 fail, 20.227 s wall; top per-file `phase54-legacy-registry-apply` 18.634 s, `-fail-closed` 18.468 s, `phase23-quality-gates` 16.809 s, `sweep-unused` 14.975 s, `packaging-current` 12.058 s, `-dry-run` 10.720 s — 112.5 s over Node's pool, so the longest single file still bounds the stage) and per-package workspace timings (serial sum 27.065 s vs 16.855–17.277 s stage wall; `web-tools` 5.446 s and `ag-ui` 5.410 s are the critical path, so pool width 2 stands). Pin consistency verified unchanged: marker `pin="< 80s" baseline_s="72"`, `docs/release-and-install.md:317` sentence and `:466` row, `docs/testing.md` table, and `src/__tests__/docs.test.ts`'s pin-uniqueness test all green in this session. Verdict: no trim, no re-pin, no page edit — `< 80s` held on every run, and one load-explained over-threshold run is not the two-consecutive-run drift the trigger defines. **Trigger (unchanged):** a stage/test file joining the suite, or two consecutive runs over 76 s; then three-run table → trim → one re-pin of the marker and both doc statements.

- [x] Task 4: Reconcile the absorbed plan text (plan 107 Task 4, plan 114 Task 2's note)
  - Acceptance Criteria:
    - Functional (source: plan 115 Further Action 4):
      `plans/107-Behavior-And-Graft-Integration-Removals.md` records in its Task 4 area that plan 115
      Task 5 absorbed the compat-baseline regeneration (3 baseline files, +29/−127, reviewed as a set;
      106 removals attributed to plan 107 Tasks 2–3, 21 changed signature lines inherited from plans
      108/109/110; evidence in `docs/_evidence/phase115-suite-budget.md` §12) — and its Task 4
      checkbox stays 107's to flip, not this plan's.
    - Functional: `plans/114-Bun-Coverage-Gate.md`'s Task 2 note gains a one-line pointer to
      `docs/_evidence/phase115-suite-budget.md` §13, which supersedes its description of the coverage
      stage's double core run. The note is a pointer only: the file is evidence history and is not
      rewritten to erase the pre-§13 design.
    - Functional: `plans/README.md`'s rows for plans 107 and 114 read correctly after the edit (107
      still `planned (deferred from 0.10.0)` with its Task 4 noted as absorbed; 114 unchanged).
    - Functional: no other plan text, checkbox, or evidence file is touched, and no task in this plan
      re-executes the absorbed work (the baselines are current — verified by the gate-suite test
      `scripts/release-gate.test.mjs`'s compat-baseline currency case).
    - Performance: n/a (plan text only).
    - Code Quality: pointers, not rewrites; each edit names the absorbing plan, the task, and the
      evidence section, so a reader can audit the claim in one hop.
    - Security: n/a (no code, no credentials, no baselines edited).
  - Approach:
    - Documentation Reviewed:
      - `plans/107-Behavior-And-Graft-Integration-Removals.md` Task 4 (acceptance, `--update-baseline`
        path) and its checkbox state; `plans/114-Bun-Coverage-Gate.md` Task 2's inline note.
      - `docs/_evidence/phase115-suite-budget.md` §12 (the attribution table and the preflight
        limitation) and §13 (the coverage-stage seam); `plans/README.md` index rows.
      - `.agents/skills/create-plan/SKILL.md` — the compat-baseline rule plan 083/084/115 all cite.
    - Options Considered:
      - Flip plan 107's Task 4 checkbox here — rejected: the checkbox is the owning plan's record of
        its own execution, and flipping it from another plan hides who did the work.
      - Rewrite plan 114 Task 2's note to describe the seam — rejected: evidence files and executed
        task notes are history; the superseding section is the record.
      - Do nothing and rely on the Further Actions text — rejected: that is the state this task
        exists to fix, and plan 115 Further Action 4 named it.
    - Chosen Approach: two pointer edits plus an index check, with the audit trail named inline.
    - API Notes and Examples:
      ```bash
      grep -n 'absorbed' plans/107-Behavior-And-Graft-Integration-Removals.md
      grep -n 'phase115-suite-budget.md §13' plans/114-Bun-Coverage-Gate.md
      node --test scripts/release-gate.test.mjs   # compat-baseline currency stays green
      ```
    - Files to Create/Edit:
      - `plans/107-Behavior-And-Graft-Integration-Removals.md`: Task 4 absorption pointer.
      - `plans/114-Bun-Coverage-Gate.md`: Task 2 note pointer to §13.
      - `plans/README.md`: only if a row becomes misleading after the edits.
    - References:
      - Plan 115 Task 5 note and Further Action 4; plan 084 Task 8 (the inherited-drift absorption
        precedent); `scripts/release-gate.test.mjs`'s compat-baseline currency case.
  - Test Cases to Write:
    - Pointer: a grep-based check that each owning plan names the absorbing plan, task, and evidence
      section (both pointers present, and plan 107's Task 4 checkbox still unchecked).
    - Index: `src/__tests__/docs.test.ts`'s "plans index links every active numbered plan" stays
      green, and `scripts/plan-review-gate.test.mjs`'s existing plan 114/115 blocks are unchanged.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (plan text only).
    - Docs pages to create/edit: none — `plans/` is not `/docs`.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable (no `/docs` change).
  - Executed 2026-09-23 — both pointers landed, no absorbed work re-executed. `plans/107-Behavior-And-Graft-Integration-Removals.md` Task 4 already carried plan 115 Task 5's "Absorbed 2026-09-23" note (it names the absorbing plan and task, the three regenerated baseline files, the set comparison, the attribution, and `docs/_evidence/phase115-suite-budget.md` §12); this task completed it against the acceptance wording by adding the line-level counts — "+29/−127 lines" (`git diff --numstat`: 17/62, 0/58, 12/7) and "the 21 changed signature lines (7/0/14) are inherited from plans 108/109/110" — so the claim is auditable in one hop. Its Task 4 checkbox is still `- [ ]` (107's to flip), and `scripts/package-truth.json` / `docs/release-and-install.md` / the cut-time `release:gate` run stay named as 107's own remainder. `plans/114-Bun-Coverage-Gate.md`'s Task 2 note (the Compromises bullet that describes the stage running the core suite twice) gained one superseding line: "**Superseded 2026-09-23 (plan 115 Task 6):** `docs/_evidence/phase115-suite-budget.md` §13 fused the two core runs through a capture seam — 169.7 / 170.2 / 175.8 s → 136.8 / 137.1 s, ~34.7 s recovered, core row and workspace rows unchanged — so the stage no longer re-measures the core suite; this bullet stays as the pre-§13 record" — a pointer, not a rewrite; its §7.2 table and the evidence file are untouched history. `plans/README.md`'s 107 row notes the absorption ("Task 4's baseline half was absorbed 2026-09-23 by plan 115 Task 5 (three baseline files regenerated, +29/−127 lines, every removal attributed; the checkbox stays 107's to flip…)") with its status cell still `planned (deferred from 0.10.0)`; the 114 row is unchanged (`complete (2026-09-23)`). No other plan text, checkbox, or evidence file was touched (the other dirty `plans/` and `docs/_evidence/` entries pre-date this task), and the baselines are current — `scripts/release-gate.test.mjs`'s compat-baseline currency case passes 1/1, so nothing here re-runs the absorbed regeneration. **Checks:** an 11-point grep check (each pointer names absorbing plan, task, and evidence section; 107's Task 4 still unchecked; both README rows correct) passes; `src/__tests__/docs.test.ts`'s "plans index links every active numbered plan" 1/1; `scripts/plan-review-gate.test.mjs` 10/10 with its plan 114/115 blocks unchanged.

- [x] Task 5: Turn the retired-flag scan into a rule instead of an allowlist (trigger-gated)
  - Acceptance Criteria:
    - Functional (source: plan 115 Further Action 5): the task triggers when a fifth `scripts/` file
      legitimately contains `--experimental-test-coverage` (today's scan allowlists exactly four
      negative-assertion files plus the retired `phase1{3,4,5}-baseline.json` evidence) or when the
      allowlist would need a second extension for any reason.
    - Functional: `scripts/phase23-coverage.test.mjs`'s scan decides by occurrence shape — the flag is
      allowed only inside a string that is an assertion needle or a fixture (for example an
      `assert`/`match`/`includes` argument or a test fixture body) — while a flag that reaches a spawn
      argument list still fails, with the file that contains it named in the failure message.
    - Functional: the four currently allowlisted files pass without being named individually, the
      retired baselines stay excluded by name (they are evidence history), and the existing
      positive/negative fixtures still fail and pass respectively.
    - Performance: the scan stays a single pass over `scripts/` with no measurable cost change
      (currently ~4 ms over ~81 entries).
    - Code Quality: one rule, one comment explaining why a spawn argument and an assertion needle are
      different; the filename allowlist is deleted, not extended, and no helper module is introduced
      for it.
    - Security: n/a (a test-only scan over in-repo sources; no secrets, no external paths).
  - Approach:
    - Documentation Reviewed:
      - `scripts/phase23-coverage.test.mjs` — the "retired Node coverage instrument survives only
        where it is asserted on" test, its `NEGATIVE_ASSERTIONS` set, and the
        `-baseline.json`/`freeze` exclusions.
      - `scripts/phase23-build-race.test.mjs` — the Bun coverage leaf whose spawn shape the scan
        protects; `scripts/tooling-gate.test.mjs` — the sibling source-scanning rule
        (`process.execPath` + Node-only flags) whose fixture style this rule should follow.
    - Options Considered:
      - Keep extending the allowlist — rejected: an allowlist that grows per legitimate occurrence
        stops being a rule and becomes a changelog.
      - Ban the string everywhere including negative assertions — rejected: the negative assertions
        are what keep the retirement visible and testable.
      - Move the rule into `tooling-gate.test.mjs` — rejected: that gate owns spawn shape, not the
        retired-instrument inventory; two rules in one file would blur both.
    - Chosen Approach: replace the filename set with an occurrence-shape rule, keep the baseline
      exclusion, and prove the rule with the existing fixtures plus one planted live-spawn file.
    - API Notes and Examples:
      ```js
      // rule shape: allowed as a needle, never as a spawn argument
      const offenders = files.filter(({ text }) =>
        text.includes(FLAG) && !/assert\.[a-z]+\([^)]*--experimental-test-coverage|includes\(\s*["'][^"']*--experimental-test-coverage/.test(text));
      ```
    - Files to Create/Edit:
      - `scripts/phase23-coverage.test.mjs`: the scan test (rule replaces `NEGATIVE_ASSERTIONS`).
    - References:
      - Plan 115 Task 6 note and Further Action 5; `scripts/phase23-coverage.test.mjs`'s existing
        fixtures; `scripts/tooling-gate.test.mjs`'s rule-plus-fixtures pattern.
  - Test Cases to Write:
    - Rule: a fixture file with the flag in a spawn argument fails the scan; a fixture with the flag
      only inside an assertion needle passes; a planted violating file in `scripts/` fails and is
      named, and removing it passes.
    - Exclusion: the retired `phase*-baseline.json` evidence files stay exempt by name.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (test-only scan).
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable (no `/docs` change).
  - Executed 2026-09-23 — recorded no-op; evidence appended to `docs/_evidence/phase115-suite-budget.md` §16. Trigger checked first, both clauses false: `grep -rn -- '--experimental-test-coverage' scripts/` returns seven entries — five in `scripts/phase23-coverage.test.mjs`, four in `scripts/tooling-gate.test.mjs`, one each in `scripts/run-all-tests.test.mjs` and `scripts/plan-review-gate.test.mjs`, plus the three retired `phase1{3,4,5}-baseline.json` files the scan excludes by name — so there is no fifth `scripts/` file and no allowlist extension pending (the `NEGATIVE_ASSERTIONS` set has been four names since plan 115 Task 6 landed the scan; the sibling `freeze` filter matches no flag-carrying entry). The four files' 11 in-file lines were then classified by occurrence shape, and none is a spawn argument list: six assertion needles (`assert.ok(!… includes(…)` at `phase23-coverage.test.mjs:81/112/237/240`, `tooling-gate.test.mjs:156`, `run-all-tests.test.mjs:153`), one multi-line `assert.ok`'s message string (`phase23-coverage.test.mjs:113`), one comment (`tooling-gate.test.mjs:99`), one rule regex (`tooling-gate.test.mjs:104`'s `NODE_ONLY`), one fixture body string (`tooling-gate.test.mjs:130`'s `spawnSync(process.execPath, […])`), and one plan-113 keyword-list entry (`plan-review-gate.test.mjs:446`). Five of those eleven are not the assert-needle shape the task's example rule matches, so the rule would need a second shape list (comment, regex literal, fixture body, list string) about as long as the four-name set it replaces — recorded as the reason the rewrite waits for the fifth file instead of landing on principle. Scan unchanged and green: `node --test --test-name-pattern='retired Node coverage instrument' scripts/phase23-coverage.test.mjs` 1/1 (suite 14/14), one read pass over the 190 `scripts/` entries costs 3.2 ms. Verdict: no edit to `scripts/phase23-coverage.test.mjs`; allowlist, baseline exclusion, and the build-race assertions stay. **Trigger (unchanged):** a fifth `scripts/` file legitimately carrying the flag, or a second allowlist extension; then the rule must allow the four shapes above (needle, fixture body, comment, regex/list string) and still fail a flag reaching a spawn argument list, naming the offending file, with the retired baselines excluded by name.

- [x] Task 6: Drop the retired Node coverage flag from `docs/testing.md`'s Node-only-flag bullet
  - Acceptance Criteria:
    - Functional (source: plan 115 Further Action 6): `docs/testing.md`'s nested-runner bullet names
      only flags a live spawn uses (`--test`, `--test-isolation=none`) or states the rule generically
      ("a Node-only test flag such as `--test`"), so the retired `--experimental-test-coverage` no
      longer reads as if something spawns it. The rule sentence itself (a child carrying a Node-only
      flag spawns `node` by name) stays.
    - Functional: the task records a grep result showing where the retired string still appears
      (four negative-assertion test files plus the retired `phase1{3,4,5}-baseline.json` evidence, and
      `docs/_evidence/` history) and confirms no `/docs` page outside evidence names it.
    - Functional: `scripts/tooling-gate.test.mjs`'s spawn-shape scan still passes (it reads source,
      not docs), and `src/__tests__/docs.test.ts`'s phrase checks for `docs/testing.md` stay green.
    - Performance: n/a (one sentence).
    - Code Quality: the bullet keeps its one-sentence rule plus the reason; no second paragraph, no
      new page.
    - Security: n/a (documentation only).
  - Approach:
    - Documentation Reviewed:
      - `docs/testing.md` — the nested-runner bullet and the stage table it sits beside; plan 115
        Task 6's note (the flag's remaining occurrences).
      - `scripts/tooling-gate.test.mjs` — the rule the bullet describes, to keep the wording aligned
        with the code that enforces it.
    - Options Considered:
      - Leave it: the flag is still Node-only, so the sentence is not wrong — rejected as residue:
        after plan 115 Task 6 nothing spawns it, and a doc naming an unused flag invites a copy.
      - Delete the whole bullet — rejected: the rule is live (the `--test` spawns exist).
      - Move the mention into `docs/_evidence/` — rejected: evidence already records the retirement;
        the page needs no pointer to a flag nothing uses.
    - Chosen Approach: one-sentence edit keeping the rule, with the grep result recorded in this
      task's note.
    - API Notes and Examples:
      ```bash
      grep -rn -- '--experimental-test-coverage' docs/ scripts/ src/ packages/ | grep -v '^docs/_evidence/'
      node --test scripts/tooling-gate.test.mjs
      ```
    - Files to Create/Edit:
      - `docs/testing.md`: the nested-runner bullet's flag list.
    - References:
      - Plan 115 Task 6 note and Further Action 6; `docs/testing.md`'s nested-runner bullet;
        `scripts/tooling-gate.test.mjs`'s Node-only-flag rule.
  - Test Cases to Write:
    - Docs: a check that `docs/testing.md` no longer names the retired flag while the bullet still
      states the spawn-by-name rule (phrase assertion in the existing docs suite or the task note's
      grep transcript).
    - Gate: `scripts/tooling-gate.test.mjs` passes unchanged.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (documentation wording only).
    - Docs pages to create/edit: `docs/testing.md` (nested-runner bullet).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Executed 2026-09-23 — one sentence in `docs/testing.md`, no evidence file (the task's own Documentation/Wiki Assessment says the grep result belongs in this note). `docs/testing.md:37`'s nested-runner bullet now reads "A child that runs a Node-only test flag (such as `--test` or `--test-isolation`) spawns `node` by name instead of `process.execPath`": the retired `--experimental-test-coverage` is gone while the rule sentence, the `NODE_TEST_CONTEXT`/`NODE_TEST_WORKER_ID` strip, the wiki gate's `--test-isolation=none` note, the `bun test` sets-neither note, and the runner-agnostic `-e`/CLI exception all stay. **Grep result (AC):** `grep -rn -- '--experimental-test-coverage' docs/ scripts/ src/ packages/` → `docs/` now has **0** non-evidence hits (only `docs/_evidence/` history: 9 in `phase113-bun-inventory.md`, 8 in `phase115-suite-budget.md`, 4 in `phase114-bun-coverage.md`, 3 in `phase23-primitive-review.md`, 1 in `review-coverage-2026-07-26-phase-11.md`); `scripts/` holds the four negative-assertion files (`phase23-coverage.test.mjs` 5 lines, `tooling-gate.test.mjs` 4, `run-all-tests.test.mjs` 1, `plan-review-gate.test.mjs` 1) plus the three retired `phase1{3,4,5}-baseline.json` evidence files the scan excludes by name; and two in-repo comments keep the name deliberately, `src/__tests__/field-policy.test.ts:307` and `packages/prism-work/src/document-reader/__tests__/index.test.ts:23` (with gitignored `dist/` mirrors of both), because both explain why a test tolerates per-node instrumentation — prose about behavior, not a spawn, and out of this task's one-page scope. **Checks:** `scripts/tooling-gate.test.mjs` 7/7 (its scan reads source, not docs), `src/__tests__/docs.test.ts` 156/156 (no phrase check pinned the bullet's flag list), `scripts/phase23-coverage.test.mjs` 14/14 (the retired-instrument scan and the build-race assertions are unaffected).

All six tasks in this plan are now closed — Tasks 1, 2, 3, and 5 as dated no-ops with their triggers re-recorded, Tasks 4 and 6 as edits — so the plan-level sections below are filled.

## Compromises Made

- **Four of six tasks closed as recorded no-ops (Tasks 1, 2, 3, 5), by design.** The pinned Bun 1.4.2 still emits no `BRDA`/`BRF`/`BRH`, still resolves a file argument by path suffix, and the suite still passed every run; no fifth `scripts/` file carries the retired flag. Each close carries a dated transcript and the unchanged trigger instead of a speculative change — the plan's value here is that the next owner re-probes a named event, not that six edits landed.
- **The suite budget kept `< 80s` after one run crossed its own trigger line.** Run 3 of four measured 76.450 s (trigger is two consecutive runs over 76 s) with the excess entirely in the gate stage (24.406 s vs 19.205/19.347/20.870 s) at 1-minute load 13.71, and run 4 measured 74.277 s. Re-pinning on one load-explained run would have moved a number that held on every run; §15 records the spread (70.7–76.5 s, wider than plan 115's 2.2 s on a busier host) so the thin margin is visible rather than smoothed.
- **Task 5 declined to install the shape rule on principle.** Five of the eleven remaining flag lines are not assert needles (comment, rule regex, fixture body, a multi-line assert's message, a plan keyword list), so the rule would need a second shape list about as long as the four-name allowlist it replaces; §16.1's per-line table is the carve-out list for the day a fifth legitimate file arrives.
- **Plan 107's Task 4 checkbox is still unchecked and its remaining half is still its own.** Task 4 documented the absorption (the baselines are current and gate-pinned) rather than flipping the box from the wrong plan; the `package-truth.json` refresh, `docs/release-and-install.md` counts, the cut-time `release:gate` run, and the changelog placement under 0.11.0 stay with plan 107.
- **Task 6 dropped a flag name, not the rule.** The bullet still states that a Node-only test flag spawns `node` by name (the `--test` and `--test-isolation` spawns are live); the retired name survives only in the four negative-assertion test files, the retired baselines, evidence history, and two source comments that explain instrumentation behavior.

## Further Actions

1. **Branch-floor restore stays the one task with a real payoff (priority: high when it fires).** Re-probe lcov the moment `packageManager` moves past `bun@1.4.2` ([oven-sh/bun#7100](https://github.com/oven-sh/bun/issues/7100)); the probe command, the restore shape, and both doc pages are recorded in `docs/_evidence/phase114-bun-coverage.md` §2.6 and `phase115-suite-budget.md` §14. Task 1 of this plan is the re-run, not the design. **Destination: [119-Bun-Toolchain-Trigger-Follow-Ups-Round-Two.md](119-Bun-Toolchain-Trigger-Follow-Ups-Round-Two.md) Task 1.**
2. **Budget headroom needs a trim before the next stage lands (priority: medium).** 70.7–76.5 s against `< 80s`, with the trigger line at 76 s: the order is §15's three-run table → trim the measured serialization → one re-pin of the marker and both doc statements. The gate stage's 18.6 s single-file critical path and the two ~5.4 s workspace leaves are the named targets. **Destination: [119-Bun-Toolchain-Trigger-Follow-Ups-Round-Two.md](119-Bun-Toolchain-Trigger-Follow-Ups-Round-Two.md) Task 2.**
3. **Install the occurrence-shape scan rule when a fifth `scripts/` file legitimately carries the retired flag (priority: low).** The rule must allow the four shapes §16.1 enumerates and still fail a flag reaching a spawn argument list, naming the file, with the retired baselines excluded by name. **Destination: [119-Bun-Toolchain-Trigger-Follow-Ups-Round-Two.md](119-Bun-Toolchain-Trigger-Follow-Ups-Round-Two.md) Task 3.**
4. **Two source comments still name the retired flag on purpose** (`src/__tests__/field-policy.test.ts:307`, `packages/prism-work/src/document-reader/__tests__/index.test.ts:23`). If a future scan ever wants the string gone repo-wide, those are the last non-evidence, non-allowlist spots — and the reason to keep them is in the comments themselves. **Destination: [119-Bun-Toolchain-Trigger-Follow-Ups-Round-Two.md](119-Bun-Toolchain-Trigger-Follow-Ups-Round-Two.md) Task 3 (the task that decides the scan's scope).**
5. **Plan 107's Task 4 remainder is still open outside this plan** (priority: low): `scripts/package-truth.json` refresh, `docs/release-and-install.md` counts, the cut-time `release:gate` run, and whether the two removals move under a 0.11.0 changelog entry. **Destination: `plans/107-Behavior-And-Graft-Integration-Removals.md` Task 4 (unchecked; not restated in 119).**
