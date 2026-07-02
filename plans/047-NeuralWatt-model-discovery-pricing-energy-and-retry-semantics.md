# Phase 46 — NeuralWatt model discovery, pricing, energy, and retry semantics

## Objectives
- Expose NeuralWatt model catalog, pricing, cache pricing, quota, energy/cost telemetry, and retry semantics in `@arnilo/prism-provider-neuralwatt` only.
- Keep Prism core contracts provider-agnostic; use existing `ModelConfig`, `ModelCost`, `Usage`, retry, provider event, and package export seams first.
- Preserve network-free default tests with mocked `fetch`/SSE fixtures.
- Update NeuralWatt, usage, cache, and navigation docs for every public helper or behavior change.

## Expected Outcome
- Curated NeuralWatt aliases include capabilities, limits, pricing, implicit-cache metadata, reasoning/tool/vision flags, and no guessed unknown fields.
- `listNeuralWattModels()` maps `/v1/models` metadata into Prism `ModelConfig`/`ModelCost` without making runtime generation depend on discovery.
- Energy/cost telemetry from non-streaming JSON and streaming `: energy` / `: cost` comments is preserved through the smallest existing seam or documented package-specific helper/metadata path.
- `getNeuralWattQuota()` is opt-in, authenticated, 1 rps documented, and never called during provider generation.
- NeuralWatt retry classification honors documented retryable status codes, `Retry-After`, and `retry_strategy`, while redacting error bodies.

## Tasks

