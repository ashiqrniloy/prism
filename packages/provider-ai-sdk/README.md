# @arnilo/prism-provider-ai-sdk

Optional adapter that turns a host-supplied AI SDK `LanguageModelV4` into a Prism `AIProvider`.

Install explicitly. This package is not included in profile bundles until a size/use review. Core `@arnilo/prism` stays free of AI SDK dependencies.

## Install

```bash
npm install @arnilo/prism-provider-ai-sdk @arnilo/prism @ai-sdk/provider
```

Supported specification: AI SDK `@ai-sdk/provider` **v4** (`LanguageModelV4`, `specificationVersion: "v4"`).

## Usage

```ts
import { createAgent } from "@arnilo/prism";
import { createAiSdkProvider } from "@arnilo/prism-provider-ai-sdk";

const provider = createAiSdkProvider({
  model: hostCreatedLanguageModelV4,
});

const agent = createAgent({
  provider,
  model: {
    provider: provider.id,
    model: hostCreatedLanguageModelV4.modelId,
    capabilities: { tools: true, streaming: true, structuredOutput: true },
  },
});
```

The host owns credentials inside the supplied AI SDK model. The adapter maps Prism messages/tools/structured-output options to `doStream` call options and translates stream parts into Prism provider events incrementally.
