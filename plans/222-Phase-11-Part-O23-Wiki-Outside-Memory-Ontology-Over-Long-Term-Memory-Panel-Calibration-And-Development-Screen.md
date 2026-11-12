# Phase 11 Part O23 — The wiki outside memory: the ontology over long-term memory, panel calibration, development screen

> **Amended 2026-11-10 (plan 224 Task 2):** package names follow the seven-bundle map of roadmap Part 3 — `@arnilo/prism-memory-system` (the bundle root `.` and its `/core` subpath) and `@arnilo/prism-knowledge/{wiki, rag}`. Directories do not change, so read every name below as that specifier once plan 224 Task 8 lands.

> **Amended 2026-11-12 (owner, benchmark decision; [plan 218.1](218.1-Phase-11-Part-O19.1-Memory-Benchmarks-External-Outcome-Suites-Replace-BEAM-And-LongMemEval.md)):** `beam-1m` and `longmemeval-m` leave every memory-model gate. They are QA over imported chat logs, not this product's work, and at about 1M tokens a question they cannot reach a deciding sample. Plan 218.1 runs a lean external screen on Compact-Bench for the session tiers. MemoryArena (declarative LTM across sessions) and STATE-Bench's Agent Learning Track (procedural learning and Sleep) are the chosen replacements below, but their adoption is **deferred** (owner, 2026-11-12: cost and time); their rows read `missing` until an adoption task runs before this plan's gate. Plan 218.1 Task 1 re-scopes the criteria rows to match. `locomo` and `memoryagentbench-cr` stay until the owner decides on them.

## Objectives

- Finish the wiki as a knowledge package outside memory (owner, 2026-11-08: "It should be part of the wiki and not memory"). Plan 216 Task 3 moved the ontology out of the fabric. This plan settles the wiki on the *final* long-term memory:
  - which LTM signals it reads (use and co-read events, Rehearsal and Sleep writes);
  - how it schedules its curator pass beside Sleep;
  - that LTM deletions, including Sleep's supersessions and archives, reach its claims deterministically.
- Run the measurement moved out of plan 210 Task 5 (2026-11-08):
  - the claim-support panel calibration and the evasive-lure residual;
  - the ontology arms, re-expressed for the wiki outside memory, on plan 208's `three-tier-criteria.json` rows O1–O8 (gate K-1).
- Record the final disposition of plan 210's transferred `ontology.*` and `kind.concept` rows.

## Expected Outcome

- The wiki's reaction to each LTM change is defined and tested: use and co-read events, a Rehearsal write, a Sleep supersession, a merge or archive, and a forget.
- A documented scheduling recipe, `memory:sleep` then `wiki:consolidate`.
- `docs/_evidence/memory-bench/222/audit/claim-calibration.json`: the panel's kappa against blind labels, the confusion table, and the evasive-lure residual.
- Gate K-1's verdicts on O1–O8 for `ltm+wiki` against `ltm`, and the ontology rows' dispositions in `docs/_evidence/memory-bench/210/decisions.md`.

This implements the wiki half of roadmap Phase 11 "Memory model" ("the ontology is not memory"), after plan 221 and before plan 223. Plan 223's single held-out read includes the wiki's rows.

**No review task:** plan 216 Task 1 reviewed the port and the package move, and this plan changes no kernel contract. It changes the wiki package and the memory-bench harness only. No version bump and no publish.

## Tasks

