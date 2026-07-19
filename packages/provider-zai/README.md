# @arnilo/prism-provider-zai

Z.AI GLM Chat Completions provider package for Prism.

```ts
import { createZaiProviderPackage, listZaiModels } from "@arnilo/prism-provider-zai";

api.registerProviderPackage(createZaiProviderPackage({ apiKey: "fake-zai-key" }));

// Optional caller-gated discovery (never runs during setup):
const models = await listZaiModels({ apiKey: "fake-zai-key" });
api.registerProviderPackage(createZaiProviderPackage({ apiKey: "fake-zai-key", models }));
```

Exports:
- `createZaiProviderPackage()` / `createZaiProvider()`
- `defineZaiModel()` / `zaiModels` (featured offline bootstrap)
- `listZaiModels()` / `mapZaiModel()` (caller-gated OpenAI-compatible `GET /models`)
- `zaiThinking` / `zaiReasoningEffort` / `zaiToolStream` / `zaiClearThinking` / `zaiPreserveThinking`
- `ZAI_DEFAULT_BASE_URL` (`https://api.z.ai/api/paas/v4`)

Security defaults:
- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- API keys are resolved per request from caller-supplied values or resolvers and redacted from errors.

Thinking / cache:
- Official body fields: `thinking` (`{ type: "enabled" | "disabled", clear_thinking? }`), `reasoning_effort` (GLM-5.2+), `tool_stream` (GLM-4.6+).
- Per-turn `options.compat` wins over `model.compat`.
- Preserved Thinking: set `clear_thinking: false` (and optionally `preserveThinking: true`) so prior thinking is replayed as `reasoning_content`.
- `kind: "implicit"` — GLM context caching is automatic; no explicit cache payload. `prompt_tokens_details.cached_tokens` / `cache_write_tokens` map to usage.
- Provider-owned headers (`content-type`, `authorization`) win over caller headers.
