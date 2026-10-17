# Phase 11 Part U — context-rot defenses: compaction that fires, overflow recovery, tool-result clearing, accounting, and a measured rot curve

## Objectives

- Make the reference host compact at all. Today it never auto-compacts:
  - OM's `compaction.when` handler abstains while OM is off (its default), and a registered handler is the whole decision, so the kernel fallback never runs (`src/agent-session/session.ts:1016-1034`).
  - `memory-compaction` registers no trigger unless configured, and `apps/prism-agent/src/host/coding.ts:32-41` configures none.
  - Repro 2026-10-17: with `thresholdEntries: 4`, installing OM (toggle off) gave 0 compactions in 8 turns; without OM, 6.
- Recover from a provider's context-overflow rejection by compacting and retrying once, instead of failing the run.
- Clear stale tool output from the provider view in a way that keeps the prompt cache. Observation masking matches LLM summarization at about half the cost (Lindenbauer et al., NeurIPS 2025, arXiv 2508.21433), and the reference host installs neither today.
- Measure what enters each request (per-source context accounting), and cap the share that injected context blocks may take.
- Set compaction triggers from a measured **rot curve** per release model, not from a fixed 81k-token gate:
  - Accuracy falls with input length well inside the advertised window, even with perfect retrieval (Du et al., 2025, arXiv 2510.05381; Chroma "Context Rot", 2025; NoLiMa, ICML 2025).
  - Plan 184's cache parity is then measured on a host whose context actually stays bounded.

## Expected Outcome

