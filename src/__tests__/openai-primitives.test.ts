import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Message } from "../contracts.js";
import {
  applyOpenAIChatStructuredOutput,
  assertOpenAIChatMessage,
  mapOpenAIChatUsage,
  serializeOpenAIChatMessage,
  serializeOpenAIChatStructuredOutput,
  serializeOpenAIResponsesStructuredOutput,
  serializeOpenAITool,
} from "../providers/openai-primitives.js";

describe("openai provider primitives", () => {
  it("serializes tools with default object parameters", () => {
    assert.deepEqual(serializeOpenAITool({
      name: "echo",
      description: "echo text",
      execute: () => ({ toolCallId: "c1", name: "echo", value: "ok" }),
    }), {
      type: "function",
      function: { name: "echo", description: "echo text", parameters: { type: "object" } },
    });
  });

  it("serializes user text and assistant tool-call messages", () => {
    const user: Message = { role: "user", content: [{ type: "text", text: "hi" }] };
    assert.deepEqual(serializeOpenAIChatMessage(user), { role: "user", content: "hi" });

    const assistant: Message = {
      role: "assistant",
      content: [
        { type: "text", text: "calling" },
        { type: "tool_call", id: "c1", name: "echo", arguments: { text: "x" } },
      ],
    };
    assert.deepEqual(serializeOpenAIChatMessage(assistant), {
      role: "assistant",
      content: "calling",
      tool_calls: [{ id: "c1", type: "function", function: { name: "echo", arguments: "{\"text\":\"x\"}" } }],
    });
  });

  it("serializes structured output wire formats", () => {
    const options = {
      name: "answer",
      schema: { type: "object", properties: { title: { type: "string" } } },
      strict: true,
    };
    assert.deepEqual(serializeOpenAIChatStructuredOutput(options), {
      type: "json_schema",
      json_schema: { name: "answer", schema: options.schema, strict: true },
    });
    assert.deepEqual(serializeOpenAIResponsesStructuredOutput(options), {
      format: { type: "json_schema", name: "answer", schema: options.schema, strict: true },
    });
    const body: Record<string, unknown> = {};
    applyOpenAIChatStructuredOutput(body, options);
    assert.deepEqual(body.response_format, serializeOpenAIChatStructuredOutput(options));
  });

  it("maps OpenAI usage including cache token fields", () => {
    assert.deepEqual(
      mapOpenAIChatUsage({
        prompt_tokens: 1,
        completion_tokens: 2,
        total_tokens: 3,
        prompt_tokens_details: { cached_tokens: 4, cache_write_tokens: 5 },
      }),
      {
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
        cacheReadTokens: 4,
        cacheWriteTokens: 5,
      },
    );
    assert.equal(mapOpenAIChatUsage(undefined), undefined);
  });

  it("assertOpenAIChatMessage fails with indexed content-free diagnostics", () => {
    assert.throws(
      () => assertOpenAIChatMessage("[Circular]", "messages[1]"),
      /Invalid provider message at messages\[1\]: expected object/,
    );
    assert.throws(
      () => assertOpenAIChatMessage({ role: "user" }, "messages[0]"),
      /expected content array/,
    );
  });

  it("rejects images when capability is missing", () => {
    const message: Message = {
      role: "user",
      content: [{ type: "image", url: "https://example.test/x.png" }],
    };
    assert.throws(
      () => serializeOpenAIChatMessage(message, {}),
      /does not declare image input capability/,
    );
  });
});
