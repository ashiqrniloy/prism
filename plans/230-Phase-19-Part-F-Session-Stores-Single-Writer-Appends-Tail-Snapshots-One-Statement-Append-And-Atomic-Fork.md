# Phase 19 Part F — session stores: single-writer appends, tail snapshots, one-statement append, and atomic fork

## Objectives

- Detect two writers on one session. An append only checks that its parent exists; the memory store's comment says tip compare-and-swap is deliberately not used (`src/session-stores.ts:354`), and the Postgres append does the same existence check (`packages/extensions/store-postgres/src/persistence.ts:510-521`). Two processes that run the same session each append at the tip they saw, and the branch silently forks.
- Stop holding and re-reading the whole branch. A snapshot is every entry of the branch, including everything before the last compaction (`snapshotFromBranch`, `src/session-stores.ts`), kept in memory per session and re-read in full on each rebuild (`session.snapshot()`, `src/agent-session/session.ts:1236`). `session.entries()` is uncached, and an `external_state` write reads the full branch every time (`:393`).
- Cut the Postgres append from eight or nine round trips per entry to one (`persistence.ts:496-603`), and stop a failing `ROLLBACK` from hiding the original error.
- Make `fork()` atomic and batched. It copies the branch one `store.append` at a time (`src/agent-session/session.ts:788-830`), so a long session costs one round trip per entry and a failure leaves a partial session.

## Expected Outcome

- A linear append carries `tip: true`. A store rejects it with `SessionAppendConflictError` when its parent already has another tip-checked child. The run fails with `code: "session_conflict"`, and nothing is written from the conflicting append on. An append after `checkout()` to an earlier entry is a branch append and is accepted.
- The run path and session open read a **tail snapshot**: the newest compaction entry, the entries it keeps, and everything after it. Package and external state from before the compaction come from a checkpoint in the compaction entry. Stores that implement `readBranchPath` answer it without reading the older part of the branch. Full reads remain for `SessionContext.entries()`, compaction, `externalState.load()`, fork, and export.
- One Postgres statement per append. `list()` orders by an explicit sequence column.
- `SessionStore.appendMany` (optional) writes a batch atomically. `fork()` uses it when present, and otherwise removes the partial copy on failure.

This plan implements roadmap **Phase 19 Part F**. It changes the store contract (`SessionAppendOptions`, `SessionBranchRead`, an optional store method) and store schemas, so **Task 1 is the phase review**. It runs after plan 229. No version bump or publish. The Postgres leg needs a database: its tests run under `bun run test:postgres` as today and are not part of `bun run test`.

Cost knobs: none. Tip checking adds no round trip (it is part of the insert statement). A store without the capability keeps today's behavior and `inspect()` reports the missing capability.

## Tasks

