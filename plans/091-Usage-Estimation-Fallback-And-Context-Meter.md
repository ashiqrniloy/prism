# Usage Estimation Fallback and Context Meter

Release: 0.9.0 (P1). Closes the clay token-meter gap: models that report no usage get a labeled estimate; a context-meter primitive is exposed in run state.

## Objectives
- Per-model-family chars/token estimation, exposed when a provider reports no usage; estimates always labeled, never conflated with reported usage.
- A `contextMeter` read on the session/run: estimated input tokens, cap, budget, ratio — the primitive clay needs for its UI.

## Expected Outcome
- Clay deletes its planned hand-rolled heuristic table; every model shows a working context meter (estimate or reported, labeled).
- Budget axes from plans 086/087 work on non-reporting models too.

## Tasks

- [x] Task 1: Estimator contract + model-family tables
  - Acceptance Criteria:
    - Functional: `estimateMessageTokens(messages, modelFamily)` exported from prism-core contracts; family tables for anthropic/openai/google/deepseek/openrouter-generic/mistral classes with chars/token ratio + per-message overhead; unknown family = conservative default with `lowConfidence` flag.
    - Performance: O(message bytes); < 0.1ms per 100k chars; pure function, no allocations beyond result.
    - Code Quality: One table module, typed constants; `estimateMessageTokens`/`estimateEntryTokens` in `packages/memory/src/util.ts` (existing) reused, not forked.
    - Security: Pure function; no network; no content retention.
  - Approach:
    - Documentation Reviewed:
      - `packages/memory/src/util.ts` (`estimateMessageTokens`, `estimateEntryTokens`), `docs/runs-and-usage.md`, `docs/model-registry.md`.
    - Options Considered:
      - Force hosts to supply tokenizer: rejected — clay would hand-roll exactly that.
      - Approximate char-ratio tables per family: chosen; lit-consistent (harnesses universally approximate).
    - Chosen Approach: Family table + heuristic blocks (code blocks ~3.5 chars/token, prose ~4, CJK ~1.5) + tool-schema estimate.
    - API Notes and Examples:
      ```ts
      import { estimateMessageTokens } from "@arnilo/prism";
      const est = estimateMessageTokens(messages, "claude-sonnet-4.5"); // { tokens: 41_200, confidence: "medium" }
      ```
    - Files to Create/Edit:
      - `src/contracts-core/usage.ts` (or existing usage contract module): estimator types.
      - `src/usage-estimation.ts`: table + implementation; export from `src/index.ts`.
    - References: clay token-meter roadmap item; "missing usage is never zero usage" accounting rule.
  - Test Cases to Write:
    - Known-fixture messages: estimate within ±15% of a real tokenizer on sampled fixtures.
    - Unknown family: conservative default + lowConfidence.
    - CJK-heavy content ratio branch.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new export.
    - Docs pages to create/edit: `docs/runs-and-usage.md` (estimation section, confidence labels).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Execution note (2026-09-18): shipped. `src/contracts-core/usage.ts` (new): `ModelFamily`, `TokenEstimateConfidence`, `TokenEstimate` (`tokens`, `confidence`, `lowConfidence`). `src/usage-estimation.ts` (new): `MODEL_FAMILY_TOKENS` table (chars/token + per-message overhead + confidence per family), `ModelFamilyTokens` row type, `resolveModelFamily` (model id / provider id / explicit family name → table key; unmatched = `unknown`), and the pure text estimator with CJK (1.5 chars/token) and fenced-code (prose ratio × 0.88) ratio branches. `src/index.ts` publishes the contract types, the table, `resolveModelFamily`, and the new array form of `estimateMessageTokens`; the text-level `estimateTextTokensForFamily` stays module-level. **Deviation 1:** `estimateMessageTokens` already existed in `src/context-budget.ts` (single message, injected `TokenEstimator`) and `estimateEntryTokens` does not live in `packages/memory/src/util.ts` — the memory copies are `packages/memory/src/compaction/{llm,observational-memory}/tokens.ts`. Reuse-not-fork was honored by overloading the existing `context-budget` function instead of adding a second estimator: `estimateMessageTokens(messages, modelFamily)` reuses the same per-message flattening, applies the family ratio, and adds one per-message overhead; entry-token accounting was left untouched (no new fork added). **Deviation 2:** ratio provenance is measured, not the folk heuristic — the `openai` row is calibrated against tiktoken `o200k_base` fixture counts (prose 46, system prompt 56, history 50, fenced code 23, tool-call JSON 23, CJK 27, mixed 73 tokens), the other rows use published family guidance rounded toward over-counting, and `unknown` (3.5 chars/token, overhead 6) is the most conservative row. **Deviation 3:** the plan's fixed "code ≈ 3.5 chars/token" is expressed relative to the family ratio (×0.88) so code stays denser than prose on every row. `src/__tests__/core-boundaries.test.ts`: the provider-literal invariant now allows exactly `src/contracts-core/usage.ts` + `src/usage-estimation.ts` as the sanctioned family-name home (ratio keys and model-id patterns only, never behavior branches); every other core file stays literal-free. Gates updated for the +7 src export names: `FROZEN_VALUE_EXPORTS`/`FROZEN_TYPE_EXPORTS` in `public-export-contract.test.ts`, `scripts/budgets.json` `@arnilo/prism` 1388 → 1398 (folds the recorded-but-unbaselined plan 088 Task 4 +3), and `node scripts/package-truth.mjs --emit-docs` (which also picked up prior-plan drift: the prefix-stability subpath rows in `docs/index.md`/`docs/release-and-install.md` and the phase 54 export counts). Tests: `src/__tests__/usage-estimation.test.ts` 7/7 (±15% vs the o200k_base references including CJK, unknown-family conservative + `lowConfidence`, CJK branch ordering, model-id resolution table, per-message overhead, purity/no-retention, 100k-char envelope measured ~2ms vs the 0.1ms/100k target); `context-budget`, `attention-compiler-*`, `core-boundaries`, `public-export-contract`, `public-contracts`, `docs` suites and the budget/truth/packaging/full-surface/dead-export/tooling gates plus `npm run typecheck` all green. Root suite 1908/1909 — the single failure is pre-existing and unrelated: `network-free-guard` flags plan 089's untracked `packages/memory/src/rag/__tests__/local-reranker.test.ts`, which monkey-patches `globalThis.fetch` to prove no network after load. Docs: `docs/runs-and-usage.md` gained the token-estimation section (labels, table, resolution, unknown fallback, purity).

