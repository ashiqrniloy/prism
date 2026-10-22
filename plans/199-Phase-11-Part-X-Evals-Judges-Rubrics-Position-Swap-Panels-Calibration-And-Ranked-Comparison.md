# Phase 11 Part X — eval judges: rubric judges, position-swapped pairwise judging, panels, calibration against humans, and ranked comparison

## Objectives

- Give hosts LLM-as-judge scorers that follow the published methodology, instead of a bare wrapper around a host function:
  - `createModelJudge` (`packages/hosts/evals/src/judge.ts:25-86`) adds timeouts, retries, and byte caps around `options.judge(request)`. It has no rubric template, no reasoning-before-score, no output schema, no reference grading, and no protection against judging a model with itself.
  - Judge biases are documented and large:
    - position bias and verbosity bias: Zheng et al. 2023, *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena* (arXiv 2306.05685); Wang et al. 2023, *Large Language Models are not Fair Evaluators* (arXiv 2305.17926)
    - self-preference: Panickssery et al. 2024 (arXiv 2404.13076)
    - Mitigations with evidence: reasoning before the score (G-Eval, Liu et al. 2023, arXiv 2303.16634); explicit score rubrics and reference answers (Prometheus 2, Kim et al. 2024, arXiv 2405.01535); swapping positions (Zheng et al.); a panel of different judges (PoLL, Verga et al. 2024, arXiv 2404.18796).
  - **No calibration.** A judge is trusted with no measured agreement with humans. Shankar et al. 2024, *Who Validates the Validators?* (arXiv 2404.12272), show that judge criteria drift and must be aligned to human grades. `appendEvaluationFeedback` (`packages/hosts/evals/src/feedback.ts`) already links human feedback to evaluations, but nothing computes agreement.
  - **D11 — pairwise comparison is biased and unranked.** `runComparison` judges each pair in one order only, counts raw wins, and records a candidate's own failure as a pair "failure" rather than a loss (`packages/hosts/evals/src/comparison.ts:64-113`). It runs each candidate once.

## Expected Outcome

- `createRubricJudge({ agent, rubric, reference?, ... })` runs a host-built judge `Agent` once per item, with no tools:
  - It sends a versioned prompt with the rubric's criteria and labeled scale, the optional reference answer, and the redacted target.
  - It requires a strict JSON reply `{ "reasoning": string, "label": string }` with the reasoning first, validated by `validateJsonSchema`.
  - It maps the label to `[0, 1]` and records the judge model, rubric hash, and template version.
  - It refuses to judge a run made by the same model unless `allowSelfJudging: true`.
- `createPairwiseJudge({ agent, rubric })` judges both orders. A consistent verdict is a preference; an inconsistent one is a `tie` with `positionInconsistent: true`. `ComparisonReport.positionConsistency` reports the rate.
- `createJudgePanel({ judges, combine })` combines different judges by majority, mean, or median, keeps each judge's verdict, and reports agreement between the judges.
- `calibrateJudge({ judge, items })` scores human-labeled items and returns Cohen's κ (or quadratic-weighted κ for ordinal scales), Krippendorff's α, Spearman ρ, a confusion matrix, `n`, and a bootstrap CI for κ.
  - `labeledItemsFromFeedback(store, query)` builds the items from `RunFeedbackStore`.
  - `assertEvaluationThreshold` can require a calibration per judge scorer (`calibrations`).
- `runComparison` runs `trials` per candidate and records a candidate's error as a forfeit loss. It fits Bradley–Terry strengths (Hunter 2004, MM algorithm) with item-bootstrap CIs (Chiang et al. 2024, *Chatbot Arena*, arXiv 2403.04132) and returns `ranking`.

**0.13.0 release path — plan 199, step 15 of 21.** Owner decision 2026-10-19 (see plan 197's header). Start this plan when plan 198 is complete (it uses plan 198's `stats.ts`); when it is complete, continue with plan 200. Its phase review is plan 197 Task 1, whose finding (d) fixes the judge model path; Task 1 here is an entry check. It changes a host library only and no kernel contract. Judges cost model calls: every new judge states its calls per item in the README, and none runs unless a host builds it. No version bump, publish, or npm deprecation.

## Tasks

