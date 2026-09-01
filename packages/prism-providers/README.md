# @arnilo/prism-providers

Unified provider family for Prism agents: all 17 first-party provider adapters as explicit subpaths. Install once, import only the adapter you use — importing one adapter never evaluates another, and no adapter activates at package install or family import.

## Install

```bash
npm install @arnilo/prism @arnilo/prism-providers
```

The required `@arnilo/prism` peer is the only dependency. The `/ai-sdk` adapter additionally uses `@ai-sdk/provider` as an optional peer (host-supplied).

## Adapters (subpaths)

- [`@arnilo/prism-providers/ai-sdk`](https://www.npmjs.com/package/@arnilo/prism-providers) — host-owned AI SDK `LanguageModelV4` interoperability adapter
- [`@arnilo/prism-providers/alibaba`](https://www.npmjs.com/package/@arnilo/prism-providers) — Alibaba Cloud (Model Studio / DashScope, incl. Coding Plan) provider
- [`@arnilo/prism-providers/anthropic`](https://www.npmjs.com/package/@arnilo/prism-providers) — Anthropic Messages provider
- [`@arnilo/prism-providers/azure`](https://www.npmjs.com/package/@arnilo/prism-providers) — Azure OpenAI provider (host Entra token or resource key)
- [`@arnilo/prism-providers/bedrock`](https://www.npmjs.com/package/@arnilo/prism-providers) — AWS Bedrock provider (SigV4, host IAM/IRSA)
- [`@arnilo/prism-providers/clinepass`](https://www.npmjs.com/package/@arnilo/prism-providers) — ClinePass OpenAI-compatible gateway
- [`@arnilo/prism-providers/deepseek`](https://www.npmjs.com/package/@arnilo/prism-providers) — DeepSeek Chat Completions provider
- [`@arnilo/prism-providers/google`](https://www.npmjs.com/package/@arnilo/prism-providers) — Google Gemini generateContent provider
- [`@arnilo/prism-providers/kimi`](https://www.npmjs.com/package/@arnilo/prism-providers) — Moonshot Kimi provider
- [`@arnilo/prism-providers/neuralwatt`](https://www.npmjs.com/package/@arnilo/prism-providers) — NeuralWatt OpenAI-compatible provider
- [`@arnilo/prism-providers/ollama`](https://www.npmjs.com/package/@arnilo/prism-providers) — Ollama Cloud provider
- [`@arnilo/prism-providers/openai`](https://www.npmjs.com/package/@arnilo/prism-providers) — OpenAI Responses + Codex provider
- [`@arnilo/prism-providers/opencode-go`](https://www.npmjs.com/package/@arnilo/prism-providers) — OpenCode Go dual-route provider
- [`@arnilo/prism-providers/openrouter`](https://www.npmjs.com/package/@arnilo/prism-providers) — OpenRouter catalog provider
- [`@arnilo/prism-providers/vertex`](https://www.npmjs.com/package/@arnilo/prism-providers) — Google Vertex provider (host ADC / workload token)
- [`@arnilo/prism-providers/xai`](https://www.npmjs.com/package/@arnilo/prism-providers) — xAI Grok Completions + SuperGrok OAuth
- [`@arnilo/prism-providers/zai`](https://www.npmjs.com/package/@arnilo/prism-providers) — Z.AI GLM provider

## Usage

```ts
import { createAgent } from "@arnilo/prism";
import { createOpenAIResponsesProvider, openAIModels } from "@arnilo/prism-providers/openai";
```

Every subpath is side-effect-free: setup never fetches, scans env, reads credential stores, or activates a provider. See [docs/provider-packages.md](https://github.com/ashiqrniloy/prism/blob/main/docs/provider-packages.md) and [docs/migrate-to-0.4.md](https://github.com/ashiqrniloy/prism/blob/main/docs/migrate-to-0.4.md#providers) for the old-package import map.

## License

MIT