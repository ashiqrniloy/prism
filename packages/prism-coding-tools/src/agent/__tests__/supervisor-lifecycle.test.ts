import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DelegatedAgentStep } from "@arnilo/prism";
import type { SupervisorEvent, SupervisorRunSummary } from "@arnilo/prism-core/runtime/supervisor";
import { type CodingLifecycleEvent, createCodingLifecycleEmitter, DEFAULT_LIFECYCLE_MAX_REASON_BYTES } from "../lifecycle.js";
import { observeSupervisorLifecycle } from "../supervisor-lifecycle.js";

async function settles(ready: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (ready()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail("supervisor lifecycle observer did not settle");
}

function source(events: readonly SupervisorEvent[], summary?: () => SupervisorRunSummary) {
  return {
    redact: (value: string) => value,
    subscribe: () => ({
      async *[Symbol.asyncIterator]() {
        yield* events;
      },
    }),
    ...(summary ? { summary } : {}),
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

  it("attaches a buffered child_failed to the error stop only when includeFailure is on", async () => {
    const supervisorEvents: readonly SupervisorEvent[] = [
      {
        type: "child_failed",
        childId: "worker",
        delegationId: "sup-1",
        depth: 1,
        reason: "run limit: maxToolCalls",
        status: "failed",
        limit: { limit: "maxToolCalls", maximum: 32, observed: 32 },
        stopReason: "turn_limit",
      },
      { type: "delegation_error", childId: "worker", delegationId: "sup-1", depth: 1, error: "run limit: maxToolCalls" },
    ];

    const off: CodingLifecycleEvent[] = [];
    observeSupervisorLifecycle(source(supervisorEvents), { onEvent: (event) => off.push(event) });
    await settles(() => off.length === 1);
    assert.deepEqual(off, [{ type: "subagent_stopped", childId: "worker", delegationId: "sup-1", depth: 1, status: "failed" }]);
    assert.equal(JSON.stringify(off).includes("failure"), false);

    const on: CodingLifecycleEvent[] = [];
    observeSupervisorLifecycle(source(supervisorEvents), { onEvent: (event) => on.push(event), includeFailure: true });
    await settles(() => on.length === 1);
    assert.deepEqual(on, [
      {
        type: "subagent_stopped",
        childId: "worker",
        delegationId: "sup-1",
        depth: 1,
        status: "failed",
        failure: { reason: "run limit: maxToolCalls", limit: "maxToolCalls", stopReason: "turn_limit" },
      },
    ]);
  });

  it("never attaches failure to finished or rejected stops", async () => {
    const events: CodingLifecycleEvent[] = [];
    observeSupervisorLifecycle(
      source([
        { type: "child_failed", childId: "worker", delegationId: "d-1", depth: 1, reason: "boom" },
        { type: "delegation_finished", childId: "worker", delegationId: "d-1", depth: 1, status: "succeeded", totalTokens: 2 },
        { type: "child_failed", childId: "worker", delegationId: "d-2", depth: 1, reason: "boom" },
        { type: "delegation_rejected", childId: "worker", delegationId: "d-2", depth: 1, reason: "policy" },
      ]),
      { onEvent: (event) => events.push(event), includeFailure: true },
    );
    await settles(() => events.length === 2);
    assert.deepEqual(events, [
      { type: "subagent_stopped", childId: "worker", delegationId: "d-1", depth: 1, status: "succeeded" },
      { type: "subagent_stopped", childId: "worker", delegationId: "d-2", depth: 1, status: "denied" },
    ]);
  });

  it("attaches recovery counters from summary() only when includeRecovery is on", async () => {
    const row = { childId: "worker", attempts: 2, retries: 1, failures: 1, failureRadius: 3, outcome: "failed" } as const;
    const supervisorEvents: readonly SupervisorEvent[] = [
      { type: "delegation_started", childId: "worker", delegationId: "d-1", depth: 1, resourceId: "r", threadId: "t" },
      { type: "delegation_error", childId: "worker", delegationId: "d-1", depth: 1, error: "boom" },
    ];

    const on: CodingLifecycleEvent[] = [];
    observeSupervisorLifecycle(
      source(supervisorEvents, () => ({ children: [row] })),
      {
        onEvent: (event) => on.push(event),
        includeRecovery: true,
        includeFailure: true,
      },
    );
    await settles(() => on.length === 2);
    assert.deepEqual(on[0], { type: "subagent_started", childId: "worker", delegationId: "d-1", depth: 1 });
    assert.deepEqual(on[1], {
      type: "subagent_stopped",
      childId: "worker",
      delegationId: "d-1",
      depth: 1,
      status: "failed",
      recovery: { attempts: 2, retries: 1, failures: 1, failureRadius: 3, outcome: "failed" },
    });

    const off: CodingLifecycleEvent[] = [];
    observeSupervisorLifecycle(
      source(supervisorEvents, () => ({ children: [row] })),
      { onEvent: (event) => off.push(event) },
    );
    await settles(() => off.length === 2);
    assert.equal(JSON.stringify(off).includes("recovery"), false);

    const bare: CodingLifecycleEvent[] = [];
    observeSupervisorLifecycle(source(supervisorEvents), { onEvent: (event) => bare.push(event), includeRecovery: true });
    await settles(() => bare.length === 2);
    assert.deepEqual(bare[1], { type: "subagent_stopped", childId: "worker", delegationId: "d-1", depth: 1, status: "failed" });

    const broken: CodingLifecycleEvent[] = [];
    observeSupervisorLifecycle(
      source(supervisorEvents, () => {
        throw new Error("summary unavailable");
      }),
      { onEvent: (event) => broken.push(event), includeRecovery: true },
    );
    await settles(() => broken.length === 2);
    assert.deepEqual(broken[1], { type: "subagent_stopped", childId: "worker", delegationId: "d-1", depth: 1, status: "failed" });
  });

  it("bounds the carried reason to the lifecycle reason cap and the event byte cap", async () => {
    const carry = async (reason: string): Promise<string> => {
      const events: CodingLifecycleEvent[] = [];
      const emitter = createCodingLifecycleEmitter({ onEvent: (event) => events.push(event) });
      observeSupervisorLifecycle(
        source([
          { type: "child_failed", childId: "worker", delegationId: "d-1", depth: 1, reason },
          { type: "delegation_error", childId: "worker", delegationId: "d-1", depth: 1, error: "boom" },
        ]),
        { includeFailure: true, onEvent: (event) => emitter.emit(event) },
      );
      await settles(() => events.length === 1);
      const stopped = events[0] as Extract<CodingLifecycleEvent, { readonly type: "subagent_stopped" }>;
      assert.ok(stopped.failure, "the bounded failure must still be delivered by the emitter");
      return stopped.failure.reason;
    };

    const ascii = await carry("x".repeat(10_000));
    assert.equal(ascii.length, DEFAULT_LIFECYCLE_MAX_REASON_BYTES);
    const multibyte = await carry("é".repeat(1_000));
    assert.ok(multibyte.length > 0 && Buffer.byteLength(multibyte, "utf8") <= DEFAULT_LIFECYCLE_MAX_REASON_BYTES);
  });

  it("keeps the pending-failure buffer bounded to 64 entries", async () => {
    const failure = (index: number): SupervisorEvent => ({
      type: "child_failed",
      childId: "worker",
      delegationId: `d-${index}`,
      depth: 1,
      reason: `failure ${index}`,
    });
    const stop = (index: number): SupervisorEvent => ({
      type: "delegation_error",
      childId: "worker",
      delegationId: `d-${index}`,
      depth: 1,
      error: "boom",
    });
    const carried = async (count: number, stops: readonly number[]): Promise<boolean[]> => {
      const events: CodingLifecycleEvent[] = [];
      observeSupervisorLifecycle(
        source([...Array.from({ length: count }, (_, index) => failure(index + 1)), ...stops.map((index) => stop(index))]),
        { onEvent: (event) => events.push(event), includeFailure: true },
      );
      await settles(() => events.length === stops.length);
      return events.map((event) => "failure" in event && event.failure !== undefined);
    };

    assert.deepEqual(await carried(64, [1, 64]), [true, true], "64 pending entries: the oldest is still carried");
    assert.deepEqual(await carried(65, [1, 65]), [false, true], "65 pending entries: the oldest is dropped, the newest kept");
    assert.deepEqual(await carried(100, [1, 100]), [false, true], "100 pending entries: the bound holds and the newest survives");
  });

  it("keeps the AG-UI delegated_agent_step payload free of the opt-in fields", async () => {
    const steps: DelegatedAgentStep[] = [];
    observeSupervisorLifecycle(
      source(
        [
          {
            type: "child_failed",
            childId: "worker",
            delegationId: "d-1",
            depth: 1,
            reason: "run limit: maxToolCalls",
            limit: { limit: "maxToolCalls", maximum: 32, observed: 32 },
            stopReason: "turn_limit",
          },
          { type: "delegation_error", childId: "worker", delegationId: "d-1", depth: 1, error: "run limit: maxToolCalls" },
        ],
        () => ({ children: [{ childId: "worker", attempts: 1, retries: 0, failures: 1, failureRadius: 0, outcome: "failed" }] }),
      ),
      {
        includeFailure: true,
        includeRecovery: true,
        onEvent: () => undefined,
        delegatedAgentStep: {
          sessionId: "session-1",
          runId: "run-1",
          adapterId: "coding-supervisor",
          externalConversationId: "conversation-1",
          onEvent: (event) => steps.push(event),
        },
      },
    );
    await settles(() => steps.length === 1);
    assert.deepEqual(steps[0]?.detail, { label: "failed" });
    assert.equal(steps[0]?.state, "error");
    assert.doesNotMatch(JSON.stringify(steps), /failure|recovery|maxToolCalls|turn_limit|attempts|reason/);
  });
});
