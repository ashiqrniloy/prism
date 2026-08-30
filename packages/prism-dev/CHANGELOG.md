# Changelog

## [0.0.1] - 2026-09-05

### Added
- Initial release (plan 040 Tasks 1–5): loopback-only dev inspector composition surface — `createPrismDevInspector` wires `createPrismHandler` agent routes over a host-built agent with optional durable `AgentEventSource` replay, the Task-2 data-defined routes (`POST /prompt`, `GET /events?runId=` SSE with `Last-Event-ID` reconnect, `GET /runs/:id/replay` paged replay without re-execution, `POST /runs/:runId/decisions/:decisionId` fail-closed HITL resume over `createAgentRunLifecycle` when the host wires `checkpoints`), the Task-3 served UI (static page + module with prompt/stream/timeline/tool/usage/decision panels, windowed 1k-event rendering, strict CSP, no external fetches), the Task-4 CLI composition (`prism-dev` bin + programmatic `runDevCli` behind the core CLI's `prism dev` delegation; boots the `prism init` scaffold's `createAppAgent`, prints the loopback URL, closes on SIGINT), and the Task-5 release integration (independent 0.0.1 cut outside the umbrellas, `security:threat-suites` dev-inspector leg, publish dry-run evidence). Loopback bind enforced by default; non-loopback binds require an explicit `remoteAuthorize` callback. Composition-only: no new core primitives, no core-internals imports, no framework dependencies.

## [0.1.0] - 2026-08-09

### Changed
- Released with exact 0.1.0 graph.

## [0.0.28] - 2026-08-08

### Changed
- Released with exact 0.0.28 graph.