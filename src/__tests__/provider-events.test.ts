import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  providerDone,
  providerError,
  providerTextDelta,
  providerThinkingDelta,
  providerToolCall,
  providerToolCallDelta,
  providerUsage,
  toolCallContent,
} from "../index.js";

describe("provider event helpers", () => {
  it("creates text and thinking content deltas", () => {
    assert.deepEqual(providerTextDelta("Hello"), {
      type: "content_delta",
      content: { type: "text", text: "Hello" },
    });

    assert.deepEqual(providerThinkingDelta("plan", "sig"), {
      type: "content_delta",
      content: { type: "thinking", text: "plan", signature: "sig" },
    });
  });

  it("creates tool call deltas and final tool calls", () => {
    const call = toolCallContent("call_1", "lookup", { id: "1" });

    assert.deepEqual(providerToolCallDelta({ index: 0, id: "call_1", argumentsText: "{}" }), {
      type: "tool_call_delta",
      index: 0,
      id: "call_1",
      argumentsText: "{}",
    });
    assert.deepEqual(providerToolCall(call), { type: "tool_call", call });
  });

  it("creates usage done and redacted error events", () => {
    assert.deepEqual(providerUsage({ inputTokens: 1 }), {
      type: "usage",
      usage: { inputTokens: 1 },
    });
    assert.deepEqual(providerDone({ outputTokens: 2 }), {
      type: "done",
      usage: { outputTokens: 2 },
    });

    const event = providerError(new Error("bad sk-test-123"), ["sk-test-123"]);

    assert.equal(event.type, "error");
    if (event.type === "error") assert.equal(event.error.message, "bad [REDACTED]");
  });
});
