# Phase 22 (0.2.2) primitive review — concurrent state and durability integrity

Evidence file for plan 022 Task 0 (`plans/022-Release-0-2-2-Concurrent-State-and-Durability-Integrity.md`).
Reviewed 2026-08-13 at HEAD `7aa4684` (Release 0.2.1 baseline). Scope: the four roadmap 0.2.2
items — atomic model-budget reservation, atomic conversation metadata, single-consumer/resumable
registry semantics, and multi-process state conformance. Method: reuse-first inventory of what
already exists, then a written gap analysis per item; a new primitive is proposed only where a
real gap exists, and each new primitive ships with its concrete first consumers in the same
phase (no single-consumer extraction). This document is intentionally tarball-excluded
(`package.json` `files` excludes `docs/_evidence`) like its phase 18/19/20/21 predecessors;
nothing here changes public behavior.

Six decisions are approved by this review:

1. **Reservation becomes the router's budget admission authority** as three additive methods on
   the existing `ModelRouterStateStore` contract (`reserveBudget`/`commitBudget`/`releaseBudget`),
   reusing the fencing-token precedent already proven by `LeaseStore` and the probe-token
   precedent already used by the circuit path. The current `readBudget` → (run) → `addUsage`
   sequence is a confirmed TOCTOU: two concurrent admissions can both pass `readBudget` and both
   charge later, collectively exceeding the window budget. The reservation atomically decrements
   remaining capacity (max − used − reserved) at admission; `commitBudget` applies the actual
   usage delta at outcome; `releaseBudget` returns an uncommitted reservation; a TTL-expired
   reservation is reconciled deterministically (late commit charges the reserved amount and
   emits a redacted `unknown_usage` diagnostic, never a silent drop). `consumeRate` stays the
   rate-limit authority (it is already atomic); `addUsage` stays for retrospective accounting.
2. **`appendSession` gains an additive CAS guard** (`expectedVersion`), mirroring the
   `CheckpointStore.saveCheckpoint` `version`/`expectedVersion`/`fencingToken` shape that already
   lives at `src/contracts-core.ts:1095-1127`. `SessionRecord` gains an optional `version`;
   `ConversationThread` gains a projected `version`; the conversation service issues
   `expectedVersion`-guarded writes for explicit-id `create` (create-only), `branch`, and
   `archive`, returning `metadata_conflict` instead of silently overwriting. The append-only
   `prism_conversation_branches` table is the documented fallback for hosts whose session table
   cannot add a column — not the primary approach.
