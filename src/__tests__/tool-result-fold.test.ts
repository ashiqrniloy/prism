import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assembleProviderInput,
  DEFAULT_TOOL_RESULT_FOLD_MIN_AGE_TURNS,
  DEFAULT_TOOL_RESULT_FOLD_MIN_BYTES,
  foldToolResultHistory,
  foldedToolResultHeader,
  resolveToolResultFold,
  TOOL_RESULT_FOLD_TURN_METADATA_KEY,
  type Message,
  type ModelConfig,
  type ToolResult,
} from "../index.js";

const model: ModelConfig = { provider: "test", model: "test-model" };

function toolMessage(toolCallId: string, name: string, result: unknown, turn?: number): Message {
  return {
    role: "tool",
    content: [{ type: "tool_result", toolCallId, name, result }],
    metadata: turn === undefined ? undefined : { [TOOL_RESULT_FOLD_TURN_METADATA_KEY]: turn },
  };
}

describe("tool result fold", () => {
  it("resolveToolResultFold is disabled without summarize", () => {
    assert.equal(resolveToolResultFold(undefined, undefined), undefined);
    assert.equal(resolveToolResultFold({ minAgeTurns: 1 } as never, undefined), undefined);
  });

  it("default off leaves tool results unchanged in assembly", async () => {
    const history: Message[] = [
      { role: "assistant", content: [{ type: "text", text: "call tool" }] },
      toolMessage("call_1", "lookup", "x".repeat(5_000), 1),
    ];
    const request = await assembleProviderInput({
      model,
      input: "next",
      history,
      turn: 3,
    });
    const text = JSON.stringify(request.messages);
    assert.match(text, /x{100}/);
    assert.doesNotMatch(text, /Tool result lookup \[call_1\]/);
  });

  it("folds aged large tool results in provider view only", async () => {
    const raw = `payload-${"x".repeat(DEFAULT_TOOL_RESULT_FOLD_MIN_BYTES)}`;
    const history: Message[] = [
      { role: "assistant", content: [{ type: "text", text: "call tool" }] },
      toolMessage("call_1", "lookup", raw, 1),
    ];
    const summarize = (input: { toolCallId: string; text: string }) => `ref:${input.toolCallId} ${input.text.slice(0, 12)}`;
    const request = await assembleProviderInput({
      model,
      input: "next",
      history,
      turn: 1 + DEFAULT_TOOL_RESULT_FOLD_MIN_AGE_TURNS,
      toolResultFold: resolveToolResultFold({ summarize }, undefined),
      sessionId: "sess-a",
      runId: "run-a",
    });
    const text = request.messages.map((m) => JSON.stringify(m.content)).join("\n");
    assert.match(text, /Tool result lookup \[call_1\]: ref:call_1/);
    assert.doesNotMatch(text, /payload-x{100}/);
    assert.equal(history[1]!.content[0]!.type === "tool_result" ? history[1]!.content[0]!.result : "", raw);
  });

  it("keeps raw tool result when summarizer throws", async () => {
    const raw = "y".repeat(DEFAULT_TOOL_RESULT_FOLD_MIN_BYTES);
    const history = [toolMessage("call_2", "lookup", raw, 1)];
    const folded = await foldToolResultHistory(
      history,
      resolveToolResultFold(
        {
          summarize: () => {
            throw new Error("boom");
          },
        },
        undefined,
      )!,
      { sessionId: "s", runId: "r", turn: 5 },
    );
    assert.equal(folded[0]!.content[0]!.type === "tool_result" ? folded[0]!.content[0]!.result : "", raw);
  });

  it("caps oversized summarizer output", async () => {
    const raw = "z".repeat(DEFAULT_TOOL_RESULT_FOLD_MIN_BYTES);
    const history = [toolMessage("call_3", "lookup", raw, 1)];
    const folded = await foldToolResultHistory(
      history,
      resolveToolResultFold(
        {
          maxSummaryBytes: 16,
          summarize: () => `summary-${"w".repeat(200)}`,
        },
        undefined,
      )!,
      { sessionId: "s", runId: "r", turn: 5 },
    );
    const value = folded[0]!.content[0]!.type === "tool_result" ? String(folded[0]!.content[0]!.result) : "";
    assert.ok(value.endsWith("…"));
    assert.ok(new TextEncoder().encode(value).length <= 16 + 80);
  });

  it("does not fold fresh in-flight tool results on the same turn", async () => {
    const results: ToolResult[] = [{ toolCallId: "call_4", name: "lookup", value: "q".repeat(DEFAULT_TOOL_RESULT_FOLD_MIN_BYTES) }];
    const request = await assembleProviderInput({
      model,
      input: "next",
      turn: 4,
      toolResults: results,
      toolResultFold: resolveToolResultFold({ summarize: () => "folded" }, undefined),
    });
    const text = JSON.stringify(request.messages);
    assert.match(text, /q{100}/);
    assert.doesNotMatch(text, /folded/);
  });

  it("foldedToolResultHeader formats one-line ref", () => {
    assert.equal(foldedToolResultHeader("lookup", "call_1", "ref:call_1 ok"), "Tool result lookup [call_1]: ref:call_1 ok");
  });
});
