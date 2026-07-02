# Phase 44 — First-party provider cache behavior hardening

## Objectives
- Harden first-party provider cache request mapping so Prism cache intent becomes valid provider payloads/headers.
- Preserve normalized cache read/write token accounting for every first-party provider.
- Prevent caller-provided headers/options from overriding provider-owned auth/session/security headers.
- Keep core provider behavior generic; no provider-specific cache policy moves into core contracts.
- Update provider cache docs and package READMEs named by the roadmap.

## Expected Outcome
- OpenAI, OpenRouter, OpenCode Go, Z.AI, and Kimi packages serialize cache keys, retention, breakpoints, session ids, and usage consistently with provider limits.
- The OpenAI-compatible core adapter either passes only supported generic provider options safely or documents its minimal Chat Completions scope.
- Provider conformance tests catch invalid cache retention values, over-broad `cache_control`, bad usage normalization, and user header takeover of auth/session headers.
- Docs explain supported/unsupported cache behavior per first-party provider without promising cache hits.

## Tasks

- [x] Inventory current cache behavior and provider limits
  - Acceptance Criteria:
    - Functional: Record current cache request/usage/header behavior for `src/providers/openai-compatible.ts`, shared cache helpers, and all five first-party provider packages before editing runtime code.
    - Performance: Identify changes that stay O(messages + content blocks) and do not add provider calls, tokenization, hashing, or dependencies.
    - Code Quality: Reuse `src/cache-helpers.ts` and existing package-local helpers where possible; reject new abstractions until repeated logic exists in at least two providers.
    - Security: Identify every provider-owned header (`authorization`, session/sticky routing headers, app headers) and where user headers can currently override them.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 44 — First-party provider cache behavior hardening.
      - `plans/043-prompt-cache-primitives-and-provider-capability-metadata.md` and `plans/044-cache-aware-input-ordering-and-diagnostics.md` for cache primitives and input ordering.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
      - `docs/provider-caching.md`, `docs/provider-packages.md`, `docs/provider-request-policies.md`, `docs/providers/openai.md`, `docs/providers/openrouter.md`, `docs/providers/opencode-go.md`, `docs/providers/zai.md`, `docs/providers/kimi.md`, `docs/providers/openai-compatible.md`.
      - OpenAI docs: Prompt caching and Responses API reference (`prompt_cache_key`, extended 24h prompt caching, cached token usage).
      - OpenRouter docs: Prompt Caching guide and Messages API (`session_id <= 256`, sticky routing, `cache_control`).
      - Anthropic docs: Prompt caching (`cache_control`, `cache_read_input_tokens`, `cache_creation_input_tokens`).
    - Options Considered:
      - Patch each failing test directly in provider serializers: fastest but risks inconsistent limits and headers.
      - Inventory first, then apply provider-local minimal fixes with shared helpers only where already present: chosen.
      - Add a new cross-provider cache policy engine: too much surface for hardening; rejected.
    - Chosen Approach:
      - Build a small matrix of provider input knobs, max key/session length, retention support, breakpoint support, usage fields, and protected headers. Then implement only the gaps from that matrix.
    - API Notes and Examples:
      ```ts
      import { sanitizeCacheKey, applyCacheControl } from "@arnilo/prism";

      const key = sanitizeCacheKey(request.options?.cacheKey ?? request.options?.sessionId, 64);
      const cachedMessages = applyCacheControl(request.messages, request.options?.cacheBreakpoints ?? [], { maxBreakpoints: 4 });
      ```
    - Files to Create/Edit:
      - `plans/045-first-party-provider-cache-behavior-hardening.md`: updated with the inventory findings below and marked complete.
      - Runtime/source files: none changed; inventory-only.
    - References:
      - `src/cache-helpers.ts`: `sanitizeCacheKey()`, `mapCacheRetention()`, `applyCacheControl()`, `cacheHitRate()`, `cacheSavings()`, `cacheUsageReport()`.
      - `packages/provider-openai/src/cache.ts`, `packages/provider-openrouter/src/cache.ts`, `packages/provider-opencode-go/src/cache.ts`.
      - `packages/provider-*/src/__tests__/*test.ts` existing mocked fetch/SSE coverage.
  - Inventory Findings (per provider and core):
    - Core contracts (`src/contracts.ts`):
      - `ProviderRequestOptions` exposes both structured `cache?: PromptCacheHints` (mode/key/retention/breakpoints) and legacy `cacheKey`/`cacheRetention`. `PromptCacheBreakpoint.ttl` is generic `"short"|"long"`. `ModelCacheCapabilities` carries `kind`, `maxKeyLength`, `maxBreakpoints`, `minCacheableTokens`, `longRetention`. No first-party model metadata currently sets `ModelConfig.cache` (only OpenRouter uses a `compat.openRouterCache` boolean, not `ModelCacheCapabilities`).
      - `Usage` normalizes `cacheReadTokens`/`cacheWriteTokens`; `ModelCost` carries `cacheRead`/`cacheWrite` pricing.
    - Core helpers (`src/cache-helpers.ts`): generic and provider-name-free. `sanitizeCacheKey(value, maxLength)` strips non-`[A-Za-z0-9_.:-]` and clamps; `mapCacheRetention(retention, model)` downgrades `"long"`→`"short"` when `model.cache?.longRetention === false` and returns `undefined` for `"none"`; `applyCacheControl(messages, breakpoints, {ttl,maxBreakpoints})` stamps `{type:"ephemeral"}` only on selected breakpoint anchor blocks; `cacheHitRate`/`cacheSavings`/`cacheUsageReport` are O(1) over `Usage`.
    - Core OpenAI-compatible adapter (`src/providers/openai-compatible.ts`):
      - `toOpenAIRequest()` sends no cache fields at all (only `model.parameters` spread). Adapter is minimal Chat Completions only — no `prompt_cache_key`, no `cache_control`.
      - Usage maps `prompt_tokens_details.cached_tokens` OR `prompt_cache_hit_tokens` → `cacheReadTokens`, and `cache_write_tokens` → `cacheWriteTokens`. ✓
      - Header merge: `...request.options?.headers` first, then `content-type`, then `authorization` → provider-owned `authorization`/`content-type` win. ✓ Test asserts caller header `x-demo`/`x-caller` is kept while `authorization`/`content-type` are provider-owned.
      - Gap vs roadmap: nothing to harden; document it as minimal Chat Completions (no cache payload/retention mapping). Do not add provider-specific cache fields here.
    - OpenAI Responses package (`packages/provider-openai/src/cache.ts`, `responses.ts`):
      - `promptCacheKey()` = `(cacheKey ?? sessionId).slice(0, 64)` — length clamp only, NO character sanitization (re-implements `sanitizeCacheKey` minus the char-class strip). Should reuse core `sanitizeCacheKey(..., 64)`.
      - `promptCacheRetention()` returns `cacheRetention` literally except `"none"`→undefined. So `"short"`→`prompt_cache_retention: "short"` and `"long"`→`prompt_cache_retention: "long"`. OpenAI Responses API only supports an absent field (default short caching) or `"24h"` for extended caching — literal `"short"`/`"long"` are INVALID values. This is the Phase-44 OpenAI hardening target. Existing test `openai.test.ts` actually asserts `prompt_cache_retention === "short"` (line ~39), so the test encodes the wrong expectation and must be corrected when `long`→`"24h"` and `short`→omit.
      - Responds NO `ModelConfig.cache` metadata; `cacheRetention: "long"` is sent even when the model does not support long retention. Should gate via model `cache.longRetention`/compat or omit long unless explicitly supported.
      - Usage maps `input_tokens_details.cached_tokens` → `cacheReadTokens`; no cache-write field reported by OpenAI Responses. ✓
      - Headers: `content-type`, `...request.options?.headers`, `authorization`, `x-client-request-id` (sessionId) → provider-owned win. ✓ Test confirms.
    - OpenRouter package (`packages/provider-openrouter/src/cache.ts`, `provider.ts`, `model.ts`):
      - `openRouterSessionId()` = `(cacheKey ?? sessionId)` sanitized + clamped to **128** chars; OpenRouter docs cap `session_id` at **256**, so the clamp is overly strict but safe. Both `session_id` body field and `x-session-id` header set from it. ✓
      - `withOpenRouterCache(message, enabled)` applies `cache_control: { type: "ephemeral" }` to **every content block of every cached message** — over-broad and ignores `PromptCacheHints.breakpoints` entirely. `enabled` is driven only by `model.compat?.openRouterCache === true`; structured `options.cache.breakpoints`/`options.cache` is never read. This is the Phase-44 OpenRouter hardening target: apply cache-control only to chosen Prism breakpoints (reuse `applyCacheControl()` logic over selected breakpoints), cap by OpenRouter max breakpoints, and optionally honor `ttl` (OpenRouter/Anthropic support `ttl: "1h"`).
      - No `ModelCacheCapabilities` metadata (`model.ts` has `compat.openRouterCache?: boolean` only); should map to `ModelCacheCapabilities.kind: "cache_control"`/`maxBreakpoints` for consistency, but package-local compat gate stays acceptable.
      - `openRouterUsage()` maps `prompt_tokens_details.cached_tokens` → `cacheReadTokens`, `cache_write_tokens` → `cacheWriteTokens`. ✓
      - Header merge: `...request.options?.headers`, then `content-type`, `authorization`, `x-session-id`, `http-referer`, `x-title` → provider-owned win. ✓ Test `openrouter_keeps_provider_owned_headers_after_caller_headers` asserts caller `authorization: "Bearer attacker"`/`x-session-id: "attacker-session"` are overridden while `x-caller` is kept.
    - OpenCode Go package (`packages/provider-opencode-go/src/cache.ts`, `provider.ts`, `anthropic-messages.ts`, `openai-chat.ts`):
      - `opencodeHeaders()` uses ONLY `options.sessionId` for `x-opencode-session` — `cacheKey` is ignored. Roadmap wants `cacheKey ?? sessionId`. Sanitized/clamped to 128. ✓
      - Header merge (`provider.ts`): `content-type`, `...opencodeHeaders(options)` (which itself spreads caller `options.headers` first), then `authorization` → `authorization` wins; `x-opencode-session` is set inside `opencodeHeaders` AFTER the caller `headers` spread so it also wins. ✓ Test `opencode_go_applies_session_cache_headers_and_max_tokens` confirms sanitization (`"session with spaces"`→`"session-with-spaces"`) and `authorization`.
      - `anthropicMessagesBody()` — NO `cache_control` applied at all (Anthropic-compatible route accepts content-block `cache_control`). `openAIChatBody()` — no cache fields. So route-specific cache control is entirely unimplemented; Phase-44 target is to add Anthropic-route breakpoint `cache_control` only where compatible and leave OpenAI route session-only.
      - Usage: anthropic route maps `cache_read_input_tokens`/`cache_creation_input_tokens`; openai route maps `prompt_tokens_details.cached_tokens`/`cache_write_tokens`. ✓ both tested.
    - Z.AI package (`packages/provider-zai/src/provider.ts`):
      - `zaiBody()` sends NO cache payload; Z.AI/GLM uses implicit context caching. No fake no-op cache field is emitted. ✓ (correct as-is; needs test + docs to lock this in.)
      - Usage maps `prompt_tokens_details.cached_tokens` → `cacheReadTokens`, `cache_write_tokens` → `cacheWriteTokens`. ✓ extraction present and tested.
      - Headers: `content-type`, `...request.options?.headers`, `authorization` → `authorization` wins. No user-agent/session header. ✓
      - Gap vs roadmap: confirm docs state implicit caching behavior; add/keep a test asserting no invalid cache-control/retention fields are emitted.
    - Kimi package (`packages/provider-kimi/src/provider.ts`):
      - Anthropic-compatible `/messages` endpoint; `kimiAnthropicBody()` sends NO `cache_control` (no breakpoint mapping) despite being Anthropic-shaped. Phase-44 target: add Anthropic-style cache control only if the coding endpoint accepts it, else document unsupported.
      - Usage maps `cache_read_input_tokens` → `cacheReadTokens`, `cache_creation_input_tokens` → `cacheWriteTokens`. ✓
      - Headers: `content-type`, `user-agent` (default `KimiCLI/1.5`), `...request.options?.headers`, `authorization` → `authorization` wins, BUT `user-agent` is set BEFORE caller headers, so a caller header `user-agent` would OVERRIDE the provider default. Minor header-ownership gap to consider (provider-owned `user-agent` should be applied after caller headers if it is treated as provider policy).
    - Conformance helper (`src/testing/provider-conformance.ts`): `assertUsageAccounting()` checks `cacheReadTokens`/`cacheWriteTokens`; `assertNoSecretLeak()`; `assertSerializedRequestCoversContent()` (canary-based). No generic cache-payload-shape assertion and no generic header-ownership assertion. Header-ownership tests are currently per-package (openrouter, openai-compatible) and could be promoted to a shared helper if duplication grows; for now per-package tests are fine.
    - Docs (`docs/provider-caching.md`, `docs/provider-packages.md`):
      - `provider-caching.md` documents structured hints, legacy aliases, helpers, `mapCacheRetention()` downgrade, `applyCacheControl()` per-breakpoint stamping, `cacheUsageReport()`, cache-aware input layout, and the rule that provider-owned auth/session/security headers always win. Has a generic mapping table by `ModelCacheCapabilities.kind`, NOT a per-first-party-provider support table.
      - `provider-packages.md` documents the header-merge rule (provider-owned headers last) and `maxTokens` mapping. Provider-specific cache behavior pages (`docs/providers/*.md`) exist per provider; their current cache wording should be verified/aligned in later tasks.
    - Cross-cutting gaps for later tasks:
      - OpenAI invalid retention values (`"short"`/`"long"` literals) + wrong test expectation.
      - OpenRouter over-broad per-block `cache_control` ignoring breakpoints/ttl.
      - OpenCode Go ignores `cacheKey` for session header and has no route cache control.
      - No first-party provider sets `ModelCacheCapabilities` (only OpenRouter compat flag); long-retention gating via `mapCacheRetention(model)` is unused by packages.
      - Kimi header-order gap on provider `user-agent`.
      - Z.AI/Kimi need explicit unsupported-behavior tests/docs.
    - Performance: every targeted change is constant-time over messages/blocks or O(messages × selected breakpoints) via the existing `applyCacheControl` helper. No new provider calls, tokenization, hashing, or dependencies introduced.
    - Security: provider-owned headers already win for `authorization`/`content-type`/session/sticky/app headers in OpenAI, OpenAI-compatible, OpenRouter, OpenCode Go (sessionId path), and Z.AI. Only Kimi `user-agent` is set before caller headers. Cache keys are session/customer identifiers, never credentials; usage extraction carries only numeric counts. No secrets enter cache payloads, usage, headers, or docs.
  - Verification:
    - Read `src/contracts.ts` (cache/usage types), `src/cache-helpers.ts`, `src/providers/openai-compatible.ts`, all four package-local `cache.ts`/`provider.ts`/route serializers, `src/testing/provider-conformance.ts`, `docs/provider-caching.md`, `docs/provider-packages.md`.
    - Confirmed existing cache/header/usage test assertions via `rg` in `packages/provider-*/src/__tests__/*.test.ts` and `src/__tests__/openai-compatible.test.ts`.
    - Confirmed OpenAI docs (Prompt Caching guide + Responses API reference) and OpenRouter/Anthropic docs limits cited in this task.
    - No runtime/source files changed; only this plan task was updated and marked complete.
  - Test Cases to Write:
    - Inventory-only task; no product test required. Later tasks list exact per-provider tests for retention mapping, breakpoint cache-control, session/key precedence, usage extraction, and header ownership.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; inventory only.
    - Docs pages to create/edit:
      - `none`: later tasks own docs changes.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Harden OpenAI package and OpenAI-compatible adapter cache behavior
  - Acceptance Criteria:
    - Functional: OpenAI Responses maps Prism `cacheRetention: "long"` to OpenAI `prompt_cache_retention: "24h"` only for supported models/options, omits `short` instead of emitting invalid retention, clamps/sanitizes keys, and keeps `cached_tokens` mapped to `Usage.cacheReadTokens`. The OpenAI-compatible core adapter either safely passes documented generic cache options or its docs explicitly state minimal Chat Completions cache behavior.
    - Performance: Key/retention mapping is constant-time; usage extraction remains one pass over stream chunks.
    - Code Quality: Keep OpenAI-specific mapping in `packages/provider-openai`; core adapter remains provider-name-free and minimal.
    - Security: Provider `authorization` and request/session headers are set after user headers so caller config cannot replace credentials or owned request ids.
  - Approach:
    - Documentation Reviewed:
      - OpenAI Prompt Caching guide: automatic prompt caching, `prompt_cache_key`, extended 24h caching.
      - OpenAI Responses API reference: `/responses` request fields.
      - `docs/providers/openai.md`, `docs/providers/openai-compatible.md`, `docs/provider-caching.md`.
      - `packages/provider-openai/src/responses.ts`, `packages/provider-openai/src/cache.ts`, `packages/provider-openai/src/__tests__/openai.test.ts`.
      - `src/providers/openai-compatible.ts` and its tests.
    - Options Considered:
      - Treat Prism `long` as literal `"long"`: invalid for OpenAI; rejected.
      - Omit `prompt_cache_retention` for `short` and use `"24h"` for supported long retention: chosen.
      - Add full cache support to the core OpenAI-compatible adapter: likely overreach; only pass safe existing generic options if already supported, otherwise document minimal scope.
    - Chosen Approach:
      - Replace OpenAI package cache helper with `sanitizeCacheKey(..., 64)` and an OpenAI retention mapper returning `"24h" | undefined`. Add model/compat gate if current metadata already exposes long-retention support; otherwise omit long unless explicit compat says supported.
      - Audit header construction order in OpenAI package and core adapter; ensure provider-owned headers win.
    - API Notes and Examples:
      ```ts
      createOpenAIResponsesProvider();
      // request.options: { cacheKey: "team:session", cacheRetention: "long" }
      // payload: { prompt_cache_key: "team:session", prompt_cache_retention: "24h" } when supported
      ```
    - Files to Create/Edit:
      - `packages/provider-openai/src/cache.ts`: rewrote to use shared `sanitizeCacheKey(..., 64)` for `promptCacheKey()` and a `promptCacheRetention(options, model)` returning `"24h" | undefined` (long → `"24h"` only when `model.cache?.longRetention === true`; short/none → undefined). Exported `OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH`.
      - `packages/provider-openai/src/responses.ts`: pass `request.model` to `promptCacheRetention()`; reordered header construction so caller `headers` spread first, then provider-owned `content-type`, `authorization`, `x-client-request-id`.
      - `packages/provider-openai/src/models.ts`: catalog `gpt-5.1` declares `cache: { kind: "openai_key", longRetention: true, maxKeyLength: 64 }` so long retention is opted-in per model.
      - `packages/provider-openai/src/__tests__/openai.test.ts`: corrected the `"short"` retention assertion (now omits the field), added long-retention gating, key sanitization/clamp, and provider-owned header ownership tests.
      - `src/providers/openai-compatible.ts`: unchanged (minimal Chat Completions, no cache payload); confirmed no cache fields are sent and usage still maps `cached_tokens`/`prompt_cache_hit_tokens`.
      - `src/__tests__/openai-compatible.test.ts`: unchanged (existing header-ownership and usage tests already cover the adapter).
      - `docs/providers/openai.md`: added a "Cache behavior" section documenting key sanitization/clamp, retention mapping gating, `cached_tokens` usage mapping, and header ownership.
      - `docs/providers/openai-compatible.md`: documented minimal Chat Completions cache scope (no cache payload) and usage normalization.
      - `docs/provider-caching.md`: added first-party OpenAI Responses and OpenAI-compatible adapter rows to the provider mapping table.
      - `packages/provider-openai/README.md`: added cache behavior bullets.
    - References:
      - Roadmap Phase 44 OpenAI bullets.
      - OpenAI docs cited above.
      - `src/cache-helpers.ts` `sanitizeCacheKey()`.
  - Test Cases Written:
    - `openai_responses_applies_prompt_cache_policy_session_headers_and_max_tokens`: now asserts `prompt_cache_retention` is omitted for `"short"` (was incorrectly asserting `"short"`).
    - `openai_responses_long_retention_emits_24h_only_when_supported`: long + `cache.longRetention: true` → `"24h"`; long + unknown model → omitted.
    - `openai_responses_sanitizes_and_clamps_prompt_cache_key`: disallowed chars stripped, clamped to 64.
    - `openai_responses_keeps_provider_owned_headers_after_caller_headers`: caller `authorization`/`content-type`/`x-client-request-id` overridden by provider-owned; `x-caller` kept.
    - Existing usage test (`openai_responses_stream_maps...`) covers `input_tokens_details.cached_tokens` → `cacheReadTokens`.
  - Verification:
    - `npx tsc -p tsconfig.json` (core) and `npx tsc -p packages/provider-openai/tsconfig.json` both pass with no errors.
    - `node --test dist/__tests__/docs.test.js dist/__tests__/openai-compatible.test.js packages/provider-openai/dist/__tests__/openai.test.js packages/provider-openai/dist/__tests__/codex-oauth.test.js` → 80 pass, 0 fail (includes docs structural + cache + header ownership + codex Responses reuse).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; provider package request behavior, usage behavior, and docs-visible cache support change.
    - Docs pages to create/edit:
      - `docs/providers/openai.md`: cache key/retention and usage mapping.
      - `docs/providers/openai-compatible.md`: adapter cache scope.
      - `docs/provider-caching.md`: first-party provider support table.
      - `packages/provider-openai/README.md`: package cache notes.
    - `docs/index.md` update: no new page; existing provider/cache entries stay valid unless link text needs provider-cache wording.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Harden OpenRouter cache/session behavior
  - Acceptance Criteria:
    - Functional: OpenRouter uses `session_id`/`x-session-id` within documented limits, applies Anthropic-style `cache_control` only to selected Prism breakpoints instead of every content block, preserves `cached_tokens` and `cache_write_tokens`, and keeps provider auth/app/session headers authoritative over user headers.
    - Performance: Cache-control application stays O(messages × selected breakpoints) with the existing helper and no token counting.
    - Code Quality: Reuse `applyCacheControl()` or a tiny provider-local adapter; avoid OpenRouter-specific branches in core.
    - Security: Caller headers cannot override `authorization`, `x-session-id`, `http-referer`, or `x-title` when provider options own them.
  - Approach:
    - Documentation Reviewed:
      - OpenRouter Prompt Caching guide: sticky routing, implicit/explicit caching, `cache_control`.
      - OpenRouter API reference: `session_id <= 256`.
      - Anthropic Prompt Caching docs for content-block `cache_control` semantics.
      - `docs/providers/openrouter.md`, `docs/provider-caching.md`.
      - `packages/provider-openrouter/src/provider.ts`, `packages/provider-openrouter/src/cache.ts`, `packages/provider-openrouter/src/__tests__/openrouter.test.ts`.
    - Options Considered:
      - Keep current all-block `cache_control`: over-broad and can create invalid/provider-wasteful payloads; rejected.
      - Use only top-level automatic cache control: less precise and not aligned with Prism breakpoints; rejected unless OpenRouter route requires it.
      - Apply cache control to `request.options.cacheBreakpoints` using existing helper, capped by model/provider metadata: chosen.
    - Chosen Approach:
      - Sanitize/clamp session ids with documented OpenRouter limit. Feed selected breakpoints into cache-control mapping before OpenRouter message conversion where possible; if conversion must happen first, keep mapping provider-local and only mark chosen content block endings.
      - Reverse/adjust header merge so provider-owned auth/session/app headers win.
    - API Notes and Examples:
      ```ts
      await provider.generate({
        ...request,
        options: { cacheKey: "agent-session", cacheBreakpoints: [{ location: "last_stable_message" }] },
      });
      // Only chosen breakpoint content block gets { cache_control: { type: "ephemeral" } }.
      ```
    - Files to Create/Edit:
      - `packages/provider-openrouter/src/cache.ts`: session id and breakpoint cache-control mapping.
      - `packages/provider-openrouter/src/provider.ts`: body/header integration.
      - `packages/provider-openrouter/src/__tests__/openrouter.test.ts`: payload shape, usage, header ownership tests.
      - `docs/providers/openrouter.md`, `docs/provider-caching.md`, `packages/provider-openrouter/README.md`.
    - References:
      - `src/cache-helpers.ts` `applyCacheControl()` and `sanitizeCacheKey()`.
      - Roadmap Phase 44 OpenRouter bullets.
  - Test Cases Written:
    - `openrouter_applies_cache_control_only_to_selected_breakpoints`: 3-message conversation; only the `last_stable_message` (index 1) gets a `cache_control` marker on its last block; messages 0 and 2 carry no marker.
    - `openrouter_no_breakpoints_emits_no_cache_control_markers`: with no breakpoints, no block gets a marker.
    - `openrouter_long_retention_emits_1h_ttl_marker`: `cacheRetention: "long"` + `cache.longRetention: true` → `{ type: "ephemeral", ttl: "1h" }`.
    - `openrouter_session_id_sanitized_and_clamped_to_256`: `cacheKey` with disallowed chars + 300+ chars → sanitized, ≤256, `session_id === x-session-id`.
    - `openrouter_keeps_provider_owned_headers_after_caller_headers`: caller headers overridden by provider-owned; `x-caller` kept.
    - `openrouter_maps_cache_read_write_usage`: `cached_tokens` → `cacheReadTokens`, `cache_write_tokens` → `cacheWriteTokens`.
  - Verification (Task 3):
    - `npx tsc -p tsconfig.json` (core) and `npx tsc -p packages/provider-openrouter/tsconfig.json` both pass.
    - `node --test dist/__tests__/docs.test.js packages/provider-openrouter/dist/__tests__/openrouter.test.js` → 66 pass, 0 fail.
  - Implementation notes:
    - `packages/provider-openrouter/src/cache.ts`: rewrote — `openRouterSessionId(options)` uses shared `sanitizeCacheKey(..., 256)`; added `openRouterCacheEnabled`, `applyOpenRouterCacheControl` (core `applyCacheControl` with breakpoints + model `maxBreakpoints`, long-retention → `ttl: "1h"`), `openRouterCacheTtl`; replaced per-block `withOpenRouterCache` with `withOpenRouterCacheMarker` (marker preservation only).
    - `packages/provider-openrouter/src/provider.ts`: `openRouterBody` applies `applyOpenRouterCacheControl(request)` before conversion; `toOpenRouterMessage` accepts `CacheControlledMessage` and preserves `cache_control` on the last block of selected messages, skipping the single-text-block collapse when a marker is present.
    - `packages/provider-openrouter/src/__tests__/openrouter.test.ts`: replaced the all-blocks assertion with breakpoint/no-breakpoint/long-ttl/session-clamp tests.
    - `docs/providers/openrouter.md`, `docs/provider-caching.md`, `packages/provider-openrouter/README.md`: added cache/session/header behavior sections.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; OpenRouter provider cache/session behavior changes.
    - Docs pages to create/edit:
      - `docs/providers/openrouter.md`: cache/session/header behavior.
      - `docs/provider-caching.md`: OpenRouter provider notes.
      - `packages/provider-openrouter/README.md`: cache example.
    - `docs/index.md` update: no new page; existing provider and caching links remain.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Harden OpenCode Go route-specific cache behavior
  - Acceptance Criteria:
    - Functional: OpenCode Go uses `cacheKey ?? sessionId` for `x-opencode-session`, applies route-compatible cache control only on Anthropic-compatible routes that accept it, and preserves OpenAI-compatible and Anthropic-compatible usage extraction.
    - Performance: Header/session mapping is constant-time; cache-control mapping remains bounded by selected breakpoints.
    - Code Quality: Keep route-specific logic in existing `openai-chat.ts` / `anthropic-messages.ts` serializers and package-local `cache.ts`; no new route abstraction unless tests require duplicated code removal.
    - Security: Provider `authorization` and `x-opencode-session` headers win over caller headers.
  - Approach:
    - Documentation Reviewed:
      - `docs/providers/opencode-go.md`, `docs/provider-caching.md`.
      - `packages/provider-opencode-go/src/provider.ts`, `packages/provider-opencode-go/src/cache.ts`, `packages/provider-opencode-go/src/openai-chat.ts`, `packages/provider-opencode-go/src/anthropic-messages.ts`, tests.
      - Anthropic Prompt Caching docs for route-compatible `cache_control`.
      - OpenAI-compatible cache behavior from Prism Phase 42/43 docs.
    - Options Considered:
      - Put `cache_control` on both routes blindly: risks invalid OpenAI-compatible payloads; rejected.
      - Only set session header and document content cache unsupported: acceptable fallback if OpenCode docs/tests show no route accepts `cache_control`.
      - Add Anthropic-route cache-control support and leave OpenAI route session-only: chosen if current serializer supports content blocks.
    - Chosen Approach:
      - Change `opencodeHeaders()` to prefer `cacheKey` over `sessionId` and sanitize/clamp once. Add route-compatible cache-control mapping to `anthropicMessagesBody()` only if supported by its wire shape; otherwise document unsupported content cache.
    - API Notes and Examples:
      ```ts
      // OpenCode session stickiness uses cache intent first, then runtime session.
      opencodeHeaders({ cacheKey: "repo-prefix", sessionId: "run-1" });
      // => { "x-opencode-session": "repo-prefix" }
      ```
    - Files to Create/Edit:
      - `packages/provider-opencode-go/src/cache.ts`: `cacheKey ?? sessionId` session header and header ownership helper.
      - `packages/provider-opencode-go/src/provider.ts`: header merge order if needed.
      - `packages/provider-opencode-go/src/anthropic-messages.ts`: route-compatible cache-control mapping if supported.
      - `packages/provider-opencode-go/src/openai-chat.ts`: usage/cache extraction assertions if needed.
      - `packages/provider-opencode-go/src/__tests__/opencode-go.test.ts`: session, route payload, usage, header tests.
      - `docs/providers/opencode-go.md`, `docs/provider-caching.md`, `packages/provider-opencode-go/README.md`.
    - References:
      - Roadmap Phase 44 OpenCode Go bullets.
      - `packages/provider-opencode-go/src/cache.ts` current `sessionId`-only behavior.
  - Test Cases Written:
    - `opencode_go_session_id_prefers_cacheKey_over_sessionId_and_sanitizes`: `cacheKey` wins over `sessionId`; fallback to `sessionId`; sanitized.
    - `opencode_go_anthropic_route_applies_cache_control_only_to_selected_breakpoints`: 3-message conversation; only the `last_stable_message` (assistant) gets a `cache_control` marker; user messages carry none.
    - `opencode_go_anthropic_route_long_retention_emits_1h_ttl`: `cacheRetention: "long"` + `cache.longRetention: true` → `{ type: "ephemeral", ttl: "1h" }`.
    - `opencode_go_anthropic_route_no_breakpoints_emits_no_cache_control`: no breakpoints → no markers.
    - `opencode_go_openai_route_never_receives_anthropic_cache_control`: OpenAI route body contains no `cache_control` even with cache metadata + breakpoints.
    - `opencode_go_keeps_provider_owned_headers_after_caller_headers`: caller `authorization`/`content-type`/`x-opencode-session` overridden by provider-owned; `x-caller` kept.
    - Existing `openai_route_streams...` and `anthropic_route_streams...` tests cover per-route usage extraction (`cached_tokens`/`cache_write_tokens` and `cache_read_input_tokens`/`cache_creation_input_tokens`).
  - Verification (Task 4):
    - `npx tsc -p tsconfig.json` (core) and `npx tsc -p packages/provider-opencode-go/tsconfig.json` both pass.
    - `node --test dist/__tests__/docs.test.js packages/provider-opencode-go/dist/__tests__/opencode-go.test.js` → 68 pass, 0 fail.
  - Implementation notes:
    - `packages/provider-opencode-go/src/cache.ts`: rewrote — `opencodeSessionId(options)` uses shared `sanitizeCacheKey(..., 128)` preferring `cacheKey ?? sessionId`; `opencodeOwnedHeaders` returns provider-owned `content-type` + `x-opencode-session`; added `opencodeAnthropicCacheEnabled`, `applyOpencodeAnthropicCacheControl` (core `applyCacheControl` with breakpoints + model `maxBreakpoints`, long-retention → `ttl: "1h"`), `opencodeAnthropicCacheTtl`.
    - `packages/provider-opencode-go/src/provider.ts`: header order now `...caller headers`, then `opencodeOwnedHeaders` (content-type + x-opencode-session), then `authorization` last.
    - `packages/provider-opencode-go/src/anthropic-messages.ts`: `anthropicMessagesBody` applies `applyOpencodeAnthropicCacheControl(request)`; `toMessage` accepts `CacheControlledMessage` and preserves `cache_control` markers on the last block of selected messages (text/thinking/image/tool_use/tool_result).
    - `packages/provider-opencode-go/src/openai-chat.ts`: unchanged (OpenAI route sends no Anthropic `cache_control`); usage extraction unchanged.
    - `docs/providers/opencode-go.md`, `docs/provider-caching.md`, `packages/provider-opencode-go/README.md`: added cache/session/header behavior sections.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; OpenCode Go provider request/header/cache behavior changes.
    - Docs pages to create/edit:
      - `docs/providers/opencode-go.md`: route-specific cache behavior.
      - `docs/provider-caching.md`: OpenCode Go row/notes.
      - `packages/provider-opencode-go/README.md`: session/cache example.
    - `docs/index.md` update: no new page; existing links remain.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Harden Z.AI and Kimi cache usage/support behavior
  - Acceptance Criteria:
    - Functional: Z.AI docs state implicit context caching behavior and tests preserve `cached_tokens`/`cache_write_tokens` extraction. Kimi adds Anthropic-style cache control only if the coding endpoint accepts it; otherwise docs explicitly state unsupported request cache-control behavior. Kimi tests preserve `cache_read_input_tokens` and `cache_creation_input_tokens` extraction.
    - Performance: Usage mapping remains constant-time per usage chunk; cache-control mapping, if added, uses existing selected breakpoint logic.
    - Code Quality: Keep unsupported provider behavior as docs/tests, not fake no-op payload fields. Avoid shared abstraction for two mostly independent serializers.
    - Security: Provider auth/user-agent headers remain provider-owned where configured and cannot be overwritten by caller headers.
  - Approach:
    - Documentation Reviewed:
      - `docs/providers/zai.md`, `docs/providers/kimi.md`, `docs/provider-caching.md`.
      - `packages/provider-zai/src/provider.ts`, `packages/provider-zai/src/__tests__/zai.test.ts`.
      - `packages/provider-kimi/src/provider.ts`, `packages/provider-kimi/src/__tests__/kimi.test.ts`.
      - Anthropic Prompt Caching docs for Kimi-compatible `cache_control` shape and usage fields.
      - Z.AI/Kimi provider package README cache notes already present in this repository.
    - Options Considered:
      - Add `cache_control` to Z.AI despite implicit caching: invalid/speculative; rejected.
      - Add Kimi `cache_control` to every content block: over-broad; rejected.
      - Add Kimi selected breakpoint support only if endpoint compatibility is documented/testable, else document unsupported: chosen.
    - Chosen Approach:
      - For Z.AI, only add/strengthen tests and docs around implicit caching plus usage extraction.
      - For Kimi, either map Prism breakpoints to Anthropic content-block cache-control in `kimiAnthropicBody()` or document that the coding endpoint ignores/does not support explicit cache-control. In both paths, test normalized usage fields.
      - Audit header merge order in both packages.
    - API Notes and Examples:
      ```ts
      // Z.AI: no explicit Prism cache payload is promised; usage still normalizes reads/writes.
      // Kimi: cache_control is emitted only when endpoint compatibility is confirmed.
      ```
    - Files to Create/Edit:
      - `packages/provider-zai/src/provider.ts`: header merge/usage mapping only if needed.
      - `packages/provider-zai/src/__tests__/zai.test.ts`: cache usage/header tests.
      - `packages/provider-kimi/src/provider.ts`: optional selected breakpoint cache-control and header merge.
      - `packages/provider-kimi/src/__tests__/kimi.test.ts`: usage, optional cache-control, header tests.
      - `docs/providers/zai.md`, `docs/providers/kimi.md`, `docs/provider-caching.md`.
      - `packages/provider-zai/README.md`, `packages/provider-kimi/README.md`.
    - References:
      - Roadmap Phase 44 Z.AI and Kimi bullets.
      - Anthropic docs on `cache_read_input_tokens` / `cache_creation_input_tokens`.
  - Test Cases Written:
    - Z.AI: `zai_emits_no_explicit_cache_payload_for_implicit_caching` asserts no `cache_control`/`cacheKey`/`prompt_cache` fields even with cache options set.
    - Z.AI: `zai_keeps_provider_owned_headers_after_caller_headers` asserts caller `authorization`/`content-type` overridden; `x-caller` kept.
    - Z.AI: existing `zai_enables_tool_stream_for_supported_models` covers `cached_tokens`/`cache_write_tokens` → `cacheReadTokens`/`cacheWriteTokens`.
    - Kimi: `kimi_default_model_emits_no_cache_control_for_implicit_caching` asserts no `cache_control` by default.
    - Kimi: `kimi_opted_in_cache_control_applies_only_to_selected_breakpoints` asserts only `last_stable_message` marked with `{ type: "ephemeral", ttl: "1h" }`.
    - Kimi: `kimi_keeps_provider_owned_headers_after_caller_headers` asserts caller `authorization`/`content-type`/`user-agent` overridden; `x-caller` kept.
    - Kimi: existing `kimi_anthropic_stream_maps_text_thinking_tool_calls_usage` covers `cache_read_input_tokens`/`cache_creation_input_tokens` → `cacheReadTokens`/`cacheWriteTokens`.
  - Verification (Task 5):
    - `npx tsc -p tsconfig.json`, `npx tsc -p packages/provider-zai/tsconfig.json`, `npx tsc -p packages/provider-kimi/tsconfig.json` all pass.
    - `node --test dist/__tests__/docs.test.js packages/provider-zai/dist/__tests__/zai.test.js packages/provider-kimi/dist/__tests__/kimi.test.js` → 74 pass, 0 fail.
  - Implementation notes:
    - `packages/provider-zai/src/provider.ts`: header order fixed — caller headers first, then `content-type`, then `authorization` last.
    - `packages/provider-zai/src/models.ts`: catalog models declare `cache: { kind: "implicit" }`.
    - `packages/provider-kimi/src/cache.ts`: new — `kimiAnthropicCacheEnabled`/`applyKimiAnthropicCacheControl` (core `applyCacheControl` with breakpoints + model `maxBreakpoints`, long-retention → `ttl: "1h"`) gated on `ModelConfig.cache.kind: "cache_control"`.
    - `packages/provider-kimi/src/provider.ts`: header order fixed (caller first, then `content-type`/`user-agent`/`authorization`); `kimiAnthropicBody` applies cache control; `toMessage` accepts `CacheControlledMessage` and preserves `cache_control` markers on the last block of selected messages.
    - Default catalog Kimi model left without cache metadata → no `cache_control` by default (safe implicit path); hosts opt in via model `cache.kind: "cache_control"`.
    - `docs/providers/zai.md`, `docs/providers/kimi.md`, `docs/provider-caching.md`, `packages/provider-zai/README.md`, `packages/provider-kimi/README.md`: cache/usage/header behavior added.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; provider package behavior/docs-visible cache support and header ownership are hardened.
    - Docs pages to create/edit:
      - `docs/providers/zai.md`: implicit cache and usage fields.
      - `docs/providers/kimi.md`: explicit cache-control support or unsupported behavior and usage fields.
      - `docs/provider-caching.md`: Z.AI/Kimi rows/notes.
      - `packages/provider-zai/README.md`, `packages/provider-kimi/README.md`: cache notes.
    - `docs/index.md` update: no new page; existing provider links remain.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add cache-focused provider conformance coverage and docs updates
  - Acceptance Criteria:
    - Functional: Network-free conformance tests cover cache payload shape, normalized cache usage, and protected header ownership for every first-party provider package.
    - Performance: Tests use mocked fetch/streams only and do not lengthen default `npm test` beyond the roadmap's < 60s budget on Node 20.
    - Code Quality: Extend existing provider test files or conformance helpers; do not add a new test framework or live credential dependency.
    - Security: Fixtures contain fake keys only; docs and snapshots contain no real credentials or provider tokens.
  - Approach:
    - Documentation Reviewed:
      - `docs/provider-conformance.md`, `docs/provider-caching.md`, `docs/provider-packages.md`, provider package docs/READMEs.
      - Existing package test files under `packages/provider-*/src/__tests__/`.
      - `src/__tests__/provider-conformance.test.ts` if present, or current conformance helpers.
    - Options Considered:
      - One giant cross-package test file: centralizes assertions but may couple package internals; rejected unless current conformance helper already supports it.
      - Package-local tests plus shared helper for repeated header/usage assertions: chosen if duplication appears.
      - Live provider tests: rejected for default suite; live remains opt-in only.
    - Chosen Approach:
      - Add package-local mocked fetch/SSE tests for provider-specific payloads and usage. Add/extend generic conformance helper only for repeated provider-neutral checks: cache read/write usage and protected header ownership.
    - API Notes and Examples:
      ```bash
      npm run build
      node --test packages/provider-openai/dist/__tests__/openai.test.js \
        packages/provider-openrouter/dist/__tests__/openrouter.test.js
      ```
    - Files to Create/Edit:
      - `packages/provider-openai/src/__tests__/openai.test.ts`
      - `packages/provider-openrouter/src/__tests__/openrouter.test.ts`
      - `packages/provider-opencode-go/src/__tests__/opencode-go.test.ts`
      - `packages/provider-zai/src/__tests__/zai.test.ts`
      - `packages/provider-kimi/src/__tests__/kimi.test.ts`
      - `src/__tests__/provider-conformance.test.ts` or shared helper path if current repo already has one.
      - `docs/provider-conformance.md`: cache conformance expectations.
      - `docs/provider-packages.md`, `docs/provider-caching.md`, provider READMEs, `docs/index.md` if navigation text changes.
    - References:
      - Roadmap Phase 44 conformance/docs bullets.
      - Prism wiki requirement that provider behavior docs ship with APIs.
  - Test Cases Written:
    - Provider-neutral: `assertProviderOwnedHeadersWin` added to `src/testing/provider-conformance.ts` (case-insensitive header-name matching; fails on owned-header override and on dropped non-owned caller header). 3 core conformance tests cover success + both failure paths.
    - Per-provider cache payload shape (supported hints): OpenAI `openai_responses_applies_prompt_cache_policy_session_headers_and_max_tokens` + `openai_responses_sanitizes_and_clamps_prompt_cache_key`; OpenRouter `openrouter_applies_cache_control_only_to_selected_breakpoints` + `openrouter_session_id_sanitized_and_clamped_to_256`; OpenCode Go `opencode_go_anthropic_route_applies_cache_control_only_to_selected_breakpoints`; Z.AI `zai_emits_no_explicit_cache_payload_for_implicit_caching`; Kimi `kimi_opted_in_cache_control_applies_only_to_selected_breakpoints`.
    - Per-provider unsupported behavior (no invalid fields): OpenAI `openai_responses_long_retention_emits_24h_only_when_supported` (undefined otherwise); OpenRouter `openrouter_no_breakpoints_emits_no_cache_control_markers`; OpenCode Go `opencode_go_anthropic_route_no_breakpoints_emits_no_cache_control` + `opencode_go_openai_route_never_receives_anthropic_cache_control`; Z.AI no explicit payload (implicit); Kimi `kimi_default_model_emits_no_cache_control_for_implicit_caching`.
    - Per-provider normalized cache usage mapping: OpenAI `openai_responses_stream_maps...` (cached_tokens→cacheReadTokens); OpenRouter `openrouter_maps_cache_read_write_usage`; OpenCode Go `opencode_go_anthropic_route_streams_text_tool_calls_and_usage`; Z.AI `zai_enables_tool_stream_for_supported_models` (cached_tokens/cache_write_tokens); Kimi `kimi_anthropic_stream_maps_text_thinking_tool_calls_usage` (cache_read_input_tokens/cache_creation_input_tokens).
    - Per-provider protected header ownership: all 5 packages have a `*_keeps_provider_owned_headers_after_caller_headers` test, now refactored to call `assertProviderOwnedHeadersWin` (load-bearing helper, no dead code).
    - Docs test (`docs.test.js`) passes after provider-cache docs/README changes.
  - Verification (Task 6):
    - `npx tsc -p tsconfig.json` and per-package `tsc -p tsconfig.json` for all 5 providers: all clean.
    - `npm test` (build + core `dist/__tests__/*.test.js` + workspace tests): **906 tests, 0 fail, exit 0**, ~25s (within < 60s budget).
  - Implementation notes:
    - `src/testing/provider-conformance.ts`: added `assertProviderOwnedHeadersWin` + `ProviderHeaderOwnershipConformanceOptions`.
    - `src/__tests__/provider-conformance.test.ts`: 3 new tests (success, owned-override failure, dropped-caller-header failure).
    - 5 provider `*.test.ts`: refactored header-ownership assertions to call the shared helper (reduces duplication, centralizes the security invariant).
    - `docs/provider-conformance.md`: documented `assertProviderOwnedHeadersWin`, cache usage expectations, and a header-ownership example.
    - `docs/provider-packages.md`: added "First-party cache behavior" subsection summarizing all six first-party providers.
    - `docs/index.md`: enhanced Provider conformance and Provider packages navigation wording.
    - No new test framework, no new dependencies, no live credentials (fixtures use `fake-*-key`).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; documents provider conformance expectations and first-party cache behavior.
    - Docs pages to create/edit:
      - `docs/provider-conformance.md`: cache payload/usage/header checks.
      - `docs/provider-packages.md`: first-party cache behavior summary.
      - `docs/provider-caching.md`: provider support matrix and caveats.
      - `docs/providers/openai.md`, `docs/providers/openai-compatible.md`, `docs/providers/openrouter.md`, `docs/providers/opencode-go.md`, `docs/providers/zai.md`, `docs/providers/kimi.md`: provider-specific cache sections.
      - Provider package `README.md` files: package-level cache notes.
    - `docs/index.md` update: yes only if cache/conformance link descriptions need updated wording; no new page expected.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Final verification and release-safety check
  - Acceptance Criteria:
    - Functional: All Phase 44 acceptance criteria are demonstrably satisfied: no invalid retention values, no over-broad cache-control markers, provider-owned headers win, and cache read/write token extraction is tested for every first-party provider.
    - Performance: Default network-free test suite stays within the documented release budget; any meaningful increase is recorded with evidence.
    - Code Quality: TypeScript build, package exports, docs tests, and affected provider tests pass without new dependencies or generated fixture drift.
    - Security: No tests/docs/session fixtures contain real-looking secrets; redaction/header ownership behavior remains covered.
  - Approach:
    - Documentation Reviewed:
      - This plan's completed tasks and verification notes.
      - `docs/release-and-install.md` release/test budget.
      - `package.json` scripts for build/test/docs validation.
    - Options Considered:
      - Run only targeted package tests: faster but misses cross-package/export/docs drift; rejected for final task.
      - Run default network-free suite plus targeted provider tests if needed: chosen.
    - Chosen Approach:
      - Run the smallest complete verification set already used by the repo (`npm test` or documented equivalent), plus targeted provider package tests when debugging failures. Update this plan with actual commands/results before marking complete.
    - API Notes and Examples:
      ```bash
      npm test
      npm run build
      ```
    - Files to Create/Edit:
      - `plans/045-first-party-provider-cache-behavior-hardening.md`: mark completed tasks and record final verification, compromises, and further actions after checks pass.
      - No runtime files expected unless verification reveals gaps.
    - References:
      - Roadmap Phase 44 acceptance criteria.
      - `docs/release-and-install.md` test budget and network-free policy.
  - Test Cases Written:
    - No new tests in this task unless verification exposes a missing acceptance criterion; then add the smallest failing test beside the owning provider.
  - Verification (Task 7):
    - Node v24.16.0.
    - `npm run build` → exit 0, ~15s (core + 7 workspaces).
    - `npm run typecheck` → exit 0, ~16s (core + workspaces + `tsc -p examples --noEmit`).
    - `npm test` → **906 tests, 0 fail, 6 skipped, exit 0, ~23s** (well within the < 60s offline budget documented in `docs/release-and-install.md`, baseline ~45s).
    - `npm run pack:dry-run` → exit 0, ~5s; all tarballs pack cleanly.
    - Network-free guard: default suite is network-free by construction (no `PRISM_LIVE_PROVIDER_TESTS`).
  - Phase 44 acceptance criteria audit (verified directly against source + tests):
    - **No invalid cache retention values**: OpenAI emits `prompt_cache_retention` only as `undefined` (short/none) or `"24h"` (long, gated by `model.cache.longRetention`); no `"short"`/`"long"` literal (cache.ts:21-24, responses.ts:76, tests assert undefined/24h). Z.AI sends no retention field. Kimi/OpenCode Go/OpenRouter Anthropic routes use `cache_control` markers, not retention literals.
    - **No over-broad cache-control markers**: OpenRouter, OpenCode Go Anthropic route, and Kimi (opt-in) all apply `cache_control` only to caller-selected `cache.breakpoints` via the shared core `applyCacheControl()` helper (OpenRouter cache.ts:41, OpenCode Go cache.ts:57, Kimi cache.ts:32) — not to every content block. The old per-block `withOpenRouterCache` was removed.
    - **Provider-owned Authorization/session/security headers win**: all 5 providers spread caller headers first, then provider-owned headers last (responses.ts:29-32, openrouter provider.ts:31-37, opencode-go provider.ts:28-30, zai provider.ts:27, kimi provider.ts:29-32). Verified by a `*_keeps_provider_owned_headers_after_caller_headers` test in each package, now calling the shared `assertProviderOwnedHeadersWin` helper.
    - **Cache read/write token extraction tested for every first-party provider**: OpenAI maps `cached_tokens`; OpenRouter maps `cached_tokens`/`cache_write_tokens`; OpenCode Go maps both OpenAI and Anthropic route usage; Z.AI maps `cached_tokens`/`cache_write_tokens`; Kimi maps `cache_read_input_tokens`/`cache_creation_input_tokens` — each covered by a package test.
    - **Conformance coverage**: `assertUsageAccounting` (cache read/write) and `assertProviderOwnedHeadersWin` (header ownership) load-bearing across all 5 first-party packages (Task 6).
    - **Security**: no real-looking secrets in docs (docs secret-check test passes); test fixtures use `fake-*-key` / `sk-test-*` placeholders only; no new runtime dependencies (all packages: `dependencies: {}`, peerDep `@arnilo/prism` only).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new behavior; verification only.
    - Docs pages to create/edit:
      - `none`: previous tasks own docs changes.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- **Kimi cache_control is opt-in, not default.** The default Kimi coding catalog model keeps implicit caching (no `cache_control`) because endpoint support for explicit `cache_control` on the `/messages` route is conditional. Hosts opt in by declaring `ModelConfig.cache.kind: "cache_control"` per model. This avoids emitting markers the endpoint might reject, at the cost of hosts needing to opt in explicitly.
