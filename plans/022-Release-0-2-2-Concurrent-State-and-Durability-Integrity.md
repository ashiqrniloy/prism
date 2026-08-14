# Release 0.2.2 — Concurrent State and Durability Integrity

Roadmap phase: `roadmap.md` § **0.2.2 — Concurrent state and durability integrity**.
Baseline: `@arnilo/prism` **0.2.1** (plan 021 complete; 50-package publish graph; zero audited vulnerabilities; `npm test` exit 0 — core 1,498/1,498, totals 3,449 tests / 3,416 pass / 33 protected or live skips / 0 failures across 44 suites, 255/255 script gates; `security:threat-suites` 42/42; Node 20 v20.20.2 packed imports 8/8; `exitGate.green: true` in `scripts/phase21-baseline.json`).
Target: `@arnilo/prism` **0.2.2**. Behavior changes are fail-closed concurrency/durability hardening of existing state stores. Public contract additions are additive only (router `reserve/commit/release`, `appendSession` CAS, `EventMultiplexer` single-consumer rejection, multi-process state conformance harness). No removal is planned; the optional CAS field and the single-consumer rejection are additive, and the NATS durable-name stabilization is a behavior fix on an existing restart path.

Scope items (mapped one-to-one to the four roadmap 0.2.2 bullets):

1. Add atomic model-budget reservation: reserve/commit/release on memory and durable router state stores; crash/lease expiry and unknown-usage reconciliation; cap and evict rate/budget/circuit maps.
2. Make conversation metadata updates atomic: version/CAS (or append-only branch records) for create/branch/archive/delete; ownership and branch caps without lost updates or stale archive resurrection.
3. Enforce single-consumer and resumable-registry semantics: `createEventMultiplexer` rejects a second subscriber (or deliberately supports broadcast); NATS subscriptions use restart-stable durable identity when durable recovery is claimed; in-process active-run registries get bounded lifecycle cleanup and explicit non-durable documentation.
4. Add multi-process state conformance: approval, cursor, checkpoint CAS, idempotency, router reservation, conversation metadata, and unknown-outcome recovery against memory and durable implementations; no timing-only sleeps.

## Objectives

- Close the four confirmed concurrent-state/durability gaps without adding a runtime dependency, a package, a background service, an alternate runtime, or a generic state framework beyond the existing `CheckpointStore`/`LeaseStore`/conformance-helper patterns.
- Make TypeScript declarations and JavaScript runtime behavior agree at every affected state boundary; packed plain-JavaScript consumers must not be able to bypass reservation/CAS/single-consumer semantics via untyped calls.
- Preserve all normal single-process behavior: budget admission, rate limiting, circuit probes, conversation create/list/continue/branch/archive/export/delete, event fan-in, NATS replay/resume, and workflow active-run registration. Only the named race, lost-update, stale-revival, duplicate-subscriber, and non-restartable paths change.
- Keep every reservation, CAS write, registry mutation, and conformance probe bounded, ownership-scoped, redacted, and fail closed before the side effect it protects; reservations expire deterministically and unknown usage is reconciled, never silently dropped.
- Publish explicit migration guidance for router reservation semantics, `appendSession` CAS conflicts, `EventMultiplexer` single-consumer rejection, NATS restart-stable durable identity, and active-run registry non-durability.
- Record machine-checkable baseline, threat-model, compatibility, package-budget, protected-matrix, and release evidence; satisfy the mandatory 0.2.x regression matrix items 8 and 9 (concurrent conversation branch/archive/create preserve valid state; parallel router admissions cannot exceed reserved budget) for this release.

## Non-goals

- No security-blocker work from 0.2.0, no provider/network trust work from 0.2.1, no build/coverage repair from 0.2.3, no package/docs truth from 0.2.4, no refactoring from 0.2.5, no coding-agent readiness from 0.2.6, no ERP readiness from 0.2.7.
- No new model provider, delegated agent, enterprise adapter, forge, object store, policy engine, or live-canary work; all catalog breadth stays deferred to 0.3.x.
- No generic state/ORM/locking framework, no distributed-transaction coordinator, no new background sweeper process. Shared mechanics are extracted only for the reservation lifecycle and the conformance harness — each already proven in `CheckpointStore`/`LeaseStore` and the existing conformance helpers.
- No change to `ProviderEvent`, `AgentEvent`, `RunRecord`, `SessionEntry`, `CheckpointRecord`, `LeaseRecord`, or `AgentEventSource` shapes. Reservation is an additive method on `ModelRouterStateStore`; CAS is an additive optional field on `appendSession` input; single-consumer rejection is an additive error path.
- No removal of `consumeRate`, `readBudget`, `addUsage`, `claimCircuitProbe`, `recordCircuitOutcome`, `appendSession`, `createEventMultiplexer`, `subscribe`, or any existing NATS/active-run API. Reservation complements `addUsage`; CAS complements blind upsert; rejection complements the documented single-consumer contract.
- No assumption that in-process `Map` registries survive restart; the roadmap requires they be explicitly documented non-durable and given bounded lifecycle cleanup, not made durable (durable active-run recovery is 0.2.6).
- No live NATS JetStream server in default CI; that remains 0.3.0. 0.2.2 proves restart-stable durable identity and conformance with the existing fake-seam plus the protected matrix where available.
- No timing-only sleeps in conformance: races are resolved with deterministic barriers (await the conflicting op, then assert state), never `setTimeout` polling.
- No new code-wiki task: `.agents/skills/project-wiki/` does not exist (same as 0.2.1).

## Expected Outcome

- `ModelRouterStateStore` (`packages/model-router/src/types.ts`) gains `reserveBudget` / `commitBudget` / `releaseBudget`. The router (`packages/model-router/src/router.ts`) replaces the `readBudget` + post-hoc `addUsage` TOCTOU (current lines 223–237 + 375–379) with `reserveBudget` at admission and `commitBudget`/`releaseBudget` at outcome; concurrent admissions cannot collectively exceed the window budget because the reservation atomically decrements remaining capacity. Reservations carry a TTL and a fencing token; an abandoned reservation (crash, lease expiry, or unobserved outcome) is reconciled deterministically (expired reservation releases its hold; a `commit` after expiry charges the reserved amount and emits a redacted `unknown_usage` diagnostic). Rate, budget, and circuit maps in the memory store (`packages/model-router/src/state.ts`) and the Postgres store (`packages/enterprise-postgres/src/model-router.ts`) are capped and evicted (LRU by `lastUsed` with the existing `cleanup` sweep extended to enforce hard map caps); diagnostics stay bounded and redacted.
- `appendSession` (`src/contracts-core.ts` `ProductionPersistenceStore.appendSession`, implemented in `packages/session-store-postgres/src/persistence.ts` and `packages/session-store-sqlite/src/persistence.ts`, and the memory path) gains an optional `version` on `SessionRecord` and an optional `expectedVersion` CAS guard on the write input, mirroring `CheckpointStore.saveCheckpoint`'s `version`/`expectedVersion`/`fencingToken` precedent already in the codebase. `createConversationService` (`packages/server/src/conversations.ts`) issues CAS-guarded metadata writes for `create`, `branch`, and `archive`; concurrent branch+branch, branch+archive, duplicate `create`, and delete/retention/legal-hold races either preserve all valid state or return an explicit `ConversationError` conflict (`metadata_conflict`) rather than silently overwriting. Ownership and branch caps (`maxActiveBranches`) are enforced inside the CAS transaction; an archived thread is never silently revived by a stale concurrent branch. The existing `ponytail:` read-modify-write comments in `server/conversations.ts` are removed once the CAS path lands.
- `createEventMultiplexer` (`src/event-multiplexer.ts`) explicitly rejects a second concurrent `subscribe()` while a first consumer is active, throwing a stable `EventMultiplexerError` (`ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER`) rather than silently handing each caller an independent iterator over a shared queue; the rejection is additive (a closed/finished first consumer frees the slot). The existing broadcast-free contract is preserved and documented; a deliberate broadcast mode is explicitly rejected in Task 0 (a bigger surface, no host demand). NATS `durableName` (`packages/session-store-nats/src/event-source.ts`) drops the `randomBytes(4)` suffix so the durable consumer name is restart-stable (`prism_<hmac16>`) when durable recovery is claimed, and `subscribe` documents/uses the restart-stable identity for cursor resume across restart; the `activeSubscribers` cap and HMAC ownership binding remain. In-process active-run registries (`packages/workflows/src/active-runs.ts`) gain a bounded lifecycle cleanup (sweep on registry close / abort / cap overflow) and explicit "non-durable, in-process only" documentation; the `agent-session`/`rpc` candidate registries were confirmed out of scope in Task 0 (per-instance and per-loop `Map`s, bounded by construction; documented, not modified); leaked/aborted registrations are cleaned up deterministically and cross-tenant lookups stay isolated.
- One dependency-free multi-process state conformance harness (`src/testing/state-concurrency-conformance.ts`, plus narrow per-domain probes) exercises approval, cursor, checkpoint CAS, idempotency, router reservation, conversation metadata, and unknown-outcome recovery against the memory stores and the durable (Postgres, NATS where applicable) implementations through the existing `test:postgres` / `test:nats` gate shape. Stale versions/fences reject, ownership never crosses tenants, retries are idempotent, reservations reconcile on crash/expiry, and no test relies on timing-only sleeps. The harness reuses the existing conformance-helper runner-free pattern (`agent-event-source-conformance.ts`, `run-ledger-conformance.ts`, `session-store-conformance.ts`).
- Direct source tests, built public-import tests, and a fresh packed plain-JavaScript consumer prove the fixes without relying on TypeScript.
- 0.2.2 exits with 50 packages, zero new runtime dependencies, standard budgets green, no skipped concurrency blocker, and an operator-ready signed-tag/OIDC handoff.

## Operational Ownership

- **Release and concurrency-integrity owner:** Prism maintainer/operator `arn`; owns scope amendments, threat acceptance, compatibility review, protected evidence, signed `v0.2.2` tag, and npm OIDC publication.
- **Model-router state owner:** `@arnilo/prism-model-router` maintainer; owns the `ModelRouterStateStore` reservation contract, the router admission path, and the memory store; coordinates the durable Postgres implementation with `@arnilo/prism-enterprise-postgres`.
- **Persistence/conversation owner:** core `src/contracts-core.ts` + `src/persistence-lifecycle.ts` + `packages/server/src/conversations.ts` maintainers; own the `appendSession` CAS contract and the conversation service conflict path; coordinate `@arnilo/prism-session-store-postgres`, `@arnilo/prism-session-store-sqlite`, and `@arnilo/prism-session-store-nats` adapters.
- **Event/registry owners:** core `src/event-multiplexer.ts` maintainer (single-consumer rejection), `@arnilo/prism-session-store-nats` maintainer (restart-stable durable identity), and `@arnilo/prism-workflows` maintainer (active-run registry lifecycle; `agent-session`/`rpc` out of scope per Task 0).
- **Conformance owner:** core `src/testing/` maintainer; owns the multi-process state conformance harness and its memory/durable factory wiring.
- **CI evidence owner:** release workflow maintainer; missing protected Postgres/NATS evidence blocks the 0.2.2 gate rather than becoming a passing skip.

## Migration Impact

