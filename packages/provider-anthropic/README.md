# @arnilo/prism-provider-anthropic

Native Anthropic Messages (`/v1/messages`) provider for Prism. No vendor SDK.

```ts
import { createAnthropicProviderPackage, listAnthropicModels } from "@arnilo/prism-provider-anthropic";

api.registerProviderPackage(createAnthropicProviderPackage({ apiKey: "fake-anthropic-key" }));

// Caller-gated discovery (never during setup)
const models = await listAnthropicModels({ apiKey: "fake-anthropic-key" });
api.registerProviderPackage(createAnthropicProviderPackage({ apiKey: "fake-anthropic-key", models }));
```

Exports:
- `createAnthropicProviderPackage()`
- `createAnthropicMessagesProvider()`
- `listAnthropicModels()` / `mapAnthropicModel()` / `defineAnthropicModel()`
- `anthropicModels` (featured offline aliases)
- `anthropicThinking` / `anthropicEffort` / `anthropicPreserveThinking`
- `applyAnthropicCacheControl` / `anthropicCacheEnabled`

Security defaults:
- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- Credentials are resolved per request from caller-supplied values or resolvers.
- Provider-owned headers (`content-type`, `x-api-key`, `anthropic-version`) win over caller headers.
- Live tests stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1` + `ANTHROPIC_API_KEY`.

Featured models (offline bootstrap): `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`, `claude-fable-5`.

Cache: featured models use `cache.kind: "cache_control"`; markers apply only to selected `cache.breakpoints` (`"long"` → `ttl: "1h"`).

Docs: [`docs/providers/anthropic.md`](../../docs/providers/anthropic.md)
