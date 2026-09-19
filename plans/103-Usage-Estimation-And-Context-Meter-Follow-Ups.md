# Usage Estimation and Context Meter Follow-Ups: Calibration Evidence, Turn Provenance, and Exact Measurement

Release: 0.9.x follow-up to plan 091, recorded from that plan's Further Actions. Not part of plan 099's 0.9.0 cut unless a host pulls it forward first: plan 091 already ships correct, documented, labeled-estimate behavior, and these tasks turn its heuristics into measured rows, its event provenance into a field a host can read without inspecting `usage.estimated`, and its meter into a state read that is safe to poll.

## Objectives
- Put a machine behind the `anthropic` and `google` family rows: a recorded calibration corpus plus env-gated vendor `count_tokens`/`countTokens` legs, so a table row is evidence a maintainer can re-measure instead of a published-range guess.
- Make turn provenance first-class on the event hosts already read: `TurnBudgets` gains `inputTokensSource`, so a dashboard can label `provider_turn_finished` numbers without knowing plan 091's flag.
- Make `session.contextMeter()` cheap enough to poll per animation frame: cache the stored-history estimate behind the session's existing snapshot generation, invalidated by every history mutation and run boundary.
- Give cost-gated hosts a mode that cannot silently run unpriced: `usageEstimation: "strict"` refuses a usage-less turn with a named, machine-readable error instead of either estimating or leaving accounting accidentally absent.
- Close the estimate/assembler drift: reuse the assembler's own measured request cost (and a host-injected tokenizer, when present) for the fallback instead of a second text projection.

## Expected Outcome
- `src/__tests__/usage-calibration.test.ts` pins the shipped rows against checked-in reference counts, and `scripts/usage-calibration-live.test.mjs` (live matrix `calibration/vendor-count-tokens`) refreshes those references from `POST /v1/messages/count_tokens` and `POST /v1beta/models/{model}:countTokens`, writing `docs/_evidence/phase103-family-token-calibration.md`.
- A `provider_turn_finished` consumer reads `budgets.inputTokensSource` (`"reported"` | `"estimated"`) and never has to cross-reference `usage.estimated`; the timeline projection carries the same field.
- Repeated `contextMeter()` reads over an unchanged history return the same frozen value with no estimator work; an append, a `compact()`, or a run boundary produces a fresh one.
- `usageEstimation: "strict"` ends a usage-less turn with `AgentRunResult.error.code === "usage_missing"`, one attempt, no ledger usage row, no catalog call, and no `failureClass` (it is not a provider failure).
- When the assembled request carries a `ContextBudgetReport` or the agent injects `contextBudget.tokenEstimator`, the fallback estimate is derived from that measurement (labeled `estimated: true`, `confidence: "high"` for a host tokenizer) and stays within 5% of `measureInputCost` on the shared fixtures.
- `docs/runs-and-usage.md` states, per path, which measurement the estimate used, and the recalibration procedure for the family table.

## Tasks

