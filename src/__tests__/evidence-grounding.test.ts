import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  type AgentEventRecord,
  type AIProvider,
  createAgent,
  createClaimGroundingGuardrail,
  createMockProvider,
  type HookContext,
  type Message,
  providerDone,
  providerTextDelta,
  type RunLedger,
  type ToolResult,
  type GuardrailRecord,
} from "../index.js";
import { kernelEvents } from "./kernel-event-helpers.js";
import { failedRun } from "./run-result-helpers.js";

function assistantMessage(text: string): Message {
  return { id: "m1", role: "assistant", content: [{ type: "text", text }] };
}

function hookContext(): HookContext {
  return {
    sessionId: "session",
    runId: "run",
    emit: () => {},
    reject: (reason) => ({ __prismHookRejection: reason }) as never,
  };
}

/** Run the `model.response` gate directly; a rejection carries the reason it failed with. */
function evaluate(text: string, guard: ReturnType<typeof createClaimGroundingGuardrail>, toolResults: readonly ToolResult[] = []) {
  const emitted: AgentEventRecord[] = [];
  const rejection = guard(assistantMessage(text), {
    ...hookContext(),
    emit: (event) => emitted.push({ type: event.type, event } as AgentEventRecord),
  } as HookContext);
  return { rejection, emitted };
}

const TOOL_RESULTS: readonly ToolResult[] = [{ toolCallId: "sum", name: "sum", value: 4320.5 }];

describe("claim grounding model.response gate", () => {
  it("matches same-run tool results and blocks an uncited claim", async () => {
    let turns = 0;
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        if (turns++ === 0) {
          yield { type: "tool_call", call: { type: "tool_call", id: "sum", name: "sum", arguments: {} } };
          yield providerDone();
          return;
        }
        yield providerTextDelta("Total is 4,320.50.");
        yield providerDone();
      },
    };
    let latest: readonly ToolResult[] = [];
    const grounding = createClaimGroundingGuardrail({
      requireEvidenceForNumbers: true,
      toolResults: () => latest,
    });
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      tools: {
        add: [
          {
            name: "sum",
            execute: (_args, call) => {
              latest = [{ toolCallId: call.toolCallId, name: "sum", value: 4320.5 }];
              return { toolCallId: call.toolCallId, name: "sum", value: 4320.5 };
            },
          },
        ],
      },
      hooks: (hooks) => hooks.on("model.response", grounding),
    });
    assert.equal((await (await agent.session()).run("calculate")).text, "Total is 4,320.50.");

    latest = [];
    const blocked = await createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerTextDelta("Total is 4,320.50."), providerDone()]),
      hooks: (hooks) => hooks.on("model.response", grounding),
    });
    await failedRun((await blocked.session()).run("calculate"), /claim_ungrounded/);
  });

  it("accepts an immediately cited host-governed figure", () => {
    const guard = createClaimGroundingGuardrail({
      requireEvidenceForNumbers: true,
      evidenceSources: () => [{ value: 4320.5, ref: "metric:revenue-q2" }],
    });
    const { rejection } = evaluate("Revenue is 999 [evidence:metric:revenue-q2].", guard);
    assert.equal(rejection, undefined);
  });

  it("accepts rounded quantities only when requested", () => {
    assert.ok(evaluate("Total is ~4.3k.", createClaimGroundingGuardrail({ requireEvidenceForNumbers: true }), TOOL_RESULTS).rejection);
    const rounded = createClaimGroundingGuardrail({
      requireEvidenceForNumbers: true,
      tolerance: "rounded",
      toolResults: () => TOOL_RESULTS,
    });
    assert.equal(evaluate("Total is ~4.3k.", rounded).rejection, undefined);
  });

  it("flags without blocking through the standard guardrail event", async () => {
    const events: AgentEventRecord[] = [];
    const ledger: RunLedger = {
      appendRun: async () => {},
      appendEvent: async (record) => {
        events.push(record);
      },
      appendToolCall: async () => {},
      appendUsage: async () => {},
    };
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerTextDelta("Total is 9."), providerDone()]),
      hooks: (hooks) => hooks.on("model.response", createClaimGroundingGuardrail({ requireEvidenceForNumbers: true, onViolation: "flag" })),
    });
    assert.equal((await (await agent.session()).run("calculate", { runLedger: ledger })).text, "Total is 9.");
    const event = kernelEvents<{ record: GuardrailRecord }>(
      events.map((record) => record.event),
      "guardrail.decision",
    )[0];
    if (!event) throw new Error("missing flag event");
    assert.equal(event.record.guardrail, "claim-grounding");
    assert.equal(event.record.reason, "claim_ungrounded");
    assert.deepEqual(event.record.metadata, { violation: true, claim: "9", contentIndex: 0, start: 9, end: 10 });
  });

  it("scans a 100 KiB message inside the 2 ms budget", () => {
    const guard = createClaimGroundingGuardrail({
      requireEvidenceForNumbers: true,
      toolResults: () => TOOL_RESULTS,
    });
    const message = assistantMessage(`${"x".repeat(100 * 1024)} 4320.50`);
    const context = hookContext();
    guard(message, context);
    const samples: number[] = [];
    for (let index = 0; index < 21; index += 1) {
      const started = performance.now();
      const rejection = guard(message, context);
      samples.push(performance.now() - started);
      assert.equal(rejection instanceof Promise, false);
    }
    samples.sort((left, right) => left - right);
    const median = samples[10] ?? Number.POSITIVE_INFINITY;
    assert.ok(median < 2, `100 KiB grounding scan took ${median.toFixed(3)} ms`);
  });
});
