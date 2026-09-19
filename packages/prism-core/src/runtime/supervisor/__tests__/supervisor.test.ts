import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type Agent,
  type AgentEvent,
  type AIProvider,
  createAgent,
  createMemoryToolEffectStore,
  createMockProvider,
  createSecretRedactor,
  providerDone,
  providerTextDelta,
  providerToolCall,
  providerUsage,
  type ToolDefinition,
} from "@arnilo/prism";
import { createSupervisor, SupervisorDeniedError, SupervisorError, SupervisorLimitError, type SupervisorEvent } from "../index.js";

const ownership = { tenantId: "tenant", userId: "user" };
const doneAgent = (text = "child", tokens = 2): Agent =>
  createAgent({
    model: { provider: "mock", model: "test" },
    provider: createMockProvider([providerTextDelta(text), providerUsage({ totalTokens: tokens }), providerDone()]),
  });

describe("createSupervisor", () => {
  it("delegates to an allow-listed child with isolated scope and completion events", async () => {
    const scopes: string[] = [];
    const completions: string[] = [];
    const supervisor = createSupervisor({
      id: "lead",
      ownership,
      children: {
        research: {
          createAgent: (context) => {
            scopes.push(context.resourceId, context.threadId);
            return doneAgent();
          },
        },
      },
      hooks: {
        after: (value) => {
          completions.push(value.status);
        },
      },
    });
    const iterator = supervisor.subscribe()[Symbol.asyncIterator]();
    const result = await supervisor.delegate({ childId: "research", input: "question", threadId: "thread" });
    assert.equal(result.text, "child");
    assert.match(scopes[0]!, /^lead\/lead-1\/research$/);
    assert.match(scopes[1]!, /\/thread$/);
    assert.deepEqual(completions, ["succeeded"]);
    assert.equal((await iterator.next()).value.type, "delegation_started");
    assert.equal((await iterator.next()).value.type, "delegation_finished");
    await assert.rejects(supervisor.delegate({ childId: "missing", input: "x" }), SupervisorDeniedError);
  });

  it("lets hooks reject or narrow/modify without widening parent permission", async () => {
    let executed = 0;
    let seenInput = "";
    const tool: ToolDefinition = {
      name: "write",
      execute: (_args, context) => {
        executed += 1;
        return { toolCallId: context.toolCallId, name: "write", content: [{ type: "text", text: "ok" }] };
      },
    };
    const provider: AIProvider = {
      id: "mock",
      async *generate(request) {
        seenInput = JSON.stringify(request.messages);
        yield providerToolCall({ type: "tool_call", id: "c1", name: "write", arguments: {} });
        yield providerDone();
      },
    };
    const denied = createSupervisor({
      ownership,
      children: { child: { createAgent: () => doneAgent() } },
      hooks: { before: () => ({ allowed: false, reason: "review denied" }) },
    });
    await assert.rejects(denied.delegate({ childId: "child", input: "x" }), /review denied/);
    assert.equal(denied.activeChildren, 0);

    const narrowed = createSupervisor({
      ownership,
      permission: { check: () => ({ allowed: false, reason: "parent denied" }) },
      children: { child: { createAgent: () => createAgent({ model: { provider: "mock", model: "test" }, provider, tools: [tool] }) } },
      hooks: { before: () => ({ input: "modified", permission: { check: () => ({ allowed: true }) } }) },
    });
    await narrowed.delegate({ childId: "child", input: "original" });
    assert.match(seenInput, /modified/);
    assert.equal(executed, 0);
  });

  it("propagates parent identity and effect store into child tool dispatch", async () => {
    const identity = {
      tenantId: "tenant",
      userId: "user",
      principal: { kind: "user" as const, id: "user" },
      scopes: ["tool:execute"],
      issuedAt: "2026-08-04T00:00:00.000Z",
      verified: true as const,
    };
    const effectStore = createMemoryToolEffectStore();
    let childIdentity = "";
    let seenKey = "";
    let effectSessionId = "";
    let effectRunId = "";
    const supervisor = createSupervisor({
      id: "root",
      ownership,
      identity,
      effectStore,
      children: {
        child: {
          createAgent: (context) => {
            childIdentity = context.identity?.principal.id ?? "";
            assert.strictEqual(context.effectStore, effectStore);
            return createAgent({
              model: { provider: "mock", model: "test" },
              provider: createMockProvider([
                providerToolCall({ type: "tool_call", id: "effect-1", name: "mutate", arguments: {} }),
                providerDone(),
              ]),
              tools: [
                {
                  name: "mutate",
                  effect: { kind: "external_mutation", idempotency: "required" },
                  execute: (_args, execution) => {
                    seenKey = execution.idempotencyKey ?? "";
                    effectSessionId = execution.sessionId;
                    effectRunId = execution.runId;
                    return { toolCallId: execution.toolCallId, name: "mutate", value: "done" };
                  },
                },
              ],
            });
          },
        },
      },
    });
    await supervisor.delegate({ childId: "child", input: "run" });
    assert.equal(childIdentity, "user");
    assert.match(seenKey, /^prism:tool-effect:v1:[a-f0-9]{64}$/);
    assert.equal(effectSessionId, "root-1-session");
    assert.ok(effectRunId.length > 0);
  });

  it("enforces nested cycle, depth, and active-child limits before execution", async () => {
    const supervisor: ReturnType<typeof createSupervisor> = createSupervisor({
      ownership,
      limits: { maxDepth: 2, maxActiveChildren: 1 },
      children: {
        cycle: {
          createAgent: async (context) => {
            await context.delegate({ childId: "cycle", input: "again" });
            return doneAgent();
          },
        },
        slow: {
          createAgent: async () => {
            await new Promise((resolve) => setTimeout(resolve, 30));
            return doneAgent();
          },
        },
      },
    });
    await assert.rejects(supervisor.delegate({ childId: "cycle", input: "x" }), /cycle/i);
    const first = supervisor.delegate({ childId: "slow", input: "x" });
    await new Promise((resolve) => setTimeout(resolve, 1));
    await assert.rejects(supervisor.delegate({ childId: "slow", input: "x" }), /Active child/);
    await first;
  });

  it("atomically reserves parallel child slots, including hook-narrowed limits", async () => {
    let created = 0;
    const direct = createSupervisor({
      ownership,
      limits: { maxActiveChildren: 2 },
      children: {
        child: {
          createAgent: () => {
            created += 1;
            return doneAgent();
          },
        },
      },
    });
    const directResults = await Promise.allSettled(
      Array.from({ length: 3 }, (_, index) => direct.delegate({ childId: "child", input: String(index) })),
    );
    const directRejected = directResults.filter((value): value is PromiseRejectedResult => value.status === "rejected");
    assert.equal(directResults.filter((value) => value.status === "fulfilled").length, 2);
    assert.equal(directRejected.length, 1);
    assert.ok(directRejected[0]?.reason instanceof SupervisorLimitError);
    assert.equal(created, 2);
    assert.equal(direct.activeChildren, 0);

    let hookCreated = 0;
    const narrowed = createSupervisor({
      ownership,
      limits: { maxActiveChildren: 3 },
      hooks: { before: () => ({ limits: { maxActiveChildren: 2 } }) },
      children: {
        child: {
          createAgent: () => {
            hookCreated += 1;
            return doneAgent();
          },
        },
      },
    });
    const hookResults = await Promise.allSettled(
      Array.from({ length: 3 }, (_, index) => narrowed.delegate({ childId: "child", input: String(index) })),
    );
    const hookRejected = hookResults.filter((value): value is PromiseRejectedResult => value.status === "rejected");
    assert.equal(hookResults.filter((value) => value.status === "fulfilled").length, 2);
    assert.equal(hookRejected.length, 1);
    assert.ok(hookRejected[0]?.reason instanceof SupervisorLimitError);
    assert.equal(hookCreated, 2);
    assert.equal(narrowed.activeChildren, 0);
  });

  it("runs bounded async delegations and releases cancellation/parent-abort slots", async () => {
    const completed = createSupervisor({
      ownership,
      limits: { maxQueuedEvents: 1 },
      children: { child: { createAgent: () => doneAgent("async") } },
    });
    const firstHandle = await completed.delegateAsync({ childId: "child", input: "x" });
    const first = await completed.wait(firstHandle.delegationId);
    const repeated = await completed.wait(firstHandle.delegationId);
    assert.equal(first.status, "succeeded");
    assert.equal(repeated.status, "succeeded");
    assert.equal(first.text, "async");
    const secondHandle = await completed.delegateAsync({ childId: "child", input: "y" });
    await completed.wait(secondHandle.delegationId);
    await assert.rejects(completed.wait(firstHandle.delegationId), /Unknown async delegation/);

    let childSignal: AbortSignal | undefined;
    const stalled = createSupervisor({
      ownership,
      children: {
        child: {
          createAgent: ({ signal }) => {
            childSignal = signal;
            return new Promise<Agent>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
          },
        },
      },
    });
    const handle = await stalled.delegateAsync({ childId: "child", input: "x" });
    assert.equal(stalled.cancel(handle.delegationId), true);
    assert.equal(childSignal?.aborted, true);
    assert.deepEqual(await stalled.wait(handle.delegationId), { delegationId: handle.delegationId, status: "cancelled" });
    assert.equal(stalled.cancel(handle.delegationId), false);
    assert.equal(stalled.activeChildren, 0);
    await assert.rejects(stalled.wait("foreign-handle"), /Unknown async delegation/);
    assert.throws(() => stalled.cancel("foreign-handle"), /Unknown async delegation/);

    const parent = new AbortController();
    const parentHandle = await stalled.delegateAsync({ childId: "child", input: "x", signal: parent.signal });
    parent.abort(new Error("parent stopped"));
    await assert.rejects(stalled.wait(parentHandle.delegationId), /parent stopped/);
    assert.equal(childSignal?.aborted, true);
    assert.equal(stalled.activeChildren, 0);

    const timedWait = createSupervisor({
      ownership,
      limits: { timeoutMs: 5 },
      children: {
        child: {
          createAgent: ({ signal }) =>
            new Promise<Agent>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
        },
      },
    });
    const timedHandle = await timedWait.delegateAsync({ childId: "child", input: "x" });
    await assert.rejects(timedWait.wait(timedHandle.delegationId), /timeout/);
    assert.equal(timedWait.activeChildren, 0);
  });

  it("enforces input, timeout, token, and tool-call budgets", async () => {
    const oversized = createSupervisor({
      ownership,
      limits: { maxMessageBytes: 4 },
      children: { child: { createAgent: () => doneAgent() } },
    });
    await assert.rejects(oversized.delegate({ childId: "child", input: "12345" }), SupervisorLimitError);

    const timeout = createSupervisor({
      ownership,
      limits: { timeoutMs: 2 },
      children: {
        child: {
          createAgent: async () => {
            await new Promise(() => undefined);
            return doneAgent();
          },
        },
      },
    });
    await assert.rejects(timeout.delegate({ childId: "child", input: "x" }), /timeout/);
    assert.equal(timeout.activeChildren, 0);

    const tokens = createSupervisor({ ownership, limits: { maxTokens: 1 }, children: { child: { createAgent: () => doneAgent("x", 2) } } });
    await assert.rejects(tokens.delegate({ childId: "child", input: "x" }), /token limit/);

    let calls = 0;
    const tools: ToolDefinition[] = ["one", "two"].map((name) => ({
      name,
      execute: (_args, context) => {
        calls += 1;
        return { toolCallId: context.toolCallId, name, content: [] };
      },
    }));
    const toolAgent = createAgent({
      model: { provider: "mock", model: "test" },
      provider: createMockProvider([
        providerToolCall({ type: "tool_call", id: "1", name: "one", arguments: {} }),
        providerToolCall({ type: "tool_call", id: "2", name: "two", arguments: {} }),
        providerDone(),
      ]),
      tools,
    });
    const bounded = createSupervisor({ ownership, limits: { maxToolCalls: 1 }, children: { child: { createAgent: () => toolAgent } } });
    await assert.rejects(bounded.delegate({ childId: "child", input: "x" }), /tool-call limit/);
    assert.equal(calls, 1);
  });

  it("propagates abort and redacts hook/event failures", async () => {
    const controller = new AbortController();
    let completion = "";
    const supervisor = createSupervisor({
      ownership,
      redactor: createSecretRedactor(["canary"]),
      children: {
        child: {
          createAgent: async ({ signal }) => {
            await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
            return doneAgent();
          },
        },
      },
      hooks: {
        after: (value) => {
          completion = JSON.stringify(value);
        },
      },
    });
    const pending = supervisor.delegate({ childId: "child", input: "canary", signal: controller.signal });
    controller.abort(new Error("canary abort"));
    await assert.rejects(pending);
    assert.equal(supervisor.activeChildren, 0);
    assert.doesNotMatch(completion, /canary/);
  });

  // BUG-2 regression (integration findings, plan 050 Task 3): a child factory
  // returning a session (or any non-Agent) must fail with an actionable error at
  // delegate() time, not a cryptic "reading 'permission'" TypeError.
  it("rejects a child factory returning a non-Agent with an actionable error", async () => {
    const session = doneAgent().createSession({ id: "s" });
    const sessionFactory = createSupervisor({
      ownership,
      children: { writer: { createAgent: () => session as unknown as Agent } },
    });
    await assert.rejects(
      sessionFactory.delegate({ childId: "writer", input: "x" }),
      (error: unknown) =>
        error instanceof SupervisorError && /child "writer" factory must return an Agent, got RuntimeAgentSession/.test(error.message),
    );

    const emptyFactory = createSupervisor({
      ownership,
      children: { writer: { createAgent: () => ({}) as unknown as Agent } },
    });
    await assert.rejects(
      emptyFactory.delegate({ childId: "writer", input: "x" }),
      /child "writer" factory must return an Agent, got Object/,
    );

    for (const [label, value] of [
      ["undefined", undefined],
      ["null", null],
      ["string", "nope"],
    ] as const) {
      const badFactory = createSupervisor({
        ownership,
        children: { writer: { createAgent: () => value as unknown as Agent } },
      });
      await assert.rejects(
        badFactory.delegate({ childId: "writer", input: "x" }),
        new RegExp(`child "writer" factory must return an Agent, got ${label}`),
      );
    }
  });

  // FEATURE-4 (integration findings, plan 050 Task 6): opt-in child event
  // passthrough. Default off; milestone subset only; redaction + caps when on.
  it("does not project child events onto the supervisor stream by default", async () => {
    const supervisor = createSupervisor({
      ownership,
      children: { child: { createAgent: () => doneAgent() } },
    });
    const iterator = supervisor.subscribe()[Symbol.asyncIterator]();
    await supervisor.delegate({ childId: "child", input: "x" });
    const types: string[] = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      types.push(next.value.type);
      if (next.value.type === "delegation_finished") break;
    }
    assert.deepEqual(types, ["delegation_started", "delegation_finished"]);
  });

  it("projects tagged milestone child events when childEvents is on", async () => {
    const supervisor = createSupervisor({
      ownership,
      childEvents: true,
      children: { research: { createAgent: () => doneAgent() } },
    });
    const iterator = supervisor.subscribe()[Symbol.asyncIterator]();
    await supervisor.delegate({ childId: "research", input: "x" });
    const received: Array<{ type: string; childId?: string; depth?: number; childEventType?: string }> = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      const event = next.value;
      received.push({
        type: event.type,
        childId: "childId" in event ? event.childId : undefined,
        depth: "depth" in event ? event.depth : undefined,
        childEventType: event.type === "delegation_child_event" ? event.childEvent.type : undefined,
      });
      if (event.type === "delegation_finished") break;
    }
    assert.equal(received[0]?.type, "delegation_started");
    const childEvents = received.filter((event) => event.type === "delegation_child_event");
    assert.ok(childEvents.some((event) => event.childEventType === "agent_started"));
    assert.ok(childEvents.some((event) => event.childEventType === "agent_finished"));
    assert.equal(
      childEvents.every((event) => event.childId === "research" && event.depth === 1),
      true,
    );
    assert.equal(
      childEvents.some((event) => event.childEventType === "message_delta" || event.childEventType === "message_started"),
      false,
    );
    assert.equal(received.at(-1)?.type, "delegation_finished");
  });

  it("redacts child events before emission", async () => {
    const tool: ToolDefinition = {
      name: "write",
      execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "write", value: "ok" }),
    };
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        yield providerToolCall({ type: "tool_call", id: "c1", name: "write", arguments: { secret: "canary" } });
        yield providerDone();
      },
    };
    const supervisor = createSupervisor({
      ownership,
      childEvents: true,
      redactor: createSecretRedactor(["canary"]),
      children: {
        child: {
          createAgent: () =>
            createAgent({
              model: { provider: "mock", model: "test" },
              provider,
              tools: [tool],
            }),
        },
      },
    });
    const iterator = supervisor.subscribe()[Symbol.asyncIterator]();
    await supervisor.delegate({ childId: "child", input: "x" });
    const blobs: string[] = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      blobs.push(JSON.stringify(next.value));
      if (next.value.type === "delegation_finished") break;
    }
    assert.equal(
      blobs.some((blob) => blob.includes("canary")),
      false,
    );
    assert.equal(
      blobs.some((blob) => blob.includes("delegation_child_event")),
      true,
    );
  });

  it("drops further child events and emits one capped marker when the per-delegation cap is hit", async () => {
    const supervisor = createSupervisor({
      ownership,
      childEvents: true,
      limits: { maxChildEventsPerDelegation: 1 },
      children: { child: { createAgent: () => doneAgent() } },
    });
    const iterator = supervisor.subscribe()[Symbol.asyncIterator]();
    await supervisor.delegate({ childId: "child", input: "x" });
    const types: string[] = [];
    let maxChildEvents = 0;
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      types.push(next.value.type);
      if (next.value.type === "delegation_child_events_capped") maxChildEvents = next.value.maxChildEvents;
      if (next.value.type === "delegation_finished") break;
    }
    assert.equal(types.filter((type) => type === "delegation_child_event").length, 1);
    assert.equal(types.filter((type) => type === "delegation_child_events_capped").length, 1);
    assert.equal(maxChildEvents, 1);
    assert.equal(types.at(-1), "delegation_finished");
  });
});