- [ ] Task 1: Primitive review — reuse seams for provenance, calibration, meter caching, strict refusal, and exact measurement
  - Acceptance Criteria:
    - Functional: `docs/_evidence/phase103-primitive-review.md` exists with three sections — (a) reuse rows for every primitive the later tasks build on, each with a `path:line` span, (b) gap rows naming what no current seam does, (c) rejected alternatives with the reason (including every item in the Rejected list below).
    - Functional: the review states per later task whether it reuses a seam as-is, extends a seam, or adds a new one — Task 2 (`TurnBudgets` at `src/contracts-core/provider.ts:98` + `turnBudgets()` at `src/agent-session/session/provider-round.ts:75`), Task 3 (`MODEL_FAMILY_TOKENS` at `src/usage-estimation.ts:30` + `estimateMessageTokens` array form at `src/context-budget.ts:96` + `scripts/live-matrix.json` entry shape), Task 4 (`contextMeter()` at `src/agent-session/session.ts:246` + `snapshotCache`/`snapshotGeneration` at `:711`/`:212`), Task 5 (`usageEstimation` union at `src/contracts-core/agent.ts:98` + `ProviderTurnFailure` at `src/agent-session/helpers.ts:91` + the observable rethrow in `generateWithRetry`), Task 6 (`measureInputCost` at `src/context-budget.ts:331` + `measureAll` at `:368` + `getContextBudgetReport` at `:147` + `resolveTokenEstimator` at `:350`).
    - Performance: the review records the measured cost of the paths it cites — one `contextMeter()` history estimate over a 200k-char history, one `measureInputCost` pass, one `estimateMessageTokens(messages, family)` pass, and the plan-091 estimate-vs-measure drift — from the shipping suites rather than restating the plan's claims.
    - Code Quality: the review is deterministic evidence, not prose; every reuse row names the exact exported symbol, every gap row names the file that would have to change, and each rejected alternative names the task it would have affected.
    - Security: the review explicitly rejects any design that adds a network call to the default path, a tokenizer dependency to the runtime, a second estimator path (a parallel table or a forked projection), and a mutable module-level ratio registry (a host with measured numbers must pass them explicitly or not at all).
  - Approach:
    - Documentation Reviewed:
      - Plan 091 `Compromises Made` + `Further Actions` (the source of every task here); `docs/runs-and-usage.md:70-104` (estimation, fallback, meter).
      - `docs/execution-timeline.md:123` (`TurnBudgets` in the timeline projection), `docs/live-testing.md` (gate/strict/report conventions), `docs/provider-caching.md` (n/a, checked for overlap).
    - Options Considered:
      - Per-run `usageEstimation` override — rejected here: the agent-wide switch is the documented contract, two agents cover the mixing case, and no host has asked; recorded as a rejected row rather than a task.
      - In-tree tokenizer dependency (tiktoken or a vendor tokenizer WASM) — rejected: adds a runtime dependency to ship a *better guess*; the vendor count-tokens legs give evidence without it.
      - Global calibration registry so a host can override rows — rejected: hidden mutable state in a pure estimator (`src/usage-estimation.ts:1-15` is pure by design); a host that needs exactness injects `contextBudget.tokenEstimator` (Task 6).
      - Implement directly without a review artifact — rejected by the create-plan primitive rule: Tasks 2, 4 and 5 change contracts (`TurnBudgets`, `contextMeter()` internals, the `usageEstimation` union), and Tasks 3 and 6 change measurement provenance, so the reuse/gap decision needs one evidence file.
    - Chosen Approach: one evidence file mapping every 091 Further Action to an existing primitive or a named gap, with spans and measured costs, before any task touches code.
    - API Notes and Examples:
      ```text
      reuse: src/contracts-core/provider.ts:98        TurnBudgets                    → Task 2
      reuse: src/agent-session/session/provider-round.ts:75 turnBudgets()            → Task 2
      reuse: src/usage-estimation.ts:30                MODEL_FAMILY_TOKENS           → Task 3
      reuse: src/agent-session/session.ts:711          snapshotCache + generation    → Task 4
      reuse: src/agent-session/helpers.ts:91           ProviderTurnFailure           → Task 5
      reuse: src/context-budget.ts:331                 measureInputCost              → Task 6
      gap:   src/agent-session/session/provider-round.ts:169 estimateTurnUsage projection → Task 6
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase103-primitive-review.md` (new).
    - References:
      - Plan 102 Task 1 review (`docs/_evidence/phase102-primitive-review.md`) as the artifact shape; plan 074 Task 1 review (`docs/_evidence/phase74-primitive-review.md`) for the span-citation expectation; `scripts/plan-review-gate.test.mjs` for the gate that keeps evidence files honest.
  - Test Cases to Write:
    - None (evidence artifact); the check is that every later task's Approach cites a row from this file.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (internal evidence).
    - Docs pages to create/edit: none (evidence file lives under `docs/_evidence/`).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (evidence files are not navigation targets).

