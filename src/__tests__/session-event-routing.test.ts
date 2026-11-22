/**
 * Plan 225 Task 3: an event a hook raises (`ctx.emit`, `hook.error`) is delivered to the session whose
 * dispatch raised it, and to no other. Before this task each session constructor replaced one agent-wide
 * sink, so the newest session received every session's hook events (evaluation probe `p1-sink`).
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { RuntimeAgentSession } from "../agent-session/session.js";
import {
  type Agent,
  type AgentEvent,
  type LoopStrategy,
  type Session,
  createAgent,
  createMemorySessionStore,
  definePackage,
  providerDone,
  providerTextDelta,
} from "../index.js";
import { mockProvider } from "../testing/index.js";

const model = { provider: "mock", model: "mock-model" } as const;
const tick = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Collects every event a session (or the agent) delivers until the test stops reading. */
function collect(source: AsyncIterable<AgentEvent>): { readonly events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  void (async () => {
    for await (const event of source) events.push(event);
  })().catch(() => undefined);
  return { events };
}

const probes = (events: readonly AgentEvent[]) =>
  events.filter(
    (event): event is Extract<AgentEvent, { type: "package.event" }> => event.type === "package.event" && event.name === "probe",
  );

const hookErrors = (events: readonly AgentEvent[]) => events.filter((event) => event.type === "hook.error");

interface Options {
  readonly slots?: { readonly loop?: LoopStrategy };
  readonly responses?: number;
}

/** Every `turn.started` raises a `probe` event naming the session that dispatched it. */
async function routingAgent(options: Options = {}): Promise<Agent> {
  const turns = options.responses ?? 4;
  return createAgent({
    model,
    ...(options.slots ? { slots: options.slots } : {}),
    packages: [mockProvider(Array.from({ length: turns }, () => [providerTextDelta("ok"), providerDone()]))],
    hooks: (hooks) => {
      hooks.on("turn.started", (payload, context) => {
        context.emit("probe", { session: payload.sessionId });
      });
      hooks.on("turn.completed", () => {
        throw new Error("observer boom");
      });
    },
  });
}

async function open(agent: Agent, id: string): Promise<{ readonly session: Session; readonly events: AgentEvent[] }> {
  const session = await agent.session({ id, create: true });
  return { session, events: collect(session.subscribe({ acrossRuns: true })).events };
}

