# Phase 6 — Session store packages

## Objectives

- Make durable sessions native packages that fill the `store` slot: `@arnilo/prism-store-jsonl`, `@arnilo/prism-store-sqlite`, and `@arnilo/prism-store-postgres`, under `packages/stores/<name>/`.
- Ship a store conformance suite in `@arnilo/prism/testing`. It covers append, branch and fork, package-state entries, suspended-run records, search, title, list, and delete. Every store passes it.
- Make `agent.sessions` features follow the store's capabilities, which `inspect()` reports.
- Leave the kernel with only the `SessionStore` contract and the in-memory store. The JSONL store leaves `src/node/`, and the SQLite and Postgres stores leave `@arnilo/prism-core`.
- Load `pg` only when `@arnilo/prism-store-postgres` is listed.

## Expected Outcome

- `packages: [sqliteStore({ path: ".prism/sessions.db" })]` makes every session durable with no other wiring. `agent.session({ id })` reopens a session in a new process, with its package state, and `session.resume(decisions)` finishes a suspended approval there.
- `storeConformance(factory, options)` from `@arnilo/prism/testing` passes for the kernel memory store and all three packages. The Postgres leg runs under `bun run test:postgres` with a URL. If no URL is available, the task note says so.
- `agent.sessions.list`, `get`, `delete`, and `search` work on every durable store. A store that lacks a capability answers `UnsupportedStoreCapabilityError` naming it, and `agent.inspect()` lists the store's capabilities.
- An agent that does not list `@arnilo/prism-store-postgres` never loads `pg`. A subprocess test inspects the module graph.
- `@arnilo/prism/node/session-store-jsonl`, `@arnilo/prism-core/sessions/sqlite`, `@arnilo/prism-core/sessions/postgres`, and `@arnilo/prism-core/sessions/codecs` are gone, with their importers migrated and baselines regenerated.
- `examples/sqlite-resume.ts` and `examples/durable-approval.ts` run under the execution gate and prove the Phase 6 Done criteria.

This plan implements roadmap **Phase 6 — Session stores**. Task 1 is the phase review. It is required because the plan creates packages, moves 0.12 code out of the kernel and `prism-core`, and extends the store contract's conformance.

Phases 4, 5, and 6 may run in parallel after Phase 3. This plan shares root `package.json` (`exports`, `workspaces`), `scripts/package-truth.mjs`, `packaging.test.ts`, `scripts/compat-baseline/`, `CHANGELOG.md`, and the docs and examples gate lists with plans 150–152. A task that lands after a sibling plan's task rebases those files and regenerates the baseline. The examples here use `mockProvider` from plan 151 if it has landed, and otherwise the plan-149 mock input. Task 1 records which one.

The roadmap's Done criterion "including observational memory state" cannot be met literally here. The observational-memory package is Phase 8, and Phase 6 runs before it. Task 1 records this. The SQLite example proves the same mechanism with a package that keeps session state, and Phase 8's Done ("state surviving resume") proves it for observational memory.

Out of scope, recorded for the phases that own them:
- moving the hosts (AG-UI, ACP, the server handler, channels, the supervisor, Prism Code) from the checkpoint lifecycle onto `session.resume` (backlog P1, Phase 10/12)
- legacy unscoped sessions under an ownership-scoped agent (backlog P1, Phase 12)
- the NATS event source (`@arnilo/prism-core/sessions/nats`), which is an `AgentEventSource`, not a `SessionStore`, so the Phase 11 sweep places it

Lab impact (probe 12): `packages/prism-code/src/sessions.ts:108-114` (`resolveSessionStore`) and `packages/prism-code/src/acp.ts:207` switch to the SQLite package's named export in Task 4. The lab's session policy (git-root keying, titles, `--continue`) stays until Phase 12.

This plan does not ship a version bump, a publish, a `/docs` change, or npm deprecation of `@arnilo/prism-core` (Phase 11).

## Tasks

