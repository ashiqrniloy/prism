# Phase 11 Part O18 — Memory system: short-term memory (scope-blind events, verbatim chunks, habituation)

## Objectives

- Turn the session tier's encoder into **STM**: it passively records what happens (requests, actions, results, changes, decisions, outcomes, errors, statements), each event with an id and a description detailed enough for a later model to judge usefulness from the description alone (design §5.2).
- Back events with **verbatim chunks** in a deletable local chunk store. Chunks are reference-counted across STM, WM, LTM and forked sessions, so later tiers can delete surface without losing what another tier still cites.
- Add **habituation** (repeated identical events collapse into one) and **event boundaries** (outcome, task-state change, user turn after an idle gap) as triggers.
- Measure STM live against the pre-redesign observer (gate M-1, rows S1–S4).

## Expected Outcome

- An STM encoder that records events, never sees the episode scope, and closes every task with an `outcome` event naming what changed and how it was verified.
- `chunks.ts`: verbatim validation, redaction, caps, a SQLite chunk store (mode 0600) with hard delete and vacuum, and reference counts by referrer and session.
- `memory.recall`-ready reads of session ids. Plan 219 unifies the surface; this plan extends the existing session `recall` tool.
- An offline long-session coding fixture and STM mechanism probes.
- Gate M-1's verdicts on S1–S4 in `docs/_evidence/memory-bench/217/`.

This implements roadmap Phase 11 "Memory model", part STM, after plan 216. It carries the requirements of plan 210 Task 7.3 (dropped 2026-11-08), adapted to the new taxonomy. **No review task:** the changes are inside `@arnilo/prism-memory-system`, with no kernel contract and no package created or moved. Plan 216 Task 1 reviewed the seams used here (`session.background`, `prism.state.log`, the `compaction` slot). No version bump and no publish.

## Tasks

- [x] Task 1: The STM encoder records events, not facts, and never sees the scope
  - Acceptance Criteria:
    - Functional: **Role.** The default STM instruction (today `DEFAULT_OBSERVER_INSTRUCTION`, moved from `observer.ts:17`) is rewritten to record every meaningful thing in the batch, in order:
      - user requests and statements;
      - actions (tool calls, commands, files read or edited);
      - results (tool output, test results, errors);
      - decisions and their reasons;
      - task outcomes.

      Each description is self-contained enough that a later model, seeing only the description, can judge whether the event and its chunks help a new task. The prompt no longer says "Find durable source-backed facts".
    - Functional: **Record shape.** `record_event` (replacing `record_observation`, no alias) takes `kind` (`request | action | result | change | decision | outcome | error | statement`), `description` (one line; `content` is renamed, no alias), `sourceEntryIds` (required), `referencedAt`, `relevance` and `supersedes`. The `chunks` argument (≤ `stm.maxChunksPerEvent`) lands in Task 2 with the store that holds them (amended 2026-11-09: accepting chunks with nowhere to put them would drop them silently). The stored record gains `kind`, `chunkRefs` (id, source entry id, sha256, bytes), `count` and `lastAt`.
    - Functional: **Outcome events.** When a task or subtask completes or is abandoned, STM records an `outcome` stating:
      - what was asked;
      - what changed (files, symbols, commands, config keys, ids);
      - what was achieved or left open;
      - how it was verified.

      The prompt requires it, and the probe in Task 6 checks it.
    - Functional: **Scope-blindness (I1).** An STM request contains only the batch, the task state and an index of recent STM records (id, kind, first 120 characters) within `stm.contextTokens` (4,000, tuning). It never contains the episode scope, a WM item or an LTM note. A test fails if a scope or LTM string appears in an STM request.
    - Functional: **De-duplication** uses `supersedes`, not re-recording; the index tells the model so.
    - Functional: **Task state** stays an STM output (`record_task_state`, unchanged).
    - Functional: **Consumers move in the same task.** The LTM promotion path (`ltm/consolidation/gather.ts`), the WM worker (today's reflector) and the render read the new shape (`kind`, `description`), so the tree stays green until plans 218–219 replace them. The bench `variants.mjs` patches are updated.
    - Performance: Reports STM output tokens per 10k eligible tokens on the offline fixture, against the pre-redesign observer, using the same fixture and the mock provider's token counter. **Moved to Task 5** (amended 2026-11-09): the fixture is built there. Task 1 states the prompt-side cost: the default instruction is 1,050 bytes (the observer's was ~650), and the recent index is bounded by `stm.contextTokens`.
    - Code Quality: `content` → `description` with no alias. The compat baseline is regenerated and attributed.
    - Security: The instruction treats transcript content as data. Redaction is unchanged.
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/system/src/session/workers/observer.ts` (moved from `observational/src/workers/observer.ts:17-180`);
      - `flush.ts:100-133` (the observer's view);
      - plan 210 Task 7.3 (dropped; carried);
      - design §5.2.
    - Options Considered:
      - Keep facts in STM. Rejected by the owner: STM records what happened, and facts are derived later (WM, Rehearsal).
    - Chosen Approach:
      - Event records with kinds, required outcomes and a scope-blind request.
    - API Notes and Examples:
      ```ts
      { kind: "outcome", description: "Campaign retries: interrupted attempts no longer count toward maxAttempts (campaign.mjs retryUncounted); 35 campaign tests pass.",
        sourceEntryIds: ["e41","e47"], chunks: [{ sourceEntryId: "e47", text: "Ran 35 tests across 3 files. 0 fail" }], relevance: "high" }
      ```
    - Files to Create/Edit:
      - `packages/memory/system/src/session/{workers/stm,types,flush,render,config,recall,normalize,exports}.ts`, `workers/{reflector,dropper}.ts` and tests (new `__tests__/stm.test.ts`);
      - `src/ltm/consolidation/gather.ts` and tests;
      - `scripts/memory-bench/{variants,replay,defaults.json,run.test,observational-live.test}.mjs`, `lifecycle/{suite,synth}.mjs`, `mechanism-probes/om.mjs`, `variants.test.mjs`; `scripts/fixtures/e2e-070-host-completeness-journey.mjs`;
      - `examples/{session-memory,memory-system,memory-and-wiki,autonomous-coding-loop,revocation-propagation}.ts` and the regenerated host-builder index;
      - the README (`### Short-term memory`); CHANGELOG; the compat baseline.
    - References:
      - owner direction 2026-11-08 (plan 210 Task 7.3, carried).
  - Test Cases to Write:
    - `stm_prompt_records_events_not_facts`.
    - `stm_request_never_contains_scope_wm_or_ltm_text`.
    - `outcome_event_names_changes_and_verification`.
    - `stm_sees_recent_index_within_budget_and_uses_supersedes`.
    - `consumers_read_event_shape`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — tool schema, record shape.
    - Docs pages to create/edit:
      - the package README (`## Short-term memory`); CHANGELOG.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-09):
    - **What changed.** `workers/observer.ts` → `workers/stm.ts` (`runObserver` → `runStm`, `DEFAULT_OBSERVER_INSTRUCTION` → `DEFAULT_STM_INSTRUCTION`; all internal, `root-exports.test.ts` updated). The tool is `record_event` (`kind` required, `description`, `sourceEntryIds`, `referencedAt`, `relevance`, `supersedes`); a bad kind answers `invalid_kind`, an empty description `empty_description`. The record id hashes `kind:description` with the source ids. `MemoryObservation` gains `kind`, optional `chunkRefs` (`MemoryChunkRef`: id, sourceEntryId, sha256, bytes), `count` (written as 1) and `lastAt`; `content` → `description`. `MemoryEventKind` and `MemoryChunkRef` are exported as types. New config `stm.contextTokens` (4,000, tuning). The flush passes `recent` (every active STM record) and `stmRecentIndex` keeps the newest lines (`[id] kind: first 120 chars…`) that fit the budget, shown oldest first. Before, the prompt carried the full text of the records within `rehearsal.targetTokens / 4`. `normalize.ts` holds `normalizeEventText`, which Task 3's habituation reuses. Consumers: render `(relevance) kind: description`; the reflector and dropper prompt lines and recall show `kind: description` (recall adds `×N` when `count > 1`); LTM `gather.ts` promotes `description`.
    - **Scope-blindness test.** `stm_request_never_contains_scope_wm_or_ltm_text` runs a real agent. A probe package injects sentinel scope and LTM blocks through `context.build`, which is how those tiers reach the main model, and the reflector records a WM sentinel. The test asserts that the main request carries the scope sentinel and that no STM request carries any of the three. Known gap: if the main agent itself calls `memory.recall`, the tool result is transcript data, so the next STM batch sees it. Filtering tool results by origin is left to plan 219, which unifies recall.
    - **Findings for later tasks.** (1) Ledger records without `kind` or with `content` fail `isMemoryObservation` and the fold skips them silently. There is no reader, which the experimental line allows. Only sessions written between plan 216 Task 4 and now are affected. (2) `scripts/memory-bench/replay.mjs` `workerKind` also accepts `record_observation`, so Task 6's `OM-before` arm (pinned pre-216 source) is still counted as an STM worker. (3) `record_observation` is a worker-internal tool, not an agent-facing one, so it is not added to `scripts/retired-tool-names.json`. (4) `packages/knowledge/wiki` holds a `file:` copy of memory-system in its `node_modules`, so a moved file needs `bun install` before `typecheck` passes there (bun.lock unchanged).
    - **Baseline diff** (`arnilo__prism-memory-system.txt`, attributed to this task): `+ MemoryChunkRef`, `+ MemoryEventKind`; `MemoryObservation` `- content` `+ description, kind, chunkRefs?, count?, lastAt?`; `MemorySessionConfig.stm` and `ResolvedMemorySystemConfig.stm` `+ contextTokens`. No removals beyond the `content` rename.
    - **Sweep.** `bun scripts/retired-names.mjs`: 0 hits in 2068 files.
    - **Checks.** Package typecheck clean. Repo `bun run typecheck` is clean after `bun install`. `packages/memory/system` tests: 661 pass, 2 fail. The 2 are `no_workspace_imports_prism_memory_family` and `removed_memory_names_absent_repo_wide`, both tripped by the untracked `scripts/retired-names.json` that was already in the tree. `bun test scripts/memory-bench`: 8 failures on the first run, all from old-shape fixtures (now fixed). The three affected files rerun green (37 pass); the full suite was not rerun. `src/__tests__/docs.test.ts`: 69 pass. Examples `session-memory`, `memory-system`, `memory-and-wiki` and `revocation-propagation` pass. Failures that already existed and are not from this task: `examples/autonomous-coding-loop.ts` (`setup_failed`, fails identically without this change), `scripts/fixtures/e2e-070-host-completeness-journey.mjs` (`episode_kind_not_available`, plan 216 Task 7), and `@arnilo/prism-agent` `evals.test.ts` (2 fails on the `approval_before_effect` invariant, no memory involvement).

