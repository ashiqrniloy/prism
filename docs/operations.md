# Operations runbook: high availability, failover, and fencing

## What it does

This page is the operator runbook for the high-availability story proven by plan 027 Task 6: two replicas can serve, inspect, cancel, resume, and reconcile durable ACP/workflow/saga/outbox/export operations after either replica dies. Correctness never depends on a dead process's in-memory registry — it comes from the durable `LeaseStore` (owner, token, fencing counter, expiry, renewal), the `CheckpointStore` (version CAS plus monotonic fencing token), and idempotent side-effect sinks such as the ERP outbox (`ON CONFLICT DO NOTHING` on a stable message id). The two-process proof is `scripts/phase27-ha-worker.mjs` orchestrated by `scripts/phase27-ha.test.mjs`, which records exact commands, process IDs, injected failures, timings, and durable final states in `docs/_evidence/phase27-ha-evidence.json`.

## When to use it

- Before running any multi-replica deployment of the server, workflow coordinator, saga runner, ACP host, or enterprise dispatcher — read the local-registry limitations and the lease/fence model.
- When an operator or on-call engineer sees a hung lease, an uncertain commit, or a split-brain suspicion: follow "Failover procedure" and "Uncertain commits" below before touching anything.
- When sizing leases: the failover ceiling is lease TTL plus the peer's acquisition poll interval; the drill asserts `failoverMs <= ttlMs + 5000`.

## Inputs / request

- A `LeaseStore` and `CheckpointStore` backed by the same durable store (PostgreSQL through `createPostgresPersistence`, or the corresponding production adapter). Lease keys carry an ownership scope (tenant/account/user) that is part of the trust boundary.
- Operations that need a leader: `acquireLease({ namespace, key, ownerId, ttlMs })` returns a lease with `token` and monotonic `fencingToken`, or `null` while another owner holds it.
- Durable progress: `saveCheckpoint({ namespace, key, version, expectedVersion, fencingToken, value })` — versions strictly increase, `expectedVersion` must match the current version, and a lower or absent fencing token can never replace a fenced record.
- Idempotent side effects: give every external effect a stable id (ERP outbox `messageId` is the designed carrier) so replay is safe.

## Outputs / response / events

- A lease record: `{ namespace, key, ownerId, token, fencingToken, acquiredAt, expiresAt, updatedAt }`. Expired rows retain their fencing counter; the next owner inherits `fencingToken + 1`.
- A checkpoint record: `{ namespace, key, version, fencingToken?, value, createdAt, updatedAt }`. Cursor/value changes are CAS-committed; a peer can replay an unfinished step but can never skip ahead or move the cursor backward.
- Failover timing: the drill reports `failoverMs` (wall time between the owner's death and the peer's acquisition) and asserts it against the frozen ceiling.

## Request/response example

```ts
const lease = await stores.leases.tryAcquireLease({
  namespace: "erp.ops", key: "invoice-42", ownerId: "worker-b", ttlMs: 30_000,
});
if (!lease) return "another replica owns invoice-42";
await stores.checkpoints.saveCheckpoint({
  namespace: "erp.ops", key: "invoice-42",
  version: 3, expectedVersion: 2, fencingToken: lease.fencingToken,
  value: { cursor: 2, steps: ["reserve", "charge"] },
});
// Side effect with a stable id (idempotent replay):
await outbox.append(client, { tenantId, messageId: "pay-t/invoice-42/charge", topic: "erp.payment.requested", payload });
await stores.leases.releaseLease({ namespace: "erp.ops", key: "invoice-42", ownerId: "worker-b", token: lease.token });
```

## Implementation example

```sh
# Protected two-replica drill (requires PRISM_TEST_POSTGRES_URL; Docker image
# postgres:16-alpine is the local stand-in). Recorded evidence lands in
# docs/_evidence/phase27-ha-evidence.json.
`PRISM_TEST_POSTGRES_URL` set to the protected connection string (locally a disposable `postgres:16-alpine` container): `node --test scripts/phase27-ha.test.mjs`
```

