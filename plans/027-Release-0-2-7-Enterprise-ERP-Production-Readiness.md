# Release 0.2.7 — Enterprise ERP Production Readiness

## Objectives

- Deliver durable ERP state primitives for transactional messaging, compensation, approvals, audit export, secret resolution, HA recovery, and disaster recovery without adding another agent runtime.
- Make field-level classification and redaction explicit at every outbound, persistence, telemetry, and export boundary, with fail-closed defaults.
- Exercise the complete protected ERP journey through existing identity, policy, budget, workflow, supervisor, eval, Postgres, lifecycle, and observability primitives.
- Document atomicity, retry, recovery, tenant, and operator invariants without claiming exactly-once delivery.
- Keep the package graph at 50 packages, add no runtime dependencies unless Task 0 records measured need, and preserve existing public APIs through additive changes.
- Produce reproducible release evidence while keeping the overall “ERP production ready” claim blocked until the 0.3.0 live-service matrix is recorded.

## Expected Outcome

Release 0.2.7 provides at-least-once, idempotency-aware ERP messaging; durable compensating workflows; quorum and separation-of-duties approvals; signed, hash-chained audit exports; explicit secret-manager credential sources; multi-replica recovery evidence; restore and rollback drills; and policy-driven field handling. One protected journey proves these pieces compose under duplicate delivery, crash recovery, revocation, legal hold, failover, and restore. Deterministic evals score the resulting invariants. No component claims exactly-once execution, no model or subagent can grant authorization, and no credential adapter reads ambient process environment implicitly.

## Primitive Review and Scope Freeze

Task 0 is a mandatory stop/go gate. Implementation tasks may begin only after it records demand, current primitive coverage, threat mappings, budgets, and exact API deltas. Default decisions:

- Reuse `CheckpointStore`, `LeaseStore`, `ConversationStore`, lifecycle records, workflow orchestration, supervisor correlation, policy audit records, `CredentialResolver`, Postgres migration machinery, and eval datasets/scorers.
- Add no generic “ERP framework,” event bus, second workflow engine, cloud SDK, global registry, or exactly-once abstraction.
- Place generic contracts in their existing owning packages and Postgres implementations in `@arnilo/prism-enterprise-postgres`.
- Keep local active-run maps as optimizations only; correctness must come from durable state, compare-and-swap revisions, leases, and idempotency keys.
- Treat subagents as bounded workers. Verified host identity and policy decide authorization; subagent output never counts as approval evidence.
- Demand-gate Vault/AWS/Azure/GCP adapters independently. A provider with no recorded consumer and credential shape remains documentation, not code.

## Threat Model

| ID | Threat | Required control and evidence |
| --- | --- | --- |
| ERP-T1 | Business mutation commits without outbound intent, or intent exists without mutation | Caller-owned Postgres transaction writes business row and outbox row atomically; rollback and crash tests inspect both. |
| ERP-T2 | Duplicate, reordered, or poison delivery causes repeated business effects | Stable message/idempotency keys, transactional inbox marker, bounded claims, retry/dead-letter state, and no exactly-once claim. |
| ERP-T3 | Compensation runs twice, out of order, or after forward progress resumes | Durable step ledger, lease fencing, reverse completed-step order, idempotent compensation keys, and manual-intervention terminal state. |
| ERP-T4 | Requester self-approves, quorum is forged, delegation exceeds authority, or stale approval survives expiry/revocation | Verified principal IDs, role/quorum policy, requester/approver separation, atomic revision checks, bounded delegation, expiry, revocation, and provenance. |
| ERP-T5 | Audit records are deleted, reordered, truncated, cross-tenant, ambiguously serialized, or signed by hidden key material | Canonical bytes, hash chain, signed manifest, tenant/legal-hold boundaries, explicit signer callback, WORM acknowledgement, and independent verification. |
| ERP-T6 | Secret adapter reads ambient credentials, leaks values, follows unsafe redirects, or accepts unbounded responses | Explicit credential source, injected authenticated client/fetch, pinned egress policy, bounded body/time, redaction, zero secret logging, and no implicit `process.env`. |
| ERP-T7 | Two replicas own one lease, stale owner commits, durable cursor regresses, or local registry loss prevents recovery | Fencing token/revision checks, monotonic cursor CAS, durable cancellation/status, two-replica kill tests, and split-brain rejection. |
| ERP-T8 | Backup is unusable, migration rollback destroys data, or stated RPO/RTO has no evidence | Versioned restore drill, checksum/count validation, forward/rollback rehearsal, PITR evidence, recorded timings, and protected-profile gate. |
| ERP-T9 | Unknown or mislabeled field escapes through prompt, tool, artifact, audit, telemetry, or export | Explicit field policy, deny/redact defaults, recursive bounded traversal, tenant ownership checks, and leak canaries across every boundary. |
| ERP-T10 | Legal hold is bypassed, tenant data crosses boundaries, or subagent/eval machinery becomes an authorization path | Durable hold checks, tenant-scoped keys/queries, verified approval actors, deterministic invariant scorers, and negative journey cases. |

## Operational Ownership

| Surface | Primary owner | Required runbook/evidence |
| --- | --- | --- |
| Outbox/inbox and dead letters | ERP application + database operations | Queue depth/age, retry/dead-letter triage, replay by idempotency key, schema migration. |
| Saga reconciliation | ERP application owner | Stuck-step query, safe retry, compensation failure escalation, manual resolution provenance. |
| Approval policy | Security/governance owner | Role/quorum changes, delegation review, expiry/revocation, break-glass prohibition and audit. |
| Audit export and legal hold | Compliance owner | Key rotation, chain verification, sink outage, WORM retention, SIEM replay, tenant export. |
| Secret adapters | Platform security owner | Auth/bootstrap, rotation, endpoint allowlist, outage behavior, leak incident response. |
| HA state and failover | SRE owner | Lease contention, stale owner fencing, replica termination, cursor repair prohibition. |
| Backup/restore/migrations | Database operations owner | Backup cadence, RPO/RTO, PITR, restore validation, rollback decision tree. |
| Classification/redaction | Data governance owner | Label taxonomy, policy review, unknown-field behavior, tenant and legal-hold exceptions. |
| Release journey/evals | Release owner | Protected environment, evidence manifest, invariant thresholds, 0.3.0 blocker statement. |

## Migration and Compatibility Constraints

- All runtime API changes are additive in 0.2.7. Existing callers retain current behavior unless they explicitly configure ERP/classification features.
- New Postgres migrations use the existing migration lock, checksum, namespace, and forward-only production path. Rollback is a rehearsed operator procedure, not an automatic destructive downgrade.
- Persisted records carry explicit schema/revision fields. Readers reject unsupported future revisions rather than guessing.
- Existing workflow, ACP, conversation, lifecycle, and policy records remain readable. New saga/approval/outbox records use separate keys/tables rather than silently reinterpreting old records.
- Release metadata remains synchronized at exact `0.2.7` versions across all 50 packages under current repository policy.
- The 0.3.0 live-service matrix remains a hard blocker on the overall production-ready claim even when every task below passes.

## Package and Performance Budgets

- Package count: remain exactly 50.
- Runtime dependencies: add zero by default; use Node 20 `node:crypto`, existing `pg`, existing fetch/egress primitives, and host-supplied cloud clients.
- Outbox/inbox: claim query is indexed and bounded; 1,000-row backlog p95 claim latency under 100 ms in protected Postgres evidence; no unbounded scan.
- Saga/approval: every mutation is revision-checked; 100-step saga and 100-actor approval record remain bounded; no recursive retry loop.
- Audit export: streaming/page-bounded processing with at most 10 MiB or 1,000 records resident per batch; deterministic verification.
- Classification: maximum depth/key/byte limits; benchmarked overhead under 10% on representative prompt/tool/artifact payloads.
- HA: bounded lease acquisition/retry; failover resumes within configured lease TTL plus 5 seconds in the protected drill.
- Restore: measured RPO/RTO are recorded, not invented. Missed targets block task completion.

## Tasks

### 0. [x] Freeze primitives, demand, invariants, threat mappings, and release budgets

**Acceptance Criteria**

- **Functional:** Inventory maps each roadmap requirement to an existing primitive, exact gap, owner, and intended file; records real consumers for every candidate secret-manager adapter; freezes transactional, retry, compensation, approval, audit, classification, failover, backup, and protected-journey invariants.
- **Performance:** Baseline captures package count, runtime dependency count, full test/typecheck timing, Postgres throughput/latency, classification payload sizes, lease TTL, backup size/time, and explicit release ceilings.
- **Code quality:** No implementation begins before scope review; rejected abstractions and duplicate primitives are listed; public API additions are minimal and package ownership is explicit.
- **Security:** Every `ERP-T*` threat maps to at least one negative test and operator control; trust boundaries identify verified identity, tenant, key, secret, sink, database, and subagent ownership.

**Approach**

