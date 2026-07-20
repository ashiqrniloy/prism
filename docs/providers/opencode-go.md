# OpenCode Go provider package

## What it does

`@arnilo/prism-provider-opencode-go` provides explicit, side-effect-free setup for
[OpenCode Go](https://opencode.ai/docs/go/) — a low-cost subscription gateway for
open coding models. The package dual-routes by `ModelConfig.compat.route`:

| Route | Endpoint | Official model families |
| --- | --- | --- |
| `"openai"` (default) | `POST {baseUrl}/chat/completions` | Grok, GLM, Kimi, MiMo, DeepSeek |
| `"anthropic"` | `POST {baseUrl}/messages` | MiniMax, Qwen |

Default base URL is the official Go API root:

```txt
https://opencode.ai/zen/go/v1
```

Session stickiness uses the sanitized `x-opencode-session` header. Anthropic-route
models may emit selected `cache_control` breakpoints; OpenAI-route models use
implicit caching and never receive Anthropic cache fields.

## When to use it

Use it when a host app wants OpenCode Go models through Prism's `AgentSession`
runtime with dual-route serialization, per-request session headers, and optional
caller-gated model discovery.

Do not use it for automatic credential discovery, setup-time catalog fetches, or
real-network tests.

## Inputs / request

```ts
import {
  createOpenCodeGoProviderPackage,
  listOpenCodeGoModels,
} from "@arnilo/prism-provider-opencode-go";

createOpenCodeGoProviderPackage(options: OpenCodeGoProviderPackageOptions): ProviderPackage
```

| Field | Type | Purpose |
| --- | --- | --- |
| `apiKey` | `CredentialValueSource` | Direct/callback/resolver API-key source. |
| `fetch` | `typeof fetch` | Optional fetch implementation for tests/hosts. |
| `baseUrl` | `string` | Overrides official `https://opencode.ai/zen/go/v1`. |
| `models` | `readonly ModelConfig[]` | Overrides featured `openCodeGoModels` defaults. |

`ProviderRequest.options.cacheKey` (falling back to `sessionId`) maps to the
`x-opencode-session` header. Anthropic-route `cache_control` breakpoints and
`cacheRetention` map as documented below.

## Outputs / response / events

| Surface | Behavior |
| --- | --- |
| Provider stream | Prism text, thinking, tool-call delta/final, `usage`, `done`, redacted `error`. |
| Stream completion | `done` is emitted only on completion evidence — OpenAI route: `[DONE]` marker plus a terminal `finish_reason`; Anthropic route: `message_stop`. Truncated or incomplete streams (including dangling tool-call blocks) end with a terminal `error` instead, so partial output never surfaces as `succeeded`. |
| OpenAI thinking | `delta.reasoning_content` → thinking deltas; replay via `reasoning_content` when `preserveThinking`. |
| Anthropic thinking | `thinking_delta` → thinking deltas; replay via Anthropic thinking blocks when `preserveThinking`. |
| Session/cache | `x-opencode-session` + route-specific cache markers. |
| Auth method | `api_key` for `opencode-go`, credential name `apiKey`. |

## Request/response example

```json
{
  "Authorization": "Bearer <resolved-key>",
  "content-type": "application/json",
  "x-opencode-session": "<ProviderRequest.options.cacheKey ?? sessionId>"
}
```

The Anthropic route (`POST /messages`) additionally sends provider-owned
`x-api-key: <resolved-key>` and `anthropic-version: 2023-06-01` headers;
Bearer-only authentication returns HTTP 401 on that route. These headers are
applied after caller headers and cannot be overridden. The OpenAI route never
receives Anthropic-only headers.

OpenAI-route body (thinking passthrough + preserved reasoning):

```json
{
  "model": "kimi-k3",
  "stream": true,
  "stream_options": { "include_usage": true },
  "reasoning_effort": "high",
  "messages": [
    {
      "role": "assistant",
      "content": "calling",
      "tool_calls": [{ "id": "call_1", "type": "function", "function": { "name": "lookup", "arguments": "{\"q\":\"x\"}" } }],
      "reasoning_content": "plan the lookup"
    }
  ]
}
```

## Implementation example

```ts
import { createExtensionKernel } from "@arnilo/prism";
import {
  createOpenCodeGoProviderPackage,
  listOpenCodeGoModels,
  openCodeGoModels,
} from "@arnilo/prism-provider-opencode-go";

const kernel = createExtensionKernel();
await kernel.load([createOpenCodeGoProviderPackage({ apiKey: process.env.OPENCODE_API_KEY })]);
```

Caller-gated live catalog (never runs during package setup):

```ts
const models = await listOpenCodeGoModels({ apiKey: process.env.OPENCODE_API_KEY });
await kernel.load([createOpenCodeGoProviderPackage({ apiKey: process.env.OPENCODE_API_KEY, models })]);
```

Offline bootstrap with featured docs-verified aliases:

```ts
await kernel.load([
  createOpenCodeGoProviderPackage({ apiKey: "fake", models: openCodeGoModels }),
]);
```

## Featured models and routes

Featured `openCodeGoModels` mirrors the official Go docs list (open coding models
only — **not** Zen GPT/Claude ids). Route selection follows the official endpoint
table; Pi secondary metadata is used only for context/output limits when docs omit them.

| Model ID | Route | Cache kind |
| --- | --- | --- |
| `grok-4.5`, `glm-5.2`, `glm-5.1`, `kimi-k3`, `kimi-k2.7-code`, `kimi-k2.6`, `mimo-v2.5`, `mimo-v2.5-pro`, `deepseek-v4-pro`, `deepseek-v4-flash` | `openai` | `implicit` |
| `minimax-m3`, `minimax-m2.7`, `minimax-m2.5`, `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-plus` | `anthropic` | `cache_control` |

### Structured output capability

`capabilities.structuredOutput: "json_schema"` is advertised only for models
verified against the live gateway to accept JSON Schema `response_format` —
OpenAI-compatible routing alone never implies support (unverified models such
as `deepseek-v4-pro` reject it upstream with HTTP 400). Verified models:
`mimo-v2.5`, `mimo-v2.5-pro`. All other models leave the capability undefined
and use Prism's artifact-loop parsing/validation path without
`response_format`; hosts with their own verification evidence can set the
capability explicitly via `defineOpenCodeGoModel({ capabilities })`.

Extending the verified set requires per-model live evidence. Run the
credential-gated probe:

```sh
PRISM_LIVE_PROVIDER_TESTS=1 OPENCODE_API_KEY=... \
  npm run test --workspace=@arnilo/prism-provider-opencode-go
```

`live_json_schema_structured_output_succeeds_<model>` must pass for a model
before it joins the set; `live_json_schema_structured_output_rejected_deepseek_v4_pro`
documents the current boundary (upstream DeepSeek supports only
`response_format` `"text" | "json_object"`, not `json_schema`) and fails loudly
if the gateway ever starts accepting `json_schema`, which is the signal to
extend the set.

Discovery is capability-aware: when a `/models` entry carries
`capabilities.structured_output` (`"json_schema"` or `true`),
`listOpenCodeGoModels()` honors it as gateway-authoritative — including an
explicit `false`, which overrides the static verified set. Today's sparse
payload carries no capability fields, so discovery falls back to the static
verified set with no behavior change.

## Model discovery

Official list endpoint (sparse OpenAI-compatible shape):

```txt
GET https://opencode.ai/zen/go/v1/models
```

`listOpenCodeGoModels({ apiKey?, fetch?, baseUrl?, signal?, headers? })` maps each
`{ id, owned_by }` entry to `ModelConfig` with route/cache heuristics from the docs
endpoint table. Featured metadata (pricing/limits/thinking defaults) is applied when
the id matches `openCodeGoModels`. Discovery is **caller-gated** — setup performs
zero fetches.

## Thinking / reasoning

OpenCode Go does not document gateway-owned thinking fields; Prism forwards
upstream-compatible compat and preserves prior reasoning for tool-call continuity:

| Surface | Behavior |
| --- | --- |
| OpenAI route stream | `reasoning_content` → thinking deltas |
| OpenAI route replay | thinking blocks → top-level `reasoning_content` when `preserveThinking` (default for reasoning models); never folded into text |
| OpenAI route body | optional `thinking` / `reasoning_effort` / `reasoning` from model + per-turn `options.compat` (request wins) |
| Anthropic route stream | `thinking_delta` → thinking deltas |
| Anthropic route replay | thinking blocks with optional `signature` when `preserveThinking` |

Owned compat keys (`route`, `thinking`, `reasoning`, `reasoning_effort`,
`preserveThinking`) are stripped before opaque compat spread so resolved values win.

## Extension and configuration notes

- Hosts choose base URL, model list, credential source, and `fetch` impl.
- Route selection is explicit via `compat.route` (`"anthropic"` or default `"openai"`).
- Package contributes models via the extension `api` and an `api_key` auth method.

### Cache and session behavior

- `x-opencode-session` is derived from `ProviderRequestOptions.cacheKey` (falling
  back to `sessionId`) and sanitized + clamped to 128 characters via the shared
  `sanitizeCacheKey()` helper. Session ids route/stick requests and identify
  conversations; never credentials or raw prompts.
- The Anthropic-compatible route (`compat.route: "anthropic"`) applies
  Anthropic-style `cache_control: { type: "ephemeral" }` markers only to the
  caller-selected `ProviderRequestOptions.cache.breakpoints` (resolved with the
  shared `applyCacheControl()` helper) on the last content block of each selected
  message — not to every block. Caching is enabled unless disabled
  (`cacheRetention: "none"` / `cache.mode: "off"`) and the model opts in via
  `ModelConfig.cache.kind: "cache_control"` (or `cache.mode: "on"`).
- `cacheRetention: "long"` emits `cache_control: { type: "ephemeral", ttl: "1h" }`
  markers when the model allows long retention
  (`ModelConfig.cache.longRetention !== false`); otherwise the default ephemeral
  window applies.
- The OpenAI-compatible chat route (`compat.route: "openai"`, the default) sends
  no Anthropic `cache_control` fields; it relies on OpenAI-style implicit caching.
- Usage accounting is preserved per route: the OpenAI route maps
  `prompt_tokens_details.cached_tokens`/`cache_write_tokens` to
  `Usage.cacheReadTokens`/`cacheWriteTokens`; the Anthropic route maps
  `cache_read_input_tokens`/`cache_creation_input_tokens`.

## Security and performance notes

- SSE streams and HTTP error bodies use bounded `@arnilo/prism/providers/transport` helpers (`readSseData`, `readBoundedResponseText`).
- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- API keys are resolved per request from caller-supplied values or resolvers and
  redacted from errors (including discovery failures).
- Caller-supplied `ProviderRequest.options.headers` can add non-owned headers, but
  provider-owned headers (`content-type`, `x-opencode-session`, `authorization`,
  and on the Anthropic route `x-api-key`/`anthropic-version`) are applied last
  and cannot be overridden by caller headers.
- Live tests stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1` plus `OPENCODE_API_KEY`;
  default tests are network-free.

## Official evidence

- [OpenCode Go](https://opencode.ai/docs/go/) — model list, dual endpoints, pricing/usage, `GET /zen/go/v1/models`
- Pi secondary (ids/limits only): `packages/ai/src/providers/opencode-go.ts`, `opencode-go.models.ts`

## Related APIs

- [Provider packages](../provider-packages.md): `defineProviderPackage`,
  `ModelConfig`, discovery contract, request/cache policies.
- [Thinking and reasoning](../thinking-and-reasoning.md): per-turn `ThinkingLevel` → compat families.
- [Credentials and redaction](../credentials-and-redaction.md):
  `resolveCredentialValue`, `redactSecrets`.
- [Provider caching](../provider-caching.md): route-specific OpenCode Go cache matrix.
- [Provider conformance](../provider-conformance.md): network-free adapter tests.
