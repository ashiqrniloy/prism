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
- Adds `cache_control: { type: "ephemeral" }` to every message content item when `model.compat.openRouterCache` is `true` and cache retention is not `none`.
- The serializer preserves text, thinking (downgraded to text), assistant `tool_call` blocks as `tool_calls`, `tool_result` blocks as role `tool` messages, and image blocks when `capabilities.input` includes `"image"`. Unsupported block placements or unclaimed images fail before fetch.
- Sends attribution headers only when `appUrl` or `appTitle` are supplied.

Credentials are caller-owned and resolved per request. Default tests are mocked and network-free; live tests stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1`.
