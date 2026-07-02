# @arnilo/prism-provider-opencode-go

OpenCode Go provider package for Prism.

```ts
import { createOpenCodeGoProviderPackage } from "@arnilo/prism-provider-opencode-go";

api.registerProviderPackage(createOpenCodeGoProviderPackage({ apiKey: "fake-opencode-key" }));
```

Exports:
- `createOpenCodeGoProviderPackage()`
- `createOpenCodeGoProvider()`
- `openCodeGoModels`

Security defaults:
- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- API keys are resolved per request from caller-supplied values or resolvers.
- Live tests must stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1` plus fake-safe provider-specific env names.

Cache and session behavior:
- `x-opencode-session` from `cacheKey ?? sessionId`, sanitized + clamped to 128 chars.
- Anthropic route applies `cache_control` markers only to caller-selected `cache.breakpoints` (last block of each selected message); `"long"` adds `ttl: "1h"`.
- OpenAI route sends no Anthropic `cache_control` fields.
- OpenAI route maps `prompt_tokens_details.cached_tokens`/`cache_write_tokens`; Anthropic route maps `cache_read_input_tokens`/`cache_creation_input_tokens`.
- Provider-owned headers (`content-type`, `x-opencode-session`, `authorization`) win over caller headers.
