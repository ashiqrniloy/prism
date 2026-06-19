# @prism/provider-openai

OpenAI provider package for Prism.

```ts
import { createOpenAIProviderPackage } from "@prism/provider-openai";

api.registerProviderPackage(createOpenAIProviderPackage({ apiKey: "fake-openai-key" }));
```

Exports:
- `createOpenAIProviderPackage()`
- `createOpenAIResponsesProvider()`
- `createOpenAICodexProvider()`
- `openAIModels`, `openAICodexModels`
- `createOpenAICodexOAuthProvider()`, `openAICodexOAuthProvider`

Security defaults:
- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- API keys/access tokens are resolved per request from caller-supplied values or resolvers.
- Live tests must stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1` plus fake-safe provider-specific env names.
