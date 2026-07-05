import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider, AuthMethod, Message, ModelConfig, ProviderRequest } from "@arnilo/prism";
import { assertProviderOwnedHeadersWin, assertProviderStreamConforms, assertSerializedRequestCoversContent, assertToolCallDeltasReconstruct } from "@arnilo/prism/testing/provider-conformance";
import { createKimiCodingProvider, createKimiProviderPackage, kimiCodingModels, moonshotKimiModels } from "../index.js";

const request: ProviderRequest = {
  model: kimiCodingModels[0],
  messages: [
    { role: "system", content: [{ type: "text", text: "instructions" }] },
    { role: "assistant", content: [{ type: "thinking", text: "prior reasoning" }] },
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ],
  tools: [{ name: "lookup", parameters: { type: "object" }, execute: () => ({ toolCallId: "tool_1", name: "lookup", content: [] }) }],
};

describe("@arnilo/prism-provider-kimi", () => {
  it("kimi_registers_kimi_coding_models_by_default", async () => {
    const registered: unknown[] = [];
    await createKimiProviderPackage({ kimiApiKey: "fake-kimi-key", fetch: mockFetch(sse([])) }).setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (model: ModelConfig) => registered.push(model),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as any);
    assert(registered.some((item: any) => item.id === "kimi-coding"));
    assert(registered.some((item: any) => item.provider === "kimi-coding" && item.model === "kimi-k2.7-code"));
    assert(!registered.some((item: any) => item.provider === "moonshot"));
  });

  it("kimi_anthropic_stream_maps_text_thinking_tool_calls_usage", async () => {
    const provider = createKimiCodingProvider({ apiKey: "fake-kimi-key", fetch: mockFetch(sse([
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "hello" } },
      { type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "think" } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool_1", name: "lookup" } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"q\":\"x\"}" } },
      { type: "message_delta", usage: { input_tokens: 4, output_tokens: 3, cache_read_input_tokens: 1, cache_creation_input_tokens: 2 } },
    ])) });
    const events = await assertProviderStreamConforms({ provider, request, expect: { text: "hello", usage: { inputTokens: 4, outputTokens: 3, cacheReadTokens: 1, cacheWriteTokens: 2 } } });
    assertToolCallDeltasReconstruct(events, [{ index: 0, id: "tool_1", name: "lookup", arguments: { q: "x" } }]);
  });

  it("kimi_preserves_reasoning_for_tool_replay_and_maps_max_tokens", async () => {
    let body: any;
    const provider = createKimiCodingProvider({ apiKey: "fake-kimi-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: { ...request, model: { ...request.model, parameters: { maxTokens: 444, temperature: 0.5 } } } });
    assert.equal(body.system, "instructions");
    assert.deepEqual(body.messages[0].content, [{ type: "thinking", thinking: "prior reasoning" }]);
    assert.equal(body.max_tokens, 444);
    assert.equal(body.maxTokens, undefined);
    assert.equal(body.temperature, 0.5);
  });

  it("kimi_optional_moonshot_metadata_is_app_selected", async () => {
    const registered: unknown[] = [];
    await createKimiProviderPackage({ kimiApiKey: "fake-kimi-key", includeMoonshotModels: true, moonshotModels: moonshotKimiModels, fetch: mockFetch(sse([])) }).setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (model: ModelConfig) => registered.push(model),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as any);
    assert(registered.some((item: any) => item.provider === "moonshot" && item.model === "kimi-k2.7-code-preview"));
  });

  it("kimi_anthropic_preserves_thinking_tool_use_and_tool_result", async () => {
    const replay: ProviderRequest = {
      model: kimiCodingModels[0],
      messages: [
        { role: "assistant", content: [{ type: "tool_call", id: "tool_1", name: "lookup", arguments: { q: "x" } }, { type: "thinking", text: "plan" }] },
        { role: "tool", content: [{ type: "tool_result", toolCallId: "tool_1", name: "lookup", result: { ok: true } }] },
      ],
    };
    let body: unknown;
    const provider = createKimiCodingProvider({ apiKey: "fake-kimi-key", fetch: (async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: replay });
    assertSerializedRequestCoversContent(replay, body);
  });

  it("kimi_default_model_emits_no_cache_control_for_implicit_caching", async () => {
    let body: any;
    const provider = createKimiCodingProvider({ apiKey: "fake-kimi-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: { ...request, options: { cacheKey: "sess", cacheRetention: "long" as const, cache: { breakpoints: [{ location: "last_stable_message" as const }] } } } });
    // Default catalog model has no cache metadata; no cache_control emitted.
    assert.ok(!JSON.stringify(body).includes("cache_control"), "default Kimi body must not contain cache_control");
  });

  it("kimi_opted_in_cache_control_applies_only_to_selected_breakpoints", async () => {
    let body: any;
    const provider = createKimiCodingProvider({ apiKey: "fake-kimi-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "preamble" }] },
      { role: "assistant", content: [{ type: "text", text: "stable" }] },
      { role: "user", content: [{ type: "text", text: "current" }] },
    ];
    await assertProviderStreamConforms({ provider, request: {
      ...request,
      model: { ...request.model, cache: { kind: "cache_control" as const, longRetention: true } },
      messages,
      options: { cacheKey: "sess", cacheRetention: "long" as const, cache: { breakpoints: [{ location: "last_stable_message" as const }] } },
    } });
    // last_stable_message is index 1 (the assistant turn); only its last block carries cache_control with 1h ttl.
    assert.deepEqual(body.messages.find((m: any) => m.role === "assistant").content.at(-1).cache_control, { type: "ephemeral", ttl: "1h" });
    const others = body.messages.filter((m: any) => m.role !== "assistant");
    for (const m of others) for (const block of m.content) assert.equal(block.cache_control, undefined);
  });

  it("kimi_keeps_provider_owned_headers_after_caller_headers", async () => {
    let headers = new Headers();
    const provider = createKimiCodingProvider({ apiKey: "fake-kimi-key", userAgent: "MyApp/2.0", fetch: (async (_url, init) => {
      headers = new Headers(init?.headers);
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: { ...request, options: { ...request.options, headers: { authorization: "Bearer attacker", "content-type": "text/plain", "user-agent": "attacker-ua", "x-caller": "kept" } } } });
    assertProviderOwnedHeadersWin(headers, {
      owned: { authorization: "Bearer fake-kimi-key", "content-type": "application/json", "user-agent": "MyApp/2.0" },
      caller: { authorization: "Bearer attacker", "content-type": "text/plain", "user-agent": "attacker-ua", "x-caller": "kept" },
    });
  });

  it("kimi_redacts_subscription_or_api_key_errors", async () => {
    const provider = createKimiCodingProvider({ apiKey: "fake-kimi-key", fetch: (async () => new Response("bad fake-kimi-key", { status: 500 })) as typeof fetch });
    const events = await assertProviderStreamConforms({ provider, request });
    assert.equal(events.at(-1)?.type, "error");
    assert(!JSON.stringify(events).includes("fake-kimi-key"));
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
