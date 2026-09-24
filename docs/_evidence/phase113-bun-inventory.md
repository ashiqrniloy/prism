# Phase 113 — Bun 1.4.2 Measured Inventory

Plan: [113-Bun-Dev-Toolchain.md](../../plans/113-Bun-Dev-Toolchain.md) Task 1.
Date: 2026-09-23. Host: linux x64, 16 cores, AMD Ryzen 9 PRO 7940HS; Bun 1.4.2 (`744846f84`),
local Node v26.9.0, npm 12.0.2. Baseline: working tree at HEAD `3129d5cf` (0.10.1 WIP), branch
`migration/bun`, root and workspace `dist/` built from this tree.

Method: every probe below was **re-run in this session on Bun 1.4.2** (not replaced by a newer Bun).
Install/build/timing probes ran in scratch trees extracted from `git archive HEAD` under `/tmp/phase113`
(not committed); runner probes ran in the real tree and in scratch trees. Transcripts are quoted with the
`$` command line; absolute home paths are elided. This file is the gate for Tasks 2–3: they implement only
what a row below closed, and they do not re-decide a row.

Cite convention: `path:Lstart` spans verified in this tree. Verdicts are `CONFIRMED` (reproduced) or
`REJECTED` (retired/unsafe).

---

## 0. Verdict summary

| # | Claim | Verdict |
| --- | --- | --- |
| 1 | `bun test` executes `node:test` (`describe` / `it` / `mock.method` / `t.mock.timers.enable({ apis: ["Date"] })`): 2 pass | CONFIRMED |
| 2 | `bun --test <file>` and `bun --experimental-test-coverage <file>` are **not** `node --test`: `Cannot use describe outside of the test runner` | CONFIRMED |
| 3 | Bun default per-test timeout is 5000 ms; `--timeout=0` disables it; per-test `{ timeout: 1000 }` still fires under `--timeout=0` | CONFIRMED |
| 4 | `process.execPath` is the Bun binary; `process.versions.node` is a compat string (`26.3.0`), not a Node install | CONFIRMED |
| 5 | `node:v8.getHeapStatistics` loads under Bun | CONFIRMED |
| 6 | `require("better-sqlite3")` loads, opens `:memory:`, executes DDL under Bun; built SQLite suites pass under `bun test --timeout=0` | CONFIRMED (24 pass / 0 fail on this tree) |
| 7 | `import("better-sqlite3")` returns a namespace, so `new m()` throws `Module is not a constructor` — namespace interop, **not** a block | CONFIRMED |
| 8 | The retired phrasing `expected throw naming issue 4290` does not reproduce; there is no `BunProcess.cpp` hard block | REJECTED |
| 9 | `bun.lock` is text JSONC-shaped (trailing commas, no comments); root `workspaces[""]` has no `version`; child workspaces do; `packages` values are tuples | CONFIRMED |
| 10 | No `bunfig.toml` needed for hoisted linking on this project: `node_modules/<pkg>` at top level, no `node_modules/.bun` | CONFIRMED |
| 11 | `bun install` skipped **no** lifecycle scripts (the installed tree declares none); `trustedDependencies` has no measured input | CONFIRMED |
| 12 | `bun audit --audit-level=moderate` exits 0 with no advisories; docs pin exit 1 when advisories remain | CONFIRMED (exit 0 locally) |
| 13 | `bun test` is **slower** than `node --test` on the root `dist/__tests__/*.test.js` glob (30.1 s vs 13.2 s) and has one Bun-only failure | CONFIRMED |

Rejected directions (do not implement): `bun:sqlite` as a driver, `drop engines.node`, `bun publish`,
`bun run --bun`, `replace tsc` with `bun build`, a `dual lockfile`, `rewrite node: imports` to `bun:test`,
and `coverageThreshold as the release gate`. Each is answered in §7.

---

## 1. Runner probes

### 1.1 `node:test` interop (`CONFIRMED`)

`bun test node-test.test.ts` — `describe`/`it` imported from `node:test`, `mock.method`, and
`t.mock.timers.enable({ apis: ["Date"] })` + `tick(5000)`:

```text
$ bun test node-test.test.ts
bun test v1.4.2 (744846f84)

node-test.test.ts:
(pass) node:test interop on bun > mock.method spies and restores [0.97ms]
(pass) node:test interop on bun > mock.timers Date can be ticked [1.13ms]

 2 pass
 0 fail
Ran 2 tests across 1 file. [21.00ms]
[exit=0]
```

### 1.2 `bun --test` is not `node --test` (`CONFIRMED`)

Both Node-only spellings run the file as a plain script, so `node:test`'s `describe` refuses:

```text
$ bun --test node-test.test.ts
error: Cannot use describe outside of the test runner. Run "bun test" to run tests.
      at addSuite (node:test:1693:13)
      at ~/probes/node-test.test.ts:4:1
[exit=1]

$ bun --experimental-test-coverage node-test.test.ts
error: Cannot use describe outside of the test runner. Run "bun test" to run tests.
[exit=1]
```

This is the measured reason Task 3 must spawn `bun test …`, never `bun --test`, and must not route
Node-only flags through `process.execPath` (`scripts/run-all-tests.mjs:L102–L115` today passes
`process.execPath` with `--test`; see §5).

### 1.3 Timeout (`CONFIRMED`)

`bun test --help` prints `--timeout=<val>  Set the per-test timeout in milliseconds, default is 5000.`

```text
$ bun test slow.test.ts                      # sleeps 6000 ms
(fail) sleeps six seconds [5005.86ms]
  ^ this test timed out after 5000ms …
 0 pass
 1 fail
[exit=1]

$ bun test --timeout=0 slow.test.ts
(pass) sleeps six seconds [6008.19ms]
 1 pass
 0 fail
[exit=0]

$ bun test --timeout=0 per-test-timeout.test.ts   # it(..., { timeout: 1000 }), sleeps 2000 ms
error: test timed out after 1000ms
(fail) per-test timeout 1000ms still fires [1003.20ms]
 0 pass
 1 fail
[exit=1]
```

