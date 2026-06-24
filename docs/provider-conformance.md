# Provider conformance

## What it does

Provider conformance helpers are dependency-free assertions for provider package tests. They exercise normalized Prism `AIProvider` streams without live network or credentials.

Exported from `@arnilo/prism/testing/provider-conformance`:

- `collectProviderEvents(provider, request)`
- `assertProviderStreamConforms(options)`
- `assertAbortIsObserved(options)`
- `assertToolCallDeltasReconstruct(events, expected)`
- `assertUsageAccounting(events, expected)`
- `assertSerializedRequestCoversContent(request, body, options?)`
- `assertNoSecretLeak(events, secrets)`

## When to use it

Use these helpers in provider package tests to check event order, terminal events, abort propagation, streamed tool-call deltas, usage/cache accounting, request body content preservation, and secret redaction.

Do not use them as a live integration runner, provider simulator, retry framework, credential loader, or test framework replacement.

## Inputs / request

```ts
import { assertProviderStreamConforms } from "@arnilo/prism/testing/provider-conformance";

await assertProviderStreamConforms({
  provider,
  request: {
    model: { provider: "demo", model: "demo-model" },
    messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
  },
  expect: { text: "Hello", usage: { cacheReadTokens: 10 } },
});
```

Helpers accept normal `AIProvider`, `ProviderRequest`, `ProviderEvent`, `Usage`, and request body objects. They throw `Error` on failed assertions so any runner can use them.

## Outputs / response / events

- `collectProviderEvents()` returns provider events in stream order.
- `assertProviderStreamConforms()` returns collected events after verifying the stream ends with `done` or `error`, terminal events are last, and optional text/usage expectations match.
- `assertAbortIsObserved()` passes an already-aborted signal and expects provider generation to reject.
- `assertToolCallDeltasReconstruct()` rebuilds streamed `tool_call_delta` fragments into tool calls and validates expected id/name/arguments.
- `assertUsageAccounting()` finds `usage` or `done.usage` and checks selected token fields including `cacheReadTokens` and `cacheWriteTokens`.
- `assertSerializedRequestCoversContent()` scans a serialized provider request body for primitive canaries from each Prism content block and fails if any supported block type is silently dropped.
- `assertNoSecretLeak()` stringifies all collected events and fails if any known secret string is present.

## Request/response example

```json
{
  "events": ["content_delta", "usage", "done"],
  "usage": { "inputTokens": 10, "cacheReadTokens": 4, "cacheWriteTokens": 2 }
}
```

Content-preservation example:

```ts
import { assertSerializedRequestCoversContent } from "@arnilo/prism/testing/provider-conformance";

const request = {
  model: { provider: "demo", model: "demo-model" },
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "Hello" },
      { type: "image", url: "https://example.invalid/img.png" },
      { type: "tool_result", toolCallId: "call_1", name: "lookup", result: { id: "42" } },
    ],
  }],
};

const body = JSON.parse(String(fetchInit.body));
assertSerializedRequestCoversContent(request, body, { unsupported: ["image"] });
```

## Implementation example

```ts
import { createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { assertProviderStreamConforms } from "@arnilo/prism/testing/provider-conformance";

await assertProviderStreamConforms({
  provider: createMockProvider([providerTextDelta("Hello"), providerDone()]),
  request: { model: { provider: "mock", model: "demo" }, messages: [] },
  expect: { text: "Hello" },
});
```

## Extension and configuration notes

The helpers are a testing subpath only. Provider packages can use them with their own mocked fetch/transport or `createMockProvider()`. Live provider tests should stay opt-in and env-gated outside Prism's default test suite.

## Security and performance notes

- No credentials, env vars, OAuth tokens, filesystem discovery, provider SDKs, or network calls are required.
- Use fake credentials only in fixtures.
- The helpers collect one stream into memory; keep conformance fixtures small.
- Redaction remains the provider/runtime boundary's job. Use `assertNoSecretLeak()` with known fake secrets to catch regressions, not as a general secret scanner.

## Related APIs

- [Provider layer](provider-layer.md): `AIProvider`, provider events, and mock provider.
- [Provider packages](provider-packages.md): package authors can use conformance helpers for adapters.
- [OpenAI-compatible provider](providers/openai-compatible.md): optional provider adapter tested with mocked streams.
- [Public contracts](public-contracts.md): provider request/event/usage contracts.