3. **`createEventMultiplexer` rejects a second concurrent subscriber.** The multiplexer is
   documented single-consumer and its implementation has exactly one parked-waiter slot; a second
   concurrent `subscribe()` today silently corrupts delivery (two consumers share one waiter).
   The rejection is additive (`EventMultiplexerError`, code
   `ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER`); a done/closed/aborted first consumer frees the
   slot. A broadcast mode is rejected (bigger surface, no host demand; the NATS/Postgres event
   sources' own `subscribe` already supports multiple consumers for the broadcast case).
4. **NATS durable identity becomes restart-stable.** `durableName` at
   `packages/session-store-nats/src/event-source.ts:447-452` appends `randomBytes(4).toString("hex")`
   to every call, so each `subscribe` mints a fresh durable consumer and restart resume
   re-replays rather than continuing from the last ack. The suffix is dropped for the durable
   path (`prism_<hmac16>`); `ephemeralName` keeps random suffixes for `page`/`cleanup` consumers
   (correct there — they are deleted in a `finally`). The ownership-HMAC binding and the
   `activeSubscribers` cap are retained.
5. **The in-process active-run registry gets a bounded lifecycle, and the other two candidate
   registries are confirmed out of scope.** `packages/workflows/src/active-runs.ts` is a
   module-level `Map` whose only removal path is the `finally` in `run.ts:353`; a run whose
   promise never settles leaks forever. It gains a bounded sweep (registration `startedAt`
   already exists). `src/agent-session.ts:160-161` (`activeRun`/`activeRunId`) is a per-session
   instance field with a single-active-run guard (line 1349) — not a registry. `src/rpc.ts:76,141`
   is a per-`createRpcHandler`-loop `Map` deleted on completion — bounded by loop lifetime.
   Both are documented out of scope; no code change.
6. **One multi-process state conformance harness.** `src/testing/state-concurrency-conformance.ts`
   (new, dependency-free, runner-free like `assertAgentEventSourceConforms` /
   `runRunLedgerConformance` / `runSessionStoreConformance`) exercises approval, cursor,
   checkpoint CAS, idempotency, router reservation, conversation metadata, and unknown-outcome
   recovery against memory + durable (Postgres; SQLite; NATS via the existing fake-jetstream
   seam) factories, with deterministic barriers and no timing-only sleeps. NATS has no root
   `test:nats` script; NATS conformance runs in the workspace `npm test` against
   `packages/session-store-nats/src/__tests__/fake-jetstream.ts`, and real-NATS durable probes
   stay protected evidence (0.3.0 keeps the live suite).

---

## 1. Atomic model-budget reservation (plan Task 1)

### Primitive inventory (what already exists)

| Primitive | Location | What it gives this item |
| --- | --- | --- |
| `ModelRouterStateStore` contract | `packages/model-router/src/types.ts` | `consumeRate` (atomic admit/deny), `readBudget` (read-only), `addUsage` (post-hoc charge), `claimCircuitProbe`/`recordCircuitOutcome` (probe token + outcome), `cleanup`. No reserve/commit/release. |
| Router admission path | `packages/model-router/src/router.ts` `assertBudget` (~223), `assertRate` (~231), `claimCircuitProbe`, `recordUsage`→`addUsage` (~375) | `assertBudget` = `readBudget` then compare against `maxTokens`/`maxCostUsd` — two concurrent `resolve` calls both read the same used amount and both admit. Usage is charged later by host `recordUsage`. |
| Probe-token fencing precedent | `router.ts` `circuitProbeToken` + `state.ts` `probeToken`/`probeExpiresAt` | The circuit path already proves atomic claim + TTL expiry + outcome-match in both stores — the reservation lifecycle is the same shape with a budget amount instead of a probe. |
| `LeaseStore` fencing precedent | `src/contracts-core.ts:1162-1168` | `tryAcquireLease`/`renewLease`/`releaseLease` with monotonic `fencingToken`; expired rows retain fencing counters. The reuse target for reservation fencing. |
| `CheckpointStore` version/CAS precedent | `src/contracts-core.ts:1125-1128` (`expectedVersion` 1095, `fencingToken` 1097) | The in-repo optimistic-concurrency shape; reused directly by Task 2. |
| Memory store | `packages/model-router/src/state.ts` | `rates`/`budgets`/`circuits` `Map`s; `keyOf`/`sameOwner`/`validateKey`; `evictClosedCircuit` caps **circuits only** (`maxCircuitKeys`); `cleanup` removes expired windows (rates/budgets) and idle closed circuits (`CIRCUIT_IDLE_TTL_MS` 24h) within `HARD_CLEANUP_LIMIT` 500. **`rates`/`budgets` Maps are unbounded** — no `maxRateKeys`/`maxBudgetKeys`. |
| Durable store | `packages/enterprise-postgres/src/model-router.ts` | Atomic UPSERTs with `clock_timestamp()` for rates/budgets; circuits under `withTransaction` (SERIALIZABLE, `MAX_TRANSACTION_ATTEMPTS` 3, serialization-failure retry with backoff); `ensureCircuitCapacity` caps circuits; `reopenExpiredProbes` + `deleteExpiredRouterRows` (expiry-based cleanup). Rates/budgets tables carry `expires_at`/`last_used_at` but no cap enforcement. `randomUUID` already imported for probe tokens — reusable for `reservationId`. |

### Confirmed defect walkthrough

At 0.2.1, two `router.resolve` calls for the same key race: both await `readBudget`, both see
`used = 0 < max`, both admit, then each host reports usage via `recordUsage` → `addUsage`. The
budget window ends at `2 × usage` with both runs admitted — the roadmap's "parallel admissions
cannot exceed reserved budget" is violated. The durable store's `addUsage` is atomic only for
the increment itself; nothing prevents the second admission. Additionally, `rates`/`budgets`
Maps grow without bound in the memory store (circuits are capped; rates/budgets are not), and
the Postgres `prism_model_router_budgets` table has no key cap either — the roadmap's
cap/evict requirement is unmet for two of the three maps/tables.

### Gap analysis

**Already achievable today:** atomic per-row UPSERTs in Postgres, atomic Map mutations in the
memory store, a transaction helper, a fencing-token precedent, a probe-token-with-TTL precedent,
and a cleanup sweep with limits.

**The gap:** there is no *reservation* — no way to atomically decrement remaining capacity at
admission and reconcile it at outcome. `readBudget`+`addUsage` cannot express it. And the
cap/evict requirement applies only to circuits today, not to rate/budget state.

### Approved decision

Add three additive methods to `ModelRouterStateStore` (memory + Postgres behind one contract),
plus forward-only reservation columns on `prism_model_router_budgets`:

- `reserveBudget({ key, tokens?, costUsd?, windowMs, reservationTtlMs, now })` →
  `{ reservationId, fencingToken, admitted, retryAfterMs? }`. Atomic decrement of remaining
  capacity (max − used − reserved) with a TTL-bounded reservation row; admits only if the full
  requested amount fits. `reservationId` = `randomUUID()`; `fencingToken` = monotonic counter
  stored with the reservation (the `LeaseStore` precedent).
- `commitBudget({ key, reservationId, fencingToken, tokens?, costUsd?, windowMs, now })`:
  applies the actual usage delta (positive or negative) versus the reserved amount; releases
  the remainder. A commit arriving after the reservation TTL charged the reserved amount is a
  redacted `unknown_usage` diagnostic (deterministic reconciliation, never a silent drop).
- `releaseBudget({ key, reservationId, fencingToken, now })`: releases an uncommitted
  reservation; stale/foreign fencing tokens are rejected (`ERR_PRISM_MODEL_ROUTER_STATE`).
- Router: `assertBudget` becomes `reserveBudget` at admission (fail-closed on overflow); run
  outcome routes to `commitBudget`/`releaseBudget` (the router's `resolve` returns the
  reservation id alongside `circuitProbeToken`, or a new outcome handle; Task 1 decides the
  diff shape); `consumeRate` stays the rate authority; `addUsage` stays for retrospective
  accounting.
- Cap/evict: add `maxRateKeys`/`maxBudgetKeys` to `ModelRouterLimits`/`ResolvedModelRouterLimits`;
  memory store evicts LRU by `lastUsed` on insert (the `evictClosedCircuit` pattern extended to
  rates/budgets); Postgres gains the same cap via a bounded delete. Reservations pin their
  budget row (a held reservation is never evicted).

**Rejected:** a second reservation primitive (the lease/probe/circuit tokens already prove the
shape), a generic lock/transaction framework (the existing `withTransaction` suffices), a new
reservation table (one table keeps window accounting atomic; columns are additive and nullable,
so 0.2.1 readers ignore them).

---

## 2. Atomic conversation metadata updates (plan Task 2)

### Primitive inventory (what already exists)

| Primitive | Location | What it gives this item |
| --- | --- | --- |
| `SessionRecord` | `src/contracts-core.ts:1170` | Ownership + `id`/`createdAt`/`updatedAt`/`metadata`. **No `version` field.** |
| `ProductionPersistenceStore.appendSession` | `src/contracts-core.ts:1437` | `appendSession?(record: SessionRecord): Promise<void>` — blind upsert, no CAS, returns void. |
| Postgres implementation | `packages/session-store-postgres/src/persistence.ts:500-520` | `INSERT ... ON CONFLICT(id) DO UPDATE SET updated_at = EXCLUDED.updated_at, metadata = EXCLUDED.metadata` — the last writer wins regardless of what it read. |
| SQLite implementation | `packages/session-store-sqlite/src/persistence.ts:524` | Same blind upsert shape. |
| `CheckpointStore.saveCheckpoint` | `src/contracts-core.ts:1125-1128` | The exact CAS shape to mirror: `version` (strictly increasing), `expectedVersion` ("0 for create-only"), `fencingToken`; rejection on mismatch. |
| Conversation service | `packages/server/src/conversations.ts` | `writeMarker` (blind `appendSession` of the marker); `create` with explicit id does get-or-create (read, then blind write — `ponytail:` comment admits the race); `branch`/`archive` read-modify-write with `ponytail:` lost-update comment; branch cap checked on the read value (approximate); `archive` no-ops on archived; `continue` rejects archived; `delete` routes through `lifecycle.applyRetention` (legal holds win; deletion purges the ledger). |
| Thread projection | `src/conversations.ts` `conversationThreadFromRecord`, `CONVERSATION_METADATA_KEY`, `conversationMarkerMetadata` | Marker parse + serialize. `ConversationThread` has **no `version`** today. |
| Ownership enforcement | `packages/server/src/conversations.ts` `assertOwnership`, `assertIdentityMatchesOwnership` (core) | Ownership is checked at the service boundary on every call; the store-level upsert itself is not ownership-guarded (id keys). |

### Confirmed defect walkthrough

At 0.2.1: two concurrent `branch` calls read the same thread (N branches), both pass the
`maxActiveBranches` cap check, both write `branches: [...read.branches, own]` — one branch ref is
lost (the `ponytail:` comment at `server/conversations.ts` `branch()`). A `branch` racing an
`archive` writes `state: "active"` from its stale read after the archive landed — the archived
thread is silently revived to active. A duplicate explicit-id `create` reads nothing, writes its
marker over an existing thread's metadata, and both callers receive a thread — the first
caller's marker is overwritten. None of these are detectable by callers because `appendSession`
returns void and there is no version to compare.

### Gap analysis

**Already achievable today:** the CAS shape exists verbatim in `CheckpointStore`; the stores
already run UPSERTs that can carry a `WHERE version = expected` guard; the service already
enforces ownership at the boundary.

**The gap:** `SessionRecord`/`appendSession` have no version, the stores' upserts have no guard,
and the service has no conflict path. The read-modify-write ceilings are documented in code
(`ponytail:` comments) and are exactly the roadmap's items 8 (concurrent branch/archive/create
preserve valid state) and 2 (stale archive resurrection).

