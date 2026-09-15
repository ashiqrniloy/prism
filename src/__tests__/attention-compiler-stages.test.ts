import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileAttention, createAttentionCompiler, createAttentionStickyFrontier, isAttentionBudgetError } from "../attention-compiler.js";
import { type ContextBudgetMessageGroups, getContextBudgetReport, measureInputCost } from "../context-budget.js";
import {
  assembleProviderInput,
  createMiddlewareRegistry,
  type Message,
  type ModelConfig,
  resolveToolResultFold,
  type ToolResult,
} from "../index.js";

const model: ModelConfig = { provider: "test", model: "test-model" };

const body = (chars: number) => "x".repeat(chars);

function textMessage(role: Message["role"], text: string, metadata?: Message["metadata"]): Message {
  return { role, content: [{ type: "text", text }], metadata };
}

function assistantWithThinking(text: string, thinking: string): Message {
  return {
    role: "assistant",
    content: [
      { type: "thinking", text: thinking },
      { type: "text", text },
    ],
  };
}

function toolMessage(toolCallId: string, name: string, result: unknown, extra?: Partial<Message>): Message {
  return { role: "tool", content: [{ type: "tool_result", toolCallId, name, result }], ...extra };
}

function groups(history: Message[], toolResults: Message[] = []): ContextBudgetMessageGroups {
  return {
    instructions: [textMessage("system", "Policy")],
    summaries: [],
    history,
    input: [textMessage("user", "go")],
    attachments: [],
    toolResults,
  };
}

function compile(
  options: Parameters<typeof createAttentionCompiler>[0],
  target: ContextBudgetMessageGroups,
  extra: Partial<Parameters<typeof compileAttention>[0]> = {},
) {
  const compiler = createAttentionCompiler({ maxInputTokens: 400, triggerRatio: 0.5, ...options }, { model });
  return compileAttention({ compiler, groups: target, turn: 9, ...extra });
}

const resultOf = (message: Message): unknown => {
  const block = message.content.find((part) => part.type === "tool_result");
  return block?.type === "tool_result" ? block.result : undefined;
};

/** Resolves the fold the specs pass in, without a non-null assertion. */
function foldOf(options: {
  minAgeTurns?: number;
  minBytes?: number;
  summarize: () => string;
}): NonNullable<ReturnType<typeof resolveToolResultFold>> {
  const fold = resolveToolResultFold(options, undefined);
  assert.ok(fold, "fold resolves when summarize is set");
  return fold;
}

/** Index helper so the specs read as data: `noUncheckedIndexedAccess` would force `!` everywhere. */
function at(list: readonly Message[], index: number): Message {
  const message = list[index];
  assert.ok(message, `missing message at index ${index}`);
  return message;
}

const stubPattern = /^Tool result \w+ \[\w+\]: omitted \d+ bytes \(sha256 [0-9a-f]{32}\)$/;

