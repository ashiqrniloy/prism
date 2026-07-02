# OpenCode Go provider package

## What it does

`@arnilo/prism-provider-opencode-go` provides explicit, side-effect-free setup for the
OpenCode Go API-key provider using Prism model metadata and
OpenAI-compatible/Anthropic-compatible routes with `x-opencode-session`
cache/session headers.

The package registers a provider, default model metadata, and an `api_key` auth
method through `createExtensionKernel().load([...])`.

## When to use it

Use it when a host app wants to run an OpenAI-compatible or Anthropic-compatible
OpenCode Go endpoint through Prism's `AgentSession` runtime with per-request
session/cache headers.

Do not use it for automatic credential discovery, catalog fetches, or
real-network tests.

## Inputs / request

```ts
import { createOpenCodeGoProviderPackage } from "@arnilo/prism-provider-opencode-go";

createOpenCodeGoProviderPackage(options: OpenCodeGoProviderPackageOptions): ProviderPackage
```

| Field | Type | Purpose |
| --- | --- | --- |
| `apiKey` | `CredentialValueSource` | Direct/callback/resolver API-key source. |
| `fetch` | `typeof fetch` | Optional fetch implementation for tests/hosts. |
| `baseUrl` | `string` | Overrides the OpenCode Go base URL. |
| `models` | `readonly ModelConfig[]` | Overrides `openCodeGoModels` defaults. |

`ProviderRequest.options.cacheKey` (falling back to `sessionId`) maps to the
`x-opencode-session` header; the Anthropic-compatible route accepts
`cache_control` breakpoints; `cacheRetention` maps to cache retention.

## Outputs / response / events

| Surface | Behavior |
| --- | --- |
| Provider stream | Prism text, thinking, tool-call delta/final, `usage`, `done`, redacted `error`. |
| Session/cache | `x-opencode-session` and cache headers added before `generate()`. |
| Auth method | `api_key` for `opencode-go`, credential name `apiKey`. |

## Request/response example

Example headers added before fetch:

```json
{
  "Authorization": "Bearer <resolved-key>",
  "x-opencode-session": "<ProviderRequest.options.cacheKey ?? sessionId>"
}
```

## Implementation example

```ts
import { createExtensionKernel } from "@arnilo/prism";
import { createOpenCodeGoProviderPackage } from "@arnilo/prism-provider-opencode-go";

const kernel = createExtensionKernel();
await kernel.load([createOpenCodeGoProviderPackage({ apiKey: "fake-opencode-key" })]);
```

Override model metadata:

```ts
import { createOpenCodeGoProviderPackage, openCodeGoModels } from "@arnilo/prism-provider-opencode-go";

await kernel.load([
  createOpenCodeGoProviderPackage({ apiKey: "fake", models: openCodeGoModels }),
]);
```

## Extension and configuration notes

- Hosts choose base URL, model list, credential source, and `fetch` impl.
- The serializer is inherited from the OpenAI-compatible route; Anthropic-compatible
  routes preserve `tool_use`/`tool_result` blocks.
- Package contributes models via the extension `api` and an `api_key` auth method.

### Cache and session behavior

- `x-opencode-session` is derived from `ProviderRequestOptions.cacheKey` (falling
  back to `sessionId`) and sanitized + clamped to 128 characters via the shared
  `sanitizeCacheKey()` helper. Session ids route/stick requests and identify
  conversations; never credentials or raw prompts.
- The Anthropic-compatible route (`compat.route: "anthropic"`) applies
  Anthropic-style `cache_control: { type: "ephemeral" }` markers only to the
  caller-selected `ProviderRequestOptions.cache.breakpoints` (resolved with the
  shared `applyCacheControl()` helper) on the last content block of each selected
  message — not to every block. Caching is enabled unless disabled
  (`cacheRetention: "none"` / `cache.mode: "off"`) and the model opts in via
  `ModelConfig.cache.kind: "cache_control"` (or `cache.mode: "on"`).
- `cacheRetention: "long"` emits `cache_control: { type: "ephemeral", ttl: "1h" }`
  markers when the model allows long retention
  (`ModelConfig.cache.longRetention !== false`); otherwise the default ephemeral
  window applies.
- The OpenAI-compatible chat route (`compat.route: "openai"`, the default) sends
  no Anthropic `cache_control` fields; it relies on OpenAI-style implicit caching.
- Usage accounting is preserved per route: the OpenAI route maps
  `prompt_tokens_details.cached_tokens`/`cache_write_tokens` to
  `Usage.cacheReadTokens`/`cacheWriteTokens`; the Anthropic route maps
  `cache_read_input_tokens`/`cache_creation_input_tokens`.

## Security and performance notes

- No network calls during import, setup, build, or default tests.
- No automatic environment, file, keychain, or shell credential lookup.
- API keys are resolved per request from caller-supplied values or resolvers and
  redacted from errors.
- Caller-supplied `ProviderRequest.options.headers` can add non-owned headers, but
  provider-owned headers (`content-type`, `x-opencode-session`, `authorization`)
  are applied last and cannot be overridden by caller headers.
- Live tests stay opt-in behind `PRISM_LIVE_PROVIDER_TESTS=1` plus fake-safe
  provider-specific env names; default tests are network-free.

## Related APIs

- [Provider packages](../provider-packages.md): `defineProviderPackage`,
  `ModelConfig`, request/cache policies.
- [Credentials and redaction](../credentials-and-redaction.md):
  `resolveCredentialValue`, `redactSecrets`.
- [OpenAI-compatible provider](openai-compatible.md): underlying Chat Completions
  adapter.
- [Provider conformance](../provider-conformance.md): network-free adapter tests.
