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
