# @arnilo/prism-provider-openrouter

OpenRouter provider package for Prism — app-controlled model registration with
optional caller-gated discovery, official `reasoning` merge, and
`cache_control` / sticky `session_id` caching.

```ts
import {
  createOpenRouterProviderPackage,
  defineOpenRouterModel,
  listOpenRouterModels,
} from "@arnilo/prism-provider-openrouter";

const model = defineOpenRouterModel({
  model: "anthropic/claude-sonnet-4",
  compat: {
    openRouterRouting: { order: ["anthropic"], data_collection: "deny" },
    openRouterCache: true,
    reasoning: { effort: "medium" },
  },
});

// Optional: fetch live catalog, then register a filtered subset (setup never fetches).
const live = await listOpenRouterModels({ apiKey: "fake-openrouter-key" });

api.registerProviderPackage(createOpenRouterProviderPackage({
  apiKey: "fake-openrouter-key",
  models: live.filter((m) => m.model.startsWith("anthropic/")).length
    ? live.filter((m) => m.model.startsWith("anthropic/"))
    : [model],
}));
```

Exports:
- `createOpenRouterProviderPackage()` / `createOpenRouterProvider()`
- `defineOpenRouterModel()` / `listOpenRouterModels()` / `mapOpenRouterModel()`
- `resolveOpenRouterReasoning()` / `openRouterPreserveThinking()` / cache helpers

Security defaults:
- No catalog fetch during setup; discovery is caller-gated.
- No automatic environment, file, keychain, or shell credential lookup.
- API keys are resolved per request from caller-supplied values or resolvers and redacted from errors.
- Attribution headers are sent only when `appUrl`/`appTitle` are supplied.

Cache / reasoning / discovery:
- `session_id`/`X-Session-Id` are sanitized + clamped to 256 chars from `cacheKey` (or `sessionId`) for sticky routing.
- With no breakpoints, explicit cache models get top-level automatic `cache_control: { type: "ephemeral" }`.
- With `cache.breakpoints`, markers apply only to selected messages (last block); top-level automatic control is omitted.
- `cacheRetention: "long"` adds `ttl: "1h"` when the model allows long retention.
- `Usage.cacheReadTokens`/`cacheWriteTokens` map from `prompt_tokens_details.cached_tokens`/`cache_write_tokens`.
- Model + per-turn `compat.reasoning` merge (request wins); thinking blocks replay as `reasoning` when `preserveThinking`.
- Provider-owned headers (`authorization`, `content-type`, `x-session-id`, `http-referer`, `x-title`) win over caller headers.
