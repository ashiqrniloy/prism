# Model registry

## What it does

The model registry stores explicit `ModelConfig` records by provider/model key. It keeps model metadata inert and host-owned: capabilities, limits, cost, cache support, provider compat data, parameters, and metadata are registered and resolved, not executed.

Public API:

- `createModelRegistry(models?, options?)`
- `ModelRegistry.register(model)`
- `ModelRegistry.get(provider, model)`
- `ModelRegistry.resolve(provider, model)`
- `ModelRegistry.list()`
- `ModelConfig.cache?: ModelCacheCapabilities`

## When to use it

Use the model registry when a host or provider package needs to:

- Fail closed when a provider/model is unknown.
- Publish model metadata from a provider package.
- Pick provider request behavior from generic metadata such as `ModelConfig.cache`.
- Keep pricing, limits, and capabilities near the model id without global state.

Do not use the registry for credential lookup, network model discovery, provider package discovery, or automatic SDK configuration.

## Inputs / request

```ts
import { createModelRegistry, type ModelConfig } from "@arnilo/prism";
```

`ModelConfig` metadata fields:

| Field | Purpose |
| --- | --- |
| `provider` / `model` | Required registry key. |
| `displayName` | Human-readable label. |
| `capabilities` | Input/output modes (`text`, `image`, `audio`, `file`, `document`) plus reasoning/tools/streaming booleans and optional `structuredOutput` (`true` or `"json_schema"`) for native JSON-schema requests. |
| `limits` | Context and output-token limits. |
| `cost` | Input/output/cache read/cache write pricing. |
| `cache` | Generic `ModelCacheCapabilities`. |
| `compat` | Provider-owned inert JSON escape hatch. |
| `parameters` | Host/provider default parameters. |
| `metadata` | Host-owned inert metadata. |

`ModelCacheCapabilities` fields:

| Field | Purpose |
| --- | --- |
| `kind` | `implicit`, `openai_key`, `cache_control`, `provider_specific`, or `none`. |
| `maxKeyLength` | Provider-safe cache key length. |
| `maxBreakpoints` | Maximum cache-control anchors. |
| `minCacheableTokens` | Minimum prompt size worth marking cacheable. |
| `longRetention` | Whether long retention is supported. |

## Outputs / response / events

`createModelRegistry()` returns a `ModelRegistry`:

| Method | Result |
| --- | --- |
| `register(model)` | Stores or replaces model. With `duplicate: "error"`, throws on duplicate key. |
| `get(provider, model)` | Returns `ModelConfig | undefined`. |
| `resolve(provider, model)` | Returns `ModelConfig` or throws `Unknown model: <provider>/<model>`. |
| `list()` | Returns registered models in insertion order. |

The registry emits no events and performs no I/O.

## Request/response example

```json
{
  "model": {
    "provider": "demo",
    "model": "demo-large",
    "capabilities": { "input": ["text", "image", "audio", "file", "document"], "tools": true, "streaming": true },
    "limits": { "contextWindow": 128000, "maxOutputTokens": 8192 },
    "cost": { "input": 10, "output": 30, "cacheRead": 2, "currency": "USD", "unit": "1M tokens" },
    "cache": { "kind": "cache_control", "maxBreakpoints": 4, "longRetention": true }
  }
}
```

## Implementation example

```ts
import { createModelRegistry, type ModelConfig } from "@arnilo/prism";

const model: ModelConfig = {
  provider: "demo",
  model: "demo-large",
  displayName: "Demo Large",
  capabilities: { input: ["text", "document"], output: ["text"], tools: true, streaming: true },
  limits: { contextWindow: 128_000, maxOutputTokens: 8_192 },
  cost: { input: 10, output: 30, cacheRead: 2, cacheWrite: 12, currency: "USD", unit: "1M tokens" },
  cache: { kind: "cache_control", maxBreakpoints: 4, minCacheableTokens: 1024, longRetention: true },
};

const registry = createModelRegistry([model], { duplicate: "error" });
const resolved = registry.resolve("demo", "demo-large");
```

