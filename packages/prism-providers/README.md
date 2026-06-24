# @arnilo/prism-providers

Umbrella package that installs all first-party **Prism provider adapters** in one dependency.

## What it installs

- [`@arnilo/prism-provider-openai`](https://www.npmjs.com/package/@arnilo/prism-provider-openai) — OpenAI Responses + Codex OAuth provider
- [`@arnilo/prism-provider-opencode-go`](https://www.npmjs.com/package/@arnilo/prism-provider-opencode-go) — OpenCode Go provider
- [`@arnilo/prism-provider-openrouter`](https://www.npmjs.com/package/@arnilo/prism-provider-openrouter) — OpenRouter provider with per-model cache control
- [`@arnilo/prism-provider-zai`](https://www.npmjs.com/package/@arnilo/prism-provider-zai) — Zhipu AI (Z.ai) provider
- [`@arnilo/prism-provider-kimi`](https://www.npmjs.com/package/@arnilo/prism-provider-kimi) — Moonshot Kimi provider

## Usage

```bash
npm install @arnilo/prism-providers
```

This is a pure manifest package (no code, no exports). Import provider factories from the individual packages:

```ts
import { createOpenAIProviderPackage } from "@arnilo/prism-provider-openai";
import { createOpenRouterProviderPackage } from "@arnilo/prism-provider-openrouter";
```

Each provider package declares `@arnilo/prism` as a non-optional peer, so installing `@arnilo/prism-providers` also requires core. Prefer [`@arnilo/prism-all`](https://www.npmjs.com/package/@arnilo/prism-all) if you want core + providers + compaction in one install.

## License

MIT
