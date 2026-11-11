# Changelog

## [Unreleased]

- Consolidate eleven providers into `@arnilo/prism-ai`, with one import per provider.

## ./commandcode

## [Unreleased]

- Route `reflection/beam:free` through Chat with `reasoning_content` replay so tool follow-ups preserve the upstream's required reasoning.

- Restore Command Code as a lockstep Prism provider on the Provider API: three wires (Chat Completions, Responses, Anthropic Messages) selected by catalog `supported_endpoints` and `claude-*`, per-request secret refs, provider-owned `x-cmd-zdr`, discovery, `reasoning_details` replay on Chat, the 64-char `prompt_cache_key` and `x-client-request-id` affinity on Responses, and explicit `cache_control` markers on Messages with adaptive thinking for Claude 5.x. Wire fixtures replay all three routes offline; live tests default to the three exemplars.

## ./hyper

## [Unreleased]

### Changed

- Rebuilt `createHyperProvider` on the shared routed builder (`createRoutedProvider`) with dual routes: `openai` (`/chat/completions`) and `anthropic` (`/messages`) (plan 183 Task 2).
- Surfaced Hyper usage monetization fields (`cost.usd`, `cost.hypercredits`, `remaining.hypercredits`) into `Usage.cost`, `Usage.currency`, and `Usage.metadata.hyper`.
- Added wire test recordings in `src/__tests__/wire/` (`openai` and `anthropic`) with full `providerConformance({ recordings })` coverage.
- Exported route definitions `HYPER_CHAT_ROUTE`, `HYPER_MESSAGES_ROUTE`, and usage mapper `withHyperCost`.

### Removed

- Removed obsolete wire and retry helper exports: `hyperChatBody`, `hyperChatEvents`, `serializeHyperChatMessage`, `classifyHyperError`, `hyperHttpError`, `applyHyperAnthropicCacheControl`, `hyperAnthropicCacheEnabled`, `hyperPreserveThinking`, `hyperReasoningEffort`, `hyperThinking`, `stripHyperOwnedCompat`.

### Added

- New provider package (plan 152 Task 5): `@arnilo/prism-ai/hyper` replaces the
  `@arnilo/prism-providers/hyper` subpath. The default export is a `definePackage` definition that
  registers the `hyper` provider, declares `capabilities: ["credentials"]`, and takes a ref-only config
  (`apiKey` defaults to `env:HYPER_API_KEY`, plus `baseUrl`, `models`). The key resolves through the
  credentials slot on every request; a missing key records a `warn` status note, registers anyway, and fails
  a run with `credential_unavailable`. The raw factory, the wire helpers, the cache/thinking helpers, and the
  catalog stay named exports.

## [0.1.0] - 2026-08-09

- Release-graph anchor: every first-party manifest carries `0.1.0` and `0.0.28` changelog sections.
  This package is introduced on the lockstep line by plan 152 Part B.

## [0.0.28] - 2026-08-08

- Release-graph anchor (see above); no published artifacts predate the 0.12 line.

## ./kilo

## [Unreleased]

- Add Kilo AI Gateway as a Prism provider: three wires (Chat Completions, Responses, Anthropic Messages) selected by the catalog's `opencode.ai_sdk_provider`, `env:`/`keyring:` key resolution with a device-login fallback, `X-KILOCODE-TASKID` affinity, optional organization and mode headers, `provider.data_collection`, USD cost and cache usage mapping, catalog discovery with `isFree`/`mayTrainOnYourPrompts`/alias metadata, and recorded wire fixtures for all three routes.
- Add the `kilo` device login as an `oauth` `AuthMethod`: initiate, allowlisted verification URL, 3-second polling with approval/denial/expiry/busy mapping, profile organization choice, a v1 bearer credential with JWT expiry (one-year fallback), request-time key-first resolution, and local logout. The package now declares `credentials:write`.
- Match the Kilo CLI's cache levers per wire: the Responses route sends no `prompt_cache_key` (the CLI sends none and the gateway places its own breakpoints), Messages keeps the CLI's first-two-system/last-two-message `cache_control` placement, and the offline `cache_levers_match_kilo_cli` test pins the task-id header, marker placement, and a byte-stable prefix across the plan-203 turns against recorded CLI 7.8.18 requests.

