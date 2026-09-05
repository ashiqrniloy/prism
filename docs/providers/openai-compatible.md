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
| `baseUrl` | `string` | Base API URL; `/chat/completions` is appended unless `chatCompletionsUrl` is set. |
| `apiKey` | `CredentialValueSource` | Optional direct/callback/resolver credential source. |
| `fetch` | `typeof fetch` | Optional fetch implementation for tests or custom hosts. |
| `chatCompletionsUrl` | `string \| ((request) => string)` | Optional full chat-completions URL override (Azure deployment paths). |
| `authStyle` | `"bearer" \| "api-key" \| "none"` | Auth header style. Default `bearer`. |
| `buildBodyExtra` | `(request) => JsonObject \| undefined` | Optional provider-specific body fields (thinking/reasoning/cache); merged over the base body. |
| `mapMessages` | `(request) => readonly Message[]` | Optional message transform before serialization (e.g. cache-control markers). Defaults to `request.messages`. |
| `mapUsage` | `(usage: unknown) => Usage \| undefined` | Optional usage mapping override (e.g. OpenRouter cost fields). Defaults to `mapOpenAIChatUsage`. |
| `serializeMessage` | `(message, request) => JsonObject` | Optional custom message serializer (e.g. Z.AI `reasoning_content` replay). Defaults to assert + `serializeOpenAIChatMessage`. |
| `doneUsage` | `boolean` | Emit the final stream usage on the `done` event (without strict completion checks). |
| `mapHttpError` | `(response, bodyText, secrets) => Error` | Custom HTTP error mapping (e.g. NeuralWatt retry classification). Receives the response and redacted body text. |
| `onComment` | `(text) => ProviderEvent \| undefined` | Handle SSE comment lines (text after `:`), e.g. NeuralWatt `: energy` / `: cost` telemetry. Returned events are yielded in stream order. |
| `extraHeaders` | `(request) => Record<string, string>` | Optional extra request headers; provider auth and `content-type` still win. |
| `transformBody` | `(body, request) => JsonObject` | Optional final body transform, applied last (token limits, compat stripping); wins over everything. |
| `strictCompletion` | `boolean` | Require `[DONE]` **and** a `finish_reason` before emitting `done`; truncated streams yield an `error` and `done` carries the final usage. **Default `true`** (fail-closed); set `false` explicitly to accept streams that end without completion evidence — the documented downgrade whose risk the opting host owns. |
| `requestFailedPrefix` | `string` | Prefix for HTTP error messages. Default `OpenAI-compatible request failed`. |

The subpath also exports the building blocks for provider packages that keep public body/stream helpers:

- `openAIChatEvents(body, { signal, strictCompletion, doneUsage, mapUsage, onComment })`: the shared SSE stream loop as an `AsyncIterable<ProviderEvent>`. `strictCompletion` defaults to `true` (see the Security notes).
- `buildOpenAIChatBody(request, { mapMessages, serializeMessage, buildBodyExtra, transformBody })`: the base Chat Completions request body builder.

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
| `[DONE]` + `finish_reason` | `done` event. A stream ending without either terminal variant yields an `error` instead (strict default). |
| HTTP/stream/parsing error | `error` event with redacted `ErrorInfo`. |

The adapter passes `request.signal` to `fetch` for abort propagation; an already-aborted signal throws before fetch.

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
- Vendor-specific OpenAI-compatible endpoints (cache markers, thinking bodies, reasoning fields, custom usage) plug in through `buildBodyExtra`/`mapMessages`/`mapUsage`/`extraHeaders` instead of duplicating the stream loop:

```ts
const provider = createOpenAICompatibleProvider({
  baseUrl: "https://vendor.example/v1",
  apiKey: () => process.env.VENDOR_API_KEY,
  buildBodyExtra: (request) => ({ thinking: { type: "enabled" } }),
  extraHeaders: () => ({ "x-vendor-app": "my-app" }),
});
```

- Cache behavior is intentionally minimal: this Chat Completions adapter sends no `prompt_cache_key`, `prompt_cache_retention`, or `cache_control` fields. Endpoints that cache implicitly do so automatically; hosts needing OpenAI `prompt_cache_key`/`prompt_cache_retention` should use the [`@arnilo/prism-providers/openai`](openai.md) Responses package. The adapter still normalizes cache usage from `prompt_tokens_details.cached_tokens` (and `prompt_cache_hit_tokens`) into `Usage.cacheReadTokens`.

## Security and performance notes

- Credentials are host-owned and resolved only when `generate()` runs.
- Resolved API keys are used for the HTTP `Authorization` header and passed to error redaction; they are not stored in registries or events.
- Redaction only removes known values supplied to the helper. Avoid logging raw provider requests/responses.
- `fetch` receives the request `AbortSignal`.
- SSE and HTTP error bodies are read through bounded `@arnilo/prism/providers/transport` helpers (`readSseData`, `readBoundedResponseText`) with configurable byte ceilings.
- **Strict completion is the shared default (since 0.2.1):** a chat stream is complete only when both `[DONE]` and a `finish_reason` were observed. EOF without either is treated as truncation and emits an `error` ("Chat stream ended without completion evidence"), never a successful `done` — a partial answer can no longer be mistaken for a completed one. Providers that legitimately omit one of the terminal markers must pass `strictCompletion: false` explicitly, accepting the truncation-detection downgrade. `done` carries the final stream usage when the stream was strict (or `doneUsage` is set).
- Tests should use injected `fetch` and never make real network calls.
- Tool-call arguments are accumulated as streamed text, parsed with `parseJsonObjectArguments` when the final tool call is emitted; empty argument text yields `{}`, malformed JSON yields an `error` event.

## Thinking and reasoning

The shared OpenAI-compatible base (`createOpenAICompatibleProvider`) does **not** spread `compat` onto request bodies — packages that want thinking forwarded wire a `buildBodyExtra`/`transformBody` hook (Azure, Vertex, and Bedrock use the shared sanitized forwarder: `reasoning_effort` + aliases or a `reasoning` object, effort snapped to declared levels). Host-owned adapters should do the same or accept the no-op. See [Thinking and reasoning](../thinking-and-reasoning.md).

## Related APIs

- [Provider layer](../provider-layer.md): registries, provider events, tool-call helpers, and mock provider.
- [Credentials and redaction](../credentials-and-redaction.md): `resolveCredentialValue()`, `CredentialValueSource`, `redactSecrets()`, and `errorToErrorInfo()`.
- [Public contracts](../public-contracts.md): `AIProvider`, `ProviderRequest`, `ProviderEvent`, `ToolDefinition`, `ToolCallContent`, and `Usage`.
