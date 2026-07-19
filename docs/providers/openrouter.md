# OpenRouter provider package

## What it does

`@arnilo/prism-provider-openrouter` provides explicit, side-effect-free setup for the
OpenRouter API-key provider with **app-controlled** model registration, routing
passthrough, official `reasoning` controls, and Anthropic-style `cache_control`
(plus sticky `session_id` routing).

The package registers a provider, caller-supplied model metadata, and an
`api_key` auth method through `createExtensionKernel().load([...])`. There is
**no bundled mega-catalog**. Optional `listOpenRouterModels()` lets hosts fetch
the live official catalog and pass a filtered subset via `models:` — setup
itself never fetches.

## When to use it

Use it when a host app wants OpenRouter routing passthrough, reasoning controls,
and per-model cache policy through Prism's `AgentSession` runtime, and needs to
override cache behavior per model rather than accept a single hard-coded policy.

Do not use it for automatic catalog fetch during setup, automatic credential
discovery, or real-network tests in CI defaults.

## Inputs / request

```ts
import {
  createOpenRouterProviderPackage,
  defineOpenRouterModel,
  listOpenRouterModels,
} from "@arnilo/prism-provider-openrouter";

createOpenRouterProviderPackage(options: OpenRouterProviderPackageOptions): ProviderPackage
defineOpenRouterModel(config: OpenRouterModelConfig): ModelConfig
listOpenRouterModels(options?: ListOpenRouterModelsOptions): Promise<ModelConfig[]>
mapOpenRouterModel(entry: OpenRouterModelEntry): ModelConfig
```

| Field | Type | Purpose |
| --- | --- | --- |
| `apiKey` | `CredentialValueSource` | Direct/callback/resolver API-key source. |
| `fetch` | `typeof fetch` | Optional fetch implementation for tests/hosts. |
| `baseUrl` | `string` | Overrides the OpenRouter base URL. |
| `appUrl` | `string` | App URL for attribution `HTTP-Referer` header. |
| `appTitle` | `string` | App title for the `X-Title` attribution header. |
| `models` | `readonly ModelConfig[]` | App-supplied model catalog (no default fetch). |

`OpenRouterModelConfig.compat.openRouterRouting` controls routing order /
`data_collection`. `compat.reasoning` carries the official OpenRouter
`reasoning` object (`effort`, `max_tokens`, `exclude`, …). Per-turn
`providerOptions.compat.reasoning` merges over model defaults (request wins
key-by-key). `compat.preserveThinking` replays assistant thinking as body
`reasoning` for tool-call continuity.

## Outputs / response / events

| Surface | Behavior |
| --- | --- |
| Provider stream | Prism text, thinking (`delta.reasoning` / `reasoning_content`), tool-call delta/final, `usage` (with cache read/write mapped), `done`, redacted `error`. |
| Attribution | `HTTP-Referer`/`X-Title` headers sent only when `appUrl`/`appTitle` are supplied. |
| Auth method | `api_key` for `openrouter`, credential name `apiKey`. |

## Request/response example

Per-model routing + reasoning override:

```json
{
  "model": "anthropic/claude-sonnet-4",
  "provider": { "order": ["anthropic"], "data_collection": "deny" },
  "reasoning": { "effort": "high" },
  "session_id": "session-with-spaces",
  "cache_control": { "type": "ephemeral" }
}
```

## Implementation example

```ts
import { createExtensionKernel } from "@arnilo/prism";
import {
  createOpenRouterProviderPackage,
  defineOpenRouterModel,
  listOpenRouterModels,
} from "@arnilo/prism-provider-openrouter";

// App-controlled registration (default — no fetch):
const sonnet = defineOpenRouterModel({
  model: "anthropic/claude-sonnet-4",
  compat: {
    openRouterRouting: { order: ["anthropic"], data_collection: "deny" },
    openRouterCache: true,
    reasoning: { effort: "medium" },
  },
});

// Optional live discovery — caller-gated, never run by setup:
const live = await listOpenRouterModels({ apiKey: process.env.OPENROUTER_API_KEY });
const filtered = live.filter((m) => m.model.startsWith("anthropic/"));

const kernel = createExtensionKernel();
await kernel.load([
  createOpenRouterProviderPackage({
    apiKey: process.env.OPENROUTER_API_KEY,
    models: filtered.length ? filtered : [sonnet],
  }),
]);
```

## Extension and configuration notes

- Apps supply the model catalog via `models`; no catalog is fetched during setup.
- `listOpenRouterModels()` is the official `GET https://openrouter.ai/api/v1/models`
  helper (auth optional for the public catalog). Map pricing/context/modalities/
  reasoning metadata into `ModelConfig`; hosts still decide what to register.
- `defineOpenRouterModel` lets apps override cache policy and routing per model.
- Hosts choose base URL, attribution, credential source, and `fetch` impl.
- Package contributes models and an `api_key` auth method.