### Approved decision

- Add `version?: number` to `SessionRecord` (default unversioned) and `expectedVersion?: number`
  to the `appendSession` input; the write returns `{ version }` (additive — existing void
  callers keep last-write-wins byte-identically when they omit `expectedVersion`).
- All three stores (Postgres, SQLite, memory path) guard the upsert with
  `WHERE version = $expected` (Postgres/SQLite: `version = version + 1` on update; `expectedVersion
  = 0` = create-only). Mismatch → `metadata_conflict` with the current version; ownership fields
  are set on create and never overwritten by an update (unchanged contract).
- `ConversationThread` gains a projected `version` (`conversationThreadFromRecord` reads
  `record.version`); `createConversationService` issues CAS writes: explicit-id `create` uses
  `expectedVersion: 0` (get-or-create becomes create-only — duplicate create returns
  `metadata_conflict` or the existing thread; Task 2 decides the exact surface), `branch` and
  `archive` use `expectedVersion: thread.version`. Branch-cap enforcement moves inside the same
  guarded write (count under the cap within the transaction) so the cap is exact, not
  approximate. `archive` racing a branch fails `metadata_conflict`; the thread stays archived.
  Delete/retention/legal-hold races keep the lifecycle as the arbiter (holds win; deletion
  purges; a CAS write after purge fails `not_found` — no resurrection).
