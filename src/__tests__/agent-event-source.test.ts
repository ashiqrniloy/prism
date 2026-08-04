import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentEventRecord, AgentEventSource } from "../contracts.js";
import { AgentEventSourceError, createMemoryAgentEventSource } from "../index.js";
import { assertAgentEventSourceConforms } from "../testing/agent-event-source-conformance.js";

const ownership = { tenantId: "tenant-a", accountId: "account-a", userId: "user-a" };
const input = { ownership, sessionId: "session-a", runId: "run-a" };

describe("AgentEventSource", () => {
  it("assigns durable sequence, pages exclusively, and drains terminal records", async () => {
    const source = createMemoryAgentEventSource();
    const first = await source.append(record("event-a", "agent_started"));
    const second = await source.append(record("event-b", "agent_finished"));
    assert.equal(first.sequence, 1);
    assert.equal(second.sequence, 2);

    const firstPage = await source.page({ ...input, limit: 1 });
    assert.equal(firstPage.items[0]?.record.id, "event-a");
    assert.ok(firstPage.nextCursor);
    assert.equal(firstPage.terminal, false);

    const secondPage = await source.page({ ...input, after: firstPage.nextCursor, limit: 1 });
    assert.equal(secondPage.items[0]?.record.id, "event-b");
    assert.equal(secondPage.terminal, true);
    assert.equal(secondPage.nextCursor, undefined);
    assert.deepEqual(await source.page({ ...input, after: secondPage.items[0]!.cursor }), { items: [], terminal: true });

    const replay = source.subscribe(input)[Symbol.asyncIterator]();
    assert.equal((await replay.next()).value?.record.id, "event-a");
    assert.equal((await replay.next()).value?.record.id, "event-b");
    assert.equal((await replay.next()).done, true);
  });

  it("hands off from replay to live without a gap or duplicate", async () => {
    const source = createMemoryAgentEventSource();
    await source.append(record("event-a", "agent_started"));
    const cursor = (await source.page(input)).items[0]!.cursor;
    const iterator = source.subscribe({ ...input, after: cursor })[Symbol.asyncIterator]();
    const next = iterator.next();
    await source.append(record("event-b", "turn_started", "2026-01-01T00:00:01.000Z"));
    assert.equal((await next).value?.record.id, "event-b");
    await iterator.return?.();
  });

  it("rejects invalid records and non-enumerating cursor mismatches", async () => {
    const source = createMemoryAgentEventSource({ maxEventBytes: 512 });
    const first = await source.append(record("event-a", "agent_started"));
    assert.equal((await source.append(record("event-a", "agent_started"))).sequence, first.sequence);
    const cursor = (await source.page(input)).items[0]!.cursor;

    await rejects(() => source.append({ ...record("event-a", "agent_started"), timestamp: "2026-01-01T00:00:01.000Z" }), "INPUT");
    await rejects(() => source.append({ ...record("event-unredacted", "turn_started"), redacted: false }), "INPUT");
    await rejects(() => source.append({ ...record("event-sequence", "turn_started"), sequence: 0 }), "INPUT");
    await rejects(() => source.append({ ...record("event-regression", "turn_started"), sequence: 1 }), "INPUT");
    await rejects(() => source.append({ ...record("event-large", "turn_started"), metadata: { body: "x".repeat(1024) } }), "INPUT");
    await rejects(() => source.page({ ...input, limit: 0 }), "INPUT");
    await assert.rejects(source.page({ ...input, signal: AbortSignal.abort(new Error("already stopped")) }), /already stopped/);
    await rejects(() => source.page({ ...input, after: "not-a-cursor" }), "CURSOR");
    await rejects(() => source.page({ ...input, after: "x".repeat(20 * 1024) }), "CURSOR");
    const foreign = await capture(() => source.page({ ...input, ownership: { ...ownership, tenantId: "tenant-b" }, after: cursor }));
    assert.equal((foreign as AgentEventSourceError).code, "ERR_PRISM_AGENT_EVENT_SOURCE_CURSOR");
    assert.equal(String((foreign as Error).message).includes("tenant-b"), false);
    assert.equal(first.sequence, 1);
  });

  it("bounds slow subscribers and releases waiters on abort, return, and close", async () => {
    const source = createMemoryAgentEventSource({ maxQueuedEvents: 1 }) as AgentEventSource & { close(): void };
    await source.append(record("event-a", "agent_started"));
    const iterator = source.subscribe(input)[Symbol.asyncIterator]();
    assert.equal((await iterator.next()).value?.record.id, "event-a");
    await source.append(record("event-b", "turn_started", "2026-01-01T00:00:01.000Z"));
    await source.append(record("event-c", "turn_started", "2026-01-01T00:00:02.000Z"));
    await source.append(record("event-d", "turn_started", "2026-01-01T00:00:03.000Z"));
    await iterator.next();
    await iterator.next();
    await iterator.next();
    await rejects(() => iterator.next(), "OVERFLOW");

    const aborter = new AbortController();
    const waiting = source.subscribe({ ...input, runId: "run-abort", signal: aborter.signal })[Symbol.asyncIterator]();
    const aborted = waiting.next();
    aborter.abort(new Error("stop"));
    await assert.rejects(aborted, /stop/);

    const returned = source.subscribe({ ...input, runId: "run-return" })[Symbol.asyncIterator]();
    const pending = returned.next();
    await returned.return?.();
    assert.equal((await pending).done, true);

    const closing = source.subscribe({ ...input, runId: "run-close" })[Symbol.asyncIterator]();
    const closingPending = closing.next();
    source.close();
    await rejects(() => closingPending, "CLOSED");
  });

  it("caps retained events per run without retaining stale cursors", async () => {
    const source = createMemoryAgentEventSource({ maxRetainedEventsPerRun: 2 });
    await source.append(record("event-a", "agent_started"));
    const cursor = (await source.page(input)).items[0]!.cursor;
    await source.append(record("event-b", "turn_started", "2026-01-01T00:00:01.000Z"));
    await source.append(record("event-c", "turn_started", "2026-01-01T00:00:02.000Z"));
    assert.deepEqual(
      (await source.page(input)).items.map((item) => item.record.id),
      ["event-b", "event-c"],
    );
    await rejects(() => source.page({ ...input, after: cursor }), "RETENTION");
  });

  it("returns retention errors after explicit bounded cleanup", async () => {
    const source = createMemoryAgentEventSource();
    await source.append(record("event-a", "agent_started"));
    await source.append(record("event-b", "turn_started", "2026-01-01T00:00:01.000Z"));
    const cursor = (await source.page({ ...input, limit: 1 })).items[0]!.cursor;
    assert.deepEqual(await source.cleanup({ ownership, before: "2026-01-01T00:00:02.000Z", limit: 1 }), { deleted: 1 });
    await rejects(() => source.page({ ...input, after: cursor }), "RETENTION");
  });

  it("conforms through the dependency-free adapter helper", async () => {
    await assertAgentEventSourceConforms(() => createMemoryAgentEventSource());
  });
});

function record(
  id: string,
  type: "agent_started" | "agent_finished" | "turn_started",
  timestamp = "2026-01-01T00:00:00.000Z",
): AgentEventRecord {
  const event =
    type === "turn_started"
      ? { type, sessionId: input.sessionId, runId: input.runId, turn: 1 }
      : { type, sessionId: input.sessionId, runId: input.runId };
  return { id, ...ownership, sessionId: input.sessionId, runId: input.runId, type, timestamp, event, redacted: true };
}

async function capture(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected rejection");
}

async function rejects(action: () => Promise<unknown>, suffix: string): Promise<void> {
  const error = await capture(action);
  assert.ok(error instanceof AgentEventSourceError);
  assert.equal(error.code.endsWith(suffix), true);
}