Task 3 therefore adds `--timeout=0` to every `bun test` invocation and leaves per-test `{ timeout }`
options alone (they still fire).

### 1.4 Runtime identity and `node:v8` (`CONFIRMED`)

```text
$ bun -e '…'
execPath=/usr/bin/bun
versions.node=26.3.0
versions.bun=1.4.2
v8.getHeapStatistics=function
heap=true
[exit=0]
```

`process.versions.node` is Bun's compatibility string (the plan-writing host and this host both print
`26.3.0`, while the real Node here is v26.9.0). `engines.node >=22` still describes the published
runtime; Bun does not satisfy it by printing a number. `node:v8` loads.

### 1.5 Nested-runner environment (`CONFIRMED`)

A test that prints its own `BUN*`/`NODE_TEST*`/`NODE_OPTIONS`/`NODE_UNIQUE_ID` env and the same filter
from a child spawned with `process.execPath`:

```text
$ bun test --timeout=0 env.test.ts
TEST_PROCESS_ENV {}
CHILD_ENV {}
EXECPATH /usr/bin/bun
 1 pass / 0 fail

$ node --test env.test.ts                     # contrast
TEST_PROCESS_ENV {"NODE_TEST_CONTEXT":"child-v8","NODE_TEST_WORKER_ID":"1"}
CHILD_ENV {"NODE_TEST_CONTEXT":"child-v8","NODE_TEST_WORKER_ID":"1"}
```

**No `BUN_*` or `NODE_TEST_*` variable is set by `bun test`.** Task 3 strips only the Node
`NODE_TEST_*` names it already strips (`scripts/with-build-lock.mjs`) and must not invent a `BUN_TEST_*`
strip.

---

## 2. `better-sqlite3` inventory and classification

### 2.1 Driver probes (`CONFIRMED`)

```text
$ bun -e 'const Database = require("better-sqlite3"); …'
DDL+insert+select ok: {"c":1}
[exit=0]

$ bun -e 'const m = await import("better-sqlite3"); …'
module keys: SqliteError,default,length,name,prototype
new m() throws: Module is not a constructor (evaluating 'new m')
new m.default() ok
[exit=0]
```

The `import()` result is a namespace object; only `.default` is the constructor. That is why the plan's
earlier reading was wrong. Retired phrasing `expected throw naming issue 4290` — REJECTED: the failure is
ESM namespace interop in the probe, not a `BunProcess.cpp` hard block, and `require`/`.default` both work.
Source `require` sites use `createRequire` (`packages/prism-core/src/sessions/sqlite/persistence.ts:L65`,
`packages/prism-core/src/governance/prompts/sqlite.ts:L10`), so they are unaffected.

### 2.2 Built suites under `bun test --timeout=0` (`CONFIRMED`)

```text
$ bun test --timeout=0 packages/prism-core/dist/sessions/sqlite/__tests__/*.test.js
 24 pass
 0 fail
Ran 24 tests across 3 files. [339.00ms]        # real 0m0.359s

$ bun test --timeout=0 packages/prism-core/dist/governance/prompts/__tests__/prompts.test.js
 4 pass / 1 skip / 0 fail
Ran 5 tests across 1 file. [35.00ms]

$ node --test packages/prism-core/dist/sessions/sqlite/__tests__/*.test.js
ℹ tests 24 / pass 24 / fail 0 / duration_ms 374.07   # real 0m0.400s
```

The plan-time probe recorded `23 pass`, `0 fail`, ~360 ms; this tree records `24 pass`, `0 fail`, 339 ms
(one test was added after the plan was written). The database actually opened — `:memory:` is in the
state-concurrency test name and the suite exercises DDL/leases/CAS. Both counts are recorded; the fresh
transcript is authoritative for this tree.

### 2.3 Every file that imports or `require`s `better-sqlite3`

Value/dynamic imports (non-test):

| Path | Kind |
| --- | --- |
| `packages/prism-core/src/sessions/sqlite/persistence.ts:L45` (`import type`), `:L65` `createRequire`, `:L69` `require`, `:L74` install hint | type + `createRequire` |
| `packages/prism-core/src/governance/prompts/sqlite.ts:L2` (type), `:L10` `createRequire`, `:L14` `require` | type + `createRequire` |
| `packages/prism-core/src/sessions/sqlite/{checkpoints,leases,lifecycle,migrations,types}.ts` | `import type` only |
| `packages/prism-core/src/governance/prompts/sqlite-migrations.ts` | `import type` only |
| `scripts/benchmark-scenarios/session-search.mjs:L14` | value import |
| `scripts/drill-migration-rollback.mjs:L33` | dynamic `import()` |

Other `createRequire` users (`packages/prism-core/src/sessions/postgres/persistence.ts`,
`packages/prism-core/src/enterprise/postgres/enterprise.ts`, `packages/prism-coding-tools/src/security/e2b-sandbox.ts`,
`packages/prism-providers/src/ai-sdk/provider.ts`, `packages/memory/src/rag/__tests__/local-reranker.test.ts`,
`src/cli-dev.ts`) target `pg`, `e2b`, `@ai-sdk/provider`, and `@huggingface/transformers` — not this driver.

Test files, classified (`bun-ok` = measured/expected to run under `bun test --timeout=0`):

| Test file | Class | Evidence |
| --- | --- | --- |
| `packages/prism-core/src/sessions/sqlite/__tests__/lifecycle.test.ts` | `bun-ok` | built counterpart in §2.2 |
| `packages/prism-core/src/sessions/sqlite/__tests__/sqlite-persistence.test.ts` | `bun-ok` | built counterpart in §2.2 |
| `packages/prism-core/src/sessions/sqlite/__tests__/state-concurrency-conformance.test.ts` | `bun-ok` | built counterpart in §2.2 |
| `packages/prism-core/src/governance/prompts/__tests__/prompts.test.ts` | `bun-ok` | built counterpart in §2.2 |
| `src/__tests__/install-smoke.test.ts` | `bun-ok` | mentions the driver in the fail-closed hint only; passed in the root `bun test` run (§4) |
| `packages/prism-channels/src/__tests__/postgres.integration.test.ts` | `bun-blocked` | Postgres evidence leg stays on `node --test` (TAP-parsed); driver mention is a `t.skip` message |

