# Synapta Integration Review Remediations

## Objectives

- Resolve the open enhancements from `docs/synapta-integration-review.md` (2026-09-24 review of Synapta `6078398` against Prism `0.11.1`): coverage-safe observational-memory compaction, a confidence-preserving public System One decision surface, fixed-model aggregate-budget and host step-loop telemetry compositions, typed proposal provenance, and cross-layer revocation proof.
- Keep every addition a **generic Prism primitive or composition** — no Synapta-specific authority (task grants, FGA, Temporal, business state machines) moves into Prism (review §4).
- Close the review's verification gaps that block Synapta adoption: the worker-less OM context-loss hazard and the missing raw-confidence decision API.

## Expected Outcome

- Attaching observational memory without observer workers can no longer silently drop an unobserved message prefix from the next model context: compaction either preserves uncovered entries or refuses with a distinguishable status.
- Hosts can call System One decision models directly with question ids, raw probabilities, actual responding model, usage, and timing preserved — not just schema-rendered text — via a public package subpath.
- `examples/` carries runnable compositions for aggregate task budgets across multiple `session.run()` calls, ledger-persisted step-loop timelines, and source-revocation propagation into derived context; each is covered by tests and linked from docs.
- An optional field-evidence guardrail rejects schema-valid but unevidenced proposal fields (wrong object, wrong revision, invented value).
- A packed-install compatibility suite runs the Synapta-shaped composition (host tools only, policy-chain snapshot, per-step stop, memory retention, usage trace, revocation, typed decisions) against the exact packed family release.
- All fixes keep defaults fail-closed, secrets redacted, and are documented per `docs/` structure rules with `docs/index.md` updates.

## Background

- Review fixes F1–F4 (run-bundle policy chain, double credential resolution, malformed System One answers, `__proto__` choice labels) are already applied in the working tree with green tests; this plan covers only the review's open items.
- Synapta is a downstream host: it composes Prism per-step under host authority. Its plans 122 (router withhold), 156 (provenance), 157 (transcript durability), 159 (behavioral evals), 161 (revocation), 163 (decision layer) name the consumer-side obligations this plan's primitives serve.
- This plan does not authorize Synapta-side adoption of anything; Prism ships primitives and compositions, Synapta decides.

## Tasks

