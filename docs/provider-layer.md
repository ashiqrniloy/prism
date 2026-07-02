# Provider layer

## What it does

The provider layer contains the small runtime pieces Prism already ships for host-owned model access:

- `createProviderRegistry()` / `ProviderRegistry`: register and resolve `AIProvider` instances by id.
- `createProviderResolver()` / `ProviderResolver`: build a resolver that maps a `ModelConfig` to an `AIProvider` (or `undefined`), from a `ProviderRegistry` or a plain `AIProvider[]`.
- `createModelRegistry()` / `ModelRegistry`: register and resolve `ModelConfig` values by provider/model key. See [Model registry](model-registry.md).
- `ModelConfig` metadata fields for display names, capabilities, limits, cost/cache pricing, cache support metadata, opaque provider compat data, and host metadata. See [Provider caching](provider-caching.md).
- Provider event helpers: create normalized `ProviderEvent` values for text, thinking, streamed tool-call deltas, final tool calls, usage, done, and errors, including optional cache read/write usage fields.
- `toolCallContent()`: create a `ToolCallContent` block.
- `createMockProvider()` / `MockProviderOptions`: create a deterministic scripted `AIProvider` for tests and examples.
- `@arnilo/prism/testing/provider-conformance`: optional network-free assertion helpers for provider adapter tests.

These APIs are exported from the root `@arnilo/prism` package. `ProviderRegistry` and `ModelRegistry` are public runtime API types that live beside their factory implementations, not in the type-only `contracts.ts` file.

## When to use it

Use this layer when a host app, extension package, or test needs to:

- Keep an explicit provider/model registry instead of hidden globals.
- Fail closed before any provider call when a provider or model is unknown.
- Emit provider events without hand-writing event objects.
- Test agent/provider flows without timers, credentials, SDKs, or network calls.

Do not use this layer for credential storage, settings loading, tool dispatch, agent loops, package discovery, cache stores, or provider SDK configuration. Those stay host-owned or belong to provider packages. Request option hooks are covered in [Provider request policies](provider-request-policies.md).

## Inputs / request

### Provider registry

```ts
createProviderRegistry(providers?: readonly AIProvider[], options?: { duplicate?: "replace" | "error" }): ProviderRegistry
```

`ProviderRegistry` methods:

| Method | Input | Result |
| --- | --- | --- |
| `register(provider)` | `AIProvider` | Stores/replaces provider by `provider.id`; throws `Duplicate provider: <id>` when `duplicate: "error"`. |
| `get(id)` | provider id string | Returns provider or `undefined`. |
| `resolve(model)` | provider id string or `{ provider: string }` | Returns provider or throws `Unknown provider: <id>`. |
| `list()` | none | Returns registered providers in insertion order. |

### Model registry

```ts
createModelRegistry(models?: readonly ModelConfig[], options?: { duplicate?: "replace" | "error" }): ModelRegistry
```

`ModelRegistry` methods:

| Method | Input | Result |
| --- | --- | --- |
| `register(model)` | `ModelConfig` | Stores/replaces model by provider/model key, preserving inert metadata; throws `Duplicate model: <provider>/<model>` when `duplicate: "error"`. |
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

`tool_call_delta` fragments use the same `{ index, id?, name?, argumentsText? }` shape as live `message_delta` content. Runtime reconstructs final `ToolCallContent` before tool execution; conformance tests use the same reconstruction rules.

### Mock provider

```ts
createMockProvider(events?: readonly ProviderEvent[], options?: MockProviderOptions): AIProvider
```

`MockProviderOptions`:

| Field | Type | Purpose |
| --- | --- | --- |
| `id` | `string` | Optional provider id. Defaults to `mock`. |
| `onRequest` | `(request: ProviderRequest) => void` | Optional request observer for tests. |

### Provider resolver

```ts
export type ProviderResolver = (model: ModelConfig) => AIProvider | undefined;

createProviderResolver(source: ProviderRegistry | readonly AIProvider[]): ProviderResolver
```

A `ProviderResolver` maps a `ModelConfig` to an `AIProvider` for the current
run. `createProviderResolver()` builds one from a `ProviderRegistry` (reuses
`ProviderRegistry.get`) or a plain `AIProvider[]` (builds an id-keyed lookup
once at construction; last duplicate id wins). A custom function is the
zero-helper path for hosts with their own provider map (lazy construction,
per-request routing).

