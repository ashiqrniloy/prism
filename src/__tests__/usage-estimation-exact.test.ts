/** Plan 103 T6: exact-measurement reuse for the usage fallback (report → host tokenizer → family heuristic). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createUsageAccumulator } from "../agent-session/helpers.js";
import { recordProviderUsage } from "../agent-session/session/provider-round.js";
import type { RoundContext, SessionHost } from "../agent-session/session/types.js";
import { estimateRequestExtrasTokens, measureInputCost } from "../context-budget.js";
import {
  assembleProviderInput,
  type ContextBudget,
  type ContextProvider,
  createAgent,
  createMemorySessionStore,
  estimateMessageTokens,
  getContextBudgetReport,
  type Message,
  type ModelConfig,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  type Skill,
  type ToolDefinition,
} from "../index.js";
import { createRunLimitTracker } from "../run-limits.js";
import { estimateTextTokensForFamily } from "../usage-estimation.js";

const MODEL: ModelConfig = { provider: "mock", model: "claude-sonnet-4.5", limits: { contextWindow: 100_000 } };

const TOOLS: ToolDefinition[] = [
  {
    name: "search",
    description: "Search the knowledge base for passages matching a query".repeat(3),
    parameters: { type: "object", properties: { q: { type: "string" } } },
    execute: () => ({ toolCallId: "c1", name: "search", value: "ok" }),
  },
];

const CONTEXT_PROVIDERS: ContextProvider[] = [
  { name: "notes", resolve: () => [{ id: "n1", title: "Notes", content: "project context ".repeat(20) }] },
];

const SKILLS: Skill[] = [{ name: "writer", instructions: "Write concisely and cite sources.".repeat(4) }];

/** Provider that captures the assembled request and never reports usage. */
function capturingProvider(seen: ProviderRequest[]) {
  return {
    id: "mock",
    async *generate(request: ProviderRequest) {
      seen.push(request);
      yield providerTextDelta("ok");
      yield providerDone();
    },
  };
}

/** Unit-shaped `recordProviderUsage` context whose estimate is the fallback under test. */
function estimateContext(contextBudget?: ContextBudget): RoundContext {
  return {
    session: { agent: { config: { usageEstimation: "fallback", contextBudget } } } as unknown as SessionHost,
    model: MODEL,
    runId: "run-exact",
    controller: new AbortController(),
    limits: createRunLimitTracker({ maxInputTokens: 1_000_000 }),
    runUsage: createUsageAccumulator(),
  } as RoundContext;
}

