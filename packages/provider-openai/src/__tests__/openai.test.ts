import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthMethod, AIProvider, ModelConfig, ProviderEvent, ProviderRequest } from "@arnilo/prism";
import { assertProviderOwnedHeadersWin, assertProviderStreamConforms, assertSerializedRequestCoversContent, assertToolCallDeltasReconstruct } from "@arnilo/prism/testing/provider-conformance";
import { createOpenAIProviderPackage, createOpenAIResponsesProvider } from "../index.js";

const request: ProviderRequest = {
  model: { provider: "openai", model: "gpt-5.1" },
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  tools: [{ name: "lookup", parameters: { type: "object" }, execute: () => ({ toolCallId: "call_1", name: "lookup", content: [] }) }],
  options: { sessionId: "session-1", cacheKey: "x".repeat(80), cacheRetention: "short" },
};

describe("@arnilo/prism-provider-openai responses", () => {
  it("openai_responses_stream_maps_text_thinking_tool_usage_and_done", async () => {
    const provider = createOpenAIResponsesProvider({ apiKey: "fake-openai-key", fetch: mockFetch(sse([
      { type: "response.output_text.delta", delta: "hello" },
      { type: "response.reasoning_text.delta", delta: "think" },
      { type: "response.output_item.delta", item: { index: 0, id: "call_1", name: "lookup", arguments_delta: "{\"q\":\"x\"}" } },
      { type: "response.completed", response: { usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13, input_tokens_details: { cached_tokens: 4 } } } },
    ])) });

    const events = await assertProviderStreamConforms({ provider, request, expect: { text: "hello", usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13, cacheReadTokens: 4 } } });
    assert(events.some((event: ProviderEvent) => event.type === "content_delta" && event.content.type === "thinking" && event.content.text === "think"));
    assertToolCallDeltasReconstruct(events, [{ index: 0, id: "call_1", name: "lookup", arguments: { q: "x" } }]);
  });

  it("openai_responses_applies_prompt_cache_policy_session_headers_and_max_tokens", async () => {
    let body: any;
    let headers: Headers;
    const provider = createOpenAIResponsesProvider({ apiKey: "fake-openai-key", fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      headers = new Headers(init?.headers);
      return ok(sse([]));
    } });

    await assertProviderStreamConforms({ provider, request: { ...request, model: { ...request.model, parameters: { maxTokens: 321, temperature: 0.2 } } } });
    assert.equal(body.prompt_cache_key, "x".repeat(64));
    // short retention is OpenAI's automatic/implicit caching; do not emit an
    // invalid literal retention value.
    assert.equal(body.prompt_cache_retention, undefined);
    assert.equal(body.max_output_tokens, 321);
    assert.equal(body.maxTokens, undefined);
    assert.equal(body.temperature, 0.2);
    assert.equal(headers!.get("x-client-request-id"), "session-1");
    assert.equal(headers!.get("authorization"), "Bearer fake-openai-key");
  });

  it("openai_responses_long_retention_emits_24h_only_when_supported", async () => {
    let body: any;
    const provider = createOpenAIResponsesProvider({ apiKey: "fake-openai-key", fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    } });
    const longSupported = { ...request, options: { ...request.options, cacheRetention: "long" as const }, model: { ...request.model, cache: { kind: "openai_key" as const, longRetention: true } } };
    await assertProviderStreamConforms({ provider, request: longSupported });
    assert.equal(body.prompt_cache_retention, "24h");

    let body2: any;
    const provider2 = createOpenAIResponsesProvider({ apiKey: "fake-openai-key", fetch: async (_url, init) => {
      body2 = JSON.parse(String(init?.body));
      return ok(sse([]));
    } });
    // Unknown model with no cache metadata must not emit an unsupported value.
    const longUnsupported = { ...request, options: { ...request.options, cacheRetention: "long" as const } };
    await assertProviderStreamConforms({ provider: provider2, request: longUnsupported });
    assert.equal(body2.prompt_cache_retention, undefined);
  });

  it("openai_responses_sanitizes_and_clamps_prompt_cache_key", async () => {
    let body: any;
    const provider = createOpenAIResponsesProvider({ apiKey: "fake-openai-key", fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    } });
    await assertProviderStreamConforms({ provider, request: {
      ...request,
      options: { cacheKey: "team/agent#1@" + "x".repeat(80), cacheRetention: "short" },
    } });
    // Disallowed chars stripped to "-", leading/trailing dashes trimmed, clamped to 64.
    assert.equal(body.prompt_cache_key.length, 64);
    assert.match(body.prompt_cache_key, /^team-agent-1-x+$/);
  });

  it("openai_responses_keeps_provider_owned_headers_after_caller_headers", async () => {
    let headers: Headers;
    const provider = createOpenAIResponsesProvider({ apiKey: "fake-openai-key", fetch: async (_url, init) => {
      headers = new Headers(init?.headers);
      return ok(sse([]));
    } });
    await assertProviderStreamConforms({ provider, request: {
      ...request,
      options: { ...request.options, headers: { authorization: "Bearer attacker", "x-client-request-id": "attacker-req", "content-type": "text/plain", "x-caller": "kept" } },
    } });
    assertProviderOwnedHeadersWin(headers!, {
      owned: { authorization: "Bearer fake-openai-key", "content-type": "application/json", "x-client-request-id": "session-1" },
      caller: { authorization: "Bearer attacker", "x-client-request-id": "attacker-req", "content-type": "text/plain", "x-caller": "kept" },
    });
  });

  it("openai_responses_aborts_fetch", async () => {
    const provider = createOpenAIResponsesProvider({ fetch: async (_url, init) => {
      assert.equal(init?.signal?.aborted, true);
      throw init?.signal?.reason ?? new Error("aborted");
    } });
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await assert.rejects(async () => {
      for await (const _ of provider.generate({ ...request, signal: controller.signal })) { /* drain */ }
    }, /stop/);
  });

  it("openai_responses_serializes_full_prism_content_replay", async () => {
    const replay: ProviderRequest = {
      model: { provider: "openai", model: "gpt-5.1", capabilities: { input: ["text", "image"] } },
      messages: [
        { role: "assistant", content: [{ type: "tool_call", id: "call_1", name: "lookup", arguments: { q: "x" } }] },
        { role: "tool", content: [{ type: "tool_result", toolCallId: "call_1", name: "lookup", result: { ok: true } }] },
        { role: "user", content: [{ type: "text", text: "hi" }, { type: "image", url: "https://example.invalid/img.png" }] },
      ],
    };
    let body: unknown;
    const provider = createOpenAIResponsesProvider({ apiKey: "fake-openai-key", fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return ok(sse([]));
    } });

    await assertProviderStreamConforms({ provider, request: replay });
    assertSerializedRequestCoversContent(replay, body);
  });

  it("openai_package_passes_provider_conformance_without_network", async () => {
    const registered: unknown[] = [];
    await createOpenAIProviderPackage({ apiKey: "fake-openai-key", fetch: mockFetch(sse([])) }).setup({
      registerProvider: (provider: AIProvider) => registered.push(provider),
      registerModel: (model: ModelConfig) => registered.push(model),
      registerAuthMethod: (method: AuthMethod) => registered.push(method),
    } as any);
    assert(registered.some((item: any) => item.id === "openai"));
    assert(registered.some((item: any) => item.provider === "openai" && item.kind === "api_key"));
    assert(registered.some((item: any) => item.provider === "openai-codex" && item.kind === "oauth"));
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
