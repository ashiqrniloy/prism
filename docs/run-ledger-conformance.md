# Run ledger conformance

## What it does

Run ledger conformance helpers are dependency-free assertions for `RunLedger` adapter tests. They exercise durable writes for runs, events, tool calls, and usage, per-run event ordering, optional tenant-scoped persistence, and restart survival without network or credentials.

Exported from `@arnilo/prism/testing/run-ledger-conformance`:

- `assertRunLedgerConforms(fixture, options?)`
- `runRunLedgerConformance(factory, options?)`
- `RunLedgerConformanceFixture`
- `RunLedgerConformanceOptions`

## When to use it

Use this helper when implementing a database-backed `RunLedger` (for example, alongside the reference pattern in `examples/external-app-db-backed.ts`). It asserts the write contract the runtime expects before you add dialect-specific SQL:

- `appendRun` / `appendEvent` / `appendToolCall` / `appendUsage` round-trip via optional `read*` callbacks
- per-run `AgentEventRecord` append order is preserved
- multiple `appendRun` rows for the same run id (running → terminal) are allowed
- `tenant_id` is stored on rows when `exerciseTenantIsolation: true`
- durable rows survive adapter reopen when `exerciseReopen: true` and the factory returns a reopened connection to the same backing store

Pair with `@arnilo/prism/testing/persistence-schema` for shared table/index/migration expectations and `@arnilo/prism/testing/session-store-conformance` for the `SessionStore` write path.

## Inputs / request

```ts
import { assertRunLedgerConforms } from "@arnilo/prism/testing/run-ledger-conformance";
import type { RunLedger } from "@arnilo/prism";

await assertRunLedgerConforms({
  ledger: myLedger,
  readRuns: () => queryRuns(),
  readEvents: () => queryEvents(),
  readToolCalls: () => queryToolCalls(),
  readUsage: () => queryUsage(),
}, { exerciseTenantIsolation: true });
```

Factory entry point for durable adapters:

```ts
import { runRunLedgerConformance } from "@arnilo/prism/testing/run-ledger-conformance";

await runRunLedgerConformance(() => createSqliteLedger(testDb), { exerciseReopen: true });
```

## Outputs / response / events

Returns `Promise<void>`; throws a plain `Error` on the first contract violation. No events, no runner.

## Request/response example

```ts
import { runRunLedgerConformance } from "@arnilo/prism/testing/run-ledger-conformance";

await runRunLedgerConformance(() => postgresLedgerFixture());
// throws if events are reordered, tool/usage rows are dropped, or reopen loses durable rows.
```

## Implementation example

```ts
import { assertRunLedgerConforms } from "@arnilo/prism/testing/run-ledger-conformance";

const runs: RunRecord[] = [];
const events: AgentEventRecord[] = [];
const ledger: RunLedger = {
  appendRun: async (record) => { runs.push(record); },
  appendEvent: async (record) => { events.push(record); },
  appendToolCall: async () => undefined,
  appendUsage: async () => undefined,
};

await assertRunLedgerConforms({ ledger, readRuns: () => runs, readEvents: () => events });
```

## Extension and configuration notes

- `read*` callbacks are optional for smoke tests but required for ordering, tenant, and reopen probes.
- `RunLedger` is write-only from Prism's perspective; replay/query APIs live on `ProductionPersistenceStore` or host-owned reads.
- Run conformance against the underlying write-through adapter. Test `createBatchedRunLedger()` separately for FIFO, bounds, terminal/manual flush, retained failure, and documented buffered crash loss; batching does not weaken adapter conformance.
- Redaction is not asserted here — the runtime calls `redactRunLedgerRecord()` before writes when a `SecretRedactor` is active.

## Security and performance notes

- No credentials, no network, no real secrets required.
- The helper performs a small fixed number of ledger writes; it is bounded and fast.
- Tenant isolation on reads is host-owned; the helper verifies `tenant_id` is stored and that scoped reads do not collide across tenants when you provide tenant-filtered `read*` callbacks.

## Related APIs

- [Runs and usage ledger](runs-and-usage.md)
- [Database persistence](database-persistence.md)
- [Session store conformance](session-store-conformance.md)
- [Persistence schema primitives](database-persistence.md#shared-schema-model-and-migration-contract)