- [ ] Task 1: The wiki on the final long-term memory
  - Acceptance Criteria:
    - Functional: **Signals the wiki reads through `memory.ltm`:**
      - use events and co-read events (the co-read trigger);
      - newly verified notes (the accumulation trigger counts *verified* notes only, so Rehearsal and Sleep candidates do not drive concept edits until used);
      - deletions.

      A test drives each trigger from a Rehearsal-written note that is then verified by use.
    - Functional: **LTM changes reach claims.** Each change maps to a deterministic wiki action, with no model call:

      | LTM change | Wiki action |
      |---|---|
      | Sleep conflict supersession | a claim citing the superseded note is marked for repair and is not rendered until repaired |
      | Duplicate merge | a citation to the merged-away note is repointed to the survivor (lineage `mergedFrom`) |
      | Archive | the claim stays, marked `[archived evidence]` in reads |
      | Forget, revoke | the claim is retracted (plan 216 Task 3) |

      A test covers each.
    - Functional: **Scheduling.**
      - `wiki:consolidate` accepts `{ scopes?, maxSubjects? }` for host scheduling.
      - The in-session check (`consolidate.minIntervalTurns`) stays as an option. The README recommends scheduling the pass after `memory:sleep` for hosts that run Sleep.
      - `examples/memory-and-wiki.ts` shows the schedule.
    - Functional: **Plan 208 backlog inputs**, each with a decision recorded in this task's note (fixed here as a tuning change with a test, or carried to Further Actions):
      - "Make concepts reach the answer-bearing note";
      - "Revisit the read-time minCoReads threshold";
      - "Decide whether an added date or inference counts as unsupported" (a rubric question for Task 2).
    - Performance: Feed reads stay one page per retraction epoch, plus a lineage reconcile on open. The README's cost section is updated for scheduled runs.
    - Code Quality: All LTM interaction goes through the read-only port. No new port member unless it is read-only.
    - Security: The port stays read-only. Candidate (unverified) notes never seed concepts. The trust scan and claim lint are unchanged.
  - Approach:
    - Documentation Reviewed:
      - the wiki package (after plan 216 Task 3);
      - `src/ltm/lifecycle/{events,merge,archive}.ts`;
      - plan 221 Tasks 2–3;
      - plan 208's backlog entries (`plans/backlog.md:1288-1356`).
    - Options Considered:
      - Let candidates seed concepts. Rejected: concepts would generalise from unverified evidence. That is exactly plan 208's false-generalisation risk (O3).
    - Chosen Approach:
      - Verified-only inputs, and deterministic reactions to every LTM change.
    - API Notes and Examples:
      ```ts
      scheduler.schedule({ id: "wiki", target: "wiki:consolidate", cron: "30 3 * * *", tz: "UTC" });
      ```
    - Files to Create/Edit:
      - the wiki package: `src/{extension,consolidate/pass,port-client,cascade}.ts` and tests;
      - `examples/memory-and-wiki.ts`;
      - the wiki README (`## Reading memory`, `## Scheduling`, cost); CHANGELOG.
    - References:
      - design §5.10.
  - Test Cases to Write:
    - `rehearsal_note_drives_triggers_only_after_verification`.
    - `sleep_supersession_marks_citing_claim_for_repair`.
    - `merge_repoints_citation_to_survivor`.
    - `archived_evidence_marked_in_reads`.
    - `forget_retracts_claim_without_model_call`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — wiki behaviour and command options.
    - Docs pages to create/edit:
      - the wiki README; CHANGELOG.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: Claim-support panel calibration and the evasive-lure residual (moved from plan 210 Task 5, 2026-11-08)
  - Acceptance Criteria:
    - Functional: **Labelled set.**
      - One `ltm+wiki` run on the post-plan-221 product, development partitions only, curated by a model on no judge panel.
      - `ontology-audit.mjs --campaign <campaign> --arm <arm> --build-human-set <dir>` draws 60 claims through `selectHumanAuditClaims`.
      - Claim text stays in the cache and in `.cache/scratch`.
    - Functional: **Blind labels.**
      - The assistant labels first (plan 208 gate amendment 1), or the owner does through `review.html`.
      - The labels are written before any panel verdict on these claims is read, and the label file is hashed into the run record first.
      - An assistant-only label set is development evidence; plan 223 repeats O3 with a person's labels.
    - Functional: **Calibration run.**
      - `ontology-audit.mjs --labels <labels.json> --judges <two families, neither the curator>`, with `assertNoCuratorJudge` in force.
      - `liveJudges` accepts the K-1 gate record (a test).
      - Report the supported-versus-not kappa with its interval, the four-label kappa and the confusion table, counts only, naming the judges and the spend.
    - Functional: **Branch.**
      - kappa ≥ `panelHumanKappaAtLeast` (0.8): the full-size audit (200 claims per group) runs at gate K-1.
      - kappa < 0.8: record where the labels and the panel differ, decide with the owner whether the rubric or the labeller is the problem, revise once, and leave O3 `valid=false` until it clears.
      - The added-date and inference question (Task 1) is settled here as a rubric decision.
    - Functional: **Evasive-lure residual (plan 208 O4).** The same panel judges the delivered claims of plan 208 Task 4's `evasiveResidual` fixture.
    - Functional: **The panel is reused.** The calibrated panel is also the one plans 219 (R3) and 221 (Z2) use, if they ran with assistant labels: their claim-support rows are re-scored once here, development evidence, and reported beside their gates.
    - Performance: Spend and judge calls are reported. The run is capped at the K-1 gate's budget share.
    - Code Quality: Existing `ontology-audit.mjs` machinery. The gate check moves from plan 210 C-1 to K-1, with a test.
    - Security: No claim, label or question text in evidence; counts and hashes only.
  - Approach:
    - Documentation Reviewed:
      - plan 210 Task 5's moved criterion;
      - plan 208 Tasks 2, 4 and 5;
      - `scripts/memory-bench/ontology-audit.mjs`.
    - Options Considered:
      - Calibrate on plan 208's old bundles. Not possible: they were deleted (plan 210 Task 3.2 note).
    - Chosen Approach:
      - Fresh claims on the final product, blind labels first.
    - API Notes and Examples:
      ```sh
      timeout 3600 bun scripts/memory-bench/ontology-audit.mjs --labels .cache/scratch/k1/labels.json --judges ollama-cloud/gpt-oss:120b,ollama-cloud/gemma4:31b
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/{ontology-audit,live}.mjs` and tests;
      - `docs/_evidence/memory-bench/222/{audit/claim-calibration.json,gates/owner-gate-k1.json,README.md}`.
    - References:
      - plan 210 Task 5 (moved text, kept there as a record).
  - Test Cases to Write:
    - `live_judges_accepts_k1_gate`.
    - `labels_hashed_before_panel_verdicts_read`.
    - `curator_never_on_panel`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evaluation.
    - Docs pages to create/edit:
      - the evidence README.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: Gate K-1 — the wiki's development screen (paid), the ontology rows' disposition, and plan end
  - Acceptance Criteria:
    - Functional: **Gate record.** `docs/_evidence/memory-bench/222/gates/owner-gate-k1.json` gives the budget (including Task 2's share), the models (C-1's paid roles unless the owner names others; never `openrouter/free`), the arms, partitions and caps. The run starts on the owner's word.
    - Functional: **Arms**, moved from plan 210 wave 3 and re-expressed for the wiki outside memory, on development partitions (`memoryagentbench-cr`, MemoryArena, `locomo`; amended 2026-11-12 by plan 218.1, MemoryArena replacing `beam-1m`) and the work-outcome families for O8:
      - `ltm` (plan 221's `full` without the wiki): the base, playing `P`;
      - `ltm+wiki`: the reference, playing `P+O`;
      - `trigger-co-read-loo` and `trigger-accumulation-loo` (wiki triggers);
      - `concept-pointer-loo` (the wiki's own passive pointer).

      `concept-prior-loo` no longer applies: LTM recall has no concept prior after plan 216 Task 3. It is recorded as `not-applicable`, with the reason.
    - Functional: **Verdicts.**
      - O1–O8 come from `acceptance-report.mjs --plan 208 --gate K-1` against `three-tier-criteria.json`, unchanged and pinned by hash. The re-pointing (`P` → `ltm`, `P+O` → `ltm+wiki`) is recorded in `memory-model-criteria.json` (plan 216 Task 2).
      - The outcome class (`beneficial`, `safe-neutral`, `not-safe`, `harmful`) is development evidence; plan 223 accepts it on held-out data.
    - Functional: **Plan 210 transfers.** `kind.concept`, `ontology.tier`, `ontology.binding-deterministic`, `ontology.binding-extractor`, `ontology.curator-pass`, the three `ontology.trigger.*` rows, `ontology.concept-prior`, `ontology.passive-pointer`, `ontology.concept-sharing`, `ontology.source-ingest` and `ontology.coding-o6` each get a final disposition under plan 210's `cleanup-criteria.json` rules: keep, remove (with the removal landing in this task, with a sweep and baselines), or experimental. `ontology.claim-lint` stays `safety-proven`.
    - Functional: **Plan end.** Compromises, Further Actions, and the backlog hand-off. The plan 208 backlog entries this plan resolves are removed, naming their titles.
    - Performance: Reports curator calls per scheduled run, claim counts, the claim-support rate, the cost of `ltm+wiki` over `ltm`, cached-input share and p95.
    - Code Quality: The existing ontology arm machinery (`ontology-arm.mjs`, `ontology-screen.mjs`) with new arm configs. No ad-hoc runner.
    - Security: Plan 208 Task 4's ontology safety probes run live on `ltm+wiki`. Evidence carries counts, ids and hashes only. Held-out partitions stay unread.
  - Approach:
    - Documentation Reviewed:
      - plan 210 Task 5 wave 3 (moved arms);
      - plan 208 Tasks 1, 3 and 5;
      - `three-tier-criteria.json`.
    - Options Considered:
      - New criteria for the wiki. Rejected: plan 208's rows are pre-registered and still describe the question (does the ontology help, safely, at what cost).
    - Chosen Approach:
      - The same rows, re-pointed by reference.
    - API Notes and Examples:
      ```sh
      timeout 28800 bun scripts/memory-bench/campaign.mjs --plan 208 --gate K-1 --manifest --partition dev
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/{ontology-arm,ontology-screen,campaign,acceptance-report}.mjs` and tests;
      - `docs/_evidence/memory-bench/222/**`;
      - `docs/_evidence/memory-bench/210/decisions.md`;
      - the wiki package (only for removals decided here);
      - this plan; `plans/backlog.md`.
    - References:
      - plans 208, 210, 216.
  - Test Cases to Write:
    - `gate_k1_arms_paired_on_identical_items`.
    - `three_tier_criteria_hash_pinned_and_repointing_recorded`.
    - `concept_prior_row_recorded_not_applicable`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: only if a removal lands.
    - Docs pages to create/edit:
      - the evidence README; the wiki README's measured-role paragraph; CHANGELOG if anything is removed.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 1200 bun run typecheck`
- `timeout 900 bun run --cwd <wiki directory> test`
- `timeout 900 bun run --cwd packages/memory/system test`
- `timeout 900 bun test --timeout=0 scripts/memory-bench`
- `timeout 3600 bun scripts/memory-bench/safety/run.mjs --suite offline --ontology`
- `timeout 900 bun examples/memory-and-wiki.ts`
- `timeout 600 bun test --timeout=0 src/__tests__/docs.test.ts`
- `timeout 1800 bun scripts/release.mjs gate`
- `timeout 300 bunx biome check <changed files>`
- Paid, after gate K-1: the Task 2 calibration, then the Task 3 campaign and report; confirm no owned paid process remains.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
