/**
 * Plan 239 Task 9: the stall axis. A run whose tool rounds repeat a recent round exactly — the same calls with
 * the same results — fails on `maxRepeatedToolRounds` before a count cap is reached.
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { parseAgentRunState, type StoredAgentRunState } from "../agent-run-state.js";
import {
  type AgentEvent,
  AgentRunStateError,
  createAgent,
  createMemorySessionStore,
  type JsonObject,
  type LoopStrategy,
  type ModelProvider,
  type SessionEntry,
  type SessionStore,
  providerDone,
  providerTextDelta,
  resolveRunLimits,
  toolCallContent,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";
import { RunLimitTracker } from "../run-limits.js";

const model = { provider: "mock", model: "demo" } as const;
const SECRET_ARG = "ARGUMENT-TEXT-THAT-MUST-NOT-LEAK";
const SECRET_RESULT = "RESULT-TEXT-THAT-MUST-NOT-LEAK";

/** Each step is `call` (one `work` call with `args`), `fail` (the provider throws), or text. */
function scriptedProvider(script: Array<"call" | "fail" | string>, args: () => JsonObject = () => ({ q: SECRET_ARG })): ModelProvider {
  let index = 0;
  return {
    id: "mock",
    async *generate() {
      const step = script[index] ?? "done";
      index += 1;
      if (step === "fail") throw new Error("provider down");
      if (step === "call") {
        yield { type: "tool_call" as const, call: toolCallContent(`c${index}`, "work", args()) };
        yield providerDone();
        return;
      }
      yield providerTextDelta(step);
      yield providerDone();
    },
  };
}

function workTool(result: () => string) {
  return {
    name: "work",
    parameters: { type: "object", properties: { q: { type: "string" }, n: { type: "number" } } },
    execute: async (_args: unknown, context: { readonly toolCallId: string }) => ({
      toolCallId: context.toolCallId,
      name: "work",
      value: result(),
    }),
  };
}

async function agentOver(options: {
  script: Array<"call" | "fail" | string>;
  result?: () => string;
  args?: () => JsonObject;
  store?: SessionStore;
  limits?: Parameters<typeof createAgent>[0]["limits"];
  loop?: LoopStrategy;
  durability?: "turn";
}) {
  return createAgent({
    id: "worker",
    model,
    packages: [providerPackage("p", [scriptedProvider(options.script, options.args)])],
    slots: { ...(options.store ? { store: options.store } : {}), ...(options.loop ? { loop: options.loop } : {}) },
    tools: { add: [workTool(options.result ?? (() => SECRET_RESULT))] },
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.durability ? { durability: options.durability } : {}),
  });
}

async function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

const calls = (n: number): Array<"call"> => Array.from({ length: n }, () => "call" as const);
const toolRoundsOf = (events: readonly AgentEvent[]) => events.filter((event) => event.type === "tool.completed").length;
const checkpointsOf = (entries: readonly SessionEntry[]) =>
  entries.filter((entry) => entry.kind === "run_checkpoint").map((entry) => entry.data as unknown as StoredAgentRunState);

