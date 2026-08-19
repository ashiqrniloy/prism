# DeepSeek provider package

## What it does

`@arnilo/prism-provider-deepseek` provides explicit, side-effect-free setup for the
DeepSeek Chat Completions API (`POST /chat/completions`) with official thinking
mode, reasoning-effort mapping, tool-turn `reasoning_content` replay, and
implicit prefix caching.

The package registers a provider, featured V4 model metadata, and an `api_key`
auth method through `createExtensionKernel().load([...])`.

## When to use it

Use it when a host app wants DeepSeek V4 Flash / Pro through Prism's
`AgentSession` runtime with official `thinking` / `reasoning_effort` mapping
and automatic KV prefix cache.

Do not use it for the Anthropic-compatible route, automatic credential
discovery, setup-time catalog fetches, or real-network tests.

## Inputs / request

```ts
import {
  createDeepSeekProviderPackage,
  defineDeepSeekModel,
  listDeepSeekModels,
} from "@arnilo/prism-provider-deepseek";

createDeepSeekProviderPackage(options: DeepSeekProviderPackageOptions): ProviderPackage
defineDeepSeekModel(config: DeepSeekModelConfig): ModelConfig
listDeepSeekModels(options?: ListDeepSeekModelsOptions): Promise<ModelConfig[]>
```

| Field | Type | Purpose |
| --- | --- | --- |
| `apiKey` | `CredentialValueSource` | Direct/callback/resolver API-key source. |
| `fetch` | `typeof fetch` | Optional fetch implementation for tests/hosts. |
| `baseUrl` | `string` | Overrides the DeepSeek base URL (default `https://api.deepseek.com`). |
| `id` | `string` | Overrides the provider id (default `deepseek`). |
| `models` | `readonly ModelConfig[]` | Overrides featured `deepseekModels` defaults. |

### Thinking / reasoning compat

Official body fields (request `options.compat` wins over `model.compat`):

| Compat / body field | Wire shape | Notes |
| --- | --- | --- |
| `thinking` | `boolean` or `{ type: "enabled" \| "disabled" }` | Default **enabled**. Boolean `true`/`false` maps to those types. |
| `reasoning_effort` | `low` \| `high` \| `max` | Default `high`. Portable `medium` and `xhigh` map to `high`. Omitted when thinking is disabled. |

`applyThinkingLevel(..., "thinking_type")` toggles `thinking.type`. Set
`reasoning_effort` in `compat` for effort. `ProviderRequestOptions.cacheRetention: "none"`
forces `thinking: { type: "disabled" }`.

Thinking mode ignores `temperature`, `top_p`, `presence_penalty`, and
`frequency_penalty`; this adapter strips them so they cannot break the cache prefix.

## Outputs / response / events

| Surface | Behavior |
| --- | --- |
| Provider stream | Prism text, thinking (`delta.reasoning_content`), tool-call delta/final, `usage`, `done`, redacted `error`. |
| Block preservation | Text; thinking → `reasoning_content` on tool-turn assistants (otherwise dropped, never flattened into text); assistant `tool_call` → `tool_calls`; `tool_result` → role `tool`. |
| Auth method | `api_key` for the configured provider id, credential name `apiKey`. |
| Usage | `prompt_cache_hit_tokens` → `Usage.cacheReadTokens` via `mapOpenAIChatUsage`. |

Unsupported media blocks fail before fetch. Text-only input.

## Request/response example

```json
{
  "model": "deepseek-v4-flash",
  "messages": [{ "role": "user", "content": "Hello" }],
  "stream": true,
  "thinking": { "type": "enabled" },
  "reasoning_effort": "high"
}
```

## Implementation example

```ts
import { createExtensionKernel } from "@arnilo/prism";
import { createDeepSeekProviderPackage, listDeepSeekModels } from "@arnilo/prism-provider-deepseek";

const kernel = createExtensionKernel();
await kernel.load([createDeepSeekProviderPackage({ apiKey: "fake-deepseek-key" })]);

const live = await listDeepSeekModels({ apiKey: "fake-deepseek-key" });
await kernel.load([createDeepSeekProviderPackage({ apiKey: "fake-deepseek-key", models: live })]);
```

Per-turn thinking override:

```ts
await session.prompt("Plan the refactor", {
  providerOptions: {
    compat: {
      thinking: { type: "enabled" },
      reasoning_effort: "low",
    },
  },
});
```

## Extension and configuration notes

- Default base URL is `https://api.deepseek.com`. The Anthropic-compatible
  route is not implemented.
- Featured `deepseekModels` are offline bootstrap aliases (`deepseek-v4-flash`,
  `deepseek-v4-pro`) with 1M context / 384k max output, `cache.kind: "implicit"`,
  and documented USD-per-million cost including cache-read.
- `listDeepSeekModels()` is caller-gated `GET {base}/models`. Setup never fetches.
- Tool JSON Schema keys (`properties` / `required`) are sorted before send so the
  implicit prefix stays stable.
- Tool-turn assistants must replay `reasoning_content` or the API returns 400.
  Non-tool multi-turn may omit it (the API ignores it).

## Security and performance notes

- SSE streams and HTTP error bodies use bounded transport helpers.
- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- API keys are resolved per request and redacted from errors (including discovery).
- Provider-owned headers (`content-type`, `authorization`) win over caller headers.
- One POST per generate. No provider retry loop.
- Live tests stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1` plus `DEEPSEEK_API_KEY`.

## Related APIs

- [Provider packages](../provider-packages.md): `defineProviderPackage`,
  caller-gated discovery, per-turn thinking.
- [Thinking and reasoning](../thinking-and-reasoning.md): portable
  `applyThinkingLevel` → DeepSeek `thinking.type` / `reasoning_effort`.
- [Credentials and redaction](../credentials-and-redaction.md):
  `resolveCredentialValue`, `redactSecrets`.
- [Provider caching](../provider-caching.md): implicit DeepSeek prefix cache.
- [Provider conformance](../provider-conformance.md): network-free adapter tests.

## Official evidence

- [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)
- [KV Cache](https://api-docs.deepseek.com/guides/kv_cache)
- [Create Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion)
