# @prism/provider-openrouter

OpenRouter provider package for Prism.

```ts
import { createOpenRouterProviderPackage, defineOpenRouterModel } from "@prism/provider-openrouter";

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
