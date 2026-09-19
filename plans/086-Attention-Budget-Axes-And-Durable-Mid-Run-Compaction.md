# Attention Budget Axes and Durable Mid-Run Compaction

Release: 0.9.0 (P0). Closes synapta Plan 118 A1/A2 (folding inert when trigger ratio sits above the run input cap) and synapta H12 (no durable compaction for long Do runs).

## Objectives
- Generalize the attention-compiler trigger from a single `inputCap` ratio to host-programmable axes: run-input-budget ratio, absolute token floor, and custom predicate.
- Add a durable compaction mode for single-run loops: folding state persisted to the session store at task boundaries, surviving restart, distinct from the per-turn throwaway clone.
- Keep the existing `triggerRatio` default and behavior byte-identical when no new axis is configured.

## Expected Outcome
- A host can configure `attention.compiler.trigger = { kind: "run_input_ratio", ratio: 0.75 }` against a run input budget (e.g. 500k) instead of the model window, and folding engages before the run dies at its cap.
- With `durable: true`, a compacted run resumes from persisted folding state after process restart; the resumed transcript contains the same folded ledger a live run would have.
- Synapta's Plan 118 acceptance scenario (20-turn investigation on a 1M-window model under a 500k run cap) folds instead of terminating.

## Tasks

- [x] Task 1: Primitive review — trigger axes and compaction surfaces inventory
  - Acceptance Criteria:
    - Functional: Document every existing trigger/compaction primitive (`AttentionCompilerOptions`, `CompactionTrigger`, per-turn clone path, `compaction-observational-memory` seams) and mark which new axis/persistence needs are covered vs. genuinely new.
    - Performance: Inventory only; no runtime change.
    - Code Quality: Inventory recorded in this plan's Further Actions; no code changes.
    - Security: No new trust surfaces identified beyond session-store writes already present.
  - Approach:
    - Documentation Reviewed:
      - `docs/attention-compiler.md` (current contract)
      - `docs/compaction-and-retry.md`, `docs/compaction-observational-memory.md`, `docs/compaction-llm.md`
      - `src/contracts-core/attention.ts`, `src/attention-compiler.ts`
    - Options Considered:
      - Host-side wrapper that pre-empts turns by reading usage: rejected — hosts re-implement per host, prism owns the seam.
    - Chosen Approach:
      - Extend `AttentionCompilerOptions` with a discriminated-union trigger; reuse `CompactionTrigger` validation style.
    - API Notes and Examples:
      ```ts
      attention: {
        compiler: {
          trigger: { kind: "input_ratio", ratio: 0.75 },        // existing default
          // new:
          trigger: { kind: "run_input_ratio", ratio: 0.75 },    // vs run input budget
          trigger: { kind: "token_floor", tokens: 120_000 },
          trigger: (state) => state.estimatedInputTokens > 150_000,
        },
      }
      ```
    - Files to Create/Edit: none (inventory).
    - References: synapta Plan 118 A1/A2; clay roadmap attention-compiler adoption; arXiv:2609.14872 context-rot thresholds.

