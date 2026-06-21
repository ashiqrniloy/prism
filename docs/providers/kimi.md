# Kimi provider package

`@prism/provider-kimi` provides explicit, side-effect-free setup for Kimi For Coding.

```ts
import { createKimiProviderPackage } from "@prism/provider-kimi";

api.registerProviderPackage(createKimiProviderPackage({
  kimiApiKey: "fake-kimi-key",
  includeMoonshotModels: false,
}));
```

Behavior:
- Registers the `kimi-coding` Anthropic-compatible provider and Kimi Coding model metadata by default.
- Sends requests to `/messages` under the configured Kimi base URL with `User-Agent: KimiCLI/1.5` unless overridden.
- Emits Prism text, thinking, tool-call delta/final, usage, done, and redacted error events.
- The serializer preserves text, thinking (preserved only when `model.compat.preserveThinking` is true, otherwise downgraded to text), assistant `tool_call` blocks as `tool_use`, `tool_result` blocks as `tool_result`, and image blocks when `capabilities.input` includes `"image"`. Unsupported block placements or unclaimed images fail before fetch.
- Keeps Moonshot/Kimi Open Platform metadata optional via `includeMoonshotModels: true`; it is not registered by default.
- Performs no env scanning, keychain/file lookup, shell auth command, catalog fetch, or live provider call during setup/tests.

Credentials are caller-owned and resolved per request. Default tests are mocked and network-free; live tests stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1`.