No test file is `bun-blocked` **because of** `better-sqlite3`.

### 2.4 Source-file probe without `dist/` (`CONFIRMED`)

In an archive copy with no `dist/` and no `node_modules/`:

```text
$ bun test --timeout=0 src/__tests__/artifacts-coverage.test.ts
 6 pass / 0 fail
Ran 6 tests across 1 file. [21.00ms]
[exit=0]
```

Bun resolves the TypeScript `../artifacts.js` specifiers to `../artifacts.ts` without a build. This is a
single-file probe only; the root source **glob** is Task 3's follow-up condition, not closed here.

---

## 3. Lockfile, linker, skipped scripts, audit

### 3.1 `bun.lock` shape (`CONFIRMED`)

`bun install --lockfile-only` in a scratch tree (package-lock.json present): `[1.72ms] migrated lockfile
from package-lock.json`, `Saved bun.lock (180 packages)`.

```text
$ node -e '… shape probe …'
JSON.parse throws: Expected double-quoted property name in JSON at position 244 (line 11 column 7)
contains // comments: false
contains /* comments: false
ends with newline: true
lockfileVersion: 2
workspaces[""]: {"name":"@arnilo/prism","devDependencies":{…}}
root has version key: false
child key: packages/acp-agent -> {"name":"@arnilo/prism-acp-agent","version":"0.10.0",…}
has version key: true
workspaces count: 12
package entry count: 181
```

`packages` values are **tuples**, not `{ version }`:

```text
typescript ["typescript@7.0.2","",{"optionalDependencies":{…},"bin":{"tsc":"bin/tsc"}},"sha512-8FYau96o…"]
```

Task 2's reader must strip trailing commas with an in-string-aware scan, must not expect a root
`workspaces[""].version`, must read child `workspaces[<path>].version`, and must not treat `packages`
tuples as a version source. No JSONC comments exist, so the `ponytail:` ceiling is only the comma case.

### 3.2 Linker and skipped lifecycle scripts (`CONFIRMED`)

With no `bunfig.toml`, in a fresh tree:

```text
$ bun install
137 packages installed [10.86s]
$ ls -d node_modules/better-sqlite3/package.json node_modules/.bun
node_modules/better-sqlite3/package.json
ls: cannot access 'node_modules/.bun': No such file or directory
```

Hoisted, top-level `node_modules/<pkg>`. It stays hoisted after `package-lock.json` is deleted (fresh
tree with only `bun.lock`): `bun install` → `137 packages installed [444.00ms]`, no `node_modules/.bun`.
Task 2's explicit `install.linker = "hoisted"` pin is still the contract, but it matches the measured
default for this project.

**Skipped lifecycle scripts: none.** A scan of the installed tree finds no `preinstall`/`install`/
`postinstall` script in any package. `better-sqlite3@13.0.3` ships `prebuilds/linux-x64.node` and declares
no install script; npm 12's `install: node-gyp rebuild` warning is npm's synthetic gypfile handling, and
that script was blocked in `npm ci` too — yet both runtimes load the driver after `bun install`:

```text
$ node -e 'require("better-sqlite3")…'   → node require ok   [exit=0]
$ bun -e 'require("better-sqlite3")…'    → bun require ok    [exit=0]
```

`trustedDependencies` therefore has **no measured input**; Task 2 must not add `better-sqlite3` on the
plan-time guess. If a future install prints a blocked-scripts list, that list is the only allowed input.

### 3.3 `bun audit` (`CONFIRMED`)

```text
$ bun audit --audit-level=moderate
bun audit v1.4.2 (744846f84)
No vulnerabilities found (checked 167 packages) [266.00ms]
[exit=0]
```

