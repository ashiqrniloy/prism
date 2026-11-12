# Phase 11 Part O20 — Memory system: Rehearsal, episodic and semantic long-term memory, one recall surface

> **Amended 2026-11-10 (plan 224 Task 2):** package names follow the seven-bundle map of roadmap Part 3 — `@arnilo/prism-memory-system` (the bundle root `.` and its `/core` subpath) and `@arnilo/prism-knowledge/{wiki, rag}`. Directories do not change, so read every name below as that specifier once plan 224 Task 8 lands.

> **Amended 2026-11-12 (owner, benchmark decision; [plan 218.1](218.1-Phase-11-Part-O19.1-Memory-Benchmarks-External-Outcome-Suites-Replace-BEAM-And-LongMemEval.md)):** `beam-1m` and `longmemeval-m` leave every memory-model gate. They are QA over imported chat logs, not this product's work, and at about 1M tokens a question they cannot reach a deciding sample. Plan 218.1 runs a lean external screen on Compact-Bench for the session tiers. MemoryArena (declarative LTM across sessions) and STATE-Bench's Agent Learning Track (procedural learning and Sleep) are the chosen replacements below, but their adoption is **deferred** (owner, 2026-11-12: cost and time); their rows read `missing` until an adoption task runs before this plan's gate. Plan 218.1 Task 1 re-scopes the criteria rows to match. `locomo` and `memoryagentbench-cr` stay until the owner decides on them.

## Objectives

- Turn today's dropper into **Rehearsal**, the only door into long-term memory (design §5.5):
  - **Triggers:**
    - episode end (the main path);
    - the WM budget backstop (`rehearsal.triggerTokens`, default 80,000);
    - the programmatic API;
    - the user command;
    - a bounded best-effort pass on dispose.
  - **Judgment.** It weighs WM against the episode *and* the project.
  - **Output.** It shrinks WM toward `rehearsal.targetRatio` (default 0.2) as pressure, and writes typed LTM candidates with provenance.
- Add the stored, immutable **episodic** kind, and route **semantic** writes (facts, preferences, decisions) through Rehearsal in place of the retired session-consolidation path.
- Make `memory.recall` the one recall surface across tiers, and close the **reconsolidation** loop so candidates earn trust by use.
- Measure Rehearsal live (gate M-3, rows R1–R6). Also run the F4 diagnosis and the conditional fact-extraction question moved from plan 210.

## Expected Outcome

- `kind: "episode"` stored rows: when, where, what, outcome, files and citations. Immutable (I8), with temporal recall.
- The Rehearsal pass:
  - protections enforced in code;
  - WM shrink with tombstones;
  - chunk references moved to the LTM notes that cite them;
  - candidates written through LTM's existing write gates, each carrying retrieval cues (entities, participants, the questions it answers, `when`);
  - `memory:rehearse`, `memory:episode:end`, `rehearse()` and `endEpisode()` on the service.
- The `promote` option, `memory:consolidate`, the extractor, gather and the observational promotion path are retired.
- `memory.recall` resolves STM and WM ids, tombstones and chunks as well as LTM; the session `recall` tool is retired.
- `recalled` STM events feed Rehearsal's strengthen, correct and flag decisions, and verification by use.
- A multi-session offline lifecycle fixture, probes, and gate M-3's verdicts in `docs/_evidence/memory-bench/219/`.

This implements roadmap Phase 11 "Memory model", parts Rehearsal and declarative LTM, after plan 218 and before plan 219.1 (retrieval, inserted 2026-11-08). Plan 219.1 indexes the cues this plan writes and rebuilds query recall over them; this plan keeps today's ranking. It carries plan 210 Task 7.5 (dropped 2026-11-08). It also takes plan 210 Task 5's F4 leg, the conditional plan 202 Task 17 arm and the "OM/promotion" closure row (moved 2026-11-08).

**No review task:** every seam is package-internal (the LTM write path, the chunk store, the session tiers). The `episode` kind is a record-format addition to the package's own store; its OKF codec changes come with forward-compatibility tests, as `okf.forward-compat` requires.

