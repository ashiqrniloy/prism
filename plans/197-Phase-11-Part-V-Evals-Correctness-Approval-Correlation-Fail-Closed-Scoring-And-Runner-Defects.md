# Phase 11 Part V — evals correctness: approval correlation, fail-closed scoring, and runner defects

## Objectives

- Fix the eval defects found by the 2026-10-19 eval-system review. Each one makes `@arnilo/prism-evals` report a pass the agent did not earn, or drop evidence:
  - **D1 — approval is not correlated.** `createApprovalBeforeEffectScorer` counts any `hitl` step that is not `denied`/`failed`, and any `guardrail` step with status `succeeded`, as an approval for every later tool (`packages/hosts/evals/src/trajectory.ts:548-567`). The timeline creates `hitl` steps as `suspended` and never updates them on `decision.resolved` (`packages/integrations/observability/src/timeline.ts:307-325`), so a **denied** approval passes. Inline approvals emit no `run.suspended` at all, so an approved inline call fails.
  - **D2 — missing timeline passes.** `createErrorClassScorer` returns `1` with no timeline (`trajectory.ts:397-400`), and `timeline` defaults to `"off"` in `runExperiment`, so it always passes there. The other trajectory scorers return `0` for the same input.
  - **D3 — `forEach` scores nothing per step.** `scoreRun` records `stepId` but never passes the step to `scorer.score` (`packages/hosts/evals/src/score.ts:40-48`), so each "per-step" record scores the whole run.
  - **D6 — `requireInvariants` is dead.** Declared at `types.ts:336`, used by `examples/coding-browser-evaluation.ts:148`, never read by `assertEvaluationThreshold` (`threshold.ts:15-44`). A scorer that throws carries no `invariant` metadata, so a crashing invariant scorer never sets `invariantsPassed: false` (`experiment.ts:30-32`).
  - **D7 — `seed` is not reproducible.** One seeded RNG is shared by concurrent workers (`experiment.ts:75`), so which runs are sampled depends on timing when `concurrency > 1`.
  - **D8 — abort discards finished work.** Any throw out of `mapPool` replaces every item result with the error (`experiment.ts:180-189`).
  - **D9 — experiments cannot inject failures.** The agent factory is always called with `{}` (`experiment.ts:100`); `failureInjection` works only in scenarios.
  - **D10 — scenarios pass when they should not.** `maxTurns` silently drops scripted turns (`scenarios.ts:149-150`), an `aborted` final run reports `succeeded` (`scenarios.ts:207`), and only the last turn is scored.
  - **D12 — curation is not idempotent.** Re-curating a run already in the dataset throws on the duplicate id and aborts the whole batch (`curate.ts:229-232`).
  - **D13 — docs and code disagree.** The README documents a `createComparisonJudge` that does not exist (`README.md:12,52`), and `trajectory.ts:574` ends with an empty "Turn Coverage Scorer (plan 096)" heading.
  - **D15 — computed import.** `score.ts:94`, `experiment.ts:104`, and `scenarios.ts:157` load `@arnilo/prism-observability` through a computed specifier (`const pkg = "..."; await import(pkg)`), which `plans/backlog.md:751` already tracks.
- Run the read-only phase review for the whole eval train (plans 197–201) first, so the later plans build on verified seams.

## Expected Outcome

- The timeline records each approval decision on the `hitl` step for that tool call (`approved` / `denied`, with `metadata.toolCallId`), for suspended and inline decisions alike.
- `approval_before_effect` passes an effect only when an `approved` decision for **that tool call id** precedes it. It selects effectful tools from the agent's `ToolInfo.effects` (`write`, `execute`, `external`). A tool with unknown effects counts as effectful. A guardrail "allow" is no longer an approval.
- Every trajectory scorer fails closed without a timeline. A scorer that declares `requires: ["timeline"]` makes `scoreRun` / `runExperiment` / `runScenario` throw `EvalError` (`ERR_PRISM_EVAL_TIMELINE_REQUIRED`) up front when `timeline` is `"off"`, instead of scoring zeros.
- `forEach` passes the step to the scorer as `ScorerInput.step`.
- Invariance is declared on the scorer (`Scorer.invariant`), so a thrown invariant scorer fails the invariant gate. `requireInvariants` works.
- Each trial gets its own RNG derived from `(seed, itemId, trialIndex)`. An abort keeps finished items and reports `aborted`. `runExperiment` passes `hooks`/`slots` to the agent factory.
- `runScenario` rejects too many turns before running, reports `aborted`, and can score every turn.
- `datasetFromRuns` skips ids already in the dataset with reason `already in dataset`.
- The README is the package page, with no phantom exports. Observability is a declared optional peer, loaded through a static specifier.

