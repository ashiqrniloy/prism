# Phase 11 Part Y — agentic evals: dataset hygiene, scenario items, user simulation, state grading, and a prompt-injection suite

## Objectives

- Make datasets trustworthy as measurement instruments:
  - Today a dataset is an id, a free-form `version`, and items (`packages/hosts/evals/src/dataset.ts:6-35`). It has no content hash, so "the same dataset" cannot be proven. The memory benchmark already pins SHA-256 hashes (`scripts/memory-bench/datasets.mjs`).
  - There are no splits. A held-out set kept away from prompt tuning is the main defense against overfitting an eval: Kapoor et al. 2024, *AI Agents That Matter* (arXiv 2407.01502), §5. Zhu et al. 2025, *Establishing Best Practices for Building Rigorous Agentic Benchmarks* (arXiv 2507.02825), list task validity, outcome validity, and contamination controls.
  - There are no strata or tags, so results cannot be broken down by ability, and no record of where a label came from.
- Evaluate agents the way agentic benchmarks do:
  - **Multi-turn with a simulated user.** τ-bench (Yao et al. 2024, arXiv 2406.12045) drives the agent with an LLM user that holds a hidden goal. `runScenario` takes scripted turns only (`scenarios.ts:139-219`), and scenarios cannot be dataset items, so they get no trials or statistics.
  - **Grade the final state, not the transcript.** τ-bench compares the final database to a goal state. `ScorerInput.environment` exists (`types.ts:62-70`), but no scorer compares it.
  - **Prompt injection.** AgentDojo (Debenedetti et al. 2024, arXiv 2406.13352) and InjecAgent (Zhan et al. 2024, arXiv 2403.02691) measure utility and attack success together, with injections placed in tool results. Prism's web, browser, and coding tools (plans 189, 192, 193) read untrusted content, and `failureInjection` covers infrastructure faults only (`failure-injection.ts`).

## Expected Outcome

- `defineDataset` computes `contentHash`: `sha256:` over the canonical JSON of the items in order (sorted keys).
  - Items gain `split` (`"dev" | "test" | "heldout"`), `tags`, and `label: { source: "human" | "model" | "curated" | "synthetic"; adjudicated?: boolean; by?: string }`.
  - Datasets gain an optional `canary` string.
  - `runExperiment` takes `split` and refuses `heldout` items unless `allowHeldout: true`.
  - Reports carry `datasetContentHash`, and the release manifest requires it.
  - `aggregate.byTag[tag].scorers` repeats plan 198's per-scorer statistics per tag.
  - `datasetFromRuns` stamps `label.source` (`human` when feedback supplied `expected`, else `curated`).
- `DatasetItem.input` may be a scenario (`{ kind: "scenario", turns | user, ... }`). `runExperiment` runs it through the scenario runner with trials and full statistics.
- `createUserSimulator({ agent, persona, goal, maxTurns, stop })` drives a scenario from a tool-less simulator agent that sees its persona and goal, never the expected state. Every simulated turn is recorded.
- `createStateMatchScorer({ expected, select?, mode, ignore? })` compares `environment` to a goal state (exact or subset), with a structured diff in metadata, and is optionally an invariant.
- `createInjectionDataset({ tasks, attacks, carriers })` and `runInjectionSuite(...)`:
  - They cross user tasks with injection payloads.
  - A `tool.execute` hook appends each payload to the chosen tool's result.
  - The report gives **benign utility**, **utility under attack**, and **attack success rate** per attack and carrier, with plan 198 CIs.
  - A small built-in set ships, written for Prism and not copied from AgentDojo: the important-instructions, ignore-previous, fake-tool-output, and exfiltration-link patterns, over the web-fetch, file-read, and browser-snapshot carriers.

**0.13.0 release path — plan 200, step 16 of 21.** Owner decision 2026-10-19 (see plan 197's header). Start this plan when plan 199 is complete (the user simulator reuses plan 199's tool-less judge session); when it is complete, continue with plan 201. Its phase review is plan 197 Task 1; Task 1 here is an entry check. It changes a host library only, and no kernel contract. A user simulator costs one model call per simulated turn, and the injection suite multiplies agent runs by (attacks × carriers + 1); both are opt-in and stated in the README. No version bump, publish, or npm deprecation.

