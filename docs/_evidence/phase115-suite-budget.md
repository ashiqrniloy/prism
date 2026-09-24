# Phase 115 — Default-suite budget inventory (plan 115 Task 1)

Measured 2026-09-23 on this host, tree `HEAD` `3129d5cf` with the plan 114/115
working-tree edits present. All timings are wall clock, one machine, same tree.
This file is Task 1's evidence; Task 2 appends its before/after table here.

Host and toolchain: `nproc` 16, `os.availableParallelism()` 16, Node v26.9.0,
Bun 1.4.2. The host is shared: the 15-minute load average was 4.6–5.3 and an
unrelated Rust build held ~2 cores at 100 % during one direct gate re-run. The
three suite runs below ran at load ~3–5; the direct gate re-runs are labelled
where they were contended.

Cold vs warm: all three runs are warm — `node_modules` and `dist/` are present,
and the build stage is a full `tsc` emit every run (no `incremental` flag), so
there is no warm/cold spread to report beyond run-to-run variance. Run 1 followed
the worker-count probe; runs 2–3 followed immediately.

Every timing command printed only stage summaries, durations, and exit codes —
no environment dump.

## 1. Documented claim — location and age

- `docs/release-and-install.md:317`: "**Offline test budget.** The default
  `npm test` (no `PRISM_LIVE_PROVIDER_TESTS`) is pinned at **< 60s** with a
  measured local baseline of ~45s …". The `< 60s` string entered the file in
  `4f75b54e` (2026-07-02, "WIP") — 83 days before this measurement. The line's
  last committed rewrite is `74be1b30c` (2026-09-13, 10 days); the working tree
  carries a further uncommitted rewrite dated 2026-09-23 (plan 114's coverage
  edits).
- `docs/release-and-install.md:466`: "| Network-free + offline test budget | …
  budget pinned `< 60s` (measured baseline above). …" — last changed
  `4f75b54e` (2026-07-02).
- The same paragraph at `:317` carries the coverage numbers (`coverage:summary`
  ~66 s on 16 cores; the whole `test:coverage` stage ~170 s). `test:coverage` is
  not a `STAGES` member — the runner's seven stages are
  `scripts/run-all-tests.mjs:L104`–`L134` — so plan 114's instrument move does
  not change any number in this file.

Executable assertion check (`grep -rn "60s\|budget" scripts/ src/__tests__/ docs/`):

- No test asserts the number. `src/__tests__/docs.test.ts:2484` only asserts that
  `docs/release-and-install.md` contains the phrase "offline test budget";
  `:2415` asserts the phrase "allowed to exceed the `npm test` budget" in
  `docs/index.md`. `scripts/budget-gate.test.mjs:28` is a different budget (the
  cold-import startup ratio), not the suite wall clock.
- `docs/release-and-install.md:317` and `:466` are the only two statements of
  `< 60s`. Conclusion: the claim is prose-only. Nothing executable fails when the
  suite crosses it, which is why it drifted from ~45 s to ~101 s unnoticed.

## 2. Three-run stage table

`node scripts/run-all-tests.mjs`, three consecutive runs, exit 0 each. The
runner's printed stage milliseconds sum to the run wall clock within ~30 ms, so
the stages are strictly serial:

| run | wall | build | performance budget | root suites | sqlite suites | gate suites | build race | workspace suites |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 101836 | 3392 | 3321 | 15320 | 427 | 39684 | 10461 | 29201 |
| 2 | 100566 | 3532 | 3365 | 16577 | 401 | 37877 | 10445 | 28329 |
| 3 | 100057 | 3497 | 4291 | 13661 | 404 | 39185 | 10447 | 28541 |
| mean | 100820 | 3474 | 3659 | 15186 | 411 | 38915 | 10451 | 28690 |

The two slowest stages are `gate suites` (38.9 s mean) and `workspace suites`
(28.7 s mean) — 67 % of the suite between them. `build race` (10.5 s) is the
third; `root suites` (15.2 s) is already parallel across files.

## 3. Gate stage — per-file table and critical path

The file set is exactly the runner's `GATE_FILES` list (41 files), not a
`scripts/*.test.mjs` glob — that glob is 81 files and includes 40 files the
default suite never runs (`scripts/phase23-security.test.mjs`, the retired
`phase11-freeze` … `phase34-freeze` gates). One-shot run over the list:

```text
$ node --test --test-reporter=spec $(node -e 'import("./scripts/run-all-tests.mjs").then(m=>console.log(m.STAGES.find(s=>s.name==="gate suites").args.filter(a=>a.endsWith(".test.mjs")).join(" ")))')
ℹ tests 265 / pass 263 / fail 0 / skipped 2 / duration_ms 42611   # 42.6 s wall
```

The **spec reporter** output does not name the source file per test, so the
per-file table was taken by running each `GATE_FILES` entry alone with the same
reporter (`node --test --test-reporter=spec <file>`), recording the wall clock
and the reporter's `duration_ms`. All 41 exit 0:

| file | wall ms | test ms | exit |
| --- | ---: | ---: | ---: |
| `scripts/release-gate.test.mjs` | 264 | 166 | 0 |
| `scripts/tooling-gate.test.mjs` | 743 | 664 | 0 |
| `scripts/run-all-tests.test.mjs` | 148 | 97 | 0 |
| `scripts/phase8-conformance.test.mjs` | 502 | 462 | 0 |
| `scripts/phase9-conformance.test.mjs` | 1403 | 1351 | 0 |
| `scripts/phase10-conformance.test.mjs` | 590 | 530 | 0 |
| `scripts/phase11-conformance.test.mjs` | 958 | 902 | 0 |
| `scripts/benchmark-0.1.0.test.mjs` | 139 | 88 | 0 |
| `scripts/benchmark-multi-agent.test.mjs` | 815 | 767 | 0 |
| `scripts/benchmark-tool-search.test.mjs` | 225 | 197 | 0 |
| `scripts/benchmark-workflow-loop.test.mjs` | 334 | 303 | 0 |
| `scripts/benchmark-redaction.test.mjs` | 321 | 291 | 0 |
| `scripts/sweep-unused.test.mjs` | 13372 | 13338 | 0 |
| `scripts/dead-export-verify.test.mjs` | 353 | 323 | 0 |
| `scripts/e2e-enterprise-journey.test.mjs` | 3131 | 3102 | 0 |
| `scripts/e2e-coding-journey.test.mjs` | 4062 | 4031 | 0 |
| `scripts/e2e-full-surface.test.mjs` | 7089 | 7058 | 0 |
| `scripts/host-completeness-evidence.test.mjs` | 89 | 57 | 0 |
| `scripts/attention-measurements.test.mjs` | 217 | 187 | 0 |
| `scripts/plan-review-gate.test.mjs` | 87 | 56 | 0 |
| `scripts/phase23-quality-gates.test.mjs` | 11368 | 11336 | 0 |
| `scripts/phase24-truth.test.mjs` | 244 | 208 | 0 |
| `scripts/phase25-bounded-accumulation.test.mjs` | 1509 | 1475 | 0 |
| `scripts/phase27-ha.test.mjs` | 206 | 174 | 0 |
| `scripts/phase27-erp-journey.test.mjs` | 196 | 167 | 0 |
| `scripts/phase37-provider-matrix.test.mjs` | 87 | 54 | 0 |
| `scripts/phase26-index-benchmark.test.mjs` | 264 | 230 | 0 |
| `scripts/obscura-host-conformance.test.mjs` | 5816 | 5785 | 0 |
| `scripts/phase54-package-map.test.mjs` | 339 | 313 | 0 |
| **`scripts/phase54-legacy-registry.test.mjs`** | **33391** | **33363** | **0** |
| `scripts/truth-current.test.mjs` | 209 | 177 | 0 |
| `scripts/scan-secrets.test.mjs` | 102 | 73 | 0 |
| `scripts/packaging-current.test.mjs` | 6126 | 6096 | 0 |
| `scripts/import-hygiene.test.mjs` | 124 | 96 | 0 |
| `scripts/live-matrix.test.mjs` | 318 | 286 | 0 |
| `scripts/e2e-coverage.test.mjs` | 93 | 63 | 0 |
| `scripts/live-doc-check.test.mjs` | 925 | 896 | 0 |
| `scripts/version-literal-gate.test.mjs` | 93 | 66 | 0 |
| `scripts/workflow-liveness.test.mjs` | 105 | 73 | 0 |
| `scripts/wiki-scratch-isolation.test.mjs` | 609 | 580 | 0 |
| `scripts/blocked-gate.test.mjs` | 893 | 860 | 0 |

