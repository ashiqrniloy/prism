# Provider packages

## What it does

Provider package primitives let a host or extension register provider-related contributions explicitly:

- `defineProviderPackage()`: validates and returns an inert provider package definition.
- `ProviderPackage`: package metadata plus a `setup(api)` callback.
- `ModelConfig` metadata: `displayName`, `capabilities`, `limits`, `cost`, opaque `compat`, and `metadata`.
- New contribution registries and `ExtensionAPI` methods for provider packages, auth methods, provider request policies, and system prompt contributions.
- Auth method descriptors for API-key, OAuth, and custom provider auth flows.

These primitives do not load packages, discover manifests, read credentials, refresh OAuth tokens, or call providers.

## When to use it

Use provider packages when a host wants to bundle model metadata, provider adapters, auth descriptors, cache/request policies, or prompt contributions behind one explicit setup call.

Do not use provider packages as a package manager, credential store, env loader, provider-specific cache implementation, or live integration runner.

### Subscription OAuth support matrix

| Package | 0.0.12 auth registration | Subscription OAuth boundary |
| --- | --- | --- |
| `@arnilo/prism-providers/openai` | `api_key` for `openai`; `oauth` for `openai-codex` | Existing host-invoked OpenAI Codex PKCE/device-code flow only. |
| `@arnilo/prism-providers/xai` | `api_key` and `oauth` for `xai` | Host-invoked SuperGrok / X Premium RFC 8628 device-code against `auth.x.ai`. Public Grok CLI client id is not a secret. No PKCE loopback, no `~/.grok` import, no `cli-chat-proxy.grok.com`. |
| `@arnilo/prism-providers/deepseek` | `api_key` only | No subscription OAuth. |
| `@arnilo/prism-providers/clinepass` | `api_key` only | No Cline WorkOS / Cline OAuth store share. Host supplies `CLINE_API_KEY`. |
| `@arnilo/prism-providers/anthropic` | `api_key` only | No Claude Code/Claude.ai subscription OAuth, credential-file/setup-token import, or routing. [Anthropic requires product developers to use API keys or supported cloud providers](https://docs.anthropic.com/en/docs/claude-code/legal-and-compliance). |
| `@arnilo/prism-providers/google` | `api_key` only | No Gemini CLI OAuth or credential/token import. [Gemini CLI prohibits third-party OAuth piggybacking](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md); use Google AI Studio API keys. Vertex/ADC uses separate [`@arnilo/prism-providers/vertex`](providers/vertex.md). |
| `@arnilo/prism-providers/azure` | host Entra token or Azure resource key | Workload identity via `credential` callback; endpoint host preserved ([docs](providers/azure.md)). |
| `@arnilo/prism-providers/bedrock` | host IAM/IRSA credentials | SigV4 over OpenAI-compatible Bedrock Runtime; region/PrivateLink preserved ([docs](providers/bedrock.md)). |
| `@arnilo/prism-providers/vertex` | host ADC / workload token | OpenAPI-compatible Vertex endpoint; separate from consumer Google package ([docs](providers/vertex.md)). |

A future provider-local OAuth package must first have explicit third-party permission and documented authorize/token/refresh flow. Before it registers an OAuth descriptor, it must add bounded request/response, abort, PKCE/state where required, expiry/refresh, secret-redaction, durable-store round-trip, and offline protocol tests. Do not add a generic OAuth framework, CLI credential scanner, automatic refresh timer, or success stub.

## Inputs / request

```ts
import { defineProviderPackage } from "@arnilo/prism";

export default defineProviderPackage({
  name: "demo-provider",
  setup(api) {
    api.registerProvider(provider);
    api.registerModel({
      provider: "demo",
      model: "demo-large",
      displayName: "Demo Large",
      capabilities: { input: ["text"], reasoning: true, tools: true },
      limits: { contextWindow: 128_000, maxOutputTokens: 8_192 },
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, currency: "USD" },
      compat: { vendorSpecific: true },
    });
  },
});
```

`compat` is provider-owned inert JSON. Core does not branch on provider names or interpret vendor-specific fields.

Provider packages can also contribute auth descriptors and request policies without resolving credentials:

```ts
import { createSessionCachePolicy } from "@arnilo/prism";

api.registerAuthMethod({ provider: "demo", kind: "api_key", credentialName: "apiKey" });
api.registerAuthMethod({ provider: "demo", kind: "oauth", oauth: demoOAuthProvider });
api.registerProviderRequestPolicy(createSessionCachePolicy({ retention: "short" }));
api.registerSystemPromptContribution({ id: "demo-prompt", source: "package", mode: "append", text: "Use demo provider rules." });
```

Hosts decide which credential resolvers, env objects, OAuth stores, request policies, and prompt contributions become active. Request policies can set generic `ProviderRequest.options` such as `sessionId`, `cacheRetention`, `headers`, `compat`, and opaque `extra`; provider adapters decide how to map those options to provider payloads. Caller headers are extension headers only: provider adapters must apply provider-owned headers (auth, content type, session/cache/security, attribution) after caller headers so requests cannot override credentials or provider policy.

Provider request options: `ProviderRequestOptions` carries session/cache/header/compat/extra hints only. Timeouts are host-owned (`RunOptions.signal`/host abort controllers); retries are runtime-owned (`AgentConfig.retry`/`RunOptions.retry`). Provider-level timeout/retry hints were removed in 0.1.5. Provider packages should not add provider-specific retry loops unless the vendor protocol requires it and runtime retry cannot cover the failure mode.

First-party providers map generic `ModelConfig.parameters.maxTokens` to real output-token request fields instead of sending `maxTokens` on the wire: OpenAI Responses uses `max_output_tokens`; ClinePass uses `max_completion_tokens`; OpenRouter, OpenCode Go, Z.AI, Kimi, NeuralWatt, DeepSeek, and xAI use `max_tokens`. Other `model.parameters` values pass through unchanged unless the provider docs say otherwise.

## First-party provider package skeletons

Scaffold new OpenAI-compatible provider packages with `prism providers add <name>` (see [CLI/RPC](cli-rpc.md#prism-providers-add-017)): it generates the manifest, provider (`createOpenAICompatibleProvider`), starter models, cache-hint helpers, an offline conformance test, and a docs stub — mirroring the first-party skeleton conventions below. Scaffold output is host-chosen and never auto-registered.

Phase 12 adds explicit npm workspaces for [`@arnilo/prism-providers/openai`](providers/openai.md), [`@arnilo/prism-providers/opencode-go`](providers/opencode-go.md), [`@arnilo/prism-providers/openrouter`](providers/openrouter.md), [`@arnilo/prism-providers/zai`](providers/zai.md), [`@arnilo/prism-providers/kimi`](providers/kimi.md), and [`@arnilo/prism-providers/neuralwatt`](providers/neuralwatt.md). Each package starts with a side-effect-free `create*ProviderPackage()` export, README, TypeScript build, network-free default tests, and real opt-in live smoke tests.

Phase 6 also adds optional [`@arnilo/prism-providers/ai-sdk`](providers/ai-sdk.md), which adapts a host-owned AI SDK `LanguageModelV4` to Prism's `AIProvider`. It joins `@arnilo/prism-providers` as the seventh adapter while remaining independent from the six HTTP implementations.

Provider live tests are real smoke tests gated by `PRISM_LIVE_PROVIDER_TESTS=1` plus the provider-specific API key (`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `KIMI_API_KEY`, `ZAI_API_KEY`, `NEURALWATT_API_KEY`, `OPENCODE_API_KEY`, `DEEPSEEK_API_KEY`, `XAI_API_KEY`, or `CLINE_API_KEY`). They cover text generation, tool-call loop behavior, abort/error paths where supported, and no-secret-leak assertions; they skip by default and never run in release verification. SuperGrok login is operator-only (`PRISM_LIVE_XAI_OAUTH=1`).

These workspaces still follow the same rule as external packages: no provider SDK dependency, catalog fetch, env scan, keychain/file credential lookup, shell auth command, OAuth login, or live provider call runs by default. `@arnilo/prism-providers/openai` now registers OpenAI Responses and OpenAI Codex providers from caller-supplied credentials only, with optional `models`/`codexModels` overrides and an opt-in `listOpenAIModels()` helper for official `GET /models` discovery. `@arnilo/prism-providers/opencode-go` now registers docs-verified OpenCode Go open coding models with dual OpenAI/Anthropic routes (`compat.route`), official default base `https://opencode.ai/zen/go/v1`, `reasoning_content`/thinking preserve, and an opt-in `listOpenCodeGoModels()` helper for official `GET /zen/go/v1/models`. `@arnilo/prism-providers/openrouter` now registers an app-controlled OpenRouter catalog with routing/`reasoning`/cache passthrough, assistant `reasoning` replay, optional top-level automatic `cache_control`, and an opt-in `listOpenRouterModels()` helper for official `GET /api/v1/models` (setup still never fetches). `@arnilo/prism-providers/zai` now registers featured GLM-5.x/4.x metadata with official `thinking`/`reasoning_effort`/`tool_stream`/`clear_thinking` mapping, Preserved Thinking `reasoning_content` replay, implicit context caching, and an opt-in `listZaiModels()` helper for OpenAI-compatible `GET /models`. `@arnilo/prism-providers/kimi` now registers Kimi Coding Anthropic-compatible behavior by default, optional callable Moonshot Open Platform Chat Completions when `includeMoonshotModels` is requested, official Coding/Open Platform featured ids, thinking/`reasoning_effort` compat mapping, and an opt-in `listKimiModels()` helper for Moonshot `GET /v1/models`. `@arnilo/prism-providers/neuralwatt` now registers static featured model metadata with NeuralWatt reasoning_effort/thinking_token_budget/chat_template_kwargs request mapping, SSE comment tolerance, an opt-in `listNeuralWattModels()` helper for explicit `/v1/models` discovery, `getNeuralWattQuota()` for on-demand account balance/usage/energy, `neuralWattEventsWithTelemetry()`/`mapNeuralWattTelemetry()` for `: energy`/`: cost` telemetry, and `classifyNeuralWattError()` for retry classification. None of these helpers run during package setup or generation. `@arnilo/prism-providers/deepseek` registers featured `deepseek-v4-flash` / `deepseek-v4-pro` with official `thinking` / `reasoning_effort`, tool-turn `reasoning_content` replay, implicit prefix cache, and caller-gated `listDeepSeekModels`. `@arnilo/prism-providers/xai` registers featured Completions (`grok-4.6` / `grok-4.3` / `grok-build-0.1`), `x-grok-conv-id`, `reasoning_content` replay, caller-gated `listXaiModels`, and host-invoked SuperGrok device-code OAuth against `auth.x.ai`. `@arnilo/prism-providers/clinepass` registers a static `cline-pass/*` catalog, stream-only Chat Completions, per-model `reasoning_effort` maps, and `api_key` only (no WorkOS, no `listClinePassModels`). `@arnilo/prism-providers/anthropic` registers native Anthropic Messages (`createAnthropicProviderPackage` / `listAnthropicModels`). `@arnilo/prism-providers/google` registers native Gemini `generateContent` streaming (`createGoogleProviderPackage` / `listGoogleModels`; Vertex identity stays in the separate package). Both follow the same zero-setup-network / host-owned credential / provider-owned-header rules; see [`docs/providers/anthropic.md`](providers/anthropic.md) and [`docs/providers/google.md`](providers/google.md).

### Phase 10 compatibility matrix

Every package remains explicit, setup-zero-fetch, and late-credential-bound. `ModelConfig.capabilities.input` is authoritative: a listed wire mapping is usable only when the selected model declares that tag; unsupported blocks reject before provider I/O. “Protected” means an operator/release-environment probe, never default CI; its exact key/command boundary is in [Release and install](release-and-install.md#015-protected-live-canary-matrix).

| Package | Protocol / model source | Content mapping | Stream, tools, and reasoning | Cache / canary |
| --- | --- | --- | --- | --- |
| OpenAI | Responses; featured or caller-gated `listOpenAIModels` | text, image, audio, file, document | Host and provider-hosted tools; 8-hop continuation; Realtime seam; Responses reasoning | `openai_key`; checked-in standard smoke + protected hosted/Realtime probe |
| AI SDK | Host `LanguageModelV4`; no Prism catalog | declared text/image/audio/file/document prompt parts (role-limited) | v4 mapping; provider-executed tool authority; host-owned reasoning | host-owned; exact 4.0.4 matrix (`4.0.3` also listed); protected host integration |
| Anthropic | Messages; caller-gated list | text, image, PDF document/file | tool deltas, thinking | `cache_control`; protected API-key smoke |
| Google | Gemini `generateContent`; caller-gated list | text, image, audio, document/file | complete tool calls, thinking | no Prism cache marker; protected API-key smoke |
| Kimi | Coding Messages or opt-in Moonshot; caller-gated list | text, image, PDF document/file by route/model | tool deltas, route-native thinking replay | implicit / optional Anthropic markers; protected API-key smoke |
| Z.AI | OpenAI-compatible; caller-gated list | text, image | tool deltas, `reasoning_content` | implicit; protected API-key smoke |
| OpenRouter | OpenAI-compatible; host catalog + caller-gated list | text, image | tool deltas, reasoning replay/routing metadata | `cache_control`; protected API-key smoke |
| OpenCode Go | OpenAI or Anthropic route; caller-gated list | text/image OpenAI route; PDF document/file Anthropic route | tool deltas, route-native thinking | route-specific; protected API-key smoke |
| Alibaba | DashScope OpenAI-compatible; caller-gated list | text, image | tool deltas, Qwen thinking | implicit / optional markers; protected host probe |
| Ollama | Cloud/local OpenAI-compatible; caller-gated list | text, image | tool deltas, reasoning effort | implicit only; protected host/daemon probe |
| NeuralWatt | OpenAI-compatible; caller-gated list | text, image | tool deltas, reasoning and telemetry | implicit; protected API-key smoke |
| DeepSeek | OpenAI-compatible; caller-gated list | text | tool deltas, `reasoning_content` on tool turns | implicit; protected API-key smoke |
| xAI | OpenAI-compatible Completions; caller-gated list | text, image | tool deltas, `reasoning_content` replay | implicit + `x-grok-conv-id`; protected API-key smoke; SuperGrok login operator-only |
| ClinePass | OpenAI-compatible stream-only; static `cline-pass/*` catalog | text | tool deltas, per-model `reasoning_effort` | implicit; protected API-key smoke |
| Azure | Azure/Foundry OpenAI-compatible; host models | selected endpoint/model capability | normalized OpenAI-compatible tools | no Prism cache mapping; protected host workload-identity probe |
| Bedrock | Bedrock OpenAI-compatible; host models | selected endpoint/model capability | normalized OpenAI-compatible tools | no Prism cache mapping; protected host IAM/IRSA probe |
| Vertex | Vertex OpenAPI-compatible; host models | selected endpoint/model capability | normalized OpenAI-compatible tools | no Prism cache mapping; protected host ADC/WIF probe |

### First-party cache behavior

Every first-party provider package hardens prompt-cache behavior so it cannot emit invalid cache retention values or over-broad cache-control markers, and so provider-owned `authorization`/session/security headers cannot be overridden by caller `ProviderRequest.options.headers`. Cache behavior is provider-specific and best-effort: OpenAI/OpenRouter use explicit hints, NeuralWatt/Z.AI/DeepSeek/ClinePass use implicit caching, xAI adds a sanitized `x-grok-conv-id`, and OpenCode Go/Kimi are route/model-dependent. See [Provider caching](provider-caching.md#per-provider-cache-behavior) for the canonical explicit/implicit matrix.

- **OpenAI** (`kind: openai_key`): `prompt_cache_key` is sanitized and clamped to 64 chars. Pre-GPT-5.6 models emit `prompt_cache_retention: "24h"` when the model declares `cache.longRetention`; GPT-5.6+ models (`cache.explicitBreakpoints`) map `cache.breakpoints` / `cache.mode: "on"` to `prompt_cache_options: { mode: "explicit" }` with `prompt_cache_breakpoint` markers on selected anchors. `input_tokens_details.cached_tokens`/`cache_write_tokens` map to `Usage.cacheReadTokens`/`Usage.cacheWriteTokens`.
- **OpenAI-compatible core adapter**: Chat Completions sends no `prompt_cache_key`/`prompt_cache_retention`/`cache_control` fields; endpoints cache implicitly. `prompt_tokens_details.cached_tokens` maps to `Usage.cacheReadTokens`.
- **OpenRouter** (`kind: cache_control`): `session_id`/`x-session-id` sanitized and clamped to 256 chars; with no breakpoints, emits top-level automatic `cache_control: { type: ephemeral }`; with breakpoints, markers applied only to caller-selected locations (not every block); `cacheRetention: long` adds `ttl: 1h` when allowed. Preserves `cached_tokens`/`cache_write_tokens`.
- **OpenCode Go**: default base `https://opencode.ai/zen/go/v1`; `x-opencode-session` from `cacheKey ?? sessionId` sanitized to 128 chars; Anthropic route (MiniMax/Qwen) applies `cache_control` only to selected breakpoints (`long` → `ttl: 1h`); OpenAI route (Grok/GLM/Kimi/MiMo/DeepSeek) sends none and preserves `reasoning_content`. Per-route usage mapping. Caller-gated `listOpenCodeGoModels`.
- **Z.AI** (`kind: implicit`): GLM context caching is automatic; no explicit cache payload sent regardless of cache options. `prompt_tokens_details.cached_tokens`/`cache_write_tokens` map to cache usage.
- **NeuralWatt** (`kind: implicit`): NeuralWatt prefix caching is automatic; sends no explicit cache payload regardless of cache options. `cacheRetention: "none"` disables Prism cache-control hints only (not the implicit backend prefix cache). `prompt_tokens_details.cached_tokens` maps to `Usage.cacheReadTokens`; NeuralWatt does not report a cache-write token so `Usage.cacheWriteTokens` is never fabricated.
- **Kimi**: default catalog models use implicit caching (no `cache_control`); hosts opt in via `ModelConfig.cache.kind: cache_control` on the Anthropic `/messages` route, then markers apply only to selected breakpoints (`long` → `ttl: 1h`); the Moonshot OpenAI route sends none. `cache_read_input_tokens`/`cache_creation_input_tokens` map to cache usage.
- **Alibaba Cloud** (implicit by default, optional `cache_control`): DashScope implicit prefix caching is automatic; hosts opt in via `ModelConfig.cache.kind: cache_control`, then `cache_control: {"type":"ephemeral"}` markers apply only to selected breakpoints, capped at 4. `prompt_tokens_details.cached_tokens`/`cache_creation_input_tokens` map to cache usage. Caller-gated `listAlibabaModels`.
- **Ollama** (`kind: implicit`): Ollama KV/prefix caching is automatic with no request knob; sends no explicit cache payload. Ollama reports no cached-token count, so `Usage.cacheReadTokens` stays `undefined`. Caller-gated `listOllamaModels`.
- **DeepSeek** (`kind: implicit`): official prefix cache; no cache payload. Tool schemas canonicalized. `prompt_cache_hit_tokens` → `cacheReadTokens`. Caller-gated `listDeepSeekModels`.
- **xAI** (`kind: implicit`): prefix cache plus sanitized `x-grok-conv-id` (never a SuperGrok token). Replay `reasoning_content` on reasoning models. `cached_tokens` → `cacheReadTokens`. Caller-gated `listXaiModels`.
- **ClinePass** (`kind: implicit`): no cache payload; stream-only. `cached_tokens` / `prompt_cache_hit_tokens` map when present. Static `cline-pass/*` catalog.

See [Provider caching](provider-caching.md) for the `PromptCacheHints` surface and shared helpers, and [Provider conformance](provider-conformance.md) for the `assertUsageAccounting` and `assertProviderOwnedHeadersWin` checks every first-party package exercises.

## Caller-gated model discovery

First-party packages keep `create*ProviderPackage()` network-free. Latest models come from **caller-gated** `list*Models()` helpers that hosts invoke explicitly and then pass back via `models:` (or register themselves). Plan 015's "no setup catalog fetch" rule still holds; Plan 067 adds on-demand discovery without hidden latency.

### Contract

```ts
export async function listExampleModels(options: {
  apiKey?: CredentialValueSource;
  fetch?: typeof fetch;
  baseUrl?: string;
  signal?: AbortSignal;
  headers?: Readonly<Record<string, string>>;
}): Promise<ModelConfig[]> {
  // GET {baseUrl}/models — never called from create*ProviderPackage()
}
```

| Rule | Requirement |
| --- | --- |
| Setup | `create*ProviderPackage().setup` performs **zero** fetches / discovery calls |
| Shape | Package-local `list*Models(options) → Promise<ModelConfig[]>` + optional `map*Model(entry)` |
| Injectables | `fetch`, `baseUrl`, `signal`, optional `apiKey` / `headers` |
| Transport | Error bodies via `@arnilo/prism/providers/transport` `readBoundedResponseText`; credentials via `resolveCredentialValue` + `redactSecrets` |
| Return | `ModelConfig[]` only — never embed API keys, tokens, or auth headers in returned metadata |
| Static catalog | Featured aliases / offline bootstrap only; may omit live pricing until discovery fills `cost` / `cache` |
| Core | Prefer package-local helpers. Do **not** add a core model-discovery registry. Extract a shared HTTP/list helper only when ≥2 packages share identical parsing |

Template: [`listNeuralWattModels`](providers/neuralwatt.md) in `@arnilo/prism-providers/neuralwatt`.

### Per-package policy

| Package | Discovery helper | Setup catalog | Notes |
| --- | --- | --- | --- |
| OpenAI | **`listOpenAIModels` (exists)** | Featured Responses/Codex aliases; factory accepts `models?` / `codexModels?` | Official `GET /v1/models`; Codex not listed by api.openai.com |
| Kimi | **`listKimiModels`** (Moonshot `GET /v1/models`) | Featured Coding ids + optional callable Moonshot | Official Moonshot/Kimi list-models; Coding curated |
| Z.AI | **`listZaiModels`** (OpenAI-compatible `GET /models`) + curated featured refresh | Featured GLM-5.2…4.5 aliases | No first-class docs.z.ai list page; discovery is best-effort; featured set from Chat Completions enum / overview |
| OpenRouter | **`listOpenRouterModels`** (official `GET /api/v1/models`) | **App-controlled** `models:` only — no bundled mega-catalog | Helper feeds host registration; setup still does not fetch |
| OpenCode Go | **`listOpenCodeGoModels`** (official `GET /zen/go/v1/models`) | Featured dual-route official Go aliases | Official Go docs endpoint table + sparse list API |
| NeuralWatt | **`listNeuralWattModels` (exists)** | Featured aliases without guessed pricing | Auth optional for public models |
| AI SDK | None | Host-owned `LanguageModelV4` | No Prism-side catalog by design |
| DeepSeek | **`listDeepSeekModels`** (OpenAI-compatible `GET /models`) | Featured `deepseek-v4-flash` / `deepseek-v4-pro` | Official Completions catalog |
| xAI | **`listXaiModels`** (OpenAI-compatible `GET /models`) | Featured Completions (`grok-4.6` / `grok-4.3` / `grok-build-0.1`) | `grok-4.5` / Responses deferred |
| ClinePass | None | Static official `cline-pass/*` slugs | No documented `GET /models` |

Host pattern:

```ts
const models = await listNeuralWattModels({ apiKey, fetch });
await kernel.load([createNeuralWattProviderPackage({ apiKey, models })]);
```

Discovery may populate `ModelConfig.cache` and `ModelConfig.cost` from live metadata when the provider documents those fields; see [Provider caching](provider-caching.md#discovery-and-live-cache-cost-metadata). Package authors: include the [setup zero-fetch checklist](provider-conformance.md#model-discovery-checklist) in every first-party suite that ships or plans a `list*Models` helper.

## Per-turn thinking / reasoning

Hosts set effort with portable helpers from `@arnilo/prism` (`applyThinkingLevel`, `thinkingCompatFor`) that write official fields into `ProviderRequestOptions.compat`. Model defaults stay on `ModelConfig.compat`; per-turn patches win via `mergeProviderRequestOptions`. Providers keep reading `options.compat` / `model.compat` — do not invent a parallel options tree or put effort only in `extra`.

Canonical contract: [Thinking and reasoning](thinking-and-reasoning.md). Package-local knobs (NeuralWatt budgets, Z.AI `tool_stream`, Kimi keep/all, ClinePass `thinkingLevelMap`, DeepSeek tool-turn `reasoning_content` replay, xAI reasoning replay) remain on `compat` beside the shared families.

## Third-party provider packaging

A third party ships their own providers the same way Prism ships first-party
provider packages: an `Extension` whose `setup(api)` calls
`api.registerProvider(provider)` for each provider it owns. First-party
provider packages (`@arnilo/prism-providers/openai`, `@arnilo/prism-providers/openrouter`,
`@arnilo/prism-providers/kimi`, `@arnilo/prism-providers/zai`,
`@arnilo/prism-providers/opencode-go`, `@arnilo/prism-providers/alibaba`,
`@arnilo/prism-providers/ollama`, `@arnilo/prism-providers/deepseek`,
`@arnilo/prism-providers/xai`, `@arnilo/prism-providers/clinepass`) are **opt-in and individually installable**;
`@arnilo/prism` core runs without any first-party provider package (mock-only).

A host mixes first-party packages and third-party providers in one resolver.
The host owns the resolver — declaring a provider does not activate it:

```ts
import { createExtensionKernel, createProviderResolver, createAgent } from "@arnilo/prism";
import { createOpenAIProviderPackage } from "@arnilo/prism-providers/openai";

// First-party package, inert until loaded.
const kernel = createExtensionKernel();
await kernel.load([createOpenAIProviderPackage({ apiKey: () => process.env.OPENAI_API_KEY })]);

// Third-party own provider (bring your own adapter). Combined with first-party
// providers in one resolver passed to the agent as `providerSource`.
const own = createMyProvider(/* credentials */);
const providerSource = createProviderResolver([...kernel.registries.providers.list(), own]);

const agent = createAgent({ model: { provider: own.id, model: "demo" }, providerSource });
```

The resolver is the selection mechanism: `model.provider` selects which
provider runs per turn. Hosts can build the resolver from a `ProviderRegistry`,
a plain `AIProvider[]`, or implement `ProviderResolver` directly as a one-line
function over their own map (lazy construction, per-request routing). Declaring
a provider grants no permissions and forces no activation; the host always has
final say. See [Provider layer § Provider resolver](provider-layer.md#provider-resolver)
for the resolver contract.

## Outputs / response / events

`defineProviderPackage()` returns the same package object or throws when `name` is blank. A package contributes only when a host passes it to an extension/kernel/setup flow and calls `setup()` explicitly.

## Request/response example

Provider package manifest contribution and the generic request options a provider request policy can set (see [Provider request policies](provider-request-policies.md) and [Provider caching](provider-caching.md)):

```json
{
  "manifest": {
    "name": "demo-provider-manifest",
    "contributions": [
      { "kind": "providerPackage", "name": "demo-provider" },
      { "kind": "providerRequestPolicy", "name": "demo.cache" }
    ]
  },
  "providerRequest.options": {
    "sessionId": "sess_123",
    "cacheKey": "demo",
    "cacheRetention": "short",
    "headers": { "x-demo": "1" }
  },
  "runOptions.retry": { "maxAttempts": 3, "maxDelayMs": 1000 }
}
```

## Implementation example

Wire a provider package with model metadata plus a session cache policy through the extension kernel:

```ts
import { createExtensionKernel, defineProviderPackage, createSessionCachePolicy } from "@arnilo/prism";

const pkg = defineProviderPackage({
  name: "demo-provider",
  setup(api) {
    api.registerProvider(/* host-owned AIProvider */ null as never);
    api.registerModel({
      provider: "demo",
      model: "demo-large",
      displayName: "Demo Large",
      capabilities: { input: ["text"], reasoning: true, tools: true },
      limits: { contextWindow: 128_000, maxOutputTokens: 8_192 },
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, currency: "USD" },
      compat: { vendorSpecific: true },
    });
    api.registerProviderRequestPolicy(createSessionCachePolicy({ retention: "short" }));
  },
});

const kernel = createExtensionKernel();
await kernel.load([pkg]);
```

## Extension and configuration notes

- Hosts decide which credential resolvers, env objects, OAuth stores, request
  policies, and prompt contributions become active; the package only *declares*
  them.
- `createSessionCachePolicy()` acts as a concrete cache policy hook
  (`provider_request`) that sets generic `ProviderRequest.options`
  (`sessionId`, `cacheKey`, `cacheRetention`, `headers`, opaque `extra`) before
  `AIProvider.generate()`; provider adapters map those options to provider payloads.
- `ModelConfig.cache` is the generic cache capability metadata documented in [Model registry](model-registry.md); `ModelConfig.compat` remains provider-owned inert JSON for behavior that has no generic field yet.
- `ModelConfig.compat` is provider-owned inert JSON: cache policy overrides,
  reasoning/thinking formats, and provider-specific usage mapping live there
  rather than in core, so Prism never branches on provider names.
- A package contributes auth methods and request policies without resolving
  credentials; OAuth/api-key resolution runs only when the host wires the
  matching credential resolver.
- Packages can also be declared as inert manifest contributions and resolved
  later through registries (see the Manifest declarations section below).

## Security and performance notes

- Keep resolved credential values out of `ModelConfig`, provider package metadata, docs metadata, auth method metadata, and registries.
- Registration is in-memory only and does no filesystem, network, env, OAuth refresh, or command access.
- Provider-specific behavior belongs in provider packages, not Prism core.
- Adapter serializers should preserve Prism content blocks (text, thinking, tool_call, tool_result, and image when the model declares image input) in provider-native request shape, or fail explicitly when a block is unsupported.
- Adapter header merging must put caller-supplied `ProviderRequest.options.headers` first and provider-owned headers last. Caller headers may add non-owned headers, but cannot replace resolved credentials, content type, session/cache/security headers, or provider attribution headers.
- For allow-list/residency/budget/circuit selection before resolve, use optional `@arnilo/prism-model-router` over `createProviderResolver` — do not fork provider packages for governance.
- Enterprise cloud adapters (`azure` / `bedrock` / `vertex`) stay separate from consumer Anthropic/Google packages and authenticate only through host credential callbacks.

## Manifest declarations

Provider packages, auth methods, provider request policies, and system prompt contributions can also be declared in data-only Prism manifests:

```ts
import { definePrismManifest } from "@arnilo/prism";

export default definePrismManifest({
  name: "demo-provider-manifest",
  contributions: [
    { kind: "providerPackage", name: "demo-provider" },
    { kind: "authMethod", name: "demo.api-key", metadata: { credentialName: "apiKey" } },
    { kind: "providerRequestPolicy", name: "demo.cache" },
    { kind: "systemPromptContribution", name: "demo.prompt" },
  ],
});
```

Manifest declarations are inert. The host must later resolve them through registries or extension setup and make explicit trust decisions before activating any package, auth flow, request policy, or prompt contribution.

## Related APIs

- [Model routing](model-routing.md): optional governance router over `ProviderResolver`.
- [Azure OpenAI / Foundry](providers/azure.md) / [Amazon Bedrock](providers/bedrock.md) / [Google Vertex AI](providers/vertex.md): enterprise workload-identity packages.
- [Provider layer](provider-layer.md): provider/model registries and provider events.
- [Provider conformance](provider-conformance.md): reusable network-free checks for provider adapters.
- [Contribution registries](contribution-registries.md): registry bundle and extension contribution points.
- [Configuration and manifests](configuration-and-manifests.md): data-only manifest `kind` values.
- [System prompts](system-prompts.md): composing selected package/app/user/run prompt layers.
- [Credentials and redaction](credentials-and-redaction.md): host-owned credential helpers.
- [Public contracts](public-contracts.md): public type inventory.
