import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderEvent, ProviderRequest, ToolDefinition } from "@arnilo/prism";
import { assertAbortIsObserved, assertNoSecretLeak, assertProviderStreamConforms } from "@arnilo/prism/testing/provider-conformance";
import { createVertexProvider } from "../index.js";

const LIVE = process.env.PRISM_LIVE_PROVIDER_TESTS === "1";
const PROJECT = process.env.GOOGLE_VERTEX_PROJECT;
const LOCATION = process.env.GOOGLE_VERTEX_LOCATION ?? "us-central1";
/** Vertex auth is ADC/workload-identity on the host; the suite takes a pre-minted
 * bearer token (e.g. `gcloud auth print-access-token`) rather than key files. */
const TOKEN = process.env.PRISM_VERTEX_ACCESS_TOKEN;
const MODEL = process.env.PRISM_LIVE_VERTEX_MODEL ?? "gemini-2.5-flash";
const skip: string | false =
  !LIVE || !PROJECT || !TOKEN
    ? "set PRISM_LIVE_PROVIDER_TESTS=1 and GOOGLE_VERTEX_PROJECT, PRISM_VERTEX_ACCESS_TOKEN to run live Vertex smoke tests"
    : false;

function provider() {
  return createVertexProvider({ projectId: PROJECT!, location: LOCATION, credential: () => process.env.PRISM_VERTEX_ACCESS_TOKEN });
}

const textRequest: ProviderRequest = {
  model: { provider: "vertex", model: MODEL },
  messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly the word: pong" }] }],
};

const getWeatherTool: ToolDefinition = {
  name: "get_weather",
  description: "Get the current weather for a city.",
  parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  execute: (args) => ({ toolCallId: "live", name: "get_weather", value: { city: args.city, temp: "72F" } }),
};

const toolRequest: ProviderRequest = {
  model: { provider: "vertex", model: MODEL },
  messages: [{ role: "user", content: [{ type: "text", text: "What is the weather in Paris? Use the get_weather tool." }] }],
  tools: [getWeatherTool],
};

describe("@arnilo/prism-providers/vertex live tests", () => {
  it("live_text_generation_streams_and_accounts_usage", { skip }, async () => {
    const events = await assertProviderStreamConforms({ provider: provider(), request: textRequest });
    const text = events.map((e) => (e.type === "content_delta" && e.content.type === "text" ? e.content.text : "")).join("");
    assert.ok(text.length > 0, "live text response was empty");
    assertNoSecretLeak(events, [TOKEN!]);
  });

  it("live_tool_call_loop_conforms_and_leaks_no_secret", { skip }, async () => {
    const events = await assertProviderStreamConforms({ provider: provider(), request: toolRequest });
    for (const call of events.filter((e: ProviderEvent) => e.type === "tool_call")) {
      if (call.type === "tool_call") assert.ok(call.call.name, "live tool call missing name");
    }
    assertNoSecretLeak(events, [TOKEN!]);
  });

  it("live_abort_signal_is_observed_before_first_request", { skip }, async () => {
    await assertAbortIsObserved({ provider: provider(), request: textRequest });
  });

  it("live_error_response_leaks_no_secret", { skip }, async () => {
    const events: ProviderEvent[] = [];
    for await (const event of provider().generate({ ...textRequest, messages: [] })) events.push(event);
    assert.ok(events.at(-1), "live error request produced no events");
    assertNoSecretLeak(events, [TOKEN!]);
  });
});
