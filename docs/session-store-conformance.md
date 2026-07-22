# Session store conformance

## What it does

Session store conformance helpers are dependency-free assertions for `SessionStore` adapter tests. They exercise the append/idempotency/conflict/branch invariants of any `SessionStore` implementation without network or credentials.

Exported from `@arnilo/prism/testing/session-store-conformance`:

- `assertSessionStoreConforms(store, options?)`
- `runSessionStoreConformance(factory, options?)`
- `SessionStoreConformanceOptions`
- `SessionStoreConformanceFactory`

## When to use it

Use this helper when implementing a DB-backed `SessionStore` (for example, the reference pattern in `examples/external-app-db-backed.ts`). It asserts the contract that the core memory and JSONL stores already satisfy, so an adapter author does not re-derive it:

- append + `list` round-trip
- duplicate entry id rejection
- `expectedParentId` mismatch throws `SessionAppendConflictError` and writes nothing (atomic append)
- `idempotencyKey` deduplication of an exact retry at the same position
- branching from any existing entry (existence validation, not tip-CAS)
- distinct linear appends sharing a run-level `idempotencyKey` are not collapsed
- optional `readBranchPath` returns the ancestor chain in root-to-leaf order (when `exerciseReadBranchPath: true`)
- session ids remain isolated (`assertSessionStoreConforms` always probes a secondary session)
- optional concurrent fork children of the same parent succeed when `exerciseConcurrentParentAppend: true`
- optional durable reopen/idempotency survival when `runSessionStoreConformance(..., { exerciseReopen: true })`
- optional `searchSessions` bounds/ownership/empty-page checks when `exerciseSearchSessions: true` (`assertSessionStoreSearchSessions`)
- optional `searchSessions` bounds/ownership/empty-page checks when `exerciseSearchSessions: true` (`assertSessionStoreSearchSessions`)

## Inputs / request

```ts
import { assertSessionStoreConforms } from "@arnilo/prism/testing/session-store-conformance";
import type { SessionStore } from "@arnilo/prism";

await assertSessionStoreConforms(myDbBackedStore, { exerciseReadBranchPath: true });

// Durable adapters: factory reopens the same backing store
await runSessionStoreConformance(() => createStore(testDatabase), {
  exerciseReadBranchPath: true,
  exerciseReopen: true,
  exerciseConcurrentParentAppend: true,
});
```

`SessionStoreConformanceOptions`:
- `sessionId?: string` — stable session id for the run (default `"conformance"`)
- `otherSessionId?: string` — secondary session for isolation probes
- `exerciseReadBranchPath?: boolean` — also probe `readBranchPath` when implemented
- `exerciseConcurrentParentAppend?: boolean` — also probe concurrent fork appends
- `exerciseReopen?: boolean` — only on `runSessionStoreConformance`; reopen via the same factory

## Outputs / response / events

Returns `Promise<void>`; throws a plain `Error` on the first contract violation. No events, no runner.

## Request/response example

```ts
import { assertSessionStoreConforms } from "@arnilo/prism/testing/session-store-conformance";

await assertSessionStoreConforms(postgresBackedStore);
// throws if the adapter accepts a duplicate id, ignores a missing parent, or
// collapses distinct linear appends sharing an idempotency key.
```

## Implementation example

```ts
import { assertSessionStoreConforms } from "@arnilo/prism/testing/session-store-conformance";
import { createMemorySessionStore } from "@arnilo/prism";

// The core memory store conforms:
await assertSessionStoreConforms(createMemorySessionStore());
```

## Extension and configuration notes

- The helper writes real entries into the supplied store; use a throwaway session id or a test schema.
- `readBranchPath` is optional; stores that omit it skip that probe.
- Adapter authors should also exercise `rebuildSessionContext`/`getSessionBranchEntries` with their own fixtures for branch-rebuild behavior beyond the conformance baseline.

## Security and performance notes

- No credentials, no network, no real secrets required.
- The helper performs a small fixed number of appends; it is bounded and fast.
- It does not assert secret redaction in stored entries — pair with `createSecretRedactor` checks in your own tests when entries may carry secret text.

## Related APIs

- [Session stores and branching](session-stores-and-branching.md)
- [Session stores](session-stores.md)
- [Database persistence](database-persistence.md)
- [Run ledger conformance](run-ledger-conformance.md)
- [Provider conformance](provider-conformance.md)
