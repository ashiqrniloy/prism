/**
 * Empty tool results must reach every provider wire as a non-empty payload.
 * The runtime sets `result` to `EMPTY_TOOL_RESULT_TEXT` when a tool produced no `value`,
 * no `type:text` content, and no error (`src/__tests__/tool-result-content.test.ts` in
 * @arnilo/prism pins that side); these assertions pin that no body builder turns the
 * payload back into an empty or absent field.
 *
 * Shared seam: `serializeToolResultJson` feeds the chat bodies of openai, alibaba,
 * deepseek, kimi moonshot, neuralwatt, opencode-go, the Anthropic body, and the
 * Responses API; `googleGenerateContentBody` and `toAiSdkPrompt` read the block directly.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_TOOL_RESULT_TEXT, type JsonObject, type Message, type ModelConfig, type ProviderRequest } from "@arnilo/prism";
import { serializeOpenAIChatMessage, serializeToolResultJson } from "@arnilo/prism/providers/openai";
import { toAiSdkPrompt } from "../ai-sdk/index.js";
import { anthropicMessagesBody } from "../anthropic/index.js";
import { googleGenerateContentBody } from "../google/index.js";

const model: ModelConfig = { provider: "mock", model: "demo" };
const toolMessage: Message = {
  role: "tool",
  content: [{ type: "tool_result", toolCallId: "call_1", name: "shell", result: EMPTY_TOOL_RESULT_TEXT }],
};
const request: ProviderRequest = { model, messages: [toolMessage] };

describe("empty tool result on provider wires", () => {
  it("serialize_tool_result_json_emits_the_sentinel_not_null", () => {
    assert.equal(serializeToolResultJson(toolMessage), JSON.stringify(EMPTY_TOOL_RESULT_TEXT));
    assert.equal(serializeOpenAIChatMessage(toolMessage).content, JSON.stringify(EMPTY_TOOL_RESULT_TEXT));
  });

  it("anthropic_messages_body_carries_the_sentinel", async () => {
    const body = await anthropicMessagesBody(request);
    const content = (body.messages as JsonObject[])[0]?.content as JsonObject[] | undefined;
    assert.equal(content?.[0]?.content, JSON.stringify(EMPTY_TOOL_RESULT_TEXT));
  });

  it("google_function_response_carries_the_sentinel", async () => {
    const body = await googleGenerateContentBody(request);
    const parts = (body.contents as JsonObject[])[0]?.parts as JsonObject[] | undefined;
    const functionResponse = parts?.[0]?.functionResponse as JsonObject | undefined;
    assert.deepEqual(functionResponse?.response, { result: EMPTY_TOOL_RESULT_TEXT });
  });

  it("ai_sdk_tool_result_output_is_not_empty", () => {
    const prompt = toAiSdkPrompt([toolMessage], model) as { role: string; content: { output?: { value?: unknown } }[] }[];
    const output = prompt[0]?.content[0]?.output;
    assert.equal(output?.value, EMPTY_TOOL_RESULT_TEXT);
    assert.notEqual(output?.value, "");
  });
});
