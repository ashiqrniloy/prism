# Messaging channel operations

## What it does

Operational contract for the `@arnilo/prism-channels` durable journal: what is persisted, in what order, what happens across restarts, and how an operator resolves work that cannot be proven. Read this with [Messaging channels](messaging-channels.md) (authorization and execution semantics) and [Agent session runtime](agent-session-runtime.md).

Everything here is a consumer of the generic `CheckpointStore`/`LeaseStore` contracts — no channel-specific SQL schema, no background work, no automatic replay.

## When to use it

Use when a host needs restart-safe bindings, admission dedup, claims and staged replies. Without `checkpoints` the runtime is single-process and restart-unsafe.

## Implementation example

```ts
import { createMessagingRuntime } from "@arnilo/prism-channels";
import { createSqlitePersistence } from "@arnilo/prism-core/sessions/sqlite";

const persistence = createSqlitePersistence({ filename: "./channels.sqlite" });

const runtime = createMessagingRuntime({
  authorize,
  resolveAgent,
  deliver,
  checkpoints: persistence.checkpoints,
  leases: persistence.leases, // optional: fencing when more than one worker can see the same binding
  limits: { retentionDays: 7 },
});
```

With `checkpoints`, a restart re-reads bindings, generations, dedup records and staged replies from the store; nothing is replayed on startup.

## Inputs / request

Records live in versioned namespaces (`prism.channels.v1.*`) with a `category` for host-side filtering. Keys embed the connection and the ownership scope (`tenant`, `account`, `user`), so a lookup in another scope misses rather than colliding, and the record carries the same scope so the store itself refuses a mismatched write.

| Namespace | Record | Contents |
| --- | --- | --- |
| `prism.channels.v1.binding` | `ChannelBindingRecord` | session id, branch leaf, alias, `/new` generation, suspended marker and run/operation correlation |
| `prism.channels.v1.operation` | `ChannelOperationRecord` | one admitted event: kind, external ids, state, run correlation (`runId`), reply flag, attempts |
| `prism.channels.v1.cursor` | `ChannelCursorRecord` | per-connection admitted count and last event id (ordering evidence only) |
| `prism.channels.v1.reply` | `ChannelReplyRecord` | the staged reply text (the only record with payload), delivery state, attempts, message id |
| `prism.channels.v1.control` | pairing or approval record | SHA-256 token hash, bound ids; approval records also bind principal, agent revision, session/run, pending-decision id, checkpoint version, outcome, expiry and consumed marker |

Operation keys use the deterministic operation id (`chan-op-<sha256 prefix>` of connection + event id), so admission dedup is a create-only CAS: the second writer loses and is acknowledged as a duplicate.

## Outputs / response / events

The store exposes single-record compare-and-swap only, so the order is explicit and each step is bounded:

1. **Authorize** the event against the host grant (no record yet; denial leaves nothing behind).
2. **Operation record** created as `accepted` (create-only CAS). This is the durable dedup and the transport acknowledgment point.
3. **Cursor advance** as ordering evidence, best-effort after the operation is committed.
4. **Claim**: `accepted` → `executing` by CAS (with the binding lease fence when `leases` is configured) *before* any provider or tool call.
5. **Run** the bound `AgentSession` turn with the verified identity. An event whose attachments cannot become text or model input settles `failed` with `errorCode: "unsupported_media"` and a bounded notice; declared attachment bytes over the channel cap are denied `oversized` before a record is claimed, and an oversize body is never buffered by the adapter.
6. **Operation terminal state** (`succeeded`/`failed`/`cancelled`/`suspended`) with run correlation, then the binding (leaf, suspended marker) is updated.
7. **Reply staged** as `pending`, then `deliver`, then `delivered` / `delivery_failed` / `delivery_unknown`.

Failure semantics by state:

| State | Meaning | Automatic action |
| --- | --- | --- |
| `accepted` | Journaled, never claimed | None. A crash here is a dead-letter; the user resends |
| `executing` | Claimed; provider work may have happened | None. Never replayed |
| `succeeded` / `failed` / `cancelled` | Terminal run outcome (current-run text only is ever sent) | None |
| `suspended` | Awaiting a core pending decision; blocks further ordinary turns on the binding | A short-lived server-issued allow/deny control resumes one decision, or `/cancel` submits core terminal denial; `/new` cannot bypass it |
| `execution_unknown` | A reconciling host filed unprovable claimed work | None; it is a dead-letter record |
| `abandoned` | Reconciled with no effect applied | None |
| reply `pending` / `delivery_unknown` | The send may or may not have landed | None. Only `reconcile` with an explicit acknowledgment |
| reply `delivery_failed` | Known transport failure (no ambiguity) | None. `reconcile` may resend without the acknowledgment |