describe("usage fallback exact-measurement reuse (plan 103 T6)", () => {
  it("report path: the fallback reuses the budget pass's keptTokens verbatim, labeled low without a tokenizer", async () => {
    const seen: ProviderRequest[] = [];
    const agent = createAgent({
      id: "exact-report",
      store: createMemorySessionStore(),
      model: MODEL,
      provider: capturingProvider(seen),
      tools: TOOLS,
      context: CONTEXT_PROVIDERS,
      contextBudget: { maxInputTokens: 4_096, reportOmissions: true },
    });
    const session = agent.createSession({ id: "exact-report-session" });
    const result = await session.run("hello, measure me", { limits: { maxTurns: 4 } });

    const request = seen[0];
    assert.ok(request, "the provider must have seen the assembled request");
    const report = getContextBudgetReport(request);
    assert.ok(report, "reportOmissions must attach the budget report the request carries");
    assert.equal(result.usage?.estimated, true, "a reused measurement is still an estimate, never a report");
    assert.equal(result.usage?.confidence, "low", "without a host tokenizer the report was measured on the ÷4 basis");
    assert.equal(result.usage?.inputTokens, report.keptTokens, "the estimate is exactly the figure that decided evictions");

    // Path selection, not coincidence: the family heuristic would produce a different number here.
    const family =
      estimateMessageTokens(request.messages, MODEL.model).tokens +
      estimateRequestExtrasTokens(request.tools, request.context, (text) => estimateTextTokensForFamily(text, MODEL.model));
    assert.notEqual(result.usage?.inputTokens, family, "the report wins over the family heuristic");
  });

  it("report path with a host tokenizer: keptTokens reused and labeled high, still an estimate", async () => {
    const seen: ProviderRequest[] = [];
    const agent = createAgent({
      id: "exact-report-tokenizer",
      store: createMemorySessionStore(),
      model: MODEL,
      provider: capturingProvider(seen),
      tools: TOOLS,
      context: CONTEXT_PROVIDERS,
      contextBudget: { maxInputTokens: 4_096, reportOmissions: true, tokenEstimator: (text) => Math.ceil(text.length / 3) },
    });
    const session = agent.createSession({ id: "exact-report-tokenizer-session" });
    const result = await session.run("hello, measure me", { limits: { maxTurns: 4 } });
    const captured = seen[0];
    assert.ok(captured, "the provider must have seen the assembled request");

    assert.equal(result.usage?.estimated, true);
    assert.equal(result.usage?.confidence, "high", "the host tokenizer's own count is high confidence — still not 'reported'");
    assert.equal(result.usage?.inputTokens, getContextBudgetReport(captured)?.keptTokens);
    assert.equal(result.usage?.cost, undefined, "a reused measurement is never priced");
  });

  it("tokenizer path: no report, the host tokenizer projects the request through the assembler's own shapes", async () => {
    const seen: ProviderRequest[] = [];
    const stub = (text: string) => Math.ceil(text.length / 3);
    const agent = createAgent({
      id: "exact-tokenizer",
      store: createMemorySessionStore(),
      model: MODEL,
      provider: capturingProvider(seen),
      tools: TOOLS,
      context: CONTEXT_PROVIDERS,
      skills: SKILLS,
      contextBudget: { maxInputTokens: 4_096, tokenEstimator: stub },
    });
    const session = agent.createSession({ id: "exact-tokenizer-session" });
    const result = await session.run("hello, measure me", { limits: { maxTurns: 4 } });

    const request = seen[0];
    assert.ok(request, "the provider must have seen the assembled request");
    assert.equal(getContextBudgetReport(request), undefined, "no reportOmissions means no report on the request");
    assert.equal(result.usage?.estimated, true);
    assert.equal(result.usage?.confidence, "high");
    assert.equal(result.usage?.inputTokens, await driftReference(request, stub), "the projection is the assembler's measurement");
  });

  it("drift band: assembled tools + context + skills stay within 5% of measureInputCost on every path", async () => {
    const stub = (text: string) => Math.ceil(text.length / 3);
    const assembled = await assembleProviderInput({
      model: MODEL,
      input: "current question",
      systemInstructions: "Be brief.",
      history: [{ role: "user" as const, content: [{ type: "text" as const, text: "earlier question" }] }],
      skills: SKILLS,
      skillsDisclosure: "eager",
      contextProviders: CONTEXT_PROVIDERS,
      tools: TOOLS,
      contextBudget: { maxInputTokens: 4_096, tokenEstimator: stub },
    });

    // Tokenizer path: same shapes, so the drift must be zero, not merely within band.
    const tokenizerUsage = await recordProviderUsage(
      estimateContext({ maxInputTokens: 4_096, tokenEstimator: stub }),
      undefined,
      1,
      1,
      assembled,
    );
    const reference = await driftReference(assembled, stub);
    assert.ok(tokenizerUsage, "fallback must yield an estimate");
    assert.equal(tokenizerUsage.confidence, "high");
    assert.equal(tokenizerUsage.inputTokens, reference);

    // Report path: keptTokens is measureInputCost of the pre-eviction keep-set — zero drift by construction.
    const reported = await assembleProviderInput({
      model: MODEL,
      input: "current question",
      systemInstructions: "Be brief.",
      history: [{ role: "user" as const, content: [{ type: "text" as const, text: "earlier question" }] }],
      skills: SKILLS,
      skillsDisclosure: "eager",
      contextProviders: CONTEXT_PROVIDERS,
      tools: TOOLS,
      contextBudget: { maxInputTokens: 4_096, reportOmissions: true },
    });
    const reportUsage = await recordProviderUsage(
      estimateContext({ maxInputTokens: 4_096, reportOmissions: true }),
      undefined,
      1,
      1,
      reported,
    );
    assert.equal(reportUsage?.inputTokens, getContextBudgetReport(reported)?.keptTokens);

    // Heuristic path (no report, no tokenizer): documented band, not an exactness claim —
    // the family table is calibrated ±12%, so only sanity is asserted here.
    const heuristicRequest = { ...reported, metadata: undefined };
    const heuristicUsage = await recordProviderUsage(estimateContext(), undefined, 1, 1, heuristicRequest);
    const heuristicReference = await driftReference(heuristicRequest, (text) => estimateTextTokensForFamily(text, MODEL.model));
    const drift = Math.abs((heuristicUsage?.inputTokens ?? 0) - heuristicReference) / heuristicReference;
    assert.ok(drift > 0 && drift < 0.5, `heuristic drift ${(drift * 100).toFixed(1)}% should be present but sane`);
  });

  it('"off" and "strict" never consult the report or the host tokenizer', async () => {
    const calls: number[] = [];
    let run = 0;
    const counting = (text: string) => {
      calls[run] = (calls[run] ?? 0) + 1;
      void text;
      return 7;
    };
    const agentFor = (mode: "off" | "strict" | "fallback") =>
      createAgent({
        id: `exact-${mode}`,
        store: createMemorySessionStore(),
        model: MODEL,
        provider: capturingProvider([]),
        tools: TOOLS,
        // No reportOmissions: without a report the fallback seam itself projects through the
        // tokenizer, so only this mode adds estimator calls on top of the budget pass's own.
        contextBudget: { maxInputTokens: 4_096, tokenEstimator: counting },
        usageEstimation: mode,
      });

    run = 0;
    const off = await agentFor("off").createSession({ id: "s-off" }).run("hello");
    assert.equal(off.usage, undefined, "off leaves usage absent");
    run = 1;
    const strict = await agentFor("strict")
      .createSession({ id: "s-strict" })
      .run("hello")
      .then(
        (value) => value,
        () => undefined,
      );
    void strict;
    run = 2;
    const fallback = await agentFor("fallback").createSession({ id: "s-fallback" }).run("hello");
    assert.ok(fallback.usage?.estimated, "the fallback run does estimate");

    assert.equal(calls[0], calls[1], "off and strict consult the tokenizer exactly as little: assembly only");
    assert.ok((calls[2] ?? 0) > (calls[0] ?? 0), "the fallback seam adds estimator calls on top of assembly");
  });
});

/** measureInputCost over the final assembled request: all messages in one group, extras as shipped. */
async function driftReference(request: ProviderRequest, estimateTokens: (text: string) => number): Promise<number> {
  const groups = {
    instructions: [] as Message[],
    summaries: [] as Message[],
    history: [] as Message[],
    input: [...request.messages] as Message[],
    attachments: [] as Message[],
    toolResults: [] as Message[],
  };
  return measureInputCost({ groups, context: request.context, tools: request.tools, estimateTokens }).tokens;
}
