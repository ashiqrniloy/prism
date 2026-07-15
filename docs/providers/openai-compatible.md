# OpenAI-compatible provider

## What it does

`@arnilo/prism/providers/openai-compatible` exports `createOpenAICompatibleProvider()` and `OpenAICompatibleProviderOptions`.

The adapter implements `AIProvider` for OpenAI-compatible Chat Completions streaming APIs using native or injected `fetch`. It maps streaming Server-Sent Events into Prism `ProviderEvent` values for text, thinking, tool-call fragments, final tool calls, usage, done, and errors.

It has no provider SDK dependency.

## When to use it

Use this adapter when a host app or extension package wants to connect a Prism provider to an OpenAI-compatible `/chat/completions` endpoint.

Do not use it for the OpenAI Responses API, provider-specific non-streaming APIs, automatic credential discovery, or real-network tests. Inject `fetch` in tests.

## Inputs / request

Import from the subpath:

```ts
import { createOpenAICompatibleProvider } from "@arnilo/prism/providers/openai-compatible";
```

Options:

| Field | Type | Purpose |
| --- | --- | --- |
| `id` | `string` | Optional provider id. Defaults to `openai-compatible`. |
| `baseUrl` | `string` | Base API URL; `/chat/completions` is appended. |
| `apiKey` | `CredentialValueSource` | Optional direct/callback/resolver credential source. |
| `fetch` | `typeof fetch` | Optional fetch implementation for tests or custom hosts. |

Provider requests use the standard `ProviderRequest` shape: `model`, `messages`, optional `tools`, `metadata`, and `signal`.

## Outputs / response / events

The returned provider emits normalized `ProviderEvent` values:

| Stream input | Prism output |
| --- | --- |
| `delta.content` | `content_delta` with text content. |
| `delta.reasoning_content` | `content_delta` with thinking content. |
| streamed `tool_calls` fragments | `tool_call_delta` events. |
| complete accumulated tool call | final `tool_call` event. |
| `usage` | `usage` event. |
| `[DONE]` or stream end | `done` event. |
| HTTP/stream/parsing error | `error` event with redacted `ErrorInfo`. |

The adapter passes `request.signal` to `fetch` for abort propagation.

## Request/response example

Example request body sent to an OpenAI-compatible endpoint:

```json
{
  "model": "demo-model",
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "stream": true,
  "stream_options": { "include_usage": true }
}
```

Example Prism events:

```json
[
  { "type": "content_delta", "content": { "type": "text", "text": "Hel" } },
  { "type": "content_delta", "content": { "type": "text", "text": "lo" } },
  { "type": "done" }
]
```

## Implementation example

```ts
import { createOpenAICompatibleProvider } from "@arnilo/prism/providers/openai-compatible";

const provider = createOpenAICompatibleProvider({
  baseUrl: "https://api.openai.com/v1",
  apiKey: () => process.env.OPENAI_API_KEY,
});

for await (const event of provider.generate({
  model: { provider: provider.id, model: "demo-model" },
  messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
})) {
  console.log(event.type);
}
```

Test with injected fetch, not the network:

```ts
const provider = createOpenAICompatibleProvider({
  baseUrl: "https://example.test/v1",
  fetch: async () => new Response("data: [DONE]\\n\\n", { status: 200 }),
});
```

## Extension and configuration notes

- Extension packages can create this provider and register it with a host-owned provider registry.
- Hosts choose the provider id, base URL, model configs, credential source, and fetch implementation.
- The adapter resolves `apiKey` per request through `resolveCredentialValue()`.
- This adapter currently targets Chat Completions streaming only.
- The serializer preserves text, thinking (downgraded to text), assistant `tool_call` blocks as `tool_calls`, `tool_result` blocks as role `tool` messages, and image blocks when the model declares `capabilities.input` includes `"image"`. Unsupported block placements or unclaimed images fail before fetch.
- Cache behavior is intentionally minimal: this Chat Completions adapter sends no `prompt_cache_key`, `prompt_cache_retention`, or `cache_control` fields. Endpoints that cache implicitly do so automatically; hosts needing OpenAI `prompt_cache_key`/`prompt_cache_retention` should use the [`@arnilo/prism-provider-openai`](openai.md) Responses package. The adapter still normalizes cache usage from `prompt_tokens_details.cached_tokens` (and `prompt_cache_hit_tokens`) into `Usage.cacheReadTokens`.

## Security and performance notes

- Credentials are host-owned and resolved only when `generate()` runs.
- Resolved API keys are used for the HTTP `Authorization` header and passed to error redaction; they are not stored in registries or events.
- Redaction only removes known values supplied to the helper. Avoid logging raw provider requests/responses.
- `fetch` receives the request `AbortSignal`.
- SSE and HTTP error bodies are read through bounded `@arnilo/prism/providers/transport` helpers (`readSseData`, `readBoundedResponseText`) with configurable byte ceilings.
- Tests should use injected `fetch` and never make real network calls.
- Tool-call arguments are accumulated as streamed text, parsed with `parseJsonObjectArguments` when the final tool call is emitted; empty argument text yields `{}`, malformed JSON yields an `error` event.

## Related APIs

- [Provider layer](../provider-layer.md): registries, provider events, tool-call helpers, and mock provider.
- [Credentials and redaction](../credentials-and-redaction.md): `resolveCredentialValue()`, `CredentialValueSource`, `redactSecrets()`, and `errorToErrorInfo()`.
- [Public contracts](../public-contracts.md): `AIProvider`, `ProviderRequest`, `ProviderEvent`, `ToolDefinition`, `ToolCallContent`, and `Usage`.
