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

- [x] Task 1: Entry check (read-only)
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


  - Notes (executed 2026-10-26):
    - **Prerequisites:** Plans 198 and 199 each have all seven implementation tasks checked. Their final Task 7 notes record passing typecheck, evals suites, examples and coverage, but explicitly retain whole-plan release blockers: docs navigation/promotion, observability peer range, missing OpenAI Codex/OpenRouter lock entries, unrelated compatibility drift and kernel size budgets; plan 198 also records coding timing and memory-benchmark failures. This entry check confirms implementation completion, not green release sign-off. Plan 199's reusable tool-less session exists at `packages/hosts/evals/src/rubric-judge.ts:55-72` (`tools: { only: [] }`, one turn, fresh session closed in `finally`); it is private today, so Task 4 must share/extract it internally. Reviewed roadmap Phase 11's evaluation-rigor scope, `docs/hooks.md`, plan 192 Task 2 and `failure-injection.ts`.
    - **Injection seam and policy order:** `src/loop/run-controller.ts:290-355` awaits the `tool.execute` around-chain, then passes its returned result through `tool.result`. A handler can `await next(payload)` and return a copied `ToolResult` with amended `content`/`value`, preserving call identity, errors and metadata. Wrap-only forbids changing the name or arguments passed to `next`, not rewriting the returned result. Higher-priority around-handlers are outermost (return paths unwind in reverse); equal priorities follow registration order (`docs/hooks.md:13-30`). Approval (`packages/policy/approval/src/index.ts:164`) and guardrail input rules (`packages/policy/guardrail-packs/src/index.ts:112`) run on `tool.call` before execution; both register at default priority 0, so their relative order follows registration/load order, not a fixed approval-first rule. All decisions are collected, deny wins, and argument rewrites are gated again. Guardrail output observers run on `tool.result` (`guardrail-packs/src/index.ts:145-173`), after injection, and therefore see the rewritten result.
    - **Envelope/fallback decision:** `src/input.ts:55-74,404-418` constructs the envelope during tool-result message conversion, after the around-chain and output transforms. For successful results with `metadata.trust === "untrusted_external"`, nonempty text content wins over structured `value`; otherwise the body is JSON of `value`. Closing tags are neutralized. Task 6 can use the proposed hook: the payload will land inside the same envelope as real page text, provided the hook preserves the trust marker. The carrier-fixture fallback is **not required** by envelope order. Skip error results; do not inject only into `value` when text content is present, since the model would not see it. Preserve existing non-text blocks.
    - **Carrier inventory:**
      - `web_fetch`: `packages/tools/web/src/tools.ts:65-105,149-162` and `obscura/web.ts:174-207,408-422`. Normal result has `content: [{ type: "text", text: pagingHeader + markdown }]`, structured `value` containing document citation fields plus `{ markdown, offset, end, totalChars, truncated, nextOffset? }` (`slice.ts:17-25,91-104`), and `metadata: { trust: "untrusted_external", source: value.url }`. Configured prompt mode instead returns answer text with `value: { url, title?, answer, inputChars, sourceTruncated, usage? }`. Amend the displayed text and corresponding markdown/answer field for consistent views, preserving citation/paging metadata.
      - `read`: `packages/tools/coding/src/agent/read.ts:497-715`. Text files return line-numbered `content` with optional continuation notices, no `value`, and `metadata: { truncation, scannedBytes }`; document extraction returns text with `metadata.document`; image reads return a status text block plus an image and `metadata.image`. File contents are an injection carrier, but this tool **does not set the untrusted trust marker**, so its current text reaches the model without the web envelope. Task 6 must preserve that real behavior and use text-file fixtures, not silently add a marker or append attacks to image status text.
      - `browser_snapshot`: `packages/tools/browser/src/tools.ts:202-233`. Text is a header (`snapshotId`, `pageId`, URL, title, ref count and truncation) followed by `ariaSnapshot`; `value` is `{ snapshotId, pageId, url, title, ariaSnapshot, refCount, truncated, truncatedBy? }` (`types.ts:83-92`). Metadata contains the untrusted marker plus snapshot/page ids and truncation, without `source`. Modify the text and `value.ariaSnapshot` together; retain ids and metadata.
    - **Complete dataset caller inventory:** Ran `timeout 60s graft callers defineDataset --depth all` and cross-checked with `graft grep "defineDataset"`. The 18 caller files are (the graph’s 19 covered files include the definition):
      - Production: `packages/hosts/evals/src/curate.ts` (`datasetFromRuns`, line 248) and `erp-invariants.ts` (`erpInvariantDataset`, line 93).
      - Examples: `examples/{behavior-evaluation,coding-browser-evaluation,eval-judges,evals,evaluation-gate}.ts`.
      - Evals tests: `packages/hosts/evals/src/__tests__/{calibration,citations,curate,evals,judges,scenarios,trajectory}.test.ts`; includes local `curate`, `report` and `accountingReport` helpers.
      - Other suites: `packages/hosts/devtools/src/__tests__/eval-compare.test.ts`, `packages/tools/browser/src/__tests__/eval-fixtures.test.ts`, `packages/tools/coding/src/agent/__tests__/eval-fixtures.test.ts`.
      - Script fixture: `scripts/fixtures/e2e-070-host-completeness-journey.mjs`.
      - The exhaustive search additionally finds the definition, public re-export in `evals/src/index.ts`, and an ERP freeze-test comment, not extra callers. Task 2 must preserve the ERP frozen dataset and curated-item serialization/equality checks as well as the example/fixture callers; no dataset golden was regenerated during this check.
    - **Later-task findings:** Task 2's proposed shared canonical JSON helper does not exist yet: plan 199 currently hashes a fixed-shape `JSON.stringify` rubric payload in `rubric-judge.ts:105-110`; assess hash compatibility when sharing it. Task 6's cost formula is correct, but its prose count is not: four attacks with one carrier give **5** runs per task/trial, and with all three carriers give **13**. These are implementation follow-ups, not changes made by this read-only task.
    - **Verification/scope:** Existing envelope, tool-gate and hook-invariant suites passed: `timeout 120s bun test src/__tests__/tool-result-content.test.ts src/__tests__/tool-gate-integrity.test.ts src/__tests__/hook-invariants.test.ts` — **35 passed, 0 failed**. Only this plan's Task 1 checkbox/note changed; no source, tests, fixtures, config, exports, dependencies or baselines changed. Full typecheck/build/release gates were not rerun for this documentation-only inventory; inherited failures above remain unverified here.

