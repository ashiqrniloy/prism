# @arnilo/prism-ai/openrouter

Registers OpenRouter's Chat Completions provider with reasoning replay, routing preferences, prompt caching, and model discovery.

## Install

```bash
prism add @arnilo/prism-ai/openrouter
```

```jsonc
{
  "packages": ["@arnilo/prism-ai/openrouter"],
  "packageConfig": {
    "@arnilo/prism-ai/openrouter": { "apiKey": "env:OPENROUTER_API_KEY" }
  }
}
```

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `apiKey` | ref only (`env:`/`keyring:`) | `env:OPENROUTER_API_KEY` | Resolved through credentials per request; never a literal key. |
| `baseUrl` | string | `https://openrouter.ai/api/v1` | OpenRouter API base. |
| `models` | ModelConfig[] | discovery | Static catalog; suppresses discovery when supplied, including `[]`. |
| `appUrl` | HTTPS URL | unset | `HTTP-Referer` attribution header. |
| `appTitle` | string, ≤100 characters | unset | `X-OpenRouter-Title` attribution header; no newlines. |
| `routing` | object | unset | Provider preferences; unknown keys rejected. |

`routing` accepts `order`, `only`, `ignore`, `quantizations` (string arrays), `allow_fallbacks`,
`require_parameters`, `zdr` (booleans), `data_collection` (`allow`/`deny`), `sort`
(`price`/`throughput`/`latency`), and `max_price` (nonnegative numeric `prompt`, `completion`,
`request`, `image`). These pass as the request's `provider` object. No additional routing keys are accepted.
`id` and `fetch` belong only to the `openrouter(options)` factory, not manifest config.

## What it changes

Registers provider `openrouter`; no tools, hooks, slots, commands, or session state. Uses
`POST /chat/completions` with bearer auth and the shared OpenAI Chat codec. Reasoning effort
uses the portable `thinkingLevel` mapping to `reasoning: {effort}`; `reasoning_details`
are merged and replayed without folding encrypted entries into user-visible text. Images are
capability-gated. Usage includes inclusive prompt tokens, cache read/write tokens, USD `cost`
and `metadata.openrouter` (`model`, `provider`, `generationId`, `reasoningTokens` when reported).

Absent static models, each `models()` call makes **one GET /models** (about 470 entries; no
per-endpoint discovery or background polling). Pricing converts dollars/token to dollars/million
prompt, completion, cache-read and cache-write tokens. Router price `-1` means unknown, not free.
Unknown context/output limits remain undefined rather than guessed; these include price-routing
entries with no published window and caller-supplied static models without limits.
`openRouterModels` contains `openrouter/free`: zero-priced, tools/reasoning/structured-output
capable, with a conservative **65,536-token** context snapshot (smallest tool-capable free-pool
window on 2026-10-24). It has no invented output ceiling. Discovery uses each entry's published
window and maximum completion tokens. Router capabilities vary with the randomly served model;
use a pinned model for repeatable tests and production requirements.

## Prompt caching

- Sends `x-session-id` from `cacheKey ?? sessionId`, sanitized and capped at 256 characters.
  No header without a key; no `prompt_cache_key` is sent.
- Discovery stamps `compat.cacheControl: "anthropic-blocks"` on `anthropic/*` models, with
  `cache.kind: "cache_control"`, four breakpoints maximum and optional one-hour retention.
  For static models, include the same compat/cache fields (or use `mapOpenRouterModel`).
  The shared planner marks system text, the last tool definition and the last message's last
  non-empty text part. Long retention adds `ttl: "1h"` only when requested and supported.
- Other models use implicit caching with no explicit markers. Read/write counters come from
  `prompt_tokens_details`; zero is not proof that a model never caches.
- Sticky routing expires after **10 minutes** of inactivity. Setting `routing.order` disables
  sticky routing: explicit ordering buys determinism at the expense of cache reuse. Cache parity
  probes therefore do not set `order`. Anthropic models have minimum cacheable prefixes (Haiku
  4.5 needs 4,096 tokens); short prompts need not produce hits.

## Capabilities

Declares only provider registration and credential resolution capabilities through
`defineProviderPackage`; requires kernel API level 1. No runtime dependency or sibling provider
is imported. Import/setup performs no network calls.

## Cost, security, and failure behavior

Missing key records a `warn` status note and still registers the provider; a run fails with
`credential_unavailable`. Secrets resolve per request, so rotation is observed. Provider-owned
bearer/content-type headers override caller headers; errors and events redact the key.
401 names the API key/ref; 402 names credits/budget; 429 is `rate_limited` or `quota` when the
free daily limit is exhausted. Policy failures name the account privacy setting and
`routing.data_collection`. HTTP-200 streamed errors are terminal errors, never successful `done`.

Free models follow OpenRouter's separate account privacy setting. Review it before sending
sensitive input. `routing.data_collection: "deny"` excludes collecting endpoints and `zdr: true`
requests zero-data-retention endpoints; restrictive settings may leave no eligible endpoint.
Free limits are typically 20 requests/minute and 50/day below $10 purchased credits, otherwise
1,000/day; inspect `GET /api/v1/key` for account limits. No automatic quota checks are added.

Documented overflow errors classify `context_overflow` and can trigger one pre-output compaction
and retry. **No live overflow body was observed**: OpenRouter may instead transform length errors
into successful `finish_reason: "length"` completions, which do not enter overflow recovery.

### Live tests

Set `PRISM_LIVE_PROVIDER_TESTS=1` and `OPENROUTER_API_KEY` to run the pinned free suite;
`PRISM_LIVE_OPENROUTER_MODEL` defaults to `recursive/flint-v1.0:free` (a reasoning model, so the
scenarios allow 768 output tokens; `google/gemma-4-31b-it:free` was the earlier default and is
intermittently rate-limited upstream). A missing/retired id
fails with an actionable override message. `openrouter/free` is intentionally not accepted here:
its random model selection makes assertions irreproducible.

Paid cache tests default **off**. With separate spend approval, set `PRISM_LIVE_OPENROUTER_PAID=1`;
`PRISM_LIVE_OPENROUTER_CACHE_MODEL` defaults to `anthropic/claude-haiku-4.5`. Only cache is run on
this paid model: currently two calls, budget up to four per run, under approximately **$0.05** at
Haiku 4.5 rates with the supplied long prefix and 128-token output cap. Model overrides may cost
more. Neither paid nor pinned live probes were run to implement this package: current owner
authorization covers only `openrouter/free`. Offline synthetic fixtures prove behavior, not live
cache-hit performance; see the wire fixture README.

## Example

```ts
import { createAgent } from "@arnilo/prism";
import openrouter from "@arnilo/prism-ai/openrouter";

const agent = await createAgent({
  model: "openrouter/anthropic/claude-haiku-4.5",
  packages: [openrouter],
});
const session = await agent.session();
try {
  const result = await session.run("Explain prompt caching briefly.");
  console.log(result);
} finally {
  await agent.dispose();
}
```
