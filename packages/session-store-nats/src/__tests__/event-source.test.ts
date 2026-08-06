import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentEventRecord, AgentEventSourceError, OwnershipScope } from "@arnilo/prism";
import { createNatsAgentEventSource } from "../event-source.js";
import { FakeJetStream } from "./fake-jetstream.js";

const ownership: OwnershipScope = { tenantId: "tenant", accountId: "account", userId: "user" };
const otherOwnership: OwnershipScope = { tenantId: "other", accountId: "account", userId: "user" };

function record(overrides: Partial<AgentEventRecord> = {}): AgentEventRecord {
  return {
    id: `event-${Math.random().toString(36).slice(2)}`,
    sessionId: "session-1",
    runId: "run-1",
    type: "message_delta",
    timestamp: "2026-08-06T00:00:00.000Z",
    event: { type: "message_delta", sessionId: "session-1", runId: "run-1", content: { type: "text", text: "hello" } },
    redacted: true,
    ...ownership,
    ...overrides,
  };
}

function terminal(overrides: Partial<AgentEventRecord> = {}): AgentEventRecord {
  return record({ type: "agent_finished", event: { type: "agent_finished", sessionId: "session-1", runId: "run-1" }, ...overrides });
}

function makeSource(jetstream = new FakeJetStream(), options: Record<string, unknown> = {}) {
  return createNatsAgentEventSource({ connection: jetstream, stream: "prism_agent_events", ...options });
}

const read = { ownership, sessionId: "session-1", runId: "run-1" };

