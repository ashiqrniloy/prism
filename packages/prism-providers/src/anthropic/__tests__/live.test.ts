import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderRequest, ToolDefinition } from "@arnilo/prism";
import { assertNoSecretLeak, assertProviderStreamConforms, collectProviderEvents } from "@arnilo/prism/testing/provider-conformance";
import { anthropicModels, createAnthropicMessagesProvider } from "../index.js";

// Env-gated live smoke tests for @arnilo/prism-providers/anthropic.
//
// Network-free by default: these tests skip unless BOTH
// `PRISM_LIVE_PROVIDER_TESTS=1` AND `ANTHROPIC_API_KEY` are set.
//
//   PRISM_LIVE_PROVIDER_TESTS=1 ANTHROPIC_API_KEY=... \
//     npm run test --workspace=@arnilo/prism-providers/anthropic

const LIVE = process.env.PRISM_LIVE_PROVIDER_TESTS === "1";
const API_KEY = process.env.ANTHROPIC_API_KEY;
const skip: string | false =
  !LIVE || !API_KEY ? "set PRISM_LIVE_PROVIDER_TESTS=1 and ANTHROPIC_API_KEY to run live Anthropic smoke tests" : false;

const modelOverride = process.env.PRISM_LIVE_ANTHROPIC_MODEL;
const model = modelOverride
  ? { ...(anthropicModels.find((item) => item.model === "claude-haiku-4-5") ?? anthropicModels[0]!), model: modelOverride }
  : (anthropicModels.find((item) => item.model === "claude-haiku-4-5") ?? anthropicModels[0]!);
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

describe("@arnilo/prism-providers/anthropic live tests", () => {
  it("live_text_generation_streams_and_leaks_no_secret", { skip }, async () => {
    const events = await assertProviderStreamConforms({ provider: provider(), request: textRequest });
    const text = events.map((e) => (e.type === "content_delta" && e.content.type === "text" ? e.content.text : "")).join("");
    assert.ok(text.length > 0, "live text response was empty");
    assertNoSecretLeak(events, [API_KEY!]);
  });

  it("live_tool_call_loop_conforms_and_leaks_no_secret", { skip }, async () => {
    const events = await assertProviderStreamConforms({ provider: provider(), request: toolRequest });
    assert.ok(
      events.some((e) => e.type === "tool_call" || e.type === "tool_call_delta"),
      "expected a tool call",
    );
    assertNoSecretLeak(events, [API_KEY!]);
  });

  // Thinking-effort probe (plan 065 task 15): the adapter's output_config.effort
  // patch must be accepted by the live API (no 400 on the wire field).
  it("live_output_config_effort_is_accepted", { skip }, async () => {
    const events = await assertProviderStreamConforms({
      provider: provider(),
      request: { ...textRequest, options: { compat: { effort: "low" } } },
    });
    assert.ok(
      events.some((e) => e.type === "done"),
      "live effort probe produced no done event",
    );
    assertNoSecretLeak(events, [API_KEY!]);
  });

  // Legacy-field probe (plan 065 task 16): top-level `effort` (pre-output_config
  // emission) — if the API still tolerates it, a dual-emit transition shim may be
  // warranted; if it rejects, the task-3 move to output_config.effort is final.
  // Either outcome ends the stream (done or error); interpretation is recorded in
  // docs/_evidence/thinking-coverage-2026-09-05.md.
  it("live_legacy_top_level_effort_outcome", { skip }, async () => {
    const events = await collectProviderEvents(provider(), {
      ...textRequest,
      options: { extra: { effort: "low" } },
    });
    const terminal = events.at(-1);
    assert.ok(terminal, "live legacy-effort probe produced no events");
    assert.ok(terminal.type === "done" || terminal.type === "error", `live legacy-effort probe ended with ${terminal.type}`);
    assertNoSecretLeak(events, [API_KEY!]);
  });
});
