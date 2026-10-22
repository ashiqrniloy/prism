import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { Message } from "../contracts.js";
import {
  applyOpenAIChatStructuredOutput,
  assertOpenAIChatMessage,
  mapOpenAIChatUsage,
  serializeOpenAIChatMessage,
  serializeOpenAIChatStructuredOutput,
  serializeOpenAITool,
  serializeToolResultText,
} from "../provider-kit/openai-primitives.js";
import { openAIChatBody } from "../provider-kit/codecs/openai-chat.js";

describe("openai provider primitives", () => {
  it("canonicalizes shuffled tool schema keys and preserves semantic arrays", () => {
    const execute = () => ({ toolCallId: "c1", name: "lookup", value: "ok" });
    const left = {
      type: "object" as const,
      required: ["z", "a"],
      enum: ["z", "a"],
      properties: { z: { type: "string" }, a: { type: "number" } },
    };
    const right = {
      properties: { a: { type: "number" }, z: { type: "string" } },
      enum: ["z", "a"],
      required: ["a", "z"],
      type: "object" as const,
    };
    const serialized = serializeOpenAITool({ name: "lookup", parameters: left, execute });
    assert.equal(JSON.stringify(serialized), JSON.stringify(serializeOpenAITool({ name: "lookup", parameters: right, execute })));
    const parameters = (serialized as { function: { parameters: { required: string[]; enum: string[]; properties: object } } }).function
      .parameters;
    assert.deepEqual(parameters.required, ["a", "z"]);
    assert.deepEqual(parameters.enum, ["z", "a"]);
    assert.deepEqual(Object.keys(parameters.properties), ["a", "z"]);
    assert.deepEqual(left.required, ["z", "a"]);
  });

  it("serializes tools with default object parameters", () => {
    assert.deepEqual(
      serializeOpenAITool({
        name: "echo",
        description: "echo text",
        execute: () => ({ toolCallId: "c1", name: "echo", value: "ok" }),
      }),
      {
        type: "function",
        function: { name: "echo", description: "echo text", parameters: { type: "object" } },
      },
    );
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
      tool_calls: [{ id: "c1", type: "function", function: { name: "echo", arguments: '{"text":"x"}' } }],
    });
  });

  it("serializes sibling tool text when tool_result.result is missing", () => {
    const message: Message = {
      role: "tool",
      content: [
        { type: "tool_result", toolCallId: "c1", name: "repo_list" },
        { type: "text", text: "file AGENTS.md" },
      ],
    };
    assert.equal(serializeToolResultText(message), "file AGENTS.md");
    assert.equal(serializeOpenAIChatMessage(message).content, "file AGENTS.md");
    assert.notEqual(serializeOpenAIChatMessage(message).content, "null");
  });

  it("joins uncoalesced tool-call text tokens without interstitial newlines", () => {
    const serialized = serializeOpenAIChatMessage({
      role: "assistant",
      content: [
        { type: "text", text: "hello" },
        { type: "text", text: " world" },
        { type: "tool_call", id: "c1", name: "echo", arguments: { text: "x" } },
      ],
    });
    assert.equal(serialized.content, "hello world");
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
    assert.throws(() => assertOpenAIChatMessage("[Circular]", "messages[1]"), /Invalid provider message at messages\[1\]: expected object/);
    assert.throws(() => assertOpenAIChatMessage({ role: "user" }, "messages[0]"), /expected content array/);
  });

  it("rejects images when capability is missing", () => {
    const message: Message = {
      role: "user",
      content: [{ type: "image", url: "https://example.test/x.png" }],
    };
    assert.throws(() => serializeOpenAIChatMessage(message, {}), /does not declare image input capability/);
  });

  it("chat_codec_reasoning_replay_modes", () => {
    const message: Message = {
      role: "assistant",
      content: [
        { type: "thinking", text: "step-by-step logic" },
        { type: "text", text: "final answer" },
      ],
    };

    // 1. "reasoning_content": preserves thinking in reasoning_content field
    const bodyReplay = openAIChatBody(
      {
        model: { provider: "test", model: "m", capabilities: { reasoning: true } },
        messages: [message],
      },
      { reasoningReplay: "reasoning_content", preserveThinking: () => true },
    );
    const msgReplay = (bodyReplay.messages as any[])[0];
    assert.equal(msgReplay.role, "assistant");
    assert.equal(msgReplay.content, "final answer");
    assert.equal(msgReplay.reasoning_content, "step-by-step logic");

    // 2. "fold": folds thinking into content as text
    const bodyFold = openAIChatBody(
      {
        model: { provider: "test", model: "m", capabilities: { reasoning: true } },
        messages: [message],
      },
      { reasoningReplay: "fold", preserveThinking: () => true },
    );
    const msgFold = (bodyFold.messages as any[])[0];
    assert.equal(msgFold.role, "assistant");
    assert.deepEqual(msgFold.content, [
      { type: "text", text: "step-by-step logic" },
      { type: "text", text: "final answer" },
    ]);
    assert.equal(msgFold.reasoning_content, undefined);

    // 3. "drop": drops thinking completely
    const bodyDrop = openAIChatBody(
      {
        model: { provider: "test", model: "m", capabilities: { reasoning: true } },
        messages: [message],
      },
      { reasoningReplay: "drop" },
    );
    const msgDrop = (bodyDrop.messages as any[])[0];
    assert.equal(msgDrop.role, "assistant");
    assert.equal(msgDrop.content, "final answer");
    assert.equal(msgDrop.reasoning_content, undefined);
  });

  it("chat_codec_image_gate_rejects_without_capability", () => {
    const message: Message = {
      role: "user",
      content: [{ type: "image", url: "https://example.test/img.png" }],
    };

    // "capability-gated" fails without capability
    assert.throws(
      () =>
        openAIChatBody(
          {
            model: { provider: "test", model: "m", capabilities: { input: ["text"] } },
            messages: [message],
          },
          { imageInput: "capability-gated" },
        ),
      /does not declare image input capability/,
    );

    // "always" allows image without checking capability
    const bodyAlways = openAIChatBody(
      {
        model: { provider: "test", model: "m", capabilities: { input: ["text"] } },
        messages: [message],
      },
      { imageInput: "always" },
    );
    const msgAlways = (bodyAlways.messages as any[])[0];
    assert.deepEqual(msgAlways.content, [
      { type: "image_url", image_url: { url: "https://example.test/img.png" } },
    ]);
  });

  it("chat_codec_effort_snaps_to_declared_levels", () => {
    // Model declares ["low", "medium", "high"]
    // "minimal" is below minimum -> snaps to "low"
    const bodySnapped = openAIChatBody({
      model: {
        provider: "test",
        model: "m",
        capabilities: { thinkingLevels: ["low", "medium", "high"] },
      },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      options: { compat: { reasoning_effort: "minimal" } },
    });
    assert.equal(bodySnapped.reasoning_effort, "low");

    // Exact level stays unchanged
    const bodyHigh = openAIChatBody({
      model: {
        provider: "test",
        model: "m",
        capabilities: { thinkingLevels: ["low", "medium", "high"] },
      },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      options: { compat: { reasoning_effort: "high" } },
    });
    assert.equal(bodyHigh.reasoning_effort, "high");

    // Undeclared model allows any value
    const bodyUndeclared = openAIChatBody({
      model: {
        provider: "test",
        model: "m",
      },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      options: { compat: { reasoning_effort: "custom-effort" } },
    });
    assert.equal(bodyUndeclared.reasoning_effort, "custom-effort");
  });

  it("chat_codec_max_tokens_field_options", () => {
    const bodyDefault = openAIChatBody({
      model: {
        provider: "test",
        model: "m",
        parameters: { maxTokens: 256 },
      },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    assert.equal(bodyDefault.max_tokens, 256);
    assert.equal(bodyDefault.max_completion_tokens, undefined);

    const bodyCompletion = openAIChatBody(
      {
        model: {
          provider: "test",
          model: "m",
          parameters: { maxTokens: 256 },
        },
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      },
      { maxTokensField: "max_completion_tokens" },
    );
    assert.equal(bodyCompletion.max_completion_tokens, 256);
    assert.equal(bodyCompletion.max_tokens, undefined);
  });

  it("sends tool-result text unescaped", () => {
    const text = 'line "one"\n\tindented\npath \\ C:\\\\tmp';
    const message: Message = { role: "tool", content: [{ type: "tool_result", toolCallId: "c1", name: "read", result: text }] };
    assert.equal(serializeToolResultText(message), text);
    assert.equal(serializeOpenAIChatMessage(message).content, text);
    // The JSON step would have doubled every backslash and escaped the quote.
    assert.notEqual(serializeOpenAIChatMessage(message).content, JSON.stringify(text));
  });

  it("keeps a structured tool value as JSON", () => {
    const value = { files: ["a.ts", "b.ts"], count: 2 };
    const message: Message = { role: "tool", content: [{ type: "tool_result", toolCallId: "c1", name: "glob", result: value }] };
    assert.equal(serializeToolResultText(message), JSON.stringify(value));
    assert.equal(serializeOpenAIChatMessage(message).content, JSON.stringify(value));
  });

  it("encodes a scripted coding loop smaller than the JSON-escaped encoding", () => {
    const page = Array.from({ length: 40 }, (_, i) => `  const value${i} = "quoted" + \`tpl\`;`).join("\n");
    const messages: Message[] = Array.from({ length: 10 }, (_, i) => ({
      role: "tool" as const,
      content: [{ type: "tool_result" as const, toolCallId: `c${i}`, name: "read", result: page }],
    }));
    const body = openAIChatBody({ model: { provider: "mock", model: "demo" }, messages });
    const encoded = JSON.stringify(body.messages).length;
    const jsonEscaped = messages.reduce((total, message) => total + JSON.stringify(JSON.stringify((message.content[0] as { result: string }).result)).length, 0);
    assert.ok(encoded < jsonEscaped, `expected ${encoded} < ${jsonEscaped}`);
  });
});
