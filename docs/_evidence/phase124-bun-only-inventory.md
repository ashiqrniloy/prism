# Plan 124 Task 1 — Bun-only inventory (measured 2026-09-25)

Task 1 freezes every decision input the runner flip (Task 2), the PostgreSQL evidence
parser (Task 3), and the budget recalibration (Task 4) consume. Every row below is a
command transcript from this session on the pinned `bun 1.4.2` (`packageManager`) and
`node v26.10.0`, 16 CPUs, AMD Ryzen 9 PRO 7940HS, load average 4.8–14.7 during the run
(recorded per table because the host was busy — the Task 2/4 re-measurements must use
their own same-session baselines, not these absolute numbers).

Paths are repo-relative; `node_modules` is excluded from every `find`. No credentials,
no `PRISM_*` values, no absolute home paths appear below.

## 0. Verdict summary

Cited spans the Task 2/3/4 edits touch:

| Span | What it is |
| --- | --- |
| `scripts/run-all-tests.mjs:L119` | `STAGES` — the stage table the flip rewrites |
| `scripts/run-all-tests.mjs:L30` | `GATE_FILES` — the gate file list the gate stage runs |
| `scripts/run-all-tests.mjs:L110` | `WORKSPACE_LEAVES` — the pool leaves |
| `scripts/with-build-lock.mjs:L67` | `openSync(LOCK, "wx")` — the `O_EXCL` acquisition §5.2 probes |
| `scripts/wiki-scratch-isolation.test.mjs:L90` | the nested `node --test --test-isolation=none` spawn §2 exercises |
| `scripts/blocked-gate.test.mjs:L43` | `spawnSync(process.execPath, ["--test", row.script])` — the `bun --test` defect §6.9 |
| `scripts/postgres-evidence.mjs:L11` | the `ℹ`/`#` TAP regex Task 3 replaces with the §3 contract |
| `scripts/examples-execution.test.mjs:L70` | `spawnSync(process.execPath, [file])` — the `.ts` child §6.5 times |
| `scripts/budget-gate.test.mjs:271` | the startup ratio assertion §6.6 records |
| `scripts/benchmark-redaction.test.mjs:29` | the `process.execPath` benchmark spawn §6.7 times |
| `package.json:155` | `pack:dry-run`'s recursive workspace leg §5.1 |

| Decision | Measured answer | Task 2 must do |
| --- | --- | --- |
| No-path-argument **discovery** from the repo root | 1227 files, exactly the `find` truth (570 `.test.js` + 570 `.test.ts` + 87 `.test.mjs`), one run per file, 0 twins | usable only with cwd scoping; a single repo-root no-args run is **not** the stage partition (see §1.2/§6.4) |
| `.mjs` gate files discovered by `bun test`? | **yes** — all 87 `scripts/*.test.mjs` run | gate stage can stay a file list |
| Directory argument `bun test dist/__tests__/` | **suffix match applies to directories too**: 229 files (166 root + 63 workspace pulls) | never pass a bare `dist/__tests__/`; pass explicit file lists |
| Explicit file argument twin pull | still 2 twins (root + workspace) | keep the `find`-generated explicit lists |
| `--no-isolate` semantics | a single worker keeps one global across files; plain sequential does the same; `--parallel` alone isolates per file | wiki gate verdict in §2 |
| Reporter shape | `(pass)` / `(fail)` / `(skip)` / `(todo)` lines, `Ran N tests across M files.`, exit 0/1 | parser contract in §3 |
| Native modules under Bun | `better-sqlite3`, `pg`, `@napi-rs/keyring`, `playwright-core` registry driver all load and run | no blocker |
| `bun run` parity | 23 of 25 root scripts pass; `pack:dry-run` recurses (E2BIG) and must become `bun run --filter '*' pack:dry-run`; `release:check`/`sdk:ready` fail only on pre-existing tree/docs state | §5 |
| Env hygiene | a Bun parent leaks **no** `BUN_*`/`NODE_TEST_*` into nested `bun test` or a `bun` leaf; a Node parent leaks `NODE_TEST_CONTEXT`/`NODE_TEST_WORKER_ID` | strip nothing |
| `with-build-lock.mjs` under a Bun parent | `O_EXCL` lock identical; a `--shared` reader waited 1252 ms for a live exclusive writer | §5.2 |
| Budget gate solo | Bun fails the startup **ratio** assertion on this host (8.2 vs 8; Bun's `-e` process start 2.9 ms vs Node's ~17 ms) — Task 4's recalibration row | do not port the Node ceiling |
| Examples stage | Bun `3.5–3.7 s` vs Node `10.0 s` (spawned children run `.ts` natively, no type-stripper load) | the sequential-spawn rationale is obsolete |
| Full no-args root run | 1227 files / 11801 tests / 5 m 12 s / 45 fails — source+dist duplicates and cwd-sensitive workspace files | reject the merged one-stage run |

Rejected directions (kept here so Task 2 does not re-derive them):

- **Reject: rename the twins first.** A rename touches frozen partition controls to work
  around a matcher quirk that explicit `find`-generated file lists avoid for free (§1.3).
- **Reject: port the Node ceilings.** The budget-gate ratio and the redaction `minSpeedup`
  were calibrated on Node process-start timings, not Bun's (§6.6, §6.7); Task 4
  recalibrates on the Bun instrument.
- **Reject: keep `node --test` in any stage.** Owner decision (plan 124 header); the
  `--test-concurrency=4` comparison in §6.3 is the baseline to beat, not a retained runner.


## 1. Discovery truth

### 1.1 `find` truth (owned suites)

```text
$ find . -path ./node_modules -prune -o -name '*.test.js' -print | sort -u | wc -l
570
$ find . -path ./node_modules -prune -o -name '*.test.ts' -print | sort -u | wc -l
570
$ find . -path ./node_modules -prune -o -name '*.test.mjs' -print | sort -u | wc -l
87
# union: 1227
```

The 1227 break down as: 166 `dist/__tests__/*.test.js` (root), 166
`src/__tests__/*.test.ts` (root, the source twin of the root dist set), 404 workspace
`packages/*/dist/**/*.test.js`, 404 workspace `packages/*/src/**/*.test.ts` twins, and
87 `scripts/*.test.mjs` gates. `scripts/fixtures/phase23-public-entry.test.mjs` is inside
the 87; it is not in `GATE_FILES` and is discovered only by no-args runs.

### 1.2 No-path-argument discovery

```text
$ bun test --test-name-pattern='zzzznomatch'        # name filter: loads every file, runs no test body
...
 0 pass
 11813 filtered out
 2 fail
 2 errors
Ran 2 tests across 1227 files. [4.53s]
```

The two residual "failures" are module-scope gate exits (`scripts/phase26-coding-journey.test.mjs:83`
and `scripts/phase27-dr.test.mjs:846` call `process.exit(1)`/throw at import when their env
is absent); with the env scrubbed the run is `0 pass / 11813 filtered out` and exits 0.
The discovered set extracted from the reporter equals the `find` union exactly:

```text
$ comm -3 <discovered> <find-union>     # after normalizing the leading ./
(no output)
```

`.mjs` gates are discovered (87/87). `node_modules` strays: none. `dist` outside
workspaces: none. Twin files: **0** — each path appears once in a no-args run because
Bun discovers paths, not suffixes. The twin pull only exists for *arguments* (§1.3).

### 1.3 Directory-argument behavior — suffix matching applies

```text
$ bun test --test-name-pattern='zzzznomatch' --reporter=junit --reporter-outfile=/tmp/dirarg.xml dist/__tests__/
error: regex "zzzznomatch" matched 0 tests. Searched 231 files (skipping 2695 tests) [401.00ms]
# junit: 229 testsuite file= entries
$ grep -vc '^dist/__tests__/' <files>    # workspace pulls
63
```

`bun test dist/__tests__/` runs the 166 root files **plus** 63 workspace files whose path
ends with `dist/__tests__/` (`packages/ag-ui/dist/__tests__/*`, `packages/hooks/dist/__tests__/schema.test.js`,
`packages/mcp/dist/__tests__/content.test.js`, `packages/memory/dist/__tests__/*`, …). So
the directory argument is matched by path suffix, not by resolved directory membership.
The minimal repro from `docs/_evidence/phase113-bun-inventory.md:657` (single-file
argument pulls `packages/mcp/dist/__tests__/content.test.js`) extends to directories.

