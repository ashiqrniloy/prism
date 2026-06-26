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

Hosts decide which credential resolvers, env objects, OAuth stores, request policies, and prompt contributions become active. Request policies can set generic `ProviderRequest.options` such as `sessionId`, `cacheRetention`, `headers`, retry/timeouts, and opaque `extra`; provider adapters decide how to map those options to provider payloads.

## First-party provider package skeletons

Phase 12 adds explicit npm workspaces for [`@arnilo/prism-provider-openai`](providers/openai.md), [`@arnilo/prism-provider-opencode-go`](providers/opencode-go.md), [`@arnilo/prism-provider-openrouter`](providers/openrouter.md), [`@arnilo/prism-provider-zai`](providers/zai.md), and [`@arnilo/prism-provider-kimi`](providers/kimi.md). Each package starts with a side-effect-free `create*ProviderPackage()` export, README, TypeScript build, network-free default tests, and an env-gated live-test placeholder.

These workspaces still follow the same rule as external packages: no provider SDK dependency, catalog fetch, env scan, keychain/file credential lookup, shell auth command, OAuth login, or live provider call runs by default. `@arnilo/prism-provider-openai` now registers OpenAI Responses and OpenAI Codex providers from caller-supplied credentials only. `@arnilo/prism-provider-opencode-go` now registers static OpenCode Go metadata and package-local OpenAI/Anthropic-compatible routes from caller-supplied credentials only. `@arnilo/prism-provider-openrouter` now registers an app-controlled OpenRouter catalog with routing/reasoning/cache passthrough and no setup catalog fetch. `@arnilo/prism-provider-zai` now registers static GLM metadata with Z.AI thinking/reasoning/tool-stream request mapping. `@arnilo/prism-provider-kimi` now registers Kimi Coding Anthropic-compatible behavior by default and optional Moonshot metadata only when requested.

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

Provider package manifest contribution and the generic request options a provider request policy can set:

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
  }
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
