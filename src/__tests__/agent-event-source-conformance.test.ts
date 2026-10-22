// Root-level proof for the durable-event contract probe (`src/testing/agent-event-source-conformance.ts`)
// and the in-process reference implementation it exists for (`src/testing/memory-event-source.ts`).
// Both ship from `@arnilo/prism/testing`, and until now only package suites (the Postgres integration
// leg, which is env-gated) drove them, so the core suite could not fail if a kernel probe or the
// reference source drifted. Each case asserts an observable outcome: a contract violation the probe
// catches, an error code on the boundary it guards, a page/subscribe result, or a cleanup count.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { AgentEvent, AgentEventRecord, AgentEventSource, AgentEventSourceError, DurableAgentEventRecord } from "../contracts.js";
import { isTerminalAgentEventType } from "../contracts-protocol.js";
import { assertAgentEventSourceConforms, createMemoryAgentEventSource } from "../testing/index.js";

type ClosableSource = AgentEventSource & { close(): void };

const ownership = { tenantId: "tenant-a", accountId: "account-a", userId: "user-a" };
const input = { ownership, sessionId: "session-a", runId: "run-a" };

function record(
  id: string,
  type: ConformanceEventType = "turn.started",
  timestamp = "2026-01-01T00:00:00.000Z",
  runId = "run-a",
): AgentEventRecord {
  const event = eventOf(type, runId);
  return { id, ...ownership, sessionId: "session-a", runId, type, timestamp, event, redacted: true };
}

/** The three stream shapes this test needs; every other event type is irrelevant here. */
type ConformanceEventType = "run.started" | "turn.started" | "run.completed";

function eventOf(type: ConformanceEventType, runId = "run-a"): AgentEvent {
  const scoped = { sessionId: "session-a", runId };
  if (type === "turn.started") {
    return { type, ...scoped, turn: 1, metadata: { providerId: "mock", model: { provider: "mock", model: "demo" } } };
  }
  if (type === "run.completed") return { type, ...scoped, status: "completed" };
  return { type: "run.started", ...scoped };
}

async function durable(source: AgentEventSource, records: readonly AgentEventRecord[]): Promise<DurableAgentEventRecord[]> {
  const stored: DurableAgentEventRecord[] = [];
  for (const item of records) stored.push(await source.append(item));
  return stored;
}

function code(error: unknown): string | undefined {
  return (error as AgentEventSourceError | undefined)?.code;
}

describe("durable agent event source conformance", () => {
  it("the in-process reference source passes the probe", async () => {
    await assertAgentEventSourceConforms(() => createMemoryAgentEventSource());
    // An async factory and a non-default option set must conform too, so the probe covers the
    // configured paths (cursor size, page size, retention) and not only the defaults.
    await assertAgentEventSourceConforms(async () => createMemoryAgentEventSource({ maxPageSize: 2, maxQueuedEvents: 4 }));
  });

  it("the probe fails closed on a source that breaks the contract", async () => {
    const source = createMemoryAgentEventSource();
    const withoutCursors: AgentEventSource = {
      ...source,
      page: async (read) => {
        const page = await source.page(read);
        return { items: page.items, terminal: page.terminal };
      },
    };
    await assert.rejects(() => assertAgentEventSourceConforms(() => withoutCursors), /truncated page must include a cursor/);

    const ignoringCursors: AgentEventSource = {
      ...source,
      page: (read) => source.page({ ...read, after: undefined }),
    };
    await assert.rejects(() => assertAgentEventSourceConforms(() => ignoringCursors), /cursor must be exclusive/);
  });
});

