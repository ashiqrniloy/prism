# @arnilo/prism-providers

Umbrella package that installs all first-party **Prism provider adapters** in one dependency.

## What it installs

- [`@arnilo/prism-provider-openai`](https://www.npmjs.com/package/@arnilo/prism-provider-openai) — OpenAI Responses + Codex OAuth provider
- [`@arnilo/prism-provider-opencode-go`](https://www.npmjs.com/package/@arnilo/prism-provider-opencode-go) — OpenCode Go provider
- [`@arnilo/prism-provider-openrouter`](https://www.npmjs.com/package/@arnilo/prism-provider-openrouter) — OpenRouter provider with per-model cache control
- [`@arnilo/prism-provider-zai`](https://www.npmjs.com/package/@arnilo/prism-provider-zai) — Zhipu AI (Z.ai) provider
- [`@arnilo/prism-provider-kimi`](https://www.npmjs.com/package/@arnilo/prism-provider-kimi) — Moonshot Kimi provider
- [`@arnilo/prism-provider-neuralwatt`](https://www.npmjs.com/package/@arnilo/prism-provider-neuralwatt) — NeuralWatt OpenAI-compatible provider
- [`@arnilo/prism-provider-ai-sdk`](https://www.npmjs.com/package/@arnilo/prism-provider-ai-sdk) — host-owned AI SDK `LanguageModelV4` interoperability adapter

## Usage

```bash
npm install @arnilo/prism-providers
```

This is a pure manifest package (no code, no exports). Import provider factories from the individual packages:

```ts
import { createOpenAIProviderPackage } from "@arnilo/prism-provider-openai";
import { createOpenRouterProviderPackage } from "@arnilo/prism-provider-openrouter";
import { createAiSdkProvider } from "@arnilo/prism-provider-ai-sdk";
```

Each provider package declares `@arnilo/prism` as a non-optional peer, so installing `@arnilo/prism-providers` also requires core. Add this family to `@arnilo/prism-code` or `@arnilo/prism-sdk`, or use `@arnilo/prism-all` for every first-party package. See [Release and install](../../docs/release-and-install.md).

## License

MIT