**Consequence for Task 2:** the partition strategy is explicit `find`-generated file
lists (option (b) in the task), not `bun test <dir>`. The two known twins remain
`dist/__tests__/content.test.js` → `packages/mcp/dist/__tests__/content.test.js` and
`dist/__tests__/schema.test.js` → `packages/hooks/dist/__tests__/schema.test.js`
(`docs/_evidence/phase113-bun-inventory.md:670`); a root-stage explicit list of 166 paths
still pulls both, which is why the runner's root stage must keep the workspace stage's
files out of its own set and Task 2's partition assertion must compare *reported* files,
not requested files. No rename is needed.

## 2. `--no-isolate` semantics (wiki gate)

Probe pair (`/tmp/p124iso`): `zz-aaa-writer.test.mjs` sets `globalThis.__p124AtLoad` at
module scope; `zz-bbb-reader.test.mjs` reads it at module scope and inside its test.

```text
$ bun test --parallel=1 --no-isolate zz-aaa-writer.test.mjs zz-bbb-reader.test.mjs
aaa-writer module-load pid=2690709
aaa-writer test pid=2690709
(pass) aaa-writer
bbb-reader module-load pid=2690709 atLoad=set-at-module-load     # one worker, one global
(pass) bbb-reader
Ran 2 tests across 2 files. [24.00ms]

$ bun test --parallel=1 zz-aaa-writer.test.mjs zz-bbb-reader.test.mjs
aaa-writer test pid=2690713
bbb-reader module-load pid=2690713 atLoad=undefined              # fresh global per file
Ran 2 tests across 2 files. [24.00ms]

$ bun test zz-aaa-writer.test.mjs zz-bbb-reader.test.mjs          # plain sequential, one process
aaa-writer test pid=2690717
bbb-reader module-load pid=2690717 atLoad=set-at-module-load     # one process, one global
Ran 2 tests across 2 files. [26.00ms]
```

So: plain sequential `bun test` **already** gives one process and one global across files
(no worker IPC), and `--no-isolate` with `--parallel=1` reproduces the same guarantee.
`--parallel` alone isolates per file.

The wiki gate itself (`scripts/wiki-scratch-isolation.test.mjs:90`) spawns
`node --test --test-isolation=none <glob>` per cwd — a **fresh child process** every
time, so the parent's isolation mode cannot change the child's guarantee. The gate passes
under both candidates:

```text
$ bun test scripts/wiki-scratch-isolation.test.mjs
 4 pass / 0 fail  (hermetic test 689.68ms)
$ bun test --no-isolate scripts/wiki-scratch-isolation.test.mjs
 4 pass / 0 fail  (hermetic test 663.00ms)
$ bun test --parallel=1 --no-isolate scripts/wiki-scratch-isolation.test.mjs
 4 pass / 0 fail  (hermetic test 665.00ms)
```

**Verdict for Task 2:** plain sequential `bun test` (no `--parallel`, no `--no-isolate`)
is the wiki gate's mode. It reproduces the one-process/one-global guarantee, it is the
fallback the task names, and it avoids the `--no-isolate` footgun where two co-running
files in one worker share module state. The docs sentence that pins
`--test-isolation=none` (`docs/testing.md` nested-runner rule) must say the nested
runner is a fresh `node --test --test-isolation=none` child and that the parent is plain
sequential Bun — the guarantee lives in the child, not in a parent flag.

## 3. Reporter shape (Task 3 parser contract)

Passing file:

```text
$ bun test pass.test.ts
bun test v1.4.2 (744846f84)

pass.test.ts:
(pass) passes [0.04ms]

 1 pass
 0 fail
 1 expect() calls
Ran 1 test across 1 file. [31.00ms]
EXIT=0
```

Failing file:

```text
$ bun test fail.test.ts
bun test v1.4.2 (744846f84)

fail.test.ts:
1 | import { test, expect } from "bun:test";
2 | test("fails", () => { expect(1).toBe(2); });
                                    ^
error: expect(received).toBe(expected)

Expected: 2
Received: 1

      at <anonymous> (/tmp/p124rep/fail.test.ts:2:33)
(fail) fails [0.21ms]

 0 pass
 1 fail
 1 expect() calls
Ran 1 test across 1 file. [36.00ms]
EXIT=1
```

Skipped file (both `bun:test` and `node:test` skip forms):

```text
$ bun test skip.test.ts
(pass) skips [0.04ms]
(skip) explicit skip
(todo) todo entry

 1 pass
 1 skip
 1 todo
 0 fail
Ran 3 tests across 1 file. [28.00ms]
EXIT=0

$ bun test nodeskip.test.mjs            # node:test { skip: "reason" } and test.skip()
(skip) skips-via-options
 0 pass
 1 skip
 0 fail
Ran 1 test across 1 file. [54.00ms]
EXIT=0
```

Contract for `scripts/postgres-evidence.mjs:11`, whose current regex is
`` `^(?:#|ℹ) ${label} (\d+)$` `` (TAP/Node `ℹ pass N` shape): the Bun summary uses
**indented** `  N pass`, `  N fail`, `  N skip`, `  N todo`, `  N expect() calls`, and a
single `Ran N tests across M files. [Xms]` line. Counts are per line and always present
(including `0 fail`). `ℹ` does not appear under Bun. Exit code is 0 for pass/skip-only,
1 for any failure. The parser must sum `^\s*(\d+) (pass|fail|tests)$`-shaped lines (or
parse `Ran`) instead of `ℹ`/`#` TAP lines.

## 4. Native modules under Bun runtime

```text
$ bun -e "const Database=(await import('better-sqlite3')).default; const db=new Database(':memory:'); db.exec('create table t(a int)'); db.prepare('insert into t values (?)').run(42); console.log('better-sqlite3 runtime:', db.prepare('select a from t').get()); db.close();"
better-sqlite3 runtime: { a: 42 }

$ bun -e "const m=await import('better-sqlite3'); console.log('loaded', Object.keys(m).slice(0,5).join(','))"
loaded SqliteError,default,length,name,prototype

$ bun -e "const pg=await import('pg'); console.log('loaded', Object.keys(pg).slice(0,5).join(','))"
loaded Client,Connection,DatabaseError,Pool,Query

$ bun -e "const pg=await import('pg'); const c=new pg.Client({connectionString:'postgres://x:x@127.0.0.1:1/x',connectionTimeoutMillis:200}); try{await c.connect()}catch(e){console.log('pg connect refused as expected:', e.code)}"
pg connect refused as expected: ECONNREFUSED

$ bun -e "const {AsyncEntry}=await import('@napi-rs/keyring'); console.log('AsyncEntry loaded:', typeof AsyncEntry); const e=new AsyncEntry('prism-p124-probe','probe-user'); console.log('constructed'); try{const v=await e.getPassword(); console.log('getPassword resolved:', v===null?'null (no entry)':'value-present')}catch(err){console.log('failed closed:', String(err.message).slice(0,100))}"
AsyncEntry loaded: function
constructed
getPassword resolved: null (no entry)

$ bun -e "const bundle=await import('playwright-core/lib/coreBundle.js'); const reg=bundle.registry.registry; console.log('registryDirectory:', bundle.registry.registryDirectory); const exe=reg.findExecutable('chromium'); console.log('findExecutable(chromium):', exe.directory, exe.executablePath());"
registryDirectory: <cache>/ms-playwright
findExecutable(chromium): <cache>/ms-playwright/chromium-1243 <cache>/ms-playwright/chromium-1243/chrome-linux64/chrome
```

All four load and execute under the Bun runtime (the `@napi-rs/keyring` NAPI binding,
the `better-sqlite3` native addon, `pg`'s JS client, and playwright-core's browser
registry driver). The `better-sqlite3` result re-records
`docs/_evidence/phase113-bun-inventory.md:154`. No load failure is a blocker.

## 5. `bun run` parity

### 5.1 Every root script

Run from the repo root, `bun run <name>` once per script. `clean` is omitted (it deletes
`dist/`; its command is a `rm -rf` with no Bun-specific surface). `test:postgres`,
`test:postgres:run`, `test:nats`, `security:threat-suites`, `post:port`-style network
legs are omitted as protected legs that fail closed without their env (recorded in
`scripts/blocked-gate.mjs`).

