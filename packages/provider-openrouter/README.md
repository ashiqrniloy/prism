# @arnilo/prism-provider-openrouter

OpenRouter provider package for Prism.

```ts
import { createOpenRouterProviderPackage, defineOpenRouterModel } from "@arnilo/prism-provider-openrouter";

const model = defineOpenRouterModel({
  model: "anthropic/claude-sonnet-4",
  compat: { openRouterRouting: { order: ["anthropic"], data_collection: "deny" } },
});

api.registerProviderPackage(createOpenRouterProviderPackage({
  apiKey: "fake-openrouter-key",
  models: [model],
}));
```

Exports:
- `createOpenRouterProviderPackage()`
- `createOpenRouterProvider()`
- `defineOpenRouterModel()`

Security defaults:
- No catalog fetch during setup.
- No automatic environment, file, keychain, or shell credential lookup.
- API keys are resolved per request from caller-supplied values or resolvers.
- Attribution headers are sent only when `appUrl`/`appTitle` are supplied.

Cache and session behavior:
- `session_id`/`X-Session-Id` are sanitized + clamped to 256 chars from `cacheKey` (or `sessionId`).
- `cache_control` markers apply only to caller-selected `cache.breakpoints` (last block of each selected message), not every block.
- `cacheRetention: "long"` adds `ttl: "1h"` markers when the model allows long retention.
- `Usage.cacheReadTokens`/`cacheWriteTokens` map from `prompt_tokens_details.cached_tokens`/`cache_write_tokens`.
- Provider-owned headers (`authorization`, `content-type`, `x-session-id`, `http-referer`, `x-title`) win over caller headers.
