# Phase 11 Part O16 — Memory feature audit and acceptance: measure, diagnose, justify or remove, then accept once before the freeze

## Objectives

- After every memory plan of the 0.13.0 train is built and screened on development partitions (188.x, 202, 207, 208, 209), audit **every memory feature** and decide, from evidence, whether it stays in the API-level-1 surface that plan 185 freezes. The features are mechanisms, config fields, kinds, tools, commands, workers, delivery tiers and preset contents.
- For each feature with **no measured benefit, a neutral result, or a negative impact**:
  1. **detect mechanism errors**: does it fire, does its effect reach the agent's context or ranking, is the effect what the design says;
  2. **analyse conceptual gaps**: what would have to be true for it to help, and is there a minimal change that could make it useful;
  3. **measure** the fixed variant once where a credible fix exists;
  4. **remove** it when no justification is found: no benefit, no safety role, no cost role, and no credible gap fix.
- Freeze a smaller memory surface whose every remaining feature has a recorded justification. Unmeasured mechanisms do not become permanent API-level-1 obligations.
- Then, on that final product, run the **one held-out acceptance** for every memory claim (plan 202's robustness rows, plan 208's ontology rows, plan 209's work-outcome rows), and set the preset revision, the defaults and the published claims from its verdicts. These were plan 202 Tasks 18–19, plan 208 Tasks 6–7 and plan 209 Task 7 until the owner moved them here on 2026-10-31.

## Expected Outcome

- `docs/_evidence/memory-bench/210/feature-ledger.json`: one row per feature with its owner package, default, preset membership, cost, the role it claims (accuracy, cost, safety, inspectability, compatibility), its evidence (file and hash) and its status (`benefit`, `neutral`, `negative`, `unmeasured`, `safety-proven`).
- Mechanism probes for every candidate (`scripts/memory-bench/mechanism-probes/`), offline and free, with verdicts `works`, `never-fires`, `no-effect` or `wrong-effect`.
- A gap analysis per candidate with a predicted, measurable effect for each proposed fix.
- `scripts/memory-bench/cleanup-criteria.json`: pre-registered decision rules, committed before the ablation campaign.
- One owner-gated ablation campaign (gate C-1): leave-one-out for preset members, add-one for opt-ins, and fixed variants, on development partitions of the robustness and work-outcome suites. Held-out partitions stay unread until Task 9.
- A decision record, approved by the owner. Removals land with deleted code, config fields, exports, docs and tests; regenerated baselines; a repo-wide sweep; and migration notes.
- A combined non-inferiority check and a product freeze (Task 8).
- One held-out acceptance under owner gate 3 (Task 9), with one verdict per criterion of `robustness-criteria.json`, `three-tier-criteria.json` and `work-outcome-criteria.json`, all on the frozen product.
- `conversational` revision 2 (or the last passing revision), the memory, ontology and working-agent defaults, `scripts/memory-bench/defaults.json`, and every README and `PRODUCT.md` memory claim, in one change (Task 10). The memory surface is handed to plan 184/185.

This plan is a pre-publish part of roadmap **Phase 11** (memory, Part O, sub-part 16). **Owner decision 2026-10-31:** an end-of-build audit inside 0.13.0 identifies memory features with no measured benefit or a negative impact, detects mechanism errors, analyses conceptual gaps, and removes what cannot be justified. It runs as release step **17f**, the last plan of a strictly sequential memory train (owner decision 2026-10-31): 202 → 207 → 208 → 209 → **210** → 184 → 185.

- It starts after plan 209 Task 6, when every memory plan has development evidence and has listed its unjustified features for the ledger.
- It ends before plan 184 (cache parity, which measures the final product) and plan 185 (surface freeze).
- **Audit before acceptance.** Removals happen on development evidence only, before any held-out item is read. The held-out acceptance then measures the product that ships, so no claim has to be re-pointed and no removal needs a second held-out read.

**Scope:** `memory-observational`, `memory-fabric`, `memory-wiki` and the parts of `memory-core` only they use. `memory-rag` (document retrieval, a separate capability the owner keeps outside memory) and `memory-compaction` (measured by plan 194's rot curve) are out of scope; the ledger lists them as excluded with that reason.

**No review task:** the plan adds no contract; it removes. A removal is planned the way a retirement is: baseline regeneration, sweep, and migration note. The preset revision and defaults Task 10 sets are the ones plans 202, 208 and 209 reviewed and specified. **Paid work is owner-gated twice:** C-1 (ablations and the combined check) and gate 3 (held-out acceptance, plus a fresh approval for the one remediation round). Live runs stay on plan 202's providers, never `openrouter/free`. No version bump or publish: every package ships in plan 187's lockstep 0.13.0 publish.

**Release gating** (moved from plan 202 with its Task 18, unchanged):

- 0.13.0 does not wait for a passing verdict.
- One remediation round is allowed. On a miss, the levers and tuning-tier values of plans 202, 207 and 209 may be revised once on development partitions, then every plan's arms are measured once on `heldout-b`.
- A second miss is final. Task 10 ships the last passing revision with claims limited to the criteria that passed.

## Tasks

- [ ] Task 1: The feature ledger
  - Acceptance Criteria:
    - Functional: The ledger has one row per feature. The minimum list, to be completed from the code and the READMEs' config stability tables:
      - **fabric retrieval and ranking:** lexical retrieval; `retrieval: "hybrid"` (kept by 188.11 for compatibility only); scope priors; storage strength S and ACT-R retrieval strength R priors; per-kind decay; `similar` links; the `linker` and `evolution` workers; recall kind hints; multi-query `queries`; `unmatchedTerms`;
      - **write path:** default consolidation (same-text update, Dice similarity); `consolidate.decider: "model"`; session consolidation and its extractor; OM promotion; exchange archive; keyword enrichment (202 Task 5); timeline (202 Task 6); state grouping (202 Task 7); facts preset (202 Task 17, if shipped); `exchanges.steps` (209);
      - **lifecycle:** use-based verification; archive with revival; capacity budgets, merging and eviction; episode merge (model call); widening to `agent` and narrowing; `memory:maintain`;
      - **scopes:** `user`, `project`, `path`, `agent`, `team`; shadowing by key;
      - **delivery:** passive semantic tail; precision filter (202 Task 8); memory directory; pinned core or standing rules (209); path cues; team store and `memory:share`; decision-model points P1–P7 (202 Task 12);
      - **kinds:** `working`, `episode` view, `fact`, `preference`, `procedure`, `decision`, `file`, `exchange`, `concept`; lessons (209);
      - **ontology tier (207):** subject binding (deterministic and extractor), the curator pass and each trigger policy, concept prior, passive pointer, concept sharing, claim lint, source ingest;
      - **OM:** observer, reflector, dropper policies, task state, OM compaction, the `recall` tool, the pinned context mode;
      - **presets:** `conversational` (each component), `coding` (each component);
      - **inspectability and safety:** OKF markdown files, export and import, trust scan, redaction, deletion cascade, provenance, legal holds.
    - Functional: Each row records:
      - its default and preset membership;
      - its per-unit cost (calls, writes, tokens);
      - its claimed role, one or more of accuracy, cost, latency, safety, inspectability or compatibility;
      - its evidence: every evidence file under `docs/_evidence/memory-bench/` that measured it (development partitions; no held-out read exists yet), with the effect, CI and hash;
      - its status.
      A feature whose claimed role is safety or inspectability is `safety-proven` only when a named test proves the property. Otherwise it is `unmeasured`.
    - Functional: **Candidates** are rows with status `neutral`, `negative` or `unmeasured`, including every feature plans 202, 208 and 209 listed at their plan end. The ledger is committed before Task 2.
    - Performance: Built offline from code, READMEs and evidence files.
    - Code Quality: `scripts/memory-bench/feature-ledger.mjs` builds it from the config stability tables (`stability.test.ts` sources) plus a hand-maintained mechanism list. A test fails if a config field or kind is missing from the ledger.
    - Security: No note text; evidence references only.
  - Approach:
    - Documentation Reviewed:
      - fabric README (`## Config`, `### Config stability`, `## Compatibility`, `### Known limitations`), OM README, wiki README;
      - `docs/_evidence/memory-bench/{188.*,202,207,208,209}/`;
      - `scripts/memory-bench/defaults.json`;
      - plans 188.4–188.6 (lifecycle claims), 188.7 findings F3–F12.
    - Options Considered:
      - Audit only features named as "experimental". Rejected: most of the lifecycle has never shown task benefit (the fabric README says so), whatever its label.
    - Chosen Approach:
      - An exhaustive, test-enforced ledger.
    - API Notes and Examples:
      ```sh
      timeout 120 bun scripts/memory-bench/feature-ledger.mjs --out docs/_evidence/memory-bench/210/feature-ledger.json
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/feature-ledger.mjs` and test (new);
      - `docs/_evidence/memory-bench/210/{feature-ledger.json,README.md}` (new).
    - References:
      - Plans 188.11 Task 6, 202, 207–209.
  - Test Cases to Write:
    - `ledger_covers_every_config_field_kind_tool_and_command`.
    - `safety_proven_requires_a_named_passing_test`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evidence.
    - Docs pages to create/edit:
      - evidence README.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: Mechanism verification — offline probes for every candidate
  - Acceptance Criteria:
    - Functional: For each candidate, a deterministic probe on the mock provider drives the real packages through a scripted scenario designed to trigger it, and records:
      - **fires:** the mechanism ran, with a count and the trigger rate on a realistic replay, using a development-partition history ingested offline;
      - **reaches:** its output changed something the agent receives, such as ranking, rendered context, a tool result, a stored note or a delivery decision. Measured by diffing the provider request and the tool results with the mechanism on and off;
      - **correct:** the effect matches the documented behavior. Examples: R rises after a use and orders the expected note first; widening needs two independent projects with the same normalized text; eviction respects pins; a decay rate changes rank as documented; the curator's trigger fires on co-read clusters.
      Verdicts: `works`, `never-fires`, `no-effect`, `wrong-effect`.
    - Functional: A mechanism error found here (`never-fires`, `no-effect`, `wrong-effect` against the documentation) is fixed in this task with a regression test, when the fix is local and does not change the feature's contract. Otherwise it is recorded for Task 3. Each fix is listed in the ledger and the task note.
    - Functional: Realistic trigger rates come from replaying development histories offline: one LongMemEval-M development history, one BEAM-100K, one coding lifecycle persona and one work-outcome persona, through the product path with scripted model replies. A mechanism that fires on fewer than 1% of eligible turns in realistic use is flagged `rare`.
    - Performance: All probes finish offline in ≤ 30 minutes, with no model or network call.
    - Code Quality: One probe file per feature group under `scripts/memory-bench/mechanism-probes/`, sharing the `prefix-probe.mjs` request-capture helpers. Probes report hashes, counts and verdicts only.
    - Security: Fixture text only; temporary roots are removed on exit.
  - Approach:
    - Documentation Reviewed:
      - `scripts/memory-bench/prefix-probe.mjs` (request capture);
      - fabric `lifecycle/*`, `scope/recall.ts`, `links.ts`, `workers.ts`, `delivery/*`;
      - the wiki consolidation triggers;
      - OM's observer, reflector and dropper.
    - Options Considered:
      - Go straight to paid ablations. Rejected: a feature that never fires shows "no benefit" for a reason no ablation reveals, and fixing it first is cheaper.
    - Chosen Approach:
      - Free mechanism verification first, so paid ablations measure features that work as designed.
    - API Notes and Examples:
      ```sh
      timeout 1800 bun scripts/memory-bench/mechanism-probes/run.mjs --out docs/_evidence/memory-bench/210/mechanisms.json
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/mechanism-probes/*` and tests (new);
      - fixes in `packages/memory/{fabric,observational,wiki}/src/*` (as found), each with a test;
      - `docs/_evidence/memory-bench/210/mechanisms.json`;
      - `CHANGELOG.md` for each fix.
    - References:
      - Task 1.
  - Test Cases to Write:
    - `probe_detects_a_seeded_never_firing_mechanism`.
    - `probe_detects_a_seeded_no_effect_mechanism` (the mechanism runs but the request bytes are identical).
    - `probes_deterministic_and_text_free`.
    - One regression test per fixed mechanism error.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: possibly — bug fixes.
    - Docs pages to create/edit:
      - the affected package README if documented behavior was wrong;
      - `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: Conceptual gap analysis
  - Acceptance Criteria:
    - Functional: For each candidate that `works` but shows no benefit, or whose mechanism error needs a contract change, record:
      - **intended effect:** the problem it was meant to solve, with its source (plan, paper);
      - **why it did not show:** a classification, one of:
        - the measured suites cannot exercise it (for example capacity needs a long-horizon archive);
        - it is dominated by another feature (for example R and S priors under strong lexical matches);
        - its trigger is too rare;
        - its effect is too small at current budgets;
        - the design premise is wrong for an LLM agent;
      - **evidence for the classification:** failure-stage tables, trigger rates (Task 2), literature;
      - **minimal gap fix, if any:** a specific change with a **predicted, measurable effect** on a named metric and suite (for example "R prior weight 0.05 → 0.15 should lift knowledge-update by ≥ 3 points on LongMemEval-M dev"), or an **alternative measurement** for a feature whose benefit lies outside the suites (for example 202 Task 15's growth simulation for capacity and eviction);
      - **verdict:** `fix-and-measure`, `measure-elsewhere`, or `no-credible-path`.
    - Functional: The analysis is reviewed by a second pass with no access to the first pass's verdicts: a delegated reviewer, or the owner. Disagreements are recorded and resolved before Task 4's criteria are frozen.
    - Performance: Offline research.
    - Code Quality: One section per feature in `docs/_evidence/memory-bench/210/gap-analysis.md`; the predictions are machine-readable in `gap-predictions.json`, so Task 5 scores them.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - Task 1 ledger and Task 2 mechanisms;
      - failure-stage tables from 202, 208 and 209;
      - the literature behind each feature: ACT-R (Anderson & Schooler 1991), CLS, A-MEM, Mem0, Zep, ACE, MINJA, MemoryCode;
      - the 2026-10-31 first-principles assessment (features an agent would not build for itself).
    - Options Considered:
      - Remove every neutral feature without analysis. Rejected by the owner's rule: a neutral result may come from a mechanism error or a fixable gap.
    - Chosen Approach:
      - An explicit, falsifiable prediction for every proposed rescue.
    - API Notes and Examples:
      ```json
      { "feature": "lifecycle.retrievalStrength", "verdict": "fix-and-measure", "change": "prior weight 0.05→0.15", "metric": "knowledge-update", "suite": "longmemeval-m/dev", "predicted": ">= +3 points" }
      ```
    - Files to Create/Edit:
      - `docs/_evidence/memory-bench/210/{gap-analysis.md,gap-predictions.json}` (new).
    - References:
      - Tasks 1–2.
  - Test Cases to Write:
    - `gap_predictions_schema_valid_and_reference_ledger_rows`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - evidence files.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Pre-registered decision rules
  - Acceptance Criteria:
    - Functional: `scripts/memory-bench/cleanup-criteria.json` is committed and hashed before any Task 5 run. It defines per feature:
      - **keep:**
        - a benefit with CI lower bound > 0 on its target metric (from existing evidence or Task 5);
        - **or** `safety-proven`;
        - **or** a measured cost or latency role (≥ 10% cost or p95 reduction on its suite);
        - **or** it is a compatibility shim the owner names explicitly, with its reason;
      - **fix-kept:** the Task 3 fix measured once, meeting its own prediction's direction with CI lower bound > 0. A fix that misses its prediction does not get a second try;
      - **remove:**
        - status `negative` (CI upper bound < 0 on any ability, or a safety failure), whatever else;
        - or no keep reason, the fix (if any) failed, and removal is non-inferior on development partitions: with the feature removed, every suite stays within 2 points at the CI lower bound and the work-outcome rows W1–W6 stay non-inferior;
      - **owner-hold:** a remove verdict on a feature the owner wants to keep needs a written reason in the decision record, and the feature moves to the experimental tier (below) instead of the stable surface.
    - Functional: **Experimental tier.** A kept-by-owner feature without evidence is documented as experimental, outside the API-level-1 promise (fabric README `## Compatibility`), so it can change or go in a minor version. This is the only route to keep an unjustified feature.
    - Functional: **Held-out protection.** Every rule here uses development partitions only. Held-out partitions stay unread until Task 9, so a removal needs no held-out confirmation: Task 9 accepts the product with the removals in it, and a removal that hurts shows up there as a miss.
    - Performance: n/a.
    - Code Quality: Same schema conventions as `robustness-criteria.json`.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - `robustness-criteria.json`, `three-tier-criteria.json`, `work-outcome-criteria.json`;
      - the 188.11 compatibility tiers.
    - Options Considered:
      - Decide case by case after the data. Rejected: the 188.10 lesson is that only pre-registered rules survive scrutiny.
    - Chosen Approach:
      - Rules first, then data.
    - API Notes and Examples:
      ```sh
      timeout 60 bun scripts/memory-bench/robustness.mjs --verify-criteria cleanup-criteria.json
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/cleanup-criteria.json` (new), validator in `robustness.mjs`, tests.
    - References:
      - Task 3.
  - Test Cases to Write:
    - `cleanup_criteria_hash_pinned_by_manifests`.
    - `negative_feature_always_removed_by_rules`.
    - `owner_hold_routes_to_experimental_tier`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - evidence README.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: Ablation and re-measurement campaign (owner gate C-1, paid)
  - Acceptance Criteria:
    - Functional: Gate C-1 states the budget, the models (two answer models from two providers, one small; the curator and decision models as shipped), the arms and the partitions. Arms:
      - **leave-one-out:** for each candidate that is a member of a shipped preset or a reference-host default, that configuration with the feature off;
      - **add-one:** for each opt-in candidate, the base configuration plus the feature;
      - **fixed variants:** for each `fix-and-measure` verdict, the fix;
      - **alternative measurements:** for each `measure-elsewhere` verdict, its named measurement (for example 202's growth simulation, or the work-outcome long-horizon personas).
      Partitions: development partitions of the robustness suites and the work-outcome suite. Features with similar targets may share a factorial design (stated at the gate) to save cost. The gate also reserves the budget for Task 8's combined check.
    - Functional: Every arm is paired against its base on the same items. The report gives the effect per target metric with clustered CIs (plan 198), cost and p95 latency deltas, and the Task 3 prediction scored as hit or miss.
    - Functional: The verdict per feature is computed by `acceptance-report.mjs --plan 210` from `cleanup-criteria.json`, with no hand-set value.
    - Performance: Caps per arm stated and reported.
    - Code Quality: Existing campaign machinery. Arms are expressed as config overrides; a feature without a toggle gets a test-only switch in `scripts/memory-bench`, never a new product config field.
    - Security: Keys as refs. No text in reports.
  - Approach:
    - Documentation Reviewed:
      - `scripts/memory-bench/{ablations,campaign,paired-sizing,stats}.mjs`;
      - plan 198 statistics;
      - plan 188.6's ablation design.
    - Options Considered:
      - Ablate every feature, including measured ones. Rejected: cost; features with accepted evidence are not candidates.
    - Chosen Approach:
      - Targeted paired ablations on candidates, plus scored predictions.
    - API Notes and Examples:
      ```sh
      timeout 28800 bun scripts/memory-bench/campaign.mjs --plan 210 --manifest --partition dev
      timeout 600 bun scripts/memory-bench/acceptance-report.mjs --plan 210
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/{ablations,campaign,acceptance-report}.mjs` and tests;
      - `docs/_evidence/memory-bench/210/{gates,ablations}/*`.
    - References:
      - Tasks 1–4.
  - Test Cases to Write:
    - `plan_210_arms_paired_on_identical_items`.
    - `verdicts_computed_from_cleanup_criteria_only`.
    - `prediction_scoring_marks_hit_or_miss`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evidence.
    - Docs pages to create/edit:
      - evidence README.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: Decision record and owner review
  - Acceptance Criteria:
    - Functional: `docs/_evidence/memory-bench/210/decisions.md` lists each candidate with its verdict (keep, fix-kept, remove, owner-hold → experimental) and evidence, and the list of removals. The owner reviews it, and every owner-hold carries a written reason.
    - Performance: n/a.
    - Code Quality: The record is generated from the ledger and the Task 5 verdicts, plus the owner's notes.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - Tasks 1–5.
    - Options Considered:
      - Remove without owner review. Rejected: removals change the product the owner publishes.
    - Chosen Approach:
      - An evidence-generated record and an owner decision.
    - API Notes and Examples:
      - n/a.
    - Files to Create/Edit:
      - `docs/_evidence/memory-bench/210/decisions.md`.
    - References:
      - Task 4.
  - Test Cases to Write:
    - `decision_record_matches_ledger_and_verdicts`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — decision record.
    - Docs pages to create/edit:
      - evidence files.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7: Removal, experimental tier and sweep
  - Acceptance Criteria:
    - Functional: Each removal deletes, with no alias:
      - the code;
      - the config fields (and their rows in the config stability table and `stability.test.ts`);
      - the exports, kinds, tools, commands or tool parameters;
      - the docs sections, examples, tests and the `defaults.json` entries.
      Preset contents change through the candidate revision Task 10 publishes, with a test that a host config written for revision 1 still validates. A removed contract field in a host config fails validation with a named error and a migration hint, recorded in `docs/migrate-to-0.13.md`.
    - Functional: Owner-hold features move to the experimental tier: their README section is marked experimental, they are listed under "May change in a minor version" in `## Compatibility`, and `stability.test.ts` gains an `experimental` tier.
    - Functional: Repo-wide sweep for every removed name and string over `src/ packages/ apps/ scripts/ examples/ docs/ README.md PRODUCT.md`, excluding `dist/`, `plans/`, `docs/history/` and `docs/_evidence/`.
    - Functional: Baselines regenerated with `bun scripts/release.mjs gate --update-baseline` for every affected package (`scripts/compat-baseline/arnilo__prism-memory-{fabric,observational,wiki,core}.txt`), and the post-regeneration diff is attributed to this plan in the note.
    - Functional: Reference host updated in the same task. `bun run --filter @arnilo/prism-agent test` stays green.
    - Performance: Package load cost and the fabric's per-turn work are measured before and after (`scripts/budgets.json`), and the reduction is reported.
    - Code Quality: Removals are whole: no dead branches, no unused config plumbing, no "deprecated" comments.
    - Security: Removing a safety-adjacent mechanism is never allowed under this task without a `safety-proven` replacement. Task 4's rules already keep `safety-proven` features.
  - Approach:
    - Documentation Reviewed:
      - `references/prism.md` §3 probes 6–8 (retirement, public surface, callers);
      - Task 6 record.
    - Options Considered:
      - Deprecate instead of removing. Rejected: 0.13.0 is unpublished, and the roadmap forbids compatibility aliases.
    - Chosen Approach:
      - Clean deletion before the freeze.
    - API Notes and Examples:
      ```sh
      timeout 1800 bun scripts/release.mjs gate --update-baseline
      ```
    - Files to Create/Edit:
      - `packages/memory/{fabric,observational,wiki,core}/**` (as decided);
      - `apps/prism-agent/**`, `examples/**`, `scripts/**` callers;
      - READMEs, `docs/migrate-to-0.13.md`, `CHANGELOG.md`;
      - `scripts/compat-baseline/*`, `scripts/budgets.json`.
    - References:
      - Task 6.
  - Test Cases to Write:
    - `removed_memory_names_absent_repo_wide`.
    - `previous_revision_host_config_still_validates_or_fails_with_named_migration_error`.
    - `experimental_tier_enforced_by_stability_test`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — removed surface.
    - Docs pages to create/edit:
      - the affected READMEs;
      - `docs/migrate-to-0.13.md`;
      - `PRODUCT.md` if a described feature is removed;
      - `CHANGELOG.md`.
    - `docs/index.md` update: yes, only if a package's scope sentence changes
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 8: Combined check and product freeze
  - Acceptance Criteria:
    - Functional: On the slimmed product:
      - every offline memory suite, the safety suite (offline, with plan 208's ontology probes), the prefix probe, the growth simulation (offline) and the mechanism probes pass;
      - a paired development run (inside gate C-1's reserved budget) shows the slimmed product non-inferior (2 points) to the pre-cleanup product on every suite and on W1–W6.
      A miss reverts the removal responsible, found by bisecting the removals.
    - Functional: The product is then frozen by product hash for Task 9:
      - the readiness cache-stability pin (plan 202 Tasks 4.11–4.15) passes for that hash;
      - `docs/_evidence/memory-bench/210/freeze/record.json` lists what the hash includes: every executed plan 202 lever, plan 207, plan 208 Task 5's tuning revision, plan 209 Task 6's tuning revision, and this plan's fixes and removals.
      No product change lands between the freeze and Task 9 except through the remediation round.
    - Performance: Load and per-turn cost deltas reported (Task 7).
    - Code Quality: The freeze record is generated by the existing readiness and manifest machinery; no hand-written hash.
    - Security: Safety suite green on the frozen product.
  - Approach:
    - Documentation Reviewed:
      - Tasks 5–7;
      - plan 202 Tasks 4.11–4.15 (cache-stable product, readiness pin);
      - plan 208 Task 5 and plan 209 Task 6 (their tuning revisions).
    - Options Considered:
      - Trust the per-feature ablations without a combined check. Rejected: removals can interact.
    - Chosen Approach:
      - One combined non-inferiority check, then one freeze that every held-out arm reads.
    - API Notes and Examples:
      ```sh
      timeout 28800 bun scripts/memory-bench/campaign.mjs --plan 210 --manifest --partition dev --arm slimmed-vs-pre
      timeout 600 bun scripts/memory-bench/readiness.mjs --freeze --out docs/_evidence/memory-bench/210/freeze/record.json
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/{campaign,readiness}.mjs` (the `slimmed-vs-pre` arm and the freeze record) and tests;
      - `docs/_evidence/memory-bench/210/{final,freeze}/*`.
    - References:
      - Tasks 5–7; plan 202 Task 4.13.
  - Test Cases to Write:
    - `slimmed_product_non_inferior_report_rows`.
    - `freeze_record_lists_every_plan_revision_and_removal`.
    - `freeze_refuses_product_without_cache_stability_record`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evidence.
    - Docs pages to create/edit:
      - evidence README.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 9: Held-out acceptance of every memory claim on the final product (owner gate 3, paid)
  - Moved here on 2026-10-31 from plan 202 Task 18, plan 208 Task 6 and the held-out part of plan 209 Task 7. Their criteria are unchanged in substance.
  - Acceptance Criteria:
    - Functional: The candidate is Task 8's frozen product. The arms are:
      - **robustness (plan 202):** the candidate (`conversational` revision 2) against `preset-r1`, `full` / `full-truncated` and `lexical-topk`; the `coding` preset (plan 202 Task 11, plus the plan 202 Task 12 points that shipped) against memory-off and `conversational` on the coding suites;
      - **ontology (plan 208):** `P+O` and `coding+O`, each paired against its own `P`;
      - **work outcome (plan 209):** memory-off, `P`, `P+W` and `P+W+O` on the work-outcome suite.
    - Functional: Every arm runs on:
      - every suite's `heldout-a` partition, read here for the first time;
      - every acceptance model (≥ 3 models, ≥ 2 providers, one small);
      - the judge panel, with repeats on the 100-item subset.
      Plan 202's safety gate (Task 14, including plan 208 Task 4's ontology probes) and growth criterion (Task 15) re-run on the frozen product.
    - Functional: One manifest pins the product hash, `robustness-criteria.json`, `three-tier-criteria.json` and `work-outcome-criteria.json`, with every hash verified. Each verdict is one row per criterion, computed with no hand-set value:
      - `acceptance-report.mjs --plan 202`: `robust`, `better-than-full-context`, both, or neither, with the failing rows named;
      - `--plan 208`: O1–O8 and the outcome class;
      - `--plan 209`: the work-outcome rows, including `ontology-work` (O8).
      No verdict changes another verdict's rows.
    - Functional: A miss is reported as a miss. No post-hoc margin, partition or model swap; the manifest refuses criteria drift as 188.10's did.
    - Functional: **One remediation round** (release gating, header), under a fresh owner approval. It covers every plan's arms on `heldout-b` under the same manifest rules. There is never a second round.
    - Functional: **Cache-stable product (plan 202 Tasks 4.11–4.15).**
      - The frozen product hash includes Tasks 4.11–4.14, and the readiness cache-stability pin passes for it (Task 8).
      - The live multi-turn cache probe runs once per acceptance route under this gate, and its `cacheStability` row is reported next to the verdict.
      - The row is evidence for Task 10's cost wording only. It is never a criterion row, and BFC (iii) is computed exactly as `robustness-criteria.json` defines it.
    - Performance: Budget stated at the gate, with each plan's share of it. In-flight caps per arm; wall-time limit per suite stated and reported, with overruns recorded as deviations.
    - Code Quality: Existing campaign, journal and acceptance machinery, with the `--plan 202`, `--plan 208` and `--plan 209` profiles under one manifest.
    - Security: Keys as refs. No text in reports.
  - Approach:
    - Documentation Reviewed:
      - plan 202 Tasks 2–17 and its moved Task 18;
      - plan 208 Tasks 1–5 and its moved Task 6;
      - plan 209 Tasks 5–6 and its moved Task 7;
      - 188.10 Task 9 (manifest discipline).
    - Options Considered:
      - Accept on a subset of suites. Rejected: the definitions are the point.
      - One held-out run per plan. Rejected: it would spend held-out items several times and freeze several products.
      - Held-out acceptance before the audit (the order before 2026-10-31). Rejected by the owner: audit removals would then change an accepted product and need a second held-out read or dev-only claims.
    - Chosen Approach:
      - One frozen product, one held-out read, three criteria files.
    - API Notes and Examples:
      ```sh
      timeout 28800 bun scripts/memory-bench/campaign.mjs --plan 210 --manifest --partition heldout-a
      timeout 600 bun scripts/memory-bench/acceptance-report.mjs --plan 202
      timeout 600 bun scripts/memory-bench/acceptance-report.mjs --plan 208
      timeout 600 bun scripts/memory-bench/acceptance-report.mjs --plan 209
      ```
    - Files to Create/Edit:
      - `scripts/memory-bench/{campaign,acceptance,acceptance-report}.mjs` and tests;
      - `docs/_evidence/memory-bench/{202,208,209}/acceptance/*`.
    - References:
      - Plan 202 Task 2; plan 208 Task 1; plan 209 Task 5; Task 8.
  - Test Cases to Write:
    - `acceptance_202_refuses_criteria_or_product_drift`.
    - `verdict_rows_match_criteria_file`.
    - `small_model_rows_present`.
    - `acceptance_208_rows_match_criteria_file`.
    - `acceptance_208_refuses_product_or_criteria_drift`.
    - `outcome_class_derived_without_hand_set_values`.
    - `acceptance_209_rows_match_criteria`.
    - `one_manifest_pins_all_three_criteria_hashes_and_the_freeze_hash`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — evidence.
    - Docs pages to create/edit:
      - `docs/_evidence/memory-bench/{202,208,209}/README.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 10: Preset revision 2, defaults, published claims and the hand-off to the freeze
  - Moved here on 2026-10-31 from plan 202 Task 19, plan 208 Task 7 and the defaults part of plan 209 Task 7. Their criteria are unchanged in substance.
  - Acceptance Criteria:
    - Functional: **Preset revision (plan 202).**
      - If Task 9 passes **better-than-full-context** or **robust** (or both): `CONVERSATIONAL_PRESET_REVISION` becomes 2 and `conversational` resolves to the accepted candidate. Hosts on `preset: "conversational"` get it with **no config change**. A test asserts that a config written for revision 1 (the 188.11 README example) still validates and resolves to revision 2.
      - If it fails after the one remediation round, 0.13.0 ships the last passing revision. A lever that met its development target ships as a tuning-tier change only if Task 9 shows no regression for it. The README states the failing criteria.
      - `coding` ships in 0.13.0 if Task 9 passes its rows of robust (viii). Otherwise the owner decides here whether it ships as a documented, unaccepted opt-in or is withheld; either way the README states the failing rows.
    - Functional: **Memory default (plan 202).** Defaults change only if the safety gate **and** the robust verdict both pass. The candidate default is installing the fabric with `preset: "conversational"` on. Otherwise defaults stay off, and the failed criterion is named in `scripts/memory-bench/defaults.json` and the README.
    - Functional: **Ontology tier (plan 208).** The outcome class, together with the safety verdict, decides:
      - `beneficial` plus a passed safety gate: the reference host's coding and research agents set `ontology: true` by default. The wiki README, the fabric README `## Ontology tier` and `PRODUCT.md` state the measured benefit in the verdict's wording (models, judges, suites, cost, claim support).
      - `safe-neutral`: the tier ships opt-in. Docs say it was measured as neutral on accuracy, with its claim-support rate and cost, and no benefit is claimed.
      - `not-safe` or `harmful`: the tier ships opt-in with the failing rows named in the README's Known limitations. The reference host option stays off and is marked experimental.
      A tier that Task 6 moved to the experimental tier stays experimental whatever its class.
    - Functional: **Working-agent defaults (plan 209)**, only under the passed safety gate:
      - `rules.capture: "confirm"` joins `coding` (already there) and becomes the reference host default for both agents if W1 or W2 passes with no failing row;
      - `exchanges.steps` joins the `coding` preset as a new `presetRevision` if W1 passes;
      - `lessons.nudge` is on in the reference host only if W1 or W5 passes and W6 does not regress.
      Otherwise each stays opt-in, with the failing rows named. A feature Task 7 removed is not considered.
    - Functional: **Claims and positioning.**
      - Every README claim is a verdict's wording, with models, judges, suites, cost and latency. "Better than full context" may appear only if that row set passed.
      - The `coding` claim cites plan 209's work-outcome rows (repeated corrected mistakes, convention adherence, re-asked questions, orientation cost) beside plan 202's robust (viii) rows. "Memory improves work" appears only if `P` vs memory-off passes.
      - `PRODUCT.md`'s Memory subsection and the fabric README lead with standing rules, then search over the record, then the ontology tier.
      - Experimental-tier features are named as experimental and carry no claim.
    - Functional: `scripts/memory-bench/defaults.json` records every decision with its evidence hash. The preset revision, every default and every memory claim land in one change.
    - Functional: **Release hand-off.**
      - Plan 186's live journey scenario 11 (added by 188.11 Task 7) runs against the shipped revision, and plan 187's CHANGELOG and README claims are the ones this task writes.
      - The 188.11 limitations register (`docs/_evidence/memory-bench/188.11/limitations.json`) is closed: each entry is marked resolved with evidence, or carried into the README's Known limitations.
      - The surviving memory surface and its experimental tier are listed for plan 185's freeze. Plan 184's cache measurement runs on this product.
    - Functional: Plan end: Compromises, Further Actions and the backlog hand-off.
    - Performance: n/a.
    - Code Quality: Preset changes are object edits with a `presetRevision` bump. Reference host defaults are values in its config. No package default changes for the ontology: the tier is opt-in at package level by construction (installing `memory-wiki`). Compat baselines are regenerated with `bun scripts/release.mjs gate --update-baseline` if `CONVERSATIONAL_PRESET_REVISION`'s value or the preset table is in a baseline (`scripts/compat-baseline/arnilo__prism-memory-fabric.txt`), with the diff attributed in the note.
    - Security: A default that stores conversation content, or that adds background model calls over it, is enabled only under the passed safety gate. The READMEs state what is stored and what the curator sends to its model.
  - Approach:
    - Documentation Reviewed:
      - 188.11 Tasks 3 and 6 (preset contract, stability tiers);
      - Task 9 verdicts; plan 202 Task 14; plan 208 Task 1 outcome classes; plan 209 Task 5 criteria.
    - Options Considered:
      - Ship revision 2 as a new preset name. Rejected: that defeats the stable-API goal. The contract allows improvement within the name.
      - Turn the ontology tier on by default regardless, as the product's differentiator. Rejected: the 0.13.0 claims rule (188.11, 202) allows only measured claims, and an unmeasured default that sends conversation content to a curator model is a privacy cost too.
    - Chosen Approach:
      - The verdicts decide the revision, every default and the wording, in one change.
    - API Notes and Examples:
      ```ts
      memoryFabric({ preset: "conversational", tools: { root } }); // unchanged host line → revision 2
      await createCodingAgent({ ...config, memory: "coding" }); // ontology on only if the verdict allows
      ```
    - Files to Create/Edit:
      - `packages/memory/fabric/src/config.ts` (preset table) and tests;
      - `apps/prism-agent/src/host/config.ts` and its tests;
      - `scripts/memory-bench/defaults.json`;
      - `docs/_evidence/memory-bench/188.11/limitations.json`;
      - fabric, wiki and OM READMEs, `PRODUCT.md`, `apps/prism-agent/README.md`, `CHANGELOG.md`;
      - `scripts/compat-baseline/*` (only if affected);
      - this plan, `plans/backlog.md`.
    - References:
      - Task 9; plan 202 Tasks 11, 14; plan 208 Task 1; plan 209 Task 5.
  - Test Cases to Write:
    - `host_config_from_0130_resolves_to_revision_2`.
    - `defaults_change_only_with_safety_and_robust_verdicts`.
    - `readme_claim_matches_verdict`.
    - `ontology_default_follows_outcome_class_and_safety`.
    - `readme_ontology_claim_matches_verdict`.
    - `defaults_follow_work_outcome_verdict_and_safety`.
    - `product_memory_section_matches_verdicts`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — preset contents, reference-host defaults and published claims.
    - Docs pages to create/edit:
      - fabric, wiki and OM READMEs;
      - `PRODUCT.md`;
      - `apps/prism-agent/README.md`;
      - `CHANGELOG.md`;
      - evidence READMEs.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 1200 bun run typecheck`
- `timeout 900 bun run --cwd packages/memory/fabric test`
- `timeout 900 bun run --cwd packages/memory/observational test`
- `timeout 900 bun run --cwd packages/memory/wiki test`
- `timeout 900 bun run --cwd packages/memory/core test`
- `timeout 1800 bun scripts/memory-bench/mechanism-probes/run.mjs`
- `timeout 900 bun test --timeout=0 scripts/memory-bench`
- `timeout 3600 bun scripts/memory-bench/safety/run.mjs --suite offline --ontology`
- `timeout 600 bun scripts/memory-bench/work-outcome/run.mjs --offline`
- `timeout 900 bun run --filter @arnilo/prism-agent test`
- `timeout 600 bun test --timeout=0 src/__tests__/docs.test.ts`
- `timeout 1800 bun scripts/release.mjs gate` (baseline diffs attributed)
- `timeout 300 bun test packages/memory/fabric/src/__tests__/prefix-stability.test.ts`
- `timeout 120 bun scripts/memory-bench/prefix-probe.mjs --out docs/_evidence/memory-bench/210/freeze/prefix-probe.json`
- `timeout 3600 bun scripts/memory-bench/growth.mjs --offline`
- `timeout 900 bun examples/long-term-memory.ts`
- `timeout 300 bunx biome check <changed files>`
- Paid, in order, after their gates:
  1. Task 5 ablations (gate C-1);
  2. Task 8 combined development check (gate C-1's reserved budget);
  3. Task 9 held-out acceptance (gate 3), with one live cache probe per acceptance route, and only after a miss the one remediation round on `heldout-b` (fresh approval);
  4. `acceptance-report.mjs --plan 202`, `--plan 208` and `--plan 209`;
  5. confirm no owned paid process remains.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