- [x] Task 2: Fallback integration in `recordUsage` path + `contextMeter`
  - Acceptance Criteria:
    - Functional: When a provider turn finishes with no usage and estimation is enabled (`usageEstimation: "fallback" | "off"`, default fallback), `recordUsage` receives a labeled estimate `{ estimated: true, confidence }`; reported usage never overwritten. `session.contextMeter()` returns `{ inputTokens, source: "reported" | "estimated", inputCap, runInputBudget, usedRatio }`.
    - Performance: Estimation only on missing-usage turns; contextMeter is a state read.
    - Code Quality: Single integration point at the existing `recordUsage` seam in `provider-round.ts`; no per-adapter changes.
    - Security: Estimates marked in accounting exports so billing surfaces can distinguish (audit rule: estimated usage never silently equals reported).
  - Approach:
    - Documentation Reviewed: `src/agent-session/session/provider-round.ts` `recordTurnUsage`; `docs/runs-and-usage.md`.
    - Options Considered:
      - Estimate inside each adapter: rejected — twelve copies, drift.
      - Core seam fallback: chosen.
    - Chosen Approach: Core fallback + contextMeter derived from run state (reuses plan 086 budget resolution).
    - API Notes and Examples:
      ```ts
      session.on("provider_turn_finished", (e) => e.usage.estimated); // true
      session.contextMeter(); // { inputTokens: 43_000, source: "estimated", inputCap: 200_000, usedRatio: 0.215 }
      ```
    - Files to Create/Edit:
      - `src/agent-session/session/provider-round.ts`: fallback invocation.
      - `src/agent-session/session/types.ts` / session host: `contextMeter()`.
      - usage contract: `estimated`, `confidence` fields.
    - References: clay token meter; synapta model-router budgets consume meter.
  - Test Cases to Write:
    - Non-reporting provider: estimate recorded, flagged; reporting provider: untouched.
    - `usageEstimation: "off"`: absent usage stays absent (never zero).
    - contextMeter ratio consistent with plan 086 run-input-budget resolution.
    - Accounting export distinguishes estimated vs reported.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — usage fields, session method, option.
    - Docs pages to create/edit: `docs/runs-and-usage.md` (fallback + meter); `docs/options-index.md` (`usageEstimation`).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Execution note (2026-09-18): shipped. One seam, no adapter changes: `recordProviderUsage(ctx, turnUsage, turn, attempt, request?)` in `src/agent-session/session/provider-round.ts` now estimates when `turnUsage` is undefined and `AgentConfig.usageEstimation !== "off"`, skipping `withCatalogCost` for estimates (a catalog quote on estimated tokens would invent billing) and returning the effective usage so `recordUsage`'s caller emits it. `assemble.ts` passes the post-policy `middlewareRequest` (the exact request the provider saw) into that seam. Estimate scope: `estimateMessageTokens(request.messages, model.model)` (family table + per-message overhead) plus the JSON-rendered tool declarations/context blocks under the same family ratio — no second request-cost path, and only on missing-usage turns. `Usage` gained `estimated?: boolean` and `confidence?: TokenEstimateConfidence`; `createUsageAccumulator` propagates them so `AgentRunResult.usage` and the `run_total` ledger row never lose provenance, and the `provider_turn_finished` event/budgets carry the same figure. New `ContextMeter` contract (`src/contracts-core/usage.ts`) + `AgentSession.contextMeter()` (`src/agent-session/session.ts`): `inputTokens`/`source` come from `SessionHost.activeInputMeter` (set by the seam on every provider turn: `reported` when the provider reported, else `estimated`), falling back to a labeled estimate of stored history before any provider turn; `inputCap` reuses `resolveTurnInputCap` (now exported from `provider-round.ts` instead of forking a second cap resolver — the reason for one of the two budgeted exports), `runInputBudget` is `RunLimits.maxInputTokens` while a run is active, and `usedRatio = inputTokens / inputCap`; cap/budget/ratio are omitted when undialed. Manual `compact()` drops the pre-compaction reading. Constructor fails closed on an `usageEstimation` value outside the union. `packages/memory`'s observational-memory `AgentSession` proxy now delegates `contextMeter()` (the only structural session wrapper in the repo). **Deviation 1 (consequence, kept):** estimates now charge `maxInputTokens`/`maxTotalTokens` — that is the point of "plan 086/087 axes work on non-reporting models", but it changes behavior for that population: a non-reporting provider gets no free pass on the default 40k/50k budgets. The plan-041 pick-accuracy fixture in `src/__tests__/tool-search.test.ts` (a 128-tool prompt, provider reporting nothing) therefore hit the default budgets, so that batch now runs with `{ maxInputTokens: null, maxTotalTokens: null }` — the test measures pick accuracy, not budget enforcement. **Deviation 2:** `docs/runs-and-usage.md`'s run-limits paragraph claimed usage-less vendors charge zero to the counters; now it says they charge their labeled estimate (or zero with `"off"`) and still never a price, so `maxCost` stays the fail-closed envelope. **Deviation 3 (root-cause fix outside the plan's file list):** `prism-core`'s conversation export could live-lock on cursors — the byte backstop refused a page whenever `pageCursor !== undefined`, so a page larger than `exportBytes` was handed back as the same cursor forever (the test watching it is literally named "export must converge"). The estimate's added event bytes turned that latent flake into a near-constant failure, so the condition is now `bytes > 0 && bytes + pageBytes > limits.exportBytes`: every `export()` call takes at least one page, guaranteeing cursor progress; `packages/prism-core` conversations 16/16 across 6 consecutive runs. Tests: `src/__tests__/usage-estimation-fallback.test.ts` 6/6 (estimate in event + both ledger rows + run totals + budgets, reported provider untouched, `off` leaves usage absent and records nothing, catalog never quoted for estimates, unknown family = low confidence, tool declarations grow the estimate and charge the run input axis); full `npm test` now 5/6 stages green (build, build race, gate suites, workspace suites, perf budget) — the only failing stage is the pre-existing `network-free-guard` root suite failure against plan 089's untracked memory test. Budgets `@arnilo/prism` 1398 → 1400 (`ContextMeter` + `resolveTurnInputCap`), `FROZEN_TYPE_EXPORTS` updated, `package-truth --emit-docs` regenerated, `docs/options-index.md` + `docs/agent-session-runtime.md` route to the new `usageEstimation`/`contextMeter` docs in `docs/runs-and-usage.md`.

