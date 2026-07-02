# Provider packages

## What it does

Provider package primitives let a host or extension register provider-related contributions explicitly:

- `defineProviderPackage()`: validates and returns an inert provider package definition.
- `ProviderPackage`: package metadata plus a `setup(api)` callback.
- `ModelConfig` metadata: `displayName`, `capabilities`, `limits`, `cost`, opaque `compat`, and `metadata`.
- New contribution registries and `ExtensionAPI` methods for provider packages, auth methods, provider request policies, and system prompt contributions.
- Auth method descriptors for API-key, OAuth, and custom provider auth flows.

These primitives do not load packages, discover manifests, read credentials, refresh OAuth tokens, or call providers.

## When to use it

Use provider packages when a host wants to bundle model metadata, provider adapters, auth descriptors, cache/request policies, or prompt contributions behind one explicit setup call.

Do not use provider packages as a package manager, credential store, env loader, provider-specific cache implementation, or live integration runner.

## Inputs / request

```ts
import { defineProviderPackage } from "@arnilo/prism";

export default defineProviderPackage({
  name: "demo-provider",
  setup(api) {
    api.registerProvider(provider);
    api.registerModel({
      provider: "demo",
      model: "demo-large",
      displayName: "Demo Large",
      capabilities: { input: ["text"], reasoning: true, tools: true },
      limits: { contextWindow: 128_000, maxOutputTokens: 8_192 },
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, currency: "USD" },
      compat: { vendorSpecific: true },
    });
  },
});
```

`compat` is provider-owned inert JSON. Core does not branch on provider names or interpret vendor-specific fields.

Provider packages can also contribute auth descriptors and request policies without resolving credentials:

```ts
import { createSessionCachePolicy } from "@arnilo/prism";

api.registerAuthMethod({ provider: "demo", kind: "api_key", credentialName: "apiKey" });
api.registerAuthMethod({ provider: "demo", kind: "oauth", oauth: demoOAuthProvider });
api.registerProviderRequestPolicy(createSessionCachePolicy({ retention: "short" }));
api.registerSystemPromptContribution({ id: "demo-prompt", source: "package", mode: "append", text: "Use demo provider rules." });
```

Hosts decide which credential resolvers, env objects, OAuth stores, request policies, and prompt contributions become active. Request policies can set generic `ProviderRequest.options` such as `sessionId`, `cacheRetention`, `headers`, `compat`, and opaque `extra`; provider adapters decide how to map those options to provider payloads. Caller headers are extension headers only: provider adapters must apply provider-owned headers (auth, content type, session/cache/security, attribution) after caller headers so requests cannot override credentials or provider policy.

Deprecated provider request options: `timeoutMs`, `maxRetries`, and `maxRetryDelayMs` are inert in first-party providers. Use `RunOptions.signal`/host abort controllers for timeouts and `AgentConfig.retry`/`RunOptions.retry` for retry. Provider packages should not add provider-specific retry loops unless the vendor protocol requires it and runtime retry cannot cover the failure mode.

First-party providers map generic `ModelConfig.parameters.maxTokens` to real output-token request fields instead of sending `maxTokens` on the wire: OpenAI Responses uses `max_output_tokens`; OpenRouter, OpenCode Go OpenAI-compatible, OpenCode Go Anthropic-style, Z.AI, Kimi, and NeuralWatt use `max_tokens`. Other `model.parameters` values pass through unchanged unless the provider docs say otherwise.

## First-party provider package skeletons

Phase 12 adds explicit npm workspaces for [`@arnilo/prism-provider-openai`](providers/openai.md), [`@arnilo/prism-provider-opencode-go`](providers/opencode-go.md), [`@arnilo/prism-provider-openrouter`](providers/openrouter.md), [`@arnilo/prism-provider-zai`](providers/zai.md), [`@arnilo/prism-provider-kimi`](providers/kimi.md), and [`@arnilo/prism-provider-neuralwatt`](providers/neuralwatt.md). Each package starts with a side-effect-free `create*ProviderPackage()` export, README, TypeScript build, network-free default tests, and an env-gated live-test placeholder.

These workspaces still follow the same rule as external packages: no provider SDK dependency, catalog fetch, env scan, keychain/file credential lookup, shell auth command, OAuth login, or live provider call runs by default. `@arnilo/prism-provider-openai` now registers OpenAI Responses and OpenAI Codex providers from caller-supplied credentials only. `@arnilo/prism-provider-opencode-go` now registers static OpenCode Go metadata and package-local OpenAI/Anthropic-compatible routes from caller-supplied credentials only. `@arnilo/prism-provider-openrouter` now registers an app-controlled OpenRouter catalog with routing/reasoning/cache passthrough and no setup catalog fetch. `@arnilo/prism-provider-zai` now registers static GLM metadata with Z.AI thinking/reasoning/tool-stream request mapping. `@arnilo/prism-provider-kimi` now registers Kimi Coding Anthropic-compatible behavior by default and optional Moonshot metadata only when requested. `@arnilo/prism-provider-neuralwatt` now registers static featured model metadata with NeuralWatt reasoning_effort/thinking_token_budget/chat_template_kwargs request mapping, SSE comment tolerance, an opt-in `listNeuralWattModels()` helper for explicit `/v1/models` discovery, `getNeuralWattQuota()` for on-demand account balance/usage/energy, `neuralWattEventsWithTelemetry()`/`mapNeuralWattTelemetry()` for `: energy`/`: cost` telemetry, and `classifyNeuralWattError()` for retry classification. None of these helpers run during package setup or generation.

