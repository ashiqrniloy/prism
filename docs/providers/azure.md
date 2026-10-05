# Azure OpenAI / Foundry

## What it does

`@arnilo/prism-provider-azure` registers an Azure OpenAI / Foundry Chat Completions provider that uses host-supplied Entra workload identity (Bearer) or Azure resource keys (`api-key`). Deployment URLs keep the configured endpoint host (custom subdomain, private endpoint, or VNet FQDN).

## When to use it

Use it for enterprise Azure OpenAI / Foundry deployments with Managed Identity or host token providers. Do not fold this into consumer OpenAI packages. Do not embed static keys in fixtures.

## Inputs / request

```ts
import azure from "@arnilo/prism-provider-azure";

// Default export: the package definition — call it, or pass the result to `packages: [...]`.
azure(options?: AzureProviderPackageOptions & AzureProviderConfig = {}): PackageInstance

// Named exports.
createAzureOpenAIProvider(options?: AzureOpenAIProviderOptions): ModelProvider
azureChatCompletionsUrl(config): string
azureEndpointFromConfig(config): string
```

| Config field | Type | Purpose |
| --- | --- | --- |
| `resourceName` | string | Azure OpenAI resource name; derives `https://<name>.openai.azure.com`. |
| `endpoint` | string | Full resource endpoint; must be https. Exactly one of `resourceName`/`endpoint`. |
| `deployment` | string | Deployment name; defaults to the request model id. |
| `apiVersion` | string | Azure API version; defaults to `2024-10-21`. |
| `credential` | secret ref | Resolved by the credentials slot; default `env:AZURE_OPENAI_API_KEY`. A literal value is rejected. |
| `authStyle` | `"bearer" \| "api-key"` | Entra bearer token (default) or Azure resource key. |
| `models` | `ModelConfig[]` | Static catalog; Azure deployments are host-defined. |

| Factory-only option | Type | Purpose |
| --- | --- | --- |
| `id` | string | Provider id; defaults to `azure`. |
| `fetch` | `typeof fetch` | Test seam: the transport every request uses. |

`models()` returns the configured `models` array when set, otherwise `[]` — Azure deployments are host-defined. Pass the ids you intend to use in config.

## Outputs / response / events

Reuses `@arnilo/prism/provider-kit` streaming events (text, tool deltas, usage, done, redacted errors). Missing credentials fail closed before `fetch`.

## Request/response example

```http
POST https://my-resource.privatelink.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21
Authorization: Bearer <entra-token>
```

## Implementation example

```ts
import { createAgent } from "@arnilo/prism";
import azure from "@arnilo/prism-provider-azure";

const agent = await createAgent({
  model: { provider: "azure", model: "gpt-5.1" },
  packages: [
    azure({
      resourceName: "my-resource",
      deployment: "gpt-5.1",
      credential: "env:AZURE_OPENAI_API_KEY",
    }),
  ],
});

const models = await agent.models.list(); // the configured catalog, no fetch
await agent.dispose();
```

Opt-in live canaries: inject real `fetch` + host credential behind host CI secrets — no secrets in repo.

## Extension and configuration notes

Register by listing the package in `createAgent({ packages: [azure({ ... })] })`. Pair with `@arnilo/prism-core/governance/model-router` for residency allow-lists on Azure regions/endpoints.

## Request construction (0.5.1)

Agent sessions stamp `sessionId`/`cacheKey` without a host policy. Session/cache keys are correlation ids, never secrets.

| | |
| --- | --- |
| P1 session wire | none |
| Mandatory | no |
| P2 default cache | host-owned, no Prism cache fields |

See [Provider request policies](../provider-request-policies.md).

## Security and performance notes

- No credential prefetch at import; the credential is resolved exactly once per request (a rotating `CredentialValueSource` is never consumed twice — the same resolved token drives the wrapper check and the inner auth header).
- Endpoint host is never rewritten to public DNS.
- Errors redact credential values via shared transport helpers.
- No Azure SDK dependency.
- Conformance-proven (Task 6): package `setup()` performs zero fetch and zero credential resolution; an already-aborted signal fails fast; a truncated SSE stream (no `data: [DONE]`) ends in an `error` event; Azure cache policy stays host-owned, so no cache wire fields (`cache_control`, `prompt_cache_*`) are emitted even when the request carries Prism cache hints — only upstream-reported `prompt_tokens_details.cached_tokens` maps to `Usage.cacheReadTokens`.

## Live probe

Opt-in smoke over your real Azure OpenAI resource:

```bash
PRISM_LIVE_PROVIDER_TESTS=1 AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com \
  AZURE_OPENAI_API_KEY=... PRISM_LIVE_AZURE_MODEL=<deployment-name> \
  bun test packages/providers/azure/src/__tests__/live.test.ts
```

The deployment name is the model knob (`AZURE_OPENAI_DEPLOYMENT` also works). Without any of these variables the suite skips — it never fails.

## Thinking and reasoning

Azure OpenAI deployments use the OpenAI-compatible wire: the provider forwards sanitized thinking compat (`reasoning_effort` with `effort`/`reasoningEffort` aliases, or a `reasoning` object with `effort` + preserved `summary`) via its body builder, snapping effort to the model's declared levels (gpt-5.1 → `none/low/medium/high`, ties up). Unrecognized compat keys are dropped. See [Thinking and reasoning](../thinking-and-reasoning.md).

## Related APIs

- [OpenAI-compatible provider](openai-compatible.md)
- [Provider packages](../provider-packages.md)
- [Model routing](../model-routing.md)
- [Credential storage](../credential-storage.md)
- Package README: [`@arnilo/prism-provider-azure`](../../packages/providers/azure/README.md)
