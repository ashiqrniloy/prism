# Phase 19 Part F — session stores: single-writer appends, tail snapshots, one-statement append, and atomic fork

## Objectives

- Detect two writers on one session. An append only checks that its parent exists; the memory store's comment says tip compare-and-swap is deliberately not used (`src/session-stores.ts:354`), and the Postgres append does the same existence check (`packages/extensions/store-postgres/src/persistence.ts:510-521`). Two processes that run the same session each append at the tip they saw, and the branch silently forks.
- Stop holding and re-reading the whole branch. A snapshot is every entry of the branch, including everything before the last compaction (`snapshotFromBranch`, `src/session-stores.ts`), kept in memory per session and re-read in full on each rebuild (`session.snapshot()`, `src/agent-session/session.ts:1236`). `session.entries()` is uncached, and an `external_state` write reads the full branch every time (`:393`).
- Cut the Postgres append from eight or nine round trips per entry to one (`persistence.ts:496-603`), and stop a failing `ROLLBACK` from hiding the original error.
- Make `fork()` atomic and batched. It copies the branch one `store.append` at a time (`src/agent-session/session.ts:788-830`), so a long session costs one round trip per entry and a failure leaves a partial session.

## Expected Outcome

- A linear append carries `tip: true`. A store rejects it with `SessionAppendConflictError` when its parent already has a child that is not a branch root. The run fails with `code: "session_conflict"`; nothing is written. An append after `checkout()` to an earlier entry is a branch append and is accepted.
- The run path reads a **tail snapshot**: the newest compaction entry, the entries it keeps, and everything after it. Stores that implement `readBranchPath` answer it without reading the older part of the branch. Full reads remain for `SessionContext.entries()`, fork, and export.
- One Postgres statement per append. `list()` orders by an explicit sequence column.
- `SessionStore.appendMany` (optional) writes a batch atomically. `fork()` uses it when present, and otherwise removes the partial copy on failure.

This plan implements roadmap **Phase 19 Part F**. It changes the store contract (`SessionAppendOptions`, `SessionBranchRead`, an optional store method) and store schemas, so **Task 1 is the phase review**. It runs after plan 229. No version bump or publish. The Postgres leg needs a database: its tests run under `bun run test:postgres` as today and are not part of `bun run test`.

Cost knobs: none. Tip checking adds no round trip (it is part of the insert statement). A store without the capability keeps today's behavior and `inspect()` reports the missing capability.

## Tasks

- [ ] Task 1: Phase review (read-only)
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

- [ ] Task 2: A linear append fails when another writer has moved the tip
  - Acceptance Criteria:
    - Functional:
      - `SessionAppendOptions.tip?: boolean`. The session sets it on every append made at its current leaf, except the first append after `checkout()` to an entry that already has a child, and the entries `fork()` copies. Those are branch appends and are stored with a `branchRoot` marker.
      - A store that supports tip checking rejects a `tip: true` append whose `expectedParentId` already has a child without the marker, with `SessionAppendConflictError` carrying `expectedParentId` and the current leaf. The check and the insert are one atomic step.
      - The memory, SQLite, and Postgres stores support it. JSONL supports it within one process and documents that it does not coordinate across processes.
      - The kernel maps the conflict to a failed run with `error.code: "session_conflict"`; the session invalidates its snapshot so the next run reads the real tip.
      - `sessionStoreCapabilities` reports `tipCheck`; a store without it behaves as today.
    - Performance: No added round trip: the check is part of the insert (a partial unique index on `(session_id, parent_id)` where not branch root, in SQL stores).
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
      - Mark branch roots explicitly and let the database enforce one linear child per parent.
    - API Notes and Examples:
      ```ts
      await store.append(entry, { expectedParentId: leafId, tip: true });
      // second writer → SessionAppendConflictError { code: "session_append_conflict", currentLeafId }
      ```
    - Files to Create/Edit:
      - `src/contracts-core/session.ts`: `tip`, the capability, the entry marker
      - `src/session-stores.ts`: memory store; `sessionStoreCapabilities`
      - `src/agent-session/session.ts`: set `tip`; map the conflict
      - `packages/extensions/store-sqlite/src/{ddl,migrations,persistence}.ts`, `store-postgres/src/{ddl,migrations,persistence}.ts`, `store-jsonl/src/jsonl-store.ts`
      - `packages/extensions/store-codecs/src/persistence-schema.ts`: the column
      - `src/testing/store-conformance.ts`, `state-concurrency-conformance.ts`: tip steps
      - `scripts/compat-baseline/*.txt`: regenerated, additive diff in the task note
    - References:
      - Evaluation finding S1
  - Test Cases to Write:
    - `second_writer_at_the_same_tip_conflicts`: two session objects on one store; the second run fails with `session_conflict` and writes nothing.
    - `checkout_then_append_is_a_branch_not_a_conflict`.
    - `fork_copies_are_not_tip_checked`.
    - `conflict_invalidates_snapshot_and_next_run_sees_real_tip`.
    - `store_conformance_tip_check`: memory, SQLite, Postgres.
    - `jsonl_tip_check_within_one_process`.
    - `migration_adds_marker_without_rewriting_entries`: an existing database upgrades and reads back identically.
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

