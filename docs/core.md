# Core Runtime, Sessions, and Governance (@arnilo/prism-core)

The `@arnilo/prism-core` family package unifies Prism's privileged runtime, sessions, governance, credentials, enterprise persistence, and work integrations into explicit, import-isolated subpaths.

## Installation

```bash
npm install @arnilo/prism @arnilo/prism-core
```

For database persistence and distributed event streams, install the required optional peer dependencies:

```bash
# SQLite sessions & prompt storage
npm install better-sqlite3

# PostgreSQL sessions, enterprise persistence & prompt storage
npm install pg

# NATS JetStream distributed event source
npm install @nats-io/jetstream @nats-io/transport-node
```

## Subpaths Map

| Subpath | Description | Optional Peers |
|---|---|---|
| `@arnilo/prism-core/runtime/server` | HTTP server handler, SSE streaming, artifact delivery, replay, webhook delivery | — |
| `@arnilo/prism-core/runtime/supervisor` | Agent-to-Agent (A2A) protocol server, client, event source, and multi-agent supervisor | — |
| `@arnilo/prism-core/runtime/workflows` | Multi-step DAG workflow coordinator, saga recovery, checkpoints, and loop nodes | — |
| `@arnilo/prism-core/sessions/codecs` | Checkpoint, cursor, feedback, and search serialization codecs | — |
| `@arnilo/prism-core/sessions/sqlite` | SQLite session store, leases, lifecycle, and schema migrations | `better-sqlite3` |
| `@arnilo/prism-core/sessions/postgres` | PostgreSQL session store, event source, and migrations | `pg` |
| `@arnilo/prism-core/sessions/nats` | NATS JetStream distributed event source | `@nats-io/jetstream`, `@nats-io/transport-node` |
| `@arnilo/prism-core/governance/policy` | Capability admission, tool execution approvals, audit log exporter, and OPA evaluator | — |
| `@arnilo/prism-core/governance/evals` | Offline evaluation runs, scorers, judges, threshold assertions, and trace curation | — |
| `@arnilo/prism-core/governance/prompts` | Versioned prompt registry, promotion gating, rollback, and storage | `better-sqlite3`, `pg` |
| `@arnilo/prism-core/governance/model-router` | Cost- and latency-aware model routing, token reservations, and failover | — |
| `@arnilo/prism-core/governance/observability` | OpenTelemetry instrumentation and event tracing | `@opentelemetry/api` |
| `@arnilo/prism-core/credentials/node` | Keyring-backed encrypted credential store, scrypt envelope encryption, OAuth2 PKCE providers, and OIDC identity verification | `@napi-rs/keyring` (bundled) |
| `@arnilo/prism-core/enterprise/postgres` | Unified multi-tenant enterprise PostgreSQL state (approvals, evaluations, model-router, policy, tool effects, work idempotency) | `pg` |
| `@arnilo/prism-core/integrations/work` | Microsoft 365 and Google Workspace CLI tool adapters with approval gates and idempotency | — |
| `@arnilo/prism-core/validation/json-schema` | Ajv-backed JSON Schema tool argument validation | `ajv` (bundled) |

## Usage Examples

### Workflow Runtime
```ts
import { createWorkflowCoordinator, defineWorkflow, functionNode } from "@arnilo/prism-core/runtime/workflows";

const wf = defineWorkflow({
  name: "order-processing",
  initial: "validate",
  nodes: {
    validate: functionNode(async ({ input }) => ({ next: "process", output: input })),
  },
});
```

### Policy & Approvals
```ts
import { createMemoryApprovalStore, evaluateApproval } from "@arnilo/prism-core/governance/policy";

const approvals = createMemoryApprovalStore();
```

### SQLite Sessions
```ts
import { createSqlitePersistence } from "@arnilo/prism-core/sessions/sqlite";

const persistence = createSqlitePersistence({ filename: "./prism.db" });
```

### JSON Schema Validation
```ts
import { createJsonSchemaToolArgumentValidator } from "@arnilo/prism-core/validation/json-schema";

const validator = createJsonSchemaToolArgumentValidator();
```

## Security & Import Isolation

- Subpaths never load database drivers (`pg`, `better-sqlite3`) unless the specific database subpath is imported.
- All database and network drivers fail closed with clear actionable error messages when peers are omitted.
- Root `@arnilo/prism` remains dependency-free contracts and CLI runner.
