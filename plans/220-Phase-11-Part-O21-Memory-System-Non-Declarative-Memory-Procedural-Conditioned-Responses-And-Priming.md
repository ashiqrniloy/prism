# Phase 11 Part O21 — Memory system: non-declarative memory (procedural memory, conditioned responses, priming)

> **Amended 2026-11-10 (plan 224 Task 2):** package names follow the seven-bundle map of roadmap Part 3 — `@arnilo/prism-memory-system` (the bundle root `.` and its `/core` subpath) and `@arnilo/prism-knowledge/{wiki, rag}`. Directories do not change, so read every name below as that specifier once plan 224 Task 8 lands.

> **Amended 2026-11-12 (owner, benchmark decision; [plan 218.1](218.1-Phase-11-Part-O19.1-Memory-Benchmarks-External-Outcome-Suites-Replace-BEAM-And-LongMemEval.md)):** `beam-1m` and `longmemeval-m` leave every memory-model gate. They are QA over imported chat logs, not this product's work, and at about 1M tokens a question they cannot reach a deciding sample. They are replaced by external, outcome-scored suites: Compact-Bench (session tiers and compaction), MemoryArena (declarative LTM across sessions) and STATE-Bench's Agent Learning Track (procedural learning and Sleep). Plan 218.1 Task 1 re-scopes the criteria rows to match; this plan's text is amended below. `locomo` and `memoryagentbench-cr` stay until the owner decides on them.

## Objectives

- Add the non-declarative half of LTM (design §5.6.2). This is memory that changes the agent's behaviour without the agent asking for it:
  - **Procedural memory:** how-to knowledge with context, steps and outcome evidence. It is delivered by cue. A mature procedure is proposed as a **skill** for a person to confirm.
  - **Conditioned responses:** learned cue → response triggers. They fire without deliberation, are acquired from evidence and extinguished by misses, and are **escalate-only** (I10).
  - **Priming:** an activation state over LTM, not a store. It covers scope-driven pre-activation at episode start, exemplar priming, and the existing cue, rule, directory and recency mechanisms under one config.
  - **Sensitization:** a short-lived, decaying raise in caution after a severe failure.
- Measure them live (gate M-4, rows L1–L4).

## Expected Outcome

- The `procedure` kind is reshaped. It has writers (lessons, Rehearsal, and Sleep in plan 221), cue delivery, and per-kind decay.
- The skill-graduation proposal flow is confirmed through `host.ui` and never auto-installed.
- The `trigger` kind:
  - **Firing:** a `tool.call` `ask`, a `tool.result` error-signature reminder, a user-turn phrase, or a path.
  - **Strength:** acquisition and extinction counters.
  - **Bounds:** host-policy limits on what a trigger may do.
- The `ltm.delivery.priming` umbrella, with a cache-stable scope pre-activation block and exemplar priming.
- Sensitization windows that decay.
- Offline probes, live families, and gate M-4's verdicts in `docs/_evidence/memory-bench/220/`.

This implements roadmap Phase 11 "Memory model", the non-declarative part, after plan 219.1 (retrieval). Priming and per-kind decay act on recall only through plan 219.1's bounded activation score (I13). **Review task included** (Task 1): conditioned responses use the kernel's `tool.call` decision hook (`ask`), and skill graduation uses the host's skill directories and `host.ui`. No kernel contract is added, and the review must confirm it.

Plan 210's transferred rows `kind.procedure` and `retrieval.decay-per-kind` are decided here. Sleep-time procedure extraction and trigger acquisition from many episodes are plan 221's; this plan adds the kinds, their in-session writers and their delivery. No version bump and no publish.

## Tasks

