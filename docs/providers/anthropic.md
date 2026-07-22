# Anthropic provider package

## What it does

`@arnilo/prism-provider-anthropic` is the first-party Anthropic Messages provider for Prism (`POST /v1/messages`). Setup is side-effect-free: no network, env scan, or keychain lookup during import/setup. Wire format is package-local (OpenCode Go / Kimi Anthropic routes are pattern-only, not a shared core serializer).

## When to use it

Use for native Claude Messages (tools, `cache_control`, thinking/reasoning, media, usage, abort). Prefer this over the AI SDK escape hatch when Anthropic is a primary coding host.

Do **not** use for OpenCode Go Anthropic *route* hosting (`@arnilo/prism-provider-opencode-go`) or automatic credential discovery.

## Inputs / request

```ts
import {
  createAnthropicProviderPackage,
  createAnthropicMessagesProvider,
  listAnthropicModels,
  defineAnthropicModel,
} from "@arnilo/prism-provider-anthropic";

createAnthropicProviderPackage(options?: AnthropicProviderPackageOptions): ProviderPackage
createAnthropicMessagesProvider(options?): AIProvider
listAnthropicModels(options?: ListAnthropicModelsOptions): Promise<ModelConfig[]>
```

| Field | Type | Purpose |
| --- | --- | --- |
| `apiKey` | `CredentialValueSource` | Host-owned Anthropic API key (late-bound). |
| `fetch` | `typeof fetch` | Optional fetch for tests/hosts. |
| `baseUrl` | `string` | Override default `https://api.anthropic.com`. |
| `id` | `string` | Provider id (default `anthropic`). |
| `userAgent` | `string` | Optional User-Agent. |
| `models` | `readonly ModelConfig[]` | Override featured offline models. |

Featured offline aliases: `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`, `claude-fable-5`. Caller-gated discovery: `listAnthropicModels()` — never during setup.

## Outputs / response / events

| Surface | Behavior |
| --- | --- |
| Stream | Prism text, thinking deltas, tool-call delta/final, usage (incl. cache read/create when present), `done`, redacted `error`. |
| Cache | Featured models use `cache.kind: "cache_control"`; markers on selected breakpoints (`long` → `ttl: "1h"`). |
| Thinking | Model-family aware (`adaptive` vs `enabled`+`budget_tokens`); helpers `anthropicThinking` / `anthropicEffort` / `anthropicPreserveThinking`. |
| Auth | `api_key` for provider id; provider-owned `content-type`, `x-api-key`, `anthropic-version` win over caller headers. |

## Request/response example

```json
{
  "model": "claude-sonnet-5",
  "messages": [{ "role": "user", "content": [{ "type": "text", "text": "Hello" }] }],
  "stream": true,
  "max_tokens": 1024
}
```

## Implementation example

```ts
import { createProviderRegistry, createModelRegistry } from "@arnilo/prism";
import { createAnthropicProviderPackage, listAnthropicModels } from "@arnilo/prism-provider-anthropic";

const api = /* ExtensionAPI or host registries */;
api.registerProviderPackage(createAnthropicProviderPackage({ apiKey: hostKey }));

// Optional: caller-gated catalog refresh
const models = await listAnthropicModels({ apiKey: hostKey });
api.registerProviderPackage(createAnthropicProviderPackage({ apiKey: hostKey, models }));
```

## Extension and configuration notes

- Register via `defineProviderPackage` / host registries; no package auto-discovery.
- AI SDK (`@arnilo/prism-provider-ai-sdk`) remains an escape hatch, not the primary Anthropic path.
- Live smoke: `PRISM_LIVE_PROVIDER_TESTS=1` + `ANTHROPIC_API_KEY`.

## Security and performance notes

- No network during import/setup/default tests; credentials host-owned and late-bound.
- Provider-owned auth headers cannot be overridden by caller headers.
- Media/SSRF bounds reuse `@arnilo/prism/providers/media` / transport helpers.
- Offline conformance: `@arnilo/prism/testing/provider-conformance`.

## Related APIs

- [Provider packages](../provider-packages.md): package setup + discovery contract.
- [Provider caching](../provider-caching.md): `cache_control` breakpoints.
- [Thinking and reasoning](../thinking-and-reasoning.md): portable thinking helpers.
- [Provider conformance](../provider-conformance.md): network-free assertions.
- Package README: [`packages/provider-anthropic/README.md`](../../packages/provider-anthropic/README.md)
