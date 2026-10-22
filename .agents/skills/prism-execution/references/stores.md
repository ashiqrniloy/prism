# Stores — store slot, durable stores, package state, suspended runs

The kernel `store` slot (`SessionStore` contract, in-memory default, entry types), and the store packages `store-jsonl`, `store-sqlite`, and `store-postgres`.

## Target

- [roadmap.md](../../../../roadmap.md) §2.1 (Store row), §2.5 (slots), §2.9 (`store-*` row). Built in roadmap Phase 6. The entry types needed for package state and suspended runs land in Phases 2 and 3.
- **Kernel scope:** only the contract, the in-memory store, and entry types. Package-state entries (`prism.state.session`) and suspended-run records must round-trip through every store.
- **Driver isolation:** each driver loads only in its own package. An agent without `store-postgres` never imports `pg`.
- **Session index:** `agent.sessions` (list, get, delete, search, title) lights up according to the store's capabilities.
- **Checkpoints:** a checkpoint store follows the session store when the adapter provides one.

## Today

- Kernel: the `store` slot contract (`src/contracts-core/{session,persistence}.ts`), the in-memory default (`src/session-stores.ts`, `createMemorySessionStore`), session links and the session index, and the run ledger (`src/run-ledger.ts`).
- Packages (`packages/stores/*`): `jsonl` (`createJsonlSessionStore`), `sqlite` and `postgres` (sessions, migrations, plus the checkpoint and lease services `prism-workflows` consumes), and `codecs` (shared persistence schema, cursors, query semantics, and conformance helpers).
- Checkpoints and leases moved out of the kernel into `prism-workflows` and the durable stores (roadmap Phase 16).
- Current docs: [slots.md](../../../../docs/slots.md) (store slot, start here), [`jsonl`](../../../../packages/stores/jsonl/README.md), [`sqlite`](../../../../packages/stores/sqlite/README.md), [`postgres`](../../../../packages/stores/postgres/README.md), [`codecs`](../../../../packages/stores/codecs/README.md), [disaster-recovery.md](../../../../docs/disaster-recovery.md).

## Graft queries

- `graft ask "appendSession version CAS conflict" --source`
- `graft ask "checkpoint lease fencing owner" --source`
- `graft callers createJsonlSessionStore --depth all`

## Tests

- Kernel: `src/__tests__/session-stores.test.ts`, `session-index.test.ts`, `session-links.test.ts`, `run-ledger.test.ts`, `persistence-contracts.types.test.ts`
- Packages: `packages/stores/<name>/src/__tests__/` (run from each package directory). The Postgres leg needs `PRISM_TEST_POSTGRES_URL` (`bun run test:postgres`).
- Published conformance: `storeConformance`, `assertStateConcurrencyConforms` (`@arnilo/prism/testing/state-concurrency-conformance`), and `@arnilo/prism/testing/run-ledger-conformance`

## Rules

- A migration needs a checksum entry in the shared migration catalog.
- Never resurrect deleted rows or fabricate exit codes or outcomes on recovery.
- A durable store must pass `storeConformance` and `assertStateConcurrencyConforms` before it ships.
- Redaction runs before any append. No store persists a secret.
