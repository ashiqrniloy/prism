# @arnilo/prism-provider-openai

OpenAI provider package for Prism.

```ts
import { createOpenAIProviderPackage, listOpenAIModels } from "@arnilo/prism-provider-openai";

const models = await listOpenAIModels({ apiKey: "fake-openai-key" });
api.registerProviderPackage(createOpenAIProviderPackage({ apiKey: "fake-openai-key", models }));
```

Exports:
- `createOpenAIProviderPackage({ models?, codexModels?, ... })`
- `createOpenAIResponsesProvider()`
- `createOpenAICodexProvider()`
- `listOpenAIModels()`, `mapOpenAIModel()`, `defineOpenAIModel()`
- `openAIModels`, `openAICodexModels`
- `createOpenAICodexOAuthProvider()`, `openAICodexOAuthProvider`

Security defaults:
- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- API keys/access tokens are resolved per request from caller-supplied values or resolvers.
- Discovery errors redact API keys via `readBoundedResponseText` + `redactSecrets`.
- Codex OAuth device-code login polls with server `interval`/`expires_in`, honors `slow_down`, and accepts `OAuthLoginCallbacks.signal` for abort.
- Live tests must stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1` plus fake-safe provider-specific env names.

Cache / reasoning / discovery:
- `prompt_cache_key` is sanitized + clamped to 64 chars from `cacheKey` (or `sessionId`).
- `prompt_cache_retention` only emits `"24h"` for `cacheRetention: "long"` when the model declares `cache.longRetention`; `"short"`/`"none"` omit the field.
- `Usage.cacheReadTokens` is mapped from OpenAI `input_tokens_details.cached_tokens`.
- `reasoning` merges model + per-turn `compat.reasoning` (official Responses shape).
- `listOpenAIModels` is caller-gated; setup never fetches.
- Provider-owned headers (`content-type`, `authorization`, `x-client-request-id`) win over caller headers.
