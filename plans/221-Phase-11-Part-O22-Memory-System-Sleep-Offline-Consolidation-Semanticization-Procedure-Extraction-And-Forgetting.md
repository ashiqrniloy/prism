# Phase 11 Part O22 — Memory system: Sleep (offline consolidation, semanticization, procedure extraction, forgetting)

> **Amended 2026-11-10 (plan 224 Task 2):** package names follow the seven-bundle map of roadmap Part 3 — `@arnilo/prism-memory-system` (the bundle root `.` and its `/core` subpath) and `@arnilo/prism-knowledge/{wiki, rag}`. Directories do not change, so read every name below as that specifier once plan 224 Task 8 lands.

> **Amended 2026-11-12 (owner, benchmark decision; [plan 218.1](218.1-Phase-11-Part-O19.1-Memory-Benchmarks-External-Outcome-Suites-Replace-BEAM-And-LongMemEval.md)):** `beam-1m` and `longmemeval-m` leave every memory-model gate. They are QA over imported chat logs, not this product's work, and at about 1M tokens a question they cannot reach a deciding sample. They are replaced by external, outcome-scored suites: Compact-Bench (session tiers and compaction), MemoryArena (declarative LTM across sessions) and STATE-Bench's Agent Learning Track (procedural learning and Sleep). Plan 218.1 Task 1 re-scopes the criteria rows to match; this plan's text is amended below. `locomo` and `memoryagentbench-cr` stay until the owner decides on them.

## Objectives

- Add **Sleep**, the offline consolidation pass (design §5.7).
  - **When it runs:** on `memory:sleep` or `memory.system.sleep()`, or when a host schedules it (overnight, or after N sessions), for example with `@arnilo/prism-headless`'s `createScheduler`. It has no timer of its own.
  - **How much it reads:** it is incremental, reading only what changed since the last sleep per scope.
  - **Concurrency and bounds:** it runs under a lease per scope, and within a model-call budget and a time limit.
- Sleep's jobs:
  - **Forgetting**: today's `memory:maintain`, folded in; that command is retired.
  - **Duplicates and conflicts.**
  - **Semanticization**: facts that recur across episodes become semantic notes.
  - **Procedure extraction** from repeated successful episodes.
  - **Trigger acquisition and extinction** from repeated cue → outcome pairs.
  - **Skill proposals.**
- Measure it live (gate M-5, rows Z1–Z4) across multi-session lifecycles, sleep against no sleep.

## Expected Outcome

- The Sleep runner:
  - per-scope cursors and leases;
  - a jobs registry with per-job budgets;
  - a report with a `memory.sleep.completed` event;
  - `memory:sleep`;
  - `memory.system.sleep()`;
  - a host scheduling recipe and example.
- Five jobs, each writing only candidates (I9) through LTM's write path, with provenance to the episodes or notes they read.
- `memory:maintain` and `fabric.maintain()` are retired into the forgetting job.
- An offline multi-session fixture with sleep cycles, the growth simulation, and gate M-5's verdicts in `docs/_evidence/memory-bench/221/`.

