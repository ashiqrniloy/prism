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

- [x] Task 1: Entry check (read-only)
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

  - Notes (executed 2026-10-26):
    - **Predecessor status.** Plan 198 Tasks 1–7 are complete, including the shared `stats.ts` and `bootstrapInterval` needed here. Its Task 7 records passing typecheck, 138 evals tests, affected suites, examples and coverage. Its whole-plan verification is still pending green: coding timing, memory-benchmark hook/performance, docs navigation/promotion, and release peer/lock/compatibility/size failures remain recorded in its closing sections and backlog. This confirms implementation completion, not a green release sign-off; those external blockers remain outstanding.
    - **Public judge path — proceed.** Plan 197 Task 1 (d) is confirmed: a host builds an `Agent` with `createAgent`, opens a session, and calls `session.run(prompt, { tools: { only: [] }, limits, signal })`, then reads `RunResult.text` and closes the session. `RunOptions.limits` narrows agent ceilings (`src/contracts-protocol.ts:72-76`); use explicit turn/token/wall-time ceilings and cancellation for every attempt. The empty tool grant removes registered tools before the run-local registry is built (`src/tools.ts:226-244`, `src/agent-session/session/assemble.ts:324-338`), so hidden-tool dispatch does not restore them. No public one-shot client or new kernel contract is needed; the stop condition for a missing public path does not apply.
    - **Output validation.** `RunResult.text` is the final assistant text (`src/contracts-run-state.ts:250-285`). `RunOptions` has no top-level response-schema field. Correction to the older phase-review wording: native structured output can be requested through `providerOptions.structuredOutput` on capable models (`src/provider-kit/structured-output.ts`), so strict prompting is not the only possible transport. Task 2's portable path remains JSON parsing plus the public, host-allowed `validateJsonSchema` (`src/index.ts:504`, `scripts/host-surface-allowlist.json:60`); native output never replaces validation.
    - **Model identity — Task 2 must resolve this before implementation.** Neither `RunResult` nor `ScorerInput` identifies the judged model; the objective's `run.model` is not a `RunResult` field. `RunController.model` is a loop-facing field, not scorer input. Read the judge agent's resolved `config.model` and obtain the judged model from the host, comparing `provider` and `model` (`src/contracts-core/agent.ts:209,229`, `src/contracts-core/content.ts:129-151`). Account for `RunOptions.model` overrides rather than assuming the agent default was used. A factory's returned judge agent can be inspected on first use, but the judged result alone never supplies identity. Task 2 needs explicit host-supplied model identity for that case and a fail-closed missing-identity policy unless `allowSelfJudging: true`; do not silently skip the guard or invent `result.model`.
    - **Judge-visible content.** Default to answer text. `answer+timeline` must project metadata-only content, omitting step input/output even if the supplied timeline contains them. Plan 197's Security finding still applies: `metadata` omits I/O; `redacted_io` includes tool arguments/results and requires explicit host opt-in (`packages/integrations/observability/src/timeline.ts:127-138`). Scorer values remain raw; apply the resolved `ScorerInput.redactor` to the item, target/reference and timeline before bounding and prompting, and to stored reasoning (`types.ts:66-81`, `judge.ts:49-60`). The low-level judge already uses that seam. Task 3 must also add it to `PairwiseScorerInput` and forward the resolved redactor from `runComparison`: it currently redacts only the resulting records, not inputs sent to pairwise scorers (`types.ts:371-376`, `comparison.ts:64-100`).
    - **Human-label inventory.** `RunFeedbackRecord` now lives at `src/contracts-core/persistence.ts:73-86` (the task's old line range has shifted): optional numeric `rating`, required `tags`, and optional `metadata` can encode human labels. The contract defines no rating scale, so Task 5 must specify normalization or require `toScore` for host-specific scales/tags/metadata. `runId`, `sessionId`, optional `traceId`, `evaluationIds` and `scorerIds` provide linkage; inherited tenant/account/user scope provides ownership. `comment` is free text and must never enter a judge prompt. `appendEvaluationFeedback` already verifies evaluation/run/trace ownership before appending ID linkage (`packages/hosts/evals/src/feedback.ts:15-66`).
    - **Scope and verification.** Reviewed plan 197 Task 1 (d)/Security/verdict, plan 198's completion notes, roadmap Phase 11 evaluation rigor, the three requested evals modules, and the public contracts above. `graft callers createModelJudge --depth all` found the evals and trajectory test callers. Only this task checkbox and note changed; no implementation, exports, fixtures or dependencies changed. No tests, typecheck, release gate or live model calls were run for this read-only entry check. Tasks 2–7 remain unchecked; the corrections above govern their implementation.

- [x] Task 2: `createRubricJudge`
  - Acceptance Criteria:
    - Functional: `createRubricJudge(options)` returns a `Scorer`:
      - `options.agent`: an `Agent`, or a factory.
      - `options.rubric`: `{ id, version, criteria: string, scale: readonly { label: string; score: number; description: string }[] }`. Scores lie in `[0, 1]`, and labels are unique.
      - `options.reference`: optional, `(item) => string | undefined`.
      - `options.include`: which target parts the judge sees (`"answer"` by default; `"answer+timeline"` adds the redacted metadata timeline).
      - `options.judgedModel`: the actual candidate `{ provider, model }`, or `(input) => model | undefined`, including run overrides. Missing identity fails closed unless `allowSelfJudging: true` (Task 1 finding).
      - Also optional `id` (defaults to the rubric id), byte bounds, `maxAttempts`, `timeoutMs`, and `allowSelfJudging`.
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
      - The judge sees the redacted target only, through `serializeEvaluationReport`-style bounding (`maxInputBytes`). The redaction comes from the seam plan 197 landed: `ScorerInput.redactor` (the entry point's resolved `redactor`/`secrets`), applied to the target and the item before prompting; `undefined` means the host declared no secrets.
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
        judgedModel: candidateAgent.config.model, // supply the actual override when applicable
        rubric: { id: "helpfulness", version: "1", criteria: "Does the answer resolve the user's request?", scale: [
          { label: "no", score: 0, description: "Does not resolve it" },
          { label: "partly", score: 0.5, description: "Resolves part of it" },
          { label: "yes", score: 1, description: "Fully resolves it" },
        ] },
        reference: (item) => item.expected as string | undefined,
      });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/rubric-judge.ts` (new); `packages/hosts/evals/src/{index.ts,types.ts,limits.ts,judge.ts,score.ts}` (reuse `EvalError`; share the existing bound validator and preserve judge error codes in failed records)
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
    - Fresh sessions and cleanup; missing/factory-resolved model identity; host cancellation and factory timeout; canonical hash stability after caller mutation; input/UTF-8 reasoning limits; strict extra-field rejection; default answer-only projection; missing requested timeline.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`: "Judges" section (method, cost per item, self-judging guard, bias notes)
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-26):
    - **Implementation.** Added `rubric-judge.ts` and public `createRubricJudge`, `JudgeRubric`, `RubricJudgeOptions`, `RUBRIC_JUDGE_TEMPLATE_VERSION`, and `DEFAULT_RUBRIC_JUDGE_MAX_ATTEMPTS` (2). The version-1 prompt requests reasoning before a strict labeled JSON verdict. Validated rubric anchors are snapshotted in canonical field order and SHA-256 hashed; caller mutation cannot change the rubric or score mapping. Optional references receive the redacted item. Every attempt uses a fresh session, disables all tools, caps turns/provider attempts/tokens/wall time/continuations, propagates cancellation, and closes the session. The host retains agent ownership. Invalid JSON/schema/UTF-8 reasoning length fails after retries without inventing a score; successful records carry the specified model/rubric/template provenance and a redacted, UTF-8-safe 512-byte reasoning excerpt.
    - **Task 1 identity correction resolved.** Added explicit `judgedModel` as a static `{ provider, model }` or per-input resolver. Hosts must supply the actual run model, including overrides. Missing identity and equal model identities fail closed with `ERR_PRISM_EVAL_JUDGE_SELF` unless `allowSelfJudging: true`; static known identities are checked at construction and factories/resolvers on use. A judge agent without a resolved model is rejected. No kernel contract changed.
    - **Security and shared seam.** Answer text is the default projection. Opt-in timelines require available timeline data and whitelist structural fields, excluding all input/output, error payloads, arbitrary metadata, and usage extension metadata. Prompt data is redacted before the total prompt byte cap. The existing low-level judge's bound validator is reused without changing its defaults. A necessary one-line prerequisite in `score.ts` preserves judge `EvalError` codes in failed records rather than wrapping judge output errors as `ERR_PRISM_EVAL_SCORE`; other scorer exceptions and invalid-score errors retain `ERR_PRISM_EVAL_SCORE`, covered by a regression test. The error-contract sweep over `src/ packages/ apps/ scripts/ examples/ docs/` found only the retained score-error constructor, scorer-id validation, and README rows, with no stale asserted score codes. Existing `EvalError` suffices; `errors.ts` needed no change.
    - **Docs and scope.** Added the README Judges section, cost/defaults/identity/redaction/error guidance, and a pointer from `createModelJudge`; updated the changelog and registered the judge suite in `scripts/e2e-coverage.json`. No dependency, fixture, reference-host wiring, version bump, publish, or live model call. Tasks 3–7 and whole-plan verification remain pending.
    - **Baseline regeneration.** Ran `timeout 600 bun scripts/release.mjs gate --update-baseline --package @arnilo/prism-evals`, restricting writes to the owning package. The generated baseline diff against HEAD is +31/-3: seven new declarations belong to this task (below). The remaining additions capture inherited plans 197–198 statistics/comparison/requirement/timeline helpers and `ScorerStats`; the three replaced declarations are inherited changes to `collectWhileRunning` (event callback), `mapPool` (settle callback), and `resolveTrialsConfig` (removal of retired `standardError` from its omitted fields). No declaration was removed by Task 2.
      ```diff
      + DEFAULT_RUBRIC_JUDGE_MAX_ATTEMPTS = 2
      + JudgeRubric
      + RUBRIC_JUDGE_TEMPLATE (internal module export; full frozen wording is in the generated baseline)
      + RUBRIC_JUDGE_TEMPLATE_VERSION = "1"
      + RubricJudgeOptions
      + bounded (shared internal module export)
      + createRubricJudge
      ```
    - **Verification.** Tests were written first and initially failed on the missing module. Final `timeout 600 bun run typecheck` passed (core build, all workspaces, and examples); the final narrow error-passthrough adjustment also passed the evals package typecheck. `timeout 180 bun run --filter @arnilo/prism-evals test` passed 154/154 before that adjustment; final `timeout 120 bun test --timeout=0 packages/hosts/evals/src` passed 155/155, including 17 judge tests. The affected devtools, browser, and coding eval-fixture suites passed 16/16 with `--timeout=0`; coverage-manifest checks passed 8/8. Initial combined runs hit the pre-existing bootstrap performance assertion under compilation load and the coding suite’s default five-second test timeout; rerunning evals without concurrent workspace compilation and affected suites with the repo’s timeout policy passed without changing those tests. No paid/live provider requests or whole-plan example/docs verification were run.
    - **Release blocker status.** Baseline-update and post-update scoped release gates still report the inherited optional-observability peer-range validation failure, missing OpenAI Codex/OpenRouter lockfile entries, and kernel size-budget growth (packed +1,128 bytes; unpacked +2,926 bytes). The post-update gate reports no evals compatibility diff. These are the predecessor's already-recorded release blockers, not a green release sign-off; this task does not alter unrelated peer/lock/kernel-budget files.