### Reasoning

- Body field is the official OpenRouter `reasoning` object
  (`effort`: `max`/`xhigh`/`high`/`medium`/`low`/`minimal`/`none`, plus
  `max_tokens`, `exclude`, `enabled`, `context`, `mode` as documented).
- Model `compat.reasoning` defaults merge with per-turn `options.compat.reasoning`
  (request keys win). Task 4 `applyThinkingLevel(..., "openai_reasoning")` writes
  `{ reasoning: { effort } }` into that path.
- Owned compat keys (`reasoning`, `openRouterRouting`, `openRouterCache`,
  `preserveThinking`) are stripped from opaque compat spreads so resolved values
  cannot be overwritten accidentally.
- When `preserveThinking` is enabled (default for reasoning-capable models),
  assistant `thinking` blocks replay as top-level `reasoning` — not folded into
  text — matching OpenRouter's tool-call continuity guidance.

### Cache and session behavior

- `session_id` (request body) and the `X-Session-Id` header are derived from
  `ProviderRequestOptions.cacheKey` (falling back to `sessionId`) and sanitized
  + clamped to 256 characters via the shared `sanitizeCacheKey()` helper.
  OpenRouter uses this for provider sticky routing to maximize cache hits.
- **Automatic caching** (no breakpoints): when caching is enabled for an
  explicit `cache_control` model (or `compat.openRouterCache` /
  `cache.mode: "on"`), Prism emits a top-level
  `cache_control: { type: "ephemeral" }` per OpenRouter's Anthropic automatic
  caching docs. Note: top-level `cache_control` can exclude some backends
  (e.g. Bedrock/Vertex) from routing.
- **Explicit breakpoints**: Anthropic-style markers are applied only to the
  Prism `PromptCacheBreakpoint` locations the caller selects via
  `ProviderRequestOptions.cache.breakpoints` (last content block of each
  selected message). When breakpoints are present, top-level automatic
  `cache_control` is omitted.
- Caching is enabled unless disabled (`cacheRetention: "none"` /
  `cache.mode: "off"`) and the model opts in via `ModelConfig.cache.kind`
  (`"cache_control"`) or the legacy `compat.openRouterCache: true` flag.
- `cacheRetention: "long"` (or `cache.retention: "long"`) emits
  `ttl: "1h"` on markers / top-level automatic control when the model allows
  long retention (`ModelConfig.cache.longRetention !== false`).
- Usage accounting: OpenRouter `prompt_tokens_details.cached_tokens` →
  `Usage.cacheReadTokens`; `prompt_tokens_details.cache_write_tokens` →
  `Usage.cacheWriteTokens`.

### Model discovery

```ts
const models = await listOpenRouterModels({ apiKey, fetch, signal, baseUrl });
createOpenRouterProviderPackage({ apiKey, models: models.filter(...) });
```

`mapOpenRouterModel` converts official per-token USD pricing to
`ModelCost` with `unit: "per_million_tokens"`, infers `cache.kind` (`cache_control`
for Anthropic/Qwen/Gemini families with cache pricing; otherwise `implicit` when
cache-read pricing exists), and seeds `compat.reasoning.effort` from
`reasoning.default_effort` when present.

## Security and performance notes

- SSE streams and HTTP error bodies use bounded `@arnilo/prism/providers/transport` helpers (`readSseData`, `readBoundedResponseText`).
- No catalog fetch during setup; discovery is caller-gated and bounded.
- No automatic environment, file, keychain, or shell credential lookup.
- API keys are resolved per request from caller-supplied values or resolvers and
  redacted from errors (including discovery failures).
- Caller-supplied `ProviderRequest.options.headers` can add non-owned headers,
  but OpenRouter-owned headers are applied last: `Authorization`,
  `Content-Type`, `X-Session-Id`, `HTTP-Referer`, and `X-Title` cannot be
  overridden by caller headers.
- Attribution headers are sent only when `appUrl`/`appTitle` are supplied — no
  hidden app identity.
- Live tests stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1` plus fake-safe
  provider-specific env names; default tests are network-free.

## Related APIs

- [Provider packages](../provider-packages.md): `defineProviderPackage`,
  `ModelConfig`/`compat`, cache policy, caller-gated discovery.
- [Thinking and reasoning](../thinking-and-reasoning.md): `applyThinkingLevel`
  / `openai_reasoning` family for OpenRouter.
- [Credentials and redaction](../credentials-and-redaction.md):
  `resolveCredentialValue`, `redactSecrets`.
- [Provider layer](../provider-layer.md): `ProviderRequest.options` and usage
  mapping.
- [Provider conformance](../provider-conformance.md): network-free adapter tests.
- Official: [Models API](https://openrouter.ai/docs/api/api-reference/models/get-models),
  [Prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching),
  [Reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).
