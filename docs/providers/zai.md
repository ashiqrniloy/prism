# ZAI provider package

## What it does

`@arnilo/prism-provider-zai` provides explicit, side-effect-free setup for the ZAI GLM
API-key provider using Prism's OpenAI-compatible route with the
`thinkingFormat: "zai"` model-compat setting, developer-role fallback, and
GLM tool-stream quirks.

The package registers a provider, default model metadata, and an `api_key` auth
method through `createExtensionKernel().load([...])`.

## When to use it

Use it when a host app wants to run the ZAI GLM endpoint through Prism's
`AgentSession` runtime with ZAI-specific thinking/tool-stream handling.

Do not use it for automatic credential discovery, catalog fetches, or
real-network tests.

## Inputs / request

```ts
import { createZaiProviderPackage } from "@arnilo/prism-provider-zai";

createZaiProviderPackage(options: ZaiProviderPackageOptions): ProviderPackage
defineZaiModel(config: ZaiModelConfig): ZaiModelConfig
```

| Field | Type | Purpose |
| --- | --- | --- |
| `apiKey` | `CredentialValueSource` | Direct/callback/resolver API-key source. |
| `fetch` | `typeof fetch` | Optional fetch implementation for tests/hosts. |
| `baseUrl` | `string` | Overrides the ZAI base URL. |
| `id` | `string` | Overrides the provider id (default `zai`). |
| `models` | `readonly ModelConfig[]` | Overrides `zaiModels` defaults. |

`ModelConfig.compat.thinkingFormat: "zai"` enables ZAI thinking handling;
`developerRoleFallback` controls developer-role fallback.

## Outputs / response / events

| Surface | Behavior |
| --- | --- |
| Provider stream | Prism text, thinking (preserved only when `model.compat.preserveThinking` is true, otherwise downgraded to text), tool-call delta/final, `usage`, `done`, redacted `error`. |
| Block preservation | Text, thinking, assistant `tool_call` → `tool_calls`, `tool_result` → role `tool` messages, images when `capabilities.input` includes `"image"`. |
| Auth method | `api_key` for the configured provider id, credential name `apiKey`. |

Unsupported block placements or unclaimed images fail before fetch.

## Request/response example

Example request body (OpenAI-compatible Chat Completions shape):

```json
{
  "model": "glm-4.6",
  "messages": [{ "role": "user", "content": "Hello" }],
  "stream": true
}
```

## Implementation example

```ts
import { createExtensionKernel } from "@arnilo/prism";
import { createZaiProviderPackage } from "@arnilo/prism-provider-zai";

const kernel = createExtensionKernel();
await kernel.load([createZaiProviderPackage({ apiKey: "fake-zai-key" })]);
```

Override the provider id and models:

```ts
import { createZaiProviderPackage, defineZaiModel, zaiModels } from "@arnilo/prism-provider-zai";

await kernel.load([
  createZaiProviderPackage({ id: "zai", apiKey: "fake", models: zaiModels }),
]);
```

## Extension and configuration notes

- Hosts choose base URL, provider id, model list, credential source, and `fetch`
  impl.
- `defineZaiModel` lets apps set ZAI-specific `compat` (thinking format, developer
  fallback).
- Package contributes models via the extension `api` and an `api_key` auth method.

## Security and performance notes

- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- API keys are resolved per request from caller-supplied values or resolvers and
  redacted from errors.
- Live tests stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1` plus fake-safe
  provider-specific env names; default tests are network-free.

## Related APIs

- [Provider packages](../provider-packages.md): `defineProviderPackage`,
  `ModelConfig`/`compat`, thinking formats.
- [Credentials and redaction](../credentials-and-redaction.md):
  `resolveCredentialValue`, `redactSecrets`.
- [OpenAI-compatible provider](openai-compatible.md): underlying Chat Completions
  adapter.
- [Provider conformance](../provider-conformance.md): network-free adapter tests.
