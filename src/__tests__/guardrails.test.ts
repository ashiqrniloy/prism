import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createAgent,
  createMockProvider,
  createToolRegistry,
  dispatchToolCall,
  providerDone,
  providerTextDelta,
  runGuardrails,
  type AgentEvent,
  type Guardrail,
  type ToolDefinition,
} from "../index.js";

async function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

const context = { sessionId: "s1", runId: "r1", metadata: {} };
const call = { type: "tool_call" as const, id: "c1", name: "echo", arguments: { text: "hi" } };

describe("guardrails", () => {
  it("bounds concurrent evaluation and reports records in declaration order", async () => {
    let active = 0;
    let peak = 0;
    const guard = (name: string): Guardrail<"input"> => ({
      name,
      stage: "input",
      async evaluate() {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { action: "allow" };
      },
    });
    const result = await runGuardrails({
      stage: "input",
      guardrails: { input: [guard("first"), guard("second")], maxConcurrency: 2 },
      value: [],
      context,
    });
    assert.equal(peak, 2);
    assert.deepEqual(result.records.map((record) => record.guardrail), ["first", "second"]);
  });

  it("emits one terminal decision when a parallel sibling is cancelled", async () => {
    const result = await runGuardrails({
      stage: "input",
      guardrails: {
        maxConcurrency: 2,
        input: [
          { name: "stop", stage: "input", evaluate: () => ({ action: "tripwire" }) },
          { name: "sibling", stage: "input", evaluate: async ({ signal }) => {
            if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
            throw new Error("cancelled");
          } },
        ],
      },
      value: [],
      context,
    });
    assert.equal(result.records.filter((record) => record.action !== "allow").length, 1);
  });

  it("fails closed for malformed decisions without exposing thrown details", async () => {
    const result = await runGuardrails({
      stage: "input",
      guardrails: { input: [{ name: "bad", stage: "input", evaluate: () => ({ action: "nope" } as never) }] },
      value: [],
      context,
    });
    assert.equal(result.terminal?.action, "tripwire");
    assert.equal(result.terminal?.reason, "guardrail_invalid_decision");
  });

  it("blocks input before provider or session persistence", async () => {
    let generated = false;
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: { id: "mock", async *generate() { generated = true; yield providerDone(); } },
      guardrails: { input: [{ name: "deny", stage: "input", evaluate: () => ({ action: "block", reason: "private" }) }] },
    });
    const session = agent.createSession({ id: "guard-input" });
    const reader = collect(session.subscribe());

    await assert.rejects(() => session.run("secret"), /Guardrail blocked run/);
    assert.equal(generated, false);
    assert.equal((await session.entries()).length, 0);
    const events = await reader;
    assert.equal(events.some((event) => event.type === "guardrail_decision"), true);
  });

  it("buffers blocked provider output before subscribers or session entries see it", async () => {
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerTextDelta("secret output"), providerDone()]),
      guardrails: { output: [{ name: "deny", stage: "output", evaluate: () => ({ action: "tripwire", reason: "unsafe" }) }] },
    });
    const session = agent.createSession({ id: "guard-output" });
    const reader = collect(session.subscribe());

    await assert.rejects(() => session.run("Hi"), /Guardrail blocked run/);
    const events = await reader;
    assert.equal(events.some((event) => event.type === "message_delta"), false);
    assert.equal((await session.entries()).some((entry) => entry.kind === "message" && JSON.stringify(entry).includes("secret output")), false);
  });

  it("runs tool stages around the side effect and never emits blocked raw output", async () => {
    let executed = false;
    const tool: ToolDefinition = {
      name: "echo",
      execute: () => {
        executed = true;
        return { toolCallId: "c1", name: "echo", value: "raw secret" };
      },
    };
    const events: AgentEvent[] = [];
    const result = await dispatchToolCall({
      call,
      registry: createToolRegistry([tool]),
      context: { ...context, toolCallId: "c1" },
      guardrails: { toolOutput: [{ name: "deny-output", stage: "tool_output", evaluate: () => ({ action: "block" }) }] },
      emit: (event) => { events.push(event); },
    });
    assert.equal(executed, true);
    assert.equal(result.error?.message, "Tool result blocked by guardrail");
    assert.equal(events.some((event) => event.type === "tool_execution_finished"), false);
    assert.equal(JSON.stringify(events).includes("raw secret"), false);
  });
});
