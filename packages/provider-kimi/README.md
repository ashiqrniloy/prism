# @arnilo/prism-provider-kimi

Kimi For Coding (Anthropic `/messages`) + optional Moonshot Open Platform (Chat Completions) for Prism.

```ts
import { createKimiProviderPackage, listKimiModels } from "@arnilo/prism-provider-kimi";

api.registerProviderPackage(createKimiProviderPackage({ kimiApiKey: "fake-kimi-key" }));

// Opt-in callable Moonshot + featured Open Platform models
api.registerProviderPackage(createKimiProviderPackage({
  kimiApiKey: "fake-kimi-key",
  includeMoonshotModels: true,
  moonshotApiKey: "fake-moonshot-key",
}));

// Caller-gated discovery (never during setup)
const models = await listKimiModels({ apiKey: "fake-moonshot-key" });
```

Exports:
- `createKimiProviderPackage()`
- `createKimiCodingProvider()` / `createMoonshotProvider()`
- `listKimiModels()` / `mapKimiModel()` / `defineKimiModel()`
- `kimiCodingModels` / `moonshotKimiModels`
- `kimiThinking` / `kimiReasoningEffort` / `kimiPreserveThinking`

Security defaults:
- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- Credentials are resolved per request from caller-supplied values or resolvers.
- Moonshot Open Platform is registered only with `includeMoonshotModels: true`.

Official model ids:
- Coding featured: `kimi-for-coding`, `kimi-for-coding-highspeed`, `k3` (not Pi `k2p7`).
- Open Platform featured: `kimi-k2.7-code`, `kimi-k3` (+ `listKimiModels()`).

Cache behavior:
- Default Coding models use implicit caching (no `cache_control`); opt in via `ModelConfig.cache.kind: "cache_control"`.
- When opted in, markers apply only to selected `cache.breakpoints` (`"long"` → `ttl: "1h"`).
- Moonshot never sends Anthropic `cache_control`.
- Coding `cache_read_input_tokens`/`cache_creation_input_tokens` map to `Usage.cacheReadTokens`/`cacheWriteTokens`.
- Provider-owned headers (`content-type`, `user-agent`, `authorization`) win over caller headers.

Thinking:
- K2.x: `compat.thinking` (`type` / optional `keep`); K2.7-code omits `thinking` by default (always on).
- K3 / Coding `k3`: `compat.reasoning_effort` (per-turn override wins).
- Moonshot replays `reasoning_content` when `preserveThinking`.
