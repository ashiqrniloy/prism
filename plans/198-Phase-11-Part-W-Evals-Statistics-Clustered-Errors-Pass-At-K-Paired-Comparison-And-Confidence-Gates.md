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

- [x] Task 1: Entry check (read-only)
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
  - Notes (executed 2026-10-26):
    - **Entry verdict: proceed, with the Task 5 qualifications below.** Plan 197 Tasks 1–9 are checked and have execution evidence; its Task 1 verdict (`plans/197-Phase-11-Part-V-Evals-Correctness-Approval-Correlation-Fail-Closed-Scoring-And-Runner-Defects.md:124-126`) approves this plan. Review item (h), at `:114`, permits importing McNemar from `@arnilo/prism-evals` in the memory benchmark: the Python tooling alone is isolated, and the JavaScript harness already imports workspace packages. Plan 197 records unrelated whole-plan gate failures in its Compromises Made section; completed tasks do not imply a green release gate. Its `plans/README.md` status still says `planned`; this entry check leaves that separate index discrepancy untouched.
    - **Caller inventory re-run.** `graft callers` on `meanScore`, `minimumMean`, `standardError`, and `uncertaintyMethod` reports no symbol: these are interface/object fields, not indexed callable symbols. Calls on their owning functions resolve: `aggregateEvaluations` → `runExperiment`; `resolveTrialsConfig` → `runExperiment` and `scenarios.test.ts`; `assertEvaluationThreshold` → the two gate examples, evals/citations/trajectory tests, and coding/browser eval fixtures. An exhaustive `rg -n 'meanScore|minimumMean|standardError|uncertaintyMethod|scoresByScorer' src packages apps scripts examples docs templates` (excluding `dist/`, `docs/history/`, and `docs/_evidence/`) confirms Task 3's code caller list:
      - Producers/contracts: `packages/hosts/evals/src/experiment.ts:18-49,217-225`, `types.ts:226-243,360-369`, `scenarios.ts:261-274`, `threshold.ts:19-31`.
      - Devtools: `packages/hosts/devtools/src/compare.ts:23,52,121-125` and `src/__tests__/eval-compare.test.ts:84,88,112,117,362`.
      - Evals tests: `src/__tests__/{evals,trajectory,scenarios,citations}.test.ts`; coding/browser `eval-fixtures.test.ts:117-118,354` / `:68-69,359`.
      - Examples: `examples/evaluation-gate.ts:14-15`, `coding-browser-evaluation.ts:152,183-191`, `behavior-evaluation.ts:125,281`. No matches in `templates/init/optional/evals-example.ts.tmpl`, kernel runtime, or reference-host code.
      - Additional sweep findings: `packages/hosts/evals/README.md:79,123` needs its already-planned rewrite. `scripts/compat-baseline/arnilo__prism-{evals,core}.txt` both mention `standardError` in `resolveTrialsConfig`; Task 3 must inspect both regenerated files and attribute removals, rather than assuming only the evals/devtools baselines change. `docs/migrate-to-0.7.md:255` explicitly documents the historical, unsupported `uncertaintyMethod: "bootstrap"`; it is not a live caller and must be classified as a historical documentation exception in the retirement sweep, not silently mistaken for an active API.
    - **Scorer shapes after 197.** All seven trajectory factories (`packages/hosts/evals/src/trajectory.ts:51-623`: tool-call match, step budget, no-loop, schema, error class, guardrail pack, approval-before-effect), citation integrity (`citations.ts:17-45`), and every ERP invariant (`erp-invariants.ts:138-163`) produce binary `{0,1}` scores. Missing required evidence is rejected before execution; direct trajectory calls without evidence return zero. Custom `defineScorer` callbacks and `createModelJudge` can produce continuous `[0,1]` values (`scorer.ts:5-17`, `judge.ts:26-101`, `util.ts:45-46` validates the unit interval). Pairwise scorers return `left | right | tie`, not numeric item scores. Task 4's default `passThreshold: 1` therefore fits the binary checks and requires a full pass from a continuous scorer unless its author explicitly lowers the threshold; infer binary statistics from observed per-item records, not factory names. Failed/skipped records are not numeric successes.
    - **Usage and provider cost.** `RunResult.usage` is the optional aggregate across provider turns (`src/contracts-run-state.ts:250-285`). The existing `Usage` includes optional token counts, `cost`, `currency`, and `estimated` (`src/contracts-core/content.ts:233-257`). For the four providers named when this plan was drafted:
      - Hyper can attach reported USD cost through `withHyperCost` (`packages/providers/hyper/src/provider.ts:42-74`); it remains absent when the wire omits monetization.
      - OpenCode Go uses the shared chat/Anthropic codecs, whose usage mappers return token counts without cost (`packages/providers/opencode-go/src/provider.ts:29-48,60-76`, `src/provider-kit/openai-primitives.ts:75-87`, `codecs/anthropic-messages.ts:430-439`).
      - TypeSafe and Laya use `createSystemOneDecisionProvider`; `mapSystemOneUsage` returns input tokens and zero output tokens, without cost (`packages/providers/{typesafe,laya}/src/provider.ts:20-33`, `src/provider-kit/systemone.ts:231-237`).
      - Mock forwards scripted provider events verbatim (`src/mock-provider.ts:8-20`, `src/testing/mock-provider-package.ts:20-38`); cost exists only if scripted usage supplies it or a host catalog prices reported tokens. The default done-only script has no reported usage; the kernel may estimate tokens, never billing.
      - The four-provider wording is stale: this checkout also contains Liquid (the same System One usage path), OpenRouter (optional reported USD cost, `packages/providers/openrouter/src/provider.ts:40-55`), and OpenAI Codex. Task 5 must stay provider-independent; no provider allowlist is needed.
    - **Task 5 implementation constraints.** `recordProviderUsage` optionally prices reported usage via the host `costCatalog`; absent/failed quotes leave cost absent, and estimated usage is never priced (`src/agent-session/session/provider-round.ts:99-136`). Consequently, require non-estimated, present costs and compatible currencies before publishing a total. Also, `createUsageAccumulator` (`src/agent-session/helpers.ts:156-201`) can sum a priced turn while another reported turn lacks cost; `RunResult.usage.cost` alone does not prove complete billing. Task 5 must preserve per-turn completeness evidence from the session events or conservatively report `costComplete: false` when completeness cannot be established, with a mixed priced/unpriced-turn regression test; do not change the kernel in this plan.
    - **Duration and trial retention.** `RunResult` has no start/end/duration field. Optional timeline timestamps and step durations exist (`packages/hosts/evals/src/types.ts:15-48`, `packages/integrations/observability/src/timeline.ts:277-307`), but experiments project them only when timeline is enabled. Measure elapsed time around each `session.run` inside `runTrial` (`experiment.ts:122-136`), including thrown/aborted runs, independently of scoring and timeline drain. Capture usage/duration/status before the item loop overwrites `result` with the last trial (`experiment.ts:178-189`); the existing item result cannot recover earlier trials later.
    - **Scope and verification.** Only this task checkbox and execution note changed; no runtime code, tests, public exports, or compatibility baselines were edited. No new tests are required for this read-only inventory. `timeout 600s bun run typecheck` passed (core build, workspace typechecks, and examples); the plan's `git diff --check` passed. Runtime suites and the whole-plan release gate were not rerun for this documentation-only task. Later tasks remain unchecked.

