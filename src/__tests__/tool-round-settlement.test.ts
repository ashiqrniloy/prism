/**
 * Plan 225 Task 4: every tool call of an assistant message has one tool result in the branch once its
 * round ends, however the round ends (evaluation probe `p2-orphan`: a `maxToolCalls` breach left three
 * calls and one result, and the next run sent that history unchanged).
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  type Agent,
  type AgentConfig,
  type AgentEvent,
  type LoopStrategy,
  type Message,
  type ModelProvider,
  type RunLimits,
  type Session,
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";
import { assertToolRoundSettlement } from "../testing/index.js";

const model = { provider: "mock", model: "demo" } as const;
const IDS = ["c1", "c2", "c3"] as const;

/** Turn 1 asks for `calls`; every later turn answers in text (or repeats `calls` when `repeat`). */
function provider(calls: readonly string[] = IDS, repeat = false): ModelProvider {
  let turn = 0;
  return {
    id: "mock",
    async *generate() {
      turn += 1;
      if (turn === 1 || repeat) {
        for (const id of calls) yield { type: "tool_call" as const, call: toolCallContent(repeat ? `${id}-t${turn}` : id, "echo", {}) };
        yield providerDone();
        return;
      }
      yield providerTextDelta("done");
      yield providerDone();
    },
  };
}

interface Fixture {
  readonly agent: Agent;
  readonly session: Session;
  readonly executed: string[];
  readonly events: AgentEvent[];
}

async function fixture(
  options: {
    readonly provider?: ModelProvider;
    readonly loop?: LoopStrategy;
    readonly limits?: RunLimits;
    readonly hooks?: AgentConfig["hooks"];
    readonly host?: AgentConfig["host"];
    readonly onExecute?: (id: string, session: () => Session) => void;
  } = {},
): Promise<Fixture> {
  const executed: string[] = [];
  let current: Session | undefined;
  const agent = await createAgent({
    model,
    packages: [providerPackage("settlement-provider", [options.provider ?? provider()])],
    slots: { store: createMemorySessionStore(), ...(options.loop ? { loop: options.loop } : {}) },
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.hooks ? { hooks: options.hooks } : {}),
    ...(options.host ? { host: options.host } : {}),
    tools: {
      add: [
        {
          name: "echo",
          parameters: {},
          execute: (_args, context) => {
            executed.push(context.toolCallId);
            options.onExecute?.(context.toolCallId, () => current!);
            return { toolCallId: context.toolCallId, name: "echo", value: `ran ${context.toolCallId}` };
          },
        },
      ],
    },
  });
  const session = await agent.session({ id: "s", create: true });
  current = session;
  const events: AgentEvent[] = [];
  void (async () => {
    for await (const event of session.subscribe({ acrossRuns: true })) events.push(event);
  })().catch(() => undefined);
  return { agent, session, executed, events };
}

interface Row {
  readonly id: string;
  readonly code: string | undefined;
}

function results(messages: readonly Message[]): Row[] {
  const rows: Row[] = [];
  for (const message of messages)
    for (const block of message.content)
      if (block.type === "tool_result")
        rows.push({ id: block.toolCallId, code: block.error?.code === undefined ? undefined : String(block.error.code) });
  return rows;
}

function calls(messages: readonly Message[]): string[] {
  return messages.flatMap((message) =>
    message.role === "assistant" ? message.content.flatMap((block) => (block.type === "tool_call" ? [block.id] : [])) : [],
  );
}

function assertAllAnswered(messages: readonly Message[]): void {
  const answered = new Map<string, number>();
  for (const row of results(messages)) answered.set(row.id, (answered.get(row.id) ?? 0) + 1);
  for (const id of calls(messages)) assert.equal(answered.get(id), 1, `call ${id} has exactly one result`);
}

