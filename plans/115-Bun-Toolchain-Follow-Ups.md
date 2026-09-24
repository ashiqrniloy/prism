# Bun Toolchain Follow-Ups: Suite Budget, Node Spawns, Compat Leg

Recorded from `plans/113-Bun-Dev-Toolchain.md` Further Actions after that plan's three tasks landed. Plan 113's coverage follow-up is **not** restated here — it is `plans/114-Bun-Coverage-Gate.md` and stays there. Tasks 6–7 below absorb the residue plan 114 left behind (`plans/114-Bun-Coverage-Gate.md` Further Actions): item 1 is `plans/116-Acp-Durable-Cancel-Vs-Client-Disconnect.md`, item 2 is folded into Task 3 (plan 114 Task 2 already fixed the `cli-provider-add` spawn, so only the `run-bundle` read and the source-scanning gate remain), and items 3–6 are Tasks 6–7.

Depends on plan 113 (landed: `bun.lock`/`bun ci`, the SQLite `bun test` stage, `node --test` everywhere else). Task 5 also depends on `plans/107-Behavior-And-Graft-Integration-Removals.md` Task 4, which already plans the compat-baseline regeneration that this plan would otherwise own.

Two measured facts drive the first two tasks. The default suite is **90.6 s before plan 113 Task 3 and 92.9 / 93.7 s after** on this host (`docs/_evidence/phase113-bun-inventory.md` §10) while `docs/release-and-install.md:317` still pins **`< 60s`** with a `~45s` baseline. And the two slowest stages are slow for structural reasons, not because the work is heavy: the `gate suites` stage's wall clock equals one file's serial test time (`scripts/phase54-legacy-registry.test.mjs`, three tests at 13.8 s + 12.6 s + 9.6 s ≈ the 36.2 s stage), and the `workspace suites` stage is serial twice over — npm runs workspaces one at a time, and every package's test leaf takes the exclusive `with-build-lock.mjs` lock (`scripts/with-build-lock.mjs` header: one `O_EXCL` lockfile, leaf-only). Task 1 turns both into transcripts before anything is changed.

## Objectives

- The default suite's wall clock and its documented budget are the same number, measured, in one place — either the suite gets under the existing `< 60s` claim by removing measured structural serialization, or the claim is raised to a measured baseline with the reason recorded. No third state.
- The two known serialization paths are decided on evidence: the gate stage's critical-path file and the workspace stage's lock/npm serialization. A trim that lands is kept; a trim that does not is recorded and not carried.
- No spawn in the repository invokes a Node-only test flag through `process.execPath`. Node-only children spawn `node` by name, so a Bun or Node parent produces the same child.
- The runner split stays a measurement: when the pinned Bun gains parallel test files, the split is re-measured and stages flip only on wall-clock evidence, never on preference.
- `release:gate`'s compat leg is green on the 0.11.0 line, with every regenerated baseline removal attributed to the plan that caused it.
- The coverage stage measures the core suite once per run: the ~36 s the second `bun test --coverage` costs either comes back or the reason it cannot is recorded against plan 114's measured baseline.
- The branch floor is restored exactly when the pinned Bun emits branch data: until then the probe is a dated no-op with a named trigger, not a standing wish.
- The build-race gate exercises the instrument that ships — a coverage leaf on the retired Node flag no longer proves anything about today's emit/consume race.

## Expected Outcome