describe("NATS JetStream AgentEventSource (FR-5)", () => {
  it("appends with per-run sequences and pages in order with cursors", async () => {
    const jetstream = new FakeJetStream();
    const source = makeSource(jetstream);
    const first = await source.append(record());
    const second = await source.append(record());
    assert.equal(first.sequence, 1);
    assert.equal(second.sequence, 2);
    const page = await source.page({ ...read, limit: 1 });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].record.sequence, 1);
    assert.ok(page.nextCursor);
    const next = await source.page({ ...read, after: page.nextCursor, limit: 1 });
    assert.equal(next.items.length, 1);
    assert.equal(next.items[0].record.sequence, 2);
    assert.equal(next.terminal, false);
    await source.close();
  });

  it("append is idempotent by record id (dedupe window) and fails closed on id collision", async () => {
    const jetstream = new FakeJetStream();
    const source = makeSource(jetstream);
    const original = record();
    const appended = await source.append(original);
    const duplicate = await source.append({ ...original });
    assert.equal(duplicate.sequence, appended.sequence);
    assert.equal(jetstream.messages.size, 1);
    // Same id, different content → input error.
    await assert.rejects(
      source.append({
        ...original,
        event: { type: "message_delta", sessionId: "session-1", runId: "run-1", content: { type: "text", text: "different" } },
      }),
      (error: AgentEventSourceError) => error.code === "ERR_PRISM_AGENT_EVENT_SOURCE_INPUT",
    );
    await source.close();
  });

  it("pages per subject (per-run replay) and never leaks other runs", async () => {
    const jetstream = new FakeJetStream();
    const source = makeSource(jetstream);
    await source.append(record());
    await source.append(
      record({
        runId: "run-2",
        event: { type: "message_delta", sessionId: "session-1", runId: "run-2", content: { type: "text", text: "other" } },
      }),
    );
    const page = await source.page({ ...read, limit: 10 });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].record.runId, "run-1");
    await source.close();
  });

  it("enforces ownership scoping at read time (account/user)", async () => {
    const jetstream = new FakeJetStream();
    const source = makeSource(jetstream);
    await source.append(record());
    const page = await source.page({ ...read, limit: 10 });
    assert.equal(page.items.length, 1);
    const otherAccount = await source.page({
      ownership: { tenantId: "tenant", accountId: "other", userId: "user" },
      sessionId: "session-1",
      runId: "run-1",
      limit: 10,
    });
    assert.equal(otherAccount.items.length, 0);
    const otherTenant = await source.page({ ownership: otherOwnership, sessionId: "session-1", runId: "run-1", limit: 10 });
    assert.equal(otherTenant.items.length, 0);
    await source.close();
  });

  it("subscribes with replay-to-live handoff, dedupes redeliveries, and stops at terminal", async () => {
    const jetstream = new FakeJetStream();
    const source = makeSource(jetstream);
    await source.append(record());
    await source.append(record());
    await source.append(terminal());
    const seen: string[] = [];
    for await (const envelope of source.subscribe(read)) {
      seen.push(envelope.record.id);
    }
    assert.equal(seen.length, 3);
    // The durable consumer was cleaned up after terminal.
    assert.equal(jetstream.consumers.size, 0);
    await source.close();
  });

  it("resumes from a cursor (no gap)", async () => {
    const jetstream = new FakeJetStream();
    const source = makeSource(jetstream);
    await source.append(record());
    await source.append(record());
    await source.append(terminal());
    // Subscribe from the cursor after the first event: only events 2 and 3 arrive.
    const seen: string[] = [];
    for await (const envelope of source.subscribe({ ...read, after: (await source.page({ ...read, limit: 1 })).items[0].cursor })) {
      seen.push(envelope.record.id);
    }
    assert.equal(seen.length, 2);
    assert.equal(seen[0], (await source.page({ ...read, limit: 10 })).items[1].record.id);
    await source.close();
  });

  it("redelivers unacked messages at-least-once with stable ids (seam semantics)", async () => {
    const jetstream = new FakeJetStream();
    const source = makeSource(jetstream);
    const appended = await source.append(record());
    await jetstream.addConsumer("prism_agent_events", {
      name: "probe",
      filter_subject: "prism.agent-events.tenant.session-1.run-1",
      ack_policy: "explicit",
      deliver_policy: "all",
    });
    const probe = await jetstream.getConsumer("prism_agent_events", "probe");
    const first = await probe.fetch({ max_messages: 1, expires: 100 });
    const firstBatch: Array<{ seq: number; deliveryCount: number }> = [];
    for await (const message of first) firstBatch.push({ seq: message.seq, deliveryCount: message.deliveryCount });
    assert.equal(firstBatch.length, 1);
    assert.equal(firstBatch[0].seq, appended.sequence);
    assert.equal(firstBatch[0].deliveryCount, 1);
    // Not acked → redelivered with the same stable seq and a higher delivery count.
    const second = await probe.fetch({ max_messages: 1, expires: 100 });
    const secondBatch: Array<{ seq: number; deliveryCount: number }> = [];
    for await (const message of second) secondBatch.push({ seq: message.seq, deliveryCount: message.deliveryCount });
    assert.equal(secondBatch.length, 1);
    assert.equal(secondBatch[0].seq, appended.sequence);
    assert.equal(secondBatch[0].deliveryCount, 2);
    await source.close();
  });

  it("cleanup deletes only events older than `before` within the ownership scope", async () => {
    const jetstream = new FakeJetStream();
    const source = makeSource(jetstream);
    const old = await source.append(record({ timestamp: "2026-01-01T00:00:00.000Z" }));
    await source.append(record({ timestamp: "2026-08-01T00:00:00.000Z" }));
    await source.append(
      record({
        timestamp: "2026-01-01T00:00:00.000Z",
        runId: "run-2",
        event: { type: "message_delta", sessionId: "session-1", runId: "run-2", content: { type: "text", text: "x" } },
      }),
    );
    const result = await source.cleanup({ ownership, before: "2026-06-01T00:00:00.000Z", limit: 10 });
    // Ownership-scoped (not session-scoped): both January events are deleted.
    assert.equal(result.deleted, 2);
    assert.equal(jetstream.messages.has(old.sequence), false);
    const page = await source.page({ ...read, limit: 10 });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].record.timestamp, "2026-08-01T00:00:00.000Z");
    await source.close();
  });

  it("caps subscribers and rejects invalid limits", async () => {
    const jetstream = new FakeJetStream();
    const source = makeSource(jetstream, { limits: { maxSubscribers: 1 } });
    const first = source.subscribe(read);
    assert.throws(
      () => source.subscribe(read),
      (error: AgentEventSourceError) => error.code === "ERR_PRISM_AGENT_EVENT_SOURCE_OVERFLOW",
    );
    await first[Symbol.asyncIterator]().return?.(undefined);
    await source.close();
    assert.throws(
      () => createNatsAgentEventSource({ connection: jetstream, stream: "prism_agent_events", limits: { maxPageSize: 10_000 } }),
      (error: AgentEventSourceError) => error.code === "ERR_PRISM_AGENT_EVENT_SOURCE_INPUT",
    );
  });

  it("rejects non-redacted records and NATS-unsafe identifiers", async () => {
    const jetstream = new FakeJetStream();
    const source = makeSource(jetstream);
    await assert.rejects(
      source.append(record({ redacted: false })),
      (error: AgentEventSourceError) => error.code === "ERR_PRISM_AGENT_EVENT_SOURCE_INPUT",
    );
    await assert.rejects(
      source.append(record({ sessionId: "bad session" })),
      (error: AgentEventSourceError) => error.code === "ERR_PRISM_AGENT_EVENT_SOURCE_INPUT",
    );
    await source.close();
  });

  it("is inert on import and fails closed after close", async () => {
    const jetstream = new FakeJetStream();
    const source = makeSource(jetstream);
    await source.close();
    await assert.rejects(source.append(record()), (error: AgentEventSourceError) => error.code === "ERR_PRISM_AGENT_EVENT_SOURCE_CLOSED");
  });
});
