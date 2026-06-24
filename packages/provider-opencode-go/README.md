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
