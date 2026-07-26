# @arnilo/prism-provider-ollama

Ollama Cloud / local provider package for Prism, over the OpenAI-compatible `POST {base}/chat/completions` route.

```ts
import { createOllamaProviderPackage, listOllamaModels } from "@arnilo/prism-provider-ollama";

// Caller-gated discovery (never during setup) — no hard-coded model catalog.
const models = await listOllamaModels({ apiKey: "fake-ollama-key", preset: "cloud" });

api.registerProviderPackage(createOllamaProviderPackage({
  apiKey: "fake-ollama-key", // omit for unauthenticated local `ollama serve`
  preset: "cloud", // or "local" (http://localhost:11434/v1) or explicit baseUrl
  models,
}));
```

Exports:
- `createOllamaProviderPackage()` / `createOllamaProvider()`
- `listOllamaModels()` / `mapOllamaModel()` / `defineOllamaModel()`
- `ollamaBaseUrl()` / `DEFAULT_OLLAMA_BASE_URL` / `OllamaBasePreset`
- `ollamaBody()` / `ollamaEvents()` / `ollamaReasoningEffort()`

Behavior:
- Dynamic model discovery via OpenAI-compatible `GET {base}/models` (native `GET {base}/api/tags` documented as alternate); nothing hard-coded.
- Cloud (`https://ollama.com/v1`, Bearer API key) and local (`http://localhost:11434/v1`, typically unauthenticated) base-URL presets.
- `reasoning_effort` passthrough (e.g. gpt-oss).
- **Implicit cache only:** Ollama reuses its KV/prompt cache automatically with no request knob and no cached-token count, so `Usage.cacheReadTokens` is intentionally left undefined (documented ceiling).

Security defaults:
- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- Cloud API key sent only as `Authorization: Bearer`; redacted from all errors.
- No local filesystem paths in request payloads.

See `docs/providers/ollama.md` for the full API page.