- [x] Task 2: The chunk store — verbatim, redacted, capped, deletable, reference-counted
  - Acceptance Criteria:
    - Functional: **Chunks argument (moved from Task 1, 2026-11-09).** `record_event` gains `chunks` (optional, ≤ `stm.maxChunksPerEvent`, tuning), and the stored record fills `chunkRefs` (the field and its validator landed in Task 1).
    - Functional: **Verbatim check.** A chunk `{ sourceEntryId, text }` is accepted only if `text`, after whitespace normalisation, is a substring of that entry's serialized content. Otherwise the tool answers `ok: false`, `chunk_not_verbatim`.
    - Functional: **Caps and redaction.** Each chunk is capped at `stm.maxChunkBytes` (4 KB, tuning) and redacted with the session's secrets before it is written. A truncation marker never contains the truncated bytes.
    - Functional: **Never on the branch.** Chunks go to a `ChunkStore` (`put`, `get`, `ref`, `unref`, `apply`, `list(sessionId)`) owned by the package. The default is a SQLite store opened through memory-core's local store helper (`openSqliteDatabase`, mode 0600): a file in the host's data directory when the host names one (`stm.chunkStore: { sqlite: { path } }`), else in memory for the process lifetime. A package may supply another as the `memory.chunks` service. The ledger carries only `chunkRefs`. (Amended 2026-11-09: the package API exposes no host data directory, so the host names the path and the default without one is `"memory"`; `delete` is not on the contract, see below; `apply` runs a pass's ops in one transaction.)
    - Functional: **Reference counting (I3).**
      - A chunk has referrers: an STM record, a WM item or an LTM note, each with a session id.
      - `unref` removes one referrer. At zero referrers the chunk is hard-deleted in the same transaction, and the store vacuums or uses `secure_delete` so the bytes leave free pages.
      - A forked session's referrers are added at fork, so the parent's drop cannot delete a chunk the child still holds.
    - Functional: **Only referrer removal deletes.** No code calls `delete` directly. `delete` is a method of the default store only (not of the `ChunkStore` contract), internal to the zero-referrer path, and a test spies on it across a live agent run and scans the sources for other calls.
    - Performance:
      - One store transaction per pass.
      - The default caps keep stored chunks under 25% of the transcript bytes they cover: enforced as a fixed rule per batch (`MAX_CHUNK_SHARE`, `chunk_budget_exceeded`). Chunk bytes stored per 10k eligible tokens on the fixture move to Task 5 (amended 2026-11-09: the fixture is built there).
      - `context.build` cost is unchanged.
    - Code Quality: One module (`chunks.ts`) owns validation, the contract and the default store.
    - Security:
      - Chunks never enter the context block or shared stores.
      - Recall reads only chunks referenced by the executing session or its ancestors. A fork copies its ancestors' referrers when it opens, so `get(id, sessionId)` checks the executing session only.
      - The SQLite file is created 0600.
  - Approach:
    - Documentation Reviewed:
      - `src/packages/api.ts:153-166` (`state.log` is append-only, so chunks cannot live there);
      - `packages/memory/core/src/sqlite/index.ts`;
      - plan 210 Task 7.3 (carried).
    - Options Considered:
      - Offsets into raw entries. Rejected: no independent redaction or deletion, and offsets dangle if a host prunes entries.
      - Per-tier copies of chunks. Rejected: storage multiplies, and deletion becomes per-copy.
    - Chosen Approach:
      - One reference-counted store shared by every tier.
    - API Notes and Examples:
      ```ts
      interface ChunkStore { put(c: ChunkInput): Promise<ChunkRef>; ref(id: string, by: Referrer): Promise<void>; unref(id: string, by: Referrer): Promise<{ deleted: boolean }>; get(id: string, session: string): Promise<Chunk | undefined>; }
      ```
    - Files to Create/Edit:
      - `packages/memory/system/src/chunks.ts` (new) and `src/__tests__/chunks.test.ts` (new);
      - `src/session/{workers/stm,flush,setup,config}.ts`, `src/index.ts`; `src/session/__tests__/{workers,root-exports}.test.ts`;
      - `packages/memory/core/src/sqlite/index.ts` (`openSqliteDatabase`) and `src/__tests__/root-exports.test.ts`;
      - `scripts/memory-bench/defaults.json`, `scripts/memory-bench/lifecycle/label.mjs`;
      - the README (`### Chunks`, configuration and stability tables, cost table, stable exports); both CHANGELOGs; the compat baselines.
    - References:
      - design I2–I3.
  - Test Cases to Write:
    - `chunk_must_be_verbatim_substring_of_cited_entry`.
    - `chunk_is_redacted_capped_and_never_on_the_branch`.
    - `zero_referrers_hard_deletes_and_bytes_leave_the_file`.
    - `fork_referrers_keep_parent_dropped_chunk_alive`.
    - `only_referrer_removal_reaches_delete`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new store contract and config.
    - Docs pages to create/edit:
      - the README (`## Chunks`, `## Cost, security, and failure behavior`); CHANGELOG.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-09):
    - **What changed.** `src/chunks.ts` owns the mechanism. `prepareChunks` does the verbatim check: the chunk must cite a batch entry, and its redacted, whitespace-normalised text must be a substring of the entry's serialized line or of its string fields joined (the second form accepts real newlines where the serialized JSON shows `\n`). `capChunk` cuts to `stm.maxChunkBytes` with a marker naming sizes only. `SqliteChunkStore` has two tables (`chunks`, `chunk_referrers` keyed by chunk, kind, referrer id and session), `application_id` `PCK1` (another schema fails closed) and `secure_delete = ON`. `createChunkStoreHandle` opens the store lazily (the `memory.chunks` service, else the default) and queues every operation in call order. The chunk id is the first 24 hex digits of the sha256 of the stored text, so identical text shares one row with several referrers. `record_event` gains `chunks` (omitted from the schema when `maxChunksPerEvent` is 0). A bad chunk refuses the whole event (`chunk_not_verbatim`, `chunk_unknown_entry`, `too_many_chunks`, `empty_chunk`, `invalid_chunks`, `chunk_budget_exceeded`). New config: `stm.maxChunksPerEvent` (2, at most 8, tuning), `stm.maxChunkBytes` (4,096, 256 to 65,536, tuning), `stm.chunkStore` (contract). The flush collects the pass's puts, then in a `finally` adds unrefs for every record newly in `droppedObservationIds` (supersedes and rehearsal), and applies them in one transaction after the ledger appends. A failed write leaves a dangling ref, never an unreferenced chunk. `session.opened` with `restored: true` (fork or resume) queues `ref` ops for the active records' chunks under the new session id. The fork hook is not awaited by the kernel, but the queue orders it before any later parent drop. `ref` on a deleted chunk is a no-op, so a fork cannot resurrect one. The default STM instruction gains one sentence on chunks and is now 1,230 bytes (was 1,050).
    - **Tests.** `src/__tests__/chunks.test.ts` covers the five named cases. Three of them (`chunk_is_redacted_capped_and_never_on_the_branch`, `fork_referrers_keep_parent_dropped_chunk_alive`, `only_referrer_removal_reaches_delete`) run a live agent whose store comes through the `memory.chunks` service, which also tests the host-supplied path. `zero_referrers_hard_deletes_and_bytes_leave_the_file` asserts mode 0600 and that no file in the directory still holds the chunk bytes after the last unref.
    - **Findings for later tasks.** (1) WM consumption (`consumedObservationIds`) does not unref: only drops do. Plan 218 decides whether a WM item takes over the referrer. (2) Recall (Task 4) needs the store handle: `createObservationalRecallTool` must receive `chunks` from `setup.ts`, and `get(id, session.id)` already enforces the session check. (3) With the default `"memory"` store, chunks do not survive a process restart, and recall after a resume reports them as dropped. A host that wants them across restarts sets `stm.chunkStore.sqlite.path`. (4) Fork remaps entry ids, so a `chunkRef.sourceEntryId` (like `sourceEntryIds`) names the parent's entry in a forked session. This was already true of `sourceEntryIds`. (5) `scripts/memory-bench/lifecycle/label.mjs` still read `content` from STM records (a Task 1 leftover the unrerun full bench suite missed). It now reads `description ?? content`: observations have `description`, reflections still `content`. (6) `packages/knowledge/wiki` needed `bun install` again for its `file:` copy to see the new `chunks.ts` (bun.lock unchanged).
    - **Baseline diff** (attributed to this task). `arnilo__prism-memory-core.txt`: `+ ./sqlite#openSqliteDatabase`. `arnilo__prism-memory-system.txt`: `+ ChunkOp, ChunkPrepareFailure, ChunkReferrer, ChunkStore, ChunkStoreLocation, MEMORY_CHUNK_STORE_SERVICE, PreparedChunk, SqliteChunkStore, StoredChunk, createSqliteChunkStore`; `MemorySessionConfig.stm` and `ResolvedMemorySystemConfig.stm` gain `maxChunksPerEvent`, `maxChunkBytes`, `chunkStore`. No removals.
    - **Sweep.** `bun scripts/retired-names.mjs`: 0 hits in 2069 files.
    - **Checks.**
      - Package typecheck and repo `bun run typecheck` are clean (after `bun install`).
      - `packages/memory/system` tests: 666 pass, 2 fail. Both failures are the ones Task 1 recorded, tripped by the untracked `scripts/retired-names.json`.
      - `packages/memory/core` tests: 75 pass.
      - `bun test scripts/memory-bench`: 550 pass, 1 fail. The failure is `markdown_store_write_amplification_within_budget`, a timing ratio (3.19 > 2.75) that passes when run alone.
      - `src/__tests__/docs.test.ts`: 69 pass.
      - The examples `session-memory`, `memory-system`, `memory-and-wiki` and `revocation-propagation` pass.
      - `apps/prism-agent` memory and context tests: 15 pass.
      - `biome check` is clean on the new and edited source files. `biome check --write`, run on `src/session`, also re-sorted imports in files Task 1 had already changed; this was formatting only.
      - `release.mjs gate --update-baseline`: additive only.

