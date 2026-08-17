# Enterprise PostgreSQL state

## What it does

`@arnilo/prism-enterprise-postgres` is one optional PostgreSQL composition for existing enterprise state seams:

| State | Composition property | Durable behavior |
| --- | --- | --- |
| Policy decisions | `policy` | Append-only `PolicyDecisionStore` with owner-bound cursor pages. |
| Evaluations | `evaluations` | `EvaluationStore` append/query records with exact owner pages. |
| Work mutations | `workIdempotency` | Atomic claim/CAS lifecycle for connector effects. |
| Model routing | `modelRouter` | Shared rate, budget, and circuit state for router replicas. |
| Tool effects | `toolEffects` | Durable `ToolEffectStore` claim/CAS for recoverable tool side effects (migration 002). |
| ERP messaging | `erpMessaging` | Transactional outbox/inbox markers plus bounded, tenant-scoped at-least-once dispatch (migration 004). |
| Multi-party approvals | `createPostgresApprovalStore({ pool, schema, authority })` | Immutable approval requests, role/quorum decisions, revocation, bounded delegation, and atomic grant consumption (migration 005). |

`createPostgresEnterpriseState()` opens a host-supplied or adapter-owned `pg` pool, verifies/applies checksum-protected enterprise migrations (`001_enterprise_state`, `002_tool_effects`, `003_router_reservations`, `004_erp_messaging`, `005_erp_approvals`), and returns those stores plus explicit cleanup and close operations. Importing it performs no I/O. It is separate from session/run persistence in [`@arnilo/prism-session-store-postgres`](postgres-persistence.md).

## When to use it

Use it for a multi-process production host that needs policy/evaluation audit state, connector mutation reconciliation, or model-router limits to survive restart and coordinate across replicas.

Use memory/file stores only for tests, demos, or a deliberately single-process host. They do not provide PostgreSQL cross-replica coordination. This package is optional; it adds no database driver to `@arnilo/prism` core.

## Inputs / request

```ts
import { createPostgresEnterpriseState } from "@arnilo/prism-enterprise-postgres";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  ssl: { rejectUnauthorized: true },
});

const state = await createPostgresEnterpriseState({ pool, schema: "prism" });
```

| Input | Meaning |
| --- | --- |
| `pool` | Existing `pg` pool. Exactly one of `pool` and `connectionString` is required; caller retains pool lifecycle. |
| `connectionString` | Creates an adapter-owned pool when `pool` is omitted. |
| `schema` | Validated identifier; defaults to `"prism"`. It is never interpolated as an unchecked SQL identifier. |
| `poolMax` / `poolConfig` | Adapter-owned pool settings; maximum defaults to 10 and is capped at 100. Put TLS in `poolConfig.ssl`. |
| `skipMigrations` | Isolated-test escape hatch only. Production opens verify/apply the fixed migration before request traffic. |
| `cleanup({ tenantId, accountId?, userId?, principalId, limit?, signal? })` | Explicit exact-owner cleanup; default 100 and hard maximum 500 rows. No worker starts automatically. |

Every durable policy/work/router action starts from an active host-verified `AgentIdentity`. Evaluation records/queries must be projected by the host from that verified ownership. PostgreSQL rejects missing tenant scope; optional account/user values are normalized and matched exactly, including absence.

## Outputs / response / events

`PostgresEnterpriseState` has this public shape:

```ts
interface PostgresEnterpriseState {
  readonly policy: PolicyDecisionStore;
  readonly evaluations: EvaluationStore;
  readonly workIdempotency: IdempotencyStore;
  readonly modelRouter: ModelRouterStateStore;
  readonly toolEffects: ToolEffectStore;
  readonly erpMessaging: PostgresErpMessaging;
  cleanup(input: EnterpriseStateCleanupInput): Promise<EnterpriseStateCleanupResult>;
  close(): Promise<void>;
}
```

`close()` ends only a pool created from `connectionString`; it leaves a caller-owned pool open. `cleanup()` returns `{ removed, transitioned }`. It transitions expired work claims to `unknown` and abandoned circuit probes back to cooldown before deleting expired/idle retained state.

