import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { AgentEvent, Session, Message, ProviderRequest, ToolCallContent, ToolResult } from "../contracts.js";
import { createHookBus } from "../hooks/index.js";
import { createRunController, defaultLoop, type RunControllerInternals } from "../loop/index.js";
import type { RunTurnOptions } from "../loop/types.js";
import { resolveRunLimits, RunLimitTracker } from "../run-limits.js";

function makeInternals(overrides: Partial<RunControllerInternals> = {}) {
  const order: string[] = [];
  const events: AgentEvent[] = [];
  const history: Message[] = [];
  const turnOptions: (RunTurnOptions | undefined)[] = [];
  const dispatched: ToolCallContent[] = [];
  const continuations: string[] = [];
  const bus = createHookBus();
  const hooks = { ...bus, on: bus.registrar("test").on };
  let finishReason: import("../contracts.js").AgentFinishReason | undefined;
  let generated = 0;
  const internals: RunControllerInternals = {
    session: { id: "s" } as unknown as Session,
    input: "hi",
    signal: new AbortController().signal,
    limits: new RunLimitTracker(resolveRunLimits(undefined, undefined)),
    hooks,
    sessionId: "s",
    runId: "r",
    loopOwner: "kernel",
    model: { provider: "mock", model: "demo" },
    metadata: {},
    history,
    inputMessages: [],
    maxToolRounds: Number.POSITIVE_INFINITY,
    maxContinuations: null,
    emit: (event) => events.push(event),
    assemble: async (_next, _turn, options) => {
      order.push("assemble");
      turnOptions.push(options);
      return { model: { provider: "x", model: "y" }, messages: [] } satisfies ProviderRequest;
    },
    generate: async () => {
      order.push("generate");
      generated += 1;
      return { content: [], calls: [], messageId: "m", started: true, usage: undefined };
    },
    chargeToolRound: () => {},
    dispatchToolCall: async (call) => {
      dispatched.push(call);
      return { toolCallId: call.id, name: call.name, value: "ok" } satisfies ToolResult;
    },
    isToolCallExclusive: () => false,
    effectsFor: () => ["read"],
    appendMessage: async () => {},
    externalState: () => ({ append: async () => {}, load: async () => [] }),
    applyPendingSteers: async () => false,
    queueContinuation: (decision) => continuations.push(decision.reason),
    setFinishReason: (reason) => {
      finishReason = reason;
    },
    finishReason: () => finishReason,
    usage: () => undefined,
    ...overrides,
  };
  return {
    internals,
    order,
    events,
    history,
    turnOptions,
    dispatched,
    continuations,
    hooks,
    generated: () => generated,
  };
}

describe("RunController", () => {
  it("run_controller_exposes_only_primitives", () => {
    const { internals } = makeInternals();
    const controller = createRunController(internals);
    assert.deepEqual(Object.keys(controller).sort(), [
      "append",
      "ask",
      "emit",
      "end",
      "executeTools",
      "input",
      "limits",
      "model",
      "observe",
      "session",
      "signal",
      "state",
      "steers",
      "turn",
    ]);
  });

  it("turn_fires_hooks_in_documented_order", async () => {
    const { internals, order, hooks } = makeInternals();
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
    hooks.on("model.response", (message) => {
      order.push("model.response");
      return message;
    });
    hooks.on("message.append", (message) => {
      order.push("message.append");
      return message;
    });
    const controller = createRunController(internals);
    await controller.turn();
    assert.deepEqual(order, ["turn.before", "assemble", "context.build", "model.request", "generate", "model.response", "message.append"]);
  });

  it("execute_tools_fires_hooks_in_documented_order", async () => {
    const { internals, order, hooks, dispatched } = makeInternals();
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
    const controller = createRunController(internals);
    await controller.executeTools([{ type: "tool_call", id: "c1", name: "read", arguments: {} }]);
    assert.deepEqual(order, ["tool.call", "tool.execute", "tool.result", "message.append"]);
    assert.equal(dispatched.length, 1);
  });

  it("turn_tools_false_sends_no_tools_and_list_narrows", async () => {
    const { internals, turnOptions } = makeInternals();
    const controller = createRunController(internals);
    await controller.turn({ tools: false });
    await controller.turn({ tools: ["a", "b"] });
    assert.equal(turnOptions[0]?.tools, false);
    assert.deepEqual(turnOptions[1]?.tools, ["a", "b"]);
  });

  it("turn_before_stop_is_clean_and_resumable", async () => {
    const { internals, hooks, generated } = makeInternals();
    hooks.on("turn.before", () => ({ stop: "done" }));
    const controller = createRunController(internals);
    const result = await controller.turn();
    assert.equal(result.stopped, true);
    assert.equal(result.finishReason, "hook_stop");
    assert.equal(internals.finishReason(), "hook_stop");
    assert.equal(generated(), 0);
  });

  it("run_end_continue_capped", async () => {
    const { internals, hooks, continuations } = makeInternals({ maxContinuations: 1 });
    hooks.on("run.end", () => ({ continue: { reason: "more" } }));
    const controller = createRunController(internals);
    assert.deepEqual(await controller.end(), { continue: true, reason: "more" });
    assert.deepEqual(continuations, ["more"]);
    assert.deepEqual(await controller.end(), { continue: false });
    assert.equal(internals.finishReason(), "hook_limit");
  });
});

