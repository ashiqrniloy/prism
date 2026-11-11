import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { agentRuntime } from "../agent-session/create-agent.js";
import { type AgentEvent, type ModelProvider, createAgent, providerDone, providerTextDelta, toolCallContent } from "../index.js";
import { createMockProvider } from "../testing/index.js";
import { providerPackage } from "../provider-kit/index.js";

async function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

function textProvider(text = "ok"): ModelProvider {
  return createMockProvider([providerTextDelta(text), providerDone()]);
}

function toolProvider(call: { id: string; name: string }): ModelProvider {
  let turn = 0;
  return {
    id: "mock",
    async *generate() {
      turn += 1;
      if (turn === 1) yield { type: "tool_call" as const, call: toolCallContent(call.id, call.name, {}) };
      yield providerDone();
    },
  };
}

describe("agent hooks (4b wiring)", () => {
  it("host_hooks_register_under_host_owner", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [textProvider()])],
      hooks: (hooks) => {
        hooks.on("turn.before", () => undefined);
        hooks.on("message.append", (message) => message);
      },
    });
    // The kernel registers its own skill-catalog hook; this test is about the host's.
    const registrations = agentRuntime(agent)
      .hooks.registrations()
      .filter((registration) => registration.owner !== "kernel");
    assert.equal(registrations.length, 2);
    for (const registration of registrations) assert.equal(registration.owner, "host");
    assert.deepEqual(registrations.map((registration) => registration.name).sort(), ["message.append", "turn.before"]);
  });

  it("host_hooks_throw_fails_create_agent", async () => {
    await assert.rejects(
      async () =>
        await createAgent({
          model: { provider: "mock", model: "demo" },
          packages: [providerPackage("test-provider", [textProvider()])],
          hooks: (hooks) => {
            hooks.on("turn.before", () => undefined);
            hooks.on("turn.before", () => undefined, { id: "dup" });
            hooks.on("turn.before", () => undefined, { id: "dup" });
          },
        }),
      /Duplicate hook registration id/,
    );
  });

  it("turn_fires_hooks_in_documented_order", async () => {
    const order: string[] = [];
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [textProvider()])],
      hooks: (hooks) => {
        hooks.on("turn.before", () => {
          order.push("turn.before");
          return undefined;
        });
        hooks.on("context.build", (draft) => {
          order.push("context.build");
          return draft;
        });
        hooks.on("model.request", (request) => {
          order.push("model.request");
          return request;
        });
        hooks.on("model.call", async (request, next) => {
          order.push("model.call");
          return next(request);
        });
        hooks.on("model.response", (message) => {
          order.push("model.response");
          return message;
        });
        hooks.on("message.append", (message) => {
          order.push("message.append");
          return message;
        });
      },
    });
    await (await agent.session()).run("Hi");
    assert.deepEqual(order, ["turn.before", "context.build", "model.request", "model.call", "model.response", "message.append"]);
  });

  it("execute_tools_fires_hooks_in_documented_order", async () => {
    const order: string[] = [];
    let executed = 0;
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [toolProvider({ id: "c1", name: "echo" })])],
      tools: {
        add: [
          {
            name: "echo",
            parameters: { type: "object" },
            execute: () => {
              executed += 1;
              return { toolCallId: "c1", name: "echo", value: "ok" };
            },
          },
        ],
      },
      hooks: (hooks) => {
        hooks.on("tool.call", () => {
          order.push("tool.call");
          return undefined;
        });
        hooks.on("tool.execute", async (payload, next) => {
          order.push("tool.execute");
          return next(payload);
        });
        hooks.on("tool.result", (result) => {
          order.push("tool.result");
          return result;
        });
        hooks.on("message.append", (message) => {
          order.push("message.append");
          return message;
        });
      },
    });
    await (await agent.session()).run("work");
    assert.equal(executed, 1);
    assert.deepEqual(order, ["message.append", "tool.call", "tool.execute", "tool.result", "message.append"]);
  });

  it("turn_before_stop_is_clean_and_resumable", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [textProvider()])],
      hooks: (hooks) => hooks.on("turn.before", () => ({ stop: "nothing to do" })),
    });
    const session = await agent.session();
    const reader = collect(session.subscribe());
    const result = await session.run("Hi");
    const events = await reader;
    assert.equal(result.status, "stopped");
    const finished = events.find((event): event is Extract<AgentEvent, { type: "run.completed" }> => event.type === "run.completed");
    assert.equal(finished?.stopReason, "hook_stop");
  });

  it("run_end_continue_is_capped", async () => {
    let continuations = 0;
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [textProvider()])],
      limits: { maxContinuations: 1 },
      hooks: (hooks) =>
        hooks.on("run.end", () => {
          continuations += 1;
          return { continue: { reason: "one more" } };
        }),
    });
    const session = await agent.session();
    const reader = collect(session.subscribe());
    const result = await session.run("Hi");
    const events = await reader;
    assert.equal(result.status, "stopped");
    assert.equal(continuations, 2, "first continues, second is refused by the cap");
    const finished = events.find((event): event is Extract<AgentEvent, { type: "run.completed" }> => event.type === "run.completed");
    assert.equal(finished?.stopReason, "hook_limit");
  });

  it("tool_call_deny_fails_closed_without_dispatching", async () => {
    let executed = 0;
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [toolProvider({ id: "c1", name: "echo" })])],
      tools: {
        add: [
          {
            name: "echo",
            parameters: { type: "object" },
            execute: () => {
              executed += 1;
              return { toolCallId: "c1", name: "echo", value: "ok" };
            },
          },
        ],
      },
      hooks: (hooks) => hooks.on("tool.call", () => ({ deny: "policy" })),
    });
    const session = await agent.session();
    await session.run("work");
    assert.equal(executed, 0);
    const blocks = (await session.entries()).flatMap((entry) => entry.message?.content ?? []);
    const denied = blocks.find((block) => block.type === "tool_result" && block.error !== undefined);
    assert.ok(denied && denied.type === "tool_result" && denied.error?.code === "hook_denied");
  });

  it("transform_dispatch_carries_run_identity", async () => {
    // Plan 191 follow-up: a transform payload is often a bare value (messages, a request), so the
    // dispatch supplies the run identity; a handler can then key per-run state.
    const seen: { hook: string; sessionId: string; runId: string }[] = [];
    const record =
      (hook: string) =>
      (_value: unknown, context: { sessionId: string; runId: string }): void => {
        seen.push({ hook, sessionId: context.sessionId, runId: context.runId });
      };
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [textProvider()])],
      hooks: (hooks) => {
        hooks.on("run.input", (messages, context) => {
          record("run.input")(messages, context);
          return messages;
        });
        hooks.on("message.append", (message, context) => {
          record("message.append")(message, context);
          return message;
        });
        hooks.on("context.build", (draft, context) => {
          record("context.build")(draft, context);
          return draft;
        });
        hooks.on("model.request", (request, context) => {
          record("model.request")(request, context);
          return request;
        });
        hooks.on("model.response", (message, context) => {
          record("model.response")(message, context);
          return message;
        });
      },
    });
    const session = await agent.session();
    const first = await session.run("Hi");
    const second = await session.run("Again");
    assert.deepEqual([...new Set(seen.map((entry) => entry.hook))].sort(), [
      "context.build",
      "message.append",
      "model.request",
      "model.response",
      "run.input",
    ]);
    for (const entry of seen) assert.equal(entry.sessionId, session.id, `${entry.hook} carries the session id`);
    assert.deepEqual(
      [...new Set(seen.map((entry) => entry.runId))].sort(),
      [first.runId, second.runId].sort(),
      "each dispatch carries its own run's id",
    );
    assert.ok(seen.filter((entry) => entry.runId === first.runId).length > 0, "the first run is attributed to itself");
    assert.ok(!seen.some((entry) => entry.runId === ""), "no transform dispatch falls back to an empty run id");
  });

  it("steer_run_input_carries_the_run_identity", async () => {
    const steered: { sessionId: string; runId: string }[] = [];
    let session: Awaited<ReturnType<typeof agent.session>> | undefined;
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [toolProvider({ id: "c1", name: "poke" })])],
      tools: {
        add: [
          {
            name: "poke",
            parameters: { type: "object" },
            execute: () => {
              session?.steer("more");
              return { toolCallId: "c1", name: "poke", value: "poked" };
            },
          },
        ],
      },
      hooks: (hooks) =>
        hooks.on("run.input", (messages, context) => {
          if (messages.some((message) => message.content.some((block) => block.type === "text" && block.text === "more"))) {
            steered.push({ sessionId: context.sessionId, runId: context.runId });
          }
          return messages;
        }),
    });
    session = await agent.session();
    const result = await session.run("work");
    assert.equal(steered.length, 1, "the steer passed run.input once");
    assert.deepEqual(steered[0], { sessionId: session.id, runId: result.runId });
  });

  it("run_input_transforms_start_messages", async () => {
    const seen: string[] = [];
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("test-provider", [textProvider()])],
      hooks: (hooks) =>
        hooks.on("run.input", (messages) => {
          seen.push(...messages.map((message) => message.content.map((block) => (block.type === "text" ? block.text : "")).join("")));
          return messages;
        }),
    });
    await (await agent.session()).run("Hello");
    assert.deepEqual(seen, ["Hello"]);
  });
});
