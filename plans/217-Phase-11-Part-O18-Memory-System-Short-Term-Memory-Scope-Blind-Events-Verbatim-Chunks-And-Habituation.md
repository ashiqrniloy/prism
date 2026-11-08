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

- [ ] Task 1: The STM encoder records events, not facts, and never sees the scope
  - Acceptance Criteria:
    - Functional: **Role.** The default STM instruction (today `DEFAULT_OBSERVER_INSTRUCTION`, moved from `observer.ts:17`) is rewritten to record every meaningful thing in the batch, in order:
      - user requests and statements;
      - actions (tool calls, commands, files read or edited);
      - results (tool output, test results, errors);
      - decisions and their reasons;
      - task outcomes.

      Each description is self-contained enough that a later model, seeing only the description, can judge whether the event and its chunks help a new task. The prompt no longer says "Find durable source-backed facts".
    - Functional: **Record shape.** `record_event` (replacing `record_observation`, no alias) takes `kind` (`request | action | result | change | decision | outcome | error | statement`), `description` (one line; `content` is renamed, no alias), `sourceEntryIds` (required), `chunks` (optional, ≤ `stm.maxChunksPerEvent`), `referencedAt`, `relevance` and `supersedes`. The stored record gains `kind`, `chunkRefs` (id, source entry id, sha256, bytes), `count` and `lastAt`.
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
    - Performance: Reports STM output tokens per 10k eligible tokens on the offline fixture, against the pre-redesign observer, using the same fixture and the mock provider's token counter.
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
      - `packages/memory/system/src/session/{workers/stm,types,ledger,flush,render,context}.ts` and tests;
      - `src/ltm/consolidation/gather.ts` and tests;
      - `scripts/memory-bench/variants.mjs`;
      - the README (`## Short-term memory`); CHANGELOG; the compat baseline.
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

- [ ] Task 2: The chunk store — verbatim, redacted, capped, deletable, reference-counted
  - Acceptance Criteria:
    - Functional: **Verbatim check.** A chunk `{ sourceEntryId, text }` is accepted only if `text`, after whitespace normalisation, is a substring of that entry's serialized content. Otherwise the tool answers `ok: false`, `chunk_not_verbatim`.
    - Functional: **Caps and redaction.** Each chunk is capped at `stm.maxChunkBytes` (4 KB, tuning) and redacted with the session's secrets before it is written. A truncation marker never contains the truncated bytes.
    - Functional: **Never on the branch.** Chunks go to a `ChunkStore` (`put`, `get`, `ref`, `unref`, `delete`, `list(sessionId)`) owned by the package. The default is a local SQLite file through memory-core's local store helpers, in the host's data directory, mode 0600; a host may supply another. The ledger carries only `chunkRefs`.
    - Functional: **Reference counting (I3).**
      - A chunk has referrers: an STM record, a WM item or an LTM note, each with a session id.
      - `unref` removes one referrer. At zero referrers the chunk is hard-deleted in the same transaction, and the store vacuums or uses `secure_delete` so the bytes leave free pages.
      - A forked session's referrers are added at fork, so the parent's drop cannot delete a chunk the child still holds.
    - Functional: **Only referrer removal deletes.** No code calls `delete` directly. `delete` is internal to the zero-referrer path, and a test spies on it across the fixture.
    - Performance:
      - One store transaction per pass.
      - The README states chunk bytes stored per 10k eligible tokens on the fixture, and the default caps keep stored chunks under 25% of the transcript bytes they cover.
      - `context.build` cost is unchanged.
    - Code Quality: One module (`chunks.ts`) owns validation, the contract and the default store.
    - Security:
      - Chunks never enter the context block or shared stores.
      - Recall reads only chunks referenced by the executing session or its ancestors.
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
      - `packages/memory/system/src/chunks.ts` (new) and tests;
      - `src/session/{workers/stm,flush,state}.ts`;
      - the README (`## Chunks`, cost section); CHANGELOG; the compat baseline.
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

