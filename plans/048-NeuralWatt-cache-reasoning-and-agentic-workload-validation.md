# Phase 47 — NeuralWatt cache, reasoning, and agentic workload validation

## Objectives
- Verify NeuralWatt works well for long-running agent sessions, not just one-shot chat: cache reuse, reasoning pass-through, reasoning preservation across turns, and tool-call loops round-trip through Prism.
- Keep all NeuralWatt-specific behavior inside `@arnilo/prism-provider-neuralwatt`; no core contract changes unless a true generic gap is found.
- Preserve network-free tests with mocked `fetch`/SSE fixtures; no live network in CI.
- Document cache-aware limiter behavior, reasoning controls, reasoning preservation, tool-call transcripts, and agent-session runtime so users can run NeuralWatt agents from docs alone.

## Expected Outcome
- NeuralWatt agent sessions keep cache-friendly prompt prefixes across follow-up turns; `usage.prompt_tokens_details.cached_tokens` is surfaced and 25% cached-input pricing metadata is asserted in tests.
- Reasoning controls (`reasoning_effort`, `thinking_token_budget`, `chat_template_kwargs.enable_thinking`, `preserve_thinking`, `clear_thinking`) pass through via `compat`/`extra` without forcing NeuralWatt-specific fields into core contracts.
- Prior assistant reasoning is preserved in `reasoning`/`reasoning_content` for Kimi/GLM/Qwen-style models and does not leak into providers that do not support it.
- Tool-call transcripts (OpenAI-style tools + tool results) round-trip through the Prism runtime and NeuralWatt payload format.
- `/docs/providers/neuralwatt.md`, `/docs/provider-caching.md`, `/docs/agent-session-runtime.md`, and `/docs/index.md` cover the above without promising cache hits.

## Tasks