1. Review `roadmap.md`, this plan, `packages/*/package.json`, package exports, current Postgres migrations, workflow/checkpoint/lease contracts, policy approvals/audit/lifecycle, credentials, supervisor, evals, and protected profiles.
2. Run the repository npm equivalents (`npm run build`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run test:coverage`, `npm run security:threat-suites`, budget gate, audit, secret scan, and package-truth checks). Record commands, environment identity, commit, timings, protected skips, and failures in `docs/release-0.2.7-evidence.md`. `pnpm verify` is unavailable because pnpm is not installed and no pnpm workspace exists.
3. Search for all process-local active registries and every caller of durable state APIs. Mark each registry as correctness-critical or optimization-only; Task 6 must remove correctness dependence.
4. Inspect checked-in consumers and explicit credential contracts for Vault, AWS Secrets Manager, Azure Key Vault, and GCP Secret Manager separately. Task 0 recorded all four as deferred: no named deployment consumer, secret shape, auth/bootstrap owner, or protected test path exists. Implement only a demanded adapter; absence is a recorded stop decision.
5. Freeze API sketches and persistence ownership. Prefer existing contracts and tables; reject a new event bus, generic state manager, second agent/workflow runtime, cloud SDK dependency, implicit credential discovery, and exactly-once terminology.
6. Define atomicity boundaries explicitly: Prism can atomically coordinate only writes sharing the caller-owned Postgres transaction. Remote delivery and compensation remain at-least-once.
7. Define eval dataset rows for duplicate delivery, crash windows, compensation, quorum, revocation, audit tamper, secret failure, split brain, restore, classification leak, legal hold, and subagent authority denial.

**API Notes / Examples**

```ts
const messaging = createPostgresErpMessaging({ pool });
await messaging.outbox.append(client, { tenantId, messageId, topic, payload });
const inserted = await messaging.inbox.record(client, { tenantId, consumer, messageId });

const definition = defineSaga({ sagaId, tenantId, steps });
await runSaga(definition, { input });
const approvals = createPostgresApprovalStore({ pool });
await approvals.decide({ requestId, revision, actor: verifiedIdentity, decision: "approve" });
const exporter = createAuditExporter({ signer, sinks });
await exporter.export({ tenantId, cursor, legalHoldId });
```

- Existing references: `src/contracts-core/persistence.ts`, `packages/enterprise-postgres/src`, `packages/workflows/src`, `packages/policy/src`, `packages/credentials-node/src`, `packages/supervisor/src`, `packages/evals/src`, `docs/_evidence/phase22-primitive-review.md`, `docs/_evidence/phase26-primitive-review.md`.
- External references: PostgreSQL transaction isolation and explicit locking; PostgreSQL backup/PITR; NIST SP 800-53 Rev. 5 AC-5 separation of duties; RFC 8785 canonical JSON; Node 20 `node:crypto`.
- Create: `docs/release-0.2.7-evidence.md`, `scripts/phase27-freeze-manifest.json`, `scripts/phase27-freeze.test.mjs`.
- Edit: `plans/027-Release-0-2-7-Enterprise-ERP-Production-Readiness.md`, `docs/index.md`, `package.json`.

**Test Cases to Write First**

- `node --test scripts/phase27-freeze.test.mjs` fails when release/task state, package budget, demand decision, threat mapping, API ownership, protected-gate policy, or 0.3.0 blocker is missing.
- Package graph checks fail if package count or runtime dependency budget changes without an approved Task 0 exception.
- API ownership review fails if a proposed contract duplicates an existing exported primitive.

**Documentation/Wiki Assessment**

- Public API impact: none in this task; it freezes later additions.
- Add evidence navigation from `docs/index.md`; do not add package API docs until an implementation task exports code.
- Record reviewed documentation, options, rejected abstractions, demand decisions, and source links in the evidence document.

**Completion Evidence**

- Evidence: `docs/release-0.2.7-evidence.md`.
- Machine-readable freeze: `scripts/phase27-freeze-manifest.json`.
- Contract checks: `scripts/phase27-freeze.test.mjs`.
- Baseline: build/typecheck/lint/format, coverage, threat suites, package truth, audit, and secret scan passed; protected PostgreSQL/NATS/live-provider/backup legs remain blocked or unmeasured as recorded.
- Full-suite note: one pre-freeze baseline run passed (`3,716` tests, `3,683` pass, `33` skips); a rerun exposed a pre-existing intermittent browser fixture failure (`downloads=0; released=false`), while the focused fixture passed 3/3. The new Task 0 contract passes 6/6 separately. This is a Task 10 release-gate follow-up, not an ERP Task 0 implementation failure.
- Scope decision: all four secret-manager adapters are demand-deferred; no new package, runtime dependency, migration, or public API was added by Task 0.

---

### 1. [x] Add transactional outbox/inbox state and bounded dispatch recovery

**Acceptance Criteria**

- **Functional:** Caller can write business state plus outbox intent in one Postgres transaction; consumers can write an inbox dedupe marker plus local business mutation in one transaction; dispatch supports bounded claim, lease, acknowledgement, retry, unknown outcome, and dead-letter states with stable tenant/message keys.
- **Performance:** Indexed claim uses `FOR UPDATE SKIP LOCKED`, honors configurable batch size, and meets the protected 1,000-row backlog p95 target without table scans.
- **Code quality:** One additive Postgres migration and one focused API surface reuse existing pool, migration, clock, and observability conventions; docs say at-least-once and never exactly-once.
- **Security:** Every query is tenant-scoped and parameterized; payload limits and classification policy apply before persistence/export; dead-letter/replay actions require explicit authorization and audit provenance.

**Approach**

1. Write conformance tests against real Postgres before implementation, including two workers, transaction rollback, crash-after-remote-send, stale lease, duplicate message, and tenant collision.
2. Add migration `004_erp_messaging` through the existing `buildEnterpriseMigration004Ddl` builder with outbox/inbox tables, tenant/message and tenant/consumer/message primary keys, state checks, revision/fencing columns, bounded indexes, timestamps, attempts, next-attempt, and last-error metadata. Do not store executable callbacks.
3. Export a focused ERP messaging adapter from `@arnilo/prism-enterprise-postgres`. Accept a caller-owned `pg.PoolClient` for atomic append/record operations; use the package pool only for worker claim/ack transitions.
4. Claim with one short database transaction and `SKIP LOCKED`; execute remote delivery outside the transaction; acknowledge using claim token/revision. A crash after remote send produces retry/unknown outcome, resolved by downstream idempotency—not an exactly-once assertion.
5. Bound payload bytes, batch size, attempts, lease duration, and error text. Move exhausted entries to explicit dead-letter state; never silently drop.
6. Emit existing observability events for depth, oldest age, claim, retry, unknown, dead letter, and replay without payload or secret content.

**API Notes / Examples**

```ts
await pool.connect().then(async (client) => {
  try {
    await client.query("BEGIN");
    await client.query("UPDATE invoices SET status = $1 WHERE tenant_id = $2 AND id = $3", ["posted", tenantId, invoiceId]);
    await messaging.outbox.append(client, { tenantId, messageId, topic: "invoice.posted", payload });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

await pool.connect().then(async (client) => {
  try {
    await client.query("BEGIN");
    const first = await messaging.inbox.record(client, { tenantId, consumer: "ledger", messageId });
    if (first) await applyLedgerMutation(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

await messaging.dispatcher.replay({
  tenantId,
  messageId,
  expectedVersion,
  auditRef: "audit:erp-replay:2026-08-17",
  authorizedBy: verifiedOperatorIdentity,
});
```

- Existing references: `packages/enterprise-postgres/src/ddl.ts`, `src/migrations.ts`, `src/enterprise.ts`, `src/types.ts`, `src/records.ts`, existing `tool-effects.ts`, and migration/package integration tests.
- Documentation references: `packages/enterprise-postgres/README.md`, `docs/enterprise-postgres-state.md`, `docs/index.md`.
- PostgreSQL references reviewed via Context7 `/websites/postgresql_current`: `SELECT ... FOR UPDATE SKIP LOCKED`, `UPDATE ... RETURNING`, and `ROLLBACK`; official URLs remain in the evidence document.
- Create: `packages/enterprise-postgres/src/erp-messaging.ts`, `packages/enterprise-postgres/src/__tests__/erp-messaging.integration.test.ts`.
- Edit: `packages/enterprise-postgres/src/ddl.ts`, `src/migrations.ts`, `src/types.ts`, `src/enterprise.ts`, `src/index.ts`, migration/package tests, `packages/enterprise-postgres/README.md`, `docs/enterprise-postgres-state.md`, `docs/index.md`, `docs/release-0.2.7-evidence.md`.

**Test Cases to Write First**

- Business update and outbox append both roll back after forced transaction failure.
- Duplicate inbox insert returns false and does not repeat local mutation.
- Two workers cannot own one claim; stale token cannot acknowledge or dead-letter.
- Crash after simulated send retries with same message/idempotency key.
- Tenant A cannot claim, acknowledge, replay, or inspect tenant B rows.
- Payload, batch, attempt, and error-text limits fail deterministically.
- Protected benchmark records query plan and p50/p95 for 1,000 queued rows.

**Documentation/Wiki Assessment**

- Public API impact: additive export from `@arnilo/prism-enterprise-postgres`.
- Updated package README/API docs and existing `docs/enterprise-postgres-state.md`; `docs/index.md` entry now names ERP messaging and migration 004. No new docs page was needed because the existing enterprise PostgreSQL page owns this package.
- Recorded migration, transaction, dead-letter/replay ownership, failure semantics, metrics, query plan, and protected performance evidence in `docs/release-0.2.7-evidence.md`.

**Completion Evidence**

- `npm run build --workspace @arnilo/prism-enterprise-postgres`: pass.
- `npm run test --workspace @arnilo/prism-enterprise-postgres`: pass; unconfigured protected suites skip as designed.
- `PRISM_TEST_POSTGRES_URL=... npm run test:postgres --workspace @arnilo/prism-enterprise-postgres`: pass; 37 tests, 0 failures, 0 skips on PostgreSQL 16-alpine.
- Full `npm test`: pass; 3,722 tests, 3,689 pass, 33 protected skips, 0 failures.
- ERP integration coverage: caller transaction rollback, idempotent/conflicting append, duplicate inbox marker, concurrent `SKIP LOCKED` claims, stale claim fencing, retry, unknown/replay, dead-letter, expired lease recovery, tenant isolation, payload/audit bounds, and claim-index plan.
- Protected benchmark: 10 tenants × 1,000 queued rows, 30 samples, batch 100; p50 5.999 ms, p95 7.827 ms, p99 8.066 ms; no sequential scan; frozen p95 `<100 ms` passed.
- Migration 004 is additive; no package/dependency added; external delivery remains at-least-once.
- `npm run security:threat-suites`: pass, 50/50; `npm audit --audit-level=moderate`: 0 vulnerabilities; secret scan: 0 findings.

---

### 2. [x] Add durable saga compensation and reconciliation on existing state primitives

**Acceptance Criteria**

- **Functional:** A bounded ordered saga persists forward and compensation progress, resumes after process loss, compensates completed steps in reverse order, reconciles unknown outcomes, and reaches completed, compensated, or manual-intervention terminal state.
- **Performance:** State size and work are bounded by configured step count/attempts; a 100-step recovery performs no unbounded scan and resumes from checkpoint rather than replaying confirmed steps.
- **Code quality:** Reuse `CheckpointStore`, `LeaseStore`, retry policy, and workflow observability; add no second scheduler, queue, or agent runtime; definitions remain host code while records persist only stable IDs/revisions/data.
- **Security:** Tenant/saga keys are isolated; stale lease holders cannot commit; compensation inputs pass classification/redaction; manual resolution requires verified actor, reason, revision, and audit record.

**Approach**

1. Model the minimum linear saga primitive in `@arnilo/prism-workflows`, composable as a workflow function node. Do not force compensation semantics into every DAG node or create an ERP framework.
2. Persist schema version, definition revision, ordered step IDs, step statuses, attempt counts, output references, compensation cursor, lease fence, and last error through existing checkpoint storage.
3. Require each forward/compensation handler to accept stable operation/idempotency keys. On timeout/transport ambiguity mark outcome unknown and invoke its explicit reconcile handler before any retry.
4. Acquire existing lease before transition; compare checkpoint revision and lease fence on every commit. Resume from durable record after owner death.
5. Reverse only steps durably marked succeeded. If compensation exhausts attempts or reconciliation cannot classify outcome, stop in manual-intervention state rather than guessing.
6. Emit state-transition metadata without input/output bodies. Add a concise operator query/retry/manual-resolution guide.

**API Notes / Examples**

```ts
const saga = defineSaga({
  id: "post-invoice",
  revision: "1",
  steps: [{
    id: "reserve-budget",
    run: ({ operationId, input }) => reserve(input, operationId),
    compensate: ({ operationId, output }) => release(output, operationId),
    reconcile: ({ operationId, phase }) => lookupReservation(operationId, phase),
  }],
});
const result = await runSaga(saga, {
  checkpoints: createWorkflowCheckpoints({ store: persistence.checkpoints }),
  leases: persistence.leases,
  ownerId: "worker-1",
  tenantId,
  runId: "post-invoice-1",
  input,
});
```

- Existing references: workflow coordinator/checkpoint/lease/retry exports and protected workflow tests.
- Create: `packages/workflows/src/saga.ts`, `packages/workflows/src/__tests__/saga.test.ts`.
- Edit: `packages/workflows/src/index.ts`, `packages/workflows/README.md`, `docs/workflows.md`, `docs/index.md`, `docs/release-0.2.7-evidence.md`.

**Test Cases to Write First**

- Failure at step N compensates only successful steps N-1..1 in reverse order.
- Kill/restart during forward, compensation, and reconciliation resumes once from durable cursor.
- Duplicate run and compensation calls carry identical operation keys and converge.
- Unknown outcome reconciles to succeeded/failed/unknown; persistent unknown stops for manual action.
- Stale lease/fence and stale checkpoint revision cannot advance state.
- Definition revision mismatch fails closed before executing handlers.
- 100-step bounded recovery benchmark meets Task 0 ceiling.

**Documentation/Wiki Assessment**

- Public API impact: additive `defineSaga`, `runSaga`, `resumeSaga`, `SagaDefinition`, `SagaStep`, and `SagaRunResult` exports from `@arnilo/prism-workflows`, matching the Task 0 freeze.
- Updated `packages/workflows/README.md`, `docs/workflows.md`, and the `docs/index.md` workflow navigation with state transitions, idempotency/reconciliation contract, operator ownership, and the “compensation is not rollback” warning.
- No separate saga package or wiki section; existing workflow navigation owns the material.

**Completion Evidence**

- `npm run build --workspace @arnilo/prism-workflows`: pass.
- `npm run typecheck --workspace @arnilo/prism-workflows`: pass.
- `npm test --workspace @arnilo/prism-workflows`: pass; 76 tests, 0 failures.
- `packages/workflows/src/__tests__/saga.test.ts`: 9 focused cases cover reverse compensation, unknown reconciliation, stable operation keys, stale lease/fence takeover, redaction before compensation, verified manual resolution, revision mismatch, tenant isolation, and 100-step bounded execution.
- Storage uses the existing `WorkflowCheckpointAdapter` over core `CheckpointStore` with the existing `LeaseStore`; no saga SQL table, dependency, scheduler, or second runtime was added.
- Disposable PostgreSQL 16-alpine smoke through `createPostgresPersistence` → `createWorkflowCheckpoints`: run/compensate/resume pass; no connection value retained.
- `npm run test:coverage`: pass; `@arnilo/prism-workflows` lines 86.83% against the 85.56% package threshold.
- Saga state is versioned and bounded: maximum 100 ordered steps, default 3 / hard 10 attempts, default 30-second / hard 300-second lease TTL, checkpoint CAS plus fencing on every transition.
- Ambiguous handlers must mark `unknown`; `reconcile` resolves `succeeded`/`failed`/`unknown`; unresolved forward or compensation state reaches `manual_intervention` and cannot be guessed through automatic replay.
- Manual resolution validates active verified tenant identity, exact checkpoint version, bounded reason, and audit reference; the host remains responsible for creating/verifying the referenced audit record.

---

### 3. [x] Add multi-party and separation-of-duties approval records

**Acceptance Criteria**

- **Functional:** Approval requests support required roles, per-role or total quorum, requester/approver separation, expiry, revocation, bounded delegation, rejection, and immutable decision provenance; only an atomic transition that satisfies policy releases the protected action.
- **Performance:** Decisions use indexed request/tenant keys and optimistic revision checks; evaluation is bounded to at most 100 actors/requirements per request.
- **Code quality:** Generic approval policy/types live in `@arnilo/prism-policy`, durable storage in enterprise Postgres, and protected actions consume one decision result; model output, tool output, and subagent identity are never approval principals.
- **Security:** Actors are verified host identities; duplicate/self/stale/expired/revoked/unauthorized decisions fail closed; delegation cannot expand roles, tenant, action, or expiry; every transition is audited.

**Approach**

1. Reuse verified `AgentIdentity` principal IDs and policy decision/audit conventions. Define approval policy as immutable request data: action digest, requester, tenant, required roles/quorum, expiry, and optional delegation constraints. Implemented as `ApprovalRequest`/`ApprovalRequirement`/`ApprovalDecision`/`ApprovalRecord`/`ApprovalStore` in `@arnilo/prism-policy` with pure evaluation (`evaluateApproval`) and a shared pure transition layer (`prepareApprovalCreate/Decision/Revoke/Consume`) reused by the memory reference store and the PostgreSQL store.
2. Add pure evaluation in policy and Postgres mutation methods in migration `005_erp_approvals` (built via `buildEnterpriseMigration005Ddl`, matching the established TypeScript-function DDL pattern — no `.sql` file on disk). One row per request; `decide`/`revoke` lock the request row `FOR UPDATE`, insert one actor decision, recompute bounded quorum, and revision-check the terminal transition in one transaction.
3. Resolve roles/authority through an explicit host callback: `ApprovalAuthority` (store-level, with `policyRevision` pin and `resolveRoles(identity, request)`). Only the roles and delegation chains accepted at decision time are persisted, plus the request's policy revision; a policy revision bump invalidates outstanding approvals.
4. Keep approval separate from existing single pending tool decisions. `consume` verifies tenant, action kind/digest, expiry, policy revision, and revision still match, then marks the grant consumed; when passed a caller-owned `client`, consumption and the protected action run in the host transaction together.
5. Revocation before consumption invalidates the grant (`approved` → `revoked`, terminal). After consumption, revocation cannot pretend the effect did not happen; the record stays `consumed` as provenance and reconciliation is host work.
6. NIST AC-5 used as control guidance, not as a certification claim (stated in docs).

**API Notes / Examples**

```ts
const authority: ApprovalAuthority = {
  policyRevision: "2026-08-01",
  async resolveRoles(actor, request) {
    // Host-owned role source; return [] to deny.
    return [{ role: "finance-approver" }];
  },
};
const approvals = createPostgresApprovalStore({ pool, schema, authority });

const request = await approvals.create({
  tenantId,
  requester: verifiedRequester,
  action: { kind: "invoice.release", digest },
  requirements: [{ role: "finance-approver", quorum: 2 }],
  separateFromRequester: true,
  expiresAt,
});
await approvals.decide({
  tenantId,
  requestId: request.id,
  expectedRevision: request.revision,
  role: "finance-approver",
  actor: verifiedApprover,
  decision: "approve",
  auditRef,
});
// Release path: consume joins the host transaction with the action it protects.
```

- External reference: `https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final` (AC-5).
- Create: `packages/policy/src/approvals.ts`, `packages/policy/src/__tests__/approvals.test.ts`, `packages/enterprise-postgres/src/approvals.ts`, `packages/enterprise-postgres/src/__tests__/approvals.integration.test.ts`, migration `005_erp_approvals` (via `buildEnterpriseMigration005Ddl` in `packages/enterprise-postgres/src/ddl.ts`).
- Edit: package indexes/READMEs (`packages/policy/src/index.ts`, `packages/enterprise-postgres/src/index.ts`), `docs/policy-and-audit.md`, `docs/enterprise-postgres-state.md`, `docs/release-0.2.7-evidence.md` (the plan's `docs/policy.md`/`docs/enterprise-postgres.md` names resolve to these actual files).

**Test Cases to Write First**

- Requester cannot approve own request even when holding required role.
- Quorum requires distinct verified principals; duplicate vote is idempotent and does not increase count.
- Wrong role, tenant, action digest, policy revision, stale revision, expiry, rejection, and revocation deny release.
- Delegation cannot exceed delegator role/action/tenant/expiry and preserves full chain.
- Concurrent final votes produce one terminal revision and one release eligibility event.
- Subagent/model-supplied identity cannot be converted into verified approver.
- Protected Postgres test proves grant consumption and action release are atomic where they share one transaction.

**Documentation/Wiki Assessment**

- Public API impact: additive approval types/store in `@arnilo/prism-policy` (`ApprovalRequest`/`ApprovalRequirement`/`ApprovalDecision`/`ApprovalRecord`/`ApprovalStore`, `ApprovalAuthority`, `evaluateApproval`, `createMemoryApprovalStore`) and `createPostgresApprovalStore` + migration `005_erp_approvals` in `@arnilo/prism-enterprise-postgres`.
- Add policy/storage examples, role/quorum table, delegation limits, revocation semantics, and operator audit queries; link from `docs/index.md`. Done: multi-party approvals section in `docs/policy-and-audit.md`, approvals seam rows + implementation notes in `docs/enterprise-postgres-state.md`, and index entries in `docs/index.md`.
- State explicitly that hosts own identity verification and role source, and that Prism does not certify NIST compliance. Done: stated in both docs and package READMEs.

SoD tests: `packages/policy/src/__tests__/approvals.test.ts` (memory) and `packages/enterprise-postgres/src/__tests__/approvals.integration.test.ts` (PostgreSQL: atomic consume in host transaction, concurrent terminal vote, lifecycle/isolation).

**Completion Evidence**

Task 3 is complete. Implementation: `packages/policy/src/approvals.ts` (types, frozen caps, pure quorum evaluation, shared pure transition validation, memory reference store) and `packages/enterprise-postgres/src/approvals.ts` (`createPostgresApprovalStore`, row-locked transitions, caller-transaction consume). Migration `005_erp_approvals` registered and catalog-verified (12 tables / 13 indexes).

Protected PostgreSQL evidence (Postgres 16-alpine): 40/40 enterprise-postgres tests pass with `PRISM_TEST_POSTGRES_URL` — including the approvals integration suite: (1) grant consumption + host action commit/rollback together in one transaction; (2) concurrent final votes produce exactly one terminal transition and one stale loser; (3) lifecycle/isolation: separation of duties, idempotent duplicate votes, stale revision, wrong role, revocation, bounded delegation chain persistence, and cross-tenant isolation. No connection value or credential retained.

Full matrix: policy package 32/32 (7 approval unit tests), enterprise-postgres 10/10 unit tests without Postgres, `npm run test:coverage` pass with `@arnilo/prism-policy` lines 92.55% against 90.78%, full `npm test` 3,739 tests / 3,706 pass / 33 protected skips / 0 failures, docs.test.ts 140/140, typecheck/lint/format clean.
---

### 4. [x] Add signed, hash-chained audit export with WORM and SIEM sinks

**Acceptance Criteria**

- **Functional:** Exporter reads tenant-scoped audit records in stable order, emits canonical hash-chained envelopes and signed batch manifests, obtains durable WORM acknowledgement before advancing its cursor, mirrors to SIEM with replayable status, enforces legal holds/redaction, and supports independent verification.
- **Performance:** Export streams bounded pages of at most 1,000 records/10 MiB; hash/sign work is linear; retries reuse stable batch IDs without loading full history.
- **Code quality:** Reuse policy audit/lifecycle records, checkpoint/cursor semantics, Node crypto, and host-provided signer/sinks; add no object-store or SIEM SDK and no hidden key storage.
- **Security:** Chain covers canonical bytes, tenant, sequence, prior digest, classification/redaction metadata, hold provenance, and manifest; signer keys never enter logs/records; partial sink failure cannot falsely advance success.

**Approach**

1. Define an exporter in `@arnilo/prism-policy` around async audit-page source, explicit signer, required immutable sink, optional SIEM sink, and durable cursor store. Host adapters own S3/Azure/GCP/SIEM transport.
2. Canonicalize supported JSON values using RFC 8785 semantics or a minimal tested implementation if existing canonical JSON does not comply. Reject unsupported/non-finite/cyclic values.
3. Hash each record envelope with SHA-256 including previous digest and sequence. Sign a batch manifest through `AuditSigner.sign(bytes)`; do not accept raw private key configuration in Prism.
4. Write stable batch to WORM sink, verify immutable acknowledgement/digest, then write/retry SIEM status. Advance cursor only with revision CAS after required acknowledgements; repeated writes use same batch key.
5. Apply field policy before hashing so verifier sees exactly exported bytes. Preserve redaction reason/field label without leaking original value. Legal hold can require retention/export but never broadens tenant access.
6. Ship verifier CLI/script that validates canonical bytes, record chain, manifest signature, cursor continuity, tenant, and expected first/last sequence.

**API Notes / Examples**

```ts
import { createAuditExporter, createMemoryAuditCursorStore, verifyAuditBatch } from "@arnilo/prism-policy";

const exporter = createAuditExporter({
  source,                 // tenant-scoped AuditPageSource (host backfills from the policy ledger)
  cursorStore: createMemoryAuditCursorStore(), // durable CAS cursor store in production
  signer,                 // host AuditSigner: sign(bytes) -> Uint8Array + keyId
  wormSink,               // required immutable sink; ack { batchId, digest } must match
  siemSink,               // optional mirror
  redact,                 // optional AuditRedactionPolicy applied before hashing
});
const result = await exporter.exportNext({ tenantId, maxRecords: 1_000, maxBytes: 10 * 1024 * 1024 });
// result.artifactBytes -> WORM bytes; result.nextDigest -> previousDigest of the next batch
const verified = verifyAuditBatch({ artifactBytes, publicKey, expectedTenantId, previousDigest });
// WORM-durable batch whose SIEM mirror failed: replay it with host-supplied artifact bytes
await exporter.retryPendingSiem({ tenantId, batchId: result.batchId, artifactBytes: result.artifactBytes });
```

- References: `https://www.rfc-editor.org/rfc/rfc8785.html`, `https://nodejs.org/download/release/latest-v20.x/docs/api/crypto.html`.
- Create: `packages/policy/src/audit-export.ts`, `packages/policy/src/canonical.ts` (RFC 8785 canonicalizer), `packages/policy/src/__tests__/audit-export.test.ts` (actual test path convention, not `test/`), `scripts/verify-audit-export.mjs`.
- Edit: `packages/policy/src/index.ts`, package README, docs index + `docs/audit-export.md`, `docs/release-0.2.7-evidence.md`.

**Test Cases to Write First**

- Reorder, deletion, insertion, byte mutation, prior-digest mutation, signature mutation, and truncation fail verification.
- Same records/config produce byte-identical batch and stable retry key.
- WORM failure leaves cursor unchanged; SIEM failure records replayable partial status without duplicate chain entries.
- Cross-tenant source/sink/cursor inputs fail closed.
- Legal hold preserves required records while redaction removes denied fields before hashing.
- Signer error and key rotation boundary produce explicit recoverable states.
- 10,000-record test proves bounded pages/memory and linear processing.

**Documentation/Wiki Assessment**

- Public API impact: additive policy export/sink/signer/verifier contracts — `createAuditExporter`, `verifyAuditBatch`, `AuditSigner`, `AuditWormSink`, `AuditSiemSink`, `AuditCursorStore` plus supporting types (`AuditPageSource`, `AuditRedactionPolicy`, `AuditExportItem`, `AuditCursor`, `AuditWormAck`, `AuditSiemWrite`, `AuditExportBatchInput/Result`, `VerifyAuditBatchInput/Result`, `AuditSiemStatus`), `createMemoryAuditCursorStore`, `AUDIT_EXPORT_HARD_LIMITS`, `canonicalJson`/`canonicalJsonBytes`/`CanonicalJsonError`, `AuditExportError`.
- Added `docs/audit-export.md` with canonical manifest sample, verification command, sink responsibilities, key rotation (`signature.keyId`), outage/replay (`retryPendingSiem`), legal hold, redaction, caps, and non-certification language; docs/index.md links the page (docs.test apiPages + nav updated).
- Sample manifest and verification command ship with no real tenant data or keys; verification needs only the artifact bytes and the public key.

**Completion Evidence**

- `packages/policy/src/audit-export.ts` (+ `canonical.ts`): exporter around one-shot page tokens with a bounded (one page ≤ 1,000 records / 10 MiB) in-memory uncommitted-page replay, CAS cursor store seam, host signer, required WORM ack that must match `{batchId, digest}`, optional SIEM mirror with bounded `siemPending` replay, and stateless `verifyAuditBatch` that replays every envelope from artifact bytes.
- `packages/policy/src/__tests__/audit-export.test.ts`: 13 cases — RFC 8785 vectors (sorted keys, prefix order, shortest round-trip, `-0`, control escapes, rejection of non-finite/BigInt/undefined/cyclic); byte-identical batches + stable retry key; tamper matrix (reorder, deletion, insertion, byte mutation, prior-digest mutation, signature mutation, truncation); WORM failure/lying-ack leaves cursor untouched; SIEM pending status replays without duplicate chain entries and rejects mismatched artifact bytes; per-tenant chain/cursor isolation in one store; legal hold + redaction before hashing; signer error + key-rotation boundary; 10,000-record continuous chain across 10 bounded batches; per-batch budget enforcement; expected first/last sequence validation.
- Protected command: `npm run test:coverage` passed — `@arnilo/prism-policy` lines `92.66%` vs `90.78%` threshold — and full `npm test` passed with `0` failures (`3,739` tests, `3,706` pass, `33` protected skips).
- The docs.test.ts apiPages array gained `docs/audit-export.md`; docs/index.md links it once; package README documents the exporter. No object-store/SIEM SDK, no key storage, and no credential retention anywhere in the implementation.

---

### 5. [x] Implement only demanded secret-manager adapters behind the credential contract

**Acceptance Criteria**

- **Functional:** Each Task 0-approved Vault/AWS/Azure/GCP adapter resolves a named/versioned secret through the existing credential-source contract, handles not-found/disabled/version mismatch/rotation/outage explicitly, and has protected or contract evidence; undemanded adapters are not implemented.
- **Performance:** Resolution obeys bounded timeout/body/retry limits and does not add unrequested caching; protected evidence records p50/p95 and provider throttling behavior.
- **Code quality:** Adapters stay in `@arnilo/prism-credentials-node`, use injected authenticated clients or existing safe fetch, add no cloud SDK by default, and share only genuinely common bounded response handling.
- **Security:** No adapter implicitly reads `process.env`, metadata services, home-directory credentials, or ambient CLI state; endpoints, auth, TLS, redirects, logs, errors, and returned secret lifetime follow explicit policy.

**Approach**

1. Stop for every provider lacking a named consumer, secret shape, auth bootstrap, protected test path, and owner. Document “not implemented—no demand” as successful scope control.
2. Adapt providers to existing `CredentialResolver`/source semantics. Prefer injected provider client functions when safe request signing would otherwise require a cloud SDK; Prism must not reinvent SigV4 or OAuth token acquisition.
3. For approved HTTP adapters, use existing egress/pinned-fetch controls, explicit endpoint allowlist, `redirect: "error"`, timeout/size bounds, schema validation, and redacted errors.
4. Accept secret identifiers and optional versions explicitly. Never enumerate secrets. Return existing credential value shape with expiry/version metadata when available.
5. Keep cache ownership with caller or existing credential cache. Invalidate on explicit rotation/version change; never persist secret bytes in Postgres, checkpoints, telemetry, audit, or eval fixtures.
6. Add provider-specific protected tests only where credentials/endpoints are intentionally configured. Missing config reports skipped evidence and cannot satisfy a demanded adapter gate.

**API Notes / Examples**

No adapter API exists to illustrate: all four providers were checked against the Task 0 demand registry and none has a named consumer, secret shape, auth bootstrap, owner, or protected test path. Per the plan, documenting “not implemented—no demand” is the successful scope control, so no public API, no placeholder module, and no `create*CredentialResolver` factory was added. When a demand record lands, the adapter must implement the existing `CredentialResolver.resolve(request)` contract from `@arnilo/prism-credentials-node` (injected authenticated client or existing safe fetch, explicit endpoints, `redirect:"error"`, bounds, redacted errors):

```ts
const resolver = createVaultCredentialResolver({ endpoint, authenticatedFetch, policy });
const credential = await resolver.resolve({ name: "erp/signing-key", version: "42" });
```

- Official API references: Vault KV v2, AWS Secrets Manager `GetSecretValue`, Azure Key Vault Secrets `get`, and GCP Secret Manager `projects.secrets.versions.access`; pin exact URLs/versions in the demand record, not here.
- Conditional create/edit for a demanded adapter: `packages/credentials-node/src/{vault,aws-secrets-manager,azure-key-vault,gcp-secret-manager}.ts`, matching tests, index, README, `docs/credentials.md`. None was created.
- Always edited: `docs/release-0.2.7-evidence.md` demand result + ambient-read audit; added machine gate `scripts/phase27-demand-gate.mjs` wired into the freeze contract.

**Test Cases to Write First**

- Contract fixtures cover success, exact version, not found, disabled, malformed, oversized, timeout, throttle, 5xx, redirect, and rotation.
- Spies prove no access to `process.env`, metadata IPs, home directory, or subprocess credential helpers.
- Logs/errors/traces/snapshots never contain secret canaries or authorization headers.
- Endpoint policy rejects HTTP downgrade, redirect, DNS/IP mismatch, and unapproved host where HTTP transport is used.
- Protected test validates demanded provider against intentional test tenant/project/vault and records skip as non-passing.

**Documentation/Wiki Assessment**

- Public API impact: none. No demanded provider exists, so no additive exports; undemanded providers received only evidence-table rows, no placeholder modules or public APIs.
- Credentials docs and `docs/index.md` need no new bootstrap examples because no adapter shipped; the deferral rows already present in this evidence document and the Task 0 freeze remain the contract.
- `docs/release-0.2.7-evidence.md` gained the demand result table and the ambient-read audit (ERP-T6).

**Completion Evidence**

- `scripts/phase27-demand-gate.mjs` (wired into `scripts/phase27-freeze.test.mjs`, runs on every `npm test`): proves all four providers are still `deferred` with `consumer: null` in the demand registry; fails if any demanded-provider adapter module or `create*CredentialResolver` factory exists in `@arnilo/prism-credentials-node`; scans the adapter home package for metadata-service IPs/hosts, home-directory/CLI credential paths, and subprocess credential-helper CLI invocation.
- Ambient-read audit: zero hits for metadata services, `~/.aws`/`.azure`/`.config/gcloud`, CLI-helper subprocesses, and `process.env` reads across `packages/credentials-node/src`; invariant 13 holds.
- No placeholder modules for `vault-adapter`, `aws-secrets-manager`, `azure-key-vault`, or `gcp-secret-manager`; no public API delta.
- Protected command: `node scripts/phase27-demand-gate.mjs` exits `0`; `node --test scripts/phase27-freeze.test.mjs` green; full `npm test` green with `0` failures.

---

### 6. [x] Prove HA registries, leases, cursors, failover, and split-brain recovery

**Acceptance Criteria**

- **Functional:** Two replicas can start, inspect, cancel, resume, and reconcile durable ACP/workflow/saga/outbox/export operations after either replica dies; no correctness path requires the dead process’s active registry; cursors never regress.
- **Performance:** Failover completes within configured lease TTL plus 5 seconds, acquisition retries are bounded/jittered, and multi-replica tests record contention/latency without hot loops.
- **Code quality:** Fix shared state/lease/cursor roots rather than adding guards to individual callers; local registries remain optional fast paths; existing stores and revision semantics are reused.
- **Security:** Tenant ownership is checked on every durable lookup/mutation; stale owners/fences and split-brain writes fail closed; cancellation/status authority remains verified and audited.

**Approach**

1. Grep every active registry and every status/cancel/resume caller identified in Task 0. Add durable lookup or mutation only where correctness currently depends on process memory.
2. Standardize existing lease conformance around owner ID, fencing token, expiry, renewal, release, and stale-owner rejection. Do not create a new lease package or consensus protocol.
3. Standardize cursor CAS for outbox claims, saga checkpoints, audit export, ACP lifecycle, workflows, and conversations. A cursor can repeat work after crash but cannot skip or move backward.
4. Build one protected two-process harness using real Postgres: barrier startup, acquire/work, SIGKILL owner, wait lease expiry, resume from peer, attempt stale write from paused owner, and verify one committed transition.
5. Exercise network/database interruption separately from process death. On uncertain commit, reload durable state before retry.
6. Emit owner/fence/lease age/state metadata without tenant payloads. Document operator responses; never expose a “force unlock” that bypasses fencing.

**API Notes / Examples**

```ts
const lease = await store.acquireLease(key, ownerId, ttlMs);
await store.compareAndSet(key, revision, next, { fencingToken: lease.fencingToken });
```

- Existing files to inspect/edit: ACP host/runtime registries, workflow coordinator/stores, conversation store adapters, lifecycle service, enterprise Postgres leases/checkpoints, outbox and audit cursors.
- Create: `scripts/phase27-ha-worker.mjs`, `scripts/phase27-ha.test.mjs`.
- Edit only root-cause runtime/store files identified by failing tests plus `docs/operations.md` and release evidence.

**Test Cases to Write First**

- Replica B reads/statuses/cancels operation created by replica A without A’s registry.
- SIGKILL owner before and after external side effect; peer resumes from durable state with same idempotency key.
- Paused stale owner wakes after failover and cannot commit with old fence/revision.
- Two simultaneous lease acquisitions produce one owner; lease expiry/renewal uses controlled clock where possible.
- Cursor replay is allowed, regression/skip is rejected, and uncertain commit reloads state.
- Tenant B cannot inspect, cancel, resume, or claim tenant A operations.
- Protected drill records failover time against frozen ceiling.

**Documentation/Wiki Assessment**

- Public API impact: none — the drill exercises the existing `LeaseStore`/`CheckpointStore`/ERP-outbox contracts; no lease package, consensus protocol, or manual unlock was added.
- Added one HA/failover runbook `docs/operations.md` linked from `docs/index.md` (docs.test apiPages + nav updated): local-registry limitations, lease/fence model, uncertain-commit replay rule, failover procedure, metrics (owner/fence/lease-age metadata only, no tenant payloads), and the prohibition on manual unlocks that bypass fencing.
- Recorded exact two-replica commands, process IDs, injected failures, timings, and durable final states in `docs/_evidence/phase27-ha-evidence.json`.

**Completion Evidence**

- `scripts/phase27-ha-worker.mjs` (modes `start`/`resume`/`stale`/`race`) + `scripts/phase27-ha.test.mjs` (orchestrator; wired into the root npm test list; skips — never passes — without `PRISM_TEST_POSTGRES_URL`): barrier file markers, real SIGKILL inside the crash window (outbox effect committed, cursor not advanced), lease-expiry wait, failover timer against the frozen ceiling, stale-fence/revision rejection, old-token renewal denial, simultaneous-acquisition one-owner assertion, foreign-tenant read/save/takeover rejection, and skip-ahead/regression rejection.
- Recorded drill (2026-08-17, `postgres:16-alpine`): A acquired (fencing token 1), checkpoint v1→v2 (cursor 1), charge committed to `prism_erp_outbox` (count 1), SIGKILL before the cursor-advance save; B acquired token 2 after expiry with `failoverMs` 4097 ≤ 9000 ceiling, heart-beat renewal, idempotent replay (outbox stayed 1), advanced to v4/cursor 3, released; old fence+revision write rejected with `ERR_PRISM_CHECKPOINT_CONFLICT`; race → exactly one owner; foreign tenant read/save/lease all reject with ownership mismatch while its own keys work.
- Protected command: ``PRISM_TEST_POSTGRES_URL` set to the protected connection string, then: `node --test scripts/phase27-ha.test.mjs``; full `npm test` green with `0` failures; docs.test green (apiPages gained `docs/operations.md`). No credential, connection value, or tenant payload retained in evidence.

---

### 7. [x] Rehearse backup, restore, migration rollback, PITR, and disaster recovery

**Acceptance Criteria**

- **Functional:** Protected drill backs up representative multi-tenant 0.2.7 state, restores to an empty supported Postgres instance, verifies checksums/counts/referential invariants, rehearses migration forward and documented rollback, and records PITR/RPO/RTO evidence.
- **Performance:** Backup/restore/PITR timings and size meet Task 0 targets; commands have bounded timeouts and sufficient free-space checks; missed targets block completion.
- **Code quality:** Use standard PostgreSQL tools and existing migration runner; scripts orchestrate commands and verification only, not a custom backup format or scheduler.
- **Security:** Credentials are explicit and redacted, artifacts are encrypted/permission-restricted by operator configuration, restore target is allowlisted and non-production, tenant/legal-hold data is verified, and destructive commands require positive target confirmation.

**Approach**

1. Seed representative outbox/inbox, saga, approval, audit cursor, lifecycle/legal-hold, workflow, ACP, conversation, and classified records for at least two tenants.
2. Use `pg_dump` custom format and `pg_restore` into an explicitly named disposable database. Keep storage/encryption/retention scheduling operator-owned.
3. Produce a manifest with source commit/schema versions, tool/server versions, table counts, stable content digests for non-secret fixtures, timestamps, sizes, and command results.
4. Restore, run migrations/status checks, and verify application-level invariants—not only command exit codes. Confirm no secret canaries were inserted into fixtures or artifacts.
5. Rehearse upgrade from 0.2.6 schema to 0.2.7 and documented rollback decision path. Prefer roll-forward repair after production migration; destructive down migration is allowed only in disposable evidence environment.
6. Execute PITR against host-provisioned WAL archiving where available and record achieved recovery point. If protected PITR evidence is a frozen exit gate, missing infrastructure fails rather than skips.
7. Add DR runbook with ownership, cadence, RPO/RTO, legal holds, cross-region/object-store assumptions, key recovery, and quarterly drill evidence template.

**API Notes / Examples**

```sh
node scripts/phase27-dr.test.mjs --source "$PRISM_DR_SOURCE_URL" --target "$PRISM_DR_TARGET_URL" --confirm-target prism_dr_restore
```

- PostgreSQL references: `https://www.postgresql.org/docs/current/backup-dump.html`, `https://www.postgresql.org/docs/current/app-pgdump.html`, `https://www.postgresql.org/docs/current/app-pgrestore.html`, `https://www.postgresql.org/docs/current/continuous-archiving.html`.
- Create: `scripts/phase27-dr.test.mjs`, `docs/disaster-recovery.md`.
- Edit: root scripts/package metadata as needed, `docs/index.md`, `docs/release-0.2.7-evidence.md`.

**Test Cases to Write First**

- Guard rejects same source/target, production-looking target, absent confirmation, unsupported tool/server version, and insufficient space.
- Restored table counts/digests and cross-record references equal source for both tenants.
- 0.2.6-to-0.2.7 migration preserves old rows and initializes new schema safely.
- Rollback rehearsal preserves backup and records explicit loss window/forward-repair choice.
- PITR restores to selected point between two known writes and excludes the later marker.
- Logs/manifests redact URLs, passwords, keys, and classified values.
- Timings/sizes compare against frozen RPO/RTO/budget and fail on breach.

**Documentation/Wiki Assessment**

- Public API impact: none — standard PostgreSQL tools plus the existing migration runner; script and docs only.
- Added `docs/disaster-recovery.md` and navigation (docs.test apiPages + index nav): exact prerequisites (source/target/PITR URLs, `--confirm-target prism_dr_restore`, shared `/dr` mount, no pre-existing target), guarded commands, validation (per-table counts and content digests, not just exit codes), the rollback decision tree, RPO/RTO ownership, legal-hold verification, and the evidence template (`docs/_evidence/phase27-dr-evidence.json`).
- Explicitly does not claim managed backup, encryption, cross-region replication, or tested PITR beyond the recorded disposable environment.

**Completion Evidence**

- `scripts/phase27-dr.test.mjs` — recorded run in `docs/_evidence/phase27-dr-evidence.json`: seeded 2 tenants across 14 tables (sessions, checkpoints, leases, legal holds, quotas, policy decisions, evaluations, work idempotency, tool effects, router budgets, outbox, inbox, approvals) via the real store APIs; `pg_dump -F c` backup 108,291 bytes / 122 ms (SHA-256 `bd47292f…`); `pg_restore` into the confirmed disposable target in 382 ms with all 14 table counts and content digests equal to source; 0.2.6-era schema (raw DDL 001–003 + registry checksums) upgraded by `applyEnterpriseMigrations` to 5 migrations with legacy rows preserved and new tables empty; rollback from the pre-upgrade backup restores exactly and excludes 0.2.7 tables (loss window recorded); PITR on the WAL-archived cluster between two markers — earlier present, later absent — 1.2 s recovery, RPO ≈ 0 s / RTO ≈ 1 s measured locally; passwords and the seeded canary never appear in evidence/logs/console; guards assert source≠target, loopback target, non-production target name, mandatory confirmation token, fail-closed on dirty state, ≥ 512 MB free space.
- Protected command: source/target/PITR URLs + `--confirm-target prism_dr_restore` — see the Task 7 runbook; missing infrastructure fails (never a passing skip).

---

### 8. [x] Add field-level classification and fail-closed redaction at data boundaries

**Acceptance Criteria**

- **Functional:** Explicit policy classifies fields for prompts, tool arguments/results, artifacts, audit, telemetry, persistence, and exports; each boundary can allow, redact, tokenize, or deny; unknown fields fail closed under protected policy; tenant and legal-hold context are preserved.
- **Performance:** Traversal obeys depth/key/byte bounds, handles cycles safely, avoids duplicate serialization, and adds under 10% overhead on frozen representative payloads.
- **Code quality:** One dependency-free contract/helper is threaded through existing boundary owners; reuse existing redactors and schema metadata; add no global registry, decorator framework, or second policy language.
- **Security:** Default protected configuration denies or redacts unknown outbound/persisted fields, secret canaries never reach provider/tool/artifact/audit/telemetry/export sinks, and policy errors fail closed without echoing values.

**Approach**

1. Inventory exact boundary functions and existing redaction/schema hooks before choosing contract ownership. Put the smallest neutral field-policy types where all owners can depend on them without a cycle.
2. Define labels, field path, value kind, tenant, direction, destination, purpose, and legal-hold context. Host policy returns allow/redact/tokenize/deny; protected default handles unknowns fail-closed.
3. Walk only JSON-like structured values with explicit limits and cycle detection. Preserve shape where redaction is required; reject unsupported values at trust boundaries instead of stringifying guesses.
4. Apply before provider prompt egress, tool dispatch/return persistence, artifact write/read export, audit hashing, telemetry attributes/events, Postgres persistence where configured, and lifecycle export. Keep existing hardcoded secret redaction as defense in depth after policy transformation.
5. Mark trusted internal transitions explicitly; do not silently bypass because data originated from Prism. Every tenant-changing/exporting boundary re-evaluates policy.
6. Add canary matrix and one microbenchmark across each boundary. Log only path/label/action/reason, never denied value.

**API Notes / Examples**

```ts
const fieldPolicy: FieldPolicy = ({ path, destination, label }) =>
  label === "secret" ? { action: "deny", reason: "secret-egress" } :
  destination === "telemetry" && label === "personal" ? { action: "redact" } :
  { action: "allow" };
```

- Files to create: owning-package `field-policy.ts` and focused unit tests after Task 0 confirms cycle-free ownership.
- Files to edit: provider input assembly, tool dispatch/result boundary, server artifact service, policy audit/export, observability exporters, enterprise Postgres persistence entry points, package indexes/READMEs, `docs/security.md`.
- Reference existing redaction, tool schema validation, pinned egress, artifact authorization, lifecycle/legal-hold, and telemetry sanitization code before editing.

**Test Cases to Write First**

- Secret/personal/financial/tenant-owned canaries are allowed, redacted, tokenized, or denied per destination matrix.
- Unknown label/path, policy exception, timeout, excessive depth/keys/bytes, cycle, unsupported value, and tenant mismatch fail closed.
- Prompt, tool arg/result, artifact, audit, telemetry, persistence, and export spies receive no denied canary.
- Redacted audit batch still verifies because transformation precedes canonical hashing.
- Legal hold prevents deletion but does not broaden view/export permissions.
- Existing callers without policy retain compatibility; protected profile explicitly supplies fail-closed policy.
- Benchmark records overhead and allocation against frozen representative payloads.

**Documentation/Wiki Assessment**

- Public API impact: additive — `@arnilo/prism` exports `FieldPolicy`, `FieldPolicyInput`, `FieldPolicyDecision`, `applyFieldPolicy` (frozen) plus `createProtectedFieldPolicy`, `createAuditFieldRedactor`, `ALLOW_FIELD_POLICY`, `FieldPolicyError`, `FIELD_POLICY_LIMITS`; `@arnilo/prism-observability-opentelemetry` adds the optional `fieldPolicy` option to `createOpenTelemetryInstrumentation`; the redaction seam functions take an optional policy/labelFor (identity when absent — compatible).
- Added `docs/data-classification.md` + `docs/index.md` navigation (docs.test apiPages) with taxonomy, boundary matrix, camera-ready defaults, limits, legal hold, tenant semantics, migration guidance, and failure behavior. Host security guide (`docs/host-security.md`) gained a Task 8 paragraph and related link.
- Documented that classification assists enforcement but does not discover sensitive data automatically (labels come from explicit per-boundary `labelFor` hints).

**Completion Evidence**

- `src/field-policy.ts` — dependency-free contract: `applyFieldPolicy` walks JSON-like values with `allow`/`redact`/`tokenize`/`deny`, sparse copies (untouched subtrees share the input reference; input never mutated), active-path cycle rejection, depth 32 / keys 10,000 / string 1,000,000 / optional wall-clock budget, unsupported values fail closed (`FieldPolicyError`, no stringification guesses), deterministic path+value tokens safe for audit chains. `createProtectedFieldPolicy()` is the fail-closed default: unknown labels deny on outbound/persisted destinations, `secret`/`financial` deny, `personal` redacts, `token` tokenizes, `public` passes; inbound unknowns pass; labels only from `labelFor` hints — no auto-discovery, no global registry, no decorators.
- Boundary seams: `redactMessage`/`redactProviderRequest`/`redactAgentEvent`/`redactSessionEntry`/`redactRunLedgerRecord` take optional `(fieldPolicy, destination, labelFor)` — secret redaction runs first, then classification; identity fast path without a policy (existing callers unchanged). `createAuditFieldRedactor(policy, {labelFor, tenantId, purpose})` feeds the audit-export `redact` hook so transformation precedes canonical hashing and only `{path, reason}` provenance survives. `createOpenTelemetryInstrumentation({ fieldPolicy })` filters/masks exported span attributes and events (deny drops, redact `[REDACTED]`, tokenize hashes, policy errors drop the attribute without echoing the value).
- ERP-T9 matrix `src/__tests__/field-policy.test.ts` (25/25): secret/personal/financial/tenant-owned canaries across all seven destinations (prompt, tool, artifact, audit, telemetry, persistence, export) are allowed/redacted/tokenized/denied with no canary in transformed output or provenance; unknown-label, policy-throw, invalid-decision, timeout, depth, keys, bytes, cycle, unsupported-value, and tenant-mismatch all fail closed; audit transform-before-hash + provenance shape; legal hold does not broaden export; compat (identity without policy); sparse-copy allocation asserts; frozen-budget benchmark: policy pass vs the pre-existing redaction walk on all seven frozen fixture sizes (peak 102.7%, min 83.5%, all ≤ 110% — cap `classificationMaxOverheadPercent`), raw stringify ratio recorded in evidence.
- OTel seam tests (2 new, 14/14 package): denied attribute dropped, redacted masked, policy errors never echo values.
- Protected command: none required — contract verified entirely by unit/suite gates (no live infra); run `npm test` + `npm run test:coverage`.

---

### 9. [x] Build deterministic ERP evals and the protected end-to-end release journey

**Acceptance Criteria**

- **Functional:** One reproducible journey exercises verified identity, policy, budget reservation, SoD quorum approval, transactional outbox/inbox, saga failure/compensation/reconciliation, signed audit export, legal hold, classification, two-replica failover, backup/restore, and any demanded secret adapter; supervisor/subagent work is correlated but cannot authorize.
- **Performance:** Journey records stage durations, queue age, retries, failover, export throughput, and restore timing against frozen budgets; eval execution is deterministic and bounded.
- **Code quality:** Reuse existing supervisor, workflow, eval dataset/scorer, protected-profile, and evidence primitives; no bespoke test framework or live-service matrix substitute; fixtures are minimal and versioned.
- **Security:** Negative cases prove requester self-approval, subagent approval, cross-tenant access, revoked approval, stale lease, audit tamper, classification leak, legal-hold delete, and secret leak all fail closed.

**Approach**

1. Add a versioned ERP invariant dataset to existing evals. Scorers consume structured journey facts, not model prose: atomic intent, single local effect under duplicate delivery, compensation terminal state, quorum provenance, chain verification, no leak, fenced failover, restore equality.
2. Build one protected runner around real Postgres and process-level failover. Use deterministic fake/local external sinks where 0.3.0 live services remain intentionally pending; label every substitute in evidence.
3. Run a requester through identity/policy/budget checks; launch bounded supervisor children for proposal/review work; prove their outputs cannot become verified approver identities.
4. Obtain distinct verified host approvals, atomically consume grant with ERP mutation/outbox, deliver duplicate message through inbox, inject downstream failure, reconcile ambiguous outcome, and compensate.
5. Export audit chain under tenant/legal-hold policy to immutable-sink fixture plus SIEM fixture, tamper a copy for negative verification, then attempt forbidden delete/export.
6. Kill active worker, allow peer to resume with lease fencing, perform backup/restore, and compare restored durable facts.
7. Emit `artifacts/release-0.2.7/erp-journey.json` and eval report with schema version, commit, environment, substitutes, timings, thresholds, facts, and digests—never secrets or raw classified payloads.

**API Notes / Examples**

```ts
const scorers = createErpInvariantScorers();
const records = await scoreRun({
  result,
  scorers,
  datasetId: erpInvariantDataset.id,
  sampleRate: 1,
});
if (records.some((record) => record.status !== "scored" || record.score !== 1)) process.exitCode = 1;
```

- Create: `packages/evals/src/erp-invariants.ts`, `packages/evals/test/erp-invariants.test.ts`, `scripts/phase27-erp-journey.test.mjs`.
- Edit: eval exports/README, root scripts, protected-profile documentation, `docs/release-0.2.7-evidence.md`.
- Reuse existing artifact/evidence conventions; do not commit generated release artifacts containing environment-specific data.

**Test Cases to Write First**

- Every required fact absent/false makes its scorer fail; no weighted average can hide atomicity/security failure.
- Duplicate outbox/inbox delivery yields one local business mutation and explicit repeated delivery evidence.
- Requester and supervisor child cannot satisfy SoD; two distinct verified actors can.
- Injected failure compensates; ambiguous outcome reconciles; stale replica cannot commit.
- Audit tamper, cross-tenant export, held-record delete, and denied-field leak fail.
- Backup/restore facts and digests match; journey fails if DR evidence is missing or stale.
- Repeated deterministic fixture run yields same fact digests and scores.

**Documentation/Wiki Assessment**

- Public API impact: additive `erpInvariantDataset` and `createErpInvariantScorers` exports from `@arnilo/prism-evals`; runner remains repository script.
- Update eval/protected-profile docs and `docs/index.md` with fact schema, hard gates, execution command, substitutes, and interpretation.
- State prominently that passing local/protected journey does not satisfy the 0.3.0 live-service matrix.

---

### 10. [x] Close documentation, migrations, release metadata, and measurable exit gates

**Acceptance Criteria**

- **Functional:** All tasks pass; migrations install/verify on empty and upgraded databases; package/docs examples compile; evidence links every roadmap item and threat to tests/results; release metadata is exactly 0.2.7; roadmap is updated truthfully.
- **Performance:** Full verify, protected profiles, ERP journey, benchmarks, backup/restore, and API/size budgets pass with recorded environment and timings; regressions beyond frozen ceilings block release.
- **Code quality:** Changesets/API reports/exports/package manifests/lockfile/docs are synchronized across the 50-package graph; no placeholder adapter, dead API, stale generated file, or duplicated primitive remains.
- **Security:** Threat matrix is closed with negative evidence, secret scan is clean, audit verification passes, classification canaries do not leak, migrations/backups are guarded, and 0.3.0 live-service blocker remains explicit.

**Approach**

1. Run task tests immediately after each implementation and append evidence. At closeout run clean install, build, typecheck, lint, unit/integration tests, coverage, API report, package graph, docs examples/links, protected Postgres, HA, DR, and ERP journey.
2. Test migrations on empty database and representative 0.2.6 upgrade. Verify checksums, lock behavior, unsupported future revision rejection, restore compatibility, and documented rollback evidence.
3. Bump synchronized workspace versions/peers/changesets to 0.2.7 under current policy. Confirm exactly 50 published packages and zero accidental runtime dependency additions.
4. Review all new exports for demand, naming, package ownership, bounded inputs, failure semantics, and documentation. Delete unused scaffolding and provider placeholders.
5. Update roadmap 0.2.7 checkboxes only from linked passing evidence. Mark the milestone shipped only if its gates pass, while preserving: “ERP production ready remains blocked until the 0.3.0 live-service matrix is recorded.”
6. Create final evidence manifest containing commit, tool versions, test totals, coverage, timings, query plans, failover, DR, journey/eval results, known limitations, and operator sign-offs.

**API Notes / Examples**

```sh
npm ci
npm run build
npm run typecheck
npm run lint
npm run format:check
npm test
node scripts/phase27-protected-profile.test.mjs
node scripts/phase27-ha.test.mjs
node scripts/phase27-dr.test.mjs
node scripts/phase27-erp-journey.test.mjs
```

- Edit: root/workspace manifests, lockfile, changesets, API reports, affected package READMEs, `docs/index.md`, `roadmap.md`, `docs/release-0.2.7-evidence.md`, `plans/README.md`.
- Generated files are updated through repository commands, not hand-edited, where generators exist.

**Test Cases to Write First**

- Release contract fails on wrong package count/version/peer range, missing export/docs/API report, runtime dependency drift, or unchecked evidence link.
- Empty install and 0.2.6 upgrade both reach expected migration checksums and pass state conformance.
- Docs links/examples and runbook commands validate in CI-safe mode.
- Secret/canary scan covers source, logs, snapshots, evidence, backups, and generated artifacts.
- Full release command fails if protected HA/DR/journey evidence is absent, skipped, stale, or over budget.
- Roadmap contract requires the exact 0.3.0 production-readiness blocker after 0.2.7 completion.

**Documentation/Wiki Assessment**

- Public API impact: consolidate all additive APIs, compatibility notes, and examples in package docs and generated reports.
- Ensure `docs/index.md` links ERP messaging, saga recovery, approvals, audit export, credentials, HA, DR, classification, eval journey, and release evidence exactly once in the appropriate sections.
- No new wiki system is required; current docs navigation is sufficient. Final review must verify terminology avoids exactly-once, certification, WORM guarantees beyond sink acknowledgement, and premature ERP production-ready claims.

## Exit Gate

Release 0.2.7 is complete only when:

1. All task checkboxes are complete with linked, reproducible evidence.
2. Transactional and recovery invariants pass under rollback, duplicate delivery, uncertain outcome, process death, stale lease, and restore.
3. Approval, audit, secret, classification, tenant, and legal-hold negative tests pass.
4. Security, performance, storage, package, migration, and DR budgets pass without unexplained skips.
5. Protected ERP journey and deterministic invariant evals pass.
6. Overall “ERP production ready” status remains blocked pending the 0.3.0 live-service matrix.

## Compromises Made

- Cloud secret-manager adapters are deferred because no named consumer or protected path exists. Ceiling: zero Vault/AWS/Azure/GCP adapter coverage until a demand record names consumer, secret shape, bootstrap owner, endpoint policy, and tests. Owner: platform security.
- Backup size, restore time, RPO, and RTO are not invented without a disposable database and 0.2.7 schema. Ceiling: Task 7 cannot complete or pass release gates without measured evidence. Owner: database operations.
- One full-suite rerun exposed a pre-existing intermittent browser fixture failure (`downloads=0; released=false`); Task 0 records it and does not widen scope to fix it. Ceiling: Task 10 must resolve or explicitly quarantine it with retained reproduction before release closeout. Owner: browser/release owner.
- Protected PostgreSQL/NATS/live-provider legs remain blocked when required infrastructure is absent. Ceiling: blocked is never a passing skip; release evidence must record the required environment and operator. Owner: release owner.
- Outbox/inbox atomicity depends on the host using one caller-owned `PoolClient` transaction; the adapter cannot prove that a caller began/committed the transaction. Ceiling: transaction conformance tests and docs remain mandatory; add a host transaction wrapper only if repeated misuse appears. Owner: ERP application.
- Dispatcher has no background worker or remote-delivery callback; hosts own delivery, scheduling, metrics, and downstream idempotency. Ceiling: no built-in queue runtime; add one only for a named deployment demand. Owner: ERP application/SRE.
- Manual dead-letter/replay enforces verified tenant actor plus audit reference but delegates policy decision recording to the host. Ceiling: host must pair calls with policy/audit records; approval policy decisions remain a separate concern. Owner: security/governance.
- Approval authority is deliberately host-owned: `ApprovalAuthority.resolveRoles` and the `policyRevision` pin are host policy; Prism persists only accepted role grants/delegation chains and can never itself prove a principal's real-world role. Ceiling: role source, identity proofing, and policy bumps stay outside Prism by design; a shared role registry would be a separate demand. Owner: security/governance.
- Grant consumption is the release seam: `consume` verifies the stored grant still matches tenant/action/expiry/policy revision, but the host transaction is what makes action release atomic with consumption. After consumption, revocation cannot undo the effect (provenance-only; reconciliation is host work). Owner: ERP application/security.
- Approval decisions are stored append-only inside the request row (one locked row per request) rather than in a separate immutable table. Ceiling: history immutability relies on the row-lock transition contract plus deep-freeze; split to a decisions table only if audit requirements demand it. Owner: security/governance.
- Saga handlers remain host-owned and Prism cannot prove remote idempotency or verify an external audit reference. Ceiling: stable operation keys, explicit reconcile handlers, redacted bounded snapshots, and manual-intervention stop; add a host effect ledger/audit lookup only for a named integration demand. Owner: ERP application/security.
- Saga persistence uses a surrogate record through `WorkflowCheckpointAdapter` because the existing adapter owns workflow checkpoint shape. Ceiling: no saga-specific SQL/list API; add one only if protected operational queries require it. Owner: workflows/SRE.

- Audit export page tokens are one-shot: a failed batch is replayed from a bounded (one page ≤ 1,000 records / 10 MiB per tenant) in-memory uncommitted copy, never by re-reading the source. Ceiling: exporter memory holds the pending page across host restarts is not guaranteed — a host crash between signing and cursor save must re-export from the ledger source and risks a duplicate chain batch that the WORM sink must tolerate idempotently. Owner: host operator.
- SIEM mirroring is best-effort with replayable status: the exporter stores only `{batchId, digest, first, last}` pending entries (capped at 8); the host must supply the artifact bytes to `retryPendingSiem` (typically fetched from WORM). Ceiling: no exporter-side SIEM buffer; an un-mirrored batch older than the 8-entry cap is visible in cursor state to the host, not auto-retried. Owner: host operator.
- Legal-hold enforcement lives in the host source adapter; the exporter preserves the `legalHold` flag and never broadens tenant access, but cannot itself prove a hold was applied. Prism does not certify NIST/SIEM/WORM compliance programs; export is the transport. Owner: security/compliance.
- ERP journey substitutes are labelled and never converted into production claims: in-memory WORM/SIEM sinks (host owns the immutable store), in-memory saga checkpoint/lease stores (saga durability is proven in its own suite), and a logical pg-client backup/restore of ERP tables (comprehensive PITR is in the DR drill evidence). Ceiling: the protected journey proves control flow + invariant gates locally, not a managed WORM/SIEM/KMS deployment or cross-region replication. Owner: release operator.
- The protected journey fails (never skips) when `docs/_evidence/phase27-dr-evidence.json` is missing or stale, so the DR drill (Task 7) must run before the journey. Ceiling: journey + DR drill ordering dependency; the journey is not a substitute for the full DR rehearsal. Owner: release operator.
- Passing the protected ERP journey does not satisfy the 0.3.0 live-service matrix. Ceiling: ERP production-ready status remains blocked until the 0.3.0 live-service matrix is recorded separately. Owner: release owner.

## Further Actions

- Execute Task 5 only after a secret-manager demand record exists; Tasks 1–4 are complete with protected messaging evidence, workflow saga tests, approval unit + PostgreSQL integration coverage, and the audit-export tamper matrix.
- Task 5 closed with the demand gate held (all four providers deferred, nothing implemented; evidence includes the ambient-read audit). A future secret-manager demand record re-opens it; the registry in `scripts/phase27-freeze-manifest.json` and the machine gate `scripts/phase27-demand-gate.mjs` are the contract for that re-opening.
- Tasks 6–7 complete: protected two-replica failover drill (measured 4097 ms vs 9000 ms ceiling) and the backup/restore/migration-rollback/PITR rehearsal (measured RPO ≈ 0 s / RTO ≈ 1 s locally, recorded in `docs/_evidence/phase27-dr-evidence.json`). Next: Tasks 8–9 with protected classification and ERP journey evidence; do not convert local substitutes into production claims.
- Task 8 complete: field-level classification (`applyFieldPolicy`/`FieldPolicy`/`createProtectedFieldPolicy`) with fail-closed deny/redact-on-unknown default is live at the redaction, audit-export, and OpenTelemetry seams; 25 root tests + 2 OTel tests green; measured interleaved A/B overhead is 95.8%–99.8% of the pre-existing redactor-walk baseline (peak 99.8%, all ≤ the frozen 110% cap, recorded in `scripts/phase27-freeze-manifest.json` `measuredClassification`). The root tarball + frozen SDK export list were re-baselined deliberately for the additive field-policy surface; perf-benchmark subtest skips under `--experimental-test-coverage` (instrumentation skews the ratio). Next: Task 9 (protected ERP journey evidence) — complete; see the Task 9 further-action line below.
- Task 9 complete: deterministic ERP evals (`erpInvariantDataset` + `createErpInvariantScorers` in `@arnilo/prism-evals`, 8 hard-gate scorers consuming structured facts only) and the protected end-to-end journey (`scripts/phase27-erp-journey.test.mjs`) pass against real PostgreSQL with process-level failover; all 8 invariants score 1 (atomicity, single-local-effect, compensation, quorum-provenance, chain-verification, no-leak, fenced-failover, restore-equality); evidence at `docs/_evidence/phase27-erp-journey.json`; measured in `scripts/phase27-freeze-manifest.json` `measuredErpJourney` (durationMs 4815, restoreDigestMatch true, drEvidenceFresh true). The journey reuses the HA worker + DR evidence and fails (never skips) when DR evidence is missing/stale. Next: Task 10 (docs/migrations/release metadata closeout).
- Task 10 complete: release closeout. 50-package graph synchronized at 0.2.7 (`release.mjs bump --from 0.2.6 --to 0.2.7` + lockfile); `release:check` validates every manifest/peer/lockfile (only the missing `v0.2.7` git tag is an operator action); package-truth regenerated (50 publishable, peer spec 0.2.7); enterprise migrations 001-005 stable; docs/index.md + 0.1.0-readiness.md + release-and-install.md + CHANGELOG.md + migration.md advanced to the 0.2.7 current line; `### 0.2.7 publish handoff (plan 027 Task 10)` section + `## 0.2.6 → 0.2.7` migration note added; roadmap 0.2.7 checkboxes all checked (9 items) with the 0.3.0 blocker preserved; plans/README marks plan 027 complete; closeout contract `scripts/phase27-release.test.mjs` (12 assertions: version graph, migration stability, docs nav, roadmap blocker, evidence freshness, release-evidence, final manifest, secret scan 4456 files/0 findings, no connection-string leaks, terminology) wired into the root gate; final evidence manifest `scripts/phase27-release-evidence.json` (commit, tools, test totals, coverage, timings, budgets, protected surfaces, journey results, known limitations, 0.3.0 blocker, pending operator sign-off); compat baselines regenerated with `--update-baseline` for the reviewed additive 0.2.7 surface (5 files, zero removals); `npm run sdk:ready` exit 0 (typecheck/lint/format/test/coverage/pack-dry-run/release:gate all green). All 11 task checkboxes complete. Next: operator publishes the signed `v0.2.7` tag + npm OIDC and records the 0.3.0 live-service matrix.
- Task 10 closeout: docs/migrations/release metadata closed, all gates rerun green (npm test 0 failures, coverage green, freeze 9, release 12, budget 10, docs 141, sdk:ready 0), the known browser flake remains pre-existing/intermittent and quarantined in Task 0 evidence (not a 0.2.7 regression), and the explicit 0.3.0 live-service blocker is retained in roadmap + evidence doc + both machine manifests.
- Outside 0.2.7: record and execute the 0.3.0 live-service matrix before changing the overall status to ERP production ready.
