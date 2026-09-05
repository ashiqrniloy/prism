import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderEvent, ProviderRequest, ToolDefinition } from "@arnilo/prism";
import { assertAbortIsObserved, assertNoSecretLeak, assertProviderStreamConforms } from "@arnilo/prism/testing/provider-conformance";
import { createOllamaProvider, listOllamaModels } from "../index.js";

const LIVE = process.env.PRISM_LIVE_PROVIDER_TESTS === "1";
const BASE_URL = process.env.OLLAMA_BASE_URL;
const skip: string | false =
  !LIVE || !BASE_URL
    ? "set PRISM_LIVE_PROVIDER_TESTS=1 and OLLAMA_BASE_URL (e.g. http://localhost:11434 or https://ollama.com) to run live Ollama smoke tests"
    : false;

/** Health gate: discover what the host actually serves, then probe it. */
const available = skip ? [] : await listOllamaModels({ baseUrl: BASE_URL }).catch(() => []);
const model = process.env.PRISM_LIVE_OLLAMA_MODEL ?? available[0]?.model;
const healthSkip: string | false = skip
  ? skip
  : !model || model.trim() === ""
    ? `Ollama at ${BASE_URL} serves no models (pull one, e.g. 'ollama pull llama3.2')`
    : false;

function provider() {
  return createOllamaProvider({ baseUrl: BASE_URL });
}

const textRequest: ProviderRequest = {
  model: { provider: "ollama", model: model! },
  messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly the word: pong" }] }],
};

const getWeatherTool: ToolDefinition = {
  name: "get_weather",
  description: "Get the current weather for a city.",
  parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  execute: (args) => ({ toolCallId: "live", name: "get_weather", value: { city: args.city, temp: "72F" } }),
};

const toolRequest: ProviderRequest = {
  model: { provider: "ollama", model: model! },
  messages: [{ role: "user", content: [{ type: "text", text: "What is the weather in Paris? Use the get_weather tool." }] }],
  tools: [getWeatherTool],
};

describe("@arnilo/prism-providers/ollama live tests", () => {
  it("live_local_server_healthgate_discovers_models", { skip: healthSkip }, async () => {
    assert.ok(available.length > 0, "health gate found no models");
  });

  it("live_text_generation_streams_and_accounts_usage", { skip: healthSkip }, async () => {
    const events = await assertProviderStreamConforms({ provider: provider(), request: textRequest });
    const text = events.map((e) => (e.type === "content_delta" && e.content.type === "text" ? e.content.text : "")).join("");
    assert.ok(text.length > 0, "live text response was empty");
    assertNoSecretLeak(events, [BASE_URL!]);
  });

  it("live_tool_call_loop_conforms", { skip: healthSkip }, async () => {
    const events = await assertProviderStreamConforms({ provider: provider(), request: toolRequest });
    for (const call of events.filter((e: ProviderEvent) => e.type === "tool_call")) {
      if (call.type === "tool_call") assert.ok(call.call.name, "live tool call missing name");
    }
    assertNoSecretLeak(events, [BASE_URL!]);
  });

  it("live_abort_signal_is_observed_before_first_request", { skip: healthSkip }, async () => {
    await assertAbortIsObserved({ provider: provider(), request: textRequest });
  });
});
