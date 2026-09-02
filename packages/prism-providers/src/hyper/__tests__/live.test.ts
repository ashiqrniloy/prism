import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelConfig, ProviderEvent, ProviderRequest, ToolDefinition, Usage } from "@arnilo/prism";
import {
  assertAbortIsObserved,
  assertNoSecretLeak,
  assertProviderStreamConforms,
  collectProviderEvents,
} from "@arnilo/prism/testing/provider-conformance";
import { createHyperProvider, hyperModels } from "../index.js";

// Env-gated live probes for @arnilo/prism-providers/hyper.
//
// Network-free by default: these tests skip unless BOTH
// `PRISM_LIVE_PROVIDER_TESTS=1` AND `HYPER_API_KEY` are set. The default
// `npm test` and CI release verification never set these. To run locally:
//
//   PRISM_LIVE_PROVIDER_TESTS=1 HYPER_API_KEY=sk-hyper-... \
//     npm run test --workspace=@arnilo/prism-providers/hyper
//
// Security: the key is read from the env and used only as a bearer token; it is
// never logged. `assertNoSecretLeak` verifies the key value does not appear in
// any streamed event. Prompts are non-sensitive. Probes are bounded to a few
// cheap requests (deepseek-v4-pro $2.40/$4.80 per M tokens; qwen3.6-plus with a
// ~1 KiB prefix ≈ sub-cent per cache write).
//
// The cache/effort probes are the documented-unknown resolvers (plan Task 3):
// their assertions encode what the docs claim, so a probe failure IS the
// finding — record it in docs/providers/hyper.md and adjust the mapping.

const LIVE = process.env.PRISM_LIVE_PROVIDER_TESTS === "1";
const API_KEY = process.env.HYPER_API_KEY;
const skip: string | false = !LIVE || !API_KEY ? "set PRISM_LIVE_PROVIDER_TESTS=1 and HYPER_API_KEY to run live Hyper smoke probes" : false;

const chatModel = hyperModels.find((m) => m.model === "deepseek-v4-pro")!;
const messagesModel = hyperModels.find((m) => m.model === "qwen3.6-plus")!;

const apiKey = (): string | undefined => process.env.HYPER_API_KEY;

function provider() {
  return createHyperProvider({ apiKey });
}

// Reusable non-sensitive prefix so two-turn probes exercise the exact-prefix cache.
const cachePrefix =
  "Memory is the residue of thought. We remember what we think about, not what we merely see. " +
  "This is why active recall outperforms passive rereading: retrieval re-weaves the trace. " +
  "Spacing practice widens the window in which a trace survives. Interleaving forces discrimination. " +
  "Elaboration binds new traces to old. Each of these effects is small alone and large together. ".repeat(8);

function usageOf(events: readonly ProviderEvent[]): Usage | undefined {
  return events.find((e) => e.type === "usage")?.usage;
}