Work mutations expose six observable states: **absent**, `in_progress`, `completed`, `failed_retryable`, `failed_terminal`, and `unknown`. `begin()` atomically returns `acquired` or the existing record; `complete`/`fail`/`markUnknown` use claim-token plus version compare-and-swap. `unknown` requires an operator/connector-specific `resolveUnknown` decision. It is not automatically replayed and it does **not** claim exactly-once external effects.

ERP messaging exposes outbox states `pending`, `dispatched`, `retryable`, `completed`, `unknown`, and `dead_letter`. The caller owns the `pg.PoolClient` transaction: business mutation plus `erpMessaging.outbox.append(client, input)` commit or roll back together. Consumers call `erpMessaging.inbox.record(client, input)` before their local mutation in the same transaction; duplicate delivery returns `false`. `dispatcher.claim()` uses bounded `FOR UPDATE SKIP LOCKED` pages and leases. Acknowledgement, retry, and unknown transitions use claim-token plus version CAS. Expired leases become `unknown`; replay/dead-letter requires a host-verified actor and non-empty audit reference. Delivery remains at-least-once, never exactly-once.

Approvals expose request states `pending`, `approved`, `rejected`, `revoked`, and `consumed`. Immutable request data (action digest, requester, role/quorum requirements, separation flag, expiry, delegation depth) plus a monotonic `revision` and the accepted decision array live in one row. `decide`/`revoke` lock the row `FOR UPDATE` and revision-check the terminal transition in one transaction; a rejection is a terminal veto. `consume` verifies tenant, action digest, expiry, policy revision, and revision before flipping `approved` → `consumed` inside the caller-owned transaction, so grant consumption and the protected action commit (or roll back) together. Roles come from the host `ApprovalAuthority`; Prism never treats model/tool/subagent claims as principals.

Model-router state is asynchronous and owner/principal/provider/model scoped. Supplying it to `createModelRouter({ stateStore })` requires awaited `resolve`, `recordUsage`, and `recordOutcome` calls with verified identity. The legacy synchronous `providerSource` facade throws `ERR_PRISM_MODEL_ROUTER_ASYNC_STATE` when durable state is configured.

## Request/response example

```json
{
  "schema": "prism",
  "cleanup": {
    "tenantId": "tenant-1",
    "userId": "user-7",
    "principalId": "agent-9",
    "limit": 100
  },
  "result": { "removed": 12, "transitioned": 1 }
}
```

A migration creates `prism_policy_decisions`, `prism_evaluations`, `prism_work_idempotency`, three `prism_model_router_*` tables, `prism_erp_outbox`, `prism_erp_inbox`, `prism_erp_approvals`, and its separate `prism_enterprise_migrations` history. Migration `003_router_reservations` adds the nullable-by-default `reservations` JSONB column to `prism_model_router_budgets` (atomic reservation slots for router admission; 0.2.1 readers ignore it). Migration `004_erp_messaging` adds tenant/message and tenant/consumer/message primary keys plus claim, lease, and inbox indexes. Migration `005_erp_approvals` adds the one-row-per-request approval table (PK `tenant_id + id`, status check, decisions JSONB, status/created indexes). Startup serializes per-schema setup with an advisory transaction lock and rejects checksum or catalog drift rather than silently repairing it.

## Implementation example

```ts
import { createPostgresErpMessaging } from "@arnilo/prism-enterprise-postgres";

const messaging = createPostgresErpMessaging({ pool, schema: "prism" });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("UPDATE invoices SET status = $1 WHERE tenant_id = $2 AND id = $3", ["posted", tenantId, invoiceId]);
  await messaging.outbox.append(client, {
    tenantId,
    messageId: `invoice:${invoiceId}:posted`,
    topic: "invoice.posted",
    payload: { invoiceId },
  });
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
}
```

Consumer transaction uses same client:

