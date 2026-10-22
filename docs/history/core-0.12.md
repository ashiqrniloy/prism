# Core Runtime, Sessions, and Governance (@arnilo/prism-core)

The `@arnilo/prism-core` family package unifies Prism's privileged runtime, sessions, governance, credentials, enterprise persistence, and work integrations into explicit, import-isolated subpaths.

## Installation

```bash
bun add @arnilo/prism @arnilo/prism-core
```

SQLite persistence uses the Bun runtime's built-in `bun:sqlite`. No package to install.

For PostgreSQL and distributed event streams, install the optional peer:

```bash
# PostgreSQL sessions, enterprise persistence & prompt storage
bun add pg

# NATS JetStream distributed event source
bun add @nats-io/jetstream @nats-io/transport-node
```

Every peer below is optional and fails closed at first use; the [optional peer dependencies](peer-dependencies.md) matrix lists the exact ranges, pins, and which of them reach the network.

## Subpaths Map

| Subpath | Description | Optional Peers |
|---|---|---|
| `@arnilo/prism-core/runtime/server` | HTTP server handler, SSE streaming, artifact delivery, replay, webhook delivery | — |
| `@arnilo/prism-core/runtime/supervisor` | Agent-to-Agent (A2A) protocol server, client, event source, and multi-agent supervisor | — |
| `@arnilo/prism-core/runtime/workflows` | Multi-step DAG workflow coordinator, saga recovery, checkpoints, and loop nodes | — |
| `@arnilo/prism-core/sessions/codecs` | Checkpoint, cursor, feedback, and search serialization codecs | — |
| `@arnilo/prism-core/sessions/sqlite` | SQLite session store, leases, lifecycle, and schema migrations | — (`bun:sqlite`, built in) |
| `@arnilo/prism-core/sessions/postgres` | PostgreSQL session store, event source, and migrations | `pg` |
| `@arnilo/prism-core/sessions/nats` | NATS JetStream distributed event source | `@nats-io/jetstream`, `@nats-io/transport-node` |
| `@arnilo/prism-core/governance/policy` | Capability admission, tool execution approvals, audit log exporter, and OPA evaluator | — |
| `@arnilo/prism-core/governance/evals` | Offline evaluation runs, scorers, judges, threshold assertions, and trace curation | — |
| `@arnilo/prism-core/governance/prompts` | Versioned prompt registry, promotion gating, rollback, and storage | `pg` (SQLite is `bun:sqlite`) |
| `@arnilo/prism-core/governance/model-router` | Cost- and latency-aware model routing, token reservations, and failover | — |
| `@arnilo/prism-core/governance/observability` | OpenTelemetry instrumentation and event tracing | `@opentelemetry/api` |
| `@arnilo/prism-core/credentials/node` | Keyring-backed encrypted credential store, scrypt envelope encryption, OAuth2 PKCE providers, and OIDC identity verification | `@napi-rs/keyring` (bundled) |
| `@arnilo/prism-core/enterprise/postgres` | Unified multi-tenant enterprise PostgreSQL state (approvals, evaluations, model-router, policy, tool effects, work idempotency) | `pg` |
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

- Subpaths never load the `pg` driver unless the specific database subpath is imported. SQLite uses the runtime's `bun:sqlite`, not a package.
- All database and network drivers fail closed with clear actionable error messages when peers are omitted.
- Root `@arnilo/prism` remains dependency-free contracts and CLI runner.
- Messaging channels are `@arnilo/prism-channels` (`/telegram`, `/signal`), not a `@arnilo/prism-core` subpath.
