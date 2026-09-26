# Phase 126 — `bun:sqlite` mapping (Task 1)

Citations: `packages/prism-core/src/governance/prompts/sqlite.ts:L202`, `packages/prism-core/src/sessions/sqlite/migrations.ts:L32`, `packages/prism-core/src/sessions/sqlite/ddl.ts:L287`, `packages/prism-core/src/sessions/sqlite/persistence.ts:L69`, `scripts/run-all-tests.mjs:L104`, `scripts/phase126-sqlite-mapping.test.mjs`.

Plan [126](../../plans/126-Bun-Native-Sqlite.md) Task 1. Measurement only. No driver swap in source.

Host: bun 1.4.2, better-sqlite3 13.0.3, node v26.10.0, 16 CPUs, 2026-09-25T19:24:50Z.
Probes used `:memory:` or `mkdtemp` paths only. No credentials.

SQLite builds: better-sqlite3 `3.53.4`, `bun:sqlite` `3.53.2`. `sqlite_compileoption_used('ENABLE_FTS5')` = 1 on both.

## 1. Call census

Six modules plus their tests. Counts are `rg` over `packages/prism-core/src/sessions/sqlite` and `packages/prism-core/src/governance/prompts` (`*.ts`): `prepare` 89, `run` 48, `get` 45, `all` 20, `exec` 16, `close` 39, `pragma` 6, `transaction` 5. Zero hits for `iterate`, `function`, `aggregate`, `loadExtension`, `lastInsertRowid`, `backup`, `serialize`, `defaultSafeIntegers`.

SQL bind sites use positional `?` only. No `$name` / `:name` / `@name` binds. No `BLOB` column in `packages/prism-core/src/sessions/sqlite/ddl.ts` or the prompt DDL.

| Call | Sites | better-sqlite3 13.0.3 | `bun:sqlite` 1.4.2 | Task 2 |
| --- | --- | --- | --- | --- |
| `new Database(filename)` | `persistence.ts:L823`, `governance/prompts/sqlite.ts:L65` | ok, no options object passed | ok with no second arg. `{}` and `{ timeout: 5000 }` throw `SQLITE_MISUSE`. `{ safeIntegers: true }` ok | keep `new Database(path)`. Do not pass `timeout` or `{}` |
| `prepare` / `run` / `all` | all six modules + tests | statement; `run()` → `{ changes: number, lastInsertRowid: number }` | same keys and types (default). `prepare` is uncached; `query` is the cached alias — unused | keep `prepare` |
| `get` miss | reads in all six modules | `undefined` | `null` | truthy checks (`if (!row)`, `?.`) already accept `null`. One strict check breaks: `governance/prompts/sqlite.ts:L202` |
| `iterate` | none | works | works | no edit |
| `exec` multi-statement | `migrations.ts:L47-L55`, `leases.ts:L20`, `checkpoints.ts:L30`, `sqlite-migrations.ts:L22` | runs every statement | runs every statement | keep. Also the `pragma` replacement |
| `pragma` | `migrations.ts:L32-L34`, `governance/prompts/sqlite.ts:L73-L75` | method; returns row array; return unused | **no method** | `db.exec("PRAGMA …")`. Not `new Database(path, { timeout })` |
| `transaction(fn)` | `persistence.ts:L215`, `persistence.ts:L369`, `migrations.ts:L38`, `governance/prompts/sqlite.ts:L97`, `sqlite-migrations.ts:L21` | deferred; returns fn value; throw rolls back | same. `.immediate` exists, unused | keep |
| `close` | `persistence.ts:L807`, `governance/prompts/sqlite.ts:L69`, tests | second `close()` ok | second `close()` ok | keep |
| `.changes` | `leases.ts:L103`, `checkpoints.ts:L106`, `lifecycle.ts:L68` | number, 0 on miss, 1 on hit | same | keep |
| `function` / `aggregate` | none | present | **absent** | no edit |
| `loadExtension` | none | present | present | no edit |

