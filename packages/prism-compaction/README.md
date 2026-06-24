# @arnilo/prism-compaction

Umbrella package that installs all first-party **Prism compaction strategies** in one dependency.

## What it installs

- [`@arnilo/prism-compaction-llm`](https://www.npmjs.com/package/@arnilo/prism-compaction-llm) — LLM-driven conversation compaction strategy
- [`@arnilo/prism-compaction-observational-memory`](https://www.npmjs.com/package/@arnilo/prism-compaction-observational-memory) — observational memory compaction strategy

## Usage

```bash
npm install @arnilo/prism-compaction
```

This is a pure manifest package (no code, no exports). Import compaction strategy factories from the individual packages:

```ts
import { createLLMCompactionStrategy } from "@arnilo/prism-compaction-llm";
```

Each compaction package declares `@arnilo/prism` as a non-optional peer, so installing `@arnilo/prism-compaction` also requires core. Prefer [`@arnilo/prism-all`](https://www.npmjs.com/package/@arnilo/prism-all) if you want core + providers + compaction in one install.

## License

MIT