- [x] Task 3: `createPairwiseJudge` with position swap
  - Acceptance Criteria:
    - Functional: `createPairwiseJudge({ agent, rubric: { id, version, criteria }, allowTie = true })` returns a `PairwiseScorer`:
      - It judges `(left, right)` and `(right, left)` in two tool-less sessions, each replying `{ reasoning, winner: "A" | "B" | "tie" }`.
      - Agreeing verdicts give that preference. Disagreeing verdicts give `tie` with `metadata.positionInconsistent: true`.
      - Metadata records both validated raw winner labels, redacted reasoning excerpts and provenance, and the length ratio of the two answers (the verbosity signal).
      - `judgedModels` supplies both actual candidate model identities, statically or through an input resolver. Both fail closed against self-judging unless `allowSelfJudging: true`, following Task 1/2's model-identity correction.
      - `allowTie: false` disallows a judge reply of `tie`; inconsistent orders still resolve conservatively to a tie. Invalid/failed orders fail the pair.
      - `PairwiseScorerInput.redactor` receives the entry point's resolved redactor; `ComparisonRecord.metadata` retains the scorer's metadata.
    - Functional: `ComparisonReport` gains `positionConsistency: Record<scorerId, number>`: agreeing / successful swapped judgments, including agreed ties; failed judgments are excluded, and scorers without successful swap evidence are omitted.
    - Performance: Two judge calls per pair per item; stated in the README.
    - Code Quality: Shares the template, parsing, retry, and redaction code with Task 2 (one internal `runJudgeSession`).
    - Security: As Task 2 — both candidates are redacted through `input.redactor` before they are labeled A/B, and the swap reuses the same redacted text.
  - Approach:
    - Documentation Reviewed:
      - Zheng et al. 2023 §3.3 (position swap; conservative tie); Wang et al. 2023 (balanced position calibration); `comparison.ts`
    - Options Considered:
      - Randomize the order once per pair. Rejected: it averages the bias out only across many items, and hides it per item.
    - Chosen Approach:
      - Both orders, with inconsistency as a tie (Zheng et al.).
    - API Notes and Examples:
      ```ts
      runComparison({ dataset, candidates, scorers: [createPairwiseJudge({ agent: judgeAgent, rubric, judgedModels: input => candidateModels(input) })] });
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
    - Both preference directions; agreed ties and mixed tie/preferences; fresh sessions and cleanup; tool-less requests; redaction before swap and safe stored metadata; invalid JSON/labels/extra fields/UTF-8 reasoning and retries; `allowTie: false`; both candidate model guards including factories/resolvers; input bounds and pre-aborted signals; finite empty-answer ratios; frozen template snapshot; a failed second order never becomes a tie.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-26):
    - **Implementation.** Added public `createPairwiseJudge`, `PairwiseJudgeOptions`, and `PAIRWISE_JUDGE_TEMPLATE_VERSION`. Both orders share Task 2's template instructions, canonical rubric hashing, strict JSON/schema/UTF-8 validation, retry policy, bounds, model checks, redacted reasoning excerpts, and the single internal `runJudgeSession`. Each order opens a fresh tool-less session and closes it; agent ownership stays with the host. The existing rubric template wording/version/hash and rubric scorer behavior remain covered by regression tests.
    - **Verdicts and reporting.** Consistent A/B verdicts map back to the original candidate; disagreements become `tie` with `positionInconsistent: true`. `allowTie: false` excludes explicit tie replies without suppressing conservative inconsistency ties. Both validated raw verdicts, their per-order attempts/provenance and redacted 512-byte reasoning excerpts are retained. Length ratio uses left/right Unicode character counts after redaction, with empty answers counted as one for a finite result. Candidate names are omitted. Both orders reuse the same redacted answer strings. `runComparison` forwards its resolved redactor, preserves scorer metadata and computes agreement rates over successful swapped judgments only. Failed orders remain failed records; absent evidence never becomes a fabricated 100% consistency rate.
    - **Identity correction and scope.** As required by Task 1/2, added explicit `judgedModels` with static `{ left, right }` identities or a per-pair input resolver; both actual models, including overrides, must differ from the judge unless the host opts into self-judging. This amends Task 3's originally abbreviated API example. No kernel change, dependency, new fixture, reference-host wiring, version bump or publish. Updated the package README with behavior, identity/redaction guidance, ratio and aggregation conventions, and cost (two calls per pair without retries, up to four with default attempts); updated the changelog. The existing registered `judges.test.ts` suite covers the new tests, so no coverage-manifest edit was needed. Tasks 4–7 and whole-plan verification remain pending.
    - **Verification.** Tests were written first and failed on the missing export. `timeout 600s bun run typecheck` passed for core, all workspaces and examples; the final shared-template/type cleanup also passed `timeout 60s bun run --filter @arnilo/prism-evals typecheck`. Final `timeout 180s bun test --timeout=0 packages/hosts/evals/src` passed 168/168, including 30 judge tests. The affected devtools, browser and coding evaluation-fixture suites passed 16/16. An initial evals run concurrent with workspace compilation hit the inherited bootstrap performance assertion (165 passed, one timing failure); the complete final runs passed without weakening that assertion. No live/paid provider calls or whole-plan verification were run.
    - **Compatibility baseline.** Regenerated with `timeout 240s bun scripts/release.mjs gate --update-baseline --package @arnilo/prism-evals`. Relative to the pre-task baseline, added `createPairwiseJudge`, `PairwiseJudgeOptions`, `PAIRWISE_JUDGE_TEMPLATE_VERSION` and the module-internal exported template `PAIRWISE_JUDGE_TEMPLATE`; the `JudgeRubric`/`RubricJudgeOptions` re-export lines now also list `PairwiseJudgeOptions`. No exports were removed. A post-update scoped gate reported no evals compatibility diff.
      ```diff
      + PAIRWISE_JUDGE_TEMPLATE
      + PAIRWISE_JUDGE_TEMPLATE_VERSION
      + PairwiseJudgeOptions
      + createPairwiseJudge
      ~ JudgeRubric / RubricJudgeOptions re-export lines include PairwiseJudgeOptions
      ```
    - **Inherited release blockers.** Scoped baseline-update and post-update release gates still fail the optional-observability peer-range check, missing OpenAI Codex/OpenRouter lockfile entries, and kernel size-budget growth (packed +1,321 bytes; unpacked +3,473 bytes). Those global blockers were already present in predecessor notes; this task does not change their owning files or claim a green release sign-off.

- [x] Task 4: `createJudgePanel`
  - Acceptance Criteria:
    - Functional: `createJudgePanel({ id, judges: readonly Scorer[], combine: "majority" | "mean" | "median", requireDistinctModels = true })` returns a `Scorer`:
      - It runs every judge.
      - `majority` takes the most frequent label (ties resolve to the lower score, conservatively), using the judges' `metadata.label`.
      - `mean` / `median` combine scores.
      - Metadata lists each judge's id, model, label, and score.
      - A judge's `failed` result is excluded and counted. When fewer than half the judges succeed, the record is `failed` with `ERR_PRISM_EVAL_JUDGE_PANEL`.
      - With `requireDistinctModels`, two judges on the same model throw at build time. `Scorer.judgeModel` declares a construction-time `{ provider, model }`; static-agent rubric judges populate it, and `defineScorer` preserves it. Unknown identities (including factories) fail closed at panel construction unless `requireDistinctModels: false` explicitly accepts unverified diversity.
      - Member `requires` declarations are unioned, and the original scorer input and cancellation signal pass through unchanged. Member ids may repeat, as the same rubric on different models has the same default scorer id.
    - Functional: Experiment reports gain `aggregate.scorers[panelId].judgeAgreement`: Fleiss' κ across complete panel label rows, computed in `stats.ts`. Incomplete/unlabeled rows are excluded. No complete rows, fewer than two judges, or one observed category leaves agreement absent; repeated trials/steps each contribute a rating row.
    - Performance: Calls = sum of the judges' calls; stated in the README.
    - Code Quality: The panel is a plain `Scorer` composition with no special case in the runner, except reading `metadata.labels` for agreement.
    - Security: The panel inherits each judge's redaction; the panel itself passes `ScorerInput.redactor` through unchanged, so a member judge cannot see more than a solo one.
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
      - `packages/hosts/evals/src/{judge-panel.ts (new),stats.ts,experiment.ts,types.ts,index.ts,rubric-judge.ts,scorer.ts}`
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
    - Conservative majority ties; mean/odd and even median; half-success quorum; invalid scores/missing majority labels; unknown model rejection and explicit opt-out; repeated rubric ids on distinct models; input/redactor/requirements/cancellation propagation; real mock rubric-panel redaction; experiment agreement and missing-evidence behavior.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-26):
    - **Implementation.** Added public `createJudgePanel` and `JudgePanelOptions`. Every member runs concurrently with the exact original `ScorerInput`; the panel unions input requirements, forwards cancellation, and adds no model calls or retries. Majority uses label frequency with lower-score ties (and the minimum score when members assign different scores to the same label); mean and median combine validated scores. Throwing/invalid judges and missing majority labels are excluded. Exactly half succeeding meets quorum; fewer than half throws `ERR_PRISM_EVAL_JUDGE_PANEL`, preserved by the existing failed-record seam. Successful metadata retains each member's id/model/label/score/status, ordered `labels` with nulls for missing labels, and `failedJudges`; quorum errors contain the failure count. Raw member errors/reasoning are not copied.
    - **Identity seam resolved.** `Scorer` previously exposed model identity only in returned metadata, too late for the required build-time duplicate check. Added optional `Scorer.judgeModel` and forwarding in `defineScorer`; static `createRubricJudge` agents expose their provider/model. With the default diversity guard, missing identities and equal provider/model pairs fail at construction. Factory judges/custom scorers without identities require explicit `requireDistinctModels: false`; no identity is inferred or fabricated. Member ids can repeat for a shared rubric on distinct models. The acceptance text and file list above now specify this prerequisite.
    - **Agreement.** Added exported pure `fleissKappa(labels)` in `stats.ts`, checked against the statsmodels Fleiss example (κ = 0.20993070442195522). `aggregateEvaluations` reads `metadata.labels` without special panel dispatch. It uses only complete, equally sized rows with at least two labels; missing evidence and a single observed category leave `judgeAgreement` absent rather than manufacturing agreement or serializing NaN. Trials/steps are separate rows. No new runner branch or kernel contract.
    - **Docs and scope.** Added README panel usage, model-identity policy, quorum/tie rules, metadata, agreement conventions, and additive call cost, plus the error row and changelog entry. Existing judge/stat suites are already registered in the coverage manifest, so no manifest edit was needed. No dependency, fixture, reference-host wiring, version bump, publish, or live/paid model call. Tasks 5–7 and whole-plan verification remain pending.
    - **Verification.** Tests were written first and failed on the missing exports. Final `timeout 180s bun test --timeout=0 packages/hosts/evals/src` passed 176/176 (37 judge tests and 14 statistics tests). Affected devtools comparison, browser eval-fixture and coding eval-fixture suites passed 16/16. Final `timeout 600s bun run typecheck` passed across core, workspaces and examples; scoped diff whitespace checks passed. An initial full evals run concurrent with compilation exceeded the inherited bootstrap timing assertion; the final complete run passed without changing the limit. No whole-plan checks or live provider calls were run.
    - **Compatibility baseline.** Regenerated using `timeout 240s bun scripts/release.mjs gate --update-baseline --package @arnilo/prism-evals`. Relative to the pre-task baseline, only these exports were added; none removed:
      ```diff
      + JudgePanelOptions
      + createJudgePanel
      + fleissKappa
      ```
      The post-update scoped gate reported no evals compatibility drift. Both gate runs still fail the inherited optional-observability peer-range check, missing OpenAI Codex/OpenRouter lockfile entries, and global kernel size budgets (packed +1,518 bytes; unpacked +3,959 bytes). Their owning files were not changed by Task 4; this is not a green release sign-off.

- [x] Task 5: Judge calibration against human labels
  - Acceptance Criteria:
    - Functional: `calibrateJudge({ judge, items: readonly { item, result, humanScore }[], scale?: "nominal" | "ordinal", seed?, signal?, redactor?, secrets? })` runs the answer-only judge on each labeled item. Declared trace/timeline/environment requirements fail before judging. It returns:
      - `{ n, judgeFailures, cohensKappa, weightedKappa?, krippendorffAlpha, spearman, confusion, kappaCi95 }`
      - `n` counts successful pairs, and failed/invalid scores count in `judgeFailures`. Empty/single-category agreement and constant-rank correlation are `null`; pure statistics helpers return `undefined` for undefined metrics.
      - `weightedKappa` (quadratic) only when `scale` is ordinal; numeric categories sort ascending. Alpha is nominal for two complete raters regardless of this option.
      - `kappaCi95` by paired-item bootstrap of unweighted κ, using plan 198's `bootstrapInterval` (2,000 resamples, default seed 0). Original undefined κ leaves the CI absent; undefined single-category bootstrap draws are conservatively assigned -1. The confusion matrix supplies ascending `labels` and `counts` with human rows/judge columns.
      - Inputs use `HARD_DATASET_ITEMS`; estimated numeric matrix storage uses the existing report byte ceiling.
    - Functional: `labeledItemsFromFeedback({ feedbackStore, persistence, ownership, query?, toScore?, traceLimits?, signal?, redactor?, secrets? })` builds the items from `RunFeedbackStore` records and their runs:
      - The run result comes from the persistence store, through the trace resolver.
      - `toScore` maps a feedback record to a human score (default: `rating` normalized to `[0, 1]`).
      - It requires tenant plus account/user ownership, rejects query ownership overrides and mismatching returned records, and paginates under the existing trace limits. Missing scores are omitted; each selected feedback record is one labeled item. Only the first recorded user message and reconstructed result enter judge input, never feedback comments/metadata or the human score. Unsettled runs fail closed.
    - Functional: `assertEvaluationThreshold(report, { calibrations: { [scorerId]: { report: CalibrationReport; minimumKappa: number; minimumN?: number } } })` fails when the scorer is used in the report and its calibration is below `minimumKappa` (lower CI bound when `kappaCi95` exists), or has fewer than `minimumN` (default 30) items.
    - Performance: One scorer invocation per labeled item per calibration, retaining member/retry costs; bootstrap makes no model calls. Unweighted bootstrap is O(2,000 × n), and the dense matrix uses O(categories²) space; stated in the README.
    - Code Quality: κ, weighted κ, α, and ρ live in `stats.ts` with known answers (scikit-learn 1.9.1 `cohen_kappa_score`, the `krippendorff` 0.8.2 package, SciPy 1.18.1 `spearmanr`).
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

  - Notes (executed 2026-10-26):
    - **Implementation.** Added public `calibrateJudge`, `labeledItemsFromFeedback`, their options and report/item types, and pure `cohensKappa`, `krippendorffAlpha`, and `spearman` helpers in `stats.ts`. Calibration calls each scorer once with only the item/result/expected answer and the redactor/cancellation seam, counts valid pairs separately from judge failures, and never retains raw judge errors. Declared inputs this entry point cannot supply fail before scoring. Added `EvaluationThresholds.calibrations` for experiment and comparison reports: used scorers require the requested unweighted κ lower confidence bound (or point estimate without CI) and successful sample size, default 30; missing/non-finite evidence fails, and unused scorer entries are ignored.
    - **Statistics conventions.** Scores are exact numeric categories, with no invented bins or rounding. Quadratic κ uses ranks in the sorted observed category union; nominal alpha uses both complete raters with finite-population correction, and Spearman uses average tied ranks. Undefined original statistics are `null` in reports (`undefined` in pure helpers), with no κ CI. The existing seeded percentile bootstrap resamples paired item indices, without more judge calls. Undefined one-category bootstrap draws receive the conservative minimum κ of -1; this deliberately widens intervals for small samples, including perfect small samples. The acceptance text and README now state these conventions and the input/matrix bounds explicitly.
    - **Feedback boundary.** Reused the existing bounded cursor paginator and persistence trace resolver. Every feedback query carries explicit tenant plus account/user ownership; conflicting query scope, mismatched feedback/run ownership, repeated/over-limit cursors, oversized traces, and unsettled runs fail closed. Default human scores normalize persisted ratings from [-1, 1] to [0, 1]; absent/custom-omitted scores are skipped. Selected feedback rows remain separate pairs, so repeated reviews require a representative sampling policy from the caller. Feedback comments, tags and metadata are not copied to the judge's item/result; custom mapping sees the feedback only to return a number. Secret redaction occurs through the resolver and scorer seam.
    - **Docs/example/enforcement.** Added the README calibration API, statistical/missing-evidence conventions, ownership rules, sizing/call cost and error row; updated the changelog and examples index. Extended `examples/run-feedback.ts` with a real rubric-judge run on mock candidate/judge providers, cleanup and numeric calibration output. Its single label demonstrates undefined agreement, not evidence to pass the default gate. Registered the new calibration suite in `scripts/e2e-coverage.json`. No kernel, reference-host wiring, dependency, version bump, publish, or retired public name/error; no retirement sweep is needed. Tasks 6–7 and whole-plan verification remain pending.
    - **Verification.** Tests were written first and failed on the missing calibration export. Final `timeout 180s bun test --timeout=0 packages/hosts/evals/src` passed 184/184. The devtools/browser/coding evaluation fixtures and coverage-manifest suites passed 24/24. `timeout 600s bun run typecheck` passed core, workspaces and examples; the final scoped evals typecheck also passed. `timeout 120s bun examples/run-feedback.ts` passed. The focused examples index and execution/no-secret gates passed 2/2. Scoped whitespace checks passed. Tests cover independent numeric answers, conservative degenerate bootstrap draws, failures/invalid scores, ownership and trace limits, redaction/cancellation/requirements, both report gate kinds, and a real mock rubric-judge prompt with no human score/comment/declared secret.
    - **Independent references.** Recorded known answers from scikit-learn 1.9.1, `krippendorff` 0.8.2, and SciPy 1.18.1 in an isolated temporary Python environment, without adding repo dependencies. For human [0,0,1,1,2,2] and judge [0,1,1,2,1,2], κ = 0.2499999999999999, quadratic κ = 0.5714285714285714, nominal α = 0.2978723404255319, and ρ = 0.5809475019311127. The planned sklearn 1.5.2 build has no Python 3.14 wheel in this environment, so the acceptance reference was updated to the independently executed current version; current official κ docs were also fetched through Context7.
    - **Compatibility baseline.** Regenerated with `timeout 240s bun scripts/release.mjs gate --update-baseline --package @arnilo/prism-evals`; the subsequent scoped gate reports no evals compatibility drift. Only these nine exports were added relative to the pre-task baseline; none removed:
      ```diff
      + CalibrateJudgeOptions
      + CalibrationItem
      + CalibrationReport
      + LabeledItemsFromFeedbackOptions
      + calibrateJudge
      + cohensKappa
      + krippendorffAlpha
      + labeledItemsFromFeedback
      + spearman
      ```
    - **Inherited release blockers.** Both scoped release-gate runs still fail the previously recorded optional-observability peer-range check, missing OpenAI Codex/OpenRouter lockfile entries, and kernel size budgets (packed +1,694 bytes; unpacked +4,376 bytes). Task 5 does not change those owning files or claim a green release sign-off. No live/paid provider calls or whole-plan verification were run.

- [x] Task 6: `runComparison`: trials, forfeits, and a Bradley–Terry ranking
  - Acceptance Criteria:
    - Functional: `RunComparisonOptions` gains `trials` (default 1, hard 16) and `seed`.
      - Each candidate runs `trials` times per item, and pairs are judged per trial.
      - A candidate whose run errors forfeits: the record is `status: "scored"`, `preference` toward the other side, and `metadata.forfeit` naming the loser. Only both sides failing, or a scorer error, is `failed` (D11).
    - Functional: `ComparisonReport` gains `ranking: readonly { scorerId; candidate; strength; ci95; rank }[]`; `ci95` is a `[low, high]` tuple:
      - Each record has a zero-based `trialIndex`; scorer ids must be nonempty and unique.
      - Evidence clarification: strength/CI/rank are nullable. A missing candidate, disconnected or one-sided win graph, or nonconvergent MM fit has no finite identified MLE and reports all three as `null`. If any bootstrap draw is unidentifiable/nonconvergent, keep the point strengths but return `ci95: null, rank: null`; never drop invalid draws or add unrequested priors.
      - Bradley–Terry strengths are fitted by the MM algorithm (Hunter 2004), with ties as half wins, normalized to geometric mean 1, and fitted per pairwise scorer (or pooled when there is one).
      - `ci95` comes from an item-level bootstrap (plan 198's `bootstrapInterval` with `clusterIds` = item ids).
      - `rank` uses transitive groups of overlapping CIs as shared competition ranks (1, 1, 3).
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
      - Unregularized BT with bootstrap CIs; forfeits as losses, including returned failed/aborted runs and falsy thrown errors. Host cancellation propagates.
      - Fit each scorer separately, reuse each bootstrap fit across candidates, and report undefined evidence explicitly. Seed controls resampling, not host candidate/scorer randomness.
    - API Notes and Examples:
      ```ts
      const report = await runComparison({ dataset, candidates, scorers: [pairwise], trials: 3, seed: 1 });
      report.ranking; // [{ scorerId: pairwise.id, candidate: "b", strength: 1.8, ci95: [1.2, 2.6], rank: 1 }, …]
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/{comparison.ts,stats.ts,types.ts,index.ts}` (existing `threshold.ts` consumes the corrected wins/failures unchanged; covered by regression tests)
      - `packages/hosts/evals/src/__tests__/{judges,stats}.test.ts`
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - Task 3; plan 198 Task 2
  - Test Cases to Write:
    - `candidate_error_is_forfeit_loss`: fails today (counted as a failure).
    - `bradley_terry_recovers_known_strengths`: on a synthetic tournament.
    - `bt_matches_reference_fit`: a known answer from a recorded `choix` 0.3 `ilsr_pairwise` fit.
    - `trials_multiply_judgments_and_rank_per_scorer_deterministically`
    - Item-cluster bootstrap known answer, overlapping/separated CIs, missing/separated fits and degenerate bootstrap draws, bounds/unique scorer ids, returned failed runs, falsy errors, redaction and cancellation.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`: "Comparing candidates"
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-26):
    - **Implementation.** Added default-one/hard-16 trials through the existing trial validator, safe-integer seed validation, and zero-based record trial indices. Candidates rerun each trial and every stable pair/scorer is judged per trial. One failed candidate forfeits to the successful side without calling the judge; thrown falsy values and returned failed/aborted runs count too. Both failures and scorer errors remain failed records; host cancellation propagates. Existing win/tie/failure totals, position-consistency evidence, byte caps, redaction and win thresholds remain covered. Scorer ids are now checked for uniqueness before candidate calls to prevent silently merging separate judges.
    - **Statistics and API clarification.** Exported pure `bradleyTerry(pairs)`, using Hunter's MM update, half wins for ties, geometric-mean-one normalization, a 1e-9 log-strength tolerance and 1,000-iteration cap. Separate per-scorer rankings use 1,000 seeded whole-item bootstrap draws, carrying all repeated trials and pair records together and caching each fitted draw across candidates. Overlapping CI components share competition ranks. A finite unregularized BT MLE does not exist without a strongly connected win graph; convergence can also fail within the cap. The acceptance text now explicitly returns nullable strength/CI/rank for unavailable fits, and nullable CI/rank if any bootstrap fit is unavailable, rather than inventing finite strengths, adding an unplanned prior, or silently excluding draws. This is a conservative evidence policy; sparse comparisons may retain wins without a rank. Rows include `scorerId` to make multiple scorer fits unambiguous.
    - **Independent known answer.** Installed `choix==0.3.6` only in the pre-existing temporary Python reference environment (no repo dependency). Executed `exp(choix.ilsr_pairwise(3, data, alpha=0, max_iter=1000, tol=1e-12))` for data `[(0,1)]*7+[(1,0)]*3+[(0,2)]*4+[(2,0)]*2+[(1,2)]*5+[(2,1)]*6`: strengths `[1.6684265648640442, 0.7090296635899472, 0.8453343149463673]`. Recorded those independent values in `bt_matches_reference_fit`; a separate synthetic tournament recovers `[2, 1, .5]`. Fetched current official choix API documentation through Context7 and reviewed Hunter's publication.
    - **Verification.** Tests written first failed on the missing public helper. Final `timeout 180s bun test --timeout=0 packages/hosts/evals/src` passed 193/193; affected devtools/browser/coding evaluation suites passed 16/16. `timeout 600s bun run typecheck` passed core, workspaces and examples; a final evals typecheck also passed. Tests verify the reference fits, half wins, invalid/disconnected evidence, concurrency-independent seeded rankings, whole-item bootstrap equality against the shared helper, separate scorers, shared and strict ranks, failed/forfeited cases and win thresholds, maximum trials, duplicate ids, redaction and cancellation. Scoped whitespace checks passed.
    - **Docs, baseline and scope.** Added README “Comparing candidates” with calls, runtime/memory bounds, seed meaning and missing-evidence semantics; updated changelog. No new suite file, kernel contract, dependency, fixture, host wiring, retired export/error, version bump or publish. `threshold.ts` needs no edit; its gates consume the updated totals. Regenerated the evals baseline and reran the scoped release gate; no evals compatibility drift remains. Relative to the pre-task baseline, the sole export addition is:
      ```diff
      + bradleyTerry
      ```
    - **Inherited release blockers.** Both scoped release gates still report the previously recorded optional-observability peer-range mismatch, missing OpenAI Codex/OpenRouter lockfile entries, and kernel size budgets (current packed +1,820 bytes; unpacked +4,806 bytes). These are outside Task 6's owning files; no release sign-off is claimed. Task 7 and whole-plan verification remain pending. No live/paid provider calls were run.

