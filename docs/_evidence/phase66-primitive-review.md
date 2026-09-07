# Phase 66 — Primitive review: request-construction inventory + per-provider expected-wire matrix

Primitive review for `plans/066-Provider-Request-Construction-And-0-5-1.md` Task 1.
Inventory every existing request-construction / session / cache / thinking primitive,
freeze the per-provider P1/P2/P3 wire matrix, and assign primitives to later tasks —
so no task invents a second options tree, auto-activates package policies, or wraps
`AIProvider.generate()`.

Document-only. No production code in this task.

## Defect (why this review exists)

Adapters already map `ProviderRequestOptions.sessionId` / `cacheKey` / `cache` /
thinking compat onto vendor wire fields. Prism-owned generate sites do **not**
stamp those options unless the host attaches `createSessionCachePolicy` (or
equivalent `providerOptions`). Observational-memory workers and LLM compaction
bypass the agent-session policy chain. OpenCode Go then hard-rejects missing
`x-opencode-session` as an opaque upstream 400.

Docs currently say hosts decide which request policies become active
(`docs/provider-packages.md` ~L104). That contract is the defect.

## Inventory

### Core (`@arnilo/prism`) — reuse, do not duplicate

| Primitive | Location | Verdict |
| --- | --- | --- |
| `ProviderRequestOptions` | `src/contracts-core/provider.ts:49-62` | **Reuse** — generic hint bag (`sessionId`, `cacheKey`, `cacheRetention`, `cache`, `headers`, `compat`, `extra`, `structuredOutput`, `continuation`). No mandatory-vs-optional distinction. Do not add `thinkingLevel` here (intent belongs on agent/run). |
| `PromptCacheHints` / `PromptCacheBreakpoint` | `src/contracts-core/provider.ts:21-41` | **Reuse** — `cache.mode` / `key` / `retention` / `breakpoints`. Locations already include `system_prompt` and `last_stable_message`. |
| `ModelCacheCapabilities` | `src/contracts-core/provider.ts:10-18` | **Reuse** — P2 reads `kind` (`cache_control` / `openai_key` / `implicit` / `none` / `provider_specific`) and `explicitBreakpoints`. |
| `assembleProviderInput` | `src/input.ts:180-320` | **Gap** — takes `sessionId` via `InputBuildContext` (`src/contracts-core/agent.ts:267-275`) for injectors/context, then returns `options: options.providerOptions` (`src/input.ts:311-320`). Session id never lands on `ProviderRequest.options`. Task 3 fill-if-missing. |
| `applyProviderRequestPolicies` | `src/agent-session/session.ts:461-472` | **Keep host-only** — concatenates `AgentConfig.providerRequestPolicies` + `RunOptions.providerRequestPolicies`. Empty list returns the request untouched. Does **not** read the contribution registry. |
| `createProviderRequestPolicyChain` | `src/provider-request-policy.ts:14-29` | **Reuse** — ordered apply + secret accumulation. |
| `createSessionCachePolicy` | `src/provider-request-policy.ts:32-47` | **Keep overlay** — stamps `sessionId` from `request.options.sessionId ?? context.sessionId`, `cacheKey` from override or that id, `cacheRetention` default `"short"`. Production callers: tests only in this repo. Clay host-injects it (workaround). Do **not** mutate into the default. |
| `mergeProviderRequestOptions` | `src/provider-request-policy.ts:49-74` | **Reuse** — patch scalars win; `headers`/`compat`/`extra` shallow-merge; `cache.breakpoints` **concatenate**. Helper fill-if-missing must not concatenate default breakpoints onto a non-empty host list. |
| `normalizeProviderRequestPolicyResult` | `src/provider-request-policy.ts:76-78` | **Reuse**. |
| `registerProviderRequestPolicy` | `src/extensions.ts:201-204` + `ExtensionAPI` `src/contracts-core/extensions.ts:196` | **Dead for construction** — writes `registries.providerRequestPolicies`. Agent session never resolves that registry. First-party provider packages never call it. Hits: tests only. **Do not auto-activate.** |
| `ProviderRequestPolicyContext` | `src/contracts-core/extensions.ts:147-153` | **Reuse** — already carries `sessionId` for policies. Helper is not a policy. |
| `sanitizeCacheKey` | `src/cache-helpers.ts:24-34` | **Reuse** — keeps `A-Za-z0-9_.:-`; colon survives, so `om:{uuid}` is legal. Adapters clamp. Core helper must **not** re-sanitize (adapters own vendor length caps). |
| `mapCacheRetention` | `src/cache-helpers.ts:36-39` | **Reuse** — adapters already gate `"long"` via `model.cache.longRetention`. |
| `applyCacheControl` | `src/cache-helpers.ts:41-62` | **Reuse** — stamps `cache_control` on last block of selected messages. No-op when no selected indices. Does not stamp `tools[]`. |
| `resolveBreakpoint` | `src/cache-helpers.ts:116-133` | **Reuse** — `system_prompt` = first system message; `last_stable_message` = `length-2` (or last if length ≤ 1). Two-message compaction (system+user) may mark system twice; acceptable. |
| `applyThinkingLevelForModel` | `src/thinking.ts:198-213` | **Reuse** — snaps + family patch. OM/compaction already call it. Task 7 wires agent/run `thinkingLevel` through the construction helper into this function. |
| `thinkingCompatFor` / `snapThinkingLevel` / `thinkingFamilyForModel` | `src/thinking.ts` | **Reuse** — plan 065. Do not invent a second thinking API. |
| `assertStructuredOutputRequestSupported` / `StructuredOutputError` | `src/structured-output.ts:18-70` | **Fail-fast precedent (behavior)** — throw before fetch when a declared requirement is missing. Codes are unprefixed (`unsupported_model`, …). |
| `AgentDecisionError` | `src/contracts-run-state.ts:145-160` | **Code-shape precedent** — `ERR_PRISM_*` frozen string codes. `ProviderRequirementError.code` is `ERR_PRISM_PROVIDER_REQUIREMENT`. |
| `resolveRunProviderOptions` | `src/structured-output.ts:78-89` | **Reuse** — merges config/run `providerOptions` + structured-output loop. Does not stamp sessionId. Do not overload it with session/cache/thinking. |
| `generateProviderTurn` | `src/agent-session/session/provider-round.ts:119-262` | **Do not stamp here** — loops/`ctx.generate` must see the stamped request. Stamp before `generateWithRetry`. |
| `AIProvider.generate` | `src/contracts-core/provider.ts:74-77` | **Escape hatch** — do not wrap. Tests, examples, image generation, and raw host calls stay unstamped. OpenCode Go fail-fast is the safety net. |

