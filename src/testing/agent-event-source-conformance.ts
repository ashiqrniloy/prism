// ponytail: runner-free durable-event contract probe for database adapters.

import type { AgentEventRecord, AgentEventSource } from "../contracts.js";

export type AgentEventSourceConformanceFactory = () => AgentEventSource | Promise<AgentEventSource>;

/** Assert durable append/page/replay ownership and cursor behavior without a database dependency. */
export async function assertAgentEventSourceConforms(factory: AgentEventSourceConformanceFactory): Promise<void> {
  const source = await factory();
  const ownership = { tenantId: "tenant-a", accountId: "account-a", userId: "user-a" };
  const input = { ownership, sessionId: "session-a", runId: "run-a" };
  const first = event("event-a", "run.started", input);
  const second = event("event-b", "turn.started", input, "2026-01-01T00:00:01.000Z");

  const storedFirst = await source.append(first);
  const storedSecond = await source.append(second);
  equal(storedFirst.sequence, 1, "first durable event must receive sequence 1");
  equal(storedSecond.sequence, 2, "durable sequence must increase per run");
  equal((await source.append(first)).sequence, 1, "identical duplicate append must be idempotent");
  await rejects(() => source.append({ ...first, timestamp: "2026-01-01T00:00:02.000Z" }), "changed duplicate append must fail");

  const page = await source.page({ ...input, limit: 1 });
  equal(page.items.length, 1, "page limit must be honored");
  equal(page.items[0]!.record.id, first.id, "page order must follow sequence");
  if (!page.nextCursor) throw new Error("truncated page must include a cursor");
  const secondPage = await source.page({ ...input, after: page.nextCursor, limit: 1 });
  equal(secondPage.items[0]?.record.id, second.id, "cursor must be exclusive");

  const iterator = source.subscribe({ ...input, after: secondPage.items[0]!.cursor })[Symbol.asyncIterator]();
  const pending = iterator.next();
  const third = await source.append(event("event-c", "turn.started", input, "2026-01-01T00:00:02.000Z"));
  equal((await pending).value?.record.id, third.id, "replay/live handoff dropped an event");
  await iterator.return?.();

  const terminal = await source.append(event("event-d", "run.completed", input, "2026-01-01T00:00:03.000Z"));
  // Page the tail one record at a time: a source may cap `limit` below any number this probe could
  // name (the option is per-source), and walking the tail is the stronger cursor check anyway.
  let tail = await source.page({ ...input, after: secondPage.items[0]!.cursor, limit: 1 });
  const tailItems = [...tail.items];
  while (tail.nextCursor) {
    tail = await source.page({ ...input, after: tail.nextCursor, limit: 1 });
    tailItems.push(...tail.items);
  }
  equal(tailItems.at(-1)?.record.id, terminal.id, "terminal page must include its terminal event");
  equal(tail.terminal, true, "terminal event must close only after prior events are delivered");

  // A limit death is one terminal `run.failed` that already carries the breach and its attribution
  // (the former `run_limit_exceeded` + `budget_exhausted` + `error` triple).
  const breached = { ...input, runId: "run-limit" };
  await source.append(event("event-limit-before", "turn.started", breached, "2026-01-01T00:00:04.000Z"));
  const beforeLimitItem = (await source.page({ ...breached, limit: 1 })).items[0];
  if (!beforeLimitItem) throw new Error("limit-death precondition missing");
  const beforeLimit = beforeLimitItem.cursor;
  await source.append(event("event-limit", "run.failed", breached, "2026-01-01T00:00:05.000Z"));
  const deadPage = await source.page({ ...breached, after: beforeLimit, limit: 1 });
  equal(deadPage.items.length, 1, "a limit death must page as one record");
  equal(deadPage.terminal, true, "a limit death is the run's terminal record");
  const death = source.subscribe(breached)[Symbol.asyncIterator]();
  const delivered: string[] = [];
  for (;;) {
    const next = await death.next();
    if (next.done) break;
    delivered.push(next.value.record.type);
  }
  equal(delivered.join(","), "turn.started,run.failed", "a subscriber must read the limit death as one terminal record");

  await rejects(
    () => source.page({ ...input, ownership: { ...ownership, tenantId: "tenant-b" }, after: page.nextCursor }),
    "foreign cursor must fail closed",
  );
  await rejects(
    () => source.append({ ...event("event-unredacted", "turn.started", input), redacted: false }),
    "unredacted append must fail",
  );
  await rejects(() => source.page({ ...input, limit: 0 }), "invalid page limit must fail");
}

function event(
  id: string,
  type: "run.started" | "run.completed" | "turn.started" | "run.failed",
  input: {
    readonly ownership: { readonly tenantId: string; readonly accountId: string; readonly userId: string };
    readonly sessionId: string;
    readonly runId: string;
  },
  timestamp = "2026-01-01T00:00:00.000Z",
): AgentEventRecord {
  const scoped = { sessionId: input.sessionId, runId: input.runId };
  const event =
    type === "turn.started"
      ? { type, ...scoped, turn: 1, metadata: { providerId: "mock", model: { provider: "mock", model: "demo" } } }
      : type === "run.failed"
        ? {
            type,
            ...scoped,
            error: { message: "run limit exceeded" },
            limit: { limit: "maxTurns" as const, maximum: 1, observed: 2 },
            attribution: {
              consumed: { turns: 2, inputTokens: 0, providerAttempts: 1, requestBytes: 0 },
              closestOtherAxes: [],
              recentToolCalls: [],
            },
          }
        : type === "run.completed"
          ? { type, ...scoped, status: "completed" as const }
          : { type, ...scoped };
  return { id, ...input.ownership, sessionId: input.sessionId, runId: input.runId, type, timestamp, event, redacted: true };
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message}; expected ${String(expected)}, received ${String(actual)}`);
}

async function rejects(action: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error(message);
}