A host notice (`runtime.notify`) is the same journal with no provider step: authorize `action: "notify"` → resolve the one bound pair → operation record of kind `notify` (create-only CAS on the caller `notifyId`, no cursor move) → stage the notice as `pending` → `deliver` → `delivered` / `delivery_failed` / `delivery_unknown` → `succeeded`. An unbound pair, another actor's binding, a foreign ownership scope, an ungranted/revoked identity, an unresolvable binding and capacity pressure are denied before any record exists; a repeated `notifyId` settles as a duplicate without a second delivery.

Two workers that see the same event cannot both run it: the loser's create-only CAS fails and it is acknowledged as a duplicate. A worker that loses the *binding lease* to another worker (different event, same binding) drops its own unclaimed record so the event stays retryable instead of dead-lettering silently.

## Request/response example

Nothing is replayed automatically — every entry point is an authorized call that derives ownership from a verified `AgentIdentity`:

```ts
// What still needs attention: unresolved states, plus settled operations whose reply was never confirmed.
await runtime.listUnresolved({ identity, limit: 100 });
// → [{ operationId, connectionId, state, replyState?, version, updatedAt }]

await runtime.reconcile({
  identity,
  connectionId,
  operationId,
  expectedVersion,             // from listUnresolved; a stale value is rejected
  acknowledgeDuplicateRisk: true, // required when an effect may already have happened
});
```

`reconcile` outcomes:

- `accepted` → `abandoned` (nothing ran; recorded as a dead-letter).
- `executing` → `execution_unknown`, **only** with `acknowledgeDuplicateRisk`; the model is never re-invoked.
- `pending` / `delivery_unknown` reply → resends the persisted text (acknowledgment required) and records `delivered` or `delivery_failed`; an ambiguous resend stays `delivery_unknown`.
- `delivery_failed` reply → resend without the acknowledgment, because the first attempt is known to have failed.
- Anything already settled → `outcome: "none"` (no second message).

Results are `resolved`, `not_found` (wrong scope or unknown id — never a foreign read), `conflict` (version mismatch or missing acknowledgment, with `detail: "duplicate_risk"`), `denied` (inactive identity) or `unavailable` (no store configured or the store failed).

There is no exactly-once claim. The journal guarantees that a recorded operation is not executed twice *by this runtime* and that a reply is never lost between the run and the send; it cannot retract a side effect the platform or a dispatched tool already accepted.

## Extension and configuration notes

### Leases and fencing

When `leases` is configured, a turn acquires a lease on its binding before the claim, renews it while work is queued on the route, passes the fencing token to journal writes, and releases it when the route goes idle or the runtime stops. If release fails, the runtime keeps its in-memory lease and retries on the next idle or stop path; it never treats the binding as free. `leaseTtlMs` remains the cross-process backstop.

The Telegram and experimental Signal adapters separately hold service-owned receiver leases. Signal uses `prism.channels.v1.signal.receiver` and writes a small readiness probe under that same service scope before `subscribeReceive`; it pauses/unsubscribes on writer or lease loss. It stores no inbound text/cursor because signal-cli manual notifications have no documented application acknowledgment or replay log.

- A lease held elsewhere defers the turn: it executes nothing and drops its unclaimed record (visible as `leaseLosses` in diagnostics).
- A lost or unrenewable lease fails closed: the claim is never written and the turn does not run.
- Fences only protect stored transitions — an already-issued network call is not retracted.

### Retention and cleanup

Retention is operator-driven; there is no background timer and no idle scan.

```ts
await runtime.prune({ identity }); // or { identity, now: "<iso>" } for a deterministic sweep
```

`prune` walks one bounded page (`maxJournalPage`) per namespace in the caller's ownership scope and deletes records whose own last-transition stamp is older than `retentionDays`, except: unresolved operations (`accepted`/`executing`), unsettled replies (`pending`/`delivery_unknown`), and bindings marked suspended. Cursor and expired/consumed control records are pruned with the rest. Repeated calls make progress; the delete count is returned as `{ scanned, deleted, retained }`.

Staged reply text is the only payload kept, bounded by `maxJournalRecordBytes` and pruned after retention — do not treat the journal as an archive.

### PostgreSQL outbox composition

