import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AgentEventRecord,
  type AIProvider,
  createAgent,
  createClaimGroundingGuardrail,
  createMockProvider,
  type GuardrailContext,
  GuardrailError,
  providerDone,
  providerTextDelta,
  type RunLedger,
  runGuardrails,
  type ToolResult,
} from "../index.js";

function outputContext(text: string, toolResults: readonly ToolResult[] = []): GuardrailContext<"output"> {
  return {
    stage: "output",
    value: { content: [{ type: "text", text }], calls: [], started: true },
    sessionId: "session",
    runId: "run",
    metadata: {},
    signal: new AbortController().signal,
    toolResults,
  };
}

async function evaluate(
  text: string,
  guard = createClaimGroundingGuardrail({ requireEvidenceForNumbers: true }),
  toolResults: readonly ToolResult[] = [],
) {
  return runGuardrails({
    stage: "output",
    guardrails: { output: [guard] },
    value: outputContext(text, toolResults).value,
    context: outputContext(text, toolResults),
  });
}

describe("claim grounding guardrail", () => {
  it("matches same-run tool results and blocks an uncited claim with its bounded span", async () => {
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
    const grounding = createClaimGroundingGuardrail({ requireEvidenceForNumbers: true });
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider,
      tools: [{ name: "sum", execute: () => ({ toolCallId: "sum", name: "sum", value: 4320.5 }) }],
      guardrails: { output: [grounding] },
    });
    assert.equal((await agent.createSession().run("calculate")).text, "Total is 4,320.50.");

    const blocked = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerTextDelta("Total is 4,320.50."), providerDone()]),
      guardrails: { output: [grounding] },
    });
    await assert.rejects(
      () => blocked.createSession().run("calculate"),
      (error: unknown) => {
        const cause = error instanceof Error ? error.cause : undefined;
        return (
          cause instanceof GuardrailError &&
          cause.record.reason === "claim_ungrounded" &&
          cause.record.metadata?.claim === "4,320.50" &&
          typeof cause.record.metadata?.start === "number" &&
          typeof cause.record.metadata?.end === "number" &&
          !JSON.stringify(cause.record.metadata).includes("Total is")
        );
      },
    );
  });

  it("accepts an immediately cited host-governed figure", async () => {
    const result = await evaluate(
      "Revenue is 999 [evidence:metric:revenue-q2].",
      createClaimGroundingGuardrail({
        requireEvidenceForNumbers: true,
        evidenceSources: () => [{ value: 4320.5, ref: "metric:revenue-q2" }],
      }),
    );
    assert.equal(result.terminal, undefined);
  });

  it("accepts rounded quantities only when requested", async () => {
    const toolResults = [{ toolCallId: "sum", name: "sum", value: 4320.5 }];
    assert.equal((await evaluate("Total is ~4.3k.", undefined, toolResults)).terminal?.reason, "claim_ungrounded");
    assert.equal(
      (
        await evaluate(
          "Total is ~4.3k.",
          createClaimGroundingGuardrail({ requireEvidenceForNumbers: true, tolerance: "rounded" }),
          toolResults,
        )
      ).terminal,
      undefined,
    );
  });

  it("flags without blocking and persists the violation through the standard guardrail event", async () => {
    const events: AgentEventRecord[] = [];
    const ledger: RunLedger = {
      appendRun: async () => {},
      appendEvent: async (record) => {
        events.push(record);
      },
      appendToolCall: async () => {},
      appendUsage: async () => {},
    };
    const agent = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerTextDelta("Total is 9."), providerDone()]),
      guardrails: { output: [createClaimGroundingGuardrail({ requireEvidenceForNumbers: true, onViolation: "flag" })] },
    });
    assert.equal((await agent.createSession().run("calculate", { runLedger: ledger })).text, "Total is 9.");
    const event = events.find((record) => record.type === "guardrail_decision");
    assert.equal(event?.event.type, "guardrail_decision");
    if (event?.event.type !== "guardrail_decision") throw new Error("missing flag event");
    assert.deepEqual(event.event.record, {
      guardrail: "claim-grounding",
      stage: "output",
      action: "allow",
      reason: "claim_ungrounded",
      metadata: { violation: true, claim: "9", contentIndex: 0, start: 9, end: 10 },
    });
  });

  it("scans a 100 KiB message inside the 2 ms budget", () => {
    const guard = createClaimGroundingGuardrail({ requireEvidenceForNumbers: true });
    const context = outputContext(`${"x".repeat(100 * 1024)} 4320.50`, [{ toolCallId: "sum", name: "sum", value: 4320.5 }]);
    guard.evaluate(context);
    const samples: number[] = [];
    for (let index = 0; index < 21; index += 1) {
      const started = performance.now();
      const decision = guard.evaluate(context);
      samples.push(performance.now() - started);
      assert.equal(decision instanceof Promise, false);
    }
    samples.sort((left, right) => left - right);
    const median = samples[10] ?? Number.POSITIVE_INFINITY;
    assert.ok(median < 2, `100 KiB grounding scan took ${median.toFixed(3)} ms`);
  });
});
