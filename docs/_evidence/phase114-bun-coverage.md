# Phase 114 — Bun 1.4.2 Coverage Instrument and Recalibration

Plan: [114-Bun-Coverage-Gate.md](../../plans/114-Bun-Coverage-Gate.md) Task 1 (must run first).
Date: 2026-09-23. Host: Linux 7.2.6-1-cachyos x86_64, 16 cores, AMD Ryzen 9 PRO 7940HS.
Bun 1.4.2 (`744846f84`), Node v26.9.0. Tree: HEAD `3129d5cf` (0.10.1 WIP), branch
`migration/bun`, root and workspace `dist/` built from this tree.

Method: every row below was re-run on Bun 1.4.2 in this session; each transcript is the
current output of the command above it. Fixtures live in scratch directories outside the
repo (not committed); repo paths are elided to `<repo>`. This file is the gate for Task 2:
Task 2 implements only what a row below closed, applies the recalibration table in §3, and
does not re-decide a row.

Cite convention: `path:Lnn` spans verified in this tree. Verdicts are `CONFIRMED`
(reproduced) or `REJECTED` (retired/unsafe).

---

## 0. Verdict summary

| # | Claim | Verdict |
| --- | --- | --- |
| 1 | `bun test --coverage` prints `File \| % Funcs \| % Lines \| Uncovered Line #s` with an `All files` aggregate row | CONFIRMED |
| 2 | `coverageThreshold` is a fraction 0–1 (`1` = 100%); `100` is an impossible 10000% | CONFIRMED |
| 3 | Scalar threshold sets lines+functions+statements; object keys override; an omitted key keeps the `0.9` default; `{}` arms nothing | CONFIRMED |
| 4 | Exact boundary passes (`>=`): `{ lines = 0.9, functions = 0.5 }` passes at 50% functions | CONFIRMED |
| 5 | `statements` is accepted and arms the check but is not enforced; `branches` and unknown keys are ignored and do not arm | CONFIRMED |
| 6 | A threshold failure is a silent exit 1 — no message, no marker in the table | CONFIRMED |
| 7 | Enforcement is **per loaded file**, not on the aggregate: one file at 50% with `All files` 97.62 ≥ 0.9 exits 1 | CONFIRMED |
| 8 | Node native thresholds are **aggregate**: same fixture, aggregate 95.45 ≥ 90 exits 0 | CONFIRMED |
| 9 | Bun's `All files` functions percentage is the unweighted mean of per-file percentages (75.00, not the count-weighted 91.67); Node's is count-weighted | CONFIRMED |
| 10 | `lcov`-only runs still enforce the threshold on 1.4.2 (issue #32118's skip does not reproduce; #32121/#32849 landed) | CONFIRMED |
| 11 | Bun's `lcov` emits no branch records (`BRDA`/`BRF`/`BRH`) even for a file with an `if` — branch floor cannot be parsed | CONFIRMED |
| 12 | `coveragePathIgnorePatterns` scopes loaded files in text and lcov, but only from `$cwd/bunfig.toml`; root config is not discovered from a package cwd, `bun test --config` is ignored, `bun --config … test` silently exits 0 doing nothing | CONFIRMED |
| 13 | Never-imported files are invisible to table and lcov; Node behaves the same (`--test-coverage-include` does not add unloaded files), so no current gate relied on catching them | CONFIRMED |
| 14 | Bun prints no vacuous `All files` row on a failed or empty run; a failed run with loaded files prints real numbers, so the gate must key on exit code | CONFIRMED |
| 15 | Three gated rows are red under `bun test` on 1.4.2 (core, ag-ui, prism-coding-tools) and cannot be gated until fixed | CONFIRMED |
| 16 | Bun core coverage is ~1.8× slower than Node's; per-workspace runtime is a wash | CONFIRMED |
| 17 | Porting the Node 60/70/75 numbers or keeping `c8`/`nyc`/`istanbul` on top | REJECTED (§6) |

---

## 1. Semantics probes

### 1.1 Table shape (`CONFIRMED`)

`bun test --coverage` in a fixture whose `src/calc.js` has two functions, one never called
(functions 50%, lines 92.86%):

```text
$ bun test --coverage
bun test v1.4.2 (744846f84)

calc.test.js:
(pass) big [0.05ms]
-------------|---------|---------|-------------------
File         | % Funcs | % Lines | Uncovered Line #s
-------------|---------|---------|-------------------
All files    |   50.00 |   92.86 |
 src/calc.js |   50.00 |   92.86 | 15
-------------|---------|---------|-------------------

 1 pass
 0 fail
 1 expect() calls
Ran 1 test across 1 file. [11.00ms]
[exit=0]
```

Columns are `% Funcs`, then `% Lines` — the reverse of Node's `line % | branch % | funcs %`.
The existing `ALL_FILES` regex (`scripts/coverage-summary.mjs:L48`) captures
`lines | branches | functions` for Node; Task 2's parser must map Bun's columns as
`functions | lines` and produce no branch number.

### 1.2 Fraction semantics, defaults, exact boundary (`CONFIRMED`)

Fixture `fraction`: functions 50.00, lines 92.86. Fixture `fixture2`: functions 100.00,
lines 60.00. Fixture `fixture3`: functions 100.00, lines 100.00.

```text
$ cd fraction; bun test --coverage          # bunfig [test]: coverageThreshold = 0.9
All files    |   50.00 |   92.86 |
 src/calc.js |   50.00 |   92.86 | 15
[exit=1]                                     # flat 0.9 fails 50% functions

$ cd fraction; bun test --coverage          # coverageThreshold = { lines = 0.9, functions = 0.5 }
All files    |   50.00 |   92.86 |
 src/calc.js |   50.00 |   92.86 | 15
[exit=0]                                     # exact boundary passes (>=)

$ cd fraction; bun test --coverage          # coverageThreshold = { lines = 0.9, functions = 0.51 }
[exit=1]

$ cd fixture2; bun test --coverage          # coverageThreshold = { lines = 0.1 }
All files  |  100.00 |   60.00 |
 f.js      |  100.00 |   60.00 | 4-5
[exit=0]                                     # omitted functions keeps the 0.9 default; F=100 passes

$ cd fixture2; bun test --coverage          # coverageThreshold = { functions = 0.5 }
All files  |  100.00 |   60.00 |
 f.js      |  100.00 |   60.00 | 4-5
[exit=1]                                     # omitted lines keeps the 0.9 default; L=60 fails

$ cd fixture3; bun test --coverage          # coverageThreshold = 1
All files  |  100.00 |  100.00 |
 f.js      |  100.00 |  100.00 |
[exit=0]                                     # 1 == 100%

$ cd fixture3; bun test --coverage          # coverageThreshold = 1.01
[exit=1]

$ cd fixture3; bun test --coverage          # coverageThreshold = 100
[exit=1]                                     # 100 is 10000%, impossible

$ cd fraction; bun test --coverage          # coverageThreshold = {}
[exit=0]                                     # empty object arms nothing (F=50 would fail defaults)
```

An omitted `lines`/`functions` key keeps the `0.9` default (verified both directions) and
`{}` does not enable enforcement. A failing threshold prints nothing: the table and the
test summary are clean, only the exit code changes.

### 1.3 `statements` accepted but not enforced; `branches` ignored (`CONFIRMED`)

```text
$ cd fixture3; bun test --coverage          # coverageThreshold = { statements = 1.5 }
All files  |  100.00 |  100.00 |
[exit=0]                                     # statements is not enforced

$ cd fixture3; bun test --coverage          # coverageThreshold = { statements = 0 }
[exit=0]                                     # neither is statements = 0

$ cd fraction; bun test --coverage          # coverageThreshold = { statements = 0.99 }
[exit=1]                                     # recognized key arms the check; omitted lines/functions keep 0.9; F=50 fails

$ cd fraction; bun test --coverage          # coverageThreshold = { branches = 0.99 }
[exit=0]                                     # branches is not a key; it does not arm the check (F=50 would fail defaults)

$ cd fixture2; bun test --coverage          # coverageThreshold = { bogus = 0.99 }
[exit=0]
```

The docs' "Bun accepts a `statements` key but does not currently enforce it" reproduces.
There is no `branches` key in either form. This is the recorded reason the branch floor is
dropped (§4).

### 1.4 Per-file enforcement vs Node's aggregate (`CONFIRMED`)

Same fixture, two runners: 20 files at 100% function coverage plus `z.js` with 2 functions,
1 called (50%).

```text
$ cd nodepf; bun test --coverage all.node.test.mjs     # bunfig coverageThreshold = 0.9
All files  |   97.62 |  100.00 |
 z.js      |   50.00 |  100.00 |
[exit=1]                                              # aggregate 97.62 >= 90, one file below floor

$ cd nodepf; node --test --experimental-test-coverage --test-coverage-functions=90 all.node.test.mjs
ℹ z.js      | 100.00 |   100.00 |   50.00 |
ℹ all files | 100.00 |   100.00 |   95.45 |
[exit=0]                                              # Node checks the count-weighted aggregate
```

PR #27933 ("check average coverage against threshold") was closed as stale before merge;
on Bun 1.4.2 the per-file check is still the effective one. Node's native threshold is
aggregate — so **adopting native `coverageThreshold` changes today's core gate from
aggregate to per-file**, a stricter instrument. The existing per-package gates in
`coverage-summary.mjs` parse the `All files` row (`scripts/coverage-summary.mjs:L48`),
which is aggregate.

Also measured: Bun's `All files` functions is the unweighted mean of per-file percentages.
A fixture with `good.js` 10/10 functions and `bad.js` 1/2 functions prints
`All files | 75.00 | 100.00` (mean of 100 and 50), while the lcov counters read
`good.js FNF:10 FNH:10`, `bad.js FNF:2 FNH:1` — count-weighted would be 91.67. The
`nodepf` table shows 97.62 = (20×100 + 50)/21, again a file mean. Task 2's thresholds are
recalibrated on the same instrument, so the weighting stays internally consistent.

### 1.5 Reporter-tied enforcement (`CONFIRMED` — the issue does not reproduce)

```text
$ cd fraction; bun test --coverage --coverage-reporter=lcov --coverage-dir=cov2   # coverageThreshold = 1
(pass) big
 1 pass
 0 fail
[exit=1]                                     # enforced with the text reporter off; no All files row printed
lcov.info records: 14 DA, 1 FNF, 1 FNH, 1 LF, 1 LH, 1 SF, 1 TN
```

Issue #32118's "lcov-only exits 0 regardless of the threshold" no longer reproduces on
1.4.2; #32121/#32849 landed. Enforcement is **not** reporter-tied on this version, but a
lcov-only run prints no `All files` row, so the parsed-aggregate gate (§3) still needs the
text reporter — `lcov` stays a written artifact, never the gate.

### 1.6 `coveragePathIgnorePatterns` works; config discovery is the constraint (`CONFIRMED`)

Scoping works in text and lcov:

```text
$ cd invisible; bun test --coverage                    # no ignore pattern
All files         |  100.00 |  100.00 |
 src/a.js         |  100.00 |  100.00 |
 src/ignored/c.js |  100.00 |  100.00 |

$ cd invisible; bun test --coverage                    # coveragePathIgnorePatterns = ["**/ignored/**"]
All files  |  100.00 |  100.00 |
 src/a.js  |  100.00 |  100.00 |
```

But it is read only from `$cwd/bunfig.toml`. From `packages/acp-agent`, with the pattern
list present only in the repo-root `bunfig.toml`:

```text
$ cd packages/acp-agent; bun test --coverage --timeout=0 dist/src/__tests__/agent.test.js
   foreign '../..' rows: 359                    # root bunfig not discovered
$ bun test --config <repo>/bunfig.toml --coverage --timeout=0 dist/src/__tests__/agent.test.js
   foreign '../..' rows: 359                    # --config after the subcommand is ignored
$ printf '[test]\ncoveragePathIgnorePatterns = ["../**"]\n' > packages/acp-agent/bunfig.toml
$ bun test --coverage --timeout=0 dist/src/__tests__/agent.test.js
   foreign '../..' rows: 0
   All files           |   89.20 |   97.14 |   # vs 23.88/33.09 polluted
$ bun --config <repo>/bunfig.toml test --coverage --timeout=0 dist/src/__tests__/agent.test.js
   stdout bytes: 0  exit=0                      # global flag before the subcommand silently no-ops
```

`bun --config … test` is a silent trap (exit 0, no tests run); spawn `bun test …` with the
package cwd as the only reliable form. Relative patterns match the paths as displayed in
the table (`../**` matches `../../dist/...`), so one `../**` pattern per package excludes
the repo root dist and sibling packages; `**/packages/**` in a package cwd does not exclude
its own `dist/`.

Consequence for Task 2: workspace isolation cannot come from the root `bunfig.toml`. The
measured working equivalent of Node's `--test-coverage-include=dist/**`
(`scripts/coverage-summary.mjs:L7`) is a per-package `bunfig.toml` with
`[test] coveragePathIgnorePatterns = ["../**"]`. Adding 11 two-line files is a deviation
from the plan's file list; it is the only mechanism 1.4.2 honors (§0 rows 12).

### 1.7 Never-imported files are invisible to both instruments (`CONFIRMED`)

`src/unimported.js` exists but no test imports it:

```text
$ cd invisible; bun test --coverage
All files         |  100.00 |  100.00 |
 src/a.js         |  100.00 |  100.00 |
 src/ignored/c.js |  100.00 |  100.00 |     # no src/unimported.js row

$ node --test --experimental-test-coverage a.node.test.mjs
ℹ  a.js     | 100.00 | 100.00 | 100.00 |
ℹ  c.js     | 100.00 | 100.00 | 100.00 |     # no src/unimported.js row
ℹ all files | 100.00 | 100.00 | 100.00 |

$ node --test --experimental-test-coverage --test-coverage-include='**/*.js' a.node.test.mjs
ℹ  a.js     | 100.00 | 100.00 | 100.00 |
ℹ  c.js     | 100.00 | 100.00 | 100.00 |     # include does not add unloaded files either
```

Node's `--test-coverage-include` (the `dist/**` workspace filter, and the core run's
per-file excludes) also only filters loaded files; it does not synthesize zero-coverage
rows. No current gate relied on catching never-imported files, so Bun's invisibility is
not a coverage regression. Cold files stay invisible in both instruments and soak up
nothing in the denominator — the same blind spot the Node gate had.