Decomposition of the stage (same session):

| command | wall | note |
| --- | ---: | --- |
| `node scripts/with-build-lock.mjs node --test <all 41 GATE_FILES>` | 39.1 s | reproduces the suite stage 37.9–39.7 s |
| same list minus `scripts/phase54-legacy-registry.test.mjs` | 15.9 s | the rest of the stage is bounded by `scripts/sweep-unused.test.mjs` (13.4 s) and `scripts/phase23-quality-gates.test.mjs` (11.4 s) |
| `node --test scripts/phase54-legacy-registry.test.mjs` | 33.4 s | the critical file alone |

The gate stage is therefore the critical file plus 5.7 s of dispatch/startup
overhead (39.1 − 33.4). The plan's test case expected the stage within 10 % of
the critical file's serial test time; measured it is +17 %, and the
decomposition shows the excess is not a second bounded file — the rest of the
stage alone finishes in 15.9 s. The critical path is still unambiguous: the
next-largest file is 13.4 s, 2.5× below the critical file. Inside
`scripts/phase54-legacy-registry.test.mjs` (six tests, each scenario with its own
`mkdtemp()` scratch dir) the three slow tests are `:L159` dry-run 6.0 s,
`:L182` apply-idempotent 13.8 s, `:L209` fail-closed/repair 13.5 s — run
serially inside the one file.

Seed comparison (plan text):

- gate stage 36.2 s — reproduced within variance (37.9–39.7 s).
- critical file 36.2 s — reproduced as 33.4 s; the three slow tests now measure
  13.8 / 13.5 / 6.0 s against the seed's 13.8 / 12.6 / 9.6 s.
- `scripts/sweep-unused.test.mjs` 14.2 s — reproduced (13.4 s).
- `scripts/dead-export-verify.test.mjs` 13.9 s — **not reproduced**: measured
  0.32 s (three tests at 95 / 92 / 87 ms; the file spawns
  `scripts/dead-export-verify.mjs` via `process.execPath` and is unchanged since
  `2c5802ca`, 2026-09-05).
- "everything else under 3 s" — **not reproduced**: `scripts/e2e-full-surface.test.mjs`
  7.1 s, `scripts/packaging-current.test.mjs` 6.1 s,
  `scripts/obscura-host-conformance.test.mjs` 5.8 s,
  `scripts/e2e-coding-journey.test.mjs` 4.1 s,
  `scripts/e2e-enterprise-journey.test.mjs` 3.1 s.

None of the seed deltas changes the critical path or the trim decision.

## 4. Workspace stage — per-package table

Runner command: `npm run test --workspaces --if-present`
(`scripts/run-all-tests.mjs:L134`). Per-package numbers from running each
package's own `npm test` serially (`cd packages/<dir> && npm test`), same
session, all exit 0:

| package | wall ms | exit |
| --- | ---: | ---: |
| `@arnilo/prism-acp-agent` | 1089 | 0 |
| `@arnilo/prism-ag-ui` | 5416 | 0 |
| `@arnilo/prism-hooks` | 1948 | 0 |
| `@arnilo/prism-mcp` | 1447 | 0 |
| `@arnilo/prism-memory` | 2052 | 0 |
| `@arnilo/prism-channels` | 1732 | 0 |
| `@arnilo/prism-coding-tools` | 3751 | 0 |
| `@arnilo/prism-core` | 3810 | 0 |
| `@arnilo/prism-providers` | 1136 | 0 |
| `@arnilo/prism-work` | 1260 | 0 |
| `@arnilo/prism-web-tools` | 5425 | 0 |
| **sum** | **29066** | |

Seed comparison: stage 27.5 s vs measured 28.3–29.2 s; per-package sum 28.6 s vs
measured 29.1 s. Every seed row reproduces within ~0.2 s except
`@arnilo/prism-memory` (2.05 s, seed "under 2 s").

## 5. Why the workspace stage is serial — measured

Every package `test` script wraps its leaf in `scripts/with-build-lock.mjs`
(`packages/prism-core/package.json` `test`, same shape in the other ten), and
the lock is exclusive (`scripts/with-build-lock.mjs:L54` `openSync(LOCK, "wx")`;
`:L132` exports `PRISM_BUILD_LOCK_HELD=1` to the child; `:L142` is the
non-nesting guard).

Probe D — two real leaves at once, both acquiring (ag-ui and
prism-coding-tools), child start/end timestamps recorded inside each wrapped
leaf:

```text
$ node scripts/with-build-lock.mjs sh -c 'echo "A child-start $(date +%s%N)"; node --test packages/ag-ui/dist/__tests__/*.test.js; echo "A child-end $(date +%s%N)"' &
$ node scripts/with-build-lock.mjs sh -c 'echo "B child-start $(date +%s%N)"; node --test "packages/prism-coding-tools/dist/**/__tests__/*.test.js"; echo "B child-end $(date +%s%N)"' &
B child-start +0ms,    B child-end +3664ms
A child-start +3741ms, A child-end +9039ms
A 5298 ms; B 3664 ms; B child-start − A child-end = −9039 ms; span 9039 ms = 3664 + 5298 (sum, not max)
```

Control D2 — same pair with `PRISM_BUILD_LOCK_HELD=1` (the guard makes both skip
acquisition):

```text
A child-start +0ms, A child-end +5541ms
B child-start +0ms, B child-end +4671ms
span 5541 ms = max(5541, 4671)
```

Real npm path — two `npm run test -w <pkg>` processes started together, both
acquiring:

```text
ag-ui:     npm start +0ms, end +5404ms
web-tools: npm start +0ms, end +10761ms   (= 5404 + 5357; its leaf waited for the lock)
```

Control with `PRISM_BUILD_LOCK_HELD=1`: `web-tools` 0..5695 ms, `ag-ui`
0..5781 ms, span 5781 ms = max.

Executor probe — `bun run --workspaces --parallel test` exists in Bun 1.4.2
(`bun run --help`: `--parallel  Run multiple scripts concurrently with
Foreman-style output`) and ran all 11 workspaces concurrently: exit 0, wall
**28.55 s** — the same as the serial npm loop and the per-package sum, because
every leaf still takes the exclusive lock. A concurrent executor alone recovers
nothing.

