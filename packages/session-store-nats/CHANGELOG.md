# Changelog

## [0.2.2] - 2026-08-13

### Changed
- Restart-stable durable consumer identity: the durable name is exactly prism_<hmac16 of tenantId|sessionId|runId> (random suffix removed) so a crash-resumed subscribe continues from the last ack; clean stops delete the durable consumer and reclaim orphaned 0.2.1 prism_<digest>_<random> consumers; the subscribe close() hang (parked generator) fixed with per-subscriber stop signals. See docs/agent-events.md.

## [0.1.0] - 2026-08-09

### Changed
- Released with exact 0.1.0 graph.

## [0.0.28] - 2026-08-08

### Changed
- Released with exact 0.0.28 graph.

## [0.0.27] - 2026-08-07

### Changed
- Released with exact 0.0.27 graph.

## [0.0.26] - 2026-08-06

### Added
- New package: NATS JetStream `AgentEventSource` adapter (FR-5). `createNatsAgentEventSource({ connection, stream, limits?, cursorSecret? })` implements the durable `AgentEventSource` contract over JetStream: per-run subjects (`prism.agent-events.<tenant>.<session>.<run>`), per-subject replay, durable pull consumers with explicit acks (at-least-once, 30s redelivery), idempotent `append` by `record.id` within the stream dedupe window, HMAC-signed resumable cursors, ownership-scoped `page`/`subscribe`/`cleanup`, and bounded `AgentEventSourceOptions` limits. `createNatsJetStream(nc)` adapts the official `@nats-io/transport-node` + `@nats-io/jetstream` clients to the narrow testable seam. Inert on import; network-free tests use an in-memory fake. See [agent events](../../docs/agent-events.md).
