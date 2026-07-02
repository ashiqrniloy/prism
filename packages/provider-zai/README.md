# @arnilo/prism-provider-zai

Z.AI GLM provider package for Prism.

```ts
import { createZaiProviderPackage } from "@arnilo/prism-provider-zai";

api.registerProviderPackage(createZaiProviderPackage({ apiKey: "fake-zai-key" }));
```

Exports:
- `createZaiProviderPackage()`
- `createZaiProvider()`
- `defineZaiModel()`
- `zaiModels`

Security defaults:
- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- API keys are resolved per request from caller-supplied values or resolvers.

Cache behavior:
- `kind: "implicit"` — GLM context caching is automatic; no explicit cache payload sent regardless of cache options.
- `prompt_tokens_details.cached_tokens`/`cache_write_tokens` map to `Usage.cacheReadTokens`/`cacheWriteTokens`.
- Provider-owned headers (`content-type`, `authorization`) win over caller headers.