- [x] Task 2: Trigger axis union + run-input-budget resolution
  - Acceptance Criteria:
    - Functional: `createAttentionCompiler` accepts the four trigger kinds; unknown kind throws `TypeError` naming the option. `run_input_ratio` resolves against the run input budget (run limits/limits config), falling back to `inputCap` when no run budget is configured. Function triggers receive a frozen `AttentionTriggerState` (estimated input tokens, input cap, run input budget, turn index).
    - Performance: Trigger evaluation remains synchronous, O(1) per turn; no regression in attention-compiler unit tests.
    - Code Quality: Contract types exported from `src/contracts-core/attention.ts`; validation mirrors existing `resolveRatio` error style; no `any`.
    - Security: Predicate triggers execute host-supplied code — already host-trusted (same as existing options); document that in the option JSDoc.
  - Approach:
    - Documentation Reviewed: Task 1 inventory; `src/attention-compiler.ts` `createAttentionCompiler` crux.
    - Options Considered:
      - Multiple numeric options (`runTriggerRatio`, `tokenFloor`, ...) — rejected: combinatorial validation, no way to express "either fires".
      - Discriminated union + `ArrayInput<Trigger>` (any-of semantics) — chosen: single `trigger` kept backward-compatible as sugar for `{kind:"input_ratio",ratio}`; array form ORs.
    - Chosen Approach: Union type with `input_ratio` default; resolver returns "fired axis" for attribution (feeds plan 087).
    - Execution Notes (2026-09-18):
      - `trigger` **replaces** the `triggerRatio` axis (omitted ⇒ the single legacy axis, unchanged). `triggerRatio` stays the reference for the `compactRatio` invariant and the report, and takes the first `input_ratio` axis's ratio when a `trigger` supplies one and `triggerRatio` is omitted.
      - Fired-axis attribution is returned by the exported `evaluateAttentionTrigger(axes, state)` and reported as the additive `AttentionReport.firedAxis`; `AttentionCompiler` stays frozen, so the sketched mutable `compiler.lastFiredAxis` was dropped. The `attention_compiled` **event** payload is unchanged (its key set is pinned by `attention-compiler-events.test.ts`) — event attribution belongs to plan 087.
      - `AttentionTriggerState` carries `runInputTokens` (charged run spend) in addition to the four fields listed above: a cumulative gate compared only against `estimatedInputTokens` could never fire before the run cap, which is the bug this plan closes. `run_input_ratio` fires on `runInputTokens + estimatedInputTokens >= ratio × budget`.
      - `run_input_ratio` with a run budget has **no per-request target** (the stages fold every eligible row) and does **not** fail closed: spend is already booked, folding only slows the counter, and `RunLimitTracker` owns the cap. Every other axis folds to a numeric target and still throws `AttentionBudgetError` when it cannot settle. Throwing on the cumulative axis would have made it an always-failing configuration after the crossing turn — the original bug in a new costume.
      - Run overlays may not set `trigger` (same rule as `maxInputTokens` / `reserveTokens`): the gate is agent-config only.
      - Predicate axes must return a boolean; a non-boolean (including an `async` predicate's `Promise`) fails with a `TypeError` naming the option instead of silently never firing. Axes are evaluated at most twice per turn (turn start, post-stage), never per row.
      - `AttentionCompilerContext.runInputBudget` ← resolved `RunLimits.maxInputTokens` in `assembleRoundContext`; per-turn `AttentionCompileOptions.runInputTokens`/`AssembleProviderInputOptions.runInputTokens` ← `limits.snapshot().inputTokens`.
      - Export budget rebaselined deliberately: `scripts/budgets.json` `@arnilo/prism` 1364 → 1372 (+8: six contract types, two module-level evaluation helpers; neither helper is re-exported from the root barrel).
    - API Notes and Examples:
      ```ts
      const compiler = createAttentionCompiler({ trigger: { kind: "run_input_ratio", ratio: 0.75 } }, { model, runInputBudget: 500_000 });
      compiler.shouldFold(state); // boolean; compiler.lastFiredAxis // "run_input_ratio"
      ```
    - Files to Create/Edit:
      - `src/contracts-core/attention.ts`: trigger union types, `AttentionTriggerState`. **Done** — plus `AttentionTriggerKind`/`AttentionTriggerFunction`/`AttentionTriggerInput`/`AttentionTriggerDecision`, the `trigger` option, `AttentionCompilerContext.runInputBudget`, the `trigger`/`runInputBudget` handle fields, and `AttentionReport.firedAxis`.
      - `src/attention-compiler.ts`: resolution, validation, OR-of-axes evaluation, fired-axis attribution. **Done** — plus `attentionTriggerState` / `evaluateAttentionTrigger` module exports.
      - `src/agent-session/session/assemble.ts`: pass run input budget into compiler context. **Done** — also the per-turn charge counter.
      - `src/input.ts`: forward `runInputTokens` into `compileAttention` (`AssembleProviderInputOptions`).
      - `src/__tests__/attention-compiler-triggers.test.ts`: the four axes + attribution + validation.
      - `docs/attention-compiler.md`: trigger-axes table, per-kind examples, `runInputBudget`/`runInputTokens` rows, `firedAxis` row, overlay rules, stale memory-only frontier line fixed.
      - `scripts/budgets.json`: export-count rebaseline with reason.
    - References: synapta `DO_ATTENTION_TRIGGER_RATIO = 0.75` behavior to replicate against run cap.
  - Test Cases to Write:
    - `run_input_ratio` fires at 75% of run budget while `input_ratio` would not (synapta scenario): validates the headline fix.
    - Backward compat: options without `trigger` behave identically to 0.8 (same fold points in recorded fixtures).
    - Unknown trigger kind / ratio out of (0,1): TypeError with option name.
    - Array trigger: fires when any axis fires; attribution names the first fired axis.
  - Test Status: **written and passing** — `src/__tests__/attention-compiler-triggers.test.ts` (7 tests) covers all four, plus the exact-budget boundary for the cumulative axis, the input-cap fallback, the frozen predicate state with its two-calls-per-turn bound, the fail-closed predicate and the async-predicate `TypeError`. `src/__tests__/attention-compiler-wiring.test.ts` had its handle fixture and overlay regex updated for the new fields; all 62 attention-compiler tests pass.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new `attention.compiler.trigger` options.
    - Docs pages to create/edit: `docs/attention-compiler.md` (trigger axes table, examples per kind). **Done** (plus `runInputBudget`/`runInputTokens`/`firedAxis` and the overlay rules).
    - `docs/index.md` update: no — page already indexed; entry description unchanged.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Durable mid-run compaction mode
  - Acceptance Criteria:
    - Functional: `attention.compiler.durable: true` persists folded ledger + fold boundary to the session store at each successful fold; on session resume, folding state is restored before the next provider turn. Restarting mid-run resumes without replaying pre-fold turns into the provider request.
    - Performance: One extra session-store write per fold (not per turn); resume path adds no provider request larger than the live equivalent. Sizing trade-off stated in `docs/attention-compiler.md`: one store write per fold, default off.
    - Code Quality: Persistence reuses session checkpoint codecs (`src/agent-session/session/persist.ts`, `packages/prism-core/src/sessions/codecs/checkpoint.ts`); no new store schema if codec allows, else additive migration.
    - Security: Folded ledger inherits session-store access controls; no new credential surface; ledger content already redacted upstream.
  - Approach:
    - Documentation Reviewed:
      - `docs/session-stores-and-branching.md`, `docs/compaction-and-retry.md`
      - `packages/prism-core/src/runtime/workflows/checkpoint-core.ts` (boundary persistence precedent)
    - Options Considered:
      - Persist every turn (journal mode): rejected — write amplification, unnecessary.
      - Persist at fold boundaries only: chosen — fold is the durability point that matters.
    - Chosen Approach: Fold-time persistence via existing checkpoint codec with a `fold` kind; resume reads latest fold boundary before assembling.
    - Execution Notes (2026-09-18):
      - **No new checkpoint kind, no migration.** The codec stores the run state as opaque JSON (`encodeCheckpointJson`), and `sessionState` is already the durable bag that carries `attentionSticky`; a `fold` kind would need sqlite/postgres store changes and a second source of truth for the same state. The ledger rides `AgentRunState.sessionState.attentionFold` beside `sessionState.attentionSticky`, validated on load with the same fail-soft parse (malformed entry dropped, malformed shape fails the load), so the AC's "no new store schema if codec allows" branch applies.
      - **`durable` is independent of `persistSessionState`.** That flag governs skill/tool-activation state. `durable: true` owns both attention keys, because replay-exact resume needs both: the frontier decides *what* stays folded, the ledger decides *which body* it was folded to. A non-durable run keeps today's checkpoint bytes exactly (frontier only under `persistSessionState`).
      - **The write is a fold-boundary running checkpoint**, issued from the assembler between `assembleProviderInput` and the provider call, gated on `AttentionReport.newFoldedBodies > 0` — one write per turn that folds a *new* body, never per turn, and independent of `checkpointPolicy`. `checkpointDurableTurn`'s body was extracted into a shared `writeRunningCheckpoint` so both triggers write the identical state shape; no new exports beyond the phase helper.
      - **Ledger semantics.** `AttentionFoldLedger` is session-owned (like the frontier) and consulted *before* `fold.summarize`: one host summarize per row per session, and a row re-applied under a closed gate still uses its stored body. Caps: newest 64 bodies, each already capped by the fold's `maxSummaryBytes` (hard 4 KiB) — bodies are post-redaction, post-cap, so the checkpoint never gains payload bytes. A body too large to store simply re-summarizes.
      - **Config-time failure.** `durable: true` without a durable run throws `AgentRunStateError` at run start (before any provider call) rather than folding into memory only; a run overlay may not set `durable` (same rule as `trigger` and cap inputs). `session.attentionDurable` is reset per run so a pre-compiler input-guardrail suspension cannot inherit the previous run's flag.
      - **Dirty signal.** `AttentionReport.newFoldedBodies` reports bodies added this turn (the summarize saving, and the checkpoint trigger). The `attention_compiled` event payload stays pinned (its key set is asserted by `attention-compiler-events.test.ts`); a host that wants the count can read `onAttentionReport`.
      - Export budget rebaselined deliberately: `scripts/budgets.json` `@arnilo/prism` 1372 → 1378 (+6: two contract types and three ledger values in `src/attention-compiler.ts`, plus the internal `checkpointDurableFold` phase helper in `src/agent-session/session/persist.ts` — the same internal-export precedent as `checkpointDurableTurn`; nothing added to the root barrel).
    - API Notes and Examples:
      ```ts
      const session = host.createSession({ ..., attention: { compiler: { trigger: { kind: "run_input_ratio", ratio: 0.75 }, durable: true } } });
      // after restart: host.resumeSession(id) → assembly starts from persisted fold ledger
      ```
    - Files to Create/Edit:
      - `src/attention-compiler.ts`: `AttentionFoldLedger` + factory, `serialize`/`restore`, memoized `foldedBody`, `newFoldedBodies`, `durable` resolution and overlay rejection. **Done**.
      - `src/contracts-core/attention.ts`: `durable` option, `durable` handle field, `newFoldedBodies` report field. **Done**.
      - `src/input.ts`: `AssembleProviderInputOptions.attentionFold` → `compileAttention`. **Done**.
      - `src/agent-session/session.ts` / `session/types.ts`: `attentionFoldFor` / `serializedAttentionFold` / `restoreAttentionFold` / `attentionDurable`. **Done**.
      - `src/agent-session/session/assemble.ts`: durable-run validation, per-run flag, ledger pass, fold-boundary checkpoint call. **Done**.
      - `src/agent-session/session/persist.ts`: attention keys under `durable`, shared `writeRunningCheckpoint` + `checkpointDurableFold`. **Done**.
      - `src/agent-run-state.ts`: `sessionState.attentionFold` shape + load/save validation. **Done**.
      - `src/agent-run-lifecycle.ts`: restore ledger (and the frontier it belongs to) on resume. **Done**.
      - `packages/prism-core/src/sessions/codecs/checkpoint.ts`, sqlite/postgres checkpoints: **not needed** — no schema change (see Execution Notes).
      - `docs/attention-compiler.md` durable section + sizing line; `docs/compaction-and-retry.md` cross-link. **Done**.
      - `scripts/budgets.json`: export-count rebaseline with reason. **Done**.
    - References: synapta H12; clay long-build loops; Muse Code replay-exact restart semantics.
  - Test Cases to Write:
    - Fold → kill process → resume: provider request contains folded ledger, not raw history; next fold engages at the same threshold.
    - Durable off (default): no extra store writes vs 0.8 fixture count.
    - Resume with no fold persisted: identical to 0.8 resume behavior.
    - Postgres + Sqlite checkpoint round-trip of fold boundary (schema-level test).
  - Test Status: **written and passing** — `src/__tests__/attention-compiler-durable.test.ts` (6 tests): memoized body + `newFoldedBodies` across turns; ledger round-trip with malformed entries/shape dropped; restored body re-applied under a *closed* gate with zero summarize calls; crash → fold-boundary checkpoint carries ledger + frontier without `persistSessionState` → resume sends the same stub bytes and no raw payload; `durable: false` writes nothing to the checkpoint store at all; `durable: true` without a durable run fails at start with zero provider calls. The plan's schema-level round-trip is unnecessary — no codec/schema change — and the sqlite/postgres stores keep covering `sessionState` as opaque JSON. Resume-with-no-fold-persisted stays covered by the existing plan 074/084 suites (all 143 tests in the attention/durable/session/agent-run files pass).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new `durable` option, fold ledger and frontier checkpointing.
    - Docs pages to create/edit: `docs/attention-compiler.md` (durable section with the sizing line), `docs/compaction-and-retry.md` (cross-link). **Done** — plus the `newFoldedBodies` report row, the `attentionFold` compile-option signature, and the frontier bullet now naming `durable`.
    - `docs/index.md` update: no — existing pages.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4: Example + conformance scenario for budget-capped long runs
  - Acceptance Criteria:
    - Functional: `examples/attention-budget-axes.ts` demonstrates the synapta scenario (model window 1M, run input budget 500k, 20+ turns) with folding engaged; conformance scenario asserts fold fired under run budget with `input_ratio` never satisfied.
    - Performance: Example runs under existing example CI budget.
    - Code Quality: Example compiles under repo lint; conformance added to the attention conformance suite, not ad-hoc.
    - Security: No secrets in example; uses mock/fake provider.
  - Approach:
    - Documentation Reviewed: `examples/attention-compiler.ts` (existing example conventions).
    - Options Considered: Doc-only — rejected; the scenario is the regression test for A1/A2.
    - Chosen Approach: Mock-provider loop mirroring synapta Do shape.
    - API Notes and Examples:
      ```bash
      node examples/attention-budget-axes.ts
      ```
    - Files to Create/Edit:
      - `examples/attention-budget-axes.ts`: runnable scenario. **Done** — 1M window, 500k run budget, 24 provider turns, `keepLast: 2`, mock provider reporting per-turn `inputTokens` at 4 bytes/token, and a JSON summary that carries the evidence (per-turn `used`/`usedAfter`, fold counts, spend before the first fold, final request row census).
      - Conformance: `src/__tests__/attention-compiler-budget.test.ts` (the `attention-compiler-*.test.ts` family, next to the trigger and durable suites). **Done** — 3 tests: the long-run conformance, report-level axis attribution, and a spawn check that the shipped example still reports the same scenario.
    - Execution Notes (2026-09-18):
      - **The example had to reach the cumulative gate for real.** The run budget stays at the literal 500k from the scenario, but the axis ratio is 1 % (`0.01 × 500_000 = 5_000`), so the gate opens on turn 6 without the example having to generate hundreds of kilobytes of synthetic history. That keeps the numbers honest — spend and estimate are the actual projected values (3,694 + 1,530 ≥ 5,000), not a scaled-down budget pretending to be the scenario.
      - **Measured, not asserted by hand:** 24 provider turns, 19 folding turns, first fold on turn 6, 35,768 input tokens spent of the 500,000 budget, `maxUsed` 7,016 against a 743,088 window threshold, and a final request holding 21 stubs plus the newest 2 raw rows. The window axis is on the gate the whole time (`input_ratio` first in the array) and provably never fires, so the run axis is the only explanation left.
      - **Attribution needs two layers.** `attention_compiled` is counts-only by contract (plan 074 pinned its key set; plan 087 adds the axis), so the conformance suite asserts `report.firedAxis === "run_input_ratio"` where the field exists — a direct `assembleProviderInput` call with the resolved run budget and carried-over spend — and proves the same thing for the session path by elimination: every event's `used` is an order of magnitude under the window threshold, and at the first fold `used` alone is below the cumulative threshold while `spendBefore + used` clears it.
      - **Two fixture traps worth recording.** `RunOptions.limits` is the run-scoped ceiling field (`runLimits` is silently ignored in plain JS and would leave the 8-round default in place, stopping the loop at 9 turns with `stopReason: "turn_limit"`), and `maxTotalTokens` has to be disabled for a long tool loop because the default 50k cap counts input + output across the run. Both are visible in the example as `limits: { …, maxTotalTokens: null }`.
      - The example is listed in `examples/README.md` — the docs suite requires every `examples/*.ts` to appear there, a gate the plan did not predict.
      - No source change: the example and suite exercise the Task 2/3 API as shipped.
    - References: synapta Plan 118 acceptance wording.
  - Test Cases to Write:
    - Conformance: fold count ≥ 1 before run input budget exhaustion; fired axis recorded as `run_input_ratio`.
  - Test Status: **written and passing** — `src/__tests__/attention-compiler-budget.test.ts`: (1) the 24-turn run folds (≥ 10 folding turns) with `used < 0.75 × inputCap` on every mutated turn, no truncated turn, spend under budget, `stopReason` unset (budget never breached), first fold explained only by carried-over spend, and the final request keeping exactly the newest `keepLast` rows raw; (2) `AttentionReport.firedAxis === "run_input_ratio"` on a direct assembly with carried-over spend, with `used` under the window ratio; (3) `node examples/attention-budget-axes.ts` exits 0 and reports the same `windowRatioReached: false` plus a first fold that clears the cumulative threshold. Whole attention family (budget, durable, events, triggers, wiring) plus `docs.test.ts` pass; `npm test` shows only the two pre-existing Phase 54 generated-docs gates that fail on clean `HEAD`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — example + tests only.
    - Docs pages to create/edit: `docs/attention-compiler.md`. **Done** — the trigger-axes section now points at the runnable example with its numbers (`input_ratio` needs 743k, never fires; 1 % of the budget crossed on turn 6; 36k of 500k spent; newest 2 rows raw), and `Related APIs` lists it. `examples/README.md` gained the entry (required by `src/__tests__/docs.test.ts`).
    - `docs/index.md` update: no — the index already links `examples/`; no new page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Task 1: none — inventory only, no code changed, no acceptance criterion relaxed.
- Task 2: `run_input_ratio` deliberately has no per-request target and never throws `AttentionBudgetError` (see Execution Notes): the alternative — failing closed on a cumulative axis — makes every turn after the fold point a failed run, which is the defect this plan closes. Attribution is exposed on `AttentionReport` instead of the `attention_compiled` event to avoid changing a pinned telemetry payload mid-plan (plan 087 carries event attribution).
- Task 3: the fold ledger is capped (newest 64 bodies) and evicts oldest-first, so a very long run can re-summarize a row whose body fell out of the cap — accepted: the cap is what keeps a durable checkpoint bounded, and a lost body only costs one extra host summarize. `durable` adds one checkpoint write per folding turn; hosts that cannot pay it keep the default (in-memory memoization only, no persistence). The compiler's ledger covers the compiler's own projection: the `toolResultFold` pre-pass in `assembleProviderInput` runs earlier and re-summarizes its own rows per turn — recorded as a Further Action rather than fixed here, because its gate semantics (no keep-last, no frontier) are a separate design.
- Task 4: the session-path conformance test proves the fired axis by *elimination* (window axis unreachable + cumulative threshold crossed) rather than reading it, because the `attention_compiled` payload is counts-only by contract and the session has no report seam (`onAttentionReport` belongs to direct `assembleProviderInput` callers). The direct-assembly test asserts `firedAxis` outright, so the two together cover it; promoting the axis onto the event is plan 087's call. The example's per-turn spend is the mock's 4-byte/token estimate of the assembled request rather than a real tokenizer, which is the same order as the compiler's own estimate and is what the axis sees in a mock run.

## Further Actions

### Task 1 inventory: trigger axes and compaction surfaces (no runtime change)

**Existing trigger primitives (measured/validated today)**

| Primitive | Span | Semantics |
| --- | --- | --- |
| `AttentionCompilerOptions.triggerRatio` | `src/contracts-core/attention.ts:17` | Fraction of `inputCap` that opens the mutation gate; default 0.75, `resolveRatio`-validated. |
| `AttentionCompilerOptions.compactRatio` | `src/contracts-core/attention.ts:17` | Attribution pairing only: must exceed `triggerRatio`; checked in `createAttentionCompiler`. |
| `createAttentionCompiler` | `src/attention-compiler.ts:131` | Freezes `{ inputCap, reserveTokens, triggerRatio, compactRatio, thinkingKeepTurns, keepLast, excludeTools }`; validates the optional `compactionTrigger` (`input_ratio` must exceed `triggerRatio`). **No `trigger` field on the handle today.** |
| `resolveRunAttentionCompiler` / `mergeAttentionRunOverlay` | `src/attention-compiler.ts:176`, `:220` | Agent setting resolved at run start; run overlay may only narrow (raise ratios, lower depths, add `excludeTools`); `maxInputTokens`/`reserveTokens` rejected in an overlay. |
| `AttentionCompilerSetting` | `src/contracts-core/attention.ts:34` | `boolean \| AttentionCompilerOptions` on `AgentConfig` / `AgentDefinition` / `RunOptions`. |
| `resolveInputCap` | `src/attention-compiler.ts:86` | Per-**request** cap: `options.maxInputTokens` (host) else `contextWindow - (maxOutputTokens ?? 0) - reserveTokens`. |
| `CompactionTrigger` union | `src/contracts-core/compaction.ts:39` | `threshold_entries \| input_ratio \| custom`; `compaction.ts:48` validates at config time; `input_ratio` is against the **input cap**, not a run budget. |
| `resolveShouldCompact` | `src/contracts-core/compaction.ts:121` | The single compact-when decision: `trigger` replaces legacy gates; lazy token/cap getters; a throwing `custom.shouldCompact` decides `false` + `onError` (fail closed). **This is the pattern the predicate axis must mirror.** |
| `CompactionOptions.compactAfterTokens` | `src/contracts-core/compaction.ts:73` | Legacy fixed-token gate (attach loops); closest existing analogue to a token floor, but compaction-side and task-boundary only. |
| `createAttentionTruncationTrigger` | `src/attention-compiler.ts:621` | Wraps `truncated` streaks into a `CompactionTrigger` (`custom`); fires once per armed streak. Precedent for an OR/adaptive axis. |
| `AttentionReport` | `src/contracts-core/attention.ts:55` | Reports `used`/`usedAfter`/`inputCap`/`triggerRatio`/counts/`truncated`. **No fired-axis field** → additive field needed for plan 087 attribution. |

**Existing compaction surfaces**

| Surface | Span | Constraint |
| --- | --- | --- |
| `session.autoCompact` | `src/agent-session/session.ts:538` | Evaluated **once per run**, after input append and before assembly; skips a branch whose last entry is already `compaction`. |
| `session.compact()` → `compactBranch` | `src/agent-session/session.ts:350`, `:564` | Task boundary only: throws `Error("Agent session already has an active run")` at `session.ts:351`. **This is Synapta H12's root: a single long run has no durable compaction point.** |
| `CompactionStrategy` + `CompactionResult` | `src/contracts-core/compaction.ts:6`, `:22` | Summary written as a `compaction` session entry (`throughEntryId`/`keepEntryIds`) → already durable in the session store, replayed via `snapshot().summaries`. |
| `createObservationalMemoryCompactionStrategy` | `packages/memory/src/compaction/observational-memory/strategy.ts:27` | Ledger→projection→summary; folded payload bounded by `HARD_MAX_FOLDED_PAYLOAD_BYTES`. |
| OM attach gate | `packages/memory/src/compaction/observational-memory/compose.ts:191` | `resolveShouldCompact({ trigger, compactAfterTokens })` post-run; `/compaction/*` subpath wiring at `compose.ts:74`. |
| OM `compactAfterTokens` | `packages/memory/src/compaction/observational-memory/settings.ts:37`, default `:114` | Legacy OM token gate; replaced when a `trigger` is set. |
| `toolResultFold.summarize` | `src/tool-result-fold.ts:24` | Host/LLM summarizer; wins over the deterministic stub for fold-eligible rows. |

**Existing persistence surfaces (already durable)**

| Surface | Span | Notes |
| --- | --- | --- |
| `PersistedAttentionStickyFrontier` + `serialize`/`parse`/`restore` | `src/attention-compiler.ts:518`, `:553`, `:567`, `:585` | Hashes + tool-call ids only; schema `v: 1`; caps 256/256; parse **never throws** (bad entry dropped, bad shape → `undefined`). |
| `sessionState.attentionSticky` write | `src/agent-session/session/persist.ts:18` | Behind `persistSessionState: true` (`src/contracts-run-state.ts:203`) via `saveAgentRunState` (redactor + `maxStateBytes`). |
| `sessionState.attentionSticky` read | `src/agent-run-lifecycle.ts:234`; field `src/agent-run-state.ts:70` | Restored only when the resume option also sets `persistSessionState`. |
| Session-owned frontier | `src/agent-session/session/types.ts:78`; used at `src/agent-session/session/assemble.ts:364` | One frontier per session leaf; survives turns and runs in-process. |
| Turn-boundary checkpoint | `src/agent-session/session/persist.ts:118` (`checkpointDurableTurn`, `checkpointPolicy: "every-turn"`) | Cadence knob that a fold-boundary write can reuse. |
| Checkpoint codecs/stores | `packages/prism-core/src/sessions/codecs/checkpoint.ts` (`encodeCheckpointJson`, `decodeCheckpointCursor`), sqlite/postgres checkpoint impls | Versioned CAS records; shape change here would need an additive migration. |

**Per-turn clone path (unchanged by Task 2/3 axes)**

- `src/input.ts:261` — compiler-on turns build the default message groups, call `compileAttention({ groups, frontier, fold, redactor, turn, ... })`, and adopt the returned groups only when `mutated`.
- `src/attention-compiler.ts:305` — `compileAttention` copies `history`/`toolResults` arrays, subtracts each mutation's delta from one measurement, throws `AttentionBudgetError` when still over; never writes the store.
- `src/attention-compiler.ts:419` / `:457` — sticky rows are re-targeted and re-stubbed **every turn**; `frontier.toolCallIds` only carries the id, never the stub body.

**Covered vs. genuinely new**

| Need (Tasks 2–4) | Verdict | Evidence |
| --- | --- | --- |
| Ratio-in-`(0,1)` validation, option-name `TypeError` style | **covered** | `resolveRatio` `src/attention-compiler.ts:64`; `assertCompactionTrigger` `compaction.ts:48`. |
| Predicate axis on the attention gate | **partly covered** | `CompactionTrigger.custom` + fail-closed `resolveShouldCompact` is the exact pattern; the attention-side `AttentionTriggerState` and its frozen shape are new. |
| Function/predicate triggers as a trust surface | **covered** | Host-supplied callbacks are already host-trusted (`CompactionTrigger.custom`); JSDoc must say so, no new boundary. |
| `run_input_ratio` axis | **genuinely new plumbing** | The run budget exists only as `RunLimits.maxInputTokens` (`src/contracts-core/run-limits.ts:19`, default `40_000` at `src/run-limits.ts:11`), charged cumulatively per provider turn (`recordUsage` → `charge("maxInputTokens")`, `src/run-limits.ts:238`) and readable via `RunLimitTracker.snapshot()` (`src/run-limits.ts:200`). It is **not** in `AttentionCompilerContext`, and `assemble.ts` never passes `ctx.limits` to the compiler. |
| Name collision to avoid | **new constraint** | `AttentionCompilerOptions.maxInputTokens` (per-request cap, `attention.ts:20`) ≠ `RunLimits.maxInputTokens` (cumulative run budget). The new axis must be named distinctly (`runInputBudget` / `run_input_ratio`) and must not reuse the existing field. |
| `token_floor` axis | **genuinely new** | No absolute-token gate on the attention side; `compactAfterTokens` is compaction-side only. |
| Array / any-of axes + fired-axis attribution | **genuinely new** | Attention gate has one `triggerRatio`; compaction `trigger` *replaces* legacy gates rather than OR-ing. Attribution needs an additive `AttentionReport` field. |
| Overlay rules for the new axes | **new work in Task 2** | `mergeAttentionRunOverlay` (`src/attention-compiler.ts:176`) must define narrowing semantics for each axis; today it handles ratios/depths/`excludeTools` only. |
| Sticky frontier surviving restart | **covered** | `sessionState.attentionSticky` round trip behind `persistSessionState`, fail-soft parse. |
| Durable **mid-run** compaction point | **genuinely new** | `session.compact()` refuses during a run (`src/agent-session/session.ts:351`); `autoCompact` runs once, pre-assembly. |
| Persisted folded **ledger** (stub bodies / fold boundary) | **genuinely new** | Digest stubs (`attentionStubText`, `src/attention-compiler.ts:487`) re-derive byte-identically, but `toolResultFold.summarize` is re-invoked for every sticky row on every turn (`src/attention-compiler.ts:457`, targets from `:419`) with no memo — a resumed run can emit different stub bytes and pays the summarizer again. Durable mode needs a persisted fold ledger (bounded, redacted) for replay-exact resume. |
| Checkpoint codec shape | **covered if additive** | `fold` kind can ride the existing versioned checkpoint record; otherwise sqlite/postgres need an additive migration (Task 3). |

**Doc drift found (fix in Task 2/3 edit, no code impact)**

- `docs/attention-compiler.md` §"Enabling it" still says the frontier "lives in memory only — a resumed process simply re-decides from the ratio it sees", while §"Extension and configuration notes" documents the `sessionState.attentionSticky` checkpoint round trip. The first line is stale.

**Security** — no new trust surfaces: predicate triggers are host-trusted code (same class as `CompactionTrigger.custom`); new persisted fold state must reuse `saveAgentRunState` (redactor + `maxStateBytes`) and the existing never-throw, per-entry fail-soft parse so a hand-edited checkpoint can only cause a re-decide, never a resume failure.

**Performance** — inventory only; no runtime change. Noted for Task 2/3: predicate evaluation stays O(1), and a persisted fold ledger would *remove* repeated `summarize` calls for sticky rows.

### Task 3 follow-ups (not in this plan's task list)

- **The `toolResultFold` pre-pass is still per-turn.** `assembleProviderInput` folds `history`/in-flight results through `foldToolResultHistory` / `foldToolResults` *before* the compiler stages (`src/input.ts:217`), and that pass has no memo: a row that passes its age/byte gates is re-summarized on every turn, which is the same cost/byte-drift wart Task 3 removed for the compiler's projection. Fix shape: thread the same `AttentionFoldLedger` (or a sibling cache) into `FoldToolResultsContext` and store the body under `toolCallId`, exactly as `foldedBody` does. Left out here because that pre-pass is compiler-independent (`contextBudget` runs may use it too) and its eligibility rules (no `keepLast`, no frontier) need their own decision — do not bolt the compiler's keep-last semantics onto it.
- **Compaction while a run is in flight is still refused** (`src/agent-session/session.ts:351`). Task 3 makes the *projection* durable, not the session entry journal: a long single run still has no task-boundary summary point mid-run. If a host wants a real mid-run prefix replacement, that is a `compactBranch`-during-run design (entry ids, branch handles, and the frozen prefix all change), not a compiler option.
- **Event attribution.** `AttentionReport.firedAxis` and `newFoldedBodies` are report-only; the `attention_compiled` payload stays pinned. Plan 087 owns adding either to the event surface.
