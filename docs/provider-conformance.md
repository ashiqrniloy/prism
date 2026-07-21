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
- `assertProviderOwnedHeadersWin(captured, options)`
- `assertNoSecretLeak(events, secrets)`

## When to use it

Use these helpers in provider package tests to check event order, terminal events, abort propagation via `ProviderRequest.signal`, streamed tool-call deltas, usage/cache accounting, request body content preservation, protected header ownership, and secret redaction. Do not treat deprecated `ProviderRequestOptions.timeoutMs`/`maxRetries`/`maxRetryDelayMs` as conformance requirements; first-party providers use runtime abort signals and `AgentConfig.retry`/`RunOptions.retry` instead.

Do not use them as a live integration runner, provider simulator, retry framework, credential loader, or test framework replacement.

For real network smoke tests, each first-party provider package ships an env-gated `src/__tests__/live.test.ts` that exercises the live API when `PRISM_LIVE_PROVIDER_TESTS=1` and a provider-specific API key are set. These live tests reuse the same conformance helpers (`assertProviderStreamConforms`, `assertAbortIsObserved`, `assertNoSecretLeak`) against the real provider, so offline and live assertions stay consistent. The default `npm test` never sets these gates and stays network-free; see [Release and install](release-and-install.md) for the full env-var list.

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
- `assertAbortIsObserved()` passes an already-aborted signal and expects provider generation to reject. This is the supported timeout primitive; use a host abort controller or `RunOptions.signal` rather than deprecated provider-level `timeoutMs`.
- `assertToolCallDeltasReconstruct()` rebuilds streamed `tool_call_delta` fragments into tool calls and validates expected id/name/arguments. Malformed JSON with id+name present yields `argumentsError` (no throw); missing id/name throws typed `incomplete_delta`. The runtime uses the same reconstruction before tool execution when a provider streams deltas.
- `assertUsageAccounting()` finds `usage` or `done.usage` and checks selected token fields including `cacheReadTokens` and `cacheWriteTokens`. This is the provider-neutral check for normalized cache read/write token extraction; every first-party provider package exercises it against server-specific fields (`cached_tokens`, `cache_read_input_tokens`, etc.).
- `assertSerializedRequestCoversContent()` scans a serialized provider request body for primitive canaries from each Prism content block and fails if any supported block type is silently dropped. Provider-valid transcripts place assistant `tool_call` messages before matching role `tool` `tool_result` messages; runtime, cache-aware input layout, and observational-memory worker loops preserve that order before serialization.
- `assertProviderOwnedHeadersWin()` compares captured request headers against the provider's authoritative owned header values and a caller-supplied header bag; it fails if any owned header (`authorization`, `content-type`, session/security headers) was overridden by caller headers, and also fails if a non-owned caller header was dropped. This is the provider-neutral check that caller `ProviderRequest.options.headers` cannot hijack provider credentials or sessions; every first-party provider package exercises it.
- `assertNoSecretLeak()` stringifies all collected events and fails if any known secret string is present.

## Request/response example

```json
{
  "events": ["content_delta", "usage", "done"],
  "usage": { "inputTokens": 10, "cacheReadTokens": 4, "cacheWriteTokens": 2 }
}
```

Tool-call delta reconstruction example:

```ts
import { assertToolCallDeltasReconstruct } from "@arnilo/prism/testing/provider-conformance";

assertToolCallDeltasReconstruct([
  { type: "tool_call_delta", index: 0, id: "call_1", name: "lookup", argumentsText: "{\"q\":" },
  { type: "tool_call_delta", index: 0, argumentsText: "\"prism\"}" },
  { type: "done" },
], [{ index: 0, id: "call_1", name: "lookup", arguments: { q: "prism" } }]);
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

Multimodal coverage example:

```ts
const request = {
  model: { provider: "openai", model: "gpt-5.1", capabilities: { input: ["text", "file", "document", "audio"] } },
  messages: [{ role: "user", content: [
    { type: "file", mediaType: "application/pdf", name: "report.pdf", data: "..." },
    { type: "audio", mediaType: "audio/wav", data: "..." },
  ] }],
};

assertSerializedRequestCoversContent(request, body);
```

Pass `unsupported` only for modalities the provider deliberately omits from the wire format while still accepting the turn via another block type.

Protected header-ownership example:

```ts
import { assertProviderOwnedHeadersWin } from "@arnilo/prism/testing/provider-conformance";

assertProviderOwnedHeadersWin(capturedHeaders, {
  owned: { authorization: "Bearer provider-key", "content-type": "application/json" },
  caller: { authorization: "Bearer attacker", "content-type": "text/plain", "x-caller": "kept" },
});
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

