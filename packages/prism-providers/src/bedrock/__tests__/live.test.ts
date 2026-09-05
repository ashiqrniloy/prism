import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderEvent, ProviderRequest, ToolDefinition } from "@arnilo/prism";
import { assertAbortIsObserved, assertNoSecretLeak, assertProviderStreamConforms } from "@arnilo/prism/testing/provider-conformance";
import { createBedrockProvider } from "../index.js";

const LIVE = process.env.PRISM_LIVE_PROVIDER_TESTS === "1";
const ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID;
const SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
/** Cross-region inference profile id; override with PRISM_LIVE_BEDROCK_MODEL for your allow-listed models. */
const MODEL = process.env.PRISM_LIVE_BEDROCK_MODEL ?? "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const skip: string | false =
  !LIVE || !ACCESS_KEY || !SECRET_KEY || !REGION
    ? "set PRISM_LIVE_PROVIDER_TESTS=1 and AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION to run live Bedrock smoke tests"
    : false;

function provider() {
  return createBedrockProvider({
    region: REGION!,
    credential: () => ({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
      sessionToken: process.env.AWS_SESSION_TOKEN,
    }),
  });
}

const textRequest: ProviderRequest = {
  model: { provider: "bedrock", model: MODEL },
  messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly the word: pong" }] }],
};

const getWeatherTool: ToolDefinition = {
  name: "get_weather",
  description: "Get the current weather for a city.",
  parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  execute: (args) => ({ toolCallId: "live", name: "get_weather", value: { city: args.city, temp: "72F" } }),
};

const toolRequest: ProviderRequest = {
  model: { provider: "bedrock", model: MODEL },
  messages: [{ role: "user", content: [{ type: "text", text: "What is the weather in Paris? Use the get_weather tool." }] }],
  tools: [getWeatherTool],
};

describe("@arnilo/prism-providers/bedrock live tests", () => {
  it("live_text_generation_streams_and_accounts_usage", { skip }, async () => {
    const events = await assertProviderStreamConforms({ provider: provider(), request: textRequest });
    const text = events.map((e) => (e.type === "content_delta" && e.content.type === "text" ? e.content.text : "")).join("");
    assert.ok(text.length > 0, "live text response was empty");
    assertNoSecretLeak(events, [ACCESS_KEY!, SECRET_KEY!]);
  });

  it("live_tool_call_loop_conforms_and_leaks_no_secret", { skip }, async () => {
    const events = await assertProviderStreamConforms({ provider: provider(), request: toolRequest });
    for (const call of events.filter((e: ProviderEvent) => e.type === "tool_call")) {
      if (call.type === "tool_call") assert.ok(call.call.name, "live tool call missing name");
    }
    assertNoSecretLeak(events, [ACCESS_KEY!, SECRET_KEY!]);
  });

  it("live_abort_signal_is_observed_before_first_request", { skip }, async () => {
    await assertAbortIsObserved({ provider: provider(), request: textRequest });
  });

  it("live_error_response_leaks_no_secret", { skip }, async () => {
    const events: ProviderEvent[] = [];
    for await (const event of provider().generate({ ...textRequest, messages: [] })) events.push(event);
    assert.ok(events.at(-1), "live error request produced no events");
    assertNoSecretLeak(events, [ACCESS_KEY!, SECRET_KEY!]);
  });
});
