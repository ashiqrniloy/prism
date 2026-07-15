# @arnilo/prism-base

Minimal safe Prism profile: core runtime, both first-party compaction strategies, and JSON Schema tool argument validation.

```bash
npm install @arnilo/prism-base
```

This is a pure manifest package with no exports. Import APIs from their owning packages:

```ts
import { createAgent } from "@arnilo/prism";
import { createJsonSchemaToolArgumentValidator } from "@arnilo/prism-tool-validator-json-schema";
```

Providers, MCP, host coding tools, native credentials, and database drivers remain separate choices. See [Release and install](../../docs/release-and-install.md) for full profile boundaries.