describe("RunController driver surface (K2 first half)", () => {
  const call = (id: string): ToolCallContent => ({ type: "tool_call", id, name: "read", arguments: {} });

  it("loop_cannot_emit_catalog_event", () => {
    const { internals, events } = makeInternals();
    const controller = createRunController(internals);
    assert.throws(() => controller.emit("tool.completed", {}), { code: "emit_reserved_name" });
    assert.throws(() => controller.emit("package.event", {}), { code: "emit_reserved_name" });
    assert.equal(events.length, 0);
    controller.emit("x.y", { n: 1 });
    assert.deepEqual(events, [{ type: "package.event", sessionId: "s", runId: "r", package: "kernel", name: "x.y", data: { n: 1 } }]);
  });

  it("emit_is_owned_by_the_loop_slot_owner", () => {
    const { internals, events } = makeInternals({ loopOwner: "@scope/ext-loop" });
    createRunController(internals).emit("a.b", null);
    assert.equal((events[0] as { package: string }).package, "@scope/ext-loop");
  });

  it("hook_context_cannot_emit_catalog_event", () => {
    const events: AgentEvent[] = [];
    const bus = createHookBus({ onEvent: (event) => events.push(event) });
    let failure: unknown;
    bus.registrar("pkg-a").on("run.started", (_payload, ctx) => {
      ctx.emit("my.event", { ok: true });
      try {
        ctx.emit("tool.completed", {});
      } catch (error) {
        failure = error;
      }
    });
    bus.observe("run.started", { type: "run.started", sessionId: "s", runId: "r" } as never);
    assert.equal((failure as { code?: string }).code, "emit_reserved_name");
    assert.deepEqual(events, [
      { type: "package.event", sessionId: "s", runId: "r", package: "pkg-a", name: "my.event", data: { ok: true } },
    ]);
  });

  it("execute_tools_returns_results_in_order", async () => {
    const { internals, hooks } = makeInternals();
    hooks.on("tool.call", (payload) => (payload.callId === "c2" ? { deny: "no" } : undefined));
    const controller = createRunController(internals);
    const results = await controller.executeTools([call("c1"), call("c2"), call("c3")]);
    assert.deepEqual(
      results.map((result) => [result.toolCallId, result.error?.code ?? result.value]),
      [
        ["c1", "ok"],
        ["c2", "hook_denied"],
        ["c3", "ok"],
      ],
    );
  });

  it("execute_tools_returns_approval_pending_marker_in_place", async () => {
    const { internals, hooks } = makeInternals({
      ask: async (requests) => new Map(requests.map((request) => [request.call.id, { kind: "suspend" as const }])),
    });
    hooks.on("tool.call", (payload) => (payload.callId === "c1" ? { ask: "confirm" } : undefined));
    const results = await createRunController(internals).executeTools([call("c1"), call("c2")]);
    assert.equal((results[0]!.metadata as { approvalPending?: boolean }).approvalPending, true);
    assert.equal(results[1]!.value, "ok");
  });

  it("concurrent_execute_tools_fires_tool_call", async () => {
    const { internals, hooks, dispatched, history } = makeInternals({
      appendMessage: async () => {},
    });
    const seen: string[] = [];
    hooks.on("tool.call", (payload) => {
      seen.push(payload.callId);
      return undefined;
    });
    const controller = createRunController(internals);
    const [a, b] = await Promise.all([
      controller.executeTools([call("a1"), call("a2")]),
      controller.executeTools([call("b1")], { concurrency: 2 }),
    ]);
    assert.deepEqual([...seen].sort(), ["a1", "a2", "b1"]);
    assert.equal(a.length, 2);
    assert.equal(b.length, 1);
    assert.equal(dispatched.length, 3);
    assert.equal(history.length, 3);
  });

  it("execute_tools_origin_reaches_payload_and_dispatch", async () => {
    const origins: unknown[] = [];
    const { internals, hooks } = makeInternals({
      dispatchToolCall: async (c, origin) => {
        origins.push(origin);
        return { toolCallId: c.id, name: c.name, value: "ok" };
      },
    });
    const payloadOrigins: unknown[] = [];
    hooks.on("tool.call", (payload) => {
      payloadOrigins.push(payload.origin);
      return undefined;
    });
    const origin = { kind: "external" as const, agent: "ext", agentId: "a1", depth: 0 };
    const controller = createRunController(internals);
    await controller.executeTools([call("c1")], { origin });
    await controller.executeTools([call("c2")]);
    assert.deepEqual(payloadOrigins, [origin, undefined]);
    assert.deepEqual(origins, [origin, undefined]);
  });

  it("a_throwing_tool_call_hook_denies_only_that_call_in_a_concurrent_round", async () => {
    const { internals, hooks } = makeInternals();
    hooks.on("tool.call", (payload) => {
      if (payload.callId === "bad") throw new Error("boom");
      return undefined;
    });
    const controller = createRunController(internals);
    const [bad, good] = await Promise.all([controller.executeTools([call("bad")]), controller.executeTools([call("good")])]);
    assert.equal(bad[0]!.error?.code, "hook_denied");
    assert.equal(good[0]!.value, "ok");
  });
});

describe("defaultLoop", () => {
  it("default_loop_matches_single_shot_behavior", async () => {
    let turn = 0;
    const { internals, dispatched } = makeInternals();
    internals.assemble = async () => ({ model: { provider: "x", model: "y" }, messages: [] }) satisfies ProviderRequest;
    internals.generate = async () => {
      turn += 1;
      return turn === 1
        ? { content: [], calls: [{ type: "tool_call", id: "c1", name: "read", arguments: {} }], messageId: "m1", started: true }
        : { content: [], calls: [], messageId: "m2", started: true };
    };
    const controller = createRunController(internals);
    await defaultLoop.run(controller);
    assert.equal(turn, 2);
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0]?.name, "read");
  });
});