| Script | Result | Evidence |
| --- | --- | --- |
| `build:core` | pass | `bun scripts/with-build-lock.mjs tsc` |
| `build` | pass | 11 workspace builds + core, exit 0 |
| `typecheck` | pass | 4.8 s, all 11 workspace leaves exit 0 |
| `lint` | pass | biome sarif |
| `format:check` | pass | 1799 files |
| `sweep:unused` | pass | 11 suppressed |
| `coverage:summary` | pass | artifact written |
| `pack:dry-run` | **FAIL — recursion** | see below |
| `release:evidence` | pass | manifest written |
| `test:live` | pass | 4 ran / 52 skipped (no creds) |
| `test:coverage` | pass* | coverage written; the only failing test is the pre-existing `docs > plans index links every active numbered plan` (also red under Node on this tree) |
| `test` | pass* | full chain; fails only on the pre-existing docs test + a host-load `field-policy` timing flake (passes solo) |
| `release:dry-run` | pass* | runs `sdk:ready`, which inherits the same two pre-existing failures |
| `release:check` | fail-closed by design | `release requires a clean git tree` (this tree is dirty) |

`pack:dry-run` recursion:

```text
$ bun run pack:dry-run
$ npm pack --dry-run && bun run pack:dry-run --workspaces --if-present
...
E2BIG: /usr/bin/bash: Argument list too long (posix_spawn())
$ bun run pack:dry-run --workspaces --if-present --workspaces --if-present --if-present
# argv grows by one --workspaces --if-present per level; timeout 124
```

`npm run pack:dry-run` is green (12 tarballs). The root script
(`package.json:155` `"pack:dry-run": "npm pack --dry-run && npm run pack:dry-run --workspaces --if-present"`)
must change its workspace leg to `bun run --filter '*' pack:dry-run`, which is measured
green (11 workspace tarballs, exit 0). `bun run --workspaces --if-present <name>` is safe
for scripts the root does not define (measured on `typecheck`: 11 leaves, no root
recursion) — the recursion only happens when the script name exists at the root, because
`bun run <name> --workspaces` re-runs the root script with the flags appended.

### 5.2 `with-build-lock.mjs` under a Bun parent

```text
$ bun /tmp/p124-lock-probe.mjs     # exclusive writer sleeps 1.5 s; --shared reader starts 300 ms in
writer exit=0 out=WRITER-ACQUIRED | WRITER-RELEASED
reader exit=0 waited=1252ms out=READER-ACQUIRED
PROBE PASS: reader waited for the writer (mutual exclusion held)
```

The `O_EXCL` protocol (`scripts/with-build-lock.mjs:67`) behaves identically under the
Bun parent: the reader's marker predates the writer's drain, so it waits for the full
writer hold. Task 2 can keep the lock wrapper unchanged.

## 6. Timing (wall clock; host was busy — load noted per row)

Every candidate got ≥2 runs in this session; Node baselines were re-measured here, not
copied from plan 113 §12.

### 6.1 Root suites — `dist/__tests__/*.test.js` (166 requested)

| Runner | Runs | Tests reported | Verdict |
| --- | --- | --- | --- |
| `node --test --test-concurrency=4` | 18.6 s / 18.5 s / 47.9 s (load spike) | 2120 (2119 pass, 1 skip) | baseline |
| `bun test --parallel=4 --timeout=0 <166 explicit paths>` | 20.0 s / 27.4 s (load spike) | 2134 across **168 files** — the two twins pulled | ~equal wall, but twin pull |

The 20 s run is within noise of the 18.5 s Node baseline while using less CPU
(`user` 52.7 s vs 68.0 s). The twin pull (168 files) is the reason the root stage cannot
take a bare explicit root list in a merged partition; Task 2's stage must assert the
reported set.

### 6.2 SQLite suites (3 files)

| Runner | Runs | Result |
| --- | --- | --- |
| `node --test --test-concurrency=4` | 470 ms | 24 pass |
| `bun test --timeout=0` | 438 ms | 24 pass |

Already inside the noise band measured in plan 113 §12; no change.

### 6.3 Gate suites (`GATE_FILES`, 44 files)

| Runner | Runs | Result |
| --- | --- | --- |
| `node --test --test-concurrency=4` | 36.1 s / 32.5 s | 277 tests, 275 pass, 0 fail |
| `bun test --parallel=4 --timeout=0` | 32.1 s / 32.2 s | 277 tests, 44 files; **1–2 fails** |

Bun is ~0–4 s faster with identical file counts. The failures are:
`blocked-gate.test.mjs`'s canonical-record test (deterministic, root cause in §6.6) and
`benchmark-redaction.test.mjs` (load flake, passes solo — §6.7). Both must be fixed by
Task 2 before the gate stage flips.

### 6.4 Workspace stage (11 leaves, pool concurrency 2)

