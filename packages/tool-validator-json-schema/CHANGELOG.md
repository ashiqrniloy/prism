# Changelog
## [0.0.7] - 2026-07-19

- Released with the exact 0.0.7 first-party package graph.

## [0.0.6] - 2026-07-19

- Bound untrusted schema bytes/depth/properties/keywords/refs before Ajv compilation, reject every non-local `$ref`, and use a finite LRU compiled-schema cache.

## [0.0.5] - 2026-07-16

- Pinned the required `@arnilo/prism` peer and package metadata to 0.0.5; runtime behavior is unchanged.


## [0.0.4] - 2026-07-14

- Added compiled-schema caching, configurable depth/property/string/array bounds, prototype-pollution rejection, remote `$ref` rejection, and optional missing-schema denial.

## [0.0.3]

- Initial release: `createJsonSchemaToolArgumentValidator` and `createJsonSchemaArgumentValidator` for Plan 055 Task 1.