**Which bounds the stage: the exclusive build lock.** The lock probe queues two
leaves even when the parent could run them at once; the
`PRISM_BUILD_LOCK_HELD=1` control overlaps the same pair; and Bun's parallel
executor lands on the serial sum. npm's serial `--workspaces` loop (`:L134`) is
a second serializer but not the binding one — replacing only the executor
changes nothing while the lock stays exclusive (the plan's "parallelize without
touching the lock" option).

## 6. `node --test` worker count

`node --test` defaults to `os.availableParallelism() − 1`. Probe: 32 test files,
each logging start/end to a shared log, all run in one `node --test
'f*.test.mjs'` with 800 ms per file:

```text
$ node --test 'f*.test.mjs'          # 2.57 s wall
events 64  distinct pids 32  max concurrent workers 15
$ node --test --help | grep concurrency
  --test-concurrency=...  specify test runner concurrency
```

Host: `nproc` 16, `os.availableParallelism()` 16, measured worker pool 15. The
gate stage has 41 files over 15 workers, which is why the critical file is
dispatched within the first ~2 s of the stage and the stage lands only ~5.7 s
above the file's own wall clock.

## 7. Trim projection

Baseline means from §2 (ms): build 3474, budget 3659, root 15186, sqlite 411,
gate 38915, race 10451, workspace 28690; total 100.82 s.

| candidate | method (named) | projected stage | recovery | evidence |
| --- | --- | ---: | ---: | --- |
| split the critical-path file | one file per independent `mkdtemp()` scenario (`scripts/phase54-legacy-registry.test.mjs:L159/L182/L209`) so `node --test` workers overlap them; stage ≈ max(rest-of-stage, slowest split file) + dispatch | 16–17 s | 22–23 s | rest-of-stage alone 15.9 s; slowest split scenario 13.2 s alone (`--test-name-pattern`), dry-run 6.0 s, repair 13.1 s |
| shared-reader lock + concurrent workspace executor | readers take a shared lock, `tsc` keeps the exclusive one; the runner executes packages concurrently | 6–7 s | 22–23 s | lock probe control D2 span 5.54 s = max(5.54, 4.67) for two leaves; slowest package 5.43 s (web-tools); `bun run --workspaces --parallel test` 28.55 s with the exclusive lock |
| leave both and raise the number | rewrite `docs/release-and-install.md:317` / `:466` to the measured baseline | 100.8 s | 0 | this inventory |

Projected totals: both trims ≈ 100.8 − 22.5 − 22.5 = **55.8 s** (range 54–58 s
across the three runs); gate-only ≈ 78.3 s; workspace-only ≈ 78.3 s. Against the
`< 60s` claim: it survives **only if both trims land**, and then with ~4 s of
margin — below the plan's ≤55 s "with margin" target in the typical case, above
it in the best case. Neither trim alone is enough. Task 2's two consecutive
runs decide; this projection does not promise the claim.

## 8. Plan 114 interaction

The coverage stage is not a default-suite stage: `STAGES` has seven entries and
none is `test:coverage` (`scripts/run-all-tests.mjs:L104`–`L134`); `npm run
test:coverage` is a separate `package.json` script (core `bun test --coverage`
+ `scripts/coverage-summary.mjs` + `scripts/phase23-coverage.test.mjs` +
`scripts/phase23-skip-manifest.test.mjs`). Plan 114's move to the Bun instrument
therefore changes no number in §2–§4 of this file. The ~66 s / ~170 s coverage
sentences in `docs/release-and-install.md:317` are plan 114's to update, not
this plan's.

## 9. Rejected directions

- `raise the budget first` — rejected: both dominant costs are measured
  structural serialization (§3, §5), so the trim is measured before the claim
  moves.
- `bun test for the whole suite` — rejected: plan 113 §10
  (`phase113-bun-inventory.md`) measured the root glob 2.3× slower under Bun with
  a Bun-only failure; this inventory does not re-open it.
- `drop the gate files` — rejected: they are protection gates; plan 057's
  retirement precedent required content verification, not a timeout.
- `estimate from file size` — rejected: every row above is a measured wall clock,
  not a size heuristic.
- `scripts/*.test.mjs glob` — rejected as the measurement set: the glob is 81
  files against the suite's 41 and includes files the default suite never runs
  (`scripts/phase23-security.test.mjs`, the retired freeze gates).
- `trust npm's docs` — rejected: the workspace stage's serialization is decided
  by the lock probe and the Bun parallel-executor measurement, not by npm
  documentation.

## 10. Security / hygiene

No credentials, no `PRISM_*` secret values, no absolute home paths. Timing
commands printed only stage summaries, durations, and exit codes; no environment
dump was produced.

## 11. Task 2 — applied trims, measured before/after, and the pinned budget

Both trim rows from §7 landed. The gate split removed the 33.4 s critical-path
file; the workspace stage now runs one `npm` process per package through the
runner's bounded pool (`scripts/run-all-tests.mjs`), and every package `test`
script takes the shared reader mode of `scripts/with-build-lock.mjs`
(`--shared`). The original `scripts/phase54-legacy-registry.test.mjs` is
removed; its six scenario tests live in three files that share
`scripts/fixtures/phase54-legacy-registry-fixture.mjs`, all three listed in
`GATE_FILES` (partition assertions in `scripts/run-all-tests.test.mjs`).

### 11.1 Full suite, before and after, twice

Before = §2's three-run table. After = two consecutive
`node scripts/run-all-tests.mjs` runs, exit 0 each, same host (load average
7.4 and 8.7 at start; the 15-minute average stayed 7–10, higher than Task 1's
4.6–5.3, so the after baseline is the conservative one).

| stage | before (mean of 3) | after run 1 | after run 2 | after mean | delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| build | 3474 | 3312 | 3466 | 3389 | −85 (variance) |
| performance budget | 3659 | 3197 | 3232 | 3215 | −444 (variance) |
| root suites | 15186 | 13446 | 13466 | 13456 | −1730 (variance) |
| sqlite suites | 411 | 397 | 383 | 390 | −21 |
| gate suites | 38915 | 19646 | 21190 | 20418 | **−18497** |
| build race | 10451 | 14582 | 15037 | 14810 | **+4359** (new lock tests) |
| workspace suites | 28690 | 17082 | 17075 | 17079 | **−11612** |
| **total** | **100820** | **71690** | **73890** | **72790** | **−28030 (−27.8 %)** |

A third verification run after the docs/gate updates landed (load average 2.1,
the quietest of the set) completed in **70.855 s**, all 7 stages pass — the pin
holds with room on an idle host too.

Per-stage decision: the gate split improves the stage by 18.5 s and the
workspace pool by 11.6 s — both far beyond the ~0.7 s per-stage run-to-run
spread seen in §2 (new-suite wall spread: 71.7/73.9 s = 2.2 s). Neither trim is
reverted. The `build race` stage grows by 4.4 s because it now owns the
reader/writer exclusion tests (§11.3) — a deliberate new gate, not a failed
trim. The build/budget/root deltas are host-load variance, not trims: no
change was made to those stages.

### 11.2 Workspace pool: why 2 workers, measured

`runParallelLeaves` was probed at several bounds (real leaves, same host; each
run's failures listed):

| leaves in flight | wall | failures |
| ---: | ---: | --- |
| 1 (npm serial loop, §4) | 28329–29201 | 0 |
| 2 | 16810, 16826, 17075, 17082 | 0 in 4 runs |
| 3 | 13136, 13633, 13640, 13655, 14351 | 1 (`@arnilo/prism-memory`) in 5 runs |
| 4 | 13225, 13401, 13433, 13542, 13433 | `packages/prism-work` in 2 of 5 runs, once with `packages/memory` |

Real failure propagation (not only the pool unit test): in the c=4 probe runs
that failed, the other nine leaves still ran to completion, their output
streamed, and the stage reported `workspace suites: 2 leaf(s) failed:
packages/prism-work, packages/memory` with a non-zero exit.

The failures are soft real-time ceilings inside the package suites, starved by
the extra `node --test` workers: `packages/prism-work` — `extract 2073ms exceeds
2000ms ceiling` (document-reader max-page envelope); `@arnilo/prism-memory` —
`checks each distinct source once per query, inside the 5ms budget for 50
sources (31.87ms)`. The bound is therefore 2 in-flight packages, with a
`ponytail:` comment on the stage naming that ceiling and the upgrade path
(bound each package's own `node --test` worker count first). The workspace trim
is real but CPU-bound, not lock-bound: at 2 in flight the lock no longer
serializes anything (§11.3), and the stage still takes ~17 s rather than the
~6–7 s §7 projected, because 11 package suites' default worker pools contend.

### 11.3 Lock reader mode: exclusion proofs and reclaim

`scripts/with-build-lock.mjs` gains `--shared`: readers register
`node_modules/.prism-build.lock.readers/<pid>` before checking the lockfile, and
an exclusive acquirer drains that directory after taking the lockfile. All 11
workspace `test` scripts pass `--shared`; `tsc`/build scripts keep the
exclusive default. `scripts/phase23-build-race.test.mjs` proves, with two
concurrent children and observed start/end ordering:

- two shared readers overlap (`A 1260 ms` and `B 1258 ms` windows intersect) —
  the trim's whole point;
- a reader started first makes the writer wait (`R1` ended before `W1` started)
  and a writer started first makes the reader wait (`W2` ended before `R2`
  started) — exclusion in both directions, fail-closed;
- a writer reclaims a dead reader marker (pid beyond the Linux pid max) and an
  abandoned unparseable marker only after the 1 s `UNPARSEABLE_GRACE_MS`
  (asserted ≥ 900 ms wall).

The existing reclaim/live-lock tests stay green, and the non-nesting guard
(`PRISM_BUILD_LOCK_HELD=1`) still makes a grandchild skip acquisition. No second
lock implementation and no new dependency: reader mode is ~90 lines inside the
existing module.

### 11.4 Budget decision

Two consecutive runs landed at **71.690 s** and **73.890 s** — the `< 60s`
claim did **not** survive, exactly as §7 warned (its 55.8 s projection assumed
per-package test times held; §11.2 measured the contention instead). `npm test`
cannot land under 60 s on this host without a higher-bound workspace stage that
flakes its own package budgets, so the documented number moves to the measured
baseline:

<!-- budget: pin="< 110s" baseline_s="92" -->

- Pin: **`< 110s`**; baseline **~92 s** after plan 120 Task 6 (one chain sum,
  including the Node branch-coverage audit at ~20s). The pre-audit pin was
  `< 80s` / ~72 s (71.690 s and 73.890 s).
- `< 75s` was rejected: run 2 left only 1.1 s of margin, inside the measured
  2.2 s run-to-run spread.
- The number and the baseline live in `docs/release-and-install.md:317` and the
  requirements row at `:466`; `src/__tests__/docs.test.ts` asserts they match
  this marker's pin and baseline and fails if any other page restates a
  different pin.
- `docs/testing.md`'s stage table now documents the split gate files and the
  concurrent shared-lock workspace stage; `docs/release-and-install.md:461`'s
  fixture-suite name follows the split; `docs/index.md` needed no change (its
  stage list still names the same seven stages) and `README.md` names the budget
  without a number.

The coverage-stage interaction of §8 is unchanged: `test:coverage` is not a
`STAGES` member, so plan 114 still owns the ~66 s / ~170 s numbers at `:317`.

### 11.5 Security / hygiene

Reader mode keeps the trust boundary the lock exists for: a writer excludes
every reader and a reader excludes writers, proven by the two-child ordering
tests above; a reader that runs while a writer holds the lock is a test failure.
No credentials, no secret values, no absolute home paths were recorded.

## 12. Task 5 — `release:gate` compat leg: absorbed, regenerated, attributed (2026-09-23)

### 12.1 Starting state, measured (not assumed)

Plan 107's Task 4 ("Baseline regeneration and 0.10.0 fold-in") is unchecked, so this task took the
absorption branch. Measured on this tree with `dist/` built, through the gate's own
`extractDeclaredSurface` / `parseSurface` / `diffSurface` (the same call the release gate makes after its
evidence preflight):

| Package | removed | changed | added |
| --- | --- | --- | --- |
| `@arnilo/prism` | 0 | 7 | 5 |
| `@arnilo/prism-memory` | **58** | 0 | 0 |
| `@arnilo/prism-coding-tools` | **48** | 14 | 3 |

The plan's expected figures (memory removed 57, coding-tools removed 42 / changed 15) were written against
an earlier tree state; the measured numbers above are the ones recorded and attributed here. The nine
other packages with a built `dist/` were already clean.

### 12.2 Attribution — every name traced to its owning plan

Removals (the breaking class) were checked name-by-name against the v0.10.0 tag's source trees, not
inferred from the plan text: all 58 `@arnilo/prism-memory` names and all 48
`@arnilo/prism-coding-tools` names appear in `packages/memory/src/graft/`,
`packages/prism-coding-tools/src/{caveman,ponytail,upstream}/` at `v0.10.0` — 106 of 106, zero
unattributed, zero inherited drift in this class.

| Package | Class | Names | Caused by | Breaking? |
| --- | --- | --- | --- | --- |
| `@arnilo/prism-memory` | removed | 58 (`createGraftExtension`, `GraftMode`, `runGraftJson`, `defineGraftTools`, `readBoundedFile`, … — the whole `/graft` surface incl. module-level names the baseline records) | plan 107 Task 3 | yes, intended |
| `@arnilo/prism-coding-tools` | removed | 48 (`createCavemanExtension`, `createPonytailExtension`, `CAVEMAN_LEVELS`, `PONYTAIL_MODES`, `assertSkillsMarker`, `loadUpstreamSkills`, `resolvePeerPackageRoot`, …) | plan 107 Task 2 | yes, intended |
| `@arnilo/prism` | changed | `CheckpointRestoreAudit`, `CheckpointRestoreAuditEntry`, `CheckpointRestoreHook`, `RunCheckpointRestoreHooksOptions` | plan 109 (the `export type {…}` line grew `CheckpointRestoreCompensation` / `CheckpointRestoreHandler`) | no — barrel line |
| `@arnilo/prism` | changed | `RunLimitTrackerOptions` | plan 108 (barrel line grew `BudgetExhaustionAttribution`) | no — barrel line |
| `@arnilo/prism` | changed | `describeBudgetExhaustion` | plan 108 (return is now `BudgetExhaustionAttribution & …`) | no — widened return |
| `@arnilo/prism` | changed | `runCheckpointRestoreHooks` | plan 109 (parameter `CheckpointRestoreHook` → `CheckpointRestoreHandler`) | no — `CheckpointRestoreHandler<T> = CheckpointRestoreHook<T> \| { restore, compensate? }`, i.e. the old hook widened |
| `@arnilo/prism` | added | `CheckpointRestoreCompensation`, `CheckpointRestoreHandler` | plan 109 | additive |
| `@arnilo/prism` | added | `BudgetExhaustionAttribution` | plan 108 | additive |
| `@arnilo/prism` | added | `scorePrefixStability` | plan 110 | additive |
| `@arnilo/prism` | added | `loadSkillDirectory` | plan 107 Task 2 (the replacement for the deleted persona subpaths' bounded reader) | additive |
| `@arnilo/prism-coding-tools` | changed | 12 names on the `lifecycle.js` re-export line (`CodingLifecycleEmitter`, `SubagentStartedEvent`, …) | plan 108 (line grew `SubagentFailure` / `SubagentRecovery` / `SubagentRecoveryOutcome`) | no — barrel line |
| `@arnilo/prism-coding-tools` | changed | `observeSupervisorLifecycle` | plan 108 (parameter is now the named `SupervisorLifecycleSource`) | no — module is not in the package's `exports` map |
| `@arnilo/prism-coding-tools` | changed | `resolveUpstreamRoot` | plan 107 Task 2 (impeccable-only: required options, `ResolvedImpeccableUpstream` return) | not consumer-visible — `dist/upstream/` is not in the package's `exports` map |
| `@arnilo/prism-coding-tools` | added | `SubagentFailure`, `SubagentRecovery`, `SubagentRecoveryOutcome` | plan 108 | additive |

So: the removals are plan 107's (its own, unregenerated); the signature churn is inherited drift from
plans 108 / 109 / 110 and is additive apart from the two internal-module changes above. No drift in this
diff belongs to plan 115.

### 12.3 Regeneration and the preflight limitation

`node scripts/release.mjs gate` in a fresh tree stops before the compat leg, exactly as the plan states:

```text
$ node scripts/release.mjs gate
release evidence blocked — cannot release:
- @arnilo/prism-ag-ui suite: no coverage-summary.json evidence (run npm run test:coverage first)
- @arnilo/prism-hooks suite: no coverage-summary.json evidence (run npm run test:coverage first)
- @arnilo/prism-mcp suite: no coverage-summary.json evidence (run npm run test:coverage first)
- @arnilo/prism-memory suite: no coverage-summary.json evidence (run npm run test:coverage first)
- @arnilo/prism-channels suite: no coverage-summary.json evidence (run npm run test:coverage first)
- @arnilo/prism-coding-tools suite: no coverage-summary.json evidence (run npm run test:coverage first)
- @arnilo/prism-providers suite: no coverage-summary.json evidence (run npm run test:coverage first)
- @arnilo/prism-web-tools suite: no coverage-summary.json evidence (run npm run test:coverage first)
- test:postgres durable conformance: PRISM_TEST_POSTGRES_URL not set at release-evidence time (required env PRISM_TEST_POSTGRES_URL)
```

Nine coverage rows and the postgres row; `checkReleaseEvidence` throws before `runGates`, and it throws for
`--update-baseline` too (the flag is parsed after the same preflight). No coverage artifact was faked to
get past it — the regeneration and the verification both went through the gate's own functions instead:

```text
$ node --input-type=module -e '…g.runGates({ release, version: "0.10.0", updateBaseline: true })'
(ranges leg reports 0 errors at 0.10.0; compat leg writes all 12 baselines; tarball deny list passes)
$ git diff --stat scripts/compat-baseline/
 .../compat-baseline/arnilo__prism-coding-tools.txt | 79 +++++-----------------
 scripts/compat-baseline/arnilo__prism-memory.txt   | 58 ----------------
 scripts/compat-baseline/arnilo__prism.txt          | 19 ++++--
 3 files changed, 29 insertions(+), 127 deletions(-)
```

Baseline-diff review (plan 107 Task 4's "reviewed line-by-line" criterion, done as a set comparison
instead of by eye): parsing `HEAD`'s three files against the regenerated ones yields removed 0 / changed 7
/ added 5 for `@arnilo/prism`, removed 58 / changed 0 / added 0 for `@arnilo/prism-memory`, and removed 48
/ changed 14 / added 3 for `@arnilo/prism-coding-tools` — identical to the pre-regeneration measurement in
§12.1, so no export was dropped beyond the intended 106 and nothing else was silently re-serialized. The
eight untouched packages were rewritten byte-identically (their files are not in the diff).

After regeneration, the same helper reports **12 packages clean, 0 dirty**, and the full gate machinery
passes (compat leg included, `--skip-tarball` not needed):

```text
GATE OK: {"version":"0.10.0","updated":false,"packages":12}
```

The gate now has a regression test for exactly this state: `scripts/release-gate.test.mjs` —
"compat baselines are current for every package with a built `dist/`" — computes the same diff for every
package and fails with the offending names, so a future plan that removes a public name without
regenerating fails the gate suite instead of the release. Negative control: before §12.3's regeneration
the same loop reported the three packages with 106 removed and 21 changed names (the §12.1 table), so the
check has teeth; after it, 13/13 tests pass.

### 12.4 Consumer-facing record

- `docs/migration.md`: new `## 0.10.0 → 0.11.0 (behavior persona and graft subpath removals)` section —
  both subpaths, their peers, their replacements (`loadSkillDirectory` + host extension; graft as an MCP
  server or `registerTool` / `registerCommand`), the 106-name removal count, and the additive list. The
  0.10.0 section's "Nothing was removed" line is now scoped to 0.10.0 itself and points at the 0.11.0
  section, so it no longer contradicts the changelog.
- `CHANGELOG.md` already carries both removals (lines 24–25, under the `[0.10.0]` entry — amended after the
  publish by commit `7cd59941`), so this task cites them instead of editing. Recorded discrepancy: the
  published 0.10.0 (tag `v0.10.0`, commit `974ac8ca`) still ships both subpaths, so the removals reach
  consumers with the next cut, not with 0.10.0. The 0.11.0 cut owns whether those lines move under its own
  entry; this task does not restructure a released entry.
- Ownership: plan 107 Task 4 is absorbed, not flipped — the task note there records what landed
  (baselines regenerated, attributed, gate green) and what its own acceptance still owns
  (`scripts/package-truth.json` refresh, `docs/release-and-install.md` counts, the release cut's
  verification).

### 12.5 Security / hygiene

No `npm publish`, no registry write, no `--allow-break`, no migration-note override: the compat leg is
green because the baselines match the tree, not because a break was declared. The tarball leg packs
locally (`npm pack --dry-run`-style paths) with no network. No credentials or secret values were read or
recorded; the only environment value consulted is the unset `PRISM_TEST_POSTGRES_URL`, quoted above as the
preflight prints it.

## 13. Task 6 — the coverage stage measures the core suite once (2026-09-23)

Plan 114 §7.2 left the stage at 169.7 / 170.2 / 175.8 s with a recorded cause: `npm run test:coverage`
ran the core suite twice (`bun test --coverage` in the stage, then again inside
`coverage-summary.mjs`), ~36 s of the total re-measuring a number the previous command had already
produced. This task fuses those two runs through a capture seam, swaps the build-race fixture's
coverage leaf onto the instrument that ships, and re-measures.

### 13.1 Before / after, measured

Same host (16 CPUs, load ~2), warm, wall clock. "Before" is §7.2's table plus one run of the exact
old stage shape on this tree (run directly, no seam); "after" is `npm run test:coverage` twice.

| Stage piece | Before | After |
| --- | --- | --- |
| first core `bun test --coverage` (runner) | 35.0 s | 34.7 / 34.9 s (captured, then reused) |
| `coverage-summary.mjs` core row | second 35 s spawn | read from the capture (0 s) |
| `coverage-summary.mjs` workspace rows (11) | ~31 s | ~31 s (unchanged) |
| `phase23-coverage` + `phase23-skip-manifest` | ~66 s incl. the fail-closed rerun | ~66 s (unchanged) |
| **full `npm run test:coverage`** | **169.7 / 170.2 / 175.8 s** (§7.2) · **171.8 s** (this tree, old shape) | **136.8 / 137.1 s** |

Recovered: 171.8 − 137.1 = **34.7 s** on this tree, against the 35.9–37.0 s the plan projected for
the second core run. Stage shape after the task: the core suite is measured twice per stage — once by
the runner (reused by the summary) and once by the `phase23-coverage` fail-closed rerun, which must
measure for itself because it exercises a sabotaged thresholds file — and the workspace rows twice
(the summary, then the rerun).

The gates' numbers are unchanged, which is the guard the plan set: the core row is byte-identical
before/after (`lines 94.48`, `functions 95.21`, gate `lines>=91.48 functions>=92.21`,
`belowThreshold: []`), and the 11 workspace rows match across the three artifacts to ≤ 0.01pp
(only `@arnilo/prism-memory` moved, 94.39 → 94.38 → 94.39 — the same 0.01pp wobble §7.2 recorded,
three orders of magnitude inside the 3pp margin). So the captured first run's row and the row a
measured summary produces cannot disagree: they are the same command shape, and the seam does not
change what is parsed.

### 13.2 Decision per item

| Item | Decision | Why |
| --- | --- | --- |
| Reuse the first run instead of a second spawn | taken | 34.7 s recovered; the row is the same parse of the same command |
| Summary writes the artifact for the first command to gate | rejected | inverts ownership — the gate reads the artifact, the runner holds the run |
| Drop the first command, summary owns the stage | rejected | the first command is the fail-fast signal a contributor sees before the two gate suites |
| Keep the Node build-race leaf | rejected | `--experimental-test-coverage` exercises an instrument that no longer ships |
| Add `--coverage-reporter=lcov` now for future branch data | rejected | Task 7 owns the branch probe and adds lcov only when a branch number is gated |

### 13.3 The seam, and its failure contract

`package.json` now captures instead of chaining:

```text
node scripts/with-build-lock.mjs bun test --coverage --timeout=0 dist/__tests__/*.test.js \
  > node_modules/.prism-core-coverage.out 2>&1; core_exit=$?; cat node_modules/.prism-core-coverage.out; \
  PRISM_COVERAGE_CORE_OUTPUT=node_modules/.prism-core-coverage.out PRISM_COVERAGE_CORE_EXIT=$core_exit \
  node scripts/with-build-lock.mjs node scripts/coverage-summary.mjs && node --test scripts/phase23-coverage.test.mjs \
  && node --test scripts/phase23-skip-manifest.test.mjs; stage_exit=$?; rm -f node_modules/.prism-core-coverage.out; exit $stage_exit
```

`coverage-summary.mjs` trusts the pair only when both vars are set, the exit code is exactly `0`, and
the capture exists; it unlinks the capture as it reads it (consume-once), so nothing can reuse a
previous stage's numbers. Four consequences are asserted, not assumed
(`scripts/phase23-coverage.test.mjs`, a fake `bun` on `PATH` that logs every spawn and fails):

- **one measurement** — with the seam set, `bun` is spawned exactly `workspaceNames.length` times and
  the core row is the captured `99.50 / 99.60` (a fake bun would have destroyed a real core spawn);
  the capture is gone afterwards. The run asserts the spawn count, not the wall clock.
- **standalone** — with the seam unset (empty vars, which also survives a leaked parent value, since
  only the exact string `0` is trusted) the summary spawns the core child like before:
  `workspaceNames.length + 1` spawns, core row `status: "failed"`, `exitCode: 3`, `lines: null`.
- **failure honesty** — a capture carrying a stale green aggregate with `PRISM_COVERAGE_CORE_EXIT=3`
  is ignored (the file is left for the runner to clean), the core row is the measured failing row
  with the redacted tail `boom: token=[REDACTED]`, the stale `99.50` is printed nowhere, and the
  canary env value reaches neither stdout nor the artifact.
- **no live Node instrument** — a scan of `scripts/` (excluding retired `phase*-baseline.json`
  evidence and the four files that only negative-assert the flag: this suite, `run-all-tests.test.mjs`,
  `tooling-gate.test.mjs`, `plan-review-gate.test.mjs`) is empty, and scenario 4's leaf is pinned to
  `["test", "--coverage", "--timeout=0"]` spawned through `bun` by name.

Failure contract kept (plan 114 §7.1): a failing core run still fails the stage, and the artifact row
shape is unchanged. A red stage now runs the summary anyway — the stage chain is `;`-separated so the
artifact is fresh — which means a failing core run pays one extra measured pass (~35 s) to produce a
self-describing row instead of a stale artifact. That cost is deliberate and only paid on red runs
(`ponytail:` ceiling noted in the source).

### 13.4 Build-race leaf

Scenario 4 now spawns the real leaf, `bun test --coverage --timeout=0 dist/__tests__/index.test.js`
from the repo root, concurrently with `npm run build:core`. Bun 1.4.2 has no `--coverage-exclude`
flag (`bun test --help`: only `--coverage`, `--coverage-reporter`, `--coverage-dir`), so the real
leaf's scoping is the root `bunfig.toml` — the race fixture runs the same cwd + config + flags the
stage does, minus the gate. `importerRan` now accepts Bun's summary (` N pass`) as well as Node's
(`ℹ pass N`) and requires a non-zero count, so a vacuous leaf still fails the scenario. The full gate
suite, including this scenario, passes: `npm test`'s build-race stage 14.5 s (Task 2's table: 10.4 s
then 14.5 s across runs) with all seven stages green.

### 13.5 Docs, thresholds, security

- `docs/release-and-install.md`: the coverage paragraph now carries the measured ~137 s stage and the
  capture seam, and the `npm run test:coverage` row says the core row is parsed from the first run.
  `docs/testing.md`: the Bun/Node split sentence names the one-measurement stage.
- `scripts/coverage-thresholds.json`: **untouched** — no plan-023-method re-measure was claimed, and
  the three artifacts' rows agree to ≤ 0.01pp, so no floor changed. Nothing was hand-edited.
- Security: the reused output goes through the same `createSecretRedactor` path as a measured run
  (proved by the failure-honesty test's canary), no raw child output is committed, and the capture
  lives at the gitignored `node_modules/.prism-core-coverage.out` (`.gitignore` line 5) which the
  stage removes on every exit path — verified absent after both measured runs.

## 14. Task 7 — branch-floor probe digest (2026-09-23): recorded no-op

Full record in `docs/_evidence/phase114-bun-coverage.md` §2.6 (the section Task 7's acceptance criteria
name). Digest, so this plan's evidence carries the transcript too:

```text
$ bun --version                                     # packageManager: bun@1.4.2; npm dist-tags latest: 1.4.2
1.4.2

$ bun test --coverage --timeout=0 --coverage-reporter=lcov --coverage-dir=/tmp/bun-lcov-c dist/__tests__/*.test.js
 2083 pass / 0 fail, exit 0, [35.60s]

$ grep -c '^BR' /tmp/bun-lcov-c/lcov.info   0     # BRDA: 0, BRF: 0, BRH: 0
$ grep -c '^SF:' … 148   '^DA:' … 19436   '^FNF:' … 148   '^FNH:' … 148
```

Text table (default reporter) header unchanged: `File | % Funcs | % Lines | Uncovered Line #s` — no
branch column; `--coverage-reporter=lcov` replaces the text reporter, so the lcov probe prints no table.
A first probe without `--timeout=0` timed out two tests (10.0 s + 5.0 s) and counted 2069 tests — the
faithful stage flags are the transcript above.

**Verdict:** no flag, floor, gate, threshold, or doc change; `scripts/coverage-thresholds.json` and the
`branches: null` placeholders stay. **Trigger:** re-probe when the pin moves past 1.4.2 — tracker
[oven-sh/bun#7100](https://github.com/oven-sh/bun/issues/7100) (open, `enhancement`/`bun:test`, no
milestone; proposed Phase 2 is lcov `BRDA`/`BRF`/`BRH` + thresholds), watching any v1.4.x/v1.5
release-notes item that names branch or statement coverage.

## 15. Plan 117 Task 3 re-probe — budget holds, no re-pin (2026-09-23)

Plan 117 Task 3's trigger: a new stage or test file joins the default suite, or two consecutive `npm test`
runs measure more than the pinned number minus 4 s (`< 80s` today, so > 76 s). Neither fired on this
tree. Host: 16 CPUs (`nproc`, AMD Ryzen 9 PRO 7940HS), Node v26.9.0, Bun 1.4.2. Four consecutive
`npm test` runs, wall clock by `date +%s%3N`, exit 0 each, all 7 stages pass each time:

| run | wall | load (1m/5m/15m, at start) | build | perf | root | sqlite | gate | race | workspace |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | **70.724 s** | 0.76 / 0.69 / 1.10 | 3257 | 3124 | 12998 | 414 | 19205 | 14656 | 16955 |
| 2 | **71.791 s** | 10.34 / 3.41 / 2.01 | 3351 | 3253 | 13470 | 426 | 19347 | 14786 | 17057 |
| 3 | **76.450 s** | 10.01 / 4.93 / 2.65 | 3659 | 3232 | 13121 | 379 | 24406 | 14692 | 16852 |
| 4 | **74.277 s** | 9.31 / 6.78 / 3.59 | 3394 | 3424 | 13967 | 424 | 20870 | 14817 | 17277 |

Per-stage ms sum to each wall clock (±115 ms of runner overhead). Run 3 is the only one over the 76 s
trigger line, by 0.45 s, and its excess is one stage: gate suites 24.406 s against 19.205 / 19.347 /
20.870 s in the other runs — a host-load spike (the 1-minute average reached 13.71 during that run),
not a suite change. Run 4 immediately after landed at 74.277 s with the same 7 stages, so this is not
the **two consecutive** > 76 s runs the trigger defines. The pin keeps 3.55 s of margin even on run 3,
and the spread across the four runs (70.7–76.5 s) is wider than §11.1's 2.2 s because the host was
busier (plan 115's third verification run at load 2.1 measured 70.855 s).

**No stage or test file joined the suite.** `STAGES` is the same seven stages in the same order with the
same runners that `docs/testing.md`'s table documents (names verified row-by-row against `STAGES`,
including the 11-leaf `npm run test --workspace <dir> --if-present` workspace stage at pool width 2 and
the split `phase54-legacy-registry-{dry-run,apply,fail-closed}` gate files), and
`scripts/run-all-tests.test.mjs`'s partition, pool-bound, and failure-propagation assertions pass 14/14.

Standalone gate stage for the task's method (43 `GATE_FILES`, one run, rc 0, 271 tests = 269 pass /
2 skip / 0 fail, wall **20.227 s**); per-file times aggregated from the junit reporter, top of the
critical path:

| gate file | tests | ms |
| --- | ---: | ---: |
| `phase54-legacy-registry-apply.test.mjs` | 2 | 18634 |
| `phase54-legacy-registry-fail-closed.test.mjs` | 1 | 18468 |
| `phase23-quality-gates.test.mjs` | 5 | 16809 |
| `sweep-unused.test.mjs` | 3 | 14975 |
| `packaging-current.test.mjs` | 40 | 12058 |
| `phase54-legacy-registry-dry-run.test.mjs` | 3 | 10720 |

43-file sum 112.5 s over Node's default worker pool → 20.2 s wall, so the stage is still bounded by its
longest single file (18.6 s) and §11.1's three-way split still does the work it was measured for. No new
serialization appeared, so there is no new trim target.

Per-package workspace timings, sequential, each leaf exactly as the stage runs it
(`npm run test --workspace <dir> --if-present`, shared lock; load 7.07 / 7.87 / 4.68 at start,
5.83 / 7.54 / 4.67 at end):

| package | wall |
| --- | ---: |
| `web-tools` | 5446 ms |
| `ag-ui` | 5410 ms |
| `prism-core` | 3928 ms |
| `prism-coding-tools` | 3691 ms |
| `hooks` | 1979 ms |
| `memory` | 1916 ms |
| `prism-channels` | 1747 ms |
| `mcp` | 1447 ms |
| `prism-work` | 1205 ms |
| `prism-providers` | 1158 ms |
| `acp-agent` | 1138 ms |

The serial sum is 27.065 s against a stage wall of 16.955 / 17.057 / 16.852 / 17.277 s across the four
runs — the pool of 2 already overlaps the two ~5.4 s leaves with the rest (§11.2's width stands; nothing
widened, nothing reverted).

Pin consistency, unchanged in this task: the marker above (`pin="< 80s" baseline_s="72"`),
`docs/release-and-install.md:317`'s sentence and its `:466` requirements row, and `docs/testing.md`'s
seven-row stage table all name the same number and the same stage breakdown;
`src/__tests__/docs.test.ts`'s "the offline test budget is pinned once and matches the measured evidence
baseline" passes in this session (including its any-other-page-restating-a-different-pin scan).

**Verdict: recorded no-op.** No trim, no re-pin, no page edit: the pinned `< 80s` held on every run
(worst 76.450 s at load 13.71), and one over-threshold run explained by host load is not the
consecutive-run drift the trigger defines. The workspace pool stays at 2 and the gate split stays as
§11.1 measured it.

**Trigger (unchanged):** re-measure when a stage or test file joins the default suite, or when two
consecutive `npm test` runs exceed 76 s. Then the order is §11's: three-run stage table, trim the
measured serialization, and re-pin the marker plus the two doc statements in one change.

## 16. Plan 117 Task 5 re-probe — allowlist still sound, and the shape rule needs carve-outs (2026-09-23)

Trigger: a fifth `scripts/` file legitimately containing `--experimental-test-coverage`, or the
allowlist needing a second extension. Neither fired — the occurrence set is exactly what the scan
documents (four negative-assertion files plus the three retired baselines):

```text
$ grep -rn -- '--experimental-test-coverage' scripts/ | sed 's/:.*//' | sort | uniq -c
      5 scripts/phase23-coverage.test.mjs
      4 scripts/tooling-gate.test.mjs
      1 scripts/run-all-tests.test.mjs
      1 scripts/plan-review-gate.test.mjs
      1 scripts/phase15-baseline.json
      1 scripts/phase14-baseline.json
      1 scripts/phase13-baseline.json
```

Seven entries, no eighth; the three `phase1{3,4,5}-baseline.json` files stay covered by the scan's
`-baseline.json` exclusion (the sibling `freeze` filter is inert today: no `*freeze*` entry in
`scripts/` carries the flag). The scan test itself passes,
`node --test --test-name-pattern='retired Node coverage instrument' scripts/phase23-coverage.test.mjs`
= 1/1 (the suite is 14/14), and one read pass over the 190 `.mjs`/`.js`/`.json` entries costs 3.2 ms.

### 16.1 What the four allowlisted files' 11 lines actually are

Each occurrence in the four files was classified by line shape, because that classification is the
rule Task 5 would install:

| file:line | shape | text |
| --- | --- | --- |
| `tooling-gate.test.mjs:99` | comment | `// \`--experimental-test-coverage\`) must run \`node\` by name …` |
| `tooling-gate.test.mjs:104` | rule regex | `const NODE_ONLY = /--test\b\|--test-isolation\|--experimental-test-coverage/;` |
| `tooling-gate.test.mjs:130` | fixture body | `` `spawnSync(process.execPath, ["--experimental-test-coverage", …]);`, `` |
| `tooling-gate.test.mjs:156` | assertion needle | `assert.ok(!scripts["test:coverage"].includes(…)` |
| `phase23-coverage.test.mjs:81` | assertion needle | `assert.ok(!source.includes(…))` |
| `phase23-coverage.test.mjs:112` | assertion needle | `!JSON.stringify(pkg.scripts).includes(…)` |
| `phase23-coverage.test.mjs:113` | assertion message | `"no default script may keep --experimental-test-coverage"` |
| `phase23-coverage.test.mjs:237` | assertion needle | the scan's own `.filter(… .includes(‑‑experimental-test-coverage))` |
| `phase23-coverage.test.mjs:240` | assertion needle | `assert.ok(!race.includes(…))` |
| `run-all-tests.test.mjs:153` | assertion needle | `assert.ok(!JSON.stringify(bunArgs).includes(…))` |
| `plan-review-gate.test.mjs:446` | token-list string | a `--experimental-test-coverage` entry in plan 113's registered keyword list |

No line is a spawn argument list, so the allowlist hides nothing live: the scan is sound as written.

### 16.2 Why the rule did not land today

Five of the eleven lines are not the assert-needle shape the acceptance criteria sketch
(`assert\.…|includes\(`): the comment, the rule regex, the fixture body, the multi-line assert's
**message** string, and the plan-review-gate keyword-list entry. A rule has to name those four extra
shapes (comment, regex literal, fixture body, list string) to spare the files it must spare — a shape
list about as long as the four-name list it would replace, which is exactly why the trigger asks for a
fifth *legitimate* file rather than a rewrite on principle. At 4 files the filename set stays the
simpler correct form.

**Verdict: recorded no-op.** No edit to `scripts/phase23-coverage.test.mjs`; the `NEGATIVE_ASSERTIONS`
set, the `-baseline.json`/`freeze` exclusions, and the build-race assertions stay. **Trigger
(unchanged):** a fifth `scripts/` file legitimately carrying the flag, or the allowlist needing a second
extension — then replace the filename set with an occurrence-shape rule that allows the four shapes
above and still fails a flag that reaches a spawn argument list (naming the file), keeping the retired
baselines excluded by name and re-proving the existing fixtures.

## 17. Plan 119 Task 1 — branch-floor probe digest (2026-09-24): recorded no-op

Full record in `docs/_evidence/phase114-bun-coverage.md` §2.8 (the section Task 1's acceptance
criteria name). Digest, so this plan's evidence carries the transcript too:

```text
$ bun --version                                     # packageManager: bun@1.4.2; npm dist-tags latest: 1.4.2
1.4.2                                               # canary 1.4.2-canary.20260923.1 — same line

$ bun test --coverage --timeout=0 --coverage-reporter=lcov --coverage-dir=/tmp/bun-lcov-p119 dist/__tests__/*.test.js
 2083 pass / 0 fail / 162 files, exit 0, [35.17s], 35.196 s wall

$ grep -c '^BR' /tmp/bun-lcov-p119/lcov.info   0     # BRDA: 0, BRF: 0, BRH: 0
$ grep -c '^SF:' … 148   '^DA:' … 19436   '^FNF:' … 148   '^FNH:' … 148

$ bun test --coverage --timeout=0 --coverage-reporter=lcov --coverage-dir=/tmp/bun-lcov-p119-one dist/__tests__/agent-approval-coverage.test.js
 43 pass / 0 fail; 49 SF:, 0 ^BR                # single branch-bearing file control
```

Text table (default reporter) header unchanged: `File | % Funcs | % Lines | Uncovered Line #s` — no
branch column; `--coverage-reporter=lcov` replaces the text reporter, so the lcov probe prints no table.

**Verdict:** no flag, floor, gate, threshold, or doc change; `scripts/coverage-thresholds.json` and the
`branches: null` placeholders stay. **Trigger:** re-probe when the pin moves past 1.4.2 — tracker
[oven-sh/bun#7100](https://github.com/oven-sh/bun/issues/7100) (open, `enhancement`/`bun:test`, no
milestone; proposed Phase 2 is lcov `BRDA`/`BRF`/`BRH` + thresholds), watching any v1.4.x/v1.5
release-notes item that names branch or statement coverage.

## 18. Plan 119 Task 2 re-probe — budget holds, no re-pin (2026-09-24)

Plan 119 Task 2's trigger: a stage or test file joins the default suite (`STAGES`/`GATE_FILES`
change), or two consecutive `npm test` runs measure more than the pinned number minus 4 s (`< 80s`
today, so > 76 s), or the documented number must rise for any other reason. None fired on this tree.
Host: 16 CPUs (`nproc`, AMD Ryzen 9 PRO 7940HS), Node v26.9.0, Bun 1.4.2. Five consecutive
`npm test` runs (the method's triple plus two confirmation runs, following §15's run-4 precedent),
wall clock by `date +%s%3N`, exit 0 each, all 7 stages pass each time:

| run | wall | load (1m/5m/15m, at start) | build | perf | root | sqlite | gate | race | workspace |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | **77.736 s** | 1.94 / 1.38 / 1.33 | 3412 | 3329 | 14034 | 436 | 24011 | 14874 | 17532 |
| 2 | **73.153 s** | 11.85 / 4.45 / 2.40 | 3387 | 3337 | 13723 | 428 | 20191 | 14773 | 17202 |
| 3 | **73.063 s** | 9.53 / 5.50 / 2.93 | 3390 | 3281 | 13587 | 433 | 20100 | 14861 | 17312 |
| 4 | **73.427 s** | 8.88 / 6.97 / 3.75 | 3421 | 3290 | 13599 | 408 | 20060 | 14704 | 17826 |
| 5 | **74.049 s** | 9.21 / 7.86 / 4.34 | 3464 | 3316 | 14344 | 418 | 20369 | 14732 | 17300 |

Per-stage ms sum to each wall clock within ±120 ms of runner overhead (77628/73041/72964/73308/73943).
Run 1 is the only one over the 76 s trigger line, and its excess is one stage: gate suites 24.011 s
against 20.060–20.369 s in runs 2–5 — a 3.8 s spike that accounts for essentially all of run 1's
4.58 s margin over run 2 while every other stage stayed within its spread. No two consecutive runs
exceed 76 s (pairs: 77.7/73.2, 73.2/73.1, 73.1/73.4, 73.4/74.0), so this is not the
two-consecutive-run drift the trigger defines; the pin keeps 2.26 s of margin even on the worst run.

**No stage or test file joined the suite.** `STAGES` is the same seven stages in the same order with
the same runners that `docs/testing.md`'s table documents (names verified row-by-row, including the
11-leaf `npm run test --workspace <dir> --if-present` workspace stage at pool width 2 and the split
`phase54-legacy-registry-{dry-run,apply,fail-closed}` gate files), and `GATE_FILES` is still the same
43 entries. `scripts/run-all-tests.test.mjs`'s partition, pool-bound, and failure-propagation
assertions pass 14/14.

Standalone gate stage for the task's method (43 `GATE_FILES`, one run, rc 0, 271 tests = 269 pass /
2 skip / 0 fail, wall **21.016 s**); per-file times aggregated from the junit reporter, top of the
critical path:

