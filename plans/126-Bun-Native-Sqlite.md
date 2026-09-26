# Bun Native SQLite

Plan 3 of 6 for the Bun-only migration (with [124](124-Bun-Only-Toolchain-And-Test-Runner.md),
[125](125-Bun-Only-Runtime-Contract.md), [127](127-Bun-Runtime-Concurrency-Performance.md),
[128](128-Test-Import-Migration.md), [129](129-Release-0-12-0.md)). Depends on plan 125 Task 1 (the `engines.bun` flip): `bun:sqlite`
imports must not ship to a manifest that still advertises Node.

Plan 113 rejected `bun:sqlite` under the Node-consumer constraint. That constraint is gone. The
swap deletes the repo's only native install dependency (`better-sqlite3`, its prebuild/gyp install
script, its optional-peer hint, its `@types`) in favor of the runtime's built-in SQLite. Owner
decision 2026-09-25.

Current shape (surveyed): `packages/prism-core/src/sessions/sqlite/{persistence,checkpoints,leases,
lifecycle,migrations}.ts` and `src/governance/prompts/sqlite{,-migrations}.ts` import
`type Database from "better-sqlite3"` (type-only); the driver is resolved lazily by
`require("better-sqlite3")` at two call sites with a fail-closed install hint
(`npm i better-sqlite3`). `docs/sqlite-persistence.md` documents FTS search. The session-store,
state-concurrency, and run-ledger conformance suites (`@arnilo/prism/testing/*`) are the behavior
net.

## Objectives

- `@arnilo/prism-core` SQLite session store, leases, checkpoints, lifecycle, migrations, and the
  governance prompt store run on `bun:sqlite` with identical observable behavior — proven by the
  existing conformance suites, not by new tests that assert the swap.
- `better-sqlite3`, `@types/better-sqlite3`, the optional-peer declaration, and every install hint
  are deleted. No native module, no install script, no `trustedDependencies` question remains.
- The fail-closed driver-miss path becomes the wrong-runtime path: importing the SQLite subpath on
  a non-Bun runtime fails with an actionable message naming the Bun requirement.
- Behavior deltas that survive (blob type, bigint shape) are enumerated, mapped, and frozen in an
  evidence file before any source edit.

## Expected Outcome

- `bun add @arnilo/prism-core` is the complete SQLite install — zero postinstall, zero native
  build, works offline. `docs/host-security.md`'s install-script note is updated to "none".
- The sqlite suites, session-store/state-concurrency/run-ledger conformance, and the Postgres
  parity legs pass unchanged; sqlite-suite wall clock is recorded against the better-sqlite3
  baseline (plan 113: 23 pass / ~360 ms).
- `docs/_evidence/phase126-bun-sqlite.md` holds the API mapping table, the probe transcripts
  (FTS5, blobs, bigint, busy-timeout, multi-process WAL), and the before/after timings.
- Public exports unchanged; the compat baseline is not regenerated (type-only import swap).

## Tasks

