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

- [x] Task 1: Phase review for plans 197–201 (read-only)
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
  - Task note (2026-10-25) — phase review of plans 197–201. Read-only; no code changed. **Verdicts at the end. No plan is blocked; three tasks need a re-cut (197 Task 2, 197 Task 3, 199 Task 2) and two need small additions (197 Task 5, 201 Task 2).**
    - **(a) Eval surface and callers.** `packages/hosts/evals/src/index.ts` exports **80 runtime values and 98 types**; `scripts/compat-baseline/arnilo__prism-evals.txt` has **155 rows** because the baseline pins every module-level declaration, including names the barrel does not export (`shouldSample:150`, `normalizeSampleRate:138`, `resolveTrialsConfig:143`, `redactEvaluationRecord`, `collectWhileRunning`, `defaultToAgentInput`, `exactOwnershipMatches`, `statusMatches`, `ownershipMatches`, `normalizePageLimit`, `pages`, `limit`, `mulberry32`). Every plan's ABI change therefore rewrites more rows than its export list suggests, and plan 201 Task 2's move of the store types *removes* rows here.
      - In-repo callers, by symbol (the plans' lists checked against `rg`):
        - `examples/evals.ts:2` — `createMemoryEvaluationStore`, `defineDataset`, `defineScorer`, `runExperiment`, `scoreRunLive`. No trajectory scorer, no `timeline`.
        - `examples/evaluation-gate.ts:2,14-15` — `assertEvaluationThreshold` with **`minimumMean`**, `defineDataset`, `defineScorer`, `runExperiment`; reads `aggregate.meanScore`.
        - `examples/behavior-evaluation.ts:3-14` — the heaviest caller: `createToolCallMatchScorer` (`:130`), `createApprovalBeforeEffectScorer` with a custom `matchApproval` (`:136-140`), `createCitationIntegrityScorer` (`:244`), `defineDataset` ×4, `defineScorer`, `failureInjection`, `failingStore`, `runExperiment` ×4, `runScenario`, `validateReleaseEvalManifest`; reads `trials.uncertaintyMethod` (`:121,270`), `aggregate.invariantsPassed` (`:145,170,183`), and returns `metadata.invariant` (`:157`).
        - `examples/coding-browser-evaluation.ts:11-21` — `assertEvaluationThreshold` (`:148,184`, both `minimumMean`), `defineDataset` ×3, `defineScorer`, `ExperimentReport`, `runExperiment`, `scoreRun`, `serializeEvaluationReport`; builds an `aggregate` literal with `meanScore`/`scoresByScorer` (`:179-180`) and returns `metadata: { invariant: true }` (`:120`).
        - `examples/guardrail-packs.ts:37` — `createGuardrailPackScorer`, `runScenario` (`timeline: "metadata"`, `:132-136`).
        - `examples/run-feedback.ts:2` — `appendEvaluationFeedback`, `createMemoryEvaluationStore`, `EvaluationRecord` (all three move in plan 201 Task 2).
        - `packages/hosts/devtools/src/compare.ts:23,46,52,121-125` — reads `aggregate.meanScore` and `aggregate.invariantsPassed` out of the report JSON; devtools `src/` does not import evals.
        - `packages/hosts/devtools/src/__tests__/eval-compare.test.ts:24-36` — imports 14 evals names; calls trajectory scorers directly with hand-built timelines (`:143-205,440-485`); `runExperiment` ×3 all set `timeline: "metadata"` (`:377,413,525`); `aggregate` literals with `meanScore` (`:84,88,112,117`); `trials.uncertaintyMethod` (`:338`).
        - `packages/tools/coding/src/agent/__tests__/eval-fixtures.test.ts:17-22` and `packages/tools/browser/src/__tests__/eval-fixtures.test.ts:19-20` — `assertEvaluationThreshold`, `defineDataset`, `defineScorer`, `ExperimentReport`, `scoreRun`, `serializeEvaluationReport` only. **They build no trajectory scorer** (`meanScore`/`scoresByScorer` literals at coding `:117-118` and browser `:68-69`; `minimumMean` at coding `:354`, browser `:359`).
        - `scripts/fixtures/e2e-070-host-completeness-journey.mjs:27-32` — `createCitationIntegrityScorer`, `defineDataset`, `defineScorer`, `failureInjection`, `runExperiment`, `validateReleaseEvalManifest`; a `toEnvironment` oracle (`:391-400`) and `trials.sampleCount` printed (`:304,632`). `scripts/fixtures/e2e-full-surface-journey.mjs:332-334` — dynamic `import("@arnilo/prism-evals")` for `createMemoryEvaluationStore` only.
        - `templates/init/optional/evals-example.ts.tmpl:2` — `defineScorer`, `scoreRun` only; it reads none of the retired fields.
        - Type-only: `packages/integrations/observability/src/timeline.ts:24` and its test (`EvaluationTrace`). `src/artifacts.ts:200` is a comment, not an import.
      - Corrections to the plans: (1) plan 197 Task 3 lists the coding/browser fixtures as `tools: agent.tools` callers — they build no trajectory scorer, so nothing to update there; the real `createApprovalBeforeEffectScorer` callers are `examples/behavior-evaluation.ts:136` and the devtools test `:172,440`. (2) `examples/behavior-evaluation.ts:136-140`'s `matchApproval` deliberately matches a **`tool`** step named `request_approval`; Task 3's “`matchApproval` receives only `hitl` steps” breaks that example (see the re-cut below). (3) plan 201 Task 2's caller list is missing `src/__tests__/install-smoke.test.ts:352` (imports and calls `createMemoryEvaluationStore`), `examples/run-feedback.ts:2`, and `scripts/fixtures/e2e-full-surface-journey.mjs:332`.
    - **(b) Approval projection (D1).** Confirmed as the plan states, with four corrections.
      - `run.suspended` (`src/contracts-protocol.ts:254-259`) carries `interruption: AgentRunInterruption` — `kind` (`tool_approval` | `input_guardrail` | `elicitation`), `reason`, optional `toolCallId`, `toolName`, `guardrail`, and `pendingDecisions[]` (`src/contracts-run-state.ts:42-73`). The folder's case (`timeline.ts:307-320`) closes the turn, sets the run step `suspended`, and adds **one** `hitl` step named `interruption.reason`, with **no metadata at all** — it never reads `toolCallId` or `pendingDecisions`.
      - `decision.resolved` (`src/contracts-protocol.ts:332-341`) carries `decisions[] = { toolCallId, outcome: "allow" | "deny" }` and `via: "inline" | "resume"`. The folder's case (`timeline.ts:322-325`) only sets the run step back to `succeeded`.
      - Inline path: `src/agent-session/session/assemble.ts:150-176` resolves each `ask` through `HostUi.request`, then emits `decision.resolved` **before** the round's tools execute, so a step added there is naturally ordered before the tool step. Suspend path: `src/agent-session/session.ts:516-534` (`continueSuspendedRun`) emits the settled batch with `via: "resume"` **before** `runInternal` re-enters the loop. `decision.pending` (`src/contracts-protocol.ts:325-331`, emitted at `src/agent-session/session/tool-round.ts:225-234`) is **ignored** by the folder (`timeline.ts:572`) — batch decisions reach it only through `run.suspended`'s `interruption.pendingDecisions`. So Task 2 must derive the per-call steps from `interruption.pendingDecisions` (falling back to `interruption.toolCallId`), not from `decision.pending`.
      - Batch need: yes — `stageAskDecisions` (`tool-round.ts:217-234`) stages one `PendingDecision` per gated call, and `suspendGatedRound` (`:236-256`) puts them all in one `run.suspended` with `toolCallId`/`toolName` set only when there is exactly one. One `hitl` step per pending decision is the only way the scorer can see call ids for a batch.
      - Correction 1: a **durable resume** folds `decision.resolved` into a *new* timeline whose prior `hitl` step does not exist (`continueSuspendedRun` is reached with a freshly constructed folder in `score.ts`/`experiment.ts`). Task 2 provides only for the inline path to add a missing step; the resume path must add one too, or a resumed run records no approval evidence at all.
      - Correction 2: `ExecutionStepStatus` (`packages/integrations/observability/src/timeline-types.ts:48`) is already `"running" | "succeeded" | "failed" | "blocked" | "skipped" | "suspended" | "denied" | "aborted"` — `denied` already exists, so only `approved` is new. `timeline-types.ts` is missing from Task 2's Files to Create/Edit.
      - Correction 3: `run.started { resumed: true }` re-emits `run:<runId>` (`timeline.ts:271-287`) and `addStep` (`:226-233`) does not dedupe, so a resumed timeline can already hold two `run` steps with one id. Task 2 does not have to fix it; recorded so the new ids are not assumed unique either.
      - Consumers of `hitl` status today: only the scorer under repair (`packages/hosts/evals/src/trajectory.ts:548-567`) and test fixtures (`trajectory.test.ts:215-250`, `devtools/…/eval-compare.test.ts:179,442-471`). `summarizeTimeline` counts `denied` only on `tool`/`guardrail` steps (`packages/integrations/observability/src/summary.ts:180-200`), so `approved`/`denied` on a `hitl` step changes no summary field; the devtools UI reads no step status. A second producer exists — `projectTraceTimeline`'s `workflow_suspended` case adds a metadata-free `hitl` step (`timeline.ts:797-807`); Task 2 leaves it alone, which is consistent (a workflow suspension has no tool call id).
    - **(c) Tool effects.** `agent.tools: readonly ToolInfo[]` (`src/contracts-core/agent.ts:232`) is built by `toolInfos` (`src/agent/views.ts:16-27`), which resolves `effects` with `resolveToolEffects` (`src/tools.ts:145-147`) — a tool with no declaration gets **all five** kinds (`src/tools.ts:103-109`), so an unannotated tool is effectful by construction and Task 3's “unknown effects count as effectful” is already the kernel default. `ToolCapabilityKind` is `"read" | "write" | "execute" | "network" | "external"` (`src/contracts-protocol.ts:471`).
      - Reachability: fine wherever the host holds an `Agent` (all examples, devtools test, plan 201's host suite). **Not** reachable in a `runExperiment({ agent: factory })` call, because the scorer is built before the factory runs (`types.ts:344-350`; `experiment.ts:102` calls it per trial). Plans 200 Task 3 and 201 Task 6 both run factories, so Task 3's `tools: readonly ToolInfo[]` needs a thunk (`() => readonly ToolInfo[]`) or the runner must put `tools` on `ScorerInput`. Recorded as a re-cut.
      - Delegated/remote: `delegate`/`delegate_*` register as `external` (`packages/integrations/delegate/src/tools.ts:6,95-97,148,178`) and appear in `agent.tools`; MCP-bridged tools register `read` or `external` (`packages/integrations/mcp/src/package.ts:184`). A child agent's own tools never appear — but child activity reaches the parent timeline as `kind: "delegation"` (`timeline.ts:475-505`), not `tool`, so the scorer cannot mis-grade them.
      - Correction: Task 3's effectful set (`write`, `execute`, `external`) omits `network`. `failureInjection` already uses `write|execute|external` plus empty effects (`packages/hosts/evals/src/failure-injection.ts:45-48`), so the omission is consistent but should be stated as a decision, not left implicit.
    - **(d) Judge model path (plan 199).**
      - A tool-less bounded session is public and sufficient: `RunOptions.tools?: { only?: readonly string[] }` with `only: []` means no tools (“Empty → no tools this run”, `src/contracts-protocol.ts:106-111`), and `RunOptions.limits?: RunLimits` (`:72-76`) narrows the agent's ceilings. There is **no** public one-shot client; `createAgent` + `session.run` is the path.
      - Output channel: `RunResult.text` is the only text channel (`src/contracts-run-state.ts:257`), and `RunOptions` has **no** structured-output/response-schema field (`src/contracts-protocol.ts:72-120`). Strict JSON + `validateJsonSchema` is the plan's only option; `validateJsonSchema` is kernel-public and already on the host-surface allow-list (`scripts/host-surface-allowlist.json`, `phase11`), so `@arnilo/prism-evals` may import it from the package root.
      - **`RunResult` carries no model field** (`src/contracts-run-state.ts:250-285`: sessionId, runId, status, leafId, text, content, message, messages, usage, limit, attribution, error, abortReason, stopReason, stopDetail, pending, runState). The plan's `run.model` does not exist. Identity is only on the config: `agent.config.model?: ModelSpec` (`src/contracts-core/agent.ts:207-208`), `ModelSpec extends ModelConfig` with `provider`/`model` (`src/contracts-core/content.ts:146-154`). So `judgeModel` and the self-judging guard must read `judgeAgent.config.model` vs the judged agent's `config.model` — available only when an `Agent` instance is passed, never through a factory. Plan 199 Task 2's “when built (if both are known then), otherwise on first use” needs a third case: never known, which requires an explicit `judgedModel`/`judgeModel` option for factory hosts.
      - Redaction: see Security below — the judge must redact its own prompt.
    - **(e) Durable evaluation records (plan 201 Task 2). Placement (i), the kernel capability, with the proof.**
      - Nothing existing expresses it. `ProductionPersistenceStore` is the only durable store contract (`src/contracts-core/persistence.ts:295-320`); it declares `feedback?: RunFeedbackStore` (`:297`) and `events?: AgentEventSource` (`:299`) and no evaluation or experiment capability. `EvaluationStore`/`EvaluationRecord`/`EvaluationQuery`/`EvaluationStatus` live in evals (`packages/hosts/evals/src/types.ts:94-148`) on top of the kernel's `PersistencePage`/`PersistenceQuery`/`OwnershipScope`. No hook, slot, `PackageAPI` member, or `RunController` primitive stores a record; evaluations are produced after a run settles, outside any session (`packages/hosts/evals/src/score.ts`).
      - Generic: the roadmap names it — “hashed datasets with a held-out split, and durable evaluation stores with telemetry” (`roadmap.md:2421`).
      - Needed by more than two packages: `@arnilo/prism-evals` (defines and uses it), `@arnilo/prism-store-codecs` (validation, caps, redaction, memory store, conformance), `@arnilo/prism-store-sqlite` and `@arnilo/prism-store-postgres` (tables + implementations), `@arnilo/prism-devtools` (reads the report aggregate).
      - The mirror is complete and cheap to copy: contract `RunFeedbackStore` (`:124-128`), codec `packages/stores/codecs/src/run-feedback.ts`, conformance `packages/stores/codecs/src/feedback-conformance.ts`, SQLite table `MIGRATION_003_RUN_FEEDBACK` (`packages/stores/sqlite/src/ddl.ts:256-280`), Postgres migration step 3 + `packages/stores/postgres/src/persistence.ts:162-260`.
      - Placement (ii) is possible but worse: it forces a local duplicate of the contract in codecs plus a two-way assignability test, and a host holding a typed `ProductionPersistenceStore` must cast to reach `evaluations`. **Verdict: (i).**
      - Cost to record: the kernel grows types only, but the pack and the root export count grow, so `scripts/budgets.json` (`kernel.rootExports` ceiling **1502**, `packedBytes` **1168983**, `unpackedBytes` **3814366**, `fileCount` **361**, `sourceLines` **39932**) and the frozen arrays in `src/__tests__/public-export-contract.test.ts` both need a deliberate update, with the delta written into the task note — as plan 201 Task 2 already provides.
      - Next free migration step: **11** (`011_evaluations`). `MIGRATION_CONTRACT.steps` currently ends at `010_session_links` (`packages/stores/codecs/src/persistence-schema.ts:685-696`), and both adapters apply that one shared contract (sqlite `src/migrations.ts:30,50-60`; postgres `src/migrations.ts:27,42`). One step number, one place.
    - **(f) Telemetry seam (plan 201 Task 4).** `handleEvaluation` exists on the instrumentation object (`packages/integrations/observability/src/instrumentation.ts:107`, body `:597-606`) and emits `gen_ai.evaluation.result` with name, status, `has_reason`, and score — no reason text.
      - The instance, however, is a **closure local**: `setup` constructs it (`packages/integrations/observability/src/index.ts:155-164`) and wires its `handleAgentEvent` to the observe hooks; nothing returns or exports it. A host that loads the package definition (`packages: [observability]`) has no handle to it.
      - `createOpenTelemetryInstrumentation` *is* exported (`index.ts:34`, type `:40-41`), so a host that builds its own instance can reach `handleEvaluation`. That makes plan 201 Task 4's structural sink (`{ handleEvaluation }`) the required mechanism, and `evaluationTelemetrySink(instrumentation)` a convenience for the self-constructed case only. `docs/index.md:174`'s “exports nothing itself” is about OpenTelemetry SDK registration, so exporting one adapter helper does not falsify it — but the sentence should be re-read when the helper lands (plan 201 Task 4 already conditions `docs/index.md` on this finding).
    - **(g) Imports (D15).**
      - The host-surface gate rejects only a *computed* dynamic specifier (`+` or a backtick, `src/__tests__/host-surface-gate.test.ts:151-158`) and non-public kernel subpaths (`:131-137`). A literal `await import("@arnilo/prism-observability")` in `packages/hosts/evals/src` passes. The current `const pkg = "@arnilo/prism-observability"; await import(pkg)` (`score.ts:95-96`, `experiment.ts:107-108`, `scenarios.ts:159-160`) also passes today — that is precisely why Task 9 is needed.
      - The allow-list needs no new entry for a non-kernel peer. It **will** need entries for the kernel type names plan 201 Task 2 moves (`EvaluationRecord`, `EvaluationStore`, …) in a `phase11`-style group, and the gate fails a group entry no host library imports (`host-surface-gate.test.ts:167-190`), so they must land with the import.
      - `packaging.test.ts`: an optional peer is explicitly tolerated (`:736-750` builds `optionalPeers` and skips them for resolution) and `:245-257` forbids only marking the `@arnilo/prism` peer optional. Keeping `@arnilo/prism-observability` a workspace `devDependency` (it already is, `packages/hosts/evals/package.json`) keeps `workspace_tree_resolves_under_bun` green.
      - `install-smoke.test.ts:352-400` composes evals from packed public imports with `defineScorer` + `scoreRun` and no timeline, so Task 4's fail-closed check does not trip it. It does call `createMemoryEvaluationStore` (`:352,:397`), so plan 201 Task 2 must update it.
      - The backlog row is at `plans/backlog.md:762-768` (“Extend the host-surface gate to prism-core reaches and computed imports”, P1, owned by plan 174 Task 6), not `:751`. Its owner already landed: computed specifiers and 0.12 family reaches are now gated (`host-surface-gate.test.ts:143-158`) and the `prism-core` reaches the entry names are gone (`rg prism-core packages/hosts/evals/src` → no hits). Only the `const pkg = …; import(pkg)` form survives, because the check tests the argument text, not the alias. Task 9 closes the real half; the note records the entry as half-stale.
    - **(h) Statistics reuse (plan 198 Task 6).** Allowed, one implementation. `scripts/memory-bench/run.mjs:8-9` already imports `@arnilo/prism` and `@arnilo/prism/provider-kit`, `injection-log.mjs:1` imports `definePackage`, `ablations.mjs:1` imports `validateJsonSchema`. The isolation sentence in `scripts/memory-bench/README.md:10-13` covers only the Python tooling (`requirements.txt`, the venv block). `@arnilo/prism-evals` resolves from the workspace like the other packages.
    - **(i) Reference host (plan 201 Task 6).** `apps/prism-agent/package.json` has no eval dependency. `reference_host_imports_only_public_surface` allows any non-private `packages/<group>/<name>` manifest with no subpath exports (`src/__tests__/reference-host-allowlist.ts:28-42`, `classify` `:69-88`), and `@arnilo/prism-evals` qualifies, so `"@arnilo/prism-evals": "workspace:*"` passes. Scenarios live in `src/scenarios/` (`approval-gates-coding.ts`, `research-citations.ts`, …), tests in `src/__tests__/`, and `test` runs `src` only.
      - Constraint found: `@arnilo/prism/testing` may be imported only under `src/__tests__/` or `src/scenarios/` (`reference-host-allowlist.ts:60-66`). So `apps/prism-agent/src/evals/suite.ts` **may not** import `mockProvider`; the scripted provider belongs in `src/scenarios/` (beside the existing scripts) or in the test. Plan 201 Task 6 must say which.
      - `apps/prism-agent/evals/` sits outside `apps/prism-agent/{src,bin}`, which is all the boundary gate scans (`reference-host-boundary.test.ts:38-50`) — fine for data, but it means the dataset is not import-gated and code there would not be checked at all.
    - **(j) Enforcement rows.**
      - `scripts/e2e-coverage.json:291-303` lists the 8 evals suites. New suites are added there; an annotated suite that does not exist fails the gate (`scripts/e2e-coverage-gate.mjs:213`), while an unlisted new test file does not.
      - `examples/README.md:55-80` is the runnable-command list and `:155-170` the per-example bullets. `src/__tests__/docs.test.ts:1310-1316` requires a `` `file.ts` `` mention for **every** `examples/*.ts`, so `eval-judges.ts` and `eval-injection.ts` need a bullet. Separately, `examples_demos_run_to_completion_and_emit_no_secret` executes a **hardcoded** `demos` array (`docs.test.ts:1483-1540`): a new example that is not added to it is compiled but never run. Both new examples must be added to that array, not just to the README.
      - `docs.test.ts:1092-1105` requires every publishable package README to name its package; `:493` requires `docs/index.md` to link each `../<dir>/README.md`. The evals README rewrite keeps both.
      - The examples gate compiles every example with the repo tsc in one program (`:1449-1471`), so an example using a new export before it lands fails the whole gate, not just its own run.
    - **Security — which scorer inputs carry tool arguments.** `ScorerInput` (`packages/hosts/evals/src/types.ts:58-67`) hands the scorer `result`, `item`, `expected`, `target`, `timeline`, `environment` **unredacted**; redaction happens only on the record that is stored (`redactEvaluationRecord`, `score.ts:38-80`). The timeline is the only policy-controlled surface: `timeline: "metadata"` makes `prepareIo` return `undefined` for every step's `input`/`output` (`packages/integrations/observability/src/timeline.ts:127-138`), so tool arguments and tool results are **absent**; `timeline: "redacted_io"` passes them through the run's redactor with a 16 KiB default per step and a 256 KiB hard cap (`timeline.ts:38-39`, `packages/integrations/observability/src/timeline.ts:127-138`). Consequences: (1) plans 199–200 must default a judge/simulator target to answer text, with `"metadata"`-equivalent timeline content, never `"redacted_io"` unless the host opted in; (2) `createRubricJudge` must apply `resolveRedactor` itself (the same helper `threshold.ts:53-54` uses) before embedding `result.text` or `item.input` in a prompt, because nothing upstream did.
  - Verdicts.
    - Plan 197 — **proceed**. Task 1 satisfied by this note. Task 2 **re-cut**: read `interruption.pendingDecisions` (not `decision.pending`), add steps for unmatched decisions on the `resume` path as well as inline, add `packages/integrations/observability/src/timeline-types.ts` to the file list, and state that only `approved` is a new status. Task 3 **re-cut**: drop the coding/browser fixtures from the caller list, add `examples/behavior-evaluation.ts`'s `matchApproval` and decide whether it keeps receiving `tool` steps or the example moves to `tools: agent.tools`, state the `network` decision, and make `tools` a thunk or a `ScorerInput` field so factory hosts (plan 200 Task 3, plan 201 Task 6) can supply it. Task 4 **proceed** — the only callers that use trajectory scorers already set `timeline` (`behavior-evaluation.ts:143,168,178`, devtools `:377,413,525`, `guardrail-packs.ts:135`); `examples/evals.ts` and `coding-browser-evaluation.ts` use no trajectory scorer, so “callers that omit `timeline`” is an empty set today and the risk is only future callers. Task 5 **proceed**, plus `DefineScorerInput.invariant` and `defineScorer` forwarding it, because `@arnilo/prism-memory-core` already documents `defineScorer({ invariant: true, … })` (`packages/memory/core/src/lineage.ts:260`, `packages/memory/fabric/src/invariants.ts:3`) and today the field is silently dropped (`scorer.ts:6-16`, `types.ts:139-143`). Task 6 **proceed** — the factory signature already accepts `{ hooks, slots }` (`types.ts:344-350`); only the call site passes `{}` (`experiment.ts:102`). Tasks 7, 8 **proceed** as written. Task 9 **proceed**, and record the closed backlog row as `plans/backlog.md:762-768`.
    - Plan 198 — **proceed**. Task 3's caller list is complete and verified (the coding/browser fixtures, both examples, the devtools compare + test, the evals tests). Two additions: `RunResult` has **no** timing field (`src/contracts-run-state.ts:250-285`), so `durationMs` must be measured around `session.run` in `runTrial` (`experiment.ts:113-125`); the timeline's `startedAt`/`finishedAt` exist only when `timeline !== "off"`. And `Usage.estimated: true` means the numbers were never priced (`src/contracts-core/content.ts:246-252`), so `costComplete` must be false for an estimated trial, not only for a missing `cost`. Task 6's `scripts/memory-bench/stats.mjs` import is allowed (h).
    - Plan 199 — **proceed**, Task 2 **re-cut**: (d) found no `run.model`. `judgeModel` and the self-judging guard must read `agent.config.model` / `judgeAgent.config.model` (`ModelSpec`), which a factory hides, so the guard needs an explicit model option and a “never known” case. Task 1's note must record the missing `RunResult.model`, that `RunOptions` has no structured output (`src/contracts-protocol.ts:72-120`), that `validateJsonSchema` is kernel-public, and the Security rule above (the judge redacts its own prompt).
    - Plan 200 — **proceed**, with Task 6's mechanism confirmed and Task 1 amended. A `tool.execute` around-hook may return a rewritten `ToolResult`: `run-controller.ts:311-338` pins only the call's name and arguments and never validates the result, and the untrusted envelope is applied later, when the result becomes a model message, from `metadata.trust === "untrusted_external"` (plan 192's finding (b)). So the injection hook must (i) keep that marker on the rewritten result and (ii) key its per-item state by `sessionId`/`callId`, exactly as `failureInjection` keys its `mutatingCallIds` set (`packages/hosts/evals/src/failure-injection.ts:36-76`). The plan's carrier-fixture fallback is not needed; `tool.result` (`run-controller.ts:340-341`) is the seam if ordering surprises. Task 1 still runs (it also inventories `defineDataset` callers: `examples/{evals,evaluation-gate,behavior-evaluation,coding-browser-evaluation}.ts`, the devtools test `:331,362,403,525`, `scripts/fixtures/e2e-070-…mjs:299,344,369,391`).
    - Plan 201 — **proceed** with placement (i). Task 1 must also record: the kernel budget delta and the `public-export-contract` freeze for the new root types, and that the next free migration step is **11** in the one shared contract. Task 2's caller list needs `src/__tests__/install-smoke.test.ts:352`, `examples/run-feedback.ts:2`, `scripts/fixtures/e2e-full-surface-journey.mjs:332`. Task 4 takes the structural sink as the mechanism (f). Task 6 must keep `mockProvider` out of `apps/prism-agent/src/evals/suite.ts` (i).
    - No plan is stopped and no whole task is invalidated. Nothing in (a)–(j) contradicts a plan's premise. The three re-cuts are seam fixes (the resume-path step, the `matchApproval`/`tools` seam, the model identity), and they are what makes the later plans' factory-based runs (200 Task 3, 201 Task 6) work at all.
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

- [x] Task 2: The timeline records approval decisions per tool call
  - Acceptance Criteria:
    - Functional:
      - `run.suspended` adds one `hitl` step per pending decision. Each has `status: "suspended"` and `metadata.toolCallId` (and `toolName`, `guardrail` when present). A suspension with no tool call keeps today's single step.
      - `decision.resolved` sets each matching `hitl` step to `approved` or `denied` and records `metadata.via` (`inline` / `resume`). A decision with no matching step (the inline path) adds a `hitl` step with that status, ordered before the tool's execution.
      - The run step's status keeps today's behavior.
      - `ExecutionStep.status` documents the two new values.
    - Performance: One step per decision; no extra event subscription.
    - Code Quality: The change stays inside the folder's `run.suspended` / `decision.resolved` cases (`timeline.ts:307-325`). No new event kind.
    - Security: Decision steps carry ids, outcome, and `via` only — never tool arguments (the event carries none).
  - Task note (2026-10-25) — done.
    - **What changed.** `packages/integrations/observability/src/timeline.ts`: `FoldState` gains `decisionSteps: Map<toolCallId, MutableStep>`; the `run.suspended` case opens one `hitl` step per pending decision with `status: "suspended"` and `metadata.{toolCallId, approvalId, toolName?, guardrail?}` (name is the decision's `scope.toolName`, falling back to `interruption.toolName`, then `interruption.reason`); the `decision.resolved` case settles each matching step to `approved`/`denied`, stamps `finishedAt`/`durationMs` and `metadata.via`, and adds a settled step (name `approval`, `durationMs: 0`) when no step matches. `packages/integrations/observability/src/timeline-types.ts`: `ExecutionStepStatus` gains `approved` with a doc comment. README timeline paragraph and `CHANGELOG.md` `## [Unreleased]` updated.
    - **Deviations from the AC text, all from Task 1 (b).**
      - Only `approved` is a new status: `denied` already existed (`timeline-types.ts:48` at the time), so the AC's “two new values” is one new value plus one documented. The doc comment names both as terminal `hitl` outcomes.
      - “A suspension with no tool call keeps today's single step” is implemented as “no pending decision carries a `toolCallId`” (elicitation and `input_guardrail` suspensions have none), because a batch of tool approvals must still produce one step per call. The legacy single step is byte-identical to the old one.
      - The unmatched-decision path covers both the inline path **and** a durable resume, where `continueSuspendedRun` folds `decision.resolved` into a fresh timeline that never saw the suspension; without it a resumed run would record no approval evidence at all.
    - **Verification.** `packages/integrations/observability/src/__tests__/timeline.test.ts` gains five tests: `timeline_hitl_step_resolves_to_denied_on_resume`, `timeline_inline_approval_adds_approved_hitl_step` (asserts the approval step precedes the tool step), `timeline_batch_suspension_has_one_hitl_step_per_call` (allow c1 + deny c2 settle independently), `timeline_hitl_metadata_carries_no_arguments` (a `full_io` timeline still holds no argument hash in a decision step), and `timeline_suspension_without_tool_call_keeps_one_hitl_step`. `bun test packages/integrations/observability/src` → 70 pass, 0 fail; `tsc -p tsconfig.json --noEmit` clean; `bun test packages/hosts/evals packages/hosts/devtools` → 105 pass (the scorer's own correlation is Task 3, so its loose `hitl` filter is untouched here).
    - **Recorded, not changed.** `summarizeTimeline` still counts only `tool`/`guardrail` `denied` steps into `blockedToolCount` (`summary.ts:180-200`), so a denied approval does not raise it. No consumer reads `hitl` status other than the evals scorer, and `projectTraceTimeline`'s `workflow_suspended` step stays metadata-free (a workflow suspension has no tool call). The devtools golden fixtures set `hitl` steps to `succeeded` directly and are unaffected. Pre-existing biome `organizeImports` findings in `timeline.ts` and `timeline.test.ts` were left alone as unrelated.
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

- [x] Task 3: `approval_before_effect` correlates approvals to tool calls
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
  - Task note (2026-10-25) — done.
    - **What changed.** `packages/hosts/evals/src/trajectory.ts`: `ApprovalBeforeEffectScorerOptions` gains `tools?: readonly ToolInfo[]`; the scorer builds one `Map<callId, ExecutionStep>` of `hitl` steps (first per call), then walks the tool steps once. An effect passes only when that call's decision step is `approved` and its `order` is lower; a `denied` decision reports the denial, a still-`suspended` one reports “still suspended”, a late approval reports both orders, and a call with no correlating decision reports “without prior approval”. `guardrail` steps no longer count. Effect selection: `toolName` narrows to that name, else `tools` filters on `write`/`execute`/`external` (a name absent from `tools` is effectful), else every `tool` step is checked. `matchApproval` keeps its role and now receives `hitl` steps only. `ToolInfo` added to the host-surface allow-list (`scripts/host-surface-allowlist.json`, `phase11`).
    - **Correlation source.** A decision step carries `metadata.toolCallId` (Task 2); a tool step encodes the same id in its `tool:<callId>` id, and a hand-built timeline may set `metadata.toolCallId` on either. `toolCallIdOf` reads the metadata first, then the id prefix, so real runs and fixtures both correlate without a kernel or timeline change.
    - **Deviations from the AC text.**
      - `invariant: true` is **not** declared on the scorer: `Scorer` has no `invariant` field until Task 5 (`packages/hosts/evals/src/types.ts:74-78`). The results already carry `metadata.invariant` as before; Task 5 adds the declaration and `defineScorer` forwarding.
      - With `matchApproval` the predicate sees every prior `hitl` step, including `denied`/`suspended` ones, because a custom correlation (a draft-revision match, say) owns the status semantics. The default path is the strict one.
      - The coding and browser eval fixtures needed no change: they build no trajectory scorer (Task 1 (a)). The real callers updated are `examples/behavior-evaluation.ts` and `packages/hosts/devtools/src/__tests__/eval-compare.test.ts`; no `scripts/` fixture builds this scorer.
    - **Caller rewrite (`examples/behavior-evaluation.ts`).** The old fixture proved approval with a `request_approval` **tool** and a `matchApproval` that looked for that tool step — exactly the inference this task removes. It now runs the real flow: `write_record` is gated by a `tool.call` hook returning `{ ask }`, a `HostUi` (`createScriptedHostUi({ confirm: true })`) answers inline, and the scorer reads the resulting `approved` hitl step from `tools: orderedAgent.tools`. The tools now declare `effects` (`request_approval` is `read`, so effect selection skips it; `write_record` and `drop_database` are `write`). Verified both ways: with `confirm: true` the invariant passes, with `confirm: false` it fails — so the pass is the approved step, not a vacuous selection. The devtools fixture correlates on call ids and gained a `c1`-does-not-cover-`c2` assertion.
    - **Verification.** `trajectory.test.ts` gains `approval_denied_on_resume_fails_effect`, `approval_for_other_call_does_not_cover_effect`, `guardrail_allow_is_not_approval`, `inline_approved_effect_passes`, `read_only_tool_needs_no_approval_when_tools_given`, `unknown_tool_counts_as_effectful`, `approval_still_suspended_fails_effect`, and an every-tool check without `tools`; the existing ordering test was updated to an `approved` step correlated by call id. `bun test packages/hosts/evals` → 75 pass; `bun test packages/hosts/devtools` → 38 pass; `bun test packages/integrations/observability/src` → 70 pass; `tsc` clean for evals and `examples`; `bun examples/behavior-evaluation.ts` prints `orderedInvariants: true`; `host-surface-gate.test.ts` → 4 pass with the new allow-list entry. The sweep for `HITL or guardrail steps before the effect` finds only this plan, and no doc claims a guardrail allow approves an effect.
    - **Baseline.** `scripts/compat-baseline/arnilo__prism-evals.txt` needs no edit: the baseline records declaration text, and `createApprovalBeforeEffectScorer(options?: ApprovalBeforeEffectScorerOptions)` is unchanged (`ApprovalBeforeEffectScorerOptions` is only a re-export clause there). `bun scripts/release.mjs gate` cannot confirm it in this tree — it fails before the compat step on unrelated in-flight work (`bun.lock` missing the two new provider packages, then a `openai-responses.ts` declaration-emit error, then the kernel byte ceilings, all from uncommitted plans 194/203/204 code). Nothing in that failure names evals or observability.
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

- [x] Task 4: Trajectory scoring fails closed without a timeline, and `forEach` passes the step
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
  - Task note (2026-10-25) — done.
    - **What changed.** `types.ts`: new `ScorerRequirement` alias, `Scorer.requires?`, `DefineScorerInput.requires?`, and `ScorerInput.step?`. `scorer.ts` forwards `requires`. `score.ts`: `checkRequirements(scorers, available)` plus `REQUIREMENT_ERRORS`; `scoreRun` calls it once after trace/timeline resolution and before any scoring; `scoreOne` passes `step`, and the `forEach` branch emits one `skipped` record per scorer with reason `no matching steps` when nothing matched. `experiment.ts` checks before the first item run and `scenarios.ts` before the first turn, each computing availability from its own options (`timeline` mode on; `traceResolver` for `trace`; `toEnvironment`/`environment`). All seven trajectory scorers in `trajectory.ts` declare `requires: ["timeline"]`, except `createSchemaScorer`, which declares it only for `target: "step"` (a result-target schema check never reads the timeline); `createCitationIntegrityScorer` declares `["environment"]`. `createErrorClassScorer` now returns `0` with `reason: "no timeline available for error class verification"` and `metadata.invariant: true` when it has no timeline (D2: it returned `1`), and the step-budget and no-loop no-timeline returns gained the same `metadata.invariant` flag.
    - **Why up front.** `runExperiment` and `runScenario` project their own timeline while running, so they cannot rely on `scoreRun`'s post-run check without paying for the whole run first. The scenario test passes `agent: {} as never` and still gets the error, proving nothing touched the agent.
    - **Deviations from the AC text.**
      - `ScorerRequirement` is not re-exported from `index.ts`, and `ExecutionStep`/`ExecutionTimeline` stay unexported as before. Users need no import (a literal `requires: ["timeline"]` is contextually typed, and `step` is inferred from `ScorerInput`), and adding type names would rewrite the whole `export type { … } from "./types.js"` clause in `scripts/compat-baseline/arnilo__prism-evals.txt` for every name in it — churn with no contract gain. The baseline is therefore unchanged: only interfaces and one conditional object spread moved, and every recorded declaration text (`defineScorer`, each scorer factory) is byte-identical.
      - “`metadata.invariant` set to its declared value” waits for Task 5's declaration: the built-in scorers already stamp `metadata.invariant: true` (or `isInvariant` for the tool-call scorer) on a missing-input return, and this task added the flag where it was missing. Nothing reads a declared value yet.
      - No caller needed the `timeline` updates the AC anticipates (Task 1 (a) finding): the coding/browser fixtures use custom `defineScorer` scorers, `examples/guardrail-packs.ts` already passes `timeline: "metadata"` to `runScenario`, and the remaining examples/fixtures score via `createErpInvariantScorers`/`defineScorer`. Verified by running all six `examples/` entry points that import `@arnilo/prism-evals`.
    - **Verification.** New tests: `evals.test.ts` gains `scorer requirements` (timeline throw for `runExperiment`/`scoreRun`/`runScenario`, agent construction count `0`, environment/trace codes, and a plain scorer needing no timeline) and `forEach` (`passes the matching step`, `records an explicit skip when no step matches`); `trajectory.test.ts` gains `error class scores zero without a timeline instead of passing`. `bun test packages/hosts/evals` → 80 pass; `bun test packages/hosts/devtools packages/tools/coding packages/tools/browser` → 755 pass; `bun test packages/integrations/observability/src` → 70 pass; `tsc -p tsconfig.json --noEmit` clean for evals; all six evals examples run clean. `bun scripts/release.mjs gate` is still blocked earlier by unrelated in-flight work in this tree (see Task 3's note). Pre-existing biome `organizeImports`/`format` findings in `experiment.ts`, `scenarios.ts`, `types.ts`, and `trajectory.test.ts` were left alone.

- [x] Task 5: Invariants are declared on the scorer, and `requireInvariants` works
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
  - Task note (2026-10-25) — done.
    - **What changed.** `types.ts`: `Scorer.invariant?`, `DefineScorerInput.invariant?`, and a rewritten `requireInvariants` doc comment. `scorer.ts` forwards the flag. `score.ts`: `scoreOne` computes `invariant = scorer.invariant === true`, puts `metadata: { ...options.metadata, invariant: true }` into the record base (so `skipped` and `failed` records carry it too) and strips any `invariant` key a scorer returns via `stripInvariant`, keeping the rest of its metadata. `threshold.ts`: `requireInvariants: true` adds `no invariant scorers evaluated` when `invariantsPassed !== true` and the failure is not already reported as `hard invariant failed` (comparison reports have no invariant records, so they fail that way too). Built-ins declare it: `createApprovalBeforeEffectScorer`, `createGuardrailPackScorer`, `createNoLoopScorer`, `createCitationIntegrityScorer`, the eight ERP scorers, `createErrorClassScorer` when `deny` is set (`deniedSet !== undefined`), and `createToolCallMatchScorer` via the existing `isInvariant` (`deny` or `invariant: true`). `createStepBudgetScorer` and `createSchemaScorer` stay non-invariant. Every built-in stopped returning `metadata.invariant`; where a return used metadata for other facts (`forbiddenTool`, `errorCode`, `rule`, `loopingTool`, `unapprovedTool`, `toolCallId`) only the `invariant` key was removed.
    - **Sweep.** `metadata: { invariant` now appears in no scorer body outside `packages/hosts/evals/src/`. Moved to the declaration: `examples/behavior-evaluation.ts`, `examples/coding-browser-evaluation.ts`, `packages/hosts/evals/src/__tests__/scenarios.test.ts`, `packages/hosts/devtools/src/__tests__/eval-compare.test.ts`, `scripts/fixtures/e2e-070-host-completeness-journey.mjs`, and the `revokedIdsAbsent`/`caseConclusionsNotProcedures` bodies in `packages/memory/core/src/lineage.ts` and `packages/memory/fabric/src/invariants.ts` (their return type no longer claims `metadata.invariant`; two memory tests dropped the now-meaningless assertion). Both bodies already documented `wrap with defineScorer({ invariant: true, … })`, which until now did not exist.
    - **Deviations from the AC text.**
      - A `skipped` invariant record (sampling) also fails the gate: `invariantsPassed` requires every invariant record to be `scored` with `1`, and a skip is not evidence the rule held. Nothing in the repo samples an invariant scorer; recording the choice here because it is fail-closed by design.
      - `aggregateEvaluations` needed no code change — its `every(status === "scored" && score === 1)` already handled a `failed` record; the defect was that a thrown scorer's record never carried the flag, which the stamping fixes. Its comment now says the flag comes only from `scoreRun`.
      - `examples/coding-browser-evaluation.ts` already asserted `invariantsPassed` on the red fixture; it now also asserts that `assertEvaluationThreshold(red, { requireInvariants: true })` throws `hard invariant failed`, so the example exercises a real gate rather than a boolean.
      - No compat-baseline edit: `Scorer`, `DefineScorerInput`, and `EvaluationThresholds` are interfaces, and every recorded declaration text is unchanged.
    - **Verification.** New tests: `evals.test.ts` `invariants` describe — `a throwing invariant scorer fails the gate and carries the flag on its failed record`, `requireInvariants fails when no invariant scorer ran` (experiment and comparison reports), `a non-invariant failed record does not set invariantsPassed false`, `a returned metadata.invariant no longer decides invariance` (stripped, other keys kept). `trajectory.test.ts` gains `hard checks declare invariance statically`. `bun test packages/hosts/evals packages/hosts/devtools packages/integrations/observability` → 193 pass; all six evals examples print clean. **Pre-existing, unrelated:** `packages/memory/fabric/src/scoped/__tests__/reviewer.test.ts` (`writes a correction as a candidate fact … a duplicate folds`) fails intermittently in a full-directory run and passes alone or on a rerun; it also fails with this task's fabric edits reverted, so the flake is in the tree, not the change. `bun scripts/release.mjs gate` is still blocked earlier by unrelated in-flight work (Task 3's note).

- [x] Task 6: Experiments: per-trial RNG, partial results on abort, and factory hooks
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
  - Task note (2026-10-26) — done.
    - **Per-trial RNG (D7).** `util.ts` gains `hash32(seed, itemId, trialIndex)`: FNV-1a over `"${itemId}\u0000${trialIndex}"` seeded with `seed | 0`. `runExperiment` derives `options.random ?? (options.seed !== undefined ? mulberry32(hash32(seed, item.id, trialIndex)) : undefined)` inside `runTrial`, so each `(itemId, trialIndex)` has its own stream and the shared-stream `random` const is gone. An explicit `random` still shares one stream across concurrent trials — documented on the field as order-dependent. One 32-bit hash per trial; nothing else added to the hot path.
    - **Abort keeps finished work (D8).** `mapPool` gained a fifth parameter `settle?: (item, index, error) => R`. Without it behavior is unchanged (first abort/worker error rejects). With it, an abort fills every not-yet-claimed index with `settle(item, index, abortReason)` and returns instead of throwing, and a worker throw settles that one slot; the fill loop runs synchronously with no `await` between reading `next` and claiming the rest, so two runners cannot both claim the tail. Still one helper, no second pool. `runExperiment` passes `(item, _index, error) => ({ item, evaluations: [], error: toErrorInfo(error) })`, which preserves `items` length and order, keeps finished `result`/`evaluations`, names the abort on unstarted items, and leaves `status` as `aborted` (signal) or `failed` (fatal). The `catch` around `mapPool` stays as a defensive path only.
    - **Factory hooks (D9).** `RunExperimentOptions` gains `hooks`/`slots`, and `runTrial` calls `options.agent({ hooks, slots })` exactly as `runScenario` does. Passing either with an `Agent` instance throws `EvalError` `ERR_PRISM_EVAL_EXPERIMENT` up front (before any trial runs) rather than being silently ignored.
    - **Deviations from the AC text.**
      - `aggregate.itemCount` stays `items.length` (the pinned dataset size) rather than the finished count; every other aggregate field (`scoredCount`, `skippedCount`, `failedCount`, `meanScore`, `scoresByScorer`, `invariantsPassed`) is computed from `evaluations`, which only exist for finished items, so "covers only the finished items" holds for the metrics. Adding a `finishedCount` field would be new API nobody asked for.
      - `experiment_factory_receives_failure_injection_hooks` cannot assert "a denied tool shows `blocked` in the timeline": a `tool.call` hook deny short-circuits in `dispatchOne` before `tool.started`/`tool.completed`, so the kernel emits no timeline step for it (only effect-level denial and approval rejection replay produce `blocked` steps). The test instead proves the injection reached the factory-built agent by `ran === 0` plus the transcript `hook_denied` tool_result, and documents the gap in the test body and CHANGELOG.
    - **Verification.** New tests in `scenarios.test.ts`: `seeded_sampling_is_identical_across_concurrency` (12 items × 2 trials, `sampleRate: 0.5`, `seed: 7`, concurrency 1 vs 8, asserting identical sorted `itemId#trialIndex:sampled` sets plus both outcomes present), `abort_keeps_finished_item_results` (5 items, concurrency 1, abort inside `onItem` after two; asserts `aborted`, 2 surviving results, 2 evaluations, `scoredCount: 2`, and `/stop now/` on the three unstarted items), `experiment_factory_receives_failure_injection_hooks`, `hooks_with_agent_instance_throws` (both `hooks` and `slots`). Both "fails today" claims were confirmed by temporarily restoring the old behavior: shared-stream RNG breaks the seed test, and a throwing `mapPool` abort breaks the abort test (0 surviving results). `bun test packages/hosts/evals packages/hosts/devtools packages/integrations/observability packages/tools/browser/.../eval-fixtures packages/tools/coding/.../eval-fixtures` → 201 pass; `packages/hosts/evals` alone 89 pass; `src/__tests__/docs.test.ts` 64 pass; the evals examples still print clean.
    - **Baseline.** `scripts/compat-baseline/arnilo__prism-evals.txt` updated for `mapPool`'s new optional `settle` parameter (source-compatible) and now also records `hash32`; the same `--update-baseline` run also regenerated four other packages' baselines and picked up pre-existing drift there (`@arnilo/prism-context-engineering`, `-memory-observational`, `-provider-openrouter`, `-tools-web`, `@arnilo/prism`, plus a missing `-provider-openai-codex` baseline), which belongs to other in-flight work and was reverted, leaving only the evals baseline changed. `bun scripts/release.mjs gate` therefore still fails on that unrelated work (missing openai-codex baseline and the removed/changed exports in memory-observational, provider-openrouter, tools-web) and on the kernel byte ceilings (+2963 packed / +8507 unpacked, which include this CHANGELOG entry and `scripts/budgets.json` already touched by plan 204); rebaselining another plan's budget file was left to its owner.

- [x] Task 7: Scenarios: bounded turns fail closed, aborted status, and per-turn scoring
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
  - Task note (2026-10-26) — done.
    - **Bounded turns fail closed (D10).** `runScenario` no longer does `turns.slice(0, maxTurns)`. A `maxTurns` that is not an integer in `[1, 32]`, or `turns.length > maxTurns`, throws `EvalError` `ERR_PRISM_EVAL_SCENARIO_BOUNDS` from the options block — before `checkRequirements`, before the agent factory is called, before any session exists. The default stays `DEFAULT_MAX_SCENARIO_TURNS` (8), so an unconfigured scenario with 9+ turns now fails instead of running 8.
    - **`aborted` status.** `ScenarioResult.status` is `"succeeded" | "failed" | "aborted"`. Aborted wins over `failed` (matching `runExperiment`'s precedence): a host signal, or a final run the agent itself reported as `"aborted"`. Previously both paths reported `"succeeded"` unless the run status was exactly `"failed"`.
    - **Assertion failures get a code.** A throwing `assertReply` is wrapped in `EvalError(`turn ${n} assertReply failed: …`, "ERR_PRISM_EVAL_SCENARIO_ASSERTION", { cause })`, so `scenarioError.code` carries the assertion code instead of the bare error's absent code, the message names the turn, and the loop stops (the failing turn still counts in `turnsCompleted`, later turns never run).
    - **Per-turn scoring.** New `scoreTurns: "last" | "each"` on `ScenarioDefinition` (so both `runScenario(options)` and `runScenario(scenario, factory)` accept it). `"each"` scores inside the turn loop right after `assertReply`, against `folder.snapshot()` minus the steps already scored (`steps: snapshot.steps.slice(scoredSteps)`, cumulative count tracked per turn — the folder snapshots cumulatively and there is still one subscription per turn, no second one), and passes `metadata: { turnIndex: turnsCompleted - 1 }`. The report's `evaluations` become the concatenation of per-turn records; `"last"` keeps the existing single score of the final result against the whole timeline. Shared logic is one local `score(result, timeline, turnIndex?)` helper. Scorers are not run twice in `"each"` mode.
    - **Deviations from the AC text.**
      - The per-turn timeline is the snapshot's step slice with the snapshot's own `runId`/`status`/`usage` fields retained rather than a freshly built single-turn timeline: `ExecutionTimeline` requires those fields and rebuilding them per turn would need a second folder/projection. A slice is exactly the steps that turn added, which is what a per-turn scorer reads.
      - `metadata` is only `{ turnIndex }` (`ScenarioDefinition` has no `metadata` option to merge), and `scoreTurns: "each"` records no `turnIndex` when there are no scorers (nothing runs).
    - **Verification.** New tests: `scenarios.test.ts` — `too_many_turns_throws_before_run` (3 turns / `maxTurns: 2` and `maxTurns: 33`, both `ERR_PRISM_EVAL_SCENARIO_BOUNDS`, factory never called), `aborted_final_run_reports_aborted` (agent-reported abort, and a pre-aborted host signal with `turnsCompleted: 0`), `assertReply_failure_stops_scenario_with_code` (`ERR_PRISM_EVAL_SCENARIO_ASSERTION`, `/turn 2 assertReply failed/`, 2 of 3 turns ran), `score_each_turn_records_turn_index` (3 records with `turnIndex` 0/1/2 vs 1 record without it in `"last"`); `guardrail-pack-scenarios.test.ts` — `scoreTurns: each keeps a turn-1 pack denial that the final turn would mask` (two destructive turns under the `destructive-commands` pack: nothing executed, two records `[0, 0]`, versus one record in `"last"`). `too_many_turns_throws_before_run` and `aborted_final_run_reports_aborted` were confirmed to fail against the old behavior (the abort case was re-run with the old status expression: `"succeeded"` vs `"aborted"`). Suites: `packages/hosts/evals packages/hosts/devtools packages/integrations/observability` → 202 pass; evals alone 94 pass; `examples/guardrail-packs.ts`, `evaluation-gate.ts`, `behavior-evaluation.ts` still print clean; `tsc` and biome clean.
    - **Baseline.** No new compat-baseline entry: `ScenarioResult` and `RunScenarioOptions`/`ScenarioDefinition` changes are interface declarations, which the baseline records by name only. The file still carries Task 6's `mapPool`/`hash32` change. `bun scripts/release.mjs gate` fails only on the same unrelated in-flight items recorded in the Task 6 note (other packages' unmirrored API changes, the missing openai-codex baseline, and the kernel byte ceilings, which now include this CHANGELOG entry).

- [x] Task 8: Idempotent curation
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
  - Task note (2026-10-26) — done.
    - **Idempotent curation (D12).** `datasetFromRuns` builds one `Set` of `input.dataset.items.map((item) => item.id)` right after the target map is resolved, and filters the ordered `[runId, sessionId]` list through it before the feedback query, trace resolution, redaction, and `toItem` — a repeat sweep therefore costs one set lookup per run and pushes `{ id, reason: "already in dataset" }` without touching the store. The same set is consulted again in the append loop for the mapped item id (a custom `toItem` can return any id), so one pass cannot add a duplicate of an earlier item in the same pass either; `seen` grows as items are added. Both paths report the same reason, so the skip shape matches the other reasons.
    - **Unchanged on all-skip.** No new code was needed: `added.length === 0` already returned `{ dataset: input.dataset, version: input.dataset.version, added: 0, skipped }`, and the tests now pin that it is the *same object* and the same version string.
    - **`nextVersion`.** Numeric versions still increment (`1` → `2`). Non-numeric labels keep their prefix and count in a trailing `.N`: `/^(.*?)(?:\.(\d+))?$/`, so `v1` → `v1.1` → `v1.2`, `v1.9` → `v1.10`, and `2026-10-26` → `2026-10-26.1`. The old `-2-2` suffix is gone. (A dotted numeric label like `1.5` therefore increments its trailing counter to `1.6` rather than being treated as a float — the label is treated as a prefix plus counter, which is what the AC asks for.)
    - **Deviations from the AC text.** None of substance. The pre-redaction check keys on the run id and the post-mapping check keys on the resulting item id; the AC's "before redaction and mapping cost" covers the common case (default `toItem` keys by run id), and the second check is what makes the guarantee true for custom mappers rather than only fast.
    - **Verification.** New tests in `curate.test.ts`: `recurating_existing_run_skips_not_throws` (one of two runs already curated: `added: 1`, `version: "3"` → `"4"`, existing label untouched, no duplicate id, skip reason `already in dataset`), `recurating only existing runs leaves dataset and version unchanged` (`result.dataset === before`, `version: "3"`, `added: 0`), `skips a custom toItem id that collides with an existing item` (`id: "shared"` mapped from a fresh run is skipped, dataset object unchanged), `non_numeric_version_increments_cleanly` (`v1` → `v1.1`, `v1.1` → `v1.2`, `v1.9` → `v1.10`, `2026-10-26` → `2026-10-26.1`, `1` → `2`). All four were confirmed to fail with `curate.ts` stashed (8 pass / 4 fail before, 12 pass after). Suites: `packages/hosts/evals packages/hosts/devtools packages/integrations/observability` → 206 pass; `src/__tests__/docs.test.ts` 64 pass; `tsc` and biome clean.
    - **Baseline.** No compat-baseline change: `datasetFromRuns`, `CurateResult`, and `CurationSkip` signatures are unchanged (only behavior and the version-label format changed), and the new skip reason is a string value, not a type. `bun scripts/release.mjs gate` still fails only on the unrelated in-flight items recorded in the Task 6 note.

- [x] Task 9: Declared observability dependency, and a truthful README
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
  - Task note (2026-10-26) — done.
    - **Optional peer (D15).** `packages/hosts/evals/package.json` now declares `@arnilo/prism-observability` in `peerDependencies` (`>=0.13.0 <1.0.0`) with `peerDependenciesMeta["@arnilo/prism-observability"].optional = true`; the `file:` devDependency stays so the package's own tests can project timelines. `bun.lock` records the peer plus `optionalPeers` for the evals workspace entry only — the same `bun install` also regenerated workspace entries for other in-flight packages (`prism-context-engineering`, `provider-openai-codex`, `provider-openrouter`, `tools-web`), which were hand-reverted out of the lockfile as not this plan's.
    - **One loader.** New `src/timeline.ts`: `loadTimeline()` returns `{ createTimelineFolder, projectTraceTimeline }` typed as `Pick<typeof import("@arnilo/prism-observability"), …>` — a type-only reference, so nothing is imported at module load — and performs the actual `await import("@arnilo/prism-observability")` with a literal specifier. A rejected import is mapped to `EvalError` `ERR_PRISM_EVAL_TIMELINE_UNAVAILABLE` whose message names the package and whose `cause` keeps the resolution error. The module-level importer is a one-line test seam (`setTimelineImporterForTests`, not exported from `index.ts`, so no public surface or compat-baseline change); production resets to the literal import. `score.ts`, `experiment.ts`, and `scenarios.ts` now call it and no longer hold a computed specifier or `as any`. Loading stays lazy: only the `timeline !== "off"` branches call it.
    - **README rewrite (D13).** `packages/hosts/evals/README.md` follows the host-library page structure: Install (required vs optional peer, with the `ERR_PRISM_EVAL_TIMELINE_UNAVAILABLE` behavior), Datasets, a Scorer table with `requires` and `invariant` per built-in, hard invariants, Experiments, Multi-turn scenarios, Failure injection, Curation, Thresholds and reports, an Errors table of the real codes, and Cost/security/failure behavior. `createComparisonJudge` is gone (it never existed in code). `trajectory.ts`'s empty plan-096 heading is removed.
    - **Sweep.** `grep -rn "createComparisonJudge|const pkg = \"@arnilo/prism-observability\"" src packages apps scripts examples docs` (excluding `node_modules` and `docs/_evidence`) returns nothing; no `prism-core` specifier remains in `packages/hosts/evals/src` either.
    - **Backlog close.** `plans/backlog.md`'s "Extend the host-surface gate to prism-core reaches and computed imports" entry gained a `Partial close (plan 197 Task 9)` line: the evals half is done (no `prism-core` reach, one literal dynamic import), the gate half — rejecting computed specifiers and `prism-core` reaches at the gate — remains open with `ag-ui` as the remaining reach.
    - **Verification.** New tests in `evals.test.ts`: `timeline_unavailable_throws_named_error` (seam throws → `ERR_PRISM_EVAL_TIMELINE_UNAVAILABLE`, message names the package, `cause` preserved; `runExperiment` with `timeline: "metadata"` reports `status: "failed"` with that code on the item, because `runExperiment` settles a worker failure into the report rather than rejecting), `text_only_experiment_does_not_load_observability` (a text-only `runExperiment` and `scoreRun` never call the importer), `timeline_request_loads_observability_once_per_run` (a timeline run does, and the projection still scores). The second is the AC's module-load spy, expressed as an importer counter instead of a global `mock.module` so it cannot leak into other test files. Suites: `packages/hosts/evals packages/hosts/devtools packages/integrations/observability` + both eval fixture suites → 213 pass; evals alone 101 pass; `scripts/packaging-current.test.mjs` 146 pass; `src/__tests__/host-surface-gate.test.ts` 4 pass (the allowlist needed no new entry: observability is a public package reached by a literal dynamic import); all five evals examples print clean; `tsc` and biome clean.
    - **Unrelated tree state observed, not touched.** `src/__tests__/docs.test.ts` now fails two cases (`docs/next` exists on disk, created at 02:10 by concurrent work; docs index navigation drift), `src/__tests__/packaging.test.ts` fails five provider-workspace cases, and `scripts/live-doc-check.test.mjs` fails on a stale `docs/live-testing.md` — all from other in-flight plans, none reachable from this task's diff. `docs/_evidence/phase54-package-map.md` was regenerated with `bun scripts/phase54-package-map.mjs` because `scripts/phase54-package-map.test.mjs` compares it to the tree and this package's export count moved (162 → 168); that regeneration also carries the same other-plan drift (kernel, context-engineering, openrouter counts), so it should be regenerated again by whoever lands those.

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

- **`forEach` without a matching step emits skipped records instead of nothing.** The plan asked for the step to reach the scorer; emitting one `skipped` record per scorer is what keeps "no steps" from reading as "no failures". Measurement code that counted records per step sees one extra record per scorer on empty turns.
- **`aggregate.itemCount` still reports the pinned dataset size** after an abort (Task 6). Every other aggregate field is computed from evaluations only, so the metrics cover finished work, but `itemCount` is not a finished count and no `finishedCount` field was added.
- **A `tool.call` hook denial is not observable as a `blocked` timeline step.** The kernel short-circuits before `tool.started`/`tool.completed`, so the injection test asserts the denial through `ran === 0` and the transcript instead of the timeline.
- **Per-turn scenario scoring keeps the snapshot's own `runId`/`status`/`usage`** and slices only `steps`; a freshly projected single-turn timeline would need a second folder. `metadata` on a per-turn record is `{ turnIndex }` only, since scenarios have no metadata option to merge.
- **Curation treats a version label as prefix + trailing counter**, so a dotted numeric label (`1.5`) increments to `1.6` rather than being parsed as a float.
- **`ERR_PRISM_EVAL_TIMELINE_UNAVAILABLE` surfaces inside an experiment report, not as a rejection**: `runExperiment` settles a worker failure into `status: "failed"` with the code on the item, which is the existing experiment contract. Callers must read `items[].error`, as with any other per-item failure.
- **The optional peer is also a devDependency** so this package's own tests can project timelines; the `evals` workspace lock entry records both the optional peer and the `file:` dev link.
- **`docs/_evidence/phase54-package-map.md` was regenerated with other plans' drift in it** (kernel, context-engineering, openrouter counts) because that evidence file is tree-wide and this plan's export count moved.
- **The whole-plan gate still fails** on unrelated in-flight work: other packages' unmirrored API changes and missing baselines, `docs/next` and the docs navigation drift, the provider-workspace packaging cases, a stale `docs/live-testing.md`, and the kernel byte/file ceilings now shared with concurrent kernel edits.

## Further Actions

- **Done in this plan (follow-up landed 2026-10-26): the host-surface gate half of `plans/backlog.md`'s computed-import entry.** Priority P1, now closed. `src/__tests__/host-surface-gate.test.ts` replaced its `+`/backtick heuristic with a rule on the import argument itself: every dynamic `import()` must carry a string literal (`DYNAMIC_IMPORT_CALL`/`LITERAL_SPECIFIER`), so a specifier bound to a variable — the only way to hide a reach from a literal-specifier scan — fails with `uses a computed import specifier: import(<arg>)`. The one justified case, a module path the host receives at runtime, needs a `// host-gate: <reason>` comment on the import's line or the line above, and a marker with no reason is not a marker (both asserted in the fixture tree). Two call sites use it: `packages/hosts/remote/src/testing.ts` (caller-supplied conformance factory module) and `packages/hosts/remote/src/testing-fixtures/serve-stdio.ts` (CLI argument). `@arnilo/prism-core` keeps its name check plus the whole-text literal check, so a variable-bound retired-family specifier still fails twice. Tree state: the new rule flags nothing beyond the two marked lines; `src/__tests__/host-surface-gate.test.ts` 4 pass, `packages/hosts/remote` 77 pass, biome clean. `plans/backlog.md` records the entry as `Closed (plan 197 Task 9 and its follow-up)`.

- **Done in this plan (follow-up landed 2026-10-26): the scorer/judge redaction seam.** Priority P1, closed. `ScorerInput.redactor` is the entry point's resolved redactor (`scoreRun`, `runExperiment`, and `runScenario` resolve `redactor`/`secrets` once and hand it to every scorer, per step and per turn), so a scorer that sends text out of the process has one place to redact instead of each one inventing its own. `createModelJudge` uses it on the target and the dataset item before the `maxInputBytes` check and before `options.judge` runs, so a secret in the run text or in `item.input` no longer reaches a judge prompt (new test proves it fails without the redaction, and that `secrets` reaches the seam the same way as a redactor instance; with neither configured the seam is `undefined`). `RunScenarioOptions` gains `secrets`, which it was missing, so scenario scorers see the same seam as experiment scorers. Plans 199 and 200 now name the seam in their security criteria (rubric judge, pairwise/position swap, panel inheritance, user simulator, state-match diff) instead of leaving redaction to be reinvented per judge. README "Redaction" bullet and the changelog state that scorer inputs stay raw and the seam is the prompt boundary.

- **Done in this plan (2026-10-26): the kernel artifact-diet rebaseline.** Priority P1, the three metrics this item named. `scripts/budgets.json` `kernel.packedBytes` 1168983 → 1189274, `kernel.unpackedBytes` 3814366 → 3874436, `kernel.fileCount` 361 → 366, all at the measured values, and `kernel.sourceLines` ratchets down 39932 → 39922 because the same pack measured ten lines fewer (`kernel.rootExports` stays at 1502, measured exactly at the ceiling). Composition is recorded in each reason: no dependency and no provider package changed; the five new packed files are `docs/next/{hooks,loop,packages,slots,tools}.md`, the tree also carries three new kernel src modules (`src/agent-session/context-overflow.ts`, `src/loop/request-draft.ts`, `src/provider-kit/codecs/openai-responses.ts`, the last already inside the prior count), and the byte growth is those pages plus 42 modified kernel src files and 16 modified shipped docs pages from concurrent in-flight plans in this shared worktree. This plan's own packed share is its CHANGELOG entries — no kernel source. Scale check recorded with it: a detached worktree at committed HEAD packs 1139230 / 3710120 / 356, so the ceilings cover uncommitted working-tree growth whose owning plans still owe their attribution. Verified with `bun test scripts/budget-gate.test.mjs`: "root tarball stays within the artifact diet budget" (the root and kernel rows) passes. Still red in that file, and not touched here because they are different metrics owned by the plans that grew them: `exportCounts` for `@arnilo/prism` (measured 1502 vs 1453), `@arnilo/prism-mcp` (149 vs 139) and `@arnilo/prism-channels` (139 vs 106) — the kernel's public compat baseline is unchanged in the tree, so that +49 is src-wide internal/test names, not barrel growth — and the `nonNullAssertions` allowlist rows, which no longer match `biome.json`'s overrides.

1. **Record `finishedCount` (or rename `itemCount`) in `ExperimentAggregate`.** Priority P3. It is the one aggregate field that does not follow the "finished items only" rule after an abort, and the mismatch will confuse a host that reads `itemCount` as "what I have results for".
2. **Consider a kernel-visible `blocked` step for hook denials.** Priority P3. `failureInjection` cannot show up in a timeline today, so a trajectory scorer cannot distinguish "the model never tried" from "the host hook refused" without reading the transcript.
3. **Reconsider `scoreTurns: "each"` cost guardrails.** Priority P3. The mode multiplies scorer and judge calls by turn count with no cap; a scenario with 8 turns and a model judge is 8× the spend of the default. A per-scenario scorer budget would make that explicit.