- [x] Task 2: Dataset hygiene: content hash, splits, tags, label provenance, and canary
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
      - `packages/hosts/evals/src/{dataset.ts,types.ts,util.ts,experiment.ts,scenarios.ts,curate.ts,compare-experiments.ts,errors.ts,rubric-judge.ts,index.ts}`; existing `threshold.ts` serialization carries the report canary without changes
      - `packages/hosts/evals/src/__tests__/{evals,curate,compare-experiments,scenarios,judges}.test.ts`
      - `packages/hosts/devtools/src/__tests__/eval-compare.test.ts`: release manifest fixture
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

  - Notes (executed 2026-10-27):
    - **Implementation:** `defineDataset` clones and deeply freezes JSON items, computes one `sha256:` hash over canonical items in order, and validates splits, tags, label provenance, and canary bounds. Canonical object keys sort recursively; undefined object fields drop and undefined array slots become null (standard JSON). Functions, symbols, bigint, cycles, non-finite numbers, and non-JSON objects fail as `EvalDatasetError` (`not serializable`). Dataset id/version/metadata/canary are outside the item hash; item metadata is included. The shared `util.ts` canonical helper also hashes rubric payloads; historical rubric hashes change and must be regenerated, documented in the README/changelog.
    - **Execution/reporting:** Experiments filter one/multiple splits, reject any selected heldout item unless `allowHeldout === true` with an `EvalDatasetError` carrying `ERR_PRISM_EVAL_HELDOUT`, and report the full dataset hash, requested split, and canary. Unassigned items run with no filter and are omitted by an explicit filter. Tag groups reuse all per-scorer statistics; duplicate tags count once, untagged items remain in the overall aggregate, and grouping scans results once. Paired comparisons reject differing hashes (including a hash missing on one side); external score-only reports with no hash on either side retain their prior behavior. Optional tag comparisons apply BH across all tag/scorer pairs, separately from overall scorer tests; tags with fewer than two paired items are omitted. Prototype-named tags are handled safely.
    - **Provenance/canary/manifests:** Curation stamps `human` when feedback metadata supplied `expected`, otherwise `curated`, preserving dataset metadata, existing labels, and canary. Canary appears in dataset metadata and the normal serialized report; existing redaction/byte caps remain active. Release manifests require a well-formed SHA-256 content hash and optionally match it against a report. Updated release-manifest fixtures and the behavior example/evidence writer. The host-journey counting-session stub lacked `subscribe` after the earlier event-accounting changes; added the same empty async generator already used in the behavior example so its three trials execute. No persisted dataset golden required regeneration; serialization/equality, ERP freeze, browser/coding fixtures, and all caller compilation checks pass.
    - **Tests written first:** The initial focused run had 79 passing / 10 failing tests before implementation. Final affected suites: `timeout 180s bun test packages/hosts/evals/src/__tests__ packages/hosts/devtools/src/__tests__/eval-compare.test.ts packages/tools/browser/src/__tests__/eval-fixtures.test.ts packages/tools/coding/src/agent/__tests__/eval-fixtures.test.ts` — **218 passed, 0 failed**. Covers a fixed canonical-hash vector, key order/undefined equivalence, item changes and order, immutable snapshots, invalid JSON/hygiene fields, heldout/split selection, tag partitioning and BH, prototype tags, release hash requirements/mismatch, curated provenance, and canary preservation/searchability. `timeout 600s bun run typecheck` passed (including core build, workspaces, and examples). All five dataset examples (`evals`, `evaluation-gate`, `eval-judges`, `behavior-evaluation`, `coding-browser-evaluation`) passed; the host-completeness journey passed both directly and in a packed consumer. Task-touched files pass `git diff --check`; an existing extra EOF blank line in `src/contracts-core/resources.ts` remains outside this task.
    - **Compatibility baseline:** Ran `timeout 600s bun scripts/release.mjs gate --update-baseline`, then regenerated only evals with `--package @arnilo/prism-evals --skip-tarball` after putting `Split` in its own type re-export to avoid churn in the grouped exports. Evals baseline diff against HEAD is **52 insertions / 4 deletions**, no removed symbols. Task-specific surface delta:
      ```diff
      +Split                     export type { Split } from "./types.js"
      +canonicalJson             export declare function canonicalJson(value: unknown): string
      +validateSplit             export declare function validateSplit(value: unknown): asserts value is Split
      -validateReleaseEvalManifest(manifest: EvalManifest): void
      +validateReleaseEvalManifest(manifest: EvalManifest, report?: ExperimentReport): void
      ```
      The remaining additions and changes (`collectWhileRunning`, `mapPool`, `resolveTrialsConfig`) reflect inherited plans 197–199 work, not removals introduced here. The broad regeneration also refreshes inherited context-engineering, observational-memory, provider, web, and kernel surfaces; no underlying unrelated implementation was edited. No names/errors were retired, so no retirement sweep was needed; release-manifest call sites were searched across source/packages/apps/scripts/examples and updated.
    - **Broader checks remain blocked outside Task 2:** Both baseline generation and a subsequent `timeout 600s bun scripts/release.mjs gate` report the inherited observability peer-range check and missing OpenAI Codex/OpenRouter lock entries; the full gate also reports kernel packed bytes 1,191,356 > 1,189,274 and unpacked bytes 3,879,874 > 3,874,436. No compatibility mismatch is reported after regeneration. Docs/coverage checks: **70 passed / 2 failed**, the previously recorded docs navigation and unpromoted `docs/next` failures. Packed full-surface checks: **4 passed / 1 failed**; the host-completeness section passes, while the separate general journey still asserts the old context-engineering fold text (`Tool result lookup ...` versus current `[folded: ...]`). These unrelated checks were left unchanged; this note does not claim whole-plan release sign-off. Tasks 3–6 remain unexecuted.