- The `ponytail:` comments in `server/conversations.ts` are removed once the CAS path lands.

**Rejected:** a new `updateConversationMetadata` method (duplicates `appendSession`), automatic
retry-on-conflict in the service (masks genuine races), append-only branch records as the
primary approach (fallback only — CAS covers create/archive too and needs no new table/join).

---

## 3. Single-consumer, restart-stable NATS identity, bounded active-run registry (plan Task 3)

### Primitive inventory (what already exists)

| Primitive | Location | What it gives this item |
| --- | --- | --- |
| `createEventMultiplexer` | `src/event-multiplexer.ts` | Bounded fan-in (`maxQueuedEvents` 1024 default, overflow close/drop policies), `publish`/`observe`/`subscribe`/`close`, **one parked-waiter slot** (`waiter` variable). Documented single-consumer; `subscribe()` is an async generator with **no second-subscriber rejection** — a second concurrent generator shares the waiter and both lose events. |
| NATS `durableName` | `packages/session-store-nats/src/event-source.ts:447-452` | `prism_${hmac16}_${randomBytes(4).hex}` — ownership-HMAC-bound (`tenantId|sessionId|runId`) but **random-suffixed per call**, so every `subscribe` mints a new durable consumer and restart resume cannot continue from the last ack. |
| NATS `ephemeralName` | `event-source.ts:455` | `prism_${kind}_${randomBytes(6).hex}` for `page`/`cleanup` consumers — deleted in a `finally`; random is correct here. |
| NATS subscriber cap | `event-source.ts:86,143` | `activeSubscribers` `Set` + `maxSubscribers` — already rejects excess subscribers. |
| Workflow active-run registry | `packages/workflows/src/active-runs.ts` | Module-level `Map` keyed by `JSON [workflowId, runId, exactOwnershipKey]`; `registerActiveWorkflowRun` (throws `ERR_PRISM_WORKFLOW_ALREADY_ACTIVE` on duplicate), `unregisterActiveWorkflowRun`, `getActiveWorkflowRun`, `abortActiveWorkflowRun` (definition-hash guarded), `listActiveWorkflowRuns` (ownership-isolated). `startedAt` already recorded. Only removal path: `unregisterActiveWorkflowRun` in the `finally` at `packages/workflows/src/run.ts:353`. |
| `agent-session` "registry" | `src/agent-session.ts:160-161,1349` | `activeRun`/`activeRunId` **per-session instance fields** with a single-active-run guard — not a module-level registry; no leak across sessions. Out of scope. |
| `rpc` "registry" | `src/rpc.ts:76,141` | `activeRuns` `Map` **per `createRpcHandler` loop**, deleted when each run settles; bounded by the loop's lifetime. Out of scope. |
| Fake NATS seam | `packages/session-store-nats/src/__tests__/fake-jetstream.ts` | Network-free JetStream fake for `event-source.test.ts`; the seam the conformance harness reuses (no root `test:nats` script exists; NATS tests run in the workspace `npm test`). |