### Agent / run contracts — extend in Task 7 only

| Field | Location | Verdict |
| --- | --- | --- |
| `AgentConfig.providerOptions` / `providerRequestPolicies` | `src/contracts-core/agent.ts:80-81` | **Keep**. Policies stay overlays. |
| `RunOptions.providerOptions` / `providerRequestPolicies` | `src/contracts-protocol.ts:81-82` | **Keep**. |
| `thinkingLevel` on AgentConfig / RunOptions | — | **Missing**. Today hosts must wrap `providerOptions` via `applyThinkingLevelForModel` (`docs/thinking-and-reasoning.md`). OM/compaction already have `thinkingLevel?: string`. Task 7 adds the agent/run field; do not put it on `ProviderRequestOptions`. |

### Memory generate sites — stamp in Task 4

| Site | Location | Today | Verdict |
| --- | --- | --- | --- |
| OM `runMemoryWorkerLoop` | `packages/memory/src/compaction/observational-memory/worker-loop.ts:52-63` | `provider.generate` with `thinkingLevel` merge only. No sessionId. No policies. | **Stamp** `om:{attachedSession.id}` via helper. Host `providerOptions.sessionId` wins. |
| OM runtime | `packages/memory/src/compaction/observational-memory/runtime.ts:40-64` | Has `session: AgentSession` (`options.session.id`). Observer/reflector/dropper options have no `sessionId`. | **Pass** derived id into the loop (one place). Shared across observer/reflector/dropper. Worker `model`/`provider` stay independent. |
| LLM `runSummaryProvider` | `packages/memory/src/compaction/llm/strategy.ts:149-201` | Builds request from `providerOptions` + optional thinkingLevel. Applies `providerRequestPolicies` **only if** strategy options include them. | **Always** run helper with `context.sessionId` (agent session) **before** optional policies. |