- [x] Task 3: Scenarios as dataset items
  - Acceptance Criteria:
    - Functional:
      - `DatasetItem.input` may be `ScenarioInput = { kind: "scenario"; turns?: readonly (string | ScenarioTurn)[]; user?: UserSimulatorSpec; maxTurns?; scoreTurns? }`, with exactly one of `turns` / `user`. Task 3 executes scripted turns; simulated-user execution belongs to Task 4 and fails closed until then.
      - `runExperiment` runs such items through the scenario runner, with the experiment's agent factory, `hooks`, `slots`, `timeline`, `toEnvironment`, and `trials`.
      - Evaluations carry `itemId` and `trialIndex` (and `turnIndex` with `scoreTurns: "each"`), so plan 198's statistics apply unchanged.
      - A scenario item on an `Agent` instance (not a factory) runs, but each trial gets a fresh session.
    - Functional: `runScenario` keeps its standalone signature. Both entry points share one internal `executeScenario`, so there is no duplicated turn loop.
    - Performance: Same cost as running the scenarios one by one.
    - Code Quality: The scenario code moves into `scenario-runner.ts`. `scenarios.ts` keeps the manifest and trials helpers, or they move with the task note naming them; no export changes name.
    - Security: The redactor and ownership options apply per turn, as in `runScenario` — `redactor`/`secrets` resolve into `ScorerInput.redactor`, which is the seam plan 197 landed.
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

  - Notes (executed 2026-10-27):
    - **Implementation:** Moved standalone scenario definitions, bounds, event collection and execution into `scenario-runner.ts`; `scenarios.ts` retains manifest/trials helpers and re-exports every existing scenario name. Both entry points use one internal `executeScenario` turn loop. Experiments recognize `kind: "scenario"` before input conversion, validate selected items before constructing agents, and reuse the existing factory/session/trial/scoring/storage/statistics pipeline. Each trial opens a fresh session with either an agent instance or factory. Factory hooks/slots, run options, ownership, signal, timeline, scorer redactor/secrets and environment callbacks are forwarded. Non-completed runs stop subsequent turns; scenario errors fail the report.
    - **Records/accounting:** Default scoring uses the final result and cumulative timeline; `scoreTurns: "each"` scores each result with only its new timeline steps and a post-turn environment snapshot. Records retain dataset/item/experiment identity, `trialIndex` (also for a scenario with implicit one trial), and optional `turnIndex`. Trial duration excludes scoring and sums scenario runs; usage sums all runs, with billing complete only when every run and observed provider turn has complete, consistent pricing and settlement evidence. Single-run usage retains its existing shape.
    - **Task 4 handoff:** Exported `ScenarioInput` as an exclusive turns/user union and JSON `UserSimulatorSpec` (`persona`, `goal`, optional `maxTurns`/`stop`). User-only inputs fail with `ERR_PRISM_EVAL_USER_SIMULATOR` until Task 4 supplies simulator execution; both/neither sources fail with `ERR_PRISM_EVAL_SCENARIO_BOUNDS`. The acceptance wording now states this sequencing explicitly. Dataset items remain JSON snapshots: callback assertions are standalone-only. No simulator model calls or injection/state-grading work was added.
    - **Verification:** Wrote the three requested regressions first and observed all three fail on the original implementation. Added integration coverage for instance sessions/final scoring, factory option forwarding, timeline slices, summed pricing, invalid bounds/modes, failed-run stopping, ownership/run options and the secrets-to-scorer redactor seam. Final `timeout 600s bun run --filter @arnilo/prism-evals test`: **208 passed, 0 failed** across 12 files. `timeout 600s bun run typecheck`: **passed**, including its core build. `timeout 300s bun examples/behavior-evaluation.ts`: **passed**. Changed tracked files pass `git diff --check`.
    - **Exports/baseline:** Ran `timeout 900s bun scripts/release.mjs gate --update-baseline`, then `timeout 900s bun scripts/release.mjs gate`. The compatibility baseline regenerated with no subsequent compatibility mismatch. Task-local additions (no removals) are:
      ```diff
      +ScenarioInput export type { ScenarioInput, UserSimulatorSpec } from "./types.js"
      +UserSimulatorSpec export type { ScenarioInput, UserSimulatorSpec } from "./types.js"
      +executeScenario(options: Pick<ScenarioDefinition, "turns" | "signal">, run: (input: string | Message) => Promise<RunResult>, onTurn: (result: RunResult, turnIndex: number) => Promise<void>): Promise<void>
      +isScenarioInput(input: unknown): input is ScenarioInput
      +validateScenario(options: { turns?: readonly (string | ScenarioTurn)[]; user?: unknown; maxTurns?: number; scoreTurns?: string }): void
      ```
      The last three are internal module exports included by the surface scanner, not root API re-exports. Existing scenario root exports and signatures remain intact. README/changelog explain dataset scenarios, cost, JSON restrictions and the Task 4 boundary; no dependencies, config or golden fixtures changed. No retired names/errors require a retirement sweep.
    - **Inherited release blockers:** Both gate runs still report the observability peer-range check, missing OpenAI Codex/OpenRouter lock entries, and kernel size budgets (packed **1,191,472 > 1,189,274**, unpacked **3,880,229 > 3,874,436**). These are outside this host-library task and were left unchanged. This is Task 3 completion, not whole-plan release sign-off; whole-plan docs/coverage/injection-example verification remains for the later tasks.