```ts
await client.query("BEGIN");
if (await messaging.inbox.record(client, { tenantId, consumer: "ledger", messageId })) {
  await client.query("UPDATE ledger SET posted = TRUE WHERE tenant_id = $1 AND message_id = $2", [tenantId, messageId]);
}
await client.query("COMMIT");
```

Dead-letter/replay is host-authorized and auditable:

```ts
await messaging.dispatcher.replay({
  tenantId,
  messageId,
  expectedVersion,
  auditRef: "audit:erp-replay:2026-08-17T00:00:00Z",
  authorizedBy: verifiedOperatorIdentity,
});
```

```ts
import type { AgentIdentity } from "@arnilo/prism";
import { createPostgresEnterpriseState, type PostgresEnterpriseState } from "@arnilo/prism-enterprise-postgres";

const identity: AgentIdentity = {
  tenantId: "tenant-1",
  userId: "user-7",
  principal: { kind: "agent", id: "agent-9" },
  scopes: ["enterprise:write"],
  verified: true,
  issuedAt: "2026-08-03T00:00:00.000Z",
};

export async function recordEnterpriseState(state: PostgresEnterpriseState) {
  const now = new Date().toISOString();
  await state.policy.append({
    id: "policy-1",
    policyId: "mail",
    policyVersion: "2026-08-03",
    outcome: "approval",
    identity,
    target: { kind: "draft", id: "draft-1" },
    evidenceRefs: ["rule:external-recipient"],
    createdAt: now,
  });
  await state.evaluations.append({
    id: "eval-1",
    scorerId: "quality",
    status: "scored",
    score: 1,
    sampled: true,
    tenantId: identity.tenantId,
    userId: identity.userId,
    createdAt: now,
  });

  const claim = await state.workIdempotency.begin({ identity, key: "mail-send-1", op: "mail.send" });
  if (claim.outcome === "acquired") {
    // Run approved connector effect outside PostgreSQL transaction.
    await state.workIdempotency.complete({
      identity,
      key: "mail-send-1",
      op: "mail.send",
      claimToken: claim.record.claimToken!,
      expectedVersion: claim.record.version,
      result: { draftId: "draft-1", resourceId: "message-1" },
    });
  }

  await state.modelRouter.addUsage({
    key: { tenantId: "tenant-1", userId: "user-7", principalId: "agent-9", provider: "openai", model: "gpt-4.1-mini" },
    tokens: 100,
    windowMs: 86_400_000,
    now: Date.now(),
  });
  return state.cleanup({ tenantId: "tenant-1", userId: "user-7", principalId: "agent-9" });
}

// `state` comes from `await createPostgresEnterpriseState({ pool, schema: "prism" })`.
```

## Extension and configuration notes