The drill: worker A acquires, heartbeats, commits the charge effect into the
outbox, and is SIGKILLed inside the window between the effect commit and its
final cursor save. Worker B (separate process, own pool, no access to A's
registry) reads the durable state, waits out the lease expiry, acquires,
replays the uncertain commit idempotently (outbox count stays 1), finishes,
and releases. A stale-fence/stale-revision write and an old-token renewal are
rejected; two simultaneous acquisitions yield exactly one owner; a foreign
tenant's reads, writes, and lease takeover all fail closed.

## Extension and configuration notes

- Lease TTL is the availability knob: too short spams contention, too long
  delays failover. The frozen drill ceiling is `ttlMs + 5000` ms; renew at
  `ttlMs / 3` (the workflow coordinator, saga engine, and this drill all
  follow this pattern).
- Local in-memory registries (workflow active-run map, coordinator active
  map, A2A live-task registry, ACP session registry, coding-agent sessions,
  RPC active runs) are optional fast paths only. On restart, every component
  reloads authority, status, and cursors from durable stores; a killed
  replica's registry is never required to make progress.
- SIEM/alerting: emit owner/fence/lease-age/state metadata only — never tenant
  payloads, tokens, or credentials. Metrics to watch: lease-acquire latency,
  fence counter jumps (a jump means a takeover happened), and outbox pending
  depth.

## Security and performance notes

- Fencing is enforced at the store: a stale owner's write fails with
  `ERR_PRISM_CHECKPOINT_CONFLICT` (stale version, failed CAS, or stale
  fencing token), and a stale token's renewal returns `null`. There is
  intentionally no "force unlock" operation — deleting a lease row manually
  bypasses fencing and can cause split-brain writes; never do it.
- Tenant ownership is checked on every durable read/write; cross-tenant
  reads, saves, and lease acquisitions fail closed with ownership-mismatch
  errors.
- An uncertain commit (side effect landed, cursor not advanced) is resolved
  by replaying the effect with its stable id — never by guessing. Reload
  durable state before any retry; retries that skip the reload risk
  overwriting a peer's fenced progress.
- Failover is bounded but not instantaneous: the peer cannot acquire until
  the lease expires, so recovery time is at least the remaining TTL.
  Performance is linear in record size; the drill records contention/latency
  with bounded, jittered acquisition polls (no hot loops) and reports the
  measured numbers in the evidence JSON.

## Live probe (plans/064 Task 9)

The outbound webhook notifier has an operator-gated live probe against a receiver you own:

```bash
PRISM_TEST_WEBHOOK_URL=https://ops.example.com/hooks/prism \
PRISM_TEST_WEBHOOK_SECRET=<at-least-32-byte-shared-key> npm test -w @arnilo/prism-core -- webhooks-live
```

Probes: one signed delivery to your receiver (verify `x-prism-signature: sha256=<hex>` over the raw body) and a retry-after-5xx leg over a local loopback receiver (500 then 200, signature verified, retries recorded). Bounded to 1 real request + ≤ 2 loopback requests. Registered in `scripts/live-matrix.json` as `core/webhooks-live`.

## Related APIs

- `LeaseStore` / `CheckpointStore` — the durable contracts this runbook relies on.
- `createPostgresPersistence` — the PostgreSQL adapter used by the drill.
- `ErpOutboxStore` — the idempotent side-effect carrier used to make replay safe.
- `createWorkflowCoordinator` and `defineSaga`/`runSaga`/`resumeSaga` — higher-level consumers with the same fencing/cursor semantics.
- `scripts/phase27-ha-worker.mjs` / `scripts/phase27-ha.test.mjs` — the reproducible drill; `docs/_evidence/phase27-ha-evidence.json` — the recorded run.
- [Signed, hash-chained audit export](audit-export.md) — the cursor/CAS pattern applied to audit exports.