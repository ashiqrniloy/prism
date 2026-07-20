import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderEvent, ProviderRequest, ToolDefinition } from "@arnilo/prism";
import { assertAbortIsObserved, assertNoSecretLeak, assertProviderStreamConforms, collectProviderEvents } from "@arnilo/prism/testing/provider-conformance";
import { createOpenCodeGoProvider, defineOpenCodeGoModel, openCodeGoModels } from "../index.js";

// Verified JSON Schema structured-output models (mirrors VERIFIED_JSON_SCHEMA_MODELS
// in ../models.ts). Extend the set only when this probe passes live for a model.
const VERIFIED_JSON_SCHEMA_MODELS = ["mimo-v2.5", "mimo-v2.5-pro"];

const structuredOutputRequest = (modelId: string): ProviderRequest => ({
  model: openCodeGoModels.find((m) => m.model === modelId)!,
  messages: [{ role: "user", content: [{ type: "text", text: "Reply with a JSON object matching the requested schema." }] }],
  options: { structuredOutput: { name: "probe", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } } },
});

// Env-gated live smoke tests for @arnilo/prism-provider-opencode-go.
//
// Network-free by default: these tests skip unless BOTH
// `PRISM_LIVE_PROVIDER_TESTS=1` AND `OPENCODE_API_KEY` are set. The default
// `npm test` and CI release verification never set these. To run locally:
//
//   PRISM_LIVE_PROVIDER_TESTS=1 OPENCODE_API_KEY=... \
//     npm run test --workspace=@arnilo/prism-provider-opencode-go
//
// Security: the API key is read from the env and used only as a bearer token;
// it is never logged. `assertNoSecretLeak` verifies the key value does not
// appear in any streamed event. Prompts are non-sensitive.

const LIVE = process.env.PRISM_LIVE_PROVIDER_TESTS === "1";
const API_KEY = process.env.OPENCODE_API_KEY;
const skip: string | false = !LIVE || !API_KEY
  ? "set PRISM_LIVE_PROVIDER_TESTS=1 and OPENCODE_API_KEY to run live OpenCode Go smoke tests"
  : false;

const model = openCodeGoModels[0]!;
const apiKey = (): string | undefined => process.env.OPENCODE_API_KEY;

function provider() {
  return createOpenCodeGoProvider({ apiKey });
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

describe("@arnilo/prism-provider-opencode-go live tests", () => {
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

  // Live evidence gate for `capabilities.structuredOutput: "json_schema"`.
  // A model enters the verified set only when this probe returns a successful
  // stream with response_format accepted (HTTP 200) for that exact model.
  for (const modelId of VERIFIED_JSON_SCHEMA_MODELS) {
    it(`live_json_schema_structured_output_succeeds_${modelId}`, { skip }, async () => {
      const events = await assertProviderStreamConforms({ provider: provider(), request: structuredOutputRequest(modelId) });
      assert.equal(events.at(-1)?.type, "done", `${modelId} rejected response_format — remove it from the verified set`);
      const text = events.map((e) => e.type === "content_delta" && e.content.type === "text" ? e.content.text : "").join("");
      assert.ok(text.trim().startsWith("{"), `${modelId} structured output was not JSON: ${text.slice(0, 80)}`);
      assertNoSecretLeak(events, [API_KEY!]);
    });
  }

  // Boundary probe: bug report evidence was HTTP 400 for response_format on
  // deepseek-v4-pro, and upstream DeepSeek documents only `"text" | "json_object"`
  // (no json_schema). If this test starts failing, the gateway now accepts
  // json_schema — extend the verified set and flip this probe.
  it("live_json_schema_structured_output_rejected_deepseek_v4_pro", { skip }, async () => {
    // Explicit capability so the probe reaches the gateway instead of failing pre-dispatch.
    const featured = openCodeGoModels.find((m) => m.model === "deepseek-v4-pro")!;
    const probed = defineOpenCodeGoModel({
      model: featured.model,
      capabilities: { ...featured.capabilities, structuredOutput: "json_schema" },
      limits: featured.limits,
    });
    const events = await collectProviderEvents(provider(), { ...structuredOutputRequest("deepseek-v4-pro"), model: probed });
    assert.equal(events.at(-1)?.type, "error", "deepseek-v4-pro now accepts json_schema — extend VERIFIED_JSON_SCHEMA_MODELS");
    assertNoSecretLeak(events, [API_KEY!]);
  });

  it("live_error_response_leaks_no_secret", { skip }, async () => {
    const badRequest: ProviderRequest = { ...textRequest, messages: [] };
    const events = await collectProviderEvents(provider(), badRequest);
    const terminal = events.at(-1);
    assert.ok(terminal, "live error request produced no events");
    assertNoSecretLeak(events, [API_KEY!]);
  });
});
