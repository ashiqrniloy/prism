# Family Token Table Freeze and Budget Provenance Single Source

Release: **post-0.10.0** (the 0.11.0 line), recorded from plan [103](103-Usage-Estimation-And-Context-Meter-Follow-Ups.md)'s Further Actions. Plan 103 shipped the calibration rows, `TurnBudgets.inputTokensSource`, the snapshot-keyed meter cache, `usageEstimation: "strict"`, and the exact-measurement seam. This plan takes the two of its four follow-ups that do **not** need a host to ask for them — a mutable ratio table that silently changes token accounting, and a provenance contract stated on two pages that already drifted once — and has Task 1 record the demand evidence that keeps the other two gated (barrel promotion of the seam helpers, and detection of post-budget request mutations). Task 1 runs first; Tasks 2 and 3 are independent of each other.

## Objectives

- Close the mutable-ratio hazard in `MODEL_FAMILY_TOKENS`. Today the exported table is not frozen at either layer: mutating a nested row (`anthropic.charsPerToken: 3.7 → 99`) silently turns a 370-character prose estimate from 100 tokens into 4, and replacing the row makes every estimate `NaN` — no error, no warning, and the numbers feed usage records and run limits. `Readonly<Record<...>>` is a type, not a runtime guarantee, and a shallow `Object.freeze(table)` is not enough because the rows are nested objects. The fix is a deep freeze (per-row plus table) with a test that fails when either layer is missed.
- Give each provenance fact one owning page. `docs/agent-events.md:L199-L207` and `docs/runs-and-usage.md:L85-L97` both explain `budgets.inputTokensSource`; plan 103 Task 2 had to edit the two in lockstep, which is the drift this follow-up predicted. The event page keeps the payload shape and the two-value meaning; the runs-and-usage page owns what produces each value, and each links to the other.
- Keep the demand-gated remainder honest with recorded evidence: `resolveHostTokenEstimator`/`estimateRequestExtrasTokens` have exactly one in-tree consumer (the usage seam itself), and the report path under-counts by a measured 19.2% when a post-budget stage appends to the request (0% in the no-mutation control). Both stay recorded in plan 103 instead of becoming tasks nobody asked for.

## Expected Outcome

- `Object.isFrozen(MODEL_FAMILY_TOKENS)` is `true` and `Object.isFrozen(MODEL_FAMILY_TOKENS[family])` is `true` for every family; a strict-mode write attempt throws `TypeError` and leaves the estimate unchanged, and a whole-row replacement attempt cannot produce `NaN`.
- A test pins the deep freeze: removing the per-row `Object.freeze` (keeping only the table-level one) fails the suite, which is the shallow-freeze mistake the review demonstrates.
- Estimator output is byte-identical to today for a pinned corpus — every family's prose, fenced-code, and CJK counts are asserted as literals, so the freeze cannot be paired with an accidental ratio edit.
- `docs/runs-and-usage.md` is the canonical source for `budgets.inputTokensSource` (`"reported"` | `"estimated"`, absent together with `inputTokens`, what produces each, never priced, `"off"`/`"strict"` unaffected); `docs/agent-events.md` keeps the payload shape and one-line field meaning and links there instead of restating the enum; a grep finds the enum explained once.
- `docs/_evidence/phase112-primitive-review.md` exists with reuse rows (exact `path:line` spans), gap rows, the three runnable confirmations with their printed output, per-task verdicts, and the frozen rejections; `scripts/plan-review-gate.test.mjs` gains a `PLAN_112_TASK_1` block so the review cannot silently drift.
- No public export is added or removed, `Readonly<Record<ModelFamily, ModelFamilyTokens>>` stays the table's type, and no package default or pinned number in `scripts/budgets.json` moves.

## Tasks