- [x] Task 4: `createUserSimulator`
  - Acceptance Criteria:
    - Functional: `createUserSimulator({ agent, persona, goal, maxTurns = 8, stop = "###DONE###", timeoutMs = 30000 })` returns a `UserSimulator`, usable as `ScenarioInput.user` or `runScenario({ user })`.
      - Each turn runs one tool-less session (plan 199's `runJudgeSession` base) that sees the persona, the goal, and the conversation so far (the agent's replies as text).
      - It replies with the next user message, or the stop token.
      - It never sees `item.expected`, the environment, or tool I/O.
      - The scenario ends on the stop token, `maxTurns`, or an agent run that is not `completed`.
      - `ScenarioResult.simulation = { turns, stopReason: "goal_reached" | "max_turns" | "agent_stopped", simulatorModel }`.
    - Functional: The simulator's own failures (bad output, timeout) end the scenario with `status: "failed"` and `ERR_PRISM_EVAL_USER_SIMULATOR`. They are not counted as an agent failure in scorer records, which are `skipped` with that reason.
    - Performance: One simulator model call per turn; stated in the README with the default `maxTurns`.
    - Code Quality: The simulator prompt is a versioned constant, like plan 199's templates.
    - Security: The simulator agent runs with `tools: { only: [] }`. The agent's replies reach the simulator redacted, through `ScorerInput.redactor` (the seam plan 197 landed) — not the stored record, which is redacted separately.
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
      - `packages/hosts/evals/src/{user-simulator.ts (new),toolless-session.ts (new),scenario-runner.ts,experiment.ts,dataset.ts,rubric-judge.ts,score.ts,types.ts,index.ts}`; existing `EvalError` carries the simulator error code without a new error class
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

  - Notes (executed 2026-10-27):
    - **Implementation:** Added `createUserSimulator`, `UserSimulator`/`UserSimulation`, and a versioned prompt with a SHA-256 snapshot test. Standalone scenarios and experiment trials use the existing shared turn loop for scripted and simulated input. Each simulated proposal opens a fresh session through the tool-less session base extracted from plan 199's private `runJudgeSession`; judge behavior and cleanup remain unchanged. Simulator calls use `tools: { only: [] }`, one model turn/provider attempt, no continuations, and session closure in `finally`. Defaults are eight agent turns, `###DONE###`, and 30 seconds per proposal; hard ceilings are 32 turns, 300 seconds, 1 MiB prompt, and 16 KiB reply. The stop token is normalized and compared to the trimmed whole reply. Target non-completion stops further proposals; an initial stop records a completed, zero-agent-run trial.
    - **Privacy/recording:** Only persona, goal, stop token, and user/assistant text enter simulator prompts. Expected answers, environment state, timelines, and tool I/O are never passed. Conversation text uses the same resolved `redactor`/`secrets` seam as `ScorerInput.redactor` before leaving the process; recorded simulation turns are also redacted. Standalone results and experiment trial entries carry turns, stop reason, and simulator provider/model. Target-agent usage/duration accounting remains separate from the additional simulator model calls, documented in the README.
    - **JSON/runtime binding:** Dataset JSON constraints require a small additional seam in `dataset.ts`: simulator specs include model identity but keep their host-owned Agent in a weak map outside serialization/hashing; `defineDataset` transfers that binding to its immutable JSON clone. This avoids embedding an Agent, credentials, functions, or a global strong-reference registry in dataset items. Deserialized specs must be rebuilt with `createUserSimulator({ ...savedUser, agent })` before `defineDataset`; unbound specs fail closed. This limitation and host disposal responsibility are documented. Future derived datasets (Task 6) should retain the original bound `input.user` when passing items to `defineDataset`.
    - **Failure/scoring:** Empty/oversized output, non-completed simulator runs, and simulator timeouts produce a generic `ERR_PRISM_EVAL_USER_SIMULATOR` error without provider error text. Both entry points skip all configured scorers with that reason, including failure before the first target run; experiment skips retain item/trial identity, ownership, redaction, and storage. Simulated per-turn scoring is deferred until simulation ends, retaining each target result, timeline slice, and environment snapshot, so a later simulator failure cannot leave misleading agent scores in storage. Genuine target-agent failures still receive normal scoring. External cancellation retains aborted semantics.
    - **Tests/verification:** Wrote the four requested stop/bounds/privacy/failure regressions first and observed the missing-export failure before implementation. Expanded the suite to 12 tests covering recorded conversation, repeated trials, expected/environment exclusion, redaction, last/each skip behavior, stored skips before the first agent run, target suspension, initial stop, timeout/closure, configuration/cancellation/unbound specs, versioned template, per-turn environment/identity, and an attempted tool call that cannot execute. Final `timeout 600s bun run --filter @arnilo/prism-evals test`: **220 passed, 0 failed** (13 files). `timeout 600s bun run typecheck`: **passed**, including core build. `timeout 600s bun test --timeout=0 scripts/e2e-coverage.test.mjs`: **8 passed, 0 failed**. `timeout 300s bun examples/behavior-evaluation.ts`: **passed**. Changed tracked task files pass `git diff --check`. README, changelog, and coverage manifest updated; no dependencies or golden fixtures added. No names/errors/config were retired, so no retirement sweep applies.
    - **Compatibility:** Ran `timeout 900s bun scripts/release.mjs gate --update-baseline`, followed by `timeout 900s bun scripts/release.mjs gate`; the second run reports no compatibility mismatch. The task-local surface delta is below (other existing baseline changes belong to earlier work). The simulator type export grouping changes existing `ScenarioInput`/`UserSimulatorSpec` declaration text without removing either name. Internal module exports are included by the surface scanner but are not root API re-exports:
      ```diff
      +UserSimulator
      +UserSimulation
      +createUserSimulator(options: UserSimulatorSpec & { readonly agent: Agent }): UserSimulator
      +USER_SIMULATOR_TEMPLATE_VERSION = "1"
      +USER_SIMULATOR_TEMPLATE                 // internal prompt snapshot
      +copySimulatorBinding(source: object, target: object): void
      +requireSimulator(user: UserSimulatorSpec): UserSimulator
      +nextSimulatedUser(user, turns, redactor?, signal?): Promise<string>
      +simulatorError(): EvalError
      +runToollessSession(agent, prompt, signal, timeoutMs): Promise<string>
      +skipScorers(options, reason): Promise<EvaluationRecord[]>
      -executeScenario(options: Pick<ScenarioDefinition, "turns" | "signal">, run, onTurn): Promise<void>
      +executeScenario(options: Pick<ScenarioDefinition, "turns" | "user" | "maxTurns" | "signal" | "redactor" | "secrets">, run, onTurn): Promise<UserSimulation | undefined>
      ```
      `executeScenario` is the existing shared internal loop, extended in place; the previously private `runJudgeSession` moved to the internal tool-less module rather than retaining an alias. No root API export was removed.
    - **Inherited blockers/remaining scope:** Both release gates still fail the observability peer-range check, missing OpenAI Codex/OpenRouter lock entries, and kernel budgets (packed **1,191,567 > 1,189,274**, unpacked **3,880,583 > 3,874,436**). The docs suite finishes **62 passed, 2 failed**, on the already-recorded `docs/next/hooks.md` navigation and unpromoted `docs/next` directory. These are outside this host-library task and remain unchanged. No live providers were called. Tasks 5–6 and whole-plan sign-off remain unchecked; this note completes only Task 4.

