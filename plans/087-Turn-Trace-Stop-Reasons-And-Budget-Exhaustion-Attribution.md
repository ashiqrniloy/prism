# Turn Trace Stop Reasons and Budget Exhaustion Attribution

Release: 0.9.0 (P0). Closes synapta F9/P02 (maxTurns killed a Do investigation; turn trace had to be built host-side).

## Objectives
- Every provider turn records a stop reason, effective budgets (which axis was closest), and cache hit/miss on the existing turn events.
- When a run dies on a limit, emit a structured `budget_exhausted` attribution: which limit fired, turns used, tokens per axis, last N tool calls.
- Project both through `ExecutionTimeline` so hosts get a packed diagnostic artifact with zero instrumentation.

## Expected Outcome
- Synapta's P02 instrument (turn trace + stop reason + budget state) is deletable — prism events provide it.
- A `maxTurns` death produces one event from which a host can answer: which limit fired, how close were the others, what was the agent doing.

## Tasks

- [x] Task 1: Stop-reason taxonomy and turn metadata extension
  - Acceptance Criteria:
    - Functional: `provider_turn_finished` (and stream completion metadata) carries `stopReason` from a closed taxonomy (`end_turn`, `tool_calls`, `max_output_tokens`, `content_filter`, `abort`, `provider_error`) and `budgets: { inputTokens, inputCap, runInputBudget, runInputUsed, turns, maxTurns }` snapshot at turn end.
    - Performance: Metadata assembly is O(1), no extra provider calls; event size bounded by existing metadata limits.
    - Code Quality: Taxonomy lives in `src/contracts-core/` event contracts; provider adapters map native reasons (e.g. Anthropic `stop_reason`, OpenAI `finish_reason`) through one shared mapping table with a conformance test.
    - Security: No payload content beyond counts/ids already in events; stop reason is non-sensitive.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-events.md` (event contract), `docs/execution-timeline.md`
      - `src/agent-session/session/provider-round.ts` (`buildMetadata`, turn lifecycle)
      - `docs/provider-conformance.md` (adapter mapping precedent)
    - Options Considered:
      - Free-form string stopReason: rejected — hosts can't switch on it; taxonomy with `unknown` escape hatch chosen.
      - Separate `turn_budget` event: rejected — doubles event volume; extend existing finished event.
    - Chosen Approach: Closed union + per-adapter mapping table + conformance assertion that every provider adapter emits a valid reason.
    - Execution Notes (2026-09-18):
      - Taxonomy is `ProviderStopReason` in `src/contracts-core/provider.ts` (`end_turn`, `tool_calls`,
        `max_output_tokens`, `content_filter`, `abort`, `provider_error`, `unknown`); `TurnBudgets`
        lives beside it and rides the existing `ProviderTurnMetadata`, so there is no new event type
        and no `turn_budget` event.
      - One shared table + `mapProviderStopReason` live in `src/provider-events.ts` (already imported
        by every adapter) and are exported from the root barrel; the normalized `done` provider event
        gained an optional `stopReason`, so "stream completion metadata" carries the same mapped
        value. Missing, unmapped, or non-string natives return `unknown` and never throw.
      - All distinct stream parsers were wired: `openai-compatible` (`finish_reason`, covering the
        OpenAI-compatible family incl. Vertex/Azure/OpenRouter/Z.AI/Ollama/DeepSeek/xAI/Alibaba/
        NeuralWatt/clinepass/Moonshot/opencode-go OpenAI route), `anthropic/messages`,
        `shared/anthropic-messages` (opencode-go Anthropic route), `kimi/provider.ts`,
        `google/generate-content.ts`, `bedrock/converse.ts` (stream + non-stream),
        `openai/responses.ts` (`status` + `incomplete_details.reason`), and `ai-sdk/stream.ts`
        (V4 `{ unified, raw }`, tolerating a bare string).
      - `provider-round.ts` is the single emission point: it captures the `done` reason, normalizes a
        generic `end_turn` on a turn that produced tool calls to `tool_calls` (Google's `STOP` is
        generic), maps aborts to `abort` and failures to `provider_error`, and assembles `budgets`
        O(1) from `RunLimitTracker.snapshot()` plus the resolved input cap (`resolveInputCap`, the
        same helper the attention compiler uses). `inputCap` is omitted when no cap is derivable
        (model without `contextWindow` and no `attentionCompiler.maxInputTokens`); `inputTokens` is
        the turn's provider-reported input usage; `runInputBudget`/`runInputUsed` are the cumulative
        run input axis; `turns`/`maxTurns` are the clean turn axis.
      - Export budget rebaselined: `scripts/budgets.json` `@arnilo/prism` 1378 → 1381 (+3:
        `ProviderStopReason`, `TurnBudgets`, `mapProviderStopReason`); the frozen SDK surface test
        gained the value export. `docs/_evidence/phase54-package-map.md` regenerated via
        `node scripts/package-truth.mjs --emit-docs`.
    - API Notes and Examples:
      ```ts
      session.on("provider_turn_finished", (e) => {
        e.stopReason; // "max_output_tokens"
        e.budgets;    // { inputTokens: 412_300, inputCap: 1_048_576, runInputBudget: 500_000, runInputUsed: 412_300, turns: 14, maxTurns: 40 }
      });
      ```
    - Files to Create/Edit:
      - `src/contracts-core/provider.ts`: `ProviderStopReason`, `TurnBudgets`. **Done**
      - `src/contracts-protocol.ts`: `done.stopReason`, `ProviderTurnMetadata.stopReason`/`budgets`. **Done**
      - `src/provider-events.ts` + `src/index.ts`: shared `mapProviderStopReason` table,
        `providerDone(usage, stopReason)`, barrel export. **Done**
      - `src/agent-session/session/provider-round.ts`: capture + normalize + emit. **Done**
      - `packages/prism-providers/src/*/`: the eight distinct stream parsers listed above. **Done**
    - References: synapta Plan 117 F9, P02; Codex CLI turn records.
  - Test Cases to Write:
    - Each provider adapter: native stop reason maps to taxonomy (`max_output_tokens` length case end-to-end with fake stream).
    - Budget snapshot reflects post-turn charged state (maxRequestBytes/maxProviderAttempts unchanged).
    - Event contract: extra fields optional-tolerant for older hosts.
  - Test Status: **written and passing** — new `src/__tests__/stop-reason.test.ts` (7 tests: per-protocol
    native mapping, unknown fallback, `providerDone` shape, OpenAI-compatible `finish_reason: "length"`
    end-to-end, `provider_turn_finished` stopReason + budgets snapshot, tool-call normalization, provider
    error attribution) plus per-adapter assertions added to the existing anthropic/opencode-go/kimi/
    google/bedrock/openai/AI-SDK fake-stream suites and updated `done` expectations in
    `openai-compatible.test.ts`. `npm test` (all 6 stages), `npm run typecheck`, `npm run lint`, and
    `npm run format:check` pass.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — event payload extension.
    - Docs pages to create/edit: `docs/agent-events.md` (stop reason table, budgets shape, `done` note);
      `docs/provider-conformance.md` (stop-reason checklist). **Done**
    - `docs/index.md` update: no — existing pages.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2: `budget_exhausted` run-limit attribution event
  - Acceptance Criteria:
    - Functional: When `activeLimits` rejects (maxTurns, run input budget, maxProviderAttempts, maxRequestBytes), the run terminal event set includes `budget_exhausted` with `{ limit: <axis>, consumed: { turns, inputTokens, providerAttempts, requestBytes }, closestOtherAxes: [{ axis, usedRatio }], recentToolCalls: ToolCallSummary[] }` (last 10, ids + names + arg hashes, not full args).
    - Performance: Recent-tool-call ring buffer maintained incrementally during the run; event construction O(size of summary).
    - Code Quality: One emission point in the run-limit rejection path (`session.activeLimits.charge` failure handling), not per-limit copies.
    - Security: Arg hashes not raw args (arg leakage into events must be bounded); redaction rules same as existing tool-call event redaction.
  - Approach:
    - Documentation Reviewed:
      - `src/agent-session/session/provider-round.ts` `activeLimits.charge` call sites; `docs/runs-and-usage.md`.
    - Options Considered:
      - Hosts derive from timeline: rejected — that is exactly the synapta P02 duplication this plan deletes.
      - Emit on every limit warning: rejected — noisy; only terminal exhaustion.
    - Chosen Approach: Terminal-only event from single rejection seam.
    - Execution Notes (2026-09-18):
      - The variant lives in the `AgentEvent` union in `src/contracts-protocol.ts` (there is no
        `contracts-core/events.ts`); its supporting contracts `ToolCallSummary`, `BudgetAxisUsage`,
        and `BudgetConsumedCounters` sit with `RunLimitBreach` in `src/contracts-core/run-limits.ts`.
        Fields are flat (`limit`, `consumed`, `closestOtherAxes`, `recentToolCalls`) as the acceptance
        spells them, and `limit`/`axis` reuse `RunLimitName`, so hosts switch on the same vocabulary
        as `run_limit_exceeded`.
      - Emission is at the single rejection seam in `executeRun`'s catch (`assemble.ts`), where
        `breach` is resolved from `RunLimitError` or `limits.breach` — not in `provider-round.ts`,
        which is where charges happen, not where a run dies. It is emitted *before* the terminal
        `error` event so a subscriber that stops at the first terminal event still sees the
        attribution.
      - `describeBudgetExhaustion(tracker, breach, recentToolCalls)` in `src/run-limits.ts` builds the
        payload: `consumed` is turns/inputTokens/providerAttempts/requestBytes from `snapshot()`;
        `closestOtherAxes` is the three other finite product axes with the highest `used / cap`
        (clamped to `[0, 1]`, 4-decimal rounded) — request/response bytes stay out because their caps
        are per-frame and a run-lifetime ratio would be meaningless; `recentToolCalls` is copied.
      - Ring buffer: `session.activeRecentToolCalls` (initialized at run start beside `activeLimits`,
        cleared in `cleanupRun`), pushed by `bindDispatchToolCall` exactly where `ctx.toolCalls` is
        charged, capped at 10. `argHash` is `sha256:` + `toolEffectArgumentsHash(call.arguments)` — the
        canonical-args hash the effect store already uses — so raw arguments never enter the event.
        It is in-run only: reset at run start and after a durable resume, and a nested run has its own
        session and ring.
      - Export budget rebaselined 1381 → 1385 (+4: three contracts + `describeBudgetExhaustion`, an
        internal helper not re-exported from the root barrel); `docs/_evidence/phase54-package-map.md`
        regenerated again.
    - API Notes and Examples:
      ```ts
      { type: "budget_exhausted", limit: "maxTurns",
        consumed: { turns: 40, inputTokens: 388_100 },
        closestOtherAxes: [{ axis: "runInputBudget", usedRatio: 0.78 }],
        recentToolCalls: [{ name: "searchCodebase", id: "tc_91", argHash: "sha256:9f.." }] }
      ```
    - Files to Create/Edit:
      - `src/contracts-core/run-limits.ts`: `ToolCallSummary`, `BudgetAxisUsage`, `BudgetConsumedCounters`. **Done**
      - `src/contracts-protocol.ts`: `budget_exhausted` variant in `AgentEvent`. **Done**
      - `src/run-limits.ts`: `describeBudgetExhaustion` payload builder. **Done**
      - `src/agent-session/session/assemble.ts`: emission at the rejection seam; ring init. **Done**
      - `src/agent-session/session/tool-round.ts` + `session.ts`/`types.ts`/`persist.ts`: ring buffer. **Done**
    - References: synapta F9 diagnosis needs; OrchestraBench failure-attribution framing.
  - Test Cases to Write:
    - maxTurns death: event fired once, correct consumed counts, ring buffer = last 10 calls.
    - run-input-budget death (via plan 086 axis): axis named correctly.
    - Normal completion: no `budget_exhausted`.
    - Arg redaction: secrets in args never appear (hash only).
  - Test Status: **written and passing** — added to the existing `src/__tests__/run-limits.test.ts`:
    a maxTurns death (13 charged turns, 12 dispatches, ring = last 10 in order, ratios 0.6/0.6/0.5,
    event ordered before `error`), a run-input-budget death (`maxInputTokens` named, 12/10 tokens,
    secret args absent and `argHash` hash-only), and the existing normal-completion test now also
    asserts no `budget_exhausted`. `npm test` (all 6 stages), `npm run typecheck`, `npm run lint`, and
    `npm run format:check` pass.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new event.
    - Docs pages to create/edit: `docs/agent-events.md` (new "Run limit events" section + group row,
      which also documents the previously unlisted `run_limit_exceeded`); `docs/runs-and-usage.md`
      (breach paragraph now names the attribution event). **Done**
    - `docs/execution-timeline.md` attribution projection is Task 3 by design: the timeline ignores
      the new event until then, exactly as it already ignores `run_limit_exceeded`.
    - `docs/index.md` update: no — existing pages.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: ExecutionTimeline projection of stop reasons + attribution
  - Acceptance Criteria:
    - Functional: `projectTraceTimeline` renders per-turn stop reason badges and a terminal attribution block; `summarizeTimeline` includes exhausted-limit summary line.
    - Performance: Projection unchanged asymptotically; timeline rendering tests updated without new fixtures explosion.
    - Code Quality: Reuses timeline-types extension points; no bespoke rendering path.
    - Security: Timeline packs already governed by transcript-data-only contract; no new content classes.
  - Approach:
    - Documentation Reviewed: `packages/prism-core/src/governance/observability/timeline.ts`, `timeline-types.ts`, `docs/execution-timeline.md`.
    - Options Considered: Host-side projection — rejected (deletes P02 only if prism ships it).
    - Chosen Approach: First-class fields in existing projection.
    - Execution Notes (2026-09-18):
      - Shape: `ExecutionTimeline.turns?: readonly TimelineTurn[]` and `ExecutionTimeline.exhaustion?:
        TimelineExhaustion` (both in `timeline-types.ts`, exported from the observability barrel).
        `TimelineTurn` = turn number, status, timing, `providerAttempts`, `stopReason`;
        `TimelineExhaustion` = `limit`, `maximum`, `observed`, `currency`, `consumed`,
        `closestOtherAxes`, `recentToolCalls`. Both are omitted (not empty) when absent, so timelines
        for runs and workflows that never hit a limit stay byte-identical.
      - `turns` is derived in `buildTimeline` from the already-folded steps in one pass (`projectTurns`,
        O(steps), no extra fold state): provider steps with `parentId === turn step id` count attempts
        and the last one's reason wins. The same reason also rides the provider step metadata
        (`metadata.stopReason`, written on `provider_turn_finished`), so a flat renderer can badge
        attempts without walking `turns`.
      - `exhaustion` joins the two Task 2 events: `run_limit_exceeded` contributes
        `maximum`/`observed`/`currency`, `budget_exhausted` contributes `consumed`/axes/ring — the
        line can therefore read `13/12`, and a trace that recorded only the breach still projects a
        partial block (`consumed` absent, axes empty). `run_limit_exceeded` left the timeline's
        ignore list for this; `budget_exhausted` is folded explicitly rather than falling through
        `default`.
      - `summarizeTimeline()` gained `exhaustion?: string`, one renderable line
        (`"maxTurns exhausted (13/12); closest: maxToolCalls 0.625, maxInputTokens 0.4"`); structured
        data stays on `timeline.exhaustion`, and `summarizeSession()` keeps each run's line in `runs`.
      - Deviation: the plan listed `score.ts`; the aggregation lives in `summary.ts`
        (`summarizeTimeline`/`summarizeSession`), which is the file edited. `prism-core` declared
        exports 1281 → 1283 (+2 types); `docs/_evidence/phase54-package-map.md` and
        `scripts/package-truth.json` regenerated. No `scripts/budgets.json` row changed: the
        `packages/prism-core/src` row measures the package's public surface, which this does not move.
      - Test Status: **written and passing** — three tests appended to
        `packages/prism-core/src/governance/observability/__tests__/timeline.test.ts`: taxonomy badge
        coverage over all seven `ProviderStopReason` members (turn + provider step, live fold),
        a retried turn (2 attempts, last reason wins), and a `projectTraceTimeline` golden fold of a
        `maxTurns` death asserting the whole attribution block (`deepStrictEqual`, no fixture file),
        the summary line, and that a natural end carries neither field. `npm test` (all 6 stages),
        `npm run typecheck`, `npm run lint`, `npm run format:check` pass.
    - API Notes and Examples:
      ```ts
      const timeline = projectTraceTimeline(trace); // timeline.turns[i].stopReason; timeline.exhaustion
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/governance/observability/timeline-types.ts`: `TimelineTurn`,
        `TimelineExhaustion`, two optional `ExecutionTimeline` fields. **Done**
      - `packages/prism-core/src/governance/observability/timeline.ts`: fold `run_limit_exceeded` +
        `budget_exhausted`, provider-step `stopReason`, `projectTurns`/`projectExhaustion`. **Done**
      - `packages/prism-core/src/governance/observability/summary.ts` (plan said `score.ts`):
        `TimelineSummary.exhaustion` line. **Done**
      - `packages/prism-core/src/governance/observability/index.ts`: export the two new types. **Done**
    - References: synapta P02 artifact shape.
  - Test Cases to Write:
    - Golden timeline: run that dies on maxTurns renders attribution block (snapshot test).
    - Stop-reason badge coverage for each taxonomy member.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — timeline output shape.
    - Docs pages to create/edit: `docs/execution-timeline.md` (`TimelineTurn`/`TimelineExhaustion`
      shapes, per-turn badge + attribution example, summary line), `docs/observability.md`
      (`provider_turn_finished` row, `TimelineSummary` example), `docs/agent-events.md` cross-link. **Done**
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Live event sources still treat `run_limit_exceeded` as a terminal record (`isTerminal` in
  `src/agent-event-source.ts` plus the NATS/Postgres/durable sources, predating this plan), so a
  subscriber that stops at the first terminal event can miss the following `budget_exhausted` and
  `error` records. The durable trace/timeline path this plan targets reads the full ledger, so the
  artifact is complete; changing the terminal sets touches four packages and their stream-end tests
  and was left as a follow-up.
- `closestOtherAxes` excludes the per-frame request/response byte axes: their caps are per-frame, so a
  run-lifetime `used / cap` ratio would be meaningless.
- `recentToolCalls` is in-run only (reset at run start and after a durable resume) and capped at 10;
  nested runs report their own calls, and only `sha256:` argument hashes ever leave the runtime.
- Per-turn budget snapshots are not projected onto `TimelineTurn`; the timeline carries the stop
  reason per turn and the budget state at exhaustion, which is what the P02 artifact needs.

## Further Actions
- P2 — **Placed: plan 100 Task 1.** Live event sources treated `run_limit_exceeded` as a terminal
  record (`isTerminal` in `src/agent-event-source.ts`, the NATS and Postgres sources, and AG-UI
  replay), so a subscriber that stops at the first terminal event could end one record early and miss
  this plan's `budget_exhausted` and the terminal `error`. Plan 100 replaces the divergent copies with
  one exported predicate (`agent_finished` / `agent_denied` / `error`), asserts the delivery order in
  the source conformance runner, and lands before the 0.9.0 cut — plan 099 now ships 086–098 + 100.
- P3 — **Placed: plan 088 Task 3.** Per-turn budget projection onto `TimelineTurn` (the data already
  rides `provider_turn_finished.metadata.budgets`). 088 already plans `timeline.turns[n].cacheHitRate`
  in the same fold-and-freeze projection, so `budgets` rides that task instead of a new one.
- P3 — Host-side only, not placed: deleting the synapta P02 instrument and asserting the P02 answers
  come from `provider_turn_finished.metadata` + `budget_exhausted`/`timeline.exhaustion` is work in the
  host repo, which prism plans cannot task. Prism's side is done (Tasks 1–3); the host check rides
  synapta's 0.9.0 pin, which plan 099 records in its Expected Outcome.