- [x] Task 1 — Primitive review across all six remediation areas
  - Acceptance Criteria:
    - Functional: a written inventory (in this plan's execution notes, not shipped code) mapping each review recommendation to existing Prism primitives: OM coverage markers (`coverage-helpers.ts`, `unscannedEntries`), flush skip taxonomy (`runtime.ts`), System One wire client (`postSystemOne`, `isSystemOneResponse`), schema compiler (`compileSystemOneQuestions`), governed router budget reservation/settlement, `ExecutionTimeline` projectors, `snapshotRunBundle`, RAG access rechecks/tombstones/`repointSource`, OM `invalidatedIds`, tool-input guardrails and `evidence-grounding.ts`.
    - Functional: for each area, a decision recorded: reuse-only, extend-existing, or new-primitive-required, with one-line justification.
    - Performance: no code change in this task.
    - Code Quality: decisions cite exact file paths and exported symbols verified by grep, not doc claims.
    - Security: inventory confirms no proposed primitive duplicates an authorization authority (review §4 list).
  - Approach:
    - Documentation Reviewed:
      - `docs/synapta-integration-review.md` §3 (all six recommendations and their Prism sources).
      - `docs/model-routing.md`, `docs/execution-timeline.md`, `docs/evaluations.md`, `docs/rag.md`, `docs/compaction-observational-memory.md`, `docs/guardrails.md`.
    - Options Considered:
      - Skip review since the review doc already lists sources: rejected — doc-to-code paths must be re-verified in-tree before tasks build on them (review itself found doc/code path drift for `createGovernedProvider`).
    - Chosen Approach:
      - Grep-verified inventory table; each later task cites its rows.
    - API Notes and Examples:
      ```ts
      // verified shapes this task must confirm exist:
      // packages/memory/src/compaction/observational-memory/{strategy,compose,runtime,render,coverage-helpers}.ts
      // packages/prism-providers/src/shared/{systemone,systemone-schema,systemone-provider}.ts
      ```
    - Files to Create/Edit:
      - none (execution notes only).
    - References:
      - `docs/synapta-integration-review.md`; `plans/121-System-One-Decision-Model-Providers-Jev-Laya.md` Task 1 (precedent shape).
  - Test Cases to Write:
    - none (inventory task).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — analysis only.
    - Docs pages to create/edit: none with reason: no behavior delta.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.
  - Execution notes (2026-09-24, every symbol re-verified by grep against `949323af`, not doc claims):
    - **A1 — Coverage-safe OM compaction (Task 2) → extend-existing.** Verified: `packages/memory/src/compaction/observational-memory/coverage-helpers.ts:8,13` (`isEligibleObservationSourceEntry`, `unscannedEntries(entries, latestObservationCoverageId?)`); flush taxonomy `runtime.ts:82-87` (`ObservationalMemoryFlushResult.skipped?: string`) with skip reasons at `:136` `run_active`, `:139` `passive`, `:172/:212/:245` `missing_model`, `:174/:215/:248` `missing_credentials`; `compose.ts:204-226` `sync()` calls `await runtime.flush(...)` at `:208` and discards the result — the hazard is real and local; `strategy.ts:27` `createObservationalMemoryCompactionStrategy`, `:36` `keepEntryIds` from `selectRecentMessageEntryIds` only (no coverage input), `:42` `throughEntryId`; `render.ts:30` unconditional recall guidance; `src/session-stores.ts:145` `rebuildSessionContextCore`, `:162` `keepEntryIds`, `:163-167` `throughEntryId` walk, `:517` `CompactionEntryData` validation. All four required seams exist — extend, no new store/worker. `strategy.ts:18-23` still lacks `advertiseRecall`; the plan's option name is free.
    - **A2 — Confidence-preserving System One decisions (Task 3) → new-primitive-required (thin wrapper only).** Verified wire pieces: `packages/prism-providers/src/shared/systemone.ts:213` `postSystemOne`, `:186` `isSystemOneResponse`, `:163` `isSystemOneAnswer`, `:129` `SystemOneClientOptions`, `:151` `DEFAULT_SYSTEMONE_MAX_RETRIES`, error classes `:91/:106/:114/:122` (`SystemOneError`/`Auth`/`InvalidRequest`/`RetryExhausted`), `:200` `mapSystemOneUsage`; `systemone-schema.ts:72` `compileSystemOneQuestions`, bounds `:32/:34/:36` (`MAX_SYSTEMONE_CHOICE_OPTIONS` 255 / `MAX_SYSTEMONE_SCORE_LEVELS` 10 / `MAX_SYSTEMONE_QUESTIONS` 256), `:88` `renderSystemOneOutput`; `systemone-provider.ts:31` `createSystemOneDecisionProvider` renders schema text only. `packages/prism-providers/package.json` has `./typesafe` (`:80`) and `./laya` (`:52`) but no `./decisions` — the public surface is genuinely absent, and a wrapper over `postSystemOne` adds zero wire code (`docs/providers/decisions.md` does not exist).
    - **A3 — Fixed-model aggregate budget composition (Task 4) → reuse-only.** Verified: `packages/prism-core/src/governance/model-router/invocation.ts:87` `createGovernedProvider`, `:102` `renewBudget`, `:194` `settle`; `router.ts:342` `reserveBudget` call, `:614` `renewBudget`, `:633` `readBudget` (remaining-aggregate reporting); `state.ts:149` `reserveBudget`, `:292` `renewBudget`; unknown-usage contract `types.ts:15`. Precedent example `examples/governed-provider.ts` already streams through `router.createGovernedProvider` and captures settlement — Task 4 is a composition, no core change.
    - **A4 — Host step-loop telemetry (Task 5) → reuse-only.** Verified: `packages/prism-core/src/governance/observability/timeline-types.ts:115` `ExecutionTimeline`, `:180` `TimelineFolder`; `timeline.ts:732` `projectAgentTimeline`, `:745` `projectTraceTimeline`, `:959` `createTimelineFolder`, `:976` `createWorkflowTimelineFolder`, `:443` `guardrail_decision` fold; `summary.ts:162` `summarizeTimeline`, `:233` `summarizeSession`; `src/run-bundle.ts:88` `snapshotRunBundle` (`:18` `RunBundleSnapshot`). Existing example `examples/execution-timeline.ts` proves the folder path; Task 5 adds correlation + ledger persistence only.
    - **A5 — Field-evidence proposal provenance (Task 6) → extend-existing.** Verified: `src/evidence-grounding.ts:12` `ClaimGroundingEvidence`, `:53` `createClaimGroundingGuardrail` (`Guardrail<"output">` — output stage, so it cannot verify tool-call fields); tool-input seam `src/contracts-core/run-limits.ts:125` `Guardrail<S extends GuardrailStage>`, `:144` `toolInput?: readonly Guardrail<"tool_input">[]`, collected at `src/guardrails.ts:224`. A sibling factory next to `evidence-grounding.ts` registered on `toolInput` reuses dispatch interception, redaction, and the timeline fold; no retrieval/authority enters Prism.
    - **A6 — Cross-layer revocation composition (Task 7) → reuse-only.** Verified: `packages/memory/src/rag/sources.ts:157` `deleteSource`, `:178` `createRagDeletionHandler`; `propagation.ts:82` `createDeletionPropagator` (`:18` `DELETION_REASON = "forgotten"`); `repoint.ts:207` `repointSource`; `rag/access-recheck.ts:81` `createAccessRecheck`; query-leg + post-rerank gates and `onAccessDenied` at `rag/retrieve.ts:84,81,170,228,381` (`loadScopeInvalidations` `:388`); OM withholding `compaction/observational-memory/{projection.ts:30,recall.ts:50,recent-messages.ts:24}` (`invalidatedIds`), `lineage.ts:145` `listInvalidatedIds`, `:261` `revokedIdsAbsent`, `drop-invalidated.ts:24` `createObservationalMemoryDropHandler`; wiki `wiki/retire.ts:124` `createWikiDeletionHandler`; fabric `fabric/repoint.ts:52` `createFabricRepointHandler`. Every leg the review names exists — Task 7 chains them in an example; a new revocation bus is unnecessary.
    - **A7 — Packed-install compatibility suite (Task 8) → reuse-only.** No primitive required: `snapshotRunBundle` (A4), OM admission (A1), revocation (A6), and decisions (A2) are the fixture surface; `docs/testing.md` examples-execution stage (`scripts/examples-execution.test.mjs`, spawns `examples/*.ts`) is the harness. No new stage planned.
    - **Security — no proposed primitive duplicates an authority (review §4 list).** Decisions wrapper performs one read-only call and grants no effect authority; field-evidence verifier checks host-supplied provenance and grants none; budget composition reuses router accounting (accounting ≠ authorization); timeline/revocation compositions add no bus, no FGA/Temporal/state-machine logic; OM admission changes retention, not access.
    - **Drift check vs plan text:** Task 4's snippet `createGovernedProvider({...})` is the standalone `invocation.ts:87` form (example uses `router.createGovernedProvider`, `router.ts:645`); both valid. Task 2's `advertiseRecall` name is unused. Review §3 item 6 pseudo-code `rag.revokeSource(...)` has no such symbol — the real primitives are `deleteSource`/`createDeletionPropagator`; Task 7 must use those names. No other corrections.

- [x] Task 2 — Coverage-safe admission for observational-memory compaction (highest priority)
  - Acceptance Criteria:
    - Functional: when the OM attach loop's flush was skipped (`run_active`, `passive`, `missing_model`, `missing_credentials`) or errored, automatic compaction must not discard message entries that no observation covers: the next `rebuildSessionContext(...).messages`/`.summaries` keeps uncovered entries, or compaction is deferred/refused with a status distinct from a successful empty observation pass.
    - Functional: a successful observation pass with zero observations still compacts (explicit host-visible outcome), distinguishable from "observer never ran".
    - Functional: `renderObservationalMemory` instructs the model to call `recall` only when a recall capability is available (host-provided flag); empty OM renders without advertising recall.
    - Performance: no extra model calls; admission check is O(entries) over metadata already tracked; no change to compaction token gates.
    - Code Quality: no new store or worker; admission logic lives in the OM strategy/compose seam; typed statuses reused or extended in the existing taxonomy.
    - Security: redaction and `invalidatedIds` withholding unchanged; a revoked-source observation still excludes; no new trust boundary.
  - Approach:
    - Documentation Reviewed:
      - `docs/compaction-observational-memory.md`; `docs/compaction-and-retry.md`; review §3 item 1 with local two-message repro evidence.
      - `src/session-stores.ts` `rebuildSessionContextCore` (`throughEntryId`/`keepEntryIds` semantics).
    - Options Considered:
      - Refuse to compact whenever no worker ran: simple but regresses worker-less sessions that legitimately want render-only compaction of already-observed prefixes.
      - Preserve uncovered entries alongside the summary (coverage-aware `keepEntryIds`): chosen — smallest change inside existing rebuild semantics; uncovered entries survive into the next context, so memory cannot be lost silently.
      - Force-retain all messages, never compact: rejected — defeats compaction for worker-hosts.
    - Chosen Approach:
      - Admission gate in the OM strategy computing uncovered entry ids (reuse `coverage-helpers.ts` markers and `unscannedEntries`); uncovered ids go into `keepEntryIds` (or the compaction is marked deferred when the uncovered set exceeds configured bounds). Render flag for recall guidance rides the strategy options.
    - API Notes and Examples:
      ```ts
      // strategy options addition (opt-out not required: old behavior is the hazard)
      interface ObservationalMemoryStrategyOptions {
        /** Render recall guidance only when the host exposes recall. */
        readonly advertiseRecall?: boolean; // default: true (current behavior)
      }
      ```
    - Files to Create/Edit:
      - `packages/memory/src/compaction/observational-memory/strategy.ts`: admission gate, recall-guidance flag.
      - `packages/memory/src/compaction/observational-memory/compose.ts`: attach loop refuses/defers compaction after skipped-or-errored flush when coverage is absent.
      - `packages/memory/src/compaction/observational-memory/runtime.ts`: expose flush outcome (success-empty vs skipped vs error) to the compose seam.
      - `packages/memory/src/compaction/observational-memory/render.ts`: conditional recall block.
      - `packages/memory/src/compaction/observational-memory/__tests__/coverage-admission.test.ts`: new suite (see test cases).
      - `packages/memory/src/compaction/observational-memory/__tests__/*.test.ts`: update existing expectations that assumed unconditional render-only compaction.
      - `docs/compaction-observational-memory.md`: admission contract; sizing trade-off line ("retaining uncovered entries grows the next prompt by their tokens; bound via the existing compaction token gate; deferral threshold replaces silent loss").
      - `docs/index.md`: update the compaction-observational-memory entry sentence (behavior delta: coverage-safe admission).
    - References:
      - Review §3 item 1; `src/session-stores.ts:149-179`; `render.ts:20-45`; Synapta `do-host.ts:1480-1507` (worker-less attach) and `do-host.test.ts:842-886` (what it currently asserts).
  - Test Cases to Write:
    - `workerless attach keeps early evidence in next context`: the review's two-message repro as a permanent test — sentinel message survives `messages`/`summaries` after render-only compaction.
    - `skipped flush defers or preserves, never silently drops`: each skip-reason branch.
    - `successful empty observation pass compacts and is distinguishable`: status differs from skip.
    - `recall not advertised without capability`: rendered block contains no recall instruction.
    - `revoked observation still excluded under admission`: invalidation wins over retention.
    - `no uncovered-entry escape of secrets`: redaction applies to retained entries.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — OM compaction admission behavior and render content change for all attach users.
    - Docs pages to create/edit: `docs/compaction-observational-memory.md` (contract + sizing trade-off), `docs/index.md` (entry sentence).
    - `docs/index.md` update: yes — compaction-observational-memory entry gains "coverage-safe admission" wording.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Note: if any retired status/symbol name is replaced, grep `scripts/`, `examples/`, and every workspace for the old name before closing this task; if public symbols are moved/removed (not merely added), run `node scripts/release.mjs gate --update-baseline` and record the `release:gate` diff.
  - Execution notes (2026-09-24, `packages/memory` build + OM suite 137 pass / 0 fail; full memory suite 342 pass / 5 pre-existing skips / 0 fail; biome clean on touched files; all five OM examples exit 0):
    - **Retention in the strategy.** `coverageAwareKeepEntryIds()` in `strategy.ts` unions `selectRecentMessageEntryIds()` with `eligibleObservationSources(unscannedEntries(entries, ledger.latestObservationCoverageId))` in entry order. Fully covered sessions keep the old recent-window behavior; partial coverage retains the uncovered tail in `keepEntryIds`; no coverage retains every eligible message (`throughEntryId` falls to `undefined`, so nothing folds). `advertiseRecall` added to `ObservationalMemoryCompactionStrategyOptions` and threaded into the summary render. The plan's API note name `ObservationalMemoryStrategyOptions` is actually `ObservationalMemoryCompactionStrategyOptions`.
    - **Deferral in compose — narrowed from the plan text.** Deferral fires only when `flush.skipped` is set **and** the ledger has no `latestObservationCoverageId`; a *successful* below-threshold pass with no coverage still compacts via retention. Reason: `attach.test.ts` `attached_run_compacts_when_compact_after_tokens_reached` (worker configured, `messageTokens: 999_999`) must keep its existing contract, and the acceptance allows preserve-or-defer. Deferral logs `observational-memory:compaction-deferred` with the typed reason. Manual `session.compact()` stays explicit and relies on retention.
    - **Typed skip taxonomy.** `runtime.ts` now exports `ObservationalMemoryFlushSkipReason` (`in_flight|run_active|passive|missing_model|missing_credentials|error`) and `skipped?: ObservationalMemoryFlushSkipReason`; re-exported from `index.ts`. No other workspace/script/example constructs the type or compares `skipped` to a literal, so narrowing was safe.
    - **Recall guidance is now capability-gated in every render path.** `renderObservationalMemory` omits the instruction when `advertiseRecall: false` or the pool is empty; `ObservationalMemoryContextOptions.advertiseRecall` carries it through `buildObservationalMemoryContextBlocks`; compose passes `options.compaction?.advertiseRecall` to both the strategy and the context provider.
    - **Tests.** New `__tests__/coverage-admission.test.ts` (8 tests) covers the review repro, partial coverage, deferral for `missing_model`/`missing_credentials`/`error`, passive no-op, successful-empty compaction vs deferral, recall gating (render, context blocks, strategy summary), revoked-observation exclusion, and retained-secret redaction. Existing suites needed no expectation changes.
    - **Docs.** `docs/compaction-observational-memory.md` gains a `### Coverage-safe automatic compaction` section (typed skip reasons, defer-vs-preserve contract, sizing trade-off, `advertiseRecall`); `docs/index.md` entry sentence updated.
    - **Public surface = additions only** (new type + new options); no symbol moved/removed. The added name later changed the memory `.d.ts` type re-export line the compat surface records, so `node scripts/release.mjs gate` did require a baseline refresh (see Task 3 notes). `node scripts/package-truth.mjs --emit-docs` was run for the stale Phase 54 evidence export counts (memory 783→784; it also normalized the pre-existing working-tree providers +1) and `scripts/truth-current.test.mjs` is green.

- [x] Task 3 — Public typed System One decision surface preserving confidence (highest priority)
  - Acceptance Criteria:
    - Functional: a public function (new subpath `@arnilo/prism-providers/decisions`, re-exported from `./typesafe` and `./laya`) performs one System One call and returns: per-question answers with raw `noul`/probabilities/score/legend/confidence, actual responding `model`, usage, and elapsed time — no coercion to booleans, no discarded probabilities, no timeout-to-`0.5`.
    - Functional: failures surface as typed errors (auth/invalid-request/retryable-exhausted/aborted) distinguishable from measured uncertainty; `AbortSignal` and optional deadline compose with the existing retry loop.
    - Functional: state/questions size bounds validated before fetch (reuse schema-compiler limits: ≤256 questions, choice options 2–255, score levels 2–10); secrets never appear in errors (existing redaction path).
    - Performance: one HTTP round trip per attempt (existing client unchanged); no new retry loop, no polling.
    - Code Quality: thin typed wrapper over `postSystemOne` + `compileSystemOneQuestions`; no duplicated wire code; both provider packages share it unchanged.
    - Security: credential resolution once per call under the provider id (Task F2 behavior preserved); state-text warning (questions never embedded in state) documented.
  - Approach:
    - Documentation Reviewed:
      - `plans/121-System-One-Decision-Model-Providers-Jev-Laya.md` (wire contract, error table); `docs/providers/typesafe.md`, `docs/providers/laya.md`; review §3 item 2.
    - Options Considered:
      - Extend the existing `AIProvider` adapter to carry confidence on events: rejected — review documents deliberate non-copying of probabilities onto events; forcing them in changes the adapter contract for all callers.
      - New standalone client: rejected — duplicates `postSystemOne`/retry/redaction.
      - Typed wrapper + new subpath re-exporting the existing client pieces: chosen — smallest public surface, zero provider-package changes beyond re-exports.
    - Chosen Approach:
      - `askSystemOneDecisions(body, options, signal?)` returning `SystemOneDecisionResult` (answers map by question id, model, usage, timingMs); subpath `./decisions` exports it plus the question/answer types and the schema compiler for hosts that compile from JSON Schema.
    - API Notes and Examples:
      ```ts
      import { askSystemOneDecisions } from "@arnilo/prism-providers/decisions";
      const result = await askSystemOneDecisions(
        { model: "jev-latest", state: conversationText, questions: { route: { type: "choice", criteria: { ask: "…", do: "…" } } } },
        { provider: "TypeSafe Jev", baseUrl: "https://api.typesafe.ai", apiKey: process.env.TYPESAFE_API_KEY },
        signal,
      );
      result.answers.route.probabilities; // preserved, keyed by option
      ```
    - Files to Create/Edit:
      - `packages/prism-providers/src/decisions/index.ts`: wrapper + types (re-exports from `shared/systemone.ts`).
      - `packages/prism-providers/package.json`: `./decisions` export entry.
      - `packages/prism-providers/src/typesafe/index.ts`, `packages/prism-providers/src/laya/index.ts`: re-export.
      - `packages/prism-providers/src/decisions/__tests__/decisions.test.ts`: new suite (injected fetch).
      - `docs/providers/decisions.md`: new API page per structure template.
      - `docs/index.md`: provider-connection group entry.
    - References:
      - `shared/systemone.ts` (`postSystemOne`, `SystemOneBody/Response/ClientOptions`, `isSystemOneResponse`); `systemone-schema.ts` (`compileSystemOneQuestions`); review §3 item 2; Synapta `plans/163-SystemOneDecisionLayer.md` (consumer need: shadow classification, confidence gating, calibration).
  - Test Cases to Write:
    - `round trip preserves probabilities, model, usage, timing`: injected-fetch success body asserted field-for-field.
    - `errors typed and distinguishable from uncertainty`: 401/422/429-exhausted/abort paths; no synthetic `0.5`.
    - `bounds enforced pre-fetch`: >256 questions, oversized state, malformed criteria rejected without fetching.
    - `credential resolved once, redacted on transport failure`: mirrors F2 regression through the new surface.
    - `abort composes with retry`: aborted signal between attempts stops retrying.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new package subpath and public function.
    - Docs pages to create/edit: `docs/providers/decisions.md` (new), `docs/providers/typesafe.md` + `docs/providers/laya.md` (link to decisions subpath).
    - `docs/index.md` update: yes — new entry under provider/model connection.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Note: additions only — no symbol moves/removals, so no compat-baseline regeneration is required; verify `release:gate` stays green regardless.
  - Execution notes (2026-09-24, `packages/prism-providers` build + suite 731 tests / 636 pass / 95 pre-existing skips / 0 fail; new decisions suite 8/8; biome and `git diff --check` clean; `release:gate` green after baseline refresh):
    - **Surface.** New `packages/prism-providers/src/decisions/index.ts` exports `askSystemOneDecisions(body, options, signal?)` returning `SystemOneDecisionResult { model, answers, usage?, timingMs }`. `answers` is the wire's raw map (noul probability, choice probabilities/confidence, score/legend), `model` is the responding checkpoint, `usage` is `mapSystemOneUsage` output, `timingMs` is rounded `performance.now()` wall time including retries. The subpath also re-exports the question/answer/body/state types, the typed error family, `compileSystemOneQuestions`/`compileSystemOneState`, `SystemOneSchemaError`, the limit constants, and the new `DEFAULT_MAX_SYSTEMONE_STATE_BYTES` (262,144). `./decisions` is in `package.json` exports and `export * from "../decisions/index.js"` re-exports it from `./typesafe` and `./laya` (verified through the built package specifiers).
    - **Bounds.** Pre-fetch validation reuses `MAX_SYSTEMONE_QUESTIONS`/`MAX_SYSTEMONE_CHOICE_OPTIONS`/`MAX_SYSTEMONE_SCORE_LEVELS`: 1–256 questions, choice criteria 2–255 string/null options, score criteria 2–10 strings, non-empty `instructions`, serialized `state` under `maxStateBytes` (default 256 KiB), `timeoutMs` positive finite, `maxStateBytes` positive integer. Violations throw `SystemOneError` with `status` 0 before credential resolution or fetch (test asserts zero fetch calls).
    - **Deadline and abort.** `timeoutMs` becomes `AbortSignal.timeout(ms)` composed with the caller signal via `AbortSignal.any`, so the existing retry loop and its waits are bounded together. Abort/Timeout native errors normalize to the new `SystemOneAbortedError extends SystemOneError` (`status` 0, `cause` preserved); 401/422/429-5xx keep `SystemOneAuthError`/`SystemOneInvalidRequestError`/`SystemOneRetryExhaustedError`. No path fabricates a neutral answer.
    - **Security.** Credential resolution stays in `postSystemOne` (one call under `options.provider`); the new test asserts a resolver source is invoked exactly once with provider `TypeSafe Jev` and that an upstream body echoing the key is redacted. State-text warning (questions never in state) and host-only authority wording are in the new page.
    - **Docs.** New `docs/providers/decisions.md` API page (inputs/outputs/error table/limits/security); `docs/providers/typesafe.md` and `docs/providers/laya.md` link the subpath; `docs/index.md` gains a provider-group entry and extends the current-line System One bullet. `node scripts/package-truth.mjs --emit-docs` regenerated the provider inventories.
    - **Drift from the plan.** The API-note example writes `{ type: "choice", criteria: {...} }` without `instructions`; the wire body and the schema compiler both require non-empty instructions, so the implementation requires it and the docs show a complete example. The "optional deadline" is named `timeoutMs` and the state bound is `maxStateBytes`.
    - **Plumbing.** Provider taxonomy: `scripts/package-truth.mjs` now exports `NON_ADAPTER_PROVIDER_SUBPATHS` (`./decisions`) and `providerAdapterSubpaths()`, and `scripts/phase37-provider-matrix.test.mjs` uses the same set, so the adapter count, the generated provider tables, and the phase24 `counts.provider === 22` freeze stay truthful (`./decisions` is a host helper, not a model adapter). `scripts/budgets.json` providers ceiling 582→588 with a reason (plan 122 Task 3 +5; the F3 `isSystemOneAnswer` +1 already in the tree). `node scripts/release.mjs gate` surfaced the compat-surface signature quirk: Task 2's added `ObservationalMemoryFlushSkipReason` changed the recorded multi-name type re-export line for five memory names, so baselines were refreshed via `node scripts/release.mjs gate --update-baseline` — 0 removals anywhere; memory +1 name and 5 re-export lines, providers +54 names now reachable through the decisions barrel (the shared client/schema surface was previously unreachable from any entry point). `plans/README.md` gained the missing plan 122 row (plan-index docs test). `scripts/dead-export-verify.mjs --check`, `scripts/budget-gate.test.mjs`, `scripts/phase24-truth.test.mjs`, `scripts/phase37-provider-matrix.test.mjs`, and `scripts/truth-current.test.mjs` are green. Local caveat: `scripts/release-evidence.json` is gitignored; re-running `node scripts/release-skip-manifest.mjs` in this env regenerates a `test:postgres` blocked row because `PRISM_TEST_POSTGRES_URL` is unset (same CI-marker caveat plan 120 recorded), while `node scripts/release.mjs gate` itself is green against the pre-existing artifact. Pre-existing (not Task 3): `dist/__tests__/docs.test.js` flags `docs/synapta-integration-review.md` as unlinked in `docs/index.md` — Task 10's review-doc addendum owns closing that. All Task 3 changes are additions: no symbol moved or removed.

- [x] Task 4 — Fixed-model aggregate budget composition across runs (high priority)
  - Acceptance Criteria:
    - Functional: a runnable example (and test) demonstrating one governed provider, fixed model pin, one task id, and three sequential `session.run()` calls plus one auxiliary call sharing the task ceiling: aggregate reservation, renewal fencing, and settlement behave as one budget.
    - Functional: exceeding the aggregate mid-composition yields the documented exhaustion error, not a per-run reset; unknown usage remains unknown liability after settlement.
    - Functional: example shows remaining-aggregate reporting distinct from context-window pressure (no attention-threshold changes to fake totals).
    - Performance: no new runtime code in core; composition uses existing router APIs only.
    - Code Quality: example is copy-paste runnable (mock provider by default, live opt-in), typed, lint-clean.
    - Security: no credential material in example defaults; budget accounting cannot be reset by model change or worker restart within the example's own guarantees (documented boundary: durable router state).
  - Approach:
    - Documentation Reviewed:
      - `docs/model-routing.md` (six-stage lifecycle, `renewBudget`, settlement, unknown-usage charging); review §3 item 3; Task 1 inventory rows for the router's actual in-tree location and exported names.
    - Options Considered:
      - New budget-only facade API: rejected — review says add only if the composition proves existing APIs unsuitable; this task is that proof attempt.
      - Example + test composition: chosen — zero API surface added, answers the Synapta step-loop gap in public form.
    - Chosen Approach:
      - `examples/model-router-aggregate-budgets.ts` with a companion test asserting aggregate exhaustion across the three runs and auxiliary call.
    - API Notes and Examples:
      ```ts
      const governed = createGovernedProvider({ /* provider, taskId, budgets: { inputTokens: 500_000 } */ });
      // three session.run() calls over the same task id share the ceiling
      ```
      (exact names pinned by Task 1 inventory).
    - Files to Create/Edit:
      - `examples/model-router-aggregate-budgets.ts`: new composition.
      - `examples/model-router-aggregate-budgets.test.ts` (or the examples test stage's existing layout, per `docs/testing.md`): assertions above.
      - `docs/model-routing.md`: "Aggregate budgets across host step loops" section linking the example.
    - References:
      - Review §3 item 3; Synapta `plans/executed/122-Prism070ModelRouterBudgets.md` (adoption gate context — host decision, not Prism's).
  - Test Cases to Write:
    - `aggregate ceiling spans runs and auxiliary calls`: third run fails when the first two consume the ceiling.
    - `unknown usage settles as unknown liability`: unsettle-then-settle path leaves no zero-reset.
    - `model pin unchanged throughout`: no automatic fallback invoked.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — example and docs only.
    - Docs pages to create/edit: `docs/model-routing.md` (section + example link).
    - `docs/index.md` update: no — entry already exists; sentence unchanged (no behavior delta).
    - Documentation structure reference: not applicable.
  - **Execution notes (2026-09-24, verified against 949323af).**
    - **Composition.** `examples/model-router-aggregate-budgets.ts`: one `taskId` pool (`budgets.maxTokens` 30, `windowMs` 24h), fixed pin `mock/fixed-pin` with zero fallbacks, governed provider `maxTokens` 15 per run, three `session.run()` calls plus one auxiliary `kind: "compaction"` call admitted through `router.resolve` (reserve 5, usage 3). Trace: run1 reserve 15 → commit 12 (used 12, free 18); auxiliary reserve 5 → `renewBudget` advances the fencing token, the pre-renewal commit is rejected `ERR_PRISM_MODEL_ROUTER_STATE`, then commit 3 (used 15, free 15); run2 reserve 15 → commit 12 (used 27, free 3); run3 reservation 15 > 3 → `AgentRunError` whose `result.error.code` is `ERR_PRISM_MODEL_ROUTER_BUDGET` (`session.run` throws on failed runs; the example catches `.result`). The pool is task-level via `state.ts:475` `budgetKeyOf`, so provider/model are attribution dimensions once `taskId` is set — the fixed pin is a policy choice, not an accounting requirement.
    - **Settlement shape observed.** Successful runs settle with `outcome: "early_close"` (the agent loop stops consuming after `done`) but commit actual usage (12) because output was emitted; nothing is released or charged unknown. `readBudget` reported `tokens 27`, `byModel { mock:fixed-pin: 27 }`, `byKind { generation: 24, compaction: 3 }`.
    - **Unknown liability.** A second router/task whose resolver yields `providerDone()` with no usage: settlement `unknownUsage: true`, `budgetCommitted: true`, and `readBudget` charges the full 15-token reservation — missing usage never resets to zero.
    - **Capability gating / context pressure.** The payload reports `contextWindowTokens` 200,000 separately from `remainingTokens` 3 and states no attention threshold is derived from another run's spend; the docs section repeats the separation.
    - **Test placement.** `src/__tests__/model-router-aggregate-budgets-example.test.ts` (4 tests) follows the dedicated example-spawn layout (`crew-hierarchy-example.test.ts` precedent) — no `examples/*.test.ts` layout exists, and the `spawnSync(process.execPath, ["examples/..."])` shape makes the example *dedicated* in `scripts/examples-execution.test.mjs` partitioning, so the stage does not double-run it. Payload is the example's single-line JSON.
    - **Docs.** `docs/model-routing.md` gained `### Aggregate budgets across host step loops` (task pool, renewal fencing, unknown liability, durability boundary, example link); `examples/README.md` lists the new example (the docs test requires every `examples/*.ts` there).
    - **Verification.** Example exit 0; `tsc -p examples --noEmit` clean; 4/4 new tests; `scripts/examples-execution.test.mjs` 2/2; `budget-gate` 19/19; `import-hygiene` + `scan-secrets` + `live-doc-check` 12/12; `dist/__tests__/docs.test.js` 155/156 with the only failure the pre-existing `docs/synapta-integration-review.md` index link owned by Task 10. No core runtime code changed.

- [x] Task 5 — Host step-loop timeline correlation composition (high priority)
  - Acceptance Criteria:
    - Functional: a runnable example correlating host action/attempt/step ids with Prism session/run ids, projecting `ExecutionTimeline` per step, and persisting metadata-only timeline records into a host ledger (file-backed in the example) — content policy `metadata` by default.
    - Functional: an eight-step plan loses no step trace: every step yields timeline turns with budgets/stop reasons; truncation-prone prose traces are shown alongside structural fields, not parsed from them.
    - Functional: external host commit/verification evidence attaches to the timeline without masquerading as in-Prism effects.
    - Performance: incremental folder projection (no full re-projection per step) in the example; example sized to stay within the performance test budget.
    - Code Quality: correlation uses existing identities/events; any added correlation field is justified by a demonstrated projection loss recorded in execution notes.
    - Security: metadata-only default; no chain-of-thought capture; argument hashes only (no raw tool args) in persisted records.
  - Approach:
    - Documentation Reviewed:
      - `docs/execution-timeline.md` (projectors, incremental folders, content policies, caps); `docs/evaluations.md` (trajectory scorers); review §3 item 4.
    - Options Considered:
      - New correlation API in core: deferred — only if the example cannot express correlation with existing identities (record the gap, then propose).
      - Composition example: chosen — directly reusable by Synapta Plan 157's ledger channel without Prism-side authority.
    - Chosen Approach:
      - `examples/host-step-loop-timeline.ts` + test, ledger as newline-delimited JSON file, content policy `metadata`.
    - API Notes and Examples:
      ```ts
      const folder = createTimelineFolder({ sessionId, after: cursor }); // incremental per step
      for await (const event of folder) ledger.append({ actionId, step, event });
      ```
    - Files to Create/Edit:
      - `examples/host-step-loop-timeline.ts`: new composition.
      - example test (examples stage): eight-step no-loss + external-evidence attachment assertions.
      - `docs/execution-timeline.md`: "Host step loops and ledger persistence" section.
    - References:
      - Review §3 item 4; Synapta `plans/157-DoTransparencyClosure.md` (480-char trace constraint being replaced host-side).
  - Test Cases to Write:
    - `eight steps all present with budgets and stop reasons`.
    - `metadata-only policy leaks no tool args`: persisted ledger contains hashes not raw args.
    - `external commit evidence distinct from prism effects`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — example/docs only (unless a correlation gap is proven, which would return as its own task).
    - Docs pages to create/edit: `docs/execution-timeline.md` (section).
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.
  - **Execution notes (2026-09-24, verified against 949323af).**
    - **Composition.** `examples/host-step-loop-timeline.ts`: eight-step host loop, one `session.run()` per step, host `stepId`/`actionId`/`attemptId` in the ledger envelope (`host`) beside the run's `prism.sessionId`/`runId`; projection is one `createTimelineFolder({ content: "metadata" })` per step fed by the live subscription and one `snapshot()`; ledger is newline-delimited JSON in a `mkdtemp` directory (`ledgerPath` in the payload).
    - **Correlation decision (no new field).** Prism events already carry `sessionId`/`runId`, so the timeline needs no correlation field; host ids have no Prism-side identity and stay in the ledger envelope. **Demonstrated projection loss found while wiring the folder:** `session.run()` emits `agent_started` before it returns, so the `Promise.all([session.run(...), consume])` order used by `examples/execution-timeline.ts` misses `agent_started` — `timeline.runId` was `""` and `startedAt` fell back to snapshot time (observed empirically). Fix: call `session.subscribe()` (registers synchronously) before starting the run, consume concurrently, drain after the run closes the subscriber. Applied to this example *and* the pre-existing live section of `examples/execution-timeline.ts`; docs section records the ordering requirement. No core change was needed.
    - **Eight-step no-loss.** Ledger has exactly 8 records; each per-step timeline has `run`+`turn`+`provider` steps, ≥1 turn with `budgets.runInputUsed: number` and a `stopReason`; step 4 exercises a tool round (turns `tool_calls` → `end_turn`, one `tool` step, 18 pushed events vs 9 elsewhere); 8 distinct `runId`s.
    - **Metadata-only persistence.** `timeline.content === "metadata"`; the stringified projection of every tool step has no `input` key; the raw tool argument sentinel (`sk-live-never-persist-this`) is absent from every timeline; the ledger's `toolCalls` array carries `sha256:<64 hex>` host-computed hashes instead (host hashes its own `tool_execution_started.call.arguments`, no Prism API added).
    - **External evidence separation.** Only step 8 carries `externalEvidence` (`authority: "host"`, `commitId: "commit_step-08"`, `verification.status: "verified"`, `inPrismEffects: false`) at the ledger-envelope top level; it does not appear inside the timeline and no timeline step claims commit semantics.
    - **Prose policy.** Each record carries `legacyTrace480` (exactly 480 chars, truncated by the host) beside the structural `timeline`; nothing reads it back — budgets/turns/stop reasons are asserted from typed fields only.
    - **Docs.** `docs/execution-timeline.md` gained `### Host step loops and ledger persistence` (subscribe-before-run ordering note, per-step incremental folder, NDJSON ledger, prose display-only, external evidence separation, example link); `examples/README.md` lists the example and its run command.
    - **Verification.** 4/4 new tests (`src/__tests__/host-step-loop-timeline-example.test.ts`); example exits 0; `tsc -p examples --noEmit` clean; `scripts/examples-execution.test.mjs` 2/2; `dist/__tests__/docs.test.js` 167/168 (only the pre-existing `docs/synapta-integration-review.md` index link owned by Task 10); budget-gate 19/19; `live-doc-check` + `import-hygiene` + `scan-secrets` pass; `git diff --check` clean.

- [x] Task 6 — Field-evidence proposal provenance guardrail (high priority)
  - Acceptance Criteria:
    - Functional: an optional tool-input guardrail (shipped alongside `evidence-grounding.ts`) validating host-selected field paths on a proposal-shaped tool call: each required field carries a typed source reference (tool result id, field path, normalized value, source revision/freshness) and the normalized value matches exactly; mismatches (wrong object, wrong revision, invented value) reject the tool call with a typed error naming field and reason.
    - Functional: host supplies the evidence set and required-field list; the guardrail performs no retrieval and grants no authority — it only verifies claimed provenance.
    - Performance: validation is O(fields × evidence) with bounded evidence size; runs before tool dispatch; no model calls.
    - Code Quality: composable with existing guardrail chains; typed result carried in the existing guardrail-decision surface (review F1 note: `guardrail_decision` timeline fold already exists).
    - Security: fail-closed — missing evidence for a required field rejects; normalized comparison is unit/currency-identity aware via host-provided normalizer (default: exact string/number match).
  - Approach:
    - Documentation Reviewed:
      - `docs/guardrails.md`; `src/evidence-grounding.ts`; review §3 item 5; Synapta `plans/156-ProposePayloadProvenance.md` (consumer gap).
    - Options Considered:
      - Domain proposal engine inside Prism: rejected — review forbids business authority in Prism; host keeps proposal semantics.
      - Field-path verifier on the existing tool-input guardrail seam: chosen — reuses dispatch interception, redaction, and timeline fold.
    - Chosen Approach:
      - New guardrail factory next to `evidence-grounding.ts`; evidence supplied per-call by the host from its own ledger.
    - API Notes and Examples:
      ```ts
      const provenance = createFieldEvidenceGuardrail({
        toolName: "synapta:proposal", // example; any tool name the host selects
        required: [["amount", { source: resultId, path: "invoice.total", revision }]],
        normalize: hostNormalizer,
      });
      ```
    - Files to Create/Edit:
      - `src/field-evidence.ts`: guardrail factory (name tentative — align with `src/guardrails.ts` conventions in Task 1).
      - `src/__tests__/field-evidence.test.ts`: suite below.
      - `docs/guardrails.md`: section + example.
      - `docs/index.md`: guardrail entry sentence gains field-evidence verifier mention (behavior: new opt-in guardrail).
    - References:
      - Review §3 item 5; `src/evidence-grounding.ts`; `docs/work-artifacts-and-review.md` (approval surfaces).
  - Test Cases to Write:
    - `invented value rejected`: field absent from evidence set.
    - `correct value wrong object rejected`: value matches a different source id.
    - `stale revision rejected`: evidence revision older than required.
    - `typed authorized evidence accepted`.
    - `fail-closed on missing host evidence`: empty evidence set rejects required fields.
    - `no authority granted`: guardrail only verifies; rejection message carries no commit semantics.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new opt-in guardrail.
    - Docs pages to create/edit: `docs/guardrails.md`, `docs/index.md`.
    - `docs/index.md` update: yes — one clause on the guardrails entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Execution notes (2026-09-24, verified against 949323af).**
    - **Surface.** New `src/field-evidence.ts`: `createFieldEvidenceGuardrail({ toolName, required, evidence, normalize? })` returns `Guardrail<"tool_input">`; types `FieldEvidenceGuardrailOptions`, `FieldEvidenceRecord`, `FieldEvidenceSource`, `FieldEvidenceContext`, `FieldEvidenceNormalizer`, `FieldProvenanceClaim`, `FieldEvidenceViolation`; all eight names re-exported from `src/index.ts` next to `evidence-grounding`.
    - **API drift from the plan snippet (recorded).** The sketch showed evidence refs in config (`required: [["amount", { source, path, revision }]]`). That shape cannot verify anything: the claim under test must live in the tool call itself. Shipped shape: `required` is a list of argument paths (dot paths supported); each required path must hold a provenance envelope `{ value, source, path, revision? }`; the host supplies the authoritative current evidence per call through `evidence(context)` (sync extractor receiving session/run/toolCallId/arguments/metadata/signal), and `normalize` canonicalizes units/currency before exact `Object.is` comparison. This also keeps retrieval, grants, and commit authority out of Prism.
    - **Verification semantics (fail-closed).** Typed violations: `missing_field` (path absent), `malformed_claim` (plain value / incomplete envelope / invalid revision), `missing_evidence` (no valid evidence rows), `unknown_source` (no row matches claimed source+path — invented field or wrong object), `stale_revision` (revision mismatch in either direction: a claim without revision cannot match a row that has one and vice versa), `value_mismatch`, `evidence_over_limit` (>4096 valid rows blocks instead of truncating). A violation returns `{ action: "block", reason: "field_evidence", metadata: { field, violation } }`; metadata never carries claimed/evidence values or commit/approval semantics. Only the configured `toolName` is evaluated; other tool calls allow untouched. Malformed options throw `TypeError` at construction (`required` 1–256 paths, ≤256 chars each).
    - **Tests.** `src/__tests__/field-evidence.test.ts`, 11 tests: the plan's six named cases plus normalizer usage, missing/malformed/mismatch field coverage, evidence-over-limit, option validation, and a session-seam integration test proving a mismatched claim blocks the call before dispatch (tool execute count 0, run continues, `guardrail_decision` record carries the typed metadata).
    - **Docs.** `docs/guardrails.md` gained `## Field-evidence provenance` (envelope example, evidence rows, bounds, violation table, no-authority/neutral-refusal note); `docs/index.md` guardrails entry now names the field-evidence verifier in one clause.
    - **Plumbing.** Budget baseline `@arnilo/prism` 1465→1473 (+8) with a dated reason entry; compat baseline `arnilo__prism.txt` +8 lines (one `createFieldEvidenceGuardrail` function line + seven names in the single new re-export block — additions only, `runGates` reported 0 removed/changed and `updated: false` on re-run); `scripts/package-truth.mjs --emit-docs` regenerated (`@arnilo/prism` dist 1042→1050, src 1465→1473; memory/providers rows already carried Task 2/3 deltas) and `truth-current` is 10/10.
    - **Verification runs.** field-evidence 11/11; budget-gate 19/19; docs.test + live-doc-check + import-hygiene + scan-secrets 178/179 (only the pre-existing `docs/synapta-integration-review.md` index link owned by Task 10); dead-export-verify 0 candidates / 0 removals; `git diff --check` clean.

- [x] Task 7 — Cross-layer revocation composition proof (high priority)
  - Acceptance Criteria:
    - Functional: a runnable example + test demonstrating revoke-source → retrieval exclusion (both query legs and post-rerank gate) → OM `invalidatedIds` withholding → next context assembly without the revoked content, using existing RAG and OM primitives only.
    - Functional: loss-of-access (principal loses permission, source retained for others) is exercised separately from global deletion, with distinct observable outcomes.
    - Performance: no new propagation loops beyond existing tombstone/deletion-propagator paths; example runs offline with in-memory adapters.
    - Code Quality: composition-only; any seam needed to push host-resolved invalidation ids into existing projection paths is additive and documented (or proven unnecessary).
    - Security: fail-closed denial path observable (`onAccessDenied` with redacted error); legal-hold retention does not restore retrieval; no claim that prior authorized external disclosure is erased.
  - Approach:
    - Documentation Reviewed:
      - `docs/rag.md` (query-leg authorization, re-ask per source, post-rerank gate, tombstones, `repointSource`); `docs/compaction-observational-memory.md` (`invalidatedIds`); review §3 item 6.
    - Options Considered:
      - New revocation bus in Prism: rejected — duplicates kernel/outbox authority.
      - Composition example proving existing propagation end-to-end: chosen — Synapta Plan 161 needs proof of composition, not a new subsystem.
    - Chosen Approach:
      - `examples/revocation-propagation.ts` chaining RAG handlers, deletion propagator, and an OM attach with invalidated ids.
    - API Notes and Examples:
      ```ts
      await rag.revokeSource({ sourceId });            // tombstone + propagation
      const context = await om.attach(session);          // invalidatedIds withheld
      ```
    - Files to Create/Edit:
      - `examples/revocation-propagation.ts`: new composition.
      - example test: outcomes below.
      - `docs/rag.md`: "Revocation through derived context" section linking the example.
    - References:
      - Review §3 item 6; Synapta `plans/161-KnowledgeRetrievalAndRevocationClosure.md` (host obligations list).
  - Test Cases to Write:
    - `revoke between rerank legs excludes mid-flight`.
    - `revoke between step runs withholds from next context via invalidatedIds`.
    - `post-report-generation revoke blocks subsequent exposure`.
    - `principal access loss ≠ deletion`: distinct outcomes.
    - `denial path redacted and fail-closed`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — example/docs only.
    - Docs pages to create/edit: `docs/rag.md` (section).
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.
  - **Execution notes (2026-09-24, verified against 949323af).**
    - **Deliverables.** `examples/revocation-propagation.ts` (offline, in-memory vector/session stores, hash embedder, no network) and `src/__tests__/revocation-propagation-example.test.ts` (spawn + last-stdout-line JSON, 5/5). Docs: `docs/rag.md` gained `## Revocation through derived context`; `examples/README.md` gained the run-command line and bullet the example gate requires.
    - **API drift recorded (both already flagged by Task 1, now shipped against the real names).** The plan snippet's `rag.revokeSource({ sourceId })` does not exist; the composition uses `createDeletionPropagator().propagate(sourceId)` with `createRagDeletionHandler({ store, scope })` registered — the `deleteSource`-backed handler from `sources.ts:178`. The plan snippet's `om.attach(session)` also does not take host-resolved invalidation ids: the documented read path is `listInvalidatedIds(store, vectorScope)` → `buildObservationalMemoryContextBlocks(entries, { invalidatedIds })`, and the write path is `createObservationalMemoryDropHandler({ session, appendEntry })`. The example runs both on the same tombstones and asserts they render identical memory (parity), so no new seam was needed — requirement "additive and documented (or proven unnecessary)" resolves to proven-unnecessary.
    - **Scope vocabulary.** The propagator/store scope is the vector `MemoryScope` `{ tenantId, resourceId, threadId }`; the RAG lifecycle scope is `{ tenantId, resourceId, corpusId }` with `threadId === corpusId`. One in-memory store serves retrieval, grants, tombstones, and the lineage walk.
    - **Composition sequence.** (1) access loss: `setSourceAccess` narrows the payroll grant to `["auditor"]` v2 → analyst query excludes (audit `no_grant`, rows retained, `listInvalidatedIds` empty) while the auditor still reads it; (2) deletion pass one: propagator with only the RAG handler tombstones the lineage-closed set and removes the chunk rows → every principal excludes it; (3) read path: `invalidatedIds` withholds the payroll-sourced observation before any drop entry exists; (4) write path: the OM handler is registered on the same propagator, a second `propagate` writes one `om.observations.dropped` entry (second-pass ids still carry the root source id even with the chunk rows gone), and the fold excludes the observation; (5) mid-flight: a custom reranker revokes `plan-notes` while running — the post-rerank gate re-reads and withholds it (`no_grant`, `hits: 1`); (6) fail-closed: a store whose `checkSourceAccess` throws for one source yields `check_failed` with the error redacted (`[REDACTED]`) and capped at 256 chars, and the query still completes with the remaining hits (`security-guide`).
    - **Disclosure boundary.** The report generated from the authorized baseline contains the payroll text and stays as host artifact; after deletion no later query returns the source for any principal. The payload records `reportHadRevokedText` and `postDeletionRetrievedRevoked` so the test states both facts; the docs sentence explicitly says revocation prevents subsequent exposure and does not erase prior external disclosure. Payload also records `attentionThresholdsTouched: false` and `executionAuthority: "host"`.
    - **Performance/security.** Composition-only: no new propagation loop or store query beyond the existing tombstone/deletion path, one `listInvalidatedIds` read per projection build; in-memory, deterministic, exits 0 inside the 60s example stage; retrieval authority, grants, and commit stay host-held.
    - **Verification runs.** companion test 5/5; `npx tsc -p examples --noEmit` clean; `scripts/examples-execution.test.mjs` 2/2 (new example auto-spawned); docs.test + live-doc-check + import-hygiene + scan-secrets 167/168 (only the pre-existing `docs/synapta-integration-review.md` index link owned by Task 10); `git diff --check` clean.

- [x] Task 8 — Packed-install compatibility suite for the host-composition shape
  - Acceptance Criteria:
    - Functional: a test stage (examples-level, offline by default) exercising the packed tarball of the exact family release against the Synapta-shaped composition: host tools only (no model-visible memory/fabric tools), agent+run policy chain in `snapshotRunBundle`, per-step run boundaries with stop reasons, OM retention under Task 2 admission, usage/attention trace fields, revocation withholding, and Task 3 typed decisions with injected transport.
    - Functional: the suite runs against the version Synapta pins (0.9.0) and the current release, reporting deltas rather than failing on the old pin (documentation of drift, not a gate on Synapta's pin).
    - Performance: suite runtime bounded (mock transports, in-memory stores); included in the existing examples test stage.
    - Code Quality: reuses Tasks 2–7 compositions as imports/fixtures rather than duplicating them.
    - Security: no network by default; any live opt-ins behind explicit env vars, skipped in CI without them.
  - Approach:
    - Documentation Reviewed:
      - `docs/testing.md` (stage table, examples stage); `docs/run-bundle.md`; review §3 "packed compatibility proofs".
    - Options Considered:
      - Full packed-install matrix across runtimes: over-scoped for this plan; deferred to Further Actions.
      - Single-family two-version comparison suite: chosen — closes the review's "0.9.0 pin will not receive these fixes automatically" blind spot cheaply.
    - Chosen Approach:
      - One example script + test that `npm pack`s (or uses the release fixture) both versions and runs the composition assertions, emitting a delta report.
    - API Notes and Examples:
      ```ts
      // examples/host-composition-compat.test.ts
      for (const version of ["0.9.0", CURRENT]) await assertHostCompositionShape(install(version));
      ```
    - Files to Create/Edit:
      - `examples/host-composition-compat.ts` + `.test.ts`: new suite (packing mechanics per `docs/testing.md` tracked-fixture rules).
      - `docs/testing.md`: stage note.
      - `docs/index.md`: no change (testing entry sentence already covers stages; add clause only if a new stage is created).
    - References:
      - Review §3 final item and §5; `docs/testing.md`.
  - Test Cases to Write:
    - `shape holds on current release`: all seven assertions pass.
    - `0.9.0 deltas reported not fatal`: known F1–F4 and pre-Task-2 gaps appear as named deltas.
    - `offline by default`: no network without env opt-in.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — test infrastructure.
    - Docs pages to create/edit: `docs/testing.md` (note).
    - `docs/index.md` update: no unless a new stage is added.
    - Documentation structure reference: not applicable.
  - **Execution notes (2026-09-25, verified against the workspace `0.11.1` tree and a live `0.9.0` pin run).**
    - **Deliverables.** `examples/host-composition-compat.ts` — the packed-install consumer contract (`host-tools-only`, `policy-chain-snapshot`, `step-boundaries-and-trace-fields`, `om-coverage-admission-retention`, `typed-decisions-injected-transport`), JSON report on stdout, exit non-zero on failure unless `PRISM_COMPAT_REPORT_ONLY=1`; `src/__tests__/host-composition-compat.test.ts` — the paired suite (current leg + env-gated pin leg); `docs/testing.md` examples-execution row note; `examples/README.md` run line + bullet.
    - **Drift recorded.** The plan listed `examples/host-composition-compat.ts` + `.test.ts`; the test lives at `src/__tests__/host-composition-compat.test.ts` because `examples/` has no test-runner convention (the examples stage only spawns `examples/*.ts`), and root `src/__tests__` is the established home for packed-suite spawn tests (Task 4/5 precedent). The script still runs in the examples stage against the workspace, and the companion root test runs it inside packed consumers.
    - **Packing mechanics.** Reuses `scripts/fixtures/packed-consumer.mjs#createPackedConsumer` (offline-first install, cold-cache fallback like the existing journeys) for the four family packages the composition needs — `@arnilo/prism`, `prism-core`, `prism-memory`, `prism-providers` — and asserts the installed versions equal the workspace manifests and share one version. The consumer script and the Task 5/7 example fixtures are copied into the consumer dir, so every import resolves from tarballs, never workspace source.
    - **Reuse of Tasks 2–7.** Task 5's `host-step-loop-timeline.ts` runs as a packed fixture (asserts `stepCount: 8`, `contentPolicy: "metadata"`); Task 7's `revocation-propagation.ts` runs packed (asserts context read/drop parity and the mid-rerank `no_grant` withholding); Task 2's admission is exercised through `createObservationalMemoryCompactionStrategy` (m1 covered by om1, unscanned m2+m3, `keepRecentEntries: 1` → `keepEntryIds [m2, m3]`, `throughEntryId om1`); Task 3's surface through `askSystemOneDecisions` with an injected `fetch` (ids/probabilities/model/usage/timingMs preserved, exactly one round trip); Task 6 has no consumer-facing contract in the seven areas and Task 8's field-evidence guardrail stays covered by its own root suite. Task 4's aggregate-budget composition is not in the review's packed contract list and was not duplicated here.
    - **Policy-chain check semantics.** The consumer runs one turn with two agent policies plus one run policy, asserts execution order `[agent-first, agent-second, run-last]`, and asserts `snapshotRunBundle().requestPolicies` matches it exactly — the F1 fix (snapshot concatenates agent then run policies) is what the check proves.
    - **Trace-field check semantics.** A tool turn + text turn with `attentionCompiler: { maxInputTokens: 4096 }` and run `limits: { maxInputTokens: 10_000 }`; asserts `turns[].stopReason` `[tool_calls, end_turn]` and `turns[0].budgets` carries `runInputUsed`, `inputCap 4096`, `runInputBudget 10_000`, `inputTokens 12`, `inputTokensSource "reported"` — usage plus attention-compiler fields, not just turn counts.
    - **Pin leg (default `0.9.0`).** Env-gated and skip-not-fail: `PRISM_TEST_COMPAT_PIN_DIR` installs pre-packed tarballs offline, `PRISM_TEST_COMPAT_PIN_FETCH=1` packs from the registry, `PRISM_TEST_COMPAT_PIN` overrides the version; with no env the test reports `# env-gated` and CI runs no network. A live run with fetch on 2026-09-25 produced named deltas: `policy-chain-snapshot` (0.9.0 executes/records only the run-level policy — the F1 gap), `step-boundaries-and-trace-fields` (`inputTokensSource` absent), `om-coverage-admission-retention` (folded unscanned m2; the pre-Task-2 gap), `typed-decisions-injected-transport` (`./decisions` subpath absent; the 0.9.0 legacy adapter has no typed decision surface), and `fixture:revocation-propagation` (packed Task 7 composition fails on 0.9.0). F2 (credential resolved once under the configured provider id), F3 (response shape/range validation), and F4 (`__proto__` choice labels) are wire-level behaviors whose only 0.9.0-visible surface is the legacy `createSystemOneDecisionProvider`; the suite records the typed surface's absence rather than building a legacy-adapter harness, and the pin leg still passes because the deltas are the expected documentation of drift.
    - **Offline/security.** No registry access without `PRISM_TEST_COMPAT_PIN_FETCH=1`; mock providers, in-memory stores, and an injected `fetch` (`sk-compat-fake` never leaves the process) keep the leg hermetic; temp pack/consumer dirs are removed in `finally`; no check prints secrets.
    - **Performance.** Current leg packs 4 tarballs + installs + runs the consumer and both fixtures in ~5–9s wall; the pin leg adds ~5–11s under an explicit opt-in; the examples stage's workspace run of the consumer is sub-second. No new stage, no new manifest entry.
    - **Verification runs.** `node --test dist/__tests__/host-composition-compat.test.js` 3 pass + 1 env-gated skip by default; with `PRISM_TEST_COMPAT_PIN_FETCH=1` 4/4 pass including the pinned leg; `npx tsc -p examples --noEmit` clean; biome clean on both new files; docs.test + examples-execution 157/158 (only the pre-existing `docs/synapta-integration-review.md` index link owned by Task 10); budget-gate 19/19; `git diff --check` clean. No public exports changed, so no budget/compat-baseline/package-truth regeneration was needed for this task.

- [x] Task 9 — Release readiness and review-doc closure
  - Acceptance Criteria:
    - Functional: full local gate green: `npm run build:core`, providers build + suite, core runtime suites, examples stage, biome, `git diff --check`; `release:gate` green (no baseline changes expected — additions only; if any task moved symbols, its own baseline regeneration note governs).
    - Functional: `docs/synapta-integration-review.md` gains a short "Remediation status" addendum pointing at this plan and the tasks that closed each recommendation.
    - Performance: no regression in the performance budget stage attributable to Tasks 2–8 (Task 2's retention is bounded by the compaction gate, not the prompt-size benchmark).
    - Code Quality: no TODO/FIXME left in new code; CHANGELOG entries drafted under the next version heading.
    - Security: secrets scan on new examples/tests clean.
  - Approach:
    - Documentation Reviewed:
      - `docs/testing.md` (stage table); `CHANGELOG.md` conventions; plan 120 (release-readiness precedent).
    - Options Considered:
      - Fold into Task 8: rejected — release gate + doc closure deserve an independently checkable task.
    - Chosen Approach:
      - Sequential full verification, then review-doc addendum, then CHANGELOG draft.
    - API Notes and Examples:
      ```sh
      npm run build:core && npm test --workspace @arnilo/prism-providers
      node --test --test-concurrency=1 dist/__tests__/run-bundle.test.js
      node scripts/release.mjs gate
      ```
    - Files to Create/Edit:
      - `docs/synapta-integration-review.md`: remediation-status addendum.
      - `CHANGELOG.md`: next-version draft entries.
      - `plans/122-Synapta-Integration-Review-Remediations.md`: mark tasks complete, fill Compromises/Further Actions.
    - References:
      - Review §5 (verification limits to close); plan 120.
  - Test Cases to Write:
    - none beyond running the gates (this task verifies, does not add behavior).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — closure task.
    - Docs pages to create/edit: `docs/synapta-integration-review.md` (addendum), `CHANGELOG.md`.
    - `docs/index.md` update: yes — the review page gains its single navigation link under Third-party integrations (this doubles as the docs.test nav check that earlier notes mis-attributed to a nonexistent "Task 10").
    - Documentation structure reference: not applicable.
  - **Execution notes (2026-09-25, verified on the `949323af` tree with the local host under sustained external CPU load).**
    - **Deliverables.** `docs/synapta-integration-review.md` gained `## 6. Remediation status`: a table mapping §2 F1–F4 and the six §3 recommendations plus the §5 packed proofs to their tasks and evidence, and an updated verification-limits paragraph (release gate, PostgreSQL run, and packed matrix now executed; live System One, Synapta e2e, and cross-replica drills still not). `docs/index.md` gained exactly one link to the review under Third-party integrations. `CHANGELOG.md` gained an `[Unreleased]` section: Added — `@arnilo/prism-providers/decisions` typed call, `createFieldEvidenceGuardrail`, `advertiseRecall`; Changed — coverage-safe observational-memory compaction and the exported `ObservationalMemoryFlushSkipReason`; Security — fail-closed provenance and no effect authority. `plans/README.md` row status is now `complete`.
    - **Correction recorded.** Several earlier task notes deferred the `docs/index.md` review link to a "Task 10"; this plan has nine tasks, so that closure lands here (docs.test 156/156 afterwards).
    - **Stale gate surfaces fixed here (first run of the full root/gate suites since Tasks 2/3/6).** `src/__tests__/packaging.test.ts`: expected provider exports are now `22 adapters + NON_ADAPTER_PROVIDER_SUBPATHS` (imported from `scripts/package-truth.mjs`), and the adapter-isolation allowlist permits `decisions/` for `laya`/`typesafe` only (plan 122 Task 3's deliberate re-export), still forbidding adapter→adapter imports. `src/__tests__/public-export-contract.test.ts`: the frozen SDK snapshots gained the 8 Task 6 root names (`createFieldEvidenceGuardrail` + 7 `FieldEvidence*`/`FieldProvenanceClaim` types). `scripts/e2e-coverage.json`: `@arnilo/prism-providers|./decisions` annotated to the decisions and packed-compat suites, and the real-repo surface total moved 109→110. All deterministic and re-verified green.
    - **Release gate with real evidence.** A disposable `pgvector/pgvector:pg16` container (port 5433) supplied `PRISM_TEST_POSTGRES_URL`; `npm run test:postgres` passed 583 tests / 578 pass / 0 fail and wrote `scripts/postgres-evidence.json` for HEAD `949323af`. `npm run release:gate` then reported `release evidence: 45 surfaces, blocked=false`, `updated: false`, 12 packages — additions-only compat baselines, no removals, no hand-edited or fabricated manifest.
    - **Full local chain.** Pass: build, performance budget, sqlite suites, build race, examples execution, branch coverage (core branches 86.55 ≥ 83.49 floor), plus the deterministic gate suites. `npm test` run 2026-09-25: 7 of 9 stages green; `root suites` and `workspace suites` fail only on host-sensitive absolute-time assertions — run-bundle `snapshots 100 tools inside the 5 ms budget` (median 7.89–8.42ms under the parallel worker pool) and `packages/memory` `checks each distinct source once per query, inside the 5ms budget for 50 sources`. Serial reruns pass: run-bundle 5/5, access-recheck 6/6, redaction benchmark 2/2 (the redaction gate also flaked once under load and passed standalone). This host carries a 24GB qemu VM and `laya-serve` (load average ≈ 11 on 16 cores); review §5 records the same serial-only pass for the same 5 ms benchmark. No threshold or assertion was weakened, matching the repo's existing stance (the workspace-pool comment and `branch-coverage-audit.mjs` `isKnownFlake`).
    - **Quality and security.** `npm run lint` and `npm run format:check` exit 0 over the tree (1799 files), `git diff --check` clean, the secrets-scan gate passes, and no `TODO`/`FIXME` exists in the new code (grep of all Task 2–8 files). Task 9 adds no exports and no runtime behavior.

## Compromises Made

- **Timing assertions kept at their frozen budgets.** `npm test` cannot be fully green on this host while a 24GB qemu VM and `laya-serve` consume CPU: three existing absolute-time assertions (run-bundle 100-tool snapshot 5 ms, memory access-recheck 50-source scan 5 ms, redaction benchmark frozen caps) flake under worker concurrency and pass serially. We deliberately did not widen a single budget or add a flake allowlist to the root/workspace stages; the serial runs are the evidence, exactly as review §5 handled the same 5 ms benchmark. Release sign-off should re-run the full chain on an idle runner.
- **The `0.9.0` packed-compat leg is opt-in.** Old-version installs need the registry, so the pinned leg skips without `PRISM_TEST_COMPAT_PIN_DIR`/`PRISM_TEST_COMPAT_PIN_FETCH=1`; there is no network-free 0.9.0 evidence unless the host pre-packs tarballs.
- **F2–F4 are represented in the packed suite only by the typed surface's absence.** The legacy 0.9.0 adapter could be probed for credential-once resolution, malformed-response rejection, and `__proto__` labels, but that would need a 0.9.0-shaped request harness; the suite records the `./decisions` delta instead.
- **Task 8's companion test lives at `src/__tests__/host-composition-compat.test.ts`**, not `examples/`, because the examples tree has no test-runner convention; the example itself still runs in the examples stage and inside the packed consumers.
- **Task 9's review addendum references the plan path as inline code**, not a markdown link, because `plans/` is excluded from published tarballs (existing docs convention).

## Further Actions

- **High — idle-runner release check.** Re-run the full `npm test` chain on an uncontended runner before the next cut and attach the run; if shared CI is also loaded, bound the root/workspace worker concurrency in `scripts/run-all-tests.mjs` rather than touching the benchmarks.
- **Medium — legacy-adapter compat probes.** Add F2–F4 probes (credential resolved once, malformed responses rejected, `__proto__` labels preserved) to the packed suite when the pin leg is exercised next; they will fail on 0.9.0 as named deltas and pass from the first fixed local line.
- **Medium — Synapta upgrade replay.** When Synapta's execution-worker moves off 0.9.0, run `examples/host-composition-compat.ts` against its selected runtime and append the observed deltas to the review addendum.
- **Low — changelog re-stamp.** When the next version cut moves `[Unreleased]` into a dated heading, re-check the review addendum's wording that the fixes sit in an unreleased section.
- **Low — release evidence is local-only.** `scripts/release-evidence.json` and `scripts/postgres-evidence.json` are gitignored; CI must regenerate both (the local run used a real pgvector container, never a hand-edited manifest).
