/**
 * Budget-capped long run (plan 086 Task 4), no credentials and no network: a 1M-token model window,
 * a 500k run input budget, and a 24-turn investigation. Per request the window ratio is never near:
 * the assembled request stays in the low thousands of tokens, so the legacy `input_ratio` axis can
 * never fire. What grows is the *run* — provider usage accumulates turn after turn — and the
 * `run_input_ratio` axis opens the fold gate on that cumulative spend, which no per-request axis can
 * see. That is the synapta H12 shape: the long single run gets a mid-run point where old tool bodies
 * become stubs and the investigation continues instead of dying on the token cap.
 *
 * The run budget is not exhausted: folding keeps spend under the cap, which is what makes the axis a
 * safety valve rather than a post-mortem.
 *
 * Run: npm run build:core && node examples/attention-budget-axes.ts
 */
import {
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
  type Usage,
} from "@arnilo/prism";

/** The scenario: 1M window, 500k run input budget, 24 provider turns. */
const contextWindow = 1_000_000;
const runInputBudget = 500_000;
const turns = 24;
/** 1% of the run budget: the cumulative gate, crossed long before any per-request ratio. */
const runAxisRatio = 0.01;
/** The window axis stays on the gate as a second axis, so the report always names which one fired. */
const inputAxisRatio = 0.75;
const keepLast = 2;

const model = { provider: "mock", model: "demo", limits: { contextWindow, maxOutputTokens: 8_192 } };

let requestCount = 0;
let spentInputTokens = 0;
const requests: ProviderRequest[] = [];
/** One row per tool call, ~1.2 KB each: small per turn, additive over the run. */
const row = (turn: number) => `row ${turn} ${"y".repeat(1_200)}`;

const agent = createAgent({
  id: "budget-axes-demo",
  model,
  store: createMemorySessionStore(),
  tools: [
    {
      name: "scan",
      parameters: { type: "object", properties: {} },
      execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "scan", value: row(requestCount) }),
    },
  ],
  attentionCompiler: {
    // Any-of, first axis that fires wins and is reported: the window axis cannot fire here, so the
    // run-budget axis is the one that opens the gate.
    trigger: [
      { kind: "input_ratio", ratio: inputAxisRatio },
      { kind: "run_input_ratio", ratio: runAxisRatio },
    ],
    keepLast,
    thinkingKeepTurns: 1,
  },
  provider: {
    id: "mock",
    async *generate(request) {
      requests.push(request);
      requestCount += 1;
      // What a provider would bill for this turn: the assembled request at 4 bytes per token.
      const usage: Usage = { inputTokens: Math.ceil(JSON.stringify(request.messages).length / 4), outputTokens: 8 };
      spentInputTokens += usage.inputTokens ?? 0;
      if (requestCount < turns) yield providerToolCall(toolCallContent(`call-${requestCount}`, "scan", {}));
      else yield providerTextDelta("investigation complete");
      yield providerDone(usage);
    },
  },
});

const session = agent.createSession({ id: "budget-axes-session" });
/** One entry per mutated turn. Assembly runs before the provider call, so `requestCount + 1` is the
 *  turn this report belongs to and `spentInputTokens` is the spend of the turns before it. */
interface CompiledTurn {
  turn: number;
  used: number;
  usedAfter: number;
  inputCap: number;
  stubbed: number;
  stubbedBytes: number;
  spendBefore: number;
  truncated: boolean;
}
const compiled: CompiledTurn[] = [];
const events: AgentEvent[] = [];
const reader = (async () => {
  for await (const event of session.subscribe()) {
    events.push(event);
    if (event.type === "attention_compiled") {
      compiled.push({
        turn: requestCount + 1,
        used: event.used,
        usedAfter: event.usedAfter,
        inputCap: event.inputCap,
        stubbed: event.stubbedToolResults,
        stubbedBytes: event.stubbedBytes,
        spendBefore: spentInputTokens,
        truncated: event.truncated,
      });
    }
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

const folds = compiled.filter((turn) => turn.stubbed > 0);
const first = folds[0];
const runBudgetThreshold = runAxisRatio * runInputBudget;
const windowThreshold = inputAxisRatio * (compiled[0]?.inputCap ?? 0);
const stub = /omitted \d+ bytes \(sha256 [0-9a-f]{32}\)/;
const finalToolResults = (requests.at(-1)?.messages ?? []).flatMap((message) =>
  message.content.flatMap((block) => (block.type === "tool_result" ? [String(block.result)] : [])),
);

console.log(
  JSON.stringify(
    {
      scenario: { contextWindow, runInputBudget, turns, runAxisRatio, inputAxisRatio, keepLast },
      result: result.status,
      providerTurns: requestCount,
      runInputTokensSpent: spentInputTokens,
      folding: {
        mutatedTurns: compiled.length,
        foldingTurns: folds.length,
        firstFoldTurn: first?.turn,
        stubbedToolResults: compiled.reduce((sum, turn) => sum + turn.stubbed, 0),
        stubbedBytes: compiled.reduce((sum, turn) => sum + turn.stubbedBytes, 0),
      },
      perTurn: compiled.map((turn) => ({
        turn: turn.turn,
        used: turn.used,
        usedAfter: turn.usedAfter,
        stubbed: turn.stubbed,
        truncated: turn.truncated,
      })),
      // Why it fired: no request ever reached the window ratio, and at the first fold the
      // single-request estimate was far below the cumulative threshold while spend + estimate
      // was over it — so only an axis that reads accumulation can explain the gate opening.
      axisEvidence: {
        windowThreshold,
        runBudgetThreshold,
        maxUsed: Math.max(0, ...compiled.map((turn) => turn.used)),
        windowRatioReached: compiled.some((turn) => turn.used >= windowThreshold),
        spendBeforeFirstFold: first?.spendBefore,
        firstFoldSpendPlusEstimate: first ? first.spendBefore + first.used : undefined,
      },
      // Projection only, and sticky: the newest `keepLast` rows stay raw, the older ones are stubs
      // whose bytes are already gone from the request.
      finalRequest: {
        toolResults: finalToolResults.length,
        stubbed: finalToolResults.filter((text) => stub.test(text)).length,
        raw: finalToolResults.filter((text) => !stub.test(text)).length,
        used: compiled.at(-1)?.used,
      },
    },
    null,
    2,
  ),
);