### Prism-owned vs escape-hatch generate

Prism-owned (must call helper):

1. Agent session `ctx.generate` (`src/agent-session/session/assemble.ts:242-265`) — assemble → (empty) policies → middleware → `generateWithRetry` → `generateProviderTurn`.
2. OM `runMemoryWorkerLoop`.
3. LLM `runSummaryProvider`.

Not Prism-owned (do not wrap): `AIProvider.generate` in tests, `examples/cache-aware-prompt-assembly.ts`, image providers, conformance collectors.

### Per-adapter session / cache maps — stay provider-local

| Adapter | Session/cache-key map | Cache markers | Notes |
| --- | --- | --- | --- |
| openai | `promptCacheKey` `packages/prism-providers/src/openai/cache.ts:7-12` (`cacheKey??sessionId`, max 64); Responses header `x-client-request-id` from `sessionId` (`responses.ts:133`) | `promptCacheOptions` + `applyPromptCacheBreakpoints` only when `model.cache.explicitBreakpoints` and breakpoints/`mode:on` | `promptCacheRetention` emits `24h` only for `cacheRetention:"long"` + `longRetention` |
| anthropic | `anthropicOwnedHeaders` `provider.ts:20-32` — `x-client-request-id` from `sessionId` only | `applyAnthropicCacheControl` no-op without breakpoints | featured models `kind: cache_control` |
| google | `googleOwnedHeaders` `provider.ts:20-31` — `x-client-request-id` from `sessionId` | none (Gemini `cachedContent` host-owned, phase37) | |
| openrouter | `openRouterSessionId` `cache.ts:7-12` (`cache.key??cacheKey??sessionId`, max 256) → header `x-session-id` + body `session_id` | `applyOpenRouterCacheControl` if breakpoints; else `openRouterTopLevelCacheControl` top-level automatic | **P2 changes this**: default breakpoints suppress top-level automatic (test `openrouter_no_breakpoints_emits_top_level_automatic_cache_control`) |
| opencode-go | `opencodeSessionId` `cache.ts:12-14` (`cacheKey??sessionId`, max 128); `opencodeOwnedHeaders` omits `x-opencode-session` when empty | Anthropic route `applyOpencodeAnthropicCacheControl` needs breakpoints; OpenAI route never emits `cache_control` | **Mandatory**. Today: omit → upstream 400. Task 5 throw before fetch. |
| xai | `xGrokConvId` `cache.ts:15-18` (`cache.key??cacheKey??sessionId`) → `x-grok-conv-id`; gated by `xaiCacheEnabled` | implicit; header is the correlation | `cacheRetention:"none"` / `cache.mode:"off"` omit the header |
| alibaba | none | `applyAlibabaCacheControl` only if `kind===cache_control` or `mode:on` **and** breakpoints; max 4 | default catalog is implicit |
| kimi | none extra | Anthropic/Coding: `applyKimiAnthropicCacheControl` needs breakpoints; Moonshot: never | |
| hyper | Responses: inherits OpenAI `prompt_cache_key` via `createOpenAIResponsesProvider` (`hyper/provider.ts:34-47`). Chat + Anthropic: no session header | Anthropic: `applyHyperAnthropicCacheControl` needs breakpoints (no ttl). Chat: implicit. Responses: openai_key rules | |
| commandcode | none | Anthropic: `applyCommandCodeCacheControl` needs breakpoints, never ttl. OpenAI: implicit, **no** `prompt_cache_key` (deferred live probe) | |
| deepseek | none | implicit; no `cache_control` | |
| zai | none | implicit | |
| neuralwatt | none | implicit | |
| ollama | none | implicit / host-owned | |
| clinepass | none | **strips** `cache_control` in `clinePassTransform` (`provider.ts:39-40`) | |
| azure | none | host-owned; `assertNoForeignCacheFields` | |
| bedrock | none | host-owned; no `cachePoint` | |
| vertex | none | host-owned; no `cachedContents` | |
| ai-sdk | none | host-owned | |
| openai-compatible factory | none | sends **no** `prompt_cache_key` / `cache_control` (phase37) | wrappers own mapping |