### Confirmed defect walkthrough

At 0.2.1: two concurrent `mux.subscribe()` calls on one multiplexer both await the same `waiter`
promise; whichever resolves first consumes the value, the other blocks on a promise that may
never resolve — events are lost or delivered to the wrong consumer with no error (silent queue
corruption). On NATS, a durable `subscribe`, crash, restart sequence mints a fresh
`prism_<digest>_<random>` consumer each time: the durable cursor is never reused, so replay
restarts from the requested sequence instead of continuing from the last ack, and orphaned
consumers accumulate until the stream is cleaned. In workflows, an active run whose promise
never settles (e.g. an aborted host that never awaits the run) is never unregistered — the
module-level `Map` entry leaks until process exit, and duplicate `runId` registration then
throws `ERR_PRISM_WORKFLOW_ALREADY_ACTIVE` for a run that no longer exists.

### Gap analysis

**Already achievable today:** the multiplexer's single-waiter design, the NATS ownership HMAC +
subscriber cap, the registry's ownership-isolated keying and `startedAt`, and the fake-jetstream
seam.

**The gap:** no second-subscriber rejection (silent corruption), no restart-stable durable name
(cursor resume defeated), no registry lifecycle bound (leak forever). No durability primitive is
missing; the roadmap asks for rejection, stability, and bounded cleanup — all additive.

### Approved decision

- `EventMultiplexer`: track one active consumer; a second `subscribe()` while one is active
  throws `EventMultiplexerError` (`ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER`); the slot frees
  when the first consumer's iterator returns `done`, is `return()`ed (close/abort of the
  consumer), or the multiplexer closes. `observe` fan-in unchanged. Broadcast is rejected
  (decision 3 above).
- NATS: `durableName` drops the random suffix (`prism_<hmac16>`); restart resume reuses the
  durable consumer's last-acked position; orphaned pre-0.2.2 random-suffixed consumers are
  reclaimed by the existing `deleteConsumer`/cleanup paths (documented in migration). `page`/
  `cleanup` keep `ephemeralName`.
- Workflows registry: bounded lifecycle sweep — on registry close/abort and on cap overflow,
  evict aborted/leaked entries by oldest `startedAt`; document the registry as non-durable,
  in-process only (durable active-run recovery stays 0.2.6). `agent-session`/`rpc` are confirmed
  out of scope (per-instance/per-loop by construction; documented, no code change).

---

## 4. Multi-process state conformance (plan Task 4)

### Primitive inventory (what already exists)

