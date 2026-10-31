# Phase 11 Part O15 — Memory for the working agent: standing rules, tool steps, cited lessons and work-outcome evaluation

## Objectives

- Close the gaps between Prism's memory and the design an agent would choose for itself (the 2026-10-31 first-principles assessment), without duplicating what plans 202 and 207 already build:
  - **The record includes what the agent did.** The exchange archive stores only user and assistant text today (`packages/memory/fabric/src/exchanges.ts:6–7,66–79` exclude tool calls and results). For a coding agent, the failed command and the fix are the evidence a repeated mistake needs. Archive a condensed, bounded trace of the tool steps of each exchange.
  - **Standing rules are the centre of the memory.** Make them one small, human-editable, always-loaded rule set per scope:
    - `core.md` becomes editable; an edit reconciles into notes instead of being overwritten (`packages/memory/fabric/README.md`, "Pinned core");
    - plan 202 Task 11's confirmed capture is generalized from coding decisions to preferences and procedures in every preset, behind an opt-in;
    - it has a fixed token budget and an explicit overflow rule.
  - **The agent keeps a cited notebook.** Lessons ("what I learned, what to do differently, gotchas") are written by the agent and must cite log evidence. Their retention follows use. A cheap nudge, with no model call, appears after turns that carry a lesson signal.
  - **Measure work, not trivia.** A work-outcome suite measures:
    - the rate of repeating a corrected mistake;
    - convention adherence across sessions;
    - questions re-asked;
    - orientation cost in a returning project;
    - lesson claim support.
    It uses plan 200's simulated users and state grading, with frozen label-blind partitions and pre-registered criteria.
