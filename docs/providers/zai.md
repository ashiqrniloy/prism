# Z.AI provider package

## What it does

`@arnilo/prism-provider-zai` provides explicit, side-effect-free setup for the Z.AI
GLM Chat Completions API (`POST /chat/completions`) with official deep-thinking,
reasoning-effort, and tool-stream request fields.

The package registers a provider, featured GLM model metadata, and an `api_key`
auth method through `createExtensionKernel().load([...])`.

## When to use it

Use it when a host app wants to run Z.AI GLM models through Prism's
`AgentSession` runtime with official `thinking` / `reasoning_effort` /
`tool_stream` mapping and implicit context caching.

Do not use it for automatic credential discovery, setup-time catalog fetches, or
real-network tests.

## Inputs / request

```ts
import {
  createZaiProviderPackage,
  defineZaiModel,
  listZaiModels,
} from "@arnilo/prism-provider-zai";

createZaiProviderPackage(options: ZaiProviderPackageOptions): ProviderPackage
defineZaiModel(config: ZaiModelConfig): ModelConfig
listZaiModels(options?: ListZaiModelsOptions): Promise<ModelConfig[]>
```

| Field | Type | Purpose |
| --- | --- | --- |
| `apiKey` | `CredentialValueSource` | Direct/callback/resolver API-key source. |
| `fetch` | `typeof fetch` | Optional fetch implementation for tests/hosts. |
| `baseUrl` | `string` | Overrides the Z.AI base URL (default `https://api.z.ai/api/paas/v4`). |
| `id` | `string` | Overrides the provider id (default `zai`). |
| `models` | `readonly ModelConfig[]` | Overrides featured `zaiModels` defaults. |

### Thinking / reasoning compat

Official body fields (request `options.compat` wins over `model.compat`):

| Compat / body field | Wire shape | Notes |
| --- | --- | --- |
| `thinking` | `boolean` or `{ type: "enabled" \| "disabled", clear_thinking?: boolean }` | Boolean `true`/`false` maps to `{ type: "enabled" }` / `{ type: "disabled" }`. |
| `reasoning_effort` | string | GLM-5.2+: `max` (default) \| `xhigh` \| `high` \| `medium` \| `low` \| `minimal` \| `none`. |
| `tool_stream` | boolean | GLM-4.6+: stream tool-call argument deltas (`false` by API default; featured 4.6+ models opt in). |
| `clear_thinking` | boolean | Nested into `thinking.clear_thinking`. Default on the API is `true` (drop prior reasoning). Set `false` for Preserved Thinking. |
| `preserveThinking` | boolean | Prism-local: when true (or when `clear_thinking: false`), replay prior thinking blocks as assistant `reasoning_content`. |

`ProviderRequestOptions.cacheRetention: "none"` forces `thinking: { type: "disabled" }`.

Shared Prism helpers (`applyThinkingLevel` / `thinkingFamilyForModel`) map portable
levels into the `reasoning_effort` family for Z.AI; hosts can also set
`thinking.type` directly for enable/disable.

## Outputs / response / events

| Surface | Behavior |
| --- | --- |
| Provider stream | Prism text, thinking (`delta.reasoning_content`), tool-call delta/final, `usage`, `done`, redacted `error`. |
| Block preservation | Text; thinking → `reasoning_content` when Preserved Thinking is active (otherwise dropped, never flattened into text); assistant `tool_call` → `tool_calls`; `tool_result` → role `tool`; images when `capabilities.input` includes `"image"`. |
| Auth method | `api_key` for the configured provider id, credential name `apiKey`. |

Unsupported block placements or unclaimed images fail before fetch.

## Request/response example

Example request body (official Chat Completions shape):

```json
{
  "model": "glm-5.2",
  "messages": [{ "role": "user", "content": "Hello" }],
  "stream": true,
  "thinking": { "type": "enabled" },
  "reasoning_effort": "max",
  "tool_stream": true
}
```

## Implementation example

