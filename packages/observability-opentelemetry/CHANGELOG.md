# Changelog

## [Unreleased]

## [0.0.5] - 2026-07-16

- Added safe run-feedback/evaluation span events or ended-run spans plus low-cardinality counters; comments, tag values, scorer/evaluation IDs, and arbitrary metadata are not accepted by telemetry handlers.

## [0.0.4] - 2026-07-14

- Added session attachment, metadata-only provider/tool spans, low-cardinality metrics, in-memory telemetry, disabled no-op mode, and exporter-failure isolation.

## [0.0.3]

- Initial release: `createOpenTelemetryInstrumentation`, mockable tracer/meter interfaces, and optional `@opentelemetry/api` bridge.