- Feed the work-outcome evidence to plan 210: its feature audit, its held-out acceptance (including plan 208's O8 row) and the defaults and claims it sets.

## Expected Outcome

- Opt-in `exchanges.steps` archives a condensed step trace (tool, argument summary, outcome, first error line, entry pointer) inside each exchange note, trust-scanned and redacted.
- `rules` (opt-in) gives every preset:
  - confirmed lexical capture of standing rules;
  - an editable `rules.md` per scope that reconciles into pinned notes;
  - a budget of 2,000 tokens by default with path-scoped sections loaded on touch.
  Plan 202 Task 11's `coding` preset uses the same module.
- `memory.insert` accepts an optional `evidence` list, and a lesson is a `procedure` or `fact` note tagged `lesson` with required evidence links. Opt-in `lessons.nudge` adds one tail line after a signal turn.
- `scripts/memory-bench/work-outcome/` holds the suite, its partitions and `work-outcome-criteria.json`.
- An owner-gated development screen (gate W-1) that reports W1–W6 and plan 208's O8, one tuning revision, and this plan's features without a passing development row listed for plan 210's ledger. Plan 210 Task 9 runs the held-out work-outcome arms and plan 210 Task 10 decides this plan's defaults and claims.

This plan is a pre-publish part of roadmap **Phase 11** (memory, Part O, sub-part 15). **Owner decision 2026-10-31: it ships in 0.13.0.** It runs as release step **17e**:

- it runs after plan 208 (17d), so the `P+W+O` arm uses the ontology tier as plan 208 Task 5's revision froze it, and W5 reuses plan 208 Task 2's claim-support audit;
- plan 210 (17f) follows. The memory train is strictly sequential (owner decision 2026-10-31): 202 → 207 → 208 → 209 → 210 → 184 → 185;
- **Task 7 moved to plan 210 on 2026-10-31.** The held-out work-outcome arms are plan 210 Task 9, and this plan's defaults and the `PRODUCT.md` positioning are plan 210 Task 10. This plan ends at Task 6 with development evidence.

**Review task included** (Task 1): the plan changes fabric behavior (archive contents, `core.md` from derived to editable, a tool input) and adds config fields. **No kernel contract change** is planned; `run.end`, `turn.completed`, `context.build` and `host.ui` exist. A kernel need stops the plan. **No write-path generative model call** is added anywhere: capture is lexical plus confirmation, nudges are text, and lessons are written by the agent's own tool call in its normal turn. No version bump or publish.

## Tasks

- [ ] Task 1: Review and assumption check (read-only)
  - Acceptance Criteria:
    - Functional: **(a) Inventory with `file:line`:**
      - the exchange archive pairing rules and its excluded blocks (`exchanges.ts:6–79`);
      - the pinned core and `core.md` regeneration (`delivery/core.ts`, fabric README "Pinned core");
      - plan 202 Task 11's capture, confirmation and delivery code as landed;
      - `memory.insert`'s schema (`tools.ts`), `MemoryNoteLink` relations (`types.ts:92–98`);
      - the consolidation signal patterns (`CONSOLIDATION_PATTERNS`, explicit, correction and outcomes);
      - plan 200's `user-simulator.ts`, `scenario-runner.ts:95–228` and `state-match.ts:56` in `packages/hosts/evals/src`;
      - the 12-persona lifecycle suite (`scripts/memory-bench/lifecycle/persona.mjs`).
    - Functional: **(b) Verify:**
      1. tool call and result blocks are reachable from `message.completed`/`turn.completed` context without re-reading the branch;
      2. a `core.md` edit can be detected by the existing reconcile hash check;
      3. 202 Task 11's capture is a reusable module, or record the refactor Task 3 must do;
      4. a tail line added after a signal turn keeps the prefix byte-stable (plan 202 Task 4.12);
      5. the evals user simulator can drive multi-session scenarios against `createAgent` with a fabric store that persists across sessions.
    - Functional: **(c) Verdict** in the Notes.
    - Performance: n/a — read-only.
    - Code Quality: No code change.
    - Security: Records the trust boundaries the later tasks rely on: tool output is untrusted, `host.ui` confirmation, the trust scan.
  - Approach:
    - Documentation Reviewed:
      - the fabric README and source above;
      - plans 188.5, 188.9 Task 7, 200, 202 Task 11;
      - the 2026-10-31 first-principles assessment.
    - Options Considered:
      - Skip the review. Rejected: the plan changes archive contents and the meaning of `core.md`.
    - Chosen Approach:
      - Read-only verification first.
    - API Notes and Examples:
      - n/a.
    - Files to Create/Edit:
      - this plan (Notes only).
    - References:
      - `references/prism.md` §2.
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - none.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: Tool steps in the exchange archive (fabric)
  - Acceptance Criteria:
    - Functional: Opt-in `exchanges: { steps: true }` (contract field; default `false`, so `conversational` revision 1 and 2 are unchanged). Each archived exchange gains a `## Steps` section listing up to `exchanges.maxSteps` (tuning, default 24) tool rounds of that turn, in order. One line per step:
      - the tool name;
      - an argument summary (≤ 120 characters: the path, command or query field when the tool declares one, otherwise the first scalar argument);
      - the outcome (`ok` or `error`);
      - for an error, the first line of the error text (≤ 200 characters);
      - the session entry id of the tool result, so `memory.read { around }` and the host can reach the full output.
      Tool result bodies are never stored.
    - Functional: Step text is indexed lexically with the exchange, so "the migration failed with ENOENT" finds the exchange where it happened. The outcome patterns (`patterns.outcomes`) tag exchanges whose steps include a failed-then-passed sequence of the same command, as `outcome: fixed`.
    - Functional: Host impact: **none** unless the field is set.
    - Performance:
      - ≤ 24 short lines per exchange, about 1.5 KB at the caps; storage growth is stated per 1k turns in the README.
      - No extra store query: the steps are written in the same `fabric.exchange` background write.
      - Recall cost is unchanged, because excerpts stay query-centred.
    - Code Quality: In `exchanges.ts` next to the pairing logic, with one step-summary function and one table of per-tool argument fields that reads tools' declared schemas, not names.
    - Security:
      - Error lines and argument summaries come from tool output and tool input, which are untrusted. They pass the redactor and `scanScopedMemoryContent` before writing; a hit drops that step's text and keeps `outcome` only, counted in `memory:status`.
      - Steps are evidence, never extraction candidates. The 188.3 rule that tool output is never candidate text stays.
  - Approach:
    - Documentation Reviewed:
      - `exchanges.ts:1–277`;
      - `CONSOLIDATION_PATTERNS.outcomes`;
      - fabric README `## Exchange archive`;
      - LongMemEval-V2 (agents searching trajectory files outperform RAG) and SWE-Bench-CL (arXiv 2507.00014; experience reuse in coding).
    - Options Considered:
      - Archive full tool output. Rejected: unbounded size, secrets, and injection surface.
      - Separate step notes. Rejected: they would break the exchange as the unit of evidence and multiply notes.
    - Chosen Approach:
      - A bounded, redacted summary inside the exchange, with a pointer to the full output.
    - API Notes and Examples:
      ```markdown
      ## Steps
      - bash `bun test packages/memory` → error: ENOENT: no such file '.prism-memory.sqlite' (entry 01JD…)
      - edit `packages/memory/fabric/src/config.ts` → ok
      - bash `bun test packages/memory` → ok
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/{exchanges,config,types}.ts`;
      - tests;
      - fabric README (`## Exchange archive`, `## Config`, stability table, cost);
      - `scripts/compat-baseline/arnilo__prism-memory-fabric.txt` if the config type changes its declaration (regenerated with `bun scripts/release.mjs gate --update-baseline`, diff attributed in the note);
      - `CHANGELOG.md`.
    - References:
      - Task 1 (b) 1.
  - Test Cases to Write:
    - `steps_off_by_default_and_presets_unchanged`.
    - `steps_summarize_tool_rounds_without_bodies`.
    - `step_error_line_redacted_and_trust_scanned`.
    - `failed_then_passed_command_tagged_fixed`.
    - `step_text_is_lexically_recallable`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — an opt-in stored content.
    - Docs pages to create/edit:
      - fabric README;
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: Standing rules — editable `rules.md`, confirmed capture in every preset, a fixed budget (fabric)
  - Acceptance Criteria:
    - Functional: **One rules module.** Plan 202 Task 11's decision capture, confirmation and delivery move into `delivery/rules.ts` (or are written there if Task 11 landed elsewhere), with the `coding` preset as one consumer. A standing rule is an active `decision`, `preference` or `procedure` note that is pinned or path-scoped.
    - Functional: **Opt-in for every preset:** `rules: { capture: "confirm" | "off" }` (contract field; default `"off"`, and `"confirm"` under `coding`). With `confirm`:
      - user turns matching the explicit and correction cues produce `proposed` rules: a preference, a procedure, or a decision with its rationale;
      - one batched `host.ui` confirmation per turn makes them active and pinned;
      - a correction supersedes the old rule and keeps its history (plan 202 Task 11's rule);
      - `host.ui` answering `unavailable` leaves them `proposed`.
      No model call.
    - Functional: **Editable `rules.md`.** With the markdown store, the pinned core's per-scope `core.md` is renamed `rules.md` and becomes editable:
      - a person's edit is reconciled into notes: an added line becomes an active pinned rule with `generated.by: human`, a deleted line retires its note, and a changed line updates its note with correction lineage;
      - every edit passes the trust scan; a hit quarantines that line (the existing reconcile rule);
      - the 188.5 behavior that overwrote edits is removed;
      - the swept names include `core.md` in docs, tests and examples.
    - Functional: **Budget and overflow.** Standing rules have a fixed budget, `rules.maxTokens` (tuning, default 2,000, hard 3,000), and project-wide rules are always loaded within it:
      - path-scoped rules load as cues when their `appliesTo` matches a touched path (the existing cue budget);
      - over budget, the least-used non-human rules drop from the always-loaded block but stay recallable, and the directory says `rules: N shown, k more — memory.recall kind=rule`;
      - human-written rules are never dropped silently; overflow of human rules is a `memory:status` warning.
      The pinned core's budget fields (`core.maxTokens`) become the rules budget: a retirement with a sweep, not an alias.
    - Functional: Host impact: hosts that read `core.md` must read `rules.md` (migration entry). `core: { maxTokens }` is renamed `rules: { maxTokens }` under the same contract tier, recorded in `docs/migrate-to-0.13.md`, because 0.13.0 is unpublished.
    - Performance: Reconcile of `rules.md` is one hash compare per scope per session epoch. The rules block stays epoch-snapshotted (plan 202 Task 4.12); a human edit takes effect at the next epoch, and a retraction takes effect immediately (the existing retraction rule).
    - Code Quality: One module owns capture, confirmation, rendering, overflow and the reconcile of `rules.md`. The rename touches every caller of `createFabricCore` (`graft callers createFabricCore --depth all`) in this task.
    - Security:
      - Rules are captured only from user turns and human edits, never from tool output or assistant text.
      - Confirmation is through `host.ui`.
      - The poison canary must never become an active rule (plan 202 Task 14 probe).
  - Approach:
    - Documentation Reviewed:
      - fabric README "Pinned core", "Path cues", "The team store";
      - plan 202 Task 11 (decisions, confirmation, delivery);
      - MemoryCode (arXiv 2502.13791: instructions spread over sessions are lost);
      - the AGENTS.md study (arXiv 2602.11988: static context files at +20% cost with no significant gain, hence small, confirmed and current rules rather than a dump);
      - encoding specificity (Tulving & Thomson 1973) for path-cued rules.
    - Options Considered:
      - Keep `core.md` derived. Rejected: people cannot correct what the agent always reads, which is the highest-leverage edit in the system.
      - Auto-capture rules without confirmation. Rejected: one wrong rule contaminates every later session (ConsistencyGate's argument, plan 202 R18).
    - Chosen Approach:
      - Rules as the small, confirmed, human-editable centre of memory, with one module shared by every preset.
    - API Notes and Examples:
      ```ts
      memoryFabric({ preset: "conversational", rules: { capture: "confirm" }, tools: { root } });
      ```
      ```markdown
      <!-- notes/<tenant>/projects/<slug>--<id8>/rules.md (editable) -->
      - [d12] Validate inputs with zod, not yup. (why: memory.read d12)
      - [p03] Run memory suites with --timeout=0. (applies to packages/memory/**)
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/delivery/{rules,core,cues}.ts`, `src/{config,reconcile,directory,context,index,types}.ts`;
      - tests;
      - `apps/prism-agent/src/host/*` if it names `core`;
      - fabric README (`## Standing rules`, replacing "Pinned core"; stability table);
      - `docs/migrate-to-0.13.md`;
      - `scripts/compat-baseline/arnilo__prism-memory-fabric.txt` (regenerated, diff attributed);
      - `CHANGELOG.md`.
    - References:
      - Plan 202 Task 11; plan 188.5 Tasks 1–3.
  - Test Cases to Write:
    - `rules_capture_off_by_default_outside_coding`.
    - `confirmed_capture_pins_rule_and_unavailable_leaves_proposed`.
    - `rules_md_edit_adds_retires_and_updates_notes`.
    - `rules_md_edit_with_instruction_is_quarantined`.
    - `over_budget_drops_least_used_agent_rules_never_human_rules`.
    - `rules_block_epoch_stable_and_retraction_immediate`.
    - `retired_core_names_absent_repo_wide`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a renamed file and config field, an opt-in capture.
    - Docs pages to create/edit:
      - fabric README;
      - `docs/migrate-to-0.13.md`;
      - `apps/prism-agent/README.md` if affected;
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: The cited lesson notebook and the lesson nudge (fabric)
  - Acceptance Criteria:
    - Functional: **`memory.insert` gains optional `evidence`:** 1–8 note ids (exchanges, including their steps, or other notes) readable in the write scope. They are stored as `links` with relation `evidence`; an unreadable or foreign id rejects the write (`not_found`). The tool name and effects are unchanged (stable at API level 1); the parameter is additive.
    - Functional: **A lesson** is a `procedure` or `fact` written with `tags: ["lesson"]` and ≥ 1 `evidence` id. No new kind. Without evidence, a `lesson` tag is rejected (`lesson_requires_evidence`).
      - Lessons start as `candidate` and become verified by the existing use rule (cited or applied in a later session without correction).
      - A lesson unused for `lessons.archiveAfterSessions` (tuning, default 20) scope sessions is archived from default recall by the existing archive-with-revival rule, and never deleted.
    - Functional: **Nudge**, opt-in `lessons: { nudge: true }` (contract field; default off). After a turn carrying a signal, the next request's tail carries one line:
      ```text
      memory: this turn had <signal>; if there is a reusable lesson, record it: memory.insert { kind: "procedure", tags: ["lesson"], evidence: ["<exchange id>"] }
      ```
      - Signals: a correction cue, an explicit "remember" cue, a step trace tagged `outcome: fixed` (Task 2), or an approval denial.
      - At most once per `lessons.minTurnsBetweenNudges` (tuning, default 5).
      - Never in the prefix.
      - No model call.
    - Functional: Host impact: **none** unless a host uses the new parameter or opts in.
    - Performance: Nudge detection is pattern matching already done by consolidation gathering. One tail line, ≤ 60 tokens, on a signal turn only.
    - Code Quality: Evidence validation in `create.ts` next to `supersedes` validation; the nudge in `context.ts` tail assembly, reusing `gatherConsolidationCandidates`' signal detection.
    - Security:
      - A lesson's text passes the trust scan like every typed write.
      - Evidence must be in scope.
      - The nudge contains ids and fixed text only, never note content.
  - Approach:
    - Documentation Reviewed:
      - fabric `create.ts:127–208,505`, `tools.ts:587–735`, `consolidation/gather` signals;
      - the lifecycle verification and archive rules (188.4);
      - Reflexion and experience-reuse literature (verbal lessons help when grounded in trajectories);
      - ACE's playbook bullets.
    - Options Considered:
      - A background model call that writes lessons after each task. Rejected: it adds a write-path generative call; the working agent already has the context in its turn.
      - A new `lesson` kind. Rejected: `procedure` and `fact` with a tag and required evidence are enough, and a new kind needs a new opt-in name.
    - Chosen Approach:
      - The agent writes its own lessons, they are cited to evidence, nudged cheaply, and kept by use.
    - API Notes and Examples:
      ```json
      { "tool": "memory.insert", "input": { "kind": "procedure", "text": "Create the SQLite file's parent dir before running memory suites.", "tags": ["lesson"], "evidence": ["4f2a9c1e0b77"] } }
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/{create,tools,context,config,types}.ts`;
      - tests;
      - fabric README (`## Lessons`, `## Tools`, cost, stability table);
      - compat baseline if declarations change;
      - `CHANGELOG.md`.
    - References:
      - Tasks 2, 3.
  - Test Cases to Write:
    - `insert_evidence_links_and_rejects_foreign_ids`.
    - `lesson_tag_requires_evidence`.
    - `lesson_verified_by_use_and_archived_when_unused`.
    - `nudge_only_after_signal_and_rate_limited`.
    - `nudge_never_in_prefix_and_carries_no_note_text`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a tool parameter and an opt-in nudge.
    - Docs pages to create/edit:
      - fabric README;
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: The work-outcome suite and its pre-registered criteria
  - Acceptance Criteria:
    - Functional: `scripts/memory-bench/work-outcome/` builds multi-session scenarios run through `createAgent` with a persistent fabric store, driven by plan 200's user simulator and graded by state match and scripted checks. There are two families:
      - **coding**: the 12 lifecycle personas (`lifecycle/persona.mjs`), each extended to ≥ 6 sessions with:
        - a corrected mistake that recurs as an opportunity;
        - conventions set early and tested later;
        - questions answered once and needed again;
        - a returning-project start;
      - **assistant**: ≥ 8 personas with preferences, a correction, recurring tasks and facts that change.
    - Functional: **Metrics**, per arm:
      - **W1 corrected-mistake repeat rate:** opportunities where the corrected behavior recurs;
      - **W2 convention adherence:** later sessions applying an earlier convention;
      - **W3 re-asked questions:** the agent asks for information the user already gave;
      - **W4 orientation cost:** tokens and turns before the first productive action in a returning session;
      - **W5 lesson and rule support:** sampled lessons and agent-proposed rules judged against their evidence with plan 208 Task 2's audit;
      - **W6 task success**, plus the safety canary and cross-project leakage (from 202's safety probes).
    - Functional: **Partitions and criteria.** Personas are drawn label-blind into `dev`, `heldout-a` and `heldout-b` (the `drawHeldoutV3` pattern) and committed before any measurement. `work-outcome-criteria.json` is hashed into manifests and defines, for the arms memory-off, `P`, `P+W` (Tasks 2–4 on) and `P+W+O` (with plan 207):
      - `P+W` vs `P`: W1 lower and W2 higher with CI lower bound > 0 pooled over both families; W3 and W4 non-inferior; W5 ≥ 95% supported; W6 non-inferior with 2 points and safety at 0;
      - `P` vs memory-off: the same rows reported. This is the claim "memory improves work", stated only if it passes;
      - `ontology-work` (`P+W+O` vs `P+W`): plan 208 Task 1's O8 thresholds, copied unchanged (W3 and W4 improve with CI lower bound > 0 pooled over both families; W1, W2 and W6 non-inferior with a 2-point margin; W5 covers concept claims). A test asserts the row matches `three-tier-criteria.json`'s O8.
    - Functional: An offline mode with scripted users and the mock provider proves every metric computes.
    - Performance: Wall time and cost per persona stated at the gate. The offline run takes ≤ 10 minutes.
    - Code Quality: Reuses `packages/hosts/evals` (user simulator, scenario runner, state match, judge panel) and the memory-bench journal and manifest machinery. No second runner.
    - Security: Fixture personas only; the poison canary is included. Reports carry no text.
  - Approach:
    - Documentation Reviewed:
      - `packages/hosts/evals/src/{user-simulator,scenario-runner,state-match,judge-panel}.ts`;
      - `scripts/memory-bench/lifecycle/*`, `robustness-draw.mjs`;
      - plan 200 (simulated users, scenario items, state grading);
      - MemoryCode and VibeMemBench designs.
    - Options Considered:
      - Rely on LongMemEval-style QA. Rejected: it measures recall of stated facts, not whether an agent works better.
      - Add the rows to `robustness-criteria.json`. Rejected: that file is frozen and hashed (plan 202 Task 2).
    - Chosen Approach:
      - A separate, pre-registered work-outcome suite.
    - API Notes and Examples:
      ```sh
      timeout 600 bun scripts/memory-bench/work-outcome/run.mjs --offline
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/work-outcome/{personas,run,metrics,draw}.mjs` and tests (new);
      - `scripts/memory-bench/work-outcome-criteria.json` and `work-outcome-{coding,assistant}.json` partitions (new);
      - `scripts/memory-bench/README.md`;
      - `docs/_evidence/memory-bench/209/README.md` (new).
    - References:
      - Plans 200, 202 Task 2, 208 Task 2.
  - Test Cases to Write:
    - `work_outcome_offline_computes_every_metric`.
    - `persona_draw_label_blind_and_frozen`.
    - `manifest_refuses_work_outcome_criteria_drift`.
    - `ontology_work_row_matches_three_tier_o8`.
    - `reports_carry_no_text`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evaluation.
    - Docs pages to create/edit:
      - `scripts/memory-bench/README.md`;
      - evidence README.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: Development screen (owner gate W-1, paid)
  - Acceptance Criteria:
    - Functional: Gate W-1 is approved before any paid call. The gate states:
      - the budget;
      - two answer models from two providers, one small;
      - the arms (memory-off, `P`, `P+W`, `P+W+O`, `coding`, `coding+W`) on work-outcome `dev`, and `P+W` on plan 202's development partitions for no-harm.
    - Functional: The screen is advisory and reports W1–W6, plus plan 208's O8 from the `ontology-work` row. **One revision** of tuning-tier values is allowed (`maxSteps`, `rules.maxTokens`, nudge rate, `archiveAfterSessions`), each tied to evidence. The product is then frozen by product hash for plan 210's audit and held-out acceptance.
    - Functional: **Hand-off to plan 210 (moved from Task 7, 2026-10-31).** Every feature of this plan without a passing development row (tool steps, rule capture, the `rules.md` reconciliation, lessons, the nudge) enters plan 210's ledger as a candidate, with the dev rows as its evidence.
    - Functional: Plan end: Compromises, Further Actions and the backlog hand-off (SKILL.md "Plan end").
    - Performance: Caps per arm stated and reported.
    - Code Quality: Existing campaign machinery with `--plan 209`.
    - Security: Keys as refs. No text in reports.
  - Approach:
    - Documentation Reviewed:
      - plan 208 Task 5;
      - plan 202 Task 4 discipline.
    - Options Considered:
      - No screen. Rejected: the tuning values are untested on real use.
    - Chosen Approach:
      - One advisory screen, one revision, freeze.
    - API Notes and Examples:
      ```sh
      timeout 28800 bun scripts/memory-bench/campaign.mjs --plan 209 --manifest --partition dev
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/{campaign,acceptance-report}.mjs` (`--plan 209`) and tests;
      - `docs/_evidence/memory-bench/209/{gates,screen}/*`;
      - this plan, `plans/backlog.md` (plan end).
    - References:
      - Task 5.
  - Test Cases to Write:
    - `plan_209_profile_refuses_heldout_partitions` (held-out reads belong to plan 210 Task 9's manifest).
    - `revision_changes_only_tuning_tier_values`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: possibly — tuning defaults.
    - Docs pages to create/edit:
      - fabric README (tuning values, if revised);
      - evidence README;
      - `CHANGELOG.md` if tuning changes.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- Task 7: **moved to plan 210 on 2026-10-31** (sequential memory train). The held-out work-outcome arms are plan 210 Task 9; this plan's defaults (`rules.capture`, `exchanges.steps`, `lessons.nudge`) and the `PRODUCT.md` Memory positioning are plan 210 Task 10. Their criteria and tests moved with them unchanged in substance.

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 1200 bun run typecheck`
- `timeout 900 bun run --cwd packages/memory/fabric test`
- `timeout 300 bun test packages/memory/fabric/src/__tests__/prefix-stability.test.ts`
- `timeout 600 bun scripts/memory-bench/work-outcome/run.mjs --offline`
- `timeout 900 bun test --timeout=0 scripts/memory-bench`
- `timeout 900 bun run --filter @arnilo/prism-agent test`
- `timeout 600 bun test --timeout=0 src/__tests__/docs.test.ts`
- `timeout 1800 bun scripts/release.mjs gate` (fabric baseline diffs attributed)
- Paid, in order, after their gates:
  1. Task 6 (gate W-1);
  2. confirm no owned paid process remains.
- The held-out work-outcome arms run in plan 210 Task 9 (gate 3).

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