## ./laya

## [Unreleased]

### Added

- New provider package (plan 152 Task 5): `@arnilo/prism-ai/laya` replaces the
  `@arnilo/prism-providers/laya` subpath. The default export is a `definePackage` definition that
  registers the `laya` provider, declares `capabilities: ["credentials"]`, and takes a ref-only config
  (`apiKey` defaults to `env:LAYA_API_KEY`, plus `baseUrl`, `models`). The key resolves through the
  credentials slot on every request; a missing key records a `warn` status note, registers anyway, and fails
  a run with `credential_unavailable`. The raw factory, the wire helpers, the cache/thinking helpers, and the
  catalog stay named exports.

### Changed

- Rebuilt on `systemOneProviderPackage` from `@arnilo/prism/provider-kit` sharing single-shape decision-provider implementation with TypeSafe Jev.
- Renamed `DEFAULT_LAYA_BASE_URL` to `LAYA_DEFAULT_BASE_URL` and added `LAYA_DEFAULT_API_KEY_REF`. Removed obsolete `layaBaseUrl`.
- Plaintext remote endpoint warning now warns through System One in `provider-kit`, printing only the origin without userinfo.
- Implemented `systemOneConformance` coverage and added skip probe for local `laya-serve` instance in `live.test.ts`.

## [0.1.0] - 2026-08-09

- Release-graph anchor: every first-party manifest carries `0.1.0` and `0.0.28` changelog sections.
  This package is introduced on the lockstep line by plan 152 Part B.

## [0.0.28] - 2026-08-08

- Release-graph anchor (see above); no published artifacts predate the 0.12 line.

## ./liquid

## [Unreleased]

### Added

- New provider package (plan 196 Task 2): `@arnilo/prism-ai/liquid` registers two System One
  decision providers from one vendor package — hosted `liquid` (`d1.1`, `d1-ultra` at
  `https://api.liquid.ai/decisions/v1/systemone`, key from `env:LIQUID_API_KEY`) and `liquid-local`
  (`d1-3B` served by llama.cpp `llama-server` at `http://127.0.0.1:8080`, optional `localApiKey`).
  `hosted: false` is a local-only setup that skips the hosted missing-key note. Built on
  `@arnilo/prism/provider-kit`'s `createSystemOneDecisionProvider`; the package avoids
  `systemOneProviderPackage` because that helper registers exactly one provider.

## [0.13.0]

- Release-graph anchor: introduced on the 0.13.0 lockstep line by plan 196 (Phase 18 Part B).

## ./litellm

## [Unreleased]

- Add `@arnilo/prism-ai/litellm`: one Chat Completions route to a host-run LiteLLM Proxy, conservative
  per-group discovery from `/model/info` (fallback `/v1/models`), a Prism-minted `x-litellm-call-id` with
  `x-litellm-*` response telemetry on `usage.metadata.litellm`, cost from `x-litellm-response-cost` with the
  catalog as fallback, marker-free prompt caching with a per-model `anthropic-blocks` opt-in, and error mapping
  including the proxy's 422 budget refusal and 413 `context window limit` overflow (plan 214 Task 2).
- Add `litellmSpendLogs` and the pure `normalizeSpendRow`: read the proxy's `/spend/logs` for a set of call ids
  (≤20 indexed single-id reads, otherwise ≤50 paged `/spend/logs/v2` range reads), poll for rows the proxy has
  not flushed yet (default 24 s, cap 60 s), filter every row to a requested id, and return
  `{ callId, model, modelGroup, modelId, spend, promptTokens, completionTokens, cacheReadTokens, startTime,
  endTime, status }` with `messages`/`response`/`api_key`/`api_base`/`metadata` never copied (plan 214 Task 3).

## ./ollama-cloud