const tick = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("tool round settlement (plan 225 Task 4)", () => {
  it("serial_round_limit_breach_settles_every_call", async () => {
    const { agent, session, executed } = await fixture({ limits: { maxToolCalls: 1 } });
    const result = await session.run("go");
    assert.equal(result.status, "failed");
    assert.equal(result.limit?.limit, "maxToolCalls");
    const messages = await session.messages();
    assertAllAnswered(messages);
    assert.deepEqual(executed, ["c1"], "the calls after the breach never ran");
    const rows = results(messages);
    assert.equal(rows.find((row) => row.id === "c1")?.code, undefined);
    assert.equal(rows.find((row) => row.id === "c3")?.code, "tool_call_not_dispatched");
    await agent.dispose();
  });

  it("round_charge_breach_settles_every_call", async () => {
    // A loop that runs two rounds: the second round's charge breaches `maxToolRounds` before any call.
    const loop: LoopStrategy = {
      name: "two-rounds",
      async run(run) {
        const turn = await run.turn();
        await run.executeTools(turn.toolCalls.slice(0, 1));
        await run.executeTools(turn.toolCalls.slice(1));
      },
    };
    const { agent, session, executed } = await fixture({ loop, limits: { maxToolRounds: 1 } });
    const result = await session.run("go");
    assert.equal(result.status, "failed");
    assert.equal(result.limit?.limit, "maxToolRounds");
    assertAllAnswered(await session.messages());
    assert.deepEqual(executed, ["c1"]);
    await agent.dispose();
  });

  it("tool_round_ceiling_stop_settles_calls", async () => {
    const { agent, session } = await fixture({ provider: provider(["a"], true), limits: { maxToolRounds: 1 } });
    const result = await session.run("go");
    assert.equal(result.stopReason, "turn_limit");
    const messages = await session.messages();
    assertAllAnswered(messages);
    assert.equal(results(messages).at(-1)?.code, "tool_call_not_dispatched");
    await agent.dispose();
  });

  it("abort_between_gate_and_dispatch_settles_calls", async () => {
    let session: Session | undefined;
    const fx = await fixture({
      hooks: (hooks) =>
        hooks.on("tool.call", () => {
          session?.abort(new Error("stop"));
          return undefined;
        }),
    });
    session = fx.session;
    const result = await session.run("go");
    assert.equal(result.status, "aborted");
    assert.deepEqual(fx.executed, []);
    const messages = await session.messages();
    assertAllAnswered(messages);
    assert.deepEqual(
      results(messages).map((row) => row.code),
      ["tool_call_not_dispatched", "tool_call_not_dispatched", "tool_call_not_dispatched"],
    );
    await fx.agent.dispose();
  });

  it("gate_phase_throw_settles_calls", async () => {
    // `askEveryTool` stages every call; a `host.ui` that throws raises out of the gate phase, before dispatch.
    const { agent, session, executed } = await fixture({
      hooks: askEveryTool(),
      host: {
        ui: {
          request: async () => {
            throw new Error("ui boom");
          },
        } as never,
      },
    });
    const result = await session.run("go");
    assert.equal(result.status, "failed");
    assert.deepEqual(executed, [], "the round is gated before any call runs");
    assertAllAnswered(await session.messages());
    await agent.dispose();
  });

  it("serial_round_stops_after_abort", async () => {
    const { agent, session, executed } = await fixture({
      onExecute: (id, current) => {
        if (id === "c1") current().abort(new Error("stop after c1"));
      },
    });
    const result = await session.run("go");
    assert.equal(result.status, "aborted");
    assert.deepEqual(executed, ["c1"], "calls 2 and 3 never start");
    const messages = await session.messages();
    assertAllAnswered(messages);
    assert.deepEqual(
      results(messages).map((row) => row.code),
      [undefined, "tool_call_not_dispatched", "tool_call_not_dispatched"],
    );
    await agent.dispose();
  });

  it("dispose_results_are_appended", async () => {
    let agentRef: Agent | undefined;
    const loop: LoopStrategy = {
      name: "dispose-first",
      async run(run) {
        const turn = await run.turn();
        void agentRef?.dispose();
        await tick();
        await run.executeTools(turn.toolCalls);
      },
    };
    const fx = await fixture({ loop });
    agentRef = fx.agent;
    await fx.session.run("go").catch(() => undefined);
    const messages = await fx.session.messages().catch(() => [] as readonly Message[]);
    assertAllAnswered(messages);
    assert.deepEqual(
      results(messages).map((row) => row.code),
      ["agent_disposed", "agent_disposed", "agent_disposed"],
    );
    assert.deepEqual(fx.executed, []);
  });

  it("custom_loop_that_drops_tool_calls_is_settled_at_run_end", async () => {
    const loop: LoopStrategy = {
      name: "drops-calls",
      async run(run) {
        await run.turn();
      },
    };
    const { agent, session } = await fixture({ loop });
    const result = await session.run("go");
    assert.equal(result.status, "completed");
    const messages = await session.messages();
    assertAllAnswered(messages);
    assert.equal(results(messages).length, 3);
    await agent.dispose();
  });

  it("approval_pending_call_is_not_settled", async () => {
    const { agent, session } = await fixture({ provider: provider(["c1"]), hooks: askEveryTool() });
    const result = await session.run("go");
    assert.equal(result.status, "suspended");
    assert.deepEqual(results(await session.messages()), [], "the staged call keeps no result until resume");
    const resumed: AgentEvent[] = [];
    for await (const event of session.resume(result.pending!.map((p) => ({ approvalId: p.approvalId, outcome: "allow_once" as const })))) {
      resumed.push(event);
    }
    assert.equal(resumed.at(-1)?.type, "run.completed");
    assertAllAnswered(await session.messages());
    await agent.dispose();
  });

  it("settlement_emits_one_blocked_tool_completed_per_call", async () => {
    const { agent, session, events } = await fixture({ limits: { maxToolCalls: 1 } });
    await session.run("go");
    await tick();
    const completed = events.filter((event) => event.type === "tool.completed");
    const blocked = completed.filter((event) => event.type === "tool.completed" && event.status === "blocked");
    assert.equal(completed.length, 3, "one tool.completed per call");
    assert.deepEqual(
      blocked.map((event) => event.type === "tool.completed" && event.toolCallId),
      ["c2", "c3"],
    );
    const rows = results(await session.messages());
    for (const event of blocked) {
      if (event.type !== "tool.completed") continue;
      assert.equal(event.reason, rows.find((row) => row.id === event.toolCallId)?.code ?? event.error?.name);
    }
    await agent.dispose();
  });

  it("loop_conformance_settlement", async () => {
    await assertToolRoundSettlement({
      name: "default-like",
      async run(run) {
        const turn = await run.turn();
        if (turn.toolCalls.length > 0) await run.executeTools(turn.toolCalls);
      },
    });
    // A loop that swallows the round's error and ends the run before the kernel's backstop cannot exist
    // (the backstop is kernel-side), so the case fails only a loop that answers calls itself badly: here
    // one that appends its own assistant row with calls nothing answers.
    await assert.rejects(
      assertToolRoundSettlement({
        name: "leaky",
        async run(run) {
          await run.turn();
          await run.append({ role: "assistant", content: [{ type: "tool_call", id: "leak", name: "echo", arguments: {} }] });
        },
      }),
      /left tool calls without a result: leak/,
    );
  });
});
