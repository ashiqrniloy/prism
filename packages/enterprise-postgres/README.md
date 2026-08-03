# @arnilo/prism-enterprise-postgres

Optional PostgreSQL composition for Prism policy decisions, evaluation records, work-mutation idempotency, and model-router rate/budget/circuit state.

```bash
npm install @arnilo/prism @arnilo/prism-enterprise-postgres
```

```ts
import { Pool } from "pg";
import { createPostgresEnterpriseState } from "@arnilo/prism-enterprise-postgres";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});
const state = await createPostgresEnterpriseState({ pool, schema: "prism" });

// Existing contracts; no SQL subpath is public.
await state.policy.query({ tenantId: "tenant-1", userId: "user-1" });
await state.evaluations.query({ tenantId: "tenant-1", userId: "user-1" });
await state.cleanup({ tenantId: "tenant-1", userId: "user-1", principalId: "agent-1" });
await state.close(); // does not end caller-owned pool
await pool.end();
```

The open lifecycle validates schema configuration and applies/checks the fixed checksum-protected enterprise migration. It never starts a cleanup worker. Host owns TLS, credentials, pool sizing, backup/restore, role grants, and an authorized bounded cleanup schedule.

Work mutation state is claim-before-effect, not exactly-once: `unknown` outcomes require operator/connector reconciliation and are never auto-replayed. Durable router state requires awaited router calls with a verified identity; synchronous `providerSource` is intentionally unavailable.

Policy/work/router actions require host-verified identity; evaluation records/queries must be host-projected from verified ownership. All rows are exact tenant scoped. Prompts, raw connector/provider payloads, JWTs, and credentials are rejected/not stored.

See [Enterprise PostgreSQL state](../../docs/enterprise-postgres-state.md) for setup, migration role boundary, state transitions, limits, cleanup, and performance evidence.
