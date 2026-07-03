import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderEvent, ProviderRequest, ToolDefinition } from "@arnilo/prism";
import { assertAbortIsObserved, assertNoSecretLeak, assertProviderStreamConforms, collectProviderEvents } from "@arnilo/prism/testing/provider-conformance";
import { createKimiCodingProvider, kimiCodingModels } from "../index.js";

// Env-gated live smoke tests for @arnilo/prism-provider-kimi.
//
// Network-free by default: these tests skip unless BOTH
// `PRISM_LIVE_PROVIDER_TESTS=1` AND `KIMI_API_KEY` are set. The default
// `npm test` and CI release verification never set these. To run locally:
//
//   PRISM_LIVE_PROVIDER_TESTS=1 KIMI_API_KEY=... \
//     npm run test --workspace=@arnilo/prism-provider-kimi
//
// Security: the API key is read from the env and used only as a bearer token;
// it is never logged. `assertNoSecretLeak` verifies the key value does not
// appear in any streamed event. Prompts are non-sensitive.

const LIVE = process.env.PRISM_LIVE_PROVIDER_TESTS === "1";
const API_KEY = process.env.KIMI_API_KEY;
const skip: string | false = !LIVE || !API_KEY
  ? "set PRISM_LIVE_PROVIDER_TESTS=1 and KIMI_API_KEY to run live Kimi smoke tests"
  : false;

const model = kimiCodingModels[0]!;
const apiKey = (): string | undefined => process.env.KIMI_API_KEY;

function provider() {
  return createKimiCodingProvider({ apiKey });
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

describe("@arnilo/prism-provider-kimi live tests", () => {
  it("live_text_generation_streams_and_leaks_no_secret", { skip }, async () => {
    const events = await assertProviderStreamConforms({ provider: provider(), request: textRequest });
    const text = events.map((e) => e.type === "content_delta" && e.content.type === "text" ? e.content.text : "").join("");
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
    const badRequest: ProviderRequest = { ...textRequest, messages: [] };
    const events = await collectProviderEvents(provider(), badRequest);
    const terminal = events.at(-1);
    assert.ok(terminal, "live error request produced no events");
    assertNoSecretLeak(events, [API_KEY!]);
  });
});