- [x] Task 7: Judge example under the execution gate
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
      - `src/__tests__/docs.test.ts`: register the example in the explicit demo execution list
    - References:
      - Tasks 2–6
  - Test Cases to Write:
    - The examples execution gate covers it; `docs index links examples and examples README lists every TypeScript example` stays green (the existing test for the planned `examples_readme_lists_every_example` check).
    - The example asserts rubric/panel labels and scores, five successful calibration pairs and κ, both swapped preference directions, consistency, and finite BT strengths/intervals/ranks; it asserts completion under 10 seconds.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — example only.
    - Docs pages to create/edit:
      - `examples/README.md`: one line
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-26):
    - **Implementation.** Added `examples/eval-judges.ts` using public imports only. Mock candidate agents produce real run results; a reference-backed rubric judge grades one result, a majority panel runs two distinct mock judge model ids, and calibration grades five labeled results with both correct and incorrect answers. A separate mock pairwise judge swaps positions in fresh sessions; two trials per item script one win per candidate, giving identified BT strengths of 1, intervals [1, 1], and shared rank 1. These scripted verdicts demonstrate API use, not real judge quality or sufficient calibration for a production gate. Output contains only ids, labels, and numbers. Sessions close after every candidate call and all agents are disposed.
    - **Execution gate and scope.** Registered the demo in the existing explicit `examples_demos_run_to_completion_and_emit_no_secret` list and the evals coverage manifest; added its examples README entry. The plan's file list now includes the execution-gate registration, and its README check names the existing test. No kernel/package implementation, public export, compatibility baseline, dependency, fixture, host wiring, retired name/error, version bump or publish changed; no retirement sweep or baseline regeneration is needed.
    - **Verification.** Added the gate entry first and observed it fail on the missing example. Final `timeout 10s bun examples/eval-judges.ts` passed in approximately 0.1 seconds including `run-feedback.ts` in the shell invocation; the example also enforces its own 10-second bound. `timeout 600s bun run typecheck` passed core, workspaces and examples; after removing unnecessary non-null assertions, `timeout 120s bunx tsc -p examples/tsconfig.json --noEmit` passed. `timeout 600s bun run build:core` passed. `timeout 600s bun run --filter @arnilo/prism-evals test` passed 193/193; `timeout 600s bun test --timeout=0 scripts/e2e-coverage.test.mjs` passed 8/8. Both example programs completed. The compiled demo execution/no-secret gate passed, including the new example, and the README inventory check passed in the full docs run.
    - **Whole-plan status.** Ran every listed whole-plan command. Final `timeout 300s bun test --timeout=0 src/__tests__/docs.test.ts` passed 62/64, with only the inherited documentation navigation and `docs_next_is_promoted` failures. `timeout 900s bun scripts/release.mjs gate` still fails the optional-observability peer range, missing OpenAI Codex/OpenRouter lockfile entries, unrelated observational-memory/OpenRouter/web compatibility drift, and kernel size budgets (packed +1,820 bytes; unpacked +4,806 bytes). It reports no evals compatibility drift. All seven implementation tasks are complete, but whole-plan release sign-off remains pending those owning changes. Closing compromises/further-actions and backlog handoff remain pending green whole-plan verification, per the create-plan end procedure. No live/paid provider calls were run.

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