- `createModelRouter({ resolver, stateStore: state.modelRouter })` keeps allow-list, residency, fallback, and diagnostics behavior in `@arnilo/prism-model-router`; this package only supplies durable state. Router admission reservations (`reserveBudget`/`commitBudget`/`releaseBudget` on `state.modelRouter`) live in the `reservations` JSONB column of `prism_model_router_budgets`: one atomic UPSERT per admission, fencing-token-guarded commit/release in a SERIALIZABLE transaction, and TTL reconciliation as unknown usage; see [Model routing](model-routing.md).
- `createPostgresErpMessaging({ pool, schema? })` is the direct messaging composition. `outbox.append` and `inbox.record` accept a caller-owned `PoolClient`; the host must put them in the same transaction as its local mutation. The dispatcher owns only short claim/transition transactions and never invokes business callbacks or stores executable handlers.
- `createPostgresApprovalStore({ pool, schema?, authority })` is the direct approval composition (migration 005). `authority.resolveRoles(actor, request)` and `policyRevision` are host-owned; Prism persists only accepted role grants and delegation chains. `decide`/`revoke` lock the request row and revision-check the terminal transition in one transaction. `consume` accepts an optional caller-owned `client`; grant consumption and the protected action commit (or roll back) together.
- Rate/budget/circuit tables are capped like the memory store: `consumeRate`/`readBudget`/`addUsage`/`reserveBudget` accept `maxRateKeys`/`maxBudgetKeys` (the router passes its resolved limits) and evict the least-recently-used row on new-key insert — never the row just inserted, never a budget row holding an active reservation — else fail closed with `ERR_PRISM_MODEL_ROUTER_STATE`. Cleanup prunes expired reservations within its bounded batch.
- Policy/evaluation/query public contracts stay in their owning packages. This package exports `createPostgresEnterpriseState`, `createPostgresApprovalStore`, `createPostgresErpMessaging`, their options/result/types, and `EnterprisePostgresError`; it has no SQL, DDL, codec, queryable, or migration subpath.
- The fixed schema has no generic key/value table and no background cleanup scheduler. Schedule `state.cleanup()` from an authorized host job, size its bounded batch for the deployment, and monitor unknown work rows for reconciliation. Run protected integration checks with `PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres`; the command rejects an absent URL instead of silently skipping database coverage.
- The OPA adapter (`@arnilo/prism-policy/opa`, 0.0.28) records decisions into the same `state.policy` store unchanged via `evaluateAndAppend` — see [Policy and audit](policy-and-audit.md#opa-external-policy-adapter-arniloprism-policyopa-008).
- Request-path state SQL uses `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on the eight state tables. The open/migration lifecycle additionally needs schema/catalog/advisory-lock and DDL permissions. Use a deployment migration principal for that lifecycle and a least-privilege request role for request traffic; this release intentionally does not ship a migration CLI or worker.

## Security and performance notes

- Configure TLS, database credentials, pool timeouts, backups, restore drills, retention schedule, and database role grants in the host. Never put connection strings, tokens, prompts, raw connector responses, unrestricted payloads, or provider credentials in records.
- Every value is a bound parameter. Schema identifiers are validated; table/index names are fixed. Cursors embed and recheck ownership, so a foreign tenant cannot reuse a page cursor.
- Policy records cap at 64 KiB; evaluations at 64 KiB; work rows at 8 KiB; router material at 512 bytes. JSON rejects prototype-pollution keys, non-finite values, excess depth/properties, and over-size material.
- PostgreSQL transaction SQLSTATE `40001`/`40P01` retries whole safe transactions up to three times. Connector effects remain outside those transactions and ambiguous errors become `unknown` rather than being retried.
- ERP claim pages are tenant-scoped and bounded at 1,000 rows; default batch is 100, lease TTL is 30 seconds with a 5-minute hard cap, and retry attempts are capped at 10. Protected PostgreSQL evidence measured 1,000 queued rows per tenant across 10 tenants at p50 5.999 ms / p95 7.827 ms / p99 8.066 ms for 100-row claims; the representative plan used `prism_erp_outbox_claim_idx` with no sequential scan. This is comparison evidence, not a hardware-independent guarantee.
- Recorded `postgres:16-alpine` evidence (Node 24.18.0/Linux x64, 10 tenants × 10 principals × 1,000 policy/evaluation rows, 10,000 router keys, 16 clients) stayed below 50 ms p95 for point operations and 100 ms for cursor/cleanup pages. The highest recorded p95 was router-circuit contention at 28.410 ms. Fourteen representative `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` shapes used named indexes with no sequential scans. These are recorded comparison evidence, not hardware-independent guarantees.

## Related APIs

- [Policy and audit](policy-and-audit.md): policy record and WORM export semantics.
- [Evaluations](evaluations.md): scorer/evaluation record lifecycle.
- [Work tools](work-tools.md): draft approval, unknown outcomes, and connector boundaries.
- [Model routing](model-routing.md): durable asynchronous router migration.
- [PostgreSQL persistence](postgres-persistence.md): sessions/runs/checkpoints/leases adapter.
- [Database persistence](database-persistence.md): host retention and persistence guidance.
- [Host security](host-security.md): database ownership, TLS, secrets, and role boundaries.
- [Migration guide](migration.md): 0.0.22 → 0.0.23 upgrade steps.