describe("child lifetime and report policy", () => {
  const noopTool: ToolDefinition = {
    name: "noop",
    execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "noop", value: "ok" }),
  };

  const gatedAgent = (gate: Promise<void>): Agent =>
    createAgent({
      model: { provider: "mock", model: "test" },
      provider: {
        id: "mock",
        async *generate() {
          await gate;
          yield providerTextDelta("done");
          yield providerDone();
        },
      },
    });

  /** One provider call per child turn; the first `turns - 1` calls request `callsPerTurn` tools. */
  const toolTurnAgent = (turns: number, callsPerTurn = 1): Agent => {
    let generated = 0;
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        generated += 1;
        if (generated < turns) {
          for (let call = 0; call < callsPerTurn; call += 1) {
            yield providerToolCall({ type: "tool_call", id: `c${generated}-${call}`, name: "noop", arguments: {} });
          }
        }
        yield providerDone();
      },
    };
    return createAgent({ model: { provider: "mock", model: "test" }, provider, tools: [noopTool] });
  };

  it("keeps session-lifetime children running after the caller signal aborts", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const supervisor = createSupervisor({
      ownership,
      children: { watch: { policy: { lifetime: "session" }, createAgent: () => gatedAgent(gate) } },
    });
    const caller = new AbortController();
    const handle = await supervisor.delegateAsync({ childId: "watch", input: "go", lifetime: "session", signal: caller.signal });
    caller.abort(new Error("parent turn ended"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(supervisor.activeChildren, 1);
    release();
    const result = await supervisor.wait(handle.delegationId);
    assert.equal(result.status, "succeeded");
    assert.equal(supervisor.activeChildren, 0);
  });

  it("still aborts task-lifetime children with the caller signal", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const supervisor = createSupervisor({ ownership, children: { watch: { createAgent: () => gatedAgent(gate) } } });
    const caller = new AbortController();
    const handle = await supervisor.delegateAsync({ childId: "watch", input: "go", signal: caller.signal });
    caller.abort(new Error("parent turn ended"));
    await assert.rejects(supervisor.wait(handle.delegationId), /parent turn ended/);
    assert.equal(supervisor.activeChildren, 0);
    release();
  });

  it("ends session-lifetime children when the supervisor session signal aborts", async () => {
    const gate = new Promise<void>(() => undefined);
    const session = new AbortController();
    const supervisor = createSupervisor({
      ownership,
      signal: session.signal,
      children: { watch: { policy: { lifetime: "session" }, createAgent: () => gatedAgent(gate) } },
    });
    const iterator = supervisor.subscribe()[Symbol.asyncIterator]();
    const handle = await supervisor.delegateAsync({ childId: "watch", input: "go", lifetime: "session" });
    session.abort(new Error("session over"));
    await assert.rejects(supervisor.wait(handle.delegationId));
    assert.equal(supervisor.activeChildren, 0);
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
    }
  });

  it("denies session lifetime the host child policy does not enable", async () => {
    const supervisor = createSupervisor({ ownership, children: { child: { createAgent: () => doneAgent() } } });
    await assert.rejects(supervisor.delegateAsync({ childId: "child", input: "x", lifetime: "session" }), /session lifetime/);
    await assert.rejects(supervisor.delegate({ childId: "child", input: "x", lifetime: "session" }), /session lifetime/);
    const session = createSupervisor({
      ownership,
      children: { child: { policy: { lifetime: "session" }, createAgent: () => doneAgent() } },
    });
    await assert.rejects(session.delegate({ childId: "child", input: "x", lifetime: "session" }), /delegateAsync/);
    // The host flag is a capability, not a default: an omitted lifetime still runs as a task child.
    assert.equal((await session.delegate({ childId: "child", input: "x" })).status, "succeeded");
  });

  it("emits child_milestone at the requested turn cadence", async () => {
    const supervisor = createSupervisor({
      ownership,
      children: { child: { policy: { report: "stream" }, createAgent: () => toolTurnAgent(4) } },
    });
    const iterator = supervisor.subscribe()[Symbol.asyncIterator]();
    await supervisor.delegate({ childId: "child", input: "x", report: "milestones", milestone: { everyTurns: 2 } });
    const turns: number[] = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      if (next.value.type === "child_milestone") turns.push(next.value.turn);
      if (next.value.type === "delegation_finished") break;
    }
    assert.deepEqual(turns, [2, 4]);

    // Host cadence is a chattiness ceiling: a chattier request is clamped up to it.
    const hostCadence = createSupervisor({
      ownership,
      children: { child: { policy: { report: "milestones", milestone: { everyTurns: 3 } }, createAgent: () => toolTurnAgent(4) } },
    });
    const clamped = hostCadence.subscribe()[Symbol.asyncIterator]();
    await hostCadence.delegate({ childId: "child", input: "x", milestone: { everyTurns: 1 } });
    const hostTurns: number[] = [];
    for (;;) {
      const next = await clamped.next();
      if (next.done) break;
      if (next.value.type === "child_milestone") hostTurns.push(next.value.turn);
      if (next.value.type === "delegation_finished") break;
    }
    assert.deepEqual(hostTurns, [3]);

    // Host predicate path: report selected child events regardless of turn cadence.
    const predicateMilestones = createSupervisor({
      ownership,
      children: {
        child: {
          policy: { report: "milestones", milestone: { predicate: (event) => event.type === "tool_execution_finished" } },
          createAgent: () => toolTurnAgent(4),
        },
      },
    });
    const predicateIterator = predicateMilestones.subscribe()[Symbol.asyncIterator]();
    await predicateMilestones.delegate({ childId: "child", input: "x" });
    const predicateTurns: number[] = [];
    for (;;) {
      const next = await predicateIterator.next();
      if (next.done) break;
      if (next.value.type === "child_milestone") predicateTurns.push(next.value.turn);
      if (next.value.type === "delegation_finished") break;
    }
    assert.deepEqual(predicateTurns, [1, 2, 3]);
  });

  it("coalesces child events above the per-child rate cap", async (t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    const supervisor = createSupervisor({
      ownership,
      childEvents: true,
      limits: { maxChildEventsPerSecond: 1 },
      children: { child: { createAgent: () => toolTurnAgent(4) } },
    });
    const iterator = supervisor.subscribe()[Symbol.asyncIterator]();
    await supervisor.delegate({ childId: "child", input: "x" });
    const types: string[] = [];
    let dropped = 0;
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      types.push(next.value.type);
      if (next.value.type === "delegation_child_events_coalesced") dropped = next.value.dropped;
      if (next.value.type === "delegation_finished") break;
    }
    assert.equal(types.filter((type) => type === "delegation_child_event").length, 1);
    assert.ok(dropped > 1, `expected coalesced drops, got ${dropped}`);
  });

  it("enforces a spawn budget share and attributes the limit that fired", async () => {
    const supervisor = createSupervisor({ ownership, children: { child: { createAgent: () => toolTurnAgent(12, 5) } } });
    const iterator = supervisor.subscribe()[Symbol.asyncIterator]();
    await assert.rejects(supervisor.delegate({ childId: "child", input: "x", budgetShare: 0.25 }), /limit/i);
    const received: SupervisorEvent[] = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      received.push(next.value);
      if (next.value.type === "delegation_error") break;
    }
    const failed = received.find((event): event is Extract<SupervisorEvent, { type: "child_failed" }> => event.type === "child_failed");
    assert.ok(failed, "child_failed attribution event missing");
    assert.ok(failed.limit, "limit attribution missing");
    const base: Record<string, number> = { maxToolRounds: 8, maxToolCalls: 32, maxTotalTokens: 20_000, maxWallTimeMs: 60_000 };
    assert.equal(failed.limit.maximum, Math.floor(base[failed.limit.limit] * 0.25));
  });

  it("clamps requested report/share to the host child policy ceiling", async () => {
    const supervisor = createSupervisor({
      ownership,
      children: { child: { policy: { report: "on-complete", budgetShare: 0.25 }, createAgent: () => toolTurnAgent(12, 5) } },
    });
    const iterator = supervisor.subscribe()[Symbol.asyncIterator]();
    await assert.rejects(supervisor.delegate({ childId: "child", input: "x", report: "stream", budgetShare: 0.9 }), /limit/i);
    const received: SupervisorEvent[] = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      received.push(next.value);
      if (next.value.type === "delegation_error") break;
    }
    assert.equal(
      received.some((event) => event.type === "delegation_child_event"),
      false,
    );
    const failed = received.find((event): event is Extract<SupervisorEvent, { type: "child_failed" }> => event.type === "child_failed");
    assert.ok(failed?.limit);
    const base: Record<string, number> = { maxToolRounds: 8, maxToolCalls: 32, maxTotalTokens: 20_000, maxWallTimeMs: 60_000 };
    assert.equal(failed.limit.maximum, Math.floor(base[failed.limit.limit] * 0.25));
  });
});