- [ ] Task 1: Entry check (read-only)
  - Acceptance Criteria:
    - Functional: The note confirms:
      - plan 198 is complete
      - plan 197 Task 1 (d): the judge path is a host-built `Agent` run with `RunOptions.tools: { only: [] }` and run `limits`, reading `RunResult.text`, and how the judged run's model is identified (`run.model` / `RunResult` fields) for the self-judging check
      - which `timeline` content mode the judge may see (plan 197 Task 1, Security)
      - the `RunFeedbackRecord` fields usable as human labels (`rating`, `tags`, `metadata`; `src/contracts-core/persistence.ts:95-135`)
    - Functional: If (d) found no way to run a tool-less, bounded judge through the public API, the plan stops and the gap goes to plan 197's verdict.
    - Performance: n/a — read-only.
    - Code Quality: No code changes.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - plan 197 Task 1 (d); `judge.ts`; `comparison.ts`; `feedback.ts`
    - Options Considered:
      - None; an entry check.
    - Chosen Approach:
      - A short inventory.
    - API Notes and Examples:
      ```bash
      timeout 60 graft callers createModelJudge --depth all
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

- [ ] Task 2: `createRubricJudge`
  - Acceptance Criteria:
    - Functional: `createRubricJudge(options)` returns a `Scorer`:
      - `options.agent`: an `Agent`, or a factory.
      - `options.rubric`: `{ id, version, criteria: string, scale: readonly { label: string; score: number; description: string }[] }`. Scores lie in `[0, 1]`, and labels are unique.
      - `options.reference`: optional, `(item) => string | undefined`.
      - `options.include`: which target parts the judge sees (`"answer"` by default; `"answer+timeline"` adds the redacted metadata timeline).
      - Also `maxAttempts`, `timeoutMs`, and `allowSelfJudging`.
    - Functional: Per item it runs one session with `tools: { only: [] }` and run limits. The prompt comes from a frozen, versioned template (`RUBRIC_JUDGE_TEMPLATE_VERSION`): criteria, the scale with descriptions, the reference when present, the target, and an instruction to write the reasoning before the label.
    - Functional: The reply must parse as JSON matching `{ reasoning: string ≤ 4 KiB, label: one of the scale labels }`. A parse or schema failure retries up to `maxAttempts` with a new session, then the record is `failed` with `ERR_PRISM_EVAL_JUDGE_OUTPUT`. It is never coerced to a score.
    - Functional: Metadata records:
      - `evaluatorKind: "model"`, `judgeModel`, `rubricId`, `rubricVersion`
      - `rubricHash` (sha256 of the canonical rubric)
      - `templateVersion`, `label`, `attempts`
      - a 512-byte reasoning excerpt, passed through the redactor
    - Functional: When the judged run's model equals the judge agent's model and `allowSelfJudging` is not `true`, the scorer throws `EvalError` `ERR_PRISM_EVAL_JUDGE_SELF` when built (if both are known then), otherwise on first use.
    - Functional: `createModelJudge` stays as the low-level adapter for hosts with their own judge call. Its README line points to `createRubricJudge` for the full method.
    - Performance: One judge model call per item per attempt; stated in the README with the default `maxAttempts: 2`.
    - Code Quality:
      - The template is a constant with a version, unit-tested for stability (a changed template must bump the version).
      - Rubric validation errors use `ERR_PRISM_EVAL_JUDGE`.
    - Security:
      - The judge sees the redacted target only, through `serializeEvaluationReport`-style bounding (`maxInputBytes`).
      - The judge agent must have no tools; a factory returning an agent with tools still runs tool-less (`only: []`).
      - Reasoning stored in records is redacted and capped.
  - Approach:
    - Documentation Reviewed:
      - G-Eval (Liu et al. 2023) §2; Prometheus 2 (Kim et al. 2024) §3; MT-Bench (Zheng et al. 2023) §3–4; `judge.ts`; `validateJsonSchema` (`@arnilo/prism`); plan 197 Task 1 (d)
    - Options Considered:
      - Probability-weighted scores from token log-probabilities (G-Eval). Rejected for now: the shipped providers do not all return log-probabilities. It goes to Further Actions if a provider does.
      - Free-form numeric scores. Rejected: labeled anchors with descriptions agree better with humans (Prometheus 2) and map cleanly to κ in Task 5.
    - Chosen Approach:
      - A versioned rubric with labeled anchors, reasoning first, strict JSON, a tool-less judge agent, and a self-judging guard.
    - API Notes and Examples:
      ```ts
      const judge = createRubricJudge({
        agent: judgeAgent,
        rubric: { id: "helpfulness", version: "1", criteria: "Does the answer resolve the user's request?", scale: [
          { label: "no", score: 0, description: "Does not resolve it" },
          { label: "partly", score: 0.5, description: "Resolves part of it" },
          { label: "yes", score: 1, description: "Fully resolves it" },
        ] },
        reference: (item) => item.expected as string | undefined,
      });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/rubric-judge.ts` (new); `packages/hosts/evals/src/{index.ts,types.ts,errors.ts,limits.ts}`
      - `packages/hosts/evals/src/__tests__/judges.test.ts` (new); `scripts/e2e-coverage.json`
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - plan 197 Task 1 (d)
  - Test Cases to Write:
    - `rubric_judge_maps_label_to_score` (mock provider replying with JSON)
    - `rubric_judge_invalid_json_fails_record_after_retries`: never a coerced score.
    - `rubric_judge_label_outside_scale_fails`
    - `rubric_judge_refuses_self_judging`
    - `rubric_judge_runs_without_tools`: a judge agent with a registered tool never calls it.
    - `rubric_judge_target_is_redacted`: a secret in the run text never reaches the judge request.
    - `template_change_requires_version_bump`: snapshot of the template and its version.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`: "Judges" section (method, cost per item, self-judging guard, bias notes)
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: `createPairwiseJudge` with position swap
  - Acceptance Criteria:
    - Functional: `createPairwiseJudge({ agent, rubric: { id, version, criteria }, allowTie = true })` returns a `PairwiseScorer`:
      - It judges `(left, right)` and `(right, left)` in two tool-less sessions, each replying `{ reasoning, winner: "A" | "B" | "tie" }`.
      - Agreeing verdicts give that preference. Disagreeing verdicts give `tie` with `metadata.positionInconsistent: true`.
      - Metadata records both raw verdicts and the length ratio of the two answers (the verbosity signal).
    - Functional: `ComparisonReport` gains `positionConsistency: Record<scorerId, number>`.
    - Performance: Two judge calls per pair per item; stated in the README.
    - Code Quality: Shares the template, parsing, retry, and redaction code with Task 2 (one internal `runJudgeSession`).
    - Security: As Task 2.
  - Approach:
    - Documentation Reviewed:
      - Zheng et al. 2023 §3.3 (position swap; conservative tie); Wang et al. 2023 (balanced position calibration); `comparison.ts`
    - Options Considered:
      - Randomize the order once per pair. Rejected: it averages the bias out only across many items, and hides it per item.
    - Chosen Approach:
      - Both orders, with inconsistency as a tie (Zheng et al.).
    - API Notes and Examples:
      ```ts
      runComparison({ dataset, candidates, scorers: [createPairwiseJudge({ agent: judgeAgent, rubric })] });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/{rubric-judge.ts,comparison.ts,types.ts,index.ts}`
      - `packages/hosts/evals/src/__tests__/judges.test.ts`
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - Task 2
  - Test Cases to Write:
    - `position_biased_judge_yields_tie`: a mock judge that always picks "A" gives a tie with `positionInconsistent`.
    - `consistent_judge_yields_preference`
    - `position_consistency_rate_reported`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: `createJudgePanel`
  - Acceptance Criteria:
    - Functional: `createJudgePanel({ id, judges: readonly Scorer[], combine: "majority" | "mean" | "median", requireDistinctModels = true })` returns a `Scorer`:
      - It runs every judge.
      - `majority` takes the most frequent label (ties resolve to the lower score, conservatively), using the judges' `metadata.label`.
      - `mean` / `median` combine scores.
      - Metadata lists each judge's id, model, label, and score.
      - A judge's `failed` result is excluded and counted. When fewer than half the judges succeed, the record is `failed` with `ERR_PRISM_EVAL_JUDGE_PANEL`.
      - With `requireDistinctModels`, two judges on the same model throw at build time.
    - Functional: Experiment reports gain `scorers[panelId].judgeAgreement`: Fleiss' κ across the panel's labels over items, computed in `stats.ts`.
    - Performance: Calls = sum of the judges' calls; stated in the README.
    - Code Quality: The panel is a plain `Scorer` composition with no special case in the runner, except reading `metadata.labels` for agreement.
    - Security: The panel inherits each judge's redaction.
  - Approach:
    - Documentation Reviewed:
      - Verga et al. 2024 (PoLL: a panel of smaller, different-family judges beats one large judge and reduces intra-model bias); Fleiss 1971
    - Options Considered:
      - Weighted panels. Rejected: the weights need calibration data per judge; Task 5 supplies the measurement, and weighting goes to Further Actions.
    - Chosen Approach:
      - Unweighted combination with distinct models, and agreement reported.
    - API Notes and Examples:
      ```ts
      createJudgePanel({ id: "helpfulness_panel", judges: [judgeHyper, judgeOpenCodeGo, judgeLaya], combine: "majority" });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/{judge-panel.ts (new),stats.ts,experiment.ts,types.ts,index.ts}`
      - `packages/hosts/evals/src/__tests__/judges.test.ts`, `stats.test.ts` (Fleiss κ known answer from statsmodels `fleiss_kappa`)
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - Task 2; plan 198 Task 2
  - Test Cases to Write:
    - `panel_majority_label`
    - `panel_fails_when_most_judges_fail`
    - `panel_rejects_duplicate_models`
    - `fleiss_kappa_matches_statsmodels`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: Judge calibration against human labels
  - Acceptance Criteria:
    - Functional: `calibrateJudge({ judge, items: readonly { item, result, humanScore }[], scale?, seed? })` runs the judge on each labeled item. It returns:
      - `{ n, judgeFailures, cohensKappa, weightedKappa?, krippendorffAlpha, spearman, confusion, kappaCi95 }`
      - `weightedKappa` (quadratic) only when `scale` is ordinal
      - `kappaCi95` by bootstrap over items, using plan 198's `bootstrapInterval`
    - Functional: `labeledItemsFromFeedback({ feedbackStore, persistence, query, toScore })` builds the items from `RunFeedbackStore` records and their runs:
      - The run result comes from the persistence store, through the trace resolver.
      - `toScore` maps a feedback record to a human score (default: `rating` normalized to `[0, 1]`).
      - It is ownership-scoped and bounded by the existing trace limits.
    - Functional: `assertEvaluationThreshold(report, { calibrations: { [scorerId]: { report: CalibrationReport; minimumKappa: number; minimumN?: number } } })` fails when the scorer is used in the report and its calibration is below `minimumKappa` (lower CI bound when `kappaCi95` exists), or has fewer than `minimumN` (default 30) items.
    - Performance: One judge call per labeled item per calibration; stated in the README.
    - Code Quality: κ, weighted κ, α, and ρ live in `stats.ts` with known answers (sklearn 1.5 `cohen_kappa_score`, the `krippendorff` 0.8 package, SciPy `spearmanr`).
    - Security: Feedback and runs are read under the caller's ownership scope only. Human comments never reach the judge.
  - Approach:
    - Documentation Reviewed:
      - Shankar et al. 2024 (EvalGen; criteria drift; aligning judges to human grades); Cohen 1960; Krippendorff 2011; `feedback.ts`; `curate.ts` (the feedback-loading pattern); `src/contracts-core/persistence.ts:95-135`
    - Options Considered:
      - Report raw accuracy against humans. Rejected: chance agreement is high on skewed labels, and κ corrects for it.
    - Chosen Approach:
      - Chance-corrected agreement with CIs, built from the feedback seam the SDK already has, and gateable.
    - API Notes and Examples:
      ```ts
      const labeled = await labeledItemsFromFeedback({ feedbackStore, persistence, query: { tag: "graded" }, ownership });
      const calibration = await calibrateJudge({ judge, items: labeled, seed: 1 });
      assertEvaluationThreshold(report, { calibrations: { helpfulness: { report: calibration, minimumKappa: 0.6 } } });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/{calibration.ts (new),stats.ts,threshold.ts,types.ts,index.ts}`
      - `packages/hosts/evals/src/__tests__/calibration.test.ts` (new); `stats.test.ts`; `scripts/e2e-coverage.json`
      - `examples/run-feedback.ts`: extend with calibration on the mock provider
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - Tasks 2–4; plan 198 Task 2
  - Test Cases to Write:
    - `perfect_judge_kappa_one`, and `constant_judge_kappa_zero`
    - `weighted_kappa_matches_sklearn`, `alpha_matches_krippendorff_package`
    - `threshold_fails_uncalibrated_judge`: below `minimumKappa`, or with too few items.
    - `feedback_loader_respects_ownership`: another tenant's feedback is never read.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`: "Calibrating a judge"
      - `examples/README.md`: the `run-feedback.ts` line
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: `runComparison`: trials, forfeits, and a Bradley–Terry ranking
  - Acceptance Criteria:
    - Functional: `RunComparisonOptions` gains `trials` (default 1, hard 16) and `seed`.
      - Each candidate runs `trials` times per item, and pairs are judged per trial.
      - A candidate whose run errors forfeits: the record is `status: "scored"`, `preference` toward the other side, and `metadata.forfeit` naming the loser. Only both sides failing, or a scorer error, is `failed` (D11).
    - Functional: `ComparisonReport` gains `ranking: readonly { candidate; strength; ci95; rank }[]`:
      - Bradley–Terry strengths are fitted by the MM algorithm (Hunter 2004), with ties as half wins, normalized to geometric mean 1, and fitted per pairwise scorer (or pooled when there is one).
      - `ci95` comes from an item-level bootstrap (plan 198's `bootstrapInterval` with `clusterIds` = item ids).
      - `rank` uses overlapping CIs as shared rank.
      - `wins` and `ties` stay.
    - Performance: The MM fit is O(iterations × candidates²), capped at 1,000 iterations with a 1e-9 tolerance; the bootstrap is ≤ 1,000 resamples by default. Stated in the README.
    - Code Quality: `bradleyTerry(pairs)` in `stats.ts`, pure and known-answer-tested.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - Hunter 2004 (*Annals of Statistics* 32:384); Chiang et al. 2024 §4 (BT with bootstrap CIs); `comparison.ts:15-114`; plan 198
    - Options Considered:
      - Online Elo. Rejected: it depends on order and is unstable for small datasets; BT is the MLE for the same model (Chiang et al.).
    - Chosen Approach:
      - BT with bootstrap CIs; forfeits as losses.
    - API Notes and Examples:
      ```ts
      const report = await runComparison({ dataset, candidates, scorers: [pairwise], trials: 3, seed: 1 });
      report.ranking; // [{ candidate: "b", strength: 1.8, ci95: [1.2, 2.6], rank: 1 }, …]
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/{comparison.ts,stats.ts,types.ts,threshold.ts}`
      - `packages/hosts/evals/src/__tests__/{judges,stats}.test.ts`
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - Task 3; plan 198 Task 2
  - Test Cases to Write:
    - `candidate_error_is_forfeit_loss`: fails today (counted as a failure).
    - `bradley_terry_recovers_known_strengths`: on a synthetic tournament.
    - `bt_matches_reference_fit`: a known answer from a recorded `choix` 0.3 `ilsr_pairwise` fit.
    - `trials_multiply_judgments`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`: "Comparing candidates"
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7: Judge example under the execution gate
  - Acceptance Criteria:
    - Functional: `examples/eval-judges.ts` runs on the mock provider:
      - a rubric judge with a reference
      - a pairwise comparison with position swap and a BT ranking
      - a two-judge panel on two distinct mock model ids
      - a calibration over five labeled items
      - It prints only ids, labels, and numbers, and passes `examples_demos_run_to_completion_and_emit_no_secret`.
    - Performance: Runs under 10 s.
    - Code Quality: Public imports only.
    - Security: No secret in output (the gate checks it).
  - Approach:
    - Documentation Reviewed:
      - `examples/README.md`; `examples/evals.ts`
    - Options Considered:
      - Extend `examples/evals.ts`. Rejected: the judge flow is long enough to obscure the basic example.
    - Chosen Approach:
      - One focused example.
    - API Notes and Examples:
      ```bash
      timeout 120 bun examples/eval-judges.ts
      ```
    - Files to Create/Edit:
      - `examples/eval-judges.ts` (new); `examples/README.md`; `scripts/e2e-coverage.json`
    - References:
      - Tasks 2–6
  - Test Cases to Write:
    - The examples execution gate covers it; `examples_readme_lists_every_example` stays green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — example only.
    - Docs pages to create/edit:
      - `examples/README.md`: one line
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 600 bun run typecheck`
- `timeout 600 bun run --filter @arnilo/prism-evals test`
- `timeout 300 bun examples/eval-judges.ts && timeout 300 bun examples/run-feedback.ts`
- `timeout 300 bun test --timeout=0 src/__tests__/docs.test.ts`
- `timeout 600 bun test --timeout=0 scripts/e2e-coverage.test.mjs`
- `timeout 900 bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