| Runner | Runs | Result |
| --- | --- | --- |
| `npm run test` per leaf, pool 2 | 20.3 s / 19.5 s | all 11 pass |
| `bun test --parallel=4 --timeout=0` over the 404-file union | 13.9 s | 3460 tests, **1 fail** (`impeccable package scaffold > impeccable_package_metadata_is_minimal`: the test reads `package.json` relative to cwd, and the aggregate run's cwd is the repo root) |

The aggregate run is 5.6–6.4 s faster but **cwd-sensitive**: the workspace leaves must
keep running with their package as cwd (per-package invocation), which the pool already
does. Task 2's flip is per leaf (`bun test --parallel=4 --timeout=0 <leaf list>`), not a
single union run.

### 6.5 Examples stage

| Runner | Runs | Result |
| --- | --- | --- |
| `node --test scripts/examples-execution.test.mjs` | 10.0 s | 66 spawned, 1 skipped, 9893 ms of spawns |
| `bun test --timeout=0 scripts/examples-execution.test.mjs` | 3.7 s / 3.5 s | 66 spawned, 1 skipped, ~3.5 s of spawns |

The children are `spawnSync(process.execPath, [file])`
(`scripts/examples-execution.test.mjs:70`); under a Bun parent that is `bun <file>.ts`,
which strips types natively. The Node path's per-child type-stripper load is gone, so
the sequential-spawn rationale (plan 120 Task 7) is obsolete: the stage can run its
spawns with Bun at 2.8× the speed. The child env stays `{ ...base, NODE_ENV: "test" }`
(`scripts/examples-execution.test.mjs:13`) — Bun inherits it unchanged.

### 6.6 Budget gate solo

| Runner | Runs | Result |
| --- | --- | --- |
| `node --test scripts/budget-gate.test.mjs` | 3.41 s / 3.48 s | 19 pass |
| `bun test --timeout=0 scripts/budget-gate.test.mjs` | 2.96 s | 18 pass, **1 fail** |

The failure is `root import startup stays under the sanity bound`:

```text
AssertionError: startup ratio import/process-start: measured 8.2 vs ceiling 8 (import 23.8ms, process start 2.9ms, load/cpu 0.24)
```

The ratio denominator is the median empty `node -e ""` process start
(`scripts/budgets.json:90` calibrated it on Node at 17–19 ms). Under Bun the measured
process start is 2.9 ms, so the same import time doubles the ratio. The absolute import
(23.8 ms) is far below the recorded ceiling; only the ratio needs the Bun calibration —
Task 4's job. The gate stays solo and single-process exactly as it is.

### 6.7 Redaction benchmark (`scripts/benchmark.mjs --scenario redaction`)

| Runner | Runs | `redaction_speedup` |
| --- | --- | --- |
| `node` | 1 | pass (budget check green) |
| `bun` | 6 | 5.1, 5.03, then 4 fails; solo re-runs 6.1 and green |

`minSpeedup: 5` (`scripts/budgets.json:319`) sits exactly on the measured Bun ratio
(5.0–6.1), so the check flakes under host load. Under the current runner this test only
runs when `node --test` spawns `scripts/benchmark.mjs`
(`scripts/benchmark-redaction.test.mjs:29` uses `process.execPath`), so the flip exposes
it. Task 4 recalibrates the ratio; Task 2 must keep the benchmark's own runner call
(`process.execPath`) working under Bun — it does, the child is a plain script.

### 6.8 Full no-args repo-root run (one merged stage, measured for the record)

```text
$ time bun test --parallel=4 --timeout=0        # no path arguments, cwd = repo root
real 5m12.605s
 11514 pass / 242 skip / 45 fail
Ran 11801 tests across 1227 files. [312.60s]
```

11801 tests is ~2× the stage-partition total (2120 + 24 + 3460 + 277) because both the
`src/` and `dist/` twins run, and the 45 failures are dominated by cwd-sensitive tests
(`impeccable package scaffold`, `baseline manifest count`, `bin spawns … over stdio`,
`docs > plans index`) and the two module-scope gate exits. **Reject the merged
one-stage run**; the stage partition stays (root list, sqlite list, workspace leaves,
gate list, examples, budget, build race, coverage), now on `bun test`.

### 6.9 Two runner-level failures the flip must fix first

1. **`blocked-gate.test.mjs` spawns `bun --test`.** `scripts/blocked-gate.test.mjs:43`
   runs `spawnSync(process.execPath, ["--test", row.script])`; under a Bun parent that is
   `bun --test <file>`, and Bun treats `--test` as "run this file", not "run the test
   runner". Measured:

   ```text
   $ bun --test scripts/phase12-restart-recovery.test.mjs
   error: Cannot use describe outside of the test runner. Run "bun test" to run tests.
   EXIT=1
   $ bun test scripts/phase12-restart-recovery.test.mjs
   BLOCKED GATE phase12-restart-recovery requires=PRISM_TEST_POSTGRES_URL ...   # canonical record printed
   ```

   The gate asserts one canonical `BLOCKED GATE` line and non-zero exit; under Bun it
   gets an unrelated `describe` error and no record. Task 2 must make the child command
   runner-aware (`["test", row.script]` when `process.execPath` is Bun, `["--test", row.script]`
   under Node) — one line in the helper, all call sites route through it.

2. **`wiki-scratch-isolation.test.mjs` spawns `node` by name.** `scripts/wiki-scratch-isolation.test.mjs:90`
   already spawns `node --test --test-isolation=none`; that stays correct under a Bun
   parent (the child is the Node binary by name, and the nested runner needs Node's
   `--test-isolation=none` flag). No change needed — recorded so Task 2 does not "fix" it.

## 7. Environment hygiene

```text
$ bun test --timeout=0 probe-parent.test.mjs        # parent is Bun; probes nested children
NESTED-BUN-TEST: CHILD-RUNNER-ENV []
NESTED-BUN-LEAF: LEAF-ENV []
$ node --test probe-parent.test.mjs                 # parent is Node; same probes
NESTED-BUN-TEST: CHILD-RUNNER-ENV ["NODE_TEST_CONTEXT","NODE_TEST_WORKER_ID"]
NESTED-BUN-LEAF: LEAF-ENV ["NODE_TEST_CONTEXT","NODE_TEST_WORKER_ID"]
```

A Bun test parent exports **no** `BUN_*` or `NODE_TEST_*` variable to nested children
(consistent with `docs/_evidence/phase113-bun-inventory.md:129` §1.5). A Node parent
leaks `NODE_TEST_CONTEXT`/`NODE_TEST_WORKER_ID`, which is why the wiki gate's
`runWikiSuites` strips them (`scripts/wiki-scratch-isolation.test.mjs:90` comment).
**Task 2 strips nothing**: after the flip the only parent is Bun, and Bun sets none.

## 8. Security and hygiene

- No credentials, no `PRISM_*` values, no absolute home paths in this file; `/tmp` probe
  paths only.
- The `bun run` parity runs used the repo's own scripts; the only writes were build
  outputs (`dist/`, `scripts/coverage-summary.json`) and the coverage scratch file, which
  the scripts themselves clean up.
- The `--test-name-pattern` discovery runs use a non-matching regex so no test body
  executes; the two module-scope gate exits are documented in §1.2.

## 9. Task 2 — runner flip (measured 2026-09-25)

Every stage now spawns `bun`; the Node runner is gone from `STAGES`, `package.json`, the 11
workspace manifests, and the live matrix. Task 4 owns the ceiling recalibration the flip exposes;
the rows below separate a flip defect from a Task 4 item.

### 9.1 Stage table before → after

| Stage | Before | After |
| --- | --- | --- |
| build | `npm run build` | `bun run build` |
| performance budget | `with-build-lock node --test scripts/budget-gate.test.mjs` | `with-build-lock bun test --timeout=0 scripts/budget-gate.test.mjs` (solo, no `--parallel`) |
| root suites | `node --test --test-concurrency=4 dist/__tests__/*.test.js` | `bun test --parallel=4 --timeout=0 --path-ignore-patterns=packages/** dist/__tests__/*.test.js` |
| sqlite suites | `with-build-lock bun test --timeout=0 <glob>` (only Bun stage) | unchanged command; now one of nine Bun stages |
| gate suites | `node --test --test-concurrency=4 <GATE_FILES>` | `bun test --parallel=4 --timeout=0 <GATE_FILES>` |
| build race | `node --test scripts/phase23-build-race.test.mjs` | `bun test --timeout=0 scripts/phase23-build-race.test.mjs` (unwrapped: its children take the real lock) |
| workspace suites | pool of `npm run test --workspace <dir> --if-present`, bound 2 | pool of `bun run --cwd <dir> test`, bound 2 |
| examples execution | `with-build-lock node --test scripts/examples-execution.test.mjs` | `with-build-lock bun test --timeout=0 scripts/examples-execution.test.mjs` |
| branch coverage | `with-build-lock node scripts/branch-coverage-audit.mjs` | `with-build-lock bun scripts/branch-coverage-audit.mjs` (the audit keeps its internal Node branch instrument) |

Root scripts: `node scripts/X.mjs` → `bun scripts/X.mjs`, `npm run X` chains → `bun run X`,
`npm run --workspace X` → `bun run --filter X`. Workspace `build` scripts run
`bun ../../scripts/with-build-lock.mjs tsc`, workspace `test` scripts run
`bun ../../scripts/with-build-lock.mjs --shared bun test --parallel=4 --timeout=0 <file set>`.

### 9.2 Runtime partition (discovery-only runs, no test bodies)

`bun test --test-name-pattern=zzzznomatch-p124-partition` per stage with the stage's own arguments
(sequential so the reporter prints one header per visited file; `--parallel` prints only a summary):

```text
dist stages=13 reported=567 tree=570 duplicates=0 missing=3 stray=0
  root suites                  searched= 166 headers=166
  sqlite suites                searched=   3 headers=3
  packages/mcp                 searched=   9 headers=9
  packages/prism-providers     searched=  70 headers=70
  packages/memory              searched=  86 headers=86
  packages/prism-work          searched=  36 headers=36
  packages/prism-core          searched=  79 headers=79
  packages/prism-channels      searched=   7 headers=7
  packages/prism-coding-tools  searched=  65 headers=65
  packages/ag-ui               searched=  24 headers=24
  packages/web-tools           searched=  19 headers=19
  packages/acp-agent           searched=   1 headers=1
  packages/hooks               searched=   2 headers=2
  build race                   searched=   1 headers=1
  budget gate                  searched=   1 headers=1
  examples                     searched=   1 headers=1
gate files=44 overlapping dist stages=0
MISSING: packages/memory/dist/__tests__/postgres-memory.integration.test.js, packages/prism-channels/dist/__tests__/signal-live.test.js, packages/prism-channels/dist/__tests__/telegram-live.test.js
```

The three "missing" files are the documented opt-in legs (`test:postgres`, `test:live`), asserted
as such in `scripts/run-all-tests.test.mjs`; they are the only built test files the default suite
does not own, and nothing runs twice. The static side of the same rule lives in
`scripts/run-all-tests.test.mjs` ("every workspace test file runs exactly once"), which expands each
package's declared arguments (directory args, last-segment globs, `--path-ignore-patterns`) and
fails on a gap or a duplicate.

Two partition mechanics the flip needed:

- The root stage's explicit list of 166 paths still pulled the two suffix twins
  (`content.test.js`, `schema.test.js`) under Bun (Task 1 §1.3). `--path-ignore-patterns=packages/**`
  removes them: the same discovery probe reports `searched=166` and `2120 tests`, matching Node's
  2120 exactly.
- Bun's test runner expands **only the last path segment** (`dist/__tests__/*.test.js` works,
  `dist/**/__tests__/*.test.js` and `dist/*/__tests__/*.test.js` match nothing). The two packages
  whose scripts relied on a nested `**` glob (`hooks`, `prism-coding-tools`) now pass the `dist`
  directory; `prism-core` replaces `$(find …)` with `--path-ignore-patterns='dist/sessions/sqlite/**' dist`;
  `prism-providers` keeps its pre-flip set with two ignore patterns. `scripts/run-all-tests.test.mjs`
  asserts the directory form so a nested glob cannot come back.