describe("@arnilo/prism-providers/hyper live probes", () => {
  it("live_text_generation_streams_and_leaks_no_secret", { skip }, async () => {
    const events = await assertProviderStreamConforms({
      provider: provider(),
      request: { model: chatModel, messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly the word: pong" }] }] },
    });
    const text = events.map((e) => (e.type === "content_delta" && e.content.type === "text" ? e.content.text : "")).join("");
    assert.ok(text.length > 0, "live text response was empty");
    assertNoSecretLeak(events, [API_KEY!]);
  });

  it("live_tool_call_loop_conforms_and_leaks_no_secret", { skip }, async () => {
    const getWeatherTool: ToolDefinition = {
      name: "get_weather",
      description: "Get the current weather for a city.",
      parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
      execute: (args) => ({ toolCallId: "live", name: "get_weather", value: { city: args.city, temp: "72F" } }),
    };
    const events = await assertProviderStreamConforms({
      provider: provider(),
      request: {
        model: chatModel,
        messages: [{ role: "user", content: [{ type: "text", text: "What is the weather in Paris? Use the get_weather tool." }] }],
        tools: [getWeatherTool],
      },
    });
    const toolCalls = events.filter((e: ProviderEvent) => e.type === "tool_call");
    assert.ok(toolCalls.length > 0, "live tool prompt produced no tool calls");
    for (const call of toolCalls) if (call.type === "tool_call") assert.ok(call.call.name, "live tool call missing name");
    assertNoSecretLeak(events, [API_KEY!]);
  });

  it("live_abort_signal_is_observed_before_first_request", { skip }, async () => {
    await assertAbortIsObserved({
      provider: provider(),
      request: { model: chatModel, messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly the word: pong" }] }] },
    });
  });

  it("live_error_response_leaks_no_secret", { skip }, async () => {
    const events = await collectProviderEvents(provider(), { model: chatModel, messages: [] });
    const terminal = events.at(-1);
    assert.ok(terminal, "live error request produced no events");
    assert.equal(terminal?.type, "error", "invalid request unexpectedly succeeded");
    assertNoSecretLeak(events, [API_KEY!]);
  });

  it("live_chat_route_reports_cached_tokens_on_warm_prefix_replay", { skip }, async () => {
    // Explicit-caching probe (implicit model): same exact prefix on two turns;
    // the second must surface cached input tokens through the shared mapping
    // (prompt_tokens_details.cached_tokens or prompt_cache_hit_tokens).
    const turn = (label: string): Promise<readonly ProviderEvent[]> =>
      assertProviderStreamConforms({
        provider: provider(),
        request: {
          model: chatModel,
          messages: [
            { role: "user", content: [{ type: "text", text: cachePrefix }] },
            { role: "user", content: [{ type: "text", text: `Reply with exactly the word: ${label}` }] },
          ],
        },
      });
    const first = await turn("one");
    const second = await turn("two");
    const firstUsage = usageOf(first);
    const secondUsage = usageOf(second);
    // eslint-disable-next-line no-console
    console.info(
      `[hyper live] chat-route cache probe: turn1 {read:${firstUsage?.cacheReadTokens ?? 0}, write:${firstUsage?.cacheWriteTokens ?? 0}} ` +
        `turn2 {read:${secondUsage?.cacheReadTokens ?? 0}, write:${secondUsage?.cacheWriteTokens ?? 0}}`,
    );
    assert.ok(
      (secondUsage?.cacheReadTokens ?? 0) > 0,
      `warm chat-route replay reported no cached tokens ` +
        `(turn2 usage=${JSON.stringify(secondUsage)}). Finding: implicit caching does not surface ` +
        `prompt_cache_hit_tokens/cached_tokens — record in docs/providers/hyper.md.`,
    );
    assertNoSecretLeak(second, [API_KEY!]);
  });

  it("live_messages_route_cache_control_reports_creation_and_read_tokens", { skip }, async () => {
    // Explicit-write probe (cache_control model): system_prompt breakpoint on
    // the Anthropic route; call A creates the cache entry, warm call B reads it.
    const request = (): ProviderRequest => ({
      model: messagesModel,
      messages: [{ role: "system", content: [{ type: "text", text: cachePrefix }] }],
      options: { cache: { breakpoints: [{ location: "system_prompt" }] } },
    });
    const create = await assertProviderStreamConforms({ provider: provider(), request: request() });
    const warm = await assertProviderStreamConforms({ provider: provider(), request: request() });
    const createUsage = usageOf(create);
    const warmUsage = usageOf(warm);
    // eslint-disable-next-line no-console
    console.info(
      `[hyper live] messages-route cache probe: create {write:${createUsage?.cacheWriteTokens ?? 0}, read:${createUsage?.cacheReadTokens ?? 0}} ` +
        `warm {read:${warmUsage?.cacheReadTokens ?? 0}, write:${warmUsage?.cacheWriteTokens ?? 0}}`,
    );
    assert.ok(
      (createUsage?.cacheWriteTokens ?? 0) > 0,
      `cache_control create call reported no cache_creation_input_tokens ` +
        `(create usage=${JSON.stringify(createUsage)}). Finding: markers are not honored on the ` +
        `messages route — downgrade qwen3.6-* to kind "implicit" and record in docs/providers/hyper.md.`,
    );
    assert.ok(
      (warmUsage?.cacheReadTokens ?? 0) > 0,
      `warm messages-route replay reported no cache_read_input_tokens ` +
        `(warm usage=${JSON.stringify(warmUsage)}). Finding: TTL may be shorter than a request — ` +
        `record in docs/providers/hyper.md before depending on cross-request caching.`,
    );
    assertNoSecretLeak(warm, [API_KEY!]);
  });

  it("live_reasoning_effort_is_accepted_on_chat_route", { skip }, async () => {
    // Reasoning-param probe: send an effort value from the model's documented
    // effort_levels (xhigh) and capture the wire body. A 400/non-done terminal
    // means Hyper rejects reasoning_effort — drop it from the mapping.
    let capturedBody: string | undefined;
    const baseFetch = globalThis.fetch;
    const probing = createHyperProvider({
      apiKey,
      fetch: async (input, init) => {
        capturedBody = String(init?.body);
        return baseFetch(input, init);
      },
    });
    const events = await assertProviderStreamConforms({
      provider: probing,
      request: {
        model: chatModel,
        messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly the word: pong" }] }],
        options: { compat: { reasoning_effort: "xhigh" } },
      },
    });
    assert.equal(events.at(-1)?.type, "done", `Hyper rejected reasoning_effort=xhigh — drop effort sending from the mapping`);
    assert.ok(capturedBody?.includes('"reasoning_effort":"xhigh"'), `wire body missing reasoning_effort: ${capturedBody}`);
    assertNoSecretLeak(events, [API_KEY!]);
  });

  it("live_responses_route_text_tool_smoke_and_cached_tokens_on_warm_prefix", { skip }, async () => {
    // Codex-style `/v1/responses` pass-through: plain smoke + cached-token
    // probe (shared Responses machinery maps input_tokens_details.cached_tokens).
    const responsesModel: ModelConfig = { ...chatModel, compat: { ...chatModel.compat, route: "responses" } };
    const tool: ToolDefinition = {
      name: "get_weather",
      description: "Get the current weather for a city.",
      parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
      execute: (args) => ({ toolCallId: "live", name: "get_weather", value: { city: args.city, temp: "72F" } }),
    };
    const first = await assertProviderStreamConforms({
      provider: provider(),
      request: {
        model: responsesModel,
        messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly the word: pong" }] }],
        tools: [tool],
      },
    });
    const text = first.map((e) => (e.type === "content_delta" && e.content.type === "text" ? e.content.text : "")).join("");
    assert.ok(text.length > 0, "live responses-route text response was empty");
    assertNoSecretLeak(first, [API_KEY!]);

    const turn = (label: string): Promise<readonly ProviderEvent[]> =>
      assertProviderStreamConforms({
        provider: provider(),
        request: {
          model: responsesModel,
          messages: [{ role: "user", content: [{ type: "text", text: `${cachePrefix} then reply exactly: ${label}` }] }],
        },
      });
    const warm = usageOf(await turn("two"));
    assert.ok(
      (warm?.cacheReadTokens ?? 0) > 0,
      `warm responses-route replay reported no cached tokens ` +
        `(usage=${JSON.stringify(warm)}). Finding: cached_tokens not reported on /v1/responses — ` +
        `record in docs/providers/hyper.md.`,
    );
    assertNoSecretLeak(first, [API_KEY!]);
  });
});
