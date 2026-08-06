# Prism durable `AgentEventSource`: missing root export (0.0.24/0.0.25) and relocation question (0.0.96)

Status: **answered in 0.0.26 (plan 009 Task 9)**. FR-6 shipped: `createPostgresAgentEventSource`, `ClosablePostgresAgentEventSource`, and `PostgresAgentEventSourceOptions` are re-exported from the package root of `@arnilo/prism-session-store-postgres` (root-import smoke test in the package suite). FR-7 answered: the durable `AgentEventSource` stays in this package for the 0.0.26 line; PostgreSQL `LISTEN`/`NOTIFY` remains the reference durable implementation; `persistence.events` remains the canonical bundled path. Migration path: no action — both `persistence.events` and the standalone root export keep working; any future relocation ships a replacement export with a deprecation note before removal. Recorded in `docs/agent-events.md` and `docs/migration.md` `0.0.25 → 0.0.26`.

Context: Synapta is a digital-employee platform (agentic ERP). Agent↔client communication is being standardized fully on AG-UI via `@arnilo/prism-ag-ui`; the durable replay path (`createAgentEventSourceAgUiReplay`) requires a durable `AgentEventSource`. Prior FR precedent: `prism-ag-ui-a2ui-generative-ui.md` (FR-1/FR-2 gate Phase AG-4) and `prism-structured-output-final-turn-only.md` (shipped in 0.0.11).

---

## FR-6 (P1): Export `createPostgresAgentEventSource` from the package root

### Summary

`@arnilo/prism-session-store-postgres@0.0.24` ships `dist/event-source.js` containing `createPostgresAgentEventSource` and the `ClosablePostgresAgentEventSource` type, but the package root (`dist/index.js` / `index.d.ts`) does not re-export them. The root exports only `identifiers`, `createPostgresPersistence`/`reopenPostgresPersistence`, and `PostgresPersistenceOptions`. Any consumer importing the standalone event source from the package root gets `ERR_PACKAGE_PATH_NOT_EXPORTED` / "no exported member" — the function is unreachable through the public API surface.

Verified against the published tarballs:

- `0.0.24` and `0.0.25`: `dist/event-source.js` present, `createPostgresAgentEventSource` **not** in `dist/index.d.ts` root exports.
- `0.0.96`: `dist/event-source.js` **absent** — the event source is gone from the package entirely.

### Requested behavior

1. Re-export `createPostgresAgentEventSource`, `ClosablePostgresAgentEventSource`, and `PostgresAgentEventSourceOptions` from the package root of `@arnilo/prism-session-store-postgres` (0.0.24/0.0.25 line), so the standalone durable event source is importable through the documented public API.
2. If the event source is intentionally moving out of this package (see FR-7), ship the replacement location before removing the old one, with a deprecation note on the old export.

### Acceptance criteria

- `import { createPostgresAgentEventSource } from "@arnilo/prism-session-store-postgres"` type-checks and runs against the published package (no `dist/...` subpath import needed).
- The `ClosablePostgresAgentEventSource` type is exported alongside it.

### Synapta impact note

Synapta's authoring worker no longer needs the standalone export: `createPostgresPersistence` already bundles the event source as `persistence.events` (canonical root export), and the worker consumes that. The root export matters for (a) other consumers that want a standalone event source without full persistence, and (b) the relocation question below, which affects every Prism upgrade.

---

## FR-7 (P1, blocking for upgrades): Where does the durable `AgentEventSource` land?

### Summary

`0.0.96` of `@arnilo/prism-session-store-postgres` removed `event-source.js` entirely. Synapta's durable replay path depends on a durable `AgentEventSource` (PostgreSQL LISTEN/NOTIFY today). Before any Prism upgrade past `0.0.25`, we need to know the intended home of the durable event source: a new package, `@arnilo/prism` core, `@arnilo/prism-ag-ui`, or a renamed export in the same package.

### Requested behavior

- State the intended home of the durable `AgentEventSource` for the `0.0.96`+ line (package + export name), and whether the PostgreSQL LISTEN/NOTIFY implementation remains the reference durable implementation.
- If the event source moved to a new package, note the migration path from `persistence.events` / `createPostgresAgentEventSource` (0.0.24/0.0.25) to the new location.

### Acceptance criteria

- A documented, importable durable `AgentEventSource` (Postgres or equivalent) exists in the current Prism line, reachable through a package root export.
- The migration path from the 0.0.24/0.0.25 API is documented in the release notes.

### References

- `dist/event-source.d.ts` (0.0.24/0.0.25): `PostgresAgentEventSourceOptions`, `ClosablePostgresAgentEventSource extends AgentEventSource`, `createPostgresAgentEventSource(options)`.
- Root `dist/index.d.ts` (0.0.24/0.0.25): exports only `identifiers`, `createPostgresPersistence`/`reopenPostgresPersistence`, `PostgresPersistenceOptions`.
- `0.0.96` tarball: no `event-source.*` files; `persistence.d.ts` no longer references `AgentEventSource`.

---

## Related: FR-5 (NATS JetStream `AgentEventSource`) — **shipped in 0.0.26 (plan 009 Task 12)**

`prism-ag-ui-a2ui-generative-ui.md` FR-5 (P2, optional) asked for a NATS JetStream-backed `AgentEventSource` (durable consumer, per-subject replay, at-least-once with stable event IDs). Shipped as the new sibling package `@arnilo/prism-session-store-nats`: `createNatsAgentEventSource({ connection, stream, limits?, cursorSecret? })` over the official `@nats-io/transport-node` + `@nats-io/jetstream` clients (narrow `NatsJetStream` seam, `createNatsJetStream(nc)` adapter, network-free in-memory fake tests). Per-run subjects, per-subject replay, durable pull consumers with explicit acks (30s redelivery), idempotent `append` by `record.id` within the stream dedupe window, HMAC-signed resumable cursors, ownership-scoped `page`/`subscribe`/`cleanup`. Postgres remains the reference durable implementation (FR-7); NATS is a sibling adapter for JetStream backbones. See [agent events](docs/agent-events.md).

## Sequencing ask

FR-6 is a one-line re-export — ship it in the next patch of the 0.0.24/0.0.25 line. FR-7 is a documentation/placement answer, not code; a short note in the release notes of the next release suffices. Synapta's Phase AG-2 (server-side AG-UI) proceeds on 0.0.24 in parallel; the upgrade to the 0.0.96+ line waits on the FR-7 answer.