- [ ] Task 1: Phase review — `tool.call` asks, approval interplay, skill directories (read-only)
  - Acceptance Criteria:
    - Functional: **Verify against source, with `file:line`:**
      - a package `tool.call` handler returning `{ ask }` reaches `HostUi` on interactive runs, and resolves as documented on non-interactive runs (`docs/hooks.md:89-124`);
      - deny wins over ask, and a package cannot turn an `ask` into an allow;
      - how `@arnilo/prism-approval` (`packages/policy/approval`) combines with a second package's `ask`;
      - `tool.result` and `context.build` can carry a reminder without breaking the prompt cache (tail only);
      - the host's skill directories and `PackageAPI.skills.addDir` (plan 215 Tasks 5–8), and whether a package may write a skill file. The expected answer is no: it proposes, and the host writes after confirmation;
      - `host.ui` `confirm`/`input` shapes and their `unavailable` handling.
    - Functional: **Classification.** Each Objectives bullet is classified as expressible or needing a kernel addition. A kernel addition stops the plan for a re-cut.
    - Functional: **Verdict** recorded in Notes, with any finding that changes Tasks 2–6.
    - Performance: n/a.
    - Code Quality: No code.
    - Security: Records the trust boundary: learned triggers are package-authored decisions on tool calls, so the review confirms they cannot weaken a host or approval deny.
  - Approach:
    - Documentation Reviewed:
      - `docs/hooks.md`, `docs/host.md`, `docs/tools.md` (skills);
      - `packages/policy/approval/src/**`;
      - plan 215's skill tasks;
      - design §5.6.2, I10.
    - Options Considered:
      - Skip the review. Rejected: decision hooks on tool calls are a safety surface.
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

