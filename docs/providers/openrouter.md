# OpenRouter provider package

`@prism/provider-openrouter` provides explicit, side-effect-free setup for OpenRouter Chat Completions.

```ts
import { createOpenRouterProviderPackage, defineOpenRouterModel } from "@prism/provider-openrouter";

const model = defineOpenRouterModel({
  model: "anthropic/claude-sonnet-4",
  compat: {
    openRouterRouting: { order: ["anthropic"], data_collection: "deny" },
    openRouterCache: true,
    reasoning: { effort: "medium" },
  },
});

api.registerProviderPackage(createOpenRouterProviderPackage({
  apiKey: "fake-openrouter-key",
  models: [model],
}));
```

Behavior:
- Registers one `openrouter` API-key provider and only the models passed in `options.models`.
- Does not fetch the OpenRouter model catalog at setup.
- Passes `model.compat.openRouterRouting` to the request `provider` field.
- Passes `model.compat.reasoning` or `ProviderRequest.options.compat.reasoning` to `reasoning`.
- Maps `sessionId`/`cacheKey` to `session_id` and `x-session-id`.
- Adds `cache_control: { type: "ephemeral" }` only when `model.compat.openRouterCache` is `true` and cache retention is not `none`.
- Sends attribution headers only when `appUrl` or `appTitle` are supplied.

Credentials are caller-owned and resolved per request. Default tests are mocked and network-free; live tests stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1`.
