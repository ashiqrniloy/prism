# Phase 42 — Prompt-cache primitives and provider capability metadata

## Objectives
- Let an app express prompt-cache intent once in provider-agnostic terms while
  first-party and third-party providers map that intent to OpenAI
  `prompt_cache_key`, Anthropic/OpenRouter `cache_control`, implicit
  prefix-cache-only providers, or no cache.
- Add structured model/provider cache-capability metadata so a provider package
  (and a host) can describe cache support without leaking provider-specific
  literals into Prism core.
- Centralize the cache helpers that every first-party provider currently
  re-implements differently (key sanitizing/truncation, retention mapping,
  Anthropic-style `cache_control` application, cache hit-rate from `Usage`).
- Keep the existing `cacheKey`/`cacheRetention` surface working unchanged as
  aliases; introduce structured hints as an opt-in, backwards-compatible
  addition.
- Ship the `/docs` pages the roadmap names for this phase
  (`provider-caching.md`, `provider-request-policies.md`, `model-registry.md`)
  following the Prism wiki API-page structure.

## Expected Outcome
- `ProviderRequestOptions` carries optional structured cache hints
  (`cache?: PromptCacheHints`) plus breakpoint locations, while
  `cacheKey`/`cacheRetention` keep working as aliases.
- `ModelConfig` carries generic cache-capability metadata (cache kind, key
  length, max breakpoints, minimum cacheable tokens, long-retention support)
  with zero provider-name literals in `src/`.
- Prism core exports reusable cache helpers adopted (or adoptable) by the
  first-party provider packages; no behavior change is forced on providers in
  this phase (Phase 44 adopts them).
- `npm test` stays network-free and under budget; new public types are exported
  and documented; `docs/index.md` links the three new pages.
- Existing providers and tests compile and pass without adopting the new
  structured hints.

## Tasks

