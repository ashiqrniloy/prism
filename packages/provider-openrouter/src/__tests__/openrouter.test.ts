import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider, AuthMethod, Message, ModelConfig, ProviderRequest } from "@arnilo/prism";
import { assertProviderOwnedHeadersWin, assertProviderStreamConforms, assertSerializedRequestCoversContent, assertToolCallDeltasReconstruct } from "@arnilo/prism/testing/provider-conformance";
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

describe("@arnilo/prism-provider-openrouter", () => {
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

  it("openrouter_passes_provider_routing_reasoning_and_max_tokens", async () => {
    let body: any;
    let headers = new Headers();
    const provider = createOpenRouterProvider({ apiKey: "fake-openrouter-key", appUrl: "https://example.invalid", appTitle: "Prism Test", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      headers = new Headers(init?.headers);
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: { ...request, model: { ...request.model, parameters: { maxTokens: 222, temperature: 0.3 } } } });
    assert.deepEqual(body.provider, { order: ["anthropic"], data_collection: "deny" });
    assert.deepEqual(body.reasoning, { effort: "medium" });
    assert.equal(body.max_tokens, 222);
    assert.equal(body.maxTokens, undefined);
    assert.equal(body.temperature, 0.3);
    assert.equal(headers.get("authorization"), "Bearer fake-openrouter-key");
    assert.equal(headers.get("http-referer"), "https://example.invalid");
    assert.equal(headers.get("x-title"), "Prism Test");
  });

  it("openrouter_applies_cache_control_only_to_selected_breakpoints", async () => {
    let body: any;
    let headers = new Headers();
    const provider = createOpenRouterProvider({ apiKey: "fake-openrouter-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      headers = new Headers(init?.headers);
      return ok(sse([]));
    }) as typeof fetch });
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "system preamble" }] },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
      { role: "user", content: [{ type: "text", text: "current turn" }] },
    ];
    await assertProviderStreamConforms({ provider, request: { ...request, messages, options: {
      ...request.options,
      cache: { breakpoints: [{ location: "last_stable_message" }] },
    } } });
    assert.equal(body.session_id, "session-with-spaces");
    assert.equal(headers.get("x-session-id"), "session-with-spaces");
    // Only the last_stable_message (index 1) gets a cache_control marker on its
    // last block; the other messages carry no marker.
    assert.deepEqual(body.messages[1].content.at(-1).cache_control, { type: "ephemeral" });
    assert.equal(body.messages[0].content.at(-1).cache_control, undefined);
    assert.equal(body.messages[2].content.at(-1).cache_control, undefined);
  });

  it("openrouter_no_breakpoints_emits_no_cache_control_markers", async () => {
    let body: any;
    const provider = createOpenRouterProvider({ apiKey: "fake-openrouter-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request });
    for (const message of body.messages) {
      const content = typeof message.content === "string" ? [{ text: message.content }] : message.content;
      for (const block of content) assert.equal(block.cache_control, undefined);
    }
    assert.equal(body.session_id, "session-with-spaces");
  });

  it("openrouter_long_retention_emits_1h_ttl_marker", async () => {
    let body: any;
    const provider = createOpenRouterProvider({ apiKey: "fake-openrouter-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: {
      ...request,
      options: { ...request.options, cacheRetention: "long" as const, cache: { breakpoints: [{ location: "last_stable_message" }] } },
      model: { ...request.model, cache: { kind: "cache_control" as const, longRetention: true } },
    } });
    assert.deepEqual(body.messages[0].content.at(-1).cache_control, { type: "ephemeral", ttl: "1h" });
  });

  it("openrouter_session_id_sanitized_and_clamped_to_256", async () => {
    let body: any;
    let headers = new Headers();
    const provider = createOpenRouterProvider({ apiKey: "fake-openrouter-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      headers = new Headers(init?.headers);
      return ok(sse([]));
    }) as typeof fetch });
    const longId = "agent#1/" + "x".repeat(300);
    await assertProviderStreamConforms({ provider, request: { ...request, options: { ...request.options, cacheKey: longId } } });
    assert.ok(body.session_id.length <= 256);
    assert.equal(body.session_id, headers.get("x-session-id"));
    assert.ok(!body.session_id.includes("#"));
    assert.ok(!body.session_id.includes("/"));
    assert.ok(body.session_id.startsWith("agent-1"));
  });

  it("openrouter_keeps_provider_owned_headers_after_caller_headers", async () => {
    let headers = new Headers();
    const provider = createOpenRouterProvider({ apiKey: "fake-openrouter-key", appUrl: "https://example.invalid", appTitle: "Prism Test", fetch: (async (_input, init) => {
      headers = new Headers(init?.headers);
      return ok(sse([]));
    }) as typeof fetch });

    await assertProviderStreamConforms({
      provider,
      request: {
        ...request,
        options: {
          ...request.options,
          headers: {
            authorization: "Bearer attacker",
            "content-type": "text/plain",
            "x-session-id": "attacker-session",
            "http-referer": "https://attacker.invalid",
            "x-title": "Attacker",
            "x-caller": "kept",
          },
        },
      },
    });

    assertProviderOwnedHeadersWin(headers, {
      owned: { authorization: "Bearer fake-openrouter-key", "content-type": "application/json", "x-session-id": "session-with-spaces", "http-referer": "https://example.invalid", "x-title": "Prism Test" },
      caller: { authorization: "Bearer attacker", "content-type": "text/plain", "x-session-id": "attacker-session", "http-referer": "https://attacker.invalid", "x-title": "Attacker", "x-caller": "kept" },
    });
  });

  it("openrouter_maps_cache_read_write_usage", async () => {
    const provider = createOpenRouterProvider({ apiKey: "fake-openrouter-key", fetch: mockFetch(sse([
      { choices: [{ delta: { content: "hi", reasoning: "think", tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: "{\"q\":\"x\"}" } }] } }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7, prompt_tokens_details: { cached_tokens: 1, cache_write_tokens: 3 } } },
    ])) });
    const events = await assertProviderStreamConforms({ provider, request, expect: { text: "hi", usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7, cacheReadTokens: 1, cacheWriteTokens: 3 } } });
    assertToolCallDeltasReconstruct(events, [{ index: 0, id: "call_1", name: "lookup", arguments: { q: "x" } }]);
  });

  it("openrouter_body_covers_non_text_blocks_when_model_claims_them", async () => {
    const replay: ProviderRequest = {
      ...request,
      model: defineOpenRouterModel({
        model: "anthropic/claude-sonnet-4",
        compat: { openRouterCache: true },
        capabilities: { input: ["text", "image"] },
      }),
      messages: [
        { role: "assistant", content: [{ type: "tool_call", id: "call_1", name: "lookup", arguments: { q: "x" } }] },
        { role: "tool", content: [{ type: "tool_result", toolCallId: "call_1", name: "lookup", result: { ok: true } }] },
        { role: "user", content: [{ type: "text", text: "hi" }, { type: "image", url: "https://example.invalid/img.png" }] },
      ],
    };
    let body: unknown;
    const provider = createOpenRouterProvider({ apiKey: "fake-openrouter-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: replay });
    assertSerializedRequestCoversContent(replay, body);
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
