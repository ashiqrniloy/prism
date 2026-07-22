# @arnilo/prism-compaction

Umbrella package that installs all first-party **Prism compaction strategies** in one dependency.

## What it installs

- [`@arnilo/prism-compaction-llm`](https://www.npmjs.com/package/@arnilo/prism-compaction-llm) — LLM-driven conversation compaction strategies, including `createCodingCompactionStrategy()` for coding-session handoff
- [`@arnilo/prism-compaction-observational-memory`](https://www.npmjs.com/package/@arnilo/prism-compaction-observational-memory) — observational memory compaction strategy

## Usage

```bash
npm install @arnilo/prism-compaction
```

This is a pure manifest package (no code, no exports). Import compaction strategy factories from the individual packages:

```ts
import { createLlmCompactionStrategy, createCodingCompactionStrategy } from "@arnilo/prism-compaction-llm";
```

Each compaction package declares `@arnilo/prism` as a non-optional peer. `@arnilo/prism-base` includes core, this family, and JSON Schema validation; `@arnilo/prism-all` installs every first-party package. See [Release and install](../../docs/release-and-install.md).

## License

MIT
