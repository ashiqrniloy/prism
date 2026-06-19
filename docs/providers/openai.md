# OpenAI provider package

`@prism/provider-openai` provides explicit, side-effect-free provider setup for OpenAI Responses API and OpenAI Codex OAuth-backed Responses usage.

```ts
import { createEnvCredentialResolver } from "prism";
import { createOpenAIProviderPackage } from "@prism/provider-openai";

api.registerProviderPackage(createOpenAIProviderPackage({
  apiKey: createEnvCredentialResolver({ OPENAI_API_KEY: "fake" }, { openai: "OPENAI_API_KEY" }),
}));
```

Exports:
- `createOpenAIProviderPackage(options)`
- `createOpenAIResponsesProvider(options)`
- `createOpenAICodexProvider(options)`
- `openAIModels`, `openAICodexModels`
- `createOpenAICodexOAuthProvider(options)`, `openAICodexOAuthProvider`

Behavior:
- No package import, setup, build, or default test performs a live network call.
- Credentials are resolved per request from caller-supplied values/resolvers only.
- `ProviderRequest.options.sessionId`, `cacheKey`, `cacheRetention`, `headers`, `compat`, and `extra` map to request headers/payload fields.
- OAuth browser/device-code flows only run when the caller explicitly invokes the OAuth provider.

Live tests stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1` and fake-safe provider-specific env names.
