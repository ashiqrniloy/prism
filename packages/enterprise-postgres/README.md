# @arnilo/prism-enterprise-postgres

Optional PostgreSQL composition for Prism policy decisions, evaluation records, work-mutation idempotency, model-router rate/budget/circuit state, tenant-scoped ERP messaging, and multi-party approvals.

```bash
npm install @arnilo/prism @arnilo/prism-enterprise-postgres
```

```ts
import { Pool } from "pg";
import {
  createPostgresApprovalStore,
  createPostgresEnterpriseState,
} from "@arnilo/prism-enterprise-postgres";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});
const state = await createPostgresEnterpriseState({ pool, schema: "prism" });

// Existing contracts; no SQL subpath is public.
await state.policy.query({ tenantId: "tenant-1", userId: "user-1" });
await state.evaluations.query({ tenantId: "tenant-1", userId: "user-1" });

// Multi-party approvals: host-owned role authority, migration 005.
const approvals = createPostgresApprovalStore({
  pool,
  schema: "prism",
  authority: {
    policyRevision: "2026-07-23",
    async resolveRoles(actor) {
      return [{ role: "finance-approver" }];
    },
  },
});
const request = await approvals.create({
  tenantId: "tenant-1",
  requester: verifiedRequester,
  action: { kind: "invoice.release", digest: "sha256:..." },
  requirements: [{ role: "finance-approver", quorum: 2 }],
  separateFromRequester: true,
  expiresAt: "2026-07-24T00:00:00.000Z",
});
await approvals.decide({
  tenantId: "tenant-1",
  requestId: request.id,
  expectedRevision: request.revision,
  role: "finance-approver",
  actor: verifiedApprover,
  decision: "approve",
  auditRef: "audit:decide-1",
});

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("UPDATE invoices SET status = $1 WHERE tenant_id = $2 AND id = $3", ["posted", "tenant-1", "invoice-1"]);
  await state.erpMessaging.outbox.append(client, {
    tenantId: "tenant-1",
    messageId: "invoice-1:posted",
    topic: "invoice.posted",
    payload: { invoiceId: "invoice-1" },
  });
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
}

await state.cleanup({ tenantId: "tenant-1", userId: "user-1", principalId: "agent-1" });
await state.close(); // does not end caller-owned pool
await pool.end();
```

The open lifecycle validates schema configuration and applies/checks the fixed checksum-protected enterprise migration. It never starts a cleanup worker. Host owns TLS, credentials, pool sizing, backup/restore, role grants, and an authorized bounded cleanup schedule.

Work mutation state is claim-before-effect, not exactly-once: `unknown` outcomes require operator/connector reconciliation and are never auto-replayed. ERP outbox delivery is at-least-once; `dispatcher.claim()` leases bounded pages, and acknowledgement/retry/unknown transitions require claim-token plus version CAS. Dead-letter/replay requires a host-verified tenant actor and audit reference. Durable router state requires awaited router calls with a verified identity; synchronous `providerSource` is intentionally unavailable.

Approval transitions lock the request row (`FOR UPDATE`) and revision-check terminal state in one transaction; `consume` accepts a caller-owned client so grant consumption and the protected action commit (or roll back) together. Decisions require verified actors and an `auditRef`; hosts own identity verification and the role source.

Policy/work/router actions require host-verified identity; evaluation records/queries must be host-projected from verified ownership. All rows are exact tenant scoped. Prompts, raw connector/provider payloads, JWTs, and credentials are rejected/not stored.

See [Enterprise PostgreSQL state](../../docs/enterprise-postgres-state.md) for setup, migration role boundary, state transitions, limits, cleanup, and performance evidence.