## Model discovery checklist

Every first-party package that ships (or plans) a `list*Models()` helper must keep setup network-free. Add these assertions in the package suite (pattern from NeuralWatt):

1. **`*_provider_setup_does_not_call_model_discovery`** — inject a counting `fetch` into `create*ProviderPackage({ fetch })`, run `setup`, assert `calls === 0`.
2. **`list_*_models_maps_fixture_…`** — fixture response maps to `ModelConfig` (`id` → `model`, documented capabilities/limits/cost/cache); no credentials in returned objects.
3. **`list_*_models_forwards_auth_abort_baseurl`** (as applicable) — Authorization owned by helper when key present; auth omitted when optional and unset; `signal` / `baseUrl` forwarded.
4. **`list_*_models_redacts_token_in_errors`** — non-OK bodies use `readBoundedResponseText` + `redactSecrets`; secret canaries absent from thrown messages.
5. **Malformed payload rejects** — missing `data` array (or provider-equivalent) throws a clear discovery error.

OpenRouter stays app-registration-first: an optional list helper must still not run during setup. AI SDK has no discovery export. Packages without a public list API document curated official-doc refresh instead of inventing a fake helper.

Canonical contract: [Provider packages — Caller-gated model discovery](provider-packages.md#caller-gated-model-discovery).

## Thinking / reasoning checklist

Every first-party package that exposes thinking or reasoning controls should cover:

1. **Model default** — `ModelConfig.compat` (or documented capability) sets the official wire field when no per-turn override is present.
2. **Per-turn override wins** — `ProviderRequestOptions.compat` via `mergeProviderRequestOptions` / `applyThinkingLevel` overrides the model default.
3. **Shared family mapping** — effort levels from `ThinkingLevel` land in the package's recommended family (`openai_reasoning` / `reasoning_effort` / `thinking_type` / `noop`) per [Thinking and reasoning](thinking-and-reasoning.md).
4. **Non-reasoning / noop** — applying a level with `noop` (or omitting compat) must not invent unsupported body fields.
5. **No inert `extra.thinkingLevel`** — package code must not rely on `options.extra.thinkingLevel` for wire mapping.

Canonical contract: [Thinking and reasoning](thinking-and-reasoning.md).

## AI SDK adapter checklist

`@arnilo/prism-provider-ai-sdk` is a host-owned `LanguageModelV4` bridge. It does not participate in the discovery or thinking/reasoning checklists above. Cover instead:

1. **No catalog / no setup fetch** — package exports no `list*Models()`; `createAiSdkProvider` wraps a host model only.
2. **Specification gate** — rejects non-v4 models (`specificationVersion !== "v4"` or missing `doStream`).
3. **Cache usage mapping** — `finish.usage.inputTokens.cacheRead`/`cacheWrite` map to `Usage.cacheReadTokens`/`cacheWriteTokens`; adapter does not emit cache request fields.
4. **Reasoning stream mapping** — `reasoning-delta` → thinking deltas; assistant `thinking` blocks replay as AI SDK `reasoning` prompt parts.
5. **Host-owned controls** — `options.compat` / `options.extra` forward as `providerOptions.prism`; reasoning effort stays on the host model.

Canonical contract: [AI SDK provider adapter](providers/ai-sdk.md).

## Extension and configuration notes

The helpers are a testing subpath only. Provider packages can use them with their own mocked fetch/transport or `createMockProvider()`. Live provider tests should stay opt-in and env-gated outside Prism's default test suite.

## Security and performance notes

- No credentials, env vars, OAuth tokens, filesystem discovery, provider SDKs, or network calls are required.
- Use fake credentials only in fixtures.
- The helpers collect one stream into memory; keep conformance fixtures small.
- Redaction remains the provider/runtime boundary's job. Use `assertNoSecretLeak()` with known fake secrets to catch regressions, not as a general secret scanner.
- First-party providers read SSE streams and HTTP error bodies through bounded helpers from `@arnilo/prism/providers/transport` (`readSseEvents` / `readSseData`, `readBoundedResponseText`). Oversized remote input terminates with `ProviderTransportError` instead of unbounded buffering.

## Related APIs

- [Provider layer](provider-layer.md): `AIProvider`, provider events, and mock provider.
- [Provider packages](provider-packages.md): package authors can use conformance helpers for adapters; includes the caller-gated discovery contract and setup zero-fetch rule.
- [AI SDK provider adapter](providers/ai-sdk.md): optional `LanguageModelV4` bridge tested with a fake AI SDK model.
- [OpenAI-compatible provider](providers/openai-compatible.md): optional provider adapter tested with mocked streams.
- [Public contracts](public-contracts.md): provider request/event/usage contracts.
