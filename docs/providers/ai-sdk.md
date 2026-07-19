# AI SDK provider adapter

## What it does

`@arnilo/prism-provider-ai-sdk` adapts a host-supplied AI SDK `LanguageModelV4` into a Prism `AIProvider`. It maps Prism messages, tools, and structured-output options into `doStream` call options, then translates stream parts into Prism provider events incrementally.

Supported specification: `@ai-sdk/provider` **v4** (`specificationVersion: "v4"`). Core `@arnilo/prism` does not depend on the AI SDK.

## When to use it

Use this package when a host already creates AI SDK language models and wants them inside Prism agent/session loops without adding another first-party HTTP provider.

Do not use it as a credential store, model catalog, or high-level `streamText`/`generateText` replacement. Hosts keep owning credentials inside the supplied model.

## Inputs / request

```ts
import { createAiSdkProvider } from "@arnilo/prism-provider-ai-sdk";

createAiSdkProvider(options: {
  model: LanguageModelV4;
  id?: string;
}): AIProvider
```

| Field | Type | Purpose |
| --- | --- | --- |
| `model` | `LanguageModelV4` | Host-owned AI SDK language model. |
| `id` | `string` | Prism provider id. Defaults to `ai-sdk:<model.provider>` or `ai-sdk`. |

Mapped request surfaces:

| Prism | AI SDK |
| --- | --- |
| `messages` | `LanguageModelV4Prompt` |
| `tools` | `LanguageModelV4FunctionTool[]` with JSON Schema `inputSchema` |
| `options.structuredOutput` | `responseFormat: { type: "json", name, schema }` |
| `model.parameters` | `maxOutputTokens`, `temperature`, `topP`, `topK`, penalties, `seed`, `stopSequences` |
| `request.signal` | `abortSignal` (always wins over adapter options) |
| `options.headers` | extension headers only; model owns auth |

Unsupported content fails before `doStream` (for example unresolved `resourceUri`, audio/file/document without declared capability, `tool_call_delta` in history, non-text system content).

## Outputs / response / events

| AI SDK stream part | Prism event |
| --- | --- |
| `text-delta` | `content_delta` text |
| `reasoning-delta` | `content_delta` thinking |
| `tool-input-start` / `tool-input-delta` | `tool_call_delta` |
| `tool-call` (client-executed) | `tool_call` |
| `finish` usage | `usage` then `done` |
| `error` / thrown / abort | redacted `error` |

`finish.usage.inputTokens.cacheRead` / `cacheWrite` map to Prism `Usage.cacheReadTokens` / `cacheWriteTokens`. The adapter does not invent cache request fields; prompt caching is owned by the host `LanguageModelV4` and its upstream provider.

Provider-executed tool calls, files/sources/custom parts, warnings, and raw chunks are ignored rather than silently converted into unsupported Prism content.

## Request/response example

```json
{
  "prompt": [{ "role": "user", "content": [{ "type": "text", "text": "hello" }] }],
  "tools": [{ "type": "function", "name": "echo", "inputSchema": { "type": "object" } }],
  "responseFormat": {
    "type": "json",
    "name": "Answer",
    "schema": { "type": "object", "properties": { "ok": { "type": "boolean" } } }
  }
}
```

## Implementation example

```ts
import { createAgent } from "@arnilo/prism";
import { createAiSdkProvider } from "@arnilo/prism-provider-ai-sdk";

const provider = createAiSdkProvider({ model: hostCreatedLanguageModelV4 });

const agent = createAgent({
  provider,
  model: {
    provider: provider.id,
    model: hostCreatedLanguageModelV4.modelId,
    capabilities: { tools: true, streaming: true, structuredOutput: true, input: ["text"] },
  },
});

const result = await agent.createSession().run("Summarize this");
console.log(result.text);
```

## Model catalog and discovery

There is **no Prism-side model catalog** and **no `list*Models()` export** by design. Hosts supply a ready-made `LanguageModelV4` instance (typically from `@ai-sdk/openai`, `@ai-sdk/anthropic`, AI Gateway, or a custom provider) and register a matching `ModelConfig` for capabilities/limits.

Prism setup remains network-free: `createAiSdkProvider` only wraps the supplied model and never fetches catalogs or credentials.

## Prompt caching

The adapter is **host-owned for request caching**. It does not emit `cache_control`, `prompt_cache_key`, `cacheKey`, or `cacheRetention` on AI SDK call options. Hosts configure caching on the underlying AI SDK model/provider (for example via AI SDK `providerOptions` on the model factory or per-call options forwarded through `options.compat` / `options.extra` → `providerOptions.prism`).

When the host model reports cache accounting on the `finish` stream part, Prism maps official AI SDK v4 usage fields:

| AI SDK `LanguageModelV4Usage` | Prism `Usage` |
| --- | --- |
| `inputTokens.cacheRead` | `cacheReadTokens` |
| `inputTokens.cacheWrite` | `cacheWriteTokens` |
| `inputTokens.total` | `inputTokens` |
| `outputTokens.total` | `outputTokens` |

See [Provider caching](../provider-caching.md) for the cross-provider matrix.

## Thinking and reasoning

Reasoning effort, budgets, and provider-specific thinking controls are **host-model-owned**. Prism does not map `ThinkingLevel` into AI SDK call options (`thinkingFamilyForModel` → `noop`). Hosts configure reasoning on the AI SDK model (for example OpenAI `reasoning.effort` via AI SDK `providerOptions`) and may pass per-turn overrides through `ProviderRequestOptions.compat` / `extra`, which the adapter forwards as `providerOptions.prism`.

Stream mapping:

| Direction | Mapping |
| --- | --- |
| AI SDK `reasoning-delta` → Prism | `content_delta` thinking |
| Prism `thinking` blocks → AI SDK prompt | `{ type: "reasoning", text }` on assistant messages |

Official evidence: [Custom providers / LanguageModelV4](https://ai-sdk.dev/providers/community-providers/custom-providers); [Language Model Specification V4](https://github.com/vercel/ai/tree/main/packages/provider/src/language-model/v4); `@ai-sdk/provider` `LanguageModelV4Usage` (`inputTokens.cacheRead` / `cacheWrite`).

## Extension and configuration notes

- Peer dependency: `@ai-sdk/provider@^4.0.0`. Upgrade policy tracks one specification major at a time.
- First-party HTTP providers remain independent; this adapter is available directly, through `@arnilo/prism-providers`, or through `@arnilo/prism-all`. Installation does not select a model or invoke AI SDK.
- `options.compat` / `options.extra` pass through as AI SDK `providerOptions.prism`.
- Export helpers `toAiSdkCallOptions`, `toAiSdkPrompt`, and `mapAiSdkStream` for tests and custom hosts.

## Security and performance notes

- Host credentials stay inside the supplied AI SDK model. The adapter never reads env keys or credential stores.
- Abort and resource limits come from Prism `request.signal`; adapter options cannot replace that bound.
- Stream parts are translated incrementally with no full-response buffering and no duplicate model call.
- Unsupported content fails closed before model invocation. Errors use Prism `providerError` redaction.
- Provider metadata/warnings are not emitted as prompt or tool content.

## Related APIs

- [Provider packages](../provider-packages.md)
- [Provider conformance](../provider-conformance.md)
- [Provider layer](../provider-layer.md)
- [Structured output](../structured-output.md)
- [Agent session runtime](../agent-session-runtime.md)
