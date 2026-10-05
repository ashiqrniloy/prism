// scripts/provider-tool-result-wire.test.mjs — plan 152 Task 8.
//
// Empty tool results must reach every provider wire as a non-empty payload.
// The runtime sets `result` to `EMPTY_TOOL_RESULT_TEXT` when a tool produced no
// `value`, no `type:text` content, and no error (`src/__tests__/tool-result-content.test.ts`
// in @arnilo/prism pins that side); these assertions pin that no body builder turns
// the payload back into an empty or absent field.
//
// Shared seam: `serializeToolResultJson` feeds the chat bodies of openai, alibaba,
// deepseek, kimi moonshot, neuralwatt, opencode-go, the Anthropic body, and the
// Responses API; `googleGenerateContentBody` and `toAiSdkPrompt` read the block
// directly. It used to live in the retired provider-family workspace, deleted in
// plan 152 Task 8, so it moved here.
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { EMPTY_TOOL_RESULT_TEXT } from "@arnilo/prism";
import { serializeOpenAIChatMessage, serializeToolResultJson } from "@arnilo/prism/provider-kit";
import { toAiSdkPrompt } from "@arnilo/prism-provider-ai-sdk";
import { anthropicMessagesBody } from "@arnilo/prism-provider-anthropic";
import { googleGenerateContentBody } from "@arnilo/prism-provider-google";

const model = { provider: "mock", model: "demo" };
const toolMessage = {
  role: "tool",
  content: [{ type: "tool_result", toolCallId: "call_1", name: "shell", result: EMPTY_TOOL_RESULT_TEXT }],
};
const request = { model, messages: [toolMessage] };

describe("empty tool result on provider wires", () => {
  it("serialize_tool_result_json_emits_the_sentinel_not_null", () => {
    assert.equal(serializeToolResultJson(toolMessage), JSON.stringify(EMPTY_TOOL_RESULT_TEXT));
    assert.equal(serializeOpenAIChatMessage(toolMessage).content, JSON.stringify(EMPTY_TOOL_RESULT_TEXT));
  });

  it("anthropic_messages_body_carries_the_sentinel", async () => {
    const body = await anthropicMessagesBody(request);
    const content = body.messages[0]?.content;
    assert.equal(content?.[0]?.content, JSON.stringify(EMPTY_TOOL_RESULT_TEXT));
  });

  it("google_function_response_carries_the_sentinel", async () => {
    const body = await googleGenerateContentBody(request);
    const parts = body.contents[0]?.parts;
    const functionResponse = parts?.[0]?.functionResponse;
    assert.deepEqual(functionResponse?.response, { result: EMPTY_TOOL_RESULT_TEXT });
  });

  it("ai_sdk_tool_result_output_is_not_empty", () => {
    const prompt = toAiSdkPrompt([toolMessage], model);
    const output = prompt[0]?.content[0]?.output;
    assert.equal(output?.value, EMPTY_TOOL_RESULT_TEXT);
    assert.notEqual(output?.value, "");
  });
});