- [ ] Task 2: `TurnBudgets.inputTokensSource` — provenance on the turn event (P2)
  - Acceptance Criteria:
    - Functional: `TurnBudgets` gains `inputTokensSource?: "reported" | "estimated"`, set by `turnBudgets()` from the effective usage (`usage.estimated === true` → `"estimated"`, else `"reported"` when `inputTokens` is present, absent when it is not). Nothing else on the event changes; `usage.estimated`/`confidence` remain the authoritative labels and are not removed.
    - Functional: the stale doc comment on `TurnBudgets.inputTokens` ("Provider-reported input tokens …; absent when the provider reported none") is corrected to state that the value may be a labeled estimate and to point at `inputTokensSource`.
    - Functional: the Execution Timeline projection carries the new field unchanged (it is a pass-through of `TurnBudgets`), so `docs/execution-timeline.md:123` documents it without projection code changes beyond any shape pin.
    - Performance: O(1) — one ternary inside the existing `turnBudgets()` snapshot call, no extra resolver, no extra request pass.
    - Code Quality: one field + one ternary; contract shape pins updated where they exist (`src/__tests__/public-contracts.test.ts`, the run-limits/timeline assertions that enumerate `budgets` keys); no new export name (type field only, so no `scripts/budgets.json` rebaseline).
    - Security: the field is a label only — it carries no content, no cost, and removes no cost-visibility rule (`maxCost` fail-closed behavior in `src/run-limits.ts:236` is untouched).
  - Approach:
    - Documentation Reviewed:
      - `docs/runs-and-usage.md:70-104` (fallback labels) and `:121` (outputs/events table), `docs/execution-timeline.md:123` (`budgets` row).
      - Plan 091 Task 2 execution note (why the effective, not the raw, usage reaches the event).
    - Options Considered:
      - Add `usageConfidence` to `TurnBudgets` too — rejected for now: `provider_turn_finished.usage.confidence` already carries it, and the further action asked for source, not a second confidence channel.
      - Rename `inputTokens` to `inputTokensReported`/`inputTokensEstimated` — rejected: a breaking shape change for a label problem.
      - Derive provenance host-side from `usage.estimated` — chosen baseline today; the field removes the cross-reference that plan 091's own docs had to spell out.
    - Chosen Approach: one additive optional field filled at the existing snapshot seam.
    - API Notes and Examples:
      ```ts
      session.on("provider_turn_finished", (e) => {
        e.budgets?.inputTokensSource; // "reported" | "estimated" | undefined
        e.usage?.estimated;           // unchanged, still the authoritative flag
      });
      ```
    - Files to Create/Edit:
      - `src/contracts-core/provider.ts` (`TurnBudgets` field + corrected `inputTokens` comment).
      - `src/agent-session/session/provider-round.ts` (`turnBudgets()` fill).
      - `src/__tests__/usage-estimation-fallback.test.ts` (extend) or a small `src/__tests__/turn-budget-provenance.test.ts`; shape-pin tests under `src/__tests__/`.
      - `docs/runs-and-usage.md`, `docs/execution-timeline.md`.
    - References:
      - `src/contracts-core/provider.ts:98` (`TurnBudgets`), `src/agent-session/session/provider-round.ts:75` (`turnBudgets`), `:340` (event emission), `src/contracts-core/content.ts` (`Usage.estimated`/`confidence`), `docs/execution-timeline.md:123`.
  - Test Cases to Write:
    - Reporting provider: `budgets.inputTokensSource === "reported"` and `usage.estimated` absent.
    - Non-reporting provider with the default fallback: `"estimated"`, `budgets.inputTokens` equals `usage.inputTokens`, and the ledger rows keep `estimated: true`.
    - `usageEstimation: "off"`: both `budgets.inputTokens` and `inputTokensSource` absent (never a zero, never a fabricated label).
    - Shape pin: the existing contract/timeline tests that enumerate `budgets` keys accept the new optional field, and a JSON round trip through the timeline projection keeps it.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — additive field on an existing public event payload.
    - Docs pages to create/edit:
      - `docs/runs-and-usage.md`: one line in the automatic-fallback section ("`budgets.inputTokensSource` labels the figure") and the outputs/events table row.
      - `docs/execution-timeline.md`: add the field to the `TurnBudgets` row.
    - `docs/index.md` update: no (pages exist).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 3: Family calibration — recorded fixtures plus vendor `count_tokens` live legs (P2)
  - Acceptance Criteria:
    - Functional: a checked-in corpus (`src/__tests__/fixtures/usage-calibration.json` or `.ts`) holds the fixed measurement texts (one prose passage, one CJK passage, one multi-turn chat transcript) and, per calibrated family, the recorded reference token counts; `src/__tests__/usage-calibration.test.ts` asserts the shipping estimate against each recorded count inside a documented band (prose ±12%, CJK ±20%, per-message overhead ±1 token) and fails with the measured-vs-shipped numbers when a row drifts.
    - Functional: `scripts/usage-calibration-live.test.mjs` is gated by `PRISM_LIVE_PROVIDER_TESTS` and skips per vendor with a reason naming the missing key; the Anthropic leg posts the corpus to `POST /v1/messages/count_tokens` (response `MessageTokensCount.input_tokens`) and the Google leg posts to `POST /v1beta/models/{model}:countTokens` with the `x-goog-api-key` header (`contents` → `totalTokens`), asserts the shipped row is inside the same band, and writes/refreshes `docs/_evidence/phase103-family-token-calibration.md` with model ids, fixture ids, recorded counts, measured vs shipped chars/token, date, and the token-counting endpoint used.
    - Functional: registered in `scripts/live-matrix.json` as `calibration/vendor-count-tokens` (`package: "@arnilo/prism"`, `command: "node --test scripts/usage-calibration-live.test.mjs"`, `cwd: "."`, `requires: ["PRISM_LIVE_PROVIDER_TESTS"]`, `requiresAny: ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]`, scope and cost lines naming the request count); `node scripts/live-matrix.mjs --check` is green and `node scripts/generate-live-docs.mjs --write` refreshes the generated doc tables so `scripts/live-doc-check.test.mjs:25` passes.
    - Performance: at most two count requests per vendor per run (no streaming, no generation), one fixed corpus; the deterministic fixture test is offline and stays under 5ms; the default `npm test` chain pays nothing (root suites glob `dist/__tests__/*.test.js` only, and the live legs are a `scripts/*.test.mjs` file that is not in `GATE_FILES`).
    - Code Quality: the legs reuse `MODEL_FAMILY_TOKENS`, `resolveModelFamily`, and `estimateMessageTokens` (`src/usage-estimation.ts:30`, `:52`, `src/context-budget.ts:96`) — no second estimator, no per-vendor ratio logic beyond the two request shapes; the guard rules in `src/__tests__/network-free-guard.test.ts:29`/`:37` hold (a live-named file names a `PRISM_LIVE_*` gate; the fixture test never touches `globalThis.fetch`).
    - Security: count-only requests over non-sensitive fixture text, credentials only from env/`scripts/live.env`, evidence carries env var *names* and model ids and never a key or a vendor response body beyond the token count; the skip-not-fail contract is preserved (strict mode fails the run, not the suite); `deepseek`, `mistral`, and `openrouter-generic` stay published-range rows because no public count endpoint exists — the docs say so instead of implying measurement.
  - Approach:
    - Documentation Reviewed:
      - Anthropic Messages count tokens: `POST /v1/messages/count_tokens` → `MessageTokensCount` (`/anthropics/anthropic-sdk-typescript`, `api.md`, verified 2026-09-18).
      - Gemini token counting: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:countTokens`, header `x-goog-api-key`, `contents` → `totalTokens` (`/websites/ai_google_dev_gemini_api`, `ai.google.dev/gemini-api/docs/tokens`, verified 2026-09-18).
      - `docs/live-testing.md` (skip-not-fail, `requiresAny`, report shape, model-env convention), `docs/runs-and-usage.md:70-92` (the ratio rows being calibrated), plan 091 Task 1 execution note (the o200k calibration method this generalizes).
    - Options Considered:
      - Runtime tokenizer dependency (tiktoken / vendor WASM) for exact counting in production — rejected: a runtime dependency to replace a labeled heuristic; the count endpoints give calibration evidence without shipping a tokenizer.
      - Deterministic fixtures only, no live legs — rejected: the rows are the point, and a maintainer needs a re-measure command; the plan-091 o200k numbers came from a one-off local venv, which is exactly the untraceable procedure this task replaces.
      - Weights/vocabulary files checked in — rejected: size, licensing, and staleness; recorded counts plus a re-measure leg are the durable form.
      - Put the legs in `packages/prism-providers` next to the vendor live suites — rejected: the table owner is the root package, and a root-level live script mirrors the existing `cli/journey` matrix convention; the provider packages would have to export their transports for a test-only need.
    - Chosen Approach: a recorded corpus + a deterministic drift test + env-gated vendor legs registered in the live matrix, with the evidence file as the maintainer's recalibration input.
    - API Notes and Examples:
      ```text
      # matrix check / run (credentials from scripts/live.env or the environment)
      node scripts/live-matrix.mjs --check
      PRISM_LIVE_PROVIDER_TESTS=1 ANTHROPIC_API_KEY=... node --test scripts/usage-calibration-live.test.mjs
      # evidence row regenerated at docs/_evidence/phase103-family-token-calibration.md
      ```
      ```ts
      const count = await countTokens("anthropic", { model: "claude-haiku-4-5", messages: corpusChat });
      const measured = corpusProse.length / count; // chars per token, asserted against MODEL_FAMILY_TOKENS.anthropic
      ```
    - Files to Create/Edit:
      - `src/__tests__/fixtures/usage-calibration.json` (new), `src/__tests__/usage-calibration.test.ts` (new).
      - `scripts/usage-calibration-live.test.mjs` (new), `scripts/live-matrix.json` (new suite row), `docs/_evidence/phase103-family-token-calibration.md` (generated), `docs/live-testing.md` (regenerated tables).
      - `src/usage-estimation.ts` + `docs/runs-and-usage.md` (only when the measured band fails — recalibrate the row and record the change).
    - References:
      - `src/usage-estimation.ts:30` (`MODEL_FAMILY_TOKENS` rows), `:64` (`estimateTextTokensForFamily`), `src/context-budget.ts:96` (array-form `estimateMessageTokens`), `src/__tests__/usage-estimation.test.ts` (plan 091 o200k fixtures), `scripts/live-matrix.json` (suite shape: `providers/anthropic`, `providers/google`), `scripts/live-matrix.mjs` (`--check`), `scripts/live-doc-check.test.mjs:25`, `scripts/run-all-tests.mjs:108` (root glob) and its `GATE_FILES` list.
  - Test Cases to Write:
    - Deterministic drift: each recorded count passes the band; a deliberately shifted row fails with both numbers in the message (negative control).
    - Unknown family: still conservative and `lowConfidence`, unaffected by calibration rows.
    - Live skip: no vendor key → skipped with a reason naming the exact env vars; strict mode (`PRISM_LIVE_STRICT=1`) fails the run, not the suite.
    - Live band: with a key present, the measured chars/token is inside the shipped row's band for prose, CJK, and the chat transcript (per-message overhead from `messages.length`).
    - Evidence generation: a run rewrites `docs/_evidence/phase103-family-token-calibration.md` deterministically for fixed counts (no timestamps asserted, model ids and counts present, no secret-shaped strings — reuse the live-matrix secret scan).
    - Matrix/docs freshness: `node scripts/live-matrix.mjs --check` and `scripts/live-doc-check.test.mjs` pass after the suite row is added.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the shipped rows' provenance and confidence narrative change (values only change if a measurement fails).
    - Docs pages to create/edit:
      - `docs/runs-and-usage.md`: how the rows were measured and the recalibration procedure (run the leg, update the row, refresh the fixture counts).
      - `docs/live-testing.md`: generated matrix row (regenerate, do not hand-edit).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 4: Snapshot-keyed context-meter cache (P3)
  - Acceptance Criteria:
    - Functional: `contextMeter()` returns the identical frozen object while the session history and run state are unchanged (same `snapshotGeneration`, `currentLeafId`, active-limits identity, and `activeInputMeter` reference), and a freshly computed one after: an appended entry (`snapshotGeneration` bump at `src/agent-session/session.ts:693`), `compact()` (`activeInputMeter` clear at `:423`), and a run boundary that changes `runInputBudget`/`activeLimits`.
    - Functional: the cache stores only the already-public meter value plus identity keys — no history copy, no message text, no estimator instance — so a warm read adds no memory that the meter did not already expose.
    - Performance: warm reads are O(1). Measured: 1,000 consecutive reads over a 200k-char history complete inside the task's budget (recorded in the execution note) with zero `estimateMessageTokens` calls; the cold read keeps plan 091's ~2ms envelope for the same history.
    - Code Quality: implemented as one private field mirroring the existing `snapshotCache` shape (`src/agent-session/session.ts:711-724`, keyed by `leafId` + `generation`) rather than a new cache utility; invalidations reuse the existing mutation points instead of a subscription; no new export (no `scripts/budgets.json` change).
    - Security: the cache key must include the same identity guard `snapshot()` uses, so a stale meter can never be served after history mutation; a host must not be able to observe a value that the uncached computation would not produce (asserted by a parity test).
  - Approach:
    - Documentation Reviewed:
      - `docs/runs-and-usage.md:94-104` (meter contract: provenance, cap/budget/ratio, `compact()` invalidation), `docs/agent-session-runtime.md` (session state reads).
      - Plan 091 Compromises ("`contextMeter()` re-estimates stored history per call when no turn has recorded tokens … a host polling it per frame should cache its own read") — this task moves that cache in-tree.
    - Options Considered:
      - Cache in the host (documented today) — rejected by the further action: every host rewrites the same generation gating, and the session already owns the invalidation points.
      - Cache the estimate on the entries/snapshot cache itself — rejected: `snapshot()` returns messages, the meter needs a number; coupling the two changes the snapshot cache's TTL semantics.
      - Memoize `estimateMessageTokens` globally — rejected: a global cache keyed by message content retains content and crosses sessions/redaction boundaries.
    - Chosen Approach: one session-private meter cache keyed like the existing snapshot cache, invalidated by the same generation counter plus the active-run identity.
    - API Notes and Examples:
      ```ts
      const a = session.contextMeter();
      const b = session.contextMeter();
      a === b;                     // true while history and run state are unchanged
      await session.stream("more"); // appends entries → generation bump
      session.contextMeter() === a; // false
      ```
    - Files to Create/Edit:
      - `src/agent-session/session.ts` (private cache field, key + invalidation, frozen value), `src/agent-session/session/types.ts` only if the key needs a type.
      - `src/__tests__/usage-estimation-fallback.test.ts` (extend) or `src/__tests__/context-meter-cache.test.ts` (new).
      - `docs/runs-and-usage.md` (one line).
    - References:
      - `src/agent-session/session.ts:123` (`activeInputMeter`), `:212` (`snapshotGeneration`), `:246` (`contextMeter`), `:423` (compact clear), `:693` (generation bump), `:711` (`snapshotCache` read), `:720` (cache write), `src/context-budget.ts:96` (array-form estimate), `src/run-limits.ts` (`RunnerLimitTracker` snapshot used for `runInputUsed`/`runInputBudget`).
  - Test Cases to Write:
    - Identity: two reads with no mutation return the same object; the value is frozen.
    - Invalidation: append, `compact()`, and a run start/end each produce a new object with the expected changed field (`inputTokens` after append for a fresh session, `runInputBudget` while a limited run is active, `source` after a provider turn).
    - Parity: after forcing invalidation, the cached value deep-equals a freshly computed one (no stale-field drift).
    - Poll cost: 1,000 warm reads over a 200k-char history inside the recorded budget; a cold read still lands in the plan-091 envelope.
    - Cross-session isolation: two sessions over different histories do not share a value.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `contextMeter()` gains documented caching semantics (same value, same lifetime rules).
    - Docs pages to create/edit:
      - `docs/runs-and-usage.md`: one sentence in the meter section ("reads are cached until the history generation or run boundary changes").
      - `docs/agent-session-runtime.md`: only if its meter row restates per-call cost.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 5: `usageEstimation: "strict"` — refuse a usage-less turn instead of estimating (P3)
  - Acceptance Criteria:
    - Functional: `usageEstimation` accepts `"strict"` (`src/contracts-core/agent.ts:98`); under strict the seam records no estimate and refuses a usage-less turn with a typed, machine-readable error: `ProviderTurnFailure` (`src/agent-session/helpers.ts:91`) carrying `{ name: "UsageMissingError", code: "usage_missing", message }` and `observable: true`, so `generateWithRetry`'s observable rethrow ends the run on the error path with `AgentRunResult.error.code === "usage_missing"` and exactly one attempt. No `failureClass` is stamped (the docs say it is advisory provider-failure metadata; this is a harness refusal).
    - Functional: under strict, a usage-less turn writes no ledger usage row and no `run_total` aggregate, never consults the cost catalog, and leaves `usage` absent rather than zero; a reporting provider and `"off"` are unaffected.
    - Functional: the option doc (`AgentConfig.usageEstimation` comment) and `docs/options-index.md` state the three modes and the refusal code; the constructor still fails closed on any other value (existing `TypeError`).
    - Performance: zero estimator work under strict — the refusal happens before any message flattening; the non-strict paths are untouched (no added branch in `estimateTurnUsage`'s cost).
    - Code Quality: one union member, one branch in the existing seam, and one refusal construction reusing `ProviderTurnFailure` — no new error class, no new stop reason, no adapter change; plan 100's terminal-event predicate is referenced for the event that carries the refusal but is not a dependency.
    - Security: a host with cost gates gets an explicit refusal instead of an accidental `maxCost` breach from missing usage (`src/run-limits.ts:236`) or a silent absent row; the error info carries the turn number and mode only — no request content, no secrets.
  - Approach:
    - Documentation Reviewed:
      - `docs/runs-and-usage.md:83-92` (fallback/off semantics), `:105-117` (clean stops and provider failure classes — why `failureClass` is not stamped), `:121` (outputs/events table for `AgentRunResult.error`).
      - Plan 091 Compromises (cost-limited runs stay fail-closed; `maxCost` breach on missing usage) and its Further Action asking for a strict mode.
    - Options Considered:
      - Strip usage and continue under strict (flag-only) — rejected: a host whose cost gates cannot tolerate approximations needs the run to stop, and the run already stops today via the `maxCost` breach with a confusing `budget_exhausted` attribution.
      - Emit a new failure class or stop reason — rejected: not a provider failure and not a loop ceiling; `ErrorInfo.code` plus the event error path is the existing surface plan 087/100 already deliver.
      - New `UsageMissingError` class exported from the package — rejected: `ProviderTurnFailure` + `errorFromInfo` already produce the `code`/`name` on the public error; a class adds an export and a budget line for no new host capability.
      - Make strict the default — rejected: it would break every non-reporting vendor host that voluntarily opted into the documented fallback.
    - Chosen Approach: a third mode value that turns the existing fallback branch into a refusal, reusing the documented observable-failure path.
    - API Notes and Examples:
      ```ts
      const agent = createAgent({ model: { provider: "mock", model: "offline" }, usageEstimation: "strict", ... });
      const result = await runAgent(agent, "hello");
      result.error?.code;            // "usage_missing"
      result.error?.failureClass;    // undefined — harness refusal, not a provider failure
      ```
    - Files to Create/Edit:
      - `src/contracts-core/agent.ts` (union + doc comment), `src/agent-session/session/provider-round.ts` (`estimateTurnUsage`/seam branch), `src/agent-session/session.ts` (constructor validation message if it enumerates modes).
      - `src/__tests__/usage-estimation-fallback.test.ts` (extend) or `src/__tests__/usage-estimation-strict.test.ts` (new).
      - `docs/runs-and-usage.md`, `docs/options-index.md`.
    - References:
      - `src/agent-session/session/provider-round.ts:127` (`recordProviderUsage`), `:169` (`estimateTurnUsage`), `generateWithRetry`'s `if (!policy || failure?.observable) throw errorFromInfo(info)` rethrow, `src/agent-session/helpers.ts:82` (`errorFromInfo`) and `:91` (`ProviderTurnFailure`), `src/contracts-core/agent.ts:98`, `src/run-limits.ts:236` (`recordUsage(undefined)` → `maxCost` breach), `docs/runs-and-usage.md:105-117`.
  - Test Cases to Write:
    - Strict + non-reporting: run rejects with `error.code === "usage_missing"`, one provider attempt (no retry despite a permissive retry policy), no `provider_turn_recorded`/usage ledger row, no `run_total` aggregate, catalog `get` never called.
    - Strict + reporting provider: run completes, `budgets.inputTokensSource === "reported"`, no error.
    - `"off"`: unchanged — no estimate, no error, absent usage; `"fallback"`: unchanged estimate.
    - Constructor: an out-of-union value still throws `TypeError` naming the allowed modes.
    - Mode interaction: a usage-less turn under strict while `maxCost` is set fails with the refusal (not a `budget_exhausted` breach) — pins the precedence.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new `AgentConfig.usageEstimation` value, new public error code.
    - Docs pages to create/edit:
      - `docs/runs-and-usage.md`: mode bullets (`"fallback"` | `"off"` | `"strict"`), the refusal code, and the note that strict is not a provider failure.
      - `docs/options-index.md`: extend the `AgentConfig.usageEstimation` row.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 6: Exact-measurement reuse for the fallback estimate (P4)
  - Acceptance Criteria:
    - Functional: the fallback prefers, in order: (1) the request's own `ContextBudgetReport` (`getContextBudgetReport(request)` → `keptTokens`) for the post-eviction message-group portion, (2) the agent's injected `contextBudget.tokenEstimator` (through `resolveTokenEstimator`'s validation) for the projections, (3) the plan-091 family heuristic. Whichever path is used, tool declarations and context blocks are projected with the assembler's own text shapes (the `measureAll` tool-list line and `contextBlockText`), not `JSON.stringify`, so the estimate cannot drift from what the assembler measured.
    - Functional: on a request assembled with tools, context blocks, and skills, the estimate stays within 5% of `measureInputCost` for the same inputs (band test with the measured numbers in the failure message); the plan-091 `o200k_base` fixture targets (±15%) stay green on the heuristic path.
    - Functional: provenance stays honest — every path keeps `estimated: true`; a host tokenizer's count is labeled `confidence: "high"` (not `"reported"`), and the docs say per path which portion the estimate covers (a `ContextBudgetReport` covers post-eviction message groups only; the tokenizer/estimate path covers the whole request).
    - Performance: the report path adds no pass (it already ran in the assembler); the projection path replaces today's `JSON.stringify` with comparable O(request bytes) work; no per-message extra allocation on the heuristic path.
    - Code Quality: projection helpers live next to `measureAll` in `src/context-budget.ts` and stay module-private unless the seam needs one, in which case the task updates `src/index.ts`, the `FROZEN_VALUE_EXPORTS`/`FROZEN_TYPE_EXPORTS` pins, `scripts/budgets.json` (1400 → measured), and `node scripts/package-truth.mjs --emit-docs` in the same change; no second estimator table.
    - Security: no content is retained or logged by the reuse path; a report/tokenizer-derived number is still labeled an estimate (never billing), and the strict/off modes are unaffected.
  - Approach:
    - Documentation Reviewed:
      - `docs/runs-and-usage.md:70-92` (current estimate scope: "messages plus tool declarations and context blocks"), `docs/input-and-prompt-assembly.md` (groups, `assembleProviderInput`, `measureInputCost`), `docs/attention-compiler.md` (the compiler measures once per turn — the same measurement this reuses).
      - Plan 091 Compromises ("the request estimate is a text approximation … the assembler's `measureInputCost` needs pre-flatten groups that no longer exist at the usage seam") — this task closes that gap from the other side: use the measurement the assembler already made, and share the projections that are still needed.
    - Options Considered:
      - Thread the assembled groups into the usage seam (change `RoundContext`/`ProviderRequest`) — rejected: a carrier change across `assembleProviderInput` → middleware → adapter for an estimate; the report already travels on the request (`CONTEXT_BUDGET_REPORT_METADATA_KEY`, `src/context-budget.ts:67`).
      - Export a new `measureRequestInput(request)` public helper — deferred: only worth an export if a host asks; the task starts with the internal shared projections and adds the export (with budget rebaseline) only if the seam requires it.
      - Keep the family heuristic everywhere — rejected as the default now that a host tokenizer exists: a run whose budget decisions use the host's tokenizer but whose usage uses a chars/token heuristic shows two different numbers for the same request.
      - Reuse `ContextBudgetReport` for the whole estimate (tools/context included) — rejected: `keptTokens` covers message groups after eviction, not tool declarations or context blocks; claiming otherwise would under-count, which is the dangerous direction for a meter.
    - Chosen Approach: prefer the measurement that already exists, share the projection helpers that do not, and label which path produced the number.
    - API Notes and Examples:
      ```ts
      // host opts into exactness for both budgeting and usage:
      const agent = createAgent({
        contextBudget: { maxInputTokens: 200_000, tokenEstimator: (text) => myTokenizer.count(text) },
        usageEstimation: "fallback",
        ...
      });
      // provider reports nothing → usage.estimated: true, confidence: "high", inputTokens ≈ measureInputCost(...).tokens
      ```
    - Files to Create/Edit:
      - `src/context-budget.ts` (shared projections next to `measureAll:368`; `resolveTokenEstimator:362` reuse), `src/agent-session/session/provider-round.ts` (`estimateTurnUsage:169` path selection).
      - `src/__tests__/usage-estimation-fallback.test.ts` + a drift test (`src/__tests__/usage-estimation-drift.test.ts` or extension), possibly `src/index.ts` + pins + `scripts/budgets.json` + `scripts/package-truth.json` if a helper becomes public.
      - `docs/runs-and-usage.md`.
    - References:
      - `src/context-budget.ts:67` (`CONTEXT_BUDGET_REPORT_METADATA_KEY`), `:147` (`getContextBudgetReport`), `:316` (`MeasureInputCostOptions`), `:331` (`measureInputCost`), `:350` (`resolveTokenEstimator`), `:368` (`measureAll`), `:472` (`contextBlockText`), `:49` (`ContextBudgetReport.keptTokens`), `src/skill-disclosure.ts:85` (`skillPromptText`), `src/agent-session/session/provider-round.ts:169`, `src/agent-session/session/assemble.ts` (report attachment point via `applyContextBudget`), `src/__tests__/usage-estimation.test.ts` (plan 091 fixture bands).
  - Test Cases to Write:
    - Report path: a request carrying a `ContextBudgetReport` yields `inputTokens` equal to `keptTokens` + the tool/context projection (band), never the family ratio for the message portion.
    - Tokenizer path: a counting stub `tokenEstimator` produces the expected sum and `confidence: "high"`, with `estimated: true` still set and no cost.
    - Heuristic path: unchanged numbers for the plan-091 o200k fixtures and the unknown family.
    - Drift: assembled tools + context + skills → |estimate − `measureInputCost`| ≤ 5% (negative control: a request with a stale/absent report falls back to the heuristic and the drift bound is documented, not asserted).
    - Mode interaction: `"off"` and `"strict"` never take either reuse path; a host tokenizer is never consulted under `"off"`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the fallback's measurement source and confidence labeling change (values only when a report/tokenizer exists).
    - Docs pages to create/edit:
      - `docs/runs-and-usage.md`: which measurement each path uses, the `confidence: "high"` rule for host tokenizers, and the "post-eviction message groups only" caveat.
      - `docs/input-and-prompt-assembly.md`: one cross-reference that `contextBudget.tokenEstimator` also feeds usage estimation.
    - `docs/index.md` update: only if a helper becomes a public export (navigation entry not required for an existing page).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.