# Phase 11 — Provider, Auth, Cache, and System-Prompt Primitives

## Objectives
- Add only generic Prism primitives needed by first-party and external provider packages.
- Keep provider-specific behavior outside core: no OpenAI, OpenRouter, ZAI, Kimi, or OpenCode literals in runtime behavior.
- Support explicit OAuth/API-key auth contracts, provider request/cache policy, model compat metadata, and layered system prompts.
- Leave core runnable fully in memory with mock providers, no package discovery, no hidden globals, and no network by default.

## Expected Outcome
- Provider packages can register providers, models, auth methods, request/cache policies, and docs through public contracts.
- Hosts can compose OAuth/API-key resolution order explicitly without Prism reading env/files unless a host passes those sources.
- Provider adapters can receive generic request options for session ids, cache retention, headers, compat metadata, and usage cache accounting.
- Apps/packages/users/runs can layer or replace the system prompt deterministically while `AgentConfig.instructions` still works.
- Provider packages get a network-free conformance harness for stream order, abort, tool calls, usage/cache accounting, redaction, and request-policy payload checks.

## Tasks

- [x] Inventory existing primitives and lock the minimal generic surface
  - Acceptance Criteria:
    - Functional: Existing provider/model registries, extension registries, middleware, credentials, settings, input/prompt assembly, runtime provider call path, usage shape, and docs were inventoried; the smallest public contract additions needed for Phase 11 are locked below.
    - Performance: Inventory added no runtime path, dependency, filesystem scan, provider call, worker, watcher, or test slowdown.
    - Code Quality: Design rejects hidden registries, package discovery, provider-name branching in core, duplicate auth stores, and one-off provider package logic.
    - Security: Design keeps resolved credentials at the provider edge and requires request/cache policy payloads to be redacted before events, summaries, or session entries.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 11 and non-negotiable boundaries.
      - `plans/013-settings-auth-trust-security.md` closeout and current auth/trust/redaction compromises.
      - `src/contracts.ts`: `ModelConfig`, `Usage`, `ProviderRequest`, `AIProvider`, `RunOptions`, `AgentConfig`, `ExtensionAPI`, `SettingsProvider`, and `CredentialResolver`.
      - `src/providers.ts`, `src/models.ts`, `src/contributions.ts`, `src/extensions.ts`, `src/input.ts`, `src/agents.ts`, `src/credentials.ts`, `src/redaction.ts`, and `src/providers/openai-compatible.ts`.
      - `docs/provider-layer.md`, `docs/contribution-registries.md`, `docs/credentials-and-redaction.md`, `docs/input-and-prompt-assembly.md`, `docs/agent-session-runtime.md`, `docs/middleware-hooks.md`, `docs/settings-auth-trust-security.md`, `docs/public-contracts.md`, and `docs/index.md`.
      - Pi docs: `docs/custom-provider.md` provider registration, OAuth callbacks/credentials, compat fields, and cache-control notes; `docs/models.md` model compat and OpenRouter routing passthrough; `docs/providers.md` explicit auth resolution order; `docs/sdk.md` API key/OAuth and `systemPromptOverride`; `README.md` `SYSTEM.md`/`APPEND_SYSTEM.md` system prompt behavior.
      - Pi source type reference: `@earendil-works/pi-ai/dist/types.d.ts` `StreamOptions`, `CacheRetention`, `sessionId`, `onPayload`, headers, retry, and provider env options.
      - `.agents/skills/create-plan/references/prism-wiki.md` documentation requirements.
      - Project pattern/wiki directories: none present under `.agents/skills/project-patterns/` or `.agents/skills/project-wiki/`.
    - Inventory Result:
      - Existing primitives to reuse:
        - `createProviderRegistry()` and `createModelRegistry()` already provide explicit in-memory provider/model lookup; keep them as the backing registries.
        - `ContributionRegistries` and `ExtensionAPI` already register most contribution types; extend them instead of adding a second plugin/package system.
        - `createMiddlewareRegistry()` already has `provider_request` and `provider_response` hook names; use the existing hook names and document actual runtime call sites when added.
        - `CredentialResolver`, `createMemoryCredentialStore()`, `createChainedCredentialResolver()`, and `resolveCredentialValue()` already cover host-owned API-key lookup; add source/auth contracts around them, not a secret store.
        - `createDefaultInputBuilder()`, `createDefaultPromptBuilder()`, and `assembleProviderInput()` already carry system instructions into provider requests; layered prompts should compose into this path.
        - `RuntimeAgentSession.run()` is the single provider-turn path; request policy/middleware should be inserted there before `AIProvider.generate()` and after prompt assembly.
        - `redactProviderRequest()`, `redactAgentEvent()`, `redactSessionEntry()`, and `providerError()` already define exact-secret redaction boundaries; request policy secrets must feed those boundaries.
        - `Usage` exists but lacks cache accounting; extend it instead of adding provider-specific usage shapes.
        - `createMockProvider()` and existing mocked OpenAI-compatible tests are enough foundation for a small conformance helper subpath.
      - Confirmed gaps:
        - No provider package contract or inert provider-package metadata.
        - `ModelConfig` has only `provider`, `model`, and `parameters`; it needs typed common metadata plus opaque compat data.
        - No OAuth/API-key auth method contracts, no explicit named resolver-order helper, and no env-object resolver.
        - `ProviderRequest` has no generic request options for session/cache/headers/timeouts/adapter extras.
        - Runtime currently passes `AgentConfig.instructions` only; no app/package/user/run prompt layering or per-run disable/replace semantics.
        - No reusable provider conformance export.
    - Locked Minimal Generic Surface:
      - Provider packages:
        - Add `ProviderPackage`, `ProviderPackageAPI`, `ProviderPackageDocs`, and `defineProviderPackage(package)`.
        - Extend `ContributionRegistries`/`ExtensionAPI` with `registerProviderPackage`, `registerAuthMethod`, `registerProviderRequestPolicy`, and `registerSystemPromptContribution` only; no package discovery or manifest loader.
      - Model metadata:
        - Extend `ModelConfig` with optional `displayName`, `capabilities`, `limits`, `cost`, `compat`, and `metadata`.
        - Keep provider-specific fields inside opaque `compat?: JsonObject`; do not add OpenAI/OpenRouter/ZAI/Kimi/OpenCode branches to core.
        - Do not store resolved credentials in model metadata. Static non-secret provider quirks belong in provider packages or `compat`; secret-bearing headers belong in request policies at runtime.
      - Auth:
        - Add `AuthMethod`, `ApiKeyAuthMethod`, `OAuthProvider`, `OAuthCredentials`, `OAuthLoginCallbacks`, `CredentialResolverSource`, `createExplicitCredentialResolver(sources)`, `createEnvCredentialResolver(env, map)`, and a small OAuth refresh helper that uses caller-owned storage.
        - Resolver order is explicit data: runtime override → stored credential → caller-supplied env object → fallback resolver. Core still never reads `process.env`, files, keychains, or commands by default.
      - Provider request/cache policy:
        - Add `CacheRetention = "none" | "short" | "long"`, `ProviderRequestOptions`, `ProviderRequestPolicy`, policy context/result types, `createProviderRequestPolicyChain()`, and `createSessionCachePolicy()`.
        - Extend `ProviderRequest` with `options?: ProviderRequestOptions`; extend `Usage` with `cacheReadTokens?` and `cacheWriteTokens?`.
        - Runtime applies configured request policies, then existing `provider_request` middleware, then redacts the provider request before `AIProvider.generate()`.
        - Policy result may return known `secrets` for redaction; cache keys default to safe session ids/caller strings, never prompt text or credential values.
      - System prompts:
        - Add `SystemPromptContribution`, `SystemPromptMode = "append" | "prepend" | "replace" | "disable"`, `SystemPromptSource`, and `composeSystemPrompt(contributions)`.
        - Add optional `AgentConfig.systemPrompt` and `RunOptions.systemPrompt` for layered config while preserving `AgentConfig.instructions` as the simple direct path.
        - Composition is pure and deterministic: base/instructions, package, app, user, run. `replace` clears earlier text; `disable` removes configured layers for that scope.
      - Provider conformance:
        - Add dependency-free helpers under `prism/testing/provider-conformance`: `collectProviderEvents()`, `assertProviderStreamConforms()`, `assertAbortIsObserved()`, `assertToolCallDeltasReconstruct()`, and `assertUsageAccounting()`.
        - Keep the harness network-free and provider-name agnostic.
      - Explicit non-goals for Phase 11:
        - No built-in requested-provider implementations, provider literals, auth.json store, env scan, command execution, package loading/discovery, prompt file discovery, tokenizer, cache store, live network tests, or new dependency.
    - Options Considered:
      - Hard-code requested providers in core: rejected; provider-specific behavior belongs in packages.
      - Put every provider quirk in `ModelConfig.parameters`: rejected; those are model request parameters, not typed model capability/compat metadata.
      - Add a package manager/discovery system: rejected; Phase 11 needs contracts only, host/package loading remains explicit.
      - Copy Pi `AuthStorage`/auth.json into core: rejected; Prism core keeps only contracts and caller-owned stores.
      - Use existing registries/middleware and add only missing generic registries/types: chosen.
    - Chosen Approach:
      - Implement the locked surface in the following tasks only; do not add broader provider behavior while doing so.
      - Prefer root exports for pure contracts/helpers and an explicit `./testing/provider-conformance` subpath only for testing utilities.
      - Keep provider-specific constants and live auth/network behavior for Phase 12 packages.
    - API Notes and Examples:
      ```ts
      import { defineProviderPackage } from "prism";

      const providerPackage = defineProviderPackage({
        name: "demo-provider",
        docs: { description: "Demo provider package." },
        setup(api) {
          api.registerProvider(provider);
          api.registerModel({
            provider: "demo",
            model: "demo-model",
            capabilities: { input: ["text"], reasoning: true },
            compat: { vendorSpecific: true },
          });
          api.registerAuthMethod({ provider: "demo", kind: "api_key", credentialName: "apiKey" });
          api.registerProviderRequestPolicy(cachePolicy);
          api.registerSystemPromptContribution({ id: "demo", source: "package", mode: "append", text: "Use demo-safe output." });
        },
      });
      ```
    - Files Edited:
      - `plans/014-provider-auth-cache-and-system-prompt-primitives.md`: recorded inventory result, locked naming/surface, explicit non-goals, and completion status.
    - Files Planned for Later Tasks:
      - `src/contracts.ts`, `src/contributions.ts`, `src/extensions.ts`, `src/providers.ts`, `src/models.ts`, `src/credentials.ts`, `src/input.ts`, `src/agents.ts`, `src/provider-events.ts`, `src/providers/openai-compatible.ts`, `src/index.ts`, `package.json`, `docs/*`, and new focused modules listed below.
    - References:
      - `roadmap.md` Phase 11 acceptance: core remains in-memory, no requested-provider literals in core behavior, packages provide auth/cache/model metadata through public contracts.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - None for this inventory-only task; validation was source/doc inspection plus this plan update.
  - Checks Run:
    - Plan-only task; no build/typecheck/test run because no runtime code changed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No by inventory alone; later tasks must document every public contract/behavior.
    - Docs pages to create/edit:
      - `none`: inventory notes remain in this plan until public API changes land.
    - `docs/index.md` update: No for inventory alone.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add provider-package registration and model metadata primitives
  - Acceptance Criteria:
    - Functional: Packages can define a provider package that registers providers, models, auth methods, request policies, system prompt contributions, and documentation metadata through explicit APIs; model configs carry generic capability/compat/cost/cache metadata without changing provider behavior by themselves.
    - Performance: Registration remains in-memory and O(1) for provider/model lookups; no package scan, dynamic import, filesystem, network, or schema generator is added.
    - Code Quality: New primitives reuse `ExtensionAPI`/`ContributionRegistries` where possible; provider package docs metadata is inert data, not execution.
    - Security: Registries reject storing resolved credential values in model/provider package metadata; docs/examples use placeholders only.
  - Approach:
    - Documentation Reviewed:
      - `docs/contribution-registries.md` and `src/contributions.ts` existing registry bundle.
      - `docs/extensions.md` and `src/extensions.ts` extension setup API.
      - `docs/provider-layer.md`, `src/providers.ts`, and `src/models.ts` explicit provider/model registries.
      - Pi `docs/custom-provider.md` `pi.registerProvider()` examples and provider/model config reference.
      - Pi `docs/models.md` provider/model `compat`, `cost`, `contextWindow`, `maxTokens`, `headers`, and `modelOverrides` concepts.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Add a second extension system just for provider packages: rejected; reuse extension/registry concepts.
      - Make model metadata a single `JsonObject`: cheap but too opaque for common cache/reasoning/cost fields.
      - Add typed common metadata plus a provider-owned `compat?: JsonObject`: chosen; common code can inspect generic fields while packages keep provider-specific data opaque.
    - Chosen Approach:
      - Added `ProviderPackage`, `ProviderPackageAPI`, `ProviderPackageDocs`, `ModelCapabilities`, `ModelLimits`, `ModelCost`, inert auth/request-policy/system-prompt contribution contracts, and extended `ModelConfig` in `src/contracts.ts`.
      - Added `src/provider-packages.ts` with `defineProviderPackage()` plus stable key helpers for auth methods and system prompt contributions.
      - Extended `ContributionRegistries` and `ExtensionAPI` with provider package, auth method, provider request policy, and system prompt contribution registration.
      - Kept all registration inert: no package loading, provider calls, credential resolution, env/file reads, or provider-name branching.
    - API Notes and Examples:
      ```ts
      import { defineProviderPackage } from "prism";

      export default defineProviderPackage({
        name: "demo-provider",
        setup(api) {
          api.registerProvider(provider);
          api.registerModel({
            provider: "demo",
            model: "demo-large",
            displayName: "Demo Large",
            capabilities: { input: ["text"], reasoning: true },
            limits: { contextWindow: 128_000, maxOutputTokens: 8_192 },
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            compat: { vendorSpecific: true },
          });
        },
      });
      ```
    - Files Edited:
      - `src/contracts.ts`: provider-package contracts, model metadata contracts, and inert contribution contracts.
      - `src/provider-packages.ts`: `defineProviderPackage()`, `authMethodKey()`, and `systemPromptContributionKey()`.
      - `src/contributions.ts`: provider package/auth method/request policy/system prompt contribution registries.
      - `src/extensions.ts`: matching `ExtensionAPI.register*` methods.
      - `src/index.ts`: root exports for provider-package helpers.
      - `src/__tests__/contributions.test.ts`, `src/__tests__/extensions.test.ts`, `src/__tests__/public-contracts.test.ts`: registration and compile/runtime tests.
      - `docs/provider-packages.md`: new provider package/model metadata API page.
      - `docs/provider-layer.md`, `docs/contribution-registries.md`, `docs/extensions.md`, `docs/public-contracts.md`, `docs/index.md`: related API docs/navigation.
      - `docs/settings-auth-trust-security.md`: restored exact tested non-goal wording while touching docs.
    - References:
      - `roadmap.md` Phase 11 deliverable: provider-package contract and model metadata/compat extension.
      - Pi `docs/custom-provider.md` and `docs/models.md` for proven shapes without copying provider ids into core.
  - Test Cases Written:
    - `provider_package_registers_inert_contributions`: covered by extension/public contract tests loading a demo package through explicit API and verifying provider/model/policy/auth/prompt contributions are registered but not executed.
    - `model_registry_preserves_extended_metadata`: covered by public contract test resolving `demo-metadata` and checking metadata fields.
    - `extension_api_registers_new_provider_primitives`: covered by `extensions.test.ts` all-contribution registration.
    - `core_has_no_requested_provider_literals`: deferred to the final Phase 11 boundary verification task so it can scan all Phase 11 changes once, including later provider request policy additions.

  - Checks Run:
    - `npm run typecheck`
    - `command npm test`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; added provider package contracts, model metadata fields, and registry/extension contribution points.
    - Docs pages to create/edit:
      - `docs/provider-packages.md`: new API page with provider package contract, model metadata, examples, security notes, and related APIs.
      - `docs/provider-layer.md`: link provider package metadata to existing provider/model registries.
      - `docs/contribution-registries.md`: list new registries.
      - `docs/extensions.md`: document new `ExtensionAPI.register*` methods.
      - `docs/public-contracts.md`: update root contract inventory.
    - `docs/index.md` update: Yes; add Provider and model connection entry for provider packages/model metadata.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add OAuth/API-key auth contracts and explicit resolver order helpers
  - Acceptance Criteria:
    - Functional: Hosts/packages can define OAuth login callbacks, refreshable OAuth credentials, API-key auth descriptors, auth methods, and an explicit resolver chain ordered like runtime override → stored credential → host env object → fallback resolver.
    - Performance: Resolver lookup remains O(n) over configured sources with no built-in polling, TTL worker, filesystem I/O, network call, command execution, or environment scan.
    - Code Quality: New auth contracts compose with existing `CredentialResolver`, `createMemoryCredentialStore()`, `createChainedCredentialResolver()`, and redaction helpers instead of replacing them.
    - Security: Core never persists OAuth tokens, reads `process.env`, executes shell commands, or logs resolved credentials unless a host explicitly supplies such behavior and redaction; examples use fake placeholders.
  - Approach:
    - Documentation Reviewed:
      - `docs/credentials-and-redaction.md` and `docs/settings-auth-trust-security.md` current credential helpers and storage non-goals.
      - `src/credentials.ts`, `src/security.ts`, and `src/contracts.ts` credential contracts.
      - Pi `docs/custom-provider.md` OAuth `login`, `refreshToken`, `getApiKey`, `modifyModels`, `OAuthLoginCallbacks`, and `OAuthCredentials`.
      - Pi `docs/providers.md` auth resolution order and API key env/auth file keys.
      - Pi `docs/sdk.md` `AuthStorage` runtime override/stored/env/fallback priority.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Copy Pi `AuthStorage` including auth.json persistence: rejected for core; persistent storage remains host/package-owned.
      - Add automatic env variable lookup by provider id: rejected; hidden env discovery violates host control.
      - Add contracts plus source helpers that accept caller-provided stores/env objects: chosen.
    - Chosen Approach:
      - Added `OAuthLoginCallbacks`, `OAuthCredentials`, `OAuthProvider`, `OAuthCredentialStore`, and `CredentialResolverSource` public contracts in `src/contracts.ts`; extended OAuth auth methods with an optional `oauth` provider descriptor.
      - Added `createExplicitCredentialResolver()` as the named ordered resolver helper and made `createChainedCredentialResolver()` delegate to it.
      - Added `createEnvCredentialResolver(env, map)` that reads only a caller-supplied object and supports `provider:name`, `provider`, or `name` map keys.
      - Added `refreshOAuthCredential()` as a pure helper around a supplied `OAuthProvider` and optional caller-owned store.
      - Reused auth method contribution registration from the prior task; no persistence, env scan, commands, filesystem, polling, or network behavior was added.
    - API Notes and Examples:
      ```ts
      import { createExplicitCredentialResolver, createEnvCredentialResolver } from "prism";

      const credentials = createExplicitCredentialResolver([
        { name: "runtime", resolver: runtimeOverrides },
        { name: "stored", resolver: memoryStore },
        { name: "env", resolver: createEnvCredentialResolver({ DEMO_API_KEY: "test-key" }, { demo: "DEMO_API_KEY" }) },
        { name: "fallback", resolver: fallbackResolver },
      ]);
      ```
    - Files Edited:
      - `src/contracts.ts`: OAuth/API-key auth contracts and resolver/store contracts.
      - `src/credentials.ts`: explicit resolver-order helper, env-object resolver, OAuth refresh helper, and chained resolver delegation.
      - `src/index.ts`: root exports for new auth helpers.
      - `src/__tests__/credentials-redaction.test.ts`: resolver order, env object, OAuth callback/refresh tests.
      - `src/__tests__/public-contracts.test.ts`: compile/runtime contract coverage for OAuth and explicit resolver helpers.
      - `src/__tests__/docs.test.ts`: auth docs coverage and secret example guard.
      - `docs/provider-packages.md`: auth method contribution section.
      - `docs/credentials-and-redaction.md`: OAuth/API-key contracts, resolver order, examples, and security notes.
      - `docs/settings-auth-trust-security.md`: auth non-goals and explicit env source behavior.
      - `docs/public-contracts.md`, `docs/index.md`: contract/navigation updates.
    - References:
      - `roadmap.md` Phase 11 deliverable: OAuth/API-key credential contracts modeled after Pi callbacks, refreshable credentials, and explicit API-key resolution order.
      - Pi `docs/custom-provider.md`, `docs/providers.md`, and `docs/sdk.md` auth sections.
  - Test Cases Written:
    - `oauth_callbacks_typecheck_for_browser_device_prompt_select`: covered by `oauth callbacks typecheck and refresh updates caller store`.
    - `explicit_credential_resolver_uses_documented_order`: runtime override wins over later stored/env/fallback-style sources.
    - `env_credential_resolver_reads_only_passed_env_object`: proves no hidden `process.env` lookup.
    - `oauth_refresh_helper_updates_caller_store_without_logging_tokens`: verifies refresh return path and caller-store update without logging tokens.
    - `auth_docs_contain_no_real_token_examples`: existing docs secret guard plus auth-doc phrase coverage.

  - Checks Run:
    - `npm run typecheck`
    - `command npm test`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; added auth contracts and resolver-order helpers.
    - Docs pages to create/edit:
      - `docs/credentials-and-redaction.md`: OAuth/API-key contracts, resolver order, examples, and security notes.
      - `docs/provider-packages.md`: how provider packages contribute auth methods.
      - `docs/settings-auth-trust-security.md`: clarify persistent storage/env discovery remain explicit host choices.
      - `docs/public-contracts.md`: update public auth contract inventory.
    - `docs/index.md` update: Yes; add or update Security/auth/trust and Provider/model entries for provider auth.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add provider request/cache policy pipeline and usage cache accounting
  - Acceptance Criteria:
    - Functional: Hosts/packages can apply a generic provider request policy before `AIProvider.generate()` that can set request options such as `sessionId`, `cacheRetention`, headers, timeout/retry hints, model compat/options metadata, and opaque provider adapter data; usage can report cache read/write tokens.
    - Performance: Policy application is one ordered in-memory pass per provider turn; no caching store, tokenizer, filesystem, network, or background process is introduced.
    - Code Quality: Request policy uses typed `ProviderRequest`/`RunOptions`/`ModelConfig` data and middleware; provider adapters opt into consuming options instead of core mutating provider-specific payloads.
    - Security: Request options that may contain headers or tokens are redacted before events/errors and are not stored in session entries; cache keys default to session ids or caller-supplied safe strings, not prompt text or credentials.
  - Approach:
    - Documentation Reviewed:
      - `src/agents.ts` `assembleProviderInput()` → `generateWithRetry()` runtime path and `redactProviderRequest()` boundary.
      - `src/input.ts` `ProviderRequest` assembly and `src/providers/openai-compatible.ts` request payload creation.
      - `docs/middleware-hooks.md` current `provider_request`/`provider_response` hook docs; note that runtime currently documents hooks more broadly than it calls provider request/response.
      - `docs/provider-layer.md` provider event and usage docs.
      - Pi `@earendil-works/pi-ai/dist/types.d.ts` `StreamOptions`: `cacheRetention`, `sessionId`, `onPayload`, `onResponse`, headers, timeout, retry, metadata, env, and transport.
      - Pi provider sources/docs noted in the roadmap review: OpenAI prompt cache key/retention, Anthropic-style `cache_control`, Codex session/request ids, and usage cache-read/write parsing.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Implement OpenAI/OpenRouter/ZAI/Kimi cache payloads in core: rejected; payload mapping belongs to provider packages.
      - Add only middleware and no typed policy: rejected; packages need a reusable public policy contract and tests.
      - Add typed generic request options plus policy/middleware call sites: chosen.
    - Chosen Approach:
      - Extended `ProviderRequest` with `options?: ProviderRequestOptions` containing generic `sessionId`, `cacheRetention`, `cacheKey`, `headers`, timeout/retry hints, opaque `compat`, and opaque `extra`.
      - Extended `AgentConfig` and `RunOptions` with optional `providerOptions` and `providerRequestPolicies`, keeping default behavior unchanged.
      - Added `ProviderRequestPolicyResult`, `createProviderRequestPolicyChain()`, `createSessionCachePolicy()`, and `mergeProviderRequestOptions()` in `src/provider-request-policy.ts`.
      - Runtime now applies configured provider request policies, then `provider_request` middleware, exactly once before `AIProvider.generate()`; policy-returned secrets redact provider-turn errors.
      - Extended `Usage` with `cacheReadTokens` and `cacheWriteTokens` while preserving existing token fields.
      - Updated `createOpenAICompatibleProvider()` only to pass generic headers and parse generic OpenAI-compatible cache usage fields; no provider-specific cache policy or requested-provider literals were added.
    - API Notes and Examples:
      ```ts
      import { createSessionCachePolicy } from "prism";

      const cachePolicy = createSessionCachePolicy({ retention: "short" });
      const request = await cachePolicy.apply({
        request: baseRequest,
        sessionId: "session-1",
        model: baseRequest.model,
      });
      // request.options.cacheRetention === "short"
      // request.options.sessionId === "session-1"
      ```
    - Files Edited:
      - `src/contracts.ts`: `Usage` cache fields, `ProviderRequestOptions`, `CacheRetention`, `ProviderRequestPolicyResult`, `AgentConfig`, and `RunOptions` additions.
      - `src/provider-request-policy.ts`: session cache policy helper, policy chaining, option merging, and result normalization.
      - `src/agents.ts`: runtime policy/middleware application and provider-error redaction using policy secrets.
      - `src/input.ts`: preserves/forwards provider request options from assembly.
      - `src/providers/openai-compatible.ts`: consumes safe generic headers and parses cache read/write usage fields.
      - `src/index.ts`: root exports.
      - `src/__tests__/agents.test.ts`, `src/__tests__/openai-compatible.test.ts`, `src/__tests__/public-contracts.test.ts`, `src/__tests__/docs.test.ts`: behavior/docs tests.
      - `docs/provider-packages.md`, `docs/provider-layer.md`, `docs/middleware-hooks.md`, `docs/agent-session-runtime.md`, `docs/input-and-prompt-assembly.md`, `docs/public-contracts.md`, `docs/index.md`: request/cache policy docs.
    - References:
      - `roadmap.md` Phase 11 deliverables: generic provider request/cache policy hook and model compat/cache/usage metadata.
      - Pi `StreamOptions` and provider cache behavior references from local Pi docs/source.
  - Test Cases Written:
    - `provider_request_policy_adds_session_cache_options_before_provider_generate`: provider observes request options.
    - `provider_request_middleware_runs_once_per_turn_after_policy`: validates runtime call order.
    - `usage_supports_cache_read_and_write_tokens`: provider event usage round-trips cache accounting.
    - `request_policy_redacts_header_secrets_from_errors_and_events`: verifies exact secret redaction on provider-turn errors.
    - `cache_policy_defaults_to_no_prompt_text_cache_keys`: verifies no prompt content is used as a default cache key.
    - `core_request_policy_has_no_requested_provider_literals`: deferred to the final Phase 11 boundary verification task for one full-source guard over all Phase 11 code.

  - Checks Run:
    - `npm run typecheck`
    - `command npm test`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; changed provider request shape, runtime provider call behavior, usage fields, middleware call sites, and provider package policy surface.
    - Docs pages to create/edit:
      - `docs/provider-packages.md`: request/cache policy authoring and examples.
      - `docs/provider-layer.md`: `ProviderRequest.options`, `Usage.cacheReadTokens/cacheWriteTokens`, and provider adapter guidance.
      - `docs/middleware-hooks.md`: actual `provider_request` call timing and redaction rules.
      - `docs/agent-session-runtime.md`: runtime policy order and no-storage guarantee.
      - `docs/public-contracts.md`: new contracts/fields.
    - `docs/index.md` update: Yes; add Provider/model entry mentioning request/cache policy and usage cache accounting.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add layered system prompt primitives and runtime integration
  - Acceptance Criteria:
    - Functional: Hosts can compose app, package, user, and run system prompt contributions with explicit order and `append`/`prepend`/`replace`/`disable` behavior; `AgentConfig.instructions` remains the simple default path and preserves current behavior when no layers are configured.
    - Performance: Prompt composition is linear in number/length of configured prompt layers and adds no file discovery, template engine, watchers, provider calls, or package loading.
    - Code Quality: System prompt composition is a pure helper with typed inputs; runtime integration is limited to passing the composed string into existing input assembly.
    - Security: Prompt layers are caller-supplied content only; docs warn not to put secrets in prompts, settings, manifests, session entries, or package metadata.
  - Approach:
    - Documentation Reviewed:
      - `src/input.ts` `systemInstructions`, `developerInstructions`, `instructions`, and default input builder behavior.
      - `src/agents.ts` current `systemInstructions: this.agent.config.instructions` runtime path.
      - `docs/input-and-prompt-assembly.md` instruction and prompt builder docs.
      - `docs/agent-session-runtime.md` `AgentConfig.instructions` behavior.
      - Pi README `SYSTEM.md`/`APPEND_SYSTEM.md` replacement/append behavior.
      - Pi `docs/sdk.md` `DefaultResourceLoader({ systemPromptOverride })`.
      - Pi `docs/extensions.md` `before_agent_start` system prompt mutation and structured `systemPromptOptions`.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Add Pi-style filesystem `SYSTEM.md` discovery to core: rejected; hosts/resource loaders own filesystem choices.
      - Replace `AgentConfig.instructions`: rejected; it is the current simple API and should remain.
      - Add pure layered prompt helpers plus optional config/run fields: chosen.
    - Chosen Approach:
      - Added `SystemPromptMode`, `SystemPromptSource`, `SystemPromptConfig`, and pure `composeSystemPrompt()` / `mergeSystemPromptConfig()` helpers.
      - Added optional `AgentConfig.systemPrompt` and `RunOptions.systemPrompt` fields.
      - Implemented deterministic order for known sources: package, app, user, run; `replace` clears earlier content, `prepend`/`append` place text around current content, `disable` clears earlier content, and `RunOptions.systemPrompt: false` disables configured layers for that run.
      - Kept extension/provider-package registered prompt contributions inert; hosts decide which contributions become active by passing them to agent/run config.
      - Preserved the existing simple default path: if only `AgentConfig.instructions` is set, the default input builder receives the same system instruction string.
    - API Notes and Examples:
      ```ts
      import { composeSystemPrompt } from "prism";

      const prompt = composeSystemPrompt([
        { id: "app", source: "app", mode: "replace", text: "You are concise." },
        { id: "pkg", source: "package", mode: "append", text: "Use provider-safe JSON." },
      ]);
      ```
    - Files Edited:
      - `src/contracts.ts`: system prompt mode/source/config contracts and `AgentConfig`/`RunOptions` fields.
      - `src/system-prompts.ts`: pure composition and config merge helpers.
      - `src/agents.ts`: composes prompt before `assembleProviderInput()`.
      - `src/index.ts`: root exports.
      - `src/__tests__/system-prompts.test.ts`, `src/__tests__/agents.test.ts`, `src/__tests__/public-contracts.test.ts`, `src/__tests__/docs.test.ts`: behavior/docs tests.
      - `docs/system-prompts.md`: new API page for layered prompts.
      - `docs/provider-packages.md`, `docs/input-and-prompt-assembly.md`, `docs/agent-session-runtime.md`, `docs/contribution-registries.md`, `docs/extensions.md`, `docs/public-contracts.md`, `docs/index.md`: related updates.
    - References:
      - `roadmap.md` Phase 11 deliverable: layered system prompt contributions for apps/packages/users/runs while keeping `AgentConfig.instructions`.
      - Pi README, SDK, and extension docs for proven replacement/append and extension mutation concepts.
  - Test Cases Written:
    - `compose_system_prompt_appends_prepends_and_replaces_in_order`: pure helper behavior.
    - `agent_config_instructions_preserves_existing_default_prompt_path`: backwards compatibility.
    - `run_system_prompt_override_can_disable_configured_layers`: per-run control.
    - `uses_layered_system_prompts_before_provider_generate`: runtime integration.
    - `extension_registered_system_prompt_is_inert_until_host_selects_it`: already covered by contribution/extension registry tests and docs.
    - `system_prompt_docs_warn_against_secrets`: docs guard assertion.

  - Checks Run:
    - `npm run typecheck`
    - `command npm test`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; added system prompt composition APIs and runtime behavior/config fields.
    - Docs pages to create/edit:
      - `docs/system-prompts.md`: new API page with order, modes, examples, security notes, and related APIs.
      - `docs/input-and-prompt-assembly.md`: how composed prompts enter default input builder.
      - `docs/agent-session-runtime.md`: `AgentConfig`/`RunOptions` behavior.
      - `docs/contribution-registries.md` and `docs/extensions.md`: prompt contribution registration if added.
      - `docs/public-contracts.md`: contract inventory.
    - `docs/index.md` update: Yes; add Input and prompt assembly entry for system prompt layering.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add network-free provider conformance harness
  - Acceptance Criteria:
    - Functional: Provider package authors can run reusable checks for stream order, abort propagation, tool-call delta reconstruction, usage/cache accounting, redaction, and request-policy payload observation without live network.
    - Performance: Harness tests run with mocked providers/fetch/streams only and keep default `npm test` under the roadmap target; no dependency or test framework is added.
    - Code Quality: Harness exports small assertion helpers from an explicit testing subpath and does not couple to provider-specific packages or names.
    - Security: Fixtures use fake credentials only, assert redaction boundaries, and never require real API keys/OAuth tokens.
  - Approach:
    - Documentation Reviewed:
      - `src/providers/openai-compatible.ts` existing mocked SSE tests and abort handling.
      - `src/provider-events.ts` provider event helpers and tool-call delta shape.
      - `docs/provider-layer.md` mock provider and provider event semantics.
      - Pi `docs/custom-provider.md` custom provider testing section and stream event order.
      - Node `node:test`/`node:assert` usage already present in repository tests; no external framework.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Add a full provider simulator framework: rejected; providers can mock their own fetch/streams.
      - Export node:test suites directly: rejected; package authors may use different runners.
      - Export dependency-free async assertion helpers: chosen.
    - Chosen Approach:
      - Added `src/testing/provider-conformance.ts` with `collectProviderEvents()`, `assertProviderStreamConforms()`, `assertAbortIsObserved()`, `assertToolCallDeltasReconstruct()`, and `assertUsageAccounting()`.
      - Added package export `./testing/provider-conformance`.
      - Added Prism self-tests against `createMockProvider()` for collection, terminal events, abort propagation, tool-call delta reconstruction, cache usage accounting, and subpath export.
      - Kept live integration tests out of default tests; Phase 12 packages may add opt-in env-gated live tests.
    - API Notes and Examples:
      ```ts
      import { assertProviderStreamConforms } from "prism/testing/provider-conformance";

      await assertProviderStreamConforms({
        provider,
        request: { model, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
        expect: { text: "Hello", usage: { cacheReadTokens: 10 } },
      });
      ```
    - Files Edited:
      - `src/testing/provider-conformance.ts`: harness helpers.
      - `package.json`: added `./testing/provider-conformance` export.
      - `src/__tests__/provider-conformance.test.ts`: harness self-tests.
      - `src/__tests__/docs.test.ts`: docs guard for testing subpath/no-network docs.
      - `docs/provider-conformance.md`: dedicated API page for the harness.
      - `docs/provider-layer.md`, `docs/provider-packages.md`, `docs/public-contracts.md`, `docs/index.md`: linked testing subpath.
    - References:
      - `roadmap.md` Phase 11 deliverable: network-free provider conformance harness.
      - Existing no-dependency test strategy in `package.json` and `src/__tests__`.
  - Test Cases Written:
    - `conformance_collects_events_in_order`: validates helper collection.
    - `conformance_fails_missing_done_or_error`: validates terminal event enforcement.
    - `conformance_checks_abort_signal`: validates abort propagation with a mock provider.
    - `conformance_reconstructs_tool_call_deltas`: validates streamed tool-call args.
    - `conformance_checks_cache_usage_fields`: validates cache read/write accounting.
    - `testing_subpath_is_exported`: validates package export.
    - `provider_conformance_docs_cover_testing_subpath_and_no_network`: validates docs coverage.
  - Checks Run:
    - `npm run typecheck`
    - `command npm test`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; adds a public testing subpath and reusable provider behavior expectations.
    - Docs pages to create/edit:
      - `docs/provider-conformance.md`: new API page if separate; otherwise a full section in `docs/provider-packages.md` with API structure.
      - `docs/provider-layer.md`: link conformance helpers from provider event/mock provider docs.
      - `docs/public-contracts.md`: list testing subpath if part of public API inventory.
    - `docs/index.md` update: Yes; add Provider and model connection entry for provider conformance testing.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Verify docs, exports, and Phase 11 boundaries
  - Acceptance Criteria:
    - Functional: All Phase 11 contracts/helpers are exported from documented paths; docs link every new public API and examples compile/typecheck where applicable.
    - Performance: Default test suite remains network-free and under the roadmap target; no new dependency, watcher, worker, provider call, or package scan is introduced.
    - Code Quality: `npm run build`, `npm run typecheck`, `command npm test`, and targeted export/docs checks pass; implementation follows the locked primitive design.
    - Security: Tests prove no resolved credentials are serialized to events/session entries/docs fixtures and no requested provider-specific literals drive core runtime behavior.
  - Approach:
    - Documentation Reviewed:
      - All docs pages touched by prior tasks.
      - `package.json` exports and scripts.
      - `src/index.ts` root barrel and any new subpath exports.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Delay docs/examples to Phase 15: rejected; roadmap says docs ship with APIs and Phase 11 deliverable includes docs updates.
      - Add a heavy API extractor/schema tool: rejected; existing compile/docs tests are enough for this phase.
      - Use existing build/typecheck/test plus small guards: chosen.
    - Chosen Approach:
      - Added final Phase 11 boundary tests for root exports, testing subpath export, docs index navigation, and requested-provider literal guards outside provider adapter/test directories.
      - Ran build/typecheck/tests and package dry-run after implementation.
      - Filled this plan's `Compromises Made` and `Further Actions` after checks passed.
    - API Notes and Examples:
      ```bash
      npm run build
      npm run typecheck
      command npm test
      npm pack --dry-run
      ```
    - Files Edited:
      - `src/__tests__/phase11-boundaries.test.ts`: final export/subpath/docs/provider-literal guards.
      - `plans/014-provider-auth-cache-and-system-prompt-primitives.md`: marked task complete and recorded compromises/follow-ups.
      - Reviewed `src/__tests__/docs.test.ts`, `src/__tests__/public-contracts.test.ts`, `package.json`, and `docs/index.md` coverage from prior tasks.
    - References:
      - `roadmap.md` Phase 11 acceptance.
      - `docs/index.md` navigation map.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases Written:
    - `public_contracts_import_phase_11_exports`: root and subpath import coverage.
    - `docs_index_links_phase_11_pages`: navigation coverage.
    - `docs_have_no_dead_phase_11_links`: covered by existing docs index link checker.
    - `core_runtime_has_no_requested_provider_specific_behavior`: source guard for requested provider-specific literals outside provider adapters/tests.
  - Checks Run:
    - `npm run build`
    - `npm run typecheck`
    - `command npm test`
    - `npm pack --dry-run`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes; finalized docs/export behavior for all Phase 11 public APIs.
    - Docs pages to create/edit:
      - `docs/index.md`: final navigation entries for provider packages, auth/cache policy, system prompts, and provider conformance.
      - `docs/public-contracts.md`: final export inventory.
      - Any Phase 11 docs page whose implementation details changed during execution.
    - `docs/index.md` update: Yes; final consistency check for all new entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Provider conformance checks are assertion helpers, not a full simulator; provider packages still own mocked transports and any opt-in live tests.
- `RunOptions.systemPrompt: false` disables configured layered prompt contributions while preserving `AgentConfig.instructions` as the legacy base path.
- Credential storage remains caller-owned/in-memory helper only; persistent or encrypted stores remain host/package work.
- Core cache policy stays generic request metadata only; provider-specific cache payload mapping remains in provider packages/adapters.

## Further Actions
- Phase 12 should build real provider packages on these primitives for OpenAI/OpenCode Go/OpenRouter/ZAI/Kimi without adding provider-specific literals to core runtime.
- Later provider packages should add opt-in live tests outside the default network-free suite.
- If apps need filesystem-backed prompt layers, implement them in app/package loaders that feed explicit `SystemPromptContribution` values into Prism.