## 2. Binding, integers, blobs

Probe: `bun /tmp/phase126-probe.mjs` (session scratch, not shipped). Lock: `scripts/phase126-sqlite-mapping.test.mjs`.

| Row | better-sqlite3 | `bun:sqlite` | Task 2 |
| --- | --- | --- | --- |
| positional `undefined` | stores SQL NULL. Does **not** throw (13.0.3) | stores SQL NULL. Does not throw | no edit. Plan text "better-sqlite3 throws" is wrong on this version |
| positional `null` | SQL NULL | SQL NULL | already what call sites pass (`?? null`) |
| missing positional | `RangeError: Too few parameter values were provided` | inserts NULL, no throw | latent. Call sites pass full arity. Do not rely on the throw |
| extra positional | `RangeError: Too many parameter values were provided` | `SQLite query expected 1 values, received 2` | latent. Same |
| named `{ v }` for `:v` | binds | does not bind (row is `null`) unless the key is `":v"` or `strict: true` | no named binds in tree. Do not add them without `strict: true` |
| variadic `run(a, b)` / `get(a, b)` | ok | ok | keep |
| `boolean` | throws `TypeError` | binds `1` | unused. Do not start passing booleans |
| `lastInsertRowid` default | `number` (value `1`). No `db.lastInsertRowid` | `number` (value `1`). No `db.lastInsertRowid` | no `Number()` wrap if `safeIntegers` stays off |
| integer `2^53+1` (`9007199254740993n`) | `number` `9007199254740992` (not exact) | same | no edit. No column stores that range |
| `safeIntegers: true` / `defaultSafeIntegers(true)` | `lastInsertRowid` and integer columns become `bigint` | same | **do not enable**. Would break numeric version/sequence compares |
| blob write `Buffer` or `Uint8Array` | read `Buffer` (also `Uint8Array`) | read `Uint8Array`, `Buffer.isBuffer` false, bytes intact | zero blob columns in schema. No conversion |
| `get()` miss / `RETURNING` miss | `undefined` | `null` | `governance/prompts/sqlite.ts:L202` only strict `=== undefined` on a `.get()` result |

`governance/prompts/sqlite.ts:L202`:

```ts
return row === undefined ? null : normalizeStoredPrompt(row, limits);
```

Under `bun:sqlite` a miss is `null`, so this calls `normalizeStoredPrompt(null)` and throws `TypeError: null is not an object (evaluating 'row.tenant_id')` at `packages/prism-core/dist/governance/prompts/util.js:76`. Fix is `row == null`, not a driver adapter.

## 3. Pragma, WAL, busy_timeout

| Probe | both drivers |
| --- | --- |
| `:memory:` + `exec("PRAGMA journal_mode = WAL")` | no throw. `journal_mode` stays `memory`. `foreign_keys=1` after `exec("PRAGMA foreign_keys = ON")`. `busy_timeout` reads back `5000` |
| file + `exec("PRAGMA journal_mode = WAL")` | `journal_mode` = `wal` |
| file, no `foreign_keys` pragma | better-sqlite3 default `foreign_keys=1`. `bun:sqlite` default `foreign_keys=0` | Task 2 must keep the explicit `ON`. The existing call is the control |
| constructor `{ timeout: 5000 }` | better-sqlite3 sets `busy_timeout` to 1234 when probed with `{ timeout: 1234 }` | `bun:sqlite` throws `SQLITE_MISUSE`. There is no constructor timeout on 1.4.2 |

`busy_timeout` mapping is the existing pragma string (`types.ts:L4` `DEFAULT_BUSY_TIMEOUT_MS` = 5000), executed via `exec`, not a constructor option. Plan example `new Database(path, { timeout: 5000 })` is rejected by this probe.

## 4. FTS5

Not a blocker. Bun bundles FTS5.