- [x] Task 2: The `stats` module
  - Acceptance Criteria:
    - Functional: `packages/hosts/evals/src/stats.ts` exports pure functions. Each validates its input and throws `EvalError` `ERR_PRISM_EVAL_STATS` on non-finite values, empty samples, or out-of-range parameters:
      - `wilsonInterval(successes, n, confidence = 0.95)`
      - `clusteredStandardError(values, clusterIds)`: the CR1 cluster-robust standard error of the mean (Miller 2024 §2.2 and Appendix A). It equals the i.i.d. sample standard error when every cluster has size 1.
      - `bootstrapInterval(values, { statistic, resamples = 2000, confidence = 0.95, seed, clusterIds? })`: percentile; resamples clusters when `clusterIds` is given.
      - `mcnemarExact(aOnly, bOnly)`: two-sided exact binomial, matching `scripts/memory-bench/stats.mjs:2-12` on every input.
      - `pairedPermutationTest(differences, { resamples = 10000, seed })`: two-sided sign-flip. It is exact (full enumeration) when `n ≤ 16`.
      - `benjaminiHochberg(pValues)`: returns q-values in input order.
      - `passAtK(n, c, k)`: the unbiased `1 - C(n-c, k) / C(n, k)` in its numerically stable product form (Chen et al. 2021).
      - `passHatK(n, c, k)`: `C(c, k) / C(n, k)`, the probability that k draws without replacement all succeed (τ-bench).
      - `pairedProportionPower({ discordantRate, effect, n, alpha })` and `minimumDetectableEffect({ discordantRate, n, alpha, power })`, by normal approximation to McNemar (Connor 1987).
    - Performance:
      - Bootstrap is O(resamples × n) in expectation for a linear-time statistic, plus O(resamples × log(resamples)) for percentile sorting; unequal whole-cluster draws can have different lengths. Monte Carlo permutation is O(resamples × n); exact permutation for n ≤ 16 is O(2^n × n). `resamples` is hard-capped (`HARD_STATS_RESAMPLES = 100_000`).
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
      wilsonInterval(18, 20); // { low: 0.699…, high: 0.972… }
      passAtK(10, 3, 5);      // 0.9166…
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/stats.ts` (new); `packages/hosts/evals/src/{index.ts,limits.ts}`; reuse `EvalError` from unchanged `errors.ts`
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

  - Notes (executed 2026-10-26):
    - **Implemented all ten statistics functions** in `packages/hosts/evals/src/stats.ts`, exported from the package root, with formulas/citations, existing `mulberry32`, and no new dependency. Reused `EvalError` directly (`ERR_PRISM_EVAL_STATS`), so `errors.ts` did not need an edit. Added/exported `HARD_STATS_RESAMPLES = 100_000`; both resampling APIs reject invalid/excessive counts rather than silently clamping. Intervals return `{ low, high }`; seeds are required safe integers. CR1 requires two distinct clusters; bootstrap permits one. Counts are safe integers; power requires positive discordance, a feasible absolute effect, and an attainable target for inversion. The inverse handles the normal approximation's interior power maximum at very small n, with a SciPy root-finding regression case.
    - **Tests written first:** the new suite initially failed on the missing public exports, then passed all 11 tests. It covers Wilson endpoints and 99% confidence; singleton, correlated, and unequal clusters; reproducible percentile bootstrap, arbitrary statistics, and whole-cluster draws; McNemar on the 0..20 benchmark grid; combinatorial pass@k/pass^k on all small n/c/k; BH ties/input order; exact sign flips through n=16 and Monte Carlo correction beyond it; power/MDE inversion; NaN/infinity, sparse/empty samples, callback failure, invalid ids/parameters, and the resampling ceiling. The 1,000-item/2,000-resample bootstrap measured about 62 ms in the focused run (1,000 ms assertion). Reference constants and generating calls are recorded in the tests; independently rechecked with SciPy 1.18.1 and statsmodels 0.15.0 in a temporary environment because local Python 3.14 cannot use the plan's older pinned wheels. Python is not involved in Bun tests or added to the repository dependencies.
    - **Documentation and later-task findings:** added the README Statistics section with every formula, assumptions, defaults, bounds, runtime, and citation; added the changelog entry and coverage registration. Corrected the plan's Wilson example and Miller subsection reference. Clarified the performance criterion to account for percentile sorting, expected cluster-resample size, and exact enumeration. Task 3/6 must convert `{ low, high }` to the reports' planned CI tuples. Task 6 still owns replacing the benchmark's McNemar; the current independent grid test intentionally imports that JavaScript implementation. No API was retired, so no retirement sweep applies; Tasks 3–7 remain unchecked.
    - **Verification passed:** `timeout 600s bun run typecheck` (core build, all workspace typechecks, examples); `timeout 600s bun run --filter @arnilo/prism-evals test` (113/113 across 9 suites); `timeout 600s bun test --timeout=0 scripts/e2e-coverage.test.mjs` (8/8); task-file `git diff --check`.
    - **Broader checks remain red outside this task:** `bun scripts/release.mjs gate --package @arnilo/prism-evals --update-baseline` regenerated the evals baseline, then failed on the existing optional observability peer range, missing OpenAI Codex/OpenRouter lockfile entries, and kernel packed/unpacked size ceilings (+235/+511 bytes). The docs/coverage combined run had 69 passes and three docs failures: unindexed `docs/next/hooks.md`, `docs/next` still present, and `examples/custom-builders.ts` timing out after 60 seconds. Repository-wide `git diff --check` also reports a pre-existing trailing blank line in `src/contracts-core/resources.ts:69`. These files were not changed for this task; whole-plan verification and release readiness are not claimed.
    - **Compatibility baseline diff:** regenerated only the evals baseline for this task. Relative to its pre-task contents, 13 rows were added and none removed or changed: 11 statistics rows below, plus `loadTimeline` and `setTimelineImporterForTests` from the already-present `timeline.ts` optional-peer work. The prior `checkRequirements`, `hash32`, and `mapPool` changes remain intact. The pre-existing root baseline changes remain intact; no other baseline changes are retained.
      ```diff
      +HARD_STATS_RESAMPLES export declare const HARD_STATS_RESAMPLES = 100000
      +benjaminiHochberg export declare function benjaminiHochberg(pValues: readonly number[]): number[]
      +bootstrapInterval export declare function bootstrapInterval(values: readonly number[], options:
      +clusteredStandardError export declare function clusteredStandardError(values: readonly number[], clusterIds: readonly ClusterId[]): number
      +loadTimeline export declare function loadTimeline(): Promise<TimelineTools>
      +mcnemarExact export declare function mcnemarExact(aOnly: number, bOnly: number): number
      +minimumDetectableEffect export declare function minimumDetectableEffect(options:
      +pairedPermutationTest export declare function pairedPermutationTest(differences: readonly number[], options:
      +pairedProportionPower export declare function pairedProportionPower(options:
      +passAtK export declare function passAtK(n: number, c: number, k: number): number
      +passHatK export declare function passHatK(n: number, c: number, k: number): number
      +setTimelineImporterForTests export declare function setTimelineImporterForTests(next?: () => Promise<Observability>): void
      +wilsonInterval export declare function wilsonInterval(successes: number, n: number, confidence?: number): Interval
      ```

- [x] Task 3: Per-scorer aggregate statistics, replacing `meanScore` and the pooled error
  - Acceptance Criteria:
    - Functional: `ExperimentAggregate` becomes `{ itemCount, scoredCount, skippedCount, failedCount, macroMean?, scorers: Record<scorerId, ScorerStats>, invariantsPassed? }`, with `ScorerStats = { items, records, mean, se?, ci95?, method }`. Per scorer:
      - Records are grouped by item.
      - `mean` is the mean of item means, so trials and `forEach` steps cannot outweigh items.
      - `se` is `clusteredStandardError` over records clustered by item. With unequal counts this is the record-weighted CR1 estimand; the reported mean and bootstrap interval stay item-weighted, documented explicitly in the README.
      - `ci95` is a Wilson interval when every item mean is 0 or 1 and there is one record per item (`method: "wilson"`); otherwise a cluster bootstrap of item means (equal item weights, `method: "cluster_bootstrap"`) seeded from `RunExperimentOptions.seed`, or fixed default seed `0`. Intervals use Task 2's `{ low, high }` shape.
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
      report.aggregate.scorers.citation; // { items: 40, records: 200, mean: 0.82, se: 0.05, ci95: { low: 0.72, high: 0.91 }, method: "cluster_bootstrap" }
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


  - Notes (executed 2026-10-26):
    - **Implemented per-scorer aggregation and retired the pooled API without aliases.** Added/exported `ScorerStats` (`items`, `records`, item-weighted `mean`, optional `se` and `{ low, high }` `ci95`, and `method`). Grouping uses maps by scorer/item, excluding failed/skipped records while preserving their counts and invariant behavior. Macro quality is the unweighted mean of scorer means. Trials now carry only count/seed/sampleCount. `minimumMacroMean` replaces `minimumMean`; `minimumByScorer` reads the new scorer mean. Updated every active caller, coding/browser fixtures, examples, package READMEs, examples index, and changelog; the init template needed no change.
    - **Statistical details clarified in the acceptance text.** Binary single-record items use Wilson; other multi-item scorers bootstrap item means once, with 2,000 resamples and seed/default `0`. This is whole-item resampling with equal item weights, including unequal trial/step counts. CR1 runs over raw records clustered by item exactly as specified; its record-weighted estimand differs from the item-weighted mean for unequal counts, now stated explicitly in the README. A single item omits both uncertainty fields. Task 2 intervals are objects, so corrected this task's array-shaped example; later tasks must likewise use `{ low, high }` when consuming these intervals.
    - **Devtools uses the same scorer intervals.** For matching scorer sets with complete intervals, every scorer must support the macro winner's direction without overlap; touching/overlapping intervals or conflicting directions give `tie`. Missing intervals fall back to means. The parser validates scorer means and ordered finite unit-interval bounds; invariant blocking remains first.
    - **Tests written first:** four new eval tests failed against the pooled implementation, then passed. They cover unequal scored trial counts (five successes vs one failure gives mean 0.5), macro weighting independent of record counts, repeated-trial CR1 equality, reproducible bootstrap, Wilson selection, single-item/empty samples, and macro gates. Added a devtools test covering overlap, both winner directions, parsed intervals, missing-interval fallback, and invalid bounds. Evals: **117 passed**; devtools: **39 passed**; coding/browser fixture suites: **4 passed**. `bun run typecheck` passed; all three gate/behavior/coding-browser examples passed. Task-scoped `git diff --check` passed.
    - **Compatibility evidence and removals.** Ran the required `timeout 900s bun scripts/release.mjs gate --update-baseline`; it timed out without a final report. Then regenerated evals/devtools individually via `gate --update-baseline --package <name> --skip-tarball`. Both reached existing range/lock validation failures: the observability optional-peer range and missing OpenAI Codex/OpenRouter lock entries. The evals baseline gains `ScorerStats` and changes `resolveTrialsConfig` from `Omit<ExperimentTrials, "sampleCount" | "standardError">` to `Omit<ExperimentTrials, "sampleCount">`; devtools has no serialized row delta because the baseline records interface names rather than members. Other eval baseline additions were already present from Task 2/plan 197, not introduced here. Removed report/threshold fields are interface members and have no individual baseline rows. Restored unrelated baseline churn from the whole-workspace regeneration; preserved pre-existing kernel/evals baseline changes.
    - **Retirement sweep:** no live runtime, test, fixture, example, or template uses remain for `meanScore`, `scoresByScorer`, `standardError`, `uncertaintyMethod`, or `minimumMean`. Two explicit historical exceptions remain unchanged: `docs/migrate-to-0.7.md:255` describes an unsupported former docs example, and the retired `arnilo__prism-core.txt` baseline retains the historical `resolveTrialsConfig` signature (no current package exists to regenerate it). Current evals baseline is clean. The broad docs suite finished with 61 passes and three failures: existing `docs index contains exactly one navigation link per documentation page` and `docs_next_is_promoted` failures, plus `examples_demos_run_to_completion_and_emit_no_secret` hitting its 60-second test timeout; repository-wide diff whitespace check flags pre-existing `src/contracts-core/resources.ts:69`. These do not affect the passing task checks. Tasks 4–7 remain unchecked; no whole-plan completion claimed.

- [x] Task 4: pass@k and pass^k
  - Acceptance Criteria:
    - Functional:
      - `Scorer` gains `passThreshold?: number` (default `1`); a record passes when `score >= passThreshold`.
      - `ScorerStats` gains `passRate` (mean of per-item pass fractions), and, when `trials > 1`, `passAtK` and `passHatK` for `k ∈ {1, …, trials}`, each averaged over items using that item's `n` and `c`. Seed with `stats.passAtK` / `stats.passHatK` at k=1, then extend by the equivalent one-draw recurrences to compute all k in linear time.
      - Items with fewer than `k` scored trials are excluded from that `k`. `passKCounts[k]` reports `{ items, excludedItems }` against the full dataset, including items with no scored trials. Omit an estimate when no items qualify; omit a scorer entirely when it has no scored records. Single-trial reports have only `passRate`.
      - Thresholds gain `minimumPassHatK: Record<scorerId, { k: number; minimum: number }>`.
    - Performance: O(items × trials) additional work for reliability summaries; existing confidence-interval computation is unchanged.
    - Code Quality: In `aggregateEvaluations`, reusing Task 3's per-item grouping.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - Chen et al. 2021; Yao et al. 2024 (pass^k as the reliability metric for deployed agents); Task 2
    - Options Considered:
      - Report only pass@k. Rejected: pass@k rewards an agent that succeeds once in k tries, which is the wrong property for an agent acting on a user's behalf.
    - Chosen Approach:
      - Both, with pass^k gateable. Validate pass thresholds in `defineScorer` and before experiment agent construction for structural scorer objects. Seed the estimators at k=1, then use `at(k) = at(k−1) + (1−at(k−1)) × c/(n−k+1)` (saturating at 1 when n−c < k) and `hat(k) = hat(k−1) × (c−k+1)/(n−k+1)` (zero when c < k).
    - API Notes and Examples:
      ```ts
      assertEvaluationThreshold(report, { minimumPassHatK: { task_success: { k: 4, minimum: 0.8 } } });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/{experiment.ts,threshold.ts,types.ts,scorer.ts}`
      - `packages/hosts/evals/src/__tests__/{evals,trajectory}.test.ts`
      - `packages/tools/{coding/src/agent,browser/src}/__tests__/eval-fixtures.test.ts`: add required `passRate` to hand-built reports
      - `examples/behavior-evaluation.ts` (prints `passHatK`); `examples/coding-browser-evaluation.ts` (hand-built report)
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - Task 2
  - Test Cases to Write:
    - `pass_hat_k_drops_with_flaky_item`: one item passing 2 of 4 trials gives `passHatK[4]` 0 for it and `passAtK[4]` 1.
    - `items_with_too_few_trials_are_excluded_and_counted`
    - `minimum_pass_hat_k_gate_fails`: reject missing scorer/k, no eligible items, skipped-only evidence, single-trial reports, and invalid gate parameters; accept equality at the minimum.
    - `pass_threshold_defaults_to_one_and_accepts_boundary_scores`: inclusive custom/zero thresholds, invalid declarations rejected before agent construction.
    - Compare all estimates with the exported pure estimators for n=2..6 and every c/k; preserve metrics through report serialization.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`: reliability metrics, with the cost note that `trials: k` multiplies agent runs by k
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-26):
    - **Implemented reliability reporting and gates.** `Scorer` and `DefineScorerInput` accept optional finite unit-interval `passThreshold` (default 1); `defineScorer` retains it, and experiments validate structural scorer objects before building an agent. Reused the existing scorer/item grouping for item-weighted `passRate`, `passAtK`, `passHatK`, and per-k `passKCounts`. Counts include dataset items with no scored records. Zero-eligible k values have counts but no estimates; all-unscored scorers remain absent. `minimumPassHatK` validates its parameters and fails on unavailable evidence. Existing exact-score invariant semantics remain unchanged.
    - **Linear reliability work.** Calling the product estimators independently for every k would be quadratic in trials. Seeded with the existing pure estimators at k=1 and extended with the same without-replacement probabilities, adding O(items × trials) work. The tests compare both curves against the pure functions for every n/c/k with n=2..6, including all-pass/all-fail endpoints. No new dependency, helper export, or kernel change.
    - **Tests written first:** four new tests initially failed for missing metrics and the missing gate, then passed. Coverage includes a 2/4 flaky item, unequal trial counts and equal item weights, wholly unscored items, zero-eligible k, inclusive custom thresholds, invalid declarations before agent construction, missing/single-trial/skipped gate evidence, invalid k/minimum, and JSON serialization. Updated required `passRate` in trajectory and coding/browser fixtures and the coding/browser example; the full typecheck found these hand-built callers. Updated the package README (including exclusions, selection bias, and trials' run/cost multiplier), root changelog, and behavior example output.
    - **Verification:** `timeout 600s bun run typecheck` passed (core build, all workspaces, examples); evals **121 passed**, devtools **39 passed**, coding/browser fixture suites **4 passed** with `--timeout=0`. Both affected examples completed successfully. Task-scoped `git diff --check` passed. Parallel validation initially hit the existing bootstrap timing assertion and a default five-second test timeout under typecheck load; the final evals run after typechecking passed without relaxing assertions.
    - **Compatibility:** ran `timeout 900s bun scripts/release.mjs gate --update-baseline --package @arnilo/prism-evals --skip-tarball`. It regenerated the package baseline and exited 1 on the previously recorded observability peer-range check and missing OpenAI Codex/OpenRouter lock entries. Task 4 changes interface members only, so it introduces no serialized baseline-row delta or removals; preserved the existing baseline changes from earlier tasks. No names or errors were retired. The whole-workspace release gate and whole-plan verification were not rerun for this single task; Tasks 5–7 remain unchecked.

- [x] Task 5: Usage, cost, and latency in the report, and the Pareto frontier
  - Acceptance Criteria:
    - Functional:
      - `ExperimentItemResult` gains `trials: { usage?: Usage; durationMs?: number; status; costComplete: boolean }[]`, from `RunResult.usage` and the run's timing (Task 1).
      - `ExperimentAggregate.cost` holds the totals (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cost` when every trial reports it, else absent with `costComplete: false`), plus `meanPerItem` (totals divided by dataset item count) and `durationMs: { p50, p95 }` (nearest-rank trial duration percentiles). Generated reports always carry `aggregate.cost`; the type leaves it optional for externally constructed score-only reports. Costs require complete, non-estimated per-attempt evidence through a terminal run event and compatible currencies, per Task 1.
      - `paretoFrontier(reports, { quality: (r) => number, cost: (r) => number })` returns the non-dominated reports, maximizing quality and minimizing cost, in cost order. Dominance requires at least as good on both axes and strictly better on one; retain identical points. Reject non-finite quality and invalid costs with `ERR_PRISM_EVAL_STATS`, accepting positive `Infinity` as unknown billing.
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
      - `packages/hosts/evals/src/{experiment.ts,types.ts,stats.ts,index.ts,scenarios.ts}`: preserve each trial and observe pricing evidence through the shared collector
      - `packages/hosts/evals/src/__tests__/evals.test.ts`: accounting, timing, frontier, and narrow bootstrap reproducibility to scorer statistics
      - `packages/hosts/devtools/src/__tests__/eval-compare.test.ts`: give the counting session its missing `subscribe` method
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - Task 1
  - Test Cases to Write:
    - `report_totals_usage_across_trials`
    - `missing_cost_marks_cost_incomplete`: never reports a partial sum as total; include estimates, invalid costs, missing/truncated evidence, mixed currencies, and zero-cost runs.
    - `retains_failed_and_aborted_trials_without_timeline`: include thrown and unstarted trials.
    - `collects_real_provider_usage_without_timeline`, and `real_multi_turn_partial_cost_is_not_a_total`: prove normal provider accounting and the mixed priced/unpriced-turn constraint.
    - `pareto_excludes_dominated_report_and_preserves_ties`: include same-axis ties, identical points, unknown billing, validation, empty input, and input preservation.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-26):
    - **Implemented per-trial accounting without kernel changes or extra provider calls.** Each item retains all trials' `RunResult.usage`, status, monotonic `session.run` duration, and `costComplete`; the existing last-available `result` remains. Thrown/aborted runs retain timings; unstarted trials have no usage/duration and cannot imply free work. The shared collector accepts an optional event observer, so experiments track provider-attempt and terminal-run evidence even with timeline disabled. Timeline/scoring behavior otherwise stays the same.
    - **Billing fails closed on incomplete evidence.** `aggregate.cost` sums available token counts (including total/cache-write counts) and propagates estimates. It publishes cost/currency and their per-item means only if all trials and observed attempts have finite nonnegative reported costs, matching currencies, balanced turn starts/completions, and a terminal event for the result's run. Missing currencies match only other missing currencies. Missing, estimated, invalid, mixed-currency, truncated, or unstarted evidence leaves cost absent and `costComplete: false`. Raw per-trial usage remains available with its completeness flag. `meanPerItem` divides by dataset item count; duration percentiles use nearest rank over measured trials and exclude setup, input conversion, scoring, and stream drain. Documented partial observed token totals and the exclusion of judge/setup billing in the README.
    - **Added/exported `paretoFrontier`.** One callback evaluation per axis/report, an O(n log n) sort and linear scan; maximize quality, minimize cost, retain equal points in input order, and preserve original report objects/input order. Validates axes with the existing statistics error; accepts positive Infinity for unknown billing as the planned example requires. No new dependency or usage type. Updated README and root changelog.
    - **Tests written first and callers updated.** The first focused run failed on the absent public export. Six new tests now cover multi-item/multi-trial totals, item means, nearest-rank latency, JSON serialization, zero and missing/invalid costs, estimates, currency mismatches, absent/truncated evidence, thrown/failed/aborted/unstarted runs, actual mock-provider usage with timeline off, and frontier dominance/ties/validation/input preservation. A real two-turn tool run proves the kernel can expose a partial `.5` cost after an unpriced second turn while the report correctly omits a billing total. Narrowed the existing bootstrap reproducibility assertion to scorer statistics because wall-clock duration is intentionally variable. Added the counting devtools session's missing `subscribe` method and assertions for retained trials/incomplete billing; its previous structural cast hid the missing public API method. Updated this task's file list and criteria to match these details. No retired names/errors or fixtures/config/coverage registrations needed changes.
    - **Verification passed:** `timeout 600s bun run typecheck` (core build, workspaces, examples); final evals package typecheck; evals **127 passed** via `timeout 600s bun test --timeout=0 packages/hosts/evals/src`; devtools **39 passed** via its package test command; coding/browser eval fixture suites **4 passed**. Final focused evals/devtools comparison suites also passed **50 tests**. The package's parallel evals command passed 126 tests before the final real multi-turn test was added; a later parallel run passed all 126 functional tests but hit the unchanged bootstrap timing assertion under machine load. The final complete serial run passed all 127, including bootstrap at about 116 ms against its unchanged 1,000 ms limit. Task-scoped `git diff --check` passed.
    - **Compatibility:** `timeout 900s bun scripts/release.mjs gate --update-baseline --package @arnilo/prism-evals --skip-tarball` regenerated the baseline, then exited 1 on the previously recorded observability optional-peer range check and missing `packages/providers/{openai-codex,openrouter}` lock entries. Incremental baseline delta: added `paretoFrontier<T>(reports: readonly T[], axes: …)`; changed `collectWhileRunning<T>(…, work: () => Promise<T>)` to add optional `onEvent?: (event: AgentEvent) => void`. There are no export removals; report additions are interface members without separate serialized rows. Preserved earlier tasks' baseline changes. Whole-workspace release and whole-plan verification/live-provider runs were not repeated for this task; Tasks 6–7 remain unchecked.

- [x] Task 6: `compareExperiments`: paired baseline-vs-candidate comparison
  - Acceptance Criteria:
    - Functional: `compareExperiments(baseline, candidate, { scorers?, seed?, resamples?, alpha = 0.05 })` returns `{ pairedItems, scorers: Record<id, { baselineMean, candidateMean, difference, ci95, pValue, qValue, test, significant }> }`. Per scorer:
      - Items present in both reports are paired by unique id; scored observations are averaged per item. Every compared scorer must have a finite [0,1] scored observation on every paired item. Failed/skipped records are excluded; absent paired scores fail closed. Default scorers are the union of observed ids; an explicit list must be nonempty and distinct.
      - A binary scorer with one trial per item uses `mcnemarExact` on the discordant counts; anything else uses `pairedPermutationTest` on the item differences.
      - `ci95` is a paired bootstrap of the mean difference.
      - q-values are BH across the compared scorers.
    - Functional: It refuses (throws `EvalError` `ERR_PRISM_EVAL_COMPARE_UNPAIRED`) when:
      - the dataset ids differ
      - both manifests carry `datasetVersion` and they differ (and, after plan 200 Task 2, `datasetContentHash`)
      - item ids are duplicate/empty, fewer than 2 items pair, or any paired scorer lacks valid numeric observations
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
      diff.scorers.task_success; // { difference: -0.06, ci95: { low: -0.11, high: -0.01 }, pValue: 0.02, qValue: 0.04, significant: true }
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/compare-experiments.ts` (new); `packages/hosts/evals/src/{index.ts,types.ts}`; reuse unchanged `errors.ts`
      - `packages/hosts/evals/src/__tests__/compare-experiments.test.ts` (new), `stats.test.ts` (retain independent McNemar reference); `scripts/e2e-coverage.json`
      - `scripts/memory-bench/{stats.mjs,run.test.mjs,README.md}` (conditional, Task 1)
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

  - Notes (executed 2026-10-26):
    - **Implemented/exported `compareExperiments`, `CompareExperimentsOptions`, and `ExperimentComparison`.** Pure report comparison pairs shared unique item ids in sorted order, averages scored observations per item, and reports candidate-minus-baseline means/differences with a paired percentile bootstrap CI. Binary single-trial observations use exact McNemar; continuous or repeated-trial reports use paired sign flips. BH adjustment covers exactly the selected scorers; significance uses `qValue <= alpha`, while CI coverage remains 95%. Defaults reuse the existing statistics functions' 2,000 bootstrap/10,000 permutation resamples and seed zero. No agent runs, dependency, kernel change, or new error class.
    - **Pairing fails closed.** Dataset ids, jointly present report versions, and jointly present manifest versions must match. Duplicate/empty item ids, fewer than two shared items, absent/invalid paired scores, unknown scorers, and empty/duplicate scorer selections throw `ERR_PRISM_EVAL_COMPARE_UNPAIRED`. Failed/skipped records are excluded rather than converted to numeric successes. Default scorer selection is the union of observed ids and requires each on every paired item. Numeric options validate with `ERR_PRISM_EVAL_STATS` and retain the resampling cap. Report/manifest content hashes do not exist yet; plan 200 Task 2 must add their comparison check when introducing that contract, as this task's acceptance criteria already require.
    - **Consolidated McNemar.** As permitted by plan 197 Task 1 (h), `scripts/memory-bench/stats.mjs` imports the package implementation and preserves its existing `mcnemar` export and suite-specific id/cluster/protocol checks. Updated the benchmark's exact floating-point assertion to a tight tolerance. The stats test retains an independent binomial-sum reference on the 0..20 grid, avoiding a self-comparison after consolidation. Updated package/benchmark READMEs, changelog, coverage registration, and this task's file list/API example. No name retirement or caller signature change; existing benchmark callers keep their export.
    - **Tests written first:** the new suite initially failed on the missing export. All six comparison tests pass: identical reports, a 40-item/eight-flip regression, shuffled ids/reproducibility, shared subsets, continuous and unequal repeated observations, repeated-trial method selection, BH correction/selection, serialization, incompatible versions/ids, missing/failed/invalid scores, and invalid options. Complete serial evals runs passed **132 functional tests**, with only the unchanged bootstrap timing assertion failing under concurrent machine load (final full-run timing ~1,483 ms); the isolated timing check subsequently **passed at ~669 ms** against its unchanged 1,000 ms ceiling. Focused comparison/statistics checks likewise passed all functional cases. Devtools **39 passed**; memory benchmark statistics **17 passed**; the focused benchmark McNemar comparison test passed. `timeout 600s bun run typecheck` passed across core, workspaces, and examples; task-scoped `git diff --check` passed.
    - **Broader verification limits:** `timeout 300s bun test --timeout=0 scripts/memory-bench/run.test.mjs` exceeded its process timeout; it also reported the existing `retry_does_not_duplicate_om_workers_or_promotions` hook error and a lifecycle CLI timeout under load. Reproduced the hook error in an isolated temporary copy using the original HEAD benchmark statistics implementation, then removed the temporary files. Combined coverage/docs checks finished with **69 passed, 3 failed**: the coverage suite passed; docs failed on the existing unpromoted `docs/next` directory/navigation and a demo's 60-second timeout. These failures are outside this task and were not weakened or repaired here.
    - **Compatibility regenerated** using `timeout 900s bun scripts/release.mjs gate --update-baseline --package @arnilo/prism-evals --skip-tarball`. Incremental baseline additions only: `CompareExperimentsOptions`, `ExperimentComparison`, and `compareExperiments(baseline: ExperimentReport, candidate: ExperimentReport, options?: CompareExperimentsOptions): ExperimentComparison`; no removals. Existing tasks' baseline changes were preserved. The gate still exits 1 on the previously recorded observability optional-peer range and missing openai-codex/openrouter lock entries. No whole-workspace release/live-provider run; Task 7 and whole-plan closeout remain pending.

- [x] Task 7: Confidence-aware thresholds and power analysis
  - Acceptance Criteria:
    - Functional: `EvaluationThresholds` gains:
      - `minimumLowerBound: Record<scorerId, number>`: fails when that scorer's `ci95.low` is below the value, or `ci95` is absent (fewer than 2 items) or invalid. Failing closed is deliberate. Minimums must be finite in `[0,1]`; equality passes.
      - `maximumRegression: { baseline: ExperimentReport; delta?: number; alpha?: number; scorers?: readonly string[] }`: runs `compareExperiments` and fails when any compared scorer's difference is significantly below `-delta` at the BH-adjusted level (default `delta: 0`, `alpha: 0.05`).
    - Functional: `powerAnalysis({ baselinePassRate, minimumDetectableDrop, alpha = 0.05, power = 0.8, expectedDiscordance? })` returns `{ items }`, the smallest positive safe integer reaching target power under Task 2's two-sided normal approximation. Default discordance assumes independent baseline/candidate outcomes at rates `p` and `p-d`; a pilot estimate must satisfy the feasible paired margins. Invalid inputs or unrepresentable counts throw `ERR_PRISM_EVAL_STATS`. Existing `minimumDetectableEffect({ discordantRate, n, alpha, power })` provides the reverse. The README table gives the counts for common release settings and qualifies normal-approximation/multiple-scorer limits.
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
      - `packages/hosts/evals/src/__tests__/{evals,stats}.test.ts`
      - `examples/evaluation-gate.ts`: a baseline/candidate statistical gate on the mock provider
      - `examples/behavior-evaluation.ts`: give the existing counting session its missing async event subscription (whole-plan prerequisite exposed by Task 5 accounting)
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

  - Notes (executed 2026-10-26):
    - **Implemented both opt-in confidence gates.** `minimumLowerBound` uses the existing `{ low, high }` interval shape, validates unit-interval minima, and fails closed on missing/non-finite/unordered/out-of-range intervals. Equality passes. `maximumRegression` performs one `compareExperiments` call, preserves its pairing/option errors and BH correction, and rejects significant candidate-minus-baseline differences strictly below `-delta`. Defaults are delta zero and alpha .05; equality at the margin passes. Failures identify the scorer, interval and bound; regression failures also include difference, delta, p/q and alpha. Significance is against zero, with delta filtering the observed drop, not a shifted-null test. Existing point-estimate and invariant gates remain unchanged.
    - **Added/exported `powerAnalysis`, reusing Connor power and the existing inverse.** Integer bracketing/bisection returns the smallest positive safe item count achieving the target. Default discordance assumes independent outcomes at baseline p and candidate p-d; optional pilot discordance must satisfy both paired margins. Inputs and unrepresentable counts fail with `ERR_PRISM_EVAL_STATS`. No dependency or kernel change. The README explains statistical versus point gates, one-comparison resampling cost, discordance assumptions, normal-approximation limits, single-metric versus BH power, and a five-row release sizing table. Updated the changelog and baseline/candidate mock example; its output includes the 909-item default planning result.
    - **Tests written first:** three gate tests initially failed because the gates were absent; the power tests initially failed on the absent export. Five added tests now pass, covering 9/10 noisy successes, inclusive lower bounds, missing/single-item/invalid intervals, invalid parameters, significant drops, noise, improvements, delta equality, custom alpha, pairing refusals, scorer selection and BH correction. Power constants were independently generated with SciPy 1.18.1 normal CDF/quantile calls (formula recorded in the test), including 909/689/2,215 default counts and 312/591 pilot counts; each checks n succeeds, n-1 fails, and the existing MDE inverse agrees. Endpoint/degenerate cases, infeasible margins and safe-integer exhaustion are covered. Python remains outside Bun tests and repository dependencies.
    - **Task verification passed:** `timeout 600s bun run typecheck` (core build, workspace checks, examples); complete evals **138 passed**, devtools **39 passed**, browser **91 passed / 6 skipped**, and coverage **8 passed**. The new gate and coding/browser examples passed. Whole-plan verification exposed the behavior example's structurally cast counting session lacking `subscribe()`: added an empty async generator, matching the existing public session contract, and its existing three-trial assertion and full example now pass. The final examples typecheck also passed. No new fixtures/config/coverage registrations or retired-name sweep were needed; task-scoped whitespace checks passed.
    - **Compatibility regenerated:** `timeout 900s bun scripts/release.mjs gate --update-baseline --package @arnilo/prism-evals --skip-tarball` added the single serialized `powerAnalysis(options: …): { items: number }` export row; interface additions create no separate rows. No removals; preserved earlier tasks' baseline changes. The scoped gate still exits 1 on the previously recorded observability optional-peer range and missing openai-codex/openrouter lock entries.
    - **Whole-plan verification was run; broad gates remain red outside Task 7.** Coding **624 passed / 3 skipped / 1 failed** on the unchanged hard-deny 50 ms timing budget (375 ms in-suite, ~102 ms isolated; subsequent isolated check also failed). Memory benchmark **98 passed / 3 failed**: the two `ERR_PRISM_HOOK` cases (`retry_does_not_duplicate_om_workers_or_promotions`, `full_and_memory_arms_render_the_same_dated_question`) and the split-phase speed assertion. Docs **62 passed / 2 failed**, both existing docs navigation/promotion assertions. Full `timeout 900s bun scripts/release.mjs gate` exits 1 on the peer/lock blockers above, compatibility drift in memory-observational/OpenRouter/web, and kernel packed/unpacked budgets (+993/+2,526 bytes). No unrelated implementation, baseline, timing assertion, docs promotion, or release budget was changed to hide these failures. All task checkboxes are complete; whole-plan green release verification remains pending. No live provider calls were made.

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

- **P2 — Whole-plan verification remains blocked outside the evals task.** Task 7 and the affected evals/devtools/browser suites, typecheck, examples and coverage pass, but the whole-plan run retains coding timing, memory-benchmark hook/performance, docs promotion/navigation, and release peer/lock/compatibility/size failures described in Task 7's note. Assertions and unrelated packages were left unchanged; this is not a green release sign-off. Recorded in plans/backlog.md.

## Further Actions

- **P2 — Restore plan 198 whole-plan verification.** Resolve the external blockers recorded in Task 7, then rerun the listed whole-plan commands before release. Plan 200 Task 2 must also enforce dataset content-hash equality in `compareExperiments` when it introduces that contract, as Task 6 already records. Recorded in plans/backlog.md.