- [x] Task 3: Habituation and event boundaries
  - Acceptance Criteria:
    - Functional: **Habituation.**
      - When an event's `kind` and normalised description match an active STM record within the habituation window (`stm.habituation.windowEvents`, 50, tuning) and the new chunks are byte-equal (or absent), the package increments `count` and updates `lastAt` instead of adding a record.
      - The rendered line shows `×N`.
      - A changed result (different chunk bytes) is a new event.
      - `stm.habituation: false` turns it off.
    - Functional: **Boundaries.** STM records a `boundary` marker on:
      - an `outcome` event;
      - a task-state change;
      - a user turn after an idle gap ≥ `stm.boundaryGapMinutes` (10, tuning).

      The markers are what plan 218's WM trigger reads. With `stm.boundaries: true`, an idle-gap user turn runs an STM pass even below `stm.triggerTokens`. (Amended 2026-11-09: an outcome or a task-state change is known only from an STM pass's output, so its marker comes out of a pass that already runs. Running a pass for it would need a model to judge every turn, which the Options reject. The idle gap is the one boundary visible before any call.)
    - Performance:
      - Habituation is a string comparison per new event; no model call.
      - The fixture reports STM records saved by habituation.
      - Boundary passes add at most one STM call per boundary. The README states that cost and the `stm.boundaries: false` default that avoids it.
    - Code Quality: Normalisation lives in one helper shared with de-duplication.
    - Security: n/a — no new data leaves the package.
  - Approach:
    - Documentation Reviewed:
      - design §5.2 and §3 (habituation);
      - Zacks et al. 2007 and Nemori (event segmentation);
      - `flush.ts` triggers.
    - Options Considered:
      - Model-judged boundaries. Rejected: costs a call per turn; the deterministic signals cover the cases the design names.
    - Chosen Approach:
      - Deterministic habituation and boundaries.
    - API Notes and Examples:
      ```ts
      memorySystem({ stm: { habituation: { windowEvents: 50 }, boundaryGapMinutes: 10 } });
      ```
    - Files to Create/Edit:
      - `packages/memory/system/src/session/{flush,ledger,render,config,types,exports,workers/stm}.ts`, new `__tests__/habituation.test.ts`, `__tests__/root-exports.test.ts`;
      - `scripts/memory-bench/defaults.json`; `examples/{session-memory,memory-and-wiki}.ts` and `src/__tests__/docs.test.ts` (the demos' mock observers repeat one event);
      - README; CHANGELOG; the compat baseline.
    - References:
      - design §5.2.
  - Test Cases to Write:
    - `repeated_identical_event_increments_count`.
    - `changed_result_is_a_new_event`.
    - `outcome_or_task_state_change_runs_a_boundary_pass` (asserts the markers, and that they add no STM call).
    - `idle_gap_user_turn_runs_a_boundary_pass_below_trigger` (added 2026-11-09).
    - `habituation_off_records_every_event`.
    - `habituation_window_and_config_defaults` (added 2026-11-09).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — config and rendering.
    - Docs pages to create/edit:
      - README (`## Short-term memory`, cost); CHANGELOG.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-09):
    - **What changed.**
      - **Habituation** is in `runStm`'s `record_event`. It runs after the chunk check and before the chunk budget, so a repeat's chunks cost no budget and are not stored again.
      - A match needs the same `kind`, the same `normalizeEventText` description (the Task 1 helper, shared with the stored form), and chunk sha256 sets that are equal, or no chunks on the new event. It compares against the newest `windowEvents` of the active records still known in the batch plus the batch's own events, newest first. So an event with no chunks joins the newest identical record.
      - A match inside the batch rewrites that pending event with `count + 1`. A match against the ledger emits `memory.session.observations.repeated` (`OBSERVATIONS_REPEATED`: `observationId`, absolute `count`, `lastAt`, `sourceEntryIds`). The fold keeps the largest count, so a repeat folded twice, or next to a folded copy, cannot over-count.
      - The tool answers `{ ok: true, habituated, count }`. A `supersedes` on a repeat is ignored with a warning. The render and the STM recent index show `kind ×N`.
      - **Boundaries.** `memory.session.boundary.recorded` (`BOUNDARY_RECORDED`: `reason` `outcome | task_state | idle_gap`, `entryId`, `recordId?`, `gapMinutes?`, `at`). There is one marker per `(reason, entryId)` (`boundaryKey`), and the ledger exposes them as `boundaries`.
      - An outcome marker is written for each new outcome event (`entryId` is its last source id). A task-state marker is written when goal, open questions, decisions or next steps change. The id cannot be used for this because it hashes the batch's source ids and so changes on every pass.
      - `idleGapBoundaries` marks a user message that comes at least `boundaryGapMinutes` after the previous eligible message. Package records written in the background do not count as activity. The marker is recorded even when STM does not run, and a later pass skips it by key. With `stm.boundaries: true` the gap also runs the STM pass below the trigger.
      - New config: `stm.habituation` (`false | { windowEvents }`, default 50, 1 to 1,000; the field is contract, `windowEvents` is tuning), `stm.boundaries` (default `false`, contract) and `stm.boundaryGapMinutes` (default 10, 1 to 10,080, tuning).
      - The default STM instruction gains one sentence on repeats and is now 1,378 bytes (was about 1,230).
    - **Findings for later tasks.**
      1. The demos' mock observers record the same `statement` on every pass, so habituation collapsed them. `examples/memory-and-wiki.ts` now stores 1 observation with count 2, and `docs.test.ts` expects that. `examples/session-memory.ts`'s mock now names its source entry so each turn records its own event. Any scripted observer in the bench that repeats one description will now see counts instead of records. Task 5's fixture should rely on that for its polling and repeated-failure cases.
      2. Plan 218's WM trigger reads `ledger.boundaries` and keeps its own cursor over them. Markers carry no "consumed" state.
      3. A repeat keeps the original record's `sourceEntryIds` in the fold. The repeat record holds the new ids for audit, but recall (Task 4) shows only the original's. Task 4 may list the repeat ids under `detail: "full"`.
      4. `packages/knowledge/wiki` needed `bun install` again (Task 1 finding 4) before the repo typecheck passed.
    - **Baseline diff** (`arnilo__prism-memory-system.txt`, this task only, from the gate before `--update-baseline`): `+ BOUNDARY_RECORDED, BoundaryRecordedData, MemoryBoundary, MemoryBoundaryReason, OBSERVATIONS_REPEATED, ObservationsRepeatedData`. `MemorySessionConfig.stm` and `ResolvedMemorySystemConfig.stm` gain `habituation`, `boundaries` and `boundaryGapMinutes`. `ObservationalMemoryLedger` gains `boundaries?` (compatible). No removals. The working-tree diff of the baseline files also holds the earlier uncommitted tasks.
    - **Sweep.** `bun scripts/retired-names.mjs`: 0 hits in 2069 files.
    - **Checks.**
      - Package typecheck and repo `bun run typecheck` are clean (after `bun install`).
      - `packages/memory/system` tests: 672 pass, 2 fail. These are the two failures Task 1 recorded, caused by the untracked `scripts/retired-names.json`.
      - `habituation.test.ts`: 6 pass.
      - `src/__tests__/docs.test.ts`: 69 pass.
      - The examples `session-memory`, `memory-system`, `memory-and-wiki` and `revocation-propagation` pass.
      - `bun test scripts/memory-bench`: 549 pass, 2 fail. `config_defaults_match_evidence` was fixed (`defaults.json`) and passes on rerun. `markdown_store_write_amplification_within_budget` is the timing ratio Task 2 recorded (2.79 > 2.75) and passes when run alone.
      - `apps/prism-agent` memory and context tests: 15 pass.
      - `biome check` is clean on `src/session`. Formatting findings in `docs.test.ts` and an import-order finding in `session-memory.ts` were already there, in lines this task did not touch.
      - `release.mjs gate` was additive only, then run with `--update-baseline`.

