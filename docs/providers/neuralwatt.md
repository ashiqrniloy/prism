# NeuralWatt provider package

## What it does

`@arnilo/prism-provider-neuralwatt` provides explicit, side-effect-free setup for the
NeuralWatt OpenAI-compatible Chat Completions provider using Prism's OpenAI-compatible
route with NeuralWatt-specific reasoning/template escape hatches, SSE comment tolerance,
and implicit prefix caching.

The package registers a provider, default model metadata for the featured NeuralWatt
aliases (`glm-5.2`, `glm-5.2-fast`, `glm-5.2-short`, `glm-5.2-short-fast`,
`kimi-k2.6`, `kimi-k2.6-fast`, `kimi-k2.7-code`, `qwen3.5-397b`,
`qwen3.5-397b-fast`, `qwen3.6-35b`, `qwen3.6-35b-fast`), and an `api_key` auth
method through `createExtensionKernel().load([...])`.

## When to use it

Use it when a host app wants to run the NeuralWatt endpoint (`https://api.neuralwatt.com/v1`)
through Prism's `AgentSession` runtime with NeuralWatt-specific `reasoning_effort`,
`thinking_token_budget`, and `chat_template_kwargs` handling.

Do not use it for automatic credential discovery, catalog fetches, or real-network tests.

## Inputs / request

```ts
import {
  classifyNeuralWattError,
  createNeuralWattProviderPackage,
  defineNeuralWattModel,
  getNeuralWattQuota,
  listNeuralWattModels,
  mapNeuralWattTelemetry,
  neuralWattEventsWithTelemetry,
  neuralWattModels,
  parseNeuralWattComment,
} from "@arnilo/prism-provider-neuralwatt";

createNeuralWattProviderPackage(options: NeuralWattProviderPackageOptions): ProviderPackage
defineNeuralWattModel(config: NeuralWattModelConfig): ModelConfig
listNeuralWattModels(options?: ListNeuralWattModelsOptions): Promise<ModelConfig[]>
getNeuralWattQuota(options: GetNeuralWattQuotaOptions): Promise<NeuralWattQuota>
classifyNeuralWattError(input: NeuralWattErrorInput): NeuralWattRetryDecision
mapNeuralWattTelemetry(body: unknown): { energy?: NeuralWattEnergyTelemetry; cost?: NeuralWattCostTelemetry }
parseNeuralWattComment(text: string): NeuralWattTelemetryEvent | undefined
neuralWattEventsWithTelemetry(body: ReadableStream<Uint8Array>): AsyncIterable<NeuralWattEvent>
```

| Field | Type | Purpose |
| --- | --- | --- |
| `apiKey` | `CredentialValueSource` | Direct/callback/resolver API-key source. |
| `fetch` | `typeof fetch` | Optional fetch implementation for tests/hosts. |
| `baseUrl` | `string` | Overrides `https://api.neuralwatt.com/v1`. |
| `id` | `string` | Overrides the provider id (default `neuralwatt`). |
| `models` | `readonly ModelConfig[]` | Overrides `neuralWattModels` defaults. |

`listNeuralWattModels()` options:

| Field | Type | Purpose |
| --- | --- | --- |
| `apiKey` | `CredentialValueSource` | Optional API-key source. Unauthenticated calls return the public catalog; authenticated calls may include private models. |
| `fetch` | `typeof fetch` | Optional fetch implementation for tests/hosts. |
| `baseUrl` | `string` | Overrides `https://api.neuralwatt.com/v1`. |
| `signal` | `AbortSignal` | Cancels the single discovery request. |
| `headers` | `Record<string, string>` | Optional non-owned headers. `authorization` is provider-owned and applied last. |

`getNeuralWattQuota()` options:

| Field | Type | Purpose |
| --- | --- | --- |
| `apiKey` | `CredentialValueSource` | **Required.** NeuralWatt returns 401 for unauthenticated quota calls. |
| `fetch` | `typeof fetch` | Optional fetch implementation for tests/hosts. |
| `baseUrl` | `string` | Overrides `https://api.neuralwatt.com/v1`. |
| `signal` | `AbortSignal` | Cancels the single quota request. |
| `headers` | `Record<string, string>` | Optional non-owned headers. `authorization` is provider-owned and applied last. |