No version bump and no publish.

## Tasks

- [ ] Task 1: Stored, immutable episodic memory
  - Acceptance Criteria:
    - Functional: **Shape.** `kind: "episode"` (reserved since plan 216 Task 7) stores `{ title, narrative, startedAt, endedAt, sessionId, project, scopeHash?, outcome: "done" | "partial" | "abandoned", files?, sourceIds (STM/WM ids and session entry ids), chunkRefs?, tags? }`.
      - The OKF codec writes it under `episodes/<yyyy>/<mm>/`.
      - A store from before the change reads unchanged (`okf.forward-compat`).
    - Functional: **Immutability (I8).**
      - `memory.replace`, `supersedes` and the LTM write path refuse to modify an episode, answering `episode_immutable`.
      - Only archive (lifecycle), `memory.forget` (deletion cascade) and legal holds act on it.
      - A correction of what happened is a *new* episode citing the old one with `corrects`. Both stay readable, and recall prefers the correcting one.
    - Functional: **Temporal recall.**
      - `memory.recall` accepts `{ kinds: ["episode"], from?, to? }`, filtering on the episode's own `startedAt`/`endedAt`.
      - Plan 210 Task 7 removes the exchange `timeline` (resolved dates, `from`/`to` windows, time order), measured negative in wave 1. These episode options are new, read only episode fields, and reuse no removed config field.
      - Ranking is unchanged here. A time-proximity term for time expressions in the query is plan 219.1 Task 5's measured query cue.
      - Episodes are not passively injected by default. They reach the agent through recall, and through plan 220's exemplar priming when that is on.
    - Functional: **Chunks.** An episode may cite chunks (`ref` by the LTM referrer), so verbatim evidence of what happened outlives the session tiers. Rehearsal decides which (Task 2), within `ltm.episodes.maxChunkBytes` per episode (16 KB, tuning).
    - Performance: Episode writes are one store write each. Storage per episode is reported on the fixture. The README states the growth per 100 sessions and the `rehearsal.episodes: false` default that avoids it.
    - Code Quality: The episode kind lives in `ltm/types.ts` with its own validator. The compat baseline is regenerated.
    - Security: Every LTM gate applies:
      - redaction and the trust scan before write;
      - scope from the session (project by default);
      - consent and legal holds;
      - deletion cascade to chunk referrers.
  - Approach:
    - Documentation Reviewed:
      - `src/ltm/{types,create,lifecycle/*,recall}.ts`;
      - `packages/memory/core/src/fabric/okf.ts`;
      - plan 202 Task 6 (timeline);
      - design §5.6.1, I8.
    - Options Considered:
      - Episodes as revisable facts. Rejected (I8): an event happened; a correction is a new event.
      - Store episodes only as exchanges. Rejected: an exchange is one turn, while an episode spans a task with its outcome and changes.
    - Chosen Approach:
      - A stored immutable kind with optional chunk evidence.
    - API Notes and Examples:
      ```json
      { "kind": "episode", "title": "Campaign retry fix", "narrative": "Interrupted attempts no longer count toward maxAttempts; retryUncounted added; 35 tests pass.", "startedAt": "2026-11-08T09:10:00Z", "endedAt": "2026-11-08T10:02:00Z", "outcome": "done", "files": ["scripts/memory-bench/campaign.mjs"] }
      ```
    - Files to Create/Edit:
      - `packages/memory/system/src/ltm/{types,create,recall,tools,lifecycle/*}.ts` and tests;
      - `packages/memory/core/src/fabric/{okf,layout}.ts` and tests;
      - README (`## Episodic memory`); CHANGELOG; compat baselines.
    - References:
      - design §5.6.1.
  - Test Cases to Write:
    - `episode_round_trips_and_older_store_reads_unchanged`.
    - `episode_update_and_supersede_refused`.
    - `correcting_episode_preferred_and_both_readable`.
    - `temporal_recall_filters_by_range_and_atemporal_unchanged`.
    - `forgetting_episode_unrefs_its_chunks`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new kind and recall options.
    - Docs pages to create/edit:
      - README (`## Episodic memory`, recall options); CHANGELOG.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: The Rehearsal pass
  - Acceptance Criteria:
    - Functional: **Triggers:**
      1. `memory:episode:end`, or `memory.system.endEpisode(session)`: one pass judged against the project, then `memory.session.episode.ended` is recorded, and a new scope may start the next episode;
      2. the WM surface ≥ `rehearsal.triggerTokens` (80,000; tuning, host-set): a mid-episode pass judged against the episode scope and the project;
      3. `memory:rehearse` or `memory.system.rehearse(session)`: a pass now;
      4. dispose without an episode end: one bounded best-effort pass (`rehearsal.disposeTimeoutMs`, 20,000) that records `skipped` on failure or timeout.
    - Functional: **Input:**
      - the scope;
      - the project context: the standing-rules block and the directory summary already built for the session, at no added query;
      - the WM items with chunk sizes and salience;
      - the `budget_unmet` records;
      - the LTM notes WM items cite.
    - Functional: **Tools:**
      - `retain { wmId }` keeps the item in WM;
      - `release { wmId, reason }` tombstones it;
      - `write_episode { … , sourceIds, chunkRefs?, cues? }`;
      - `write_note { kind: fact | preference | decision | procedure, text, scope: user | project | path, appliesTo?, relevance, sourceIds, chunkRefs?, cues? }`.
    - Functional: **Retrieval cues (design §5.11 stage 1; owner, 2026-11-08).**
      - `cues { entities?: string[] (≤ 8), participants?: string[] (≤ 4), questions?: string[] (1–3, each ≤ 120 characters), when?: { from, to? } }`. They are written in the same call, with no extra model call.
      - Cues are stored on the note, included in `lexicalKeys` (so today's index uses them at once), and validated, with each limit refused by name (`cue_limit`).
      - They are redacted and trust-scanned with the note.
      - An agent-written note may carry cues too; none are invented for it.
      - Cues are distinct from the removed `write.keyword-enrichment` (deterministic keywords on exchanges): they are model-written on Rehearsal notes, and plan 219.1 measures them with its `RT-cues` leave-one-out.

      Every WM item in the pass gets `retain` or `release`, and a release may carry writes. Each tool returns `ok: false` with a named reason when nothing is stored.
    - Functional: **Compression.** The WM surface after the pass aims at ≤ `rehearsal.targetRatio` × its size before (0.2, host-set), under plan 218 Task 3's protections, which this pass shares, and `budget_unmet`.
    - Functional: **Protections, enforced in code.** These are refused with `protected`:
      - releasing an item cited by the task state or an active WM fact during the episode;
      - at episode end, releasing a `project`-scoped WM fact of relevance `high` or `critical` without writing it to LTM, unless the reason is `superseded` or `duplicate`.
    - Functional: **Writes go through LTM's write path (I9).**
      - Each write is a `candidate` with `generated: { by: "rehearsal", at, session }` and `sourceIds`.
      - It passes write-time consolidation, the never-demote rule, the trust scan, redaction, the scope and consent rules, and plan 220's procedure validator (until then `procedure` uses today's lesson validator).
      - Rejections are counted by reason (`trust`, `secret`, `ephemeral`, `derivable`, `scope`), reusing the retired gate's reasons (Task 3).
    - Functional: **Chunks.** In one transaction:
      - a written note that cites chunks `ref`s them;
      - a released WM item `unref`s;
      - zero-referrer chunks are hard-deleted.
    - Functional: **Only Rehearsal and WM release surface.** A test spies on the chunk store and the tombstone writer across the fixture: no other code path (STM, compaction, recall, LTM tools) tombstones or unrefs.
    - Functional: **Status.** `memory:session:status` and `memory.rehearsal.completed` report counts: retained, released, written by kind, rejected by reason, chunks deleted, `budget_unmet`, model calls.
    - Performance:
      - One call per trigger; one per episode end.
      - Episode-end-first sizing: the README shows the budget arithmetic (design §5.5) and states that the 80k backstop rarely fires in ordinary sessions.
      - The dispose pass is bounded.
      - Cue output tokens per episode are reported; plan 219.1's T8 bounds them at 15% of Rehearsal output tokens.
    - Code Quality:
      - Today's `runDropper` and `dropObservationsToTarget` are replaced (no alias). The deterministic policy keeps protected items and releases lowest-relevance items first, writing nothing.
      - The `om.dropper.policy` ablation keys in `variants.mjs` and `cleanup-campaign.mjs` are updated.
      - Baselines are regenerated.
    - Security:
      - The scope stays delimited.
      - Writes cannot target `agent` scope (the widening rule stands).
      - A Rehearsal prompt cannot release protected items or delete chunks directly.
  - Approach:
    - Documentation Reviewed:
      - `src/session/workers/dropper.ts` (moved from `observational/src/workers/dropper.ts:6-83`);
      - `flush.ts:165-190`;
      - `src/ltm/{create,promote,consolidation/score}.ts`;
      - plan 210 Task 7.5 (carried);
      - design §5.5.
    - Options Considered:
      - A separate promote pass after Rehearsal. Rejected: two doors into LTM split the trust model, and promotion's measured use-verified share was 0.
      - Write `verified` notes directly. Rejected (I9).
    - Chosen Approach:
      - One pass that retains or releases every WM item and writes typed candidates through the existing gates.
    - API Notes and Examples:
      ```ts
      await agent.commands.run("memory:episode:end", {}, { session });
      const report = await memory.rehearse(session); // { retained, released, written: { episode: 1, fact: 3 }, rejected: { secret: 1 }, chunksDeleted: 12 }
      ```
    - Files to Create/Edit:
      - `packages/memory/system/src/session/{workers/rehearsal,flush,protections,commands,state,config}.ts` and tests;
      - `src/service.ts`; `src/chunks.ts`;
      - `scripts/memory-bench/{variants,cleanup-campaign}.mjs`;
      - README (`## Rehearsal`, cost); CHANGELOG; the compat baseline.
    - References:
      - design §5.5.
  - Test Cases to Write:
    - `episode_end_pass_judges_against_project_and_records_end`.
    - `backstop_and_api_and_command_trigger_one_pass`.
    - `dispose_without_episode_end_runs_bounded_best_effort_pass`.
    - `every_wm_item_retained_or_released`.
    - `protected_release_refused`.
    - `writes_are_candidates_through_ltm_gates_with_provenance`.
    - `cues_stored_indexed_redacted_and_limits_refused_by_name`.
    - `chunk_ref_transfer_and_zero_referrer_deletion_in_one_transaction`.
    - `only_wm_and_rehearsal_release_surface`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — commands, service, tools, LTM writes.
    - Docs pages to create/edit:
      - README (`## Rehearsal`, `## Commands`, `## Cost, security, and failure behavior`); CHANGELOG.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: Retire session consolidation and the observational promotion path
  - Acceptance Criteria:
    - Functional: **Removed, with no alias:**
      - LTM's `promote` option;
      - `memory:consolidate`;
      - `fabric.consolidate(...)` (now `ltm.consolidate`);
      - the consolidation extractor, gather, score and prompts (`src/ltm/consolidation/**`);
      - the `turn.completed` and `session.opened` consolidation triggers;
      - the observational-material checks (`hasNewObservationalMaterial`);
      - the reflection-backed `fact`/`procedure` promotion (moved from `create.ts:393-413`).

      A config with `promote` fails with `promote_retired` and a hint to Rehearsal. `docs/migrate-to-0.13.md` gains the rows.
    - Functional: **Kept, by moving into Rehearsal's write gate:**
      - the rejection reasons and the trust, secret, ephemeral and derivable checks;
      - narrowing by contradiction (an exception note with `overrides`);
      - reconsolidation of a `reconsolidate: true` note (Task 5).

      Tests prove each behaviour through Rehearsal.
    - Functional: **Sweep** over the usual roots for the removed names.
    - Functional: **Plan 210 transfer.** The `write.session-consolidation` and `write.om-promotion` rows get their final disposition (`replaced by Rehearsal`).
    - Performance: Removes the extractor's model call per pass. `memory:status`'s consolidation counts are replaced by Rehearsal's report.
    - Code Quality: Whole removal. Baselines are regenerated and attributed.
    - Security: No safety-proven row loses a test: each moved check keeps its named test.
  - Approach:
    - Documentation Reviewed:
      - `src/ltm/consolidation/{gather,extract,score,write,pass,prompts}.ts`;
      - the LTM README "Consolidation from sessions";
      - plan 188.3.
    - Options Considered:
      - Keep `promote` as an alternative door. Rejected: one door (design §5.5), and a measured use-verified share of 0.
    - Chosen Approach:
      - Retire the pass, and keep its gates inside Rehearsal.
    - API Notes and Examples:
      - n/a.
    - Files to Create/Edit:
      - `packages/memory/system/src/ltm/{consolidation/**,index,config,create,promote,commands}.ts` and tests;
      - `src/session/workers/rehearsal.ts` (gate);
      - `apps/prism-agent/**` (if it sets `promote`); `examples/**`; `scripts/memory-bench/**`;
      - README; `docs/migrate-to-0.13.md`; CHANGELOG; baselines;
      - `docs/_evidence/memory-bench/210/decisions.md`.
    - References:
      - plan 202 Task 16 evidence (use-verified share 0).
  - Test Cases to Write:
    - `promote_config_fails_with_rehearsal_hint`.
    - `rehearsal_gate_rejects_secret_ephemeral_derivable_and_untrusted`.
    - `rehearsal_contradiction_writes_narrower_exception`.
    - `consolidation_names_absent_repo_wide`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — removed option and command.
    - Docs pages to create/edit:
      - README; `docs/migrate-to-0.13.md`; CHANGELOG.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: One recall surface — `memory.recall` across tiers
  - Acceptance Criteria:
    - Functional: **Session ids.**
      - `memory.recall { ids: [...] }` resolves STM ids, WM ids and tombstones (with their reason) and returns chunk text verbatim. `chunk dropped: <reason>` appears when the backing is gone.
      - `memory.read` accepts the same ids.
      - Query recall searches LTM only, as today. Session tiers are reached by id, from the rendered surface or a citation, so recall never mixes this session's raw work into LTM ranking.
    - Functional: **Retirement.**
      - The session `recall` tool (`packages/memory/system/src/session/recall-tool.ts`) is retired, along with its config switch (`recall`).
      - The context block's instruction now says "call `memory.recall` with an id".
      - A config with `recall` fails with `option_retired`.
    - Functional: **`ltm: false` profiles.** With LTM off, `memory.recall` is still registered, read-only and session-tier only, so the `stm` and `session` profiles keep recall (plan 216 Task 6 profiles).
    - Functional: **Reference host and examples** move. The memory skill text is not written here (plan 223 Task 5).
    - Performance: Id resolution is an in-memory fold plus chunk reads; no store query for session ids.
    - Code Quality: One tool, one resolver per tier. Plan 217 Task 4's recall code moves behind it.
    - Security:
      - Session ids resolve only for the executing session and its ancestors.
      - LTM ACLs are unchanged.
      - Chunks never appear in passive delivery.
  - Approach:
    - Documentation Reviewed:
      - `src/ltm/{tools,recall}.ts`;
      - `src/session/{recall,recall-tool}.ts`;
      - roadmap §2 "one retrieval surface";
      - design §5.8.
    - Options Considered:
      - Keep two tools. Rejected: the agent should not have to know which tier holds an id.
    - Chosen Approach:
      - One tool with per-tier resolvers.
    - API Notes and Examples:
      ```json
      { "tool": "memory.recall", "input": { "ids": ["a1b2c3d4e5f6"] } }
      ```
    - Files to Create/Edit:
      - `packages/memory/system/src/{ltm/tools,ltm/recall,session/recall,session/render,index}.ts` and tests;
      - `apps/prism-agent/**`; `examples/**`;
      - README (`## Recall`); `docs/migrate-to-0.13.md`; CHANGELOG; baseline.
    - References:
      - design §5.8; plan 216 Task 6 profiles.
  - Test Cases to Write:
    - `memory_recall_resolves_stm_wm_tombstone_and_chunk`.
    - `query_recall_never_ranks_session_tier_items`.
    - `session_recall_tool_retired`.
    - `stm_only_profile_keeps_read_only_recall`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — tool retirement and recall input.
    - Docs pages to create/edit:
      - README; `docs/migrate-to-0.13.md`; CHANGELOG.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: Reconsolidation and verification by use
  - Acceptance Criteria:
    - Functional: **`recalled` events.** When the agent cites (`[id]`) an LTM note that was delivered or recalled in this session, STM records a `recalled` event citing the note id. The citation tracker already detects the citation; no model call is needed.
    - Functional: **Rehearsal acts on recalled notes.** Its input includes the recalled notes, with the episode evidence around each use. For each it may:
      - `strengthen` (one use for verification);
      - `correct` (a superseding note with lineage; never for an episode — a correcting episode instead);
      - `flag` (harmful evidence, which lowers S).
    - Functional: **Verification by use** (the transferred `lifecycle.verification` row):
      - a candidate becomes `verified` after uses across `lifecycle.verifyAfterSessions` distinct sessions (default 2) with no harmful evidence, as today;
      - a Rehearsal `strengthen` in a session counts as that session's use;
      - the row's disposition is recorded.
    - Performance: One `recalled` record per cited note per session (habituated). No extra call: it rides Rehearsal's pass.
    - Code Quality: Uses the existing lifecycle events (`lifecycle/events.ts`). No second counter.
    - Security: `flag` cannot delete. A flagged note is quarantined from passive delivery under the existing rule.
  - Approach:
    - Documentation Reviewed:
      - `src/ltm/lifecycle/{events,status,strength}.ts`;
      - the citation tracker;
      - Nader et al. 2000;
      - design §5.9.
    - Options Considered:
      - Verify by citation alone (today). Kept, and Rehearsal's judgment is added on top: a citation followed by a correction should not count as a use.
    - Chosen Approach:
      - Use events plus Rehearsal's decision.
    - API Notes and Examples:
      - n/a.
    - Files to Create/Edit:
      - `packages/memory/system/src/{session/workers/stm,session/workers/rehearsal,ltm/lifecycle/events,ltm/lifecycle/status}.ts` and tests;
      - README (`## Reconsolidation`);
      - `docs/_evidence/memory-bench/210/decisions.md`.
    - References:
      - design §5.9.
  - Test Cases to Write:
    - `citing_a_delivered_note_records_recalled_event`.
    - `rehearsal_strengthen_counts_as_session_use`.
    - `correction_after_citation_does_not_verify`.
    - `episode_correction_writes_correcting_episode`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — lifecycle behaviour.
    - Docs pages to create/edit:
      - README; CHANGELOG.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: The multi-session lifecycle fixture and Rehearsal probes
  - Acceptance Criteria:
    - Functional: **Fixture.** `scripts/memory-bench/fixtures/memory-model/multi-session/` builds on plan 202 Task 16's offline lifecycle suite (seven seeds, 24 sessions each, zero model calls, via scripted workers). It has:
      - episodes with scopes;
      - preferences stated once;
      - decisions later superseded;
      - a fact needed three sessions later;
      - a correction after recall;
      - a dispose without an episode end.
    - Functional: **Probes** (`mechanism-probes/rehearsal.mjs`):
      1. Rehearsal fires at episode end, and on the backstop only past 80k;
      2. every WM item is retained or released;
      3. protected releases are refused;
      4. writes are candidates with provenance;
      5. the preference survives as a user-scope note and is delivered by standing rules once verified;
      6. episodes are immutable and corrections link;
      7. after an episode end, only retained WM, LTM notes and their cited chunks remain, and the chunk store shrinks accordingly;
      8. only WM and Rehearsal released surface;
      9. `memory.recall` resolves every tier;
      10. the offline use-verified share is reported (the R1 preview).
    - Performance: The fixture runs offline in under 20 minutes.
    - Code Quality: Through the probe harness and plan 202's lifecycle runner.
    - Security: A seeded poisoning attempt in a session (an instruction-like "fact") is rejected by the trust scan at Rehearsal's write.
  - Approach:
    - Documentation Reviewed:
      - `scripts/memory-bench/lifecycle/**`;
      - `scripts/memory-bench/observational-role.mjs` (plan 202 Task 16).
    - Options Considered:
      - Live only. Rejected: probes 1–9 are exact properties.
    - Chosen Approach:
      - An offline exact fixture, then the live gate.
    - API Notes and Examples:
      ```sh
      timeout 1800 bun scripts/memory-bench/mechanism-probes/run.mjs --only rehearsal
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/fixtures/memory-model/multi-session/**`;
      - `scripts/memory-bench/mechanism-probes/{rehearsal.mjs,probes.test.mjs}`;
      - `scripts/memory-bench/lifecycle/**`;
      - `scripts/memory-bench/README.md`.
    - References:
      - plan 216 Task 2 fixture index.
  - Test Cases to Write:
    - `rehearsal_probe_covers_probes_1_to_10`.
    - `seeded_poisoned_fact_rejected_at_rehearsal_write`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — harness.
    - Docs pages to create/edit:
      - `scripts/memory-bench/README.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7: Gate M-3 — live Rehearsal efficacy, the F4 diagnosis, the fact-extraction disposition (paid), and plan end
  - Acceptance Criteria:
    - Functional: **Gate record.** `docs/_evidence/memory-bench/219/gates/owner-gate-m3.json` gives the budget, the models (C-1's paid roles unless the owner names others; never `openrouter/free`), the arms, partitions and caps. The run starts on the owner's word.
    - Functional: **Arms** (development partitions):
      - `full-r`: `stm` + `wm` + `rehearsal` + `ltm`;
      - `session`: no Rehearsal, LTM present but written only by the agent;
      - `P`: LTM only, with exchanges (plan 210's slimmed preset).

      They run on:
      - the work-outcome suite (W1–W3, both families);
      - a live multi-session lifecycle on the `long-session` family run across sessions;
      - MemoryArena's development partition, scored by process score and success rate (R5); amended 2026-11-12 by plan 218.1, replacing `longmemeval-m` (multi-session and temporal strata) and `beam-1m`;
      - LoCoMo's temporal stratum (R6).
    - Functional: **Verdicts.** R1–R6 come from `acceptance-report.mjs --plan memory-model --gate M-3`. R5 and R6 report all-required evidence coverage per ability beside accuracy (plan 216 Task 2).
      - R3 uses the claim-support panel. If plan 222's calibration has not run yet, R3 is computed with assistant labels as development evidence, and plan 223 repeats it with a person's labels.
      - R4 runs plan 202's safety suite live on `full-r`.
      - A miss goes to the owner before plan 220, and one fix round is allowed.
    - Functional: **F4 and plan 202 Task 17 (moved from plan 210 Task 5, 2026-11-08).**
      - Run the pre-registered F4 residual-diagnosis protocol (`gap-analysis.md` § "202-task17", ≥ 5% rule, Task 13 shared-entity count) with `full-r` as the extraction path, plus the moved `f4-readtime` leg against `P`.
      - Record the plan 202 Task 17 disposition. The conditional `conversational-facts` preset is `not-needed` if Rehearsal's semantic writes meet the original Task 17 bars (exchange citations, scope and consent inheritance, unchanged `conversational`, ≤ 2% session failures, write cost per session and per 1k exchanges, cache-read/write tokens, target-ability benefit and no regression). Otherwise it is `unmeasured` with the failing bars named.
      - No separate extractor is built.
    - Functional: **Plan 210 transfers.** `om.dropper-model`, `om.dropper-lowest-relevance`, `om.recall-tool`, `write.om-promotion`, `write.session-consolidation`, `lifecycle.verification` and `write.exchange-steps` get their final disposition in `docs/_evidence/memory-bench/210/decisions.md`. For `write.exchange-steps`, the question is whether exchange step traces are still needed beside STM chunks and episodes; it is measured as a leave-one-out arm (`full-r` without steps) on the work-outcome families, added to this gate's arms. The plan 202 closure "OM/promotion" row is discharged.
    - Functional: **Store snapshots for plan 219.1.** The `full-r` LTM store of every development item is kept in the gitignored bench cache (`$PRISM_BENCH_CACHE/219/full-r`), with its hash in the evidence. Plan 219.1's offline retrieval bench opens these snapshots with `--store-from`.
    - Functional: **Plan end.** Compromises, Further Actions, and the backlog hand-off.
    - Performance: Reports Rehearsal calls and tokens per episode, writes per session by kind, rejection rates, chunk bytes at peak and after episode end, cost, cached-input share and p95.
    - Code Quality: The same campaign machinery. The F4 leg uses its pre-registered protocol unchanged.
    - Security: Evidence carries counts, ids and hashes only. Held-out partitions stay unread.
  - Approach:
    - Documentation Reviewed:
      - plan 210 Task 5 (moved F4 and Task 17 text);
      - `docs/_evidence/memory-bench/210/gap-analysis.md` § "202-task17";
      - `docs/_evidence/memory-bench/202/closure.md`;
      - plan 216 Task 2 criteria.
    - Options Considered:
      - Build the `conversational-facts` extractor if F4 qualifies (plan 210's conditional). Rejected: Rehearsal *is* the session fact writer now; a second extractor is a second door into LTM.
    - Chosen Approach:
      - Measure Rehearsal against the Task 17 bars, and record the disposition.
    - API Notes and Examples:
      ```sh
      timeout 28800 bun scripts/memory-bench/campaign.mjs --plan memory-model --gate M-3 --manifest --partition dev
      ```
    - Files to Create/Edit:
      - `docs/_evidence/memory-bench/219/**`;
      - `docs/_evidence/memory-bench/210/decisions.md`;
      - `docs/_evidence/memory-bench/202/closure.md` (the disposition link);
      - this plan; `plans/backlog.md`.
    - References:
      - plans 202, 210, 216.
  - Test Cases to Write:
    - `gate_m3_arms_paired_on_identical_items`.
    - `f4_protocol_pinned_and_unchanged`.
    - `task17_disposition_recorded_against_original_bars`.
    - `full_r_snapshots_kept_and_hashed_without_text_in_evidence`.
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
- `timeout 900 bun run --cwd packages/memory/core test`
- `timeout 1800 bun scripts/memory-bench/mechanism-probes/run.mjs --only stm,wm,rehearsal`
- `timeout 900 bun test --timeout=0 scripts/memory-bench`
- `timeout 3600 bun scripts/memory-bench/safety/run.mjs --suite offline`
- `timeout 3600 bun scripts/memory-bench/growth.mjs --offline`
- `timeout 900 bun run --filter @arnilo/prism-agent test`
- `timeout 900 bun examples/memory-system.ts`
- `timeout 600 bun test --timeout=0 src/__tests__/docs.test.ts`
- `timeout 1800 bun scripts/release.mjs gate`
- `timeout 300 bunx biome check <changed files>`
- Paid, after gate M-3: the Task 7 campaign, the F4 leg and the report; confirm no owned paid process remains.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
