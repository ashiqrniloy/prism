# @arnilo/prism-core

Unified core runtime, sessions, governance, credentials, enterprise persistence, and work integration family package for Prism.

## Installation

```bash
npm install @arnilo/prism @arnilo/prism-core
```

For persistence, install the required optional database driver peer:

```bash
# SQLite sessions & prompt storage
npm install better-sqlite3

# PostgreSQL sessions, enterprise persistence & prompt storage
npm install pg

# NATS distributed event stream
npm install @nats-io/jetstream @nats-io/transport-node
```

## Subpath Imports

### Runtime
- `@arnilo/prism-core/runtime/server`: HTTP server handler, SSE streaming, artifact delivery, replay, webhook delivery.
- `@arnilo/prism-core/runtime/supervisor`: Agent-to-Agent (A2A) protocol server, client, event source, and multi-agent supervisor.
- `@arnilo/prism-core/runtime/workflows`: Multi-step DAG workflow coordinator, saga recovery, checkpoints, and loop nodes.

### Sessions
- `@arnilo/prism-core/sessions/codecs`: Checkpoint, cursor, feedback, and search serialization codecs.
- `@arnilo/prism-core/sessions/sqlite`: SQLite session store, leases, lifecycle, and schema migrations (`better-sqlite3` peer).
- `@arnilo/prism-core/sessions/postgres`: PostgreSQL session store, event source, and migrations (`pg` peer).
- `@arnilo/prism-core/sessions/nats`: NATS JetStream distributed event source (`@nats-io/*` peer).

### Governance
- `@arnilo/prism-core/governance/policy`: Capability admission, tool execution approvals, audit log exporter, and OPA evaluator.
- `@arnilo/prism-core/governance/evals`: Offline evaluation runs, scorers, judges, threshold assertions, and trace curation.
- `@arnilo/prism-core/governance/prompts`: Versioned prompt registry, promotion gating, rollback, and storage (`better-sqlite3` / `pg`).
- `@arnilo/prism-core/governance/model-router`: Cost- and latency-aware model routing, token reservations, and failover.
- `@arnilo/prism-core/governance/observability`: OpenTelemetry instrumentation and event tracing.

### Credentials & Integrations
- `@arnilo/prism-core/credentials/node`: Keyring-backed encrypted credential store, scrypt envelope encryption, OAuth2 PKCE providers, and OIDC identity verification.
- `@arnilo/prism-core/enterprise/postgres`: Unified multi-tenant enterprise PostgreSQL state (approvals, evaluations, model-router, policy, tool effects, work idempotency).
- `@arnilo/prism-core/integrations/work`: Microsoft 365 and Google Workspace CLI tool adapters with approval gates and idempotency.
- `@arnilo/prism-core/validation/json-schema`: Ajv-backed JSON Schema tool argument validation.

## License

MIT