- **Z.AI cache is documented-only.** GLM implicit context caching cannot be disabled or steered from the request side, so Z.AI ignores `cacheKey`/`cacheRetention`/`cache` options by design and sends no payload; behavior is locked in by a test that asserts no explicit cache fields are emitted.
- **OpenCode Go OpenAI route gets no Anthropic `cache_control`.** Only the Anthropic route applies `cache_control` (OpenAI route sends none), matching endpoint compatibility; documented and tested.
- **Session-id clamp lengths are provider-specific** (OpenAI 64, OpenRouter 256, OpenCode Go 128) and intentionally not unified into one constant, since each provider's documented key limit differs.
- **No unification of per-package `cache.ts` modules.** Each first-party provider keeps its own `cache.ts` (OpenAI, OpenRouter, OpenCode Go, Kimi) reusing the shared core `sanitizeCacheKey`/`mapCacheRetention`/`applyCacheControl` helpers, rather than a shared provider-cache abstraction, to keep core free of provider-specific branches (roadmap boundary).

## Further Actions
- **Live (network) cache verification for OpenRouter/Kimi `cache_control`**: Phase 44 hardened cache behavior with mocked streams. A future opt-in live test (behind `PRISM_LIVE_PROVIDER_TESTS`) should confirm `cached_tokens`/`cache_read_input_tokens` actually decrease on repeat identical-prefix requests for OpenRouter, OpenCode Go Anthropic route, and opted-in Kimi. Priority: low (default suite stays network-free).
- **Kimi endpoint `cache_control` support matrix**: confirm at runtime which Kimi coding models accept `ttl: 1h` and surface endpoint-specific rejection errors cleanly. Priority: low.
- **Cache hit-rate diagnostics in runs**: wire `cacheHitRate()`/`cacheSavings()` from `src/cache-helpers.ts` into `docs/runs-and-usage.md` examples and run-ledger reporting once a host surfaces cache usage in the ledger. Priority: medium (depends on host adoption).