### First-party cache behavior

Every first-party provider package hardens prompt-cache behavior so it cannot emit invalid cache retention values or over-broad cache-control markers, and so provider-owned `authorization`/session/security headers cannot be overridden by caller `ProviderRequest.options.headers`:

- **OpenAI** (`kind: openai_key`): `prompt_cache_key` is sanitized and clamped to 64 chars; `prompt_cache_retention` is emitted as `24h` only when the model declares `cache.longRetention`, and omitted for `short`/`none` (the API only accepts absent or `24h`). `prompt_tokens_details.cached_tokens` maps to `Usage.cacheReadTokens`.
- **OpenAI-compatible core adapter**: Chat Completions sends no `prompt_cache_key`/`prompt_cache_retention`/`cache_control` fields; endpoints cache implicitly. `prompt_tokens_details.cached_tokens` maps to `Usage.cacheReadTokens`.
- **OpenRouter** (`kind: cache_control`): `session_id`/`x-session-id` sanitized and clamped to 256 chars; `cache_control` markers applied only to caller-selected `cache.breakpoints` (not every block); `cacheRetention: long` adds `ttl: 1h` when allowed. Preserves `cached_tokens`/`cache_write_tokens`.
- **OpenCode Go**: `x-opencode-session` from `cacheKey ?? sessionId` sanitized to 128 chars; the Anthropic route applies `cache_control` only to selected breakpoints (`long` → `ttl: 1h`), the OpenAI route sends none. Per-route usage mapping.
- **Z.AI** (`kind: implicit`): GLM context caching is automatic; no explicit cache payload sent regardless of cache options. `prompt_tokens_details.cached_tokens`/`cache_write_tokens` map to cache usage.
- **NeuralWatt** (`kind: implicit`): NeuralWatt prefix caching is automatic; sends no explicit cache payload regardless of cache options. `cacheRetention: "none"` disables Prism cache-control hints only (not the implicit backend prefix cache). `prompt_tokens_details.cached_tokens` maps to `Usage.cacheReadTokens`; NeuralWatt does not report a cache-write token so `Usage.cacheWriteTokens` is never fabricated.
- **Kimi**: default catalog models use implicit caching (no `cache_control`); hosts opt in via `ModelConfig.cache.kind: cache_control` on the Anthropic `/messages` route, then markers apply only to selected breakpoints (`long` → `ttl: 1h`); the Moonshot OpenAI route sends none. `cache_read_input_tokens`/`cache_creation_input_tokens` map to cache usage.

See [Provider caching](provider-caching.md) for the `PromptCacheHints` surface and shared helpers, and [Provider conformance](provider-conformance.md) for the `assertUsageAccounting` and `assertProviderOwnedHeadersWin` checks every first-party package exercises.

## Third-party provider packaging

A third party ships their own providers the same way Prism ships first-party
provider packages: an `Extension` whose `setup(api)` calls
`api.registerProvider(provider)` for each provider it owns. First-party
provider packages (`@arnilo/prism-provider-openai`, `@arnilo/prism-provider-openrouter`,
`@arnilo/prism-provider-kimi`, `@arnilo/prism-provider-zai`,
`@arnilo/prism-provider-opencode-go`) are **opt-in and individually installable**;
`@arnilo/prism` core runs without any first-party provider package (mock-only).

A host mixes first-party packages and third-party providers in one resolver.
The host owns the resolver — declaring a provider does not activate it:

```ts
import { createExtensionKernel, createProviderResolver, createAgent } from "@arnilo/prism";
import { createOpenAIProviderPackage } from "@arnilo/prism-provider-openai";

// First-party package, inert until loaded.
const kernel = createExtensionKernel();
await kernel.load([createOpenAIProviderPackage({ apiKey: () => process.env.OPENAI_API_KEY })]);

// Third-party own provider (bring your own adapter). Combined with first-party
// providers in one resolver passed to the agent as `providerSource`.
const own = createMyProvider(/* credentials */);
const providerSource = createProviderResolver([...kernel.registries.providers.list(), own]);

const agent = createAgent({ model: { provider: own.id, model: "demo" }, providerSource });
```