Provider-owned headers already win over caller `x-opencode-session` / `x-session-id` / `x-client-request-id` / `x-grok-conv-id` (existing tests). Keep that.

First-party package `setup()` registers provider + models + auth only. None call `registerProviderRequestPolicy`.

## Frozen per-provider P1 / P2 / P3 wire matrix

Do not redesign in later tasks. Tasks 5–7 implement this table.

| Adapter | P1 session/cache-key wire | Mandatory | P2 default cache | P3 thinking (plan 065 maps; session field must reach it) |
| --- | --- | --- | --- | --- |
| openai | `prompt_cache_key` from `cacheKey??sessionId`; `x-client-request-id` from `sessionId` | no | GPT-5.6+ `explicitBreakpoints` → `prompt_cache_breakpoint`; retention 24h still gated | `reasoning.effort` |
| anthropic | `x-client-request-id` from `sessionId` | no | `cache_control` on `system_prompt` + `last_stable_message` | `thinking` + `output_config.effort` |
| google | `x-client-request-id` from `sessionId` | no | none (no Prism markers) | `thinkingConfig` |
| openrouter | `x-session-id` + body `session_id` | no | default breakpoints → **per-message** `cache_control` (replaces no-breakpoint top-level automatic) | `reasoning.effort` |
| opencode-go | `x-opencode-session` from `cacheKey??sessionId` | **yes** | Anthropic route: `cache_control` markers; OpenAI route: none | route-native |
| xai | `x-grok-conv-id` from `cache.key??cacheKey??sessionId` | no | implicit; header is the correlation | `reasoning_effort` |
| alibaba | none | no | only if `model.cache.kind === "cache_control"` | `enable_thinking` |
| kimi | none extra | no | Anthropic/Coding route: `cache_control`; Moonshot: none | `thinking` / `reasoning_effort` |
| hyper | Responses: `prompt_cache_key`; chat/Anthropic: no session header | no | Anthropic: `cache_control`; Responses: openai_key rules; chat: implicit | route-native |
| commandcode | none | no | Anthropic: `cache_control`; OpenAI: implicit (**no** `prompt_cache_key`, existing defer) | route-native |
| deepseek | none | no | implicit, no markers | `thinking` + `reasoning_effort` |
| zai | none | no | implicit, no markers | `thinking` + `reasoning_effort` |
| neuralwatt | none | no | implicit, no markers | `reasoning_effort` |
| ollama | none | no | implicit, no markers | `reasoning_effort` |
| clinepass | none; strips `cache_control` | no | implicit, no markers | slot-map `reasoning_effort` |
| azure | none | no | host-owned, no Prism cache fields | existing `buildBodyExtra` |
| bedrock | none | no | host-owned | existing `buildBodyExtra` |
| vertex | none | no | host-owned | existing `buildBodyExtra` |
| ai-sdk | none | no | host-owned | noop family |

P2 default breakpoints (when allowed): `[{ location: "system_prompt" }, { location: "last_stable_message" }]` plus `cacheRetention: "short"` if unset. Skip when `cache.mode === "off"`, `cacheRetention === "none"`, host breakpoints non-empty, or model `kind` is not `cache_control` and `explicitBreakpoints` is not true.

## One new core primitive

```ts
applyDefaultProviderRequestOptions(request, {
  sessionId,          // P1: fill-if-missing sessionId + cacheKey
  thinkingLevel,      // P3 (Task 7): applyThinkingLevelForModel
}): ProviderRequest

class ProviderRequirementError extends Error {
  readonly code = "ERR_PRISM_PROVIDER_REQUIREMENT";
  readonly requirement: string;
  readonly providerId?: string;
}
```