## Compromises Made

- **Heuristic ratios, not tokenizers.** Tables are calibrated against one tokenizer family plus published ranges; another vendor's tokenizer can drift outside ±15%, and the conservative direction (over-counting, `unknown` row) means an unlisted model id can show a larger meter than reality. Labeled as estimate, never as billed usage.
- **Estimates charge the run budgets.** Needed so attention axes and run limits work on non-reporting models, but it means those providers now consume the default 40k input / 50k total token budgets instead of slipping through. `usageEstimation: "off"` restores the old accounting; a host that wants measurement without enforcement raises/disables the token axes.
- **Cost-limited runs stay fail-closed for usage-less vendors.** Estimates are never priced (correct for billing), so `maxCost` cannot be enforced from them and the existing fail-closed breach behavior is unchanged.
- **`contextMeter()` re-estimates stored history per call when no turn has recorded tokens** (fresh session, or after a manual compaction). It is an in-memory O(context bytes) read, not a cached state field; a host polling it per frame should cache its own read.
- **`usedRatio` is against the per-request `inputCap`, not the run budget** (matching `provider_turn_finished.budgets`); the cumulative axis is exposed separately as `runInputBudget`.
- **The request estimate is a text approximation** of messages + JSON-rendered tools/context, not the assembler's exact group cost; the assembler's `measureInputCost` needs pre-flatten groups that no longer exist at the usage seam.
- **`prism-core` export paging was fixed beyond the plan's file list** (1-line progress guarantee) because the new event bytes exposed a live-lock; the fix is generic, not estimate-specific.
- **No per-run `usageEstimation` override** — the switch is agent-wide, so one session cannot mix fallback and off.

## Further Actions

- P2: per-family calibration fixtures for the non-openai rows (Anthropic/Google tokenizers) once hosts can supply measured counts, replacing published-range guesses.
- P2: surface reported vs estimated side by side in `TurnBudgets` (e.g. `inputTokensSource`) so dashboards do not have to inspect `usage.estimated`.
- P3: cache the stored-history estimate inside `contextMeter()` keyed on the session snapshot generation, if a host polls the meter per animation frame.
- P3: add a `"strict"` estimation mode (fail or flag the turn when a provider reports nothing) for hosts whose cost gates cannot tolerate approximations.
- P4: reuse the assembler's exact group measurement for the estimate if a seam exposes the assembled groups to the usage callback.