`packages/prism-core/src/sessions/sqlite/ddl.ts:L287` (`MIGRATION_004_SESSION_SEARCH`, `tokenize = 'porter unicode61'`).

Probe (`:memory:`, both drivers): `CREATE VIRTUAL TABLE docs USING fts5(label, body, tokenize = 'porter unicode61')`, insert `("hello", "running runners")`, `MATCH 'run'` returns the row, `MATCH 'zzzz'` returns `[]`.

Suite row that exercises the real virtual table also passed under the shim: `searches sessions by label, FTS message text, workspace, and ownership`.

## 5. Concurrency

Second process: parent `BEGIN IMMEDIATE` on a `mkdtemp` WAL file, child (separate `bun` process) inserts or updates. Same shape as a `--test-isolation=process` pair. The conformance suite itself is in-process two handles (`sqlite-persistence.test.ts` lease test), not OS processes. Both were measured.

| Probe | better-sqlite3 | `bun:sqlite` |
| --- | --- | --- |
| child insert, `busy_timeout=0`, parent holds `BEGIN IMMEDIATE` | `SQLITE_BUSY` `database is locked` at 0 ms. Parent row unchanged | same |
| child insert, `busy_timeout=300` | `SQLITE_BUSY` at 303 ms. Seed row remains | `SQLITE_BUSY` at 304 ms. Seed row remains |
| child lease-style update, `busy_timeout=150`, parent holds writer | `SQLITE_BUSY` at 153 ms. After parent `ROLLBACK`, owner still `owner-a` | `SQLITE_BUSY` at 152 ms. Owner still `owner-a` |
| two processes, WAL, no lock held | child reads `from-a`, inserts `from-b`; parent sees both rows | same |
| in-process two-handle leases (suite) | pass | pass (shim run) |

`transaction` rollback probe: fn return value preserved (`6`); thrown `boom` leaves the pre-throw row and drops the in-flight insert. Same both drivers.

## 6. UDF / extension

No `db.function`, `db.aggregate`, or `loadExtension` call site under `packages/prism-core`. `bun:sqlite` has `loadExtension`, not `function` or `aggregate`. Nothing to port.

## 7. Suite timings (Task 4 baseline)

Command (shell-expanded glob, same as `scripts/run-all-tests.mjs:L104` `SQLITE_TEST_GLOB`):

```text
bun test --timeout=0 packages/prism-core/dist/sessions/sqlite/__tests__/*.test.js
```

`bun:sqlite` column is not a source swap. `db.pragma` is missing, so the run used a measurement-only CJS stand-in for `node_modules/better-sqlite3`: `require("bun:sqlite").Database` plus `pragma(source) { this.exec("PRAGMA " + source); return []; }`. Restored `better-sqlite3@13.0.3` after. Do not ship that stand-in. Task 2 inlines `exec`.

| Driver | Reporter | Wall | Result |
| --- | --- | --- | --- |
| better-sqlite3 13.0.3 run 1 | 607 ms | 644 ms | 24 pass / 0 fail |
| better-sqlite3 13.0.3 run 2 | 630 ms | 656 ms | 24 pass / 0 fail |
| `bun:sqlite` + pragma exec shim run 1 | 396 ms | 419 ms | 24 pass / 0 fail |
| `bun:sqlite` + pragma exec shim run 2 | 414 ms | 433 ms | 24 pass / 0 fail |

Reporter line: `Ran 24 tests across 3 files.` Files: `lifecycle.test.js`, `sqlite-persistence.test.js`, `state-concurrency-conformance.test.js`.

Do not port the numbers from plan 113 (23 pass / ~360 ms). This tree is 24 pass. The `bun:sqlite` runs are faster than the better-sqlite3 baseline on this host; not a regression.

Prompts suite (not in `SQLITE_TEST_GLOB`; the `get()` miss lives here):

