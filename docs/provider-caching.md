# Provider caching

## What it does

Provider caching documents Prism's cache intent surface:

- `ProviderRequestOptions.cache?: PromptCacheHints` for structured, provider-agnostic cache hints.
- Legacy aliases `cacheKey` and `cacheRetention`, still supported for backwards compatibility.
- `PromptCacheBreakpoint` locations for reusable prompt regions.
- `ModelCacheCapabilities` for model/provider cache support metadata.
- Shared helpers: `sanitizeCacheKey`, `mapCacheRetention`, `applyCacheControl`, `cacheHitRate`, `cacheSavings`, and `cacheUsageReport`.

Cache hints are best-effort. They describe intent; providers decide whether their native API can use them. Prism does not guarantee cache hits.

## When to use it

Use this page when a host or provider package needs to:

- Mark stable system prompts, tools, context, or messages as cacheable.
- Opt into cache-aware default input ordering so stable attachments/resources, summaries, and prior history form a reusable prefix before the current user turn.
- Carry a stable cache key across turns without putting provider-specific fields in core.
- Read `ModelConfig.cache` to decide whether to map hints to implicit caching, key-based caching, cache-control breakpoints, provider-specific caching, or no caching.
- Compute normalized cache diagnostics from `Usage.cacheReadTokens` / `Usage.cacheWriteTokens`, including providers that only report reads.

Do not use cache keys for credentials, bearer tokens, API keys, OAuth tokens, user secrets, or raw private prompts.

## Inputs / request

```ts
import type {
  ModelCacheCapabilities,
  PromptCacheBreakpoint,
  PromptCacheHints,
  ProviderRequestOptions,
} from "@arnilo/prism";
```

| Type / field | Purpose |
| --- | --- |
| `PromptCacheHints.mode?: "auto" | "on" | "off"` | Host intent. Providers may ignore unsupported modes. |
| `PromptCacheHints.key?: string` | Stable, untrusted cache key. Sanitize before sending to provider APIs. |
| `PromptCacheHints.retention?: "none" | "short" | "long"` | Desired retention. `mapCacheRetention()` downgrades unsupported long retention. |
| `PromptCacheHints.breakpoints?: readonly PromptCacheBreakpoint[]` | Stable prompt locations to mark for cache-control style providers. |
| `PromptCacheBreakpoint.location` | `system_prompt`, `tools`, `stable_context`, `last_stable_message`, `last_user_message`, or `message_id`. |
| `PromptCacheBreakpoint.messageId?` | Required when `location: "message_id"`. |
| `PromptCacheBreakpoint.ttl?` | Generic `short` / `long` hint. Provider packages map to native TTL shape. |
| `ModelConfig.cache?: ModelCacheCapabilities` | Static model/provider cache support metadata. |

`ModelCacheCapabilities.kind` values are generic: `implicit`, `openai_key`, `cache_control`, `provider_specific`, or `none`. Core never branches on provider names; provider packages read the metadata and map it to native requests.

Legacy alias note: `cacheKey` maps to `cache.key`, and `cacheRetention` maps to `cache.retention`. When both are present, structured `cache.key` / `cache.retention` is the authoritative cache intent for providers that read structured hints; legacy fields remain for older adapters.

## Outputs / response / events

Cache helpers return plain data:

| Helper | Output |
| --- | --- |
| `sanitizeCacheKey(value, maxLength)` | Safe key string or `undefined`. |
| `mapCacheRetention(retention, model)` | `"short"`, `"long"`, or `undefined`. |
| `applyCacheControl(messages, breakpoints, options)` | New message array with `cache_control: { type: "ephemeral" }` on selected message anchors. |
| `cacheHitRate(usage)` | Cached input ratio or `undefined`. |
| `cacheSavings(usage, model)` | Estimated read-token savings or `undefined` without pricing. |
| `cacheUsageReport(usage, model?)` | Normalized read/write tokens, hit rate, estimated savings, and currency when available; `undefined` when no usage is supplied. |

Provider events do not change. Cache accounting stays in normalized `Usage.cacheReadTokens` and `Usage.cacheWriteTokens`.

For stable-prefix payloads, set `inputLayout: "cache_aware"` on the default input builder, `assembleProviderInput()`, `AgentConfig`, or `RunOptions`. The default prompt builder already places context, selected skills, and tool declarations before input messages; cache-aware input ordering then places attachments/resources, summaries, prior history, and pending tool results before the current user suffix. The prefix is byte-stable only when those stable inputs are unchanged; Prism still does not guarantee provider cache hits.

## Request/response example

```json
{
  "providerRequest.options": {
    "sessionId": "sess_123",
    "cache": {
      "mode": "on",
      "key": "sess_123",
      "retention": "long",
      "breakpoints": [
        { "location": "system_prompt" },
        { "location": "last_user_message" }
      ]
    }
  },
  "model.cache": {
    "kind": "cache_control",
    "maxBreakpoints": 4,
    "minCacheableTokens": 1024,
    "longRetention": true
  }
}
```