| Primitive | Location | What it gives this item |
| --- | --- | --- |
| Conformance-helper pattern | `src/testing/agent-event-source-conformance.ts:8` (`assertAgentEventSourceConforms(factory)`), `src/testing/run-ledger-conformance.ts`, `src/testing/session-store-conformance.ts`, `src/testing/tool-effect-store-conformance.ts` | Runner-free async assert functions parameterized by a store factory — the exact shape for a state-concurrency harness. |
| Durable gate | `package.json` `test:postgres` (line 153) | `require-postgres-url.mjs` + workspace Postgres/SQLite/enterprise tests + `phase7-conformance.test.mjs` + `phase12-restart-recovery.test.mjs`. |
| Threat-suite gate | `package.json` `security:threat-suites` (line 159) | `phase8-11` + `phase20-security` + `phase21-security` legs. |
| Approval/cursor/checkpoint/idempotency domains | `src/approval.ts`-related stores, `AgentEventSource` cursors (HMAC-signed), `CheckpointStore`, idempotency stores (Postgres `work-idempotency.ts`, memory) | Each domain already has isolated conformance; none exercises all seven domains against memory + durable in one concurrency harness. |
| No-timing-sleeps rule | conformance tests today | Existing helpers use deterministic await/assert; the harness keeps the rule (grep `setTimeout(` → zero in new files). |

### Gap analysis

**Already achievable today:** per-domain conformance against memory and durable factories; the
gate wiring; the restart-recovery script precedent (`phase12-restart-recovery.test.mjs`).

**The gap:** no single harness proves that memory and durable implementations agree under
*concurrency* for approval, cursor, checkpoint CAS, idempotency, router reservation, conversation
metadata, and unknown-outcome recovery — the roadmap's item 4. Per-adapter ad-hoc tests cannot
assert agreement.

### Approved decision

One dependency-free harness `src/testing/state-concurrency-conformance.ts` exporting
`assertStateConcurrencyConforms(factory: StateConcurrencyFactories)` with seven probes
(approval determinism; cursor resume across re-open; checkpoint CAS stale-version/fence
rejection; idempotency-key replay; parallel router reservation non-oversubscription; concurrent
conversation branch/archive/create valid-state-or-conflict; abandoned-reservation unknown-outcome
reconciliation). Factories: memory (default `npm test`), Postgres + SQLite (`test:postgres`),
NATS (workspace `npm test` via fake-jetstream; real-NATS durable probes stay protected
evidence). New `./testing/state-concurrency-conformance` subpath export mirrors the existing
conformance subpaths. A `phase22-conformance.test.mjs` leg asserts the harness ran against every
available store and that missing protected env records blocked-not-skipped.

---

## 5. Cross-cutting decisions

### Operational ownership

| Item | Owner | Evidence gate |
| --- | --- | --- |
| Router reservation + cap/evict | `@arnilo/prism-model-router` maintainer; `@arnilo/prism-enterprise-postgres` durable impl | Unit + memory/Postgres conformance agreement + built/packed (no protected env) |
| `appendSession` CAS + conversation service | core persistence + `@arnilo/prism-server` conversation maintainers; `@arnilo/prism-session-store-postgres`/`sqlite` adapters | Unit + tri-store conformance agreement + built/packed; **protected Postgres conversation-race evidence** (missing → 0.2.2 blocked, not skipped) |
| `EventMultiplexer` single-consumer | core `src/event-multiplexer.ts` maintainer | Unit + built/packed (no protected env) |
| NATS restart-stable durable identity | `@arnilo/prism-session-store-nats` maintainer | Fake-seam conformance + built/packed; **protected real-NATS restart evidence** (blocked, not skipped) |
| Workflow registry bounded lifecycle | `@arnilo/prism-workflows` maintainer | Unit + built/packed (no protected env) |
| Multi-process conformance harness | core `src/testing/` maintainer | Memory in default `npm test`; durable in `test:postgres` + workspace NATS; `phase22-conformance` gate |
| Release/security sign-off | Prism operator `arn` | Full phase-22 baseline exit evidence, signed tag, OIDC provenance |

### Migration decisions

- **Router reservation:** no persisted shape change for existing rows; additive nullable
  reservation columns on `prism_model_router_budgets` (forward-only migration; 0.2.1 readers
  ignore them). Hosts calling `addUsage` directly keep working (retrospective accounting
  remains); the router itself reserves first. A host that disabled the state store keeps the
  same no-op behavior.
- **`appendSession` CAS:** additive `version`/`expectedVersion`; callers that omit
  `expectedVersion` keep 0.2.1 last-write-wins byte-identically. `ConversationThread.version`
  is a projected additive field. The new `metadata_conflict` error is documented; explicit-id
  `create` becomes create-only under CAS (duplicate create returns the conflict or the existing
  thread — Task 2 decides the exact surface; the plan's acceptance criteria already name
  "returns the existing thread rather than overwriting").
- **EventMultiplexer:** a second concurrent `subscribe()` now throws; the documented
  single-consumer pattern is unchanged. Accidental multi-subscription must split into two
  multiplexers.