- [ ] Task 3: Habituation and event boundaries
  - Acceptance Criteria:
    - Functional: **Habituation.**
      - When an event's `kind` and normalised description match an active STM record within the habituation window (`stm.habituation.windowEvents`, 50, tuning) and the new chunks are byte-equal (or absent), the package increments `count` and updates `lastAt` instead of adding a record.
      - The rendered line shows `×N`.
      - A changed result (different chunk bytes) is a new event.
      - `stm.habituation: false` turns it off.
    - Functional: **Boundaries.** STM records a `boundary` marker, and runs a pass even below `stm.triggerTokens`, on:
      - an `outcome` event;
      - a task-state change;
      - a user turn after an idle gap ≥ `stm.boundaryGapMinutes` (10, tuning).

      The markers are what plan 218's WM trigger reads.
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
      - `packages/memory/system/src/session/{flush,ledger,render,config}.ts` and tests;
      - README; CHANGELOG.
    - References:
      - design §5.2.
  - Test Cases to Write:
    - `repeated_identical_event_increments_count`.
    - `changed_result_is_a_new_event`.
    - `outcome_or_task_state_change_runs_a_boundary_pass`.
    - `habituation_off_records_every_event`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — config and rendering.
    - Docs pages to create/edit:
      - README (`## Short-term memory`, cost); CHANGELOG.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Recall reads events, chunks and tombstones
  - Acceptance Criteria:
    - Functional: **Recall by id.** The session `recall` tool (until plan 219 Task 4 folds it into `memory.recall`) with an STM id returns:
      - the description, kind, time, count and source ids;
      - every chunk verbatim;
      - for an unreferenced chunk, `chunk dropped: <reason>`.

      With `detail: "full"`, it also returns the raw source entries.
    - Functional: **No re-running.** A test reads a tool result's chunk through `recall` after the original entry left context, and asserts that no tool other than `recall` ran.
    - Functional: **Tombstones.** A record whose surface was removed (by plan 218's WM) is still found by id, with `state: "tombstoned"` and its reason. This task adds the state and its rendering; WM sets it.
    - Functional: **The surface never renders chunk text.** Only the `[chunk]` marker appears.
    - Performance: Recall by id is one ledger fold, already in memory, plus one chunk-store read per chunk.
    - Code Quality: `recall.ts` reads through `chunks.ts` only.
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
      - `packages/memory/system/src/session/{recall,recall-tool,render,types}.ts` and tests;
      - README.
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

- [ ] Task 5: The offline long-session fixture and STM mechanism probes
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
      5. each boundary produced a pass;
      6. no pass throws on the oversized tail;
      7. only referrer removal deleted chunks.
    - Functional: **Live long-session coding family.** The work-outcome runner gains a `long-session` family: related coding tasks inside one session, where task B needs what task A changed. It reports re-derivation calls per related task (a `grep`, `read` or `bash` whose target A's outcome already names) for S1. Development and held-out partitions are frozen and drawn label-blind, as plan 209 Task 5 did.
    - Performance: The probe suite runs in under 10 minutes offline.
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
      - `scripts/memory-bench/fixtures/memory-model/long-session/**` (new);
      - `scripts/memory-bench/mechanism-probes/{stm.mjs,probes.test.mjs}`;
      - `scripts/memory-bench/work-outcome/**` (the `long-session` family, partitions);
      - `scripts/memory-bench/README.md`.
    - References:
      - plan 216 Task 2 (fixture index).
  - Test Cases to Write:
    - `stm_long_session_probe_covers_probes_1_to_7`.
    - `long_session_family_partitions_frozen_and_label_blind`.
    - `fixture_seeded_secret_redacted_in_chunks`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — harness.
    - Docs pages to create/edit:
      - `scripts/memory-bench/README.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

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
    - Functional: **Verdicts.** `acceptance-report.mjs --plan memory-model --gate M-1` computes S1–S4 from the frozen criteria, with no hand-set value. A miss is reported as a miss and goes to the owner with per-row evidence before plan 218 starts. One fix round is allowed, on development partitions, with its own amended gate.
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
      timeout 28800 bun scripts/memory-bench/campaign.mjs --plan memory-model --gate M-1 --manifest --partition dev
      timeout 600 bun scripts/memory-bench/acceptance-report.mjs --plan memory-model --gate M-1
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/{campaign,acceptance-report}.mjs` (the `--gate` profile) and tests;
      - `docs/_evidence/memory-bench/217/**`;
      - `docs/_evidence/memory-bench/210/decisions.md` (transferred rows);
      - this plan; `plans/backlog.md`.
    - References:
      - plan 216 Task 2; plan 210 Task 5.
  - Test Cases to Write:
    - `gate_m1_arms_paired_on_identical_items`.
    - `om_before_runs_from_pinned_pre_216_revision`.
    - `m1_verdicts_computed_from_memory_model_criteria_only`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evidence.
    - Docs pages to create/edit:
      - the evidence README; the package README's measured-role paragraph (S-row wording only).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

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