## Implementation example

```ts
import {
  applyCacheControl,
  cacheHitRate,
  cacheUsageReport,
  mapCacheRetention,
  sanitizeCacheKey,
  type ModelConfig,
  type PromptCacheHints,
} from "@arnilo/prism";

const model: ModelConfig = {
  provider: "demo",
  model: "demo-large",
  cache: { kind: "cache_control", maxBreakpoints: 4, longRetention: true },
};

const hints: PromptCacheHints = {
  mode: "on",
  key: "workspace:agent#1",
  retention: "long",
  breakpoints: [{ location: "system_prompt" }, { location: "last_user_message" }],
};

const key = sanitizeCacheKey(hints.key, model.cache?.maxKeyLength ?? 128);
const retention = mapCacheRetention(hints.retention, model);
const stamped = applyCacheControl(messages, hints.breakpoints ?? [], { maxBreakpoints: model.cache?.maxBreakpoints });
const hitRate = cacheHitRate({ inputTokens: 1000, cacheReadTokens: 800 });
const report = cacheUsageReport({ inputTokens: 1000, cacheReadTokens: 800 }, model);
// { cacheReadTokens: 800, cacheWriteTokens: 0, hitRate: 0.8, ... }

await session.run("Explain this", { inputLayout: "cache_aware" });
```

## Extension and configuration notes

Provider request policies can set `ProviderRequestOptions.cache` or the legacy `cacheKey` / `cacheRetention` aliases. Provider packages decide how to map hints to native payloads:

| `ModelCacheCapabilities.kind` | Typical mapping |
| --- | --- |
| `implicit` | No request mutation; provider caches automatically. |
| `openai_key` | Send sanitized cache key and mapped retention where supported. |
| `cache_control` | Use `applyCacheControl()` on provider-native message anchors. |
| `provider_specific` | Provider package uses `compat`/native options intentionally. |
| `none` | Do not send cache fields. |

### Per-provider cache behavior

| Provider package | Cache kind | Explicit cache hints | Multi-turn reuse notes | Caveats |
| --- | --- | --- | --- | --- |
| `@arnilo/prism-provider-openai` | `openai_key` | Sends sanitized `prompt_cache_key`; `prompt_cache_retention: "24h"` only when the model declares `longRetention`. | Stable cache key + stable prefix can improve reuse. | Best-effort only; `"short"`/`"none"` omit retention. |
| `@arnilo/prism-provider-openrouter` | `cache_control` | Applies `cache_control` markers only to caller-selected `cache.breakpoints`; `"long"` may add `ttl: "1h"`. | Breakpoint-stable prefixes can be reused by upstream providers. | Best-effort only; no marker is added to every block. |
| `@arnilo/prism-provider-opencode-go` | route-specific | Sends sanitized `x-opencode-session`; Anthropic route applies selected `cache_control` breakpoints; OpenAI route sends none. | Session id + unchanged selected anchors can help route-native caches. | Best-effort and route-dependent. |
| `@arnilo/prism-provider-zai` | `implicit` | No explicit cache payload; GLM context caching is automatic. | Resend unchanged prior history for implicit context-cache reuse. | Best-effort only; cache options do not force hits. |
| `@arnilo/prism-provider-kimi` | implicit by default, optional `cache_control` | Default catalog models send no `cache_control`; hosts may opt in on Anthropic `/messages` models with `ModelConfig.cache.kind: "cache_control"`. | Keep selected Anthropic anchors and prior history stable. | Best-effort and model/route-dependent. |
| `@arnilo/prism-provider-neuralwatt` | `implicit` | No `cache_control`, `cacheKey`, `prompt_cache`, or `cacheRetention` payload; NeuralWatt vLLM prefix caching is automatic. | Full prior history must be resent unchanged with only the new turn appended; `inputLayout: "cache_aware"` keeps stable prefixes first. | Best-effort only; does not promise cache hits; `cacheRetention: "none"` disables Prism hints only, not the implicit backend prefix cache. |

Detailed first-party provider notes:

