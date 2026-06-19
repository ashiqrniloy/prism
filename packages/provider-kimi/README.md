# @prism/provider-kimi

Kimi provider package for Prism.

```ts
import { createKimiProviderPackage } from "@prism/provider-kimi";

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