### 9.3 Same-load A/B against the Node runner (back-to-back, load 7–12 on 16 CPUs)

| Candidate | Bun | Node |
| --- | --- | --- |
| root suites (`--parallel=4` vs `--test-concurrency=4`) | 27.1 s / 27.3 s | 29.7 s / 30.7 s |
| gate suites (44 files) | 48.0 s / 50.1 s | 50.0 s / 53.4 s |
| `build:core` leaf (up-to-date tsc) | 15 ms / 15 ms | 31 ms / 33 ms |
| full `bun run build` (11 workspaces + core) | 4.9 s / 4.9 s | 3.4 s (Node-era chain, different load window) |
| sqlite (3 files, Task 1 §6.2) | 0.44 s | 0.47 s |
| workspace pool (11 leaves, Task 1 §6.4) | 13.9 s (aggregate) | 19.5 / 20.3 s |
| examples (Task 1 §6.5) | 3.5 / 3.7 s | 10.0 s |

No stage regressed beyond host noise, so no stage was reverted to Node. The only Bun-vs-Node
divergence that is deterministic (not load) is the budget-gate startup **ratio** (§6.6) — a Task 4
recalibration row, not a runner choice.

### 9.4 Three full-chain runs (`bun scripts/run-all-tests.mjs`)

| Stage | Run 1 (load 9.4–14.3) | Run 2 (load 7.7–14.3) | Run 3 (load 10–13) |
| --- | --- | --- | --- |
| build | 14.1 s | 6.1 s | 6.4 s |
| performance budget | 15.8 s | 4.7 s | 5.0 s |
| root suites | 34.4 s | 115.5 s | 41.8 s |
| sqlite suites | 0.6 s | 2.8 s | 0.7 s |
| gate suites | 196.9 s | 76.9 s | 62.1 s |
| build race | 22.7 s | 23.3 s | 21.7 s |
| workspace suites | 16.5 s | 17.5 s | 15.4 s |
| examples execution | 6.1 s | 5.3 s | 4.6 s |
| branch coverage | 49.7 s | 48.8 s | 42.2 s |
| **total wall clock** | **5 m 57 s** | **5 m 01 s** | **3 m 20 s** |

The spread is host load, not the flip (the same stage varies 34–115 s across runs; the A/B table in
§9.3 is the controlled comparison). Known red rows after the flip, each attributed:

- **performance budget** — startup ratio 11.8–15.4 vs the Node-calibrated ceiling 8 (§6.6). Task 4.
- **gate suites** — redaction benchmark `speedup_ge_min` flaked in every run; `multi-agent` fan-out
  speedup flaked in run 2. Both are same-process ratios measured under load; Task 4 recalibrates
  the redaction budget (§6.7) and the gate's bounded worker count keeps the multi-agent leg in the
  suite. Node's identical runs pass because the Node process is slower, which *raises* both ratios.
- **root suites** — `docs > plans index links every active numbered plan` only; `plans/README.md` is
  missing `130-Cyclic-Workflow-Graphs.md` in this working tree and the same test is red under Node.
- **branch coverage** — the audit's Node coverage instrument re-runs the core suite; the
  `field-policy` 10 % overhead and `run-bundle` 100-tool snapshot real-time assertions flake under
  host load (both pass solo, and the same rows flaked under Node in the Node-era chain). Task 4's
  recalibration covers them.

### 9.5 Root-script parity re-measured after the flip

| Script | Result |
| --- | --- |
| `bun run build` | exit 0, 11 workspace leaves |
| `bun run typecheck` | exit 0 |
| `bun run lint` / `format:check` / `sweep:unused` | exit 0 (1799 files formatted) |
| `bun run pack:dry-run` | exit 0, 12 tarballs in 3.5 s — the `E2BIG` recursion is gone (`bun run --filter '*' pack:dry-run`) |
| `bun run test:live` | exit 0, 4 ran / 52 skipped / 0 failed; 56 manifest commands migrated to `bun test --timeout=0` / `bun run --filter` |
| `bun run security:threat-suites` | exit 0, 83 tests / 13 files in 3.4 s |
| `bun run test:coverage` | script runs end to end; the only red test is the pre-existing plans-index row |
| `bun run coverage:summary` | exit 0 when handed the captured core run; the standalone fallback re-runs the core suite and inherits the plans-index row |
| `bun run release:evidence` | exit 0, manifest written |
| `bun run release:gate` | fail-closed: `release.mjs gate` refuses a blocked manifest (no `PRISM_TEST_POSTGRES_URL`) |
| `bun run test` | the §9.4 table |

### 9.6 Node-spawn scan and the two exceptions

`scripts/tooling-gate.test.mjs`'s scan rule flipped: no spawn may name `node` (a Bun-only host may
not have the binary) and no Node-only test flag may ride `process.execPath` (which is Bun under the
only parent; `bun --test` is a script run). The matcher is shape-based — any call whose first
argument is the literal `"node"` and whose second is an argument array — so a differently named
helper cannot hide a spawn (`runInProject("node", …)` was the case that exposed the first,
name-list version). A repo-wide scan over `src/`, `scripts/`, `packages/`, `examples/` (1796 files)
now reports zero offenders outside two documented exceptions:

- `scripts/branch-coverage-audit.mjs` — the Node branch instrument; Bun 1.4.2 emits no branch data
  (plan 120 Task 6). The stage wrapper itself runs under Bun.
- `packages/prism-coding-tools/src/security/__tests__/docker-sandbox.test.ts` — passes the string
  `"node"` to `computeCommandFingerprint` as a command NAME to hash; data, not a spawn.

