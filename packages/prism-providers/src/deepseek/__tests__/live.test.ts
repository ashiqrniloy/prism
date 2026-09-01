import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderEvent, ProviderRequest, ToolDefinition } from "@arnilo/prism";
import {
  assertAbortIsObserved,
  assertNoSecretLeak,
  assertProviderStreamConforms,
  collectProviderEvents,
} from "@arnilo/prism/testing/provider-conformance";
import { createDeepSeekProvider, deepseekModels } from "../index.js";

const LIVE = process.env.PRISM_LIVE_PROVIDER_TESTS === "1";
const API_KEY = process.env.DEEPSEEK_API_KEY;
const skip: string | false =
  !LIVE || !API_KEY ? "set PRISM_LIVE_PROVIDER_TESTS=1 and DEEPSEEK_API_KEY to run live DeepSeek smoke tests" : false;

const model = deepseekModels[0]!;
const apiKey = (): string | undefined => process.env.DEEPSEEK_API_KEY;

function provider() {
  return createDeepSeekProvider({ apiKey });
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

describe("@arnilo/prism-providers/deepseek live tests", () => {
  it("live_text_generation_streams_and_leaks_no_secret", { skip }, async () => {
    const events = await assertProviderStreamConforms({ provider: provider(), request: textRequest });
    const text = events.map((e) => (e.type === "content_delta" && e.content.type === "text" ? e.content.text : "")).join("");
    assert.ok(text.length > 0, "live text response was empty");
    assertNoSecretLeak(events, [API_KEY!]);
  });

  it("live_tool_call_loop_conforms_and_leaks_no_secret", { skip }, async () => {
    const events = await assertProviderStreamConforms({ provider: provider(), request: toolRequest });
    const toolCalls = events.filter((e: ProviderEvent) => e.type === "tool_call");
    for (const call of toolCalls) {
      if (call.type === "tool_call") assert.ok(call.call.name, "live tool call missing name");
    }
    assertNoSecretLeak(events, [API_KEY!]);
  });

  it("live_abort_signal_is_observed_before_first_request", { skip }, async () => {
    await assertAbortIsObserved({ provider: provider(), request: textRequest });
  });

  it("live_error_response_leaks_no_secret", { skip }, async () => {
    const events = await collectProviderEvents(provider(), { ...textRequest, messages: [] });
    assert.ok(events.at(-1), "live error request produced no events");
    assertNoSecretLeak(events, [API_KEY!]);
  });
});