The endpoint is rate-limited to **1 request per second per customer** (429 with
`Retry-After: 1`). The helper performs no polling or caching and is never called
from `generate()` or package setup; the caller owns throttling.

NeuralWatt-specific request fields flow through the generic `ProviderRequestOptions.compat`
/ `extra` escape hatches: `compat.reasoning_effort` (`"low" | "medium" | "high"`),
`compat.thinking_token_budget`, `compat.chat_template_kwargs` (including `enable_thinking`),
`compat.preserve_thinking`, `compat.clear_thinking`, and `compat.tool_choice`.
`preserve_thinking: true` keeps prior assistant reasoning in request history so
multi-turn reasoning continues with the earlier chain of thought; `clear_thinking:
true` drops it for the next turn, resetting the chain. `options.extra` spreads after
`compat` so per-call values and overrides win.

## Outputs / response / events

| Surface | Behavior |
| --- | --- |
| Provider stream | Prism text, thinking (`delta.reasoning_content` → `providerThinkingDelta`), tool-call delta/final, `usage`, `done`, redacted `error` with HTTP-status `code` for retry classification. |
| Block preservation | Text, thinking, assistant `tool_call` → `tool_calls`, `tool_result` → role `tool` messages, images when `capabilities.input` includes `"image"`. |
| Model catalog | Featured aliases declare provider id, display name, context limit, text/image input support, tools, reasoning/fast variants, streaming, implicit cache, and NeuralWatt JSON-mode compat metadata where documented. |
| Pricing | Static aliases do not guess rates. Exact per-alias input/output/cache-read prices are advertised by NeuralWatt's `/v1/models` response and mapped by `listNeuralWattModels()` when present. |
| SSE comments | `: energy` / `: cost` comment lines are parsed by `neuralWattEventsWithTelemetry()` into `neuralwatt:telemetry` events; the standard `neuralWattEvents()` stream (used by `generate()`) tolerates them without spurious events. |
| `[DONE]` | Terminates the stream; final `providerDone(usage)` always emitted on a clean stream. |
| Malformed data | Yields `providerError` rather than crashing the generator (more robust than the Z.AI parser). |
| Auth method | `api_key` for the configured provider id, credential name `apiKey`. |

Unsupported block placements or unclaimed images fail before fetch.

## Request/response example

Example request body (OpenAI-compatible Chat Completions shape):

```json
{
  "model": "glm-5.2",
  "messages": [{ "role": "user", "content": "Hello" }],
  "stream": true,
  "stream_options": { "include_usage": true },
  "reasoning_effort": "medium",
  "thinking_token_budget": 8192
}
```

## Implementation example

```ts
import { createExtensionKernel } from "@arnilo/prism";
import { createNeuralWattProviderPackage } from "@arnilo/prism-provider-neuralwatt";

const kernel = createExtensionKernel();
await kernel.load([createNeuralWattProviderPackage({ apiKey: "fake-neuralwatt-key" })]);
```

Override the provider id and models:

```ts
import { createNeuralWattProviderPackage, defineNeuralWattModel, neuralWattModels } from "@arnilo/prism-provider-neuralwatt";

await kernel.load([
  createNeuralWattProviderPackage({ id: "neuralwatt", apiKey: "fake", models: neuralWattModels }),
]);
```

Explicit catalog discovery:

```ts
import { listNeuralWattModels } from "@arnilo/prism-provider-neuralwatt";

const models = await listNeuralWattModels({ apiKey: "fake-neuralwatt-key", fetch });
await kernel.load([createNeuralWattProviderPackage({ apiKey: "fake", models })]);
```

Discovery performs exactly one `GET /v1/models` call when invoked. Provider package
setup and `generate()` never call model discovery implicitly.

Account quota:

```ts
import { getNeuralWattQuota } from "@arnilo/prism-provider-neuralwatt";

const quota = await getNeuralWattQuota({ apiKey: "fake-neuralwatt-key", fetch });
console.log(quota.usage?.current_month?.energy_kwh, quota.balance?.balance_usd);
```

Returns typed `NeuralWattQuota` (`balance`, `usage.lifetime`/`usage.current_month`,
`limits`, `subscription`, `key`). All fields optional; minimal structural
validation. The caller owns throttling/caching — the helper makes one explicit
`GET /v1/quota` call and is never invoked from `generate()` or setup.

## Extension and configuration notes