- `compaction.when` handlers can abstain: when every handler returns `undefined`, the kernel's configured fallback (`CompactionOptions.thresholdEntries`, or the trigger a package registered) decides. `{ compact: false }` is an explicit "no", and `{ compact: true }` from any handler still wins (`any-compact`). Installing OM with the toggle off no longer changes when a session compacts.
- A model call rejected with failure class `context_overflow` (HTTP 400/413 with the supported routes' overflow bodies, classified in `provider-kit`), before any output streamed, triggers one compaction with `trigger: "overflow"` and one retry of that model call. A second overflow fails the run with `ContextOverflowError` (`code: "context_overflow"`).
- `@arnilo/prism-context-engineering` fold has a cache-aware batch mode, `fold.clearAtLeastTokens`. The fold frontier advances only when the newly foldable tool results total at least that many tokens, and then all of them fold together. Between advances, request prefixes are byte-identical.
- The package emits one `context.accounted` event per request: tokens by source (system, instructions, skills catalog, context blocks by `metadata.source`, history, tool results, tail blocks) and the input cap. Optional `blocks.maxShare` caps the context-block total as a fraction of the input cap and drops whole blocks by lowest priority, with a report.
- `scripts/context-rot/run.mjs` measures, per release model, accuracy on fixed tasks after 0 / 16k / 32k / 64k / 96k tokens of unrelated tool history. It records the **effective input budget**: the largest length whose accuracy stays within 5 points of the 0-token baseline. Evidence: `docs/_evidence/context-rot-0.13.0.md`.
- The coding and research workers:
  - compact on a trigger set from that budget (`memory-compaction` with `trigger`, and `profile: "coding"` for the coding worker)
  - install `context-engineering` fold in batch mode
  - OM's absolute `context.compactAfterTokens` gate is replaced by a ratio of the model's input cap, capped by the measured budget
  - a deterministic 60-turn scenario proves request size stays bounded

**0.13.0 release path — plan 194, step 10 of 14.** Owner decision 2026-10-17: every finding of the context-rot and progressive-disclosure review ships in 0.13.0. The memory-side findings went into plans 188, 190, 191, and 192 as amendments; this plan holds the rest.

Ordering:
- Start this plan when plan 193 is complete; when it is complete, continue with plan 184.
- It runs after plans 188 (OM's compaction coupling, Task 5), 189 (tool results as text, which fold rewrites), and 190 (skill bodies re-attached after compaction).
- It runs before plan 184, because it changes request bytes and the reference host's package set, both of which 184 measures.
- It runs before plan 185, because it adds kernel exports (`ContextOverflowError`, the `overflow` compaction trigger) and changes the `compaction.when` combination rule.

It changes kernel contracts (a decide-hook combination rule, a provider failure class, a loop recovery path), so **Task 1 is the phase review**. It implements roadmap §2.4 (context, compaction, and the `compaction.when` decide hook) and §2.11's context-engineering row. The reference-host changes follow §2.13.

No version bump, publish, or npm deprecation. The rot-curve run is live and opt-in (manual workflow dispatch), never part of `bun run test`.

Cost knobs:
- overflow recovery costs one extra compaction plus one retried model call, only when a provider rejects
- batch fold costs nothing per turn and no model call with `summarize: "truncate"`
- accounting is one event per request
- the rot curve has a stated token ceiling (Task 6)

## Tasks

- [ ] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The task note records, citing `file:line`:
      - (a) **`compaction.when` today.**
        - The decide combination for `compaction.when` (`any-compact`, `src/hooks/catalog.ts:61`; the bus at `src/hooks/bus.ts:270`).
        - The session's resolution (`src/agent-session/session.ts:1009-1056`).
        - Every registered handler and what it returns when it does not want compaction: OM (`packages/memory/observational/src/index.ts:116`, after plan 188 Task 5), `memory-compaction` (`packages/memory/compaction/src/index.ts:55-70`), `context-engineering` attention (`packages/context/engineering/src/index.ts:138-150`).
        - The repro script (this plan's Objectives) reproduced on `main` as a test fixture.
      - (b) **Overflow evidence per supported route.** The status code and body the four supported providers return for an over-long prompt (Hyper and OpenCode Go on the OpenAI-compatible and Anthropic Messages routes; Jev/`typesafe` and Laya on SystemOne):
        - from recorded streams in plan 182's `replayFetch` recordings, or one deliberately oversized live request per route through `scripts/wire-proxy.mjs`, with the key from `~/.config/prism/live.env`
        - also where `classifyProviderFailure` (`src/provider-kit/transport.ts:35`) and `httpStatusError` (`:60`) attach `failureClass`, and how it reaches the session's model-call `catch` (`src/agent-session/session/assemble.ts:502`)
      - (c) **Retry seam.**
        - Whether a model call can be retried after compaction inside the same turn without double-charging limits (`limits.charge("maxTurns")`, `assemble.ts:414`), duplicating usage records (`recordProviderUsage`), or appending a partial assistant message.
        - Whether a stream that already emitted deltas can be told apart (`started` in the call result, `assemble.ts:505`).
        - The compaction trigger union (`compactBranchResilient`, `session.ts:1059-1076`: `"manual" | "auto"`) and where it is persisted and emitted.
      - (d) **Fold mechanics.**
        - How `foldToolResultHistory` decides foldability (`packages/context/engineering/src/fold.ts:63-141`, `inferToolResultTurns` `:180`).
        - Whether the fold result is sticky across requests (the attention frontier is persisted in session state; is the fold cache?), and what changes in request bytes on each turn with `minAgeTurns: 2` today, measured with the prefix-stability conformance fixture.
        - Whether a folded result keeps its `toolCallId` and `metadata` (plan 190 Task 7 anchors on them).
      - (e) **Trigger kinds.** `CompactionTrigger`'s JSON kinds (`input_ratio`, `threshold_tokens`, any-of support) and `resolveInputCap` (`src/compaction.ts`, `src/models/`), and whether the four supported models declare `limits.contextWindow` (plan 183).
      - (f) **Accounting inputs.**
        - What `model.request` handlers see (the final `ProviderRequest` after `applyDraft`, `src/loop/run-controller.ts:133`).
        - Whether context blocks keep `metadata.source` through `withContextMessages` (`:153`).
        - Whether plan 188's tail messages carry `metadata.contextBlocks` (plan 188 Task 9).
        - The token estimator (`estimateAssemblyTokens`).
      - (g) **Reference host.** The scenarios under `apps/prism-agent/src/scenarios/` that assert request bytes or compaction, and the golden fixtures a fold or trigger change rewrites.
      - (h) **Callers** (`graft callers <symbol> --depth all`): `resolveAutoCompact`, `compactBranchResilient`, `classifyProviderFailure`, `foldToolResultHistory`, `resolveToolResultFold`, `createContextEngineeringHandler`, `resolveShouldCompact`.
    - Functional: The note ends with a verdict per task. A finding that a later task's mechanism cannot work stops the plan for a re-cut. One case is planned for: no supported route returns a distinguishable overflow body. Task 3 then classifies by status plus the estimated input over the declared window, and the note says so.
    - Performance: n/a — read-only, except at most four deliberately oversized live requests (one per route), stated in the note with their token counts.
    - Code Quality: No code changes.
    - Security: Keys come from the live loader and never appear in the note; recorded bodies are trimmed to the error object.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.4, §2.11, §2.13; `docs/hooks.md` (decide combination table), `docs/loop.md`, `docs/slots.md`
      - plans 182 (wire proxy, recordings), 183 (model limits), 188 Task 5, 189 Task 2, 190 Task 3
      - the 2026-10-17 review and its repro
    - Options Considered:
      - Skip the review and patch the reference host's config only. Rejected: any host that installs OM hits the same suppression, and the overflow path needs per-route evidence.
    - Chosen Approach:
      - One read-only inventory cited by Tasks 2–7.
    - API Notes and Examples:
      ```bash
      timeout 60 graft callers resolveAutoCompact --depth all
      timeout 120 bun scripts/wire-proxy.mjs --record /tmp/overflow --route hyper
      ```
    - Files to Create/Edit:
      - this plan (task note only)
    - References:
      - the 2026-10-17 context-rot review; owner decision 2026-10-17
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none — review only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: `compaction.when` handlers can abstain
  - Acceptance Criteria:
    - Functional: The `compaction.when` combination becomes:
      - any handler returning `{ compact: true }` → compact
      - else any handler returning `{ compact: false }` → no compaction
      - else (all handlers returned `undefined`, or none is registered) → the kernel fallback: `CompactionOptions.thresholdEntries` when configured, otherwise no compaction
      - A throw still fails closed.
    - Functional: Package handlers are updated in the same task (Task 1 (a), (h)):
      - **OM** returns `undefined` while the session's toggle is off, and `{ compact: false }` while on and below its gate (OM owns the decision for its sessions).
      - **`memory-compaction`**, when a `trigger` is configured, returns `{ compact: false }` below it (it stays "the whole decision", as its README says).
      - **`context-engineering` attention** returns `undefined` below `compactRatio`. It is an extra reason to compact, never a veto, so a host trigger still fires.
    - Functional: The 2026-10-17 repro becomes the test `om_off_does_not_suppress_host_compaction`.
    - Functional: Sweep. A repo-wide grep over `src/ packages/ apps/ scripts/ examples/ docs/` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`) for "an abstaining handler" / "is the whole decision" finds only the updated wording in `docs/hooks.md` and the package READMEs.
    - Performance: No added work: the fallback runs only when every handler abstains, as it would with no handler.
    - Code Quality:
      - The rule is data in the decide combination table (`src/hooks/catalog.ts:54-62`), not a special case in the session.
      - `resolveAutoCompact` reads one tri-state result.
      - No compatibility flag for the old rule.
    - Security: A throwing handler still fails the decision closed (existing invariant test kept).
  - Approach:
    - Documentation Reviewed:
      - `src/hooks/{catalog.ts,bus.ts,types.ts}`, `src/agent-session/session.ts:1009-1056`, the three handlers; Task 1 (a)
    - Options Considered:
      - Fix only the reference host (give it a trigger). Rejected: every host that installs OM silently loses its configured trigger; the bug is the combination rule.
      - OM unregisters its handler while off. Rejected: registration is per agent and the toggle is per session.
      - OM re-implements the kernel fallback while off. Rejected: OM cannot see the host's `CompactionOptions`, and two copies of the trigger rule would drift.
    - Chosen Approach:
      - Tri-state decide (`true` / `false` / abstain), fallback on unanimous abstention. This is the same shape as `tool.call`'s allow/deny/abstain.
    - API Notes and Examples:
      ```ts
      prism.hooks.on("compaction.when", (payload, ctx) => (enabledFor(ctx.session) ? { compact: over(payload) } : undefined));
      ```
    - Files to Create/Edit:
      - `src/hooks/{catalog.ts,bus.ts,types.ts}`, `src/agent-session/session.ts`
      - `src/__tests__/` (hooks combination, auto-compaction tests; a new `compaction-when-abstain.test.ts`)
      - `packages/memory/observational/src/index.ts` and tests
      - `packages/memory/compaction/src/index.ts`, `src/config.ts` (doc comment at `:29-37`), tests
      - `packages/context/engineering/src/index.ts` and tests
      - `docs/hooks.md` (table row and the "decide" section), the three package READMEs
      - `scripts/compat-baseline/arnilo__prism.txt` only if `HookDecision<"compaction.when">` changes shape (the note records the diff)
      - `CHANGELOG.md`
    - References:
      - Task 1 (a); the 2026-10-17 repro
  - Test Cases to Write:
    - `om_off_does_not_suppress_host_compaction`: OM installed with the toggle off, `thresholdEntries: 4`, 8 turns → compactions > 0 (breaks under the old rule).
    - `all_abstain_falls_back_to_threshold_entries`.
    - `explicit_false_blocks_fallback`.
    - `any_true_wins_over_false`.
    - `compaction_when_throw_fails_closed` (kept).
    - `attention_below_ratio_abstains_and_host_trigger_fires`.
    - `memory_compaction_trigger_below_threshold_says_false`.
    - Run the test from the default loop and a custom loop (§3 probe 2).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. A hook combination rule.
    - Docs pages to create/edit: `docs/hooks.md` (catalog row and the decide combination text); READMEs of `memory-observational`, `memory-compaction`, `context-engineering` (their handler's answer when not compacting); `CHANGELOG.md` (Fixed: installing OM disabled auto-compaction).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: Context-overflow recovery
  - Acceptance Criteria:
    - Functional:
      - `ProviderFailureClass` gains `"context_overflow"`. `classifyProviderFailure` returns it for status 400 or 413 whose body matches a supported route's overflow pattern (Task 1 (b): e.g. `context_length_exceeded`, `maximum context length`, `prompt is too long`, the SystemOne equivalent), before the generic `permanent` rule.
      - If Task 1 found no distinguishable body for a route, that route classifies a 400 as overflow when the request's estimated input exceeds the model's declared window, and the README says so.
      - When a model call fails with `context_overflow` and the call result says no output started (Task 1 (c)), the session:
        1. compacts the branch through the `compaction` slot with `trigger: "overflow"`, ignoring `compaction.when` (the provider has already decided)
        2. rebuilds the request
        3. retries the model call once, inside the same turn
      - The retry does not charge `maxTurns` again and records usage only for the call that ran.
      - A second overflow on the retry, or an overflow after output started, fails the run with `ContextOverflowError` (`code: "context_overflow"`, exported from `@arnilo/prism`), with the estimated and declared token counts in the message.
      - `compaction.completed` and the stored compaction entry carry `trigger: "overflow"`; `compactBranchResilient`'s trigger union gains it.
      - A failing compaction during recovery falls through to `ContextOverflowError` (no third attempt).
      - Sweep: repo-wide grep for the `"manual" | "auto"` trigger union literal finds only the updated type.
    - Performance:
      - No cost unless a provider rejects: then one compaction (the slot owner's cost) plus one retried model call.
      - `docs/loop.md` states it.
    - Code Quality:
      - The classification lives in `provider-kit` (wire evidence); recovery lives in the session's model-call path, next to the existing auto-compaction calls (`assemble.ts:414-418`).
      - The kernel names no package.
      - No retry loop beyond one.
    - Security:
      - Error bodies are redacted and bounded before they reach `ErrorInfo` (existing rule); the overflow message carries counts, not prompt text.
      - Abort during recovery propagates and appends nothing (like `memory-compaction`'s abort rule).
  - Approach:
    - Documentation Reviewed:
      - `src/provider-kit/transport.ts:22-70`, `src/agent-session/session/assemble.ts:400-520`, `src/agent-session/session.ts:989-1080`; Task 1 (b)–(c)
      - pi and Claude Code compaction-on-overflow behavior (reference harnesses; record what each does, with dates)
    - Options Considered:
      - Rely on proactive triggers only. Rejected: estimates drift (tool schemas, images, provider tokenizers), and a rejected request today fails a long run outright.
      - Retry with a smaller tail instead of compacting (drop tool results). Rejected: it silently loses state; compaction keeps a summary and is the existing contract.
      - Unlimited retries. Rejected: a prompt that cannot fit after compaction (huge system prompt) would loop.
    - Chosen Approach:
      - Classify at the wire, recover once in the session, fail closed with a named error.
    - API Notes and Examples:
      ```ts
      import { ContextOverflowError } from "@arnilo/prism";
      // run.failed { error: { code: "context_overflow", message: "input ~212,400 tokens exceeds window 200,000 after compaction" } }
      ```
    - Files to Create/Edit:
      - `src/provider-kit/transport.ts` (class + patterns as data), `src/provider-kit/index.ts`
      - `src/agent-session/session.ts`, `src/agent-session/session/assemble.ts`, `src/agent-session/session/types.ts`
      - `src/errors` or the module that owns run errors (Task 1 (c) names it), `src/index.ts`
      - tests: `src/__tests__/context-overflow-recovery.test.ts` (new; mock provider that rejects once), provider-kit classification tests with Task 1 (b)'s recorded bodies
      - `src/__tests__/public-export-contract.test.ts` (deliberate root-export addition)
      - `scripts/compat-baseline/arnilo__prism.txt` via `bun scripts/release.mjs gate --update-baseline`; the note records the diff (one class, one union member)
      - `docs/loop.md` (overflow recovery), `docs/events.md` (compaction `trigger` values), `docs/provider-kit.md` or the page that lists failure classes
      - `CHANGELOG.md`
    - References:
      - Task 1 (b)–(c); plan 182 recordings
  - Test Cases to Write:
    - `overflow_classified_per_supported_route`: one recorded body per route → `context_overflow` (breaks if a route regresses to `permanent`).
    - `overflow_triggers_one_compaction_and_retry`.
    - `overflow_retry_does_not_double_charge_turns_or_usage`.
    - `second_overflow_fails_with_context_overflow_error`.
    - `overflow_after_stream_started_fails_without_retry`.
    - `overflow_compaction_failure_fails_closed`.
    - `overflow_compaction_entry_has_trigger_overflow`.
    - `abort_during_overflow_recovery_appends_nothing`.
    - Run from the default loop and a custom loop.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. A new error, failure class, and trigger value.
    - Docs pages to create/edit: `docs/loop.md`, `docs/events.md`, the provider-kit failure-class page; `CHANGELOG.md` (Added).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Cache-aware tool-result clearing (fold batch mode)
  - Acceptance Criteria:
    - Functional:
      - `fold.clearAtLeastTokens` (integer ≥ 0, default `0` = today's per-turn behavior) and `fold.keepLast` (default `3`, the newest tool results never folded) in `@arnilo/prism-context-engineering`.
      - With `clearAtLeastTokens > 0`:
        - the package keeps a persisted **fold frontier** (session package state, like the attention frontier)
        - on each `context.build`, results that are foldable (`minAgeTurns`, `minBytes`, not in the newest `keepLast`, not in `attention.excludeTools`) and newer than the frontier are summed
        - only when that sum reaches `clearAtLeastTokens` does the frontier advance, and every one of them folds in that request
        - otherwise the provider view is byte-identical to the previous request up to the new tail
      - Folded results keep their `toolCallId` and `metadata` (Task 1 (d); plan 190 Task 7 anchors on them), and the stub names the tool, the call id, and the original size: `[folded: read packages/api/src/routes.ts, 18,240 bytes — re-run the tool to see it again]`.
      - A frontier that fails validation on restore restores nothing (existing fail-closed rule).
    - Performance:
      - With batch mode, request prefixes change at most once per `clearAtLeastTokens` of cleared output, plus at compactions.
      - The README gives the trade-off: one cache miss per batch vs carrying stale output, and a sizing rule (`clearAtLeastTokens` ≈ 10% of the input cap, so a batch clears enough to pay for the cache miss).
      - `prefixStabilityConformance` (plan 184 Task 2, if landed; else the local request-diff helper) proves byte-identical prefixes between advances.
    - Code Quality:
      - One frontier type shared with attention if Task 1 (d) shows they can share; otherwise a separate key with the same validation.
      - No speculative per-tool policies beyond `excludeTools`.
    - Security: Folding stays provider-view only; the store keeps the full result (existing invariant test).
  - Approach:
    - Documentation Reviewed:
      - `packages/context/engineering/src/{fold.ts,handler.ts,state.ts,attention.ts}`; Task 1 (d)
      - Lindenbauer et al., NeurIPS 2025 (arXiv 2508.21433): observation masking of old tool outputs ≈ LLM summarization at about 50% lower cost on SWE-bench Verified
      - Anthropic context editing (`clear_tool_uses` with `clear_at_least`, 2025 docs): clear in batches large enough to justify the cache miss
      - Manus, "Context Engineering for AI Agents" (2025): keep the prefix stable and append-only, and make re-fetchable data restorable
    - Options Considered:
      - Fold every turn (today's `fold` with `minAgeTurns`). Rejected as the reference-host default: each turn rewrites one older position, so every request misses the cache from that point (Task 1 (d) measures it).
      - Fold only at compaction. Rejected: compaction triggers late by design, so stale output sits in context for most of the window.
      - Model summaries of folded results. Rejected as the default: the masking study shows no gain over truncation at higher cost; `summarize: { model }` stays opt-in.
    - Chosen Approach:
      - Batched masking with a persisted frontier.
    - API Notes and Examples:
      ```ts
      contextEngineering({ fold: { minAgeTurns: 2, minBytes: 2048, keepLast: 3, clearAtLeastTokens: 12_000 } });
      ```
    - Files to Create/Edit:
      - `packages/context/engineering/src/{fold.ts,config.ts,handler.ts,state.ts,index.ts}`
      - tests (fold, handler, state restore)
      - `packages/context/engineering/README.md` (Config rows, "Fold batch mode", cost trade-off)
      - `scripts/compat-baseline/arnilo__prism-context-engineering.txt` (config type) via `--update-baseline`; the note records the diff
      - `CHANGELOG.md`
    - References:
      - Task 1 (d); plan 184 Task 2; plan 190 Task 7
  - Test Cases to Write:
    - `fold_batch_holds_until_clear_at_least_reached`: three turns below the threshold → identical prefixes (breaks if folding happens per turn).
    - `fold_batch_folds_all_pending_together`.
    - `fold_keeps_last_n_results`.
    - `fold_frontier_restored_after_reopen`.
    - `fold_stub_names_tool_call_and_size`.
    - `folded_result_keeps_tool_call_id_and_metadata`.
    - `fold_zero_threshold_matches_previous_behavior`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. New config.
    - Docs pages to create/edit: `packages/context/engineering/README.md`; `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: Context accounting and a block-share cap
  - Acceptance Criteria:
    - Functional:
      - With `accounting: true` (default `false`) or any stage configured, `context-engineering` registers a `model.request` handler that emits package event `context.accounted` once per request:
        ```ts
        { turn, inputCapTokens, totalTokens, bySource: { system, instructions, skills, history, toolResults, folded, input, blocks: { [source]: tokens }, tail: { [source]: tokens } } }
        ```
        - Blocks are keyed by `metadata.source` (fallback: `title`).
        - Tail blocks come from `metadata.contextBlocks` (plan 188 Task 9).
        - Counts use the kernel's estimator (Task 1 (f)).
      - `blocks: { maxShare: number }` (0 < maxShare ≤ 1) caps the total tokens of injected context blocks (prefix and tail) at `maxShare × inputCap`.
        - Whole blocks are dropped by lowest `priority`, then latest-added; the mandatory system prompt and instruction layers are never counted or dropped.
        - Each drop is reported in the event (`dropped: [{ source, tokens }]`).
        - Mutually exclusive with `budget` (both evict blocks), like `attention`/`budget` today; configuring both fails the load naming both.
      - `scripts/memory-bench` (plan 188) and `scripts/context-rot` (Task 6) read `context.accounted` instead of re-estimating.
    - Performance:
      - One estimate pass per request over the final provider request, O(messages).
      - No store write; the event is not persisted.
      - `accounting: false` with no stage configured registers nothing (the package's "no config, no handler" rule holds).
    - Code Quality:
      - Accounting lives in `packages/context/engineering/src/accounting.ts`.
      - Source keys are the `metadata.source` strings memory packages already set (plan 188 Tasks 4, 9, 11, 12; `context-files` nested parts from plan 190 Task 7 count under `instructions`).
      - No kernel change.
    - Security: The event carries counts and source names only, never text.
  - Approach:
    - Documentation Reviewed:
      - `packages/context/engineering/src/{budget.ts,handler.ts,index.ts}`; `src/loop/run-controller.ts:133-160`; Task 1 (f); plan 188 Tasks 2, 9
    - Options Considered:
      - Per-package caps only (today). Rejected: OM, fabric, RAG, and wiki each cap themselves, and their sum is unbounded relative to the model.
      - A kernel accounting event. Rejected: `model.request` already sees the final request; a package expresses it (roadmap: no kernel addition when a seam exists).
      - Relevance-ranked eviction across sources. Rejected for now: needs comparable scores across packages; priority-ordered whole-block drops are deterministic. Further Actions if Task 6 or plan 188's injection log shows priority is the wrong order.
    - Chosen Approach:
      - Measure every request; cap the injected share; leave relevance to each source (plan 188 Task 11's floor and dedup).
    - API Notes and Examples:
      ```ts
      contextEngineering({ accounting: true, blocks: { maxShare: 0.15 }, fold: { clearAtLeastTokens: 12_000 } });
      ```
    - Files to Create/Edit:
      - `packages/context/engineering/src/{accounting.ts (new),config.ts,index.ts,handler.ts}`
      - tests (`accounting.test.ts` new; config exclusivity)
      - README (Accounting, block-share cap, event shape, cost)
      - baseline `arnilo__prism-context-engineering.txt`; the note records the diff
      - `CHANGELOG.md`
    - References:
      - plan 188 Tasks 2, 9, 11, 12; plan 190 Task 7
  - Test Cases to Write:
    - `accounting_event_sums_to_request_estimate`.
    - `accounting_keys_blocks_by_source_including_tail_metadata`.
    - `block_share_cap_drops_lowest_priority_whole_block_and_reports`.
    - `block_share_never_drops_system_or_instructions`.
    - `blocks_and_budget_are_mutually_exclusive`.
    - `no_config_registers_no_accounting_handler`.
    - `accounting_event_contains_no_text`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. New config and package event.
    - Docs pages to create/edit: `packages/context/engineering/README.md`; `CHANGELOG.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 6: The rot curve — measure each release model's effective input budget
  - Acceptance Criteria:
    - Functional:
      - `bun scripts/context-rot/run.mjs --provider <id> --model <id> [--lengths 0,16000,32000,64000,96000] [--repeats 3]`. Defaults clamp lengths to the model's declared window minus output and reserve. It runs a fixed set of 30 deterministic, self-graded tasks written for this plan (`scripts/context-rot/tasks.json`, no third-party content):
        - 10 coding-edit tasks with a checkable diff on a tiny fixture repo
        - 10 needle-with-reasoning lookups whose answer depends on one fact stated at the start of the session (NoLiMa-style: no lexical overlap between question and fact)
        - 10 multi-step tool tasks with a checkable final state
      - Each task runs after N tokens of unrelated but realistic tool history (file reads and grep output from a pinned public repo snapshot, cached and checksummed like the memory-bench datasets).
      - The history is placed before the task as completed tool turns. That is the reference host's real failure shape: stale tool output, not filler prose.
      - The report gives, per model:
        - accuracy per length with a Wilson 95% interval
        - input tokens and cache-read ratio (wire proxy)
        - the **effective input budget**: the largest length whose accuracy is within 5 points of the 0-length baseline with overlapping intervals; the smallest length tested when none qualify
      - It also runs each length with `context-engineering` fold batch mode on (Task 4), so the evidence shows whether clearing recovers the loss.
      - Results go to `docs/_evidence/context-rot/<provider>-<model>-<date>.{json,md}` and the summary table to `docs/_evidence/context-rot-0.13.0.md`, for one model each on Hyper and OpenCode Go (the plan 183 matrix).
      - `--offline` runs 3 tasks at lengths 0 and 4000 on the mock provider (CI smoke).
      - A `release/context-rot` row in `.github/workflows/live-matrix.yml`, manual dispatch only.
    - Performance:
      - Ceiling: 30 tasks × 5 lengths × 3 repeats × 2 configs × about 50k average input ≈ 45M input tokens per model.
      - `--max-input-tokens` (default 50M per model) aborts with a partial report.
      - Prompt caching of the shared history prefix is used deliberately: the same history per length across tasks, so most tokens are cache reads (the report states the billed estimate).
      - The offline smoke finishes under 30 s.
    - Code Quality:
      - Scripts only; no package depends on them.
      - Tasks and lengths are data.
      - The judge is deterministic: checkable diffs, exact facts, final-state assertions. No model judge.
    - Security:
      - Keys from `~/.config/prism/live.env` through the live loader; never printed.
      - The pinned repo snapshot is read-only data, extracted to its own directory and never executed.
      - Evidence holds ids, lengths, and scores only.
  - Approach:
    - Documentation Reviewed:
      - Chroma "Context Rot" (Hong, Troynikov, Huber, 2025; toolkit at github.com/chroma-core/context-rot)
      - Du et al., 2025 (arXiv 2510.05381)
      - NoLiMa (Modarressi et al., ICML 2025): non-lexical needles degrade by 32k
      - RULER (Hsieh et al., COLM 2024): effective vs claimed context length
      - Lindenbauer et al., 2025
      - plan 184's runner layout (`scripts/cache-parity/`)
    - Options Considered:
      - Use the vendors' advertised windows. Rejected: the literature above shows the effective length is far below them, and it differs by model.
      - Use RULER or NoLiMa directly. Rejected: filler-prose haystacks are not the agent's failure shape (stale tool output), and their licenses and sizes add a dataset dependency; the needle tasks borrow NoLiMa's non-lexical design.
      - A model judge. Rejected: deterministic checks remove judge noise from a curve whose differences are a few points.
    - Chosen Approach:
      - A small agent-shaped rot curve per release model, with and without clearing, that yields one number Task 7 consumes.
    - API Notes and Examples:
      ```bash
      timeout 10800 bun scripts/context-rot/run.mjs --provider hyper --model <id>
      timeout 60 bun scripts/context-rot/run.mjs --offline
      ```
    - Files to Create/Edit:
      - `scripts/context-rot/{run.mjs,history.mjs,tasks.json,grade.mjs,report.mjs,README.md}`: new
      - `scripts/context-rot/fixtures/` (tiny repo for coding tasks): new
      - `scripts/context-rot/run.test.mjs`: new (offline smoke, checksum refusal, ceiling abort)
      - `.github/workflows/live-matrix.yml`: `release/context-rot` row, manual only
      - `docs/live-testing.md` (row and cost)
      - `docs/_evidence/context-rot-0.13.0.md`
      - `CHANGELOG.md`
    - References:
      - plan 184 (runner, wire proxy); plan 188 Task 2 (dataset cache and checksum helpers, reused)
  - Test Cases to Write:
    - `context_rot_offline_smoke_reports_every_length`.
    - `context_rot_refuses_history_checksum_mismatch`.
    - `context_rot_aborts_at_token_ceiling`.
    - `effective_budget_rule_on_fixture_curve`: a fixture curve gives the known budget, including the "none qualify" case.
    - `context_rot_grader_is_deterministic`: same outputs, same scores.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no package API. A new opt-in live row.
    - Docs pages to create/edit: `scripts/context-rot/README.md`, `docs/live-testing.md`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 7: Reference host and OM — triggers from the evidence, clearing on, and a bounded long session
  - Acceptance Criteria:
    - Functional:
      - **OM's gate becomes relative.** `context.compactAfterTokens` (absolute, default 81,000) is replaced by `context.compactAt: { ratio?: number; maxTokens?: number }`:
        - default `ratio: 0.6` of the model's input cap (`resolveInputCap`)
        - `maxTokens` caps it when set
        - a model with no declared window uses `maxTokens`, and fails config validation without it
        - plan 188 Task 5's own-compaction coupling is unchanged
        - Sweep: repo-wide grep for `compactAfterTokens` finds nothing outside `CHANGELOG.md`.
      - **Coding worker** (`apps/prism-agent/src/host/coding.ts`):
        - `compaction({ profile: "coding", trigger })`, where `trigger` compacts at the smaller of `input_ratio` 0.6 and the model's **effective input budget** from Task 6 (any-of per Task 1 (e), else the smaller value computed at setup)
        - OM `context.compactAt.maxTokens` set to the same budget
        - `contextEngineering({ fold: { minAgeTurns: 2, minBytes: 2048, keepLast: 3, clearAtLeastTokens: <≈10% of budget> }, accounting: true })`
      - **Research worker:** the same trigger and fold (default profile), and `blocks: { maxShare: 0.2 }` because it installs `memoryRag`.
      - The budgets live in one host table, `apps/prism-agent/src/host/context-budgets.ts`, keyed by `provider/model`, each with a comment naming its evidence file. An unlisted model uses `input_ratio` 0.6 only and notes `info` once.
      - **Bounded long session.** The new scenario `apps/prism-agent/src/scenarios/long-session.ts` runs on the mock provider: 60 turns, each with one 6 KB tool result. It asserts that:
        - auto-compaction ran at least once
        - fold advanced in batches (prefix identical between advances)
        - every request's `context.accounted.totalTokens` stays below the configured trigger plus one turn
        - a scripted overflow rejection at turn 40 recovers (Task 3)
    - Performance:
      - The scenario runs under 30 s.
      - The host README states the per-model budgets, the batch size, and the cost (one cache miss per fold batch and per compaction).
    - Code Quality:
      - The host imports only public package APIs (`reference_host_imports_only_public_surface`).
      - Budgets are data.
      - No host-side reimplementation of triggers.
    - Security: No key in the scenario; mock provider only.
  - Approach:
    - Documentation Reviewed:
      - `apps/prism-agent/src/host/{coding.ts,research.ts,config.ts}`, `src/scenarios/`; Task 1 (g); Task 6 evidence
      - `packages/memory/observational/src/{config.ts,index.ts:116-135}`
      - `packages/memory/compaction/README.md` (profiles)
    - Options Considered:
      - Keep the absolute 81k OM gate. Rejected: it is 40% of a 200k window and more than the whole window of smaller models; rot sets in earlier (Task 6).
      - Set budgets from the papers. Rejected: the curve differs per model, and the release models are not the papers' models.
      - Install attention instead of fold. Rejected for the default: attention fails the run closed when its gate keeps firing (`AttentionBudgetError`); fold plus a trigger and overflow recovery degrades gracefully.
    - Chosen Approach:
      - Measured budgets in one host table, relative OM gate, batch clearing, and a scenario that proves the session stays bounded.
    - API Notes and Examples:
      ```ts
      compaction({ profile: "coding", trigger: { kind: "threshold_tokens", tokens: budgetFor(config.models.coding) } })
      ```
    - Files to Create/Edit:
      - `packages/memory/observational/src/{config.ts,index.ts}`, tests, README
      - `apps/prism-agent/src/host/{coding.ts,research.ts,context-budgets.ts (new)}`
      - `apps/prism-agent/src/scenarios/long-session.ts` (new), its registration and test
      - golden fixtures the fold or trigger changes rewrite (Task 1 (g); the note lists them)
      - `apps/prism-agent/package.json` (add `@arnilo/prism-context-engineering`)
      - `apps/prism-agent/README.md` (context management section)
      - `examples/observational-memory.ts` (if it sets `compactAfterTokens`)
      - `scripts/compat-baseline/arnilo__prism-memory-observational.txt` via `--update-baseline`; the note records the diff
      - `CHANGELOG.md`
    - References:
      - Tasks 2–6; plan 188 Task 5; plan 184 (measures this host next)
  - Test Cases to Write:
    - `om_compact_at_ratio_of_input_cap`, `om_compact_at_requires_max_tokens_without_window`.
    - `coding_worker_compacts_with_coding_profile_and_trigger`.
    - `research_worker_caps_block_share`.
    - `unlisted_model_uses_ratio_and_notes_once`.
    - `long_session_stays_bounded` (the scenario).
    - `long_session_recovers_from_overflow`.
    - `bun run --filter @arnilo/prism-agent test` stays green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes. OM config key replaced; reference host behavior.
    - Docs pages to create/edit: `packages/memory/observational/README.md` (config row, cost table), `apps/prism-agent/README.md` (context management); `CHANGELOG.md` (Changed, Removed `compactAfterTokens`).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `timeout 600 bun run build:core`
- `timeout 1200 bun run typecheck`
- `timeout 900 bun test --timeout=0 src/__tests__/compaction-when-abstain.test.ts src/__tests__/context-overflow-recovery.test.ts src/__tests__/public-export-contract.test.ts`
- `timeout 900 bun run --cwd packages/context/engineering test`
- `timeout 900 bun run --cwd packages/memory/observational test`
- `timeout 900 bun run --cwd packages/memory/compaction test`
- `timeout 900 bun run --filter @arnilo/prism-agent test`
- `timeout 120 bun scripts/context-rot/run.mjs --offline`
- `timeout 300 bun test --timeout=0 scripts/context-rot/run.test.mjs`
- `timeout 900 bun examples/observational-memory.ts`
- `timeout 600 bun test --timeout=0 src/__tests__/docs.test.ts`
- `timeout 1800 bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
