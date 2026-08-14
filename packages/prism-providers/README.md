# @arnilo/prism-providers

Umbrella package that installs **11 of the 14** first-party **Prism provider adapters** in one dependency (Azure, Bedrock, and Vertex are not included — `@arnilo/prism-all` adds them separately).

## What it installs

- [`@arnilo/prism-provider-ai-sdk`](https://www.npmjs.com/package/@arnilo/prism-provider-ai-sdk) — host-owned AI SDK `LanguageModelV4` interoperability adapter
- [`@arnilo/prism-provider-alibaba`](https://www.npmjs.com/package/@arnilo/prism-provider-alibaba) — Alibaba Cloud (Model Studio / DashScope, incl. Coding Plan) provider
- [`@arnilo/prism-provider-anthropic`](https://www.npmjs.com/package/@arnilo/prism-provider-anthropic) — Anthropic Messages provider
- [`@arnilo/prism-provider-google`](https://www.npmjs.com/package/@arnilo/prism-provider-google) — Google Gemini generateContent provider
- [`@arnilo/prism-provider-kimi`](https://www.npmjs.com/package/@arnilo/prism-provider-kimi) — Moonshot Kimi provider
- [`@arnilo/prism-provider-neuralwatt`](https://www.npmjs.com/package/@arnilo/prism-provider-neuralwatt) — NeuralWatt OpenAI-compatible provider
- [`@arnilo/prism-provider-ollama`](https://www.npmjs.com/package/@arnilo/prism-provider-ollama) — Ollama Cloud provider
- [`@arnilo/prism-provider-openai`](https://www.npmjs.com/package/@arnilo/prism-provider-openai) — OpenAI Responses + Codex OAuth provider
- [`@arnilo/prism-provider-opencode-go`](https://www.npmjs.com/package/@arnilo/prism-provider-opencode-go) — OpenCode Go provider
- [`@arnilo/prism-provider-openrouter`](https://www.npmjs.com/package/@arnilo/prism-provider-openrouter) — OpenRouter provider with per-model cache control
- [`@arnilo/prism-provider-zai`](https://www.npmjs.com/package/@arnilo/prism-provider-zai) — Zhipu AI (Z.ai) provider

Not included: `@arnilo/prism-provider-azure`, `@arnilo/prism-provider-bedrock`, and `@arnilo/prism-provider-vertex`. Install them directly or through `@arnilo/prism-all` (which adds them alongside this family).

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

Each provider package declares `@arnilo/prism` as a non-optional peer, so installing `@arnilo/prism-providers` also requires core. Add this family to `@arnilo/prism-code` or `@arnilo/prism-sdk`, or use `@arnilo/prism-all` for the broad umbrella (20 direct packages, 43 transitive). See [Release and install](../../docs/release-and-install.md).

## License

MIT
