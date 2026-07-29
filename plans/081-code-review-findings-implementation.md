# Plan 081 — Code Review Findings Implementation (2026-07-29 review)

## Objectives
- Fix all defects found in `code-reviews/2026-07-29-full-implementation-review.md` in the recommended priority order.
- Close the identified gaps with the smallest correct diffs; no new abstractions.
- Keep every public-contract change matched by a `/docs` update per the Prism wiki requirements.

## Expected Outcome
- Findings A1–A6, B1–B5, C1–C8 from the review are resolved or explicitly narrowed-by-contract, with regression tests.
- `npm run build` and the full core test suite pass; durable-run, guardrail, retry, and input-assembly behavior changes are covered by new tests.
- Docs pages touched by behavior changes are updated; `docs/index.md` gains entries only where new pages are added.

## Tasks

- [x] Task 1 — Fix durable run-state save/load byte-limit mismatch (review A1)
  - Acceptance Criteria:
    - Functional: a run suspended with `maxStateBytes` up to `HARD_MAX_AGENT_RUN_STATE_BYTES` (1 MB) resumes successfully; load still rejects state above the hard cap.
    - Performance: no extra serialization passes; `parseAgentRunState` stays O(bytes).
    - Code Quality: single bound constant source; no duplicated literals between save and load paths.
    - Security: load remains bounded (no unbounded state parse); oversized records still throw `AgentRunStateError`.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-session-runtime.md` (durable run state section)
      - `code-reviews/2026-07-29-full-implementation-review.md` §A1
    - Options Considered:
      - Thread configured `maxStateBytes` through resume options — precise but threads config through three layers.
      - Bound load with `HARD_MAX_AGENT_RUN_STATE_BYTES` — one-line; load bound is a DoS guard, not policy.
    - Chosen Approach:
      - Bound on load with the hard cap. The save-side configured cap remains the policy knob; load only needs the DoS ceiling.
    - API Notes and Examples:
      ```ts
      // src/agent-run-state.ts
      return boundState({ ...state, version } as StoredAgentRunState, HARD_MAX_AGENT_RUN_STATE_BYTES);
      ```
    - Files to Edit:
      - `src/agent-run-state.ts`: use `HARD_MAX_AGENT_RUN_STATE_BYTES` in `parseAgentRunState`.
      - `src/__tests__/agent-run-state.test.ts`: add regression test.
      - Done (2026-07-29): also edited `docs/agent-session-runtime.md` (save/load bound semantics) and bumped the numbered-plan drift guard in `src/__tests__/docs.test.ts` (81 → 82, plan 081 added).
    - References:
      - `code-reviews/2026-07-29-full-implementation-review.md` §A1
  - Test Cases to Write:
    - save at 300 KB with `maxStateBytes: 1 MB` then `loadAgentRunState` → succeeds.
    - parse of state > 1 MB → `AgentRunStateError`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — previously-failing resumes now succeed; documented limit semantics change.
    - Docs pages to create/edit:
      - `docs/agent-session-runtime.md`: state that load bounds against the hard cap, save bounds against configured `maxStateBytes`.
    - `docs/index.md` update: no — existing page edited.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 2 — Fix resumed durable run + input guardrail `interrupt` dead-end (review A2)
  - Note (2026-07-29): on re-read, the dead-end did not exist — the old branch silently treated resume as approval for durable input interrupts (the review misread the nested `if`). Work done: rewrote the branch in `src/agents.ts` as an explicit decision table (`approvedByResume`), added the two planned regression tests (resume-as-approval completes; block-on-resume rejects with `AgentRunError` caused by `GuardrailError`), and documented resume-as-approval in `docs/guardrails.md`. No runtime behavior change.
  - Acceptance Criteria:
    - Functional: resuming a durable run whose stored input still trips an `interrupt` input guardrail proceeds (the resume decision is the approval); `block`/`tripwire` on resume still fail.
    - Performance: none — control-flow only.
    - Code Quality: the input-guardrail block in `runInternal` reads as one explicit decision table (fresh vs resumed × action).
    - Security: only `interrupt` semantics change on resume; `block`/`tripwire` remain fail-closed.
  - Approach:
    - Documentation Reviewed:
      - `docs/guardrails.md`, `docs/agent-session-runtime.md`
      - `code-reviews/2026-07-29-full-implementation-review.md` §A2
    - Options Considered:
      - Re-suspend on resume — creates an infinite suspend/resume loop; rejected in review.
      - Treat resume as approval: skip the interrupt conversion when `resumed`, run `assertGuardrailsAllowed` for all other terminals.
    - Chosen Approach:
      - Resume-as-approval; matches `resumeAgentRun` operator-decision semantics.
    - API Notes and Examples:
      ```ts
      if (inputGuardrails.terminal?.action === "interrupt" && this.activeDurable && !resumed) {
        // suspend
      } else if (inputGuardrails.terminal && !(resumed && inputGuardrails.terminal.action === "interrupt")) {
        assertGuardrailsAllowed(inputGuardrails);
      }
      ```
    - Files to Edit:
      - `src/agents.ts`: `runInternal` input-guardrail branch.
      - `src/__tests__/agent-run-state.test.ts`: regression tests.
      - `docs/guardrails.md`: resume-as-approval semantics.
    - References:
      - `code-reviews/2026-07-29-full-implementation-review.md` §A2
  - Test Cases to Write:
    - durable run, input guardrail `interrupt`: suspend → resume → run completes (guardrail still returns `interrupt`).
    - same setup with `block`: resume → `GuardrailError`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — resume semantics of `interrupt` guardrails.
    - Docs pages to create/edit:
      - `docs/guardrails.md`: document that a durable resume counts as approval for input-stage `interrupt`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 3 — Apply `input_assembly` middleware unconditionally in `assembleProviderInput` (review B2)
  - Acceptance Criteria:
    - Functional: `input_assembly` middleware runs for both budget and non-budget paths regardless of which `InputBuilder` is installed.
    - Performance: middleware runs exactly once per assembly (no double-run when the default builder is used).
    - Code Quality: middleware application lives in exactly one place (`assembleProviderInput`).
    - Security: host middleware (PII stripping, policy injection) can no longer be bypassed by a custom builder.
  - Approach:
    - Documentation Reviewed:
      - `docs/input-and-prompt-assembly.md`, `docs/middleware-hooks.md`
      - `code-reviews/2026-07-29-full-implementation-review.md` §B2
    - Options Considered:
      - Require `InputBuilder` contract to honor middleware — unenforceable, silently skippable.
      - Move `middleware.run("input_assembly", …)` from `createDefaultInputBuilder` into `assembleProviderInput` after `build`.
    - Chosen Approach:
      - Runtime applies middleware; builders stop being a security seam.
    - API Notes and Examples:
      ```ts
      // src/input.ts — after inputBuilder.build(...)
      assembled = await runInputAssemblyMiddleware(context.middleware, assembled);
      ```
    - Files to Edit:
      - `src/input.ts`: move middleware invocation; remove from default builder.
      - `src/__tests__/input-pipeline.test.ts`: custom-builder regression test.
      - Done (2026-07-29): also updated `docs/input-and-prompt-assembly.md` and `docs/middleware-hooks.md`; replaced the stale "middleware only when supplied" builder test with assembler-ownership tests (non-budget custom builder + budget path, exactly-once each).
    - References:
      - `code-reviews/2026-07-29-full-implementation-review.md` §B2
  - Test Cases to Write:
    - custom `InputBuilder` that ignores `context.middleware` → registered `input_assembly` middleware still transforms messages.
    - default builder path → middleware runs exactly once (assert call count).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `InputBuilder` contract no longer responsible for middleware.
    - Docs pages to create/edit:
      - `docs/input-and-prompt-assembly.md`: middleware is runtime-applied.
      - `docs/middleware-hooks.md`: note guaranteed application point.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 4 — Memory session store: reject cross-session `expectedParentId` (review A5)
  - Note (2026-07-29): documented in `docs/session-stores.md` (the page covering `createMemorySessionStore`) instead of `docs/node-jsonl-session-store.md`.
  - Acceptance Criteria:
    - Functional: `add` with `expectedParentId` whose entry belongs to a different session throws `SessionAppendConflictError` (or `SessionStoreError`) at write time.
    - Performance: one extra map lookup per validated append.
    - Code Quality: validation message names the cross-session case.
    - Security: store can no longer persist a write it cannot read back.
  - Approach:
    - Documentation Reviewed:
      - `docs/node-jsonl-session-store.md`, `docs/database-persistence.md`
      - `code-reviews/2026-07-29-full-implementation-review.md` §A5
    - Options Considered:
      - Leave to callers — every caller must rediscover the invariant.
      - Validate session match in `createMemorySessionStore.add`.
    - Chosen Approach:
      - Fail fast at append; mirrors structural enforcement in SQL stores.
    - API Notes and Examples:
      ```ts
      const parent = byId.get(options.expectedParentId);
      if (!parent || parent.sessionId !== entry.sessionId) { throw conflict; }
      ```
    - Files to Edit:
      - `src/session-stores.ts`: `createMemorySessionStore.add` parent validation.
      - `src/__tests__/session-stores.test.ts`: cross-session parent test.
      - `docs/session-stores.md`: same-session parent invariant.
    - References:
      - `code-reviews/2026-07-29-full-implementation-review.md` §A5
  - Test Cases to Write:
    - append to session B parented at session A entry → conflict error; `list(B)` unaffected.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — stricter `SessionStore` write validation (reference impl).
    - Docs pages to create/edit:
      - `docs/node-jsonl-session-store.md`: note same-session parent invariant.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 5 — Retry policy: jitter and `Retry-After` honoring (review B1)
  - Note (2026-07-29): `ErrorInfo` gained an explicit `retryAfterMs` field (no metadata map needed); `errorToErrorInfo` passes it through from error objects. New `httpStatusError()`/`parseRetryAfterMs()` helpers in `src/providers/transport.ts` wire status-as-`code` + `Retry-After` parsing into provider-anthropic, provider-google, provider-kimi, provider-openai (responses), provider-opencode-go, and the shared `openai-compatible` client (covers alibaba/kimi-moonshot/ollama). Side benefit: numeric HTTP status now flows into `ErrorInfo.code`, fixing transient classification for bare `429`/`5xx` failures.
  - Acceptance Criteria:
    - Functional: backoff delays include ±25–50% jitter; when `context.error` metadata carries a numeric `retryAfterMs`, `decide` uses it capped at `maxDelayMs`.
    - Performance: none measurable.
    - Code Quality: jitter uses an injectable random source (default `Math.random`) for testability, matching `packages/evals/src/util.ts` pattern.
    - Security: `retryAfterMs` clamped to `maxDelayMs` — a hostile/huge hint cannot pin a run.
  - Approach:
    - Documentation Reviewed:
      - `docs/compaction-and-retry.md`
      - `code-reviews/2026-07-29-full-implementation-review.md` §B1
    - Options Considered:
      - Full `Retry-After` HTTP-date parsing in core — provider packages own HTTP parsing; core reads a numeric hint.
      - Core: jitter + `retryAfterMs` hint; providers populate the hint from response headers.
    - Chosen Approach:
      - Numeric hint keeps core provider-agnostic; provider packages map headers in their error info (follow-up wiring in the OpenAI/Anthropic error paths where error info is already built).
    - API Notes and Examples:
      ```ts
      const hinted = retryAfterMs(context.error);
      const base = Math.min(hinted ?? baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const delayMs = base * (1 - jitter + random() * 2 * jitter);
      ```
    - Files to Edit:
      - `src/retry.ts`: jitter + hint in `createDefaultRetryPolicy`.
      - `src/contracts.ts`: `ErrorInfo.retryAfterMs`.
      - `src/redaction.ts`: `errorToErrorInfo` hint pass-through.
      - `src/providers/transport.ts`: `httpStatusError` + `parseRetryAfterMs`.
      - `src/providers/openai-compatible.ts`, `packages/provider-{anthropic,google,kimi,openai,opencode-go}/src/*.ts`: wired.
      - `src/__tests__/retry.test.ts`, `src/__tests__/provider-transport.test.ts`, `packages/provider-openai/src/__tests__/openai.test.ts`: tests.
      - `docs/compaction-and-retry.md`: jitter + hint contract.
    - References:
      - `code-reviews/2026-07-29-full-implementation-review.md` §B1
  - Test Cases to Write:
    - delays across attempts stay within jitter bounds; deterministic with injected random.
    - error metadata `retryAfterMs: 5000` → delay 5000 (capped at max).
    - `retryAfterMs` above `maxDelayMs` → clamped.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — default retry timing behavior; new error-metadata hint key.
    - Docs pages to create/edit:
      - `docs/compaction-and-retry.md`: document jitter and the `retryAfterMs` hint contract.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 6 — Context budget: incremental eviction accounting (review C1)
  - Note (2026-07-29): measure once, subtract each drop's own estimate (same estimators → exact). No doc update needed — perf-only, eviction order/report semantics unchanged. Regression test re-runs `applyContextBudget` on surviving content and asserts identical kept totals with zero new omissions.
  - Acceptance Criteria:
    - Functional: identical eviction results and omission records as today (pure optimization).
    - Performance: eviction is O(n + k) text encodings instead of O(n·k); measure with a synthetic long-history budget test.
    - Code Quality: per-item estimates computed once and reused; no behavior flags.
    - Security: unchanged bounds (`HARD_MAX_*`) still enforced.
  - Approach:
    - Documentation Reviewed:
      - `docs/input-and-prompt-assembly.md` (context budget section), `docs/performance.md`
      - `code-reviews/2026-07-29-full-implementation-review.md` §C1
    - Options Considered:
      - Precompute per-omission costs and decrement running totals.
      - Keep re-measuring (rejected: quadratic on the common tight-budget path).
    - Chosen Approach:
      - Compute totals once; each `dropNext` returns the dropped item's `tokenEstimate`/`byteLength`; subtract.
    - API Notes and Examples:
      ```ts
      let { totalTokens, totalBytes } = measureOnce(...);
      while (overBudget) { const drop = dropNext(...); totalTokens -= drop.tokenEstimate; totalBytes -= drop.byteLength; ... }
      ```
    - Files to Edit:
      - `src/context-budget.ts`: `applyContextBudget` loop.
      - `src/__tests__/context-budget.test.ts`: accounting-consistency regression test.
    - References:
      - `code-reviews/2026-07-29-full-implementation-review.md` §C1
  - Test Cases to Write:
    - eviction parity: fixed history + budget produces identical omissions before/after (snapshot existing behavior first).
    - large history (e.g. 5k messages) tight budget completes without pathological time.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — internal optimization, identical outputs.
    - Docs pages to create/edit:
      - `none`: no public behavior change; optionally note complexity in `docs/performance.md` only if that page lists algorithmic costs.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Task 7 — Agent fingerprint: include instructions and skills (review A3)
  - Note (2026-07-29): fingerprint now also hashes `instructions`, system-prompt contributions (id+text), and skills (name/instructions/toolNames, registry or array). Tests cover stability, revision bump, and instructions/skill/systemPrompt changes.
  - Acceptance Criteria:
    - Functional: `agentFingerprint` hashes composed `instructions`/system prompt and skill names; changing either without a `definitionRevision` bump now fails resume with `AgentRunStateError`.
    - Performance: hashing cost is per-fingerprint-call (suspend/resume only) — negligible.
    - Code Quality: fingerprint construction documented in one comment listing covered fields.
    - Security: resume-time definition guard becomes fail-closed for behavior-defining config.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-session-runtime.md`
      - `code-reviews/2026-07-29-full-implementation-review.md` §A3
    - Options Considered:
      - Document "bump revision on instruction change" only — relies on host discipline; the fingerprint exists precisely for this.
      - Extend fingerprint with instructions + skill names.
    - Chosen Approach:
      - Extend fingerprint; fail-closed by construction. Note: this invalidates pre-change suspended runs (acceptable pre-1.0; recorded in Compromises).
    - API Notes and Examples:
      ```ts
      canonicalize({ id, revision, model, instructions, skills: skills?.map(s => s.name), tools: [...], guardrails: [...], loop });
      ```
    - Files to Edit:
      - `src/agent-run-state.ts`: `agentFingerprint`.
      - `src/__tests__/agent-run-state.test.ts`: fingerprint coverage tests.
      - `docs/agent-session-runtime.md`: enumerated fingerprint contents.
    - References:
      - `code-reviews/2026-07-29-full-implementation-review.md` §A3
  - Test Cases to Write:
    - same config, different `instructions` → different fingerprint → resume rejected.
    - unchanged config → fingerprint stable.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — resume acceptance criteria.
    - Docs pages to create/edit:
      - `docs/agent-session-runtime.md`: list fingerprint-covered fields including instructions/skills.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 8 — Guardrail `interrupt` support matrix: document and narrow by stage (review A4)
  - Note (2026-07-29): no behavior change — `GuardrailError` message now names the stage (`stage "tool_input"` etc.) and states where interrupt is supported; `docs/guardrails.md` gained the per-stage action outcome matrix. Full interrupt-at-any-stage remains in Further Actions.
  - Acceptance Criteria:
    - Functional: no runtime change in this task; the contract explicitly documents which stages support `interrupt`, and `docs/guardrails.md` carries the matrix.
    - Performance: n/a.
    - Code Quality: `GuardrailError` message already names unavailability; add the stage to the error message for diagnosability.
    - Security: unchanged fail-closed behavior; hosts no longer surprised at runtime.
  - Approach:
    - Documentation Reviewed:
      - `docs/guardrails.md`
      - `code-reviews/2026-07-29-full-implementation-review.md` §A4
    - Options Considered:
      - Route tool/output-stage interrupts through `suspendDurable` — real feature, needs interruption-record plumbing per stage; deferred (recorded in Further Actions).
      - Document the support matrix + improve error message now.
    - Chosen Approach:
      - Document + diagnose now; full interrupt-at-any-stage is a separate feature task deferred to a later plan (pre-1.0 surface freeze per `docs/0.1.0-readiness.md`).
    - API Notes and Examples:
      ```ts
      throw new GuardrailError(`Guardrail interruption is unavailable at stage "${stage}"; supported: input (durable runs), beforeExecute`);
      ```
    - Files to Edit:
      - `src/guardrails.ts`: `GuardrailError` message includes stage.
      - `src/__tests__/guardrails.test.ts`: interrupt at `tool_input` names the stage.
      - `docs/guardrails.md`: per-stage action support matrix.
    - References:
      - `code-reviews/2026-07-29-full-implementation-review.md` §A4, `docs/0.1.0-readiness.md`
  - Test Cases to Write:
    - interrupt at `tool_input` → `GuardrailError` message names the stage.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documented contract narrowing (no code behavior change).
    - Docs pages to create/edit:
      - `docs/guardrails.md`: support matrix table.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 9 — Blocked steer message: drop + event instead of failing the run (review A6)
  - Note (2026-07-29): `steer_rejected` event added (redacted message + `GuardrailRecord`); `applyPendingSteers` drops blocked/tripwire steered messages and continues; `interrupt` on steer still fails closed (durable suspend is run-start-only); run-start input blocking unchanged. Docs: `docs/agent-events.md` payload row, `docs/agent-session-runtime.md` steer semantics, `docs/guardrails.md` matrix input row steer caveat.
  - Acceptance Criteria:
    - Functional: a `block`/`tripwire` guardrail on a steered message drops that message, emits `guardrail_decision` plus a `steer_rejected` agent event, and the run continues; run-start input blocking is unchanged.
    - Performance: none.
    - Code Quality: `applyPendingSteers` handles terminal guardrails in one place; no new config surface.
    - Security: guardrail decision still enforced (message never enters history); only blast radius changes.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-events.md`, `docs/guardrails.md`, `docs/agent-session-runtime.md`
      - `code-reviews/2026-07-29-full-implementation-review.md` §A6
    - Options Considered:
      - Keep fail-the-run (documented) — review judged the blast radius wrong for mid-run input.
      - Drop + event.
    - Chosen Approach:
      - Drop + event; new `steer_rejected` event type added to `AgentEvent` union.
    - API Notes and Examples:
      ```ts
      type: "steer_rejected", runId, message (redacted), decision: GuardrailDecisionRecord
      ```
    - Files to Edit:
      - `src/contracts.ts`: `steer_rejected` event variant.
      - `src/agents.ts`: `applyPendingSteers` terminal-guardrail handling.
      - `src/__tests__/agents.test.ts`: blocked-steer drop test.
      - `docs/agent-events.md`, `docs/agent-session-runtime.md`, `docs/guardrails.md`: docs.
    - References:
      - `code-reviews/2026-07-29-full-implementation-review.md` §A6
  - Test Cases to Write:
    - steer blocked mid-run → `steer_rejected` emitted, run completes, message absent from history.
    - run-start input block → run still fails (unchanged).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new agent event type; changed steer-guardrail behavior.
    - Docs pages to create/edit:
      - `docs/agent-events.md`: `steer_rejected` payload.
      - `docs/guardrails.md`: steer-stage semantics.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 10 — Middleware: detect double-`next()` and next+return misuse (review B3)
  - Note (2026-07-29): asymmetric enforcement per plan — double-`next()` throws (through `errorPolicy`), `next(v)` + conflicting return diagnosed via `onError` with the `next()` value winning; `return next(v)` stays silent. Errors name hook + middleware index.
  - Acceptance Criteria:
    - Functional: calling `next()` twice in one middleware throws; calling `next(v)` and returning a different value routes a diagnostic to `onError`.
    - Performance: one flag + one comparison per middleware invocation.
    - Code Quality: misuse errors name hook and middleware index.
    - Security: closes silent policy-transform bypass class in host middleware.
  - Approach:
    - Documentation Reviewed:
      - `docs/middleware-hooks.md`
      - `code-reviews/2026-07-29-full-implementation-review.md` §B3
    - Options Considered:
      - Throw on both — a returned value after `next` may be intentional in host code today; throwing breaks them.
      - Throw on double-`next`, report next+return via `onError`.
    - Chosen Approach:
      - Asymmetric: double-`next` is always a bug (throw); next+return is ambiguous (diagnose, keep behavior).
    - API Notes and Examples:
      ```ts
      let called = false;
      const next = async (v: V) => { if (called) throw new MiddlewareError(...); called = true; ... };
      ```
    - Files to Edit:
      - `src/middleware.ts`: `createMiddlewareRegistry.run` dispatch.
      - `src/__tests__/middleware.test.ts`: double-next + next+return tests.
      - `docs/middleware-hooks.md`: `next()` rules.
    - References:
      - `code-reviews/2026-07-29-full-implementation-review.md` §B3
  - Test Cases to Write:
    - double `next()` → throws with hook name.
    - `next(v)` + conflicting return → `onError` invoked, `next` value used.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — middleware contract enforcement.
    - Docs pages to create/edit:
      - `docs/middleware-hooks.md`: document `next()` rules.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 11 — Event multiplexer: consistent sorted delivery (review C4)
  - Note (2026-07-29): with `compare` set, `publish` always enqueues and wakes the parked consumer with a wake token; the generator drains via the sorted queue — single delivery path, comparator order guaranteed regardless of consumer position. No doc change (aligns code with documented `compare` semantics).
  - Acceptance Criteria:
    - Functional: with `compare` set, delivery order follows the comparator regardless of whether the consumer is parked; without `compare`, current behavior unchanged.
    - Performance: when `compare` is set, publish always enqueues (heap push) — same as the lagging-consumer path today.
    - Code Quality: single delivery path when sorting.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - `code-reviews/2026-07-29-full-implementation-review.md` §C4; `src/event-multiplexer.ts`
    - Options Considered:
      - Always enqueue when `compare` set; `subscribe` drains in order.
      - Sort the parked-waiter delivery (impossible — delivery is immediate).
    - Chosen Approach:
      - Always enqueue when `compare` set; waiter just wakes the generator.
    - API Notes and Examples:
      ```ts
      if (this.compare) { push(queue, event); this.waiter?.(); } else if (this.waiter) { ... direct }
      ```
    - Files to Edit:
      - `src/event-multiplexer.ts`: `publish` (always-enqueue + wake token when `compare` set) and `subscribe` (skip wake token).
      - `src/__tests__/checkpoint-event-primitives.test.ts`: parked-consumer sorted delivery test.
    - References:
      - `code-reviews/2026-07-29-full-implementation-review.md` §C4
  - Test Cases to Write:
    - out-of-order publishes with parked consumer + `compare` → delivered in comparator order.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — ordering guarantee now uniform (bug fix on documented `compare` semantics).
    - Docs pages to create/edit:
      - `none`: `compare` already documented as "delivery order"; fix aligns code with docs.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Task 12 — Guardrail failure records include bounded cause (review C5)
  - Note (2026-07-29): `guardrail_failed` records now carry `metadata.error` — the underlying error message, redacted first then bounded to `MAX_REASON_BYTES` (4 KiB), redact-before-bound order matching the `reason` path so redaction growth can't exceed the cap.
  - Acceptance Criteria:
    - Functional: `guardrail_failed` records carry metadata with the underlying error message, bounded to `MAX_REASON_BYTES` and redacted when a redactor is available at the call site.
    - Performance: one bounded string copy per failure.
    - Code Quality: reuse existing bound/redact helpers; no new types.
    - Security: message truncated + redacted — no secret leakage via diagnostics.
  - Approach:
    - Documentation Reviewed:
      - `docs/guardrails.md`
      - `code-reviews/2026-07-29-full-implementation-review.md` §C5
    - Options Considered:
      - Include full error object — unbounded, leaks internals.
      - Bounded redacted message in metadata.
    - Chosen Approach:
      - Bounded redacted message; matches `errorToErrorInfo` precedent.
    - API Notes and Examples:
      ```ts
      metadata: { error: boundReason(errorMessage(error)) }
      ```
    - Files to Edit:
      - `src/guardrails.ts`: `evaluate` catch path.
      - `src/__tests__/guardrails.test.ts`: bounded redacted cause test.
      - `docs/guardrails.md`: failure-record `metadata.error` documented.
    - References:
      - `code-reviews/2026-07-29-full-implementation-review.md` §C5
  - Test Cases to Write:
    - throwing guardrail → record metadata contains truncated message ≤ 4 KB.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — decision-record metadata shape for failures.
    - Docs pages to create/edit:
      - `docs/guardrails.md`: failure-record metadata field.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 13 — Batched run ledger: remove dead batch counters, document semantics (review C2)
  - Note (2026-07-29): dead intra-flush `entries`/`bytes` counters removed; kept peek-then-shift ordering so a failed write stays buffered for retry (caught by existing backpressure test). `BatchedRunLedgerOptions` doc comments now state maxBatch* bounds flush timing, not write coalescing. No md changes — no docs page described batching as coalescing.
  - Acceptance Criteria:
    - Functional: no behavior change; `maxBatchEntries`/`maxBatchBytes` still trigger flush scheduling.
    - Performance: none.
    - Code Quality: dead intra-flush counters removed; option docs state batching bounds flush *delay*, not write coalescing.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - `code-reviews/2026-07-29-full-implementation-review.md` §C2; `src/run-ledger.ts`
    - Options Considered:
      - Add `appendBatch` to `RunLedger` contract — contract churn for a capability no store needs yet (YAGNI).
      - Delete dead counters; document.
    - Chosen Approach:
      - Delete + document; batch append lands when a store actually wants coalescing.
    - API Notes and Examples:
      ```ts
      /** maxBatchEntries/maxBatchBytes bound when a pending flush fires, not per-write coalescing. */
      ```
    - Files to Edit:
      - `src/run-ledger.ts`: `flush` loop + option doc comments.
    - References:
      - `code-reviews/2026-07-29-full-implementation-review.md` §C2
  - Test Cases to Write:
    - none new — covered by existing ledger flush tests; verify they still pass.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — doc-comment clarification only.
    - Docs pages to create/edit:
      - `docs/observability.md`: one line on ledger batching semantics if batching is described there.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Task 14 — Memory checkpoint store: add record bound (review C6)
  - Note (2026-07-29): `maxRecords` (default 10,000) with delete+set recency ordering → O(1) eviction off Map front; `maxValueBytes` (default 1 MiB) rejects oversized JSON values with RangeError. Documented in `docs/public-contracts.md` CheckpointStore row.
  - Acceptance Criteria:
    - Functional: `createMemoryCheckpointStore({ maxRecords })` (default e.g. 10_000) evicts least-recently-updated records on overflow; `maxValueBytes` option bounds stored values.
    - Performance: Map insertion-order eviction is O(1).
    - Code Quality: options mirror existing bounded reference impls (memory session store caps).
    - Security: reference implementation no longer an unbounded-memory template.
  - Approach:
    - Documentation Reviewed:
      - `code-reviews/2026-07-29-full-implementation-review.md` §C6; `src/checkpoints.ts`
    - Options Considered:
      - Leave unbounded, document "not for production" — hosts copy code, not warnings.
      - Bound with LRU-by-updatedAt eviction.
    - Chosen Approach:
      - Bounded by default with overridable cap.
    - API Notes and Examples:
      ```ts
      createMemoryCheckpointStore({ maxRecords: 10_000, maxValueBytes: 1024 * 1024 })
      ```
    - Files to Edit:
      - `src/checkpoints.ts`: options + eviction.
      - `src/__tests__/checkpoint-event-primitives.test.ts`: eviction + oversized-value tests.
      - `docs/public-contracts.md`: bounds on the reference store.
    - References:
      - `code-reviews/2026-07-29-full-implementation-review.md` §C6
  - Test Cases to Write:
    - insert maxRecords+1 → oldest evicted; oversized value rejected.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new options + default bound on a public factory.
    - Docs pages to create/edit:
      - `docs/agent-session-runtime.md` or checkpoint docs page: bounds of the memory store.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 15 — Credential store: gate providerless fallback (review C7)
  - Note (2026-07-29): `createMemoryCredentialStore(records, { allowProviderFallback })` — default true (unchanged behavior), false = exact-match-only. Docs state the cross-provider implication of the default; default flip at 1.0 already in Further Actions.
  - Acceptance Criteria:
    - Functional: `createMemoryCredentialStore(records, { allowProviderFallback?: boolean })`; default keeps today's fallback (no breaking change), option makes resolution exact-match-only; the fallback is documented.
    - Performance: none.
    - Code Quality: one boolean option; no resolver-chain changes.
    - Security: hosts can opt into strict provider scoping; docs state the cross-provider implication of the default.
  - Approach:
    - Documentation Reviewed:
      - `docs/credentials-and-redaction.md`, `docs/credential-storage.md`
      - `code-reviews/2026-07-29-full-implementation-review.md` §C7
    - Options Considered:
      - Flip default to strict — breaks existing hosts relying on providerless defaults.
      - Opt-in strict flag + loud docs.
    - Chosen Approach:
      - Opt-in flag; flip default at 1.0 if desired (Further Actions).
    - API Notes and Examples:
      ```ts
      createMemoryCredentialStore(records, { allowProviderFallback: false })
      ```
    - Files to Edit:
      - `src/credentials.ts`: `createMemoryCredentialStore` + `MemoryCredentialStoreOptions`.
      - `src/__tests__/settings-security.test.ts`: lenient/strict fallback tests.
      - `docs/credentials-and-redaction.md`: fallback semantics + strict option.
    - References:
      - `code-reviews/2026-07-29-full-implementation-review.md` §C7
  - Test Cases to Write:
    - strict mode: providerless record not served for provider-scoped request.
    - default mode: fallback unchanged.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new option on public factory.
    - Docs pages to create/edit:
      - `docs/credentials-and-redaction.md`: fallback semantics + strict option.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 16 — Extension kernel: unregister + dispose handle (review B4)
  - Note (2026-07-29): `unregister` added to `ContributionRegistry` (key), `ProviderRegistry` (id), `ModelRegistry` (provider, model). Kernel API is now a per-extension tracked factory: `load` returns `LoadedExtension[]` (`{ name, dispose() }` — best-effort, idempotent, removes registry contributions + middleware/event subscriptions); a failed `setup` unwinds its partial registrations (fixes orphaned half-loads, review B4 secondary point). `LoadedExtension` exported; export-contract frozen list updated. Dependency graphs/ordering explicitly out of scope, documented in `docs/extensions.md`.
  - Acceptance Criteria:
    - Functional: contribution registries gain `unregister(name)`; `kernel.load` returns per-extension dispose handles that remove that extension's contributions.
    - Performance: none.
    - Code Quality: dispose is best-effort; load ordering/dependency graphs explicitly out of scope (documented).
    - Security: dispose does not unwind side effects outside registries — documented.
  - Approach:
    - Documentation Reviewed:
      - `docs/extensions.md`, `docs/contribution-registries.md`
      - `code-reviews/2026-07-29-full-implementation-review.md` §B4
    - Options Considered:
      - Full dependency graph + rollback — over-build for one known consumer (Gateway-style reload).
      - `unregister` + dispose handle.
    - Chosen Approach:
      - Minimal reload primitive; ordering stays array order.
    - API Notes and Examples:
      ```ts
      const handle = await kernel.load([ext]); // [{ name, dispose() }]
      await handle[0].dispose();
      ```
    - Files to Edit:
      - `src/contributions.ts`, `src/providers.ts`, `src/models.ts`: `unregister`.
      - `src/extensions.ts`: tracked API, dispose handles, unwind-on-failure.
      - `src/index.ts`, `src/__tests__/public-export-contract.test.ts`: `LoadedExtension` export.
      - `src/__tests__/extensions.test.ts`: dispose + unwind tests.
      - `docs/extensions.md`, `docs/contribution-registries.md`: semantics + non-goals.
    - References:
      - `code-reviews/2026-07-29-full-implementation-review.md` §B4
  - Test Cases to Write:
    - load ext, dispose, registry lookup → not found; other extensions unaffected.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new registry method + `load` return type.
    - Docs pages to create/edit:
      - `docs/extensions.md`: dispose semantics and non-goals.
      - `docs/contribution-registries.md`: `unregister`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 17 — CLI: reject inert flags until wired (review B5)
  - Note (2026-07-29): `--config`/`--resource`/`--extension`/`--tool` moved from `valueFlags` to a new `unsupportedFlags` set; parse throws `CliUsageError("<flag> is not supported in this build")`. Dead `config`/`resources`/`extensions`/`tools` fields removed from `CliOptions` and the usage text; `docs/cli-rpc.md` flag table rows removed and the no-auto-load paragraph now names the rejection. Wiring deferred to a CLI-harness plan (unchanged).
  - Acceptance Criteria:
    - Functional: `--config`, `--resource`, `--extension`, `--tool` produce a clear "not supported in this build" error instead of being silently recorded; usage text updated.
    - Performance: none.
    - Code Quality: flag table distinguishes parsed-and-active from parsed-and-rejected.
    - Security: fail-loud beats silently-different behavior.
  - Approach:
    - Documentation Reviewed:
      - `docs/cli-rpc.md`
      - `code-reviews/2026-07-29-full-implementation-review.md` §B5
    - Options Considered:
      - Wire the flags now — config/resource loading is its own feature (deferred).
      - Reject with clear error.
    - Chosen Approach:
      - Reject; wiring deferred to a CLI-harness plan.
    - API Notes and Examples:
      ```ts
      // parse: known-but-unsupported → error "--config is not supported in this build"
      ```
    - Files to Edit:
      - `src/cli-runner.ts`: `unsupportedFlags` set, parse rejection, `CliOptions` + usage cleanup.
      - `src/__tests__/cli.test.ts`: per-flag rejection test.
      - `docs/cli-rpc.md`: flag table + no-auto-load paragraph.
    - References:
      - `code-reviews/2026-07-29-full-implementation-review.md` §B5
  - Test Cases to Write:
    - each inert flag → non-zero exit with named error.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — CLI surface.
    - Docs pages to create/edit:
      - `docs/cli-rpc.md`: remove/mark the four flags as unsupported.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 18 — Prompt builder: tool-list text only for tool-incapable models (review C3)
  - Note (2026-07-29): `PromptBuildRequest` gains optional `model?: ModelConfig` (additive); `assembleProviderInput` passes `options.model`. Default prompt builder omits the `Available tools:` text when `model.capabilities.tools === true`, keeps it for false/undefined (fail-safe). Docs updated in `docs/input-and-prompt-assembly.md`.
  - Acceptance Criteria:
    - Functional: when `model.capabilities` declares tool support, the default prompt builder omits the `Available tools:` text message; text-only models keep it.
    - Performance: removes duplicated tool schema tokens from every turn for tool-capable providers.
    - Code Quality: capability check mirrors `modelSupportsStructuredOutput` pattern in `src/structured-output.ts`.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed:
      - `docs/input-and-prompt-assembly.md`, `docs/model-registry.md`
      - `code-reviews/2026-07-29-full-implementation-review.md` §C3
    - Options Considered:
      - Opt-in flag — another knob for a decision the model capability already answers.
      - Capability-driven omission.
    - Chosen Approach:
      - Capability-driven; unknown capability (undefined) keeps the text (fail-safe for text-only providers).
    - API Notes and Examples:
      ```ts
      if (request.model.capabilities?.tools === false || request.model.capabilities?.tools === undefined) { ...toolMessages }
      ```
    - Files to Edit:
      - `src/contracts.ts`: `PromptBuildRequest.model` (optional, additive).
      - `src/input.ts`: capability-conditional `toolMessages` + model pass-through.
      - `src/__tests__/input-pipeline.test.ts`: capable/incapable/unknown cases.
      - `docs/input-and-prompt-assembly.md`: capability-conditional tool listing.
    - References:
      - `code-reviews/2026-07-29-full-implementation-review.md` §C3
  - Test Cases to Write:
    - capable model → no tool text message; incapable/unknown → present.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — default prompt composition changes for capable models.
    - Docs pages to create/edit:
      - `docs/input-and-prompt-assembly.md`: document capability-conditional tool listing.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 19 — Nits bundle (review C8)
  - Note (2026-07-29): all six landed. (a) module-level `jsonTextEncoder`. (b) `stableMessageKey` (recursive sorted-key compare) replaces `JSON.stringify` equality; regression test uses a key-reordering store wrapper — required assistant entries in the fixture or compaction never triggers. (c) `MAX_REDACT_DEPTH = 32` → `"[MaxDepth]"` placeholder. (d) `replace(/\/+$/, "")` applied repo-wide (same nit in anthropic/google/kimi/azure/bedrock/alibaba providers, one sed — single logical hunk). (e) `ShellToolOptions.envAllowlist` via `pickSpawnEnv`; hook + child both see the scrubbed env; documented in `docs/coding-agent-tools.md`. (f) `getSessionBranchEntriesCore` takes an optional prebuilt index; `listSessionBranches` shares one index across leaves.
  - Acceptance Criteria:
    - Functional: no behavior change except item (b) which fixes a real dedupe miss.
    - Performance: (a) removes a per-call allocation on the byte-counting hot path.
    - Code Quality: each nit is its own commit-logical hunk; no opportunistic refactors.
    - Security: (c) adds a recursion-depth bound to the redactor (DoS hardening).
  - Approach:
    - Documentation Reviewed:
      - `code-reviews/2026-07-29-full-implementation-review.md` §C8
    - Options Considered:
      - Individual tasks — six one-line tasks is process overhead, not rigor.
      - One bundle task, itemized.
    - Chosen Approach:
      - Bundle; items:
        a. `src/agents.ts`: hoist `TextEncoder` out of `jsonBytes`.
        b. `src/agents.ts`: `withoutTrailingInput` — compare by entry id instead of `JSON.stringify`.
        c. `src/redaction.ts`: recursion-depth cap (32, matching `agent-run-state.ts`).
        d. `packages/provider-openai/src/responses.ts`: `replace(/\/+$/, "")` on base URL.
        e. `packages/coding-agent/src/shell.ts`: optional `envAllowlist` for the `spawnHook` environment clone (tentative — defer if it complicates the hook contract).
        f. `src/session-stores.ts`: memoized parent-map in `listSessionBranches` only if trivially local; otherwise skip.
    - API Notes and Examples:
      ```ts
      const textEncoder = new TextEncoder(); // module scope
      ```
    - Files to Edit (as landed):
      - `src/agents.ts` (a, b), `src/redaction.ts` (c), `src/session-stores.ts` (f).
      - `packages/provider-*/src/*.ts` + `src/providers/*` (d, repo-wide).
      - `packages/coding-agent/src/shell.ts` (e).
      - Tests: `src/__tests__/agents.test.ts` (b), `src/__tests__/credentials-redaction.test.ts` (c), `packages/coding-agent/src/__tests__/shell.test.ts` (e).
      - Docs: `docs/coding-agent-tools.md` (e).
    - References:
      - `code-reviews/2026-07-29-full-implementation-review.md` §C8
  - Test Cases to Write:
    - (b) trailing-input dedupe with reordered keys → no duplicate input after auto-compaction.
    - (c) redactor on >32-deep object → bounded placeholder, no stack overflow.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes only if (e) lands (new shell hook option).
    - Docs pages to create/edit:
      - `docs/coding-agent-tools.md`: `envAllowlist` note if (e) lands; otherwise `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` if (e) lands.

- [x] Task 20 — Final verification and docs sweep
  - Note (2026-07-29): `npm run build` clean; core suite 1287/1287 pass; workspace `npm test` 2322 pass / 0 fail (exit 0). All 20 tasks checked; every behavior-changing finding (durable-run, guardrail, credential, middleware, multiplexer, retry, prompt-builder, shell-env) has a named regression test. Docs sweep: 105 docs tests pass; per-task doc updates confirmed in `docs/agent-session-runtime.md`, `docs/guardrails.md`, `docs/input-and-prompt-assembly.md`, `docs/middleware-hooks.md`, `docs/agent-events.md`, `docs/session-stores.md`, `docs/compaction-and-retry.md`, `docs/public-contracts.md`, `docs/credentials-and-redaction.md`, `docs/extensions.md`, `docs/contribution-registries.md`, `docs/cli-rpc.md`, `docs/coding-agent-tools.md`.
  - Acceptance Criteria:
    - Functional: `npm run build` clean; full core suite green; `npm test` workspace tests green.
    - Performance: no regressions in context-budget or byte-counting paths (Tasks 6, 19a).
    - Code Quality: every checked task's listed tests exist and pass.
    - Security: durable-run, guardrail, credential, and middleware behavior changes each have a regression test.
  - Approach:
    - Documentation Reviewed:
      - this plan; `code-reviews/2026-07-29-full-implementation-review.md`
    - Options Considered:
      - n/a — verification task.
    - Chosen Approach:
      - Run build + core tests + workspace tests; grep each finding's section against the tree to confirm resolution; update this plan's checkboxes, Compromises, Further Actions.
    - API Notes and Examples:
      ```bash
      npm run build && node --test dist/__tests__/*.test.js && npm test
      ```
    - Files to Edit:
      - this plan file: checkboxes, Compromises Made, Further Actions.
    - References:
      - `code-reviews/2026-07-29-full-implementation-review.md`
  - Test Cases to Write:
    - none new — aggregate verification.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - `none`: sweep confirms per-task doc updates landed.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

## Compromises Made
- Task 2 (A2) required no runtime change: re-reading the branch structure showed durable resume was already implicit approval; work became making it explicit (`approvedByResume` + decision table) with regression tests.
- Task 8 (A4) narrows the `interrupt` contract by documentation (stage-named error + per-stage matrix) rather than implementing interrupt-at-any-stage (feature deferred, pre-1.0 surface freeze).
- Task 13 (C2) removed the dead batch counters instead of adding a `RunLedger.appendBatch` API (contract change for zero current consumers).
- Task 15 (C7) keeps the providerless credential fallback as the default (backward compatible); strict mode is opt-in, flip deferred to 1.0.
- Task 16 (B4) dispose is best-effort and registry-scoped; dependency graphs/load-order rollback explicitly out of scope.
- Task 17 (B5) rejects CLI flags rather than wiring them (wiring is a separate CLI-harness feature).
- Task 19 (d) applied the trailing-slash fix repo-wide (same nit in six other provider files) as one logical hunk rather than `responses.ts` only.

## Further Actions
- Guardrail `interrupt` at tool/output stages routed through durable suspension (feature, own plan).
- Wiring CLI `--config/--resource/--extension/--tool` (CLI harness plan).
- Flip `allowProviderFallback` default to strict at 1.0.
- `RunLedger.appendBatch` when a store wants real write coalescing.
- Extension dependency graphs / ordered unload if a second reload consumer appears (Task 16 note).