## [Unreleased]

### Added

- New provider package (plan 206 Task 2): `@arnilo/prism-ai/ollama-cloud` registers the
  `ollama-cloud` provider with the measured native NDJSON `/api/chat` route (default) and the
  OpenAI-compatible `/v1/chat/completions` route used by `pi-ollama-cloud`.
- Native route streams text, thinking, tool calls, images, and JSON-schema structured output, and maps
  `prompt_eval_cached_count` to `cacheReadTokens`.
- `ollamaCloudBalance()` exposes `/api/balance` session/weekly limits and purchased balance.
- Caller-gated `listOllamaCloudModels()` discovery via `/api/tags` + `/api/show` (concurrency 4), with
  context windows and thinking values.
- Wire recordings for both routes, including the measured overflow body and the fenced structured
  output reply.
- Live scenarios for the native and compat routes.
- Decision models (plan 210 Task 5): a model whose `/api/show` capabilities include `decision` (for
  example `clef:27b`) maps to `capabilities.decisions: true`, and the provider serves
  `decisions()` plus structured-output runs over the System One wire at `/v1/systemone`
  (`OLLAMA_CLOUD_SYSTEMONE_PATH`, `defineOllamaCloudDecisionModel()`).
- `ollamaCloudBalance()` reads the current plans' monthly included credit (`included.balanceUsd`,
  `allowanceUsd`, `periodFrom`, `periodUntil`) besides the legacy session/weekly windows.

### Changed

- The shared context-overflow classifier now matches Ollama's measured
  `exceeded max context length` body, and quota classification recognizes session/weekly limit
  wording.
- `providerConformance` no longer mistakes the native `/api/chat` path for an OpenAI Chat route.
- `runProviderLiveScenarios` accepts a `native` route.

### Removed

- No Anthropic Messages route: the native route is the measured default and no reference harness uses
  `/v1/messages`.

## ./openai-codex

## [Unreleased]

- New provider package (plan 204 Task 5): `@arnilo/prism-ai/openai-codex` registers the
  `openai-codex` provider for OpenAI models on a ChatGPT plan through Sign in with ChatGPT. The
  grant lives in a writable `keyring:` ref (default `keyring:openai-codex`), is refreshed per request
  inside a five-minute margin, and persists the rotated record before it is used. The package declares
  `capabilities: ["credentials", "credentials:write"]`; an `env:` credential ref is refused at load,
  and a missing record records `openai-codex: not signed in` and still registers the provider.
- One stateless route: `POST /responses` with `store: false`, `stream: true`, and
  `include: ["reasoning.encrypted_content"]`. `prompt_cache_key` is clamped to 64 characters; the same
  key travels as `session_id` and `x-client-request-id`. Fourteen route-refused fields are deleted
  after the body is built, `max_output_tokens` passes through with a local minimum of 16, and
  `previous_response_id` is never sent.
- Errors map through `providerHttpError`: a plan usage limit classifies `quota` with a message naming
  ChatGPT Settings → Usage, `invalid_user` asks for a new sign-in, and nothing in the table is retried.
- Model catalog: static `gpt-6.1-sol` (500 000 context) and `gpt-6-luna` (272 000), plus `GET /models`
  discovery that keeps `visibility: "list"` entries and maps their windows, modalities, and reasoning
  levels. `maxOutputTokens` is left undeclared because the route enforces no ceiling.
- Wire recordings for the Responses route (`text`, `tool-loop`, `structured-output`, `image`, `cache`,
  and three error bodies), plus `runProviderLiveScenarios` on the new `responses` route.

## ./opencode-go

## [Unreleased]

### Changed