```text
bun test --timeout=0 packages/prism-core/dist/governance/prompts/__tests__/prompts.test.js
```

| Driver | Result |
| --- | --- |
| better-sqlite3 | 4 pass / 1 skip / 0 fail, reporter 62 ms |
| `bun:sqlite` shim | 3 pass / 1 skip / 1 fail, reporter 51 ms |

Fail transcript (shim run):

```text
TypeError: null is not an object (evaluating 'row.tenant_id')
    at normalizeStoredPrompt (.../governance/prompts/util.js:76:19)
    at resolve (.../governance/prompts/sqlite.js:141:43)
(fail) ../index.js > passes SQLite conformance and survives reopen
```

## 8. Task 2 rows (closed by this file)

1. Replace `require("better-sqlite3")` at `persistence.ts:L69` and `governance/prompts/sqlite.ts:L14` with `import { Database } from "bun:sqlite"`. Type-only imports at the other sqlite modules follow.
2. Replace the six `db.pragma(...)` calls with `db.exec("PRAGMA ...")`. Keep `foreign_keys = ON`, `journal_mode = WAL`, `busy_timeout = N`. No constructor options.
3. `governance/prompts/sqlite.ts:L202`: `row == null`. No other `.get()` site uses `=== undefined`.
4. Do not enable `safeIntegers`. Do not add a `SqliteDriver` interface. Do not convert blobs (no blob columns).

## 9. Rejected

- `better-sqlite3 stays` — native module is the thing this plan deletes. Suites already pass on `bun:sqlite` once `pragma` is `exec`.
- `port the numbers` — plan 113's 23 pass / ~360 ms is a different tree. Baseline is the table in §7.
- `skip the conformance net` — the sqlite suites and the prompts suite were run. The prompts fail is a mapped one-line fix, not a reason to skip the suite in Task 2.

## 10. Task 2 — Node miss path

Static `import "bun:sqlite"` on node 26.10.0 is `ERR_UNSUPPORTED_ESM_URL_SCHEME` (`Only URLs with a scheme in: file, data, and node are supported`). The seam stays `require("bun:sqlite")` at module load so the import throws our line instead. No `SqliteDriver` adapter. `pragma` is `exec`. `get()` miss uses `== null`. No blob columns, `safeIntegers` left off, so no `Uint8Array` conversion and no `Number(lastInsertRowid)`.

Probe (`node --input-type=module`, 2026-09-25):

```text
import ./packages/prism-core/dist/sessions/sqlite/index.js
message: @arnilo/prism-core/sessions/sqlite requires the Bun runtime (bun:sqlite).
cause.code: MODULE_NOT_FOUND
cause.message: Cannot find module 'bun:sqlite'
scheme: false

import ./packages/prism-core/dist/governance/prompts/sqlite.js
message: @arnilo/prism-core/governance/prompts requires the Bun runtime (bun:sqlite).
cause.code: MODULE_NOT_FOUND
scheme: false
```

Same assert: `packages/prism-core/src/sessions/sqlite/__tests__/sqlite-persistence.test.ts` (`names the Bun runtime when the sqlite modules are imported under node`). After the swap, sqlite suites 24 pass plus that test; prompts suite 4 pass / 1 skip / 0 fail. `tsc -p packages/prism-core/tsconfig.json` clean. Emit types come from `packages/prism-core/src/bun-sqlite.d.ts` (`types: ["node"]` does not load `@types/bun`). Task 3 kept that file; see §11.

## 11. Task 3 — install shrink

`better-sqlite3` and `@types/better-sqlite3` are gone from manifests and `bun.lock`. `bun ci` (frozen lockfile) passes. A from-scratch `bun install` with the lockfile deleted floated unrelated ranges (`@biomejs/biome` 2.5.14, `@napi-rs/keyring` 2.1.0, `zod` 4.6.5); the committed lockfile is the HEAD lockfile with the sqlite entries swapped, not that float.