- [x] Task 5: `createStateMatchScorer`
  - Acceptance Criteria:
    - Functional: `createStateMatchScorer({ id?, expected: unknown | ((item) => unknown), select?: (environment) => unknown, mode: "exact" | "subset", ignore?: readonly string[] /* JSON pointers */, invariant?: boolean })`:
      - It declares `requires: ["environment"]`.
      - It scores 1 when the selected state equals the expected state (`exact`), or contains it (`subset`: every expected key or array index present and equal, recursively), after removing `ignore` pointers. Arrays retain order and duplicates; ignored indices are removed without reindexing. Otherwise it scores 0.
      - On a mismatch, `metadata.diff` lists at most 32 `{ path, expected, actual }` entries, values truncated to 256 bytes and redacted.
    - Performance: Linear in the state size; state over 1 MiB fails the record (`ERR_PRISM_EVAL_STATE_BOUNDS`).
    - Code Quality: A pure structural comparison in `state-match.ts`; no deep-equal dependency.
    - Security: The diff passes the record redactor, and the expected/actual values it compares come from `ScorerInput.redactor`-redacted state — the seam plan 197 landed.
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
      - `packages/hosts/evals/src/{state-match.ts (new),index.ts,score.ts}`; preserve the bounds error code in failed scoring records
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

  - Notes (executed 2026-10-27):
    - **Implementation:** Added the public `createStateMatchScorer` and `StateMatchScorerOptions` in the evals host library, with literal/per-item goals, environment selection, exact/subset structural comparison, and optional invariant declarations. Subsets compare object keys and array indices recursively, preserving array order and duplicates. JSON-pointer ignores support escaped tokens, nested keys, array slots without reindexing, and the root pointer. Comparisons use own keys, including prototype-named JSON keys, and never mutate caller state. No dependencies, kernel, host wiring, fixtures, or configuration were added.
    - **Bounds/redaction:** Each selected actual and expected JSON snapshot is capped at 1 MiB before and after `ScorerInput.redactor` redaction, before ignores. Comparison uses the redacted snapshots, so secrets hidden by redaction are intentionally equivalent. Non-serializable states fail instead of matching lossy JSON. Mismatches return up to 32 JSON-pointer diff entries, each expected/actual value bounded to 256 serialized UTF-8 bytes without splitting Unicode; normal record redaction also applies. Missing values are `undefined`. Added a narrow `score.ts` exception so `ERR_PRISM_EVAL_STATE_BOUNDS` survives as the failed record's error code; existing error handling is otherwise unchanged.
    - **Proof:** Wrote the initial eight tests first and confirmed the missing public export failed the suite before implementation. Added invalid-state regression coverage with the validation. Final evals suite: **229 passed, 0 failed**, including all **9** state-match tests. Full `timeout 600s bun run typecheck` passed (including core build); a final evals-only typecheck also passed. `timeout 600s bun test --timeout=0 scripts/e2e-coverage.test.mjs`: **8 passed, 0 failed**. Registered the suite, added the README scorer row/semantics/security/bounds documentation, and updated the changelog. The first concurrent suite run hit the existing bootstrap timing assertion; the rerun passed unchanged.
    - **Compatibility:** Ran `bun scripts/release.mjs gate --update-baseline`. This task adds exactly the following evals baseline rows, with no removals attributable to Task 5 (the remaining 68 additions/4 removals against HEAD belong to earlier evals work):
      ```diff
      +StateMatchScorerOptions export type { StateMatchScorerOptions } from "./state-match.js"
      +createStateMatchScorer export declare function createStateMatchScorer<TInput = unknown, TExpected = unknown>(options: StateMatchScorerOptions<TInput, TExpected>): Scorer<TInput, TExpected>
      ```
      A non-updating scoped check (`timeout 120s bun scripts/release.mjs gate --package @arnilo/prism-evals --skip-tarball`) reported **no evals compatibility drift**; it still exits 1 for the inherited observability peer range and missing OpenAI Codex/OpenRouter lock entries.
    - **Wider checks:** The full baseline-update release gate completed and exits 1 for the same range/lock blockers plus inherited kernel size ceilings: packed 1,191,672 vs 1,189,274 bytes; unpacked 3,880,864 vs 3,874,436 bytes. Docs suite: **61 passed, 3 failed** — existing `docs/next/hooks.md` navigation and `docs/next` promotion failures, plus the examples test's 60-second timeout. These remain outside Task 5; no release-readiness claim is made. Task 6 and whole-plan verification remain pending. No names/errors were retired, so a retirement sweep is not applicable.

