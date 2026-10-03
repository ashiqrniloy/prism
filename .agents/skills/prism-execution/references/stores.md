# Stores — store slot, durable stores, package state, suspended runs

The kernel `store` slot (`SessionStore` contract, in-memory default, entry types), and the store packages `store-jsonl`, `store-sqlite`, and `store-postgres`.

## Target

- [roadmap.md](../../../../roadmap.md) §2.1 (Store row), §2.5 (slots), §2.9 (`store-*` row). Built in roadmap Phase 6. The entry types needed for package state and suspended runs land in Phases 2 and 3.
- **Kernel scope:** only the contract, the in-memory store, and entry types. Package-state entries (`prism.state.session`) and suspended-run records must round-trip through every store.
- **Driver isolation:** each driver loads only in its own package. An agent without `store-postgres` never imports `pg`.
- **Session index:** `agent.sessions` (list, get, delete, search, title) lights up according to the store's capabilities.
- **Checkpoints:** a checkpoint store follows the session store when the adapter provides one.

## Today (0.12 code being replaced)

- Kernel parts: `src/contracts-core/session.ts`, `src/contracts-core/persistence.ts`, `src/session-stores.ts` (`createMemorySessionStore`), `src/checkpoints.ts`, `src/checkpoint-restore.ts`, `src/persistence-lifecycle.ts`.
- To packages:
  - `src/node/session-store-jsonl.ts` → `store-jsonl`
  - `packages/prism-core/src/sessions/{sqlite,postgres,nats,codecs}` → `store-*`
- To be re-homed in the kernel-freeze phase: `src/run-ledger.ts`, `src/leases.ts`, `src/conversations.ts`, `src/run-bundle.ts`.
- Lab code being deleted: `packages/prism-code/src/sessions.ts` (session-path policy).
- Current docs (released contract): [session-stores.md](../../../../docs/session-stores.md) (start here), [database-persistence.md](../../../../docs/database-persistence.md), [sqlite-persistence.md](../../../../docs/sqlite-persistence.md), [postgres-persistence.md](../../../../docs/postgres-persistence.md), [node-jsonl-session-store.md](../../../../docs/node-jsonl-session-store.md), [durable-runs.md](../../../../docs/durable-runs.md), [conversations.md](../../../../docs/conversations.md).

## Graft queries

- `graft ask "appendSession version CAS conflict" --source`
- `graft ask "checkpoint lease fencing owner" --source`
- `graft callers createJsonlSessionStore --depth all`

## Tests

- `src/__tests__/session-stores.test.ts`, `persistence-*.test.ts`, `run-ledger*.test.ts`, `node-session-store-jsonl.test.ts`
- `src/__tests__/state-concurrency-conformance.test.ts` (memory leg). The durable legs run in `bun run test:postgres` and `bun run test:nats`, which need explicit URLs.
- Session-store conformance: `@arnilo/prism/testing/session-store-conformance`. Extend it for package-state and suspended-run entries before any store package ships.

## Rules

- A migration needs a checksum entry in the shared migration catalog.
- Never resurrect deleted rows or fabricate exit codes or outcomes on recovery.
- A durable store must pass `assertStateConcurrencyConforms` and the session-store conformance suite before it ships.
- Redaction runs before any append. No store persists a secret.