- Hosts choose base URL, provider id, model list, credential source, and `fetch`
  impl.
- `defineNeuralWattModel` lets apps set NeuralWatt-specific `compat`
  (`reasoning_effort`, `thinking_token_budget`, `chat_template_kwargs`,
  `preserve_thinking`, `clear_thinking`, `tool_choice`).
- Package contributes models via the extension `api` and an `api_key` auth method.
- Curated aliases are static and network-free. They include documented context windows
  and capabilities only; `ModelConfig.cost` is left unset until exact per-alias pricing
  is read from NeuralWatt's `/v1/models` catalog.
- `listNeuralWattModels()` maps `/v1/models` entries to `ModelConfig`: id/display
  name, capabilities, limits, implicit cache metadata, `ModelCost` pricing, and
  provider-owned NeuralWatt metadata in `compat.neuralwatt`.
- `getNeuralWattQuota()` calls `GET /v1/quota` once with a required API key and
  returns typed account quota (`balance`, `usage`, `limits`, `subscription`, `key`).
  It is opt-in, never called from `generate()` or setup, and the caller owns
  throttling (NeuralWatt limits the endpoint to 1 rps per customer).

### Model catalog and pricing

`neuralWattModels` includes NeuralWatt's featured aliases:

| Alias | Context | Notable metadata |
| --- | ---: | --- |
| `glm-5.2` | 1024K | Tools, reasoning |
| `glm-5.2-fast` | 1024K | Tools, fast/no reasoning |
| `glm-5.2-short` | 195K | Tools, reasoning |
| `glm-5.2-short-fast` | 195K | Tools, fast/no reasoning |
| `kimi-k2.6` | 256K | Tools, reasoning, vision, JSON mode |
| `kimi-k2.6-fast` | 256K | Tools, vision, JSON mode, fast/no reasoning |
| `kimi-k2.7-code` | 256K | Tools, reasoning, vision, JSON mode |
| `qwen3.5-397b` | 256K | Tools, reasoning, JSON mode |
| `qwen3.5-397b-fast` | 256K | Tools, JSON mode, fast/no reasoning |
| `qwen3.6-35b` | 128K | Tools, reasoning, vision, JSON mode |
| `qwen3.6-35b-fast` | 128K | Tools, vision, JSON mode, fast/no reasoning |

NeuralWatt exposes exact pricing from `GET /v1/models` as per-million-token
`input_per_million`, `output_per_million`, `cached_input_per_million`,
`cached_output_per_million`, `currency`, and `pricing_tbd`. Cache reads for
NeuralWatt-hosted models are advertised by the API and default to 25% of the input
rate; there is no separate cache-write price (`cached_output_per_million` is `null`).
The static catalog does not copy or infer prices that are not published as fixed
alias values in these docs.

### Cache behavior

- NeuralWatt models use **implicit prefix caching**: the server caches prompt prefixes
  automatically based on request content, with no explicit request-side cache payload.
  Catalog models declare `cache: { kind: "implicit" }`. For the cross-provider
  explicit/implicit cache matrix, see [Provider caching](../provider-caching.md).
- The provider sends no `cache_control`, `cacheKey`, `prompt_cache`, or `cacheRetention`
  fields regardless of `ProviderRequestOptions.cache` / `cacheKey` / `cacheRetention`
  settings — those options have no effect on the NeuralWatt request body.
  `cacheRetention: "none"` disables Prism cache-control hints only; it does **not**
  disable the implicit backend prefix cache. Hosts relying on cache hits should keep
  their stable prompt prefix byte-stable and stable inputs unchanged.
- Usage accounting is read-only: `prompt_tokens_details.cached_tokens` maps to
  `Usage.cacheReadTokens`. NeuralWatt does not report a cache-write token today, so
  `Usage.cacheWriteTokens` is never fabricated (stays `undefined`).

#### Cache-aware limiter behavior

NeuralWatt's backend rate limiter is cache-aware, which affects when long-running
agent sessions are throttled versus served:

- **Uncached TPM counts cold prefill only.** Tokens-per-minute accounting charges the
  cold prefill of a request — the prefix that is not already in the vLLM prefix cache.
  A request whose prefix is fully cached consumes far less of the TPM budget than a
  cold request of the same total prompt length.