- [ ] Task 3: The run path reads a tail snapshot
  - Acceptance Criteria:
    - Functional:
      - `SessionBranchRead.from?: "compaction"` asks for the newest compaction entry on the branch, the entries its `keepEntryIds` name, every entry after it, and the entries Task 1(d) proves are still needed from before it (package state heads and a pending suspension). A branch with no compaction returns the whole branch.
      - The memory, SQLite, and Postgres stores implement it; the kernel falls back to a full read for a store that does not.
      - `session.snapshot()` uses the tail read. Its `messages` and `summaries` are identical to today's for every branch in the conformance corpus.
      - `SessionContext.entries()`, `session.entries()`, fork, and export keep reading the full branch.
      - `externalState` and package-state appends use the cached tail snapshot instead of a branch read per write.
      - The compaction path reads only what the compactor needs (the tail plus the previous summary); a compactor that asks for the full branch gets it through `context.entries`' existing shape, and the task note records which first-party compactors needed a change.
    - Performance: On Task 1's baseline session, a rebuild reads at most the tail's rows and is at least 10× faster; resident entries for the session drop accordingly. Numbers go in the task note and `docs/performance.md`.
    - Code Quality: One function builds a snapshot from a tail; `snapshotFromBranch` keeps working on a full branch and both are proven equal by a property test.
    - Security: The scope check (`entriesInScope`) still covers every returned entry; the tail query carries the ownership filter.
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
      - `src/agent-session/session.ts`: `snapshot`, `externalState`, `appendPackageState`, `compactBranch`
      - `packages/extensions/store-{sqlite,postgres}/src/persistence.ts`: the bounded recursive query
      - `src/testing/store-conformance.ts`: tail-read step
      - `packages/extensions/compaction/src/prepare.ts`: only if it relied on the full branch
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
    - `store_conformance_tail_read`: memory, SQLite, Postgres.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — an optional store read mode
    - Docs pages to create/edit:
      - `docs/slots.md`: `readBranchPath({ from: "compaction" })`
      - `docs/performance.md`: long-session numbers
      - `packages/extensions/store-{sqlite,postgres}/README.md`
      - `CHANGELOG.md`: `## [Unreleased]`, Performance
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: One Postgres statement per append
  - Acceptance Criteria:
    - Functional:
      - `append` is a single statement (data-modifying CTEs) that upserts the session row, checks the parent and the tip rule, checks the idempotency key, inserts the entry, upserts the search row, and records the idempotency key. Each failure maps to the same error as today (`SessionAppendConflictError` variants, duplicate id).
      - A failure in the statement surfaces the original error; no explicit `ROLLBACK` can replace it.
      - Entries get a monotonic `seq` (identity column); `list()` and the branch queries order by it instead of `timestamp, ctid`. A migration backfills `seq` in the existing order.
      - Session-link columns are updated in the same statement when the entry is the links entry.
    - Performance: One round trip per append (was eight or nine). The task note records append latency at 1 ms and 20 ms network delay before and after.
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
      - One CTE statement; conflicts detected from which CTE returned no row.
    - API Notes and Examples:
      ```sql
      WITH s AS (INSERT INTO sessions … ON CONFLICT … RETURNING id),
           p AS (SELECT 1 FROM entries WHERE id = $parent AND session_id = $sid),
           e AS (INSERT INTO entries … SELECT … WHERE EXISTS (SELECT 1 FROM p) OR $parent IS NULL RETURNING id)
      SELECT (SELECT count(*) FROM e) AS inserted, (SELECT count(*) FROM p) AS parent_found;
      ```
    - Files to Create/Edit:
      - `packages/extensions/store-postgres/src/{persistence,ddl,migrations}.ts`
      - `packages/extensions/store-postgres/src/__tests__/…`: append and migration tests (Postgres leg)
    - References:
      - Evaluation finding S2
  - Test Cases to Write:
    - `append_is_one_round_trip`: a pool spy counts queries.
    - `append_errors_are_unchanged`: missing parent, tip conflict, idempotency duplicate, duplicate id.
    - `statement_failure_surfaces_the_original_error`.
    - `seq_orders_entries_written_in_the_same_millisecond`.
    - `migration_backfills_seq_in_existing_order`.
    - Store conformance passes on Postgres (`bun run test:postgres`).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no API change; a schema migration
    - Docs pages to create/edit:
      - `packages/extensions/store-postgres/README.md`: the migration and the ordering column
      - `CHANGELOG.md`: `## [Unreleased]`, Performance
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: `fork()` is atomic and batched
  - Acceptance Criteria:
    - Functional:
      - `SessionStore.appendMany?(entries, options)` writes all entries or none. Memory, SQLite, and Postgres implement it; JSONL writes the new session file in one write and renames it into place.
      - `session.fork()` builds the copied entries in memory and calls `appendMany` once. With a store that lacks it, fork appends one by one and, on any failure, removes the partial session (`deleteSession` when available) before rethrowing; without `deleteSession` the error names the partial session id.
      - The forked session's content, links, ownership stamps, and the exclusion of `suspended_run` entries are unchanged.
    - Performance: One round trip for a fork on SQL stores. A 5,000-entry fork on Postgres completes in one statement batch; the task note records before and after.
    - Code Quality: `appendMany` shares the single-entry validation; no second code path for ownership stamping.
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

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