- **Router reservation:** no persisted state shape change; reservations live in the existing rate/budget/circuit tables (durable) and Maps (memory) with an added `reservation_id`/`expires_at`/`fencing_token` column family added by a forward-only migration. Hosts that called `addUsage` directly (rare; the router is the only first-party caller) keep working — `addUsage` remains for retrospective accounting — but the router itself now reserves first. A host that disabled the state store keeps the same no-op behavior. No checkpoint shape change.
- **`appendSession` CAS:** the optional `version`/`expectedVersion` fields are additive; existing blind upsert callers (no `expectedVersion`) keep last-write-wins behavior identical to 0.2.1, so a rolling upgrade where only some callers set CAS is safe. `createConversationService` starts issuing CAS writes; a concurrent pre-CAS caller and a post-CAS caller interoperate (the pre-CAS caller's blind write still wins last-write-wins; the post-CAS caller fails its CAS only against a version it observed, never against a blind write it did not read). Hosts that built custom conversation logic on `appendSession` must opt into CAS explicitly; the conflict error `metadata_conflict` is new and documented.
- **`EventMultiplexer` single-consumer rejection:** code that today calls `subscribe()` twice on one multiplexer and drains both iterators (undefined behavior, never documented as supported) now gets a stable error on the second call. The single documented consumer pattern is unchanged. Hosts relying on accidental multi-subscription must split into two multiplexers or use the event source's own `subscribe` directly.
- **NATS restart-stable durable identity:** the durable consumer name loses its random suffix. An in-flight consumer created by 0.2.1 (random-suffixed) is orphaned on upgrade; `cleanup`/`deleteConsumer` already removes consumers and the stream dedupe window bounds replay, so the orphan is reclaimed. After upgrade, restart resume reuses the stable name. No persisted message change.
- **Active-run registry lifecycle:** in-process registries gain cleanup; a host that today relies on a leaked registration persisting forever (anti-pattern) now sees it swept. Documented non-durable; durable recovery stays 0.2.6.
- **Rollback:** restoring 0.2.1 restores the four concurrency gaps and must not be used as a production mitigation. The CAS column and reservation columns added by forward-only migrations are ignored by 0.2.1 readers (additive); no data migration rollback is needed, but 0.2.1 code will not enforce CAS/reservation, so concurrent writers must be quiesced before downgrade.

## Package and Performance Budget

- Publish graph remains **50 packages**; no package or export subpath is added except the additive core exports (`reserveBudget`/`commitBudget`/`releaseBudget` on the re-exported `ModelRouterStateStore` type, the optional `version`/`expectedVersion` on `SessionRecord`/`appendSession` input, the `EventMultiplexerError`/`ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER` code, and the `./testing/state-concurrency-conformance` subpath mirroring the existing conformance helper subpaths). No new workspace package.
- Runtime dependencies remain unchanged: core stays dependency-free; every affected store gains no dependency. Reservation uses the existing `pg` transaction (Postgres) and `Map` (memory); CAS uses the existing UPSERT + a `WHERE version = expected` guard; the NATS stable name uses the existing HMAC. No `node:worker_threads`, no `node:cluster`, no external lock library.
- Root and affected package packed/unpacked/file-count growth must remain within `scripts/budgets.json` tolerance unless measured evidence justifies a reviewed baseline change.
- `reserveBudget` is O(1) row update (durable) / O(1) Map op (memory); no extra round trip beyond the existing `readBudget`+`addUsage` pair it replaces (it collapses two calls into one atomic reserve). `commitBudget`/`releaseBudget` are O(1). Reservation TTL sweep piggybacks on the existing `cleanup` sweep (O(limit) bounded by `HARD_CLEANUP_LIMIT`).
- `appendSession` CAS adds one `WHERE version = $expected` predicate to the existing UPSERT; O(1), no extra query. Branch-cap enforcement moves into the same transaction (one `SELECT count` under the same lock) instead of a separate read-modify-write; O(1) per write.
- `EventMultiplexer` second-subscriber rejection is O(1) (a `has(consumer)` check); no queue change.
- NATS stable durable name removes one `randomBytes` call; consumer reuse may save one `createConsumer` round trip on resume.
- Active-run registry sweep is O(registry size) bounded by the cap; runs at registry close / abort, not on a timer.
- Multi-process conformance harness is test-only; no runtime cost.

## Tasks

- [x] Task 0 — Primitive review, threat model, ownership, migration, and budget decisions
  - Acceptance Criteria:
    - Functional: create `docs/_evidence/phase22-primitive-review.md` before any source edit, inventorying existing primitives: `ModelRouterStateStore` (`consumeRate`/`readBudget`/`addUsage`/`claimCircuitProbe`/`recordCircuitOutcome`/`cleanup`) and `ModelRouterStateKey`/`ModelRouterStateOwner` in `packages/model-router/src/types.ts`; the router admission path `readBudget`→`consumeRate`→(run)→`addUsage` in `packages/model-router/src/router.ts` (lines ~214–237, ~375–379) and `resolveBudgetWindow`; the memory store `RateState`/`BudgetState`/`CircuitState` Maps and `cleanup` in `packages/model-router/src/state.ts`; the durable store UPSERTs and `MAX_TRANSACTION_ATTEMPTS`/`CIRCUIT_IDLE_TTL_MS` in `packages/enterprise-postgres/src/model-router.ts`; `CheckpointStore.saveCheckpoint` (`version`/`expectedVersion`/`fencingToken`) and `LeaseStore` (`tryAcquireLease`/`renewLease`/`releaseLease`/`fencingToken`) in `src/contracts-core.ts` as the reservation/CAS precedent; `ProductionPersistenceStore.appendSession` and `SessionRecord` in `src/contracts-core.ts`; the Postgres `appendSession` UPSERT in `packages/session-store-postgres/src/persistence.ts` (~500) and the SQLite one in `packages/session-store-sqlite/src/persistence.ts` (~109); `createConversationService` `create`/`branch`/`archive`/`writeMarker` and the `ponytail:` lost-update comments in `packages/server/src/conversations.ts`; `CONVERSATION_METADATA_KEY`/`conversationThreadFromRecord`/`conversationMarkerMetadata` in `src/conversations.ts`; `createEventMultiplexer`/`EventMultiplexer`/`subscribe`/`observe` in `src/event-multiplexer.ts`; NATS `durableName`/`subscribe`/`createConsumer`/`deleteConsumer`/`activeSubscribers` in `packages/session-store-nats/src/event-source.ts`; the in-process active-run registries `packages/workflows/src/active-runs.ts` (`activeRuns` Map, `registerActiveWorkflowRun`/`abortActiveWorkflowRun`), `src/agent-session.ts`, and `src/rpc.ts`; the conformance-helper pattern in `src/testing/agent-event-source-conformance.ts`, `src/testing/run-ledger-conformance.ts`, `src/testing/session-store-conformance.ts`, `src/testing/tool-effect-store-conformance.ts`; and the `test:postgres` gate wiring in `package.json` + the workspace NATS `npm test` (fake-jetstream seam; no root `test:nats` script) + `packages/*/src/__tests__/*conformance*`.
    - Functional: document what can be fixed with those primitives and approve only the minimum reusable gaps: (a) reservation lifecycle on `ModelRouterStateStore` (approved because the router's `readBudget`+`addUsage` is a confirmed TOCTOU and the `CheckpointStore`/`LeaseStore` fencing-token precedent already exists in-repo — reuse it, do not invent a second); (b) `appendSession` CAS via an additive `version`/`expectedVersion` (approved because `CheckpointStore.saveCheckpoint` already proves the CAS shape and the conversation `branch`/`archive` read-modify-write is a documented `ponytail:` lost-update ceiling — lift the shape, do not add a new metadata-write method); (c) `EventMultiplexer` single-consumer rejection (approved because the contract is already documented single-consumer and silent multi-subscription is undefined behavior); (d) NATS restart-stable durable identity (approved because the current random suffix defeats restart resume, which the roadmap names explicitly); (e) active-run registry bounded lifecycle + non-durable docs (approved because the registries are documented in-process and lack cleanup); (f) one multi-process state conformance harness (approved because approval/cursor/checkpoint/idempotency/router/conversation/unknown-outcome are already each exercised in isolation but never against both memory and durable in one concurrency harness). Reject a generic locking framework, a distributed-transaction coordinator, a broadcast multiplexer, a second reservation primitive, or a per-adapter CAS flag.
    - Functional: decide the reservation semantics: atomic decrement on `reserveBudget` (remaining = max - used - reserved), TTL-bounded reservation row, `commitBudget` applies actual usage (delta = actual - reserved, positive or negative), `releaseBudget` on failure/abort, and unknown-usage reconciliation when commit never arrives before TTL (charge reserved amount, emit redacted `unknown_usage` diagnostic, never silently drop). Record the chosen fencing-token reuse from `LeaseStore` and whether reservation reuse the existing `prism_model_router_budgets` table (chosen: same table, added `reservation_id`/`reserved_tokens`/`reserved_cost_usd`/`expires_at`/`fencing_token` columns via forward-only migration) or a new table (rejected — one table keeps the window accounting atomic).
    - Functional: decide the CAS approach: additive `version` on `SessionRecord` + `expectedVersion` on `appendSession` input (chosen, mirrors `CheckpointStore`) versus a separate append-only `prism_conversation_branches` table for branch refs (alternative for branch caps only; record as the fallback if a host's session table cannot add a column). Decide the conflict error code (`metadata_conflict`) and whether `createConversationService` retries on conflict (chosen: no automatic retry — return the conflict; the caller's `continue`/`branch`/`archive` are idempotent enough that a retry re-reads and re-attempts, but the service itself does not loop to avoid masking a genuine race).
    - Functional: decide the single-consumer posture: reject the second subscriber (chosen) versus add a broadcast option (rejected — bigger surface, no host demand; the event source's own `subscribe` already supports multiple consumers for the broadcast case). Record the error code `ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER` and the slot-freeing rule (first consumer closed/finished frees the slot).
    - Functional: record threat actors, assets, entry points, trust boundaries, and mitigations for at least: concurrent budget oversubscription, abandoned reservation leak, reservation TTL race with late commit, conversation lost-update (branch ref lost), stale archive resurrection, duplicate-conversation create race, delete/retention vs. legal-hold race, silent multi-subscriber queue corruption, NATS non-restartable durable consumer (resume replays from stream head or loses cursor), leaked/aborted active-run registration, cross-tenant registry leak, and timing-only-sleep conformance false-green.
    - Functional: map every threat to a concrete test in Tasks 1–5 and record the operational owner, migration decision, rollback posture, package budget, and protected environment for each item.
    - Performance: record baseline complexity/memory for reservation, CAS, multiplexer rejection, NATS durable name, and registry sweep; proposed changes stay within the Package and Performance Budget above.
    - Code Quality: reject a generic locking framework, a second reservation primitive, a broadcast multiplexer, a per-adapter CAS flag, or new interfaces with a single consumer; retain existing package boundaries and the deny-by-default posture.
    - Security: explicitly decide that reservation is fail-closed on overflow (admit only if reserve succeeds), CAS rejects stale versions, single-consumer rejection is fail-closed, NATS durable identity is ownership-HMAC-bound (no cross-tenant reuse), active-run registries never persist, and no fix weakens an existing ownership/redaction control. Record all decisions in the evidence document.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §0.2.2, mandatory 0.2.x regression matrix items 8–9, release validation checklist, release order (security → provider/network → state concurrency → …).
      - `.agents/skills/create-plan/SKILL.md` primitive-review requirement and `references/prism-wiki.md` documentation requirements.
      - `docs/model-routing.md` (budget/rate/circuit, durable state, redacted diagnostics); `docs/conversations.md` (create/list/continue/branch/archive/export/delete, caps, legal-hold-aware deletion); `docs/agent-events.md` and `docs/public-contracts.md` (`EventMultiplexer` row); `docs/database-persistence.md` and `docs/enterprise-postgres-state.md` (appendSession upsert, ownership, migrations); `docs/session-stores-and-branching.md`; `docs/workflows.md` (active-run registry, if present); `docs/migration.md` 0.2.0 → 0.2.1 structure.
      - `packages/model-router/src/{types,state,router}.ts`; `packages/enterprise-postgres/src/{model-router,migrations,ddl,records}.ts`; `packages/model-router/src/__tests__/model-router.test.ts`; `packages/enterprise-postgres/src/__tests__/enterprise-conformance.test.ts`.
      - `src/contracts-core.ts` `CheckpointStore`/`LeaseStore`/`SessionRecord`/`ProductionPersistenceStore`; `src/persistence-lifecycle.ts`; `src/conversations.ts`; `src/event-multiplexer.ts`; `src/testing/*-conformance.ts`.
      - `packages/session-store-postgres/src/persistence.ts`; `packages/session-store-sqlite/src/persistence.ts`; `packages/session-store-nats/src/event-source.ts`; `packages/server/src/conversations.ts`; `packages/workflows/src/active-runs.ts`; `src/agent-session.ts`; `src/rpc.ts`.
      - Node.js v20.20.2 docs: `Map` iteration, `crypto.randomUUID`/`createHmac`/`randomBytes`, `AbortSignal`, `pg` transaction isolation, SQLite `INSERT ... ON CONFLICT` `WHERE` guard.
      - `plans/021` primitive-review/threat-model/exit-gate precedent; `plans/020` security-regression precedent.
    - Options Considered:
      - Per-call `addUsage` guard instead of reservation: rejected; `addUsage` is post-hoc, two concurrent admissions both pass `readBudget` and then both `addUsage` → oversubscription. Reservation is the root-cause fix.
      - A separate reservation table: rejected; one table keeps window accounting atomic and matches the existing budget table.
      - Append-only branch records instead of `appendSession` CAS: considered as the branch-cap fallback; CAS on `appendSession` is simpler and covers create/archive too, not just branch.
      - Broadcast `EventMultiplexer`: rejected; bigger surface, no demand; the event source's own `subscribe` already supports multiple consumers.
      - Reuse-first review with one threat table and explicit decisions: chosen.
    - Chosen Approach:
      - Write one tarball-excluded evidence document before freeze or source edits; freeze exact decisions and test names in Task 1.
      - Reservation reuses the `CheckpointStore`/`LeaseStore` fencing-token precedent; CAS reuses the `CheckpointStore.saveCheckpoint` `version`/`expectedVersion` shape; single-consumer rejection is additive; NATS durable name drops the random suffix; active-run registries gain a timestamp + bounded sweep + non-durable docs; one conformance harness reuses the runner-free conformance-helper pattern.
    - API Notes and Examples:
      ```ts
      // Additive reservation on the existing store contract
      reserveBudget(input: { key: ModelRouterStateKey; tokens?: number; costUsd?: number; windowMs: number; reservationTtlMs: number; now: number }): Promise<{ reservationId: string; fencingToken: number; admitted: boolean; retryAfterMs?: number }>;
      commitBudget(input: { key: ModelRouterStateKey; reservationId: string; fencingToken: number; tokens?: number; costUsd?: number; windowMs: number; now: number }): Promise<void>;
      releaseBudget(input: { key: ModelRouterStateKey; reservationId: string; fencingToken: number; now: number }): Promise<void>;
      // Additive CAS on the existing appendSession input
      appendSession?(record: SessionRecord & { expectedVersion?: number }): Promise<{ version: number } | void>;
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase22-primitive-review.md`: primitive inventory, gap decisions, threat model, owner/migration/budget matrix, and test mapping.
      - `plans/022-Release-0-2-2-Concurrent-State-and-Durability-Integrity.md`: update only if review changes planned approach/files/tests.
    - References:
      - `packages/model-router/src/{types,state,router}.ts`; `packages/enterprise-postgres/src/model-router.ts`.
      - `src/contracts-core.ts` (`CheckpointStore`, `LeaseStore`, `SessionRecord`, `ProductionPersistenceStore`); `src/event-multiplexer.ts`; `src/conversations.ts`.
      - `packages/session-store-{postgres,sqlite,nats}/src/*.ts`; `packages/server/src/conversations.ts`; `packages/workflows/src/active-runs.ts`.
      - `src/testing/*-conformance.ts`; `plans/020`, `plans/021`.
  - Test Cases to Write:
    - primitive inventory: the evidence doc names every primitive in the Acceptance Criteria and rejects a generic locking/transport/broadcast framework.
    - decision freeze: reservation reuses `LeaseStore` fencing; CAS reuses `CheckpointStore.saveCheckpoint`; single-consumer rejection (not broadcast); NATS stable name; registry non-durable; one conformance harness.
    - threat mapping: every named threat maps to a concrete test in Tasks 1-5.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no - Task 0 only produces the tarball-excluded evidence document and freezes decisions; no public API change.
    - Docs pages to create/edit:
      - `docs/_evidence/phase22-primitive-review.md`: primitive inventory, decisions, threat model, owner/migration/budget matrix, test mapping (tarball-excluded).
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable; evidence-only task.
  - Status: complete (2026-08-13) at HEAD `7aa4684`. Evidence: `docs/_evidence/phase22-primitive-review.md`. Review corrections applied below: Task 2 files gain `src/conversations.ts` (`ConversationThread.version` projection); Task 3 confirms `agent-session`/`rpc` registries out of scope (per-instance/per-loop by construction); Task 4 NATS conformance runs in the workspace `npm test` via the fake-jetstream seam (no root `test:nats` script exists; real-NATS probes stay protected evidence).

- [x] Task 1 — Atomic model-budget reservation (reserve/commit/release) + rate/budget/circuit cap and eviction
  - Acceptance Criteria:
    - Functional: add `reserveBudget`/`commitBudget`/`releaseBudget` to `ModelRouterStateStore` (`packages/model-router/src/types.ts`) with `reservationId`, `fencingToken`, `reservationTtlMs`, `now`, and ownership key; `reserveBudget` atomically decrements remaining capacity (max − used − reserved) and admits only if the full requested amount fits, else denies with `retryAfterMs`; `commitBudget` applies the actual usage delta versus the reserved amount (negative delta releases the remainder back); `releaseBudget` releases an uncommitted reservation; an expired reservation (TTL elapsed) is treated as released and a late `commitBudget` after expiry charges the reserved amount and records a redacted `unknown_usage` diagnostic. Implement the memory store (`packages/model-router/src/state.ts`) and the durable Postgres store (`packages/enterprise-postgres/src/model-router.ts`) behind the same contract; add a forward-only migration for the reservation columns.
    - Functional: rewire the router admission path (`packages/model-router/src/router.ts`) to `reserveBudget` at admission (replacing the `readBudget` TOCTOU at ~223 and the separate `consumeRate` ordering) and to `commitBudget`/`releaseBudget` at run outcome (replacing the post-hoc `addUsage` at ~375–379); `consumeRate` stays for the rate-limit admission (it is already atomic) and `addUsage` stays for retrospective accounting but is no longer the admission authority. Fallback/circuit paths release the reservation on denial/failure.
    - Functional: cap and evict rate, budget, and circuit maps in both stores: enforce a hard map cap (`maxCircuitKeys` already exists for circuits; add `maxRateKeys`/`maxBudgetKeys` to `ModelRouterLimits`) with LRU eviction by `lastUsed` on insert, and extend the existing `cleanup` sweep to evict expired/explicitly-capped entries within `HARD_CLEANUP_LIMIT`. Eviction never drops a held reservation's budget row (reservations pin their row's `lastUsed`).
    - Performance: `reserveBudget` is O(1) (one UPSERT/Map op); `commitBudget`/`releaseBudget` are O(1); eviction is O(cap) amortized via the existing sweep; no extra round trip beyond the `readBudget`+`addUsage` it collapses; router admission latency does not regress on the 0.1.0 benchmark budget.
    - Code Quality: no new runtime dependency; the contract is additive (existing `consumeRate`/`readBudget`/`addUsage` callers keep working); memory and durable share one conformance probe (Task 4); redaction applies to diagnostics (`unknown_usage` carries no token/secret).
    - Security: reservation is fail-closed on overflow; ownership key is validated on every call (`validateKey`); fencing tokens are monotonic and reject stale committers; expired reservations reconcile deterministically (no silent budget leak); cross-tenant reservation never shares a row.
  - Approach:
    - Documentation Reviewed:
      - `docs/model-routing.md`; `packages/model-router/src/{types,state,router}.ts`; `packages/enterprise-postgres/src/{model-router,migrations,ddl,records}.ts`; `packages/model-router/src/__tests__/model-router.test.ts`; `packages/enterprise-postgres/src/__tests__/enterprise-conformance.test.ts`.
      - `src/contracts-core.ts` `CheckpointStore`/`LeaseStore` fencing-token precedent; Task 0 decisions in `docs/_evidence/phase22-primitive-review.md`.
    - Options Considered:
      - Reserve inside `consumeRate` (one call): rejected; rate and budget have different windows and a single call mingles semantics. Two atomic calls (rate then budget) with budget reservation is cleaner.
      - Optimistic reservation (reserve 0, charge on commit): rejected; defeats the "cannot collectively exceed budget" requirement — concurrent admissions would all pass.
      - Pessimistic reservation with TTL + fencing + commit/release: chosen; matches the roadmap wording and the `LeaseStore` precedent.
    - Chosen Approach:
      - Add reservation columns to `prism_model_router_budgets` via forward-only migration; memory store mirrors with a `Map<reservationId, {…}>`; router calls reserve at admission and commit/release at outcome; rate/budget/circuit maps get hard caps + LRU eviction.
    - API Notes and Examples:
      ```ts
      const r = await stateStore.reserveBudget({ key, tokens: 100, windowMs, reservationTtlMs: 60_000, now });
      if (!r.admitted) throw new ModelRouterError("token budget exhausted", "ERR_PRISM_MODEL_ROUTER_BUDGET");
      try { const result = await run(); await stateStore.commitBudget({ key, reservationId: r.reservationId, fencingToken: r.fencingToken, tokens: result.tokens, windowMs, now }); }
      catch { await stateStore.releaseBudget({ key, reservationId: r.reservationId, fencingToken: r.fencingToken, now }); throw; }
      ```
    - Files to Create/Edit:
      - `packages/model-router/src/types.ts`: add `reserveBudget`/`commitBudget`/`releaseBudget` to `ModelRouterStateStore`; add `maxRateKeys`/`maxBudgetKeys` to `ModelRouterLimits`/`ResolvedModelRouterLimits`.
      - `packages/model-router/src/state.ts`: memory reservation + map caps + LRU eviction + TTL reconciliation.
      - `packages/model-router/src/router.ts`: reserve at admission, commit/release at outcome; keep `consumeRate` for rate, `addUsage` for retrospective accounting.
      - `packages/model-router/src/limits.ts`: resolve new caps.
      - `packages/enterprise-postgres/src/model-router.ts`: durable reservation (UPSERT + `SELECT … FOR UPDATE`-free atomic decrement via `UPDATE … WHERE remaining >= requested RETURNING`) + column writes.
      - `packages/enterprise-postgres/src/{migrations,ddl}.ts`: forward-only migration adding `reservation_id`/`reserved_tokens`/`reserved_cost_usd`/`reservation_expires_at`/`fencing_token` to `prism_model_router_budgets` (additive, nullable, ignored by 0.2.1 readers).
      - `packages/model-router/src/__tests__/model-router.test.ts`: reservation + cap/eviction + TTL/unknown-usage unit tests.
      - `packages/enterprise-postgres/src/__tests__/enterprise-conformance.test.ts`: durable reservation conformance (wired into Task 4 harness).
    - References:
      - Task 0 evidence; `src/contracts-core.ts` `LeaseStore` fencing-token; `packages/model-router/src/state.ts` `RateState`/`BudgetState`/`CircuitState`; `roadmap.md` §0.2.2 bullet 1.
  - Test Cases to Write:
    - parallel admission: N concurrent `reserveBudget(maxTokens/N + 1)` admit exactly N−1 then deny the last; remaining never negative.
    - commit/release: committed actual < reserved releases remainder; release on failure returns full reservation; window total reflects actuals only.
    - TTL expiry: a reservation whose TTL elapsed is released; a late `commitBudget` after TTL charges the reserved amount and emits one redacted `unknown_usage` diagnostic.
    - fencing: a `commitBudget`/`releaseBudget` with a stale/foreign `fencingToken` is rejected (`ERR_PRISM_MODEL_ROUTER_STATE`).
    - cap/eviction: inserting beyond `maxBudgetKeys`/`maxRateKeys` evicts the least-recently-used non-held entry; a held reservation's row is never evicted.
    - memory/durable agreement: the same probe run against `createMemoryModelRouterStateStore` and `createPostgresModelRouterStateStore` admits/denies identically (Task 4 harness).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — additive `reserveBudget`/`commitBudget`/`releaseBudget` on the public `ModelRouterStateStore` type and new `ModelRouterLimits` caps; router admission behavior tightens (fail-closed on overflow, deterministic on crash).
    - Docs pages to create/edit:
      - `docs/model-routing.md`: reserve/commit/release semantics, TTL/unknown-usage reconciliation, map caps/eviction, redacted diagnostics.
      - `docs/enterprise-postgres-state.md`: reservation columns/migration, durable reservation behavior.
    - `docs/index.md` update: yes — refresh the Model routing entry to mention reservation/CAS-grade durability; refresh Enterprise PostgreSQL state entry for the reservation migration.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Status: complete (2026-08-13) at HEAD `7aa4684`. Evidence and deltas:
    - Contract: `ModelRouterStateStore` gains `reserveBudget`/`commitBudget`/`releaseBudget`; `ModelRouterLimits`/`ResolvedModelRouterLimits` gain `maxRateKeys`/`maxBudgetKeys` (default 4,096 / hard 65,536); `ModelRouterBudgets` gains `reservationTtlMs` (default 60s); `resolve` returns `budgetReservation` and `recordUsage` accepts it (commit path; absent → `addUsage` as before). Router admission: per-request caps are reserved atomically (amount = request cap, capacity = window max ?? request cap); cap-less requests keep the 0.2.1 read-then-compare admission (documented outside the reservation guarantee); internal denials (rate, circuit, provider miss) release the reservation (best-effort — TTL is the fail-closed backstop); a late commit charges the reserved amount and emits one redacted `unknown_usage` deny diagnostic.
    - Deviation 1 (columns): the plan named five scalar reservation columns; implementation ships ONE additive nullable `reservations JSONB NOT NULL DEFAULT '[]'` column on `prism_model_router_budgets` (migration 003 `003_router_reservations`, checksummed like 001/002). Single-slot scalars cannot hold N concurrent reservations; a JSONB array supports atomic `||` append and concurrent admissions while keeping the no-new-table decision. `EXPECTED_TABLES`/`assertEnterpriseSchemaReady` include the column; 0.2.1 readers ignore it.
    - Deviation 2 (fencing): fencing tokens are unique random UUIDs, not numeric counters; stale/foreign committers are rejected because reservation ids are unique and unforgeable (a stale commit references a vanished id → `ERR_PRISM_MODEL_ROUTER_STATE`). Acceptance criterion "monotonic" is satisfied in effect: no stale commit can ever succeed.
    - Deviation 3 (input shape): `reserveBudget` input carries `maxTokens`/`maxCostUsd` (the capacity bound; the plan example omitted them — the store must know the cap to admit atomically) and `maxBudgetKeys`/`maxRateKeys` are per-call inputs (mirroring the circuit `maxKeys` pattern), not store-constructor options.
    - Accounting semantics: reservations live in a separate array; `used` reflects actuals only. A live commit adds the ACTUAL usage and removes the reservation (capacity released = reserved − actual, the plan's "negative delta releases the remainder"); an expired/window-rolled commit adds the RESERVED amount as unknown usage. Missing reservation on commit/release throws (outcome unknown, fail loud; idempotent retries must handle it).
    - Cap/eviction: durable eviction runs after a new-key insert with an exclude-self guard (never evicts the just-inserted row, never a row holding an active reservation); when every other row is held it fails closed `ERR_PRISM_MODEL_ROUTER_STATE`. Memory evicts before insert; both enforce the cap, boundary victims may differ (documented per-store in tests). Cleanup prunes expired reservations (memory + durable) within the bounded batch.
    - Conformance: shared runner `runEnterpriseStoreConformance` now exercises parallel reservation admission (4×26/100 → 3 admit), commit/release actuals, stale-fencing rejection, and real-time TTL reconciliation (1ms TTL + 25ms tick; durable expiry uses the database clock so the probe needs real time, not the `now` param). Durable-only integration probes: 16-client reservation contention, budget/rate cap+eviction in a fresh schema.
    - Gate evidence: `npm test` 3,454 / 3,421 pass / 0 fail (33 protected skips); `test:postgres` green (session-store-postgres 16, enterprise-postgres 31, memory 7, phase7/12 legs) against `postgres:16-alpine`. Docs updated: `docs/model-routing.md` (reservation semantics, TTL, caps, unknown_usage), `docs/enterprise-postgres-state.md` (migration 003, reservations column, cap/eviction), `docs/index.md` entries.
    - Baseline refresh: `packages/model-router/src/state.ts` was in the 0.1.7 preserved surface (`scripts/phase19-baseline.json`). The roadmap mandates the change; the hash was refreshed with a dated `$comment` (the other three preserved files are untouched and still match). Task 6's release gate still performs the compat-baseline refresh.

- [x] Task 2 — Atomic conversation metadata updates (version/CAS) without lost updates or stale archive resurrection
  - Acceptance Criteria:
    - Functional: add an optional `version?: number` to `SessionRecord` (`src/contracts-core.ts`) and an optional `expectedVersion?: number` CAS guard to the `appendSession` input (additive; a caller that omits `expectedVersion` keeps 0.2.1 last-write-wins). The write returns the new `version`. Implement CAS in the memory path, `packages/session-store-postgres/src/persistence.ts` (`ON CONFLICT(id) DO UPDATE SET metadata = EXCLUDED.metadata, version = ${table}.version + 1, updated_at = EXCLUDED.updated_at WHERE ${table}.version = $expected` with `expectedVersion = 0` meaning create-only), and `packages/session-store-sqlite/src/persistence.ts` (same `WHERE version = expected` guard). A CAS mismatch returns a `PersistenceError`/`ConversationError` with code `metadata_conflict` and the current version.
    - Functional: `createConversationService` (`packages/server/src/conversations.ts`) reads the thread (`loadThread`), issues `appendSession` with `expectedVersion = thread.version` for `branch` and `archive`; `create` with an explicit id uses `expectedVersion = 0` (create-only) so a duplicate `create` returns the existing thread rather than overwriting; `branch` enforces `maxActiveBranches` inside the same CAS transaction (count existing branches ≤ cap before the write) so two concurrent branches cannot both exceed the cap; `archive` on an already-archived thread is a no-op returning the thread. Delete/retention/legal-hold: `archive` never resurrects a deleted thread (delete wins via the persistence lifecycle), and a stale concurrent `branch` against an archived thread fails `metadata_conflict` (state changed under it) rather than reviving `active`.
    - Functional: ownership is enforced on every CAS write (tenant/account/user match); a cross-ownership write is rejected before the CAS guard. Branch refs remain append-only within the marker (the entry tree is still the content source of truth); the `ponytail:` lost-update comments in `server/conversations.ts` are removed.
    - Performance: CAS adds one `WHERE` predicate to the existing UPSERT; O(1), no extra query; branch-cap count moves inside the transaction (one `SELECT count(*) … FOR UPDATE`-equivalent under the row lock in Postgres; a transactional read in SQLite/memory); no regression on conversation list/continue/export.
    - Code Quality: the contract is additive; existing `appendSession` callers (non-conversation host-managed sessions) are unaffected; memory/Postgres/SQLite share one conformance probe (Task 4); conflict error is a stable, documented code.
    - Security: ownership never crosses tenants on a CAS write; archive/delete precedence preserves legal hold; no raw transcript in the conflict error (metadata marker only, redacted).
  - Approach:
    - Documentation Reviewed:
      - `docs/conversations.md`; `docs/database-persistence.md`; `docs/enterprise-postgres-state.md`; `src/contracts-core.ts` (`SessionRecord`, `ProductionPersistenceStore.appendSession`, `CheckpointStore.saveCheckpoint`); `src/conversations.ts`; `packages/server/src/conversations.ts`; `packages/session-store-{postgres,sqlite}/src/persistence.ts`; Task 0 decisions.
    - Options Considered:
      - Append-only `prism_conversation_branches` table for branch refs (avoid CAS): considered; covers branch-cap but not create/archive races, and adds a table + join. Kept as the documented fallback for hosts whose session table cannot add a `version` column.
      - A new `updateConversationMetadata` method separate from `appendSession`: rejected; duplicates the upsert path and the `CheckpointStore` CAS shape already fits `appendSession`.
      - Automatic retry-on-conflict inside the service: rejected; masks genuine races and can amplify a thundering herd. The service returns the conflict; `continue`/`branch`/`archive` callers re-read and re-attempt if they choose.
      - Additive `version`/`expectedVersion` on `appendSession` mirroring `CheckpointStore.saveCheckpoint`: chosen; one root-cause change covers create/branch/archive, reuses the in-repo CAS precedent, and keeps non-CAS callers byte-identical.
    - Chosen Approach:
      - Add `version` to `SessionRecord` (default `0`/`undefined` = unversioned), `expectedVersion` to `appendSession` input; UPSERT-with-`WHERE`-guard in all three stores; conversation service issues CAS for `create`/`branch`/`archive`; branch cap inside the transaction; conflict returns `metadata_conflict`.
    - API Notes and Examples:
      ```ts
      // create-only (duplicate-safe)
      await store.appendSession({ id, ...ownership, createdAt, updatedAt, metadata: conversationMarkerMetadata({ state: "active" }), expectedVersion: 0 });
      // branch with CAS + cap
      const thread = await loadThread(input, threadId);
      if (thread.branches.length >= limits.maxActiveBranches) throw new ConversationError("Too many active branches", "too_many_branches");
      await store.appendSession({ id: thread.id, ...ownership, createdAt: thread.createdAt, updatedAt: now, metadata: conversationMarkerMetadata({ state: thread.state, branches: [...thread.branches, { leafId, createdAt: now }] }), expectedVersion: thread.version }).catch(throwConflict);
      ```
    - Files to Create/Edit:
      - `src/contracts-core.ts`: `SessionRecord.version?` and `appendSession` input `expectedVersion?`; return shape `{ version: number }` (additive; existing void callers ignore it).
      - `src/conversations.ts`: `ConversationThread.version?` projected from `SessionRecord.version` in `conversationThreadFromRecord`; marker helpers unchanged.
      - `packages/session-store-postgres/src/{persistence,migrations,ddl}.ts`: CAS guard + `version` column + forward-only migration (nullable, default 0).
      - `packages/session-store-sqlite/src/{persistence,migrations}.ts`: same CAS guard + column + migration.
      - `src/session-stores.ts` (memory path, if `appendSession` is exercised in memory) or the in-memory persistence helper: CAS guard + version.
      - `packages/server/src/conversations.ts`: `create`/`branch`/`archive` issue CAS; branch cap inside the transaction; remove `ponytail:` lost-update comments; map `metadata_conflict` to a `ConversationError`.
      - `packages/session-store-postgres/src/__tests__/*.ts`; `packages/session-store-sqlite/src/__tests__/*.ts`: CAS + conflict + branch-cap + archive-precedence tests (wired into Task 4 harness).
    - References:
      - Task 0 evidence; `src/contracts-core.ts` `CheckpointStore.saveCheckpoint`; `packages/server/src/conversations.ts` `ponytail:` comments; `roadmap.md` §0.2.2 bullet 2.
  - Test Cases to Write:
    - branch+branch: two concurrent `branch` calls on a thread at cap−1; exactly one succeeds, the other gets `metadata_conflict` (or succeeds if cap allows both); no branch ref is lost.
    - branch+archive: a `branch` racing an `archive` that observed the pre-branch version fails `metadata_conflict`; the thread ends archived, not revived to `active`.
    - duplicate create: two `create` with the same explicit id and `expectedVersion = 0`; exactly one creates, the other gets the existing thread (no overwrite, no duplicate row).
    - delete/archive precedence: a thread deleted (or retention-swept) under a concurrent `archive` is not resurrected; legal-hold wins retention.
    - cross-ownership: a CAS write with mismatched tenant/account/user is rejected before the version check.
    - memory/Postgres/SQLite agreement: the same probe run against all three stores conflicts/preserves identically (Task 4 harness).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — additive `version` on `SessionRecord`, additive `expectedVersion` on `appendSession`, new `metadata_conflict` error; conversation create/branch/archive now conflict-detecting.
    - Docs pages to create/edit:
      - `docs/conversations.md`: atomic metadata, CAS conflicts, `metadata_conflict`, branch caps inside the transaction, archive/delete precedence.
      - `docs/database-persistence.md` / `docs/enterprise-postgres-state.md`: `appendSession` CAS, `version` column, forward-only migration, non-CAS caller compatibility.
    - `docs/index.md` update: yes — refresh Conversations entry to mention atomic metadata/CAS; refresh persistence entries for the `version` column/migration.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Status: complete (2026-08-13) at HEAD `7aa4684`. Evidence and deltas:
    - Contract: `SessionRecord` gains additive `version?`; `ProductionPersistenceStore.appendSession` accepts `expectedVersion?` and returns `{ version }`; new `SessionMetadataConflictError` + `SESSION_METADATA_CONFLICT_CODE` + `isSessionMetadataConflict` (mirrors `SessionAppendConflictError`, carries id/versions only, never metadata content); `ConversationThread.version?` projected in `conversationThreadFromRecord`.
    - Semantics: `expectedVersion: 0` = create-only (duplicate insert rejected, nothing overwritten); `expectedVersion: N>0` = update-only exact-version CAS (a deleted row is never re-created — `currentVersion: 0` in the conflict); omitted = legacy last-write-wins with version bookkeeping. Cross-ownership CAS writes are rejected inside the same guarded statement (null-safe ownership predicates), before the version guard.
    - Deviation 1 (version origin): fresh rows start at version 1, not 0 — the insert arm writes 1 and migration 008 backfills existing rows `SET version = 1`. Required because `expectedVersion: 0` is the create-only sentinel, so a fresh thread must never sit at version 0 or `branch`/`archive` could not CAS it (0 would mean "create-only").
    - Deviation 2 (statement shape): CAS is one `INSERT … SELECT … WHERE ($13 IS NULL OR $13 = 0 OR EXISTS(…)) ON CONFLICT(id) DO UPDATE SET …, version = version + 1 WHERE (… version = $13 AND ownership …) RETURNING version` in both adapters (PostgreSQL `IS NOT DISTINCT FROM`, SQLite null-safe `IS`). The SELECT-arm EXISTS guard is what makes an `expectedVersion > 0` write never resurrect a deleted row; happy path stays a single statement, and only the conflict path adds one `SELECT version` to report the current version. The plan's "one WHERE predicate on the existing UPSERT" is this shape, not a literal diff.
    - Branch cap: the service checks `maxActiveBranches` on its read snapshot and the version CAS inside the write makes the cap exact under concurrency — the losing writer's snapshot is stale, so it conflicts instead of slipping past the cap. No separate `SELECT count(*) … FOR UPDATE` is needed (the row-level version guard IS the serialization); plan wording adjusted accordingly.
    - Schema/migration: `PERSISTENCE_SCHEMA_VERSION` 7→8; `prism_sessions.version` in the shared schema model; migration `008_session_version` (`ALTER TABLE … ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0` + one-time backfill) in both adapters; migration 001's checksum content explicitly filters the new column so deployed 0.2.1 checksums stay valid; `phase12-freeze-manifest.json` `support.postgres.schemaVersion` 7→8 with the phase13 baseline re-touched (mtime guard) and dated comment.
    - Store tests: sqlite 5 new (create-only duplicate, exact-version CAS + delete-never-resurrects, legacy last-write-wins, cross-ownership, legacy-row backfill on upgrade); postgres integration 2 new incl. an 8-way concurrent create race (exactly 1 fulfilled) and 8-way concurrent CAS branch race (exactly 1 fulfilled); migration-list assertions updated to 8 steps (sqlite, postgres, event-source integration). Server service: 6 new tests (duplicate/concurrent create, branch+branch at cap 1, branch+archive race, archive no-op, delete-wins, cross-ownership).
    - Service behavior: `create` with explicit id writes `expectedVersion: 0` and re-gets on conflict (duplicate create returns the winner's thread); `branch`/`archive` write with `expectedVersion = thread.version` and map conflicts to `ConversationError` reason `metadata_conflict` (HTTP 409); the `ponytail:` lost-update comments in `server/conversations.ts` are removed; `archive` on an archived thread remains a no-op.
    - Gate evidence: `npm test` 3,465 / 3,432 pass / 0 fail (33 protected skips); `test:postgres` 84/84 green (session-store-postgres 16 incl. CAS + event-source re-apply legs, memory 7, enterprise-postgres 31, phase7/12 scripts) against `postgres:16-alpine`. Frozen root-surface list refreshed with the three new value exports.
    - Docs: `docs/conversations.md` (CAS behavior notes, ownership guard, precedence), `docs/database-persistence.md` (CAS seam + migration 008 + forward-only practice), `docs/index.md` entries, `docs/public-contracts.md` (surface list + `SessionRecord` row). `docs/enterprise-postgres-state.md` intentionally untouched: `appendSession` is session-store scope, not enterprise-state composition.

- [x] Task 3 — Single-consumer enforcement, restart-stable NATS durable identity, and bounded active-run registries
  - Acceptance Criteria:
    - Functional: `createEventMultiplexer` (`src/event-multiplexer.ts`) rejects a second concurrent `subscribe()` while a first consumer is active with a stable `EventMultiplexerError` (`ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER`); the slot frees when the first consumer's iterator returns `done`/is closed/aborts; `observe` still supports multiple sources (fan-in is unchanged); the overflow/abort/close paths are unchanged. Add an additive `EventMultiplexerError` export and the error code; keep the `EventMultiplexer` interface shape.
    - Functional: NATS `durableName` (`packages/session-store-nats/src/event-source.ts`) drops the `randomBytes(4)` suffix so the durable consumer name is `prism_<hmac16>` (restart-stable) when durable recovery is claimed; `subscribe` reuses the stable name across restart so cursor resume continues from the durable consumer's last ack, not from the stream head; the `activeSubscribers` cap still rejects excess subscribers; the HMAC is ownership-bound (`tenantId|sessionId|runId`) so cross-tenant callers cannot share a durable consumer. Document the restart-stable identity and the orphan-consumer reclamation path (the old random-suffixed consumers are removed by the existing `deleteConsumer`/`cleanup`).
    - Functional: in-process active-run registries (`packages/workflows/src/active-runs.ts`, and the `agent-session`/`rpc` active-run maps Task 0 inventories) gain a registration `startedAt` (already present for workflows), a bounded lifecycle cleanup (sweep on registry close/abort and on cap overflow, evicting aborted/leaked entries by oldest `startedAt`), and explicit "non-durable, in-process only — does not survive restart" documentation in code comments and docs; cross-tenant lookups stay isolated (`exactOwnershipKey`).
    - Performance: single-consumer rejection is O(1) (`has(consumer)` check); NATS stable name removes one `randomBytes` and may save one `createConsumer` round trip on resume; registry sweep is O(size) bounded by the cap, runs at close/abort not on a timer; no `EventMultiplexer` queue change.
    - Code Quality: the rejection is additive (documented single-consumer contract enforced); NATS change is a behavior fix on an existing restart path; registry changes are additive cleanup + docs; no new dependency.
    - Security: single-consumer rejection prevents silent queue corruption from accidental multi-subscription; NATS durable identity is ownership-HMAC-bound (no cross-tenant resume); registries never persist (no cross-replica leak); cross-tenant isolation holds.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-events.md`; `docs/public-contracts.md` (`EventMultiplexer` row); `src/event-multiplexer.ts`; `packages/session-store-nats/src/event-source.ts`; `packages/workflows/src/active-runs.ts`; `src/agent-session.ts`; `src/rpc.ts`; Task 0 decisions.
    - Options Considered:
      - Broadcast `EventMultiplexer`: rejected (Task 0); the event source's own `subscribe` already supports multiple consumers for broadcast.
      - Keep random durable suffix + a separate restart-stable opt-in: rejected; the random suffix is the defect; one stable name is simpler and matches the roadmap wording.
      - Make active-run registries durable: rejected (0.2.6); the roadmap asks for bounded cleanup + explicit non-durable docs, not durability.
      - Reject second subscriber + stable NATS name + bounded registry cleanup + non-durable docs: chosen.
    - Chosen Approach:
      - Add `EventMultiplexerError` + a `hasConsumer` guard in `subscribe`; drop the NATS random suffix; add registry `startedAt` sweep + cap-overflow eviction + non-durable docs; keep all existing public method signatures.
    - API Notes and Examples:
      ```ts
      const mux = createEventMultiplexer<AgentEvent>();
      const it1 = mux.subscribe();
      const it2 = mux.subscribe(); // throws EventMultiplexerError("ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER")
      await it1.return?.(); // frees the slot; a new subscribe() succeeds
      ```
    - Files to Create/Edit:
      - `src/event-multiplexer.ts`: `EventMultiplexerError`, second-subscriber rejection, slot-freeing on done/close/abort.
      - `src/contracts.ts` / `src/index.ts`: re-export `EventMultiplexerError` (additive).
      - `packages/session-store-nats/src/event-source.ts`: restart-stable `durableName`, reuse on resume, document orphan reclamation.
      - `packages/workflows/src/active-runs.ts`: bounded lifecycle cleanup (sweep on close/abort + cap-overflow eviction) + non-durable docs.
      - `src/agent-session.ts`, `src/rpc.ts`: confirmed out of scope in Task 0 (per-instance `activeRun`/`activeRunId` fields and a per-loop `activeRuns` Map, bounded by construction) — document why, no code change.
      - `src/__tests__/event-multiplexer.test.ts` (or the existing multiplexer test file); `packages/session-store-nats/src/__tests__/*.ts`; `packages/workflows/src/__tests__/*.ts`: single-consumer rejection, restart-stable durable name, registry cleanup tests.
    - References:
      - Task 0 evidence; `src/event-multiplexer.ts` `subscribe`/`observe`; `packages/session-store-nats/src/event-source.ts` `durableName`; `packages/workflows/src/active-runs.ts`; `roadmap.md` §0.2.2 bullet 3.
  - Test Cases to Write:
    - single-consumer: a second `subscribe()` while the first is active throws `ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER`; after the first closes, a new `subscribe()` succeeds; `observe` still fans in from multiple sources.
    - restart-stable durable: `subscribe` twice across a "restart" (re-create the source with the same connection/ownership) reuses the durable consumer name and resumes from the last-acked cursor; an orphan random-suffixed consumer (simulated) is reclaimed by `cleanup`/`deleteConsumer`; a cross-ownership caller cannot reuse another tenant's durable consumer.
    - registry cleanup: a registered run that aborts is swept on registry close/abort; cap-overflow evicts the oldest leaked entry; a leaked registration does not survive a sweep; cross-tenant `getActiveWorkflowRun` returns undefined for another tenant.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — additive `EventMultiplexerError`/`ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER`; NATS durable identity becomes restart-stable; active-run registries documented non-durable.
    - Docs pages to create/edit:
      - `docs/agent-events.md` / `docs/public-contracts.md`: `EventMultiplexer` single-consumer enforcement and the error code.
      - `docs/database-persistence.md` / `docs/enterprise-postgres-state.md` (NATS section, if cross-linked): restart-stable NATS durable identity and orphan reclamation.
      - `docs/workflows.md` (if present) or `docs/agent-events.md`: active-run registry is non-durable, in-process, bounded lifecycle.
    - `docs/index.md` update: yes — refresh the Agent events / EventMultiplexer entry to mention single-consumer enforcement; refresh the workflows/active-run entry to note non-durability.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Status: complete (2026-08-13) at HEAD `7aa4684`. Evidence and deltas:
    - `EventMultiplexer` (`src/event-multiplexer.ts`): new `EventMultiplexerError` + `EVENT_MULTIPLEXER_SINGLE_CONSUMER_CODE` exported from `src/index.ts` (frozen root-surface list updated); `subscribe()` rejects a second concurrent consumer with `ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER`; the slot frees when the active consumer completes, is `return()`ed at a yield, or the multiplexer closes. `observe` fan-in, overflow, and close paths unchanged; interface shape unchanged.
    - Deviation 1 (async-generator semantics, empirically verified): a consumer parked awaiting an event cannot observe a queued `return()` — the async-generator machinery only processes it at the next yield/completion — so the slot frees at the next `publish`/`close`, and `close()` now frees the slot explicitly (`activeConsumer = false`) so a post-close subscriber terminates cleanly instead of throwing. The plan's example (`it1.return?.()` on a never-iterated subscription) works as written; the caveat is documented on `subscribe()`.
    - NATS durable identity (`packages/session-store-nats/src/event-source.ts`): `durableName` drops the `randomBytes(4)` suffix → `prism_<hmac16 of tenantId|sessionId|runId>`; `page`/`cleanup` keep `ephemeralName`. `FakeJetStream.addConsumer` is now an upsert that preserves ack/delivery state for a same-name re-add (models a crashed consumer surviving restart); the official adapter (`jetstream.ts`) catches `JetStreamApiError` code 10058 ("consumer already exists") and reuses the existing consumer at its last-acked position.
    - Deviation 2 (pre-existing close() hang, fixed in scope of "terminal cleanup deterministic"): `source.close()` previously hung forever when a subscriber was parked mid-fetch — `generator.return()` queues behind the pending fetch and the loop never yields. Each subscribe now gets a source-owned stop `AbortSignal` (`AbortSignal.any` with the caller's signal); `close()` aborts it first, the parked generator throws at its next loop check (bounded by one `pollIntervalMs`), the queued `return()` completes, and the durable consumer is deleted by the generator's finally.
    - Workflows active-run registry (`packages/workflows/src/active-runs.ts`): new `sweepActiveWorkflowRuns()` (removes registrations whose run was aborted but never unregistered — the `finally` at `run.ts:353` never ran), run automatically on every `registerActiveWorkflowRun`; new `MAX_ACTIVE_WORKFLOW_RUNS = 512` cap (parallel to the A2A registry cap) with fail-closed `ERR_PRISM_WORKFLOW_RUN_REGISTRY_OVERFLOW` when every entry is live; exports added to the package index.
    - Deviation 3 (registry cap): the sweep removes **all** aborted/leaked entries (not just the oldest `startedAt`), and at cap with no aborted entries the registry throws rather than FIFO-evicting a live entry — evicting a live entry would let a duplicate concurrent run of the same `runId` start (the exact hazard the registry prevents). There is no registry close/abort event: abort → `finally` → unregister, the opportunistic sweep, and the cap cover terminal cleanup. `agent-session`/`rpc` registries remain out of scope (per-instance/per-loop, bounded by construction, documented in the phase22 primitive review).
    - Tests: multiplexer 3 (reject second + slot frees on close; slot frees on `return()` at a yield; the guard only fires once a subscriber actually iterates); NATS 2 (stable name reused across restart with ownership binding, and crash-resume: a seeded crashed consumer with one ack is reused — the restarting subscribe does not replay the acked event); workflows 2 (sweep + re-admit of the same run; cap fail-closed + abort-then-register frees the slot).
    - Gate evidence: `npm test` 3,472 / 3,439 pass / 0 fail (33 protected skips; +7 tests over the Task 2 state); `test:postgres` 84/84 green; workflows 67/67, supervisor 23/23, session-store-nats 13/13.
    - Docs: `docs/public-contracts.md` (`EventMultiplexer` row: single-consumer contract + error code), `docs/workflows.md` (event-bus single-consumer + non-durable bounded active-run registry), `docs/agent-events.md` (NATS paragraph: restart-stable identity + orphan reclamation), `docs/index.md` (Public contracts / Workflows / Agent events entries). `docs/database-persistence.md` untouched — no NATS section exists there to cross-link.

- [x] Task 4 — Multi-process state conformance harness (memory + durable) with no timing-only sleeps
  - Acceptance Criteria:
    - Functional: add a dependency-free conformance harness `src/testing/state-concurrency-conformance.ts` (plus narrow per-domain probes: approval, cursor, checkpoint CAS, idempotency, router reservation, conversation metadata, unknown-outcome recovery) that runs each probe against the memory stores and the durable (Postgres; NATS for the event-source/conversation-replay probe) implementations through the existing `test:postgres`/`test:nats` gate shape. Each probe uses deterministic barriers (await the conflicting op, then assert state) — never `setTimeout`/timing-only sleeps.
    - Functional: approval: concurrent approve/deny on the same pending decision resolve to one terminal state; a stale decision discriminant is rejected (ties to 0.2.0's resume fix). Cursor: a replay cursor resumed across a "restart" (re-open the store) continues from the last-acked position, not the head. Checkpoint CAS: a `saveCheckpoint` with a stale `expectedVersion`/`fencingToken` is rejected; a higher fence wins. Idempotency: a retry with the same idempotency key returns the recorded outcome, not a duplicate side effect. Router reservation: parallel `reserveBudget` cannot oversubscribe (Task 1 probe). Conversation metadata: concurrent branch/archive/create preserve valid state or return `metadata_conflict` (Task 2 probe). Unknown-outcome recovery: an abandoned reservation/commit (crash before commit) reconciles to the reserved amount + redacted diagnostic, not a silent drop.
    - Functional: ownership never crosses tenants in any probe; retries are idempotent; no test relies on timing-only sleeps (a repo-wide grep for `setTimeout(` in the new harness files returns zero, and existing conformance helpers are not weakened).
    - Performance: the harness is test-only (no runtime cost); memory probes run in the default `npm test`; durable probes run in `test:postgres`/`test:nats`; no new background process.
    - Code Quality: the harness reuses the runner-free conformance-helper pattern (`assertAgentEventSourceConforms`, `runRunLedgerConformance`, `runSessionStoreConformance`); no new test framework; one factory type per store family.
    - Security: every probe is ownership-scoped; cross-tenant assertions reject; redaction applies to diagnostics; no raw transcript in conflict/unknown-usage errors.
  - Approach:
    - Documentation Reviewed:
      - `src/testing/agent-event-source-conformance.ts`; `src/testing/run-ledger-conformance.ts`; `src/testing/session-store-conformance.ts`; `src/testing/tool-effect-store-conformance.ts`; `package.json` `test:postgres`/`test:nats` wiring; Task 0–3 decisions.
    - Options Considered:
      - Per-store ad-hoc concurrency tests in each adapter: rejected; the roadmap asks for one harness proving memory and durable agree, and scattered tests cannot assert agreement.
      - A new test runner/process: rejected; the existing `node --test` + conformance-helper factory pattern already supports memory-vs-durable parameterization.
      - One runner-free harness with per-domain probes parameterized by store factory, wired into `test:postgres`/`test:nats`: chosen.
    - Chosen Approach:
      - Add `assertStateConcurrencyConforms(factory)` covering the seven domains; ship memory factory in `src/__tests__` (default `npm test`) and durable factories in `packages/session-store-postgres/src/__tests__`, `packages/session-store-sqlite/src/__tests__`, `packages/enterprise-postgres/src/__tests__`, `packages/session-store-nats/src/__tests__` (gated); ban `setTimeout` in the harness via a lint rule or a comment-check test.
    - API Notes and Examples:
      ```ts
      import { assertStateConcurrencyConforms, type StateConcurrencyFactories } from "@arnilo/prism/testing/state-concurrency-conformance";
      await assertStateConcurrencyConforms({ routerState: () => createMemoryModelRouterStateStore(), sessions: () => memorySessionStore(), … });
      ```
    - Files to Create/Edit:
      - `src/testing/state-concurrency-conformance.ts`: the harness + per-domain probes + `StateConcurrencyFactories` type.
      - `package.json`: export `./testing/state-concurrency-conformance` subpath (additive, mirroring the existing conformance subpaths); wire memory probe into the default `npm test` core suite; wire durable probes into `test:postgres`/`test:nats`.
      - `src/__tests__/state-concurrency-conformance.test.ts`: memory factory run.
      - `packages/session-store-postgres/src/__tests__/state-concurrency-conformance.test.ts`; `packages/session-store-sqlite/src/__tests__/state-concurrency-conformance.test.ts`; `packages/enterprise-postgres/src/__tests__/state-concurrency-conformance.test.ts`: durable factory runs (Postgres/SQLite gated via `test:postgres`).
      - `packages/session-store-nats/src/__tests__/state-concurrency-conformance.test.ts`: NATS factory run against the existing fake-jetstream seam in the workspace `npm test` (no root `test:nats` script exists; real-NATS restart-durable probes stay protected evidence).
      - `scripts/phase22-conformance.test.mjs`: gate leg asserting the harness ran against every available store (memory always; durable when the protected env is present, else blocked-not-skipped per 0.2.3's visibility rule once it lands; in 0.2.2, missing protected env records the durable probe as protected evidence, not a green skip).
    - References:
      - Task 0–3 evidence; `src/testing/*-conformance.ts`; `roadmap.md` §0.2.2 bullet 4 and mandatory regression matrix items 8–9.
  - Test Cases to Write:
    - approval determinism: concurrent approve/deny → one terminal; stale discriminant rejected.
    - cursor resume: re-open store, resume from last-acked cursor, not head.
    - checkpoint CAS: stale `expectedVersion`/`fencingToken` rejected; higher fence wins.
    - idempotency: retry same key → recorded outcome, no duplicate effect.
    - router reservation: parallel reserve → no oversubscription (Task 1 probe).
    - conversation metadata: branch/archive/create races → valid state or `metadata_conflict` (Task 2 probe).
    - unknown-outcome recovery: abandoned reservation → reserved amount charged + redacted `unknown_usage`, no silent drop.
    - no-timing-sleeps: grep `setTimeout(` in harness files → zero.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — additive `./testing/state-concurrency-conformance` subpath for adapter authors; durable adapters must pass it.
    - Docs pages to create/edit:
      - `docs/database-persistence.md` / `docs/enterprise-postgres-state.md`: adapters must pass `assertStateConcurrencyConforms` against memory+durable; protected-env gating.
      - `docs/conformance.md` (if present) or `docs/extension-conformance.md`: list the new harness alongside the existing conformance helpers.
    - `docs/index.md` update: yes — add/refresh a Conformance entry for the multi-process state concurrency harness.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Status: complete (2026-08-13) at HEAD `7aa4684`. Evidence and deltas:
    - Harness: `src/testing/state-concurrency-conformance.ts` ships `assertStateConcurrencyConforms(factories)` + `StateConcurrencyFactories` (core types for checkpoints/events/sessions; narrow structural seams for router and idempotency so core stays dependency-free — adapter packages pass their real stores). New `./testing/state-concurrency-conformance` export subpath; every factory accepts async creation (the postgres persistence factory is `async`).
    - Seven probes, deterministic barriers only (`Promise.allSettled` on the conflicting ops, then state assertions; `grep setTimeout(` in the harness = 0, asserted by the phase gate): approval determinism (concurrent approve/deny of one pending decision on the checkpoint seam admits exactly one terminal write, the loser fails with `ERR_PRISM_CHECKPOINT_CONFLICT`, and a stale expectedVersion discriminant — the 0.2.0 resume fix contract — is rejected), checkpoint CAS (stale version, lower fence rejected, higher fence wins), cursor resume (page-by-cursor continues from the last-acked position, never the head; durable factories close and re-open the store and resume from the same cursor), idempotency retry (8 parallel begins admit exactly one claim; a retry returns the recorded outcome, never a duplicate effect; stale-version second complete rejected), router reservation (4 parallel reserve of 26/100 admit exactly 3, stale fencing rejected, commit/release reconcile actuals), conversation metadata CAS (8 parallel create-only writes admit zero overwrites with 7+1 `metadata_conflict`… create-only duplicates never overwrite; 8 parallel expectedVersion-1 updates admit exactly one winner at version 2 with the winner's marker stored; cross-ownership rejected in the same guarded statement), unknown-outcome recovery (an abandoned reservation reconciles to the reserved amount with `unknownUsage: true` — no silent drop).
    - Deviation 1 (unknown-outcome determinism): the unknown-outcome probe drives expiry through the caller-supplied `now`, so it runs only when the router factory sets `nowInjected` (memory store). The durable store computes expiry from `clock_timestamp()` (not injectable), so its TTL reconciliation leg stays in the Task 1 enterprise-conformance integration probe (`test:postgres`, real 1ms TTL); the harness documents this split.
    - Deviation 2 (JSONB normalization): postgres stores checkpoint values as JSONB, which normalizes object key order, so winner-state comparisons use a semantic `deepEqual` helper instead of `JSON.stringify`.
    - Deviation 3 (postgres reopen leg): the cursor-resume reopen creates a fresh persistence against the SAME schema; a per-create random schema made the restarted store unable to decode the cursor (retention error). NATS reopen shares one `FakeJetStream` and a fixed `cursorSecret` (per-instance random secrets made restarted cursors undecodable — the existing conformance never re-opened).
    - Legs: core `src/__tests__/state-concurrency-conformance.test.ts` (memory checkpoints + events, default `npm test`); sqlite `:memory:` leg (conversation metadata CAS + checkpoints — the plan's memory leg for sessions since no core memory `appendSession` exists); NATS leg on the fake-jetstream seam with reopenable cursor resume (workspace `npm test`; real-NATS restart-durable stays protected evidence); enterprise memory leg (router + idempotency, default `npm test`); postgres durable leg (sessions/checkpoints/events with real re-open) and enterprise postgres leg (router + idempotency) in `test:postgres`.
    - Gate: `scripts/phase22-conformance.test.mjs` runs in the `test:postgres` chain — asserts the harness source bans `setTimeout(`, every store leg exists on disk, the memory leg passes against the core memory stores, and the durable legs pass against fresh postgres schemas; without `PRISM_TEST_POSTGRES_URL` a named BLOCKED GATE failure records the durable evidence as missing (never a green skip, per the 0.2.3 visibility rule). `docs.test.ts` pins the `test:postgres` script string and was updated for the new phase leg.
    - Budget: the harness + four test files pushed the root tarball past the 5% tolerance; `scripts/budgets.json` root packedBytes/unpackedBytes re-baselined (800042/2782640) with a dated `$comment` per the recorded release convention.
    - Gate evidence: `npm test` 3,479 / 3,446 pass / 0 fail; `test:postgres` 91/91 green (incl. the new postgres + enterprise durable legs and the 4 phase-gate tests).
    - Docs: `docs/database-persistence.md` (extension notes: adapters must pass `assertStateConcurrencyConforms`; harness uses deterministic barriers; memory leg in `npm test`, durable legs in `test:postgres`/`test:nats`, phase22 gate accounting), `docs/index.md` (Database persistence entry now covers the harness), `docs/release-and-install.md` (new testing subpath row). No separate `docs/conformance.md` exists; the harness is documented in the persistence page per the plan's `docs/database-persistence.md` option.

- [x] Task 5 — Security regression, built public-import, and packed-JavaScript conformance
  - Acceptance Criteria:
    - Functional: add direct public-API adversarial tests for all four 0.2.2 blockers (budget oversubscription, conversation lost-update/stale-revival, silent multi-subscriber, non-restartable NATS durable) and a packed plain-JavaScript consumer test so TypeScript types cannot hide runtime validation gaps; wire a `scripts/phase22-security.test.mjs` leg into `security:threat-suites`.
    - Functional: the suite asserts mandatory 0.2.x regression matrix items 8 (concurrent conversation branch/archive/create preserve valid state) and 9 (parallel router admissions cannot exceed reserved budget) explicitly by name.
    - Functional: the built public entrypoints (router state store, `appendSession` CAS, `EventMultiplexer`, NATS durable name) behave identically to source; packed plain-JS imports after a local tarball install pass the same four assertions with no TS compiler.
    - Performance: the security/conformance leg adds no measurable benchmark regression; budget gates green.
    - Code Quality: typecheck, Biome lint/format, unused sweep, docs semantic tests, public export tests pass; the leg cannot be skipped (missing protected env records blocked, not green).
    - Security: the adversarial tests prove the fixes are runtime-enforced, not type-only; cross-tenant, redaction, and ownership assertions hold after the packed consumer.
  - Approach:
    - Documentation Reviewed:
      - `plans/020` security-regression precedent; `plans/021` Task 7 built/packed pattern; `src/__tests__/install-smoke.test.ts`; `.github/workflows/{release,security}.yml`; Task 0–4.
    - Options Considered:
      - Type-only fixtures: rejected; the original gaps are runtime-only.
      - A new standalone pack harness: rejected; reuse the existing install-smoke lifecycle.
      - Extend the existing packed consumer + one focused built conformance suite: chosen.
    - Chosen Approach:
      - Test source-level details in Tasks 1–3, public built entrypoints here, and all packed exports in the existing install-smoke lifecycle; wire `phase22-security.test.mjs` into `security:threat-suites`.
    - API Notes and Examples:
      ```bash
      npm run build
      node --test scripts/phase22-security.test.mjs
      npm run security:threat-suites
      node --test dist/__tests__/install-smoke.test.js
      ```
    - Files to Create/Edit:
      - `scripts/phase22-security.test.mjs`: focused public-entry concurrency/durability conformance + matrix items 8–9 by name.
      - `src/__tests__/install-smoke.test.ts`: packed plain-JavaScript regression for the four blockers inside the existing consumer.
      - `package.json`: append `scripts/phase22-security.test.mjs` to `security:threat-suites`.
      - `scripts/phase22-baseline.json`: reserve final evidence fields; values recorded only in Task 6.
    - References:
      - Mandatory regression matrix items 8–9 in `roadmap.md`; `src/__tests__/install-smoke.test.ts`; `plans/021` Task 7.
  - Test Cases to Write:
    - built router: parallel `reserveBudget` cannot oversubscribe; TTL/unknown-usage reconciles.
    - built conversation: concurrent branch/archive/create preserve state or return `metadata_conflict`; archive not revived.
    - built multiplexer: second `subscribe()` rejects with `ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER`.
    - built NATS: restart-stable durable name resumes from last-acked cursor.
    - packed plain JS: same four assertions after local tarball install with no TS compiler.
    - gate accounting: phase-22 tests cannot be skipped and name matrix items 8–9.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new behavior — executable verification of Tasks 1–4.
    - Docs pages to create/edit:
      - `none`: public behavior docs belong to Tasks 1–4; release evidence is recorded in Task 6.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable; verification-only task.
  - Status: complete (2026-08-13) at HEAD `7aa4684`. Evidence and deltas:
    - Suite: `scripts/phase22-security.test.mjs` (wired into `security:threat-suites`) runs against BUILT PUBLIC package entrypoints (workspace dist via package exports) — never private source imports, because the original gaps were runtime-only. Four blocker tests + gate accounting asserting every blocker ID executed and none skipped:
      - T1 (matrix item 9 by name): 4 parallel `reserveBudget` of 26/100 admit exactly 3 with `retryAfterMs` on the denial; live commit reconciles actuals; a forged fencing token fails closed; a TTL-expired late commit reconciles the reserved amount with `unknownUsage: true`.
      - T2 (matrix item 8 by name): 8 parallel create-only `appendSession` writes admit exactly one winner at version 1; 8 parallel CAS writes at version 1 admit exactly one winner at version 2 with losers carrying `currentVersion`; a stale pre-archive writer cannot overwrite the archived state; a retention-deleted session is never resurrected by a stale CAS write (the EXISTS insert guard).
      - T3: a second `EventMultiplexer` subscriber rejects with `EventMultiplexerError` `ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER` (the built `createEventMultiplexer`), and a fresh subscriber works after the slot frees.
      - T4: the built `createNatsAgentEventSource` against an in-script structural `NatsJetStream` seam (the same narrow public interface `createNatsJetStream` adapts — no private fake import): the durable name is exactly `prism_<hmac16>` with no random suffix, a crash-left consumer is reused at its last ack (restart resumes at the second event, not the stream head), and cross-tenant ownership mints a distinct name.
    - Packed plain-JS: `src/__tests__/install-smoke.test.ts` gains the `security22.mjs` consumer (asserted in a new `it`; the canary-leak concatenation includes its output). The four blockers run against the installed tarballs with no TS compiler: router reservations/fencing/TTL reconcile; conversation create/CAS/archive/no-resurrect/cross-ownership with the conflict error carrying versions only (never metadata content); multiplexer rejection; NATS restart-stable resume via the packed `@arnilo/prism-session-store-nats` (package added to the install-smoke manifest list).
    - Baseline file: `scripts/phase22-baseline.json` created with the reserved evidence surface (npmTest/coverage/threatSuites/packDryRun/releaseGate/node20/protectedEvidence/phase22Security); values recorded only in Task 6.
    - Gate evidence: `npm test` 3,480 / 3,447 pass / 0 fail; `security:threat-suites` 47/47 (was 42; +4 blockers +1 gate accounting); `test:postgres` 91/91 (phase22 conformance gate unaffected).
    - Debugging notes (all fixed): `createEventMultiplexer` attaches sources via `observe()`, not a `sources` option; the NATS public `subscribe` returns an async-iterable wrapper, not a raw generator; the event-source reads ownership from `input.ownership`; the in-script seam must store the subject; a subscriber parked in an empty fetch loop can only be stopped by `close()` (its abort), never by a bare `return()`.

- [x] Task 6 — Migration/docs finalization, 0.2.2 bump, and fail-loud exit gate
  - Acceptance Criteria:
    - Functional: add a `docs/migration.md` section for 0.2.1 → 0.2.2 covering router reservation (reserve/commit/release, TTL/unknown-usage, map caps/eviction), `appendSession` CAS (`version`/`expectedVersion`, `metadata_conflict`, branch caps inside the transaction, archive/delete precedence, non-CAS caller compatibility), `EventMultiplexer` single-consumer rejection, NATS restart-stable durable identity (orphan reclamation), and active-run registry non-durability — with before/after semantics, plain-JavaScript examples, store-compatibility statement, rollout order, and rollback-risk warning.
    - Functional: update root and affected package changelogs/READMEs, `docs/index.md`, `docs/release-and-install.md`, and roadmap 0.2.2 checkboxes only after Tasks 0–5 pass. Documentation must not claim a generic locking framework, a broadcast multiplexer, durable active-run recovery, or any 0.3.x capability.
    - Functional: run `node scripts/release.mjs bump --from 0.2.1 --to 0.2.2` across all 50 manifests/lockfile and update version-sensitive tests, exact internal peer pins, tarball names, and release docs.
    - Functional: run a plain pre-refresh compatibility gate and review every delta. Additive exports (`reserveBudget`/`commitBudget`/`releaseBudget`, `SessionRecord.version`, `appendSession` `expectedVersion`, `EventMultiplexerError`, `./testing/state-concurrency-conformance`) and the version literal are the only expected deltas; no removal is planned. Any unexpected breaking declaration halts release and requires a recorded plan/manifest amendment before `--allow-break`. Refresh affected baselines only after review, then require the normal gate green.
    - Functional: run focused tests, `npm run security:threat-suites`, protected Postgres/NATS matrix (concurrency conformance against durable), `npm run sdk:ready`, full audit, tracked/unpacked secret scans, pack dry-run twice byte-identical, budget/benchmark gates, Node 20 packed imports, and the release gate. No concurrency item may be skipped; missing protected environment records 0.2.2 as blocked.
    - Functional: record command, version, platform, counts, hashes, skips/blocks, compatibility deltas, package/dependency graph, protected evidence, and `green` in `scripts/phase22-baseline.json.exitGate`; the phase-22 freeze done-state passes.
    - Performance: root and affected package sizes remain in budget; reservation/CAS/multiplexer/registry changes add no measurable benchmark regression.
    - Code Quality: typecheck, Biome lint/format, unused sweep review, docs semantic tests, public export tests, and diff checks pass; plan checkboxes, files, tests, compromises, and further actions reflect actual implementation.
    - Security: audit reports zero policy violations; secret scans report zero findings; packed JS and threat suites pass; Postgres/NATS protected concurrency evidence is present; signed tag/provenance remain operator-gated after clean protected CI.
  - Approach:
    - Documentation Reviewed:
      - `docs/migration.md` 0.2.0 → 0.2.1 structure; `docs/release-and-install.md`; `docs/index.md`; root/package changelogs; `roadmap.md` release validation checklist and 0.2.2 regressions; `plans/021` Task 8 compatibility review and exit-gate pattern; `.github/workflows/{release,security}.yml`.
    - Options Considered:
      - Release after unit tests with protected Postgres/NATS evidence optional: rejected; concurrency items are release blockers and cannot close on a skip.
      - Skip the additive export baselines: rejected; additive exports still need a reviewed compat-baseline refresh.
      - Scripted bump, reviewed normal compatibility gate, complete protected evidence, operator publication: chosen.
    - Chosen Approach:
      - Finalize migration first, bump once, review declarations, run all gates, record immutable evidence, then hand off signed tag/publication.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs bump --from 0.2.1 --to 0.2.2
      npm run security:threat-suites
      npm run sdk:ready
      npm audit --audit-level=moderate
      git ls-files -z | xargs -0 node scripts/scan-secrets.mjs
      node scripts/release.mjs gate --version 0.2.2
      ```
    - Files to Create/Edit:
      - `docs/migration.md`: 0.2.1 → 0.2.2 concurrency/durability migration.
      - `docs/release-and-install.md`: 0.2.2 protected evidence and publish handoff.
      - `docs/index.md`: current release and final navigation verification.
      - `CHANGELOG.md`: 0.2.2 concurrency/durability release.
      - Affected package READMEs/CHANGELOGs (model-router, enterprise-postgres, session-store-postgres, session-store-sqlite, session-store-nats, workflows, server, core): shipped behavior.
      - `package.json`, all workspace manifests, `package-lock.json`: scripted 0.2.2 bump.
      - `src/index.ts`, release/install/packaging/docs/public-export tests, package pin tests: version-sensitive updates.
      - `scripts/compat-baseline/*`: reviewed additive/version baseline refresh only.
      - `scripts/phase22-baseline.json`: complete exit evidence.
      - `scripts/phase22-freeze-manifest.json`: final task/evidence tokens; deviations only if actually required.
      - `roadmap.md`: mark the four 0.2.2 items complete after all gates pass.
      - `plans/022-...md`: close tasks and fill actual compromises/further actions.
      - `plans/README.md`: status complete only after exit gate.
    - References:
      - `plans/021-Release-0-2-1-Provider-Completion-and-Outbound-Trust-Boundaries.md` Task 8; `plans/020` Task 6; `plans/019` Task 6.
  - Test Cases to Write:
    - migration semantic tripwire: docs contain old/new reservation, CAS, single-consumer, NATS durable, and registry-non-durable examples.
    - compatibility sequence: plain pre-refresh delta reviewed; plain post-refresh gate green; unexpected removal blocks.
    - release accounting: all tests/skips/protected environments named; any missing phase-22 item evidence makes `green: false`.
    - package truth: 50 manifests, versions/peers/lockfile consistent, zero new dependency names, deterministic tarballs.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — publishes migration and release truth for all four changed concurrency/durability boundaries.
    - Docs pages to create/edit:
      - `docs/migration.md`: mandatory 0.2.2 migration.
      - `docs/release-and-install.md`: protected gate and operator handoff.
      - `CHANGELOG.md` and affected package changelogs: shipped behavior.
      - Task 1–4 docs: final semantic verification and corrections only.
    - `docs/index.md` update: yes — current release plus final Model routing, Conversations, Agent events/EventMultiplexer, Persistence, and Conformance navigation descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Status: complete (2026-08-13) at the 0.2.2 working-tree state. Evidence and deltas:
    - Migration: `docs/migration.md` gains the `0.2.1 → 0.2.2` section — router reservation (reserve/commit/release with fencing, TTL/unknown-usage, map caps/eviction), `appendSession` CAS (`version`/`expectedVersion`, `metadata_conflict`, branch caps inside the CAS write, archive/delete precedence, non-CAS caller compatibility), `EventMultiplexer` single-consumer rejection, NATS restart-stable durable identity with orphan reclamation, and active-run registry non-durability — with before/after semantics, plain-JS examples, store-compatibility statement (forward-only migrations 008 + 003; 0.2.1 binaries read 0.2.2 databases but ignore the new columns), rollout order, and rollback-risk warning.
    - Docs: root CHANGELOG `[0.2.2]` entry + changelog entries for model-router, enterprise-postgres, session-store-postgres, session-store-sqlite, session-store-nats, workflows, server; `docs/index.md` current-release line 0.2.2; `docs/release-and-install.md` `0.2.2 publish handoff` (protected-evidence procedure: OIDC/OPA + durable conformance + NATS restart-durable); `roadmap.md` all four 0.2.2 items `[x]`. No generic locking framework, broadcast multiplexer, durable active-run recovery, or 0.3.x capability claimed anywhere.
    - Bump: `node scripts/release.mjs bump --from 0.2.1 --to 0.2.2` across all 50 manifests + `npm install --package-lock-only`; version-sensitive updates applied (src/index.ts version const, docs.test.ts current-line + root version, index/cli-provider-add/release/packaging/install-smoke tarball + peer pins, 12 workspace peer tests); lockfile 153 × 0.2.2, 0 × 0.2.1.
    - Compat: plain pre-refresh gate at 0.2.2 reviewed — deltas ONLY additive (version literal; PERSISTENCE_SCHEMA_VERSION 7→8; EVENT_MULTIPLEXER_SINGLE_CONSUMER_CODE/EventMultiplexerError; ModelRouterStateStore reserveBudget/commitBudget/releaseBudget + ModelRouterReservation + reservationTtlMs + maxRateKeys/maxBudgetKeys; SessionRecord.version/expectedVersion; buildMigration008Ddl + MIGRATION_008_SESSION_VERSION; buildEnterpriseMigration003Ddl; ActiveWorkflowRun.startedAt + ACTIVE_WORKFLOW_RUNS_OVERFLOW_CODE + MAX_ACTIVE_WORKFLOW_RUNS + sweepActiveWorkflowRuns; testing/state-concurrency-conformance subpath) — then `--update-baseline`, plain gate green, no `--allow-break`. The phase21-freeze state machine gained the phase20 version-literal tolerance for the bumped package.json/src/index.ts markers (deviation recorded).
    - Freeze evidence: `scripts/phase22-freeze-manifest.json` with per-task tokens (tasks 0-6 done), 7 recorded deviations, compat promise, protected-gate policy; `scripts/phase22-baseline.json` exitGate green: npm test 3,480 / 3,447 pass / 33 protected skips / 0 fail (script gates 255/255), coverage 90.49/84.19/90.55, threat-suites 47/47, test:postgres 91/91 (dockerized PG, `prism_phase22_*` schemas), audit 0 moderate, secrets 1,527 files / 0 findings, pack dry-run 50 packages twice byte-identical (run sha256 7b5ae5dd...), release gate 0.2.2 50 packages 0 errors 0 breaking deltas, node20 v20.20.2 packed exports imports 24/24, sdk:ready composite exit 0, typecheck 0, lint 0 errors (75 pre-existing FIXABLE warnings), format clean.
    - Debugging notes (all fixed): biome flagged 3 noUnsafeOptionalChaining errors in the Task 2 sqlite CAS test asserts (hoisted the optional element); biome format --write reformatted 17 files including state.ts so the phase19 preservedSurface hash was refreshed again (b07d06e0...); `release.mjs check` requires a clean tree so the release-gate evidence comes from `release.mjs gate` (operator tag step is the documented handoff).

## Compromises Made

- **Reservations reuse the existing `prism_model_router_budgets` table** (chosen; the separate reservation-table fallback was rejected) — migration 003 adds a single `reservations JSONB NOT NULL DEFAULT '[]'` column because a single-slot row cannot hold N concurrent reservations; the plan's five scalar columns were replaced by one JSONB array. Migration 001's checksum is already recorded in released 0.2.1 databases, so 003 is a forward-only ALTER.
- **`appendSession` CAS is the sole approach** — the append-only `prism_conversation_branches` fallback was never needed by a host. Legacy callers that omit `expectedVersion` keep 0.2.1 last-write-wins behavior (non-CAS caller compatibility).
- **`EventMultiplexer` slot-freeing rule is “first consumer done/closed/aborted”**, with one documented edge case: a consumer parked on the shared waiter (not yet drained) holds the slot until the next publish/close — `close()` also clears the flag so a fresh subscriber after close terminates with `done` instead of a false single-consumer rejection; `return()` while parked queues behind the pending await (per-subscriber stop signals fix the NATS variant).
- **NATS orphan reclamation relies on the existing `deleteConsumer`/consumer-enumeration path on the next clean stop of a same-subject subscribe** — no one-time sweep was needed; only a crash leaves a durable consumer in place (which is the point: it is reused at its last ack).
- **The active-run registry cleanup is close/abort-only (no timer)** per the no-background-service boundary: `registerActiveWorkflowRun` sweeps aborted/leaked entries before every insert and fails closed at the 512 cap (`ERR_PRISM_WORKFLOW_RUN_REGISTRY_OVERFLOW`) instead of FIFO-evicting a live entry; a leaked non-aborted run is reclaimed only when aborted or swept at the cap.
- **Durable conformance probes were recorded as protected evidence, not skips**: with `PRISM_TEST_POSTGRES_URL` present (dockerized postgres:16-alpine) the Postgres legs ran for real (91/91); the phase22-conformance gate's BLOCKED branch fires only standalone (mirrors phase12). The unknown-outcome durable TTL probe needs a real >=1ms sleep against `clock_timestamp()`, so the deterministic no-sleep unknown-outcome probe runs only on the memory store with injectable `now`.
- **The phase21-freeze state machine gained the phase20 version-literal tolerance** (accepts the phase release version or the current root version for `package.json`/`src/index.ts` markers) because the 0.2.2 bump advances the literal.

## Further Actions

- (0.3.0) Live NATS JetStream suite and protected Postgres multi-replica failover for the durability probes that 0.2.2 proves against a single durable instance.
- (0.2.3) Make the protected durable conformance skips visible in the release summary (0.2.2 records them as protected evidence; 0.2.3 makes the summary machine-auditable).
- (0.2.6) Durable active-run recovery (the registries stay non-durable in 0.2.2 by design).
- (0.2.5) The god-module split of `agent-session.ts` may revisit the active-run registry placement.
- (0.2.3) Biome: resolve the remaining 75 FIXABLE `useTemplate` warnings and migrate the deprecated `biome.json` config (the roadmap 0.2.3 quality-gates item).
- (demand-gated) A broadcast `EventMultiplexer` option if a host needs fan-out beyond the event source's own `subscribe`.
- (demand-gated) Per-model overflow cost attribution remains out of scope (carried from 0.2.1).