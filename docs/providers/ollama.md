# Ollama Cloud provider package

## What it does

`@arnilo/prism-providers/ollama` is a side-effect-free adapter for Ollama — both
**Ollama Cloud** (`https://ollama.com`) and a **local** `ollama serve`
(`http://localhost:11434`) — over the OpenAI-compatible
`POST {base}/chat/completions` endpoint.

- **Dynamic model discovery** — `listOllamaModels()` calls the OpenAI-compatible
  `GET {base}/models`. No model catalog is hard-coded: available models vary by cloud
  account or local pull, so discovery is the source of truth. Package setup never
  fetches. (The native `GET {base}/api/tags` endpoint is an alternate catalog source;
  Prism uses the OpenAI-compatible route for a uniform shape.)
- **Implicit cache only** — Ollama reuses its KV/prompt cache automatically. There is
  no request knob and no cached-token count in usage, so `Usage.cacheReadTokens` is
  intentionally left undefined (documented ceiling below).
- **Reasoning** — `reasoning_effort` passthrough (e.g. gpt-oss models).

Cloud auth is an ollama.com API key sent as `Authorization: Bearer`; local instances
are typically unauthenticated (omit the key).

## When to use it

Use it when a host app wants Ollama Cloud or local Ollama models through Prism's
`AgentSession` runtime with OpenAI-compatible serialization and dynamic model
discovery.

Do not use it for automatic credential discovery, setup-time catalog fetches, explicit
cache control (Ollama has none), or real-network tests (live tests stay opt-in).

## Inputs / request

```ts
import {
  createOllamaProviderPackage,
  createOllamaProvider,
  listOllamaModels,
  defineOllamaModel,
  ollamaBaseUrl,
} from "@arnilo/prism-providers/ollama";

createOllamaProviderPackage(options: OllamaProviderPackageOptions): ProviderPackage
createOllamaProvider(options?: OllamaProviderOptions): AIProvider
listOllamaModels(options?: ListOllamaModelsOptions): Promise<ModelConfig[]>
defineOllamaModel(config: OllamaModelConfig): ModelConfig
ollamaBaseUrl(options?: { baseUrl?: string; preset?: OllamaBasePreset }): string
```

| Field | Type | Purpose |
| --- | --- | --- |
| `apiKey` | `CredentialValueSource` | Ollama Cloud API key; omit for unauthenticated local. |
| `baseUrl` | `string` | Explicit OpenAI-compatible base URL (wins over `preset`). |
| `preset` | `OllamaBasePreset` | `"cloud"` (default) / `"local"`. |
| `fetch` | `typeof fetch` | Optional fetch implementation for tests/hosts. |
| `id` | `string` | Provider id (default `ollama`). |
| `models` | `readonly ModelConfig[]` | Host-supplied models (from `listOllamaModels`) to register. |

Base URLs resolved by preset (each includes the `/v1` segment):

| Preset | Base URL |
| --- | --- |
| `cloud` | `https://ollama.com/v1` |
| `local` | `http://localhost:11434/v1` |

## Outputs / response / events

| Surface | Behavior |
| --- | --- |
| Stream | Prism text deltas, `delta.reasoning_content` → thinking deltas, tool-call delta/final, `usage`, `done`, redacted `error`. |
| Usage | `prompt_tokens` → `inputTokens`, `completion_tokens` → `outputTokens` (native `prompt_eval_count`/`eval_count` are the equivalent). `cacheReadTokens` stays undefined. |
| Discovery | `listOllamaModels()` maps `GET {base}/models` entries → `ModelConfig` (reasoning/vision inferred from id). |
| Auth methods | `api_key` for `ollama`. |

The stream parser emits `done` only on completion evidence (`[DONE]` plus a terminal
`finish_reason` with no dangling tool calls). Truncated streams terminate with an
`error` event instead. Unsupported block placements or unclaimed images fail before
fetch.

## Request/response example

```bash
curl 'https://ollama.com/v1/chat/completions' \
  -H "Authorization: Bearer $OLLAMA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gpt-oss:20b",
    "messages": [{ "role": "user", "content": "Hello" }],
    "stream": true,
    "stream_options": { "include_usage": true }
  }'

curl 'https://ollama.com/v1/models' -H "Authorization: Bearer $OLLAMA_API_KEY"
```

Usage in the final streamed chunk:

```json
{ "usage": { "prompt_tokens": 100, "completion_tokens": 5, "total_tokens": 105 } }
```

## Implementation example

```ts
import { createExtensionKernel } from "@arnilo/prism";
import {
  createOllamaProviderPackage,
  listOllamaModels,
} from "@arnilo/prism-providers/ollama";

const kernel = createExtensionKernel();

// Caller-gated discovery — never runs during setup.
const models = await listOllamaModels({ apiKey: process.env.OLLAMA_API_KEY });

await kernel.load([
  createOllamaProviderPackage({
    apiKey: process.env.OLLAMA_API_KEY, // omit for local
    preset: "cloud", // or "local"
    models,
  }),
]);
```

## Extension and configuration notes

- Hosts choose base URL/preset, provider id, model list, credential source, and
  `fetch` impl. Nothing is hard-coded; register discovered models via `models:`.
- Reasoning: `compat.reasoning_effort` (request wins over model default) maps to the
  top-level `reasoning_effort` wire field; omitted unless explicitly a string.
- Provider-owned compat keys (`route`, `reasoning_effort`, `ollama`) are stripped
  before the opaque `compat` spread so they never leak into wire bodies.

### Cache behavior

- **Implicit only.** Ollama reuses its KV/prompt cache automatically; there is no
  request knob and no wire marker. Prism never emits `cache_control` for Ollama.
- **Documented ceiling:** Ollama exposes no cached-token count, so
  `Usage.cacheReadTokens` is intentionally left `undefined` (not `0`). If a future
  Ollama release reports cached tokens, map them in `mapOllamaModel`/usage handling.

## Security and performance notes

- SSE streams and HTTP error bodies use bounded `@arnilo/prism/providers/transport`
  helpers (`readSseData`, `readBoundedResponseText`).
- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- The cloud API key is resolved per request via `resolveCredentialValue` and sent only
  as `Authorization: Bearer`; keys are redacted from all thrown errors (including
  discovery failures). Local presets send no auth header when no key is configured.
  No local filesystem paths enter request payloads.
- Caller-supplied `ProviderRequest.options.headers` can add non-owned headers, but
  provider-owned headers (`content-type`, `authorization`) are applied last and
  cannot be overridden.
- Model discovery is caller-gated and never invoked in the provider hot path.
- Live tests stay opt-in; default tests are network-free.

## Related APIs

- [Provider packages](../provider-packages.md): `defineProviderPackage`,
  caller-gated discovery, OpenAI-compatible routes.
- [Provider caching](../provider-caching.md): explicit/implicit matrix (Ollama =
  implicit only).
- [Credentials and redaction](../credentials-and-redaction.md):
  `resolveCredentialValue`, `redactSecrets`.
- [Provider conformance](../provider-conformance.md): network-free adapter tests.
