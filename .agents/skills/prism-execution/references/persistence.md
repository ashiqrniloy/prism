# Persistence — session stores, checkpoints, leases, run ledger

Session storage, durable adapters, migrations, conversations, enterprise state.

## Docs (current contracts)

- [session-stores.md](../../../../docs/session-stores.md): `SessionStore` contract, branches, bounded search — start here.
- [database-persistence.md](../../../../docs/database-persistence.md): contracts, checksummed migrations, retention, conformance harnesses.
- [sqlite-persistence.md](../../../../docs/sqlite-persistence.md): `better-sqlite3` adapter.
- [postgres-persistence.md](../../../../docs/postgres-persistence.md): pooled `pg` adapter, advisory-locked migrations.
- [enterprise-postgres-state.md](../../../../docs/enterprise-postgres-state.md): governance/router/ERP state, outbox/inbox.
- [conversations.md](../../../../docs/conversations.md): threads, version/CAS metadata, legal-hold deletion.
- [work-artifacts-and-review.md](../../../../docs/work-artifacts-and-review.md): artifact review, delivery links.
- [node-jsonl-session-store.md](../../../../docs/node-jsonl-session-store.md): dev-only JSONL adapter.

## Graft queries

- `graft ask "appendSession version CAS conflict" --source`
- `graft ask "checkpoint lease fencing owner" --source`
- `graft callers assertStateConcurrencyConforms`

## Tests

- `src/__tests__/session-stores.test.ts`, `persistence-*.test.ts`, `run-ledger*.test.ts`
- `src/__tests__/state-concurrency-conformance.test.ts` (memory leg; durable legs in `test:postgres`/`test:nats`)
- `scripts/phase22-conformance.test.mjs` gate accounting

## Don't do

- Don't write a migration without a checksum entry in the shared migration catalog.
- Don't resurrect deleted rows or fabricate exit codes/outcomes on recovery.
- Durable adapters must pass `assertStateConcurrencyConforms` before shipping.

Adjacent: `session-stores-and-branching.md` is a compatibility stub — link canonical sections from `session-stores.md`.