- **Warm-prefix requests can avoid some `503` fleet-capacity blocks.** When the fleet
  is near capacity, requests that can reuse a cached prefix are more likely to be
  admitted than fully cold requests. Prefix reuse is therefore both a latency and an
  availability lever, not just a cost lever.
- **Full prior history is required for multi-turn cache reuse.** The prefix cache is
  keyed by request content, so each follow-up turn must resend the entire prior
  transcript (system prompt + all prior turns) unchanged, with only the new turn
  appended. Prism's `inputLayout: "cache_aware"` ordering keeps the stable prefix
  first; see [Provider caching](../provider-caching.md).
- Cache behavior is best-effort and **does not guarantee cache hits**. Prefix cache
  admission and eviction are server-side decisions and can vary with fleet load.
  `cacheRetention: "none"` disables Prism cache-control hints only; it does not
  disable the implicit backend prefix cache.

### Reasoning preservation across turns

NeuralWatt reasoning-capable models (Kimi-, GLM-, Qwen-style aliases with
`capabilities.reasoning: true`) accept prior assistant reasoning in request history
so multi-turn sessions continue the earlier chain of thought:

- Prior `thinking` content blocks on an assistant message are serialized under a
  `reasoning_content` field on that message (matching the streaming
  `delta.reasoning_content` field). They are **not** flattened into text `content`, so
  the model sees reasoning and answer as distinct.
- Preservation is gated on `model.capabilities.reasoning === true` **or**
  `compat.preserve_thinking: true`. Non-reasoning models receive no `reasoning_content`
  field and prior `thinking` blocks are dropped — they never leak into text content for
  providers/models that do not support reasoning.
- `compat.clear_thinking: true` drops prior reasoning for the next turn even on
  reasoning-capable models, resetting the chain of thought. `clear_thinking` takes
  precedence over `preserve_thinking`.
- The provider only echoes caller-provided `thinking` blocks; it never synthesizes new
  reasoning.

### Tool calls and the tool-call loop

NeuralWatt exposes OpenAI-compatible function calling. The provider carries tools and
prior tool turns through a multi-turn loop:

- **Request serialization.** `ProviderRequest.tools` (`ToolDefinition[]`) is serialized
  to OpenAI `tools: [{ type: "function", function: { name, description, parameters } }]`.
  Missing `parameters` default to `{ type: "object" }`. `compat.tool_choice` passes
  through as `tool_choice` (string or `{ type: "function", function: { name } }`).
- **Streaming reconstruction.** `delta.tool_calls` fragments (keyed by `index`) are
  accumulated and re-emitted as `tool_call_delta` events for UI consumers, then
  reconstructed into a final `tool_call` event per call with parsed JSON arguments.
  Parallel calls are tracked by index.
- **Next-turn ordering.** On the following turn the assistant `tool_call` block is
  serialized to `role: "assistant"` with a `tool_calls` array (arguments stringified to
  JSON), immediately followed by a `role: "tool"` message carrying `tool_call_id` and
  the stringified `tool_result` — matching the OpenAI requirement that a tool result
  follows the call that produced it. `tool_result` blocks must appear in `role: "tool"
  messages; `tool_call` blocks must be the only content on their assistant message.

### Energy and cost telemetry

NeuralWatt streams energy and cost data as SSE comment lines (`: energy {...}`
and `: cost {...}`) before `data: [DONE]`, and as top-level `energy`/`cost` JSON
fields on non-streaming responses. Standard SSE clients ignore comments, so
these values are invisible unless the raw stream is parsed.

Prism's core `ProviderEvent` union has no generic telemetry event, so NeuralWatt
exposes telemetry through package-specific helpers:

- `neuralWattEventsWithTelemetry(body)` yields the standard provider events plus
  `neuralwatt:telemetry` events (`{ type: "neuralwatt:telemetry", energy?, cost? }`)
  in stream order. Use it when a host wants to observe telemetry alongside text,
  tool, usage, and done events.
- `parseNeuralWattComment(text)` parses a single `: energy`/`: cost` comment line
  into a `NeuralWattTelemetryEvent` (`undefined` for unknown/malformed comments).
- `parseNeuralWattEnergy(payload)` / `parseNeuralWattCost(payload)` parse the JSON
  payload of a single comment into typed `NeuralWattEnergyTelemetry` /
  `NeuralWattCostTelemetry`.
- `mapNeuralWattTelemetry(body)` maps a non-streaming response body's top-level
  `energy`/`cost` fields into the same typed telemetry.

`generate()` stays streaming-only and uses `neuralWattEvents()`, so telemetry is
opt-in via `neuralWattEventsWithTelemetry()`. Telemetry contains usage/cost
numbers only — never prompts, API keys, or headers. All documented fields are
optional and tolerated when absent; malformed comments yield no telemetry event
and never crash the stream.

```ts
import { neuralWattEventsWithTelemetry } from "@arnilo/prism-provider-neuralwatt";