describe("child event passthrough", () => {
  const noopTool: ToolDefinition = {
    name: "noop",
    execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "noop", value: "ok" }),
  };

  const toolTurnAgent = (turns: number): Agent => {
    let generated = 0;
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        generated += 1;
        if (generated < turns) {
          yield providerToolCall({ type: "tool_call", id: `c${generated}`, name: "noop", arguments: {} });
        }
        yield providerDone();
      },
    };
    return createAgent({ model: { provider: "mock", model: "test" }, provider, tools: [noopTool] });
  };

  it("routes the exact tagged projection to the sink and forwards per-turn provider/tool events", async () => {
    const sink: AgentEvent[] = [];
    const supervisor = createSupervisor({
      ownership,
      childEvents: true,
      childEventSink: (event) => void sink.push(event),
      children: { child: { createAgent: () => toolTurnAgent(2) } },
    });
    const iterator = supervisor.subscribe()[Symbol.asyncIterator]();
    await supervisor.delegate({ childId: "child", input: "x" });
    const published: AgentEvent[] = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      if (next.value.type === "delegation_finished") break;
      if (next.value.type === "delegation_child_event" || next.value.type === "child_milestone") published.push(next.value.childEvent);
    }

    // The sink sees exactly the events published on the supervisor stream, in the same order.
    assert.deepEqual(sink, published);
    const types = sink.map((event) => event.type);
    assert.ok(types.includes("agent_started"));
    assert.ok(types.includes("turn_started"));
    assert.ok(types.includes("provider_turn_started"));
    assert.ok(types.includes("tool_execution_finished"));
    assert.equal(
      types.includes("message_delta") || types.includes("message_started"),
      false,
      "per-token/message events never pass through",
    );
    assert.deepEqual(
      sink
        .filter((event): event is Extract<AgentEvent, { type: "turn_started" }> => event.type === "turn_started")
        .map((event) => event.turn),
      [1, 2],
      "per-turn ordering is deterministic across relay",
    );
    assert.equal(
      sink.every(
        (event) => event.child?.childId === "child" && event.child.depth === 1 && event.child.delegationId.startsWith("supervisor-"),
      ),
      true,
    );
  });

  it("does not project or route child events for default children", async () => {
    const sink: AgentEvent[] = [];
    const supervisor = createSupervisor({
      ownership,
      childEventSink: (event) => void sink.push(event),
      children: { child: { createAgent: () => doneAgent() } },
    });
    await supervisor.delegate({ childId: "child", input: "x" });
    assert.deepEqual(sink, []);
  });

  it("redacts child events before the sink sees them", async () => {
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        yield providerToolCall({ type: "tool_call", id: "c1", name: "write", arguments: { secret: "canary" } });
        yield providerDone();
      },
    };
    const sink: AgentEvent[] = [];
    const supervisor = createSupervisor({
      ownership,
      childEvents: true,
      childEventSink: (event) => void sink.push(event),
      redactor: createSecretRedactor(["canary"]),
      children: {
        child: {
          createAgent: () =>
            createAgent({
              model: { provider: "mock", model: "test" },
              provider,
              tools: [{ name: "write", execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "write", value: "ok" }) }],
            }),
        },
      },
    });
    await supervisor.delegate({ childId: "child", input: "x" });
    assert.ok(
      sink.some((event) => event.type === "tool_execution_started"),
      "sink must have received the tool event",
    );
    assert.equal(JSON.stringify(sink).includes("canary"), false, "secret reached the sink");
  });

  it("tags nested children with their depth and forwards them to the same sink", async () => {
    const sink: AgentEvent[] = [];
    const supervisor = createSupervisor({
      ownership,
      childEvents: true,
      childEventSink: (event) => void sink.push(event),
      children: {
        lead: {
          createAgent: (context) => {
            const provider: AIProvider = {
              id: "mock",
              async *generate() {
                await context.delegate({ childId: "writer", input: "nested" });
                yield providerTextDelta("lead done");
                yield providerDone();
              },
            };
            return createAgent({ model: { provider: "mock", model: "test" }, provider });
          },
        },
        writer: { createAgent: () => doneAgent("nested") },
      },
    });
    await supervisor.delegate({ childId: "lead", input: "x" });
    assert.equal(
      sink.some((event) => event.child?.childId === "lead" && event.child.depth === 1),
      true,
    );
    assert.equal(
      sink.some((event) => event.child?.childId === "writer" && event.child.depth === 2),
      true,
    );
  });
});

