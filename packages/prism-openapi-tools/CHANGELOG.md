# Changelog

## [0.0.28] - 2026-08-08

### Added
- `createOpenApiTools` compiles host-selected OpenAPI 3.1 operationIds into bounded Prism `ToolDefinition`s: allow-list only (no raw method/path passthrough), pinned server origin with `servers`-drift rejection, internal `$ref` resolution with depth/ref bounds (cycles and external refs fail closed), cookie/non-JSON-body/duplicate-argument rejection, GET/HEAD/OPTIONS/TRACE as `none` effects and POST/PUT/PATCH/DELETE as `external_mutation`/`required` (core approval + effect-store dedup), bounded request/response bytes, bounded retries (`ERR_PRISM_OPENAPI_RETRY_EXHAUSTED`), optional bounded cursor pagination, host credential resolver, optional response redaction, and optional `Idempotency-Key` header forwarding.
- `OpenApiToolError` with frozen `ERR_PRISM_OPENAPI_*` codes; `DEFAULT_OPENAPI_LIMITS`/`HARD_OPENAPI_LIMITS`/`resolveOpenApiLimits`.

## [0.0.27] - 2026-08-07

### Changed
- Released with exact 0.0.27 graph.
