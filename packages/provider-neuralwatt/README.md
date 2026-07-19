# @arnilo/prism-provider-neuralwatt

NeuralWatt first-party provider package for Prism (OpenAI-compatible Chat Completions).

```ts
import { createExtensionKernel } from "@arnilo/prism";
import { createNeuralWattProviderPackage } from "@arnilo/prism-provider-neuralwatt";

const kernel = createExtensionKernel();
await kernel.load([createNeuralWattProviderPackage({ apiKey: "fake-neuralwatt-key" })]);
```

## Exports

- `createNeuralWattProviderPackage()` — inert provider package (provider + models + `api_key` auth).
- `createNeuralWattProvider()` — raw provider adapter.
- `defineNeuralWattModel()` — add custom NeuralWatt model configs.
- `neuralWattModels` — curated registry of official NeuralWatt featured aliases (`glm-5.2`, `glm-5.2-fast`, `glm-5.2-short`, `glm-5.2-short-fast`, `gemma-4-31b`, `kimi-k2.6`, `kimi-k2.6-fast`, `kimi-k2.7-code`, `qwen3.5-397b`, `qwen3.5-397b-fast`, `qwen3.6-35b`, `qwen3.6-35b-fast`).
- `listNeuralWattModels()` — explicit one-call `/v1/models` discovery helper that maps returned aliases to `ModelConfig`/`ModelCost`.
- `getNeuralWattQuota()` — explicit one-call `/v1/quota` helper returning typed account quota (`balance`, `usage`, `limits`, `subscription`, `key`). Requires an API key; caller owns throttling (1 rps per customer).
- `neuralWattBody()` / `neuralWattEvents()` / `toUsage()` — serializer, SSE parser, usage mapper.
- `neuralWattEventsWithTelemetry()` — like `neuralWattEvents()` but also yields `neuralwatt:telemetry` events parsed from `: energy` / `: cost` SSE comments.
- `parseNeuralWattComment()` / `parseNeuralWattEnergy()` / `parseNeuralWattCost()` / `mapNeuralWattTelemetry()` — energy/cost telemetry parsers for streaming comments and non-streaming top-level fields.
- `classifyNeuralWattError()` / `neuralWattHttpError()` — retry classifier for NeuralWatt status codes, `Retry-After`, and `retry_strategy`.

NeuralWatt-specific request fields flow through `ProviderRequestOptions.compat`/`extra`:
`reasoning_effort`, `thinking_token_budget`, `chat_template_kwargs` (including
`preserve_thinking` / `clear_thinking` per official gateway docs), and `tool_choice`.
Default base URL: `https://api.neuralwatt.com/v1`.

The static catalog records documented context windows, text/image input support, tool
calling, reasoning vs. fast variants, JSON-mode compat metadata, and implicit caching.
It does not guess `ModelConfig.cost`; exact per-alias input/output/cache-read prices
come from NeuralWatt's `/v1/models` response via `listNeuralWattModels()`.

```ts
import { listNeuralWattModels } from "@arnilo/prism-provider-neuralwatt";

const models = await listNeuralWattModels({ apiKey: "fake-neuralwatt-key", fetch });
```

```ts
import { getNeuralWattQuota } from "@arnilo/prism-provider-neuralwatt";

const quota = await getNeuralWattQuota({ apiKey: "fake-neuralwatt-key", fetch });
// quota.usage?.current_month?.energy_kwh, quota.balance?.balance_usd
```

Discovery is never called during package setup or generation.

### Energy and cost telemetry

NeuralWatt streams `: energy {...}` / `: cost {...}` as SSE comments and emits
top-level `energy`/`cost` fields on non-streaming responses. Standard SSE clients
ignore comments, so use `neuralWattEventsWithTelemetry()` (or the `parse*` /
`mapNeuralWattTelemetry()` helpers) to observe them. `generate()` uses
`neuralWattEvents()` and stays streaming-only, so telemetry is opt-in. Telemetry
carries usage/cost numbers only — never prompts, API keys, or headers.

## Security defaults

- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- API keys are resolved per request from caller-supplied values or resolvers and
  redacted from errors via `redactSecrets`.
- Provider-owned headers (`content-type`, `authorization`) are applied last and
  win over caller-supplied `ProviderRequest.options.headers`.
- Live tests are opt-in behind `NEURALWATT_API_KEY` (plus `PRISM_LIVE_PROVIDER_TESTS=1`);
  default tests are network-free.

## Cache behavior

- `cache: { kind: "implicit" }` — NeuralWatt prefix caching is automatic; no
  explicit cache payload (`cache_control`, `cacheKey`, `prompt_cache`, or
  `cacheRetention`) is sent regardless of cache options.
- `cacheRetention: "none"` disables Prism cache-control hints only; it does **not**
  disable the implicit backend prefix cache. Hosts relying on cache hits should
  keep their stable prompt prefix byte-stable.
- `prompt_tokens_details.cached_tokens` maps to `Usage.cacheReadTokens`. NeuralWatt
  does not report a cache-write token today, so `Usage.cacheWriteTokens` is never
  fabricated (stays `undefined`).

See [`docs/providers/neuralwatt.md`](../../docs/providers/neuralwatt.md) for the full
provider API page.
