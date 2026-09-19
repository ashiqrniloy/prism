/** Plan 086 Task 4: conformance for the budget-capped long run (synapta H12 shape) — a 1M-token
 *  window with a 500k run input budget, where the per-request `input_ratio` axis can never open the
 *  gate and the cumulative `run_input_ratio` axis is the only thing that can. The fixture mirrors
 *  `examples/attention-budget-axes.ts` so the shipped example and this suite cannot drift. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { resolveRunAttentionCompiler } from "../attention-compiler.js";
import {
  type AgentEvent,
  type AIProvider,
  type AttentionReport,
  assembleProviderInput,
  createAgent,
  createMemorySessionStore,
  type Message,
  type ModelConfig,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type ToolDefinition,
  toolCallContent,
} from "../index.js";

/** The scenario, identical to the example: 1M window, 500k run budget, 24 provider turns. */
const contextWindow = 1_000_000;
const runInputBudget = 500_000;
const turns = 24;
const runAxisRatio = 0.01;
const windowAxisRatio = 0.75;
const keepLast = 2;
/** 1% of 500k: the cumulative gate, far below the ~743k the window axis would need. */
const runBudgetThreshold = runAxisRatio * runInputBudget;
const STUB = /omitted \d+ bytes \(sha256 [0-9a-f]{32}\)/;

const wideModel: ModelConfig = { provider: "mock", model: "wide", limits: { contextWindow, maxOutputTokens: 8_192 } };
const row = (turn: number) => `row ${turn} ${"y".repeat(1_200)}`;

interface FoldTurn {
  readonly turn: number;
  readonly used: number;
  readonly inputCap: number;
  readonly stubbed: number;
  readonly truncated: boolean;
  readonly spendBefore: number;
}

/** One long tool-calling run; usage is what a provider would bill for the assembled request. */
function longRun() {
  const requests: ProviderRequest[] = [];
  const folds: FoldTurn[] = [];
  let requestCount = 0;
  let spent = 0;
  const provider: AIProvider = {
    id: "mock",
    async *generate(request) {
      requests.push(request);
      requestCount += 1;
      const usage = { inputTokens: Math.ceil(JSON.stringify(request.messages).length / 4), outputTokens: 8 };
      spent += usage.inputTokens ?? 0;
      if (requestCount < turns) yield providerToolCall(toolCallContent(`call-${requestCount}`, "scan", {}));
      else yield providerTextDelta("investigation complete");
      yield providerDone(usage);
    },
  };
  const scan: ToolDefinition = {
    name: "scan",
    parameters: { type: "object", properties: {} },
    execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "scan", value: row(requestCount) }),
  };
  const agent = createAgent({
    id: "budget-conformance",
    model: wideModel,
    store: createMemorySessionStore(),
    tools: [scan],
    attentionCompiler: {
      trigger: [
        { kind: "input_ratio", ratio: windowAxisRatio },
        { kind: "run_input_ratio", ratio: runAxisRatio },
      ],
      keepLast,
      thinkingKeepTurns: 1,
    },
    provider,
  });
  return { agent, requests, folds, spent: () => spent, requestCount: () => requestCount };
}