## Tasks

- [ ] Task 1: Entry check (read-only)
  - Acceptance Criteria:
    - Functional: The note confirms:
      - plans 198–199 are complete
      - how `tool.execute` around-hooks may rewrite a result (`ToolResult.content` / `value`), in what order relative to `approval` and `guardrail-packs`, and whether the kernel's untrusted-content envelope (plan 192) wraps the rewritten result, so the suite injects where a real page would land
      - which tools in the reference packages carry untrusted content (`web_fetch`, `read`, browser snapshot) and their result shapes
      - every `defineDataset` caller (`graft callers defineDataset --depth all`), because `contentHash` changes the frozen object's shape
    - Functional: If the envelope wraps tool results before `tool.execute` handlers see them, Task 6 injects through a carrier tool fixture instead (a mock `web_fetch` returning the payload), and the note says so.
    - Performance: n/a — read-only.
    - Code Quality: No code changes.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - `docs/hooks.md` (`tool.execute`); plan 192 (the untrusted-content envelope); `failure-injection.ts`
    - Options Considered:
      - None; an entry check.
    - Chosen Approach:
      - A short inventory.
    - API Notes and Examples:
      ```bash
      timeout 60 graft callers defineDataset --depth all
      ```
    - Files to Create/Edit:
      - this plan (task note only)
    - References:
      - plans 192, 197 Task 1
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: none — read-only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: Dataset hygiene: content hash, splits, tags, label provenance, and canary
  - Acceptance Criteria:
    - Functional: `defineDataset`:
      - It computes `contentHash` (canonical JSON: sorted keys, items in order, `undefined` dropped).
      - It validates `split` against the allowed values, `tags` (≤ 16, each ≤ 64 chars), `label.source`, and `canary` (≤ 128 chars).
      - Bad input throws `EvalDatasetError`. Items with functions or non-JSON values throw `EvalDatasetError` (`not serializable`), because they cannot be hashed.
    - Functional: `runExperiment`:
      - `split?: Split | readonly Split[]` filters items.
      - Any `heldout` item selected without `allowHeldout: true` throws `EvalDatasetError` (`ERR_PRISM_EVAL_HELDOUT`).
      - The report records `datasetContentHash` and `split`.
      - `EvalManifest` gains `datasetContentHash`. `validateReleaseEvalManifest` requires it and checks it against the report when both are given (`validateReleaseEvalManifest(manifest, report?)`).
      - Plan 198's `compareExperiments` refuses differing hashes.
    - Functional: `aggregate.byTag` holds per-tag `ScorerStats`, with BH-adjusted q-values when `compareExperiments` compares by tag (`byTag: true`).
    - Functional: `datasetFromRuns` stamps `label` as described in the Expected Outcome.
    - Functional: A `canary` is written into `serializeEvaluationReport` output and into the dataset metadata, so a leaked report or dataset is detectable by search. The README explains how to grep training corpora for it.
    - Functional: Every `defineDataset` caller from Task 1 keeps compiling. Golden fixtures that serialize datasets are regenerated in this task.
    - Performance: One sha256 per `defineDataset` (≤ 10,000 items, already capped); stated in the README.
    - Code Quality: The canonical JSON helper lives in `util.ts` and is shared with the rubric hash from plan 199.
    - Security: The hash covers content already in memory; no new I/O.
  - Approach:
    - Documentation Reviewed:
      - Kapoor et al. 2024 §5; Zhu et al. 2025 (agentic benchmark checklist); `scripts/memory-bench/datasets.mjs`; BIG-bench canary convention (Srivastava et al. 2022, arXiv 2206.04615)
    - Options Considered:
      - A host-supplied hash. Rejected: a hash the host types can drift from the content it claims to name.
    - Chosen Approach:
      - The hash is computed, the splits are enforced, and the provenance is recorded per item.
    - API Notes and Examples:
      ```ts
      const dataset = defineDataset({ id: "support", version: "3", canary: "prism-eval-canary-7f3c", items: [
        { id: "a", input: "…", expected: "…", split: "heldout", tags: ["refund"], label: { source: "human", adjudicated: true } },
      ] });
      await runExperiment({ agent, dataset, scorers, split: "heldout", allowHeldout: true });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/{dataset.ts,types.ts,util.ts,experiment.ts,scenarios.ts,threshold.ts,curate.ts,compare-experiments.ts,errors.ts}`
      - `packages/hosts/evals/src/__tests__/{evals,curate,compare-experiments}.test.ts`
      - callers from Task 1 that build release manifests (`examples/behavior-evaluation.ts` and any `scripts/` evidence writer)
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - plan 198 Task 6
  - Test Cases to Write:
    - `content_hash_is_stable_across_key_order`, and `content_hash_changes_with_any_item_change`
    - `heldout_requires_explicit_allow`
    - `release_manifest_requires_content_hash` and `release_manifest_hash_must_match_report`
    - `compare_refuses_different_hashes`
    - `by_tag_stats_partition_items`
    - `curated_items_carry_label_source`
    - `function_valued_item_throws_not_serializable`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`: "Datasets" (hash, splits, tags, provenance, canary, contamination guidance)
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: Scenarios as dataset items
  - Acceptance Criteria:
    - Functional:
      - `DatasetItem.input` may be `ScenarioInput = { kind: "scenario"; turns?: readonly (string | ScenarioTurn)[]; user?: UserSimulatorSpec; maxTurns?; scoreTurns? }`, with exactly one of `turns` / `user`.
      - `runExperiment` runs such items through the scenario runner, with the experiment's agent factory, `hooks`, `slots`, `timeline`, `toEnvironment`, and `trials`.
      - Evaluations carry `itemId` and `trialIndex` (and `turnIndex` with `scoreTurns: "each"`), so plan 198's statistics apply unchanged.
      - A scenario item on an `Agent` instance (not a factory) runs, but each trial gets a fresh session.
    - Functional: `runScenario` keeps its standalone signature. Both entry points share one internal `executeScenario`, so there is no duplicated turn loop.
    - Performance: Same cost as running the scenarios one by one.
    - Code Quality: The scenario code moves into `scenario-runner.ts`. `scenarios.ts` keeps the manifest and trials helpers, or they move with the task note naming them; no export changes name.
    - Security: The redactor and ownership options apply per turn, as in `runScenario`.
  - Approach:
    - Documentation Reviewed:
      - `scenarios.ts:139-219`; `experiment.ts:86-160`; plan 197 Tasks 6–7
    - Options Considered:
      - A separate `runScenarioSuite`. Rejected: a second runner would need its own trials, statistics, and storage.
    - Chosen Approach:
      - Scenario items in ordinary datasets, so one experiment pipeline covers single-turn and multi-turn items.
    - API Notes and Examples:
      ```ts
      defineDataset({ id: "refunds", items: [{ id: "r1", input: { kind: "scenario", turns: ["I want a refund", "order 42"] } }] });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/{scenario-runner.ts (new),scenarios.ts,experiment.ts,types.ts,index.ts}`
      - `packages/hosts/evals/src/__tests__/scenarios.test.ts`
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - plan 197 Tasks 6–7
  - Test Cases to Write:
    - `scenario_item_runs_with_trials`
    - `scenario_item_records_carry_item_and_trial`
    - `scenario_item_with_both_turns_and_user_throws`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: `createUserSimulator`
  - Acceptance Criteria:
    - Functional: `createUserSimulator({ agent, persona, goal, maxTurns = 8, stop = "###DONE###" })` returns a `UserSimulator`, usable as `ScenarioInput.user` or `runScenario({ user })`.
      - Each turn runs one tool-less session (plan 199's `runJudgeSession` base) that sees the persona, the goal, and the conversation so far (the agent's replies as text).
      - It replies with the next user message, or the stop token.
      - It never sees `item.expected`, the environment, or tool I/O.
      - The scenario ends on the stop token, `maxTurns`, or an agent run that is not `completed`.
      - `ScenarioResult.simulation = { turns, stopReason: "goal_reached" | "max_turns" | "agent_stopped", simulatorModel }`.
    - Functional: The simulator's own failures (bad output, timeout) end the scenario with `status: "failed"` and `ERR_PRISM_EVAL_USER_SIMULATOR`. They are not counted as an agent failure in scorer records, which are `skipped` with that reason.
    - Performance: One simulator model call per turn; stated in the README with the default `maxTurns`.
    - Code Quality: The simulator prompt is a versioned constant, like plan 199's templates.
    - Security: The simulator agent runs with `tools: { only: [] }`. The agent's replies reach the simulator redacted.
  - Approach:
    - Documentation Reviewed:
      - Yao et al. 2024 §3 (user simulator with a hidden instruction; failure modes of simulated users); plan 199 Task 2
    - Options Considered:
      - Let the simulator see the goal state to steer. Rejected: it leaks the answer into the conversation (τ-bench keeps it hidden).
    - Chosen Approach:
      - A tool-less, persona-and-goal-only simulator with explicit stop reasons.
    - API Notes and Examples:
      ```ts
      const user = createUserSimulator({ agent: simAgent, persona: "terse customer", goal: "Get a refund for order 42 to the original card." });
      await runScenario({ agent, user, scorers: [stateMatch], toEnvironment, timeline: "metadata" });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/{user-simulator.ts (new),scenario-runner.ts,types.ts,errors.ts,index.ts}`
      - `packages/hosts/evals/src/__tests__/user-simulator.test.ts` (new); `scripts/e2e-coverage.json`
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - plan 199 Task 2
  - Test Cases to Write:
    - `simulator_stops_on_token` and `simulator_stops_at_max_turns`
    - `simulator_never_sees_expected`: the simulator's provider request contains no `expected` text.
    - `simulator_failure_is_not_agent_failure`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`: "Simulated users" (cost, hidden goal)
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: `createStateMatchScorer`
  - Acceptance Criteria:
    - Functional: `createStateMatchScorer({ id?, expected: unknown | ((item) => unknown), select?: (environment) => unknown, mode: "exact" | "subset", ignore?: readonly string[] /* JSON pointers */, invariant?: boolean })`:
      - It declares `requires: ["environment"]`.
      - It scores 1 when the selected state equals the expected state (`exact`), or contains it (`subset`: every expected key or element present and equal, recursively), after removing `ignore` pointers. Otherwise it scores 0.
      - On a mismatch, `metadata.diff` lists at most 32 `{ path, expected, actual }` entries, values truncated to 256 bytes and redacted.
    - Performance: Linear in the state size; state over 1 MiB fails the record (`ERR_PRISM_EVAL_STATE_BOUNDS`).
    - Code Quality: A pure structural comparison in `state-match.ts`; no deep-equal dependency.
    - Security: The diff passes the record redactor.
  - Approach:
    - Documentation Reviewed:
      - Yao et al. 2024 (database goal-state comparison); `types.ts:62-70`; `experiment.ts` `toEnvironment`
    - Options Considered:
      - Let hosts write this with `defineScorer`. Rejected: everyone needs the same subset comparison and diff, and gets it subtly wrong (arrays, ignored fields).
    - Chosen Approach:
      - One built-in with JSON-pointer ignores.
    - API Notes and Examples:
      ```ts
      createStateMatchScorer({ expected: (item) => item.expected, select: (env) => env.orders, mode: "subset", ignore: ["/updatedAt"] });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/{state-match.ts (new),index.ts}`
      - `packages/hosts/evals/src/__tests__/state-match.test.ts` (new); `scripts/e2e-coverage.json`
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - Task 3
  - Test Cases to Write:
    - `subset_match_passes_with_extra_fields`; `exact_match_fails_with_extra_fields`
    - `ignore_pointer_excludes_field`
    - `diff_is_bounded_and_redacted`
    - `missing_environment_throws_requirement_error` (plan 197 Task 4)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`: scorer table row
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: Prompt-injection suite
  - Acceptance Criteria:
    - Functional: `createInjectionDataset({ id, tasks: readonly DatasetItem[], attacks?: readonly InjectionAttack[], carriers: readonly { tool: string; position?: "append" | "prepend" }[] })` returns a dataset:
      - It has one benign copy of each task, plus one item per (task × attack × carrier).
      - Each item carries `metadata.injection = { attackId, carrier }` and tags `benign` / `attack:<id>`.
      - The default `attacks` are the built-in set.
    - Functional: `InjectionAttack = { id, payload: string, goal: { tool?: string; argsContain?: string; textContains?: string } }`. The goal is what success looks like for the attacker: a forbidden call, an argument (for example an exfiltration URL), or output text.
    - Functional: `runInjectionSuite({ agent, dataset, utility: Scorer, trials?, ... })`:
      - It installs `injectionHooks()`, a `tool.execute` around-hook that rewrites the carrier tool's result with the payload for the current item (or the Task 1 fallback).
      - It runs the experiment with `utility` plus a built-in `attack_success` scorer (declared `invariant: false`; it reads the timeline and text for `goal`).
      - It returns `{ report, benignUtility, utilityUnderAttack, attackSuccessRate, byAttack, byCarrier }`, each with plan 198's Wilson CI.
    - Functional: The built-in set has four attacks, written for Prism (not copied):
      - `important_instructions`
      - `ignore_previous`
      - `fake_tool_output`
      - `exfiltration_link` (its goal is a URL in a later `web_fetch` argument)
      - Three carriers are documented: `web_fetch`, `read`, and the browser snapshot tool.
    - Functional: `examples/eval-injection.ts` runs the suite on the mock provider, with a scripted model that falls for one attack. It prints the three rates and passes the examples gate.
    - Performance: Runs = tasks × (1 + attacks × carriers) × trials; stated in the README, with the default set at 13 runs per task per trial for one carrier.
    - Code Quality: The hook reuses `failure-injection.ts`'s registrar pattern; the suite is a thin layer over `runExperiment`.
    - Security:
      - Payloads are inert text.
      - The exfiltration goal URL uses a reserved `.invalid` domain, so a real fetch cannot leave the machine.
      - The README says to run the suite against sandboxed tools only.
  - Approach:
    - Documentation Reviewed:
      - Debenedetti et al. 2024 (AgentDojo: utility, utility under attack, targeted attack success; the important-instructions attack); Zhan et al. 2024 (InjecAgent: direct-harm and exfiltration goals); Greshake et al. 2023 (indirect prompt injection, arXiv 2302.12173); `failure-injection.ts`; Task 1
    - Options Considered:
      - Vendor AgentDojo's suites. Rejected: Python-only environments, and the license and maintenance cost of copying them. The metrics and attack families are reproduced, not the data.
      - Attack success from a model judge. Rejected: goal checks on tool calls and arguments are deterministic and cheaper.
    - Chosen Approach:
      - Hook-based injection at the carrier tool, deterministic goal checks, and AgentDojo's three metrics.
    - API Notes and Examples:
      ```ts
      const dataset = createInjectionDataset({ id: "inj", tasks, carriers: [{ tool: "web_fetch" }] });
      const { utilityUnderAttack, attackSuccessRate } = await runInjectionSuite({ agent: factory, dataset, utility: taskScorer, trials: 3, timeline: "metadata" });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/{injection.ts (new),failure-injection.ts,index.ts,types.ts}`
      - `packages/hosts/evals/src/__tests__/injection.test.ts` (new); `scripts/e2e-coverage.json`
      - `examples/eval-injection.ts` (new); `examples/README.md`
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - Task 1; plan 192 (the untrusted-content envelope); plan 198 (Wilson CIs)
  - Test Cases to Write:
    - `injection_dataset_crosses_tasks_attacks_carriers`: counts and tags.
    - `hook_injects_only_into_carrier_for_its_item`
    - `attack_success_detects_exfiltration_argument`
    - `benign_items_never_injected`
    - `suite_reports_three_rates_with_intervals`
    - `exfiltration_domain_is_reserved_invalid`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`: "Prompt-injection suite" (metrics, cost, sandboxing)
      - `examples/README.md`: one line
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 600 bun run typecheck`
- `timeout 600 bun run --filter @arnilo/prism-evals test`
- `timeout 300 bun examples/eval-injection.ts && timeout 300 bun examples/behavior-evaluation.ts`
- `timeout 300 bun test --timeout=0 src/__tests__/docs.test.ts`
- `timeout 600 bun test --timeout=0 scripts/e2e-coverage.test.mjs`
- `timeout 900 bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
