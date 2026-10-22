# Phase 11 Part W — eval statistics: clustered errors, pass@k and pass^k, paired comparison, and confidence-aware gates

## Objectives

- Bring `@arnilo/prism-evals` reports up to the published standard for LLM evaluation statistics. Today a report has one pooled mean and one standard error, and gates compare point estimates:
  - **D4 — wrong error bars.** `sampleStandardError` pools every scored record across scorers, items, and trials as if independent (`packages/hosts/evals/src/experiment.ts:48-58,203-210`). Trials of one item are clustered, so the error is too small. Miller 2024, *Adding Error Bars to Evals* (arXiv 2411.00640), prescribes per-metric clustered standard errors, paired differences, and power analysis.
  - **D5 — meaningless headline.** `meanScore` micro-averages different scorers, weighted by record count (`experiment.ts:27`), and `minimumMean` gates on it (`threshold.ts:19-23`).
  - **Gates on noise.** `assertEvaluationThreshold` compares point estimates. A 20-item run at 0.9 passes or fails by sampling noise, and nothing compares a candidate to a baseline on the same items.
  - **No agent reliability metrics.** `trials` exists but there is no pass@k (unbiased estimator, Chen et al. 2021, arXiv 2107.03374) or pass^k (all k trials succeed; Yao et al. 2024, τ-bench, arXiv 2406.12045).
  - **Cost is invisible.** Usage and latency per item are not in the report. Kapoor et al. 2024, *AI Agents That Matter* (arXiv 2407.01502), show accuracy must be read against cost.
  - **Two implementations.** `scripts/memory-bench/stats.mjs` already has an exact McNemar test the package lacks.

## Expected Outcome

- A public `stats` module in `@arnilo/prism-evals` with known-answer-tested functions:
  - Wilson score interval
  - cluster-robust standard error
  - seeded percentile bootstrap
  - exact McNemar
  - paired sign-flip permutation test
  - Benjamini–Hochberg adjustment
  - unbiased pass@k, and pass^k
  - power / minimum detectable effect for paired proportions
- `ExperimentAggregate.scorers[id]` reports `n` (items), `records`, `mean`, `se` (clustered by item), `ci95`, `method`, `passRate`, `passAtK`, `passHatK`.
  - `macroMean` (unweighted mean of per-scorer means) replaces `meanScore`.
  - `ExperimentTrials.standardError` and `uncertaintyMethod` are removed.
- Each item result carries usage, cost, and latency per trial. `aggregate.cost` totals them, and `paretoFrontier(reports)` returns the non-dominated (quality, cost) reports.
- `compareExperiments(baseline, candidate)` pairs items by id and reports, per scorer:
  - the mean difference
  - a paired bootstrap CI
  - a p-value: exact McNemar for binary single-trial scorers, sign-flip permutation otherwise
  - a Benjamini–Hochberg q-value
  - It refuses unpaired inputs.
- Thresholds gain `minimumLowerBound` (gate on the CI lower bound) and `maximumRegression` (gate on a significant paired drop against a baseline). `powerAnalysis()` sizes datasets for a target effect.
- `scripts/memory-bench/stats.mjs` imports McNemar from the package (if plan 197 Task 1 (h) allows), leaving one implementation.

