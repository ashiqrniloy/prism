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
createJsonSchemaToolArgumentValidator({ missingSchema: "reject" });
```

Compose a lower-level adapter:

```ts
import { createJsonSchemaArgumentValidator } from "@arnilo/prism-tool-validator-json-schema";
import { createToolParameterValidator } from "@arnilo/prism";

const validate = createToolParameterValidator(createJsonSchemaArgumentValidator());
```

## Security

- Rejects prototype-pollution keys in schemas and argument instances.
- Rejects remote (`http:`/`https:`) `$ref` targets.
- Bounds argument depth, property count, string length, and array length before schema validation.
- Compiles each schema once per stable schema identity (in-memory cache).

See [Tool execution primitives](../../docs/tool-execution-primitives.md) for the full Plan 055 design.