- [x] Primitive review and current cache/capability metadata inventory
  - Acceptance Criteria:
    - Functional: Inventory the existing cache surface (`ProviderRequestOptions`,
      `CacheRetention`, `Usage`), the `provider-request-policy.ts` helpers, the
      per-provider duplicated cache code in first-party packages, the
      `ModelConfig.compat`/`ModelCapabilities` shapes, and the `phase12` core
      boundary test. No runtime code changes in this task.
    - Performance: Record where cache-key sanitizing/truncation and
      `cache_control` application currently run per-package and the divergent
      limits (OpenAI key slice 64, OpenRouter/OpenCode session id slice 128).
    - Code Quality: Identify the smallest generic primitive additions that
      satisfy the roadmap without introducing provider-specific fields or a
      parallel cache pipeline; reject moving provider-specific serialization
      into core.
    - Security: Confirm the inventory records that cache keys/session ids are
      derived only from caller-supplied `cacheKey`/`sessionId`, never from
      credentials, and that `cache_control`/headers never override provider
      auth headers.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 42 (and the downstream Phase 43 cache-aware ordering
        and Phase 44 first-party provider cache hardening as consumers of these
        primitives).
      - `.agents/skills/create-plan/references/prism-wiki.md`.
      - `docs/provider-layer.md` current `ProviderRequestOptions` cache notes.
      - `docs/provider-packages.md` per-provider cache behavior section.
      - `docs/public-contracts.md` `ProviderRequestOptions`/`ModelConfig` rows.
    - Options Considered:
      - Replace `cacheKey`/`cacheRetention` with a new structured object only:
        breaks every existing caller and provider; rejected.
      - Keep `cacheKey`/`cacheRetention` and add optional structured `cache`
        hints alongside as aliases: backwards compatible, lets providers opt in
        per Phase 44.
      - Add a new `CachePolicy` middleware strategy instead of request fields:
        redundant with the existing `ProviderRequestPolicy` chain.
    - Chosen Approach:
      - Inventory first, then add only generic primitives: structured hints on
        `ProviderRequestOptions`, generic cache-capability metadata on
        `ModelConfig`, and shared helper functions. Defer ordering (Phase 43)
        and per-provider adoption (Phase 44).
    - API Notes and Examples:
      ```ts
      // Current surface (stays valid):
      const options: ProviderRequestOptions = {
        sessionId: "s1",
        cacheRetention: "long",
        cacheKey: "s1",
      };
      ```
    - Files to Create/Edit:
      - `plans/043-prompt-cache-primitives-and-provider-capability-metadata.md`: this plan.
      - `src/contracts.ts`: inventory of `ProviderRequestOptions`, `CacheRetention`, `ModelConfig`, `ModelCapabilities`, `Usage`.
      - `src/provider-request-policy.ts`: inventory of `createSessionCachePolicy`, `mergeProviderRequestOptions`, `createProviderRequestPolicyChain`.
      - `packages/provider-openai/src/cache.ts`, `packages/provider-openrouter/src/cache.ts`, `packages/provider-opencode-go/src/cache.ts`: inventory of duplicated sanitize/truncate/`cache_control`/usage logic.
      - `src/__tests__/phase12-boundaries.test.ts`: the forbidden provider-literal guard that new metadata must respect.
    - References:
      - `src/contracts.ts` `ProviderRequestOptions` has `sessionId`, `cacheRetention: "none" | "short" | "long"`, `cacheKey`, plus opaque `compat`/`extra`/`headers`.
      - `src/contracts.ts` `Usage` already exposes `cacheReadTokens`/`cacheWriteTokens`/`cost`.
      - `src/contracts.ts` `ModelConfig.compat?: JsonObject` is the opaque escape hatch providers use today.
      - `src/provider-request-policy.ts` `createSessionCachePolicy()` sets `cacheKey ?? sessionId` and `cacheRetention ?? "short"`.
      - `packages/provider-openai/src/cache.ts` truncates the key to 64 chars.
      - `packages/provider-openrouter/src/cache.ts` sanitizes session id to `[^A-Za-z0-9_.:-]` and slices to 128, applies `cache_control: { type: "ephemeral" }` to every non-tool content block, and maps `cached_tokens`/`cache_write_tokens`.
      - `packages/provider-opencode-go/src/cache.ts` sanitizes/slices session id to 128 for `x-opencode-session` and merges caller headers first so the provider header wins.
      - `packages/provider-openrouter/src/provider.ts` gates `cache_control` on `request.model.compat?.openRouterCache === true` (provider-specific opaque key; Phase 42 replaces the need to read opaque compat keys for cache).
      - `src/__tests__/phase12-boundaries.test.ts` asserts `src/` (excluding `openai-compatible`) contains none of `openrouter`, `zai`, `kimi`, `opencode`, `openai-codex`, `chatgpt`, `moonshot`.
    - Current Cache/Capability Inventory:
      - Core request surface: `src/contracts.ts` defines `CacheRetention = "none" | "short" | "long"` and `ProviderRequestOptions` with `sessionId`, legacy `cacheRetention`, legacy `cacheKey`, caller `headers`, deprecated inert timeout/retry hints, and opaque `compat`/`extra`. No structured cache hints or breakpoint type exists yet.
      - Core usage/accounting surface: `Usage` already has normalized `cacheReadTokens` and `cacheWriteTokens`; `ModelCost` already has `cacheRead` and `cacheWrite` pricing fields. No helper currently computes cache hit rate or savings from them.
      - Core model capability surface: `ModelConfig` has `capabilities`, `limits`, `cost`, opaque `compat`, `parameters`, and `metadata`. `ModelCapabilities` only covers input/output, reasoning, tools, and streaming. No typed cache-capability metadata exists; providers use opaque `compat` for cache support.
      - Provider request policies: `createSessionCachePolicy()` derives `sessionId` from `request.options?.sessionId ?? context.sessionId`, then sets `cacheKey: options.cacheKey ?? sessionId` and `cacheRetention: options.retention ?? "short"`. `mergeProviderRequestOptions()` shallow-merges options and specially merges only `headers`, `compat`, and `extra`; there is no structured `cache` merge today.
      - OpenAI provider package: `packages/provider-openai/src/cache.ts` maps `cacheKey ?? sessionId` to `prompt_cache_key` and truncates to 64 chars with no sanitizing; `cacheRetention: "none"` disables retention and other values pass through. Tests assert 80-char keys clamp to 64 and provider auth headers still win.
      - OpenRouter provider package: `packages/provider-openrouter/src/cache.ts` maps `cacheKey ?? sessionId` to a sanitized 128-char session id, applies `cache_control: { type: "ephemeral" }` to every non-tool content block when enabled, and maps `cached_tokens`/`cache_write_tokens` to normalized usage. `provider.ts` enables that path via `request.options?.cacheRetention !== "none" && request.model.compat?.openRouterCache === true`, a provider-specific opaque compat flag.
      - OpenCode Go provider package: `packages/provider-opencode-go/src/cache.ts` derives `x-opencode-session` only from `sessionId`, sanitizes with `[^A-Za-z0-9_.:-] -> "-"`, truncates to 128, and spreads caller headers first so provider-owned session/auth headers win.
      - Other first-party providers: Z.AI and Kimi map cache-read/write usage inline and/or document implicit/provider-specific behavior; no shared helper exists for usage or cache-key behavior.
      - Documentation state: `docs/provider-caching.md`, `docs/provider-request-policies.md`, and `docs/model-registry.md` are absent; existing docs mention `cacheKey`/`cacheRetention` only through `provider-layer.md`, `provider-packages.md`, and `public-contracts.md`.
      - Boundary state: `src/__tests__/phase12-boundaries.test.ts` forbids first-party provider/runtime literals in core `src/` (`openrouter`, `zai`, `kimi`, `opencode`, `openai-codex`, `chatgpt`, `moonshot`). Phase 42 core types/helpers must stay provider-agnostic and avoid adding those literals.
    - Current Performance Inventory:
      - Cache-key/session-id processing is duplicated per provider: OpenAI performs a 64-char slice, OpenRouter sanitizes + slices to 128, OpenCode Go sanitizes + slices to 128. Central helper can keep this O(n) regex + slice and remove divergent copies.
      - OpenRouter `withOpenRouterCache()` currently maps every non-tool content block to a new block with `cache_control`; this is O(content blocks) and over-broad for providers that support limited breakpoints. Breakpoint-aware helpers should stamp only selected anchors and respect max-breakpoint metadata.
      - No cache-aware input ordering exists in this task; Phase 43 owns stable-prefix ordering. Phase 42 primitives must not reorder messages.
      - No provider package adoption is required here; Phase 44 owns provider-specific payload hardening. Existing providers must compile unchanged.
    - Smallest Generic Primitive Change:
      - Keep legacy `cacheKey`/`cacheRetention` as aliases and add one optional structured `cache?: PromptCacheHints` field on `ProviderRequestOptions`; do not add a parallel cache policy pipeline because `ProviderRequestPolicy` already exists.
      - Add typed, provider-agnostic cache-capability metadata on `ModelConfig` rather than expanding opaque `compat` or adding provider-specific flags to core.
      - Add pure exported helpers for sanitizing/truncation, retention mapping, breakpoint-aware `cache_control` stamping, and normalized usage hit-rate/savings; leave provider serialization in provider packages.
      - Reject provider-specific core behavior: no OpenAI/OpenRouter/Anthropic/ZAI/Kimi/OpenCode branches in `src/`, no hidden globals, no credential or auth-header handling in cache primitives.
    - Security Inventory:
      - Existing cache keys/session ids come only from caller-provided `cacheKey`/`sessionId` or `context.sessionId`, never from credential resolvers or provider tokens.
      - Existing provider packages spread caller headers before provider-owned auth/session headers where tested, so provider-owned headers win; Phase 42 docs/helpers must preserve that rule and not introduce header mutation helpers.
      - Cache keys are untrusted caller input; sanitizing/truncation must be centralized before providers place them in payload fields or headers.
      - `cache_control` touches message content only; it must not serialize credentials, tool permissions, or provider credentials.
    - Test Cases to Write:
      - Inventory-only task; no product test required. Following tasks already list exact unit/boundary/docs tests for structured hints, model metadata, helpers, docs, and full verification.
    - Verification:
      - Source inventory verified by reading `src/contracts.ts`, `src/provider-request-policy.ts`, `packages/provider-openai/src/cache.ts`, `packages/provider-openrouter/src/cache.ts`, `packages/provider-opencode-go/src/cache.ts`, `packages/provider-openrouter/src/provider.ts`, `src/__tests__/phase12-boundaries.test.ts`, and targeted `rg` output for cache-related fields/docs.
      - No runtime/source code changed in this task; plan-only verification is the completed deliverable.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no direct behavior change; inventory only.
    - Docs pages to create/edit:
      - `none`: later tasks own docs changes.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add backwards-compatible structured cache hints and breakpoint shape
  - Acceptance Criteria:
    - Functional: `ProviderRequestOptions` gains an optional structured
      `cache?: PromptCacheHints` carrying cache mode (`auto`/`on`/`off`),
      stable key, retention, and an optional ordered list of
      `PromptCacheBreakpoint` locations (`system_prompt`, `tools`,
      `stable_context`, `last_stable_message`, `last_user_message`, or a
      message id). `cacheKey`/`cacheRetention` remain valid aliases; setting
      only the legacy fields produces identical provider requests to today.
    - Performance: Hint merging is O(events) in request size and adds no
      allocations beyond the merged options object; structured hints are plain
      data, not a strategy object.
    - Code Quality: New types live in `src/contracts.ts`, are exported from
      `src/index.ts`, are fully optional, and introduce no provider-specific
      field names. `mergeProviderRequestOptions` merges `cache` structurally
      (legacy fields still merge as today). No new dependency.
    - Security: Structured hints carry no credentials and cannot override
      provider auth/session/security headers; `cache.key` is treated as
      untrusted input that providers sanitize (see helper task).
  - Approach:
    - Documentation Reviewed:
      - `docs/provider-layer.md` `ProviderRequestOptions` cache fields.
      - `docs/public-contracts.md` `ProviderRequestOptions` row.
      - `src/contracts.ts` `CacheRetention`, `ProviderRequestOptions`.
      - `src/provider-request-policy.ts` `mergeProviderRequestOptions`.
      - OpenAI `prompt_cache_key`/`prompt_cache_retention`, Anthropic
        `cache_control` breakpoint semantics, and OpenRouter `cache_control`
        application as the three mapping targets.
    - Options Considered:
      - A single new `cache: { key, retention, mode }` flat object with
        breakpoints as a separate per-message annotation: splits related fields.
      - One `PromptCacheHints` object with mode/key/retention/breakpoints: keeps
        all cache intent in one optional field; chosen.
      - Encode breakpoints inside `compat`: hides intent behind an opaque
        escape hatch and bypasses redaction/merge semantics.
    - Chosen Approach:
      - Add `PromptCacheMode = "auto" | "on" | "off"`,
        `PromptCacheBreakpointLocation`,
        `PromptCacheBreakpoint { location; messageId?; ttl? }`,
        `PromptCacheHints { mode?; key?; retention?: CacheRetention; breakpoints?: readonly PromptCacheBreakpoint[] }`.
      - `ProviderRequestOptions.cache?: PromptCacheHints`. When `cache` is
        absent, behavior is exactly today (`cacheKey`/`cacheRetention`). When
        `cache` is present, its `key`/`retention` are authoritative and legacy
        fields are treated as aliases (documented migration note).
      - `mergeProviderRequestOptions` merges `cache` by shallow-merging fields
        and concatenating `breakpoints` (patch wins on scalar conflicts),
        mirroring how `headers`/`compat`/`extra` already merge.
    - API Notes and Examples:
      ```ts
      import type { ProviderRequestOptions, PromptCacheHints } from "@arnilo/prism";

      // Legacy path — unchanged.
      const legacy: ProviderRequestOptions = { sessionId: "s1", cacheRetention: "long" };

      // Structured path — same intent, plus explicit breakpoints.
      const hints: PromptCacheHints = {
        mode: "on",
        key: "s1",
        retention: "long",
        breakpoints: [
          { location: "system_prompt" },
          { location: "tools" },
          { location: "stable_context" },
          { location: "last_user_message" },
        ],
      };
      const structured: ProviderRequestOptions = { sessionId: "s1", cache: hints };
      ```
    - Files Created/Edited:
      - `src/contracts.ts`: added `PromptCacheMode`, `PromptCacheBreakpointLocation`, `PromptCacheBreakpointTtl`, `PromptCacheBreakpoint`, `PromptCacheHints`; added optional `cache?: PromptCacheHints` to `ProviderRequestOptions`.
      - `src/provider-request-policy.ts`: added a note that `createSessionCachePolicy()` is the legacy alias path and extended `mergeProviderRequestOptions()` to structurally merge `cache` only when either side provides structured hints. Legacy-only merges do not add a `cache` property.
      - `src/index.ts`: verified existing `export type * from "./contracts.js"` exports the new public types; no explicit edit needed.
      - `src/__tests__/public-contracts.test.ts`: added a structured-hints fixture, legacy alias-preservation assertions, authoritative structured scalar merge assertions, and breakpoint concatenation assertion.
      - `src/__tests__/phase12-boundaries.test.ts`: extended the provider-literal guard with `anthropic` so new cache types stay provider-agnostic without blocking the planned generic `openai_key` metadata in the next task.
    - References:
      - `src/contracts.ts` `ProviderRequestOptions` is the merge target already consumed by every provider package.
      - `src/provider-request-policy.ts` `mergeProviderRequestOptions` is the single runtime merge path (`src/agents.ts` calls it).
      - Anthropic `cache_control` supports up to 4 breakpoints with a `ttl` — drives the breakpoint location vocabulary; OpenAI has no breakpoint concept (key-only), implicit-cache providers have none.
  - Test Cases Written:
    - `legacy cacheKey/cacheRetention produce identical merged options to today`: implemented as field assertions; legacy-only merge keeps `cacheKey`, updates `cacheRetention`, and does not add a `cache` property.
    - `structured cache hints merge authoritatively`: implemented; patch `cache.key`/`cache.retention` win while legacy aliases remain intact.
    - `breakpoints concatenate on merge`: implemented; base and patch breakpoint locations preserve order.
    - `boundary: new cache types contain no provider literals`: implemented by extending the Phase 12 core provider-literal scan with `anthropic`; existing scan already rejects `openrouter`, `zai`, `kimi`, `opencode`, `openai-codex`, `chatgpt`, and `moonshot`.
    - Verification run: `npm run build:core && node --test dist/__tests__/public-contracts.test.js dist/__tests__/phase12-boundaries.test.js` passed (29 tests).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; adds optional public types and an alias surface on `ProviderRequestOptions`.
    - Docs pages to create/edit:
      - `docs/provider-caching.md`: new page (authored in the docs task) documenting `PromptCacheHints`/breakpoints and the legacy alias.
      - `docs/provider-request-policies.md`: new page documenting `createSessionCachePolicy` and the merge behavior including `cache`.
      - `docs/public-contracts.md`: add `PromptCacheHints`/`PromptCacheBreakpoint` rows and the alias note.
    - `docs/index.md` update: yes; add `Provider caching` and `Provider request policies` navigation entries (in the docs task).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add generic model/provider cache-capability metadata
  - Acceptance Criteria:
    - Functional: `ModelConfig` carries optional generic cache-capability
      metadata describing cache kind (`implicit`/`openai_key`/`cache_control`/
      `provider_specific`/`none`), max cache-key length, max breakpoints,
      minimum cacheable tokens, and whether long retention is supported. A
      provider/host can read this metadata to decide how (or whether) to apply
      cache hints without provider-name branching in core.
    - Performance: Metadata is plain static data on `ModelConfig`; lookups are
      field reads, no computation per request.
    - Code Quality: New metadata type lives in `src/contracts.ts`, is exported,
      carries only generic enum/string/number fields, and introduces zero
      provider-name literals in `src/`. Existing providers compile unchanged
      (field is optional). Boundary tests assert no provider literals.
    - Security: Metadata is declarative capability info only; it cannot grant
      permissions, select tools, or bypass auth/header ownership. No secrets.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 42 deliverable: "Model/provider compat metadata for
        cache support: implicit vs OpenAI key vs Anthropic/OpenRouter
        `cache_control` vs provider-specific cache, key length, max breakpoints,
        minimum cacheable tokens, and long-retention support."
      - `src/contracts.ts` `ModelConfig`, `ModelCapabilities`, `ModelLimits`, `ModelCost`.
      - `packages/provider-openrouter/src/provider.ts` current opaque
        `request.model.compat?.openRouterCache` gate (the provider-specific
        pattern this replaces generically).
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Extend `ModelCapabilities` with cache fields: mixes input/output
        modality capabilities with cache mechanics; muddies the type.
      - New opaque `ModelConfig.cacheCompat?: JsonObject`: keeps the current
        untyped escape hatch and defeats the point of structured metadata.
      - New typed `ModelCacheCapabilities` object on `ModelConfig.cache?`:
        chosen; generic, typed, and provider-agnostic.
    - Chosen Approach:
      - Add to `src/contracts.ts`:
        ```ts
        export type PromptCacheKind = "implicit" | "openai_key" | "cache_control" | "provider_specific" | "none";
        export interface ModelCacheCapabilities {
          readonly kind?: PromptCacheKind;
          readonly maxKeyLength?: number;
          readonly maxBreakpoints?: number;
          readonly minCacheableTokens?: number;
          readonly longRetention?: boolean;
        }
        ```
      - Add `readonly cache?: ModelCacheCapabilities;` to `ModelConfig`.
      - Document mapping intent (not enforcement): providers read
        `model.cache?.kind` to pick OpenAI key vs `cache_control` vs implicit;
        core never branches on it.
    - API Notes and Examples:
      ```ts
      import type { ModelConfig } from "@arnilo/prism";

      const openaiModel: ModelConfig = {
        provider: "openai", model: "gpt-4o",
        cache: { kind: "openai_key", maxKeyLength: 64, longRetention: true },
      };
      const anthropicModel: ModelConfig = {
        provider: "openrouter", model: "claude-...",
        cache: { kind: "cache_control", maxBreakpoints: 4, minCacheableTokens: 1024 },
      };
      const implicitModel: ModelConfig = {
        provider: "neuralwatt", model: "glm-5.2",
        cache: { kind: "implicit" },
      };
      ```
    - Files Created/Edited:
      - `src/contracts.ts`: added `PromptCacheKind`, `ModelCacheCapabilities`, and `ModelConfig.cache?`.
      - `src/index.ts`: verified export via existing `export type * from "./contracts.js"`; no edit needed.
      - `src/__tests__/public-contracts.test.ts`: added model-with-cache-capabilities fixtures in provider package registration and a standalone passive-provider metadata test.
      - `src/__tests__/phase12-boundaries.test.ts`: added `phase42_prompt_cache_kind_values_are_generic` exact-literal assertion for the `PromptCacheKind` values.
    - References:
      - `src/contracts.ts` `ModelConfig.compat?: JsonObject` is the current opaque escape hatch.
      - `packages/provider-openrouter/src/provider.ts` line 54 reads `request.model.compat?.openRouterCache === true`; the new `model.cache?.kind === "cache_control"` is the generic replacement providers migrate to in Phase 44.
      - `ModelCost.cacheRead`/`cacheWrite` already exist for pricing; capability metadata is the mechanical counterpart.
  - Test Cases Written:
    - `ModelConfig.cache metadata is optional and typed`: `public-contracts.test.ts` registers a cached model and asserts `cache.kind`/`maxBreakpoints` round-trip; standalone fixture asserts optional omission remains `undefined`.
    - `PromptCacheKind union has no provider literals`: `phase42_prompt_cache_kind_values_are_generic` asserts no kind equals a provider name.
    - `metadata does not change provider serialization by itself`: passive provider test reads request metadata only; model without `cache` is unchanged and no runtime mapping is performed in core.
    - Verification run: `npm run build:core && node --test dist/__tests__/public-contracts.test.js dist/__tests__/phase12-boundaries.test.js` passed (31 tests).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; adds public model metadata types.
    - Docs pages to create/edit:
      - `docs/model-registry.md`: new page documenting `ModelConfig` metadata including `cache`, `capabilities`, `limits`, `cost`.
      - `docs/provider-caching.md`: cross-reference the capability metadata and per-kind behavior table.
      - `docs/public-contracts.md`: add `ModelCacheCapabilities`/`PromptCacheKind` rows.
    - `docs/index.md` update: yes; add `Model registry` navigation entry (in the docs task).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add shared cache helpers (key sanitize, retention map, cache_control, hit-rate)
  - Acceptance Criteria:
    - Functional: Prism core exports reusable helpers:
      `sanitizeCacheKey(value, maxLength)`, `mapCacheRetention(retention,
      model)`, `applyCacheControl(messages, breakpoints, options)` (Anthropic/
      OpenRouter-style `cache_control: { type: "ephemeral" }` applied only to
      chosen breakpoint locations, not every block), and
      `cacheHitRate(usage)`/`cacheSavings(usage, model)` from normalized
      `Usage`. Helpers are pure and provider-agnostic.
    - Performance: Helpers are O(messages) at most and allocate only the
      transformed message array; `sanitizeCacheKey` is a single regex + slice.
    - Code Quality: Helpers live in a new `src/cache-helpers.ts`, are exported
      from `src/index.ts`, carry no provider literals, and do not call
      `fetch`/network. First-party packages are NOT migrated in this phase
      (Phase 44); the helpers are added and tested standalone.
    - Security: `sanitizeCacheKey` strips characters outside a documented safe
      set and truncates to the provider-declared max, never inserting
      credentials. `applyCacheControl` never mutates provider auth/session
      headers and operates only on message content.
  - Approach:
    - Documentation Reviewed:
      - `packages/provider-openrouter/src/cache.ts` current `withOpenRouterCache`
        (applies `cache_control` to every non-tool block — the over-broad
        behavior Phase 44 fixes using breakpoint-aware `applyCacheControl`).
      - `packages/provider-openai/src/cache.ts` key slice to 64.
      - `packages/provider-opencode-go/src/cache.ts` session id sanitize/slice to 128.
      - `src/contracts.ts` `Usage` (`cacheReadTokens`/`cacheWriteTokens`) and
        `ModelCost` (`cacheRead`/`cacheWrite`).
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Keep helpers inside each provider package: leaves the 64-vs-128 and
        over-broad `cache_control` divergences; rejected by the roadmap.
      - Add a single `cache-control` middleware that mutates requests: changes
        behavior for providers not opted in; rejected.
      - Pure exported helper functions providers call explicitly: chosen; no
        implicit behavior change, minimal surface.
    - Chosen Approach:
      - New `src/cache-helpers.ts`:
        ```ts
        export function sanitizeCacheKey(value: string | undefined, maxLength: number): string | undefined;
        export function mapCacheRetention(retention: CacheRetention | undefined, model: ModelConfig): "short" | "long" | undefined;
        export function applyCacheControl<T>(messages: readonly T[], breakpoints: readonly PromptCacheBreakpoint[], options?: { ttl?: "ephemeral" | "1h" }): readonly T[];
        export function cacheHitRate(usage: Usage | undefined): number | undefined;
        export function cacheSavings(usage: Usage | undefined, model: ModelConfig): number | undefined;
        ```
      - `applyCacheControl` resolves breakpoint locations (`system_prompt`,
        `tools`-adjacent, `stable_context`, `last_stable_message`,
        `last_user_message`, or `messageId`) to concrete message anchors and
        stamps `cache_control` only on those anchors, capping at
        `model.cache?.maxBreakpoints`. The generic `<T>` keeps core free of any
        provider's message shape; providers map their own message type to the
        anchor indices.
      - Export from `src/index.ts`.
    - API Notes and Examples:
      ```ts
      import { sanitizeCacheKey, applyCacheControl, cacheHitRate } from "@arnilo/prism";

      sanitizeCacheKey("session#1!", 128); // "session-1"
      const stamped = applyCacheControl(messages, [{ location: "last_user_message" }]);
      cacheHitRate({ inputTokens: 1000, cacheReadTokens: 800 }); // 0.8
      ```
    - Files Created/Edited:
      - `src/cache-helpers.ts`: added pure helpers `sanitizeCacheKey`, `mapCacheRetention`, `applyCacheControl`, `cacheHitRate`, and `cacheSavings`, plus small exported option/result types.
      - `src/index.ts`: exported helper functions and helper option/result types from the public entrypoint.
      - `src/__tests__/cache-helpers.test.ts`: added tests for key sanitizing/truncation, retention mapping, targeted breakpoint stamping, hit-rate, and savings.
      - `src/__tests__/phase12-boundaries.test.ts`: existing Phase 12 core source scan covers the new `src/cache-helpers.ts` file; no extra edit needed beyond the provider-literal guard already extended in task 2.
    - References:
      - `packages/provider-openrouter/src/cache.ts` `openRouterSessionId`/`withOpenRouterCache`/`openRouterUsage` are the duplication this centralizes.
      - `packages/provider-openai/src/cache.ts` `promptCacheKey`/`promptCacheRetention`.
      - Anthropic `cache_control` supports `{ type: "ephemeral" }` and `{ type: "ephemeral", ttl: "1h" }` (long retention) — drives the `ttl` option.
      - `src/contracts.ts` `Usage` is the normalized source for hit-rate/savings.
  - Test Cases Written:
    - `sanitizeCacheKey`: invalid chars are normalized to safe key text, max length is honored, empty/undefined input returns `undefined`.
    - `mapCacheRetention`: `long` stays long only when model declares long-retention support, downgrades to `short` when unsupported, and `none`/cache-kind `none` omit provider cache retention.
    - `applyCacheControl`: stamps only selected breakpoint messages, respects `maxBreakpoints`, supports `ttl: "1h"`, and does not mutate original messages.
    - `cacheHitRate`: handles normal cached-token ratios and zero input tokens.
    - `cacheSavings`: estimates read-token savings from `ModelCost.input/cacheRead` and returns `undefined` without pricing data.
    - Boundary test: Phase 12 source scan passed over `src/cache-helpers.ts`, confirming no forbidden provider-specific literals in core helper source.
    - Verification run: `npm run build:core && node --test dist/__tests__/cache-helpers.test.js dist/__tests__/public-contracts.test.js dist/__tests__/phase12-boundaries.test.js` passed (35 tests).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new exported helper functions.
    - Docs pages to create/edit:
      - `docs/provider-caching.md`: document each helper with the API-page structure (What it does / When to use it / Inputs / Outputs / Example).
      - `docs/public-contracts.md`: list the new helper exports.
    - `docs/index.md` update: yes; ensure `Provider caching` links the helpers (in the docs task).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Author cache/provider/model docs and wire docs tests
  - Acceptance Criteria:
    - Functional: Create `/docs/provider-caching.md`, `/docs/provider-request-policies.md`,
      and `/docs/model-registry.md` following the Prism wiki API-page structure
      (What it does / When to use it / Inputs / Outputs / Example /
      Extension notes / Security & performance / Related APIs). Update
      `docs/index.md` with the three navigation entries, and cross-reference
      `docs/provider-layer.md`, `docs/provider-packages.md`, and
      `docs/public-contracts.md`. Add the three pages to the `apiPages` list in
      `src/__tests__/docs.test.ts` so the API-page heading check enforces them.
    - Performance: Docs are static markdown; no runtime impact. Docs test
      additions stay cheap (file reads + heading regex).
    - Code Quality: Docs reuse actual exported types/signatures; examples
      compile against the new contracts (covered by the typed-examples path or
      `public-contracts.test.ts`); no invented APIs.
    - Security: Docs state explicitly that cache hints are best-effort and do
      not guarantee cache hits, that cache keys must never be credentials, and
      that provider-owned auth/session headers always win over caller headers.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` (API-page structure + index grouping).
      - `roadmap.md` Phase 42 docs deliverable list.
      - `docs/provider-layer.md`, `docs/provider-packages.md`,
        `docs/public-contracts.md` current cache/model wording.
      - `src/__tests__/docs.test.ts` `apiPages` array and heading check.
    - Options Considered:
      - Fold cache docs into `docs/provider-layer.md` only: roadmap explicitly
        requires dedicated `provider-caching.md`; rejected.
      - Create all three pages as standalone, index-linked pages: chosen.
    - Chosen Approach:
      - `provider-caching.md`: documents `PromptCacheHints`, breakpoints,
        `ModelCacheCapabilities`, the shared helpers, the legacy
        `cacheKey`/`cacheRetention` alias + migration note, and a per-kind
        behavior table (OpenAI key / Anthropic+OpenRouter `cache_control` /
        implicit / none) with the "no guaranteed hits" caveat.
      - `provider-request-policies.md`: documents `createSessionCachePolicy`,
        `createProviderRequestPolicyChain`, `mergeProviderRequestOptions`
        (including `cache` merge), and how providers consume the chain.
      - `model-registry.md`: documents `createModelRegistry`, `ModelConfig`
        metadata (`capabilities`, `limits`, `cost`, `cache`, `compat`,
        `parameters`), and how packages register models.
      - Add all three to `apiPages`; add targeted heading/wording regressions
        (alias note, no-guaranteed-hits caveat, header-ownership rule).
    - API Notes and Examples:
      ```ts
      // provider-caching.md example
      const hints: PromptCacheHints = { mode: "on", key: "stable", breakpoints: [{ location: "system_prompt" }] };
      ```
    - Files Created/Edited:
      - `docs/provider-caching.md`: new API page documenting `PromptCacheHints`, breakpoints, `ModelCacheCapabilities`, cache helpers, legacy aliases, best-effort/no-guaranteed-hits caveat, and cache-key/header safety.
      - `docs/provider-request-policies.md`: new API page documenting `createSessionCachePolicy`, `createProviderRequestPolicyChain`, `mergeProviderRequestOptions`, structured cache merge behavior, and header ownership.
      - `docs/model-registry.md`: new API page documenting `createModelRegistry`, `ModelConfig` metadata, `ModelCacheCapabilities`, duplicate policy, and package registration.
      - `docs/index.md`: added the three entries under the provider/model group.
      - `docs/provider-layer.md`, `docs/provider-packages.md`, `docs/public-contracts.md`: cross-linked the new pages and listed the new cache/model contracts and helper exports.
      - `src/__tests__/docs.test.ts`: added the three pages to `apiPages` and added wording regressions for alias note, no-guaranteed-hits/best-effort caveat, cache-key safety, header ownership, helper names, policy APIs, and model metadata.
    - References:
      - `src/__tests__/docs.test.ts` line 8 `apiPages` and the heading-check test are the enforcement points.
      - `docs/api-page-template.md` for the required section layout.
  - Test Cases Written:
    - `docs apiPages include the three new pages`: implemented through `apiPages` plus explicit assertions in `phase42 cache provider model docs are linked and cover safety wording`; heading check enforces API-page structure.
    - `provider-caching docs contain alias + no-guaranteed-hits + header-ownership wording`: implemented with explicit phrase regressions.
    - `docs index links all three new pages`: implemented with explicit index-link assertions and existing local-link checker.
    - Verification run: `npm run build:core && node --test dist/__tests__/docs.test.js` passed (55 tests).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; this task is the docs delivery for the new public surface.
    - Docs pages to create/edit:
      - `docs/provider-caching.md` (new), `docs/provider-request-policies.md` (new), `docs/model-registry.md` (new).
      - `docs/index.md`, `docs/provider-layer.md`, `docs/provider-packages.md`, `docs/public-contracts.md`: cross-links.
    - `docs/index.md` update: yes; add `Provider caching`, `Provider request policies`, `Model registry`.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Final verification and release-safety checks
  - Acceptance Criteria:
    - Functional: All new public types and helpers are exported from
      `src/index.ts`, examples compile, legacy `cacheKey`/`cacheRetention`
      behavior is unchanged, and first-party providers compile without being
      forced to adopt the new surface.
    - Performance: `npm test` remains network-free and under the documented
      `< 30s` budget; cache-helper/boundary tests add no timing sensitivity.
    - Code Quality: `npm run typecheck` and `npm test` pass; no new dependency;
      no hidden global cache setting; no provider literals in `src/`.
    - Security: No credentials in cache keys/docs/fixtures; header-ownership
      rule documented; redaction path unchanged.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md` no-network/default test budget.
      - The three new docs pages and `docs/index.md` after edits.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Add a dedicated `npm run test:cache` script: unnecessary; `npm test` already covers it.
      - Use existing `npm test`/typecheck/docs checks only: chosen.
    - Chosen Approach:
      - Run default project checks; update this plan's `Compromises Made` and
        `Further Actions` only after implementation passes.
    - API Notes and Examples:
      ```sh
      npm run typecheck
      npm test
      ```
    - Files Created/Edited:
      - `plans/043-prompt-cache-primitives-and-provider-capability-metadata.md`: marked all six tasks complete and filled final verification, compromises, and further-actions sections after execution.
    - References:
      - `docs/release-and-install.md` pins default `npm test` as network-free and under budget.
      - `src/__tests__/phase12-boundaries.test.ts` is the provider-literal gate for core.
  - Test Cases Run:
    - `npm run typecheck` passed: core build, workspace typechecks, and examples `tsc -p examples --noEmit` all completed successfully.
    - `npm test` passed: full build, core test suite, workspace tests, package guards, and network-free live-test skip gates completed successfully.
    - Release-safety audit script passed: confirmed root exports for cache helpers and contracts, structured/cache metadata contracts, docs safety wording, no provider-specific literals in `src/cache-helpers.ts`, and no `package.json`/`package-lock.json` dependency diff.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new behavior in this task; verifies earlier tasks.
    - Docs pages to create/edit:
      - `none`: verification only unless drift is found.
    - `docs/index.md` update: no additional update beyond earlier tasks.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- First-party provider packages were not migrated to consume the new structured cache hints/helpers in this phase. Rationale: Phase 42 only adds generic primitives, docs, and tests; Phase 44 is the planned provider behavior hardening/migration.
- `applyCacheControl()` stamps Prism `Message` anchors, not every provider-native message shape. Rationale: keeps core provider-agnostic and pure; providers map their native wire format explicitly.
- `cacheSavings()` is an estimate from normalized usage and `ModelCost`; it returns `undefined` without pricing data and does not infer provider billing units beyond the documented `unit` string.

## Further Actions
- Phase 44: migrate first-party providers to read `ProviderRequestOptions.cache`/`ModelConfig.cache` and call shared helpers where applicable.
- Phase 43: add cache-aware input ordering and diagnostics around stable context/resources if needed by host apps.
- Future docs/examples: add provider-specific cache examples once provider migrations land.