**0.13.0 release path — plan 197, step 13 of 21.** Owner decision 2026-10-19: every recommendation of the eval-system review (P0–P4) ships in 0.13.0, as plans 197–201. Start this plan when plan 196 is complete; when it is complete, continue with plan 198. Plans 197–201 run before plan 184, so its cache measurement sees the final reference-host package set (plan 201 adds an eval suite to the host, which does not change agent request bytes). They run before plan 185, because they add and remove `@arnilo/prism-evals` exports, change `@arnilo/prism-observability`'s timeline vocabulary, and may add a kernel persistence capability (plan 201 Task 2), all of which plan 185's freeze must see.

**Task 1 is the phase review for plans 197–201.** It checks every assumption the five plans make, because plan 201 may add a kernel contract (an optional `ProductionPersistenceStore.evaluations` capability) and every plan changes `@arnilo/prism-evals`' public surface. The rest of this plan changes no kernel contract: it changes a host library (`packages/hosts/evals`), one integration package's timeline projection (`packages/integrations/observability`), and their callers. The work implements roadmap Phase 10 ("evals is a library over the public `Agent`", §2.8) under the Phase 11 freeze. No version bump, publish, or npm deprecation.

## Tasks

- [ ] Task 1: Phase review for plans 197–201 (read-only)
  - Acceptance Criteria:
    - Functional: The task note records, citing `file:line`:
      - (a) **Eval surface and callers.** Every export of `packages/hosts/evals/src/index.ts`, and the callers of each from `graft callers <symbol> --depth all`, including `examples/{evals,evaluation-gate,behavior-evaluation,coding-browser-evaluation,guardrail-packs}.ts`, `packages/hosts/devtools/src/compare.ts`, `packages/tools/{coding,browser}` eval-fixture tests, `scripts/` fixtures, and `templates/init/optional/evals-example.ts.tmpl`. Also the current `scripts/compat-baseline/arnilo__prism-evals.txt` and `arnilo__prism-devtools.txt` rows these plans will rewrite.
      - (b) **Approval projection (D1).**
        - How `run.suspended` (`interruption.toolCallId`, `pendingDecisions`) and `decision.resolved` (`decisions[].{toolCallId,outcome}`, `via`) reach the timeline folder (`timeline.ts:307-325`), for both the suspend → `resume` path and the inline path (`src/agent-session/session/assemble.ts:173`, `src/agent-session/session.ts:528`).
        - Whether a batch suspension with several `pendingDecisions` needs one `hitl` step per call.
        - Whether any consumer reads `hitl` step `status` today (devtools UI, `projectTraceTimeline`, timeline golden fixtures).
      - (c) **Tool effects.** Whether `agent.tools` (`ToolInfo.effects`, `src/contracts-core/agent.ts:153-160`) is reachable from every place a scorer is built (experiment, scenario, devtools), and how delegated or remote tools appear there.
      - (d) **Judge model path (plan 199).** The public way a host library makes one bounded model call:
        - a judge `Agent` from `createAgent` with `RunOptions.tools: { only: [] }` and `limits`, versus any public one-shot client
        - whether `RunResult.text` is the only output channel (there is no structured output in `RunOptions`, `src/contracts-protocol.ts:72-120`)
        - how `ModelRef` identity is read back from a run (`run.model`), so plan 199 can refuse self-judging.
      - (e) **Durable evaluation records (plan 201).** Compare two placements:
        - (i) an optional kernel capability `ProductionPersistenceStore.evaluations`, mirroring `feedback` (`src/contracts-core/persistence.ts:124-128,295-298`), with codecs in `@arnilo/prism-store-codecs` (`packages/stores/codecs/src/run-feedback.ts`) and tables in `store-sqlite` (`ddl.ts:257-280`) and `store-postgres` (`migrations.ts:45`, `persistence.ts:162-260`)
        - (ii) an evals-owned contract that the store packages implement structurally
        - The note records the written kernel-addition proof (§1.4, `references/prism.md` §1): no existing hook, slot, `PackageAPI` member, or primitive expresses it, and it is needed by at least two packages. Or it records the finding that (ii) is required.
      - (f) **Telemetry seam (plan 201).** Who constructs the observability instrumentation, and whether a host library can reach `handleEvaluation` (`packages/integrations/observability/src/instrumentation.ts:107,597-606`) through a public export, or must take a structural sink.
      - (g) **Imports (D15).** `scripts/host-surface-allowlist.json` rules for `packages/hosts/evals`; whether an optional peer dependency on `@arnilo/prism-observability` with a static dynamic import passes the host-surface gate, `packaging.test.ts`, and the install-smoke tests; the backlog entry at `plans/backlog.md:751`.
      - (h) **Statistics reuse (plan 198).** Whether `scripts/memory-bench/stats.mjs` may import `@arnilo/prism-evals` (its README isolates only the Python tooling), so McNemar has one implementation.
      - (i) **Reference host (plan 201).** Where an eval gate fits in `apps/prism-agent` (its scenarios in `src/scenarios/`, tests in `src/__tests__/`, dependencies in `package.json`), and what `reference_host_imports_only_public_surface` allows.
      - (j) **Enforcement rows.** `scripts/e2e-coverage.json:291-303` (evals suites), `examples/README.md:64-71,161`, `src/__tests__/docs.test.ts` package-README links, and the `examples_demos_run_to_completion_and_emit_no_secret` gate, which each later task extends.
    - Functional: The note ends with a verdict per plan (197–201) and per task. A finding that a later task's mechanism cannot work stops that plan for a re-cut, recorded here. One case is planned for: if (e) finds no two-package need, plan 201 Task 2 takes placement (ii) and the note says so.
    - Performance: n/a — read-only.
    - Code Quality: No code changes.
    - Security: The note records which scorer inputs carry tool arguments (`timeline: "redacted_io"`) so plans 199–200 never pass unredacted I/O to a judge model.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §1.4, §2.6, §2.8, Phase 10 and Phase 11
      - `packages/hosts/evals/` (all of `src/`), `packages/integrations/observability/src/{timeline.ts,instrumentation.ts}`, `packages/hosts/devtools/src/compare.ts`
      - the 2026-10-19 eval-system review (this plan's Objectives)
    - Options Considered:
      - Review each plan separately. Rejected: the five plans share the scorer, report, and store contracts, and a placement finding in (e) or (d) reshapes two of them.
    - Chosen Approach:
      - One read-only inventory cited by plans 197–201.
    - API Notes and Examples:
      ```bash
      timeout 60 graft callers createApprovalBeforeEffectScorer --depth all
      timeout 60 graft callers runExperiment --depth all
      ```
    - Files to Create/Edit:
      - this plan (task note only)
    - References:
      - the 2026-10-19 review; owner decision 2026-10-19
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none — review only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: The timeline records approval decisions per tool call
  - Acceptance Criteria:
    - Functional:
      - `run.suspended` adds one `hitl` step per pending decision. Each has `status: "suspended"` and `metadata.toolCallId` (and `toolName`, `guardrail` when present). A suspension with no tool call keeps today's single step.
      - `decision.resolved` sets each matching `hitl` step to `approved` or `denied` and records `metadata.via` (`inline` / `resume`). A decision with no matching step (the inline path) adds a `hitl` step with that status, ordered before the tool's execution.
      - The run step's status keeps today's behavior.
      - `ExecutionStep.status` documents the two new values.
    - Performance: One step per decision; no extra event subscription.
    - Code Quality: The change stays inside the folder's `run.suspended` / `decision.resolved` cases (`timeline.ts:307-325`). No new event kind.
    - Security: Decision steps carry ids, outcome, and `via` only — never tool arguments (the event carries none).
  - Approach:
    - Documentation Reviewed:
      - `timeline.ts:307-325`; `src/contracts-protocol.ts:253-259,330-341`; `src/contracts-run-state.ts:64-73`; Task 1 (b)
    - Options Considered:
      - Infer the outcome in the scorer from whether the tool later ran. Rejected: a denied call can still appear as a `blocked` tool step, and an approved call can fail. The decision is the evidence.
      - A new `decision` step kind. Rejected: `hitl` already names human decisions; a second kind splits one concept across two filters.
    - Chosen Approach:
      - Correlate on `toolCallId`, which both events already carry.
    - API Notes and Examples:
      ```ts
      // timeline.steps after an inline approval of call "c1"
      { kind: "hitl", status: "approved", metadata: { toolCallId: "c1", via: "inline" } }
      ```
    - Files to Create/Edit:
      - `packages/integrations/observability/src/timeline.ts`: the two cases
      - `packages/integrations/observability/src/__tests__/timeline.test.ts`: new cases
      - `packages/integrations/observability/README.md`: timeline step vocabulary
      - `CHANGELOG.md`: `## [Unreleased]`
      - tentative: devtools UI or golden timeline fixtures that render `hitl` status (Task 1 (b))
    - References:
      - Task 1 (b)
  - Test Cases to Write:
    - `timeline_hitl_step_resolves_to_denied_on_resume`: suspend, resume with `deny`; the step is `denied`. Fails if `decision.resolved` stays a run-step-only update.
    - `timeline_inline_approval_adds_approved_hitl_step`: an inline `allow` adds an `approved` step before the tool step.
    - `timeline_batch_suspension_has_one_hitl_step_per_call`: two pending decisions, two steps, each resolved independently.
    - `timeline_hitl_metadata_carries_no_arguments`: the step serializes with no argument value.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the timeline's `hitl` status vocabulary.
    - Docs pages to create/edit:
      - `packages/integrations/observability/README.md`: step kinds and statuses
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: `approval_before_effect` correlates approvals to tool calls
  - Acceptance Criteria:
    - Functional: An effect step passes only when an `approved` `hitl` step with the same `metadata.toolCallId` precedes it (`order` less than the effect's).
      - Each approval covers exactly one call.
      - Guardrail `succeeded` steps no longer count.
      - A `denied` or still-`suspended` decision fails the call.
    - Functional: Effect selection.
      - New option `tools: readonly ToolInfo[]` (normally `agent.tools`) selects calls whose `effects` include `write`, `execute`, or `external`.
      - A tool step whose name is not in `tools` counts as effectful (fail closed).
      - `toolName` keeps narrowing to one tool.
      - With neither `tools` nor `toolName`, every tool step is checked, as today.
    - Functional: `matchApproval` keeps working and receives only `hitl` steps.
    - Functional: Callers updated in the same task (Task 1 (a)): `examples/behavior-evaluation.ts`, the devtools eval-compare tests, the coding and browser eval fixtures, and `scripts/` fixtures pass `tools: agent.tools` wherever the agent registers read-only tools.
    - Functional: Sweep. A repo-wide grep over `src/ packages/ apps/ scripts/ examples/ docs/` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`) for `HITL or guardrail steps before the effect`, and for docs stating that a guardrail allow approves an effect, finds nothing.
    - Performance: Linear in steps (one id map) instead of today's quadratic filter.
    - Code Quality: The scorer is a pure function of the timeline and `tools`; it is declared `invariant: true` (Task 5).
    - Security: Unknown effects and unknown tools fail closed.
  - Approach:
    - Documentation Reviewed:
      - `trajectory.ts:509-572`; Task 2; `src/contracts-core/agent.ts:153-160`
    - Options Considered:
      - Keep the guardrail allow as an approval. Rejected: a guardrail allow is the absence of a deny, not a human decision, and it was never tied to the call it allowed.
      - Put `effects` on the `tool.started` event. Rejected: a kernel event change for a fact `agent.tools` already exposes.
    - Chosen Approach:
      - Correlate by call id from Task 2, and select effects from `ToolInfo`.
    - API Notes and Examples:
      ```ts
      createApprovalBeforeEffectScorer({ tools: agent.tools });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/trajectory.ts`
      - `packages/hosts/evals/src/__tests__/trajectory.test.ts`
      - callers from Task 1 (a): `examples/behavior-evaluation.ts`, `packages/hosts/devtools/src/__tests__/eval-compare.test.ts`, `packages/tools/coding/src/agent/__tests__/eval-fixtures.test.ts`, `packages/tools/browser/src/__tests__/eval-fixtures.test.ts`; tentative: `scripts/fixtures/e2e-*-journey.mjs` if they build this scorer
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline` (options type changed)
    - References:
      - Task 2; the review's D1
  - Test Cases to Write:
    - `approval_denied_on_resume_fails_effect`: fails today (a `suspended` step counts as approval).
    - `approval_for_other_call_does_not_cover_effect`: approval of `c1` does not cover `c2`.
    - `guardrail_allow_is_not_approval`: a `succeeded` guardrail step before an effect still fails it.
    - `inline_approved_effect_passes`: fails today (no `hitl` step existed).
    - `read_only_tool_needs_no_approval_when_tools_given`: a `read`-only tool passes without approval.
    - `unknown_tool_counts_as_effectful`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — scorer semantics and options.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`: scorer table row
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Trajectory scoring fails closed without a timeline, and `forEach` passes the step
  - Acceptance Criteria:
    - Functional:
      - `Scorer` gains `requires?: readonly ("timeline" | "trace" | "environment")[]`. Every built-in trajectory scorer declares `requires: ["timeline"]`; the citation scorer declares `["environment"]`.
      - Before any run, `runExperiment`, `runScenario`, and `scoreRun` throw `EvalError` with code `ERR_PRISM_EVAL_TIMELINE_REQUIRED` (or `_TRACE_REQUIRED` / `_ENVIRONMENT_REQUIRED`), naming the scorer, when a requirement cannot be met. Examples: `timeline: "off"` with no injected timeline; no `traceResolver`; no `toEnvironment`.
      - A scorer reached without its input anyway (a custom call) returns `0` with `metadata.invariant` set to its declared value.
      - `createErrorClassScorer` returns `0` without a timeline (D2).
    - Functional: `forEach` passes `step` in `ScorerInput`. `forEach` with zero matching steps produces one `skipped` record with reason `no matching steps`, not zero records.
    - Functional: Callers updated in the same task: every `runExperiment` / `scoreRun` / `runScenario` call that uses trajectory scorers sets `timeline` (Task 1 (a) list).
    - Performance: The requirement check runs once per call, before any agent run.
    - Code Quality: One `checkRequirements(scorers, options)` helper in `score.ts`, used by all three entry points.
    - Security: Fails closed; no scorer silently passes for lack of evidence.
  - Approach:
    - Documentation Reviewed:
      - `trajectory.ts:71,211,291,398,471,530`; `score.ts:80-150`; `experiment.ts:131-152`; `scenarios.ts:193-205`
    - Options Considered:
      - Default `timeline` to `"metadata"`. Rejected: it imports observability for every experiment, and deterministic text scorers do not need it.
      - Fix only `createErrorClassScorer`. Rejected: zero scores from a missing timeline still read as agent failures.
    - Chosen Approach:
      - Declared requirements and an up-front check, so the misconfiguration is an error and not a score.
    - API Notes and Examples:
      ```ts
      defineScorer({ id: "my_trajectory", requires: ["timeline"], score: ({ timeline, step }) => ({ score: 1 }) });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/{types.ts,scorer.ts,score.ts,experiment.ts,scenarios.ts,trajectory.ts,citations.ts,errors.ts}`
      - `packages/hosts/evals/src/__tests__/{evals,trajectory,scenarios}.test.ts`
      - callers from Task 1 (a) that omit `timeline`
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - the review's D2, D3
  - Test Cases to Write:
    - `trajectory_scorer_with_timeline_off_throws_timeline_required`
    - `error_class_without_timeline_scores_zero`: fails today (returns 1).
    - `for_each_tool_passes_step_to_scorer`: a scorer returning `step.name === "read" ? 1 : 0` gives different scores per step; fails today.
    - `for_each_without_matching_steps_records_skip`
    - `custom_scorer_without_requires_runs_without_timeline`: no false positives for plain scorers.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `Scorer.requires`, `ScorerInput.step`, new error codes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`: scorer contract and error codes
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: Invariants are declared on the scorer, and `requireInvariants` works
  - Acceptance Criteria:
    - Functional: `Scorer` gains `invariant?: boolean`.
      - Built-in hard checks declare it statically: `approval_before_effect`, `guardrail_pack`, `no_loop`, `citation_integrity`, the ERP invariant scorers, `error_class` with `deny`, and `tool_call_match` with `deny` or `invariant: true`.
      - `scoreRun` copies it onto every record as `metadata.invariant`, including `failed` records from a thrown scorer.
    - Functional: `invariantsPassed` is `false` when any invariant record is `failed`, or `scored` with a score below 1.
    - Functional: `requireInvariants: true` fails the threshold when the report has no invariant records, or when `invariantsPassed !== true`. Omitted, an invariant failure still fails (today's behavior).
    - Functional: Returning `metadata.invariant` from `score` no longer decides invariance. The built-ins stop returning it, and the sweep below confirms no caller relies on it.
    - Functional: Sweep over `src/ packages/ apps/ scripts/ examples/ docs/` (exclusions as Task 3) for `metadata: { invariant` in scorer bodies outside `packages/hosts/evals/src/` (custom invariant scorers in fixtures move to the declaration).
    - Performance: n/a — metadata only.
    - Code Quality: One source of truth (the declaration); `aggregateEvaluations` reads `record.metadata.invariant` written by `scoreRun` only.
    - Security: A crashing safety scorer fails the gate; it no longer drops out of it.
  - Approach:
    - Documentation Reviewed:
      - `experiment.ts:17-46`; `threshold.ts:15-44`; `types.ts:330-337`; `erp-invariants.ts`
    - Options Considered:
      - Keep invariance as returned metadata and treat every `failed` record as an invariant failure. Rejected: a judge timeout would then block a release as if a safety rule broke.
    - Chosen Approach:
      - Static declaration, stamped by the runner.
    - API Notes and Examples:
      ```ts
      assertEvaluationThreshold(report, { requireInvariants: true });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/{types.ts,scorer.ts,score.ts,experiment.ts,threshold.ts,trajectory.ts,citations.ts,erp-invariants.ts}`
      - `packages/hosts/evals/src/__tests__/{trajectory,evals,erp-invariants,citations}.test.ts`
      - `examples/coding-browser-evaluation.ts` (now exercises a real check)
      - fixtures found by the sweep
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - the review's D6
  - Test Cases to Write:
    - `throwing_invariant_scorer_fails_invariants`: fails today (`invariantsPassed` stays `undefined`/`true`).
    - `require_invariants_without_invariant_records_fails`: fails today (option ignored).
    - `non_invariant_failed_record_does_not_set_invariants_false`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `Scorer.invariant`, threshold semantics.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`: invariants section
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: Experiments: per-trial RNG, partial results on abort, and factory hooks
  - Acceptance Criteria:
    - Functional:
      - With `seed`, each `(itemId, trialIndex)` uses `mulberry32(hash32(seed, itemId, trialIndex))`, so sampling decisions are identical at concurrency 1 and 8. An explicit `random` keeps today's single-stream behavior and is documented as order-dependent.
      - On abort or a fatal worker error, finished items keep their results and evaluations. Unstarted items get an `error` naming the abort. `status` is `aborted` (signal) or `failed` (fatal), and `aggregate` covers only the finished items.
      - `RunExperimentOptions` gains `hooks` and `slots`, passed to the agent factory exactly as `runScenario` does. Passing them with an `Agent` instance (not a factory) throws `EvalError` `ERR_PRISM_EVAL_EXPERIMENT`.
    - Performance: No extra work per trial beyond one 32-bit hash.
    - Code Quality: `mapPool` gains an optional settle-all mode used here. It stays a single helper; no second pool.
    - Security: n/a — no new input crosses a boundary.
  - Approach:
    - Documentation Reviewed:
      - `experiment.ts:60-225`; `util.ts:91-112`; `scenarios.ts:221-245`
    - Options Considered:
      - Document that seeds need `concurrency: 1`. Rejected: reproducibility is the point of a seed.
    - Chosen Approach:
      - Derive per-trial streams, and settle the pool instead of failing it.
    - API Notes and Examples:
      ```ts
      await runExperiment({ agent: (extra) => createAgent({ ...base, ...extra }), hooks: failureInjection({ denyTools: ["write"] }), dataset, scorers, seed: 7, sampleRate: 0.5, concurrency: 8 });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/{experiment.ts,util.ts,scenarios.ts,types.ts}`
      - `packages/hosts/evals/src/__tests__/{evals,scenarios}.test.ts`
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - the review's D7, D8, D9
  - Test Cases to Write:
    - `seeded_sampling_is_identical_across_concurrency`: fails today at concurrency 8.
    - `abort_keeps_finished_item_results`: abort after two of five items; two results survive. Fails today.
    - `experiment_factory_receives_failure_injection_hooks`: a denied tool shows `blocked` in the timeline.
    - `hooks_with_agent_instance_throws`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new options and abort semantics.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7: Scenarios: bounded turns fail closed, aborted status, and per-turn scoring
  - Acceptance Criteria:
    - Functional:
      - `turns.length > maxTurns` (or over `HARD_MAX_SCENARIO_TURNS`) throws `EvalError` `ERR_PRISM_EVAL_SCENARIO_BOUNDS` before the agent is built.
      - `ScenarioResult.status` gains `aborted` (signal, or a final run with status `aborted`).
      - A failing `assertReply` stops the scenario with `status: "failed"` and `error.code` `ERR_PRISM_EVAL_SCENARIO_ASSERTION`.
      - New option `scoreTurns: "last" | "each"` (default `"last"`, today's behavior). With `"each"`, scorers run after every turn on that turn's result and timeline slice, and records carry `metadata.turnIndex`.
    - Performance: `"each"` multiplies scorer calls by the turn count; the README states it.
    - Code Quality: Per-turn timeline slices come from the folder's snapshot per turn, not a second subscription.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - `scenarios.ts:139-219`
    - Options Considered:
      - Score the concatenated transcript only. Rejected: a refusal at turn 2 that recovers at turn 4 is invisible.
    - Chosen Approach:
      - An explicit opt-in per-turn mode, with the default unchanged.
    - API Notes and Examples:
      ```ts
      await runScenario({ agent, turns, scorers, scoreTurns: "each", timeline: "metadata" });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/{scenarios.ts,errors.ts}`
      - `packages/hosts/evals/src/__tests__/{scenarios,guardrail-pack-scenarios}.test.ts`
      - `examples/guardrail-packs.ts`, `packages/hosts/devtools/src/__tests__/eval-compare.test.ts` if they read `status`
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline`
    - References:
      - the review's D10
  - Test Cases to Write:
    - `too_many_turns_throws_before_run`: fails today (silently truncated).
    - `aborted_final_run_reports_aborted`: fails today (`succeeded`).
    - `score_each_turn_records_turn_index`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`: scenarios section, cost line for `"each"`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 8: Idempotent curation
  - Acceptance Criteria:
    - Functional:
      - `datasetFromRuns` skips a run whose resulting item id already exists in `input.dataset`, with reason `already in dataset`, and still curates the rest.
      - When every candidate is skipped, the dataset and version are returned unchanged.
      - `nextVersion` appends a counter to non-numeric versions (`v1` → `v1.1` → `v1.2`), not `-2-2`.
    - Performance: One `Set` of existing ids.
    - Code Quality: The check runs before redaction and mapping cost.
    - Security: n/a — no new data path.
  - Approach:
    - Documentation Reviewed:
      - `curate.ts:115-233`
    - Options Considered:
      - Replace the existing item. Rejected: datasets are immutable versions; a changed label is a new item id or a new version by the host's choice.
    - Chosen Approach:
      - Skip with a reason, matching the other skip reasons.
    - API Notes and Examples:
      ```ts
      const { skipped } = await datasetFromRuns({ dataset, runIds: [already], store, ownership }); // [{ id, reason: "already in dataset" }]
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/curate.ts`
      - `packages/hosts/evals/src/__tests__/curate.test.ts`
      - `CHANGELOG.md`
    - References:
      - the review's D12
  - Test Cases to Write:
    - `recurating_existing_run_skips_not_throws`: fails today.
    - `non_numeric_version_increments_cleanly`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new skip reason.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`: curation section
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 9: Declared observability dependency, and a truthful README
  - Acceptance Criteria:
    - Functional:
      - `@arnilo/prism-observability` becomes an optional peer dependency of `@arnilo/prism-evals` (`peerDependencies` + `peerDependenciesMeta.optional`), loaded with a literal `await import("@arnilo/prism-observability")` in one helper (`loadTimeline()`).
      - When it is not installed and a timeline is requested, the call throws `EvalError` `ERR_PRISM_EVAL_TIMELINE_UNAVAILABLE` naming the package.
      - The three computed imports are gone (D15), and the `evals` half of `plans/backlog.md:751` is recorded as closed in the task note.
    - Functional: The README follows the host-library page structure: install, the scorer table with `requires` and `invariant`, experiments, scenarios, failure injection, curation, thresholds, errors, and the cost section. No `createComparisonJudge` (D13). The empty plan-096 heading at `trajectory.ts:574` is removed.
    - Functional: Sweep over `src/ packages/ apps/ scripts/ examples/ docs/` (exclusions as Task 3) for `createComparisonJudge` and `const pkg = "@arnilo/prism-observability"` finds nothing.
    - Performance: Observability loads only when a timeline is requested (unchanged); covered by a test.
    - Code Quality: One loader; no `as any` at the call sites (typed against the package's exported types as a type-only import).
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - `score.ts:92-100`, `experiment.ts:102-106`, `scenarios.ts:155-159`; `plans/backlog.md:745-760`; Task 1 (g)
    - Options Considered:
      - A hard dependency on observability. Rejected: hosts that score text only would install OpenTelemetry glue.
    - Chosen Approach:
      - Optional peer plus a static specifier, so bundlers and the host-surface gate see it.
    - API Notes and Examples:
      ```jsonc
      "peerDependencies": { "@arnilo/prism": ">=0.13.0 <1.0.0", "@arnilo/prism-observability": ">=0.13.0 <1.0.0" },
      "peerDependenciesMeta": { "@arnilo/prism-observability": { "optional": true } }
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/{package.json,README.md}`
      - `packages/hosts/evals/src/{score.ts,experiment.ts,scenarios.ts,trajectory.ts,errors.ts}` and a new `src/timeline.ts`
      - `packages/hosts/evals/src/__tests__/evals.test.ts`
      - `scripts/host-surface-allowlist.json` if Task 1 (g) shows it must name the peer
      - `bun.lock` (workspace install)
      - `CHANGELOG.md`
    - References:
      - the review's D13, D15
  - Test Cases to Write:
    - `timeline_unavailable_throws_named_error`: with the import stubbed to fail.
    - `text_only_experiment_does_not_load_observability`: a module-load spy stays untouched.
    - The existing install-smoke and packaging tests stay green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a peer dependency and an error code.
    - Docs pages to create/edit:
      - `packages/hosts/evals/README.md`: full rewrite to the package page structure
    - `docs/index.md` update: no — the entry sentence is unchanged.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 600 bun run typecheck`
- `timeout 600 bun run --filter @arnilo/prism-evals test`
- `timeout 600 bun run --filter @arnilo/prism-observability test`
- `timeout 600 bun run --filter @arnilo/prism-devtools test`
- `timeout 600 bun run --filter @arnilo/prism-tools-coding test && timeout 600 bun run --filter @arnilo/prism-tools-browser test`
- `timeout 300 bun examples/behavior-evaluation.ts && timeout 300 bun examples/coding-browser-evaluation.ts && timeout 300 bun examples/evaluation-gate.ts && timeout 300 bun examples/guardrail-packs.ts`
- `timeout 300 bun test --timeout=0 src/__tests__/docs.test.ts`
- `timeout 600 bun test --timeout=0 scripts/e2e-coverage.test.mjs`
- `timeout 900 bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
