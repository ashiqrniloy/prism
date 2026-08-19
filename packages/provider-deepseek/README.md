# @arnilo/prism-provider-deepseek

DeepSeek Chat Completions provider package for Prism.

```ts
import { createDeepSeekProviderPackage, listDeepSeekModels } from "@arnilo/prism-provider-deepseek";

api.registerProviderPackage(createDeepSeekProviderPackage({ apiKey: "fake-deepseek-key" }));

const models = await listDeepSeekModels({ apiKey: "fake-deepseek-key" });
api.registerProviderPackage(createDeepSeekProviderPackage({ apiKey: "fake-deepseek-key", models }));
```

Exports:
- `createDeepSeekProviderPackage()` / `createDeepSeekProvider()`
- `defineDeepSeekModel()` / `deepseekModels`
- `listDeepSeekModels()` / `mapDeepSeekModel()`
- `deepseekThinking` / `deepseekReasoningEffort` / `mapDeepseekEffort` / `deepseekReplayThinking`
- `canonicalizeJsonSchema`
- `DEEPSEEK_DEFAULT_BASE_URL` (`https://api.deepseek.com`)

Security defaults:
- No network on import, setup, build, or default tests.
- No env / file / keychain lookup.
- API keys resolved per request and redacted from errors.

Thinking / cache:
- Official `thinking: { type: "enabled" | "disabled" }` (default enabled) and `reasoning_effort` `low` / `high` / `max` (`medium` and `xhigh` → `high`).
- Tool-turn assistants replay `reasoning_content` (API 400 otherwise). Non-tool turns may omit it.
- `kind: "implicit"` prefix cache. `prompt_cache_hit_tokens` → `cacheReadTokens`.
