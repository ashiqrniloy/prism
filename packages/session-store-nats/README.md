# @arnilo/prism-session-store-nats

Optional NATS JetStream `AgentEventSource` adapter for Prism (FR-5). Durable consumer, per-subject replay, and at-least-once delivery with stable event IDs over the official [`@nats-io/transport-node`](https://www.npmjs.com/package/@nats-io/transport-node) + [`@nats-io/jetstream`](https://www.npmjs.com/package/@nats-io/jetstream) clients.

## Install

```bash
npm install @arnilo/prism-session-store-nats @arnilo/prism @nats-io/transport-node
```

## Usage

```ts
import { connect } from "@nats-io/transport-node";
import { createNatsAgentEventSource, createNatsJetStream } from "@arnilo/prism-session-store-nats";

const nc = await connect({ servers: process.env.NATS_URL });
const source = createNatsAgentEventSource({
  connection: await createNatsJetStream(nc),
  stream: "prism_agent_events",
  cursorSecret: process.env.EVENT_CURSOR_SECRET, // reuse across replicas for resumable cursors
});

await source.append({ id: "e1", sessionId, runId, type: "message_delta", timestamp, event, redacted: true, tenantId, ... });
const page = await source.page({ ownership, sessionId, runId, limit: 100 });
for await (const envelope of source.subscribe({ ownership, sessionId, runId })) {
  // at-least-once: dedupe by envelope.record.id
}
await source.close();
```

## Stream provisioning

The host creates the JetStream stream before first use. Required shape:

- Subjects: `prism.agent-events.>` (one subject per run: `prism.agent-events.<tenant>.<session>.<run>`)
- Retention: `limits` (e.g. `max_age` for retention, `max_msgs_per_subject` per run) — the adapter never auto-purges beyond `cleanup()`
- Dedupe window: `duplicate_window` (default 2 min) — `append` is idempotent by `record.id` within this window; a same-id different-content append fails closed

## Semantics

- `append` allocates the JetStream per-subject sequence as the per-run event sequence; idempotent by `record.id` within the stream dedupe window.
- `page` replays a run's subject from an HMAC-signed cursor (ephemeral consumer, auto-ack).
- `subscribe` uses a durable pull consumer with explicit acks: replay from the cursor (or the beginning), then live; unacked messages redeliver after 30s (at-least-once); consumers dedupe by `record.id`; the iterator ends after a terminal event.
- `cleanup` enumerates the tenant's subjects and deletes messages older than `before` (ownership-scoped, bounded by `limit`).
- Ownership scoping matches the Postgres source: tenant in the subject, account/user enforced at read time.
- Inert on import: no NATS connection until `createNatsAgentEventSource` is called.

PostgreSQL `LISTEN`/`NOTIFY` remains the reference durable implementation (FR-7); this package is a sibling adapter for JetStream backbones. See [agent events](../../docs/agent-events.md).

## Conformance

Network-free tests use an in-memory fake of the narrow JetStream surface (`NatsJetStream`); `createNatsJetStream` adapts the official client to it. Live integration requires a real NATS server with JetStream enabled.