describe("stall detection (plan 239 Task 9)", () => {
  it("identical_rounds_with_identical_results_stall", async () => {
    // maxToolRounds stays at its default of 49: the stall axis ends the run long before it.
    const agent = await agentOver({ script: calls(40) });
    const session = await agent.session();
    const pending = collect(session.subscribe());
    const result = await session.run("go");
    const events = await pending;
    assert.equal(result.status, "failed");
    assert.deepEqual(result.limit, { limit: "maxRepeatedToolRounds", maximum: 5, observed: 5 });
    // The first round is new; the next five repeat it.
    assert.equal(toolRoundsOf(events), 6);
    await agent.dispose();
  });

  it("polling_with_changing_results_is_not_a_stall", async () => {
    let status = 0;
    const agent = await agentOver({ script: [...calls(12), "finished"], result: () => `progress ${(status += 1)}` });
    const result = await (await agent.session()).run("poll until done");
    assert.equal(result.status, "completed");
    assert.equal(result.text, "finished");
    await agent.dispose();
  });

  it("new_arguments_with_the_same_result_are_not_a_stall", async () => {
    let n = 0;
    const agent = await agentOver({ script: [...calls(12), "finished"], args: () => ({ n: (n += 1) }) });
    assert.equal((await (await agent.session()).run("go")).status, "completed");
    await agent.dispose();
  });

  it("a_repeat_of_any_round_in_the_window_counts", async () => {
    // Alternating between two results: every round from the third on repeats one of the previous eight.
    let flip = 0;
    const agent = await agentOver({ script: calls(40), result: () => ((flip += 1) % 2 === 0 ? "a" : "b") });
    const result = await (await agent.session()).run("go");
    assert.equal(result.limit?.limit, "maxRepeatedToolRounds");
    await agent.dispose();
  });

  it("stall_attribution_holds_hashes_only", async () => {
    const agent = await agentOver({ script: calls(40) });
    const session = await agent.session();
    const pending = collect(session.subscribe());
    const result = await session.run("go");
    const events = await pending;
    const failed = events.find((event) => event.type === "run.failed");
    assert.ok(failed && failed.type === "run.failed");
    assert.equal(failed.limit?.limit, "maxRepeatedToolRounds");
    const recent = result.attribution?.recentToolCalls ?? [];
    assert.ok(recent.length > 0);
    for (const call of recent) {
      assert.deepEqual(Object.keys(call).sort(), ["argHash", "id", "name", "resultHash"]);
      assert.equal(call.name, "work");
      assert.match(call.argHash, /^sha256:[0-9a-f]{64}$/);
      assert.match(call.resultHash!, /^sha256:[0-9a-f]{64}$/);
    }
    // The same call with the same result hashes alike in every round.
    assert.equal(new Set(recent.map((call) => `${call.argHash}|${call.resultHash}`)).size, 1);
    const serialized = JSON.stringify([failed, result.attribution, result.limit]);
    assert.ok(!serialized.includes(SECRET_ARG));
    assert.ok(!serialized.includes(SECRET_RESULT));
    await agent.dispose();
  });

  it("null_disables_the_axis_and_layers_narrow_by_min", async () => {
    const off = await agentOver({ script: [...calls(10), "finished"], limits: { maxRepeatedToolRounds: null } });
    assert.equal((await (await off.session()).run("go")).status, "completed");
    await off.dispose();

    const narrowed = await agentOver({ script: calls(20), limits: { maxRepeatedToolRounds: 5 } });
    const result = await (await narrowed.session()).run("go", { limits: { maxRepeatedToolRounds: 2 } });
    assert.deepEqual(result.limit, { limit: "maxRepeatedToolRounds", maximum: 2, observed: 2 });
    await narrowed.dispose();

    assert.equal(resolveRunLimits().maxRepeatedToolRounds, 5);
    assert.equal(resolveRunLimits({ maxRepeatedToolRounds: null }, { maxRepeatedToolRounds: 3 }).maxRepeatedToolRounds, 3);
    assert.throws(() => resolveRunLimits({ maxRepeatedToolRounds: 0 }), /maxRepeatedToolRounds/);
  });

  it("stall_counter_survives_continue", async () => {
    const store = createMemorySessionStore();
    const limits = { maxRepeatedToolRounds: 3 };
    // Three identical rounds (two repeats), then the provider fails: the checkpoint holds the window.
    const first = await agentOver({ store, durability: "turn", limits, script: [...calls(3), "fail"] });
    const session = await first.session({ id: "s", create: true });
    const failed = await session.run("go");
    assert.equal(failed.status, "failed");
    assert.equal(failed.limit, undefined);
    const saved = checkpointsOf(await session.entries()).at(-1)!;
    assert.equal(saved.counters.repeatedToolRounds, 2);
    assert.equal(saved.toolRoundDigests?.length, 3);
    assert.equal(new Set(saved.toolRoundDigests).size, 1);
    assert.ok(!JSON.stringify(saved).includes(SECRET_RESULT), "the checkpoint carries hashes, not results");
    await first.dispose();

    // A new process: one more identical round reaches the cap only because the window was restored.
    const next = await agentOver({ store, durability: "turn", limits, script: calls(10) });
    const reopened = await next.session({ id: "s" });
    const pending = collect(reopened.subscribe());
    const result = await reopened.continue();
    const events = await pending;
    assert.equal(result.runId, failed.runId);
    assert.deepEqual(result.limit, { limit: "maxRepeatedToolRounds", maximum: 3, observed: 3 });
    assert.equal(toolRoundsOf(events), 1);
    await next.dispose();
  });

  it("custom_loop_charges_the_stall_axis", async () => {
    let rounds = 0;
    const loop: LoopStrategy = {
      name: "plain",
      async run(run) {
        for (;;) {
          const turn = await run.turn();
          if (turn.stopped || turn.toolCalls.length === 0) return;
          rounds += 1;
          await run.executeTools(turn.toolCalls);
        }
      },
    };
    const agent = await agentOver({ script: calls(40), loop });
    const result = await (await agent.session()).run("go");
    assert.equal(result.limit?.limit, "maxRepeatedToolRounds");
    assert.equal(rounds, 6);
    await agent.dispose();
  });

  it("a_malformed_window_fails_closed", () => {
    const tracker = new RunLimitTracker(resolveRunLimits());
    assert.throws(() => tracker.recordToolRound("not-a-digest"), TypeError);
    assert.throws(() => new RunLimitTracker(resolveRunLimits(), { toolRoundDigests: ["sha256:zz"] }), TypeError);
    const state = {
      schemaVersion: 1,
      agentId: "a",
      definitionRevision: "1",
      fingerprint: "f",
      runId: "r",
      sessionId: "s",
      status: "running",
      counters: {},
      toolRoundDigests: Array.from({ length: 9 }, () => `sha256:${"0".repeat(64)}`),
    };
    assert.throws(() => parseAgentRunState(state), AgentRunStateError);
  });
});
