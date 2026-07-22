import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderRequest, ToolDefinition } from "@arnilo/prism";
import { assertNoSecretLeak, assertProviderStreamConforms } from "@arnilo/prism/testing/provider-conformance";
import { anthropicModels, createAnthropicMessagesProvider } from "../index.js";

// Env-gated live smoke tests for @arnilo/prism-provider-anthropic.
//
// Network-free by default: these tests skip unless BOTH
// `PRISM_LIVE_PROVIDER_TESTS=1` AND `ANTHROPIC_API_KEY` are set.
//
//   PRISM_LIVE_PROVIDER_TESTS=1 ANTHROPIC_API_KEY=... \
//     npm run test --workspace=@arnilo/prism-provider-anthropic

const LIVE = process.env.PRISM_LIVE_PROVIDER_TESTS === "1";
const API_KEY = process.env.ANTHROPIC_API_KEY;
const skip: string | false = !LIVE || !API_KEY
  ? "set PRISM_LIVE_PROVIDER_TESTS=1 and ANTHROPIC_API_KEY to run live Anthropic smoke tests"
  : false;

const model = anthropicModels.find((item) => item.model === "claude-haiku-4-5") ?? anthropicModels[0]!;
const apiKey = (): string | undefined => process.env.ANTHROPIC_API_KEY;

function provider() {
  return createAnthropicMessagesProvider({ apiKey });
}

const textRequest: ProviderRequest = {
  model,
  messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly the word: pong" }] }],
};

const getWeatherTool: ToolDefinition = {
  name: "get_weather",
  description: "Get the current weather for a city.",
  parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  execute: (args) => ({ toolCallId: "live", name: "get_weather", value: { city: args.city, temp: "72F" } }),
};

const toolRequest: ProviderRequest = {
  model,
  messages: [{ role: "user", content: [{ type: "text", text: "What is the weather in Paris? Use the get_weather tool." }] }],
  tools: [getWeatherTool],
};

describe("@arnilo/prism-provider-anthropic live tests", () => {
  it("live_text_generation_streams_and_leaks_no_secret", { skip }, async () => {
    const events = await assertProviderStreamConforms({ provider: provider(), request: textRequest });
    const text = events.map((e) => e.type === "content_delta" && e.content.type === "text" ? e.content.text : "").join("");
    assert.ok(text.length > 0, "live text response was empty");
    assertNoSecretLeak(events, [API_KEY!]);
  });

  it("live_tool_call_loop_conforms_and_leaks_no_secret", { skip }, async () => {
    const events = await assertProviderStreamConforms({ provider: provider(), request: toolRequest });
    assert.ok(events.some((e) => e.type === "tool_call" || e.type === "tool_call_delta"), "expected a tool call");
    assertNoSecretLeak(events, [API_KEY!]);
  });
});
