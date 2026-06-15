# Provider layer

## What it does

The provider layer contains the small runtime pieces Prism already ships for host-owned model access:

- `createProviderRegistry()` / `ProviderRegistry`: register and resolve `AIProvider` instances by id.
- `createModelRegistry()` / `ModelRegistry`: register and resolve `ModelConfig` values by provider/model key.
- Provider event helpers: create normalized `ProviderEvent` values for text, thinking, tool calls, usage, done, and errors.
- `toolCallContent()`: create a `ToolCallContent` block.
- `createMockProvider()` / `MockProviderOptions`: create a deterministic scripted `AIProvider` for tests and examples.

These APIs are exported from the root `prism` package.

## When to use it

Use this layer when a host app, extension package, or test needs to:

- Keep an explicit provider/model registry instead of hidden globals.
- Fail closed before any provider call when a provider or model is unknown.
- Emit provider events without hand-writing event objects.
- Test agent/provider flows without timers, credentials, SDKs, or network calls.

Do not use this layer for credential storage, settings loading, tool dispatch, agent loops, or provider SDK configuration. Those stay host-owned or belong to later Prism phases.

## Inputs / request

### Provider registry

```ts
createProviderRegistry(providers?: readonly AIProvider[]): ProviderRegistry
```

`ProviderRegistry` methods:

| Method | Input | Result |
| --- | --- | --- |
| `register(provider)` | `AIProvider` | Stores provider by `provider.id`. |
| `get(id)` | provider id string | Returns provider or `undefined`. |
| `resolve(model)` | provider id string or `{ provider: string }` | Returns provider or throws `Unknown provider: <id>`. |
| `list()` | none | Returns registered providers in insertion order. |

### Model registry

```ts
createModelRegistry(models?: readonly ModelConfig[]): ModelRegistry
```

`ModelRegistry` methods:

| Method | Input | Result |
| --- | --- | --- |
| `register(model)` | `ModelConfig` | Stores model by provider/model key. |
| `get(provider, model)` | provider id and model id | Returns model config or `undefined`. |
| `resolve(provider, model)` | provider id and model id | Returns model config or throws `Unknown model: <provider>/<model>`. |
| `list()` | none | Returns registered model configs in insertion order. |

### Provider event helpers

```ts
providerTextDelta(text: string): ProviderEvent
providerThinkingDelta(text: string, signature?: string): ProviderEvent
providerContentDelta(content: ContentBlock): ProviderEvent
providerToolCallDelta(delta: { index: number; id?: string; name?: string; argumentsText?: string }): ProviderEvent
providerToolCall(call: ToolCallContent): ProviderEvent
providerUsage(usage: Usage): ProviderEvent
providerDone(usage?: Usage): ProviderEvent
providerError(error: unknown, secrets?: readonly (string | undefined)[]): ProviderEvent
toolCallContent(id: string, name: string, args?: JsonObject): ToolCallContent
```

### Mock provider

```ts
createMockProvider(events?: readonly ProviderEvent[], options?: MockProviderOptions): AIProvider
```

`MockProviderOptions`:

| Field | Type | Purpose |
| --- | --- | --- |
| `id` | `string` | Optional provider id. Defaults to `mock`. |
| `onRequest` | `(request: ProviderRequest) => void` | Optional request observer for tests. |

## Outputs / response / events

- Registry `resolve()` returns the matching provider/model or throws before any provider `generate()` call.
- Provider event helpers return plain `ProviderEvent` objects.
- `providerError()` converts unknown errors to redacted `ErrorInfo` through `errorToErrorInfo()`.
- `createMockProvider()` returns an `AIProvider` whose `generate()` yields the scripted events in order and checks `request.signal?.aborted` before each event.

## Request/response example

```json
{
  "provider": "mock",
  "model": "demo"
}
```

Example provider events:

```json
[
  { "type": "content_delta", "content": { "type": "text", "text": "Hello" } },
  { "type": "done" }
]
```

## Implementation example

```ts
import {
  createModelRegistry,
  createMockProvider,
  createProviderRegistry,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "prism";

const provider = createMockProvider([
  providerTextDelta("Hello"),
  providerToolCall(toolCallContent("call_1", "lookup", { id: "1" })),
  providerDone(),
]);

const providers = createProviderRegistry([provider]);
const models = createModelRegistry([{ provider: "mock", model: "demo" }]);

const resolvedProvider = providers.resolve("mock");
const resolvedModel = models.resolve("mock", "demo");

for await (const event of resolvedProvider.generate({
  model: resolvedModel,
  messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
})) {
  console.log(event.type);
}
```

## Extension and configuration notes

- Registries are explicit objects returned by factories. Prism does not create a hidden global provider/model registry.
- Extension packages can contribute `AIProvider` and `ModelConfig` values by registering them with host-owned registries.
- Model resolution and provider resolution are separate on purpose: hosts can validate a model exists before selecting a provider.
- Mock provider is for deterministic tests/examples. Real providers should implement `AIProvider` directly or through adapter packages.

## Security and performance notes

- Provider/model registries are `Map`-backed and perform O(1) lookup.
- Registries store providers and model metadata only. Do not store API keys, credential resolvers, headers, tokens, or secret-bearing settings in them.
- Unknown provider/model resolution fails before provider execution or network I/O.
- `createMockProvider()` uses scripted events only: no timers, credentials, SDKs, or network.
- Do not hide real secrets in mock event fixtures. If an error event must include secret-like text, use fake placeholders and redaction helpers.
- `providerError(error, secrets)` only redacts the provided secret values. It is not a general secret scanner.

## Related APIs

- [Public contracts](public-contracts.md): `AIProvider`, `ProviderRequest`, `ProviderEvent`, `ModelConfig`, `Usage`, and content/tool-call contracts.
- [Credentials and redaction](credentials-and-redaction.md): credential and redaction helpers used by provider adapters.
- [OpenAI-compatible provider](providers/openai-compatible.md): optional provider adapter that emits these normalized provider events.
