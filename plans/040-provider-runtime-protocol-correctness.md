# Phase 39 — Provider/runtime protocol correctness

## Objectives
- Make provider stream handling, agent loops, compaction, and observational memory follow one end-to-end protocol.
- Remove or verify public knobs that currently look supported but may not be serialized by providers.
- Keep fixes generic: runtime/provider conformance first, package behavior second, docs with every public behavior change.

## Expected Outcome
- Tool-call deltas stream to subscribers, reconstruct into final tool calls, execute, persist, and replay through provider conformance fixtures.
- `generate-validate-revise` records first-turn input/history and emits normal turn events where it overlaps `single-shot`.
- `timeoutMs`, `maxRetries`, `maxRetryDelayMs`, and LLM compaction max-output settings are either tested as real provider behavior or removed/deprecated from docs.
- Observational-memory workers append through one owned session/store seam and replay provider-valid assistant tool-call transcripts before tool results.

## Tasks

- [x] Protocol primitive review and current-flow inventory
  - Acceptance Criteria:
    - Functional: Inventory existing provider/runtime primitives for `tool_call_delta`, `ProviderTurnResult`, `LoopContext`, retry/options, compaction provider requests, observational-memory appends, and worker transcript serialization before implementation.
    - Performance: Review avoids new buffering beyond per-message tool-call delta reconstruction; no long-session full scan introduced except existing `session.entries()` paths already in scope for later cleanup.
    - Code Quality: Reuses existing primitives (`src/testing/provider-conformance.ts`, `LoopContext`, `SessionStore`, `createSessionEntry`) unless a generic gap is proven.
    - Security: Confirms redaction path for provider events, retry errors, compaction prompts, and memory-worker prompts before adding tests.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 39.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
      - `docs/provider-conformance.md`.
      - `docs/agent-session-runtime.md`.
      - `docs/agent-loops.md`.
      - `docs/compaction-llm.md`.
      - `docs/compaction-observational-memory.md`.
      - `docs/provider-packages.md`.
    - Options Considered:
      - Add mode/package-specific fixes directly: smaller per bug, but repeats protocol logic.
      - Extend generic conformance/runtime helpers first: one shared check catches provider/package drift.
    - Chosen Approach:
      - Start with primitive inventory; only add generic helpers where existing helper behavior cannot express Phase 39 acceptance.
    - API Notes and Examples:
      ```ts
      import { assertToolCallDeltasReconstruct } from "@arnilo/prism/testing/provider-conformance";

      const calls = assertToolCallDeltasReconstruct(events, [
        { index: 0, id: "call_1", name: "lookup", arguments: { q: "prism" } },
      ]);
      ```
    - Files to Create/Edit:
      - `plans/040-provider-runtime-protocol-correctness.md`: this plan.
      - `src/testing/provider-conformance.ts`: tentative; add only generic helpers found necessary by inventory.
      - `src/agents.ts`: tentative; runtime stream/retry behavior.
      - `src/agent-loops.ts`: tentative; loop event/history parity.
      - `packages/compaction-llm/src/strategy.ts`: tentative; provider request output settings.
      - `packages/compaction-observational-memory/src/runtime.ts`: tentative; append ownership.
      - `packages/compaction-observational-memory/src/worker-loop.ts`: tentative; transcript ordering.
    - References:
      - `src/agents.ts` `generateProviderTurn()` currently handles `content_delta` and final `tool_call`, not `tool_call_delta`.
      - `src/testing/provider-conformance.ts` already reconstructs deltas in a private helper path.
      - `src/agent-loops.ts` shows `singleShotLoop` input history push differs from `generateValidateReviseLoop`.
    - Current-Flow Inventory:
      - Provider stream primitives: `ProviderEvent` includes `tool_call_delta`, final `tool_call`, `usage`, `done`, and `error`; first-party providers already emit deltas and final calls from local accumulators.
      - Runtime gap: `RuntimeAgentSession.generateProviderTurn()` emits/appends only `content_delta` and final `tool_call`; streamed `tool_call_delta` is ignored by UI subscribers and not used as runtime reconstruction input.
      - Conformance primitive: `assertToolCallDeltasReconstruct()` validates delta reconstruction, malformed JSON, usage accounting, abort, serialization coverage, and secret leaks, but reconstruction helper is private to the testing subpath.
      - Loop primitives: `LoopContext` already centralizes `assemble`, `generate`, `dispatchToolCall`, `appendMessage`, `emit`, history, input messages, abort signal, and max tool rounds; no new loop runtime primitive is needed.
      - Loop gap: `singleShotLoop` emits `turn_started`/`turn_finished` and pushes first-turn `inputMessages`; `generateValidateReviseLoop` currently omits normal turn events and initial input history append.
      - Retry/options primitives: runtime retry lives in `src/agents.ts` via `RunOptions.retry`/`AgentConfig.retry`; `ProviderRequestOptions.timeoutMs`, `maxRetries`, and `maxRetryDelayMs` exist in contracts, but provider packages use `request.signal` and do not reference those fields.
      - Compaction request primitive: `@arnilo/prism-compaction-llm` maps `maxSummaryTokens`/`maxOutputTokens` into `model.parameters.maxTokens` via `withMaxTokens()` and also caps stored summary text; provider serializers mostly spread `request.model.parameters`, while Z.AI/Kimi also set `max_tokens` from `model.limits` before parameters.
      - Observational-memory append gap: runtime accepts both `session` and `store`, builds a custom entry with `createSessionEntry()`, then calls `store.append()` and `session.checkout()`; mismatched session/store pairs are possible.
      - Worker transcript gap: `runMemoryWorkerLoop()` collects tool calls but appends only role `tool` results; it does not append the assistant tool-call message before tool results, producing invalid transcripts for providers that require call/result pairing.
      - Redaction paths: runtime events pass through `redactAgentEvent()` in `emit()`; retry errors are redacted with `redactSecrets()`/run-ledger redaction; LLM compaction redacts serialized prompts and final summaries; memory runtime redacts worker records/prompts with `redactSecrets()`.
  - Test Cases to Write:
    - Inventory-only task: no product test; record concrete test targets in following tasks before implementation.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no direct behavior change; identifies later public behavior/docs changes.
    - Docs pages to create/edit:
      - `none`: inventory task only.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Make runtime tool-call delta handling match conformance reconstruction
  - Acceptance Criteria:
    - Functional: Runtime emits streamed `message_delta` events for provider `tool_call_delta`, reconstructs final `ToolCallContent`, executes the tool once, persists assistant tool-call message, persists tool-result message, and replays both on the next provider turn.
    - Performance: Reconstruction is O(number of deltas) for current assistant message and does not copy full session history per delta.
    - Code Quality: Uses one reconstruction path shared or mirrored with provider conformance; malformed/incomplete JSON arguments fail through existing provider turn error/retry behavior.
    - Security: Delta arguments and tool errors flow through existing event redactor and no secrets are logged in test fixtures.
  - Approach:
    - Documentation Reviewed:
      - `docs/provider-conformance.md` tool-call delta expectations.
      - `docs/agent-session-runtime.md` provider stream and tool loop behavior.
      - `docs/agent-events.md` `message_delta`, `message_finished`, tool events.
    - Options Considered:
      - Wait for final provider `tool_call`: misses streaming UI and providers that only delta tool calls.
      - Reconstruct in `src/agents.ts` using conformance logic: minimal shared protocol fix.
    - Chosen Approach:
      - Add/export a tiny `reconstructToolCallDeltas` helper from `src/testing/provider-conformance.ts` or move generic helper to `src/provider-events.ts`; runtime uses it at message end while still emitting deltas.
    - API Notes and Examples:
      ```ts
      for await (const event of provider.generate(request)) {
        if (event.type === "tool_call_delta") {
          emit({ type: "message_delta", content: { type: "tool_call_delta", ...event } });
        }
      }
      ```
    - Files to Create/Edit:
      - `src/agents.ts`: handle `tool_call_delta` in `generateProviderTurn()`.
      - `src/provider-events.ts`: shared `reconstructToolCallDeltas()` plus delta content helper.
      - `src/testing/provider-conformance.ts`: use shared reconstruction helper.
      - `src/contracts.ts`: add `ToolCallDeltaContent` so `AgentEvent.message_delta` can carry streamed fragments.
      - `src/input.ts`: render delta content safely if a context block contains it.
      - `src/compaction.ts`: render delta content safely in default text compaction.
      - `packages/compaction-llm/src/serialize.ts`: render delta content safely in LLM compaction transcripts.
      - `packages/compaction-llm/src/tokens.ts`: estimate delta content safely.
      - `src/__tests__/agents.test.ts`: end-to-end tool-call delta runtime test.
      - `src/__tests__/provider-conformance.test.ts`: keep conformance reconstruction aligned.
      - `docs/provider-conformance.md`: document runtime/conformance parity.
      - `docs/agent-session-runtime.md`: document delta stream → final tool call path.
      - `docs/agent-events.md`: update event payload for public delta event shape.
      - `docs/provider-layer.md`: document streamed tool-call delta behavior.
      - `docs/public-contracts.md`: list `ToolCallDeltaContent`.
      - `docs/index.md`: update links/descriptions for delta behavior.
    - References:
      - `src/agents.ts` `generateProviderTurn()`.
      - `src/testing/provider-conformance.ts` `assertToolCallDeltasReconstruct()`.
      - `src/__tests__/openai-compatible.test.ts` existing tool delta fixture.
  - Test Cases to Write:
    - `src/__tests__/agents.test.ts`: mock provider emits `tool_call_delta` chunks, runtime dispatches host tool, next provider request includes assistant `tool_call` before tool `tool_result`, final response finishes.
    - `src/__tests__/provider-conformance.test.ts`: malformed delta arguments fail clearly.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; provider/runtime stream behavior and possibly event payloads.
    - Docs pages to create/edit:
      - `docs/provider-conformance.md`: delta reconstruction/runtime path.
      - `docs/agent-session-runtime.md`: tool-call delta execution/replay.
      - `docs/agent-events.md`: streamed delta event shape.
      - `docs/provider-layer.md`: streamed tool-call delta behavior.
      - `docs/public-contracts.md`: `ToolCallDeltaContent` contract list.
    - `docs/index.md` update: yes; `agent-events` and `provider-layer` descriptions call out streamed/reconstructed tool-call deltas.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Align artifact loop turn events and history with single-shot
  - Acceptance Criteria:
    - Functional: `generate-validate-revise` emits `turn_started`/`turn_finished` around provider turns and appends initial input history consistently with `single-shot` where semantics overlap.
    - Performance: No additional provider calls; only existing input messages are appended once.
    - Code Quality: Keeps `singleShotLoop` as default and avoids duplicating runtime primitives outside `LoopContext`.
    - Security: Artifact validation results and repair prompts continue through existing redaction/event path.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-loops.md`.
      - `docs/structured-output.md`.
      - `docs/agent-events.md`.
      - `docs/agent-session-runtime.md`.
    - Options Considered:
      - Leave artifact loop as special-case event stream: less code but surprises subscribers.
      - Add normal turn event/history parity only: minimal behavior correction.
    - Chosen Approach:
      - Mirror `singleShotLoop` turn event and first-input history behavior in `generateValidateReviseLoop`; keep artifact-specific events unchanged.
    - API Notes and Examples:
      ```ts
      await session.run("draft", {
        loop: { strategy: "generate-validate-revise", validator, maxRevisions: 2 },
      });
      ```
    - Files to Create/Edit:
      - `src/agent-loops.ts`: added turn events and first-input history append to artifact loop.
      - `src/__tests__/agent-loops.test.ts`: parity tests for direct loop and runtime session store/events.
      - `docs/agent-loops.md`: event/history behavior.
      - `docs/agent-events.md`: artifact-loop normal turn event ordering.
      - `docs/agent-session-runtime.md`: built-in loop turn/history parity note.
      - `docs/index.md`: no navigation description change needed.
    - References:
      - `src/agent-loops.ts` `singleShotLoop` and `generateValidateReviseLoop`.
      - `src/__tests__/agent-loops.test.ts` existing artifact-loop tests.
  - Test Cases to Write:
    - Artifact loop emits `turn_started`, `message_finished`, artifact events, `turn_finished` for each generation attempt.
    - First user input appears once in stored history for artifact loop, matching single-shot.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; event ordering and session history behavior.
    - Docs pages to create/edit:
      - `docs/agent-loops.md`: artifact loop parity.
      - `docs/agent-events.md`: event order.
      - `docs/agent-session-runtime.md`: runtime loop parity note.
    - `docs/index.md` update: no; current summaries still cover the changed behavior.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Verify or deprecate provider request timeout/retry knobs
  - Acceptance Criteria:
    - Functional: `timeoutMs`, `maxRetries`, and `maxRetryDelayMs` either work in first-party providers through tested request behavior or are removed/deprecated from public docs/types with migration notes to runtime retry policy.
    - Performance: Timeout tests use mocked timers/abortable fetch where possible and stay network-free.
    - Code Quality: No provider-specific retry loop duplicated if runtime retry policy already covers the need.
    - Security: Retry/timeout errors redact secrets and provider-owned headers remain protected.
  - Approach:
    - Documentation Reviewed:
      - `docs/provider-packages.md`.
      - `docs/provider-layer.md`.
      - `docs/provider-conformance.md`.
      - `docs/agent-session-runtime.md` retry docs.
    - Options Considered:
      - Implement `ProviderRequestOptions` retry in every provider: larger surface and overlaps runtime retry.
      - Deprecate inert provider-level retry knobs and document runtime retry as the supported path: smaller if code proves knobs are unused.
      - Keep `timeoutMs` only if providers can map it to `AbortSignal.timeout()` cheaply.
    - Chosen Approach:
      - Audit current provider serializers first; implement only knobs already wired cheaply, otherwise deprecate docs and steer to runtime retry policy.
    - API Notes and Examples:
      ```ts
      await session.run("retry me", {
        retry: { maxAttempts: 3, maxDelayMs: 1_000 },
      });
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: deprecated `ProviderRequestOptions.timeoutMs`, `maxRetries`, and `maxRetryDelayMs` with JSDoc migration notes.
      - `src/__tests__/docs.test.ts`: docs/runtime migration coverage plus first-party provider source guard proving deprecated knobs are not implemented as hidden provider loops.
      - `packages/provider-openai/src/__tests__/openai.test.ts`: no change; existing abort/header/error-redaction tests cover supported behavior.
      - `packages/provider-openrouter/src/__tests__/openrouter.test.ts`: no change; existing header/error-redaction tests cover supported behavior.
      - `packages/provider-opencode-go/src/__tests__/opencode-go.test.ts`: no change; existing header/error-redaction tests cover supported behavior.
      - `packages/provider-zai/src/__tests__/zai.test.ts`: no change; covered by static first-party provider guard.
      - `packages/provider-kimi/src/__tests__/kimi.test.ts`: no change; covered by static first-party provider guard.
      - `docs/provider-packages.md`: supported options and deprecated knobs.
      - `docs/provider-conformance.md`: signal/abort conformance and deprecation note.
      - `docs/provider-layer.md`: runtime abort/retry replacement note.
      - `docs/agent-session-runtime.md`: runtime retry/abort migration path.
      - `docs/public-contracts.md`: deprecated options summary.
      - `docs/index.md`: provider-layer summary mentions deprecated timeout/retry migration.
    - References:
      - `src/contracts.ts` `ProviderRequestOptions` fields.
      - `src/agents.ts` `generateWithRetry()`.
      - `packages/provider-*/src/provider.ts` request handling.
  - Test Cases to Write:
    - If kept: first-party provider respects timeout/abort in mocked fetch.
    - If deprecated: docs tests assert no public docs advertise unsupported provider-level retry knobs except deprecation/migration note, and first-party provider source does not implement the deprecated knobs.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; provider request config semantics.
    - Docs pages to create/edit:
      - `docs/provider-packages.md`: exact supported/deprecated provider request options.
      - `docs/provider-conformance.md`: conformance expectations.
      - `docs/provider-layer.md`: supported abort/retry replacement.
      - `docs/agent-session-runtime.md`: runtime retry/abort alternative.
      - `docs/public-contracts.md`: public option semantics.
    - `docs/index.md` update: yes; provider-layer summary now points deprecated provider timeout/retry hints to runtime abort/retry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Map LLM compaction max-output settings to real provider request fields
  - Acceptance Criteria:
    - Functional: `maxOutputTokens`/`maxSummaryTokens` affect provider request serialization through `ModelConfig.parameters.maxTokens` or documented provider/model mapping that first-party providers actually serialize.
    - Performance: No extra summarization call; budget calculation remains O(1).
    - Code Quality: One helper computes the output budget and resulting model/request shape; docs use same field names as code.
    - Security: Compaction prompt/summary redaction remains unchanged and tests avoid real secrets.
  - Approach:
    - Documentation Reviewed:
      - `docs/compaction-llm.md`.
      - `docs/compaction-and-retry.md`.
      - `docs/provider-packages.md` model parameter serialization notes.
    - Options Considered:
      - Keep only local string truncation: prevents oversized stored summaries but does not limit provider output cost.
      - Map budget into `ModelConfig.parameters.maxTokens`: existing generic field already used by providers.
    - Chosen Approach:
      - Verify every first-party provider serializes `model.parameters.maxTokens`; fix provider serializers or docs if not.
    - API Notes and Examples:
      ```ts
      createLlmCompactionStrategy({
        summaryProvider: provider,
        summaryModel: { provider: "openai", id: "gpt-4.1-mini", parameters: { maxTokens: 800 } },
        maxSummaryTokens: 800,
      });
      ```
    - Files to Create/Edit:
      - `packages/compaction-llm/src/strategy.ts`: request model now uses one `summaryRequestModel()` path that applies the computed budget as `model.parameters.maxTokens`.
      - `packages/compaction-llm/src/__tests__/strategy.test.ts`: asserts `maxOutputTokens` reaches generated provider request model and preserves other model parameters.
      - `packages/provider-openai/src/responses.ts`: serializes generic `maxTokens` as OpenAI Responses `max_output_tokens` and strips raw `maxTokens` from the body.
      - `packages/provider-openrouter/src/provider.ts`: serializes generic `maxTokens` as `max_tokens` and strips raw `maxTokens`.
      - `packages/provider-opencode-go/src/openai-chat.ts`: serializes generic `maxTokens` as OpenAI-compatible `max_tokens`.
      - `packages/provider-opencode-go/src/anthropic-messages.ts`: serializes generic `maxTokens` as Anthropic-style `max_tokens`, falling back to model limits/default.
      - `packages/provider-zai/src/provider.ts`: serializes generic `maxTokens` as `max_tokens`, falling back to model limits.
      - `packages/provider-kimi/src/provider.ts`: serializes generic `maxTokens` as Anthropic-style `max_tokens`, falling back to model limits/default.
      - `packages/provider-*/src/__tests__/*.test.ts`: provider serialization coverage for all first-party providers/routes.
      - `docs/compaction-llm.md`: max-output behavior and wire-field mapping.
      - `docs/compaction-and-retry.md`: overview links compaction budget to provider output fields.
      - `docs/provider-packages.md`: provider parameter mapping documented.
      - `docs/index.md`: LLM compaction summary mentions max-output mapping.
    - References:
      - `packages/compaction-llm/src/strategy.ts` `withMaxTokens()` and `outputBudget()`.
      - `packages/provider-openai/src/responses.ts`, `packages/provider-opencode-go/src/openai-chat.ts`, `packages/provider-openrouter/src/provider.ts`, `packages/provider-zai/src/provider.ts`, `packages/provider-kimi/src/provider.ts`.
  - Test Cases to Write:
    - LLM compaction passes requested max token budget into mock provider request.
    - Provider package serializers include the real max token field when `model.parameters.maxTokens` is specified and omit raw `maxTokens` from serialized bodies.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; compaction config behavior and provider request serialization.
    - Docs pages to create/edit:
      - `docs/compaction-llm.md`: `maxOutputTokens`/`maxSummaryTokens` request mapping.
      - `docs/compaction-and-retry.md`: overview.
      - `docs/provider-packages.md`: first-party `maxTokens` provider parameter support.
    - `docs/index.md` update: yes; LLM compaction summary now notes max-output budgets map to provider wire fields.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Fix observational-memory append ownership and worker transcript order
  - Acceptance Criteria:
    - Functional: Observational-memory runtime appends ledger entries through the owning session/store seam without accepting mismatched `session` + `store`; worker transcripts place assistant `tool_call` messages before matching `tool_result` messages.
    - Performance: Appending remains one entry append per ledger record; transcript ordering fix does not duplicate full histories unnecessarily.
    - Code Quality: Removes or deprecates mismatched configuration surface instead of adding validation everywhere; tests use existing `AgentSession`/`SessionStore` contracts.
    - Security: Worker prompts/transcripts still redact configured secrets and invalid/missing ids fail closed.
  - Approach:
    - Documentation Reviewed:
      - `docs/compaction-observational-memory.md`.
      - `docs/session-stores-and-branching.md`.
      - `docs/provider-conformance.md` transcript validity rules.
    - Options Considered:
      - Validate `session.id`/store contents before appending: catches some mismatches but still exposes two ownership sources.
      - Route appends through `AgentSession` or accept one owned append callback: smaller, fail-closed API.
    - Chosen Approach:
      - Remove/deprecate `store` from runtime options if session can append custom entries; otherwise replace `session`+`store` with one explicit append callback bound by host.
    - API Notes and Examples:
      ```ts
      const memory = createObservationalMemoryRuntime({
        session,
        workerProvider,
        workerModel,
      });
      await memory.flush();
      ```
    - Files to Create/Edit:
      - `packages/compaction-observational-memory/src/runtime.ts`: replaced `store` option with required `appendEntry` callback, rejects legacy `store`, appends custom ledger entries through the callback, checks the entry is visible on the owning session branch, and restores the prior checkout on ownership failure.
      - `packages/compaction-observational-memory/src/worker-loop.ts`: appends assistant `tool_call` messages before matching `tool_result` messages between worker turns.
      - `packages/compaction-observational-memory/src/serialize.ts`: no change; transcript ordering lives in worker loop message assembly.
      - `packages/compaction-observational-memory/src/__tests__/runtime.test.ts`: mismatched ownership regression and legacy `store` rejection.
      - `packages/compaction-observational-memory/src/__tests__/workers.test.ts`: transcript ordering regression.
      - `packages/compaction-observational-memory/src/__tests__/runtime-drop.test.ts`: dropper append still works with owned `appendEntry` callback.
      - `src/__tests__/phase14-boundaries.test.ts`: inert setup/docs coverage updated for `appendEntry` API and transcript guarantee.
      - `docs/compaction-observational-memory.md`: updated runtime options and transcript guarantees.
      - `docs/provider-conformance.md`: generalized valid transcript ordering note.
      - `docs/index.md`: compaction-memory entry updated for owned append callback and provider-valid worker transcripts.
    - References:
      - `packages/compaction-observational-memory/src/runtime.ts` currently accepts both `session` and `store` and calls `store.append()` then `session.checkout()`.
      - `packages/compaction-observational-memory/src/worker-loop.ts` provider request assembly.
  - Test Cases to Write:
    - Runtime cannot append to a store that does not own the active session branch; wrong `appendEntry` owner fails closed and restores the previous checkout.
    - Worker provider request with prior tool interactions serializes assistant tool-call message before tool-result message.
    - Memory worker transcript uses Prism `tool_call` and `tool_result` content blocks in provider-valid order for provider serializers/conformance canaries.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; observational-memory runtime options and worker provider transcript behavior.
    - Docs pages to create/edit:
      - `docs/compaction-observational-memory.md`: runtime configuration/API.
      - `docs/provider-conformance.md`: valid transcript ordering documented generally.
    - `docs/index.md` update: yes; observational-memory summary now mentions owned runtime append callback and provider-valid worker transcripts.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] End-to-end protocol verification, docs, and export drift checks
  - Acceptance Criteria:
    - Functional: Final network-free verification covers runtime deltas, artifact-loop parity, provider option/deprecation path, compaction request budget, and memory worker transcript conformance.
    - Performance: Default `npm test` remains network-free and within existing release budget; no live provider tests added to default path.
    - Code Quality: Public exports/types/docs agree; no stale docs mention unsupported knobs.
    - Security: Redaction tests still pass and no fixtures contain real-looking secrets.
  - Approach:
    - Documentation Reviewed:
      - `docs/index.md`.
      - `docs/provider-conformance.md`.
      - `docs/agent-loops.md`.
      - `docs/compaction-llm.md`.
      - `docs/compaction-observational-memory.md`.
      - `docs/agent-events.md`.
    - Options Considered:
      - Rely on package-local tests only: misses runtime/provider protocol crossing.
      - Add one cross-cutting mock E2E plus focused package tests: smallest complete safety net.
    - Chosen Approach:
      - Add focused tests near owners and one runtime E2E in core; run build/typecheck/test plus docs checks already in `npm test`.
    - API Notes and Examples:
      ```sh
      npm test
      npm run typecheck
      ```
    - Files to Create/Edit:
      - `src/__tests__/docs.test.ts`: added `phase39_protocol_docs_and_regressions_cover_end_to_end_paths` to keep docs and regression names for runtime deltas, artifact-loop parity, provider knob deprecation, compaction max-output budgets, append ownership, and worker transcript ordering in sync.
      - `src/__tests__/public-export-contract.test.ts`: added `phase39_public_protocol_exports_and_types_do_not_drift` to verify root provider delta helper export, `ToolCallDeltaContent` public type path, provider-conformance subpath export, and observational-memory runtime `.d.ts` uses `appendEntry` without the old `store` option.
      - `docs/index.md`: verified changed docs remain linked and descriptions mention tool-call deltas, runtime abort/retry migration, max-output wire fields, and owned observational-memory append callback.
      - `plans/040-provider-runtime-protocol-correctness.md`: all tasks marked complete and final sections filled.
    - References:
      - `package.json` scripts: `npm test`, `npm run typecheck`.
      - `src/__tests__/docs.test.ts` docs enforcement.
  - Test Cases to Write:
    - Final command: `npm test` passed network-free.
    - Final command: `npm run typecheck` passed across core and all workspaces.
    - Targeted verification also passed: `npm run build --foreground-scripts`; `node --test dist/__tests__/docs.test.js dist/__tests__/public-export-contract.test.js`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; this task verifies docs for all public changes.
    - Docs pages to create/edit:
      - `docs/provider-conformance.md`: final protocol statement.
      - `docs/agent-loops.md`: final loop event/history statement.
      - `docs/compaction-llm.md`: final max-output mapping.
      - `docs/compaction-observational-memory.md`: final runtime/worker protocol.
      - `docs/index.md`: navigation entries/descriptions.
    - `docs/index.md` update: yes; ensure changed pages remain discoverable.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Deprecated inert provider-level `timeoutMs`/`maxRetries`/`maxRetryDelayMs` instead of implementing duplicate retry/timeout loops in every first-party provider. Runtime `RunOptions.signal` and `AgentConfig.retry`/`RunOptions.retry` remain the supported seam.
- Observational-memory runtime now accepts an owned `appendEntry` callback rather than exposing a separate `store` option. This is a small breaking API correction that removes mismatched session/store ownership instead of adding partial validation.
- `tool_call_delta` fragments are live event content only; persisted transcripts keep final `tool_call` blocks. This keeps storage/provider replay simple while still supporting streaming UI.

## Further Actions
- Phase 40 should cover backpressure/performance limits for long-running streams and worker pipelines; Phase 39 intentionally avoided adding buffering beyond per-message tool-call delta reconstruction.
- If a future public helper is needed for non-testing delta reconstruction, promote `reconstructToolCallDeltas()` from `src/provider-events.ts` deliberately with docs and export tests.
- Consider adding a public `AgentSession.appendEntry()` primitive later if more extensions need branch-owned custom appends; current `appendEntry` callback keeps Phase 39 minimal.