- [x] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The task note records, citing `file:line`:
      - (a) **Append contract.** `SessionAppendOptions` and `SessionAppendConflictError` (`src/contracts-core/session.ts`), every `store.append` caller in the kernel (`appendNow`, `fork`, `src/agent-session/session.ts`), and how each of the four stores implements `expectedParentId` and `idempotencyKey` (memory `src/session-stores.ts:340-375`, JSONL, SQLite, Postgres).
      - (b) **Where branches are created on purpose.** `checkout()`, `fork()`, workflow replay, `agent.session({ leafId })`, and any package that appends at a non-tip entry.
      - (c) **Who reads `snapshot.entries`** and what each needs: the scope check in `runInternal`, `resolveAutoCompact` (`entryCount`, last entry kind), `revalidateSnapshot`, `extendSnapshot`, `compactBranch` (which calls `entries()`), `externalState`, `stateStore.hydrate`, `pendingSuspensionOf`, and plan 225 Task 4's repair.
      - (d) **Package state and suspended-run entries older than the last compaction.** Whether `SessionStateStore.hydrate` and `pendingSuspensionOf` need entries from before the compaction point, which decides what a tail read must still include.
      - (e) **Store schemas and migrations.** `packages/extensions/store-sqlite/src/ddl.ts`, `migrations.ts`; `store-postgres/src/ddl.ts`, `migrations.ts`; the JSONL layout; the timestamp-as-text comparison and the `ctid` ordering in Postgres `list()`.
      - (f) **Conformance.** `src/testing/store-conformance.ts` steps and `state-concurrency-conformance.ts`, and which steps must be added.
    - Performance: Records a baseline for a 5,000-entry session with one compaction at entry 4,800: rebuild time and rows read (SQLite), round trips per append and per fork (Postgres).
    - Code Quality: Findings are written against the task they change.
    - Security: Records that ownership filters (`buildOwnershipFilters`) apply to every new query shape.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.5 (store slot), Phase 6; `docs/slots.md`, `docs/disaster-recovery.md`
      - `src/session-stores.ts`, `src/contracts-core/session.ts`, `src/contracts-core/persistence.ts`
      - `packages/extensions/store-{sqlite,postgres,jsonl}/README.md`
    - Options Considered:
      - Skip — rejected: (d) decides the tail read's shape.
    - Chosen Approach:
      - Inventory and a baseline, then confirm or re-cut Tasks 2–5.
    - API Notes and Examples:
      ```bash
      graft callers appendNow --depth all
      graft grep "snapshot()).entries"
      ```
    - Files to Create/Edit:
      - `plans/230-…md`: the task note
    - References:
      - Evaluation findings S1–S3, K13, K15
  - Test Cases to Write:
    - none — read-only
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no
    - Docs pages to create/edit:
      - none
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-16):
    - Read-only. No code, test, or baseline change. Tasks 2–5 stay, with the amendments marked "(Task 1)" in their text. Three findings change the design:
      - **Task 2:** the store marks tip-checked rows, not branch roots.
      - **Task 3:** the tail read cannot stop at the compaction unless the compaction carries a package-state checkpoint.
      - **Task 3:** `agent.session({ id })` also reads the full branch.
    - **(a) Append contract.**
      - `SessionAppendOptions` is `{ expectedParentId?, idempotencyKey? }` (`src/contracts-core/session.ts:421-426`). Its doc comment already allows "stricter branch-tip CAS" with `currentLeafId` in the error (`:413-420`).
      - `SessionAppendConflict` (`:470-475`) carries `expectedParentId`, `currentLeafId`, and `idempotencyDuplicate`. The class (`:483-494`) builds its message from those fields alone. `isSessionAppendConflict` keys on the `code` field (`:497-499`).
      - Kernel callers:
        - `appendNow` (`src/agent-session/session.ts:1267-1299`) always passes `expectedParentId: currentLeafId` plus the run's `idempotencyKey` (`:1279-1282`). On failure it invalidates the snapshot and rethrows (`:1283-1286`).
        - Every session write goes through `serialAppend` (`:1261-1265`), so one session object never races itself. This covers `appendEntry` (`:1254-1259`, which rebases an entry made for an old tip), `appendPackageState` (`:410-422`), `externalState.write` (`:429-443`), `appendMessage` (`:1052-1054`), and the compaction entry (`:1231-1239`). Two session objects for one id can race, whether in one process or in two.
        - `fork` (`:833-875`) calls `store.append(next)` with no options (`:853`), one entry at a time.
      - Memory store (`src/session-stores.ts:340-376`):
        - It dedups on `(session, key, expectedParentId)` (`:345-350`).
        - The parent must exist in the same session (`:358-367`). Tip CAS is deliberately off (`:351-357`).
        - Duplicate ids are rejected (`:368`).
      - JSONL (`packages/extensions/store-jsonl/src/jsonl-store.ts:264-314`): appends are serialized per store instance (`appendChain`, `:265-267`, `:312`). Each append re-reads the parsed session file (`:277-280`). The checks (`:281-298`) match the memory store's. Keys persist to `.idempotency.json` (`:256-261`).
      - SQLite (`packages/extensions/store-sqlite/src/persistence.ts:592-655`) runs one `db.transaction`. It upserts the session, then checks parent existence (`:597-605`), the idempotency key on `(session, parent, key)` (`:607-618`), and the duplicate id (`:620-623`). It then inserts the entry, its search row, the link columns, and the idempotency key.
      - Postgres (`packages/extensions/store-postgres/src/persistence.ts:496-602`) runs the same steps as separate statements inside `BEGIN`/`COMMIT`. `ROLLBACK` sits in the `catch` (`:596-598`), so a failing `ROLLBACK` replaces the original error (S2 confirmed).
      - None of the four stores checks the tip.
      - `packages/hosts/remote/src/mirror.ts:45-56` is the only package outside the stores that appends to a session store. It appends linearly with `expectedParentId: tip` and should pass `tip: true` (added to Task 2). Governance (`policy/record.ts`) and evals (`score.ts`) append to their own ledgers, not to a `SessionStore`.
    - **(b) Where branches are made on purpose.**
      - `checkout(leafId)` (`session.ts:821-826`) only moves `currentLeafId`. The next append is made at that entry, whether or not it has children.
      - `fork()` copies entries into a new session (`:833-875`). The copies are linear in the new session and are not tip appends.
      - `agent.session({ id, leafId })` (`src/agent-session/create-agent.ts:224-236`) opens at that leaf (`session.ts:269`).
        - Channels re-open at the stored route leaf (`packages/hosts/channels/src/runtime-core.ts:302-363`, `runtime-turn.ts:539,567`).
        - Remote serve reports `leafId` (`packages/hosts/remote/src/serve.ts:201,456`).
        - These hosts open at the leaf they last saw, not to branch. A stale saved leaf is the second-writer case.
      - Workflow replay re-opens a dead node's session by id with no `leafId`, so it appends at the latest leaf (`packages/extensions/workflows/src/nodes/agent-node.ts:72-85`). `leafId` is stored in node state for reporting (`:130`, `run/main.ts:368`, `run/checkpoint.ts:90`).
      - No first-party package appends at a non-tip entry.
      - The conformance legs `branch-and-fork` (`src/testing/store-conformance.ts:188-196`) and `exerciseConcurrentParentAppend` (`:171-185`) append sibling children with no tip flag. They must keep passing.
    - **(c) Who reads `snapshot.entries`.**
      - `runInternal` scope check: `entriesInScope((await this.snapshot()).entries, scope)` (`session.ts:701`). `prepareResume` does the same over a full `entries()` read (`:655-660`).
      - `resolveAutoCompact` (`:1101-1142`) reads `entries.at(-1)?.kind === "compaction"` (`:1103`) and `entryCount: snapshot.entries.length`, both for the `compaction.when` payload (`:1115`) and for `resolveShouldCompact` (`:1141`).
        - **`entryCount` counts the whole branch, compacted part included.** A tail would change what `thresholdEntries` and `compaction.when` see.
      - `revalidateSnapshot` (`:1384-1396`) reads only `entries.at(-1)`.
      - `extendSnapshot` (`src/session-stores.ts:208-219`) appends to `entries`. A snapshot past its compaction can be extended (`:197`), so a tail snapshot extends the same way.
      - `snapshotFromBranch` (`:167-199`) needs only the newest compaction, its `keepEntryIds`, and what follows `throughEntryId`.
      - `compactBranch` (`session.ts:1199-1247`) calls `entries()` (full read, `:1207`) and computes `entriesCompacted` from full-branch indexes (`:1241-1243`).
        - The kernel default compactor summarizes `entries.slice(0, start)` from index 0 (`src/compaction.ts:74-100`), so it needs the full branch to produce the same summary.
        - The LLM compactor starts at the previous compaction's `firstKeptEntryId` (`packages/extensions/compaction/src/prepare.ts:42-50,95-101`).
        - The coding compactor scans back for the latest plan turn (`coding.ts:40,55-80`).
        - The memory-system compactor reads its own package-state log (`packages/memory/system/src/session/compactor.ts:52`).
      - `externalState` reads the full branch on every `load()` and every `write()` (`session.ts:428,432`). `createExternalState` folds **every** record for `(vendor, key)` to enforce the 10,000-entry and 8 MiB caps and to compute `seq` (`src/session/external-state.ts:58-66,97-109`).
      - `stateStore.hydrate` reads the full branch. It is called from `openSession` (`session.ts:395-401`), `rehydrateState` after `checkout` (`:404-408`), `openResumedSession` (`:382-388`), and fork.
      - `pendingSuspensionOf` (`src/suspended-run.ts:111-118`) reads only back from the tip, skipping `package_state`.
      - Plan 225 Task 4's repair (`repairUnansweredToolCalls`, `src/agent-session/history-repair.ts:32`, called at `session.ts:1328`) reads `snapshot.messages` only. It is unaffected while `messages` is unchanged.
      - **Not in the plan:**
        - `agent.session({ id })` reads the full branch at open (`create-agent.ts:224-227`) to hydrate state, find a pending suspension, and check scope.
        - `assemble.ts:459` reads `snapshot.summaries`.
    - **(d) Entries older than the last compaction.**
      - **Package state: needed.** `hydrate` (`src/session/state.ts:103-121`) keeps the latest `set` per `(package, key)` and **every** `append` record, from anywhere on the branch. The memory-system compactor depends on that log.
      - **External state: needed** for the caps, for `seq`, and for `load()` (above).
      - **Suspended runs: not needed.** A suspension is pending only when it is the tip, package state aside.
      - Measured on the baseline database (below): a recursive walk that **stops at the compaction** reads 200 rows in 1.48 ms. One that walks every ancestor id and fetches full rows only for the tail and the state kinds reads 221 rows in 25.6 ms. The full read is 5,000 rows in 54.3 ms. Only the walk that stops at the compaction meets the ≥10× target. So Task 3 is amended: the kernel writes a **state checkpoint** into the compaction entry, and the tail read stops at the compaction.
    - **(e) Schemas and migrations.**
      - Entry tables are identical in both SQL stores: `prism_session_entries` (`store-sqlite/src/ddl.ts:70-88`, `store-postgres/src/ddl.ts:78-96`). `timestamp` is `TEXT`. Postgres already indexes `(session_id, parent_id)` (`ddl.ts:222-223`) and `(session_id, kind, timestamp)` (`:224-225`).
      - Migrations come from the shared catalog `createPersistenceMigrationContract` (`packages/extensions/store-codecs/src/persistence-schema.ts:802-820`, steps 001–011). Each step's checksum is built by `migrationStep` (`:707-799`).
        - SQLite applies steps in order (`store-sqlite/src/migrations.ts:41-80`); Postgres has its own runner (`store-postgres/src/migrations.ts:31-80`).
        - Both verify the schema shape (`readSqliteSchemaShape` `:105-164`, `readPostgresSchemaShape` `:117-201`).
        - New steps are **012** (Task 2's tip column and index) and **013** (Task 4's `seq`). Both need a catalog entry, a dialect branch, and shape updates.
      - Ordering:
        - Postgres `list()` orders by `timestamp ASC, ctid ASC` (`persistence.ts:605`). `ctid` is physical position, which `VACUUM FULL`/`CLUSTER` rewrite, so same-millisecond rows can reorder.
        - SQLite `list()` orders by `rowid` (`store-sqlite/src/persistence.ts:203`), which is already stable.
        - `findLatestLeafId` breaks timestamp ties by random `id` in both stores (`store-postgres/src/persistence.ts:1136-1148`, `store-sqlite/src/persistence.ts:1091-1103`). Task 4 orders it by `seq` (Postgres) and `rowid` (SQLite).
        - The branch queries order by `depth` first (`:474`, `:564`), so they are unaffected.
        - The session upsert compares `updated_at` text through `::timestamptz` casts (`persistence.ts:502-507`).
      - JSONL layout: one `<dir>/<sessionId>.jsonl` per session (`jsonl-store.ts:73`). It has no `readBranchPath`, so the kernel falls back to `list()` (`session.ts:877-882`).
    - **(f) Conformance.**
      - `storeConformance` (`src/testing/store-conformance.ts:76-687`) has these legs: append-and-read (`:121-186`), branch-and-fork (`:188-224`), entry round-trips, suspended run (`:360-371`), unknown kind (`:380`), index and scope (`:451+`), links (`:523+`), and search (`:694-781`).
      - `assertStateConcurrencyConforms` (`src/testing/state-concurrency-conformance.ts:159-182`) probes cursor resume, idempotency retry, reservations, unknown outcome, and metadata CAS. None of them touches `append`.
      - Steps to add:
        - A tip leg in `storeConformance`: conflict, a branch append accepted, an idempotent retry deduped before the tip check, and sibling appends without `tip` still accepted.
        - A concurrent tip race in `assertStateConcurrencyConforms`: two `tip: true` appends on one parent, exactly one wins.
        - A tail-read leg.
        - An `appendMany` leg that checks atomicity.
    - **Baseline** (5,000-entry linear session; entry 4,800 is a compaction with `throughEntryId` = e4779 and 20 kept ids; 4,999 messages of about 400 chars):
      - Method: seed with `store.append(entry, { expectedParentId })`. Time `rebuildSessionContext(store.readBranchPath)`, which is what `session.snapshot()` runs, as the median of 15–25 runs. Count Postgres statements with a `client.query` spy on `pool.on("connect")`.
      - Throwaway PostgreSQL 18.6 on a Unix socket, Bun, on a 16-core host. Load average was about 20 during the runs, so compare ratios, not absolute times.
      - **SQLite:**
        - A rebuild reads **5,000 rows** and yields 219 messages.
        - Median **33.7 ms** on a quiet run; 90–100 ms under load.
        - Raw SQL under the same load: full rows 54.3 ms; id-only walk 18.4 ms; id walk plus tail and state-kind rows 25.6 ms (221 rows); walk stopping at the compaction 1.48 ms (200 rows).
      - **Postgres:**
        - Statements per append: **6** for a root, **7** for a linear append, **9** with an idempotency key, and one more for the links entry. This confirms "eight or nine".
        - Seeding 5,000 appends took 14.0 s (2.8 ms each over a local socket).
        - A rebuild reads **5,000 rows** in 78.3 ms (median).
        - **Fork of 5,000 entries: 30,001 statements, 9.85 s.**
    - **Security.**
      - `buildOwnershipFilters` (`store-postgres/src/persistence.ts:1482`, `store-sqlite/src/persistence.ts:1472`) filters on the **sessions row's** ownership columns.
        - `readEntryBranch` applies it only when called with a scope (`:455-458`, `:543-546`). The kernel never passes one, because `SessionBranchRead` has no scope field.
        - The kernel's `append` never fills those columns: its upsert writes only `id` and the timestamps (`:502-508`, `:595`).
        - Ownership on the kernel path is therefore `entriesInScope` over entry metadata (`session.ts:701`, `:659`; `create-agent.ts:233`). Store-side delete and list use the entry-metadata filter `entryScopeFilters` (`store-sqlite/src/persistence.ts:1133-1142`).
      - New query shapes (the tip conflict's leaf lookup, the tail read, `appendMany`) must use the entry-metadata filter or keep the kernel check. A sessions-row filter would reject every kernel session.
      - A conflict error must not report another scope's leaf. Task 2 looks up `currentLeafId` only for an entry in the caller's session, and returns it only when that entry passes the scope check.

- [x] Task 2: A linear append fails when another writer has moved the tip
  - Acceptance Criteria:
    - Functional:
      - `SessionAppendOptions.tip?: boolean`. The session sets it on every append made at its current leaf, with two exceptions, which are branch appends:
        - the first append after `checkout(leafId)` with a defined `leafId`;
        - the entries `fork()` copies.
      - (Task 1) `agent.session({ id, leafId })` appends are tip-checked. Channels and remote re-open at the leaf they last saw, so a stale leaf there is a second writer. To branch on purpose, a host calls `checkout()`. This is a behavior change and is recorded in `docs/migration.md`.
      - (Task 1) **The store marks tip-checked rows, not branch roots.** A `tip: true` insert stores a `linear` flag. Other inserts store `false`. The SQL stores enforce the rule with a partial unique index on `(session_id, parent_id) WHERE linear`.
        - Sibling appends without `tip` keep passing. This covers conformance `branch-and-fork` and `exerciseConcurrentParentAppend`, and hosts that append through the store directly.
        - Existing rows default to `false`, so migration 012 adds a column with a constant default and builds the index without rewriting or backfilling rows. Legacy sibling branches cannot break the index build.
        - JSONL persists the flag in its line format, in a store-private field that is not part of `SessionEntry`.
      - A store that supports tip checking rejects a `tip: true` append whose `expectedParentId` already has a `linear` child. It throws `SessionAppendConflictError` carrying `expectedParentId` and the current leaf.
        - The check and the insert are one atomic step.
        - An exact retry under the same idempotency key is deduplicated before the tip check (today's error).
        - The current leaf is looked up only on the failure path. It is returned only for an entry in the caller's session and scope.
      - The memory, SQLite, and Postgres stores support it. JSONL supports it within one store instance, since `appendChain` is per instance, and documents that it does not coordinate across processes.
      - `packages/hosts/remote/src/mirror.ts` passes `tip: true` on its linear appends.
      - The kernel maps the conflict to a failed run with `error.code: "session_conflict"`, and the session invalidates its snapshot so the next run reads the real tip. (Task 1) Nothing is written **from the conflicting append on**. Entries the run appended before another writer moved the tip stay.
      - (Task 1) `SessionStoreCapability` is derived from method presence (`sessionStoreCapabilities`, `src/session-stores.ts:282-284`; `src/agent/inspect.ts:121`). `tipCheck` is not a method, so the store declares it explicitly. `inspect()` reports it, and a store without it behaves as today.
      - (Executed) The declaration is `SessionStore.tipCheck?: boolean`, and `"tipCheck"` joins the `SessionStoreCapability` union. The run error code is the exported `SESSION_CONFLICT_CODE`. The marker column is `linear INTEGER NOT NULL DEFAULT 0` in both dialects (one schema-model type, `WHERE linear = 1`), not a boolean.
      - (Executed) After a conflict the session moves to the conflict's `currentLeafId` once the conflicting run is over; until then every append of that run rethrows the conflict.
    - Performance: No added round trip: the check is part of the insert (the partial unique index on `(session_id, parent_id) WHERE linear`, in SQL stores).
    - Code Quality: The rule is in the store contract and conformance, not re-implemented in the session.
    - Security: The conflict error carries entry ids only. A conflict never reveals another scope's session: the ownership filter applies first.
  - Approach:
    - Documentation Reviewed:
      - `src/session-stores.ts:330-377`, `src/agent-session/session.ts` (`appendEntry`, `appendNow`, `checkout`)
      - `store-postgres/src/persistence.ts:496-603`, `store-sqlite/src/persistence.ts` (append transaction)
      - Postgres partial unique indexes and `ON CONFLICT` at the supported server versions, through the find-docs skill
    - Options Considered:
      - A session lease held for the run — rejected: it needs renewal, expiry, and a clock, and the first append already detects the second writer.
      - Tip CAS on every append with no branch exception — rejected: branching from an earlier entry is a supported feature.
    - Chosen Approach:
      - Mark tip-checked rows (`linear`) and let the database enforce one linear child per parent (Task 1: marking branch roots instead would make every existing and every untagged sibling append violate the index).
    - API Notes and Examples:
      ```ts
      await store.append(entry, { expectedParentId: leafId, tip: true });
      // second writer → SessionAppendConflictError { code: "session_append_conflict", currentLeafId }
      ```
    - Files to Create/Edit:
      - `src/contracts-core/session.ts`: `tip`, the declared capability
      - `src/session-stores.ts`: memory store; `sessionStoreCapabilities`
      - `src/agent-session/session.ts`: set `tip`; branch after `checkout`; adopt the real tip after a conflict
      - `src/agent-session/session/assemble.ts`: map the conflict to `session_conflict`
      - `src/index.ts`: `SESSION_CONFLICT_CODE`
      - `src/agent/inspect.ts`: report `tipCheck`
      - `packages/hosts/remote/src/mirror.ts`: `tip: true`
      - `docs/migration.md`: `session({ leafId })` appends are tip-checked
      - `packages/extensions/store-sqlite/src/{ddl,migrations,persistence}.ts`, `store-postgres/src/{ddl,migrations,persistence}.ts`, `store-jsonl/src/jsonl-store.ts`
      - `packages/extensions/store-codecs/src/persistence-schema.ts`: the column
      - `src/testing/store-conformance.ts`, `state-concurrency-conformance.ts`: tip steps
      - `scripts/compat-baseline/*.txt`: regenerated, additive diff in the task note
    - References:
      - Evaluation finding S1
  - Test Cases to Write:
    - `second_writer_at_the_same_tip_conflicts`: two session objects on one store; the second run fails with `session_conflict` and writes nothing.
    - `checkout_then_append_is_a_branch_not_a_conflict`.
    - `session_opened_at_stale_leaf_conflicts`.
    - `idempotent_retry_dedups_before_tip_check`.
    - `sibling_appends_without_tip_still_accepted`.
    - `concurrent_tip_race_one_wins`: `assertStateConcurrencyConforms`.
    - `fork_copies_are_not_tip_checked`.
    - `conflict_invalidates_snapshot_and_next_run_sees_real_tip`.
    - `store_conformance_tip_check`: memory, SQLite, Postgres.
    - `jsonl_tip_check_within_one_process`.
    - `migration_adds_marker_without_rewriting_entries`: an existing database upgrades and reads back identically.
  - Notes (executed 2026-11-16):
    - **What changed.**
      - Contract (`src/contracts-core/session.ts`): `SessionAppendOptions.tip`, `SessionStore.tipCheck`, `"tipCheck"` in `SessionStoreCapability`, `SESSION_CONFLICT_CODE` (root export). `sessionStoreCapabilities` appends `tipCheck` when declared (`src/session-stores.ts`).
      - Memory store: a parent → linear-child map. A `tip` append at a parent that has a linear child throws `SessionAppendConflictError { expectedParentId, currentLeafId }`; the idempotency check runs first. `deleteSession` clears the marks.
      - Session (`src/agent-session/session.ts`): `appendNow` passes `tip: true` when it appends at a defined leaf and no branch is pending. `checkout(leafId)` with a defined leaf sets `branchPending`; the next landed append clears it. `fork()` still calls `store.append(next)` with no options. On a tip conflict (not an idempotency duplicate) the session records `tipConflict { error, leafId, run }`. `serialAppend` settles it before each job builds its entry: inside the conflicting run it rethrows, so nothing is written from that append on; outside it the session adopts `currentLeafId` and invalidates the snapshot. `snapshot()` settles it too outside that run.
      - Run (`src/agent-session/session/assemble.ts`): a non-duplicate `SessionAppendConflictError` sets `error.code: "session_conflict"`. The error keeps its name and message. A missing-parent conflict maps the same way; an idempotency duplicate keeps `session_append_conflict`.
      - SQLite: migration 012 (`MIGRATION_012_SESSION_ENTRY_LINEAR`), `linear` in the insert, a lookup on the partial index inside the append transaction, and a mapping of the index's `UNIQUE constraint failed` error as the cross-connection backstop. `currentLeafId` comes from `findLatestLeafId`, on the failure path only.
      - Postgres: migration 012 (`buildMigration012Ddl`), `linear` in the insert, and a `23505` on `prism_session_entries_linear_parent_unique` mapped to the conflict after `ROLLBACK`. No pre-check, so no added statement.
      - JSONL: a store-private `_prismLinear: true` line field. Parsing strips it and records the entry in a module `WeakSet`. The check runs inside the instance's `appendChain`; the README says it does not coordinate processes.
      - Catalog (`store-codecs/src/persistence-schema.ts`): `PERSISTENCE_SCHEMA_VERSION` 12, the `linear` column and `SESSION_ENTRIES_LINEAR_INDEX` in the model, and step `012_session_entry_linear`. Step 001's checksum content filters both out, so existing databases keep their 001 checksum.
      - `packages/hosts/remote/src/mirror.ts` passes `tip: true`.
      - Conformance: `storeConformance` has a new `tip-check` leg on its own session id (`<sessionId>-tip`). It covers conflict with `currentLeafId`, atomicity, a branch accepted, sibling appends without `tip`, a branch root's first tip append, and idempotent dedup before the tip check. The `restart` leg re-checks the mark through the reopened store. `assertStateConcurrencyConforms` takes an `appends` factory and runs the `tip-race` probe: 8 concurrent tip appends at one parent, exactly one wins. The SQLite, Postgres, and `scripts/phase22-conformance.test.mjs` legs pass it.
    - **Tests.**
      - `src/__tests__/session-tip-check.test.ts` (10 tests). It covers every kernel-side case listed above, `store_conformance_tip_check` for memory (plus a store that declares the guard but ignores `tip`, which fails `[tip-check]`), and inspect.
      - `jsonl_tip_check_within_one_process` (JSONL).
      - `migration_adds_marker_without_rewriting_entries` (SQLite and Postgres): legacy sibling rows read back unchanged with `linear = 0`, and the first tip append at their parent is accepted.
      - Updated fixtures:
        - Migration rewinds in the SQLite and Postgres tests also undo 012. Migration counts and lists now include 012.
        - Capability lists (`agent-inspect`, the three store `package.test.ts` files) include `tipCheck`.
        - The DDL test concatenates 012.
        - `public-export-contract` freezes `SESSION_CONFLICT_CODE`.
        - `session-snapshot-cache.test.ts`'s randomized "resume a handle at a leaf" step now calls `checkout(leaf)`. A handle re-opened at a non-tip leaf is a second writer by design.
    - **Checks.**
      - `bun run typecheck` clean.
      - `bun run test` (9 stages): every package and core test stage has 0 failures. The core stage ran 2,192 pass, extensions 1,026 pass, hosts 905 pass, prism-agent 66 pass. The docs test has 69 pass.
      - Two gate stages failed on the first full run. This task's share is fixed:
        - The non-null assertions in the three stores were rewritten without `!`.
        - `exportCounts` were rebaselined with reasons: `@arnilo/prism` 1,579 (+1), `@arnilo/prism-extensions` 1,478 (+3).
        - The host-builder index (`bun scripts/host-builder-index.mjs`) and the package-truth docs (`bun scripts/package-truth.mjs --emit-docs`) were regenerated.
        - `biome lint .` is clean.
      - What still fails in `scripts/budget-gate.test.mjs` is not this task's. The uncommitted memory-plan work in `packages/memory/system` sets the `@arnilo/prism-memory-system` export count to 1,146 against a ceiling of 1,124, and its `src/session` non-null count to 159 against 114. This task does not touch that package.
      - Postgres leg against a throwaway PostgreSQL on a Unix socket (`store-postgres/src`): 51 pass. `scripts/phase22-conformance.test.mjs` and `phase7-conformance.test.mjs`: 5 pass.
      - `bun scripts/release.mjs gate` reports one item: `@arnilo/prism-ai changed since v0.13.0 but version is still 0.13.0`. It comes from the uncommitted plan 227 provider files (`packages/providers/*`), which this task does not touch. The plan defers version bumps.
    - **Performance.** Postgres statements per append, by client spy: plain linear append 7, tip append **7**, tip with an idempotency key 9. This equals Task 1's baseline, so there is no added round trip. A conflict costs the failed transaction plus one leaf lookup, on the failure path only.
    - **Budgets.** `scripts/budgets.json` kernel ceilings were re-measured: packed 1,324,949, unpacked 4,286,204, root exports 1,579 (+1, `SESSION_CONFLICT_CODE`), source lines 43,602. `exportCounts` are `@arnilo/prism` 1,579 and `@arnilo/prism-extensions` 1,478. A dated reason is recorded for each.
    - **Baseline diff** (`--update-baseline`; this task's lines only, all additive or widened, no removals):
      - `@arnilo/prism`:
        - `+SESSION_CONFLICT_CODE`
        - `SessionAppendOptions` gains `tip?`
        - `SessionStore` gains `tipCheck?`
        - `SessionStoreCapability` gains `"tipCheck"`
        - `./testing STORE_CONFORMANCE_STEPS` gains `"tip-check"`
        - `./testing/state-concurrency-conformance StateConcurrencyFactories` gains `appends?`
      - `@arnilo/prism-extensions`:
        - `./store-codecs PERSISTENCE_SCHEMA_VERSION` 11 → 12
        - `+./store-codecs SESSION_ENTRIES_LINEAR_INDEX`
        - `./store-sqlite` and `./store-postgres` `ADAPTER_INDEX_NAMES` gain `prism_session_entries_linear_parent_unique`
      - The other lines in the regenerated files come from the uncommitted plan 226–229 work.
    - **Sweep.** No retired name, error, or config.
    - **Security.** The conflict carries entry ids only. Each store reads `currentLeafId` from the caller's own session id; no sessions-row ownership filter is involved (Task 1). The kernel adopts that leaf only outside the conflicting run, and the next run's `entriesInScope` check (`runInternal`) still covers the adopted branch. A foreign-scope writer on the same id therefore yields `SessionNotFoundError`, not its content.
    - **Findings for later tasks.**
      - Task 4: the Postgres conflict mapping keys on `error.constraint === SESSION_ENTRIES_LINEAR_INDEX` after `ROLLBACK`. The one-statement append keeps that mapping and drops the `ROLLBACK` (S2). Its migration is now **013**, as planned.
      - Task 5: `appendMany` copies must stay non-tip (`linear = 0`), so a forked session's first linear append is accepted.
      - Task 3: no impact. Tip adoption only moves `currentLeafId`, and the tail read follows it.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — store contract, a run error code, schema migrations
    - Docs pages to create/edit:
      - `docs/slots.md`: the store slot — tip checking, branch roots, the capability
      - `docs/agent.md`: `session_conflict`
      - `packages/extensions/store-{sqlite,postgres,jsonl}/README.md`: support and migration
      - `docs/operations.md`: running one session from several processes
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 3: The run path reads a tail snapshot
  - Acceptance Criteria:
    - Functional:
      - `SessionBranchRead.from?: "compaction"` asks for the newest compaction entry on the branch, the entries its `keepEntryIds` name, and every entry after it. A branch with no compaction returns the whole branch. The recursive walk **stops at the compaction**.
      - (Executed) The walk stops at the newest compaction's **`throughEntryId`** (that entry included), not at the compaction entry. `snapshotFromBranch` counts every entry after `throughEntryId`, and the kept tail sits between it and the compaction entry, so a walk that stopped at the compaction would lose any non-message or unlisted entry there. The entries `keepEntryIds` names before `throughEntryId` come first; items are in branch order, leaf last. A compaction without `throughEntryId` returns the whole branch. A store may ignore `from` and return the whole branch; the kernel uses it as is.
      - (Executed) The checkpoint is `CompactionEntryData.checkpoint: { version: 1, branchLength, packageState, externalState, pinnedEntryIds }`. `pinnedEntryIds` are the message entries `keepEntryIds` names before `throughEntryId`, in branch order, so the kernel orders the pinned entries without knowing their positions. It is written only when the compaction entry lands on the tip the compactor read; one rebased onto a moved tip goes without it.
      - (Task 1) Package and external state from before the compaction are still needed: every `package_state` `set` head and `append` record, and every `external_state` record. The walk cannot fetch them cheaply, because a walk over every ancestor id is only about 2× faster than today. So `compactBranch` writes a **state checkpoint** into the compaction entry's data. The checkpoint holds:
        - the folded package state (the latest `set` per key, and the `append` logs);
        - the per-`(vendor, key)` external-state aggregates (record count, bytes, last `seq`);
        - the branch length through the compaction.
      - (Task 1) `hydrate` starts from the checkpoint plus the tail entries. A compaction written before this change has no checkpoint, so the kernel falls back to a full read for that branch.
      - (Task 1) A pending suspension needs only the tip, so the tail covers it.
      - (Task 1) The checkpoint copies the `append` logs into every compaction. The task note records its size on the memory-system log. If that size is unacceptable, the fallback is a walk over every ancestor id plus a kind filter, and the target becomes ≥2×; the task note records which applies.
      - The memory, SQLite, and Postgres stores implement it; the kernel falls back to a full read for a store that does not.
      - `session.snapshot()` uses the tail read. So does the open path, `agent.session({ id })` (`src/agent-session/create-agent.ts:224-236`), which reads the full branch today. The snapshot's `messages` and `summaries` are identical to today's for every branch in the conformance corpus.
      - (Task 1) `entryCount` (the `compaction.when` payload and `resolveShouldCompact`, `session.ts:1115,1141`) keeps meaning the whole branch: the checkpoint's branch length plus the entries after it. `thresholdEntries` behavior does not change.
      - `SessionContext.entries()`, `session.entries()`, fork, and export keep reading the full branch.
      - Package-state appends and `externalState.write` use the cached tail snapshot and the checkpoint's aggregates instead of a branch read per write. (Task 1) `externalState.load()` returns every record, so it keeps a full read; it runs only when a driver resumes.
      - (Task 1) **`compactBranch` keeps its full read.** It runs once per compaction, not once per rebuild. The kernel default compactor summarizes from index 0 (`src/compaction.ts:74-100`), and `entriesCompacted` uses full-branch indexes (`session.ts:1241-1243`). No first-party compactor changes.
    - Performance: On Task 1's baseline session, a rebuild reads at most the tail's rows and is at least 10× faster than Task 1's quiet-run median of 33.7 ms for 5,000 rows on SQLite. A raw walk that stops at the compaction measured 1.48 ms for 200 rows. Resident entries for the session drop accordingly. Numbers go in the task note and `docs/performance.md`.
    - Code Quality: One function builds a snapshot from a tail; `snapshotFromBranch` keeps working on a full branch and both are proven equal by a property test.
    - Security: The scope check (`entriesInScope`) covers every returned entry, including the compaction entry and its stamp. (Task 1) Any filter inside the tail query uses the entry-metadata filter (`entryScopeFilters`), not `buildOwnershipFilters`. The kernel's append never fills the sessions row's ownership columns, so a sessions-row filter would reject every kernel session.
  - Approach:
    - Documentation Reviewed:
      - `src/session-stores.ts` (`snapshotFromBranch`, `extendSnapshot`, `readBranchFromReader`), `src/agent-session/session.ts:1236-1280`, `:393-415`
      - `store-sqlite/src/persistence.ts:536-580`, `store-postgres/src/persistence.ts:448-483` (the recursive branch queries)
      - `src/session/state.ts` (`hydrate`)
    - Options Considered:
      - Keep the full read and only cap memory — rejected: the read is the cost.
      - Rewrite the branch at compaction — rejected: the store is append-only and fork/replay need the history.
    - Chosen Approach:
      - A bounded read that stops at the newest compaction, plus the few older entries still referenced.
    - API Notes and Examples:
      ```ts
      await store.readBranchPath({ sessionId, leafId, from: "compaction" });
      ```
    - Files to Create/Edit:
      - `src/contracts-core/session.ts`: `from`
      - `src/session-stores.ts`: tail assembly; memory store
      - `src/agent-session/session.ts`: `snapshot`, `externalState`, `appendPackageState`, `compactBranch` (the checkpoint), `openResumedSession`
      - `src/agent-session/create-agent.ts`: the open path reads the tail
      - `src/contracts-core/compaction.ts`: the checkpoint field on `CompactionEntryData`
      - `src/session/state.ts`, `src/session/external-state.ts`: hydrate from a checkpoint; caps from aggregates
      - `packages/extensions/store-{sqlite,postgres}/src/persistence.ts`: the bounded recursive query
      - `src/testing/store-conformance.ts`: tail-read step
      - `scripts/compat-baseline/*.txt`: regenerated, additive diff in the task note
    - References:
      - Evaluation findings S3, K15
  - Test Cases to Write:
    - `tail_snapshot_equals_full_snapshot`: property test over generated branches with zero to three compactions, kept ids, summaries, and package state.
    - `tail_read_returns_no_entry_before_the_compaction_except_kept_and_required`.
    - `store_without_tail_read_falls_back`.
    - `pending_suspension_before_compaction_is_still_found`.
    - `package_state_before_compaction_is_still_hydrated`.
    - `external_state_write_does_not_read_the_branch`: a store spy counts reads.
    - `external_state_caps_count_records_before_the_compaction`.
    - `entry_count_still_counts_the_whole_branch`.
    - `compaction_without_checkpoint_falls_back_to_full_read`.
    - `session_open_reads_the_tail`.
    - `store_conformance_tail_read`: memory, SQLite, Postgres.
  - Notes (executed 2026-11-16):
    - **What changed.**
      - Contract: `SessionBranchRead.from?: "compaction"` (`src/contracts-core/session.ts`) and `CompactionEntryData.checkpoint` (`src/contracts-core/compaction.ts`, inline type, no new root export).
      - `src/session-stores.ts`:
        - `readSessionSnapshot(store, query)` does one `from: "compaction"` read and builds the snapshot from it. `snapshotFromTail` walks the returned chain from the leaf. A chain that reaches the root is a whole branch and goes to `snapshotFromBranch`. Otherwise the newest `compaction` in the chain must have a summary, valid data, a valid checkpoint, and `throughEntryId` equal to the chain's first entry. The checkpoint's pinned entries go first, then `snapshotFromBranch` runs over `[...pinned, ...chain]`, so the snapshot equals the full one by construction. Any mismatch returns `undefined`, and the kernel reads the whole branch.
        - A side `WeakMap` (like `extendableSnapshots`) keeps each tail snapshot's checkpoint and compaction index; `extendSnapshot` carries it forward. `snapshotTail(snapshot)` returns `branchLength` plus the package-state and external-state bases and the entries after the compaction (or the whole branch, with empty bases).
        - The memory store's `readBranchPath` honors `from` through `collectBranchTail`, which walks by id and stops at `throughEntryId`.
      - `src/session/state.ts`: `foldPackageState(branch)` (each key's latest `set`, then the `append` records), and `hydrate(branch, base = [])` folds `base` first.
      - `src/session/external-state.ts`: `foldExternalState(entries, base)` gives per-`(vendor, key)` `{ count, bytes, seq }`. `ExternalStateHost.write`'s `build` now receives those totals, not the branch. `load()` still reads the whole branch.
      - `src/agent-session/session.ts`:
        - `snapshot()` uses `readSessionSnapshot`. A snapshot whose leaf differs from a defined `currentLeafId` throws `Unknown session leaf`, as the whole-branch walk did, so a deleted session still fails.
        - `openSession`, `rehydrateState`, and `openResumedSession` hydrate from the snapshot's checkpoint plus the entries after it. `openResumedSession` takes a snapshot and seeds the snapshot cache with it.
        - `externalState.write` computes totals from the cached snapshot. `entryCount` (both sites) is `snapshotTail(snapshot).branchLength`.
        - `compactBranch` still reads the whole branch. It builds the compaction entry inside the serial append job and attaches `compactionCheckpoint(entries, data)` only when the tip is still the one the compactor read.
        - `fork` passes `rebuildSessionContext(copied)`.
      - `src/agent-session/create-agent.ts`: the open of `agent.session({ id })` calls `readSessionSnapshot`. An empty answer is still `SessionNotFoundError` (or a new session with `create`); the scope check runs over the snapshot's entries.
      - `@arnilo/prism-extensions/store-codecs`: `readBranchTail(source, leafId)` over two store primitives: `walk(seed, stop, isSeed)` and `byIds(ids)`. The SQLite and Postgres `readEntryBranch` use it for `from: "compaction"`, with the same primary-key recursive walk plus a stop condition: `bp.kind <> 'compaction'`, then `bp.id <> $through`. The pinned entries come from one read by id (`json_each` in SQLite, `= ANY($2::text[])` in Postgres). The page is sliced in JS. There is no schema change.
      - Conformance: `storeConformance` adds a `tail-read` leg on its own session (`<sessionId>-tail`), after `tip-check`. Its branch has two compactions, a pinned entry, and a `package_state` entry in the kept span. It accepts the exact tail or the whole branch, since a store may ignore `from`. The custom test store neither resolves a missing `leafId` nor paginates, so the leg checks neither (the SQLite test checks paging).
    - **Checkpoint size (memory-system log).** The checkpoint copies each key's latest `set` and every `append` record, so it is never larger than the branch's `package_state` data and drops superseded `set` values. The memory-system suites compact twice in all. Their checkpoints were 321 bytes against 895 bytes of `package_state` entries, and 2 bytes. Storage grows by the log's size once per compaction; a rebuild reads one compaction entry. **Accepted**, and the ≥10× target applies (below). The fallback (an ancestor-id walk plus a kind filter) was not needed.
    - **Tests.**
      - `src/__tests__/session-tail-snapshot.test.ts` (11 tests):
        - `tail_snapshot_equals_full_snapshot`: 40 seeded branches with 0–3 compactions at random `throughEntryId`/`keepEntryIds`, summaries, package `set`/`append`, and external state. It checks messages, summaries, leaf, branch length, hydrated package state, and external totals against the whole branch; at least 10 seeds must produce a real tail.
        - The other ten: `tail_read_returns_no_entry_before_the_compaction_except_kept_and_required` (pinned first), `store_without_tail_read_falls_back` (a store ignoring `from`, and one with no reader), `compaction_without_checkpoint_falls_back_to_full_read`, `entry_count_still_counts_the_whole_branch` (`compaction.when` sees 33), `session_open_reads_the_tail` (one read of 5 entries, reused by `messages()`), `package_state_before_compaction_is_still_hydrated`, `external_state_write_does_not_read_the_branch`, `external_state_caps_count_records_before_the_compaction` (cap and `seq` continue from the checkpoint), `pending_suspension_before_compaction_is_still_found` (a suspend after a compaction, reopen by id, resume runs the call), and `store_conformance_tail_read` (memory).
      - SQLite (`sqlite-persistence.test.ts`) and Postgres (`postgres-integration.test.ts`): 300 entries, a compaction at 250 that pins `e5`. Each checks the exact tail `["e5", e229…e299]` and that an opened session's `messages()` equals the whole-branch rebuild; SQLite also checks paging. Both stores' full `storeConformance` runs include `tail-read`.
      - Updated: `session-stores.test.ts` "snapshot() clones each branch entry once" now counts across the open plus the first snapshot, because the open's read is now the first snapshot.
    - **Checks.**
      - `bun run typecheck` clean; `biome lint .` clean.
      - Kernel `src` suite: 2,266 pass after the change. In the full run, root, workspace (extensions 1,026, hosts 905, prism-agent 66) and example stages pass.
      - Postgres leg on a throwaway PostgreSQL 18.6 (Unix socket): `store-postgres/src` 52 pass; `phase7-conformance` and `phase22-conformance` 5 pass.
      - `bun run test`: 6 of 9 stages pass. This task's share of the failures is fixed:
        - `host_builder_eval_criteria_preregistered` failed because regenerating the host-builder index moved its hash. It was re-registered with `bun scripts/host-builder-evals/run.mjs --register`, and the test now passes (18 pass).
        - `markdown_store_write_amplification_within_budget` (ratio 3.97 > 2.75 under load) passes on rerun. That memory-bench store is untouched here.
        - Still failing and not this task's: `@arnilo/prism-memory-system` exports 1,146 > 1,124 and `packages/memory/system/src/session` non-null 159 > 114, from the uncommitted memory-plan work (as recorded in Task 2).
      - `bun scripts/release.mjs gate` reports only `@arnilo/prism-ai changed since v0.13.0` (plan 227's uncommitted provider files, as in Task 2).
    - **Performance** (Task 1's baseline shape: 5,000 linear entries of ~400 characters; a compaction at 4,800 with `throughEntryId` e4779 and 20 kept ids; median of 25; load average ~13–15). The script lives in the session scratchpad.

      | Store | Whole branch (before) | Tail (after) | Speedup |
      | --- | --- | --- | --- |
      | SQLite | 5,000 rows, 48.2 ms | 221 rows, 1.56 ms | 31× (21.6× vs Task 1's quiet 33.7 ms) |
      | Postgres | 5,000 rows, 35.9 ms | 221 rows, 2.67 ms, 2 statements | 13.5× (29× vs Task 1's 78.3 ms) |

      Both snapshots hold 219 messages, and resident snapshot entries drop from 5,000 to 221. The target (≥10× vs 33.7 ms) is met. The tail reads 221 rows, not the raw walk's 200, because it includes `throughEntryId` and the 20-entry kept span. The numbers are recorded in `docs/performance.md`.
    - **Budgets.** Kernel ceilings re-measured: packed 1,330,669, unpacked 4,306,965, counted exports 1,583 (+4 internal: `readSessionSnapshot`, `snapshotTail`, `foldPackageState`, `foldExternalState`; no root export), source lines 43,920. `exportCounts`: `@arnilo/prism` 1,583, `@arnilo/prism-extensions` 1,481 (+3 store-codecs). Each has a dated reason in `scripts/budgets.json`. The host-builder index and package-truth docs were regenerated.
    - **Baseline diff** (`--update-baseline`; this task's lines only):
      - `@arnilo/prism`: `CompactionEntryData` gains `checkpoint?`; `SessionBranchRead` gains `from?`; `./testing STORE_CONFORMANCE_STEPS` gains `"tail-read"` after `"tip-check"`. The steps tuple is a reshaped const; the gate flags it as changed, as Task 2's `tip-check` was.
      - `@arnilo/prism-extensions`: `+./store-codecs readBranchTail`, `+BranchTailSource`, `+BranchWalkStop`.
      - No removals.
    - **Sweep.** No retired name, error, or config.
    - **Security.**
      - `runInternal`'s `entriesInScope` and the open's scope check cover every entry the tail returns, the compaction entry and its stamp included. Entries before the compaction are no longer checked; their content reaches the run only through the compaction's summary, and the compaction entry is stamped.
      - The tail query adds no ownership filter. The seed walk keeps `readEntryBranch`'s existing optional `ownerClause` (the kernel never passes a scope, as Task 1 recorded). The continuation walk and the by-id read are bound to the caller's `session_id`.
      - All values are bound parameters.
    - **Findings for later tasks.**
      - Task 5: `fork()` copies compaction `data` without remapping ids, so a fork of a compacted session has empty `messages()`. This predates Task 3. Task 5 is amended to remap `throughEntryId`, `keepEntryIds`, and `checkpoint.pinnedEntryIds`.
      - Task 5: `appendMany` must round-trip `data.checkpoint` unchanged; the conformance `tail-read` leg covers the single-append path.
      - Task 4: the Postgres tail read is 2–3 statements on the read path and orders by walk depth, not `timestamp`/`ctid`, so `seq` does not change it. The one-statement append must keep storing `data` as JSON text so the codecs' `rowToSessionEntry` parses `checkpoint`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — an optional store read mode
    - Docs pages to create/edit:
      - `docs/slots.md`: `readBranchPath({ from: "compaction" })`
      - `docs/performance.md`: long-session numbers
      - `packages/extensions/store-{sqlite,postgres}/README.md`
      - `CHANGELOG.md`: `## [Unreleased]`, Performance
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 4: One Postgres statement per append
  - Acceptance Criteria:
    - Functional:
      - `append` is a single statement (data-modifying CTEs) that upserts the session row, checks the parent and the tip rule, checks the idempotency key, inserts the entry, upserts the search row, and records the idempotency key. Each failure maps to the same error as today (`SessionAppendConflictError` variants, duplicate id).
      - A failure in the statement surfaces the original error; no explicit `ROLLBACK` can replace it.
      - Entries get a monotonic `seq` (identity column); `list()` and the branch queries order by it instead of `timestamp, ctid`. A migration backfills `seq` in the existing order.
      - (Task 1) `findLatestLeafId` orders by `seq` in Postgres (`persistence.ts:1136-1148`) and by `rowid` in SQLite (`store-sqlite/src/persistence.ts:1091-1103`). Both break timestamp ties by random `id` today. SQLite `list()` already orders by `rowid`.
      - (Task 1) All CTEs in one statement see the same snapshot. A primary-key or tip-index violation therefore surfaces as a unique-violation error (`23505`), not as an empty CTE. Map it by constraint name: the primary key is a duplicate id, and the tip index is `SessionAppendConflictError`.
      - (Task 1) `seq` is migration **013** (Task 2 takes 012): a catalog entry in `store-codecs/src/persistence-schema.ts`, a dialect branch, and schema-shape updates.
      - Session-link columns are updated in the same statement when the entry is the links entry.
      - (Executed) The checks run first in an `ok` CTE (parent present, key unused, id new); every write selects from it, so a failed check writes nothing, the session row included. The result row (`inserted`, `parent_found`, `key_found`) picks the error in today's order. Unique violations map by constraint: the linear index → tip conflict, `prism_session_append_idempotency_pkey` → idempotency duplicate, `prism_session_entries_pkey` → duplicate id. The link columns fold into the session upsert (`CASE WHEN $links`), because a second `UPDATE` of the same row in one statement cannot see the row the upsert inserted.
      - (Executed) `seq` is **PostgreSQL-only**. The shared model gains a `bigint` column type and `dialects` on columns and indexes; `assertPersistenceSchemaShape` filters by its dialect, and `assertAdapterSchemaMatchesModel` takes an optional `dialect`. SQLite's 013 step is a no-op and its latest-leaf and session-index lookups order by `rowid`. Migration 013 is idempotent: a re-run keeps an attached identity and every `seq`.
    - Performance: One round trip per append (Task 1 baseline: 6 for a root, 7 for a linear append, 9 with an idempotency key, plus one for the links entry; 2.8 ms per append over a local socket). The task note records append latency at 1 ms and 20 ms network delay before and after.
    - Code Quality: The statement is built once per store instance; parameters are positional and typed.
    - Security: All values are bound parameters; identifiers come from the validated schema name (`identifiers.ts`) as today.
  - Approach:
    - Documentation Reviewed:
      - `packages/extensions/store-postgres/src/persistence.ts:496-610`, `ddl.ts`, `migrations.ts`, `identifiers.ts`
      - Postgres data-modifying CTE semantics (snapshot visibility within one statement), through the find-docs skill
    - Options Considered:
      - Pipeline the existing statements — rejected: `pg` pipelining support varies and the transaction still holds a connection across awaits.
      - A stored procedure — rejected: it adds a deployment artifact to migrate.
    - Chosen Approach:
      - One CTE statement; a failed check is read from the result row, a concurrent writer from the unique violation it raises (Task 1).
    - API Notes and Examples:
      ```sql
      WITH s AS (INSERT INTO sessions … ON CONFLICT … RETURNING id),
           p AS (SELECT 1 FROM entries WHERE id = $parent AND session_id = $sid),
           e AS (INSERT INTO entries … SELECT … WHERE EXISTS (SELECT 1 FROM p) OR $parent IS NULL RETURNING id)
      SELECT (SELECT count(*) FROM e) AS inserted, (SELECT count(*) FROM p) AS parent_found;
      ```
    - Files to Create/Edit:
      - `packages/extensions/store-postgres/src/{persistence,ddl,migrations}.ts`
      - `packages/extensions/store-sqlite/src/persistence.ts`: `findLatestLeafId` by `rowid`
      - `packages/extensions/store-codecs/src/persistence-schema.ts`: migration 013
      - `packages/extensions/store-postgres/src/__tests__/…`: append and migration tests (Postgres leg)
      - (Executed) `store-sqlite/src/migrations.ts` (no-op 013), the migration fixtures in both stores' tests and `event-source.integration.test.ts`, `store-codecs/src/__tests__/persistence-schema.test.ts`
      - (Executed) `scripts/budgets.json`, `scripts/compat-baseline/*.txt`, `docs/migration.md`, `packages/extensions/store-sqlite/README.md`
    - References:
      - Evaluation finding S2
  - Test Cases to Write:
    - `append_is_one_round_trip`: a pool spy counts queries.
    - `append_errors_are_unchanged`: missing parent, tip conflict, idempotency duplicate, duplicate id.
    - `statement_failure_surfaces_the_original_error`.
    - `seq_orders_entries_written_in_the_same_millisecond`.
    - `migration_backfills_seq_in_existing_order`.
    - Store conformance passes on Postgres (`bun run test:postgres`).
  - Notes (executed 2026-11-16):
    - **What changed.**
      - `store-postgres/src/persistence.ts`: `append` sends one statement, `buildAppendStatement` (built once per store), with 31 positional, explicitly cast parameters. CTEs: `parent`, `prior_key`, `ok`, `session_row` (session upsert plus link columns), `entry`, `search`, `recorded_key`. It runs on `pool.query` with no explicit transaction, so there is no `ROLLBACK` to replace the original error (S2). Foreign keys are checked at the end of the statement, after the session row exists. The linear-index conflict still reads `currentLeafId` on the failure path only.
      - Ordering: `list()` by `seq`; `findLatestLeafId`, the session-index leaf lookup, and the label/summary subqueries by `seq DESC`. The keyset-paginated `queryEntries` keeps its `(timestamp, id)` cursor, and the branch reads order by walk depth.
      - Migration 013 (`buildMigration013Ddl`): add `seq BIGINT`; when no identity is attached yet, number rows by `row_number() OVER (ORDER BY timestamp, ctid)`, set `NOT NULL`, attach `GENERATED BY DEFAULT AS IDENTITY`, and `setval` past the max; then `CREATE INDEX prism_session_entries_session_seq_idx (session_id, seq)`. It is `BY DEFAULT`, not `ALWAYS`, so a restore that carries `seq` still inserts.
      - Catalog (`store-codecs`): `PERSISTENCE_SCHEMA_VERSION` 13, step `013_session_entry_seq` (checksum content names the dialect), `SESSION_ENTRIES_SEQ_INDEX`, `bigint`, `dialects`. Step 001's checksum content filters `seq` and its index out, so existing databases keep their 001 checksum.
      - SQLite: `findLatestLeafId`, the session-index leaf lookup, and the label/summary subqueries order by `rowid DESC`.
    - **Tests.**
      - Postgres (`postgres-integration.test.ts`): `append_is_one_round_trip` (a client-level statement spy: root, linear, tip, tip plus key, and the links entry each send 1, and the links entry lands in the session index), `append_errors_are_unchanged` (missing parent, tip conflict with `currentLeafId`, idempotency duplicate, duplicate id; no session row for a missing parent; no stray entry, search, or key rows), `statement_failure_surfaces_the_original_error` (a `CHECK` on the search table fails the statement after the entry insert; the error is the original `23514`/`no_boom`, and nothing is written), `seq_orders_entries_written_in_the_same_millisecond` (40 equal timestamps with ids sorted against insert order; root siblings pick the later insert as the leaf), `migration_backfills_seq_in_existing_order` (a schema-12 table with timestamp ties is numbered in `timestamp, ctid` order, rows are otherwise unchanged, the next append gets `seq` 5, and a re-run of 013 changes nothing). The full `storeConformance` (with `tip-check`, `tail-read`, concurrent parent appends) and the `tip-race` probe pass on the new statement.
      - Codecs: `session_entry_seq_is_postgres_only`, and the shape test now builds a SQLite shape without `seq` and checks that it is not a PostgreSQL shape.
      - Updated fixtures: migration rewinds and lists include 013 (SQLite and Postgres tests, `event-source.integration.test.ts`); the Postgres migration count is 13; SQLite's null-checksum count is 13; the DDL test concatenates 013 and passes `"postgres"` to `assertAdapterSchemaMatchesModel`.
    - **Checks.**
      - `bun run typecheck` clean; `biome lint` clean on the three store packages. (`biome format` reports these files; formatting is not gated, and earlier tasks left it as is.)
      - Store suites: SQLite 50 pass, codecs 26 pass, JSONL 44 pass.
      - Postgres leg on a throwaway PostgreSQL 18.6 (Unix socket): `store-postgres/src` 57 pass. `bun run test:postgres:run` passed (extensions 57, hosts 2, phase conformance 5). One earlier run of it, made while the full `bun run test` was loading the host, exited 1 in the extensions leg; I did not capture the failing line, and the leg then passed 4 times in a row under the same load. Recorded as an unexplained flake.
      - `bun run test`: 7 of 9 stages pass (core 1,027, extensions 1,234, hosts 905, prism-agent 66, others 0 fail). Task-owned failures are fixed: `host_builder_eval_criteria_preregistered` (re-registered after regenerating the host-builder index; 18 pass) and the `@arnilo/prism-extensions` export count (rebaselined). Still failing and not this task's: `@arnilo/prism-memory-system` exports 1,146 > 1,124 and `packages/memory/system/src/session` non-null 159 > 114 (as in Tasks 2–3).
      - `src/__tests__/docs.test.ts` 69 pass.
      - `bun scripts/release.mjs gate` reports only `@arnilo/prism-ai changed since v0.13.0` (plan 227, as in Tasks 2–3).
    - **Performance.** Statements per append (client spy): **1** for root, linear, tip, tip plus key, and the links entry (Task 1: 6 / 7 / 9 / +1). Latency, median of 39 appends of a 400-character message, through a TCP proxy that delays each direction by half the RTT, against the same schema. "Before" replays the old transaction's statements:

      | RTT | Before: tip | Before: tip + key | After: tip | After: tip + key |
      | --- | --- | --- | --- | --- |
      | 1 ms | 18.6 ms | 22.7 ms | 3.1 ms | 3.0 ms |
      | 20 ms | 145.1 ms | 186.2 ms | 21.8 ms | 21.8 ms |

      At 20 ms, before is about 7 and 9 RTTs and after is 1. At 1 ms the proxy's timer granularity inflates both sides. The script was a temporary file and was removed.
    - **Budgets.** `@arnilo/prism-extensions` exportCount 1,483 (+2: `SESSION_ENTRIES_SEQ_INDEX`, `buildMigration013Ddl`), with a dated reason. The host-builder index and the package-truth docs were regenerated.
    - **Baseline diff** (`--update-baseline`; this task's lines only, all additive or widened, no removals):
      - `@arnilo/prism-extensions`: `+./store-codecs SESSION_ENTRIES_SEQ_INDEX`; `PERSISTENCE_SCHEMA_VERSION` 12 → 13; `PersistenceColumnType` gains `"bigint"`; `PersistenceColumnDefinition` and `PersistenceIndexDefinition` gain `dialects?`; `assertAdapterSchemaMatchesModel` gains `dialect?`; `./store-postgres ADAPTER_INDEX_NAMES` gains `prism_session_entries_session_seq_idx`.
      - The other lines in the regenerated files come from the uncommitted plan 226–229 work.
    - **Sweep.** No retired name, error, or config.
    - **Security.** Every value is a bound parameter, and every parameter has an explicit cast. Identifiers come from `qualifyTable` over the validated schema, as before. The statement adds no ownership filter. Its checks are bound to the caller's `session_id`, except the duplicate-id check, which is global as before. Migration 013 interpolates only the qualified table name.
    - **Findings for later tasks.**
      - Task 5: the Postgres `appendMany` can use the same shape: one statement over `unnest` arrays, with the checks in an `ok` CTE and the same constraint mapping. Rows must be inserted in branch order so `seq` follows it. Copies stay `linear = 0`.
      - Task 5: a fork of 5,000 entries must not bind 31 × 5,000 parameters in one statement; pass column arrays (one parameter per column) or chunk.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no API change; a schema migration
    - Docs pages to create/edit:
      - `packages/extensions/store-postgres/README.md`: the migration and the ordering column
      - (Executed) `packages/extensions/store-sqlite/README.md`: `rowid` ordering and the no-op 013
      - (Executed) `docs/migration.md`: 013 updates every Postgres entry row once
      - `CHANGELOG.md`: `## [Unreleased]`, Performance
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 5: `fork()` is atomic and batched
  - Acceptance Criteria:
    - Functional:
      - `SessionStore.appendMany?(entries, options)` writes all entries or none. Memory, SQLite, and Postgres implement it; JSONL writes the new session file in one write and renames it into place.
      - (Executed) The batch contract: one session, branch order, each `parentId` an earlier batch entry, an entry the session already holds, or undefined. A missing parent throws `SessionAppendConflictError { expectedParentId }`; a taken id throws `Duplicate session entry id`; both before any write. Batch rows are not linear and carry no idempotency key. The store-independent part is the exported `validateSessionAppendBatch(entries)` (returns `SessionAppendBatch { sessionId, externalParentIds }`, or `undefined` for an empty batch). `appendMany` is derived from method presence into `SessionStoreCapability`, so `inspect()` reports it.
      - (Executed) Fork also remaps the compaction package's `firstKeptEntryId` and sets `checkpoint.branchLength` to the copy's own count, since the fork drops suspended runs.
      - `session.fork()` builds the copied entries in memory and calls `appendMany` once. With a store that lacks it, fork appends one by one and, on any failure, removes the partial session (`deleteSession` when available) before rethrowing; without `deleteSession` the error names the partial session id.
      - The forked session's content, links, ownership stamps, and the exclusion of `suspended_run` entries are unchanged.
      - (Task 3) `fork()` remaps the entry ids inside each copied compaction entry's `data`: `throughEntryId`, `keepEntryIds`, and `checkpoint.pinnedEntryIds`. Today it copies `data` as is, so they name the source session's entries. A fork of a compacted session then finds no `throughEntryId` and its `messages()` is empty (measured: source 3 messages, fork 0). The bug predates Task 3; the tail read inherits it (the walk finds no `throughEntryId` and reads the fork whole). Test: `fork_of_a_compacted_session_keeps_its_messages`.
    - (Task 4) The Postgres `appendMany` follows the one-statement append: column arrays through `unnest` (not 31 parameters per entry), checks in an `ok` CTE, the same constraint mapping, rows in branch order so `seq` follows it.
    - Performance: One round trip for a fork on SQL stores. A 5,000-entry fork on Postgres completes in one statement batch (Task 1 baseline: 30,001 statements, 9.85 s over a local socket); the task note records before and after.
    - Code Quality: `appendMany` shares the single-entry validation; no second code path for ownership stamping. (Task 1) Today `fork` copies each entry's metadata, ownership stamps included, and does not re-stamp (`session.ts:851-852`). That stays.
    - Security: The batch is scope-stamped exactly like single appends; a fork across ownership scopes still fails closed.
  - Approach:
    - Documentation Reviewed:
      - `src/agent-session/session.ts:788-830`, `src/contracts-core/session.ts` (`SessionStore`)
      - `store-sqlite/src/persistence.ts` (transactions), `store-postgres/src/persistence.ts`, `store-jsonl/src/jsonl-store.ts`
    - Options Considered:
      - Share the parent's entries instead of copying (a root that points into another session) — rejected: every branch read is per-session, and delete-session would need reference counting.
      - A server-side `INSERT … SELECT` with id remapping — rejected: ids are generated in the kernel and the remap is simpler there.
    - Chosen Approach:
      - An optional batch append, used by fork.
    - API Notes and Examples:
      ```ts
      interface SessionStore { appendMany?(entries: readonly SessionEntry[], options?: { readonly signal?: AbortSignal }): Promise<void> }
      ```
    - Files to Create/Edit:
      - `src/contracts-core/session.ts`, `src/session-stores.ts`, `src/agent-session/session.ts`
      - `packages/extensions/store-{sqlite,postgres,jsonl}/src/…`
      - `src/testing/store-conformance.ts`: batch and atomicity steps
      - `scripts/compat-baseline/*.txt`: regenerated, additive diff in the task note
    - References:
      - Evaluation finding K13
  - Test Cases to Write:
    - `fork_uses_one_batch_append`.
    - `failed_batch_writes_nothing`: a store that fails on the last entry leaves no session.
    - `fork_without_append_many_cleans_up_on_failure`.
    - `forked_branch_equals_source_branch`: content and order, minus suspended runs.
    - `store_conformance_append_many`: memory, SQLite, Postgres, JSONL.
    - (Executed) `fork_of_a_compacted_session_keeps_its_messages`, `inspect_reports_append_many`, and on Postgres `append_many_is_one_statement_and_fork_uses_it`.
  - Notes (executed 2026-11-16):
    - **What changed.**
      - Contract (`src/contracts-core/session.ts`): `SessionStore.appendMany?`, `SessionAppendManyOptions { signal? }`, `"appendMany"` in `SessionStoreCapability`.
      - `src/session-stores.ts`: `validateSessionAppendBatch` and `SessionAppendBatch` (root exports); `sessionStoreCapabilities` derives `appendMany`; the memory store's `appendMany` checks the external parents and every id, then adds each entry.
      - `src/agent-session/session.ts`: `fork()` builds every copy in memory, then calls `appendMany` once. Without it, `appendForkEntries` appends one at a time; on a failure after the first write it calls `deleteSession` and rethrows the original error, and when that is missing or fails it throws `session fork failed after N of M entries; partial session <id> was left in the store` with the original as `cause`. `forkCompactionData` remaps `throughEntryId`, `keepEntryIds`, `firstKeptEntryId`, and `checkpoint.pinnedEntryIds`, and sets `checkpoint.branchLength` to the copy's own count. Metadata, ownership stamps included, is still copied as is, and `suspended_run` entries are still skipped.
      - SQLite: `writeEntryRows` (entry, search row, link columns) is shared by `append` and `appendMany`. `appendMany` is one `db.transaction`: session upsert, external-parent checks, then per entry the id check and the rows, with `linear = 0`.
      - Postgres: `buildAppendManyStatement`, built once per store. 28 parameters for any batch size: 17 column arrays through `unnest … WITH ORDINALITY`, then session id, now, the external parents, the links flag, and the 7 link columns. CTEs: `input`, `missing_parent`, `taken`, `ok`, `session_row`, `entry` (inserted `ORDER BY ord`, so `seq` follows the branch), `search`. The result row reports `inserted`, `missing_parent`, and `taken_id`; a concurrent primary-key violation maps to a duplicate-id error. The links entry's columns come from the last links entry in the batch.
      - JSONL: `appendMany` runs on the instance's `appendChain`. It reads the file, checks parents and ids, writes the old content plus the new lines to `<file>.<pid>.<ms>.tmp`, and renames it over the session file. The temp file is removed on failure.
      - Conformance: the `append-many` leg (after `tail-read`, on `<sessionId>-many`). It covers an empty batch, order, a compaction's `data`/checkpoint round trip, a readable branch, a batch continuing from a stored entry, atomicity for a missing parent and for a taken id, a batch that spans two sessions, and a tip append accepted after a batch.
    - **Tests.**
      - `src/__tests__/session-fork-batch.test.ts` (7 tests): `fork_uses_one_batch_append`, `forked_branch_equals_source_branch` (content, order, ownership stamps, linear chain, messages), `failed_batch_writes_nothing`, and `fork_without_append_many_cleans_up_on_failure` (with `deleteSession`: removed, original error; without: the error names the partial session, which holds 2 entries; failure on the first append: the original error). Also `fork_of_a_compacted_session_keeps_its_messages` (every remapped id names a copy, `branchLength` equals the copy's index, and the fork's tail read is shorter than the whole branch), `inspect_reports_append_many`, and `store_conformance_append_many` (memory, plus a non-atomic `appendMany` that fails `[append-many]`).
      - The full `storeConformance` with `append-many` passes on SQLite (`sqlite-persistence.test.ts`), JSONL (`jsonl-store.test.ts`), and Postgres.
      - Postgres `append_many_is_one_statement_and_fork_uses_it`: a 300-entry batch with equal timestamps is 1 statement. `list()` keeps batch order, and the links entry indexes the session row. A rejected batch writes no entry and no session row. A fork sends ≤ 3 statements, and the copy equals the source.
      - Updated fixtures: capability lists (`agent-inspect` and the three store `package.test.ts` files) include `appendMany`; `public-export-contract` freezes `validateSessionAppendBatch` and `SessionAppendBatch`.
    - **Checks.**
      - `bun run typecheck` clean; `biome lint` clean on `src` and the three store packages.
      - `bun run test`: 7 of 9 stages pass (core 2,210, extensions 1,234, hosts 905, prism-agent 66; 0 fail). The two failing stages are not this task's:
        - `@arnilo/prism-memory-system` exports 1,146 > 1,124 and its `src/session` non-null count 159 > 114, from the uncommitted memory-plan work (as in Tasks 2–4).
        - `markdown_store_write_amplification_within_budget` (ratio 3.14 > 2.75 under load) passes on rerun.
      - Postgres leg on a throwaway PostgreSQL 18.6 (Unix socket): `bun run test:postgres:run` exit 0 (extensions 58, hosts 2, phase conformance 5).
      - `bun scripts/release.mjs gate` reports only `@arnilo/prism-ai changed since v0.13.0` (plan 227, as in Tasks 2–4).
      - The host-builder index, the package-truth docs, and the host-builder eval criteria were regenerated or re-registered.
    - **Performance** (5,000 linear entries of ~400 characters on Postgres; median of 3; Unix socket; load average ~10–15). The script was a temporary file and was removed.

      | Fork path | Statements | Time |
      | --- | --- | --- |
      | Task 1 baseline (per-entry transaction) | 30,001 | 9.85 s |
      | Per-entry after Task 4 (store without `appendMany`) | 5,001 | ~5.0 s |
      | `appendMany` (this task) | **2** (one branch read, one batch) | **~0.43 s** |

      On SQLite the fork is one transaction.
    - **Budgets.** Kernel ceilings re-measured: packed 1,334,210, unpacked 4,319,603, counted exports 1,586 (+3: `validateSessionAppendBatch`, `SessionAppendBatch`, `SessionAppendManyOptions`), source lines 44,071. `exportCounts` `@arnilo/prism` is 1,586. Each has a dated reason in `scripts/budgets.json`. `@arnilo/prism-extensions` is unchanged.
    - **Baseline diff** (`--update-baseline`; all additive or widened, no removals):
      - `@arnilo/prism`:
        - `+SessionAppendBatch`, `+SessionAppendManyOptions`, `+validateSessionAppendBatch`
        - `SessionStore` gains `appendMany?`
        - `SessionStoreCapability` gains `"appendMany"`
        - `./testing STORE_CONFORMANCE_STEPS` gains `"append-many"` after `"tail-read"`
    - **Sweep.** No retired name, error, or config.
    - **Security.**
      - A batch is stamped exactly like single appends: fork copies each entry's metadata, ownership stamps included, and does not re-stamp. The forked session opens with the source session's `ownership`, so a fork across scopes still fails closed on its first scope check.
      - Every check is bound to the batch's `session_id`, except the id check, which is global as for `append`.
      - Postgres values are bound array parameters with explicit casts. Identifiers come from `qualifyTable`, as before.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — an optional store method
    - Docs pages to create/edit:
      - `docs/slots.md`: `appendMany`
      - `packages/extensions/store-{sqlite,postgres,jsonl}/README.md`
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 src/__tests__/session-stores.test.ts`
- `bun run --filter @arnilo/prism-extensions test`
- `bun run test:postgres` (needs a database; see `docs/testing.md`)
- `bun run --filter @arnilo/prism-agent test`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun run test`
- `bun scripts/release.mjs gate`
- Result (2026-11-16, after Task 5):
  - `build:core` and `typecheck` are clean.
  - The session-store suites pass, and the extensions suite has 0 fail.
  - `test:postgres:run` exits 0 on PostgreSQL 18.6.
  - prism-agent 66 pass; the docs test passes in the core stage.
  - `bun run test` passes 7 of 9 stages. Every failure traces to the uncommitted memory-plan budgets and a load-sensitive memory-bench ratio, as recorded in Tasks 2–5.
  - The gate reports only plan 227's `@arnilo/prism-ai` version item.

## Compromises Made

- **The JSONL tip check holds within one store instance only (Task 2).** Two processes writing one directory can still both append at a tip. The README says so, and SQL stores are the multi-process answer.
- **The checkpoint copies the package-state `append` logs into every compaction entry (Task 3).** Storage grows by the log once per compaction. In exchange, a rebuild reads one entry instead of the whole branch. Measured small on the memory-system suites.
- **A compaction rebased onto a moved tip goes without a checkpoint (Task 3).** The next snapshots on that branch read it whole until the next compaction.
- **`seq` is PostgreSQL-only (Task 4).** SQLite relies on `rowid`, so the shared schema model gained per-dialect columns.
- **Postgres batch order follows `INSERT … SELECT … ORDER BY` (Task 5).** The identity values are assigned in the `SELECT`'s output order. PostgreSQL does this in practice but does not document it as a guarantee. The order test covers 300 equal-timestamp rows.
- **JSONL `appendMany` rewrites the whole session file (Task 5).** That is cheap for fork, which writes a new file, but costs O(file) for a batch added to a long existing session.
- **Fork's fallback can leave a partial session (Task 5).** This happens only when the store has neither `appendMany` nor a working `deleteSession`. The error then names the session id.
- **Fork still reads the whole source branch (Task 5).** It copies every entry, so a tail read would not help.

## Further Actions

- **P3: append-only JSONL `appendMany` for existing sessions.** Write the batch with a single `appendFile` plus a size check, instead of rewriting the file, when the session file already exists. Handed to the backlog.
