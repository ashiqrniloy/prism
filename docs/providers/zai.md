# Z.AI provider package

`@prism/provider-zai` provides explicit, side-effect-free setup for Z.AI GLM Chat Completions.

```ts
import { createZaiProviderPackage } from "@prism/provider-zai";

api.registerProviderPackage(createZaiProviderPackage({ apiKey: "fake-zai-key" }));
```

Behavior:
- Registers one API-key provider and static GLM model metadata by default.
- Uses OpenAI-compatible `POST /chat/completions` under the configured Z.AI base URL.
- Maps model/request compat to `thinking`, `reasoning_effort`, and `tool_stream`.
- Keeps developer-style instructions as `system` messages because Z.AI does not need a developer role.
- Emits Prism text, thinking, tool-call delta/final, usage, done, and redacted error events.

Use `createZaiProviderPackage({ id, baseUrl, models })` for CN/private endpoints or custom model metadata. Credentials are caller-owned and resolved per request. Default tests are mocked and network-free; live tests stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1`.
