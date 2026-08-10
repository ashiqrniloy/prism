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
- `createAlibabaEmbedder()` / `AlibabaEmbedder` / `ALIBABA_EMBEDDING_BATCH_SIZE`
- `alibabaBaseUrl()` / `DEFAULT_ALIBABA_BASE_URL` / `AlibabaBasePreset`
- `alibabaBody()` / `alibabaEvents()` / `serializeAlibabaMessage()` / `alibabaEnableThinking()`
- `applyAlibabaCacheControl()` / `alibabaCacheEnabled()` / `ALIBABA_MAX_CACHE_BREAKPOINTS`

Embeddings (0.1.2):

```ts
import { createAlibabaEmbedder } from "@arnilo/prism-provider-alibaba";

const embedder = createAlibabaEmbedder({ apiKey: "fake-dashscope-key", model: "text-embedding-v4" });
const vectors = await embedder.embed(["hello", "world"]); // number[2][1024]
```

- OpenAI-compatible `POST {base}/embeddings` (text-embedding-v3/v4); structural `Embedder` shape (assignable to `@arnilo/prism-memory`'s `Embedder` without a dependency).
- Inputs chunked at 10 per request (DashScope cap); vectors returned in input order; empty input returns `[]` without a fetch.
- Dimensions 64–2048 (default 1024); `encoding_format` passthrough (default `float`).

Behavior:
- Dynamic model discovery via OpenAI-compatible `GET {base}/models` (region/workspace/plan-scoped; nothing hard-coded).
- Context cache: implicit prefix caching automatic; explicit opt-in `cache_control: {"type":"ephemeral"}` markers (≤4). Usage maps `prompt_tokens_details.cached_tokens` → `cacheReadTokens`, `cache_creation_input_tokens` → `cacheWriteTokens`.
- Qwen `enable_thinking` passthrough.

Security defaults:
- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- API key sent only as `Authorization: Bearer`; redacted from all errors.
- No local filesystem paths in request payloads.
- Opt-in live probe: `PRISM_LIVE_DASHSCOPE_KEY=… npm run test:live --workspace @arnilo/prism-provider-alibaba` (skips when env absent; never in CI).

See `docs/providers/alibaba.md` for the full API page.
