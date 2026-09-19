// ponytail: runner-free durable-event contract probe for database adapters.

import type { AgentEventRecord, AgentEventSource } from "../contracts.js";

export type AgentEventSourceConformanceFactory = () => AgentEventSource | Promise<AgentEventSource>;

/** Assert durable append/page/replay ownership and cursor behavior without a database dependency. */
export async function assertAgentEventSourceConforms(factory: AgentEventSourceConformanceFactory): Promise<void> {
  const source = await factory();
  const ownership = { tenantId: "tenant-a", accountId: "account-a", userId: "user-a" };
  const input = { ownership, sessionId: "session-a", runId: "run-a" };
  const first = event("event-a", "agent_started", input);
  const second = event("event-b", "turn_started", input, "2026-01-01T00:00:01.000Z");

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
  const third = await source.append(event("event-c", "turn_started", input, "2026-01-01T00:00:02.000Z"));
  equal((await pending).value?.record.id, third.id, "replay/live handoff dropped an event");
  await iterator.return?.();

  const terminal = await source.append(event("event-d", "agent_finished", input, "2026-01-01T00:00:03.000Z"));
  const final = await source.page({ ...input, after: secondPage.items[0]!.cursor, limit: 10 });
  equal(final.items.at(-1)?.record.id, terminal.id, "terminal page must include its terminal event");
  equal(final.terminal, true, "terminal event must close only after prior events are delivered");

  // A limit death delivers its attribution before the run's outcome: the breach and budget records
  // are not terminal, the `error` that follows them is.
  const breached = { ...input, runId: "run-limit" };
  await source.append(event("event-limit-before", "turn_started", breached, "2026-01-01T00:00:04.000Z"));
  const beforeLimitItem = (await source.page({ ...breached, limit: 1 })).items[0];
  if (!beforeLimitItem) throw new Error("limit-death precondition missing");
  const beforeLimit = beforeLimitItem.cursor;
  await source.append(event("event-limit", "run_limit_exceeded", breached, "2026-01-01T00:00:05.000Z"));
  await source.append(event("event-attr", "budget_exhausted", breached, "2026-01-01T00:00:06.000Z"));
  const breachPage = await source.page({ ...breached, after: beforeLimit, limit: 10 });
  equal(breachPage.items.length, 2, "the breach and its attribution must page together");
  equal(breachPage.terminal, false, "a limit breach must not close the stream; the run's error follows");
  await source.append(event("event-limit-error", "error", breached, "2026-01-01T00:00:07.000Z"));
  const deadPage = await source.page({ ...breached, after: beforeLimit, limit: 10 });
  equal(deadPage.terminal, true, "the error after a limit breach closes the stream");
  const death = source.subscribe(breached)[Symbol.asyncIterator]();
  const delivered: string[] = [];
  for (;;) {
    const next = await death.next();
    if (next.done) break;
    delivered.push(next.value.record.type);
  }
  equal(
    delivered.join(","),
    "turn_started,run_limit_exceeded,budget_exhausted,error",
    "a subscriber must read the breach and its attribution before the stream ends",
  );

  await rejects(
    () => source.page({ ...input, ownership: { ...ownership, tenantId: "tenant-b" }, after: page.nextCursor }),
    "foreign cursor must fail closed",
  );
  await rejects(
    () => source.append({ ...event("event-unredacted", "turn_started", input), redacted: false }),
    "unredacted append must fail",
  );
  await rejects(() => source.page({ ...input, limit: 0 }), "invalid page limit must fail");
}

function event(
  id: string,
  type: "agent_started" | "agent_finished" | "turn_started" | "run_limit_exceeded" | "budget_exhausted" | "error",
  input: {
    readonly ownership: { readonly tenantId: string; readonly accountId: string; readonly userId: string };
    readonly sessionId: string;
    readonly runId: string;
  },
  timestamp = "2026-01-01T00:00:00.000Z",
): AgentEventRecord {
  const scoped = { sessionId: input.sessionId, runId: input.runId };
  const event =
    type === "turn_started"
      ? { type, ...scoped, turn: 1 }
      : type === "run_limit_exceeded"
        ? { type, ...scoped, breach: { limit: "maxTurns" as const, maximum: 1, observed: 2 } }
        : type === "budget_exhausted"
          ? {
              type,
              ...scoped,
              limit: "maxTurns" as const,
              consumed: { turns: 2, inputTokens: 0, providerAttempts: 1, requestBytes: 0 },
              closestOtherAxes: [],
              recentToolCalls: [],
            }
          : type === "error"
            ? { type, ...scoped, error: { message: "run limit exceeded" } }
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
