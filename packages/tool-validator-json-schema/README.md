# @arnilo/prism-tool-validator-json-schema

Optional JSON Schema validator for Prism tool arguments. Returns a `ToolValidator` compatible with `AgentConfig.validator`, `RunOptions.validate`, and `dispatchToolCall({ validate })`.

## Install

```bash
npm install @arnilo/prism-tool-validator-json-schema @arnilo/prism
```

## Usage

```ts
import { createAgent } from "@arnilo/prism";
import { createJsonSchemaToolArgumentValidator } from "@arnilo/prism-tool-validator-json-schema";

const agent = createAgent({
  model,
  validator: createJsonSchemaToolArgumentValidator(),
});
```

Require every active tool to declare `parameters`:

```ts
createJsonSchemaToolArgumentValidator({
  missingSchema: "reject",
  maxSchemaBytes: 256 * 1024,
  maxCompiledSchemas: 256,
});
```

Compose a lower-level adapter:

```ts
import { createJsonSchemaArgumentValidator } from "@arnilo/prism-tool-validator-json-schema";
import { createToolParameterValidator } from "@arnilo/prism";

const validate = createToolParameterValidator(createJsonSchemaArgumentValidator());
```

## Security

- Rejects prototype-pollution keys in schemas and argument instances.
- Rejects every non-local `$ref`, prototype-pollution keys, schema cycles, and non-finite schema numbers before Ajv compilation.
- Bounds schemas to 256 KiB, depth 64, 10,000 properties/keywords, and 128 refs by default; all caps reject invalid values and have finite hard ceilings (1 MiB, 128, 100,000, and 1,024).
- Bounds argument depth, property count, string length, and array length before schema validation.
- Retains at most 256 compiled schemas in deterministic LRU order (hard cap 1,024); eviction also removes Ajv's matching compiled schema.

See [Tool execution primitives](../../docs/tool-execution-primitives.md) for the full Plan 055 design.
