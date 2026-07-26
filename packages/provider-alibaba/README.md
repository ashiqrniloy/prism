# @arnilo/prism-provider-alibaba

Alibaba Cloud (Model Studio / DashScope, including the Coding Plan) provider package for Prism, over the OpenAI-compatible `POST {base}/chat/completions` route.

```ts
import { createAlibabaProviderPackage, listAlibabaModels } from "@arnilo/prism-provider-alibaba";

// Caller-gated discovery (never during setup) — no hard-coded model catalog.
const models = await listAlibabaModels({ apiKey: "fake-dashscope-key", preset: "singapore" });

api.registerProviderPackage(createAlibabaProviderPackage({
  apiKey: "fake-dashscope-key",
  preset: "coding-plan", // or "singapore" | "beijing" | "us" | explicit baseUrl
  models,
}));
```

Exports:
- `createAlibabaProviderPackage()` / `createAlibabaProvider()`
- `listAlibabaModels()` / `mapAlibabaModel()` / `defineAlibabaModel()`
- `alibabaBaseUrl()` / `DEFAULT_ALIBABA_BASE_URL` / `AlibabaBasePreset`
- `alibabaBody()` / `alibabaEvents()` / `serializeAlibabaMessage()` / `alibabaEnableThinking()`
- `applyAlibabaCacheControl()` / `alibabaCacheEnabled()` / `ALIBABA_MAX_CACHE_BREAKPOINTS`

Behavior:
- Dynamic model discovery via OpenAI-compatible `GET {base}/models` (region/workspace/plan-scoped; nothing hard-coded).
- Context cache: implicit prefix caching automatic; explicit opt-in `cache_control: {"type":"ephemeral"}` markers (≤4). Usage maps `prompt_tokens_details.cached_tokens` → `cacheReadTokens`, `cache_creation_input_tokens` → `cacheWriteTokens`.
- Qwen `enable_thinking` passthrough.

Security defaults:
- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- API key sent only as `Authorization: Bearer`; redacted from all errors.
- No local filesystem paths in request payloads.

See `docs/providers/alibaba.md` for the full API page.