- [ ] Task 2: Procedural memory
  - Acceptance Criteria:
    - Functional: **Shape.** `kind: "procedure"` gains `when` (context: a task type, path globs, a tool, or a scope phrase), `steps` (1–12 lines), `preconditions?`, `evidence` (1–8 note or episode ids, as for lessons), `successes`, `failures` and `lastUsedAt`. The text form stays valid. An older procedure note reads unchanged.
    - Functional: **Writers:**
      - lessons (`memory.insert` with `tags: ["lesson"]`, plan 209 Task 4), unchanged;
      - Rehearsal's `write_note { kind: "procedure" }` with the validator (plan 219 Task 2);
      - plan 221's Sleep extraction.

      All writes are candidates (I9).
    - Functional: **Delivery by cue, not by default recall.** A verified procedure whose `when` matches the current context is delivered once per session in the tail. The context is a touched path (the path-cue tracker), the first tool of a kind in a task, or a scope phrase match at episode start (Task 5). Delivery is capped by `ltm.delivery.procedures.maxPerTurn` (1) and `budgetTokens` (300). Explicit `memory.recall { kinds: ["procedure"] }` stays.
    - Functional: **Outcome evidence (operant).**
      - A delivered procedure followed by an `outcome` that succeeded increments `successes`; by an `error`/`failed` outcome, `failures`.
      - S (storage strength) takes the existing helpful and harmful terms from these counts.
      - A procedure with `failures > successes` after ≥ 3 uses is flagged for review and not delivered.
    - Functional: **Decay per kind** (the transferred `retrieval.decay-per-kind` row). `DEFAULT_DECAY` (`lifecycle/strength.ts`) gets fitted values for `episode` and `procedure` from the plan 219 multi-session fixture. Decay acts on ranking only through plan 219.1's `decay` activation term; before plan 219.1, it did nothing with one scope (design §5.11, D2). The row's disposition is recorded: keep with fitted values, or remove the per-kind table if a single value is non-inferior.
    - Performance: Cue matching reuses the path-cue bucket index, with no query on a turn that touches nothing new. The README states the delivery cost and the `ltm.delivery.procedures: false` default that avoids it.
    - Code Quality: One procedure validator shared by the lessons, Rehearsal and Sleep writers. The compat baseline is regenerated.
    - Security: Procedures pass the trust scan, and a step that reads as an instruction to bypass policy is quarantined. Delivery stays inside the untrusted envelope. A procedure never executes anything: it is text the agent reads.
  - Approach:
    - Documentation Reviewed:
      - `src/ltm/{types,lessons,delivery/cues,lifecycle/strength}.ts`;
      - plan 209 Task 4;
      - Memp (arXiv 2508.06433);
      - design §5.6.2.
    - Options Considered:
      - Deliver procedures in default recall. Rejected: plan 188-era evidence kept `procedure` out of untyped recall to avoid noise; cue delivery is the procedural analogue.
    - Chosen Approach:
      - Structured procedures, cue delivery, and outcome-driven strength.
    - API Notes and Examples:
      ```json
      { "kind": "procedure", "when": { "paths": ["packages/memory/**"], "tool": "bash" }, "steps": ["Run suites with --timeout=0"], "evidence": ["4f2a9c1e0b77"] }
      ```
    - Files to Create/Edit:
      - `packages/memory/system/src/ltm/{types,procedures,lessons,delivery/cues,lifecycle/strength,context}.ts` and tests;
      - `src/session/workers/rehearsal.ts` (validator);
      - README (`## Procedural memory`); CHANGELOG; baseline;
      - `docs/_evidence/memory-bench/210/decisions.md`.
    - References:
      - design §5.6.2.
  - Test Cases to Write:
    - `procedure_shape_round_trips_and_text_form_still_valid`.
    - `verified_procedure_cued_once_on_matching_context`.
    - `outcome_after_delivery_updates_successes_or_failures`.
    - `failing_procedure_flagged_and_not_delivered`.
    - `decay_per_kind_fitted_or_removed_with_record`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — kind shape and delivery.
    - Docs pages to create/edit:
      - README (`## Procedural memory`, delivery tiers table); CHANGELOG.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: Skill graduation — a mature procedure becomes a proposed skill
  - Acceptance Criteria:
    - Functional: **Eligibility.** A procedure is eligible when all of these hold:
      - `verified`, not flagged;
      - `successes ≥ ltm.skills.minSuccesses` (5);
      - used in `≥ ltm.skills.minSessions` (3) sessions;
      - `failures / uses ≤ 0.2`.
    - Functional: **Proposal.**
      - `memory:skills:propose` lists eligible procedures; Sleep also calls it (plan 221).
      - For each, the package renders a `SKILL.md` draft in the Agent Skills format (name, description, `metadata.prism-source: memory`, the procedure's steps and when-clause, evidence ids). It never writes it itself.
      - It asks the host through `host.ui` `confirm` with the draft. On accept, the host's handler (a documented `memory.system.onSkillAccepted` callback, or the reference host's skill directory) writes it.
      - `unavailable`, deny, dismiss or a throw leaves the procedure as is and records `proposed`.
    - Functional: **After graduation.** The procedure is marked `graduated { skill: name }` and is no longer cue-delivered (the skill replaces it). Its evidence stays. Forgetting the procedure does not delete a written skill; the README says so.
    - Performance: Proposals cost no model call: the draft is a template over the procedure.
    - Code Quality: A template in one module. A test checks the draft against the skill frontmatter parser (plan 190).
    - Security:
      - A person confirms every skill.
      - The draft passes the trust scan, and skill names are sanitised.
      - The package never writes outside its own store.
  - Approach:
    - Documentation Reviewed:
      - Task 1 findings;
      - `docs/tools.md` (skills);
      - plan 190 (frontmatter parser);
      - plan 215 module-skills tasks.
    - Options Considered:
      - Auto-install skills. Rejected: skills enter the cached catalog prefix and steer behaviour, so a person decides.
    - Chosen Approach:
      - Propose, confirm, and let the host write.
    - API Notes and Examples:
      ```ts
      memorySystem({ ltm: { skills: { minSuccesses: 5, minSessions: 3, onAccepted: (draft) => writeSkill(draft) } } });
      ```
    - Files to Create/Edit:
      - `packages/memory/system/src/ltm/{skills,commands,procedures}.ts` and tests;
      - `apps/prism-agent/src/host/**` (the accept handler writes to its skills directory) and tests;
      - README (`## Skill graduation`); CHANGELOG; baseline.
    - References:
      - design §5.6.2.
  - Test Cases to Write:
    - `eligible_procedure_proposed_with_valid_skill_frontmatter`.
    - `host_unavailable_or_deny_leaves_procedure_proposed`.
    - `accepted_skill_written_by_host_and_procedure_marked_graduated`.
    - `package_never_writes_skill_files`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — command, config, host callback.
    - Docs pages to create/edit:
      - README; `apps/prism-agent/README.md` (skill graduation); CHANGELOG.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Conditioned responses — escalate-only triggers with acquisition and extinction
  - Acceptance Criteria:
    - Functional: **Shape.** `kind: "trigger"`: `{ cue: { on: "tool.call" | "tool.result" | "user-turn" | "path", match }, response: "remind" | "suggest" | "require-approval", text, strength, pairings, misses, evidence, origin }`. The `match` forms are:
      - a tool name plus an argument pattern (literal or bounded glob, never an arbitrary regex);
      - an error-signature hash (normalised from the result);
      - a phrase (exact, case-folded);
      - path globs.
    - Functional: **Firing, with no model call:**
      - `tool.call` with `require-approval` returns `{ ask }` with the trigger text. Without a `HostUi` or on a non-interactive run, it resolves exactly as the kernel's documented `ask` handling does. It never returns `deny`, `allow`, `rewrite` or `respond`.
      - `tool.call` or `tool.result` with `remind`/`suggest` adds one tail line on the next request.
      - `user-turn` and `path` add a tail reminder.

      At most `ltm.triggers.maxPerTurn` (2) fire per turn, highest strength first.
    - Functional: **Escalate-only (I10), enforced in code.**
      - A trigger cannot weaken a host or approval decision: deny wins in the kernel.
      - A trigger cannot be authored by tool output: `origin` must be a user statement, a lesson, a Rehearsal write citing ≥ 2 failure events, or Sleep (plan 221).
      - The host can cap responses (`ltm.triggers.allow: ["remind", "suggest"]` removes `require-approval`) or turn triggers off.
    - Functional: **Acquisition (in session).**
      - An explicit user statement ("whenever you run X, do Y", "never X without asking") becomes a proposed trigger through the existing rule-capture confirmation, a `host.ui` confirm.
      - A lesson with a failure signature becomes a candidate trigger.
      - Rehearsal may write one from ≥ 2 identical failure events in an episode.
      - Candidates fire only as `remind` until verified.
    - Functional: **Extinction.**
      - A fire followed, within the cue's window, by the outcome the trigger guards against counts a pairing; no such outcome counts a miss.
      - Strength decays with misses, and a trigger with `misses ≥ ltm.triggers.extinctAfter` (5) and no pairing since is extinguished: archived, not deleted.
      - A later pairing revives it (spontaneous recovery is not modelled).
    - Performance: Matching is a bucketed literal/glob check per tool call and per result; no store query per call, because the index is built per session epoch. The README states the per-call overhead (measured) and the `ltm.triggers: false` default.
    - Code Quality: One matcher module shared by firing and Sleep's acquisition (plan 221). No arbitrary regex (ReDoS).
    - Security:
      - Escalate-only, with tests that a trigger cannot produce allow, deny, rewrite or respond.
      - Trigger text passes the trust scan, and the tail line stays in the untrusted envelope.
      - Capture needs confirmation.
  - Approach:
    - Documentation Reviewed:
      - Task 1 findings;
      - `docs/hooks.md:89-124`;
      - `src/ltm/delivery/{rules,cues}.ts` (rule capture);
      - design §5.6.2, I10.
    - Options Considered:
      - Triggers that deny. Rejected (I10): learned memory must not be able to block work on its own authority.
      - Model-judged firing. Rejected: conditioning is the no-deliberation path; the cost per tool call would be prohibitive.
    - Chosen Approach:
      - Deterministic matching with ask-or-remind responses, and evidence-driven strength.
    - API Notes and Examples:
      ```json
      { "kind": "trigger", "cue": { "on": "tool.call", "match": { "tool": "bash", "args": "git push*--force*" } }, "response": "require-approval", "text": "Force-push rewrote shared history on 2026-10-30; confirm first." }
      ```
    - Files to Create/Edit:
      - `packages/memory/system/src/ltm/{triggers,triggers-match,types,delivery/rules,context,index}.ts` and tests;
      - `src/session/workers/rehearsal.ts`;
      - README (`## Conditioned responses`, cost); CHANGELOG; baseline.
    - References:
      - design §5.6.2.
  - Test Cases to Write:
    - `require_approval_trigger_returns_ask_only`.
    - `trigger_cannot_allow_deny_rewrite_or_respond`.
    - `host_deny_wins_over_trigger`.
    - `tool_output_cannot_author_a_trigger`.
    - `candidate_trigger_fires_only_as_remind`.
    - `misses_extinguish_and_pairing_revives`.
    - `matcher_rejects_unbounded_patterns`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new kind and hooks.
    - Docs pages to create/edit:
      - README (`## Conditioned responses`); CHANGELOG.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: Priming — scope pre-activation, exemplar priming, and one delivery config
  - Acceptance Criteria:
    - Functional: **One config.** `ltm.delivery.priming` gathers the existing priming mechanisms under one documented section, with their fields moved (no alias): directory, standing rules, path cues and the passive tail. The recency prior R stays a term of plan 219.1's activation (`ltm.retrieval.terms.retrieval`). `ltm.delivery.priming: false` turns all the delivery mechanisms off and sets the `priming` activation term to 0.
    - Functional: **Priming as activation.** Notes in the scope pre-activation block, and the exemplar episode, get plan 219.1's `priming` activation term for the epoch. Query recall therefore favours what the episode primed, inside the band (I13), with no extra query.
    - Functional: **Scope pre-activation.**
      - At episode start (a scope set, or the first context build of a session with a configured scope), the package runs one lexical recall over the scope text and builds a `memory-priming` block in the prompt prefix.
      - The block holds up to `priming.scope.maxTokens` (400) of verified semantic notes and procedures, as `[id] text` lines.
      - It is pinned for the session epoch, like the rules block (I7), and rebuilt only on a scope change, compaction or retraction.
      - It is de-duplicated against the rules block and the cues.
    - Functional: **Exemplar priming** (opt-in, `priming.exemplar: true`): one past successful `episode` whose scope or title matches the new scope best is shown as a single pointer line (`[id] episode <title> — memory.read id`) in the priming block. Its body is never inlined.
    - Functional: **Measurement hooks.** The work-outcome runner can toggle priming per arm, for L3.
    - Performance:
      - The scope pre-activation costs one recall query per epoch and no model call.
      - The prefix stays byte-identical within an epoch (`prefix-stability.test.ts` case).
      - The README states the token cost and the default.
    - Code Quality: Field moves have no alias. `stability.test.ts` is updated, and the baseline regenerated.
    - Security: Only verified, unflagged, readable notes enter. The block passes the redactor and sits inside the untrusted envelope.
  - Approach:
    - Documentation Reviewed:
      - `src/ltm/delivery/{rules,cues}.ts`, `directory.ts`, `context.ts`;
      - plan 188.5 (delivery tiers);
      - plan 202 Tasks 4.11–4.15 (cache);
      - design §5.6.2.
    - Options Considered:
      - Priming as a stored kind. Rejected by the owner (recommendation 13): priming is activation, not content.
    - Chosen Approach:
      - One config over the existing mechanisms, plus scope pre-activation.
    - API Notes and Examples:
      ```ts
      memorySystem({ ltm: { delivery: { priming: { scope: { maxTokens: 400 }, exemplar: false, rules: { maxTokens: 600 }, cues: { maxPerTurn: 2 } } } } });
      ```
    - Files to Create/Edit:
      - `packages/memory/system/src/ltm/{delivery/priming,delivery/rules,delivery/cues,directory,context,config}.ts` and tests;
      - `src/ltm/__tests__/prefix-stability.test.ts`;
      - `scripts/memory-bench/work-outcome/**` (arm toggle);
      - `apps/prism-agent/**` (config field moves);
      - README (`## Priming`, delivery tiers); `docs/migrate-to-0.13.md`; CHANGELOG; baseline.
    - References:
      - design §5.6.2.
  - Test Cases to Write:
    - `scope_preactivation_block_pinned_per_epoch`.
    - `preactivation_rebuilt_only_on_scope_change_compaction_or_retraction`.
    - `exemplar_pointer_only_no_body`.
    - `priming_false_turns_every_mechanism_off`.
    - `primed_notes_lifted_inside_band_only`: fails if a primed note overtakes a hit more than `priorBand` more relevant.
    - `moved_delivery_fields_validate_and_old_fields_fail_named`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — config moves and a new block.
    - Docs pages to create/edit:
      - README; `docs/migrate-to-0.13.md`; CHANGELOG.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: Sensitization — temporary caution after a severe failure
  - Acceptance Criteria:
    - Functional: **Severe failures**, from STM events and kernel events with no model call:
      - an approval denial (`decision.resolved` deny);
      - an `error` event matching the host's severe list (default: destructive git or file operations reverted, test-suite failure after an edit claimed done);
      - an explicit user correction with negative sentiment cues (the existing correction patterns).
    - Functional: **Response.**
      - For `ltm.sensitization.turns` (10) turns after a severe failure, triggers whose cue matches the failure's tool or path fire with one response level higher (`remind` → `suggest` → `require-approval`, capped by the host's `allow` list).
      - Elsewhere, one tail line reminds the agent of the failure (by event id).
      - The effect decays linearly to zero and never persists past the session.
    - Functional: **Escalate-only (I10).**
    - Performance: Event matching only. The README states the default and `ltm.sensitization: false`.
    - Code Quality: Shares the trigger matcher.
    - Security: Cannot remove friction; ends with the session.
  - Approach:
    - Documentation Reviewed:
      - Task 4;
      - `docs/events.md` (`decision.resolved`);
      - design §5.6.2.
    - Options Considered:
      - Persist sensitization to LTM. Rejected: lasting caution is a trigger, acquired with evidence (Task 4, plan 221).
    - Chosen Approach:
      - A session-scoped, decaying escalation.
    - API Notes and Examples:
      - n/a.
    - Files to Create/Edit:
      - `packages/memory/system/src/{ltm/sensitization,ltm/triggers,session/flush}.ts` and tests;
      - README; CHANGELOG.
    - References:
      - design §5.6.2.
  - Test Cases to Write:
    - `denial_raises_related_trigger_level_for_n_turns`.
    - `sensitization_decays_and_ends_with_session`.
    - `sensitization_never_exceeds_host_allow_list`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — config and behaviour.
    - Docs pages to create/edit:
      - README; CHANGELOG.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7: Offline probes and live families for non-declarative memory
  - Acceptance Criteria:
    - Functional: **Probes** (`mechanism-probes/non-declarative.mjs`) on the multi-session fixture extended with repeated failures, a "whenever" statement, a severe failure and repeated successful procedures:
      1. procedures are cued once on a match, and outcomes update their counts;
      2. a failing procedure is not delivered;
      3. a skill draft parses, and the package writes nothing;
      4. triggers return only ask or remind and never weaken a deny;
      5. extinction after misses and revival on a pairing (L2, exact);
      6. the false-trigger rate is measured on a benign replay (L2, ≤ 5%);
      7. the priming block is pinned per epoch (L3, prefix);
      8. sensitization decays.
    - Functional: **Live families.** The work-outcome suite's W1 (corrected-mistake repeats) and W4 (orientation cost) families are reused. A `recurring-failure` family is added: a failure signature that recurs across sessions unless avoided. Partitions are frozen and label-blind.
    - Performance: The probes run offline in under 15 minutes.
    - Code Quality: Through the harness.
    - Security: An injected "trigger" in tool output is never stored (probe).
  - Approach:
    - Documentation Reviewed:
      - plan 219 Task 6;
      - plan 209 Task 5.
    - Options Considered:
      - n/a beyond plan 219's.
    - Chosen Approach:
      - Exact offline rows, plus live families.
    - API Notes and Examples:
      ```sh
      timeout 1800 bun scripts/memory-bench/mechanism-probes/run.mjs --only non-declarative
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/fixtures/memory-model/multi-session/**`;
      - `scripts/memory-bench/mechanism-probes/{non-declarative.mjs,probes.test.mjs}`;
      - `scripts/memory-bench/work-outcome/**`;
      - `scripts/memory-bench/README.md`.
    - References:
      - plan 216 Task 2.
  - Test Cases to Write:
    - `non_declarative_probe_covers_probes_1_to_8`.
    - `recurring_failure_family_partitions_frozen`.
    - `tool_output_trigger_injection_never_stored`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — harness.
    - Docs pages to create/edit:
      - `scripts/memory-bench/README.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 8: Gate M-4 — live non-declarative efficacy (paid), and plan end
  - Acceptance Criteria:
    - Functional: **Gate record.** `docs/_evidence/memory-bench/220/gates/owner-gate-m4.json` gives the budget, the models (C-1's paid roles unless the owner names others; never `openrouter/free`), the arms, partitions and caps. The run starts on the owner's word.
    - Functional: **Arms** (development partitions), each with plan 219.1's `RT` (plan 219's `full-r` plus the retrieval changes) as the base:
      - `+procedural`;
      - `+triggers`;
      - `+priming`;
      - `+all`;
      - `RT` itself.

      They run on the W1, W4 and `recurring-failure` families, on STATE-Bench's Agent Learning Track (pass@1 and pass^5, development partition), and on Compact-Bench retention and MemoryArena as the L4 non-regression check. Amended 2026-11-12 by plan 218.1, replacing `beam-1m` and `longmemeval-m`.
    - Functional: **Verdicts.** L1–L4 come from `acceptance-report.mjs --plan memory-model --gate M-4`; the offline rows must pass first. A miss goes to the owner before plan 221, and one fix round is allowed.
    - Functional: **Plan 210 transfers.** `kind.procedure`, `retrieval.decay-per-kind`, `delivery.passive-tail`, `delivery.standing-rules`, `delivery.rule-capture` and `lessons` get their final disposition in `docs/_evidence/memory-bench/210/decisions.md`. The four delivery and working-agent rows replace plan 210's cancelled wave 2 arms `tools-only`, `rules-add` and the W legs. Each is measured as a leave-one-out arm inside `+all` on the W1, W2 and W4 families, added to this gate's arms.
    - Functional: **Plan end.** Compromises, Further Actions, and the backlog hand-off.
    - Performance: Reports trigger fires per session, asks raised, procedures delivered, priming block tokens, cached-input share, cost and p95.
    - Code Quality: The same campaign machinery.
    - Security: Plan 202's safety suite runs live on `+all`, including a trigger-poisoning case. Evidence carries counts, ids and hashes only.
  - Approach:
    - Documentation Reviewed:
      - plan 219 Task 7;
      - plan 216 Task 2.
    - Options Considered:
      - One `+all` arm only. Rejected: attribution per mechanism decides which ship on by default (plan 223).
    - Chosen Approach:
      - Add-one arms plus a combined arm.
    - API Notes and Examples:
      ```sh
      timeout 28800 bun scripts/memory-bench/campaign.mjs --plan memory-model --gate M-4 --manifest --partition dev
      ```
    - Files to Create/Edit:
      - `docs/_evidence/memory-bench/220/**`;
      - `docs/_evidence/memory-bench/210/decisions.md`;
      - this plan; `plans/backlog.md`.
    - References:
      - plan 216 Task 2.
  - Test Cases to Write:
    - `gate_m4_arms_paired_on_identical_items`.
    - `m4_offline_rows_pass_before_paid_run`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evidence.
    - Docs pages to create/edit:
      - the evidence README; the README's measured-role paragraphs.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 1200 bun run typecheck`
- `timeout 900 bun run --cwd packages/memory/system test`
- `timeout 1800 bun scripts/memory-bench/mechanism-probes/run.mjs --only stm,wm,rehearsal,non-declarative`
- `timeout 300 bun test packages/memory/system/src/ltm/__tests__/prefix-stability.test.ts`
- `timeout 900 bun test --timeout=0 scripts/memory-bench`
- `timeout 3600 bun scripts/memory-bench/safety/run.mjs --suite offline`
- `timeout 900 bun run --filter @arnilo/prism-agent test`
- `timeout 600 bun test --timeout=0 src/__tests__/docs.test.ts`
- `timeout 1800 bun scripts/release.mjs gate`
- `timeout 300 bunx biome check <changed files>`
- Paid, after gate M-4: the Task 8 campaign and report; confirm no owned paid process remains.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
