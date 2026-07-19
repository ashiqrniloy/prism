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

## Model catalog

There is **no Prism-side catalog** and **no `list*Models()` export**. Hosts register a `ModelConfig` that matches the supplied `LanguageModelV4.modelId` and declare capabilities locally.

## Prompt caching

Request caching is **host-model-owned**. The adapter does not emit `cache_control`, `prompt_cache_key`, or Prism `cacheKey`/`cacheRetention` fields. When the host model reports cache usage on `finish.usage`, Prism maps:

- `inputTokens.cacheRead` → `Usage.cacheReadTokens`
- `inputTokens.cacheWrite` → `Usage.cacheWriteTokens`

Configure upstream caching via AI SDK model settings or per-turn `providerOptions` the host already supports (forwarded through `options.compat` / `options.extra` as `providerOptions.prism`).

## Thinking / reasoning

Reasoning effort and provider-specific thinking controls are **host-model-owned** (`thinkingFamilyForModel` → `noop`). Prism maps `reasoning-delta` stream parts to thinking deltas and replays assistant `thinking` blocks as AI SDK `reasoning` prompt parts.

## Exports

- `createAiSdkProvider`
- `AiSdkProviderError`
- `SUPPORTED_AI_SDK_SPECIFICATION`
- `toAiSdkCallOptions`, `toAiSdkPrompt`, `toAiSdkTool`, `mapAiSdkStream`, `mapUsage`

Official references: [Custom providers](https://ai-sdk.dev/providers/community-providers/custom-providers); [Language Model V4 spec](https://github.com/vercel/ai/tree/main/packages/provider/src/language-model/v4).
