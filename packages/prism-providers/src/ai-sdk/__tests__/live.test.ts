import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createOpenAI } from "@ai-sdk/openai";
import type { ProviderEvent, ProviderRequest, ToolDefinition } from "@arnilo/prism";
import { assertAbortIsObserved, assertNoSecretLeak, assertProviderStreamConforms } from "@arnilo/prism/testing/provider-conformance";
import { createAiSdkProvider } from "../index.js";

const LIVE = process.env.PRISM_LIVE_PROVIDER_TESTS === "1";
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.PRISM_LIVE_AISDK_MODEL ?? "gpt-5.1";
const skip: string | false =
  !LIVE || !API_KEY
    ? "set PRISM_LIVE_PROVIDER_TESTS=1 and OPENAI_API_KEY to run live AI SDK smoke tests (adapter runs over the real @ai-sdk/openai provider)"
    : false;

function provider() {
  // @ai-sdk/openai takes the raw key string (it is never logged; every test
  // asserts assertNoSecretLeak over the mapped events).
  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  return createAiSdkProvider({ model: openai(MODEL) });
}

const textRequest: ProviderRequest = {
  model: { provider: "ai-sdk", model: MODEL },
  messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly the word: pong" }] }],
};

const getWeatherTool: ToolDefinition = {
  name: "get_weather",
  description: "Get the current weather for a city.",
  parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  execute: (args) => ({ toolCallId: "live", name: "get_weather", value: { city: args.city, temp: "72F" } }),
};

const toolRequest: ProviderRequest = {
  model: { provider: "ai-sdk", model: MODEL },
  messages: [{ role: "user", content: [{ type: "text", text: "What is the weather in Paris? Use the get_weather tool." }] }],
  tools: [getWeatherTool],
};

describe("@arnilo/prism-providers/ai-sdk live tests", () => {
  it("live_text_generation_streams_over_real_ai_sdk_provider", { skip }, async () => {
    const events = await assertProviderStreamConforms({ provider: provider(), request: textRequest });
    const text = events.map((e) => (e.type === "content_delta" && e.content.type === "text" ? e.content.text : "")).join("");
    assert.ok(text.length > 0, "live text response was empty");
    assertNoSecretLeak(events, [API_KEY!]);
  });

  it("live_tool_call_loop_conforms_and_leaks_no_secret", { skip }, async () => {
    const events = await assertProviderStreamConforms({ provider: provider(), request: toolRequest });
    for (const call of events.filter((e: ProviderEvent) => e.type === "tool_call")) {
      if (call.type === "tool_call") assert.ok(call.call.name, "live tool call missing name");
    }
    assertNoSecretLeak(events, [API_KEY!]);
  });

  it("live_abort_signal_is_observed_before_first_request", { skip }, async () => {
    await assertAbortIsObserved({ provider: provider(), request: textRequest });
  });
});
