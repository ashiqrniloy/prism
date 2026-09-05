# Azure OpenAI / Foundry

## What it does

`@arnilo/prism-providers/azure` registers an Azure OpenAI / Foundry Chat Completions provider that uses host-supplied Entra workload identity (Bearer) or Azure resource keys (`api-key`). Deployment URLs keep the configured endpoint host (custom subdomain, private endpoint, or VNet FQDN).

## When to use it

Use it for enterprise Azure OpenAI / Foundry deployments with Managed Identity or host token providers. Do not fold this into consumer OpenAI packages. Do not embed static keys in fixtures.

## Inputs / request

```ts
import { createAzureOpenAIProviderPackage } from "@arnilo/prism-providers/azure";

createAzureOpenAIProviderPackage({
  endpoint: "https://my-resource.openai.azure.com",
  deployment: "gpt-4o",
  apiVersion: "2024-10-21",
  credential: hostEntraToken, // late-bound
  authStyle: "bearer",
  models: [{ provider: "azure", model: "gpt-4o" }],
});
```

| Field | Meaning |
| --- | --- |
| `endpoint` | Absolute https resource URL; host preserved |
| `deployment` | Deployment name (defaults to `model.model`) |
| `apiVersion` | Query `api-version` (default `2024-10-21`) |
| `credential` | `CredentialValueSource` — Entra token or resource key |
| `authStyle` | `bearer` (default) or `api-key` |

## Outputs / response / events

Reuses `@arnilo/prism/providers/openai-compatible` streaming events (text, tool deltas, usage, done, redacted errors). Missing credentials fail closed before `fetch`.

## Request/response example

```http
POST https://my-resource.privatelink.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21
Authorization: Bearer <entra-token>
```

## Implementation example

```ts
const provider = createAzureOpenAIProvider({
  endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
  deployment: "gpt-4o",
  credential: () => entra.getToken("https://cognitiveservices.azure.com/.default").then((t) => t.token),
});
```

Opt-in live canaries: inject real `fetch` + host credential behind host CI secrets — no secrets in repo.

## Extension and configuration notes

Register via `createExtensionKernel().load([createAzureOpenAIProviderPackage(...)])`. Pair with `@arnilo/prism-core/governance/model-router` for residency allow-lists on Azure regions/endpoints.

## Security and performance notes

- No credential prefetch at import; the credential is resolved exactly once per request (a rotating `CredentialValueSource` is never consumed twice — the same resolved token drives the wrapper check and the inner auth header).
- Endpoint host is never rewritten to public DNS.
- Errors redact credential values via shared transport helpers.
- No Azure SDK dependency.
- Conformance-proven (Task 6): package `setup()` performs zero fetch and zero credential resolution; an already-aborted signal fails fast; a truncated SSE stream (no `data: [DONE]`) ends in an `error` event; Azure cache policy stays host-owned, so no cache wire fields (`cache_control`, `prompt_cache_*`) are emitted even when the request carries Prism cache hints — only upstream-reported `prompt_tokens_details.cached_tokens` maps to `Usage.cacheReadTokens`.

## Related APIs

- [OpenAI-compatible provider](openai-compatible.md)
- [Provider packages](../provider-packages.md)
- [Model routing](../model-routing.md)
- [Credential storage](../credential-storage.md)
- Package README: [`@arnilo/prism-providers` family README](../../packages/prism-providers/README.md)