describe("cascade and recovery telemetry", () => {
  const hangingAgent = (): Agent => {
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        await new Promise(() => undefined);
      },
    };
    return createAgent({ model: { provider: "mock", model: "test" }, provider });
  };

  const toolTurnAgent = (): Agent => {
    let generated = 0;
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        generated += 1;
        yield providerToolCall({ type: "tool_call", id: `c${generated}`, name: "noop", arguments: {} });
        yield providerDone();
      },
    };
    return createAgent({
      model: { provider: "mock", model: "test" },
      provider,
      tools: [{ name: "noop", execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "noop", value: "ok" }) }],
    });
  };

  const collectUntilDelegationError = async (iterator: AsyncIterator<SupervisorEvent>): Promise<SupervisorEvent[]> => {
    const events: SupervisorEvent[] = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      events.push(next.value);
      if (next.value.type === "delegation_error") break;
    }
    return events;
  };

  it("counts attempts, retries, failures, and outcome across fail, retry, complete", async () => {
    let runs = 0;
    const supervisor = createSupervisor({
      ownership,
      children: { worker: { createAgent: () => (runs++ === 0 ? toolTurnAgent() : doneAgent("recovered")) } },
    });
    const iterator = supervisor.subscribe()[Symbol.asyncIterator]();
    await assert.rejects(supervisor.delegate({ childId: "worker", input: "first", limits: { maxToolCalls: 1 } }), /limit/i);
    assert.deepEqual(supervisor.summary().children, [
      { childId: "worker", attempts: 1, retries: 0, failures: 1, failureRadius: 0, outcome: "failed" },
    ]);
    const events = await collectUntilDelegationError(iterator);
    const failed = events.find((event): event is Extract<SupervisorEvent, { type: "child_failed" }> => event.type === "child_failed");
    assert.ok(failed, "child_failed attribution missing");
    assert.equal(failed.status, "failed");
    assert.equal(failed.limit?.limit, "maxToolCalls");
    assert.ok(
      events.findIndex((event) => event.type === "child_failed") < events.findIndex((event) => event.type === "delegation_error"),
      "attribution must arrive before the terminal delegation_error",
    );

    await supervisor.delegate({ childId: "worker", input: "second" });
    assert.deepEqual(supervisor.summary().children, [
      { childId: "worker", attempts: 2, retries: 1, failures: 1, failureRadius: 0, outcome: "succeeded" },
    ]);
  });

  it("attributes a plain failure, and a host cancel is not a failure", async () => {
    const controller = new AbortController();
    const supervisor = createSupervisor({
      ownership,
      signal: controller.signal,
      redactor: createSecretRedactor(["canary"]),
      children: {
        broken: {
          createAgent: () => {
            const provider: AIProvider = {
              id: "mock",
              async *generate() {
                throw new Error("provider exploded with canary");
              },
            };
            return createAgent({ model: { provider: "mock", model: "test" }, provider });
          },
        },
        idle: { createAgent: () => hangingAgent() },
      },
    });
    const iterator = supervisor.subscribe()[Symbol.asyncIterator]();
    await assert.rejects(supervisor.delegate({ childId: "broken", input: "x" }));
    const events = await collectUntilDelegationError(iterator);
    const failed = events.find((event): event is Extract<SupervisorEvent, { type: "child_failed" }> => event.type === "child_failed");
    assert.ok(failed, "child_failed attribution missing");
    assert.equal(failed.limit, undefined, "a plain failure carries no breach");
    assert.match(failed.reason, /provider exploded/);
    assert.equal(failed.reason.includes("canary"), false, "error details follow redaction rules");
    assert.equal(supervisor.summary().children[0]?.failures, 1);
    assert.equal(supervisor.summary().children[0]?.outcome, "failed");

    const handle = await supervisor.delegateAsync({ childId: "idle", input: "wait" });
    assert.equal(supervisor.summary().children[1]?.outcome, "running");
    supervisor.cancel(handle.delegationId);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(supervisor.summary().children[1]?.failures, 0, "a host cancel is not a failure");
    assert.equal(supervisor.summary().children[1]?.outcome, "aborted");
  });

  it("counts only live descendants in the failure radius", async () => {
    const controller = new AbortController();
    const supervisor = createSupervisor({
      ownership,
      signal: controller.signal,
      children: {
        lead: {
          createAgent: (context) => {
            const provider: AIProvider = {
              id: "mock",
              async *generate() {
                context.delegate({ childId: "writer", input: "slow" }).catch(() => undefined);
                throw new Error("lead exploded");
              },
            };
            return createAgent({ model: { provider: "mock", model: "test" }, provider });
          },
        },
        writer: { createAgent: () => hangingAgent() },
        other: { createAgent: () => hangingAgent() },
      },
    });
    await supervisor.delegateAsync({ childId: "other", input: "unrelated" });
    await assert.rejects(supervisor.delegate({ childId: "lead", input: "x" }));
    const [lead, writer, other] = supervisor.summary().children;
    assert.deepEqual(lead, { childId: "lead", attempts: 1, retries: 0, failures: 1, failureRadius: 1, outcome: "failed" });
    assert.equal(writer?.outcome, "running", "the nested descendant is still live");
    assert.equal(other?.failureRadius, 0, "an unrelated live child is not in the radius");
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});
