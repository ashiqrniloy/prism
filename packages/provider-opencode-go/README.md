# @arnilo/prism-provider-opencode-go

OpenCode Go provider package for Prism ([official docs](https://opencode.ai/docs/go/)).

```ts
import {
  createOpenCodeGoProviderPackage,
  listOpenCodeGoModels,
} from "@arnilo/prism-provider-opencode-go";

api.registerProviderPackage(createOpenCodeGoProviderPackage({ apiKey: "fake-opencode-key" }));

const live = await listOpenCodeGoModels({ apiKey: "fake-opencode-key" });
api.registerProviderPackage(createOpenCodeGoProviderPackage({ apiKey: "fake-opencode-key", models: live }));
```

Exports:
- `createOpenCodeGoProviderPackage()` / `createOpenCodeGoProvider()`
- `openCodeGoModels` (docs-verified featured aliases)
- `listOpenCodeGoModels()` / `mapOpenCodeGoModel()` / `defineOpenCodeGoModel()` / `routeForOpenCodeGoModel()`
- `OPENCODE_GO_DEFAULT_BASE_URL` (`https://opencode.ai/zen/go/v1`)
- Thinking helpers: `openCodeGoThinking`, `openCodeGoReasoningEffort`, `openCodeGoReasoning`, `openCodeGoPreserveThinking`, `stripOpenCodeGoOwnedCompat`
- Cache helpers: `opencodeSessionId`, `opencodeOwnedHeaders`, `applyOpencodeAnthropicCacheControl`

Security defaults:
- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- API keys are resolved per request from caller-supplied values or resolvers and redacted from errors (including discovery).
- Live tests must stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1` plus `OPENCODE_API_KEY`.

Cache, session, thinking:
- Default base URL: `https://opencode.ai/zen/go/v1` (Chat Completions + Anthropic Messages + `/models`).
- `x-opencode-session` from `cacheKey ?? sessionId`, sanitized + clamped to 128 chars.
- Anthropic route (`minimax-*`, `qwen*`) applies `cache_control` only to selected breakpoints (`"long"` → `ttl: "1h"`).
- OpenAI route (Grok/GLM/Kimi/MiMo/DeepSeek) sends no Anthropic `cache_control`; implicit cache + `reasoning_content` preserve.
- Per-route usage mapping unchanged.
- Provider-owned headers (`content-type`, `x-opencode-session`, `authorization`) win over caller headers.
