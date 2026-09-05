import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderEvent, ProviderRequest, ToolDefinition } from "@arnilo/prism";
import { assertAbortIsObserved, assertNoSecretLeak, assertProviderStreamConforms } from "@arnilo/prism/testing/provider-conformance";
import { createAzureOpenAIProvider } from "../index.js";

const LIVE = process.env.PRISM_LIVE_PROVIDER_TESTS === "1";
const ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const API_KEY = process.env.AZURE_OPENAI_API_KEY;
/** Azure deployments are account-specific: the deployment name IS the model knob. */
const DEPLOYMENT = process.env.PRISM_LIVE_AZURE_MODEL ?? process.env.AZURE_OPENAI_DEPLOYMENT;
const skip: string | false =
  !LIVE || !ENDPOINT || !API_KEY || !DEPLOYMENT
    ? "set PRISM_LIVE_PROVIDER_TESTS=1 and AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, PRISM_LIVE_AZURE_MODEL (deployment name) to run live Azure OpenAI smoke tests"
    : false;

const apiKey = (): string | undefined => process.env.AZURE_OPENAI_API_KEY;

function provider() {
  return createAzureOpenAIProvider({ endpoint: ENDPOINT!, credential: apiKey, authStyle: "api-key" });
}

const textRequest: ProviderRequest = {
  model: { provider: "azure", model: DEPLOYMENT! },
  messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly the word: pong" }] }],
};

const getWeatherTool: ToolDefinition = {
  name: "get_weather",
  description: "Get the current weather for a city.",
  parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  execute: (args) => ({ toolCallId: "live", name: "get_weather", value: { city: args.city, temp: "72F" } }),
};

const toolRequest: ProviderRequest = {
  model: { provider: "azure", model: DEPLOYMENT! },
  messages: [{ role: "user", content: [{ type: "text", text: "What is the weather in Paris? Use the get_weather tool." }] }],
  tools: [getWeatherTool],
};

describe("@arnilo/prism-providers/azure live tests", () => {
  it("live_text_generation_streams_and_accounts_usage", { skip }, async () => {
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

  // Thinking-effort probe (plan 065 task 16): reasoning_effort must be accepted
  // by the live Azure deployment (no 400 on the wire field).
  it("live_reasoning_effort_is_accepted", { skip }, async () => {
    const events = await assertProviderStreamConforms({
      provider: provider(),
      request: { ...textRequest, options: { compat: { reasoning_effort: "low" } } },
    });
    assert.ok(
      events.some((e) => e.type === "done"),
      "live effort probe produced no done event",
    );
    assertNoSecretLeak(events, [API_KEY!]);
  });

  it("live_abort_signal_is_observed_before_first_request", { skip }, async () => {
    await assertAbortIsObserved({ provider: provider(), request: textRequest });
  });

  it("live_error_response_leaks_no_secret", { skip }, async () => {
    const events: ProviderEvent[] = [];
    for await (const event of provider().generate({ ...textRequest, messages: [] })) events.push(event);
    assert.ok(events.at(-1), "live error request produced no events");
    assertNoSecretLeak(events, [API_KEY!]);
  });
});
