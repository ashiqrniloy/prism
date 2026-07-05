import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider, AuthMethod, ModelConfig, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import { assertProviderOwnedHeadersWin, assertProviderStreamConforms, assertSerializedRequestCoversContent, assertToolCallDeltasReconstruct } from "@arnilo/prism/testing/provider-conformance";
import { createZaiProvider, createZaiProviderPackage, zaiModels } from "../index.js";

const request: ProviderRequest = {
  model: zaiModels[0],
  messages: [
    { role: "system", content: [{ type: "text", text: "developer instructions" }] },
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ],
  tools: [{ name: "lookup", parameters: { type: "object" }, execute: () => ({ toolCallId: "call_1", name: "lookup", content: [] }) }],
};

describe("@arnilo/prism-provider-zai", () => {
  it("zai_registers_glm_model_metadata", async () => {
    const registered: unknown[] = [];
    await createZaiProviderPackage({ apiKey: "fake-zai-key", fetch: mockFetch(sse([])) }).setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (model: ModelConfig) => registered.push(model),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as any);
    assert(registered.some((item: any) => item.id === "zai"));
    assert(registered.some((item: any) => item.provider === "zai" && item.model === "glm-4.7"));
    assert(registered.some((item: any) => item.provider === "zai" && item.kind === "api_key"));
  });

  it("zai_uses_system_role_when_developer_role_is_unsupported", async () => {
    let body: any;
    const provider = createZaiProvider({ apiKey: "fake-zai-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request });
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[0].content, "developer instructions");
  });

  it("zai_maps_thinking_reasoning_effort_and_max_tokens", async () => {
    let body: any;
    const provider = createZaiProvider({ apiKey: "fake-zai-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: { ...request, model: { ...request.model, parameters: { maxTokens: 333, temperature: 0.4 } }, options: { compat: { reasoning_effort: "high", thinking: { type: "enabled" } } } } });
    assert.deepEqual(body.thinking, { type: "enabled" });
    assert.equal(body.reasoning_effort, "high");
    assert.equal(body.max_tokens, 333);
    assert.equal(body.maxTokens, undefined);
    assert.equal(body.temperature, 0.4);
  });

  it("zai_enables_tool_stream_for_supported_models", async () => {
    let body: any;
    const provider = createZaiProvider({ apiKey: "fake-zai-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([
        { choices: [{ delta: { content: "hi", reasoning_content: "think", tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: "{\"q\":\"x\"}" } }] } }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7, prompt_tokens_details: { cached_tokens: 1, cache_write_tokens: 2 } } },
      ]));
    }) as typeof fetch });
    const events = await assertProviderStreamConforms({ provider, request, expect: { text: "hi", usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7, cacheReadTokens: 1, cacheWriteTokens: 2 } } });
    assert.equal(body.tool_stream, true);
    assert(events.some((event: ProviderEvent) => event.type === "content_delta" && event.content.type === "thinking"));
    assertToolCallDeltasReconstruct(events, [{ index: 0, id: "call_1", name: "lookup", arguments: { q: "x" } }]);
  });

  it("zai_text_only_serializer_rejects_image_blocks", async () => {
    const imageRequest: ProviderRequest = {
      ...request,
      messages: [{ role: "user", content: [{ type: "image", url: "https://example.invalid/img.png" }] }],
    };
    const imageProvider = createZaiProvider({ apiKey: "fake-zai-key", fetch: (async () => ok(sse([]))) as typeof fetch });
    const events: ProviderEvent[] = [];
    for await (const event of imageProvider.generate(imageRequest)) events.push(event);
    assert.equal(events.at(-1)?.type, "error");
  });

  it("zai_replays_tool_call_and_tool_result", async () => {
    const replay: ProviderRequest = {
      ...request,
      messages: [
        { role: "assistant", content: [{ type: "tool_call", id: "call_1", name: "lookup", arguments: { q: "x" } }] },
        { role: "tool", content: [{ type: "tool_result", toolCallId: "call_1", name: "lookup", result: { ok: true } }] },
      ],
    };
    let body: unknown;
    const provider = createZaiProvider({ apiKey: "fake-zai-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: replay });
    assertSerializedRequestCoversContent(replay, body);
  });

  it("zai_emits_no_explicit_cache_payload_for_implicit_caching", async () => {
    let body: any;
    const provider = createZaiProvider({ apiKey: "fake-zai-key", fetch: (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: { ...request, options: { cacheKey: "sess", cacheRetention: "long" as const, cache: { breakpoints: [{ location: "last_stable_message" as const }] } } } });
    // Z.AI uses implicit GLM context caching; no explicit cache_control/cacheKey field.
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes("cache_control"), "Z.AI body must not contain cache_control");
    assert.ok(!serialized.includes("cacheKey"), "Z.AI body must not contain cacheKey");
    assert.ok(!serialized.includes("prompt_cache"), "Z.AI body must not contain prompt_cache fields");
  });

  it("zai_keeps_provider_owned_headers_after_caller_headers", async () => {
    let headers = new Headers();
    const provider = createZaiProvider({ apiKey: "fake-zai-key", fetch: (async (_input, init) => {
      headers = new Headers(init?.headers);
      return ok(sse([]));
    }) as typeof fetch });
    await assertProviderStreamConforms({ provider, request: { ...request, options: { ...request.options, headers: { authorization: "Bearer attacker", "content-type": "text/plain", "x-caller": "kept" } } } });
    assertProviderOwnedHeadersWin(headers, {
      owned: { authorization: "Bearer fake-zai-key", "content-type": "application/json" },
      caller: { authorization: "Bearer attacker", "content-type": "text/plain", "x-caller": "kept" },
    });
  });

  it("zai_redacts_api_key_from_http_errors", async () => {
    const provider = createZaiProvider({ apiKey: "fake-zai-key", fetch: (async () => new Response("bad fake-zai-key", { status: 500 })) as typeof fetch });
    const events = await assertProviderStreamConforms({ provider, request });
    assert.equal(events.at(-1)?.type, "error");
    assert(!JSON.stringify(events).includes("fake-zai-key"));
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
