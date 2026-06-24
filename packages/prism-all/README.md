# @arnilo/prism-all

Umbrella package that installs the **Prism core runtime** plus all first-party **provider adapters** and **compaction strategies** in one dependency.

## What it installs

- [`@arnilo/prism`](https://www.npmjs.com/package/@arnilo/prism) — core runtime, contracts, registries, CLI
- [`@arnilo/prism-providers`](https://www.npmjs.com/package/@arnilo/prism-providers) — all 5 provider adapters (openai, opencode-go, openrouter, zai, kimi)
- [`@arnilo/prism-compaction`](https://www.npmjs.com/package/@arnilo/prism-compaction) — both compaction strategies (llm, observational-memory)

## Usage

```bash
npm install @arnilo/prism-all
```

This is a pure manifest package (no code, no exports). Imports come from the individual packages:

```ts
import { createExtensionKernel } from "@arnilo/prism";
import { createOpenAIProviderPackage } from "@arnilo/prism-provider-openai";
```

## Graduated installs

If you do not need the full kit, install only what you use:

| Want | Install |
|------|---------|
| Core runtime only | `@arnilo/prism` |
| Core + all providers | `@arnilo/prism` + `@arnilo/prism-providers` |
| Core + compaction | `@arnilo/prism` + `@arnilo/prism-compaction` |
| Everything | `@arnilo/prism-all` |

## License

MIT
