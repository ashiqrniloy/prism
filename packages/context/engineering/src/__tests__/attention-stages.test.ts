import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { compileAttention, createAttentionCompiler, createAttentionStickyFrontier, isAttentionBudgetError, measureDraftCost } from "../attention.js";
import type { Message, ModelConfig, } from "@arnilo/prism";
import { resolveToolResultFold } from "../fold.js";

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

/** The draft is one flat list: "in-flight" rows are just appended, newest last. */
function groups(history: Message[], toolResults: Message[] = []): readonly Message[] {
  return [...history, ...toolResults];
}

function compile(
  options: Parameters<typeof createAttentionCompiler>[0],
  target: readonly Message[],
  extra: Partial<Parameters<typeof compileAttention>[0]> = {},
) {
  const compiler = createAttentionCompiler({ maxInputTokens: 400, triggerRatio: 0.5, ...options }, { model });
  return compileAttention({ compiler, messages: target, turn: 9, ...extra });
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
    assert.equal(out.messages, target, "no-op turns keep today's groups identity");
    assert.equal(out.report.used, measureDraftCost({ messages: target }).tokens);
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
      out.messages.map((message) => message.content.some((part) => part.type === "thinking")),
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
      at(out.messages, 0).content.some((part) => part.type === "thinking"),
      false,
    );
    assert.equal(
      at(out.messages, 1).content.some((part) => part.type === "thinking"),
      true,
    );
  });

  it("stubs the oldest tool results and keeps the last keepLast rows full", async () => {
    const history = [1, 2, 3, 4].map((n) => toolMessage(`call_${n}`, "lookup", body(400)));
    const out = await compile({ maxInputTokens: 600, keepLast: 2 }, groups(history));

    assert.equal(out.mutated, true);
    assert.equal(out.report.stubbedToolResults, 2);
    assert.equal(out.report.truncated, false);
    assert.match(String(resultOf(at(out.messages, 0))), stubPattern);
    assert.match(String(resultOf(at(out.messages, 1))), /^Tool result lookup \[call_2\]: omitted \d+ bytes/);
    assert.equal(resultOf(at(out.messages, 2)), body(400));
    assert.equal(resultOf(at(out.messages, 3)), body(400));
    assert.equal(resultOf(at(history, 0)), body(400), "the payload survives in the caller's array");
  });

  it("produces identical stub bytes for identical input", async () => {
    const build = () => groups([toolMessage("call_1", "lookup", body(400)), toolMessage("call_2", "lookup", body(400))]);
    const first = await compile({ maxInputTokens: 400, keepLast: 1 }, build());
    const second = await compile({ maxInputTokens: 400, keepLast: 1 }, build());

    assert.equal(first.mutated, true);
    assert.deepEqual(first.messages, second.messages);
    assert.deepEqual(first.report, second.report);
  });

  it("never stubs a tool named in excludeTools", async () => {
    const history = [toolMessage("call_1", "lookup", body(400)), toolMessage("call_2", "fetch", body(400))];
    const out = await compile({ maxInputTokens: 300, excludeTools: ["lookup"], keepLast: 0 }, groups(history));

    assert.equal(out.report.stubbedToolResults, 1);
    assert.equal(resultOf(at(out.messages, 0)), body(400), "excludeTools wins over the ratio");
    assert.match(String(resultOf(at(out.messages, 1))), /^Tool result fetch \[call_2\]: omitted/);
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
    assert.equal(resultOf(at(out.messages, 0)), undefined, "errors are never stubbed");
    assert.equal(resultOf(at(out.messages, 1)), body(400), "decision payloads are never stubbed");
    assert.match(String(resultOf(at(out.messages, 2))), /^Tool result fetch \[call_plain\]: omitted/);
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
    assert.match(String(resultOf(at(second.messages, 0))), /^Tool result lookup \[call_1\]: omitted/);
    assert.equal(resultOf(at(second.messages, 1)), body(400));
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
      at(second.messages, 0).content.some((part) => part.type === "thinking"),
      false,
    );
    assert.equal(
      at(second.messages, 1).content.some((part) => part.type === "thinking"),
      true,
    );
  });

  it("lets a host summarize win and honours the fold age gate", async () => {
    const history = [1, 2].map((n) => toolMessage(`call_${n}`, "lookup", body(400)));
    const fold = foldOf({ minBytes: 1, summarize: () => "host-summary" });
    const out = await compile({ maxInputTokens: 400, keepLast: 1 }, groups(history), { fold });

    assert.equal(resultOf(at(out.messages, 0)), "Tool result lookup [call_1]: host-summary");

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
    assert.match(String(resultOf(at(out.messages, 0))), /^Tool result lookup \[call_9\]: omitted/);
  });

  it("throws AttentionBudgetError and leaves the groups untouched when still over", async () => {
    const target = groups([toolMessage("call_1", "lookup", body(400))], [toolMessage("call_2", "lookup", body(400))]);
    const snapshot = JSON.stringify(target);

    await assert.rejects(compile({ maxInputTokens: 20, keepLast: 0, excludeTools: ["lookup"] }, target), (error: unknown) => {
      assert.ok(isAttentionBudgetError(error));
      assert.match(String((error as Error).message), /inputCap 20/);
      return true;
    });
    assert.equal(JSON.stringify(target), snapshot, "a thrown gate never rewrites the caller's messages");
    assert.ok(target.length > 0);
  });

});
