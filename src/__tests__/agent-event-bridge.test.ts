/**
 * Plan 106 Task 3 (R2): the AgentEvent → extension-bus bridge and the two session lifecycle
 * middleware dispatches. The bridge is opt-in host wiring (zero runtime cost when unused); the
 * lifecycle dispatches are one middleware call per session, not per turn.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentEvent, ExtensionEvent } from "../index.js";
import {
  createAgent,
  createExtensionEventBus,
  createExtensionKernel,
  createMiddlewareRegistry,
  createMockProvider,
  forwardAgentEvents,
  providerDone,
  providerTextDelta,
} from "../index.js";

function event(type: string, extra: Record<string, unknown> = {}): AgentEvent {
  return { type, sessionId: "session-1", runId: "run-1", ...extra } as unknown as AgentEvent;
}

/** Finite source: drains in order, then completes. */
function sourceOf(events: readonly AgentEvent[], onReturn?: () => void): AsyncIterable<AgentEvent> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
      let index = 0;
      return {
        next() {
          const value = index < events.length ? events[index] : undefined;
          index += 1;
          return Promise.resolve(
            value === undefined
              ? ({ value: undefined, done: true } as IteratorResult<AgentEvent>)
              : ({ value, done: false } as IteratorResult<AgentEvent>),
          );
        },
        return() {
          onReturn?.();
          return Promise.resolve({ value: undefined, done: true } as IteratorResult<AgentEvent>);
        },
      };
    },
  };
}

/** Open source: pushes keep flowing until `return()` is called, so a parked bridge stays parked. */
function openSource() {
  const queue: AgentEvent[] = [];
  let waiter: ((result: IteratorResult<AgentEvent>) => void) | undefined;
  let closed = false;
  const source: AsyncIterable<AgentEvent> = {
    [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
      return {
        next() {
          if (closed) return Promise.resolve({ value: undefined, done: true } as IteratorResult<AgentEvent>);
          const queued = queue.shift();
          if (queued) return Promise.resolve({ value: queued, done: false } as IteratorResult<AgentEvent>);
          return new Promise<IteratorResult<AgentEvent>>((resolve) => {
            waiter = resolve;
          });
        },
        return() {
          closed = true;
          waiter?.({ value: undefined, done: true } as IteratorResult<AgentEvent>);
          waiter = undefined;
          return Promise.resolve({ value: undefined, done: true } as IteratorResult<AgentEvent>);
        },
      };
    },
  };
  return {
    source,
    closed: () => closed,
    push(value: AgentEvent) {
      if (waiter) {
        const resolve = waiter;
        waiter = undefined;
        resolve({ value, done: false } as IteratorResult<AgentEvent>);
        return;
      }
      queue.push(value);
    },
  };
}

/** Bridge delivery is asynchronous by design; poll instead of sleeping a fixed amount. */
async function until(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
}

function mockProvider() {
  return createMockProvider([providerTextDelta("ok"), providerDone()]);
}

