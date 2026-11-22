/**
 * Plan 226 Task 4: the independent tool calls of one model turn run at the same time, bounded by
 * `AgentConfig.tools.concurrency` (default 4). A round with an `exclusive` tool, a tool with no
 * `effects`, or an unknown tool name stays serial; results are appended in call order.
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  type ModelProvider,
  type RunLedger,
  type ToolCallRecord,
  type ToolDefinition,
} from "../index.js";
import { createLoadSkillTool } from "../skill-load.js";
import { serializeDurableMark } from "../agent-session/session/tool-round.js";
import { resolveToolConcurrency } from "../tools.js";
import { providerPackage } from "../provider-kit/index.js";
import { providerDone, providerTextDelta, toolCallContent } from "../testing/index.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let providerCounter = 0;

/** Turn 1 emits every call; turn 2 answers. */
function roundProvider(calls: readonly { readonly id: string; readonly name: string }[]): ModelProvider {
  providerCounter += 1;
  let turn = 0;
  return {
    id: `parallel-${providerCounter}`,
    async *generate() {
      turn += 1;
      if (turn === 1) {
        for (const call of calls) yield { type: "tool_call" as const, call: toolCallContent(call.id, call.name, {}) };
        yield providerDone();
        return;
      }
      yield providerTextDelta("done");
      yield providerDone();
    },
  };
}

interface Probe {
  active: number;
  maxActive: number;
  readonly starts: string[];
  readonly finishes: string[];
}

function probe(): Probe {
  return { active: 0, maxActive: 0, starts: [], finishes: [] };
}

function timedTool(name: string, ms: number, state: Probe, extra: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name,
    effects: ["read"],
    async execute(_args, context) {
      state.active += 1;
      state.maxActive = Math.max(state.maxActive, state.active);
      state.starts.push(name);
      await sleep(ms);
      state.active -= 1;
      state.finishes.push(name);
      return { toolCallId: context.toolCallId, name, value: name };
    },
    ...extra,
  };
}

async function runRound(
  calls: readonly { readonly id: string; readonly name: string }[],
  tools: readonly ToolDefinition[],
  options: {
    readonly concurrency?: number;
    readonly runConcurrency?: number;
    readonly limits?: Record<string, number>;
    readonly runLedger?: RunLedger;
  } = {},
) {
  const provider = roundProvider(calls);
  const agent = await createAgent({
    model: { provider: provider.id, model: "demo" },
    packages: [providerPackage(`parallel-package-${providerCounter}`, [provider])],
    tools: { add: tools, ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }) },
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.runLedger ? { runLedger: options.runLedger } : {}),
    slots: { store: createMemorySessionStore() },
  });
  const session = await agent.session({ id: `round-${providerCounter}`, create: true });
  const events: AgentEvent[] = [];
  const watching = (async () => {
    for await (const event of session.subscribe()) events.push(event);
  })();
  const started = performance.now();
  const outcome = await session.run("go", options.runConcurrency === undefined ? {} : { tools: { concurrency: options.runConcurrency } });
  const ms = performance.now() - started;
  const messages = await session.messages();
  await session.close();
  await watching;
  return { outcome, events, ms, messages };
}

function resultOrder(
  messages: readonly { readonly content: readonly { readonly type: string; readonly toolCallId?: string }[] }[],
): string[] {
  return messages.flatMap((message) =>
    message.content.filter((block) => block.type === "tool_result").map((block) => block.toolCallId as string),
  );
}

const four = ["a", "b", "c", "d"].map((id) => ({ id: `call-${id}`, name: `tool_${id}` }));