Fixed by the flip: `src/__tests__/install-smoke.test.ts` (10 consumer-fixture spawns),
`src/__tests__/cli-provider-add.test.ts` (the scaffolded fixture suite now runs `bun test` and
asserts Bun's pass count), `scripts/e2e-cli-live.test.mjs`,
`scripts/phase23-build-race.test.mjs` (3 importer leaves + `bun -e` lock holders),
`scripts/phase23-security.test.mjs` (2), `scripts/post-publish-smoke.mjs`,
`scripts/wiki-scratch-isolation.test.mjs`, and `scripts/blocked-gate.test.mjs`'s `runGate`
(`bun test <file>` for style-`test` rows — `bun --test` cannot run them, §6.9).

The env-strip rule follows Task 1 §7: nothing is stripped for Bun children (Bun sets and reads no
`BUN_*`/`NODE_TEST_*`); the pre-existing `NODE_TEST_*` strips in generic helpers stay because they
also serve Node-instrument leaves.

### 9.7 Wiki isolation verdict applied

`scripts/wiki-scratch-isolation.test.mjs` now spawns a plain sequential `bun test --timeout=0 <wiki
dir>` per cwd (one process, the `--test-isolation=none` guarantee) and asserts the Bun pass count;
the Node-only isolation flag and the `NODE_TEST_CONTEXT` strip are gone. The gate's four tests pass
under Bun, including both pollution-detector runs.

### 9.8 Security re-proof

The `with-build-lock.mjs` mutual-exclusion probe re-ran under the flipped parent: an exclusive
writer holds the `O_EXCL` lock for 1.5 s and a `--shared` reader that starts 300 ms in waits
1227 ms before acquiring (`writer exit=0`, `reader exit=0 waited=1227ms`). Real-time ceilings fail
closed: the budget-gate startup assertion and the redaction benchmark still fail the stage rather
than being deleted, and Task 4 is the only place allowed to move their numbers.

### 9.9 Task 2 follow-ups recorded (not Task 2 defects)

- Contributor-facing messages that still say `node scripts/…` as a regeneration hint
  (`scripts/package-truth.mjs` callers, `scripts/live-doc-check.test.mjs`,
  `scripts/phase27-ha.test.mjs` fixtures) — no spawns; Task 6's doc pass owns the wording.
- Workflow steps still say `npm run …` / `actions/setup-node` — Task 5.
- The budget/redaction/multi-agent/field-policy/snapshot ceilings — Task 4.

## 10. Task 3 — Postgres evidence parser on Bun's reporter (measured 2026-09-25)

### 10.1 The contract, checked against real captures before it was written

`scripts/postgres-evidence.mjs` used to read Node's TAP (`^(?:#|ℹ) (tests|pass|fail) (\d+)$`). The
legs run `bun test` since Task 2, so the parser reads Bun's default reporter instead. The shapes
were taken from two full captures on this tree and re-parsed by the new code:

| capture | summary line | `(pass)` lines | `(fail)` lines | summary counts | parse result |
| :--- | :--- | ---: | ---: | :--- | :--- |
| root suites (`/tmp/p124-root-final2.log`) | `Ran 2120 tests across 166 files. [35.65s]` | 2118 | 2 | `2118 pass`, `1 skip`, `1 fail` | `{tests: 2120, pass: 2118, fail: 2}` |
| gate suites (`/tmp/p124-gate-final2.log`, 44 gate files then) | `Ran 280 tests across 44 files. [51.70s]` | 277 | 2 | `277 pass`, `2 skip`, `1 fail` | `{tests: 280, pass: 277, fail: 2}` |

Three facts this pins down:

1. `(pass) name [time]` prints once per passing test, including under `--parallel` and with stdout
   redirected to a file — so `counts.pass` is exact.
2. Bun prints each **failure** twice: once at its position (`/tmp/p124-root-final2.log:980`) and
   again in the end-of-run failure block (`:2849`, identical name and time). `counts.fail` therefore
   over-counts. That is harmless for the wrapper (it only writes evidence when `fail === 0`) and is
   documented in the parser comment so nobody "fixes" the asymmetry by trusting the duplicates.
3. `Ran N tests across M files.` counts every test including skips, so `tests >= pass + fail` — the
   invariant the parser enforces is `pass <= tests`, never equality.

### 10.2 The parser and its fail-closed ladder

Three exported functions, no TAP residue anywhere in the script:

| function | contract |
| :--- | :--- |
| `parseReport(output)` | `{tests, pass, fail}` from the summary + result lines; throws when the summary line is absent |
| `evidenceCounts(output)` | `parseReport` plus the fail-closed ladder |
| `evidenceDocument({gitHead, captured, output})` | the only thing that reaches disk: `{gitHead, captured, counts}` — the capture is never persisted |

Fail-closed ladder (each one exits non-zero and writes nothing):

| capture | failure |
| :--- | :--- |
| `""` | no `Ran N tests across M files.` summary |
| result lines without a summary (truncated capture) | no summary |
| `Ran 0 tests across 0 files.` | no tests ran |
| summary with zero `(pass)` lines | no passing tests recorded |
| any `(fail)` line | `N failing test(s)` |
| more `(pass)` lines than the summary's test count | pass count exceeds the summary |

The CLI sits behind the import-hygiene direct-execution guard
(`if (process.argv[1] === fileURLToPath(import.meta.url))`), so `scripts/import-hygiene.test.mjs`
can import the module without a suite run or a file write; the child is spawned as
`bun run test:postgres:run` (was `npm run`), keeping the wrapper inside the Bun-only toolchain.

### 10.3 Probes

| probe | result |
| :--- | :--- |
| `parseReport` over the two real captures above | exact counts, table §10.1 |
| `evidenceCounts` over the gate capture (has failures) | throws `2 failing test(s)` — evidence refused |
| temp root + stubbed green child (`/tmp/p124pe`, 3 pass lines + `Ran 4 tests across 2 files.`) | EXIT 0, file written: `{gitHead: "68ed844…", captured, counts: {tests: 4, pass: 3, fail: 0}}` — the shape `scripts/release-skip-manifest.mjs` validates |
| temp root + child that exits 0 printing no summary | EXIT 1, `produced no clean bun summary; evidence not written (no \`Ran N tests across M files.\` summary in the capture)`, no file |
| repo-level `bun run test:postgres` with no `PRISM_TEST_POSTGRES_URL` | EXIT 1 at `require-postgres-url` (gate first), no `scripts/postgres-evidence.json` — fail closed, no stray artifact |

The success path cannot run on a host without PostgreSQL: the real chain's workspace legs need a
server, so the green leg stays a `postgres-integration` CI job and the write path is proved with a
stubbed child in a temp root instead.

### 10.4 Wiring and gates

- `scripts/postgres-evidence.test.mjs` (new, 5 tests) is registered in `GATE_FILES`
  (`scripts/run-all-tests.mjs`), so the gate stage grew 44 → 45 files / 280 → 285 tests; the gate
  run after the change shows `Ran 285 tests across 45 files. [49.62s]` with only the known Task 4
  redaction flake.
- The same file pins the chain order by index: `require-postgres-url` gate → the three
  `bun run --filter` workspace legs → the three phase conformance files, and asserts the chain
  contains no `npm `.
- `scripts/release-skip-manifest.mjs`'s missing-evidence reason now says
  `run bun run test:postgres`.
- `docs/testing.md`'s Postgres sentence describes the reporter contract and the fail-closed rule;
  `docs/release-and-install.md`'s "TAP counts" phrase became "reporter counts". The remaining stale
  `node --test`/TAP prose in that file belongs to Task 6's rewrite.
- Deliberately not done: **Reject: junit reporter + XML parse.** It would add a second parsing
  surface (and an XML reader) for counts the text contract already carries.
  **Reject: keep the Postgres leg on `node --test`.** The plan removes Node from the contributor
  path; the leg would then be the only stage a contributor cannot run.

## 11. Task 4 — absolute-time ceilings re-measured on the Bun instrument (2026-09-25)

### 11.1 Method (one method, cited once)

Plan 023's method, the same one every ceiling below cites: **min of ≥2 back-to-back runs on the
host that will run the gate, then the documented margin** — never the Node number ported. Each row
records the runs, the spread, and either the new value or the reason the value did not move. All
measurements: bun 1.4.2, node v26.10.0, 16 CPUs, 61 GB RAM, load/cpu noted per row.

### 11.2 The table

| ceiling | site | Node-recorded | Bun measured (runs) | decision |
| :--- | :--- | :--- | :--- | :--- |
| startup ratio (idle) | `scripts/budgets.json#startup` → `scripts/budget-gate.test.mjs:264` | 3.3 baseline / 8 ceiling | min 6.04, p50 12.7, max 15.2 (35 idle runs, load/cpu 0.24-0.41) | **8 → 24**, baseline 3.3 → 12.7 |
| startup ratio (loaded) | same | 20 | max 38.3 (5 runs at load/cpu 1.27; 28.6 at 0.66, 24.7 at 0.93) | **20 → 60** |
| load threshold | `scripts/budget-gates.mjs:96` | 1.5 loadavg/cpu | import inflates 3-4× from load/cpu ~0.7 while the empty start barely moves (import 43 → 122-196ms at 0.66, 326ms at 0.93) | **1.5 → 0.5** |
| absolute import | `scripts/budgets.json#startup` | 38 baseline / 250 ceiling | import 31.8-59.1ms idle (35 runs) | **baseline 38 → 45**, ceiling 250 kept (4.2× headroom) |
| planted-import control | `scripts/budget-gate.test.mjs:317` | denominator floor 20ms | empty Bun start 2.50-7.20ms | **floor 20 → 2ms** (800ms planted import → 400, still fails every ceiling) |
| redaction `minSpeedup` | `scripts/budgets.json#redaction` → `scripts/benchmark-scenarios/redaction.mjs` | 12 measured / floor 5 | sequential form min 3.37 (20 idle runs) and 3.18 (5 runs with three gate files running); interleaved form min 6.95, p50 8.1 (25 runs idle + loaded) | floor **kept at 5** = min × 0.72; the *method* changed to interleaved A/B (§11.4) |
| redaction p95s | same | 250 / 25 | transcript p95 ≤ 2.03ms, small p95 ≤ 0.27ms (25 runs) | kept |
| tool-search `indexScoreCeilingMs` | `scripts/budgets.json#toolSearch` → `scripts/benchmark-tool-search.test.mjs:56` | 1.9-2.2 / ceiling 50 | 2.58-4.60 idle, 2.89-4.60 with three gate files running, 7.7-24.8 at load/cpu ~1.5 | kept at 50 (2× margin at the worst observed) |
| memory source recheck | `packages/memory/src/rag/__tests__/access-recheck.test.ts:355` | 5ms budget | 0.104-0.118ms median (5 runs; same-session Node 0.50-0.66ms) | kept at 5 (45× headroom) |
| prism-work document extract | `scripts/budgets.json#docReader` → `packages/prism-work/src/document-reader/__tests__/index.test.ts:25` | 2000ms budget | 349.5-374.7ms (3 runs; same-session Node 382.7-389.9ms) | kept at 2000 (5× headroom) |
| run-bundle 100-tool snapshot | `src/__tests__/run-bundle.test.ts:181` | 5ms budget | 0.56-0.70ms median (5 runs; same-session Node 0.93-1.26ms) | kept at 5 (7× headroom) |
| field-policy overhead | `src/__tests__/field-policy.test.ts:384` | 110% cap | 85-92% of the redactor walk (3 runs; same-session Node 65-75%) | kept at 110% (faster than the walk it is measured against) |
| multi-agent fan-out | `scripts/benchmark-multi-agent.test.mjs:142` | 1.4× floor | 1.871-1.890× (5 runs; same-session Node 1.869-1.898×) | kept at 1.4 (timer-bound, identical on both runtimes) |
| e2e journey ceilings | `scripts/phase12-freeze-manifest.json` (120s) → `scripts/e2e-{coding,enterprise}-journey.test.mjs`; `scripts/e2e-full-surface.test.mjs:17` (180s) | 120s / 180s hang bounds | whole file including pack + install + journey: 26.6-29.2s, 6.2-6.7s, 15.2-15.3s (2 runs each) | kept (≥4× headroom) |

### 11.3 The startup gate: why the ratio, not just the number, moved

Bun's cold import is 31.8-59.1ms and its empty process start is 2.50-7.20ms, so the ratio sits at
6.04-15.2 idle — **the Node-calibrated ceiling of 8 was below Bun's minimum**. The denominator is
also the noisy side under Bun (2.50-7.20ms is a 2.9× spread on a 3ms measurement), so the idle
ceiling takes the max-of-35 and a margin: `24 = 15.2 × 1.58`, and it still catches a 1.9× import
regression at the idle median (`12.7 × 1.9 = 24`).

Under load the ratio is not load-cancelling the way it was on Node: the import inflates 3-4× while
the empty start barely moves, so a host at load/cpu 1.27 reaches ratio 38.3 — inside the band the
Node-calibrated threshold of 1.5 called "not loaded", where the absolute ceiling is still asserted
(and 326ms imports were observed at 0.93). The threshold moved to 0.5 for this instrument, and the
loaded ceiling to 60 (`= 38.3 × 1.57`, the same ~1.6× margin as the idle side).

### 11.4 The redaction ratio: the method was the problem, not the floor

Measured sequentially (the shipped form), Bun's ratio was 3.37-9.55 idle and 3.18-4.46 with three
gate files running — the floor of 5 sat *inside* that distribution, which is why the gate flaked.
The two phases were measured in separate loops, so each phase saw a different amount of the
scheduler's attention; Bun's single scan (0.77-0.88ms) is the more contention-sensitive side.

The scenario now interleaves the two phases per iteration — the A/B method
`src/__tests__/field-policy.test.ts` already uses for its ratio — and the distribution is both
higher and tight:

| form | idle | with three gate files running | same-session Node |
| :--- | :--- | :--- | :--- |
| sequential (before) | 3.37-9.55 (20 runs, min 3.37) | 3.18-4.46 (5 runs) | 10.7-14.3 (5 runs) |
| interleaved (after) | 6.98-8.94 (10 runs, p50 8.1) | 6.95-9.55 (15 runs) | 9.52-11.27 (5 runs) |

So `minSpeedup` keeps its Node-era value of 5 (`= 6.95 × 0.72`) and the per-phase p50s stay in the
report rows. This is the one place where the Bun instrument did not need a looser number — it needed
the measurement to compare like with like.

### 11.5 Three consecutive full-suite runs (plan 119 §18 method)

`bun scripts/run-all-tests.mjs`, back to back, no other work in flight:

| run | wall clock | load/cpu at start | stages | result |
| :--- | ---: | ---: | :--- | :--- |
| 1 | 5m18.4s | 0.80 (12.84) | 9 | **all passed** |
| 2 | 3m50.3s | 1.42 (22.73) | 9 | **all passed** |
| 3 | 3m36.4s | 1.73 (27.75) | 9 | **all passed** |
| 4 (final tree, after the comment-only re-measurement notes landed and rebuilt) | 2m35.9s | 0.67 (10.70) | 9 | **all passed** |

All three ended `all 9 stages passed`, and the branch-coverage stage reported
`branch-coverage: ignored instrumented timing assertion(s); floor still applies` with core branches
86.54 ≥ the 83.49 floor — the audit's documented tolerance for wall-clock asserts under Node's
instrument, which now runs as designed (before this task its non-timing failure was the plans-index
doc row, §11.7).

### 11.6 Security review: what moved, and what did not

Every number that changed is a **performance** budget: two ratio ceilings, their baseline, the
absolute import baseline, the load-classification threshold, and a test fixture's denominator floor.
The absolute import ceiling stayed at 250ms. Nothing in the diff touches a fail-closed timeout, a
request/response byte cap, a retry/lease TTL, or any correctness assertion: `minSpeedup`,
`indexScoreCeilingMs`, the p95s, the memory/doc-reader/snapshot budgets, the field-policy ratio, the
fan-out floor and the journey hang bounds all kept their values, each with its Bun re-measurement
recorded in the owning comment.

### 11.7 Incidental blocker fixed (pre-existing, not a Bun defect)

The root suite's `docs > plans index links every active numbered plan` row was red in every run of
this session (and under Node too): `plans/130-Cyclic-Workflow-Graphs.md` existed on disk while
`plans/README.md` had no row for it (the 122-129 rows were added by an earlier session, 130 landed
after). Because that failure is not a timing assert, it also turned the branch-coverage stage's
tolerance into a stage failure ("suite failed for a reason other than an instrumented timing
assertion"). Adding the missing index row fixed both. It is a tree-state fix, not a ceiling change,
and is recorded here because the three-green-run acceptance depended on it.

## 12. Task 5 — CI on Bun (measured 2026-09-25)

### 12.1 Every workflow installs Bun; `setup-node` is gone except the two declared support legs

All ten `.github/workflows/*.yml` now carry `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6`
(the pinned `v2.2.0` revision) with `bun-version: "1.4.2"` and install with `bun ci`;
`live-canaries.yml` gained the pair (it previously ran `node scripts/live-canary.mjs` with no install
at all — the script imports only `node:fs/promises`/`node:url`, so it needed no dependency tree, but
the install keeps the workflow uniform).

`actions/setup-node` is deleted from eight workflows and from `release.yml`'s `verify`,
`postgres-integration`, `supply-chain`, `office-validation` and `publish` jobs. Two uses remain, both
in `release.yml`, both measured rather than declared:

| leg | line | what it measures |
| :--- | ---: | :--- |
| `verify` (`node-version: "24"`) | 26 | `node scripts/public-import-smoke.mjs` — every public root `exports` default target on Node 24 |
| `node22-compat` (`node-version: "22"`) | 117 | the same smoke on Node 22 |

**Why these two survive** (the plan's Compromises entry records it): the eleven manifests still
declare `engines.node >=22`, and `scripts/phase12-freeze-manifest.json` — the live support-matrix
source of truth for the 0.1.x line, consumed by later freeze manifests and the e2e journey gates —
records `support.node.supported`/`measuredInCi` = `["22","24"]` and its `$comment` names exactly
"release.yml legs: verify on Node 24, node22-compat build/import smoke on Node 22".
`scripts/phase12-freeze.test.mjs:135-139` asserts `release.yml` contains `node-version: "22"` and
`node-version: "24"`. Deleting those legs while the support line is still declared would delete the
only measurement of a published contract — the plan's own Security criterion forbids loosening a
gate to make a change land, so the legs stay until plan 125 Task 1 flips `engines` to Bun (which
retires the manifest's Node block, the legs, and this smoke script together).

The smoke body moved out of the old inline `node --input-type=module` heredoc into
`scripts/public-import-smoke.mjs` (14 lines) so both legs measure the same thing:
`public-import-smoke: 26 export targets imported on v26.10.0` (Node 24 on this host) and
`… on v26.3.0` (Bun's emulated `process.version`, the probe's own report).

### 12.2 Command flips, per workflow

| workflow | before | after |
| :--- | :--- | :--- |
| canary-providers | `npm run build:core && npm run build -w @arnilo/prism-providers`; `node scripts/with-build-lock.mjs node --test …/live.test.js` | `bun run build:core && bun run --filter @arnilo/prism-providers build`; `bun scripts/with-build-lock.mjs bun test --timeout=0 …/live.test.js` |
| coding-journey | `npm run build`; `npx --no-install playwright-core install chromium`; `node --test scripts/phase26-coding-journey.test.mjs` | `bun run build`; `bunx --no-install playwright-core install chromium`; `bun test --timeout=0 scripts/phase26-coding-journey.test.mjs` |
| integration-nats | `npm run build:core && npm run build -w @arnilo/prism-core`; `npm run test:nats --workspace @arnilo/prism-core` | `bun run build:core && bun run --filter @arnilo/prism-core build`; `bun run --filter @arnilo/prism-core test:nats` |
| integration-office | build pair; `node --test scripts/office-golden-packed.test.mjs` | bun pair; `bun test --timeout=0 scripts/office-golden-packed.test.mjs` |
| integration-postgres | build pair; `npm run test:postgres --workspace …`; `node --test scripts/phase27-ha.test.mjs`; two `node scripts/drill-migration-rollback.mjs` | bun pair; `bun run --filter @arnilo/prism-core test:postgres`; `bun test --timeout=0 …`; two `bun scripts/drill-migration-rollback.mjs` |
| live-canaries | `node scripts/live-canary.mjs`, no install | `bun ci` + `bun scripts/live-canary.mjs` |
| live-matrix | `bun ci && npm run build`; `npm run test:live`; `node scripts/e2e-coverage-gate.mjs …` | `bun ci && bun run build`; `bun run test:live`; `bun scripts/e2e-coverage-gate.mjs …` |
| release (verify) | `phase typecheck npm run typecheck` … `phase "npm test" npm test` … `phase release:gate npm run release:gate` | the same phases on `bun run …` (`phase "bun run test" bun run test`), plus the Node 24 smoke |
| release (publish) | `npm run build`; `node scripts/verify-sbom.mjs`; `node scripts/scan-secrets.mjs`; `npm run release:publish -- …` | `bun run build`; `bun scripts/verify-sbom.mjs`; `bun scripts/scan-secrets.mjs`; `bun run release:publish -- …` (npm keeps pack/publish/sbom) |
| security | `node scripts/verify-sbom.mjs`; `git ls-files -z \| xargs -0 node scripts/scan-secrets.mjs`; `npm run build`; `node scripts/scan-secrets.mjs …` | the same on `bun` (npm keeps `sbom`, and `pack` in the artifact sweep) |
| sandbox-browser | six `npm run build…`; five `npm test -w …`; `npm run test:live -w …`; `npx --no-install …`; `node scripts/live-matrix.mjs`; `node --test scripts/benchmark.test.mjs`; `npm run sweep:unused`; `node -e …` | `bun run build:core` + five `bun run --filter <pkg> build`; five `bun run --filter <pkg> test -- --test-name-pattern …`; `bun run --filter @arnilo/prism-web-tools test:live`; `bunx --no-install …`; `bun scripts/live-matrix.mjs`; `bun test --timeout=0 …`; `bun run sweep:unused`; `bun -e …` |

Two Bun behaviours the flip had to absorb, both measured:

- **`bun run` has no `-w`/`--workspace <name>` selector** (`bun run --help` lists `-F, --filter`,
  `--workspaces`, `--cwd`), so every `npm run <script> -w <pkg>` / `npm test -w <pkg>` became
  `bun run --filter <pkg> <script>`, and `bun run --filter <pkg> test -- <args>` forwards the extra
  arguments into the package script (probed: `--test-name-pattern "T9: …"` reached the script and
  filtered 646 tests away).
- **Bun's reporter does not list unfiltered skips**, so `sandbox-browser.yml`'s T9 capability probe
  (which grepped Node's `# SKIP`) now filters the package suite to the T9 test with
  `--test-name-pattern` — a filtered run *does* print `(skip) T9: …` (probed) — and matches
  `(skip) T9:` instead. Same evidence semantics (passed / skipped / failed), Bun-shaped.

### 12.3 The gate

`scripts/workflow-liveness.test.mjs` (already in `GATE_FILES`) grew three assertions and a scanner
widening — 9 pass / 0 fail:

1. **Bun-only installs.** Only `release.yml` may reference `actions/setup-node`, it must carry
   exactly `node-version: "22"` and `"24"` and nothing else, and every workflow must contain the
   pinned `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6`, `bun-version: "1.4.2"` and
   `bun ci`.
2. **No `npm run`/`npx`, and npm only as the registry toolchain.** `nonBunCommandProblems()` scans
   every line with comments stripped, rejecting `npx`, `npm run`, and any `npm <verb>` outside
   `pack`/`publish`/`sbom`/`view` (plan 125 Task 5's exception list) — with positive controls for
   `npm run`, `npx` and `npm ci`, and a non-vacuity floor of ≥20 Bun commands. It also asserts the
   *only* two steps that execute `node` are `release.yml:74` and `release.yml:127` (the smoke legs),
   so a new Node invocation cannot hide behind the exception.
3. **No retired script paths.** Every `scripts/*.mjs` a workflow names must exist on disk (the drift
   class that previously shipped a `test:drawio` call for a retired package).

The scanner that resolves workspace and script names was widened to the flipped forms —
`SCRIPT_RUN` (`npm run` *and* `bun run`), `FILTER_RUN` (`bun run --filter <pkg> <script>`) and
`WORKSPACE` (`-w`, `--workspace`, `-F`, `--filter`) — so the liveness gate still resolves names
after the flip instead of silently skipping `bun` lines.

Pins updated in the same change set (the Task 2 lesson: a flip and its assertion land together):
`src/__tests__/docs.test.ts` (`bun run sdk:ready`, `bun run test:postgres`, and the compatibility-leg
pin now asserts `scripts/public-import-smoke.mjs` contains the `Object.values(pkg.exports)` sweep
plus its invocation), `scripts/phase15-freeze.test.mjs:311` (`bun run sweep:unused`).

### 12.4 Verification

| check | result |
| :--- | :--- |
| `scripts/workflow-liveness.test.mjs` | 9 pass / 0 fail |
| gate files touching workflows/docs (`tooling-gate`, `import-hygiene`, `truth-current`, `version-literal-gate`, `phase38-codeql`, `phase23-quality-gates`, `phase24-truth`, `phase27-release`, `phase12-freeze`, `supply-chain-security`, `release`, `docs`) | 247 pass / 3 fail — all three are pre-existing `phase27-release` 0.2.7 rows (publishable count 12 vs 10, `docs/index.md` duplicate link, roadmap blocker) |
| root suites (`bun test --parallel=4 --timeout=0 --path-ignore-patterns=packages/**`, 166 files) | 2119 pass / 1 skip / 0 fail in 100.08s at load/cpu 1.15 |
| gate stage (45 `GATE_FILES`) at load/cpu ~1.8 | 281 pass / 2 skip / 5 fail — one real-time flake (multi-agent `>=1.4x` fan-out speedup under 4 QEMU VMs + 16-CPU parallel stages) and four pre-existing in-flight rows: `compat baseline stale` (`@arnilo/prism-core` workflow exports), the phase54 package-map pair (live export counts moving under the same work) and the `biome lint` zero-diagnostics row (`packages/prism-core/src/runtime/workflows/{route-node.test.ts,run/superstep.ts}`) |
| `bun run format:check` | clean over 1801 files |
| `biome lint` on the touched files | no diagnostics |
| `bun run build` | exit 0 (dist carries the updated pins) |
| YAML parse (`python3 -c "yaml.safe_load"`) | 9/10 parse clean; `canary-providers.yml` has the same pre-existing plain-scalar `run: echo "…: …"` strictness error at the same logical line before and after this task |

The full chain (`bun scripts/run-all-tests.mjs`) was attempted once and killed at the 30-minute tool
timeout inside the workspace stage: an unrelated 4-VM Talos cluster creation (`talosctl cluster
create qemu --controlplanes 3 --workers 1`) plus a colima VM were saturating the host (load average
29, 41 GB of 61 GB RAM in use) for the whole window. Per-surface verification above replaced it, and
Task 6's budget re-pin re-runs the chain three times on a quiet host.