- [x] Primitive review: inventory existing seams for models, pricing, telemetry, quota, and retry
  - Acceptance Criteria:
    - Functional: Identify whether `ModelConfig`, `ModelCost`, `Usage`, `ProviderEvent`, retry policy helpers, provider package exports, and package-local helpers already cover Phase 46; record any true generic gap before implementation.
    - Performance: Confirm planned helpers add zero calls to normal `generate()` except telemetry parsing already present in the stream; model/quota HTTP helpers are opt-in only.
    - Code Quality: Prefer existing package-local code in `packages/provider-neuralwatt`; reject core contract changes unless no existing seam can carry required data.
    - Security: Confirm API-key resolution and redaction stay package-local and no quota/model helper leaks credentials into events/docs/tests.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 46 — NeuralWatt model discovery, pricing, energy, and retry semantics.
      - `plans/046-NeuralWatt-first-party-provider-package.md` primitive findings and existing NeuralWatt implementation notes.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
      - `docs/providers/neuralwatt.md`, `docs/provider-caching.md`, `docs/runs-and-usage.md`, `docs/model-registry.md`, `docs/compaction-and-retry.md`.
      - NeuralWatt Models docs `https://portal.neuralwatt.com/docs/api/models`: `/v1/models`, `metadata.pricing`, `metadata.capabilities`, `metadata.limits`, aliases, BYOK caveat.
      - NeuralWatt Streaming docs `https://portal.neuralwatt.com/docs/guides/streaming`: `: energy` / `: cost` comments and non-streaming top-level fields.
      - NeuralWatt Error Handling and Rate Limits docs: retry status table, `Retry-After`, `retry_strategy`.
      - NeuralWatt Quota docs `https://portal.neuralwatt.com/docs/api/quota`: `/v1/quota` response and 1 rps limit.
    - Options Considered:
      - Add provider-specific fields to core `Usage`/`AgentEvent`: likely bloat; reject unless no existing telemetry seam exists.
      - Keep telemetry as package-specific exported parse/result metadata if core has no generic event: chosen if no Phase 35/42 seam exists in code.
      - Add model/quota discovery into provider setup automatically: rejected; hidden network and credentials.
    - Chosen Approach:
      - Inventory code first, then implement only package-local helpers and exports. Use core types (`ModelConfig`, `ModelCost`, `Usage`) where they already fit.
    - API Notes and Examples:
      ```ts
      import type { ModelConfig, ModelCost } from "@arnilo/prism";
      // Model catalog helpers should return ordinary Prism model configs.
      const models: readonly ModelConfig[] = neuralWattModels;
      ```
    - Files to Create/Edit:
      - `plans/047-NeuralWatt-model-discovery-pricing-energy-and-retry-semantics.md`: record inventory findings during execution.
      - Runtime/source files: none in this task unless inventory reveals a broken public seam that must be noted.
    - References:
      - `packages/provider-neuralwatt/src/{models,provider,sse}.ts`.
      - `src/contracts.ts` (`ModelConfig`, `ModelCost`, `Usage`, `ProviderEvent`, retry types).
      - `src/cache-helpers.ts`, `src/provider-events.ts`, `src/retry.ts` if present.
  - Inventory Findings:
    - **Model metadata/pricing seam:** `src/contracts.ts` already has `ModelConfig.displayName`, `capabilities`, `limits`, `cost`, `cache`, `compat`, and `metadata`; `ModelCost` already has `input`, `output`, `cacheRead`, `cacheWrite`, `currency`, and `unit`. This covers NeuralWatt `/v1/models` mapping for display name, tool/reasoning/vision/streaming flags, context/output limits, input/output/cache-read pricing, no cache-write price, aliases, deprecation/provider/Hugging Face details via `metadata`/`compat`. No core model/pricing contract change is needed.
    - **Usage seam:** `Usage` already carries token counts, `cacheReadTokens`, `cacheWriteTokens`, `cost`, and `currency`. NeuralWatt token usage and request cost can fit here when cost is known, but energy (`energy_joules`, `energy_kwh`, power/duration/attribution) has no field in `Usage`.
    - **Provider event seam:** `ProviderEvent` is limited to message/content/tool-call/usage/done/error. There is no generic provider telemetry/custom metadata event and `providerDone()` only carries `Usage`. Therefore streaming `: energy` / `: cost` comments cannot be faithfully exposed as first-class provider events without a core contract addition. For Phase 46, keep this package-local: parse comments with exported NeuralWatt telemetry helpers/types, and only attach cost to `Usage.cost`/`currency` where existing code can do so without losing semantics. Document energy as provider-specific telemetry.
    - **SSE package-local helper:** `packages/provider-neuralwatt/src/sse.ts` currently yields only `data:` payloads and silently discards comments. It tolerates NeuralWatt energy/cost comments but drops them. The minimal change is package-local: add a comment-aware reader/helper while preserving the existing data-only reader behavior where tests depend on it.
    - **Quota seam:** Core has no quota/account API, and none is needed. `/v1/quota` is account/provider-specific and should be an explicit package helper with injectable `fetch`, `CredentialValueSource`, `AbortSignal`, and provider-owned `authorization` header. It must not be called from `createNeuralWattProviderPackage()` or `generate()`.
    - **Credential/redaction seam:** `resolveCredentialValue()` is already used per request in `createNeuralWattProvider()`. `redactSecrets()` is cycle-safe/JSON-shape-preserving enough for response bodies and helper errors. Header ownership pattern already exists in `provider.ts`: caller headers first, then `content-type`, then `authorization`, so provider credentials win. Model/quota helpers should reuse this exact local pattern.
    - **Retry seam:** Core retry exists (`RetryPolicy`, `RetryContext`, `RetryDecision`, `RetryOptions`, `createDefaultRetryPolicy()`, `isTransientErrorInfo()`, `waitForRetry()`), and default transient codes include `429`, `500`, `502`, and `503`; `400/401/402/403/404` are not transient unless their message matches transient wording. This covers the basic NeuralWatt retryable/non-retryable status split if provider errors expose `ErrorInfo.code` as the HTTP status.
    - **Retry gap:** `ErrorInfo` has only `name`, `message`, `code`, and `cause`; `ProviderEvent.error` has no metadata. `RetryContext` receives only `ErrorInfo` plus host/run metadata. There is no clean generic path for a provider to pass structured `Retry-After` or NeuralWatt `retry_strategy` into the runtime retry policy. The smallest Phase 46 path is a package-local `classifyNeuralWattError()` that returns retryable/delay/strategy metadata for hosts and tests, while provider errors at least set safe status/code/message for the generic retry policy. A future generic error metadata seam is only needed if runtime retry must automatically honor provider-supplied delays.
    - **Provider package exports:** `packages/provider-neuralwatt/src/index.ts` already exports provider factory/body/events/usage and model helpers through the package root. New helpers (`listNeuralWattModels`, telemetry helpers, `getNeuralWattQuota`, retry classifier) can be exported there without aggregator/core changes.
    - **Normal generation performance:** Curated models are static import data. `listNeuralWattModels()` and `getNeuralWattQuota()` can be explicit one-call helpers only. Telemetry parsing adds a single pass over SSE lines already being read. Retry classification is O(1) over status/headers/body. No planned Phase 46 helper requires a normal `generate()` network call beyond the existing `/chat/completions` request.
    - **Primitive-gap conclusion:** No core changes are required for model discovery, curated pricing, quota, or basic retry classification. The only real generic gap is rich provider telemetry/retry metadata on provider events/errors; Phase 46 should avoid bloating core and implement/document NeuralWatt-specific helpers unless a later cross-provider need proves the generic seam worthwhile.
  - Verification:
    - Inspected `src/contracts.ts` for `ModelConfig`, `ModelCost`, `Usage`, `ProviderEvent`, `ErrorInfo`, and retry contracts.
    - Inspected `src/retry.ts` for default transient status handling and delay behavior.
    - Inspected `src/provider-events.ts` for available provider event factories and confirmed no telemetry/custom event factory exists.
    - Inspected `src/redaction.ts` for `redactSecrets()` and `errorToErrorInfo()` behavior.
    - Inspected `packages/provider-neuralwatt/src/{index,models,provider,sse}.ts` for current exports, static models, credential/header handling, usage mapping, and SSE comment dropping.
    - No runtime/source files changed; this was an inventory-only task.
  - Test Cases to Write:
    - Inventory-only task; no product test required. Later tasks own model, telemetry, quota, and retry tests.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; inventory only.
    - Docs pages to create/edit:
      - `none`: later tasks own public docs changes.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Expand curated NeuralWatt model metadata and pricing
  - Acceptance Criteria:
    - Functional: `neuralWattModels` includes featured aliases `glm-5.2`, `glm-5.2-fast`, `glm-5.2-short`, `glm-5.2-short-fast`, `kimi-k2.6`, `kimi-k2.6-fast`, `kimi-k2.7-code`, `qwen3.5-397b`, `qwen3.5-397b-fast`, `qwen3.6-35b`, and `qwen3.6-35b-fast` where docs provide enough data; each entry maps capabilities, limits, cache kind, and pricing only from documented fields.
    - Performance: Static model array is import-time data only; no discovery call, tokenization, or computation beyond object creation.
    - Code Quality: Use `defineNeuralWattModel()` for defaults; do not duplicate provider id/capability defaults in every entry beyond alias-specific overrides.
    - Security: Model metadata contains no credentials, account-specific limits, or private catalog data.
  - Approach:
    - Documentation Reviewed:
      - NeuralWatt Models docs: featured model table; `/v1/models` metadata fields; pricing `input_per_million`, `output_per_million`, `cached_input_per_million`, `cached_output_per_million`, `pricing_tbd`; capabilities and limits field descriptions.
      - `docs/model-registry.md`: `ModelConfig.cost` / `ModelCost` shape.
      - Existing `packages/provider-neuralwatt/src/models.ts`.
    - Options Considered:
      - Hard-code only names and context windows from featured table: minimal but misses pricing/capability value; use only where docs are complete.
      - Guess prices from public pricing page or ratios: rejected unless source data exists; no guessed unknown fields.
      - Store unknown prices as absent/TBD metadata: chosen for any alias whose docs do not provide numeric price.
    - Chosen Approach:
      - Expand curated aliases with documented context/vision/tool/reasoning/json flags and `cache: { kind: "implicit" }`. Map pricing to `ModelCost` only from `/v1/models` metadata fixtures or docs; represent cached input price as `cost.cacheRead`, leave `cacheWrite` undefined.
    - API Notes and Examples:
      ```ts
      defineNeuralWattModel({
        model: "qwen3.6-35b",
        limits: { contextWindow: 128_000 },
        capabilities: { input: ["text", "image"], output: ["text"], tools: true, reasoning: true, streaming: true },
        cache: { kind: "implicit" },
        compat: { json_mode: true, pricing_source: "/v1/models" },
      });
      ```
    - Files to Create/Edit:
      - `packages/provider-neuralwatt/src/models.ts`: curated aliases, pricing mapper constants/types if tiny.
      - `packages/provider-neuralwatt/src/__tests__/neuralwatt-models.test.ts` or existing NeuralWatt test file: metadata assertions.
      - `docs/providers/neuralwatt.md`: model catalog/pricing/cache-read section.
      - `docs/provider-caching.md`: NeuralWatt cache-read pricing note if not already specific enough.
      - `docs/model-registry.md`: only if `ModelCost` docs need NeuralWatt example clarification.
    - References:
      - NeuralWatt `/v1/models` response fields and featured aliases.
  - Implementation Notes:
    - Expanded `packages/provider-neuralwatt/src/models.ts` to include all featured NeuralWatt aliases from the docs, plus the existing legacy `kimi-k2` entry for compatibility.
    - Added small shared helpers/defaults (`implicitCache`, `reasoningCompat`, `fastCompat`, `jsonMode`, `featuredModel`) so provider id, cache kind, and common capability defaults are not duplicated across every alias.
    - Mapped documented contexts and capabilities: GLM long/short context variants, Kimi/Qwen vision variants, fast/no-reasoning variants, reasoning variants, streaming/tools defaults, and JSON-mode compat metadata where documented.
    - Left `ModelConfig.cost` unset in the static catalog because NeuralWatt docs define the `/v1/models` pricing fields and cache-read policy but do not publish fixed per-alias rates for every featured alias. Each static entry records `compat.pricing_source: "/v1/models"` instead of guessing.
    - Updated `docs/providers/neuralwatt.md`, `docs/provider-caching.md`, and `packages/provider-neuralwatt/README.md` to document the expanded static catalog and the no-guessed-pricing rule.
  - Verification:
    - `npm run build -w @arnilo/prism-provider-neuralwatt` passed.
    - `npm test -w @arnilo/prism-provider-neuralwatt` passed: 30 passing, 1 skipped live test, 0 failures.
  - Test Cases to Write:
    - `neuralwatt_models_include_featured_aliases`: all required aliases are present once with provider `neuralwatt`. Implemented in `packages/provider-neuralwatt/src/__tests__/neuralwatt.test.ts`.
    - `neuralwatt_models_map_capabilities_limits_and_cache`: vision/tool/reasoning/streaming/context metadata matches fixture docs. Covered by `neuralwatt_models_marked_implicit_cache_and_capabilities`.
    - `neuralwatt_models_do_not_guess_unknown_pricing`: TBD/null pricing leaves cost fields absent or marked via compat metadata, not fake zero. Implemented in `packages/provider-neuralwatt/src/__tests__/neuralwatt.test.ts`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — exported `neuralWattModels` contents and model metadata behavior.
    - Docs pages to create/edit:
      - `docs/providers/neuralwatt.md`: curated aliases, capabilities, pricing, cache pricing, BYOK caveat.
      - `docs/provider-caching.md`: cached-input pricing caveat for NeuralWatt implicit cache.
      - `docs/model-registry.md`: update only if examples need `cacheRead`/no `cacheWrite` wording.
    - `docs/index.md` update: no new page; existing NeuralWatt/provider-cache entries remain.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add optional `listNeuralWattModels()` discovery helper
  - Acceptance Criteria:
    - Functional: Helper calls `GET /v1/models`, supports optional auth, injectable `fetch`, custom `baseUrl`, abort signal, maps public/private returned models to `ModelConfig`/`ModelCost`, preserves aliases as separate entries, and never runs during package setup or generation.
    - Performance: One HTTP request per explicit call; response mapping is O(number of models); no retries or pagination unless NeuralWatt documents pagination.
    - Code Quality: Keep response parsing in `packages/provider-neuralwatt`; validate object shapes defensively enough to skip/throw useful errors for malformed entries.
    - Security: `authorization` header is provider-owned when a token exists; error bodies are redacted with the token; no private models are stored unless caller stores returned configs.
  - Approach:
    - Documentation Reviewed:
      - NeuralWatt Models docs: `GET https://api.neuralwatt.com/v1/models`, authenticated private models, response shape, aliases and virtual models.
      - Existing credential/header handling in `packages/provider-neuralwatt/src/provider.ts`.
    - Options Considered:
      - Make provider package setup call `/v1/models`: hidden network; rejected.
      - Return raw NeuralWatt responses only: forces callers to duplicate mapping; rejected.
      - Return `{ raw, models }`: useful but more API; start with `ModelConfig[]` and a small exported mapper only if tests need it.
    - Chosen Approach:
      - Implement a one-call helper plus `mapNeuralWattModel()` if needed for tests. Map `metadata.capabilities` to Prism capabilities, `metadata.limits` to `limits`, `metadata.pricing` to `cost`, `metadata.deprecated`/unknown raw values to `compat.neuralwatt` metadata.
    - API Notes and Examples:
      ```ts
      import { listNeuralWattModels } from "@arnilo/prism-provider-neuralwatt";

      const models = await listNeuralWattModels({ apiKey: process.env.NEURALWATT_API_KEY, fetch });
      // Host may register selected models; generation never calls discovery implicitly.
      ```
    - Files to Create/Edit:
      - `packages/provider-neuralwatt/src/models.ts`: `listNeuralWattModels()`, mapper, exported option/response types.
      - `packages/provider-neuralwatt/src/index.ts`: export helper/types.
      - `packages/provider-neuralwatt/src/__tests__/neuralwatt-models.test.ts`: mocked fetch tests.
      - `docs/providers/neuralwatt.md`: discovery helper API and examples.
      - `packages/provider-neuralwatt/README.md`: helper mention.
    - References:
      - NeuralWatt `/v1/models` docs; `resolveCredentialValue()` pattern from provider factory.
  - Implementation Notes:
    - Added `listNeuralWattModels()` in `packages/provider-neuralwatt/src/models.ts` as an explicit one-call `GET /v1/models` helper with injectable `fetch`, custom `baseUrl`, optional `apiKey`, `AbortSignal`, and non-owned caller headers.
    - Added `mapNeuralWattModel()` plus `NeuralWattModelEntry` / `ListNeuralWattModelsOptions` exports. Mapping preserves each returned id/alias as its own `ModelConfig`, maps display name, text/image input, tools/reasoning/streaming, context/output limits, implicit cache metadata, and exact `ModelCost` fields when `pricing_tbd` is false.
    - Kept discovery out of `createNeuralWattProviderPackage()` and `generate()`; tests confirm package setup does not call injected fetch.
    - Reused the package's provider-owned header pattern: caller headers are spread first and `authorization` is applied last. Error bodies are redacted with the resolved token before throwing.
    - Updated `packages/provider-neuralwatt/src/index.ts`, `docs/providers/neuralwatt.md`, `docs/provider-packages.md`, `docs/index.md`, and `packages/provider-neuralwatt/README.md` for the new helper.
  - Verification:
    - `npm run build -w @arnilo/prism-provider-neuralwatt` passed.
    - `npm test -w @arnilo/prism-provider-neuralwatt` passed: 36 passing, 1 skipped live test, 0 failures.
    - `npm run build:core && node --test dist/__tests__/docs.test.js` passed: 56 passing, 0 failures.
  - Test Cases to Write:
    - `list_neuralwatt_models_maps_metadata`: fixture response maps id/display/pricing/capabilities/limits/cache. Implemented.
    - `list_neuralwatt_models_auth_header_owned`: caller cannot override `authorization` with request headers. Implemented.
    - `list_neuralwatt_models_omits_auth_when_no_key`: unauthenticated public catalog request works. Implemented; also verifies custom base URL, abort signal forwarding, and one fetch call.
    - `list_neuralwatt_models_preserves_aliases_and_rejects_malformed_payloads`: aliases remain separate entries and malformed responses throw. Implemented.
    - `list_neuralwatt_models_redacts_token_in_errors`: failed response includes redacted body. Implemented.
    - `neuralwatt_provider_setup_does_not_call_model_discovery`: package setup remains network-free. Implemented.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new exported helper and types.
    - Docs pages to create/edit:
      - `docs/providers/neuralwatt.md`: `listNeuralWattModels()` inputs/output/examples/security notes.
      - `docs/provider-packages.md`: mention optional model discovery helper if first-party helper list exists.
    - `docs/index.md` update: no new page; ensure NeuralWatt entry description mentions model discovery if concise.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Preserve NeuralWatt energy and cost telemetry
  - Acceptance Criteria:
    - Functional: Streaming `: energy {...}` and `: cost {...}` comments are parsed and exposed through the smallest existing Prism-compatible seam; if no generic telemetry event exists, export package-specific helpers/types and attach metadata only where callers can observe it. Non-streaming top-level `energy`/`cost` fields are parsed by helpers/tests even if `generate()` stays streaming-only.
    - Performance: Comment parsing is a single pass in the existing SSE reader; no buffering of full completions beyond current chunk buffer.
    - Code Quality: Define typed `NeuralWattEnergyTelemetry` and `NeuralWattCostTelemetry` from documented fields; tolerate missing optional fields.
    - Security: Telemetry contains usage/cost numbers only; never include prompts, API keys, or raw headers in emitted metadata/events.
  - Approach:
    - Documentation Reviewed:
      - NeuralWatt Streaming docs: `: energy`/`: cost` comments, optional energy, cost availability, non-streaming top-level `energy` and `cost` fields.
      - `docs/runs-and-usage.md`: current usage/cost accounting surface.
      - `src/provider-events.ts` / `src/contracts.ts`: event metadata seams.
      - Existing `packages/provider-neuralwatt/src/sse.ts` currently ignores comments.
    - Options Considered:
      - Keep ignoring comments: fails roadmap acceptance; rejected.
      - Add NeuralWatt-specific `ProviderEvent` variant in core: overreach unless an existing generic telemetry event already exists.
      - Parse comments into package-specific event metadata/helper result while documenting it: chosen if no generic event exists.
    - Chosen Approach:
      - Extend `readSseData` or add `readNeuralWattSseEvents` to surface comment frames. Convert `energy`/`cost` JSON into typed telemetry. Emit via existing generic provider telemetry/custom metadata if present; otherwise export parser helpers and document package-specific observable path.
    - API Notes and Examples:
      ```ts
      export interface NeuralWattEnergyTelemetry {
        readonly energy_joules?: number;
        readonly energy_kwh?: number;
        readonly avg_power_watts?: number;
        readonly duration_seconds?: number;
      }
      ```
    - Files to Create/Edit:
      - `packages/provider-neuralwatt/src/sse.ts`: preserve/parse `: energy` and `: cost` comment frames.
      - `packages/provider-neuralwatt/src/provider.ts`: telemetry mapping/emission or helper integration.
      - `packages/provider-neuralwatt/src/telemetry.ts`: create only if types/helpers are too noisy for `provider.ts`.
      - `packages/provider-neuralwatt/src/index.ts`: export telemetry types/helpers if public.
      - `packages/provider-neuralwatt/src/__tests__/neuralwatt-telemetry.test.ts` or existing test file.
      - `docs/providers/neuralwatt.md`, `docs/runs-and-usage.md`: telemetry behavior.
    - References:
      - NeuralWatt streaming examples showing raw SSE comment parsing.
  - Test Cases to Write:
    - `neuralwatt_stream_parses_energy_and_cost_comments`: fixture stream exposes both telemetry objects without breaking text/usage/done event order. Implemented.
    - `neuralwatt_stream_tolerates_missing_energy`: cost-only stream still succeeds. Implemented.
    - `neuralwatt_non_streaming_telemetry_mapper`: top-level `energy`/`cost` fixture maps to exported types/helper. Implemented.
    - `neuralwatt_malformed_telemetry_comment_does_not_crash_generation`: malformed comment yields no secret leak and keeps provider stream behavior defensible. Implemented.
    - Existing `neuralwatt_ignores_energy_cost_comments` updated to assert the standard `neuralWattEvents()` stream still emits no telemetry/error events (telemetry is opt-in via `neuralWattEventsWithTelemetry()`).
  - Implementation Notes:
    - Created `packages/provider-neuralwatt/src/telemetry.ts` with `NeuralWattEnergyTelemetry`, `NeuralWattCostTelemetry`, `NeuralWattTelemetryEvent`, `NeuralWattEvent` types and `parseNeuralWattEnergy()`, `parseNeuralWattCost()`, `parseNeuralWattComment()`, `mapNeuralWattTelemetry()` helpers. All documented fields optional; malformed/empty payloads return `undefined`; emitted objects omit `undefined` fields.
    - Refactored `packages/provider-neuralwatt/src/sse.ts` into a single-pass `readNeuralWattSseFrames()` reader yielding `{ kind: "data" | "comment" }` frames; removed the now-dead `readSseData()`.
    - Refactored `packages/provider-neuralwatt/src/provider.ts` to share a `neuralWattFramesToEvents()` core loop. `neuralWattEvents()` (used by `generate()`) yields standard `ProviderEvent` and tolerates comments; new `neuralWattEventsWithTelemetry()` additionally yields `neuralwatt:telemetry` events in stream order.
    - Exported the new helpers/types from `packages/provider-neuralwatt/src/index.ts`.
    - Updated `docs/providers/neuralwatt.md` (telemetry exports, SSE-comment row, new Energy and cost telemetry section), `docs/runs-and-usage.md` (provider-specific telemetry note), and `packages/provider-neuralwatt/README.md`.
  - Verification:
    - `npm run build -w @arnilo/prism-provider-neuralwatt` passed.
    - `npm test -w @arnilo/prism-provider-neuralwatt` passed: 40 passing, 1 skipped live test, 0 failures (new telemetry suite: 4 tests).
    - `npm run build:core && node --test dist/__tests__/docs.test.js` passed: 56 passing, 0 failures.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — energy/cost telemetry is no longer silently dropped.
    - Docs pages to create/edit:
      - `docs/providers/neuralwatt.md`: telemetry fields, streaming comment behavior, non-streaming helper caveat.
      - `docs/runs-and-usage.md`: NeuralWatt provider-specific energy/cost note if exposed to run usage/telemetry.
    - `docs/index.md` update: no new page unless a new telemetry docs page is introduced; avoid new page unless needed.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add optional `getNeuralWattQuota()` helper
  - Acceptance Criteria:
    - Functional: Helper calls `GET /v1/quota` with required API key, injectable `fetch`, custom `baseUrl`, abort signal, returns typed quota data (`balance`, `usage`, `limits`, `subscription`, `key`) without being called during `generate()` or package setup.
    - Performance: One explicit HTTP request; docs and tests state NeuralWatt's 1 rps quota endpoint limit.
    - Code Quality: Keep helper small; no polling/cache manager; caller owns throttling.
    - Security: Provider-owned `authorization` header wins; token redacted from errors; no quota values enter provider events unless caller emits them.
  - Approach:
    - Documentation Reviewed:
      - NeuralWatt Quota docs: endpoint, response fields, 1 rps limit, 401/429 errors.
      - Existing provider credential/header/redaction code.
    - Options Considered:
      - Add quota polling into provider package setup: hidden network and rate-limit risk; rejected.
      - Implement a cached quota client: overbuilt; caller can cache.
      - Single helper function: chosen.
    - Chosen Approach:
      - Mirror model-list helper options and header ownership. Return the JSON shape with minimal validation plus exported TypeScript interfaces.
    - API Notes and Examples:
      ```ts
      import { getNeuralWattQuota } from "@arnilo/prism-provider-neuralwatt";

      const quota = await getNeuralWattQuota({ apiKey: "sk-test", fetch });
      console.log(quota.usage.current_month.energy_kwh);
      ```
    - Files to Create/Edit:
      - `packages/provider-neuralwatt/src/quota.ts`: helper and exported types.
      - `packages/provider-neuralwatt/src/index.ts`: export helper/types.
      - `packages/provider-neuralwatt/src/__tests__/neuralwatt-quota.test.ts`: mocked helper tests.
      - `docs/providers/neuralwatt.md`: quota helper docs and 1 rps warning.
      - `packages/provider-neuralwatt/README.md`: quota helper note.
    - References:
      - NeuralWatt `/v1/quota` docs.
  - Test Cases to Write:
    - `get_neuralwatt_quota_maps_response`: fixture maps balance/usage/limits/subscription/key fields. Implemented.
    - `get_neuralwatt_quota_requires_or_uses_api_key`: authenticated header is sent and owned. Implemented (also asserts no-fetch when no key).
    - `get_neuralwatt_quota_redacts_token_on_error`: failed response/token never leaks. Implemented.
    - `get_neuralwatt_quota_forwards_abort_signal`: abort signal is forwarded to fetch. Implemented.
    - `provider_generate_does_not_call_quota`: existing provider generation mock fetch URL remains `/chat/completions` only. Implemented.
  - Implementation Notes:
    - Created `packages/provider-neuralwatt/src/quota.ts` with `getNeuralWattQuota()` and typed `NeuralWattQuota` (`balance`, `usage.lifetime`/`usage.current_month`, `limits`, `subscription`, `key`), plus `GetNeuralWattQuotaOptions` and per-section interfaces. All fields optional; minimal structural validation.
    - Mirrors `listNeuralWattModels()` header ownership: caller headers spread first, provider-owned `authorization` applied last. Required API key throws before fetch when absent; errors redact the resolved token via `redactSecrets`.
    - One explicit `GET /v1/quota` call; no polling/caching; never called from `generate()` or package setup (verified by test). Docs/tests state the 1 rps-per-customer endpoint limit and that the caller owns throttling.
    - Exported helper/types from `packages/provider-neuralwatt/src/index.ts`.
    - Created `packages/provider-neuralwatt/src/__tests__/neuralwatt-quota.test.ts` (5 mocked tests).
    - Updated `docs/providers/neuralwatt.md` (quota export, options table, 1 rps warning, example, extension/security notes) and `packages/provider-neuralwatt/README.md`.
  - Verification:
    - `npm run build -w @arnilo/prism-provider-neuralwatt` passed.
    - `npm test -w @arnilo/prism-provider-neuralwatt` passed: 45 passing, 1 skipped live test, 0 failures (new quota suite: 5 tests).
    - `npm run build:core && node --test dist/__tests__/docs.test.js` passed: 56 passing, 0 failures.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new exported quota helper and types.
    - Docs pages to create/edit:
      - `docs/providers/neuralwatt.md`: `getNeuralWattQuota()` inputs/output/example/1 rps warning.
      - `docs/runs-and-usage.md`: optional account quota helper cross-reference if useful.
    - `docs/index.md` update: no new page; NeuralWatt entry can mention quota helper.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Implement NeuralWatt retry classification and tests
  - Acceptance Criteria:
    - Functional: NeuralWatt errors classify `400/401/402/403/404` as non-retryable; `429` retryable with `Retry-After`/`retry_strategy`; `500/502/503` retryable with backoff; redacted `ErrorInfo` preserves safe status/code/message/retry metadata.
    - Performance: Classification is O(1) over status/headers/body; no extra provider calls.
    - Code Quality: Reuse existing Prism retry policy/classifier types if present; otherwise export a package-local `classifyNeuralWattError()` and wire it through provider error metadata only where runtime retry can consume it.
    - Security: Error body redaction is cycle-safe enough for parsed JSON; API keys and bearer tokens never appear in `providerError`, retry events, or docs fixtures.
  - Approach:
    - Documentation Reviewed:
      - NeuralWatt Error Handling docs: status retry table and error format.
      - NeuralWatt Rate Limits docs: `429`, `503`, `Retry-After`, `retry_strategy` fields, cache-aware limiter.
      - `docs/compaction-and-retry.md`, `docs/provider-layer.md`, `docs/agent-events.md` retry event behavior.
      - Existing `createDefaultRetryPolicy` / retry utilities in `src` if present.
    - Options Considered:
      - Depend only on generic HTTP retry defaults: may miss `retry_strategy`/non-retryable payment/auth semantics; rejected.
      - Add NeuralWatt branches to core retry: provider-specific bloat; rejected.
      - Package-local classifier integrated with existing retry metadata/options: chosen.
    - Chosen Approach:
      - Parse failed response JSON safely, read `Retry-After`, `error.retry_after`, and `error.retry_strategy`. Produce safe `ErrorInfo`/metadata for runtime retry. Keep exact delay choice aligned with existing retry policy API; if policy only accepts retryable flag, document that `Retry-After` is surfaced but host policy owns delay.
    - API Notes and Examples:
      ```ts
      const decision = classifyNeuralWattError({ status: 429, headers, body });
      // { retryable: true, retryAfterMs: 1000, code: "concurrent_budget_exceeded" }
      ```
    - Files to Create/Edit:
      - `packages/provider-neuralwatt/src/retry.ts`: classifier/helpers if package-local.
      - `packages/provider-neuralwatt/src/provider.ts`: failed-response parsing and provider error metadata integration.
      - `packages/provider-neuralwatt/src/index.ts`: export classifier/types only if public.
      - `packages/provider-neuralwatt/src/__tests__/neuralwatt-retry.test.ts`: status/header/body matrix.
      - `docs/providers/neuralwatt.md`, `docs/compaction-and-retry.md` or `docs/provider-layer.md`: NeuralWatt retry behavior.
    - References:
      - NeuralWatt error body examples for `concurrent_budget_exceeded`, `tpm_uncached_exceeded`, `model_overloaded`, auth, model not found.
  - Test Cases to Write:
    - `neuralwatt_retry_classifier_non_retryable_client_statuses`: `400/401/402/403/404` false. Implemented.
    - `neuralwatt_retry_classifier_honors_retry_after_429`: header/body delay mapped and `retry_strategy` preserved safely. Implemented.
    - `neuralwatt_retry_classifier_retries_500_502_503`: retryable with default/backoff metadata. Implemented.
    - `neuralwatt_provider_error_redacts_retry_body`: token in response body/header is redacted from emitted error. Implemented.
    - `neuralwatt_retry_classifier_tolerates_malformed_json`: status-based fallback works. Implemented.
    - Added `neuralwatt_retry_classifier_reads_body_retry_after_when_header_absent`, `neuralwatt_http_error_sets_code_and_redacts`, and `neuralwatt_provider_error_on_500_is_retryable_code` for extra coverage.
  - Implementation Notes:
    - Created `packages/provider-neuralwatt/src/retry.ts` with `classifyNeuralWattError()` (returns `NeuralWattRetryDecision`: `status`, `retryable`, `code`, `retryAfterMs`, `errorCode`, `strategy`) and `neuralWattHttpError()` (builds a redacted `Error` with `code` set to the numeric HTTP status via `Object.defineProperty`). Typed `NeuralWattRetryStrategy`, `NeuralWattErrorInput` exported.
    - `400/401/402/403/404` → non-retryable; `429/500/502/503` → retryable; unknown statuses → non-retryable. `Retry-After` read from header or `error.retry_after`; `retry_strategy` stripped to safe documented fields. O(1) classification; no extra calls.
    - Wired `provider.ts` failed-response path to classify the response and emit `providerError(neuralWattHttpError(decision, bodyText, secrets), secrets)`. Added `safeJson()` helper. The emitted `ErrorInfo.code` = numeric HTTP status, so Prism's default retry policy (`transientCodes` includes 429/500/502/503) classifies retryability out of the box without provider-specific core branches.
    - Exported classifier/types from `packages/provider-neuralwatt/src/index.ts`.
    - Created `packages/provider-neuralwatt/src/__tests__/neuralwatt-retry.test.ts` (8 mocked tests).
    - Updated `docs/providers/neuralwatt.md` (classifier export, retry-classification section + status table + example, provider-stream error row), `docs/compaction-and-retry.md` (first-party `ErrorInfo.code` + NeuralWatt classifier cross-reference), and `packages/provider-neuralwatt/README.md`.
  - Verification:
    - `npm run build -w @arnilo/prism-provider-neuralwatt` passed.
    - Package tests: 53 passing, 1 skipped live test, 0 failures (new retry suite: 8 tests).
    - `npm run build:core && node --test dist/__tests__/docs.test.js` passed: 56 passing, 0 failures.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — provider retry/error behavior and possibly exported classifier.
    - Docs pages to create/edit:
      - `docs/providers/neuralwatt.md`: retry table and `Retry-After`/`retry_strategy` behavior.
      - `docs/compaction-and-retry.md` or `docs/provider-layer.md`: cross-reference provider-specific classifiers if exposed.
    - `docs/index.md` update: no new page; update link text only if retry classifier becomes documented under provider layer.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Documentation, package exports, and network-free verification
  - Acceptance Criteria:
    - Functional: All new helpers/types are exported from `@arnilo/prism-provider-neuralwatt`; docs and README examples compile conceptually and do not imply discovery/quota calls happen during generation.
    - Performance: Default test suite remains network-free; helper tests use mocked `fetch`; no live NeuralWatt calls unless existing live env flags are explicitly set.
    - Code Quality: Package build/typecheck/test pass; docs follow Prism API page structure; no duplicate source of truth for model/pricing constants beyond curated data + fixture mapper tests.
    - Security: Docs fixtures use fake keys only; secret redaction tests cover helper/provider errors; no real-looking tokens committed.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` API page structure.
      - `docs/providers/neuralwatt.md`, `docs/provider-packages.md`, `docs/provider-caching.md`, `docs/runs-and-usage.md`, `docs/index.md`.
      - `packages/provider-neuralwatt/package.json` exports and README.
    - Options Considered:
      - Put all details only in README: insufficient for Prism docs governance; rejected.
      - Add a new `docs/neuralwatt-telemetry.md`: likely one provider page is enough; add only if provider page gets unwieldy.
      - Keep docs changes scoped to existing pages: chosen.
    - Chosen Approach:
      - Update provider page sections for model discovery, quota, telemetry, pricing/cache caveats, and retry. Update index/link descriptions only if navigation text is stale. Run build/typecheck/tests for package and docs tests.
    - API Notes and Examples:
      ```bash
      npm run build -w @arnilo/prism-provider-neuralwatt
      npm run typecheck -w @arnilo/prism-provider-neuralwatt
      npm test -w @arnilo/prism-provider-neuralwatt
      ```
    - Files to Create/Edit:
      - `packages/provider-neuralwatt/src/index.ts`: final exports.
      - `packages/provider-neuralwatt/README.md`: helpers and caveats.
      - `docs/providers/neuralwatt.md`: main API page updates.
      - `docs/provider-packages.md`: first-party package capability/helper note.
      - `docs/provider-caching.md`: implicit cache + cached-input pricing update.
      - `docs/runs-and-usage.md`: energy/cost/quota cross-reference.
      - `docs/index.md`: update NeuralWatt/provider package entry text if needed.
      - `plans/047-NeuralWatt-model-discovery-pricing-energy-and-retry-semantics.md`: mark completed tasks and record compromises/follow-ups after verification.
    - References:
      - All Phase 46 task docs and test outputs.
  - Test Cases to Write:
    - `npm run build -w @arnilo/prism-provider-neuralwatt`: package compiles. Passed.
    - `npm run typecheck -w @arnilo/prism-provider-neuralwatt`: no TS errors. Passed.
    - `npm test -w @arnilo/prism-provider-neuralwatt`: network-free package tests pass. Passed (53 passing, 1 skipped live test, 0 failures; all helper tests use mocked `fetch`).
    - Docs structural test from root if present: NeuralWatt page keeps required headings and index links. Passed (`npm run build:core && node --test dist/__tests__/docs.test.js`: 56 passing, 0 failures).
  - Implementation Notes:
    - Final exports audited in `packages/provider-neuralwatt/src/index.ts`: `createNeuralWattProviderPackage`, `createNeuralWattProvider`, `defineNeuralWattModel`, `listNeuralWattModels`, `mapNeuralWattModel`, `neuralWattModels`, `getNeuralWattQuota`, `classifyNeuralWattError`, `neuralWattHttpError`, `neuralWattEventsWithTelemetry`, `mapNeuralWattTelemetry`, `parseNeuralWattComment`/`parseNeuralWattEnergy`/`parseNeuralWattCost`, and associated types. Confirmed present in `dist/index.d.ts` and at runtime.
    - `docs/providers/neuralwatt.md`: full API page with exports block, model discovery, quota, telemetry, retry-classification section + status table, pricing/cache caveats; examples do not imply discovery/quota run during generation (explicit statements to the contrary).
    - `docs/provider-packages.md`: NeuralWatt capability note expanded to list discovery, quota, telemetry, and retry helpers with the no-setup/generation-call guarantee.
    - `docs/provider-caching.md`: implicit cache + cached-input pricing caveat already present.
    - `docs/runs-and-usage.md`: package-owned telemetry cross-reference extended with `getNeuralWattQuota()` and the 1 rps caller-owned throttling note.
    - `docs/index.md`: Phase 12 NeuralWatt entry text updated to mention model discovery, quota, telemetry, and retry classification helpers.
    - `packages/provider-neuralwatt/README.md`: lists all helpers and caveats.
    - Plan document: all six tasks marked `[x]`; Compromises Made and Further Actions sections filled.
    - Security: all test/docs fixtures use fake keys (`fake-neuralwatt-key`, `secret-neuralwatt-token`); no real-looking tokens (`sk-…`) committed; redaction tests cover discovery, quota, and retry helpers plus provider error emission.
    - No duplicate source of truth: `neuralWattModels` static catalog is the single curated source; `listNeuralWattModels()` maps the live `/v1/models` response; prices are not duplicated or guessed.
  - Verification:
    - `npm run build -w @arnilo/prism-provider-neuralwatt`: passed.
    - `npm run typecheck -w @arnilo/prism-provider-neuralwatt`: passed.
    - `npm test -w @arnilo/prism-provider-neuralwatt`: 53 passing, 1 skipped, 0 failures.
    - `npm run build:core && node --test dist/__tests__/docs.test.js`: 56 passing, 0 failures.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — final docs/exports for model discovery, quota, telemetry, pricing, and retry.
    - Docs pages to create/edit:
      - `docs/providers/neuralwatt.md`: full helper/API behavior.
      - `docs/provider-packages.md`: package capability summary.
      - `docs/provider-caching.md`: cached-input pricing and implicit cache caveats.
      - `docs/runs-and-usage.md`: energy/cost/quota behavior.
      - `docs/index.md`: update existing provider navigation entry if needed.
    - `docs/index.md` update: yes if NeuralWatt link text does not mention model discovery/telemetry/quota after docs updates.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- **No core contract changes for telemetry/retry metadata.** `ProviderEvent` is a closed union with no generic telemetry slot and `ErrorInfo` has no metadata field for `Retry-After`/`retry_strategy`. Phase 46 exposes NeuralWatt energy/cost via a package-specific `neuralWattEventsWithTelemetry()` generator and `NeuralWattTelemetryEvent` type (separate from the `neuralWattEvents()` stream used by `generate()`), and retry metadata via an exported `classifyNeuralWattError()` returning `NeuralWattRetryDecision`. This keeps provider-specific shapes out of core but means hosts must opt into the package-local helpers to read telemetry/structured retry metadata; the standard stream and `ErrorInfo` carry only status/code/message. The provider still emits `ErrorInfo.code` = numeric HTTP status so the default retry policy classifies retryability without core changes.
- **Static catalog does not guess pricing.** `neuralWattModels` ships curated capabilities/limits/cache metadata for featured aliases but intentionally leaves `ModelConfig.cost` undefined with `compat.pricing_source = "/v1/models"`. Exact per-alias input/output/cache-read prices are only authoritative from the live `/v1/models` response, mapped by `listNeuralWattModels()`. Hosts needing prices call discovery explicitly.
- **Quota throttling is caller-owned.** `getNeuralWattQuota()` makes a single `GET /v1/quota` call and does not implement polling, caching, or rate limiting. NeuralWatt limits the endpoint to 1 request/second/customer; docs and tests state this but the helper does not enforce it.
- **Retry delay is host-owned.** `classifyNeuralWattError()` surfaces `retryAfterMs` and `strategy` but does not choose the delay; the Prism `RetryPolicy` owns the exact backoff. The default policy uses exponential backoff and does not honor `Retry-After` directly; hosts that want NeuralWatt's suggested delays must register a custom `RetryPolicy`.

## Further Actions
- **Optional: generic provider telemetry/retry metadata in core.** If multiple providers need rich telemetry or structured retry metadata, consider a minimal opt-in `ProviderEvent` variant (e.g. `provider:telemetry` with an opaque payload) and an `ErrorInfo.metadata`/`retry` field. Low priority — only justify if a second provider needs it; defer until then to avoid speculative core surface.
- **Optional: custom `RetryPolicy` honoring NeuralWatt `Retry-After`.** A small package-local `createNeuralWattRetryPolicy()` could consume `retryAfterMs`/`strategy` from `classifyNeuralWattError()`. Low priority — the default policy already retries the right status codes; only needed if hosts want NeuralWatt-suggested delays.
- **Populate `ModelConfig.cost` from live discovery.** Hosts can call `listNeuralWattModels()` and register the returned configs (with `cost`) instead of the static catalog. No action needed unless a host wants auto-priced catalogs; document the pattern if requested.
- **Live integration test.** The skipped live test remains a placeholder gated on `NEURALWATT_API_KEY`. Filling it in is out of scope for Phase 46 and should wait until real credentials are available; keep network-free default tests authoritative.