describe("parallel tool rounds", () => {
  it("round_runs_non_exclusive_calls_concurrently", async () => {
    const state = probe();
    const { ms } = await runRound(
      four,
      four.map((call) => timedTool(call.name, 200, state)),
    );
    assert.equal(state.maxActive, 4);
    assert.ok(ms < 600, `four 200 ms calls took ${ms} ms`);
  });

  it("exclusive_tool_makes_the_round_serial", async () => {
    const state = probe();
    const tools = four.map((call, index) => timedTool(call.name, 20, state, index === 2 ? { exclusive: true } : {}));
    await runRound(four, tools);
    assert.equal(state.maxActive, 1);
  });

  it("undeclared_effects_make_the_round_serial", async () => {
    const state = probe();
    const tools = four.map((call, index) => {
      const tool = timedTool(call.name, 20, state);
      if (index !== 1) return tool;
      const { effects: _effects, ...rest } = tool;
      return rest as ToolDefinition;
    });
    await runRound(four, tools);
    assert.equal(state.maxActive, 1);
  });

  it("unknown_tool_name_makes_the_round_serial", async () => {
    const state = probe();
    const calls = [...four.slice(0, 3), { id: "call-ghost", name: "ghost" }];
    const { messages } = await runRound(
      calls,
      four.slice(0, 3).map((call) => timedTool(call.name, 20, state)),
    );
    assert.equal(state.maxActive, 1);
    assert.deepEqual(
      resultOrder(messages),
      calls.map((call) => call.id),
    );
  });

  it("results_append_in_call_order_under_concurrency", async () => {
    const state = probe();
    const delays = [120, 10, 60, 30];
    const { messages } = await runRound(
      four,
      four.map((call, index) => timedTool(call.name, delays[index]!, state)),
    );
    assert.equal(state.maxActive, 4);
    assert.deepEqual(state.finishes, ["tool_b", "tool_d", "tool_c", "tool_a"]);
    assert.deepEqual(
      resultOrder(messages),
      four.map((call) => call.id),
    );
  });

  it("one_failing_call_does_not_cancel_siblings", async () => {
    const state = probe();
    const tools = four.map((call, index) =>
      index === 1
        ? ({
            name: call.name,
            effects: ["read"],
            async execute() {
              await sleep(10);
              throw new Error("boom");
            },
          } satisfies ToolDefinition)
        : timedTool(call.name, 60, state),
    );
    const { messages, events } = await runRound(four, tools);
    assert.deepEqual(state.finishes.sort(), ["tool_a", "tool_c", "tool_d"]);
    assert.deepEqual(
      resultOrder(messages),
      four.map((call) => call.id),
    );
    const failed = events.filter((event) => event.type === "tool.completed" && (event as { status?: string }).status === "error");
    assert.equal(failed.length, 1);
  });

  it("limit_breach_mid_round_settles_remaining_calls", async () => {
    const state = probe();
    const { messages, outcome } = await runRound(
      four,
      four.map((call) => timedTool(call.name, 30, state)),
      { limits: { maxToolCalls: 2 } },
    );
    assert.equal(outcome.limit?.limit, "maxToolCalls");
    // Every call of the round has exactly one result, so the next request never carries a bare call.
    assert.deepEqual(
      resultOrder(messages).sort(),
      four.map((call) => call.id),
    );
  });

  it("concurrency_one_restores_serial_order_of_events", async () => {
    const state = probe();
    const { events } = await runRound(
      four,
      four.map((call) => timedTool(call.name, 15, state)),
      { concurrency: 1 },
    );
    assert.equal(state.maxActive, 1);
    assert.deepEqual(state.starts, state.finishes);
    const lifecycle = events.filter((event) => event.type === "tool.started" || event.type === "tool.completed").map((event) => event.type);
    assert.deepEqual(lifecycle, [
      "tool.started",
      "tool.completed",
      "tool.started",
      "tool.completed",
      "tool.started",
      "tool.completed",
      "tool.started",
      "tool.completed",
    ]);
  });

  it("concurrency_is_bounded_and_a_run_can_only_narrow_it", async () => {
    const two = probe();
    await runRound(
      four,
      four.map((call) => timedTool(call.name, 30, two)),
      { concurrency: 2 },
    );
    assert.equal(two.maxActive, 2);
    const narrowed = probe();
    await runRound(
      four,
      four.map((call) => timedTool(call.name, 30, narrowed)),
      { concurrency: 3, runConcurrency: 2 },
    );
    assert.equal(narrowed.maxActive, 2);
    const raised = probe();
    await runRound(
      four,
      four.map((call) => timedTool(call.name, 30, raised)),
      { concurrency: 2, runConcurrency: 8 },
    );
    assert.equal(raised.maxActive, 2);
    assert.equal(resolveToolConcurrency(undefined, undefined), 4);
    for (const bad of [0, 17, 1.5, Number.NaN]) {
      assert.throws(() => resolveToolConcurrency(bad, undefined), /integer from 1 to 16/);
      assert.throws(() => resolveToolConcurrency(undefined, bad), /integer from 1 to 16/);
    }
  });

  it("load_skill_beside_other_calls_stays_serial", async () => {
    // `load_skill` mutates the session's loaded-skill order during `execute`: it must make its round serial.
    assert.equal(createLoadSkillTool({ skills: () => [] } as never).exclusive, true);
  });

  it("concurrent_calls_append_to_the_ledger_without_loss", async () => {
    const state = probe();
    const records: ToolCallRecord[] = [];
    const ledger: RunLedger = {
      appendRun: async () => {},
      appendEvent: async () => {},
      appendUsage: async () => {},
      appendToolCall: async (record) => {
        await sleep(1);
        records.push(record);
      },
    };
    await runRound(
      four,
      four.map((call) => timedTool(call.name, 30, state)),
      { runLedger: ledger },
    );
    assert.equal(state.maxActive, 4);
    for (const call of four) {
      const own = records.filter((record) => record.toolCallId === call.id).map((record) => record.status);
      assert.equal(own[0], "started", `${call.id}: ${own.join(",")}`);
      assert.equal(own.at(-1), "finished", `${call.id}: ${own.join(",")}`);
      assert.equal(own.filter((status) => status === "finished").length, 1);
    }
  });

  it("resumed_round_marks_each_pending_call_dispatched", async () => {
    // The durable mark is a read-modify-write of one state object. Unserialized, concurrent marks
    // all read the same snapshot and only the last write survives.
    let stored: readonly string[] = [];
    const owner = {};
    const mark = (id: string) =>
      serializeDurableMark(owner, async () => {
        const snapshot = stored;
        await sleep(5);
        stored = [...snapshot, id];
      });
    await Promise.all(["x", "y", "z"].map(mark));
    assert.deepEqual(stored, ["x", "y", "z"]);
    // A failing mark rejects its own caller but does not poison the chain.
    await assert.rejects(serializeDurableMark(owner, () => Promise.reject(new Error("store down"))));
    await mark("after");
    assert.equal(stored.at(-1), "after");
  });
});
