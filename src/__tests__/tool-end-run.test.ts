/**
 * A tool result that ends the run after its round (`endRun`): honoured only for a tool that declares
 * `endsRun`, no further provider turn, later calls refused, and the session continues on the next run.
 */

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  type ModelProvider,
  providerDone,
  providerTextDelta,
  type ToolDefinition,
  toolCallContent,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";

/** Every turn's first call is `ask` (with a sibling `note` on turn 1), until the model answers in text. */
function provider(turnsWithCalls: number): { provider: ModelProvider; turns: () => number } {
  let turn = 0;
  return {
    turns: () => turn,
    provider: {
      id: "mock",
      async *generate() {
        turn += 1;
        if (turn <= turnsWithCalls) {
          yield { type: "tool_call" as const, call: toolCallContent(`ask-${turn}`, "ask", {}) };
          yield { type: "tool_call" as const, call: toolCallContent(`note-${turn}`, "note", {}) };
          yield providerDone();
          return;
        }
        yield providerTextDelta(`answer ${turn}`);
        yield providerDone();
      },
    },
  };
}

const tools = (declared: boolean, executed: string[]): ToolDefinition[] => [
  {
    name: "ask",
    parameters: {},
    ...(declared ? { endsRun: true } : {}),
    execute: (_args, context) => {
      executed.push(context.toolCallId);
      return { toolCallId: context.toolCallId, name: "ask", value: "questions posted", endRun: { reason: "awaiting answers" } };
    },
  },
  {
    name: "note",
    parameters: {},
    execute: (_args, context) => {
      executed.push(context.toolCallId);
      return { toolCallId: context.toolCallId, name: "note", value: "noted" };
    },
  },
];

async function fixture(declared: boolean, turnsWithCalls = 1) {
  const executed: string[] = [];
  const mock = provider(turnsWithCalls);
  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    packages: [providerPackage("end-run-provider", [mock.provider])],
    slots: { store: createMemorySessionStore() },
    tools: { add: tools(declared, executed) },
  });
  const session = await agent.session();
  const events: AgentEvent[] = [];
  void (async () => {
    for await (const event of session.subscribe({ acrossRuns: true })) events.push(event);
  })().catch(() => undefined);
  return { session, executed, events, turns: mock.turns };
}

describe("tool endRun", () => {
  it("a_declared_tool_ends_the_run_after_its_round_and_the_next_run_continues", async () => {
    const { session, executed, turns } = await fixture(true);
    const first = await session.run("brainstorm");
    assert.equal(first.status, "stopped");
    assert.equal(first.stopReason, "tool_end_run");
    assert.equal(first.stopDetail, "awaiting answers");
    // The whole round ran and was recorded; no second provider turn.
    assert.deepEqual(executed.sort(), ["ask-1", "note-1"]);
    assert.equal(turns(), 1);
    const results = (await session.messages()).filter((message) => message.role === "tool");
    assert.equal(results.length, 2);

    const next = await session.run("here are my answers");
    assert.equal(next.status, "completed");
    assert.equal(next.stopReason, undefined);
    assert.equal(next.text, "answer 2");
  });

  it("an_undeclared_tool_has_endRun_dropped_with_a_note", async () => {
    const { session, turns, events } = await fixture(false);
    const result = await session.run("brainstorm");
    assert.equal(result.stopReason, undefined);
    assert.equal(result.text, "answer 2");
    assert.equal(turns(), 2);
    assert.ok(
      events.some((event) => event.type === "package.event" && event.package === "kernel" && event.name === "tool.end_run_ignored"),
    );
  });

  it("a_tool_call_after_the_run_ended_is_refused", async () => {
    const executed: string[] = [];
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [providerPackage("end-run-loop-provider", [provider(1).provider])],
      slots: {
        store: createMemorySessionStore(),
        // A loop that keeps calling tools after the end, as a driver's vendor might.
        loop: {
          name: "eager",
          async run(run) {
            const turn = await run.turn();
            await run.executeTools(turn.toolCalls);
            const [late] = await run.executeTools([toolCallContent("late", "note", {})]);
            assert.equal(late?.error?.code, "run_ended");
            assert.equal((await run.turn()).finishReason, "tool_end_run");
          },
        },
      },
      tools: { add: tools(true, executed) },
    });
    const session = await agent.session();
    const result = await session.run("go");
    assert.equal(result.stopReason, "tool_end_run");
    assert.ok(!executed.includes("late"));
  });
});