- [x] Primitive review: inventory cache, reasoning, reasoning-preservation, and tool-call seams before implementation
  - Acceptance Criteria:
    - Functional: Record whether `ModelConfig.cache`, `Usage.cacheReadTokens`, cache-aware limiter/policy helpers, `request.options.compat`, `request.model.compat`, `Message` reasoning/thinking content blocks, and tool-call content blocks already cover Phase 47; identify any true generic gap before writing code.
    - Performance: Confirm planned changes add no tokenization/hashing and no new network calls; prefix-cache assertions reuse existing mocked `fetch` fixtures.
    - Code Quality: Reject NeuralWatt-specific fields in core `ProviderRequest`/`Message`/`Usage`; pass-through must use `compat`/`extra` and existing content block types only.
    - Security: Confirm no new trust boundary; `compat`/`extra` reasoning fields are never logged or redacted away from existing `redactSecrets()` coverage; reasoning preservation does not echo secrets from prior turns beyond what the caller already sent.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 47 — NeuralWatt cache, reasoning, and agentic workload validation (deliver + acceptance).
      - `plans/046-NeuralWatt-first-party-provider-package.md` and `plans/047-NeuralWatt-model-discovery-pricing-energy-and-retry-semantics.md` inventory findings (cache, telemetry, retry, header ownership).
      - `.agents/skills/create-plan/references/prism-wiki.md` doc structure.
      - `docs/providers/neuralwatt.md`, `docs/provider-caching.md`, `docs/agent-session-runtime.md`, `docs/runs-and-usage.md`, `docs/public-contracts.md`.
      - NeuralWatt docs (portal): prefix caching behavior, `prompt_tokens_details.cached_tokens`, reasoning controls (`reasoning_effort`, `thinking_token_budget`, `chat_template_kwargs.enable_thinking`, `preserve_thinking`, `clear_thinking`), Kimi/GLM/Qwen `reasoning`/`reasoning_content` fields.
    - Options Considered:
      - Add `reasoning_effort`/`thinking_token_budget`/`preserve_thinking` as first-class core fields: rejected; bloats provider-agnostic contracts.
      - Pass through via existing `compat`/`extra` escape hatches: chosen; matches Phase 45/46 pattern and keeps core clean.
      - Store preserved reasoning in a new content block type: rejected unless no existing thinking/reasoning block exists; prefer existing `thinking` content block or `metadata`.
    - Chosen Approach:
      - Inventory code first; implement only package-local helpers, tests, and doc edits unless inventory reveals a broken generic seam.
    - API Notes and Examples:
      ```ts
      // Reasoning pass-through already reads compat escape hatches:
      // neuralWattReasoningEffort, neuralWattThinkingTokenBudget,
      // neuralWattChatTemplateKwargs in packages/provider-neuralwatt/src/thinking.ts
      // preserve_thinking / clear_thinking to be added via the same seam.
      ```
    - Files to Create/Edit:
      - `plans/048-NeuralWatt-cache-reasoning-and-agentic-workload-validation.md`: record inventory findings during execution.
      - Runtime/source files: none in this task unless inventory reveals a broken public seam.
    - References:
      - `packages/provider-neuralwatt/src/{provider,sse,thinking,models,telemetry,retry}.ts`.
      - `src/contracts.ts` (`ProviderRequest`, `Message`, `Usage`, `ModelConfig.cache`), `src/cache-helpers.ts`, `src/input.ts`.
  - Inventory Findings:
    - **Cache capability/usage seam (covered, no core edit needed):** `src/contracts.ts` already has `ModelConfig.cache: ModelCacheCapabilities` with `kind: "implicit"`, `Usage.cacheReadTokens`/`cacheWriteTokens`, and `ModelCost.cacheRead`/`cacheWrite`. `packages/provider-neuralwatt/src/models.ts` sets `cache: { kind: "implicit" }` on all featured models and maps `cached_input_per_million` → `ModelCost.cacheRead`. `packages/provider-neuralwatt/src/provider.ts` `toUsage()` already maps `prompt_tokens_details.cached_tokens` → `Usage.cacheReadTokens` and never fabricates `cacheWriteTokens`. Test `neuralwatt_usage_maps_cached_tokens` already asserts this. **Gap to close in task 2:** no test asserts stable prefix ordering across turns or that no cache-control payload is emitted, and the 25% cached-input pricing relationship is only incidentally present in one fixture (`cacheRead: 0.0875` vs `input: 0.35`) — needs an explicit assertion.
    - **Cache-aware input ordering seam (covered, no core edit needed):** `src/contracts.ts` defines `InputAssemblyLayout = "legacy" | "cache_aware"` and `src/input.ts` `flattenInputGroups()` implements the `cache_aware` ordering (instructions → attachments → summaries → history → toolResults → input) which keeps stable prefixes first. This is the Prism-side mechanism that makes NeuralWatt implicit prefix caching effective; task 2 should assert the provider receives messages in that stable order when `inputLayout: "cache_aware"` is set, and that NeuralWatt adds NO explicit cache-control payload (confirmed: `neuralWattBody()` emits no `cache_control` field; only caller `compat`/`extra` could, which is opt-in).
    - **Cache-aware limiter seam (doc-only, no runtime):** There is no TPM/fleet-capacity limiter in core or the package — uncached-TPM/warm-prefix/503 behavior is NeuralWatt backend behavior to document, not implement. `src/cache-helpers.ts` provides `cacheHitRate()`, `cacheSavings()`, `cacheUsageReport()` for diagnostics only. Task 3 is doc-only.
    - **Reasoning control pass-through seam (partial gap):** `packages/provider-neuralwatt/src/thinking.ts` already has readers for `reasoning_effort`, `thinking_token_budget`, `chat_template_kwargs`, and `tool_choice`, all reading `request.options.compat` / `request.model.compat`. `provider.ts` `neuralWattBody()` already serializes `reasoning_effort`, `thinking_token_budget`, `chat_template_kwargs` into the body, and spreads `...request.options?.compat` / `...request.options?.extra` last. **Gap to close in task 4:** `preserve_thinking` and `clear_thinking` have NO dedicated readers and are NOT explicitly serialized — they only ride through via the `...compat` spread, which works but is undocumented and untested. Add dedicated readers + explicit serialization + tests.
    - **Reasoning preservation seam (real gap, package-local fix):** Core `Message` has `ThinkingContent` (`type: "thinking"`, `text`, optional `signature`) and `ModelCapabilities.reasoning: boolean`. However `provider.ts` `toMessage()` does NOT preserve prior assistant reasoning as NeuralWatt `reasoning`/`reasoning_content`: for assistant messages it filters `text` OR `thinking` blocks and either joins them into `content` (tool-call branch) or pushes them as `{type:"text", text}` (fallthrough). So prior thinking is currently flattened into text content, not emitted under the documented `reasoning` field, and it is emitted for ALL models regardless of capability (no gating). **Task 5 must:** gate preservation on `model.capabilities.reasoning` / `compat.preserve_thinking`, emit thinking blocks under the NeuralWatt `reasoning`/`reasoning_content` field for capable models, and omit them for non-reasoning models. No core `Message` change needed — `ThinkingContent` already carries the data.
    - **Tool-call loop seam (covered, no core edit needed):** Core has `ToolCallContent`, `ToolResultContent`, `toolCallContent()` helper, and `ProviderEvent` variants `tool_call_delta`/`tool_call`. `provider.ts` already serializes assistant `tool_call` blocks → OpenAI `tool_calls` and `role: "tool"` messages → `{role:"tool", tool_call_id, content}`; the tool accumulator reconstructs streamed deltas → final `providerToolCall`. Existing tests cover delta reconstruction and single-turn tool-result serialization. **Gap to close in task 6:** no end-to-end two-turn loop test asserting both request bodies (prior `tool_calls` + `tool` result) and final streamed text round-trip.
    - **Conclusion:** No core contract (`src/contracts.ts`, `Message`, `Usage`, `ProviderRequest`, `ProviderEvent`) change is required for Phase 47. All work is package-local (new `preserve_thinking`/`clear_thinking` readers, gated reasoning-preservation in `toMessage`, new/extended tests) plus docs. Generic primitives are sufficient.
  - Test Cases to Write:
    - Inventory assertion: every Phase 47 deliverable maps to an existing seam or a documented package-local helper; no core contract edit is required (confirmed above).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — inventory only.
    - Docs pages to create/edit:
      - `none`: inventory task; findings recorded in this plan.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Cache fixtures and tests for NeuralWatt implicit vLLM prefix caching
  - Acceptance Criteria:
    - Functional: Network-free tests assert stable prefix ordering across multi-turn requests (system prompt + early turns unchanged before the new turn), no explicit cache-control payload is added to NeuralWatt requests, `usage.prompt_tokens_details.cached_tokens` is mapped into Prism `Usage.cacheReadTokens`, and 25% cached-input pricing metadata is present in the NeuralWatt model `ModelCost` and applied to cached token cost when reported.
    - Performance: Tests run with mocked `fetch`; no real network; O(messages) serialization unchanged.
    - Code Quality: Reuse existing cache helpers and `Usage`/`ModelCost` seams; no NeuralWatt-specific payload field added for cache control.
    - Security: Fixtures contain no real keys; `redactSecrets()` covers any captured request bodies in test assertions.
  - Approach:
    - Documentation Reviewed:
      - NeuralWatt prefix caching docs: implicit vLLM prefix cache, no cache-control payload, full prior history required for multi-turn reuse, `cached_tokens` in `prompt_tokens_details`.
      - `plans/043-prompt-cache-primitives-and-provider-capability-metadata.md` and `plans/044-cache-aware-input-ordering-and-diagnostics.md` for cache primitive seams.
      - `docs/provider-caching.md` for existing implicit-cache caveats.
    - Options Considered:
      - Add explicit `cache_control` payload: rejected; NeuralWatt is implicit, payload would be ignored or error.
      - Assert prefix ordering at the Prism input-assembly layer: chosen; validates cache-friendly ordering without provider payload changes.
    - Chosen Approach:
      - Add/extend mocked `fetch` fixtures that return `usage.prompt_tokens_details.cached_tokens`; assert mapping to `Usage.cacheReadTokens`. Assert request bodies across turns share a stable prefix and contain no cache-control field. Assert NeuralWatt featured model `ModelCost.cacheRead` equals 25% of `input` where documented.
    - API Notes and Examples:
      ```json
      { "usage": { "prompt_tokens": 1200, "prompt_tokens_details": { "cached_tokens": 900 }, "completion_tokens": 40, "total_tokens": 1240 } }
      ```
      ```ts
      assert.equal(usage.cacheReadTokens, 900);
      assert.equal(Math.round(model.cost!.cacheRead! * 4), Math.round(model.cost!.input!)); // 25% cached input
      ```
    - Files to Create/Edit:
      - `packages/provider-neuralwatt/src/__tests__/neuralwatt.test.ts`: add cached-token mapping and stable-prefix assertions (or a new `neuralwatt-cache.test.ts` if the file is too dense).
      - `packages/provider-neuralwatt/src/models.ts`: confirm/adjust featured model `ModelCost.cacheRead` at 25% of input where documented.
      - `packages/provider-neuralwatt/src/provider.ts`: confirm no cache-control payload is emitted; surface `cached_tokens` via existing usage mapping.
    - References:
      - `packages/provider-neuralwatt/src/models.ts` (featured model costs), `provider.ts` (usage mapping), `docs/provider-caching.md`.
  - Execution Notes:
    - Added a new `describe("@arnilo/prism-provider-neuralwatt (implicit vLLM prefix caching)")` block to `packages/provider-neuralwatt/src/__tests__/neuralwatt.test.ts` with 4 network-free tests:
      - `neuralwatt_emits_no_cache_control_payload`: asserts `neuralWattBody()` and every serialized message have no `cache_control` and no top-level `cache` field.
      - `neuralwatt_multi_turn_stable_prefix`: captures both request bodies across two turns and asserts turn-2 keeps turn-1's serialized messages as a byte-identical prefix (only new assistant+user appended) and no `cache_control` on either turn.
      - `neuralwatt_cached_tokens_map_to_usage_across_turns`: turn 1 cold (no `cached_tokens` → `cacheReadTokens` undefined), turn 2 warm (`cached_tokens: 950` → `Usage.cacheReadTokens: 950`), `cacheWriteTokens` never fabricated.
      - `neuralwatt_cached_input_pricing_is_25pct_and_applied_to_cached_cost`: via `listNeuralWattModels()` + `modelsFixture()`, asserts `cacheRead === input * 0.25` (0.0875 vs 0.35) and `cacheSavings()` from `@arnilo/prism` returns `950 * (0.35 - 0.0875) / 1_000_000`.
    - Imported `cacheSavings` from `@arnilo/prism`.
    - No `provider.ts` or `models.ts` change required: `neuralWattBody()` already emits no cache-control payload and `toUsage()` already maps `cached_tokens`; the static catalog intentionally omits per-alias pricing (documented), so the 25% relationship is asserted through the `/v1/models` discovery path that exposes `cached_input_per_million`.
    - Docs: `docs/provider-caching.md` line 150 already documents NeuralWatt implicit caching (no payload, `cached_tokens` → `cacheReadTokens`, no fabricated cache-write, `cached_input_per_million`). The cache-aware limiter subsection (uncached TPM / warm-prefix / 503 / full prior history) is task 3.
    - Verification: `npm run build` + `node --test dist/__tests__/*.test.js` in `packages/provider-neuralwatt` → 58 tests, 57 pass, 1 skipped (live), 0 fail.
  - Test Cases to Write:
    - `neuralwatt_cached_tokens_map_to_usage`: validates `cached_tokens` → `Usage.cacheReadTokens`.
    - `neuralwatt_multi_turn_stable_prefix`: validates request body prefix stable across follow-up turns, no cache-control field.
    - `neuralwatt_cached_input_pricing_25pct`: validates `ModelCost.cacheRead` is 25% of `input` for featured models and cached cost is reported.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — cached-token reporting and cache-friendly ordering are user-observable.
    - Docs pages to create/edit:
      - `docs/provider-caching.md`: add/confirm NeuralWatt implicit prefix-cache section (no payload, full prior history needed, `cached_tokens` mapping, 25% cached-input pricing).
      - `docs/providers/neuralwatt.md`: cross-link caching section and note cached-token reporting.
    - `docs/index.md` update: no (entries already exist); verify links resolve.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Document NeuralWatt cache-aware limiter behavior
  - Acceptance Criteria:
    - Functional: `docs/provider-caching.md` (and NeuralWatt page) explain that uncached TPM counts cold prefill only, warm-prefix requests can avoid some 503 fleet-capacity blocks, and full prior history is required for multi-turn cache reuse; no claim of guaranteed cache hits.
    - Performance: Doc-only; no runtime change.
    - Code Quality: Prose stays within existing doc page structure; no duplicated sections.
    - Security: No secrets/keys mentioned; no implication that `cacheRetention: "none"` disables NeuralWatt backend cache.
  - Approach:
    - Documentation Reviewed:
      - NeuralWatt rate-limit / fleet-capacity docs: TPM accounting, 503 capacity blocks, warm-prefix behavior.
      - `docs/provider-caching.md` existing implicit-cache caveats from Phase 45.
      - `.agents/skills/create-plan/references/prism-wiki.md` page structure.
    - Options Considered:
      - New standalone `docs/neuralwatt-caching.md`: rejected; duplicates provider-caching.
      - Section inside `docs/provider-caching.md` with cross-link from NeuralWatt page: chosen.
    - Chosen Approach:
      - Add a NeuralWatt cache-aware limiter subsection under the implicit-cache section; cross-link from `docs/providers/neuralwatt.md`.
    - API Notes and Examples:
      ```markdown
      ## NeuralWatt cache-aware limiter
      - Uncached TPM counts cold prefill only.
      - Warm-prefix requests can avoid some 503 fleet-capacity blocks.
      - Full prior history required for multi-turn cache reuse.
      - `cacheRetention: "none"` disables Prism/provider cache hints only, not NeuralWatt's implicit vLLM prefix cache.
      ```
    - Files to Create/Edit:
      - `docs/provider-caching.md`: add NeuralWatt cache-aware limiter subsection.
      - `docs/providers/neuralwatt.md`: cross-link to caching section.
    - References:
      - `docs/provider-caching.md`, `docs/providers/neuralwatt.md`, NeuralWatt rate-limit docs.
  - Execution Notes:
    - Added a `### NeuralWatt cache-aware limiter` subsection to `docs/provider-caching.md` (after the first-party provider notes, before Security/performance notes) covering: uncached TPM counts cold prefill only, warm-prefix requests can avoid some `503` fleet-capacity blocks, full prior history required for multi-turn cache reuse (with `inputLayout: "cache_aware"` pointer), best-effort/no-guaranteed-hits, and `cacheRetention: "none"` caveat. Cross-links to `providers/neuralwatt.md`.
    - Added a `#### Cache-aware limiter behavior` subsection under `### Cache behavior` in `docs/providers/neuralwatt.md` with the same four points, cross-linking to `../provider-caching.md`.
    - No runtime change; existing `does not guarantee cache hits` and `Provider-owned auth/session/security headers always win` safety wording preserved in `provider-caching.md` (docs.test phase42/phase43 still pass).
    - Verification: `node --test dist/__tests__/docs.test.js` → 56 pass, 0 fail (includes phase42 cache safety-phrase checks and index-link resolution).
  - Test Cases to Write:
    - Network-free doc-link check: `docs/provider-caching.md` and `docs/providers/neuralwatt.md` cross-links resolve (add to existing docs link test if present).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documented runtime/limiter behavior.
    - Docs pages to create/edit:
      - `docs/provider-caching.md`: NeuralWatt cache-aware limiter subsection.
      - `docs/providers/neuralwatt.md`: cross-link.
    - `docs/index.md` update: no (entries exist); verify navigation.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Reasoning control pass-through tests for effort, budget, enable_thinking, preserve_thinking, clear_thinking
  - Acceptance Criteria:
    - Functional: Network-free tests assert `reasoning_effort`, `thinking_token_budget`, `chat_template_kwargs.enable_thinking`, `preserve_thinking`, and `clear_thinking` are read from `request.options.compat` / `request.model.compat` and serialized into the NeuralWatt request body (top-level or `chat_template_kwargs` as documented), with no NeuralWatt-specific field added to core `ProviderRequest`/`Message`.
    - Performance: Tests use mocked `fetch`; no extra passes.
    - Code Quality: Reuse existing `thinking.ts` helper pattern; add `preserve_thinking`/`clear_thinking` readers only if missing.
    - Security: No secret material in reasoning fields; `redactSecrets()` still covers captured bodies.
  - Approach:
    - Documentation Reviewed:
      - NeuralWatt reasoning docs: `reasoning_effort`, `thinking_token_budget`, `chat_template_kwargs.enable_thinking`, `preserve_thinking`, `clear_thinking` field names and placement.
      - `packages/provider-neuralwatt/src/thinking.ts` existing readers.
      - `plans/046-NeuralWatt-first-party-provider-package.md` compat/extra pattern.
    - Options Considered:
      - First-class core reasoning fields: rejected.
      - `compat`/`extra` pass-through with package-local readers: chosen.
    - Chosen Approach:
      - Extend `thinking.ts` with `neuralWattPreserveThinking()` and `neuralWattClearThinking()` readers if absent; serialize into the request body in `provider.ts` at the documented location. Add tests asserting each control round-trips from `compat` to body.
    - API Notes and Examples:
      ```ts
      export function neuralWattPreserveThinking(request: ProviderRequest): boolean | undefined {
        const v = request.options?.compat?.preserve_thinking ?? request.model.compat?.preserve_thinking;
        return typeof v === "boolean" ? v : undefined;
      }
      // similarly clear_thinking
      ```
      ```ts
      options: { compat: { reasoning_effort: "high", thinking_token_budget: 2048,
        chat_template_kwargs: { enable_thinking: true }, preserve_thinking: true, clear_thinking: false } }
      // assert body.reasoning_effort === "high", body.thinking_token_budget === 2048,
      // body.chat_template_kwargs.enable_thinking === true, body.preserve_thinking === true
      ```
    - Files to Create/Edit:
      - `packages/provider-neuralwatt/src/thinking.ts`: add `preserve_thinking`/`clear_thinking` readers if missing.
      - `packages/provider-neuralwatt/src/provider.ts`: serialize the two new fields into the body at documented location.
      - `packages/provider-neuralwatt/src/__tests__/neuralwatt.test.ts`: add reasoning-control pass-through tests.
    - References:
      - `packages/provider-neuralwatt/src/thinking.ts`, `provider.ts`, existing `chat_template_kwargs` test at `neuralwatt.test.ts` line ~327.
  - Execution Notes:
    - Added `neuralWattPreserveThinking()` and `neuralWattClearThinking()` readers to `packages/provider-neuralwatt/src/thinking.ts` (read `request.options.compat` / `request.model.compat`, boolean-typed, return `undefined` otherwise) — mirrors the existing reader pattern.
    - Imported both in `provider.ts` and serialized `preserve_thinking` / `clear_thinking` explicitly in `neuralWattBody()` alongside `reasoning_effort` / `thinking_token_budget` / `chat_template_kwargs`; `clean()` drops them when `undefined` so no spurious fields appear.
    - Added 4 tests in `neuralwatt.test.ts` serializer block: `neuralwatt_preserve_and_clear_thinking_passthrough`, `neuralwatt_preserve_and_clear_thinking_omitted_when_undefined`, `neuralwatt_preserve_and_clear_thinking_from_model_compat`, `neuralwatt_all_reasoning_controls_round_trip` (all five controls together). Existing `neuralwatt_body_includes_reasoning_and_template_fields` already covers effort/budget/enable_thinking.
    - No core contract change: `preserve_thinking`/`clear_thinking` ride only through `compat`/`extra` (existing `JsonObject` escape hatches on `ProviderRequestOptions`); `ProviderRequest`/`Message` untouched.
    - Note on `...compat` spread: the explicit fields read the same `compat` source as the trailing `...request.options?.compat` spread, so values are identical; `extra` still overrides both (existing `neuralwatt_body_extra_escape_hatch_overrides` test still passes).
    - Verification: `npm run build` (tsc clean) + `node --test dist/__tests__/*.test.js` → 62 tests, 61 pass, 1 skipped (live), 0 fail.
  - Test Cases to Write:
    - `neuralwatt_reasoning_effort_passthrough`: validates `compat.reasoning_effort` → body.
    - `neuralwatt_thinking_token_budget_passthrough`: validates budget → body.
    - `neuralwatt_enable_thinking_passthrough`: validates `chat_template_kwargs.enable_thinking` → body (extend existing).
    - `neuralwatt_preserve_clear_thinking_passthrough`: validates both booleans → body.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — reasoning controls are documented pass-through.
    - Docs pages to create/edit:
      - `docs/providers/neuralwatt.md`: document all five reasoning controls and their `compat` keys.
    - `docs/index.md` update: no (NeuralWatt entry exists).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Transcript tests preserving prior assistant reasoning for Kimi/GLM/Qwen-style models without leaking to unsupported providers
  - Acceptance Criteria:
    - Functional: Network-free tests verify prior assistant `reasoning`/`reasoning_content` (thinking content blocks) is preserved in the outbound NeuralWatt request for reasoning-capable models (Kimi/GLM/Qwen-style) and is NOT emitted for models/providers that do not support it (gated by model capability or `compat` flag). No core `Message` contract change.
    - Performance: Mocked `fetch`; serialization stays O(messages + blocks).
    - Code Quality: Reuse existing thinking/reasoning content block types; gating logic is package-local.
    - Security: Preserved reasoning is caller-provided content only; no synthesis of new reasoning; `redactSecrets()` covers captured bodies.
  - Approach:
    - Documentation Reviewed:
      - NeuralWatt reasoning docs: Kimi/GLM/Qwen `reasoning`/`reasoning_content` fields and which models accept prior reasoning in history.
      - `packages/provider-neuralwatt/src/provider.ts` reasoning delta mapping (`delta.reasoning_content` → `providerThinkingDelta`).
      - `docs/providers/neuralwatt.md` reasoning section.
    - Options Considered:
      - Always echo prior reasoning into history: rejected; leaks into unsupported models.
      - Gate on model capability/`compat` flag and serialize into `reasoning`/`reasoning_content` per model family: chosen.
    - Chosen Approach:
      - When serializing prior assistant turns, if the model is reasoning-capable (or `compat.preserve_thinking` is set) and the message has thinking content blocks, emit them in the NeuralWatt body under the documented `reasoning`/`reasoning_content` field; otherwise omit. Add tests for both paths.
    - API Notes and Examples:
      ```json
      { "role": "assistant", "content": "answer", "reasoning": "prior thinking..." }
      ```
      ```ts
      // reasoning-capable model: assert body.messages[1].reasoning === "prior thinking..."
      // non-reasoning model: assert body.messages[1].reasoning === undefined
      ```
    - Files to Create/Edit:
      - `packages/provider-neuralwatt/src/provider.ts`: add gated reasoning-preservation in message serialization.
      - `packages/provider-neuralwatt/src/__tests__/neuralwatt.test.ts`: add preservation and non-leakage tests.
    - References:
      - `packages/provider-neuralwatt/src/provider.ts` message serialization and `delta.reasoning_content` handling; `models.ts` capability flags.
  - Execution Notes:
    - Modified `toMessage()` in `provider.ts` to gate prior `thinking` content blocks: added `preserveReasoning`/`clearReasoning` params computed by `shouldPreserveReasoning()` (`capabilities.reasoning === true` OR `compat.preserve_thinking === true`) and `shouldClearReasoning()` (`compat.clear_thinking === true`).
    - When preserving (and not clearing): prior `thinking` blocks are serialized under a `reasoning_content` field on the assistant message (matching the streaming `delta.reasoning_content` field), and excluded from text `content`. Preserved in both the tool-call branch and the fallthrough branch.
    - When not preserving, or when `clear_thinking` is set: `thinking` blocks are dropped entirely — they no longer leak into text `content` for non-reasoning models (previous behavior flattened them into text). No reasoning is synthesized; only caller-provided blocks are echoed.
    - Added a `describe("... (reasoning preservation)")` block with 5 tests: `neuralwatt_preserves_prior_reasoning_for_reasoning_model`, `neuralwatt_omits_reasoning_for_non_reasoning_model`, `neuralwatt_clear_thinking_drops_reasoning_even_for_reasoning_model`, `neuralwatt_preserve_thinking_flag_forces_preservation_on_non_reasoning_model`, `neuralwatt_reasoning_preserved_alongside_tool_calls`.
    - No core contract change: uses existing `ThinkingContent` (`type: "thinking"`, `text`) and `ModelCapabilities.reasoning`; `Message`/`ProviderRequest` untouched.
    - Docs: added `### Reasoning preservation across turns` to `docs/providers/neuralwatt.md` (gating, `reasoning_content` field, no-leakage, `clear_thinking` precedence, no synthesis); added a paragraph to `docs/agent-session-runtime.md` noting prior thinking is preserved as `thinking` blocks in history and provider packages carry it forward (cross-link to NeuralWatt page).
    - Verification: `npm run build` + `typecheck` clean; `node --test dist/__tests__/*.test.js` → 67 tests, 66 pass, 1 skipped (live), 0 fail; `docs.test.js` → 56 pass, 0 fail.
  - Test Cases to Write:
    - `neuralwatt_preserves_prior_reasoning_for_reasoning_model`: validates reasoning echoed for Kimi/GLM/Qwen-style.
    - `neuralwatt_omits_reasoning_for_non_reasoning_model`: validates no leakage when capability/flag absent.
    - `neuralwatt_preserve_thinking_flag_overrides`: validates `compat.preserve_thinking` forces preservation on capable models.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — reasoning preservation behavior is user-observable.
    - Docs pages to create/edit:
      - `docs/providers/neuralwatt.md`: document reasoning preservation, gating, and `preserve_thinking`/`clear_thinking` semantics.
      - `docs/agent-session-runtime.md`: note that prior reasoning is preserved for reasoning-capable NeuralWatt models across turns.
    - `docs/index.md` update: no (entries exist); verify links.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Tool-call loop test using NeuralWatt OpenAI-style tools and tool results
  - Acceptance Criteria:
    - Functional: Network-free test runs a full tool-call loop — assistant emits tool calls (streamed deltas + final), Prism reconstructs them, caller returns a `tool` message with `tool_result`, second NeuralWatt turn receives the prior `tool_calls` and `tool` result in correct OpenAI-style shape, and a final text answer streams back.
    - Performance: Mocked `fetch` with multi-turn fixtures; no real network.
    - Code Quality: Reuse existing tool-call content blocks (`toolCallContent`, `providerToolCall`, `providerToolCallDelta`) and conformance helpers; no new core types.
    - Security: Tool arguments/results in fixtures are non-sensitive; `redactSecrets()` covers bodies.
  - Approach:
    - Documentation Reviewed:
      - NeuralWatt tool-calling docs: OpenAI-style `tools`, `tool_choice`, `tool_calls`, `tool` role results.
      - `packages/provider-neuralwatt/src/__tests__/neuralwatt.test.ts` existing tool-call delta reconstruction and tool-result serialization tests.
      - `docs/agent-session-runtime.md` agent loop / tool-call transcript section.
    - Options Considered:
      - Test only single-turn tool calls: rejected; Phase 47 requires loop.
      - Multi-turn mocked loop asserting both request bodies: chosen.
    - Chosen Approach:
      - Add a mocked two-turn tool-call loop test: turn 1 streams tool-call deltas → final tool call; caller supplies tool result; turn 2 asserts prior `tool_calls` and `tool` message serialize correctly and final text streams. Reuse existing fixtures and conformance assertions.
    - API Notes and Examples:
      ```ts
      // turn 1 assistant message:
      { role: "assistant", content: [{ type: "tool_call", id: "call_1", name: "lookup", arguments: { q: "x" } }] }
      // turn 2 tool result message:
      { role: "tool", content: [{ type: "tool_result", toolCallId: "call_1", name: "lookup", result: "ok" }] }
      // assert turn-2 body.messages contains the OpenAI-style tool_calls + tool role entries.
      ```
    - Files to Create/Edit:
      - `packages/provider-neuralwatt/src/__tests__/neuralwatt.test.ts`: add `neuralwatt_tool_call_loop` test (or new `neuralwatt-tool-loop.test.ts`).
    - References:
      - Existing tool tests at `neuralwatt.test.ts` lines ~303, ~362, ~456; `provider.ts` tool accumulator and tool-result serialization.
  - Execution Notes:
    - Added a new `describe("... (tool-call loop)")` block in `neuralwatt.test.ts` with 4 tests:
      (1) `neuralwatt_serializes_openai_style_tools_and_tool_choice` — asserts `body.tools` = OpenAI `[{type:"function",function:{name,description,parameters}}]` and `body.tool_choice` passthrough;
      (2) `neuralwatt_serializes_tools_without_description_or_parameters` — missing `parameters` defaults to `{type:"object"}`;
      (3) `neuralwatt_tool_call_loop_reconstructs_then_carries_results_into_next_turn` — full two-turn loop: turn 1 streams tool_call deltas (index/id/name + argument fragments) → `assertToolCallDeltasReconstruct` + exactly one `tool_call` event with parsed `{q:"x"}` arguments; turn 2 request carries `assistant` `tool_call` + `role:tool` `tool_result`, asserts OpenAI ordering (assistant tool_calls then tool result), `tool_calls[].function.arguments` is stringified JSON, `tool` message `tool_call_id` + stringified result content; turn 2 stream returns final text `"x-result is ready"` + `done`;
      (4) `neuralwatt_parallel_tool_calls_reconstruct_by_index` — two parallel calls (index 0/1) reconstruct into two `tool_call` events.
    - Reused existing `ToolAccumulator`, `toTool()`, `toMessage()` tool serialization, `providerToolCall`/`providerToolCallDelta`, `toolCallContent`, `assertToolCallDeltasReconstruct`, and `rawSse`/`sse`/`ok`/`collect` fixtures. No new core types; no `provider.ts` changes (loop is test-driven against existing serialization).
    - Imported `ToolDefinition` and `JsonObject` types from `@arnilo/prism` for fixtures.
    - Docs: added `### Tool calls and the tool-call loop` subsection to `docs/providers/neuralwatt.md` covering request serialization, streaming reconstruction (incl. parallel-by-index), and next-turn OpenAI ordering (assistant `tool_calls` then `role:tool` result with stringified args/result). `docs/agent-session-runtime.md` already documents the loop transcript shape (updated in task 5).
    - Verification: `npm run build` + `typecheck` clean; `node --test dist/__tests__/*.test.js` → 71 tests, 70 pass, 1 skipped (live), 0 fail; `docs.test.js` → 56 pass, 0 fail.
  - Test Cases to Write:
    - `neuralwatt_tool_call_loop`: validates full tool-call loop round-trips through both NeuralWatt request bodies and Prism events.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — tool-call transcript behavior is documented.
    - Docs pages to create/edit:
      - `docs/agent-session-runtime.md`: document NeuralWatt tool-call loop and transcript shape.
      - `docs/providers/neuralwatt.md`: cross-link tool-call section.
    - `docs/index.md` update: no (entries exist); verify links.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Docs sweep: provider-neuralwatt, provider-caching, agent-session-runtime, index navigation
  - Acceptance Criteria:
    - Functional: `/docs/providers/neuralwatt.md`, `/docs/provider-caching.md`, `/docs/agent-session-runtime.md`, and `/docs/index.md` cover cache, cache-aware limiter, reasoning controls, reasoning preservation, and tool-call loop; all internal links resolve; no promise of guaranteed cache hits.
    - Performance: Network-free doc-link check passes.
    - Code Quality: Pages follow the prism-wiki API page structure where applicable; no duplicated sections.
    - Security: No secrets; `cacheRetention: "none"` caveat present.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` structure.
      - Existing `docs/providers/neuralwatt.md`, `docs/provider-caching.md`, `docs/agent-session-runtime.md`, `docs/index.md`.
    - Options Considered:
      - Scatter edits across tasks (done in prior tasks) with a final consistency sweep: chosen.
      - New standalone pages: rejected; duplicates.
    - Chosen Approach:
      - Final consistency pass: ensure all prior-task doc edits landed, cross-links resolve, `docs/index.md` entries point to the right sections, and no cache-hit guarantees.
    - API Notes and Examples:
      ```markdown
      # docs/index.md
      - [NeuralWatt provider](providers/neuralwatt.md) — cache, reasoning, tools, pricing, retry.
      - [Provider caching](provider-caching.md) — explicit and implicit (NeuralWatt) caching.
      - [Agent session runtime](agent-session-runtime.md) — loops, tool transcripts, reasoning preservation.
      ```
    - Files to Create/Edit:
      - `docs/index.md`: verify/update navigation entries and descriptions.
      - `docs/providers/neuralwatt.md`, `docs/provider-caching.md`, `docs/agent-session-runtime.md`: consistency fixes.
    - References:
      - `.agents/skills/create-plan/references/prism-wiki.md`, existing docs index.
  - Execution Notes:
    - Audited all four docs against acceptance criteria: cache, cache-aware limiter, reasoning controls (all five), reasoning preservation, and tool-call loop are covered where relevant — `docs/providers/neuralwatt.md` (Cache behavior, Cache-aware limiter behavior, Reasoning preservation across turns, Tool calls and the tool-call loop sections), `docs/provider-caching.md` (NeuralWatt implicit caching, cached_input_per_million, no cache-hit guarantees), `docs/agent-session-runtime.md` (tool-call loop transcript shape + prior-reasoning preservation paragraph with cross-link to neuralwatt.md).
    - No cache-hit guarantee language in any of the four pages; `cacheRetention: "none"` caveat present in both neuralwatt.md and provider-caching.md.
    - Updated `docs/index.md` navigation descriptions to surface Phase 47 topics: agent-session-runtime entry now mentions tool-call loop transcript and reasoning preservation; provider-caching entry now mentions implicit NeuralWatt caching + cache-aware limiter; NeuralWatt provider entry now lists implicit vLLM prefix caching, the five reasoning controls, reasoning preservation, and OpenAI-style tool-call loop.
    - Added a new `phase47 neuralwatt cache/reasoning/tool docs cover required topics and index links them` test in `src/__tests__/docs.test.ts` that asserts: index links all three pages; neuralwatt.md contains implicit prefix caching, Cache-aware limiter behavior, cached_tokens, cacheRetention:"none", all five reasoning controls, reasoning preservation + tool-call loop sections, and reasoning_content; provider-caching.md contains NeuralWatt/implicit/cached_input_per_million/no-cache-hit-guarantee; agent-session-runtime.md contains thinking/tool_call/tool_result/reasoning_content; and none of the four pages promise guaranteed cache hits. This makes coverage genuinely verifiable rather than a proxy signal.
    - No duplicated sections; all prior-task doc edits (tasks 2–6) confirmed landed via the new test.
    - Verification: `npm run build` clean; `node --test dist/__tests__/docs.test.js` → 57 tests, 57 pass, 0 fail (incl. existing index-links-point-to-existing-files and phase42/43 cache safety tests still green).
  - Test Cases to Write:
    - Network-free docs link/navigation check: all referenced pages and anchors exist; index entries present.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — navigation and cross-links.
    - Docs pages to create/edit:
      - `docs/index.md`: navigation entries/descriptions.
      - `docs/providers/neuralwatt.md`, `docs/provider-caching.md`, `docs/agent-session-runtime.md`: consistency.
    - `docs/index.md` update: yes — verify entries for NeuralWatt, caching, agent runtime.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Reasoning preservation is package-local to NeuralWatt (gated on `capabilities.reasoning` / `compat.preserve_thinking` in `toMessage()`); other providers keep their own serialization. A shared core helper was not introduced because no second provider needed it yet (YAGNI); a future provider that needs the same gating can extract `shouldPreserveReasoning`/`shouldClearReasoning` into a shared helper.
- The NeuralWatt static catalog intentionally omits pricing (per documented design); the 25% cached-input pricing relationship is only testable through the `listNeuralWattModels()` discovery path with fixtures, not against static aliases.
- Cache-aware limiter behavior is documented from NeuralWatt's described backend semantics (uncached TPM, warm-prefix, 503, full prior history); it is not exercised by a live integration test, only by network-free doc assertions.

## Further Actions
- (Low) If a second provider adopts reasoning-preservation gating, extract `shouldPreserveReasoning`/`shouldClearReasoning` into a shared `@arnilo/prism` helper to avoid duplication.
- (Low) Add a live integration test for cache-aware limiter behavior once a stable NeuralWatt test endpoint is available; today it is documented-only.
- (Low) Consider exporting `neuralWattPreserveThinking`/`neuralWattClearThinking` from the package index if a host needs to read them outside `neuralWattBody()`; currently they are internal readers used only by the body builder.
