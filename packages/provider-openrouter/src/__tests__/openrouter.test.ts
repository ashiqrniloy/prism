import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider, AuthMethod, ModelConfig, ProviderRequest } from "prism";
import { assertProviderStreamConforms, assertToolCallDeltasReconstruct } from "prism/testing/provider-conformance";
import { createOpenRouterProvider, createOpenRouterProviderPackage, defineOpenRouterModel } from "../index.js";

const model = defineOpenRouterModel({
  model: "anthropic/claude-sonnet-4",
  displayName: "Claude Sonnet 4 via OpenRouter",
  compat: {
    openRouterRouting: { order: ["anthropic"], data_collection: "deny" },
    openRouterCache: true,
    reasoning: { effort: "medium" },
  },
});

const request: ProviderRequest = {
  model,
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  tools: [{ name: "lookup", parameters: { type: "object" }, execute: () => ({ toolCallId: "call_1", name: "lookup", content: [] }) }],
  options: { sessionId: "session with spaces" },
};

describe("@prism/provider-openrouter", () => {
  it("openrouter_registers_only_app_supplied_models", async () => {
    const registered: unknown[] = [];
    await createOpenRouterProviderPackage({ apiKey: "fake-openrouter-key", models: [model], fetch: mockFetch(sse([])) }).setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (item: ModelConfig) => registered.push(item),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as any);
    assert(registered.some((item: any) => item.id === "openrouter"));
    assert.equal(registered.filter((item: any) => item.provider === "openrouter" && item.model).length, 1);
    assert(registered.some((item: any) => item.provider === "openrouter" && item.kind === "api_key"));
  });

  it("openrouter_passes_provider_routing_and_reasoning_controls", async () => {
    let body: any;
    let headers = new Headers();
    const provider = createOpenRouterProvider({ apiKey: "fake-openrouter-key", appUrl: "https://example.invalid", appTitle: "Prism Test", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      headers = new Headers(init?.headers);
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request });
    assert.deepEqual(body.provider, { order: ["anthropic"], data_collection: "deny" });
    assert.deepEqual(body.reasoning, { effort: "medium" });
    assert.equal(headers.get("authorization"), "Bearer fake-openrouter-key");
    assert.equal(headers.get("http-referer"), "https://example.invalid");
    assert.equal(headers.get("x-title"), "Prism Test");
  });

  it("openrouter_applies_model_level_cache_policy_override", async () => {
    let body: any;
    let headers = new Headers();
    const provider = createOpenRouterProvider({ apiKey: "fake-openrouter-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      headers = new Headers(init?.headers);
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request });
    assert.equal(body.session_id, "session-with-spaces");
    assert.equal(headers.get("x-session-id"), "session-with-spaces");
    assert.deepEqual(body.messages[0].content[0].cache_control, { type: "ephemeral" });
  });

  it("openrouter_maps_cache_read_write_usage", async () => {
    const provider = createOpenRouterProvider({ apiKey: "fake-openrouter-key", fetch: mockFetch(sse([
      { choices: [{ delta: { content: "hi", reasoning: "think", tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: "{\"q\":\"x\"}" } }] } }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7, prompt_tokens_details: { cached_tokens: 1, cache_write_tokens: 3 } } },
    ])) });
    const events = await assertProviderStreamConforms({ provider, request, expect: { text: "hi", usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7, cacheReadTokens: 1, cacheWriteTokens: 3 } } });
    assertToolCallDeltasReconstruct(events, [{ index: 0, id: "call_1", name: "lookup", arguments: { q: "x" } }]);
  });

  it("openrouter_redacts_api_key_from_errors", async () => {
    const provider = createOpenRouterProvider({ apiKey: "fake-openrouter-key", fetch: (async () => new Response("bad fake-openrouter-key", { status: 500 })) as typeof fetch });
    const events = await assertProviderStreamConforms({ provider, request });
    assert.equal(events.at(-1)?.type, "error");
    assert(!JSON.stringify(events).includes("fake-openrouter-key"));
  });
});

function mockFetch(body: ReadableStream<Uint8Array>): typeof fetch {
  return (async () => ok(body)) as typeof fetch;
}

function ok(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, { status: 200 });
}

function sse(events: readonly object[]): ReadableStream<Uint8Array> {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
  return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } });
}