Rules:

- Fill-if-missing only. Host `sessionId` / `cacheKey` / breakpoints / `cacheRetention` always win.
- No-op when `ctx.sessionId` is empty/undefined and request already has none. Adapters never mint UUIDs.
- Do **not** add a dead `defaultCache` flag in Task 2. Task 6 extends the same function using `request.model.cache`.
- Do **not** sanitize in core; adapters clamp.
- Error messages: requirement + provider id; no bodies, tokens, or raw option dumps.
- Live next to `createSessionCachePolicy` (`src/provider-request-policy.ts`) or a sibling re-exported from it.

Stay provider-local: every header/body field in the matrix, `opencodeSessionId` / `promptCacheKey` / `openRouterSessionId` / `xGrokConvId`, `apply*CacheControl`, strip lists, route switches.

## Rejected options (do not reopen)

| Option | Why rejected |
| --- | --- |
| Auto-activate package-registered `createSessionCachePolicy` | Registry unread by agent session; OM/compaction still miss; still opt-in-shaped. |
| Wrap every `AIProvider.generate` | Hides missing ids; breaks explicit test/example requests; image/realtime seams are not chat construction. |
| Generic `mandatoryRequestFields` manifest | One boolean today (OpenCode Go session). Adapter is the source of truth. |
| Mutate `createSessionCachePolicy` into the default | Clay overlay semantics must keep working; policies stay optional. |
| Stamp only inside `assembleProviderInput` | OM/compaction do not assemble. |
| Stamp only inside `generateProviderTurn` | Loops/`ctx.generate` would not see stamped options. |
| Same correlation id for OM and agent | User: OM fully separate, may use a different model. Derived `om:{session.id}`. |
| Per-worker suffix `om:{id}:observation` | Extra cache fragmentation; add later if collisions appear. |

## Per-task primitive assignment

| Task | Uses | Must not invent |
| --- | --- | --- |
| 2 | `mergeProviderRequestOptions`; new helper + `ProviderRequirementError` (`ERR_PRISM_*` like `AgentDecisionError`; fail-fast like `assertStructuredOutputRequestSupported`) | mandate schema; cache/thinking flags that do nothing |
| 3 | helper after assemble, before policies; assembler copies `options.sessionId` fill-if-missing | second stamp in `generateProviderTurn`; reading the unread registry |
| 4 | helper in OM loop (`om:{session.id}`) and compaction (`context.sessionId`); keep existing `applyThinkingLevelForModel` | new session object; per-kind OM ids |
| 5 | existing adapter maps + OpenCode Go throw `ProviderRequirementError` before fetch | new vendor fields; core `switch (providerId)` |
| 6 | extend helper from `model.cache`; `applyCacheControl` / `resolveBreakpoint` already in adapters | adapter-local default breakpoint lists |
| 7 | `applyThinkingLevelForModel`; add `thinkingLevel?` on `AgentConfig` / `RunOptions` | `thinkingLevel` on `ProviderRequestOptions`; second thinking helper |
| 8 | rewrite hosts-decide sentence; demote `createSessionCachePolicy` to overlay | new docs page |

## Security

- Session/cache keys are correlation ids, never secrets. Do not log full request bodies.
- `sanitizeCacheKey` already strips disallowed characters at adapters.
- Provider-owned headers stay after caller headers (auth, content-type, session/cache).
- Fail-fast message names requirement + provider id only.
- Derived OM id is not a credential.

## Known follow-through (not this task)

- OpenRouter test `openrouter_no_breakpoints_emits_top_level_automatic_cache_control` must flip in Task 6 when defaults apply.
- Compaction two-message `last_stable_message` may coincide with `system_prompt`; leave it.
- Command Code GPT-5.6 `prompt_cache_key` and Anthropic `tools[]` `cache_control` stay deferred (phase37 / existing tests).
- Azure / Bedrock / Vertex / AI SDK: options may carry `sessionId`; **no new wire cache fields**.