**0.13.0 release path — plan 198, step 14 of 21.** Owner decision 2026-10-19 (see plan 197's header). Start this plan when plan 197 is complete; when it is complete, continue with plan 199. Its phase review is plan 197 Task 1; Task 1 here is an entry check. It changes only a host library (`packages/hosts/evals`), its callers (`packages/hosts/devtools`, the coding and browser eval fixtures, examples), and one script. It changes no kernel contract. No version bump, publish, or npm deprecation.

Every statistic is pure TypeScript with no dependency. Known answers come from SciPy 1.14 / statsmodels 0.14 values, recorded as constants with their generating call in the test file. No Python runs in `bun run test`.

## Tasks

- [ ] Task 1: Entry check (read-only)
  - Acceptance Criteria:
    - Functional: The note confirms:
      - plan 197 is complete and its Task 1 verdict for this plan
      - the current callers of `meanScore`, `minimumMean`, `standardError`, and `uncertaintyMethod`, re-run with `graft callers` and `rg` and compared with the list in Task 3
      - the item-level shape each scorer produces after plan 197 (binary `{0,1}` or continuous `[0,1]`), which decides the default `passThreshold`
      - whether `RunResult.usage` carries `cost` for the mock provider and the four shipped providers (`Usage`, `src/contracts-core/`), and where run duration is available (`RunResult`, the timeline's `startedAt`/`finishedAt`)
    - Performance: n/a — read-only.
    - Code Quality: No code changes.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - plan 197 Task 1; `experiment.ts`, `threshold.ts`, `types.ts:195-215,327-337`
    - Options Considered:
      - None; an entry check is required after a review in another plan.
    - Chosen Approach:
      - A short inventory.
    - API Notes and Examples:
      ```bash
      timeout 60 rg -n "meanScore|minimumMean|standardError|uncertaintyMethod" src packages apps scripts examples docs
      ```
    - Files to Create/Edit:
      - this plan (task note only)
    - References:
      - plan 197 Task 1
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: none — read-only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: The `stats` module
  - Acceptance Criteria:
    - Functional: `packages/hosts/evals/src/stats.ts` exports pure functions. Each validates its input and throws `EvalError` `ERR_PRISM_EVAL_STATS` on non-finite values, empty samples, or out-of-range parameters:
      - `wilsonInterval(successes, n, confidence = 0.95)`
      - `clusteredStandardError(values, clusterIds)`: the CR1 cluster-robust standard error of the mean (Miller 2024 §3.2). It equals the i.i.d. sample standard error when every cluster has size 1.
      - `bootstrapInterval(values, { statistic, resamples = 2000, confidence = 0.95, seed, clusterIds? })`: percentile; resamples clusters when `clusterIds` is given.
      - `mcnemarExact(aOnly, bOnly)`: two-sided exact binomial, matching `scripts/memory-bench/stats.mjs:2-12` on every input.
      - `pairedPermutationTest(differences, { resamples = 10000, seed })`: two-sided sign-flip. It is exact (full enumeration) when `n ≤ 16`.
      - `benjaminiHochberg(pValues)`: returns q-values in input order.
      - `passAtK(n, c, k)`: the unbiased `1 - C(n-c, k) / C(n, k)` in its numerically stable product form (Chen et al. 2021).
      - `passHatK(n, c, k)`: `C(c, k) / C(n, k)`, the probability that k draws without replacement all succeed (τ-bench).
      - `pairedProportionPower({ discordantRate, effect, n, alpha })` and `minimumDetectableEffect({ discordantRate, n, alpha, power })`, by normal approximation to McNemar (Connor 1987).
    - Performance:
      - Bootstrap and permutation are O(resamples × n), with `resamples` hard-capped (`HARD_STATS_RESAMPLES = 100_000`).
      - A 1,000-item, 2,000-resample bootstrap finishes under 250 ms on the CI runner, asserted loosely (×4 headroom).
    - Code Quality: No dependency. The RNG is the package's `mulberry32`. Each function is documented with its formula and citation.
    - Security: n/a — pure numerics.
  - Approach:
    - Documentation Reviewed:
      - Miller 2024 (arXiv 2411.00640) §§2–4; Chen et al. 2021 §2.1; Yao et al. 2024 §3; Benjamini & Hochberg 1995; Wilson 1927; Connor 1987 (*Biometrics* 43:207); `scripts/memory-bench/stats.mjs`
      - SciPy 1.14 `scipy.stats.binomtest`, `scipy.stats.bootstrap`, `statsmodels.stats.proportion.proportion_confint(method="wilson")`, `statsmodels.stats.multitest.multipletests(method="fdr_bh")` for the known answers
    - Options Considered:
      - Depend on a statistics library (`simple-statistics`, `jstat`). Rejected: neither has cluster-robust errors or pass^k, and the host library otherwise has no runtime dependency.
      - Student-t intervals everywhere. Rejected: wrong coverage for proportions near 0 or 1, which is where release gates live.
    - Chosen Approach:
      - Small, cited, known-answer-tested functions.
    - API Notes and Examples:
      ```ts
      import { passAtK, wilsonInterval } from "@arnilo/prism-evals";
      wilsonInterval(18, 20); // { low: 0.659, high: 0.932 }
      passAtK(10, 3, 5);      // 0.9166…
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/stats.ts` (new); `packages/hosts/evals/src/{index.ts,limits.ts,errors.ts}`
      - `packages/hosts/evals/src/__tests__/stats.test.ts` (new)
      - `scripts/e2e-coverage.json`: add the new suite under `@arnilo/prism-evals`
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - the review's D4
  - Test Cases to Write:
    - `wilson_matches_statsmodels`: three known points, including 0/n and n/n.
    - `clustered_se_equals_iid_for_singleton_clusters`, and `clustered_se_exceeds_iid_for_correlated_trials`: fails if the clustering is ignored.
    - `mcnemar_matches_memory_bench`: on a 0..20 grid.
    - `pass_at_k_matches_codex_estimator`, and `pass_hat_k_is_one_only_when_all_pass`
    - `bh_matches_statsmodels`
    - `permutation_is_exact_for_small_n`
    - `power_and_mde_are_inverse`
    - `stats_reject_nan_and_empty`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new exports.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`: a "Statistics" section with each function, its formula, and when to use it
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: Per-scorer aggregate statistics, replacing `meanScore` and the pooled error
  - Acceptance Criteria:
    - Functional: `ExperimentAggregate` becomes `{ itemCount, scoredCount, skippedCount, failedCount, macroMean?, scorers: Record<scorerId, ScorerStats>, invariantsPassed? }`, with `ScorerStats = { items, records, mean, se?, ci95?, method }`. Per scorer:
      - Records are grouped by item.
      - `mean` is the mean of item means, so trials and `forEach` steps cannot outweigh items.
      - `se` is `clusteredStandardError` over records clustered by item.
      - `ci95` is a Wilson interval when every item mean is 0 or 1 and there is one record per item (`method: "wilson"`); otherwise a cluster bootstrap (`method: "cluster_bootstrap"`) seeded from `RunExperimentOptions.seed`, or a fixed default seed.
      - With fewer than 2 items, `se` and `ci95` are absent and `method` is `"single_item"`.
    - Functional: Retired with no alias, in this task:
      - `ExperimentAggregate.meanScore`, `scoresByScorer`
      - `ExperimentTrials.standardError`, `uncertaintyMethod`
      - `EvaluationThresholds.minimumMean` becomes `minimumMacroMean`
      - `minimumByScorer` reads `scorers[id].mean`.
    - Functional: Every caller is updated in the same task:
      - `packages/hosts/devtools/src/compare.ts:23,52,121-125`: `InspectorAggregateSlice.macroMean`; the quality winner uses CI overlap when both sides carry `ci95`, else the means.
      - `packages/hosts/devtools/src/__tests__/eval-compare.test.ts`
      - `packages/tools/{coding,browser}` eval fixtures
      - `examples/{evaluation-gate,coding-browser-evaluation,behavior-evaluation}.ts`
      - the evals tests
      - `templates/init/optional/evals-example.ts.tmpl`, if it reads them
    - Functional: Sweep over `src/ packages/ apps/ scripts/ examples/ docs/` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`) for `meanScore`, `scoresByScorer`, `standardError`, `uncertaintyMethod`, and `minimumMean` finds only the new names.
    - Performance: One bootstrap per scorer per report (≤ 2,000 resamples by default); stated in the README.
    - Code Quality: `aggregateEvaluations` calls `stats.ts`; no inline formulas.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - `experiment.ts:17-58,193-225`; `threshold.ts:15-44`; devtools `compare.ts`; Task 2; Miller 2024 §3
    - Options Considered:
      - Keep `meanScore` and add the new fields. Rejected: the roadmap forbids aliases, and a pooled mean next to correct per-scorer means invites gating on the wrong one.
      - Weight scorers in `macroMean`. Rejected: weights are a host decision. `minimumByScorer` already expresses per-scorer gates.
    - Chosen Approach:
      - Item is the unit of analysis. Statistics are per scorer, with an explicit macro mean.
    - API Notes and Examples:
      ```ts
      report.aggregate.scorers.citation; // { items: 40, records: 200, mean: 0.82, se: 0.05, ci95: [0.72, 0.91], method: "cluster_bootstrap" }
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/{experiment.ts,threshold.ts,types.ts,scenarios.ts}`
      - `packages/hosts/evals/src/__tests__/{evals,scenarios,trajectory,citations}.test.ts`
      - `packages/hosts/devtools/src/compare.ts`, `packages/hosts/devtools/src/__tests__/eval-compare.test.ts`, `packages/hosts/devtools/README.md`
      - `packages/tools/coding/src/agent/__tests__/eval-fixtures.test.ts`, `packages/tools/browser/src/__tests__/eval-fixtures.test.ts`
      - `examples/{evaluation-gate,coding-browser-evaluation,behavior-evaluation}.ts`, `examples/README.md:161`
      - tentative: `templates/init/optional/evals-example.ts.tmpl` (Task 1)
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/{arnilo__prism-evals,arnilo__prism-devtools}.txt` via `bun scripts/release.mjs gate --update-baseline`; the task note lists the removed rows as this plan's
    - References:
      - the review's D4, D5
  - Test Cases to Write:
    - `trials_do_not_outweigh_items_in_mean`: item A has 5 trials scoring 1, item B has 1 trial scoring 0; mean 0.5. Fails today (0.83).
    - `macro_mean_ignores_record_counts`
    - `se_is_clustered_by_item`: identical trials give the same `se` as one trial per item.
    - `binary_single_trial_uses_wilson`
    - `devtools_quality_winner_uses_ci_overlap`: overlapping intervals give `tie`.
    - `threshold_minimum_macro_mean`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — report shape and threshold names.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`: report shape, unit of analysis
      - `packages/hosts/devtools/README.md`: compare semantics
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: pass@k and pass^k
  - Acceptance Criteria:
    - Functional:
      - `Scorer` gains `passThreshold?: number` (default `1`); a record passes when `score >= passThreshold`.
      - `ScorerStats` gains `passRate` (mean of per-item pass fractions), and, when `trials > 1`, `passAtK` and `passHatK` for `k ∈ {1, …, trials}`, each averaged over items from `stats.passAtK` / `stats.passHatK` with that item's `n` and `c`.
      - Items with fewer than `k` scored trials are excluded from that `k`, and the count is reported.
      - Thresholds gain `minimumPassHatK: Record<scorerId, { k: number; minimum: number }>`.
    - Performance: O(items × trials).
    - Code Quality: In `aggregateEvaluations`, reusing Task 3's per-item grouping.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - Chen et al. 2021; Yao et al. 2024 (pass^k as the reliability metric for deployed agents); Task 2
    - Options Considered:
      - Report only pass@k. Rejected: pass@k rewards an agent that succeeds once in k tries, which is the wrong property for an agent acting on a user's behalf.
    - Chosen Approach:
      - Both, with pass^k gateable.
    - API Notes and Examples:
      ```ts
      assertEvaluationThreshold(report, { minimumPassHatK: { task_success: { k: 4, minimum: 0.8 } } });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/{experiment.ts,threshold.ts,types.ts,scorer.ts}`
      - `packages/hosts/evals/src/__tests__/evals.test.ts`
      - `examples/behavior-evaluation.ts` (prints `passHatK`)
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - Task 2
  - Test Cases to Write:
    - `pass_hat_k_drops_with_flaky_item`: one item passing 2 of 4 trials gives `passHatK[4]` 0 for it and `passAtK[4]` 1.
    - `items_with_too_few_trials_are_excluded_and_counted`
    - `minimum_pass_hat_k_gate_fails`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`: reliability metrics, with the cost note that `trials: k` multiplies agent runs by k
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: Usage, cost, and latency in the report, and the Pareto frontier
  - Acceptance Criteria:
    - Functional:
      - `ExperimentItemResult` gains `trials: { usage?: Usage; durationMs?: number; status }[]`, from `RunResult.usage` and the run's timing (Task 1).
      - `ExperimentAggregate.cost` holds the totals (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cost` when every trial reports it, else absent with `costComplete: false`), plus means per item and p50/p95 duration.
      - `paretoFrontier(reports, { quality: (r) => number, cost: (r) => number })` returns the reports that no other report beats on both axes, in cost order.
    - Performance: No extra provider calls; values come from results already in hand.
    - Code Quality: Usage arithmetic reuses the kernel's `Usage` shape. No new usage type.
    - Security: Usage carries no content.
  - Approach:
    - Documentation Reviewed:
      - Kapoor et al. 2024 §§3–4; `RunResult` and `Usage` (Task 1)
    - Options Considered:
      - A separate cost report API. Rejected: cost belongs next to the quality it bought.
    - Chosen Approach:
      - Per-trial usage in the existing report, plus one helper.
    - API Notes and Examples:
      ```ts
      paretoFrontier([a, b, c], { quality: (r) => r.aggregate.macroMean ?? 0, cost: (r) => r.aggregate.cost?.cost ?? Infinity });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/{experiment.ts,types.ts,stats.ts,index.ts}`
      - `packages/hosts/evals/src/__tests__/evals.test.ts`
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - Task 1
  - Test Cases to Write:
    - `report_totals_usage_across_trials`
    - `missing_cost_marks_cost_incomplete`: never reports a partial sum as total.
    - `pareto_excludes_dominated_report`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: `compareExperiments`: paired baseline-vs-candidate comparison
  - Acceptance Criteria:
    - Functional: `compareExperiments(baseline, candidate, { scorers?, seed?, resamples?, alpha = 0.05 })` returns `{ pairedItems, scorers: Record<id, { baselineMean, candidateMean, difference, ci95, pValue, qValue, test, significant }> }`. Per scorer:
      - Items present in both reports are paired by id; trials are averaged per item.
      - A binary scorer with one trial per item uses `mcnemarExact` on the discordant counts; anything else uses `pairedPermutationTest` on the item differences.
      - `ci95` is a paired bootstrap of the mean difference.
      - q-values are BH across the compared scorers.
    - Functional: It refuses (throws `EvalError` `ERR_PRISM_EVAL_COMPARE_UNPAIRED`) when:
      - the dataset ids differ
      - both manifests carry `datasetVersion` and they differ (and, after plan 200 Task 2, `datasetContentHash`)
      - fewer than 2 items pair
      - a requested scorer is missing on either side
    - Functional: `scripts/memory-bench/stats.mjs` imports `mcnemarExact` from `@arnilo/prism-evals` and keeps its suite-specific pairing checks, if plan 197 Task 1 (h) allowed it. Otherwise the note records why both stay, and a test asserts the two agree on a grid.
    - Performance: One bootstrap and one test per scorer.
    - Code Quality: Pure over two reports; no agent runs.
    - Security: Reports carry no content beyond what `serializeEvaluationReport` already bounds.
  - Approach:
    - Documentation Reviewed:
      - Miller 2024 §4 (paired analysis); Dietterich 1998 (McNemar for classifier comparison); `scripts/memory-bench/{stats,report}.mjs`; Task 2
    - Options Considered:
      - Two-sample (unpaired) tests. Rejected: they ignore the shared items and need many times the sample size for the same power.
    - Chosen Approach:
      - Paired tests on the shared items, with multiple-comparison control.
    - API Notes and Examples:
      ```ts
      const diff = compareExperiments(lastRelease, candidate, { seed: 1 });
      diff.scorers.task_success; // { difference: -0.06, ci95: [-0.11, -0.01], pValue: 0.02, qValue: 0.04, significant: true }
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/compare-experiments.ts` (new); `packages/hosts/evals/src/{index.ts,types.ts,errors.ts}`
      - `packages/hosts/evals/src/__tests__/compare-experiments.test.ts` (new); `scripts/e2e-coverage.json`
      - `scripts/memory-bench/{stats.mjs,run.test.mjs}` (conditional, Task 1)
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - Task 2; plan 197 Task 1 (h)
  - Test Cases to Write:
    - `identical_reports_have_zero_difference_and_p_one`
    - `planted_regression_is_significant`: 40 items, 8 flipped from pass to fail.
    - `unpaired_reports_throw`
    - `bh_controls_across_scorers`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`: "Comparing two runs"
      - `scripts/memory-bench/README.md`: one line if the import changes
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7: Confidence-aware thresholds and power analysis
  - Acceptance Criteria:
    - Functional: `EvaluationThresholds` gains:
      - `minimumLowerBound: Record<scorerId, number>`: fails when that scorer's `ci95[0]` is below the value, or `ci95` is absent (fewer than 2 items). Failing closed is deliberate.
      - `maximumRegression: { baseline: ExperimentReport; delta?: number; alpha?: number; scorers?: readonly string[] }`: runs `compareExperiments` and fails when any compared scorer's difference is significantly below `-delta` at the BH-adjusted level (default `delta: 0`, `alpha: 0.05`).
    - Functional: `powerAnalysis({ baselinePassRate, minimumDetectableDrop, alpha = 0.05, power = 0.8, expectedDiscordance? })` returns the paired item count needed, and `minimumDetectableEffect(...)` the reverse. The README table gives the counts for common release settings.
    - Functional: Failure messages name the scorer, the bound, the observed interval, and the p/q-values.
    - Performance: `maximumRegression` costs one comparison per gate call.
    - Code Quality: The point-estimate gates stay, documented as non-statistical.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - Miller 2024 §5 (power); Task 2, Task 6
    - Options Considered:
      - Make every gate statistical by default. Rejected: tiny deterministic suites (a mock-provider CI) have zero variance, and point gates are exact there.
    - Chosen Approach:
      - Opt-in statistical gates next to the exact ones, with power analysis to size them.
    - API Notes and Examples:
      ```ts
      assertEvaluationThreshold(candidate, { minimumLowerBound: { task_success: 0.7 }, maximumRegression: { baseline, delta: 0.02 } });
      powerAnalysis({ baselinePassRate: 0.85, minimumDetectableDrop: 0.05 }); // { items: … }
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/{threshold.ts,stats.ts,types.ts,index.ts}`
      - `packages/hosts/evals/src/__tests__/evals.test.ts`
      - `examples/evaluation-gate.ts`: a baseline/candidate statistical gate on the mock provider
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - Tasks 2, 3, 6
  - Test Cases to Write:
    - `lower_bound_gate_fails_on_small_noisy_suite`: mean 0.9 on 10 items fails a 0.8 lower bound.
    - `lower_bound_gate_fails_without_interval`
    - `regression_gate_fails_on_significant_drop_and_passes_on_noise`
    - `power_analysis_matches_known_table`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`: "Gating a release" (which gate to use when, plus the power table)
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 600 bun run typecheck`
- `timeout 600 bun run --filter @arnilo/prism-evals test`
- `timeout 600 bun run --filter @arnilo/prism-devtools test`
- `timeout 600 bun run --filter @arnilo/prism-tools-coding test && timeout 600 bun run --filter @arnilo/prism-tools-browser test`
- `timeout 300 bun test --timeout=0 scripts/memory-bench/run.test.mjs`
- `timeout 300 bun examples/evaluation-gate.ts && timeout 300 bun examples/behavior-evaluation.ts && timeout 300 bun examples/coding-browser-evaluation.ts`
- `timeout 300 bun test --timeout=0 src/__tests__/docs.test.ts`
- `timeout 600 bun test --timeout=0 scripts/e2e-coverage.test.mjs`
- `timeout 900 bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
