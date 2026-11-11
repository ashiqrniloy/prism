/** Input-estimation residue (plan 158 Task 8): the helpers the kernel keeps after the
 *  context-engineering stages moved to `@arnilo/prism-extensions/context-engineering`. Nothing here decides
 *  anything — each function returns a number or a cap — so the assertions are exact values. */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { ContextBlock, Message, ToolDefinition } from "../contracts.js";
import {
  DEFAULT_INPUT_RESERVE_TOKENS,
  estimateAssemblyTokens,
  estimateMessageBytes,
  estimateMessageTokens,
  estimateRequestExtrasTokens,
  estimateTextBytes,
  estimateTextTokens,
  resolveInputCap,
} from "../models/estimate.js";

const text = (role: Message["role"], value: string): Message => ({ role, content: [{ type: "text", text: value }] });

describe("models/estimate", () => {
  it("text estimates are the ÷4 token basis and real UTF-8 bytes", () => {
    assert.equal(estimateTextTokens("abcdefgh"), 2, "8 UTF-16 units / 4, rounded up");
    assert.equal(estimateTextTokens("abc"), 1, "a partial token still costs one");
    assert.equal(estimateTextTokens(""), 0);
    assert.equal(estimateTextBytes("abc"), 3);
    assert.equal(estimateTextBytes("é"), 2, "bytes, not code units");
  });

  it("message estimates flatten every part kind, so no payload is invisible to a caller", () => {
    const message: Message = {
      role: "tool",
      content: [
        { type: "tool_result", toolCallId: "c1", name: "lookup", result: { a: 1 } },
        { type: "tool_call", id: "c2", name: "lookup", arguments: { q: "x" } },
        { type: "image", mimeType: "image/png" },
      ],
    };
    assert.ok(estimateMessageTokens(message) > 0, "a tool result with no text part still measures");
    // Parts are flattened in order and joined with a newline, so a result JSON, a call signature,
    // and a placeholder for a part with no text all count.
    assert.equal(estimateMessageBytes(message), estimateTextBytes(['{"a":1}', 'lookup({"q":"x"})', "image/png"].join("\n")));
  });

  it("a message array plus a model family returns a labeled TokenEstimate", () => {
    const messages = [text("user", "hello world")];
    const estimate = estimateMessageTokens(messages, "claude-sonnet-4.5");
    assert.equal(typeof estimate.tokens, "number");
    assert.ok(estimate.tokens > 0);
    assert.equal(estimate.lowConfidence, false, "a known family is not low confidence");
    const unknown = estimateMessageTokens(messages, "not-a-model");
    assert.equal(unknown.lowConfidence, true, "an unmatched model stays conservative and low confidence");
    assert.equal(estimateAssemblyTokens(messages), estimateMessageTokens(messages[0]!), "assembly sums the single-message form");
  });

  it("a host token estimator overrides the built-in basis for the single-message form only", () => {
    const message = text("user", "abcdefgh");
    assert.equal(
      estimateMessageTokens(message, () => 42),
      42,
    );
    const withEstimator = estimateMessageTokens([message], "claude-sonnet-4.5");
    assert.ok(withEstimator.tokens < 42, "the family form keeps its own table");
  });

  it("request extras measure tools and context blocks with the assembler's own text shapes", () => {
    const tools: ToolDefinition[] = [
      {
        name: "echo",
        description: "Echo",
        parameters: { type: "object", properties: {} },
        execute: () => ({ toolCallId: "c", name: "echo" }),
      },
    ];
    const context: ContextBlock[] = [{ title: "Project", content: "Stable project context." }];
    const seen: string[] = [];
    const tokens = estimateRequestExtrasTokens(tools, context, (value) => {
      seen.push(value);
      return 1;
    });
    assert.equal(tokens, 2, "one call per context block plus one for the tool list");
    assert.equal(seen[0], "Project:\nStable project context.");
    assert.equal(seen[1], "Available tools:\n- echo: Echo");
    assert.equal(
      estimateRequestExtrasTokens(undefined, undefined, () => 5),
      0,
      "nothing to measure costs nothing",
    );
  });

  it("resolveInputCap prefers a host cap and otherwise derives one from the model window", () => {
    const model = { limits: { contextWindow: 200_000, maxOutputTokens: 8_192 } };
    assert.equal(resolveInputCap({ maxInputTokens: 4_000 }, model), 4_000, "an explicit cap wins");
    assert.equal(resolveInputCap({}, model), 200_000 - 8_192 - DEFAULT_INPUT_RESERVE_TOKENS);
    assert.equal(resolveInputCap({ reserveTokens: 0 }, model), 200_000 - 8_192, "a zero reserve is allowed");
  });

  it("resolveInputCap fails closed when no cap can be derived", () => {
    assert.throws(() => resolveInputCap({}, { limits: {} }), /requires maxInputTokens or model\.limits\.contextWindow/);
    assert.throws(() => resolveInputCap({}, undefined), /requires maxInputTokens or model\.limits\.contextWindow/);
    assert.throws(() => resolveInputCap({ maxInputTokens: 0 }, undefined), /maxInputTokens must be a positive safe integer/);
    assert.throws(() => resolveInputCap({ reserveTokens: -1 }, undefined), /reserveTokens must be a non-negative safe integer/);
    assert.throws(() => resolveInputCap({}, { limits: { contextWindow: 1_000, maxOutputTokens: 2_000 } }), /non-positive input cap/);
  });
});