- [ ] Task 1: Phase 6 review — store contract, packages, and moves (read-only)
  - Acceptance Criteria:
    - Functional: The Notes inventory every contract the phase touches, each citing roadmap §2.1, §2.5, §2.9, or Phase 6 and the current code at `file:line`:
      - `SessionStore` (`src/contracts-core/session.ts:58-86`): its optional `get`, `readBranchPath`, `searchSessions`, `listSessions`, and `deleteSession`, plus `SessionEntryKind` (`:7-17`, including `suspended_run` and `package_state`), `SessionSummary.title` (`:94-106`), and `UnsupportedStoreCapabilityError` (`:116`)
      - the existing conformance: `assertSessionStoreConforms` (`src/testing/session-store-conformance.ts:60`), `runSessionStoreConformance` (`:183`), `assertSessionStoreSearchSessions` (`:232`), `assertSessionStoreBranchIsolation` (`:341`), `assertSessionStoreIndexCapabilities` (`:406`), and the `exerciseSessionIndex` option
      - the kernel memory store (`src/session-stores.ts`) and the JSONL store (`src/node/session-store-jsonl.ts`, root subpath `./node/session-store-jsonl`, `scripts/phase54-package-map.mjs:42`, `examples/tsconfig.json:21`)
      - `packages/prism-core/src/sessions/{sqlite,postgres,codecs,query-semantics.ts}`: `SqlitePersistence` (`sqlite/persistence.ts:113`) bundles `SessionStore` with `RunLedger`, `CheckpointStore`, `LeaseStore`, `RunFeedbackStore`, and lifecycle
      - `agent.sessions` (`src/agent/sessions.ts`) and the store slot (`src/slots/defaults.ts`)
    - Functional: Count every importer, grouped by workspace, of:
      - `@arnilo/prism/node/session-store-jsonl` and `createJsonlSessionStore`, including `packages/agent-sdk/src/define-agent.ts:29,171`
      - `@arnilo/prism-core/sessions/sqlite` and `createSqlitePersistence` (`packages/acp-agent/src/index.ts:30`, `packages/prism-code/src/{sessions.ts:22,acp.ts:25}`, examples, scripts, tests)
      - `@arnilo/prism-core/sessions/postgres` and `createPostgresPersistence`, including `prism-core/enterprise/postgres` and the `scripts/` Postgres suites
      - `@arnilo/prism-core/sessions/codecs`
    - Functional: Record these decisions:
      - **(a) Companion stores.** Default: each durable store package keeps its whole persistence object (session store, checkpoints, leases, run ledger, feedback, lifecycle) as named exports, because they share one database and schema. The package's `definePackage` claims only the `store` slot with the `SessionStore` facet. Checkpoints, leases, and the ledger are 0.12 modules whose kernel contracts Phase 11 decides (§2.9), so this plan moves their implementations but not their contracts.
      - **(b) Shared codecs.** `sessions/codecs` and `query-semantics.ts` are shared by SQLite and Postgres. Options:
        - a library workspace `@arnilo/prism-store-codecs` (a plain library, not a `definePackage` package) under `packages/stores/codecs/`
        - a kernel subpath. Rejected by default: §2.2 lists the published entry points, and §2.1 keeps only the contract in the kernel.
        - duplicating the code in both packages. Rejected: two copies of the row encoding drift.

        Default: the library workspace. It is not in the §2.9 catalog, so record it as a roadmap amendment.
      - **(c) Store capabilities.** Default: derive them from method presence (`listSessions`, `deleteSession`, `searchSessions`, `readBranchPath`), with no new `capabilities` field, and report them in `inspect().slots.store`. Record the field name `inspect()` uses.
      - **(d) Title.** §2.3 has no `session.setTitle`. Default: the conformance proves that a `metadata` entry carrying `title` (Prism Code's `setSessionTitle`, `packages/prism-code/src/sessions.ts:154`) surfaces as `SessionSummary.title` in `listSessions` and is matched by `searchSessions`. Record whether `setSessionTitle` uses an entry or a session-record write. If it is a record write, the conformance covers that path instead.
      - **(e) Package config.** JSONL: `{ dir }`. SQLite: `{ path, busyTimeoutMs? }`. Postgres: `{ url }`, where `url` is `x-prism-secret` and ref-only because a connection string holds a password, plus `schema?` and `pool?`. Name the default `path` and `dir` (relative to the host's cwd, or required with no default; default: required).
      - **(f) The agent-sdk JSONL shorthand.** `packages/agent-sdk/src/define-agent.ts:171` builds a JSONL store from `store: { type: "jsonl", path }`. The agent SDK is frozen (plan 149 Task 6), but it must compile. Default: it imports the JSONL package's named factory.
      - **(g) The OM-state Done criterion**, as described in the header: the stand-in package used in the example, and the Phase 8 handoff.
    - Functional: Record the current failing-test set of `bun test src packages` as this plan's baseline, and whether `POSTGRES_URL` (or the variable `scripts/require-postgres-url.mjs` reads) is available.
    - Functional: Record a verdict. If a finding invalidates a later task, stop and re-cut.
    - Performance: n/a — read-only.
    - Code Quality: Every count cites the `graft` or `rg` command that produced it.
    - Security: List every store read that could cross an ownership scope: `readBranchPath`, `list`, `listSessions`, `searchSessions`, and `deleteSession`. Name the conformance step that pins scope filtering for each.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.1 Store row, §2.5 `store` slot, §2.9 stores row, Phase 6
      - plan 146 Task 7 (`package_state`), plan 149 Tasks 2, 4, and 5 (`agent.session({ id })`, `suspended_run` as the branch tip, `agent.sessions`), and plan 149 Further Actions
      - backlog: "Add `listSessions` and `deleteSession` to the durable stores", "Run the `package_state` store conformance step against Postgres"
    - Options Considered:
      - Skip the review because the stores already exist. Rejected: decisions (a) and (b) shape three new packages and a fourth library.
    - Chosen Approach:
      - Run graft and rg per symbol, read the cited spans, and decide (a)–(g).
    - API Notes and Examples:
      ```bash
      graft callers createSqlitePersistence --depth all
      graft callers createJsonlSessionStore --depth all
      rg -l "sessions/codecs" src packages scripts examples
      ```
    - Files to Create/Edit:
      - `plans/153-Phase-6-Session-Store-Packages.md`: Notes and amendments only.
    - References:
      - `.agents/skills/create-plan/references/prism.md` §2, §4 (store package checklist)
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none — findings only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: `storeConformance` in `@arnilo/prism/testing`, and store capabilities in `inspect()`
  - Acceptance Criteria:
    - Functional: `storeConformance(factory, { reopen?, capabilities? })` composes the existing assertions and adds these legs, each a named step:
      - **append and read**: ordered entries, `get`, `readBranchPath` when present, and append-conflict rules
      - **branch and fork**: sibling branches stay isolated, and a branch copy under a new session id (plan 149 `fork`) leaves the source untouched
      - **package state**: `package_state` entries round-trip byte-for-byte, and the latest per key wins on reopen
      - **suspended run**: a `suspended_run` entry parented to the leaf is found as the branch tip after `reopen()`, and an entry appended after it hides it (plan 149 Task 4 rule)
      - **search**: the existing `assertSessionStoreSearchSessions`
      - **title**: per Task 1(d)
      - **list and delete**: `listSessions` pages newest-first and filters by ownership scope, and `deleteSession` removes every entry and answers `false` for an absent or foreign session
      - **restart**: when `reopen` is given, every leg above is re-read through a fresh store instance over the same backing data
    - Functional: `capabilities` declares which optional legs a store claims. A leg for a capability the store lacks asserts `UnsupportedStoreCapabilityError` from `agent.sessions` instead of skipping silently.
    - Functional: The kernel memory store passes `storeConformance`. `runSessionStoreConformance` and `assertSessionStoreConforms` are folded into it and deleted, with no alias. Their callers migrate in this task (Task 1 count).
    - Functional: `agent.inspect()` reports the store slot's owner and its derived capabilities (Task 1(c)). `agent-surface-freeze.test.ts` is updated on purpose.
    - Performance: The suite runs in under 2 s on the memory store. The restart leg reopens once per leg group, not once per assertion.
    - Code Quality: One entry point, `storeConformance`, consistent with `packageConformance` and `loopConformance`. The leg names are exported so a failure names its leg.
    - Security: The list, search, and delete legs include a foreign-scope fixture, and a foreign session must never appear or be deletable. A canary secret in a `package_state` entry written through the redacting session path never reaches the store unredacted. That is asserted through the `agent.session` path, not raw `append`.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 6 (the conformance list); `prism.md` §4 store checklist
      - `src/testing/session-store-conformance.ts`, `src/testing/package-conformance.ts` (shape precedent), `src/agent/sessions.ts`, `src/agent/inspect.ts`
    - Options Considered:
      - Keep `runSessionStoreConformance` and add the new legs beside it. Rejected: two entry points for one contract.
    - Chosen Approach:
      - One composed suite with named legs, a restart option, and capability-driven expectations.
    - API Notes and Examples:
      ```ts
      import { storeConformance } from "@arnilo/prism/testing";
      test("sqlite conforms", () =>
        storeConformance(() => createSqliteSessionStore({ path }), { reopen: () => createSqliteSessionStore({ path }) }));
      ```
    - Files to Create/Edit:
      - `src/testing/store-conformance.ts`: new. `src/testing/session-store-conformance.ts`: folded in and deleted. `src/testing/index.ts`.
      - `package.json`: the `./testing/session-store-conformance` export is deleted if Task 1 confirms the root `/testing` export covers it.
      - Callers per Task 1 (`src/__tests__/session-stores.test.ts`, `node-session-store-jsonl.test.ts`, `session-index.test.ts`, the `prism-core` session tests, `scripts/` suites).
      - `src/agent/inspect.ts`: store capabilities. `src/__tests__/agent-surface-freeze.test.ts`.
      - `scripts/compat-baseline/arnilo__prism.txt` (and the `testing` baselines): regenerate, with the diff in the task note.
      - `docs/next/testing.md`: `storeConformance`. `docs/next/slots.md`: store capabilities. `CHANGELOG.md`.
    - References:
      - plan 147 Task 2 (`packageConformance`), plan 149 Task 5 (`exerciseSessionIndex`)
  - Test Cases to Write:
    - `memory_store_passes_store_conformance`
    - `store_conformance_fails_a_store_that_leaks_a_foreign_session` (a deliberately broken fixture store)
    - `store_conformance_fails_a_store_that_drops_package_state_on_reopen`
    - `missing_capability_leg_expects_unsupported_error`
    - `inspect_reports_store_owner_and_capabilities`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new conformance entry point, a removed one, and an `inspect()` field.
    - Docs pages to create/edit:
      - `docs/next/testing.md`: `storeConformance`.
      - `docs/next/slots.md`: store capabilities and how `agent.sessions` uses them.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: `@arnilo/prism-store-jsonl`
  - Acceptance Criteria:
    - Functional: `packages/stores/jsonl/` holds a package with the §2.10 shape:
      - `capabilities: ["slot:store"]`
      - config `{ dir }` per Task 1(e)
      - `setup` claims the slot with `prism.slots.store.provide(createJsonlSessionStore(...))`
      - `createJsonlSessionStore` and `readJsonlSessionEntries` are named exports
    - Functional: The JSONL store gains `listSessions` and `deleteSession`, with the capped linear scan the file format allows. It passes `storeConformance` with `reopen`.
    - Functional: `src/node/session-store-jsonl.ts` and the root `./node/session-store-jsonl` export are deleted, with no alias. Every importer migrates in this task: `packages/agent-sdk/src/define-agent.ts` per Task 1(f), `src/__tests__/{fixtures,session-index,node-session-store-jsonl}.test.ts` (moved into the package where they test the store), examples, `examples/tsconfig.json:21`, `scripts/phase54-package-map.mjs:42`, and the scripts.
    - Functional: A repo-wide grep for `node/session-store-jsonl` and `createJsonlSessionStore` imported from `@arnilo/prism` over `src/ packages/ apps/ scripts/ examples/ docs/` returns only the Task 1 residue. Exclusions: `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`, released `/docs`, and historical `CHANGELOG` sections.
    - Performance: `listSessions` reads only the session files in `dir` and the first and last line of each, not whole transcripts. The README states the per-call cost (one directory read plus two line reads per session). `deleteSession` removes one file.
    - Code Quality: The kernel keeps no file-system store. The `kernel-imports-no-package` gate stays green.
    - Security: `deleteSession` and `listSessions` apply the ownership scope. A session id containing path separators fails closed (`invalid_session_id`), and a test covers `../` traversal.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.9 stores row, §2.10 package shape; `src/node/session-store-jsonl.ts`
      - `packages/integrations/hooks-json/` (package precedent)
    - Options Considered:
      - Keep JSONL in the kernel as the "simple durable" default. Rejected: §2.1 keeps only the contract and the in-memory store, and Phase 6 names `store-jsonl`.
    - Chosen Approach:
      - Move the file, wrap it in `definePackage`, and add the two capabilities.
    - API Notes and Examples:
      ```ts
      import jsonlStore from "@arnilo/prism-store-jsonl";
      const agent = await createAgent({ model, packages: [jsonlStore({ dir: ".prism/sessions" })] });
      ```
      ```jsonc
      { "name": "@arnilo/prism-store-jsonl", "version": "^0.12.1", "integrity": "sha512-…", "config": { "dir": ".prism/sessions" } }
      ```
    - Files to Create/Edit:
      - `packages/stores/jsonl/{package.json,src/**,README.md,CHANGELOG.md,LICENSE,tsconfig.json,bunfig.toml}`: new. `src/node/session-store-jsonl.ts`: moved.
      - Root `package.json`: the `exports` entry deleted, and `workspaces` gains `packages/stores/*` (or an explicit entry).
      - Importers per Task 1.
      - Enforcement rows: `scripts/package-truth.mjs`, the `packaging.test.ts` list, `scripts/independent-packages.json`, and a new compat baseline `arnilo__prism-store-jsonl.txt`.
      - `scripts/compat-baseline/arnilo__prism.txt`, `arnilo__prism-agent-sdk.txt`: regenerate, with the diff and its attribution in the task note.
      - `CHANGELOG.md`.
    - References:
      - plan 147 Task 5
  - Test Cases to Write:
    - `jsonl_store_passes_store_conformance_with_reopen`
    - `jsonl_store_package_passes_package_conformance`
    - `jsonl_session_id_traversal_fails_closed`
    - `jsonl_list_sessions_reads_no_full_transcript` (counts bytes read on a large fixture)
    - `kernel_exports_no_jsonl_store`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new package, and a removed kernel subpath.
    - Docs pages to create/edit:
      - `packages/stores/jsonl/README.md`: package page structure, including the list and search cost.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: The codecs library and `@arnilo/prism-store-sqlite`
  - Acceptance Criteria:
    - Functional: The shared codecs and query semantics move to the home Task 1(b) chose (default `packages/stores/codecs/`, `@arnilo/prism-store-codecs`, a plain library with no `definePackage`). The `@arnilo/prism-core/sessions/codecs` export is deleted.
    - Functional: `packages/stores/sqlite/` holds a package:
      - `capabilities: ["slot:store"]`
      - config `{ path, busyTimeoutMs? }`
      - it claims the slot with the `SessionStore` facet of `createSqlitePersistence`
      - `createSqlitePersistence`, `reopenSqlitePersistence`, `DEFAULT_BUSY_TIMEOUT_MS`, and the companion stores are named exports per Task 1(a)
    - Functional: The SQLite store gains `listSessions` and `deleteSession`, indexed: `deleteSession` cascades over the session's entries, branches, and FTS rows in one transaction. It passes `storeConformance` with `reopen` over the same file.
    - Functional: `packages/prism-core/src/sessions/sqlite/` and its `./sessions/sqlite` export are deleted, with no alias. Every importer migrates in this task:
      - `packages/acp-agent/src/index.ts:30`
      - `packages/prism-code/src/sessions.ts:22` and `acp.ts:25`
      - the `prism-core` `runtime/server` tests
      - `prism-channels` tests
      - examples and scripts (Task 1 count)
    - Functional: Repo-wide greps for `prism-core/sessions/sqlite` and `prism-core/sessions/codecs` (exclusions as in Task 3) return only the Task 1 residue.
    - Performance:
      - `listSessions` is one indexed query per page, and `deleteSession` one transaction.
      - The task note records the conformance suite's runtime against a 10k-entry fixture.
      - `bun:sqlite` loads only when this package (or its named export) is imported. That is free in Bun, but the module-graph test still asserts it.
    - Code Quality: Migrations move with the store. Task 1 records whether `listSessions` needs a new index. If it does, it comes as a numbered migration, never as a DDL edit to an existing migration.
    - Security: Every query that takes a session id is parameterized, and the list and delete queries filter on the ownership columns. The conformance foreign-scope legs cover both.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.9 stores row; Task 1(a), (b)
      - `packages/prism-core/src/sessions/sqlite/{persistence,ddl,migrations,checkpoints,leases,lifecycle}.ts`, `packages/prism-core/src/sessions/codecs/*`
    - Options Considered:
      - Claim several slots (store, checkpoints, leases). Rejected: §2.5 has one `store` slot, and the other contracts are Phase 11's to place.
    - Chosen Approach:
      - Move the store and its companions intact, claim only the `store` slot, and add the two capabilities with a migration if needed.
    - API Notes and Examples:
      ```ts
      import sqliteStore, { createSqlitePersistence } from "@arnilo/prism-store-sqlite";
      packages: [sqliteStore({ path: ".prism/sessions.db" })]
      ```
    - Files to Create/Edit:
      - `packages/stores/codecs/…` (per Task 1(b)) and `packages/stores/sqlite/…`: new, moved from `packages/prism-core/src/sessions/{codecs,sqlite,query-semantics.ts}`.
      - `packages/prism-core/package.json`: the `./sessions/sqlite` and `./sessions/codecs` exports deleted.
      - Importers per Task 1.
      - Enforcement rows for both workspaces: `workspaces`, `scripts/package-truth.mjs`, `packaging.test.ts`, `scripts/independent-packages.json`.
      - `scripts/compat-baseline/arnilo__prism-store-sqlite.txt`, `arnilo__prism-store-codecs.txt` (new), and the old `arnilo__prism-session-store-sqlite.txt`, `arnilo__prism-session-store-codecs.txt`, `arnilo__prism-core.txt`, `arnilo__prism-code.txt`, `arnilo__prism-acp-agent.txt`: regenerate, with the diff and its attribution in the task note.
      - `CHANGELOG.md`.
    - References:
      - plan 126 (bun:sqlite), plan 146 Task 7 (the `package_state` SQLite leg)
  - Test Cases to Write:
    - `sqlite_store_passes_store_conformance_with_reopen`
    - `sqlite_store_package_passes_package_conformance`
    - `sqlite_delete_session_is_one_transaction_and_cascades`
    - `sqlite_list_sessions_filters_foreign_scope`
    - `prism_code_session_store_comes_from_sqlite_package` (in `packages/prism-code`)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new packages, and removed `prism-core` subpaths.
    - Docs pages to create/edit:
      - `packages/stores/sqlite/README.md`: package page structure.
      - `packages/stores/codecs/README.md`: a library README (what it encodes, and that it is not an agent package).
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: `@arnilo/prism-store-postgres`
  - Acceptance Criteria:
    - Functional: `packages/stores/postgres/` holds a package:
      - `capabilities: ["slot:store"]`
      - config `{ url, schema?, pool? }`, with `url` ref-only (`x-prism-secret`) per Task 1(e)
      - it resolves `url` through `prism.credentials.resolve` at `setup` and claims the `store` slot
      - `createPostgresPersistence` and the companion stores are named exports
    - Functional: `pg` is a dependency of this package only. `packages/prism-core/package.json` drops its `pg` peer if nothing else in `prism-core` uses it. Task 1 names `enterprise/postgres` as a remaining user or moves it with this task.
    - Functional: The Postgres store gains `listSessions` and `deleteSession`, with a numbered migration if an index is needed. It passes `storeConformance` with `reopen` under `bun run test:postgres`, which is wired to the new package's `test:postgres` script.
    - Functional: `packages/prism-core/src/sessions/postgres/` and its `./sessions/postgres` export are deleted. Every importer migrates: `prism-core` enterprise, the scripts' Postgres suites, examples, and `prism-channels` tests (Task 1 count). The repo-wide grep for `prism-core/sessions/postgres` (exclusions as in Task 3) returns only the Task 1 residue.
    - Functional: An unresolvable `url` ref fails `createAgent` closed (`PackageLoadError` with `setup` failure, naming the package and the ref, not a value), unless the entry is `optional`.
    - Performance:
      - An agent without this package never loads `pg`. `pg_not_loaded_unless_store_postgres_listed` runs `bun -e` with an agent that lists `store-sqlite` and asserts no `node_modules/pg/` path is in the loaded modules.
      - The README states the pool default and that each `append` is one round trip.
    - Code Quality: There is one `pg` import site, inside the package.
    - Security:
      - The connection string never appears in events, `inspect()`, status notes, or errors. A canary password test covers a failed connection, whose `pg` error includes the host.
      - A literal `url` fails config validation.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 6 ("Heavy drivers (`pg`) must load only when their package is listed", "An agent without `store-postgres` never loads `pg`"); `prism.md` §3 probe 5
      - `packages/prism-core/src/sessions/postgres/*`, `packages/prism-core/src/enterprise/postgres/*`, `scripts/require-postgres-url.mjs`
    - Options Considered:
      - Lazy-import `pg` inside `prism-core`. Rejected: the roadmap moves the driver into its own package, and `prism-core` is being retired.
    - Chosen Approach:
      - Move the store intact, resolve the URL through the slot, and pin the not-loaded test.
    - API Notes and Examples:
      ```jsonc
      { "name": "@arnilo/prism-store-postgres", "version": "^0.12.1", "integrity": "sha512-…", "config": { "url": "env:DATABASE_URL" } }
      ```
    - Files to Create/Edit:
      - `packages/stores/postgres/…`: new, moved from `packages/prism-core/src/sessions/postgres/`.
      - `packages/prism-core/package.json` (exports, peers), `packages/prism-core/src/enterprise/postgres/*` (imports, or moved per Task 1).
      - Root `package.json` `test:postgres:run`: adds the new package's Postgres leg.
      - Importers per Task 1.
      - Enforcement rows, as in Task 4.
      - `scripts/compat-baseline/arnilo__prism-store-postgres.txt` (new), `arnilo__prism-session-store-postgres.txt`, `arnilo__prism-enterprise-postgres.txt`, `arnilo__prism-core.txt`: regenerate, with the diff and its attribution in the task note.
      - `CHANGELOG.md`.
    - References:
      - backlog "Run the `package_state` store conformance step against Postgres"
  - Test Cases to Write:
    - `postgres_store_passes_store_conformance_with_reopen` (Postgres leg, gated on a URL)
    - `postgres_store_package_passes_package_conformance`: the full suite runs on the Postgres leg. Without a URL, the definition-only checks (a valid config schema, declared capabilities, and a ref-only `url`) still run.
    - `pg_not_loaded_unless_store_postgres_listed`
    - `unresolvable_url_ref_fails_create_agent_naming_ref_not_value`
    - `connection_string_canary_never_leaks`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new package, and a removed `prism-core` subpath.
    - Docs pages to create/edit:
      - `packages/stores/postgres/README.md`: package page structure, including the pool and round-trip cost.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: Examples and the Phase 6 close
  - Acceptance Criteria:
    - Functional: `examples/sqlite-resume.ts` works in a temp directory:
      1. Process A lists `sqliteStore({ path })` and a small stand-in package that keeps a counter in `prism.state.session` and exposes it through a command. It runs two turns and bumps the counter.
      2. The example spawns process B (`bun` re-running the same file with `--phase=b`). B creates a new agent over the same file, reopens the session with `agent.session({ id })`, and prints the message count and the counter value.
      3. A asserts B's output.
    - Functional: `examples/durable-approval.ts` works the same way:
      1. Process A runs a tool gated by an `ask` with no `host.ui`, so the run suspends into SQLite.
      2. Process B reopens the session and calls `session.resume([{ approvalId, outcome: "allow_once" }])`. The run completes and the tool result is printed.
    - Functional: Both examples import only `@arnilo/prism`, `@arnilo/prism/testing`, and `@arnilo/prism-store-sqlite`. Each is added to the demo list of `examples_demos_run_to_completion_and_emit_no_secret`, to `examples/README.md`, and to `scripts/e2e-coverage.json`.
    - Functional: The task note records each Phase 6 Done criterion with its proof:
      - a SQLite example resumes a session after a process restart, including package state (`examples/sqlite-resume.ts`); the observational-memory half is handed to Phase 8 per Task 1(g)
      - a suspended approval is resumed in a new process (`examples/durable-approval.ts`)
      - an agent without `store-postgres` never loads `pg` (`pg_not_loaded_unless_store_postgres_listed`)
    - Functional: `docs/next/slots.md` gains a "Store packages" section: the three packages, their capabilities, and how `agent.sessions` reacts. The backlog entries "Add `listSessions` and `deleteSession` to the durable stores" and "Run the `package_state` store conformance step against Postgres" are marked done in the task note, with removal handled at plan end.
    - Performance: Each example finishes in under 3 s, including the child process.
    - Code Quality: No internal seam. The stand-in package is defined inline in the example with `definePackage`.
    - Security: The demo gate's no-secret check covers both. The approval example's decision carries the `approvalId` from `RunResult.pending` only.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 6 Done; `examples/approval.ts` (plan 149, in-process suspend and resume), `examples/define-package.ts`
    - Options Considered:
      - Simulate the restart with two agents in one process. Rejected: Done says "after a process restart" and "in a new process".
    - Chosen Approach:
      - Self-spawning two-phase examples over one SQLite file.
    - API Notes and Examples:
      ```ts
      if (phase === "a") { /* run, suspend */ await Bun.spawn(["bun", import.meta.path, "--phase=b", dbPath, sessionId]).exited; }
      ```
    - Files to Create/Edit:
      - `examples/sqlite-resume.ts`, `examples/durable-approval.ts`: new.
      - `examples/README.md`, `scripts/e2e-coverage.json`, `src/__tests__/docs.test.ts`: demo list.
      - `docs/next/slots.md`: store packages section. `CHANGELOG.md`.
      - `plans/README.md`: status.
    - References:
      - plan 149 Task 7
  - Test Cases to Write:
    - `examples_demos_run_to_completion_and_emit_no_secret`: extended with both files.
    - `phase_6_examples_import_only_prism_testing_and_store_sqlite`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API — examples and docs.
    - Docs pages to create/edit:
      - `docs/next/slots.md`: store packages section.
      - `examples/README.md`: two entries.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun run build && bun run --workspaces --if-present test`: every `packages/stores/*` suite green, and no failure outside the Task 1 baseline set.
- `bun run test:postgres` with a Postgres URL. If none is available, the task note records it and the plan's Compromises name it.
- `bun test --timeout=0 src/__tests__/agent-surface-freeze.test.ts src/__tests__/kernel-imports-no-package.test.ts src/__tests__/public-export-contract.test.ts src/__tests__/packaging.test.ts`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun examples/sqlite-resume.ts && bun examples/durable-approval.ts && bun examples/approval.ts`
- The Task 3, 4, and 5 `rg` sweeps, which return only the Task 1 residue.
- `node scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