- **NATS:** durable consumer names drop the random suffix; in-flight 0.2.1 consumers are
  orphaned on upgrade and reclaimed by existing cleanup; cursor resume continues from the last
  ack after upgrade. No persisted message change.
- **Workflow registry:** in-process registries gain bounded cleanup; leaked registrations are
  swept. Documented non-durable; durable recovery stays 0.2.6.
- **Rollback:** restoring 0.2.1 restores the four concurrency gaps and is not a production
  mitigation; concurrent writers must be quiesced before downgrade (0.2.1 code ignores the
  additive columns but will not enforce reservation/CAS).

### Package and performance budget

- Publish graph stays **50 packages**; zero new runtime dependencies. New source: additive
  `ModelRouterStateStore` methods + memory/Postgres implementations, additive
  `SessionRecord.version`/`appendSession` CAS across three stores + `ConversationThread.version`,
  `EventMultiplexerError`, NATS `durableName` fix, workflow registry sweep,
  `src/testing/state-concurrency-conformance.ts` + the `./testing/state-concurrency-conformance`
  subpath, `scripts/phase22-*`, docs. Root/package size growth within `scripts/budgets.json`
  tolerance.
- **Reservation:** O(1) UPSERT/Map op; collapses the `readBudget`+`addUsage` pair into one
  atomic reserve (no extra round trip); commit/release O(1); TTL reconciliation piggybacks on
  the existing `cleanup` sweep (≤ `HARD_CLEANUP_LIMIT` 500).
- **CAS:** one `WHERE version = expected` predicate on the existing UPSERT; O(1), no extra
  query; branch-cap count moves inside the same guarded write.
- **Multiplexer rejection:** O(1) consumer check; no queue change.
- **NATS:** removes one `randomBytes`; consumer reuse may save a `createConsumer` round trip on
  resume.
- **Registry sweep:** O(registry size) bounded by cap, at close/abort (no timer, no background
  service).
- **Conformance harness:** test-only; no runtime cost.

---

## 6. Security decisions (explicit)

1. Reservation is fail-closed on overflow: a request is admitted only if `reserveBudget`
   returns `admitted: true`; an eviction or state error denies, never admits.
2. Reservations expire deterministically (TTL) and unknown usage is reconciled (late commit
   charges the reserved amount + redacted `unknown_usage` diagnostic) — no silent budget leak.
3. Fencing tokens are monotonic and rejected when stale/foreign; reservation rows are
   ownership-scoped (`validateKey`/`routerContext`), so cross-tenant reservations can never
   share or cancel a row.
4. CAS writes are ownership-checked at the service boundary and version-guarded at the store;
   a stale write can never overwrite newer metadata or revive an archived/deleted thread.
   Archive/delete precedence keeps legal hold winning.
5. Single-consumer rejection is fail-closed (error, not silent corruption); the NATS durable
   identity stays ownership-HMAC-bound (no cross-tenant consumer reuse).
6. Active-run registries never persist; cross-tenant lookups stay ownership-isolated
   (`exactOwnershipKey`); a swept entry cannot affect another tenant.
7. No fix weakens an existing control: `consumeRate`/`addUsage`/`appendSession` non-CAS callers,
   `maxSubscribers`, circuit probe fencing, lifecycle legal-hold handling, and redaction are
   all unchanged or strictly strengthened.

---

## 7. Code quality decisions (rejected approaches)

- **Generic locking/transaction framework:** rejected — `withTransaction` (SERIALIZABLE, 3
  attempts) and the memory store's atomic Map semantics already suffice.
- **Second reservation primitive / lease-for-budget:** rejected — one additive method set on
  `ModelRouterStateStore`; the lease precedent is reused conceptually (fencing token), not
  duplicated as a new capability.
- **New reservation table:** rejected — columns on `prism_model_router_budgets` keep window
  accounting atomic; additive and nullable for 0.2.1-reader compatibility.
- **New `updateConversationMetadata` method:** rejected — `appendSession` + CAS is one root
  cause for create/branch/archive.
- **Append-only branch records as primary:** rejected — CAS covers create/archive too, needs no
  table/join; retained as the documented fallback for hosts without a `version` column.
- **Automatic retry-on-conflict in the conversation service:** rejected — masks genuine races
  and can amplify a thundering herd; callers re-read and re-attempt.