describe("agent event bridge (plan 106 Task 3)", () => {
  it("maps agent/turn/tool events to bus payloads in order and ignores the rest", async () => {
    const bus = createExtensionEventBus();
    const seen: { type: string; payload: unknown }[] = [];
    const slowTurn = async (e: ExtensionEvent) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      seen.push({ type: e.type, payload: e.payload });
    };
    bus.on("before_agent_start", (e) => {
      seen.push({ type: e.type, payload: e.payload });
    });
    bus.on("turn", slowTurn);
    bus.on("tool_call", (e) => {
      seen.push({ type: e.type, payload: e.payload });
    });
    bus.on("tool_result", (e) => {
      seen.push({ type: e.type, payload: e.payload });
    });
    bus.on("agent_finished", (e) => {
      seen.push({ type: e.type, payload: e.payload });
    });

    const agentStarted = event("agent_started");
    const turnStarted = event("turn_started", { turn: 1 });
    const toolStarted = event("tool_execution_started", { toolCallId: "t1", name: "echo" });
    const stop = forwardAgentEvents(
      sourceOf([
        agentStarted,
        turnStarted,
        event("agent_finished"),
        event("message_delta", { content: { type: "text", text: "x" } }),
        toolStarted,
        event("tool_execution_finished", { toolCallId: "t1", name: "echo" }),
      ]),
      bus,
    );

    await until(() => seen.length === 4, "all mapped events");
    assert.deepEqual(
      seen.map((entry) => entry.type),
      ["before_agent_start", "turn", "tool_call", "tool_result"],
      "mapped in source order, with the slow handler not reordering later events",
    );
    assert.equal(seen[1]?.payload, turnStarted, "payload is the original event, untransformed");
    assert.equal(seen[2]?.payload, toolStarted, "tool payload is the original event");
    stop();
  });

  it("unsubscribe stops forwarding and releases the source iterator", async () => {
    const bus = createExtensionEventBus();
    const seen: string[] = [];
    bus.on("turn", (e) => {
      seen.push(e.type);
    });
    const source = openSource();
    const stop = forwardAgentEvents(source.source, bus);

    source.push(event("turn_started"));
    await until(() => seen.length === 1, "first forwarded event");
    stop();
    assert.equal(source.closed(), true, "the bridge releases the source iterator");

    source.push(event("turn_finished"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(seen.length, 1, "nothing is forwarded after unsubscribe");
  });

  it("a throwing listener is reported through onError and never fails the run", async () => {
    // `errorPolicy: "throw"` is the strictest host setting: emit() rejects, so the bridge must catch.
    const kernel = createExtensionKernel({ errorPolicy: "throw" });
    const errors: unknown[] = [];
    const seen: string[] = [];
    kernel.events.on("turn", () => {
      throw new Error("listener boom");
    });
    kernel.events.on("tool_call", (e) => {
      seen.push(e.type);
    });

    const stop = forwardAgentEvents(sourceOf([event("turn_started"), event("tool_execution_started")]), kernel.events, {
      onError: (error) => {
        errors.push(error);
      },
    });

    await until(() => seen.length === 1, "later events still forwarded");
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /listener boom/);
    stop();
  });

  it("a throwing listener never fails the observed run", async () => {
    const kernel = createExtensionKernel({ errorPolicy: "throw" });
    const errors: unknown[] = [];
    kernel.events.on("turn", () => {
      throw new Error("listener boom");
    });
    const agent = createAgent({ model: { provider: "mock", model: "demo" }, provider: mockProvider() });
    const session = agent.createSession();
    const stop = forwardAgentEvents(session.subscribe(), kernel.events, {
      onError: (error) => {
        errors.push(error);
      },
    });

    const result = await session.run("hi");
    stop();
    assert.equal(result.status, "succeeded");
    await until(() => errors.length > 0, "the throwing listener was reported");
  });

  it("under the default error policy a throwing listener becomes an extension_error event", async () => {
    const kernel = createExtensionKernel();
    const reported: ExtensionEvent[] = [];
    kernel.events.on("extension_error", (e) => {
      reported.push(e);
    });
    kernel.events.on("turn", () => {
      throw new Error("listener boom");
    });

    const stop = forwardAgentEvents(sourceOf([event("turn_started")]), kernel.events);
    await until(() => reported.length === 1, "extension_error");
    assert.equal(reported[0]?.type, "extension_error");
    stop();
  });
});

describe("session lifecycle middleware (plan 106 Task 3)", () => {
  it("session_start runs once per session, not per run", async () => {
    const middleware = createMiddlewareRegistry();
    const starts: unknown[] = [];
    middleware.use("session_start", (payload) => {
      starts.push(payload);
      return payload;
    });
    const agent = createAgent({ model: { provider: "mock", model: "demo" }, provider: mockProvider(), middleware });

    const first = agent.createSession();
    const second = agent.createSession();
    const firstRun = await first.run("one");
    await first.run("two");
    assert.equal(starts.length, 1, "one dispatch across two runs of one session");
    assert.deepEqual(starts[0], { sessionId: first.id, runId: firstRun.runId });

    await second.run("three");
    assert.equal(starts.length, 2, "each session opens once");
  });

  it("a throwing session_start follows the middleware error policy and does not fail the run", async () => {
    const kernel = createExtensionKernel();
    const reported: ExtensionEvent[] = [];
    kernel.events.on("extension_error", (e) => {
      reported.push(e);
    });
    kernel.middleware.use("session_start", () => {
      throw new Error("start boom");
    });
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: mockProvider(),
      middleware: kernel.middleware,
    });

    const result = await agent.createSession().run("hi");
    assert.equal(result.status, "succeeded");
    assert.equal(reported.length, 1);
    assert.equal(reported[0]?.extension, "middleware:session_start");
  });

  it("session_shutdown runs once on close() and close() tears down subscribers", async () => {
    const middleware = createMiddlewareRegistry();
    const shutdowns: unknown[] = [];
    middleware.use("session_shutdown", (payload) => {
      shutdowns.push(payload);
      return payload;
    });
    const agent = createAgent({ model: { provider: "mock", model: "demo" }, provider: mockProvider(), middleware });
    const session = agent.createSession();
    const iterator = session.subscribe({ acrossRuns: true })[Symbol.asyncIterator]();
    await session.run("one");
    let last = await iterator.next();
    while (!last.done && last.value.type !== "agent_finished") last = await iterator.next();

    await session.close();
    await session.close();
    assert.equal(shutdowns.length, 1, "close() is idempotent");
    assert.deepEqual(shutdowns[0], { sessionId: session.id });
    assert.equal((await iterator.next()).done, true, "close() tore down the acrossRuns subscriber");
  });
});
