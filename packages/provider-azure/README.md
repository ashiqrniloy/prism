# @arnilo/prism-provider-azure

Azure OpenAI / Foundry enterprise adapter for Prism. Host supplies late-bound Entra workload identity (or Azure resource key). Endpoint host is never rewritten.

## Install

```bash
npm install @arnilo/prism-provider-azure @arnilo/prism
```

## Usage

```ts
import { createAzureOpenAIProviderPackage } from "@arnilo/prism-provider-azure";

createAzureOpenAIProviderPackage({
  endpoint: "https://my-resource.openai.azure.com", // or private endpoint FQDN
  deployment: "gpt-4o",
  apiVersion: "2024-10-21",
  credential: () => hostEntraTokenProvider.getToken("https://cognitiveservices.azure.com/.default"),
  authStyle: "bearer", // or "api-key" for Azure resource keys
  models: [{ provider: "azure", model: "gpt-4o" }],
});
```

See [Azure OpenAI / Foundry](../../docs/providers/azure.md).
