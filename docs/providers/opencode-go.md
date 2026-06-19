# OpenCode Go provider package

`@prism/provider-opencode-go` provides explicit, side-effect-free provider setup for OpenCode Go models.

```ts
import { createEnvCredentialResolver } from "prism";
import { createOpenCodeGoProviderPackage } from "@prism/provider-opencode-go";

api.registerProviderPackage(createOpenCodeGoProviderPackage({
  apiKey: createEnvCredentialResolver({ OPENCODE_API_KEY: "fake" }, { "opencode-go": "OPENCODE_API_KEY" }),
}));
```

Exports:
- `createOpenCodeGoProviderPackage(options)`
- `createOpenCodeGoProvider(options)`
- `openCodeGoModels`

Behavior:
- Package setup registers static OpenCode Go model metadata and one API-key auth method.
- Model `compat.route` selects the package-local OpenAI-compatible or Anthropic-compatible stream mapper.
- `ProviderRequest.options.sessionId` maps to `x-opencode-session` after a conservative header-safe cleanup.
- Credentials are resolved per request from caller-supplied values/resolvers only.

Default tests are mocked and network-free. Live tests stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1` and fake-safe provider-specific env names.
