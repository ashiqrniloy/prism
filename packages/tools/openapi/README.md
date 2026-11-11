# @arnilo/prism-tools/openapi

The first-party OpenAPI 3.1 tools as a Prism package. The default export is a `definePackage`
definition whose `setup` reads each configured spec once, compiles the allow-listed operations into
bounded tools, and registers them as `<id>_<operationId>`.

## Install

```bash
prism add @arnilo/prism-tools/openapi
```

```jsonc
// manifest entry
{
  "name": "@arnilo/prism-tools/openapi",
  "version": "^0.13.0",
  "integrity": "sha512-…",
  "config": {
    "specs": [
      {
        "id": "petstore",
        "source": "./petstore.json",
        "headers": { "Authorization": "env:PETSTORE_TOKEN" }
      }
    ]
  }
}
```

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `specs[].id` | `string` | none (required per spec) | Tool-name prefix: every operation compiles as `<id>_<operationId>`. |
| `specs[].source` | `string` | none (required per spec) | Path to a local **JSON** document, or an `https:` URL fetched once at setup through the kernel's pinned fetch. |
| `specs[].baseUrl` | `string` | document `servers[0].url` | Pinned origin for the compiled operations. Required when the document declares no absolute server URL. |
| `specs[].headers` | `Record<string, env:NAME \| keyring:NAME>` | none | Ref-only request headers. A literal fails config validation. Resolved per request through `prism.credentials.resolve`. |
| `specs[].include` | `string[]` | every operation | Allow-listed operationIds. |
| `specs[].exclude` | `string[]` | none | operationIds to skip when `include` is absent. |
| `limits` | `object` | tool defaults | Byte, schema-depth, pagination, retry, and body bounds shared by every spec. |

An unknown key fails `createAgent` with the kernel's config error naming the key. A spec that fails
to load or compile writes a `warn` status note and is skipped; the other specs still register. A
tool-name collision between specs fails closed through the kernel's tool-conflict rule — there is no
silent renaming.

## What it changes

Registers tools with a declared `effects` annotation:

| method | effects | notes |
| --- | --- | --- |
| `GET`, `HEAD` | `["network"]` | read-only network reach |
| anything else | `["network", "external"]` | mutates an external system; the effect declaration also carries `{ kind: "external_mutation", idempotency: "required" }` |

Compile-time guarantees (from the moved compiler):

- **Allow-list only**: operations not listed never compile; unknown ids throw `ERR_PRISM_OPENAPI_OPERATION_UNKNOWN`.
- **Origin pinned**: every document/path/operation `servers` entry must resolve to the pinned origin, else `ERR_PRISM_OPENAPI_SERVER_DRIFT`. https only; http allowed only for loopback hosts.
- **Bounded schemas**: internal `$ref`s resolve into self-contained argument schemas with `additionalProperties: false`; cycles, depth, ref count, external refs, cookie parameters, and duplicate argument names fail closed.
- **Bounded I/O**: body, response, retry, and pagination caps apply to every call. URL specs are fetched once at setup, never per turn.

## Capabilities

`credentials` — header refs resolve per request through the credentials slot. A resolved secret joins
the agent's secret set, so it is redacted from events, notes, logs, errors, and tool results.

## Cost, security, and failure behavior

- Header values never enter tool schemas, results, prompts, telemetry, URLs, or errors. Only refs are accepted in config; a literal fails validation.
- URL specs go through the kernel's DNS-pinned, redirect-free, byte-bounded fetch; the API calls themselves use the pinned `server` origin.
- Registration performs one read per spec and no API call.

## Example

```ts
import toolsOpenapi from "@arnilo/prism-tools/openapi";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model,
  packages: [
    toolsOpenapi({
      specs: [{ id: "petstore", source: "./petstore.json", headers: { Authorization: "env:PETSTORE_TOKEN" } }],
    }),
  ],
});
```

The 0.12 factory names stay exported: `createOpenApiTools`, `resolveOpenApiLimits`,
`DEFAULT_OPENAPI_LIMITS`, `HARD_OPENAPI_LIMITS`, `OpenApiToolError`, and the spec helpers
(`loadSpecDocument`, `firstServerUrl`, `listOperationIds`, `selectOperations`).

## License

MIT
