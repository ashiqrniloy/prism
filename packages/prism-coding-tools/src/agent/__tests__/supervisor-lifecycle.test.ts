import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupervisorEvent } from "@arnilo/prism-core/runtime/supervisor";
import { type CodingLifecycleEvent, createCodingLifecycleEmitter } from "../lifecycle.js";
import { observeSupervisorLifecycle } from "../supervisor-lifecycle.js";

async function settles(ready: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (ready()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail("supervisor lifecycle observer did not settle");
}

function source(events: readonly SupervisorEvent[]) {
  return {
    redact: (value: string) => value,
    subscribe: () => ({
      async *[Symbol.asyncIterator]() {
        yield* events;
      },
    }),
  };
}

describe("observeSupervisorLifecycle", () => {
  it("bridges delegate and spawn's shared supervisor milestones without child bodies", async () => {
    const events: CodingLifecycleEvent[] = [];
    const supervisorEvents: readonly SupervisorEvent[] = [
      {
        type: "delegation_started",
        childId: "secret-child",
        delegationId: "supervisor-secret-1",
        depth: 1,
        resourceId: "r1",
        threadId: "t1",
      },
      {
        type: "delegation_finished",
        childId: "secret-child",
        delegationId: "supervisor-secret-1",
        depth: 1,
        status: "succeeded",
        totalTokens: 2,
      },
      {
        type: "delegation_started",
        childId: "secret-child",
        delegationId: "supervisor-secret-2",
        depth: 1,
        resourceId: "r2",
        threadId: "t2",
      },
      {
        type: "delegation_finished",
        childId: "secret-child",
        delegationId: "supervisor-secret-2",
        depth: 1,
        status: "succeeded",
        totalTokens: 2,
      },
    ];
    const stop = observeSupervisorLifecycle(
      {
        redact: (value) => value.replaceAll("secret", "[REDACTED]"),
        subscribe: () => ({
          async *[Symbol.asyncIterator]() {
            yield* supervisorEvents;
          },
        }),
      },
      { onEvent: (event) => events.push(event) },
    );
    await settles(() => events.length === 4);
    stop();

    assert.deepEqual(
      events.map((event) => [event.type, "status" in event ? event.status : undefined]),
      [
        ["subagent_started", undefined],
        ["subagent_stopped", "succeeded"],
        ["subagent_started", undefined],
        ["subagent_stopped", "succeeded"],
      ],
    );
    const serialized = JSON.stringify(events);
    assert.doesNotMatch(serialized, /secret|input-only/);
    assert.ok(events.every((event) => "depth" in event && event.depth === 1));
  });

  it("maps rejected/error terminal milestones without a preceding start", async () => {
    const events: CodingLifecycleEvent[] = [];
    observeSupervisorLifecycle(
      source([
        { type: "delegation_rejected", childId: "child", delegationId: "rejected", depth: 1, reason: "hidden" },
        { type: "delegation_error", childId: "child", delegationId: "error", depth: 1, error: "hidden" },
      ]),
      { onEvent: (event) => events.push(event) },
    );
    await settles(() => events.length === 2);
    assert.deepEqual(events, [
      { type: "subagent_stopped", childId: "child", delegationId: "rejected", depth: 1, status: "denied" },
      { type: "subagent_stopped", childId: "child", delegationId: "error", depth: 1, status: "failed" },
    ]);
  });

  it("drops an oversized redacted child id at the coding lifecycle byte cap", async () => {
    const events: CodingLifecycleEvent[] = [];
    const emitter = createCodingLifecycleEmitter({ onEvent: (event) => events.push(event) });
    let delivered = 0;
    observeSupervisorLifecycle(
      source([{ type: "delegation_started", childId: "x".repeat(20_000), delegationId: "id", depth: 1, resourceId: "r", threadId: "t" }]),
      {
        onEvent: (event) => {
          delivered += 1;
          emitter.emit(event);
        },
      },
    );
    await settles(() => delivered === 1);
    assert.deepEqual(events, []);
  });
});
