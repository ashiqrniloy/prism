# Phase 11 Part O24 — Memory system: combined check, held-out acceptance, defaults and claims, graduation, skills

> **Amended 2026-11-10 (plan 224 Task 2):** package names follow the seven-bundle map of roadmap Part 3 — `@arnilo/prism-memory-system` (the bundle root `.` and its `/core` subpath) and `@arnilo/prism-knowledge/{wiki, rag}`. Directories do not change, so read every name below as that specifier once plan 224 Task 8 lands.

> **Amended 2026-11-12 (owner, benchmark decision; [plan 218.1](218.1-Phase-11-Part-O19.1-Memory-Benchmarks-External-Outcome-Suites-Replace-BEAM-And-LongMemEval.md)):** `beam-1m` and `longmemeval-m` leave every memory-model gate. They are QA over imported chat logs, not this product's work, and at about 1M tokens a question they cannot reach a deciding sample. Plan 218.1 runs a lean external screen on Compact-Bench for the session tiers. MemoryArena (declarative LTM across sessions) and STATE-Bench's Agent Learning Track (procedural learning and Sleep) are the chosen replacements below, but their adoption is **deferred** (owner, 2026-11-12: cost and time); their rows read `missing` until an adoption task runs before this plan's gate. Plan 218.1 Task 1 re-scopes the criteria rows to match. `locomo` and `memoryagentbench-cr` stay until the owner decides on them.

> **Amended 2026-11-13 (owner, memory evaluation; design §14):** gate A reads the cheap baseline arms once with everything else, defaults and claims follow rules fixed before the read, and a mechanism deferred by the R1 checkpoint is listed as not shipped. [plan 218.2](218.2-Phase-11-Part-O19.2-Memory-System-Session-Tier-Hardening-For-Small-Workers-Durable-Signals-Recall-Query-Verdict-Format-And-Baseline-Arms.md) builds the arms.

## Objectives

- Accept the rebuilt memory system and the wiki **once**, on held-out partitions, and set what ships from the verdicts. This is the work plan 210 Tasks 8 (the freeze), 9, 10 and 11 carried until 2026-11-08, re-pointed at the final product.
  - **Combined development check.** Every component on, against plan 210's slimmed product, with bisection on a miss. Then a product freeze.
  - **The one held-out acceptance (gate A).** Four pinned criteria files: plan 202's robustness rows, plan 208's wiki rows, plan 209's work-outcome rows and the memory-model rows (plan 216 Task 2), with one remediation round.
  - **Preset revision, defaults and claims**, each worded as a verdict.
  - **Graduation** of the surviving packages from the experimental line.
  - **Agent-facing skills** for memory and for the wiki, on the final surface.

## Expected Outcome

- `docs/_evidence/memory-bench/223/{final,freeze}/*`: the combined check and the frozen product hash, with the readiness cache pin passing for it.
- `docs/_evidence/memory-bench/{202,208,209,memory-model}/acceptance/*`: one verdict per criterion, computed with no hand-set value.
- The `conversational` and `coding` presets at their accepted revision; reference-host defaults per verdict; `scripts/memory-bench/defaults.json`; every README and `PRODUCT.md` claim matching its verdict.
- `@arnilo/prism-memory-system`, `@arnilo/prism-memory-core`, `@arnilo/prism-rag` and `@arnilo/prism-wiki` leave the `experimental` list with their first stable versions (published by the release process, not by this plan). The retired names are deprecated as owner actions.
- A `memory-recall` skill (memory) and a `wiki` skill (the wiki), each listed only when its tools are advertised.