- [x] Task 4: Recall reads events, chunks and tombstones
  - Acceptance Criteria:
    - Functional: **Recall by id.** The session `recall` tool (until plan 219 Task 4 folds it into `memory.recall`) with an STM id returns:
      - the description, kind, time, count and source ids;
      - every chunk verbatim;
      - for an unreferenced chunk, `chunk dropped: <reason>`.

      With `detail: "full"`, it also returns the raw source entries. (Amended 2026-11-09: the summary no longer carries them, so this changes the default recall output.)
    - Functional: **No re-running.** A test reads a tool result's chunk through `recall` after the original entry left context, and asserts that no tool other than `recall` ran.
    - Functional: **Tombstones.** A record whose surface was removed (by plan 218's WM) is still found by id, with `state: "tombstoned"` and its reason. This task adds the state and its rendering; WM sets it. (Amended 2026-11-09: the state is a new ledger record, `memory.session.observations.tombstoned`, since nothing else could carry it.)
    - Functional: **The surface never renders chunk text.** Only the `[chunk]` marker appears.
    - Performance: Recall by id is one ledger fold, already in memory, plus one chunk-store read per chunk.
    - Code Quality: `recall.ts` reads through `chunks.ts` only (the `ChunkStoreHandle` that `setup.ts` creates, passed to the recall tool; Task 2 finding 2).
    - Security: The session check in `chunks.get`. A forged id fails with `unknown_id` and does not reveal whether it exists in another session.
  - Approach:
    - Documentation Reviewed:
      - `src/session/{recall,recall-tool}.ts` (moved from `observational/src/recall.ts`, `recall-tool.ts`).
    - Options Considered:
      - Wait for plan 219's unified recall. Rejected: S2 is measured at gate M-1.
    - Chosen Approach:
      - Extend today's tool now; plan 219 moves it.
    - API Notes and Examples:
      ```json
      { "tool": "recall", "input": { "id": "a1b2c3d4e5f6" } }
      ```
    - Files to Create/Edit:
      - `packages/memory/system/src/session/{recall,recall-tool,render,types,ledger,setup,exports}.ts`; tests: new `__tests__/recall-chunks.test.ts`, `recall.test.ts`, `root-exports.test.ts`;
      - README (`### Recall`, contributions, ledger, context block, stable names); CHANGELOG; the compat baseline.
    - References:
      - design §5.8.
  - Test Cases to Write:
    - `recall_returns_tool_result_chunk_without_rerunning_any_tool`.
    - `recall_reports_dropped_chunk_with_reason`.
    - `tombstoned_record_found_by_id`.
    - `context_block_never_renders_chunk_text`.
    - `forged_id_from_other_session_is_unknown`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — recall output.
    - Docs pages to create/edit:
      - README (`## Recall`); CHANGELOG.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-11-09):
    - **What changed.**
      - `recall.ts`: an STM record's recall prints the kind, `×N`, description, `time` (plus `last seen` once repeated, and `refers to`), `sources`, then a `Chunks:` list. Each chunk is either verbatim (`[chunk <id>] from <entry>, <bytes> bytes:` followed by the text) or `chunk dropped: <reason>`.
      - `Source evidence:` and the value's `sourceEntries` now come only with `detail: "full"`. Reflection and task-state recall are unchanged.
      - The value gains `state` (`active | dropped | reflected | tombstoned`), `tombstone` and `chunks` (`RecalledChunk`: the ref plus `text` or `dropped`). The text shows `(dropped)` and `(reflected)` together when both apply.
      - Drop reasons come from the fold: `record superseded by <id>`, `record dropped` (rehearsal or compaction), or `record tombstoned (<reason>)`. An active record whose chunk the session cannot read gets "no referrer in this session's chunk store".
      - `RecallMemoryOptions` gains `detail`, `ledger` (a fold the caller already did) and `chunkTexts`.
      - `recall-tool.ts` takes `chunks` (the `ChunkStoreHandle` that `setup.ts` creates). It folds the ledger once, reads each of the record's chunks with `store.get(id, session.id)` inside one queued `run`, and passes both to `recallObservationalMemory`. It opens the store only when the record has chunks. If the store cannot be read, the chunks are listed as `(not read)` and the call still succeeds.
      - An id not in the session's ledger answers `unknown_id` (was `not_found`), with one text for every such id.
      - **Tombstones.** The new record `memory.session.observations.tombstoned` (`OBSERVATIONS_TOMBSTONED`; `observationIds`, `reason` 1–200 characters, `at`) folds into `ledger.tombstones`. The fold also exposes `ledger.dropReasons`. `activeObservations` excludes tombstoned records, so they leave the context block, the STM index and the flush.
      - **Render.** A record with chunks ends with ` [chunk]`. The header says what `[chunk]` means (+90 bytes per block).
    - **Tests.** `recall-chunks.test.ts` covers the five named cases. Three of them run a live agent: the main model calls `run_build`, STM records a `result` with a chunk of the tool output, then `session.compact()` (with `context.recentMessages: 0`) removes the output from the provider view.
      - `recall_returns_tool_result_chunk_without_rerunning_any_tool` asserts the output left the request and the block marks the record `[chunk]`. It asserts that the main session's only `tool.call` after that is `recall`, that `run_build` ran once, and that the recall result carries the chunk verbatim.
      - `forged_id_from_other_session_is_unknown` compares a second session's recall of the first session's id with a never-issued id.
      - `recall.test.ts` now expects `unknown_id` and passes `detail: "full"` where it asserts source entries.
    - **Findings for later tasks.**
      1. Plan 218 writes `OBSERVATIONS_TOMBSTONED` and decides chunk referrers. A tombstone removes no referrer, so a tombstoned record's chunks stay readable until WM unrefs them or moves them to a WM item (Task 2 finding 1).
      2. Plan 219 moves this tool into `memory.recall`. The `unknown_id` text and the per-session `get` are the behaviour to keep.
      3. Task 3 finding 3 (repeat source ids under `detail: "full"`) was not done: the fold keeps only the latest count and `lastAt`, not the repeat ids. Recall shows the original's sources.
      4. `scripts/memory-bench/feature-ledger.test.mjs` fails to load with 17 `fabric:` config problems. These come from plan 216's renames, not from this plan, and the suite count does not show it as a failing test.
    - **Baseline diff** (`arnilo__prism-memory-system.txt`, this task, from the gate before `--update-baseline`): additive. `+ MemoryTombstone, OBSERVATIONS_TOMBSTONED, ObservationsTombstonedData`; `ObservationalMemoryLedger` compatible (`+ dropReasons?, tombstones?`). No removals. The recall result types stay internal.
    - **Sweep.** `bun scripts/retired-names.mjs`: 0 hits in 2069 files. `not_found` was a result reason, not a retired name.
    - **Checks.**
      - Package typecheck and repo `bun run typecheck` are clean.
      - `packages/memory/system` tests: 677 pass, 2 fail. These are the two failures Task 1 recorded, caused by the untracked `scripts/retired-names.json`.
      - `recall-chunks.test.ts`: 5 pass, and 5 pass on each of three reruns.
      - `bun test scripts/memory-bench`: 550 pass, 1 fail. The failure is the `markdown_store_write_amplification_within_budget` timing ratio Task 2 recorded.
      - `src/__tests__/docs.test.ts`: 69 pass.
      - The examples `session-memory`, `memory-system`, `memory-and-wiki` and `revocation-propagation` pass.
      - `apps/prism-agent` memory and context tests: 15 pass.
      - `biome check` is clean on `src/session` and `chunks.ts`.
      - `release.mjs gate` was additive only, then run with `--update-baseline`.

