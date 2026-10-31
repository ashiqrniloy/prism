# Changelog

## [Unreleased]

### Added

- Trace-context propagation (`propagateTraceContext`, plan 214 Task 4): one `model.request` transform injects
  the active chat/run span as W3C `traceparent`/`tracestate` through the API's `propagation.inject`, writing only
  those two headers, never overwriting a caller's value, and falling back to the span ids when no propagator is
  registered or it throws. `usageMetadata` names dotted `Usage.metadata` paths exported as `prism.usage.<path>`
  scalars on the chat span (`content: "metadata"`, subject to `fieldPolicy`). Both default off and cost no request.
  `rawOpenTelemetrySpan`, `injectTraceContext`, `activeTraceSpan` and `formatTraceparent` are exported for hosts.
- `@arnilo/prism-observability` (plan 160 Task 3): native package turning run, turn, and tool events into OpenTelemetry spans and metrics through observe handlers. Moved the agent-event instrumentation (`createOpenTelemetryInstrumentation`, `wrapOpenTelemetryApi`, `createInMemoryTelemetry`) out of `@arnilo/prism-core/governance/observability`. Exports nothing itself.

## [0.1.0] - 2026-08-09

### Added

- Lockstep package scaffold.

## [0.0.28] - 2026-08-08

### Added

- Lockstep package scaffold.