### 1.8 Failed and empty runs (`CONFIRMED`)

```text
$ cd fixture3; bun test --coverage fail.test.js     # test fails; f.js fully covered
All files  |  100.00 |  100.00 |
 f.js      |  100.00 |  100.00 |
 0 pass
 1 fail
[exit=1]

$ cd fixture3; bun test --coverage boom.test.js     # file throws at load
[exit=1]  All files rows: 0

$ cd empty; bun test --coverage                     # no test files
[exit=1]  All files rows: 0
```

Bun never prints the Node trap's vacuous `All files | 100.00 | 100.00` row on a failed or
empty run — it either prints real numbers or no row at all. The existing guard ("trust the
row only when the child exited 0", `scripts/coverage-summary.mjs:L87`) stays and is
re-proven against this behavior.

---

## 2. Measurements under `bun test --coverage`

### 2.1 Commands and isolation

- Core: `bun test --coverage --timeout=0 dist/__tests__/*.test.js` from the repo root with
  the root `bunfig.toml` `[test] coveragePathIgnorePatterns = ["**/packages/**",
  "**/scripts/**", "**/examples/**", "../**"]`. 152 table rows, all under `dist/`; no
  `packages/`, `scripts/`, `examples/`, or `../` rows.
- Workspaces: `bun test --coverage --timeout=0 <all dist test files>` from each package
  directory with a package-local `bunfig.toml` `[test] coveragePathIgnorePatterns =
  ["../**"]`. Foreign rows 0 for every package; own rows match the loaded denominator
  (e.g. mcp 15/15, memory 141 of 143 — the 2 unloaded files are the §1.7 blind spot).

### 2.2 Measured coverage (two back-to-back runs, byte-identical)

| Package | Bun % Funcs | Bun % Lines | Bun % Lines − 3pp floor | Bun run wall | Suite under Bun |
| --- | --- | --- | --- | --- | --- |
| `@arnilo/prism` (core) | 95.21 | 94.48 | lines 91.48, functions 92.21 | 35.9 s / 37.0 s | **1 fail** (`cli-provider-add`, process.execPath `--test` spawn) |
| `@arnilo/prism-acp-agent` | 89.20 | 97.14 | 94.14 | 0.58 s | green (20 pass) |
| `@arnilo/prism-ag-ui` | 98.38 | 95.50 | 92.50 | 0.52 s | **1 fail** (`acp-recovery`, checkpoint marker null) |
| `@arnilo/prism-hooks` | 94.01 | 94.72 | 91.72 | 1.32 s | green (25 pass) |
| `@arnilo/prism-mcp` | 96.86 | 94.32 | 91.32 | 2.05 s | green (106 pass) |
| `@arnilo/prism-memory` | 94.32 | 94.39 | 91.39 | 0.99 s | green (476 pass) |
| `@arnilo/prism-channels` | 94.47 | 95.94 | 92.94 | 2.82 s | green (93 pass) |
| `@arnilo/prism-coding-tools` | 95.28 | 93.32 | 90.32 | 8.92 s | **1 fail** (`egress proxy`, response byte cap not rejected) |
| `@arnilo/prism-core` | 82.80 | 83.96 | exempt (protected) | 9.11 s | green (690 pass) |
| `@arnilo/prism-providers` | 97.49 | 96.25 | 93.25 | 0.46 s | green (595 pass) |
| `@arnilo/prism-work` | 87.94 | 86.04 | 83.04 | 1.06 s | green (246 pass) |
| `@arnilo/prism-web-tools` | 89.55 | 86.76 | 83.76 | 3.59 s | green (144 pass) |

Run 1 and run 2 were byte-identical on every row (max delta 0.00pp), so the *plan 023*
freeze rule — `measured − 3pp`, `min(two back-to-back runs)` — lands on the two-decimal
values above minus 3.00pp. Function percentages are recorded, not gated, exactly as the
current `scripts/coverage-thresholds.json` shape does. `marginPp` stays 3.

The three red rows are **Bun-runner failures, not coverage failures**: each also fails
`bun test --timeout=0` without `--coverage` and each passes under `node --test`. Core's
failure is the `process.execPath` `--test` spawn that plan 115 Task 3 owns
(`src/__tests__/cli-provider-add.test.ts:L282,L288`); ag-ui's is a checkpoint-marker race
under Bun's scheduling; prism-coding-tools' is the egress-proxy byte-cap rejection. Task 2
cannot gate those three rows until the failures are fixed or the rows stay on Node; this is
the recorded blocker list.

### 2.3 Archived Node floors (not carried into the Bun thresholds)

Core gate today: lines 60, functions 70, branches 75, enforced by Node's native
`--test-coverage-*` flags; Node measured lines 93.00 / branches 86.49 / functions 93.62 in
this tree. Per-package rows from `scripts/coverage-thresholds.json` (captured 2026-09-17,
`marginPp: 3`):

| Package | Node lines floor | Node branches | Node functions |
| --- | --- | --- | --- |
| `@arnilo/prism-acp-agent` | 91.87 | 79.80 | 94.74 |
| `@arnilo/prism-ag-ui` | 87.46 | 78.39 | 94.46 |
| `@arnilo/prism-channels` | 86.13 | 75.92 | 87.90 |
| `@arnilo/prism-coding-tools` | 83.11 | 76.80 | 90.32 |
| `@arnilo/prism-hooks` | 84.70 | 78.67 | 90.00 |
| `@arnilo/prism-mcp` | 88.83 | 78.06 | 90.71 |
| `@arnilo/prism-memory` | 86.63 | 81.99 | 91.04 |
| `@arnilo/prism-work` | 80.24 | 72.10 | 83.84 |
| `@arnilo/prism-providers` | 92.04 | 83.99 | 94.03 |
| `@arnilo/prism-web-tools` | 83.67 | 72.73 | 89.55 |
| `@arnilo/prism-core` | protected | — | — |

These are Node-instrument numbers on a different denominator (compiled `dist/*.js` lines,
count-weighted aggregates). They are archived here and are **not** ported into the Bun
`scripts/coverage-thresholds.json`; the Bun floors in §2.2 replace them. See §6 for the
rejection of carrying the 60/70/75 numbers over.

### 2.4 Gate mechanism decision

**Task 2 parses the `All files` aggregate row in `scripts/coverage-summary.mjs` and does
not set native `coverageThreshold`.** Transcripts it rests on:

- Native enforcement is per-file (§1.4): one cold file below the floor fails even when the
  aggregate is comfortably above it, which is a stricter gate than the one running today.
  The current per-package gates and the current Node core gate are aggregate (§1.4), so
  the parsed row preserves both semantics and recalibrates the numbers on one instrument.
- A failed or empty Bun run prints no aggregate row, so the existing exit-code guard
  already rejects vacuous passes (§1.8); the parsed row is safe.
- Reporter-tied enforcement is fixed on 1.4.2 (§1.5), but a lcov-only run prints no row to
  parse; the text reporter stays the gate and `lcov` stays an artifact.

### 2.5 Branch disposition — dropped, with the ceiling recorded

`lcov` on a fixture that contains an `if` branch emits only `DA, FNF, FNH, LF, LH, SF, TN`.
There is no `BRDA`/`BRF`/`BRH` data to parse on Bun 1.4.2, and the text table has no branch
column, so the branch floor cannot be enforced at any number. Disposition: **drop the
branch floor** (both the core 75 and the per-package branches field) and record the
ceiling: a branch gate returns only when Bun emits lcov branch records or a branch column;
the upgrade path is parsing `BRDA`/`BRF`/`BRH` from `coverage/lcov.info` at that point.

Task 2 must leave the marker comment where the dropped floor would live:

```js
// ponytail: Bun 1.4.2 lcov emits no BRDA/BRF/BRH and its text table has no branch column,
// so the branch floor is dropped (see docs/_evidence/phase114-bun-coverage.md §2.5).
// Upgrade: parse BRDA/BRF/BRH from lcov.info once Bun emits branch records.
```

`scripts/phase23-coverage.test.mjs` must stop asserting finite `branches` for the new
`scripts/coverage-thresholds.json` shape; the functions field stays recorded and finite.

### 2.6 Task 7 re-probe — still no branch data, trigger recorded (2026-09-23)

Plan 115 Task 7 owns the ceiling above and is trigger-gated: re-probe the pinned Bun, and only if
branch data appears restore the parse, floors, gate, and docs. Probe on 2026-09-23, pinned
`bun --version` → `1.4.2` (`npm view bun dist-tags` → `latest: 1.4.2`, canary
`1.4.2-canary.20260922.1`, so no newer release exists to probe):

```text
$ bun test --coverage --timeout=0 --coverage-reporter=lcov --coverage-dir=/tmp/bun-lcov-c dist/__tests__/*.test.js
 2083 pass
 0 fail
Ran 2083 tests across 162 files. [35.60s]        # exit 0

$ grep -c '^BR'    /tmp/bun-lcov-c/lcov.info   # BRDA + BRF + BRH
0
$ grep -c '^BRDA:' /tmp/bun-lcov-c/lcov.info
0
$ grep -c '^BRF:'  /tmp/bun-lcov-c/lcov.info
0
$ grep -c '^BRH:'  /tmp/bun-lcov-c/lcov.info
0
$ grep -c '^SF:'   /tmp/bun-lcov-c/lcov.info   # files reported
148
$ grep -c '^DA:'   /tmp/bun-lcov-c/lcov.info   # line records
19436
$ grep -c '^FNF:'  /tmp/bun-lcov-c/lcov.info   # function records
148
$ grep -c '^FNH:'  /tmp/bun-lcov-c/lcov.info
148
```

148 files of real lcov output carry `DA`/`FNF`/`FNH`/`LF`/`LH`/`SF`/`TN` and **no** branch record of
any kind. A single branch-bearing file (`./dist/__tests__/agent-approval-coverage.test.js`, 43 pass,
49 `SF:` records, 0 `^BR`) agrees, so this is not a function of suite size. The text table is
unchanged: with the default reporter its header is
`File | % Funcs | % Lines | Uncovered Line #s` — no branch column — and `--coverage-reporter=lcov`
*replaces* the text reporter, which is why the lcov probe above prints no table at all. One probe
without `--timeout=0` timed out two tests (`field policy microbenchmark …` at 10.0 s, one unnamed at
5.0 s) and counted 2069 tests; the faithful stage flags are the transcript above (2083 pass, 0 fail),
which is what a re-probe must reproduce.

**Verdict: recorded no-op.** No flag, floor, gate, or doc change; the `ponytail:` ceiling in
`scripts/coverage-summary.mjs` and the `branches: null` placeholders stay, and
`scripts/coverage-thresholds.json` is untouched.

**Trigger:** re-probe when the pinned Bun moves past 1.4.2. Upstream tracker:
[oven-sh/bun#7100](https://github.com/oven-sh/bun/issues/7100) — *Report test coverage of statements
and branches*, labels `enhancement` / `bun:test`, **open** as of 2026-08-29, no milestone — whose
proposed Phase 2 is exactly "lcov `BRDA`/`BRF`/`BRH`, thresholds". Release-notes entry to watch: any
`bun test` coverage item in the v1.4.x/v1.5 notes that mentions branch/statement coverage or lcov
branch records. Version boundary: the next `packageManager` bump (1.4.2 is `latest` today). Re-run the
transcript above at that point; plan 115 Task 7 then closes again as a no-op or executes the restore
(parse + `core.branches`/per-package `branches` calibrated by plan 023's min-of-two-runs − 3pp rule,
`phase23-coverage` gate, `docs/release-and-install.md` + `docs/testing.md`).

### 2.7 Plan 117 Task 1 re-probe — pin unmoved, still no branch data (2026-09-23)

Plan 117 Task 1 re-ran §2.6's probe to test whether its trigger had fired. It had not: the pin is
still `bun@1.4.2` (`package.json:L6` `packageManager`), `bun --version` → `1.4.2`, and
`npm view bun dist-tags` → `latest: 1.4.2`, canary `1.4.2-canary.20260922.1`. The canary is the same
1.4.2 line, not what ships to contributors, and a canary probe cannot change a floor (§2.5 option
rejection), so there is no newer pinned release to probe.

```text
$ bun test --coverage --timeout=0 --coverage-reporter=lcov --coverage-dir=/tmp/bun-lcov-p117 dist/__tests__/*.test.js
 2083 pass
 0 fail
Ran 2083 tests across 162 files. [35.17s]        # exit 0, 35.195 s wall clock

$ grep -c '^BR' /tmp/bun-lcov-p117/lcov.info
0                                               # ^BRDA: 0, ^BRF: 0, ^BRH: 0
$ grep -oE '^[A-Z]+:' /tmp/bun-lcov-p117/lcov.info | sort | uniq -c
19436 DA:   148 FNF:   148 FNH:   148 LF:   148 LH:   148 SF:   148 TN:
$ grep -c '^SF:' /tmp/bun-lcov-p117/lcov.info
148

$ bun test --coverage --timeout=0 dist/__tests__/index.test.js | grep -a 'File.*Funcs'
File | % Funcs | % Lines | Uncovered Line #s       # no branch column

$ bun test --coverage --timeout=0 --coverage-reporter=lcov --coverage-dir=/tmp/bun-lcov-p117-one dist/__tests__/agent-approval-coverage.test.js
 43 pass / 0 fail; 49 SF:, 0 ^BR
```

Every prefix in the lcov census is one of `DA`/`FNF`/`FNH`/`LF`/`LH`/`SF`/`TN` — no branch record of
any kind, on the full suite or on the single branch-bearing file — and the default reporter's header is
still `File | % Funcs | % Lines | Uncovered Line #s`. §2.6's numbers reproduce exactly on this tree
(2083 pass / 0 fail / 162 files, 35.17 s vs 35.60 s).

**Verdict: recorded no-op again** — the pin has not moved, so there is nothing to restore. No flag,
floor, gate, threshold, or doc change; `scripts/coverage-thresholds.json`, its `branches: null`
placeholders, and the `ponytail:` ceiling in `scripts/coverage-summary.mjs` stay untouched.

**Trigger (unchanged):** re-probe when the pinned Bun moves past 1.4.2 — the next `packageManager`
bump. Upstream tracker: [oven-sh/bun#7100](https://github.com/oven-sh/bun/issues/7100) (open as of
2026-08-29, no milestone; proposed Phase 2 = lcov `BRDA`/`BRF`/`BRH` + thresholds); release-notes
entry to watch: any `bun test` coverage item in the v1.4.x/v1.5 notes naming branch/statement coverage
or lcov branch records. At that point plan 117 Task 1 closes again as a no-op, or executes the restore
(parse + `core.branches`/per-package `branches` by plan 023's min-of-two-runs − 3pp rule, the
`phase23-coverage` gate, and both doc pages).

### 2.8 Plan 119 Task 1 re-probe — pin still 1.4.2, still no branch data (2026-09-24)

Plan 119 Task 1 re-ran §2.6's probe one day after plan 117's §2.7 re-probe. The trigger has still not
fired: the pin is still `bun@1.4.2` (`package.json:L6` `packageManager`), `bun --version` → `1.4.2`,
and `npm view bun dist-tags` → `latest: 1.4.2` (canary `1.4.2-canary.20260923.1` — the same 1.4.2
line, not what ships to contributors, and a canary probe cannot change a floor per §2.5). There is no
newer pinned release to probe.

```text
$ bun test --coverage --timeout=0 --coverage-reporter=lcov --coverage-dir=/tmp/bun-lcov-p119 dist/__tests__/*.test.js
 2083 pass
 0 fail
Ran 2083 tests across 162 files. [35.17s]        # exit 0, 35.196 s wall clock

$ grep -c '^BR' /tmp/bun-lcov-p119/lcov.info
0                                               # ^BRDA: 0, ^BRF: 0, ^BRH: 0
$ grep -oE '^[A-Z]+:' /tmp/bun-lcov-p119/lcov.info | sort | uniq -c
19436 DA:   148 FNF:   148 FNH:   148 LF:   148 LH:   148 SF:   148 TN:
$ grep -c '^SF:' /tmp/bun-lcov-p119/lcov.info
148

$ bun test --coverage --timeout=0 dist/__tests__/index.test.js | grep -a 'File.*Funcs'
File | % Funcs | % Lines | Uncovered Line #s       # no branch column

$ bun test --coverage --timeout=0 --coverage-reporter=lcov --coverage-dir=/tmp/bun-lcov-p119-one dist/__tests__/agent-approval-coverage.test.js
 43 pass / 0 fail; 49 SF:, 0 ^BR
```

Every prefix in the lcov census is one of `DA`/`FNF`/`FNH`/`LF`/`LH`/`SF`/`TN` — no branch record of
any kind, on the full suite or on the single branch-bearing file — and the default reporter's header is
still `File | % Funcs | % Lines | Uncovered Line #s`. §2.6's and §2.7's numbers reproduce exactly on
this tree (2083 pass / 0 fail / 162 files, 35.17 s vs 35.17/35.60 s; 148 `SF:`, 19436 `DA:`).

**Verdict: recorded no-op again** — the pin has not moved, so there is nothing to restore. No flag,
floor, gate, threshold, or doc change; `scripts/coverage-thresholds.json`, its `branches: null`
placeholders, and the `ponytail:` ceiling in `scripts/coverage-summary.mjs` stay untouched.

**Trigger (unchanged):** re-probe when the pinned Bun moves past 1.4.2 — the next `packageManager`
bump. Upstream tracker: [oven-sh/bun#7100](https://github.com/oven-sh/bun/issues/7100) (open as of
2026-08-29, no milestone; proposed Phase 2 = lcov `BRDA`/`BRF`/`BRH` + thresholds); release-notes
entry to watch: any `bun test` coverage item in the v1.4.x/v1.5 notes naming branch/statement coverage
or lcov branch records. At that point plan 119 Task 1 closes again as a no-op, or executes the restore
(parse + `core.branches`/per-package `branches` by plan 023's min-of-two-runs − 3pp rule, the
`phase23-coverage` gate, and both doc pages).

---

## 3. Timing

Same tree, warm (back-to-back runs, no reboot or cache purge), wall clock by `date +%s%3N`.
"Core" is the current `package.json` core command vs its Bun replacement; "full stage" is
`npm run test:coverage` as it runs today (core → `coverage-summary.mjs` → the two
`scripts/phase23-*.test.mjs` gates).

| Stage | Runner | Wall clock | Exit | Notes |
| --- | --- | --- | --- | --- |
| Core coverage (current command, `package.json:L150`) | node | 20.2 s | 0 | 2066 tests, 0 fail; lines 93.00 / branches 86.49 / functions 93.62 |
| Core coverage (`bun test --coverage --timeout=0`) | bun | 35.9–37.0 s | 1 | 2081 pass / 1 fail; functions 95.21 / lines 94.48 |
| Workspace rows, summed (11 packages, per-package command) | bun | 31.4 s | 2 red | run 1; 31.6 s run 2 |
| Workspace rows, summed (11 packages, Node `--test-coverage-*`) | node | 32.8 s | 0 | per-package command from `scripts/coverage-summary.mjs:L81` |
| Full `npm run test:coverage` | node | 128 s | 0 | includes the fail-closed phase23 rerun (53.5 s) and the core suite twice |

Majority cost: **the core suite, run twice per stage** (once as the first command, once
inside `coverage-summary.mjs`) plus the fail-closed phase23 test that re-runs the entire
summary. Bun's core coverage is ~1.8× Node's on this tree while the workspace rows are a
wash (31.4 s vs 32.8 s summed), so the instrument swap moves the full-stage cost up, not
down, until Task 2 measures the real Bun stage. Task 2 records the before/after full-stage
wall clock next to this table; a silent regression is not acceptable.

---

## 4. Task 2 handoff (decided here, cheap to implement there)

1. `scripts/coverage-thresholds.json`: write the §2.2 lines floors, `marginPp: 3`, a new
   `captured` date, the measured functions, `branches: null` (or the key omitted) and the
   §2.5 note. Nothing from §2.3 is copied forward.
2. `scripts/coverage-summary.mjs`: spawn `bun test --coverage --timeout=0` (by name, not
   `process.execPath`); parse `% Funcs | % Lines` from the `All files` row; keep the
   exit-code guard, the protected exemptions, the `coverage-summary.json` shape, and the
   redacted failure tail; add the §2.5 `ponytail:` comment in place of the branch parse.
3. Root `bunfig.toml` `[test] coveragePathIgnorePatterns = ["**/packages/**",
   "**/scripts/**", "**/examples/**", "../**"]` for the core row; a package-local
   `bunfig.toml` with `["../**"]` in each of the 11 gated workspaces for the workspace rows
   (§1.6 — the only mechanism 1.4.2 honors).
4. `scripts/phase23-coverage.test.mjs`: assert the per-package `bunfig.toml` pattern and
   the new `All files` regex shape, replace the Node `--test-coverage-include=dist/**`
   assertion and the core gate 60/70/75 assertion, keep the mcp denominator proof (Bun
   measured 94.32 ≥ 80; Node archived 88.83) and the vacuous-run guard.
5. Do not gate core, `@arnilo/prism-ag-ui`, or `@arnilo/prism-coding-tools` under Bun until
   their §2.2 failures are fixed (plan 115 Task 3 covers core's spawn). Keep those rows
   reported; a red child already fails the stage through the exit-code guard.

---

## 5. Fixtures

Scratch, outside the repo, not committed: `fraction` (F 50 / L 92.86), `fixture2` (F 100 /
L 60 with a branch), `fixture3` (F 100 / L 100), `aggregate` (good 10 + bad 2 functions),
`pfaf`/`nodepf` (five/twenty 100% files + one 50% file), `invisible` (imported, ignored,
and never-imported files), `empty`. Commands in §1 reproduce them in under a minute.

---

## 6. Rejected directions

- **`c8`, `nyc`, `istanbul`** on top of Bun — new dependencies for a table Bun already
  prints and `coverage-summary.mjs` already parses.
- **`port the 60/70/75 numbers`** to Bun — different instrument (compiled-dist lines,
  count-weighted vs source-mapped file-mean), miscalibrated floors that gate nothing real;
  the archived table in §2.3 stays evidence, not configuration.
- **`lcov as the gate`** — a lcov-only run prints no `All files` row (§1.5), so the parser
  would have to be rewritten as an lcov parser with no branch payoff; text stays the gate,
  `lcov` stays an artifact.
- **`skip the recalibration`** and reuse numbers from another runner — the §2.2 runs are
  byte-identical back-to-back, so `measured − 3pp` is cheap and real.
- **`silently drop the branch floor`** — rejected; the drop is recorded in §2.5 with the
  ceiling and the `ponytail:` upgrade marker, and the JSON `branches` field gets an
  explicit null instead of a stale Node number.
- **`bun --config … test` / `bun test --config …`** as workspace isolation — measured
  ignored/no-op (§1.6); per-package `bunfig.toml` files are the working equivalent of
  Node's `--test-coverage-include=dist/**`.
- **Native `coverageThreshold` as the gate** — per-file on 1.4.2 (§1.4), stricter than
  today's aggregate `All files` gates.

---

## 7. Task 2 note — the wired gate (2026-09-23)

`npm run test:coverage` now runs the core suite as `bun test --coverage --timeout=0
dist/__tests__/*.test.js` under the build lock, then `scripts/coverage-summary.mjs`
(which spawns `bun test --coverage --timeout=0` for the core row and each gated workspace
from its own package cwd), then the two phase23 gate files. `--experimental-test-coverage`
appears in no default script. Enforcement is the §2.4 decision — the parsed `All files`
aggregate — with floors from `scripts/coverage-thresholds.json` (core
`lines 91.48 / functions 92.21`; per-package lines rows; `branches: null` per §2.5).

Scoping landed as §1.6 required: the root `bunfig.toml` `coveragePathIgnorePatterns`
scopes the core row, and each of the 11 gated workspaces carries
`packages/<name>/bunfig.toml` with `["../**"]`. Core test files are passed explicitly:
Bun 1.4.2 does not expand a quoted glob (`bun test 'dist/__tests__/*.test.js'` prints
`Test filter had no matches` and exits 0), so the summary computes them with
`findTestFiles(root)`.

### 7.1 The three Bun-runner failures were fixed to unblock the gate

All three reproduce deterministically under `bun test`, pass under `node --test`, and pass
both after the fix:

- **core** — `src/__tests__/cli-provider-add.test.ts:L288` spawned `process.execPath --test`
  (under Bun that is `bun --test`, which runs the file as a script). It now spawns `"node"`
  by name — plan 115 Task 3's rule, whose remaining sweep is untouched here.
- **`@arnilo/prism-ag-ui`** — `acp-recovery.test.ts` read the durable cancel marker after the
  client disconnected. The notification signal is aborted on close, so the marker write loses
  the race under Bun (Node wins it); the test now polls for the marker while the connection is
  still open, matching the file's existing `activeRun` wait. The product race itself
  (a durable cancel can be aborted by a client disconnect) is recorded as a follow-up, not
  changed here. Fixed in plan 116 Task 1: `docs/_evidence/phase116-acp-cancel-disconnect.md`
  (the durable write now uses a connection-independent `AbortSignal.timeout` bound and the
  polling workaround is deleted).
- **`@arnilo/prism-coding-tools`** — `failHttp`'s mid-stream branch called `res.destroy()`
  only: Node resets the client, Bun resolved a clean `200` with 0 bytes. It now destroys
  `res.socket` before `res.destroy()`, and both runtimes see `ECONNRESET`:

```text
$ bun egress-probe.mjs        # limits.responseBytes = 100, upstream 10 000 bytes
RESOLVED {"status":200,"bodyLen":0,"bodyStart":""}      # before the socket destroy (bun)
REJECTED ECONNRESET                                       # after  (bun)
REJECTED ECONNRESET                                       # after  (node)
audits: [ "ERR_PRISM_EGRESS_LIMIT: response bytes exceeded" ]
```

### 7.2 Timing, before and after

Same host and tree, warm, wall clock. "Before" rows are §3's Node instrument; "after" rows
are `npm run test:coverage` with the Bun instrument.

| Stage | Node (before) | Bun (after) |
| --- | --- | --- |
| core coverage, once | 20.2 s | 35.9–37.0 s |
| `coverage:summary` (core + 11 workspaces) | ~70 s | 65.7 s |
| full `npm run test:coverage` (includes the fail-closed gate rerun) | 128 s | 169.7 / 170.2 / 175.8 s |

Keep-decision: **kept**. The stage is ~33% slower (170 s vs 128 s) because the core suite is
~1.8× slower under Bun's instrument and the stage runs it twice (the first command plus the
summary); the workspace rows are a wash (31.4 s vs 32.8 s). The regression is recorded here
and in `docs/release-and-install.md` rather than hidden.

Two back-to-back full stages were identical except memory (94.38 vs 94.39) and web-tools
(86.76 vs 86.81); the floors take the minimum of the two runs and keep the 3pp margin.

### 7.3 Gate files touched

`scripts/phase23-coverage.test.mjs`: Bun table shape, `branches: null`, the per-package
bunfig files, the package.json script shape, and the crashed-child fixture (which now kills
children with a fake `bun` on `PATH` instead of `NODE_OPTIONS=--require`, since Bun ignores
that preload). `scripts/tooling-gate.test.mjs` asserts the Bun script shape and the core
floors in the thresholds file. `scripts/phase23-security.test.mjs`'s self-contained fallback
learned the `core` thresholds entry.