- [x] Task 5: The offline long-session fixture and STM mechanism probes
  - Acceptance Criteria:
    - Functional: **Fixture.** `scripts/memory-bench/fixtures/memory-model/long-session/` is a replayed coding session of at least 6 tasks over at least 200 entries, offline and free. It contains:
      - a plan document (used as the scope from plan 218 on) whose later steps depend on earlier ones;
      - related task pairs;
      - a large tool result;
      - a code read;
      - a user preference stated once;
      - a superseded fact;
      - a repeated benign polling result;
      - a repeated identical failure;
      - an idle gap.

      Its expected-event annotations are hand-written once and hashed.
    - Functional: **Probes** (`mechanism-probes/stm.mjs`):
      1. every task ends with an `outcome` naming changes and verification;
      2. recall returns the large tool output and the code snippet verbatim, and no other tool runs (S2);
      3. no STM request contains scope, WM or LTM text;
      4. polling collapses into one record with `count`;
      5. each boundary produced a marker, and the idle gap a pass with `stm.boundaries: true` (amended 2026-11-09, Task 3);
      6. no pass throws on the oversized tail;
      7. only referrer removal deleted chunks.
    - Functional: **Cost row (added 2026-11-09).** An eighth probe, `stm.cost`, carries the Performance numbers below. Its `OM-before` side loads the pinned pre-216 kernel and observational package in-process from `.cache/memory-bench/216/om-before`. Without that worktree the row reads `wrong-effect`.
    - Functional: **Live long-session coding family.** The work-outcome runner gains a `long-session` family: related coding tasks inside one session, where task B needs what task A changed. It reports re-derivation calls per related task (a `grep`, `read` or `bash` whose target A's outcome already names) for S1. Development and held-out partitions are frozen and drawn label-blind, as plan 209 Task 5 did. (Amended 2026-11-09: the family is its own module with its own partition file. `work-outcome-criteria.json` is frozen and pins the two W families, so `long-session` cannot join `WORK_OUTCOME_FAMILIES`. Its tools are `read_file`, `grep`, `edit_file`, `write_file` and `run_tests`, with no `bash`, so S1 counts `grep` and `read_file`.)
    - Performance: The probe suite runs in under 10 minutes offline. It also reports STM output tokens per 10k eligible tokens on the fixture against the pre-redesign observer, using the mock provider's token counter (moved from Task 1, 2026-11-09), and chunk bytes stored per 10k eligible tokens with their share of the transcript bytes they cover, which `scripts/memory-bench/README.md` and the package README's `### Chunks` cost line state (moved from Task 2, 2026-11-09).
    - Code Quality: Probes use `mechanism-probes/harness.mjs`; no ad-hoc runner.
    - Security: The fixture contains no real secrets. A seeded fake secret is asserted redacted in chunks.
  - Approach:
    - Documentation Reviewed:
      - `scripts/memory-bench/mechanism-probes/{harness,run}.mjs`;
      - `scripts/memory-bench/work-outcome/*`;
      - plan 209 Task 5 (partition freezing);
      - plan 210 Task 7.6 (carried).
    - Options Considered:
      - Synthetic generated sessions only. Rejected: S1 needs real coding tasks with dependent steps.
    - Chosen Approach:
      - One hand-annotated fixture offline, plus a frozen live family.
    - API Notes and Examples:
      ```sh
      timeout 1800 bun scripts/memory-bench/mechanism-probes/run.mjs --only stm
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/fixtures/memory-model/long-session/{session,annotations,index}.json` (new) and `scripts/memory-bench/long-session.mjs` (new: loader, hash check, the shared S1 counter);
      - `scripts/memory-bench/mechanism-probes/{stm.mjs,run.mjs,probes.test.mjs}`;
      - `scripts/memory-bench/work-outcome/{long-session.mjs,long-session.test.mjs,run.mjs}` and `scripts/memory-bench/work-outcome-long-session.json` (new: the family and its partitions);
      - `docs/_evidence/memory-bench/217/stm-probes.json` (new);
      - `scripts/memory-bench/README.md`; the package README's `### Chunks` cost line.
    - References:
      - plan 216 Task 2 (fixture index).
  - Test Cases to Write:
    - `stm_long_session_probe_covers_probes_1_to_7`.
    - `long_session_family_partitions_frozen_and_label_blind`.
    - `fixture_seeded_secret_redacted_in_chunks`.
    - `long_session_fixture_is_hashed_and_has_its_shape` (added 2026-11-09).
    - `long_session_offline_computes_s1_and_counts_rederivation` (added 2026-11-09).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — harness.
    - Docs pages to create/edit:
      - `scripts/memory-bench/README.md`; the package README's `### Chunks` cost line.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-09):
    - **Fixture.** `fixtures/memory-model/long-session/` holds three files:
      - `session.json`: ledgerkit 0.4 with 7 plan tasks (T1–T7), an orientation turn and a closing turn. That is 14 user turns, 88 tool calls and 204 message entries;
      - `annotations.json`: 56 hand-written events covering all 8 kinds, 7 task states, each task's changes, verification and S1 targets, 4 related pairs with their labelled re-derivations, and the expected habituation counts;
      - `index.json`: the sha256 of both files.

      `scripts/memory-bench/long-session.mjs` loads the fixture and refuses a changed byte. It expands two generated outputs: a 29 KB verbose test log and a 118 KB build log (the oversized tail). It also holds `rederivationCalls`, the S1 counter shared with the live family. On the fixture the counter finds exactly the labelled re-derivations (`c201`, `c501`).
    - **Probes** (`mechanism-probes/stm.mjs`). `replayLongSession` drives a real agent with `memorySystem` from the fixture:
      - the main model is scripted from `session.json`, and probe tools return the fixture outputs, keyed by call id;
      - the STM worker is scripted from the annotations. In each batch it maps entries to fixture steps and records the events whose last source falls in that batch, citing the batch's own entry ids. It resolves `supersedes` through the recent index;
      - the seeded secret reaches the session secret set through `session.compact({ secrets })` after the first turn.

      `run.mjs --only stm` (or a single probe id) loads the `stm` group. This group stays outside `GROUPS` and the plan 210 ledger coverage, and `--out` writes its own report (`stmProbeReport`). All eight rows are `works` (`docs/_evidence/memory-bench/217/stm-probes.json`, 15 s). Two runs were byte-identical apart from duration. The rows contain no fixture text.
      - **outcome:** 7 tasks, 7 outcomes, 7 outcome boundaries, 0 rejections.
      - **recall-verbatim (S2):** 2 of 2 chunks are byte-equal to the source after compaction, with 0 other tool calls.
      - **scope-blind:** 47 STM requests, 0 leaks. The scope and WM sentinels were live.
      - **habituation:** counts 8, 3 and 3, one record each; with habituation off, 8, 3 and 3 records.
      - **boundaries:** 7 outcome, 7 task-state and 1 idle-gap markers. The idle-gap-only pass ran once with `stm.boundaries` on and zero times with it off.
      - **oversized-tail:** under a 64 KB worker budget, one truncated batch, 0 failures, and coverage moves past the oversized entry.
      - **referrer-delete:** the only delete was the superseded fact's chunk, and it went through `apply`'s zero-referrer path. No live chunk holds the secret.
    - **Cost on the fixture** (46,160 eligible tokens). Tokens are `ceil(len/4)` of the scripted calls and of each worker request.

      | Per 10k eligible tokens | STM | OM-before |
      |---|---|---|
      | Worker passes (total) | 101 | 102 |
      | Output tokens | 786 | 626 (×1.26) |
      | Input tokens | 45,903 | 40,926 (×1.12) |

      The output side measures the record shape, because the worker is scripted: `kind` and chunks cost tokens the old shape did not have. STM stored 9 chunks, 588 bytes in total, 127 bytes per 10k eligible tokens. That is 1.8% of the bytes of the entries the chunks cover and 0.32% of the transcript. Habituation saved 11 records (45 kept). Both READMEs state these numbers.
    - **Family** (`work-outcome/long-session.mjs`). The family has 12 personas (`ls0`–`ls11`) with seeded names. Each persona runs one session of six tasks:
      - task 1 renames a function; task 3 builds `src/report.ts` on the renamed function;
      - task 4 changes a config key; task 6 documents that change;
      - tasks 2 and 5 read four-part logs.

      All arms share one context budget:
      - the memory arms vote at `compactAt.maxTokens` 6,000;
      - memory-off uses the kernel's `thresholdEntries` 12 and `keepRecentEntries` 6.

      `run_tests` grades from hidden labels. The rows hold ids and counts only. The partitions are drawn label-blind and committed in `work-outcome-long-session.json`: dev `ls10, ls7, ls11, ls1`, `idsHash` `db5632ff…`. The `run.mjs --family long-session --offline` dispatch refuses live runs, which belong to gate M-1.

      Offline, on the dev partition:
      - memory-off and STM both have 0 re-derivations per related task and a success rate of 1, because the kernel's compaction summary keeps the replies;
      - in a no-carry control (memory-off with a one-character summary), the mock re-derives from the files and S1 counts it.
    - **Findings for later tasks.**
      1. *The last turn's tail waits for the next pass.* `flush` skips a pass while another is in flight, so the pass after a session's final reply is often skipped, and the final outcome is recorded only at the next turn. The fixture ends with a closing turn (`t8`) for this reason. Task 6's live arms, and plan 218's WM trigger, should expect it. A trailing pass at close would remove it.
      2. *Kernel.* `CompactionOptions.maxSummaryChars` on `AgentConfig.compaction` never reaches the default compactor, which reads only its constructor option. On that option, `maxSummaryChars: 0` means unlimited. For the backlog.
      3. *memory-off is not memory-free inside one session.* The kernel's default compaction summary carries user and assistant text (up to 4,000 characters), so in the live family memory-off may re-derive little. The S1 row compares STM with OM-before, and memory-off is only a reference.
      4. *Task 6, OM-before.* `armMemory("OM-before")` imports `@arnilo/prism-memory-observational` with the old `observer` config, and in this tree it fails with an explicit message. The campaign must copy `work-outcome/long-session.mjs`, `long-session.mjs` and `work-outcome-long-session.json` into the pinned worktree, following the `acceptance.mjs` harness-copy pattern. The family records no worker tokens; Task 6 adds them for S4.
      5. *S4.* On the fixture, scripted STM output is 1.26× OM-before's, just over the row's 1.25×. If the live ratio is similar, S4 needs the written justification (`kind` and verbatim chunks).
    - **Checks.**
      - `bun test scripts/memory-bench`: 555 pass, 3 skip. The 1 failure is the known load error in `feature-ledger.test.mjs` (17 `fabric:` config problems, Task 4 finding 4). The timing test passed this run.
      - The new tests pass: `probes.test.mjs` (3) and `long-session.test.mjs` (2).
      - `src/__tests__/docs.test.ts`: 69 pass.
      - `bun run typecheck`: clean.
      - `biome check` on the new and edited scripts: clean.
      - No product code, no export, no baseline change; no retired name.

- [ ] Task 6: Gate M-1 — live STM efficacy against the pre-redesign observer (paid), and plan end
  - Acceptance Criteria:
    - Functional: **Gate record.** `docs/_evidence/memory-bench/217/gates/owner-gate-m1.json` states:
      - the budget;
      - the models (plan 210 gate C-1's paid Ollama Cloud roles unless the owner names others; never `openrouter/free`);
      - the arms, partitions and caps.

      The run starts only on the owner's word.
    - Functional: **Arms**, on development partitions only:
      - `OM-before`: the `OM` arm moved from plan 210 Task 5 wave 3, run from the pre-216 revision recorded in `docs/_evidence/memory-bench/memory-model/baselines.json` (`omBefore.revision`, pinned at plan 216 Task 4's first step under the rule plan 216 Task 2 froze), with `PRISM_MEMORY_BENCH_SOURCE` set to it;
      - `STM`: the `session` profile with WM and Rehearsal set to their plan-216 behaviour (today's reflector and dropper), so the comparison isolates the encoder;
      - `memory-off`.

      They run on `beam-1m`, `longmemeval-m` and the `long-session` family.
    - Functional: **Fixture hashes (added 2026-11-09).** Before the gate reads them, a criteria amendment adds the hashes of the `long-session-replay` and `long-session` fixtures, as the criteria's `fixtures.rule` requires. It changes no row, and `assertMemoryModelFixture` refuses an unhashed or drifted fixture.
    - Functional: **Verdicts.** `acceptance-report.mjs --plan memory-model --gate M-1 --build` computes S1–S4 from the run reports and the frozen criteria, with no hand-set value. A miss is reported as a miss and goes to the owner with per-row evidence before plan 218 starts. One fix round is allowed, on development partitions, with its own amended gate.
    - Functional: **Plan 210 transfer.** `docs/_evidence/memory-bench/210/decisions.md`'s `om.observer` and `om.task-state` rows get their final disposition from this verdict.
    - Functional: **Plan end.** Compromises, Further Actions, and the backlog hand-off.
    - Performance: Reports worker calls and tokens per 10k eligible tokens, chunk-store bytes at peak, context-block bytes, cost, and p95 latency per arm. A worker-token rise above 25% carries a written justification (S4).
    - Code Quality: The arms run through `cleanup-campaign.mjs`-style machinery (journal, source pin, retries that cost only wall time, the allowance guard). No ad-hoc runner.
    - Security: Evidence carries counts, ids and hashes only. Held-out partitions stay unread.
  - Approach:
    - Documentation Reviewed:
      - plan 210 Task 5 notes (C-1 machinery, Ollama allowance guard, retries);
      - `scripts/memory-bench/{campaign,cleanup-campaign,acceptance-report}.mjs`;
      - plan 216 Task 2 criteria.
    - Options Considered:
      - Compare against plan 210's recorded OM rows. Not possible: plan 210 no longer runs them, so they run here.
    - Chosen Approach:
      - A paired dev screen against a pinned baseline.
    - API Notes and Examples:
      ```sh
      timeout 120 bun scripts/memory-bench/campaign.mjs --plan memory-model --gate M-1 --partition dev --manifest
      timeout 28800 bun scripts/memory-bench/campaign.mjs --plan memory-model --gate M-1 --partition dev   # refuses until the record is approved
      timeout 600 bun scripts/memory-bench/acceptance-report.mjs --plan memory-model --gate M-1 --partition dev --build --write
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/{campaign,acceptance-report}.mjs` (the `--gate` profile) and tests;
      - `scripts/memory-bench/stm-gate.mjs` and `stm-gate.test.mjs` (new: jobs, manifest, gate check, worktree preflight, evidence), `chunk-meter.mjs` (new), `work-outcome/long-session-live.mjs` (new: the family's campaign child), `work-outcome/long-session.mjs` (live worker model, metering, checkpoints), `replay.mjs` and `run.mjs` (chunk-store peak per question);
      - `scripts/memory-bench/{memory-model-criteria.json,robustness.mjs,memory-model-criteria.test.mjs}`, `docs/_evidence/memory-bench/memory-model/{criteria,baselines}.json` (amendment 1: fixture hashes);
      - `docs/_evidence/memory-bench/217/**`;
      - `docs/_evidence/memory-bench/210/decisions.md` (transferred rows);
      - this plan; `plans/backlog.md`.
    - References:
      - plan 216 Task 2; plan 210 Task 5.
  - Test Cases to Write:
    - `gate_m1_arms_paired_on_identical_items`.
    - `om_before_runs_from_pinned_pre_216_revision`.
    - `m1_verdicts_computed_from_memory_model_criteria_only`.
    - `chunk_meter_counts_stored_bytes_and_peak` (added 2026-11-09).
    - `fixture_hashes_come_by_amendment_and_change_no_row` (added 2026-11-09).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evidence.
    - Docs pages to create/edit:
      - the evidence README; the package README's measured-role paragraph (S-row wording only).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (in progress, 2026-11-09; the task stays open until the paid run and its verdict):
    - **Owner decision (2026-11-09).** On 2026-11-09, $37.03 of the $60 Ollama Cloud allowance was left until 2026-12-07. The full development cohort is estimated at about 2.6B input tokens, about $116 at the past week's billed rate ($22.97 for 520.9M input tokens, 83.6% cached, from `/api/usage`). Two other options were offered: run now under the C-1 caps (100M per job, about 10 BEAM and 20 LME questions per job, which would likely leave S3 underpowered), or run the small model only. The owner chose "Build now, run full later" with the C-1 roles. The machinery, the manifest and the gate record are built, and the paid run starts on the owner's later word. `217/gates/owner-gate-m1.json` records this with `approved: false`, and the campaign refuses to start until that changes.
    - **What changed.**
      - `stm-gate.mjs` builds the 18 jobs: 2 answer models × (2 suites + the family) × 3 arms, in run order. The family runs first, then memory-off, then STM and OM-before back to back per model and suite, small model first, so a halt on a spent allowance leaves whole pairs. `assertM1Paired` refuses a pair that differs in more than the arm.
      - The manifest (`memory-model/M-1/manifest.json`, hash `5d8dbdc9…`) pins the criteria, the two fixture hashes, the OM-before revision and product hash, this tree's product hash (`packages/memory/system/src`, `packages/memory/core/src`, `src`) and the harness hash. Any of them changing gives a new manifest hash, which needs a new approval rather than a resume.
      - The per-arm source label is the pinned revision for OM-before and `stm-<product hash>` for the others, so a commit made during the run cannot orphan a checkpoint (the C-1 lesson).
      - **OM-before** runs each job in the worktree `.cache/memory-bench/216/om-before` (`job.cwd`). `prepareM1Worktree` checks the HEAD (`37ee1a24`), the observational product hash and `node_modules`. It then copies in the family's files, which the pinned tree lacks, and checks they arrived byte for byte.
      - The worker arms are capped at 600M input tokens per BEAM-1M job and 400M per LongMemEval-M job. Those caps hold the full cohort; the C-1 allowance guard (`c1BudgetGate`, reused) bounds money.
      - **Family live mode.**
        - `work-outcome/long-session-live.mjs` is the campaign child. It holds the journal reservation, uses the wire-proxy usage, keeps per-persona-arm checkpoints, and accepts the `dev` partition only.
        - `long-session.mjs` makes the worker the answer model when live. `meteredLongSessionProviders` meters worker tokens (`record_event`, `record_observation`, `record_reflection`, `drop_observations`) apart from the main agent's. The eligible tokens are the task prompts plus the tool results plus the main agent's output. Each persona-arm also gets a usage row, `longSessionFaults` (a task that neither completed nor hit the run limit is a fault, not a score), and resume from checkpoints.
      - **Chunk bytes at peak.** `chunk-meter.mjs` supplies the STM arm's default in-memory SQLite store through `memory.chunks` and counts the bytes it holds. `replay.mjs` installs it for the session-only `om` arm, and each report row gains `chunkStorePeakBytes`.
      - **Evidence** (`buildM1Evidence`), each row computed:
        - S1: paired re-derivations per related task, clustered by persona, per model;
        - S2: `217/stm-probes.json` `stm.recall-verbatim`;
        - S3: paired accuracy per (model, suite) cell, each cell required to be non-inferior, plus STM's all-required evidence coverage per ability;
        - S4: the largest STM / OM-before worker-token ratio over every (model, scope) cell. The justification is read from `217/s4-justification.md`, never written by the builder.
        A missing or unfinished report leaves its row `missing`. The performance block reports, per arm, worker calls and tokens, context-block bytes, chunk-store peak, cost and p95 answer latency. `acceptance-report.mjs --plan memory-model --gate M-1 --build` writes the evidence and computes the verdicts.
      - **Criteria amendment 1.** `fixtures.index` gains the `long-session-replay` hash (sha256 of its `index.json`, `1bc074d1…`) and the `long-session` hash (sha256 of `work-outcome-long-session.json`, `803650cb…`), each with `hashOf`. `verifyMemoryModelCriteria` now requires a fixture hash to come with an amendment and to name its file. The frozen hash moved from `2b50880b…` to `f99907bd…` in `criteria.json` and `baselines.json`. Removing the amendment rebuilds the earlier hash, and no row changed.
    - **Checked offline (no paid call).**
      - `run.mjs --offline --config om` completes 14 questions in both trees: this tree's (chunk meter present) and the worktree's at `37ee1a24`.
      - In the worktree, the family runs `OM-before` and `memory-off` offline from the copied harness, with worker tokens metered (9 worker calls, 10,501 eligible tokens on persona `ls10`); `STM` runs here.
      - `campaign.mjs --plan memory-model --gate M-1 --partition dev` refuses with `M1Gate: the gate is not approved by the owner`. `--partition heldout-a` and `--gate M-2` are refused.
    - **Checks.**
      - `stm-gate.test.mjs`: 4 pass (the three named tests and `chunk_meter_counts_stored_bytes_and_peak`).
      - `memory-model-criteria.test.mjs`: 10 pass (`fixture_hashes_come_by_amendment_and_change_no_row` added; the retrieval-set amendment test now appends to the amendment log).
      - `bun test scripts/memory-bench`: 560 pass, 3 skip, 1 fail. The failure is the known `feature-ledger.test.mjs` load error (Task 4 finding 4).
      - `src/__tests__/docs.test.ts`: 69 pass.
      - `bun run typecheck`: clean.
      - `biome check` on the changed scripts: clean. `--write` reformatted import blocks that earlier uncommitted tasks had left in `replay.mjs` and `run.mjs`; this was formatting only.
      - No product code, export or baseline changed, so there is no baseline diff and no sweep.
    - **Live start, smoke and fix (2026-11-09, later the same day).**
      - **Start word and models.** The owner said: "Go ahead and do the live run. You can use ollama cloud for testing with gemma4:31b, GPT-OSS-120B, Mimo-2.6-flash, deepseek-v4.1-flash". The answer models became `deepseek-v4.1-flash` (large) and `mimo-v2.6-flash` (small), and the judges stayed `gpt-oss:120b` and `gemma4:31b`. This is `M1_MODELS` in `stm-gate.mjs`, recorded as a gate record amendment.
      - **Smoke.** It covered the small model only, with 2 questions or 1 persona per job, in its own journal. The family's three arms completed, OM-before from the worktree at `37ee1a24`. memory-off completed on both suites. STM on LongMemEval-M ran 1.5 hours without finishing a question, and the owner stopped the smoke ($1.33 spent).
      - **Finding (product bug).**
        - MiMo, following the STM instruction, records 30 to 50 events per ~10k-token batch of conversation.
        - The worker loop (`memory-core` `worker.ts`) threw on the 33rd call of a turn (`exceeds 32 tool calls per turn`). The whole pass failed, its events were discarded and coverage stayed in place, so the next pass re-sent a larger batch.
        - The smoke showed 96 of 511 calls at the 8,192 output cap and inputs growing to 100k tokens.
        - A live diagnostic (`.cache/memory-bench/217/diag/`, 120k tokens of the first smoke question) reproduced it: 4 of 20 calls aborted.
      - **Fix (option 1, owner: "okay. do option 1").**
        - `runMemoryWorkerLoop` gains `onToolCallLimit` (`"fail"` default, unchanged; `"refuse"` answers calls past the limits with a `tool_call_limit` error result, and past the total limit the loop ends after that turn). STM uses `"refuse"`.
        - `serializeSourceBatches` takes a target size. The STM flush closes a multi-entry batch at `stmBatchTargetBytes` (8 bytes per trigger token, at least 32 KB); only half of `worker.maxMessageBytes` still cuts an entry. The extractor, wiki curator, reflector and dropper keep the fail-closed default.
        - Tests: `stm_refuses_calls_past_the_limits_and_keeps_the_rest`, `worker_loop_still_fails_on_the_limits_by_default`, `stm_backlog_splits_at_the_batch_target_and_never_cuts_an_entry`, and `metered_providers_count_usage_when_the_consumer_stops_at_done` (a family meter fix: the kernel stops reading a stream at `done`, so the main-agent tally moved into `finally`; worker tokens were never affected).
        - Baseline: additive (`memory-core`: `+ MEMORY_WORKER_TOOL_CALL_LIMIT`, `MemoryWorkerLoopOptions` compatible).
        - The STM probes still read `works`; `stm-probes.json` was regenerated (STM passes 101 → 102, input +1%, S2 counts unchanged).
        - `packages/memory/system`: 680 pass, plus the 2 known `retired-names.json` failures. Memory-bench and docs: green apart from the known `feature-ledger` load error. Typecheck clean.
      - **Assessment (same 120k tokens, MiMo).**
        - After the fix: 0 aborted passes, 458 STM records and 890k worker tokens.
        - OM-before (pinned tree): 63 records and 599k worker tokens. STM's ratio is about 1.49 (output 3.3×), an early S4 reading above 1.25 from one history, not gate evidence.
        - Billed rate: $0.0585 per million input tokens, output included, against the earlier $0.044 estimate.
        - Projection for the full gate: about $145 for both models (DeepSeek's rate unmeasured) and about 8 days of serial wall time, against $35.65 left until 2026-12-07.
        - The gate record is paused (`approved: false`) and rebound to manifest `185793e1…`. It waits for the owner's choice: coarser STM events first, a reduced run, or the full gate after the reset.
    - **Remaining (after the owner's start word):**
      - set `approved`, `approvedAt` and the owner's words in the record, after checking `manifestHash` (regenerate the manifest if the harness changed);
      - run the campaign as a `systemd-run --user` unit and watch the allowance; it halts below $1.50 and resumes next period;
      - run `--build --write`;
      - write `s4-justification.md` only if S4 exceeds 1.25 and the cause is the record shape;
      - give a miss to the owner with per-row evidence before plan 218 starts;
      - transfer the `om.observer` and `om.task-state` rows in `210/decisions.md`;
      - update the package README's measured-role paragraph;
      - fill Compromises Made and Further Actions, and do the backlog hand-off.

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 1200 bun run typecheck`
- `timeout 900 bun run --cwd packages/memory/system test`
- `timeout 1800 bun scripts/memory-bench/mechanism-probes/run.mjs --only stm`
- `timeout 900 bun test --timeout=0 scripts/memory-bench`
- `timeout 3600 bun scripts/memory-bench/safety/run.mjs --suite offline`
- `timeout 900 bun run --filter @arnilo/prism-agent test`
- `timeout 600 bun test --timeout=0 src/__tests__/docs.test.ts`
- `timeout 1800 bun scripts/release.mjs gate` (baseline diffs attributed)
- `timeout 300 bunx biome check <changed files>`
- Paid, after gate M-1: the Task 6 campaign and report; confirm no owned paid process remains.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
