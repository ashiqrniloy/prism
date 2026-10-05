# Kimi provider package

## What it does

`@arnilo/prism-provider-kimi` provides two distinct, side-effect-free routes:

1. **Kimi For Coding** (default) — Anthropic-compatible `POST /messages` on
   `https://api.kimi.com/coding` with `User-Agent: KimiCLI/1.5` (unless overridden).
2. **Moonshot Open Platform** (opt-in) — OpenAI-compatible `POST /chat/completions`
   on `https://api.moonshot.ai/v1` (or `api.moonshot.cn/v1`), registered only when
   `includeMoonshotModels: true`.

Official model ids differ by route. Coding uses `kimi-for-coding`,
`kimi-for-coding-highspeed`, and `k3`. Open Platform uses `kimi-k2.7-code`,
`kimi-k3`, and related catalog ids. Pi's `k2p7` alias is **not** used.

Caller-gated discovery via `listKimiModels()` hits the official Moonshot
`GET /v1/models` endpoint. Package setup never fetches.

## When to use it

Use it when a host app wants Kimi For Coding and/or Moonshot Open Platform through
Prism's `AgentSession` runtime with Kimi-specific serializers, thinking controls,
and cache policy.

Do not use it for automatic credential discovery, setup-time catalog fetches, or
real-network tests (live tests stay opt-in).

## Inputs / request

```ts
import kimi from "@arnilo/prism-provider-kimi";

// Default export: the package definition — call it, or pass the result to `packages: [...]`.
kimi(options?: KimiProviderPackageOptions & KimiProviderConfig = {}): PackageInstance

// Named exports.
createKimiCodingProvider(options?: KimiCodingProviderOptions): ModelProvider
createMoonshotProvider(options?: MoonshotProviderOptions): ModelProvider
listKimiModels(options?: ListKimiModelsOptions): Promise<ModelConfig[]>
defineKimiModel(config: KimiModelConfig): ModelConfig
```

| Config field | Type | Purpose |
| --- | --- | --- |
| `kimiApiKey` | secret ref | Resolved by the credentials slot; default `env:KIMI_API_KEY`. A literal value is rejected. |
| `moonshotApiKey` | secret ref | Moonshot Open Platform key (not interchangeable with a Kimi For Coding key). |
| `baseUrl` | string | Kimi For Coding base; defaults to `https://api.kimi.com/coding`. |
| `moonshotBaseUrl` | string | Moonshot Open Platform base; defaults to `https://api.moonshot.ai/v1`. |
| `models` | `ModelConfig[]` | Kimi For Coding catalog override; defaults to the featured catalog. |
| `moonshotModels` | `ModelConfig[]` | Moonshot catalog override; when absent, `models()` asks the Open Platform `/models` endpoint. |
| `includeMoonshotModels` | boolean | Register the Moonshot Open Platform provider too. |

| Factory-only option | Type | Purpose |
| --- | --- | --- |
| `id` | string | Kimi For Coding provider id; defaults to `kimi-coding`. |
| `moonshotId` | string | Moonshot provider id; defaults to `moonshot`. |
| `fetch` | `typeof fetch` | Test seam: the transport every request uses. |
| `userAgent` | string | Sent as `user-agent` on every request (provider-owned). |

`models()` on the `kimi-coding` provider returns the configured `models` array when set, otherwise the curated `kimiCodingModels` catalog — the coding endpoint publishes no `/models`. The optional `moonshot` provider (registered when `includeMoonshotModels: true`) returns configured `moonshotModels` when set, otherwise `listKimiModels()` — only when `agent.models.list()` runs.

## Outputs / response / events

| Surface | Behavior |
| --- | --- |
| Coding stream | Prism text, thinking deltas, tool-call delta/final, `usage` (`cache_read_input_tokens` / `cache_creation_input_tokens`), `done`, redacted `error`. |
| Moonshot stream | Same, with `delta.reasoning_content` → thinking; OpenAI-style usage cache details when present. |
| Block preservation | Coding: Anthropic `thinking` / `tool_use` / `tool_result`. Moonshot: `reasoning_content` on assistant replay when `preserveThinking`. |
| Auth methods | `api_key` for `kimi-coding`; also `moonshot` when opted in. |

Unsupported block placements or unclaimed images fail before fetch.

## Route differences

| | Kimi For Coding | Moonshot Open Platform |
| --- | --- | --- |
| Base URL | `https://api.kimi.com/coding` | `https://api.moonshot.ai/v1` (or `.cn`) |
| Wire API | Anthropic `/messages` | OpenAI `/chat/completions` |
| Featured ids | `kimi-for-coding`, `kimi-for-coding-highspeed`, `k3` | `kimi-k2.7-code`, `kimi-k2.7-code-highspeed`, `kimi-k2.6`, `kimi-k2.5`, `kimi-k3` (+ discovery) |
| Discovery | No public list API — curated featured aliases | Official `GET /v1/models` via `listKimiModels()` |
| Cache | Implicit by default; opt-in Anthropic `cache_control` | Implicit only — never emits Anthropic `cache_control` |
| Thinking | Block replay + body `thinking` / `reasoning_effort` | `reasoning_content` replay + body `thinking` / `reasoning_effort` |

