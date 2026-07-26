# Alibaba Cloud provider package

## What it does

`@arnilo/prism-provider-alibaba` is a side-effect-free adapter for Alibaba Cloud
Model Studio / DashScope (including the Coding Plan) over the **OpenAI-compatible**
`POST {base}/chat/completions` endpoint.

- **Dynamic model discovery** — `listAlibabaModels()` calls the OpenAI-compatible
  `GET {base}/models`. No model catalog is hard-coded in the package: available
  models vary by region, workspace, and billing plan, so discovery is the source of
  truth. Package setup never fetches.
- **Context cache** — DashScope implicit prefix caching is automatic. Explicit
  caching is opt-in via Anthropic-style `cache_control: {"type":"ephemeral"}`
  markers (at most 4 per request). Cache hits are accounted from
  `usage.prompt_tokens_details.cached_tokens` (read) and
  `cache_creation_input_tokens` (write).
- **Qwen thinking** — `enable_thinking` passthrough toggles reasoning on Qwen models.

The API key is region/plan-scoped: it must match the base URL's billing plan
(pay-as-you-go regional, workspace-dedicated, or Coding Plan).

## When to use it

Use it when a host app wants Alibaba Cloud Qwen models (Model Studio / DashScope or
the Coding Plan) through Prism's `AgentSession` runtime with OpenAI-compatible
serialization, dynamic model discovery, and explicit/implicit cache accounting.

Do not use it for automatic credential discovery, setup-time catalog fetches, or
real-network tests (live tests stay opt-in).

## Inputs / request

```ts
import {
  createAlibabaProviderPackage,
  createAlibabaProvider,
  listAlibabaModels,
  defineAlibabaModel,
  alibabaBaseUrl,
} from "@arnilo/prism-provider-alibaba";

createAlibabaProviderPackage(options: AlibabaProviderPackageOptions): ProviderPackage
createAlibabaProvider(options?: AlibabaProviderOptions): AIProvider
listAlibabaModels(options?: ListAlibabaModelsOptions): Promise<ModelConfig[]>
defineAlibabaModel(config: AlibabaModelConfig): ModelConfig
alibabaBaseUrl(options?: { baseUrl?: string; preset?: AlibabaBasePreset }): string
```

| Field | Type | Purpose |
| --- | --- | --- |
| `apiKey` | `CredentialValueSource` | DashScope API key (`DASHSCOPE_API_KEY`), region/plan-scoped. |
| `baseUrl` | `string` | Explicit OpenAI-compatible base URL (wins over `preset`). |
| `preset` | `AlibabaBasePreset` | `"singapore"` (default) / `"beijing"` / `"us"` / `"coding-plan"`. |
| `fetch` | `typeof fetch` | Optional fetch implementation for tests/hosts. |
| `id` | `string` | Provider id (default `alibaba`). |
| `models` | `readonly ModelConfig[]` | Host-supplied models (from `listAlibabaModels`) to register. |

Base URLs resolved by preset:

| Preset | Base URL |
| --- | --- |
| `singapore` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` |
| `beijing` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `us` | `https://dashscope-us.aliyuncs.com/compatible-mode/v1` |
| `coding-plan` | `https://coding-intl.dashscope.aliyuncs.com/v1` |

Workspace-dedicated endpoints
(`https://{workspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1`) are supplied
verbatim via `baseUrl`.

## Outputs / response / events

| Surface | Behavior |
| --- | --- |
| Stream | Prism text deltas, `delta.reasoning_content` → thinking deltas, tool-call delta/final, `usage`, `done`, redacted `error`. |
| Usage | `prompt_tokens`/`completion_tokens`/`total_tokens`; `prompt_tokens_details.cached_tokens` → `cacheReadTokens`, `cache_creation_input_tokens` → `cacheWriteTokens`. |
| Discovery | `listAlibabaModels()` maps `GET {base}/models` entries → `ModelConfig` (reasoning/vision inferred from id). |
| Auth methods | `api_key` for `alibaba`. |

The stream parser emits `done` only on completion evidence (`[DONE]` plus a terminal
`finish_reason` with no dangling tool calls). Truncated streams terminate with an
`error` event instead. Unsupported block placements or unclaimed images fail before
fetch.

## Request/response example

```bash
curl 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions' \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "qwen-plus",
    "messages": [{ "role": "user", "content": "Hello" }],
    "stream": true,
    "stream_options": { "include_usage": true }
  }'
```

Usage in the final streamed chunk:

```json
{
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 5,
    "total_tokens": 105,
    "prompt_tokens_details": { "cached_tokens": 80, "cache_creation_input_tokens": 10 }
  }
}
```

## Implementation example

```ts
import { createExtensionKernel } from "@arnilo/prism";
import {
  createAlibabaProviderPackage,
  listAlibabaModels,
} from "@arnilo/prism-provider-alibaba";

const kernel = createExtensionKernel();

// Caller-gated discovery — never runs during setup.
const models = await listAlibabaModels({ apiKey: process.env.DASHSCOPE_API_KEY });

await kernel.load([
  createAlibabaProviderPackage({
    apiKey: process.env.DASHSCOPE_API_KEY,
    preset: "singapore", // or "coding-plan" with a Coding Plan key
    models,
  }),
]);
```

## Extension and configuration notes

- Hosts choose base URL/preset, provider id, model list, credential source, and
  `fetch` impl. Nothing is hard-coded; register discovered models via `models:`.
- Qwen thinking: `compat.enable_thinking` (request wins over model default) maps to
  the top-level `enable_thinking` wire field; omitted unless explicitly boolean.
- Provider-owned compat keys (`route`, `enable_thinking`, `alibaba`) are stripped
  before the opaque `compat` spread so they never leak into wire bodies.

### Cache behavior

- **Implicit** prefix caching is automatic upstream and sends no markers.
- **Explicit** caching is opt-in: when `ModelConfig.cache.kind === "cache_control"`
  (or `cache.mode === "on"`) and the caller supplies
  `ProviderRequestOptions.cache.breakpoints`, `cache_control: {"type":"ephemeral"}`
  markers land on the last content block of each selected message, capped at
  `ALIBABA_MAX_CACHE_BREAKPOINTS` (4). Each cached prefix needs ≥1024 tokens and
  lives ~5 minutes upstream.
- Usage accounting: `cached_tokens` → `Usage.cacheReadTokens`,
  `cache_creation_input_tokens` → `Usage.cacheWriteTokens`.

## Security and performance notes

- SSE streams and HTTP error bodies use bounded `@arnilo/prism/providers/transport`
  helpers (`readSseData`, `readBoundedResponseText`).
- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- The API key is resolved per request via `resolveCredentialValue` and sent only as
  `Authorization: Bearer`; keys are redacted from all thrown errors (including
  discovery failures). No local filesystem paths enter request payloads.
- Caller-supplied `ProviderRequest.options.headers` can add non-owned headers, but
  provider-owned headers (`content-type`, `authorization`) are applied last and
  cannot be overridden.
- Model discovery is caller-gated and never invoked in the provider hot path.
- Live tests stay opt-in; default tests are network-free.

## Related APIs

- [Provider packages](../provider-packages.md): `defineProviderPackage`,
  caller-gated discovery, OpenAI-compatible routes.
- [Provider caching](../provider-caching.md): explicit/implicit matrix.
- [Credentials and redaction](../credentials-and-redaction.md):
  `resolveCredentialValue`, `redactSecrets`.
- [Provider conformance](../provider-conformance.md): network-free adapter tests.
