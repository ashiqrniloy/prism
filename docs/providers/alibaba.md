# Alibaba Cloud provider package

## What it does

`@arnilo/prism-providers/alibaba` is a side-effect-free adapter for Alibaba Cloud
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

## Compatible-mode surface (verified 2026-08-10)

Decision record for which DashScope / Model Studio surfaces are reachable through
OpenAI-compatible endpoints on the package's public presets. Sources retrieved
2026-08-10; links in the table. This table is the authority for what the package
implements vs defers (plan 014 Task 1).

| Surface | OpenAI-compatible? | Verified route | Decision |
| --- | --- | --- | --- |
| Embeddings | Yes | `POST {base}/embeddings` on all public presets (intl/beijing/us); `text-embedding-v3`/`v4`; dimensions 64–2048 (default 1024); max 10 inputs per request, 8,192 tokens each | Implemented in 0.1.2 (`createAlibabaEmbedder`) |
| Video input | Yes | Chat content part `{"type":"video_url","video_url":{"url":…},"fps":2}` on Qwen-VL models; URL must be publicly reachable with correct `Content-Length`/`Content-Type`; `fps` 0.1–10 (default 2) | Implemented in 0.1.2 (video `file` blocks → `video_url`) |
| Document input | Partial | OpenAI Files API `POST {base}/files` (`purpose: "file-extract"`, ≤150 MB) then reference `fileid://<id>` as a system message (qwen-long, ≤100 files); no document content part exists in compatible mode; `doc_url` parts are native-only (qwen-doc-turbo) | Deferred — upload + status lifecycle, not a serialization mapping; demand-gated follow-up |
| Rerank | Partial | `POST {workspaceId}.{region}.maas.aliyuncs.com/compatible-api/v1/reranks` (`qwen3-rerank`, ≤500 documents, 4,000 tokens/item) — workspace-dedicated only, base path `compatible-api/v1` (not `compatible-mode/v1`); no rerank route on the public presets | Deferred — no route on public presets; workspace-dedicated route recorded for a future `baseUrl`-supplied reranker |
| Text-to-SQL | n/a | No dedicated endpoint; SQL generation is a chat prompt use case on `chat/completions` | Nothing to implement — covered by the existing chat provider |
| Async task polling | No | `X-DashScope-Async: enable` + `GET /api/v1/tasks/{id}` — native-only | Deferred (documented) |

Sources:

- OpenAI compatibility overview: <https://help.aliyun.com/en/model-studio/compatibility-of-openai-with-dashscope>
- Embeddings (models, dimensions): <https://www.alibabacloud.com/help/en/model-studio/models>; batch limits: <https://docs.qwencloud.com/resources/faq-embedding-reranking>
- Video input (`video_url` part): <https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions>
- Document input (file-extract): <https://help.aliyun.com/en/model-studio/long-context-qwen-long> and <https://help.aliyun.com/en/model-studio/openai-file-interface>; native `doc_url`: <https://help.aliyun.com/en/model-studio/data-mining-qwen-doc>
- Rerank (`compatible-api/v1/reranks`): <https://www.alibabacloud.com/help/en/model-studio/rerank>
- Async task polling (native): <https://help.aliyun.com/en/model-studio/asynchronous-call-api-reference>

## Inputs / request

```ts
import {
  createAlibabaProviderPackage,
  createAlibabaProvider,
  createAlibabaEmbedder,
  listAlibabaModels,
  defineAlibabaModel,
  alibabaBaseUrl,
} from "@arnilo/prism-providers/alibaba";

createAlibabaProviderPackage(options: AlibabaProviderPackageOptions): ProviderPackage
createAlibabaProvider(options?: AlibabaProviderOptions): AIProvider
createAlibabaEmbedder(options: AlibabaEmbedderOptions): AlibabaEmbedder
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

## Embeddings

`createAlibabaEmbedder()` calls the OpenAI-compatible `POST {base}/embeddings`
(text-embedding-v3/v4) and returns a structural `Embedder` — assignable to
`@arnilo/prism-memory`'s `Embedder` without importing it (the package stays
dependency-free).

```ts
import { createAlibabaEmbedder } from "@arnilo/prism-providers/alibaba";

const embedder = createAlibabaEmbedder({
  apiKey: process.env.DASHSCOPE_API_KEY,
  model: "text-embedding-v4",
  dimensions: 1024, // 64–2048, default 1024
});

const vectors = await embedder.embed(["hello", "world"]); // number[2][1024]
```

- Inputs are chunked at `ALIBABA_EMBEDDING_BATCH_SIZE` (10) per request — the
  DashScope cap (8,192 tokens per text) — and vectors are returned in input order.
  Empty input returns `[]` without a fetch.
- `dimensions` (64–2048, default 1024) and `encoding_format` (default `float`)
  pass through on the wire; `baseUrl`/`preset`/`fetch`/`headers` mirror the
  provider options.
- Caller-gated like discovery: construction never fetches; the key is resolved per
  call and redacted from all thrown errors; provider-owned headers
  (`authorization`, `content-type`) cannot be overridden by caller headers.

## Multimodal input

Video input (0.1.2): a `file` content block with a `video/*` media type serializes
to the compatible-mode `video_url` content part on Qwen-VL models:

```ts
// host side
{ type: "file", mediaType: "video/mp4", url: "https://example.com/clip.mp4" }
// wire shape emitted by serializeAlibabaMessage
{ "type": "video_url", "video_url": { "url": "https://example.com/clip.mp4" } }
```

- Gated on the `file` input capability (no core `"video"` capability in 0.1.2);
  `mapAlibabaModel()` advertises `["text", "image", "file"]` for the qwen-vl
  family; `defineAlibabaModel` capability overrides still win.
- `url` (publicly reachable, correct `Content-Length`/`Content-Type`) or base64
  `data:` URL pass through; `resourceUri`-only blocks throw before fetch (the
  provider never fetches). `fps` defaults upstream to 2.0.
- Document input is **deferred**: compatible-mode chat has no document content
  part — the compatible path is the OpenAI Files API (`purpose: file-extract`,
  ≤150 MB) plus a `fileid://<id>` system-message reference (qwen-long, ≤100
  files), an upload/status lifecycle outside serialization. `document` and
  non-video `file` blocks keep failing before fetch.

## Rerank (deferred)

No OpenAI-compatible rerank route exists on the public presets, so 0.1.2 ships no
reranker. The verified compatible route is workspace-dedicated only:
`POST {workspaceId}.{region}.maas.aliyuncs.com/compatible-api/v1/reranks`
(`qwen3-rerank`, ≤500 documents, 4,000 tokens/item; base path `compatible-api/v1`,
not `compatible-mode/v1`). A future `createAlibabaReranker` over that route is
demand-gated: implement when a caller supplies a workspace-dedicated `baseUrl` and
needs rerank (structural `Reranker` shape from `@arnilo/prism-memory/rag`, no new
dependency). Multimodal rerank (`qwen3-vl-rerank`) is native-only and stays out.

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
} from "@arnilo/prism-providers/alibaba";

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
- Opt-in live probe (never part of `npm test`/CI):
  `PRISM_LIVE_DASHSCOPE_KEY=… npm run test:live --workspace @arnilo/prism-providers/alibaba`
  exercises an embeddings round-trip against the real endpoint (model override via
  `PRISM_LIVE_DASHSCOPE_MODEL`); absent env = documented skip, never a failure.
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
