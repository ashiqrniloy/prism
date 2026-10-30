import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { JsonObject, ModelConfig, ProviderRequest } from "../index.js";
import { anthropicMessagesBody } from "../provider-kit/codecs/anthropic-messages.js";
import { openAIChatBody } from "../provider-kit/codecs/openai-chat.js";
import { openAIResponsesBody } from "../provider-kit/codecs/openai-responses.js";

const model: ModelConfig = {
  provider: "shared-fixture",
  model: "test-model",
  capabilities: { input: ["text"], output: ["text"], tools: true, streaming: true },
};

/** A history call for a tool the request no longer offers: the case tool narrowing produces. */
const narrowed: ProviderRequest = {
  model,
  messages: [
    { role: "user", content: [{ type: "text", text: "go" }] },
    { role: "assistant", content: [{ type: "tool_call", id: "call_1", name: "memory.recall", arguments: { query: "x" } }] },
    { role: "tool", content: [{ type: "tool_result", toolCallId: "call_1", name: "memory.recall", result: { hits: [] } }] },
  ],
};

describe("replayed tool names", () => {
  it("every_codec_encodes_replayed_tool_calls_for_tools_not_offered", async () => {
    const chat = openAIChatBody(narrowed);
    const chatCalls = (chat.messages as JsonObject[]).flatMap((message) => (message.tool_calls as JsonObject[] | undefined) ?? []);
    assert.equal(((chatCalls[0]?.function ?? {}) as JsonObject).name, "memory_recall", "chat replay");

    const responses = openAIResponsesBody(narrowed);
    const replayed = (responses.input as JsonObject[]).find((item) => item.type === "function_call");
    assert.equal(replayed?.name, "memory_recall", "responses replay");

    const messages = await anthropicMessagesBody(narrowed);
    const assistant = (messages.messages as JsonObject[]).find((message) => message.role === "assistant");
    assert.equal((assistant?.content as JsonObject[] | undefined)?.[0]?.name ?? undefined, "memory_recall", "messages replay");
  });
});