- Rebuilt `createOpenCodeGoProvider` on the shared routed builder (`createRoutedProvider`) with dual routes: `openai` (`/chat/completions`) and `anthropic` (`/messages`) (plan 183 Task 3).
- Enforced session correlation requirement (`require: { sessionId: true }`) failing closed with `ProviderRequirementError` before any fetch when `options.sessionId` is missing.
- Added session affinity routing via `x-opencode-session` header derived from sanitized `cacheKey ?? sessionId` (clamped to 128 characters).
- Added wire test recordings in `src/__tests__/wire/openai/` with full `providerConformance({ recordings })` coverage across both routes.
- Exported route definitions `OPENCODE_GO_CHAT_ROUTE`, `OPENCODE_GO_MESSAGES_ROUTE`, affinity helper `opencodeSession`, and `OPENCODE_SESSION_ID_MAX_LENGTH`.

### Removed

- Removed obsolete internal wire, cache, and thinking helper exports: `openAIChatBody`, `openAIChatEvents`, `serializeOpenCodeGoChatMessage`, `anthropicMessagesBody`, `anthropicMessagesEvents`, `applyOpencodeAnthropicCacheControl`, `opencodeAnthropicCacheEnabled`, `opencodeOwnedHeaders`, `opencodeSessionId`, `openCodeGoPreserveThinking`, `openCodeGoReasoning`, `openCodeGoReasoningEffort`, `openCodeGoThinking`, `stripOpenCodeGoOwnedCompat`.


- New provider package (plan 152 Task 4): `@arnilo/prism-ai/opencode-go` replaces the
  `@arnilo/prism-providers/opencode-go` subpath. The default export is a `definePackage` definition
  that registers the `opencode-go` provider, declares `capabilities: ["credentials"]`, and takes a
  ref-only config (`apiKey` defaults to `env:OPENCODE_GO_API_KEY`). The key resolves through the credentials slot on every request; a
  missing key records a `warn` status note, registers anyway, and fails a run with
  `credential_unavailable`. `models()` delegates to `listOpenCodeGoModels` and runs only when `agent.models.list()` is called. The raw factories, the wire helpers, and the catalog stay
  named exports.

## [0.1.0] - 2026-08-09

- Release-graph anchor: every first-party manifest carries `0.1.0` and `0.0.28` changelog sections.
  This package is introduced on the lockstep line by plan 152 Part B.

## [0.0.28] - 2026-08-08

- Release-graph anchor (see above); no published artifacts predate the 0.12 line.

## ./openrouter

## [Unreleased]

- Restore OpenRouter as a lockstep Prism provider: Chat Completions, per-request secret refs, discovery, routing and attribution, reasoning replay, explicit Anthropic cache markers and sticky affinity. Offline synthetic fixtures cover terminal errors, tools and cache usage; paid live cache tests default off.

## ./typesafe

## [Unreleased]

### Added

- New provider package (plan 152 Task 5): `@arnilo/prism-ai/typesafe` replaces the
  `@arnilo/prism-providers/typesafe` subpath. The default export is a `definePackage` definition that
  registers the `typesafe` provider, declares `capabilities: ["credentials"]`, and takes a ref-only config
  (`apiKey` defaults to `env:TYPESAFE_API_KEY`, plus `baseUrl`, `models`). The key resolves through the
  credentials slot on every request; a missing key records a `warn` status note, registers anyway, and fails
  a run with `credential_unavailable`. The raw factory, the wire helpers, the cache/thinking helpers, and the
  catalog stay named exports.

### Changed

- Rebuilt on `systemOneProviderPackage` from `@arnilo/prism/provider-kit` sharing single-shape decision-provider implementation with Laya.
- Added `TYPESAFE_DEFAULT_API_KEY_REF` to named exports.
- Plaintext remote endpoint warning now warns through System One in `provider-kit`, printing only the origin without userinfo.
- Implemented `systemOneConformance` coverage with offline wire recordings and symmetrical source equivalence check (`jev_and_laya_sources_match_with_vendor_masked`).

## [0.1.0] - 2026-08-09

- Release-graph anchor: every first-party manifest carries `0.1.0` and `0.0.28` changelog sections.
  This package is introduced on the lockstep line by plan 152 Part B.

## [0.0.28] - 2026-08-08

- Release-graph anchor (see above); no published artifacts predate the 0.12 line.
