# Phase 12 — Real Provider Packages

## Objectives
- Ship the requested first-party provider connections as separate `@prism/provider-*` packages, not Prism core behavior.
- Reuse Phase 11 provider package, auth, request/cache policy, model metadata, system prompt, and conformance primitives.
- Adapt Pi's proven provider request shapes, OAuth flow, cache policies, model metadata, stream parsing, usage mapping, and redaction behavior with mocked tests only by default.
- Keep provider secrets at the adapter edge and out of events, summaries, docs fixtures, and session entries.

## Expected Outcome
- `@prism/provider-openai`, `@prism/provider-opencode-go`, `@prism/provider-openrouter`, `@prism/provider-zai`, and `@prism/provider-kimi` can be built, tested, packed, and registered without modifying Prism core provider behavior.
- Each package exposes a `create*ProviderPackage()` setup helper, direct provider factory where useful, model metadata helpers, auth descriptors, cache/request policy behavior, package README, and `/docs` page.
- Provider conformance tests pass with mocked `fetch`, mocked streams, and mocked OAuth callbacks; live integration tests are opt-in behind explicit env vars and skipped by default.
- OpenRouter cache/routing behavior remains app/model controlled, Kimi Moonshot API-key models remain optional package metadata, and no OpenAI/OpenRouter/ZAI/Kimi/OpenCode globals are added to core.

## Tasks

