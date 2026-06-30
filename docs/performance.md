# Performance limits

## What it does

This page states Prism runtime limits that keep slow consumers and long sessions from becoming unbounded memory or latency problems.

Current surfaces:

- `SubscribeOptions` for bounded live `AgentEvent` subscriber queues.
- `SessionStore.readBranchPath(query)` for branch reads that avoid full-session scans.
- `ProductionPersistenceStore` cursor queries for entries, events, runs, tool calls, and usage.
- JSONL and memory stores documented as development/local adapters, not production multi-writer stores.

## When to use it

Use these limits when embedding Prism in a UI, API server, job worker, or multi-tenant app that may have slow event consumers or long-lived sessions.

Do not treat Prism's live event subscribers as a durable queue. Use `RunLedger` / database persistence for replay, audit, billing, and timelines.

## Inputs / request

```ts
import { createAgent, type SubscribeOptions } from "@arnilo/prism";

const options: SubscribeOptions = {
  maxQueuedEvents: 256,
  overflow: "close",
};

const events = session.subscribe(options);
```

`SubscribeOptions` fields:

| Field | Default | Purpose |
| --- | --- | --- |
| `maxQueuedEvents` | `1024` | Maximum events queued for one subscriber while it is not awaiting `next()`. Values below `1` are clamped to `1`. |
| `overflow` | `"close"` | Overflow policy: `"close"`, `"drop_oldest"`, or `"drop_newest"`. |

## Outputs / response / events

On default overflow, the affected subscriber receives one `event_subscriber_overflow` event and then finishes:

```json
{
  "type": "event_subscriber_overflow",
  "sessionId": "session_1",
  "droppedEvents": 257,
  "maxQueuedEvents": 256,
  "overflow": "close"
}
```

`drop_oldest` keeps the newest queued events. `drop_newest` ignores incoming events while the queue is full. These policies are live-view policies only; they do not affect `RunLedger` writes or stored session entries.

## Request/response example

```json
{
  "subscribe": { "maxQueuedEvents": 256, "overflow": "close" },
  "store": "database-backed SessionStore with readBranchPath",
  "eventLedger": "cursor-paginated by runId and sequence"
}
```

## Implementation example

```ts
import { createAgent, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";

const agent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider: createMockProvider([providerTextDelta("Hello"), providerDone()]),
});

const session = agent.createSession();
const reader = (async () => {
  for await (const event of session.subscribe({ maxQueuedEvents: 256, overflow: "close" })) {
    if (event.type === "event_subscriber_overflow") break;
    render(event);
  }
})();

await session.run("Hi");
await reader;

function render(_event: unknown) {}
```

For production branch reads, implement `SessionStore.readBranchPath` instead of loading every entry:

```ts
const store = {
  async append(entry, options) { /* transaction + parent/idempotency checks */ },
  async list(sessionId) { /* development fallback only */ return []; },
  async readBranchPath(query) {
    // Use one ancestor query / recursive CTE and return a cursor page.
    return { items: [], nextCursor: undefined };
  },
};
```

## Extension and configuration notes

- `SubscribeOptions` is per subscriber. One slow UI can be closed or dropped without affecting other subscribers, the active run, ledger writes, or session storage.
- `RunLedger` remains the durable event/timeline surface. Hosts may batch inside their ledger adapter, but Prism awaits ledger writes at safe boundaries; preserve per-run event order before acknowledging a batch.
- Database-backed stores should implement `readBranchPath` and cursor-paginated `ProductionPersistenceStore` queries. Memory and JSONL stores intentionally use full-session/file reads.
- Cursor pagination should use indexed keys, not offsets: `(run_id, sequence)` for events, `(session_id, started_at, id)` for runs, `(run_id, recorded_at, id)` for usage, and `(session_id, timestamp, id)` for entries.
- Hosts own queue sizes, page-size caps, database indexes, connection pools, transaction timeouts, retention jobs, partitioning, and multi-process coordination.

## Security and performance notes

- Overflow events contain only counts and policy, never message text, tool arguments, prompts, provider payloads, or credentials.
- Runtime event payloads can be large (`Message`, content deltas, tool results, summaries, artifact metadata). Size queues by events and keep payload size in mind.
- Live subscriber queues are bounded by default. Durable replay belongs to host storage.
- `SessionStore.list(sessionId)` is a full-session read. It is fine for memory/JSONL development stores, but production adapters should use `readBranchPath` for provider context and branch views.
- The JSONL store rereads/parses the file for validation/list/get and serializes appends only within one process. It has no cross-process lock, pagination, migrations, tenant isolation, or retention.
- Recommended database indexes: session id, run id, parent id, branch leaf id, timestamps, tenant/account/user, event type, entry kind, `(run_id, sequence)` for event timelines, and `(run_id, recorded_at, id)` for usage. Allocate event `sequence` per run for stable timeline pagination.

## Related APIs

- [Agent events](agent-events.md): `SubscribeOptions` and `event_subscriber_overflow` event details.
- [Agent/session runtime](agent-session-runtime.md): `session.subscribe()` and runtime event flow.
- [Session stores](session-stores.md): `SessionStore.readBranchPath` and dev-vs-production branch reads.
- [Database persistence](database-persistence.md): cursor queries, reference schema, indexes, and event sequence guidance.
- [Runs and usage ledger](runs-and-usage.md): durable event, tool-call, and usage persistence.
- [Node JSONL session store](node-jsonl-session-store.md): development-only JSONL limits.
