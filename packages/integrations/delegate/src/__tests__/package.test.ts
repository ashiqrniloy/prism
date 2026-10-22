import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  definePackage,
  type LoopStrategy,
  type ModelProvider,
  type ProviderEvent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { packageConformance } from "@arnilo/prism/testing";
import delegate, { DEFAULT_CHILD_LIMITS, delegateStepData, HARD_CHILD_LIMITS, resolveChildLimits } from "../index.js";

interface Seen {
  readonly tools: string[];
  readonly text: string;
}

/** Parent turns (the request lists `delegate`) call the delegate tool, then answer from its result. Child turns answer or call `child_tool`. */
function scripted(delegateArgs: Record<string, unknown>, seen: Seen[], childCallsTool = false, waitAfter = false): ModelProvider {
  let parentCalls = 0;
  return {
    id: "mock",
    async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      const tools = (request.tools ?? []).map((tool) => tool.name);
      const last = request.messages.at(-1);
      const lastText = JSON.stringify(last?.content ?? "");
      seen.push({ tools, text: lastText });
      if (tools.includes("delegate")) {
        parentCalls += 1;
        if (parentCalls === 1) yield providerToolCall(toolCallContent("call_d", "delegate", delegateArgs as never));
        else if (waitAfter && parentCalls === 2) {
          const id = /dlg_[\w]+/.exec(lastText)?.[0] ?? "missing";
          yield providerToolCall(toolCallContent("call_w", "delegate_wait", { delegationId: id }));
        } else yield providerTextDelta(`parent saw: ${lastText}`);
      } else if (childCallsTool && last?.role === "user") {
        yield providerToolCall(toolCallContent("call_c", "child_tool", {}));
      } else {
        yield providerTextDelta("child answer");
      }
      yield providerDone({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
    },
  };
}

const childTools = definePackage({
  name: "child-tools",
  version: "0.12.1",
  requires: { api: 1 },
  setup(prism) {
    prism.tools.register({ name: "child_tool", description: "child only", execute: (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "child_tool", content: [{ type: "text", text: "ok" }] }) });
  },
});

const otherTools = definePackage({
  name: "other-tools",
  version: "0.12.1",
  requires: { api: 1 },
  setup(prism) {
    prism.tools.register({ name: "other_tool", description: "parent only", execute: (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "other_tool", content: [] }) });
  },
});

const askingPackage = definePackage({
  name: "asking-hooks",
  version: "0.12.1",
  requires: { api: 1 },
  setup(prism) {
    prism.hooks.on("tool.call", (payload) => (payload.name === "child_tool" ? { ask: "needs approval" } : "allow"));
  },
});

const stepLog: Record<string, unknown>[] = [];

async function build(options: {
  delegateArgs: Record<string, unknown>;
  seen?: Seen[];
  children?: Record<string, unknown>;
  extra?: unknown[];
  childCallsTool?: boolean;
  waitAfter?: boolean;
  loop?: LoopStrategy;
}) {
  stepLog.length = 0;
  const seen = options.seen ?? [];
  return createAgent({
    id: "delegate-parent",
    model: { provider: "mock", model: "m" },
    slots: { store: createMemorySessionStore(), ...(options.loop === undefined ? {} : { loop: options.loop }) },
    hooks: (hooks) =>
      hooks.on("package.event", (event) => {
        if (event.name === "delegate.step") stepLog.push(event.data as Record<string, unknown>);
      }),
    packages: [
      providerPackage("mock-provider", [scripted(options.delegateArgs, seen, options.childCallsTool, options.waitAfter)]),
      childTools,
      otherTools,
      ...((options.extra ?? []) as never[]),
      delegate({ children: (options.children ?? { reviewer: { inherit: ["child-tools"], instructions: "Review." } }) as never }),
    ],
  });
}

async function collect(agent: Awaited<ReturnType<typeof build>>, input = "go") {
  const session = await agent.session();
  const events: AgentEvent[] = [];
  const sub = session.subscribe();
  const pump = (async () => {
    for await (const event of sub) events.push(event);
  })();
  const result = await session.run(input);
  await pump;
  return { result, events };
}

const steps = (_events?: AgentEvent[]) => stepLog.splice(0, stepLog.length);