- [x] Task 6: Prompt-injection suite
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
    - Performance: Runs = tasks × (1 + attacks × carriers) × trials; stated in the README, with the default set at 5 runs per task per trial for one carrier, or 13 for all three.
    - Code Quality: The hook reuses `failure-injection.ts`'s registrar pattern; the suite is a thin layer over `runExperiment`.
    - Security:
      - Payloads are inert text.
      - The exfiltration goal URL uses a reserved `.invalid` domain, which cannot identify a public destination. Network-free execution uses sandboxed/in-memory tools; the domain alone does not prevent DNS activity.
      - The README says to run the suite against sandboxed tools only.
  - Approach:
    - Documentation Reviewed:
      - Debenedetti et al. 2024 (AgentDojo: utility, utility under attack, targeted attack success; the important-instructions attack); Zhan et al. 2024 (InjecAgent: direct-harm and exfiltration goals); Greshake et al. 2023 (indirect prompt injection, arXiv 2302.12173); `failure-injection.ts`; Task 1
    - Options Considered:
      - Vendor AgentDojo's suites. Rejected: Python-only environments, and the license and maintenance cost of copying them. The metrics and attack families are reproduced, not the data.
      - Attack success from a model judge. Rejected: goal checks on tool calls and arguments are deterministic and cheaper.
    - Chosen Approach:
      - Hook-based injection at the carrier tool, deterministic goal checks, and AgentDojo's three metrics.
      - Experiment factories receive the current item in addition to hooks/slots; each item/trial installs its own immutable injection spec, preserving concurrent execution.
      - Require `redacted_io` timelines because metadata mode omits arguments. Utility rates use the scorer's pass threshold; Wilson intervals count completed, fully scored item-trials and expose missing evidence.
    - API Notes and Examples:
      ```ts
      const dataset = createInjectionDataset({ id: "inj", tasks, carriers: [{ tool: "web_fetch" }] });
      const { utilityUnderAttack, attackSuccessRate } = await runInjectionSuite({ agent: factory, dataset, utility: taskScorer, trials: 3, timeline: "redacted_io" });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/{injection.ts (new),experiment.ts,index.ts,types.ts}`; reuse the registrar pattern without changing `failure-injection.ts`
      - `packages/hosts/evals/src/__tests__/injection.test.ts` (new); `scripts/e2e-coverage.json`
      - `examples/eval-injection.ts` (new); `examples/README.md`
      - `packages/hosts/evals/README.md`; `CHANGELOG.md`; `plans/{README.md,backlog.md}` for completion/status handoff
      - `scripts/compat-baseline/arnilo__prism-evals.txt` via `bun scripts/release.mjs gate --update-baseline --package @arnilo/prism-evals`
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

  - Notes (executed 2026-10-27):
    - **Implementation:** Added `createInjectionDataset`, `injectionHooks`, `runInjectionSuite`, the four original frozen `BUILTIN_INJECTION_ATTACKS`, and typed attacks/carriers/specs/rates/options. Dataset generation preserves task input/expected/split/labels/tags, crosses tasks with attacks/carriers, adds benign copies, and applies existing immutable JSON/hash/tag/item validation. Injection metadata includes the payload and goal so the dataset hash pins the attack. Benign specs have null attack/carrier. Invalid/duplicate attacks and invalid carrier positions fail before execution.
    - **Isolation/seam:** Extended only the evals host library's experiment factory context with the current `item`. Existing hooks/slots callers remain compatible. The suite wraps the factory with an item-local hook per trial, including concurrent trials; no shared mutable current-item pointer and no kernel changes. Existing hooks compose normally. Hooks preserve call identity, errors, trust/citation/paging metadata and non-text blocks; text and corresponding markdown/answer/ariaSnapshot fields change together. Error/image-only results and image/document reads are skipped. Web/browser injections remain inside the existing untrusted envelope; text-file reads retain their current trust behavior. `failure-injection.ts` needed no edit.
    - **Metrics/limits:** The built-in non-invariant `attack_success` scorer matches all supplied goal conditions; tool/argument conditions must match one call after the first carrier call. The suite selects `redacted_io` (and its existing optional observability peer), rejecting metadata/off since those omit arguments. Utility is a pass proportion at the scorer threshold, not a mean fractional score. Overall, per-attack and per-carrier rates include Wilson 95% bounds, denominator, successes and missing trials; absent evidence leaves rate/CI unavailable. Incomplete/failed/skipped trials do not become measured successes or failures. Groups share the benign baseline. README documents sandboxing, attempted-call semantics, redaction, factory disposal, correlated-trial limitations and cost: 5 runs with one carrier or 13 with three per task/trial. No model judge, dependency, host wiring or golden fixture added.
    - **Proof:** Wrote the regression suite first and observed the missing-export failure. Final `timeout 600s bun run --filter @arnilo/prism-evals test`: **236 passed, 0 failed**, including **7** injection tests covering crossing, benign isolation, all three carrier shapes, prepend/append, error/image skipping, reserved URL, concurrent item/trial isolation, existing hook composition, envelope placement, exfiltration arguments, rates/CIs and missing evidence. Full `timeout 600s bun run typecheck` **passed**, including core build and examples. Both `examples/eval-injection.ts` and `examples/behavior-evaluation.ts` **passed**. The injection mock deliberately falls for ignore_previous only: benign utility **1**, attacked utility **0.75**, attack success **0.25**. `scripts/examples-execution.test.mjs`: **3 passed**, including all 44 spawned examples. Combined docs/coverage run: **70 passed / 2 failed** (coverage's 8 tests pass; docs' 62 pass/2 fail are inherited navigation/promotion failures). Changed tracked task files pass `git diff --check`.
    - **Compatibility:** Ran `timeout 900s bun scripts/release.mjs gate --update-baseline --package @arnilo/prism-evals`, then the full non-updating `timeout 900s bun scripts/release.mjs gate`. No subsequent compatibility mismatch. Task-local baseline delta is exactly the ten additions below; no removed exports. Existing baseline changes against HEAD predate this task:
      ```diff
      +BUILTIN_INJECTION_ATTACKS
      +InjectionAttack
      +InjectionCarrier
      +InjectionSpec
      +InjectionRate
      +InjectionMetrics
      +RunInjectionSuiteOptions
      +createInjectionDataset
      +injectionHooks
      +runInjectionSuite
      ```
    - **Whole-plan status:** All six implementation tasks are complete. Release sign-off remains blocked by existing observability peer-range validation, missing OpenAI Codex/OpenRouter lock entries, kernel budgets (packed **1,191,787 > 1,189,274**, unpacked **3,881,203 > 3,874,436**), `docs/next/hooks.md` navigation and unpromoted `docs/next`. These are not relaxed or changed here. The plan index and backlog record this status. No names/errors/config were retired, so no retirement sweep applies. No live providers or real network tools were used.

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 600 bun run typecheck`
- `timeout 600 bun run --filter @arnilo/prism-evals test`
- `timeout 300 bun examples/eval-injection.ts && timeout 300 bun examples/behavior-evaluation.ts`
- `timeout 300 bun test --timeout=0 src/__tests__/docs.test.ts`
- `timeout 600 bun test --timeout=0 scripts/e2e-coverage.test.mjs`
- `timeout 900 bun scripts/release.mjs gate`

## Compromises Made

- **P2 — Plan 200 whole-plan verification remains blocked:** All six implementation tasks and their focused checks pass; inherited docs promotion/navigation and release peer/lock/kernel-size failures remain. Task completion does not establish release readiness. Recorded in plans/backlog.md.

## Further Actions

- **P2 — Restore plan 200 whole-plan verification:** Resolve the inherited blockers listed in Task 6's execution note and rerun the whole-plan commands before release sign-off. Recorded in plans/backlog.md.