| | before | after |
| --- | --- | --- |
| `node_modules/better-sqlite3` | 27M | gone |
| `node_modules/@types/better-sqlite3` | 20K | gone |
| `node_modules/@types/bun` + `bun-types` | absent | 16K + 6.6M |
| `bun.lock` | 44116 bytes | 44109 bytes |

Net install shrink about 20M (native package out, type package in). No `install` / `preinstall` / `postinstall` script remains under `node_modules`. `@types/bun@1.4.2` is a devDependency. Loading it via `types: ["bun"]` fails `tsc`: Bun's `fetch` requires `preconnect`, and `SQLQueryBindings` rejects `undefined` binds. `types` stays `["node"]`. `src/bun-sqlite.d.ts` stays the emit declaration. Delete it when call sites accept `SQLQueryBindings`.

## 12. Task 4 — freeze

Host: bun 1.4.2, 16 CPUs, 2026-09-25. `better-sqlite3` is not installed. Timings are the swapped tree.

| Run | Reporter | Wall | Result |
| --- | --- | --- | --- |
| better-sqlite3 baseline (§7) | 607–630 ms | 644–656 ms | 24 pass |
| post-swap sqlite suite run 1 | 530 ms | 544 ms | 25 pass / 0 fail |
| post-swap sqlite suite run 2 | 481 ms | 495 ms | 25 pass / 0 fail |

The 25th test is the node wrong-runtime probe (~160 ms). Store work is still under the better-sqlite3 baseline. Not a regression.

Session-search workload (`bun scripts/benchmark-scenarios/session-search.mjs`, 100k turns, p95 ceiling 100 ms). No better-sqlite3 number — driver retired before this workload was timed.

| Run | build | query p50 | query p95 | common p95 | wall | checks |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 16300 ms | 48.5 ms | 54.65 ms | 56.71 ms | 18141 ms | pass |
| 2 | 16013 ms | 47.29 ms | 53.36 ms | 53.99 ms | 17812 ms | pass |

No sqlite absolute-time budget moved. Ceiling held. No recalibration.

WAL / busy-timeout re-probe (`bun /tmp/phase126-reprobe.mjs`, swapped tree, `:memory:` or `mkdtemp` only):

| Probe | Result |
| --- | --- |
| second writer, busy 0 | `SQLITE_BUSY` at 1 ms, row stays `seed` |
| second writer, busy 300 | `SQLITE_BUSY` at 301 ms, row stays `seed` |
| cross-process lease under `BEGIN IMMEDIATE` | `SQLITE_BUSY` at 151 ms, owner `owner-a` after rollback |
| two-process WAL read+write | child saw `from-a`, mode `wal`, both rows present |
| `foreign_keys` default | 0 — explicit `PRAGMA foreign_keys = ON` still required |

Matches §5. Same semantics as the Task 1 better-sqlite3 rows.

Coverage: standalone fallback now passes `--path-ignore-patterns=packages/**` plus the expanded `dist/__tests__/*.test.js` list. A literal glob argv matches nothing on Bun 1.4.2; a bare directory still suffix-matches. Junit listing: 168 root files, 0 workspace pulls. `bun run coverage:summary` exit 0. Artifact `core.pass=true`, lines 94.46, functions 95.29, gate `lines>=91.48 functions>=92.21`.

Conformance: sqlite suite includes session-store, state-concurrency, run-ledger, and persistence-schema. Prompts suite 4 pass / 1 skip / 0 fail. Postgres parity (ephemeral postgres:16, URL not recorded): prism-core `test:postgres` 73 pass / 0 fail; phase 7 + 12 + 22 11 pass / 0 fail. Memory/channels legs need pgvector — not run.

`bun run test`: all 9 stages passed, wall 129739 ms (pin is 240 s). Branch audit ignored an instrumented field-policy timing assert (host load); floor still held (86.38 > 83.49).
