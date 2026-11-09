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

**0.13.0 release path — plan 194, step 10 of 21.** Owner decision 2026-10-17: every finding of the context-rot and progressive-disclosure review ships in 0.13.0. The memory-side findings went into plans 188, 190, 191, and 192 as amendments; this plan holds the rest.

Ordering:
- Start this plan when plan 193 is complete; when it is complete, continue with plan 195 (step 11, roadmap Phase 18 Part A), then plan 196, then the eval plans 197–201, then plan 184.
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

- [x] Task 1: Phase review (read-only)
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

  Notes (executed 2026-10-24):

  **Entry.** Plan 193 has all nine tasks checked. Plan 188 Task 5 (OM compaction coupling), 189 Task 2 (tool results as text) and 190 Task 9 (`withTailContext` + `metadata.contextBlocks`, `packages/memory/core/src/tail-context.ts:6-40`) are landed. The 2026-10-17 repro reproduces on `main` (see (a)).

  **(a) `compaction.when` today — the suppression is the combination rule, not the host config.**
  - The rule is data: `HOOK_COMBINATION` maps `"compaction.when"` to `"any-compact"` (`src/hooks/catalog.ts:57-62`, entry at `:61`). `combine` returns only a value with `compact === true` (`src/hooks/bus.ts:53-66`); every other value (including `undefined`) is dropped before combining (`:283-295`), and `decide` returns `undefined` when no handler is registered (`:279-281`). `has()` is a registration count (`:346`), so OM installing a handler makes `hasWhen` true even with its toggle off.
  - The session makes a registered handler the whole decision: `resolveAutoCompact` (`src/agent-session/session.ts:1008-1052`) computes `hasWhen` (`:1016`), returns early when neither a trigger nor a handler exists (`:1017`), and in the handler branch it returns `undefined` unless a handler said `{ compact: true }` (`:1023-1034`, comment `:1024-1025`). The configured `thresholdEntries` fallback is only reached when no handler is registered (`:1036-1051`), and its gate is strict (`entryCount > thresholdEntries`, `src/contracts-core/compaction.ts:149`).
  - Handlers that decline today all return `undefined` (nothing returns `{ compact: false }` in `src/ packages/ apps/`):
    - OM (`packages/memory/observational/src/index.ts:118-137`): `undefined` while the per-session toggle is off (`:120`); while on and below its own gate, `undefined` again (`:124-135`) — its own-compaction coverage path can request compaction (`:121-128`), else the absolute `context.compactAfterTokens` gate (`:129`, default `81_000` at `packages/memory/observational/src/config.ts:27,311`).
    - `memory-compaction` (`packages/memory/compaction/src/index.ts:55-74`): registers nothing without `trigger`, and below the trigger returns `undefined` (`:58-73`); its comment states the handler is "the whole decision" (`:55-56`).
    - `context-engineering` attention (`packages/context/engineering/src/index.ts:140-153`): `undefined` below `compactRatio` (`:150`), intended as an extra reason to compact.
  - Host: `apps/prism-agent/src/host/coding.ts:32-52` (and `research.ts:21-40`) install OM and `memory-compaction` with no `compaction` config and no trigger, so neither the fallback nor a handler ever fires.
  - **Repro reproduced** with a throwaway test in `src/__tests__/` (deleted, no code change): mock provider, 8 turns, `compaction: { thresholdEntries: 4 }`. OM installed with the toggle off → **0** `compaction.completed`; same agent without OM → **6**. This is exactly the fixture form Task 2 needs for `om_off_does_not_suppress_host_compaction`.
  - Task 2 also rewrites two existing assertions of today's rule: `__tests__/compaction-trigger.test.ts:397-411` (`compaction_when_replaces_the_config_trigger`, asserting an abstaining handler suppresses `thresholdEntries: 0`) and the frozen rule `src/__tests__/hook-catalog-freeze.test.ts:70`; `docs/hooks.md:94` carries the same wording.

  **(b) Overflow evidence per route.** Hyper and OpenCode Go each expose both wire routes (`packages/providers/hyper/src/provider.ts:23-41`; `packages/providers/opencode-go/src/provider.ts:23-41` — `x-api-key` + `anthropic-version: 2023-06-01` + `x-opencode-session`); Jev/`typesafe` and Laya speak SystemOne (`packages/providers/typesafe/src/provider.ts`, `packages/providers/laya/src/provider.ts`).
  - Plan 182 left no overflow recordings: `replayFetch` fixtures cover stream conformance only, and no recorded exchange directory is on disk.
  - Two deliberately oversized live requests were made on 2026-10-24 with the key from the live loader (`~/.config/prism/live.env` holds only `OPENCODE_GO_API_KEY`), model `minimax-m2.5` (declared `204800`), request 2,025,118 bytes ≈ **506,250 text tokens** + 16 output tokens. Bodies trimmed to the error object:
    - OpenCode Go Anthropic `/messages` → **400** `{"type":"error","error":{"type":"invalid_request_error","message":"Upstream request failed: [invalid_request_error] invalid params, context window exceeds limit (2013)"}}`
    - OpenCode Go OpenAI `/chat/completions` → **400** `{"error":{"type":"server_error","message":"Upstream request failed: [400] This endpoint's maximum context length is 204800 tokens. However, you requested about 506266 tokens (506250 of text input, 16 in the output). …"}}`
  - Unmeasured routes: Hyper (no `HYPER_API_KEY`), Jev/`typesafe` (no `TYPESAFE_API_KEY`), Laya (no `laya-serve` listening on `localhost:8000`). So two of the six route pairs are recorded, and the plan's planned case is half-true: the OpenAI-compatible and Anthropic bodies **are** distinguishable (`maximum context length`, `context window exceeds limit`), SystemOne and Hyper are not observed.
  - Classification seam: `classifyProviderFailure` is status-only today (`src/provider-kit/transport.ts:35-44`): 401/403 → `auth`, 429 → `quota`/`rate_limited`, ≥500 → `transient`, any other 4xx → `permanent`; it never reads the body's error code. `httpStatusError` attaches `failureClass` as an enumerable own property (`:60-70`), and `retry-http.ts:60-70` does the same for the SystemOne and Hyper-style errors. `ErrorInfo.failureClass` is `src/contracts-core/content.ts:13,20`; `errorToErrorInfo` reads it (`src/redaction.ts:168-169`) through a **whitelist that must gain `"context_overflow"`** (`:204-215`). It then flows through `ProviderTurnFailure` (`src/agent-session/helpers.ts:80-85`) to the session's model-call `catch` (`src/agent-session/session/assemble.ts:503-507`, which only handles the steer interrupt) and out through `generateWithRetry`'s classification (`src/agent-session/session/provider-round.ts:206-231`).
  - SystemOne risk: it builds errors from status (422 → `SystemOneInvalidRequestError`, `src/provider-kit/systemone.ts:318-330`), so an over-long typed-decision prompt may be 422, not 400/413. Task 3 should include 422 for SystemOne (or the estimated-input fallback) or the class never fires there.
  - Bodies are already bounded (`readBoundedResponseText`, 65,536 bytes, `transport.ts:7`) and the error message carries the body text, so a body-pattern matcher sees it without new plumbing.

  **(c) Retry seam — workable, but not inside `retryLoop` as-is.**
  - `generateWithRetry` calls `retryLoop` with a closure that resends the **same** `request` on every attempt (`provider-round.ts:206`), so a retry cannot carry rebuilt, compacted bytes. `retryLoop` stops when the policy declines (`src/models/retry.ts:117-143`), and a 400 is not transient (`isTransientErrorInfo`, `:64-69`), so today an overflow is final with no attempt at recovery.
  - Where recovery must go: around `retryLoop` in `generateWithRetry` (or in the session's generate seam, `assemble.ts:489-508`), with a callback that compacts (`session.ts:1059-1069`, ignoring `compaction.when`) and re-assembles. Re-assembly today is the loop's `assemble` closure (`assemble.ts:410-465`), which charges `limits.charge("maxTurns")` at `:416`; a retry that re-assembles must not charge it again. A recovery callback also has to re-run `context.build`/`model.request`, which live after assembly in `run-controller.ts:201-217`.
  - `started` is known only inside `generateProviderTurn` (`provider-round.ts:262,303,309,351`): it is packed as `ProviderTurnFailure.observable` (`:295,390`, class `helpers.ts:80-85`) and the retry loop rethrows through `errorFromInfo` (`retry.ts:135,142`), which **drops `observable`**. So a catch outside the retry loop cannot tell "overflow before output" from "overflow after deltas" unless the seam moves or the bit is preserved (e.g. on `ErrorInfo`).
  - Usage is already recorded per attempt: the failure path calls `recordTurnUsage()` (`provider-round.ts:373`), and with `usageEstimation: "fallback"` that writes an **estimate** for the failed call. Task 3's "usage only for the call that ran" therefore changes existing behavior, not just new code.
  - Trigger persistence is split: the union is `"manual" | "auto"` at `session.ts:1063,1076`, also in `CompactionContext.trigger`/`CompactionEntryData.trigger` (`src/contracts-core/compaction.ts:16,185`). The kernel's default compactor stamps `trigger` into the entry (`src/compaction.ts:36`), but `memory-compaction`'s LLM compactor does **not**: it writes `{ ...prep.data, strategy }` (`packages/memory/compaction/src/strategy.ts:85-92`). Since the reference host's `compaction` slot is owned by `memory-compaction`, the stored entry would lose `trigger: "overflow"` unless that package is edited too. `compaction.completed` carries no `trigger` field at all (`src/contracts-protocol.ts:344-354`), so Task 3 adds it to the event, docs and the entry.

  **(d) Fold mechanics.**
  - Foldability: `foldToolResultHistory` walks history (`packages/context/engineering/src/fold.ts:63-80`); `maybeFold` requires `turn - toolResultTurn >= minAgeTurns` and `>= minBytes` (`:110-140`). Defaults `2` turns and `4,096` bytes (`:5-6`). Turns come from `inferToolResultTurns` (`:180-199`), using `metadata.prismToolResultTurn` when stamped.
  - Not sticky: the handler re-folds `draft.messages` on every request (`packages/context/engineering/src/handler.ts:66-80`). Summaries are cached per tool call in the session log (`cachedSummarize`, `:220-236`), so a row already folded renders identically — but each newly aged row rewrites an older position. There is no fold frontier, and `fold` has no `keepLast`/`excludeTools` (those exist only under `attention`, `packages/context/engineering/src/config.ts:39-50`).
  - **Measured** with the repo's prefix-stability helper (`src/testing/prefix-stability-conformance.ts`, 4 captured requests, 8,192-byte fixture tool result; throwaway test, deleted): no fold → `minContinuity 1`, 0 resets; `fold: { summarize: "truncate" }` (default `minAgeTurns: 2`) → request 3 → 4 kept **37.8%** of the previous provider prefix, `resets [4]`. So today's fold already costs one prefix break at the first fold in a two-turn run, and would break once per turn thereafter — the Task 4 baseline.
  - Folded rows keep `toolCallId` and `name`, and the message keeps its `metadata` with `prismFolded: true` added (`fold.ts:96-110`). The stub is `Tool result <name> [<id>]: <summary>` (`foldedToolResultHeader`, `:157-159`) and carries **no original size**, so Task 4's new stub text changes bytes.

  **(e) Trigger kinds.** `CompactionTrigger` is `threshold_entries | threshold_tokens | input_ratio | each_turn | custom` (`src/contracts-core/compaction.ts:50-58`), validated at `:61-95`. There is **no any-of combinator**; `custom` is the only composition seam (`:56-58`, evaluated `:170-178`). `resolveShouldCompact` (`:141-179`) applies `thresholdEntries` as strict `>` (`:149`). `resolveInputCap` (`src/models/estimate.ts:92-120`) needs `limits.contextWindow` (minus `maxOutputTokens` and 1,024 reserve) and throws otherwise; a custom trigger's throw is swallowed to `false` with `onError` (`compaction.ts:176-178`). All four providers declare `contextWindow`: Hyper curated/live (`packages/providers/hyper/src/models.ts:171-173,210-430`), OpenCode Go curated/heuristic (`packages/providers/opencode-go/src/models.ts:239-410`), Jev `32_000` (`packages/providers/typesafe/src/models.ts:21`), Laya `512`/`1,024` (`packages/providers/laya/src/models.ts:47-52`). The reference host picks models by config ref (`apps/prism-agent/src/host/config.ts`), so a host-pinned model without limits makes an `input_ratio` trigger fail closed to "no compaction".

  **(f) Accounting inputs are present.**
  - `model.request` handlers see the request after `applyDraft` (`run-controller.ts:201-217`; `applyDraft` `:133-152`, transform `:206`), including the rendered context messages and the final tool list.
  - Context blocks keep `metadata.source`: `withContextMessages` (`:153-160`) renders through `contextMessages` (`src/input.ts:428-432`), which passes `block.metadata` into the system message's `metadata`.
  - Tail blocks carry `metadata.contextBlocks` exactly as plan 188 Task 9 promised (`packages/memory/core/src/tail-context.ts:6-40`): one system message whose metadata lists `{...block.metadata, title, source, itemIds, tokens}`.
  - Estimator: `estimateAssemblyTokens` counts messages only (`src/models/estimate.ts:71-73`); tools and context need `estimateRequestExtrasTokens` (`:78-86`), as `provider-round.ts:158-164` already does. Plain messages added by a `context.build` handler with no metadata (e.g. `withInstruction`, `src/context-build.ts:38-43`) cannot be attributed to a source, so accounting needs an "instructions/other" bucket. No `context.accounted` event exists today (no collision).

  **(g) Reference host.** Neither worker asserts compaction or request bytes: `apps/prism-agent/src/scenarios/` covers approval, workflow, streaming dialect and one-shot golden only. The only golden fixture is `apps/prism-agent/src/__tests__/fixtures/one-shot.golden.jsonl` (7 event lines; pins the tool count/hash, never message bytes), so a fold/trigger change rewrites it only if the tool set changes. Request-byte assertions live in `src/__tests__/prefix-stability-conformance.test.ts`.

  **(h) Callers** (`graft callers <symbol> --depth all`):
  - `resolveAutoCompact` and `compactBranchResilient`: only `autoCompact` (`session.ts:989-995`) and `autoCompactTurn` (`:997-1001`).
  - `classifyProviderFailure`: `httpStatusError` (`transport.ts:65`), `retry-http.ts:10,64-65`, and the provider codecs/error builders (`routed-provider.ts`, `systemone.ts`, hyper) plus their tests.
  - `foldToolResultHistory` / `resolveToolResultFold`: only `createContextEngineeringHandler` (`handler.ts:66,71`) plus the package's fold/attention/package tests.
  - `createContextEngineeringHandler`: `install` (`index.ts:124`) plus package tests.
  - `resolveShouldCompact`: OM setup (`observational/src/index.ts:131`), `memory-compaction` setup (`compaction/src/index.ts:61`), the session fallback (`session.ts:1037`), and their tests.

  **Verdict.**
  - **Task 2: GO.** The bug is exactly the any-compact rule plus the "whole decision" branch; tri-state + fallback on unanimous abstention fits the existing decide bus. Rework `compaction_when_replaces_the_config_trigger`, `hook-catalog-freeze.test.ts:70`, `docs/hooks.md:94`.
  - **Task 3: GO with amendments** (applied below): the two recorded routes are distinguishable; recover at a seam that still knows `started`; stamp `trigger` through `memory-compaction` and add it to `compaction.completed`; include SystemOne's 422; use the status + estimated-input fallback for the unmeasured Hyper/SystemOne routes; note that the failed attempt already records usage.
  - **Task 4: GO with amendments** (applied below): the fold baseline is one prefix break per fold turn (37.8% at the first); `fold.keepLast`/`excludeTools` do not exist yet; the fold frontier cannot share the attention frontier (different semantics), so use its own session-state key with the same fail-closed restore.
  - **Task 5: GO.** Block/priority data and token estimators are all reachable from `model.request`; add the tools/context extras and an unattributed bucket.
  - **Task 6: GO.** No blocker; the measured budget is independent of the code above.
  - **Task 7: GO.** Both workers install `memory-compaction` with no trigger today; the trigger must be resolvable from model limits, and the 60-turn bounded scenario is new (no existing scenario asserts request size).

- [x] Task 2: `compaction.when` handlers can abstain
  - Acceptance Criteria:
    - Functional: The `compaction.when` combination becomes:
      - any handler returning `{ compact: true }` → compact
      - else any handler returning `{ compact: false }` → no compaction
      - else (all handlers returned `undefined`, or none is registered) → the kernel fallback: `CompactionOptions.thresholdEntries` when configured, otherwise no compaction
      - A throw still fails closed.
    - Functional: Package handlers are updated in the same task (Task 1 (a), (h)):
      - **OM** returns `undefined` while the session's toggle is off, and `{ compact: false }` while on and below its gate (OM owns the decision for its sessions).
      - **`memory-compaction`**, when a `trigger` is configured, returns `{ compact: false }` below it, so its gate stays decisive and the kernel fallback cannot override it.
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

  Notes (executed 2026-10-24):

  - **Rule.** `combine`'s `any-compact` is now a tri-state vote (`src/hooks/bus.ts:65-75`): any `{ compact: true }` returns immediately (priority-independent), else any `{ compact: false }` returns `{ compact: false }`, else `undefined`. `CompactionWhenDecision.compact` is `boolean` (`src/hooks/types.ts:168-175`).
  - **Session.** `resolveAutoCompact` consumes the bus result directly (`src/agent-session/session.ts:1024-1037`): a defined decision returns `compaction ?? {}` for `true` or `undefined` for `false`; an abstention falls through to the existing `thresholdEntries` path (`:1037-1051`), which still returns early when no compaction config exists.
  - **Handlers.** OM votes `{ compact: false }` while on and below its gate, in both the `compactAfterTokens` and `trigger` branches, and still abstains while the toggle is off (`packages/memory/observational/src/index.ts:119-143`). `memory-compaction` votes `{ compact: false }` below its configured `trigger` (`packages/memory/compaction/src/index.ts:59-77`). Context-engineering attention stays `undefined` below `compactRatio` (`packages/context/engineering/src/index.ts:142-152`) — an extra reason to compact, never a veto.
  - **Tests.** New `src/__tests__/compaction-when-abstain.test.ts`: the 2026-10-17 repro as `om_off_does_not_suppress_host_compaction` (OM installed and off, `thresholdEntries: 4`, 8 turns → compactions > 0; it was 0 before this task), `all_abstain_falls_back_to_threshold_entries`, `explicit_false_blocks_fallback`, `om_on_below_gate_vetoes_the_host_fallback`, `abstain_falls_back_from_{defaultLoop,customLoop}` (through `loopConformance`), and `any_true_wins_over_false`. `hook-bus.test.ts` gains veto, unanimous-abstention, and true-beats-false cases. `compaction-trigger.test.ts`: the bug-asserting `compaction_when_replaces_the_config_trigger` is replaced by `compaction_when_abstain_falls_back_to_the_config_trigger` and `compaction_when_false_vetoes_the_config_trigger`; the shared `whenTrigger` helper now returns `{ compact: false }` (the correct migration for a handler that owns its gate; same change in `mid-run-compaction.test.ts`). Package tests: `memory-compaction`'s below-gate case now sets the host's `thresholdEntries: 0` and proves the veto; context-engineering gains `context_engineering_below_ratio_abstains_and_host_trigger_fires`.
  - **Verification.** The compaction/hook/session/docs/public-export slice passes (288 tests), the three package suites pass (219 tests), `npm run typecheck` is clean, and biome lint is clean on every changed file.
  - **Docs.** `docs/hooks.md:94` (catalog row), `docs/loop.md:161`, the `thresholdEntries` doc comment (`src/contracts-core/compaction.ts:94`), the three package READMEs, and the root plus three package CHANGELOGs.
  - **Sweep.** `rg 'whole decision|abstaining handler'` over `src/ packages/ apps/ scripts/ examples/ docs/` (excluding `plans/`, `docs/history/`, `docs/_evidence/`, changelogs) leaves only test assertion strings; no stale doc wording.
  - **Compat.** No exported name changed; only `CompactionWhenDecision.compact`'s type widens from `true` to `boolean`, and the compat baseline records export names rather than type bodies, so it is unchanged. Deliberately no flag for the old "`undefined` is the whole decision" rule.
  - **Deviation from the task text.** The repro test lives in the root suite and imports `@arnilo/prism-memory-observational` directly (tests are exempt from the "kernel imports no package" scan); it is not a package test, because the behavior under test is the kernel combination rule.

- [x] Task 3: Context-overflow recovery
  - Acceptance Criteria:
    - Functional:
      - `ProviderFailureClass` gains `"context_overflow"`. `classifyProviderFailure` returns it for status 400 or 413 whose body matches a supported route's overflow pattern (Task 1 (b): the recorded OpenCode Go bodies are `context window exceeds limit` (Anthropic route) and `maximum context length` (OpenAI-compatible route); also cover `context_length_exceeded` and `prompt is too long`), before the generic `permanent` rule. SystemOne answers 422 for an invalid request (`src/provider-kit/systemone.ts:326-328`), so include 422 for that route or rely on the estimated-input fallback there.
      - If Task 1 found no distinguishable body for a route, that route classifies a 400 (SysOne: 422) as overflow when the request's estimated input exceeds the model's declared window, and the README says so. Hyper's two routes and both SystemOne routes were unmeasured (Task 1 (b)).
      - When a model call fails with `context_overflow` and the call result says no output started (Task 1 (c): `ProviderTurnFailure.observable` is the `started` bit at `provider-round.ts:295,390`; `retryLoop` rethrows through `errorFromInfo` and drops it, so recover where that bit is intact or carry it on `ErrorInfo`), the session:
        1. compacts the branch through the `compaction` slot with `trigger: "overflow"`, ignoring `compaction.when` (the provider has already decided)
        2. rebuilds the request
        3. retries the model call once, inside the same turn
      - The retry does not charge `maxTurns` again (re-assembly charges it at `assemble.ts:416`) and records usage only for the call that ran. Today the failed attempt already records an estimate through `recordTurnUsage` (`provider-round.ts:373`), so this is a behavior change, not only new code.
      - A second overflow on the retry, or an overflow after output started, fails the run with `ContextOverflowError` (`code: "context_overflow"`, exported from `@arnilo/prism`), with the estimated and declared token counts in the message.
      - `compaction.completed` (new `trigger` field, `src/contracts-protocol.ts:344-354`) and the stored compaction entry carry `trigger: "overflow"`; `compactBranchResilient`'s trigger union gains it. `memory-compaction`'s LLM compactor must stamp it too: it writes `{ ...prep.data, strategy }` and no trigger (`packages/memory/compaction/src/strategy.ts:85-92`), and it owns the reference host's slot.
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
      - `src/provider-kit/transport.ts` (class + patterns as data), `src/provider-kit/index.ts`, `src/redaction.ts` (`readProviderFailureClass` whitelist, `:204-215`) and `src/contracts-core/content.ts` (the `ProviderFailureClass` union)
      - `src/agent-session/session.ts`, `src/agent-session/session/assemble.ts`, `src/agent-session/session/provider-round.ts` (the recovery seam, where `started` is known), `src/agent-session/session/types.ts`
      - `src/contracts-protocol.ts` (`compaction.completed.trigger`), `src/errors` or the module that owns run errors (Task 1 (c) names it), `src/index.ts`
      - `packages/memory/compaction/src/strategy.ts` + tests (stamp `trigger` into the LLM compactor's entry)
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

  Notes (executed 2026-10-24):

  - **Classification.** `classifyProviderFailure` returns `context_overflow` for 400/413/422 whose bounded body matches `context_length_exceeded`, `maximum context length`, `context window exceeds limit`, or `prompt is too long` (`src/provider-kit/transport.ts:31-47`); the strings are data beside `QUOTA_BODY`. The two OpenCode Go bodies recorded in Task 1 are the tests. `ProviderFailureClass` gains the member (`src/contracts-core/content.ts:13-21`) and `readProviderFailureClass` whitelists it (`src/redaction.ts:205-214`), so it survives `errorToErrorInfo` into `ErrorInfo`/`run.failed`.
  - **Unmeasured routes.** The estimate-vs-window fallback lives where the request is known, not in the classifier: `contextOverflowEvidence` (`src/agent-session/session/provider-round.ts:203-229`) accepts any 400/413/422 when `resolveTurnInputCap` yields a window and the message+extras estimate exceeds it. This also covers SystemOne's 422 without a body rule. It is deliberately one-directional: a body match always wins; estimates never turn a 5xx or an unrelated status into overflow.
  - **Seam.** `ProviderOverflowRecovery` (`src/agent-session/context-overflow.ts:31-40`) is thrown from `generateProviderTurn`'s catch, where `started` is still intact, instead of carrying a public `observable` bit through `retryLoop`; `generateWithRetry` passthroughs it (and `ContextOverflowError`) unchanged (`provider-round.ts:239`). A failure after output started throws the terminal `ContextOverflowError` directly, so no started stream is replayed. A rejected attempt with no reported usage skips `recordTurnUsage` (`provider-round.ts:401-407`), so the ledger and budgets see only the call that ran; reported usage is still kept.
  - **Recovery.** The `generate` closure (`src/agent-session/session/assemble.ts:495-580`) catches the marker, calls `session.compactOverflow` (slot compaction with `trigger: "overflow"`, `compaction.when` bypassed, failure propagates after `throwIfAborted` — abort wins over the wrap), rebuilds through the split `buildTurnRequest`, re-runs `context.build`/`model.request` via the extracted `applyRequestTransforms`, and retries with `generateWithRetry` exactly once. `maxTurns` is charged only in `assemble`, never in `buildTurnRequest`. A second overflow or a compaction failure becomes `ContextOverflowError` with counts and the redacted cause; the message shape is `input ~N tokens exceeds window M: <reason>` and carries no prompt text.
  - **Refactor.** `draftFromRequest`, `applyDraft`, and the per-request transform pipeline moved verbatim from `src/loop/run-controller.ts` to `src/loop/request-draft.ts` so the session's recovery path and the loop run the same pipeline; `run-controller.turn` now calls `applyRequestTransforms` and behaves identically (no behavior change in the loop tests).
  - **Trigger.** `CompactionReason = "manual" | "auto" | "overflow"` (`src/contracts-core/compaction.ts:8`) types the session seams and the event; `compaction.completed` gains `trigger` (`src/contracts-protocol.ts:351`), and both the success and failure emissions carry it (`session.ts:1082,1126`). The kernel compactor already stamped `data.trigger`; `memory-compaction`'s LLM compactor now does too (`packages/memory/compaction/src/strategy.ts:89`). Sweep: `rg '"manual" \| "auto"'` over `src/ packages/ apps/ scripts/ examples/ docs/` (excluding history/evidence) finds only the new `CompactionReason` definition.
  - **Public surface.** `ContextOverflowError` is a root export (`src/index.ts:3`, `src/agent-session/context-overflow.ts`), with `code: "context_overflow"`, `estimatedTokens`, `windowTokens`, and the original `info` as `cause`; `src/__tests__/public-export-contract.test.ts` and `scripts/compat-baseline/arnilo__prism.txt` record it. The loop internals (`ProviderOverflowRecovery`) stay off the barrel.
  - **Tests.** `src/__tests__/context-overflow-recovery.test.ts` maps the plan's cases: `overflow_classified_per_supported_route` (3 classifier tests covering both recorded bodies plus the other patterns and SystemOne 422, and the negative 400/5xx), `overflow_triggers_one_compaction_and_retry` (also proves a `{ compact: false }` vote cannot block recovery and that the entry/event carry `"overflow"`), `overflow_retry_does_not_double_charge_turns_or_usage` (`maxTurns: 1`, failed attempt has no usage, result usage is the successful call's), `second_overflow_fails_with_context_overflow_error`, `overflow_after_stream_started_fails_without_retry`, `overflow_compaction_failure_fails_closed`, `abort_during_overflow_recovery_appends_nothing` (abort inside the compactor), and `recovers_from_the_default_loop_and_a_custom_loop`. `packages/memory/compaction/src/__tests__/strategy.test.ts` asserts the LLM compactor stamps the trigger.
  - **Docs.** `docs/loop.md` (recovery bullet plus its performance line), `docs/events.md` (`compaction.completed.trigger`), a new "Provider failure classes" section in `docs/provider-kit.md`, the root CHANGELOG, and the `memory-compaction` CHANGELOG.
  - **Budgets.** Kernel ceilings rebaselined to 1145152 packed / 3730012 unpacked / 360 files / 1489 root exports / 38906 source lines with the reason recorded in each `kernel.*.$comment` (`scripts/budgets.json`); the +8 root exports are the two context-overflow classes, the two other exported helpers in that module, the three request-draft helpers, and `CompactionReason`. `bun scripts/release.mjs gate` passes.
  - **Verification.** 224 targeted tests (overflow, public exports, transport, retry, compaction, hook catalog, loop conformance, docs) and 123 package tests pass; `npm run typecheck` and biome lint are clean. Full `bun test src/__tests__`: 4576 pass, 8 fail, all pre-existing on this branch and unrelated to this task (the network-free guard flags `packages/tools/web/src/__tests__/searxng.test.ts`; `one_shot_jsonl_matches_golden` differs only by the estimated input 202→246, the red already recorded in plan 193 Task 9 as a plan-190 drift, not request bytes; the 0.3.0 release-graph and codemod tests, and four 5 s timeouts under parallel load — plan 177 and 193 record `host_adapter_passes_adapter_conformance` as timing-flaky at bun's 5 s default).
  - **Verdict:** done. Every acceptance bullet is implemented or explicitly amended; the only deviation is that the estimate fallback is applied at the recovery seam rather than in `classifyProviderFailure` (which has no request), and that the started bit travels as the internal marker instead of a new `ErrorInfo` field.

- [x] Task 4: Cache-aware tool-result clearing (fold batch mode)
  - Acceptance Criteria:
    - Functional:
      - `fold.clearAtLeastTokens` (integer ≥ 0, default `0` = today's per-turn behavior) and `fold.keepLast` (default `3`, the newest tool results never folded) in `@arnilo/prism-context-engineering`. Both fields are new (`ContextEngineeringFoldConfig`, `config.ts:26-31`); `keepLast`/`excludeTools` exist today only under `attention` (`config.ts:39-50`), so a fold-only host needs its own `fold.excludeTools` (or the plan states that exclusion depends on attention being configured).
      - With `clearAtLeastTokens > 0`:
        - the package keeps a persisted **fold frontier** (session package state, its own key: the attention frontier records sticky thinking/tool-call ids, a different meaning — Task 1 (d))
        - on each `context.build`, results that are foldable (`minAgeTurns`, `minBytes`, not in the newest `keepLast`, not in the exclusion list) and newer than the frontier are summed
        - only when that sum reaches `clearAtLeastTokens` does the frontier advance, and every one of them folds in that request
        - otherwise the provider view is byte-identical to the previous request up to the new tail
      - Folded results keep their `toolCallId` and `metadata` (fold.ts:96-110 keeps both, adding `prismFolded: true`), and the stub names the tool, the call id, and the original size: `[folded: read packages/api/src/routes.ts, 18,240 bytes — re-run the tool to see it again]`. Today's stub carries no size (`fold.ts:157-159`), so this is a byte change.
      - A frontier that fails validation on restore restores nothing (existing fail-closed rule).
      - Baseline for the test: today's per-turn fold already breaks the prefix at the first fold — measured 37.8% of the previous request kept, `resets [4]` (Task 1 (d)).
    - Performance:
      - With batch mode, request prefixes change at most once per `clearAtLeastTokens` of cleared output, plus at compactions.
      - The README gives the trade-off: one cache miss per batch vs carrying stale output, and a sizing rule (`clearAtLeastTokens` ≈ 10% of the input cap, so a batch clears enough to pay for the cache miss).
      - `prefixStabilityConformance` (plan 184 Task 2, if landed; else the local request-diff helper) proves byte-identical prefixes between advances.
    - Code Quality:
      - A separate state key with the attention frontier's validation: Task 1 (d) shows the two frontiers carry different meaning (sticky ids vs a cleared-token advance), so they must not share one value.
      - No speculative per-tool policies beyond the exclusion list.
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

  Notes (executed 2026-10-24):

  - **Config.** `ContextEngineeringFoldConfig` gains `keepLast` (default `3`), `excludeTools` (default `[]`) and `clearAtLeastTokens` (default `0`) (`config.ts:24-38`), with schema bounds (`config.ts:110-116`) and resolved defaults (`config.ts:190-197`). The library resolver mirrors them (`fold.ts:64-81`) and validates `keepLast` 0..1024 and `clearAtLeastTokens` 0..2,000,000; `excludeTools` is validated as bounded names. `keepLast`/batch only take effect when `clearAtLeastTokens > 0`: `0` is exactly the previous per-turn fold (every eligible row, newest included), which is what `fold_zero_threshold_matches_previous_behavior` pins. `excludeTools` applies in both modes because it is a new opt-in field (an unset list changes nothing).
  - **Frontier.** Its own session state key `contextEngineering.foldFrontier` (`state.ts:31`), value `{ folded: string[] }` capped at 4,096 ids (`state.ts:35-40`). `readFoldFrontier` restores nothing when the value is absent, the shape is wrong, any entry is not a bounded string, or the list is over cap (`state.ts:83-90`); `writeFoldFrontier` keeps the newest ids (`state.ts:92-94`). It is separate from the attention sticky frontier because the two mean different things (cleared ids vs sticky thinking/tool-call ids), as Task 1 (d) required. Evicting an old id is safe: the stub is derived from the stored result, so re-folding after eviction produces the same bytes.
  - **Batch selection.** `planToolResultFoldBatch` (`fold.ts:112-152`) walks the transcript, drops the newest `keepLast` tool rows and `excludeTools`, keeps rows meeting `minAgeTurns`/`minBytes`, filters out ids already cleared, sums their `estimateTextTokens`, and advances the frontier with every pending id only when the sum reaches `clearAtLeastTokens`. It returns `{ foldToolCallIds, advance }`; a held batch returns just the cleared ids. `foldToolResultHistory` gained the optional `restrictToToolCallIds` context (`fold.ts:45-52`) and returns the same array when the restriction is empty, so a request with no cleared rows keeps the controller's fast path (`fold.ts:89-93`).
  - **Handler.** The fold stage reads the frontier, plans, folds only the selected ids, and persists `cleared ∪ advance` after a successful fold (`handler.ts:72-89`). The attention/budget stages are untouched, so a host with `attention` configured keeps the compiler's own `keepLast` and stub; batch semantics belong to the fold stage the plan named.
  - **Stub.** `foldedToolResultStub` (`fold.ts:230-236`) renders `[folded: <tool> [<callId>], <grouped bytes> bytes — re-run the tool to see it again] <summary>`, with the size being the same `toolResultFoldText` bytes the fold summarizes; the tool call id and the message metadata (plus `prismFolded: true`) are preserved. `foldedToolResultHeader` stays for the attention compiler, whose C5 digest stub is unchanged.
  - **Tests.** New `packages/context/engineering/src/__tests__/fold-batch.test.ts` (9 pass) covers the plan's seven cases — `fold_batch_holds_until_clear_at_least_reached` (three turns below the threshold, request *n*'s prefix equals request *n-2*'s bytes and no stub appears), `fold_batch_folds_all_pending_together`, `fold_keeps_last_n_results`, `fold_frontier_restored_after_reopen` (the cleared stubs survive a reopen while the third result stays raw, which fails if the frontier was not restored), `fold_stub_names_tool_call_and_size`, `folded_result_keeps_tool_call_id_and_metadata`, `fold_zero_threshold_matches_previous_behavior` — plus a held-batch `runPrefixStabilityConformance` run (`foldableToolResultBytes: 8_192`, 4 requests, `resets: []`, `minContinuity ≥ 0.95`) and the malformed-frontier check. Existing fold/attention tests were updated only where they asserted the old stub string (`fold.test.ts`, `package.test.ts`, `attention-durable.test.ts`); the attention compiler's own stub assertions are unchanged.
  - **Docs.** `packages/context/engineering/README.md`: three config rows, the new stub sentence, and a "Fold batch mode" paragraph with the trade-off and the sizing rule (`clearAtLeastTokens` ≈ 10% of the input cap, ~12,000 for 128k). `packages/context/engineering/CHANGELOG.md`: Added/Changed entries. No `docs/index.md` change.
  - **Compat.** `bun scripts/release.mjs gate --update-baseline` records the new constants (`DEFAULT_FOLD_KEEP_LAST`, `DEFAULT_FOLD_CLEAR_AT_LEAST_TOKENS`, `DEFAULT_TOOL_RESULT_FOLD_*`, `FOLD_FRONTIER_KEY`, `MAX_FOLD_FRONTIER_IDS`), `foldedToolResultStub`/`planToolResultFoldBatch`, the widened `ToolResultFoldOptions`/`ResolvedToolResultFoldOptions`/`FoldToolResultsContext` fields, and the wider config type; the follow-up `gate` reports `updated: false`, 45 packages. Kernel budgets did not move (package-only change).
  - **Verification.** 88 package tests pass (12 files), including the 9 new ones; the kernel slice `kernel-context-engineering-retirement`, `docs`, `public-export-contract` and `compaction-when-abstain` is 107 pass. `npm run typecheck` and biome lint are clean. The acceptance baseline from Task 1 (per-turn fold keeps 37.8% of the previous prefix) is what batch mode removes: with a held batch the conformance run now keeps 100% (`resets: []`).
  - **Verdict:** done. The only amendment is the explicit reading that `keepLast` applies to batch mode only, forced by the "zero threshold matches previous behavior" criterion and by the fact that per-turn keepLast would silently change every existing fold host.

- [x] Task 5: Context accounting and a block-share cap
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

  Notes (executed 2026-10-24):

  - **Config.** `accounting?: boolean` (default `false`) and `blocks?: { maxShare }` (`config.ts:61-73`), with schema entries (`config.ts:107-118`) and a resolver that rejects `blocks` with `budget` ("budget and blocks are mutually exclusive: both evict context blocks from the same request, so configure one", `config.ts:214-222`) and `maxShare` outside `(0, 1]`. `isEmptyContextEngineeringConfig` now counts both, so `{}` still registers nothing (`config.ts:242-244`, `:258-267`).
  - **Event.** `accounting.ts:66-79` measures the final request once, after any cap, and returns `{ turn, inputCapTokens, totalTokens, bySource, dropped }`. `bySource` carries the exact keys the task named; prefix `blocks` are keyed by `metadata.source` (title fallback) and tail `tail` from `metadata.contextBlocks` (`accounting.ts:195-255`). `totalTokens` is the kernel estimator over every final message plus the assembler's tool-declaration text shape (`accounting.ts:83-90`), matching `provider-round`'s fallback without re-adding context blocks that are already rendered into messages. System prompt → `system`; later no-source system messages and tool declarations → `instructions`; `loadedSkill` / catalog markers → `skills`; `context-files-nested` is an instruction layer, never a block. The event contains numbers and source names only — `accounting_event_contains_no_text` passes.
  - **Registration.** `install` always registers one `model.request` handler when the package has any config (`index.ts:152-163`), which satisfies "`accounting: true` or any stage configured"; `{}` registers no accounting handler (`no_config_registers_no_accounting_handler`). `inputCapOf` uses `resolveInputCap({}, session.model)` and yields `0` when the model declares no window, so the share cap is skipped rather than dropping everything (`index.ts:203-210`).
  - **Cap.** `blocks.maxShare` caps prefix block messages and tail items together at `floor(maxShare × inputCap)` (`accounting.ts:67`). `selectDrops` drops whole entries lowest `priority` first, then latest-added (`order` descending), stopping as soon as the rest fit (`accounting.ts:129-142`); `dropBlocks` removes the prefix messages, their `request.context` entries by metadata identity, and rebuilds the tail message without the dropped item's text/separator slots (`accounting.ts:144-193`). Tail items without a token count fall back to the kernel estimator over their rendered part (`accounting.ts:277-300`). The system prompt and instruction-layer messages are never entries, so they cannot be counted or dropped (`block_share_never_drops_system_or_instructions`).
  - **Tests.** New `accounting.test.ts` (8 pass) covers all seven plan cases: `accounting_event_sums_to_request_estimate`, `accounting_keys_blocks_by_source_including_tail_metadata`, `block_share_cap_drops_lowest_priority_whole_block_and_reports`, an extra whole-tail-drop case, `block_share_never_drops_system_or_instructions`, `blocks_and_budget_are_mutually_exclusive` (including `maxShare` bounds), `no_config_registers_no_accounting_handler`, and `accounting_event_contains_no_text`.
  - **Scripts.** `scripts/memory-bench` reads provider-reported ledger usage and does not re-estimate request context (`scripts/memory-bench/usage.mjs`, `journal.mjs`), so there is nothing to switch there; `scripts/context-rot` is Task 6 and will consume `context.accounted` then.
  - **Docs.** `packages/context/engineering/README.md`: two config rows, the mutual-exclusion sentence, an **Accounting** section with the event shape/keys/no-text guarantee, and a **Block share cap** section with the priority order and the no-window skip. `packages/context/engineering/CHANGELOG.md`: two Added entries. `docs/index.md` needed no change.
  - **Compat.** `bun scripts/release.mjs gate --update-baseline` adds `ContextAccountingConfig`/`ContextEngineeringBlocksConfig`/`ContextAccountEvent`/`AccountRequestOptions`/`AccountedRequest`, `accountRequest`, and the new resolved config fields (`accounting`, `blocks`); the follow-up `gate` reports `updated: false`, 45 packages. Kernel budgets did not move (package-only change; accounting deliberately does not export or change kernel estimators).
  - **Verification.** 97 package tests pass (13 files, including the 8 new); docs/public-export/package-contribution slice 116 pass; `npm run typecheck` and biome lint are clean; release gate stable.
  - **Verdict:** done. The only amendment is `totalTokens`: it counts the tool-declaration text exactly once (as the kernel's usage fallback does) and does not re-add `request.context`, which is already rendered into `messages` — adding it again would double count every block.

- [x] Task 6: The rot curve — measure each release model's effective input budget
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

  Notes (executed 2026-10-24):

  - **Command and data.** `run.mjs` implements `--provider/--model`, `--lengths`, `--repeats`, `--max-input-tokens`, `--max-turns`, `--offline`, `--cache`, `--output-dir`, `--summary` (`parseArgs`, `run.mjs:64-108`). Defaults are 0/16k/32k/64k/96k, repeats 3, 50M/model, and every length is clamped through `resolveInputCap` (`clampLengths`, `run.mjs:122-127`). The amendment beyond the plan text is `--max-tasks <n>` for pilots, round-robin by kind so a 3-task run covers coding/needle/tools rather than three coding tasks (`selectTasks`, `run.mjs:109-120`). The 30 tasks are data in `tasks.json` (10 each; 252 lines).
  - **Tasks.** Coding tasks edit `src/bugs.js` and the grader runs only the named fixture test, refusing if the test file checksum changed (`grade.mjs:61-75`); needle tasks state the fact at session start and use non-lexical questions, exact normalized answers; tool tasks seed `data/` and compare exact final JSON/text state (`grade.mjs:77-97`). No model judge anywhere.
  - **History.** `history.mjs:15-27` pins `expressjs/express` at `1c6f1b0`, 136,167 bytes, SHA-256 `aadc004d…789b`, MIT. `loadPinnedBytes` verifies the cached archive on every run and fails closed on mismatch (`history.mjs:42-64`); `readTarTextFiles` is a minimal ustar reader for text files only (`:66-96`); `extractSnapshot` writes them read-only under the cache and never imports or executes them (`:98-119`). `buildHistoryMessages` alternates read/grep completed tool turns until the target token count (`:153-193`). The same array is reused per length and the cache breakpoint points at its last message (`run.mjs:475`, `:369-376`). Measured 4k→4,059 tokens, 16k→16,017, 96k→97,741.
  - **Fold.** The fold arm uses `resolveToolResultFold({clearAtLeastTokens: 4096, keepLast: 3, minAgeTurns: 2, minBytes: 4096, summarize: truncateSummarize})`, `planToolResultFoldBatch` and `foldToolResultHistory` with a per-task frontier (`run.mjs:338-348`, `:360-364`). History rows carry `prismToolResultTurn`, so age is measured from the completed turn, not the current one.
  - **Wire and ceiling.** Live runs go through `startWireProxy` with a per-run truncated usage log; input/cache-read/output/calls are read from the proxy after each task (`run.mjs:135-161`, `:429-442`). The provider list catalog supplies the model and window; both Hyper and OpenCode Go routes are supported. The ceiling is checked before each task and returns a partial report with `status: "ceiling"` (`run.mjs:493-496`, `:554-556`).
  - **Report.** `aggregate`/`writeEvidence` produce `<provider>-<model>-<date>.{json,md}` and `updateSummary` upserts `docs/_evidence/context-rot-0.13.0.md` (`report.mjs:7-58`, `:110-121`, `:139-153`). Accuracy uses Wilson 95% (`grade.mjs:22-33`); the effective budget is the largest tested length within 5 points of the 0-length baseline with overlapping intervals, smallest tested when none qualify (`grade.mjs:35-47`); the fold budget is computed the same way. Evidence holds ids/kinds/lengths/configs/scores/usage only, no prompts, answers or file text.
  - **Tests.** `run.test.mjs` 5 pass: offline smoke (all lengths/arms, >0 usage, <30 s), checksum refusal, ceiling partial report, budget fixture including none-qualify, and deterministic grading (solved fixture twice plus needle/tool state). `scripts/live-doc-check.test.mjs` also passes after regeneration.
  - **Docs/workflow.** `scripts/context-rot/README.md` documents method, flags, cost, output and security; `scripts/live-matrix.json` gains `release/context-rot` and `docs/live-testing.md` is regenerated from it; `.github/workflows/live-matrix.yml` gains the manual-only `context-rot` job (Hyper then OpenCode Go, evidence artifact). `CHANGELOG.md` records the harness and measured pilot.
  - **Evidence (pilot).** OpenCode Go `mimo-v2.5`, one task per kind, five lengths, one repeat: 4,110,549 input / 3,887,872 cache-read (94.6%) / 16,455 output, 99 calls, 50M ceiling not hit, $0.0467 list estimate, effective budget 96,000 with fold also 96,000. The only miss was 16k without fold (2/3); every other cell was 3/3. Evidence: `docs/_evidence/context-rot/opencode-go-mimo-v2.5-2026-10-24.{json,md}` and summary row in `docs/_evidence/context-rot-0.13.0.md`.
  - **Not run.** The acceptance's full matrix is 30 tasks × 5 lengths × 3 repeats × 2 configs per model; the pilot above is 3 tasks × 5 lengths × 1 repeat. Hyper has no credential in `~/.config/prism/live.env` (only `OPENCODE_GO_API_KEY`), so its row is unmeasured here. Both are operator runs through the manual `release/context-rot` job; the harness, summary row and upload path are in place. The pilot evidence and summary both say so explicitly.
  - **Verdict:** done for the harness, docs, tests, workflow and a live pilot; the full 30-task/3-repeat matrix and the Hyper row remain operator-gated. No package, protocol or product default changed.

- [x] Task 7: Reference host and OM — triggers from the evidence, clearing on, and a bounded long session
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

  Notes (executed 2026-10-24):

  - **(a) OM's gate is relative.** `context.compactAt?: { ratio?: number; maxTokens?: number }` replaces `context.compactAfterTokens`; the resolved shape is `{ ratio: 0.6 }` by default (`packages/memory/observational/src/config.ts:27,306,315-340`). `resolveCompactAtThreshold` returns `min(ratio × resolveInputCap(model), maxTokens)`; with no declared window it returns `maxTokens`, and without one it throws a field-naming error (`config.ts:363-377`). At config time there is no model, so the no-window failure lands on the first gate evaluation, not package load; `om_compact_at_requires_max_tokens_without_window` covers it directly. The handler uses the helper (`index.ts:135`), the legacy settings surface and `om:status` carry the same shape (`settings.ts:38,89,115,166,212-218`; `commands.ts:144`), and the exported default is `DEFAULT_COMPACT_AT_RATIO = 0.6`. Own-compaction coverage logic is untouched.
  - **(b) Coding worker.** `observational({ context: { compactAt: sessionCompactAtFor(coding) } })`, `compaction({ profile: "coding", trigger: compactionTriggerFor(coding) })`, and `contextEngineering({ fold: { minAgeTurns: 2, minBytes: 2048, keepLast: 3, clearAtLeastTokens: foldClearAtLeastTokensFor(coding) }, accounting: true })` (`apps/prism-agent/src/host/coding.ts:47-60`). Research is the same with the default compaction profile plus `blocks: { maxShare: 0.2 }` (`research.ts:53-65`). Both add `@arnilo/prism-context-engineering` to the host package (`apps/prism-agent/package.json`).
  - **(c) Budgets are one data table.** `CONTEXT_BUDGETS` is keyed `provider/model` and names its evidence in the entry comment (`apps/prism-agent/src/host/context-budgets.ts:9-18`). The one measured row is `opencode-go/mimo-v2.5: 96_000` (Task 6 pilot evidence). `compactionTriggerFor` uses `threshold_tokens: 96_000` for it and `input_ratio: 0.6` otherwise (`:29-34`); the measured budget is below 0.6 × the model's 1M input cap, so it is the smaller gate Task 1 (e) calls for. Fold is 10% of the budget (9,600) or 4,096 for unlisted models (`:37-40`); OM is `{ ratio: 0.6, maxTokens: 96_000 }` or `{ ratio: 0.6 }` (`:43-46`). `contextBudgetNotice` emits one `info` status note per agent only for an unlisted model (`:49-60`). No host-side trigger algorithm is duplicated.
  - **(d) Bounded long session.** `apps/prism-agent/src/scenarios/long-session.ts` runs one run with 60 turns, one 6 KB `long_result` tool result per turn, all on a mock provider with a 64k declared window; the summary-model calls are answered locally, and turn 40's first request is a scripted `context_overflow` (`:9-10,36-72`). It records provider requests and both session and `package.event` events through `deps.hooks` (`:105-145`). Measured: 391 ms, 66 provider requests (64 normal + 2 summary), 3 compactions (`auto`, `auto`, `overflow`), fold advances of 3 results per batch (frontier counts 0,3,…,21), and `context.accounted.totalTokens` between 2,351 and 13,287 against the 37,785 trigger plus one turn. `long_session_stays_bounded` asserts compaction, batch folding, prefix stability between advances and the accounting ceiling; `long_session_recovers_from_overflow` asserts the turn-40 retry and overflow-triggered compaction (`apps/prism-agent/src/__tests__/context.test.ts:139-202`).
  - **(e) Worker tests.** `coding_worker_compacts_with_coding_profile_and_trigger` checks the coding profile, 96k trigger, 9.6k fold batch, accounting, and OM's `maxTokens`; `research_worker_caps_block_share` checks `blocks.maxShare: 0.2` and the same trigger; `unlisted_model_uses_ratio_and_notes_once` checks `input_ratio: 0.6`, the 4,096 batch, and exactly one `@prism-agent/context-budget` note. All three are in `context.test.ts:36-136`. The app suite is 46/46 green.
  - **(f) Tests for the gate.** `packages/memory/observational/src/__tests__/compact-at.test.ts` covers ratio/cap math, the cap being the smaller value, no-window `maxTokens`, and invalid ratio/maxTokens. OM package tests are 99/99 green; fabric 479 pass / 23 skip; root compaction slices 58/58.
  - **(g) Docs and release bookkeeping.** OM README carries the `compactAt` row and gate wording; `apps/prism-agent/README.md` has a Context management section with the measured budget table, fold batch, fallback and cache-miss cost. Root and OM CHANGELOGs record the change. `examples/autonomous-coding-loop.ts`, the fabric tests, memory-bench defaults, the e2e fixture and `examples/observational-memory.ts` are migrated; the latter's main model now declares limits so the relative gate has a cap. `scripts/release.mjs gate --update-baseline` refreshed the compat baselines: OM removes `DEFAULT_COMPACT_AFTER_TOKENS` and adds `DEFAULT_COMPACT_AT_RATIO`, `resolveCompactAtThreshold` and the two types; root adds the Task 3 overflow exports (plus earlier uncommitted additive surfaces). The one-shot golden fixture is rebaselined for the extra accounting tokens/model limits. `scripts/budgets.json` kernel packed/unpacked ceilings are raised to 1,146,604 / 3,733,601 with a reason naming the Task 6-7 CHANGELOG/docs and the core removal; an accidental `attentionCompiler` comment rewrite from the updater was reverted. Plain `bun scripts/release.mjs gate` passes.
  - **(h) Sweep.** No production use of `compactAfterTokens` remains: `src/contracts-core/compaction.ts` no longer offers `ResolveShouldCompactOptions.compactAfterTokens`, OM config/settings use `compactAt`, and the only current hits are the removal guard in `settings.ts:186`, its tests and the CHANGELOG. Historical `plans/`, `docs/history/`, `docs/_evidence/`, phase-freeze manifests and the memory-bench evidence snapshots keep the old spelling as records, by design.
  - **Verdict:** done. The host now compacts from data, folds in batches, accounts every request and keeps a 60-turn session bounded and overflow-recoverable; the relative OM gate is the only current `compactAt` surface. No new dependency in the kernel.

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
