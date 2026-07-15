# Performance limits

## What it does

This page states Prism runtime limits that keep slow consumers and long sessions from becoming unbounded memory or latency problems.

Current surfaces:

- `SubscribeOptions` for bounded live `AgentEvent` subscriber queues.
- Bounded provider transport primitives (`readSseEvents`, `readBoundedResponseText`) used by every first-party provider package — see [Provider primitives](provider-primitives.md).
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
- `toolConcurrency` on the single-shot loop bounds in-flight tool dispatches per provider turn to `min(toolConcurrency, calls.length)`. Independent slow tools can overlap; transcript appends remain ordered. Default `1` preserves sequential behavior.
- `read` image bounds: default `maxImageBytes` is 10 MB (`DEFAULT_MAX_IMAGE_BYTES`). Oversize images are rejected by `stat` before read when possible; hosts may supply `transformImage` for resize/re-encode without adding image-processing deps to the base package.
- Live subscriber queues are bounded by default. Durable replay belongs to host storage.
- `SessionStore.list(sessionId)` is a full-session read. It is fine for memory/JSONL development stores, but production adapters should use `readBranchPath` for provider context and branch views.
- The JSONL store rereads/parses the file for validation/list/get and serializes appends only within one process. It has no cross-process lock, pagination, migrations, tenant isolation, or retention.
- Recommended database indexes: session id, run id, parent id, branch leaf id, timestamps, tenant/account/user, event type, entry kind, `(run_id, sequence)` for event timelines, and `(run_id, recorded_at, id)` for usage. Allocate event `sequence` per run for stable timeline pagination.
- Provider SSE parsing defaults: 256 KiB per completed event, 512 KiB incomplete buffer, 64 KiB error response bodies. Override per call via `BoundedStreamLimits` on `@arnilo/prism/providers/transport`.

### Provider-phase benchmark snapshot (2026-07-14)

Node v24.18.0, Linux x86_64, AMD Ryzen 9 PRO 7940HS; local synthetic streams, no network or exporter I/O:

| Case | Result |
| --- | --- |
| `readSseEvents`, 16 MiB total as 4 KiB events | 380 MiB/s, +1.7 MiB end-of-run heap delta |
| 100 provider deltas with 1 ms transport delay, no telemetry | 107.97 ms median |
| Same run, disabled adapter attached | 107.25 ms median (-0.67%, noise) |
| Same run, enabled no-op exporter | 107.22 ms median (-0.70%, noise) |

Nine measured runs per telemetry mode after warm-up; table reports median. A zero-I/O burst of 5,000 deltas measured 1.06 ms without telemetry and 2.09 ms with the adapter: about 1 ms absolute adapter cost, but a large percentage against an unrealistically tiny baseline. No span is created for message deltas. Add subscriber-side event filtering only if measured high-frequency in-memory streams make that ceiling material.

Configured overflow behavior is enforced by `src/__tests__/provider-transport.test.ts` for event, incomplete-buffer, response-body, argument, and abort limits.

### 0.0.4 release audit snapshot (2026-07-14)

Node v24.18.0 on the same Linux x86_64 / Ryzen 9 PRO 7940HS host. Results are medians of 7-9 warm runs unless the row describes file/database appends. Synthetic operations use local memory/files only. These numbers are release ceilings and comparison points, not cross-machine guarantees.

| Surface | Workload | Result | 0.0.4 release threshold |
| --- | --- | --- | --- |
| Run ledger | One mock run, 500 text deltas, 510 total records | 1.19 ms with in-memory ledger vs 0.17 ms without; +1.02 ms absolute; event append max concurrency 1 | < 10 ms with zero-I/O adapter; event appends remain serialized |
| JSONL store | 500 sequential label appends, including fail-closed reread/validation | 141.10 ms; 3,544 appends/s | < 500 ms; development/single-process only |
| JSON Schema compile cache | 5,000 validations through one warm adapter | 4.97 ms; 0.99 µs/validation | < 25 µs/validation |
| JSON Schema cold compile | 100 new adapters + first validation | 249.89 ms; 2.50 ms/compile | Warm cache must remain at least 20x faster than cold compile |
| Parallel tools | Six independent 20 ms calls | concurrency 1: 121.12 ms; concurrency 2: 60.92 ms; 1.99x speedup | concurrency 2 < 75% of sequential; configured worker cap remains enforced |
| SQLite session store | 1,000 sequential transactional label appends | 31.84 ms; 31,405 appends/s | < 250 ms on local SSD/tmp storage |
| Secret redaction | 10,000 shallow objects containing one known secret | 4.79 ms; 2.09 million objects/s | < 25 ms |
| Credential KDF | Default scrypt + AES-256-GCM encryption | 48.09 ms median | 20-250 ms; security floor stays `N >= 16,384` |
| Workflow runner | Existing bounded 1,000-node DAG fixture | 27.68 ms in aggregate release gate | < 1 s; no rescan failure |

Provider SSE remained at the frozen 380 MiB/s / +1.7 MiB heap snapshot. Media and MCP retain 10 MB defaults and finite timeout/total-byte guards; their malicious-input and oversize fixtures pass. PostgreSQL latency remains environment-dependent and is gated by transactional conformance in CI rather than a hardware-specific wall-clock assertion.

The ledger percentage overhead is intentionally not a threshold: its no-ledger baseline is below 1 ms, making the percentage unstable while absolute added latency remains about 1 ms. JSONL's append path is intentionally O(n²) across repeated appends because it rereads for corruption/conflict checks; move production or high-volume workloads to SQLite/PostgreSQL rather than weakening validation.

## Related APIs

- [Agent events](agent-events.md): `SubscribeOptions` and `event_subscriber_overflow` event details.
- [Agent/session runtime](agent-session-runtime.md): `session.subscribe()` and runtime event flow.
- [Session stores](session-stores.md): `SessionStore.readBranchPath` and dev-vs-production branch reads.
- [Database persistence](database-persistence.md): cursor queries, reference schema, indexes, and event sequence guidance.
- [Runs and usage ledger](runs-and-usage.md): durable event, tool-call, and usage persistence.
- [Provider primitives](provider-primitives.md): bounded SSE/error-body limits for first-party providers.
