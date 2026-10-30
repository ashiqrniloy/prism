# `@arnilo/prism-provider-commandcode`

Command Code provider package for [Prism](https://github.com/ashiqrniloy/prism): registers the `commandcode` provider, resolves its key from an `env:`/`keyring:` ref per request, and ships the Provider API's three wires — Chat Completions, Responses, and Anthropic Messages — plus the model catalog.

## Install

```sh
bun add @arnilo/prism-provider-commandcode
```

## Use

```ts
import commandcode from "@arnilo/prism-provider-commandcode";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "commandcode/claude-haiku-5-5",
  packages: [commandcode({ apiKey: "env:COMMAND_CODE_API_KEY" })],
});
```

The bare definition uses the schema defaults, so `packages: [commandcode]` is the same as
`commandcode({ apiKey: "env:COMMAND_CODE_API_KEY" })`.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `apiKey` | `env:`/`keyring:` ref | `env:COMMAND_CODE_API_KEY` | Resolved through the credentials slot on every request. A literal key is rejected (`secret_literal`). |
| `baseUrl` | string | `https://api.commandcode.ai/provider/v1` | Official base. |
| `zdr` | boolean | `false` | Sends the provider-owned `x-cmd-zdr: 1` header on every route. |
| `models` | `ModelConfig[]` | — | Static catalog. When absent, `models()` asks `GET /models`. |

Set config through the code instance (`commandcode({ zdr: true })`) or through `AgentConfig.packageConfig`
(which wins). Factory-only options — `id`, `fetch` — are not JSON and cannot come from a manifest.

## Routes

`reflection/beam:free` uses Chat Completions and replays plain `reasoning_content` on tool follow-ups. Its Responses bridge rejects the same follow-up because the required plain reasoning is lost. Other Chat models keep `reasoning_details` replay. Beam still requires a nonempty reasoning trace for every imported assistant message; ordinary conversation archives without those traces cannot be sent to that model.

One provider, three wires. `compat.route` wins; otherwise `routeForCommandCodeModel` applies the
gateway rule measured in plan 205 Task 1:

| wire | models | path | auth |
| --- | --- | --- | --- |
| `anthropic` | `claude-*` | `/messages` | `x-api-key` + bearer + `anthropic-version` |
| `responses` | ids whose catalog entry advertises `/responses` | `/responses` | bearer |
| `openai` | everything else | `/chat/completions` | bearer |

- **Chat** sends `max_tokens`, replays thinking as `reasoning_details`, and carries **no** cache
  markers or affinity header. Reasoning is read from the non-standard `delta.reasoning` the gateway
  emits alongside `reasoning_details`.
- **Responses** sets `store: false` (the codec keeps the `include: ["reasoning.encrypted_content"]`
  that the wire accepts and then ignores — it never returns an encrypted item, so there is no
  reasoning replay on this wire), clamps `prompt_cache_key` to 64 characters, and sends
  `x-client-request-id` from the sanitized `cacheKey ?? sessionId` as its only affinity hint.
  `max_output_tokens` is refused below 16 by the gateway, so the codec fails locally first.
- **Messages** sends the Anthropic shape with `thinking: {type: "adaptive"}` — Claude 5.x rejects
  `{type: "enabled"}` with "Use thinking.type.adaptive and output_config.effort" — and maps the
  model's thinking level to `output_config.effort`.

An unknown `compat.route` fails closed before any fetch, naming the route.

## Prompt caching

| wire | lever | evidence |
| --- | --- | --- |
| Chat | none — caching is opportunistic | three identical turns read `cached_tokens` 0 → 448 → 0; a headless reference run reported 9 273 cached prompt tokens with no lever at all |
| Responses | `prompt_cache_key` (64-char clamp) + `x-client-request-id` | accepted; reads appear even on a first turn because the gateway shares its prefix cache across wires |
| Messages | `cache_control: {type: "ephemeral"}` at `system_prompt` and `last_message` | cache read 1 223 on turns 2–3; **tools also accept the marker** even though the reference client omits it, so Prism can take that lever |

The gateway caches upstream, so a hit on the first turn is not proof Prism did something right: parity
runs must compare the same session with and without the lever (plan 184). **Measured 2026-10-28** with
`provider-probe --turns 4`: reuse was 0.997 (Chat, `minimax/minimax-m3.1-flash`), 1.002 (Responses,
`gpt-5.6-luna`) and 1.000 (Messages, `claude-haiku-5-5`) — turns 2–4 read 8 704, 8 333 and 16 898 of the
prefix each. A two-turn headless reference run on the same models read 9 734, 8 310 and 14 291 tokens,
so neither harness has a lever advantage; Chat reaches ~100% without any cache field on either side.
Cost fields carry the published per-million rates; `gpt-5.6-luna` and `claude-haiku-5-5` have context-tier
and peak/off-peak rates that `ModelCost` cannot express, so those are noted, not modelled.

## Zero data retention

`zdr: true` adds `x-cmd-zdr: 1` to every route as a provider-owned header: a caller cannot override
it, and it is never applied to model discovery. Models with a ZDR upstream answer normally (verified
on all three wires); a model without one answers `422 cmd_zdr_no_providers`, which maps to a
permanent error that names the `zdr` flag and the model. The header is routing, not a promise that the
provider retains nothing — the Command Code account's own plan terms still apply.

## Plans and limits

- Every static model declares `limits.contextWindow`; `maxOutputTokens` is declared where a live error
  body or the reference catalog states it (`claude-haiku-5-5`: 128 000).
- Discovered models take `context_length` from `GET /models`. The published value is approximate at
  the edges — `MiniMax M2.5` advertises 200 000 but its upstream rejects above 196 608 — and a
  discovered model whose entry carries no `context_length` is left **undefined** rather than guessed.
- The catalog has no capability fields. Reasoning and image input come from family rules verified
  live in plan 205 Task 1b (`claude-*`, `gpt-5.6*`, `deepseek-v4*`, `*vision*`, `beam*`, `glyph*`);
  an unknown family stays text-only with no reasoning claim. Pass `models:` to declare more.
- Errors map through the shared classifier: 401/403 → `auth` (a `403 upgrade_required` means the plan
  has no Provider API access), `422 cmd_zdr_no_providers` and wrong-wire `400`s → `permanent`,
  `429` → `rate_limited` with `Retry-After`, `5xx` → `transient`, and the over-long-prompt bodies →
  `context_overflow`. Stealth models answer `The stealth model could not complete the request.`
  instead of an upstream message, so their overflows classify `permanent`.
- **Live test spend.** One full `runProviderLiveScenarios` pass is roughly 15–18 requests on the three
  exemplars — under $0.05 at the listed rates — and needs `PRISM_LIVE_PROVIDER_TESTS` plus
  `COMMAND_CODE_API_KEY`. Override the models with
  `PRISM_LIVE_COMMANDCODE_{CHAT,RESPONSES,MESSAGES}_MODEL`.

## Named exports

`createCommandCodeProvider`, `commandCodeHttpError`, `commandCodeSession`, `commandCodeThinking`,
`COMMAND_CODE_CHAT_ROUTE`, `COMMAND_CODE_RESPONSES_ROUTE`, `COMMAND_CODE_MESSAGES_ROUTE`,
`COMMAND_CODE_DEFAULT_API_KEY_REF`, `COMMAND_CODE_ZDR_HEADER`, `COMMAND_CODE_SESSION_ID_MAX_LENGTH`,
and the catalog (`commandCodeModels`, `commandCodeFamily`, `defineCommandCodeModel`,
`listCommandCodeModels`, `mapCommandCodeModel`, `routeForCommandCodeModel`,
`COMMAND_CODE_DEFAULT_BASE_URL`, `COMMAND_CODE_PRICING_SOURCE`, `COMMAND_CODE_RESPONSES_ENDPOINT`).

## License

MIT