Docs (https://bun.com/docs/install/audit) verbatim: “`0` if no vulnerabilities remain after Bun applies
`--audit-level` and `--ignore`, `1` otherwise.” and “The JSON is unfiltered — `--audit-level` and
`--ignore` only affect the exit code.” So the CI gate is the text run's exit code, not `--json`.
Scoped-registry skip: “If that registry has no advisory endpoint, Bun lists those packages as skipped and
they don't affect the exit code.” This repo's dependencies are public npm packages, so that skip is not a
current hole; do not add `--ignore`.

---

## 4. Timings (wall clock, one machine; cold/warm called out)

| Step | Command | Wall | Notes |
| --- | --- | --- | --- |
| install | `npm ci` (warm npm cache, cold `node_modules`) | 1.54 s | 135 packages; 1.65 s on the repeat |
| install | `npm ci --cache <empty>` (cold npm cache) | 8.48 s | “added 135 packages … in 8s” |
| install | `bun install` (default cache, first) | 10.86 s | 137 packages; migrated `package-lock.json` |
| install | `bun install` (isolated empty cache) | 11.61 s | cache grew to 405 MB |
| install | `bun install` (warm) | 0.007 s | “no changes” |
| build | `npm run build:core` (`tsc`, root only) | 0.48 s | 308 emitted `.js`; 0.49 s on the repeat |
| build | `npm run build` (core + 11 workspaces) | 3.01 s | all `packages/*/dist` emitted |
| test | `node --test dist/__tests__/*.test.js` (real tree) | 13.20 s | 2068 tests, 2067 pass, 1 fail |
| test | `bun test --timeout=0 dist/__tests__/*.test.js` (real tree) | 30.13 s | 2082 tests, 2080 pass, 2 fail |
| test | `bun test --timeout=0` sqlite glob | 0.36 s | 24 pass / 0 fail |
| test | `node --test` sqlite glob | 0.40 s | 24 pass / 0 fail |

**Majority of the local loop: the test runner.** The root glob is 13–30 s against ~3 s for a full
TypeScript 7 native emit and 1.5 s for a warm `npm ci` (8.5 s cold). `tsc` is not the majority, so Task
3's `incremental: true` trigger does **not** fire.

Node runs test files across workers (13.2 s wall, 69 s user); `bun test` runs them in one process
(30.1 s wall, 33 s user) and is ~2.3× slower on this glob. Bun's only extra failure is the
`process.execPath --test` spawn in `src/__tests__/cli-provider-add.test.ts:L288` (§5); the
`docs > plans index links every active numbered plan` failure is pre-existing in both runners (the
unindexed plan 114, fixed in the same change as this evidence). Task 3's "slower stage reverts to
`node --test`" rule therefore keeps the root stage on Node unless the spawn fix changes the picture.

Bun install was **slower than `npm ci`** on this machine in both comparisons (warm 10.9 s vs 1.5 s; cold
11.6 s vs 8.5 s). Task 2's performance criterion must be decided on the CI runner class, not from this
warm-cache host; the numbers above are the cited input.

---

## 5. `process.execPath` spawns and workflow install hits

A scan of `src/`, `packages/`, `scripts/` (excluding `dist/`, `node_modules/`) found 63
`process.execPath` spawns carrying `--test`, `--test-isolation`, `--experimental-test-coverage`, or `-e`.

Node-only-flag spawns (13 × `--test`, 1 × `--experimental-test-coverage`; none use `--test-isolation`):

| Path | Flag |
| --- | --- |
| `scripts/run-all-tests.mjs:L102–L115` | `--test` (performance budget, root suites, gate suites, build race) |
| `scripts/coverage-summary.mjs:L81` | `--test --experimental-test-coverage` |
| `scripts/wiki-scratch-isolation.test.mjs:L88` | `--test --test-isolation=none` |
| `scripts/phase23-build-race.test.mjs:L47` | `--test` |
| `scripts/phase23-security.test.mjs:L64` | `--test` |
| `scripts/e2e-cli-live.test.mjs:L97` | `--test` |
| `src/__tests__/cli-provider-add.test.ts:L282,L288` | `--test` — the measured Bun-only failure |

The 49 `-e` spawns (examples, fixtures, benchmark scenarios, process/LSP/obscura test hosts) use Bun's
`-e`, which exists and is what let the rest of the root `bun test` run pass; they are not Node-only flags.

Workflow install hits under `.github/workflows/` (re-grepped at execution):

| Workflow | Lines |
| --- | --- |
| `security.yml` | `:63 npm ci` |
| `integration-postgres.yml` | `:45 cache: "npm"`, `:46 npm ci` |
| `integration-office.yml` | `:27`, `:28` |
| `sandbox-browser.yml` | `:33 npm ci` |
| `integration-nats.yml` | `:31`, `:32` |
| `release.yml` | `:25–:26`, `:112–:113`, `:149–:150`, `:188–:189`, `:208–:209`, `:233–:235` |
| `live-matrix.yml` | `:39 npm ci && npm run build` |
| `coding-journey.yml` | `:42`, `:43` |
| `canary-providers.yml` | `:39`, `:40` |

`live-canaries.yml` has no install hit, matching the plan. `oven-sh/setup-bun` appears in none of them
today; Task 2 adds `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6` (`# v2.2.0`) with
`bun-version: "1.4.2"` to these jobs and removes `cache: "npm"` (it keys off `package-lock.json`).

---

## 6. Lockfile migration note

`bun install` and `bun install --lockfile-only` both read `package-lock.json` when present and migrate it
(`[1.72ms] migrated lockfile from package-lock.json`). That is a bootstrap convenience only: Task 2
deletes `package-lock.json`, commits `bun.lock`, and CI runs `bun ci` (frozen). The two lockfiles must not
coexist (`dual lockfile` rejected).

---

## 7. Rejected directions (Task 2/3 must not pick these)

| Rejected | Why, from these transcripts |
| --- | --- |
| `bun:sqlite` as the driver | `better-sqlite3` is measured `bun-ok`; swapping the driver changes the published adapter contract and is not a dev-toolchain change. |
| `drop engines.node` | `process.versions.node=26.3.0` is a compat string; the published runtime is still Node, and 11 manifests declare `>=22`. |
| `bun publish` | publish is `npm pack --json` + OIDC/provenance; no probe here changes that contract. |
| `bun run --bun` | it symlinks `node`→Bun, which turns every `node --test` child into the broken `bun --test` path measured in §1.2. |
| `replace tsc` with `bun build` | packages ship `.d.ts` beside `dist/*.js`; `tsc` (TypeScript 7 native) emits both in 3.0 s. |
| `dual lockfile` | `bun.lock` and `package-lock.json` drift; CI can freeze only one. |
| `rewrite node: imports` to `bun:test` | `bun test` already executes `node:test` (§1.1); a rewrite is a 635-file diff for nothing. |
| `coverageThreshold as the release gate` | Bun's reporter is a different instrument than Node's `--experimental-test-coverage`; the 60/70/75 floors are Node numbers and plan 114 owns the recalibration. |

---

## 8. Security and hygiene

No credentials, `PRISM_*` secret values, or absolute home paths appear above; transcripts were filtered
before quoting. `bun audit` does not fail on registries without an advisory endpoint (docs, §3.3) and this
repo's dependencies are public npm packages, so that skip is not a current hole; `--ignore` is not
recommended and not added. The `bun audit --audit-level=moderate` gate is the text exit code; `--json` is
unfiltered and must not gate CI.

---

## 9. Task 2 note — install surface landed (2026-09-23)

`package-lock.json` is deleted; `bun.lock` (lockfileVersion 2, 180 packages, 181 `packages`
entries, 12 `workspaces` entries) is generated with `bun install --lockfile-only`
(`[1.11ms] migrated lockfile from package-lock.json`) and committed. `bunfig.toml` pins
`install.linker = "hoisted"` and `install.saveTextLockfile = true`; `install.frozenLockfile` stays
false locally (CI passes the flag via `bun ci`). `package.json` carries
`"packageManager": "bun@1.4.2"`; `mise.toml` pins `node = "24"` / `bun = "1.4.2"` for local dev.

Clean-tree install (`rm -rf node_modules && bun ci`, warm Bun cache): `137 packages installed
[346.00ms]`; a second `bun ci` reports `Checked 138 installs across 181 packages (no changes)
[3.00ms]`. The lockfile workspace name-set is the 11 `packages/*` names, byte-equal to
`expandWorkspaceDirs` on this tree, so the 12 publishable manifests `scripts/package-truth.mjs`
counts are unchanged. `node_modules/.bun` is absent — hoisted, as Task 1 measured.

**Skipped lifecycle scripts: still none.** Task 1's list is the only allowed input to
`trustedDependencies`, and it is empty, so no `trustedDependencies` entry is added.
`node -e "require('better-sqlite3')"` and `bun -e "require('better-sqlite3')"` both exit 0 after
`bun ci` (the shipped prebuild loads in both runtimes).

**Audit.** `bun audit --audit-level=moderate` replaces `npm audit --audit-level=moderate` in
`security.yml` and `release.yml` (text exit code, no `--json`).

**Performance criterion (Task 1 numbers, cited).** Warm `npm ci` 1.54 s vs `bun install` 10.86 s
first-run / 0.007 s warm; cold-cache `npm ci` 8.48 s vs `bun install` 11.61 s. `bun ci` is 0.35 s
with a warm Bun cache. The CI runner class is **not measurable from this host**, so the first CI run
on the new install surface is the measurement; if `bun ci` there is slower than Task 1's `npm ci` by
more than noise, revert the install step and record why (the lockfile and `scripts/bun-lock.mjs`
stay).

**Reader.** One function (`scripts/bun-lock.mjs`: `readBunLock` + `lockWorkspace`) serves
`scripts/release.mjs` (both validators), `scripts/version-literal-gate.test.mjs`, and
`scripts/truth-current.test.mjs`. Root version is read from `package.json`; a workspace entry's
`version` is the only lockfile version source; absent root `workspaces[""].version` is not a failure.
The trailing-comma scanner is in-string aware (a fixture in `scripts/release-gate.test.mjs` proves a
comma inside an integrity string survives).

**Pre-existing branch drift fixed in the same change.** The WIP src on this branch had already added
exported symbols and updated `scripts/budgets.json`, but the generated phase-54 evidence and several
generated docs blocks were stale, so `scripts/truth-current.test.mjs` failed before Task 2's edits.
`node scripts/package-truth.mjs --emit-docs` (the repo's prescribed fix) regenerated
`docs/_evidence/phase54-package-map.md`, `scripts/package-truth.json`, and the stale generated blocks
in `README.md`, `docs/index.md`, `docs/release-and-install.md`, `docs/provider-packages.md`, and the
drifted docs pages. No hand-written prose changed in that regeneration.

**Default-suite wall clock after Task 2 (before Task 3's runner split).**
`node scripts/run-all-tests.mjs` = **90.6 s wall**, all 6 stages pass: build 3.2 s, performance budget
3.1 s, root suites 12.4 s, gate suites 34.7 s, build race 10.0 s, workspace suites 27.2 s. This is the
"before" number for Task 3's before/after table; it is already above the documented < 60 s budget, so
Task 3's revert rule (a `bun test` stage slower than the Node stage it replaced goes back to
`node --test`) applies to any stage it touches.

---

## 10. Task 3 note — runner split landed (2026-09-23)

**One file set moved.** `scripts/run-all-tests.mjs` gains a `sqlite suites` stage:

```text
$ bun test --timeout=0 packages/prism-core/dist/sessions/sqlite/__tests__/*.test.js
 24 pass
 0 fail
Ran 24 tests across 3 files. [327.00ms]        # 3 consecutive runs: 359 / 369 / 356 ms
$ node --test packages/prism-core/dist/sessions/sqlite/__tests__/*.test.js
ℹ tests 24 / pass 24 / fail 0                  # 3 consecutive runs: 407 / 388 / 388 ms
```

The database actually opens — `:memory:` is in the state-concurrency test name and the suite exercises
DDL/leases/CAS, same transcript as §2.2, re-run on this tree. Bun wins by ~30 ms (7–8 %), so the
"slower stage reverts" rule does not fire. `--timeout=0` matches Node's no-default-timeout (Bun's 5000 ms
default would fail a slow test Node never times out); per-test `{ timeout }` options are untouched.

`packages/prism-core/package.json` `test` keeps every *other* dist test file on `node --test` and
excludes the glob above:

```text
$ find dist -name '*.test.js' ! -path 'dist/sessions/sqlite/__tests__/*' | wc -l
79                                             # 82 total - 3 sqlite; 675 tests, 0 fail under node
```

Node `--test` has no exclusion flag on v26.9.0 (`!pattern` is ignored — measured: `node --test
'dist/__tests__/*.test.js' '!dist/__tests__/release.test.js'` still runs all 2068 tests), so the Node
side uses `find … ! -path …` behind a `test -d dist` guard. `scripts/run-all-tests.test.mjs` asserts the
partition: 79 + 3 = 82, each file exactly once. This is why prism-core leaves plan 080's quoted-`**`
control (a `find` list cannot be collapsed by the shell); `hooks` and `prism-coding-tools` keep it.

**Reverted candidates (measured, not adopted).**

| Candidate | Bun | Node | Verdict |
| --- | --- | --- | --- |
| root `dist/__tests__/*.test.js` (Task 1 §4) | 30.1 s, 2 fail | 13.2 s, 1 fail (pre-existing) | stays Node |
| root *source* glob `src/__tests__/*.test.ts` (the plan's follow-up probe) | 30.75 s, 2080 pass / **2 fail** | n/a (stage runs built `dist/`) | does not land |
| prism-core workspace glob (whole package) | 8.89 s, 699 pass / 9 skip / 0 fail | 3.67 s, 699 pass / 9 skip / 0 fail | stays Node (2.4× slower) |
| performance budget `scripts/budget-gate.test.mjs` | not probed | single-process Node | stays Node (ceiling measures host contention) |
| coverage `--experimental-test-coverage` | plan 114 | unchanged | stays Node |
| Postgres TAP leg | §2.3 `bun-blocked` | unchanged | stays Node |

The root source glob's 2 failures are the `process.execPath --test` spawn in
`src/__tests__/cli-provider-add.test.ts:L288` (§5) and, separately,
`src/__tests__/run-bundle.test.ts:L120` reading `../run-bundle.js` through `import.meta.url` — under a
TypeScript-source run that resolves to `src/run-bundle.js`, which does not exist (`ENOENT`, measured on
this tree; it works under the dist run because `dist/run-bundle.js` is real). Correction recorded after a
plan 115 probe: an earlier revision of this note attributed both failures to the spawn. Fixing either is
not in this task's file list, and the 2.3× wall-clock gap would revert the stage anyway.

**Not changed.** `tsconfig.json` gains no `incremental: true`: `tsc` is ~3 s of a ~91 s suite (§4), not
the majority, so the trigger does not fire. `scripts/with-build-lock.mjs` is unchanged — Task 1 §1.5
measured no `BUN_*`/`NODE_TEST_*` variable set by `bun test`, so the existing `NODE_TEST_*` strip stays
and no `BUN_TEST_*` strip is invented. No `bun:test` import exists in `src/` or `packages/*/src`.

**Wall clock, before/after (same host, same tree, `node scripts/run-all-tests.mjs`).**

| Run | Wall | build | budget | root | sqlite | gate | race | workspace |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| before Task 3 | 90.6 s | 3.2 | 3.1 | 12.4 | — | 34.7 | 10.0 | 27.2 |
| after, run 1 | 92.9 s | 3.3 | 3.1 | 12.7 | 0.38 | 35.8 | 10.1 | 27.4 |
| after, run 2 | 93.7 s | 3.3 | 3.2 | 13.0 | 0.38 | 36.2 | 10.1 | 27.5 |

The moved files cost 0.38 s on Bun against ~0.40 s on Node, so the split is net-neutral; the ~2 s spread
across the three runs is gate-suite/workspace variance, not the split. **The suite is above the
documented `< 60s` budget (`docs/release-and-install.md`) in all three runs — that predates this task**
(Task 1's stage sum was already ~91 s); it is recorded here and in the plan's compromises rather than
papered over by editing the claim.

## 11. Task 3 note — Node-only spawns use `node` by name (2026-09-23)

**Fixed (5 sites).** §5's table listed 13 `--test` spawns and 1 `--experimental-test-coverage` spawn
through `process.execPath`; three rows were already fixed when this task started (`run-all-tests.mjs` by
plan 113 Task 3, `cli-provider-add.test.ts` and `coverage-summary.mjs` by plan 114 Task 2 — re-verified
below). The remaining sites now spawn the literal `"node"`:

| Path | Flag | Change |
| --- | --- | --- |
| `scripts/wiki-scratch-isolation.test.mjs` | `--test --test-isolation=none` | `spawnSync("node", …)` |
| `scripts/phase23-build-race.test.mjs` | `--test` (importer leaf), `--experimental-test-coverage` (coverage leaf) | `run("node", …)`; the `-e` snippets and the lock wrapper keep `process.execPath` |
| `scripts/phase23-security.test.mjs` | `--test` (lock-wrapped importer) | `spawn("node", …)` |
| `scripts/phase23-security.test.mjs` | coverage-summary script | `spawn("node", …)` |
| `scripts/e2e-cli-live.test.mjs` | `--test` (generated offline test) | `spawnSync("node", …)`; the CLI invocations at `:80`/`:137` keep `process.execPath` |

**Already true, re-verified (not re-fixed).** `cli-provider-add.test.ts` spawns `"node"` for the `--test`
leaf (the `tsc` leaf at `:282` keeps `process.execPath` — runner-agnostic, and the new scan passes it);
`coverage-summary.mjs:81` spawns `"bun"`; `run-all-tests.mjs` contains no `process.execPath`. The scaffold
assertion is tightened from `/ℹ (pass|tests)/` to `/ℹ pass [1-9]/`: `ℹ` is Node's spec reporter, so this
asserts the child's runner *and* that it ran a test, not just a zero exit code.

**Source-run path fix.** `src/__tests__/run-bundle.test.ts:L120` now reads `../run-bundle.js` when it
exists and `../run-bundle.ts` otherwise (the `ENOENT` §10's correction measured), plus a new
`assert.match(source, /export function snapshotRunBundle/)` so the scan cannot go vacuous on an empty
string.

**Gate.** `scripts/tooling-gate.test.mjs` gains the rule in one sentence: a spawn carrying a Node-only
flag must run `node` by name. It scans from the spawn call to the end of its statement, skips matches
inside template literals (its own fixture strings), and walks `src/`, `scripts/`, `packages/` (excluding
`node_modules`, `dist`, `.git`, `coverage`) — ~1650 files in ~37 ms inside an existing gate. Fixtures
prove the negative controls (`process.execPath` with `-e`, with a CLI path, with a multi-line argument
list, and `"node"` + `--test`) pass, and four `process.execPath` + Node-only-flag shapes fail.
`ponytail:` comment on the scan: it is lexical, not an AST — a flag hidden behind a spread constant is
caught by review, not by the scan.

**Verification (this tree, this session).**

| Check | Command | Result |
| --- | --- | --- |
| root source glob | `bun test --timeout=0 src/__tests__/*.test.ts` | **2083 pass / 0 fail**, 31.1 s (§10 measured 2080 pass / 2 fail) |
| scaffold under Bun | `bun test --timeout=0 src/__tests__/cli-provider-add.test.ts` | 9 pass / 0 fail |
| sibling read, dist | `node --test dist/__tests__/run-bundle.test.js` | 4 pass / 0 fail |
| sibling read, source | `bun test src/__tests__/run-bundle.test.ts` | 4 pass / 0 fail |
| build race | `node --test scripts/phase23-build-race.test.mjs` | 12 pass / 0 fail |
| wiki gate | `node --test scripts/wiki-scratch-isolation.test.mjs` | 4 pass / 0 fail |
| threat suites | `npm run security:threat-suites` | 83 pass / 0 fail |
| spawn rule | `node --test scripts/tooling-gate.test.mjs` | 7 pass / 0 fail; a planted `spawnSync(process.execPath, ["--test", …])` file fails it, removing the file passes it again |
| live CLI journey | `node --test scripts/e2e-cli-live.test.mjs` | skips without `PRISM_LIVE_PROVIDER_TESTS=1`; the `"node"` literal at `:97` runs only on a live run |

**Deliberate dist path, do not "fix".** `packages/mcp/src/__tests__/server.test.ts:L567` keeps
`new URL("../server.js", import.meta.url)` because that path is written into a *spawned child script*
that imports the built `dist/server.js` directly — workspace suites only ever run built `dist/`, and a
`.ts` fallback would hand the child a file its plain runner cannot execute. It is not the sibling-read bug
above.

**No measurable cost.** The scan is ~37 ms inside an existing gate file; every other change is a command
literal. No helper, constant, or environment lookup was added — `"node"` is written at each site.

## 12. Task 4 note — `--parallel` re-measurement, no stage flips (2026-09-23)

**Probe: the trigger fired.** Pinned Bun `1.4.2` (`packageManager` and every `oven-sh/setup-bun` step)
has the flag plan 113 §10's table was waiting for:

```text
$ bun --version
1.4.2
$ bun test --help | grep -E 'parallel|isolate|shard|timings|max-concurrency'
      --max-concurrency=<val>         Maximum number of concurrent tests to execute at once. Default is 20.
      --isolate                       Run each test file in a fresh global object. ...
      --no-isolate                    With --parallel: let each worker keep one global and module registry ...
      --parallel=<val>                Run test files in parallel using N worker processes. Implies --isolate.
                                      Defaults to CPU core count.
      --parallel-delay=<val>          Milliseconds the first --parallel worker must be busy before spawning the rest.
      --shard=<val>                   Run a subset of test files, e.g. '--shard=1/3' ...
      --timings=<val>                 JSON file(s) of per-file durations (ms); ...
      --update-timings                After the run, write measured per-file durations ...
```

So this task is not the recorded no-op §10 expected; the table below is the re-run. Same host, same
session, Node v26.9.0; every candidate got ≥2 runs and the Node baseline is from this session, not §10's.

| Candidate | Node (this session) | Bun `--parallel` | Set identical to Node's? | Verdict |
| --- | --- | --- | --- | --- |
| root `dist/__tests__/*.test.js` (160 files) | 13.741 / 14.007 s, 2069 tests, 0 fail | 12.915 / 11.886 s (default 16 workers), 12.984 s (`=8`) — **2083 tests across 162 files** | **no** — 2 files outside the set run too | stays Node |
| root source glob `src/__tests__/*.test.ts` (160 files) | n/a — Node 26 strips types but `../index.js` does not resolve to `src/index.ts` (`ERR_MODULE_NOT_FOUND`, measured), so no Node source baseline exists; Bun maps the specifier, which is why this glob only ever ran under Bun | 12.369 / 12.462 s, 2083 tests across 162 files | no (same 2-file pull) | not a stage |
| prism-core non-sqlite leaf (79 files) | 3.666 s, 675 tests (666 pass / 9 skip / 0 fail) | 2.155 / 2.151 s (`=8`: 2.352 / 2.105; `=4`: 3.402 / 3.284) — 675 tests across 79 files | **yes** (675, 666/9/0) | leaf wins, stage does not — reverted below |
| whole prism-core package (82 files) | 3.659 / 3.672 s, 699 tests (690 / 9 / 0) | 2.547 / 2.515 s — 699 tests across 82 files | yes (699, 690/9/0) | — |
| SQLite set (3 files) | n/a (already Bun) | single-process 372 ms (adopted); `--parallel` 348 ms — 24 tests across 3 files | yes | inside noise, unchanged |

**Why the root glob's set is not identical — Bun matches a file argument by path suffix.** `bun test
dist/__tests__/content.test.js` also runs `packages/mcp/dist/__tests__/content.test.js`: both paths end
with `dist/__tests__/content.test.js`. Minimal repro (probe files, removed after):

```text
dist/__tests__/zz-collide.test.js                 → test("root-collide")
packages/hooks/dist/__tests__/zz-collide.test.js  → test("pkg-collide")
$ bun test dist/__tests__/zz-collide.test.js
(pass) root-collide
(pass) pkg-collide
Ran 2 tests across 2 files. [23.00ms]
$ node --test dist/__tests__/zz-collide.test.js
ℹ tests 1 / pass 1 / fail 0
```

Control: the same basename at a *different* suffix (`packages/hooks/dist/nested-zz-suffix.test.js`) is
not pulled, so the rule is a path-suffix match (`**/<arg>`), not basename-anywhere. Exactly 2 of the 160
root files have such a twin (`content.test.js` → mcp, `schema.test.js` → hooks; enumerated over every
`dist/__tests__/*.test.js` in the tree), which is the whole 2069 → 2083 gap: 5 + 9 tests that belong to
the workspace stage. Flipping the root stage would break plan 113 Task 3's "every file exactly once"
partition, so it stays Node even though `--parallel` is 1.0–2.1 s faster. The adopted SQLite stage is
safe under the same rule: its arguments carry the `packages/prism-core/dist/sessions/sqlite/__tests__/`
suffix, which nothing else in the tree matches (measured: 3 files, 24 tests).

**prism-core flip: measured, then reverted.** Flipping the package's `test` script to
`bun test --parallel=8 --timeout=0` (8 workers, not the default 16, so a co-running leaf still has cores)
and measuring the workspace stage with the runner's own pool (concurrency 2, same session):

| Stage runs | Wall clock | Failures |
| --- | --- | --- |
| Node baseline (this session + Task 2's three) | 16.823, 17.082, 17.075, 16.868 s → median ≈ 17.0 s | none |
| flipped `--parallel=8` | 15.886, 16.316, 16.291, 16.688, 17.319, 16.846 s → median ≈ 16.5 s | 1 of 6: `packages/memory`, the documented 5 ms source-scan budget, at host load 5.97 |

The leaf gain is real (3.67 → 2.15 s, 41 %) but prism-core is not the stage's critical path (the ag-ui and
web-tools leaves are ~5.4 s each), so the stage moves ~0.5 s — inside the observed 15.9–17.3 s spread —
while the flip adds 8 worker processes next to a co-running leaf that carries real-time budget
assertions. Reverted: `packages/prism-core/package.json` is byte-identical to its pre-task state (the
diff vs `HEAD` is plan 113/114's `find`-list and `--shared` edits).

**Verdict.** No stage flips. `scripts/run-all-tests.mjs` is unchanged — no `--parallel` flag is added, the
runner keeps one Bun stage per file set, every file still runs exactly once, and every `bun test`
invocation keeps `--timeout=0`. `docs/testing.md`'s stage table is untouched (it is only edited when a
flip lands). Environment hygiene is the default suite's: no `NODE_TEST_*`/`BUN_*` strip was invented, and
the measured runs were direct children of the same shell §10 used.

**Triggers to watch.** (1) Bun changing argument→suffix matching: the root glob then becomes a real
candidate (11.9–12.9 s vs Node 13.7–14.0 s with an identical set) — re-probe with the `zz-collide` repro
first. (2) Any change to the workspace pool or to the memory/prism-work real-time budgets: prism-core's
leaf flip is then worth re-measuring (1.5 s per leaf, ~0.5 s per stage). (3) The next pinned-version
boundary: re-probe when `packageManager`/`bun-version` moves off `1.4.2` (1.5.x release notes), and keep
the `--timings`/`--shard` flags in mind for CI sharding if the root glob ever flips.

### 12.1 Plan 117 Task 2 re-probe — pin unmoved, behaviour unchanged (2026-09-23)

Plan 117 Task 2 re-ran §12's probe set to test whether its pinned-version trigger had fired. It had
not: `package.json:L6` `packageManager` is still `bun@1.4.2`, `bun --version` → `1.4.2`, and
`npm view bun dist-tags` → `latest: 1.4.2` (canary `1.4.2-canary.20260923.1` — the same 1.4.2 line, not
what ships to contributors). The flag search and the path-collision repro were re-run anyway, so a
no-op is distinguishable from a skipped check:

```text
$ bun test --help | grep -iE 'parallel|isolate|shard|timings|max-concurrency'
      --max-concurrency=<val>         Maximum number of concurrent tests to execute at once. Default is 20.
      --isolate                       Run each test file in a fresh global object. Leaked handles ...
      --no-isolate                    With --parallel: let each worker keep one global and module registry ...
      --parallel=<val>                Run test files in parallel using N worker processes. Implies --isolate.
                                      Defaults to CPU core count.
      --parallel-delay=<val>          Milliseconds the first --parallel worker must be busy ... Default 5.
      --test-worker                   (internal) Run as a --parallel worker, receiving files over IPC.
      --shard=<val>                   Run a subset of test files, e.g. '--shard=1/3' ...
      --timings=<val>                 JSON file(s) of per-file durations (ms); ...
      --update-timings                After the run, write measured per-file durations ...

# path-collision repro, re-run (probe fixtures created in-tree, removed after)
#   dist/__tests__/zz-collide.test.js                -> test(root-collide)
#   packages/hooks/dist/__tests__/zz-collide.test.js -> test(pkg-collide)
$ bun test dist/__tests__/zz-collide.test.js
(pass) root-collide / (pass) pkg-collide
Ran 2 tests across 2 files. [22.00ms]
$ node --test dist/__tests__/zz-collide.test.js
ℹ tests 1 / pass 1 / fail 0
$ bun test dist/__tests__/nested-zz-suffix.test.js      # control: different suffix
Ran 1 test across 1 file. [21.00ms]                     # packages/hooks/dist/nested-zz-suffix.test.js not pulled

$ ls dist/__tests__/*.test.js | wc -l
160
# suffix twins enumerated (candidate path ends with dist/__tests__/<root name>):
content.test.js -> packages/mcp/dist/__tests__/content.test.js
schema.test.js  -> packages/hooks/dist/__tests__/schema.test.js
# exactly 2, which is the whole 2069 -> 2083 gap §12 measured

$ node -e '<run-all-tests.mjs: workspace stage concurrency>'
workspace pool concurrency: 2                          # fixed constant, ponytail: comment intact
# stage runners unchanged: root suites node, sqlite suites node (--timeout=0), workspace leaves bun
```

The flag set, the suffix match (same-suffix twin pulled, different-suffix control not), the twin count
(2 of 160) and the pool bound (2) are all identical to §12's measurement on this binary, so §12's
verdict holds unchanged: no stage flips, the root glob stays Node (Bun `--parallel` is faster but
path-suffix resolution breaks every-file-exactly-once), the prism-core leaf flip stays reverted, and the
pool stays bounded at 2. No `--parallel`/`--concurrency` flag is added to any script;
`scripts/run-all-tests.mjs`, `scripts/run-all-tests.test.mjs`, and `docs/testing.md` are untouched.
Wall-clock candidates were not re-timed: an unchanged binary cannot change a runner, and §12's table is
the measurement of record.

**Verdict: recorded no-op.** No code, config, or doc change. Environment hygiene is unchanged (no
invented `NODE_TEST_*`/`BUN_*` strip; the probe runs were direct children of this shell).

**Triggers to watch (unchanged).** (1) Bun changing argument→suffix matching — re-probe with the
`zz-collide` repro before flipping the root glob. (2) A change to the workspace pool or to the
memory/prism-work real-time budgets — re-measure the prism-core leaf flip. (3) The next pinned-version
boundary: re-probe when `packageManager`/`bun-version` moves off `1.4.2` (1.5.x release notes), keeping
`--timings`/`--shard` in mind for CI sharding if the root glob ever flips. Plan 117 Task 2 then closes
again as a no-op or flips a stage on ≥2 runs per candidate, a same-session Node baseline, and an
identical pass/fail set.
