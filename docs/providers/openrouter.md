# OpenRouter provider package

## What it does

`@arnilo/prism-provider-openrouter` provides explicit, side-effect-free setup for the
OpenRouter API-key provider with app-controlled model catalog and per-model cache
policy/routing overrides.

The package registers a provider, caller-supplied model metadata, and an
`api_key` auth method through `createExtensionKernel().load([...])`. Apps control the model catalog instead of
accepting a fetched or hard-coded one.

## When to use it

Use it when a host app wants OpenRouter routing passthrough, reasoning controls,
and per-model cache policy through Prism's `AgentSession` runtime, and needs to
override cache behavior per model rather than accept a single hard-coded policy.

Do not use it for catalog fetches, automatic credential discovery, or
real-network tests.

## Inputs / request

```ts
import { createOpenRouterProviderPackage, defineOpenRouterModel } from "@arnilo/prism-provider-openrouter";

createOpenRouterProviderPackage(options: OpenRouterProviderPackageOptions): ProviderPackage
defineOpenRouterModel(config: OpenRouterModelConfig): OpenRouterModelConfig
```

| Field | Type | Purpose |
| --- | --- | --- |
| `apiKey` | `CredentialValueSource` | Direct/callback/resolver API-key source. |
| `fetch` | `typeof fetch` | Optional fetch implementation for tests/hosts. |
| `baseUrl` | `string` | Overrides the OpenRouter base URL. |
| `appUrl` | `string` | App URL for attribution `HTTP-Referer` header. |
| `appTitle` | `string` | App title for the `X-Title` attribution header. |
| `models` | `readonly ModelConfig[]` | App-supplied model catalog (no default fetch). |

`OpenRouterModelConfig.compat.openRouterRouting` controls routing order,
`data_collection`, reasoning, and per-model cache policy overrides.

## Outputs / response / events

| Surface | Behavior |
| --- | --- |
| Provider stream | Prism text, thinking, tool-call delta/final, `usage` (with cache read/write mapped), `done`, redacted `error`. |
| Attribution | `HTTP-Referer`/`X-Title` headers sent only when `appUrl`/`appTitle` are supplied. |
| Auth method | `api_key` for `openrouter`, credential name `apiKey`. |

## Request/response example

Per-model routing override:

```json
{
  "model": "anthropic/claude-sonnet-4",
  "routing": { "order": ["anthropic"], "data_collection": "deny" }
}
```

## Implementation example

```ts
import { createExtensionKernel } from "@arnilo/prism";
import { createOpenRouterProviderPackage, defineOpenRouterModel } from "@arnilo/prism-provider-openrouter";

const sonnet = defineOpenRouterModel({
  model: "anthropic/claude-sonnet-4",
  compat: { openRouterRouting: { order: ["anthropic"], data_collection: "deny" } },
});

const kernel = createExtensionKernel();
await kernel.load([
  createOpenRouterProviderPackage({ apiKey: "fake-openrouter-key", models: [sonnet] }),
]);
```

## Extension and configuration notes

- Apps supply the model catalog via `models`; no catalog is fetched during setup.
- `defineOpenRouterModel` lets apps override cache policy and routing per model.
- Hosts choose base URL, attribution, credential source, and `fetch` impl.
- Package contributes models and an `api_key` auth method.

## Security and performance notes

- No catalog fetch during setup; no automatic environment, file, keychain, or shell
  credential lookup.
- API keys are resolved per request from caller-supplied values or resolvers and
  redacted from errors.
- Attribution headers are sent only when `appUrl`/`appTitle` are supplied — no
  hidden app identity.
- Live tests stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1` plus fake-safe
  provider-specific env names; default tests are network-free.

## Related APIs

- [Provider packages](../provider-packages.md): `defineProviderPackage`,
  `ModelConfig`/`compat`, cache policy, request policies.
- [Credentials and redaction](../credentials-and-redaction.md):
  `resolveCredentialValue`, `redactSecrets`.
- [Provider layer](../provider-layer.md): `ProviderRequest.options` and usage
  mapping.
- [Provider conformance](../provider-conformance.md): network-free adapter tests.