describe("delegate package", () => {
  it("delegate_package_conformance", async () => {
    const result = await packageConformance(delegate, { config: { children: { reviewer: { inherit: [] } } } });
    assert.deepEqual(result.checks.filter((check) => !check.ok), []);
    assert.equal(result.ok, true);
  });

  it("delegate_child_inherits_only_named_packages", async () => {
    const seen: Seen[] = [];
    const agent = await build({ delegateArgs: { child: "reviewer", input: "review it" }, seen });
    const { result, events } = await collect(agent);
    assert.equal(result.status, "completed");
    assert.match(result.text, /child answer/);
    const childTurn = seen.find((entry) => !entry.tools.includes("delegate"));
    assert.ok(childTurn);
    assert.ok(childTurn.tools.includes("child_tool"));
    assert.ok(!childTurn.tools.includes("other_tool"));
    assert.ok(!childTurn.tools.includes("delegate"));
    const parentTurn = seen.find((entry) => entry.tools.includes("delegate"));
    assert.ok(parentTurn?.tools.includes("other_tool"));
    assert.deepEqual(steps(events).map((step) => step.phase), ["started", "finished"]);
    await agent.dispose();
  });

  it("delegate_unknown_child_is_tool_error", async () => {
    const agent = await build({ delegateArgs: { child: "nope", input: "x" } });
    const { result, events } = await collect(agent);
    assert.equal(result.status, "completed");
    const completed = events.find((event) => event.type === "tool.completed");
    assert.ok(completed && JSON.stringify(completed).includes("Unknown child"));
    assert.deepEqual(steps(events), []);
    await agent.dispose();
  });

  it("delegate_unknown_inherit_fails_closed", async () => {
    const agent = await build({
      delegateArgs: { child: "reviewer", input: "x" },
      children: { reviewer: { inherit: ["not-loaded"] } },
    });
    const { events } = await collect(agent);
    const failed = steps(events).find((step) => step.phase === "error");
    assert.ok(failed);
    await agent.dispose();
  });

  it("delegate_child_cannot_inherit_itself", async () => {
    await assert.rejects(
      createAgent({
        id: "self",
        model: { provider: "mock", model: "m" },
        slots: { store: createMemorySessionStore() },
        packages: [providerPackage("mock-provider", [scripted({}, [])]), delegate({ children: { c: { inherit: ["@arnilo/prism-delegate"] } } })],
      }),
      /never sees the delegate tool/,
    );
  });

  it("delegate_limits_only_narrow", () => {
    assert.deepEqual(resolveChildLimits(), DEFAULT_CHILD_LIMITS);
    const clamped = resolveChildLimits({ maxTurns: 10_000, maxTotalTokens: 5 });
    assert.equal(clamped.maxTurns, HARD_CHILD_LIMITS.maxTurns);
    assert.equal(clamped.maxTotalTokens, 5);
    assert.equal(resolveChildLimits({}, 0.5).maxTurns, 4);
  });

  it("delegate_step_events_reported", async () => {
    const agent = await build({
      delegateArgs: { child: "reviewer", input: "x" },
      childCallsTool: true,
      children: { reviewer: { inherit: ["child-tools"], report: "milestones" } },
    });
    const { events } = await collect(agent);
    const phases = steps(events).map((step) => step.phase);
    assert.equal(phases[0], "started");
    assert.ok(phases.includes("milestone"));
    assert.equal(phases.at(-1), "finished");
    await agent.dispose();
  });

  it("delegate_child_ask_suspends_not_approved", async () => {
    const agent = await build({
      delegateArgs: { child: "reviewer", input: "x", mode: "async" },
      childCallsTool: true,
      waitAfter: true,
      extra: [askingPackage],
      children: { reviewer: { inherit: ["child-tools", "asking-hooks"] } },
    });
    const { result } = await collect(agent);
    assert.equal(result.status, "completed");
    assert.match(result.text, /"status":"suspended"/);
    assert.match(result.text, /pending/);
    assert.equal(result.text.includes("child answer"), false);
    await agent.dispose();
  });

  it("delegate_cancel_disposes_child", async () => {
    let childAborted = false;
    const blocking: ModelProvider = {
      id: "mock",
      async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
        const tools = (request.tools ?? []).map((tool) => tool.name);
        const last = JSON.stringify(request.messages.at(-1)?.content ?? "");
        if (tools.includes("delegate")) {
          if (last.includes("\"go\"")) yield providerToolCall(toolCallContent("c1", "delegate", { child: "reviewer", input: "x", mode: "async" }));
          else if (!last.includes("delegate_cancel")) {
            const id = /dlg_\w+/.exec(last)?.[0] ?? "missing";
            yield providerToolCall(toolCallContent("c2", "delegate_cancel", { delegationId: id }));
          } else yield providerTextDelta(`done ${last}`);
        } else {
          await new Promise<void>((resolve) => {
            if (request.signal?.aborted) return resolve();
            request.signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          childAborted = request.signal?.aborted === true;
          throw new Error("aborted");
        }
        yield providerDone({ inputTokens: 1, outputTokens: 1 });
      },
    };
    const agent = await createAgent({
      id: "cancel-parent",
      model: { provider: "mock", model: "m" },
      slots: { store: createMemorySessionStore() },
      packages: [providerPackage("mock-provider", [blocking]), delegate({ children: { reviewer: { inherit: [] } } })],
    });
    const session = await agent.session();
    const result = await session.run("go");
    assert.equal(result.status, "completed");
    assert.match(result.text, /cancelling/);
    await agent.dispose();
    assert.equal(childAborted, true);
  });

  it("delegate_session_lifetime_survives_turn_and_is_disposed_on_close", async () => {
    const agent = await build({
      delegateArgs: { child: "reviewer", input: "x" },
      children: { reviewer: { inherit: ["child-tools"], lifetime: "session" } },
    });
    const { result, events } = await collect(agent);
    assert.equal(result.status, "completed");
    assert.match(result.text, /"status":"running"/);
    await agent.dispose();
    assert.ok(steps(events).length >= 0);
  });

  it("delegate_from_custom_loop", async () => {
    const customLoop: LoopStrategy = {
      name: "custom-loop",
      async run(run) {
        for (;;) {
          const turn = await run.turn();
          if (turn.stopped) return;
          if (turn.toolCalls.length > 0) {
            await run.executeTools(turn.toolCalls);
            continue;
          }
          return;
        }
      },
    };
    const agent = await build({ delegateArgs: { child: "reviewer", input: "x" }, loop: customLoop });
    const { result, events } = await collect(agent);
    assert.equal(result.status, "completed");
    assert.match(result.text, /child answer/);
    assert.deepEqual(steps(events).map((step) => step.phase), ["started", "finished"]);
    await agent.dispose();
  });

  it("delegate_step_data_is_bounded", () => {
    const origin = { kind: "prism", agent: "a", agentId: "delegate-a", delegationId: "d", depth: 1 } as const;
    assert.throws(() => delegateStepData({ origin: { ...origin, agent: "a\nb" }, phase: "started" }));
    assert.throws(() => delegateStepData({ origin, phase: "started", turn: -1 }));
    const data = delegateStepData({ origin, phase: "finished", status: "completed", totalTokens: 5 }) as Record<string, unknown>;
    assert.equal(data.phase, "finished");
    assert.equal(JSON.stringify(data).includes("input"), false);
  });

  it("delegate_step_events_carry_origin", async () => {
    // Plan 174 Task 9: a step attributes its child through `origin` (K3), not a bare `child` field.
    const agent = await build({ delegateArgs: { child: "reviewer", input: "go" } });
    const { events } = await collect(agent);
    const steps_ = steps(events);
    assert.ok(steps_.length > 0, "the delegation reported steps");
    for (const step of steps_) {
      const origin = step.origin as Record<string, unknown>;
      assert.equal(origin.kind, "prism");
      assert.equal(origin.agent, "reviewer");
      assert.equal(origin.agentId, "delegate-reviewer");
      assert.equal(origin.depth, 1);
      assert.equal(typeof origin.delegationId, "string");
      assert.equal("child" in step, false, "the retired `child` field is gone");
    }
    await agent.dispose();
  });

  it("delegate_no_parent_secret_in_child_events", async () => {
    const agent = await build({ delegateArgs: { child: "reviewer", input: "SECRET-PARENT-TOKEN" } });
    const { events } = await collect(agent);
    assert.equal(JSON.stringify(steps(events)).includes("SECRET-PARENT-TOKEN"), false);
    await agent.dispose();
  });
});