describe("session event routing (plan 225 Task 3)", () => {
  it("hook_emit_reaches_its_own_session_stream", async () => {
    const agent = await routingAgent();
    const a = await open(agent, "a");
    // B opens after A: the old agent-wide sink now pointed at B.
    const b = await open(agent, "b");
    await a.session.run("hi");
    await tick();
    const own = probes(a.events);
    assert.equal(own.length, 1, "A's own stream carries the probe");
    assert.equal(own[0]?.sessionId, "a");
    assert.deepEqual(own[0]?.data, { session: "a" });
    assert.equal(probes(b.events).length, 0);
    await agent.dispose();
  });

  it("no_cross_session_event_delivery", async () => {
    const agent = await routingAgent();
    const a = await open(agent, "a");
    const b = await open(agent, "b");
    await a.session.run("only A runs");
    await tick();
    assert.deepEqual(
      b.events.filter((event) => event.type === "package.event" || event.type === "hook.error"),
      [],
      "B received nothing A's hooks raised",
    );
    assert.ok(a.events.some((event) => event.type === "run.completed"));
    await agent.dispose();
  });

  it("hook_error_routes_to_dispatching_session", async () => {
    const agent = await routingAgent();
    const a = await open(agent, "a");
    const b = await open(agent, "b");
    await a.session.run("hi");
    await tick();
    const errors = hookErrors(a.events);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.type === "hook.error" && errors[0].hook, "turn.completed");
    assert.equal(hookErrors(b.events).length, 0);
    await agent.dispose();
  });

  it("fork_and_later_sessions_do_not_steal_events", async () => {
    const agent = await routingAgent();
    const a = await open(agent, "a");
    await a.session.run("seed");
    const fork = await a.session.fork();
    const forkEvents = collect(fork.subscribe({ acrossRuns: true })).events;
    const c = await open(agent, "c");
    await tick();
    const before = probes(a.events).length;
    await a.session.run("again");
    await tick();
    assert.equal(probes(a.events).length, before + 1, "A still receives its own probe");
    assert.equal(probes(c.events).length, 0);
    assert.equal(probes(forkEvents).length, 0);
    await agent.dispose();
  });

  it("sessionless_package_event_reaches_agent_subscribers_only", async () => {
    let note: ((message: string) => void) | undefined;
    const agent = await createAgent({
      model,
      packages: [
        mockProvider([[providerTextDelta("ok"), providerDone()]]),
        definePackage<any>({
          name: "@acme/noter",
          version: "1.0.0",
          requires: { api: 2 },
          setup: (prism: any) => {
            note = (message) => prism.status.note("info", message);
            prism.hooks.on("package.status", (_payload: unknown, context: any) => {
              context.emit("seen", { ok: true });
            });
          },
        }),
      ],
    });
    const open1 = await open(agent, "a");
    const agentEvents = collect(agent.subscribe()).events;
    note?.("hello");
    await tick();
    assert.ok(
      agentEvents.some((event) => event.type === "package.event" && event.name === "seen"),
      "agent subscriber receives the observer's event",
    );
    assert.equal(
      open1.events.some((event) => event.type === "package.event" && event.name === "seen"),
      false,
      "no open session receives it",
    );
    await agent.dispose();
  });

  it("session_without_runtime_delivers_its_hook_events", async () => {
    const stub = { config: { model } } as unknown as Agent;
    const session = new RuntimeAgentSession({ agent: stub, id: "solo", store: createMemorySessionStore() });
    const events = collect(session.subscribe({ acrossRuns: true })).events;
    const bus = (session as unknown as { hookBusInstance: { registrar(owner: string): { on(name: string, handler: unknown): void } } })
      .hookBusInstance;
    bus.registrar("pkg").on("run.started", (_payload: unknown, context: { emit(name: string, data: unknown): void }) => {
      context.emit("probe", { own: true });
    });
    session.hooks().observe("run.started", { type: "run.started", sessionId: "solo", runId: "r1" } as never);
    await tick();
    assert.equal(probes(events).length, 1);
    await session.close();
  });

  it("routing_survives_reload", async () => {
    const agent = await routingAgent();
    const a = await open(agent, "a");
    const b = await open(agent, "b");
    await a.session.run("first");
    await agent.reload();
    await a.session.run("after reload");
    await tick();
    assert.equal(probes(a.events).length, 2);
    assert.equal(hookErrors(a.events).length, 2);
    assert.equal(probes(b.events).length, 0);
    await agent.dispose();
  });

  it("custom_loop_routes_the_same_way", async () => {
    const loop: LoopStrategy = {
      name: "one-turn",
      revision: "1",
      async run(run) {
        await run.turn();
      },
    };
    const agent = await routingAgent({ slots: { loop } });
    const a = await open(agent, "a");
    const b = await open(agent, "b");
    await a.session.run("hi");
    await tick();
    assert.equal(probes(a.events).length, 1);
    assert.equal(hookErrors(a.events).length, 1);
    assert.equal(probes(b.events).length + hookErrors(b.events).length, 0);
    await agent.dispose();
  });

  it("closed_session_receives_nothing_and_is_not_retained_by_the_agent", async () => {
    const agent = await routingAgent();
    const a = await open(agent, "a");
    const b = await open(agent, "b");
    await a.session.close();
    await b.session.run("hi");
    await tick();
    assert.equal(probes(a.events).length, 0);
    assert.equal(probes(b.events).length, 1);
    await agent.dispose();
  });
});