| gate file | tests | time |
| --- | ---: | ---: |
| `phase54-legacy-registry-apply.test.mjs` | 2 | 19.460 s |
| `phase54-legacy-registry-fail-closed.test.mjs` | 1 | 19.321 s |
| `phase23-quality-gates.test.mjs` | 5 | 17.417 s |
| `sweep-unused.test.mjs` | 3 | 15.650 s |
| `packaging-current.test.mjs` | 40 | 11.975 s |
| `phase54-legacy-registry-dry-run.test.mjs` | 3 | 10.681 s |

43-file sum 115.480 s over Node's default worker pool → 21.0 s wall, so the stage is still bounded by
its longest single file (19.5 s) and §11.1's three-way split still does the work it was measured for.
No new serialization appeared, so there is no new trim target; the standalone 21.0 s also confirms
run 1's 24.0 s gate was an environmental spike, not a shape change.

Per-package workspace timings, sequential, each leaf exactly as the stage runs it
(`npm run test --workspace <dir> --if-present`, shared lock; load 8.26 / 8.83 / 5.30 at start,
8.98 / 8.95 / 5.47 at end):

| package | wall |
| --- | ---: |
| `web-tools` | 5445 ms |
| `ag-ui` | 5409 ms |
| `prism-coding-tools` | 5197 ms |
| `prism-core` | 3983 ms |
| `prism-channels` | 2020 ms |
| `hooks` | 1976 ms |
| `memory` | 1959 ms |
| `mcp` | 1424 ms |
| `prism-work` | 1247 ms |
| `prism-providers` | 1176 ms |
| `acp-agent` | 1113 ms |

