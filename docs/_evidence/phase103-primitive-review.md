# Phase 103 — Primitive Review: Provenance, Calibration, Meter Cache, Strict Refusal, Exact Measurement

Plan: [103-Usage-Estimation-And-Context-Meter-Follow-Ups.md](../../plans/103-Usage-Estimation-And-Context-Meter-Follow-Ups.md) Task 1.
Date: 2026-09-20. Baseline: `0.9.0` working tree, HEAD `f6b1da81` (same baseline plan 102 Task 1 reviewed;
root `src/` unchanged since 2026-09-18 20:27, `dist/` rebuilt 2026-09-20 12:11 from this tree; the only
working-tree changes since HEAD are plan 102's `packages/memory`/`docs` edits plus untracked files).
Scope: **read-only inventory**. This document is the gate for Tasks 2–6: every later task either reuses a
row below as-is, extends one additively, or adds a named new surface. No task may open a seam this file
does not map.

Cite convention: `covers:` spans are `file:Lstart–Lend` verified in this tree. Every `reuse:` row names the
exact exported symbol (or the exact module-private function the seam calls). Every `gap:` row names the file
that must change.

Source of the work: plan 091 `Compromises Made` + `Further Actions`
([091-Usage-Estimation-Fallback-And-Context-Meter.md](../../plans/091-Usage-Estimation-Fallback-And-Context-Meter.md)
`L85–L100`), plus the current contracts in `docs/runs-and-usage.md:L70–L104`, `docs/execution-timeline.md:L125`,
`docs/agent-events.md:L181–L203`, `docs/input-and-prompt-assembly.md:L65–L66`/`L94`, `docs/live-testing.md`,
and the shipping suites named per row.

---

## 1. Reuse inventory (what the later tasks build on)

### 1.1 Turn provenance (Task 2)

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `src/contracts-core/provider.ts:L98–L111` | `TurnBudgets` | The event payload Task 2 extends: `inputTokens?` (`:L100`, comment at `:L99` is stale — it says "provider-reported"), `inputCap?`, `runInputBudget?`, `runInputUsed`, `turns`, `maxTurns`. Additive optional field only. |
| `src/agent-session/session/provider-round.ts:L77–L90` | `turnBudgets()` (module-private) | O(1) snapshot from `RunLimitTracker` (`tracker.snapshot()`) + `resolveTurnInputCap`; the one place all three `provider_turn_finished` emissions build `budgets`. Task 2 adds one ternary here. |
| `src/agent-session/session/provider-round.ts:L423`, `:L441`, `:L460` | emission sites | Finish / steer-abort / provider-error paths all call `turnBudgets(session, request.model, effectiveUsage)` with the effective (post-fallback) usage — so an `inputTokensSource` filled in `turnBudgets()` reaches every path with no emission change. |
| `src/contracts-core/content.ts:L219–L221` | `Usage.estimated`, `Usage.confidence` | The authoritative labels Task 2 must not duplicate or remove: `inputTokensSource` is a read convenience, `usage.estimated` stays the source of truth. |
| `packages/prism-core/src/governance/observability/timeline.ts:L341–L346` | timeline projection | `budgets` is copied verbatim from `event.metadata.budgets` — a pure pass-through, so the new field needs no projection code. The shape lives at `packages/prism-core/src/governance/observability/timeline-types.ts:L90`; the run rollup reads it at `packages/prism-core/src/governance/observability/timeline.ts:L635`. |
| `docs/execution-timeline.md:L125` | `budgets?: TurnBudgets` row | Documentation surface for the pass-through (plan Task 2). |
| `docs/runs-and-usage.md:L87` | automatic-fallback bullet | Names `budgets.inputTokens`/`runInputUsed`; Task 2 adds the source label here. |
| `docs/agent-events.md:L199–L203` | `provider_turn_finished.metadata.budgets` shape | Restates the key set **and** the stale "provider-reported input tokens" wording — see gap G2. |
| `src/__tests__/usage-estimation-fallback.test.ts:L89–L90`, `:L156–L157` | budget↔usage parity asserts | Existing pins the new field must extend (fallback estimate feeds `budgets.inputTokens`; `"off"` leaves it absent). |

### 1.2 Family estimation and calibration (Task 3)

| Span | Exported symbol | Behavior |
| --- | --- | --- |
| `src/usage-estimation.ts:L30–L37` | `MODEL_FAMILY_TOKENS` | The table Task 3 calibrates: `anthropic` 3.7, `openai` 5.0, `google` 3.9, `deepseek` 3.8, `openrouter-generic` 4.4, `mistral` 3.9, `unknown` 3.5 (overhead + confidence per row). Only `openai` has recorded reference counts today (plan 091's o200k fixtures). |
| `src/usage-estimation.ts:L40–L50` | `FAMILY_PATTERNS` (module-private) | Model-id → family patterns; the live legs resolve the model under test through `resolveModelFamily`, not a second mapping. |
| `src/usage-estimation.ts:L52–L62` | `resolveModelFamily` | Model id / provider id / explicit family name → table key; unmatched = `"unknown"`, never a throw. |
| `src/usage-estimation.ts:L64–L75` | `estimateTextTokensForFamily` | The pure per-text ratio used by both the fallback seam and Task 3's chars-per-token assertions. Module-level (not in `src/index.ts`) — the live script imports it from `src/usage-estimation.ts`, not the barrel, or re-derives chars/token from fixture lengths. |
| `src/context-budget.ts:L95–L96`, `:L106–L119` | `estimateMessageTokens` overloads | Array form = family estimate; Task 3's fixture test and live legs both use it as the shipped row under test. No second estimator. |
| `src/__tests__/usage-estimation.test.ts:L12–L19` | fixture strings (`PROSE`, `SYSTEM_PROMPT`, `HISTORY_TURN`, `FENCED_CODE`, `CJK`) | The corpus shape Task 3 extends; the existing `openai` reference counts are at `:L36–L41`. |
| `src/__tests__/usage-estimation.test.ts:L124–L131` | 100k-char envelope | Existing offline timing fence (`<100ms`; comment target `<0.1ms/100k`) — the deterministic fixture test Task 3 adds must stay in the same `src/__tests__` location to run in the root chain. |
| `plans/091-Usage-Estimation-Fallback-And-Context-Meter.md:L47` | plan 091 deviation 2 | Records the calibration provenance Task 3 replaces: o200k counts came from a one-off dev-time oracle, and the non-openai rows are published-range guesses. |

### 1.3 Context meter and the snapshot-cache pattern (Task 4)

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `src/agent-session/session.ts:L253–L273` | `contextMeter()` | The read Task 4 caches: `activeInputMeter?.tokens ?? estimateMessageTokens(this.history, model).tokens`, `source`, `inputCap` via `resolveInputCap`, `runInputBudget` from `activeLimits`, `usedRatio`. Two estimator inputs (`history`, model family) and three run-state inputs (`activeInputMeter`, `activeLimits`, config) — the cache key set. |
| `src/contracts-core/usage.ts:L28–L44` | `ContextMeter` | The public value shape; caching is an internal semantic, no contract change. |
| `src/agent-session/session.ts:L127–L128` | `activeInputMeter` | Set by the usage seam (`src/agent-session/session/provider-round.ts:L146`), cleared by `compact()`; fresh object identity per turn makes it a valid cache key. |
| `src/agent-session/session.ts:L217–L224` | `snapshotGeneration` + `snapshotCache` | The pattern Task 4 mirrors: private field, key `{ leafId, generation, expiresAt }`, value = the read result. Task 4's key replaces `expiresAt` with run-state identity. |
| `src/agent-session/session.ts:L703–L706` | `invalidateSnapshot()` | The generation bump every history mutation already calls (`appendEntry` `:L700`, `checkout` `:L449`, `compactBranch` `:L647` through its `appendEntry` `:L686`) — reuse, do not add a subscription. |
| `src/agent-session/session.ts:L428–L434` | `compact()` | Clears `activeInputMeter` after a manual compaction — the second invalidation Task 4's key must cover. |
| `src/agent-session/session.ts:L720–L736` | `snapshot()` read/write | Identity-guard comparison to copy: `cached.leafId === currentLeafId && cached.generation === snapshotGeneration`. |
| `src/agent-session/session/assemble.ts:L634` | run boundary | `session.activeLimits = limits` (new tracker per run); cleared at `src/agent-session/session/persist.ts:L294`. A run boundary therefore changes `activeLimits` identity — the third key component. |
| `src/run-limits.ts:L210–L216` | `RunLimitTracker.snapshot()` | Source of `runInputUsed`/`turns`; cheap and already called per turn, not a cache concern. |
| `docs/runs-and-usage.md:L94–L103` | meter contract | Documents per-call re-estimation today; Task 4 adds the caching sentence. Plan 091's compromise is `plans/091-…md:L88`. |

### 1.4 Strict refusal seams (Task 5)

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `src/contracts-core/agent.ts:L94–L99` | `AgentConfig.usageEstimation` | Documented two-mode union today; Task 5 adds `"strict"` to the union and the comment. |
| `src/agent-session/session.ts:L235–L237` | constructor validation | Fails closed on any out-of-union value with `TypeError('usageEstimation must be "fallback" or "off"')` — the message must enumerate the third mode. |
| `src/agent-session/session/provider-round.ts:L171–L181` | `estimateTurnUsage()` (module-private) | The seam Task 5 branches: `off` → `undefined`; otherwise estimates. Strict = refuse before any flattening. |
| `src/agent-session/session/provider-round.ts:L129–L168` | `recordProviderUsage()` | Calls `estimateTurnUsage` when `turnUsage` is undefined, skips `withCatalogCost` for estimates, and only writes a ledger row when effective usage exists — the "no ledger row, no catalog call" behavior Task 5 pins. |
| `src/agent-session/helpers.ts:L91–L98` | `ProviderTurnFailure` | `{ info: ErrorInfo, observable: boolean }` — the refusal carrier. Task 5 constructs one with `observable: true`; no new class. |
| `src/agent-session/helpers.ts:L82–L89` | `errorFromInfo` | Copies `name`, `code`, `cause`, `failureClass` from `ErrorInfo` onto the thrown `Error` — the reason `code: "usage_missing"` reaches `AgentRunResult.error` without an exported class. |
| `src/agent-session/session/provider-round.ts:L285` | observable rethrow in `generateWithRetry` | `if (!policy || failure?.observable) throw errorFromInfo(info)` — ends the run on the first attempt, bypassing retry policy. |
| `src/agent-session/session/assemble.ts:L692`, `:L704`, `:L722` | terminal error path | `runError = errorToErrorInfo(error)` → `error` event → `AgentRunResult.error`; `failureClass` stays advisory (absent unless the provider set it). |
| `src/run-limits.ts:L236–L239` | `RunLimitTracker.recordUsage` | Today's failure mode Task 5 replaces: `recordUsage(undefined)` with `maxCost` set `exceed("maxCost", Infinity)` — a `budget_exhausted` breach attributed to cost, not a usage refusal. |
| `docs/runs-and-usage.md:L85`, `:L105–L117` | modes bullet + failure-class section | Where the three modes and the "not a provider failure" note go; `docs/options-index.md:L48` is the option-table row. |

### 1.5 Exact measurement reuse (Task 6)

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `src/context-budget.ts:L49–L56` | `ContextBudgetReport` | `keptTokens`/`keptBytes` are the post-eviction assembly measurement — the number the fallback should prefer. Covers message groups only (groups flattened at `src/input.ts:L339`). |
| `src/context-budget.ts:L67` | `CONTEXT_BUDGET_REPORT_METADATA_KEY` | `"contextBudgetReport"`; the report travels on `ProviderRequest.metadata` (`src/input.ts:L400`). |
| `src/context-budget.ts:L147–L150` | `getContextBudgetReport` | The seam-side reader; returns `undefined` when the key is absent — see gap G9. |
| `src/context-budget.ts:L152–L212` | `applyContextBudget` | Measures once via `measureInputCost` (`:L190`) and returns the report — the assembler's own measurement, no second pass. |
| `src/context-budget.ts:L316–L324`, `:L331–L341` | `MeasureInputCostOptions`, `measureInputCost` | The O(n) whole-request measurement and its projection set (groups, context, skills, tools, `skillContext`, `demotedBodies`, estimator) — the exact cost Task 6's estimate must match within 5%. |
| `src/context-budget.ts:L350–L360` | `resolveTokenEstimator` (module-private) | Validates a host estimator (function; non-negative finite number) and fails closed with `TypeError`. Module-private — see gap G8. |
| `src/context-budget.ts:L368–L406` | `measureAll` (module-private) | The projections Task 6 must share rather than fork: per-message `estimateMessageTokens(message, estimateTokens)` (`:L375–L378`), context-block text `title + contextBlockText` (`:391`), `skillPromptText` (`:394`), and the tool-list line `Available tools:\n- name: description` (`:400–L404`) — note it never serializes `parameters`. |
| `src/context-budget.ts:L472–L480` | `contextBlockText` (module-private) | Context-block projection; module-private — gap G8. |
| `src/skill-disclosure.ts:L85` | `skillPromptText` | Skill projection reused by `measureAll`; exported already. |
| `src/agent-session/session/provider-round.ts:L171–L181` | today's projection | `JSON.stringify({ tools, context })` under the family ratio — the drift source measured in §5; `request.messages` already excludes groups the report counts. |
| `src/agent-session/session/assemble.ts:L496–L507` | report + request wiring | `assembleRoundContext` returns the post-policy `middlewareRequest`, and `recordProviderUsage(ctx, turnUsage, turn, attempt, middlewareRequest)` receives it — so `getContextBudgetReport(request)` is reachable from the seam with no carrier change. |
| `src/input.ts:L329–L346`, `:L400` | report attachment | `applyContextBudget` runs in the budget path; `budgetReport` is attached only when `options.contextBudget.reportOmissions === true` — gap G9. |
| `src/attention-compiler.ts:L495` | "measure once per turn" | The compiler and `applyContextBudget` both already pay this measurement; Task 6 adds no pass on the report path. |
| `src/__tests__/attention-compiler-stages.test.ts:L89` | report equality | Existing assertion that the report equals `measureInputCost` for the same groups — the shape Task 6's band test extends. |
| `docs/input-and-prompt-assembly.md:L65–L66`, `:L94` | estimator contract | Says the estimator is "eviction accounting only — never reaches billing, provider usage, or the wire" — Task 6 changes the usage half of that sentence (gap G10). |
| `src/index.ts:L175–L190` | public export block | `measureInputCost`, `resolveTokenEstimator`, `measureAll`, `contextBlockText` are **not** in it; if Task 6 needs a public helper, the pin set is `src/__tests__/public-export-contract.test.ts:L26` (`FROZEN_VALUE_EXPORTS`), `:L578` (`FROZEN_TYPE_EXPORTS`), `scripts/budgets.json:L23` (`@arnilo/prism`), plus `node scripts/package-truth.mjs --emit-docs`. Prefer module-private (same-dir helper) and skip all four. |

### 1.6 Live matrix, generated docs, and test routing (Task 3)

| Span | File / seam | Behavior |
| --- | --- | --- |
| `scripts/live-matrix.json:L35–L56` | `providers/anthropic` row | The entry shape Task 3's `calibration/vendor-count-tokens` row mirrors: `id`, `package`, `status`, `source`, `command`, `cwd`, `requires`, `requiresAny`, `model[{env,default,wired}]`, `scope`, `cost`. |
| `scripts/live-matrix.json:L57–L81` | `providers/google` row | The `requires` all-of + `requiresAny` any-of precedent for the two keys Task 3 accepts (`GEMINI_API_KEY` / `GOOGLE_API_KEY`). |
| `scripts/live-matrix.mjs:L128–L137` | `resolveSuiteState` | Pure skip contract (missing required → skip with reason; any-of → run if any present; strict inverts). The reason string Task 3's suite inherits. |
| `scripts/live-matrix.mjs` (`--check`) | manifest validator | Rejects secret-shaped values and unknown fields; Task 3's row must pass it. |
| `scripts/live-doc-check.test.mjs:L22–L28` | doc-sync gate | Fails `npm test` when `docs/live-testing.md` drifts from the manifest — Task 3 runs `node scripts/generate-live-docs.mjs --write`, never hand-edits. |
| `scripts/run-all-tests.mjs:L30–L72` | `GATE_FILES` | Root gate list; a new `scripts/*.test.mjs` is **not** picked up unless added, so Task 3's live leg cannot accidentally run in the default chain. |
| `scripts/run-all-tests.mjs:L106–L109` | root suites stage | Globs `dist/__tests__/*.test.js` only — the deterministic fixture test must live in `src/__tests__/` to run; the live script lives in `scripts/`. |
| `src/__tests__/network-free-guard.test.ts:L29`, `:L37` | guard rules | A live-named file must reference `PRISM_(LIVE|TEST)_[A-Z_]+`; a non-live file must not touch `globalThis.fetch` — Task 3's fixture test must stay offline. |
| `docs/live-testing.md:L36` (skip-not-fail), `:L40` (model env), `:L48` (least privilege), `:L118` (secrets), `:L124` (add-a-suite checklist) | conventions | Task 3's registration must satisfy each of these. |

---

## 2. Per-task verdict (reuse as-is / extend / add new)

| Task | Verdict | Seam reused | New surface |
| --- | --- | --- | --- |
| 2 — `inputTokensSource` | **Extend** (`TurnBudgets` + `turnBudgets()`) | `TurnBudgets` (`src/contracts-core/provider.ts:L98`), `turnBudgets()` (`src/agent-session/session/provider-round.ts:L77`), the three emission sites (`:L423`/`:L441`/`:L460`), timeline pass-through (`packages/prism-core/src/governance/observability/timeline.ts:L341–L346`) | One optional field + one ternary; tests under `src/__tests__/`; docs `docs/runs-and-usage.md:L87`, `docs/execution-timeline.md:L125`, plus `docs/agent-events.md:L199–L203` (G2). No new export name. |
| 3 — family calibration | **Add test + evidence legs; runtime seams reused as-is** | `MODEL_FAMILY_TOKENS` (`src/usage-estimation.ts:L30`), `resolveModelFamily` (`:L52`), `estimateMessageTokens` array form (`src/context-budget.ts:L96`), `resolveSuiteState` live-matrix skip contract | New `src/__tests__/fixtures/usage-calibration.json` + `src/__tests__/usage-calibration.test.ts` (offline, root chain) and `scripts/usage-calibration-live.test.mjs` + one `scripts/live-matrix.json` row; generated `docs/_evidence/phase103-family-token-calibration.md`. Values change only if a measured band fails. |
| 4 — meter cache | **Extend** (`contextMeter()` internals only) | `snapshotGeneration`/`snapshotCache` pattern (`src/agent-session/session.ts:L217–L224`), `invalidateSnapshot()` (`:L703`), `compact()` clear (`:L428–L434`), `activeInputMeter`/`activeLimits` identity | One private field + key compare; no new export, no contract change, no cache utility. |
| 5 — `"strict"` mode | **Extend** (union member + one branch), refusal path reused as-is | `usageEstimation` union (`src/contracts-core/agent.ts:L99`), constructor validation (`src/agent-session/session.ts:L235`), `estimateTurnUsage` (`src/agent-session/session/provider-round.ts:L171`), `ProviderTurnFailure` + `errorFromInfo` (`src/agent-session/helpers.ts:L91`/`:L82`), observable rethrow (`src/agent-session/session/provider-round.ts:L285`) | One union value, one refusal branch; tests; docs `docs/runs-and-usage.md:L85`/`:L105–L117`, `docs/options-index.md:L48`. No new error class, stop reason, or adapter change. |
| 6 — exact-measurement reuse | **Extend** (fallback path selection), measurement reused as-is; one conditional extraction of module-private projections | `ContextBudgetReport`/`getContextBudgetReport` (`src/context-budget.ts:L49`/`:L147`), `measureInputCost`/`measureAll` (`:L331`/`:L368`), `resolveTokenEstimator` (`:L350`), `contextBlockText` (`:L472`), request metadata carrier (`src/input.ts:L400`), `middlewareRequest` seam (`src/agent-session/session/assemble.ts:L496–L507`) | One path-selection branch in `estimateTurnUsage`; shared projection helpers next to `measureAll`; public export only if the seam forces it (then the four pin updates in §1.5). No second estimator table. |

---

## 3. Gap list (no current seam does this)

| # | Gap | File that must change | Task |
| --- | --- | --- | --- |
| G1 | `TurnBudgets` carries only a number; nothing labels whether `inputTokens` was reported or estimated, so consumers cross-reference `usage.estimated`. | `src/contracts-core/provider.ts:L98`, `src/agent-session/session/provider-round.ts:L77` | 2 |
| G2 | `docs/agent-events.md:L199–L203` restates the budgets key set and the stale "provider-reported input tokens" wording; the plan's Task 2 docs list does not name this file, so the doc would go stale. | `docs/agent-events.md:L199–L203` (add to Task 2's edit list) | 2 |
| G3 | No checked-in calibration corpus and no recorded reference counts for `anthropic`/`google`; those rows are published-range guesses while only the `openai` row has o200k counts. | `src/__tests__/fixtures/usage-calibration.json` (new) + `src/__tests__/usage-calibration.test.ts` (new) | 3 |
| G4 | No env-gated vendor count-tokens leg, no matrix row, so a row cannot be re-measured by a maintainer. | `scripts/usage-calibration-live.test.mjs` (new) + `scripts/live-matrix.json` | 3 |
| G5 | `contextMeter()` re-estimates stored history on **every** call; measured warm cost equals cold cost (§5), so a per-frame poll pays a full O(context bytes) pass each frame. | `src/agent-session/session.ts:L253–L273` | 4 |
| G6 | The `usageEstimation` union has no refusal mode; under `maxCost`, a usage-less turn dies as `exceed("maxCost", Infinity)` — a `budget_exhausted` breach that misattributes a harness refusal to cost. | `src/contracts-core/agent.ts:L99`, `src/agent-session/session/provider-round.ts:L171`, constructor message `src/agent-session/session.ts:L235` | 5 |
| G7 | The fallback projects tools/context with `JSON.stringify` (includes `parameters`/metadata) instead of the assembler's `measureAll` shapes (name+description, `title+contextBlockText`); measured extras drift +24.7% to +182.9% (§5). | `src/agent-session/session/provider-round.ts:L174` (+ shared projections in `src/context-budget.ts` next to `measureAll:L368`) | 6 |
| G8 | `resolveTokenEstimator` and `contextBlockText` are module-private in `context-budget.ts`; the seam in `provider-round.ts` cannot reach them, and the plan forbids forking the projection. | `src/context-budget.ts:L350`, `:L472` (extract to a seam-visible module-private helper or export from `context-budget.ts` without touching the `src/index.ts` barrel) | 6 |
| G9 | `getContextBudgetReport(request)` returns `undefined` unless the host opted into `contextBudget.reportOmissions: true` (`src/input.ts:L345` → `:L400`); the fallback cannot assume a report exists, so paths 2/3 stay load-bearing and the per-path docs matter. | `src/input.ts:L345`/`:L400` (or document the degradation the seam already must handle) | 6 |
| G10 | `docs/input-and-prompt-assembly.md:L94` says `tokenEstimator` "never reaches billing, provider usage, or the wire"; Task 6 makes it feed usage estimation (still never billing/wire). | `docs/input-and-prompt-assembly.md:L94` | 6 |
| G11 | `MODEL_FAMILY_TOKENS` is `Readonly` at the type level only — measured in this tree, `Object.isFrozen(MODEL_FAMILY_TOKENS) === false` and a host can write `MODEL_FAMILY_TOKENS.anthropic.charsPerToken = 1` at runtime. Task 3's drift test must therefore compare against a copy if it needs a shifted row, and no task may layer a runtime override on the table. | `src/usage-estimation.ts:L30` (optional one-line `Object.freeze`; not required by plan 103) | 3 |

---

## 4. Rejected alternatives (frozen)

Every item below is an option the plan's tasks considered and this review rejects, with the reason.
None may reappear as an implementation without a new review row.

| # | Rejected | Reason | Task affected |
| --- | --- | --- | --- |
| R1 | Per-run `usageEstimation` override | The agent-wide switch is the documented contract, two agents cover the mixing case, and no host asked; a per-run union would double every validation site for an unrequested case. | 5 |
| R2 | In-tree tokenizer dependency (tiktoken, vendor WASM) | Adds a runtime dependency to ship a better guess; the env-gated `count_tokens`/`countTokens` legs give the same evidence with zero runtime cost. | 3, 6 |
| R3 | Global calibration registry a host can write | Hidden mutable state in a pure estimator (`src/usage-estimation.ts:L1–L15`); a host with measured numbers injects `contextBudget.tokenEstimator` (Task 6) or does not participate. | 3, 6 |
| R4 | Implement Tasks 2–6 without this review artifact | Tasks 2, 4, 5 change contracts and Tasks 3, 6 change measurement provenance; the create-plan primitive rule requires one evidence file before code. | 2–6 |
| R5 | Add `usageConfidence` to `TurnBudgets` too | `provider_turn_finished.usage.confidence` already carries it; a second confidence channel can disagree with the first. | 2 |
| R6 | Rename `inputTokens` to `inputTokensReported`/`inputTokensEstimated` | Breaking payload shape for a labeling problem; the additive source field and `usage.estimated` cover it. | 2 |
| R7 | Deterministic fixtures only, no live legs | The rows are the point; plan 091's o200k numbers came from an untraceable one-off local venv, which is exactly the procedure Task 3 replaces. | 3 |
| R8 | Check in tokenizer weights/vocabulary files | Size, licensing, and staleness; recorded counts plus a re-measure leg are the durable form. | 3 |
| R9 | Put the count-tokens legs in `packages/prism-providers` | The table owner is the root package; provider packages would have to export transports for a test-only need, and the root `scripts/` live-matrix convention already exists. | 3 |
| R10 | Cache the meter in the host (documented today) | Every host rewrites the same generation gating; the session already owns every invalidation point (`invalidateSnapshot`, `compact`, run boundary). | 4 |
| R11 | Cache the meter value on the entries/`snapshotCache` itself | `snapshot()` returns messages, the meter needs a number; coupling the two changes the snapshot cache's TTL semantics. | 4 |
| R12 | Memoize `estimateMessageTokens` globally | A global content-keyed cache retains message text and crosses sessions/redaction boundaries — an unacceptable content-retention surface. | 4 |
| R13 | Strip usage and continue under strict (flag-only) | A host whose cost gates cannot tolerate approximations needs the run to stop; today it stops as a confusing `budget_exhausted` cost breach, and flag-only keeps that ambiguity. | 5 |
| R14 | Emit a new failure class or stop reason for the refusal | Not a provider failure and not a loop ceiling; `ErrorInfo.code` plus the existing terminal error path is the surface plans 087/100 already deliver. | 5 |
| R15 | Export a new `UsageMissingError` class | `ProviderTurnFailure` + `errorFromInfo` already produce `name`/`code` on the public error; a class adds an export and a budget line for no new host capability. | 5 |
| R16 | Make strict the default | Breaks every non-reporting vendor host that voluntarily opted into the documented fallback. | 5 |
| R17 | Thread assembled groups into the usage seam (`RoundContext`/`ProviderRequest` change) | A carrier change across `assembleProviderInput` → middleware → adapter for an estimate; the report already travels on the request metadata. | 6 |
| R18 | Export a new public `measureRequestInput(request)` helper now | Deferred, not rejected on the merits: only worth an export (plus `FROZEN_*` pins, `scripts/budgets.json`, `package-truth --emit-docs`) if the seam cannot be served by a module-private helper. | 6 |
| R19 | Keep the family heuristic everywhere as the default | Once a host supplies a tokenizer, budget decisions use it while usage uses chars/token — two different numbers for the same request. | 6 |
| R20 | Reuse `ContextBudgetReport.keptTokens` for the whole estimate (tools/context included) | `keptTokens` covers post-eviction message groups only; claiming otherwise under-counts, the dangerous direction for a meter. | 6 |
| R21 | Estimate inside each provider adapter (plan 091's own rejection) | Twelve copies and guaranteed drift; one seam already exists in `recordProviderUsage`. | 2–6 |

---

## 5. Measured cost of the reference paths

Method: the shipping-suite fixture shapes were re-run against the built root package (`dist`, rebuilt
2026-09-20 12:11 from this tree) with a throwaway harness that prints timings — same fixture strings
(`src/__tests__/usage-estimation.test.ts:L12–L19`) and the same call order as the suites named below; the
harness is not committed. Median of 5 runs after one warmup (except the warm-meter row: 1,000 consecutive
reads). Machine: `aerynos`, AMD Ryzen 9 PRO 7940HS, Node v24.19.0, in-memory session store, 2026-09-20.

| Path | Fixture / shipping suite | Measured | Suite assertion |
| --- | --- | --- | --- |
| `contextMeter()` cold read, 209,700-char stored history, no active run | `src/__tests__/usage-estimation-fallback.test.ts` (meter fields, `:L95–L101`); 200k shape of the `src/__tests__/usage-estimation.test.ts:L124–L131` body | runs `[1.52, 0.58, 0.47, 0.47, 0.46]ms` → **0.47ms** median (first-run JIT 1.5ms); value **56,680 tokens**, `source: "estimated"` | no timing bound (field asserts only) |
| `contextMeter()` warm read, same history, 1,000 consecutive reads | same | median **0.405ms/read**, 426ms total — **identical to the cold read**: no cache exists today | none; this is G5 / Task 4's target |
| `estimateMessageTokens(messages, family)` one pass over 209,700 chars | `src/__tests__/usage-estimation.test.ts:L124–L131` | runs `[0.52, 0.53, 0.47, 0.50, 0.48]ms` → **0.50ms** median (≈0.24ms/100k), 56,680 tokens | `<100ms` wall fence; comment target `<0.1ms/100k` — the fence catches gross regressions only |
| `measureInputCost` one pass: 200k-char groups + 8 tools + 1 context block + 1 skill | `src/__tests__/attention-compiler-stages.test.ts:L89` (equality, no timing) | family estimator `[2.02, 1.18, 0.89, 0.88, 0.89]ms` → **0.89ms**, 57,477 tokens; default ÷4 estimator `[0.08, 0.04, 0.04, 0.03, 0.03]ms` → **0.04ms**, 53,153 tokens | no timing bound |
| plan-091 drift, messages portion: seam `estimateMessageTokens` vs `measureInputCost` (same family estimator) | `src/__tests__/usage-estimation-fallback.test.ts:L89–L90` (asserts equality on the no-tools case only) | **+0.9%** (1,347 vs 1,335); on the 200k body **0.0%** (56,867 vs 56,850) | none |
| plan-091 drift, extras (tools+context+skills): `JSON.stringify` projection vs `measureAll` | suite fixture `src/__tests__/usage-estimation-fallback.test.ts:L203–L232` (4k-char description, empty schema) | **+24.7%** (873 vs 700); total request **+9.1%** (2,220 vs 2,035) | none (outside Task 6's 5% band) |
| plan-091 drift, extras with a realistic 5-property tool schema (8 tools) | `src/__tests__/tool-search.test.ts:L28–L29` shape widened to a real schema | **+182.9%** (1,980 vs 700); total request **+63.5%** (3,327 vs 2,035); against the assembler's default ÷4 basis **+77.0%** (3,327 vs 1,880) | none |

Consequences the later tasks carry: the 200k meter cold read (0.47ms) is already inside a frame budget,
so Task 4's win is not raw speed but repeat-read cost (1,000 polls today = 426ms of estimator work, all
of it avoidable); Task 6's 5% band is achievable only for the messages portion (+0.9%) — the extras must
switch to `measureAll`'s projections, because `JSON.stringify`'s full parameter schema is the measured
+182.9% outlier; and the report path costs no extra pass because `applyContextBudget` already paid it
(`src/attention-compiler.ts:L495`).

---

## 6. Security confirmations and hard rejections

- **No network call on the default path.** `estimateTurnUsage` (`src/agent-session/session/provider-round.ts:L171`) and
  `contextMeter()` (`src/agent-session/session.ts:L253`) stay pure/in-memory. Task 3's vendor legs are env-gated
  `scripts/*.test.mjs` files outside `GATE_FILES` (`scripts/run-all-tests.mjs:L30–L72`) and outside the
  root `dist/__tests__/*.test.js` glob (`:L106–L109`). Any design that puts a count-tokens request on the
  default estimate path is rejected here (R2).
- **No tokenizer dependency in the runtime.** The repo ships heuristics; the count endpoints are dev-time
  evidence (R2/R8). R9 keeps the legs in the root package rather than exporting provider transports.
- **One estimator path only.** No parallel table, no forked projection, no adapter-local estimate
  (R21). Task 6 reuses `MODEL_FAMILY_TOKENS` + `measureAll`'s projections (`src/context-budget.ts:L368`) and
  the report the assembler already measured; Task 3 asserts the shipped rows rather than adding rows.
- **No mutable module-level ratio registry.** The measured fact is that `MODEL_FAMILY_TOKENS` is
  compile-time `Readonly` only (G11); a host with measured numbers passes them explicitly through
  `contextBudget.tokenEstimator` (validated by `resolveTokenEstimator`) or not at all (R3).
- **Refusal carries no content.** The Task 5 `ErrorInfo` names the turn and mode only — no request text,
  no message, no secrets; `redactSecrets` still runs on the retry path (`src/agent-session/session/provider-round.ts:L284`), and
  `failureClass` stays unset so cost/limit attribution is not fabricated.
- **Cache stores only public state.** Task 4's meter cache holds the already-public `ContextMeter` value
  plus identity keys (`snapshotGeneration`, `currentLeafId`, `activeLimits` identity, `activeInputMeter`
  reference) — no history copy, no message text, no estimator instance; the `snapshot()` identity guard
  (`src/agent-session/session.ts:L723`) is the model for never serving a stale value (R12).
- **Evidence files carry names, not secrets.** The calibration evidence records env var names, model ids,
  fixture ids, token counts, and the endpoint used; never a key or a vendor response body beyond the count
  (`docs/live-testing.md:L118`), and the matrix validator rejects secret-shaped values.
- **Fail closed stays intact.** Strict mode refuses instead of estimating; the constructor still throws on
  out-of-union values; `maxCost` remains fail-closed for usage-less turns in `"fallback"`/`"off"` (they
  charge a labeled estimate or nothing); `maxRequestBytes`/`maxResponseBytes` ceilings are untouched.

---

## 7. Evidence-artifact scope

Read-only for the tree: this file adds no code, no test, no docs navigation. `docs/index.md` is not touched
(evidence files are not navigation targets, `.agents/skills/create-plan/references/prism-wiki.md`).
Tasks 2–6 must cite a row from §1/§2/§3; any new primitive a later task needs that is absent here is a
review gap and must be added to §3 before implementation.