describe("budget-capped long run conformance", () => {
  it("folds on cumulative run spend while the window ratio is never reachable", async () => {
    const run = longRun();
    const session = run.agent.createSession({ id: "budget-conformance" });
    const reader = (async () => {
      for await (const event of session.subscribe() as AsyncIterable<AgentEvent>) {
        if (event.type !== "attention_compiled") continue;
        // Assembly precedes the provider call of this turn, so the counter holds the turns before.
        run.folds.push({
          turn: run.requestCount() + 1,
          used: event.used,
          inputCap: event.inputCap,
          stubbed: event.stubbedToolResults,
          truncated: event.truncated,
          spendBefore: run.spent(),
        });
      }
    })();

    const result = await session.run("scan the corpus", {
      limits: {
        maxTurns: turns + 4,
        maxToolRounds: turns + 4,
        maxToolCalls: turns + 4,
        maxInputTokens: runInputBudget,
        maxTotalTokens: null,
      },
    });
    await reader;

    // The run survives the budget: folding is what keeps it under the cap.
    assert.equal(result.status, "succeeded");
    assert.equal(result.stopReason, undefined, "the run input budget must not have been breached");
    assert.equal(run.requestCount(), turns, "every turn ran");
    assert.ok(run.spent() < runInputBudget, `spend ${run.spent()} stayed under ${runInputBudget}`);

    // Folding engaged, and the window axis is not the explanation: no request came within an
    // order of magnitude of the ratio it would need.
    assert.ok(run.folds.length >= 10, `expected the gate to stay open, got ${run.folds.length} folding turns`);
    for (const turn of run.folds) {
      assert.ok(turn.inputCap > 900_000, `resolved input cap ${turn.inputCap} should be the 1M window`);
      assert.ok(turn.used < windowAxisRatio * turn.inputCap, `turn ${turn.turn} reached the window ratio`);
      assert.equal(turn.truncated, false, "every eligible row was folded");
    }
    assert.ok(run.folds.every((turn) => turn.stubbed > 0));

    // Attribution by elimination, which is all the pinned event payload allows (plan 087 adds the
    // axis to the event): at the first fold the request estimate alone was far under the cumulative
    // threshold, so only spend carried over from earlier turns can have opened the gate.
    const first = run.folds[0];
    assert.ok(first, "expected at least one folding turn");
    assert.ok(first.turn > 5, `first fold on turn ${first.turn} should follow several turns of spend`);
    assert.ok(first.used < runBudgetThreshold, `turn ${first.turn} estimate ${first.used} alone cleared the cumulative gate`);
    assert.ok(first.spendBefore + first.used >= runBudgetThreshold, "cumulative spend plus estimate must clear the gate");

    // Projection, not deletion: the newest rows stay raw in the request that is actually sent.
    const finalRows = (run.requests.at(-1)?.messages ?? []).flatMap((message) =>
      message.content.flatMap((block) => (block.type === "tool_result" ? [String(block.result)] : [])),
    );
    assert.equal(finalRows.length, turns - 1, "one tool result per completed turn");
    assert.equal(finalRows.filter((text) => !STUB.test(text)).length, keepLast, "only the newest rows stay raw");
    assert.equal(finalRows.filter((text) => STUB.test(text)).length, finalRows.length - keepLast);
  });

  it("names the cumulative axis in the report", async () => {
    // The event payload is counts-only, so the axis attribution is asserted where it exists.
    const compiler = resolveRunAttentionCompiler(
      {
        maxInputTokens: contextWindow,
        trigger: [
          { kind: "input_ratio", ratio: windowAxisRatio },
          { kind: "run_input_ratio", ratio: runAxisRatio },
        ],
      },
      undefined,
      wideModel,
      runInputBudget,
    );
    assert.ok(compiler, "compiler should resolve");
    const history: Message[] = Array.from({ length: 6 }, (_, index) => ({
      role: "tool" as const,
      content: [{ type: "tool_result" as const, toolCallId: `call_${index}`, name: "scan", result: row(index) }],
    }));
    let report: AttentionReport | undefined;
    await assembleProviderInput({
      model: wideModel,
      input: "scan the corpus",
      history,
      turn: 7,
      attentionCompiler: compiler,
      runInputTokens: runBudgetThreshold - 1_400,
      onAttentionReport: (value) => {
        report = value;
      },
    });

    assert.ok(report, "a mutated turn reports");
    assert.equal(report.firedAxis, "run_input_ratio");
    assert.ok(report.used + (runBudgetThreshold - 1_400) >= runBudgetThreshold);
    assert.ok(report.used < windowAxisRatio * report.inputCap);
    assert.ok(report.stubbedToolResults > 0);
  });

  it("the shipped example runs and reports the same scenario", () => {
    const result = spawnSync(process.execPath, ["examples/attention-budget-axes.ts"], { encoding: "utf8" });
    assert.equal(result.status, 0, `example exited ${result.status}\n${result.stderr}`);
    const payload = JSON.parse(result.stdout) as {
      result?: string;
      providerTurns?: number;
      folding?: { foldingTurns?: number };
      axisEvidence?: { windowRatioReached?: boolean; runBudgetThreshold?: number; firstFoldSpendPlusEstimate?: number };
    };
    assert.equal(payload.result, "succeeded");
    assert.equal(payload.providerTurns, turns);
    assert.ok((payload.folding?.foldingTurns ?? 0) >= 1, "example must demonstrate folding");
    assert.equal(payload.axisEvidence?.windowRatioReached, false, "the window axis must never be satisfied");
    assert.ok(
      (payload.axisEvidence?.firstFoldSpendPlusEstimate ?? 0) >= (payload.axisEvidence?.runBudgetThreshold ?? 0),
      "the example's first fold must be explained by cumulative spend",
    );
  });
});
