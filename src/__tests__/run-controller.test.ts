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
      "emit",
      "end",
      "executeTools",
      "input",
      "limits",
      "session",
      "signal",
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
    assert.deepEqual(await controller.end(), { continue: true });
    assert.deepEqual(continuations, ["more"]);
    assert.deepEqual(await controller.end(), { continue: false });
    assert.equal(internals.finishReason(), "hook_limit");
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