The serial sum is 30.949 s against a stage wall of 17.202 / 17.312 / 17.826 / 17.300 s across runs
2–5 — the pool of 2 already overlaps the two ~5.4 s leaves with the rest (§11.2's width stands;
nothing widened, nothing reverted). `prism-coding-tools` measured 5197 ms against §15's 3691 ms at a
similar load, but it is not on the pool-2 critical path, so it does not change the bound.

Pin consistency, unchanged in this task: the marker (`pin="< 80s" baseline_s="72"`),
`docs/release-and-install.md:317`'s sentence and its `:466` requirements row, and `docs/testing.md`'s
seven-row stage table all name the same number and the same stage breakdown;
`src/__tests__/docs.test.ts`'s "the offline test budget is pinned once and matches the measured
evidence baseline" passes in this session (including its any-other-page-restating-a-different-pin
scan), and `src/__tests__/docs.test.ts` is 156/156.

**Verdict: recorded no-op.** No trim, no re-pin, no page edit: the pinned `< 80s` held on every run
(worst 77.736 s, gate-spike run 1), and one over-threshold run with a single-stage explanation is not
the consecutive-run drift the trigger defines. The workspace pool stays at 2 and the gate split stays
as §11.1 measured it.

**Trigger (unchanged):** re-measure when a stage or test file joins the default suite, or when two
consecutive `npm test` runs exceed 76 s. Then the order is §11's: three-run stage table, trim the
measured serialization, and re-pin the marker plus the two doc statements in one change.