The resolver is the selection mechanism: `model.provider` selects which
provider runs per turn. Hosts can build the resolver from a `ProviderRegistry`,
a plain `AIProvider[]`, or implement `ProviderResolver` directly as a one-line
function over their own map (lazy construction, per-request routing). Declaring
a provider grants no permissions and forces no activation; the host always has
final say. See [Provider layer § Provider resolver](provider-layer.md#provider-resolver)
for the resolver contract.

## Outputs / response / events

`defineProviderPackage()` returns the same package object or throws when `name` is blank. A package contributes only when a host passes it to an extension/kernel/setup flow and calls `setup()` explicitly.

## Request/response example

Provider package manifest contribution and the generic request options a provider request policy can set (see [Provider request policies](provider-request-policies.md) and [Provider caching](provider-caching.md)):

```json
{
  "manifest": {
    "name": "demo-provider-manifest",
    "contributions": [
      { "kind": "providerPackage", "name": "demo-provider" },
      { "kind": "providerRequestPolicy", "name": "demo.cache" }
    ]
  },
  "providerRequest.options": {
    "sessionId": "sess_123",
    "cacheKey": "demo",
    "cacheRetention": "short",
    "headers": { "x-demo": "1" }
  },
  "runOptions.retry": { "maxAttempts": 3, "maxDelayMs": 1000 }
}
```

## Implementation example

Wire a provider package with model metadata plus a session cache policy through the extension kernel:

```ts
import { createExtensionKernel, defineProviderPackage, createSessionCachePolicy } from "@arnilo/prism";

const pkg = defineProviderPackage({
  name: "demo-provider",
  setup(api) {
    api.registerProvider(/* host-owned AIProvider */ null as never);
    api.registerModel({
      provider: "demo",
      model: "demo-large",
      displayName: "Demo Large",
      capabilities: { input: ["text"], reasoning: true, tools: true },
      limits: { contextWindow: 128_000, maxOutputTokens: 8_192 },
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, currency: "USD" },
      compat: { vendorSpecific: true },
    });
    api.registerProviderRequestPolicy(createSessionCachePolicy({ retention: "short" }));
  },
});

const kernel = createExtensionKernel();
await kernel.load([pkg]);
```

## Extension and configuration notes

- Hosts decide which credential resolvers, env objects, OAuth stores, request
  policies, and prompt contributions become active; the package only *declares*
  them.
- `createSessionCachePolicy()` acts as a concrete cache policy hook
  (`provider_request`) that sets generic `ProviderRequest.options`
  (`sessionId`, `cacheKey`, `cacheRetention`, `headers`, opaque `extra`) before
  `AIProvider.generate()`; provider adapters map those options to provider payloads.
- `ModelConfig.cache` is the generic cache capability metadata documented in [Model registry](model-registry.md); `ModelConfig.compat` remains provider-owned inert JSON for behavior that has no generic field yet.
- `ModelConfig.compat` is provider-owned inert JSON: cache policy overrides,
  reasoning/thinking formats, and provider-specific usage mapping live there
  rather than in core, so Prism never branches on provider names.
- A package contributes auth methods and request policies without resolving
  credentials; OAuth/api-key resolution runs only when the host wires the
  matching credential resolver.
- Packages can also be declared as inert manifest contributions and resolved
  later through registries (see the Manifest declarations section below).

## Security and performance notes

- Keep resolved credential values out of `ModelConfig`, provider package metadata, docs metadata, auth method metadata, and registries.
- Registration is in-memory only and does no filesystem, network, env, OAuth refresh, or command access.
- Provider-specific behavior belongs in provider packages, not Prism core.
- Adapter serializers should preserve Prism content blocks (text, thinking, tool_call, tool_result, and image when the model declares image input) in provider-native request shape, or fail explicitly when a block is unsupported.
- Adapter header merging must put caller-supplied `ProviderRequest.options.headers` first and provider-owned headers last. Caller headers may add non-owned headers, but cannot replace resolved credentials, content type, session/cache/security headers, or provider attribution headers.

## Manifest declarations

Provider packages, auth methods, provider request policies, and system prompt contributions can also be declared in data-only Prism manifests:

```ts
import { definePrismManifest } from "@arnilo/prism";

export default definePrismManifest({
  name: "demo-provider-manifest",
  contributions: [
    { kind: "providerPackage", name: "demo-provider" },
    { kind: "authMethod", name: "demo.api-key", metadata: { credentialName: "apiKey" } },
    { kind: "providerRequestPolicy", name: "demo.cache" },
    { kind: "systemPromptContribution", name: "demo.prompt" },
  ],
});
```

Manifest declarations are inert. The host must later resolve them through registries or extension setup and make explicit trust decisions before activating any package, auth flow, request policy, or prompt contribution.

## Related APIs

- [Provider layer](provider-layer.md): provider/model registries and provider events.
- [Provider conformance](provider-conformance.md): reusable network-free checks for provider adapters.
- [Contribution registries](contribution-registries.md): registry bundle and extension contribution points.
- [Configuration and manifests](configuration-and-manifests.md): data-only manifest `kind` values.
- [System prompts](system-prompts.md): composing selected package/app/user/run prompt layers.
- [Credentials and redaction](credentials-and-redaction.md): host-owned credential helpers.
- [Public contracts](public-contracts.md): public type inventory.
