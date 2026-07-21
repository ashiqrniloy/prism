import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  providerContentDelta,
  providerDone,
  providerError,
  providerTextDelta,
  providerThinkingDelta,
  providerToolCall,
  providerToolCallDelta,
  providerUsage,
  toolCallContent,
  toolCallFromArgumentsText,
} from "../index.js";
import { reconstructToolCallDeltas } from "../provider-events.js";
import { ProviderTransportError } from "../providers/transport.js";

describe("provider event helpers", () => {
  it("creates text thinking and image content deltas", () => {
    assert.deepEqual(providerTextDelta("Hello"), {
      type: "content_delta",
      content: { type: "text", text: "Hello" },
    });

    assert.deepEqual(providerThinkingDelta("plan", "sig"), {
      type: "content_delta",
      content: { type: "thinking", text: "plan", signature: "sig" },
    });

    assert.deepEqual(providerContentDelta({ type: "image", url: "https://example.test/image.png" }), {
      type: "content_delta",
      content: { type: "image", url: "https://example.test/image.png" },
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

  it("toolCallFromArgumentsText marks malformed JSON without throwing", () => {
    const ok = toolCallFromArgumentsText("c1", "echo", "{\"a\":1}");
    assert.deepEqual(ok.arguments, { a: 1 });
    assert.equal(ok.argumentsError, undefined);

    const bad = toolCallFromArgumentsText("c1", "echo", "{invalid");
    assert.deepEqual(bad.arguments, {});
    assert.equal(bad.argumentsError?.code, "invalid_json_arguments");
    assert.match(bad.argumentsError?.message ?? "", /Invalid tool arguments JSON for tool echo/);
  });

  it("reconstructToolCallDeltas recovers malformed arguments as argumentsError", () => {
    const [call] = reconstructToolCallDeltas([
      providerToolCallDelta({ index: 0, id: "c1", name: "echo", argumentsText: "{invalid" }),
    ]);
    assert.equal(call?.id, "c1");
    assert.equal(call?.argumentsError?.code, "invalid_json_arguments");
  });

  it("reconstructToolCallDeltas throws typed incomplete_delta when id or name is missing", () => {
    assert.throws(
      () => reconstructToolCallDeltas([providerToolCallDelta({ index: 2, id: "c1", argumentsText: "{}" })]),
      (error: unknown) =>
        error instanceof ProviderTransportError
        && error.code === "incomplete_delta"
        && error.message === "Incomplete tool call delta at index 2",
    );
    assert.throws(
      () => reconstructToolCallDeltas([providerToolCallDelta({ index: 0, name: "echo", argumentsText: "{}" })]),
      (error: unknown) => error instanceof ProviderTransportError && error.code === "incomplete_delta",
    );
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
