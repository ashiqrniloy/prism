# Command Code provider package

## What it does

`@arnilo/prism-providers/commandcode` provides explicit, side-effect-free setup
for the [Command Code Provider API](https://commandcode.ai/docs/provider) — an
aggregator exposing every top commercial and open model through OpenAI- and
Anthropic-compatible endpoints, billed at cost with deals auto-applied. The
package dual-routes by `ModelConfig.compat.route`:

| Route | Endpoint | Official model families |
| --- | --- | --- |
| `"openai"` (default) | `POST {baseUrl}/chat/completions` | everything except `claude-*` (GPT-5.6, DeepSeek, Kimi, GLM, MiniMax, Qwen, MiMo, Gemini flash, Grok) |
| `"anthropic"` | `POST {baseUrl}/messages` | `claude-*` tiers (Opus/Sonnet/Fable/Haiku) |

Default base URL is the official Provider API root:

```txt
https://api.commandcode.ai/provider/v1
```

Authentication: `Authorization: Bearer <key>` on the chat route,
`x-api-key` + `anthropic-version: 2023-06-01` on the messages route (Claude
Code compatibility). The same key authenticates the CLI and the API.

## When to use it

Use it when a host app wants Command Code models through Prism's `AgentSession`
runtime: dual-route serialization, `cache_control` breakpoints on Claude
models, implicit caching elsewhere, reasoning replay, caller-gated model
discovery, and optional zero-data-retention (`zdr: true` → provider-owned
`x-cmd-zdr: 1`, which routes only through ZDR-capable upstreams).

Do not use it for automatic credential discovery, setup-time catalog fetches,
or real-network tests (live probes are operator-gated, see below).

## Inputs / request

```ts
import {
  createCommandCodeProviderPackage,
  listCommandCodeModels,
} from "@arnilo/prism-providers/commandcode";

createCommandCodeProviderPackage(options: CommandCodeProviderPackageOptions): ProviderPackage
```

| Field | Type | Purpose |
| --- | --- | --- |
| `apiKey` | `CredentialValueSource` | Direct/callback/resolver API-key source. |
| `fetch` | `typeof fetch` | Optional fetch implementation for tests/hosts. |
| `baseUrl` | `string` | Overrides official `https://api.commandcode.ai/provider/v1`. |
| `models` | `readonly ModelConfig[]` | Overrides featured `commandCodeModels` defaults. |
| `zdr` | `boolean` | Enforce zero data retention (`x-cmd-zdr: 1`). May route to costlier upstreams or fail `422 cmd_zdr_no_providers`. |

`ProviderRequest.options.cache.breakpoints` select messages-route
`cache_control` markers for Claude models (max 4, no `ttl`).

## Outputs / response / events

| Surface | Behavior |
| --- | --- |
| Provider stream | Prism text, thinking, tool-call delta/final, `usage`, `done`, redacted `error`. |
| Stream completion | `done` only on completion evidence — chat route: `[DONE]` marker plus terminal `finish_reason`; messages route: `message_stop`. Truncated streams end with terminal `error`. |
| OpenAI thinking | `delta.reasoning_content` → thinking deltas; replay via top-level `reasoning_content` when `preserveThinking` (default), never folded into text. |
| Anthropic thinking | `thinking_delta` → thinking deltas; replay via Anthropic thinking blocks when `preserveThinking`. |
| Usage | Standard tokens + cache read/write per route; mapped through the shared OpenAI/Anthropic usage mappings. |
| Auth method | `api_key` for `commandcode`, credential name `apiKey`. |

## Request/response example

```json
{
  "authorization": "Bearer cmd_…",
  "content-type": "application/json"
}
```

Messages route instead sends provider-owned `x-api-key: <key>` and
`anthropic-version: 2023-06-01`. All provider-owned headers are applied after
caller headers and cannot be overridden.

Chat-route body (thinking passthrough + preserved reasoning):

```json
{
  "model": "Qwen/Qwen3.8-Flash",
  "stream": true,
  "stream_options": { "include_usage": true },
  "max_tokens": 512,
  "messages": [
    {
      "role": "assistant",
      "tool_calls": [{ "id": "call_1", "type": "function", "function": { "name": "lookup", "arguments": "{}" } }],
      "reasoning_content": "plan the lookup"
    }
  ]
}
```

## Implementation example

```ts
import { createExtensionKernel } from "@arnilo/prism";
import { createCommandCodeProviderPackage } from "@arnilo/prism-providers/commandcode";

const kernel = createExtensionKernel();
await kernel.load([createCommandCodeProviderPackage({ apiKey: process.env.COMMAND_CODE_API_KEY })]);
```

Caller-gated live catalog (never runs during package setup):

```ts
const models = await listCommandCodeModels({ fetch }); // public endpoint, no auth needed
await kernel.load([createCommandCodeProviderPackage({ apiKey: process.env.COMMAND_CODE_API_KEY, models })]);
```

## Featured models and routes

Featured `commandCodeModels` is a curated 38-model bootstrap catalog: ids and
context windows from the live `GET /provider/v1/models` snapshot (2026-09, 67
ids), USD-per-million-token pricing from the docs table
(<https://commandcode.ai/docs/resources/pricing-limits>). `compat.pricing_source`
records caveats: open-source models bill at the **mean per-provider price**;
DeepSeek rates are **off-peak** (17h/day; peak 2× during 01–04 & 06–10 UTC);
deals (MiniMax M3 −50%, MiMo −98/99%) are already applied upstream. Custom
pricing metadata is always stripped before the wire.

| Model family | Route | Cache kind |
| --- | --- | --- |
| `claude-opus-5/4-8/4-7`, `claude-sonnet-5/4-6`, `claude-fable-5-1/5`, `claude-haiku-4-5` | `anthropic` | `cache_control` (max 4 breakpoints, no `ttl` — undocumented) |
| `gpt-5.6-sol/terra/luna` | `openai` | `implicit` (docs cache-write price recorded in `cost.cacheWrite`; explicit-key upgrade gated on live probe — Task 9) |
| `deepseek/*`, Kimi, GLM, MiniMax, Qwen, MiMo, Gemini flash, Grok | `openai` | `implicit` |

## Model discovery

```txt
GET https://api.commandcode.ai/provider/v1/models
```

Public endpoint — works without authentication and emits no auth header when no
key resolves. `listCommandCodeModels({ fetch?, baseUrl?, apiKey?, signal?,
headers? })` maps each `{ id, name, context_length }` entry to `ModelConfig`:
route from id (`claude-*` → anthropic), context window from the endpoint, and
featured docs metadata (cost/cache kind) applied when the id matches a curated
entry. The endpoint carries no pricing or capabilities — unknown ids get
route-derived cache kind and no cost. Discovery is **caller-gated** — setup
performs zero fetches.

## Thinking / reasoning

| Surface | Behavior |
| --- | --- |
| OpenAI route stream | `reasoning_content` → thinking deltas |
| OpenAI route replay | thinking blocks → top-level `reasoning_content` when `preserveThinking`; never folded into text |
| Anthropic route stream | `thinking_delta` → thinking deltas |
| Anthropic route replay | thinking blocks when `preserveThinking` |

Owned compat keys (`route`, `preserveThinking`, `pricing_source`) are stripped
before opaque compat spread so resolved values win.

## Extension and configuration notes

- Hosts choose base URL, model list, credential source, `fetch` impl, and ZDR.
- Route selection is explicit via `compat.route` (`"anthropic"` for `claude-*`
  ids, default `"openai"`). Sending a model to the wrong endpoint 400s.
- Package contributes models via the extension `api` and an `api_key` auth method.

### Cache and session behavior

- The chat route sends **no** `cache_control` fields; it relies on OpenAI-style
  implicit caching (upstream provider behavior, passed through). Read tokens
  map from `prompt_tokens_details.cached_tokens` / `cache_write_tokens` /
  `prompt_cache_hit_tokens`.
- The messages route applies `cache_control: { type: "ephemeral" }` markers
  only to caller-selected `cache.breakpoints` (shared `applyCacheControl()`
  helper) on the last content block of each selected message. A
  `system_prompt` breakpoint serializes `system` as marked text blocks (plain
  string otherwise). Caching is enabled unless disabled
  (`cacheRetention: "none"` / `cache.mode: "off"`) and the model opts in via
  `ModelConfig.cache.kind: "cache_control"`.
- **No `ttl` is ever emitted**: the upstream TTL window is undocumented on the
  Provider API; `cacheRetention: "long"` must not produce a marker the gateway
  may reject.
- Usage accounting per route: chat route maps
  `prompt_tokens_details.cached_tokens`/`cache_write_tokens` (and
  `prompt_cache_hit_tokens`); messages route maps
  `cache_read_input_tokens`/`cache_creation_input_tokens`.
- Session identity is simple: no session header is emitted (undocumented).

### Live-verified mapping (findings ledger)

The following claims are encoded as operator-gated probes in
`packages/prism-providers/src/commandcode/__tests__/live.test.ts`. Each probe's
assertion encodes the documented claim, so a probe failure **is** the finding;
record the outcome here and adjust the mapping. Status: **pending operator
run** (no key in CI):

| # | Claim (documented) | Probe | Status |
| --- | --- | --- | --- |
| 1 | Warm chat-route replay reports cached tokens (implicit caching passes through) | `live_chat_route_reports_cached_tokens_on_warm_prefix_replay` | pending |
| 2 | `cache_control` on messages reports `cache_creation_input_tokens` on the creating call | `live_messages_route_cache_control_reports_creation_and_read_tokens` | pending |
| 3 | Same-prefix warm replay reads the created cache entry (TTL ≥ one request) | same probe (warm leg) | pending |
| 4 | OpenAI `prompt_cache_key` is accepted and honored for GPT-5.6 (explicit caching) — decides Task 9 | `live_gpt56_prompt_cache_key_passthrough_probe` | pending — Task 9 closed gated: **pass** → upgrade `gpt-5.6-*` to the OpenAI explicit mapping (`promptCacheKey`/`promptCacheOptions`/`applyPromptCacheBreakpoints` via `@arnilo/prism-providers/openai`, verified exported); **fail** (400/ignored/warm replay shows no cached tokens) → verified-negative, keep `implicit`, record here |
| 5 | OpenAI `reasoning_effort` is accepted (200) on the chat route | `live_reasoning_effort_is_accepted_on_chat_route` | pending |
| 6 | ZDR requests route (done) or fail `422 cmd_zdr_no_providers` when no ZDR-capable upstream exists | `live_zdr_route_probe_is_opt_in_and_routable` | pending |

Run the gate:

```sh
PRISM_LIVE_PROVIDER_TESTS=1 COMMAND_CODE_API_KEY=cmd_... \
  npm run test --workspace=@arnilo/prism-providers/commandcode
```

## Security and performance notes

- SSE streams and HTTP error bodies use bounded `@arnilo/prism/providers/transport` helpers.
- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- API keys are resolved per request from caller-supplied values or resolvers
  and redacted from errors (upstream error bodies may carry the upstream
  provider's message — always redacted).
- `403 upgrade_required` (Go plan — no API access) and
  `422 cmd_zdr_no_providers` are non-retryable; `429` and `5xx` are retryable
  with `retry-after` surfaced as `retry_after_ms`; `400/401/422` are
  non-retryable.
- Caller headers cannot override provider-owned headers (`content-type`,
  `authorization` on chat, `x-api-key`/`anthropic-version` on messages,
  `x-cmd-zdr` when ZDR is opted in).
- Live tests stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1` plus
  `COMMAND_CODE_API_KEY`; default tests are network-free.

## Official evidence

- Command Code Provider API docs: `https://commandcode.ai/docs/provider`
- Pricing & limits (per-model USD, deals, off-peak): `https://commandcode.ai/docs/resources/pricing-limits`
- Live `GET https://api.commandcode.ai/provider/v1/models` snapshot (2026-09) — 67 ids, context windows
- Probe ledger above pending operator-gated live run; row 4 decides plan 055 Task 9
  (explicit GPT-5.6 caching upgrade) — see `plans/055-First-Class-Hyper-And-Command-Code-Providers.md`

## Related APIs

- [Provider packages](../provider-packages.md): `defineProviderPackage`,
  `ModelConfig`, discovery contract, request/cache policies.
- [Thinking and reasoning](../thinking-and-reasoning.md): per-turn `ThinkingLevel` → compat families.
- [Credentials and redaction](../credentials-and-redaction.md):
  `resolveCredentialValue`, `redactSecrets`.
- [Provider caching](../provider-caching.md): per-provider cache behavior matrix.
- [Provider conformance](../provider-conformance.md): network-free adapter tests.