- [x] Review primitives and lock the minimal Phase 12 package shape
  - Acceptance Criteria:
    - Functional: Existing Prism provider-package, auth, OAuth, request/cache policy, model metadata, provider conformance, OpenAI-compatible adapter, redaction, and docs primitives are inventoried; any required core changes are limited to generic reusable gaps discovered before provider package implementation.
    - Performance: Review adds no provider calls, filesystem discovery, package auto-loading, worker, watcher, tokenizer, new dependency, or network test to the runtime path.
    - Code Quality: Provider-specific literals stay in provider packages/tests/docs only; core keeps no OpenAI/OpenRouter/ZAI/Kimi/OpenCode branching except existing generic adapter documentation/tests.
    - Security: The review explicitly rejects credential persistence, process env scanning, shell command auth resolution, docs with real secrets, and session/event serialization of resolved credentials.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 12 and non-negotiable boundaries.
      - `plans/014-provider-auth-cache-and-system-prompt-primitives.md` Phase 11 closeout and follow-ups.
      - `docs/provider-packages.md`, `docs/provider-layer.md`, `docs/credentials-and-redaction.md`, `docs/provider-conformance.md`, `docs/system-prompts.md`, `docs/index.md`.
      - `src/contracts.ts`, `src/provider-packages.ts`, `src/provider-request-policy.ts`, `src/credentials.ts`, `src/testing/provider-conformance.ts`, `src/providers/openai-compatible.ts`.
      - Pi docs: `/home/arn/.nvm/versions/node/v24.16.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/providers.md`, `docs/custom-provider.md`, `docs/models.md`, `docs/sdk.md`.
      - Pi source references: `@earendil-works/pi-ai/dist/types.d.ts`, `providers/openai-responses.js`, `providers/openai-codex-responses.js`, `providers/openai-completions.js`, `providers/anthropic.js`, `providers/openai-prompt-cache.js`, `utils/oauth/openai-codex.js`, `env-api-keys.js`, and `models.generated.js` entries for `openai-codex`, `opencode-go`, `openrouter`, `zai`, `kimi-coding`, and `moonshotai`.
      - OpenAI API docs via Context7: `npx ctx7@latest docs /websites/developers_openai_api "Responses API streaming tools prompt_cache_key prompt_cache_retention service_tier"`.
      - OpenRouter Markdown docs: `https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request.md`, `https://openrouter.ai/docs/guides/routing/provider-selection.md`, `https://openrouter.ai/docs/guides/best-practices/prompt-caching.md`, `https://openrouter.ai/docs/guides/best-practices/reasoning-tokens.md`.
      - Z.AI docs: `https://docs.z.ai/api-reference/llm/chat-completion.md`, `https://docs.z.ai/guides/capabilities/thinking.md`, `https://docs.z.ai/guides/capabilities/thinking-mode.md`, `https://docs.z.ai/guides/llm/glm-4.7.md`, `https://docs.z.ai/guides/llm/glm-4.5.md`.
      - Kimi docs: `https://platform.kimi.ai/docs/api/chat.md`, `https://platform.kimi.ai/docs/guide/kimi-k2-7-code-quickstart.md`, `https://platform.kimi.ai/docs/guide/migrating-from-openai-to-kimi.md`.
      - OpenCode public docs inspected: `https://opencode.ai/docs` and `https://opencode.ai/zen`; provider API details are taken from Pi model/source references because public Zen API details are not documented there.
      - npm workspaces docs: `https://docs.npmjs.com/cli/v11/using-npm/workspaces`.
      - `.agents/skills/create-plan/references/prism-wiki.md` documentation requirements.
      - Project pattern/wiki directories: none present under `.agents/skills/project-patterns/` or `.agents/skills/project-wiki/`.
    - Inventory Result:
      - Existing primitives to reuse:
        - `defineProviderPackage()`, `ProviderPackageAPI`, `ExtensionAPI.registerProviderPackage()`, and contribution registries already cover explicit package setup; Phase 12 needs workspaces/packages, not core loading or discovery.
        - `ModelConfig` already has `capabilities`, `limits`, `cost`, opaque `compat`, and `metadata`; provider catalogs and quirks can stay in package-local model files.
        - `AuthMethod`, `OAuthProvider`, `OAuthLoginCallbacks`, `OAuthCredentials`, `createExplicitCredentialResolver()`, `createEnvCredentialResolver()`, `resolveCredentialValue()`, and `refreshOAuthCredential()` cover API-key and caller-owned OAuth flows without core credential persistence.
        - `ProviderRequest.options`, `createProviderRequestPolicyChain()`, `createSessionCachePolicy()`, and `mergeProviderRequestOptions()` cover generic session/cache/header/compat options; vendor payload mapping belongs in provider packages.
        - `redactSecrets()`, `providerError()`, `redactProviderRequest()`, `redactAgentEvent()`, and `redactSessionEntry()` are enough boundaries when packages pass exact resolved secrets at the provider edge.
        - `prism/testing/provider-conformance` already covers stream terminal order, abort, tool-call delta reconstruction, and cache usage accounting for mocked provider package tests.
        - `prism/providers/openai-compatible` is an optional generic Chat Completions adapter/reference only; it is not a Phase 12 provider package and does not justify core provider-specific branching.
      - Minimal Phase 12 package shape locked:
        - One npm workspace per package under `packages/provider-*`, each with `package.json`, `tsconfig.json`, `README.md`, `src/index.ts`, package-local implementation files, mocked `node:test` tests, and env-gated skipped live tests.
        - Public API per package: `create*ProviderPackage(options)`, direct provider factory where useful, model metadata exports/helpers, auth descriptor registration, and no side effects on import.
        - Dependencies: `prism` as peer dependency, TypeScript/test dev wiring only unless a later provider task records a measured reason; use native `fetch`, Web Streams/SSE parsing, and Node stdlib OAuth helpers.
        - Defaults: no catalog fetch, package discovery, env/process scanning, keychain/auth-file persistence, shell auth commands, OAuth login, or live network call during setup/tests.
      - Confirmed generic gaps: none for starting package implementation. OAuth callback metadata/cancellation and conformance stream helpers can remain package-local or be proposed later only if a concrete provider test cannot be expressed with current contracts.
      - Security boundary locked: provider packages resolve credentials per request, pass exact secret values into redaction helpers, and never serialize resolved credentials into model metadata, docs, events, session entries, summaries, or fixtures.
    - Options Considered:
      - Add requested providers to Prism core: rejected; roadmap requires separate packages and no hidden provider globals.
      - Add a broad provider SDK abstraction package first: rejected unless the primitive review proves repeated code is larger than the packages themselves.
      - Use OpenAI/Anthropic SDK dependencies: rejected for the initial plan; native `fetch`, SSE parsing, WebSocket only where explicitly needed, and Node stdlib OAuth keep packages small.
      - Add only generic OAuth callback additions if Phase 11 callbacks are insufficient for PKCE/device-code cancellation and UI metadata: allowed, but only after this review records the exact gap.
      - Implement provider package factories plus package-local transport helpers: chosen as the default.
    - Chosen Approach:
      - Lock a simple public API per package: `create*ProviderPackage(options)`, optional direct `create*Provider(options)`, model metadata exports/helpers, and package README.
      - Keep package setup explicit; no package discovery, config file loading, env scanning, keychain storage, or live network test in core or package defaults.
      - If core changes are unavoidable, make them generic (`OAuthLoginCallbacks` optional metadata/signal or provider-conformance helper gaps), document them, and add boundary tests that provider names still do not drive core runtime behavior.
    - API Notes and Examples:
      ```ts
      import { defineProviderPackage } from "prism";

      export const providerPackage = defineProviderPackage({
        name: "@prism/provider-demo",
        setup(api) {
          api.registerProvider(provider);
          api.registerModel({ provider: "demo", model: "demo-model", compat: { api: "openai-completions" } });
          api.registerAuthMethod({ provider: "demo", kind: "api_key", credentialName: "apiKey" });
        },
      });
      ```
    - Files Edited:
      - `plans/015-real-provider-packages.md`: recorded primitive inventory, locked minimal package shape, and completion status.
      - `src/__tests__/phase12-primitives.test.ts`: added a provider-specific core runtime boundary guard.
    - Files Planned for Later Tasks:
      - `package.json`, `package-lock.json`, `tsconfig.packages.json`, `packages/provider-*`, `docs/provider-packages.md`, `docs/providers/*.md`, and `docs/index.md` as listed in implementation tasks.
      - `src/contracts.ts`, `src/testing/provider-conformance.ts`, and core docs: no changes needed now; revisit only if a later package task proves a generic, provider-agnostic gap.
    - References:
      - `roadmap.md` Phase 12 acceptance.
      - `plans/014-provider-auth-cache-and-system-prompt-primitives.md` locked primitive surface.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases Written:
    - `phase12_core_has_no_requested_provider_runtime_branching`: scans core runtime source for requested-provider behavior outside the existing generic OpenAI-compatible adapter/tests/docs.
    - `oauth_callbacks_cover_browser_and_device_code_without_provider_specific_core`: not written; no generic OAuth callback fields changed.
    - `provider_conformance_helpers_cover_phase12_stream_expectations`: not written; no conformance helper changes were needed.
  - Checks Run:
    - `npm run typecheck`
    - `command npm test`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No; review confirmed existing primitives are enough to start Phase 12 packages.
    - Docs pages to create/edit:
      - `none`: no generic OAuth, conformance, package contract, or exported-contract changes were made.
    - `docs/index.md` update: No.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add the provider package workspace skeleton
  - Acceptance Criteria:
    - Functional: Root scripts can build, typecheck, test, and pack the core plus five provider workspaces; each provider package has package metadata, TypeScript config, empty public barrel, README stub, and a skipped/live-test convention.
    - Performance: Default `npm test` remains network-free and avoids live provider calls; workspace build/test overhead is bounded to TypeScript and `node:test` only.
    - Code Quality: Packages declare `prism` as a peer dependency, keep provider code out of core, and use the same ESM/NodeNext/strict TypeScript style as the root package.
    - Security: Package skeletons include no real credentials, no env auto-read, no postinstall scripts, and no executable resource discovery.
  - Approach:
    - Documentation Reviewed:
      - npm workspaces docs: `https://docs.npmjs.com/cli/v11/using-npm/workspaces`.
      - Root `package.json`, `package-lock.json`, and `tsconfig.json`.
      - Existing test style under `src/__tests__` and `package.json` scripts.
      - `docs/provider-packages.md` package registration examples.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Keep providers as root subpath exports: rejected; roadmap names separate `@prism/provider-*` packages.
      - Create one package per provider under `packages/`: chosen.
      - Add a shared published utility package immediately: rejected for skeleton; extract only if provider implementation proves duplication is worse.
    - Chosen Approach:
      - Add npm workspaces for `packages/provider-*` and package-local `build`, `typecheck`, `test`, and `pack:dry-run` scripts.
      - Keep packages dependency-light: peer-depend on `prism`; no provider SDK dependency unless a later task updates this plan with a measured reason.
      - Add a tiny live-test helper convention (`PRISM_LIVE_PROVIDER_TESTS=1` plus provider-specific env vars) but keep live tests skipped by default.
    - API Notes and Examples:
      ```bash
      npm run build
      npm run typecheck
      command npm test
      npm run pack:dry-run --workspaces --if-present
      ```
    - Files Edited:
      - `package.json`: added npm workspaces, core/workspace build/typecheck/test scripts, and workspace dry-run packing.
      - `package-lock.json`: added provider workspace lock metadata.
      - `tsconfig.packages.json`: added shared strict NodeNext package compiler defaults resolving `prism` types from built core declarations.
      - `packages/provider-openai/package.json`, `tsconfig.json`, `README.md`, `src/index.ts`, `src/__tests__/index.test.ts`, `src/__tests__/live.test.ts`.
      - `packages/provider-opencode-go/package.json`, `tsconfig.json`, `README.md`, `src/index.ts`, `src/__tests__/index.test.ts`, `src/__tests__/live.test.ts`.
      - `packages/provider-openrouter/package.json`, `tsconfig.json`, `README.md`, `src/index.ts`, `src/__tests__/index.test.ts`, `src/__tests__/live.test.ts`.
      - `packages/provider-zai/package.json`, `tsconfig.json`, `README.md`, `src/index.ts`, `src/__tests__/index.test.ts`, `src/__tests__/live.test.ts`.
      - `packages/provider-kimi/package.json`, `tsconfig.json`, `README.md`, `src/index.ts`, `src/__tests__/index.test.ts`, `src/__tests__/live.test.ts`.
      - `docs/provider-packages.md`: documented first-party provider package skeletons and default no-network/no-credential-discovery behavior.
      - `docs/index.md`: added first-party provider workspace names under Provider and model connection.
    - References:
      - `roadmap.md` suggested plan `015-real-provider-packages.md`.
      - Existing root package ESM/NodeNext scripts.
  - Test Cases Written:
    - `workspace_packages_export_provider_package_factories`: each package public barrel statically exports its planned factory name.
    - `workspace_tests_are_network_free_by_default`: each package has a live-test placeholder skipped unless `PRISM_LIVE_PROVIDER_TESTS=1`.
    - `provider_packages_do_not_add_runtime_dependencies`: each package metadata has no runtime dependencies or postinstall script and keeps `prism` as an optional peer dependency for workspace install safety.
  - Checks Run:
    - `npm install --package-lock-only`
    - `npm run typecheck`
    - `command npm test`
    - `npm run pack:dry-run`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; creates publishable package names and public package entry points.
    - Docs pages to create/edit:
      - `docs/provider-packages.md`: first-party provider package shape and registration pattern.
      - `docs/index.md`: Provider and model connection group entry for first-party provider packages.
    - `docs/index.md` update: Yes; add provider package navigation entries or placeholders.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Implement `@prism/provider-openai`
  - Acceptance Criteria:
    - Functional: Package registers an OpenAI API-key Responses provider and model metadata, plus a ChatGPT Plus/Pro/Codex subscription provider using Pi-style PKCE browser and device-code OAuth callbacks; both providers emit normalized Prism events for text, thinking, tool-call deltas/finals, usage, and done/error.
    - Performance: Streaming parses incrementally with native `fetch`/SSE and does not buffer full responses beyond current tool-call/reasoning fragments; OAuth helpers run only when explicitly called.
    - Code Quality: Responses and Codex request builders are package-local, tested, typed, and based on Prism `ProviderRequest.options`; no OpenAI-specific behavior is added to core.
    - Security: API keys/access tokens are resolved per request, refresh tokens remain caller-owned, OAuth errors redact token values, and docs/tests use fake placeholders only.
  - Approach:
    - Documentation Reviewed:
      - OpenAI API docs via Context7 for Responses streaming/tools/service tiers/prompt cache fields.
      - Pi `providers/openai-responses.js`: `responses.create`, `input`, `tools`, `prompt_cache_key`, `prompt_cache_retention`, service tier pricing, `session_id`/`x-client-request-id` headers, and Responses event mapping.
      - Pi `providers/openai-codex-responses.js`: Codex `instructions`, `input`, `include: ["reasoning.encrypted_content"]`, `prompt_cache_key`, `store: false`, SSE/WebSocket fallback, Codex headers, usage mapping, and request ids.
      - Pi `utils/oauth/openai-codex.js`: browser PKCE flow, local callback, device-code flow, token refresh, account id extraction, and OAuth provider object.
      - Pi `providers/openai-prompt-cache.js`: 64-character prompt cache key clamp.
      - `docs/credentials-and-redaction.md`, `docs/provider-conformance.md`, `docs/provider-packages.md`.
    - Options Considered:
      - Use OpenAI SDK: rejected initially; native `fetch` avoids a dependency and matches existing Prism adapter style.
      - Implement Codex WebSocket transport now: defer unless needed; SSE covers required network-free mocked conformance and keeps package small. Add WebSocket only if live tests prove SSE is insufficient.
      - Put Codex OAuth in core auth utilities: rejected; provider-specific OAuth endpoints belong in this package.
    - Chosen Approach:
      - Export `createOpenAIProviderPackage(options)`, `createOpenAIResponsesProvider(options)`, `createOpenAICodexProvider(options)`, `openAIModels`, `openAICodexModels`, and `openAICodexOAuthProvider`.
      - Map `ProviderRequest.options.sessionId/cacheRetention/cacheKey` to OpenAI/Codex cache payloads and headers; map `Usage.cacheReadTokens` from cached tokens.
      - Mock OAuth `fetch`, callback selection, device-code polling, token refresh, and streaming SSE in tests.
    - API Notes and Examples:
      ```ts
      import { createOpenAIProviderPackage } from "@prism/provider-openai";
      import { createEnvCredentialResolver } from "prism";

      const openai = createOpenAIProviderPackage({
        apiKey: createEnvCredentialResolver({ OPENAI_API_KEY: "fake" }, { openai: "OPENAI_API_KEY" }),
      });
      await openai.setup(api);
      ```
    - Files Edited:
      - `packages/provider-openai/src/index.ts`: public exports, package factory, provider/model/auth registration.
      - `packages/provider-openai/src/models.ts`: OpenAI and Codex model metadata.
      - `packages/provider-openai/src/responses.ts`: OpenAI Responses provider, request mapping, stream event mapping, usage mapping, and redaction boundary.
      - `packages/provider-openai/src/codex.ts`: Codex Responses provider wrapper using caller-supplied access tokens.
      - `packages/provider-openai/src/oauth.ts`: package-local PKCE/device-code OAuth provider and refresh helper.
      - `packages/provider-openai/src/sse.ts`: minimal package-local SSE parser.
      - `packages/provider-openai/src/cache.ts`: prompt cache key clamp and retention mapping.
      - `packages/provider-openai/src/__tests__/openai.test.ts`: mocked Responses/provider package tests.
      - `packages/provider-openai/src/__tests__/codex-oauth.test.ts`: mocked OAuth tests.
      - `packages/provider-openai/src/__tests__/live.test.ts`: kept env-gated skipped live test.
      - `packages/provider-openai/README.md`: package usage and security notes.
      - `docs/providers/openai.md`: API page and examples.
      - `docs/provider-packages.md`, `docs/index.md`: linked package docs.
      - `tsconfig.packages.json`: added the provider-conformance testing subpath for workspace package tests.
    - References:
      - `roadmap.md` Phase 12 OpenAI deliverables.
      - Pi OpenAI/Codex provider and OAuth source listed above.
  - Test Cases Written:
    - `openai_responses_stream_maps_text_thinking_tool_usage_and_done`: mocked SSE to Prism events.
    - `openai_responses_applies_prompt_cache_policy_and_session_headers`: payload/header assertion.
    - `openai_responses_aborts_fetch`: abort signal propagation.
    - `openai_codex_oauth_browser_and_device_code_are_mocked`: no live auth; callbacks receive URLs/codes.
    - `openai_codex_refresh_redacts_tokens_from_errors`: fake token redaction.
    - `openai_package_passes_provider_conformance_without_network`: uses `prism/testing/provider-conformance` with mocked fetch.
  - Checks Run:
    - `npm run typecheck`
    - `command npm test`
    - `npm run pack:dry-run`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds `@prism/provider-openai` package APIs, model metadata, auth methods, OAuth behavior, and provider request/cache behavior.
    - Docs pages to create/edit:
      - `docs/providers/openai.md`: package API, API-key setup, Codex OAuth login, model selection, cache control, redaction, mocked/live test notes.
      - `docs/provider-packages.md`: link first-party OpenAI package.
    - `docs/index.md` update: Yes; add Provider and model connection entry for OpenAI provider package.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Implement `@prism/provider-opencode-go`
  - Acceptance Criteria:
    - Functional: Package registers OpenCode Go API-key auth, Pi-derived model metadata, and a provider that dispatches OpenAI-compatible or Anthropic-compatible routes per model metadata while applying `x-opencode-session`/session cache headers from request options.
    - Performance: Model lookup is static package data and provider dispatch is one branch per request; stream parsing remains incremental and network-free in tests.
    - Code Quality: OpenCode-specific model quirks stay in package `compat` metadata; shared OpenAI/Anthropic route code is package-local unless primitive review approves extraction.
    - Security: `OPENCODE_API_KEY` is resolved only from caller-supplied credential resolvers/options; headers and errors redact the resolved key.
  - Approach:
    - Documentation Reviewed:
      - Pi `models.generated.js` `opencode-go` entries: OpenAI-compatible and Anthropic-compatible routes, model limits/costs, thinking maps, and compat flags.
      - Pi `providers/openai-completions.js`: OpenAI-compatible reasoning formats, tool-call deltas, cache usage, `max_tokens`, and thinking replay quirks.
      - Pi `providers/anthropic.js`: Anthropic-compatible tool, thinking, cache-control, and usage mapping.
      - Pi `env-api-keys.js`: `OPENCODE_API_KEY` for `opencode-go`.
      - OpenCode public docs/Zen pages inspected for product context.
    - Options Considered:
      - Split OpenCode Go into one package per route type: rejected; users choose models, not route packages.
      - Register no models and require app metadata: rejected for OpenCode Go; roadmap asks to use Pi's model metadata.
      - Add core route dispatcher: rejected; package-local dispatch is enough.
    - Chosen Approach:
      - Export `createOpenCodeGoProviderPackage(options)`, `createOpenCodeGoProvider(options)`, and `openCodeGoModels`.
      - Put route type/base URL in model `metadata`/`compat`; provider picks OpenAI-compatible or Anthropic-compatible request builder per model.
      - Apply session/cache headers from `ProviderRequest.options.sessionId` and map cache usage from both response styles.
    - API Notes and Examples:
      ```ts
      import { createOpenCodeGoProviderPackage } from "@prism/provider-opencode-go";

      api.registerProviderPackage(createOpenCodeGoProviderPackage({ apiKey: credentials }));
      api.registerProviderRequestPolicy({ name: "go-cache", apply: ({ request }) => request });
      ```
    - Files Edited:
      - `packages/provider-opencode-go/src/index.ts`: public exports, package factory, provider/model/auth registration.
      - `packages/provider-opencode-go/src/models.ts`: static OpenCode Go model metadata with route compat.
      - `packages/provider-opencode-go/src/provider.ts`: route dispatcher and credential redaction.
      - `packages/provider-opencode-go/src/openai-chat.ts`: OpenAI-compatible request/stream mapping.
      - `packages/provider-opencode-go/src/anthropic-messages.ts`: Anthropic-compatible request/stream mapping.
      - `packages/provider-opencode-go/src/cache.ts`: OpenCode session header mapping with header-safe cleanup.
      - `packages/provider-opencode-go/src/sse.ts`: minimal package-local SSE parser.
      - `packages/provider-opencode-go/src/__tests__/opencode-go.test.ts`: mocked route tests.
      - `packages/provider-opencode-go/src/__tests__/live.test.ts`: kept env-gated skipped live test.
      - `packages/provider-opencode-go/README.md`: package usage.
      - `docs/providers/opencode-go.md`, `docs/provider-packages.md`, `docs/index.md`: linked docs and behavior notes.
    - References:
      - `roadmap.md` Phase 12 OpenCode Go deliverables.
      - Pi model/provider source listed above.
  - Test Cases Written:
    - `opencode_go_registers_pi_model_metadata`: package setup registers expected provider/model/auth entries.
    - `opencode_go_openai_route_streams_text_thinking_tool_calls`: mocked OpenAI-compatible stream.
    - `opencode_go_anthropic_route_streams_text_tool_calls_and_usage`: mocked Anthropic-compatible stream.
    - `opencode_go_applies_session_cache_headers`: verifies `x-opencode-session` and safe session id behavior.
    - `opencode_go_redacts_api_key_from_errors`: no key in provider events.
    - `opencode_go_live_test_is_skipped_without_env`: covered by existing skipped live-test convention.
  - Checks Run:
    - `npm run typecheck`
    - `command npm test`
    - `npm run pack:dry-run`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds `@prism/provider-opencode-go` package APIs, model metadata, auth method, route behavior, and cache/session headers.
    - Docs pages to create/edit:
      - `docs/providers/opencode-go.md`: API key setup, model selection, route behavior, cache/session headers, tests, redaction.
      - `docs/provider-packages.md`: link first-party OpenCode Go package.
    - `docs/index.md` update: Yes; add Provider and model connection entry for OpenCode Go provider package.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Implement `@prism/provider-openrouter`
  - Acceptance Criteria:
    - Functional: Package registers an OpenRouter API-key provider, auth descriptor, request/cache policy helpers, and app-controlled model registration helpers that pass through routing, reasoning, cache-control, and per-model overrides without a hard-coded global catalog.
    - Performance: Provider does not fetch OpenRouter's model catalog at setup by default; request mapping is a single payload build plus incremental SSE parsing.
    - Code Quality: OpenRouter routing/cache/reasoning fields live in model `compat` or explicit package options; no OpenRouter behavior is added to Prism core.
    - Security: API keys are resolved per request; optional attribution headers are disabled unless caller passes them; docs fixtures use fake keys only.
  - Approach:
    - Documentation Reviewed:
      - OpenRouter Chat Completion API markdown: bearer auth, `/api/v1/chat/completions`, streaming/non-streaming.
      - OpenRouter Provider Routing docs: `provider.order`, `allow_fallbacks`, `require_parameters`, `data_collection`, `zdr`, quantizations, price/latency/throughput controls.
      - OpenRouter Prompt Caching docs: `session_id`, `x-session-id`, sticky routing, `prompt_tokens_details.cached_tokens`, `cache_write_tokens`, Anthropic/Alibaba `cache_control` notes.
      - OpenRouter Reasoning Tokens docs: `reasoning.effort`, `max_tokens`, `exclude`, and model-level reasoning options.
      - Pi `providers/openai-completions.js`: `thinkingFormat: "openrouter"`, `openRouterRouting`, Anthropic `cache_control` for `anthropic/*`, usage cache mapping.
    - Options Considered:
      - Bundle Pi's large OpenRouter catalog: rejected; roadmap asks for app-controlled model catalog.
      - Fetch model catalog at setup: rejected; hidden network and setup latency.
      - Provide helper functions for app-supplied models and route/cache options: chosen.
    - Chosen Approach:
      - Export `createOpenRouterProviderPackage(options)`, `createOpenRouterProvider(options)`, and `defineOpenRouterModel(config)`.
      - Register only `options.models`; provide examples for app model override and per-model cache policy.
      - Map `model.compat.openRouterRouting` to request `provider`, `request.options.sessionId` to `session_id`/`x-session-id`, and `request.options.cacheRetention` to explicit cache markers only when the model asks for them.
    - API Notes and Examples:
      ```ts
      import { createOpenRouterProviderPackage, defineOpenRouterModel } from "@prism/provider-openrouter";

      const model = defineOpenRouterModel({
        model: "anthropic/claude-sonnet-4",
        displayName: "Claude Sonnet 4 via OpenRouter",
        compat: { openRouterRouting: { only: ["anthropic"], data_collection: "deny" } },
      });
      api.registerProviderPackage(createOpenRouterProviderPackage({ apiKey: credentials, models: [model] }));
      ```
    - Files Edited:
      - `packages/provider-openrouter/src/index.ts`: public exports, package factory, provider/model/auth registration.
      - `packages/provider-openrouter/src/model.ts`: model helper and compat typing.
      - `packages/provider-openrouter/src/provider.ts`: OpenAI-compatible request/stream mapping, routing/reasoning passthrough, attribution headers, credential redaction.
      - `packages/provider-openrouter/src/cache.ts`: `session_id`, `x-session-id`, `cache_control`, and usage mapping.
      - `packages/provider-openrouter/src/sse.ts`: minimal package-local SSE parser.
      - `packages/provider-openrouter/src/__tests__/openrouter.test.ts`: mocked provider tests.
      - `packages/provider-openrouter/src/__tests__/live.test.ts`: kept env-gated skipped live test.
      - `packages/provider-openrouter/README.md`: package usage and model override examples.
      - `docs/providers/openrouter.md`, `docs/provider-packages.md`, `docs/index.md`: linked docs and behavior notes.
    - References:
      - `roadmap.md` Phase 12 OpenRouter deliverables.
      - OpenRouter docs URLs listed above.
  - Test Cases Written:
    - `openrouter_registers_only_app_supplied_models`: no default catalog fetch/registration.
    - `openrouter_passes_provider_routing_and_reasoning_controls`: payload/header assertion.
    - `openrouter_applies_model_level_cache_policy_override`: per-model cache behavior.
    - `openrouter_maps_cache_read_write_usage`: `prompt_tokens_details` accounting.
    - `openrouter_redacts_api_key_from_errors`: error event redaction.
    - `openrouter_live_test_is_skipped_without_env`: covered by existing skipped live-test convention.
  - Checks Run:
    - `npm run typecheck`
    - `command npm test`
    - `npm run pack:dry-run`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds `@prism/provider-openrouter` package APIs, model helper, routing/cache behavior, and auth method.
    - Docs pages to create/edit:
      - `docs/providers/openrouter.md`: API key setup, app-controlled model catalog, routing passthrough, reasoning controls, cache override, redaction.
      - `docs/provider-packages.md`: link first-party OpenRouter package.
    - `docs/index.md` update: Yes; add Provider and model connection entry for OpenRouter provider package.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Implement `@prism/provider-zai`
  - Acceptance Criteria:
    - Functional: Package registers a Z.AI GLM API-key provider and Pi-derived GLM model metadata using OpenAI-compatible `/chat/completions`, `thinkingFormat: "zai"`, developer-role fallback to `system`, GLM reasoning effort mapping, and `tool_stream` for supported models.
    - Performance: Static model metadata and payload mapping add no network setup; streaming parser handles tool-call deltas incrementally.
    - Code Quality: Z.AI quirks live in package metadata/request builder; generic OpenAI-compatible helpers are package-local unless extracted by the primitive review.
    - Security: ZAI credentials are caller-resolved per request and redacted from HTTP errors/provider events; no ZAI env lookup happens unless a host supplies an env resolver.
  - Approach:
    - Documentation Reviewed:
      - Z.AI Chat Completion docs: `POST /paas/v4/chat/completions`, bearer auth, streaming `data: [DONE]`, tools, `tool_stream`, and `reasoning_effort`.
      - Z.AI Deep Thinking and Thinking Mode docs: `thinking.type`, preserved thinking, `reasoning_effort` values and mappings.
      - Z.AI GLM-4.5/GLM-4.7 docs: context/output limits and agent/tool focus.
      - Pi `models.generated.js` `zai`/`zai-coding-cn` entries and compat metadata.
      - Pi `providers/openai-completions.js`: `thinkingFormat: "zai"`, `supportsDeveloperRole: false`, `zaiToolStream`, and usage mapping.
      - Pi `env-api-keys.js`: `ZAI_API_KEY` and `ZAI_CODING_CN_API_KEY` names for docs/examples only.
    - Options Considered:
      - Ship both global and China providers as separate packages: rejected; one package with base URL/provider id override is enough.
      - Force all GLM models into thinking mode: rejected; model metadata/request options should control `thinking`.
      - Implement as generic OpenAI-compatible config only: rejected; GLM tool-stream and thinking quirks need package tests/docs.
    - Chosen Approach:
      - Export `createZaiProviderPackage(options)`, `createZaiProvider(options)`, `zaiModels`, and `defineZaiModel(config)` for overrides.
      - Default provider id/base URL to `zai`; allow caller override for CN or private endpoints.
      - Map `ProviderRequest.options.compat` and model compat to `thinking`, `reasoning_effort`, `tool_stream`, `max_tokens`, and role fallback.
    - API Notes and Examples:
      ```ts
      import { createZaiProviderPackage } from "@prism/provider-zai";

      api.registerProviderPackage(createZaiProviderPackage({ apiKey: credentials }));
      // Use providerOptions: { cacheRetention: "none" } per run if a host wants no cache hints.
      ```
    - Files Edited:
      - `packages/provider-zai/src/index.ts`: public exports, package factory, provider/model/auth registration.
      - `packages/provider-zai/src/models.ts`: static GLM model metadata and override helper.
      - `packages/provider-zai/src/provider.ts`: request builder, SSE parser, stream mapping, credential redaction.
      - `packages/provider-zai/src/sse.ts`: minimal package-local SSE parser.
      - `packages/provider-zai/src/thinking.ts`: GLM thinking/reasoning/tool-stream mapping.
      - `packages/provider-zai/src/__tests__/zai.test.ts`: mocked stream/payload tests.
      - `packages/provider-zai/src/__tests__/live.test.ts`: kept env-gated skipped live test.
      - `packages/provider-zai/README.md`: package usage.
      - `docs/providers/zai.md`, `docs/provider-packages.md`, `docs/index.md`: linked docs and behavior notes.
    - References:
      - `roadmap.md` Phase 12 ZAI deliverables.
      - Z.AI and Pi docs/source listed above.
  - Test Cases Written:
    - `zai_registers_glm_model_metadata`: expected GLM models/limits/compat.
    - `zai_uses_system_role_when_developer_role_is_unsupported`: payload assertion.
    - `zai_maps_thinking_and_reasoning_effort`: `thinking.type` and effort mapping.
    - `zai_enables_tool_stream_for_supported_models`: payload and streamed tool-call deltas.
    - `zai_redacts_api_key_from_http_errors`: no key in provider events.
    - `zai_live_test_is_skipped_without_env`: covered by existing skipped live-test convention.
  - Checks Run:
    - `npm run typecheck`
    - `command npm test`
    - `npm run pack:dry-run`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds `@prism/provider-zai` package APIs, GLM model metadata, auth method, thinking/tool-stream behavior.
    - Docs pages to create/edit:
      - `docs/providers/zai.md`: API key setup, model selection, thinking controls, tool streaming, base URL override, redaction.
      - `docs/provider-packages.md`: link first-party ZAI package.
    - `docs/index.md` update: Yes; add Provider and model connection entry for ZAI provider package.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Implement `@prism/provider-kimi`
  - Acceptance Criteria:
    - Functional: Package registers Kimi For Coding subscription/API-key auth and Anthropic-compatible provider behavior for Pi-derived `kimi-coding` models; Moonshot/Kimi Open Platform API-key models are available as optional metadata/helpers and are not registered unless the app opts in.
    - Performance: Kimi For Coding uses incremental Anthropic-compatible stream parsing; optional Moonshot metadata registration performs no catalog fetch by default.
    - Code Quality: Anthropic-compatible quirks, Kimi headers, preserved reasoning/tool behavior, and optional Moonshot OpenAI-compatible metadata stay inside this package.
    - Security: Kimi/Moonshot credentials are resolved per request and redacted; docs clearly separate subscription/API-key options and never imply core env discovery.
  - Approach:
    - Documentation Reviewed:
      - Pi `models.generated.js` `kimi-coding` entries: `https://api.kimi.com/coding`, `User-Agent: KimiCLI/1.5`, Anthropic-compatible API, context/output limits.
      - Pi `providers/anthropic.js`: Anthropic Messages request, tool, thinking, cache-control, and usage mapping.
      - Kimi Open Platform chat docs: OpenAI-compatible chat, streaming SSE, `tool_calls`, usage `cached_tokens`, and `thinking` behavior for `kimi-k2.7-code`.
      - Kimi K2.7 Code quickstart: model behavior, tool constraints, and preserving `reasoning_content` in multi-step tool calling.
      - Pi `models.generated.js` `moonshotai` entries for optional Moonshot API-key model metadata.
      - Pi `env-api-keys.js`: `KIMI_API_KEY` and `MOONSHOT_API_KEY` names for docs/examples only.
    - Options Considered:
      - Merge Kimi For Coding and Moonshot Open Platform as one default provider: rejected; roadmap says Moonshot API-key models stay optional metadata, not core/default behavior.
      - Implement only Moonshot OpenAI-compatible API: rejected; requested package is Kimi For Coding subscription/API-key provider.
      - Add a generic Anthropic-compatible core adapter first: rejected unless primitive review proves it is needed.
    - Chosen Approach:
      - Export `createKimiProviderPackage(options)`, `createKimiCodingProvider(options)`, `kimiCodingModels`, and `moonshotKimiModels`/`includeMoonshotModels` opt-in helper.
      - Register `kimi-coding` auth/modes by default; register Moonshot models only when options request them.
      - Map Anthropic-compatible stream events to Prism events and preserve reasoning signatures enough for replay tests.
    - API Notes and Examples:
      ```ts
      import { createKimiProviderPackage } from "@prism/provider-kimi";

      api.registerProviderPackage(createKimiProviderPackage({
        kimiApiKey: credentials,
        includeMoonshotModels: false,
      }));
      ```
    - Files Edited:
      - `packages/provider-kimi/src/index.ts`: public exports, package factory, provider/model/auth registration.
      - `packages/provider-kimi/src/models.ts`: Kimi For Coding and optional Moonshot model metadata.
      - `packages/provider-kimi/src/provider.ts`: Anthropic-compatible Kimi provider, request builder, stream mapping, credential redaction.
      - `packages/provider-kimi/src/sse.ts`: minimal package-local SSE parser.
      - `packages/provider-kimi/src/__tests__/kimi.test.ts`: mocked Kimi stream tests.
      - `packages/provider-kimi/src/__tests__/live.test.ts`: kept env-gated skipped live test.
      - `packages/provider-kimi/README.md`: package usage and optional Moonshot notes.
      - `docs/providers/kimi.md`, `docs/provider-packages.md`, `docs/index.md`: linked docs and behavior notes.
    - References:
      - `roadmap.md` Phase 12 Kimi deliverables.
      - Kimi platform docs and Pi model/provider source listed above.
  - Test Cases Written:
    - `kimi_registers_kimi_coding_models_by_default`: no Moonshot models unless opt-in.
    - `kimi_anthropic_stream_maps_text_thinking_tool_calls_usage`: mocked Anthropic-compatible stream.
    - `kimi_preserves_reasoning_for_tool_replay`: replay payload includes reasoning content.
    - `kimi_optional_moonshot_metadata_is_app_selected`: optional registration behavior.
    - `kimi_redacts_subscription_or_api_key_errors`: no key in provider events.
    - `kimi_live_test_is_skipped_without_env`: covered by existing skipped live-test convention.
  - Checks Run:
    - `npm run typecheck`
    - `command npm test`
    - `npm run pack:dry-run`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds `@prism/provider-kimi` package APIs, Kimi model metadata, auth methods, optional Moonshot metadata, and provider behavior.
    - Docs pages to create/edit:
      - `docs/providers/kimi.md`: Kimi For Coding setup, API key/subscription notes, model selection, optional Moonshot metadata, cache/reasoning, redaction.
      - `docs/provider-packages.md`: link first-party Kimi package.
    - `docs/index.md` update: Yes; add Provider and model connection entry for Kimi provider package.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Verify provider cache policies, conformance, docs, and package boundaries
  - Acceptance Criteria:
    - Functional: All five provider packages pass network-free conformance tests, expose documented package entry points, include skipped live tests, and can be packed without including source secrets or test fixtures with credentials.
    - Performance: Default test suite remains network-free and reasonably fast; no package setup performs catalog fetch, OAuth login, or credential resolution until explicitly invoked.
    - Code Quality: `npm run build`, `npm run typecheck`, `command npm test`, provider workspace tests, docs link checks, and package dry-runs pass; root core still works without loading provider packages.
    - Security: Boundary tests prove secrets are redacted from provider events/errors and stored session entries; docs/tests contain only fake placeholders; live tests require explicit `PRISM_LIVE_PROVIDER_TESTS=1` plus provider-specific env vars.
  - Approach:
    - Documentation Reviewed:
      - All new package READMEs and `docs/providers/*.md` pages.
      - `docs/index.md`, `docs/provider-packages.md`, `docs/provider-conformance.md`, `docs/credentials-and-redaction.md`.
      - `package.json` root/workspace scripts and each package `package.json` exports/files.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Rely on per-package tests only: rejected; final boundary checks should catch docs/export/secrets drift across packages.
      - Add live tests to default `npm test`: rejected; roadmap requires mocked tests by default.
      - Add a heavy API extractor: rejected; TypeScript, package export tests, and docs checks are enough.
    - Chosen Approach:
      - Added one final boundary test file that imports every provider package entry point from built workspace output, verifies setup stays network-free, checks docs links, checks package exports/files, scans docs/tests for real-looking committed secrets, and keeps the core provider-specific behavior guard.
      - Per-package mocked conformance tests remain the provider stream checks; the final root boundary test avoids adding another copy of every provider stream fixture.
    - API Notes and Examples:
      ```bash
      npm run build
      npm run typecheck
      command npm test
      npm run test --workspaces --if-present
      npm run pack:dry-run --workspaces --if-present
      ```
    - Files Edited:
      - `src/__tests__/phase12-boundaries.test.ts`: final export, setup/no-network, live-test, docs-link, package-boundary, secret-scan, and core-boundary checks.
      - `plans/015-real-provider-packages.md`: marked the task complete and filled closeout fields.
      - Docs/package metadata needed no extra edits beyond provider task updates; final tests now guard them.
    - References:
      - `roadmap.md` Phase 12 acceptance.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases Written:
    - `phase12_provider_packages_import_from_public_entrypoints`: imports all package factories from built workspace entry points.
    - `phase12_provider_packages_setup_without_network_and_register_auth`: package setup registers auth/provider metadata without calling fetch.
    - `phase12_live_tests_are_skipped_by_default`: no env means live tests stay skipped.
    - `phase12_docs_index_links_all_provider_pages`: docs navigation coverage.
    - `phase12_package_exports_files_are_minimal`: package `exports`, `files`, dependency, and postinstall boundaries.
    - `phase12_no_real_secrets_in_docs_or_fixtures`: placeholders only.
    - `phase12_core_has_no_new_requested_provider_runtime_behavior`: core boundary guard.
  - Checks Run:
    - `npm run typecheck`
    - `command npm test`
    - `npm run pack:dry-run`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; finalizes docs/export behavior for all Phase 12 provider packages.
    - Docs pages to create/edit:
      - `docs/index.md`: final Provider and model connection entries for all provider packages.
      - `docs/provider-packages.md`: final first-party package list and package authoring guidance updates.
      - `docs/provider-conformance.md`: examples using the new packages if needed.
      - `docs/credentials-and-redaction.md`: provider package auth/redaction cross-links if needed.
    - `docs/index.md` update: Yes; final navigation consistency check.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Kept provider-specific SSE/request mappers package-local instead of extracting shared adapters; duplication is smaller than a premature core abstraction for Phase 12.
- OpenRouter model catalogs and Moonshot/Kimi Open Platform behavior remain app-selected metadata only; no setup catalog fetch or default Moonshot provider was added.
- Final root boundary tests verify package entry points and no-network setup, while detailed mocked stream conformance remains in each provider workspace test.

## Further Actions
- Add opt-in live tests per provider only when fake-safe env names and real credentials are available.
- Extract a shared OpenAI/Anthropic stream adapter later only if another provider repeats the same code enough to justify it.
- Expand model metadata/cost tables from upstream catalogs later without changing setup-time network behavior.