## 19. Plan 119 Task 3 re-probe — allowlist still sound, the shape rule still waits (2026-09-24)

Plan 119 Task 3's trigger: a fifth `scripts/` file legitimately carries
`--experimental-test-coverage`, or the four-name `NEGATIVE_ASSERTIONS` set would need a second
extension (a fifth name or another exclusion pattern). Neither fired on this tree.

```text
$ grep -rn -- '--experimental-test-coverage' scripts/ | wc -l
14                                              # 7 files: 4 negative-assertion + 3 retired baselines
$ grep -rn -- '--experimental-test-coverage' scripts/ | sed -E 's#(scripts/[^:]+):([0-9]+):.*#\1:\2#'
counts per file: phase23-coverage.test.mjs 5, tooling-gate.test.mjs 4,
                 run-all-tests.test.mjs 1, plan-review-gate.test.mjs 1,
                 phase13-baseline.json 1, phase14-baseline.json 1, phase15-baseline.json 1
```

Exactly the census plan 117 §16 recorded: the four `NEGATIVE_ASSERTIONS` names (5/4/1/1 lines) plus the
three retired `phase1{3,4,5}-baseline.json` files the scan exempts by name. The 11 in-file lines are
shape-identical to §16.1's per-line table (same line numbers, none moved): `phase23-coverage.test.mjs`
81/112/237/240 assertion needles and 113 an assertion message; `tooling-gate.test.mjs` 99 a comment,
104 a rule regex, 130 a fixture body, 156 an assertion needle; `run-all-tests.test.mjs` 153 a needle;
`plan-review-gate.test.mjs` 446 a token-list string. No line is a spawn argument list. The scan itself
is unchanged — `NEGATIVE_ASSERTIONS` has the same four names, the `/-baseline\.json$/` and `/freeze/`
exclusions are the same two, the extension set is still `\.(?:mjs|js|json)$`, and there is no pending
fifth name or second exclusion pattern.

