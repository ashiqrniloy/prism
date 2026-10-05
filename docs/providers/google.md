# Google provider package

## What it does

`@arnilo/prism-provider-google` is the first-party Gemini `generateContent` / `streamGenerateContent` provider for Prism (`POST /v1beta/models/{model}:streamGenerateContent?alt=sse`). Setup is side-effect-free: no network, env scan, or keychain lookup during import/setup. Uses native `fetch` + SSE — no `@google/genai` runtime dependency.

## When to use it

Use for first-party Gemini Developer API coding-host semantics (function calling, multimodal `inlineData`, thinking, usage, abort). Prefer this over the AI SDK escape hatch when Gemini is a primary host.

Do **not** use for Vertex enterprise identity (deferred to 0.0.13+), as a substitute for Anthropic Messages, or Gemini CLI OAuth/credential-file/token import. This package is API-key-only.

## Inputs / request

```ts
import google from "@arnilo/prism-provider-google";

// Default export: the package definition — call it, or pass the result to `packages: [...]`.
google(options?: GoogleProviderPackageOptions & GoogleProviderConfig = {}): PackageInstance

// Named exports.
createGoogleGenerateContentProvider(options?: GoogleGenerateContentProviderOptions): ModelProvider
listGoogleModels(options?: ListGoogleModelsOptions): Promise<ModelConfig[]>
defineGoogleModel(config: GoogleModelConfig): ModelConfig
createGoogleModelDiscovery(options): ModelDiscovery
```

| Config field | Type | Purpose |
| --- | --- | --- |
| `apiKey` | secret ref | Resolved by the credentials slot; default `env:GEMINI_API_KEY`. A literal value is rejected. |
| `baseUrl` | string | Gemini API base; defaults to `https://generativelanguage.googleapis.com/v1beta`. |
| `models` | `ModelConfig[]` | Static catalog; when absent, `models()` asks the vendor's `/models` endpoint. |

| Factory-only option | Type | Purpose |
| --- | --- | --- |
| `id` | string | Provider id; defaults to `google`. |
| `fetch` | `typeof fetch` | Test seam: the transport every request uses. |
| `userAgent` | string | Sent as `user-agent` on every request (provider-owned). |

Featured offline aliases include `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, and `gemini-3.5-flash` (see the package README for the live curated list). Model ids may arrive prefixed with `models/`; Prism strips the prefix. `models()` returns the configured `models` array when set; otherwise it calls `listGoogleModels()` (`GET {baseUrl}/models`) — only when `agent.models.list()` runs, never during setup.

## Outputs / response / events

| Surface | Behavior |
| --- | --- |
| Stream | Prism text, thinking when present, **complete** `tool_call` events (Gemini does not stream argument deltas), usage, `done`, redacted `error`. |
| Cache | No Anthropic-style `cache_control`; Gemini implicit caching is not exposed as Prism breakpoints in 0.0.11. |
| Multimodal | `inlineData` parts with MIME + base64; capability checks fail closed for unsupported modalities. |
| Auth | `api_key`; provider-owned `content-type` + `x-goog-api-key` win over caller headers. No OAuth descriptor or Gemini CLI subscription adapter is registered. |

## Request/response example

```json
{
  "contents": [{ "role": "user", "parts": [{ "text": "Hello" }] }],
  "tools": [{ "functionDeclarations": [{ "name": "lookup", "parameters": { "type": "object" } }] }]
}
```

## Implementation example

```ts
import { createAgent } from "@arnilo/prism";
import google from "@arnilo/prism-provider-google";

const agent = await createAgent({
  model: { provider: "google", model: "gemini-2.5-pro" },
  packages: [google({ apiKey: "env:GEMINI_API_KEY" })],
});

const models = await agent.models.list(); // discovery runs only here
await agent.dispose();
```

## Extension and configuration notes

- Register by listing the package in `createAgent({ packages: [...] })`; there is no auto-discovery.
- The package formerly exported `createGoogleProviderPackage`; that helper is retired — the package now ships the default package export plus the `google(...)` factory.
- AI SDK remains an escape hatch, not the primary Google path.
- Live smoke: `PRISM_LIVE_PROVIDER_TESTS=1` + `GOOGLE_API_KEY` or `GEMINI_API_KEY`.
- Vertex / enterprise identity stays out of 0.0.11.
- Gemini CLI says third-party software accessing its backend through Gemini CLI OAuth violates applicable terms, and its FAQ directs third-party coding agents to Vertex AI or Google AI Studio API keys ([terms](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md), [FAQ](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/faq.md)). Prism therefore has no Gemini CLI OAuth API or token-import shortcut.

## Request construction (0.5.1)

Agent sessions stamp `sessionId`/`cacheKey` without a host policy. Session/cache keys are correlation ids, never secrets.

| | |
| --- | --- |
| P1 session wire | `x-client-request-id` from `sessionId` |
| Mandatory | no |
| P2 default cache | none (no Prism cache markers) |

See [Provider request policies](../provider-request-policies.md).

## Security and performance notes

- No network during import/setup/default tests; credentials host-owned and late-bound.
- Provider-owned auth headers cannot be overridden by caller headers.
- Media bounds reuse shared provider media helpers; tool args arrive complete per chunk (no partial JSON reconstruction required).
- Offline conformance: `@arnilo/prism/provider-kit`.

## Thinking and reasoning

Google models route through the `google` family: the adapter merges `compat.thinkingLevel` and the provider emits `generationConfig.thinkingConfig`. Gemini 3.x models use `thinkingLevel` with declared per-model sets: 3.6/3.5-flash and 3-flash-preview accept `minimal`–`high`; 3.1-pro accepts `low/medium/high` (default `high`); 3-pro accepts `low/high`. Gemini 2.5 models are budget-only (`compat.thinkingBudgetRange`): 2.5-pro `128–32768` (cannot disable), 2.5-flash/flash-lite `0–24576` (`0` disables). `none` on a budget-only model maps to the range minimum (`thinkingBudget: 0` where disabling is supported, `128` where not); non-none levels are dropped on budget-only models. Declared level sets snap via nearest-declared (ties up), so `none`/`minimal` on 3.1-pro snap up to `low`. See [Thinking and reasoning](../thinking-and-reasoning.md).

## Related APIs

- [Google Vertex AI](vertex.md): enterprise ADC/workload-identity package (separate from this consumer API-key package).
- [Provider packages](../provider-packages.md): package setup + discovery contract.
- [Thinking and reasoning](../thinking-and-reasoning.md): portable thinking helpers.
- [Provider conformance](../provider-conformance.md): network-free assertions.
- Package README: [`@arnilo/prism-provider-google`](../../packages/providers/google/README.md)