- `docs/_evidence/phase115-suite-budget.md` holds the per-stage, per-file, and per-package measurements, the documented-claim location and age, and the trim projection that Task 2 executes.
- Either the default suite measures under the documented claim with the same stages and the same tests (split files, concurrent workspace leaves), or the claim carries the measured baseline and the stage table that produced it. `docs/testing.md`'s stage table matches the runner's `STAGES` exactly.
- `scripts/with-build-lock.mjs` (if Task 2 changes it) still excludes a concurrent writer from every reader: a build cannot start while a test leaf holds the lock, and a reader waits for a build.
- The remaining `process.execPath` + Node-only-flag sites spawn `node`; a source-scanning gate fails on a new one. `bun test --timeout=0 src/__tests__/*.test.ts` runs clean, so a future root-stage flip starts from a measured zero-failure baseline instead of two attributed failures.
- `docs/_evidence/phase113-bun-inventory.md` §10's revert table gains a re-measured row (or a dated no-op probe) for the pinned Bun's test-parallelism status.
- `release:gate`'s compat leg is green on the 0.11.0 line, with every regenerated baseline removal attributed to the plan that caused it.
- The compat diff for every published package is empty on a built tree, `docs/migration.md` and `CHANGELOG.md` describe the 0.11.0 removals, and plan 107 Task 4 is either verified or absorbed with the inherited drift enumerated.
- `docs/_evidence/phase115-suite-budget.md` also carries Task 6's before/after coverage-stage table against plan 114's 169.7 / 170.2 / 175.8 s baseline and Task 7's probe transcript (one plan, one evidence file, matching Tasks 1–2 and 5).
- The coverage stage runs the core suite once per `npm run test:coverage` while `node scripts/coverage-summary.mjs` still measures on its own; `scripts/phase23-build-race.test.mjs`'s coverage leaf runs on the Bun instrument.
- Either `scripts/coverage-thresholds.json` carries branch floors again (calibrated by plan 023's method, not ported) or the plan-114 §2.5 no-op probe is appended with the version trigger to watch — no third state.

## Tasks

- [x] Task 1: Measured inventory — where the default suite's ~93 s goes and what a trim recovers (must run first)
  - Acceptance Criteria:
    - Functional: `docs/_evidence/phase115-suite-budget.md` exists and records, with command transcripts: the three-run stage table (`build`, `performance budget`, `root suites`, `sqlite suites`, `gate suites`, `build race`, `workspace suites`), host CPU count and `node --test` worker count, and the location + age of the documented claim (`docs/release-and-install.md:317` `< 60s`, `~45s` baseline; row `:466`).
    - Functional: the review reproduces the seed measurements — gate stage 36.2 s with `scripts/phase54-legacy-registry.test.mjs` as the critical path (its three tests 13.8 / 12.6 / 9.6 s, run serially inside one file), `scripts/sweep-unused.test.mjs` 14.2 s, `scripts/dead-export-verify.test.mjs` 13.9 s, everything else under 3 s; workspace stage 27.5 s against a per-package sum of 28.6 s (`@arnilo/prism-web-tools` 5.4 s, `@arnilo/prism-ag-ui` 5.4 s, `@arnilo/prism-core` 3.8 s, `@arnilo/prism-coding-tools` 3.6 s, the rest under 2 s each).
    - Functional: the review decides the workspace-stage cause by measurement, not by reading npm's docs: run two workspace test leaves concurrently and record whether they overlap or queue (the `with-build-lock.mjs` probe), and separately run them with the lock bypassed (`PRISM_BUILD_LOCK_HELD=1`) to separate lock serialization from npm's serial workspace loop. The task states which one bounds the stage.
    - Functional: the review records what each candidate trim would recover, with the method named per row: splitting the critical-path file into parallel-friendly files (gate stage ≈ max single file after split), a shared-reader lock plus a concurrent workspace executor (workspace stage ≈ slowest package + overhead), or leaving both and raising the documented number. The projection names the expected total against the `< 60s` claim and says whether the claim can survive.
    - Functional: the review records the interaction with plan 114: the coverage stage is not a default-suite stage, so its move to `bun test --coverage` does not change this plan's numbers; the `~70s` coverage figure in `docs/release-and-install.md:317` is plan 114's to update.
    - Functional: the review checks whether the budget is asserted anywhere executable (`grep` for `60s`/`budget` across `scripts/`, `src/__tests__/`, `docs/`) and records the result — today the claim is prose-only, which is why it drifted.
    - Functional: `scripts/plan-review-gate.test.mjs` gains a `PLAN_115_TASK_1` block (plan path, evidence path, required tokens, rejected tokens) checked by the existing `assertPrimitiveReview` helper — added in the same edit as the evidence file, because the helper asserts the file exists.
    - Performance: wall clock, one machine, three runs, cold vs warm called out; per-file numbers come from `node --test --test-reporter=spec` over exactly the runner's `GATE_FILES` list, not a `scripts/*.test.mjs` glob (that glob includes files the default suite never runs, e.g. `scripts/phase23-security.test.mjs`, and files that need coverage artifacts).
    - Code Quality: decision tables and transcripts, not a design essay; every row names a path or an exit code and cites `path:Lnnn` spans where a claim rests on source.
    - Security: the evidence file contains no credentials, no `PRISM_*` secret values, no absolute home paths; timing commands do not print environment dumps.
  - Approach:
    - Documentation Reviewed:
      - `scripts/run-all-tests.mjs` `STAGES` / `GATE_FILES` — the exact file list and stage commands; `docs/_evidence/phase113-bun-inventory.md` §4 and §10 — the three-run stage table this task extends.
      - `scripts/with-build-lock.mjs` header — one `O_EXCL` lockfile at `node_modules/.prism-build.lock`, leaf-only, `PRISM_BUILD_LOCK_HELD=1` as the non-nesting guard; `docs/testing.md` "Gates never write inside the repository" and the stage table.
      - `docs/release-and-install.md:317` and `:466` — the claim and its baseline; `scripts/budget-gate.test.mjs` — a different budget (startup ratio), not the suite budget.
      - Node 24/26 `--test` docs for `--test-reporter=spec` and default worker concurrency; npm workspaces run serially (verify by the measured per-package sum, not by docs).
      - `scripts/phase54-legacy-registry.test.mjs` — five tests, each with its own `mkdtemp()` scratch dir, so a file split is safe.
    - Options Considered:
      - Raise the documented number immediately — rejected as the first move: the two dominant costs are structural serialization, and a trim that lands keeps the contributor loop honest instead of redefining it.
      - Trim without measuring — rejected: the 36.2 s gate stage could be the file or the worker count; only the per-file table says which.
      - Move the whole suite to `bun test` to gain speed — already measured and rejected in plan 113 §10 (single-process Bun loses to Node's worker pool on every large glob).
      - Parallelize the workspace stage without touching the lock — rejected pending the probe: if the lock is the serializer, the parallel executor alone changes nothing.
      - Drop the slowest gate files from the default suite — rejected: they are protection gates; plan 057's retirement precedent required content verification and an explicit decision, not a timeout.
    - Chosen Approach: one evidence file that freezes the measurements, the cause per stage, and the trim projection; Task 2 implements only what it allows and only as far as the measurements support.
    - API Notes and Examples:
      ```bash
      # per-file gate timings over the runner's own list, not a scripts/*.test.mjs glob
      node --test --test-reporter=spec $(node -e 'import("./scripts/run-all-tests.mjs").then(m=>console.log(m.STAGES.find(s=>s.name==="gate suites").args.filter(a=>a.endsWith(".test.mjs")).join(" ")))') \
        | grep -aE '^(✔|✖) '
      # per-package workspace timings (serial npm loop)
      for d in packages/*/; do t0=$(date +%s%N); (cd "$d" && npm test >/dev/null); t1=$(date +%s%N); echo "$(( (t1-t0)/1000000 ))ms $d"; done
      # lock probe: two wrapped leaves at once, then the same pair with the non-nesting guard
      node scripts/with-build-lock.mjs node --test packages/prism-core/dist/sessions/sqlite/__tests__/*.test.js &
      node scripts/with-build-lock.mjs node --test packages/prism-ag-ui/dist/**/*.test.js
      # control: the guard makes both leaves run without acquiring, so the pair overlaps if the lock is the serializer
      PRISM_BUILD_LOCK_HELD=1 node scripts/with-build-lock.mjs node --test packages/prism-core/dist/sessions/sqlite/__tests__/*.test.js &
      PRISM_BUILD_LOCK_HELD=1 node scripts/with-build-lock.mjs node --test packages/prism-ag-ui/dist/**/*.test.js
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase115-suite-budget.md`: stage table, per-file table, per-package table, lock probe, trim projection, documented-claim record.
      - `scripts/plan-review-gate.test.mjs`: `PLAN_115_TASK_1` block and one `assertPrimitiveReview` test.
    - References:
      - Required tokens: `run-all-tests.mjs`, `GATE_FILES`, `with-build-lock.mjs`, `phase54-legacy-registry.test.mjs`, `docs/release-and-install.md:317`, `< 60s`, `PRISM_BUILD_LOCK_HELD`, `phase113-bun-inventory.md`, `spec` reporter, `worker`.
      - Rejected tokens: `raise the budget first`, `bun test for the whole suite`, `drop the gate files`, `estimate from file size`, `scripts/*.test.mjs glob`, `trust npm's docs`.
  - Test Cases to Write:
    - Review gate: `PLAN_115_TASK_1` fails when the evidence file is missing, drops a required token, or gains a rejected token.
    - Critical-path claim: the recorded per-file table shows the gate stage wall clock within 10 % of the critical-path file's serial test time — Task 2's split decision rests on it.
    - Lock probe: the transcript shows whether two leaves overlap or queue, and the `PRISM_BUILD_LOCK_HELD=1` control shows the same pair without lock contention — Task 2's lock decision rests on it.
    - Projection: the trim projection's arithmetic is reproducible from the recorded per-file and per-package numbers.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (evidence artifact and a test-only gate block).
    - Docs pages to create/edit: `docs/_evidence/phase115-suite-budget.md` only (evidence, not an API page).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Executed 2026-09-23 — evidence in `docs/_evidence/phase115-suite-budget.md`; gate block added to `scripts/plan-review-gate.test.mjs`. Two seed rows did not reproduce and are recorded there: `dead-export-verify.test.mjs` 0.32 s (seed 13.9 s) and "everything else under 3 s" (five files 3.1–7.1 s); the gate stage is 37.9–39.7 s against the 33.4 s critical file (+17 %, decomposition in the evidence). The workspace bound is confirmed as the exclusive lock: `bun run --workspaces --parallel test` = 28.55 s = the serial per-package sum, and the `PRISM_BUILD_LOCK_HELD=1` control overlaps the same pair.

- [x] Task 2: Apply the budget decision — trim the measured serialization, then pin one number
  - Acceptance Criteria:
    - Functional: if Task 1 confirms the gate-stage critical path, `scripts/phase54-legacy-registry.test.mjs` is split into parallel-friendly files (one per independent `mkdtemp()` scenario, no shared mutable state) so `node --test` workers overlap them; the tests and their assertions are unchanged, and the split is recorded in `docs/testing.md`'s stage table only if the table's row text needs it.
    - Functional: if Task 1 confirms the lock bounds the workspace stage, `scripts/with-build-lock.mjs` gains a reader mode (`--shared` or an env-selected reader path) where test leaves take a shared lock and `tsc` keeps the exclusive one, and the runner's `workspace suites` stage executes packages concurrently with a bounded worker count. If Task 1 shows npm's serial loop is the bound instead, the lock change is dropped and only the executor changes.
    - Functional: whichever combination lands, `scripts/run-all-tests.test.mjs` asserts the resulting stage shape (including plan 113 Task 3's partition rule: every test file runs exactly once, the one Bun stage keeps `--timeout=0`, no `process.execPath` in the runner).
    - Functional: the documented budget and the measured baseline become the same number in one place. `docs/release-and-install.md:317`'s `< 60s` claim survives only if two consecutive runs land under it with margin (target: ≤ 55 s); otherwise the sentence carries the measured baseline (for example `< 75s`, baseline 68 s on 16 CPUs) with the stage table that produced it, and `:466`'s row is updated to match. `docs/testing.md`'s stage table and any `docs/index.md` sentence that names a stage or the budget are updated to the same state.
    - Functional: an executable check replaces prose-only enforcement: a test asserts the budget sentence carries the pinned number and that no second page restates a different one (the drift that produced this task).
    - Performance: before/after table for the full suite, twice, with the new stage wall clocks; the improvement is reported per stage, and the trim is reverted for any stage where the wall clock does not improve by more than run-to-run variance.
    - Code Quality: no new dependency, no second lock implementation, no runner abstraction; the lock change stays inside `scripts/with-build-lock.mjs` and the executor change inside `scripts/run-all-tests.mjs`. Every deliberate simplification that cuts a corner (for example a fixed worker count) carries a `ponytail:` comment naming the ceiling and the upgrade path.
    - Security: the lock change preserves mutual exclusion at the trust boundary it exists for — a writer (tsc/build) excludes every reader, and a reader excludes writers. A test proves both directions with two concurrent children; a reader that runs while a writer holds the lock is a failure, not a warning. The non-nesting guard (`PRISM_BUILD_LOCK_HELD=1`) keeps its meaning.
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/phase115-suite-budget.md` (Task 1) — the only source of the trim decision; `scripts/run-all-tests.mjs` `STAGES` and the plan 113 Task 3 partition tests.
      - `scripts/with-build-lock.mjs` — the lock protocol, PID liveness, `UNPARSEABLE_GRACE_MS` reclaim, `PRISM_BUILD_LOCK_TIMEOUT_MS`; `scripts/phase23-build-race.test.mjs` and `scripts/phase23-security.test.mjs` — the existing concurrency gates that must stay green.
      - Node `--test` worker concurrency and per-file scheduling; npm workspaces serial execution; `docs/testing.md` stage table; `docs/release-and-install.md:317`, `:466`.
      - Bun `run --workspaces --parallel` (`bun run --help`) — probed in Task 1 as a possible executor before writing one.
    - Options Considered:
      - Split the slow gate file only — cheapest trim, but bounded: it cannot recover the workspace stage's ~20 s.
      - Shared-reader lock only — recovers the workspace stage if the lock is the bound, does nothing for the gate stage.
      - Raise the documented number to the measured baseline — kept as the residue option: it is honest when the trim lands short, and dishonest as a first move.
      - Remove the build lock for readers — rejected: plan 023 Task 1 froze the lock for the concurrent-build race; a reader that can observe a partial `dist/` reintroduces the bug the lock exists to prevent.
      - `bun run --workspaces --parallel test` as the executor — kept as an option if Task 1 shows it runs all workspace scripts concurrently and propagates per-package failures; otherwise a bounded `Promise.all` in the runner.
      - Split the root stage or the sqlite stage — no: both are already parallel across files and neither is a critical path.
    - Chosen Approach: execute exactly the trim rows Task 1 marked as measured wins, verify each with a before/after wall clock, then set the documented number from the resulting measurement. If both trims land, the `< 60s` claim stays and gains a reproducible baseline; if either fails to improve, the residue is absorbed by raising the claim with the recorded reason.
    - API Notes and Examples:
      ```bash
      # the stage table is the acceptance artifact, before and after
      time node scripts/run-all-tests.mjs
      # reader/writer exclusion proof (two children, one writer)
      node scripts/with-build-lock.mjs --shared node -e 'setTimeout(()=>{}, 2000)' &
      node scripts/with-build-lock.mjs node -e 'console.log("writer ran")'
      ```
    - Files to Create/Edit:
      - `scripts/phase54-legacy-registry.test.mjs` → split files (tentative names: `phase54-legacy-registry-dry-run.test.mjs`, `-apply.test.mjs`, `-fail-closed.test.mjs`), original file removed if fully split.
      - `scripts/with-build-lock.mjs`: reader mode (only if Task 1 names the lock as the workspace bound).
      - `scripts/run-all-tests.mjs`: concurrent workspace executor and/or split file list; `scripts/run-all-tests.test.mjs`: stage-shape and partition assertions.
      - `package.json`: only if the workspace `test` scripts must change their lock invocation (prefer not).
      - `docs/release-and-install.md`: budget sentence at `:317` and the row at `:466`.
      - `docs/testing.md`: stage table row text (runner/parallelism), budget sentence if it names one.
      - `docs/_evidence/phase115-suite-budget.md`: Task 2 note with the before/after table and the decision per trim row.
      - `docs/index.md`: one existing sentence only, if it names the budget or a stage count.
    - References:
      - `docs/_evidence/phase113-bun-inventory.md` §10 — the 90.6 / 92.9 / 93.7 s runs this task beats.
      - `scripts/phase23-build-race.test.mjs` — the race gate a reader/writer split must keep passing.
      - Plan 057's retirement precedent — why trimming means restructuring, never deleting a gate.
  - Test Cases to Write:
    - Lock exclusion: a reader child and a writer child started together never overlap; a second reader overlaps the first (the whole point of the trim); a writer waits for readers and vice versa. Assert on observed ordering, not on the lock file's contents.
    - Lock reclaim: a killed holder still gets reclaimed (`UNPARSEABLE_GRACE_MS` path) after the reader-mode change — the existing behavior must not regress.
    - Partition: every dist test file still runs exactly once across the split gate files and the sqlite stage; the runner's stage list still contains every protection gate.
    - Budget: the documented number appears in one page, matches the evidence file's measured baseline, and a stale second statement fails the check.
    - Failure propagation: a failing package in the concurrent workspace stage still fails the stage and does not hide later packages' output (the npm serial loop's current guarantee).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no package export; contributor test commands, stage shape, and the documented budget change — a development-contract change.
    - Docs pages to create/edit: `docs/release-and-install.md` (budget sentence + row), `docs/testing.md` (stage table, lock/parallelism note), `docs/_evidence/phase115-suite-budget.md` (Task 2 note), `README.md` only if its scripts row names the budget.
    - `docs/index.md` update: yes, one existing sentence only — if the testing entry names the stage set or the budget, update it to the current state without plan numbers or version narrative. No new page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Executed 2026-09-23 — evidence in `docs/_evidence/phase115-suite-budget.md` §11. Both trim rows landed: `scripts/phase54-legacy-registry.test.mjs` split into `-dry-run`/`-apply`/`-fail-closed` files sharing `scripts/fixtures/phase54-legacy-registry-fixture.mjs` (6 tests, original removed, `GATE_FILES`/partition updated), and `scripts/with-build-lock.mjs` gained `--shared` reader mode with an exclusive-writer drain, exercised by all 11 workspace `test` scripts through the runner's bounded pool (`runParallelLeaves`, 2 in flight — timing-sensitive package budgets flaked at 3–4). Full suite twice: **71.690 s / 73.890 s**, all 7 stages pass (gate 38.9 → 19.6/21.2 s, workspace 28.7 → 17.1/17.1 s; build race grows 10.5 → 14.6/15.0 s for the new reader/writer exclusion tests). The `< 60s` claim did not survive, so `docs/release-and-install.md:317`/`:466` pin **`< 80s`** with a **~72 s** baseline, and `src/__tests__/docs.test.ts` asserts the pin/baseline against the evidence marker and fails if any page restates a different number (stale-pin probe verified). `docs/testing.md` documents the split and the shared-lock concurrent workspace stage; `docs/index.md` needed no change (same seven stages, no budget number). `scripts/run-all-tests.test.mjs` asserts the new stage shape, the gate partition, and the pool's bound/failure propagation.

- [x] Task 3: Node-only spawns spawn `node` by name — plus the source glob's one path assumption — with a gate that keeps it that way
  - Acceptance Criteria:
    - Functional: every repository spawn that passes `--test`, `--experimental-test-coverage`, or `--test-isolation` uses the literal `"node"` as the command. **Already fixed by plan 114 Task 2 (verify only):** `src/__tests__/cli-provider-add.test.ts`'s `--test` site (its remaining `process.execPath` at L282 spawns the local `tsc` and is runner-agnostic — leave it, and the gate's negative controls must not flag it) and `scripts/coverage-summary.mjs` (landed as a `bun` spawn). Still to fix here: `scripts/wiki-scratch-isolation.test.mjs:L88`, `scripts/phase23-build-race.test.mjs:L45,L47`, `scripts/phase23-security.test.mjs:L64,L98`, `scripts/e2e-cli-live.test.mjs:L97`.
    - Functional: `src/__tests__/cli-provider-add.test.ts` no longer produces the Bun-only failure — **plan 114 Task 2 already made this true** (the site now spawns `"node"`); re-verify with `bun test --timeout=0 src/__tests__/cli-provider-add.test.ts` and pin it only if it regresses.
    - Functional: `src/__tests__/run-bundle.test.ts:L120` reads the module it means to scan under both runners. Today it reads `new URL("../run-bundle.js", import.meta.url)` and a TypeScript-source run resolves that to `src/run-bundle.js` (`ENOENT`, measured) while the dist run resolves `dist/run-bundle.js` — the read picks the existing sibling (`.js` first, `.ts` fallback) with no change to what the test asserts. `packages/mcp/src/__tests__/server.test.ts:L567` keeps its `../server.js` reference: it is a deliberate dist path inside a spawned script, and workspace suites only ever run built `dist/` — record that reason in the task note so a later reader does not "fix" it.
    - Functional: after both fixes, `bun test --timeout=0 src/__tests__/*.test.ts` reports zero failures (measured before: 2 — the spawn and the `../run-bundle.js` read; the `docs > plans index links` failure plan 113 §4 recorded was fixed when plan 114's index row landed, and plan 113 §10's attribution of both failures to the spawn is corrected in the evidence file by this task).
    - Functional: a source-scanning gate fails on a new `process.execPath` spawn that carries a Node-only flag, and passes on the spawns that are runner-agnostic (CLI invocations such as `scripts/e2e-cli-live.test.mjs:L80,L137` and the 49 `-e` sites — Bun's `-e` exists and is the reason the root `bun test` run works). The gate names the rule in one sentence, not a regex essay.
    - Functional: `scripts/phase23-security.test.mjs` and the other `security:threat-suites` members still pass under `node --test` after the change; `npm run security:threat-suites` is the check.
    - Performance: no measurable cost; the change is a command literal.
    - Code Quality: the literal `"node"` is used directly at each site — no `nodeBinary()` helper, no constant, no environment lookup. One comment at the gate test explains why the rule exists (a Bun parent makes `process.execPath` a Bun child, and `bun --test` is not `node --test`).
    - Security: no behavior change to the spawned commands; the CLI spawn sites keep the same arguments and environment, so no credential or cwd semantics move.
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/phase113-bun-inventory.md` §5 — the 63 `process.execPath` spawns, the 13 Node-only-flag sites, and the measured `Cannot use describe outside of the test runner` failure; §1.2 — `bun --test` runs as a script, not as a test runner.
      - `src/__tests__/cli-provider-add.test.ts:L270-L300` — the scaffold that spawns the child test run.
      - `scripts/tooling-gate.test.mjs` / `scripts/import-hygiene.test.mjs` — where a source-scanning rule of this kind already lives, so the new gate follows the same shape instead of inventing a file.
      - Plan 113 Task 3's runner change — precedent for spawning `node` by name, and the partition tests that already assert the runner's spawns.
    - Options Considered:
      - Change `process.execPath` everywhere including the CLI/`-e` spawns — rejected: those are runner-agnostic by construction, and the 49 `-e` sites work under both runtimes. A blanket rewrite is churn with a real risk of changing behavior under Bun.
      - Keep `process.execPath` and make the child Bun-aware (`bun test` when the parent is Bun) — rejected: branching on `process.versions.bun` in a test scaffold makes the test's behavior depend on who ran it, which is exactly the ambiguity the failure exposed.
      - Fix only `cli-provider-add.test.ts` — rejected: the same latent bug exists in four more files (`wiki-scratch-isolation`, `phase23-build-race`, `phase23-security`, `e2e-cli-live`), plus `scripts/coverage-summary.mjs` which plan 114 owns, and the next whole-stage flip re-discovers it.
      - A runtime shim that rewrites `process.execPath` in test setup — rejected: global monkey-patching in a test preload hides the spawn site from a reader.
    - Chosen Approach: literal `"node"` at the Node-only-flag sites plus a source-scanning gate that encodes the rule, with the runner-agnostic spawns explicitly left alone and named in the gate's comment.
    - API Notes and Examples:
      ```ts
      // before: under a Bun parent this child is `bun --test …`, which is not a test runner
      runInProject(process.execPath, ["--test", join(target, "dist", "__tests__", "provider.test.js")], target);
      // after
      runInProject("node", ["--test", join(target, "dist", "__tests__", "provider.test.js")], target);
      ```
    - Files to Create/Edit:
      - `src/__tests__/cli-provider-add.test.ts`: the `--test` spawn is already fixed by plan 114 Task 2 — verify only; keep the runner-agnostic `tsc` spawn at L282 on `process.execPath`.
      - `src/__tests__/run-bundle.test.ts`: the sibling-module read (`:120`) resolves `.js` then `.ts`.
      - `scripts/wiki-scratch-isolation.test.mjs`, `scripts/phase23-build-race.test.mjs`, `scripts/phase23-security.test.mjs`, `scripts/e2e-cli-live.test.mjs`: Node-only-flag spawn sites.
      - `scripts/tooling-gate.test.mjs`: the source-scanning rule (or `scripts/import-hygiene.test.mjs` if that file already owns spawn-shape rules — choose one, not both).
      - `docs/testing.md`: one clause in the nested-runner bullet if it does not already say children spawn `node` by name.
      - `docs/_evidence/phase113-bun-inventory.md`: §5 note that the listed sites are fixed (evidence files are append-only history; the note records the follow-up, it does not rewrite the table).
    - References:
      - Plan 113 §5 table and the `cli-provider-add` failure transcript; plan 113 Task 3's `run-all-tests.mjs` change as the pattern to copy.
  - Test Cases to Write:
    - Spawn rule: a fixture string with `process.execPath` + `--test` fails the scan; a fixture with `"node"` + `--test` passes; `process.execPath` with `-e` and with a CLI path passes (negative controls for over-broad rules).
    - Root source glob: `bun test --timeout=0 src/__tests__/*.test.ts` reports zero failures (measured before the task: two — the spawn and `run-bundle.test.ts`'s `.js` read).
    - Scaffold: `bun test --timeout=0 src/__tests__/cli-provider-add.test.ts` passes, and the spawned child is a Node test run (assert the child's runner, not just the exit code).
    - Sibling read: `run-bundle.test.ts` passes under both runners — the dist run (`node --test dist/__tests__/run-bundle.test.js`) and the source run (`bun test src/__tests__/run-bundle.test.ts`) — and still reads the module it names, not an empty string.
    - Threat suites: `npm run security:threat-suites` stays green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no consumer contract; test-runner plumbing only.
    - Docs pages to create/edit: `docs/testing.md` (nested-runner clause, if not already covered by plan 113 Task 3's edit).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Executed 2026-09-23 — evidence in `docs/_evidence/phase113-bun-inventory.md` §11. Five sites fixed to the literal `"node"`: `scripts/wiki-scratch-isolation.test.mjs` (`--test --test-isolation=none`), `scripts/phase23-build-race.test.mjs` (importer `--test` leaf and the coverage leaf; its `-e` snippets and lock wrapper keep `process.execPath`), `scripts/phase23-security.test.mjs` (`:64` lock-wrapped importer, `:98` coverage-summary script), and `scripts/e2e-cli-live.test.mjs:97` (its CLI invocations at `:80`/`:137` keep `process.execPath`). Plan 114's two fixes were verified, not redone: `cli-provider-add.test.ts` spawns `"node"` for the `--test` leaf (the `tsc` leaf at `:282` stays `process.execPath` and passes the new scan), `coverage-summary.mjs:81` spawns `"bun"`; the scaffold assertion is tightened to `/ℹ pass [1-9]/` so it asserts the child's Node reporter, not just a zero exit code. `src/__tests__/run-bundle.test.ts:120` now reads `../run-bundle.js` when it exists and `../run-bundle.ts` otherwise, with `assert.match(source, /export function snapshotRunBundle/)` so the scan cannot go vacuous; `packages/mcp/src/__tests__/server.test.ts:567` keeps its `../server.js` path on purpose (a spawned child imports built `dist/server.js`; workspace suites never run source) and the reason is recorded in the evidence. The gate lives in `scripts/tooling-gate.test.mjs` (one sentence: a spawn carrying `--test`/`--test-isolation`/`--experimental-test-coverage` must run `node` by name), scans `src/`+`scripts/`+`packages/` (~1650 files, ~37 ms), and its fixtures pass `-e`/CLI/`"node"` shapes while failing four `process.execPath` + Node-only-flag shapes; a planted violating file fails the gate and removing it passes. Measured: `bun test --timeout=0 src/__tests__/*.test.ts` **2083 pass / 0 fail** (was 2080/2), scaffold under Bun 9/9, `run-bundle` 4/4 under both runners, build race 12/12, wiki gate 4/4, `npm run security:threat-suites` 83/83; `e2e-cli-live` skips without `PRISM_LIVE_PROVIDER_TESTS=1`, so its `"node"` literal is exercised only on a live run. `docs/testing.md`'s nested-runner bullet names the rule.

- [x] Task 4: Re-measure the runner split when the pinned Bun parallelizes test files (trigger-gated)
  - Acceptance Criteria:
    - Functional: the task first probes the pinned Bun for parallel test-file execution (`bun test --help` flags, `bun --version`, Bun release notes for the pinned line) and records the transcript in `docs/_evidence/phase113-bun-inventory.md` §10 (append-only note) with the date and version.
    - Functional: if the pinned version has no such flag, the task closes as a recorded no-op — no code change, no speculative flag, no `--concurrency` added to any script for a feature the pinned version lacks. The note names the trigger to watch and the next version boundary.
    - Functional: if the flag exists, the task re-runs plan 113 §10's revert table on the same tree (root `dist/__tests__/*.test.js`, root source glob, whole prism-core workspace glob, SQLite set) with the flag, and flips only the stages whose wall clock improves while the pass/fail set is identical to Node's. Any flip keeps plan 113 Task 3's invariants: one Bun stage at most per file set, every file exactly once, `--timeout=0` on every `bun test` invocation.
    - Functional: if a stage flips, `docs/testing.md`'s stage table and the evidence file record the new runner per stage with the measurement; if none flips, the table is untouched.
    - Performance: the re-measured table is wall clock, same host, at least two runs per candidate, and states the Node baseline from the same session (not plan 113's stale numbers).
    - Code Quality: no flag is added to `scripts/run-all-tests.mjs` unless the flip lands; the runner keeps one Bun stage per file set so a reader can see which files run where.
    - Security: the re-measured Bun runs use the same environment hygiene as the default suite (`NODE_TEST_*` strip unchanged; no `BUN_*` strip invented — plan 113 §1.5 measured none).
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/phase113-bun-inventory.md` §4/§10 — the revert table and the single-process explanation; `docs/testing.md` stage table.
      - Bun's test-runner docs and the pinned line's release notes for parallelism/concurrency support; `bun test --help` on the pinned binary.
      - `scripts/run-all-tests.mjs` `STAGES` — the only place a flip is expressed.
    - Options Considered:
      - Flip the root stage to Bun now — rejected in plan 113 §4/§10: 30.1 s vs 13.2 s and one extra failure.
      - Add a concurrency flag speculatively — rejected: a flag the pinned version ignores reads as a speedup and delivers nothing.
      - Skip the re-measure entirely — rejected: the split is a measurement, and a measurement with no expiry date becomes folklore.
    - Chosen Approach: probe, then either flip on evidence or record a dated no-op. The task is expected to be a no-op for the pinned version; its value is the trigger record.
    - API Notes and Examples:
      ```bash
      bun test --help | grep -iE 'parallel|concurren|worker'   # expect empty on 1.4.2; record the output either way
      bun --version
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase113-bun-inventory.md`: §10 append (probe transcript, verdict, date).
      - `scripts/run-all-tests.mjs`, `scripts/run-all-tests.test.mjs`, `docs/testing.md`: only if a flip lands.
    - References:
      - Plan 113 §10 revert table; plan 113's rule that a stage whose Bun run is slower reverts.
  - Test Cases to Write:
    - Probe: the recorded transcript shows the flag search's actual output (empty or not) on the pinned version — a future reader must be able to tell a no-op from a skipped check.
    - Flip (only if it lands): the partition test still proves every file runs exactly once across the Bun and Node stages, and the one-Bun-stage-per-file-set rule still holds.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no, unless a stage flips (then the contributor test contract changes).
    - Docs pages to create/edit: `docs/testing.md` only on a flip; otherwise `docs/_evidence/phase113-bun-inventory.md` (evidence note).
    - `docs/index.md` update: no (the testing entry names stages generically after plan 113 Task 3).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Executed 2026-09-23 — evidence in `docs/_evidence/phase113-bun-inventory.md` §12. The trigger fired: pinned Bun `1.4.2` has `--parallel=<val>` ("N worker processes, implies `--isolate`, defaults to CPU core count"), plus `--parallel-delay`, `--no-isolate`, `--max-concurrency`, `--shard`, `--timings`/`--update-timings`. The revert table was re-run on this tree with the flag (≥2 runs per candidate, Node baseline from the same session): the **root `dist/__tests__/*.test.js` glob does not flip** — Bun is faster (11.9–12.9 s vs Node 13.7–14.0 s) but resolves a file argument by **path suffix**, so `dist/__tests__/{content,schema}.test.js` also pull `packages/mcp/dist/__tests__/content.test.js` and `packages/hooks/dist/__tests__/schema.test.js` (2069 → 2083 tests; minimal `zz-collide` repro with a same-suffix and a different-suffix control recorded), which would break plan 113 Task 3's "every file exactly once" partition; the source glob is not a stage (and has no Node baseline: Node 26 strips types but `../index.js` does not resolve to `src/index.ts`); the **prism-core leaf was flipped and reverted** — `bun test --parallel=8` beats Node 3.67 → 2.15 s with an identical 675-test/666-pass/9-skip/0-fail set over exactly 79 files, but the workspace stage moves only ~0.5 s (16.5 vs 17.0 s median; prism-core is not the critical path) inside a 15.9–17.3 s spread and one of six stage runs flaked (`packages/memory`'s 5 ms source-scan budget at host load 5.97), so `packages/prism-core/package.json` is byte-identical to its pre-task state; the SQLite set stays as adopted (`--parallel` 348 ms vs 372 ms, inside noise; its path suffix matches nothing else, so its 3-file partition is safe). No stage flips: `scripts/run-all-tests.mjs` and `docs/testing.md` are unchanged, no `--parallel` flag was added, every `bun test` keeps `--timeout=0`, and environment hygiene is the default suite's. Triggers recorded: Bun's suffix matching, the workspace pool / memory+prism-work budgets, and the next pinned-version boundary (1.5.x).

- [x] Task 5: `release:gate` compat leg — verify plan 107 Task 4, or absorb it with attributed drift
  - Acceptance Criteria:
    - Functional: the compat diff for every published package is empty on a built tree. Measured with the gate's own helpers (`extractDeclaredSurface` / `diffSurface` / `parseSurface` from `scripts/release-gates.mjs`), which is the check `node scripts/release.mjs gate` performs after its evidence preflight.
    - Functional: if plan 107 Task 4 has landed, this task verifies and records the verification (baseline diff empty, `docs/migration.md` 0.11.0 removals described, `CHANGELOG.md` updated) and changes no baseline. If it has not landed, this task regenerates with `node scripts/release.mjs gate --update-baseline`, enumerates the diff, attributes each removal to the plan that caused it (plan 107's removals vs inherited drift, plan 084 Task 8 precedent), and records the attribution table in the task note.
    - Functional: the measured starting state is recorded, not assumed: `@arnilo/prism` changed 7 (`CheckpointRestoreAudit`, `CheckpointRestoreAuditEntry`, `CheckpointRestoreHook`, `RunCheckpointRestoreHooksOptions`, `RunLimitTrackerOptions`, `describeBudgetExhaustion`, `runCheckpointRestoreHooks`), `@arnilo/prism-memory` removed 57, `@arnilo/prism-coding-tools` removed 42 and changed 15, on this tree with `dist/` built.
    - Functional: the attribution hypothesis is verified against the owning plans, not assumed. Measured now: plan 109 (complete 2026-09-19) added the `CheckpointRestore*`/`runCheckpointRestoreHooks`/`describeBudgetExhaustion`/`RunLimitTrackerOptions` surface and its plan text names neither `scripts/compat-baseline/` nor `--update-baseline` — the plan 083 failure mode, inherited here. Plan 107 owns the memory/coding-tools removals and does plan regeneration (its Task 4). The task note states which drift is this plan's (none) and which is inherited, with the plan that caused it.
    - Functional: the preflight limitation is documented in the task note — `node scripts/release.mjs gate` in a fresh tree stops at `checkReleaseEvidence` (nine `no coverage-summary.json evidence` rows plus `PRISM_TEST_POSTGRES_URL`) before the compat leg, so the compat leg is verified either after `npm run test:coverage` or through the direct diff helper. No coverage artifacts are faked to reach the gate.
    - Functional: `docs/migration.md`'s 0.10.0 "zero removals" line and the 0.11.0 section describe the actual removals, and `CHANGELOG.md` carries them — unless plan 107 Task 4 already wrote them, in which case the task cites the lines instead of editing.
    - Performance: n/a (gate work).
    - Code Quality: baseline files change only through `--update-baseline`, never by hand; the attribution table distinguishes this plan's edits (none) from inherited drift; no baseline is regenerated to make a test pass without the review the skill rule requires.
    - Security: no `npm publish`, no registry writes, no `--allow-break` without a migration note; the check runs offline.
  - Approach:
    - Documentation Reviewed:
      - `scripts/release-gates.mjs` — `runGates` order (version ranges, then API surface diff, then tarball deny list), `BASELINE_DIR`, `baselineName`, `migrationMentionsVersion`.
      - `plans/107-Behavior-And-Graft-Integration-Removals.md` L91 (expected regen diff), L112 (baseline file list), L243-L256 (Task 4's acceptance and `--update-baseline`), and its Task 4 checkbox state.
      - `.agents/skills/create-plan/SKILL.md` — the compat-baseline rule and plan 083/084 precedent; `docs/migration.md`, `CHANGELOG.md`.
    - Options Considered:
      - Regenerate unconditionally now — rejected if plan 107 Task 4 is the owner: double regeneration loses the review of what each removal belongs to.
      - `--allow-break` with a migration note — rejected as the primary path: it documents a break instead of recording the intended surface; plan 107 chose `--update-baseline` after review.
      - Leave the leg red and record it — rejected: `release:gate` cannot run at all while red, which blocks any release cut.
      - Fake coverage artifacts to reach the gate — rejected: the preflight exists to stop exactly that.
    - Chosen Approach: verify-or-absorb, with the ownership and the preflight limitation recorded. Whichever branch runs, the attribution table is the deliverable.
    - API Notes and Examples:
      ```bash
      # what the gate does after its evidence preflight, reproduced without coverage artifacts
      node -e 'const fs=require("fs"),p=require("path");import("./scripts/release.mjs").then(async r=>{const g=await import("./scripts/release-gates.mjs");const rel=r.loadRelease(process.cwd());for(const k of rel.packages){const d=p.join(rel.root,k.path,"dist");if(!fs.existsSync(d))continue;const b=p.join(rel.root,g.BASELINE_DIR,g.baselineName(k.manifest.name));const diff=g.diffSurface(g.extractDeclaredSurface(d),g.parseSurface(fs.readFileSync(b,"utf8")));if(diff.removed.length||diff.changed.length)console.log(k.manifest.name,diff);}})'
      # the real regeneration path (writes scripts/compat-baseline/*)
      node scripts/release.mjs gate --update-baseline
      ```
    - Files to Create/Edit:
      - `scripts/compat-baseline/*.txt`: only if plan 107 Task 4 has not landed (regenerated via `--update-baseline`).
      - `docs/migration.md`, `CHANGELOG.md`: the 0.11.0 removal record (only if plan 107 Task 4 has not written it).
      - `scripts/release-gate.test.mjs`: a case asserting the compat diff is empty for every package with a built `dist/` (the gate suite runs after the build stage, so the check is available there).
      - `plans/107-Behavior-And-Graft-Integration-Removals.md`: a task note recording the verification or the absorption (its Task 4 checkbox stays 107's to flip).
      - `docs/_evidence/phase115-suite-budget.md`: the attribution table and the preflight note (same evidence file as Tasks 1–2 — one plan, one evidence file).
    - References:
      - Plan 084 Task 8 — the inherited-drift absorption precedent; plan 083 — why leaving a split unregenerated is expensive.
      - `scripts/release-gate.test.mjs` — existing gate-suite coverage of the release machinery.
  - Test Cases to Write:
    - Compat currency: a gate-suite test computes the surface diff for every package with `dist/` and fails on any removed or changed name — the same check the release gate performs, runnable without coverage artifacts.
    - Regeneration review (only if this task regenerates): the baseline diff's removed names are a subset of the union of plan 107's enumerated removals and the attributed inherited set; an unlisted name fails the test's own fixture check in the task note.
    - Preflight: the task note's transcript shows the `checkReleaseEvidence` blockers, proving the compat leg was reached deliberately rather than by luck.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — baseline files are the recorded public surface, and `docs/migration.md` is the consumer-facing record of removals.
    - Docs pages to create/edit: `docs/migration.md` (0.11.0 removals, if not already written by plan 107 Task 4), `CHANGELOG.md` (same condition), `docs/_evidence/phase115-suite-budget.md` (attribution table).
    - `docs/index.md` update: no (no new page; migration is already linked).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Executed 2026-09-23 — evidence in `docs/_evidence/phase115-suite-budget.md` §12. Plan 107 Task 4 is unchecked, so this took the absorption branch. Measured starting state (gate helpers, built `dist/`): `@arnilo/prism` removed 0 / changed 7 / added 5, `@arnilo/prism-memory` removed 58, `@arnilo/prism-coding-tools` removed 48 / changed 14 / added 3 (the plan's 57/42/15 were an earlier tree state; the measured numbers are what the note records). Attribution is name-by-name, not assumed: all 106 removals trace into the `v0.10.0` `packages/memory/src/graft/` and `packages/prism-coding-tools/src/{caveman,ponytail,upstream}/` trees (plan 107 Tasks 2–3, zero inherited drift in that class); the 21 changed signature lines are inherited — plan 109 (`CheckpointRestore*` / `runCheckpointRestoreHooks` / `CheckpointRestoreHandler`), plan 108 (`RunLimitTrackerOptions` / `describeBudgetExhaustion` / `observeSupervisorLifecycle` / the `lifecycle.js` line / `SubagentFailure|Recovery|RecoveryOutcome`), plan 110 (`scorePrefixStability`) — and additive except `resolveUpstreamRoot` and `observeSupervisorLifecycle`, both in modules no `exports` entry reaches; nothing here is plan 115's. Regenerated through the gate's own `runGates({ updateBaseline: true })` because `node scripts/release.mjs gate` (and `--update-baseline`) stops at `checkReleaseEvidence` — nine `no coverage-summary.json evidence` rows plus `PRISM_TEST_POSTGRES_URL` — with no artifact faked; the baseline diff (3 files, +29/−127) was reviewed as a set comparison against §12.1 and matches exactly, the eight untouched baselines rewrote byte-identically, and the full gate then passes (`{"version":"0.10.0","updated":false,"packages":12}`). `docs/migration.md` gained the `0.10.0 → 0.11.0` removal section and its 0.10.0 "Nothing was removed" line is now scoped to 0.10.0 and points there; `CHANGELOG.md` already carries both removals (lines 24–25, under the `[0.10.0]` entry, amended post-publish by `7cd59941`) so they are cited, with the recorded discrepancy that the published 0.10.0 still ships both subpaths and the 0.11.0 cut owns the entry structure. `scripts/release-gate.test.mjs` gained "compat baselines are current for every package with a built `dist/`" (the same diff, runnable without the preflight; negative control = the pre-regeneration 3-package/106-removed state). Plan 107 Task 4 is noted as absorbed, not flipped.

- [x] Task 6: Coverage-stage residue — one core measurement, a Bun build-race leaf, and a re-measured baseline
  - Acceptance Criteria:
    - Functional: `npm run test:coverage` measures the core suite **once** per stage run: the `bun test --coverage` command's captured output and the core row `coverage-summary.mjs` reports come from the same run, through an env seam the runner sets (captured output path + exit code), instead of a second `bun test --coverage` spawn. `node scripts/coverage-summary.mjs` with no seam set still measures the core suite itself, so the standalone entry point keeps today's contract.
    - Functional: the reused path keeps plan 114 §7.1's failure contract: a failing core run still fails the stage with the same redacted tail and the same artifact row shape, the summary never reports a stale core number from an earlier run, and the seam is ignored (measured instead) when the captured exit code is nonzero.
    - Functional: `scripts/phase23-build-race.test.mjs` scenario 4's coverage leaf spawns `bun test --coverage` with the real leaf's `--coverage-exclude`/`--timeout=0` shape, so the emit/consume race runs against the instrument that ships; `--experimental-test-coverage` no longer appears under `scripts/` outside the retired `phase*-freeze` baseline files.
    - Functional: two full `npm run test:coverage` runs are recorded in `docs/_evidence/phase115-suite-budget.md`'s Task 6 note against plan 114 §7.2's 169.7 / 170.2 / 175.8 s baseline, with the gates' numbers unchanged; `scripts/coverage-thresholds.json` changes only if a plan-023-method re-measure says so, never by hand.
    - Functional: `scripts/phase23-coverage.test.mjs` asserts the one-measurement seam (the stage invokes the core coverage command once; the standalone summary still measures and gates) and the Bun build-race leaf, and `scripts/run-all-tests.test.mjs`'s stage-shape and partition assertions stay green.
    - Performance: the recovered target is the second core run (35.9–37.0 s measured under Bun, plan 114 §7.2) and the stage total is reported before/after twice; the trim is reverted if the standalone path regresses or if the first run's row and the summary's row can disagree.
    - Code Quality: no new dependency, no second artifact format — the seam reuses the runner's captured output and the summary's existing parse/redaction path; a `ponytail:` comment names the ceiling if the seam cuts one (for example the captured output lives in a temp file the runner cleans).
    - Security: reused output goes through the same `createSecretRedactor` path as a measured run (repo root and home become `<repo>`/`<home>`, credential-shaped values redacted), no raw output is committed, and the temp path stays inside a gitignored scratch directory.
  - Approach:
    - Documentation Reviewed:
      - `scripts/coverage-summary.mjs` — `runCoverage`, the core-row path, `parseCoverageTable`, and the redaction/tail handling this seam must keep; `package.json` `test:coverage` — the two commands the task fuses.
      - `docs/_evidence/phase114-bun-coverage.md` §7.1 (failure contract) and §7.2 (the 128 s → 169.7 / 170.2 / 175.8 s table and the "runs the core suite twice" note).
      - `scripts/phase23-coverage.test.mjs` — the artifact/row contract and the fake-`bun` crashed-child fixture; `scripts/phase23-build-race.test.mjs` scenario 4 — the Node coverage leaf and its comment saying the point is the race, not the gate.
      - `docs/release-and-install.md` (the coverage row's timing) and `docs/testing.md` (the stage sentence) — the numbers this task updates.
    - Options Considered:
      - Leave the double run — rejected: 36 s of the ~170 s stage re-measures a number the previous command already produced.
      - Have the summary write the artifact and the first command read it — rejected: inverts ownership; the gate must read the artifact, and the runner already holds the first run's output.
      - Drop the first core command and let the summary own the stage — rejected: the first command is the fail-fast signal a contributor sees before the two gate suites, and the summary is still a second spawn for the workspace rows.
      - Keep the Node build-race leaf — rejected: the retired flag now exercises an instrument that no longer ships, so the scenario stops proving anything about the real race.
      - Add `--coverage-reporter=lcov` here for future branch data — rejected: Task 7 owns the branch probe and adds lcov only when a branch number is gated.
    - Chosen Approach: pass the first run's captured core output and exit code to the summary through an env seam (read instead of spawn, measure when absent), swap the build-race leaf onto the Bun instrument, then re-measure twice and record.
    - API Notes and Examples:
      ```bash
      # the shape the runner already has; the seam makes the summary read instead of re-spawn
      bun test --coverage --timeout=0 dist/__tests__/*.test.js > "$core_out" 2>&1
      PRISM_COVERAGE_CORE_OUTPUT="$core_out" PRISM_COVERAGE_CORE_EXIT=$? node scripts/coverage-summary.mjs
      # standalone: no seam set, the summary measures the core suite itself
      node scripts/coverage-summary.mjs
      ```
    - Files to Create/Edit:
      - `scripts/coverage-summary.mjs`: accept the captured-core seam; keep the spawn as the standalone path.
      - `package.json`: `test:coverage` captures the first run's output/exit code and passes the seam.
      - `scripts/phase23-build-race.test.mjs`: scenario 4's coverage leaf onto `bun test --coverage`.
      - `scripts/phase23-coverage.test.mjs`: the one-measurement, standalone, and build-race-leaf assertions.
      - `docs/_evidence/phase115-suite-budget.md`: the Task 6 note (before/after table, decision per item).
      - `docs/release-and-install.md`, `docs/testing.md`: the stage timing sentence updated to the re-measured number.
    - References:
      - Plan 114 Further Actions 3, 4, and 6 — this task is their destination; plan 023's recapture method; `scripts/coverage-failure.mjs` — the redacted-tail path the seam must keep.
  - Test Cases to Write:
    - One measurement: a run with a fake core command shows the summary reading the captured output and spawning only for the workspace rows (assert the invocation count, not the wall clock).
    - Standalone: `node scripts/coverage-summary.mjs` with no seam still measures and gates — the existing plain-run contract.
    - Failure: a captured failing run fails the stage with the same redacted tail and artifact row, and no stale number is reported from an earlier run.
    - Build race: scenario 4 passes with the Bun leaf and still proves no partial `dist/` is observed.
    - Baseline: the recorded before/after table's arithmetic matches two real runs.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no consumer contract; contributor coverage timing and the race fixture's runner change.
    - Docs pages to create/edit: `docs/release-and-install.md` (coverage row number), `docs/testing.md` (stage sentence), `docs/_evidence/phase115-suite-budget.md` (Task 6 note).
    - `docs/index.md` update: no (no new page, no behavior delta).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Executed 2026-09-23 — evidence in `docs/_evidence/phase115-suite-budget.md` §13. All four items landed. **Seam:** `package.json`'s `test:coverage` no longer chains a second core run — it captures the first `bun test --coverage` run's output to gitignored `node_modules/.prism-core-coverage.out`, prints it (`cat`) so the contributor still sees the run, and hands the path plus `$?` to `coverage-summary.mjs` as `PRISM_COVERAGE_CORE_OUTPUT` / `PRISM_COVERAGE_CORE_EXIT`; the summary reads it for the core row and unlinks it (consume-once), so the stage measures the core suite once. `parseRun(output, exitCode)` is now the single parse/redaction path shared by the spawn and the capture, and the seam is trusted only as a pair with exit code exactly `0` and a readable file — absent, empty, mismatched, or non-zero all fall through to a real measurement, so a stale capture can never supply a number. The stage chain is `;`-separated with `rm -f` + `exit $stage_exit`, so the capture is cleaned on every path and a red core run still writes a fresh, self-describing artifact row (it pays one extra ~35 s measured pass — deliberate, red runs only, `ponytail:` ceiling in the source). **Measured:** before 171.8 s on this tree (old shape, run directly) against plan 114 §7.2's 169.7/170.2/175.8 s; after 136.8 s / 137.1 s → ~34.7 s recovered, matching the projected second core run (35.9–37.0 s); the runner's core run reported 35.01 / 34.71 / 34.93 s. The gates' numbers are unchanged — core row byte-identical (`lines 94.48`, `functions 95.21`, `belowThreshold: []`) and the 11 workspace rows agree across artifacts to ≤ 0.01pp (memory 94.39/94.38/94.39, the wobble §7.2 already recorded), so the first run's row and a measured summary's row cannot disagree and `scripts/coverage-thresholds.json` is untouched (no hand-edits, no re-measure claimed). **Race fixture:** `scripts/phase23-build-race.test.mjs` scenario 4 spawns `bun test --coverage --timeout=0 dist/__tests__/index.test.js` from the repo root via `bun` by name (Bun 1.4.2 has no `--coverage-exclude`; the real leaf's scoping is the root `bunfig.toml`), and `importerRan` now requires a non-zero pass count from either runner's summary. **Assertions added** to `scripts/phase23-coverage.test.mjs` (14 tests, up from 10): the seam's one measurement (a fake `bun` logs spawns — exactly `workspaceNames.length`, capture consumed), the standalone contract (seam unset → `workspaceNames.length + 1` spawns, measured failing row), failure honesty (a stale green capture with exit 3 is ignored: measured row, redacted tail, stale number printed nowhere, canary absent from artifact), the script wiring (exactly one `bun test --coverage`, seam vars, cleanup), and a pinned scan proving no live script spawns the retired Node instrument outside the retired baselines and four files that only assert on the string. **Docs:** `docs/release-and-install.md` (measured ~137 s stage + the seam, and the `test:coverage` row) and `docs/testing.md` (one-measurement sentence). Residual: plan 114 Task 2's inline note still quotes the old design (its §7.2 table is superseded here); the retired flag's remaining `scripts/` occurrences are the four negative-assertion files plus `phase1{3,4,5}-baseline.json`.

- [x] Task 7: Re-add the branch floor when the pinned Bun emits branch data (trigger-gated)
  - Acceptance Criteria:
    - Functional: the task first probes the pinned Bun — `bun --version`, then `bun test --coverage --coverage-reporter=lcov` over a branch-bearing file — and records the transcript with the date and version.
    - Functional: if the output still carries no `BRDA`/`BRF`/`BRH` and the text table has no branch column, the task closes as a recorded no-op: the probe plus a `Trigger:` line (the Bun release-notes entry to watch and the next version boundary) is appended to `docs/_evidence/phase114-bun-coverage.md` §2.5, and no flag, floor, or gate changes.
    - Functional: if branch data exists, `scripts/coverage-summary.mjs` parses it (the text column when present, else the lcov `BRF`/`BRH` pair) and `scripts/coverage-thresholds.json` regains `core.branches` plus per-package `branches`, calibrated by plan 023's method (min of two back-to-back runs − 3pp) — never ported from the retired 75; the `branches: null` placeholders and the `ponytail:` ceiling note are deleted in the same edit.
    - Functional: `scripts/phase23-coverage.test.mjs` gates the branch number again (finite, above the floor, present in the artifact), and the pages that name the gate (`docs/release-and-install.md`'s coverage row, `docs/testing.md`'s gate note) name the branch floor in the same change.
    - Functional: the lcov writer is added only where the branch parse needs it (the summary's own spawn), never to `npm run test:coverage` for a number that is not gated.
    - Performance: the no-op path costs one probe; if the parse lands, the lcov write's added seconds are measured and recorded, and the text-table instrument stays the default unless the branch number requires lcov.
    - Code Quality: the parse is one small pure function beside `parseCoverageTable`; nothing else grows, and the null placeholder plus its ceiling comment are the only deletions.
    - Security: the parse reads the same in-repo `coverage/` output; no path leaves the repo, and redaction is verified unchanged (lcov records file paths; a fixture in the tests proves no secret-shaped value is copied into the artifact).
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/phase114-bun-coverage.md` §2.5 — the measured no-branch-data probe and the ceiling this task removes; §1.4/§2.4 — the parsed-table gate decision.
      - `scripts/coverage-summary.mjs` — `parseCoverageTable` and the `branches: null` row; `scripts/coverage-thresholds.json` — the `core` and per-package rows; `scripts/phase23-coverage.test.mjs` — the null-case assertions plan 114 Task 2 wrote.
      - Plan 023's floor method (`docs/_evidence/phase23-*` and the recapture rule in `docs/release-and-install.md`); Bun's test docs for `--coverage-reporter` and the text table's columns.
    - Options Considered:
      - Add an lcov writer now so the number is "available" — rejected: plan 114 §2.5 measured no branch records on the pinned version, so it is a flag with no number and a slower spawn.
      - Gate branches from a third-party reporter — rejected: no new dependency for a number the pinned runner does not emit.
      - Leave the ceiling note and never revisit — rejected: the note names this trigger; a trigger with no owner is folklore.
    - Chosen Approach: probe first, then either a dated no-op record or the full restore (parse + floors + gate + docs) in one change.
    - API Notes and Examples:
      ```bash
      bun --version
      bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage dist/__tests__/*.test.js; grep -c '^BR' coverage/lcov.info
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase114-bun-coverage.md`: §2.5 append (probe, verdict, `Trigger:`, date) on the no-op path.
      - `scripts/coverage-summary.mjs`, `scripts/coverage-thresholds.json`, `scripts/phase23-coverage.test.mjs`: only if the parse and floors land.
      - `docs/release-and-install.md`, `docs/testing.md`: only if a branch floor lands.
    - References:
      - Plan 114 Further Actions 5 — this task is its destination; plan 023's recapture method; Bun's release notes for the pinned line.
  - Test Cases to Write:
    - Probe: the recorded transcript shows the actual `grep -c '^BR'` result (empty or not) and the pinned version, so a no-op is distinguishable from a skipped check.
    - Parse (only if it lands): a fixture lcov with known `BRF`/`BRH` yields the expected percentage; a fixture without branch records still yields `branches: null` rather than 100 or NaN.
    - Gate (only if it lands): `phase23-coverage` fails on a row below the branch floor and passes above it, with the artifact carrying the finite number.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no consumer contract; the contributor coverage gate and its floors change.
    - Docs pages to create/edit: the evidence append on the no-op path; `docs/release-and-install.md` and `docs/testing.md` only if the branch floor lands.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Executed 2026-09-23 — recorded no-op; evidence appended to `docs/_evidence/phase114-bun-coverage.md` §2.6 (digest in `docs/_evidence/phase115-suite-budget.md` §14). Probed the pinned Bun: `bun --version` → `1.4.2`, and `npm view bun dist-tags` shows `latest: 1.4.2` (canary `1.4.2-canary.20260922.1`), so there is no newer release to probe. `bun test --coverage --timeout=0 --coverage-reporter=lcov --coverage-dir=/tmp/bun-lcov-c dist/__tests__/*.test.js` → 2083 pass / 0 fail, exit 0, and the lcov carries 148 `SF:`, 19436 `DA:`, 148 each of `FNF:`/`FNH:`/`LF:`/`LH:`/`TN:` with **0** `BRDA:`, `BRF:`, `BRH:` — 0 lines matching `^BR` at all; a single branch-bearing file (`./dist/__tests__/agent-approval-coverage.test.js`, 43 pass, 49 `SF:`) is the same. The default reporter's table header is still `File | % Funcs | % Lines | Uncovered Line #s` (no branch column), and `--coverage-reporter=lcov` replaces the text reporter rather than adding to it — the reason the lcov probe prints no table. A first probe missing `--timeout=0` timed out two tests (`field policy microbenchmark …` 10.0 s, one unnamed 5.0 s) and counted 2069 tests; the faithful stage flags are the transcript recorded, which is what a re-probe must reproduce. Verdict: no flag, floor, gate, threshold, or doc change — `scripts/coverage-thresholds.json` untouched, the `branches: null` placeholders and the `ponytail:` ceiling in `scripts/coverage-summary.mjs` stay. **Trigger:** re-probe when the pinned Bun moves past 1.4.2; the tracker is [oven-sh/bun#7100](https://github.com/oven-sh/bun/issues/7100) (`enhancement`/`bun:test`, open as of 2026-08-29, no milestone, proposed Phase 2 = "lcov `BRDA`/`BRF`/`BRH`, thresholds"), and the release-notes entry to watch is any `bun test` coverage item naming branch/statement coverage or lcov branch records. At that point this task either closes as a no-op again or executes the restore (parse + `core.branches`/per-package `branches` by plan 023's min-of-two-runs − 3pp, `phase23-coverage` gate, both doc pages).

## Compromises Made

- **The `< 60s` claim was raised, not met (Task 2).** Both measured trims landed — the gate stage's critical-path file split three ways (38.9 → 19.6/21.2 s) and the shared-lock concurrent workspace stage (28.7 → 17.1/17.1 s) — and the suite still measured 71.7/73.9 s, so `docs/release-and-install.md` now pins `< 80s` with a ~72 s baseline. The number is enforced by `src/__tests__/docs.test.ts` against the evidence marker instead of prose, which is the part that stops the drift that produced this plan.
- **The build-race stage grew ~4 s** (10.5 → 14.6/15.0 s) to carry the new reader/writer exclusion tests. Protection bought with wall clock, and the stage that grew is the one that proves the lock change is safe.
- **The workspace pool is bounded at 2 leaves in flight**, a fixed constant, because timing-sensitive package budgets (`memory`, `prism-work` 5 ms source scans) flaked at 3–4 under host load. A `ponytail:` comment names the ceiling and the upgrade path.
- **Task 4 flipped nothing.** Bun 1.4.2 does have `--parallel`, but the root glob cannot flip (Bun resolves a file argument by path suffix, so `dist/__tests__/{content,schema}.test.js` also match workspace files — 2069 → 2083 tests, breaking the every-file-exactly-once partition), and the `prism-core` leaf flip was reverted: 3.67 → 2.15 s inside its own package, but the workspace stage moved only ~0.5 s (16.5 vs 17.0 s median, inside a 15.9–17.3 s spread) and one of six stage runs flaked. Recorded as measured residue with the triggers named; no flag was added to any script.
- **Task 5 absorbed plan 107 Task 4's compat regeneration** (its checkbox stays plan 107's to flip): 3 baseline files, +29/−127, reviewed as a set against the enumerated names, with 106 removals attributed to plan 107 Tasks 2–3 and 21 changed signature lines to plans 108/109/110. The regeneration had to go through `runGates({ updateBaseline: true })` because `node scripts/release.mjs gate` stops at `checkReleaseEvidence` — no coverage artifact was faked to reach the compat leg.
- **Task 6's red-run path pays one extra ~35 s measured pass.** A failing core coverage run still gets a fresh, self-describing artifact row instead of a reused stale one; the alternative (reuse the failed capture's tail) would report a failed run's numbers as the measured truth. Deliberate, red runs only, `ponytail:` ceiling in the source.
- **Task 7 is a no-op with a named trigger.** No branch floor returns on Bun 1.4.2 (0 `BRDA`/`BRF`/`BRH` in 148 files of real lcov output), so the `branches: null` placeholders stay and the ceiling comment is the only pointer. The task's own acceptance criteria allow exactly this, and the trigger (bun#7100, next pin bump) is recorded rather than remembered.
- **Evidence kept its seed mismatches rather than smoothing them.** Task 1 recorded that `dead-export-verify.test.mjs` measured 0.32 s against a 13.9 s seed and that five gate files run 3.1–7.1 s against an "everything else under 3 s" seed claim; Task 5 recorded measured drift counts (0/7/5, 58, 48/14/3) instead of the plan's earlier 7/57/42/15.
- **Two coverage-stage residuals were left in place, named:** plan 114 Task 2's inline note still quotes the superseded double-run design (§13 replaces its table), and the retired `--experimental-test-coverage` string survives in four files that only negative-assert it plus three `phase1{3,4,5}-baseline.json` evidence files (the scan allowlist in `scripts/phase23-coverage.test.mjs` names all seven).
- **Two deliberately unfixed spots, recorded so nobody "fixes" them:** `packages/mcp/src/__tests__/server.test.ts:567` keeps its dist-relative `../server.js` (a spawned child imports built `dist/`; workspace suites never run source), and `scripts/e2e-cli-live.test.mjs:97`'s new `"node"` literal is only exercised on a live run (the file skips without `PRISM_LIVE_PROVIDER_TESTS=1`).

## Further Actions

1. **Branch floor restore — trigger-gated, next pin bump (priority: high when it fires).** Re-probe `bun test --coverage --coverage-reporter=lcov` the moment `packageManager` moves past `bun@1.4.2`; watch [oven-sh/bun#7100](https://github.com/oven-sh/bun/issues/7100) (open, no milestone; its proposed Phase 2 is lcov `BRDA`/`BRF`/`BRH` + thresholds) and any v1.4.x/v1.5 release-notes item naming branch or statement coverage. Restore = parse (`BRF`/`BRH` pair or the text column) + `core.branches`/per-package `branches` calibrated by plan 023's min-of-two-back-to-back-runs − 3pp + the `phase23-coverage` gate + both doc pages; delete the `branches: null` placeholders and the ceiling comment in the same edit. Evidence: `docs/_evidence/phase114-bun-coverage.md` §2.6. **Destination: [117-Bun-Toolchain-Trigger-Follow-Ups.md](117-Bun-Toolchain-Trigger-Follow-Ups.md) Task 1.**
2. **Runner split re-measure at the 1.5.x boundary (priority: medium, trigger-gated).** Two things to re-probe: whether Bun still resolves file arguments by path suffix (the blocker for the root-glob flip — `dist/__tests__/{content,schema}.test.js` matching workspace files), and whether the workspace pool can widen past 2 once the `memory`/`prism-work` 5 ms source-scan budgets are measured under load rather than flaking. The flip rule stays wall clock with an identical pass/fail set, never preference. Evidence: `docs/_evidence/phase113-bun-inventory.md` §12. **Destination: [117-Bun-Toolchain-Trigger-Follow-Ups.md](117-Bun-Toolchain-Trigger-Follow-Ups.md) Task 2.**
3. **Suite-budget headroom is thin (priority: medium).** Measured 71.7–73.9 s against a pinned `< 80s`: ~6–8 s of margin on a quiet host, and the build-race stage alone has ~4 s of run-to-run spread. The next stage addition needs a trim first — the documented order (measure the stage table, split or parallelize a measured serialization, then re-pin) is in `docs/release-and-install.md`'s budget sentence and should be followed rather than raising the number again. **Destination: [117-Bun-Toolchain-Trigger-Follow-Ups.md](117-Bun-Toolchain-Trigger-Follow-Ups.md) Task 3.**
4. **Plan 107's Task 4 checkbox and plan 114 Task 2's inline note are stale (priority: low, plan-text hygiene).** 107's Task 4 was absorbed by Task 5 (the baselines are current; its note says so) but its box is unchecked; 114 Task 2's note describes the coverage stage's pre-§13 shape. Evidence files are append-only history, so the fix is a pointer, not a rewrite. **Destination: [117-Bun-Toolchain-Trigger-Follow-Ups.md](117-Bun-Toolchain-Trigger-Follow-Ups.md) Task 4.**
5. **The retired-flag scan is a pinned allowlist (priority: low).** `scripts/phase23-coverage.test.mjs` names four files that may contain `--experimental-test-coverage` because they only negative-assert it. If a fifth legitimate occurrence appears, replace the allowlist with a rule (for example "only inside an `assert`/`match` argument") instead of extending the list a second time. **Destination: [117-Bun-Toolchain-Trigger-Follow-Ups.md](117-Bun-Toolchain-Trigger-Follow-Ups.md) Task 5.**
6. **`docs/testing.md`'s Node-only-flag list still names `--experimental-test-coverage` (priority: low).** No live script spawns it after Task 6; it stays accurate as a rule (it is still a Node-only flag) but reads as if something uses it. Drop the name when the branch-floor work next touches that bullet. **Destination: [117-Bun-Toolchain-Trigger-Follow-Ups.md](117-Bun-Toolchain-Trigger-Follow-Ups.md) Task 6.**

All six items are ordered one-per-task in [117-Bun-Toolchain-Trigger-Follow-Ups.md](117-Bun-Toolchain-Trigger-Follow-Ups.md), which also names the probe command and the defined close (restore/flip, or a dated no-op with the next version boundary) for each.
