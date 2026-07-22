# Google provider package

## What it does

`@arnilo/prism-provider-google` is the first-party Gemini `generateContent` / `streamGenerateContent` provider for Prism (`POST /v1beta/models/{model}:streamGenerateContent?alt=sse`). Setup is side-effect-free: no network, env scan, or keychain lookup during import/setup. Uses native `fetch` + SSE — no `@google/genai` runtime dependency.

## When to use it

Use for first-party Gemini Developer API coding-host semantics (function calling, multimodal `inlineData`, thinking, usage, abort). Prefer this over the AI SDK escape hatch when Gemini is a primary host.

Do **not** use for Vertex enterprise identity (deferred to 0.0.13+), as a substitute for Anthropic Messages, or Gemini CLI OAuth/credential-file/token import. This package is API-key-only.

## Inputs / request

```ts
import {
  createGoogleProviderPackage,
  createGoogleGenerateContentProvider,
  listGoogleModels,
  defineGoogleModel,
} from "@arnilo/prism-provider-google";

createGoogleProviderPackage(options?: GoogleProviderPackageOptions): ProviderPackage
createGoogleGenerateContentProvider(options?): AIProvider
listGoogleModels(options?: ListGoogleModelsOptions): Promise<ModelConfig[]>
```

| Field | Type | Purpose |
| --- | --- | --- |
| `apiKey` | `CredentialValueSource` | Host-owned Google/Gemini API key (late-bound). |
| `fetch` | `typeof fetch` | Optional fetch for tests/hosts. |
| `baseUrl` | `string` | Override default Gemini REST base. |
| `id` | `string` | Provider id (default `google`). |
| `userAgent` | `string` | Optional User-Agent. |
| `models` | `readonly ModelConfig[]` | Override featured offline models. |

Featured offline aliases include `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, and `gemini-3.5-flash` (see package README for the live curated list). Caller-gated discovery: `listGoogleModels()` — never during setup. Model ids may arrive prefixed with `models/`; Prism strips the prefix.

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
import { createGoogleProviderPackage, listGoogleModels } from "@arnilo/prism-provider-google";

api.registerProviderPackage(createGoogleProviderPackage({ apiKey: hostKey }));

const models = await listGoogleModels({ apiKey: hostKey });
api.registerProviderPackage(createGoogleProviderPackage({ apiKey: hostKey, models }));
```

## Extension and configuration notes

- Register via `defineProviderPackage` / host registries; no package auto-discovery.
- AI SDK remains an escape hatch, not the primary Google path.
- Live smoke: `PRISM_LIVE_PROVIDER_TESTS=1` + `GOOGLE_API_KEY` or `GEMINI_API_KEY`.
- Vertex / enterprise identity stays out of 0.0.11.
- Gemini CLI says third-party software accessing its backend through Gemini CLI OAuth violates applicable terms, and its FAQ directs third-party coding agents to Vertex AI or Google AI Studio API keys ([terms](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md), [FAQ](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/faq.md)). Prism therefore has no Gemini CLI OAuth API or token-import shortcut.

## Security and performance notes

- No network during import/setup/default tests; credentials host-owned and late-bound.
- Provider-owned auth headers cannot be overridden by caller headers.
- Media bounds reuse shared provider media helpers; tool args arrive complete per chunk (no partial JSON reconstruction required).
- Offline conformance: `@arnilo/prism/testing/provider-conformance`.

## Related APIs

- [Provider packages](../provider-packages.md): package setup + discovery contract.
- [Thinking and reasoning](../thinking-and-reasoning.md): portable thinking helpers.
- [Provider conformance](../provider-conformance.md): network-free assertions.
- Package README: [`packages/provider-google/README.md`](../../packages/provider-google/README.md)
