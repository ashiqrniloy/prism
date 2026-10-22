# Changelog

All notable changes to `@arnilo/prism-tools-openapi` will be documented in this file.

## [Unreleased]

### Added

- Package created in plan 155 Task 4: the OpenAPI 3.1 compiler moved out of
  `@arnilo/prism-coding-tools/./openapi` with the factory names unchanged (`createOpenApiTools`,
  `resolveOpenApiLimits`, `DEFAULT_OPENAPI_LIMITS`, `HARD_OPENAPI_LIMITS`, `OpenApiToolError`).
- `toolsOpenapi({ specs, limits })` `definePackage` entry: reads each spec once (local JSON or an
  `https:` URL through pinned fetch), compiles the allow-listed operations, and registers
  `<id>_<operationId>` tools.
- Per-method `effects`: `GET`/`HEAD` declare `["network"]`; every other method declares
  `["network", "external"]`.
- Ref-only `specs[].headers` resolved per request through `prism.credentials.resolve`, so resolved
  values join the agent secret set and are redacted from events, notes, logs, errors, and results.
- A spec that fails to load or compile notes why and is skipped; cross-spec tool-name collisions
  fail closed through the kernel's tool-conflict rule.
- New `namePrefix` option on `createOpenApiTools`, plus the `loadSpecDocument`, `firstServerUrl`,
  `listOperationIds`, and `selectOperations` helpers.

## [0.1.0] - 2026-08-09

### Changed

- Finalized 0.1.0 package baseline.

## [0.0.28] - 2026-08-08

### Added

- Initial OpenAPI 3.1 compile/execute surface (as the `openapi` subpath of `@arnilo/prism-coding-tools`).
