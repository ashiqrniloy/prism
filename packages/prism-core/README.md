# @arnilo/prism-core

Unified core runtime, sessions, governance, credentials, and enterprise persistence family package for Prism.

## Installation

```bash
bun add @arnilo/prism @arnilo/prism-core
```

SQLite persistence uses the Bun runtime's built-in `bun:sqlite`. No package to install.

For PostgreSQL, install the optional peer:

```bash
# PostgreSQL sessions, enterprise persistence & prompt storage
bun add pg

# NATS distributed event stream
bun add @nats-io/jetstream @nats-io/transport-node
```

## Subpath Imports

### Runtime
- `@arnilo/prism-core/runtime/server`: HTTP server handler, SSE streaming, artifact delivery, replay, webhook delivery.
- `@arnilo/prism-core/runtime/realtime`: Governed realtime voice bridge (device admit, host tool dispatch, barge-in, reconnect).
- `@arnilo/prism-core/runtime/supervisor`: Agent-to-Agent (A2A) protocol server, client, event source, and multi-agent supervisor.
- `@arnilo/prism-core/runtime/workflows`: Multi-step DAG workflow coordinator, saga recovery, checkpoints, and loop nodes.

### Sessions
- The durable session stores moved out of this package in plan 153: install `@arnilo/prism-store-sqlite`
  (which depends on `@arnilo/prism-store-codecs`) or `@arnilo/prism-store-postgres` for the SQLite and
  PostgreSQL stores, their leases, lifecycle, event sources, and schema migrations. This package keeps the
  `pg` peer for `enterprise/postgres` and the prompt registry, and never names a store driver itself.
- `@arnilo/prism-core/sessions/nats`: NATS JetStream distributed event source (`@nats-io/*` peer).

### Governance
- `@arnilo/prism-core/governance/policy`: Capability admission, tool execution approvals, audit log exporter, and OPA evaluator.
- `@arnilo/prism-core/governance/evals`: Offline evaluation runs, scorers, judges, threshold assertions, and trace curation.
- `@arnilo/prism-core/governance/prompts`: Versioned prompt registry, promotion gating, rollback, and storage (`bun:sqlite` / `pg`).
- `@arnilo/prism-core/governance/model-router`: Cost- and latency-aware model routing, token reservations, and failover.
- `@arnilo/prism-core/governance/observability`: OpenTelemetry instrumentation and event tracing.

### Credentials & Integrations
- `@arnilo/prism-core/credentials/node`: OAuth2 PKCE providers, workload scope maps, the Microsoft 365 / Google Workspace providers, the work-token helper, and OIDC identity verification. The credential stores (OS keyring, encrypted file) now ship in `@arnilo/prism-credentials-keyring`.
- `@arnilo/prism-core/enterprise/postgres`: Unified multi-tenant enterprise PostgreSQL state (approvals, evaluations, model-router, policy, tool effects, work idempotency).
- `@arnilo/prism-core/validation/json-schema`: Ajv-backed JSON Schema tool argument validation.

## License

MIT