```ts
import { createExtensionKernel } from "@arnilo/prism";
import { createZaiProviderPackage, listZaiModels } from "@arnilo/prism-provider-zai";

const kernel = createExtensionKernel();
await kernel.load([createZaiProviderPackage({ apiKey: "fake-zai-key" })]);

// Optional caller-gated discovery (never runs during package setup):
const live = await listZaiModels({ apiKey: "fake-zai-key" });
await kernel.load([createZaiProviderPackage({ apiKey: "fake-zai-key", models: live })]);
```

Per-turn thinking override:

```ts
await session.prompt("Plan the refactor", {
  providerOptions: {
    compat: {
      thinking: { type: "enabled", clear_thinking: false },
      reasoning_effort: "high",
      tool_stream: true,
    },
  },
});
```

## Extension and configuration notes

- Default base URL is the official international endpoint
  `https://api.z.ai/api/paas/v4`. Hosts targeting China can pass
  `baseUrl: "https://open.bigmodel.cn/api/paas/v4"`. Coding Plan hosts may use
  `https://api.z.ai/api/coding/paas/v4`.
- Featured `zaiModels` are offline bootstrap aliases (`glm-5.2`, `glm-5.1`,
  `glm-5`, `glm-5-turbo`, `glm-4.7`, `glm-4.6`, `glm-4.5`) curated from the
  official Chat Completions model enum and overview context sizes.
- `listZaiModels()` is caller-gated OpenAI-compatible `GET /models` discovery
  (not a first-class docs.z.ai list page). Setup never fetches.
- `defineZaiModel` sets Z.AI-specific `compat` (`thinking`, `reasoning_effort`,
  `tool_stream`, `clear_thinking`, `preserveThinking`).

### Cache behavior

- Z.AI GLM models use **implicit context caching**: the server caches prompt
  prefixes automatically based on request content, with no explicit request-side
  cache payload. Catalog models declare `cache: { kind: "implicit" }`.
- Official docs: hits appear in `usage.prompt_tokens_details.cached_tokens`.
- The provider sends no `cache_control`, `prompt_cache_key`, `prompt_cache_retention`,
  or other explicit cache-control fields regardless of `ProviderRequestOptions.cache`
  / `cacheKey` / `cacheRetention` settings — those options have no effect on the
  Z.AI request body (except `cacheRetention: "none"` disabling thinking).
- Usage accounting: `prompt_tokens_details.cached_tokens` → `Usage.cacheReadTokens`
  and `prompt_tokens_details.cache_write_tokens` → `Usage.cacheWriteTokens` when
  the server reports them.

## Security and performance notes

- SSE streams and HTTP error bodies use bounded `@arnilo/prism/providers/transport`
  helpers (`readSseData`, `readBoundedResponseText`).
- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- API keys are resolved per request from caller-supplied values or resolvers and
  redacted from errors (including discovery failures).
- Caller-supplied `ProviderRequest.options.headers` can add non-owned headers,
  but provider-owned headers (`content-type`, `authorization`) are applied last
  and cannot be overridden by caller headers.
- Live tests stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1` plus `ZAI_API_KEY`;
  default tests are network-free.

## Related APIs

- [Provider packages](../provider-packages.md): `defineProviderPackage`,
  caller-gated discovery, per-turn thinking.
- [Thinking and reasoning](../thinking-and-reasoning.md): portable
  `applyThinkingLevel` → Z.AI `reasoning_effort` / `thinking.type`.
- [Credentials and redaction](../credentials-and-redaction.md):
  `resolveCredentialValue`, `redactSecrets`.
- [Provider caching](../provider-caching.md): implicit GLM context caching.
- [Provider conformance](../provider-conformance.md): network-free adapter tests.

## Official evidence

- [Deep Thinking](https://docs.z.ai/guides/capabilities/thinking)
- [Thinking Mode](https://docs.z.ai/guides/capabilities/thinking-mode) (Preserved Thinking / `clear_thinking`)
- [Tool Streaming](https://docs.z.ai/guides/capabilities/stream-tool)
- [Context Caching](https://docs.z.ai/guides/capabilities/cache)
- [Chat Completion](https://docs.z.ai/api-reference/llm/chat-completion)
- [Migrate to GLM-5.2](https://docs.z.ai/guides/overview/migrate-to-glm-new)
- [Models overview](https://docs.z.ai/guides/overview/overview)
