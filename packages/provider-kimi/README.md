# @arnilo/prism-provider-kimi

Kimi provider package for Prism.

```ts
import { createKimiProviderPackage } from "@arnilo/prism-provider-kimi";

api.registerProviderPackage(createKimiProviderPackage({ kimiApiKey: "fake-kimi-key" }));
```

Exports:
- `createKimiProviderPackage()`
- `createKimiCodingProvider()`
- `kimiCodingModels`
- `moonshotKimiModels`
- `defineKimiModel()`

Security defaults:
- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- Kimi credentials are resolved per request from caller-supplied values or resolvers.
- Moonshot/Open Platform model metadata is registered only with `includeMoonshotModels: true`.

Cache behavior:
- Default catalog models use implicit caching (no `cache_control`); opt in via `ModelConfig.cache.kind: "cache_control"` on the Anthropic route.
- When opted in, `cache_control` markers apply only to selected `cache.breakpoints` (`"long"` → `ttl: "1h"`); Moonshot OpenAI route sends none.
- `cache_read_input_tokens`/`cache_creation_input_tokens` map to `Usage.cacheReadTokens`/`cacheWriteTokens`.
- Provider-owned headers (`content-type`, `user-agent`, `authorization`) win over caller headers.
