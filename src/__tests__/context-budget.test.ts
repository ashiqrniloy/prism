import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyContextBudget,
  assembleProviderInput,
  CONTEXT_BUDGET_REPORT_METADATA_KEY,
  ContextBudgetError,
  type ContextProvider,
  estimateTextTokens,
  getContextBudgetReport,
  HARD_MAX_CONTEXT_BUDGET_TOKENS,
  isContextBudgetError,
  type Message,
  type ModelConfig,
  resolveContextBudget,
  type Skill,
} from "../index.js";

const model: ModelConfig = { provider: "test", model: "test-model" };

function user(text: string, id?: string): Message {
  return { id, role: "user", content: [{ type: "text", text }] };
}

function assistant(text: string, id?: string): Message {
  return { id, role: "assistant", content: [{ type: "text", text }] };
}

describe("context budget", () => {
  it("resolveContextBudget requires a max and rejects oversize caps", () => {
    assert.throws(() => resolveContextBudget({}), TypeError);
    assert.throws(() => resolveContextBudget({ maxInputTokens: 0 }), TypeError);
    assert.throws(() => resolveContextBudget({ maxInputTokens: HARD_MAX_CONTEXT_BUDGET_TOKENS + 1 }), TypeError);
    assert.equal(resolveContextBudget({ maxInputTokens: 100 }).reportOmissions, false);
  });

  it("evicts history/tool results before context and skills", async () => {
    const history: Message[] = [assistant("old-a", "h1"), user("old-b", "h2")];
    const skills: Skill[] = [{ name: "skill-a", instructions: "skill body" }];
    const contextProviders: ContextProvider[] = [
      {
        name: "ctx",
        resolve: () => [{ id: "ctx-1", title: "Ctx", content: "context body" }],
      },
    ];
    const oversizedHistory = "x".repeat(400); // 100 tokens
    history[0] = assistant(oversizedHistory, "h1");

    const request = await assembleProviderInput({
      model,
      input: "current question",
      systemInstructions: "Be brief.",
      history,
      skills,
      contextProviders,
      toolResults: [{ toolCallId: "call_1", name: "lookup", value: { ok: true } }],
      contextBudget: {
        // Fit instructions + input + skill + context; force tool/history out.
        maxInputTokens:
          estimateTextTokens("System instruction:\nBe brief.") +
          estimateTextTokens("current question") +
          estimateTextTokens("Skill skill-a:\nskill body") +
          estimateTextTokens("Ctx:\ncontext body") +
          20,
        reportOmissions: true,
      },
    });

    const report = getContextBudgetReport(request);
    assert.ok(report);
    assert.equal(report.truncated, true);
    assert.ok(report.omitted.some((row) => row.kind === "tool_results"));
    assert.ok(report.omitted.some((row) => row.kind === "history"));
    assert.ok(!report.omitted.some((row) => row.kind === "skills"));
    assert.ok(!report.omitted.some((row) => row.kind === "context"));
    assert.ok(
      request.messages.some((message) => message.content.some((part) => part.type === "text" && part.text.includes("current question"))),
    );
    assert.ok(request.messages.some((message) => message.content.some((part) => part.type === "text" && part.text.includes("skill body"))));
    assert.doesNotMatch(JSON.stringify(report.omitted), /old-a|old-b|lookup/);
  });

  it("report kept totals match the content that survives eviction", () => {
    const groups = {
      instructions: [{ role: "system" as const, content: [{ type: "text" as const, text: "Be brief." }] }],
      summaries: [user("s".repeat(400), "sum")],
      history: [assistant("h".repeat(400), "h1"), user("h".repeat(400), "h2")],
      input: [user("current question")],
      attachments: [{ role: "user" as const, content: [{ type: "text" as const, text: `Attachment notes.md:\n${"a".repeat(400)}` }] }],
      toolResults: [
        { role: "user" as const, content: [{ type: "tool_result" as const, toolCallId: "c1", name: "lookup", result: "r".repeat(400) }] },
      ],
    };
    const first = applyContextBudget({
      groups,
      context: [{ id: "ctx-1", title: "Ctx", content: "c".repeat(400) }],
      skills: [{ name: "skill-a", instructions: "i".repeat(400) }],
      budget: {
        maxInputTokens: estimateTextTokens("System instruction:\nBe brief.") + estimateTextTokens("current question") + 40,
        reportOmissions: true,
      },
    });
    // Multiple kinds had to be evicted to fit.
    assert.ok(first.report.truncated);
    assert.ok(first.report.omitted.length >= 3);

    // Re-running on the surviving content must omit nothing and reproduce the same
    // kept totals — proves incremental accounting stayed exact through every drop.
    const second = applyContextBudget({
      groups: first.groups,
      context: first.context,
      skills: first.skills,
      tools: first.tools,
      budget: { maxInputTokens: HARD_MAX_CONTEXT_BUDGET_TOKENS, reportOmissions: true },
    });
    assert.equal(second.report.truncated, false);
    assert.equal(first.report.keptTokens, second.report.keptTokens);
    assert.equal(first.report.keptBytes, second.report.keptBytes);
    assert.ok(
      first.report.keptTokens <= 40 + estimateTextTokens("System instruction:\nBe brief.") + estimateTextTokens("current question"),
    );
  });

  it("fails closed when mandatory prefix cannot fit", async () => {
    await assert.rejects(
      () =>
        assembleProviderInput({
          model,
          input: "x".repeat(400),
          systemInstructions: "y".repeat(400),
          contextBudget: { maxInputTokens: 1, reportOmissions: true },
        }),
      (error: unknown) => error instanceof ContextBudgetError && isContextBudgetError(error),
    );
  });

  it("keeps cache_aware attachment prefix while dropping history", async () => {
    const historyText = `drop-me-${"h".repeat(200)}`;
    const request = await assembleProviderInput({
      model,
      input: "ask",
      inputLayout: "cache_aware",
      systemInstructions: "sys",
      attachments: [{ name: "notes.md", text: "stable attachment" }],
      history: [assistant(historyText, "hist")],
      contextBudget: {
        maxInputTokens:
          estimateTextTokens("System instruction:\nsys") +
          estimateTextTokens("Attachment notes.md:\nstable attachment") +
          estimateTextTokens("ask") +
          4,
        reportOmissions: true,
      },
    });
    const report = getContextBudgetReport(request)!;
    assert.ok(report.omitted.some((row) => row.kind === "history"));
    assert.ok(!report.omitted.some((row) => row.kind === "attachments"));
    assert.ok(
      request.messages.some((message) =>
        message.content.some((part) => part.type === "text" && String(part.text).includes("stable attachment")),
      ),
    );
  });

  it("omits report metadata unless reportOmissions is true", async () => {
    const request = await assembleProviderInput({
      model,
      input: "hi",
      history: [assistant("old")],
      contextBudget: { maxInputTokens: 50 },
    });
    assert.equal(getContextBudgetReport(request), undefined);
    assert.equal(request.metadata?.[CONTEXT_BUDGET_REPORT_METADATA_KEY], undefined);
  });
});