- [ ] Task 1: Primitive review — the two-layer freeze, the two-page duplication, and the demand evidence for the gated remainder (P1, must run first)
  - Acceptance Criteria:
    - Functional: `docs/_evidence/phase112-primitive-review.md` exists with three sections — (a) reuse rows for every primitive Tasks 2–3 build on, each with a `path:line` span, (b) gap rows naming what no current seam or page does, (c) rejected alternatives with the reason, including every item in the frozen rejected list below.
    - Functional: the freeze gap is **measured**, not asserted. Print, against the built `dist/`: `Object.isFrozen(MODEL_FAMILY_TOKENS)` → `false`, `Object.isFrozen(MODEL_FAMILY_TOKENS.anthropic)` → `false`, then mutate the nested row (`charsPerToken: 3.7 → 99`) and `estimateTextTokensForFamily("x".repeat(370), "claude-sonnet-4-5")` → `4` where it was `100`; then replace the row object and print the estimate → `NaN`. One such run was already made while writing this plan — `frozen? false | row frozen? false | nested mutation {"charsPerToken":3.7,...} -> {"charsPerToken":99,...} | estimate 370 chars: 4 (was 100)` — so the review reproduces that transcript and records it in the evidence file.
    - Functional: the review shows a **shallow** freeze does not close the gap: call `Object.freeze(MODEL_FAMILY_TOKENS)` on the built module, mutate `MODEL_FAMILY_TOKENS.anthropic.charsPerToken`, and print that the write still lands. That printed transcript is the reason Task 2's freeze is per-row plus table, and Task 2's test must fail if a row is left unfrozen.
    - Functional: the report-path under-count is measured with a real session, not argued: `AgentConfig.contextBudget` with `reportOmissions: true`, a middleware registered on `input_assembly` (which runs after `applyContextBudget`, `src/input.ts:L329-L340`) appending ≈8k characters, then print `result.usage.inputTokens` (the reused `report.keptTokens`), the assembled request's own family-estimator cost, and the shortfall. One run while writing this plan: `fallback estimate (report.keptTokens): 12502 | actual assembled request (family estimator): 15470 | under-count: 12502 vs 15470 = 19.2% short`. The control is the same session with the middleware removed (the shipped drift test's 0% case) so the review separates the mutation from the measurement.
    - Functional: the review states the gap's shape honestly — the report is measured before `input_assembly`/`prompt_build` middleware, tail segments (`src/input.ts:L360-L366`), and the prompt builder (`:L369-L397`) run, so the caveat is real but only bites a host that mutates the request after the budget pass; `docs/runs-and-usage.md` already documents the caveat, and the measured 19.2% is the evidence that would justify a digest or a seam-side re-projection **if** a host reports it.
    - Functional: demand evidence for the gated remainder is recorded as grep output: consumers of `estimateRequestExtrasTokens` and `resolveHostTokenEstimator` outside `src/context-budget.ts` (expected: `src/agent-session/session/provider-round.ts` plus the plan 103 tests only) and any reference to them in `src/index.ts` (expected: none), with the conclusion per item ("no demand → stays recorded in plan 103").
    - Functional: the doc duplication is located exactly: `docs/agent-events.md:L199-L207` restates the shape and the `"reported"`/`"estimated"` rules, `docs/runs-and-usage.md:L85-L97` derives the same rules from the fallback paths, and plan 103 Task 2's execution note records having had to edit both. The review prints both passages and states which page owns which fact after Task 3.
    - Functional: the sibling-table inventory is recorded — `BUILT_IN_GUARDRAIL_PACK_IDS` (`src/guardrail-packs/index.ts:L20`, array, not frozen), `MODEL_INPUT_CAPABILITIES` (`src/content.ts:L25`) and `THINKING_LEVELS` (`src/thinking.ts:L8`) (`as const` arrays, runtime-mutable), with the decision per row: Task 2 freezes `MODEL_FAMILY_TOKENS` only, because it is the one whose mutation silently changes numeric accounting; the others change validation outcomes and are recorded as a lower-severity gap with the reason they are not tasks here.
    - Functional: the review states per later task whether it reuses a primitive as-is, extends it, or adds one — Task 2 (extends `src/usage-estimation.ts` with in-place deep freeze; no new export, no type change), Task 3 (edits two docs pages; no code).
    - Performance: the review records the probes' wall clock and confirms the freeze is O(7) rows at module load; the existing startup-budget row in `scripts/budget-gate.test.mjs` is the regression guard Task 2 must keep green, so no new performance surface is introduced.
    - Code Quality: the review is deterministic evidence, not prose; every reuse row names the exact exported symbol, every gap row names the file that would have to change, and each rejected alternative names the plan item it answers. It adds the `PLAN_112_TASK_1` block to `scripts/plan-review-gate.test.mjs` (plan path, evidence path, required tokens — `src/usage-estimation.ts`, `MODEL_FAMILY_TOKENS`, `src/context-budget.ts`, `estimateRequestExtrasTokens`, `src/agent-session/session/provider-round.ts`, `docs/agent-events.md`, `docs/runs-and-usage.md`, `input_assembly`, `Object.isFrozen`; rejected tokens — `shallow freeze`, `typed readonly is enough`, `host-overridable ratio registry`, `barrel promotion without demand`, `request digest without demand`, `freezing every exported table`).
    - Security: the review states why a mutable accounting table is a safety issue and not a style one — an under-counted input estimate is what a token/cost limit is checked against, so a mutated ratio can let a limited host spend unnoticed (and `NaN` makes comparisons false) — and why the freeze cannot weaken anything (it removes write access, adds none). Evidence files carry no credentials, request text, or absolute host paths.
  - Approach:
    - Documentation Reviewed:
      - Plan 103 `Compromises Made` + `Further Actions` (the source of every later task and of the gated remainder); `docs/_evidence/phase103-primitive-review.md` (reuse inventory and per-task verdicts; gap G11 is this plan's Task 2) and `docs/_evidence/phase103-family-token-calibration.md` (the row provenance Task 2 must not change); `docs/runs-and-usage.md:L80-L97` (family table paragraph and fallback paths — the page Task 3 makes canonical); `docs/agent-events.md:L199-L207` (the duplicate); `docs/input-and-prompt-assembly.md:L94` (the budget stage's position in the assembly pipeline).
    - Options Considered:
      - Skip the review and write Tasks 2–3 directly — rejected: Task 2 changes runtime behavior of an exported table and Task 3 decides doc ownership from two conflicting passages, so the reuse/gap/rejection rows and the measured transcripts are what a later reader needs to re-decide.
      - One evidence file per task — rejected: one review owns the inventory and later tasks cite its rows, matching plans 102/103/104/108/109/110/111.
      - Fix the under-count now (digest or seam-side re-projection) — rejected: the plan's own gate is "if a real host hits it", no consumer exists in this tree, and the cheapest fix changes the public `ContextBudgetReport` shape; the measured 19.2% is recorded so the next reader starts from evidence, not from an argument.
      - Promote `estimateRequestExtrasTokens` to the barrel — rejected: exactly one in-tree consumer (the seam) and no host request; promotion would also move the export ceiling and need a `package-truth --emit-docs` run for a helper nothing outside the package can use yet.
      - Freeze every exported table in the same task — rejected: only `MODEL_FAMILY_TOKENS` feeds numeric accounting; the `as const` arrays change validation outcomes when mutated and are recorded as a separate lower-severity gap instead of widening this plan's blast radius.
      - Declare the rows `as const` instead of freezing — rejected: `as const` is compile-time only; the measured mutation happens through the runtime object.
    - Chosen Approach: one review file that measures the freeze gap, the under-count, and the demand gate, then two small independent tasks — a deep freeze with pinned estimate literals, and a docs ownership edit — with no export, default, or pinned budget change.
    - API Notes and Examples:
      ```bash
      # freeze gap, before Task 2 (built dist; output recorded in the review)
      node --input-type=module -e '
        const m = await import("./dist/usage-estimation.js");
        console.log(Object.isFrozen(m.MODEL_FAMILY_TOKENS), Object.isFrozen(m.MODEL_FAMILY_TOKENS.anthropic)); // false false
        m.MODEL_FAMILY_TOKENS.anthropic.charsPerToken = 99;
        console.log(m.estimateTextTokensForFamily("x".repeat(370), "claude-sonnet-4-5")); // 4 (was 100)
      '
      # post-budget under-count (AgentConfig.contextBudget + reportOmissions + input_assembly middleware append)
      node /tmp/probe-under-count.mjs
      # → fallback estimate (report.keptTokens): 12502 | actual assembled request: 15470 | 19.2% short
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase112-primitive-review.md`: new review artifact (three sections plus the runnable confirmations and their printed output).
      - `scripts/plan-review-gate.test.mjs`: `PLAN_112_TASK_1` block.
    - References:
      - `src/usage-estimation.ts:17,19,30,52,64,74` (private ratio constants, the table, `resolveModelFamily`, `estimateTextTokensForFamily`), `src/index.ts:798` (barrel export), `src/context-budget.ts:331,408,422` (`measureInputCost`, `resolveHostTokenEstimator`, `estimateRequestExtrasTokens`), `src/agent-session/session/provider-round.ts:172-204` (path selection), `src/input.ts:329-340,360-366,369-397` (budget pass, then middleware, tail segments, prompt build), `src/guardrail-packs/index.ts:20`, `src/content.ts:25`, `src/thinking.ts:8` (sibling tables), `docs/agent-events.md:199-207`, `docs/runs-and-usage.md:80-97`.
  - Test Cases to Write:
    - Review gate: `scripts/plan-review-gate.test.mjs` fails when `docs/_evidence/phase112-primitive-review.md` is missing, stops naming a required primitive, or drops a frozen rejection.
    - Freeze probe: the transcript prints `false`/`false` for table and row, `4` for the mutated estimate, and the shallow-freeze run still lands the write — the three facts Task 2's test and freeze shape rest on.
    - Under-count probe: the transcript prints the reused `keptTokens`, the assembled request's cost, and the shortfall, with the no-middleware control beside it.
    - Not-a-test but recorded: the sibling-table inventory with each row's live frozen state.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (evidence artifact and a test-only gate block).
    - Docs pages to create/edit: `docs/_evidence/phase112-primitive-review.md` (evidence, not a `/docs` API page — same placement as phase102/103/111 reviews; excluded from the shipped tarball).
    - `docs/index.md` update: no (no behavior delta, no new page).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 2: Deep-freeze `MODEL_FAMILY_TOKENS` so a mutation cannot silently change token accounting (P2)
  - Acceptance Criteria:
    - Functional: `Object.isFrozen(MODEL_FAMILY_TOKENS)` and `Object.isFrozen(MODEL_FAMILY_TOKENS[family])` are true for all seven families, verified by a test that iterates the table rather than naming rows.
    - Functional: a strict-mode write attempt throws — `assert.throws(() => { (MODEL_FAMILY_TOKENS.anthropic as { charsPerToken: number }).charsPerToken = 99; }, TypeError)` — and `estimateTextTokensForFamily("x".repeat(370), "claude-sonnet-4-5")` still returns the pre-change `100`, so a failed write cannot leave a partial value behind. `Reflect.set` on the frozen row returns `false`, asserted beside it.
    - Functional: estimator output is unchanged for a pinned corpus, asserted as literals per family (anthropic/openai/google/deepseek/openrouter-generic/mistral/unknown) across prose, fenced code, and CJK — the freeze lands with no accidental ratio edit, and the plan-103 calibration bands still pass against the same fixture.
    - Functional: the freeze is deep, and the suite proves it — deleting a single per-row `Object.freeze` (keeping the table-level one) fails the test; the review's shallow-freeze transcript is cited in the test comment so the reason survives.
    - Performance: import cost stays O(7) row freezes; `scripts/budget-gate.test.mjs` (including its startup-ratio row) passes unchanged, and no new benchmark is added because freezing at module scope is not a hot path.
    - Code Quality: `Readonly<Record<ModelFamily, ModelFamilyTokens>>` stays the table's declared type, no export is added or removed, no new module or helper is introduced, and `biome check` is clean; the per-row freeze is visible at the declaration so a later edit that adds a family cannot forget it (a plain unfrozen row fails the test, not a review).
    - Security: the hazard is named in the code comment — a mutated ratio under-counts input tokens (or makes them `NaN`) against the same numbers `maxInputTokens`/`maxCost` are checked with — and the doc sentence states that recalibration is a source change plus the live leg, not a runtime override.
  - Approach:
    - Documentation Reviewed:
      - `docs/runs-and-usage.md:L80-L84` (the family-table paragraph Task 2 extends with the frozen sentence), `docs/_evidence/phase103-family-token-calibration.md` (row provenance and the recalibration procedure the doc must keep pointing at), `docs/usage.md` if it restates the table (check during the task; edit only on duplication).
    - Options Considered:
      - Shallow `Object.freeze(MODEL_FAMILY_TOKENS)` — rejected: measured writable rows (Task 1 transcript).
      - Freezing lazily on first estimate — rejected: makes the guarantee depend on call order and costs a branch in the hot path.
      - A frozen `as const` literal plus a runtime assertion — rejected: two mechanisms for one guarantee; `Object.freeze` is the runtime one.
      - Exporting a `setModelFamilyRatio` override seam — rejected: plan 103 Task 1 rejected a mutable module-level ratio registry; a supported override is a new API with its own calibration and concurrency questions, and no host asked.
      - Making the table private and exporting a read-only accessor — rejected: a breaking export change for a hazard a freeze closes, and the table's values are documented calibration evidence hosts are invited to read.
    - Chosen Approach: freeze each row in the declaration, freeze the table around it, and pin both the frozen state and the estimator's literal output in the existing estimation suite; one doc sentence records the guarantee.
    - API Notes and Examples:
      ```ts
      export const MODEL_FAMILY_TOKENS: Readonly<Record<ModelFamily, ModelFamilyTokens>> = Object.freeze({
        anthropic: Object.freeze({ charsPerToken: 3.7, perMessageOverhead: 4, confidence: "medium" }),
        // …every row frozen individually — the load-bearing part; the table freeze alone leaves rows writable
      });
      ```
    - Files to Create/Edit:
      - `src/usage-estimation.ts`: per-row `Object.freeze` + table `Object.freeze`, with the one-line reason.
      - `src/__tests__/usage-estimation.test.ts`: freeze block (both layers, `assert.throws`, `Reflect.set`, pinned per-family literals).
      - `docs/runs-and-usage.md`: one sentence in the family-table paragraph — the table is frozen, hosts cannot override ratios at runtime, recalibration stays the live-leg procedure.
    - References:
      - `src/usage-estimation.ts:30-39` (the table), `src/__tests__/usage-estimation.test.ts:46-130` (existing suite and its literals), `src/__tests__/usage-calibration.test.ts` (bands that must stay green), `scripts/budget-gate.test.mjs` (startup row), `docs/_evidence/phase103-primitive-review.md` gap G11 (the origin of this task).
  - Test Cases to Write:
    - Table and every row frozen: iterating `MODEL_FAMILY_TOKENS` reports `Object.isFrozen` for each row and for the record.
    - Write attempt: the property assignment throws `TypeError`, `Reflect.set` returns `false`, and the estimate for the mutated family is unchanged.
    - Pinned output: per-family prose/code/CJK literals equal today's values (captured before the change and asserted after).
    - Deep-freeze control: the suite fails when a row's `Object.freeze` is removed (sabotage check recorded in the task note).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — an exported table becomes runtime-immutable; behavior delta is negative-space (a host that mutated it now throws).
    - Docs pages to create/edit: `docs/runs-and-usage.md` (family-table paragraph: the frozen sentence and the recalibration pointer).
    - `docs/index.md` update: no (existing page, no new navigation entry; the change is one sentence on a documented contract).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 3: One owning page for `budgets.inputTokensSource` (P3)
  - Acceptance Criteria:
    - Functional: `docs/runs-and-usage.md` owns the provenance contract — the two values, the "absent together with `inputTokens`" rule, what produces each (reported turn, the three fallback paths, the labels), and that estimates are never priced — stated once, in the fallback section next to the path list.
    - Functional: `docs/agent-events.md:L199-L207` keeps the `budgets` payload shape and a one-line meaning per field and links to the runs-and-usage section for provenance rules instead of restating them; it no longer carries a second explanation of `"reported"`/`"estimated"`.
    - Functional: a grep check (recorded in the task note) shows the enum explained on exactly one page, and the cross-link exists in both directions.
    - Functional: the report-path caveat in `docs/runs-and-usage.md` cites the measured under-count from `docs/_evidence/phase112-primitive-review.md` (one clause, 19.2% with the mutation, 0% without), so the boundary is a number rather than a hedge.
    - Performance: docs only — no runtime surface, and `node --test dist/__tests__/docs.test.js` passes (link and structure checks).
    - Code Quality: no fact is stated twice; the event page reads as an event reference (shape first), the runs-and-usage page as the provenance source (semantics first); no release narrative or plan number is added to either page body beyond the existing cross-references.
    - Security: the pages keep stating that estimates are not billing and that a `maxCost` limit fails closed on unpriced usage — the dedupe must not drop that sentence from either side.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-events.md:L196-L210` (the budgets block and the surrounding event semantics), `docs/runs-and-usage.md:L85-L97` (fallback section and the path list), `docs/_evidence/phase112-primitive-review.md` (the printed passages and the measured caveat), plan 103 Task 2 execution note (the drift this task closes).
    - Options Considered:
      - Move the whole shape into runs-and-usage — rejected: the shape belongs to the event payload reference a `provider_turn_finished` consumer reads; the enum's *meaning* is what duplicates.
      - Delete the agent-events wording and link without a summary — rejected: a reader of the event page must not have to leave it to know what the field's two values are.
      - Add a docs conformance test asserting the enum appears once — rejected: a test that greps prose is brittle; the review gate's required tokens plus the docs test cover the structural risk, and the plan-review gate keeps the evidence honest.
      - Fold the `budgets` shape into a generated schema — rejected: out of scope; the event page is hand-maintained by design and this task only removes the duplication.
    - Chosen Approach: keep the shape where the event consumer reads it, move the provenance rules to the page that documents the modes, and link both ways.
    - API Notes and Examples:
      ```md
      <!-- docs/agent-events.md -->
      `budgets.inputTokensSource` is `"reported"` or `"estimated"` (absent with `inputTokens`); what produces each is documented in [Runs and usage](runs-and-usage.md#automatic-fallback-agentconfigusageestimation).
      ```
    - Files to Create/Edit:
      - `docs/agent-events.md`: budget block reduced to shape + one-line meanings + link.
      - `docs/runs-and-usage.md`: canonical provenance wording, plus the caveat's measured citation.
    - References:
      - `docs/agent-events.md:196-210`, `docs/runs-and-usage.md:85-97`, `plans/103-Usage-Estimation-And-Context-Meter-Follow-Ups.md` Further Actions (first item), `docs/_evidence/phase112-primitive-review.md`.
  - Test Cases to Write:
    - Docs gate: `dist/__tests__/docs.test.js` passes (structure, links, index entries).
    - Duplication check (recorded, not automated): grep output showing the enum explained once and both cross-links resolving.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — wording ownership only; the documented contract is unchanged.
    - Docs pages to create/edit: `docs/agent-events.md`, `docs/runs-and-usage.md`.
    - `docs/index.md` update: no (no navigation delta).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- To be filled after tasks are completed and tests pass.

## Further Actions
- To be filled after task completion with improvements, rationale, and priority.