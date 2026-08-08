# @arnilo/prism-openapi-tools

Optional OpenAPI 3.1 tools adapter for Prism: compile host-selected operations into bounded `ToolDefinition`s.

## Install

```sh
npm install @arnilo/prism-openapi-tools
```

## Usage

```ts
import { createOpenApiTools } from "@arnilo/prism-openapi-tools";

const tools = createOpenApiTools({
  document, // OpenAPI 3.1 document (string or parsed object)
  operations: ["getCustomer", "createCase"], // only these operationIds compile
  server: "https://api.example.com/v1", // pinned base URL
  credentials: async ({ operationId }) => ({
    headers: { authorization: `Bearer ${await hostToken(operationId)}` },
  }),
  redactor, // applied to response text before it enters the tool result
});
```

## Behavior

- **Allow-list only**: operations not listed in `operations` never compile; unknown ids throw `ERR_PRISM_OPENAPI_OPERATION_UNKNOWN`. No raw method/path passthrough.
- **Origin pinned**: every document/path/operation `servers` entry must resolve to the pinned `server` origin, else `ERR_PRISM_OPENAPI_SERVER_DRIFT`. https only (http allowed for loopback hosts).
- **Bounded schemas**: internal `$ref`s are resolved into self-contained argument schemas; cycles, depth (`maxSchemaDepth`), ref count (`maxRefs`), and external refs fail closed (`ERR_PRISM_OPENAPI_SCHEMA_BOUNDS`). Cookie parameters, non-JSON request bodies, and duplicate argument names are rejected.
- **Effects**: GET/HEAD/OPTIONS/TRACE compile as `{ kind: "none", idempotency: "none" }`; POST/PUT/PATCH/DELETE as `{ kind: "external_mutation", idempotency: "required" }`, so the core run loop gates approval and deduplicates via the effect store. Optional `idempotencyKeyHeader: true` sends the core `Idempotency-Key` on mutating requests.
- **Runtime bounds**: request body (`maxBodyBytes`), response (`maxResponseBytes`), retries on transport errors/5xx (`maxRetries`, `ERR_PRISM_OPENAPI_RETRY_EXHAUSTED`), and optional cursor pagination (`maxPages`, `maxPaginationItems`).
- **Untrusted output**: responses are returned as data with an untrusted-content marker; the optional `redactor` is applied before the result is built. Credentials come only from the host resolver and are never echoed.

## Limits

Defaults and hard caps: `maxDocumentBytes` 2 MiB/16 MiB, `maxOperations` 256/1024, `maxSchemaDepth` 32/128, `maxRefs` 1024/8192, `maxBodyBytes` 1 MiB/16 MiB, `maxResponseBytes` 1 MiB/16 MiB, `maxPages` 20/100, `maxPaginationItems` 1000/10000, `maxRetries` 0/3.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