- **Broadcast `EventMultiplexer`:** rejected — bigger surface, no host demand; event-source
  `subscribe` already supports multiple consumers.
- **Durable active-run registry:** rejected — roadmap asks for bounded cleanup + explicit
  non-durable docs; durable recovery is 0.2.6.
- **Background sweeper/timer for registry or reservations:** rejected — no background service in
  Prism; cleanup rides existing close/abort/`cleanup` paths.
- **Per-adapter ad-hoc concurrency tests instead of one harness:** rejected — the roadmap's
  item 4 requires memory/durable agreement, not per-adapter islands.
- **New workspace package or test framework for the harness:** rejected — core is dependency-free
  and the runner-free conformance-helper pattern already exists.
- **Registry changes in `agent-session`/`rpc`:** rejected as out of scope — per-instance and
  per-loop Maps are bounded by construction; documented, not modified.

---

## 8. Threat-to-test traceability (tripwire inputs for Task 1)

| # | Threat | Mitigating task | Named tests |
| --- | --- | --- | --- |
| T1 | Parallel admissions collectively exceed the window budget (TOCTOU `readBudget`+`addUsage`) | Task 1 + Task 4 | `model-router.test.ts` parallel `reserveBudget(max/N+1)` admits N−1, denies the last; memory/Postgres conformance agreement; `phase22-security.test.mjs` built admission |
| T2 | Abandoned reservation (crash/lease expiry) leaks budget forever | Task 1 + Task 4 | TTL-expiry releases the reservation; late `commitBudget` charges reserved amount + one redacted `unknown_usage` diagnostic |
| T3 | Stale/foreign committer releases or cancels another's reservation | Task 1 | stale/foreign `fencingToken` rejected (`ERR_PRISM_MODEL_ROUTER_STATE`) |
| T4 | Rate/budget maps grow unbounded (memory) or uncapped (Postgres) | Task 1 | cap/evict: insert beyond `maxRateKeys`/`maxBudgetKeys` evicts LRU; held reservation rows never evicted |
| T5 | Concurrent `branch` loses a branch ref (read-modify-write) | Task 2 + Task 4 | branch+branch at cap−1: exactly one succeeds or both fit; no ref lost; `metadata_conflict` otherwise |
| T6 | Stale concurrent `branch` revives an archived thread to active | Task 2 + Task 4 | branch+archive race: CAS conflict; thread stays archived |
| T7 | Duplicate explicit-id `create` overwrites the existing thread's marker | Task 2 + Task 4 | create-only (`expectedVersion: 0`): existing thread returned, no overwrite, no duplicate row |
| T8 | Delete/retention vs. legal-hold race resurrects or purges a held thread | Task 2 | delete/archive precedence: lifecycle wins; held thread survives; CAS after purge → `not_found` |
| T9 | Cross-ownership CAS write mutates another tenant's thread | Task 2 | cross-ownership rejected before the version check |
| T10 | Second `EventMultiplexer` subscriber silently corrupts delivery | Task 3 + Task 5 | second `subscribe()` throws `ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER`; slot frees on done/close/abort; `observe` fan-in unchanged |
| T11 | NATS restart resumes from stream head / loses cursor (random durable name) | Task 3 + Task 5 | restart-stable `prism_<hmac16>` reuse across re-open; orphaned random-suffixed consumer reclaimed; cross-ownership cannot reuse a durable consumer |
| T12 | Leaked active-workflow registration blocks duplicate `runId` forever | Task 3 | sweep on registry close/abort and cap overflow evicts oldest leaked entry; cross-tenant `getActiveWorkflowRun` undefined |
| T13 | Memory and durable stores disagree under concurrency (approval/cursor/checkpoint/idempotency/reservation/conversation/unknown-outcome) | Task 4 | `assertStateConcurrencyConforms` run against memory + Postgres + SQLite + NATS fake seam; no `setTimeout(` in harness files |
| T14 | Durable conformance silently skipped when the protected env is absent | Task 4 + Task 6 | `phase22-conformance.test.mjs`: missing protected env records blocked, not green |
| T15 | TS types hide a runtime validation gap (packed plain-JS consumer) | Task 5 + Task 6 | packed tarball consumer asserts all four blockers with no TS compiler; `security:threat-suites` includes `phase22-security.test.mjs` |
| T16 | New dependency/package sneaks in | Task 6 | freeze test: package/dependency count unchanged at 50; deterministic pack dry-run twice |
