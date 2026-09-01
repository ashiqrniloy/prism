# OpenAPI tools adapter (`@arnilo/prism-openapi-tools`)

Optional `createOpenApiTools` compiles host-selected OpenAPI 3.1 operations into bounded Prism `ToolDefinition`s. Zero dependencies (native fetch + WebCrypto-free); the compile step is pure and separated from the runtime executor.

## When to use it

Hosts that already expose a JSON API with an OpenAPI 3.1 document and want the agent to call a **fixed, host-chosen subset** of it — never model-driven discovery, never a raw method/path passthrough. For vendor web search/extraction use `@arnilo/prism-web-tools`; for M365/GWS use `@arnilo/prism-work-tools`; this adapter is for arbitrary host APIs.

## Usage

```ts
import { createOpenApiTools } from "@arnilo/prism-openapi-tools";

const tools = createOpenApiTools({
  document, // OpenAPI 3.1 document (JSON string or parsed object)
  operations: ["getCustomer", "createCase"], // only these operationIds compile
  server: "https://api.example.com/v1", // pinned base URL
  credentials: async ({ operationId }) => ({
    headers: { authorization: `Bearer ${await hostToken(operationId)}` },
  }),
  policy: ({ operationId, args }, context) => {
    if (operationId === "createCase" && !context.identity) throw new Error("identity required");
  },
  redactor, // applied to response text before it enters the tool result
  pagination: { pageParam: "page", pageSizeParam: "limit", pageSize: 50, nextPath: "next", itemsPath: "items" },
  idempotencyKeyHeader: true, // forward the core Idempotency-Key on mutating requests
});
```

Register the returned tools with `createToolRegistry` (or pass them to the MCP bridge); validate arguments with `createJsonSchemaToolArgumentValidator` as usual.

## Compile-time guarantees

- **Allow-list only**: operations not listed never compile; unknown ids throw `ERR_PRISM_OPENAPI_OPERATION_UNKNOWN`. No generic arbitrary-request escape hatch.
- **Origin pinned**: the `server` option is the only authority. Every document/path/operation `servers` entry must resolve to the pinned origin (relative URLs resolve against it), else `ERR_PRISM_OPENAPI_SERVER_DRIFT`. https only; http allowed only for loopback hosts.
- **Bounded schemas**: internal `$ref`s resolve into self-contained argument schemas (path + query + header + body in one object, `additionalProperties: false`). Cycles, depth (`maxSchemaDepth`), ref count (`maxRefs`), external refs, cookie parameters, non-JSON request bodies, and duplicate argument names all fail closed (`ERR_PRISM_OPENAPI_SCHEMA_BOUNDS`).
- **Effects**: GET/HEAD/OPTIONS/TRACE compile as `{ kind: "none", idempotency: "none" }`; POST/PUT/PATCH/DELETE as `{ kind: "external_mutation", idempotency: "required" }` — the core run loop gates approval ("Tool side effect requires approval") and deduplicates via the `ToolEffectStore` (mutating tools require a verified identity and an effect store at dispatch; retries never re-execute a completed effect). Optional `idempotencyKeyHeader: true` also forwards the core key as `Idempotency-Key` for APIs that honor it.

## Runtime guarantees

- Request body and response bounded (`maxBodyBytes`, `maxResponseBytes`); oversized responses fail closed (`ERR_PRISM_OPENAPI_RESPONSE_BOUNDS`).
- Retries only on transport errors and 5xx, bounded by `maxRetries` (default 0, hard 3); transport failures after exhaustion throw `ERR_PRISM_OPENAPI_RETRY_EXHAUSTED`; 4xx never retried.
- Optional cursor pagination applies only to operations whose compiled query parameters include `pageParam`; bounded by `maxPages` and `maxPaginationItems`.
- Credentials come only from the host `credentials` resolver (headers/query merged per call), never from the document or options; the optional `redactor` runs over response text before the result is built, so echoed secrets are stripped.
- Responses are untrusted data: results carry an "UNTRUSTED EXTERNAL API CONTENT" marker and `metadata.trust: "untrusted_external"`; redirects are never followed (`redirect: "manual"`); caller aborts propagate without retry.

## Limits

Defaults and hard caps (frozen in `scripts/phase11-freeze-manifest.json`): `maxDocumentBytes` 2 MiB/16 MiB, `maxOperations` 256/1024, `maxSchemaDepth` 32/128, `maxRefs` 1024/8192, `maxBodyBytes` 1 MiB/16 MiB, `maxResponseBytes` 1 MiB/16 MiB, `maxPages` 20/100, `maxPaginationItems` 1000/10000, `maxRetries` 0/3. Invalid limits throw `ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS`.

## Related

- [Tools](tools.md): registry, dispatch, validation
- [Recoverable tool effects](tool-effects.md): approval + idempotency contracts
- [Host security guide](host-security.md): permission, trust, validation checklist
- Package README: [`@arnilo/prism-coding-tools`](../packages/prism-coding-tools/README.md)