describe("attention compiler stages", () => {
  it("under ratio mutates nothing and returns the same groups object", async () => {
    const history = [assistantWithThinking("a", "reasoning"), toolMessage("call_1", "lookup", body(10))];
    const target = groups(history);
    const out = await compile({ maxInputTokens: 4_000 }, target);

    assert.equal(out.mutated, false);
    assert.equal(out.groups, target, "no-op turns keep today's groups identity");
    assert.equal(out.report.used, measureInputCost({ groups: target }).tokens);
    assert.equal(out.report.inputCap, 4_000);
    assert.equal(out.report.triggerRatio, 0.5);
    assert.equal(out.report.droppedThinkingTurns, 0);
    assert.equal(out.report.stubbedToolResults, 0);
    assert.equal(out.report.truncated, false);
    assert.deepEqual(at(history, 0).content[0], { type: "thinking", text: "reasoning" });
  });

  it("strips oldest thinking first and keeps the newest thinkingKeepTurns turns", async () => {
    const history = [
      assistantWithThinking("one", body(300)),
      assistantWithThinking("two", body(300)),
      assistantWithThinking("three", body(300)),
    ];
    const before = structuredClone(history);
    const out = await compile({ maxInputTokens: 200 }, groups(history));

    assert.equal(out.mutated, true);
    assert.equal(out.report.droppedThinkingTurns, 2);
    assert.equal(out.report.truncated, false, "the newest thinking turn is kept by config, not skipped by the gate");
    assert.deepEqual(
      out.groups.history.map((message) => message.content.some((part) => part.type === "thinking")),
      [false, false, true],
    );
    assert.deepEqual(history, before, "the caller's history array is untouched");
  });

  it("counts thinking turns, not assistant messages, for thinkingKeepTurns", async () => {
    const history = [
      assistantWithThinking("one", body(300)),
      assistantWithThinking("two", body(10)),
      textMessage("assistant", "no reasoning here"),
    ];
    const out = await compile({ maxInputTokens: 100, thinkingKeepTurns: 1 }, groups(history));

    assert.equal(out.report.droppedThinkingTurns, 1);
    assert.equal(
      at(out.groups.history, 0).content.some((part) => part.type === "thinking"),
      false,
    );
    assert.equal(
      at(out.groups.history, 1).content.some((part) => part.type === "thinking"),
      true,
    );
  });

  it("stubs the oldest tool results and keeps the last keepLast rows full", async () => {
    const history = [1, 2, 3, 4].map((n) => toolMessage(`call_${n}`, "lookup", body(400)));
    const out = await compile({ maxInputTokens: 600, keepLast: 2 }, groups(history));

    assert.equal(out.mutated, true);
    assert.equal(out.report.stubbedToolResults, 2);
    assert.equal(out.report.truncated, false);
    assert.match(String(resultOf(at(out.groups.history, 0))), stubPattern);
    assert.match(String(resultOf(at(out.groups.history, 1))), /^Tool result lookup \[call_2\]: omitted \d+ bytes/);
    assert.equal(resultOf(at(out.groups.history, 2)), body(400));
    assert.equal(resultOf(at(out.groups.history, 3)), body(400));
    assert.equal(resultOf(at(history, 0)), body(400), "the payload survives in the caller's array");
  });

  it("produces identical stub bytes for identical input", async () => {
    const build = () => groups([toolMessage("call_1", "lookup", body(400)), toolMessage("call_2", "lookup", body(400))]);
    const first = await compile({ maxInputTokens: 400, keepLast: 1 }, build());
    const second = await compile({ maxInputTokens: 400, keepLast: 1 }, build());

    assert.equal(first.mutated, true);
    assert.deepEqual(first.groups.history, second.groups.history);
    assert.deepEqual(first.report, second.report);
  });

  it("never stubs a tool named in excludeTools", async () => {
    const history = [toolMessage("call_1", "lookup", body(400)), toolMessage("call_2", "fetch", body(400))];
    const out = await compile({ maxInputTokens: 300, excludeTools: ["lookup"], keepLast: 0 }, groups(history));

    assert.equal(out.report.stubbedToolResults, 1);
    assert.equal(resultOf(at(out.groups.history, 0)), body(400), "excludeTools wins over the ratio");
    assert.match(String(resultOf(at(out.groups.history, 1))), /^Tool result fetch \[call_2\]: omitted/);
  });

  it("never stubs tool errors or decision payloads", async () => {
    const history = [
      toolMessage("call_error", "io", undefined, {
        content: [{ type: "tool_result", toolCallId: "call_error", name: "io", error: { message: "boom" } }],
      }),
      toolMessage("call_approval", "io", body(400), { metadata: { approvalId: "approval-1" } }),
      toolMessage("call_plain", "fetch", body(4_000)),
    ];
    const out = await compile({ maxInputTokens: 2_000, keepLast: 0 }, groups(history));

    assert.equal(out.report.stubbedToolResults, 1);
    assert.equal(resultOf(at(out.groups.history, 0)), undefined, "errors are never stubbed");
    assert.equal(resultOf(at(out.groups.history, 1)), body(400), "decision payloads are never stubbed");
    assert.match(String(resultOf(at(out.groups.history, 2))), /^Tool result fetch \[call_plain\]: omitted/);
  });

  it("keeps a stubbed call id stubbed on a later under-ratio turn", async () => {
    const frontier = createAttentionStickyFrontier();
    const rows = () => [toolMessage("call_1", "lookup", body(400)), toolMessage("call_2", "lookup", body(400))];
    const first = await compile({ maxInputTokens: 400, keepLast: 0 }, groups(rows()), { frontier });

    assert.equal(first.mutated, true);
    assert.equal(first.report.stubbedToolResults, 1);
    assert.equal(first.report.truncated, true, "the gate stopped with call_2 eligible but no longer over");

    const second = await compile({ maxInputTokens: 10_000, keepLast: 0 }, groups(rows()), { frontier });

    assert.equal(second.mutated, true, "sticky mutations are re-applied under the ratio");
    assert.match(String(resultOf(at(second.groups.history, 0))), /^Tool result lookup \[call_1\]: omitted/);
    assert.equal(resultOf(at(second.groups.history, 1)), body(400));
    assert.equal(second.report.stubbedToolResults, 1);
    assert.equal(second.report.truncated, true);
  });

  it("keeps stripped thinking stripped on a later under-ratio turn", async () => {
    const frontier = createAttentionStickyFrontier();
    const history = () => [assistantWithThinking("one", body(300)), assistantWithThinking("two", body(10))];
    await compile({ maxInputTokens: 100 }, groups(history()), { frontier });

    const second = await compile({ maxInputTokens: 10_000 }, groups(history()), { frontier });

    assert.equal(second.mutated, true);
    assert.equal(second.report.droppedThinkingTurns, 1);
    assert.equal(
      at(second.groups.history, 0).content.some((part) => part.type === "thinking"),
      false,
    );
    assert.equal(
      at(second.groups.history, 1).content.some((part) => part.type === "thinking"),
      true,
    );
  });

  it("lets a host summarize win and honours the fold age gate", async () => {
    const history = [1, 2].map((n) => toolMessage(`call_${n}`, "lookup", body(400)));
    const fold = foldOf({ minBytes: 1, summarize: () => "host-summary" });
    const out = await compile({ maxInputTokens: 400, keepLast: 1 }, groups(history), { fold });

    assert.equal(resultOf(at(out.groups.history, 0)), "Tool result lookup [call_1]: host-summary");

    await assert.rejects(
      compile({ maxInputTokens: 400, keepLast: 1 }, groups(history), {
        fold: foldOf({ minAgeTurns: 100, minBytes: 1, summarize: () => "host-summary" }),
      }),
      (error: unknown) => {
        assert.ok(isAttentionBudgetError(error), "a row the host fold would not touch is not stubbed either");
        return true;
      },
    );
  });

  it("stubs in-flight tool results once keepLast stops protecting them", async () => {
    const out = await compile({ maxInputTokens: 200, keepLast: 0 }, groups([], [toolMessage("call_9", "lookup", body(400))]));

    assert.equal(out.report.stubbedToolResults, 1);
    assert.match(String(resultOf(at(out.groups.toolResults, 0))), /^Tool result lookup \[call_9\]: omitted/);
  });

  it("throws AttentionBudgetError and leaves the groups untouched when still over", async () => {
    const target = groups([toolMessage("call_1", "lookup", body(400))], [toolMessage("call_2", "lookup", body(400))]);
    const snapshot = JSON.stringify(target);

    await assert.rejects(compile({ maxInputTokens: 20, keepLast: 0, excludeTools: ["lookup"] }, target), (error: unknown) => {
      assert.ok(isAttentionBudgetError(error));
      assert.match(String((error as Error).message), /inputCap 20/);
      return true;
    });
    assert.equal(JSON.stringify(target), snapshot, "a thrown gate never rewrites the caller's groups");
    assert.ok(target.instructions.length > 0 && target.input.length > 0);
  });

  it("passes the compiler through assembly and keeps the caller's history intact", async () => {
    const history = [toolMessage("call_1", "lookup", body(4_000))];
    const request = await assembleProviderInput({
      model,
      input: "next",
      history,
      turn: 3,
      attentionCompiler: { maxInputTokens: 200, triggerRatio: 0.5, keepLast: 0 },
    });
    const serialized = JSON.stringify(request.messages);

    assert.match(serialized, /Tool result lookup \[call_1\]: omitted \d+ bytes \(sha256 [0-9a-f]{32}\)/);
    assert.doesNotMatch(serialized, /x{200}/);
    assert.equal(resultOf(at(history, 0)), body(4_000));
  });

  it("under ratio the assembled request is deep-equal to the compiler-off request", async () => {
    const history = [assistantWithThinking("a", body(20)), toolMessage("call_1", "lookup", body(20))];
    const withCompiler = await assembleProviderInput({
      model,
      input: "next",
      history,
      turn: 3,
      attentionCompiler: { maxInputTokens: 100_000, triggerRatio: 0.5 },
    });
    const withoutCompiler = await assembleProviderInput({ model, input: "next", history, turn: 3 });

    assert.deepEqual(withCompiler, withoutCompiler);
  });

  it("runs input_assembly middleware once with the compiler on", async () => {
    const calls: string[] = [];
    const middleware = createMiddlewareRegistry();
    middleware.use<readonly Message[]>("input_assembly", (messages) => {
      calls.push(`assembly:${messages.length}`);
      return messages;
    });
    await assembleProviderInput({
      model,
      input: "next",
      history: [toolMessage("call_1", "lookup", body(400))],
      turn: 3,
      middleware,
      attentionCompiler: { maxInputTokens: 120, triggerRatio: 0.5, keepLast: 0 },
    });

    assert.deepEqual(calls, ["assembly:2"]);
  });

  it("rejects pairing the compiler with contextBudget and leaves compiler-off eviction alone", async () => {
    await assert.rejects(
      assembleProviderInput({
        model,
        input: "next",
        history: [toolMessage("call_1", "lookup", body(400))],
        attentionCompiler: { maxInputTokens: 120 },
        contextBudget: { maxInputTokens: 20 },
      }),
      /mutually exclusive/,
    );

    const request = await assembleProviderInput({
      model,
      input: "next",
      history: [textMessage("assistant", body(400))],
      contextBudget: { maxInputTokens: 20, reportOmissions: true },
    });
    assert.equal(getContextBudgetReport(request)?.truncated, true);
  });

  it("accepts a resolved compiler handle and validates raw options per call", async () => {
    const compiler = createAttentionCompiler({ maxInputTokens: 120, keepLast: 0 }, { model });
    const handle = await assembleProviderInput({
      model,
      input: "next",
      history: [toolMessage("call_1", "lookup", body(400))],
      turn: 3,
      attentionCompiler: compiler,
    });
    assert.match(JSON.stringify(handle.messages), /omitted \d+ bytes/);

    await assert.rejects(
      assembleProviderInput({ model, input: "next", history: [], attentionCompiler: {} }),
      /maxInputTokens or model\.limits\.contextWindow/,
    );
  });

  it("uses the in-flight tool results group as the newest rows", async () => {
    const results: ToolResult[] = [{ toolCallId: "call_new", name: "lookup", value: body(400) }];
    const request = await assembleProviderInput({
      model,
      input: "next",
      turn: 3,
      history: [toolMessage("call_old", "lookup", body(400))],
      toolResults: results,
      attentionCompiler: { maxInputTokens: 400, triggerRatio: 0.5, keepLast: 1 },
    });
    const serialized = JSON.stringify(request.messages);

    assert.match(serialized, /Tool result lookup \[call_old\]: omitted/);
    assert.match(serialized, /x{200}/, "the newest in-flight result stays full");
  });
});
