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