## Extension and configuration notes

Provider packages register models through `ProviderPackageAPI.registerModel(model)`. The extension kernel stores those records in the host-owned registries. Static package metadata is allowed; dynamic model discovery remains provider/host code outside Prism core.

`ModelConfig.compat` remains for provider-owned inert JSON. Prefer typed fields (`capabilities`, `limits`, `cost`, `cache`) for generic behavior shared across providers.

### Model-list/capability discovery with provenance

`ModelDiscovery` (plan 062) is the normalized `listModels()` seam: it returns the existing `ModelConfig` contract verbatim (id = `model`, context window = `limits`, pricing hint = `cost`) plus `provenance` (`provider`, `fetchedAt` ISO timestamp, `source: "api" | "catalog"`, and `ttlMs` cache guidance). Discovery execution stays provider/host code — Prism core ships only the result types; adapters live in `@arnilo/prism-providers/model-discovery`:

```ts
import { createOpenAiCompatibleModelDiscovery, createGoogleModelDiscovery, createFakeModelDiscovery, runModelDiscoveryConformance } from "@arnilo/prism-providers/model-discovery";

const discovery = createOpenAiCompatibleModelDiscovery({
  baseUrl: "https://gw.internal/v1", // GET <baseUrl>/models
  apiKey, // CredentialValueSource — sent as Bearer, resolved via the existing credential seam
  catalog: registry.list(), // host overrides merged by model id; catalog fields win
});
const { models, provenance } = await discovery.listModels({ ttlMs: 3_600_000 });

// Independent provider: Google Gemini `GET <baseUrl>/v1beta/models` (x-goog-api-key), paginated:
const google = createGoogleModelDiscovery({ apiKey: gcpKey });

// Network-free fake + conformance for any ModelDiscovery implementation:
await runModelDiscoveryConformance(() => createFakeModelDiscovery());
```

- Passthrough normalization: entries the provider does not describe stay bare (`{provider, model}`); there is no hard-coded catalog in core or adapters. Hosts merge catalog overrides (`capabilities`/`limits`/`cost`/`displayName`) over normalized entries by model id via the `catalog` option.
- Results cache per discovery instance within the configured TTL (default 3,600,000 ms). `listModels()` in loops performs no network until the TTL expires; `ttlMs: 0` forces a refresh. The provenance `fetchedAt`/`ttlMs` fields let hosts layer their own caching on top.
- `ModelDiscoveryError` is the typed failure (provider label + HTTP status); credentials are resolved through the existing `CredentialValueSource` seam, redacted from every error message, and responses are byte-bounded through the shared provider transport.

## Security and performance notes

- Model metadata must not contain credentials or secrets.
- Declare truthful `capabilities.input` tags. Prism core rejects undeclared modalities in `assembleProviderInput()` when the list is present.
- Registration is in-memory and O(1) by provider/model key.
- `ModelConfig.cache` is declarative capability info only; it does not grant permissions, select tools, or bypass auth.
- Model-discovery listings are untrusted metadata: normalized entries carry no tool authority, cached results stay per discovery instance (no cross-provider cache bleed), and discovery requests reuse the bounded transport with credential redaction. Catalog overrides come from host-owned registries only — provider responses never write into the host's `ModelRegistry` without host code in between.
- Provider-specific behavior belongs in provider packages, not Prism core.

## Related APIs

- [Multimodal content](multimodal-content.md): `audio`/`file`/`document` blocks and `MODEL_INPUT_CAPABILITIES`.
- [Provider layer](provider-layer.md): provider/model registry overview.
- [Provider caching](provider-caching.md): `ModelCacheCapabilities` and cache helpers.
- [Provider packages](provider-packages.md): package registration of model metadata.
- [Public contracts](public-contracts.md): `ModelConfig`, `ModelCost`, and cache type contracts.
- [Provider layer](provider-layer.md): `ModelDiscovery` adapters, provenance, and TTL semantics.