This implements roadmap Phase 11 "Memory model", the Sleep part, after plan 220. Its arms run on plan 220's product, which includes plan 219.1's retrieval. **Review task included** (Task 1): Sleep is the first memory work that runs outside a conversational turn and across sessions, so its seams (commands without an active task, package-level `models.client`, the stores' `leases` service, the headless scheduler) are verified before code.

The ontology's curator pass is **not** a Sleep job: the ontology belongs to the wiki (design §5.10, plan 222). A host may schedule `wiki:consolidate` beside `memory:sleep`. Plan 210's transferred row `lifecycle.duplicate-merge` is decided here. No version bump and no publish.

## Tasks

- [ ] Task 1: Phase review — running outside a turn, leases, scheduling (read-only)
  - Acceptance Criteria:
    - Functional: **Verify against source, with `file:line`:**
      1. a package command can run with a session that has no active run, and `prism.models.client(ref)` works there (`src/packages/api.ts:118-130`);
      2. the `leases` service from `@arnilo/prism-store-sqlite` and `-postgres` (`packages/stores/sqlite/src/leases.ts`): acquire, renew and expiry semantics, plus the behaviour with the in-memory store (no leases), which needs an in-process lease fallback like the consolidation lease in `src/ltm/consolidation/pass.ts:111` before plan 219 retires it;
      3. `createScheduler` in `@arnilo/prism-headless` (`packages/hosts/headless/README.md:106-124`) can target a command, and how it guards double firing;
      4. how today's `fabric.maintain()` (`src/ltm/lifecycle/maintain.ts:476`) pages per scope, as the model for incremental cursors;
      5. multi-process safety of the markdown store under concurrent Sleep and session writes (plan 188.10).
    - Functional: **Classification.** Each Objectives bullet is classified as expressible or needing a kernel addition. A kernel addition stops the plan for a re-cut.
    - Functional: **Verdict** recorded in Notes.
    - Performance: n/a.
    - Code Quality: No code.
    - Security: Records which identity and scope a Sleep run acts under (the host's principal for the scopes it names) and confirms it cannot read another principal's scopes.
  - Approach:
    - Documentation Reviewed:
      - the files named above;
      - plan 188.10 (multi-session);
      - plan 171 (headless).
    - Options Considered:
      - Skip the review. Rejected: cross-session work with leases is new for memory.
    - Chosen Approach:
      - Read-only review, verdict in Notes.
    - API Notes and Examples:
      - n/a.
    - Files to Create/Edit:
      - this plan (Notes).
    - References:
      - `references/prism.md` §2.
  - Test Cases to Write:
    - none — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - none.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: The Sleep runner, and the forgetting job (`memory:maintain` folded in)
  - Acceptance Criteria:
    - Functional: **Entry points.**
      - `memory:sleep { scopes?, jobs?, maxModelCalls?, maxMillis? }` and `memory.system.sleep(options)`.
      - Defaults: `sleep.maxModelCalls` 40, `sleep.maxMillis` 600,000, all enabled jobs, and every scope readable by the running principal.
      - The run emits `memory.sleep.completed { scopes, jobs: { name: { read, written, rejected, calls } }, stoppedBy? }`.
    - Functional: **Incremental.**
      - Each scope keeps a sleep cursor: the last LTM change sequence seen, plus the last episode id.
      - A job reads only notes and episodes changed since the cursor, plus the existing notes they cite or match (bounded).
      - The cursor advances only after the job's writes succeed.
      - A run with nothing new makes no model call.
    - Functional: **Leases.**
      - Sleep takes one lease per scope through the `leases` service, or an in-process lease when the store has none, per Task 1.
      - A second run for the same scope is refused with `sleep_in_progress`.
      - A session's Rehearsal writes are not blocked by the lease; Sleep reads a consistent snapshot per page.
    - Functional: **Budgets.** The run stops at `maxModelCalls` or `maxMillis` with `stoppedBy`, leaving cursors at what completed.
    - Functional: **The forgetting job.**
      - Today's `memory:maintain` behaviour (strength-based archive, capacity eviction, the exchange tier, and the archive exemption for raw exchanges decided here: plan 210's wave 2 arm was cancelled, so the decision rests on the offline growth evidence `docs/_evidence/memory-bench/210/offline/growth-*`, where month-1 active retrieval went 0.5625 → 1.0 with the exemption, and is confirmed by the Z3 row) runs as the `forget` job, with no model call.
      - `memory:maintain` and `fabric.maintain()` (now `ltm.maintain()`) are retired with no alias. A call fails with `maintain_retired` and a hint (`memory:sleep { jobs: ["forget"] }`).
    - Functional: **Host scheduling recipe.** The README shows `createScheduler` running `memory:sleep` at 03:00 and `wiki:consolidate` after it. `examples/memory-sleep.ts` runs a three-session lifecycle with a sleep between sessions on a fake clock, with its `examples/README.md` line and `e2e-coverage.json` row.
    - Performance:
      - Cost is bounded by the budgets.
      - The README states calls per run by job and the default (never scheduled) that avoids them.
      - A no-op run is one cursor read per scope.
    - Code Quality: A jobs registry with one interface (`{ name, select(cursor), run(items, budget) }`), so later jobs plug in. `stability.test.ts` covers the `sleep.*` fields.
    - Security:
      - Sleep acts only on scopes the principal can read and write.
      - It writes candidates only (I9).
      - The lease prevents concurrent conflicting writes.
  - Approach:
    - Documentation Reviewed:
      - Task 1 findings;
      - `src/ltm/lifecycle/{maintain,archive,capacity}.ts`;
      - design §5.7.
    - Options Considered:
      - Run Sleep on a package timer. Rejected: a package must not start model work on its own clock; the host schedules.
      - A full pass over the store each run. Rejected: cost grows with store size.
    - Chosen Approach:
      - Host-triggered, incremental, leased, budgeted.
    - API Notes and Examples:
      ```ts
      scheduler.schedule({ id: "memory-sleep", target: "memory:sleep", cron: "0 3 * * *", tz: "UTC" });
      ```
    - Files to Create/Edit:
      - `packages/memory/system/src/sleep/{runner,cursor,lease,jobs,forget}.ts` (new) and tests;
      - `src/ltm/lifecycle/maintain.ts`, `src/ltm/commands.ts`;
      - `src/service.ts`;
      - `examples/memory-sleep.ts`, `examples/README.md`, `scripts/e2e-coverage.json`;
      - `apps/prism-agent/**` (if it calls maintain);
      - README (`## Sleep`); `docs/migrate-to-0.13.md`; CHANGELOG; baseline.
    - References:
      - design §5.7.
  - Test Cases to Write:
    - `sleep_reads_only_changes_since_cursor_and_noop_makes_no_call`.
    - `second_sleep_for_scope_refused_while_leased`.
    - `budget_stop_leaves_cursor_at_completed_work`.
    - `forget_job_matches_retired_maintain_behaviour`.
    - `maintain_command_retired_with_hint`.
    - `sleep_example_runs_on_fake_clock`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — command, service, retired command.
    - Docs pages to create/edit:
      - README (`## Sleep`, cost); `examples/README.md`; `docs/migrate-to-0.13.md`; CHANGELOG.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: The duplicates and conflicts job
  - Acceptance Criteria:
    - Functional: **Duplicates** (the transferred `lifecycle.duplicate-merge` row). Notes changed since the cursor are compared with their lexical neighbours, using the existing Dice similarity and the same-key rule. Exact or near duplicates merge into the stronger note, with lineage (`mergedFrom`), no model call, and the never-demote rule.
    - Functional: **Conflicts.**
      - Two active semantic notes in the same scope and key, or close in text, that disagree (a negation, number or value change) go to one model call per batch: `supersede` (newer evidence wins, with lineage), `both-valid` (different conditions, each annotated), or `record-contradiction` (both kept, linked `contradicts`, surfaced to `memory:status`).
      - Episodes are never touched (I8).
      - A human-written note is never superseded by Sleep; the contradiction is recorded instead.
      - **Record shape for retrieval.** Every outcome is a lineage edge that plan 219.1 Task 7's `history` mode reads: `supersedes`, `contradicts`, or `both-valid` with each note's condition. These edges, with keys and `corrects`, are the only source of a "superseded" or "conflicts with" label in recall; text similarity never sets one (design §5.11, D5).
    - Functional: **Disposition.** `lifecycle.duplicate-merge` gets its final disposition recorded.
    - Performance: Duplicate detection is lexical, per changed note. Conflict calls are capped within the run budget.
    - Code Quality: A job in the registry. It reuses `lifecycle/merge.ts` for duplicates.
    - Security: Supersession keeps history. Flagged and archived notes are never rewritten.
  - Approach:
    - Documentation Reviewed:
      - `src/ltm/{lifecycle/merge,reconcile,decisions}.ts`;
      - plan 188.4 (merging).
    - Options Considered:
      - The write-time decider (`consolidate.decider: "model"`). Plan 210 removed it as inert; doing the work at sleep time batches it.
    - Chosen Approach:
      - Deterministic duplicates, and model-judged conflicts in batches.
    - API Notes and Examples:
      - n/a.
    - Files to Create/Edit:
      - `packages/memory/system/src/sleep/jobs/conflicts.ts` (new) and tests;
      - `src/ltm/lifecycle/merge.ts`;
      - README; CHANGELOG;
      - `docs/_evidence/memory-bench/210/decisions.md`.
    - References:
      - design §5.7.
  - Test Cases to Write:
    - `near_duplicates_merge_with_lineage_and_no_call`.
    - `conflict_supersede_keeps_history`.
    - `human_note_never_superseded_by_sleep`.
    - `episodes_untouched_by_conflict_job`.
    - `conflict_outcomes_are_lineage_edges_history_mode_reads`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — Sleep behaviour.
    - Docs pages to create/edit:
      - README; CHANGELOG.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: The semanticization job — episodes to semantic knowledge
  - Acceptance Criteria:
    - Functional: **Selection.** Episodes and facts written since the cursor are clustered lexically, by shared files, keywords and subject keys. A cluster where the same claim recurs across ≥ `sleep.semanticize.minEpisodes` (3) episodes in ≥ 2 sessions is a candidate.
    - Functional: **Write.**
      - One model call per cluster, up to `maxClustersPerRun` (8).
      - It writes `fact`, `decision` or `preference` candidates that cite the supporting episodes and notes, or answers `none`. Each write carries retrieval cues in plan 219 Task 2's shape (entities, participants, questions, `when`), in the same call.
      - Each write passes Rehearsal's write gate (plan 219 Task 3).
      - The episodes stay; semanticization never deletes them, and the forgetting job archives them later by strength.
    - Functional: **Claim support** is measured at gate M-5 (Z2).
    - Performance: Calls are bounded. The README states calls per run and the `sleep.jobs` setting that excludes the job.
    - Code Quality: A job in the registry, with a prompt module that has its own tests.
    - Security:
      - Writes are candidates.
      - The cited episodes must be readable in the target scope, so a project episode never yields a user-scope fact unless the episode is user-scope.
      - The trust scan applies.
  - Approach:
    - Documentation Reviewed:
      - CLS (McClelland et al. 1995);
      - LightMem's sleep-time update;
      - `src/ltm/lexical.ts`;
      - design §5.7.
    - Options Considered:
      - Semanticize inside Rehearsal. Rejected: cross-session recurrence needs many episodes.
    - Chosen Approach:
      - Offline clustering over episodes.
    - API Notes and Examples:
      - n/a.
    - Files to Create/Edit:
      - `packages/memory/system/src/sleep/jobs/semanticize.ts` (new) and tests;
      - README; CHANGELOG.
    - References:
      - design §5.7.
  - Test Cases to Write:
    - `recurring_claim_across_episodes_becomes_candidate_fact`.
    - `single_episode_claim_not_semanticized`.
    - `semanticized_fact_respects_episode_scope`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — Sleep behaviour.
    - Docs pages to create/edit:
      - README; CHANGELOG.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: Procedure extraction, trigger acquisition and extinction, and skill proposals
  - Acceptance Criteria:
    - Functional: **Procedures.**
      - Successful episodes (`outcome: done`) sharing a task type or file area, ≥ `sleep.procedures.minEpisodes` (3), are clustered.
      - One call per cluster extracts a `procedure` (plan 220 Task 2 shape) citing the episodes, or answers `none`.
      - An existing procedure with the same `when` is updated by supersession, with lineage.
    - Functional: **Triggers.**
      - Failure signatures (normalised `error` events and error episodes) that recur after the same cue in ≥ `sleep.triggers.minPairings` (2) sessions become candidate triggers, with `origin: "sleep"` and response `remind`. A later verification can raise them to the stored response.
      - The batch extinction check runs here too, as plan 220 Task 4's in-session rule over the period.
      - No model call: matching is deterministic.
    - Functional: **Skill proposals.** The job calls plan 220 Task 3's `memory:skills:propose` for eligible procedures. The confirmation goes through `host.ui` when a session context exists; otherwise the proposals are listed in the report and in `memory:status` for the host.
    - Performance:
      - Procedure calls are bounded; triggers make no call.
      - The README states both, and the `sleep.jobs` exclusions.
    - Code Quality: Reuses plan 220's validator and matcher.
    - Security:
      - Triggers from Sleep start as `remind`, escalate-only (I10).
      - Skill proposals still need a person.
  - Approach:
    - Documentation Reviewed:
      - Memp; Agent Workflow Memory;
      - plan 220 Tasks 2–4;
      - design §5.7.
    - Options Considered:
      - Extract procedures from a single episode. Rejected: one success is anecdote, and Rehearsal already records explicit how-to.
    - Chosen Approach:
      - Repetition-gated extraction offline.
    - API Notes and Examples:
      - n/a.
    - Files to Create/Edit:
      - `packages/memory/system/src/sleep/jobs/{procedures,triggers,skills}.ts` (new) and tests;
      - README; CHANGELOG.
    - References:
      - design §5.6.2, §5.7.
  - Test Cases to Write:
    - `three_successful_episodes_yield_a_cited_procedure`.
    - `existing_procedure_superseded_with_lineage`.
    - `recurring_failure_after_cue_yields_remind_trigger_without_call`.
    - `sleep_lists_skill_proposals_without_session`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — Sleep behaviour.
    - Docs pages to create/edit:
      - README; CHANGELOG.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: The offline sleep lifecycle and growth simulation
  - Acceptance Criteria:
    - Functional: **Fixture.** The plan 219 multi-session fixture runs with sleep cycles (one sleep every 3 sessions and every 6 sessions) and without sleep. Its probes (`mechanism-probes/sleep.mjs`) check:
      1. cursor incrementality;
      2. the leases;
      3. budget stops;
      4. forgetting matches the retired maintain;
      5. duplicates merge;
      6. conflicts keep history;
      7. semanticization needs recurrence;
      8. procedures need ≥ 3 successes;
      9. triggers start as `remind`;
      10. episodes are never edited.
    - Functional: **Growth.** `growth.mjs` gains a `sleep` arm: month-12 retrieval and store bytes with nightly sleep against plan 210's growth evidence (Z3, offline preview). Retrieval at month 12 is measured with plan 219.1's `retrieval-bench.mjs` on the grown store (candidate recall@32 and all-required coverage), not only hit@k.
    - Performance: The offline run takes under 30 minutes.
    - Code Quality: Through the harness.
    - Security: A seeded cross-scope case proves Sleep never moves content to a scope its sources do not cover.
  - Approach:
    - Documentation Reviewed:
      - `scripts/memory-bench/growth.mjs`;
      - plan 210 `offline/growth-*`.
    - Options Considered:
      - n/a.
    - Chosen Approach:
      - Exact probes and an offline growth preview.
    - API Notes and Examples:
      ```sh
      timeout 1800 bun scripts/memory-bench/mechanism-probes/run.mjs --only sleep
      timeout 3600 bun scripts/memory-bench/growth.mjs --offline --arm sleep
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/mechanism-probes/{sleep.mjs,probes.test.mjs}`;
      - `scripts/memory-bench/{growth.mjs,growth.test.mjs}`;
      - `scripts/memory-bench/fixtures/memory-model/multi-session/**`;
      - `scripts/memory-bench/README.md`.
    - References:
      - plan 216 Task 2.
  - Test Cases to Write:
    - `sleep_probe_covers_probes_1_to_10`.
    - `growth_sleep_arm_reports_retrieval_and_bytes`.
    - `sleep_never_widens_scope`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — harness.
    - Docs pages to create/edit:
      - `scripts/memory-bench/README.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7: Gate M-5 — live Sleep efficacy (paid), and plan end
  - Acceptance Criteria:
    - Functional: **Gate record.** `docs/_evidence/memory-bench/221/gates/owner-gate-m5.json` gives the budget, the models (C-1's paid roles unless the owner names others; never `openrouter/free`), the arms, partitions and caps. The run starts on the owner's word.
    - Functional: **Arms** (development partitions):
      - `full`: plan 220's `+all`, with a sleep every 3 sessions;
      - `no-sleep`: the same without Sleep.

      They run on:
      - live multi-session lifecycles on the work-outcome families (W1–W4) and the `recurring-failure` family;
      - MemoryArena's development partition, run across sessions with a sleep every 3 sessions;
      - STATE-Bench's Agent Learning Track (Z1).

      Amended 2026-11-12 by plan 218.1, replacing `longmemeval-m` multi-session and `beam-1m`.

      Z2 uses the claim-support panel on semanticized notes (calibrated in plan 222 if available; otherwise assistant labels as development evidence, repeated in plan 223). Z3 is the growth simulation with live write sides. Z4 is cost against the gate's stated budget.
    - Functional: **Verdicts.** Z1–Z4 come from `acceptance-report.mjs --plan memory-model --gate M-5`. A miss goes to the owner before plan 222, and one fix round is allowed.
    - Functional: **Plan 210 transfers.** `lifecycle.maintain` and `lifecycle.archive-revival` get their final disposition in `docs/_evidence/memory-bench/210/decisions.md` from this gate (Z1, Z3). `lifecycle.duplicate-merge` is Task 3's.
    - Functional: **Plan end.** Compromises, Further Actions, and the backlog hand-off.
    - Performance: Reports per-job calls and tokens per run, writes by kind, verified share of Sleep writes after N sessions, cost and wall time.
    - Code Quality: The same campaign machinery.
    - Security: The safety suite runs live on `full`, including a Sleep poisoning case (a poisoned episode recurring three times). Evidence carries counts, ids and hashes only.
  - Approach:
    - Documentation Reviewed:
      - plan 220 Task 8;
      - plan 216 Task 2.
    - Options Considered:
      - Per-job add-one arms. Deferred: one `full` vs `no-sleep` screen first, with per-job arms only if Z1 misses (the fix round).
    - Chosen Approach:
      - A paired multi-session screen.
    - API Notes and Examples:
      ```sh
      timeout 28800 bun scripts/memory-bench/campaign.mjs --plan memory-model --gate M-5 --manifest --partition dev
      ```
    - Files to Create/Edit:
      - `docs/_evidence/memory-bench/221/**`;
      - this plan; `plans/backlog.md`.
    - References:
      - plan 216 Task 2.
  - Test Cases to Write:
    - `gate_m5_arms_paired_on_identical_items`.
    - `m5_offline_rows_pass_before_paid_run`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evidence.
    - Docs pages to create/edit:
      - the evidence README; the README's measured-role paragraph.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 1200 bun run typecheck`
- `timeout 900 bun run --cwd packages/memory/system test`
- `timeout 1800 bun scripts/memory-bench/mechanism-probes/run.mjs --only stm,wm,rehearsal,non-declarative,sleep`
- `timeout 3600 bun scripts/memory-bench/growth.mjs --offline --arm sleep`
- `timeout 900 bun test --timeout=0 scripts/memory-bench`
- `timeout 3600 bun scripts/memory-bench/safety/run.mjs --suite offline`
- `timeout 900 bun examples/memory-sleep.ts`
- `timeout 900 bun run --filter @arnilo/prism-agent test`
- `timeout 600 bun test --timeout=0 src/__tests__/docs.test.ts`
- `timeout 1800 bun scripts/release.mjs gate`
- `timeout 300 bunx biome check <changed files>`
- Paid, after gate M-5: the Task 7 campaign and report; confirm no owned paid process remains.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
