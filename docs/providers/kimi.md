# Kimi provider package

## What it does

`@arnilo/prism-provider-kimi` provides explicit, side-effect-free setup for Kimi For
Coding using an Anthropic-compatible `/messages` endpoint with
`User-Agent: KimiCLI/1.5` (unless overridden). Moonshot/Open Platform model
metadata is optional.

The package registers the `kimi-coding` provider, default Kimi Coding model
metadata, and an `api_key` auth method through `createExtensionKernel().load([...])`.

## When to use it

Use it when a host app wants the Kimi For Coding endpoint through Prism's
`AgentSession` runtime with Kimi-specific serializer behavior.

Do not use it for Moonshot Open Platform default registration, automatic
credential discovery, catalog fetches, or real-network tests.

## Inputs / request

```ts
import { createKimiProviderPackage } from "@arnilo/prism-provider-kimi";

createKimiProviderPackage(options: KimiProviderPackageOptions): ProviderPackage
defineKimiModel(config: KimiModelConfig): KimiModelConfig
```

| Field | Type | Purpose |
| --- | --- | --- |
| `kimiApiKey` | `CredentialValueSource` | Direct/callback/resolver API-key source for Kimi. |
| `fetch` | `typeof fetch` | Optional fetch implementation for tests/hosts. |
| `baseUrl` | `string` | Overrides the Kimi base URL. |
| `id` | `string` | Overrides the provider id (default `kimi-coding`). |
| `userAgent` | `string` | Overrides `User-Agent: KimiCLI/1.5`. |
| `models` | `readonly ModelConfig[]` | Overrides `kimiCodingModels` defaults. |
| `includeMoonshotModels` | `boolean` | Registers Moonshot models when `true` (default off). |
| `moonshotModels` | `readonly ModelConfig[]` | Overrides `moonshotKimiModels` when included. |

## Outputs / response / events

| Surface | Behavior |
| --- | --- |
| Provider stream | Prism text, thinking (preserved only when `model.compat.preserveThinking` is true, otherwise downgraded to text), tool-call delta/final, `usage`, `done`, redacted `error`. |
| Block preservation | Text, thinking, assistant `tool_call` → `tool_use`, `tool_result` → `tool_result`, images when `capabilities.input` includes `"image"`. |
| Auth method | `api_key` for `kimi-coding`, credential name `apiKey`. |

Unsupported block placements or unclaimed images fail before fetch.

## Request/response example

Example request (Anthropic-compatible `/messages` shape):

```json
{
  "model": "kimi-latest",
  "messages": [{ "role": "user", "content": "Hello" }],
  "stream": true
}
```

## Implementation example

```ts
import { createExtensionKernel } from "@arnilo/prism";
import { createKimiProviderPackage } from "@arnilo/prism-provider-kimi";

const kernel = createExtensionKernel();
await kernel.load([
  createKimiProviderPackage({ kimiApiKey: "fake-kimi-key", includeMoonshotModels: false }),
]);
```

Register Moonshot/Open Platform metadata explicitly:

```ts
import { createKimiProviderPackage } from "@arnilo/prism-provider-kimi";

await kernel.load([
  createKimiProviderPackage({ kimiApiKey: "fake", includeMoonshotModels: true }),
]);
```

## Extension and configuration notes

- Hosts choose base URL, provider id, `User-Agent`, model list, credential source,
  and `fetch` impl.
- Moonshot/Open Platform metadata is registered only with
  `includeMoonshotModels: true`; it is not core behavior.
- Package contributes models via the extension `api` and an `api_key` auth method.

## Security and performance notes

- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- Kimi credentials are resolved per request from caller-supplied values or resolvers
  and redacted from errors.
- Live tests stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1` plus fake-safe
  provider-specific env names; default tests are network-free.

## Related APIs

- [Provider packages](../provider-packages.md): `defineProviderPackage`,
  `ModelConfig`/`compat`, Anthropic-compatible routes.
- [Credentials and redaction](../credentials-and-redaction.md):
  `resolveCredentialValue`, `redactSecrets`.
- [Provider layer](../provider-layer.md): `ProviderRequest.options` and usage
  mapping.
- [Provider conformance](../provider-conformance.md): network-free adapter tests.
