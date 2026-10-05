# `@arnilo/prism-provider-azure`

Azure OpenAI / Foundry provider package for [Prism](https://github.com/ashiqrniloy/prism). Registers the `azure` provider, resolves a resource key or Entra token through the credentials slot on every request, and builds the deployment-scoped chat-completions URL without rewriting the endpoint host.

## Install

```sh
bun add @arnilo/prism-provider-azure
```

## Use

```ts
import azure from "@arnilo/prism-provider-azure";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "azure/gpt-4o",
  packages: [
    azure({
      resourceName: "my-resource",
      deployment: "gpt-4o",
      credential: "env:AZURE_OPENAI_API_KEY",
    }),
  ],
});
```

Exactly one of `resourceName`/`endpoint` is required, so a bare `packages: [azure]` needs it from `packageConfig`.

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `resourceName` | string | — | Builds `https://<resourceName>.openai.azure.com`. Exactly one of `resourceName`/`endpoint`. |
| `endpoint` | https URL | — | Full endpoint (custom subdomain, private endpoint, VNet FQDN), preserved verbatim. |
| `deployment` | string | request model id | Deployment name. |
| `apiVersion` | string | `2024-10-21` | Azure API version. |
| `credential` | `env:`/`keyring:` ref | `env:AZURE_OPENAI_API_KEY` | Resolved through the credentials slot on every request; a literal value is rejected (`secret_literal`). |
| `authStyle` | `bearer` \| `api-key` | `bearer` | `bearer` sends `authorization: Bearer <token>` (Entra); `api-key` sends `api-key: <token>` (resource key). |
| `models` | `ModelConfig[]` | — | Static catalog; Azure deployments are host-defined. |

Set config through the code instance or through `AgentConfig.packageConfig` (which wins). Factory-only
options — `id`, `fetch` — are not JSON and cannot come from a manifest.

## Behaviour

- **Missing credential.** `createAgent` still succeeds. Setup records a `warn` status note naming the
  ref and registers the provider anyway, so `agent.models` still lists the catalog and the failure is
  not `Unknown provider`. A run then fails with `credential_unavailable`, naming the ref and never a
  value.
- **Discovery is caller-gated.** Nothing fetches during setup.
- **Secrets never surface.** Every resolved credential joins the agent's redaction set, so it is masked
  in events, `inspect()`, status notes, and errors.

## Named exports

The raw factories stay public for tests and advanced hosts: `createAzureOpenAIProvider`, `azureChatCompletionsUrl`, `requireAzureEndpoint`, `AZURE_OPENAI_DEFAULT_API_VERSION`.

## License

MIT