for await (const event of neuralWattEventsWithTelemetry(response.body)) {
  if (event.type === "neuralwatt:telemetry") {
    console.log(event.energy?.energy_kwh, event.cost?.request_cost_usd);
  }
}
```

### Retry classification

NeuralWatt error responses are classified by `classifyNeuralWattError()` so the
Prism runtime retry policy can decide retryability without provider-specific
core branches:

| Status | Retryable | Notes |
| --- | --- | --- |
| `400` `401` `402` `403` `404` | no | Client/payment/auth errors fail closed. |
| `429` | yes | Reads `Retry-After` header and `error.retry_after`; preserves `error.retry_strategy` (`type`, `suggested_initial_delay_s`, `max_delay_s`, `backoff`, `jitter`). |
| `500` `502` `503` | yes | Transient server/fleet-capacity errors; `503` `Retry-After` honored when present. |

The provider emits `providerError` with `ErrorInfo.code` set to the numeric HTTP
status. Prism's default retry policy (`createDefaultRetryPolicy()`) treats `429`/
`500`/`502`/`503` as transient and `400`/`401`/`402`/`403`/`404` as non-transient,
so NeuralWatt errors retry correctly out of the box. `classifyNeuralWattError()`
and `neuralWattHttpError()` are exported for hosts/tests that want structured
retry metadata (`retryAfterMs`, `errorCode`, `strategy`). The host retry policy
owns the exact delay; `retryAfterMs` is surfaced but not enforced by the
provider. Classification is O(1) over status/headers/body and makes no extra
provider calls.

```ts
import { classifyNeuralWattError } from "@arnilo/prism-provider-neuralwatt";

const decision = classifyNeuralWattError({ status: 429, headers: { "retry-after": "1" }, body: { error: { code: "concurrent_budget_exceeded", retry_after: 1 } } });
// { retryable: true, code: 429, retryAfterMs: 1000, errorCode: "concurrent_budget_exceeded", strategy: undefined }
```

## Security and performance notes

- No network calls during import, setup, build, default tests, or generation beyond
  the explicit Chat Completions request. `listNeuralWattModels()` is opt-in and
  makes one `GET /v1/models` call per invocation; `getNeuralWattQuota()` is opt-in
  and makes one `GET /v1/quota` call per invocation (endpoint limited to 1 rps per
  customer; caller owns throttling).
- No automatic environment, file, keychain, or shell credential lookup.
- API keys are resolved per request/helper call from caller-supplied values or resolvers
  and redacted from errors via `redactSecrets`. `listNeuralWattModels()` and
  `getNeuralWattQuota()` apply provider-owned `authorization` after caller headers so
  callers cannot override it. Quota values never enter provider events unless the caller
  emits them.
- Caller-supplied `ProviderRequest.options.headers` can add non-owned headers,
  but provider-owned headers (`content-type`, `authorization`) are applied last
  and cannot be overridden by caller headers.
- Live tests stay opt-in behind `NEURALWATT_API_KEY` (plus `PRISM_LIVE_PROVIDER_TESTS=1`);
  default tests are network-free.

## Related APIs

- [Provider packages](../provider-packages.md): `defineProviderPackage`,
  `ModelConfig`/`compat`, thinking formats.
- [Credentials and redaction](../credentials-and-redaction.md):
  `resolveCredentialValue`, `redactSecrets`.
- [OpenAI-compatible provider](openai-compatible.md): underlying Chat Completions
  adapter.
- [Provider conformance](../provider-conformance.md): network-free adapter tests.
- [Provider caching](../provider-caching.md): implicit cache behavior and
  `cacheUsageReport`.
- [NeuralWatt agent example](../../examples/neuralwatt-agent-run.ts): runnable mocked
  agent turn with tools, reasoning controls, streamed cache tokens, and energy/cost telemetry.