describe("in-process reference event source", () => {
  it("resolves every option bound and rejects a value outside its range by name", async () => {
    for (const [name, hard] of [
      ["maxEventBytes", 1024 * 1024],
      ["maxPageSize", 500],
      ["maxCursorBytes", 16 * 1024],
      ["maxQueuedEvents", 4096],
      ["maxSubscribers", 4096],
      ["pollIntervalMs", 30_000],
      ["reconnectInitialMs", 5000],
      ["reconnectMaxMs", 30_000],
      ["maxRetainedEventsPerRun", 100_000],
      ["maxRetentionAgeMs", 365 * 24 * 60 * 60 * 1000],
    ] as const) {
      assert.equal(typeof hard, "number");
      for (const bad of [0, -1, 1.5, hard + 1, Number.NaN]) {
        assert.throws(
          () => createMemoryAgentEventSource({ [name]: bad }),
          (error: unknown) =>
            code(error) === "ERR_PRISM_AGENT_EVENT_SOURCE_INPUT" && String(error).includes(`${name} is outside its allowed range`),
          `${name}=${String(bad)} must fail closed`,
        );
      }
      assert.doesNotThrow(() =>
        createMemoryAgentEventSource({ [name]: 1, ...(name === "reconnectMaxMs" ? { reconnectInitialMs: 1 } : {}) }),
      );
    }
    assert.throws(() => createMemoryAgentEventSource({ reconnectInitialMs: 5000, reconnectMaxMs: 100 }), RangeError);
    const source = createMemoryAgentEventSource();
    const stored = await durable(source, [record("e1")]);
    assert.equal(stored[0]?.sequence, 1);
  });

  it("bounds the cursor it can issue", async () => {
    const source = createMemoryAgentEventSource({ maxCursorBytes: 1 });
    await assert.rejects(
      () => source.append(record("e1")),
      (error: unknown) => code(error) === "ERR_PRISM_AGENT_EVENT_SOURCE_INPUT",
    );
  });

  it("validates the record identity, shape, and sequence on append", async () => {
    const source = createMemoryAgentEventSource();
    await durable(source, [record("e1")]);

    for (const [label, candidate] of [
      ["unredacted", { ...record("e2"), redacted: false }],
      ["type mismatch", { ...record("e2"), event: eventOf("run.completed") }],
      ["event scope mismatch", { ...record("e2"), event: { type: "turn.started", sessionId: "other", runId: "run-a" } }],
      ["bad timestamp", { ...record("e2"), timestamp: "yesterday" }],
      ["missing tenant", { ...record("e2"), tenantId: "" }],
      ["explicit wrong sequence", { ...record("e2"), sequence: 7 }],
      ["zero sequence", { ...record("e2"), sequence: 0 }],
    ] as const) {
      await assert.rejects(
        () => source.append(candidate as AgentEventRecord),
        (error: unknown) => code(error) === "ERR_PRISM_AGENT_EVENT_SOURCE_INPUT",
        label,
      );
    }

    const notSerializable: Record<string, unknown> = { id: "e3" };
    notSerializable.self = notSerializable;
    await assert.rejects(
      () => source.append(notSerializable as unknown as AgentEventRecord),
      (error: unknown) => code(error) === "ERR_PRISM_AGENT_EVENT_SOURCE_INPUT",
    );
  });

  it("treats an identical replay as idempotent and a changed one as a hard failure", async () => {
    const source = createMemoryAgentEventSource();
    const first = record("e1");
    const stored = await source.append(first);
    const again = await source.append(first);
    assert.equal(again.sequence, stored.sequence);
    assert.deepEqual(again, stored);
    await assert.rejects(
      () => source.append({ ...first, timestamp: "2026-01-01T00:00:02.000Z" }),
      (error: unknown) => code(error) === "ERR_PRISM_AGENT_EVENT_SOURCE_INPUT",
    );
  });

  it("fails closed on a bad page read and on a bad page limit", async () => {
    const source = createMemoryAgentEventSource({ maxPageSize: 2 });
    await assert.rejects(
      () => source.page({ ...input, limit: 0 }),
      (error: unknown) => code(error) === "ERR_PRISM_AGENT_EVENT_SOURCE_INPUT",
    );
    await assert.rejects(
      () => source.page({ ...input, limit: 3 }),
      (error: unknown) => code(error) === "ERR_PRISM_AGENT_EVENT_SOURCE_INPUT",
    );
    await assert.rejects(
      () => source.page({ ...input, limit: 1.5 }),
      (error: unknown) => code(error) === "ERR_PRISM_AGENT_EVENT_SOURCE_INPUT",
    );
    await assert.rejects(
      () => source.page({ ...input, ownership: { tenantId: "" } }),
      (error: unknown) => code(error) === "ERR_PRISM_AGENT_EVENT_SOURCE_INPUT",
    );
    await durable(source, [record("e1", "turn.started")]);
    const page = await source.page({ ...input, limit: 2 });
    assert.equal(page.items.length, 1);
    assert.equal(page.terminal, false);
  });

  it("rejects a cursor that was tampered with, reassembled, or belongs to another scope", async () => {
    const source = createMemoryAgentEventSource();
    await durable(source, [record("e1"), record("e2")]);
    const page = await source.page({ ...input, limit: 1 });
    const cursor = page.nextCursor;
    assert.ok(cursor);

    // Tampering must change the *decoded* signature: base64url's last character can carry no
    // significant bits, so flipping it can decode to the same bytes. The first character always can.
    const [cursorBody, cursorSignature] = cursor.split(".");
    const flipped = `${cursorBody}.${cursorSignature?.startsWith("A") ? "B" : "A"}${cursorSignature?.slice(1) ?? ""}`;
    for (const [label, bad] of [
      ["tampered signature", flipped],
      ["empty", ""],
      ["extra segment", `${cursor}.x`],
      ["not base64", "!!!!"],
      ["bad body", `nonsense.${cursor.split(".")[1] ?? ""}`],
    ] as const) {
      await assert.rejects(
        () => source.page({ ...input, after: bad }),
        (error: unknown) => code(error) === "ERR_PRISM_AGENT_EVENT_SOURCE_CURSOR",
        label,
      );
    }
    await assert.rejects(
      () => source.page({ ...input, ownership: { ...ownership, tenantId: "tenant-b" }, after: cursor }),
      (error: unknown) => code(error) === "ERR_PRISM_AGENT_EVENT_SOURCE_CURSOR",
    );
    await assert.rejects(
      () => source.page({ ...input, runId: "run-b", after: cursor }),
      (error: unknown) => code(error) === "ERR_PRISM_AGENT_EVENT_SOURCE_CURSOR",
    );
  });

  it("retains only the configured window and reports a dropped cursor as a retention failure", async () => {
    const source = createMemoryAgentEventSource({ maxRetainedEventsPerRun: 2 });
    await durable(source, [
      record("e1", "turn.started", "2026-01-01T00:00:00.000Z"),
      record("e2", "turn.started", "2026-01-01T00:00:01.000Z"),
    ]);
    const early = (await source.page({ ...input, limit: 1 })).nextCursor;
    assert.ok(early);
    await source.append(record("e3", "turn.started", "2026-01-01T00:00:02.000Z"));

    const page = await source.page({ ...input, limit: 10 });
    assert.deepEqual(
      page.items.map((item) => item.record.id),
      ["e2", "e3"],
      "the oldest record beyond the retention window must be dropped",
    );
    await assert.rejects(
      () => source.page({ ...input, after: early }),
      (error: unknown) => code(error) === "ERR_PRISM_AGENT_EVENT_SOURCE_RETENTION",
    );
    // A dropped id is free again: a late replay of the same event re-appends instead of conflicting.
    const replayed = await source.append(record("e1", "turn.started"));
    assert.equal(replayed.id, "e1");
  });

  it("pages a run whose terminal record arrives later, and reports terminal only at the end", async () => {
    const source = createMemoryAgentEventSource();
    await durable(source, [record("e1", "run.started"), record("e2", "turn.started")]);
    const open = await source.page(input);
    assert.equal(open.terminal, false);
    assert.equal(open.nextCursor, undefined, "a complete non-terminal page has nothing after it");

    await source.append(record("e3", "run.completed"));
    const closed = await source.page(input);
    assert.equal(closed.terminal, true);
    assert.equal(closed.items.at(-1)?.record.type, "run.completed");
    assert.equal(isTerminalAgentEventType("run.completed"), true);
  });

  it("cleans up by ownership and timestamp, honoring the limit", async () => {
    const source = createMemoryAgentEventSource();
    await durable(source, [
      record("e1", "turn.started", "2026-01-01T00:00:00.000Z"),
      record("e2", "turn.started", "2026-01-01T00:00:01.000Z"),
      record("e3", "turn.started", "2026-01-01T00:00:02.000Z"),
    ]);

    assert.equal(
      (await source.cleanup({ ownership: { ...ownership, tenantId: "tenant-b" }, before: "2026-01-01T00:00:09.000Z" })).deleted,
      0,
    );
    assert.equal((await source.cleanup({ ownership, before: "2026-01-01T00:00:01.500Z", limit: 1 })).deleted, 1);
    assert.deepEqual(
      (await source.page(input)).items.map((item) => item.record.id),
      ["e2", "e3"],
    );
    assert.equal((await source.cleanup({ ownership, before: "2026-01-01T00:00:09.000Z" })).deleted, 2);
    assert.deepEqual((await source.page(input)).items, []);

    await assert.rejects(
      () => source.cleanup({ ownership, before: "not-a-timestamp" }),
      (error: unknown) => code(error) === "ERR_PRISM_AGENT_EVENT_SOURCE_INPUT",
    );
    await assert.rejects(
      () => source.cleanup({ ownership, before: "2026-01-01T00:00:00.000Z", limit: 501 }),
      (error: unknown) => code(error) === "ERR_PRISM_AGENT_EVENT_SOURCE_INPUT",
    );

    const controller = new AbortController();
    controller.abort(new Error("caller went away"));
    await assert.rejects(
      () => source.cleanup({ ownership, before: "2026-01-01T00:00:00.000Z", signal: controller.signal }),
      /caller went away/,
    );
    await assert.rejects(() => source.page({ ...input, signal: controller.signal }), /caller went away/);
  });

  it("hands replay to live delivery without dropping or duplicating an event", async () => {
    const source = createMemoryAgentEventSource();
    await durable(source, [record("e1", "turn.started", "2026-01-01T00:00:00.000Z")]);
    const iterator = source.subscribe(input)[Symbol.asyncIterator]();

    const first = await iterator.next();
    assert.equal(first.value?.record.id, "e1");
    const pending = iterator.next();
    await source.append(record("e2", "turn.started", "2026-01-01T00:00:01.000Z"));
    assert.equal((await pending).value?.record.id, "e2");

    // A consumer that stops early closes the live wake instead of leaking it.
    const returned = await iterator.return?.(undefined);
    assert.deepEqual(returned, { value: undefined, done: true });

    const throwing = source.subscribe(input)[Symbol.asyncIterator]();
    assert.equal((await throwing.next()).value?.record.id, "e1");
    await assert.rejects(throwing.throw?.(new Error("consumer gone")) ?? Promise.resolve(), /consumer gone/);
  });

  it("refuses to subscribe past the subscriber cap and honors an aborted subscribe signal", async () => {
    const source = createMemoryAgentEventSource({ maxSubscribers: 1 });
    const first = source.subscribe(input)[Symbol.asyncIterator]();
    assert.throws(
      () => source.subscribe(input)[Symbol.asyncIterator](),
      (error: unknown) => code(error) === "ERR_PRISM_AGENT_EVENT_SOURCE_OVERFLOW",
    );
    await first.return?.(undefined);

    const controller = new AbortController();
    controller.abort(new Error("no subscribers"));
    assert.throws(() => source.subscribe({ ...input, signal: controller.signal })[Symbol.asyncIterator](), /no subscribers/);
  });

  it("fails a subscriber whose queue overflows while it is not reading", async () => {
    const source = createMemoryAgentEventSource({ maxQueuedEvents: 1, maxSubscribers: 4 });
    const iterator = source.subscribe(input)[Symbol.asyncIterator]();
    const parked = iterator.next();
    await Promise.resolve(); // Let the generator finish its empty page and register as a waiter.

    for (const [id, timestamp] of [
      ["e1", "2026-01-01T00:00:01.000Z"],
      ["e2", "2026-01-01T00:00:02.000Z"],
      ["e3", "2026-01-01T00:00:03.000Z"],
      ["e4", "2026-01-01T00:00:04.000Z"],
    ] as const) {
      await source.append(record(id, "turn.started", timestamp));
    }
    const first = await parked;
    assert.equal(first.value?.record.id, "e1");

    let failure: unknown;
    for (let attempt = 0; attempt < 10 && failure === undefined; attempt += 1) {
      const result = await iterator.next().catch((error: unknown) => {
        failure = error;
        return { value: undefined, done: true };
      });
      if (result.done) break;
    }
    assert.equal(code(failure), "ERR_PRISM_AGENT_EVENT_SOURCE_OVERFLOW");
  });

  it("closes the source for every entry point, ends parked subscribers, and stays idempotent", async () => {
    const source = createMemoryAgentEventSource() as ClosableSource;
    await durable(source, [record("e1", "turn.started")]);
    await source.cleanup({ ownership, before: "2026-01-01T00:00:00.000Z" });

    const parked = source.subscribe({ ...input, runId: "run-b" })[Symbol.asyncIterator]();
    const waiting = parked.next();
    source.close();
    source.close();
    await assert.rejects(waiting, (error: unknown) => code(error) === "ERR_PRISM_AGENT_EVENT_SOURCE_CLOSED");

    for (const [label, action] of [
      ["append", () => source.append(record("e2", "turn.started"))],
      ["page", () => source.page(input)],
      ["cleanup", () => source.cleanup({ ownership, before: "2026-01-01T00:00:00.000Z" })],
    ] as const) {
      await assert.rejects(action, (error: unknown) => code(error) === "ERR_PRISM_AGENT_EVENT_SOURCE_CLOSED", label);
    }
  });
});
