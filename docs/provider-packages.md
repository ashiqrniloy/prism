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
import { defineProviderPackage } from "prism";

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
import { createSessionCachePolicy } from "prism";

api.registerAuthMethod({ provider: "demo", kind: "api_key", credentialName: "apiKey" });
api.registerAuthMethod({ provider: "demo", kind: "oauth", oauth: demoOAuthProvider });
api.registerProviderRequestPolicy(createSessionCachePolicy({ retention: "short" }));
api.registerSystemPromptContribution({ id: "demo-prompt", source: "package", mode: "append", text: "Use demo provider rules." });
```

Hosts decide which credential resolvers, env objects, OAuth stores, request policies, and prompt contributions become active. Request policies can set generic `ProviderRequest.options` such as `sessionId`, `cacheRetention`, `headers`, retry/timeouts, and opaque `extra`; provider adapters decide how to map those options to provider payloads.

## First-party provider package skeletons

Phase 12 adds explicit npm workspaces for [`@prism/provider-openai`](providers/openai.md), [`@prism/provider-opencode-go`](providers/opencode-go.md), [`@prism/provider-openrouter`](providers/openrouter.md), [`@prism/provider-zai`](providers/zai.md), and [`@prism/provider-kimi`](providers/kimi.md). Each package starts with a side-effect-free `create*ProviderPackage()` export, README, TypeScript build, network-free default tests, and an env-gated live-test placeholder.

These workspaces still follow the same rule as external packages: no provider SDK dependency, catalog fetch, env scan, keychain/file credential lookup, shell auth command, OAuth login, or live provider call runs by default. `@prism/provider-openai` now registers OpenAI Responses and OpenAI Codex providers from caller-supplied credentials only. `@prism/provider-opencode-go` now registers static OpenCode Go metadata and package-local OpenAI/Anthropic-compatible routes from caller-supplied credentials only. `@prism/provider-openrouter` now registers an app-controlled OpenRouter catalog with routing/reasoning/cache passthrough and no setup catalog fetch. `@prism/provider-zai` now registers static GLM metadata with Z.AI thinking/reasoning/tool-stream request mapping. `@prism/provider-kimi` now registers Kimi Coding Anthropic-compatible behavior by default and optional Moonshot metadata only when requested.

## Outputs / response / events

`defineProviderPackage()` returns the same package object or throws when `name` is blank. A package contributes only when a host passes it to an extension/kernel/setup flow and calls `setup()` explicitly.

## Security and performance notes

- Keep resolved credential values out of `ModelConfig`, provider package metadata, docs metadata, auth method metadata, and registries.
- Registration is in-memory only and does no filesystem, network, env, OAuth refresh, or command access.
- Provider-specific behavior belongs in provider packages, not Prism core.

## Related APIs

- [Provider layer](provider-layer.md): provider/model registries and provider events.
- [Provider conformance](provider-conformance.md): reusable network-free checks for provider adapters.
- [Contribution registries](contribution-registries.md): registry bundle and extension contribution points.
- [System prompts](system-prompts.md): composing selected package/app/user/run prompt layers.
- [Credentials and redaction](credentials-and-redaction.md): host-owned credential helpers.
- [Public contracts](public-contracts.md): public type inventory.