A host that already runs the enterprise PostgreSQL outbox can record the reply in the same transaction as its own business mutation instead of sending from inside a model turn: `deliver` opens a caller-owned `PoolClient`, `BEGIN` → `outbox.append(client, …)` → `COMMIT`, and only then calls the adapter's `send`. The row is the durable record — an external send cannot be rolled back — so a crash between commit and send leaves the host free to re-drive delivery from the outbox (`dispatcher.claim`/`acknowledge`) rather than from the channel journal, and a repeated `deliver` for the same reply appends nothing new because `append` is idempotent on `(tenant_id, message_id)`.

The payload holds correlation ids only (`connectionId`, `eventId`, `kind`), never prompt or reply text, and the tenant comes from the resolved identity's ownership scope. Nothing in `@arnilo/prism-channels` knows about PostgreSQL: the composition lives in the host. See [the example](../examples/messaging-outbox.ts) and [Enterprise PostgreSQL state](enterprise-postgres-state.md).

### Operating a deployment

- **Startup**: construct the persistence, construct the runtime, then `listUnresolved` + `reconcile` what deserves a decision. Nothing self-heals in the background.
- **Shutdown**: `await runtime.stop()` aborts active runs, marks queued work cancelled (durably) and releases leases within `stopDeadlineMs`; then close the persistence.
- **Rolling restart**: use `leases` whenever two workers can see the same binding (webhook replicas, polling + webhook overlap), otherwise serialization is per process only.
- **Revocation**: a revoked identity fails before provider work and before delivery; already-accepted platform effects are not retractable.
- **Observability**: `runtime.diagnostics()` reports bounded counters only — including `storageFailures` (journal refused or unavailable) and `leaseLosses` (deferred or fenced out). No message text, external ids, tokens or key material is ever logged.

## Security and performance notes

All journal paths are bounded by the channel limits in [Messaging channels](messaging-channels.md): `maxJournalPage` (list page, ≤ 500), `maxJournalRecordBytes` (per-record value, checked before save), `retentionDays`, `leaseTtlMs` and the input/response caps that decide what may enter or leave the journal. Durable admission is one create and (after claim) one update plus the reply records; the plan's p95 target for durable admission is < 100 ms on a reference SSD excluding network and model time. The sqlite host suite times duplicate admission (journal CAS only) and keeps a generous CI bound of 500 ms so slow runners do not flake; treat 100 ms as the operator target, not the CI gate.

Process crash injection uses `scripts/fixtures/messaging-restart-worker.mjs`: SIGKILL leaves an `executing` record for authorized `reconcile` (never a second model/tool run). `reconcile` reuses the stored checkpoint fencing token so a crashed lease holder can still be filed as `execution_unknown` without waiting out `leaseTtlMs`. Graceful shutdown is `await runtime.stop()` (host SIGTERM handler); two sqlite connections on one file defer to the binding-lease holder.

Graceful shutdown is verified end to end, not just asserted: `scripts/fixtures/messaging-restart-worker.mjs` claims a real operation on sqlite, installs a `SIGTERM` handler that awaits `runtime.stop()`, and the claimed record lands as `cancelled` — never left `executing` — when the host's own shutdown path runs. The same worker under `SIGKILL` is the contrasting case (record stays `executing` for `reconcile`), and both are asserted in the package suite.

Soaks stay an operator decision, but the runner ships: `scripts/fixtures/messaging-soak.mjs` loops admit (including repeated event ids that must dedup) → drain → `listUnresolved`/`reconcile` → `prune` against a throwaway sqlite file and a mock provider. No network, no chat accounts, no credentials.

```bash
node scripts/fixtures/messaging-soak.mjs --durationMs 3000      # CI smoke (bounded, seconds)
node scripts/fixtures/messaging-soak.mjs --durationMs 259200000 # 72h operator soak; SIGINT/SIGTERM stops it cleanly
```

It prints one JSON summary (iterations, admissions, duplicate dedup count, deliveries, prune counts, `diagnostics()`, `unresolvedAtEnd`) and exits non-zero if a turn was denied, left unresolved or unsettled, failed, or delivered twice. The loop yields to the event loop periodically, so Ctrl-C/`SIGTERM` ends a long soak promptly instead of after the deadline, and the final sweep prunes with an aged cutoff so even a three-second run exercises deletion. For a soak against real state, keep the loop and swap sqlite for the production store; do not create contacts or accounts to soak.

## Related APIs

- [Messaging channels](messaging-channels.md) — contracts, authorization, execution semantics and limits.
- [Signal channel (experimental)](signal-channel.md) — manual receive, policy gate and receive-to-commit loss window.
- [Database persistence](database-persistence.md) and [Session stores](session-stores.md) — the checkpoint/lease contracts and the SQLite/PostgreSQL adapters.
- [Package README](../packages/prism-channels/README.md) — package boundary and peer-only install.