This implements the acceptance and graduation step of roadmap Phase 11 "Memory model", after plan 222. It is the last plan of the memory track. **No review task:** it changes defaults, presets and docs, and adds skills through the existing `PackageAPI.skills.addDir` and `Skill.requiresTools` contracts; no kernel contract changes. Publishing follows the release process (plan 215's tooling); this plan sets versions and lists, and the owner runs the publish.

## Tasks

- [ ] Task 1: Combined development check and product freeze (from plan 210 Task 8, dropped there 2026-11-08)
  - Amended 2026-11-13 (owner, memory evaluation; design §14); this criterion adds to the ones below:
    - The bisection also covers plan 218.2's product changes (the STM fields, content protections, automatic chunks, the WM verdict format, the session query) and plan 219 Task 5's probation channel, each as one step.
  - Acceptance Criteria:
    - Functional: **Offline suites pass on the full product (`stm` + `wm` + `rehearsal` + `ltm` + `sleep`, with the wiki):**
      - the memory suites and the wiki suites;
      - the mechanism probes (`stm`, `wm`, `rehearsal`, `non-declarative`, `sleep`);
      - the offline retrieval bench (`retrieval-bench.mjs`; rows T1–T6 and T8, with T3 and T4 exact) on the full product;
      - the safety suite (offline, with the wiki probes);
      - the prefix probe;
      - the growth simulation.
    - Functional: **Paired development check**, inside a gate A-dev budget the owner approves. It compares the full product with plan 210's slimmed product (`P`, recorded by plan 210 Task 7):
      - it must be non-inferior (2 points) on every robustness suite and on W1–W6;
      - it must reproduce the direction of each gate M-1 … M-5, M-T and K-1 verdict;
      - it reports all-required evidence coverage beside accuracy on every QA suite (plan 216 Task 2).

      On a miss, the components are bisected (Sleep, then non-declarative, then retrieval, then Rehearsal, then WM, then STM, then the wiki), and the owner decides whether to revert the responsible component's default or hold it. Development partitions only.

      This is also the first paid check of plan 210 Task 7's removals together (plan 210 Task 8 was dropped). If the bisection does not explain a miss, it continues over those removals against the pre-cleanup product.
    - Functional: **Freeze.**
      - The product is frozen by product hash: the readiness cache-stability pin (plan 202 Tasks 4.11–4.15) passes for it.
      - `docs/_evidence/memory-bench/223/freeze/record.json` lists what the hash includes: every executed plan 202 lever, plan 209's tuning revision, plan 210's removals, and plans 216–222's changes and gate verdicts.
      - No product change lands between the freeze and Task 2, except through the remediation round.
    - Performance: Load and per-turn cost deltas against `P` are reported (`scripts/budgets.json`).
    - Code Quality: The freeze record is generated by the readiness and manifest machinery; no hand-written hash.
    - Security: The safety suite is green on the frozen product.
  - Approach:
    - Documentation Reviewed:
      - plan 210 Task 8 (amended text and the original);
      - plan 202 Tasks 4.11–4.15;
      - the gate verdicts of plans 217–222.
    - Options Considered:
      - Trust the per-gate screens without a combined check. Rejected: the components interact (WM feeds Rehearsal feeds Sleep).
    - Chosen Approach:
      - One combined check, bisection on a miss, one freeze.
    - API Notes and Examples:
      ```sh
      timeout 28800 bun scripts/memory-bench/campaign.mjs --plan memory-model --gate A-dev --manifest --partition dev --arm full-vs-p
      timeout 600 bun scripts/memory-bench/readiness.mjs --freeze --out docs/_evidence/memory-bench/223/freeze/record.json
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/{campaign,readiness}.mjs` and tests;
      - `docs/_evidence/memory-bench/223/{final,freeze}/*`.
    - References:
      - plan 210 Task 8.
  - Test Cases to Write:
    - `full_product_non_inferior_report_rows`.
    - `freeze_record_lists_every_plan_change_and_gate_verdict`.
    - `freeze_refuses_product_without_cache_stability_record`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evidence.
    - Docs pages to create/edit:
      - the evidence README.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: The one held-out acceptance (gate A, paid; from plan 210 Task 9, re-pointed)
  - Amended 2026-11-13 (owner, memory evaluation; design §14); these criteria add to the ones below:
    - **Baseline arms in the one read.** The held-out families are also run on `memory-off`, `fold` and `llm-summary` for the session-tier rows, and on `session` (LTM written only by the agent) for the Rehearsal rows. They are part of the single read of `heldout-a`; no partition is read twice for them.
    - **The shipped triggers.** The held-out `long-horizon` sessions run at the package defaults. A row measured only at lowered triggers is reported as such and backs no default.
    - **Whole-run tokens per successful task** are reported per arm beside every row.
    - Rows deferred by the R1 checkpoint (plan 219 Task 7; plan 220's `l2Deferred`) read `deferred`, not `missing`.
  - Acceptance Criteria:
    - Functional: **The candidate** is Task 1's frozen product. The arms are:

      | Area | Candidate | Compared with | Suites |
      |---|---|---|---|
      | Robustness (plan 202) | `full` with `conversational` at its candidate revision | `preset-r1`, `full-context` / `full-truncated`, `lexical-topk` | robustness suites |
      | Robustness (plan 202) | `coding` (with plan 202 Task 11 and the plan 202 Task 12 points that shipped) | memory-off, `conversational` | coding suites |
      | Wiki (plan 208) | `ltm+wiki`, `coding+wiki` | each against its own base | — |
      | Work outcome (plan 209) | memory-off, `P`, `full`, `full+wiki` | — | work-outcome suite |
      | Memory model | the held-out versions of the live rows S1, S3, M1, M5, R2, R5, R6, L1–L4 and Z1 | the arms named in `memory-model-criteria.json` | — |

    - Functional: **Coverage.** Every arm runs on:
      - every suite's `heldout-a` partition, read here for the first time;
      - every acceptance model (≥ 3 models, ≥ 2 providers, one small);
      - the judge panel calibrated in plan 222, with repeats on the 100-item subset.

      O3 and R3 are repeated with a person's labels. Plan 202's safety gate (Task 14, with the wiki probes) and growth criterion (Task 15) re-run on the frozen product.
    - Functional: **Held-out external suites (amended 2026-11-12 by plan 218.1, replacing plan 202 Task 5's hand-off of `heldout-a` of `longmemeval-m` and `beam-1m`).** The acceptance arms include, with no subsetting:
      - a held-out outcome set for S3, to be chosen before gate A: plan 218.1's lean screen uses Compact-Bench's 22 validated task-preservation tasks, so they are no longer held out (deferred, plan 218.1 Further Actions);
      - `heldout-a` of Compact-Bench retention (M5, L4), drawn once that partition is adopted;
      - `heldout-a` of MemoryArena (R5, L4, Z1);
      - `heldout-a` of STATE-Bench's Agent Learning Track (Z1).

      A manifest that omits or samples any of them is refused, even under budget pressure. Plan 202's robustness claims over `longmemeval-m` and `beam-1m` are not re-run; their 0.13.0 evidence stays as history.
    - Functional: **One manifest** pins:
      - the product hash;
      - `robustness-criteria.json`, `three-tier-criteria.json`, `work-outcome-criteria.json` and `memory-model-criteria.json`, with every hash verified.

      Verdicts come from `acceptance-report.mjs --plan 202`, `--plan 208`, `--plan 209` and `--plan memory-model`, one row per criterion. No verdict changes another verdict's rows.
    - Functional: **A miss is reported as a miss.** No post-hoc margin, partition or model swap. **One remediation round**, under a fresh owner approval, on `heldout-b` with the same manifest rules. There is never a second round.
    - Functional: **Cache.** The live multi-turn cache probe runs once per acceptance route. Its `cacheStability` row is reported next to the verdict, as evidence for cost wording only; it is never a criterion row.
    - Performance: The budget is stated at the gate, with each area's share. Caps are stated per arm, and wall-time limits per suite.
    - Code Quality: The existing campaign, journal and acceptance machinery, with the four profiles under one manifest.
    - Security: Keys are refs. No text in reports.
  - Approach:
    - Documentation Reviewed:
      - plan 210 Task 9 (moved text);
      - plan 202 Tasks 2–17;
      - plan 208 Tasks 1–5;
      - plan 209 Tasks 5–6;
      - plan 216 Task 2;
      - 188.10 Task 9 (manifest discipline).
    - Options Considered:
      - One held-out run per component. Rejected: it spends held-out items several times and freezes several products.
    - Chosen Approach:
      - One frozen product, one held-out read, four criteria files.
    - API Notes and Examples:
      ```sh
      timeout 28800 bun scripts/memory-bench/campaign.mjs --plan memory-model --gate A --manifest --partition heldout-a
      timeout 600 bun scripts/memory-bench/acceptance-report.mjs --plan memory-model
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/{campaign,acceptance,acceptance-report}.mjs` and tests;
      - `docs/_evidence/memory-bench/{202,208,209,memory-model}/acceptance/*`.
    - References:
      - plan 210 Task 9; plans 202, 208, 209, 216.
  - Test Cases to Write:
    - `one_manifest_pins_four_criteria_hashes_and_the_freeze_hash`.
    - `acceptance_refuses_criteria_or_product_drift`.
    - `acceptance_refuses_missing_or_sampled_external_heldout_suites` (replaces `acceptance_202_refuses_missing_or_sampled_longmemeval_m_or_beam_1m`, plan 218.1).
    - `verdict_rows_match_each_criteria_file`.
    - `small_model_rows_present`.
    - `human_labels_used_for_o3_and_r3`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evidence.
    - Docs pages to create/edit:
      - the evidence READMEs.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: Preset revision, defaults and claims (from plan 210 Task 10, re-pointed)
  - Amended 2026-11-13 (owner, memory evaluation; design §14); these criteria add to the ones below:
    - **WM default.** It follows gate M-2's rule (plan 218 Task 6) as the held-out read confirms or reverses it: the model policy, or the deterministic policy.
    - **No claim against a cheaper baseline without the interval.** The README says the session tiers beat `fold` or `llm-summary` only where the held-out interval supports it. Where it does not, the README states the measured parity and the whole-run cost of each, and the profile that avoids the cost.
    - **Worker-model guidance** comes from the `full-r-tiered` arm and plan 219.1 Task 2's cue-quality reading: which workers may run on a small model, and which should not.
    - **Deferred mechanisms** (conditioned responses, sensitization, exemplar priming, Sleep's trigger job, when the checkpoint deferred them) are listed as not shipped in 0.13.0, with their backlog entry.
  - Acceptance Criteria:
    - Functional: **Preset revision (plan 202 rules, carried).**
      - If gate A passes **better-than-full-context** or **robust**, `CONVERSATIONAL_PRESET_REVISION` becomes 2, and `conversational` resolves to the accepted candidate.
      - A host on `ltm: { preset: "conversational" }` gets it with no config change, tested with a revision-1 config.
      - On a final miss, the last passing revision ships, and the README states the failing criteria.
      - `coding` ships at its accepted revision if it passes its rows; otherwise the owner decides here whether it ships as a documented, unaccepted opt-in or is withheld.
    - Functional: **Component defaults.** Each component's default comes only from its rows plus a passed safety gate:
      - the session tiers (`stm`, `wm`, Rehearsal): S, M and R rows;
      - procedural, triggers and priming: L rows;
      - Sleep: Z rows. Sleep is never *scheduled* by a package default; the reference host's schedule follows Z1;
      - the wiki: plan 208's outcome-class rules, carried.

      A component without a passing row stays off by default and is documented as opt-in, with its failing rows named.
    - Functional: **Working-agent defaults (plan 209 rules, carried).** `rules.capture`, `exchanges.steps` and `lessons.nudge` follow W1, W2, W5 and W6 as plan 210 Task 10 specified.
    - Functional: **Claims.**
      - Every README and `PRODUCT.md` claim is a verdict's wording, naming models, judges, suites, cost and latency.
      - "Better than full context" appears only if that row set passed; "memory improves work" only if `P` vs memory-off passes.
      - `PRODUCT.md`'s memory subsection describes the memory model (STM, WM, Rehearsal, LTM, Sleep) and names the wiki as a separate knowledge package.
      - Experimental-tier features are named as experimental and carry no claim.
      - The rows plan 210 recorded `unmeasured — wave cancelled 2026-11-08` are listed as unmeasured, with no claim and their defaults unchanged, unless gate A measured them: the Task 3.1 recall variants, aggregation/abstention, and P3–P5. The retrieval rows that plan 219.1's gate M-T decided (`retrieval.strength-priors`, `recall.multi-query`, `recall.unmatched-terms`, `recall.state-grouping`, `navigation.agentic-lexical`, `recall.gather`, `recall.expansion`, `decisions.P5`) take M-T's disposition, and gate A confirms or withdraws any claim on them.
    - Functional: **One change.** `scripts/memory-bench/defaults.json` records every decision with its evidence hash. The preset revision, every default and every claim land together.
    - Functional: The 188.11 limitations register is closed: each entry is resolved with evidence or carried into Known limitations.
    - Performance: n/a.
    - Code Quality: Preset changes are object edits with a `presetRevision` bump. The reference-host defaults are config values. Baselines are regenerated if a preset value is in one.
    - Security: A default that stores conversation content, or adds background model calls over it, is enabled only under a passed safety gate. The READMEs state what is stored, what each worker sends to its model, and the retention of chunks.
  - Approach:
    - Documentation Reviewed:
      - plan 210 Task 10 (moved text);
      - gate A verdicts;
      - plan 188.11 Tasks 3 and 6.
    - Options Considered:
      - Turn the whole system on by default as the product's differentiator. Rejected: the claims rule allows only measured claims, and unmeasured background calls over conversation content are a privacy cost.
    - Chosen Approach:
      - The verdicts decide, in one change.
    - API Notes and Examples:
      ```ts
      memorySystem({ ltm: { preset: "conversational", tools: { root } } }); // unchanged host line → accepted revision
      ```
    - Files to Create/Edit:
      - `packages/memory/system/src/{config,ltm/config}.ts` and tests;
      - `apps/prism-agent/src/host/config.ts` and tests;
      - `scripts/memory-bench/defaults.json`;
      - `docs/_evidence/memory-bench/188.11/limitations.json`;
      - the memory-system and wiki READMEs; `PRODUCT.md`; `apps/prism-agent/README.md`; `CHANGELOG.md`;
      - `scripts/compat-baseline/*` (only if affected).
    - References:
      - Task 2.
  - Test Cases to Write:
    - `host_config_revision_1_resolves_to_accepted_revision`.
    - `component_defaults_follow_rows_and_safety`.
    - `readme_and_product_claims_match_verdicts`.
    - `wiki_default_follows_outcome_class_and_safety`.
    - `defaults_follow_work_outcome_verdict_and_safety`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — presets, defaults, claims.
    - Docs pages to create/edit:
      - READMEs; `PRODUCT.md`; `apps/prism-agent/README.md`; `CHANGELOG.md`.
    - `docs/index.md` update: yes, if a scope sentence changes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Graduation from the experimental line (from plan 210 Task 10, re-pointed)
  - Acceptance Criteria:
    - Functional: **The packages leave the `experimental` list.** `@arnilo/prism-memory-system`, `@arnilo/prism-memory-core`, `@arnilo/prism-rag` and `@arnilo/prism-wiki` leave it in `scripts/independent-packages.json` and take their first stable versions on their independent lines. The version is decided here and sorts above `0.13.0-experimental.N`; the dist-tag is `latest`.
    - Functional: **The retired names.** `@arnilo/prism-memory-observational`, `@arnilo/prism-memory-fabric` and `@arnilo/prism-memory-wiki` are recorded for `npm deprecate` with their replacement, as owner actions in the release notes, if they were published on the experimental line.
    - Functional: **Strict compat.**
      - The compat baselines become strict: plan 215 Task 2's `experimental` classification stops applying.
      - The experimental README notices are replaced by each package's `## Compatibility` contract (the 188.11 shape), now in force.
      - `stability.test.ts` covers every `contract` and `tuning` field of the memory system and the wiki.
    - Functional: **Live checks on the graduated revision.**
      - The live two-principal memory journey leg (dropped from plan 215 Task 32) is added back as a live row and runs against the graduated revision.
      - The cache-parity runner (plan 215 Task 23) measures the reference host with memory on.
    - Functional: **Roadmap and docs.**
      - The roadmap's package table (§2.10) is updated: the `memory-observational`, `memory-fabric` and `memory-wiki` rows become `memory-system` and `wiki`.
      - The "experimental memory line" row is closed.
      - `docs/index.md` package links are verified.
    - Performance: n/a.
    - Code Quality: The release tooling's lists are updated (`scripts/release.mjs`, `package-truth.mjs`), and the release gate is green.
    - Security: The stable→experimental dependency gate is removed for the graduated packages, and stays for anything still experimental.
  - Approach:
    - Documentation Reviewed:
      - plan 215 Tasks 1–4, 23 and 32;
      - `scripts/independent-packages.json`;
      - `docs/release.md`.
    - Options Considered:
      - Graduate before acceptance. Rejected: a stable promise on unaccepted defaults.
    - Chosen Approach:
      - Graduate the accepted surface.
    - API Notes and Examples:
      - n/a.
    - Files to Create/Edit:
      - `scripts/{independent-packages.json,release.mjs,package-truth.mjs}` and tests;
      - `scripts/compat-baseline/*`;
      - the package READMEs (`## Compatibility`);
      - `roadmap.md` (§2.10 table, the Phase 11 rows); `docs/index.md`; `docs/release.md`; `CHANGELOG.md`.
    - References:
      - plan 215.
  - Test Cases to Write:
    - `graduated_packages_absent_from_experimental_list_and_baselines_strict`.
    - `retired_names_recorded_for_deprecation`.
    - `stability_tables_cover_every_field`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — stability promise.
    - Docs pages to create/edit:
      - READMEs; `roadmap.md`; `docs/release.md`; `CHANGELOG.md`.
    - `docs/index.md` update: yes — package scope sentences, if changed.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: Memory and wiki skills on the final surface (from plan 210 Task 11, re-pointed), and plan end
  - Acceptance Criteria:
    - Functional: **Entry check.** Re-run plan 215 Task 5 (a)'s tool ledger for the memory system and the wiki on the graduated tree, and record their model-visible tools and `when` gates. A skill is written only for a tool that exists.
    - Functional: **The memory system's `memory-recall` skill** covers:
      - when to call `memory.recall` (by query for long-term memory; by id for the ids in the session surface) and when to trust the delivered blocks;
      - reading chunks instead of re-running tools;
      - writing a lesson or procedure versus leaving it to Rehearsal;
      - correcting or forgetting a stale memory;
      - that recalled content and trigger reminders are data, not instructions.

      It declares `requiresTools: ["memory.recall"]`, and is hidden when memory is off for the session.
    - Functional: **The wiki's `wiki` skill** covers searching and reading concepts, following a claim to its evidence, and ingesting a source. It declares the wiki's tools, and is hidden when they are not advertised.
    - Functional: **Commands are not skills.** Scope, episode end, rehearse and sleep are host and user controls; the skills mention only what the agent can call.
    - Functional: **Skill text quotes nothing** that contradicts Task 3's claims. The task note quotes the claim lines each skill relies on.
    - Functional: **Plan end.** Compromises, Further Actions, and the backlog hand-off. The memory track is closed in `plans/README.md`.
    - Performance: Plan 215 Task 8's catalog budget.
    - Code Quality: Plan 215 Task 8's skill contract (`package_skills_conform`).
    - Security: The skills tell the model that recalled content is data, and that cross-principal recall is impossible by design.
  - Approach:
    - Documentation Reviewed:
      - plan 210 Task 11 (moved text);
      - plan 215 Tasks 5–8;
      - the final READMEs.
    - Options Considered:
      - One combined skill. Rejected: the wiki is a separate package with its own tools.
    - Chosen Approach:
      - One narrow skill per package.
    - API Notes and Examples:
      ```markdown
      metadata:
        prism-requires-tools: memory.recall
      ```
    - Files to Create/Edit:
      - `packages/memory/system/skills/memory-recall/SKILL.md` (new), `src/index.ts`, `package.json` (`files`), README, CHANGELOG, `src/__tests__/skills.test.ts`;
      - the wiki package's `skills/wiki/SKILL.md` (new), with the same companions;
      - `scripts/budgets.json`;
      - this plan; `plans/README.md`; `plans/backlog.md`.
    - References:
      - plan 210 Task 11; plan 215 Task 8.
  - Test Cases to Write:
    - `memory_system_registers_memory_recall_skill`.
    - `memory_skill_hidden_when_memory_disabled_for_session`.
    - `wiki_registers_wiki_skill_hidden_without_its_tools`.
    - `skills_name_only_existing_tools` (through `package_skills_conform`).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — skills added.
    - Docs pages to create/edit:
      - the READMEs; `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 1200 bun run typecheck`
- `timeout 900 bun run --cwd packages/memory/system test`
- `timeout 900 bun run --cwd packages/memory/core test`
- `timeout 900 bun run --cwd <wiki directory> test`
- `timeout 1800 bun scripts/memory-bench/mechanism-probes/run.mjs`
- `timeout 900 bun test --timeout=0 scripts/memory-bench`
- `timeout 3600 bun scripts/memory-bench/safety/run.mjs --suite offline --ontology`
- `timeout 3600 bun scripts/memory-bench/growth.mjs --offline`
- `timeout 300 bun test packages/memory/system/src/ltm/__tests__/prefix-stability.test.ts`
- `timeout 120 bun scripts/memory-bench/prefix-probe.mjs --out docs/_evidence/memory-bench/223/freeze/prefix-probe.json`
- `timeout 900 bun run --filter @arnilo/prism-agent test`
- `timeout 900 bun examples/memory-system.ts`, `bun examples/memory-sleep.ts`, `bun examples/memory-and-wiki.ts`
- `timeout 600 bun test --timeout=0 src/__tests__/docs.test.ts`
- `timeout 1800 bun scripts/release.mjs gate`
- `timeout 300 bunx biome check <changed files>`
- Paid, in order, after their gates:
  1. Task 1's combined development check (gate A-dev);
  2. Task 2's held-out acceptance (gate A), with one live cache probe per route; after a miss only, the one remediation round on `heldout-b` (fresh approval);
  3. the four acceptance reports;
  4. confirm no owned paid process remains.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