**In-repo source comments inventoried** (plan 117 Further Action 4, folded into this task): the flag
survives in exactly two `src/`/`packages/` comments — `src/__tests__/field-policy.test.ts:307`
("Coverage instrumentation (node --experimental-test-coverage) inserts per-node bookkeeping…") and
`packages/prism-work/src/document-reader/__tests__/index.test.ts:23` (V8 coverage inflates the
pdf-parse path ~20x, which made the gate flaky) — plus their gitignored `dist/` mirrors. Neither is a
spawn, and `grep -rn -- '--experimental-test-coverage' src/ packages/ | grep -v '/dist/'` returns
**no** other occurrence, so no `src/`/`packages/` spawn carries the flag. The scan stays `scripts/`-only
by choice: its subject is live spawn arguments in the scripts CI runs, both comment occurrences are
prose about instrumentation behavior, and widening it to `src/`/`packages/` source would police prose
(lines that legitimately mention the flag) rather than catch a spawn, with `dist/` mirrors forcing a
gitignore-aware second exclusion the current scan does not need.

**Scan green and cheap.** `node --test --test-name-pattern='retired Node coverage instrument'
scripts/phase23-coverage.test.mjs` → 1/1 (281 ms, filtered); the scan's read pass over the candidates
(`scripts/` holds 198 dir entries, of which 138 pass the extension/baseline/freeze filters) costs
7.8 ms on this host — still one pass, no per-line regex over the repo.

**Verdict: recorded no-op.** No edit to `scripts/phase23-coverage.test.mjs`; the `NEGATIVE_ASSERTIONS`
set, the `-baseline.json`/`freeze` exclusions, and the build-race assertions stay. The shape rule's
carve-out list (needle, fixture body, comment, regex/list string) is still about as long as the
four-name list it would replace, so it continues to wait for the fifth legitimate file.

**Trigger (unchanged):** a fifth `scripts/` file legitimately carrying the flag, or the allowlist
needing a second extension — then replace the filename set with an occurrence-shape rule that allows
the four shapes above and still fails a flag that reaches a spawn argument list (naming the file),
keeping the retired baselines excluded by name and re-proving the existing fixtures.