The resolver returns `undefined` on a miss; the agent runtime fails closed with
`Unknown provider: ${model.provider}` before any provider turn (see
[Agent/session runtime](agent-session-runtime.md)).

Wire `providerSource` on `AgentConfig`, override per run with
`RunOptions.providerSource` (RunOptions wins). When `AgentConfig.provider` is
set it takes first precedence and the resolver is bypassed. The resolver is
called once per run with `options.model ?? config.model`; per-turn
re-resolution is unnecessary.

```ts
import { createAgent, createProviderResolver, createProviderRegistry } from "@arnilo/prism";

const own = createMyProvider();
const providerSource = createProviderResolver(createProviderRegistry([own]));
// or mix first-party + own in one list:
// const providerSource = createProviderResolver([firstPartyProvider, own]);

const agent = createAgent({ model: { provider: own.id, model: "demo" }, providerSource });
```

## Outputs / response / events

- Registry `resolve()` returns the matching provider/model or throws before any provider `generate()` call.
- Provider event helpers return plain `ProviderEvent` objects.
- `providerError()` converts unknown errors to redacted `ErrorInfo` through `errorToErrorInfo()` and preserves safe string/number `code` fields for retry classification.
- `createMockProvider()` returns an `AIProvider` whose `generate()` yields the scripted events in order and checks `request.signal?.aborted` before each event.
- The agent/session runtime passes its per-run abort signal as `ProviderRequest.signal`. `ProviderRequestOptions.timeoutMs`, `maxRetries`, and `maxRetryDelayMs` are deprecated inert hints in first-party providers; use `RunOptions.signal`/host abort controllers for timeouts and `AgentConfig.retry`/`RunOptions.retry` for retry.

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
} from "@arnilo/prism";

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
  options: { sessionId: "session-1", cacheRetention: "short" },
})) {
  console.log(event.type);
}
```

## Extension and configuration notes

- Registries are explicit objects returned by factories. Prism does not create a hidden global provider/model registry.
- Default duplicate policy is `"replace"` for compatibility. Hosts that load third-party provider/model contributions can pass `duplicate: "error"` to reject silent shadowing.
- Extension packages can contribute `AIProvider` and `ModelConfig` values by registering them with host-owned registries.
- Model resolution and provider resolution are separate on purpose: hosts can validate a model exists before selecting a provider.
- Credential resolvers stay outside these registries; pass credentials directly to the provider adapter or runtime edge that needs them.
- Mock provider is for deterministic tests/examples. Real providers should implement `AIProvider` directly or through adapter packages.

## Security and performance notes

- Provider/model registries are `Map`-backed and perform O(1) lookup. Strict duplicate mode adds one O(1) `Map.has()` check during registration only.
- Registries store providers and model metadata only. Do not store API keys, credential resolvers, headers, tokens, or secret-bearing settings in them.
- Unknown provider/model resolution fails before provider execution or network I/O.
- `createMockProvider()` uses scripted events only: no timers, credentials, SDKs, or network.
- Do not hide real secrets in mock event fixtures. If an error event must include secret-like text, use fake placeholders and redaction helpers.
- `providerError(error, secrets)` only redacts the provided secret values. It is not a general secret scanner.
- Providers may set safe `ErrorInfo.code` values such as `429`, `503`, or `ETIMEDOUT`; retry policy code treats them as classification hints, not trusted provider metadata.

## Related APIs

- [Agent/session runtime](agent-session-runtime.md): passes abort signals to providers, maps provider errors to session `error` events, and can retry configured transient provider-turn failures before output; this is the supported replacement for deprecated provider-level retry options.
- [Provider packages](provider-packages.md): explicit package primitive for registering providers, models, auth descriptors, request/cache policies, and prompt contributions.
- [Public contracts](public-contracts.md): `AIProvider`, `ProviderRequest`, `ProviderEvent`, `ModelConfig`, `Usage`, and content/tool-call contracts.
- [Credentials and redaction](credentials-and-redaction.md): credential and redaction helpers used by provider adapters.
- [OpenAI-compatible provider](providers/openai-compatible.md): optional provider adapter that emits these normalized provider events.
- [Provider conformance](provider-conformance.md): reusable network-free provider adapter checks, including content-preservation canaries for text/thinking/tool-call/tool-result/image blocks and secret-leak assertions.
