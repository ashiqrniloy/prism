# Hyper provider package

## What it does

`@arnilo/prism-providers/hyper` provides explicit, side-effect-free setup for
[Charm Hyper](https://hyper.charm.land) — a pay-per-use reasoning-model gateway
billed in Hypercredits (1 HC = $0.05). The package routes by `ModelConfig.compat.route`:

| Route | Endpoint | Official model families |
| --- | --- | --- |
| `"openai"` (default) | `POST {baseUrl}/chat/completions` | most models (DeepSeek, Kimi, GLM, Gemma, …) |
| `"anthropic"` | `POST {baseUrl}/messages` | `qwen3.6-*` (Anthropic-shaped explicit-write cache pricing) |
| `"responses"` (explicit opt-in) | `POST {baseUrl}/responses` | OpenAI-standard pass-through; hosts bring Responses-shaped model metadata (Codex-style clients) |

Default base URL is the official API root:

```txt
https://hyper.charm.land/v1
```

Authentication is `Authorization: Bearer <key>` on every route; the messages
route additionally sends provider-owned `x-api-key` + `anthropic-version:
2023-06-01` headers (Claude Code compatibility). API keys start with
`sk-hyper-`. The responses route reuses the OpenAI package's Responses
machinery wholesale — body serialization, stream events, usage mapping,
continuation cursors, and media handling — with Hyper's base URL and auth, so
its wire behavior matches the OpenAI-standard pass-through Charm documents.
Errors on that route are labeled `Hyper …` (e.g. `Hyper request failed: 429 …`).

## When to use it

Use it when a host app wants Hyper models through Prism's `AgentSession`
runtime with dual-route serialization, reasoning-content replay, cache-hint
breakpoints, and caller-gated model discovery and credit checks.

Do not use it for automatic credential discovery, setup-time catalog fetches,
or real-network tests (live probes are operator-gated, see below).

## Inputs / request

```ts
import {
  createHyperProviderPackage,
  getHyperCredits,
  listHyperModels,
} from "@arnilo/prism-providers/hyper";

createHyperProviderPackage(options: HyperProviderPackageOptions): ProviderPackage
```

| Field | Type | Purpose |
| --- | --- | --- |
| `apiKey` | `CredentialValueSource` | Direct/callback/resolver API-key source. |
| `fetch` | `typeof fetch` | Optional fetch implementation for tests/hosts. |
| `baseUrl` | `string` | Overrides official `https://hyper.charm.land/v1`. |
| `models` | `readonly ModelConfig[]` | Overrides featured `hyperModels` defaults. |

`ProviderRequest.options.cache.breakpoints` select Anthropic-route
`cache_control` markers as documented below; `options.compat.reasoning_effort`
selects the per-request reasoning effort (clamped to the model's documented
`effortLevels`).

## Outputs / response / events

| Surface | Behavior |
| --- | --- |
| Provider stream | Prism text, thinking, tool-call delta/final, `usage`, `done`, redacted `error`. |
| Stream completion | `done` only on completion evidence — OpenAI route: `[DONE]` marker plus terminal `finish_reason`; Anthropic route: `message_stop`; Responses route: `response.completed` (or hop-cap/duplicate-cursor failure). Truncated streams end with terminal `error`; partial output never surfaces as `succeeded`. |
| OpenAI thinking | `delta.reasoning_content` → thinking deltas; replay via top-level `reasoning_content` when `preserveThinking` (default), never folded into text. |
| Anthropic thinking | `thinking_delta` → thinking deltas; replay via Anthropic thinking blocks when `preserveThinking`. |
| Usage | Standard tokens + cache read/write per route; `cost.usd`/`cost.hypercredits`/`remaining.hypercredits` available via `parseHyperUsageCost(wireUsage)` (NeuralWatt pattern) for hosts that surface cost telemetry. Cost/remaining fields are chat-route only; the responses route is a standard OpenAI pass-through (`input_tokens`/`output_tokens`/`total_tokens` + `input_tokens_details.cached_tokens`/`cache_write_tokens`) mapped by the shared Responses machinery. |
| Auth method | `api_key` for `hyper`, credential name `apiKey`. |

## Request/response example

```json
{
  "Authorization": "Bearer sk-hyper-…",
  "content-type": "application/json"
}
```

Messages route adds provider-owned `x-api-key: <key>` and
`anthropic-version: 2023-06-01`; Bearer-only authentication is also accepted
there (Claude Code compatibility). All provider-owned headers are applied after
caller headers and cannot be overridden.

Chat-route body shape (thinking passthrough + preserved reasoning):

```json
{
  "model": "deepseek-v4-pro",
  "stream": true,
  "stream_options": { "include_usage": true },
  "reasoning_effort": "high",
  "messages": [
    {
      "role": "assistant",
      "tool_calls": [{ "id": "call_1", "type": "function", "function": { "name": "lookup", "arguments": "{}" } }],
      "reasoning_content": "plan the lookup"
    }
  ]
}
```

Responses-route body (OpenAI-standard pass-through, shared Responses machinery):

```json
{
  "model": "deepseek-v4-pro",
  "input": [{ "role": "user", "content": [{ "type": "input_text", "text": "hi" }] }],
  "tools": [{ "type": "function", "name": "lookup", "parameters": {} }],
  "stream": true,
  "store": false,
  "reasoning": { "effort": "high" }
}
```
Cache hints (`options.cacheKey`/`sessionId`) surface as the OpenAI-standard
`sanitized prompt_cache_key` on this route only; `prompt_cache_retention`/`prompt_cache_options`
are never emitted for implicit Hyper models (no documented 24h/`explicitBreakpoints` support).

## Implementation example

```ts
import { createExtensionKernel } from "@arnilo/prism";
import {
  createHyperProviderPackage,
  getHyperCredits,
  listHyperModels,
} from "@arnilo/prism-providers/hyper";

const kernel = createExtensionKernel();
await kernel.load([createHyperProviderPackage({ apiKey: process.env.HYPER_API_KEY })]);
```

Caller-gated live catalog (never runs during package setup):

```ts
const models = await listHyperModels({ fetch }); // public endpoint, no auth needed
await kernel.load([createHyperProviderPackage({ apiKey: process.env.HYPER_API_KEY, models })]);
```

Optional credit display (hosts poll on their own schedule; never called from
`generate()`):

```ts
const { balance } = await getHyperCredits({ apiKey: process.env.HYPER_API_KEY });
```

## Featured models and routes

Featured `hyperModels` mirrors the official `/v1/models` catalog (31 models,
2026-07 snapshot), with limits, vision capability, documented `effort_levels`,
and per-million-token pricing (input/output/cache-hit) captured in metadata.
Route selection follows the observed pricing shape: models whose live catalog
entry prices explicit cache writes (cache_create > 0, with hit pricing) are
Anthropic-route `cache_control`; models with implicit write pricing
(cache_create = 0, no read charge) stay chat-route `implicit` with the write
fee recorded in `cost.cacheWrite`.

| Model family | Route | Cache kind |
| --- | --- | --- |
| `deepseek-v4-pro`, `deepseek-v4-pro-0813`, `deepseek-v4-flash` | `openai` | `implicit` |
| `kimi-k3`, `kimi-k2.7`, `kimi-k2.5`, `glm-5.3-flash`, `glm-5.1`, `gemma-4-fast`, `gpt-oss-120b`, `llama-*`, `minimax-m2.7`, `qwen3-coder`, `qwen3-next`, `qwen3.7-*` | `openai` | `implicit` |
| `qwen3.6-plus`, `qwen3.6-flash` | `anthropic` | `cache_control` (max 4 breakpoints, no `ttl` — undocumented) |

## Model discovery

```txt
GET https://hyper.charm.land/v1/models
```

Public endpoint — works without authentication and emits no auth header when no
key resolves. `listHyperModels({ fetch?, baseUrl?, apiKey?, signal?, headers? })`
maps each `{ id, context_window, max_output_tokens, capabilities.vision,
reasoning.effort_levels, pricing{cache_create, cache_hit} }` entry to
`ModelConfig` (route from pricing shape via `routeForHyperModel`). Discovery is
**caller-gated** — setup performs zero fetches.

## Thinking / reasoning

| Surface | Behavior |
| --- | --- |
| OpenAI route stream | `reasoning_content` → thinking deltas |
| OpenAI route replay | thinking blocks → top-level `reasoning_content` when `preserveThinking`; never folded into text |
| OpenAI route body | `reasoning_effort` from model default or `options.compat` (request wins), clamped to the model's documented `effortLevels`; invalid values are dropped |
| Anthropic route stream | `thinking_delta` → thinking deltas |
| Anthropic route replay | thinking blocks when `preserveThinking` |

Owned compat keys (`route`, `preserveThinking`, `reasoning_effort`,
`effortLevels`) are stripped before opaque compat spread so resolved values win.

## Extension and configuration notes

- Hosts choose base URL, model list, credential source, and `fetch` impl.
- Route selection is explicit via `compat.route` (`"anthropic"` or `"responses"`; default `"openai"`). The responses route is never auto-derived — hosts opt in with Responses-shaped model metadata (Codex-style clients), and featured models stay `openai`/`anthropic`.
- Package contributes models via the extension `api` and an `api_key` auth method.

### Cache and session behavior

- The chat route sends **no** Anthropic `cache_control` fields; it relies on
  OpenAI-style implicit caching. Read tokens map from
  `prompt_tokens_details.cached_tokens` / `cache_write_tokens` /
  `prompt_cache_hit_tokens` (the shared OpenAI usage mapping covers both field
  spellings).
- The Anthropic route applies `cache_control: { type: "ephemeral" }` markers
  only to the caller-selected `cache.breakpoints` (shared `applyCacheControl()`
  helper) on the last content block of each selected message — not to every
  block. A `system_prompt` breakpoint serializes `system` as marked text blocks
  (plain string otherwise). Caching is enabled unless disabled
  (`cacheRetention: "none"` / `cache.mode: "off"`) and the model opts in via
  `ModelConfig.cache.kind: "cache_control"`.
- The responses route carries OpenAI-standard `prompt_cache_key` only when the
  caller supplies cache hints (`cacheKey`/`sessionId`, sanitized + clamped to
  64 chars by the shared helper); no `prompt_cache_retention`/`prompt_cache_options`
  (implicit models, no documented 24h/explicit modes).
- **No `ttl` is ever emitted**: Hyper does not document `cache_control` TTL
  values; `cacheRetention: "long"` must not produce a marker Hyper may reject.
  Re-verify against live behavior before emitting TTLs.
- Usage accounting per route: chat route maps
  `prompt_tokens_details.cached_tokens`/`cache_write_tokens` (and
  `prompt_cache_hit_tokens`); messages route maps
  `cache_read_input_tokens`/`cache_creation_input_tokens`.
- Session identity is simple: no session header is emitted (unlike OpenCode Go).

### Live-verified mapping (findings ledger)

The following claims are encoded as operator-gated probes in
`packages/prism-providers/src/hyper/__tests__/live.test.ts`. Each probe's
assertion encodes the documented claim, so a probe failure **is** the finding;
record the outcome here and adjust the mapping. Status: **pending operator
run** (no key in CI):

| # | Claim (documented) | Probe | Status |
| --- | --- | --- | --- |
| 1 | Warm chat-route replay reports cached tokens (`cached_tokens`/`prompt_cache_hit_tokens` → `cacheReadTokens`) | `live_chat_route_reports_cached_tokens_on_warm_prefix_replay` | pending |
| 2 | `cache_control` on messages reports `cache_creation_input_tokens` on the creating call | `live_messages_route_cache_control_reports_creation_and_read_tokens` | pending |
| 3 | Same-prefix warm replay reads the created cache entry (TTL ≥ one request) | same probe (warm leg) | pending |
| 4 | `reasoning_effort` from the model's documented `effortLevels` is accepted (HTTP 200) | `live_reasoning_effort_is_accepted_on_chat_route` | pending |

Run the gate:

```sh
PRISM_LIVE_PROVIDER_TESTS=1 HYPER_API_KEY=sk-hyper-... \
  npm run test --workspace=@arnilo/prism-providers/hyper
```

## Security and performance notes

- SSE streams and HTTP error bodies use bounded `@arnilo/prism/providers/transport` helpers.
- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- API keys are resolved per request from caller-supplied values or resolvers
  and redacted from errors (including discovery and credits failures).
- `402` (insufficient Hypercredits) surfaces non-retryable `billing_error`;
  `429` and `5xx` are retryable with `retry-after` surfaced as
  `retry_after_ms`; `400/401/403/404` are non-retryable.
- Caller headers cannot override provider-owned headers (`content-type`,
  `authorization`, and on the messages route `x-api-key`/`anthropic-version`).
- Live tests stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1` plus
  `HYPER_API_KEY`; default tests are network-free.

## Official evidence

- Hyper API docs: `https://hyper.charm.land/docs/api/{authentication,list-models,openai-chat-completions,openai-responses,anthropic-messages,credits}.html`
- Hyper model catalog: `https://hyper.charm.land/docs/models.html`, `https://hyper.charm.land/faq`
- Live `GET https://hyper.charm.land/v1/models` snapshot (2026-07) — pricing/limits in the static catalog
- Probe ledger above pending operator-gated live run
- Intelligent-routing re-check (2026-09): roadmap-only, no documented controls — see
  `../_evidence/phase55-hyper-intelligent-routing.md`

## Related APIs

- [Provider packages](../provider-packages.md): `defineProviderPackage`,
  `ModelConfig`, discovery contract, request/cache policies.
- [Thinking and reasoning](../thinking-and-reasoning.md): per-turn `ThinkingLevel` → compat families.
- [Credentials and redaction](../credentials-and-redaction.md):
  `resolveCredentialValue`, `redactSecrets`.
- [Provider caching](../provider-caching.md): per-provider cache behavior matrix.
- [Provider conformance](../provider-conformance.md): network-free adapter tests.