- [x] Task 1: Measured mapping — `bun:sqlite` vs `better-sqlite3` on this codebase's usage
  - Acceptance Criteria:
    - Functional: `docs/_evidence/phase126-bun-sqlite.md` exists with transcripts. Every
      `Database` method the repo's six modules plus tests actually call is enumerated
      (`grep -o 'db\.\w*'` / statement-method census over `packages/prism-core/src`) and probed
      side-by-side on both drivers: `prepare/run/get/all/iterate/exec/pragma/transaction/function/
      aggregate/loadExtension` as used; DDL batch execution; named/positional parameter binding
      including `undefined` (better-sqlite3 throws, Bun's behavior recorded); `lastInsertRowid`
      number-vs-bigint shape; blob read type (`Buffer` vs `Uint8Array`) at every blob column the
      schema writes; `changes` semantics.
    - Functional: FTS5 probe — the FTS search documented in `docs/sqlite-persistence.md` creates
      its virtual table + runs a match query under `bun:sqlite`; if FTS5 is not compiled in, this
      is a blocker recorded here (expected: Bun bundles FTS5).
    - Functional: concurrency probes — busy-timeout behavior under a second writer (the option
      vs `PRAGMA busy_timeout` mapping), WAL mode across two processes, and the
      `--test-isolation`-style cross-process lease behavior the conformance suite exercises.
    - Functional: UDF/extension census — every `db.function`/`db.aggregate`/`loadExtension` call
      site listed with its `bun:sqlite` equivalent probed (expected: none or few).
    - Functional: `scripts/plan-review-gate.test.mjs` gains a `PLAN_126_TASK_1` block.
    - Performance: the built sqlite suites run under both drivers on the same tree
      (better-sqlite3 still installed), ≥2 runs each; the table is the Task 4 freeze baseline.
    - Code Quality: mapping table, not an essay; every row names a file or a probe command.
    - Security: no credentials in transcripts; probes use `:memory:` or `mkdtemp` paths only.
  - Approach:
    - Documentation Reviewed:
      - https://bun.com/reference/sqlite (Bun `Database`/`Statement` API, options, `transaction`)
        and the local `bun -e` probes; better-sqlite3 v13 API docs for the diff rows.
      - `packages/prism-core/src/sessions/sqlite/*.ts`, `src/governance/prompts/sqlite*.ts`
        (actual call census); `packages/prism-core/src/sessions/sqlite/ddl.ts` (schema, FTS DDL).
      - `docs/sqlite-persistence.md` (the FTS contract), `docs/_evidence/phase113-bun-inventory.md`
        §1 (the old `import()` namespace quirk — retired with the driver).
    - Options Considered:
      - Keep better-sqlite3 under Bun (it works, plan 113 measured it) — rejected: it keeps a
        native build, an install hint, and a peer-dep surface for zero benefit once Node is gone.
      - `bun:sqlite` behind the existing lazy-resolution seam only — chosen for structure: one
        resolution point per call site stays; the mapping still must be measured first.
    - Chosen Approach: census → probe both drivers → freeze the mapping; Tasks 2–4 implement only
      rows it closed.
    - Measured (2026-09-25, bun 1.4.2): `docs/_evidence/phase126-bun-sqlite.md`. Task 2 applies
      only: `pragma` → `exec("PRAGMA …")` (constructor `{ timeout }` and `{}` are `SQLITE_MISUSE`),
      and `row === undefined` → `row == null` at `governance/prompts/sqlite.ts:202`. Default
      integers stay `number` (`safeIntegers` off). Zero blob columns. FTS5 present. Sqlite
      suites 24 pass / 0 fail on both drivers (better-sqlite3 607–630 ms, bun shim 396–414 ms).
      Prompts suite fails on the `null` miss until the one-line check lands.
    - API Notes and Examples:
      ```js
      import { Database } from "bun:sqlite";
      const db = new Database(path); // no options object on bun 1.4.2
      db.exec("PRAGMA foreign_keys = ON");
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA busy_timeout = 5000");
      const row = db.prepare("SELECT id FROM t WHERE id = ?").get(id); // null, not undefined, on miss
      ```
    - Files to Create/Edit: `docs/_evidence/phase126-bun-sqlite.md` (new);
      `scripts/plan-review-gate.test.mjs` (`PLAN_126_TASK_1` block);
      `scripts/phase126-sqlite-mapping.test.mjs` (blob / bigint / undefined / get-null locks);
      `scripts/run-all-tests.mjs` (gate list, so the locks run).
    - References:
      - Required tokens: `bun:sqlite`, `FTS5`, `Uint8Array`, `lastInsertRowid`, `busy_timeout`,
        `transaction`, `WAL`.
      - Rejected tokens: `better-sqlite3 stays`, `port the numbers`, `skip the conformance net`.
  - Test Cases to Write:
    - Review gate block (`assertPrimitiveReview`).
    - Mapping-table repro: `scripts/phase126-sqlite-mapping.test.mjs` — one test per risky row
      (blob type, bigint / `lastInsertRowid`, undefined param, `get()` null). One file, not four:
      same failure mode, and the gate list stays one entry. Fails if Bun diverges from the
      recorded row.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (evidence artifact).
    - Docs pages to create/edit: evidence file only.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2: Driver swap at the two resolution points + type imports
  - Acceptance Criteria:
    - Functional: `packages/prism-core/src/sessions/sqlite/persistence.ts` and
      `src/governance/prompts/sqlite.ts` resolve `bun:sqlite` (static `import { Database }` at the
      module edge if the lazy seam buys nothing under a built-in — decide from Task 1, record why);
      the six `import type Database from "better-sqlite3"` sites become
      `import type { Database } from "bun:sqlite"`.
    - Functional: the fail-closed miss path is rewritten: the error names the runtime requirement
      ("this subpath requires the Bun runtime (bun:sqlite)") — an error-contract change, so the
      task greps `scripts/`, `examples/`, and every workspace for the retired
      `npm i better-sqlite3` hint string and the old message text; every live hit is updated.
    - Functional: blob/bigint/pragma rows from Task 1 are applied (e.g. `Uint8Array` acceptance at
      blob columns, `Number(lastInsertRowid)` where a number is contractual); the conformance
      suites define "identical observable behavior" — all pass.
    - Functional: `tsc` emit is clean; `@types/bun` (or `bun-types`) is the devDependency that
      types `bun:sqlite` for the emit (added in Task 3 with the dependency cleanup).
    - Functional: a Node-side probe records the new message end to end: importing the sqlite subpath
      under `node` prints the actionable line (not `ERR_UNSUPPORTED_ESM_URL_SCHEME`), and the
      transcript lands in `docs/_evidence/phase126-bun-sqlite.md`. `engines.bun` alone enforces
      nothing (plan 125 Task 1's probe), so this message is the compensating control.
    - Performance: no per-query regression beyond Task 1's measured table.
    - Code Quality: no adapter layer, no driver abstraction with one implementation — the mapping
      is applied inline; `ponytail:` comment on any retained seam naming its ceiling.
    - Security: SQL text, parameterization, and byte caps unchanged; FTS query construction keeps
      its current escaping/parameterization shape (grep-verified).
  - Approach:
    - Documentation Reviewed: Task 1 mapping table; the two resolution sites and their error
      paths; `@arnilo/prism/testing/session-store-conformance` (the net).
    - Options Considered: a `SqliteDriver` interface with both backends — rejected: two
      implementations for a retired runtime is the two-ecosystem smell this migration deletes.
    - Chosen Approach: direct swap, conformance-gated.
    - Measured: static `import "bun:sqlite"` on node is `ERR_UNSUPPORTED_ESM_URL_SCHEME`, so the
      seam stays `require("bun:sqlite")` at module load (recorded in the evidence §10). Type
      imports are `import type { Database } from "bun:sqlite"`. `pragma` → `exec`. One
      `row == null`. No blob/`Number()` edits (zero blob columns, default `lastInsertRowid` is
      `number`). `tsc` clean via `src/bun-sqlite.d.ts` — `@types/bun` not required for emit;
      Task 3 deletes that file if it adds the dep. Compat baseline updated in place:
      `Database.Database` → `Database` on the ten sqlite signatures (no removals, no
      regeneration). `driver` metadata is `"bun:sqlite"`.
    - API Notes and Examples:
      ```ts
      import type { Database } from "bun:sqlite";
      // miss path (dynamic require survives — static import is the scheme error):
      throw new Error("@arnilo/prism-core/sessions/sqlite requires the Bun runtime (bun:sqlite).");
      ```
    - Files to Create/Edit: `docs/_evidence/phase126-bun-sqlite.md` (Node transcript, §10);
      the six sqlite modules, `governance/prompts/sqlite{,-migrations}.ts`,
      `packages/prism-core/src/bun-sqlite.d.ts` (emit types until Task 3),
      sqlite/prompts tests that constructed `Database`, `src/__tests__/install-smoke.test.ts`,
      `scripts/fixtures/e2e-full-surface-journey.mjs`, `scripts/compat-baseline/arnilo__prism-core.txt`.
      FTS DDL unchanged. `scripts/tooling-gate.test.mjs` keeps `npm i better-sqlite3` as a
      negative scanner fixture, not a live hint.
    - References: repo rule — error-contract changes plan the repo-wide grep (plan 080 Task 3
      precedent).
  - Test Cases to Write:
    - Existing conformance suites pass unmodified (the acceptance); one new test asserts the
      wrong-runtime error text if a dynamic seam survives. Landed in
      `sqlite-persistence.test.ts` (spawns `node`, both modules).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — optional-peer dependency contract and error text.
    - Docs pages to create/edit: `docs/core.md`, `docs/sqlite-persistence.md` (Task 3 sweep).
    - `docs/index.md` update: Task 3 (sqlite-persistence blurb sentence).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Dependency and docs cleanup — `better-sqlite3` fully retired
  - Acceptance Criteria:
    - Functional: `packages/prism-core/package.json` drops the `better-sqlite3` optional peer, the
      `peerDependenciesMeta` entry, devDeps `better-sqlite3` + `@types/better-sqlite3`; root
      devDeps likewise if present; `@types/bun` added (emit typing for `bun:sqlite`).
      `bun install --lockfile-only` regenerates `bun.lock`; `bun ci` clean-tree check passes.
    - Functional: repo-wide grep for `better-sqlite3` returns only immutable history/evidence
      (`docs/_evidence/**`, `docs/migrate-to-*.md`, `docs/history/**`, frozen phase files) and
      this plan family; every live hit is deleted or rewritten: `docs/core.md` rows
      (`:15,:34,:39,:84`), `docs/sqlite-persistence.md`, `docs/host-security.md:174`
      (install-script note → "no package in the family runs an install script"),
      `docs/index.md:113` blurb, `bunfig.toml:2-3` hoisted-linker comment (now names `pg` and
      `@napi-rs/keyring` only), `src/cli-*` hints (if plan 125 Task 3 left any), README.
    - Functional: `DEFAULT_IGNORE_PATTERNS` wiki scan is untouched (lockfile names, not drivers).
    - Performance: install shrinks (no native package); recorded once in the evidence file.
    - Code Quality: no dead optional-peer metadata; `peerDependenciesMeta` and engines agree with
      the actual dependency set.
    - Security: removing the only install-script package is a supply-chain improvement — the
      `host-security.md` claim is updated to state it, and `bun audit` still gates.
  - Approach:
    - Documentation Reviewed: the grep census above; `packages/prism-core/package.json:109-138`;
      plan 125 Task 3 (scaffold strings already Bun).
    - Options Considered: keep the optional peer for one minor as a transition — rejected: the
      0.12.0 contract is Bun-only; a peer that is never used is dead metadata.
    - Chosen Approach: full retirement in one release; migration note in plan 129.
    - Measured: peer, devDep, and channels devDep dropped. `@types/bun@1.4.2` added. `types:
      ["bun"]` breaks `tsc` (Bun `fetch.preconnect`, strict SQL binds), so emit stays on
      `src/bun-sqlite.d.ts` and `types` stays `["node"]`. Lockfile is a surgical swap of the
      HEAD lock — a deleted-lockfile regen floated unrelated ranges and was not committed.
      `bun ci` passes. Install shrink in evidence §11 (~20M). Grep gate:
      `scripts/tooling-gate.test.mjs` (history, plan family, plan-review tokens, and the CI SBOM
      snapshot excluded). `DEFAULT_IGNORE_PATTERNS` untouched.
    - API Notes and Examples: `bun add --dev @types/bun@1.4.2` (present; not on the `types` array).
    - Files to Create/Edit: `packages/prism-core/package.json`, `packages/prism-channels/package.json`,
      `bun.lock`, `bunfig.toml`, `docs/core.md`, `docs/sqlite-persistence.md`,
      `docs/host-security.md`, `docs/index.md`, `docs/peer-dependencies.md`,
      `docs/prompt-registry.md`, `docs/release-and-install.md`, `packages/prism-core/README.md`,
      `scripts/phase54-package-map.mjs`, `scripts/benchmark-scenarios/session-search.mjs`,
      `scripts/drill-migration-rollback.mjs`, `scripts/tooling-gate.test.mjs`.
    - References: `docs/migrate-to-0.5.md:64` (the v12→13 peer note — history, untouched).
  - Test Cases to Write:
    - A grep gate: `better-sqlite3` absent from live manifests, src, and non-history docs
      (extend `scripts/tooling-gate.test.mjs` or `src/__tests__/docs.test.ts` phrase pins).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — dependency contract.
    - Docs pages to create/edit: as listed.
    - `docs/index.md` update: yes, the sqlite-persistence sentence.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4: Conformance and performance freeze
  - Acceptance Criteria:
    - Functional: full local chain green: sqlite suites, `@arnilo/prism/testing/
      {session-store,state-concurrency,run-ledger,persistence-schema}-conformance`, the Postgres
      parity legs, and `bun run test` end-to-end (plan 124's runner).
    - Functional: sqlite-suite wall clock and one representative session-store workload are
      recorded (≥2 runs) against the Task 1 better-sqlite3 baseline in
      `docs/_evidence/phase126-bun-sqlite.md`; a regression beyond run-to-run variance is
      investigated, not silently shipped.
    - Functional: the coverage artifact is honest before the freeze: `scripts/coverage-summary.mjs`'s
      standalone fallback stops pulling the two suffix-twin files (pass a directory argument or a
      `--path-ignore-patterns` flag instead of the shell-expanded `dist/__tests__/*.test.js` glob —
      plan 124 Task 2's measured Bun matching rules), then `bun run coverage:summary` regenerates
      `scripts/coverage-summary.json` so `scripts/phase23-coverage.test.mjs`'s "real artifact is
      well-formed" row reports the current suite instead of plan 125's stale `core.pass=false`.
    - Performance: any absolute-time budget touching SQLite paths (none known — Task 1 census
      confirms) is recalibrated per plan 124 Task 4's method if affected.
    - Code Quality: evidence-file freeze, one table.
    - Security: WAL/busy-timeout behavior under the lease concurrency probe re-verified post-swap
      (Task 1's probe re-run on the swapped tree).
  - Approach:
    - Documentation Reviewed: plan 023's freeze method; the conformance suite entry points.
    - Options Considered: skip the perf freeze (bun:sqlite is "known fast") — rejected: repo rule,
      measurement over reputation.
    - Chosen Approach: run, record, freeze.
    - Measured: sqlite suite 25 pass, 481–530 ms reporter, under the §7 better-sqlite3 baseline.
      Session-search p95 53–55 ms vs 100 ms ceiling. WAL/lease probe matches §5. Coverage
      fallback is the ignore pattern plus an expanded file list (literal glob matches nothing;
      a directory still suffix-matches). `core.pass=true`. `bun run test` 9/9, wall 130 s.
      Postgres parity 73 + 11 pass. Two node-parent fixes so the branch audit can still run
      sqlite demos: spawn `bun` by name, and one documented `node` exception for the
      wrong-runtime probe.
    - API Notes and Examples: `bun run test` + the evidence table.
    - Files to Create/Edit: `docs/_evidence/phase126-bun-sqlite.md` (Task 4 section);
      `scripts/coverage-summary.mjs`, `scripts/phase23-coverage.test.mjs`, `package.json`
      (`test:coverage`), `scripts/coverage-summary.json`, `scripts/tooling-gate.test.mjs`,
      `src/__tests__/docs.test.ts`, `src/__tests__/messaging-outbox-example.test.ts`.
    - References: plan 113 Task 1's sqlite transcript (the original baseline method).
  - Test Cases to Write:
    - None new — the existing suites are the acceptance.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (verification).
    - Docs pages to create/edit: evidence file only.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- `@types/bun` is installed but not on the `types` array. `types: ["bun"]` breaks `tsc`
  (`fetch.preconnect`, `SQLQueryBindings` rejects `undefined`). Emit stays on
  `src/bun-sqlite.d.ts`. Delete that file when call sites accept the official binds.
- Compat baseline was edited in place (`Database.Database` → `Database`, 10 lines). Not a
  `--update-baseline` regen. The plan's "type-only, no regen" assumption was wrong.
- Lockfile is a surgical swap of the HEAD lock. A deleted-lockfile resolve floated unrelated
  ranges and was not committed.
- Postgres memory and channels legs were not run. This host has no pgvector. Parity legs
  (prism-core `test:postgres`, phase 7/12/22) passed on ephemeral postgres:16.
- Session-search has no better-sqlite3 number. The driver was gone before that workload was
  timed. Comparison is the suite table in evidence §7/§12.

## Further Actions

- Delete `packages/prism-core/src/bun-sqlite.d.ts` when sqlite call sites accept
  `SQLQueryBindings` (no `undefined` binds). Priority: low. The ambient file is the working emit.
- Run the memory/channels `test:postgres` legs on a pgvector image before the 0.12.0 release
  if those legs are part of the release gate. Priority: medium. Not a sqlite parity gap.
- Do not widen the field-policy 10% cap. The instrumented branch audit flakes it under host
  load; the uninstrumented root suite passed, and the audit already ignores that class.