- OpenAI Responses (`@arnilo/prism-provider-openai`): `kind: "openai_key"`. Sanitizes/clamps `prompt_cache_key` to 64 chars; `"long"` retention maps to `prompt_cache_retention: "24h"` only when the model declares `cache.longRetention`; `"short"`/`"none"` omit the field. `input_tokens_details.cached_tokens` maps to `Usage.cacheReadTokens`.
- OpenAI-compatible Chat Completions adapter: minimal scope, sends no cache payload; see [OpenAI-compatible provider](providers/openai-compatible.md).
- OpenRouter (`@arnilo/prism-provider-openrouter`): `kind: "cache_control"`. Sanitizes/clamps `session_id`/`X-Session-Id` to 256 chars; applies Anthropic-style `cache_control` markers only to caller-selected `cache.breakpoints` (last content block of each selected message), not every block; `"long"` retention adds `ttl: "1h"` when the model allows it. `prompt_tokens_details.cached_tokens`/`cache_write_tokens` map to `Usage.cacheReadTokens`/`cacheWriteTokens`.
- OpenCode Go (`@arnilo/prism-provider-opencode-go`): `x-opencode-session` from `cacheKey ?? sessionId`, sanitized to 128 chars; the Anthropic route applies `cache_control` markers only to selected breakpoints (`"long"` → `ttl: "1h"`), the OpenAI route sends none. OpenAI route maps `prompt_tokens_details.cached_tokens`/`cache_write_tokens`; Anthropic route maps `cache_read_input_tokens`/`cache_creation_input_tokens`.
- Z.AI (`@arnilo/prism-provider-zai`): `kind: "implicit"`. GLM context caching is automatic; sends no explicit cache payload regardless of cache options. `prompt_tokens_details.cached_tokens`/`cache_write_tokens` map to `Usage.cacheReadTokens`/`cacheWriteTokens`.
- NeuralWatt (`@arnilo/prism-provider-neuralwatt`): `kind: "implicit"`. NeuralWatt prefix caching is automatic; sends no explicit cache payload regardless of cache options. `cacheRetention: "none"` disables Prism cache-control hints only (not the implicit backend prefix cache). `prompt_tokens_details.cached_tokens` maps to `Usage.cacheReadTokens`; NeuralWatt does not report a cache-write token, so `Usage.cacheWriteTokens` is never fabricated (stays `undefined`). NeuralWatt's `/v1/models` catalog advertises exact `cached_input_per_million` rates for cache reads and `cached_output_per_million: null`; static curated aliases do not guess those prices.
- Kimi (`@arnilo/prism-provider-kimi`): default catalog models use implicit caching (no `cache_control`); hosts opt in via `ModelConfig.cache.kind: "cache_control"` on the Anthropic `/messages` route, then `cache_control` markers apply only to selected breakpoints (`"long"` → `ttl: "1h"`); the Moonshot OpenAI route sends none. `cache_read_input_tokens`/`cache_creation_input_tokens` map to `Usage.cacheReadTokens`/`cacheWriteTokens`.

### NeuralWatt cache-aware limiter

NeuralWatt (`@arnilo/prism-provider-neuralwatt`) runs a cache-aware backend rate
limiter on top of its implicit vLLM prefix cache. This shapes long-running agent
sessions differently from one-shot chat:

- **Uncached TPM counts cold prefill only.** The tokens-per-minute budget charges the
  prefix that is not already cached. A request whose prefix is fully cached consumes
  far less TPM than a cold request of the same total prompt length.
- **Warm-prefix requests can avoid some `503` fleet-capacity blocks.** Near fleet
  capacity, requests that reuse a cached prefix are more likely to be admitted than
  fully cold requests. Prefix reuse is both an availability and a latency lever.
- **Full prior history is required for multi-turn cache reuse.** The prefix cache is
  keyed by request content, so each follow-up turn must resend the entire prior
  transcript (system prompt + all prior turns) unchanged, with only the new turn
  appended. Use `inputLayout: "cache_aware"` so Prism keeps the stable prefix first.
- Cache behavior is best-effort and **does not guarantee cache hits**. Admission and
  eviction are server-side decisions and vary with fleet load. `cacheRetention:
  "none"` disables Prism cache-control hints only; it does not disable the implicit
  backend prefix cache.

See [NeuralWatt provider](providers/neuralwatt.md) for the package-level cache,
usage, and retry details.

## Security and performance notes

- Cache hints are best-effort and do not guarantee cache hits.
- Cache keys are untrusted input; sanitize and truncate with `sanitizeCacheKey()` before provider I/O.
- Cache keys must never be credentials or secrets.
- Provider-owned auth/session/security headers always win over caller headers.
- Helpers are pure, network-free, and O(messages) at most. `cacheUsageReport()` is O(1).
- Cache-aware input ordering does not change resource loading: URI attachments/resources still load only through the caller-provided `ResourceLoader`.
- Cache usage reports contain only usage counts and optional pricing/currency; they do not include prompt text, cache keys, headers, credentials, or provider payloads.
- `applyCacheControl()` returns new message objects for stamped anchors and does not mutate input messages.

## Related APIs

- [Input and prompt assembly](input-and-prompt-assembly.md): opt-in cache-aware ordering for stable provider payload prefixes.
- [Provider request policies](provider-request-policies.md): set cache hints before provider calls.
- [Model registry](model-registry.md): register `ModelConfig.cache` capability metadata.
- [Provider layer](provider-layer.md): provider/model registries and provider events.
- [Provider packages](provider-packages.md): package-owned mapping to provider-native cache APIs.
- [Public contracts](public-contracts.md): public type list for cache contracts and helpers.