The Anthropic `/messages` request/response contract for Kimi remains under-documented
upstream ([MoonshotAI/Kimi-K2#129](https://github.com/MoonshotAI/Kimi-K2/issues/129));
Prism treats official Chat Completions thinking fields as best-effort passthrough on
the Coding route.

## Thinking / reasoning

Official fields (Open Platform docs; Coding docs for `k3` effort mapping):

| Model family | Official control | Prism `compat` |
| --- | --- | --- |
| K3 / Coding `k3` | top-level `reasoning_effort`: `"low"`/`"high"`/`"max"` (Open Platform default `"max"`; Kimi Code default `"high"`) | `compat.reasoning_effort` — use Task 4 family `reasoning_effort` |
| K2.7-code / Coding | thinking always on; Preserved Thinking always on | omit `thinking` by default; `preserveThinking: true` for replay; do not send `disabled` |
| K2.6 / K2.5 | `thinking.type` enabled/disabled; K2.6 optional `keep: "all"` | `compat.thinking` — Task 4 family `thinking_type` |

Per-turn `ProviderRequestOptions.compat` wins over `ModelConfig.compat`. Helpers:
`kimiThinking`, `kimiReasoningEffort`, `kimiPreserveThinking`.
`stripKimiThinkingCompat` removes provider-owned routing/serialization keys
(`route`, `preserveThinking`, `preserve_thinking`, thinking/effort keys) before
the opaque compat spread, so they never leak into wire bodies.

Featured context windows follow the official docs exactly (`262_144` for the
256K-class models, `1_048_576` for K3). Both stream parsers emit `done` only on
protocol completion evidence — Coding route: `message_stop` with all `tool_use`
blocks closed; Moonshot route: `[DONE]` plus a terminal `finish_reason` with no
dangling tool calls. Truncated streams terminate with an `error` event instead.

The Coding route authenticates with provider-owned `authorization: Bearer`,
`x-api-key`, and `anthropic-version: 2023-06-01` headers (official third-party
setup uses `ANTHROPIC_API_KEY` semantics); caller-supplied headers cannot
override them.

## Request/response example

Coding (Anthropic-compatible `/messages`):

```json
{
  "model": "kimi-for-coding",
  "messages": [{ "role": "user", "content": [{ "type": "text", "text": "Hello" }] }],
  "stream": true
}
```

Moonshot (Chat Completions):

```json
{
  "model": "kimi-k3",
  "messages": [{ "role": "user", "content": "Hello" }],
  "stream": true,
  "reasoning_effort": "max"
}
```

## Implementation example

```ts
import { createAgent } from "@arnilo/prism";
import kimi from "@arnilo/prism-provider-kimi";

const agent = await createAgent({
  model: { provider: "kimi-coding", model: "kimi-for-coding" },
  packages: [
    kimi({
      kimiApiKey: "env:KIMI_API_KEY",
      moonshotApiKey: "env:MOONSHOT_API_KEY",
      includeMoonshotModels: true, // registers a second `moonshot` provider
    }),
  ],
});

const models = await agent.models.list(); // coding catalog + live Moonshot discovery
await agent.dispose();
```

## Extension and configuration notes

- Hosts choose base URLs, provider ids, `User-Agent`, model lists, credential sources,
  and `fetch` impl.
- Moonshot is registered only with `includeMoonshotModels: true` (provider + models + auth).
- Featured catalogs are offline bootstrap only; refresh Open Platform via `listKimiModels()`.

### Cache behavior

- Default Coding catalog models use **implicit caching** and send no explicit
  `cache_control` fields unless the model opts in with
  `ModelConfig.cache.kind: "cache_control"`.
- When opted in, `cache_control: { type: "ephemeral" }` markers apply only to
  caller-selected `ProviderRequestOptions.cache.breakpoints` on the last content
  block of each selected message. `cacheRetention: "long"` adds `ttl: "1h"` when
  the model allows long retention. A `system_prompt` breakpoint serializes
  `system` as native text blocks with the marker (plain string otherwise).
- The Moonshot Open Platform route never receives Anthropic `cache_control` fields.
- Coding usage: `cache_read_input_tokens` → `Usage.cacheReadTokens`,
  `cache_creation_input_tokens` → `Usage.cacheWriteTokens`.

## Request construction (0.5.1)

Agent sessions stamp `sessionId`/`cacheKey` without a host policy. Session/cache keys are correlation ids, never secrets.

| | |
| --- | --- |
| P1 session wire | none extra |
| Mandatory | no |
| P2 default cache | Anthropic/Coding: `cache_control`; Moonshot: none |

See [Provider request policies](../provider-request-policies.md).

## Security and performance notes

- SSE streams and HTTP error bodies use bounded `@arnilo/prism/provider-kit`
  helpers (`readSseData`, `readBoundedResponseText`).
- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- Credentials are resolved per request from caller-supplied values or resolvers
  and redacted from errors (including discovery failures).
- Caller-supplied `ProviderRequest.options.headers` can add non-owned headers,
  but provider-owned headers (`content-type`, `user-agent`, `authorization`)
  are applied last and cannot be overridden by caller headers.
- Live tests stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1` plus provider-specific
  env names; default tests are network-free.

## Thinking and reasoning

Kimi models are family-stamped by id: K3 (`kimiThinkingFamily`) routes through `reasoning_effort` with declared levels `low/high/max` — other portable levels snap (`medium`→`high`, `xhigh`→`max`, `none`/`minimal`→`low`); unknown effort strings pass through for forward compatibility. K2.x models route through `thinking_type` (on/off toggle; K2.7-code thinking is always on). Do not send conflicting `thinking` + `reasoning_effort`. See [Thinking and reasoning](../thinking-and-reasoning.md).

## Related APIs

- [Provider packages](../provider-packages.md): package definition,
  caller-gated discovery, Anthropic/OpenAI routes.
- [Thinking and reasoning](../thinking-and-reasoning.md): portable `ThinkingLevel`
  helpers and Kimi family mapping.
- [Credentials and redaction](../credentials-and-redaction.md):
  `resolveCredentialValue`, `redactSecrets`.
- [Provider caching](../provider-caching.md): explicit/implicit matrix.
- [Provider conformance](../provider-conformance.md): network-free adapter tests.
